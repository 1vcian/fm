import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleTarget, WorkerIn, WorkerOut } from '../../src/progress/battleWorker';
import { MAX_RUNS } from '../../src/progress/adaptive';

const sim = vi.hoisted(() => ({ calls: [] as { stats: unknown; profile: unknown; from: number; to: number }[] }));

vi.mock('../../src/utils/BattleSimulator', () => {
    const wins = (stats: unknown, profile: unknown, from: number, to: number) => {
        sim.calls.push({ stats, profile, from, to });
        return { wins: Math.ceil((to - from + 1) / 2), lostProgress: 0 }; // near 50%, so adaptive keeps going
    };
    return {
        mainBattleWins: (s: unknown, p: unknown, _a: number, _b: number, _d: number, _l: unknown, f: number, t: number) => wins(s, p, f, t),
        dungeonBattleWins: (s: unknown, p: unknown, _d: unknown, _l: number, _x: unknown, f: number, t: number) => wins(s, p, f, t),
    };
});

const posted: WorkerOut[] = [];
const scope = { postMessage: (m: WorkerOut) => posted.push(m), onmessage: null as ((e: { data: WorkerIn }) => void) | null };
const send = (data: unknown) => scope.onmessage!({ data: data as WorkerIn });
const target: BattleTarget = { mode: 'dungeon', dungeon: 'egg', level: 1 };

describe('battle worker', () => {
    beforeAll(async () => {
        vi.stubGlobal('self', scope);
        await import('../../src/progress/battleWorker');
        send({ type: 'init', stats: 'page stats', profile: 'page profile', libs: {} });
    });
    beforeEach(() => { sim.calls.length = 0; posted.length = 0; });

    it('measures the page build adaptively by default', () => {
        send({ type: 'task', id: 1, target });
        expect(sim.calls[0]).toMatchObject({ stats: 'page stats', profile: 'page profile' });
        expect(sim.calls.length).toBeGreaterThan(1);
        expect(sim.calls.at(-1)!.to).toBeLessThanOrEqual(MAX_RUNS);
    });

    it('measures another build at fixed seeds when the task says so', () => {
        send({ type: 'task', id: 2, target, options: { runs: 60, build: { stats: 'other stats', profile: 'other profile' } } });
        expect(sim.calls).toEqual([{ stats: 'other stats', profile: 'other profile', from: 1, to: 60 }]);
        expect(posted[0]).toMatchObject({ type: 'result', id: 2, outcome: { runs: 60 } });
    });

    it('does not keep a task build for the next task', () => {
        send({ type: 'task', id: 3, target, options: { runs: 60, build: { stats: 'other stats', profile: 'other profile' } } });
        sim.calls.length = 0;
        send({ type: 'task', id: 4, target });
        expect(sim.calls[0].stats).toBe('page stats');
    });
});
