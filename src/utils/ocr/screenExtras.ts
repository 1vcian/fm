// Screen extras — small fixed-UI reads that ride along on otherwise-supported screens:
//   FORGE LEVEL  — the blue "Forge Level NN" button on the forge row behind item/pet/mount
//                  popups (fixed game UI at the bottom of the frame, fractions of 576x1280).
//   SKILL ASCENSION — the gold stars (0..3) under the "Lv. NN" progress pill on the skills
//                  screen's summon widget (profile.misc.skillAscensionLevel).
// Both are best-effort: any failure yields null and simply produces no row.
import { cropCanvas, binarize, evidenceCropUrl } from './imagePrep';
import { connectedComponents } from './numberReader';
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
    const rect = {
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

/** Count the gold ascension stars (0..3) in the skills screen's summon widget. */
export async function readSkillAscension(canvas: HTMLCanvasElement): Promise<number | null> {
    const W = canvas.width, H = canvas.height;
    const x0 = Math.round(W * 0.58), y0 = Math.round(H * 0.745);
    const x1 = Math.round(W * 0.95), y1 = Math.round(H * 0.845);
    const w = x1 - x0, h = y1 - y0;
    if (w < 8 || h < 8) return null;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h).data;
    // gold-star mask: saturated yellow-orange
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (r > 150 && g > 100 && b < 120 && r - b > 70) mask[p] = 1;
    }
    const { stats } = connectedComponents(mask, w, h);
    const starMin = Math.round(W * 0.018), starMax = Math.round(W * 0.075); // ~10..43px @576
    const centres: { cx: number; cy: number }[] = [];
    for (const s of stats) {
        if (s.w < starMin || s.w > starMax || s.h < starMin || s.h > starMax) continue;
        if (s.w / s.h < 0.45 || s.w / s.h > 2.2) continue;
        centres.push({ cx: s.x + s.w / 2, cy: s.y + s.h / 2 });
    }
    // merge fragments of the same star (outline pieces), then count clusters
    const mergeTol = Math.round(W * 0.03);
    let count = 0;
    while (centres.length) {
        const seed = centres.pop()!;
        for (let i = centres.length - 1; i >= 0; i--) {
            if (Math.abs(centres[i].cx - seed.cx) < mergeTol && Math.abs(centres[i].cy - seed.cy) < mergeTol) {
                centres.splice(i, 1);
            }
        }
        count++;
    }
    return Math.min(count, 3);
}
