/**
 * Engine check: the player's real DPS/HPS measured by running the combat engine against
 * non-attacking, effectively unkillable dummies. This is the measurement the analytic figures in
 * src/utils/statEngine.ts are verified against (within 1% at steady state), plus what a formula
 * cannot give: the opening of a battle and several targets at once.
 *
 *   tested run     the "Tested DPS/HPS" of the UI: TESTED_SECONDS (24 h) of game time after the
 *                  warm-up against one dummy, averaged per second and split by source (weapon,
 *                  each buff's part of the weapon hits, each skill, regen, lifesteal, skill heals)
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
import { WaveRunner, mainBattleFormation, setupPvp, timerFrames, type PvpHpConfig, type PvpLoadout } from './modes';
import type { UnitSpec } from './types';

/** Seconds discarded at the start of a steady-state run. */
export const WARMUP_SECONDS = 60;
/** Length of the opening window. */
export const OPENING_SECONDS = 60;

/**
 * Dummy HP and the player's raised HpMax. Far beyond any damage or healing a run can add up (10^18
 * capped the 24 h tested run at 10^18 / 86400 = 11.57T DPS and HPS), and still far from
 * overflowing a double when a fraction of it is taken.
 */
const HUGE = 1e100;
const UNIT_RADIUS = 0.35;

/**
 * Dummies are refilled after every tick, so no damage total can ever kill them: a dead dummy is
 * swept and stops taking hits while the run keeps counting seconds.
 */
function keepAlive(units: { hp: number; killed: boolean }[]) {
    for (const u of units) {
        u.hp = HUGE;
        u.killed = false;
    }
}

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
    const dummies = mainBattleFormation(Math.max(1, targets)).map((f) => scene.addUnit(dummySpec(distance + f.x, f.y)));
    for (const d of dummies) ids.add(d.id);

    const warm = Math.round(WARMUP_SECONDS * 10);
    const ticks = Math.max(warm + 10, Math.round(seconds * 10));
    let dmg = 0;
    let hp0 = 0;
    for (let t = 0; t < ticks; t++) {
        if (t === warm) hp0 = player.hp;
        scene.tick();
        keepAlive(dummies);
        if (t >= warm) {
            for (const e of scene.tickEvents) if (!e.heal && !e.dodged && ids.has(e.targetId)) dmg += e.dmg;
        }
        sm.tryAutoActivate(scene, true);
    }
    const window = (ticks - warm) / 10;
    return { dps: dmg / window, hps: (player.hp - hp0) / window };
}

/** Game time of the tested run: 24 hours, 864000 ticks at 10 Hz. */
export const TESTED_SECONDS = 24 * 3600;

/**
 * Per-source key of the tested run:
 *   weapon               the weapon's own hits (melee or projectile), buff part removed
 *   buff:<Type>          what an active buff skill added to the weapon hits (crit applied)
 *   skill:<Type>         a skill's own damage (areas, projectiles, the Drone's shots)
 *   regen                HealthRegen (whatever is left of the HP gain after the counted heals)
 *   lifesteal:<source>   lifesteal, keyed by the damage source that triggered it
 *   heal:<Type>          a buff skill's Health grant on activation
 */
export interface TestedRunResult {
    seconds: number;
    seed: number;
    dps: number;
    hps: number;
    /** Per second, by source key. */
    dpsBySource: Record<string, number>;
    hpsBySource: Record<string, number>;
}

function sourceKey(e: { source?: string; skillId?: string }): string {
    if (e.source === 'skill' && e.skillId) return `skill:${e.skillId}`;
    if (e.source === 'reflect') return 'reflect';
    return 'weapon';
}

/**
 * The tested DPS/HPS: one non-attacking, unkillable dummy at the player's stop distance, the
 * first WARMUP_SECONDS run and dropped, then `seconds` of game time averaged. Gross healing
 * (see addGrossPlayer). `onProgress(fraction)` is called every `progressEvery` ticks.
 */
export function testedRun(
    unit: UnitSpec, skills: SkillSpec[], seconds = TESTED_SECONDS, seed = 1,
    onProgress?: (fraction: number) => void, progressEvery = 36000,
): TestedRunResult {
    const sm = new SkillManager();
    for (const s of skills) sm.addSkill({ ...s, isAlly: true });
    const scene = new CombatScene({ seed, skillSystem: (s) => sm.execute(s) });
    const player = addGrossPlayer(scene, unit);
    const distance = 2 * UNIT_RADIUS + Math.max(0, unit.attackRange) - 1e-3;
    const dummy = scene.addUnit(dummySpec(distance, 0));
    const dummyId = dummy.id;

    const warm = Math.round(WARMUP_SECONDS * 10);
    const ticks = warm + Math.max(10, Math.round(seconds * 10));
    const dmg: Record<string, number> = {};
    const heal: Record<string, number> = {};
    const add = (m: Record<string, number>, k: string, v: number) => { m[k] = (m[k] ?? 0) + v; };
    let hp0 = 0;
    for (let t = 0; t < ticks; t++) {
        if (t === warm) hp0 = player.hp;
        scene.tick();
        keepAlive([dummy]);
        // Activations land in this tick's events too (a buff's Health grant), so count after it.
        sm.tryAutoActivate(scene, true);
        if (t >= warm) {
            // applyDmg emits a hit, then its lifesteal heal: the heal belongs to the hit before it.
            let last = 'weapon';
            for (const e of scene.tickEvents) {
                if (e.heal) {
                    if (e.targetId !== player.id) continue;
                    if (e.source === 'lifesteal') add(heal, `lifesteal:${last}`, e.dmg);
                    else if (e.skillId) add(heal, `heal:${e.skillId}`, e.dmg);
                    continue;
                }
                if (e.dodged || e.targetId !== dummyId) continue;
                last = sourceKey(e);
                let own = e.dmg;
                if (last === 'weapon' && e.buffDmg) {
                    for (const k in e.buffDmg) { add(dmg, `buff:${k}`, e.buffDmg[k]); own -= e.buffDmg[k]; }
                }
                add(dmg, last, own);
            }
        }
        if (onProgress && (t + 1) % progressEvery === 0) onProgress((t + 1) / ticks);
    }
    const window = (ticks - warm) / 10;
    const counted = Object.values(heal).reduce((a, b) => a + b, 0);
    const regen = player.hp - hp0 - counted;
    if (Math.abs(regen) > 0) heal.regen = regen;
    const perSecond = (m: Record<string, number>) => {
        const out: Record<string, number> = {};
        for (const k in m) out[k] = m[k] / window;
        return out;
    };
    const dpsBySource = perSecond(dmg);
    const hpsBySource = perSecond(heal);
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    return { seconds: window, seed, dps: sum(dpsBySource), hps: sum(hpsBySource), dpsBySource, hpsBySource };
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
    /** The tested run (TESTED_SECONDS of game time, one target). */
    tested: TestedRunResult;
    /** Steady state, one target (short runs, the base of the target ratios). */
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
    testedSeconds?: number;
    /** 0..1 over the whole check (the tested run is most of it). */
    onProgress?: (fraction: number) => void;
}

export function engineCheck(unit: UnitSpec, skills: SkillSpec[], o: EngineCheckOptions = {}): EngineCheckResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const TESTED_SHARE = 0.9;
    const tested = testedRun(unit, skills, o.testedSeconds ?? TESTED_SECONDS, 1, (f) => o.onProgress?.(f * TESTED_SHARE));
    const seeds = o.seeds ?? 3;
    const seconds = o.seconds ?? 360;
    const counts = o.targetCounts ?? [1, 3, 5];
    const targets = counts.map((count) => ({ count, dps: 0 }));
    let dps = 0, hps = 0, openingDps = 0;
    const steps = seeds * (counts.length + 1);
    let done = 0;
    const step = () => o.onProgress?.(TESTED_SHARE + ((1 - TESTED_SHARE) * ++done) / steps);
    for (let seed = 1; seed <= seeds; seed++) {
        for (const row of targets) {
            const r = steadyStateRun(unit, skills, row.count, seconds, seed);
            row.dps += r.dps / seeds;
            if (row.count === 1) { dps += r.dps / seeds; hps += r.hps / seeds; }
            step();
        }
        openingDps += openingRun(unit, skills, seed) / seeds;
        step();
    }
    if (!counts.includes(1)) {
        for (let seed = 1; seed <= seeds; seed++) {
            const r = steadyStateRun(unit, skills, 1, seconds, seed);
            dps += r.dps / seeds; hps += r.hps / seeds;
        }
    }
    o.onProgress?.(1);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { tested, dps, hps, openingDps, targets, seeds, seconds, ms: t1 - t0 };
}

/** One skill in a PvP run against the dummy. */
export interface PvpSkillTrace {
    id: string;
    slot: number;
    /** Ticks (0.1 s each) on which the skill was activated. */
    casts: number[];
    /** Damage skills: its own hits on the dummy inside the timer. Buffs: the part they added to weapon hits. */
    damage: number;
    hits: number;
    /** Tick of the last hit inside the timer, -1 if none. */
    lastHitTick: number;
    /** Casts after the last hit that landed: their damage never reached the dummy before the timer. */
    wastedCasts: number;
    /** Buffs: ticks the buff was active inside the timer. */
    activeTicks: number;
    /** Ticks from the first cast to its first hit on the dummy (the effect's travel or fall time), -1 if none. */
    firstHitDelayTicks: number;
}

export interface PvpSkillRunResult {
    timerSeconds: number;
    frames: number;
    skills: PvpSkillTrace[];
    /** Sum of the damage skills' own damage (skills never crit, so this is deterministic per seed). */
    skillDamage: number;
}

/**
 * A PvP battle against a dummy, for the skill cycle: setupPvp with the player's loadout on both
 * sides (the shared HP multiplier, the 18 spawn gap and the opponent walking in like a mirror
 * would), then the opponent is made unkillable, harmless and statless (no dodge, block or reflect).
 * It runs PvpMatchTimerSeconds of frames (timerFrames) in runPvp's order: tick, then the player's
 * TryActivateSkills. Every skill hit and every cast is traced, so a cast whose meteor or projectile
 * lands after the timer shows as wasted.
 */
export function pvpSkillRun(loadout: PvpLoadout, skills: SkillSpec[], cfg: PvpHpConfig, seed = 1): PvpSkillRunResult {
    const sm = new SkillManager();
    for (const s of skills) sm.addSkill({ ...s, isAlly: true });
    const scene = new CombatScene({ seed, skillSystem: (s) => sm.execute(s) });
    const dummy: PvpLoadout = {
        ...loadout,
        stats: { dmg: 0, moveSpeed: loadout.stats.moveSpeed },
        petCount: 0, skillCount: 0, hasMount: false, tag: 'dummy',
    };
    const setup = setupPvp(loadout, dummy, cfg, scene);
    const target = setup.enemy;
    target.baseHpMax = HUGE;
    target.stats.hpMax = HUGE;
    target.hp = HUGE;

    const frames = timerFrames(setup.timerSeconds);
    const order = sm.snapshot();
    const traces: PvpSkillTrace[] = order.map((s, i) => ({
        id: s.id, slot: skills.find(k => k.id === s.id)?.slot ?? i, casts: [], damage: 0, hits: 0,
        lastHitTick: -1, wastedCasts: 0, activeTicks: 0, firstHitDelayTicks: -1,
    }));
    const firstHit = traces.map(() => -1);
    const byId = new Map(traces.map(t => [t.id, t]));
    for (let t = 0; t < frames; t++) {
        scene.tick();
        keepAlive([target]);
        for (const e of scene.tickEvents) {
            if (e.heal || e.dodged || e.targetId !== target.id) continue;
            if (e.source === 'skill' && e.skillId) {
                const tr = byId.get(e.skillId);
                if (tr) {
                    tr.damage += e.dmg; tr.hits++; tr.lastHitTick = scene.tickCount;
                    const i = traces.indexOf(tr);
                    if (firstHit[i] < 0) firstHit[i] = scene.tickCount;
                }
            }
            if (e.buffDmg) for (const k in e.buffDmg) {
                const tr = byId.get(k);
                if (tr) { tr.damage += e.buffDmg[k]; tr.hits++; tr.lastHitTick = scene.tickCount; }
            }
        }
        const before = sm.snapshot();
        sm.tryAutoActivate(scene, true);
        const after = sm.snapshot();
        after.forEach((s, i) => {
            if (s.state === 'active' && before[i].state !== 'active') traces[i].casts.push(scene.tickCount);
            if (s.state === 'active') traces[i].activeTicks++;
        });
    }
    let skillDamage = 0;
    for (const [i, tr] of traces.entries()) {
        tr.wastedCasts = tr.casts.filter(c => c > tr.lastHitTick).length;
        if (firstHit[i] >= 0 && tr.casts.length > 0) tr.firstHitDelayTicks = firstHit[i] - tr.casts[0];
        if (!order[i].isBuff) skillDamage += tr.damage;
    }
    return { timerSeconds: setup.timerSeconds, frames, skills: traces, skillDamage };
}
