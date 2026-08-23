// Ascension-star counter — TS port of reverseForge/proto_stars.py (validated 51/51 = 100%).
// Colour fails (gold stars ≈ gold Divine/Modern tiles), so count by TOPOLOGY: a star outline
// encloses a pocket flood-fill can't reach from outside; keep pockets that are gold (high
// saturation) and in the bottom row of the tile. Returns 0..3.
import type { Rect } from './imagePrep';
import { STAR } from './templateParams';

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
    const dark = new Uint8Array(W * H);       // 1 = outline/dark (gray < threshold)
    const sat = new Float32Array(W * H);      // HSV saturation (0..255)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const p = (y + 1) * W + (x + 1);
        if (gray < STAR.darkThreshold) dark[p] = 1;
        sat[p] = mx > 0 ? (mx - mn) / mx * 255 : 0;
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
    interface Pk { cx: number; cy: number }
    const pockets: Pk[] = [];
    for (let s0 = 0; s0 < W * H; s0++) {
        if (dark[s0] || reach[s0] || seen[s0]) continue;
        const st = [s0]; seen[s0] = 1;
        let minx = s0 % W, maxx = minx, miny = (s0 / W) | 0, maxy = miny, area = 0, satSum = 0;
        while (st.length) {
            const p = st.pop()!; const x = p % W, y = (p / W) | 0; area++; satSum += sat[p];
            if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of nb) if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const q = ny * W + nx; if (!seen[q] && !dark[q] && !reach[q]) { seen[q] = 1; st.push(q); }
            }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1, ar = bw / Math.max(1, bh);
        if (area < minArea || area < 6) continue;
        if (ar < STAR.aspectLo || ar > STAR.aspectHi) continue;
        if (satSum / area < STAR.minSaturation) continue;  // white digit-loops have low saturation; gold stars high
        pockets.push({ cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
    }
    if (!pockets.length) return 0;
    // star row = bottom-most pocket; keep pockets within rowTol of it (same cluster)
    const bottom = Math.max(...pockets.map(p => p.cy));
    const tol = STAR.rowTolFrac * tile.h;
    const cluster = pockets.filter(p => Math.abs(p.cy - bottom) <= tol);
    return Math.max(0, Math.min(STAR.max, cluster.length));
}
