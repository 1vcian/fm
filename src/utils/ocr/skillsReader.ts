// Skills-grid reader — DERIVED grid geometry (was: calibrated frame fractions).
//
// The skills screen shows the OWNED skills as a 5-column grid of round icons ("Skills 15/18" =>
// 15 cells = 3 full rows; "18/18" => 5+5+5+3), in the fixed SKILLS_ORDER with the not-yet-owned
// skills omitted from the end. Per cell:
//   LEVEL    -> "Lv.NNN" text on the lower third of the round icon. digit_proto's white-core
//               mask fails here (light icon art bleeds into the glyphs), so we isolate PURE
//               ACHROMATIC WHITE (min>195 AND max-min<22): the glyphs are near-pure white while
//               even bright icon art keeps a colour tint. Components are clustered into text rows
//               and the row that reads "Lv."+digits wins (icon residue and the "Equipped" word
//               form their own rows). Glyphs are NCC-matched against digitBank_v2 exemplars.
//   EQUIPPED -> the equipped skills are DIMMED: the whole tile is alpha-composited towards the page
//               white, so the thick black outline ring every skill icon carries turns mid-grey.
//               That is the primary signal (see buildDimField): per cell we measure the "black
//               floor" of the upper crown of the disc and compare it against the GRID's OWN dark
//               and white references. The dimmed tiles also carry an "Equipped" pill across the
//               middle of the icon, which is WIDER than the round icon, so it paints over the
//               white page margin either side of the disc and usually merges into the cell's ink
//               blob (~1.38x the grid cell width); those stay as fallbacks. The pill's WORD is
//               only a last-resort signal: white icon art (a chrome tank, a white crown)
//               fragments into the same 5+ wide blobs.
// Skills cap at level 100 ("Maxed"), so level === 100 is the reliable maxed signal.
//
// WHY DERIVED: the previous version anchored every crop to fractions of the FRAME (XC/YC),
// calibrated on 576x1280 Android screenshots. On a 923x2000 iPhone shot (different aspect + iOS
// safe areas) the rows drift ~2% of H downwards, which clipped the level text of the LAST row
// (nulls / garbage digits) and pushed the "Equipped" band onto icon art (false positives); a
// tight CROP of just the grid block failed completely. So we now FIND the cells (the round icons
// are ink blobs on the white page), cluster them into rows/columns, and express every crop in
// units of the DETECTED cell width relative to the DETECTED cell top — which is device-,
// crop- and scale-independent. The band shapes themselves are unchanged from the calibrated
// 576x1280 geometry (same size in cell-width units), so the reference read is bit-identical.

import { cropCanvas, evidenceCropUrl, type Rect } from './imagePrep';
import {
    loadGlyphBank, scoreGlyphChar, fitGlyph, connectedComponents, upscaleCanvas,
    type GlyphBank, type CompStat,
} from './numberReader';
import { SKILLS_ORDER, LEVEL_MAX } from './templateParams';
import { countStars } from './starCounter';
import type { DetectedSkill } from './readerTypes';

const N_CELLS = SKILLS_ORDER.length; // 18 = the full roster; a grid shows only the OWNED ones
const N_COLS = 5;

// ---- fallback frame fractions (only used when cell detection finds no grid at all): the old
// calibrated geometry from the 576x1280 skills screen.
const XC = [0.125, 0.309, 0.495, 0.679, 0.863];   // column centres (of the level text)
const YC = [0.199, 0.295, 0.392, 0.488];          // row centres (of the level text)
const FALLBACK_CW = 0.125;                        // cell width as a fraction of frame width
const FALLBACK_TY = 0.69;                         // level-text centre = cellTop + this * cellW

const WHITE_THR = 195, WHITE_SAT = 22;            // pure-achromatic-white mask
const LEVEL_CHARS = 'Lv.0123456789'.split('');

// ---- crop bands, in units of the cell width (cw) relative to the cell's ink-blob top (ty).
// LVL_* reproduces the validated 576x1280 level crop (89x64 px around the "Lv." text) exactly.
const LVL_DY = 0.69, LVL_HW = 0.62, LVL_HH = 0.44;
const EQ_DY0 = 0.30, EQ_DY1 = 0.54, EQ_HW = 0.60;  // "Equipped" pill band
const OH_X0 = 0.53, OH_X1 = 0.68;                  // page margin beside the icon (pill overhang)
const EQ_INK_MIN = 0.25;                           // ink there: 0.000 normal vs 0.60+ equipped

// ---- DIMMING band: the upper crown of the disc, ABOVE the "Equipped" pill (EQ_DY0 = 0.30) and
// above the "Lv." text, so nothing the pill or the glyphs draw can enter it. Every skill icon —
// whatever its art — carries a thick near-black outline ring that this band crosses on both
// shoulders, so the band's dark floor is a property of the TILE STATE, not of the icon.
const DIM_DY0 = 0.02, DIM_DY1 = 0.30, DIM_HW = 0.45;
const DIM_FLOOR_PCT = 0.05;   // "black floor" = 5th pct of the min channel (ignores stray specks)
const DIM_WHITE_PCT = 0.98;   // the band's own white point: its corners fall outside the disc
const DIM_LO = 0.25, DIM_HI = 0.80;  // dimmed = floor lifted into this fraction of the grid's range
const DIM_RANGE_MIN = 60;     // grid dark->white range below this: no usable reference
const DIM_MIN_CELLS = 4;      // fewer measurable cells than this: no usable reference

const STAR_DY = -0.37, STAR_HW = 0.45, STAR_H = 1.56;
const CROP_DY = -0.24, CROP_HW = 0.75, CROP_H = 1.66; // evidence crop (icon + star + progress pill)

// ---- cell detection
const INK_MAX = 235;          // min-channel below this = ink (the skills page is white)
const DETECT_MAX_DIM = 1400;  // detection runs on a copy scaled to at most this
const ASPECT_LO = 0.55, ASPECT_HI = 2.4;   // blob h/w (icon + star underneath)
const FILL_MIN = 0.28;                     // blob area / bbox area (a disc is ~0.79, art gaps lower it)
const CAND_MIN_PX = 12;                    // absolute sanity floor on a cell blob
const W_LO = 0.72, W_HI = 1.78;            // member width vs the seed (dimmed = 1.38x: pill overhang)
const H_LO = 0.78, H_HI = 1.30;            // member height vs the seed
const ROW_GAP = 0.55;                      // new text row when the cy gap exceeds this * seed h
const ALIGN_TOL = 0.32;                    // column / row-pitch alignment tolerance, in cw
const COL_PITCH_LO = 1.15, COL_PITCH_HI = 2.30;  // column pitch / cw (measured 1.49 - 1.54)
const ROW_PITCH_LO = 1.30, ROW_PITCH_HI = 2.40;  // row pitch / cw (measured 1.71 - 1.77)
const MIN_GRID_CELLS = 5;
const WIDE_EQUIPPED = 1.20;                // blob width / cw above which the "Equipped" pill merged

function median(xs: number[]): number {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface WhiteComp { x: number; y: number; w: number; h: number; area: number; id: number; cy: number }

interface WhiteField { comps: WhiteComp[]; gray: Float32Array; labels: Int32Array; W: number; H: number }

/** One detected grid cell, in FULL-resolution canvas pixels. */
interface GridCell {
    cx: number;    // horizontal centre of the icon
    ty: number;    // top of the icon (the ink blob's top edge)
    w: number;     // this blob's width (wider than cw when the "Equipped" pill merged in)
    row: number;
    col: number;
}

interface SkillsGrid { cells: GridCell[]; cw: number; rows: number; cols: number }

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

// ---------------------------------------------------------------- derived grid geometry

/**
 * Ink blobs that could be a skill icon: the round icons (+ the gold star that touches them, and
 * the "Equipped" pill when the cell is dimmed) are the only near-square ink blobs on the white
 * skills page. Detection runs on a downscaled copy; results are mapped back to full-res pixels.
 */
function cellCandidates(canvas: HTMLCanvasElement): CompStat[] {
    const W0 = canvas.width, H0 = canvas.height;
    const scale = Math.min(1, DETECT_MAX_DIM / Math.max(W0, H0));
    const det = scale === 1 ? canvas : cropCanvas(canvas, { x: 0, y: 0, w: W0, h: H0 }, scale);
    const W = det.width, H = det.height;
    const px = det.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const mn = Math.min(px[i], px[i + 1], px[i + 2]);
        if (mn < INK_MAX) mask[p] = 1;
    }
    const { stats } = connectedComponents(mask, W, H);
    const out: CompStat[] = [];
    for (const s of stats) {
        if (s.w < CAND_MIN_PX || s.h < CAND_MIN_PX) continue;
        if (s.w > 0.45 * W || s.h > 0.45 * H) continue;
        const asp = s.h / s.w;
        if (asp < ASPECT_LO || asp > ASPECT_HI) continue;
        if (s.area < FILL_MIN * s.w * s.h) continue;
        const inv = 1 / scale;
        out.push({ id: s.id, x: s.x * inv, y: s.y * inv, w: s.w * inv, h: s.h * inv, area: s.area * inv * inv });
    }
    return out;
}

/**
 * Cluster the candidate blobs into the skills grid: for every candidate taken as a seed, keep the
 * blobs of the same size, group them into rows, and require a consistent column pitch and row
 * pitch (the grid is uniform). The largest consistent grid wins — the bottom tab bar or a stray
 * button can never beat 15-18 aligned cells.
 */
function buildGrid(cands: CompStat[]): SkillsGrid | null {
    let best: SkillsGrid | null = null;
    for (const seed of cands) {
        const S = cands.filter(c =>
            c.w >= W_LO * seed.w && c.w <= W_HI * seed.w &&
            c.h >= H_LO * seed.h && c.h <= H_HI * seed.h);
        if (S.length < MIN_GRID_CELLS) continue;
        // cell width = median of the NARROW blobs: the dimmed cells' blobs include the wider
        // "Equipped" pill and would inflate a plain median.
        const wmed = median(S.map(c => c.w));
        const cw = median(S.map(c => c.w).filter(w => w <= 1.15 * wmed)) || seed.w;

        // rows by vertical-centre gaps
        const byY = S.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
        const rows: CompStat[][] = [[byY[0]]];
        for (let i = 1; i < byY.length; i++) {
            const prev = rows[rows.length - 1];
            const gap = (byY[i].y + byY[i].h / 2) - (prev[prev.length - 1].y + prev[prev.length - 1].h / 2);
            if (gap <= ROW_GAP * seed.h) prev.push(byY[i]);
            else rows.push([byY[i]]);
        }
        for (const r of rows) r.sort((a, b) => a.x - b.x);

        // anchor = the fullest row; it defines the column lattice
        let ai = 0;
        for (let i = 1; i < rows.length; i++) if (rows[i].length > rows[ai].length) ai = i;
        const anchor = rows[ai];
        if (anchor.length < 2) continue;
        const cxOf = (c: CompStat) => c.x + c.w / 2;
        const colDiffs: number[] = [];
        for (let i = 1; i < anchor.length; i++) colDiffs.push(cxOf(anchor[i]) - cxOf(anchor[i - 1]));
        const colPitch = median(colDiffs);
        if (colPitch < COL_PITCH_LO * cw || colPitch > COL_PITCH_HI * cw) continue;

        // keep only cells that sit on the column lattice
        const x0 = cxOf(anchor[0]);
        const kept: CompStat[][] = [];
        for (const r of rows) {
            const ok = r.filter(c => {
                const k = Math.round((cxOf(c) - x0) / colPitch);
                return Math.abs(cxOf(c) - (x0 + k * colPitch)) <= ALIGN_TOL * cw;
            });
            if (ok.length) kept.push(ok);
        }
        if (!kept.length) continue;

        // ... and on the row lattice
        const cyOf = (r: CompStat[]) => median(r.map(c => c.y + c.h / 2));
        const rowDiffs: number[] = [];
        for (let i = 1; i < kept.length; i++) rowDiffs.push(cyOf(kept[i]) - cyOf(kept[i - 1]));
        const rowPitch = rowDiffs.length ? median(rowDiffs) : 0;
        let grid = kept;
        if (rowDiffs.length) {
            if (rowPitch < ROW_PITCH_LO * cw || rowPitch > ROW_PITCH_HI * cw) continue;
            const y0 = cyOf(kept[0]);
            grid = kept.filter(r => {
                const k = Math.round((cyOf(r) - y0) / rowPitch);
                return Math.abs(cyOf(r) - (y0 + k * rowPitch)) <= ALIGN_TOL * cw;
            });
        }
        if (!grid.length) continue;
        const raw: GridCell[] = [];
        grid.forEach((r, ri) => r.forEach(c => raw.push({
            cx: cxOf(c), ty: c.y, w: c.w, row: ri,
            col: Math.round((cxOf(c) - x0) / colPitch),
        })));
        // the grid is exactly N_COLS wide: normalise the column origin and drop anything past it,
        // so a stray aligned blob can never insert a phantom cell and shift the whole mapping
        const minCol = Math.min(...raw.map(c => c.col));
        const seen = new Set<string>();
        const cells = raw
            .map(c => ({ ...c, col: c.col - minCol }))
            .filter(c => c.col >= 0 && c.col < N_COLS)
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .filter(c => { const k = `${c.row}:${c.col}`; if (seen.has(k)) return false; seen.add(k); return true; });
        if (cells.length < MIN_GRID_CELLS) continue;
        const nRows = new Set(cells.map(c => c.row)).size;
        if (best && (cells.length < best.cells.length ||
            (cells.length === best.cells.length && nRows <= best.rows))) continue;
        best = {
            cells,
            cw: median(cells.map(c => c.w).filter(w => w < WIDE_EQUIPPED * cw)) || cw,
            rows: nRows, cols: Math.max(...cells.map(c => c.col)) + 1,
        };
    }
    return best;
}

/** Fallback grid: the old fixed frame fractions (18 cells, 5x4), for frames where no grid is found. */
function fallbackGrid(canvas: HTMLCanvasElement): SkillsGrid {
    const W = canvas.width, H = canvas.height;
    const cw = FALLBACK_CW * W;
    const cells: GridCell[] = [];
    for (let idx = 0; idx < N_CELLS; idx++) {
        const row = Math.floor(idx / N_COLS), col = idx % N_COLS;
        cells.push({ cx: XC[col] * W, ty: YC[row] * H - FALLBACK_TY * cw, w: cw, row, col });
    }
    return { cells, cw, rows: 4, cols: N_COLS };
}

// ---------------------------------------------------------------- per-cell reads

/**
 * Level crop: the "Lv.NNN" band on the lower third of the icon — the same 89x64-equivalent window
 * the 576x1280 calibration used, now in detected-cell units. It deliberately reaches past the disc
 * into the white page (the text itself spans up to 0.49 * cw): the page is one huge connected
 * component that the glyph-size gates throw away, whereas masking the crop to the disc turns
 * near-white ICON ART (claws, fletching) into mid-size blobs that survive the gates and corrupt
 * the row selection — measured 111/126 vs 125/126 on the probe cases.
 */
async function readCellLevel(canvas: HTMLCanvasElement, cell: GridCell, cw: number): Promise<number | null> {
    const cy = cell.ty + LVL_DY * cw;
    const rect: Rect = {
        x: Math.max(0, Math.round(cell.cx - LVL_HW * cw)),
        y: Math.max(0, Math.round(cy - LVL_HH * cw)),
        w: Math.round(2 * LVL_HW * cw),
        h: Math.round(2 * LVL_HH * cw),
    };
    if (rect.w < 2 || rect.h < 2) return null;
    return readWhiteLevelRow(cropCanvas(canvas, rect));
}

/** Evidence crop of one grid cell (round icon, star and progress pill) for the diff modal —
 * additive observability only, never feeds back into any read. ~96px wide JPEG data-URL. */
function cellCropUrl(canvas: HTMLCanvasElement, cell: GridCell, cw: number): string | undefined {
    const rect: Rect = {
        x: Math.round(cell.cx - CROP_HW * cw),
        y: Math.round(cell.ty + CROP_DY * cw),
        w: Math.round(2 * CROP_HW * cw),
        h: Math.round(CROP_H * cw),
    };
    return evidenceCropUrl(canvas, rect, 96);
}

/**
 * Per-cell ascension stars via the topology star counter (validated on item/unit tiles AND on
 * these skill circles). countStars' star band is TILE-relative ([0.40..1.30] of the rect
 * height, bottom-row cluster), so the cell rect is sized/positioned so that band covers exactly
 * the gold star row under the cell's "Lv." text while the progress pill below stays outside it.
 *
 * WIDTH: countStars' minimum pocket area is STAR.minAreaFrac * rect.w * rect.h, so a rect wider
 * than it needs to be raises the area floor for every star. The overlapping stars of a 2-/3-star
 * cell partly occlude each other and the occluded one's gold pocket is SMALL: on the tester's
 * 923x2000 grid it measured 131 px against a floor of 161 px at the old STAR_HW = 0.70, so every
 * 2-star cell read 1. The star cluster only ever spans ~0.35 cw around the cell centre (measured
 * 0.16 cw for two stars), so the half-width is 0.45 cw — still ~3x the cluster, but it drops the
 * area floor to 0.0084 cw^2 (104 px there), which keeps the occluded star. The vertical band is
 * untouched, so what the counter SEES vertically is unchanged.
 */
function readCellStars(canvas: HTMLCanvasElement, cell: GridCell, cw: number): number {
    const rect: Rect = {
        x: Math.round(cell.cx - STAR_HW * cw),
        y: Math.round(cell.ty + STAR_DY * cw),
        w: Math.round(2 * STAR_HW * cw),
        h: Math.round(STAR_H * cw),
    };
    try { return countStars(canvas, rect); } catch { return 0; }
}

/**
 * Fraction of non-white (ink) pixels in `rect`, or null when the rect does not fit in the canvas.
 * The window is CLIPPED, never shifted: a probe that hangs off the edge must report "unknown", not
 * silently slide onto the neighbouring content (that turned every left-column cell of a tight crop
 * into a false "equipped").
 */
function inkFraction(canvas: HTMLCanvasElement, rect: Rect): number | null {
    const rx = Math.round(rect.x), ry = Math.round(rect.y);
    const rw = Math.round(rect.w), rh = Math.round(rect.h);
    const x = Math.max(0, rx), y = Math.max(0, ry);
    const w = Math.min(canvas.width, rx + rw) - x, h = Math.min(canvas.height, ry + rh) - y;
    if (w < 2 || h < 2 || w < 0.6 * rw || h < 0.6 * rh) return null;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data;
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.min(px[i], px[i + 1], px[i + 2]) < INK_MAX) ink++;
    return ink / (w * h);
}

/**
 * Percentiles of the per-pixel MIN CHANNEL in `rect`, via a 256-bin histogram (exact for 8-bit
 * data). Returns null when the window does not fit: CLIPPED, never shifted, same contract as
 * inkFraction — a probe hanging off the frame must report "unknown", not slide onto its neighbour.
 */
function minChannelPercentiles(canvas: HTMLCanvasElement, rect: Rect, ps: number[]): number[] | null {
    const rx = Math.round(rect.x), ry = Math.round(rect.y);
    const rw = Math.round(rect.w), rh = Math.round(rect.h);
    const x = Math.max(0, rx), y = Math.max(0, ry);
    const w = Math.min(canvas.width, rx + rw) - x, h = Math.min(canvas.height, ry + rh) - y;
    if (w < 4 || h < 4 || w < 0.8 * rw || h < 0.8 * rh) return null;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data;
    const hist = new Int32Array(256);
    for (let i = 0; i < px.length; i += 4) hist[Math.min(px[i], px[i + 1], px[i + 2])]++;
    const n = w * h;
    return ps.map(p => {
        const want = Math.max(1, Math.min(n, Math.ceil(p * n)));
        let acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
        return 255;
    });
}

/**
 * The per-grid dimming reference. For every cell we measure, over the upper crown of its disc:
 *   floor = DIM_FLOOR_PCT percentile of the min channel  -> how dark the darkest content there is
 *   white = DIM_WHITE_PCT percentile of the same window  -> the page white as THIS image renders it
 * A normal cell's black outline ring puts its floor at the image's black; dimming composites the
 * tile towards the page white and lifts the floor to roughly half way. Both references come from
 * the image, so screen brightness, JPEG recompression and per-device gamma all cancel:
 *
 *   darkRef  = the lowest floor in the grid. A grid has >= MIN_GRID_CELLS = 5 cells and the game
 *              only ever dims the equipped few, so at least one cell in it is NOT dimmed.
 *   whiteRef = the MEDIAN of the per-cell white points (robust to a cell whose band is atypical).
 *   thr      = the middle of the widest gap in the sorted floors, clamped into
 *              [DIM_LO, DIM_HI] of darkRef->whiteRef.
 *
 * Chosen from the fixtures: expressed as a fraction of each grid's own range, the 108 non-equipped
 * cells all measure 0.0000 and the 18 equipped ones 0.459-0.537 (2 devices, 3 crops, a 0.6x
 * downscale) — an empty band 46% of the range wide. DIM_LO = 0.25 sits in that void with ~53 grey
 * levels of margin, and DIM_HI = 0.80 rejects a band that landed on bare page (floor ~= whiteRef)
 * instead of calling it equipped. Returns null when there is no usable reference at all.
 */
interface DimField { thr: number; hi: number; floor: (number | null)[] }

function buildDimField(canvas: HTMLCanvasElement, grid: SkillsGrid): DimField | null {
    const cw = grid.cw;
    const floor: (number | null)[] = [];
    const whites: number[] = [];
    for (const cell of grid.cells) {
        const p = minChannelPercentiles(canvas, {
            x: cell.cx - DIM_HW * cw,
            y: cell.ty + DIM_DY0 * cw,
            w: 2 * DIM_HW * cw,
            h: (DIM_DY1 - DIM_DY0) * cw,
        }, [DIM_FLOOR_PCT, DIM_WHITE_PCT]);
        if (!p) { floor.push(null); continue; }
        floor.push(p[0]);
        whites.push(p[1]);
    }
    const known = floor.filter((f): f is number => f !== null);
    if (known.length < DIM_MIN_CELLS) return null;
    const darkRef = Math.min(...known);
    const whiteRef = median(whites);
    const range = whiteRef - darkRef;
    if (range < DIM_RANGE_MIN) return null;
    const lo = darkRef + DIM_LO * range, hi = darkRef + DIM_HI * range;
    const sorted = known.slice().sort((a, b) => a - b);
    let thr = lo, bestGap = 0;
    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1];
        // only a gap that reaches into the bracket can be the split between the two populations
        if (gap > bestGap && sorted[i] > lo && sorted[i - 1] < hi) {
            bestGap = gap;
            thr = Math.min(hi, Math.max(lo, (sorted[i - 1] + sorted[i]) / 2));
        }
    }
    return { thr, hi, floor };
}

/** Dimming verdict for one cell: true/false, or null when this cell has no usable measurement. */
function dimVerdict(dim: DimField, i: number): boolean | null {
    const f = dim.floor[i];
    if (f === null) return null;
    if (f > dim.hi) return null;   // nothing dark AND nothing dimmed there: the band missed the disc
    return f > dim.thr;
}

/**
 * The "Equipped" pill is WIDER than the round icon, so on a dimmed cell it paints over the white
 * page margin either side of the disc — where a normal cell has nothing at all. Measured over the
 * two fixtures (33 non-equipped + 6 equipped cells, two devices): 0.000 vs 0.60-0.73 ink. Returns
 * the stronger side, or null when both margins fall outside the frame (tight crop).
 */
function pillOverhang(canvas: HTMLCanvasElement, cell: GridCell, cw: number): number | null {
    const y = cell.ty + EQ_DY0 * cw, h = (EQ_DY1 - EQ_DY0) * cw;
    const l = inkFraction(canvas, { x: cell.cx - OH_X1 * cw, y, w: (OH_X1 - OH_X0) * cw, h });
    const r = inkFraction(canvas, { x: cell.cx + OH_X0 * cw, y, w: (OH_X1 - OH_X0) * cw, h });
    if (l === null && r === null) return null;
    return Math.max(l ?? 0, r ?? 0);
}

/**
 * Is this cell dimmed (= equipped)? Four signals, most reliable first:
 *   1. DIMMING, measured against the other cells of the same grid (buildDimField). Independent of
 *      the icon's art, of the device's brightness and of whether the pill merged into the blob,
 *      and — unlike the pill signals — it works on a tight crop, because the band it needs is
 *      INSIDE the cell rather than in the page margin beside it.
 *   2. the pill merged into this cell's ink blob (blob >= 1.20x the grid cell width),
 *   3. the pill's overhang into the white page margin beside the icon,
 *   4. and only when both margins are cropped away, the pill's WORD (>=5 white blobs spanning >50%
 *      of the band). The word alone is not enough: icons whose art is near-white (a white crown, a
 *      chrome tank) fragment into the same 5+ wide blobs and used to be reported as equipped.
 * 2-4 stay as fallbacks for the case where the dimming band has no usable reference (a grid cropped
 * so tight that the crowns are cut off, or an image with no measurable contrast range).
 *
 * Note the dimming verdict is authoritative in BOTH directions: when it is measurable and says
 * "not dimmed" we do not consult the pill signals, because those are the ones with known false
 * positives (two neighbouring cells whose ink blobs merge look as wide as a merged pill; near-white
 * icon art fragments like the pill's word). The one thing that would silently defeat it is a
 * game-side restyle where the equipped tile is DARKENED rather than washed out — then every cell
 * reads "not dimmed". reverseForge/probe_skills.mjs prints dimThr/dimFloor per cell, so that shows
 * up immediately as a grid of floors that never separates.
 */
function detectEquipped(canvas: HTMLCanvasElement, cell: GridCell, cw: number, dim: boolean | null): boolean {
    if (dim !== null) return dim;
    if (cell.w >= WIDE_EQUIPPED * cw) return true;
    const oh = pillOverhang(canvas, cell, cw);
    if (oh !== null) return oh > EQ_INK_MIN;
    const rect: Rect = {
        x: Math.max(0, Math.round(cell.cx - EQ_HW * cw)),
        y: Math.max(0, Math.round(cell.ty + EQ_DY0 * cw)),
        w: Math.round(2 * EQ_HW * cw),
        h: Math.round((EQ_DY1 - EQ_DY0) * cw),
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
 * Read the skills grid. The cells are DETECTED (see buildGrid), so a full screenshot, a tight
 * crop of the grid block and any device aspect/scale all read the same.
 *
 * Returns one DetectedSkill per VISIBLE cell, mapped onto SKILLS_ORDER by display position: the
 * grid packs the owned skills in that fixed order and hides the ones still not owned ("Skills
 * 15/18" -> 15 cells), so position i is SKILLS_ORDER[i]. (Identifying WHICH skills are missing
 * would need per-icon art matching; until then a partial grid is read positionally, which is
 * right whenever the unowned skills are the last of the order — the case on every grid observed
 * so far.) `tiles` is accepted for backward compatibility but unused.
 */
export async function readSkills(canvas: HTMLCanvasElement, _tiles?: Rect[]): Promise<DetectedSkill[]> {
    await loadGlyphBank();
    const grid = buildGrid(cellCandidates(canvas)) ?? fallbackGrid(canvas);
    const cw = grid.cw;
    // the dimming reference is a property of the WHOLE grid, so it is measured once, before the
    // per-cell reads (see buildDimField)
    const dim = buildDimField(canvas, grid);
    const dbg = (globalThis as { __SKILLS_DEBUG__?: unknown[] }).__SKILLS_DEBUG__;
    if (Array.isArray(dbg)) {
        dbg.push({
            W: canvas.width, H: canvas.height, cw: Math.round(cw), rows: grid.rows, cols: grid.cols,
            dimThr: dim ? Math.round(dim.thr) : null, dimHi: dim ? Math.round(dim.hi) : null,
            dimFloor: dim ? dim.floor : null,
            cells: grid.cells.map(c => ({ r: c.row, c: c.col, cx: Math.round(c.cx), ty: Math.round(c.ty), w: Math.round(c.w) })),
        });
    }
    const out: DetectedSkill[] = [];
    // `ci` addresses the MEASUREMENT arrays (dim.floor is parallel to grid.cells) and nothing else;
    // the skill this cell belongs to is `idx` below, and only ever that.
    for (let ci = 0; ci < grid.cells.length; ci++) {
        const cell = grid.cells[ci];
        // Index from the cell's LATTICE POSITION, never from its position in this array. If blob
        // detection loses one cell (a twice-forwarded, recompressed screenshot is enough), an
        // array-order index silently shifts every later skill onto its neighbour's level and
        // equipped flag — ten skills mis-attributed in one apply, which corrupts the profile far
        // worse than a single unreadable level. An off-lattice cell is dropped instead.
        const idx = cell.row * N_COLS + cell.col;
        if (idx < 0 || idx >= N_CELLS) continue;
        const skillId = SKILLS_ORDER[idx];
        let level: number | null = null;
        try {
            level = await readCellLevel(canvas, cell, cw);
            if (level !== null && (level < 1 || level > LEVEL_MAX)) level = null; // reject junk
        } catch { /* unreadable cell -> level null */ }
        // separate try: an unreadable LEVEL must not silently report the cell as not equipped
        let equipped = false;
        try {
            equipped = detectEquipped(canvas, cell, cw, dim ? dimVerdict(dim, ci) : null);
        } catch { /* -> not equipped */ }
        const ascension = readCellStars(canvas, cell, cw);
        const cropUrl = cellCropUrl(canvas, cell, cw);
        out.push({ idx, skillId, level, ascension, equipped, maxed: level === 100, cropUrl });
    }
    return out;
}

export { N_COLS };
