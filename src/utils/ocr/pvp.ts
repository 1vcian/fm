// Simplified 1v1 duel for the PvP feature. Both fighters are reduced to their FINAL
// aggregate stats (which already include tree + passives), so pitting your computed build
// against the opponent's screenshot totals is the real, fair matchup — no need to know the
// opponent's tree separately, since it's already baked into their total damage/health.

import type { DetAggregate } from './extract';

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

/** Tick-based duel (10 Hz), both sides trading blows and healing from lifesteal. */
export function simulateDuel(a: DuelStats, b: DuelStats, maxSeconds = 120): DuelResult {
    const dt = 0.1;
    const aDps = effectiveDps(a), bDps = effectiveDps(b);
    const aIn = bDps * (1 - Math.min(1, a.block)); // dps A takes
    const bIn = aDps * (1 - Math.min(1, b.block));
    const aHeal = aDps * Math.min(1, a.lifesteal);
    const bHeal = bDps * Math.min(1, b.lifesteal);
    let ah = a.health, bh = b.health;
    let aTTK: number | null = null, bTTK: number | null = null;
    let t = 0;
    for (; t < maxSeconds; t += dt) {
        bh -= bIn * dt; ah -= aIn * dt;
        ah = Math.min(a.health, ah + aHeal * dt);
        bh = Math.min(b.health, bh + bHeal * dt);
        if (bTTK === null && bh <= 0) bTTK = t + dt;
        if (aTTK === null && ah <= 0) aTTK = t + dt;
        if (ah <= 0 || bh <= 0) break;
    }
    const aRemainingPct = Math.max(0, ah) / a.health * 100;
    const bRemainingPct = Math.max(0, bh) / b.health * 100;
    let winner: 'a' | 'b' | 'draw';
    let note: string | undefined;
    if (ah <= 0 && bh <= 0) winner = aTTK != null && bTTK != null ? (aTTK <= bTTK ? 'a' : 'b') : 'draw';
    else if (bh <= 0) winner = 'a';
    else if (ah <= 0) winner = 'b';
    else {
        // neither died: sustain stalemate — decide by who is closer to killing (lower net EHP time)
        note = 'Neither could break the other within 2 minutes (lifesteal/health sustain). Higher remaining HP wins on time.';
        winner = aRemainingPct === bRemainingPct ? 'draw' : (aRemainingPct > bRemainingPct ? 'a' : 'b');
    }
    return { winner, aRemainingPct, bRemainingPct, aTTK, bTTK, aDps, bDps, duration: Math.min(t + dt, maxSeconds), note };
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
