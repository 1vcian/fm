// Canvas-based image preprocessing for the AutoSync OCR pipeline.
// Everything is resolution-independent: callers pass RELATIVE rects (fractions of the
// image) and we convert to pixels, so the same regions work for any phone screenshot size.

export interface Rect { x: number; y: number; w: number; h: number; }
/** Fractions in 0..1 of the source image (x0,y0 = top-left, x1,y1 = bottom-right). */
export interface RelRect { x0: number; y0: number; x1: number; y1: number; }

/** Load a File/Blob/objectURL/dataURL into an HTMLImageElement. */
export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let url: string | null = null;
        img.onload = () => { if (url) URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { if (url) URL.revokeObjectURL(url); reject(e); };
        if (typeof src === 'string') img.src = src;
        else { url = URL.createObjectURL(src); img.src = url; }
    });
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
    return c;
}

export function relToPx(w: number, h: number, r: RelRect): Rect {
    return {
        x: Math.max(0, Math.round(r.x0 * w)),
        y: Math.max(0, Math.round(r.y0 * h)),
        w: Math.min(w, Math.round((r.x1 - r.x0) * w)),
        h: Math.min(h, Math.round((r.y1 - r.y0) * h)),
    };
}

/** Crop a region, optionally upscaling (helps OCR on small stylized text). */
export function cropCanvas(src: HTMLCanvasElement, rect: Rect, scale = 1): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(rect.w * scale));
    c.height = Math.max(1, Math.round(rect.h * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    return c;
}

/**
 * Small JPEG data-URL of `rect` on the ORIGINAL-resolution canvas — per-field evidence crops for
 * the AutoSync diff modal (additive observability only; the result never feeds back into any
 * reader). The band is upscaled up to 2x for readability and capped at `maxW` pixels wide.
 */
export function evidenceCropUrl(src: HTMLCanvasElement, rect: Rect, maxW = 320, quality = 0.7): string | undefined {
    try {
        const x = Math.max(0, Math.min(src.width - 1, Math.round(rect.x)));
        const y = Math.max(0, Math.min(src.height - 1, Math.round(rect.y)));
        const w = Math.max(1, Math.min(src.width - x, Math.round(rect.w)));
        const h = Math.max(1, Math.min(src.height - y, Math.round(rect.h)));
        if (w < 2 || h < 2) return undefined;
        const scale = Math.min(2, maxW / w);
        return cropCanvas(src, { x, y, w, h }, scale).toDataURL('image/jpeg', quality);
    } catch { return undefined; }
}

/** Otsu automatic threshold over a grayscale histogram. */
function otsuThreshold(hist: number[], total: number): number {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = -1, thr = 127;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) { maxVar = between; thr = t; }
    }
    return thr;
}

/**
 * Grayscale + threshold to black/white for cleaner OCR. `threshold: 0` => Otsu auto.
 * `invert` flips so text becomes dark-on-light when the source is light-on-dark.
 * `autoInvert` decides polarity from which side of the threshold is the majority
 * (text should be the minority ink) — good for game popups with mixed backgrounds.
 */
export function binarize(
    src: HTMLCanvasElement,
    opts: { threshold?: number; invert?: boolean; autoInvert?: boolean } = {}
): HTMLCanvasElement {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const { width, height } = src;
    const img = ctx.getImageData(0, 0, width, height);
    const d = img.data;
    const gray = new Uint8Array(width * height);
    const hist = new Array(256).fill(0);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        gray[p] = g;
        hist[g]++;
    }
    const thr = opts.threshold && opts.threshold > 0 ? opts.threshold : otsuThreshold(hist, width * height);

    let dark = 0;
    for (let p = 0; p < gray.length; p++) if (gray[p] < thr) dark++;
    // Default: make text dark on white. If autoInvert and the "ink" (minority) is the
    // bright side, flip so the minority becomes dark.
    let invert = !!opts.invert;
    if (opts.autoInvert) invert = dark > gray.length / 2; // majority dark => text is light => invert

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        let on = gray[p] < thr; // true => below threshold
        if (invert) on = !on;
        const v = on ? 0 : 255; // on => black ink
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return src;
}

/**
 * Locate the large bright "popup card" (white rounded rectangle) that game detail
 * modals draw over the dimmed screen. Returns its bounding box in pixels, or null.
 * Heuristic: find the longest vertical run of rows whose mean luminance is high, then
 * the horizontal extent of bright columns within that band.
 */
export function detectBrightCard(src: HTMLCanvasElement, minLum = 200): Rect | null {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const { width, height } = src;
    const step = Math.max(1, Math.floor(width / 200)); // subsample columns for speed
    const rowBright: boolean[] = new Array(height).fill(false);
    const data = ctx.getImageData(0, 0, width, height).data;

    for (let y = 0; y < height; y++) {
        let sum = 0, n = 0;
        for (let x = 0; x < width; x += step) {
            const i = (y * width + x) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            n++;
        }
        rowBright[y] = sum / n > minLum;
    }
    // longest contiguous bright band
    let best = { start: 0, len: 0 }, curStart = -1;
    for (let y = 0; y <= height; y++) {
        if (y < height && rowBright[y]) { if (curStart < 0) curStart = y; }
        else { if (curStart >= 0) { const len = y - curStart; if (len > best.len) best = { start: curStart, len }; curStart = -1; } }
    }
    if (best.len < height * 0.08) return null; // no meaningful card

    const y0 = best.start, y1 = best.start + best.len;
    // horizontal extent: columns bright across the band
    let xMin = width, xMax = 0;
    for (let x = 0; x < width; x++) {
        let sum = 0, n = 0;
        for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 60))) {
            const i = (y * width + x) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            n++;
        }
        if (sum / n > minLum) { if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    }
    if (xMax <= xMin) return null;
    return { x: xMin, y: y0, w: xMax - xMin, h: y1 - y0 };
}

/**
 * Locate the coloured bold NAME band (orange = item, purple = pet/mount). `xMinFrac`
 * blanks the left icon area so we lock onto the name TEXT, not the icon tile. Returns the
 * band rect (in source px) or null. Ported from the validated Python harness.
 */
export function findColorNameBand(src: HTMLCanvasElement, want: 'orange' | 'purple', xMinFrac = 0.26): Rect | null {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const { width: W, height: H } = src;
    const data = ctx.getImageData(0, 0, W, H).data;
    const xMin = Math.floor(W * xMinFrac);
    const rowCount = new Float64Array(H);
    for (let y = 0; y < H; y++) {
        let c = 0;
        for (let x = xMin; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const on = want === 'orange'
                ? (r > 150 && g > r * 0.52 && g < r * 0.92 && b < g * 0.75 && r > b + 55)
                : (b > 140 && r > 95 && r < 215 && g < 135 && b > g + 45);
            if (on) c++;
        }
        rowCount[y] = c;
    }
    const lo = Math.floor(H * 0.02), hi = Math.floor(H * 0.92);
    let peak = 0;
    for (let y = lo; y < hi; y++) peak = Math.max(peak, rowCount[y]);
    if (peak < W * 0.02) return null;
    const thr = Math.max(W * 0.03, peak * 0.4);
    let y0 = -1;
    for (let y = lo; y < hi; y++) if (rowCount[y] > thr) { y0 = y; break; }
    if (y0 < 0) return null;
    let y1 = y0;
    const maxH = Math.floor(H * 0.045);
    while (y1 < hi - 1 && rowCount[y1 + 1] > peak * 0.25 && (y1 - y0) < maxH) y1++;
    // x-extent of coloured pixels across the band
    let xLo = W, xHi = 0;
    for (let y = y0; y <= y1; y++) {
        for (let x = xMin; x < W; x++) {
            const i = (y * W + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const on = want === 'orange'
                ? (r > 150 && g > r * 0.52 && g < r * 0.92 && b < g * 0.75 && r > b + 55)
                : (b > 140 && r > 95 && r < 215 && g < 135 && b > g + 45);
            if (on) { if (x < xLo) xLo = x; if (x > xHi) xHi = x; }
        }
    }
    if (xHi <= xLo) return null;
    return { x: xLo, y: Math.max(0, y0 - 4), w: xHi - xLo, h: (y1 - y0) + 9 };
}

/**
 * DYNAMIC tile detector — no fixed screen regions, so it works on phones, tablets and any
 * popup position. Finds bright, saturated, roughly-square colour blobs (the item/pet/mount
 * tiles, whose colour varies by age/rarity) via connected components on a downscaled chroma
 * mask (the downscale implicitly "closes" the art holes). Returns boxes in full-res px,
 * largest first. Excludes the bottom-centre close (X) button.
 */
export function findColoredTiles(src: HTMLCanvasElement): Rect[] {
    const fullW = src.width, fullH = src.height;
    const w = 110, h = Math.max(1, Math.round(fullH * w / fullW));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 110 && mx - mn > 52) mask[p] = 1; // bright + saturated
    }
    const seen = new Uint8Array(w * h);
    const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
    const sxr = fullW / w, syr = fullH / h;
    const tiles: { rect: Rect; area: number }[] = [];
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
        const s0 = sy * w + sx;
        if (!mask[s0] || seen[s0]) continue;
        let head = 0, tail = 0; qx[0] = sx; qy[0] = sy; tail = 1; seen[s0] = 1;
        let minx = sx, maxx = sx, miny = sy, maxy = sy, area = 0;
        while (head < tail) {
            const x = qx[head], y = qy[head]; head++; area++;
            if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            if (x + 1 < w && mask[y * w + x + 1] && !seen[y * w + x + 1]) { seen[y * w + x + 1] = 1; qx[tail] = x + 1; qy[tail] = y; tail++; }
            if (x - 1 >= 0 && mask[y * w + x - 1] && !seen[y * w + x - 1]) { seen[y * w + x - 1] = 1; qx[tail] = x - 1; qy[tail] = y; tail++; }
            if (y + 1 < h && mask[(y + 1) * w + x] && !seen[(y + 1) * w + x]) { seen[(y + 1) * w + x] = 1; qx[tail] = x; qy[tail] = y + 1; tail++; }
            if (y - 1 >= 0 && mask[(y - 1) * w + x] && !seen[(y - 1) * w + x]) { seen[(y - 1) * w + x] = 1; qx[tail] = x; qy[tail] = y - 1; tail++; }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1;
        const ar = bw / bh, solidity = area / (bw * bh);
        if (bw < w * 0.05 || bh < h * 0.05 || bw > w * 0.55 || bh > h * 0.55) continue;
        if (ar < 0.65 || ar > 1.5 || solidity < 0.55) continue;
        const cxf = (minx + maxx) / 2 / w, cyf = (miny + maxy) / 2 / h;
        if (cyf > 0.88 && Math.abs(cxf - 0.5) < 0.14) continue; // bottom-centre X button
        tiles.push({ rect: { x: Math.round(minx * sxr), y: Math.round(miny * syr), w: Math.round(bw * sxr), h: Math.round(bh * syr) }, area });
    }
    tiles.sort((a, b) => b.area - a.area);
    return tiles.map(t => t.rect);
}

/** Largest colour tile = the focused item/pet/mount icon in a detail popup, or null. */
export function detectItemTile(src: HTMLCanvasElement): Rect | null {
    return findColoredTiles(src)[0] || null;
}

// ---------------------------------------------------------------------------------------------
// Popup-card tile detection — faithful port of reverseForge/proto_age.py (find_card + _tiles_in +
// item_tiles_popup, the geometry every validated single-subject Python reader shares). Works at
// the canonical 576px width the protos were calibrated at, then maps rects back to source px.

const POPUP_CANON_W = 576;

interface CanonMask { mask: Uint8Array; w: number; h: number; sx: number; sy: number }

function canonPixels(src: HTMLCanvasElement): { px: Uint8ClampedArray; w: number; h: number; sx: number; sy: number } {
    const w = POPUP_CANON_W, h = Math.max(1, Math.round(src.height * w / src.width));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return { px: ctx.getImageData(0, 0, w, h).data, w, h, sx: src.width / w, sy: src.height / h };
}

function morphRect(mask: Uint8Array, W: number, H: number, r: number, erode: boolean): Uint8Array {
    // separable square structuring element of size 2r+1
    const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let v = erode ? 1 : 0;
        for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) {
            const m = mask[y * W + k];
            if (erode) { if (!m) { v = 0; break; } } else if (m) { v = 1; break; }
        }
        tmp[y * W + x] = v;
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        let v = erode ? 1 : 0;
        for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) {
            const m = tmp[k * W + x];
            if (erode) { if (!m) { v = 0; break; } } else if (m) { v = 1; break; }
        }
        out[y * W + x] = v;
    }
    return out;
}

interface CcStat { x: number; y: number; w: number; h: number; area: number }

function ccStats8(mask: Uint8Array, W: number, H: number): CcStat[] {
    const labels = new Int32Array(W * H);
    const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
    const out: CcStat[] = [];
    let next = 1;
    for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
        const s0 = sy * W + sx;
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
                if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                const q = ny * W + nx;
                if (mask[q] && !labels[q]) { labels[q] = id; qx[tail] = nx; qy[tail] = ny; tail++; }
            }
        }
        out.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, area });
    }
    return out;
}

/**
 * Locate the near-white popup card at canonical width (proto_age.find_card: min-channel > 232,
 * 5x5 open, area >= 6% and width >= 60% of the frame, largest). Returns the card rect in SOURCE
 * pixels, or null.
 */
export function detectPopupCard(src: HTMLCanvasElement): Rect | null {
    const { px, w, h, sx, sy } = canonPixels(src);
    let mask: Uint8Array = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
        if (Math.min(px[i], px[i + 1], px[i + 2]) > 232) mask[p] = 1;
    }
    mask = morphRect(morphRect(mask, w, h, 2, true), w, h, 2, false); // open 5x5
    let best: CcStat | null = null;
    for (const s of ccStats8(mask, w, h)) {
        if (s.area < 0.06 * w * h || s.w < 0.6 * w) continue;
        if (!best || s.area > best.area) best = s;
    }
    if (!best) return null;
    return { x: Math.round(best.x * sx), y: Math.round(best.y * sy), w: Math.round(best.w * sx), h: Math.round(best.h * sy) };
}

/**
 * Coloured tiles by the proto_stars.find_colored_tiles recipe (validated 51/51 star tiles):
 * chroma mask (max>110 & max-min>52) closed at TWO kernel scales (0.016W and 0.045W — the small
 * close keeps neighbouring tiles apart, the big close heals the Divine shimmer/level-text holes),
 * size gates relative to the canonical width, X-button exclusion, IoU dedupe, largest first.
 * Returns rects in SOURCE px.
 */
export function findStarTiles(src: HTMLCanvasElement): Rect[] {
    const { px, w, h, sx, sy } = canonPixels(src);
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 110 && mx - mn > 52) mask[p] = 1;
    }
    const raw: CcStat[] = [];
    for (const k of [Math.max(3, Math.round(w * 0.016)), Math.max(3, Math.round(w * 0.045))]) {
        const r = k >> 1; // close with a (2r+1)^2 kernel ~ cv2 close with k x k (k odd)
        const closed = morphRect(morphRect(mask, w, h, r, false), w, h, r, true);
        raw.push(...ccStats8(closed, w, h));
    }
    const cand: CcStat[] = [];
    for (const s of raw) {
        if (s.w < w * 0.035 || s.h < w * 0.035 || s.w > w * 0.32 || s.h > w * 0.32) continue;
        const ar = s.w / Math.max(1, s.h), sol = s.area / Math.max(1, s.w * s.h);
        if (ar < 0.55 || ar > 2.2 || sol < 0.40) continue;
        const cxf = (s.x + s.w / 2) / w, cyf = (s.y + s.h / 2) / h;
        if (cyf > 0.88 && Math.abs(cxf - 0.5) < 0.14) continue; // bottom-centre X button
        cand.push(s);
    }
    cand.sort((a, b) => b.w * b.h - a.w * a.h);
    const iou = (a: CcStat, b: CcStat): number => {
        const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
        const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        const union = a.w * a.h + b.w * b.h - inter;
        return union ? inter / union : 0;
    };
    const kept: CcStat[] = [];
    for (const c of cand) if (kept.every(k => iou(c, k) < 0.4)) kept.push(c);
    return kept.map(s => ({ x: Math.round(s.x * sx), y: Math.round(s.y * sy), w: Math.round(s.w * sx), h: Math.round(s.h * sy) }));
}

/**
 * The subject tile of a pet/mount popup. The unit tile sits at the TOP-LEFT of the card header
 * (proto_rarity's header band), while claim buttons / egg icons sit lower — so among the
 * proto_stars tile candidates inside the card, the topmost wins. Falls back to the topmost tile
 * frame-wide when no card is found.
 */
export function detectUnitTile(src: HTMLCanvasElement): Rect | null {
    const tiles = findStarTiles(src);
    if (!tiles.length) return null;
    const card = detectPopupCard(src);
    let pool = tiles;
    if (card) {
        const inCard = tiles.filter(t => {
            const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
            return cx >= card.x && cx <= card.x + card.w && cy >= card.y && cy <= card.y + card.h;
        });
        if (inCard.length) pool = inCard;
    }
    return pool.slice().sort((a, b) => a.y - b.y || a.x - b.x)[0];
}

/**
 * The focused subject tile of a single-item/pet/mount popup: the largest square-ish coloured
 * tile inside the white card (proto_age.item_tiles_popup: mask max>110 & max-min>52, open 3x3 +
 * close 5x5, tile w in 8-55% / h in 5-45% of the card, solidity >= 0.40 — Divine shimmer and the
 * white "Lv." glyphs punch holes in the fill — aspect 0.6..1.7, largest area wins). Returns the
 * tile rect in SOURCE pixels, or null when no card / no tile is found.
 */
export function detectPopupTile(src: HTMLCanvasElement): Rect | null {
    const card = detectPopupCard(src);
    if (!card) return null;
    const { px, w, h, sx, sy } = canonPixels(src);
    // card rect in canon coords
    const cx0 = Math.max(0, Math.round(card.x / sx)), cy0 = Math.max(0, Math.round(card.y / sy));
    const cw = Math.min(w - cx0, Math.round(card.w / sx)), ch = Math.min(h - cy0, Math.round(card.h / sy));
    if (cw < 4 || ch < 4) return null;
    let mask: Uint8Array = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = ((cy0 + y) * w + (cx0 + x)) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx > 110 && mx - mn > 52) mask[y * cw + x] = 1;
    }
    mask = morphRect(morphRect(mask, cw, ch, 1, true), cw, ch, 1, false);  // open 3x3
    mask = morphRect(morphRect(mask, cw, ch, 2, false), cw, ch, 2, true);  // close 5x5
    const stats = ccStats8(mask, cw, ch);
    // proto gate first (h <= 45% of the card); if nothing qualifies, retry at 60% — the small
    // enemy-profile item card (train set) is only ~180px tall, so its tile spans ~53% of it.
    // Verified against the proto in Python: the looser gate never changes a shot where the
    // 45% gate already found a tile.
    let best: CcStat | null = null;
    for (const hGate of [0.45, 0.60]) {
        for (const s of stats) {
            if (s.w < 0.08 * cw || s.h < 0.05 * ch) continue;
            if (s.w > 0.55 * cw || s.h > hGate * ch) continue;
            const ar = s.w / Math.max(1, s.h);
            const sol = s.area / Math.max(1, s.w * s.h);
            if (sol < 0.40) continue;
            if (ar <= 0.6 || ar >= 1.7) continue;
            if (!best || s.w * s.h > best.w * best.h) best = s;
        }
        if (best) break;
    }
    if (!best) return null;
    return {
        x: Math.round((cx0 + best.x) * sx), y: Math.round((cy0 + best.y) * sy),
        w: Math.round(best.w * sx), h: Math.round(best.h * sy),
    };
}

/** The ART sub-region of a tile (top ~62%, excluding the "Lv.N" banner) — for embedding. */
export function tileArtRect(t: Rect): Rect {
    return { x: t.x, y: t.y, w: t.w, h: Math.round(t.h * 0.62) };
}
/** The "Lv.NNN" sub-region of a tile (bottom ~34%) — relative, resolution-independent. */
export function tileLevelRect(t: Rect): Rect {
    return { x: t.x, y: t.y + Math.round(t.h * 0.66), w: t.w, h: Math.round(t.h * 0.34) };
}

/** The ART region of the focused item popup icon (dynamic; for embedding matching). */
export function detectItemIconRect(src: HTMLCanvasElement): Rect | null {
    const t = detectItemTile(src);
    return t ? tileArtRect(t) : null;
}

/**
 * Count gold/yellow stars (ascension pips) inside a region by detecting horizontal
 * clusters of gold pixels. Returns the number of distinct star blobs (0..~5).
 */
export function countGoldStars(src: HTMLCanvasElement, rect: Rect): number {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const rx = Math.max(0, rect.x), ry = Math.max(0, rect.y);
    const rw = Math.min(src.width - rx, rect.w), rh = Math.min(src.height - ry, rect.h);
    if (rw <= 0 || rh <= 0) return 0;
    const data = ctx.getImageData(rx, ry, rw, rh).data;
    const colGold = new Array(rw).fill(0);
    for (let x = 0; x < rw; x++) {
        let c = 0;
        for (let y = 0; y < rh; y++) {
            const i = (y * rw + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            // gold: high R, mid-high G, low B, and R>=G
            if (r > 180 && g > 130 && b < 110 && r >= g - 10) c++;
        }
        colGold[x] = c;
    }
    const onThresh = Math.max(2, rh * 0.25);
    let stars = 0, inBlob = false, blobWidth = 0;
    const minBlobW = Math.max(2, Math.floor(rw * 0.03));
    for (let x = 0; x < rw; x++) {
        if (colGold[x] >= onThresh) { inBlob = true; blobWidth++; }
        else { if (inBlob && blobWidth >= minBlobW) stars++; inBlob = false; blobWidth = 0; }
    }
    if (inBlob && blobWidth >= minBlobW) stars++;
    return stars;
}
