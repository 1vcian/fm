import { ItemSlot } from '../types/Profile';

export interface ItemStatsResult {
    damage: number;
    health: number;
    bonus: number;
    damageMulti: number;
    healthMulti: number;
    skinBonuses: {
        damage: number;
        health: number;
    };
    isMelee: boolean;
    details?: {
        damage?: {
            base: number;
            levelMulti?: number;
            techMulti?: number;
            clanTechMulti?: number;
            ascMulti?: number;
            skinMulti?: number;
            meleeMulti?: number;
        };
        health?: {
            base: number;
            levelMulti?: number;
            techMulti?: number;
            clanTechMulti?: number;
            ascMulti?: number;
            skinMulti?: number;
        };
    };
}

// Slot to tech bonus mapping
export const SLOT_TO_TECH_BONUS: Record<string, string> = {
    'Weapon': 'WeaponBonus',
    'Helmet': 'HelmetBonus',
    'Body': 'BodyBonus',
    'Gloves': 'GloveBonus',
    'Belt': 'BeltBonus',
    'Necklace': 'NecklaceBonus',
    'Ring': 'RingBonus',
    'Shoe': 'ShoeBonus'
};

// Slot to JSON type for ItemBalancingLibrary
export const SLOT_TO_JSON_TYPE: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Helmet',
    'Body': 'Armour',
    'Gloves': 'Gloves',
    'Belt': 'Belt',
    'Necklace': 'Necklace',
    'Ring': 'Ring',
    'Shoe': 'Shoes'
};

/**
 * Calculates item perfection (average of secondary stats vs max)
 */
export const getPerfection = (item: ItemSlot, secondaryStatLibrary: any): number | null => {
    if (!item.secondaryStats || item.secondaryStats.length === 0 || !secondaryStatLibrary) return null;

    let totalPercent = 0;
    let count = 0;

    for (const stat of item.secondaryStats) {
        const libStat = secondaryStatLibrary[stat.statId];
        if (libStat && libStat.UpperRange > 0) {
            const maxVal = libStat.UpperRange * 100;
            if (maxVal > 0) {
                const percent = (stat.value / maxVal) * 100;
                totalPercent += Math.min(100, percent);
                count++;
            }
        }
    }

    return count > 0 ? totalPercent / count : null;
};

/**
 * Average perfection across a set of gear (items, pets, mount) — anything carrying
 * secondaryStats. Entries without secondary stats (or nulls) are skipped, so the
 * result is the mean of each piece's own perfection. Returns null if nothing qualifies.
 */
export const getAveragePerfection = (
    entries: ({ secondaryStats?: { statId: string; value: number }[] } | null | undefined)[],
    secondaryStatLibrary: any
): number | null => {
    let total = 0;
    let count = 0;
    for (const entry of entries) {
        if (!entry) continue;
        const p = getPerfection(entry as ItemSlot, secondaryStatLibrary);
        if (p !== null) {
            total += p;
            count++;
        }
    }
    return count > 0 ? total / count : null;
};

/**
 * Calculates perfection for a single stat
 */
export const getStatPerfection = (statIdx: string, value: number, secondaryStatLibrary: any): number | null => {
    if (!secondaryStatLibrary) return null;
    const libStat = secondaryStatLibrary[statIdx];
    if (libStat && libStat.UpperRange > 0) {
        return Math.min(100, (value / (libStat.UpperRange * 100)) * 100);
    }
    return null;
};

/**
 * Calculates item stats including tech bonuses, ascension, and skin modifiers
 */
export const getItemStats = (
    item: ItemSlot | null,
    slotKey: string,
    libraries: {
        itemBalancingLibrary: any;
        itemBalancingConfig: any;
        weaponLibrary: any;
    },
    modifiers: {
        techModifiers: Record<string, number>;
        forgeAscensionMulti: number;
        clanModifiers?: Record<string, number>;
    }
): ItemStatsResult => {
    const defaultResult = { damage: 0, health: 0, bonus: 0, damageMulti: 0, healthMulti: 0, skinBonuses: { damage: 0, health: 0 }, isMelee: true };
    if (!item || !libraries.itemBalancingLibrary || !libraries.itemBalancingConfig) return defaultResult;

    const { itemBalancingLibrary, itemBalancingConfig, weaponLibrary } = libraries;
    const { techModifiers, forgeAscensionMulti, clanModifiers } = modifiers;

    const jsonType = SLOT_TO_JSON_TYPE[slotKey] || slotKey;
    const key = `{'Age': ${item.age}, 'Type': '${jsonType}', 'Idx': ${item.idx}}`;
    const itemData = itemBalancingLibrary[key];

    if (!itemData?.EquipmentStats) return defaultResult;

    // Check if weapon is melee
    let isMelee = false;
    if (slotKey === 'Weapon' && weaponLibrary) {
        const weaponKey = `{'Age': ${item.age}, 'Type': 'Weapon', 'Idx': ${item.idx}}`;
        const weaponData = weaponLibrary[weaponKey];
        if (weaponData && (weaponData.AttackRange ?? 0) < 1) {
            isMelee = true;
        }
    }

    const levelScaling = itemBalancingConfig.LevelScalingBase || 1.01;
    const meleeBaseMulti = itemBalancingConfig.PlayerMeleeDamageMultiplier || 1.6;
    const bonusKey = SLOT_TO_TECH_BONUS[slotKey];
    const techBonus = techModifiers[bonusKey] || 0;
    const clanTechBonus = (clanModifiers && clanModifiers[bonusKey]) || 0;

    let damageMulti = (1 + techBonus) * (forgeAscensionMulti || 1);
    let healthMulti = (1 + techBonus) * (forgeAscensionMulti || 1);

    let baseDamage = 0;
    let baseHealth = 0;

    for (const stat of itemData.EquipmentStats) {
        const statType = stat.StatNode?.UniqueStat?.StatType;
        if (statType === 'Damage') baseDamage += (stat.Value || 0);
        if (statType === 'Health') baseHealth += (stat.Value || 0);
    }

    const levelMulti = Math.pow(levelScaling, Math.max(0, item.level - 1));
    const techMulti = (1 + techBonus);
    const ascMulti = (forgeAscensionMulti || 1);
    const meleeMulti = (slotKey === 'Weapon' && isMelee) ? meleeBaseMulti : 1;
    const skinDmgMulti = (1 + (item.skin?.stats?.['Damage'] || 0));
    const skinHpMulti = (1 + (item.skin?.stats?.['Health'] || 0));

    let damage = baseDamage * levelMulti * techMulti * ascMulti * meleeMulti;
    let health = baseHealth * levelMulti * techMulti * ascMulti;

    if (slotKey === 'Weapon' && isMelee && damage > 0) {
        damageMulti *= meleeBaseMulti;
    }

    let skinBonuses = { 
        damage: item.skin?.stats?.['Damage'] || 0, 
        health: item.skin?.stats?.['Health'] || 0 
    };

    // skin multipliers are global, not per-item
    // if (skinBonuses.damage) damageMulti *= (1 + skinBonuses.damage);
    // if (skinBonuses.health) healthMulti *= (1 + skinBonuses.health);

    // Populate details
    const details = {
        damage: {
            base: baseDamage,
            levelMulti,
            techMulti,
            clanTechMulti: clanTechBonus,
            ascMulti,
            skinMulti: 1,
            meleeMulti
        },
        health: {
            base: baseHealth,
            levelMulti,
            techMulti,
            clanTechMulti: clanTechBonus,
            ascMulti,
            skinMulti: 1,
        }
    };

    return { damage, health, bonus: techBonus, damageMulti, healthMulti, skinBonuses, isMelee, details };
};
