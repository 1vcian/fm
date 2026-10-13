/**
 * Engine check: the player's real DPS/HPS measured by running the combat engine against
 * non-attacking, effectively unkillable dummies. This is the measurement the analytic figures in
 * src/utils/statEngine.ts are verified against (within 1% at steady state), plus what a formula
 * cannot give: the opening of a battle and several targets at once.
 *
 *   steady state   dummies stand where the player stops (2 * radius + attack range, just inside),
 *                  damage and healing are counted from WARMUP_SECONDS on, so the 4 s initial skill
 *                  charge and the first casts are out of the window
 *   opening        a main battle start: WaveRunner's 2.0 s wave delay (SetupBattle 0x77EAB50), the
 *                  dummy at player.X + 15 (the spawn distance), the player walks in; everything the
 *                  first OPENING_SECONDS deal counts
 *   N targets      the steady-state run with N dummies in the main-battle formation: area skills
 *                  hit all of them, the weapon hits one
 *
 * Healing is measured "gross": the player's HpMax is raised far above its HP, so lifesteal, regen
 * and buff heals are never clamped at full HP (regen scales on hpMaxNoMulti, which is untouched).
 */
import { CombatScene } from './scene';
import { SkillManager, type SkillSpec } from './skills';
import { WaveRunner, mainBattleFormation } from './modes';
import type { UnitSpec } from './types';

/** Seconds discarded at the start of a steady-state run. */
export const WARMUP_SECONDS = 60;
/** Length of the opening window. */
export const OPENING_SECONDS = 60;

const HUGE = 1e18;
const UNIT_RADIUS = 0.35;

function dummySpec(x: number, y: number): UnitSpec {
    return {
        isAlly: false,
        pos: { x, y },
        stats: { hpMax: HUGE, hpMaxNoMulti: HUGE, dmg: 0, moveSpeed: 0 },
        hp: HUGE,
        // Never attacks: no unit is ever inside a negative range.
        attackRange: -1e9,
        windupTime: 0.5,
        attackDuration: 1.5,
        tag: 'dummy',
    };
}

function addGrossPlayer(scene: CombatScene, unit: UnitSpec) {
    const player = scene.addUnit({ ...unit, pos: { x: 0, y: 0 } });
    // Gross healing: HP far below HpMax, so no heal is clamped. Buffs rewrite stats.hpMax from
    // baseHpMax every tick, so both are raised.
    player.baseHpMax = HUGE;
    player.stats.hpMax = HUGE;
    player.hp = 1;
    return player;
}

export interface SteadyStateResult {
    dps: number;
    hps: number;
}

/** Damage per second on the dummies and healing per second, over [WARMUP_SECONDS, seconds]. */
export function steadyStateRun(unit: UnitSpec, skills: SkillSpec[], targets: number, seconds: number, seed: number): SteadyStateResult {
    const sm = new SkillManager();
    for (const s of skills) sm.addSkill({ ...s, isAlly: true });
    const scene = new CombatScene({ seed, skillSystem: (s) => sm.execute(s) });
    const player = addGrossPlayer(scene, unit);
    const distance = 2 * UNIT_RADIUS + Math.max(0, unit.attackRange) - 1e-3;
    const ids = new Set<number>();
    for (const f of mainBattleFormation(Math.max(1, targets))) ids.add(scene.addUnit(dummySpec(distance + f.x, f.y)).id);

    const warm = Math.round(WARMUP_SECONDS * 10);
    const ticks = Math.max(warm + 10, Math.round(seconds * 10));
    let dmg = 0;
    let hp0 = 0;
    for (let t = 0; t < ticks; t++) {
        if (t === warm) hp0 = player.hp;
        scene.tick();
        if (t >= warm) {
            for (const e of scene.tickEvents) if (!e.heal && !e.dodged && ids.has(e.targetId)) dmg += e.dmg;
        }
        sm.tryAutoActivate(scene, true);
    }
    const window = (ticks - warm) / 10;
    return { dps: dmg / window, hps: (player.hp - hp0) / window };
}

/** Damage per second over the first OPENING_SECONDS of a main battle against one dummy. */
export function openingRun(unit: UnitSpec, skills: SkillSpec[], seed: number): number {
    const sm = new SkillManager();
    for (const s of skills) sm.addSkill({ ...s, isAlly: true });
    const scene = new CombatScene({ seed, keepEvents: true, skillSystem: (s) => sm.execute(s) });
    const player = addGrossPlayer(scene, unit);
    const { pos: _pos, isAlly: _ally, ...dummy } = dummySpec(0, 0);
    const ticks = Math.round(OPENING_SECONDS * 10);
    // Main battle defaults: spawn distance 15, 2.0 s before the first wave.
    new WaveRunner(scene, player, [[{ ...dummy, offset: { x: 0, y: 0 } }]], { maxTicks: ticks }, sm).run();
    const ids = new Set(scene.units.filter((u) => u.tag === 'dummy').map((u) => u.id));
    let dmg = 0;
    for (const e of scene.events) if (!e.heal && !e.dodged && ids.has(e.targetId)) dmg += e.dmg;
    return dmg / OPENING_SECONDS;
}

export interface EngineCheckResult {
    /** Steady state, one target. */
    dps: number;
    hps: number;
    /** First OPENING_SECONDS of a main battle, one target. */
    openingDps: number;
    /** Steady-state total DPS with N targets. */
    targets: { count: number; dps: number }[];
    seeds: number;
    seconds: number;
    /** Wall time of the measurement, ms. */
    ms: number;
}

export interface EngineCheckOptions {
    seeds?: number;
    seconds?: number;
    targetCounts?: number[];
}

export function engineCheck(unit: UnitSpec, skills: SkillSpec[], o: EngineCheckOptions = {}): EngineCheckResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const seeds = o.seeds ?? 3;
    const seconds = o.seconds ?? 360;
    const counts = o.targetCounts ?? [1, 3, 5];
    const targets = counts.map((count) => ({ count, dps: 0 }));
    let dps = 0, hps = 0, openingDps = 0;
    for (let seed = 1; seed <= seeds; seed++) {
        for (const row of targets) {
            const r = steadyStateRun(unit, skills, row.count, seconds, seed);
            row.dps += r.dps / seeds;
            if (row.count === 1) { dps += r.dps / seeds; hps += r.hps / seeds; }
        }
        openingDps += openingRun(unit, skills, seed) / seeds;
    }
    if (!counts.includes(1)) {
        for (let seed = 1; seed <= seeds; seed++) {
            const r = steadyStateRun(unit, skills, 1, seconds, seed);
            dps += r.dps / seeds; hps += r.hps / seeds;
        }
    }
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { dps, hps, openingDps, targets, seeds, seconds, ms: t1 - t0 };
}
