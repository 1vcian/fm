// Geometry of the player profile card ("enemy panel"), shared by the card reader.
//
// The card is a fixed UI layout that the game scales uniformly with the screen width, so every
// region is expressed once in REFERENCE pixels (a 576 px wide capture, the size of every fixture in
// reverseForge/fixtures/forge/) and mapped onto the screenshot through ONE anchor found in the
// image itself: the battle-preview box (the green grass + brown path panel under the header).
// That panel is the most distinctive thing on the card, it survives the modal dimming when another
// popup is opened on top, and no popup ever covers it. Its left/right path edges give the scale,
// its top border gives the vertical origin; nothing else is assumed about the device.
//
// Measured on the 17 forge fixtures (576x1280): preview box top border at y=367, brown path at
// x=61..513 on every card, bright or dimmed. The other reference rects below were measured on the
// same fixtures (tiles: detectItemLattice / findStarTiles output; text rows: ink row profiles).

import type { Rect } from './imagePrep';

/** Reference-space anchor values. */
const REF_BOX_TOP = 367;
const REF_PATH_X0 = 61;
const REF_PATH_W = 453;

/** Reference rects (576-wide capture). */
export const REF = {
    /** "Lv. N Forge [stars]", "X Total Damage", "Y Total Health" (right-aligned, 3 rows). */
    header: { x: 300, y: 281, w: 215, h: 55 },
    headerRows: [{ y: 284, h: 19 }, { y: 302, h: 17 }, { y: 319, h: 15 }],
    /** Player name (white text, black outline) right of the avatar. */
    name: { x: 133, y: 262, w: 215, h: 27 },
    /** Item tiles: row 1 Helmet, Body, Gloves, Necklace, Ring; row 2 Weapon, Shoe, Belt. */
    itemCols: [84, 170, 255, 340, 426],
    itemRows: [563, 652],
    itemW: 66, itemH: 67,
    mount: { x: 340, y: 652, w: 151, h: 67 },
    /** Round icons (skills) then rounded squares (pets), left to right. */
    circles: [82, 136, 189].map(x => ({ x, y: 746, w: 47, h: 47 })),
    squares: [244, 297, 350].map(x => ({ x, y: 748, w: 45, h: 45 })),
    fairy: { x: 438, y: 738, w: 70, h: 52 },
    fairyLevel: { x: 438, y: 785, w: 70, h: 24 },
    /** Scrolling stat list viewport (lines are clipped at its top/bottom edge). */
    stats: { x: 98, y: 808, w: 410, h: 163 },
    /** Card background samples (left margin strip, inside the card, below the preview). */
    bgStrip: { x: 36, y: 540, w: 16, h: 420 },
};

export interface CardAnchor {
    /** Source px per reference px. */
    s: number;
    /** Source x of reference x=REF_PATH_X0, source y of reference y=REF_BOX_TOP. */
    x0: number; y0: number;
}

export function refRect(a: CardAnchor, r: { x: number; y: number; w: number; h: number }): Rect {
    return {
        x: Math.round(a.x0 + (r.x - REF_PATH_X0) * a.s),
        y: Math.round(a.y0 + (r.y - REF_BOX_TOP) * a.s),
        w: Math.max(1, Math.round(r.w * a.s)),
        h: Math.max(1, Math.round(r.h * a.s)),
    };
}

function hue(r: number, g: number, b: number): number {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return -1;
    let h: number;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360; return h;
}

/**
 * Find the battle-preview box and derive the anchor. Returns null when the screenshot does not
 * show a profile card (no brown path band at least half a frame wide, or no green grass + dark
 * border above it).
 */
export function locateCard(src: HTMLCanvasElement): CardAnchor | null {
    const W = src.width, H = src.height;
    const px = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const isPath = (i: number) => {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 55 || (mx - mn) / mx < 0.3) return false;
        const h = hue(r, g, b);
        return h > 15 && h < 45;
    };
    const isGrass = (i: number) => {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 35 || (mx - mn) / mx < 0.4) return false;
        const h = hue(r, g, b);
        return h > 70 && h < 160;
    };
    // rows where the path covers more than half the frame width (sampled every 2nd px)
    const step = Math.max(1, Math.round(W / 576));
    // longest run of such rows (a stray orange strip elsewhere is much shorter)
    let bandTop = -1, bandRows = 0, runTop = -1;
    const yEnd = Math.round(0.70 * H);
    for (let y = Math.round(0.10 * H); y <= yEnd; y++) {
        let on = false;
        if (y < yEnd) {
            let n = 0, t = 0;
            for (let x = 0; x < W; x += step) { t++; if (isPath((y * W + x) * 4)) n++; }
            on = n > 0.5 * t;
        }
        if (on) { if (runTop < 0) runTop = y; }
        else if (runTop >= 0) {
            if (y - runTop > bandRows) { bandRows = y - runTop; bandTop = runTop; }
            runTop = -1;
        }
    }
    if (bandTop < 0 || bandRows < 0.08 * W) return null;
    // path x extent from the column profile over the band
    const y0b = bandTop, y1b = bandTop + bandRows;
    const cols = new Int32Array(W);
    for (let y = y0b; y < y1b; y += step) for (let x = 0; x < W; x++) if (isPath((y * W + x) * 4)) cols[x]++;
    const need = 0.5 * Math.ceil(bandRows / step);
    let x0 = -1, x1 = -1;
    for (let x = 0; x < W; x++) if (cols[x] > need) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 < 0 || x1 - x0 < 0.5 * W) return null;
    const s = (x1 - x0 + 1) / REF_PATH_W;
    // walk up from the path through the grass to the dark top border of the box
    const cx0 = Math.round(x0 + 0.1 * (x1 - x0)), cx1 = Math.round(x1 - 0.1 * (x1 - x0));
    let top = -1;
    let sawGrass = false;
    for (let y = bandTop - 1; y > bandTop - 80 * s && y > 0; y--) {
        let grass = 0, dark = 0, t = 0;
        for (let x = cx0; x < cx1; x += step) {
            const i = (y * W + x) * 4; t++;
            if (isGrass(i)) grass++;
            else if (Math.max(px[i], px[i + 1], px[i + 2]) < 45) dark++;
        }
        if (grass > 0.5 * t) sawGrass = true;
        else if (sawGrass && dark > 0.5 * t) { top = y; break; }
    }
    if (top < 0) return null;
    // the border is ~2-3 px; take its topmost dark row
    while (top > 0) {
        let dark = 0, t = 0;
        for (let x = cx0; x < cx1; x += step) { const i = ((top - 1) * W + x) * 4; t++; if (Math.max(px[i], px[i + 1], px[i + 2]) < 45) dark++; }
        if (dark > 0.5 * t) top--; else break;
    }
    return { s, x0, y0: top };
}

export interface CardSurface {
    /** The canvas the readers sample: the screenshot itself, or an undimmed copy of it. */
    canvas: HTMLCanvasElement;
    /** Card background luminance as captured (about 255 bright, about 88 under a modal dim). */
    bgLevel: number;
    dimmed: boolean;
    /** True where the ORIGINAL pixel is brighter than the dimmed card could be: a popup on top. */
    occluded: Uint8Array | null;
}

/**
 * When another popup is open over the card, the game dims the card with a uniform black overlay
 * (measured: white card -> grey 88, preview path (213,152,87) -> (71,49,25), i.e. one factor on
 * every channel). Dividing by that factor restores the colours every palette and threshold here
 * was calibrated on. Pixels brighter than the dimmed white belong to the popup on top and are
 * flagged as occluded so no reader trusts them.
 */
export function prepareSurface(src: HTMLCanvasElement, a: CardAnchor): CardSurface {
    const r = refRect(a, REF.bgStrip);
    const W = src.width, H = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    const w = Math.max(1, Math.min(W - x, r.w)), h = Math.max(1, Math.min(H - y, r.h));
    const d = ctx.getImageData(x, y, w, h).data;
    const lum: number[] = [];
    for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx - mn < 20) lum.push((d[i] + d[i + 1] + d[i + 2]) / 3);
    }
    lum.sort((p, q) => p - q);
    const bgLevel = lum.length ? lum[lum.length >> 1] : 255;
    if (bgLevel >= 225) return { canvas: src, bgLevel, dimmed: false, occluded: null };

    const k = 255 / Math.max(30, bgLevel);
    const img = ctx.getImageData(0, 0, W, H);
    const p = img.data;
    const occluded = new Uint8Array(W * H);
    const cut = bgLevel + 45;
    for (let i = 0, q = 0; i < p.length; i += 4, q++) {
        const L = (p[i] + p[i + 1] + p[i + 2]) / 3;
        if (L > cut) occluded[q] = 1;
        p[i] = Math.min(255, p[i] * k); p[i + 1] = Math.min(255, p[i + 1] * k); p[i + 2] = Math.min(255, p[i + 2] * k);
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d', { willReadFrequently: true })!.putImageData(img, 0, 0);
    // close the occlusion mask a little: popup glyphs and borders are dark, so a popup reads as
    // bright with dark holes; any rect touching it counts as covered (see occludedFrac)
    return { canvas: c, bgLevel, dimmed: true, occluded };
}

/** Fraction of a rect covered by a popup (0 when the card is not dimmed). */
export function occludedFrac(sf: CardSurface, r: Rect): number {
    if (!sf.occluded) return 0;
    const W = sf.canvas.width, H = sf.canvas.height;
    let n = 0, t = 0;
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) { t++; if (sf.occluded[y * W + x]) n++; }
    }
    return t ? n / t : 1;
}
