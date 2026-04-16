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
    }
): ItemStatsResult => {
    const defaultResult = { damage: 0, health: 0, bonus: 0, damageMulti: 0, healthMulti: 0, skinBonuses: { damage: 0, health: 0 }, isMelee: true };
    if (!item || !libraries.itemBalancingLibrary || !libraries.itemBalancingConfig) return defaultResult;

    const { itemBalancingLibrary, itemBalancingConfig, weaponLibrary } = libraries;
    const { techModifiers, forgeAscensionMulti } = modifiers;

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

    let damageMulti = (1 + techBonus) * (1 + forgeAscensionMulti);
    let healthMulti = (1 + techBonus) * (1 + forgeAscensionMulti);

    let damage = 0;
    let health = 0;

    for (const stat of itemData.EquipmentStats) {
        const statType = stat.StatNode?.UniqueStat?.StatType;
        let value = stat.Value || 0;

        // Level scaling
        const levelExp = Math.max(0, item.level - 1);
        value = value * Math.pow(levelScaling, levelExp);

        // Tech tree bonus
        value = value * (1 + techBonus);

        // Forge Ascension bonus
        value = value * (1 + forgeAscensionMulti);

        if (statType === 'Damage') damage += value;
        if (statType === 'Health') health += value;
    }

    if (slotKey === 'Weapon' && isMelee && damage > 0) {
        damage = damage * meleeBaseMulti;
        damageMulti *= meleeBaseMulti;
    }

    // Apply Skin Multipliers
    let skinBonuses = { damage: 0, health: 0 };
    if (item.skin && item.skin.stats) {
        const skinDamage = item.skin.stats['Damage'] || 0;
        const skinHealth = item.skin.stats['Health'] || 0;

        if (skinDamage) {
            damage *= (1 + skinDamage);
            damageMulti *= (1 + skinDamage);
        }
        if (skinHealth) {
            health *= (1 + skinHealth);
            healthMulti *= (1 + skinHealth);
        }
        skinBonuses = { damage: skinDamage, health: skinHealth };
    }

    return { damage, health, bonus: techBonus, damageMulti, healthMulti, skinBonuses, isMelee };
};
