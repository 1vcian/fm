import type { AggregatedStats } from './statEngine.ts';
import type { WeaponInfo } from './BattleHelper';

// --- Types ---

export interface SimulationConfig {
    timeStep: number; // Seconds per tick (e.g. 0.05)
    maxDuration: number; // Max battle duration (e.g. 120s)
}

export interface EntityState {
    id: number;
    isPlayer: boolean;
    health: number;
    maxHealth: number;
    damage: number;
    shield: number; // Flat damage reduction from skills (e.g. Morale)

    // Weapon Stats
    attackSpeed: number; // Attacks per second
    baseWindupTime: number; // Base windup time from weapon
    attackDuration: number; // NEW: Base delay before attack hits
    windupTimer: number; // Current windup progress
    recoveryTimer: number; // Post-attack delay
    isWindingUp: boolean; // Kept for legacy compatibility if needed, but we will use combatPhase
    combatPhase: 'IDLE' | 'CHARGING' | 'RECOVERING'; // NEW: Explicit phase tracking
    pendingDoubleHit: boolean; // Tracks if we need to do a second hit after current windup

    // Movement / Range
    isRanged: boolean;
    projectileSpeed?: number;
    attackRange: number; // Cached effective range
    position: number;   // 0 to 10
    combatState: 'MOVING' | 'FIGHTING';

    // Visual (for modal display)
    weaponSpriteKey?: string; // e.g. "0_5_0" for weapon lookup in AutoItemMapping

    // Status
    isDead: boolean;
}

export interface SkillState {
    id: string; // "Meat", "Shout", etc.
    activeDuration: number; // From JSON
    cooldown: number; // From JSON

    // State
    state: 'Startup' | 'Ready' | 'Active' | 'Cooldown';
    timer: number;

    // Stats for processing (Static config)
    damage?: number;
    healAmount?: number;
    isBuff?: boolean;

    // Buff amounts (flat values added during Active state)
    bonusDamage?: number;    // Added to player damage during Active
    bonusMaxHealth?: number; // Added to player maxHealth during Active

    // Multi-hit Logic (Config)
    count?: number; // Total hits per activation
    hitsRemaining?: number; // Legacy? Keep for config
    interval?: number; // Time between repeated hits
    delay?: number; // Initial delay before FIRST hit
}

export interface ActiveSkillEffect {
    id: string;
    damage?: number;
    healAmount?: number;
    count: number;
    hitsRemaining: number;
    interval: number;
    timer: number;
    isSingleTarget?: boolean; // If true, target nearest and re-target on kill
    isAOE?: boolean; // If true, hit all enemies
}

// Tracks active duration-based buffs
export interface ActiveBuff {
    skillId: string;
    bonusDamage: number;     // Extra damage added
    bonusMaxHealth: number;  // Extra max health added
}

export interface EnemyConfig {
    id: number;
    hp: number;
    dmg: number;
    weaponInfo: WeaponInfo | null;
    projectileSpeed: number;
    weaponSpriteKey?: string; // e.g. "0_5_0" for AutoItemMapping lookup
}

export interface BattleLogEntry {
    time: number;
    event: string;
    details: string;
}

// Visual projectile for rendering
export interface Projectile {
    id: number;
    fromX: number;  // Start position (0-10)
    toX: number;    // Target position (0-10)
    currentX: number; // Current position
    speed: number;  // Units per second
    isPlayerSource: boolean;
    damage: number;
    targetId: number;
    isCrit: boolean; // Track if this was a critical hit
}

export interface DebugConfig {
    skillStartupTimer?: number;
    enemySpawnDistance?: number;
    enemySpawnDistanceNext?: number;
    fieldWidth?: number;

    walkingSpeed?: number; // Legacy, kept for compatibility if needed, but we prefer specific
    playerSpeed?: number;
    enemySpeed?: number;
    playerStartPos?: number;
    playerRangeMultiplier?: number;
}

export class BattleEngine {
    public time: number = 0;
    private player: EntityState;
    private currentWaveEnemies: EntityState[] = [];
    private nextWaveQueue: EnemyConfig[][] = [];
    private skills: SkillState[] = [];
    private activeEffects: ActiveSkillEffect[] = [];
    private activeBuffs: ActiveBuff[] = []; // Tracks active duration-based buffs
    private logs: BattleLogEntry[] = [];
    private projectiles: Projectile[] = []; // Visual projectiles in flight
    private projectileIdCounter: number = 0;

    // Stats Tracking
    private totalPlayerDamageDealt: number = 0;
    private totalEnemyMaxHp: number = 0;

    // Continuous Battle State
    private waveIndex: number = 0;
    private PLAYER_SPEED: number;
    private ENEMY_SPEED: number;
    private readonly ENEMY_SPAWN_DISTANCE: number;
    private readonly ENEMY_SPAWN_DISTANCE_NEXT: number;
    private readonly WAVE_TIMER_DELAY = 1.0; // 1 second delay between waves
    private waveTimer: number = 0; // Timer for wave transitions
    private readonly SECONDS_TO_FULLY_REGENERATE = 1.0; // From BaseConfig.json

    // Legacy/Unused but kept for strict compatibility if needed, though strictly we are removing them
    // private waveEngagementTimer: number = 0; 
    // private engagementTime: number = 5.0; 
    // private isEngaged: boolean = false;
    private regenSnapshotTimer: number = 0;
    private currentRegenRate: number = 0; // Amount per second, calculated at snapshot
    private initialHealth: number = 0; // Base health at battle start (for regen calculation)

    private config: SimulationConfig = {
        timeStep: 1 / 60, // 60 FPS (~0.0166s) - Matches game frame rate
        maxDuration: 999999
    };

    private playerStats: AggregatedStats;
    private debugConfig?: DebugConfig;

    constructor(playerStats: AggregatedStats, debugConfig?: DebugConfig) {
        this.playerStats = playerStats;
        this.debugConfig = debugConfig;

        // Speed Config (Default 4.0)
        this.PLAYER_SPEED = debugConfig?.playerSpeed ?? debugConfig?.walkingSpeed ?? 4.0;
        this.ENEMY_SPEED = debugConfig?.enemySpeed ?? debugConfig?.walkingSpeed ?? 4.0;

        // Configurable Spawn Distances
        // Request: "Actual Width: 28" (Unused variable removed)

        // Scaling Factor: Removed as per request ("senza fattori")
        // We use raw values directly.

        // Spawn distance uses fieldWidth relative to player
        // Request: "Spawn Dist: 21"
        this.ENEMY_SPAWN_DISTANCE = debugConfig?.enemySpawnDistance ?? 21.0;
        // Request: "Next: 28"
        this.ENEMY_SPAWN_DISTANCE_NEXT = debugConfig?.enemySpawnDistanceNext ?? 28.0;

        // Initialize Player
        // Request: "Player Start: 2"
        const basePlayerPos = debugConfig?.playerStartPos ?? 2.0;
        const scaledPlayerPos = basePlayerPos; // No scaling

        // Range (Raw)
        const rangeMultiplier = debugConfig?.playerRangeMultiplier ?? 1.0;
        const basePlayerRange = playerStats.weaponAttackRange || 0.3;
        const scaledPlayerRange = basePlayerRange * rangeMultiplier; // Applied multiplier

        this.player = {
            id: -1,
            isPlayer: true,
            health: playerStats.totalHealth,
            maxHealth: playerStats.totalHealth, // This is the "Bar" max, stays constant
            damage: playerStats.totalDamage,
            shield: 0,
            attackSpeed: playerStats.attackSpeedMultiplier,
            baseWindupTime: playerStats.weaponWindupTime || 0.5,
            attackDuration: playerStats.weaponAttackDuration || 1.5,
            windupTimer: 0,
            recoveryTimer: 0,
            isWindingUp: false,
            combatPhase: 'IDLE',
            pendingDoubleHit: false,
            isRanged: playerStats.isRangedWeapon,
            projectileSpeed: playerStats.projectileSpeed, // Keep speed constant for now? Or scale? Usually speed is absolute.
            attackRange: scaledPlayerRange,
            position: scaledPlayerPos,
            combatState: 'MOVING',
            isDead: false
        };

        // Initialize Skills
        this.initializeSkills();
    }

    private initializeSkills() {
        // ... (No changes here, method is empty or specific logic)
    }

    public addSkill(skillConfig: Partial<SkillState>) {
        this.skills.push({
            id: skillConfig.id || "Unknown",
            activeDuration: skillConfig.activeDuration || 0,
            cooldown: skillConfig.cooldown || 10,
            state: 'Startup',
            timer: this.debugConfig?.skillStartupTimer ?? 3.2, // Default 3.2
            damage: skillConfig.damage,
            healAmount: skillConfig.healAmount,
            bonusDamage: skillConfig.bonusDamage,
            bonusMaxHealth: skillConfig.bonusMaxHealth,
            count: skillConfig.count,
            interval: skillConfig.interval,
            delay: skillConfig.delay
        });
    }

    private initializeRegen() {
        // Use INITIAL health (at battle start) for regen, ensuring buffs like Morale don't increase regen
        this.initialHealth = (this.playerStats.totalHealth && !isNaN(this.playerStats.totalHealth)) ? this.playerStats.totalHealth : 100;
        const regenMult = (this.playerStats.healthRegen && !isNaN(this.playerStats.healthRegen)) ? this.playerStats.healthRegen : 0;
        this.currentRegenRate = regenMult * this.initialHealth;
        this.regenSnapshotTimer = 0;
    }

    public setNextWaves(waves: EnemyConfig[][]) {
        this.nextWaveQueue = [...waves];
    }

    public startWave(enemies: EnemyConfig[]) {
        this.initializeRegen();

        this.currentWaveEnemies = enemies.map(e => {
            const duration = e.weaponInfo ? e.weaponInfo.AttackDuration : 1.7; // Default for weaponless enemies (measured in-game)
            const attackTime = duration || 1.7;
            const windupTime = e.weaponInfo?.WindupTime ?? 0.5;

            let range = 0.3; // Default Melee
            // Safe access for AttackRange with fallback
            const weaponRange = e.weaponInfo?.AttackRange;

            // Strict adherence to WeaponInfo if available
            if (weaponRange !== undefined && weaponRange !== null) {
                range = weaponRange;
            } else {
                // Fallback only if no weapon info
                range = 0.3;
            }

            // --- SCALE RANGE ---
            // --- SCALE RANGE ---
            // User Request: Range multiplier applies to both enemies and player equally
            // We remove the old fieldWidth scaling and use the debug multiplier.
            const rangeMultiplier = this.debugConfig?.playerRangeMultiplier ?? 1.0;
            range = range * rangeMultiplier;

            return {
                id: e.id,
                isPlayer: false,
                health: e.hp,
                maxHealth: e.hp,
                damage: e.dmg,
                shield: 0,
                attackSpeed: 1.0, // Logic changed: AttackSpeed is multiplier. For enemies, base is 1.0, times come from WeaponInfo.
                baseWindupTime: windupTime,
                attackDuration: attackTime, // Using attackTime as duration (was previously used as full cycle)
                windupTimer: 0,
                recoveryTimer: 0,
                isWindingUp: false,
                combatPhase: 'IDLE',
                pendingDoubleHit: false,
                isRanged: !!(e.weaponInfo && (e.weaponInfo.AttackRange ?? 0) > 1.0),
                projectileSpeed: e.projectileSpeed,
                weaponSpriteKey: e.weaponSpriteKey,
                attackRange: range,
                position: this.player.position + (this.waveIndex == 0 ? this.ENEMY_SPAWN_DISTANCE : this.ENEMY_SPAWN_DISTANCE_NEXT), // Spawn 15 units ahead of player
                combatState: 'MOVING',
                isDead: false
            };
        });

        // Track Total Enemy Max HP for stats
        enemies.forEach(e => {
            this.totalEnemyMaxHp += e.hp;
        });

        // Validates existing setup
        // Log Enemy Stats for Debug
        if (enemies.length > 0) {
            this.logs.push({
                time: this.time,
                event: 'WAVE_START',
                details: `Wave ${this.waveIndex + 1}: ${enemies.length} Enemies (HP: ${enemies[0].hp.toLocaleString()}, Dmg: ${enemies[0].dmg.toLocaleString()})`
            });
        }
    }

    public getSnapshot() {
        return {
            time: this.time,
            player: { ...this.player },
            enemies: this.currentWaveEnemies.map(e => ({ ...e })),
            skills: this.skills.map(s => ({ ...s })),
            activeEffects: this.activeEffects.map(e => ({ ...e })),
            activeBuffs: this.activeBuffs.map(b => ({ ...b })),
            projectiles: this.projectiles.map(p => ({ ...p })), // Expose projectiles for visualization
            logs: [...this.logs],
            // Legacy fields for visualizer compatibility
            isEngaged: this.player.combatState === 'FIGHTING',
            engagementTime: 5,
            waveEngagementTimer: 0,
            playerReachTime: 0,
            enemyReachTime: 0,
            playerStats: this.playerStats,
            remainingWaves: this.nextWaveQueue.length, // Expose this for visualizer victory check
            waveIndex: this.waveIndex // Current wave number for UI
        };
    }

    public tick(dt: number) {
        this.time += dt;

        // --- Passive Regen ---
        this.regenSnapshotTimer += dt;
        const healingStep = this.currentRegenRate * dt;
        if (healingStep > 0) {
            // Regeneration is capped by maxHealth (cannot regen into "buffed" over-health)
            if (this.player.health < this.player.maxHealth) {
                this.player.health = Math.min(this.player.maxHealth, this.player.health + healingStep);
            }
        }
        if (this.regenSnapshotTimer >= 1.0) {
            this.regenSnapshotTimer -= 1.0;
            // Refresh regen rate based on CURRENT maxHealth (affected by temporary buffs)
            // Formula: MaxHP * HealthRegenStat / TimeBase
            const baseRegen = this.playerStats.healthRegen || 0;
            this.currentRegenRate = (baseRegen * this.player.maxHealth) / this.SECONDS_TO_FULLY_REGENERATE;

            // Log Regen Event (if healing and not full)
            if (this.currentRegenRate > 0 && this.player.health < this.player.maxHealth) {
                this.logs.push({
                    time: this.time,
                    event: 'REGEN',
                    details: `+${this.currentRegenRate.toFixed(0)} HP/s`
                });
            }
        }

        // --- Skill System (Independent of everything) ---
        this.processSkills(dt);
        this.processActiveEffects(dt);
        this.processProjectiles(dt);

        // --- Player Movement & Combat ---
        if (!this.player.isDead) {
            let playerTarget: EntityState | null = null;

            // Find closest alive enemy in range
            // Sort by position (closest to player first)
            const sortedEnemies = this.currentWaveEnemies
                .filter(e => !e.isDead)
                .sort((a, b) => a.position - b.position);

            for (const enemy of sortedEnemies) {
                const dist = enemy.position - this.player.position;
                if (dist <= this.player.attackRange) {
                    playerTarget = enemy;
                    break; // Pick the first one (closest)
                }
            }

            if (playerTarget) {
                // FIGHTING
                this.player.combatState = 'FIGHTING';
                this.processEntityCombat(this.player, [playerTarget], dt);
            } else {
                // MOVING
                this.player.combatState = 'MOVING';
                this.player.position += this.PLAYER_SPEED * dt;
            }
        }

        // --- Enemy Movement & Combat ---
        this.currentWaveEnemies.forEach(enemy => {
            if (enemy.isDead) return;

            // Dist to player
            const dist = enemy.position - this.player.position;

            if (!this.player.isDead && dist <= enemy.attackRange) {
                // FIGHTING
                enemy.combatState = 'FIGHTING';
                this.processEntityCombat(enemy, [this.player], dt);
            } else {
                // MOVING
                enemy.combatState = 'MOVING';
                enemy.position -= this.ENEMY_SPEED * dt;
            }
        });

        // --- Wave Traversal / Next Wave Logic ---
        // Game uses WaveTimer: 1 second delay after wave cleared before next wave spawns
        const activeEnemies = this.currentWaveEnemies.filter(e => !e.isDead);

        if (activeEnemies.length === 0) {
            // All enemies dead - start wave timer if not already running
            if (this.waveTimer <= 0 && this.nextWaveQueue.length > 0) {
                this.waveTimer = this.WAVE_TIMER_DELAY; // Start 1 second countdown
            }
        }

        // Wave timer countdown
        if (this.waveTimer > 0) {
            this.waveTimer -= dt;
            // Player keeps walking during wave transition
            this.player.position += this.PLAYER_SPEED * dt;
            this.player.combatState = 'MOVING';

            if (this.waveTimer <= 0 && this.nextWaveQueue.length > 0) {
                // Timer expired - spawn next wave
                this.onWaveCleared();
            }
        }
    }

    private onWaveCleared() {
        if (this.nextWaveQueue.length > 0) {
            const nextWave = this.nextWaveQueue.shift()!;
            this.waveIndex++;
            this.startWave(nextWave);
            this.logs.push({
                time: this.time,
                event: 'WAVE_START',
                details: `Starting Wave ${this.waveIndex + 1} (Pos: ${this.player.position.toFixed(1)})`
            });
        }
    }

    public simulate(duration: number): { victory: boolean, time: number, log: BattleLogEntry[], remainingHp: number, totalDamageDealt: number, totalEnemyMaxHp: number } {
        const startChunkTime = this.time;
        const targetTime = Math.min(startChunkTime + duration, this.config.maxDuration);

        // Safety: Prevent infinite loops (max 90,000 ticks = 1500 seconds sim time at 60 FPS)
        let safeTickCount = 0;
        const MAX_SAFE_TICKS = 90000;

        while (this.time < targetTime) {
            safeTickCount++;
            if (safeTickCount > MAX_SAFE_TICKS) {
                console.warn("BattleEngine: Safe tick limit reached, aborting simulation.");
                break;
            }

            this.tick(this.config.timeStep);

            // Victory Check: No enemies left in current wave AND No more waves in Queue
            const activeEnemiesAlive = this.currentWaveEnemies.some(e => !e.isDead);
            const noMoreWaves = this.nextWaveQueue.length === 0;

            if (!activeEnemiesAlive && noMoreWaves) {
                // VICTORY
                return {
                    victory: true,
                    time: this.time,
                    log: this.logs,
                    remainingHp: this.player.health,
                    totalDamageDealt: this.totalPlayerDamageDealt,
                    totalEnemyMaxHp: this.totalEnemyMaxHp
                };
            }

            if (this.player.isDead) {
                // DEFEAT
                return {
                    victory: false,
                    time: this.time,
                    log: this.logs,
                    remainingHp: 0,
                    totalDamageDealt: this.totalPlayerDamageDealt,
                    totalEnemyMaxHp: this.totalEnemyMaxHp
                };
            }
        }

        // Time Limit Reached (or Safety Break) -> Defeat by timeout
        return {
            victory: false,
            time: this.time,
            log: this.logs,
            remainingHp: this.player.health,
            totalDamageDealt: this.totalPlayerDamageDealt,
            totalEnemyMaxHp: this.totalEnemyMaxHp
        };
    }

    /**
     * Advance time without combat (e.g. Wave Transition)
     */
    public advanceTime(dt: number) {
        // Deprecated, use tick()
        this.tick(dt);
    }

    private processSkills(dt: number) {
        this.skills.forEach(skill => {
            if (skill.state === 'Startup') {
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Ready';
                    skill.timer = 0;
                }
            } else if (skill.state === 'Ready') {
                // Activate Immediately

                // 1. Create Effect (Decoupled from Cooldown)
                const count = skill.count || 1;
                const interval = skill.interval || 0.1;

                // Only create active effect if there's damage or healing to do
                if (count > 0 && (skill.damage || skill.healAmount)) {
                    this.activeEffects.push({
                        id: skill.id,
                        damage: skill.damage,
                        healAmount: skill.healAmount,
                        count: count,
                        hitsRemaining: count,
                        interval: interval,
                        timer: skill.delay || 0,
                        isSingleTarget: (skill as any).isSingleTarget,
                        isAOE: (skill as any).isAOE
                    });
                }

                // 2. Handle State Transition
                if (skill.activeDuration && skill.activeDuration > 0) {
                    // Duration Skill: Active -> Cooldown
                    skill.state = 'Active';
                    skill.timer = skill.activeDuration;
                    this.logs.push({ time: this.time, event: 'SKILL', details: `${skill.id} Active (${skill.activeDuration}s)` });

                    // Apply Buffs if any
                    this.applySkillBuff(skill);
                } else {
                    // Instant Skill: Cooldown Immediately
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;
                    this.logs.push({ time: this.time, event: 'SKILL', details: `${skill.id} Used` });
                }

            } else if (skill.state === 'Active') {
                // Duration Countdown (Buffs etc.)
                skill.timer -= dt;
                if (skill.timer <= 0) {
                    skill.state = 'Cooldown';
                    skill.timer = skill.cooldown;

                    // Remove Buffs
                    this.removeSkillBuff(skill.id);
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

    private processActiveEffects(dt: number) {
        // Process in reverse to allow removal
        for (let i = this.activeEffects.length - 1; i >= 0; i--) {
            const effect = this.activeEffects[i];

            if (effect.timer > 0) {
                effect.timer -= dt;
            } else {
                // Trigger Hit
                if (effect.hitsRemaining > 0) {
                    // Handle Damage
                    if (effect.damage) {
                        if (effect.isSingleTarget) {
                            // Single Target: Find nearest alive enemy
                            const target = this.currentWaveEnemies
                                .filter(e => !e.isDead)
                                .sort((a, b) => a.position - b.position)[0];

                            if (target) {
                                this.dealDamage(target, effect.damage, true, false, true);
                            }
                            // If no target, hit is wasted (per user request)
                        } else {
                            // AOE: Hit all alive enemies
                            this.currentWaveEnemies.forEach(e => {
                                if (!e.isDead) this.dealDamage(e, effect.damage!, true, false, true);
                            });
                        }
                    }

                    // Handle Healing
                    if (effect.healAmount) {
                        this.player.health = Math.min(this.player.maxHealth, this.player.health + effect.healAmount);
                    }

                    effect.hitsRemaining--;

                    if (effect.hitsRemaining > 0) {
                        effect.timer = effect.interval;
                    } else {
                        // Done
                        this.activeEffects.splice(i, 1);
                    }
                } else {
                    this.activeEffects.splice(i, 1);
                }
            }
        }
    }

    private processEntityCombat(entity: EntityState, targets: EntityState[], dt: number) {
        // Speed Multiplier (applies to the entire attack cycle)
        const speedMult = Math.max(0.1, entity.attackSpeed);

        // Calculate Effective Times
        const windup = entity.baseWindupTime || 0.5;
        const duration = entity.attackDuration || 1.5;

        // CORRETTO: Scala ENTRAMBI con speedMult
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
                    const target = targets[0];
                    if (target) {
                        const distance = Math.abs(entity.position - target.position);

                        if (distance <= entity.attackRange + 0.1) {
                            // DEBUG RANGE
                            /*
                            if (entity.isPlayer) {
                                console.log(`[BattleEngine] Player Attack: Dist=${distance.toFixed(2)}, Range=${entity.attackRange.toFixed(2)} (Base: ${this.playerStats.weaponAttackRange})`);
                            }
                                */

                            this.performAttack(entity, target);

                            // Double Damage Check
                            if (entity.isPlayer && !entity.pendingDoubleHit &&
                                Math.random() < this.playerStats.doubleDamageChance) {
                                if (!target.isDead) {
                                    this.logs.push({
                                        time: this.time,
                                        event: 'DOUBLE_DAMAGE',
                                        details: 'Double Damage Proc!'
                                    });
                                    this.performAttack(entity, target, true);
                                    this.logs.push({
                                        time: this.time,
                                        event: 'DOUBLE_HIT',
                                        details: 'Second Strike!'
                                    });
                                }
                            }

                            // Transition to Recovery
                            // User request: Enemy attacks have a random delay (0-0.4s) added to the cycle
                            // Tempo = (AttackDuration / SpeedMult) + Random(0, 0.4s)
                            // We add this random component to the recovery phase.
                            const randomDelay = (!entity.isPlayer) ? Math.random() * 0 : 0;

                            entity.combatPhase = 'RECOVERING';
                            entity.isWindingUp = false;
                            entity.windupTimer = 0;
                            entity.recoveryTimer = effectiveRecovery + randomDelay;
                        } else {
                            // Out of Range: Hold Charge
                            entity.windupTimer = 0;
                            entity.isWindingUp = true;
                        }
                    } else {
                        // No Target: Reset
                        entity.combatPhase = 'IDLE';
                        entity.isWindingUp = false;
                        entity.windupTimer = 0;
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

        if (attacker.isPlayer) {
            if (Math.random() < this.playerStats.criticalChance) {
                dmg *= this.playerStats.criticalDamage;
                isCrit = true;
            }
            if (!suppressLog) {
                this.logs.push({
                    time: this.time,
                    event: isCrit ? 'CRIT' : 'ATTACK',
                    details: `Player Attack ${isCrit ? '(CRITICAL!)' : ''}`
                });
            }
        } else {
            if (!suppressLog) {
                this.logs.push({
                    time: this.time,
                    event: 'ATTACK',
                    details: `Enemy Attack`
                });
            }
        }

        // For ranged units, create a projectile instead of instant damage
        if (attacker.isRanged && attacker.projectileSpeed && attacker.projectileSpeed > 0) {
            this.projectiles.push({
                id: this.projectileIdCounter++,
                fromX: attacker.position,
                toX: target.position,
                currentX: attacker.position,
                speed: attacker.projectileSpeed,
                isPlayerSource: attacker.isPlayer,
                damage: dmg,
                targetId: target.id,
                isCrit: isCrit // Track crit status for projectile
            });
        } else {
            // Melee: instant damage
            this.dealDamage(target, dmg, attacker.isPlayer, isCrit);
        }
    }

    private processProjectiles(dt: number) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            const direction = proj.isPlayerSource ? 1 : -1;
            proj.currentX += proj.speed * dt * direction;

            // Check if projectile reached target
            const reached = proj.isPlayerSource
                ? proj.currentX >= proj.toX
                : proj.currentX <= proj.toX;

            if (reached) {
                // Find target and deal damage
                const target = proj.isPlayerSource
                    ? this.currentWaveEnemies.find(e => e.id === proj.targetId && !e.isDead)
                    : (this.player.isDead ? null : this.player);

                if (target) {
                    this.dealDamage(target, proj.damage, proj.isPlayerSource, proj.isCrit);
                }
                this.projectiles.splice(i, 1);
            }
        }
    }

    private applySkillBuff(skill: SkillState) {
        // Buff values come pre-multiplied from BattleSimulator (with skillDamageMultiplier applied)
        // No additional multiplication needed here
        const bonusDmg = skill.bonusDamage || 0;
        const bonusHP = skill.bonusMaxHealth || 0;

        if (bonusDmg === 0 && bonusHP === 0) return;

        this.activeBuffs.push({
            skillId: skill.id,
            bonusDamage: bonusDmg,
            bonusMaxHealth: bonusHP
        });

        // Update player stats
        this.player.damage += bonusDmg;

        // Updated Logic (User Request): Health Buffs increase Max Health and heal for that amount
        // Previously acted as Shield
        if (bonusHP > 0) {
            this.player.maxHealth += bonusHP;
            this.player.health += bonusHP;
        }

        this.logs.push({
            time: this.time,
            event: 'BUFF_APPLIED',
            details: `${skill.id}: +${bonusDmg.toFixed(0)} Dmg, +${bonusHP.toFixed(0)} MaxHP`
        });
    }

    private removeSkillBuff(skillId: string) {
        const buffIndex = this.activeBuffs.findIndex(b => b.skillId === skillId);
        if (buffIndex === -1) return;

        const buff = this.activeBuffs[buffIndex];
        this.activeBuffs.splice(buffIndex, 1);

        // Update player stats
        this.player.damage -= buff.bonusDamage;

        // Remove Max Health bonus
        if (buff.bonusMaxHealth > 0) {
            this.player.maxHealth -= buff.bonusMaxHealth;
            // Clamp Health if it exceeds new Max
            if (this.player.health > this.player.maxHealth) {
                this.player.health = this.player.maxHealth;
            }
        }

        this.logs.push({
            time: this.time,
            event: 'BUFF_EXPIRED',
            details: `${skillId}: Buff removed`
        });
    }

    private dealDamage(target: EntityState, amount: number, isPlayerSource: boolean, _isCrit: boolean, isSkillDamage: boolean = false) {
        // Apply Shield / Flat Damage Reduction (User confirmed logic: "Less damage taken per hit")
        let finalDamage = amount;
        if (target.shield > 0) {
            finalDamage = Math.max(0, amount - target.shield);
        }

        if (finalDamage <= 0) {
            // Log Absorbed?
            return;
        }

        // Block Logic (Enemies don't block per user, but Player might?)
        // Player stats has BlockChance? Yes.
        if (target.isPlayer) {
            if (Math.random() < this.playerStats.blockChance) {
                // Blocked!
                this.logs.push({
                    time: this.time,
                    event: 'BLOCKED',
                    details: 'Player blocked damage!'
                });
                return;
            }
        }

        // Calculate actual damage dealt (capped by remaining health)
        // This is for DPS calculation: Overkill damage is not "Effective" DPS usually.
        const damageDealt = Math.min(finalDamage, target.health);

        if (isPlayerSource) {
            this.totalPlayerDamageDealt += damageDealt;
        }

        target.health -= finalDamage;

        // Log Damage
        this.logs.push({
            time: this.time,
            event: target.isPlayer ? 'DMG_TAKEN' : 'DMG_DEALT',
            details: `${finalDamage.toFixed(0)} damage to ${target.isPlayer ? 'Player' : 'Enemy'}`
        });

        // Lifesteal (Player Only)
        if (isPlayerSource && !isSkillDamage) {
            // Updated Formula (User Request): Scale LifeSteal by Health Multiplier as well
            // Original: const lifesteal = this.playerStats.lifeSteal * finalDamage;
            // const healthMulti = (this.playerStats.healthMultiplier) || 1; // Unused for now
            const lifesteal = this.playerStats.lifeSteal * finalDamage;

            if (lifesteal > 0) {
                const prevHp = this.player.health;
                this.player.health = Math.min(this.player.maxHealth, this.player.health + lifesteal);
                const actualHeal = this.player.health - prevHp;

                // Only log if meaningful (> 0.5 to reduce spam?) or always? User wants to see it.
                // Log it.
                if (actualHeal > 0) {
                    this.logs.push({
                        time: this.time,
                        event: 'LIFESTEAL',
                        details: `+${actualHeal.toFixed(0)} HP (${(this.playerStats.lifeSteal * 100).toFixed(1)}% of ${finalDamage.toFixed(0)}`
                    });
                }
            }
        }

        if (target.health <= 0) {
            target.isDead = true;
            target.health = 0;
        }
    }
}
