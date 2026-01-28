/**
 * Stats Calculator Utility
 * Central engine for calculating player stats from all sources.
 * Uses JSON data as the single source of truth.
 */

import { UserProfile, PetSlot, SkillSlot, MountSlot, ItemSlot } from '../types/Profile';

// Stat Natures from StatConfigLibrary.json
export type StatNature = 'Multiplier' | 'Additive' | 'OneMinusMultiplier' | 'Divisor';

// Stat entry structure from JSON
export interface StatEntry {
    statType: string;
    statNature: StatNature;
    value: number;
    target?: string; // PlayerStatTarget, PlayerMeleeOnlyStatTarget, etc.
}

// Base player stats from ItemBalancingConfig.json
export interface BasePlayerStats {
    baseDamage: number;       // PlayerBaseDamage: 10
    baseHealth: number;       // PlayerBaseHealth: 80
    baseCritDamage: number;   // PlayerBaseCritDamage: 0.2
    meleeDamageMultiplier: number;  // PlayerMeleeDamageMultiplier: 1.6
    powerDamageMultiplier: number;  // PlayerPowerDamageMultiplier: 8.0
    levelScalingBase: number; // LevelScalingBase: 1.01
    itemBaseMaxLevel: number; // ItemBaseMaxLevel: 98
}

// Default base stats if config not loaded
export const DEFAULT_BASE_STATS: BasePlayerStats = {
    baseDamage: 10,
    baseHealth: 80,
    baseCritDamage: 0.2,
    meleeDamageMultiplier: 1.6,
    powerDamageMultiplier: 8.0,
    levelScalingBase: 1.01,
    itemBaseMaxLevel: 99,
};

// Aggregated stats structure
export interface AggregatedStats {
    // Base stats from config
    basePlayerDamage: number;
    basePlayerHealth: number;

    // Item stats (additive)
    itemDamage: number;
    itemHealth: number;

    // Final calculated stats
    totalDamage: number;
    totalHealth: number;
    meleeDamage: number;
    rangedDamage: number;

    // Multipliers
    damageMultiplier: number;
    healthMultiplier: number;
    meleeDamageMultiplier: number;
    rangedDamageMultiplier: number;
    attackSpeedMultiplier: number;

    // Chances (0-1 floats)
    criticalChance: number;
    criticalDamage: number;
    blockChance: number;
    doubleDamageChance: number;

    // Sustain
    healthRegen: number;
    lifeSteal: number;

    // Skill modifiers
    skillDamageMultiplier: number;
    skillCooldownReduction: number;

    // Other
    experienceMultiplier: number;
    sellPriceMultiplier: number;
    freebieChance: number;

    // Weapon info
    isRangedWeapon: boolean;
    weaponAttackRange: number;
    weaponWindupTime: number;

    // Projectile Info
    hasProjectile: boolean;
    projectileSpeed: number;
    projectileRadius: number;

    // Skill metrics
    skillDps: number;
    skillHps: number;

    // Item limits
    maxItemLevels: Record<string, number>;
}

// Default stats
export const DEFAULT_STATS: AggregatedStats = {
    basePlayerDamage: 10,
    basePlayerHealth: 80,
    itemDamage: 0,
    itemHealth: 0,
    totalDamage: 10,
    totalHealth: 80,
    meleeDamage: 16, // 10 * 1.6
    rangedDamage: 10,
    damageMultiplier: 1,
    healthMultiplier: 1,
    meleeDamageMultiplier: 1,
    rangedDamageMultiplier: 1,
    attackSpeedMultiplier: 1,
    criticalChance: 0,
    criticalDamage: 1.2, // 1 + 0.2 base crit damage
    blockChance: 0,
    doubleDamageChance: 0,
    healthRegen: 0,
    lifeSteal: 0,
    skillDamageMultiplier: 1,
    skillCooldownReduction: 0,
    experienceMultiplier: 1,
    sellPriceMultiplier: 1,
    freebieChance: 0,
    isRangedWeapon: false,
    weaponAttackRange: 1,
    weaponWindupTime: 0.5,
    hasProjectile: false,
    projectileSpeed: 0,
    projectileRadius: 0,
    skillDps: 0,
    skillHps: 0,
    maxItemLevels: {
        'Weapon': 99,
        'Helmet': 99,
        'Body': 99,
        'Gloves': 99,
        'Belt': 99,
        'Necklace': 99,
        'Ring': 99,
        'Shoe': 99,
    }
};

/**
 * Apply a stat value based on its nature
 */
export function applyStatNature(
    currentValue: number,
    addedValue: number,
    nature: StatNature
): number {
    switch (nature) {
        case 'Multiplier':
            return currentValue + addedValue;
        case 'Additive':
            return currentValue + addedValue;
        case 'OneMinusMultiplier':
            return 1 - (1 - currentValue) * (1 - addedValue);
        case 'Divisor':
            return currentValue * addedValue;
        default:
            return currentValue + addedValue;
    }
}

/**
 * Parse base stats from ItemBalancingConfig.json
 */
export function parseBaseStats(itemBalancingConfig: any): BasePlayerStats {
    if (!itemBalancingConfig) return DEFAULT_BASE_STATS;
    return {
        baseDamage: itemBalancingConfig.PlayerBaseDamage || 10,
        baseHealth: itemBalancingConfig.PlayerBaseHealth || 80,
        baseCritDamage: itemBalancingConfig.PlayerBaseCritDamage || 0.2,
        meleeDamageMultiplier: itemBalancingConfig.PlayerMeleeDamageMultiplier || 1.6,
        powerDamageMultiplier: itemBalancingConfig.PlayerPowerDamageMultiplier || 8.0,
        levelScalingBase: itemBalancingConfig.LevelScalingBase || 1.01,
        itemBaseMaxLevel: (itemBalancingConfig.ItemBaseMaxLevel || 98) + 1,
    };
}

/**
 * Extract stats from equipped items
 */
export function getItemStats(
    items: UserProfile['items'],
    itemBalancingLibrary: any,
    itemBalancingConfig: any
): { stats: StatEntry[]; totalItemDamage: number; totalItemHealth: number } {
    const stats: StatEntry[] = [];
    let totalItemDamage = 0;
    let totalItemHealth = 0;

    const baseStats = parseBaseStats(itemBalancingConfig);

    const allSlots: (ItemSlot | null)[] = [
        items.Weapon, items.Helmet, items.Body, items.Gloves,
        items.Belt, items.Necklace, items.Ring, items.Shoe
    ];

    for (const item of allSlots) {
        if (!item) continue;

        // Build item key for lookup
        const slotType = getItemSlotType(item);
        const key = `{'Age': ${item.age}, 'Type': '${slotType}', 'Idx': ${item.idx}}`;
        const itemData = itemBalancingLibrary?.[key];

        if (itemData?.EquipmentStats) {
            for (const equipStat of itemData.EquipmentStats) {
                const statType = equipStat.StatNode?.UniqueStat?.StatType;
                const statNature = equipStat.StatNode?.UniqueStat?.StatNature as StatNature || 'Additive';
                let value = equipStat.Value || 0;

                // Apply level scaling: value * (levelScalingBase ^ level)
                value = value * Math.pow(baseStats.levelScalingBase, item.level);

                if (statType === 'Damage') {
                    totalItemDamage += value;
                } else if (statType === 'Health') {
                    totalItemHealth += value;
                }

                stats.push({
                    statType,
                    statNature,
                    value,
                    target: equipStat.StatNode?.StatTarget?.$type,
                });
            }
        }

        // Add secondary stats
        if (item.secondaryStats) {
            for (const secondary of item.secondaryStats) {
                // Secondary stats from items are in percentage form (e.g., 12.3 means +12.3%)
                // Convert to decimal for Multiplier stats
                const convertedValue = secondary.value / 100;
                console.log(`[DEBUG Item Secondary] ${secondary.statId}: raw=${secondary.value}, converted=${convertedValue}`);
                stats.push({
                    statType: secondary.statId,
                    statNature: 'Multiplier',
                    value: convertedValue,
                });
            }
        }
    }

    return { stats, totalItemDamage, totalItemHealth };
}

/**
 * Get item slot type for JSON key lookup
 */
function getItemSlotType(item: ItemSlot): string {
    // The items are stored with uppercase keys in profile but need mapping
    // Profile uses: Body, Helmet, etc.
    // JSON uses: Armour, Helmet, etc.
    return item.rarity ? item.rarity : 'Weapon'; // Fallback
}

/**
 * Get weapon info from WeaponLibrary.json
 */
export function getWeaponInfo(
    weapon: ItemSlot | null,
    weaponLibrary: any
): { isRanged: boolean; attackRange: number; windupTime: number } {
    if (!weapon || !weaponLibrary) {
        return { isRanged: false, attackRange: 1, windupTime: 0.5 };
    }

    const key = `{'Age': ${weapon.age}, 'Type': 'Weapon', 'Idx': ${weapon.idx}}`;
    const weaponData = weaponLibrary[key];

    if (!weaponData) {
        return { isRanged: false, attackRange: 1, windupTime: 0.5 };
    }

    // Determine ranged based on AttackRange
    // Melee = AttackRange < 1, Ranged = AttackRange >= 1
    const attackRange = weaponData.AttackRange || 0;
    const isRanged = attackRange >= 1;

    return {
        isRanged,
        attackRange,
        windupTime: weaponData.WindupTime || 0.5,
    };
}

/**
 * Extract stats from Pet based on level and rarity
 */
export function getPetStats(
    pet: PetSlot,
    petUpgradeLibrary: any,
    petBalancingLibrary: any,
    petLibrary: any
): StatEntry[] {
    const stats: StatEntry[] = [];

    const upgradeData = petUpgradeLibrary?.[pet.rarity];
    if (!upgradeData?.LevelInfo) return stats;

    const levelInfo = upgradeData.LevelInfo[pet.level] || upgradeData.LevelInfo[0];
    if (!levelInfo?.PetStats?.Stats) return stats;

    const petKey = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
    const petData = petLibrary?.[petKey];
    const petType = petData?.Type || 'Balanced';

    const typeMultipliers = petBalancingLibrary?.[petType] || { DamageMultiplier: 1, HealthMultiplier: 1 };

    for (const stat of levelInfo.PetStats.Stats) {
        const statType = stat.StatNode?.UniqueStat?.StatType;
        const statNature = stat.StatNode?.UniqueStat?.StatNature || 'Additive';
        let value = stat.Value || 0;

        if (statType === 'Damage') {
            value *= typeMultipliers.DamageMultiplier;
        } else if (statType === 'Health') {
            value *= typeMultipliers.HealthMultiplier;
        }

        stats.push({
            statType,
            statNature: statNature as StatNature,
            value,
        });
    }

    if (pet.secondaryStats) {
        for (const secondary of pet.secondaryStats) {
            // Pet secondary stats are also in percentage form, convert to decimal
            stats.push({
                statType: secondary.statId,
                statNature: 'Multiplier',
                value: secondary.value / 100, // Convert percentage to decimal
            });
        }
    }

    return stats;
}

/**
 * Extract stats from Skill based on level
 */
export function getSkillStats(
    skill: SkillSlot,
    skillLibrary: any,
    skillPassiveLibrary: any
): StatEntry[] {
    const stats: StatEntry[] = [];

    const skillData = skillLibrary?.[skill.id];
    if (!skillData) return stats;

    const levelIdx = Math.max(0, skill.level - 1);

    const damage = skillData.DamagePerLevel?.[levelIdx] || 0;
    const health = skillData.HealthPerLevel?.[levelIdx] || 0;

    if (damage > 0) {
        stats.push({ statType: 'SkillDamage', statNature: 'Additive', value: damage });
    }
    if (health > 0) {
        stats.push({ statType: 'SkillHealth', statNature: 'Additive', value: health });
    }

    const passiveData = skillPassiveLibrary?.[skill.rarity];
    if (passiveData?.LevelStats?.[levelIdx]?.Stats) {
        for (const stat of passiveData.LevelStats[levelIdx].Stats) {
            stats.push({
                statType: stat.StatNode?.UniqueStat?.StatType,
                statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Additive',
                value: stat.Value,
            });
        }
    }

    return stats;
}

/**
 * Extract stats from Mount based on level
 */
export function getMountStats(
    mount: MountSlot,
    mountUpgradeLibrary: any
): StatEntry[] {
    const stats: StatEntry[] = [];

    const upgradeData = mountUpgradeLibrary?.[mount.rarity];
    if (!upgradeData?.LevelInfo) return stats;

    const levelInfo = upgradeData.LevelInfo[mount.level] || upgradeData.LevelInfo[0];
    if (!levelInfo?.MountStats?.Stats) return stats;

    for (const stat of levelInfo.MountStats.Stats) {
        stats.push({
            statType: stat.StatNode?.UniqueStat?.StatType,
            statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Multiplier',
            value: stat.Value,
        });
    }

    // Include manual passive stats
    if (mount.secondaryStats) {
        for (const secondary of mount.secondaryStats) {
            stats.push({
                statType: secondary.statId,
                statNature: 'Multiplier',
                value: secondary.value,
            });
        }
    }

    return stats;
}

/**
 * Extract stats from Tech Tree (updated for tree-based structure)
 */
export function getTechTreeStats(
    techTree: { Forge: { [nodeId: number]: number }; Power: { [nodeId: number]: number }; SkillsPetTech: { [nodeId: number]: number } },
    techTreeLibrary: any,
    techTreePositionLibrary: any
): StatEntry[] {
    const stats: StatEntry[] = [];

    const checkNodeValidity = (
        treeData: any,
        levels: Record<string, number>,
        nodeId: number,
        visited: Set<number> = new Set()
    ): boolean => {
        // Prevent cycles
        if (visited.has(nodeId)) return false;
        visited.add(nodeId);

        // Check level > 0
        const level = levels[nodeId];
        if (!level || level <= 0) return false;

        // Check requirements
        const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
        if (!node) return false;

        if (node.Requirements && node.Requirements.length > 0) {
            for (const reqId of node.Requirements) {
                // Recursive validity check
                if (!checkNodeValidity(treeData, levels, reqId, new Set(visited))) {
                    return false;
                }
            }
        }

        return true;
    };

    const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];

    for (const tree of trees) {
        const treeLevels = techTree[tree] || {};
        const treeData = techTreePositionLibrary?.[tree];
        if (!treeData?.Nodes) continue;

        for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
            if (typeof level !== 'number' || level <= 0) continue;

            const nodeId = parseInt(nodeIdStr);

            // Add validity check
            if (!checkNodeValidity(treeData, treeLevels, nodeId)) {
                continue;
            }

            const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
            if (!node) continue;

            // Get effect from library
            const nodeData = techTreeLibrary?.[node.Type];
            if (!nodeData?.Stats) continue;

            for (const stat of nodeData.Stats) {
                const baseValue = stat.Value || 0;
                const valueIncrease = stat.ValueIncrease || 0;
                const totalValue = baseValue + (level - 1) * valueIncrease;

                const target = stat.StatNode?.StatTarget?.$type;
                if (target === 'ActiveSkillStatTarget') {
                    console.log(`[DEBUG TechTree] ${tree} Node ${nodeId} (${node.Type}) lv${level}: SkillDamage +${(totalValue * 100).toFixed(1)}%`);
                }

                stats.push({
                    statType: stat.StatNode?.UniqueStat?.StatType,
                    statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Multiplier',
                    value: totalValue,
                    target: target,
                });
            }
        }
    }

    return stats;
}

/**
 * Main aggregation function - calculates all stats from profile
 */
export function calculateAllStats(
    profile: UserProfile,
    gameData: {
        petUpgradeLibrary?: any;
        petBalancingLibrary?: any;
        petLibrary?: any;
        skillLibrary?: any;
        skillPassiveLibrary?: any;
        mountUpgradeLibrary?: any;
        techTreeLibrary?: any;
        techTreePositionLibrary?: any;
        itemBalancingLibrary?: any;
        itemBalancingConfig?: any;
        weaponLibrary?: any;
        projectilesLibrary?: any;
    }
): AggregatedStats {
    const result = { ...DEFAULT_STATS };
    const allStats: StatEntry[] = [];

    // Parse base player stats
    const baseStats = parseBaseStats(gameData.itemBalancingConfig);
    result.basePlayerDamage = baseStats.baseDamage;
    result.basePlayerHealth = baseStats.baseHealth;
    result.criticalDamage = 1 + baseStats.baseCritDamage; // Base crit damage

    // Get weapon info and Projectile
    const weaponInfo = getWeaponInfo(profile.items.Weapon, gameData.weaponLibrary);
    result.isRangedWeapon = weaponInfo.isRanged;
    result.weaponAttackRange = weaponInfo.attackRange;
    result.weaponWindupTime = weaponInfo.windupTime;

    // Lookup Projectile if weapon has one
    if (profile.items.Weapon && gameData.weaponLibrary) {
        const key = `{'Age': ${profile.items.Weapon.age}, 'Type': 'Weapon', 'Idx': ${profile.items.Weapon.idx}}`;
        const weaponData = gameData.weaponLibrary[key];
        const projId = weaponData?.ProjectileId;

        if (projId !== undefined && projId > -1 && gameData.projectilesLibrary) {
            const projData = gameData.projectilesLibrary[String(projId)];
            if (projData) {
                result.hasProjectile = true;
                result.projectileSpeed = projData.Speed || 0;
                result.projectileRadius = projData.CollisionRadius || 0;
            }
        }
    }

    // Collect item stats
    const itemResult = getItemStats(
        profile.items,
        gameData.itemBalancingLibrary,
        gameData.itemBalancingConfig
    );
    result.itemDamage = itemResult.totalItemDamage;
    result.itemHealth = itemResult.totalItemHealth;
    allStats.push(...itemResult.stats);

    // Collect from Pets
    for (const pet of profile.pets.active) {
        allStats.push(...getPetStats(
            pet,
            gameData.petUpgradeLibrary,
            gameData.petBalancingLibrary,
            gameData.petLibrary
        ));
    }

    // Collect from Skills
    for (const skill of profile.skills.equipped) {
        allStats.push(...getSkillStats(
            skill,
            gameData.skillLibrary,
            gameData.skillPassiveLibrary
        ));
    }

    // Collect from Mount
    if (profile.mount.active) {
        allStats.push(...getMountStats(
            profile.mount.active,
            gameData.mountUpgradeLibrary
        ));
    }

    // Collect from Tech Tree
    const techStats = getTechTreeStats(
        profile.techTree,
        gameData.techTreeLibrary,
        gameData.techTreePositionLibrary
    );
    allStats.push(...techStats);

    const maxLevelBonuses: Record<string, number> = {
        'Weapon': 0, 'Helmet': 0, 'Body': 0, 'Gloves': 0, 'Belt': 0, 'Necklace': 0, 'Ring': 0, 'Shoe': 0
    };

    // Apply all stats
    for (const stat of allStats) {
        switch (stat.statType) {
            case 'Damage':
                if (stat.statNature === 'Additive') {
                    // Already handled in itemResult, skip additive here
                } else if (stat.target === 'PlayerMeleeOnlyStatTarget') {
                    result.meleeDamageMultiplier = applyStatNature(result.meleeDamageMultiplier, stat.value, stat.statNature);
                } else if (stat.target === 'PlayerRangedOnlyStatTarget') {
                    result.rangedDamageMultiplier = applyStatNature(result.rangedDamageMultiplier, stat.value, stat.statNature);
                } else if (stat.target === 'ActiveSkillStatTarget') {
                    // Skill damage from tech tree goes to skillDamageMultiplier
                    result.skillDamageMultiplier = applyStatNature(result.skillDamageMultiplier, stat.value, stat.statNature);
                } else {
                    result.damageMultiplier = applyStatNature(result.damageMultiplier, stat.value, stat.statNature);
                }
                break;
            case 'Health':
                if (stat.statNature !== 'Additive') {
                    result.healthMultiplier = applyStatNature(result.healthMultiplier, stat.value, stat.statNature);
                }
                break;
            case 'CriticalChance':
                result.criticalChance = applyStatNature(result.criticalChance, stat.value, stat.statNature);
                break;
            case 'CriticalDamage':
                result.criticalDamage = applyStatNature(result.criticalDamage, stat.value, stat.statNature);
                break;
            case 'BlockChance':
                result.blockChance = applyStatNature(result.blockChance, stat.value, stat.statNature);
                break;
            case 'DoubleDamageChance':
                result.doubleDamageChance = applyStatNature(result.doubleDamageChance, stat.value, stat.statNature);
                break;
            case 'HealthRegen':
                result.healthRegen = applyStatNature(result.healthRegen, stat.value, stat.statNature);
                break;
            case 'LifeSteal':
                result.lifeSteal = applyStatNature(result.lifeSteal, stat.value, stat.statNature);
                break;
            case 'AttackSpeed':
                result.attackSpeedMultiplier = applyStatNature(result.attackSpeedMultiplier, stat.value, stat.statNature);
                break;
            case 'Experience':
                result.experienceMultiplier = applyStatNature(result.experienceMultiplier, stat.value, stat.statNature);
                break;
            case 'SellPrice':
                result.sellPriceMultiplier = applyStatNature(result.sellPriceMultiplier, stat.value, stat.statNature);
                break;
            case 'FreebieChance':
                result.freebieChance = applyStatNature(result.freebieChance, stat.value, stat.statNature);
                break;
            case 'SkillDamageMulti':
                console.log(`[DEBUG] SkillDamageMulti case hit: value=${stat.value}, current=${result.skillDamageMultiplier}`);
                result.skillDamageMultiplier = applyStatNature(result.skillDamageMultiplier, stat.value, stat.statNature);
                console.log(`[DEBUG] SkillDamageMulti after: ${result.skillDamageMultiplier}`);
                break;
            case 'TimerSpeed':
                result.skillCooldownReduction = applyStatNature(result.skillCooldownReduction, stat.value, 'OneMinusMultiplier');
                break;
            case 'MaxLevel':
                if (stat.target === 'WeaponStatTarget') {
                    maxLevelBonuses['Weapon'] += stat.value;
                } else if (stat.target === 'EquipmentStatTarget') {
                    const typeToSlot: Record<number, string> = {
                        0: 'Helmet', 1: 'Body', 2: 'Gloves', 3: 'Necklace', 4: 'Ring', 6: 'Shoe', 7: 'Belt'
                    };
                    const itemType = (stat as any).itemType || 0;
                    const slot = typeToSlot[itemType];
                    if (slot) maxLevelBonuses[slot] += stat.value;
                }
                break;
        }
    }

    // Finalize Max Levels
    const baseMax = baseStats.itemBaseMaxLevel;
    const slots: string[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
    for (const s of slots) {
        result.maxItemLevels[s] = baseMax + (maxLevelBonuses[s] || 0);
    }

    // Calculate final stats
    const baseDmg = baseStats.baseDamage + result.itemDamage;
    // Removed Power Damage Multiplier (8.0x) per user request (simulation was too optimistic)
    result.totalDamage = baseDmg * result.damageMultiplier;
    result.meleeDamage = result.totalDamage * baseStats.meleeDamageMultiplier * result.meleeDamageMultiplier;
    result.rangedDamage = result.totalDamage * result.rangedDamageMultiplier;

    const baseHp = baseStats.baseHealth + result.itemHealth;
    result.totalHealth = baseHp * result.healthMultiplier;

    // Calculate Skill DPS/HPS
    let totalSkillDps = 0;
    let totalSkillHps = 0;

    for (const skill of profile.skills.equipped) {
        const skillData = gameData.skillLibrary?.[skill.id];
        if (!skillData) continue;

        const levelIdx = Math.max(0, skill.level - 1);
        // Handle potentially missing arrays or indices
        const baseDmg = skillData.DamagePerLevel?.[levelIdx] || 0;
        const baseHeal = skillData.HealthPerLevel?.[levelIdx] || 0;
        const cooldown = skillData.Cooldown || 1;

        // Apply Cooldown Reduction
        // Ensure cooldown doesn't drop to 0 or negative
        const cdMultiplier = Math.max(0.1, 1 - result.skillCooldownReduction);
        const finalCooldown = Math.max(0.1, cooldown * cdMultiplier);

        if (baseDmg > 0) {
            // Apply Damage Multipliers: Global Damage * Skill Damage
            const dmg = baseDmg * result.damageMultiplier * result.skillDamageMultiplier;
            totalSkillDps += dmg / finalCooldown;
        }

        if (baseHeal > 0) {
            // Healing: Currently assuming pure base health calculation
            // If healing should scale with Health Multiplier, uncomment:
            // const heal = baseHeal * result.healthMultiplier;
            // For now, raw healing per second
            totalSkillHps += baseHeal / finalCooldown;
        }
    }
    result.skillDps = totalSkillDps;
    result.skillHps = totalSkillHps;

    return result;
}

/**
 * Format a percentage value for display
 */
export function formatPercent(value: number, decimals: number = 2): string {
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a multiplier value for display (e.g., 1.5x -> +50%)
 */
export function formatMultiplier(value: number, decimals: number = 2): string {
    const percent = (value - 1) * 100;
    return percent >= 0 ? `+${percent.toFixed(decimals)}%` : `${percent.toFixed(decimals)}%`;
}

/**
 * Format a number with K/M suffixes and specific precision
 */
export function formatCompactNumber(n: number): string {
    if (n < 1000) return Math.floor(n).toLocaleString();

    const suffixes = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N', 'd', 'U', 'D'];
    const tier = Math.floor(Math.log10(n) / 3);

    if (tier >= suffixes.length) return n.toExponential(2);

    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaled = n / scale;

    let formatted = '';
    if (scaled >= 100) {
        // 100-999: 0 decimals (e.g. 123M)
        formatted = Math.floor(scaled).toString();
    } else if (scaled >= 10) {
        // 10-99.9: 1 decimal (e.g. 12.3M)
        formatted = (Math.floor(scaled * 10) / 10).toString();
    } else {
        // 1-9.99: 2 decimals (e.g. 1.23M)
        formatted = (Math.floor(scaled * 100) / 100).toString();
    }

    return formatted + suffix;
}
