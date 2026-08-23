// In-browser icon identity via a pretrained CNN embedding (MobileNetV3-small, exported to
// ONNX). Far more robust than perceptual hashing to the popup's compression/rendering:
// validated 7/8 vs 0/8 on real screenshots. onnxruntime-web + the model + reference
// embeddings all load lazily (only when AutoSync runs).

import type * as Ort from 'onnxruntime-web';

// onnxruntime-web is DYNAMICALLY imported so it (and its wasm) stay out of the initial bundle
// — only AutoSync pulls it in. The wasm runtime itself is fetched from the CDN.
// Load the whole runtime (JS + wasm) from the CDN so nothing onnxruntime-web ends up in the
// Vite build (the npm package is kept only for its TypeScript types).
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
let ortMod: typeof Ort | null = null;
async function ort(): Promise<typeof Ort> {
    if (!ortMod) {
        ortMod = (await import(/* @vite-ignore */ `${ORT_CDN}ort.wasm.bundle.min.mjs`)) as unknown as typeof Ort;
        ortMod.env.wasm.wasmPaths = ORT_CDN;
    }
    return ortMod;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const DMG_SLOTS = new Set(['Weapon', 'Gloves', 'Necklace', 'Ring']);

let sessionP: Promise<Ort.InferenceSession> | null = null;
function getSession(): Promise<Ort.InferenceSession> {
    if (!sessionP) {
        sessionP = ort().then(o => o.InferenceSession.create(`${import.meta.env.BASE_URL}models/icon_embed.onnx`, {
            executionProviders: ['wasm'],
        }));
    }
    return sessionP;
}

export async function preloadIconModel(): Promise<void> { try { await getSession(); await loadItemRefs(); } catch { /* non-fatal */ } }

/** Embed a cropped icon canvas → 576-d L2-normalized vector. */
export async function embedIcon(crop: HTMLCanvasElement): Promise<Float32Array> {
    const c = document.createElement('canvas');
    c.width = 224; c.height = 224;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(crop, 0, 0, 224, 224);
    const { data } = cx.getImageData(0, 0, 224, 224);
    const N = 224 * 224;
    const t = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) {
        t[i] = (data[i * 4] / 255 - MEAN[0]) / STD[0];
        t[N + i] = (data[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
        t[2 * N + i] = (data[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
    }
    const o = await ort();
    const session = await getSession();
    const out = await session.run({ input: new o.Tensor('float32', t, [1, 3, 224, 224]) });
    const raw = out['embedding'].data as Float32Array;
    let norm = 0; for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
    norm = Math.sqrt(norm) || 1;
    const e = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) e[i] = raw[i] / norm;
    return e;
}

export interface ItemRef { age: number; slot: string; idx: number; name: string; loc?: number; }
interface RefData { rows: ItemRef[]; emb: Float32Array[]; }
let refsP: Promise<RefData> | null = null;

export function loadItemRefs(): Promise<RefData> {
    if (!refsP) {
        refsP = fetch(`${import.meta.env.BASE_URL}parsed_configs/ItemIconEmbeddings.json`)
            .then(r => r.json())
            .then(j => {
                const bin = atob(j.emb_i8_b64);
                const dim = j.dim as number, scale = j.scale as number, count = j.items.length as number;
                const emb: Float32Array[] = [];
                for (let k = 0; k < count; k++) {
                    const v = new Float32Array(dim);
                    let n = 0;
                    for (let d = 0; d < dim; d++) {
                        const b = bin.charCodeAt(k * dim + d);
                        const s = (b << 24) >> 24; // to signed int8
                        const x = s * scale;
                        v[d] = x; n += x * x;
                    }
                    n = Math.sqrt(n) || 1;
                    for (let d = 0; d < dim; d++) v[d] /= n;
                    emb.push(v);
                }
                return { rows: j.items as ItemRef[], emb };
            });
    }
    return refsP;
}

export interface IconMatch { row: ItemRef; score: number; }

/** Cosine-match an embedding against the item references, narrowed by age / main-stat group. */
export async function matchItemIcon(
    embedding: Float32Array,
    opts: { age?: number; group?: 'damage' | 'health' } = {},
    topK = 3,
): Promise<IconMatch[]> {
    const { rows, emb } = await loadItemRefs();
    const scored: IconMatch[] = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (opts.age != null && opts.age >= 0 && r.age !== opts.age) continue;
        if (opts.group && ((opts.group === 'damage') !== DMG_SLOTS.has(r.slot))) continue;
        const e = emb[i];
        let dot = 0;
        for (let d = 0; d < e.length; d++) dot += e[d] * embedding[d];
        scored.push({ row: r, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

export async function terminateIconModel(): Promise<void> {
    if (sessionP) { const s = await sessionP.catch(() => null); sessionP = null; if (s) await s.release?.(); }
}
