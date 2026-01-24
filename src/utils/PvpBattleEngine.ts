/**
 * PVP Battle Engine
 * 
 * Specialized battle engine for player vs player (PVP) simulations.
 */

import { StatEngine, LibraryData, AggregatedStats } from './statEngine';
import type { UserProfile } from '../types/Profile';
import type { WeaponInfo } from './BattleHelper';
import { SKILL_MECHANICS } from './constants';

// --- Types ---

// Removed hardcoded PASSIVE_STAT_TYPES to support dynamic loading from JSON
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
}

export interface PassiveStatConfig {
    enabled: boolean;
    value: number;
}

export interface EnemyConfig {
    weapon: any | null;
    skills: (EnemySkillConfig | null)[];
    stats: {
        power?: number;
        hp: number;
        damage: number;
    };
    passiveStats: Record<string, PassiveStatConfig>;
    name: string;
}

// Initialize passives given a list of keys (from JSON)
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
    lifesteal: number;
    doubleDamage: number;
    healthRegen: number;
    damageMulti: number;
    healthMulti: number;
    skillDamageMulti: number;
    skillCooldownMulti: number;
    skills: PvpSkillConfig[];
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

interface SkillState {
    id: string;
    cooldown: number;
    duration: number;
    damage?: number;
    healAmount?: number;
    state: 'Startup' | 'Ready' | 'Active' | 'Cooldown';
    timer: number;
    count: number;
    hitsRemaining: number;
    interval: number;
}

interface EntityState {
    id: number;
    isPlayer1: boolean;
    health: number;
    maxHealth: number;
    damage: number;
    attackSpeed: number;
    critChance: number;
    critMulti: number;
    blockChance: number;
    lifesteal: number;
    doubleDamage: number;
    healthRegen: number;
    baseWindupTime: number;
    attackDuration: number;
    windupTimer: number;
    recoveryTimer: number;
    combatPhase: 'IDLE' | 'CHARGING' | 'RECOVERING';
    isRanged: boolean;
    projectileSpeed: number;
    attackRange: number;
    position: number;
    isDead: boolean;
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

export interface PvpLogEntry {
    time: number;
    message: string;
    type: 'damage' | 'heal' | 'skill' | 'info' | 'critical' | 'win';
}

const PVP_TIME_LIMIT = 60.0;
const SKILL_STARTUP_TIME = 3.2;
const TIME_STEP = 1 / 60;

export class PvpBattleEngine {
    private logs: PvpLogEntry[] = [];
    private time: number = 0;
    private player1: EntityState;
    private player2: EntityState;
    private player1Skills: SkillState[] = [];
    private player2Skills: SkillState[] = [];

    constructor(player1Stats: PvpPlayerStats, player2Stats: PvpPlayerStats) {
        this.player1 = this.createEntity(1, true, player1Stats, 2);
        this.player2 = this.createEntity(2, false, player2Stats, 18);
        this.player1Skills = this.createSkillStates(player1Stats.skills);
        this.player2Skills = this.createSkillStates(player2Stats.skills);
    }

    private log(message: string, type: PvpLogEntry['type'] = 'info') {
        this.logs.push({
            time: this.time,
            message,
            type
        });
    }

    private createEntity(id: number, isPlayer1: boolean, stats: PvpPlayerStats, position: number): EntityState {
        const weapon = stats.weaponInfo;
        const windupTime = weapon?.WindupTime ?? 0.5;
        const attackDuration = weapon?.AttackDuration ?? 1.5;
        const attackRange = weapon?.AttackRange ?? 0.3;
        const isRanged = (attackRange ?? 0) > 1.0;

        return {
            id,
            isPlayer1,
            health: stats.hp * (1 + stats.healthMulti),
            maxHealth: stats.hp * (1 + stats.healthMulti),
            damage: stats.damage * (1 + stats.damageMulti),
            attackSpeed: stats.attackSpeed,
            critChance: stats.critChance,
            critMulti: stats.critMulti,
            blockChance: stats.blockChance,
            lifesteal: stats.lifesteal,
            doubleDamage: stats.doubleDamage,
            healthRegen: stats.healthRegen,
            baseWindupTime: windupTime,
            attackDuration: attackDuration,
            windupTimer: 0,
            recoveryTimer: 0,
            combatPhase: 'IDLE',
            isRanged,
            projectileSpeed: stats.projectileSpeed ?? 10,
            attackRange,
            position,
            isDead: false
        };
    }

    private createSkillStates(skills: PvpSkillConfig[]): SkillState[] {
        return skills.map(skill => {
            const count = Math.max(1, skill.count);
            // Calculate per-hit/tick value for simulation
            const damagePerHit = (skill.damage && skill.damage > 0)
                ? (skill.damageIsPerHit ? skill.damage : skill.damage / count)
                : 0;

            const healthPerHit = (skill.health && skill.health > 0)
                ? skill.health / count
                : 0;

            return {
                id: skill.id,
                cooldown: skill.cooldown,
                duration: skill.duration,
                damage: damagePerHit,
                healAmount: healthPerHit,
                state: 'Startup' as const,
                timer: SKILL_STARTUP_TIME,
                count: count,
                hitsRemaining: 0,
                interval: 0.1
            };
        });
    }

    public simulate(): PvpBattleResult {
        while (this.time < PVP_TIME_LIMIT) {
            this.tick(TIME_STEP);
            if (this.player1.isDead || this.player2.isDead) break;
        }
        return this.getResult();
    }

    private tick(dt: number): void {
        this.time += dt;
        this.applyHealthRegen(this.player1, dt);
        this.applyHealthRegen(this.player2, dt);
        this.processSkills(this.player1Skills, this.player1, this.player2, dt);
        this.processSkills(this.player2Skills, this.player2, this.player1, dt);
        this.processMovementAndCombat(this.player1, this.player2, dt, true);
        this.processMovementAndCombat(this.player2, this.player1, dt, false);
    }

    private applyHealthRegen(entity: EntityState, dt: number): void {
        if (entity.isDead || entity.healthRegen <= 0) return;
        const regenAmount = entity.maxHealth * entity.healthRegen * dt;
        entity.health = Math.min(entity.maxHealth, entity.health + regenAmount);
    }

    private processSkills(skills: SkillState[], caster: EntityState, target: EntityState, dt: number): void {
        if (caster.isDead) return;

        skills.forEach(skill => {
            if (skill.state === 'Startup') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Ready';
                    skill.timer = 0;
                }
            } else if (skill.state === 'Ready') {
                this.log(`${caster.isPlayer1 ? 'Player' : 'Enemy'} used skill: ${skill.id}`, 'skill');

                // Deal all hits immediately (Simplified Multi-Hit)
                for (let i = 0; i < skill.count; i++) {
                    if (skill.damage && skill.damage > 0) {
                        this.dealDamage(caster, target, skill.damage, true);
                    }
                    if (skill.healAmount && skill.healAmount > 0) {
                        caster.health = Math.min(caster.maxHealth, caster.health + skill.healAmount);
                    }
                }

                if (skill.duration > 0) {
                    skill.state = 'Active';
                    skill.timer = skill.duration;
                } else {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                }
            } else if (skill.state === 'Active') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                }
            } else if (skill.state === 'Cooldown') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Ready';
                    skill.timer = 0;
                }
            }
        });
    }

    private processMovementAndCombat(attacker: EntityState, target: EntityState, dt: number, moveRight: boolean): void {
        if (attacker.isDead || target.isDead) return;

        const distance = Math.abs(attacker.position - target.position);
        const inRange = distance <= attacker.attackRange;

        if (!inRange) {
            const moveSpeed = 4.0;
            if (moveRight) {
                attacker.position += moveSpeed * dt;
            } else {
                attacker.position -= moveSpeed * dt;
            }
            attacker.combatPhase = 'IDLE';
        } else {
            this.processAttack(attacker, target, dt);
        }
    }

    private processAttack(attacker: EntityState, target: EntityState, dt: number): void {
        const speedMult = Math.max(0.1, attacker.attackSpeed);
        const effectiveWindup = attacker.baseWindupTime / speedMult;
        const effectiveDuration = attacker.attackDuration / speedMult;
        const effectiveRecovery = Math.max(0.01, effectiveDuration - effectiveWindup);

        switch (attacker.combatPhase) {
            case 'IDLE':
                attacker.combatPhase = 'CHARGING';
                attacker.windupTimer = effectiveWindup;
                break;
            case 'CHARGING':
                attacker.windupTimer -= dt;
                if (attacker.windupTimer <= 0) {
                    this.dealDamage(attacker, target, attacker.damage, false);
                    if (Math.random() < attacker.doubleDamage && !target.isDead) {
                        this.dealDamage(attacker, target, attacker.damage, false);
                    }
                    attacker.combatPhase = 'RECOVERING';
                    attacker.recoveryTimer = effectiveRecovery;
                }
                break;
            case 'RECOVERING':
                attacker.recoveryTimer -= dt;
                if (attacker.recoveryTimer <= 0) {
                    attacker.combatPhase = 'IDLE';
                }
                break;
        }
    }

    private dealDamage(attacker: EntityState, target: EntityState, baseDamage: number, _isSkillDamage: boolean): void {
        if (target.isDead) return;

        let damage = baseDamage;
        let isCrit = false;
        if (Math.random() < attacker.critChance) {
            damage *= attacker.critMulti;
            isCrit = true;
        }

        if (Math.random() < target.blockChance) {
            damage = 0;
            this.log(`${attacker.isPlayer1 ? 'Player' : 'Enemy'} attacked but was BLOCKED!`, 'info');
        }

        if (damage > 0) {
            target.health -= damage;
            this.log(`${attacker.isPlayer1 ? 'Player' : 'Enemy'} hit for ${Math.round(damage)} damage${isCrit ? ' (CRIT!)' : ''}`, isCrit ? 'critical' : 'damage');
        }

        if (damage > 0 && attacker.lifesteal > 0) {
            const healAmount = damage * attacker.lifesteal;
            attacker.health = Math.min(attacker.maxHealth, attacker.health + healAmount);
            this.log(`${attacker.isPlayer1 ? 'Player' : 'Enemy'} lifesteal +${Math.round(healAmount)} HP`, 'heal');
        }

        if (target.health <= 0) {
            target.health = 0;
            target.isDead = true;
            this.log(`${attacker.isPlayer1 ? 'Enemy' : 'Player'} defeated!`, 'win');
        }
    }

    private getResult(): PvpBattleResult {
        const isTimeout = this.time >= PVP_TIME_LIMIT;
        const p1HpPercent = this.player1.health / this.player1.maxHealth;
        const p2HpPercent = this.player2.health / this.player2.maxHealth;
        let winner: 'player1' | 'player2' | 'tie';

        if (this.player1.isDead && this.player2.isDead) winner = 'tie';
        else if (this.player1.isDead) winner = 'player2';
        else if (this.player2.isDead) winner = 'player1';
        else {
            const p1HpLost = 1 - p1HpPercent;
            const p2HpLost = 1 - p2HpPercent;
            if (p1HpLost < p2HpLost) winner = 'player1';
            else if (p2HpLost < p1HpLost) winner = 'player2';
            else winner = 'tie';
        }

        return {
            winner,
            player1Hp: this.player1.health,
            player1MaxHp: this.player1.maxHealth,
            player1HpPercent: p1HpPercent * 100,
            player2Hp: this.player2.health,
            player2MaxHp: this.player2.maxHealth,
            player2HpPercent: p2HpPercent * 100,
            time: this.time,
            timeout: isTimeout
        };
    }

    public getSnapshot() {
        return {
            time: this.time,
            player1: { ...this.player1 },
            player2: { ...this.player2 },
            player1Skills: this.player1Skills.map(s => ({ ...s })),
            player2Skills: this.player2Skills.map(s => ({ ...s })),
            logs: [...this.logs]
        };
    }
}

export function simulatePvpBattleMulti(
    player1Stats: PvpPlayerStats,
    player2Stats: PvpPlayerStats,
    runs: number = 1000
): {
    player1WinRate: number;
    player2WinRate: number;
    tieRate: number;
    avgTime: number;
    timeoutRate: number;
    results: PvpBattleResult[];
} {
    const results: PvpBattleResult[] = [];
    let player1Wins = 0;
    let player2Wins = 0;
    let ties = 0;
    let totalTime = 0;
    let timeouts = 0;

    for (let i = 0; i < runs; i++) {
        const engine = new PvpBattleEngine(player1Stats, player2Stats);
        const result = engine.simulate();
        results.push(result);

        if (result.winner === 'player1') player1Wins++;
        else if (result.winner === 'player2') player2Wins++;
        else ties++;

        totalTime += result.time;
        if (result.timeout) timeouts++;
    }

    return {
        player1WinRate: (player1Wins / runs) * 100,
        player2WinRate: (player2Wins / runs) * 100,
        tieRate: (ties / runs) * 100,
        avgTime: totalTime / runs,
        timeoutRate: (timeouts / runs) * 100,
        results
    };
}

export function enemyConfigToPvpStats(
    enemyConfig: any,
    weaponLibrary?: any
): PvpPlayerStats {
    let weaponInfo: WeaponInfo | undefined;
    if (enemyConfig.weapon && weaponLibrary) {
        const weaponKey = `{'Age': ${enemyConfig.weapon.age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.weapon.idx}}`;
        weaponInfo = weaponLibrary[weaponKey];
    }

    const passives = enemyConfig.passiveStats || {};
    const attackSpeedBonus = passives.AttackSpeed?.enabled ? passives.AttackSpeed.value / 100 : 0;

    return {
        hp: enemyConfig.stats.hp,
        damage: enemyConfig.stats.damage,
        attackSpeed: 1.0 + attackSpeedBonus,
        weaponInfo,
        isRanged: weaponInfo ? (weaponInfo.AttackRange ?? 0) > 1.0 : false,
        projectileSpeed: 10,

        critChance: passives.CriticalChance?.enabled ? passives.CriticalChance.value / 100 : 0,
        critMulti: passives.CriticalMulti?.enabled ? 1 + (passives.CriticalMulti.value / 100) : 1.5,
        blockChance: passives.BlockChance?.enabled ? passives.BlockChance.value / 100 : 0,
        lifesteal: passives.LifeSteal?.enabled ? passives.LifeSteal.value / 100 : 0,
        doubleDamage: passives.DoubleDamageChance?.enabled ? passives.DoubleDamageChance.value / 100 : 0,
        healthRegen: passives.HealthRegen?.enabled ? passives.HealthRegen.value / 100 : 0,
        damageMulti: passives.DamageMulti?.enabled ? passives.DamageMulti.value / 100 : 0,
        healthMulti: passives.HealthMulti?.enabled ? passives.HealthMulti.value / 100 : 0,
        skillDamageMulti: passives.SkillDamageMulti?.enabled ? passives.SkillDamageMulti.value / 100 : 0,
        skillCooldownMulti: passives.SkillCooldownMulti?.enabled ? passives.SkillCooldownMulti.value / 100 : 0,

        skills: (enemyConfig.skills || [])
            .filter((s: any) => s !== null)
            .map((s: any) => {
                const mechanics = SKILL_MECHANICS[s.id] || { count: 1 };
                return {
                    id: s.id,
                    damage: s.damage,
                    health: s.health,
                    cooldown: s.cooldown,
                    duration: s.duration,
                    hasDamage: s.hasDamage,
                    hasHealth: s.hasHealth,
                    count: mechanics.count || 1,
                    damageIsPerHit: !!mechanics.descriptionIsPerHit || !!mechanics.damageIsPerHit
                };
            })
    };
}

export function aggregatedStatsToPvpStats(
    stats: AggregatedStats,
    equippedSkills: any[],
    skillLibrary: any
): PvpPlayerStats {
    const skills: PvpSkillConfig[] = equippedSkills.map(skill => {
        const skillData = skillLibrary?.[skill.id];
        const levelIdx = Math.max(0, skill.level - 1);

        let baseDamage = skillData?.DamagePerLevel?.[levelIdx] || 0;
        let baseHealth = skillData?.HealthPerLevel?.[levelIdx] || 0;

        const skillFactor = stats.skillDamageMultiplier || 1;
        const globalFactor = stats.damageMultiplier || 1;
        const mountFactor = (stats as any).mountDamageMulti || 0;
        const totalDamageMulti = skillFactor + (globalFactor - mountFactor) - 1;

        let damage = baseDamage * totalDamageMulti;
        const health = baseHealth * totalDamageMulti;

        const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };

        // If description says value is Per Hit (but library is Total), divide Total by Count
        if (mechanics.descriptionIsPerHit && !mechanics.damageIsPerHit) {
            damage /= mechanics.count;
        }

        return {
            id: skill.id,
            damage,
            health,
            cooldown: skillData?.Cooldown || 10,
            duration: skillData?.ActiveDuration || 0,
            hasDamage: baseDamage > 0,
            hasHealth: baseHealth > 0,
            count: mechanics.count || 1,
            damageIsPerHit: !!mechanics.descriptionIsPerHit || !!mechanics.damageIsPerHit
        };
    });

    return {
        hp: stats.totalHealth,
        damage: stats.totalDamage,
        attackSpeed: stats.attackSpeedMultiplier || 1,
        isRanged: stats.isRangedWeapon,
        projectileSpeed: stats.projectileSpeed,

        critChance: stats.criticalChance || 0,
        critMulti: stats.criticalDamage || 1.5,
        blockChance: stats.blockChance || 0,
        lifesteal: stats.lifeSteal || 0,
        doubleDamage: stats.doubleDamageChance || 0,
        healthRegen: stats.healthRegen || 0,
        damageMulti: 0,
        healthMulti: 0,
        skillDamageMulti: stats.skillDamageMultiplier || 1,
        skillCooldownMulti: stats.skillCooldownReduction || 0,

        skills
    };
}

export function profileToEnemyConfig(profile: UserProfile, libs: LibraryData): EnemyConfig {
    const engine = new StatEngine(profile, libs);
    const stats = engine.calculate();

    const config: EnemyConfig = {
        name: profile.name,
        weapon: profile.items.Weapon || null,
        skills: profile.skills.equipped.map(skill => {
            const skillData = libs.skillLibrary?.[skill.id];
            const levelIdx = Math.max(0, skill.level - 1);
            let baseDamage = skillData?.DamagePerLevel?.[levelIdx] || 0;
            let baseHealth = skillData?.HealthPerLevel?.[levelIdx] || 0;

            const skillFactor = stats.skillDamageMultiplier || 1;
            const globalFactor = stats.damageMultiplier || 1;
            const mountFactor = stats.mountDamageMulti || 0;
            const totalDamageMulti = skillFactor + (globalFactor - mountFactor) - 1;

            baseDamage *= totalDamageMulti;
            baseHealth *= totalDamageMulti;

            const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
            // If description says value is Per Hit (but library is Total), divide Total by Count
            if (mechanics.descriptionIsPerHit && !mechanics.damageIsPerHit) {
                baseDamage /= mechanics.count;
            }

            return {
                id: skill.id,
                rarity: skill.rarity,
                damage: Math.round(baseDamage),
                health: Math.round(baseHealth),
                cooldown: skillData?.Cooldown || 10,
                duration: skillData?.ActiveDuration || 0,
                hasDamage: (skillData?.DamagePerLevel?.length || 0) > 0,
                hasHealth: (skillData?.HealthPerLevel?.length || 0) > 0
            };
        }),
        stats: {
            hp: stats.totalHealth,
            damage: stats.totalDamage,
            power: stats.power
        },
        passiveStats: initPassiveStats()
    };

    const setPassive = (type: PassiveStatType, val: number | undefined) => {
        if (val && val > 0) {
            config.passiveStats[type] = {
                enabled: true,
                value: parseFloat((val * 100).toFixed(2))
            };
        }
    };

    setPassive('CriticalChance', stats.criticalChance);
    setPassive('CriticalMulti', stats.criticalDamage - 1);
    setPassive('BlockChance', stats.blockChance);
    setPassive('HealthRegen', stats.healthRegen);
    setPassive('LifeSteal', stats.lifeSteal);
    setPassive('DoubleDamageChance', stats.doubleDamageChance);
    setPassive('SkillDamageMulti', stats.skillDamageMultiplier - 1);
    setPassive('SkillCooldownMulti', stats.skillCooldownReduction);
    setPassive('AttackSpeed', stats.attackSpeedMultiplier - 1);

    return config;
}
