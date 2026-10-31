/**
 * What the next upgrade is worth.
 *
 * One tech or pet level moves stats by well under 1%, below what a win rate can resolve. So the
 * sim measures three clearly visible nudges (+10% damage, +10% health, +4% lifesteal) against the
 * current build at the same seeds, which gives what 1% more DPS, effective health and healing is
 * worth right now, per mode. Each upgrade's exact stat change is then priced at those rates.
 *
 * The score of a build is NOT "the last battle cleared". Near a build's limit neighbouring battles
 * differ a lot (win rates of 25%, 80%, 35% in a row are normal), so that index jumps by a dozen
 * battles on a tiny stat change and gives no usable rate: +15% health moved it by 6 battles while
 * +5% moved it by 0.03. Instead it is the sum of questReach over the same WINDOW battles either
 * side of the current frontier, which moves smoothly. Measured on a mid-game build, rates taken
 * this way predict full sims of pet, mount and +15% stat changes to within about 30%.
 */
import { calculateStats, type AggregatedStats, type LibraryData } from '../utils/statEngine';
import { questLine, questReach, type QuestBattle } from '../presets/mainProgress';
import type { BattlePool } from '../progress/battlePool';
import type { LevelOutcome } from '../progress/adaptive';
import type { BattleTarget } from '../progress/battleWorker';
import type { UserProfile } from '../types/Profile';

export type RankMode = 'main' | 'hammer' | 'skill' | 'egg' | 'potion';
export const RANK_MODES: RankMode[] = ['main', 'hammer', 'skill', 'egg', 'potion'];
export const MODE_NAMES: Record<RankMode, string> = {
    main: 'Main quest', hammer: 'Hammer dungeon', skill: 'Skill dungeon', egg: 'Egg dungeon', potion: 'Potion dungeon',
};

/** Seeds per battle. Every build here uses all of them, so two builds face the same dice. */
export const RUNS = 120;
/** Battles either side of the frontier that a score sums over. */
export const WINDOW = 15;

/** The battles of a mode, in the order they are played. */
export function modeLine(mode: RankMode, battleLibs: any, maxDungeonLevel: number): BattleTarget[] {
    if (mode === 'main') return questLine(battleLibs).map((b: QuestBattle) => ({ mode: 'main', ...b }));
    return Array.from({ length: maxDungeonLevel + 1 }, (_, level) => ({ mode: 'dungeon', dungeon: mode, level }));
}

export interface Build { stats: AggregatedStats; profile: UserProfile }

/** How close a build gets to winning each battle around `frontier`, summed. Comparable only at the same frontier. */
export async function windowScore(pool: BattlePool, line: BattleTarget[], build: Build, frontier: number): Promise<number> {
    const from = Math.max(0, frontier - WINDOW), to = Math.min(line.length - 1, frontier + WINDOW);
    const measured = await Promise.all(line.slice(from, to + 1).map(t => pool.run(t, { build, runs: RUNS })));
    return measured.reduce((sum, o) => sum + (o ? questReach({ win: o.winRate, lossProgress: o.lossProgress ?? 0 }) : 0), 0);
}

// ---- the stats an upgrade is priced by -------------------------------------------------------

export interface PricedStats { dps: number; health: number; hps: number }

/** Offense is DPS, so attack speed, crit, double hits and skills count. Defense is effective health, so block counts. */
export function pricedStats(stats: AggregatedStats): PricedStats {
    return {
        dps: stats.realTotalDps,
        health: stats.totalHealth / Math.max(0.05, 1 - (stats.blockChance || 0)),
        hps: stats.realTotalHps,
    };
}

/** Add one substat roll to the first item: the engine sums substats across the gear, so the slot does not matter. */
export function withSubstat(profile: UserProfile, statId: string, value: number): UserProfile | null {
    const slot = (Object.keys(profile.items) as (keyof UserProfile['items'])[]).find(s => profile.items[s]);
    if (!slot) return null;
    const p: UserProfile = JSON.parse(JSON.stringify(profile));
    p.items[slot]!.secondaryStats = [...(p.items[slot]!.secondaryStats ?? []), { statId, value }];
    return p;
}

/** Score gained per +1% of a stat. */
export interface ModeRates { dmg: number; hp: number; heal: number }
export type RateKey = keyof ModeRates;

export interface Rates {
    perMode: Partial<Record<RankMode, ModeRates>>;
    /** Heal/s that rides on +1% damage (lifesteal) and +1% health (regen). */
    hpsPerDmgPct: number;
    hpsPerHpPct: number;
    base: PricedStats;
}

const pctChange = (a: number, b: number) => (a ? ((b - a) / a) * 100 : 0);

export async function measureRates(
    pool: BattlePool,
    lines: Record<RankMode, BattleTarget[]>,
    base: Build,
    frontiers: Record<RankMode, number>,
    libs: LibraryData,
): Promise<Rates | null> {
    const scores = async (build: Build) => Object.fromEntries(await Promise.all(RANK_MODES.map(async m =>
        [m, await windowScore(pool, lines[m], build, frontiers[m])] as const))) as Record<RankMode, number>;
    const probe = async (statId: string, value: number) => {
        const profile = withSubstat(base.profile, statId, value);
        if (!profile) return null;
        const stats = calculateStats(profile, libs);
        return { priced: pricedStats(stats), scores: await scores({ stats, profile }) };
    };
    const [zero, d, h, l] = await Promise.all([scores(base), probe('DamageMulti', 10), probe('HealthMulti', 10), probe('LifeSteal', 4)]);
    if (!d || !h || !l) return null;

    const b = pricedStats(base.stats);
    const dPct = pctChange(b.dps, d.priced.dps);
    const hPct = pctChange(b.health, h.priced.health);
    const lPct = pctChange(b.hps, l.priced.hps);
    const perMode: Rates['perMode'] = {};
    for (const m of RANK_MODES) {
        // A nudge can come out a hair negative on the same dice; a stat is never worth less than nothing.
        const rate = (r: { scores: Record<RankMode, number> }, pct: number) => (pct ? Math.max(0, (r.scores[m] - zero[m]) / pct) : 0);
        perMode[m] = { dmg: rate(d, dPct), hp: rate(h, hPct), heal: rate(l, lPct) };
    }
    return {
        perMode,
        hpsPerDmgPct: dPct ? (d.priced.hps - b.hps) / dPct : 0,
        hpsPerHpPct: hPct ? (h.priced.hps - b.hps) / hPct : 0,
        base: b,
    };
}

export interface Estimate {
    dmgPct: number;
    hpPct: number;
    /** Healing beyond what the damage and health changes already bring. */
    healPct: number;
    perMode: Partial<Record<RankMode, number>>;
}

export function estimate(rates: Rates, s: PricedStats): Estimate {
    const b = rates.base;
    const dmgPct = pctChange(b.dps, s.dps);
    const hpPct = pctChange(b.health, s.health);
    const riding = dmgPct * rates.hpsPerDmgPct + hpPct * rates.hpsPerHpPct;
    // A residual: health that does not feed regen (pets, mounts) would otherwise read as lost healing.
    const healPct = b.hps ? Math.max(0, ((s.hps - b.hps - riding) / b.hps) * 100) : 0;
    const perMode: Estimate['perMode'] = {};
    for (const [m, r] of Object.entries(rates.perMode) as [RankMode, ModeRates][]) {
        perMode[m] = r.dmg * dmgPct + r.hp * hpPct + r.heal * healPct;
    }
    return { dmgPct, hpPct, healPct, perMode };
}

/** What a mode set is limited by: the stat whose 1% buys the most. Null when nothing moves. */
export function bound(rates: Rates, focus: RankMode[]): { sums: ModeRates; top: RateKey | null } {
    const sum = (k: RateKey) => focus.reduce((a, m) => a + (rates.perMode[m]?.[k] ?? 0), 0);
    const sums = { dmg: sum('dmg'), hp: sum('hp'), heal: sum('heal') };
    const top = (Object.keys(sums) as RateKey[]).sort((a, b) => sums[b] - sums[a])[0];
    return { sums, top: sums[top] > 0 ? top : null };
}
