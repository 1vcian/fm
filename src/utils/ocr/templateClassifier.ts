// Template-driven screen classifier — faithful TS port of reverseForge/proto_screen.py
// (validated 17/17 on the example set; 9/24 on the harder train set whose popups sit on a
// fully-dimmed backdrop with no readable header).
// Identifies which layout template an uploaded screenshot is — item / pet / mount / skills /
// enemy — by region-gated NCC matching of the header CURRENCY icons (templates cut from real
// screenshots, public/autosync/tpl/*.png) plus a coloured-component count and a league-emblem
// hue test, via a priority cascade. Device-agnostic: normalizes to the canonical 576px width
// the templates were cut at.
import { loadImage, imageToCanvas } from './imagePrep';

export type ScreenTemplate = 'item' | 'pet' | 'mount' | 'skills' | 'clanTree' | 'enemy' | 'unknown';

export interface ClassifyResult {
    type: ScreenTemplate;
    currencies: Record<string, number>; // NCC score per currency
    tiles: number;
    emblem: number;
    confidence: number;
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
const TUBE_TH = 0.75;        // clan tech tree header icon (test tube) — checked before ticket

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
    if (cur.tube > TUBE_TH) type = 'clanTree';
    else if (cur.ticket > TH) type = 'skills';
    else if (cur.egg > TH) type = 'pet';
    else if (cur.clock > CLOCKWINDER_TH) type = 'mount';
    else if (cur.coin > 0.42 || cur.gem > TH) type = 'item';
    else if (tiles >= 6) type = 'enemy';
    else if (emblem > 0.03) type = 'enemy';
    else type = 'unknown';

    const conf = Math.max(cur.ticket, cur.egg, cur.tube, cur.clock, cur.coin, cur.gem, tiles >= 6 || emblem > 0.03 ? 0.6 : 0);
    return { type, currencies: cur, tiles, emblem, confidence: Math.min(1, Math.max(0, conf)) };
}
