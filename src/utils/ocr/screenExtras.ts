// Screen extras — small fixed-UI reads that ride along on otherwise-supported screens:
//   FORGE LEVEL  — the blue "Forge Level NN" button on the forge row behind item/pet/mount
//                  popups, located by its colour (frame fractions of 576x1280 only as fallback).
//   SKILL ASCENSION — the gold stars (0..3) under the "Lv. NN" progress pill on the skills
//                  screen's summon widget (profile.misc.skillAscensionLevel), anchored on the
//                  blue "Summon" button.
// Both are best-effort: any failure yields null and simply produces no row.
import { cropCanvas, binarize, evidenceCropUrl } from './imagePrep';
import { connectedComponents } from './numberReader';
import { countStars } from './starCounter';
import { STAR } from './templateParams';
import { ocr, PSM } from './ocrEngine';

export interface ForgeLevelRead { value: number | null; cropUrl?: string; }

/**
 * OCR the blue "Forge / Level NN" button on the forge row (fixed game UI behind item popups).
 * The band is cut ABOVE the "2d 2h" timer line under the button (measured on the 576x1280
 * frame: button y 0.789..0.836, timer y 0.840+), so the trailing-digits parse can't pick up
 * the timer. The text is light-on-blue and the frame is usually dimmed behind the popup, so an
 * Otsu-binarized (auto-invert -> dark ink on white) retry backs up the plain read.
 * Returns the level (gated to the plausible 1..99) plus an evidence crop of the band.
 */
export async function readForgeLevel(canvas: HTMLCanvasElement): Promise<ForgeLevelRead> {
    const W = canvas.width, H = canvas.height;
    const rect = findForgeButton(canvas) ?? {
        x: Math.round(W * 0.63), y: Math.round(H * 0.785),
        w: Math.round(W * 0.20), h: Math.round(H * 0.053),
    };
    const cropUrl = evidenceCropUrl(canvas, rect);
    const parse = (text: string): number | null => {
        // last digit run, anchored to the "Level" word when present ("Forge Level 32")
        const flat = text.replace(/\s+/g, '');
        const m = flat.match(/(?:l|1)?eve?l?(\d{1,3})$/i) ?? flat.match(/(\d{1,3})$/);
        if (!m) return null;
        const v = parseInt(m[1], 10);
        return isFinite(v) && v >= 1 && v <= 99 ? v : null;
    };
    try {
        // the button holds TWO stacked lines ("Forge" / "Level 32") -> block mode, not single-line
        const band = cropCanvas(canvas, rect, 3);
        const plain = await ocr(band, { whitelist: 'ForgeLevl0123456789 ', psm: PSM.SINGLE_BLOCK });
        let v = parse(plain.text);
        if (v === null) {
            // dimmed/low-contrast frame: binarize with auto-invert (light glyphs -> dark ink)
            const bin = binarize(cropCanvas(canvas, rect, 3), { autoInvert: true });
            const inv = await ocr(bin, { whitelist: 'ForgeLevl0123456789 ', psm: PSM.SINGLE_BLOCK });
            v = parse(inv.text);
        }
        return { value: v, cropUrl };
    } catch {
        return { value: null, cropUrl };
    }
}

/**
 * The blue "Forge / Level NN" button, found by its colour instead of a frame fraction: the forge
 * row is anchored to the BOTTOM of the game UI, so its height as a fraction of the frame moves
 * with the aspect ratio and with an OS navigation bar under the game (measured: a 576x1280 item
 * shot with a 3.5% status bar and a 5% navigation bar read "22" for "Level 32" through the fixed
 * band). The button is the wider of two blue buttons side by side ("Forge Level", then "Auto");
 * measured on the 576x1280 item fixtures: 106x52 and 65x51 px, tops level. The returned rect pads
 * the button the way the old fixed band did (x -7%, y -10%, 113% x 130%), so the OCR crop is the
 * same picture. Null when no such pair is found (the caller falls back to the old band).
 */
function findForgeButton(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
    const W = canvas.width, H = canvas.height;
    const x0 = Math.round(0.5 * W), y0 = Math.round(0.5 * H), w = W - x0, h = H - y0;
    if (w < 8 || h < 8) return null;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;
    const { stats } = connectedComponents(blueMask(px, w * h), w, h);
    const big = stats.filter(s => s.w >= 0.08 * W && s.h >= 0.04 * W && s.area >= 0.5 * s.w * s.h);
    let best: typeof big[number] | null = null;
    for (const f of big) {
        const ar = f.w / f.h;
        if (ar < 1.6 || ar > 2.6) continue;
        const auto = big.find(o => o !== f && o.x > f.x + f.w && o.x - (f.x + f.w) < 0.6 * f.h
            && Math.abs(o.y - f.y) < 0.15 * f.h && Math.abs(o.h - f.h) < 0.2 * f.h && o.w < f.w);
        if (auto && (!best || f.area > best.area)) best = f;
    }
    if (!best) return null;
    return {
        x: Math.round(x0 + best.x - 0.07 * best.w), y: Math.round(y0 + best.y - 0.10 * best.h),
        w: Math.round(1.13 * best.w), h: Math.round(1.30 * best.h),
    };
}

/** Blue UI-button pixels (the forge and summon buttons), as measured on the fixtures. */
function blueMask(px: Uint8ClampedArray, n: number): Uint8Array {
    const mask = new Uint8Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (b !== mx || mx <= 60 || (mx - mn) / mx <= 0.45 || g <= r) continue;
        const hue = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180 / Math.PI + 360) % 360;
        if (hue > 190 && hue < 230) mask[p] = 1;
    }
    return mask;
}

/**
 * Count the gold ascension stars (0..3) in the skills screen's summon widget.
 *
 * Anchored on the "Summon x5" button (the largest blue button in the lower half of the frame); the
 * widget ("Lv. N", the x/110 pill, the stars) sits right of it, its stars level with the button's
 * lower edge. Fixed frame fractions read the bottom-anchored widget at the wrong height under an
 * OS navigation bar (measured: the tester's skills shots with a 5% navigation bar read 0). The
 * stars are counted by topology (countStars) inside the gold cluster's box: two OVERLAPPING stars
 * form one gold blob, which the old blob-count merged into one (measured: the tester's 923x2000
 * skills shots show two stars and read 1; the 576x1280 reference shows one and read 1).
 */
export async function readSkillAscension(canvas: HTMLCanvasElement): Promise<number | null> {
    const W = canvas.width, H = canvas.height;
    const y0 = Math.round(0.5 * H), h = H - y0;
    if (W < 16 || h < 16) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const px = ctx.getImageData(0, y0, W, h).data;
    const blue = connectedComponents(blueMask(px, W * h), W, h).stats
        .filter(s => s.w >= 0.15 * W && s.w / s.h >= 1.4 && s.w / s.h <= 2.8 && s.area >= 0.5 * s.w * s.h)
        .sort((a, b) => b.area - a.area);
    const btn = blue[0];
    if (!btn) return null;
    // window right of the button, from its top to a quarter of its height below it
    const wx0 = btn.x + btn.w, wx1 = Math.min(W, wx0 + btn.w);
    const wy0 = y0 + btn.y, wy1 = Math.min(H, y0 + btn.y + Math.round(1.25 * btn.h));
    const ww = wx1 - wx0, wh = wy1 - wy0;
    if (ww < 8 || wh < 8) return null;
    const wp = ctx.getImageData(wx0, wy0, ww, wh).data;
    const gold = new Uint8Array(ww * wh);
    for (let i = 0, p = 0; p < ww * wh; i += 4, p++) {
        const r = wp[i], g = wp[i + 1], b = wp[i + 2];
        if (r > 150 && g > 100 && b < 120 && r - b > 70) gold[p] = 1;
    }
    // star blobs: at least a tenth of the button height, at most its height
    const blobs = connectedComponents(gold, ww, wh).stats
        .filter(s => s.h >= 0.1 * btn.h && s.h <= btn.h && s.w <= 1.5 * btn.h);
    if (!blobs.length) return 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
    for (const s of blobs) {
        bx0 = Math.min(bx0, s.x); by0 = Math.min(by0, s.y);
        bx1 = Math.max(bx1, s.x + s.w); by1 = Math.max(by1, s.y + s.h);
    }
    // countStars wants a TILE whose star band (STAR.band*) covers the cluster with a margin: the
    // window must start above the outline so the flood fill begins outside every star
    const pad = 0.35 * (by1 - by0);
    const box = { x: wx0 + bx0 - pad, y: wy0 + by0 - pad, w: bx1 - bx0 + 2 * pad, h: by1 - by0 + 2 * pad };
    const tw = box.w / (STAR.bandX1 - STAR.bandX0), th = box.h / (STAR.bandY1 - STAR.bandY0);
    try {
        const n = countStars(canvas, {
            x: Math.round(box.x - STAR.bandX0 * tw), y: Math.round(box.y - STAR.bandY0 * th),
            w: Math.round(tw), h: Math.round(th),
        });
        return Math.min(n, 3);
    } catch { return null; }
}
