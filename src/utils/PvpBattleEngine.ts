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

export class PvpBattleEngine {
    private time: number = 0;
    private player1: EntityState;
    private player2: EntityState;
    private player1Skills: SkillState[] = [];
    private player2Skills: SkillState[] = [];
    private player1ActiveEffects: ActiveSkillEffect[] = [];
    private player2ActiveEffects: ActiveSkillEffect[] = [];
    private player1ActiveBuffs: ActiveBuff[] = [];
    private player2ActiveBuffs: ActiveBuff[] = [];
    private projectiles: Projectile[] = [];
    private projectileIdCounter: number = 0;
    private totalPlayer1DamageDealt: number = 0;
    private totalPlayer2DamageDealt: number = 0;
    private logs: BattleLogEntry[] = [];

    constructor(player1Stats: PvpPlayerStats, player2Stats: PvpPlayerStats) {
        this.player1 = this.createEntity(1, true, player1Stats, 2);
        this.player2 = this.createEntity(2, false, player2Stats, 23);
        this.player1Skills = this.createSkillStates(player1Stats.skills, true);
        this.player2Skills = this.createSkillStates(player2Stats.skills, false);
        this.initializeRegen(this.player1, player1Stats);
        this.initializeRegen(this.player2, player2Stats);
        this.addLog('BATTLE_START', `Battle started between ${player1Stats.skills.length} skills and ${player2Stats.skills.length} skills`);
    }

    private addLog(event: string, details: string) {
        this.logs.push({ time: this.time, event, details });
    }

    private createEntity(id: number, isPlayer1: boolean, stats: PvpPlayerStats, position: number): EntityState {
        const weapon = stats.weaponInfo;
        const windupTime = weapon?.WindupTime ?? 0.5;
        const attackDuration = weapon?.AttackDuration ?? 1.5;
        const attackRange = weapon?.AttackRange ?? 0.3;
        const isRanged = (attackRange ?? 0) > 1.0;
        const baseHp = stats.hp * (1 + stats.healthMulti);
        const baseDmg = stats.damage * (1 + stats.damageMulti);

        return {
            id, isPlayer1, health: baseHp, maxHealth: baseHp, damage: baseDmg, shield: 0,
            attackSpeed: stats.attackSpeed, baseWindupTime: windupTime, attackDuration: attackDuration,
            windupTimer: 0, recoveryTimer: 0, isWindingUp: false, combatPhase: 'IDLE',
            pendingDoubleHit: false, isRanged, projectileSpeed: stats.projectileSpeed ?? 10,
            attackRange, position, combatState: 'MOVING', isDead: false,
            critChance: stats.critChance, critMulti: stats.critMulti, blockChance: stats.blockChance,
            lifesteal: stats.lifesteal, doubleDamage: stats.doubleDamage, healthRegen: stats.healthRegen,
            initialHealth: baseHp, currentRegenRate: 0, regenSnapshotTimer: 0
        };
    }

    private initializeRegen(entity: EntityState, stats: PvpPlayerStats) {
        entity.initialHealth = entity.maxHealth;
        const regenMult = stats.healthRegen || 0;
        entity.currentRegenRate = regenMult * entity.initialHealth;
        entity.regenSnapshotTimer = 0;
    }

    private createSkillStates(skills: PvpSkillConfig[], _isPlayer1: boolean): SkillState[] {
        return skills.map(skill => {
            const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
            const count = Math.max(1, skill.count || mechanics.count || 1);
            let damagePerHit = 0;
            if (skill.damage && skill.damage > 0) {
                if (mechanics.descriptionIsPerHit) {
                    damagePerHit = skill.damage;
                } else if (mechanics.damageIsPerHit) {
                    damagePerHit = skill.damage;
                } else {
                    damagePerHit = skill.damage / count;
                }
            }
            let healthPerHit = 0;
            if (skill.health && skill.health > 0) {
                healthPerHit = skill.health / count;
            }
            const isBuffSkill = BUFF_SKILLS.includes(skill.id) && skill.duration > 0;
            let bonusDamage = 0;
            let bonusMaxHealth = 0;
            let activeDamage = 0;
            let activeHeal = 0;
            if (isBuffSkill) {
                if (damagePerHit > 0) bonusDamage = damagePerHit * count;
                if (healthPerHit > 0) bonusMaxHealth = healthPerHit * count;
            } else {
                activeDamage = damagePerHit;
                activeHeal = healthPerHit;
            }
            return {
                id: skill.id, activeDuration: skill.duration, cooldown: skill.cooldown,
                state: 'Startup', timer: SKILL_STARTUP_TIME, damage: activeDamage, healAmount: activeHeal,
                isBuff: isBuffSkill, bonusDamage: bonusDamage, bonusMaxHealth: bonusMaxHealth,
                count: count, interval: mechanics.interval || 0.1, delay: mechanics.delay || 0,
                isSingleTarget: mechanics.isSingleTarget, isAOE: mechanics.isAOE
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
        this.processRegen(this.player1, dt);
        this.processRegen(this.player2, dt);
        const p1Status = { isDead: this.player1.isDead };
        const p2Status = { isDead: this.player2.isDead };
        if (Math.random() < 0.5) {
            this.processSkills(this.player1Skills, this.player1, this.player2, dt, true, p1Status);
            this.processSkills(this.player2Skills, this.player2, this.player1, dt, false, p2Status);
        } else {
            this.processSkills(this.player2Skills, this.player2, this.player1, dt, false, p2Status);
            this.processSkills(this.player1Skills, this.player1, this.player2, dt, true, p1Status);
        }
        if (Math.random() < 0.5) {
            this.processActiveEffects(this.player1ActiveEffects, this.player1, this.player2, dt, true, p1Status, p2Status);
            this.processActiveEffects(this.player2ActiveEffects, this.player2, this.player1, dt, false, p2Status, p1Status);
        } else {
            this.processActiveEffects(this.player2ActiveEffects, this.player2, this.player1, dt, false, p2Status, p1Status);
            this.processActiveEffects(this.player1ActiveEffects, this.player1, this.player2, dt, true, p1Status, p2Status);
        }
        this.processProjectiles(dt);
        const startOfTickDistance = Math.abs(this.player1.position - this.player2.position);
        if (Math.random() < 0.5) {
            this.processMovementAndCombat(this.player1, this.player2, dt, startOfTickDistance, !p1Status.isDead);
            this.processMovementAndCombat(this.player2, this.player1, dt, startOfTickDistance, !p2Status.isDead);
        } else {
            this.processMovementAndCombat(this.player2, this.player1, dt, startOfTickDistance, !p2Status.isDead);
            this.processMovementAndCombat(this.player1, this.player1, dt, startOfTickDistance, !p1Status.isDead);
        }
    }

    private processRegen(entity: EntityState, dt: number) {
        if (entity.isDead || entity.healthRegen <= 0) return;
        entity.regenSnapshotTimer += dt;
        const healingStep = entity.currentRegenRate * dt;
        if (healingStep > 0 && entity.health < entity.maxHealth) {
            entity.health = Math.min(entity.maxHealth, entity.health + healingStep);
        }
        if (entity.regenSnapshotTimer >= 1.0) {
            entity.regenSnapshotTimer -= 1.0;
            const baseRegen = entity.healthRegen || 0;
            entity.currentRegenRate = (baseRegen * entity.maxHealth) / SECONDS_TO_FULLY_REGENERATE;
        }
    }

    private processSkills(skills: SkillState[], caster: EntityState, _target: EntityState, dt: number, isPlayer1: boolean, casterStatus: { isDead: boolean }) {
        if (casterStatus.isDead) return;
        const activeEffects = isPlayer1 ? this.player1ActiveEffects : this.player2ActiveEffects;
        const activeBuffs = isPlayer1 ? this.player1ActiveBuffs : this.player2ActiveBuffs;
        skills.forEach(skill => {
            if (skill.state === 'Startup') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Ready';
                    skill.timer = 0;
                }
            } else if (skill.state === 'Ready') {
                const count = skill.count || 1;
                const interval = skill.interval || 0.1;
                if (count > 0 && (skill.damage || skill.healAmount)) {
                    activeEffects.push({
                        id: skill.id, damage: skill.damage, healAmount: skill.healAmount,
                        count: count, hitsRemaining: count, interval: interval,
                        timer: skill.delay || 0, isSingleTarget: skill.isSingleTarget, isAOE: skill.isAOE
                    });
                }
                if (skill.activeDuration && skill.activeDuration > 0) {
                    skill.state = 'Active';
                    skill.timer = skill.activeDuration;
                    this.applySkillBuff(skill, caster, activeBuffs);
                } else {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                }
            } else if (skill.state === 'Active') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                    this.removeSkillBuff(skill.id, caster, activeBuffs);
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

    private processActiveEffects(effects: ActiveSkillEffect[], caster: EntityState, target: EntityState, dt: number, isPlayer1: boolean, casterStatus: { isDead: boolean }, targetStatus: { isDead: boolean }) {
        if (casterStatus.isDead) return;
        for (let i = effects.length - 1; i >= 0; i--) {
            const effect = effects[i];
            if (effect.timer > 0) {
                effect.timer -= dt;
            } else {
                if (effect.hitsRemaining > 0) {
                    if (effect.damage && !targetStatus.isDead) {
                        this.dealDamage(caster, target, effect.damage, isPlayer1, false, true);
                    }
                    if (effect.healAmount) caster.health = Math.min(caster.maxHealth, caster.health + effect.healAmount);
                    effect.hitsRemaining--;
                    if (effect.hitsRemaining > 0) effect.timer = effect.interval;
                    else effects.splice(i, 1);
                } else effects.splice(i, 1);
            }
        }
    }

    private processProjectiles(dt: number) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            const direction = proj.isPlayer1Source ? 1 : -1;
            proj.currentX += proj.speed * dt * direction;
            const reached = proj.isPlayer1Source ? proj.currentX >= proj.toX : proj.currentX <= proj.toX;
            if (reached) {
                const target = proj.isPlayer1Source ? this.player2 : this.player1;
                this.dealDamage(proj.isPlayer1Source ? this.player1 : this.player2, target, proj.damage, proj.isPlayer1Source, proj.isCrit, false);
                this.projectiles.splice(i, 1);
            }
        }
    }

    private applySkillBuff(skill: SkillState, entity: EntityState, activeBuffs: ActiveBuff[]) {
        const bonusDmg = skill.bonusDamage || 0;
        const bonusHP = skill.bonusMaxHealth || 0;
        if (bonusDmg === 0 && bonusHP === 0) return;
        activeBuffs.push({ skillId: skill.id, bonusDamage: bonusDmg, bonusMaxHealth: bonusHP });
        entity.damage += bonusDmg;
        if (bonusHP > 0) {
            entity.maxHealth += bonusHP;
            entity.health += bonusHP;
        }
    }

    private removeSkillBuff(skillId: string, entity: EntityState, activeBuffs: ActiveBuff[]) {
        const buffIndex = activeBuffs.findIndex(b => b.skillId === skillId);
        if (buffIndex === -1) return;
        const buff = activeBuffs[buffIndex];
        activeBuffs.splice(buffIndex, 1);
        entity.damage -= buff.bonusDamage;
        if (buff.bonusMaxHealth > 0) {
            entity.maxHealth -= buff.bonusMaxHealth;
            if (entity.health > entity.maxHealth) entity.health = entity.maxHealth;
        }
    }

    private processMovementAndCombat(attacker: EntityState, target: EntityState, dt: number, distance: number, wasAliveAtStart: boolean): void {
        if (!wasAliveAtStart) return;
        const inRange = distance <= attacker.attackRange;
        if (!inRange) {
            attacker.combatState = 'MOVING';
            if (attacker.isPlayer1) attacker.position += PLAYER_SPEED * dt;
            else attacker.position -= PLAYER_SPEED * dt;
            attacker.combatPhase = 'IDLE';
        } else {
            attacker.combatState = 'FIGHTING';
            this.processEntityCombat(attacker, target, dt);
        }
    }

    private processEntityCombat(entity: EntityState, target: EntityState, dt: number) {
        const speedMult = Math.max(0.1, entity.attackSpeed);
        const windup = entity.baseWindupTime || 0.5;
        const duration = entity.attackDuration || 1.5;
        const effectiveWindup = windup / speedMult;
        const effectiveRecovery = Math.max(0.01, (duration - windup) / speedMult);
        switch (entity.combatPhase) {
            case 'IDLE':
                entity.combatPhase = 'CHARGING';
                entity.isWindingUp = true;
                entity.windupTimer = effectiveWindup;
                break;
            case 'CHARGING':
                entity.windupTimer -= dt;
                if (entity.windupTimer <= 0) {
                    const distance = Math.abs(entity.position - target.position);
                    if (distance <= entity.attackRange + 0.1) {
                        this.performAttack(entity, target);
                        if (!entity.pendingDoubleHit && Math.random() < entity.doubleDamage) {
                            if (!target.isDead) this.performAttack(entity, target, true);
                        }
                        entity.combatPhase = 'RECOVERING';
                        entity.isWindingUp = false;
                        entity.windupTimer = 0;
                        entity.recoveryTimer = effectiveRecovery;
                    } else {
                        entity.windupTimer = 0;
                        entity.isWindingUp = true;
                    }
                }
                break;
            case 'RECOVERING':
                entity.recoveryTimer -= dt;
                if (entity.recoveryTimer <= 0) {
                    entity.combatPhase = 'IDLE';
                    entity.recoveryTimer = 0;
                }
                break;
        }
    }

    private performAttack(attacker: EntityState, target: EntityState, suppressLog: boolean = false) {
        let dmg = attacker.damage;
        let isCrit = false;
        if (Math.random() < attacker.critChance) {
            dmg *= attacker.critMulti;
            isCrit = true;
        }
        if (!suppressLog) {
            this.addLog(isCrit ? 'CRIT' : 'ATTACK', `${attacker.isPlayer1 ? 'Player 1' : 'Player 2'} attacks ${isCrit ? '(CRITICAL!)' : ''}`);
        }
        if (attacker.isRanged && attacker.projectileSpeed && attacker.projectileSpeed > 0) {
            this.projectiles.push({
                id: this.projectileIdCounter++, fromX: attacker.position, toX: target.position,
                currentX: attacker.position, speed: attacker.projectileSpeed, isPlayer1Source: attacker.isPlayer1,
                damage: dmg, targetId: target.id, isCrit: isCrit
            });
        } else {
            this.dealDamage(attacker, target, dmg, attacker.isPlayer1, isCrit);
        }
    }

    private dealDamage(attacker: EntityState, target: EntityState, amount: number, isPlayer1Source: boolean, _isCrit: boolean, isSkillDamage: boolean = false) {
        let finalDamage = amount;
        if (target.shield > 0) finalDamage = Math.max(0, amount - target.shield);
        if (finalDamage <= 0) return;
        if (Math.random() < target.blockChance) {
            this.addLog('BLOCK', `${isPlayer1Source ? 'Player 2' : 'Player 1'} blocked the attack!`);
            return;
        }
        const damageDealt = Math.min(finalDamage, target.health);
        if (isPlayer1Source) this.totalPlayer1DamageDealt += damageDealt;
        else this.totalPlayer2DamageDealt += damageDealt;
        target.health -= finalDamage;
        if (!isSkillDamage) {
            const lifesteal = attacker.lifesteal * finalDamage;
            if (lifesteal > 0) {
                attacker.health = Math.min(attacker.maxHealth, attacker.health + lifesteal);
            }
        }
        if (target.health <= 0) {
            target.isDead = true;
            target.health = 0;
            this.addLog('DEATH', `${isPlayer1Source ? 'Player 2' : 'Player 1'} died!`);
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
            const EPSILON = 0.00001;
            if (Math.abs(p1HpLost - p2HpLost) < EPSILON) winner = 'tie';
            else if (p1HpLost < p2HpLost) winner = 'player1';
            else winner = 'player2';
        }
        return {
            winner, player1Hp: this.player1.health, player1MaxHp: this.player1.maxHealth,
            player1HpPercent: p1HpPercent * 100, player2Hp: this.player2.health,
            player2MaxHp: this.player2.maxHealth, player2HpPercent: p2HpPercent * 100,
            time: this.time, timeout: isTimeout
        };
    }

    public getSnapshot() {
        return {
            time: this.time, player1: { ...this.player1 }, player2: { ...this.player2 },
            player1Skills: this.player1Skills.map(s => ({ ...s })),
            player2Skills: this.player2Skills.map(s => ({ ...s })),
            player1ActiveEffects: this.player1ActiveEffects.map(e => ({ ...e })),
            player2ActiveEffects: this.player2ActiveEffects.map(e => ({ ...e })),
            player1ActiveBuffs: this.player1ActiveBuffs.map(b => ({ ...b })),
            player2ActiveBuffs: this.player2ActiveBuffs.map(b => ({ ...b })),
            projectiles: this.projectiles.map(p => ({ ...p })),
            logs: [...this.logs]
        };
    }
}

export function simulatePvpBattleMulti(player1Stats: PvpPlayerStats, player2Stats: PvpPlayerStats, runs: number = 1000) {
    const results: PvpBattleResult[] = [];
    let p1Wins = 0, p2Wins = 0, ties = 0, totalTime = 0, timeouts = 0;
    for (let i = 0; i < runs; i++) {
        const engine = new PvpBattleEngine(player1Stats, player2Stats);
        const result = engine.simulate();
        results.push(result);
        if (result.winner === 'player1') p1Wins++;
        else if (result.winner === 'player2') p2Wins++;
        else ties++;
        totalTime += result.time;
        if (result.timeout) timeouts++;
    }
    return {
        player1WinRate: (p1Wins / runs) * 100, player2WinRate: (p2Wins / runs) * 100,
        tieRate: (ties / runs) * 100, avgTime: totalTime / runs,
        timeoutRate: (timeouts / runs) * 100, results
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
    let doubleDamage = passives.DoubleDamageChance?.enabled ? passives.DoubleDamageChance.value / 100 : 1.0;
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
        const totalDamageMulti = (stats.skillDamageMultiplier || 1) + (stats.damageMultiplier || 1) - 1;
        let damage = baseDamage * totalDamageMulti;
        const health = (skillData?.HealthPerLevel?.[levelIdx] || 0) * totalDamageMulti;
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

    return {
        hp: Math.round(Math.max(1, pvpTotalHp)), damage: stats.totalDamage,
        attackSpeed: stats.attackSpeedMultiplier || 1, weaponInfo,
        isRanged: weaponInfo ? (weaponInfo.AttackRange ?? 0) > 1.0 : stats.isRangedWeapon,
        projectileSpeed: stats.projectileSpeed, critChance: stats.criticalChance || 0,
        critMulti: stats.criticalDamage || 1.5, blockChance: stats.blockChance || 0,
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
                if (skinEntry?.SetId) counts[skinEntry.SetId] = (counts[skinEntry.SetId] || 0) + 1;
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
