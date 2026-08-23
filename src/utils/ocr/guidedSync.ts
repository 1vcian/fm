// Guided (two-phase) AutoSync — classification and reading are split so the user can confirm
// or override the detected template per screenshot before any OCR runs.
//
// Phase 1: classifyBatch(files)         -> thumbnail + detected template per file (no OCR)
// Phase 2: readScreenshotAs(file, tpl)  -> read ONE file with a user-forced template, mirroring
//          autoSyncPipeline.readScreenshot's routing exactly but SKIPPING classifyScreen:
//              item   -> readItem(canvas, dicts)
//              pet    -> readUnit(canvas, 'pet',   dicts)
//              mount  -> readUnit(canvas, 'mount', dicts)
//              skills -> readSkills(canvas)   (confidence = share of cells with a level)
//          plus readCurrencies(canvas, forcedType) for every screen, like the pipeline.
//
// runGuidedSync maps a batch of (file, template) choices through readScreenshotAs with the same
// progress conventions as autoSync.runAutoSyncV2, then diffs into ChangeRow[] for the modal.
//
// This file only IMPORTS from the rest of src/utils/ocr — it does not change any behaviour of
// the one-shot pipeline.

import { loadImage, imageToCanvas, detectPopupCard, detectPopupTile, type Rect } from './imagePrep';
import { classifyScreen, type ScreenTemplate } from './templateClassifier';
import { readItem, readUnit } from './templateReaders';
import { readSkills } from './skillsReader';
import { readClanTree } from './clanTreeReader';
import { readForgeLevel, readSkillAscension } from './screenExtras';
import { readCurrencies } from './currencyReader';
import { readSkin, emptySkinDict, type SkinDict } from './skinReader';
import { buildChangesFromReads, type ChangeRow, type AutoSyncProgress } from './autoSync';
import { setOcrProgress } from './ocrEngine';
import type { GameDictionaries } from './gameLocalization';
import type { ScreenReadResult, CurrencyCrops } from './readerTypes';
import type { UserProfile } from '../../types/Profile';

/** Templates the user can force in the review stage (the readable subset of ScreenTemplate,
 *  plus 'skin' — the per-slot skin popup, which the classifier itself never emits). */
export type ForcedTemplate = 'item' | 'pet' | 'mount' | 'skills' | 'clanTree' | 'skin';

/** Review-stage hint: the classifier's own templates plus 'skin', which templateClassifier
 *  never emits (the skin popup shares the coins+gems header with the item popup) — it is
 *  derived post-classification by refineItemToSkin below. */
export type HintedTemplate = ScreenTemplate | 'skin';

export interface ClassifiedFile {
    file: File;
    thumbUrl: string;         // small data-URL preview for the review grid
    type: HintedTemplate;     // detected template ('unknown' if classification failed)
    confidence: number;       // classifier confidence 0..1
}

// ---------------------------------------------------------------------------------------------
// SKIN refinement — the per-slot skin popup classifies as 'item' (same coins+gems header), so a
// cheap canvas check (no OCR) separates them: an ITEM popup's white card always contains a
// SATURATED age-coloured subject tile (detectPopupTile finds it), while a SKIN popup's detail
// card shows the skin art on a WHITE/desaturated tile — no saturated tile in the card.

/** Min mean chroma (max-min channel spread) over the detected tile's bbox for it to count as a
 *  real age-coloured item tile. Solid age tiles measure ~120+; skin cards either yield no tile
 *  at all or only sparse art/button fragments well below this. */
const ITEM_TILE_MIN_CHROMA = 60;

export interface SkinRefinement {
    type: 'item' | 'skin';
    card: Rect | null;     // white popup card (null = keep 'item', nothing to test against)
    tile: Rect | null;     // saturated tile found inside the card, if any
    chroma: number | null; // mean chroma over the tile bbox
}

/** Mean chroma (max-min channel spread) over a rect of the canvas, subsampled. */
function meanChroma(canvas: HTMLCanvasElement, r: Rect): number {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    const step = Math.max(1, Math.floor(r.w * r.h / 20000)); // ~20k samples max
    let sum = 0, n = 0;
    for (let p = 0; p < r.w * r.h; p += step) {
        const i = p * 4;
        sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        n++;
    }
    return n ? sum / n : 0;
}

/**
 * Post-classification refinement for screens the classifier called 'item': keep 'item' when the
 * white card contains a genuinely saturated subject tile, hint 'skin' otherwise. Conservative:
 * with no white card found there is nothing to test, so the classifier's 'item' stands.
 */
export function refineItemToSkin(canvas: HTMLCanvasElement): SkinRefinement {
    const card = detectPopupCard(canvas);
    if (!card) return { type: 'item', card: null, tile: null, chroma: null };
    const tile = detectPopupTile(canvas);
    if (!tile) return { type: 'skin', card, tile: null, chroma: null };
    // ignore the round close (X) button that overlaps the card's bottom-centre edge — the same
    // exclusion findColoredTiles/findStarTiles apply (a clipped X can pass detectPopupTile's
    // aspect gate on some layouts); a real item tile never sits there.
    const tcx = tile.x + tile.w / 2, tcy = tile.y + tile.h / 2;
    if (tcy > card.y + card.h * 0.85 && Math.abs(tcx - (card.x + card.w / 2)) < card.w * 0.14) {
        return { type: 'skin', card, tile: null, chroma: null };
    }
    const chroma = meanChroma(canvas, tile);
    return { type: chroma >= ITEM_TILE_MIN_CHROMA ? 'item' : 'skin', card, tile, chroma };
}

const THUMB_W = 160;

function makeThumb(img: HTMLImageElement): string {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const w = Math.min(THUMB_W, iw);
    const h = Math.max(1, Math.round(ih * w / iw));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.7);
}

/**
 * Phase 1 — classify a batch of screenshots WITHOUT reading them. Loads each image, builds a
 * small thumbnail data-URL and runs the template classifier. Never throws per-file: a file that
 * fails to load/classify comes back as type 'unknown' with confidence 0.
 * `onResult`, if given, fires as each file finishes so the UI can fill in hints incrementally.
 */
export async function classifyBatch(
    files: File[],
    onResult?: (index: number, result: ClassifiedFile) => void,
): Promise<ClassifiedFile[]> {
    const out: ClassifiedFile[] = [];
    for (let i = 0; i < files.length; i++) {
        let entry: ClassifiedFile;
        try {
            const img = await loadImage(files[i]);
            const thumbUrl = makeThumb(img);
            const { type, confidence } = await classifyScreen(img);
            // skin popups classify as 'item' (same header) — refine with the card/tile check
            const hinted: HintedTemplate = type === 'item' ? refineItemToSkin(imageToCanvas(img)).type : type;
            entry = { file: files[i], thumbUrl, type: hinted, confidence };
        } catch {
            entry = { file: files[i], thumbUrl: '', type: 'unknown', confidence: 0 };
        }
        out.push(entry);
        onResult?.(i, entry);
    }
    return out;
}

/**
 * Phase 2 — read a single screenshot as the user-confirmed template. Identical routing,
 * warnings and confidence conventions to autoSyncPipeline.readScreenshot, minus the
 * classification step (the forced type is trusted).
 */
export async function readScreenshotAs(
    input: Blob | string,
    forced: ForcedTemplate,
    dicts: GameDictionaries,
    skinDict?: SkinDict,
): Promise<ScreenReadResult> {
    const warnings: string[] = [];

    const canvas = imageToCanvas(await loadImage(input));

    const result: ScreenReadResult = { screen: forced, warnings, confidence: 0 };

    switch (forced) {
        case 'item': {
            result.item = await readItem(canvas, dicts);
            result.confidence = result.item.confidence;
            break;
        }
        case 'pet': {
            result.unit = await readUnit(canvas, 'pet', dicts);
            result.confidence = result.unit.confidence;
            break;
        }
        case 'mount': {
            result.unit = await readUnit(canvas, 'mount', dicts);
            result.confidence = result.unit.confidence;
            break;
        }
        case 'skills': {
            result.skills = await readSkills(canvas);
            // confidence from the share of cells that yielded a level
            const known = result.skills.filter(s => s.level !== null).length;
            result.confidence = result.skills.length ? known / result.skills.length : 0;
            break;
        }
        case 'clanTree': {
            result.clanTree = await readClanTree(canvas);
            result.confidence = result.clanTree.confidence;
            break;
        }
        case 'skin': {
            result.skin = await readSkin(canvas, skinDict ?? emptySkinDict(), dicts);
            warnings.push(...result.skin.warnings);
            result.confidence = result.skin.confidence;
            break;
        }
    }

    // Currencies are read for every screen type, keyed off the forced template. The skin popup
    // overlays the main battle screen, which has no calibrated currency bands — skip it there.
    if (forced !== 'skin') {
        const currencyCrops: CurrencyCrops = {};
        result.currencies = await readCurrencies(canvas, forced, currencyCrops);
        if (Object.keys(currencyCrops).length) result.currencyCrops = currencyCrops;
    }

    // Extras from the fixed game UI behind the popups: forge level on ITEM screens only
    // (user request), ascension stars on the skills screen.
    if (forced === 'item') {
        const fl = await readForgeLevel(canvas);
        result.forgeLevel = fl.value;
        result.forgeLevelCropUrl = fl.cropUrl;
    } else if (forced === 'skills') {
        result.skillAscension = await readSkillAscension(canvas);
    }

    return result;
}

export interface GuidedEntry { file: File; template: ForcedTemplate; }

/**
 * Read a batch of user-confirmed (file, template) pairs and diff them into reviewable
 * ChangeRow[]. Progress reporting matches runAutoSyncV2: per-file progress via `onProgress`,
 * sub-file OCR progress (worker load / recognise) through the global OCR hook.
 */
export async function runGuidedSync(
    entries: GuidedEntry[],
    dicts: GameDictionaries,
    profile: UserProfile,
    onProgress?: (p: AutoSyncProgress) => void,
    skinDict?: SkinDict,
): Promise<{ rows: ChangeRow[]; results: ScreenReadResult[] }> {
    let done = 0;
    setOcrProgress(pr => onProgress?.({ fileIndex: done, total: entries.length, status: pr.status, ocrProgress: pr.progress }));
    try {
        const results: ScreenReadResult[] = [];
        for (let i = 0; i < entries.length; i++) {
            results.push(await readScreenshotAs(entries[i].file, entries[i].template, dicts, skinDict));
            done = i + 1;
            onProgress?.({ fileIndex: done, total: entries.length });
        }
        const rows = buildChangesFromReads(results, profile);
        return { rows, results };
    } finally {
        setOcrProgress(null);
    }
}
