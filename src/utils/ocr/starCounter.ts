// Ascension-star counter — TS port of reverseForge/proto_stars.py (validated 51/51 = 100%).
// Colour fails (gold stars ≈ gold Divine/Modern tiles), so count by TOPOLOGY: a star outline
// encloses a pocket flood-fill can't reach from outside; keep pockets that are gold (high
// saturation) and in the bottom row of the tile. Returns 0..3.
//
// The one thing the topology needs is a mask of the OUTLINE, and that must not be an absolute
// grey level: a star is only ever "much darker than the brightest thing next to it". The tile it
// is drawn on can be white (skin popups), Divine gold, deep purple or dimmed to a third of its
// brightness behind a modal — measured on the tester's pet fixtures, a dimmed tile renders its
// gold star at grey 65, so the old fixed `gray < 90` swallowed star, fill and all into one dark
// blob and every pocket vanished (0 stars on all 30 grid tiles). The threshold is therefore
// derived from the band's own 99th-percentile luminance; on an undimmed tile that reproduces the
// validated ~90 and on a dimmed one it follows the tile down.
import type { Rect } from './imagePrep';
import { STAR } from './templateParams';

/** Outline cut = this fraction of the band's 99th-percentile luminance. Measured safe over
 *  0.20..0.34 on every real fixture (40/40 tiles); 0.28 is the middle of that plateau.
 *  (Replaces the absolute grey cut that used to live in STAR; see the note there.) */
const DARK_FRAC = 0.28;
/** Luminance percentile used as the band's "brightest thing" reference — robust to a few
 *  blown-out specks, unlike a plain max. */
const BRIGHT_PCTL = 0.99;

/** Diagnostics for one countStars call, pushed onto `globalThis.__STAR_DEBUG__` when that is an
 *  array (same opt-in convention as __SKILLS_DEBUG__ / __BAND_DEBUG__). Observability only. */
export interface StarDebug {
    tile: Rect;
    band: { x: number; y: number; w: number; h: number };
    w: number; h: number;                 // padded mask size (band + 1px border)
    dark: Uint8Array; enclosed: Uint8Array;
    pockets: { x: number; y: number; w: number; h: number; area: number; sat: number; rej: string | null }[];
    count: number;
}

/** Count ascension stars (0..3) in the star-band of a tile within the given canvas. */
export function countStars(src: HTMLCanvasElement, tile: Rect): number {
    const IW = src.width, IH = src.height;
    // star band relative to tile, clamped to the image
    const x0 = Math.max(0, Math.round(tile.x + STAR.bandX0 * tile.w));
    const x1 = Math.min(IW, Math.round(tile.x + STAR.bandX1 * tile.w));
    const y0 = Math.max(0, Math.round(tile.y + STAR.bandY0 * tile.h));
    const y1 = Math.min(IH, Math.round(tile.y + STAR.bandY1 * tile.h));
    const w = x1 - x0, h = y1 - y0;
    if (w < 4 || h < 4) return 0;

    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const px = ctx.getImageData(x0, y0, w, h).data;

    // padded grids (1px border of "reachable background") so flood-fill starts outside any glyph
    const W = w + 2, H = h + 2;
    const dark = new Uint8Array(W * H);       // 1 = outline/dark (gray < derived cut)
    const sat = new Float32Array(W * H);      // HSV saturation (0..255)
    const gray = new Uint8Array(W * H);
    const hist = new Int32Array(256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const p = (y + 1) * W + (x + 1);
        const gy = Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
        gray[p] = gy; hist[gy]++;
        sat[p] = mx > 0 ? (mx - mn) / mx * 255 : 0;
    }
    // brightest thing in the band (99th pct) -> the outline cut scales with it
    let acc = 0, bright = 255;
    const want = BRIGHT_PCTL * w * h;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) { bright = v; break; } }
    const darkMax = DARK_FRAC * bright;
    // the 1px pad stays non-dark on purpose: it is the "outside" the flood fill starts from
    for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
        const p = y * W + x;
        if (gray[p] < darkMax) dark[p] = 1;
    }
    // flood-fill NON-dark from the padded corner -> reachable background
    const reach = new Uint8Array(W * H);
    const stack = [0]; reach[0] = 1;
    while (stack.length) {
        const p = stack.pop()!; const x = p % W, y = (p / W) | 0;
        const nb = [p - 1, p + 1, p - W, p + W];
        const okx = [x > 0, x < W - 1, true, true];
        for (let k = 0; k < 4; k++) {
            const q = nb[k]; if (q < 0 || q >= W * H || !okx[k]) continue;
            if (!reach[q] && !dark[q]) { reach[q] = 1; stack.push(q); }
        }
    }
    // enclosed = non-dark AND unreachable -> connected components
    const seen = new Uint8Array(W * H);
    const minArea = STAR.minAreaFrac * tile.w * tile.h;
    const dbg = (globalThis as { __STAR_DEBUG__?: unknown[] }).__STAR_DEBUG__;
    const dbgPockets: StarDebug['pockets'] = [];
    const dbgEnclosed = Array.isArray(dbg) ? new Uint8Array(W * H) : null;
    interface Pk { cx: number; cy: number }
    const pockets: Pk[] = [];
    for (let s0 = 0; s0 < W * H; s0++) {
        if (dark[s0] || reach[s0] || seen[s0]) continue;
        const st = [s0]; seen[s0] = 1;
        let minx = s0 % W, maxx = minx, miny = (s0 / W) | 0, maxy = miny, area = 0, satSum = 0;
        while (st.length) {
            const p = st.pop()!; const x = p % W, y = (p / W) | 0; area++; satSum += sat[p];
            if (dbgEnclosed) dbgEnclosed[p] = 1;
            if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of nb) if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const q = ny * W + nx; if (!seen[q] && !dark[q] && !reach[q]) { seen[q] = 1; st.push(q); }
            }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1, ar = bw / Math.max(1, bh);
        const msat = satSum / area;
        let rej: string | null = null;
        // size gate purely relative to the tile (a star's pocket measured 0.006..0.09 of the tile
        // area on the real fixtures) — no absolute pixel floor, so it holds at any device scale
        if (area < minArea) rej = `area ${area}<${minArea.toFixed(1)}`;
        else if (ar < STAR.aspectLo || ar > STAR.aspectHi) rej = `aspect ${ar.toFixed(2)}`;
        else if (msat < STAR.minSaturation) rej = `sat ${msat.toFixed(0)}`;
        if (dbgEnclosed) dbgPockets.push({ x: minx, y: miny, w: bw, h: bh, area, sat: Math.round(msat), rej });
        // white digit-loops have low saturation; gold stars high
        if (rej) continue;
        pockets.push({ cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
    }
    let count = 0;
    if (pockets.length) {
        // star row = bottom-most pocket; keep pockets within rowTol of it (same cluster)
        const bottom = Math.max(...pockets.map(p => p.cy));
        const tol = STAR.rowTolFrac * tile.h;
        const cluster = pockets.filter(p => Math.abs(p.cy - bottom) <= tol);
        count = Math.max(0, Math.min(STAR.max, cluster.length));
    }
    if (Array.isArray(dbg) && dbgEnclosed) {
        dbg.push({
            tile, band: { x: x0, y: y0, w, h }, w: W, h: H,
            dark, enclosed: dbgEnclosed, pockets: dbgPockets, count,
        } satisfies StarDebug);
    }
    return count;
}
