// Lazy client-side OCR engine (tesseract.js v7). tesseract.js is DYNAMICALLY imported on
// first use, so it adds ZERO weight to the initial app bundle — only AutoSync/PvP pull it in.
// The worker + wasm core + language data then load on demand and are cached by the browser.

import type { Worker } from 'tesseract.js';

// Page-segmentation-mode values (tesseract's string enum). Declared locally so we never need
// a static import of the heavy module just to reference a constant.
export const PSM = { AUTO: '3', SINGLE_BLOCK: '6', SINGLE_LINE: '7', SPARSE_TEXT: '11' } as const;
export type PsmValue = (typeof PSM)[keyof typeof PSM];

type OcrImage = HTMLCanvasElement | HTMLImageElement | string;
export type OcrProgress = (p: { status: string; progress: number }) => void;

let workerPromise: Promise<Worker> | null = null;
let progressCb: OcrProgress | null = null;

/** Subscribe to load/recognize progress (0..1). Pass null to clear. */
export function setOcrProgress(cb: OcrProgress | null) { progressCb = cb; }

async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            return createWorker('eng', 1, {
                logger: (m: { status: string; progress: number }) => {
                    if (progressCb && typeof m.progress === 'number') progressCb(m);
                },
            });
        })();
    }
    return workerPromise;
}

/** Warm up the worker ahead of time (e.g. when the user opens the AutoSync modal). */
export async function preloadOcr(): Promise<void> { await getWorker(); }

export interface OcrOptions {
    /** Restrict recognised characters, e.g. digits+suffixes for numbers. */
    whitelist?: string;
    /** Page segmentation mode; defaults to single text line. */
    psm?: PsmValue;
}

export interface OcrResult { text: string; confidence: number; words: { text: string; confidence: number }[]; }

/** Recognise text in an image (usually an already-cropped, preprocessed canvas). */
export async function ocr(image: OcrImage, opts: OcrOptions = {}): Promise<OcrResult> {
    const worker = await getWorker();
    await worker.setParameters({
        tessedit_char_whitelist: opts.whitelist ?? '',
        tessedit_pageseg_mode: (opts.psm ?? PSM.SINGLE_LINE) as any,
    });
    const res = await worker.recognize(image);
    // `words` isn't in the default Page typings for v7 — read defensively.
    const words = (((res.data as unknown as { words?: { text: string; confidence: number }[] }).words) || [])
        .map(w => ({ text: w.text, confidence: w.confidence }));
    return { text: (res.data.text || '').trim(), confidence: res.data.confidence, words };
}

/** Numbers only: digits, decimal point, comma, percent and the k/m/b/t/q magnitude suffixes. */
export const NUMERIC_WHITELIST = '0123456789.,%+/kmbtqKMBTQ';

export async function ocrNumber(image: OcrImage): Promise<OcrResult> {
    return ocr(image, { whitelist: NUMERIC_WHITELIST, psm: PSM.SINGLE_LINE });
}

export interface PageLine { text: string; x0: number; y0: number; x1: number; y1: number; }

/**
 * Whole-image OCR returning text lines with bounding boxes (via the blocks output).
 * This mirrors the validated pipeline: group into lines, then parse by region.
 */
export async function ocrPageLines(image: OcrImage): Promise<PageLine[]> {
    const worker = await getWorker();
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.SINGLE_BLOCK as any });
    const res = await worker.recognize(image, {}, { blocks: true });
    const out: PageLine[] = [];
    for (const b of res.data.blocks || []) {
        for (const p of b.paragraphs || []) {
            for (const l of p.lines || []) {
                const t = (l.text || '').trim();
                if (t) out.push({ text: t, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 });
            }
        }
    }
    return out;
}

/** Free the worker (e.g. when the AutoSync flow closes) to reclaim memory. */
export async function terminateOcr(): Promise<void> {
    if (workerPromise) {
        const w = await workerPromise.catch(() => null);
        workerPromise = null;
        if (w) await w.terminate();
    }
}
