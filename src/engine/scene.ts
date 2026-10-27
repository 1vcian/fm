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
import { SIM_DT_RAW, attackIncRaw, fd6MicroFromF64 } from '../utils/constants';
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

/** What produced a hit, for the event log and the visualizer. Never affects the combat. */
export type HitOrigin = Pick<CombatEvent, 'source' | 'skillId'>;

/** The real tick length: floor(2^32/10)/2^32 seconds. Used for all continuous integration. */
export const DT = SIM_DT_RAW / 4294967296;

const GRAVITY_Y = -9.81;
const Y_BOUND = 4;
/** Collision push weight of a unit whose target is in range (attackers are anchored). */
const ANCHOR_WEIGHT = 1000;

const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

export { fd6MicroFromF64 };

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

    /**
     * Entities._entityId (+0x10): one counter shared by AddUnit, AddProjectile and
     * AddSkillMetaEntity, never initialised by the Entities ctor (0x77ECD00), so the first
     * entity of a scene is id 0. Every mode adds its player first (MainBattleModel.SetupBattle,
     * the dungeon SetupBattles, MissionCombatScene.SetupPlayers before SetupEnemies,
     * PvpCombatScene.Init with the ally first), so id 0 is the ally player.
     */
    private nextId = 0;
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
            unitOffset: spec.unitOffset ? { ...spec.unitOffset } : { x: 0, y: 0 },
            vel: { x: 0, y: 0 },
            radius: spec.radius ?? 0.35,
            attackRange: spec.attackRange,
            windupMicro: fd6MicroFromF64(spec.windupTime),
            durationMicro: fd6MicroFromF64(spec.attackDuration),
            timerMicro: 0,
            state: 'idle',
            doubleAttack: false,
            attackCount: 0,
            nthAttackInterval: spec.nthAttackInterval ?? 0,
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
            // CreateUnit (0x77EA044) never writes LookDirection: it is (0, 0) until the unit's first
            // targeting pass, so a unit stands still on the frame it spawns (MoveToTarget runs first).
            lookDir: { x: 0, y: 0 },
            solid: spec.solid ?? true,
            targetable: spec.targetable ?? true,
            killed: false,
            destroyed: false,
            tag: spec.tag,
            weaponSpriteKey: spec.weaponSpriteKey,
            cosmeticKeys: spec.cosmeticKeys,
            skillId: spec.skillId,
            testDummy: spec.testDummy,
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
        // No sweep here: the game removes killed/destroyed entities only at the START of the next
        // NextFrame (0x77EC06C), so a unit killed this tick is still in the table for the PvP skill
        // activations that follow the tick (enemy center, Arrows/Shurikens target list).
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

    /**
     * HandleUnitPhysics (0x77F759C, build 2026_10_08_09_03). For each unit A in table order:
     * integrate A (pos += vel*dt), then resolve A against EVERY other unit B (full inner loop,
     * so each pair is visited from both sides, and B may or may not have moved yet this tick):
     *   overlap when |(A.pos+A.com) - (B.pos+B.com)| < A.r + B.r, and only if both are solid;
     *   push along the normal with weights 1000:1 for a unit whose target is in range
     *   (A moves by wB/(wA+wB) of the overlap, B by wA/(wA+wB)), clamp both Y to [-4, 4],
     *   and zero A's velocity when A is not attacking but B is.
     * Integration and resolution are interleaved; that order is what produces the melee queue.
     */
    private unitPhysics(): void {
        const units = this.units;
        for (let i = 0; i < units.length; i++) {
            const a = units[i];
            if (a.destroyed) continue;
            a.pos.x += a.vel.x * DT;
            a.pos.y += a.vel.y * DT;
            for (let j = 0; j < units.length; j++) {
                const b = units[j];
                if (j === i || b.destroyed) continue;
                const dx = a.pos.x + a.com.x - (b.pos.x + b.com.x);
                const dy = a.pos.y + a.com.y - (b.pos.y + b.com.y);
                const d = len(dx, dy);
                const rr = a.radius + b.radius;
                if (!(d < rr) || !a.solid || !b.solid || d === 0) continue;
                const ux = dx / d;
                const uy = dy / d;
                const wa = a.targetInRange ? ANCHOR_WEIGHT : 1;
                const wb = b.targetInRange ? ANCHOR_WEIGHT : 1;
                const ov = rr - d;
                const fa = (wb / (wa + wb)) * ov;
                const fb = (wa / (wa + wb)) * ov;
                a.pos.x += ux * fa;
                a.pos.y += uy * fa;
                b.pos.x -= ux * fb;
                b.pos.y -= uy * fb;
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
            if (target) this.applyDmg(target, attacker, p.srcStats, p.skillId ? { source: 'skill', skillId: p.skillId } : { source: 'ranged' });
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
        a.lastPulseTick = this.tickCount;
        // Unit CENTER inside the radius; the unit's own radius is NOT added (0x77410DC).
        for (const u of [...this.units]) {
            if (u.destroyed || !u.targetable || u.isAlly === a.isAllied) continue;
            const d = len(u.pos.x + u.com.x - a.pos.x, u.pos.y + u.com.y - a.pos.y);
            if (d < a.radius) this.applyDmg(u, owner, a.srcStats, { source: 'skill', skillId: a.skillId });
        }
    }

    private handleUnits(): void {
        for (const u of this.units) {
            if (u.destroyed) continue;

            // Timed entities (skill summons) burn down and vanish before acting.
            // DestroyTimer is FD6 and loses FD6(dt) = 0.099999 per tick (HandleUnits 0x77F3F50).
            if (u.destroyTimer !== undefined) {
                u.destroyTimer = (Math.round(u.destroyTimer * 1e6) - 99999) / 1e6;
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

            // Regen (HandleUnits 0x77F4534, build 2026_10_08_09_03): unconditional, for every unit
            // not Destroyed, killed ones included and with no regen check:
            // Hp = Min(Hp + HealthRegen * HpMaxNoMulti * (dt / SecondsToFullyRegenerate), HpMax).
            // A unit killed earlier in this tick therefore still regenerates on its own turn.
            u.hp = Math.min(
                u.hp + (u.stats.healthRegen * u.stats.hpMaxNoMulti * DT) / this.regenDivisor,
                u.stats.hpMax
            );

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
        // Nth attack (ExecuteAttack 0x782FC90, build 2026_10_27_09_45): AttackCount += 1, then when
        // NthAttackInterval >= 1 and AttackCount % NthAttackInterval == 0 this attack's stats copy
        // carries Dmg x (1 + NthAttackDamageMulti). The copy feeds both the melee ApplyDmg and the
        // projectile, so ranged shots get it too.
        u.attackCount++;
        if (u.nthAttackInterval >= 1 && u.attackCount % u.nthAttackInterval === 0 && snapshot.nthAttackDamageMulti) {
            const f = 1 + snapshot.nthAttackDamageMulti;
            snapshot.dmg *= f;
            if (snapshot.buffParts) {
                const parts: Record<string, number> = {};
                for (const k in snapshot.buffParts) parts[k] = snapshot.buffParts[k] * f;
                snapshot.buffParts = parts;
            }
        }
        const origin: HitOrigin = u.skillId ? { source: 'skill', skillId: u.skillId } : { source: u.projectile ? 'ranged' : 'melee' };
        if (!u.projectile) {
            this.applyDmg(target, u, snapshot, origin);
            return;
        }
        // Ranged (ExecuteAttack 0x77F58C8, build 2026_10_08_09_03). The muzzle, with s = Sign and
        // H = HandOffset + UnitOffSet, W = WeaponOffset, both scaled component-wise by (s, 1):
        //   not aiming: start = Position + (H + W) * (s, 1)
        //   aiming:     d0 = Normalize(myCenter - targetCenter)          (sic: from the target)
        //               start1 = Position + H' + s * Rotate(W', d0)
        //               d1 = aim direction from start1 (ballistic or straight)
        //               start = Position + H' + s * Rotate(W', d1)
        // with Rotate(w, d) = (w.x*d.x - w.y*d.y, w.x*d.y + w.y*d.x). The shot then leaves `start`
        // aimed at the target's center. If start is closer to the target's center than to the
        // shooter's own center (squared lengths, strict <), the hit is applied at once instead.
        const cfg = u.projectile;
        const s = u.sign;
        const mcx = u.pos.x + u.com.x;
        const mcy = u.pos.y + u.com.y;
        const tx = target.pos.x + target.com.x;
        const ty = target.pos.y + target.com.y;
        const hx = ((cfg.handOffset?.x ?? 0) + u.unitOffset.x) * s;
        const hy = (cfg.handOffset?.y ?? 0) + u.unitOffset.y;
        const wx = (cfg.weaponOffset?.x ?? 0) * s;
        const wy = cfg.weaponOffset?.y ?? 0;
        const aimFrom = (ox: number, oy: number): Vec2 => {
            if (cfg.affectedByGravity) return ballisticDirection(tx - ox, ty - oy, cfg.speed);
            const dl = len(tx - ox, ty - oy);
            return dl > 0 ? { x: (tx - ox) / dl, y: (ty - oy) / dl } : { x: 0, y: 0 };
        };
        let px: number;
        let py: number;
        if (cfg.isAiming) {
            const d0l = len(mcx - tx, mcy - ty);
            const d0 = d0l > 0 ? { x: (mcx - tx) / d0l, y: (mcy - ty) / d0l } : { x: 0, y: 0 };
            const p1x = u.pos.x + hx + s * (wx * d0.x - wy * d0.y);
            const p1y = u.pos.y + hy + s * (wx * d0.y + wy * d0.x);
            const d1 = aimFrom(p1x, p1y);
            px = u.pos.x + hx + s * (wx * d1.x - wy * d1.y);
            py = u.pos.y + hy + s * (wx * d1.y + wy * d1.x);
        } else {
            px = u.pos.x + hx + wx;
            py = u.pos.y + hy + wy;
        }
        const toTarget2 = (px - tx) * (px - tx) + (py - ty) * (py - ty);
        const toSelf2 = (px - mcx) * (px - mcx) + (py - mcy) * (py - mcy);
        if (toTarget2 < toSelf2) {
            this.applyDmg(target, u, snapshot, origin);
            return;
        }
        const dir = aimFrom(px, py);
        const dirX = dir.x;
        const dirY = dir.y;
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
            skillId: u.skillId,
        });
    }

    /**
     * GetDamage + ApplyDmg (0x782F53C / 0x782EED0, build 2026_10_27_09_45). Rolls, in order:
     * dodge (a dodge stops here), block, reflect, crit. The reflect roll is ALWAYS consumed but
     * only counts on a hit that was not blocked (`tbz w22` skips the compare and stores false).
     */
    applyDmg(target: Unit, attacker: Unit | null, stats: CombatStatsVec, origin: HitOrigin = {}): void {
        const at = (u: Unit) => ({ x: u.pos.x + u.com.x, y: u.pos.y + u.com.y });
        const dodged = this.rng.rollLE(target.stats.dodgeChance);
        if (dodged) {
            this.emit({ targetId: target.id, attackerId: attacker?.id ?? -1, dmg: 0, dodged: true, ...origin, ...at(target) });
            return;
        }
        const blocked = this.rng.rollLE(target.stats.blockChance);
        const reflectRoll = this.rng.rollLE(target.stats.reflectChance);
        const reflected = !blocked && reflectRoll;
        const critical = this.rng.rollLT(stats.criticalChance);
        // A crit on a target with CriticalDamageReduction (GetDamage 0x782F53C, 2026_10_27_09_45):
        // (Dmg x CriticalMulti) x (1 - Min(Max(reduction, 0), 1)). No extra roll.
        const critKeep = critical ? 1 - Math.min(Math.max(target.stats.criticalDamageReduction || 0, 0), 1) : 1;
        let dmg = critical ? stats.dmg * stats.criticalMulti * critKeep : stats.dmg;
        // Simulator-only test dummy: a fixed share of the target's HpMax, floored (see UnitSpec).
        const td = attacker?.testDummy;
        if (td) dmg = Math.max(0, Math.min(td.hitFraction * target.stats.hpMax, target.hp - td.floorFraction * target.stats.hpMax));
        let buffDmg: Record<string, number> | undefined;
        if (stats.buffParts) {
            buffDmg = {};
            for (const k in stats.buffParts) buffDmg[k] = critical ? stats.buffParts[k] * stats.criticalMulti * critKeep : stats.buffParts[k];
        }
        this.emit({ targetId: target.id, attackerId: attacker?.id ?? -1, dmg, blocked, critical, reflected, buffDmg, ...origin, ...at(target) });

        if (!blocked) {
            target.hp -= dmg;
            if (target.hp <= 0) this.kill(target);
            if (attacker && stats.lifeSteal > 0) {
                const heal = dmg * stats.lifeSteal;
                attacker.hp = Math.min(attacker.hp + heal, attacker.stats.hpMax);
                this.emit({ targetId: attacker.id, attackerId: attacker.id, dmg: heal, heal: true, source: 'lifesteal', ...at(attacker) });
            }
        }
        // Reflect: the full rolled damage back (never on a blocked hit, see above). Direct
        // subtraction: no re-roll, no chain, no lifesteal, but it can kill the attacker.
        if (reflected && attacker) {
            attacker.hp -= dmg;
            if (attacker.hp <= 0) this.kill(attacker);
            this.emit({ targetId: attacker.id, attackerId: target.id, dmg, source: 'reflect', ...at(attacker) });
        }
    }

    /**
     * ApplyDmg (0x77F4BD0) on Hp <= 0: IsKilled = true and the unit joins EntitiesToDestroy.
     * IsTargetable is NOT cleared and nothing in the tick reads IsKilled, so for the rest of the
     * tick the dead unit still acts, can still be targeted, hit by areas and reflect damage.
     */
    private kill(u: Unit): void {
        if (u.killed) return;
        u.killed = true;
    }

    /** Display-only: tags the event with what produced the hit; never read by the combat. */
    emit(e: Partial<CombatEvent> & { targetId: number; attackerId: number; dmg: number }): void {
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
        // Killed units survive until this sweep at the START of the next frame, as in the game.
        for (const u of this.units) if (u.killed) u.destroyed = true;
        for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].destroyed) this.units.splice(i, 1);
        for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].destroyed) this.projectiles.splice(i, 1);
        for (let i = this.areaProjectiles.length - 1; i >= 0; i--) if (this.areaProjectiles[i].destroyed) this.areaProjectiles.splice(i, 1);
    }
}

/**
 * Ballistic launch direction for gravity projectiles: ExecuteAttack calls the same
 * GetBallisticStartDirection (0x77EE220 -> GetBallisticAngle 0x77F665C) as the Arrows and
 * Shuriken skills, the low-arc solution with no special case, so dx = 0 aims straight up or
 * down. A negative discriminant makes the game's Fixed64.Sqrt throw, and no handler on the
 * combat path catches it (see SkillManager.fireBallistic); weapon ranges in the config
 * (AttackRange <= 7 vs v^2/g >= 22.9) never get there, the straight aim only keeps a debug
 * spawn override running.
 */
function ballisticDirection(dx: number, dy: number, speed: number): Vec2 {
    const g = -GRAVITY_Y; // 9.81, positive
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
    if (disc < 0) {
        const d = len(dx, dy) || 1;
        return { x: dx / d, y: dy / d };
    }
    // atan2 with g*dx as the second argument carries dx's sign into the quadrant, so
    // cos(theta) already points toward the target; the binary's explicit negate is its own
    // sign convention for the same result.
    const theta = Math.atan2(v2 - Math.sqrt(disc), g * dx);
    return { x: Math.cos(theta), y: Math.sin(theta) };
}
