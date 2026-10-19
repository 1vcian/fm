// How the game lays its UI out on a screen of any shape, and how to turn any screenshot back into
// the phone-shaped frame every reader in this folder was calibrated on.
//
// FACTS (read from the game build, not fitted to screenshots):
//   * MainCanvasConfig.asset `_referenceResolution` = 1080 x 2331 (ScriptableMainCanvasConfig),
//     pushed into the main CanvasScaler by MainCanvasInitializeSystem.Initialize; the scaler is
//     ScaleWithScreenSize / MatchWidthOrHeight.
//   * MainCanvas.ScreenSizeChanged (il2cpp RVA 0x3EB74D8, build 2026_10_08) sets
//     matchWidthOrHeight = (1080 / 2331 < Camera.aspect) ? 1 : 0, so the reference box is FITTED
//     inside the screen: one canvas unit is min(W / 1080, H / 2331) screen pixels. A screen
//     narrower than 1080:2331 (every phone from 9:19.5 up) gets a 1080-unit-wide, taller canvas;
//     a wider one (16:9 phones, 4:3 and 3:2 tablets) gets a 2331-unit-tall, WIDER canvas.
//   * SafeAreaSystem.UpdateSafeArea pads the content top and bottom only (Screen.safeArea); the
//     sides are never padded.
//   * Prefab RectTransforms: every detail popup is a fixed-size, horizontally centred container
//     (EquippedItemPopup 896x420, Pet/Mount/Skin/SkillDetails 980..990 wide, the PlayerPvpProfile
//     popups 896x348 for an item and 896x420 for a pet/mount/skill, PlayerPvpProfile 982x1650);
//     the header currency widgets are anchored to the LEFT edge (eggshells / tickets / potions at
//     x=40, the main screen's PlayerProfile at x=44, 438 wide) or to the RIGHT edge (gems at right=0,
//     the main screen's Currencies at right=-75), all within ~200 units of the top of the safe area.
//
// CONSEQUENCE. On a wide screen the game draws the SAME fixed-size popups and panels in the middle
// and pushes the header widgets out to the screen edges; nothing is stretched sideways except
// backgrounds. So the phone-shaped frame (1080 units wide) a reader expects is recovered exactly by
// taking the centred 1080-unit strip, and, in the header band, the left-anchored widgets from the
// left edge and the right-anchored widgets from the right edge. No resampling: the strip keeps the
// screenshot's own pixels.
//
// A cropped phone screenshot can have the same aspect as a tablet, so the aspect alone never
// decides: the wide hypothesis is taken only when the frame itself shows a UI element at the size
// that hypothesis predicts (a popup card of one of the fixed widths above, or a header currency icon
// at the matching scale), and beats the phone hypothesis on that evidence. Without evidence the
// frame is left as it is, which is exactly what every reader did before.

import { loadImage, imageToCanvas, cropCanvas, trimDeviceBars, type Rect } from './imagePrep';

/** CanvasScaler reference resolution (MainCanvasConfig.asset). */
export const REF_W = 1080;
export const REF_H = 2331;
/** Rows (canvas units from the top) that hold the edge-anchored header widgets, with room for a
 *  tablet's safe-area padding above them (the widgets end ~200 units below the safe area). */
export const HEADER_BAND_UNITS = 300;
/** Where the left-anchored header block ends and the right-anchored one begins (canvas units in
 *  the phone frame): the main screen's PlayerProfile ends at 482, its coin widget starts at ~557
 *  (measured on the 576x1280 fixtures: profile right edge 247 px, coin left edge 297 px). */
export const HEADER_SPLIT_UNITS = 520;
/** Widths (canvas units) of the fixed-size white popup containers in the prefabs. */
const POPUP_WIDTHS_U = [896, 980, 982, 990, 1000];
const POPUP_W_TOL = 0.05;
/** Aspect the phone hypothesis cannot explain once it is this far past the reference aspect. */
const WIDE_MIN_RATIO = 1.06;

export interface UiFrame {
    /** Screen pixels per canvas unit under the chosen hypothesis. */
    pxPerUnit: number;
    /** 'phone' = width matched (the frame is already phone-shaped); 'wide' = height matched. */
    match: 'phone' | 'wide';
    /** Canvas size in units under the chosen hypothesis. */
    unitsW: number; unitsH: number;
    /** Why this hypothesis won (observability). */
    evidence: string;
}

/** Downscaled grayscale + near-white mask helpers (one pass, cheap). */
function sample(src: HTMLCanvasElement, maxDim: number): { d: Uint8ClampedArray; w: number; h: number; k: number } {
    const k = Math.min(1, maxDim / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0, w, h);
    return { d: ctx.getImageData(0, 0, w, h).data, w, h, k };
}

/** Widths (source px) of the wide near-white rectangles in the frame: popup cards. A card is a run
 *  of >= 6% of the rows whose longest near-white span is about the same width. */
export function whiteCardWidths(src: HTMLCanvasElement): number[] {
    const { d, w, h, k } = sample(src, 480);
    const span = new Int32Array(h);
    for (let y = 0; y < h; y++) {
        let best = 0, run = 0;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (Math.min(d[i], d[i + 1], d[i + 2]) > 222) { run++; if (run > best) best = run; } else run = 0;
        }
        span[y] = best;
    }
    const out: number[] = [];
    let y = 0;
    while (y < h) {
        if (span[y] < 0.25 * w) { y++; continue; }
        const y0 = y; const ws: number[] = [];
        while (y < h && span[y] > 0 && Math.abs(span[y] - span[y0]) <= 0.06 * span[y0]) { ws.push(span[y]); y++; }
        if (y - y0 >= 0.06 * h) {
            ws.sort((a, b) => a - b);
            out.push(ws[ws.length >> 1] / k);
        }
        if (y === y0) y++;
    }
    return out;
}

function popupWidthHit(cardPx: number, pxPerUnit: number): boolean {
    const u = cardPx / pxPerUnit;
    return POPUP_WIDTHS_U.some(pw => Math.abs(u - pw) <= POPUP_W_TOL * pw);
}

// ---------------------------------------------------------------- header-icon evidence
interface Gray { d: Float32Array; w: number; h: number }
let iconCache: Gray[] | null = null;
const ICON_NAMES = ['coin', 'gem', 'egg', 'ticket', 'tube'];
/** Header icon templates were cut from 576 px wide (1080-unit) phone frames. */
const TPL_PX_PER_UNIT = 576 / REF_W;
const EVIDENCE_SCALE = 0.5;

function toGray(c: HTMLCanvasElement): Gray {
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const p = ctx.getImageData(0, 0, c.width, c.height).data;
    const d = new Float32Array(c.width * c.height);
    for (let i = 0, q = 0; q < d.length; i += 4, q++) d[q] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    return { d, w: c.width, h: c.height };
}

async function iconTemplates(): Promise<Gray[]> {
    if (iconCache) return iconCache;
    const out: Gray[] = [];
    for (const n of ICON_NAMES) {
        try {
            const full = imageToCanvas(await loadImage(`${import.meta.env.BASE_URL}autosync/tpl/${n}.png`));
            // the left 68% drops the green "+" badge the coin/gem/egg/ticket pills share
            const keep = n === 'tube' ? full.width : Math.max(6, Math.round(full.width * 0.68));
            // matched at half the template scale: the evidence only has to tell two scales ~20%
            // or more apart, and a quarter of the pixels keeps this pass cheap
            out.push(toGray(cropCanvas(full, { x: 0, y: 0, w: keep, h: full.height }, EVIDENCE_SCALE)));
        } catch { /* a missing template only removes one piece of evidence */ }
    }
    iconCache = out;
    return out;
}

/** Best normalised cross-correlation of `t` anywhere in `r` (both grayscale), stride 1. */
function ncc(r: Gray, t: Gray): number {
    if (t.w > r.w || t.h > r.h || t.w < 6 || t.h < 6) return -1;
    const n = t.w * t.h;
    let ts = 0, ts2 = 0;
    for (let i = 0; i < n; i++) { ts += t.d[i]; ts2 += t.d[i] * t.d[i]; }
    const tm = ts / n, tv = Math.sqrt(Math.max(1e-6, ts2 - n * tm * tm));
    let best = -1;
    for (let y = 0; y + t.h <= r.h; y++) for (let x = 0; x + t.w <= r.w; x++) {
        let s = 0, s2 = 0, dot = 0;
        for (let j = 0; j < t.h; j++) {
            const ro = (y + j) * r.w + x, to = j * t.w;
            for (let i = 0; i < t.w; i++) { const v = r.d[ro + i]; s += v; s2 += v * v; dot += v * t.d[to + i]; }
        }
        const iv = s2 - s * s / n;
        if (iv <= 1e-6) continue;
        const v = (dot - s * tm) / (Math.sqrt(iv) * tv);
        if (v > best) best = v;
    }
    return best;
}

/** How well the header icons match at the scale a hypothesis predicts, searched in the header
 *  band at the frame's LEFT and RIGHT edges (where the widgets are anchored). */
async function headerIconScore(src: HTMLCanvasElement, pxPerUnit: number): Promise<number> {
    const tpls = await iconTemplates();
    if (!tpls.length) return -1;
    // work at the template scale: resample the header band so one unit = TPL_PX_PER_UNIT px
    const f = EVIDENCE_SCALE * TPL_PX_PER_UNIT / pxPerUnit;
    const bandH = Math.min(src.height, Math.round(HEADER_BAND_UNITS * pxPerUnit));
    const edgeW = Math.min(src.width, Math.round(620 * pxPerUnit));
    let best = -1;
    for (const side of [0, 1]) {
        const x = side === 0 ? 0 : src.width - edgeW;
        const c = cropCanvas(src, { x, y: 0, w: edgeW, h: bandH }, f);
        const g = toGray(c);
        for (const t of tpls) best = Math.max(best, ncc(g, t));
    }
    return best;
}

/**
 * Decide how the screenshot's UI is scaled. Pure geometry plus two pieces of measured evidence;
 * see the file header for the rule and why the aspect alone is not enough.
 */
export async function measureUiFrame(src: HTMLCanvasElement): Promise<UiFrame> {
    const W = src.width, H = src.height;
    const sPhone = W / REF_W, sWide = H / REF_H;
    const phone: UiFrame = { pxPerUnit: sPhone, match: 'phone', unitsW: REF_W, unitsH: H / sPhone, evidence: 'width matched' };
    // narrower than the reference box: the canvas is width matched, nothing to decide
    if (sPhone <= sWide * WIDE_MIN_RATIO) return phone;
    // a portrait game never renders a landscape frame; such a crop is a fragment, keep it as is
    if (W > H) return { ...phone, evidence: 'landscape fragment, kept as is' };
    const wide: UiFrame = { pxPerUnit: sWide, match: 'wide', unitsW: W / sWide, unitsH: REF_H, evidence: '' };

    const cards = findPopupCards(src).map(c => c.rect.w);
    const cardPhone = cards.some(c => popupWidthHit(c, sPhone));
    const cardWide = cards.some(c => popupWidthHit(c, sWide));
    if (cardWide && !cardPhone) return { ...wide, evidence: `popup card width matches the wide layout (${cards.map(Math.round).join(',')} px)` };
    if (cardPhone && !cardWide) return { ...phone, evidence: 'popup card width matches the phone layout' };

    const [iPhone, iWide] = await Promise.all([headerIconScore(src, sPhone), headerIconScore(src, sWide)]);
    if (iWide >= 0.70 && iWide > iPhone + 0.08) return { ...wide, evidence: `header icons match the wide layout (${iWide.toFixed(2)} vs ${iPhone.toFixed(2)})` };
    return { ...phone, evidence: `no evidence for the wide layout (icons ${iWide.toFixed(2)} vs ${iPhone.toFixed(2)})` };
}

/**
 * The phone-shaped frame (1080 canvas units wide) inside a screenshot, at the screenshot's own
 * pixel scale. Unchanged for a width-matched screenshot. For a height-matched one: the centred
 * 1080-unit strip, with the header band rebuilt from the left-anchored widgets at the left edge
 * and the right-anchored widgets at the right edge.
 */
export function phoneFrameFromWide(src: HTMLCanvasElement, f: UiFrame): HTMLCanvasElement {
    if (f.match !== 'wide') return src;
    const s = f.pxPerUnit;
    const outW = Math.round(REF_W * s);
    if (outW >= src.width - 2) return src;
    const c = document.createElement('canvas');
    c.width = outW; c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const x0 = Math.round((src.width - outW) / 2);
    ctx.drawImage(src, x0, 0, outW, src.height, 0, 0, outW, src.height);
    const band = Math.min(src.height, Math.round(HEADER_BAND_UNITS * s));
    const leftW = Math.round(HEADER_SPLIT_UNITS * s);
    const rightW = outW - leftW;
    ctx.drawImage(src, 0, 0, leftW, band, 0, 0, leftW, band);
    ctx.drawImage(src, src.width - rightW, 0, rightW, band, leftW, 0, rightW, band);
    return c;
}

/** The centred phone-frame rect in source px (for callers that only need the geometry). */
export function phoneFrameRect(src: HTMLCanvasElement, f: UiFrame): Rect {
    if (f.match !== 'wide') return { x: 0, y: 0, w: src.width, h: src.height };
    const w = Math.round(REF_W * f.pxPerUnit);
    return { x: Math.round((src.width - w) / 2), y: 0, w, h: src.height };
}

// =============================================================================================
// POPUP CONTAINERS: which fixed-size popup a frame shows, from its white card's PROPORTIONS.
// Height / width of the white container in the prefabs (scale-free, so valid on every device):
//   PlayerPvpProfileItemPopupUiView          896 x 348  -> 0.388   item popup on a profile card
//   PlayerPvpProfile{Pet,Mount,Skill}Popup   896 x 420  -> 0.469   pet / mount / skill on a card
//   EquippedItemPopupUiView                  896 x 420  -> 0.469   own item popup
//   SkinDetailsPopupUiView                   990 x 645  -> 0.652
//   Pet/MountDetailsUiView                   980/990 x 771 -> 0.787 / 0.779
//   SkillDetailsUiView                       980 x 889  -> 0.907
// =============================================================================================
export const POPUP_ASPECT = {
    cardItem: 348 / 896,
    cardUnit: 420 / 896,
    skin: 645 / 990,
    unitDetails: 771 / 985,
    skillDetails: 889 / 980,
} as const;
export type PopupKind = keyof typeof POPUP_ASPECT;
/** Half-width of an aspect bin. The closest two bins (0.388 / 0.469) are 0.08 apart. */
const ASPECT_TOL = 0.03;

export interface PopupCard { rect: Rect; aspect: number; kind: PopupKind | null }

/**
 * Near-white popup cards in a frame, largest first. A card starts on a row whose longest
 * near-white run is at least 40% of the frame width (its top edge is plain white) and continues
 * while both of its side margins stay white (the prefabs keep >= 35 units of white padding left of
 * the subject tile and right of the text), so text and tiles inside it never end it early.
 */
export function findPopupCards(src: HTMLCanvasElement): PopupCard[] {
    const { d, w, h, k } = sample(src, 520);
    const white = (x: number, y: number): boolean => {
        const i = (y * w + x) * 4;
        return Math.min(d[i], d[i + 1], d[i + 2]) > 222;
    };
    const out: PopupCard[] = [];
    let y = 0;
    while (y < h) {
        // longest white run on this row
        let bx0 = 0, bx1 = -1, run0 = -1;
        for (let x = 0; x <= w; x++) {
            if (x < w && white(x, y)) { if (run0 < 0) run0 = x; }
            else if (run0 >= 0) { if (x - run0 > bx1 - bx0 + 1) { bx0 = run0; bx1 = x - 1; } run0 = -1; }
        }
        const cw = bx1 - bx0 + 1;
        if (cw < 0.40 * w) { y++; continue; }
        const mL = Math.round(bx0 + 0.015 * cw), mR = Math.round(bx1 - 0.015 * cw);
        const y0 = y;
        let miss = 0;
        while (y < h) {
            const ok = white(mL, y) && white(mR, y);
            if (ok) miss = 0; else if (++miss > Math.max(1, Math.round(0.004 * h))) break;
            y++;
        }
        const y1 = y - miss;
        const ch = y1 - y0;
        if (ch >= 0.04 * h) {
            const aspect = ch / cw;
            let kind: PopupKind | null = null, bd = Infinity;
            for (const [kk, a] of Object.entries(POPUP_ASPECT) as [PopupKind, number][]) {
                const dd = Math.abs(aspect - a);
                if (dd < bd) { bd = dd; kind = kk; }
            }
            if (bd > ASPECT_TOL) kind = null;
            out.push({ rect: { x: bx0 / k, y: y0 / k, w: cw / k, h: ch / k }, aspect, kind });
        }
        y = Math.max(y, y0 + 1);
    }
    out.sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
    return out;
}

// =============================================================================================
// ENTRY POINT: every reader gets its screenshot through this.
// =============================================================================================
const prepared = new WeakSet<HTMLCanvasElement>();
const frameOf = new WeakMap<HTMLCanvasElement, UiFrame>();

/**
 * Decode a screenshot into the phone-shaped game frame the readers are calibrated on: a
 * height-matched (wide) capture is rebuilt with phoneFrameFromWide, a width-matched one only loses
 * device bars (imagePrep.trimDeviceBars). Idempotent: a canvas this returned comes back as is.
 */
export async function gameScreen(img: HTMLImageElement | HTMLCanvasElement): Promise<HTMLCanvasElement> {
    if (img instanceof HTMLCanvasElement && prepared.has(img)) return img;
    const raw = img instanceof HTMLCanvasElement ? img : imageToCanvas(img);
    const f = await measureUiFrame(raw);
    const out = f.match === 'wide' ? phoneFrameFromWide(raw, f) : trimDeviceBars(raw);
    prepared.add(out);
    frameOf.set(out, f);
    return out;
}

/** The UI-scale decision gameScreen took for a canvas it returned (observability). */
export function uiFrameOf(c: HTMLCanvasElement): UiFrame | undefined { return frameOf.get(c); }
