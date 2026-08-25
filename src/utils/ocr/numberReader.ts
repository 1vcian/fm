// Number reader — TS port of reverseForge/digit_proto.py segmentation + the measured
// reader_bank_v2.py glyph bank (public/autosync/digitBank_v2.json).
//
// The bank extends the validated real-exemplar digit bank from 'Lv.0-9' to the full game-number
// charset  0-9 . , + % k m b t q L v : per label it carries SYNTHETIC exemplars (faithful
// Baloo/tile renders pushed through the same binarize+segment pipeline, plus a whole-char Baloo
// template) and REAL exemplars harvested from the training screenshots only (no test leakage).
// '%' is special: the white-core pipeline splits it into three components (%0 %1 %2) while the
// dark-ink card pipeline often keeps it whole (%w) — score('%') = max of the four.
//
// Matching is the measured winner (digit_proto.char_score, the blended softened-NN classifier
// that scored substats 25/26, mainstat 18/18, currencies 28/29, levels 35/39 in the Python
// bake-off — flat NCC voting collapsed to 2/26 on substats): each bank exemplar is a GROUP
// (real exemplars get the digit_proto.augment shift/scale/erode-dilate variants, synthetic ones
// stay single), a group contributes its best-aligned variant under
// ALPHA*HOG-lite-cosine + (1-ALPHA)*NCC, and the class score is the mean of the top-K(3) group
// scores. Glyphs are letterboxed into gw x gh preserving aspect and peak-normalized to 1
// (digit_proto.fit semantics). Level reads keep the charset 'Lv.0123456789'. Bound-checking is
// the caller's job; the modal keeps every number editable as the safety net.

interface GlyphVariant {
    zm: Float32Array;    // zero-meaned pixels (for NCC: dot(gz, zm) / (|gz| * nrm))
    nrm: number;         // L2 norm of zm
    desc: Float32Array;  // digit_proto.descriptor (L2-normed -> cosine == dot)
}
interface GlyphGroup { variants: GlyphVariant[]; w: number }
export interface GlyphBank { gw: number; gh: number; groups: Record<string, GlyphGroup[]> }
let bankP: Promise<GlyphBank> | null = null;

const LEVEL_CHARS = 'Lv.0123456789'.split('');
const PCT_PARTS = ['%0', '%1', '%2', '%w'];
const TOPK = 3;          // class score = mean of top-K group scores (softened NN)
const ALPHA = 0.6;       // blend: ALPHA*HOG-cosine + (1-ALPHA)*NCC

// ---------------------------------------------------------------- digit_proto.descriptor port
const ZR = 5, ZC = 5;    // zoning grid (ink-density cells)
const HR = 3, HC = 3;    // HOG grid
const NB = 9;            // orientation bins over [0, 360)
const WZ = 0.5;          // zoning-block weight vs HOG block

/** Reflect-101 index (cv2 BORDER_REFLECT_101) for i in [-1, n]. */
function ref101(i: number, n: number): number { return i < 0 ? -i : i >= n ? 2 * n - i - 2 : i; }

/**
 * Compact glyph descriptor, L2-normalized so cosine == dot product (digit_proto.descriptor):
 * a ZRxZC ink-density zoning block + an HRxHC grid of signed (0..360°) Sobel-orientation
 * histograms, magnitude-weighted; each block L2-normed, concat as [WZ*zon, (1-WZ)*hog], renorm.
 */
export function glyphDescriptor(g: Float32Array, W: number, H: number): Float32Array {
    const zon = new Float32Array(ZR * ZC);
    for (let i = 0; i < ZR; i++) {
        const y0 = Math.trunc(i * H / ZR), y1 = Math.trunc((i + 1) * H / ZR);
        for (let j = 0; j < ZC; j++) {
            const x0 = Math.trunc(j * W / ZC), x1 = Math.trunc((j + 1) * W / ZC);
            let s = 0, n = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += g[y * W + x]; n++; }
            zon[i * ZC + j] = n ? s / n : 0;
        }
    }
    // 3x3 Sobel (cv2 kernels, reflect-101 border)
    const hog = new Float32Array(HR * HC * NB);
    const binW = 360 / NB;
    for (let y = 0; y < H; y++) {
        const ym = ref101(y - 1, H) * W, y0r = y * W, yp = ref101(y + 1, H) * W;
        // exact numpy cell edges: linspace(0,H,HR+1).astype(int)
        let ci = 0;
        for (let i = HR - 1; i >= 0; i--) if (y >= Math.trunc(i * H / HR)) { ci = i; break; }
        for (let x = 0; x < W; x++) {
            const xm = ref101(x - 1, W), xp = ref101(x + 1, W);
            const a = g[ym + xm], b = g[ym + x], c = g[ym + xp];
            const d = g[y0r + xm], f = g[y0r + xp];
            const p = g[yp + xm], q = g[yp + x], r = g[yp + xp];
            const gx = (c + 2 * f + r) - (a + 2 * d + p);
            const gy = (p + 2 * q + r) - (a + 2 * b + c);
            const mag = Math.sqrt(gx * gx + gy * gy);
            if (mag <= 0) continue;
            let ang = Math.atan2(gy, gx) * 180 / Math.PI;
            ang = ((ang % 360) + 360) % 360;
            const bin = Math.min(NB - 1, Math.trunc(ang / binW));
            let cj = 0;
            for (let j = HC - 1; j >= 0; j--) if (x >= Math.trunc(j * W / HC)) { cj = j; break; }
            hog[(ci * HC + cj) * NB + bin] += mag;
        }
    }
    let zn = 0; for (let i = 0; i < zon.length; i++) zn += zon[i] * zon[i];
    zn = Math.sqrt(zn); if (zn > 1e-8) for (let i = 0; i < zon.length; i++) zon[i] /= zn;
    let hn = 0; for (let i = 0; i < hog.length; i++) hn += hog[i] * hog[i];
    hn = Math.sqrt(hn); if (hn > 1e-8) for (let i = 0; i < hog.length; i++) hog[i] /= hn;
    const feat = new Float32Array(zon.length + hog.length);
    for (let i = 0; i < zon.length; i++) feat[i] = WZ * zon[i];
    for (let i = 0; i < hog.length; i++) feat[zon.length + i] = (1 - WZ) * hog[i];
    let fn = 0; for (let i = 0; i < feat.length; i++) fn += feat[i] * feat[i];
    fn = Math.sqrt(fn); if (fn > 1e-8) for (let i = 0; i < feat.length; i++) feat[i] /= fn;
    return feat;
}

// ---------------------------------------------------------------- digit_proto.augment port
function shiftGlyph(g: Float32Array, W: number, H: number, dx: number, dy: number): Float32Array {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= H) continue;
        for (let x = 0; x < W; x++) {
            const sx = x - dx;
            if (sx >= 0 && sx < W) out[y * W + x] = g[sy * W + sx];
        }
    }
    return out;
}

function resizeBilinear(src: Float32Array, w: number, h: number, dw: number, dh: number): Float32Array {
    const out = new Float32Array(dw * dh);
    for (let y = 0; y < dh; y++) {
        const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / dh - 0.5));
        const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(h - 1, y0 + 1);
        for (let x = 0; x < dw; x++) {
            const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / dw - 0.5));
            const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(w - 1, x0 + 1);
            out[y * dw + x] = src[y0 * w + x0] * (1 - fx) * (1 - fy) + src[y0 * w + x1] * fx * (1 - fy)
                + src[y1 * w + x0] * (1 - fx) * fy + src[y1 * w + x1] * fx * fy;
        }
    }
    return out;
}

/** cv2 erode/dilate with a 2x2 kernel, default anchor (window [y-1..y]x[x-1..x]). */
function morph2x2(g: Float32Array, W: number, H: number, isMin: boolean): Float32Array {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let e = isMin ? Infinity : -Infinity;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0) continue;
            const v = g[yy * W + xx];
            if (isMin ? v < e : v > e) e = v;
        }
        out[y * W + x] = isFinite(e) ? e : 0;
    }
    return out;
}

/** digit_proto.augment: ±1/±2px shifts, ±3% scale (re-centred), 2x2 erode/dilate. */
function augmentGlyph(g: Float32Array, W: number, H: number): Float32Array[] {
    const out: Float32Array[] = [g];
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
        out.push(shiftGlyph(g, W, H, dx, dy));
    }
    for (const s of [0.97, 1.03]) {
        const rw = Math.max(1, Math.round(W * s)), rh = Math.max(1, Math.round(H * s));
        const r = resizeBilinear(g, W, H, rw, rh);
        const v = new Float32Array(W * H);
        if (s < 1) {
            const y0 = (H - rh) >> 1, x0 = (W - rw) >> 1;
            for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) v[(y0 + y) * W + (x0 + x)] = r[y * rw + x];
        } else {
            const y0 = (rh - H) >> 1, x0 = (rw - W) >> 1;
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) v[y * W + x] = r[(y0 + y) * rw + (x0 + x)];
        }
        out.push(v);
    }
    out.push(morph2x2(g, W, H, true));
    out.push(morph2x2(g, W, H, false));
    return out;
}

function makeVariant(pix: Float32Array, W: number, H: number): GlyphVariant {
    let m = 0; for (let i = 0; i < pix.length; i++) m += pix[i];
    m /= pix.length;
    const zm = new Float32Array(pix.length);
    let n2 = 0;
    for (let i = 0; i < pix.length; i++) { const v = pix[i] - m; zm[i] = v; n2 += v * v; }
    return { zm, nrm: Math.sqrt(n2), desc: glyphDescriptor(pix, W, H) };
}

export function loadGlyphBank(): Promise<GlyphBank> {
    if (!bankP) {
        bankP = fetch(`${import.meta.env.BASE_URL}autosync/digitBank_v2.json`).then(r => r.json()).then((j: any) => {
            const gw = j.gw as number, gh = j.gh as number;
            const dec = (b64: string): Float32Array => {
                const bin = atob(b64); const n = bin.length; const out = new Float32Array(n);
                for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i) / 255;
                return out;
            };
            const groups: Record<string, GlyphGroup[]> = {};
            for (const [lab, lists] of Object.entries<any>(j.chars || {})) {
                const gl: GlyphGroup[] = [];
                // synthetic exemplars: single-variant groups (bake-off build_value_bank semantics)
                for (const b of (lists.synth || []) as string[]) {
                    gl.push({ variants: [makeVariant(dec(b), gw, gh)], w: 1 });
                }
                // real exemplars: one group per source, expanded with the augment variants
                for (const b of (lists.real || []) as string[]) {
                    const pix = dec(b);
                    gl.push({ variants: augmentGlyph(pix, gw, gh).map(v => makeVariant(v, gw, gh)), w: 1 });
                }
                groups[lab] = gl;
            }
            return { gw, gh, groups };
        });
    }
    return bankP;
}

/** Letterbox a cropped grayscale glyph (row-major, 0..1) into gw x gh preserving aspect. */
export function fitGlyph(src: Float32Array, w: number, h: number, gw: number, gh: number): Float32Array {
    const out = new Float32Array(gw * gh);
    if (w === 0 || h === 0) return out;
    const s = Math.min(gh / h, gw / w);
    const rw = Math.max(1, Math.round(w * s)), rh = Math.max(1, Math.round(h * s));
    const ox = (gw - rw) >> 1, oy = (gh - rh) >> 1;
    for (let y = 0; y < rh; y++) {
        const sy = Math.min(h - 1, (y + 0.5) * h / rh - 0.5), y0 = Math.max(0, Math.floor(sy)), fy = sy - y0, y1 = Math.min(h - 1, y0 + 1);
        for (let x = 0; x < rw; x++) {
            const sx = Math.min(w - 1, (x + 0.5) * w / rw - 0.5), x0 = Math.max(0, Math.floor(sx)), fx = sx - x0, x1 = Math.min(w - 1, x0 + 1);
            const a = src[y0 * w + x0], b = src[y0 * w + x1], c = src[y1 * w + x0], d = src[y1 * w + x1];
            out[(oy + y) * gw + (ox + x)] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
        }
    }
    return out;
}

/** Per-glyph probe data reused across the whole charset (descriptor + zero-meaned pixels). */
interface Probe { d: Float32Array; gz: Float32Array; gn: number }
const probeCache = new WeakMap<Float32Array, Probe>();

function probeOf(bank: GlyphBank, g: Float32Array): Probe {
    let p = probeCache.get(g);
    if (!p) {
        let m = 0; for (let i = 0; i < g.length; i++) m += g[i];
        m /= g.length;
        const gz = new Float32Array(g.length);
        let n2 = 0;
        for (let i = 0; i < g.length; i++) { const v = g[i] - m; gz[i] = v; n2 += v * v; }
        p = { d: glyphDescriptor(g, bank.gw, bank.gh), gz, gn: Math.sqrt(n2) };
        probeCache.set(g, p);
    }
    return p;
}

/** digit_proto.char_score: each group contributes its best-aligned variant under the
 * ALPHA*HOG-cosine + (1-ALPHA)*NCC blend; class score = mean of the top-K group scores. */
function charScore(probe: Probe, groups: GlyphGroup[]): number {
    if (!groups.length) return -9;
    const { d, gz, gn } = probe;
    const scores: number[] = [];
    for (const grp of groups) {
        let best = -2;
        for (const v of grp.variants) {
            let cos = 0;
            for (let i = 0; i < d.length; i++) cos += d[i] * v.desc[i];
            let dot = 0;
            for (let i = 0; i < gz.length; i++) dot += gz[i] * v.zm[i];
            const den = gn * v.nrm;
            const ncc = den > 1e-6 ? dot / den : 0;
            const s = ALPHA * cos + (1 - ALPHA) * ncc;
            if (s > best) best = s;
        }
        scores.push(grp.w * best);
    }
    scores.sort((a, b) => b - a);
    const k = Math.min(TOPK, scores.length);
    let s = 0; for (let i = 0; i < k; i++) s += scores[i];
    return s / k;
}

/** Bank score of a fitted glyph for one char. '%' = max over its part/whole sub-labels. */
export function scoreGlyphChar(bank: GlyphBank, g: Float32Array, c: string): number {
    const probe = probeOf(bank, g);
    if (c === '%') {
        let best = -9;
        for (const p of PCT_PARTS) { const s = charScore(probe, bank.groups[p] ?? []); if (s > best) best = s; }
        return best;
    }
    return charScore(probe, bank.groups[c] ?? []);
}

// ---------------------------------------------------------------- shared segmentation utils

export interface CompStat { x: number; y: number; w: number; h: number; area: number; id: number }

/** 8-connected components over a 0/1 mask. Returns per-component stats + a label map (0 = bg). */
export function connectedComponents(mask: Uint8Array, W: number, H: number): { labels: Int32Array; stats: CompStat[] } {
    const labels = new Int32Array(W * H);
    const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
    const stats: CompStat[] = [];
    let next = 1;
    for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
        const s0 = sy * W + sx; if (!mask[s0] || labels[s0]) continue;
        const id = next++;
        let head = 0, tail = 0; qx[0] = sx; qy[0] = sy; tail = 1; labels[s0] = id;
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
        stats.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, area, id });
    }
    return { labels, stats };
}

/** 3x3 morphological close (dilate then erode) of a 0/1 mask, in place semantics like cv2. */
export function morphClose3(mask: Uint8Array, W: number, H: number): Uint8Array {
    const dil = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && mask[ny * W + nx]) { on = 1; break; }
        }
        dil[y * W + x] = on;
    }
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let on = 1;
        for (let dy = -1; dy <= 1 && on; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            // cv2 erode treats out-of-border as replicated; approximate by ignoring outside px
            if (nx >= 0 && nx < W && ny >= 0 && ny < H && !dil[ny * W + nx]) { on = 0; break; }
        }
        out[y * W + x] = on;
    }
    return out;
}

// -------- cv2 INTER_CUBIC upscale (bit-exact port; validated against cv2.resize in the
// bake-off scratch tests). Canvas' own smoothing blurs more than INTER_CUBIC, which bridged
// glyph gaps (a substat '.' merging into the digit next to it) and merged the skill icons'
// white bleed into the level text — every Python proto upsampled with INTER_CUBIC, so the
// segmentation only reproduces when the interpolator matches.
function cubicW(x: number): number {
    const a = -0.75, ax = Math.abs(x);
    if (ax <= 1) return (a + 2) * ax * ax * ax - (a + 3) * ax * ax + 1;
    if (ax < 2) return a * ax * ax * ax - 5 * a * ax * ax + 8 * a * ax - 4 * a;
    return 0;
}

/** Upscale a canvas by an integer factor with cv2-style bicubic interpolation. */
export function upscaleCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
    const w = src.width, h = src.height;
    const dw = Math.max(1, w * scale), dh = Math.max(1, h * scale);
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    const sctx = src.getContext('2d', { willReadFrequently: true })!;
    const dctx = c.getContext('2d', { willReadFrequently: true })!;
    const sp = sctx.getImageData(0, 0, w, h).data;
    const out = dctx.createImageData(dw, dh);
    const dp = out.data;
    const clampI = (v: number, n: number): number => v < 0 ? 0 : v >= n ? n - 1 : v;
    // horizontal pass into a float buffer (RGB; alpha forced opaque)
    const tmp = new Float32Array(dw * h * 3);
    for (let x = 0; x < dw; x++) {
        const sx = (x + 0.5) * w / dw - 0.5;
        const x0 = Math.floor(sx), fx = sx - x0;
        const w0 = cubicW(fx + 1), w1 = cubicW(fx), w2 = cubicW(fx - 1), w3 = cubicW(fx - 2);
        const xa = clampI(x0 - 1, w), xb = clampI(x0, w), xc = clampI(x0 + 1, w), xd = clampI(x0 + 2, w);
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let ch = 0; ch < 3; ch++) {
                tmp[(y * dw + x) * 3 + ch] =
                    w0 * sp[(row + xa) * 4 + ch] + w1 * sp[(row + xb) * 4 + ch] +
                    w2 * sp[(row + xc) * 4 + ch] + w3 * sp[(row + xd) * 4 + ch];
            }
        }
    }
    for (let y = 0; y < dh; y++) {
        const sy = (y + 0.5) * h / dh - 0.5;
        const y0 = Math.floor(sy), fy = sy - y0;
        const w0 = cubicW(fy + 1), w1 = cubicW(fy), w2 = cubicW(fy - 1), w3 = cubicW(fy - 2);
        const ya = clampI(y0 - 1, h), yb = clampI(y0, h), yc = clampI(y0 + 1, h), yd = clampI(y0 + 2, h);
        for (let x = 0; x < dw; x++) {
            for (let ch = 0; ch < 3; ch++) {
                const v = Math.round(
                    w0 * tmp[(ya * dw + x) * 3 + ch] + w1 * tmp[(yb * dw + x) * 3 + ch] +
                    w2 * tmp[(yc * dw + x) * 3 + ch] + w3 * tmp[(yd * dw + x) * 3 + ch]);
                dp[(y * dw + x) * 4 + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
            dp[(y * dw + x) * 4 + 3] = 255;
        }
    }
    dctx.putImageData(out, 0, 0);
    return c;
}

// ---------------------------------------------------------------- white-core level reader

interface Glyph { x: number; g: Float32Array; w: number; h: number; hmax: number }

/** Isolate white glyphs on an upscaled crop and return them left→right (star/stray removed). */
function segment(canvas: HTMLCanvasElement, bank: GlyphBank): Glyph[] {
    const scale = 4;
    const c = upscaleCanvas(canvas, scale);
    const W = c.width, H = c.height;
    const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    // white-core mask (min channel > 185) + grayscale min-channel intensity
    let mask: Uint8Array = new Uint8Array(W * H); const gray = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const r = px[i], gg = px[i + 1], b = px[i + 2]; const mn = Math.min(r, gg, b);
        gray[p] = mn; if (mn > 185) mask[p] = 1;
    }
    mask = morphClose3(mask, W, H); // digit_proto.glyphs applies a 3x3 close before labeling
    const { labels, stats } = connectedComponents(mask, W, H);
    if (!stats.length) return [];
    const hmax = Math.max(...stats.map(s => s.h));
    const centres = stats.filter(s => s.h > 0.6 * hmax).map(s => s.y + s.h / 2).sort((a, b) => a - b);
    const band = centres.length ? centres[centres.length >> 1] : H * 0.4;
    const glyphs: Glyph[] = [];
    for (const comp of stats) {
        if (comp.h < 0.28 * hmax || comp.area < 10 || comp.w < 2) continue;
        if (Math.abs((comp.y + comp.h / 2) - band) > 0.9 * hmax) continue; // drop star/stray below the line
        const gw = comp.w, gh = comp.h; const sub = new Float32Array(gw * gh);
        for (let yy = 0; yy < gh; yy++) for (let xx = 0; xx < gw; xx++) {
            const p = (comp.y + yy) * W + (comp.x + xx);
            if (labels[p] === comp.id) sub[yy * gw + xx] = gray[p];
        }
        let mx = 0; for (let i = 0; i < sub.length; i++) if (sub[i] > mx) mx = sub[i];
        if (mx > 1e-3) for (let i = 0; i < sub.length; i++) sub[i] /= mx;
        glyphs.push({ x: comp.x, g: fitGlyph(sub, gw, gh, bank.gw, bank.gh), w: gw, h: gh, hmax });
    }
    glyphs.sort((a, b) => a.x - b.x);
    return glyphs;
}

export interface NumberRead { value: number | null; raw: string; confidence: number }

/** Read an integer (level / count) from a tight crop containing white game-font text. */
export async function readNumber(canvas: HTMLCanvasElement): Promise<NumberRead> {
    const bank = await loadGlyphBank();
    const glyphs = segment(canvas, bank);
    if (!glyphs.length) return { value: null, raw: '', confidence: 0 };
    const hmax = Math.max(...glyphs.map(g => g.hmax));
    let raw = '', digits = '', conf = 0, nDig = 0;
    for (const { g, h } of glyphs) {
        const cand: Record<string, number> = {};
        for (const c of LEVEL_CHARS) cand[c] = scoreGlyphChar(bank, g, c);
        if (h < 0.5 * hmax) for (const c of '0123456789L') cand[c] -= 0.6; // short glyph = 'v'/'.'
        let best = 'L', bs = -Infinity;
        for (const c of LEVEL_CHARS) if (cand[c] > bs) { bs = cand[c]; best = c; }
        raw += best;
        if (best >= '0' && best <= '9') { digits += best; conf += bs; nDig++; }
    }
    return { value: digits ? parseInt(digits, 10) : null, raw, confidence: nDig ? conf / nDig : 0 };
}

// ---------------------------------------------------------------- dark-ink value reader
// Port of the measured eval_harness.value_raw_substat / read_number_main pipeline: the card's
// value token is DARK ink on the white popup card. Mask ink at 4x upscale (sat/brightness
// thresholds), invert to bright-on-dark, per-component letterbox to the bank size, valley-split
// touching digit runs (vetoed when the whole component already matches a char well), classify.

export interface InkValueOpts {
    /** charset to classify over, e.g. '0123456789.%+kmb' — '%' scores as max of its parts */
    chars: string;
    satMax: number;             // ink mask: (max-min) < satMax
    brMax: number;              // ink mask: (max+min)/2 < brMax
    splitWidthFactor: number;   // component wider than this × median digit width may be split
    splitVeto: number;          // ...unless its best char score exceeds this
    cutMargin: number;          // valley cuts stay this × med away from the component edges
    cutMinSep: number;          // and this × med away from each other
    shortFrac: number;          // component shorter than this × hmax is penalized as non-dot
    shortPenalty: string;       // the chars penalized (-0.4) on short components
}

/** Substat "+11.2%" tokens (validated 25/26 in the Python bake-off). */
export const SUBSTAT_VALUE_OPTS: InkValueOpts = {
    chars: '0123456789.%+kmb', satMax: 55, brMax: 215,
    splitWidthFactor: 1.75, splitVeto: 0.72, cutMargin: 0.35, cutMinSep: 0.65,
    shortFrac: 0.35, shortPenalty: '0123456789%+kmb',
};

/** Main-stat "1.87b" tokens (validated 18/18 in the Python bake-off). */
export const MAINSTAT_VALUE_OPTS: InkValueOpts = {
    chars: '0123456789.kmb', satMax: 60, brMax: 150,
    splitWidthFactor: 1.5, splitVeto: 0.75, cutMargin: 0.4, cutMinSep: 0.6,
    shortFrac: 0.45, shortPenalty: '0123456789kmb',
};

/**
 * Read a dark-ink value token crop into a raw glyph string over opts.chars.
 *
 * NOTE (task #43 audit): the `4` below is a fixed multiplier, so the glyph this pipeline masks and
 * matches grows with the device — measured on the real item popups, the mask glyph is 59px tall at
 * 576px wide, 96px at 923 and 133px at 1290. Because `opts.splitVeto` is an ABSOLUTE score against
 * a bank harvested at the 576 scale, that shows up as a read that changes with resolution
 * ('+13.7%' -> '+13.796' from 923 up: the '%' stops clearing the veto and is valley-split into
 * '9' + '6'). Normalising the factor to `4 * 576 / src.width` was tried and measured: it fixes the
 * 1290 read but breaks a JPEG-recompressed 923 one ('+72.9%' -> '+729%'), i.e. it trades one
 * misread for another. It is left as-is deliberately until there is a NATIVE high-resolution item
 * fixture to calibrate against — every item fixture in the repo is 576px native, so the larger
 * variants are upscales of the same pixels and cannot separate "device scale" from "resampling".
 * See reverseForge/scale_probe.mjs.
 */
export async function readInkValue(canvas: HTMLCanvasElement, opts: InkValueOpts): Promise<string> {
    const bank = await loadGlyphBank();
    const chars = opts.chars.split('');
    const up = upscaleCanvas(canvas, 4);
    const W = up.width, H = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);       // inverted brightness: ink becomes bright
    let mask: Uint8Array = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        const br = (mn + mx) >> 1, sat = mx - mn;
        gray[p] = 255 - (mn + mx) / 2;
        if (sat < opts.satMax && br < opts.brMax) mask[p] = 1;
    }
    mask = morphClose3(mask, W, H);
    const { labels, stats } = connectedComponents(mask, W, H);
    if (!stats.length) return '';
    const hmax = Math.max(...stats.map(s => s.h));
    const dbg: any[] | undefined = (globalThis as any).__INK_DEBUG__;
    if (dbg) dbg.push({ cw: W, ch: H, hmax, comps: stats.map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h, area: s.area })) });
    // TEXT-BAND filter (digit_proto.glyphs): tesseract's line y-band occasionally spans TWO text
    // rows (its bbox absorbs the tile border), so keep only components whose vertical centre sits
    // near the dominant row (median centre of the tall components). The measured Python pipeline
    // received single-row crops from its own row projection and never needed this; it is the same
    // primitive digit_proto validated for the level crops.
    const centres = stats.filter(s => s.h > 0.6 * hmax).map(s => s.y + s.h / 2).sort((a, b) => a - b);
    const band = centres.length ? centres[centres.length >> 1] : H * 0.5;
    type Box = { x: number; y: number; w: number; h: number; id: number };
    const boxes: Box[] = stats
        .filter(s => s.area >= 12 && s.h >= 0.18 * hmax && Math.abs((s.y + s.h / 2) - band) <= 0.9 * hmax)
        .map(s => ({ x: s.x, y: s.y, w: s.w, h: s.h, id: s.id }))
        .sort((a, b) => a.x - b.x);
    if (!boxes.length) return '';

    const glyphOf = (b: Box): Float32Array => {
        const sub = new Float32Array(b.w * b.h);
        for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
            const p = (b.y + yy) * W + (b.x + xx);
            if (labels[p] === b.id) sub[yy * b.w + xx] = gray[p];
        }
        const g = fitGlyph(sub, b.w, b.h, bank.gw, bank.gh);
        let mx = 0; for (let i = 0; i < g.length; i++) if (g[i] > mx) mx = g[i];
        if (mx > 1e-3) for (let i = 0; i < g.length; i++) g[i] /= mx;
        return g;
    };
    const scoresOf = (b: Box): Record<string, number> => {
        const g = glyphOf(b);
        const out: Record<string, number> = {};
        for (const c of chars) out[c] = scoreGlyphChar(bank, g, c);
        return out;
    };

    // typical full-height digit width -> the valley-split unit
    const dw = boxes.filter(b => b.h > 0.55 * hmax).map(b => b.w).sort((a, b) => a - b);
    const med = dw.length ? dw[dw.length >> 1] : 10;

    const split = (b: Box): Box[] => {
        if (b.w <= opts.splitWidthFactor * med) return [b];
        const sc = scoresOf(b);
        let best = -Infinity; for (const c of chars) if (sc[c] > best) best = sc[c];
        if (best > opts.splitVeto) return [b];          // already reads as ONE char (e.g. '%', 'm')
        const col = new Float32Array(b.w);
        for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
            if (labels[(b.y + yy) * W + (b.x + xx)] === b.id) col[xx]++;
        }
        const k = Math.max(1, Math.round(b.w / med) - 1);
        const m = Math.floor(opts.cutMargin * med);
        const cand: number[] = [];
        for (let cc = m; cc < b.w - m; cc++) cand.push(cc);
        cand.sort((a, c) => col[a] - col[c]);
        const cuts: number[] = [];
        for (const cc of cand) {
            if (cuts.every(e => Math.abs(cc - e) > opts.cutMinSep * med)) cuts.push(cc);
            if (cuts.length >= k) break;
        }
        const xs = [0, ...cuts.sort((a, c) => a - c), b.w];
        const out: Box[] = [];
        for (let i = 0; i + 1 < xs.length; i++) out.push({ x: b.x + xs[i], y: b.y, w: xs[i + 1] - xs[i], h: b.h, id: b.id });
        return out;
    };

    const sb: Box[] = [];
    for (const b of boxes) sb.push(...split(b));
    sb.sort((a, b) => a.x - b.x);

    let raw = '';
    for (const b of sb) {
        const cand = scoresOf(b);
        if (b.h < opts.shortFrac * hmax) for (const c of opts.shortPenalty) cand[c] -= 0.4;
        let best = chars[0], bs = -Infinity;
        for (const c of chars) if (cand[c] > bs) { bs = cand[c]; best = c; }
        raw += best;
    }
    return raw;
}

export function preloadNumberReader(): void { loadGlyphBank().catch(() => {}); }
