// Template-driven screen classifier — faithful TS port of reverseForge/proto_screen.py
// (validated 17/17 on the example set; 9/24 on the harder train set whose popups sit on a
// fully-dimmed backdrop with no readable header).
// Identifies which layout template an uploaded screenshot is — item / pet / mount / skills /
// enemy — by region-gated NCC matching of the header CURRENCY icons (templates cut from real
// screenshots, public/autosync/tpl/*.png) plus a coloured-component count and a league-emblem
// hue test, via a priority cascade. Device-agnostic: normalizes to the canonical 576px width
// the templates were cut at.
//
// SCREEN vs SUBJECT (task C1). Everything above identifies the SCREEN — and it does so from the
// currency header, which is furniture of the user's own inventory screens. Measured on every real
// fixture: a detail popup opened from a PLAYER PROFILE CARD (Power Rankings, PvP, an enemy panel)
// carries no currency header at all, so the header band holds nothing to match. On
// reverseForge/fixtures/real_3star_{mount,skin}_popup.jpeg the band (y 0.045..0.145) is inside the
// frame's black letterbox — max luminance 30 — and on the 8 dim profile-card captures it is
// literally CONSTANT (std 0.00), which makes bestNCC return -1 for every currency because every
// candidate window has zero variance. Those frames are not unclassifiable, they are just not
// classifiable FROM THE HEADER: the popup itself is still there, in the foreground, undimmed.
// So `subject` is decided separately, from the popup, and `authoritative` records whether the
// verdict came with a currency header (the user's own screen) or without one (a card that may be
// somebody else's — a read the caller must never pre-accept). `type` keeps its exact old meaning
// and value set, so every existing consumer of it is unaffected.
import { loadImage, imageToCanvas, findStarTiles, detectPopupCard, detectPopupTile, type Rect } from './imagePrep';
import { detectOutlinedTile } from './skinReader';

export type ScreenTemplate = 'item' | 'pet' | 'mount' | 'skills' | 'clanTree' | 'enemy' | 'unknown';

/**
 * What the FOREGROUND of the frame is about, which is not always what the screen is:
 *  - every ScreenTemplate value, when the screen itself is the subject;
 *  - 'skin'  — a per-slot skin popup (white detail card, DESATURATED subject tile). The skin popup
 *              shares the coins+gems header with the item popup, so the header alone cannot tell
 *              them apart; the tile's chroma can, and does (see subjectFromPopup).
 *  - 'unit'  — a pet-OR-mount-OR-item detail popup on a frame with no header. Measured on the real
 *              fixtures, these three are geometrically IDENTICAL (same white card, same
 *              rarity/age-coloured tile with a "Lv." pill, same one-or-two stat lines) and differ
 *              only in the NAME text, so the classifier refuses to guess between them and hands
 *              the frame to the readers, whose closed pet/mount dictionaries can decide.
 */
export type ScreenSubject = ScreenTemplate | 'skin' | 'unit';

export interface ClassifyResult {
    type: ScreenTemplate;
    /** The popup-aware verdict the readers should be routed on (see ScreenSubject). */
    subject: ScreenSubject;
    /**
     * False when the subject was identified WITHOUT a currency header, i.e. from a popup on a
     * player profile card. The frame cannot say whose card it is, so such a read is a suggestion
     * to confirm, never a value to apply — the same rule ForgeAscensionRead.authoritative encodes.
     */
    authoritative: boolean;
    currencies: Record<string, number>; // NCC score per currency
    tiles: number;
    emblem: number;
    confidence: number;
    /** Evidence for a popup-derived subject (observability only). */
    popup?: { card: Rect; tile: Rect | null; chroma: number | null };
}

const CANON_W = 576;         // canonical working width (the icon templates were cut at 576w)
const CURRENCIES = ['coin', 'gem', 'egg', 'ticket', 'tube', 'clock'] as const;
// header x-band (fraction of width) each currency lives in (proto_screen.XBAND)
const XBAND: Record<string, [number, number]> = {
    egg: [0.0, 0.20], ticket: [0.0, 0.20],
    // clan tech tree: eggshell test-tube counter, same top-left band as ticket/egg
    tube: [0.0, 0.20],
    coin: [0.42, 0.72], gem: [0.66, 0.95],
};
const SCALES = [0.7, 0.85, 1.0, 1.15, 1.3, 1.5];
const CLOCKWINDER_TH = 0.80;
const TUBE_TH = 0.75;        // clan tech tree header icon (test tube). Checked before ticket

interface GrayImg { d: Float32Array; w: number; h: number; }
let tplCache: Record<string, GrayImg> | null = null;

function toGray(canvas: HTMLCanvasElement): GrayImg {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const px = ctx.getImageData(0, 0, w, h).data;
    const d = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) d[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return { d, w, h };
}

function canvasAtWidth(img: HTMLImageElement | HTMLCanvasElement, cw: number): HTMLCanvasElement {
    const iw = (img as HTMLCanvasElement).width || (img as HTMLImageElement).naturalWidth;
    const ih = (img as HTMLCanvasElement).height || (img as HTMLImageElement).naturalHeight;
    const c = document.createElement('canvas');
    c.width = cw; c.height = Math.max(1, Math.round(ih * cw / iw));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
}

async function loadTemplates(): Promise<Record<string, GrayImg>> {
    if (tplCache) return tplCache;
    const out: Record<string, GrayImg> = {};
    for (const name of CURRENCIES) {
        const file = name === 'clock' ? 'clockwinder' : name;
        const img = await loadImage(`${import.meta.env.BASE_URL}autosync/tpl/${file}.png`);
        const full = imageToCanvas(img);
        // coin/gem/egg/ticket: keep left 68% (drops the shared green "+" badge);
        // the clockwinder key and clan-tree tube templates have no "+" to trim (proto_screen keep=1.0).
        const keepW = name === 'clock' || name === 'tube' ? full.width : Math.max(6, Math.round(full.width * 0.68));
        const c = document.createElement('canvas'); c.width = keepW; c.height = full.height;
        c.getContext('2d', { willReadFrequently: true })!
            .drawImage(full, 0, 0, keepW, full.height, 0, 0, keepW, full.height);
        out[name] = toGray(c);
    }
    tplCache = out;
    return out;
}

function resizeGray(src: GrayImg, dw: number, dh: number): GrayImg {
    const { d, w, h } = src, out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
        const sy = (y + 0.5) * h / dh - 0.5, y0 = Math.max(0, Math.min(h - 1, Math.floor(sy))), fy = sy - y0, y1 = Math.min(h - 1, y0 + 1);
        for (let x = 0; x < dw; x++) {
            const sx = (x + 0.5) * w / dw - 0.5, x0 = Math.max(0, Math.min(w - 1, Math.floor(sx))), fx = sx - x0, x1 = Math.min(w - 1, x0 + 1);
            const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
            out[y * dw + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + e * fx * fy;
        }
    }
    return { d: out, w: dw, h: dh };
}

/** Crop a sub-window of a GrayImg (clamped). */
function subGray(src: GrayImg, x0: number, y0: number, x1: number, y1: number): GrayImg {
    const xa = Math.max(0, Math.min(src.w, x0)), xb = Math.max(xa, Math.min(src.w, x1));
    const ya = Math.max(0, Math.min(src.h, y0)), yb = Math.max(ya, Math.min(src.h, y1));
    const w = xb - xa, h = yb - ya;
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = src.d[(ya + y) * src.w + (xa + x)];
    return { d, w, h };
}

/** proto_screen.best_ncc: best multi-scale TM_CCOEFF_NORMED of tpl inside region. */
function bestNCC(region: GrayImg, tpl: GrayImg, scales: number[]): number {
    const { d: I, w: W, h: H } = region;
    if (W < 8 || H < 8) return -1;
    // integral images for window mean / variance (exact, stride 1)
    const sat = new Float64Array((W + 1) * (H + 1));
    const sat2 = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
        let rs = 0, rs2 = 0;
        for (let x = 0; x < W; x++) {
            const v = I[y * W + x]; rs += v; rs2 += v * v;
            sat[(y + 1) * (W + 1) + (x + 1)] = sat[y * (W + 1) + (x + 1)] + rs;
            sat2[(y + 1) * (W + 1) + (x + 1)] = sat2[y * (W + 1) + (x + 1)] + rs2;
        }
    }
    const winSum = (S: Float64Array, x: number, y: number, w: number, h: number): number =>
        S[(y + h) * (W + 1) + (x + w)] - S[y * (W + 1) + (x + w)] - S[(y + h) * (W + 1) + x] + S[y * (W + 1) + x];

    let best = -1;
    for (const s of scales) {
        const tw = Math.round(tpl.w * s), th = Math.round(tpl.h * s);
        if (tw < 8 || th < 8 || tw > W || th > H) continue;
        const T = resizeGray(tpl, tw, th).d;
        const n = tw * th;
        let tSum = 0, tSum2 = 0;
        for (let i = 0; i < n; i++) { tSum += T[i]; tSum2 += T[i] * T[i]; }
        const tMean = tSum / n, tVar = tSum2 - n * tMean * tMean;
        if (tVar <= 1e-6) continue;
        const tStd = Math.sqrt(tVar);
        for (let y = 0; y + th <= H; y++) {
            for (let x = 0; x + tw <= W; x++) {
                const iSum = winSum(sat, x, y, tw, th);
                const iVar = winSum(sat2, x, y, tw, th) - iSum * iSum / n;
                if (iVar <= 1e-6) continue;
                let dot = 0;
                for (let j = 0; j < th; j++) {
                    const row = (y + j) * W + x, trow = j * tw;
                    for (let i = 0; i < tw; i++) dot += I[row + i] * T[trow + i];
                }
                const ncc = (dot - iSum * tMean) / (Math.sqrt(iVar) * tStd);
                if (ncc > best) best = ncc;
            }
        }
    }
    return best;
}

/** proto_screen.components: count separated coloured tiles/icons at a 384-wide working res. */
function countTiles(canon: HTMLCanvasElement): number {
    const TW = 384;
    const small = canvasAtWidth(canon, TW);
    const w = small.width, h = small.height;
    const px = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    let mask: Uint8Array = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 95 && mx - mn > 45) mask[p] = 1;
    }
    mask = morphOpen3(mask, w, h);
    // 8-connected components
    const labels = new Int32Array(w * h);
    const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
    let count = 0, next = 1;
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
        const s0 = sy * w + sx;
        if (!mask[s0] || labels[s0]) continue;
        const id = next++;
        let head = 0, tail = 1; qx[0] = sx; qy[0] = sy; labels[s0] = id;
        let minx = sx, maxx = sx, miny = sy, maxy = sy, area = 0;
        while (head < tail) {
            const x = qx[head], y = qy[head]; head++; area++;
            if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const q = ny * w + nx;
                if (mask[q] && !labels[q]) { labels[q] = id; qx[tail] = nx; qy[tail] = ny; tail++; }
            }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1;
        const fr = area / (w * h);
        if (fr < 0.0015 || fr > 0.10) continue;
        const ar = bw / Math.max(1, bh);
        if (ar < 0.65 || ar > 1.55) continue;
        if (Math.min(bw, bh) < 12) continue;
        count++;                                    // proto counts square + round alike (ntiles)
    }
    return count;
}

/** 3x3 morphological open (erode then dilate) of a 0/1 mask. */
function morphOpen3(mask: Uint8Array, W: number, H: number): Uint8Array {
    const ero = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 1;
        for (let dy = -1; dy <= 1 && on; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && !mask[ny * W + nx]) { on = 0; break; }
        }
        ero[y * W + x] = on;
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && ero[ny * W + nx]) { on = 1; break; }
        }
        out[y * W + x] = on;
    }
    return out;
}

/** proto_screen.emblem: fraction of league-emblem-purple pixels in the top-centre band. */
function emblemScore(canon: HTMLCanvasElement): number {
    const W = canon.width, H = canon.height;
    const x0 = Math.round(W * 0.33), x1 = Math.round(W * 0.67);
    const y0 = Math.round(H * 0.055), y1 = Math.round(H * 0.135);
    if (x1 <= x0 || y1 <= y0) return 0;
    const px = canon.getContext('2d', { willReadFrequently: true })!
        .getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let on = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        // OpenCV-style HSV: h in 0..179 (deg/2), s in 0..255, v in 0..255
        let hDeg = 0;
        if (d > 0) {
            if (mx === r) hDeg = 60 * (((g - b) / d) % 6);
            else if (mx === g) hDeg = 60 * ((b - r) / d + 2);
            else hDeg = 60 * ((r - g) / d + 4);
            if (hDeg < 0) hDeg += 360;
        }
        const hCv = hDeg / 2;
        const s = mx > 0 ? 255 * d / mx : 0;
        const v = mx;
        n++;
        if (hCv >= 120 && hCv <= 155 && s > 55 && v > 40 && v < 180) on++;
    }
    return n ? on / n : 0;
}

// =============================================================================================
// POPUP SUBJECT — what the foreground card is, for frames whose header says nothing.
// =============================================================================================

/** Mean chroma (max-min channel spread) over a rect, subsampled. An age/rarity-coloured tile
 *  measures ~120+; a skin tile (near-white art on a white card) stays far below. */
export function meanChroma(canvas: HTMLCanvasElement, r: Rect): number {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(r.x)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(r.y)));
    const w = Math.max(1, Math.min(canvas.width - x, Math.round(r.w)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.round(r.h)));
    const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data;
    const step = Math.max(1, Math.floor(w * h / 20000)); // ~20k samples max
    let sum = 0, n = 0;
    for (let p = 0; p < w * h; p += step) {
        const i = p * 4;
        sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        n++;
    }
    return n ? sum / n : 0;
}

/** Min mean chroma over the subject tile for the popup to be an age/rarity-coloured
 *  item/pet/mount tile rather than a skin's near-white one. Same value guidedSync used. */
export const ITEM_TILE_MIN_CHROMA = 60;
/** The SKIN modal is a taller modal than the item/pet/mount detail card — it carries the
 *  set-bonus block. As a fraction of the frame height, measured on every real fixture: skin
 *  popups 0.264, every other detail popup 0.109..0.171. */
const SKIN_CARD_MIN_H = 0.20;

// ---- Relative popup-card detection.
// imagePrep.detectPopupCard keys on an ABSOLUTE near-white level (min channel > 232) and
// detectBrightCard on an absolute mean luminance (> 200). Both are blind to the case that matters
// here: measured on reverseForge/fixtures/real_3star_mount_popup.jpeg the popup card's rows sit at
// mean luminance 61..72 while the frame's median row is 18 — a perfectly obvious foreground card
// that no absolute white gate can see. So the card is found RELATIVE to the frame's own median
// row luminance, which is the same principle starCounter's DARK_FRAC uses for the star outline.
const CARD_LUM_RATIO = 2.2;    // row mean must be this multiple of the frame's median row mean
const CARD_LUM_MARGIN = 12;    // ...and this far above it in absolute terms (a near-black frame
//                                would otherwise let sensor noise clear the ratio)
const CARD_MIN_H = 0.06;       // card band >= 6% of the frame height
const CARD_MIN_W = 0.40;       // card >= 40% of the frame width

/** The brightest contiguous horizontal band of the frame, relative to the frame itself — the
 *  foreground card of a popup. Returns null when nothing stands out that far from the rest. */
function detectRelativeCard(src: HTMLCanvasElement): Rect | null {
    const W = src.width, H = src.height;
    if (W < 16 || H < 16) return null;
    const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const step = Math.max(1, Math.floor(W / 200));
    const rowMean = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let sum = 0, n = 0;
        for (let x = 0; x < W; x += step) {
            const i = (y * W + x) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            n++;
        }
        rowMean[y] = sum / n;
    }
    const sorted = Float32Array.from(rowMean).sort();
    const med = sorted[H >> 1];
    const cut = Math.max(med * CARD_LUM_RATIO, med + CARD_LUM_MARGIN);
    let bestStart = 0, bestLen = 0, cur = -1;
    for (let y = 0; y <= H; y++) {
        if (y < H && rowMean[y] > cut) { if (cur < 0) cur = y; }
        else if (cur >= 0) { if (y - cur > bestLen) { bestStart = cur; bestLen = y - cur; } cur = -1; }
    }
    if (bestLen < CARD_MIN_H * H) return null;
    // horizontal extent: columns whose mean over the band clears the same cut
    const yStep = Math.max(1, Math.floor(bestLen / 40));
    let xMin = W, xMax = -1;
    for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let y = bestStart; y < bestStart + bestLen; y += yStep) {
            const i = (y * W + x) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            n++;
        }
        if (sum / n > cut) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    }
    if (xMax - xMin < CARD_MIN_W * W) return null;
    return { x: xMin, y: bestStart, w: xMax - xMin, h: bestLen };
}

const inside = (t: Rect, c: Rect): boolean => {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    return cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h;
};
/** The round close (X) button straddles a card's bottom-centre edge and is square too. */
const isCloseButton = (t: Rect, c: Rect): boolean => {
    const cxf = (t.x + t.w / 2 - c.x) / c.w, cyf = (t.y + t.h / 2 - c.y) / c.h;
    return cyf > 0.85 && Math.abs(cxf - 0.5) < 0.14;
};

export interface PopupSubject {
    subject: 'skin' | 'unit' | null;   // null = no popup evidence, caller keeps its own verdict
    card: Rect | null;
    tile: Rect | null;
    chroma: number | null;
}

/**
 * Decide what a popup's SUBJECT is, from the popup alone.
 *
 * `headerCard` picks which card finder to trust: with a currency header on screen the popup is
 * drawn over an undimmed game screen and imagePrep's near-white finders apply; without one the
 * whole frame is dimmed behind the popup and only the relative finder above can see the card.
 *
 * The verdict then comes from the SUBJECT TILE's chroma, which is the one thing that separates
 * these popups without reading a word of text:
 *   - a saturated tile (age or rarity coloured)  -> 'unit'  (item / pet / mount — the readers'
 *     closed name dictionaries decide which; measured, the three are otherwise identical)
 *   - a card with no saturated tile but a square OUTLINED one -> 'skin' (near-white skin tile)
 *   - no card, or a card with no tile-shaped thing in it -> null (refuse)
 */
export function subjectFromPopup(src: HTMLCanvasElement, headerCard: boolean): PopupSubject {
    if (headerCard) {
        // WITH a header the popup sits on an undimmed screen, so imagePrep's near-white card and
        // saturated-tile finders apply — this branch is byte-for-byte the rule that validated
        // 17/17 on the example set as guidedSync.refineItemToSkin.
        const card = detectPopupCard(src);
        if (!card) return { subject: null, card: null, tile: null, chroma: null };
        const tile = detectPopupTile(src);
        // no saturated tile in the white card at all -> a skin's near-white tile
        if (!tile) return { subject: 'skin', card, tile: null, chroma: null };
        // ignore the round close (X) button that overlaps the card's bottom-centre edge — the same
        // exclusion findColoredTiles/findStarTiles apply; a real subject tile never sits there
        const tcx = tile.x + tile.w / 2, tcy = tile.y + tile.h / 2;
        if (tcy > card.y + card.h * 0.85 && Math.abs(tcx - (card.x + card.w / 2)) < card.w * 0.14) {
            return { subject: 'skin', card, tile: null, chroma: null };
        }
        const chroma = meanChroma(src, tile);
        return { subject: chroma >= ITEM_TILE_MIN_CHROMA ? 'unit' : 'skin', card, tile, chroma };
    }
    // WITHOUT a header the whole frame is dimmed behind the popup, so both the card and the tile
    // have to be found relative to the frame. detectOutlinedTile keys on the tile's OUTLINE rather
    // than its fill, which is the only tile finder here that is blind to colour — and colour is
    // exactly what is being measured, so measuring it on a colour-keyed detection would be circular.
    const card = detectRelativeCard(src);
    if (!card) return { subject: null, card: null, tile: null, chroma: null };
    const outlined = detectOutlinedTile(src, card);
    const satTiles = findStarTiles(src).filter(t => inside(t, card) && !isCloseButton(t, card));
    const tile = outlined ?? satTiles[0] ?? null;
    // no tile-shaped thing in the card -> nothing to read; refuse rather than guess
    if (!tile) return { subject: null, card, tile: null, chroma: null };
    const chroma = meanChroma(src, tile);
    // TWO independent measurements have to agree for 'skin', because either one alone is
    // ambiguous. Measured over every header-less real fixture (14 with a tile):
    //   tile chroma        skins 12, 13, 40   |  pets/mounts 44, 85, 85, 85, 87  |  items 24..93
    //   card height / H    skins 0.264 x3     |  everything else 0.109..0.171
    // Chroma alone cannot do it: a Primitive item's tile IS white (age colour 241,241,241), so a
    // white tile is genuinely either a skin or a Primitive item — no colour test can separate
    // those two, ever. The card's height settles it, and does so structurally rather than by a
    // fitted margin: the skin modal is a different, taller modal (it has to hold the set-bonus
    // block), and its height is a fraction of the screen on every device.
    const tall = card.h >= SKIN_CARD_MIN_H * src.height;
    const desaturated = chroma < ITEM_TILE_MIN_CHROMA;
    return { subject: tall && desaturated ? 'skin' : 'unit', card, tile, chroma };
}

export async function classifyScreen(input: HTMLImageElement | HTMLCanvasElement | Blob | string): Promise<ClassifyResult> {
    const img = (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) ? input : await loadImage(input);
    const canon = canvasAtWidth(img, CANON_W);
    const gray = toGray(canon);
    const templates = await loadTemplates();
    const W = gray.w, H = gray.h;

    // header currencies: y band 0.045..0.145, per-currency x band (proto_screen.header_currencies)
    const yTop = Math.round(H * 0.045), yBot = Math.round(H * 0.145);
    const cur: Record<string, number> = {};
    for (const name of ['coin', 'gem', 'egg', 'ticket', 'tube'] as const) {
        const [xa, xb] = XBAND[name];
        const region = subGray(gray, Math.round(W * xa), yTop, Math.round(W * xb), yBot);
        cur[name] = bestNCC(region, templates[name], SCALES);
    }
    // clockwinder (mount): upper-centre "Mounts" sub-panel band, NOT the header
    // (proto_screen.clockwinder_score: y 0.24..0.36, x 0.28..0.60, whole-icon template)
    const clkRegion = subGray(gray, Math.round(W * 0.28), Math.round(H * 0.24), Math.round(W * 0.60), Math.round(H * 0.36));
    cur.clock = bestNCC(clkRegion, templates.clock, SCALES);

    const tiles = countTiles(canon);
    const emblem = emblemScore(canon);

    // priority cascade (proto_screen.classify). The proto's threshold is 0.62 against cv2 NCC
    // scores; canvas JPEG decode + smoothing reads ~0.01 hotter on the same frames (measured:
    // ticket 0.647 vs 0.64, egg 0.620 vs 0.61), so 0.63 reproduces the proto's decision boundary.
    const TH = 0.63;
    let type: ScreenTemplate;
    let header = true;                  // did the CURRENCY HEADER decide this?
    if (cur.tube > TUBE_TH) type = 'clanTree';
    else if (cur.ticket > TH) type = 'skills';
    else if (cur.egg > TH) type = 'pet';
    else if (cur.clock > CLOCKWINDER_TH) type = 'mount';
    else if (cur.coin > 0.42 || cur.gem > TH) type = 'item';
    else if (tiles >= 6) { type = 'enemy'; header = false; }
    else if (emblem > 0.03) { type = 'enemy'; header = false; }
    else { type = 'unknown'; header = false; }

    // ---- SUBJECT: what the popup in the foreground is about (see ScreenSubject).
    // Two cases only, so nothing that already classifies can be taken away by this stage:
    //   * type 'item' — the item and skin popups share the coins+gems header, so the subject tile's
    //     chroma is what tells them apart. The header is on screen, so the read is authoritative.
    //   * type 'unknown' — nothing on the frame's furniture matched. Look for a popup card relative
    //     to the frame's own brightness; a subject tile in it means there IS something to read, and
    //     the missing header means the screen behind it is not the user's own inventory, so the
    //     read is NOT authoritative.
    // 'enemy' / 'pet' / 'mount' / 'skills' / 'clanTree' keep their verdict untouched: those came
    // from positive evidence about the whole screen, which outranks a popup guess.
    let subject: ScreenSubject = type;
    let authoritative = true;
    let popup: ClassifyResult['popup'];
    if (type === 'item' || type === 'unknown') {
        const p = subjectFromPopup(canon, header);
        if (p.card) popup = { card: p.card, tile: p.tile, chroma: p.chroma };
        if (type === 'item') {
            // conservative: with no card found there is nothing to test, so 'item' stands
            if (p.subject === 'skin') subject = 'skin';
        } else if (p.subject) {
            subject = p.subject;
            authoritative = false;
        }
    }

    const conf = Math.max(cur.ticket, cur.egg, cur.tube, cur.clock, cur.coin, cur.gem, tiles >= 6 || emblem > 0.03 ? 0.6 : 0);
    return {
        type, subject, authoritative,
        currencies: cur, tiles, emblem,
        confidence: Math.min(1, Math.max(0, conf)), popup,
    };
}
