/**
 * Human-readable names for secondary stats
 */

export const STAT_NAMES: Record<string, string> = {
    // Damage multipliers
    'DamageMulti': 'Damage',
    'MeleeDamageMulti': 'Melee Damage',
    'RangedDamageMulti': 'Ranged Damage',
    'SkillDamageMulti': 'Skill Damage',
    'BossDamageMulti': 'Boss Damage',

    // Health
    'HealthMulti': 'Health',
    'HealthRegen': 'Health Regen',
    'LifeSteal': 'Lifesteal',

    // Critical
    'CriticalChance': 'Crit Chance',
    'CriticalMulti': 'Crit Damage',

    // Combat
    'DoubleDamageChance': 'Double Chance',
    'BlockChance': 'Block Chance',
    'AttackSpeed': 'Attack Speed',

    // Skills
    'SkillCooldownMulti': 'Skill Cooldown',

    // Economy
    'Experience': 'Experience',
    'SellPrice': 'Sell Price',

    // Freebie (separate by context)
    'ForgeFreebieChance': 'Forge Freebie',
    'EggFreebieChance': 'Egg Freebie',
    'MountFreebieChance': 'Mount Freebie',

    // Movement
    'MovementSpeed': 'Movement Speed',

    // Other
    'Damage': 'Damage',
    'Health': 'Health',
};

/**
 * Get human-readable name for a stat ID
 */
export function getStatName(statId: string): string {
    return STAT_NAMES[statId] || statId.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Get icon emoji for a stat
 */
export function getStatIcon(statId: string): string {
    const icons: Record<string, string> = {
        'DamageMulti': '⚔️',
        'MeleeDamageMulti': '🗡️',
        'RangedDamageMulti': '🏹',
        'SkillDamageMulti': '✨',
        'HealthMulti': '❤️',
        'HealthRegen': '💚',
        'LifeSteal': '🩸',
        'CriticalChance': '🎯',
        'CriticalMulti': '💥',
        'DoubleDamageChance': '⚡',
        'BlockChance': '🛡️',
        'AttackSpeed': '⚡',
        'SkillCooldownMulti': '⏱️',
        'Damage': '⚔️',
        'Health': '❤️',
    };
    return icons[statId] || '📊';
}

/**
 * Get color class for a stat
 */
export function getStatColor(statId: string): string {
    if (statId.includes('Damage') || statId === 'CriticalMulti' || statId === 'DoubleDamageChance') {
        return 'text-red-400';
    }
    if (statId.includes('Health') || statId === 'LifeSteal') {
        return 'text-green-400';
    }
    if (statId.includes('Critical')) {
        return 'text-yellow-400';
    }
    if (statId === 'BlockChance') {
        return 'text-blue-400';
    }
    if (statId === 'AttackSpeed') {
        return 'text-cyan-400';
    }
    if (statId.includes('Skill')) {
        return 'text-purple-400';
    }
    return 'text-text-muted';
}

/**
 * Format a stat value for display
 * Values > 2 are assumed to be raw percentages (e.g., 48.1 = 48.10%)
 * Values <= 2 are assumed to be multipliers (e.g., 0.481 = 48.10%)
 */
export function formatStatValue(value: number, statId?: string): string {
    let val = value;

    // Special handling for HealthRegen and LifeSteal which are often small "Point" values (e.g. 1.32%)
    // If we multiply 1.32 * 100 we get 132%, which is wrong.
    // So for these, we treat anything > 0.5 as a Point (Keep).
    if (statId && ['HealthRegen', 'LifeSteal', 'BlockChance'].includes(statId)) {
        val = value > 0.5 ? value : value * 100;
    } else {
        // Standard Heuristic
        val = value > 2 ? value : value * 100;
    }

    // Use up to 3 decimal places, strip trailing zeros
    return `+${parseFloat(val.toFixed(3))}%`;
}

/**
 * Component helper: format a secondary stat for display
 */
export function formatSecondaryStat(statId: string, value: number): { name: string; formattedValue: string; icon: string; color: string } {
    return {
        name: getStatName(statId),
        formattedValue: formatStatValue(value, statId),
        icon: getStatIcon(statId),
        color: getStatColor(statId),
    };
}
