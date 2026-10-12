/**
 * What the battle visualizer draws of a scene beyond the units: skill areas, every projectile,
 * the skill summons, the active buffs and the recent hits. Shared by the main-battle/mission
 * engine and the PvP engine so both show skills the same way. Display only: nothing here feeds
 * back into the combat.
 */
import type { CombatScene } from './scene';
import type { SkillManager } from './skills';
import type { CombatEvent } from './types';

/** How long a hit stays on screen (seconds of battle time). */
export const HIT_VISIBLE_SECONDS = 0.9;

export interface VisualEffect {
    id: number;
    skillId: string;
    x: number;
    y: number;
    radius: number;
    vx: number;
    isAllied: boolean;
    /** Seconds since spawn (may start negative: a start delay) and the moment of the final pulse. */
    timer: number;
    duration: number;
    hasPulse: boolean;
    hasFinalPulse: boolean;
    pulseDuration: number;
    /** Battle seconds since the last damage pulse; null before the first. */
    sincePulse: number | null;
}

export interface VisualShot {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    isAllied: boolean;
    /** Skill that fired it (Arrows, Shuriken, Drone); undefined = a weapon shot. */
    skillId?: string;
}

export interface VisualHit {
    key: number;
    /** Battle seconds since it landed. */
    age: number;
    x: number;
    y: number;
    amount: number;
    kind: 'hit' | 'crit' | 'block' | 'dodge' | 'heal' | 'reflect';
    source: NonNullable<CombatEvent['source']> | 'unknown';
    skillId?: string;
    /** Landed on the ally side (Player 1 / the player). */
    onAlly: boolean;
}

export interface VisualBuff {
    skillId: string;
    damage: number;
    health: number;
    secondsLeft: number;
    phaseSeconds: number;
}

export interface VisualSummon {
    id: number;
    skillId: string;
    x: number;
    y: number;
    isAlly: boolean;
    attacking: boolean;
    secondsLeft: number | null;
}

export interface SceneVisuals {
    effects: VisualEffect[];
    shots: VisualShot[];
    hits: VisualHit[];
    summons: VisualSummon[];
    buffs: { ally: VisualBuff[]; enemy: VisualBuff[] };
}

export function sceneVisuals(scene: CombatScene, skills: SkillManager): SceneVisuals {
    const now = scene.tickCount;
    const effects: VisualEffect[] = scene.areaProjectiles
        .filter(a => !a.destroyed)
        .map(a => ({
            id: a.id,
            skillId: a.skillId ?? 'Skill',
            x: a.pos.x,
            y: a.pos.y,
            radius: a.radius,
            vx: a.vel.x,
            isAllied: a.isAllied,
            timer: a.timer,
            duration: a.duration,
            hasPulse: a.hasPulse,
            hasFinalPulse: a.hasFinalPulse,
            pulseDuration: a.pulseDuration,
            sincePulse: a.lastPulseTick != null ? (now - a.lastPulseTick) / 10 : null,
        }));
    const shots: VisualShot[] = scene.projectiles
        .filter(p => !p.destroyed)
        .map(p => ({ id: p.id, x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, isAllied: p.isAllied, skillId: p.skillId }));

    // Side of each event's target: a unit may be gone, so fall back on the attacker's side.
    const sideOf = new Map(scene.units.map(u => [u.id, u.isAlly]));
    const hits: VisualHit[] = [];
    const cutoff = now - Math.ceil(HIT_VISIBLE_SECONDS * 10);
    const ev = scene.events;
    for (let i = ev.length - 1; i >= 0 && ev[i].tick > cutoff; i--) {
        const e = ev[i];
        if (e.x == null || e.y == null) continue;
        const kind: VisualHit['kind'] = e.heal ? 'heal' : e.dodged ? 'dodge' : e.blocked ? 'block'
            : e.source === 'reflect' ? 'reflect' : e.critical ? 'crit' : 'hit';
        const targetAlly = sideOf.get(e.targetId) ?? (sideOf.has(e.attackerId) ? !sideOf.get(e.attackerId) : false);
        hits.push({
            key: i,
            age: (now - e.tick) / 10,
            x: e.x,
            y: e.y,
            amount: e.dmg,
            kind,
            source: e.source ?? 'unknown',
            skillId: e.skillId,
            onAlly: targetAlly,
        });
    }

    const summons: VisualSummon[] = scene.units
        .filter(u => u.isSummon && !u.destroyed)
        .map(u => ({
            id: u.id,
            skillId: u.skillId ?? u.tag ?? 'Drone',
            x: u.pos.x,
            y: u.pos.y,
            isAlly: u.isAlly,
            attacking: u.state !== 'idle',
            secondsLeft: u.destroyTimer ?? null,
        }));

    const snap = skills.snapshot();
    const buffsOf = (isAlly: boolean): VisualBuff[] => snap
        .filter(s => s.isAlly === isAlly && s.isBuff && s.state === 'active')
        .map(s => ({ skillId: s.id, damage: s.damage, health: s.health, secondsLeft: s.secondsLeft, phaseSeconds: s.phaseSeconds }));

    return { effects, shots, hits, summons, buffs: { ally: buffsOf(true), enemy: buffsOf(false) } };
}

/** "Meteorite 12.3k on P2" style log line for one event. */
export function describeEvent(e: CombatEvent, who: (id: number) => string, fmt: (n: number) => string): { event: string; details: string } {
    const by = e.source === 'skill' ? e.skillId ?? 'Skill'
        : e.source === 'buff' ? e.skillId ?? 'Buff'
        : e.source === 'reflect' ? 'Reflect'
        : e.source === 'lifesteal' ? 'Lifesteal'
        : e.source === 'ranged' ? 'Shot' : e.source === 'melee' ? 'Swing' : 'Hit';
    const event = e.heal ? 'Heal' : e.dodged ? 'Dodge' : e.blocked ? 'Block' : e.critical ? 'Crit' : 'Hit';
    const amount = e.dodged ? 'miss' : e.blocked ? `${fmt(e.dmg)} blocked` : fmt(e.dmg);
    return { event, details: `${by}: ${amount} ${e.heal ? 'to' : 'on'} ${who(e.targetId)}${e.reflected && !e.heal && e.source !== 'reflect' ? ' (reflected)' : ''}` };
}
