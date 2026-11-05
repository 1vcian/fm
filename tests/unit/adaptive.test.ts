import { describe, expect, it } from 'vitest';
import { measureFixed } from '../../src/progress/adaptive';

describe('measureFixed', () => {
    it('asks once for exactly seeds 1..runs', () => {
        const calls: [number, number][] = [];
        measureFixed((from, to) => { calls.push([from, to]); return { wins: 30, lostProgress: 15 }; }, 60);
        expect(calls).toEqual([[1, 60]]);
    });

    it('averages lost-run progress over the lost runs only', () => {
        const o = measureFixed(() => ({ wins: 30, lostProgress: 15 }), 60)!;
        expect(o.winRate).toBe(0.5);
        expect(o.lossProgress).toBe(0.5);
        expect(o.runs).toBe(60);
    });

    it('has no loss progress when nothing was lost', () => {
        expect(measureFixed(() => ({ wins: 8, lostProgress: 0 }), 8)!.lossProgress).toBeNull();
    });

    it('is decided only when the interval clears 50%', () => {
        expect(measureFixed(() => ({ wins: 60, lostProgress: 0 }), 60)!.decided).toBe(true);
        expect(measureFixed(() => ({ wins: 0, lostProgress: 0 }), 60)!.decided).toBe(true);
        expect(measureFixed(() => ({ wins: 30, lostProgress: 0 }), 60)!.decided).toBe(false);
    });

    it('passes on a battle that does not exist', () => {
        expect(measureFixed(() => null, 60)).toBeNull();
    });
});
