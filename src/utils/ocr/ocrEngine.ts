// Lazy client-side OCR engine (tesseract.js v7), one worker per language set. tesseract.js is DYNAMICALLY imported on
// first use, so it adds ZERO weight to the initial app bundle — only AutoSync/PvP pull it in.
// The worker + wasm core + language data then load on demand and are cached by the browser.

import type { Worker } from 'tesseract.js';
import { tessLangsFor, type GameLang } from './ocrLanguage';

// Page-segmentation-mode values (tesseract's string enum). Declared locally so we never need
// a static import of the heavy module just to reference a constant.
export const PSM = { AUTO: '3', SINGLE_BLOCK: '6', SINGLE_LINE: '7', SPARSE_TEXT: '11' } as const;
export type PsmValue = (typeof PSM)[keyof typeof PSM];

type OcrImage = HTMLCanvasElement | HTMLImageElement | string;
export type OcrProgress = (p: { status: string; progress: number }) => void;

// One worker per tesseract language set. WORDS are read with the game language's model (plus
// English, see ocrLanguage.tessLangsFor); a pass restricted to digits and number punctuation always
// uses the English model, because those glyphs are the same Baloo glyphs in every language.
const workers = new Map<string, Promise<Worker>>();
let progressCb: OcrProgress | null = null;
let textLangs = 'eng';

/** Subscribe to load/recognize progress (0..1). Pass null to clear. */
export function setOcrProgress(cb: OcrProgress | null) { progressCb = cb; }

/** The language the next screenshots are in; words are read with its model from then on. */
export function setOcrLanguage(lang: GameLang): void { textLangs = tessLangsFor(lang); }
export function ocrLanguages(): string { return textLangs; }

function getWorkerFor(langs: string): Promise<Worker> {
    let w = workers.get(langs);
    if (!w) {
        w = (async () => {
            const { createWorker } = await import('tesseract.js');
            return createWorker(langs, 1, {
                logger: (m: { status: string; progress: number }) => {
                    if (progressCb && typeof m.progress === 'number') progressCb(m);
                },
            });
        })();
        // a failed load (offline, CDN error) must not poison the cache: the next call retries
        w.catch(() => { if (workers.get(langs) === w) workers.delete(langs); });
        workers.set(langs, w);
    }
    return w;
}

/** Digits-only whitelists need no language model beyond English. */
function isNumericWhitelist(wl: string | undefined): boolean {
    return !!wl && /^[0-9.,%+\-\/kmbtqKMBTQ ]+$/.test(wl);
}

async function getWorker(whitelist?: string): Promise<Worker> {
    return getWorkerFor(isNumericWhitelist(whitelist) ? 'eng' : textLangs);
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
    const worker = await getWorker(opts.whitelist);
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
    const all = [...workers.values()];
    workers.clear();
    for (const p of all) {
        const w = await p.catch(() => null);
        if (w) await w.terminate();
    }
}
