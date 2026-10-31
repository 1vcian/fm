/**
 * An EvalPool (src/presets/evalPool.ts) on worker threads: every measurement is cut into one seed
 * range per worker, and the calling thread blocks on Atomics.wait until all ranges are summed,
 * so the preset search stays synchronous. Results equal localPool's: same seeds, same sums.
 *
 * Profiles reused across measurements (the attacker, the arena field) are sent to every worker
 * once and referred to by id afterwards; the measured profile travels with each task.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { UserProfile } from '../src/types/Profile';
import type { EvalPool, ScoreTask } from '../src/presets/evalPool';
import type { QuestBattle } from '../src/presets/mainProgress';

export type PoolTask =
    | { kind: 'survival'; defender: UserProfile; attacker: number; seconds: number; from: number; to: number }
    | { kind: 'arena'; me: UserProfile; field: number[]; perSide: number; from: number; to: number }
    | { kind: 'quest'; p: UserProfile; battle: QuestBattle; from: number; to: number };

/** A ScoreTask with its shared profiles (attacker, field) sent as registered ids. */
export type WireScoreTask =
    | { kind: 'survival'; p: UserProfile; attacker: number; seconds: number; runs: number }
    | { kind: 'arena'; p: UserProfile; field: number[]; perSide: number }
    | { kind: 'quest'; p: UserProfile; runs: number; hint: number };

export type PoolMessage =
    | { type: 'register'; id: number; profile: UserProfile }
    | { type: 'task'; slot: number; task: PoolTask }
    /** Whole measurements: result i goes to out[index[i]]. */
    | { type: 'many'; tasks: WireScoreTask[]; index: number[]; out: SharedArrayBuffer };

export interface WorkerPool extends EvalPool {
    readonly size: number;
    close(): Promise<void>;
}

/** No progress for this long means a worker is gone (one range is seconds, not minutes). */
const STALL_MS = 10 * 60 * 1000;

export function workerPool(version: string, size = Math.max(1, os.availableParallelism() - 1)): WorkerPool {
    // ctl[0]: finished tasks of the current batch, ctl[1]: workers ready. res: two sums per slot.
    const ctl = new Int32Array(new SharedArrayBuffer(8));
    const res = new Float64Array(new SharedArrayBuffer(8 * 2 * size));
    const workers = Array.from({ length: size }, () => new Worker(new URL('./presetWorkerBoot.mjs', import.meta.url), {
        workerData: { version, ctl: ctl.buffer, res: res.buffer },
    }));
    for (const w of workers) w.on('error', e => { console.error('preset worker failed', e); process.exit(1); });
    const ids = new WeakMap<UserProfile, number>();
    let nextId = 1;
    const idOf = (p: UserProfile) => {
        let id = ids.get(p);
        if (id === undefined) {
            id = nextId++;
            ids.set(p, id);
            for (const w of workers) w.postMessage({ type: 'register', id, profile: p } satisfies PoolMessage);
        }
        return id;
    };

    // The calling thread cannot see a worker's 'error' event while it blocks, so every wait has a
    // deadline: a worker that died shows up as a stall, not as a silent hang.
    const waitFor = (index: number, target: number, what: string) => {
        const deadline = Date.now() + STALL_MS;
        for (let v = Atomics.load(ctl, index); v < target; v = Atomics.load(ctl, index)) {
            if (Atomics.wait(ctl, index, v, Math.max(1, deadline - Date.now())) === 'timed-out' && Atomics.load(ctl, index) < target) {
                throw new Error(`preset workers stalled (${what}: ${Atomics.load(ctl, index)}/${target})`);
            }
        }
    };
    let ready = false;

    /** Runs ranges [from, to] of 0..n-1 (shifted by `base`) on the workers; returns the summed pair. */
    const run = (n: number, base: number, make: (from: number, to: number) => PoolTask): [number, number] => {
        if (!ready) { waitFor(1, size, 'startup'); ready = true; }
        const parts = Math.min(size, n);
        Atomics.store(ctl, 0, 0);
        for (let i = 0; i < parts; i++) {
            const from = Math.floor((i * n) / parts), to = Math.floor(((i + 1) * n) / parts) - 1;
            workers[i].postMessage({ type: 'task', slot: i, task: make(from + base, to + base) } satisfies PoolMessage);
        }
        waitFor(0, parts, 'tasks');
        let a = 0, b = 0;
        for (let i = 0; i < parts; i++) {
            if (Number.isNaN(res[2 * i])) throw new Error('preset worker task failed');
            a += res[2 * i];
            b += res[2 * i + 1];
        }
        return [a, b];
    };

    return {
        size,
        survival(defender, attacker, seconds, runs) {
            const a = idOf(attacker);
            const [hits, secs] = run(runs, 1, (from, to) => ({ kind: 'survival', defender, attacker: a, seconds, from, to }));
            return { hits: hits / runs, seconds: secs / runs };
        },
        arena(me, field, perSide) {
            const f = field.map(idOf);
            const n = field.length * perSide;
            const [points, margin] = run(n, 0, (from, to) => ({ kind: 'arena', me, field: f, perSide, from, to }));
            return points / (2 * n) + (margin / (2 * n)) * 1e-3;
        },
        questWinRate(p, battle, runs) {
            const [wins, missing] = run(runs, 1, (from, to) => ({ kind: 'quest', p, battle, from, to }));
            return missing > 0 ? null : wins / runs;
        },
        many(tasks: ScoreTask[]) {
            if (!tasks.length) return [];
            const wire = tasks.map((t): WireScoreTask => t.kind === 'survival' ? { ...t, attacker: idOf(t.attacker) }
                : t.kind === 'arena' ? { ...t, field: t.field.map(idOf) } : t);
            if (!ready) { waitFor(1, size, 'startup'); ready = true; }
            const out = new SharedArrayBuffer(8 * tasks.length);
            const parts = Math.min(size, tasks.length);
            Atomics.store(ctl, 0, 0);
            // Interleaved, so a run of slow candidates is shared out.
            for (let i = 0; i < parts; i++) {
                const index: number[] = [];
                for (let k = i; k < tasks.length; k += parts) index.push(k);
                workers[i].postMessage({ type: 'many', tasks: index.map(k => wire[k]), index, out } satisfies PoolMessage);
            }
            waitFor(0, parts, 'batch');
            const values = Array.from(new Float64Array(out));
            if (values.some(Number.isNaN)) throw new Error('preset worker task failed');
            return values;
        },
        async close() {
            await Promise.all(workers.map(w => w.terminate()));
        },
    };
}
