/**
 * Fairies: the seasonal LiveOps feature added in 2.9.0. Mechanics verified from
 * libil2cpp.so build 2026_09_02_09_08:
 *
 *   FairyHelpers.CalculateRawBonus (RVA 0x775203C):
 *     steps   = FloorToInt(requiredStatTotal / RequiredStatValueDivider), then |steps|
 *     perStep = TargetStatBonus + TargetStatBonusPerLevel * (level - 1)
 *     raw     = |steps| * perStep
 *
 *   FairyHelpers.ApplyFairyStat (RVA 0x7751CA0):
 *     when raw > 0 the target's secondary-stat pool becomes
 *     min(poolTotal + raw, TargetStatTotalCap) -- the cap clamps the POOL TOTAL, not the
 *     grant, and both required and target totals live in the game's SecondaryStatType
 *     aggregate (item/pet substats), which maps to statEngine's secondaryStats pools.
 *
 * The per-fairy rows (FairyStatLibrary) are NOT in the client config archive: they arrive
 * inside FairiesEventConfig.Stats with the live event (ServerGameConfig LiveOps template).
 * SEASON_STATS below is transcribed from the in-game picker (2026-09-09 season, expires
 * early November 2026) and must be re-checked each season. The picker screenshots showed
 * MAX level (20) values (Mira 20%, Tira 5%, Lora 15%) and the observed per-level growth is
 * Mira 1%, Tira 0.25%, Lora 0.75%: base equals growth, so perStep = growth x level, which
 * reproduces the max-level values exactly through the binary's
 * TargetStatBonus + TargetStatBonusPerLevel x (level - 1).
 */

export type FairyName = 'Mira' | 'Tira' | 'Lora';

export const FAIRIES: { name: FairyName; texture: string }[] = [
    { name: 'Lora', texture: 'FairyIconLora.png' },
    { name: 'Mira', texture: 'FairyIconMira.png' },
    { name: 'Tira', texture: 'FairyIconTira.png' },
];

/** Fallback when FairyUpgradesLibrary.json is unavailable; the library ships levels 2..20. */
export const FAIRY_MAX_LEVEL = 20;

export interface SeasonFairyStat {
    /** statEngine secondaryStats pool the fairy grants into (SecondaryStatType in game). */
    targetStat: 'criticalChance' | 'blockChance' | 'reflectChance';
    targetLabel: string;
    targetStatBonus: number;
    targetStatBonusPerLevel: number;
    /** statEngine secondaryStats pool the conversion reads. */
    requiredStat: 'skillDamageMulti' | 'skillCooldownMulti' | 'healthMulti';
    requiredLabel: string;
    requiredStatValueDivider: number;
    /** Skill Cooldown substats are reductions, so their steps read as "-1%" in game. */
    requiredStatIsReduction?: boolean;
    targetStatTotalCap: number;
}

export const SEASON_STATS: Record<FairyName, SeasonFairyStat> = {
    Mira: {
        targetStat: 'criticalChance',
        targetLabel: 'Critical Chance',
        targetStatBonus: 0.01,
        targetStatBonusPerLevel: 0.01,
        requiredStat: 'skillDamageMulti',
        requiredLabel: 'Skill Damage',
        requiredStatValueDivider: 0.15,
        targetStatTotalCap: 0.8,
    },
    Tira: {
        targetStat: 'blockChance',
        targetLabel: 'Block Chance',
        targetStatBonus: 0.0025,
        targetStatBonusPerLevel: 0.0025,
        requiredStat: 'skillCooldownMulti',
        requiredLabel: 'Skill Cooldown',
        requiredStatValueDivider: 0.01,
        requiredStatIsReduction: true,
        targetStatTotalCap: 0.3,
    },
    Lora: {
        targetStat: 'reflectChance',
        targetLabel: 'Reflect Chance',
        targetStatBonus: 0.0075,
        targetStatBonusPerLevel: 0.0075,
        requiredStat: 'healthMulti',
        requiredLabel: 'Health',
        requiredStatValueDivider: 0.1,
        targetStatTotalCap: 0.3,
    },
};

/** The bonus one step grants at a given fairy level (binary: base + growth x (level - 1)). */
export function fairyPerStep(cfg: SeasonFairyStat, level: number): number {
    return cfg.targetStatBonus + cfg.targetStatBonusPerLevel * (Math.max(1, level) - 1);
}

/**
 * CalculateRawBonus. The pools here are plain doubles while the game runs Q32.32, so a hair
 * of tolerance keeps a nominal 0.07 / 0.01 from flooring to 6 on representation error.
 */
export function fairyRawBonus(cfg: SeasonFairyStat, level: number, requiredTotal: number): number {
    if (!cfg.requiredStatValueDivider) return 0;
    const ratio = Math.abs(requiredTotal) / Math.abs(cfg.requiredStatValueDivider);
    const steps = Math.floor(ratio + 1e-9);
    return steps * fairyPerStep(cfg, level);
}

/** ApplyFairyStat: a positive raw grant lands in the pool, whose total is clamped to the cap. */
export function applyFairyBonus(
    cfg: SeasonFairyStat,
    level: number,
    requiredTotal: number,
    currentTargetTotal: number
): number {
    const raw = fairyRawBonus(cfg, level, requiredTotal);
    if (raw <= 0) return currentTargetTotal;
    return Math.min(currentTargetTotal + raw, cfg.targetStatTotalCap);
}
