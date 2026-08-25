// Header-currency reader — TS port of reverseForge/proto_currencies2.py, re-anchored for task C3.
//
// Each game screen prints a small set of currencies in "pills":
//   item  -> coin (crown)       + gem (diamond) + hammer (forge row)
//   pet   -> egg  (eggshell)    + gem
//   mount -> clock (windup key) + gem
//   skills-> ticket (green key)
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE WAS REWRITTEN (task C3 — "a cropped screenshot writes a confidently wrong number")
// ---------------------------------------------------------------------------------------------
// The previous version searched each currency icon inside a band expressed as a FRACTION OF THE
// FRAME (hammer: x 0.38-0.68, y 0.78-0.90 of the image). Crop 10% off an edge and every band lands
// on the wrong pixels: the hammer band slid onto the forge-row artwork, NCC still cleared its 0.60
// bar on a lookalike, and the glyph reader turned whatever was there into `6000000` where the truth
// was `97932`. The modal then offered that number pre-accepted at confidence 0.9. A fabricated
// value the user has to notice is far worse than a refusal.
//
// EVERY geometry here is now derived from a DETECTED feature, never from the frame:
//
//   1. ANCHOR. One icon is hunted over the WHOLE frame with an image pyramid (coarse pass at
//      COARSE_W, refined at CANON_W). No x/y band, no assumption about where the header is, so a
//      crop simply moves the anchor and everything moves with it. A candidate only BECOMES the
//      anchor once its own number pill reads as a valid currency: an icon-shaped thing with no
//      number beside it is a lookalike (the skills grid is full of them), and anchoring the whole
//      screen to it is how one bad NCC peak used to poison every other value. The anchor also fixes
//      the UI SCALE of the capture (matched icon size / template size), which makes the rest cheap.
//   2. HEADER COMPANIONS (coin/gem/egg/ticket) are searched in a band derived from the anchor: the
//      anchor's own row (y = anchor centre +/- ROW_TOL * anchorH) across the FULL image width, and
//      only at scales close to the anchor's. Same row, same size — two layout-free invariants.
//   3. PANEL CURRENCIES (hammer on the forge row, clock in the Mounts sub-panel) do not share the
//      header row, so they get their own full-frame pyramid hunt, gated by the anchor: the icon
//      must match at ~the anchor's scale (both templates were cut from the same canonical frame, so
//      the same UI scale matches both) and must sit BELOW the anchor. Crop-invariant, because both
//      conditions are relative to the anchor, not to the frame.
//   4. Two currencies may not resolve to the SAME icon. Every accepted icon is remembered and a
//      later currency whose best peak lands on top of one is refused — otherwise `coin` matches the
//      gem at 0.49 on a squeezed capture and reports the gem's number as a coin balance.
//   5. The NUMBER STRIP is bounded in ICON WIDTHS (STRIP_MAX_W), not by a band's right edge, the
//      glyph height is taken from the strip's left end (where the number certainly is, never from a
//      neighbouring icon further along), and the glyph run is cut at the first gap wider than a
//      glyph — so a neighbouring widget cannot be spliced onto the end of a number.
//
// A read is REFUSED (value null, currency absent from the result) whenever: no anchor was found,
// the icon was not found, the icon's scale disagrees with the anchor's, the icon duplicates one
// already used, the strip fell outside the image or was clipped shorter than STRIP_MIN_W icon
// widths, a glyph scored below GLYPH_MIN against the bank, the mean glyph score is below
// GLYPH_MEAN, the digit run does not match the strict currency grammar, or the two independent
// strip heights disagree on the value. `readCurrencies` returns only the currencies it stands
// behind; anything else is an explicit unknown.

import { loadImage, imageToCanvas, cropCanvas, evidenceCropUrl, type Rect } from './imagePrep';
import {
    loadGlyphBank, scoreGlyphChar, fitGlyph, connectedComponents, morphClose3, upscaleCanvas,
} from './numberReader';
import type { ScreenTemplate } from './templateClassifier';
import type { DetectedCurrencies, CurrencyCrops } from './readerTypes';

type CurrencyName = keyof DetectedCurrencies; // 'coin' | 'gem' | 'egg' | 'ticket' | 'clock' | 'hammer'
const ALL_CURRENCIES: CurrencyName[] = ['coin', 'gem', 'egg', 'ticket', 'clock', 'hammer'];

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

// Which icon anchors the read, most reliable first. The anchor is the one icon located without any
// prior — everything else is placed relative to it, so it has to be the sharpest template the screen
// shows AND the one whose number reads. `gem` is on every popup header; `ticket` is all the skills
// screen has; the MOUNT popup sits on a dimmed backdrop with no readable header at all, so its
// clockwinder (which is inside the popup) anchors that screen.
const ANCHOR_ORDER: Record<ScreenTemplate, CurrencyName[]> = {
    item: ['gem', 'coin', 'hammer'],
    pet: ['gem', 'egg'],
    mount: ['clock', 'gem'],
    skills: ['ticket'],
    clanTree: [],
    enemy: [],
    unknown: [],
};
// Currencies that are NOT on the header pill row and therefore need their own full-frame hunt.
const PANEL_CURR = new Set<CurrencyName>(['hammer', 'clock']);

const CANON_W = 576;                 // icon templates were cut at this frame width
const COARSE_W = 240;                // pyramid level for the full-frame hunts
const CHARSET = '0123456789.kmb'.split('');

// --- acceptance thresholds -------------------------------------------------------------------
// The anchor is found with no prior at all, so it must clear a higher bar than an icon that is
// already constrained to the anchor's row and size — and its pill has to read (see ANCHOR_ORDER).
// A real header icon matches its own template at 0.79-1.00 even on a 20%-cropped capture; the
// lookalikes that used to become anchors sat at 0.50-0.63. The clockwinder is the exception: it
// lives INSIDE the mount popup on a dimmed backdrop, where the real icon only reaches ~0.5.
const ANCHOR_THRESH = 0.68;
const ANCHOR_THRESH_BY: Record<string, number> = { clock: 0.50 };
const ANCHOR_CANDIDATES = 8;         // peaks tried, best score first, until one's pill reads
const COMPANION_THRESH = 0.50;
// hammer/clock sit on busy artwork rather than a clean header pill; a lax bar matches junk there.
const PANEL_THRESH: Record<string, number> = { hammer: 0.60, clock: 0.55 };
// An icon of the same UI, on the same capture, must match at ~the same template scale as the
// anchor. This is the invariant that replaces the old frame-fraction bands.
const SCALE_RATIO_LO = 0.70, SCALE_RATIO_HI = 1.45;
const ROW_TOL = 0.75;                // companion icon centre within this * anchorH of the anchor's
const BELOW_ANCHOR = 1.2;            // panel icons must start this * anchorH below the anchor top
// Number strip, in ICON widths (never a frame fraction). 3.0 covers the widest pill the game
// prints ("999.99b" / a 6-digit counter) with margin; longer strips reach the NEXT header widget,
// whose icon then dominates the glyph-height estimate and destroys the read.
const STRIP_MAX_W = 3.0;
const STRIP_MIN_W = 1.6;             // strip clipped shorter than this by the image edge -> refuse
// Where the strip starts, as a multiple of the matched icon width. The hammer template keeps 72% of
// its source (see loadIconTemplates) and its glyph ends at ~62% — so 0.90 lands in the clean pill
// between the icon and the first digit, where +0.15 landed ON the first digit at some scales and
// silently turned 97932 into .7932.
const STRIP_START: Record<string, number> = { hammer: 0.90 };
const STRIP_START_DEFAULT = 1.15;
// Half-height of the number band, in matched-icon heights. Wide enough for the pill's digits to sit
// slightly below the icon's centre (measured: +0.07 * iconH), tight enough to keep the row above and
// below out of the strip.
const BAND_HALF = 0.60, BAND_HALF_ALT = 0.48;
// A currency's digits are a FIXED fraction of the matched icon's height, per template — measured on
// real fixtures: gem/coin/egg/ticket 0.194-0.233, hammer 0.325-0.354. This is the reference that
// tells a digit from the pill's own bright capsule outline (1.5 * iconH) or from a neighbouring
// icon that fell inside the strip; before it existed the tallest blob in the strip set the scale,
// and on a clean skills/pet header that blob WAS the capsule, so every digit was filtered out as
// "too short" and the read collapsed to a stray dot.
const GLYPH_H_FRAC: Record<string, number> = {
    coin: 0.22, gem: 0.22, egg: 0.22, ticket: 0.22, hammer: 0.34, clock: 0.40,
};
const GLYPH_H_MAX = 1.7;             // a component taller than this * expected is not a glyph
// How cleanly the run has to match the digit bank. Real pill digits score 0.94-0.98 (worst 0.937
// across the fixtures); the fabrications that used to reach the modal scored 0.69-0.77 — including
// the one where the reader turned the words "Equipped Lv.41" into the ticket count "640100".
const GLYPH_MIN = 0.80;              // worst per-glyph bank score allowed in an accepted run
const GLYPH_MEAN = 0.86;             // mean per-glyph bank score allowed in an accepted run

// Icon size varies with header layout AND with cropping: a 20% crop re-normalises the frame to the
// canonical width, so the same icon is drawn 1.25x bigger. The ladder therefore runs past 1.0.
const SCALES: number[] = [];
for (let s = 0.45; s < 1.475; s += 0.05) SCALES.push(Math.round(s * 100) / 100);
// coarse ladder for the full-frame pass — every other rung, refined afterwards at CANON_W
const COARSE_SCALES = SCALES.filter((_, i) => i % 2 === 0);

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

/**
 * The grammar a currency pill can actually print: a bare integer, or 1-3 digits with an optional
 * two-decimal fraction and a k/m/b suffix. The OLD code ran `raw.match(/\d+(?:\.\d+)?[kmb]?/)`,
 * which HAPPILY EXTRACTED a number out of a string of junk glyphs — the second half of the C3
 * fabrication. Anything that is not exactly one of these forms is refused.
 */
const STRICT_CURRENCY = /^(?:\d{1,9}|\d{1,3}(?:\.\d{1,2})?[kmb])$/;
function strictParse(raw: string): number | null {
    if (!STRICT_CURRENCY.test(raw)) return null;
    if (/^0\d/.test(raw)) return null;             // the game never zero-pads a counter
    return parseCurrency(raw);
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

/** Sub-window of a GrayImg (clamped to the source). */
function subGray(src: GrayImg, x0: number, y0: number, x1: number, y1: number): GrayImg {
    const xa = Math.max(0, Math.min(src.w, Math.round(x0))), xb = Math.max(xa, Math.min(src.w, Math.round(x1)));
    const ya = Math.max(0, Math.min(src.h, Math.round(y0))), yb = Math.max(ya, Math.min(src.h, Math.round(y1)));
    const w = xb - xa, h = yb - ya;
    const d = new Float32Array(Math.max(0, w * h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = src.d[(ya + y) * src.w + (xa + x)];
    return { d, w, h };
}

let tplP: Promise<Record<CurrencyName, GrayImg>> | null = null;

function loadIconTemplates(): Promise<Record<CurrencyName, GrayImg>> {
    if (!tplP) {
        tplP = (async () => {
            const out = {} as Record<CurrencyName, GrayImg>;
            for (const name of ALL_CURRENCIES) {
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

/** A located icon. `scale` is the template scale that matched — i.e. the capture's UI scale. */
interface IconLoc { score: number; x: number; y: number; w: number; h: number; scale: number }
const NO_LOC: IconLoc = { score: -1, x: 0, y: 0, w: 0, h: 0, scale: 0 };

/**
 * Multi-scale TM_CCOEFF_NORMED peaks of `tpl` inside `region`, as up to `topK` spatially distinct
 * candidates (non-max suppressed by half a template width). Returning several matters for the
 * full-frame anchor hunt: the single global maximum can be a lookalike, and the true header icon
 * is then the runner-up that survives refinement.
 */
function nccPeaks(region: GrayImg, tpl: GrayImg, scales: number[], stride: number, topK: number): IconLoc[] {
    const { d: I, w: W, h: H } = region;
    if (W < 8 || H < 8) return [];
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

    const peaks: IconLoc[] = [];
    /** keep `cand` if it beats an overlapping peak, or extends the top-K list */
    const offer = (cand: IconLoc) => {
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const near = Math.abs(p.x - cand.x) < Math.max(4, cand.w * 0.5) && Math.abs(p.y - cand.y) < Math.max(4, cand.h * 0.5);
            if (near) { if (cand.score > p.score) peaks[i] = cand; return; }
        }
        peaks.push(cand);
        peaks.sort((a, b) => b.score - a.score);
        if (peaks.length > topK) peaks.length = topK;
    };

    for (const s of scales) {
        const tw = Math.round(tpl.w * s), th = Math.round(tpl.h * s);
        if (tw < 6 || th < 6 || tw > W || th > H) continue;
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
        // per-scale: the best few spatially separated positions, then a stride-1 polish of each
        const local: IconLoc[] = [];
        const offerLocal = (c: IconLoc) => {
            for (let i = 0; i < local.length; i++) {
                if (Math.abs(local[i].x - c.x) < tw * 0.6 && Math.abs(local[i].y - c.y) < th * 0.6) {
                    if (c.score > local[i].score) local[i] = c;
                    return;
                }
            }
            local.push(c);
            local.sort((a, b) => b.score - a.score);
            if (local.length > topK) local.length = topK;
        };
        for (let y = 0; y + th <= H; y += stride) for (let x = 0; x + tw <= W; x += stride) {
            const v = nccAt(x, y);
            if (v > -1) offerLocal({ score: v, x, y, w: tw, h: th, scale: s });
        }
        for (const c of local) {
            let best = c;
            const r = Math.max(1, stride);
            for (let y = Math.max(0, c.y - r); y <= Math.min(H - th, c.y + r); y++) {
                for (let x = Math.max(0, c.x - r); x <= Math.min(W - tw, c.x + r); x++) {
                    const v = nccAt(x, y);
                    if (v > best.score) best = { score: v, x, y, w: tw, h: th, scale: s };
                }
            }
            offer(best);
        }
    }
    return peaks;
}

/**
 * Hunt `tpl` over the WHOLE frame with a two-level pyramid: coarse peaks at COARSE_W (cheap, no
 * assumption about where the icon is), each refined at CANON_W in its own neighbourhood. This is
 * the only search in the file that has no prior — it is what makes the reader crop-invariant.
 * `scaleFilter`, when given, restricts the ladder (used to require ~the anchor's UI scale).
 * Returns the refined candidates, best score first.
 */
function huntFullFrame(
    canonGray: GrayImg, coarseGray: GrayImg, tpl: GrayImg,
    scaleFilter?: (s: number) => boolean,
): IconLoc[] {
    const f = canonGray.w / coarseGray.w;
    // The coarse pass matches the template at s/f — resized ONCE from the original, not twice.
    const coarseScales = COARSE_SCALES
        .filter(s => !scaleFilter || scaleFilter(s))
        .map(s => s / f)
        .filter(s => tpl.w * s >= 6 && tpl.h * s >= 6);
    if (!coarseScales.length) return [];
    const cands = nccPeaks(coarseGray, tpl, coarseScales, 2, ANCHOR_CANDIDATES);
    const out: IconLoc[] = [];
    for (const c of cands) {
        const cScale = c.scale * f;                     // back to canonical template scale
        const pad = Math.max(4, Math.round(3 * f));
        const x0 = c.x * f - pad, y0 = c.y * f - pad;
        const region = subGray(canonGray, x0, y0, c.x * f + c.w * f + pad, c.y * f + c.h * f + pad);
        // fine ladder around the coarse scale (the coarse rungs are every other SCALES entry, so
        // the true scale is at most one rung away)
        const fine = SCALES.filter(s => (!scaleFilter || scaleFilter(s)) && Math.abs(s - cScale) < 0.075);
        for (const r of nccPeaks(region, tpl, fine, 1, 1)) {
            out.push({ ...r, x: r.x + Math.max(0, Math.round(x0)), y: r.y + Math.max(0, Math.round(y0)) });
        }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
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

/** What a glyph run scored against the bank — the reader's own view of how clean the read was. */
interface PillRead {
    raw: string;            // the glyph run as read (after the gap cut and any noise trim)
    minScore: number;       // worst per-glyph bank score in `raw`
    meanScore: number;      // mean per-glyph bank score in `raw`
    glyphs: number;         // how many glyphs survived
    trimmed: number;        // how many edge glyphs were discarded as noise
    gapCut: boolean;        // the run was truncated at a gap wider than a glyph
}
const NO_PILL: PillRead = { raw: '', minScore: 0, meanScore: 0, glyphs: 0, trimmed: 0, gapCut: false };

const UPSCALE = 5;

/**
 * proto_currencies2.read_number: white top-hat glyph isolation + bank NCC over [0-9 . k m b].
 * `expGlyphH` is the digit height this pill should have, in strip pixels, derived from the matched
 * icon (GLYPH_H_FRAC) — the reference that separates digits from the capsule outline.
 */
async function readPillNumber(strip: HTMLCanvasElement, expGlyphH: number): Promise<PillRead> {
    if (strip.width < 4 || strip.height < 4) return NO_PILL;
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
    const up = upscaleCanvas(strip, UPSCALE);
    const W = up.width, H = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mn = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) mn[p] = Math.min(px[i], px[i + 1], px[i + 2]);
    // white top-hat: mn - open(mn) with a 31x31 rect (open = erode then dilate)
    const opened = slideExtreme(slideExtreme(mn, W, H, 15, true), W, H, 15, false);
    const th = new Float32Array(W * H);
    let thMax = 0;
    for (let p = 0; p < W * H; p++) { const v = mn[p] - opened[p]; th[p] = v; if (v > thMax) thMax = v; }
    if (thMax < 18) return NO_PILL;
    const thr = Math.max(22, Math.floor(0.35 * thMax));
    let mask: Uint8Array = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) if (th[p] > thr) mask[p] = 1;
    mask = morphClose3(mask, W, H);
    const { labels, stats } = connectedComponents(mask, W, H);
    if (!stats.length) return NO_PILL;
    // GLYPH-SIZED components only. The absolute cap comes from the ICON (see GLYPH_H_FRAC), which is
    // what keeps the pill's own capsule outline — a single bright component ~7x a digit tall and the
    // full width of the strip — out of the run and out of the height reference.
    const gExp = expGlyphH * UPSCALE;
    const sized = stats.filter(s => s.area >= 30 && s.w >= 3 && s.h <= GLYPH_H_MAX * gExp && s.w <= 2.2 * gExp);
    const full = sized.filter(s => s.h >= 0.45 * gExp);   // full-height glyphs (not dots)
    if (!full.length) return NO_PILL;
    const hmax = Math.max(...full.map(s => s.h));
    const centres = full.map(s => s.y + s.h / 2).sort((a, b) => a - b);
    const band = centres.length
        ? (centres.length % 2 ? centres[centres.length >> 1] : (centres[centres.length / 2 - 1] + centres[centres.length / 2]) / 2)
        : H * 0.5;
    const glyphs: { x: number; w: number; g: Float32Array; h: number }[] = [];
    for (const s of sized) {
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
        glyphs.push({ x: s.x, w: s.w, g, h: s.h });
    }
    glyphs.sort((a, b) => a.x - b.x);
    // THE NUMBER IS ONE UNINTERRUPTED RUN. Split at any gap wider than ~a glyph and keep the run
    // holding the most FULL-HEIGHT glyphs; a run of nothing but short specks is not a number.
    // (Truncating at the first gap instead was wrong in both directions: the strip starts beside the
    // icon, so a speck of icon edge at x~0 formed run 0 and cut the real digits off entirely, which
    // is why egg/ticket read as a bare "." on clean captures.)
    const runs: { x: number; w: number; g: Float32Array; h: number }[][] = [];
    for (const gl of glyphs) {
        const cur = runs[runs.length - 1];
        const prev = cur && cur[cur.length - 1];
        if (!cur || (gl.x - (prev!.x + prev!.w)) > 0.8 * hmax) runs.push([gl]);
        else cur.push(gl);
    }
    const gapCut = runs.length > 1;
    const fullCount = (run: typeof glyphs) => run.filter(g => g.h >= 0.55 * hmax).length;
    let run = runs[0] ?? [];
    for (const r of runs) if (fullCount(r) > fullCount(run)) run = r;
    if (!fullCount(run)) return NO_PILL;
    const chars: { c: string; score: number }[] = [];
    for (const { g, h } of run) {
        const cand: Record<string, number> = {};
        for (const c of CHARSET) cand[c] = scoreGlyphChar(bank, g, c);
        if (h < 0.45 * hmax) for (const c of CHARSET) if (c !== '.') cand[c] -= 0.4;
        let best = CHARSET[0], bs = -Infinity;
        for (const c of CHARSET) if (cand[c] > bs) { bs = cand[c]; best = c; }
        chars.push({ c: best, score: bs });
    }
    if (!chars.length) return NO_PILL;
    // NOISE TRIM: at most one glyph off each end, and only a clearly-bad one. The old code dropped
    // ANY glyph scoring under 0.15 wherever it sat, so a bad middle digit silently shortened the
    // number (97932 -> 9732). A weak glyph inside the run now fails the whole read instead.
    let trimmed = 0;
    if (chars.length > 1 && chars[0].score < 0.25) { chars.shift(); trimmed++; }
    if (chars.length > 1 && chars[chars.length - 1].score < 0.25) { chars.pop(); trimmed++; }
    const scores = chars.map(c => c.score);
    return {
        raw: chars.map(c => c.c).join(''),
        minScore: Math.min(...scores),
        meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
        glyphs: chars.length,
        trimmed,
        gapCut,
    };
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

/** Everything the reader knows about one currency read — observability for the probes, and the
 *  reason a value was refused. `value === null` always carries a `refusal`. */
export interface CurrencyReadDetail {
    name: CurrencyName;
    value: number | null;
    refusal?: string;
    icon?: { score: number; x: number; y: number; w: number; h: number; scale: number };
    raw?: string;
    minScore?: number;
    meanScore?: number;
    rect?: Rect;
    /** The exact strip the glyph pass ran on, as a data URL. Filled only when `debugStrips` is
     *  passed to readCurrenciesDetailed — the probes use it to see what the reader saw. */
    stripUrl?: string;
}

/**
 * Read one pill, given the icon that anchors it. Two independent strip heights are read and must
 * agree: the pill's glyphs are the same pixels either way, so a value that changes when the band
 * moves by 15% of an icon height was never really there.
 */
async function readPillAt(canon: HTMLCanvasElement, loc: IconLoc, name: CurrencyName, debugStrips = false): Promise<CurrencyReadDetail> {
    const H = canon.height, Wc = canon.width;
    const detail: CurrencyReadDetail = {
        name, value: null,
        icon: { score: loc.score, x: loc.x, y: loc.y, w: loc.w, h: loc.h, scale: loc.scale },
    };
    const cy = loc.y + loc.h / 2;
    const nx0 = Math.round(loc.x + (STRIP_START[name] ?? STRIP_START_DEFAULT) * loc.w);
    // strip length in ICON widths — never "to the edge of a frame-fraction band"
    const nx1 = Math.min(Wc, Math.round(nx0 + STRIP_MAX_W * loc.w));
    if (nx1 - nx0 < STRIP_MIN_W * loc.w) { detail.refusal = 'strip clipped by the image edge'; return detail; }

    const expGlyphH = (GLYPH_H_FRAC[name] ?? 0.22) * loc.h;
    let value: number | null = null, raw = '';
    for (const halfH of [BAND_HALF, BAND_HALF_ALT]) {
        const ny0 = Math.round(cy - halfH * loc.h), ny1 = Math.round(cy + halfH * loc.h);
        if (ny0 < 0 || ny1 > H) { detail.refusal = 'number band falls outside the image'; return detail; }
        if (ny1 - ny0 < 4) { detail.refusal = 'number band too short'; return detail; }
        const stripCanvas = cropCanvas(canon, { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 });
        if (debugStrips && halfH === BAND_HALF) { try { detail.stripUrl = stripCanvas.toDataURL('image/png'); } catch { /* tainted */ } }
        const pill = await readPillNumber(stripCanvas, expGlyphH);
        if (halfH === BAND_HALF) {
            raw = pill.raw;
            detail.raw = pill.raw; detail.minScore = Math.round(pill.minScore * 1000) / 1000;
            detail.meanScore = Math.round(pill.meanScore * 1000) / 1000;
            if (!pill.glyphs) { detail.refusal = 'no glyphs in the pill'; return detail; }
            if (pill.minScore < GLYPH_MIN) { detail.refusal = `glyph score ${pill.minScore.toFixed(2)} < ${GLYPH_MIN}`; return detail; }
            if (pill.meanScore < GLYPH_MEAN) { detail.refusal = `mean glyph score ${pill.meanScore.toFixed(2)} < ${GLYPH_MEAN}`; return detail; }
            value = strictParse(pill.raw);
            if (value === null) { detail.refusal = `"${pill.raw}" is not a currency number`; return detail; }
        } else {
            const alt = strictParse(pill.raw);
            if (alt !== value) { detail.refusal = `unstable: "${raw}" vs "${pill.raw}" across two band heights`; return detail; }
        }
    }
    detail.value = value;
    const ry0 = Math.min(loc.y, Math.round(cy - BAND_HALF * loc.h));
    detail.rect = {
        x: loc.x, y: ry0, w: nx1 - loc.x,
        h: Math.max(loc.y + loc.h, Math.round(cy + BAND_HALF * loc.h)) - ry0,
    };
    return detail;
}

/** Two currencies may not resolve to the same icon (see rule 4 in the file header). */
function overlapsUsed(loc: IconLoc, used: IconLoc[]): boolean {
    for (const u of used) {
        const dx = Math.abs((loc.x + loc.w / 2) - (u.x + u.w / 2));
        const dy = Math.abs((loc.y + loc.h / 2) - (u.y + u.h / 2));
        if (dx < 0.6 * Math.max(loc.w, u.w) && dy < 0.6 * Math.max(loc.h, u.h)) return true;
    }
    return false;
}

/**
 * Read the currencies shown on `screen` from a full-frame screenshot canvas, with the per-currency
 * diagnostics. See the file header for the anchoring method and the refusal rules.
 */
export async function readCurrenciesDetailed(
    canvas: HTMLCanvasElement, screen: ScreenTemplate, opts?: { debugStrips?: boolean },
): Promise<{
    details: CurrencyReadDetail[];
    anchor: { name: CurrencyName; loc: IconLoc } | null;
    /** Every anchor candidate that was tried and why it was rejected (observability only). */
    anchorTried: CurrencyReadDetail[];
}> {
    const dbg = !!opts?.debugStrips;
    const anchorTried: CurrencyReadDetail[] = [];
    const want = SCREEN_CURR[screen] ?? [];
    if (!want.length) return { details: [], anchor: null, anchorTried };
    const templates = await loadIconTemplates();
    const canon = canvasAtWidth(canvas, CANON_W);
    const canonGray = toGray(canon);
    const coarseGray = toGray(canvasAtWidth(canon, COARSE_W));

    // ---- 1. ANCHOR: the one icon located with no prior, over the whole frame — and only accepted
    // once its own pill reads as a currency. A lookalike with nothing readable beside it is not an
    // anchor, however well it matches.
    let anchor: { name: CurrencyName; loc: IconLoc } | null = null;
    let anchorDetail: CurrencyReadDetail | null = null;
    let anchorNote = 'no anchor icon found in the image';
    for (const name of ANCHOR_ORDER[screen] ?? []) {
        const cands = huntFullFrame(canonGray, coarseGray, templates[name]);
        const bar = ANCHOR_THRESH_BY[name] ?? ANCHOR_THRESH;
        for (const loc of cands) {
            if (loc.score < bar) break;                  // sorted by score: the rest are worse
            const d = await readPillAt(canon, loc, name, dbg);
            anchorTried.push(d);
            if (d.value !== null) { anchor = { name, loc }; anchorDetail = d; break; }
            anchorNote = `anchor candidate ${name} @${loc.score.toFixed(2)} rejected: ${d.refusal}`;
        }
        if (anchor) break;
    }
    if (!anchor || !anchorDetail) {
        return { details: want.map(name => ({ name, value: null, refusal: anchorNote })), anchor: null, anchorTried };
    }
    const a = anchor.loc;
    const scaleOk = (s: number) => s >= a.scale * SCALE_RATIO_LO && s <= a.scale * SCALE_RATIO_HI;

    // ---- 2/3/4. every wanted currency, placed relative to the anchor, no two on the same icon.
    const details: CurrencyReadDetail[] = [];
    const used: IconLoc[] = [a];
    for (const name of want) {
        try {
            if (name === anchor.name) { details.push(anchorDetail); continue; }
            let peaks: IconLoc[];
            let thresh: number;
            if (PANEL_CURR.has(name)) {
                // own panel: full-frame hunt, gated to the anchor's UI scale and to below the anchor
                thresh = PANEL_THRESH[name] ?? COMPANION_THRESH;
                peaks = huntFullFrame(canonGray, coarseGray, templates[name], scaleOk)
                    .filter(p => p.y >= a.y + BELOW_ANCHOR * a.h);
            } else {
                // header companion: the ANCHOR'S ROW, full image width, the anchor's scale
                thresh = COMPANION_THRESH;
                const rowCy = a.y + a.h / 2;
                const y0 = rowCy - (0.5 + ROW_TOL) * a.h, y1 = rowCy + (0.5 + ROW_TOL) * a.h;
                const band = subGray(canonGray, 0, y0, canonGray.w, y1);
                peaks = nccPeaks(band, templates[name], SCALES.filter(scaleOk), 2, 3)
                    .map(p => ({ ...p, y: p.y + Math.max(0, Math.round(y0)) }))
                    .filter(p => Math.abs(p.y + p.h / 2 - rowCy) <= ROW_TOL * a.h);
            }
            const fresh = peaks.filter(p => !overlapsUsed(p, used));
            const loc = fresh.find(p => p.score >= thresh);
            if (!loc) {
                const best = peaks[0]?.score ?? -1;
                details.push({
                    name, value: null,
                    refusal: peaks.length && fresh.length !== peaks.length && best >= thresh
                        ? 'best icon match is one another currency already claimed'
                        : `icon not found (best NCC ${best.toFixed(2)} < ${thresh})`,
                });
                continue;
            }
            used.push(loc);
            details.push(await readPillAt(canon, loc, name, dbg));
        } catch (e) {
            details.push({ name, value: null, refusal: `threw: ${(e as Error)?.message ?? e}` });
        }
    }
    return { details, anchor, anchorTried };
}

/**
 * Read the currencies shown on `screen` from a full-frame screenshot canvas. Returns a
 * DetectedCurrencies containing ONLY the currencies whose number the reader stands behind — every
 * other currency is absent, which the pipeline and the modal must read as "unknown", never as 0.
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
    const { details } = await readCurrenciesDetailed(canvas, screen);
    if (!details.length) return out;
    const canonW = CANON_W, canonH = Math.max(1, Math.round(canvas.height * CANON_W / canvas.width));
    const sx = canvas.width / canonW, sy = canvas.height / canonH;
    for (const d of details) {
        if (d.value === null) continue;
        out[d.name] = d.value;
        if (crops && d.rect) {
            crops[d.name] = evidenceCropUrl(canvas, {
                x: d.rect.x * sx, y: d.rect.y * sy, w: d.rect.w * sx, h: d.rect.h * sy,
            });
        }
    }
    return out;
}
