// Skills-grid reader — faithful TS port of reverseForge/proto_skills.py (levels 17/18,
// equipped 18/18 in the Python bake-off).
//
// The skills screen is an 18-cell grid (5 cols x 4 rows, last row = 3 cells) in a FIXED
// skill order (templateParams.SKILLS_ORDER), located by calibrated RELATIVE geometry
// (fractions of the frame, validated on the 576x1280 skills tab; all game phones render the
// same portrait layout). Per cell:
//   LEVEL    -> "Lv.NNN" text on the lower third of the round icon. digit_proto's white-core
//               mask fails here (light icon art bleeds into the glyphs), so the proto isolates
//               PURE ACHROMATIC WHITE (min>195 AND max-min<22): the glyphs are near-pure white
//               while even bright icon art keeps a colour tint. Components are clustered into
//               text rows and the row that reads "Lv."+digits wins (icon residue and the
//               "Equipped" word form their own rows). Glyphs are NCC-matched against the
//               digitBank_v2 exemplars over the level charset.
//   EQUIPPED -> the 3 equipped skills carry a wide "Equipped" pill above the level text: its
//               word fragments into >=5 pure-white components spanning >50% of the crop width,
//               while non-equipped icons leave <=2 stray blobs there — a wide margin.
// Skills cap at level 100 ("Maxed"), so level === 100 is the reliable maxed signal.

import { cropCanvas, evidenceCropUrl, type Rect } from './imagePrep';
import {
    loadGlyphBank, scoreGlyphChar, fitGlyph, connectedComponents, upscaleCanvas, type GlyphBank,
} from './numberReader';
import { SKILLS_ORDER, LEVEL_MAX } from './templateParams';
import { countStars } from './starCounter';
import type { DetectedSkill } from './readerTypes';

const N_CELLS = SKILLS_ORDER.length; // 18
const N_COLS = 5;

// calibrated relative geometry (proto_skills.py, validated on the 576x1280 skills screen)
const XC = [0.125, 0.309, 0.495, 0.679, 0.863];   // column centres (of the level text)
const YC = [0.199, 0.295, 0.392, 0.488];          // row centres (of the level text)
const LVL_HW = 0.0775, LVL_HH = 0.025;            // level crop half-width / half-height
const WHITE_THR = 195, WHITE_SAT = 22;            // pure-achromatic-white mask
const LEVEL_CHARS = 'Lv.0123456789'.split('');

function median(xs: number[]): number {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface WhiteComp { x: number; y: number; w: number; h: number; area: number; id: number; cy: number }

interface WhiteField { comps: WhiteComp[]; gray: Float32Array; labels: Int32Array; W: number; H: number }

/** proto_skills._pure_white_components: isolate near-pure-white glyphs at `upScale`x. */
function pureWhiteComponents(crop: HTMLCanvasElement, upScale: number): WhiteField {
    const up = upscaleCanvas(crop, upScale);
    const W = up.width, H = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H); const gray = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        gray[p] = mn;
        if (mn > WHITE_THR && mx - mn < WHITE_SAT) mask[p] = 1;
    }
    const { labels, stats } = connectedComponents(mask, W, H);
    const comps: WhiteComp[] = [];
    for (const s of stats) {
        if (s.area < 25 || s.w < 3 || s.h < 7) continue;
        // glyph-size gates: level glyphs occupy a narrow size band; light icons whose ART is
        // near-white (Arrows fletching, white circle interiors) form much larger blobs that
        // would chain text rows together in clusterRows and corrupt the read.
        if (s.h > 0.32 * H || s.w > 0.30 * W || s.area > 0.025 * W * H) continue;
        if (s.h > 0.8 * H || s.area > 0.12 * H * W) continue;   // background bleed
        comps.push({ ...s, cy: s.y + s.h / 2 });
    }
    return { comps, gray, labels, W, H };
}

/** Cluster components into horizontal text rows by vertical-centre gaps. */
function clusterRows(comps: WhiteComp[], gapFactor: number): WhiteComp[][] {
    if (!comps.length) return [];
    const sorted = comps.slice().sort((a, b) => a.cy - b.cy);
    const hmed = median(sorted.map(c => c.h));
    const rows: WhiteComp[][] = [];
    let cur: WhiteComp[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].cy - cur[cur.length - 1].cy < gapFactor * hmed) cur.push(sorted[i]);
        else { rows.push(cur); cur = [sorted[i]]; }
    }
    rows.push(cur);
    return rows;
}

/** proto_skills._read_row: NCC-read one row of glyphs left->right -> (digits int, raw string). */
function readRow(row: WhiteComp[], field: WhiteField, bank: GlyphBank): { value: number | null; raw: string } {
    const sorted = row.slice().sort((a, b) => a.x - b.x);
    const hmax = Math.max(...sorted.map(c => c.h));
    let raw = '', digits = '';
    for (const c of sorted) {
        const sub = new Float32Array(c.w * c.h);
        for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) {
            const p = (c.y + yy) * field.W + (c.x + xx);
            if (field.labels[p] === c.id) sub[yy * c.w + xx] = field.gray[p];
        }
        const g = fitGlyph(sub, c.w, c.h, bank.gw, bank.gh);
        let mx = 0; for (let i = 0; i < g.length; i++) if (g[i] > mx) mx = g[i];
        if (mx > 1e-3) for (let i = 0; i < g.length; i++) g[i] /= mx;
        const cand: Record<string, number> = {};
        for (const ch of LEVEL_CHARS) cand[ch] = scoreGlyphChar(bank, g, ch);
        if (c.h < 0.55 * hmax) for (const ch of '0123456789L') cand[ch] -= 0.5; // short glyph: 'v'/'.'
        let best = LEVEL_CHARS[0], bs = -Infinity;
        for (const ch of LEVEL_CHARS) if (cand[ch] > bs) { bs = cand[ch]; best = ch; }
        raw += best;
        if (best >= '0' && best <= '9') digits += best;
    }
    return { value: digits ? parseInt(digits, 10) : null, raw };
}

/**
 * Read a "Lv.NNN" level out of a crop that may also contain other white text (the "Equipped"
 * pill, icon residue): cluster the pure-white components into text rows and prefer the row that
 * reads as 'Lv'+digits (proto_skills.read_level row-selection). Exported for the unit tiles,
 * whose overlay layout ("Equipped" + "Lv. NN" + star) matches the skill cells.
 */
export async function readWhiteLevelRow(crop: HTMLCanvasElement): Promise<number | null> {
    const bank = await loadGlyphBank();
    const field = pureWhiteComponents(crop, 5);
    if (!field.comps.length) return null;
    const rows = clusterRows(field.comps, 0.6);
    const parsed = rows.map(row => readRow(row, field, bank));
    // prefer the row that starts with the 'Lv' prefix (icon residue / the "Equipped" word
    // cluster into their own rows)
    let best: { value: number | null; raw: string } | null = null;
    for (const p of parsed) {
        if (p.value !== null && (p.raw[0] === 'L' || p.raw.slice(0, 2).includes('v'))) best = p;
    }
    if (!best) for (const p of parsed) if (p.value !== null) { best = p; break; }
    return best ? best.value : null;
}

/** proto_skills.read_level for grid cell (row r, col c). */
async function readCellLevel(canvas: HTMLCanvasElement, r: number, c: number, _bank: GlyphBank): Promise<number | null> {
    const W = canvas.width, H = canvas.height;
    const cx = XC[c] * W, cy = YC[r] * H;
    const rect: Rect = {
        x: Math.max(0, Math.round(cx - LVL_HW * W)),
        y: Math.max(0, Math.round(cy - LVL_HH * H)),
        w: Math.round(2 * LVL_HW * W),
        h: Math.round(2 * LVL_HH * H),
    };
    if (rect.w < 2 || rect.h < 2) return null;
    return readWhiteLevelRow(cropCanvas(canvas, rect));
}

/** Evidence crop of one grid cell (round icon + its "Lv.NNN" band) for the diff modal —
 * additive observability only, never feeds back into any read. ~96px wide JPEG data-URL. */
function cellCropUrl(canvas: HTMLCanvasElement, r: number, c: number): string | undefined {
    const W = canvas.width, H = canvas.height;
    const rect: Rect = {
        x: Math.round((XC[c] - 0.088) * W),
        y: Math.round((YC[r] - 0.068) * H),
        w: Math.round(0.176 * W),
        h: Math.round(0.100 * H),
    };
    return evidenceCropUrl(canvas, rect, 96);
}

/**
 * Per-cell ascension stars via the topology star counter (validated on item/unit tiles AND on
 * these skill circles). countStars' star band is TILE-relative ([0.40..1.30] of the rect
 * height, bottom-row cluster), so the cell rect is sized/positioned so that band covers
 * exactly the gold star row under the cell's "Lv." text (star centre ≈ YC+0.024..0.040 of H)
 * while the progress pill below (top ≈ YC+0.052) stays OUTSIDE it. Validated 18/18 == 1 star
 * on the real skills screenshot (photo_2026-08-21 04.56.57).
 */
function readCellStars(canvas: HTMLCanvasElement, r: number, c: number): number {
    const W = canvas.width, H = canvas.height;
    const rect: Rect = {
        x: Math.round((XC[c] - 0.088) * W),
        y: Math.round((YC[r] - 0.058) * H),
        w: Math.round(0.176 * W),
        h: Math.round(0.088 * H),
    };
    try { return countStars(canvas, rect); } catch { return 0; }
}

/** proto_skills.detect_equipped: the wide "Equipped" pill above the level text. */
function detectEquipped(canvas: HTMLCanvasElement, r: number, c: number): boolean {
    const W = canvas.width, H = canvas.height;
    const cx = XC[c] * W;
    const rect: Rect = {
        x: Math.max(0, Math.round(cx - 0.072 * W)),
        y: Math.max(0, Math.round((YC[r] - 0.052) * H)),
        w: Math.round(0.144 * W),
        h: Math.round(0.042 * H),
    };
    if (rect.w < 2 || rect.h < 2) return false;
    const up = upscaleCanvas(cropCanvas(canvas, rect), 4);
    const Wu = up.width, Hu = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, Wu, Hu).data;
    const mask = new Uint8Array(Wu * Hu);
    for (let i = 0, p = 0; p < Wu * Hu; i += 4, p++) {
        const rr = px[i], gg = px[i + 1], bb = px[i + 2];
        const mn = Math.min(rr, gg, bb), mx = Math.max(rr, gg, bb);
        if (mn > WHITE_THR && mx - mn < WHITE_SAT) mask[p] = 1;
    }
    const { stats } = connectedComponents(mask, Wu, Hu);
    const comps: WhiteComp[] = [];
    for (const s of stats) {
        if (s.area < 20 || s.h < 6 || s.h > 0.7 * Hu) continue;
        comps.push({ ...s, cy: s.y + s.h / 2 });
    }
    if (!comps.length) return false;
    const rows = clusterRows(comps, 0.7);
    let bestN = 0, bestSpan = 0;
    for (const row of rows) {
        if (row.length > bestN) {
            let lo = Infinity, hi = -Infinity;
            for (const cc of row) { lo = Math.min(lo, cc.x); hi = Math.max(hi, cc.x + cc.w); }
            bestN = row.length; bestSpan = (hi - lo) / Wu;
        }
    }
    return bestN >= 5 && bestSpan > 0.5;
}

/**
 * Read the 18-cell skills grid via the calibrated relative geometry. The `tiles` argument is
 * accepted for backward compatibility but unused (the proto's fixed grid beats blob detection —
 * round icons with colourful art are not reliably segmentable as "coloured tiles").
 * Always returns exactly 18 DetectedSkill in SKILLS_ORDER.
 */
export async function readSkills(canvas: HTMLCanvasElement, _tiles?: Rect[]): Promise<DetectedSkill[]> {
    const bank = await loadGlyphBank();
    const out: DetectedSkill[] = [];
    for (let idx = 0; idx < N_CELLS; idx++) {
        const r = Math.floor(idx / N_COLS), c = idx % N_COLS;
        const skillId = SKILLS_ORDER[idx];
        let level: number | null = null;
        let equipped = false;
        try {
            level = await readCellLevel(canvas, r, c, bank);
            if (level !== null && (level < 1 || level > LEVEL_MAX)) level = null; // reject junk
            equipped = detectEquipped(canvas, r, c);
        } catch { /* unreadable cell -> level null */ }
        const ascension = readCellStars(canvas, r, c);
        const cropUrl = cellCropUrl(canvas, r, c);
        out.push({ idx, skillId, level, ascension, equipped, maxed: level === 100, cropUrl });
    }
    return out;
}

export { N_COLS };
