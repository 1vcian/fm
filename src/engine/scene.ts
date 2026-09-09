/**
 * CombatScene — one tick of Forge Master combat, faithful to the 2.9.0 binary.
 *
 * The tick order, the range check, the collision weights, the roll order and the state
 * machine all come from disassembly; sources and the few deliberate deviations are in
 * docs/combat-model.md. CombatScene is mode-agnostic: main battle, dungeons, missions and
 * PvP differ only in how units are spawned and when the loop stops, which belongs to the
 * adapters, not here.
 */
import { RandomPCG } from './rng';
import { SIM_DT_RAW, attackIncRaw } from '../utils/constants';
import {
    AreaProjectile,
    CombatEvent,
    CombatStatsVec,
    Projectile,
    Unit,
    UnitSpec,
    Vec2,
    defaultStats,
} from './types';

/** The real tick length: floor(2^32/10)/2^32 seconds. Used for all continuous integration. */
export const DT = SIM_DT_RAW / 4294967296;

const GRAVITY_Y = -9.81;
const Y_BOUND = 4;
/** Collision push weight of a unit whose target is in range (attackers are anchored). */
const ANCHOR_WEIGHT = 1000;

const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export interface SceneConfig {
    seed: bigint | number;
    /** BaseConfig.SecondsToFullyRegenerate; 1.0 in every shipped config. */
    secondsToFullyRegenerate?: number;
    /** Runs at step 2 of the tick, before movement — the SkillSystem slot. */
    skillSystem?: (scene: CombatScene) => void;
    /** Keep the full event log (visualizer); off for Monte Carlo runs. */
    keepEvents?: boolean;
}

export class CombatScene {
    readonly rng: RandomPCG;
    readonly units: Unit[] = [];
    readonly projectiles: Projectile[] = [];
    readonly areaProjectiles: AreaProjectile[] = [];
    /** Events of the current tick, always populated; `events` accumulates iff keepEvents. */
    tickEvents: CombatEvent[] = [];
    readonly events: CombatEvent[] = [];
    tickCount = 0;

    private nextId = 1;
    private readonly regenDivisor: number;
    private readonly skillSystem?: (scene: CombatScene) => void;
    private readonly keepEvents: boolean;

    constructor(cfg: SceneConfig) {
        this.rng = new RandomPCG(cfg.seed);
        this.regenDivisor = cfg.secondsToFullyRegenerate ?? 1.0;
        this.skillSystem = cfg.skillSystem;
        this.keepEvents = cfg.keepEvents ?? false;
    }

    addUnit(spec: UnitSpec): Unit {
        const unit: Unit = {
            id: this.nextId++,
            isAlly: spec.isAlly,
            isPlayer: spec.isPlayer ?? false,
            pos: { ...spec.pos },
            com: spec.centerOfMass ? { ...spec.centerOfMass } : { x: 0, y: 0.45 },
            vel: { x: 0, y: 0 },
            radius: spec.radius ?? 0.35,
            attackRange: spec.attackRange,
            windupMicro: Math.round(spec.windupTime * 1e6),
            durationMicro: Math.round(spec.attackDuration * 1e6),
            timerMicro: 0,
            state: 'idle',
            doubleAttack: false,
            sign: spec.isAlly ? 1 : -1,
            hp: spec.hp ?? spec.stats.hpMax ?? 0,
            stats: { ...defaultStats(), ...spec.stats },
            baseDmg: spec.stats.dmg ?? 0,
            baseHpMax: spec.stats.hpMax ?? 0,
            baseHpMaxNoMulti: spec.stats.hpMaxNoMulti ?? 0,
            isSummon: spec.isSummon ?? false,
            destroyTimer: spec.destroyAfter,
            projectile: spec.projectile,
            targetId: -1,
            targetInRange: false,
            lookDir: { x: spec.isAlly ? 1 : -1, y: 0 },
            solid: spec.solid ?? true,
            targetable: spec.targetable ?? true,
            killed: false,
            destroyed: false,
            tag: spec.tag,
            weaponSpriteKey: spec.weaponSpriteKey,
        };
        this.units.push(unit);
        return unit;
    }

    /** timer/pulseTimer may start NEGATIVE: that is how the game encodes start delays. */
    addAreaProjectile(
        a: Omit<AreaProjectile, 'id' | 'destroyed' | 'timer' | 'pulseTimer'> &
            Partial<Pick<AreaProjectile, 'timer' | 'pulseTimer'>>
    ): AreaProjectile {
        const area: AreaProjectile = { timer: 0, pulseTimer: 0, ...a, id: this.nextId++, destroyed: false };
        this.areaProjectiles.push(area);
        return area;
    }

    alive(isAlly: boolean): Unit[] {
        return this.units.filter((u) => u.isAlly === isAlly && !u.destroyed && !u.killed);
    }

    getUnit(id: number): Unit | undefined {
        return this.units.find((u) => u.id === id && !u.destroyed);
    }

    /** One full tick, in the binary's order (CombatScene.NextFrame, 0x7737AE4). */
    tick(): void {
        this.tickCount++;
        this.sweepDestroyed();
        this.tickEvents = [];

        this.skillSystem?.(this);

        // 3. movement decision from the PREVIOUS tick's targeting (MoveToTargetSystem).
        for (const u of this.units) {
            if (u.destroyed) continue;
            if (u.targetInRange) {
                u.vel.x = 0;
                u.vel.y = 0;
            } else {
                u.vel.x = u.lookDir.x * u.stats.moveSpeed;
                u.vel.y = u.lookDir.y * u.stats.moveSpeed;
            }
        }

        this.projectilePhysics();
        this.unitPhysics();

        // 6. attacks
        this.handleProjectileImpacts();
        this.handleAreaProjectiles();
        this.handleUnits();

        this.sweepDestroyed();
    }

    // ------------------------------------------------------------------ physics

    private projectilePhysics(): void {
        for (const p of this.projectiles) {
            if (p.destroyed) continue;
            if (p.gravity) p.vel.y += GRAVITY_Y * DT;
            p.pos.x += p.vel.x * DT;
            p.pos.y += p.vel.y * DT;

            for (const u of this.units) {
                if (u.destroyed || !u.targetable || u.isAlly === p.isAllied) continue;
                const cx = u.pos.x + u.com.x;
                const cy = u.pos.y + u.com.y;
                const dx = p.pos.x - cx;
                const dy = p.pos.y - cy;
                const d = len(dx, dy);
                const hitR = p.radius + u.radius;
                if (d < hitR) {
                    if (p.collidedWith < 0) p.collidedWith = u.id; // first hit wins
                    continue;
                }
                // Swept test so a fast projectile cannot tunnel through a body in one tick
                // (0x77427C4): segment from rel to rel + v'·dt vs the combined radius.
                if (p.speed * DT > d) {
                    const vy = p.gravity ? p.vel.y + GRAVITY_Y * DT : p.vel.y;
                    const nx = dx + p.vel.x * DT;
                    const ny = dy + vy * DT;
                    const cross = dx * ny - dy * nx;
                    const seg2 = (dx - nx) * (dx - nx) + (dy - ny) * (dy - ny);
                    if (cross * cross <= hitR * hitR * seg2 && p.collidedWith < 0) {
                        p.collidedWith = u.id;
                    }
                }
            }
        }
    }

    private unitPhysics(): void {
        for (const u of this.units) {
            if (u.destroyed) continue;
            u.pos.x += u.vel.x * DT;
            u.pos.y += u.vel.y * DT;
        }
        // Pairwise separation (HandleUnitPhysics, 0x7742FAC): attackers anchored 1000:1,
        // walkers pushed; queueing and lane-fanning emerge from this rule alone.
        for (let i = 0; i < this.units.length; i++) {
            const a = this.units[i];
            if (a.destroyed || !a.solid) continue;
            for (let j = i + 1; j < this.units.length; j++) {
                const b = this.units[j];
                if (b.destroyed || !b.solid) continue;
                const dx = a.pos.x + a.com.x - (b.pos.x + b.com.x);
                const dy = a.pos.y + a.com.y - (b.pos.y + b.com.y);
                const d = len(dx, dy);
                const rr = a.radius + b.radius;
                if (d >= rr || d === 0) continue;
                const ux = dx / d;
                const uy = dy / d;
                const wa = a.targetInRange ? ANCHOR_WEIGHT : 1;
                const wb = b.targetInRange ? ANCHOR_WEIGHT : 1;
                const ov = rr - d;
                a.pos.x += ux * ov * (wb / (wa + wb));
                a.pos.y += uy * ov * (wb / (wa + wb));
                b.pos.x -= ux * ov * (wa / (wa + wb));
                b.pos.y -= uy * ov * (wa / (wa + wb));
                a.pos.y = Math.max(-Y_BOUND, Math.min(Y_BOUND, a.pos.y));
                b.pos.y = Math.max(-Y_BOUND, Math.min(Y_BOUND, b.pos.y));
                if (!a.targetInRange && b.targetInRange) {
                    a.vel.x = 0;
                    a.vel.y = 0;
                }
            }
        }
    }

    // ------------------------------------------------------------------ attacks

    private handleProjectileImpacts(): void {
        for (const p of this.projectiles) {
            if (p.destroyed || p.collidedWith < 0) continue;
            p.destroyed = true;
            const target = this.getUnit(p.collidedWith);
            // The shooter may be dead by impact time: lifesteal/reflect-back silently skip.
            const attacker = this.getUnit(p.ownerId) ?? null;
            if (target) this.applyDmg(target, attacker, p.srcStats);
        }
    }

    private handleAreaProjectiles(): void {
        for (const a of this.areaProjectiles) {
            if (a.destroyed) continue;
            a.pos.x += a.vel.x * DT;
            a.pos.y += a.vel.y * DT;
            a.timer += DT;
            if (a.hasPulse) {
                a.pulseTimer += DT;
                if (a.pulseTimer > a.pulseDuration) {
                    a.pulseTimer = 0;
                    this.aoeDamage(a);
                }
            }
            if (a.timer > a.duration) {
                if (a.hasFinalPulse) this.aoeDamage(a);
                a.destroyed = true;
            }
        }
    }

    private aoeDamage(a: AreaProjectile): void {
        const owner = this.getUnit(a.ownerId) ?? null;
        // Unit CENTER inside the radius; the unit's own radius is NOT added (0x77410DC).
        for (const u of [...this.units]) {
            if (u.destroyed || !u.targetable || u.isAlly === a.isAllied) continue;
            const d = len(u.pos.x + u.com.x - a.pos.x, u.pos.y + u.com.y - a.pos.y);
            if (d < a.radius) this.applyDmg(u, owner, a.srcStats);
        }
    }

    private handleUnits(): void {
        for (const u of this.units) {
            if (u.destroyed) continue;

            // Timed entities (skill summons) burn down and vanish before acting.
            if (u.destroyTimer !== undefined) {
                u.destroyTimer -= DT;
                if (u.destroyTimer <= 0) {
                    u.destroyed = true;
                    continue;
                }
            }

            // Targeting: nearest opposite center, re-chosen every tick, no memory.
            let best: Unit | null = null;
            let bestDist = Infinity;
            const myCx = u.pos.x + u.com.x;
            const myCy = u.pos.y + u.com.y;
            for (const t of this.units) {
                if (t.destroyed || !t.targetable || t.id === u.id || t.isAlly === u.isAlly) continue;
                const d = len(t.pos.x + t.com.x - myCx, t.pos.y + t.com.y - myCy);
                if (d < bestDist) {
                    bestDist = d;
                    best = t;
                }
            }
            if (best) {
                const tx = best.pos.x + best.com.x;
                const ty = best.pos.y + best.com.y;
                u.targetId = best.id;
                u.lookDir = { x: (tx - myCx) / bestDist, y: (ty - myCy) / bestDist };
                u.targetInRange = bestDist < u.radius + u.attackRange + best.radius; // strict <
                u.sign = myCx < tx ? 1 : -1;
            } else {
                u.targetId = -1;
                u.sign = u.isAlly ? 1 : -1;
                u.lookDir = { x: u.sign, y: 0 };
                u.targetInRange = false;
            }

            // Regen: every living unit, every tick, combat state irrelevant (0x773FF48).
            if (u.stats.healthRegen > 0 && u.hp > 0) {
                u.hp = Math.min(
                    u.hp + (u.stats.healthRegen * u.stats.hpMaxNoMulti * DT) / this.regenDivisor,
                    u.stats.hpMax
                );
            }

            // The single-timer state machine (0x773FFCC).
            const inc = attackIncRaw(u.stats.attackSpeedMulti);
            if (u.state === 'idle') {
                if (u.targetInRange) u.state = 'windingUp'; // no increment this tick
            } else if (u.state === 'windingUp') {
                u.timerMicro += inc;
                if (u.timerMicro >= u.windupMicro && u.targetInRange) {
                    this.executeAttack(u);
                    u.state = 'onCooldown';
                    // Double-attack roll: ALWAYS consumed, even when it cannot proc.
                    const proc = this.rng.rollLE(u.stats.doubleDamageChance);
                    if (!u.doubleAttack && proc) {
                        u.timerMicro = Math.floor(u.windupMicro * 0.75); // DoubleAttackSpeedUp = 4
                        u.doubleAttack = true;
                        u.state = 'windingUp';
                    }
                } else if (!u.targetInRange) {
                    u.state = 'idle';
                    u.timerMicro = 0;
                    u.doubleAttack = false;
                }
            } else {
                u.timerMicro += inc;
                if (u.timerMicro >= u.durationMicro) {
                    u.state = 'idle';
                    u.timerMicro = 0;
                    u.doubleAttack = false;
                }
            }
        }
    }

    private executeAttack(u: Unit): void {
        const target = this.getUnit(u.targetId);
        if (!target) return;
        const snapshot = { ...u.stats };
        if (!u.projectile) {
            this.applyDmg(target, u, snapshot);
            return;
        }
        // Ranged: spawn an unguided projectile at the attacker's center (see fidelity note 5).
        const px = u.pos.x + u.com.x;
        const py = u.pos.y + u.com.y;
        const tx = target.pos.x + target.com.x;
        const ty = target.pos.y + target.com.y;
        const d = len(tx - px, ty - py);
        // Point-blank: already overlapping the target -> instant, no projectile (0x7741A58).
        if (d < u.projectile.collisionRadius + target.radius) {
            this.applyDmg(target, u, snapshot);
            return;
        }
        let dirX: number;
        let dirY: number;
        if (u.projectile.affectedByGravity) {
            const aim = ballisticDirection(tx - px, ty - py, u.projectile.speed);
            dirX = aim.x;
            dirY = aim.y;
        } else {
            dirX = (tx - px) / d;
            dirY = (ty - py) / d;
        }
        this.projectiles.push({
            id: this.nextId++,
            pos: { x: px, y: py },
            vel: { x: dirX * u.projectile.speed, y: dirY * u.projectile.speed },
            radius: u.projectile.collisionRadius,
            speed: u.projectile.speed,
            isAllied: u.isAlly,
            gravity: u.projectile.affectedByGravity,
            ownerId: u.id,
            collidedWith: -1,
            srcStats: snapshot,
            destroyed: false,
        });
    }

    /** GetDamage + ApplyDmg (0x7740C34 / 0x77405E4). Roll order: dodge, block, reflect, crit. */
    applyDmg(target: Unit, attacker: Unit | null, stats: CombatStatsVec): void {
        const dodged = this.rng.rollLE(target.stats.dodgeChance);
        if (dodged) {
            this.emit({ targetId: target.id, attackerId: attacker?.id ?? -1, dmg: 0, dodged: true });
            return;
        }
        const blocked = this.rng.rollLE(target.stats.blockChance);
        const reflected = this.rng.rollLE(target.stats.reflectChance);
        const critical = this.rng.rollLT(stats.criticalChance);
        const dmg = critical ? stats.dmg * stats.criticalMulti : stats.dmg;
        this.emit({ targetId: target.id, attackerId: attacker?.id ?? -1, dmg, blocked, critical, reflected });

        if (!blocked) {
            target.hp -= dmg;
            if (target.hp <= 0) this.kill(target);
            if (attacker && stats.lifeSteal > 0) {
                const heal = dmg * stats.lifeSteal;
                attacker.hp = Math.min(attacker.hp + heal, attacker.stats.hpMax);
                this.emit({ targetId: attacker.id, attackerId: attacker.id, dmg: heal, heal: true });
            }
        }
        // Reflect: full rolled damage back, even on a blocked hit. Direct subtraction —
        // no re-roll, no chain, no lifesteal — but it can kill the attacker.
        if (reflected && attacker) {
            attacker.hp -= dmg;
            if (attacker.hp <= 0) this.kill(attacker);
            this.emit({ targetId: attacker.id, attackerId: target.id, dmg });
        }
    }

    private kill(u: Unit): void {
        if (u.killed) return;
        u.killed = true;
        u.targetable = false;
    }

    private emit(e: Partial<CombatEvent> & { targetId: number; attackerId: number; dmg: number }): void {
        const ev: CombatEvent = {
            tick: this.tickCount,
            dodged: false,
            blocked: false,
            critical: false,
            reflected: false,
            heal: false,
            ...e,
        };
        this.tickEvents.push(ev);
        if (this.keepEvents) this.events.push(ev);
    }

    private sweepDestroyed(): void {
        // Killed units survive until the next sweep (they were removed at the START of the
        // next frame in the game too), which is why kill() only clears targetable.
        for (const u of this.units) if (u.killed) u.destroyed = true;
        for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].destroyed) this.units.splice(i, 1);
        for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].destroyed) this.projectiles.splice(i, 1);
        for (let i = this.areaProjectiles.length - 1; i >= 0; i--) if (this.areaProjectiles[i].destroyed) this.areaProjectiles.splice(i, 1);
    }
}

/**
 * Ballistic launch direction (GetBallisticAngle, 0x7742030) for gravity projectiles:
 * the low-arc solution; unreachable targets fall back to straight-line aim.
 */
function ballisticDirection(dx: number, dy: number, speed: number): Vec2 {
    const g = -GRAVITY_Y; // 9.81, positive
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
    if (disc < 0 || dx === 0) {
        const d = len(dx, dy) || 1;
        return { x: dx / d, y: dy / d };
    }
    // atan2 with g*dx as the second argument carries dx's sign into the quadrant, so
    // cos(theta) already points toward the target; the binary's explicit negate is its own
    // sign convention for the same result.
    const theta = Math.atan2(v2 - Math.sqrt(disc), g * dx);
    return { x: Math.cos(theta), y: Math.sin(theta) };
}
