/**
 * Battle Predictor workers (src/progress/battleWorker.ts), one per core but one: each battle is
 * measured whole on one worker, and battles queue up so every worker stays busy. Disposing stops
 * everything and rejects what is still pending.
 */
import type { LevelOutcome } from './adaptive';
import type { BattleTarget, WorkerIn, WorkerOut } from './battleWorker';

export class BattlePool {
    readonly size: number;
    private readonly workers: Worker[];
    private readonly idle: Worker[];
    private readonly queue: { id: number; target: BattleTarget }[] = [];
    private readonly pending = new Map<number, { resolve: (o: LevelOutcome | null) => void; reject: (e: Error) => void }>();
    private nextId = 1;
    private disposed = false;

    constructor(init: Extract<WorkerIn, { type: 'init' }>) {
        const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
        // The dev server serves a worker as hundreds of separate modules, so many workers starting
        // at once take long there; the production build is one file per worker.
        this.size = Math.max(1, Math.min(import.meta.env.DEV ? 3 : 8, cores - 1));
        this.workers = Array.from({ length: this.size }, () => {
            const w = new Worker(new URL('./battleWorker.ts', import.meta.url), { type: 'module' });
            w.onmessage = (e: MessageEvent<WorkerOut>) => this.settle(w, e.data);
            w.onerror = ev => this.fail(new Error(ev.message || 'battle worker failed'));
            w.postMessage(init);
            return w;
        });
        this.idle = [...this.workers];
    }

    /** One battle measured (adaptive runs); null when the battle does not exist. */
    run(target: BattleTarget): Promise<LevelOutcome | null> {
        if (this.disposed) return Promise.reject(new Error('stopped'));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.queue.push({ id, target });
            this.pump();
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.workers.forEach(w => w.terminate());
        this.fail(new Error('stopped'));
    }

    private pump(): void {
        while (this.idle.length && this.queue.length) {
            const w = this.idle.pop()!;
            const { id, target } = this.queue.shift()!;
            w.postMessage({ type: 'task', id, target } satisfies WorkerIn);
        }
    }

    private settle(w: Worker, m: WorkerOut): void {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        this.idle.push(w);
        if (p) {
            if (m.type === 'result') p.resolve(m.outcome);
            else p.reject(new Error(m.message));
        }
        this.pump();
    }

    private fail(e: Error): void {
        for (const p of this.pending.values()) p.reject(e);
        this.pending.clear();
        this.queue.length = 0;
    }
}
