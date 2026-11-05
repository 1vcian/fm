import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattlePool } from '../../src/progress/battlePool';
import type { BattleTarget, WorkerIn } from '../../src/progress/battleWorker';

class FakeWorker {
    static all: FakeWorker[] = [];
    sent: WorkerIn[] = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminate = vi.fn();
    constructor() { FakeWorker.all.push(this); }
    postMessage(m: WorkerIn) { this.sent.push(m); }
}

const target: BattleTarget = { mode: 'dungeon', dungeon: 'egg', level: 1 };
const init = { type: 'init', stats: {}, profile: null, libs: {} } as Extract<WorkerIn, { type: 'init' }>;
const tasks = () => FakeWorker.all.flatMap(w => w.sent).filter((m): m is Extract<WorkerIn, { type: 'task' }> => m.type === 'task');

function pool() {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    return new BattlePool(init);
}

describe('BattlePool options', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends a plain task with no options, as the Battle Predictor does', () => {
        pool().run(target).catch(() => { });
        expect(tasks()[0]).toEqual({ type: 'task', id: 1, target, options: undefined });
    });

    it('carries the build and run count to the worker', () => {
        const options = { build: { stats: {} as never, profile: null }, runs: 60 };
        pool().run(target, options).catch(() => { });
        expect(tasks()[0].options).toBe(options);
    });

    it('keeps the options of a task that had to queue', async () => {
        const p = pool();
        for (let i = 0; i < p.size; i++) p.run(target).catch(() => { });
        const queued = p.run(target, { runs: 60 });
        expect(tasks()).toHaveLength(p.size);
        const w = FakeWorker.all.find(x => x.sent.some(m => m.type === 'task'))!;
        const first = w.sent.find(m => m.type === 'task') as Extract<WorkerIn, { type: 'task' }>;
        w.onmessage!({ data: { type: 'result', id: first.id, outcome: null } });
        expect(tasks().find(t => t.options)!.options).toEqual({ runs: 60 });
        p.dispose();
        await expect(queued).rejects.toThrow('stopped');
    });
});
