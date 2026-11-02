/**
 * Fairies: the seasonal LiveOps feature added in 2.9.0. Mechanics verified from
 * libil2cpp.so build 2026_09_02_09_08:
 *
 *   FairyHelpers.CalculateRawBonus (RVA 0x775203C; 0x7804B9C in build 2026_10_08_09_03):
 *     required = Stats.GetDisplayedSecondaryTotal (0x7864100): the sum of each line rounded by
 *                SecondaryStatHelper.RoundToDisplayResolution, i.e. the values the game shows
 *     steps    = FloorToInt(required / RequiredStatValueDivider + MultipleTolerance), then |steps|
 *                (MultipleTolerance = Ratio1000(1) = 0.001, FairyHelpers .cctor 0x7804D80)
 *     perStep  = TargetStatBonus + TargetStatBonusPerLevel * (level - 1)
 *     raw      = |steps| * perStep
 *
 *   FairyHelpers.ApplyFairyStat (RVA 0x7751CA0; 0x7804818 in build 2026_10_08_09_03):
 *     when raw != 0 the target's secondary-stat pool becomes
 *     min(poolTotal + raw, TargetStatTotalCap) -- the cap clamps the POOL TOTAL, not the
 *     grant (so a pool already above the cap is pulled down to it), and both required and
 *     target totals live in the game's SecondaryStatType aggregate (item/pet substats), which
 *     maps to statEngine's secondaryStats pools. Called from CalculateTotalStats (0x77B3AF0),
 *     so it applies in every mode, PvP snapshots included.
 *
 * The per-fairy rows (FairyStatLibrary) are NOT in the client config archive: they arrive
 * inside FairiesEventConfig.Stats with the live event (ServerGameConfig LiveOps template).
 * SEASON_STATS reads one of two transcribed tables, by the UTC clock (NEW_SEASON_FROM). Both
 * must be re-checked each season.
 *   SEASON_2026_09: the event live from 2026-09-07 09:30 to 2026-11-02 18:00 UTC
 *     (FairiesEventConfig.Stats as the server sent it on 2026-11-01). Base equals growth.
 *   SEASON_2026_11: transcribed from the in-game descriptions. Only the MAX level (20) values were
 *     read: Mira +220% Damage on every 5th attack (flat), Tira -14% incoming Critical Damage per
 *     -4% Skill Cooldown (total capped at 70%), Lora +15% Damage per +10% Health (no cap). The
 *     same base equals growth split is used, so level 20 is exact and lower levels follow that
 *     pattern until they are checked in game.
 */

export type FairyName = 'Mira' | 'Tira' | 'Lora';

export const FAIRIES: { name: FairyName; texture: string }[] = [
    { name: 'Lora', texture: 'FairyIconLora.png' },
    { name: 'Mira', texture: 'FairyIconMira.png' },
    { name: 'Tira', texture: 'FairyIconTira.png' },
];

/** Only for the screenshot card reader (ocr/cardReader.ts), which gets no configs: the top level of FairyUpgradesLibrary (levels 2..20 in 2026_10_08_09_03). UI code reads the library. */
export const FAIRY_MAX_LEVEL = 20;

/**
 * statEngine pools a fairy can grant into (SecondaryStatType in game). criticalDamageReduction
 * and nthAttackDamageMulti exist from build 2026_10_27_09_45, with the description formats
 * FairyCritDamageReductionDescriptionFormat and FairyNthAttackDamageDescriptionFormat (Fairies
 * localization table); damageMulti is the DamageMulti substat pool.
 */
export type FairyTargetStat = 'criticalChance' | 'blockChance' | 'reflectChance' | 'criticalDamageReduction' | 'nthAttackDamageMulti' | 'damageMulti';

export interface SeasonFairyStat {
    /** statEngine secondaryStats pool the fairy grants into (SecondaryStatType in game). */
    targetStat: FairyTargetStat;
    targetLabel: string;
    targetStatBonus: number;
    targetStatBonusPerLevel: number;
    /** statEngine secondaryStats pool the conversion reads; null for a flat fairy. */
    requiredStat: 'skillDamageMulti' | 'skillCooldownMulti' | 'healthMulti' | null;
    requiredLabel: string;
    requiredStatValueDivider: number;
    /** Skill Cooldown substats are reductions, so their steps read as "-1%" in game. */
    requiredStatIsReduction?: boolean;
    /** FairyStatLibrary.TargetStatTotalCap is Nullable<F64>: null means no cap. */
    targetStatTotalCap: number | null;
}

const SEASON_2026_09: Record<FairyName, SeasonFairyStat> = {
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

const SEASON_2026_11: Record<FairyName, SeasonFairyStat> = {
    Mira: {
        targetStat: 'nthAttackDamageMulti',
        targetLabel: 'Damage on every 5th attack',
        targetStatBonus: 0.11,
        targetStatBonusPerLevel: 0.11,
        requiredStat: null,
        requiredLabel: '',
        requiredStatValueDivider: 0,
        targetStatTotalCap: null,
    },
    Tira: {
        targetStat: 'criticalDamageReduction',
        targetLabel: 'Incoming Critical Damage Reduction',
        targetStatBonus: 0.007,
        targetStatBonusPerLevel: 0.007,
        requiredStat: 'skillCooldownMulti',
        requiredLabel: 'Skill Cooldown',
        requiredStatValueDivider: 0.04,
        requiredStatIsReduction: true,
        targetStatTotalCap: 0.7,
    },
    Lora: {
        targetStat: 'damageMulti',
        targetLabel: 'Damage',
        targetStatBonus: 0.0075,
        targetStatBonusPerLevel: 0.0075,
        requiredStat: 'healthMulti',
        requiredLabel: 'Health',
        requiredStatValueDivider: 0.1,
        targetStatTotalCap: null,
    },
};

/** When SEASON_2026_11 takes over: 2026-11-03 00:00 UTC. */
export const NEW_SEASON_FROM = Date.UTC(2026, 10, 3);

export const isNewSeason = (now = Date.now()) => now >= NEW_SEASON_FROM;

const currentSeason = () => (isNewSeason() ? SEASON_2026_11 : SEASON_2026_09);

/** The season's table, read again at every access so a page left open switches at NEW_SEASON_FROM. */
export const SEASON_STATS: Record<FairyName, SeasonFairyStat> = new Proxy({} as Record<FairyName, SeasonFairyStat>, {
    get: (_, k) => currentSeason()[k as FairyName],
    has: (_, k) => k in currentSeason(),
    ownKeys: () => Reflect.ownKeys(currentSeason()),
    getOwnPropertyDescriptor: (_, k) => Reflect.getOwnPropertyDescriptor(currentSeason(), k),
});

/**
 * The preset builds file of a config version: the ones built on SEASON_2026_11 once it is live
 * (scripts/build_presets.ts run with those fairies), ProfilePresets.json otherwise.
 */
const NEW_SEASON_PRESETS = new Set(['2026_10_27_09_45']);
export const presetsFileName = (version: string | null | undefined, now = Date.now()) =>
    version && isNewSeason(now) && NEW_SEASON_PRESETS.has(version) ? 'ProfilePresets.fairies_2026_11.json' : 'ProfilePresets.json';

/** The bonus one step grants at a given fairy level (binary: base + growth x (level - 1)). */
export function fairyPerStep(cfg: SeasonFairyStat, level: number): number {
    return cfg.targetStatBonus + cfg.targetStatBonusPerLevel * (Math.max(1, level) - 1);
}

/** FairyHelpers.MultipleTolerance: Ratio1000(1), added before the floor. */
export const FAIRY_MULTIPLE_TOLERANCE = 0.001;

/**
 * CalculateRawBonus (0x783E894 in 2026_10_27_09_45): HasRequiredStat is
 * RequiredStatValueDivider != 0. Without it the fairy is flat ("Gain {0}."): the level's bonus,
 * whatever is equipped (GetBonusAtLevel 0x783EAA0). With it, whole steps of the displayed
 * required total, with the game's tolerance, and nothing when that total is 0.
 */
export function fairyRawBonus(cfg: SeasonFairyStat, level: number, requiredTotal: number): number {
    if (!cfg.requiredStatValueDivider) return fairyPerStep(cfg, level);
    if (requiredTotal === 0) return 0;
    const steps = Math.abs(Math.floor(requiredTotal / cfg.requiredStatValueDivider + FAIRY_MULTIPLE_TOLERANCE));
    return steps * fairyPerStep(cfg, level);
}

/** What a raw grant actually adds to a pool at `targetBefore`, after the optional cap. */
export function fairyGranted(cfg: SeasonFairyStat, raw: number, targetBefore: number): number {
    if (raw <= 0) return 0;
    const total = targetBefore + raw;
    const after = cfg.targetStatTotalCap === null ? total : Math.min(total, cfg.targetStatTotalCap);
    return Math.max(0, after - targetBefore);
}

/** "+X Target" (flat) or "+X Target per +Y Required equipped", plus ", cap +Z" when capped. */
export function fairySummary(cfg: SeasonFairyStat, level: number, pct: (v: number) => string): string {
    const gain = `+${pct(fairyPerStep(cfg, level))} ${cfg.targetLabel}`;
    const per = cfg.requiredStatValueDivider && cfg.requiredStat
        ? ` per ${cfg.requiredStatIsReduction ? '-' : '+'}${pct(cfg.requiredStatValueDivider)} ${cfg.requiredLabel} equipped`
        : '';
    const cap = cfg.targetStatTotalCap === null ? '' : `, cap +${pct(cfg.targetStatTotalCap)}`;
    return gain + per + cap;
}

/** ApplyFairyStat: a non-zero raw grant lands in the pool, whose total is clamped to the cap. */
export function applyFairyBonus(
    cfg: SeasonFairyStat,
    level: number,
    requiredTotal: number,
    currentTargetTotal: number
): number {
    const raw = fairyRawBonus(cfg, level, requiredTotal);
    if (raw === 0) return currentTargetTotal;
    const total = currentTargetTotal + raw;
    return cfg.targetStatTotalCap === null ? total : Math.min(total, cfg.targetStatTotalCap);
}
