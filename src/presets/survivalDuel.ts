/**
 * How long a build survives an attacker, measured by the combat engine.
 *
 * The arena's own loop (setupPvp, then per step: scene tick, the defender's skills, the
 * attacker's skills, see src/pvp/simulate.ts) with three changes that turn a match into a
 * survival test:
 *   - no arena HP multiplier: PvpHpBaseMultiplier 1 and every per-pet/skill/mount term 0, so each
 *     side fights with its card health;
 *   - no match timer: the duel runs until the defender dies or `seconds` of game time pass;
 *   - the attacker cannot die: its HP is refilled after every tick, so reflect, thorns and the
 *     defender's own damage never end the test early (the defender still attacks, which is what
 *     feeds its lifesteal).
 *
 * Score: the hits the defender takes before it dies, every hit of the attacker counted (weapon
 * strikes, the second strike of a double, skill hits; blocked and dodged ones included, they are
 * hits it lived through). At the top of the game damage outgrows health: the Max DPS preset kills
 * any build with its first hit that lands, so the time survived is a few seconds whatever the
 * build, and what separates builds is how many hits they absorb (block, health, critical damage
 * reduction). Hit counts are luck-driven, so scores are means over many seeds.
 */
import { runSeed } from '../engine/rng';
import { CombatScene, SkillManager, setupPvp, type PvpHpConfig } from '../engine';
import type { PvpFighter } from '../pvp/fighter';

export interface DuelResult {
    /** Second of the defender's death, or the full length when it survived. */
    seconds: number;
    survived: boolean;
    /** Defender HP / HpMax at the end (0 when dead). */
    hpFrac: number;
    /** Attacker hits that reached the defender, the killing one excluded. */
    hits: number;
}

const NO_ARENA_MULTIPLIER = (seconds: number): PvpHpConfig => ({
    PvpHpBaseMultiplier: 1,
    PvpHpPetMultiplier: 0,
    PvpHpSkillMultiplier: 0,
    PvpHpMountMultiplier: 0,
    PvpMatchTimerSeconds: seconds,
});

export function survivalDuel(defender: PvpFighter, attacker: PvpFighter, seconds: number, seed: bigint | number, arena: PvpHpConfig | null = null): DuelResult {
    const skills = new SkillManager();
    const scene = new CombatScene({ seed, skillSystem: s => skills.execute(s) });
    const { ally, enemy } = setupPvp(defender.loadout, attacker.loadout, arena ? { ...arena, PvpMatchTimerSeconds: seconds } : NO_ARENA_MULTIPLIER(seconds), scene);
    for (const s of defender.skills) skills.addSkill({ ...s, isAlly: true });
    for (const s of attacker.skills) skills.addSkill({ ...s, isAlly: false });
    const steps = Math.round(seconds * 10);
    let hits = 0;
    for (let t = 0; t < steps; t++) {
        scene.tick();
        enemy.hp = enemy.stats.hpMax;
        enemy.killed = false;
        for (const e of scene.tickEvents) if (!e.heal && e.targetId === ally.id && e.attackerId !== ally.id) hits++;
        if (ally.killed) return { seconds: scene.tickCount / 10, survived: false, hpFrac: 0, hits: hits - 1 };
        skills.tryAutoActivate(scene, true);
        skills.tryAutoActivate(scene, false);
    }
    return { seconds, survived: true, hpFrac: Math.max(0, ally.hp) / ally.stats.hpMax, hits };
}

/** Mean hits survived over runSeed(1..runs) (same seeds for every build: common random numbers). */
export function survivalScore(defender: PvpFighter, attacker: PvpFighter, seconds: number, runs: number): number {
    let total = 0;
    for (let seed = 1; seed <= runs; seed++) total += survivalDuel(defender, attacker, seconds, runSeed(seed)).hits;
    return total / runs;
}
