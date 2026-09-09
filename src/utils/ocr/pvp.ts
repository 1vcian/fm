// Simplified 1v1 duel for the PvP feature. Both fighters are reduced to their FINAL
// aggregate stats (which already include tree + passives), so pitting your computed build
// against the opponent's screenshot totals is the real, fair matchup — no need to know the
// opponent's tree separately, since it's already baked into their total damage/health.

import type { DetAggregate } from './extract';
import { CombatScene } from '../../engine';

export const BASE_ATTACK_DURATION = 1.5; // seconds (weapon-independent base cadence)

export interface DuelStats {
    name: string;
    damage: number;
    health: number;
    critChance: number;      // 0..1
    critMultiplier: number;  // full multiplier on a crit, e.g. 3.94
    doubleChance: number;    // 0..1
    aps: number;             // attacks per second
    lifesteal: number;       // 0..1 of damage dealt returned as healing
    block: number;           // 0..1 incoming damage negated
}

export interface DuelResult {
    winner: 'a' | 'b' | 'draw';
    aRemainingPct: number;
    bRemainingPct: number;
    aTTK: number | null;   // seconds for A to kill B (null if never)
    bTTK: number | null;
    aDps: number;
    bDps: number;
    duration: number;      // seconds simulated until end
    note?: string;
}

export function effectiveDps(s: DuelStats): number {
    const critAvg = 1 + Math.min(1, s.critChance) * Math.max(0, s.critMultiplier - 1);
    const doubleAvg = 1 + Math.min(1, s.doubleChance); // double attack ≈ an extra full hit
    return s.damage * s.aps * critAvg * doubleAvg;
}

/**
 * Engine-backed duel: the shared CombatScene at real geometry (spawn 0 vs 18, melee assumed
 * since a screenshot carries no weapon), 51 seeded runs, majority winner. effectiveDps stays
 * as the expected-value label shown in the UI.
 */
export function simulateDuel(a: DuelStats, b: DuelStats, maxSeconds = 120): DuelResult {
    const aDps = effectiveDps(a);
    const bDps = effectiveDps(b);
    const RUNS = 51;
    let aWins = 0;
    let bWins = 0;
    let draws = 0;
    let aKillTimes = 0;
    let aKills = 0;
    let bKillTimes = 0;
    let bKills = 0;
    let repr: { ah: number; bh: number; t: number } | null = null;

    for (let seed = 1; seed <= RUNS; seed++) {
        const scene = new CombatScene({ seed });
        const mk = (s: DuelStats, isAlly: boolean, x: number) =>
            scene.addUnit({
                isAlly,
                isPlayer: true,
                pos: { x, y: 0 },
                stats: {
                    hpMax: s.health,
                    hpMaxNoMulti: s.health,
                    dmg: s.damage,
                    moveSpeed: 2.0,
                    criticalChance: s.critChance,
                    criticalMulti: s.critMultiplier,
                    blockChance: s.block,
                    lifeSteal: s.lifesteal,
                    doubleDamageChance: s.doubleChance,
                    // aps was derived as attackSpeedMultiplier / 1.5; invert it.
                    attackSpeedMulti: Math.max(0.01, s.aps * BASE_ATTACK_DURATION),
                },
                hp: s.health,
                attackRange: 0.3,
                windupTime: 0.5,
                attackDuration: BASE_ATTACK_DURATION,
            });
        const ua = mk(a, true, 0);
        const ub = mk(b, false, 18);
        const maxTicks = Math.round(maxSeconds * 10);
        let t = 0;
        for (; t < maxTicks && !ua.killed && !ub.killed; t++) scene.tick();
        const time = scene.tickCount / 10;
        if (ub.killed && !ua.killed) {
            aWins++;
            aKills++;
            aKillTimes += time;
        } else if (ua.killed && !ub.killed) {
            bWins++;
            bKills++;
            bKillTimes += time;
        } else if (ua.killed && ub.killed) draws++;
        else {
            // timeout: higher remaining fraction wins, like the game's PvP rule
            const fa = ua.hp / a.health;
            const fb = ub.hp / b.health;
            if (fa > fb) aWins++;
            else if (fb > fa) bWins++;
            else draws++;
        }
        if (seed === 1) repr = { ah: Math.max(0, ua.hp), bh: Math.max(0, ub.hp), t: time };
    }

    const winner: DuelResult['winner'] = aWins === bWins ? 'draw' : aWins > bWins ? 'a' : 'b';
    const closeCall = Math.abs(aWins - bWins) <= Math.ceil(RUNS * 0.1);
    return {
        winner,
        aRemainingPct: ((repr?.ah ?? 0) / a.health) * 100,
        bRemainingPct: ((repr?.bh ?? 0) / b.health) * 100,
        aTTK: aKills ? aKillTimes / aKills : null,
        bTTK: bKills ? bKillTimes / bKills : null,
        aDps,
        bDps,
        duration: repr?.t ?? maxSeconds,
        note: closeCall
            ? `Close call: ${Math.round((aWins / RUNS) * 100)}% vs ${Math.round((bWins / RUNS) * 100)}% over ${RUNS} simulated fights.`
            : `${Math.round((Math.max(aWins, bWins) / RUNS) * 100)}% of ${RUNS} simulated fights.`,
    };
}

const sub = (agg: DetAggregate, id: string): number => agg.substats.find(x => x.statId === id)?.value ?? 0;

/** Opponent from an OCR'd aggregate profile screenshot (substats are in % points). */
export function aggregateToDuel(agg: DetAggregate, name = 'Opponent'): DuelStats {
    return {
        name,
        damage: agg.totalDamage ?? 0,
        health: agg.totalHealth ?? 0,
        critChance: sub(agg, 'CriticalChance') / 100,
        critMultiplier: 1 + sub(agg, 'CriticalMulti') / 100,
        doubleChance: sub(agg, 'DoubleDamageChance') / 100,
        aps: (1 + sub(agg, 'AttackSpeed') / 100) / BASE_ATTACK_DURATION,
        lifesteal: sub(agg, 'LifeSteal') / 100,
        block: sub(agg, 'BlockChance') / 100,
    };
}

/** Your side, from the app's computed stats (fractions already). */
export function playerToDuel(stats: any, name = 'You'): DuelStats {
    return {
        name,
        damage: stats?.totalDamage || 0,
        health: stats?.totalHealth || 0,
        critChance: stats?.criticalChance || 0,
        critMultiplier: stats?.criticalDamage || 1,
        doubleChance: stats?.doubleDamageChance || 0,
        aps: (stats?.attackSpeedMultiplier || 1) / BASE_ATTACK_DURATION,
        lifesteal: stats?.lifeSteal || 0,
        block: stats?.blockChance || 0,
    };
}
