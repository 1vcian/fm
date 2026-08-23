// Header-currency reader — TS port of reverseForge/proto_currencies2.py (validated 28/29
// non-null values + clock 2/2 in the Python bake-off).
//
// Each game screen prints a small set of currencies in header "pills":
//   item  -> coin (crown)       + gem (diamond)
//   pet   -> egg  (eggshell)    + gem
//   mount -> clock (windup key) + gem
//   skills-> ticket (green key)
// Method (the measured one, not the old fixed-band tesseract read):
//   1. locate the currency ICON by multi-scale NCC of a real-screenshot template inside the
//      currency's known x/y band (the pill row's y varies per screen, so the icon anchors the
//      read). The mount CLOCKWINDER does NOT live in the top header: its pill sits in the
//      centred "Mounts" sub-panel (x 0.28-0.80, y 0.20-0.40 of the frame).
//   2. the white number sits RIGHT of the icon in a dark pill. A white top-hat on the
//      min-channel isolates the glyphs whether the frame is full-brightness or dimmed behind a
//      popup (plus a peak-rescale for the dimmed case), then each glyph is NCC-matched against
//      the digitBank_v2 exemplars over the charset [0-9 . k m b].
//
// Only the currencies the given screen actually shows are attempted; a currency whose number
// could not be read is simply omitted from the result (the modal keeps every value editable).

import { loadImage, imageToCanvas, cropCanvas, evidenceCropUrl, type Rect } from './imagePrep';
import {
    loadGlyphBank, scoreGlyphChar, fitGlyph, connectedComponents, morphClose3, upscaleCanvas,
} from './numberReader';
import type { ScreenTemplate } from './templateClassifier';
import type { DetectedCurrencies, CurrencyCrops } from './readerTypes';

type CurrencyName = keyof DetectedCurrencies; // 'coin' | 'gem' | 'egg' | 'ticket' | 'clock' | 'hammer'

// Which currencies each screen type actually displays. The HAMMER counter lives on the forge
// row behind ITEM popups only (user request: don't take it from pets/mounts).
const SCREEN_CURR: Record<ScreenTemplate, CurrencyName[]> = {
    item: ['coin', 'gem', 'hammer'],
    pet: ['egg', 'gem'],
    mount: ['clock', 'gem'],
    skills: ['ticket'],
    clanTree: [],
    enemy: [],
    unknown: [],
};

const CANON_W = 576;                 // icon templates were cut at this frame width
const ICON_THRESH = 0.42;            // min NCC to accept an icon location
// the hammer pill sits on the busy forge-row art (not a clean header), where a lax threshold
// matches junk on screens that don't even show the forge (e.g. the skin popup's close button)
const ICON_THRESH_BY: Partial<Record<CurrencyName, number>> = { hammer: 0.60 };
const CHARSET = '0123456789.kmb'.split('');

// icon x-bands (fractions of width); clock searches the centre sub-panel, not the header.
// The hammer pill sits on the forge row near the bottom of the frame, not the header.
const XBAND: Record<CurrencyName, [number, number]> = {
    egg: [0.0, 0.22], ticket: [0.0, 0.22],
    coin: [0.40, 0.74], gem: [0.64, 0.98],
    clock: [0.28, 0.80],
    hammer: [0.38, 0.68],
};
const YWIN: [number, number] = [0.02, 0.22];          // header pill row
const YBAND: Partial<Record<CurrencyName, [number, number]>> = { clock: [0.20, 0.40], hammer: [0.78, 0.90] };

// icon size varies with header layout (python: np.arange(0.45, 1.15, 0.05))
const SCALES: number[] = [];
for (let s = 0.45; s < 1.125; s += 0.05) SCALES.push(Math.round(s * 100) / 100);

/** Reduce a noisy OCR string to a currency magnitude, expanding a trailing k/m/b suffix. */
export function parseCurrency(raw: string): number | null {
    if (!raw) return null;
    const s = raw.toLowerCase().replace(/[^0-9.,kmb]/g, '');
    const m = s.match(/(\d[\d.,]*)\s*([kmb])?/);
    if (!m) return null;
    const suffix = m[2];
    let value: number;
    if (suffix) {
        // suffixed values carry a decimal fraction (e.g. "4.89m", "12.3k")
        value = parseFloat(m[1].replace(',', '.'));
        if (!isFinite(value)) return null;
        value *= suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1e9;
    } else {
        // bare integer — strip any stray grouping separators
        value = parseInt(m[1].replace(/[.,]/g, ''), 10);
        if (!isFinite(value)) return null;
    }
    return Math.round(value);
}

// ---------------------------------------------------------------- grayscale + template match
interface GrayImg { d: Float32Array; w: number; h: number }

function toGray(canvas: HTMLCanvasElement): GrayImg {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    const d = new Float32Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) d[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return { d, w, h };
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

let tplP: Promise<Record<CurrencyName, GrayImg>> | null = null;

function loadIconTemplates(): Promise<Record<CurrencyName, GrayImg>> {
    if (!tplP) {
        tplP = (async () => {
            const out = {} as Record<CurrencyName, GrayImg>;
            for (const name of ['coin', 'gem', 'egg', 'ticket', 'clock', 'hammer'] as CurrencyName[]) {
                const file = name === 'clock' ? 'clockwinder' : name;
                const img = await loadImage(`${import.meta.env.BASE_URL}autosync/tpl/${file}.png`);
                const full = imageToCanvas(img);
                // coin/gem/egg/ticket: keep the left 66% (drops the shared green '+' badge);
                // hammer: keep the left 72% — the template was cut with a sliver of the first
                // count digit on its right edge (glyph ends at ~col 25/40, digit starts ~col 30),
                // and keeping it made the number strip start AFTER that digit (97932 -> 7932);
                // clockwinder has nothing to trim.
                const keepW = name === 'clock' ? full.width
                    : name === 'hammer' ? Math.max(6, Math.round(full.width * 0.72))
                        : Math.max(6, Math.round(full.width * 0.66));
                out[name] = toGray(cropCanvas(full, { x: 0, y: 0, w: keepW, h: full.height }));
            }
            return out;
        })();
    }
    return tplP;
}

interface IconLoc { score: number; x: number; y: number; w: number; h: number }

/** Best multi-scale TM_CCOEFF_NORMED match of tpl inside region (coarse stride-2 + refine). */
function locateIcon(region: GrayImg, tpl: GrayImg): IconLoc {
    const { d: I, w: W, h: H } = region;
    // integral images for window mean / variance
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

    let best: IconLoc = { score: -1, x: 0, y: 0, w: 0, h: 0 };
    for (const s of SCALES) {
        const tw = Math.round(tpl.w * s), th = Math.round(tpl.h * s);
        if (tw < 8 || th < 8 || tw > W || th > H) continue;
        const T = resizeGray(tpl, tw, th).d;
        const n = tw * th;
        let tSum = 0, tSum2 = 0;
        for (let i = 0; i < n; i++) { tSum += T[i]; tSum2 += T[i] * T[i]; }
        const tMean = tSum / n, tVar = tSum2 - n * tMean * tMean;
        if (tVar <= 1e-6) continue;
        const tStd = Math.sqrt(tVar);
        const nccAt = (x: number, y: number): number => {
            const iSum = winSum(sat, x, y, tw, th);
            const iVar = winSum(sat2, x, y, tw, th) - iSum * iSum / n;
            if (iVar <= 1e-6) return -1;
            let dot = 0;
            for (let j = 0; j < th; j++) {
                const row = (y + j) * W + x, trow = j * tw;
                for (let i = 0; i < tw; i++) dot += I[row + i] * T[trow + i];
            }
            return (dot - iSum * tMean) / (Math.sqrt(iVar) * tStd);
        };
        // coarse pass (stride 2), then stride-1 refinement around the coarse peak
        let sBest = -1, sx = 0, sy = 0;
        for (let y = 0; y + th <= H; y += 2) for (let x = 0; x + tw <= W; x += 2) {
            const v = nccAt(x, y);
            if (v > sBest) { sBest = v; sx = x; sy = y; }
        }
        if (sBest < 0) continue;
        for (let y = Math.max(0, sy - 2); y <= Math.min(H - th, sy + 2); y++) {
            for (let x = Math.max(0, sx - 2); x <= Math.min(W - tw, sx + 2); x++) {
                const v = nccAt(x, y);
                if (v > sBest) { sBest = v; sx = x; sy = y; }
            }
        }
        if (sBest > best.score) best = { score: sBest, x: sx, y: sy, w: tw, h: th };
    }
    return best;
}

// ---------------------------------------------------------------- white-pill number reading

/** Separable sliding-window min/max filter (window 2r+1, replicate borders via clamping). */
function slideExtreme(src: Float32Array, W: number, H: number, r: number, isMin: boolean): Float32Array {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let e = src[y * W + Math.max(0, x - r)];
            for (let k = Math.max(0, x - r) + 1; k <= Math.min(W - 1, x + r); k++) {
                const v = src[y * W + k];
                if (isMin ? v < e : v > e) e = v;
            }
            tmp[y * W + x] = e;
        }
    }
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            let e = tmp[Math.max(0, y - r) * W + x];
            for (let k = Math.max(0, y - r) + 1; k <= Math.min(H - 1, y + r); k++) {
                const v = tmp[k * W + x];
                if (isMin ? v < e : v > e) e = v;
            }
            out[y * W + x] = e;
        }
    }
    return out;
}

/** proto_currencies2.read_number: white top-hat glyph isolation + bank NCC over [0-9 . k m b]. */
async function readPillNumber(strip: HTMLCanvasElement): Promise<string> {
    if (strip.width < 4 || strip.height < 4) return '';
    const bank = await loadGlyphBank();
    // DIMMED-FRAME HARDENING: behind a popup the pill is drawn on a darkened backdrop; rescale
    // so the brightest pixel maps to ~220 (near-identity on already-bright frames).
    {
        const ctx = strip.getContext('2d', { willReadFrequently: true })!;
        const img = ctx.getImageData(0, 0, strip.width, strip.height);
        const d = img.data;
        let pk = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i] > pk) pk = d[i]; if (d[i + 1] > pk) pk = d[i + 1]; if (d[i + 2] > pk) pk = d[i + 2]; }
        if (pk > 0 && pk < 200) {
            const f = 220 / pk;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = Math.min(255, d[i] * f); d[i + 1] = Math.min(255, d[i + 1] * f); d[i + 2] = Math.min(255, d[i + 2] * f);
            }
            ctx.putImageData(img, 0, 0);
        }
    }
    const up = upscaleCanvas(strip, 5);
    const W = up.width, H = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mn = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) mn[p] = Math.min(px[i], px[i + 1], px[i + 2]);
    // white top-hat: mn - open(mn) with a 31x31 rect (open = erode then dilate)
    const opened = slideExtreme(slideExtreme(mn, W, H, 15, true), W, H, 15, false);
    const th = new Float32Array(W * H);
    let thMax = 0;
    for (let p = 0; p < W * H; p++) { const v = mn[p] - opened[p]; th[p] = v; if (v > thMax) thMax = v; }
    if (thMax < 18) return '';
    const thr = Math.max(22, Math.floor(0.35 * thMax));
    let mask: Uint8Array = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) if (th[p] > thr) mask[p] = 1;
    mask = morphClose3(mask, W, H);
    const { labels, stats } = connectedComponents(mask, W, H);
    if (!stats.length) return '';
    const hmax = Math.max(...stats.map(s => s.h));
    const centres = stats.filter(s => s.h > 0.6 * hmax).map(s => s.y + s.h / 2).sort((a, b) => a - b);
    const band = centres.length
        ? (centres.length % 2 ? centres[centres.length >> 1] : (centres[centres.length / 2 - 1] + centres[centres.length / 2]) / 2)
        : H * 0.5;
    const glyphs: { x: number; g: Float32Array; h: number }[] = [];
    for (const s of stats) {
        if (s.area < 30 || s.w < 3) continue;
        const cy = s.y + s.h / 2;
        const isDot = s.h < 0.45 * hmax;
        if (isDot) {
            // a decimal dot: short, sits low near the baseline
            if (!(cy > band && s.area < 0.25 * hmax * hmax && s.w < 0.6 * hmax)) continue;
        } else if (s.h < 0.55 * hmax) continue;      // neither full glyph nor plausible dot
        if (Math.abs(cy - band) > 0.9 * hmax) continue;
        const sub = new Float32Array(s.w * s.h);
        for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) {
            const p = (s.y + yy) * W + (s.x + xx);
            if (labels[p] === s.id) sub[yy * s.w + xx] = mn[p];
        }
        const g = fitGlyph(sub, s.w, s.h, bank.gw, bank.gh);
        let mx = 0; for (let i = 0; i < g.length; i++) if (g[i] > mx) mx = g[i];
        if (mx > 1e-3) for (let i = 0; i < g.length; i++) g[i] /= mx;
        glyphs.push({ x: s.x, g, h: s.h });
    }
    glyphs.sort((a, b) => a.x - b.x);
    let raw = '';
    for (const { g, h } of glyphs) {
        const cand: Record<string, number> = {};
        for (const c of CHARSET) cand[c] = scoreGlyphChar(bank, g, c);
        if (h < 0.45 * hmax) for (const c of CHARSET) if (c !== '.') cand[c] -= 0.4;
        let best = CHARSET[0], bs = -Infinity;
        for (const c of CHARSET) if (cand[c] > bs) { bs = cand[c]; best = c; }
        if (bs < 0.15) continue;
        raw += best;
    }
    return raw;
}

// ---------------------------------------------------------------- per-currency read
function canvasAtWidth(src: HTMLCanvasElement, cw: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = cw; c.height = Math.max(1, Math.round(src.height * cw / src.width));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
}

async function readCurrency(
    canon: HTMLCanvasElement, name: CurrencyName,
): Promise<{ value: number | null; rect: Rect | null }> {
    const templates = await loadIconTemplates();
    const W = canon.width, H = canon.height;
    const [xa, xb] = XBAND[name];
    const [ya, yb] = YBAND[name] ?? YWIN;
    const regionRect: Rect = {
        x: Math.round(W * xa), y: Math.round(H * ya),
        w: Math.round(W * (xb - xa)), h: Math.round(H * (yb - ya)),
    };
    if (regionRect.w < 8 || regionRect.h < 8) return { value: null, rect: null };
    const regionCanvas = cropCanvas(canon, regionRect);
    const loc = locateIcon(toGray(regionCanvas), templates[name]);
    if (loc.score < (ICON_THRESH_BY[name] ?? ICON_THRESH)) return { value: null, rect: null };
    // number strip: right of the icon, y-band centred on the icon
    const cy = loc.y + loc.h / 2;
    const ny0 = Math.max(0, Math.round(cy - 0.75 * loc.h));
    const ny1 = Math.min(regionCanvas.height, Math.round(cy + 0.75 * loc.h));
    const nx0 = Math.min(regionCanvas.width, loc.x + loc.w + Math.round(0.15 * loc.w));
    if (ny1 - ny0 < 4 || regionCanvas.width - nx0 < 4) return { value: null, rect: null };
    // evidence rect (canon coords): the located icon + its full number strip, together
    const rect: Rect = {
        x: regionRect.x + loc.x,
        y: regionRect.y + Math.min(loc.y, ny0),
        w: regionCanvas.width - loc.x,
        h: Math.max(loc.y + loc.h, ny1) - Math.min(loc.y, ny0),
    };
    const strip = cropCanvas(regionCanvas, { x: nx0, y: ny0, w: regionCanvas.width - nx0, h: ny1 - ny0 });
    const raw = await readPillNumber(strip);
    const m = raw.match(/\d+(?:\.\d+)?[kmb]?/);   // proto_currencies2.clean
    return { value: m ? parseCurrency(m[0]) : null, rect };
}

/**
 * Read the currencies shown on `screen` from a full-frame screenshot canvas. Returns a
 * DetectedCurrencies containing only the currencies whose number was successfully read.
 * `crops`, if given, is filled with a per-currency evidence crop (icon + number strip, cut from
 * the ORIGINAL-resolution canvas) for every currency that produced a value — additive
 * observability for the diff modal; passing it changes nothing about the reads.
 */
export async function readCurrencies(
    canvas: HTMLCanvasElement,
    screen: ScreenTemplate,
    crops?: CurrencyCrops,
): Promise<DetectedCurrencies> {
    const out: DetectedCurrencies = {};
    const want = SCREEN_CURR[screen] ?? [];
    if (!want.length) return out;
    const canon = canvasAtWidth(canvas, CANON_W);
    const sx = canvas.width / canon.width, sy = canvas.height / canon.height;
    for (const name of want) {
        try {
            const { value, rect } = await readCurrency(canon, name);
            if (value !== null) {
                out[name] = value;
                if (crops && rect) {
                    crops[name] = evidenceCropUrl(canvas, {
                        x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy,
                    });
                }
            }
        } catch { /* unreadable pill -> omit */ }
    }
    return out;
}
