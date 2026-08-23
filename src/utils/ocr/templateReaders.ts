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
    detectBrightCard, findColorNameBand, binarize, evidenceCropUrl, type Rect,
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
import { AGE_COLORS, RARITY_COLORS, RARITY_NAMES, nearestColor, type RGB } from './templateParams';
import { AGES } from '../constants';
import type { GameDictionaries } from './gameLocalization';
import type { DetectedItem, DetectedUnit, MainStat, Substat } from './readerTypes';

const OCR_SCALE = 2;      // upscale the card before OCR (validated: sharper small text)
const LEVEL_SCALE = 3;    // upscale the "Lv." banner before the digit reader
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
 * line's bbox mid-token (".1% Critical Damage" for "+75.1% …"), so trusting its x-extent used
 * to clip the leading "+7" off the value word — the proto never did, it row-projected the full
 * card width right of the tile. */
function lineRectOnSource(src: HTMLCanvasElement, card: Rect, l: PageLine): Rect {
    const m = Math.max(2, Math.round(3 * src.width / 576));
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
            const gapPx = Math.max(3, Math.round(5 * src.width / 576)); // 5px word gap @576w canonical
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
            const gapPx = Math.max(Math.round(3.5 * src.width / 576), Math.round(0.35 * bandH), 3);
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

/** OCR the coloured "[age|rarity] Name" header band -> raw text (empty if the band is absent).
 * Light hues (e.g. the Mythic magenta on the white card) can defeat tesseract's own
 * binarization, so an empty plain read is retried on an Otsu-binarized crop — a fallback only,
 * so bands that already read fine are untouched. */
async function readNameBand(src: HTMLCanvasElement, want: 'orange' | 'purple'): Promise<string> {
    const band = findColorNameBand(src, want, 0.26);
    if (!band) return '';
    try {
        const plain = (await ocr(cropCanvas(src, band, 4), { psm: PSM.SINGLE_LINE })).text.trim();
        if (plain) return plain;
        const bin = binarize(cropCanvas(src, band, 4), { autoInvert: true });
        return (await ocr(bin, { psm: PSM.SINGLE_LINE })).text.trim();
    } catch { return ''; }
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
    const tagText = await readNameBand(src, 'orange');
    const tagAge = ageFromTag(tagText);
    const tagAgree = tagAge < 0 || tagAge === ageIdx;

    const level = await readTileLevel(src, tile);
    const levelCropUrl = evidenceCropUrl(src, tileLevelRect(tile)); // evidence of the "Lv." band
    const stars = countStars(src, tile);

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

    const tagText = await readNameBand(src, 'purple');
    let rarityAgree = true;
    if (dicts && tagText) {
        let tagRarity: string | null = null;
        for (const w of normalizeName(tagText).split(' ')) { const r = dicts.rarities.get(w); if (r) { tagRarity = r; break; } }
        if (tagRarity) rarityAgree = tagRarity === rarity.toLowerCase();
    }

    // IDENTITY — match the header name against the pet / mount dictionary.
    let name: string | undefined, id: number | undefined, nameScore = 0;
    if (tagText) {
        // strip a leading rarity word for a cleaner display name
        name = tagText.replace(new RegExp(`^\\s*\\[?\\s*(${RARITY_NAMES.join('|')})\\s*\\]?\\s*`, 'i'), '').trim() || tagText;
        if (dicts) {
            const m = bestMatch(tagText, kind === 'pet' ? dicts.pets : dicts.mounts, 0.4);
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
