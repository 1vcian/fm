/**
 * Core combat types, mirroring the game's CombatStats / UnitEntity / Projectile
 * (dump.cs:774691 / :774835, build 2026_09_02_09_08). See docs/combat-model.md.
 */

export interface Vec2 {
    x: number;
    y: number;
}

/**
 * The game's CombatStats, one field per combat stat. Fractions are plain numbers
 * (0.35 = 35%), multipliers are absolute (attackSpeedMulti 1.75 = +75%).
 *
 * criticalMulti is used AS-IS by the crit roll (dmg * criticalMulti): the game's stat
 * defaults to 1.0 and gear raises it. It is NOT "1 + bonus" here — the caller that maps
 * AggregatedStats (which stores 1 + base 1.2 + bonuses) must hand over the game-shaped value.
 */
export interface CombatStatsVec {
    hpMax: number;
    /** Regen scales on this; PvP multiplies hpMax but not this. */
    hpMaxNoMulti: number;
    dmg: number;
    moveSpeed: number;
    criticalChance: number;
    criticalMulti: number;
    blockChance: number;
    /** Always 0 for players and main-battle enemies in 2.9.0, but the pipeline rolls it. */
    dodgeChance: number;
    healthRegen: number;
    lifeSteal: number;
    doubleDamageChance: number;
    attackSpeedMulti: number;
    reflectChance: number;
    /**
     * Display only, never read by the combat: the part of `dmg` each active buff skill adds
     * (SkillManager.applyBuffs), so a weapon hit's damage can be attributed to its sources.
     */
    buffParts?: Record<string, number>;
}

export function defaultStats(): CombatStatsVec {
    // CombatStats.Create (0x773EE44): everything 0 except the two neutral multipliers.
    return {
        hpMax: 0,
        hpMaxNoMulti: 0,
        dmg: 0,
        moveSpeed: 2.0, // UnitConstants.DefaultMovespeed
        criticalChance: 0,
        criticalMulti: 1.0,
        blockChance: 0,
        dodgeChance: 0,
        healthRegen: 0,
        lifeSteal: 0,
        doubleDamageChance: 0,
        attackSpeedMulti: 1.0,
        reflectChance: 0,
    };
}

export type CombatState = 'idle' | 'windingUp' | 'onCooldown';

/**
 * UnitProjectileConfig (SetUnitWeapon 0x77E8D10): ProjectilesLibrary Speed / CollisionRadius /
 * AffectedByGravity plus the weapon row's IsAiming, Hand and Offset, which place the muzzle
 * (AttacksSystem.ExecuteAttack 0x77F58C8). Offsets default to (0, 0), aiming to false.
 */
export interface ProjectileConfig {
    speed: number;
    collisionRadius: number;
    affectedByGravity: boolean;
    isAiming?: boolean;
    handOffset?: Vec2;
    weaponOffset?: Vec2;
}

export interface UnitSpec {
    isAlly: boolean;
    isPlayer?: boolean;
    pos: Vec2;
    stats: Partial<CombatStatsVec>;
    /** Current HP; defaults to hpMax. */
    hp?: number;
    /** World units. Weapon AttackRange, already stat-scaled by the caller when applicable. */
    attackRange: number;
    /** Seconds. WeaponInfo.WindupTime / AttackDuration, never stat-modified. */
    windupTime: number;
    attackDuration: number;
    /** Absent = melee (instant ApplyDmg on fire). */
    projectile?: ProjectileConfig;
    radius?: number; // default 0.35; guild war 0.5; mounts ColliderRadius
    centerOfMass?: Vec2; // default (0, 0.45)
    /** UnitOffSet: MountLibrary.UnitOffset in main battles and dungeons (UpdateMount), else (0, 0). Moves the muzzle only. */
    unitOffset?: Vec2;
    /** Display-only passthrough for the visualizer (sprites, names). */
    tag?: string;
    weaponSpriteKey?: string;
    /** Display only: helmet / armour item keys ("age_type_idx") a mission enemy rolled. No combat effect. */
    cosmeticKeys?: { helmet?: string; armour?: string };
    /** Display only: the skill that created this unit (Drone), carried onto its shots and hits. */
    skillId?: string;
    /** Skill summons (Drone): excluded from buffs and from enemy-center math. */
    isSummon?: boolean;
    /** Seconds until self-destruction (Drone's ActiveDuration). */
    destroyAfter?: number;
    /** Drone is neither: it cannot be hit nor block movement. Default true. */
    targetable?: boolean;
    solid?: boolean;
    /**
     * Simulator-only test dummy (no game counterpart): each hit takes hitFraction of the target's
     * HpMax but never brings it below floorFraction of HpMax, so regen and lifesteal stay visible.
     */
    testDummy?: { hitFraction: number; floorFraction: number };
}

export interface Unit {
    id: number;
    isAlly: boolean;
    isPlayer: boolean;
    pos: Vec2;
    com: Vec2;
    unitOffset: Vec2;
    vel: Vec2;
    radius: number;
    attackRange: number;
    /** FD6 micro-units: exact, they carry the verified attack breakpoints. */
    windupMicro: number;
    durationMicro: number;
    timerMicro: number;
    state: CombatState;
    doubleAttack: boolean;
    sign: 1 | -1;
    hp: number;
    stats: CombatStatsVec;
    /** Buffs rewrite stats.dmg/hpMax/hpMaxNoMulti from these every tick (Base vs Value). */
    baseDmg: number;
    baseHpMax: number;
    baseHpMaxNoMulti: number;
    isSummon: boolean;
    destroyTimer?: number;
    projectile?: ProjectileConfig;
    targetId: number;
    targetInRange: boolean;
    lookDir: Vec2;
    solid: boolean;
    targetable: boolean;
    killed: boolean;
    destroyed: boolean;
    tag?: string;
    weaponSpriteKey?: string;
    cosmeticKeys?: { helmet?: string; armour?: string };
    skillId?: string;
    testDummy?: { hitFraction: number; floorFraction: number };
}

export interface Projectile {
    id: number;
    pos: Vec2;
    vel: Vec2;
    radius: number;
    speed: number;
    isAllied: boolean;
    gravity: boolean;
    ownerId: number;
    /** First unit crossed; -1 while in flight. Unguided: not necessarily the fired-at unit. */
    collidedWith: number;
    /** Stats snapshot at fire time — the game copies the whole CombatStats into the shot. */
    srcStats: CombatStatsVec;
    destroyed: boolean;
    /** Display only: the skill that fired it (Arrows, Shuriken, a Drone's shot); none = weapon. */
    skillId?: string;
}

export interface AreaProjectile {
    id: number;
    pos: Vec2;
    vel: Vec2;
    /** AoE radius; hits units whose CENTER is inside (unit radius NOT added). */
    radius: number;
    isAllied: boolean;
    ownerId: number;
    timer: number;
    duration: number;
    hasPulse: boolean;
    pulseDuration: number;
    pulseTimer: number;
    hasFinalPulse: boolean;
    srcStats: CombatStatsVec;
    destroyed: boolean;
    /** Display only: the skill that spawned it, and the tick of its last damage pulse. */
    skillId?: string;
    lastPulseTick?: number;
}

/** One CombatDmg event, same flags as the game's struct. Heal events reuse dmg as amount. */
export interface CombatEvent {
    tick: number;
    targetId: number;
    attackerId: number;
    dmg: number;
    dodged: boolean;
    blocked: boolean;
    critical: boolean;
    reflected: boolean;
    heal: boolean;
    /**
     * Display only. What dealt it: the weapon (melee/ranged), a skill (skillId set), a reflect,
     * or lifesteal (heal). x/y: where the target stood (Position + CenterOfMass) when it landed.
     */
    source?: 'melee' | 'ranged' | 'skill' | 'reflect' | 'lifesteal' | 'buff';
    skillId?: string;
    /** Display only: the part of `dmg` added by each active buff skill (crit applied). */
    buffDmg?: Record<string, number>;
    x?: number;
    y?: number;
}
