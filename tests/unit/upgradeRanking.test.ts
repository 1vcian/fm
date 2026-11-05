import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattlePool } from '../../src/progress/battlePool';
import type { TaskOptions, BattleTarget } from '../../src/progress/battleWorker';
import type { LevelOutcome } from '../../src/progress/adaptive';
import type { UserProfile } from '../../src/types/Profile';
import type { LibraryData } from '../../src/utils/statEngine';

// measureRates prices nudged profiles: the fake engine turns substats into stats directly.
vi.mock('../../src/utils/statEngine', () => ({
    calculateStats: (p: UserProfile) => {
        const subs = (Object.values(p.items).flatMap(i => i?.secondaryStats ?? [])) as { statId: string; value: number }[];
        const get = (id: string) => subs.filter(s => s.statId === id).reduce((a, s) => a + s.value, 0);
        return {
            realTotalDps: 100 * (1 + get('DamageMulti') / 100),
            totalHealth: 1000 * (1 + get('HealthMulti') / 100),
            blockChance: 0,
            realTotalHps: 10 * (1 + get('HealthMulti') / 100) + get('LifeSteal'),
        };
    },
}));

const {
    battleName, bound, estimate, measureRates, modeLine, modeScores, pricedStats, RANK_MODES, RUNS, WINDOW, windowScore, withSubstat,
} = await import('../../src/upgrades/ranking');

const stats = (o: Partial<{ realTotalDps: number; totalHealth: number; blockChance: number; realTotalHps: number }>) => o as never;
const outcome = (winRate: number, lossProgress: number | null = 0): LevelOutcome => ({ winRate, lossProgress, runs: RUNS, decided: true });
const line = (n: number): BattleTarget[] => Array.from({ length: n }, (_, level) => ({ mode: 'dungeon', dungeon: 'egg', level }));

function fakePool(fn: (t: BattleTarget, o?: TaskOptions) => LevelOutcome | null) {
    const calls: { target: BattleTarget; options?: TaskOptions }[] = [];
    const pool = { run: async (target: BattleTarget, options?: TaskOptions) => { calls.push({ target, options }); return fn(target, options); } } as unknown as BattlePool;
    return { pool, calls };
}

const profile = () => ({ items: { Weapon: null, Helmet: { secondaryStats: [{ statId: 'Crit', value: 1 }] } } }) as unknown as UserProfile;

describe('modeLine', () => {
    it('walks every difficulty of the main quest in play order', () => {
        const libs = {
            mainBattleConfig: { DifficultyDamageMultiplier: [1, 2] },
            mainBattleLibrary: { "{'AgeIdx': 0, 'BattleIdx': 1}": {}, "{'AgeIdx': 0, 'BattleIdx': 0}": {} },
        };
        const l = modeLine('main', libs, 0);
        expect(l.every(t => t.mode === 'main')).toBe(true);
        expect(l.slice(0, 2)).toMatchObject([{ difficulty: 0, ageIdx: 0, battleIdx: 0 }, { difficulty: 0, ageIdx: 0, battleIdx: 1 }]);
    });

    it('lists every dungeon level, the max one included', () => {
        const l = modeLine('egg', {}, 3);
        expect(l).toHaveLength(4);
        expect(l[3]).toEqual({ mode: 'dungeon', dungeon: 'egg', level: 3 });
    });
});

describe('windowScore', () => {
    const build = { stats: stats({}), profile: profile() };

    it('sums how close the build gets over the window either side of the frontier', async () => {
        const { pool, calls } = fakePool(() => outcome(0.5, 0.5));
        const score = await windowScore(pool, line(100), build, 50);
        expect(calls).toHaveLength(WINDOW * 2 + 1);
        expect(score).toBeCloseTo((WINDOW * 2 + 1) * 0.75);
    });

    it('measures every battle with the given build at the same fixed seeds', async () => {
        const { pool, calls } = fakePool(() => outcome(1, null));
        await windowScore(pool, line(100), build, 50);
        expect(calls.every(c => c.options?.runs === RUNS && c.options.build === build)).toBe(true);
    });

    it('clips the window at both ends of the line', async () => {
        const start = fakePool(() => outcome(1, null));
        await windowScore(start.pool, line(100), build, -1);
        expect(start.calls.map(c => (c.target as { level: number }).level)).toEqual(Array.from({ length: WINDOW }, (_, i) => i));
        const end = fakePool(() => outcome(1, null));
        await windowScore(end.pool, line(100), build, 99);
        expect(end.calls).toHaveLength(WINDOW + 1);
    });

    it('counts a battle that does not exist as nothing', async () => {
        const { pool } = fakePool(() => null);
        expect(await windowScore(pool, line(100), build, 50)).toBe(0);
    });

    it('does not jump when one battle near the limit flips', async () => {
        // The reason for the window: win rates around 50% flip "the last battle cleared" by a dozen
        // battles, while the sum moves only by what really changed.
        const rates = [0.55, 0.45, 0.55, 0.45, 0.55, 0.45];
        const a = fakePool(t => outcome(rates[(t as { level: number }).level % 6] ?? 0));
        const b = fakePool(t => outcome((rates[(t as { level: number }).level % 6] ?? 0) + 0.02));
        const gain = await windowScore(b.pool, line(100), build, 50) - await windowScore(a.pool, line(100), build, 50);
        expect(gain).toBeCloseTo((WINDOW * 2 + 1) * 0.02);
    });
});

describe('modeScores', () => {
    it('scores every mode around its own frontier', async () => {
        const { pool, calls } = fakePool(() => outcome(1, null));
        const lines = Object.fromEntries(RANK_MODES.map(m => [m, line(100)])) as Record<(typeof RANK_MODES)[number], BattleTarget[]>;
        const frontiers = { main: 50, hammer: 0, skill: 50, egg: 50, potion: 50 };
        const scores = await modeScores(pool, lines, { stats: stats({}), profile: profile() }, frontiers);
        expect(Object.keys(scores)).toEqual(RANK_MODES);
        expect(scores.main).toBe(WINDOW * 2 + 1);
        expect(scores.hammer).toBe(WINDOW + 1);
        expect(calls).toHaveLength((WINDOW * 2 + 1) * 4 + WINDOW + 1);
    });
});

describe('battleName', () => {
    it('names battles as the game does', () => {
        expect(battleName({ mode: 'main', difficulty: 1, ageIdx: 10, battleIdx: 14 })).toBe('Hard 11-15');
        expect(battleName({ mode: 'dungeon', dungeon: 'egg', level: 0 })).toBe('Level 1');
        expect(battleName(undefined)).toBe('none');
    });
});

describe('withSubstat', () => {
    it('adds the roll to the first item and keeps the rest', () => {
        const p = profile();
        const q = withSubstat(p, 'DamageMulti', 10)!;
        expect(q.items.Helmet!.secondaryStats).toEqual([{ statId: 'Crit', value: 1 }, { statId: 'DamageMulti', value: 10 }]);
        expect(p.items.Helmet!.secondaryStats).toHaveLength(1);
    });

    it('has nothing to add to on an empty profile', () => {
        expect(withSubstat({ items: { Weapon: null } } as unknown as UserProfile, 'DamageMulti', 10)).toBeNull();
    });
});

describe('pricedStats', () => {
    it('counts block in effective health, capped so a huge block stays finite', () => {
        expect(pricedStats(stats({ realTotalDps: 1, totalHealth: 100, blockChance: 0.5, realTotalHps: 2 }))).toEqual({ dps: 1, health: 200, hps: 2 });
        expect(pricedStats(stats({ realTotalDps: 1, totalHealth: 100, blockChance: 1, realTotalHps: 2 })).health).toBe(2000);
    });
});

describe('measureRates', () => {
    const modes = Object.fromEntries(RANK_MODES.map(m => [m, line(100)])) as Record<(typeof RANK_MODES)[number], BattleTarget[]>;
    const frontiers = Object.fromEntries(RANK_MODES.map(m => [m, 50])) as Record<(typeof RANK_MODES)[number], number>;
    const base = () => ({ stats: stats({ realTotalDps: 100, totalHealth: 1000, blockChance: 0, realTotalHps: 10 }), profile: profile() });
    const libs = {} as LibraryData;
    const statsOf = (o?: TaskOptions) => o!.build!.stats as unknown as { realTotalDps: number; totalHealth: number };

    let reach: (o?: TaskOptions) => number;
    const run = () => measureRates(fakePool((_, o) => outcome(reach(o))).pool, modes, base(), frontiers, libs);
    beforeEach(() => { reach = () => 0.5; });

    it('turns each nudge into a score per percent of that stat', async () => {
        // Each 1% of DPS adds 0.001 per battle, health is worth nothing.
        reach = o => 0.5 + (statsOf(o).realTotalDps - 100) * 0.001;
        const r = await run();
        expect(r!.perMode.main!.dmg).toBeCloseTo((WINDOW * 2 + 1) * 0.001);
        expect(r!.perMode.main!.hp).toBeCloseTo(0);
    });

    it('never gives a stat a negative worth', async () => {
        reach = o => 0.5 - (statsOf(o).totalHealth - 1000) * 0.0001;
        expect((await run())!.perMode.egg!.hp).toBe(0);
    });

    it('records the healing that rides on health', async () => {
        expect((await run())!.hpsPerHpPct).toBeCloseTo(0.1);
    });

    it('gives up on a profile with no items', async () => {
        const r = await measureRates(fakePool(() => outcome(1)).pool, modes, { ...base(), profile: { items: {} } as unknown as UserProfile }, frontiers, libs);
        expect(r).toBeNull();
    });
});

describe('estimate', () => {
    const rates = {
        perMode: { main: { dmg: 2, hp: 3, heal: 5 } },
        hpsPerDmgPct: 0,
        hpsPerHpPct: 0.1,
        base: { dps: 100, health: 1000, hps: 10 },
    };

    it('prices the exact stat change at the rates', () => {
        const e = estimate(rates, { dps: 101, health: 1020, hps: 10.2 });
        expect(e.dmgPct).toBeCloseTo(1);
        expect(e.hpPct).toBeCloseTo(2);
        expect(e.healPct).toBeCloseTo(0);
        expect(e.perMode.main).toBeCloseTo(2 + 6);
    });

    it('prices healing beyond what health brings along', () => {
        expect(estimate(rates, { dps: 100, health: 1000, hps: 11 }).healPct).toBeCloseTo(10);
    });

    it('does not read health without regen as lost healing', () => {
        expect(estimate(rates, { dps: 100, health: 1100, hps: 10 }).healPct).toBe(0);
    });

    it('leaves healing at zero for a build with none', () => {
        expect(estimate({ ...rates, base: { ...rates.base, hps: 0 } }, { dps: 100, health: 1000, hps: 5 }).healPct).toBe(0);
    });
});

describe('bound', () => {
    const rates = {
        perMode: { main: { dmg: 1, hp: 0, heal: 0 }, egg: { dmg: 0, hp: 3, heal: 0 } },
        hpsPerDmgPct: 0, hpsPerHpPct: 0, base: { dps: 1, health: 1, hps: 1 },
    };

    it('names the stat worth the most over the chosen modes', () => {
        expect(bound(rates, ['main', 'egg']).top).toBe('hp');
        expect(bound(rates, ['main']).top).toBe('dmg');
    });

    it('names nothing when no stat moves anything', () => {
        expect(bound(rates, ['skill']).top).toBeNull();
    });
});
