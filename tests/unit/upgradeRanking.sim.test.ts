/**
 * The ranking against the real engine and the latest game data: rates measured on one mid-game
 * preset must predict full sims of bigger changes. This is what caught the first version of the
 * score (the index of the last battle cleared), which was off by a factor of hundreds.
 */
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { presetLibsFrom } from '../../src/presets/presetLibs';
import { calculateStats, type LibraryData } from '../../src/utils/statEngine';
import { dungeonBattleWins, mainBattleWins } from '../../src/utils/BattleSimulator';
import { measureFixed } from '../../src/progress/adaptive';
import type { BattlePool } from '../../src/progress/battlePool';
import type { BattleTarget, TaskOptions } from '../../src/progress/battleWorker';
import type { UserProfile } from '../../src/types/Profile';
import { upgradeCandidates } from '../../src/upgrades/candidates';
import { forgeVerdict, withItem } from '../../src/upgrades/forge';
import {
    estimate, measureRates, modeLine, pricedStats, RANK_MODES, windowScore, withSubstat, type RankMode, type Rates,
} from '../../src/upgrades/ranking';

const version: string = JSON.parse(fs.readFileSync('public/parsed_configs/versions.json', 'utf8'))[0];
const dir = `public/parsed_configs/${version}/`;
const cfg: Record<string, any> = {};
for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) cfg[f.slice(0, -5)] = JSON.parse(fs.readFileSync(dir + f, 'utf8'));

const libs = presetLibsFrom(version, cfg) as LibraryData;
const mainBattleLookup: Record<string, unknown> = {};
for (const k of Object.keys(cfg.MainBattleLibrary)) {
    const a = k.match(/AgeIdx['"]?\s*:\s*(\d+)/), b = k.match(/BattleIdx['"]?\s*:\s*(\d+)/);
    if (a && b) mainBattleLookup[`${a[1]}-${b[1]}`] = cfg.MainBattleLibrary[k];
}
const battleLibs: any = {
    mainBattleLibrary: cfg.MainBattleLibrary, mainBattleLookup, mainBattleConfig: cfg.MainBattleConfig,
    enemyAgeScalingLibrary: cfg.EnemyAgeScalingLibrary, enemyLibrary: cfg.EnemyLibrary, weaponLibrary: cfg.WeaponLibrary,
    itemBalancingConfig: cfg.ItemBalancingConfig, projectilesLibrary: cfg.ProjectilesLibrary, skillLibrary: cfg.SkillLibrary,
    skillPassiveLibrary: cfg.SkillPassiveLibrary, dungeonBaseConfig: cfg.DungeonBaseConfig,
    hammerThiefDungeonBattleLibrary: cfg.HammerThiefDungeonBattleLibrary, skillDungeonBattleLibrary: cfg.SkillDungeonBattleLibrary,
    eggDungeonBattleLibrary: cfg.EggDungeonBattleLibrary, potionDungeonBattleLibrary: cfg.PotionDungeonBattleLibrary,
};

/** The pool's work, in this thread. */
const pool = {
    run: async (t: BattleTarget, o?: TaskOptions) => {
        const { stats, profile } = o!.build!;
        return measureFixed((from, to) => t.mode === 'main'
            ? mainBattleWins(stats, profile, t.ageIdx, t.battleIdx, t.difficulty, battleLibs, from, to)
            : dungeonBattleWins(stats, profile, t.dungeon, t.level, battleLibs, from, to), o!.runs!);
    },
} as unknown as BattlePool;

const maxDungeon = cfg.DungeonBaseConfig?.MaxDungeonLevel ?? 399;
const lines = Object.fromEntries(RANK_MODES.map(m => [m, modeLine(m, battleLibs, maxDungeon)])) as Record<RankMode, BattleTarget[]>;

/** A preset cut down to a mid-game build, so there is something left to buy. */
function midGame(): UserProfile {
    const p: UserProfile = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(`${dir}ProfilePresets.json`, 'utf8')).presets[0].profile));
    for (const item of Object.values(p.items)) if (item) { item.level = Math.max(1, Math.floor(item.level / 2)); item.age = Math.min(item.age, 6); }
    for (const pet of p.pets.active) pet.level = 30;
    p.mount.active!.level = 30;
    for (const s of p.skills.equipped) s.level = 25;
    const tree: UserProfile['techTree'] = { Forge: {}, Power: {}, SkillsPetTech: {}, Clan: {} };
    for (const t of ['Forge', 'Power', 'SkillsPetTech'] as const) {
        for (const n of cfg.PlayerTechTreePositionLibrary[t].Nodes) if ((n.Tier ?? 0) <= 1) tree[t][n.Id] = 2;
    }
    p.techTree = tree;
    return p;
}

/** Last battle cleared in order: a coarse walk is enough to centre the window. */
async function frontier(line: BattleTarget[], build: { stats: never; profile: UserProfile }) {
    let i = -1;
    while (i + 1 < line.length && ((await pool.run(line[i + 1], { build, runs: 8 }))?.winRate ?? 0) >= 0.5) i++;
    return i;
}

describe('ranking on the real engine', () => {
    const profile = midGame();
    const stats = calculateStats(profile, libs);
    const base = { stats, profile };
    let frontiers: Record<RankMode, number>;
    let rates: Rates;
    const zero = {} as Record<RankMode, number>;

    const actualGain = async (p: UserProfile) => {
        const build = { stats: calculateStats(p, libs), profile: p };
        let sum = 0;
        for (const m of RANK_MODES) sum += await windowScore(pool, lines[m], build, frontiers[m]) - zero[m];
        return sum;
    };
    const predictedGain = (p: UserProfile) => Object.values(estimate(rates, pricedStats(calculateStats(p, libs))).perMode).reduce((a, b) => a + b, 0);

    beforeAll(async () => {
        frontiers = {} as Record<RankMode, number>;
        for (const m of RANK_MODES) {
            frontiers[m] = await frontier(lines[m], base as never);
            zero[m] = await windowScore(pool, lines[m], base, frontiers[m]);
        }
        rates = (await measureRates(pool, lines, base, frontiers, libs))!;
    }, 120_000);

    it('finds a build part way through the quest', () => {
        expect(frontiers.main).toBeGreaterThan(0);
        expect(frontiers.main).toBeLessThan(lines.main.length - 1);
    });

    it('values damage and health for this build', () => {
        const sum = (k: 'dmg' | 'hp') => RANK_MODES.reduce((a, m) => a + rates.perMode[m]![k], 0);
        expect(sum('dmg')).toBeGreaterThan(0);
        expect(sum('hp')).toBeGreaterThan(0);
    });

    it.each([
        ['+15% health', () => withSubstat(profile, 'HealthMulti', 15)!],
        ['+15% damage', () => withSubstat(profile, 'DamageMulti', 15)!],
        ['pets +5 levels', () => {
            const p: UserProfile = JSON.parse(JSON.stringify(profile));
            p.pets.active.forEach(x => { x.level += 5; });
            return p;
        }],
    ])('predicts a full sim of %s to within 50%%', async (_, make) => {
        const p = make();
        const actual = await actualGain(p);
        expect(actual).toBeGreaterThan(0);
        expect(Math.abs(predictedGain(p) - actual) / actual).toBeLessThan(0.5);
    }, 60_000);

    it('calls one age higher a clear gain and a gutted item a clear loss', async () => {
        const slot = 'Weapon';
        const worn = profile.items[slot]!;
        const better = await actualGain(withItem(profile, slot, { ...worn, age: worn.age + 1, idx: 0 }));
        expect(forgeVerdict(better, [better]).verdict).toBe('equip');
        const worse = await actualGain(withItem(profile, slot, { ...worn, age: 0, level: 1, secondaryStats: [] }));
        expect(forgeVerdict(worse, [worse]).verdict).toBe('keep');
    }, 60_000);

    it('sees no change from the same item', async () => {
        expect(await actualGain(withItem(profile, 'Weapon', profile.items.Weapon))).toBeCloseTo(0, 9);
    }, 60_000);

    it('never prices an available upgrade as a loss', () => {
        const candidates = upgradeCandidates(profile, libs, null, null);
        expect(candidates.length).toBeGreaterThan(20);
        for (const c of candidates) {
            const e = estimate(rates, pricedStats(calculateStats(c.profile, libs)));
            expect(e.dmgPct, c.key).toBeGreaterThan(-0.01);
            expect(e.hpPct, c.key).toBeGreaterThan(-0.01);
        }
    });
});
