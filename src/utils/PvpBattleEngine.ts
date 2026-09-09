/**
 * PVP Battle Engine
 * 
 * Specialized battle engine for player vs player (PVP) simulations.
 * Uses the same logic as BattleEngine but with two players instead of player vs enemies.
 */

import type { WeaponInfo } from './BattleHelper';
import { SKILL_MECHANICS } from './constants';
import { StatEngine } from './statEngine';
import { PetSlot, MountSlot, UserProfile } from '../types/Profile';
import {
    CombatScene,
    PvpLoadout,
    PvpSetup,
    SkillManager,
    Unit,
    setupPvp,
} from '../engine';

// --- Shared Helpers ---

const getAscMulti = (category: string, level: number, target: string = 'Damage', ascensionConfigsLibrary: any = null) => {
    let multi = 0;
    if (level > 0 && ascensionConfigsLibrary?.[category]?.AscensionConfigPerLevel) {
        const configs = ascensionConfigsLibrary[category].AscensionConfigPerLevel;
        for (let i = 0; i < level && i < configs.length; i++) {
            const contributions = configs[i].StatContributions || [];
            for (const s of contributions) {
                const sType = s.StatNode?.UniqueStat?.StatType;
                const sTarget = s.StatNode?.StatTarget?.$type;
                if (sType === target) {
                    if (category === 'Skills') {
                        const isActive = sTarget === 'ActiveSkillStatTarget';
                        if (target === 'Damage' && isActive) multi += s.Value;
                        if (target === 'Health' && isActive) multi += s.Value;
                    } else {
                        multi += s.Value;
                    }
                }
            }
        }
    }
    return multi;
};

// --- Types ---

export type PassiveStatType = string;

export interface EnemySkillConfig {
    id: string;
    rarity: string;
    damage?: number;
    health?: number;
    cooldown: number;
    duration: number;
    hasDamage: boolean;
    hasHealth: boolean;
    level?: number;
    ascensionLevel?: number;
}

export interface PassiveStatConfig {
    enabled: boolean;
    value: number;
}

export interface SkinEntry {
    dmg: number;  // e.g. 0.05 = +5%
    hp: number;   // e.g. 0.05 = +5%
}

export interface EnemyConfig {
    weapon: any | null;
    weaponId?: number;
    skills: (EnemySkillConfig | null)[];
    stats: {
        power?: number;
        hp: number;
        damage: number;
        skinDmgMulti?: number;
        skinHpMulti?: number;
        setDmgMulti?: number;
        setHpMulti?: number;
        projectileSpeed?: number;
        attackRange?: number;
        weaponWindup?: number;
        weaponAttackDuration?: number;
    };
    skillPassiveHp?: number;
    skinEntries?: SkinEntry[];
    hasCompleteSet?: boolean;
    passiveStats: Record<string, PassiveStatConfig>;
    name: string;
    level?: number;
    pets: (PetSlot | null)[];
    mount: MountSlot | null;
    forgeAscensionLevel?: number;
    skillAscensionLevel?: number;
    mountAscensionLevel?: number;
    petAscensionLevel?: number;
}

export const initPassiveStats = (keys: string[] = []): Record<string, PassiveStatConfig> => {
    const stats: Record<string, PassiveStatConfig> = {};
    keys.forEach(key => {
        stats[key] = { enabled: false, value: 0 };
    });
    return stats;
};

export interface PvpPlayerStats {
    hp: number;
    damage: number;
    attackSpeed: number;
    weaponInfo?: WeaponInfo;
    isRanged?: boolean;
    projectileSpeed?: number;
    critChance: number;
    critMulti: number;
    blockChance: number;
    reflectChance?: number;
    lifesteal: number;
    doubleDamage: number;
    healthRegen: number;
    damageMulti: number;
    healthMulti: number;
    skillDamageMulti: number;
    skillCooldownMulti: number;
    skills: PvpSkillConfig[];
    /**
     * The game-shaped inputs for the REAL PvP HP rule (see docs/combat-model.md): one shared
     * multiplier = max(m(p1), m(p2)) with m = base + 0.5*pets + 0.5*skills + 2*mount, applied
     * to baseHealth. `hp` above is the legacy per-component chain, kept for display compat.
     */
    baseHealth?: number;
    petCount?: number;
    skillCount?: number;
    hasMount?: boolean;
    matchTimerSeconds?: number;
    pvpHp?: { base: number; pet: number; skill: number; mount: number };
}

export interface PvpSkillConfig {
    id: string;
    damage?: number;
    health?: number;
    cooldown: number;
    duration: number;
    hasDamage: boolean;
    hasHealth: boolean;
    count: number;
    damageIsPerHit: boolean;
}

export interface SkillState {
    id: string;
    activeDuration: number;
    cooldown: number;
    state: 'Startup' | 'Ready' | 'Active' | 'Cooldown';
    timer: number;
    damage?: number;
    healAmount?: number;
    isBuff?: boolean;
    bonusDamage?: number;
    bonusMaxHealth?: number;
    count?: number;
    interval?: number;
    delay?: number;
    isSingleTarget?: boolean;
    isAOE?: boolean;
}

export interface ActiveSkillEffect {
    id: string;
    damage?: number;
    healAmount?: number;
    count: number;
    hitsRemaining: number;
    interval: number;
    timer: number;
    isSingleTarget?: boolean;
    isAOE?: boolean;
}

export interface ActiveBuff {
    skillId: string;
    bonusDamage: number;
    bonusMaxHealth: number;
}

export interface EntityState {
    id: number;
    isPlayer1: boolean;
    health: number;
    maxHealth: number;
    damage: number;
    shield: number;
    attackSpeed: number;
    baseWindupTime: number;
    attackDuration: number;
    windupTimer: number;
    recoveryTimer: number;
    isWindingUp: boolean;
    combatPhase: 'IDLE' | 'CHARGING' | 'RECOVERING';
    pendingDoubleHit: boolean;
    isRanged: boolean;
    projectileSpeed?: number;
    attackRange: number;
    position: number;
    combatState: 'MOVING' | 'FIGHTING';
    isDead: boolean;
    critChance: number;
    critMulti: number;
    blockChance: number;
    lifesteal: number;
    doubleDamage: number;
    healthRegen: number;
    initialHealth: number;
    currentRegenRate: number;
    regenSnapshotTimer: number;
}

export interface Projectile {
    id: number;
    fromX: number;
    toX: number;
    currentX: number;
    speed: number;
    isPlayer1Source: boolean;
    damage: number;
    targetId: number;
    isCrit: boolean;
}

export interface BattleLogEntry {
    time: number;
    event: string;
    details: string;
}

export interface PvpBattleResult {
    winner: 'player1' | 'player2' | 'tie';
    player1Hp: number;
    player1MaxHp: number;
    player1HpPercent: number;
    player2Hp: number;
    player2MaxHp: number;
    player2HpPercent: number;
    time: number;
    timeout: boolean;
}

const PVP_TIME_LIMIT = 60.0;
const SKILL_STARTUP_TIME = 5;
const TIME_STEP = 1 / 60;
const SECONDS_TO_FULLY_REGENERATE = 1.0;
const PLAYER_SPEED = 2;

const BUFF_SKILLS = ["Meat", "Morale", "Berserk", "Buff", "HigherMorale"];

/**
 * PvpBattleEngine — now a shim over the shared engine (src/engine). Same constructor, same
 * tick/getSnapshot/simulate surface for PvpBattleVisualizer, but the battle itself is the one
 * tick-accurate CombatScene used everywhere else, with the REAL PvP HP rule.
 */
export class PvpBattleEngine {
    public time: number = 0;
    private readonly scene: CombatScene;
    private readonly mgr: SkillManager;
    private readonly setup: PvpSetup;
    private readonly maxTicks: number;
    private acc = 0;
    private finished = false;

    constructor(p1: PvpPlayerStats, p2: PvpPlayerStats, seed?: number) {
        this.mgr = new SkillManager();
        this.scene = new CombatScene({
            seed: seed ?? Math.floor(Math.random() * 2 ** 31),
            keepEvents: true,
            skillSystem: (sc) => this.mgr.execute(sc),
        });
        const hpCfg = {
            PvpHpBaseMultiplier: p1.pvpHp?.base ?? 1.0,
            PvpHpPetMultiplier: p1.pvpHp?.pet ?? 0.5,
            PvpHpSkillMultiplier: p1.pvpHp?.skill ?? 0.5,
            PvpHpMountMultiplier: p1.pvpHp?.mount ?? 2.0,
            PvpMatchTimerSeconds: p1.matchTimerSeconds ?? PVP_TIME_LIMIT,
        };
        this.setup = setupPvp(toLoadout(p1), toLoadout(p2), hpCfg, this.scene);
        this.maxTicks = this.setup.maxTicks;
        addPvpSkills(this.mgr, p1, true);
        addPvpSkills(this.mgr, p2, false);
    }

    /** One engine step = 0.1 s; fractional dt from the render loop is accumulated. */
    public tick(dt: number): void {
        this.acc += dt;
        while (this.acc >= 0.1 - 1e-9) {
            this.acc -= 0.1;
            this.step();
        }
    }

    private step(): void {
        if (this.finished || this.scene.tickCount >= this.maxTicks) {
            this.finished = true;
            return;
        }
        this.scene.tick();
        this.mgr.tryAutoActivate(this.scene, true);
        this.mgr.tryAutoActivate(this.scene, false);
        this.time = this.scene.tickCount / 10;
        if (this.setup.ally.killed || this.setup.enemy.killed || this.time >= (this.setup.maxTicks - 100) / 10) {
            this.finished = true;
        }
    }

    public simulate(): PvpBattleResult {
        while (!this.finished) this.step();
        const a = this.setup.ally;
        const b = this.setup.enemy;
        const aliveA = !a.killed;
        const aliveB = !b.killed;
        const timeout = aliveA && aliveB;
        let winner: PvpBattleResult['winner'];
        if (!aliveA && !aliveB) winner = 'tie';
        else if (!aliveB) winner = 'player1';
        else if (!aliveA) winner = 'player2';
        else {
            // Timeout: the higher Hp/HpMax FRACTION wins (0x7798128).
            const fa = a.hp / a.stats.hpMax;
            const fb = b.hp / b.stats.hpMax;
            winner = fa > fb ? 'player1' : fb > fa ? 'player2' : 'tie';
        }
        return {
            winner,
            player1Hp: Math.max(0, a.hp),
            player1MaxHp: a.stats.hpMax,
            player1HpPercent: Math.max(0, a.hp) / a.stats.hpMax,
            player2Hp: Math.max(0, b.hp),
            player2MaxHp: b.stats.hpMax,
            player2HpPercent: Math.max(0, b.hp) / b.stats.hpMax,
            time: this.time,
            timeout,
        };
    }

    public getSnapshot() {
        const ent = (u: Unit, isPlayer1: boolean): EntityState => ({
            id: u.id,
            isPlayer1,
            health: Math.max(0, u.hp),
            maxHealth: u.stats.hpMax,
            damage: u.stats.dmg,
            shield: 0,
            attackSpeed: u.stats.attackSpeedMulti,
            baseWindupTime: u.windupMicro / 1e6,
            attackDuration: u.durationMicro / 1e6,
            windupTimer: u.timerMicro / 1e6,
            recoveryTimer: 0,
            isWindingUp: u.state === 'windingUp',
            combatPhase: u.state === 'windingUp' ? 'CHARGING' : u.state === 'onCooldown' ? 'RECOVERING' : 'IDLE',
            pendingDoubleHit: u.doubleAttack,
            isRanged: !!u.projectile,
            projectileSpeed: u.projectile?.speed,
            attackRange: u.attackRange,
            position: u.pos.x,
            combatState: u.targetInRange ? 'FIGHTING' : 'MOVING',
            isDead: u.killed,
            critChance: u.stats.criticalChance,
            critMulti: u.stats.criticalMulti,
            blockChance: u.stats.blockChance,
            lifesteal: u.stats.lifeSteal,
            doubleDamage: u.stats.doubleDamageChance,
            healthRegen: u.stats.healthRegen,
            initialHealth: u.baseHpMax,
            currentRegenRate: u.stats.healthRegen * u.stats.hpMaxNoMulti,
            regenSnapshotTimer: 0,
        });
        const skillStates = (isAlly: boolean): SkillState[] =>
            this.mgr
                .snapshot()
                .filter((sk) => sk.isAlly === isAlly)
                .map((sk) => ({
                    id: sk.id,
                    activeDuration: 0,
                    cooldown: 0,
                    state: sk.state === 'ready' ? 'Ready' : sk.state === 'active' ? 'Active' : 'Cooldown',
                    timer: sk.secondsLeft,
                }));
        const buffs = (isAlly: boolean): ActiveBuff[] =>
            this.mgr
                .snapshot()
                .filter((sk) => sk.isAlly === isAlly && sk.state === 'active' && BUFF_IDS.has(sk.id))
                .map((sk) => ({ skillId: sk.id, bonusDamage: 0, bonusMaxHealth: 0 }));
        return {
            time: this.time,
            player1: ent(this.setup.ally, true),
            player2: ent(this.setup.enemy, false),
            player1Skills: skillStates(true),
            player2Skills: skillStates(false),
            player1ActiveEffects: [] as ActiveSkillEffect[],
            player2ActiveEffects: [] as ActiveSkillEffect[],
            player1ActiveBuffs: buffs(true),
            player2ActiveBuffs: buffs(false),
            projectiles: this.scene.projectiles
                .filter((pr) => !pr.destroyed)
                .map((pr) => ({
                    id: pr.id,
                    fromX: pr.pos.x,
                    toX: pr.pos.x + Math.sign(pr.vel.x),
                    currentX: pr.pos.x,
                    speed: pr.speed,
                    isPlayer1Source: pr.isAllied,
                    damage: pr.srcStats.dmg,
                    targetId: -1,
                    isCrit: false,
                })),
            logs: this.scene.events.slice(-80).map((e) => ({
                time: e.tick / 10,
                event: e.heal ? 'heal' : e.dodged ? 'dodge' : e.blocked ? 'block' : e.critical ? 'crit' : 'hit',
                details: `${Math.round(e.dmg).toLocaleString()} on #${e.targetId}`,
            })) as BattleLogEntry[],
        };
    }
}

const BUFF_IDS = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);

function toLoadout(p: PvpPlayerStats): PvpLoadout {
    const isRanged = p.weaponInfo ? (p.weaponInfo.AttackRange ?? 0) > 1.0 : !!p.isRanged;
    return {
        health: p.baseHealth ?? p.hp,
        stats: {
            dmg: p.damage,
            moveSpeed: 2.0,
            criticalChance: p.critChance,
            criticalMulti: p.critMulti,
            blockChance: p.blockChance,
            dodgeChance: 0,
            healthRegen: p.healthRegen,
            lifeSteal: p.lifesteal,
            doubleDamageChance: p.doubleDamage,
            attackSpeedMulti: p.attackSpeed,
            reflectChance: p.reflectChance ?? 0,
        },
        attackRange: p.weaponInfo?.AttackRange ?? 0.3,
        windupTime: p.weaponInfo?.WindupTime ?? 0.5,
        attackDuration: p.weaponInfo?.AttackDuration ?? 1.5,
        projectile: isRanged
            ? { speed: p.projectileSpeed || 15, collisionRadius: 0.2, affectedByGravity: false }
            : undefined,
        petCount: p.petCount ?? 0,
        skillCount: p.skillCount ?? p.skills.length,
        hasMount: p.hasMount ?? false,
    };
}

function addPvpSkills(mgr: SkillManager, p: PvpPlayerStats, isAlly: boolean): void {
    p.skills.forEach((sk, slot) => {
        if (!sk) return;
        mgr.addSkill({
            id: sk.id,
            slot,
            isAlly,
            damage: sk.damage ?? 0,
            health: sk.health ?? 0,
            // The CDR stat scales only the cooldown length; the old engine dropped it.
            cooldown: Math.max(0.5, sk.cooldown * (1 - (p.skillCooldownMulti || 0))),
            activeDuration: sk.duration ?? 0,
        });
    });
}

export function simulatePvpBattleMulti(player1Stats: PvpPlayerStats, player2Stats: PvpPlayerStats, runs: number = 1000) {
    const results: PvpBattleResult[] = [];
    let p1Wins = 0,
        p2Wins = 0,
        ties = 0,
        totalTime = 0,
        timeouts = 0;
    // Seeded runs: the same matchup always gives the same rates.
    for (let i = 1; i <= runs; i++) {
        const engine = new PvpBattleEngine(player1Stats, player2Stats, i);
        const result = engine.simulate();
        results.push(result);
        if (result.winner === 'player1') p1Wins++;
        else if (result.winner === 'player2') p2Wins++;
        else ties++;
        totalTime += result.time;
        if (result.timeout) timeouts++;
    }
    return {
        player1WinRate: (p1Wins / runs) * 100,
        player2WinRate: (p2Wins / runs) * 100,
        tieRate: (ties / runs) * 100,
        avgTime: totalTime / runs,
        timeoutRate: (timeouts / runs) * 100,
        results,
    };
}

export function enemyConfigToPvpStats(
    enemyConfig: any, weaponLibrary?: any, pvpBaseConfig?: any,
    _mountUpgradeLibrary?: any, petLibrary?: any, petBalancingLibrary?: any,
    _ascensionConfigsLibrary?: any
): PvpPlayerStats {
    let weaponInfo: WeaponInfo | undefined;
    if (enemyConfig.weaponId && weaponLibrary) {
        weaponInfo = Object.values(weaponLibrary).find((w: any) => w.ItemId?.Idx === enemyConfig.weaponId) as WeaponInfo;
    } else if (enemyConfig.weapon && weaponLibrary) {
        const key = `{'Age': ${enemyConfig.weapon.age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.weapon.idx}}`;
        weaponInfo = weaponLibrary[key];
    }

    const passives = enemyConfig.passiveStats || {};
    let attackSpeedBonus = passives.AttackSpeed?.enabled ? passives.AttackSpeed.value / 100 : 0;
    let critChance = passives.CriticalChance?.enabled ? passives.CriticalChance.value / 100 : 0;
    let critMulti = passives.CriticalMulti?.enabled ? 1 + (passives.CriticalMulti.value / 100) : 1.5;
    let blockChance = passives.BlockChance?.enabled ? passives.BlockChance.value / 100 : 0;
    let lifesteal = passives.LifeSteal?.enabled ? passives.LifeSteal.value / 100 : 0;
    let doubleDamage = passives.DoubleDamageChance?.enabled ? passives.DoubleDamageChance.value / 100 : 0;
    let healthRegen = passives.HealthRegen?.enabled ? passives.HealthRegen.value / 100 : 0;
    let damageMulti = passives.DamageMulti?.enabled ? passives.DamageMulti.value / 100 : 0;
    let healthMulti = passives.HealthMulti?.enabled ? passives.HealthMulti.value / 100 : 0;
    let skillDamageMulti = passives.SkillDamageMulti?.enabled ? passives.SkillDamageMulti.value / 100 : 0;
    let skillCooldownMulti = passives.SkillCooldownMulti?.enabled ? passives.SkillCooldownMulti.value / 100 : 0;

    const collectSecondary = (statId: string, value: number) => {
        const val = value / 100;
        switch (statId) {
            case 'DamageMulti': damageMulti += val; break;
            case 'HealthMulti': healthMulti += val; break;
            case 'CriticalChance': critChance += val; break;
            case 'CriticalMulti': critMulti += val; break;
            case 'DoubleDamageChance': doubleDamage += val; break;
            case 'AttackSpeed': attackSpeedBonus += val; break;
            case 'LifeSteal': lifesteal += val; break;
            case 'HealthRegen': healthRegen += val; break;
            case 'BlockChance': blockChance += val; break;
            case 'SkillCooldownMulti': skillCooldownMulti += val; break;
            case 'SkillDamageMulti': skillDamageMulti += val; break;
        }
    };

    if (enemyConfig.pets) {
        enemyConfig.pets.forEach((pet: any) => {
            if (pet?.secondaryStats) pet.secondaryStats.forEach((s: any) => collectSecondary(s.statId, s.value));
        });
    }
    if (enemyConfig.mount?.secondaryStats) {
        enemyConfig.mount.secondaryStats.forEach((s: any) => collectSecondary(s.statId, s.value));
    }

    const skills: PvpSkillConfig[] = (enemyConfig.skills || [])
        .filter((s: any) => s !== null)
        .map((s: any) => {
            const mechanics = SKILL_MECHANICS[s.id] || { count: 1 };
            return {
                id: s.id, damage: s.damage, health: s.health, cooldown: s.cooldown,
                duration: s.duration, hasDamage: s.hasDamage, hasHealth: s.hasHealth,
                count: mechanics.count || 1, damageIsPerHit: mechanics.descriptionIsPerHit || false
            };
        });

    let calculatedPetHp = 0;
    if (enemyConfig.pets) {
        enemyConfig.pets.forEach((pet: any) => {
            if (pet) {
                if (pet.hp && pet.hp > 0) calculatedPetHp += pet.hp;
                else if (pet.id !== undefined && petLibrary && petBalancingLibrary) {
                    const key = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
                    const petData = petLibrary[key];
                    if (petData) {
                        const bal = petBalancingLibrary[petData.Type];
                        if (bal) {
                            const levelIdx = Math.max(0, pet.level - 1);
                            calculatedPetHp += (bal.BaseHealthPerLevel?.[levelIdx] || 0) + (bal.HealthPerRarity?.[petData.Rarity] || 0);
                        }
                    }
                }
            }
        });
    }

    const skinHpFactor = 1 + (enemyConfig.stats.skinHpMulti || 0);
    const setHpFactor = enemyConfig.hasCompleteSet ? 0.10 : (enemyConfig.stats.setHpMulti || 0);
    const globalSkinSetFactor = skinHpFactor + setHpFactor;

    // Perfect Reverse: Values provided by user (Total HP, Pet HP, etc.) are already scaled by ASC/Tech in-game.
    const petHpInGame = calculatedPetHp;
    const skillPassiveHpInGame = enemyConfig.skillPassiveHp || 0;
    const mountHpInGame = enemyConfig.mount?.hp || 0;
    const totalSystemHpInGame = petHpInGame + skillPassiveHpInGame + mountHpInGame;

    const totalHpBeforeGlobal = (enemyConfig.stats.hp || 10000) / Math.max(0.01, globalSkinSetFactor);
    let derivedEquipHpWithMulti = totalHpBeforeGlobal - totalSystemHpInGame;
    derivedEquipHpWithMulti = Math.max(0, derivedEquipHpWithMulti);

    const pvpHpBaseMulti = pvpBaseConfig?.PvpHpBaseMultiplier ?? 1.0;
    const pvpHpPetMulti = pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5;
    const pvpHpSkillMulti = pvpBaseConfig?.PvpHpSkillMultiplier ?? 0.5;
    const pvpHpMountMulti = pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0;

    const pvpEquipHp = derivedEquipHpWithMulti * pvpHpBaseMulti;
    const pvpPetHp = petHpInGame * pvpHpPetMulti;
    const pvpSkillHp = skillPassiveHpInGame * pvpHpSkillMulti;
    const pvpMountHp = mountHpInGame * pvpHpMountMulti;

    const pvpTotalHp = (pvpEquipHp + pvpPetHp + pvpSkillHp + pvpMountHp) * globalSkinSetFactor;

    return {
        hp: Math.round(Math.max(1, pvpTotalHp)), damage: enemyConfig.stats.damage,
        // The builder's HP field IS the in-game health; the engine applies the shared rule.
        baseHealth: enemyConfig.stats.hp || 10000,
        petCount: (enemyConfig.pets || []).filter(Boolean).length,
        skillCount: (enemyConfig.skills || []).filter(Boolean).length,
        hasMount: !!enemyConfig.mount,
        matchTimerSeconds: pvpBaseConfig?.PvpMatchTimerSeconds ?? 60,
        pvpHp: {
            base: pvpBaseConfig?.PvpHpBaseMultiplier ?? 1.0,
            pet: pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5,
            skill: pvpBaseConfig?.PvpHpSkillMultiplier ?? 0.5,
            mount: pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0,
        },
        attackSpeed: 1.0 + attackSpeedBonus,
        weaponInfo: weaponInfo ? {
            ...weaponInfo,
            AttackRange: enemyConfig.stats.attackRange || weaponInfo.AttackRange,
            WindupTime: enemyConfig.stats.weaponWindup || weaponInfo.WindupTime,
            AttackDuration: enemyConfig.stats.weaponAttackDuration || weaponInfo.AttackDuration,
        } : undefined,
        isRanged: weaponInfo ? (weaponInfo.AttackRange ?? 0) > 1.0 : false,
        projectileSpeed: enemyConfig.stats.projectileSpeed || 10,
        critChance, critMulti, blockChance, lifesteal, doubleDamage, healthRegen,
        damageMulti: 0, healthMulti: 0, skillDamageMulti, skillCooldownMulti, skills
    };
}

export function aggregatedStatsToPvpStats(
    stats: any, equippedSkills: any[], skillLibrary: any,
    weaponLibrary?: any, weaponSlot?: any, pvpBaseConfig?: any,
    ascensionLevels: Record<string, number> = {}, ascensionConfigsLibrary: any = null
): PvpPlayerStats {
    const skills: PvpSkillConfig[] = equippedSkills.map(skill => {
        const skillData = skillLibrary?.[skill.id];
        const levelIdx = Math.max(0, skill.level - 1);
        const baseDamage = skillData?.DamagePerLevel?.[levelIdx] || 0;
        // Verified layers: the skill common layer is the DamageMulti/HealthMulti substat
        // pools only; tech-tree generic Damage never reaches ActiveSkill.
        const dmgMulti = (1 + (stats.secondaryDamageMulti || 0)) * (stats.skillDamageMultiplier || 1);
        const hpMulti = (1 + (stats.secondaryHealthMulti || 0)) * (stats.skillHealthMultiplier || 1);
        let damage = baseDamage * dmgMulti;
        const health = (skillData?.HealthPerLevel?.[levelIdx] || 0) * hpMulti;
        const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
        if (mechanics.descriptionIsPerHit && !mechanics.damageIsPerHit) damage /= mechanics.count;
        return {
            id: skill.id, damage, health, cooldown: skillData?.Cooldown || 10,
            duration: skillData?.ActiveDuration || 0, hasDamage: baseDamage > 0,
            hasHealth: (skillData?.HealthPerLevel?.[levelIdx] || 0) > 0,
            count: mechanics.count || 1, damageIsPerHit: !!mechanics.descriptionIsPerHit || !!mechanics.damageIsPerHit
        };
    });

    const commonHealthMulti = 1 + (stats.secondaryHealthMulti || 0);
    const equipHealthMulti = stats.healthMultiplier || commonHealthMulti;
    const forgeAscHpBonus = Math.max(0, equipHealthMulti - commonHealthMulti);
    const globalSkinSetFactor = (1 + (stats.skinHealthMulti || 0)) + (stats.setHealthMulti || 0);
    const totalSystemHp = (stats.petHealth || 0) + (stats.skillPassiveHealth || 0) + (stats.mountHealth || 0);

    const totalHpBeforeGlobal = (stats.totalHealth || 10000) / Math.max(0.01, globalSkinSetFactor);
    let derivedEquipHp = (totalHpBeforeGlobal - totalSystemHp) / Math.max(0.01, equipHealthMulti);
    derivedEquipHp = Math.max(0, derivedEquipHp);

    const pvpHpBaseMulti = pvpBaseConfig?.PvpHpBaseMultiplier ?? 1.0;
    const pvpHpPetMulti = pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5;
    const pvpHpSkillMulti = pvpBaseConfig?.PvpHpSkillMultiplier ?? 0.5;
    const pvpHpMountMulti = pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0;

    const petAscMultiHp = getAscMulti('Pets', ascensionLevels.pets || 0, 'Health', ascensionConfigsLibrary);
    const skillAscMultiHp = getAscMulti('Skills', ascensionLevels.skills || 0, 'Health', ascensionConfigsLibrary);
    const mountAscMultiHp = getAscMulti('Mounts', ascensionLevels.mounts || 0, 'Health', ascensionConfigsLibrary);

    const pvpEquipHp = derivedEquipHp * (commonHealthMulti + (forgeAscHpBonus * pvpHpBaseMulti));
    const pvpPetHp = (stats.petHealth || 0) * (1 + petAscMultiHp) * pvpHpPetMulti;
    const pvpSkillHp = (stats.skillPassiveHealth || 0) * (1 + skillAscMultiHp) * pvpHpSkillMulti;
    const pvpMountHp = (stats.mountHealth || 0) * (1 + mountAscMultiHp) * pvpHpMountMulti;

    const pvpTotalHp = (pvpEquipHp + pvpPetHp + pvpSkillHp + pvpMountHp) * globalSkinSetFactor;

    let weaponInfo = undefined;
    if (weaponLibrary && weaponSlot) {
        const findWeapon = (item: any) => {
            if (item.age !== undefined && item.idx !== undefined) {
                const key = `{'Age': ${item.age}, 'Type': 'Weapon', 'Idx': ${item.idx}}`;
                if (weaponLibrary[key]) return weaponLibrary[key];
            }
            if (item.id && weaponLibrary[item.id]) return weaponLibrary[item.id];
            return null;
        };
        const wData = findWeapon(weaponSlot);
        if (wData) {
            weaponInfo = {
                Age: wData.ItemId?.Age || wData.Age || 0, Idx: wData.ItemId?.Idx || wData.Idx || 0,
                Type: wData.ItemId?.Type || wData.Type || 'Melee',
                IsRanged: (wData.AttackRange > 1.0) ? 1 : 0, AttackRange: wData.AttackRange,
                AttackDuration: wData.AttackDuration, WindupTime: wData.WindupTime, ProjectileId: wData.ProjectileId
            };
        }
    }

    // Arena battles carry the InLeagueBattle condition: the LeagueBattle tech nodes apply
    // here and nowhere else.
    const league = stats.contextBonuses?.league ?? { dmg: 0, hp: 0 };
    return {
        hp: Math.round(Math.max(1, pvpTotalHp)), damage: stats.totalDamage * (1 + league.dmg),
        baseHealth: stats.totalHealth * (1 + league.hp),
        skillCount: skills.length,
        petCount: 0,
        hasMount: false,
        matchTimerSeconds: pvpBaseConfig?.PvpMatchTimerSeconds ?? 60,
        pvpHp: {
            base: pvpBaseConfig?.PvpHpBaseMultiplier ?? 1.0,
            pet: pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5,
            skill: pvpBaseConfig?.PvpHpSkillMultiplier ?? 0.5,
            mount: pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0,
        },
        attackSpeed: stats.attackSpeedMultiplier || 1, weaponInfo,
        isRanged: weaponInfo ? (weaponInfo.AttackRange ?? 0) > 1.0 : stats.isRangedWeapon,
        projectileSpeed: stats.projectileSpeed, critChance: stats.criticalChance || 0,
        critMulti: stats.criticalDamage || 1.5, blockChance: stats.blockChance || 0,
        reflectChance: stats.reflectChance || 0,
        lifesteal: stats.lifeSteal || 0, doubleDamage: stats.doubleDamageChance || 0,
        healthRegen: stats.healthRegen || 0, damageMulti: 0, healthMulti: 0,
        skillDamageMulti: stats.skillDamageMultiplier || 1, skillCooldownMulti: stats.skillCooldownReduction || 0,
        skills
    };
}

export function profileToEnemyConfig(profile: UserProfile, libs: any, existingStats?: any): EnemyConfig {
    const engine = new StatEngine(profile, libs);
    const stats = existingStats || engine.calculate();
    const techModifiers = engine.getTechModifiers();
    const petBonusHp = techModifiers['PetBonusHealth'] || 0;
    const petAscLevel = profile.misc?.petAscensionLevel || 0;
    const petAscMulti = getAscMulti('Pets', petAscLevel, 'Health', libs.ascensionConfigsLibrary);
    const petDeScale = 1 + petBonusHp + petAscMulti;

    const skillBonusHp = techModifiers['SkillPassiveHealth'] || 0;
    const skillAscLevel = profile.misc?.skillAscensionLevel || 0;
    const skillAscMulti = getAscMulti('Skills', skillAscLevel, 'Health', libs.ascensionConfigsLibrary);
    const skillDeScale = 1 + skillBonusHp + skillAscMulti;

    const config: EnemyConfig = {
        name: profile.name || 'Imported Profile',
        level: profile.misc?.forgeLevel || 1,
        weaponId: profile.items.Weapon?.idx || 0,
        weapon: profile.items.Weapon || null,
        skillPassiveHp: Math.round((stats.skillPassiveHealth / Math.max(0.01, stats.healthMultiplier || 1)) / Math.max(0.01, skillDeScale)),
        stats: {
            damage: stats.totalDamage,
            hp: stats.totalHealth,
            power: stats.power,
            skinDmgMulti: stats.skinDamageMulti,
            skinHpMulti: stats.skinHealthMulti,
            setDmgMulti: stats.setDamageMulti,
            setHpMulti: stats.setHealthMulti,
            projectileSpeed: stats.projectileSpeed,
            attackRange: stats.weaponAttackRange,
            weaponWindup: stats.weaponWindupTime,
            weaponAttackDuration: stats.weaponAttackDuration,
        },
        forgeAscensionLevel: profile.misc?.forgeAscensionLevel || 0,
        skillAscensionLevel: profile.misc?.skillAscensionLevel || 0,
        mountAscensionLevel: profile.misc?.mountAscensionLevel || 0,
        petAscensionLevel: profile.misc?.petAscensionLevel || 0,
        skills: profile.skills.equipped.map((skill: any) => {
            const skillData = libs.skillLibrary?.[skill.id];
            const levelIdx = Math.max(0, skill.level - 1);
            const totalDamageMulti = (stats.skillDamageMultiplier || 1) + (stats.damageMultiplier || 1) - 1;
            const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
            let baseDamage = (skillData?.DamagePerLevel?.[levelIdx] || 0) * totalDamageMulti;
            if (mechanics.descriptionIsPerHit && !mechanics.damageIsPerHit) baseDamage /= mechanics.count;
            return {
                id: skill.id, rarity: skill.rarity, damage: Math.round(baseDamage),
                health: Math.round((skillData?.HealthPerLevel?.[levelIdx] || 0) * totalDamageMulti),
                level: skill.level, cooldown: skillData?.Cooldown || 10, duration: skillData?.ActiveDuration || 0,
                hasDamage: (skillData?.DamagePerLevel?.length || 0) > 0, hasHealth: (skillData?.HealthPerLevel?.length || 0) > 0
            };
        }),
        skinEntries: (() => {
            const entries: SkinEntry[] = [];
            const itemSlots = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'] as const;
            for (const slot of itemSlots) {
                const item = profile.items[slot];
                if (item?.skin?.stats) {
                    const dmg = item.skin.stats['Damage'] || 0, hp = item.skin.stats['Health'] || 0;
                    if (dmg > 0 || hp > 0) entries.push({ dmg, hp });
                }
            }
            return entries;
        })(),
        hasCompleteSet: (() => {
            if (!libs.skinsLibrary || !libs.setsLibrary) return false;
            const slotToJsonType: Record<string, string> = { 'Weapon': 'Weapon', 'Helmet': 'Helmet', 'Body': 'Armour', 'Gloves': 'Gloves', 'Belt': 'Belt', 'Necklace': 'Necklace', 'Ring': 'Ring', 'Shoe': 'Shoes' };
            const counts: Record<string, number> = {};
            const itemSlots = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'] as const;
            for (const slot of itemSlots) {
                const item = profile.items[slot];
                if (!item?.skin) continue;
                const skinEntry = Object.values(libs.skinsLibrary).find((s: any) => s.SkinId?.Type === (item.skin?.type || slotToJsonType[slot]) && s.SkinId?.Idx === item.skin?.idx) as any;
                if (skinEntry?.BaseSetId) counts[skinEntry.BaseSetId] = (counts[skinEntry.BaseSetId] || 0) + 1;
            }
            for (const [id, count] of Object.entries(counts)) {
                const set = libs.setsLibrary[id];
                if (set?.BonusTiers?.some((t: any) => count >= t.RequiredPieces)) return true;
            }
            return false;
        })(),
        passiveStats: {},
        pets: profile.pets?.active.map((p: any) => ({ ...p, hp: p.hp ? Math.round(p.hp / Math.max(0.01, petDeScale)) : 0 })) || [],
        mount: (() => {
            const m = profile.mount?.active;
            if (!m) return null;
            const mountAscLevel = profile.misc?.mountAscensionLevel || 0;
            let mountAscMulti = 0;
            if (mountAscLevel > 0 && libs.ascensionConfigsLibrary?.Mounts?.AscensionConfigPerLevel) {
                const configs = libs.ascensionConfigsLibrary.Mounts.AscensionConfigPerLevel;
                for (let i = 0; i < mountAscLevel && i < configs.length; i++) {
                    configs[i].StatContributions?.forEach((s: any) => { if (s.StatNode?.UniqueStat?.StatType === 'Health') mountAscMulti += s.Value; });
                }
            }
            const deScale = (1 + (techModifiers['MountHealth'] || 0) + mountAscMulti);
            return { ...m, hp: Math.round((stats.mountHealth || 0) / Math.max(0.01, deScale)) };
        })()
    };
    const ps = ['DamageMulti', 'HealthMulti', 'CriticalChance', 'CriticalMulti', 'BlockChance', 'LifeSteal', 'DoubleDamageChance', 'HealthRegen', 'SkillDamageMulti', 'SkillCooldownMulti', 'AttackSpeed'];
    ps.forEach(s => config.passiveStats[s] = { enabled: false, value: 0 });
    const deductions: Record<string, number> = {};
    const addDeduction = (arr: any[]) => arr?.forEach(s => deductions[s.statId] = (deductions[s.statId] || 0) + (s.value / 100));
    profile.pets?.active.forEach((p: any) => addDeduction(p.secondaryStats));
    if (profile.mount?.active?.secondaryStats) addDeduction(profile.mount.active.secondaryStats);
    const setP = (type: string, val: number | undefined) => { if (val && val > 0) config.passiveStats[type] = { enabled: true, value: parseFloat((val * 100).toFixed(2)) }; };
    const getNet = (id: string, total: number, isM: boolean = false) => Math.max(0, (isM ? total - 1 : total) - (deductions[id] || 0));
    setP('CriticalChance', getNet('CriticalChance', stats.criticalChance));
    setP('CriticalMulti', getNet('CriticalMulti', stats.criticalDamage, true));
    setP('BlockChance', getNet('BlockChance', stats.blockChance));
    setP('HealthRegen', getNet('HealthRegen', stats.healthRegen));
    setP('LifeSteal', getNet('LifeSteal', stats.lifeSteal));
    setP('DoubleDamageChance', getNet('DoubleDamageChance', stats.doubleDamageChance));
    setP('SkillDamageMulti', getNet('SkillDamageMulti', stats.skillDamageMultiplier, true));
    setP('SkillCooldownMulti', getNet('SkillCooldownMulti', stats.skillCooldownReduction));
    setP('AttackSpeed', getNet('AttackSpeed', stats.attackSpeedMultiplier, true));
    setP('DamageMulti', getNet('DamageMulti', stats.secondaryDamageMulti || 0));
    setP('HealthMulti', getNet('HealthMulti', stats.secondaryHealthMulti || 0));
    return config;
}
