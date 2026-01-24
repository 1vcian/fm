/**
 * PVP Battle Engine
 * 
 * Specialized battle engine for player vs player (PVP) simulations.
 * Uses the same logic as BattleEngine but with two players instead of player vs enemies.
 */

import type { WeaponInfo } from './BattleHelper';
import { SKILL_MECHANICS } from './constants';
import { StatEngine } from './statEngine';
import { PetSlot, MountSlot } from '../types/Profile';

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
    pets: (PetSlot | null)[];
    mount: MountSlot | null;
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

// Reuse types from BattleEngine
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
    hitsRemaining?: number;
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
    // Stats for combat
    critChance: number;
    critMulti: number;
    blockChance: number;
    lifesteal: number;
    doubleDamage: number;
    healthRegen: number;
    initialHealth: number; // For regen calculation
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
    private logs: BattleLogEntry[] = [];
    private projectiles: Projectile[] = [];
    private projectileIdCounter: number = 0;

    // Stats tracking
    private totalPlayer1DamageDealt: number = 0;
    private totalPlayer2DamageDealt: number = 0;

    constructor(player1Stats: PvpPlayerStats, player2Stats: PvpPlayerStats) {
        this.player1 = this.createEntity(1, true, player1Stats, 2);
        this.player2 = this.createEntity(2, false, player2Stats, 23); // Distance 21 (same as BattleEngine)
        this.player1Skills = this.createSkillStates(player1Stats.skills, true);
        this.player2Skills = this.createSkillStates(player2Stats.skills, false);
        this.initializeRegen(this.player1, player1Stats);
        this.initializeRegen(this.player2, player2Stats);
    }

    private log(event: string, details: string) {
        this.logs.push({
            time: this.time,
            event,
            details
        });
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
            id,
            isPlayer1,
            health: baseHp,
            maxHealth: baseHp,
            damage: baseDmg,
            shield: 0,
            attackSpeed: stats.attackSpeed,
            baseWindupTime: windupTime,
            attackDuration: attackDuration,
            windupTimer: 0,
            recoveryTimer: 0,
            isWindingUp: false,
            combatPhase: 'IDLE',
            pendingDoubleHit: false,
            isRanged,
            projectileSpeed: stats.projectileSpeed ?? 10,
            attackRange,
            position,
            combatState: 'MOVING',
            isDead: false,
            critChance: stats.critChance,
            critMulti: stats.critMulti,
            blockChance: stats.blockChance,
            lifesteal: stats.lifesteal,
            doubleDamage: stats.doubleDamage,
            healthRegen: stats.healthRegen,
            initialHealth: baseHp,
            currentRegenRate: 0,
            regenSnapshotTimer: 0
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

            // Process damage value - the value from enemy config is the description value
            // The description value can be per-hit or total depending on what the description says
            let damagePerHit = 0;
            if (skill.damage && skill.damage > 0) {
                // If description says per-hit, the value is already per hit
                if (mechanics.descriptionIsPerHit) {
                    damagePerHit = skill.damage;
                } else {
                    // Description says total, but check if damageIsPerHit (library has per-hit)
                    if (mechanics.damageIsPerHit) {
                        // Library has per-hit, but description says total
                        // This means the value entered is total, but each hit does that full value
                        damagePerHit = skill.damage;
                    } else {
                        // Description says total, library has total, divide by count
                        damagePerHit = skill.damage / count;
                    }
                }
            }

            // Process health value - health is always total in descriptions, divide by count
            let healthPerHit = 0;
            if (skill.health && skill.health > 0) {
                healthPerHit = skill.health / count;
            }

            // Determine if buff skill
            const isBuffSkill = BUFF_SKILLS.includes(skill.id) && skill.duration > 0;

            let bonusDamage = 0;
            let bonusMaxHealth = 0;
            let activeDamage = 0;
            let activeHeal = 0;

            if (isBuffSkill) {
                // Buff skills: add to stats for duration
                if (damagePerHit > 0) {
                    bonusDamage = damagePerHit * count; // Total buff value
                }
                if (healthPerHit > 0) {
                    bonusMaxHealth = healthPerHit * count; // Total buff value
                }
            } else {
                // Damage/Instant skills: deal damage per hit
                activeDamage = damagePerHit;
                activeHeal = healthPerHit;
            }

            return {
                id: skill.id,
                activeDuration: skill.duration,
                cooldown: skill.cooldown,
                state: 'Startup',
                timer: SKILL_STARTUP_TIME,
                damage: activeDamage,
                healAmount: activeHeal,
                isBuff: isBuffSkill,
                bonusDamage: bonusDamage,
                bonusMaxHealth: bonusMaxHealth,
                count: count,
                interval: mechanics.interval || 0.1,
                delay: mechanics.delay || 0,
                isSingleTarget: mechanics.isSingleTarget,
                isAOE: mechanics.isAOE
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

        // Health regen for both players (Order doesn't matter much here, but let's be consistent)
        this.processRegen(this.player1, dt);
        this.processRegen(this.player2, dt);

        // Skills for both players - Randomized Order
        if (Math.random() < 0.5) {
            this.processSkills(this.player1Skills, this.player1, this.player2, dt, true);
            this.processSkills(this.player2Skills, this.player2, this.player1, dt, false);
        } else {
            this.processSkills(this.player2Skills, this.player2, this.player1, dt, false);
            this.processSkills(this.player1Skills, this.player1, this.player2, dt, true);
        }

        // Active effects for both players - Randomized Order
        if (Math.random() < 0.5) {
            this.processActiveEffects(this.player1ActiveEffects, this.player1, this.player2, dt, true);
            this.processActiveEffects(this.player2ActiveEffects, this.player2, this.player1, dt, false);
        } else {
            this.processActiveEffects(this.player2ActiveEffects, this.player2, this.player1, dt, false);
            this.processActiveEffects(this.player1ActiveEffects, this.player1, this.player2, dt, true);
        }

        // Projectiles
        this.processProjectiles(dt);

        // Movement and combat for both players - Randomized Order
        if (Math.random() < 0.5) {
            this.processMovementAndCombat(this.player1, this.player2, dt);
            this.processMovementAndCombat(this.player2, this.player1, dt);
        } else {
            this.processMovementAndCombat(this.player2, this.player1, dt);
            this.processMovementAndCombat(this.player1, this.player2, dt);
        }
    }

    private processRegen(entity: EntityState, dt: number) {
        if (entity.isDead || entity.healthRegen <= 0) return;

        entity.regenSnapshotTimer += dt;
        const healingStep = entity.currentRegenRate * dt;
        if (healingStep > 0) {
            if (entity.health < entity.maxHealth) {
                entity.health = Math.min(entity.maxHealth, entity.health + healingStep);
            }
        }
        if (entity.regenSnapshotTimer >= 1.0) {
            entity.regenSnapshotTimer -= 1.0;
            const baseRegen = entity.healthRegen || 0;
            entity.currentRegenRate = (baseRegen * entity.maxHealth) / SECONDS_TO_FULLY_REGENERATE;
        }
    }

    private processSkills(skills: SkillState[], caster: EntityState, _target: EntityState, dt: number, isPlayer1: boolean) {
        if (caster.isDead) return;

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
                // Activate Immediately
                const count = skill.count || 1;
                const interval = skill.interval || 0.1;

                // Only create active effect if there's damage or healing to do
                if (count > 0 && (skill.damage || skill.healAmount)) {
                    activeEffects.push({
                        id: skill.id,
                        damage: skill.damage,
                        healAmount: skill.healAmount,
                        count: count,
                        hitsRemaining: count,
                        interval: interval,
                        timer: skill.delay || 0,
                        isSingleTarget: skill.isSingleTarget,
                        isAOE: skill.isAOE
                    });
                }

                // Handle State Transition
                if (skill.activeDuration && skill.activeDuration > 0) {
                    // Duration Skill: Active -> Cooldown
                    skill.state = 'Active';
                    skill.timer = skill.activeDuration;
                    this.log('SKILL', `${caster.isPlayer1 ? 'Player1' : 'Player2'} ${skill.id} Active (${skill.activeDuration}s)`);

                    // Apply Buffs if any
                    this.applySkillBuff(skill, caster, activeBuffs);
                } else {
                    // Instant Skill: Cooldown Immediately
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                    this.log('SKILL', `${caster.isPlayer1 ? 'Player1' : 'Player2'} ${skill.id} Used`);
                }
            } else if (skill.state === 'Active') {
                // Duration Countdown (Buffs etc.)
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;

                    // Remove Buffs
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

    private processActiveEffects(effects: ActiveSkillEffect[], caster: EntityState, target: EntityState, dt: number, isPlayer1: boolean) {
        // Process in reverse to allow removal
        for (let i = effects.length - 1; i >= 0; i--) {
            const effect = effects[i];

            if (effect.timer > 0) {
                effect.timer -= dt;
            } else {
                // Trigger Hit
                if (effect.hitsRemaining > 0) {
                    // Handle Damage
                    if (effect.damage) {
                        if (effect.isSingleTarget) {
                            // Single Target: Target the other player
                            if (!target.isDead) {
                                this.dealDamage(caster, target, effect.damage, true, false, true);
                            }
                        } else {
                            // AOE: Hit the other player (in PvP there's only one target)
                            if (!target.isDead) {
                                this.dealDamage(caster, target, effect.damage, isPlayer1, false, true);
                            }
                        }
                    }

                    // Handle Healing
                    if (effect.healAmount) {
                        caster.health = Math.min(caster.maxHealth, caster.health + effect.healAmount);
                    }

                    effect.hitsRemaining--;

                    if (effect.hitsRemaining > 0) {
                        effect.timer = effect.interval;
                    } else {
                        // Done
                        effects.splice(i, 1);
                    }
                } else {
                    effects.splice(i, 1);
                }
            }
        }
    }

    private processProjectiles(dt: number) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            const direction = proj.isPlayer1Source ? 1 : -1;
            proj.currentX += proj.speed * dt * direction;

            // Check if projectile reached target
            const reached = proj.isPlayer1Source
                ? proj.currentX >= proj.toX
                : proj.currentX <= proj.toX;

            if (reached) {
                // Find target and deal damage
                const target = proj.isPlayer1Source
                    ? (this.player2.isDead ? null : this.player2)
                    : (this.player1.isDead ? null : this.player1);

                if (target) {
                    this.dealDamage(
                        proj.isPlayer1Source ? this.player1 : this.player2,
                        target,
                        proj.damage,
                        proj.isPlayer1Source,
                        proj.isCrit,
                        false
                    );
                }
                this.projectiles.splice(i, 1);
            }
        }
    }

    private applySkillBuff(skill: SkillState, entity: EntityState, activeBuffs: ActiveBuff[]) {
        const bonusDmg = skill.bonusDamage || 0;
        const bonusHP = skill.bonusMaxHealth || 0;

        if (bonusDmg === 0 && bonusHP === 0) return;

        activeBuffs.push({
            skillId: skill.id,
            bonusDamage: bonusDmg,
            bonusMaxHealth: bonusHP
        });

        // Update entity stats
        entity.damage += bonusDmg;

        // Health Buffs increase Max Health and heal for that amount
        if (bonusHP > 0) {
            entity.maxHealth += bonusHP;
            entity.health += bonusHP;
        }

        this.log('BUFF_APPLIED', `${entity.isPlayer1 ? 'Player1' : 'Player2'} ${skill.id}: +${bonusDmg.toFixed(0)} Dmg, +${bonusHP.toFixed(0)} MaxHP`);
    }

    private removeSkillBuff(skillId: string, entity: EntityState, activeBuffs: ActiveBuff[]) {
        const buffIndex = activeBuffs.findIndex(b => b.skillId === skillId);
        if (buffIndex === -1) return;

        const buff = activeBuffs[buffIndex];
        activeBuffs.splice(buffIndex, 1);

        // Update entity stats
        entity.damage -= buff.bonusDamage;

        // Remove Max Health bonus
        if (buff.bonusMaxHealth > 0) {
            entity.maxHealth -= buff.bonusMaxHealth;
            // Clamp Health if it exceeds new Max
            if (entity.health > entity.maxHealth) {
                entity.health = entity.maxHealth;
            }
        }

        this.log('BUFF_EXPIRED', `${entity.isPlayer1 ? 'Player1' : 'Player2'} ${skillId}: Buff removed`);
    }

    private processMovementAndCombat(attacker: EntityState, target: EntityState, dt: number): void {
        if (attacker.isDead || target.isDead) return;

        const distance = Math.abs(attacker.position - target.position);
        const inRange = distance <= attacker.attackRange;

        if (!inRange) {
            // MOVING
            attacker.combatState = 'MOVING';
            if (attacker.isPlayer1) {
                attacker.position += PLAYER_SPEED * dt;
            } else {
                attacker.position -= PLAYER_SPEED * dt;
            }
            attacker.combatPhase = 'IDLE';
        } else {
            // FIGHTING
            attacker.combatState = 'FIGHTING';
            this.processEntityCombat(attacker, target, dt);
        }
    }

    private processEntityCombat(entity: EntityState, target: EntityState, dt: number) {
        // Speed Multiplier (applies to the entire attack cycle)
        const speedMult = Math.max(0.1, entity.attackSpeed);

        // Calculate Effective Times
        const windup = entity.baseWindupTime || 0.5;
        const duration = entity.attackDuration || 1.5;

        // Scale both with speedMult
        const effectiveWindup = windup / speedMult;
        const effectiveDuration = duration / speedMult;
        const effectiveRecovery = Math.max(0.01, effectiveDuration - effectiveWindup);

        // State Machine
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

                        // Double Damage Check
                        if (!entity.pendingDoubleHit &&
                            Math.random() < entity.doubleDamage) {
                            if (!target.isDead) {
                                this.log('DOUBLE_DAMAGE', `${entity.isPlayer1 ? 'Player1' : 'Player2'} Double Damage Proc!`);
                                this.performAttack(entity, target, true);
                                this.log('DOUBLE_HIT', `${entity.isPlayer1 ? 'Player1' : 'Player2'} Second Strike!`);
                            }
                        }

                        // Transition to Recovery
                        entity.combatPhase = 'RECOVERING';
                        entity.isWindingUp = false;
                        entity.windupTimer = 0;
                        entity.recoveryTimer = effectiveRecovery;
                    } else {
                        // Out of Range: Hold Charge
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
            this.log(isCrit ? 'CRIT' : 'ATTACK', `${attacker.isPlayer1 ? 'Player1' : 'Player2'} Attack ${isCrit ? '(CRITICAL!)' : ''}`);
        }

        // For ranged units, create a projectile instead of instant damage
        if (attacker.isRanged && attacker.projectileSpeed && attacker.projectileSpeed > 0) {
            this.projectiles.push({
                id: this.projectileIdCounter++,
                fromX: attacker.position,
                toX: target.position,
                currentX: attacker.position,
                speed: attacker.projectileSpeed,
                isPlayer1Source: attacker.isPlayer1,
                damage: dmg,
                targetId: target.id,
                isCrit: isCrit
            });
        } else {
            // Melee: instant damage
            this.dealDamage(attacker, target, dmg, attacker.isPlayer1, isCrit);
        }
    }

    private dealDamage(attacker: EntityState, target: EntityState, amount: number, isPlayer1Source: boolean, _isCrit: boolean, isSkillDamage: boolean = false) {
        // Apply Shield / Flat Damage Reduction
        let finalDamage = amount;
        if (target.shield > 0) {
            finalDamage = Math.max(0, amount - target.shield);
        }

        if (finalDamage <= 0) {
            return;
        }

        // Block Logic
        if (Math.random() < target.blockChance) {
            // Blocked!
            this.log('BLOCKED', `${target.isPlayer1 ? 'Player1' : 'Player2'} blocked damage!`);
            return;
        }

        // Calculate actual damage dealt (capped by remaining health)
        const damageDealt = Math.min(finalDamage, target.health);

        if (isPlayer1Source) {
            this.totalPlayer1DamageDealt += damageDealt;
        } else {
            this.totalPlayer2DamageDealt += damageDealt;
        }

        target.health -= finalDamage;

        // Log Damage
        this.log(target.isPlayer1 ? 'DMG_TAKEN' : 'DMG_DEALT', `${finalDamage.toFixed(0)} damage to ${target.isPlayer1 ? 'Player1' : 'Player2'}`);

        // Lifesteal
        if (!isSkillDamage) {
            const lifesteal = attacker.lifesteal * finalDamage;

            if (lifesteal > 0) {
                const prevHp = attacker.health;
                attacker.health = Math.min(attacker.maxHealth, attacker.health + lifesteal);
                const actualHeal = attacker.health - prevHp;

                if (actualHeal > 0) {
                    this.log('LIFESTEAL', `${attacker.isPlayer1 ? 'Player1' : 'Player2'} +${actualHeal.toFixed(0)} HP (${(attacker.lifesteal * 100).toFixed(1)}% of ${finalDamage.toFixed(0)})`);
                }
            }
        }

        if (target.health <= 0) {
            target.isDead = true;
            target.health = 0;
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
            player1ActiveEffects: this.player1ActiveEffects.map(e => ({ ...e })),
            player2ActiveEffects: this.player2ActiveEffects.map(e => ({ ...e })),
            player1ActiveBuffs: this.player1ActiveBuffs.map(b => ({ ...b })),
            player2ActiveBuffs: this.player2ActiveBuffs.map(b => ({ ...b })),
            projectiles: this.projectiles.map(p => ({ ...p })),
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
    weaponLibrary?: any,
    pvpBaseConfig?: any,
    mountUpgradeLibrary?: any,
    petLibrary?: any,
    petBalancingLibrary?: any
): PvpPlayerStats {
    let weaponInfo: WeaponInfo | undefined;
    if (enemyConfig.weapon && weaponLibrary) {
        const weaponKey = `{'Age': ${enemyConfig.weapon.age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.weapon.idx}}`;
        weaponInfo = weaponLibrary[weaponKey];
    }

    const passives = enemyConfig.passiveStats || {};
    // Base multipliers from passives
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

    // Collect secondary stats from Pets (all slots) and Mount
    const collectSecondary = (statId: string, value: number) => {
        // Values from Pet/Mount are typically in percentage points (e.g. 10.5) or 0-1 depending on source
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
        enemyConfig.pets.forEach((pet: PetSlot | null) => {
            if (pet && pet.secondaryStats) {
                pet.secondaryStats.forEach((s: any) => collectSecondary(s.statId, s.value));
            }
        });
    }

    if (enemyConfig.mount && enemyConfig.mount.secondaryStats) {
        // Mount stats might need normalization check, but assuming consistent with Profile now
        enemyConfig.mount.secondaryStats.forEach((s: any) => collectSecondary(s.statId, s.value));
    }

    // Process skills
    const skills: PvpSkillConfig[] = (enemyConfig.skills || [])
        .filter((s: any) => s !== null)
        .map((s: any) => {
            const mechanics = SKILL_MECHANICS[s.id] || { count: 1 };

            // The damage/health values from enemy config are the description values
            // The description value can be per-hit or total depending on what the description says
            // We use descriptionIsPerHit to determine if the entered value is per-hit or total
            const damageIsPerHit = mechanics.descriptionIsPerHit || false;

            return {
                id: s.id,
                damage: s.damage,
                health: s.health,
                cooldown: s.cooldown,
                duration: s.duration,
                hasDamage: s.hasDamage,
                hasHealth: s.hasHealth,
                count: mechanics.count || 1,
                damageIsPerHit: damageIsPerHit
            };
        });

    // Calculate Pet HP (Sum of all active pets)
    let calculatedPetHp = 0;
    if (enemyConfig.pets && petLibrary && petBalancingLibrary) {
        enemyConfig.pets.forEach((pet: PetSlot | null) => {
            if (pet) {
                if (pet.hp && pet.hp > 0) {
                    calculatedPetHp += pet.hp;
                } else if (pet.id !== undefined && petLibrary && petBalancingLibrary) {
                    // Fix: PetLibrary keys are complex stringified JSON
                    const key = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
                    const petData = petLibrary[key];

                    if (petData) {
                        const petBalancingData = petBalancingLibrary[petData.Type];
                        if (petBalancingData) {
                            const levelIdx = Math.max(0, pet.level - 1);
                            const baseHp = petBalancingData.BaseHealthPerLevel?.[levelIdx] || 0;
                            const hpPerRarity = petBalancingData.HealthPerRarity?.[petData.Rarity] || 0;
                            calculatedPetHp += (baseHp + hpPerRarity);
                        }
                    }
                }
            }
        });
    }

    // Recalculate Mount Multipliers from scratch if Mount is selected
    let mountHealthMulti = 0;
    let mountDamageMulti = 0; // Not used for HP but good to know

    if (enemyConfig.mount) {
        // If manual HP % is provided (user input), use it directly
        if (enemyConfig.mount.hp && enemyConfig.mount.hp > 0) {
            mountHealthMulti = enemyConfig.mount.hp / 100;
        } else if (mountUpgradeLibrary) {
            // Fallback to Library calculation based on Level
            const upgradeData = mountUpgradeLibrary[enemyConfig.mount.rarity];
            if (upgradeData?.LevelInfo) {
                const levelIdx = Math.max(0, enemyConfig.mount.level - 1);
                const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];
                if (levelInfo?.MountStats?.Stats) {
                    for (const stat of levelInfo.MountStats.Stats) {
                        const statType = stat.StatNode?.UniqueStat?.StatType;
                        const value = stat.Value || 0;
                        if (statType === 'Health') mountHealthMulti += value;
                        if (statType === 'Damage') mountDamageMulti += value;
                    }
                }
            }
        }
    }

    // PvP Multipliers
    const pvpHpBaseMulti = Math.max(2.0, pvpBaseConfig?.PvpHpBaseMultiplier ?? 2.0);
    const pvpHpPetMulti = pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5;
    const pvpHpMountMulti = pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0;

    // We assume enemyConfig.stats.hp is the derived Total Health from a profile or manual input
    // If it comes from a Profile import, it is the Final Total Health.
    // If manual, it's just a number.
    // We need to reverse-engineer components to apply PvP multipliers correctly.
    // We assume the user creates a "valid" snapshot.

    // Reverse Engineering:
    // TotalHP = (Base + Pet) * (1 + MountMulti + HealthMulti)
    // Note: HealthMulti from secondary stats is additive to MountMulti in the formula usually?
    // In StatEngine: (Base + Pet) * (1 + MountMulti + SecondaryHealthMulti) NO, separate?
    // Verify.tsx formula: totalHealth = (base + items + pet + skillPassive) * (1 + mountHealthMulti + secondaryHealthMulti)

    // So:
    // PvpTotal = (Base * PvpBaseMulti + Pet * PvpPetMulti) * (1 + MountMulti * PvpMountMulti + SecondaryHealthMulti)

    // We have `enemyConfig.stats.hp` (Original Total).
    // We have `mountHealthMulti` and `healthMulti` (Secondary).
    // We need `PetHP` (Flat).
    // If we have `petLibrary`, we can calculate PetHP. If not, we fall back to 0 or estimates.

    // PROBLEM: I didn't add petUpgradeLibrary to signature.
    // I can't calculate Pet HP accurately without it.
    // I will assume `enemyConfig.stats.hp` is broken down if we want full accuracy,
    // but here we only have the Total.

    // Update: I will just use `enemyConfig.stats.hp` as the "Base + Items + Pet" block if I can't separate them?
    // OR I treat `enemyConfig.stats.hp` as "Base + Items" and I add Pet on top if Pet is selected?
    // In `EnemyBuilder`, the input says "Total Health".
    // If I select a Pet, does "Total Health" update?
    // Typically "Total Health" in builder is a manual override or result of import.
    // If I import, I have the breakdown.

    // Let's look at `profileToEnemyConfig` which I will modify next.
    // I can store `baseHealth` (Base+Items) and `petHealth` separately in `EnemyConfig`?
    // The current `EnemyConfig.stats` has `hp`.
    // I will use `enemyConfig.stats.hp` as "Base Player + Items Health" (User Input).
    // And I will Calculate Pet HP from the selected Pet and ADD it.
    // This separates them clearly.

    // But `profileToEnemyConfig` currently sets `stats.hp` to `totalHealth`.
    // I should change `profileToEnemyConfig` to set `stats.hp` to `totalHealth - petHealth`?
    // Or add a new field `baseHp`.
    // Let's stick to `stats.hp` = "Base + Items".

    // So for Pet HP calculation:
    // I need `petUpgradeLibrary`. I will ADD it to signature in a separate edit if needed,
    // or just assume `petLibrary` contains what I need (it doesn't, it has Type).
    // Actually, I can allow `enemyConfigToPvpStats` to take an extra arg `petUpgradeLibrary`.

    // For this step, I will use `any` for extra libs and assume they are passed.

    // Recalculate Pet HP
    // We need petUpgradeLibrary to be passed in... I'll check if I can add it to signature.
    // The signature change is what I am doing now.

    // Let's assume petUpgradeLibrary IS passed as the last arg (I'll add it).

    // The `enemyConfig.stats.hp` is the total HP from the enemy config.
    // We need to deconstruct it to apply PvP multipliers correctly.
    // Original formula: totalHealth = (basePlayerHealth + itemHealth + petHealth + skillPassiveHealth) * (1 + mountHealthMulti + secondaryHealthMulti)
    // We have `enemyConfig.stats.hp` as the `totalHealth`.
    // We have `calculatedPetHp` (from pet object) and `mountHealthMulti` (from mount object).
    // We also have `healthMulti` from secondary stats.

    // Let's assume `enemyConfig.stats.hp` is the total HP *before* applying the mount health multiplier and secondary health multiplier.
    // This means `enemyConfig.stats.hp` = (basePlayerHealth + itemHealth + petHealth + skillPassiveHealth)
    // This is a change from the previous interpretation where `enemyConfig.stats.hp` was the full total.
    // This makes more sense for the EnemyBuilder where the user inputs a "Base HP" and then selects pet/mount.

    // So, `baseAndPetHp` = `enemyConfig.stats.hp` (which is base + items + skillPassive) + `calculatedPetHp`
    // calculatedPetHp gets its own multiplier.
    // Reverse-Engineer Base HP (Player + Items + SkillPassives)
    // The UI input 'enemyConfig.stats.hp' is treated as Total Health (Base + Pets) * (1 + Mount + Secondary)
    // We need to strip it down to Base HP to apply PVP multipliers correctly.

    // 1. Calculate Effective Health Multiplier
    // Note: HealthMulti from secondary stats is already summed in `healthMulti` variable above
    // Mount Health Multiplier is `mountHealthMulti`
    const effectiveHealthMulti = 1 + mountHealthMulti + healthMulti;

    // 2. Calculated Pet HP is `calculatedPetHp`

    // 3. Derived Base HP
    // Total = (Base + Pet) * Multi
    // Base = (Total / Multi) - Pet
    const inputTotalHp = enemyConfig.stats.hp || 10000;
    let derivedBaseHp = (inputTotalHp / Math.max(1, effectiveHealthMulti)) - calculatedPetHp;
    derivedBaseHp = Math.max(0, derivedBaseHp);

    // 4. Apply PVP Multipliers
    const pvpBaseHp = derivedBaseHp * pvpHpBaseMulti;
    const pvpPetHp = calculatedPetHp * pvpHpPetMulti;
    const pvpCombinedHp = pvpBaseHp + pvpPetHp;

    const pvpMountHealthMulti = mountHealthMulti * pvpHpMountMulti;

    // Final PvP HP = (pvpCombinedHp) * (1 + pvpMountHealthMulti + healthMulti)
    const pvpTotalHp = pvpCombinedHp * (1 + pvpMountHealthMulti + healthMulti);



    return {
        hp: Math.max(1, pvpTotalHp), // Ensure at least 1 HP
        damage: enemyConfig.stats.damage,
        attackSpeed: 1.0 + attackSpeedBonus,
        weaponInfo,
        isRanged: weaponInfo ? (weaponInfo.AttackRange ?? 0) > 1.0 : false,
        projectileSpeed: 10,
        critChance,
        critMulti,
        blockChance,
        lifesteal,
        doubleDamage,
        healthRegen,
        damageMulti,
        healthMulti,
        skillDamageMulti,
        skillCooldownMulti,
        skills
    };
}

export function aggregatedStatsToPvpStats(
    stats: any,
    equippedSkills: any[],
    skillLibrary: any,
    pvpBaseConfig?: any
): PvpPlayerStats {
    const skills: PvpSkillConfig[] = equippedSkills.map(skill => {
        const skillData = skillLibrary?.[skill.id];
        const levelIdx = Math.max(0, skill.level - 1);

        let baseDamage = skillData?.DamagePerLevel?.[levelIdx] || 0;
        let baseHealth = skillData?.HealthPerLevel?.[levelIdx] || 0;

        const skillFactor = stats.skillDamageMultiplier || 1;
        const globalFactor = stats.damageMultiplier || 1;
        const mountFactor = stats.mountDamageMulti || 0;
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

    // Calculate PvP HP with multipliers
    // stats.totalHealth = (basePlayerHealth + itemHealth + petHealth + skillPassiveHealth) * (1 + mountHealthMulti + secondaryHealthMulti)
    // We have access to the breakdown from stats object

    // Get PvP multipliers from config (defaults if not provided)


    // Deconstruct Total Stats (User Input) into Components for PVP Multipliers
    // Formula: Total = (Base + Items + SkillPassive + Pets) * (1 + Mount% + Secondary%)
    // But wait, Pets are usually additive AFTER Mount% in some games, but here they seem additive BEFORE?
    // Let's check StatEngine.ts:
    // totalHealth = (basePlayerHealth + itemHealth + skillPassiveHealth + petHealth) * healthMultiplier
    // healthMultiplier = (1 + mountHealthMulti + secondaryHealthMulti)

    // So: BaseComponent = Total / Multipliers - PetHP

    // 1. Calculate Multipliers
    let mountHealthPct = stats.mountHealthMulti || 0;

    // Secondary Stats from Passive Stats configuration
    // For Player (stats), secondary stats are already included in health/damage multipliers 
    // unless we want to separate them?
    // StatEngine aggregates (1 + Mount + Secondary) into `healthMultiplier`.
    // We can extract Secondary if we assume `healthMultiplier` = `1 + mountHealthPct + secHealthMulti`.
    // So secHealthMulti = healthMultiplier - 1 - mountHealthPct.
    let secHealthMulti = (stats.healthMultiplier || 1) - 1 - mountHealthPct;
    secHealthMulti = Math.max(0, secHealthMulti);

    // 2. Sum Active Pet HP
    let totalPetHp = stats.petHealth || 0;

    // 3. Derived Base HP (Base + Items + Skill Passives)
    // Avoid division by zero
    const effectiveMulti = Math.max(1, stats.healthMultiplier || 1);
    const inputTotalHp = stats.totalHealth || 10000;
    let derivedBaseHp = (inputTotalHp / effectiveMulti) - totalPetHp;
    derivedBaseHp = Math.max(0, derivedBaseHp);

    // 4. Apply PVP Multipliers
    const pvpHpBaseMulti = Math.max(2.0, pvpBaseConfig?.PvpHpBaseMultiplier ?? 2.0);
    const pvpHpPetMulti = pvpBaseConfig?.PvpHpPetMultiplier ?? 0.5;
    const pvpHpMountMulti = pvpBaseConfig?.PvpHpMountMultiplier ?? 2.0;

    const pvpBaseHp = derivedBaseHp * pvpHpBaseMulti;
    const pvpPetHp = totalPetHp * pvpHpPetMulti;
    const pvpCombinedHp = pvpBaseHp + pvpPetHp;

    const pvpMountHealthMulti = mountHealthPct * pvpHpMountMulti;

    const pvpTotalHp = pvpCombinedHp * (1 + pvpMountHealthMulti + secHealthMulti);



    return {
        hp: Math.round(Math.max(1, pvpTotalHp)),
        damage: stats.totalDamage, // TODO: Apply similar logic for Damage if needed
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

export function profileToEnemyConfig(profile: any, libs: any): EnemyConfig {
    const engine = new StatEngine(profile, libs);
    const stats = engine.calculate();
    const techModifiers = engine.getTechModifiers();

    // Ensure we have 3 slots for pets and pre-calculate HP
    const pets: (PetSlot | null)[] = [null, null, null];
    if (profile.pets?.active) {
        profile.pets.active.forEach((p: PetSlot, i: number) => {
            if (i < 3) {
                // Calculate Pet HP using PetUpgradeLibrary (matching StatEngine logic)
                let petHp = 0;
                if (libs.petUpgradeLibrary && libs.petLibrary) {
                    // Check key format - try both ID and JSON key
                    let petData = libs.petLibrary[p.id];
                    if (!petData) {
                        const key = `{'Rarity': '${p.rarity}', 'Id': ${p.id}}`;
                        petData = libs.petLibrary[key];
                    }

                    if (petData) {
                        const upgradeData = libs.petUpgradeLibrary[p.rarity];
                        if (upgradeData?.LevelInfo) {
                            const levelIdx = Math.max(0, p.level - 1);
                            const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];

                            if (levelInfo?.PetStats?.Stats) {
                                const petType = petData.Type || 'Balanced';
                                const typeMulti = libs.petBalancingLibrary?.[petType]?.HealthMultiplier || 1;
                                const petHealthBonus = techModifiers['PetBonusHealth'] || 0;

                                for (const stat of levelInfo.PetStats.Stats) {
                                    const statType = stat.StatNode?.UniqueStat?.StatType;
                                    let value = stat.Value || 0;

                                    if (statType === 'Health') {
                                        value *= typeMulti;
                                        value *= (1 + petHealthBonus);
                                        petHp += value;
                                    }
                                }
                            }
                        }
                    }
                }

                pets[i] = { ...p, hp: Math.round(petHp) };
            }
        });
    }

    const config: EnemyConfig = {
        name: profile.name,
        weapon: profile.items.Weapon || null,
        skills: profile.skills.equipped.map((skill: any) => {
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
            hp: stats.totalHealth, // Use Total Health as the value (EnemyBuilder shows this)
            damage: stats.totalDamage,
            power: stats.power
        },
        passiveStats: initPassiveStats(),
        pets: pets,
        mount: (() => {
            const m = profile.mount?.active;
            if (!m) return null;

            // Calculate Mount HP %
            let hpPercent = 0;
            if (libs.mountUpgradeLibrary) {
                const upgradeData = libs.mountUpgradeLibrary[m.rarity];
                if (upgradeData?.LevelInfo) {
                    const levelIdx = Math.max(0, m.level - 1);
                    const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];
                    if (levelInfo?.MountStats?.Stats) {
                        for (const stat of levelInfo.MountStats.Stats) {
                            const statType = stat.StatNode?.UniqueStat?.StatType;
                            const value = stat.Value || 0;
                            if (statType === 'Health') hpPercent += value;
                        }
                    }
                }
            }

            // Apply Tech Tree Bonus (from correct imported profile tree)
            const mountHpBonus = techModifiers['MountHealth'] || 0;
            hpPercent = hpPercent * (1 + mountHpBonus);

            return { ...m, hp: parseFloat((hpPercent * 100).toFixed(2)) };
        })()
    };

    const setPassive = (type: PassiveStatType, val: number | undefined) => {
        if (val && val > 0) {
            config.passiveStats[type] = {
                enabled: true,
                value: parseFloat((val * 100).toFixed(2))
            };
        }
    };

    // Note: We need to subtract stats that come from Pet/Mount secondary stats 
    // because they are now handled by the Pet/Mount objects in EnemyConfig independently.
    // However, StatEngine aggregates everything.
    // For simplicity, we might just populate passiveStats with EVERYTHING and let the user adjust?
    // OR we rely on `initPassiveStats` + `setPassive` to capture "Extra" stats not covered by Pet/Mount?
    // Actually, `stats` from engine includes EVERYTHING.
    // If we put strict values derived from Pet/Mount into `config.pet` and `config.mount`,
    // then `enemyConfigToPvpStats` will re-add them.
    // So we risk double counting if `passiveStats` also includes them.
    // But `passiveStats` here (AttackSpeed etc) are calculated from totals.
    // We should probably subtract the Pet/Mount contributions if we want "Base + Items" passives only.
    // Or, much easier: WE DO NOT POPULATE `passiveStats` with total engine stats if we have explicit objects.
    // We should calculate `passiveStats` from `stats.secondaryStats` MINUS Pet/Mount stats?
    // That's complex.
    // Alternative: profileToEnemyConfig is a "Best Effort" import.
    // Let's populate the TOTALS in passiveStats and verify.
    // Wait, `enemyConfigToPvpStats` ADDS `passiveStats` + `pet.secondaryStats`.
    // So if I put total in `passiveStats`, and `pet` also has them, they get doubled.
    // I should probably NOT populate `passiveStats` with aggregated totals if I can help it?
    // But then I lose Item/TechTree stats.

    // Solution:
    // `stats` object has final totals.
    // I should reconstruct `passiveStats` from `stats` MINUS `pet` and `mount` contributions.
    // StatEngine keeps them separate internally in `secondaryStats` but collects them all.
    // Actually, StatEngine doesn't expose the breakdown of secondary stats by source easily 
    // (it's local vars in `collectAllSecondaryStats`).

    // Compromise:
    // Set `passiveStats` to ONLY include `Additional / Tech Tree` stats if possible?
    // Or just import EVERYTHING into `passiveStats` and set `pet`/`mount` to NULL?
    // The user WANTS to see Pet/Mount selectors.
    // So I should populate Pet/Mount.
    // Then I should try to remove their stats from `passiveStats`.

    // Calculate deductions to subtract Pet/Mount secondary stats from global totals
    const deductions: Record<string, number> = {};
    const addDeduction = (statsArr: any[]) => {
        if (!statsArr) return;
        statsArr.forEach(s => {
            deductions[s.statId] = (deductions[s.statId] || 0) + (s.value / 100);
        });
    }

    if (profile.pets?.active) profile.pets.active.forEach((p: any) => addDeduction(p.secondaryStats));
    if (profile.mount?.active?.secondaryStats) addDeduction(profile.mount.active.secondaryStats);

    // Helper to get net value (Engine Total - Deductions)
    const getNetValue = (statId: string, totalEngineValue: number, isMulti: boolean = false) => {
        // isMulti means engine is 1.5 for +50%. deduction is 0.5.
        // If isMulti, base is 1.0.
        // setPassive takes a "0.5" for 50%.

        const rawVal = isMulti ? totalEngineValue - 1 : totalEngineValue;
        const deduction = deductions[statId] || 0;
        return Math.max(0, rawVal - deduction);
    };

    setPassive('CriticalChance', getNetValue('CriticalChance', stats.criticalChance));
    setPassive('CriticalMulti', getNetValue('CriticalMulti', stats.criticalDamage, true));
    setPassive('BlockChance', getNetValue('BlockChance', stats.blockChance));
    setPassive('HealthRegen', getNetValue('HealthRegen', stats.healthRegen));
    setPassive('LifeSteal', getNetValue('LifeSteal', stats.lifeSteal));
    setPassive('DoubleDamageChance', getNetValue('DoubleDamageChance', stats.doubleDamageChance));
    setPassive('SkillDamageMulti', getNetValue('SkillDamageMulti', stats.skillDamageMultiplier, true));
    setPassive('SkillCooldownMulti', getNetValue('SkillCooldownMulti', stats.skillCooldownReduction));
    setPassive('AttackSpeed', getNetValue('AttackSpeed', stats.attackSpeedMultiplier, true));

    // Explicitly handle DamageMulti/HealthMulti if they exist in StatEngine as explicit fields?
    // StatEngine puts them in `secondaryStats`. But `calculate()` returns `AggregatedStats` which doesn't expose `secondaryStats` object directly,
    // but it merges them into `damageMultiplier`?
    // `damageMultiplier` in AggregatedStats is the final combined one?
    // Let's look at `finalizeCalculation` in `StatEngine`.
    // It says: this.stats.damageMultiplier = (1 + this.secondaryStats.damageMulti) * ...
    // So we can extract it if we want, or just assume the profile Import is for "Additional" stats.

    // For now, I'll stick to the explicit fields I mapped.

    return config;
}
