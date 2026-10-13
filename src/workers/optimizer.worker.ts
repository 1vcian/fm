/**
 * Build optimizer worker: runs src/optimizer/buildOptimizer.ts runOptimizer off the main thread.
 * In:  { type: 'libs', libs } once per library set, then { type: 'run', id, input } (input
 *      without libs). Cancelling = the page terminates this worker.
 * Out: { type: 'progress', id, stage, done, total }, { type: 'done', id, result }, { type: 'error', id, error }
 */
import { runOptimizer, type OptimizerInput } from '../optimizer/buildOptimizer';
import type { LibraryData } from '../utils/statEngine';

let libs: LibraryData | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent) => {
    const msg = e.data || {};
    if (msg.type === 'libs') {
        libs = msg.libs;
        return;
    }
    if (msg.type !== 'run') return;
    const { id } = msg;
    try {
        if (!libs) throw new Error('Game data not loaded in the optimizer worker');
        const input: OptimizerInput = { ...msg.input, libs };
        let last = 0;
        const result = runOptimizer(input, (stage, done, total) => {
            const t = Date.now();
            if (done < total && t - last < 100) return;
            last = t;
            post({ type: 'progress', id, stage, done, total });
        });
        post({ type: 'done', id, result });
    } catch (err) {
        post({ type: 'error', id, error: String((err as Error)?.message || err) });
    }
};
