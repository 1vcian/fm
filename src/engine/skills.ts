/**
 * Skills — charge, activation, effects and buffs, verified against build 2026_10_08_09_03.
 *
 * The load-bearing facts (all disassembled, see the skill recon in docs/combat-model.md):
 *
 *  - Every skill starts the battle on a HARDCODED 4.0 s charge (AddOrUpdateSkill,
 *    startWithCooldown always true). Not the cooldown, not scaled by anything.
 *  - Skill timers are FD6 and tick down by FD6(dt) = 0.099999 (truncated), so every phase
 *    costs ceil(micro/99999) ticks — one more than nominal. 4.0 s = 41 ticks.
 *  - Cooldown starts when the ACTIVE phase ends, and cooldown length is the only thing the
 *    CDR stat scales. ActiveDuration is used raw.
 *  - Optimal play = the game's own auto mode = PvP's TryActivateSkills: after the scene
 *    ticks, activate every ready skill in slot order, ally side first.
 *  - Buff skills (Meat, Morale, Berserk, Buff, HigherMorale) spawn nothing: every tick the
 *    ACTIVE buffs' Damage/Health totals are ADDED to each non-summon unit's base dmg/hpMax/
 *    hpMaxNoMulti (Value = Base + total, recomputed from base, so expiry leaves no residue
 *    and Hp clamps down). On ACTIVATION, health-carrying buffs also grant current Hp
 *    (+Health, clamped to the buffed max) — that is the one real heal in the game.
 *  - Damage skills spawn projectiles/AoEs with hardcoded radii and timing; their damage
 *    snapshot carries ONLY Dmg (no crit, no lifesteal), but the TARGET's dodge/block/reflect
 *    still roll. Hit counts divide the skill's damage (GetSkillDamageCount).
 *  - Skill jitter uses an UNSEEDED counter LCG (PseudoRandom), one per scene, shared by both
 *    sides in call order (PvP: ally activations first): the same sequence every battle.
 *    Reproduced verbatim, with the two constant pairs at the exact call sites.
 */
import { CombatScene, DT } from './scene';
import { Unit, Vec2, defaultStats } from './types';

/** FD6(dt): the truncated per-tick decrement of every skill timer (micro-units). */
const FD6_DT_MICRO = 99999;
/** The hardcoded initial charge (AddOrUpdateSkill, F64 raw 0x400000000 = 4.0 s). */
const INITIAL_CHARGE_MICRO = 4_000_000;

// ------------------------------------------------------------------ closed-form skill timing
// The exact tick math of SkillManager.execute + tryAutoActivate below, for the stat panels.
// A phase with timer T (micro) ends on the tick where T - k*99999 <= 0; the transition is an
// if/else-if, so a phase that starts at 0 (instant skill, zero cooldown) still costs one tick.

/** Ticks a skill phase of `seconds` lasts: max(1, ceil(round(s*1e6) / 99999)). */
export function skillPhaseTicks(seconds: number): number {
    return Math.max(1, Math.ceil(Math.round(seconds * 1e6) / FD6_DT_MICRO));
}

/** Steady-state cast period in ticks: the active phase, then the cooldown (CDR applied). */
export function skillCycleTicks(cooldownSeconds: number, activeDurationSeconds: number): number {
    return skillPhaseTicks(activeDurationSeconds) + skillPhaseTicks(cooldownSeconds);
}

/** Tick (1-based, cast happens after that tick's scene step) of the first cast: the 4.0 s charge. */
export function skillFirstCastTick(): number {
    return Math.ceil(INITIAL_CHARGE_MICRO / FD6_DT_MICRO);
}

/**
 * Ticks during which an activated buff's Damage/Health is on the units: the totals are written
 * at the start of each tick (execute), so the activation tick itself is not buffed and the tick
 * on which the active timer runs out is not either: phaseTicks - 1.
 */
export function buffActiveTicks(activeDurationSeconds: number): number {
    return skillPhaseTicks(activeDurationSeconds) - 1;
}

/**
 * Smallest cooldown reduction (fraction) at which the cooldown phase of `baseCooldown` costs at
 * most `ticks` ticks: the inverse of skillPhaseTicks(baseCooldown * (1 - r)). NaN if unreachable.
 */
export function cooldownReductionForTicks(baseCooldown: number, ticks: number): number {
    if (baseCooldown <= 0 || ticks < 1) return NaN;
    const ok = (r: number) => skillPhaseTicks(baseCooldown * (1 - r)) <= ticks;
    if (ok(0)) return 0;
    if (!ok(1)) return NaN;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) hi = mid;
        else lo = mid;
    }
    return hi;
}

export interface CooldownBreakpoint {
    /** Reduction (fraction) from which this row applies. */
    reduction: number;
    cooldownTicks: number;
    cycleTicks: number;
    castsPerMinute: number;
}

/**
 * The current row plus the next `count` cooldown breakpoints above reduction `fromR`: every
 * whole tick shaved off the cooldown phase is one step, nothing in between changes the timing.
 */
export function cooldownBreakpoints(baseCooldown: number, activeDuration: number, fromR: number, count = 5): CooldownBreakpoint[] {
    const row = (reduction: number, cooldownTicks: number): CooldownBreakpoint => {
        const cycleTicks = skillPhaseTicks(activeDuration) + cooldownTicks;
        return { reduction, cooldownTicks, cycleTicks, castsPerMinute: 600 / cycleTicks };
    };
    const c0 = skillPhaseTicks(baseCooldown * (1 - fromR));
    const out = [row(fromR, c0)];
    for (let c = c0 - 1; c >= 1 && out.length <= count; c--) {
        const r = cooldownReductionForTicks(baseCooldown, c);
        if (!(r < 1)) break;
        out.push(row(r, c));
    }
    return out;
}

/** Cast times (seconds) inside a battle of `seconds`, exact tick math, 0.1 s per tick. */
export function skillCastTimes(battleSeconds: number, cooldownSeconds: number, activeDurationSeconds: number, max = 1000): number[] {
    const out: number[] = [];
    const end = Math.round(battleSeconds * 10);
    const period = skillCycleTicks(cooldownSeconds, activeDurationSeconds);
    for (let t = skillFirstCastTick(); t <= end && out.length < max; t += period) out.push(t / 10);
    return out;
}

/** Skill types that spawn nothing and buff the caster's side instead (SkillBuilder has no builder). */
export const BUFF_SKILL_TYPES: ReadonlySet<string> = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);
const BUFF_SKILLS = BUFF_SKILL_TYPES;

/**
 * Where each skill's damage is centered and how it is delivered, from its SkillBuilder (RVAs in
 * spawnEffects below). "the enemies" = CreateSkillEffectEntities' center (0x77F1900): the mean
 * Position of the opposite non-summon units with |x - player.x| < 10, else player + 10 forward.
 * Area damage hits units whose center is inside the radius, on the pulse or the final pulse
 * (HandleAreaProjectiles 0x77F3840: Timer += dt, final pulse when Timer > Duration).
 */
export const SKILL_EPICENTER: Readonly<Record<string, string>> = {
    Arrows: '3 arcing shots from 12 behind you, at each enemy',
    Shuriken: '5 arcing shots from 12 behind you, at each enemy',
    Shout: 'area r10 at 5 in front of you, a pulse every 1.5/8 s for 1.5 s',
    Meteorite: '5 areas r5 around the enemies, each lands after 1 s + a random 0 to 1 s',
    Stampede: 'area r3 from 15 behind you, runs forward at 8/s, a pulse every 0.25 s for 8 s',
    Thorns: 'area r3 on the enemies, a pulse every 0.5 s, then a final hit 1.5 s after the cast',
    Bomb: 'area r4 on the enemies, lands after 1 s',
    Worm: 'area r4 on the enemies, lands after 0.1 s',
    Lightning: '5 areas r3 around the enemies, each lands after a random 0 to 0.5 s',
    RainOfArrows: 'area r6 on the enemies, a pulse every 0.2 s after a 1 s delay, ends 4 s after the cast',
    StrafeRun: 'area r3 on the enemies, a pulse every 0.25 s for 1 s',
    CannonBarrage: '3 areas r6 around the enemies, each lands after 1 s + a random 0 to 0.5 s',
    Drone: 'a drone from 10 behind you that flies in and shoots for its duration',
};

/** GetSkillDamageCount (0x77EDA78): how many pieces the skill's damage is split into. */
const DAMAGE_COUNT: Record<string, number> = {
    Arrows: 3,
    Shuriken: 5,
    Shout: 8,
    Meteorite: 5,
    Lightning: 5,
    CannonBarrage: 3,
    RainOfArrows: 15, // divided locally in the builder, not via GetSkillDamageCount
};

export function skillDamageCount(id: string): number {
    return DAMAGE_COUNT[id] ?? 1;
}

/**
 * PseudoRandom (Next 0x77EE190, build 2026_10_08_09_03): a counter LCG, one instance per
 * SkillSystem, i.e. one per CombatScene (SkillSystem ctor 0x77F11A4 stores `new PseudoRandom()`
 * at +0x18; CombatScene ctor 0x77EAE68 builds the SkillSystem). The battle seed never reaches it
 * (the seed goes only to AttacksSystem's RandomPCG, 0x77F3344), so the jitter sequence is
 * identical in every battle and is shared by both sides in call order.
 *
 *   Next(a, b, c): _offset += 1; v = (_offset * a + b) & 0x7FFFFFFF  (32-bit wrap);
 *                  return F64.Ratio(v % c, c)  (Q32.32, truncated)
 *
 * Every call site passes c = 10000 and one of two constant pairs (see JITTER_A / JITTER_B).
 */
export const JITTER_A: readonly [number, number] = [1103515245, 12345];
export const JITTER_B: readonly [number, number] = [2003515245, 32425];
const JITTER_C = 10000;
const TWO_32 = 4294967296;

export class PseudoRandom {
    private offset = 0;
    next(a: number = JITTER_A[0], b: number = JITTER_A[1], c: number = JITTER_C): number {
        this.offset = (this.offset + 1) | 0;
        const v = (Math.imul(this.offset, a) + b) & 0x7fffffff;
        return Math.floor(((v % c) * TWO_32) / c) / TWO_32;
    }
}

/** Q32.32 truncation of a non-negative value (F64 division by an int truncates). */
const q32 = (x: number) => Math.floor(x * TWO_32) / TWO_32;

export interface SkillSpec {
    /** SkillLibrary Type: 'Meteorite', 'Morale', ... */
    id: string;
    slot: number;
    isAlly: boolean;
    /** Fully stat-resolved by the caller (base * skill layers * common layer). */
    damage: number;
    health: number;
    /** Seconds, AFTER the CDR stat (TimerSpeed scales only this). */
    cooldown: number;
    /** Seconds, raw from SkillLibrary; 0 = instant. */
    activeDuration: number;
}

interface SkillRuntime extends SkillSpec {
    isActive: boolean;
    isOnCooldown: boolean;
    timerMicro: number;
    cooldownMicro: number;
    activeMicro: number;
}

export class SkillManager {
    private readonly skills: SkillRuntime[] = [];
    private readonly rand = new PseudoRandom();
    private readonly initialChargeMicro: number;

    /** initialChargeSeconds exists for the debug panel; the game's value is 4.0, always. */
    constructor(initialChargeSeconds?: number) {
        this.initialChargeMicro =
            initialChargeSeconds !== undefined ? Math.round(initialChargeSeconds * 1e6) : INITIAL_CHARGE_MICRO;
    }

    addSkill(spec: SkillSpec): void {
        this.skills.push({
            ...spec,
            isActive: false,
            isOnCooldown: true, // startWithCooldown: always true in both modes
            timerMicro: this.initialChargeMicro,
            cooldownMicro: Math.round(spec.cooldown * 1e6),
            activeMicro: Math.round(spec.activeDuration * 1e6),
        });
        // Dictionary order = slot order: keep the list sorted the way the game iterates it.
        this.skills.sort((a, b) => Number(b.isAlly) - Number(a.isAlly) || a.slot - b.slot);
    }

    /** The SkillSystem step: timers, then buff totals rewritten onto every unit. */
    execute(scene: CombatScene): void {
        for (const sk of this.skills) {
            if (sk.isActive || sk.isOnCooldown) sk.timerMicro -= FD6_DT_MICRO;
            if (sk.timerMicro <= 0) {
                if (sk.isActive) {
                    // The active phase just ended: the cooldown starts NOW, not at cast.
                    sk.isActive = false;
                    sk.isOnCooldown = true;
                    sk.timerMicro = sk.cooldownMicro;
                } else if (sk.isOnCooldown) {
                    sk.isOnCooldown = false;
                    sk.timerMicro = 0;
                }
            }
        }
        this.applyBuffs(scene, true);
        this.applyBuffs(scene, false);
    }

    /** The game's auto mode / PvP TryActivateSkills: activate everything ready, slot order. */
    tryAutoActivate(scene: CombatScene, isAlly: boolean): void {
        for (const sk of this.skills) {
            if (sk.isAlly === isAlly && !sk.isActive && !sk.isOnCooldown) this.activate(scene, sk);
        }
    }

    /** Ready right now (for visualizer state). */
    snapshot(): {
        id: string; isAlly: boolean; state: 'ready' | 'active' | 'cooldown'; secondsLeft: number;
        /** Length of the current phase (active duration or cooldown), for progress rings. */
        phaseSeconds: number;
        damage: number; health: number; isBuff: boolean;
    }[] {
        return this.skills.map((sk) => ({
            id: sk.id,
            isAlly: sk.isAlly,
            state: sk.isActive ? 'active' : sk.isOnCooldown ? 'cooldown' : 'ready',
            secondsLeft: Math.max(0, sk.timerMicro) / 1e6,
            phaseSeconds: (sk.isActive ? sk.activeMicro : sk.isOnCooldown ? Math.max(sk.cooldownMicro, sk.timerMicro) : 0) / 1e6,
            damage: sk.damage,
            health: sk.health,
            isBuff: BUFF_SKILLS.has(sk.id),
        }));
    }

    private activate(scene: CombatScene, sk: SkillRuntime): void {
        if (sk.isActive || sk.isOnCooldown) return;
        sk.isActive = true;
        sk.timerMicro = sk.activeMicro;
        this.spawnEffects(scene, sk);
        // Buff totals recompute immediately; the Hp grant lands now, the dmg buff next tick.
        if (BUFF_SKILLS.has(sk.id) && sk.health > 0) {
            const hpBuff = this.buffTotals(sk.isAlly).hp;
            for (const u of scene.units) {
                if (u.destroyed || u.isSummon || u.isAlly !== sk.isAlly) continue;
                u.stats.hpMax = u.baseHpMax + hpBuff;
                u.stats.hpMaxNoMulti = u.baseHpMaxNoMulti + hpBuff;
                const before = u.hp;
                u.hp = Math.min(u.hp + sk.health, u.stats.hpMax);
                scene.emit({
                    targetId: u.id, attackerId: u.id, dmg: u.hp - before, heal: true,
                    source: 'buff', skillId: sk.id, x: u.pos.x + u.com.x, y: u.pos.y + u.com.y,
                });
            }
        }
    }

    private buffTotals(isAlly: boolean): { dmg: number; hp: number } {
        let dmg = 0;
        let hp = 0;
        for (const sk of this.skills) {
            if (sk.isAlly !== isAlly || !sk.isActive || !BUFF_SKILLS.has(sk.id)) continue;
            dmg += sk.damage;
            hp += sk.health;
        }
        return { dmg, hp };
    }

    private applyBuffs(scene: CombatScene, isAlly: boolean): void {
        const { dmg, hp } = this.buffTotals(isAlly);
        // Display only (CombatStatsVec.buffParts): which buff added how much of dmg.
        let parts: Record<string, number> | undefined;
        if (dmg !== 0) {
            parts = {};
            for (const sk of this.skills) {
                if (sk.isAlly !== isAlly || !sk.isActive || !BUFF_SKILLS.has(sk.id) || sk.damage === 0) continue;
                parts[sk.id] = (parts[sk.id] ?? 0) + sk.damage;
            }
        }
        for (const u of scene.units) {
            if (u.destroyed || u.isSummon || u.isAlly !== isAlly) continue;
            u.stats.dmg = u.baseDmg + dmg;
            u.stats.buffParts = parts;
            u.stats.hpMax = u.baseHpMax + hp;
            u.stats.hpMaxNoMulti = u.baseHpMaxNoMulti + hp;
            if (u.hp > u.stats.hpMax) u.hp = u.stats.hpMax; // downward clamp only
        }
    }

    // ------------------------------------------------------------------ effect builders

    private spawnEffects(scene: CombatScene, sk: SkillRuntime): void {
        if (BUFF_SKILLS.has(sk.id)) return; // buffs spawn nothing

        const fwd = sk.isAlly ? 1 : -1;
        // Entities.TryGetPlayer(isAlly) (CreateSkillEffectEntities 0x77F1900): the side's player
        // entity by id, still found while killed and not yet swept; no player, no effect.
        const player = scene.units.find((u) => !u.destroyed && u.isAlly === sk.isAlly && u.isPlayer);
        if (!player) return;
        const px = player.pos.x;
        const py = player.pos.y;
        const center = this.enemyCenter(scene, sk.isAlly, px, py, fwd);
        // The two constant pairs, as each builder passes them (JITTER_A first, then JITTER_B).
        const rA = () => this.rand.next(JITTER_A[0], JITTER_A[1]);
        const rB = () => this.rand.next(JITTER_B[0], JITTER_B[1]);

        /** The skill's damage snapshot: Dmg only, everything else neutral (no crit ever). */
        const stats = (dmg: number) => ({ ...defaultStats(), dmg });
        const perHit = sk.damage / skillDamageCount(sk.id);

        const aoe = (
            pos: Vec2,
            radius: number,
            dmg: number,
            opts: Partial<{ vel: Vec2; duration: number; pulse: number; pulseTimer: number; timer: number; finalPulse: boolean; hasPulse: boolean; ownerId: number }>
        ) =>
            scene.addAreaProjectile({
                pos: { ...pos },
                vel: opts.vel ?? { x: 0, y: 0 },
                radius,
                isAllied: sk.isAlly,
                ownerId: opts.ownerId ?? player.id,
                duration: opts.duration ?? 1.0,
                hasPulse: opts.hasPulse ?? false,
                pulseDuration: opts.pulse ?? 0,
                hasFinalPulse: opts.finalPulse ?? false,
                srcStats: stats(dmg),
                timer: opts.timer ?? 0,
                pulseTimer: opts.pulseTimer ?? 0,
                skillId: sk.id,
            });

        // Builders: SkillBuilder.* in build 2026_10_08_09_03 (RVAs in docs/combat-model.md).
        switch (sk.id) {
            case 'Arrows':
            case 'Shuriken': {
                // Arrows 0x77EDAB0 / Shurikens 0x77F0A90: n ballistic shots (speed 20, hit radius
                // 0.4) from playerPos + (-12*fwd, 2), round-robin over EVERY opposite unit still
                // in the entity table (summons and units killed this tick included: the filter is
                // only IsAlly != caster), aimed at Position + CenterOfMass. Per shot: r1 (pair A),
                // r2 (pair B); jitter x = (2*r1-1)*4*s, y = (2*r2-1)*2, where s = -fwd for Arrows
                // and s = +fwd for Shurikens (the two builders differ only there).
                const n = skillDamageCount(sk.id);
                const targets = scene.units.filter((u) => !u.destroyed && u.isAlly !== sk.isAlly);
                if (!targets.length) return;
                const s = sk.id === 'Arrows' ? -fwd : fwd;
                const bx = px - 12 * fwd;
                const by = py + 2;
                for (let i = 0; i < n; i++) {
                    const t = targets[i % targets.length];
                    const r1 = rA();
                    const r2 = rB();
                    const p0: Vec2 = { x: bx + (2 * r1 - 1) * 4 * s, y: by + (2 * r2 - 1) * 2 };
                    this.fireBallistic(scene, sk, player.id, p0, t, perHit, 20, q32(0.4));
                }
                return;
            }
            case 'Shout':
                // 0x77F075C: playerPos + (5*fwd, 0), r=10, Duration 3/2, pulse every Duration/8.
                aoe({ x: px + 5 * fwd, y: py }, 10, perHit, { hasPulse: true, pulse: 1.5 / 8, duration: 1.5 });
                return;
            case 'Meteorite':
                // 0x77F0308: per meteor r1 (A), r2 (B), r3 (B); pos = center + ((2r1-1)*2*fwd, 2r2-1),
                // r=5, final pulse at Duration = 1 + r3.
                for (let i = 0; i < skillDamageCount(sk.id); i++) {
                    const r1 = rA();
                    const r2 = rB();
                    const r3 = rB();
                    const pos = { x: center.x + (2 * r1 - 1) * 2 * fwd, y: center.y + (2 * r2 - 1) };
                    aoe(pos, 5, perHit, { finalPulse: true, duration: 1.0 + r3 });
                }
                return;
            case 'Stampede':
                // 0x77EFF9C: playerPos + (-15*fwd, 0), velocity (8*fwd, 0), r=3, pulse 1/4, Duration 8.
                aoe({ x: px - 15 * fwd, y: py }, 3, sk.damage, { vel: { x: 8 * fwd, y: 0 }, hasPulse: true, pulse: 0.25, duration: 8.0 });
                return;
            case 'Thorns':
                // 0x77EFD44: center, r=3, pulse 0.5, Duration 1.0, Timer starts at -0.5, both pulse kinds.
                aoe(center, 3, sk.damage, { hasPulse: true, pulse: 0.5, duration: 1.0, timer: -0.5, finalPulse: true });
                return;
            case 'Bomb':
                // 0x77EF950: center, r=4, final pulse at 1.0.
                aoe(center, 4, sk.damage, { finalPulse: true, duration: 1.0 });
                return;
            case 'Worm':
                // 0x77EFB4C: center, r=4, final pulse at Ratio(1,10).
                aoe(center, 4, sk.damage, { finalPulse: true, duration: q32(0.1) });
                return;
            case 'Lightning':
                // 0x77EF500: per bolt r1 (A), r2 (B) for the position, then r3 (B);
                // r=3, final pulse at Duration = r3 * 1/2.
                for (let i = 0; i < skillDamageCount(sk.id); i++) {
                    const r1 = rA();
                    const r2 = rB();
                    const pos = { x: center.x + (2 * r1 - 1) * 2 * fwd, y: center.y + (2 * r2 - 1) };
                    const r3 = rB();
                    aoe(pos, 3, perHit, { finalPulse: true, duration: r3 * 0.5 });
                }
                return;
            case 'RainOfArrows':
                // 0x77EF228: center, r=6, pulse 1/5, PulseTimer starts at -1, Duration 3+1,
                // damage / FloorToInt(3 / (1/5)) = 15.
                aoe(center, 6, perHit, { hasPulse: true, pulse: q32(0.2), pulseTimer: -1.0, duration: 4.0 });
                return;
            case 'StrafeRun':
                // 0x77EEFA0: center, r=3, pulse 1/4, Duration 1.0, full damage per pulse, IsAlly from
                // the skill. Unlike every other builder it never writes UnitId (+0x64), so the area's
                // attacker (AoeDamage 0x77F54EC: TryGetUnit(UnitId)) is entity 0, the ally player,
                // whichever side cast it: a reflect off a StrafeRun hit lands on that unit.
                aoe(center, 3, sk.damage, { hasPulse: true, pulse: 0.25, duration: 1.0, ownerId: 0 });
                return;
            case 'CannonBarrage':
                // 0x77EEB4C: per ball r1 (A), r2 (B), r3 (B); pos = center + ((2r1-1)*2*fwd, 2r2-1),
                // r=6, final pulse at Duration = 1 + r3/2.
                for (let i = 0; i < skillDamageCount(sk.id); i++) {
                    const r1 = rA();
                    const r2 = rB();
                    const r3 = rB();
                    const pos = { x: center.x + (2 * r1 - 1) * 2 * fwd, y: center.y + (2 * r2 - 1) };
                    aoe(pos, 6, perHit, { finalPulse: true, duration: 1.0 + q32(r3 / 2) });
                }
                return;
            case 'Drone': {
                // 0x77EE608: a real unit at playerPos + (-10*fwd, 1): radius 0.35, Hp/HpMax 1,
                // CenterOfMass (0,0), LookDirection (0,0) until its first targeting pass, not solid,
                // not targetable, timed (ActiveDuration), MoveSpeed 4, range 4, windup 10/60,
                // AttackDuration 0.5, projectile speed 30 radius 0.2 no gravity, stats =
                // CreateSkillCombatStats(Damage). Not solid and SourceSkillEntity set, so it is
                // excluded from buffs, collisions and the enemy-center average.
                const drone = scene.addUnit({
                    isAlly: sk.isAlly,
                    pos: { x: px - 10 * fwd, y: py + 1 },
                    stats: { ...defaultStats(), dmg: sk.damage, moveSpeed: 4.0, hpMax: 1, hpMaxNoMulti: 1 },
                    hp: 1,
                    radius: 0.35,
                    centerOfMass: { x: 0, y: 0 },
                    attackRange: 4.0,
                    windupTime: q32(10 / 60), // F64.Ratio(10, 60), then FD6 (floor): 166666 micro
                    attackDuration: 0.5,
                    // UnitProjectileConfig: Speed 30, Radius Ratio(2,10), no gravity, not aiming,
                    // HandOffset (0, Ratio(23,10)), WeaponOffset (0, 0): the shot leaves 2.3 above.
                    projectile: {
                        speed: 30,
                        collisionRadius: q32(0.2),
                        affectedByGravity: false,
                        isAiming: false,
                        handOffset: { x: 0, y: q32(2.3) },
                        weaponOffset: { x: 0, y: 0 },
                    },
                    isSummon: true,
                    destroyAfter: sk.activeDuration,
                    targetable: false,
                    solid: false,
                    tag: 'Drone',
                    skillId: 'Drone',
                });
                drone.lookDir = { x: 0, y: 0 };
                return;
            }
            default:
                return; // unknown skill: no effect rather than a guess
        }
    }

    /**
     * CreateSkillEffectEntities (0x77F1900): the average Position (not center of mass) of the
     * opposite non-summon units with |x - player.x| < 10, over every unit still in the entity
     * table (a unit killed this tick still counts); none in reach = playerPos + (10*fwd, 0).
     */
    private enemyCenter(scene: CombatScene, isAlly: boolean, playerX: number, playerY: number, fwd: number): Vec2 {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const u of scene.units) {
            if (u.destroyed || u.isSummon || u.isAlly === isAlly) continue;
            if (Math.abs(u.pos.x - playerX) < 10) {
                sx += u.pos.x;
                sy += u.pos.y;
                n++;
            }
        }
        if (!n) return { x: playerX + 10 * fwd, y: playerY };
        return { x: sx / n, y: sy / n };
    }

    private fireBallistic(
        scene: CombatScene,
        sk: SkillRuntime,
        ownerId: number,
        p0: Vec2,
        target: Unit,
        dmg: number,
        speed: number,
        radius: number
    ): void {
        const tx = target.pos.x + target.com.x;
        const ty = target.pos.y + target.com.y;
        const dx = tx - p0.x;
        const dy = ty - p0.y;
        // GetBallisticStartDirection 0x77EE220 / GetBallisticAngle 0x77F665C, with Gravity.Y =
        // Ratio(-981, 100) and dy' = start.y - end.y: a = Atan2(g*dx, v^2 - Sqrt(v^4 - g*(g*dx^2 +
        // 2*dy'*v^2))), direction (-Sin a, Cos a). Written with g = +9.81 and dy = end - start it is
        // the same angle; dx = 0 gives straight up or down, exactly as the game's Atan2 does.
        const g = 9.81;
        const v2 = speed * speed;
        const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
        let dirX: number;
        let dirY: number;
        if (disc < 0) {
            // Fixed64.Sqrt (0x6DCAF18) of a negative calls FixedUtil.InvalidArgument, whose default
            // handler (FixedUtil .cctor 0x712A850) throws ArgumentException. Nothing on the way up
            // catches it: SkillSystem.ActivateSkill 0x77F12F8, CombatScene.ActivateSkill 0x77E8228,
            // ActivateSkillAction.Execute 0x77E7F24, ModelUtil.RunAction 0x4793448, and on PvP
            // TryActivateSkills 0x7852318 -> Step -> RunToCompletion 0x78526A4 ->
            // StartLocalPvpBattle 0x3EB4A10 only have finally blocks that rethrow (PvP never sends
            // PvpReplayStartAction). The configs never reach it: shots start at most 16 behind the
            // caster, targets are at most 15 + 3 formation columns away (main battle 12 enemies,
            // dungeons 10, PvP 18 apart, missions carry no skills), dx <= 34, while v = 20 reaches
            // dx 34 up to a 6.2 height gap. Only a debug spawn override gets here; a straight shot
            // keeps that simulation going.
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            dirX = dx / d;
            dirY = dy / d;
        } else {
            const theta = Math.atan2(v2 - Math.sqrt(disc), g * dx);
            dirX = Math.cos(theta);
            dirY = Math.sin(theta);
        }
        scene.projectiles.push({
            id: -1 - scene.projectiles.length, // ids only need uniqueness within the list
            pos: { ...p0 },
            vel: { x: dirX * speed, y: dirY * speed },
            radius,
            speed,
            isAllied: sk.isAlly,
            gravity: true,
            ownerId,
            collidedWith: -1,
            srcStats: { ...defaultStats(), dmg },
            destroyed: false,
            skillId: sk.id,
        });
    }
}
