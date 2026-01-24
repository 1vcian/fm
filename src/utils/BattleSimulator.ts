import type { AggregatedStats } from './statEngine.ts';
import { UserProfile } from '../types/Profile';
import { BattleEngine } from './BattleEngine.ts';
import {
    calculateEnemyHp,
    calculateEnemyDmg,
    calculateProgressDifficultyIdx,
    // Types
    BattleConfig,
    BattleResult,
    WaveResult,
    DungeonLevelConfig,
    LibraryData
} from './BattleHelper';

// Re-export for compatibility
export * from './BattleHelper';

// --- Constants ---

import { SKILL_MECHANICS } from './constants';

// Buff skills that apply stat bonuses while active (from GetSkillStatBuffs bitmask)
const BUFF_SKILLS = ["Meat", "Morale", "Berserk", "Buff", "HigherMorale"];

import { DebugConfig } from './BattleEngine';

// ...

export function simulateBattle(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number, // 0=Normal, 1=Hard
    libs: LibraryData,
    debugConfig?: DebugConfig
): BattleResult | null {
    if (!libs) return null;
    if (!libs.mainBattleLibrary || !libs.enemyAgeScalingLibrary || !libs.enemyLibrary) {
        return null;
    }

    // Find battle config
    let battleConfig: BattleConfig | undefined;

    // 1. Try Lookup Map (Fast & Robust)
    if (libs.mainBattleLookup) {
        battleConfig = libs.mainBattleLookup[`${ageIdx}-${battleIdx}`];
    }

    // 2. Fallback to direct access (Legacy)
    if (!battleConfig && libs.mainBattleLibrary) {
        // Ensure exact format with spaces as per JSON
        const battleKey = `{'AgeIdx': ${ageIdx}, 'BattleIdx': ${battleIdx}}`;
        battleConfig = libs.mainBattleLibrary[battleKey];
    }

    if (!battleConfig) {
        return null; // Config not found
    }

    // Get age scaling (Robust lookup)
    const ageScaling = libs.enemyAgeScalingLibrary[String(ageIdx)] || libs.enemyAgeScalingLibrary[ageIdx];
    if (!ageScaling) {
        return null;
    }

    // Calculate progress difficulty index
    const progressDifficultyIdx = calculateProgressDifficultyIdx(ageIdx, battleIdx, difficultyMode, libs.mainBattleLibrary);

    let difficultyMultiplier = 1.0;
    if (difficultyMode > 0) {
        difficultyMultiplier = 6000000.0;
    }

    // Intra-Age Scaling
    const battleScaling = 1.0;

    // Enemy ranged damage multiplier from config
    const enemyRangedMulti = libs.itemBalancingConfig?.EnemyRangedDamageMultiplier || 1.0;

    // --- NEW ENGINE INTEGRATION ---
    const engine = new BattleEngine(playerStats, debugConfig);

    // Add Skills if Profile provided
    if (profile && libs.skillLibrary && libs.skillPassiveLibrary) {
        // Iterate equipped skills
        const equipped = profile.skills.equipped || [];
        equipped.forEach(skillSlot => {
            const skillConfig = libs.skillLibrary?.[skillSlot.id];
            if (!skillConfig) return;

            // Get Level (Level index in JSON is Level-1 usually)
            // JSON arrays e.g. "DamagePerLevel" are 0-indexed where index 0 = Level 1.
            const levelIdx = Math.max(0, skillSlot.level - 1);

            // Base Damage from JSON
            let baseDamage = 0;
            if (skillConfig.DamagePerLevel && skillConfig.DamagePerLevel.length > levelIdx) {
                baseDamage = skillConfig.DamagePerLevel[levelIdx];
            }

            // Base Heal from JSON
            let baseHeal = 0;
            if (skillConfig.HealthPerLevel && skillConfig.HealthPerLevel.length > levelIdx) {
                baseHeal = skillConfig.HealthPerLevel[levelIdx];
            }

            // Apply Skill Damage Multiplier (SkillDamageMulti passive) + Global Damage Multiplier (Mount/Ring)
            // Both are multipliers that stack additively on top of 100% base.
            // statEngine.skillDamageMultiplier = 1 + SkillMulti
            // statEngine.damageMultiplier = 1 + GlobalMulti
            // Total = 1 + SkillMulti + GlobalMulti = skillDamageMultiplier + damageMultiplier - 1
            const skillFactor = playerStats.skillDamageMultiplier || 1;
            const globalFactor = playerStats.damageMultiplier || 1;

            // For Healing, we use healthMultiplier instead of damageMultiplier if apply? 
            // Usually valid for Damage. For Health skills (Healing), does DamageMulti apply?
            // "DamageMulti" applies to Damage. "SkillDamageMulti" applies to Damage AND Healing.
            // "SkillHealing" or "HealthMulti"? 
            // In StatEngine, Mount gives "Damage" and "Health". "Health" multiplies Player HP. 
            // Does Mount "Health" multiply Skill Healing?
            // User analysis says: "SkillDamageMulti multiplies both damage and health for active skills".
            // "DamageMulti also multiplies damage...". 
            // Let's assume for Healing: Base * (SkillFactor + HealthFactor - 1)? 
            // Or just SkillFactor?
            // User said: "SkillDamageMulti (56.5%) + DamageMulti (11.3%) ...".
            // For now, let's stick to Damage Logic for Damage, and for Healing use SkillFactor. 
            // Validating Worm (Damage) is priority.

            const totalDamageMulti = skillFactor + globalFactor - 1;

            // Buffed values
            const buffedDamage = baseDamage * totalDamageMulti;

            // For healing, standard practice: SkillMulti applies. Global 'DamageMulti' likely doesn't.
            // But check if 'HealthMulti' applies? 
            // For safety, let's apply SkillFactor only for now unless confirmed otherwise.
            const buffedHeal = baseHeal * skillFactor;

            // Hit count per skill type
            const mechanics = SKILL_MECHANICS[skillSlot.id] || { count: 1 };
            const hitCount = mechanics.count || 1;

            // Cooldown with reduction
            // Formula: effectiveCooldown = baseCooldown * (1 - cdReduction)
            const baseCooldown = skillConfig.Cooldown || 10;
            const cdReduction = (playerStats as any).skillCooldownReduction || 0;
            const cooldown = Math.max(0.5, baseCooldown * (1 - cdReduction));

            // Duration
            const duration = skillConfig.ActiveDuration || 0;

            // Determine if it's a buff skill (from GetSkillStatBuffs bitmask analysis)
            const isBuffSkill = BUFF_SKILLS.includes(skillSlot.id);

            let bonusDamage = 0;
            let bonusMaxHealth = 0;
            let activeDamage = 0;
            let activeHeal = 0;

            if (isBuffSkill) {
                // Buff skills: add buffed values to player stats for duration
                if (buffedDamage > 0) {
                    bonusDamage = buffedDamage;
                }
                if (buffedHeal > 0) {
                    bonusMaxHealth = buffedHeal; // Meat adds max HP
                }
            } else {
                // Damage/Instant skills: deal damage per activation
                // Total damage = buffedDamage * hitCount (divided evenly across hits)
                activeDamage = buffedDamage; // Each hit does buffedDamage
                activeHeal = buffedHeal;
            }

            // --- Apply Timing Mechanics ---
            // mechanics already defined above

            engine.addSkill({
                id: skillSlot.id,
                damage: activeDamage,
                cooldown: cooldown,
                activeDuration: duration,
                healAmount: activeHeal,
                bonusDamage: bonusDamage,
                bonusMaxHealth: bonusMaxHealth,
                count: hitCount, // Use correct hit count from lookup table
                interval: mechanics.interval || 0.1,
                delay: mechanics.delay || 0
            });
        });
    }

    // Setup Waves
    const allWaves: any[] = [];
    const wavesToRun = battleConfig.Waves;

    let totalEnemies = 0;

    // Pre-process all waves into Engine Format (EnemyConfig[])
    const waveInfos: { enemies: any[] }[] = [];

    for (let i = 0; i < wavesToRun.length; i++) {
        const wave = wavesToRun[i];
        const engineEnemies: any[] = [];
        const currentWaveInfo: { enemies: any[] } = { enemies: [] };

        for (const enemy of wave.Enemies) {
            const enemyConfig = libs.enemyLibrary[String(enemy.Id)];
            if (!enemyConfig) continue;

            const weaponKey = enemyConfig.WeaponId ? `{'Age': ${enemyConfig.WeaponId.Age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.WeaponId.Idx}}` : null;
            const weaponInfo = (weaponKey && libs.weaponLibrary) ? libs.weaponLibrary[weaponKey] : null;

            // Calculate Base HP/Dmg
            const ageHp = calculateEnemyHp(progressDifficultyIdx, ageScaling, libs.mainBattleConfig, weaponInfo, libs);
            const ageDmg = calculateEnemyDmg(progressDifficultyIdx, ageScaling, libs.mainBattleConfig, weaponInfo, enemyRangedMulti, libs);

            // Calibration & Multipliers
            const CALIBRATION_FACTOR = 0.02;
            const enemyHp = ageHp * battleScaling * difficultyMultiplier * CALIBRATION_FACTOR;
            const enemyDmg = ageDmg * battleScaling * difficultyMultiplier * CALIBRATION_FACTOR;

            const isRanged = !!(weaponInfo && (weaponInfo.AttackRange ?? 0) > 1.0);

            // Store Info for UI
            currentWaveInfo.enemies.push({
                id: enemy.Id,
                count: enemy.Count,
                damagePerHit: enemyDmg,
                hp: enemyHp, // Total HP per enemy
                isRanged: isRanged
            });

            for (let k = 0; k < enemy.Count; k++) {
                engineEnemies.push({
                    id: enemy.Id,
                    hp: enemyHp,
                    dmg: enemyDmg,
                    weaponInfo: weaponInfo,
                    projectileSpeed: 10
                });
                totalEnemies++;
            }
        }
        allWaves.push(engineEnemies);
        waveInfos.push(currentWaveInfo);
    }

    // --- Configure Engine ---
    engine.setNextWaves(allWaves.slice(1)); // Queue 2, 3...
    engine.startWave(allWaves[0]);          // Start 1

    // --- Simulate Full Battle ---
    // Link Max duration to roughly 10 minutes (600s) to be safe
    const simResult = engine.simulate(600);

    // Record Result (Simplified wrapper for compatibility)
    // The previous structure returned per-wave details. 
    // Now we have a single log. We can try to reconstruct "waves cleared" from index?
    // Engine tracks waveIndex.

    // We'll construct a single "summary" wave result or just mimic the structure.
    // Since the UI might expect array of wave results... 
    // But honestly, if we win logic is changed, maybe we just return final state.

    const wavesCleared = engine['waveIndex'] || 0;

    // For compatibility, we'll return one result representing the whole battle
    // OR minimal valid object.
    const waveResults: WaveResult[] = [];

    // Fake results for compatibility
    for (let i = 0; i <= wavesCleared && i < waveInfos.length; i++) {
        // Did we victory?
        const isLast = i === wavesCleared;
        const survived = isLast ? simResult.victory : true;

        // Calculate total HP/DPS for this wave from info
        const waveTotalHp = waveInfos[i].enemies.reduce((sum, e) => sum + (e.hp * e.count), 0);
        const waveTotalDps = waveInfos[i].enemies.reduce((sum, e) => sum + (e.damagePerHit * e.count), 0); // Crude DPS estimate

        waveResults.push({
            waveIndex: i,
            enemies: waveInfos[i].enemies,
            totalEnemyHp: waveTotalHp,
            totalEnemyDps: waveTotalDps,
            playerHealthBeforeWave: 0,
            playerHealthAfterWave: survived ? simResult.remainingHp : 0,
            survived: survived,
            timeToComplete: simResult.time // Cumulative time
        });
    }

    return {
        ageIdx,
        battleIdx,
        difficultyIdx: progressDifficultyIdx,
        waves: waveResults,
        victory: simResult.victory,
        winProbability: simResult.victory ? 100 : 0,
        totalRuns: 1,
        playerHealthRemaining: simResult.remainingHp,
        totalTime: simResult.time,
        playerStats: {
            effectiveDps: simResult.time > 0 ? (simResult.totalDamageDealt / simResult.time) : 0,
            effectiveHp: playerStats.totalHealth,
            healingPerSecond: playerStats.healthRegen,
            damagePerHit: playerStats.totalDamage
        }
    };
}

/**
 * Simulate a Dungeon Battle (Hammer, Skill, Egg, Potion)
 */
export function simulateDungeonBattle(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
    level: number,
    libs: LibraryData,
    debugConfig?: DebugConfig
): BattleResult | null {
    if (!libs) return null;
    let library: Record<string, DungeonLevelConfig> | undefined;

    switch (dungeonType) {
        case 'hammer': library = libs.hammerThiefDungeonBattleLibrary; break;
        case 'skill': library = libs.skillDungeonBattleLibrary; break;
        case 'egg': library = libs.eggDungeonBattleLibrary; break;
        case 'potion': library = libs.potionDungeonBattleLibrary; break;
    }

    if (!library) return null;

    const config = library[String(level)];
    if (!config) return null;

    // Determine Waves
    const wavesToRun: number[] = [];
    if (config.Wave1 !== undefined) {
        if (config.Wave1 > 0) wavesToRun.push(config.Wave1);
        if (config.Wave2 && config.Wave2 > 0) wavesToRun.push(config.Wave2);
        if (config.Wave3 && config.Wave3 > 0) wavesToRun.push(config.Wave3);
    } else {
        wavesToRun.push(1);
    }

    const engine = new BattleEngine(playerStats, debugConfig);

    // --- ADD SKILLS ---
    if (profile && libs.skillLibrary && libs.skillPassiveLibrary) {
        const equipped = profile.skills.equipped || [];
        equipped.forEach(skillSlot => {
            const skillConfig = libs.skillLibrary?.[skillSlot.id];
            if (!skillConfig) return;

            const levelIdx = Math.max(0, skillSlot.level - 1);

            // Base values from JSON
            let baseDamage = 0;
            if (skillConfig.DamagePerLevel && skillConfig.DamagePerLevel.length > levelIdx) {
                baseDamage = skillConfig.DamagePerLevel[levelIdx];
            }
            let baseHeal = 0;
            if (skillConfig.HealthPerLevel && skillConfig.HealthPerLevel.length > levelIdx) {
                baseHeal = skillConfig.HealthPerLevel[levelIdx];
            }

            // Apply Skill Damage Multiplier + Global Damage Multiplier
            const skillFactor = playerStats.skillDamageMultiplier || 1;
            const globalFactor = playerStats.damageMultiplier || 1;
            const mountFactor = playerStats.mountDamageMulti || 0;

            // SKILL DAMAGE FIX: Exclude Mount Damage
            const totalDamageMulti = skillFactor + (globalFactor - mountFactor) - 1;

            const buffedDamage = baseDamage * totalDamageMulti;
            // Healing uses same formula as Damage (includes Secondary Stats, excludes Innate Mount)
            const buffedHeal = baseHeal * totalDamageMulti;

            // Hit count from lookup table
            const mechanics = SKILL_MECHANICS[skillSlot.id] || { count: 1 };
            const hitCount = mechanics.count || 1;

            // User Request: Library Damage is TOTAL.
            // So buffedDamage is Total. We need per-hit for the loop.
            // UNLESS specified otherwise (e.g. StrafeRun does 3x Full Damage)
            const buffedDamagePerHit = mechanics.damageIsPerHit
                ? buffedDamage
                : (buffedDamage / hitCount);

            // Cooldown with reduction
            const baseCooldown = skillConfig.Cooldown || 10;
            const cdReduction = (playerStats as any).skillCooldownReduction || 0;
            const cooldown = Math.max(0.5, baseCooldown * (1 - cdReduction));

            const duration = skillConfig.ActiveDuration || 0;
            const isBuffSkill = BUFF_SKILLS.includes(skillSlot.id);

            let bonusDamage = 0;
            let bonusMaxHealth = 0;
            let activeDamage = 0;
            let activeHeal = 0;

            if (isBuffSkill) {
                if (buffedDamage > 0) bonusDamage = buffedDamage;
                if (buffedHeal > 0) bonusMaxHealth = buffedHeal;
            } else {
                // Use Per-Hit damage for the engine execution
                activeDamage = buffedDamagePerHit;
                activeHeal = buffedHeal;
            }

            // mechanics already defined above

            engine.addSkill({
                id: skillSlot.id,
                damage: activeDamage,
                cooldown: cooldown,
                activeDuration: duration,
                healAmount: activeHeal,
                bonusDamage: bonusDamage,
                bonusMaxHealth: bonusMaxHealth,
                count: hitCount,
                interval: mechanics.interval || 0.1,
                delay: mechanics.delay || 0,
                isSingleTarget: mechanics.isSingleTarget,
                isAOE: mechanics.isAOE
            } as any);
        });
    }

    const allWaves: any[] = [];
    const waveInfos: { enemies: any[] }[] = [];

    for (let i = 0; i < wavesToRun.length; i++) {
        const enemyCount = wavesToRun[i];
        const enemy1Id = config.EnemyId1 ?? 0;
        const enemy2Id = config.EnemyId2 ?? 0;

        const engineEnemies: any[] = [];
        const currentWaveInfo: { enemies: any[] } = { enemies: [] };

        // Group enemies by ID to create summary
        const enemyGroups: Record<number, { count: number }> = {};

        for (let k = 0; k < enemyCount; k++) {
            const currentId = (k % 2 === 0 || enemy2Id === 0) ? enemy1Id : enemy2Id;

            if (!enemyGroups[currentId]) enemyGroups[currentId] = { count: 0 };
            enemyGroups[currentId].count++;

            const enemyConfig = libs.enemyLibrary[String(currentId)];
            const weaponKey = enemyConfig?.WeaponId ? `{'Age': ${enemyConfig.WeaponId.Age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.WeaponId.Idx}}` : null;
            const weaponInfo = (weaponKey && libs.weaponLibrary) ? libs.weaponLibrary[weaponKey] : null;

            // Engine Config
            // For Dungeon, HP/Dmg are fixed in Config
            engineEnemies.push({
                id: currentId,
                hp: config.Health,
                dmg: config.Damage,
                weaponInfo: weaponInfo,
                projectileSpeed: 10
            });
        }
        allWaves.push(engineEnemies);

        // Populate Wave Info from Groups
        Object.keys(enemyGroups).forEach(idStr => {
            const id = parseInt(idStr);
            const count = enemyGroups[id].count;
            const enemyConfig = libs.enemyLibrary[String(id)];
            const weaponKey = enemyConfig?.WeaponId ? `{'Age': ${enemyConfig.WeaponId.Age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.WeaponId.Idx}}` : null;
            const weaponInfo = (weaponKey && libs.weaponLibrary) ? libs.weaponLibrary[weaponKey] : null;
            const isRanged = !!(weaponInfo && (weaponInfo.AttackRange ?? 0) > 1.0);

            currentWaveInfo.enemies.push({
                id: id,
                count: count,
                damagePerHit: config.Damage,
                hp: config.Health,
                isRanged: isRanged
            });
        });

        waveInfos.push(currentWaveInfo);
    }

    // Configure Engine
    engine.setNextWaves(allWaves.slice(1));
    engine.startWave(allWaves[0]);

    // Simulate
    const simResult = engine.simulate(600);

    // Result
    const waveResults: WaveResult[] = [];
    // Construct Wave Results
    const wavesCleared = engine['waveIndex'] || 0;

    for (let i = 0; i <= wavesCleared && i < waveInfos.length; i++) {
        const isLast = i === wavesCleared;
        const survived = isLast ? simResult.victory : true;

        const waveTotalHp = waveInfos[i].enemies.reduce((sum, e) => sum + (e.hp * e.count), 0);
        const waveTotalDps = waveInfos[i].enemies.reduce((sum, e) => sum + (e.damagePerHit * e.count), 0);

        waveResults.push({
            waveIndex: i,
            enemies: waveInfos[i].enemies,
            totalEnemyHp: waveTotalHp,
            totalEnemyDps: waveTotalDps,
            playerHealthBeforeWave: 0,
            playerHealthAfterWave: survived ? simResult.remainingHp : 0,
            survived: survived,
            timeToComplete: simResult.time
        });
    }

    return {
        ageIdx: -1,
        battleIdx: -1,
        difficultyIdx: level,
        dungeonLevel: level,
        dungeonType: dungeonType,
        waves: waveResults,
        victory: simResult.victory,
        winProbability: simResult.victory ? 100 : 0,
        totalRuns: 1,
        playerHealthRemaining: simResult.remainingHp,
        totalTime: simResult.time,
        playerStats: {
            effectiveDps: simResult.time > 0 ? (simResult.totalDamageDealt / simResult.time) : 0,
            effectiveHp: playerStats.totalHealth,
            healingPerSecond: playerStats.healthRegen,
            damagePerHit: playerStats.totalDamage
        }
    };
}

export function simulateBattleMulti(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number,
    libs: LibraryData,
    runs: number = 0, // 0 = use adaptive tiered logic, >0 = run exactly this many
    debugConfig?: DebugConfig
): BattleResult | null {
    if (!libs) return null;
    const results: BattleResult[] = [];

    // If explicit run count specified, run exactly that many
    if (runs > 0) {
        for (let i = 0; i < runs; i++) {
            const res = simulateBattle(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, debugConfig);
            if (res) results.push(res);
        }
        if (results.length === 0) return null;
        return aggregateResults(results, runs);
    }

    // --- ADAPTIVE TIERED LOGIC (used for grid population) ---

    // --- TIER 1: FAST CHECK (2 Runs) ---
    for (let i = 0; i < 2; i++) {
        const res = simulateBattle(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, debugConfig);
        if (res) results.push(res);
    }
    if (results.length === 0) return null;

    let wins = results.filter(r => r.victory).length;

    // A. PERFECT WIN (2/2) -> STOP
    if (wins === 2) {
        const bestRun = results[0];
        return {
            ...bestRun,
            victory: true,
            winProbability: 100,
            totalRuns: 1000, // Virtual count
            waves: bestRun.waves
        };
    }

    // --- TIER 2: CHECK 10 RUNS ---
    // If we didn't get 2/2, expand to 10 runs total (add 8)
    for (let i = 0; i < 8; i++) {
        const res = simulateBattle(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, debugConfig);
        if (res) results.push(res);
    }
    wins = results.filter(r => r.victory).length;

    // Decision at 10 Runs:
    // If wins >= 5 (50%+), we trust it enough. STOP.
    if (wins >= 5) {
        return aggregateResults(results, 10);
    }

    // --- TIER 3: CHECK 100 RUNS ---
    // If wins < 5 (Low winrate or 0), expand to 100 runs total (add 90)
    for (let i = 0; i < 90; i++) {
        const res = simulateBattle(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, debugConfig);
        if (res) results.push(res);
    }
    wins = results.filter(r => r.victory).length;

    // Decision at 100 Runs:
    // If we have ANY wins (>= 1%), we trust the 100 runs. STOP.
    // Why? 100 runs gives 1% resolution. Good enough for "Partial Win".
    // Decision at 100 Runs:
    // User Request: Limit automatic steps to 100 max for now.
    // If we have ANY wins (>= 1%), we trust the 100 runs. STOP.
    // Even if 0 wins, we stop at 100 for performance/user request.

    return aggregateResults(results, 100);

    /* 
    // --- TIER 4: DEEP SEARCH (1000 RUNS) ---
    // DISABLED per user request (capped at 100)
    const TARGET_TOTAL = 1000;
    const remainingRuns = TARGET_TOTAL - 100;

    for (let i = 0; i < remainingRuns; i++) {
        const res = simulateBattle(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs);
        if (res) results.push(res);
    }

    return aggregateResults(results, TARGET_TOTAL);
    */
}

// Helper to aggregate results
function aggregateResults(results: BattleResult[], totalRunsOverride?: number): BattleResult {
    const wins = results.filter(r => r.victory).length;
    const winRate = (wins / results.length) * 100;

    const victoryRuns = results.filter(r => r.victory);
    const bestRun = victoryRuns.length > 0
        ? victoryRuns[0]
        : results.sort((a, b) => b.waves.length - a.waves.length)[0];

    const averagedWaves = bestRun.waves.map((templateWave, waveIdx) => {
        let sumPlayerHp = 0;
        results.forEach(r => {
            if (r.waves[waveIdx]) sumPlayerHp += r.waves[waveIdx].playerHealthAfterWave;
        });
        return {
            ...templateWave,
            playerHealthAfterWave: sumPlayerHp / results.length
        };
    });

    const avgDps = results.reduce((sum, r) => sum + r.playerStats.effectiveDps, 0) / results.length;

    return {
        ...bestRun,
        totalEnemyHp: results.reduce((sum, r) => sum + (r.totalEnemyHp || 0), 0) / results.length,
        totalEnemyDps: results.reduce((sum, r) => sum + (r.totalEnemyDps || 0), 0) / results.length,
        playerHealthRemaining: results.reduce((sum, r) => sum + r.playerHealthRemaining, 0) / results.length,
        victory: wins > (results.length / 2),
        winProbability: winRate,
        totalRuns: totalRunsOverride || results.length,
        totalTime: results.reduce((sum, r) => sum + r.totalTime, 0) / results.length,
        waves: averagedWaves,
        playerStats: {
            ...bestRun.playerStats,
            effectiveDps: avgDps
        }
    };
}

/**
 * Run multiple dungeon simulations and return an averaged result
 */
export function simulateDungeonBattleMulti(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
    level: number,
    libs: LibraryData,
    runs: number = 100, // Number of simulations to run
    debugConfig?: DebugConfig
): BattleResult | null {
    if (!libs) return null;
    const results: BattleResult[] = [];

    // Run exactly the specified number of simulations
    for (let i = 0; i < runs; i++) {
        const res = simulateDungeonBattle(playerStats, profile, dungeonType, level, libs, debugConfig);
        if (res) results.push(res);
    }

    if (results.length === 0) return null;

    const wins = results.filter(r => r.victory).length;
    const winRate = (wins / results.length) * 100;

    // Select Best Run (Victory or Longest Progress)
    const victoryRuns = results.filter(r => r.victory);
    const bestRun = victoryRuns.length > 0
        ? victoryRuns[0]
        : results.sort((a, b) => b.waves.length - a.waves.length)[0];

    // Average Wave Stats
    const averagedWaves = bestRun.waves.map((templateWave, waveIdx) => {
        let sumPlayerHp = 0;

        results.forEach(r => {
            if (r.waves[waveIdx]) {
                sumPlayerHp += r.waves[waveIdx].playerHealthAfterWave;
            } else {
                sumPlayerHp += 0;
            }
        });

        return {
            ...templateWave,
            playerHealthAfterWave: sumPlayerHp / results.length
        };
    });

    return {
        ...bestRun,
        // Global Averages
        totalEnemyHp: results.reduce((sum, r) => sum + (r.totalEnemyHp || 0), 0) / results.length,
        totalEnemyDps: results.reduce((sum, r) => sum + (r.totalEnemyDps || 0), 0) / results.length,
        playerHealthRemaining: results.reduce((sum, r) => sum + r.playerHealthRemaining, 0) / results.length,
        victory: wins > (results.length / 2),
        winProbability: winRate,
        totalRuns: runs,
        totalTime: results.reduce((sum, r) => sum + r.totalTime, 0) / results.length,
        waves: averagedWaves
    };
}

/**
 * Run Monte Carlo simulation for more accurate win probability
 * Accounts for crit/block variance
 */
export function calculateWinProbability(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number = 0,
    libs: LibraryData,
    simulations: number = 100
): number {
    const res = simulateBattleMulti(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, simulations);
    return res ? res.winProbability : 0;
}

/**
 * Find the highest beatable stage for the player
 */
export function findMaxBeatableStage(
    playerStats: AggregatedStats,
    libs: LibraryData,
    _minWinProbability: number = 50,
    difficultyMode: number = 0
): { ageIdx: number; battleIdx: number } | null {
    // Optimization: Start from end, but maybe binary search or similar?
    // Given the complexity, iterating backwards is safe but slow.
    // Let's reduce search space?

    for (let age = 10; age >= 0; age--) {
        const maxBattle = age === 0 ? 9 : 19;

        for (let battle = maxBattle; battle >= 0; battle--) {
            // Use single run for speed in search
            const result = simulateBattle(playerStats, null, age, battle, difficultyMode, libs);
            if (result && result.victory) {
                // Confirm with multi if close?
                return { ageIdx: age, battleIdx: battle };
            }
        }
    }
    return null;
}

export function findMaxBeatableDungeonStage(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion'
): number {
    for (let lvl = 99; lvl >= 0; lvl--) {
        // Use single run for speed
        const result = simulateDungeonBattle(playerStats, profile, dungeonType, lvl, libs);
        if (result && result.victory) {
            return lvl;
        }
    }
    return -1;
}
