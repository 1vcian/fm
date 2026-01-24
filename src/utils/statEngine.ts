/**
 * StatEngine
 * Central engine for calculating player stats from all sources (Items, Pets, Tech Tree, Mounts, Skills).
 */

import type { UserProfile } from '../types/Profile.ts';

export type StatNature = 'Multiplier' | 'Additive' | 'OneMinusMultiplier' | 'Divisor';

export interface StatEntry {
    statType: string;
    statNature: StatNature;
    value: number;
    target?: string;
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
    mountDamageMulti: number;       // Mount Damage Multiplier
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

    hasProjectile: boolean;
    projectileSpeed: number;
    projectileRadius: number;

    skillDps: number;
    skillHps: number;

    // Power calculation
    power: number;
    powerDamageMultiplier: number;
    maxItemLevels: Record<string, number>;
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
    totalDamage: 10,
    totalHealth: 80,
    meleeDamage: 16,
    rangedDamage: 10,
    damageMultiplier: 1,
    healthMultiplier: 1,
    secondaryDamageMulti: 0,
    secondaryHealthMulti: 0,
    mountDamageMulti: 0,
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
    hasProjectile: false,
    projectileSpeed: 0,
    projectileRadius: 0,
    skillDps: 0,
    skillHps: 0,
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
    }
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
    itemBalancingLibrary?: any;
    itemBalancingConfig?: any;
    weaponLibrary?: any;
    projectilesLibrary?: any;
    secondaryStats?: any;
    secondaryStatLibrary?: any;
}

export class StatEngine {
    private profile: UserProfile;
    private libs: LibraryData;
    private stats: AggregatedStats;
    private nodeValidityCache: Map<number, boolean> = new Map();
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
        moveSpeed: 0,
    };

    // Mount multipliers (NOT additive flat stats!)
    private mountDamageMulti = 0;
    private mountHealthMulti = 0;

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

    constructor(profile: UserProfile, libs: LibraryData) {
        this.profile = profile;
        this.libs = libs;
        this.stats = { ...DEFAULT_STATS };
    }

    public calculate(): AggregatedStats {
        this.reset();
        this.loadBaseStats();

        // Phase 1: Collect Tech Tree Modifiers by NODE NAME (same as Verify.tsx)
        this.collectTechModifiers();

        // Phase 2: Collect Flat Stats (Items, Pets) with tech tree bonuses applied
        this.collectItemStats();
        this.collectPetStats();

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

    /**
     * Helper to check recursively if a node's requirements are met
     */
    private checkNodeValidity(
        treeData: any,
        levels: Record<string, number>,
        nodeId: number,
        visited: Set<number> = new Set()
    ): boolean {
        // 1. Controllo Cache: Se lo abbiamo già calcolato in questo ciclo, ritorna il risultato immediato
        if (this.nodeValidityCache.has(nodeId)) {
            return this.nodeValidityCache.get(nodeId)!;
        }

        // Prevent cycles
        if (visited.has(nodeId)) return false;

        // Check level > 0
        const level = levels[nodeId];
        if (!level || level <= 0) {
            this.nodeValidityCache.set(nodeId, false);
            return false;
        }

        // Check requirements
        const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
        if (!node) {
            this.nodeValidityCache.set(nodeId, false);
            return false;
        }

        // Optimization: use the SAME Set reference for recursion logic (backtracking) 
        // instead of creating new Set(visited) every time to save garbage collection.
        visited.add(nodeId);

        let isValid = true;
        if (node.Requirements && node.Requirements.length > 0) {
            for (const reqId of node.Requirements) {
                // Recursive validity check
                if (!this.checkNodeValidity(treeData, levels, reqId, visited)) {
                    isValid = false;
                    break;
                }
            }
        }

        visited.delete(nodeId); // Backtrack

        // 2. Salva il risultato in Cache
        this.nodeValidityCache.set(nodeId, isValid);
        return isValid;
    }

    private reset() {
        this.stats = { ...DEFAULT_STATS };
        this.displayStats = {};
        this.debugLogs = [];

        // Pulisci la cache ad ogni nuovo calcolo
        this.nodeValidityCache.clear();

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
            moveSpeed: 0,
        };

        // Reset mount multipliers
        this.mountDamageMulti = 0;
        this.mountHealthMulti = 0;
        this.stats.mountDamageMulti = 0;

        // Reset max levels
        this.maxLevelBonuses = { 'Weapon': 0, 'Helmet': 0, 'Body': 0, 'Gloves': 0, 'Belt': 0, 'Necklace': 0, 'Ring': 0, 'Shoe': 0 };
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
            const key = `{'Age': ${weapon.age}, 'Type': 'Weapon', 'Idx': ${weapon.idx}}`;
            const weaponData = this.libs.weaponLibrary[key];
            if (weaponData) {
                // Melee = AttackRange < 1, Ranged = AttackRange >= 1
                const attackRange = weaponData.AttackRange || 0;
                this.stats.isRangedWeapon = attackRange >= 1;
                this.stats.weaponAttackRange = attackRange;
                this.stats.weaponWindupTime = weaponData.WindupTime || 0.5;
                this.stats.weaponAttackDuration = weaponData.AttackDuration || 1.0;

                const projId = weaponData.ProjectileId;
                if (projId !== undefined && projId > -1 && this.libs.projectilesLibrary) {
                    const projData = this.libs.projectilesLibrary[String(projId)];
                    if (projData) {
                        this.stats.hasProjectile = true;
                        this.stats.projectileSpeed = projData.Speed || 0;
                        this.stats.projectileRadius = projData.CollisionRadius || 0;
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

        const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];
        for (const tree of trees) {
            const treeLevels = this.profile.techTree[tree] || {};
            const treeData = this.libs.techTreePositionLibrary[tree];
            if (!treeData?.Nodes) continue;

            // Pre-calculate valid nodes
            const validNodes = new Set<number>();
            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);
                if (this.checkNodeValidity(treeData, treeLevels, nodeId)) {
                    validNodes.add(nodeId);
                }
            }

            for (const nodeId of validNodes) {
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = this.libs.techTreeLibrary[node.Type];
                if (!nodeData?.Stats) continue;

                const level = treeLevels[nodeId];
                // Calculate total value: base + (level-1) * increment
                const baseVal = nodeData.Stats[0]?.Value || 0;
                const increment = nodeData.Stats[0]?.ValueIncrease || 0;
                const totalVal = baseVal + (Math.max(0, level - 1) * increment);

                // Store by node TYPE NAME (e.g., 'WeaponBonus', 'GloveBonus', 'PetBonusDamage')
                const key = node.Type;
                this.techModifiers[key] = (this.techModifiers[key] || 0) + totalVal;
            }
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

            // Accumulate totals
            this.stats.itemDamage += dmg;
            this.stats.itemHealth += hp;

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

                    // Projectile info
                    const projId = weaponData.ProjectileId;
                    if (projId !== undefined && projId > -1 && this.libs.projectilesLibrary) {
                        const projData = this.libs.projectilesLibrary[String(projId)];
                        if (projData) {
                            this.stats.hasProjectile = true;
                            this.stats.projectileSpeed = projData.Speed || 0;
                            this.stats.projectileRadius = projData.CollisionRadius || 0;
                        }
                    }
                }
            }

            const techBonusKey = StatEngine.slotToTechBonus[slotKey];
            this.debugLogs.push(`Item ${slotKey}: Damage=${dmg.toFixed(0)}, Health=${hp.toFixed(0)} (bonus: ${techBonusKey}=${((this.techModifiers[techBonusKey] || 0) * 100).toFixed(1)}%)`);
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

        for (const pet of this.profile.pets.active) {
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

            let dmg = 0, hp = 0;
            for (const stat of levelInfo.PetStats.Stats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                let value = stat.Value || 0;

                if (statType === 'Damage') {
                    value *= typeMulti.DamageMultiplier;
                    value *= (1 + petDamageBonus);
                    dmg += value;
                }
                if (statType === 'Health') {
                    value *= typeMulti.HealthMultiplier;
                    value *= (1 + petHealthBonus);
                    hp += value;
                }
            }

            this.stats.petDamage += dmg;
            this.stats.petHealth += hp;
            this.debugLogs.push(`Pet ${pet.rarity} ${pet.id} (${petType}) L${pet.level}: Damage=${dmg.toFixed(0)}, Health=${hp.toFixed(0)}`);
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

                // Mount stats are MULTIPLIERS (e.g., 0.70 = +70%)
                if (statType === 'Damage') this.mountDamageMulti += value;
                if (statType === 'Health') this.mountHealthMulti += value;
            }
        }

        // Apply tech tree bonuses MULTIPLICATIVELY (same as Verify.tsx)
        const mountDmgBonus = this.techModifiers['MountDamage'] || 0;
        const mountHpBonus = this.techModifiers['MountHealth'] || 0;

        this.debugLogs.push(`Mount base: Damage=${(this.mountDamageMulti * 100).toFixed(1)}%, Health=${(this.mountHealthMulti * 100).toFixed(1)}%`);

        this.mountDamageMulti *= (1 + mountDmgBonus);
        this.mountHealthMulti *= (1 + mountHpBonus);

        this.debugLogs.push(`Mount final: Damage=${(this.mountDamageMulti * 100).toFixed(1)}%, Health=${(this.mountHealthMulti * 100).toFixed(1)}%`);
    }

    /**
     * Collect ALL Secondary Stats from items, pets, mount (same as Verify.tsx)
     * These are stored separately and applied in finalizeCalculation
     */
    private collectAllSecondaryStats() {
        const collectSecondary = (statId: string, rawValue: number) => {
            // Game displays values rounded to 2 decimals (e.g., 11.2%), so we match that precision
            // Round to 4 decimals to allow finer precision (e.g. 4.49%)
            const rounded = Math.round(rawValue * 10000) / 10000;

            // Standardized Parsing: ALL secondary stats from items/pets are stored as Percentage Points (e.g. 10.5 = 10.5%).
            // Use strict division by 100.
            const val = rounded / 100;
            switch (statId) {
                case 'DamageMulti': this.secondaryStats.damageMulti += val; break;
                case 'HealthMulti': this.secondaryStats.healthMulti += val; break;
                case 'MeleeDamageMulti': this.secondaryStats.meleeDamageMulti += val; break;
                case 'RangedDamageMulti': this.secondaryStats.rangedDamageMulti += val; break;
                case 'CriticalChance': this.secondaryStats.criticalChance += val; break;
                case 'CriticalMulti': this.secondaryStats.criticalDamage += val; break;
                case 'DoubleDamageChance': this.secondaryStats.doubleDamageChance += val; break;
                case 'AttackSpeed': this.secondaryStats.attackSpeed += val; break;
                case 'LifeSteal': this.secondaryStats.lifeSteal += val; break;
                case 'HealthRegen': this.secondaryStats.healthRegen += val; break;
                case 'BlockChance': this.secondaryStats.blockChance += val; break;
                case 'SkillCooldownMulti': this.secondaryStats.skillCooldownMulti += val; break;
                case 'SkillDamageMulti': this.secondaryStats.skillDamageMulti += val; break;
                case 'MoveSpeed': this.secondaryStats.moveSpeed += val; break;
            }
        };

        // From all items
        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        for (const slot of slots) {
            const item = this.profile.items[slot];
            if (item?.secondaryStats) {
                for (const sec of item.secondaryStats) {
                    collectSecondary(sec.statId, sec.value);
                }
            }
        }

        // From all pets
        for (const pet of this.profile.pets.active) {
            if (pet.secondaryStats) {
                for (const sec of pet.secondaryStats) {
                    collectSecondary(sec.statId, sec.value);
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
        if (this.profile.mount.active?.secondaryStats) {
            for (const sec of this.profile.mount.active.secondaryStats) {
                // Mount stats are already normalized (0.253), collectSecondary divides by 100. 
                // So we multiply by 100 to cancel it out.
                collectSecondary(sec.statId, sec.value * 100);
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

        const passives = this.profile.skills?.passives || {};
        let totalPassiveDmg = 0;
        let totalPassiveHp = 0;

        for (const [skillId, level] of Object.entries(passives)) {
            if (typeof level !== 'number' || level <= 0) continue;

            // Get skill data to determine rarity
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

            // Apply tech tree bonus and ROUND to integer for EACH skill (as the game does)
            const withBonusDmg = skillBaseDmg * (1 + skillPassiveDamageBonus);
            totalPassiveDmg += Math.floor(withBonusDmg);

            const withBonusHp = skillBaseHp * (1 + skillPassiveHealthBonus);
            totalPassiveHp += Math.floor(withBonusHp);
        }

        // Stats are already rounded per-skill, no additional bonus application needed
        this.stats.skillPassiveDamage = totalPassiveDmg;
        this.stats.skillPassiveHealth = totalPassiveHp;
        this.debugLogs.push(`Skill Passives: Damage=${this.stats.skillPassiveDamage.toFixed(0)} (base: ${totalPassiveDmg.toFixed(0)}, +${(skillPassiveDamageBonus * 100).toFixed(0)}%), Health=${this.stats.skillPassiveHealth.toFixed(0)} (base: ${totalPassiveHp.toFixed(0)}, +${(skillPassiveHealthBonus * 100).toFixed(0)}%)`);
    }

    private collectTechTreeStats() {
        if (!this.libs.techTreeLibrary || !this.libs.techTreePositionLibrary) return;

        // Iterate again but SKIP Modifier types we already handled in `collectGlobalModifiers`
        // Modifier Types: WeaponStatTarget, EquipmentStatTarget, PetStatTarget, MountStatTarget.

        const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];
        for (const tree of trees) {
            const treeLevels = this.profile.techTree[tree] || {};
            const treeData = this.libs.techTreePositionLibrary[tree];
            if (!treeData?.Nodes) continue;

            // Pre-calculate valid nodes
            const validNodes = new Set<number>();
            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);
                if (this.checkNodeValidity(treeData, treeLevels, nodeId)) {
                    validNodes.add(nodeId);
                }
            }

            for (const nodeId of validNodes) {
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = this.libs.techTreeLibrary[node.Type];
                if (!nodeData?.Stats) continue;

                for (const stat of nodeData.Stats) {
                    const targetType = stat.StatNode?.StatTarget?.$type;
                    const statType = stat.StatNode?.UniqueStat?.StatType;

                    // Skip Damage/Health stats for specific equipment/pet/mount targets 
                    // (these are handled via collectTechModifiers for bonus multipliers)
                    const isHandledByModifiers = (statType === 'Damage' || statType === 'Health') &&
                        (targetType === 'WeaponStatTarget' ||
                            targetType === 'EquipmentStatTarget' ||
                            targetType === 'PetStatTarget' ||
                            targetType === 'MountStatTarget');

                    if (isHandledByModifiers) {
                        continue;
                    }

                    const level = treeLevels[nodeId];
                    const baseValue = stat.Value || 0;
                    const increase = stat.ValueIncrease || 0;
                    const levelFactor = Math.max(0, level - 1);
                    const totalValue = baseValue + (levelFactor * increase);

                    this.applyStat({
                        statType: statType,
                        statNature: stat.StatNode?.UniqueStat?.StatNature as StatNature || 'Multiplier',
                        value: totalValue,
                        target: targetType,
                        itemType: stat.StatNode?.StatTarget?.ItemType
                    } as any);
                }
            }
        }
    }

    private applyStat(stat: StatEntry) {
        const { statType, statNature, value, target } = stat;

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
                } else if (target === 'PlayerRangedOnlyStatTarget') {
                    this.stats.rangedDamageMultiplier = this.combine(this.stats.rangedDamageMultiplier, value, statNature);
                } else if (target === 'ActiveSkillStatTarget') {
                    // Skill Damage Multiplier
                    this.stats.skillDamageMultiplier = this.combine(this.stats.skillDamageMultiplier, value, statNature);
                } else {
                    this.stats.damageMultiplier = this.combine(this.stats.damageMultiplier, value, statNature);
                }
                break;
            case 'Health':
                if (target === 'ActiveSkillStatTarget') {
                    // Skill Health Multiplier (Healing?)
                } else if (statNature !== 'Additive') {
                    this.stats.healthMultiplier = this.combine(this.stats.healthMultiplier, value, statNature);
                }
                break;
            case 'TimerSpeed':
            case 'SkillCooldownMulti': // Fallback if name matches
                if (target === 'ActiveSkillStatTarget' || statType === 'SkillCooldownMulti') {
                    // Check nature. Usually oneMinusMultiplier
                    this.stats.skillCooldownReduction = this.combine(this.stats.skillCooldownReduction, value, 'OneMinusMultiplier');
                }
                break;
            case 'CriticalChance':
                this.stats.criticalChance = this.combine(this.stats.criticalChance, value, statNature);
                break;
            case 'CriticalDamage':
                this.stats.criticalDamage = this.combine(this.stats.criticalDamage, value, statNature);
                break;
            case 'BlockChance':
                this.stats.blockChance = this.combine(this.stats.blockChance, value, statNature);
                break;
            case 'DoubleDamageChance':
                this.stats.doubleDamageChance = this.combine(this.stats.doubleDamageChance, value, statNature);
                break;
            case 'HealthRegen':
                this.stats.healthRegen = this.combine(this.stats.healthRegen, value, statNature);
                break;
            case 'LifeSteal':
                this.stats.lifeSteal = this.combine(this.stats.lifeSteal, value, statNature);
                break;
            case 'AttackSpeed':
                this.stats.attackSpeedMultiplier = this.combine(this.stats.attackSpeedMultiplier, value, statNature);
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
                } else if (target === 'DungeonStatTarget') {
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

        // 3. Flat totals (including skill passive bonuses)
        const flatDamageWithMelee = this.stats.basePlayerDamage + weaponWithMelee + otherItemDamage + this.stats.petDamage + this.stats.skillPassiveDamage;
        const flatHealth = this.stats.basePlayerHealth + this.stats.itemHealth + this.stats.petHealth + this.stats.skillPassiveHealth;

        this.debugLogs.push(`Flat Stats: Damage=${flatDamageWithMelee.toFixed(0)} (skillPassive: ${this.stats.skillPassiveDamage.toFixed(0)}), Health=${flatHealth.toFixed(0)} (skillPassive: ${this.stats.skillPassiveHealth.toFixed(0)})`);

        // 4. Mount and Secondary DamageMulti/HealthMulti are ADDITIVE (from Verify.tsx)
        const damageAdditiveMulti = 1 + this.mountDamageMulti + this.secondaryStats.damageMulti;
        const healthAdditiveMulti = 1 + this.mountHealthMulti + this.secondaryStats.healthMulti;

        this.debugLogs.push(`Additive Multipliers: Damage=${damageAdditiveMulti.toFixed(3)} (1 + ${this.mountDamageMulti.toFixed(3)} + ${this.secondaryStats.damageMulti.toFixed(3)})`);
        this.debugLogs.push(`Additive Multipliers: Health=${healthAdditiveMulti.toFixed(3)} (1 + ${this.mountHealthMulti.toFixed(3)} + ${this.secondaryStats.healthMulti.toFixed(3)})`);

        const damageAfterAdditive = flatDamageWithMelee * damageAdditiveMulti;
        const healthAfterAdditive = flatHealth * healthAdditiveMulti;

        // 5. MeleeDamageMulti is applied MULTIPLICATIVELY (only for melee weapons)
        // RangedDamageMulti is applied MULTIPLICATIVELY (only for ranged weapons)
        const specificDamageMulti = isWeaponMelee
            ? (1 + this.secondaryStats.meleeDamageMulti)
            : (1 + this.secondaryStats.rangedDamageMulti);

        const finalDamage = damageAfterAdditive * specificDamageMulti;

        this.debugLogs.push(`After SpecificMulti (×${specificDamageMulti.toFixed(3)}): Damage=${finalDamage.toFixed(0)}`);

        // 6. Final stats (no empirical corrections applied)
        this.stats.totalDamage = finalDamage;
        this.stats.totalHealth = healthAfterAdditive;

        // Store multipliers for display
        this.stats.damageMultiplier = damageAdditiveMulti;
        this.stats.healthMultiplier = healthAdditiveMulti;
        this.stats.secondaryDamageMulti = this.secondaryStats.damageMulti;
        this.stats.secondaryHealthMulti = this.secondaryStats.healthMulti;
        this.stats.mountDamageMulti = this.mountDamageMulti;
        this.stats.meleeDamageMultiplier = this.secondaryStats.meleeDamageMulti;
        this.stats.rangedDamageMultiplier = this.secondaryStats.rangedDamageMulti;

        const flatDamageNoMelee = this.stats.basePlayerDamage + this.stats.itemDamage + this.stats.petDamage;

        // Melee/Ranged specific damage (for display)
        this.stats.meleeDamage = isWeaponMelee ? this.stats.totalDamage : (flatDamageWithMelee * damageAdditiveMulti * (1 + this.secondaryStats.meleeDamageMulti));
        this.stats.rangedDamage = !isWeaponMelee ? this.stats.totalDamage : (flatDamageNoMelee * damageAdditiveMulti * (1 + this.secondaryStats.rangedDamageMulti));

        // Power calculation - GHIDRA REVERSE ENGINEERED FORMULA (VERIFIED):
        // Power = ((Damage - 10) × 8 + (Health - 80)) × 3
        // NOTE: Health is NOT multiplied by 8! Only Damage is, then result × 3
        const powerDmgMulti = this.stats.powerDamageMultiplier || 8.0;
        const baseDmg = this.stats.basePlayerDamage; // 10.0 from config
        const baseHp = this.stats.basePlayerHealth;  // 80.0 from config

        const basePower = ((finalDamage - baseDmg) * powerDmgMulti + (healthAfterAdditive - baseHp)) * 3;
        this.stats.power = Math.round(basePower); // Game uses RoundToInt128


        // Apply secondary stats to stats object
        // Note: criticalDamage base (1 + PlayerBaseCritDamage) is already set in loadBaseStats()
        const baseCritDamage = baseStats.baseCritDamage; // 0.2 from config = 20% base crit damage
        this.stats.criticalChance = this.secondaryStats.criticalChance;
        this.stats.criticalDamage = 1 + baseCritDamage + this.secondaryStats.criticalDamage; // 1 + 0.2 base + bonus
        this.stats.doubleDamageChance = this.secondaryStats.doubleDamageChance;
        this.stats.attackSpeedMultiplier = 1 + this.secondaryStats.attackSpeed;
        this.stats.lifeSteal = this.secondaryStats.lifeSteal;
        this.stats.healthRegen = this.secondaryStats.healthRegen;
        this.stats.blockChance = this.secondaryStats.blockChance;
        this.stats.skillCooldownReduction = this.secondaryStats.skillCooldownMulti;
        // Add secondary stat skill damage bonus to skill multiplier (from Ring/Pet)
        this.stats.skillDamageMultiplier += this.secondaryStats.skillDamageMulti;

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

                if (baseSkillDmg > 0) {
                    // SKILL DAMAGE FIX: Treated as FLAT Damage (not percentage of player damage)
                    // Verified by observing huge values (e.g. 4M for StrafeRun vs 1.6M Player Damage)
                    // If treated as %, it yields Billions of DPS.

                    const flatSkillDmg = baseSkillDmg; // RAW value from library seems correct as flat damage

                    // Statistical Multiplier for Crit/Double
                    // Avg Multi = 1 + (CritChance * (CritDmg - 1)) + (DoubleChance * 1)
                    const critFactor = this.stats.criticalChance * (this.stats.criticalDamage - 1);
                    const doubleFactor = this.stats.doubleDamageChance * 1; // Adds 100% damage
                    const statMultiplier = 1 + critFactor + doubleFactor;



                    // CORRECT SKILL DAMAGE FORMULA:
                    // SkillDmg = Base * (1 + SkillMulti + GlobalMulti - MountMulti) * Crit/Double
                    // Why substract Mount? Because "GlobalMulti" (damageMultiplier) includes Mount, 
                    // but in-game analysis shows Mount Damage does NOT apply to Active Skills.
                    const globalDamageMulti = this.stats.damageMultiplier;
                    const mountMulti = this.stats.mountDamageMulti;
                    const skillMulti = this.stats.skillDamageMultiplier; // Already includes "SkillDamageMulti" from Ring/Pet

                    // Note: 'skillMulti' logic in statEngine might be slightly different from BattleSimulator
                    // BattleSimulator uses: total = skillFactor + globalFactor - 1
                    // Here we reconstruct it:
                    // statEngine.skillDamageMultiplier = 1 + skillBonus
                    // statEngine.damageMultiplier = 1 + mount + damageBonus
                    // Desired Total = 1 + skillBonus + damageBonus (No Mount)
                    // = (1 + skillBonus) + (1 + mount + damageBonus) - 1 - mount
                    // = skillMulti + globalDamageMulti - 1 - mountMulti

                    const effectiveMultiplier = skillMulti + globalDamageMulti - 1 - mountMulti;

                    const dmgPerHit = flatSkillDmg * effectiveMultiplier * statMultiplier;

                    this.stats.skillDps += dmgPerHit / finalCd;
                }
                if (baseSkillHeal > 0) {
                    // SKILL HEALING FIX: Treated as FLAT Healing
                    const flatSkillHeal = baseSkillHeal;
                    const healPerHit = flatSkillHeal;
                    this.stats.skillHps += healPerHit / finalCd;

                }
            }
        }
    }

}

export function calculateStats(profile: UserProfile, libs: LibraryData): any {
    const engine = new StatEngine(profile, libs);
    if (typeof window !== 'undefined') {
        (window as any).debugCalculator = engine;
    }
    return engine.calculate();
}
