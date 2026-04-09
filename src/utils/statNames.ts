/**
 * Human-readable names for secondary stats
 */

export const STAT_NAMES: Record<string, string> = {
    // Damage multipliers
    'DamageMulti': 'Damage',
    'MeleeDamageMulti': 'Melee Damage',
    'RangedDamageMulti': 'Ranged Damage',
    'SkillDamageMulti': 'Skill Damage',
    //  'BossDamageMulti': 'Boss Damage',

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
export function formatStatValue(value: number): string {
    // Standard Format: input value is assumed to be in Percentage Points (e.g., 1.3 for 1.3%)
    // We removed the fragile heuristic (value > 2) because it caused scaling bugs.
    const val = value;

    // Use up to 3 decimal places, strip trailing zeros
    return `+${parseFloat(val.toFixed(3))}%`;
}

/**
 * Component helper: format a secondary stat for display
 */
export function formatSecondaryStat(statId: string, value: number): { name: string; formattedValue: string; icon: string; color: string } {
    return {
        name: getStatName(statId),
        formattedValue: formatStatValue(value),
        icon: getStatIcon(statId),
        color: getStatColor(statId),
    };
}
