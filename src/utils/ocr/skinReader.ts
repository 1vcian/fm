// Skin-popup reader for the guided AutoSync flow.
//
// A "skin screenshot" is the game's per-slot skin popup: a grey card titled "<Type> Skins"
// with a grid of skin tiles, plus a WHITE detail card showing the selected skin's name
// (e.g. "Goldfish"), its bonus ("+6.78% Damage") and — for set skins — the set-bonus line
// "(Fishbowl Set Bonus 1/3) ...".
//
// Individual skin display names ("Goldfish") do NOT exist anywhere in the parsed configs:
// skins are identified only by {Type, Idx} (SkinsLibrary) and grouped by BaseSetId
// (SetsLibrary). The closed set we CAN match against is the SET name embedded in the
// set-bonus line, so identification works as:
//     popup title      -> skin Type      ("Helmet Skins"              -> Helmet)
//     set-bonus line   -> BaseSetId      ("(Fishbowl Set Bonus 1/3)"  -> FishbowlSet)
//     (BaseSetId,Type) -> one SkinsLibrary entry -> Idx
// Standalone skins (the Idx>=100 helmets, no BaseSetId) cannot be resolved by name and
// come back unresolved (raw name + warning, no idx).
//
// This file only ADDS to the OCR toolkit — it imports the shared helpers read-only and
// changes no behaviour of the existing item/pet/mount/skills readers.

import { cropCanvas, binarize, detectBrightCard, type Rect } from './imagePrep';
import { ocrPageLines } from './ocrEngine';
import { normalizeName, similarity, bestMatch } from './parse';
import { splitCamel } from './gameDictionary';
import type { GameDictionaries } from './gameLocalization';
import type { DetectedSkinEquip } from './readerTypes';

// ---------------------------------------------------------------------------------------------
// Dictionary (built from SkinsLibrary.json + SetsLibrary.json — the app's own data)
// ---------------------------------------------------------------------------------------------

export interface SkinDictEntry {
    type: string;          // SkinId.Type ('Helmet' | 'Armour' | 'Weapon')
    idx: number;           // SkinId.Idx
    setId: string | null;  // BaseSetId ('FishbowlSet' ...) or null for standalone skins
}

export interface SkinDict {
    /** normalized set display name ("fishbowl", "dark planet warrior") -> setId */
    setNames: Map<string, string>;
    /** `${setId}|${Type}` -> entry */
    bySetAndType: Map<string, SkinDictEntry>;
    entries: SkinDictEntry[];
}

export function emptySkinDict(): SkinDict {
    return { setNames: new Map(), bySetAndType: new Map(), entries: [] };
}

/** Profile item-slot -> SkinId.Type. Only these slots have skins in the game. */
export const SLOT_TO_SKIN_TYPE: Record<string, string> = { Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Armour' };
/** Slots the skin-row slot dropdown offers. */
export const SKIN_SLOTS = Object.keys(SLOT_TO_SKIN_TYPE);
/** SkinId.Type -> profile item-slot. */
export const SKIN_TYPE_TO_SLOT: Record<string, string> = { Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body' };

export function buildSkinDict(skinsLibrary: any, setsLibrary: any): SkinDict {
    const dict = emptySkinDict();
    if (!skinsLibrary) return dict;
    for (const raw of Object.values<any>(skinsLibrary)) {
        const type = raw?.SkinId?.Type;
        const idx = raw?.SkinId?.Idx;
        if (typeof type !== 'string' || typeof idx !== 'number') continue;
        const setId = typeof raw?.BaseSetId === 'string' && raw.BaseSetId ? raw.BaseSetId : null;
        const entry: SkinDictEntry = { type, idx, setId };
        dict.entries.push(entry);
        if (setId) dict.bySetAndType.set(`${setId}|${type}`, entry);
    }
    // Set display names: "FishbowlSet" -> "fishbowl", "DarkPlanetWarriorSet" -> "dark planet warrior".
    const setIds = new Set<string>(dict.entries.map(e => e.setId).filter((s): s is string => !!s));
    for (const id of Object.keys(setsLibrary || {})) setIds.add(id);
    for (const setId of setIds) {
        const display = normalizeName(splitCamel(setId.replace(/Set$/, '')));
        if (display) dict.setNames.set(display, setId);
        const full = normalizeName(splitCamel(setId));
        if (full && !dict.setNames.has(full)) dict.setNames.set(full, setId);
    }
    return dict;
}

/** Re-resolve a detected set skin for a (possibly user-changed) profile slot. */
export function resolveSkinForSlot(dict: SkinDict, setId: string | null | undefined, slot: string): SkinDictEntry | null {
    const type = SLOT_TO_SKIN_TYPE[slot];
    if (!setId || !type) return null;
    return dict.bySetAndType.get(`${setId}|${type}`) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** English + localized words for a ui term (from Localization.ui), all normalized. */
function uiWords(en: string, dicts?: GameDictionaries): string[] {
    const out = new Set<string>([en]);
    const tr = dicts?.loc?.ui?.[en];
    for (const v of Object.values(tr || {})) {
        const n = normalizeName(v);
        if (n) out.add(n);
    }
    return [...out];
}

function containsWord(normLine: string, words: string[]): boolean {
    const toks = normLine.split(' ');
    return words.some(w => w.includes(' ') ? normLine.includes(w) : toks.includes(w));
}

/** Title word -> profile slot (English titles; localized slot names are not in the configs). */
const SLOT_WORDS: [string, string][] = [
    ['helmet', 'Helmet'], ['armour', 'Body'], ['armor', 'Body'], ['body', 'Body'], ['weapon', 'Weapon'],
    ['gloves', 'Gloves'], ['belt', 'Belt'], ['necklace', 'Necklace'], ['ring', 'Ring'], ['shoes', 'Shoe'],
];
const SLOT_WORD_MIN = 0.84;

function slotFromText(lines: { text: string }[]): string | null {
    for (const l of lines) {
        for (const word of normalizeName(l.text).split(' ')) {
            if (word.length < 4) continue; // avoid noise matching short words
            for (const [w, slot] of SLOT_WORDS) {
                if (similarity(word, w) >= SLOT_WORD_MIN) return slot;
                // OCR often glues the title into one token ("helmetiskins") — substring check
                if (w.length >= 5 && word.length > w.length && word.includes(w)) return slot;
            }
        }
    }
    return null;
}

/** Try to pull the set name out of a set-bonus line via 1..3-word windows vs the set dict. */
function matchSetInLine(normLine: string, dict: SkinDict): { setId: string; score: number } | null {
    const toks = normLine.split(' ').filter(t => t && !/^\d+$/.test(t));
    let best: { setId: string; score: number } | null = null;
    for (let len = 1; len <= 3; len++) {
        for (let i = 0; i + len <= toks.length; i++) {
            const window = toks.slice(i, i + len).join(' ');
            const m = bestMatch(window, dict.setNames, 0.8);
            if (m && (!best || m.score > best.score)) best = { setId: m.value, score: m.score };
        }
    }
    return best;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampRect(r: Rect, W: number, H: number): Rect {
    const x = clamp(Math.round(r.x), 0, W - 1), y = clamp(Math.round(r.y), 0, H - 1);
    return { x, y, w: clamp(Math.round(r.w), 1, W - x), h: clamp(Math.round(r.h), 1, H - y) };
}

/**
 * Locate the WHITE detail card of the skin popup. imagePrep.detectBrightCard needs one
 * long bright band, but here the skin tile / Evolve+Remove buttons split the white rows,
 * so we use per-row NEAR-WHITE FRACTION for the core band (text rows survive the tile)
 * and extend it while the row MEAN stays bright (catches the grey set-bonus lines).
 */
function detectSkinDetailCard(src: HTMLCanvasElement): Rect | null {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const { width: W, height: H } = src;
    const data = ctx.getImageData(0, 0, W, H).data;
    const step = Math.max(1, Math.floor(W / 200));
    const rowFrac = new Float32Array(H), rowMean = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let white = 0, sum = 0, n = 0;
        for (let x = 0; x < W; x += step) {
            const i = (y * W + x) * 4;
            const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (lum > 230) white++;
            sum += lum; n++;
        }
        rowFrac[y] = white / n;
        rowMean[y] = sum / n;
    }
    // longest run of predominantly-white rows
    let bestStart = 0, bestLen = 0, cur = -1;
    for (let y = 0; y <= H; y++) {
        if (y < H && rowFrac[y] > 0.5) { if (cur < 0) cur = y; }
        else if (cur >= 0) { if (y - cur > bestLen) { bestStart = cur; bestLen = y - cur; } cur = -1; }
    }
    if (bestLen < H * 0.03) return null;
    let y0 = bestStart, y1 = bestStart + bestLen;
    while (y0 > 0 && (rowFrac[y0 - 1] > 0.35 || rowMean[y0 - 1] > 200)) y0--;
    while (y1 < H && (rowFrac[y1] > 0.35 || rowMean[y1] > 200)) y1++;
    // horizontal extent: columns that are mostly white across the core band
    const yStep = Math.max(1, Math.floor(bestLen / 40));
    let xMin = W, xMax = 0;
    for (let x = 0; x < W; x++) {
        let white = 0, n = 0;
        for (let y = bestStart; y < bestStart + bestLen; y += yStep) {
            const i = (y * W + x) * 4;
            const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (lum > 230) white++;
            n++;
        }
        if (white / n > 0.4) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    }
    if (xMax - xMin < W * 0.4) return null;
    return { x: xMin, y: y0, w: xMax - xMin, h: y1 - y0 };
}

/**
 * Prepare the popup-title band for OCR. The detail card dims everything behind it, so the
 * outlined title ends up barely brighter than the popup's grey background (plain thresholds
 * see nothing). Band-pass instead: find the popup's grey MODE, restrict to the rows/columns
 * that are mostly that grey, and mark every pixel that deviates from it (outline AND fill)
 * as ink. Returns a dark-on-white canvas, or null if no grey popup region is found.
 */
function prepareTitleBand(src: HTMLCanvasElement, rect: Rect): HTMLCanvasElement | null {
    const crop = cropCanvas(src, rect);
    const ctx = crop.getContext('2d', { willReadFrequently: true })!;
    const { width: W, height: H } = crop;
    const data = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    const hist = new Array(256).fill(0);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
        hist[gray[p]]++;
    }
    // popup background = most common luminance above the dim surround
    let mode = 0, modeN = -1;
    for (let v = 51; v < 256; v++) if (hist[v] > modeN) { modeN = hist[v]; mode = v; }
    const isGrey = (g: number) => Math.abs(g - mode) <= 12;
    // rows/columns that are mostly popup-grey
    let r0 = -1, r1 = -1;
    for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = 0; x < W; x += 2) if (isGrey(gray[y * W + x])) n++;
        if (n / Math.ceil(W / 2) > 0.35) { if (r0 < 0) r0 = y; r1 = y; }
    }
    if (r0 < 0 || r1 - r0 < 8) return null;
    let c0 = -1, c1 = -1;
    for (let x = 0; x < W; x++) {
        let n = 0, t = 0;
        for (let y = r0; y <= r1; y += 2) { if (isGrey(gray[y * W + x])) n++; t++; }
        if (n / t > 0.35) { if (c0 < 0) c0 = x; c1 = x; }
    }
    if (c0 < 0 || c1 - c0 < 32) return null;
    // ink = anything deviating from the popup grey (title outline + fill, ribbons, tile art)
    const ow = c1 - c0 + 1, oh = r1 - r0 + 1;
    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d', { willReadFrequently: true })!;
    const img = octx.createImageData(ow, oh);
    for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
            const g = gray[(y + r0) * W + (x + c0)];
            const v = Math.abs(g - mode) > 16 ? 0 : 255;
            const o = (y * ow + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
            img.data[o + 3] = 255;
        }
    }
    octx.putImageData(img, 0, 0);
    const scale = ow < 900 ? 900 / ow : 1;
    return scale > 1 ? cropCanvas(out, { x: 0, y: 0, w: ow, h: oh }, scale) : out;
}

/**
 * Read one skin-popup screenshot. Returns the detected skin (resolved to {Type, Idx} when the
 * set-bonus line + popup title identify it) with a crop of the white detail card for the modal.
 * Never throws for unreadable content — it degrades to low confidence + warnings.
 */
export async function readSkin(
    src: HTMLCanvasElement,
    skinDict: SkinDict,
    dicts?: GameDictionaries,
): Promise<DetectedSkinEquip> {
    const W = src.width, H = src.height;
    const warnings: string[] = [];

    // 1. Locate the white detail card (name + bonuses). Fallback: generic lower-middle band.
    let card = detectSkinDetailCard(src) ?? detectBrightCard(src);
    if (!card) {
        card = clampRect({ x: W * 0.05, y: H * 0.46, w: W * 0.9, h: H * 0.22 }, W, H);
        warnings.push('White detail card not found — used a default region.');
    }
    card = clampRect(card, W, H);

    // Crop for the modal (small jpeg keeps the rows light).
    const cropRect = clampRect({ x: card.x - 6, y: card.y - 6, w: card.w + 12, h: card.h + 12 }, W, H);
    const cropScale = cropRect.w > 480 ? 480 / cropRect.w : 1;
    const cropUrl = cropCanvas(src, cropRect, cropScale).toDataURL('image/jpeg', 0.82);

    // 2. OCR the card's text column (right of the skin tile; dark text on white).
    const textRect = clampRect({ x: card.x + card.w * 0.28, y: card.y, w: card.w * 0.72, h: card.h }, W, H);
    const textScale = textRect.w < 700 ? 700 / textRect.w : 1;
    const textCanvas = binarize(cropCanvas(src, textRect, textScale));
    let cardLines: { text: string }[] = [];
    try { cardLines = await ocrPageLines(textCanvas); } catch { warnings.push('Card OCR failed.'); }

    // 3. Parse: name line, "+X%" bonus lines (before the set line), "(<Set> Set Bonus n/m)".
    const dmgWords = uiWords('damage', dicts);
    const hpWords = uiWords('health', dicts);
    const skipWords = [...uiWords('equipped', dicts), ...uiWords('remove', dicts), ...uiWords('upgrade', dicts), 'evolve', 'equip', 'show skin'];

    let name: string | undefined;
    let setId: string | undefined;
    let setScore = 0;
    const stats: { statType: string; value: number }[] = [];
    let sawSetLine = false;

    for (const line of cardLines) {
        const raw = line.text.trim();
        const norm = normalizeName(raw);
        if (!norm) continue;
        if (containsWord(norm, skipWords)) continue;

        const isSetLine = /\(/.test(raw) || /\d\s*\/\s*\d/.test(raw) || /\bset\b/i.test(raw);
        if (isSetLine) {
            sawSetLine = true;
            const m = matchSetInLine(norm, skinDict);
            if (m && m.score > setScore) { setId = m.setId; setScore = m.score; }
            continue;
        }

        const pct = raw.match(/[+＋]?\s*(\d+(?:[.,]\d+)?)\s*%/);
        if (pct) {
            if (sawSetLine || raw.includes('&')) continue; // set-bonus continuation, not the skin's own stat
            const value = parseFloat(pct[1].replace(',', '.')) / 100;
            if (!(value > 0) || value > 0.5) { warnings.push(`Ignored implausible skin bonus "${raw}".`); continue; }
            const isDmg = containsWord(norm, dmgWords);
            const isHp = containsWord(norm, hpWords);
            if (isDmg === isHp) continue; // both or neither -> not a single-stat skin bonus line
            stats.push({ statType: isDmg ? 'Damage' : 'Health', value });
            continue;
        }

        if (!name && !sawSetLine && /[a-z].*[a-z]/.test(norm) && norm.length >= 3) {
            name = raw.replace(/[^\w'’& -]+/g, ' ').replace(/\s+/g, ' ').trim(); // strip OCR stray punctuation
        }
    }

    // Fallback: some skins are named after their set ("Anubis") — try the name itself.
    if (!setId && name) {
        const m = bestMatch(name, skinDict.setNames, 0.72);
        if (m) { setId = m.value; setScore = m.score; }
    }

    // 4. Popup title ("Helmet Skins") -> slot hint. The band is dimmed behind the detail card,
    //    so use the popup-restricted band-pass rather than a plain brightness threshold.
    const titleTop = H * 0.12;
    const titleRect = clampRect({ x: W * 0.04, y: titleTop, w: W * 0.92, h: Math.max(1, Math.min(card.y, H * 0.45) - titleTop) }, W, H);
    let slot: string | null = null;
    if (titleRect.h > 8) {
        try {
            const titleCanvas = prepareTitleBand(src, titleRect);
            if (titleCanvas) slot = slotFromText(await ocrPageLines(titleCanvas));
        } catch { /* title unreadable */ }
    }
    if (!slot) warnings.push('Popup title not readable — confirm the slot.');

    // 5. Resolve (setId, type) -> idx.
    const skinType = slot ? SLOT_TO_SKIN_TYPE[slot] : undefined;
    let entry: SkinDictEntry | null = null;
    if (setId) {
        if (skinType) entry = skinDict.bySetAndType.get(`${setId}|${skinType}`) ?? null;
        if (!entry) {
            // Title missing/mismatched: fall back per set, preferring Helmet like the game's default tab.
            for (const t of ['Helmet', 'Armour', 'Weapon']) {
                const e = skinDict.bySetAndType.get(`${setId}|${t}`);
                if (e) { entry = e; break; }
            }
        }
    }
    if (!entry) {
        warnings.push(setId
            ? `Matched set "${setId}" but no ${skinType ?? 'known'} skin exists in it.`
            : 'Skin not identified — standalone skins have no set line and cannot be matched by name.');
    }

    const resolvedSlot = entry ? (SKIN_TYPE_TO_SLOT[entry.type] ?? slot ?? undefined) : (slot ?? undefined);
    const confidence = entry ? (slot ? 0.9 : 0.6) : 0.3;

    return {
        slot: resolvedSlot,
        skinType: entry?.type ?? skinType,
        skinIdx: entry?.idx,
        setId,
        name,
        stats,
        equipped: true,
        cropUrl,
        confidence,
        warnings,
    };
}
