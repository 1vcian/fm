// Headless validation harness for the AutoSync OCR pipeline (browser side).
//
// Loaded by /ocr-harness.html (dev-only page). Driven by reverseForge/run_ts_harness.mjs via
// playwright. It builds the SAME game dictionaries the AutoSyncModal builds (same config files,
// same buildGameDictionaries call), fetches the image manifest the driver placed under
// /__harness_imgs/manifest.json, then runs the REAL pipeline (classifyScreen + readScreenshot)
// on every image and publishes the raw results on window.__HARNESS_RESULTS__ for scoring in Node.
//
// This file is additive test scaffolding: it imports the ocr modules and never modifies them.

import { buildGameDictionaries, type GameDictionaries } from '../utils/ocr/gameLocalization';
import { classifyScreen } from '../utils/ocr/templateClassifier';
import { readScreenshot } from '../utils/ocr/autoSyncPipeline';
import { refineItemToSkin } from '../utils/ocr/guidedSync';
import { readItem, readUnit } from '../utils/ocr/templateReaders';
import { readSkills } from '../utils/ocr/skillsReader';
import { readCurrencies } from '../utils/ocr/currencyReader';
import {
    loadImage, imageToCanvas, detectBrightCard, findColoredTiles, cropCanvas, findColorNameBand,
} from '../utils/ocr/imagePrep';
import { ocrPageLines } from '../utils/ocr/ocrEngine';
import { splitCamel } from '../utils/ocr/gameDictionary';
import { normalizeName } from '../utils/ocr/parse';

// Same version dir the app would select (max of versions.json — GameDataContext picks the latest).
const CONFIG_VERSION = '2026_08_21_00_29';

declare global {
    interface Window {
        __HARNESS_RESULTS__?: unknown;
        __HARNESS_ERROR__?: string;
        __HARNESS_PROGRESS__?: string;
    }
}

const statusEl = document.getElementById('status')!;
function setStatus(s: string) {
    statusEl.textContent = s;
    window.__HARNESS_PROGRESS__ = s;
    console.log(`[harness] ${s}`);
}

async function fetchJson(url: string): Promise<any> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    return r.json();
}

/** English name lookup tables so the Node scorer can resolve matched unit ids back to names. */
function unitNameTable(section: any): { rarity: string; id: number; name: string }[] {
    const out: { rarity: string; id: number; name: string }[] = [];
    for (const info of Object.values<any>(section?.mapping ?? {})) {
        if (info?.name == null || info.rarity == null || info.id == null) continue;
        out.push({ rarity: String(info.rarity), id: Number(info.id), name: normalizeName(splitCamel(String(info.name))) });
    }
    return out;
}

async function buildDicts(): Promise<{ dicts: GameDictionaries; spriteMapping: any }> {
    // Mirrors AutoSyncModal: useGameData('AutoItemMapping.json' | 'SkillLibrary.json' |
    // 'ManualSpriteMapping.json' | 'Localization.json' | 'SecondaryStatLibrary.json').
    // Global files live at parsed_configs/, version files at parsed_configs/<version>/.
    const base = `${import.meta.env.BASE_URL}parsed_configs`;
    const [autoItemMapping, skillLibrary, spriteMapping, localization, secondaryStatLibrary] = await Promise.all([
        fetchJson(`${base}/AutoItemMapping.json`),
        fetchJson(`${base}/${CONFIG_VERSION}/SkillLibrary.json`),
        fetchJson(`${base}/ManualSpriteMapping.json`),
        fetchJson(`${base}/Localization.json`),
        fetchJson(`${base}/${CONFIG_VERSION}/SecondaryStatLibrary.json`),
    ]);
    return {
        dicts: buildGameDictionaries({ autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization }),
        spriteMapping,
    };
}

interface ManifestEntry { key: string; url: string; set: string; oracle?: 'item' | 'pet' | 'mount' | 'skills'; }

/** Drop the evidence-crop data-URLs (tile art, level band, per-line, per-cell, currency pills)
 *  so the harness payload stays serialisable/small. Purely cosmetic: crops are observability
 *  fields for the diff modal and never feed back into any read. */
function stripCrops(r: any): void {
    if (!r) return;
    for (const subj of [r.item, r.unit]) {
        if (!subj) continue;
        delete subj.cropUrl;
        delete subj.levelCropUrl;
        if (subj.mainStat) delete subj.mainStat.cropUrl;
        for (const sub of subj.substats ?? []) delete sub.cropUrl;
    }
    for (const cell of r.skills ?? []) delete cell.cropUrl;
    delete r.currencyCrops;
}

/**
 * Reader-level pass with ORACLE routing: run the reader for the ground-truth screen type
 * directly (bypassing the classifier), the same way the Python prototypes were validated.
 * This isolates reader accuracy from classifier accuracy.
 */
async function oracleRead(url: string, oracle: NonNullable<ManifestEntry['oracle']>, dicts: GameDictionaries) {
    const canvas = imageToCanvas(await loadImage(url));
    const out: any = { oracle };
    if (oracle === 'item') out.item = await readItem(canvas, dicts);
    else if (oracle === 'pet' || oracle === 'mount') out.unit = await readUnit(canvas, oracle, dicts);
    else if (oracle === 'skills') out.skills = await readSkills(canvas);
    out.currencies = await readCurrencies(canvas, oracle);
    stripCrops(out);
    return out;
}

/** Diagnostic single-image dump (?debug=<manifest key>): card rect, tiles, raw OCR lines. */
async function debugOne(url: string, dicts?: GameDictionaries) {
    const canvas = imageToCanvas(await loadImage(url));
    const card = detectBrightCard(canvas);
    const tiles = findColoredTiles(canvas);
    const nameBandOrange = findColorNameBand(canvas, 'orange', 0.26);
    const nameBandPurple = findColorNameBand(canvas, 'purple', 0.26);
    let cardLines: unknown = null;
    if (card) {
        const cardCanvas = cropCanvas(canvas, card, 2); // same crop+scale as readCardText
        cardLines = await ocrPageLines(cardCanvas);
    }
    // ink-token component dump: run the item reader with the readInkValue debug hook armed
    (window as any).__INK_DEBUG__ = [];
    let itemRead: unknown = null;
    try { itemRead = await readItem(canvas, dicts); stripCrops({ item: itemRead }); } catch (e) { itemRead = String(e); }
    const inkDebug = (window as any).__INK_DEBUG__;
    (window as any).__INK_DEBUG__ = undefined;
    const skinRefinement = refineItemToSkin(canvas); // what the review hint would be, were this 'item'
    return { size: { w: canvas.width, h: canvas.height }, card, tiles, nameBandOrange, nameBandPurple, skinRefinement, cardLines, itemRead, inkDebug };
}

async function main() {
    setStatus('building dictionaries');
    const { dicts, spriteMapping } = await buildDicts();

    setStatus('loading image manifest');
    const manifest: ManifestEntry[] = await fetchJson(`${import.meta.env.BASE_URL}__harness_imgs/manifest.json`);

    const debugKey = new URLSearchParams(location.search).get('debug');
    if (debugKey) {
        const m = manifest.find(x => x.key === debugKey);
        if (!m) throw new Error(`debug key not in manifest: ${debugKey}`);
        setStatus(`debug ${m.key}`);
        window.__HARNESS_RESULTS__ = { debug: await debugOne(m.url, dicts) };
        setStatus('done');
        console.log('__HARNESS_DONE__');
        return;
    }

    const results: Record<string, any> = {};
    for (let i = 0; i < manifest.length; i++) {
        const m = manifest[i];
        setStatus(`(${i + 1}/${manifest.length}) ${m.key}`);
        const t0 = performance.now();
        try {
            // classifyScreen is also called inside readScreenshot; run it once separately too so
            // the scorer gets the NCC diagnostics (cheap relative to the OCR passes).
            const cls = await classifyScreen(m.url);
            // the review-stage hint classifyBatch would show: 'item' classifications get the
            // skin refinement (guidedSync.refineItemToSkin) — skin popups share the item header
            const refinement = cls.type === 'item' ? refineItemToSkin(imageToCanvas(await loadImage(m.url))) : null;
            const hint = refinement ? refinement.type : cls.type;
            const read = await readScreenshot(m.url, dicts);
            stripCrops(read);   // keep the payload serialisable/small
            const oracle = m.oracle ? await oracleRead(m.url, m.oracle, dicts) : undefined;
            results[m.key] = {
                set: m.set,
                classify: { type: cls.type, hint, refinement, currencies: cls.currencies, tiles: cls.tiles, confidence: cls.confidence },
                read,
                oracle,
                ms: Math.round(performance.now() - t0),
            };
        } catch (e: any) {
            results[m.key] = { set: m.set, error: String(e?.stack || e), ms: Math.round(performance.now() - t0) };
        }
    }

    window.__HARNESS_RESULTS__ = {
        configVersion: CONFIG_VERSION,
        pets: unitNameTable(spriteMapping?.pets),
        mounts: unitNameTable(spriteMapping?.mounts),
        results,
    };
    setStatus('done');
    console.log('__HARNESS_DONE__');
}

main().catch(e => {
    window.__HARNESS_ERROR__ = String(e?.stack || e);
    setStatus(`FATAL: ${e}`);
});
