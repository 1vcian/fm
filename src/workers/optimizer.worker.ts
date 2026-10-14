/**
 * Optimizer worker: runs the searches off the main thread.
 *   kind 'build'     src/optimizer/buildOptimizer.ts runOptimizer (AUTO BEST)
 *   kind 'substats'  src/optimizer/substatOptimizer.ts runSubstatOptimizer (Substats Calculator)
 * In:  { type: 'libs', libs } once per library set, then { type: 'run', id, kind, input } (input
 *      without libs). Cancelling = the page terminates this worker.
 * Out: { type: 'progress', id, stage, done, total }, { type: 'done', id, result }, { type: 'error', id, error }
 */
import { runOptimizer, type OptimizerInput } from '../optimizer/buildOptimizer';
import { runSubstatOptimizer, type SubstatOptimizerInput } from '../optimizer/substatOptimizer';
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
        let last = 0;
        const progress = (stage: 1 | 2, done: number, total: number) => {
            const t = Date.now();
            if (done < total && t - last < 100) return;
            last = t;
            post({ type: 'progress', id, stage, done, total });
        };
        const result = msg.kind === 'substats'
            ? runSubstatOptimizer(msg.input as SubstatOptimizerInput, libs, progress)
            : runOptimizer({ ...(msg.input as Omit<OptimizerInput, 'libs'>), libs }, progress);
        post({ type: 'done', id, result });
    } catch (err) {
        post({ type: 'error', id, error: String((err as Error)?.message || err) });
    }
};
