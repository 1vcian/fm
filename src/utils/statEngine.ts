/**
 * StatEngine
 * Central engine for calculating player stats from all sources (Items, Pets, Tech Tree, Mounts, Skills).
 */

import { UserProfile } from '../types/Profile';
import { SKILL_MECHANICS, attackIntervalSeconds, doubleDelaySeconds } from './constants';
import { getNormalizedTarget } from './ascensionUtils';
import {
    StatAttribution, StatContribution, SourceRef, canonicalStatKey,
    TOTAL_DAMAGE_KEY, TOTAL_HEALTH_KEY, TOTAL_POWER_KEY
} from '../types/statAttribution';

export type StatNature = 'Multiplier' | 'Additive' | 'OneMinusMultiplier' | 'Divisor';

export interface StatEntry {
    statType: string;
    statNature: StatNature;
    value: number;
    target?: string;
}

export interface StatBreakdown {
    substats: number;
    tree: number;
    ascension: number;
    skins: number;
    sets: number;
    other: number;
}

export interface BasePlayerStats {
    baseDamage: number;
    baseHealth: number;
    baseCritDamage: number;
    meleeDamageMultiplier: number;
    powerDamageMultiplier: number;
    levelScalingBase: number;
    itemBaseMaxLevel: number;
}

export const DEFAULT_BASE_STATS: BasePlayerStats = {
    baseDamage: 10,
    baseHealth: 80,
    baseCritDamage: 0.2,
    meleeDamageMultiplier: 1.6,
    powerDamageMultiplier: 8.0,
    levelScalingBase: 1.01,
    itemBaseMaxLevel: 99,
};

export interface AggregatedStats {
    basePlayerDamage: number;
    basePlayerHealth: number;
    itemDamage: number;
    itemHealth: number;
    weaponDamage: number;  // Weapon damage only (gets base melee)
    petDamage: number;     // Pet flat damage
    petHealth: number;     // Pet flat health
    skillPassiveDamage: number;  // Skill passive flat damage
    skillPassiveHealth: number;  // Skill passive flat health
    mountDamage: number;         // Mount flat damage
    mountHealth: number;         // Mount flat health

    totalDamage: number;
    totalHealth: number;
    meleeDamage: number;
    rangedDamage: number;

    // Combined multipliers (for calculation)
    damageMultiplier: number;
    healthMultiplier: number;

    // Secondary stats (from items/pets/mount - for display)
    secondaryDamageMulti: number;   // DamageMulti secondary stat
    secondaryHealthMulti: number;   // HealthMulti secondary stat
    mountedDamage: number;  // For display in UI if needed
    mountedHealth: number;  // For display in UI if needed
    skinDamageMulti: number;        // Skin Damage Multiplier (e.g. 0.10 = +10%)
    skinHealthMulti: number;        // Skin Health Multiplier
    setDamageMulti: number;         // Set Bonus Damage Multiplier
    setHealthMulti: number;         // Set Bonus Health Multiplier
    meleeDamageMultiplier: number;  // MeleeDamageMulti secondary stat
    rangedDamageMultiplier: number; // RangedDamageMulti secondary stat
    attackSpeedMultiplier: number;
    moveSpeed: number; // Multiplier (e.g. 0.1 for +10%)

    criticalChance: number;

    criticalDamage: number;
    blockChance: number;
    doubleDamageChance: number;

    healthRegen: number;
    lifeSteal: number;

    skillDamageMultiplier: number;
    skillHealthMultiplier: number;
    skillCooldownReduction: number;

    experienceMultiplier: number;
    sellPriceMultiplier: number;

    // Freebie chances (separate by target)
    forgeFreebieChance: number;
    eggFreebieChance: number;
    mountFreebieChance: number;

    isRangedWeapon: boolean;
    weaponAttackRange: number;
    weaponWindupTime: number;
    weaponAttackDuration: number;
    isAiming: boolean;

    hasProjectile: boolean;
    projectileSpeed: number;
    projectileRadius: number;
    projectileAffectedByGravity: boolean;

    skillDps: number;
    skillBuffDps: number;
    skillHps: number;
    theoreticalTotalHps: number;
    realTotalHps: number;
    weaponDps: number;
    realWeaponDps: number;  // Stepped DPS (breakpoints)
    realTotalDps: number;   // Total with stepped weapon DPS
    realAps: number;        // Stepped APS
    realCycleTime: number;   // Stepped cycle duration (s)
    realDoubleHitCycle: number;
    realDoubleHitAps: number;
    doubleHitDelay: number;
    averageTotalDps: number;

    // Power calculation
    power: number;
    powerDamageMultiplier: number;
    maxItemLevels: Record<string, number>;

    // Breakdowns
    damageBreakdown: StatBreakdown;
    healthBreakdown: StatBreakdown;
    skillDamageBreakdown: StatBreakdown;
    skillHealthBreakdown: StatBreakdown;

    // Source breakdowns for secondary stats (for detailed UI display)
    critChanceBreakdown: StatBreakdown;
    critDamageBreakdown: StatBreakdown;
    doubleDamageBreakdown: StatBreakdown;
    attackSpeedBreakdown: StatBreakdown;
    skillCooldownBreakdown: StatBreakdown;

    // Source tracking
    statCounts: Record<string, number>;

    /**
     * Per-source contribution records. Only populated when the engine is constructed with
     * trackAttribution=true (see calculateStats opts). Deliberately NOT part of DEFAULT_STATS:
     * reset() deep-clones DEFAULT_STATS, which would clone the live profile refs held here.
     */
    attribution?: StatAttribution;

    // Calculation temporary properties
    equipDamageMultiplier: number;
    equipHealthMultiplier: number;

    // Detailed hit metrics
    hitDamage: number;
    hitDamageCrit: number;
    hitDamageBuffed: number;
    hitDamageBuffedCrit: number;
    buffHitMetrics: {
        name: string;
        damage: number;
        damageCrit: number;
    }[];
}

export type StatMap = Record<string, any>;

export const DEFAULT_STATS: AggregatedStats = {
    basePlayerDamage: 10,
    basePlayerHealth: 80,
    itemDamage: 0,
    itemHealth: 0,
    weaponDamage: 0,
    petDamage: 0,
    petHealth: 0,
    skillPassiveDamage: 0,
    skillPassiveHealth: 0,
    mountDamage: 0,
    mountHealth: 0,
    totalDamage: 10,
    totalHealth: 80,
    meleeDamage: 16,
    rangedDamage: 10,
    damageMultiplier: 1,
    healthMultiplier: 1,
    secondaryDamageMulti: 0,
    secondaryHealthMulti: 0,
    mountedDamage: 0,
    mountedHealth: 0,
    skinDamageMulti: 0,
    skinHealthMulti: 0,
    setDamageMulti: 0,
    setHealthMulti: 0,
    meleeDamageMultiplier: 0,
    rangedDamageMultiplier: 0,
    attackSpeedMultiplier: 1,
    moveSpeed: 0,
    criticalChance: 0,
    criticalDamage: 1.2,
    blockChance: 0,
    doubleDamageChance: 0,
    healthRegen: 0,
    lifeSteal: 0,
    skillDamageMultiplier: 1,
    skillHealthMultiplier: 1,
    skillCooldownReduction: 0,
    experienceMultiplier: 1,
    sellPriceMultiplier: 1,
    forgeFreebieChance: 0,
    eggFreebieChance: 0,
    mountFreebieChance: 0,
    isRangedWeapon: false,
    weaponAttackRange: 1,
    weaponWindupTime: 0.5,
    weaponAttackDuration: 1.0,
    isAiming: false,
    hasProjectile: false,
    projectileSpeed: 0,
    projectileRadius: 0,
    projectileAffectedByGravity: false,
    skillDps: 0,
    skillBuffDps: 0,
    skillHps: 0,
    theoreticalTotalHps: 0,
    realTotalHps: 0,
    weaponDps: 0,
    realWeaponDps: 0,
    realTotalDps: 0,
    realAps: 0,
    realCycleTime: 0,
    realDoubleHitCycle: 0,
    realDoubleHitAps: 0,
    doubleHitDelay: 0,
    averageTotalDps: 0,
    power: 0,
    powerDamageMultiplier: 8,
    maxItemLevels: {
        'Weapon': 99,
        'Helmet': 99,
        'Body': 99,
        'Gloves': 99,
        'Belt': 99,
        'Necklace': 99,
        'Ring': 99,
        'Shoe': 99,
    },
    damageBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    healthBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    skillDamageBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    skillHealthBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    critChanceBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    critDamageBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    doubleDamageBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    attackSpeedBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    skillCooldownBreakdown: { substats: 0, tree: 0, ascension: 0, skins: 0, sets: 0, other: 0 },
    statCounts: {},
    equipDamageMultiplier: 1,
    equipHealthMultiplier: 1,
    buffHitMetrics: [],
    hitDamage: 0,
    hitDamageCrit: 0,
    hitDamageBuffed: 0,
    hitDamageBuffedCrit: 0,
};

export interface LibraryData {
    petUpgradeLibrary?: any;
    petBalancingLibrary?: any;
    petLibrary?: any;
    skillLibrary?: any;
    skillPassiveLibrary?: any;
    mountUpgradeLibrary?: any;
    techTreeLibrary?: any;
    techTreePositionLibrary?: any;
    guildTechTreePositionLibrary?: any;
    guildTechTreeUpgradeLibrary?: any;
    itemBalancingLibrary?: any;
    itemBalancingConfig?: any;
    weaponLibrary?: any;
    projectilesLibrary?: any;
    secondaryStats?: any;
    secondaryStatLibrary?: any;
    skinsLibrary?: any;
    setsLibrary?: any;
    ascensionConfigsLibrary?: any;
    // Missing fields from BattleHelper
    mainBattleLibrary?: any;
    enemyAgeScalingLibrary?: any;
    enemyLibrary?: any;
    mainBattleConfig?: any;
    hammerThiefDungeonBattleLibrary?: any;
    skillDungeonBattleLibrary?: any;
    eggDungeonBattleLibrary?: any;
    potionDungeonBattleLibrary?: any;
    mainBattleLookup?: any;
}

/** 'CriticalChanceBoost' -> 'Critical Chance Boost' (tech node types are PascalCase ids) */
function formatNodeType(nodeType: string): string {
    if (!nodeType) return 'Unknown Node';
    return nodeType.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export class StatEngine {
    private profile: UserProfile;
    private libs: LibraryData;
    private stats: AggregatedStats;
    private nodeValidityCache: Map<string, boolean> = new Map();
    private validNodesCache: Map<string, Set<number>> = new Map();
    // Trackers
    public debugLogs: string[] = [];
    public displayStats: Record<string, number> = {};

    // Tech tree modifiers stored by NODE NAME (same as Verify.tsx)
    private techModifiers: Record<string, number> = {};

    // Mapping from item slot to tech tree node name
    private static readonly slotToTechBonus: Record<string, string> = {
        'Weapon': 'WeaponBonus',
        'Helmet': 'HelmetBonus',
        'Body': 'BodyBonus',
        'Gloves': 'GloveBonus',
        'Belt': 'BeltBonus',
        'Necklace': 'NecklaceBonus',
        'Ring': 'RingBonus',
        'Shoe': 'ShoeBonus'
    };

    // Secondary stats collected separately (same as Verify.tsx)
    private secondaryStats = {
        damageMulti: 0,
        healthMulti: 0,
        meleeDamageMulti: 0,
        rangedDamageMulti: 0,
        criticalChance: 0,
        criticalDamage: 0,
        doubleDamageChance: 0,
        attackSpeed: 0,
        lifeSteal: 0,
        healthRegen: 0,
        blockChance: 0,
        skillCooldownMulti: 0,
        skillDamageMulti: 0,
        skillHealthMulti: 0,
        moveSpeed: 0,
    };

    // Mount flat stats
    private mountDamage = 0;
    private mountHealth = 0;

    // Skin multipliers (accumulated per-item in collectItemStats)
    private skinDamageMulti = 0;
    private skinHealthMulti = 0;

    // Set bonuses (from SetsLibrary.json)
    private setDamageMulti = 0;
    private setHealthMulti = 0;

    // Forge Ascension multipliers
    private forgeAscensionDamageMulti = 0;
    private forgeAscensionHealthMulti = 0;

    // Item Max Level Bonuses per slot
    private maxLevelBonuses: Record<string, number> = {
        'Weapon': 0,
        'Helmet': 0,
        'Body': 0,
        'Gloves': 0,
        'Belt': 0,
        'Necklace': 0,
        'Ring': 0,
        'Shoe': 0
    };

    private excludeSubstats: boolean;

    // Attribution tracking (opt-in: off in the optimizer/sweep hot paths)
    private trackAttribution: boolean;
    private attribution: StatAttribution = { byStat: {}, formula: {} };

    constructor(profile: UserProfile, libs: LibraryData, excludeSubstats = false, trackAttribution = false) {
        this.profile = profile;
        this.libs = libs;
        this.excludeSubstats = excludeSubstats;
        this.trackAttribution = trackAttribution;
        this.stats = { ...DEFAULT_STATS };
    }

    public calculate(): AggregatedStats {
        this.reset();
        this.loadBaseStats();

        // Phase 1: Collect Tech Tree Modifiers by NODE NAME (same as Verify.tsx)
        this.collectTechModifiers();

        // Phase 2: Collect Flat Stats (Items, Pets) with tech tree bonuses applied
        // collectItemStats also applies per-item skin multipliers
        this.collectItemStats();
        this.collectPetStats();

        // Phase 2.5: Collect Skin Set Bonuses
        this.collectSkinSetBonuses();

        // Phase 3: Collect Mount Multipliers (NOT flat stats!)
        this.collectMountStats();

        // Phase 4: Collect ALL Secondary Stats from items, pets, mount
        this.collectAllSecondaryStats();

        // Phase 5: Collect Skill Stats
        this.collectSkillStats();

        // Phase 6: Collect Tech Tree Stats (Experience, SellPrice, FreebieChance, etc.)
        this.collectTechTreeStats();

        // Phase 7: Compute Final Totals using VERIFIED formula from Verify.tsx
        this.finalizeCalculation();

        return this.stats;
    }

    public getTechModifiers(): Record<string, number> {
        return this.techModifiers;
    }

    /**
     * Helper to check recursively if a node's requirements are met
     */
    private checkNodeValidity(
        treeName: string,
        treeData: any,
        levels: Record<string, number>,
        nodeId: number,
        visited: Set<number> = new Set()
    ): boolean {
        const cacheKey = `${treeName}:${nodeId}`;
        // 1. Controllo Cache: Se lo abbiamo già calcolato in questo ciclo, ritorna il risultato immediato
        if (this.nodeValidityCache.has(cacheKey)) {
            return this.nodeValidityCache.get(cacheKey)!;
        }

        // Prevent cycles
        if (visited.has(nodeId)) return false;

        // Check level > 0
        const level = levels[nodeId];
        if (!level || level <= 0) {
            this.nodeValidityCache.set(cacheKey, false);
            return false;
        }

        // Check requirements
        const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
        if (!node) {
            this.nodeValidityCache.set(cacheKey, false);
            return false;
        }

        // Optimization: use the SAME Set reference for recursion logic (backtracking) 
        // instead of creating new Set(visited) every time to save garbage collection.
        visited.add(nodeId);

        let isValid = true;
        if (node.Requirements && node.Requirements.length > 0) {
            for (const reqId of node.Requirements) {
                // Recursive validity check
                if (!this.checkNodeValidity(treeName, treeData, levels, reqId, visited)) {
                    isValid = false;
                    break;
                }
            }
        }

        visited.delete(nodeId); // Backtrack

        // 2. Salva il risultato in Cache
        this.nodeValidityCache.set(cacheKey, isValid);
        return isValid;
    }

    private reset() {
        // Deep clone DEFAULT_STATS to ensure breakdowns (objects) don't accumulate across calculations
        this.stats = JSON.parse(JSON.stringify(DEFAULT_STATS));
        this.displayStats = {};
        this.debugLogs = [];

        // Reset attribution separately: it holds live profile references and must never be
        // routed through the DEFAULT_STATS deep clone above.
        this.attribution = { byStat: {}, formula: {} };

        // Pulisci la cache ad ogni nuovo calcolo
        this.nodeValidityCache.clear();
        this.validNodesCache.clear();

        // Reset secondary stats
        this.secondaryStats = {
            damageMulti: 0,
            healthMulti: 0,
            meleeDamageMulti: 0,
            rangedDamageMulti: 0,
            criticalChance: 0,
            criticalDamage: 0,
            doubleDamageChance: 0,
            attackSpeed: 0,
            lifeSteal: 0,
            healthRegen: 0,
            blockChance: 0,
            skillCooldownMulti: 0,
            skillDamageMulti: 0,
            skillHealthMulti: 0,
            moveSpeed: 0,
        };

        // Reset mount flat stats
        this.mountDamage = 0;
        this.mountHealth = 0;
        this.stats.mountedDamage = 0;
        this.stats.mountedHealth = 0;

        // Reset skin/set multipliers
        this.skinDamageMulti = 0;
        this.skinHealthMulti = 0;
        this.setDamageMulti = 0;
        this.setHealthMulti = 0;
        this.forgeAscensionDamageMulti = 0;
        this.forgeAscensionHealthMulti = 0;

        // Reset max levels
        this.maxLevelBonuses = { 'Weapon': 0, 'Helmet': 0, 'Body': 0, 'Gloves': 0, 'Belt': 0, 'Necklace': 0, 'Ring': 0, 'Shoe': 0 };
        this.stats.statCounts = {};
    }

    private parseBaseStats(): BasePlayerStats {
        const config = this.libs.itemBalancingConfig;
        if (!config) return DEFAULT_BASE_STATS;
        return {
            baseDamage: config.PlayerBaseDamage || 10,
            baseHealth: config.PlayerBaseHealth || 80,
            baseCritDamage: config.PlayerBaseCritDamage || 0.2,
            meleeDamageMultiplier: config.PlayerMeleeDamageMultiplier || 1.6,
            powerDamageMultiplier: config.PlayerPowerDamageMultiplier || 8.0,
            levelScalingBase: config.LevelScalingBase || 1.01,
            itemBaseMaxLevel: (config.ItemBaseMaxLevel || 98) + 1,
        };
    }

    private loadBaseStats() {
        const base = this.parseBaseStats();
        this.stats.basePlayerDamage = base.baseDamage;
        this.stats.basePlayerHealth = base.baseHealth;
        this.stats.criticalDamage = 1 + base.baseCritDamage;

        // Weapon Info
        const weapon = this.profile.items.Weapon;
        if (weapon && this.libs.weaponLibrary) {
            const baseKey = `{'Age': ${weapon.age}, 'Type': 'Weapon', 'Idx': ${weapon.idx}}`;
            const baseData = this.libs.weaponLibrary[baseKey];

            if (baseData) {
                // Determine base weapon characteristics
                const attackRange = baseData.AttackRange || 0;
                this.stats.isRangedWeapon = attackRange >= 1;
                this.stats.weaponAttackRange = attackRange;
                this.stats.isAiming = !!baseData.IsAiming;

                // Animation defaults from base weapon
                this.stats.weaponWindupTime = baseData.WindupTime || 0.5;
                this.stats.weaponAttackDuration = baseData.AttackDuration || 1.5;

                // SKIN OVERRIDE FOR ANIMATION ONLY
                if (weapon.skin && weapon.skin.idx !== undefined && (this.profile.misc.useSkinWindup !== false)) {
                    const skinAge = this.stats.isRangedWeapon ? -1001 : -1000;
                    const skinKey = `{'Age': ${skinAge}, 'Type': 'Weapon', 'Idx': ${weapon.skin.idx}}`;
                    const skinData = this.libs.weaponLibrary[skinKey];
                    if (skinData) {
                        this.stats.weaponWindupTime = skinData.WindupTime || this.stats.weaponWindupTime;
                        this.stats.weaponAttackDuration = skinData.AttackDuration || this.stats.weaponAttackDuration;
                        this.debugLogs.push(`SKIN OVERRIDE: Using animation from skin index ${weapon.skin.idx} (W:${this.stats.weaponWindupTime}s, D:${this.stats.weaponAttackDuration}s)`);
                    }
                }

                // Projectiles (Always from Base Weapon)
                const projId = baseData.ProjectileId;
                if (projId !== undefined && projId > -1 && this.libs.projectilesLibrary) {
                    const projData = this.libs.projectilesLibrary[String(projId)];
                    if (projData) {
                        this.stats.hasProjectile = true;
                        this.stats.projectileSpeed = projData.Speed || 0;
                        this.stats.projectileRadius = projData.CollisionRadius || 0;
                        this.stats.projectileAffectedByGravity = !!projData.AffectedByGravity;
                    }
                }
            }
        }
    }

    /**
     * Collect Tech Tree Modifiers by NODE NAME (same logic as Verify.tsx)
     * This stores modifiers like 'WeaponBonus', 'GloveBonus', 'PetBonusDamage', 'MountDamage', etc.
     */
    private collectTechModifiers() {
        if (!this.libs.techTreeLibrary || !this.libs.techTreePositionLibrary) return;

        const trees: ('Forge' | 'Power' | 'SkillsPetTech' | 'Clan')[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];
        for (const tree of trees) {
            const treeLevels = this.profile.techTree[tree] || {};

            if (tree === 'Clan') {
                const guildPos = this.libs.guildTechTreePositionLibrary;
                const guildUpgrade = this.libs.guildTechTreeUpgradeLibrary;
                if (!guildPos || !guildUpgrade) continue;

                // Flatten all nodes from categories to index -> type mapping
                const nodesList: string[] = [];
                for (const cat of Object.keys(guildPos)) {
                    if (guildPos[cat]?.Nodes) {
                        nodesList.push(...guildPos[cat].Nodes);
                    }
                }

                for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                    if (typeof level !== 'number' || level <= 0) continue;
                    const nodeId = parseInt(nodeIdStr);
                    const nodeType = nodesList[nodeId];
                    if (!nodeType) continue;

                    const upgradeDef = guildUpgrade[nodeType];
                    if (!upgradeDef) continue;

                    // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                    const valPerLevel = upgradeDef.ValuePerLevel || 0;
                    const totalVal = valPerLevel * level;

                    this.techModifiers[nodeType] = (this.techModifiers[nodeType] || 0) + totalVal;
                }
                continue;
            }

            const treeData = this.libs.techTreePositionLibrary[tree];
            if (!treeData?.Nodes) continue;

            // Pre-calculate valid nodes
            const validNodes = new Set<number>();
            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);
                if (this.checkNodeValidity(tree, treeData, treeLevels, nodeId)) {
                    validNodes.add(nodeId);
                }
            }

            for (const nodeId of validNodes) {
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = this.libs.techTreeLibrary[node.Type];
                if (!nodeData?.Stats) continue;

                const level = treeLevels[nodeId];
                // Use tier-specific values if available
                const tier = node.Tier ?? 0;
                const tierStat = nodeData.StatsByTier?.[tier]?.[0];
                const baseVal = tierStat?.Value ?? nodeData.Stats[0]?.Value ?? 0;
                const increment = tierStat?.ValueIncrease ?? nodeData.Stats[0]?.ValueIncrease ?? 0;
                // Calculate total value: base + (level-1) * increment
                const totalVal = baseVal + (Math.max(0, level - 1) * increment);

                // Store by node TYPE NAME (e.g., 'WeaponBonus', 'GloveBonus', 'PetBonusDamage')
                const key = node.Type;
                this.techModifiers[key] = (this.techModifiers[key] || 0) + totalVal;

                if (key === 'SkillDamage') {
                    console.log(`[DEBUG TechTree] Tree: ${tree}, NodeID: ${nodeId}, Level: ${level}, Contribution: ${totalVal.toFixed(6)}`);
                }
            }
        }

        // Apply Forge Ascension
        const forgeAscensionLevel = this.profile.misc.forgeAscensionLevel || 0;
        if (forgeAscensionLevel > 0 && this.libs.ascensionConfigsLibrary?.Forge?.AscensionConfigPerLevel) {
            const ascConfigs = this.libs.ascensionConfigsLibrary.Forge.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(forgeAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const stat of stats) {
                    const statType = stat.StatNode?.UniqueStat?.StatType;
                    const value = stat.Value + 1;
                    if (statType === 'Damage' || statType === 'AscensionDamage') this.forgeAscensionDamageMulti = value;
                    if (statType === 'Health' || statType === 'AscensionHealth') this.forgeAscensionHealthMulti = value;
                }
            }
            this.debugLogs.push(`Forge Ascension L${forgeAscensionLevel}: Damage=x${this.forgeAscensionDamageMulti.toFixed(1)}, Health=x${this.forgeAscensionHealthMulti.toFixed(1)}`);
        }

        this.debugLogs.push(`Tech Modifiers: ${JSON.stringify(this.techModifiers)}`);
    }

    private getItemTypeKey(slot: string): string {
        if (slot === 'Body') return 'Armour';
        if (slot === 'Shoe') return 'Shoes';
        return slot;
    }

    /**
     * Collect Item Stats using VERIFIED logic from Verify.tsx
     * - Uses tech tree modifiers by NODE NAME
     * - Separates weapon damage from other items
     */
    private collectItemStats() {
        if (!this.libs.itemBalancingLibrary || !this.libs.itemBalancingConfig) {
            return;
        }
        const baseStats = this.parseBaseStats();

        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

        for (const slotKey of slots) {
            const item = this.profile.items[slotKey];
            if (!item) continue;

            const jsonType = this.getItemTypeKey(slotKey);
            const key = `{'Age': ${item.age}, 'Type': '${jsonType}', 'Idx': ${item.idx}}`;
            const itemData = this.libs.itemBalancingLibrary[key];

            if (!itemData?.EquipmentStats) {
                console.warn(`Item ${slotKey} not found: ${key}`);
                this.debugLogs.push(`Item ${slotKey} not found: ${key}`);
                continue;
            }

            let dmg = 0, hp = 0;

            for (const equipStat of itemData.EquipmentStats) {
                const statType = equipStat.StatNode?.UniqueStat?.StatType;
                let value = equipStat.Value || 0;

                // Apply level scaling: 1.01^(level-1)
                const levelExponent = Math.max(0, item.level - 1);
                value = value * Math.pow(baseStats.levelScalingBase, levelExponent);

                // Apply tech tree bonus BY NODE NAME (same as Verify.tsx)
                const bonusKey = StatEngine.slotToTechBonus[slotKey];
                const bonus = this.techModifiers[bonusKey] || 0;
                value = value * (1 + bonus);

                if (statType === 'Damage') dmg += value;
                if (statType === 'Health') hp += value;
            }

            // Collect Skin Multipliers (global player-level, NOT per-item)
            // StatTarget is PlayerSkinMultiplierStatTarget => applied to total player damage/health
            if (item.skin && item.skin.stats) {
                const skinDmgBonus = item.skin.stats['Damage'] || 0;
                const skinHpBonus = item.skin.stats['Health'] || 0;
                this.skinDamageMulti += skinDmgBonus;
                this.skinHealthMulti += skinHpBonus;
                this.debugLogs.push(`SKIN ${slotKey}: idx=${item.skin.idx} Damage=+${(skinDmgBonus * 100).toFixed(1)}% Health=+${(skinHpBonus * 100).toFixed(1)}%`);
            }

            // Accumulate totals
            this.stats.itemDamage += dmg;
            this.stats.itemHealth += hp;

            // Attribution: retain the per-slot flat contribution that the accumulators above discard.
            // Recorded PRE-melee (the weapon x1.6 is surfaced as its own layer in finalizeCalculation).
            if (dmg !== 0) {
                this.track(TOTAL_DAMAGE_KEY, {
                    kind: 'item', id: `item:${slotKey}`, label: slotKey, value: dmg, op: 'add',
                    ref: { kind: 'item', slot: slotKey as any, item }
                });
            }
            if (hp !== 0) {
                this.track(TOTAL_HEALTH_KEY, {
                    kind: 'item', id: `item:${slotKey}`, label: slotKey, value: hp, op: 'add',
                    ref: { kind: 'item', slot: slotKey as any, item }
                });
            }

            // Separate weapon damage (gets base melee multiplier later)
            if (slotKey === 'Weapon') {
                this.stats.weaponDamage = dmg;

                // Check if weapon is ranged using AttackRange
                // Melee = AttackRange < 1, Ranged = AttackRange >= 1
                const weaponKey = `{'Age': ${item.age}, 'Type': 'Weapon', 'Idx': ${item.idx}}`;
                const weaponData = this.libs.weaponLibrary?.[weaponKey];
                if (weaponData) {
                    const attackRange = weaponData.AttackRange || 0;
                    this.stats.isRangedWeapon = attackRange >= 1;
                    this.stats.weaponAttackRange = attackRange;
                    this.stats.weaponWindupTime = weaponData.WindupTime || 0.5;
                    this.stats.weaponAttackDuration = weaponData.AttackDuration || 1.0;
                    this.stats.isAiming = !!weaponData.IsAiming;

                    // Projectile info
                    const projId = weaponData.ProjectileId;
                    if (projId !== undefined && projId > -1 && this.libs.projectilesLibrary) {
                        const projData = this.libs.projectilesLibrary[String(projId)];
                        if (projData) {
                            this.stats.hasProjectile = true;
                            this.stats.projectileSpeed = projData.Speed || 0;
                            this.stats.projectileRadius = projData.CollisionRadius || 0;
                            this.stats.projectileAffectedByGravity = !!projData.AffectedByGravity;
                        }
                    }

                    // skin combat stats override (Age -1000 for Melee, -1001 for Ranged)
                    if (item.skin?.idx !== undefined && this.libs.weaponLibrary && (this.profile.misc.useSkinWindup !== false)) {
                        const skinAge = this.stats.isRangedWeapon ? -1001 : -1000;
                        const skinKey = `{'Age': ${skinAge}, 'Type': 'Weapon', 'Idx': ${item.skin.idx}}`;
                        const skinWeaponData = this.libs.weaponLibrary[skinKey];

                        if (skinWeaponData) {
                            // Only override windupTime as requested
                            this.stats.weaponWindupTime = skinWeaponData.WindupTime ?? this.stats.weaponWindupTime;
                        }
                    }
                }
            }

            const techBonusKey = StatEngine.slotToTechBonus[slotKey];
            this.debugLogs.push(`Item ${slotKey}: Damage=${dmg.toFixed(0)}, Health=${hp.toFixed(0)} (bonus: ${techBonusKey}=${((this.techModifiers[techBonusKey] || 0) * 100).toFixed(1)}%)`);
        }
    }


    /**
     * Collect Skin Set Bonuses from SetsLibrary.json
     * Counts equipped set pieces across all items and applies active set tier bonuses.
     * Set bonuses are Multiplier type (e.g. +10% Damage, +10% Health).
     */
    private collectSkinSetBonuses() {
        if (!this.libs.skinsLibrary || !this.libs.setsLibrary) return;

        const slotToJsonType: Record<string, string> = {
            'Weapon': 'Weapon', 'Helmet': 'Helmet', 'Body': 'Armour',
            'Gloves': 'Gloves', 'Belt': 'Belt', 'Necklace': 'Necklace',
            'Ring': 'Ring', 'Shoe': 'Shoes'
        };

        const equippedSetCounts: Record<string, number> = {};
        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

        for (const slotKey of slots) {
            const item = this.profile.items[slotKey];
            if (!item?.skin) continue;

            const jsonType = slotToJsonType[slotKey];
            const lookupType = item.skin?.type || jsonType;
            const skinEntry = Object.values(this.libs.skinsLibrary).find(
                (s: any) => s.SkinId.Type === lookupType && s.SkinId.Idx === item.skin?.idx
            ) as any;

            this.debugLogs.push(`SET LOOKUP ${slotKey}: skinType=${lookupType} skinIdx=${item.skin.idx} found=${!!skinEntry} setId=${skinEntry?.BaseSetId || 'none'}`);

            if (skinEntry?.BaseSetId) {
                equippedSetCounts[skinEntry.BaseSetId] = (equippedSetCounts[skinEntry.BaseSetId] || 0) + 1;
            }
        }

        for (const [setId, count] of Object.entries(equippedSetCounts)) {
            const setEntry = this.libs.setsLibrary[setId];
            if (!setEntry?.BonusTiers) continue;

            for (const tier of setEntry.BonusTiers) {
                if (count >= tier.RequiredPieces) {
                    for (const stat of tier.BonusStats.Stats) {
                        const statType = stat.StatNode?.UniqueStat?.StatType;
                        const value = stat.Value || 0;
                        if (statType === 'Damage') this.setDamageMulti += value;
                        if (statType === 'Health') this.setHealthMulti += value;
                    }
                }
            }

            this.debugLogs.push(`Set ${setId}: ${count} pieces, SetDamage +${(this.setDamageMulti * 100).toFixed(0)}%, SetHealth +${(this.setHealthMulti * 100).toFixed(0)}%`);
        }
    }

    /**
     * Collect Pet Stats using VERIFIED logic from Verify.tsx
     * - Uses tech tree modifiers: PetBonusDamage, PetBonusHealth
     * - Pet level is 1-indexed in profile, but LevelInfo uses 0-indexed Level property
     */
    private collectPetStats() {
        if (!this.libs.petLibrary) return;

        const petDamageBonus = this.techModifiers['PetBonusDamage'] || 0;
        const petHealthBonus = this.techModifiers['PetBonusHealth'] || 0;

        for (let petIndex = 0; petIndex < this.profile.pets.active.length; petIndex++) {
            const pet = this.profile.pets.active[petIndex];
            const upgradeData = this.libs.petUpgradeLibrary?.[pet.rarity];
            if (!upgradeData?.LevelInfo) continue;

            // Pet level in profile is 1-indexed, JSON Level is 0-indexed
            const levelIdx = Math.max(0, pet.level - 1);
            const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];
            if (!levelInfo?.PetStats?.Stats) continue;

            const petKey = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
            const petData = this.libs.petLibrary[petKey];
            const petType = petData?.Type || 'Balanced';
            const typeMulti = this.libs.petBalancingLibrary?.[petType] || { DamageMultiplier: 1, HealthMultiplier: 1 };

            let ascensionDmgMulti = 1;
            let ascensionHpMulti = 1;
            const petAscensionLevel = this.profile.misc.petAscensionLevel || 0;
            if (petAscensionLevel > 0 && this.libs.ascensionConfigsLibrary?.Pets?.AscensionConfigPerLevel) {
                const ascConfigs = this.libs.ascensionConfigsLibrary.Pets.AscensionConfigPerLevel;
                const config = ascConfigs[Math.min(petAscensionLevel - 1, ascConfigs.length - 1)];
                if (config) {
                    const stats = config.StatContributions || [];
                    for (const s of stats) {
                        const sType = s.StatNode?.UniqueStat?.StatType;
                        const sVal = s.Value + 1;
                        if (sType === 'Damage' || sType === 'AscensionDamage') ascensionDmgMulti = sVal;
                        if (sType === 'Health' || sType === 'AscensionHealth') ascensionHpMulti = sVal;
                    }
                }
            }

            let dmg = 0, hp = 0;
            for (const stat of levelInfo.PetStats.Stats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                let value = stat.Value || 0;

                if (statType === 'Damage') {
                    value *= typeMulti.DamageMultiplier;
                    value *= (1 + petDamageBonus) * ascensionDmgMulti;
                    dmg += value;
                }
                if (statType === 'Health') {
                    value *= typeMulti.HealthMultiplier;
                    value *= (1 + petHealthBonus) * ascensionHpMulti;
                    hp += value;
                }
            }

            this.stats.petDamage += dmg;
            this.stats.petHealth += hp;

            // Attribution: dmg/hp already include tech bonus and pet ascension, so the card
            // shows the pet's true contribution and no ascension line must be re-added on top.
            const petRef: SourceRef = { kind: 'pet', index: petIndex, pet };
            const petLabel = pet.customName || `${pet.rarity} Pet`;
            if (dmg !== 0) {
                this.track(TOTAL_DAMAGE_KEY, { kind: 'pet', id: `pet:${petIndex}`, label: petLabel, value: dmg, op: 'add', ref: petRef });
            }
            if (hp !== 0) {
                this.track(TOTAL_HEALTH_KEY, { kind: 'pet', id: `pet:${petIndex}`, label: petLabel, value: hp, op: 'add', ref: petRef });
            }
            this.debugLogs.push(`Pet ${pet.rarity} ${pet.id} (${petType}) L${pet.level} Asc${petAscensionLevel}: Damage=${dmg.toFixed(0)}, Health=${hp.toFixed(0)}`);
        }
    }

    /**
     * Collect Mount MULTIPLIERS (NOT flat stats!) using VERIFIED logic from Verify.tsx
     * Mount gives % damage/health multipliers, not flat values
     */
    private collectMountStats() {
        if (!this.profile.mount.active || !this.libs.mountUpgradeLibrary) return;
        const mount = this.profile.mount.active;

        const upgradeData = this.libs.mountUpgradeLibrary[mount.rarity];
        if (!upgradeData?.LevelInfo) return;

        // Mount level in profile is 1-indexed, JSON Level is 0-indexed
        const levelIdx = Math.max(0, mount.level - 1);
        const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];

        if (levelInfo?.MountStats?.Stats) {
            for (const stat of levelInfo.MountStats.Stats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                const value = stat.Value || 0;

                // Mount stats are FLAT absolute values
                if (statType === 'Damage') this.mountDamage += value;
                if (statType === 'Health') this.mountHealth += value;
            }
        }

        // Apply tech tree bonuses MULTIPLICATIVELY (same as Verify.tsx)
        const mountDmgMulti = this.techModifiers['MountDamage'] || 0;
        const mountHpMulti = this.techModifiers['MountHealth'] || 0;

        let ascensionDmgMulti = 0;
        let ascensionHpMulti = 0;
        const mountAscensionLevel = this.profile.misc.mountAscensionLevel || 0;
        if (mountAscensionLevel > 0 && this.libs.ascensionConfigsLibrary?.Mounts?.AscensionConfigPerLevel) {
            const ascConfigs = this.libs.ascensionConfigsLibrary.Mounts.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(mountAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    const sVal = s.Value + 1;
                    if (sType === 'Damage' || sType === 'AscensionDamage') ascensionDmgMulti = sVal;
                    if (sType === 'Health' || sType === 'AscensionHealth') ascensionHpMulti = sVal;
                }
            }
        }

        this.debugLogs.push(`Mount base absolute: Damage=${this.mountDamage.toFixed(0)}, Health=${this.mountHealth.toFixed(0)}`);

        // Ascension multipliers are applied MULTIPLICATIVELY on top of tech bonuses
        this.mountDamage *= (1 + mountDmgMulti) * (ascensionDmgMulti || 1);
        this.mountHealth *= (1 + mountHpMulti) * (ascensionHpMulti || 1);

        this.debugLogs.push(`Mount final absolute: Damage=${this.mountDamage.toFixed(0)}, Health=${this.mountHealth.toFixed(0)}`);

        // Attribution: recorded after tech + ascension are folded in, so the card shows the
        // mount's true contribution. (mount is in scope from the early-return guard above.)
        const mountRef: SourceRef = { kind: 'mount', mount };
        const mountLabel = mount.customName || `${mount.rarity} Mount`;
        if (this.mountDamage !== 0) {
            this.track(TOTAL_DAMAGE_KEY, { kind: 'mount', id: 'mount', label: mountLabel, value: this.mountDamage, op: 'add', ref: mountRef });
        }
        if (this.mountHealth !== 0) {
            this.track(TOTAL_HEALTH_KEY, { kind: 'mount', id: 'mount', label: mountLabel, value: this.mountHealth, op: 'add', ref: mountRef });
        }
    }

    private incrementStatCount(statId: string) {
        this.stats.statCounts[statId] = (this.stats.statCounts[statId] || 0) + 1;
    }

    /**
     * Record a per-source contribution to a stat.
     * No-op unless attribution tracking is enabled, so hot paths pay only a boolean check.
     *
     * IMPORTANT: always pass the exact value the engine consumed - never a re-derived number,
     * or the modal totals will drift from the displayed totals.
     */
    private track(statKey: string, c: StatContribution) {
        if (!this.trackAttribution) return;
        const key = canonicalStatKey(statKey);
        (this.attribution.byStat[key] ||= []).push(c);
    }

    private trackFormula(statKey: string, formula: string) {
        if (!this.trackAttribution) return;
        (this.attribution.formula ||= {})[statKey] = formula;
    }

    /**
     * Collect ALL Secondary Stats from items, pets, mount (same as Verify.tsx)
     * These are stored separately and applied in finalizeCalculation
     */
    private collectAllSecondaryStats() {
        const collectSecondary = (statId: string, rawValue: number, ref?: SourceRef) => {
            if (rawValue > 0) {
                this.incrementStatCount(statId);
            }

            // Game displays values rounded to 2 decimals (e.g., 11.2%), so we match that precision
            // Round to 4 decimals to allow finer precision (e.g. 4.49%)
            const rounded = Math.round(rawValue * 10000) / 10000;

            // Standardized Parsing: ALL secondary stats from items/pets are stored as Percentage Points (e.g. 10.5 = 10.5%).
            // Use strict division by 100.
            const val = rounded / 100;

            // Attribution: one call covers every case below, with the exact normalized value.
            if (ref && val !== 0) {
                const id = ref.kind === 'item' ? `item:${ref.slot}`
                    : ref.kind === 'pet' ? `pet:${ref.index}`
                        : 'mount';
                const label = ref.kind === 'item' ? ref.slot
                    : ref.kind === 'pet' ? (ref.pet.customName || `Pet ${ref.index + 1}`)
                        : (ref.mount.customName || 'Mount');
                this.track(statId, { kind: ref.kind, id, label, value: val, op: 'add', ref });
            }

            switch (statId) {
                case 'DamageMulti': this.secondaryStats.damageMulti += val; break;
                case 'HealthMulti': this.secondaryStats.healthMulti += val; break;
                case 'MeleeDamageMulti': this.secondaryStats.meleeDamageMulti += val; break;
                case 'RangedDamageMulti': this.secondaryStats.rangedDamageMulti += val; break;
                case 'CriticalChance':
                    this.secondaryStats.criticalChance += val;
                    this.stats.critChanceBreakdown.substats += val;
                    break;
                case 'CriticalMulti':
                case 'CriticalDamage':
                    this.secondaryStats.criticalDamage += val;
                    this.stats.critDamageBreakdown.substats += val;
                    break;
                case 'DoubleDamageChance':
                    this.secondaryStats.doubleDamageChance += val;
                    this.stats.doubleDamageBreakdown.substats += val;
                    break;
                case 'AttackSpeed':
                    this.secondaryStats.attackSpeed += val;
                    this.stats.attackSpeedBreakdown.substats += val;
                    break;
                case 'LifeSteal': this.secondaryStats.lifeSteal += val; break;
                case 'HealthRegen': this.secondaryStats.healthRegen += val; break;
                case 'BlockChance': this.secondaryStats.blockChance += val; break;
                case 'SkillCooldownMulti':
                case 'TimerSpeed':
                    this.secondaryStats.skillCooldownMulti += val;
                    this.stats.skillCooldownBreakdown.substats += val;
                    break;
                case 'SkillDamageMulti': this.secondaryStats.skillDamageMulti += val; break;
                case 'SkillHealthMulti': this.secondaryStats.skillHealthMulti += val; break;
                case 'MoveSpeed': this.secondaryStats.moveSpeed += val; break;
            }
        };

        // From all items
        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        for (const slot of slots) {
            const item = this.profile.items[slot];
            if (item?.secondaryStats) {
                for (const sec of item.secondaryStats) {
                    collectSecondary(sec.statId, sec.value, { kind: 'item', slot, item });
                }
            }
        }

        // From all pets
        for (let petIndex = 0; petIndex < this.profile.pets.active.length; petIndex++) {
            const pet = this.profile.pets.active[petIndex];
            if (pet.secondaryStats) {
                for (const sec of pet.secondaryStats) {
                    collectSecondary(sec.statId, sec.value, { kind: 'pet', index: petIndex, pet });
                }
            }
        }

        // From mount
        // MOUNT STATS FIX: User reports they are divided too many times.
        // Profile data for Mounts seems to be 0-1 scale (e.g. 0.253), unlike Items/Pets (25.3).
        // So we skip the /100 division for Mounts by passing raw value * 100 to collectSecondary 
        // (which then divides by 100), OR we just modify collectSecondary?
        // Let's modify the loop to manually add them or create a variant.
        // Easier: Just multiply by 100 here so collectSecondary's division neutralizes it.
        const activeMount = this.profile.mount.active;
        if (activeMount?.secondaryStats) {
            for (const sec of activeMount.secondaryStats) {
                // REGRESSION HANDLING: Old profiles store Mount stats as fractions (e.g. 0.013).
                // New profiles store them as percentage points (e.g. 1.3).
                // If value < 0.5, we assume it's an old fractional value and normalize it to percentage points.
                const val = sec.value < 0.5 ? sec.value * 100 : sec.value;
                collectSecondary(sec.statId, val, { kind: 'mount', mount: activeMount });
            }
        }

        this.debugLogs.push(`Secondary Stats: DamageMulti=${(this.secondaryStats.damageMulti * 100).toFixed(1)}%, HealthMulti=${(this.secondaryStats.healthMulti * 100).toFixed(1)}%, MeleeDamageMulti=${(this.secondaryStats.meleeDamageMulti * 100).toFixed(1)}%`);
    }

    private collectSkillStats() {
        // Collect passives FROM all owned skills (not just equipped)
        if (!this.libs.skillPassiveLibrary || !this.libs.skillLibrary) return;

        // Tech tree bonuses for skill passives
        const skillPassiveDamageBonus = this.techModifiers['SkillPassiveDamage'] || 0;
        const skillPassiveHealthBonus = this.techModifiers['SkillPassiveHealth'] || 0;
        const skillActiveDamageBonus = this.techModifiers['SkillDamage'] || 0;
        const skillActiveHealthBonus = this.techModifiers['SkillDamage'] || 0;

        const passives = this.profile.skills?.passives || {};
        let totalPassiveDmg = 0;
        let totalPassiveHp = 0;

        // Global Skill Ascension bonuses
        const skillAscLevel = this.profile.misc.skillAscensionLevel || 0;
        let ascensionPassiveDmgMulti = 1;
        let ascensionPassiveHpMulti = 1;
        let ascensionActiveDmgMulti = 1;
        let ascensionActiveHpMulti = 1;

        if (skillAscLevel > 0 && this.libs.ascensionConfigsLibrary?.Skills?.AscensionConfigPerLevel) {
            const ascConfigs = this.libs.ascensionConfigsLibrary.Skills.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(skillAscLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const targetInfo = getNormalizedTarget(s.StatNode);
                    const sTarget = targetInfo.$type;
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    if (sTarget === 'ActiveSkillStatTarget') {
                        if (sType === 'Damage' || sType === 'AscensionDamage') {
                            // If it's a direct multiplier (e.g. 1.5), we use it. If it's cumulative, we add.
                            // Standard game logic: Ascension nodes usually set the multiplier or add to it.
                            ascensionActiveDmgMulti = Math.max(ascensionActiveDmgMulti, s.Value + 1);
                        }
                        if (sType === 'Health' || sType === 'AscensionHealth') {
                            ascensionActiveHpMulti = Math.max(ascensionActiveHpMulti, s.Value + 1);
                        }
                    }
                    if (sTarget === 'PassiveSkillStatTarget') {
                        if (sType === 'Damage' || sType === 'AscensionDamage') {
                            ascensionPassiveDmgMulti = Math.max(ascensionPassiveDmgMulti, s.Value + 1);
                        }
                        if (sType === 'Health' || sType === 'AscensionHealth') {
                            ascensionPassiveHpMulti = Math.max(ascensionPassiveHpMulti, s.Value + 1);
                        }
                    }
                }
            }
        }

        // Set active skill multipliers (BONUS ONLY from Tech Tree)
        // Items (substats) will be added in finalizeCalculation
        this.stats.skillDamageMultiplier = skillActiveDamageBonus;
        this.stats.skillHealthMultiplier = skillActiveHealthBonus;

        // Breakdowns for UI
        this.stats.skillDamageBreakdown.ascension = ascensionActiveDmgMulti;
        this.stats.skillDamageBreakdown.tree = skillActiveDamageBonus;
        this.stats.skillHealthBreakdown.ascension = ascensionActiveHpMulti;
        this.stats.skillHealthBreakdown.tree = skillActiveHealthBonus;

        for (const [skillId, level] of Object.entries(passives)) {
            if (typeof level !== 'number' || level <= 0) continue;

            const skillData = this.libs.skillLibrary[skillId];
            if (!skillData) continue;

            const rarity = skillData.Rarity || 'Common';
            const passiveData = this.libs.skillPassiveLibrary[rarity];
            if (!passiveData?.LevelStats) continue;

            const levelIdx = Math.max(0, Math.min(level - 1, passiveData.LevelStats.length - 1));
            const levelInfo = passiveData.LevelStats[levelIdx];
            if (!levelInfo?.Stats) continue;

            let skillBaseDmg = 0;
            let skillBaseHp = 0;

            for (const stat of levelInfo.Stats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                const baseValue = stat.Value || 0;
                if (statType === 'Damage') skillBaseDmg += baseValue;
                if (statType === 'Health') skillBaseHp += baseValue;
            }

            // Apply tech tree bonus, ascension, and ROUND to integer for EACH skill (as the game does)
            const withBonusDmg = skillBaseDmg * (1 + skillPassiveDamageBonus) * ascensionPassiveDmgMulti;
            totalPassiveDmg += Math.floor(withBonusDmg);

            const withBonusHp = skillBaseHp * (1 + skillPassiveHealthBonus) * ascensionPassiveHpMulti;
            totalPassiveHp += Math.floor(withBonusHp);
        }

        this.stats.skillPassiveDamage = totalPassiveDmg;
        this.stats.skillPassiveHealth = totalPassiveHp;
        this.debugLogs.push(`Skill Passives: Damage=${this.stats.skillPassiveDamage.toFixed(0)} (base: ${totalPassiveDmg.toFixed(0)}, +${(skillPassiveDamageBonus * 100).toFixed(0)}%), Health=${this.stats.skillPassiveHealth.toFixed(0)} (base: ${totalPassiveHp.toFixed(0)}, +${(skillPassiveHealthBonus * 100).toFixed(0)}%)`);
    }

    private collectTechTreeStats() {
        if (!this.libs.techTreeLibrary || !this.libs.techTreePositionLibrary) return;

        // Iterate again but SKIP Modifier types we already handled in `collectGlobalModifiers`
        // Modifier Types: WeaponStatTarget, EquipmentStatTarget, PetStatTarget, MountStatTarget.

        const trees: ('Forge' | 'Power' | 'SkillsPetTech' | 'Clan')[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];
        for (const tree of trees) {
            const treeLevels = this.profile.techTree[tree] || {};

            if (tree === 'Clan') {
                const guildPos = this.libs.guildTechTreePositionLibrary;
                const guildUpgrade = this.libs.guildTechTreeUpgradeLibrary;
                if (!guildPos || !guildUpgrade) continue;

                // Flatten all nodes from categories to index -> type mapping
                const nodesList: string[] = [];
                for (const cat of Object.keys(guildPos)) {
                    if (guildPos[cat]?.Nodes) {
                        nodesList.push(...guildPos[cat].Nodes);
                    }
                }

                for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                    if (typeof level !== 'number' || level <= 0) continue;
                    const nodeId = parseInt(nodeIdStr);
                    const nodeType = nodesList[nodeId];
                    if (!nodeType) continue;

                    const upgradeDef = guildUpgrade[nodeType];
                    if (!upgradeDef) continue;

                    const nodeData = this.libs.techTreeLibrary[nodeType];
                    if (!nodeData?.Stats) continue;

                    // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                    const valPerLevel = upgradeDef.ValuePerLevel || 0;
                    const totalValue = valPerLevel * level;

                    for (const stat of nodeData.Stats) {
                        if (stat.StatNode?.Condition && stat.StatNode.Condition !== 'None') {
                            continue;
                        }

                        const targetInfo = getNormalizedTarget(stat.StatNode);
                        const targetType = targetInfo.$type;
                        const statType = stat.StatNode?.UniqueStat?.StatType;

                        const isHandledByModifiers = (statType === 'Damage' || statType === 'Health') &&
                            (targetType === 'WeaponStatTarget' ||
                                targetType === 'EquipmentStatTarget' ||
                                targetType === 'PetStatTarget' ||
                                targetType === 'MountStatTarget' ||
                                targetType === 'ActiveSkillStatTarget' ||
                                targetType === 'PassiveSkillStatTarget');

                        if (isHandledByModifiers) {
                            continue;
                        }

                        this.applyStat({
                            statType: statType,
                            statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Multiplier',
                            value: totalValue,
                            target: targetType,
                            itemType: targetInfo.ItemType,
                            source: {
                                id: `tech:Clan:${nodeId}`,
                                label: `Clan Tree - ${formatNodeType(nodeType)}`,
                                detail: `Level ${level}`
                            }
                        } as any);
                    }
                }
                continue;
            }

            const treeData = this.libs.techTreePositionLibrary[tree];
            if (!treeData?.Nodes) continue;

            // Pre-calculate valid nodes
            const validNodes = new Set<number>();
            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);
                if (this.checkNodeValidity(tree, treeData, treeLevels, nodeId)) {
                    validNodes.add(nodeId);
                }
            }

            for (const nodeId of validNodes) {
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = this.libs.techTreeLibrary[node.Type];
                if (!nodeData?.Stats) continue;

                const tier = node.Tier ?? 0;
                const tierStatsArray = nodeData.StatsByTier?.[tier];

                for (let si = 0; si < nodeData.Stats.length; si++) {
                    const stat = nodeData.Stats[si];
                    if (stat.StatNode?.Condition && stat.StatNode.Condition !== 'None') {
                        continue;
                    }

                    const targetInfo = getNormalizedTarget(stat.StatNode);
                    const targetType = targetInfo.$type;
                    const statType = stat.StatNode?.UniqueStat?.StatType;

                    // Skip Damage/Health stats for specific equipment/pet/mount targets 
                    // (these are handled via collectTechModifiers for bonus multipliers)
                    const isHandledByModifiers = (statType === 'Damage' || statType === 'Health') &&
                        (targetType === 'WeaponStatTarget' ||
                            targetType === 'EquipmentStatTarget' ||
                            targetType === 'PetStatTarget' ||
                            targetType === 'MountStatTarget' ||
                            targetType === 'ActiveSkillStatTarget' ||
                            targetType === 'PassiveSkillStatTarget');

                    if (isHandledByModifiers) {
                        continue;
                    }

                    const level = treeLevels[nodeId];
                    const tierStat = tierStatsArray?.[si];
                    const baseValue = tierStat?.Value ?? stat.Value ?? 0;
                    const increase = tierStat?.ValueIncrease ?? stat.ValueIncrease ?? 0;
                    const levelFactor = Math.max(0, level - 1);
                    const totalValue = baseValue + (levelFactor * increase);

                    this.applyStat({
                        statType: statType,
                        statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Multiplier',
                        value: totalValue,
                        target: targetType,
                        itemType: targetInfo.ItemType,
                        source: {
                            id: `tech:${tree}:${nodeId}`,
                            label: `${tree} Tree - ${formatNodeType(node.Type)}`,
                            detail: `Level ${level}`
                        }
                    } as any);
                }
            }
        }
    }

    private applyStat(stat: StatEntry & { source?: { id: string; label: string; detail?: string } }) {
        const { statType, statNature, value, target, source } = stat;

        // Attribution helper: record under the key the value ACTUALLY lands on, so the
        // per-case branches below stay reconcilable against the *Breakdown fields.
        const attribute = (statKey: string) => {
            if (source && value !== 0) {
                this.track(statKey, {
                    kind: 'tech', id: source.id, label: source.label,
                    value, op: 'add', detail: source.detail
                });
            }
        };

        // Count sources
        let countKey = statType;
        if (statType === 'Damage' && statNature !== 'Additive' && !target?.includes('StatTarget')) countKey = 'DamageMulti';
        if (statType === 'Health' && statNature !== 'Additive' && !target?.includes('StatTarget')) countKey = 'HealthMulti';
        if (statType === 'CriticalDamage') countKey = 'CriticalMulti';

        // Check significant value
        if (Math.abs(value) > 0.0001) {
            this.incrementStatCount(countKey);
        }

        // Log interesting stats (Damage, Health)
        if (statType === 'Damage' || statType === 'Health' || statType.includes('Damage') || statType.includes('Health')) {
            this.debugLogs.push(`APPLY: ${statType} (${statNature}) Val: ${value.toFixed(4)} Tgt: ${target || 'None'}`);
        }

        switch (statType) {
            case 'Damage':
                if (statNature === 'Additive') {
                    // Normally handled in item/pet as flat. If Tech Tree gives 'Additive' damage it might be strange?
                    // Tech Tree usually 'Multiplier'.
                } else if (target === 'PlayerMeleeOnlyStatTarget') {
                    this.stats.meleeDamageMultiplier = this.combine(this.stats.meleeDamageMultiplier, value, statNature);
                    attribute('MeleeDamageMulti');
                } else if (target === 'PlayerRangedOnlyStatTarget') {
                    this.stats.rangedDamageMultiplier = this.combine(this.stats.rangedDamageMultiplier, value, statNature);
                    attribute('RangedDamageMulti');
                } else if (target === 'ActiveSkillStatTarget') {
                    // Skill Damage Multiplier
                    this.stats.skillDamageMultiplier = this.combine(this.stats.skillDamageMultiplier, value, statNature);
                    attribute('SkillDamageMulti');
                } else {
                    this.stats.damageMultiplier = this.combine(this.stats.damageMultiplier, value, statNature);
                    attribute('DamageMulti');
                }
                break;
            case 'Health':
                if (target === 'ActiveSkillStatTarget') {
                    this.stats.skillHealthMultiplier = this.combine(this.stats.skillHealthMultiplier, value, statNature);
                } else if (statNature !== 'Additive') {
                    this.stats.healthMultiplier = this.combine(this.stats.healthMultiplier, value, statNature);
                    attribute('HealthMulti');
                }
                break;
            case 'TimerSpeed':
            case 'SkillCooldownMulti': // Fallback if name matches
                if (target === 'ActiveSkillStatTarget' || statType === 'SkillCooldownMulti') {
                    // Check nature. Usually oneMinusMultiplier
                    this.stats.skillCooldownReduction = this.combine(this.stats.skillCooldownReduction, value, 'OneMinusMultiplier');
                    if (statNature === 'Multiplier' || statNature === 'OneMinusMultiplier') {
                        this.stats.skillCooldownBreakdown.tree += value;
                    }
                    attribute('SkillCooldownMulti');
                }
                break;
            case 'CriticalChance':
                this.stats.criticalChance = this.combine(this.stats.criticalChance, value, statNature);
                if (statNature === 'Multiplier' || statNature === 'Additive') {
                    this.stats.critChanceBreakdown.tree += value;
                }
                attribute('CriticalChance');
                break;
            case 'CriticalDamage':
                this.stats.criticalDamage = this.combine(this.stats.criticalDamage, value, statNature);
                if (statNature === 'Multiplier' || statNature === 'Additive') {
                    this.stats.critDamageBreakdown.tree += value;
                }
                attribute('CriticalMulti');
                break;
            case 'BlockChance':
                this.stats.blockChance = this.combine(this.stats.blockChance, value, statNature);
                attribute('BlockChance');
                break;
            case 'DoubleDamageChance':
                this.stats.doubleDamageChance = this.combine(this.stats.doubleDamageChance, value, statNature);
                if (statNature === 'Multiplier' || statNature === 'Additive') {
                    this.stats.doubleDamageBreakdown.tree += value;
                }
                attribute('DoubleDamageChance');
                break;
            case 'HealthRegen':
                this.stats.healthRegen = this.combine(this.stats.healthRegen, value, statNature);
                attribute('HealthRegen');
                break;
            case 'LifeSteal':
                this.stats.lifeSteal = this.combine(this.stats.lifeSteal, value, statNature);
                attribute('LifeSteal');
                break;
            case 'AttackSpeed':
                this.stats.attackSpeedMultiplier = this.combine(this.stats.attackSpeedMultiplier, value, statNature);
                if (statNature === 'Multiplier') {
                    this.stats.attackSpeedBreakdown.tree += value;
                }
                attribute('AttackSpeed');
                break;
            case 'Experience':
                this.stats.experienceMultiplier = this.combine(this.stats.experienceMultiplier, value, statNature);
                break;
            case 'SellPrice':
                this.stats.sellPriceMultiplier = this.combine(this.stats.sellPriceMultiplier, value, statNature);
                break;
            case 'FreebieChance':
                // Separate freebie chances by target type
                if (target === 'ForgeStatTarget') {
                    this.stats.forgeFreebieChance = this.combine(this.stats.forgeFreebieChance, value, statNature);
                } else if (target === 'EggStatTarget' || target === 'DungeonStatTarget') {
                    this.stats.eggFreebieChance = this.combine(this.stats.eggFreebieChance, value, statNature);
                } else if (target === 'MountStatTarget') {
                    this.stats.mountFreebieChance = this.combine(this.stats.mountFreebieChance, value, statNature);
                }
                break;
            case 'MaxLevel':
                if (target === 'WeaponStatTarget') {
                    this.maxLevelBonuses['Weapon'] += value;
                } else if (target === 'EquipmentStatTarget') {
                    const itemType = (stat as any).itemType;
                    const typeToSlot: Record<number, string> = {
                        0: 'Helmet', 1: 'Body', 2: 'Gloves', 3: 'Necklace', 4: 'Ring', 6: 'Shoe', 7: 'Belt'
                    };
                    const slot = typeToSlot[itemType];
                    if (slot) {
                        this.maxLevelBonuses[slot] += value;
                    }
                }
                break;
        }
    }

    private combine(current: number, added: number, nature: StatNature): number {
        switch (nature) {
            case 'Multiplier':
                return current + added;
            case 'Additive':
                return current + added;
            case 'OneMinusMultiplier':
                return 1 - (1 - current) * (1 - added);
            case 'Divisor':
                return current * added;
            default:
                return current + added;
        }
    }

    /**
     * Finalize Calculation using EXACT VERIFIED FORMULA from Verify.tsx
     * 
     * Formula:
     * 1. Apply base melee (1.6x) to weapon damage in flat total
     * 2. Mount and DamageMulti/HealthMulti are ADDITIVE to each other
     * 3. MeleeDamageMulti is applied MULTIPLICATIVELY afterwards
     * 
     * FinalDamage = (Flat with weapon melee) × (1 + Mount + DamageMulti) × (1 + MeleeDamageMulti) × Correction
     * FinalHealth = FlatHealth × (1 + Mount + HealthMulti) × Correction
     * Power = (DamageBeforeCorrection × 10 + HealthBeforeCorrection × 8) × Correction
     */
    private finalizeCalculation() {
        const baseStats = this.parseBaseStats();

        // Compute final max levels per slot
        const baseMax = baseStats.itemBaseMaxLevel;
        const slots: string[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        for (const slotKey of slots) {
            this.stats.maxItemLevels[slotKey] = baseMax + (this.maxLevelBonuses[slotKey] || 0);
        }

        const isWeaponMelee = !this.stats.isRangedWeapon;

        // 1. Apply base melee multiplier to weapon damage ONLY
        const weaponWithMelee = isWeaponMelee
            ? this.stats.weaponDamage * baseStats.meleeDamageMultiplier
            : this.stats.weaponDamage;

        // 2. Other item damage (armor, helmet, etc.) - NO melee base
        const otherItemDamage = this.stats.itemDamage - this.stats.weaponDamage;

        // 3. Flat totals (including skill passive bonuses and mount)
        const flatDamageWithMelee = this.stats.basePlayerDamage + weaponWithMelee + otherItemDamage + this.stats.petDamage + this.stats.skillPassiveDamage + this.mountDamage;
        const flatHealth = this.stats.basePlayerHealth + this.stats.itemHealth + this.stats.petHealth + this.stats.skillPassiveHealth + this.mountHealth;

        this.debugLogs.push(`Flat Stats: Damage=${flatDamageWithMelee.toFixed(0)} (skillPassive: ${this.stats.skillPassiveDamage.toFixed(0)}, mount: ${this.mountDamage.toFixed(0)}), Health=${flatHealth.toFixed(0)} (skillPassive: ${this.stats.skillPassiveHealth.toFixed(0)}, mount: ${this.mountHealth.toFixed(0)})`);

        // 4. Multiplier Layers
        // - Global/Common Layer: Tech Tree "Damage" nodes and Item "DamageMulti" secondary stats
        // NEW-STATS TOGGLE (excludeSubstats): the item DMG%/HP% (and Melee/Ranged) substats are
        // excluded from POWER ONLY. The Damage/Health readouts ALWAYS include them, so flipping
        // the toggle changes Power alone and never the displayed damage/health.
        const itemDmgMulti = this.secondaryStats.damageMulti;
        const itemHpMulti = this.secondaryStats.healthMulti;
        const commonDamageMulti = this.stats.damageMultiplier + itemDmgMulti;
        const commonHealthMulti = this.stats.healthMultiplier + itemHpMulti;
        // Power-only variant of the same layer
        const commonDamageMultiPow = this.stats.damageMultiplier + (this.excludeSubstats ? 0 : itemDmgMulti);
        const commonHealthMultiPow = this.stats.healthMultiplier + (this.excludeSubstats ? 0 : itemHpMulti);

        // Merge other secondary stats into final results (summing Tech Tree + Items/Pets)
        this.stats.criticalChance = this.combine(this.stats.criticalChance, this.secondaryStats.criticalChance, 'Additive');
        this.stats.criticalDamage = this.combine(this.stats.criticalDamage, this.secondaryStats.criticalDamage, 'Additive');
        this.stats.doubleDamageChance = this.combine(this.stats.doubleDamageChance, this.secondaryStats.doubleDamageChance, 'Additive');
        this.stats.blockChance = this.combine(this.stats.blockChance, this.secondaryStats.blockChance, 'Additive');
        this.stats.attackSpeedMultiplier = this.combine(this.stats.attackSpeedMultiplier, this.secondaryStats.attackSpeed, 'Multiplier');
        this.stats.healthRegen = this.combine(this.stats.healthRegen, this.secondaryStats.healthRegen, 'Multiplier');
        this.stats.lifeSteal = this.combine(this.stats.lifeSteal, this.secondaryStats.lifeSteal, 'Multiplier');
        this.stats.skillCooldownReduction = this.combine(this.stats.skillCooldownReduction, this.secondaryStats.skillCooldownMulti, 'OneMinusMultiplier');
        // Skill multipliers: add item substats as additive bonus
        // SkillDamageMulti applies to both Damage and Healing of active skills
        this.stats.skillDamageMultiplier += this.secondaryStats.skillDamageMulti;
        this.stats.skillHealthMultiplier += (this.secondaryStats.skillHealthMulti + this.secondaryStats.skillDamageMulti);
        this.stats.moveSpeed = this.combine(this.stats.moveSpeed, this.secondaryStats.moveSpeed, 'Additive');

        // Populate detailed breakdowns for secondary stats
        this.stats.skillDamageBreakdown.substats = this.secondaryStats.skillDamageMulti;
        this.stats.skillHealthBreakdown.substats = (this.secondaryStats.skillHealthMulti + this.secondaryStats.skillDamageMulti);

        // Apply Skill Ascension to skill multipliers (MIRRORS Forge Ascension for equipment)
        // Pattern: skillEffective = (1 + techBonus + itemBonus) * skillAscension
        // At this point skillDamageMultiplier = techBonus + itemBonus (both are additive bonuses)
        const skillAscDmg = this.stats.skillDamageBreakdown.ascension || 1;
        const skillAscHp = this.stats.skillHealthBreakdown.ascension || 1;
        this.stats.skillDamageMultiplier = (1 + this.stats.skillDamageMultiplier) * skillAscDmg;
        this.stats.skillHealthMultiplier = (1 + this.stats.skillHealthMultiplier) * skillAscHp;

        // Crit Damage has a base component (e.g. 1.2x)
        (this.stats.critDamageBreakdown as any).base = baseStats.baseCritDamage;

        // - Equipment-Only Layer: Common + Forge Ascension
        // This ONLY applies to the flat damage/health from Items/Equipment.
        const equipDamageMulti = commonDamageMulti * (this.forgeAscensionDamageMulti || 1);
        const equipHealthMulti = commonHealthMulti * (this.forgeAscensionHealthMulti || 1);

        this.debugLogs.push(`Calculation Layers: CommonDmg=${commonDamageMulti.toFixed(3)}, EquipDmg=${equipDamageMulti.toFixed(3)} (Forge: +${this.forgeAscensionDamageMulti.toFixed(3)})`);

        // 5. Final Calculation by Buckets
        // (Equipment) * EquipMulti + (Systems) * CommonMulti
        const equipContributionDmg = (this.stats.basePlayerDamage + weaponWithMelee + otherItemDamage) * equipDamageMulti;
        const equipContributionHp = (this.stats.basePlayerHealth + this.stats.itemHealth) * equipHealthMulti;

        const systemContributionDmg = (this.stats.petDamage + this.stats.skillPassiveDamage + this.mountDamage) * commonDamageMulti;
        const systemContributionHp = (this.stats.petHealth + this.stats.skillPassiveHealth + this.mountHealth) * commonHealthMulti;

        // Populate breakdowns for GENERIC Multipliers
        // Note: Tree contribution was already tracked in applyStat during collectTechTreeStats
        this.stats.damageBreakdown.substats = this.secondaryStats.damageMulti - this.stats.damageBreakdown.tree;
        // Ascension includes Forge global gear multi
        this.stats.damageBreakdown.ascension = this.forgeAscensionDamageMulti;
        this.stats.damageBreakdown.skins = this.skinDamageMulti;
        this.stats.damageBreakdown.sets = this.setDamageMulti;
        this.stats.damageBreakdown.other = 0;

        this.stats.healthBreakdown.substats = this.secondaryStats.healthMulti - this.stats.healthBreakdown.tree;
        this.stats.healthBreakdown.ascension = this.forgeAscensionHealthMulti;
        this.stats.healthBreakdown.skins = this.skinHealthMulti;
        this.stats.healthBreakdown.sets = this.setHealthMulti;
        this.stats.healthBreakdown.other = 0;

        let totalDmgBeforeGlobal = equipContributionDmg + systemContributionDmg;
        let totalHpBeforeGlobal = equipContributionHp + systemContributionHp;

        // 6. Distinct Multipliers: Skin and Sets (Multiplied to everything)
        const skinDmgFactor = 1 + this.skinDamageMulti;
        const skinHpFactor = 1 + this.skinHealthMulti;
        const setDmgFactor = this.setDamageMulti;
        const setHpFactor = this.setHealthMulti;

        const globalFactorDmg = (skinDmgFactor + setDmgFactor);
        const globalFactorHp = (skinHpFactor + setHpFactor);

        const damageAfterGlobalMultis = totalDmgBeforeGlobal * globalFactorDmg;
        const healthAfterGlobalMultis = totalHpBeforeGlobal * globalFactorHp;

        // 7. Melee/Ranged Specific Multipliers (Applied to everything at the end)
        const itemMeleeDmgMulti = this.secondaryStats.meleeDamageMulti;
        const itemRangedDmgMulti = this.secondaryStats.rangedDamageMulti;
        const specificDamageMulti = isWeaponMelee
            ? (1 + itemMeleeDmgMulti)
            : (1 + itemRangedDmgMulti);
        // Power-only variant (Melee/Ranged substats dropped when the New-Stats toggle is on)
        const specificDamageMultiPow = isWeaponMelee
            ? (1 + (this.excludeSubstats ? 0 : itemMeleeDmgMulti))
            : (1 + (this.excludeSubstats ? 0 : itemRangedDmgMulti));

        const finalDamage = damageAfterGlobalMultis * specificDamageMulti;

        // Parallel POWER chain: identical arithmetic with the power-only multiplier variants, so
        // Power reflects the New/Old toggle while Damage/Health stay invariant.
        const equipDamageMultiPow = commonDamageMultiPow * (this.forgeAscensionDamageMulti || 1);
        const equipHealthMultiPow = commonHealthMultiPow * (this.forgeAscensionHealthMulti || 1);
        const powDmgBeforeGlobal =
            (this.stats.basePlayerDamage + weaponWithMelee + otherItemDamage) * equipDamageMultiPow
            + (this.stats.petDamage + this.stats.skillPassiveDamage + this.mountDamage) * commonDamageMultiPow;
        const powHpBeforeGlobal =
            (this.stats.basePlayerHealth + this.stats.itemHealth) * equipHealthMultiPow
            + (this.stats.petHealth + this.stats.skillPassiveHealth + this.mountHealth) * commonHealthMultiPow;
        const powerDamageTotal = powDmgBeforeGlobal * globalFactorDmg * specificDamageMultiPow;
        const powerHealthTotal = powHpBeforeGlobal * globalFactorHp;

        this.debugLogs.push(`After SpecificMulti (×${specificDamageMulti.toFixed(3)}): Damage=${finalDamage.toFixed(0)}`);

        // 8. Final stats
        this.stats.totalDamage = finalDamage;
        this.stats.totalHealth = healthAfterGlobalMultis;

        // --- Attribution: base values, multiplier layers and formulas for the total views ---
        if (this.trackAttribution) {
            const line = (key: string, id: string, label: string, value: number, op: 'add' | 'mul', kind: any = 'base', detail?: string) => {
                this.track(key, { kind, id, label, value, op, detail });
            };

            // Base player stats
            line(TOTAL_DAMAGE_KEY, 'base:player', 'Base player damage', this.stats.basePlayerDamage, 'add');
            line(TOTAL_HEALTH_KEY, 'base:player', 'Base player health', this.stats.basePlayerHealth, 'add');
            line('CriticalMulti', 'base:critDamage', 'Base critical damage', baseStats.baseCritDamage, 'add');

            // Skill passives (no card component exists for skills)
            if (this.stats.skillPassiveDamage !== 0) {
                line(TOTAL_DAMAGE_KEY, 'skill:passives', 'Skill passives', this.stats.skillPassiveDamage, 'add', 'skill');
            }
            if (this.stats.skillPassiveHealth !== 0) {
                line(TOTAL_HEALTH_KEY, 'skill:passives', 'Skill passives', this.stats.skillPassiveHealth, 'add', 'skill');
            }

            // Weapon melee base multiplier is a damage-only layer on the weapon's flat value
            if (isWeaponMelee) {
                line(TOTAL_DAMAGE_KEY, 'base:melee', `Melee weapon base (weapon flat only)`, baseStats.meleeDamageMultiplier, 'mul');
            }

            // Ordered multiplier layers, in application order
            line(TOTAL_DAMAGE_KEY, 'layer:common', 'Common multiplier (tech + damage % substats)', commonDamageMulti, 'mul', 'tech');
            line(TOTAL_HEALTH_KEY, 'layer:common', 'Common multiplier (tech + health % substats)', commonHealthMulti, 'mul', 'tech');

            if (this.forgeAscensionDamageMulti) {
                line(TOTAL_DAMAGE_KEY, 'asc:forge', 'Forge ascension (equipment only)', this.forgeAscensionDamageMulti, 'mul', 'ascension');
            }
            if (this.forgeAscensionHealthMulti) {
                line(TOTAL_HEALTH_KEY, 'asc:forge', 'Forge ascension (equipment only)', this.forgeAscensionHealthMulti, 'mul', 'ascension');
            }

            line(TOTAL_DAMAGE_KEY, 'layer:global', 'Skins + set bonuses', globalFactorDmg, 'mul', 'skin');
            line(TOTAL_HEALTH_KEY, 'layer:global', 'Skins + set bonuses', globalFactorHp, 'mul', 'skin');

            line(TOTAL_DAMAGE_KEY, 'layer:specific', isWeaponMelee ? 'Melee damage %' : 'Ranged damage %', specificDamageMulti, 'mul');

            this.trackFormula(TOTAL_DAMAGE_KEY,
                '(base + equipment x forgeAsc + pets/mount/skills) x common x (skins + sets) x melee|ranged %');
            this.trackFormula(TOTAL_HEALTH_KEY,
                '(base + equipment x forgeAsc + pets/mount/skills) x common x (skins + sets)');
        }

        // Store the Common layer for skills/pets/mounts
        // Includes ONLY: Tech Tree Damage + Item DamageMulti substats
        // EXCLUDES: Skins and Sets (per user request)
        this.stats.damageMultiplier = commonDamageMulti;
        this.stats.healthMultiplier = commonHealthMulti;
        this.stats.skinDamageMulti = skinDmgFactor - 1; // Store for UI display
        this.stats.setDamageMulti = setDmgFactor - 1;   // Store for UI display

        // Also keep track of the equipment specific multiplier for UI display/item tooltips if needed
        this.stats.equipDamageMultiplier = equipDamageMulti;
        this.stats.equipHealthMultiplier = equipHealthMulti;

        this.stats.secondaryDamageMulti = this.secondaryStats.damageMulti;
        this.stats.secondaryHealthMulti = this.secondaryStats.healthMulti;
        this.stats.mountDamage = this.mountDamage;
        this.stats.mountHealth = this.mountHealth;
        this.stats.mountedDamage = this.mountDamage;
        this.stats.mountedHealth = this.mountHealth;
        this.stats.skinDamageMulti = this.skinDamageMulti;
        this.stats.skinHealthMulti = this.skinHealthMulti;
        this.stats.setDamageMulti = this.setDamageMulti;
        this.stats.setHealthMulti = this.setHealthMulti;
        this.stats.meleeDamageMultiplier = this.secondaryStats.meleeDamageMulti;
        this.stats.rangedDamageMultiplier = this.secondaryStats.rangedDamageMulti;

        const flatDamageNoMelee = this.stats.basePlayerDamage + this.stats.itemDamage + this.stats.petDamage;

        // Melee/Ranged specific damage (for display)
        // Note: For display, we use the damageMultiplier (Common) as the base
        const globalDmgDisplayFactor = this.stats.damageMultiplier * (skinDmgFactor + setDmgFactor);
        this.stats.meleeDamage = isWeaponMelee ? this.stats.totalDamage : (flatDamageWithMelee * globalDmgDisplayFactor * (1 + itemMeleeDmgMulti));
        this.stats.rangedDamage = !isWeaponMelee ? this.stats.totalDamage : (flatDamageNoMelee * globalDmgDisplayFactor * (1 + itemRangedDmgMulti));

        // --- Calculate Detailed Hit Metrics ---
        this.stats.hitDamage = finalDamage;
        this.stats.hitDamageCrit = finalDamage * this.stats.criticalDamage;

        // Calculate Buff Power Sum
        let totalBuffPower = 0;
        const BUFF_SKILLS = ["Meat", "Morale", "Berserk", "Buff", "HigherMorale"];
        const equipped = this.profile.skills.equipped || [];
        const skillFactor = this.stats.skillDamageMultiplier || 1;
        const globalFactor = this.stats.damageMultiplier || 1;
        const totalDamageMulti = skillFactor * globalFactor;

        if (this.libs.skillLibrary) {
            equipped.forEach(slot => {
                if (BUFF_SKILLS.includes(slot.id)) {
                    const skillConfig = this.libs.skillLibrary![slot.id];
                    if (skillConfig && skillConfig.DamagePerLevel) {
                        const levelIdx = Math.max(0, slot.level - 1);
                        if (skillConfig.DamagePerLevel.length > levelIdx) {
                            const baseDamage = skillConfig.DamagePerLevel[levelIdx];
                            totalBuffPower += (baseDamage * totalDamageMulti);
                        }
                    }
                }
            });
        }

        this.stats.hitDamageBuffed = finalDamage + totalBuffPower;
        this.stats.hitDamageBuffedCrit = this.stats.hitDamageBuffed * this.stats.criticalDamage;

        // --- Calculate Dynamic Buff Combinations ---
        this.stats.buffHitMetrics = [];
        const activeBuffs: { id: string; power: number }[] = [];
        const BUFF_NAME_MAPPING: Record<string, string> = {
            "Meat": "Meat",
            "Morale": "Morale",
            "Berserk": "Berserk",
            "Buff": "Buff",
            "HigherMorale": "H. Morale"
        };

        if (this.libs.skillLibrary) {
            equipped.forEach(slot => {
                if (BUFF_SKILLS.includes(slot.id)) {
                    const skillConfig = this.libs.skillLibrary![slot.id];
                    if (skillConfig && skillConfig.DamagePerLevel) {
                        const levelIdx = Math.max(0, slot.level - 1);
                        if (skillConfig.DamagePerLevel.length > levelIdx) {
                            const baseDamage = skillConfig.DamagePerLevel[levelIdx];
                            activeBuffs.push({
                                id: slot.id,
                                power: baseDamage * totalDamageMulti
                            });
                        }
                    }
                }
            });
        }

        // Generate Power Set (excluding empty set which is the normal Hit damage already shown)
        const getPowerSet = (list: typeof activeBuffs) => {
            const results: (typeof activeBuffs)[] = [];
            for (let i = 1; i < (1 << list.length); i++) {
                const subset: typeof activeBuffs = [];
                for (let j = 0; j < list.length; j++) {
                    if ((i >> j) & 1) subset.push(list[j]);
                }
                results.push(subset);
            }
            return results;
        };

        const combinations = getPowerSet(activeBuffs);

        // Filter out the "Full" combination because it's already shown in "All Buffs Active"
        const filteredCombinations = combinations.filter(subset => subset.length < activeBuffs.length);

        // Sort combinations by number of buffs, then alphabetically
        filteredCombinations.sort((a, b) => {
            if (a.length !== b.length) return a.length - b.length;
            return a.map(x => x.id).join().localeCompare(b.map(x => x.id).join());
        });

        filteredCombinations.forEach(subset => {
            const name = subset.map(s => BUFF_NAME_MAPPING[s.id] || s.id).join(" + ");
            const extraDamage = subset.reduce((sum, s) => sum + s.power, 0);
            const total = finalDamage + extraDamage;
            this.stats.buffHitMetrics.push({
                name: name,
                damage: total,
                damageCrit: total * this.stats.criticalDamage
            });
        });

        // Power calculation - GHIDRA REVERSE ENGINEERED FORMULA (VERIFIED):
        // Power = ((Damage - 10) × 8 + (Health - 80)) × 3
        const powerDmgMulti = this.stats.powerDamageMultiplier || 8.0;
        const baseDmg = this.stats.basePlayerDamage; // 10.0
        const baseHp = this.stats.basePlayerHealth;  // 80.0

        // Power tracks the New/Old toggle ALONE: it is computed from the parallel power chain
        // (item DMG%/HP% + Melee/Ranged substats dropped in New mode), while the displayed
        // damage/health always include those substats and therefore never move with the toggle.
        const basePower = ((powerDamageTotal - baseDmg) * powerDmgMulti + (powerHealthTotal - baseHp)) * 3;
        this.stats.power = Math.round(basePower);

        // Attribution: Power is a formula over the two totals, not a sum of sources.
        // Record the two inputs and the constants; the Damage/Health modals hold the detail.
        if (this.trackAttribution) {
            this.track(TOTAL_POWER_KEY, {
                kind: 'base', id: 'power:damage', label: 'Total damage (above base)', op: 'add',
                value: powerDamageTotal - baseDmg, detail: `x${powerDmgMulti} - see Total Damage for its sources`
            });
            this.track(TOTAL_POWER_KEY, {
                kind: 'base', id: 'power:health', label: 'Total health (above base)', op: 'add',
                value: powerHealthTotal - baseHp, detail: 'see Total Health for its sources'
            });
            this.track(TOTAL_POWER_KEY, {
                kind: 'base', id: 'power:scale', label: 'Power scaling constant', value: 3, op: 'mul'
            });
            this.trackFormula(TOTAL_POWER_KEY,
                `((Damage - ${baseDmg}) x ${powerDmgMulti} + (Health - ${baseHp})) x 3`);
        }



        // Move Speed
        this.stats.moveSpeed = this.secondaryStats.moveSpeed;

        this.stats.experienceMultiplier = this.combine(this.stats.experienceMultiplier, 0, 'Multiplier');

        this.debugLogs.push(`FINAL: Damage=${this.stats.totalDamage.toFixed(0)}, Health=${this.stats.totalHealth.toFixed(0)}, Power=${this.stats.power.toFixed(0)}`);

        // Skill DPS Calculation
        if (this.libs.skillLibrary) {
            for (const skill of this.profile.skills.equipped) {
                const skillData = this.libs.skillLibrary[skill.id];
                if (!skillData) continue;

                const levelIdx = Math.max(0, skill.level - 1);
                const baseSkillDmg = skillData.DamagePerLevel?.[levelIdx] || 0;
                const baseSkillHeal = skillData.HealthPerLevel?.[levelIdx] || 0;
                const cooldown = skillData.Cooldown || 1;

                const cdMult = Math.max(0.1, 1 - this.stats.skillCooldownReduction);
                const finalCd = Math.max(0.1, cooldown * cdMult);

                if (baseSkillDmg > 0 || baseSkillHeal > 0) {
                    // SKILL DPS FORMULA (mirrors Forge Ascension for equipment)
                    // 
                    // For Equipment:  equipMulti = commonDamageMulti * forgeAscension
                    // For Skills:     skillMulti = (1 + skillTech + skillItems) * skillAscension
                    //
                    // Then: effectiveMultiplier = skillMulti * commonDamageMulti
                    //
                    // This ensures:
                    // 1. Skill Ascension scales ALL skill-specific bonuses (tech + items)
                    // 2. Common/Global bonuses (tech tree dmg, item dmg%) apply on top
                    // 3. The ratio between two builds stays constant across ascension levels
                    
                    const skillMulti = this.stats.skillDamageMultiplier; // Already = (1 + tech + items) * ascension
                    const commonMulti = this.stats.damageMultiplier;     // Common layer (tech tree + item dmg%)
                    const effectiveMultiplier = skillMulti * commonMulti;

                    // Technical Debug Log
                    const ascensionMulti = this.stats.skillDamageBreakdown.ascension || 1;
                    console.group(`[CALC] Active Skill Multiplier - ${skill.id} (L${skill.level})`);
                    console.log(`Base Skill Value: ${baseSkillDmg}`);
                    console.log(`--- Skill Layer (mirrors Forge Ascension) ---`);
                    console.log(`  Base:                1.0`);
                    console.log(`  + Tech (SkillDmg):   +${(this.stats.skillDamageBreakdown.tree || 0).toFixed(4)}`);
                    console.log(`  + Items (SkillDmg):  +${(this.stats.skillDamageBreakdown.substats || 0).toFixed(4)}`);
                    console.log(`  × Skill Ascension:   ×${ascensionMulti.toFixed(0)}`);
                    console.log(`  = Skill Multi:       ${skillMulti.toFixed(4)}`);
                    console.log(`--- Common Layer ---`);
                    console.log(`  Common Multi:        ${commonMulti.toFixed(4)}`);
                    console.log(`--- Result ---`);
                    console.log(`  Effective: ${skillMulti.toFixed(4)} × ${commonMulti.toFixed(4)} = ${effectiveMultiplier.toFixed(4)}`);
                    console.log(`  DPS Contrib: ${baseSkillDmg} × ${effectiveMultiplier.toFixed(4)} = ${(baseSkillDmg * effectiveMultiplier).toFixed(0)}`);
                    console.groupEnd();

                    const BUFF_SKILLS = ["Meat", "Morale", "Berserk", "Buff", "HigherMorale", "0", "1", "6", "12", "13"];
                    const isBuffSkill = BUFF_SKILLS.includes(String(skill.id));

                    if (isBuffSkill) {
                        const skillVal = baseSkillDmg > 0 ? baseSkillDmg : baseSkillHeal;
                        const finalBonus = skillVal * effectiveMultiplier;

                        // Uptime calculation (average contribution)
                        const duration = skillData.ActiveDuration || 0;
                        const cycle = finalCd + duration;
                        const uptime = duration / Math.max(0.1, cycle);

                        // Buff damage benefits from weapon stats (Power x APS x Crit x Double)
                        const aps = 1 / (this.stats.weaponAttackDuration / this.stats.attackSpeedMultiplier);
                        const critMult = 1 + Math.min(this.stats.criticalChance, 1) * (this.stats.criticalDamage - 1);
                        const doubleMult = 1 + Math.min(this.stats.doubleDamageChance, 1);

                        const averageBonusDps = finalBonus * aps * critMult * doubleMult * uptime;
                        this.stats.skillBuffDps += averageBonusDps;
                    } else {
                        // Regular damage skill
                        if (baseSkillDmg > 0) {
                            const mechanics = SKILL_MECHANICS[String(skill.id)] || { count: 1 };
                            const hitCount = mechanics.count || 1;
                            // Library damage is the TOTAL per activation. `count` is a DIVISOR for
                            // multi-projectile / multi-pulse skills (total stays = Damage) and is a
                            // MULTIPLIER only when damageIsPerHit (each hit deals the full Damage).
                            // Mirrors BattleSimulator; RE'd from libil2cpp.so (GetSkillDamageCount).
                            const buffedTotal = baseSkillDmg * effectiveMultiplier;
                            const perHit = mechanics.damageIsPerHit ? buffedTotal : buffedTotal / hitCount;
                            const totalDmgPerActivation = perHit * hitCount;
                            this.stats.skillDps += totalDmgPerActivation / finalCd;
                        }
                    }

                    if (baseSkillHeal > 0) {
                        // SKILL HEALING (Same pattern as damage)
                        // Use damageMultiplier as the common layer for active skills (per user request)
                        const hSkillMulti = this.stats.skillHealthMultiplier; // (1 + tech + items) * ascension
                        const hCommonMulti = this.stats.damageMultiplier;
                        const hEffectiveMultiplier = hSkillMulti * hCommonMulti;

                        console.group(`[CALC] Skill Healing - ${skill.id} (L${skill.level})`);
                        console.log(`Base: ${baseSkillHeal}, SkillMulti: ${hSkillMulti.toFixed(4)}, CommonMulti: ${hCommonMulti.toFixed(4)}, Effective: ${hEffectiveMultiplier.toFixed(4)}`);
                        console.groupEnd();

                        const healPerHit = baseSkillHeal * hEffectiveMultiplier;
                        this.stats.skillHps += healPerHit / finalCd;
                    }
                } // Final closing of (baseSkillDmg > 0 || baseSkillHeal > 0)
            } // end for
        } // end if library

        // Final DPS Synchronization (Weapon + Damage Skills + Buff Skills)
        const critMult = 1 + Math.min(this.stats.criticalChance, 1) * (this.stats.criticalDamage - 1);
        const doubleMult = 1 + Math.min(this.stats.doubleDamageChance, 1);

        // AVERAGE WEAPON DPS (Theoretical - used for simple summary)
        const simpleAps = 1 / (this.stats.weaponAttackDuration / this.stats.attackSpeedMultiplier);
        this.stats.weaponDps = this.stats.totalDamage * simpleAps * critMult * doubleMult;
        this.stats.averageTotalDps = this.stats.weaponDps + this.stats.skillDps + (this.stats.skillBuffDps || 0);

        // REAL-TIME STEPPED CALCULATION (Breakpoints)
        // Formula: cycle = floor(base / speed * 10) / 10 + 0.2
        const speedMult = this.stats.attackSpeedMultiplier;
        const baseDuration = this.stats.weaponAttackDuration || 1.5;
        const baseWindup = this.stats.weaponWindupTime || 0.5;

        // Reverse-engineered from libil2cpp.so (2.8.2): combat runs at 10 sim-ticks/s with one
        // continuous AttackTimer. The single-attack interval is WINDUP-INDEPENDENT
        // (= ceil(AttackDuration/inc)+1 ticks); only the double second-strike delay depends on windup
        // (the timer is re-seeded to windup*0.75). See constants.ts attackIntervalSeconds / doubleDelaySeconds.
        const steppedCycle = attackIntervalSeconds(speedMult, baseDuration);
        const steppedDoubleDelay = doubleDelaySeconds(speedMult, baseWindup);
        this.stats.doubleHitDelay = baseWindup * 0.25;
        const doubleHitCycle = steppedCycle + steppedDoubleDelay;

        // WEIGHTED AVERAGE REAL DPS (The "Second Table" logic)
        // Correct Real APS = (1 + Chance) / ((1 - Chance) * NormalCycle + Chance * DoubleCycle)
        const dChance = Math.min(this.stats.doubleDamageChance, 1);
        const averageRealCycle = (1 - dChance) * steppedCycle + dChance * doubleHitCycle;
        const weightedAps = (1 + dChance) / averageRealCycle;

        this.stats.realCycleTime = steppedCycle;
        this.stats.realDoubleHitCycle = doubleHitCycle;
        this.stats.realAps = weightedAps;
        this.stats.realDoubleHitAps = 2 / doubleHitCycle; // Stats only for pure double hit phase 

        this.stats.realWeaponDps = this.stats.totalDamage * weightedAps * critMult;
        this.stats.realTotalDps = this.stats.realWeaponDps + this.stats.skillDps + (this.stats.skillBuffDps || 0);

        // --- HPS CALCULATION (Theoretical vs Real-Time) ---
        const regen = this.stats.totalHealth * this.stats.healthRegen;
        const skills = this.stats.skillHps;
        const blockChance = Math.min(this.stats.blockChance || 0, 0.95);
        const blockFactor = 1 / (1 - blockChance);

        // Theoretical HPS (based on Theoretical Weapon DPS)
        const lifestealTheo = this.stats.weaponDps * this.stats.lifeSteal;
        this.stats.theoreticalTotalHps = (regen + lifestealTheo + skills) * blockFactor;

        // Real-Time HPS (based on Real Weapon DPS)
        const lifestealReal = this.stats.realWeaponDps * this.stats.lifeSteal;
        this.stats.realTotalHps = (regen + lifestealReal + skills) * blockFactor;

        this.debugLogs.push(`FINAL DPS: Weapon=${this.stats.weaponDps.toFixed(0)}, RealWeapon=${this.stats.realWeaponDps.toFixed(0)}, Total=${this.stats.averageTotalDps.toFixed(0)}`);
        this.debugLogs.push(`FINAL HPS: Theo=${this.stats.theoreticalTotalHps.toFixed(0)}, Real=${this.stats.realTotalHps.toFixed(0)}`);

        this.publishAttribution();
    } // end finalizeCalculation

    /**
     * Attach attribution to the result. Assigned by reference (never cloned) so the SourceRef
     * entries keep pointing at live profile objects.
     */
    private publishAttribution() {
        if (!this.trackAttribution) return;

        // NOTE: excludeSubstats now affects POWER ONLY — the Damage/Health totals always include
        // the item DMG%/HP%/Melee/Ranged substats, so their attribution entries must stay listed
        // (they really do contribute to the displayed damage/health in both modes).
        this.stats.attribution = this.attribution;
    }
} // end class

export function calculateStats(
    profile: UserProfile,
    libs: LibraryData,
    excludeSubstats = false,
    opts?: { attribution?: boolean }
): any {
    const engine = new StatEngine(profile, libs, excludeSubstats, opts?.attribution === true);
    if (typeof window !== 'undefined') {
        (window as any).debugCalculator = engine;
    }
    return engine.calculate();
}
