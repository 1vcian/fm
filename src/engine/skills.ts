/**
 * Skills — charge, activation, effects and buffs, from the 2.9.0 binary.
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
 *  - Skill jitter uses an UNSEEDED counter LCG shared by both sides: the same sequence every
 *    battle. Reproduced verbatim.
 */
import { CombatScene, DT } from './scene';
import { Unit, Vec2, defaultStats } from './types';

/** FD6(dt): the truncated per-tick decrement of every skill timer (micro-units). */
const FD6_DT_MICRO = 99999;
/** The hardcoded initial charge (AddOrUpdateSkill, F64 raw 0x400000000 = 4.0 s). */
const INITIAL_CHARGE_MICRO = 4_000_000;

const BUFF_SKILLS = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);

/** GetSkillDamageCount (0x773E37C): how many pieces the skill's damage is split into. */
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
 * PseudoRandom (0x773EA90): an unseeded counter LCG, offset starting at 0 every battle, so
 * skill jitter is the same sequence in every battle, shared by both sides in call order.
 */
export class PseudoRandom {
    private offset = 0;
    next(): number {
        this.offset++;
        const v = (Math.imul(this.offset, 1103515245) + 12345) & 0x7fffffff;
        return (v % 10000) / 10000;
    }
}

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
    snapshot(): { id: string; isAlly: boolean; state: 'ready' | 'active' | 'cooldown'; secondsLeft: number }[] {
        return this.skills.map((sk) => ({
            id: sk.id,
            isAlly: sk.isAlly,
            state: sk.isActive ? 'active' : sk.isOnCooldown ? 'cooldown' : 'ready',
            secondsLeft: Math.max(0, sk.timerMicro) / 1e6,
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
                u.hp = Math.min(u.hp + sk.health, u.stats.hpMax);
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
        for (const u of scene.units) {
            if (u.destroyed || u.isSummon || u.isAlly !== isAlly) continue;
            u.stats.dmg = u.baseDmg + dmg;
            u.stats.hpMax = u.baseHpMax + hp;
            u.stats.hpMaxNoMulti = u.baseHpMaxNoMulti + hp;
            if (u.hp > u.stats.hpMax) u.hp = u.stats.hpMax; // downward clamp only
        }
    }

    // ------------------------------------------------------------------ effect builders

    private spawnEffects(scene: CombatScene, sk: SkillRuntime): void {
        if (BUFF_SKILLS.has(sk.id)) return; // buffs spawn nothing

        const fwd = sk.isAlly ? 1 : -1;
        const player =
            scene.units.find((u) => !u.destroyed && u.isAlly === sk.isAlly && u.isPlayer) ??
            scene.units.find((u) => !u.destroyed && u.isAlly === sk.isAlly && !u.isSummon);
        if (!player) return;
        const px = player.pos.x;
        const py = player.pos.y;
        const center = this.enemyCenter(scene, sk.isAlly, px, fwd);
        const r = () => this.rand.next();

        /** The skill's damage snapshot: Dmg only, everything else neutral (no crit ever). */
        const stats = (dmg: number) => ({ ...defaultStats(), dmg });
        const perHit = sk.damage / skillDamageCount(sk.id);

        const aoe = (
            pos: Vec2,
            radius: number,
            dmg: number,
            opts: Partial<{ vel: Vec2; duration: number; pulse: number; pulseTimer: number; timer: number; finalPulse: boolean; hasPulse: boolean }>
        ) =>
            scene.addAreaProjectile({
                pos: { ...pos },
                vel: opts.vel ?? { x: 0, y: 0 },
                radius,
                isAllied: sk.isAlly,
                ownerId: player.id,
                duration: opts.duration ?? 1.0,
                hasPulse: opts.hasPulse ?? false,
                pulseDuration: opts.pulse ?? 0,
                hasFinalPulse: opts.finalPulse ?? false,
                srcStats: stats(dmg),
                timer: opts.timer ?? 0,
                pulseTimer: opts.pulseTimer ?? 0,
            });

        switch (sk.id) {
            case 'Arrows':
            case 'Shuriken': {
                // n ballistic shots from behind the caster, round-robin over enemy units.
                const n = skillDamageCount(sk.id);
                const targets = scene.units.filter((u) => !u.destroyed && u.targetable && u.isAlly !== sk.isAlly);
                if (!targets.length) return;
                for (let i = 0; i < n; i++) {
                    const t = targets[i % targets.length];
                    const p0: Vec2 = {
                        x: px - 12 * fwd + (2 * r() - 1) * 4 * fwd,
                        y: py + 2 + (2 * r() - 1) * 2,
                    };
                    this.fireBallistic(scene, sk, player.id, p0, t, perHit, 20, 0.4);
                }
                return;
            }
            case 'Shout':
                aoe({ x: px + 5 * fwd, y: 0 }, 10, perHit, { hasPulse: true, pulse: 1.5 / 8, duration: 1.5 });
                return;
            case 'Meteorite':
                for (let i = 0; i < 5; i++) {
                    const pos = { x: center.x + 2 * fwd * (2 * r() - 1), y: center.y + (2 * r() - 1) };
                    aoe(pos, 5, perHit, { finalPulse: true, duration: 1.0 + r() });
                }
                return;
            case 'Stampede':
                aoe({ x: px - 15 * fwd, y: 0 }, 3, sk.damage, { vel: { x: 8 * fwd, y: 0 }, hasPulse: true, pulse: 0.25, duration: 8.0 });
                return;
            case 'Thorns':
                aoe(center, 3, sk.damage, { hasPulse: true, pulse: 0.5, duration: 1.0, timer: -0.5, finalPulse: true });
                return;
            case 'Bomb':
                aoe(center, 4, sk.damage, { finalPulse: true, duration: 1.0 });
                return;
            case 'Worm':
                aoe(center, 4, sk.damage, { finalPulse: true, duration: 0.1 });
                return;
            case 'Lightning':
                for (let i = 0; i < 5; i++) {
                    const pos = { x: center.x + (2 * r() - 1) * 2 * fwd, y: center.y + (2 * r() - 1) };
                    aoe(pos, 3, perHit, { finalPulse: true, duration: 0.5 * r() });
                }
                return;
            case 'RainOfArrows':
                aoe(center, 6, perHit, { hasPulse: true, pulse: 0.2, pulseTimer: -1.0, duration: 4.0 });
                return;
            case 'StrafeRun':
                aoe(center, 3, sk.damage, { hasPulse: true, pulse: 0.25, duration: 1.0 });
                return;
            case 'CannonBarrage':
                for (let i = 0; i < 3; i++) {
                    const pos = { x: center.x + (2 * r() - 1) * 2 * fwd, y: center.y + (2 * r() - 1) };
                    aoe(pos, 6, perHit, { finalPulse: true, duration: 1.0 + r() / 2 });
                }
                return;
            case 'Drone':
                // A real summoned unit: untargetable, unsolid, excluded from buffs, ~2 shots/s.
                scene.addUnit({
                    isAlly: sk.isAlly,
                    pos: { x: px - 10 * fwd, y: py + 1 },
                    stats: { ...defaultStats(), dmg: sk.damage, moveSpeed: 4.0 },
                    hp: 0,
                    attackRange: 4.0,
                    windupTime: 1 / 6,
                    attackDuration: 0.5,
                    projectile: { speed: 30, collisionRadius: 0.2, affectedByGravity: false },
                    isSummon: true,
                    destroyAfter: sk.activeDuration,
                    targetable: false,
                    solid: false,
                    tag: 'Drone',
                });
                return;
            default:
                return; // unknown skill: no effect rather than a guess
        }
    }

    /** Average POSITION of nearby opposite non-summon units; fallback 10 ahead (0x7741A38). */
    private enemyCenter(scene: CombatScene, isAlly: boolean, playerX: number, fwd: number): Vec2 {
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
        if (!n) return { x: playerX + 10 * fwd, y: 0 };
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
        const g = 9.81;
        const v2 = speed * speed;
        const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
        let dirX: number;
        let dirY: number;
        if (disc < 0 || dx === 0) {
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
        });
    }
}
