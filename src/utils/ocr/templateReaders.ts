// Template-driven field readers for single-subject popups (item / pet / mount), ported from the
// validated Python prototypes:
//   proto_age.py / proto_rarity.py  -> AGE|RARITY via dominant saturated tile colour (+ tag cross-check)
//   proto_identity.py               -> item identity by icon embedding; unit identity by name dict
//   proto_mainstat.py               -> the bold "1.87b Health" / "241m Damage (ranged)" main-stat line(s)
//   proto_substats.py               -> the grey "+X% StatName" substat rows (bound-corrected)
//   proto_stars.py                  -> ascension stars (0..3)
//
// The Python protos matched substat / main-stat WORDS with Baloo-rendered NCC banks; the browser
// path instead OCRs the clean grey/black-on-white card text (tesseract reads it well here) and
// resolves stat names through the combined localization dictionaries. Numbers on the coloured
// tile (level) are read with the digit-template reader; numbers on the white card go through OCR.

import {
    cropCanvas, detectPopupTile, detectPopupCard, detectUnitTile, tileArtRect, tileLevelRect,
    detectBrightCard, findColorNameBand, findStarTiles, binarize, evidenceCropUrl, type Rect,
} from './imagePrep';
import {
    readNumber, readInkValue, SUBSTAT_VALUE_OPTS, MAINSTAT_VALUE_OPTS, type InkValueOpts,
} from './numberReader';
import { countStars } from './starCounter';
import { readWhiteLevelRow } from './skillsReader';
import { embedIcon, matchItemIcon } from './iconMatcher';
import { ocr, ocrPageLines, PSM, type PageLine } from './ocrEngine';
import { normalizeName, bestMatch, parsePercent, parseCompactNumber } from './parse';
import { parseMainStatKind, matchSubstat } from './gameDictionary';
import { AGE_COLORS, RARITY_COLORS, RARITY_NAMES, STAR, nearestColor, type RGB } from './templateParams';
import { AGES } from '../constants';
import type { GameDictionaries } from './gameLocalization';
import type { ScreenTemplate } from './templateClassifier';
import type {
    DetectedItem, DetectedUnit, MainStat, Substat, ForgeAscensionRead, ForgeStarVote,
} from './readerTypes';

// SCALE AUDIT (task #43, reverseForge/scale_probe.mjs). OCR_SCALE / LEVEL_SCALE / BAND_SCALE are
// fixed MULTIPLIERS, so the image tesseract and the glyph bank see grows with the device — unlike
// templateClassifier / currencyReader / clanTreeReader, which resample the whole frame to a
// canonical 576px first. Measured over 576 / 768 / 923 / 1290px renders of the real fixtures, every
// GEOMETRIC read is unaffected (tile colour, age/rarity, level, stars, lattices are all identical),
// and what moves is text: the stat-name string tesseract returns, and on one fixture a substat
// value. Normalising OCR_SCALE to a canonical card width was tried and MEASURED WORSE — at 923 the
// smaller card crop made tesseract lose a whole substat row — so the multipliers stand. Do not
// "fix" them without re-running that harness.
const OCR_SCALE = 2;      // upscale the card before OCR (validated: sharper small text)
const LEVEL_SCALE = 3;    // upscale the "Lv." banner before the digit reader
/** Canonical frame width every proto was calibrated at. Source-pixel quantities taken from that
 *  calibration are scaled by `src.width / CANON_W`, which is what keeps them device-independent. */
const CANON_W = 576;
const DMG_GROUP = new Set(['Weapon', 'Gloves', 'Necklace', 'Ring']);

// ---------------------------------------------------------------- colour sampling (proto_age/rarity)
function hueOf(r: number, g: number, b: number): number {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return -1;
    let h: number;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360; return h;
}

function clampRect(rect: Rect, W: number, H: number): Rect {
    const x = Math.max(0, Math.min(W - 1, Math.round(rect.x)));
    const y = Math.max(0, Math.min(H - 1, Math.round(rect.y)));
    return { x, y, w: Math.max(1, Math.min(W - x, Math.round(rect.w))), h: Math.max(1, Math.min(H - y, Math.round(rect.h))) };
}

/**
 * Median colour of the dominant saturated blob in a region — kills the white "Lv." glyphs, the
 * gold stars and anti-alias fringe, leaving the tile fill (proto_age.saturated_mean).
 */
function dominantSaturatedColor(src: HTMLCanvasElement, rect: Rect, vmin = 80, smin = 40, strict = false): RGB | null {
    const r = clampRect(rect, src.width, src.height);
    const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    let sel: number[][] = [];
    for (let i = 0; i < data.length; i += 4) {
        const R = data[i], G = data[i + 1], B = data[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        if (mx > vmin && mx - mn > smin) sel.push([R, G, B]);
    }
    if (sel.length < 8) {
        if (strict) return null; // proto saturated_mean: too few saturated px -> no sample
        sel = [];
        for (let i = 0; i < data.length; i += 4) sel.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (!sel.length) return null;
    // dominant hue via a 24-bin (15°) circular histogram, then keep pixels within ±30°
    const bins = new Array(24).fill(0);
    const hues = sel.map(p => hueOf(p[0], p[1], p[2]));
    for (const h of hues) if (h >= 0) bins[(Math.floor(h / 15)) % 24]++;
    let peakBin = 0; for (let i = 1; i < 24; i++) if (bins[i] > bins[peakBin]) peakBin = i;
    const peak = peakBin * 15 + 7.5;
    const keep = sel.filter((_, i) => { const h = hues[i]; if (h < 0) return false; let d = Math.abs(h - peak) % 360; if (d > 180) d = 360 - d; return d < 30; });
    const use = keep.length >= 8 ? keep : sel;
    const med = (ch: number): number => { const v = use.map(p => p[ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
    return [med(0), med(1), med(2)];
}

/** Sample the tile's fill above the "Lv." / star band (proto_age.sample_tile). */
function sampleTileColor(src: HTMLCanvasElement, tile: Rect): RGB | null {
    const core: Rect = { x: tile.x + 0.12 * tile.w, y: tile.y + 0.10 * tile.h, w: 0.76 * tile.w, h: 0.52 * tile.h };
    return dominantSaturatedColor(src, core) ?? dominantSaturatedColor(src, tile);
}

/** Classify a sampled fill colour to an age/rarity index. Desaturated -> index 0 (Primitive/Common).
 * Matches the validated proto_age.classify_rgb: a bright near-grey fill is Primitive/Common, else
 * NEAREST palette colour by Euclidean RGB distance. (Hue-only NN collides Underworld≈(176,120,121)
 * with Space≈(255,93,93) — both hue≈0/360 — so RGB distance is required to keep them apart.) */
function classifyColor(rgb: RGB | null, palette: RGB[]): number {
    if (!rgb) return 0;
    const mx = Math.max(rgb[0], rgb[1], rgb[2]), mn = Math.min(rgb[0], rgb[1], rgb[2]);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    if (sat < 0.16 && mn > 150) return 0;     // bright near-grey fill -> Primitive / Common
    return nearestColor(rgb, palette).idx;
}

// ---------------------------------------------------------------- card text (main stat + substats)
interface CardText { main: MainStat[]; substats: Substat[]; }

function extractNumberToken(line: string): string {
    const m = line.match(/(-?\d+(?:[.,]\d+)?)\s*([kmbtq])?/i);
    if (!m) return '';
    return m[1].replace(',', '.') + (m[2] ? m[2].toLowerCase() : '');
}

/**
 * If a value exceeds a stat's max roll it usually means OCR turned the leading "+"/"-" sign into a
 * digit ("+11.2%" -> "411.2%"). Drop leading integer digits until it fits the cap (STAT_MAX).
 */
function correctByBound(v: number, max: number): number {
    if (Math.abs(v) <= max * 1.2) return v;
    const neg = v < 0;
    const [ip, fp = ''] = Math.abs(v).toString().split('.');
    let ipc = ip;
    while (ipc.length > 1 && parseFloat(ipc + (fp ? '.' + fp : '')) > max * 1.2) ipc = ipc.slice(1);
    const c = parseFloat(ipc + (fp ? '.' + fp : ''));
    return isNaN(c) ? v : (neg ? -c : c);
}

// ---- value-token reading via the digit-template bank (measured winner, reader_bank_v2) ----
// tesseract still finds the LINES and reads the stat NAMES (validated 48/51 in TS); only the
// numeric value token is re-read with the dark-ink glyph pipeline (Python: substats 25/26,
// mainstat 18/18 vs tesseract's frequent sign/percent misreads).

/** Ink band of one tesseract line: the line bbox supplies only the Y-band (±3 canonical px,
 * proto_substats._ink_region); X always spans TILE_X..card-right. Tesseract regularly starts a
 * line's bbox mid-token (".1% Critical Damage" for "+75.1% "), so trusting its x-extent used
 * to clip the leading "+7" off the value word — the proto never did, it row-projected the full
 * card width right of the tile. */
function lineRectOnSource(src: HTMLCanvasElement, card: Rect, l: PageLine): Rect {
    const m = Math.max(2, Math.round(3 * src.width / CANON_W));
    const x0 = card.x + TILE_X * card.w;
    return clampRect({
        x: x0,
        y: card.y + l.y0 / OCR_SCALE - m,
        w: card.x + card.w - x0,
        h: (l.y1 - l.y0) / OCR_SCALE + 2 * m,
    }, src.width, src.height);
}

/** First ink token of a line: column-project the dark-ink mask and split the value word from
 * the stat name at the first >= gapPx zero-run (proto_substats.split_value_name). */
function firstInkToken(src: HTMLCanvasElement, rect: Rect, opts: InkValueOpts, gapPx: number): Rect | null {
    const r = clampRect(rect, src.width, src.height);
    const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    const cols = new Int32Array(r.w);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        const mn = Math.min(R, G, B), mx = Math.max(R, G, B);
        if (mx - mn < opts.satMax && ((mn + mx) >> 1) < opts.brMax) cols[x]++;
    }
    let x0t = -1, x1t = -1;
    for (let x = 0; x < r.w; x++) if (cols[x] > 0) { if (x0t < 0) x0t = x; x1t = x; }
    if (x0t < 0) return null;
    let run = 0, gap = -1;
    for (let x = x0t; x <= x1t; x++) {
        if (cols[x] === 0) { run++; if (run >= gapPx) { gap = x - run + 1; break; } }
        else run = 0;
    }
    const end = gap < 0 ? x1t + 1 : gap;
    return { x: r.x + x0t, y: r.y, w: end - x0t, h: r.h };
}

// Main stat + substats live RIGHT of the equipment tile (proto_substats / proto_mainstat
// TILE_X = 0.27 of the card width). Tesseract merges the tile's own "Lv.NNN" overlay into these
// lines, so without this clamp the leftmost "value token" is the tile text, not the number.
const TILE_X = 0.27;

/** Re-read one line's value token with the glyph bank -> raw string over opts.chars ('' = none). */
async function readValueToken(
    src: HTMLCanvasElement, card: Rect, l: PageLine, opts: InkValueOpts, gapPx: number,
): Promise<string> {
    try {
        const r = lineRectOnSource(src, card, l);
        if (r.w < 2) return '';
        const tok = firstInkToken(src, r, opts, gapPx);
        if (!tok || tok.w < 2 || tok.h < 2) return '';
        const dbg: any[] | undefined = (globalThis as any).__INK_DEBUG__;
        if (dbg) dbg.push({ line: l.text, lineBox: [l.x0, l.y0, l.x1, l.y1], card, rect: r, tok, gapPx });
        return await readInkValue(cropCanvas(src, tok), opts);
    } catch { return ''; }
}

/** Substat glyph string -> percent number, null if unusable (kept: substat rows are always %). */
function parseSubstatRaw(raw: string): number | null {
    let num = '', dot = false;
    for (const ch of raw) {
        if (ch >= '0' && ch <= '9') num += ch;
        else if (ch === '.' && !dot && num) { num += '.'; dot = true; }
        else if ('kmb'.includes(ch)) return null; // magnitude suffix on a % row -> distrust the read
    }
    return num ? parseFloat(num) : null;
}

/** Main-stat glyph string -> canonical '<digits>[.<digits>][kmb]' token, or null. */
function parseMainRaw(raw: string): string | null {
    let num = '', dot = false, suf = '';
    for (const ch of raw) {
        if (ch >= '0' && ch <= '9') num += ch;
        else if (ch === '.' && !dot && num) { num += '.'; dot = true; }
        else if ('kmb'.includes(ch) && num) { suf = ch; break; }
    }
    return num ? num + suf : null;
}

async function readCardText(src: HTMLCanvasElement, dicts?: GameDictionaries): Promise<CardText> {
    // Full popup card via the proto find_card port (the brightness-band heuristic clips the card
    // to the substat rows on pet/mount screens, losing the main-stat lines above them).
    const card = detectPopupCard(src) ?? detectBrightCard(src) ?? { x: 0, y: 0, w: src.width, h: src.height };
    const cardRect = clampRect(card, src.width, src.height);
    const cardCanvas = cropCanvas(src, cardRect, OCR_SCALE);
    let lines: PageLine[] = [];
    try { lines = await ocrPageLines(cardCanvas); } catch { lines = []; }

    const main: MainStat[] = [];
    const substats: Substat[] = [];
    for (const l of lines) {
        const text = l.text.trim();
        if (!text) continue;
        const pct = parsePercent(text);
        if (pct !== null) {
            // substat row: "+X% StatName" — name from tesseract, value from the glyph bank
            const label = text.replace(/[+\-]?\d+(?:\.\d+)?\s*%/, '').trim();
            let statId: string | null = null;
            if (dicts) {
                statId = dicts.substats.get(normalizeName(label)) ?? null;
                if (!statId) { const fm = matchSubstat(label, dicts.substats, 0.55); statId = fm ? fm.value : null; }
            }
            const gapPx = Math.max(3, Math.round(5 * src.width / CANON_W)); // 5px word gap @576w canonical
            const bankRaw = await readValueToken(src, cardRect, l, SUBSTAT_VALUE_OPTS, gapPx);
            let value = parseSubstatRaw(bankRaw) ?? pct;
            if (statId && dicts?.statMax.has(statId)) value = correctByBound(value, dicts.statMax.get(statId)!);
            // evidence crop of the whole line band ("+X% StatName") for the diff modal
            const cropUrl = evidenceCropUrl(src, lineRectOnSource(src, cardRect, l));
            substats.push({ statId, name: label, value, percent: true, raw: bankRaw || text, cropUrl });
            continue;
        }
        if (/total/i.test(text) || /upgrade|remove/i.test(text)) continue;
        if (!/\d/.test(text)) continue;
        const kind = parseMainStatKind(text);
        if (kind) {
            // word gap: max(14, 0.35*bandh*4) @4x canonical (proto_mainstat._word_groups) -> 1x source px
            const bandH = (l.y1 - l.y0) / OCR_SCALE;
            const gapPx = Math.max(Math.round(3.5 * src.width / CANON_W), Math.round(0.35 * bandH), 3);
            const bankRaw = await readValueToken(src, cardRect, l, MAINSTAT_VALUE_OPTS, gapPx);
            const canon = parseMainRaw(bankRaw);
            main.push({
                kind: kind.kind,
                value: (canon !== null ? parseCompactNumber(canon) : parseCompactNumber(text)) ?? 0,
                valueRaw: canon ?? extractNumberToken(text),
                ranged: kind.ranged,
                // evidence crop of the whole main-stat line for the diff modal
                cropUrl: evidenceCropUrl(src, lineRectOnSource(src, cardRect, l)),
            });
        }
    }
    return { main, substats };
}

// ---------------------------------------------------------------- shared level + tag helpers
async function readTileLevel(src: HTMLCanvasElement, tile: Rect): Promise<number | null> {
    try { return (await readNumber(cropCanvas(src, tileLevelRect(tile), LEVEL_SCALE))).value; }
    catch { return null; }
}

// ---------------------------------------------------------------- coloured "[tag] Name" header
const BAND_SCALE = 4;      // upscale factor for the header-band crops before OCR
const BAND_GOOD = 0.82;    // candidate score that ends the search (a confident dictionary hit)

/** Row/column ink profiles of a window, counting only COLOURED pixels (optionally hue-gated).
 * Thresholds are deliberately low so the anti-alias fringe counts too — this is what defines
 * the true extent of the glyphs, independent of screenshot resolution. */
function colorInkProfile(
    src: HTMLCanvasElement, win: Rect, hue: number | null,
): { rows: Int32Array; cols: Int32Array; win: Rect } {
    const r = clampRect(win, src.width, src.height);
    const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    const rows = new Int32Array(r.h), cols = new Int32Array(r.w);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        if (mx <= 70 || mx - mn <= 22) continue;
        if (hue !== null) { const h = hueOf(R, G, B); if (h < 0 || hueDist(h, hue) > 45) continue; }
        rows[y]++; cols[x]++;
    }
    return { rows, cols, win: r };
}

/** Dominant hue of a band's coloured ink, or null when it holds no saturated pixels. */
function bandHue(src: HTMLCanvasElement, rect: Rect): number | null {
    const rgb = dominantSaturatedColor(src, rect, 80, 30, true);
    if (!rgb) return null;
    const h = hueOf(rgb[0], rgb[1], rgb[2]);
    return h < 0 ? null : h;
}

/** First/last index whose value clears `gate`, expanding from `seed` and tolerating 2-px gaps.
 * Used on ROW profiles, where a text line is one run and the neighbouring lines must stay out. */
function inkExtent(prof: Int32Array, seed: number, gate: number): [number, number] {
    let a = seed, b = seed;
    while (a > 0 && (prof[a - 1] >= gate || (a > 1 && prof[a - 2] >= gate))) a--;
    while (b < prof.length - 1 && (prof[b + 1] >= gate || (b < prof.length - 2 && prof[b + 2] >= gate))) b++;
    return [a, b];
}

/** Outermost indices clearing `gate` — for COLUMN profiles, where the inter-word gaps of a
 * header line are many pixels wide and a run-based extent would keep a single glyph. */
function globalExtent(prof: Int32Array, gate: number): [number, number] {
    let a = -1, b = -1;
    for (let i = 0; i < prof.length; i++) if (prof[i] >= gate) { if (a < 0) a = i; b = i; }
    return a < 0 ? [0, prof.length - 1] : [a, b];
}

/**
 * Grow a name band to the FULL extent of its coloured ink, then pad.
 * findColorNameBand keeps only rows above 25% of the row-count PEAK, which on a header line is
 * the x-height: the tops of "[", "M", "B", "D" and any descender fall outside. At 576px that
 * clipped ~2px and tesseract coped; on a 923px-wide iPhone shot it clips ~5px of every cap and
 * the read degrades to garbage ("VIVENIGIIBabVvID aqon"). Deriving the band from the ink itself
 * is resolution-independent.
 */
function growBandToInk(src: HTMLCanvasElement, band: Rect, hue: number | null): Rect {
    const win = clampRect({
        x: band.x - 0.06 * band.w, y: band.y - band.h,
        w: 1.12 * band.w, h: 3 * band.h,
    }, src.width, src.height);
    const p = colorInkProfile(src, win, hue);
    let peak = 0, peakRow = 0;
    for (let y = 0; y < p.rows.length; y++) if (p.rows[y] > peak) { peak = p.rows[y]; peakRow = y; }
    if (peak < 2) return band;
    const [ry0, ry1] = inkExtent(p.rows, peakRow, Math.max(1, Math.round(0.06 * peak)));
    // x-extent from the KEPT ROWS only, so ink from the lines above/below can't widen the band
    const q = colorInkProfile(src, { x: p.win.x, y: p.win.y + ry0, w: p.win.w, h: ry1 - ry0 + 1 }, hue);
    let cPeak = 0;
    for (const v of q.cols) if (v > cPeak) cPeak = v;
    const [cx0, cx1] = globalExtent(q.cols, Math.max(1, Math.round(0.08 * cPeak)));
    const padY = Math.max(2, Math.round(0.20 * (ry1 - ry0 + 1)));
    const padX = Math.max(3, Math.round(0.06 * (cx1 - cx0 + 1)));
    return clampRect({
        x: q.win.x + cx0 - padX, y: p.win.y + ry0 - padY,
        w: (cx1 - cx0 + 1) + 2 * padX, h: (ry1 - ry0 + 1) + 2 * padY,
    }, src.width, src.height);
}

/**
 * Topmost coloured text line inside the popup card, whatever its hue — the rarity/age palette
 * spans magenta, red, yellow, green, cyan and white, and the two hard-coded orange/purple
 * predicates only cover items and Mythic units. Returns the band and its dominant hue.
 */
function detectNameBandGeneric(src: HTMLCanvasElement, card: Rect): { rect: Rect; hue: number | null } | null {
    const win = clampRect({
        x: card.x + 0.26 * card.w, y: card.y,
        w: 0.73 * card.w, h: 0.42 * card.h,
    }, src.width, src.height);
    if (win.w < 16 || win.h < 8) return null;
    const p = colorInkProfile(src, win, null);
    let peak = 0;
    for (const v of p.rows) if (v > peak) peak = v;
    if (peak < Math.max(4, 0.02 * win.w)) return null;
    const gate = Math.max(3, 0.30 * peak);
    let seed = -1;
    for (let y = 0; y < p.rows.length; y++) if (p.rows[y] >= gate) { seed = y; break; }
    if (seed < 0) return null;
    const [ry0, ry1] = inkExtent(p.rows, seed, Math.max(1, Math.round(0.10 * peak)));
    const rect = clampRect({ x: win.x, y: win.y + ry0, w: win.w, h: ry1 - ry0 + 1 }, src.width, src.height);
    const hue = bandHue(src, rect);
    // re-tighten with the hue known (drops any neighbouring UI colour caught by the hue-blind pass)
    return { rect: growBandToInk(src, rect, hue), hue };
}

/**
 * Colour-keyed crop: coloured ink -> dark, everything else -> white, upscaled.
 * The card is white and the header text is a light rarity hue, so tesseract's own binarization
 * has almost no contrast to work with; keying on CHROMA instead of luminance gives it clean
 * black-on-white glyphs with the anti-alias fringe preserved as grey.
 */
function colorKeyCrop(src: HTMLCanvasElement, rect: Rect, hue: number | null, scale: number): HTMLCanvasElement {
    const r = clampRect(rect, src.width, src.height);
    const img = src.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx - mn;
        let on = mx > 60 && sat > 14;
        if (on && hue !== null) { const h = hueOf(R, G, B); on = h >= 0 && hueDist(h, hue) <= 45; }
        const a = on ? Math.min(1, (sat - 12) / 46) : 0;
        const v = 255 - Math.round(255 * a);
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    const flat = document.createElement('canvas');
    flat.width = r.w; flat.height = r.h;
    flat.getContext('2d', { willReadFrequently: true })!.putImageData(img, 0, 0);
    return cropCanvas(flat, { x: 0, y: 0, w: r.w, h: r.h }, scale);
}

/** Fallback candidate score when no dictionary is available: letter density, junk-penalised. */
function textPlausibility(t: string): number {
    const letters = (t.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3) return 0;
    const junk = (t.match(/[^A-Za-z0-9[\]\s.'&-]/g) ?? []).length;
    return Math.max(0, Math.min(0.6, (letters - junk) / Math.max(1, t.length)));
}

/**
 * OCR the coloured "[age|rarity] Name" header band -> the best raw text (empty when no band).
 * Several crops of the band are tried in cheapest-first order and scored by the caller (a
 * dictionary hit is the only trustworthy judge of an OCR'd proper noun); the search stops early
 * on a confident hit, so bands that already read fine cost exactly one OCR pass as before.
 */
async function readNameBand(
    src: HTMLCanvasElement, want: 'orange' | 'purple', score: (t: string) => number = textPlausibility,
): Promise<string> {
    // cheapest first, and every crop is built lazily — a band that already reads well costs the
    // single OCR pass it always did
    const cands: { label: string; make: () => HTMLCanvasElement | null }[] = [];
    const colored = findColorNameBand(src, want, 0.26);
    if (colored) {
        const hue = bandHue(src, colored);
        cands.push({ label: 'plain', make: () => cropCanvas(src, colored, BAND_SCALE) });
        cands.push({ label: 'key', make: () => colorKeyCrop(src, growBandToInk(src, colored, hue), hue, BAND_SCALE) });
        cands.push({ label: 'grown', make: () => cropCanvas(src, growBandToInk(src, colored, hue), BAND_SCALE) });
        cands.push({ label: 'bin', make: () => binarize(cropCanvas(src, colored, BAND_SCALE), { autoInvert: true }) });
    }
    cands.push({
        label: 'generic', make: () => {
            const card = detectPopupCard(src) ?? detectBrightCard(src);
            const gen = card ? detectNameBandGeneric(src, card) : null;
            return gen ? colorKeyCrop(src, gen.rect, gen.hue, BAND_SCALE) : null;
        },
    });

    const dbg: any[] | undefined = (globalThis as any).__BAND_DEBUG__;
    let best = { text: '', score: 0 };
    for (const c of cands) {
        let text = '';
        try {
            const crop = c.make();
            if (!crop) continue;
            text = (await ocr(crop, { psm: PSM.SINGLE_LINE })).text.trim();
        } catch { continue; }
        const s = text ? score(text) : 0;
        if (dbg) dbg.push({ label: c.label, text, score: s });
        if (s > best.score || (!best.text && text)) best = { text, score: s };
        if (best.score >= BAND_GOOD) break;
    }
    return best.text;
}

/** Longest AGE word present in the tag text -> age index, or -1. */
function ageFromTag(text: string): number {
    if (!text) return -1;
    const t = text.toLowerCase().replace(/[^a-z]/g, '');
    const cand = AGES.map((a, i) => ({ a: a.toLowerCase().replace(/[^a-z]/g, ''), i })).sort((x, y) => y.a.length - x.a.length);
    for (const { a, i } of cand) if (a && t.includes(a)) return i;
    return -1;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// ---------------------------------------------------------------- public: item
export async function readItem(src: HTMLCanvasElement, dicts?: GameDictionaries): Promise<DetectedItem> {
    const tile = detectPopupTile(src);
    const card = await readCardText(src, dicts);
    const mainStat = card.main[0];
    const group: 'damage' | 'health' | undefined = mainStat?.kind;

    if (!tile) {
        return { ageIdx: 0, age: AGES[0], level: null, stars: 0, mainStat, substats: card.substats, confidence: 0 };
    }

    // AGE — tile fill colour (primary), cross-checked against the "[Age]" tag word.
    const tileRgb = sampleTileColor(src, tile);
    const ageIdx = classifyColor(tileRgb, AGE_COLORS);
    // an "[Age]" word IS the whole point of this band, so score candidates on finding one
    const tagText = await readNameBand(src, 'orange', t => (ageFromTag(t) >= 0 ? 1 : 0.4 * textPlausibility(t)));
    const tagAge = ageFromTag(tagText);
    const tagAgree = tagAge < 0 || tagAge === ageIdx;

    const level = await readTileLevel(src, tile);
    const levelCropUrl = evidenceCropUrl(src, tileLevelRect(tile)); // evidence of the "Lv." band
    // ITEM tiles use the narrowed star band (readItemTileStars): on a gold Divine/Modern tile the
    // full-height band counts the hole in the "0" of "Lv.102" as a star, so a 0-ascension item
    // read 1. Pets/mounts/skins keep countStars' validated default band.
    const stars = readItemTileStars(src, tile);

    // IDENTITY — embed the tile art, cosine-match narrowed to age (+ damage/health group).
    let name: string | undefined, slot: string | undefined, itemKey: string | undefined, iconScore = 0;
    try {
        const emb = await embedIcon(cropCanvas(src, tileArtRect(tile)));
        const matches = await matchItemIcon(emb, { age: ageIdx, group });
        const top = matches[0];
        if (top) {
            name = top.row.name; slot = top.row.slot; iconScore = top.score;
            itemKey = `${top.row.age}_${top.row.slot}_${top.row.idx}`;
        }
    } catch { /* embedding unavailable -> identity stays undefined */ }

    const cropUrl = cropCanvas(src, clampRect(tile, src.width, src.height)).toDataURL();
    const confidence = clamp01((iconScore > 0 ? iconScore : 0.2) * (tagAgree ? 1 : 0.85));

    return { ageIdx, age: AGES[ageIdx] ?? AGES[0], slot, itemKey, name, level, stars, mainStat, substats: card.substats, cropUrl, levelCropUrl, confidence };
}

// ---------------------------------------------------------------- public: pet / mount (shared layout)
/** Hue of the reference rarity palette entries 1..5 (proto_rarity.PAL_HUE; Common is grey). */
function hueDist(a: number, b: number): number { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }

/** proto_rarity.classify_rgb: desaturated -> Common, else nearest PALETTE HUE (dim-robust:
 * a darkened purple keeps its hue while its RGB point drifts toward other palette rows). */
function classifyRarityHue(rgb: RGB | null): number {
    if (!rgb) return 0;
    const mx = Math.max(rgb[0], rgb[1], rgb[2]);
    const sat = mx > 0 ? (mx - Math.min(rgb[0], rgb[1], rgb[2])) / mx : 0;
    if (sat < 0.20) return 0;                       // desaturated -> Common
    const h = hueOf(rgb[0], rgb[1], rgb[2]);
    if (h < 0) return 0;
    let best = 1, bd = Infinity;
    for (let i = 1; i < RARITY_COLORS.length; i++) {
        const ph = hueOf(RARITY_COLORS[i][0], RARITY_COLORS[i][1], RARITY_COLORS[i][2]);
        const d = hueDist(h, ph);
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

export async function readUnit(src: HTMLCanvasElement, kind: 'pet' | 'mount', dicts?: GameDictionaries): Promise<DetectedUnit> {
    const tile = detectUnitTile(src);
    const card = await readCardText(src, dicts);
    const mainStat = card.main[0];

    // RARITY — proto_rarity.popup_rarity: dominant saturated colour of the card HEADER BAND
    // (tile + "[Rarity] Name" text share the rarity colour), classified by HUE. Falls back to
    // the tile fill when no card is found.
    const popupCard = detectPopupCard(src);
    let headerRgb: RGB | null = null;
    if (popupCard) {
        const band: Rect = {
            x: popupCard.x + 0.02 * popupCard.w, y: popupCard.y + 0.01 * popupCard.h,
            w: 0.70 * popupCard.w, h: 0.10 * popupCard.h,
        };
        headerRgb = dominantSaturatedColor(src, band, 90, 40, true);
    }
    const tileRgb = headerRgb ?? (tile ? sampleTileColor(src, tile) : null);
    const rarityIdx = classifyRarityHue(tileRgb);
    const rarity = RARITY_NAMES[rarityIdx] ?? RARITY_NAMES[0];

    // the pet / mount dictionary is the only reliable judge of an OCR'd proper noun, so it also
    // picks WHICH header-band crop to believe (a clipped band reads as garbage that still parses)
    const dict = kind === 'pet' ? dicts?.pets : dicts?.mounts;
    const tagText = await readNameBand(src, 'purple', t => {
        if (!dict || !dict.size) return textPlausibility(t);
        const m = bestMatch(t, dict, 0);
        return m ? m.score : 0;
    });
    let rarityAgree = true;
    if (dicts && tagText) {
        // NOTE: the tag word must be looked up on the RAW text — normalizeName() deletes rarity
        // words by design, so tokenising its output could never find one.
        let tagRarity: string | null = null;
        for (const w of tagText.toLowerCase().split(/[^a-z]+/)) { const r = w && dicts.rarities.get(w); if (r) { tagRarity = r; break; } }
        if (tagRarity) rarityAgree = tagRarity.toLowerCase() === rarity.toLowerCase();
    }

    // IDENTITY — match the header name against the pet / mount dictionary, NARROWED to the
    // detected rarity first: unit names are short, so a name absent from the dictionary is
    // routinely ~0.5-similar to an unrelated one ("Goat" -> "Cat") and a bare fuzzy match would
    // write the wrong preset. The full dictionary is consulted only at a stricter threshold, so a
    // misread rarity still resolves.
    let name: string | undefined, id: number | undefined, nameScore = 0;
    if (tagText) {
        // strip a leading rarity word for a cleaner display name
        name = tagText.replace(new RegExp(`^\\s*\\[?\\s*(${RARITY_NAMES.join('|')})\\s*\\]?\\s*`, 'i'), '').trim() || tagText;
        if (dict && dict.size) {
            const sameRarity = new Map([...dict].filter(([, v]) => v.rarity.toLowerCase() === rarity.toLowerCase()));
            const m = bestMatch(tagText, sameRarity, 0.4) ?? bestMatch(tagText, dict, 0.62);
            if (m) { id = m.value.id; nameScore = m.score; }
        }
    }

    // LEVEL — the unit tile overlays "Equipped" + "Lv. NN" + a star; a fixed bottom band cuts
    // through them, so read the pure-white text rows and pick the 'Lv'+digits one (the same
    // row-selection proto_skills validated on the identically-overlaid skill cells).
    let level: number | null = null;
    let levelCropUrl: string | undefined;
    if (tile) {
        const band: Rect = clampRect({
            x: tile.x - 0.05 * tile.w, y: tile.y + 0.40 * tile.h,
            w: 1.10 * tile.w, h: 0.68 * tile.h,
        }, src.width, src.height);
        try { level = await readWhiteLevelRow(cropCanvas(src, band)); } catch { level = null; }
        levelCropUrl = evidenceCropUrl(src, band); // evidence of the overlay band the level came from
    }
    const stars = tile ? countStars(src, tile) : 0;
    const cropUrl = tile ? cropCanvas(src, clampRect(tile, src.width, src.height)).toDataURL() : undefined;
    const confidence = clamp01((nameScore > 0 ? nameScore : 0.3) * (rarityAgree ? 1 : 0.85));

    return { kind, rarityIdx, rarity, id, name, level, stars, mainStat, substats: card.substats, cropUrl, levelCropUrl, confidence };
}

// =============================================================================================
// FORGE ASCENSION — the ascension shared by every equipped item IS the forge's ascension, and it
// is read from the STARS ON THE ITEM TILES, never from the anvil sprite (owner's rule, stated
// twice). Because every equipped item carries the same stars, the answer is a CONSENSUS over the
// item tiles a screenshot exposes: one misread tile must not move it. Nothing here uses a pixel
// literal — the tile size, the lattice and the star band are all fractions of what the image
// itself yielded.
// =============================================================================================

/**
 * Star-band window for an ITEM tile, as fractions of that tile's own rect.
 *
 * Measured on every real fixture (reverseForge/fixtures/forge/*, 0..3 stars, bright and dimmed):
 * a genuine ascension star's enclosed gold pocket sits at fy 0.908..0.957 of the tile height and
 * fx 0.388..0.651 of its width — always the bottom edge, always centred. What fakes a star is the
 * COUNTER of a white "Lv.NNN" glyph on a gold Divine/Modern tile: the hole in a "0" shows the gold
 * fill through it, so it is an enclosed, saturated, roughly-square pocket too. On a tile with NO
 * stars those measured at fy <= 0.664 (the "0" of "Lv.107" sat at fy 0.567). With any star present
 * countStars' bottom-row clustering already discarded them, so the failure only ever appeared as
 * 0 stars read as 1 — exactly the case a consensus cannot fix, because on an all-Divine profile
 * EVERY tile fakes the same phantom star.
 *
 * So the band keeps the whole star and starts below the glyph counters: fy 0.72..1.20. It must not
 * start any lower — a first attempt at 0.80 cut the top of the star's own dark OUTLINE, the flood
 * fill then reached the pocket from above, and every real star vanished (measured: 1- and 2-star
 * cards read 0). The sides are trimmed to fx 0.15..0.85, which drops the outermost "Lv." glyphs
 * without clipping the outer star of a 3-star cluster (widest measured span 0.329..0.710).
 *
 * countStars expands the rect it is handed by STAR.bandX0..X1 (-0.06..1.06) and
 * STAR.bandY0..Y1 (0.40..1.30), so the rect below is solved BACKWARDS from that window.
 */
const ITEM_STAR_WINDOW = { x0: 0.15, x1: 0.85, y0: 0.72, y1: 1.20 };

/** The rect to hand countStars so that its own band lands on ITEM_STAR_WINDOW of `tile`. */
function itemStarRect(tile: Rect): Rect {
    const winW = (ITEM_STAR_WINDOW.x1 - ITEM_STAR_WINDOW.x0) * tile.w;
    const winH = (ITEM_STAR_WINDOW.y1 - ITEM_STAR_WINDOW.y0) * tile.h;
    const w = winW / (STAR.bandX1 - STAR.bandX0);   // /1.12
    const h = winH / (STAR.bandY1 - STAR.bandY0);   // /0.90
    return {
        x: Math.round(tile.x + ITEM_STAR_WINDOW.x0 * tile.w - STAR.bandX0 * w),
        y: Math.round(tile.y + ITEM_STAR_WINDOW.y0 * tile.h - STAR.bandY0 * h),
        // no size floor: countStars already refuses a band under 4 px, which is the only case a
        // floor here could rescue, and a floor would be the one pixel literal in this file
        w: Math.round(w), h: Math.round(h),
    };
}

/** Ascension stars on an ITEM tile (0..3), read from the narrowed band above. */
export function readItemTileStars(src: HTMLCanvasElement, tile: Rect): number {
    try { return countStars(src, itemStarRect(tile)); } catch { return 0; }
}

/** The "Lv.NNN + stars" band of an item tile — the evidence crop the modal shows. Includes the
 *  level text on purpose: the owner's rule is that a crop must let you recognise what was read. */
function itemLevelStarBand(tile: Rect): Rect {
    return {
        x: Math.round(tile.x), y: Math.round(tile.y + 0.55 * tile.h),
        w: Math.round(tile.w), h: Math.round(0.63 * tile.h),
    };
}

// ---- item-tile lattice ------------------------------------------------------------------------
// A player profile card lays the 8 equipment slots out as a grid, with the (WIDE) mount tile at
// the end of the last item row and the smaller skill/pet tiles in the rows below:
//     [item][item][item][item][item]
//     [item][item][item][   mount   ]
//     (skill)(skill)(skill) [pet][pet][pet]
// Measured at 576 px wide: item tiles 66-67 px, mount 151x74 (aspect 2.04), skills 43, pets 38.
// So the item block is separated by ASPECT (the mount) and by SIZE (skills/pets), both relative to
// the tile size the image itself produced — never by a coordinate.
const LATTICE = {
    arLo: 0.72, arHi: 1.30,   // tile bbox aspect: items measured 0.83..1.09, the mount tile 2.04
    sizeTol: 0.18,            // block member: width within this fraction of the block's modal width
    rowTol: 0.35,             // same row when the tops differ by less than this * modal width
    rowGap: 2.0,              // a gap over this * modal width between row tops ends the block
    minBlock: 3,              // fewer same-size square tiles than this -> no lattice, no guess
};
/** The game has 8 equipment slots, so a card can never show more than 8 item tiles. Not a pixel
 *  constant — a game rule (mirrors ITEM_SLOTS in autoSync.ts). */
const ITEM_SLOT_COUNT = 8;

function medianOf(xs: number[]): number {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface ItemLattice {
    tiles: { rect: Rect; row: number; col: number }[];
    tileW: number; tileH: number; rows: number; cols: number;
}

/**
 * Derive the equipment-tile lattice of a player profile card and return one CANONICAL rect per
 * detected item tile.
 *
 * Canonical, not the raw blob box, is the point: the chroma blobs fragment badly (a slot badge
 * overlapping the corner, the Divine shimmer, a tile with no stars being 5 px shorter than one
 * with them), and a fragment's own box puts the star band in the wrong place — that alone turned
 * a real 0-star tile into "1 star". Every kept tile is re-expressed as
 * (column centre, row top, modal size), so all tiles of a card share one geometry.
 */
export function detectItemLattice(src: HTMLCanvasElement): ItemLattice | null {
    const cands = findStarTiles(src).filter(t => {
        const ar = t.w / Math.max(1, t.h);
        return ar >= LATTICE.arLo && ar <= LATTICE.arHi;
    });
    if (cands.length < LATTICE.minBlock) return null;

    // Modal tile size: for each candidate, the set of candidates within sizeTol of its width. The
    // item block is the LARGEST-median such set that still has minBlock members — item tiles are
    // always bigger than the skill/pet tiles beneath them, and the mount is already gone on aspect.
    let best: { med: number; n: number } | null = null;
    for (const c of cands) {
        const bucket = cands.filter(o => Math.abs(o.w - c.w) <= LATTICE.sizeTol * Math.max(o.w, c.w));
        if (bucket.length < LATTICE.minBlock) continue;
        const med = medianOf(bucket.map(b => b.w));
        if (!best || med > best.med || (med === best.med && bucket.length > best.n)) {
            best = { med, n: bucket.length };
        }
    }
    if (!best) return null;
    const tileW = best.med;
    const block = cands.filter(t => Math.abs(t.w - tileW) <= LATTICE.sizeTol * tileW);
    if (block.length < LATTICE.minBlock) return null;

    // rows by TOP edge (stable across fragments: a fragment keeps the tile's top, not its centre).
    // Membership is measured against the row's FIRST (topmost) member, never a running mean, so a
    // chain of near-misses cannot drag one row into the next.
    const tol = LATTICE.rowTol * tileW;
    const sorted = block.slice().sort((a, b) => a.y - b.y);
    const groups: Rect[][] = [];
    for (const t of sorted) {
        const g = groups[groups.length - 1];
        if (g && Math.abs(t.y - g[0].y) <= tol) g.push(t);
        else groups.push([t]);
    }
    // keep the longest run of rows not separated by more than rowGap tile widths: a stray
    // same-sized blob far above or below (the card's close button measured 72x71) forms its own
    // run and loses on tile count.
    const runs: Rect[][][] = [];
    for (let i = 0; i < groups.length; i++) {
        const prev = groups[i - 1];
        const gap = prev ? medianOf(groups[i].map(t => t.y)) - medianOf(prev.map(t => t.y)) : 0;
        if (!prev || gap > LATTICE.rowGap * tileW) runs.push([groups[i]]);
        else runs[runs.length - 1].push(groups[i]);
    }
    const count = (r: Rect[][]) => r.reduce((a, g) => a + g.length, 0);
    const run = runs.reduce((b, r) => (count(r) > count(b) ? r : b), runs[0]);
    // tile HEIGHT from the kept run only — a stray same-width blob elsewhere on the card (the
    // close button) must not drag the height the star band is measured against.
    const tileH = medianOf(run.flat().map(t => t.h));

    const tiles: { rect: Rect; row: number; col: number }[] = [];
    const seen = new Set<string>();
    let taken = 0;
    for (let ri = 0; ri < run.length && taken < ITEM_SLOT_COUNT; ri++) {
        const top = Math.round(medianOf(run[ri].map(t => t.y)));
        const cols = run[ri].slice().sort((a, b) => a.x - b.x);
        // columns of this row, clustered on the x-CENTRE (same first-member rule as the rows) so a
        // fragment of one tile cannot become a column of its own next to the tile it belongs to
        const centres: number[][] = [];
        for (const t of cols) {
            const cx = t.x + t.w / 2;
            const g = centres[centres.length - 1];
            if (g && Math.abs(cx - g[0]) <= tol) g.push(cx);
            else centres.push([cx]);
        }
        for (let ci = 0; ci < centres.length && taken < ITEM_SLOT_COUNT; ci++) {
            const cx = medianOf(centres[ci]);
            const rect: Rect = {
                x: Math.round(cx - tileW / 2), y: top,
                w: Math.round(tileW), h: Math.round(tileH),
            };
            const key = `${rect.x},${rect.y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            tiles.push({ rect, row: ri, col: ci });
            taken++;
        }
    }
    if (!tiles.length) return null;
    return {
        tiles, tileW: Math.round(tileW), tileH: Math.round(tileH),
        rows: new Set(tiles.map(t => t.row)).size,
        cols: Math.max(...tiles.map(t => t.col)) + 1,
    };
}

/** Up to `max` "Lv.NNN + stars" bands drawn side by side — the evidence for a consensus vote. */
function starStripUrl(src: HTMLCanvasElement, votes: ForgeStarVote[], max = 3): string | undefined {
    const use = votes.slice(0, max);
    if (!use.length) return undefined;
    const bands = use.map(v => clampRect(itemLevelStarBand(v.rect), src.width, src.height));
    const gap = Math.max(1, Math.round(0.03 * bands[0].w));
    const h = Math.max(...bands.map(b => b.h));
    const w = bands.reduce((a, b) => a + b.w, 0) + gap * (bands.length - 1);
    if (w < 2 || h < 2) return undefined;
    const strip = document.createElement('canvas');
    strip.width = w; strip.height = h;
    const ctx = strip.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    let x = 0;
    for (const b of bands) {
        ctx.drawImage(src, b.x, b.y, b.w, b.h, x, 0, b.w, b.h);
        x += b.w + gap;
    }
    return evidenceCropUrl(strip, { x: 0, y: 0, w, h }, 360);
}

/**
 * Read the forge's ascension from the item tiles of one screenshot.
 *
 * Only two templates are allowed to produce a reading, because only those two are known to show
 * ITEM tiles. Every other screen is refused outright — a pet or skills grid is a lattice of
 * identically-sized tiles carrying THEIR OWN ascension stars (measured: the tester's pet grid is
 * 5x2 of 111 px tiles at 2 stars while that account's items are at 1), so letting the lattice run
 * there would report the pet ascension as the forge's.
 *  - 'item'  — the user's own item popup. The popup tile is the subject of the shot, so it votes,
 *              and the read is AUTHORITATIVE. A batch of item popups therefore votes once per
 *              screenshot, which is where the consensus comes from in normal use.
 *  - 'enemy' — a player profile card, showing all 8 equipment slots at once. It is read because it
 *              is the only place 2 and 3 stars appear at all, but NOT authoritatively: the
 *              classifier cannot tell your own card from an opponent's, so the caller must never
 *              apply it as a confident value.
 * Returns null when no item tile could be found — an absent reading beats a guessed one.
 */
export function readForgeAscension(
    src: HTMLCanvasElement, screen: ScreenTemplate | 'skin',
): ForgeAscensionRead | null {
    if (screen !== 'item' && screen !== 'enemy') return null;
    const authoritative = screen === 'item';
    const votes: ForgeStarVote[] = [];
    let lattice: ItemLattice | null = null;

    if (authoritative) {
        // The popup card ALWAYS covers the equipment grid on an item screen — measured on all 8
        // item fixtures, not one grid tile's star row is visible — so the popup tile is the only
        // item tile here and the lattice is not consulted. It must not be: on a dark transition
        // frame the largest same-size blob group was three background sprites, which outvoted the
        // popup tile and dropped the agreement to 3/4 for no reason.
        const tile = detectPopupTile(src);
        if (tile) votes.push({ rect: tile, stars: readItemTileStars(src, tile), row: 0, col: 0 });
    } else {
        // Profile card: the whole 8-slot equipment block is on screen at once.
        lattice = detectItemLattice(src);
        for (const t of lattice?.tiles ?? []) {
            votes.push({ rect: t.rect, stars: readItemTileStars(src, t.rect), row: t.row, col: t.col });
        }
    }
    if (!votes.length) return null;

    const tally: Record<number, number> = {};
    for (const v of votes) tally[v.stars] = (tally[v.stars] ?? 0) + 1;
    // MODAL value, ties broken toward the LOWER count: the one failure mode measured on real
    // screenshots is a phantom star (a glyph counter), which can only ever add. A tie also drives
    // agreement to <= 0.5, so the caller marks it "check" either way.
    const ranked = Object.entries(tally).map(([v, c]) => [Number(v), c] as const)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const value = ranked[0][0], agree = ranked[0][1];

    return {
        value, votes: votes.length, agree, agreement: agree / votes.length, tally,
        authoritative,
        source: authoritative ? 'popup' : 'lattice',
        tiles: votes,
        tileW: lattice?.tileW ?? votes[0].rect.w,
        rows: lattice?.rows ?? 1, cols: lattice?.cols ?? 1,
        cropUrl: starStripUrl(src, votes.filter(v => v.stars === value)),
    };
}
