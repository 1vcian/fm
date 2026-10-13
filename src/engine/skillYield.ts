/**
 * Skill yield: how much of a damage skill's Damage one static target actually receives per cast.
 *
 * The answer is not the library's hit count: Rain of Arrows divides its damage by 15 but only
 * pulses 10 times in its 4 s life (pulse every 3 ticks from a -1 s start), the Drone flies in from
 * 10 units behind the player before its first shot and fires on its own windup/duration timer,
 * Stampede sweeps through the target for as many pulses as its phase allows, and so on. Rather
 * than re-deriving each builder's constants here, the yield is MEASURED by running the engine's
 * own builders (SkillManager.spawnEffects, CombatScene) against one dummy: a deterministic mini
 * battle, memoized per (skill, active duration, distance). Skill damage never crits and carries no
 * lifesteal, and the dummy has no dodge/block, so the result is a pure geometry/timing factor.
 */
import { CombatScene } from './scene';
import { SkillManager, skillCycleTicks, skillFirstCastTick } from './skills';

/** Casts averaged per measurement: samples the skills' PseudoRandom jitter sequence. */
const CASTS = 20;
/** Unit radius the scene gives player and dummy (CombatScene.addUnit default). */
const UNIT_RADIUS = 0.35;

const cache = new Map<string, number>();

/**
 * Damage one static enemy receives per cast, as a multiple of the skill's Damage, with the
 * enemy standing where a player with `playerAttackRange` stops: just inside its weapon range.
 */
export function skillYieldPerCast(id: string, activeDurationSeconds: number, playerAttackRange: number): number {
    const distance = 2 * UNIT_RADIUS + Math.max(0, playerAttackRange) - 1e-3;
    const key = `${id}|${activeDurationSeconds}|${distance.toFixed(3)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const mgr = new SkillManager();
    const scene = new CombatScene({ seed: 1, skillSystem: (s) => mgr.execute(s) });
    scene.addUnit({
        isAlly: true, isPlayer: true, pos: { x: 0, y: 0 }, radius: UNIT_RADIUS,
        stats: { hpMax: 1, hpMaxNoMulti: 1, dmg: 0, moveSpeed: 0 },
        attackRange: -1e9, windupTime: 0.5, attackDuration: 1.5,
    });
    const dummy = scene.addUnit({
        isAlly: false, pos: { x: distance, y: 0 }, radius: UNIT_RADIUS,
        stats: { hpMax: 1e18, hpMaxNoMulti: 1e18, dmg: 0, moveSpeed: 0 },
        attackRange: -1e9, windupTime: 0.5, attackDuration: 1.5,
    });
    // A short cooldown: casts overlap freely, damage is linear in the casts.
    const cooldown = 1;
    mgr.addSkill({ id, slot: 0, isAlly: true, damage: 1, health: 0, cooldown, activeDuration: activeDurationSeconds });

    const lastCast = skillFirstCastTick() + (CASTS - 1) * skillCycleTicks(cooldown, activeDurationSeconds);
    // Every builder's effect is over well within a minute of its cast.
    const ticks = lastCast + Math.round(activeDurationSeconds * 10) + 600;
    let casts = 0;
    let dealt = 0;
    for (let t = 0; t < ticks; t++) {
        scene.tick();
        for (const e of scene.tickEvents) {
            if (e.targetId === dummy.id && e.source === 'skill' && e.skillId === id && !e.dodged && !e.blocked) dealt += e.dmg;
        }
        if (casts < CASTS && mgr.snapshot()[0].state === 'ready') {
            mgr.tryAutoActivate(scene, true);
            casts++;
        }
    }
    const yieldPerCast = casts ? dealt / casts : 0;
    cache.set(key, yieldPerCast);
    return yieldPerCast;
}
