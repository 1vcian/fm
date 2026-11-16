import { RARITIES } from './gameTiers';
/**
 * The one summon simulation shared by the Summons calculator (eggs, mounts, skills) and the
 * war-points engine (`warPoints.ts`).
 *
 * Game facts, read from the 2026_11_16_09_55 binary unless noted:
 *  - Level table per ascension: since 2026_11_16 the config holds `Ascensions[]` (each
 *    `{ Levels }`, entries may be null) instead of a top-level `Levels[]`. SummonConfig.PostLoad
 *    (RVA 0x7D03528) walks Ascensions in order with ONE accumulator list: a non-null entry with a
 *    non-empty Levels appends its rows to the accumulator, then (null or not) the accumulator's
 *    current contents are stored as that ascension's table. So the table of ascension N is the
 *    concatenation of every non-null Levels up to N, a null entry repeats the previous table, and
 *    a later entry extends the earlier rows (it does not replace them).
 *    SummonConfig.GetLevels(int) (RVA 0x7D03870) returns table[Min(ascension, tables - 1)];
 *    GetLevels(PlayerModel) (RVA 0x7CF1B10) passes AscensionModel.CurrentLevel of the summon's
 *    collection (SummonableId.GetAscensionModel, RVA 0x7D02FEC: Mounts, Pets for eggs, Skills).
 *    MaxLevel (RVA 0x7D03918) is that table's Count - 1 (0-based). Configs before 2026_11_16 have
 *    one `Levels[]` for every ascension.
 *  - Draw: the Skill/Mount/Egg SummonFinalizedAction.Execute (RVA 0x7CF21EC / 0x7CDEDF8 /
 *    0x7CE28B8) rolls each unit on GetLevels(player)[SummonModel.Level] (SummonLevelConfig.RollRarity).
 *  - Levelling: SummonModel.IncrementSummonCount(config, ascensionLevel) (RVA 0x7CF2D4C) runs once
 *    per unit obtained. It adds 1 to Count and, if Level + 1 < GetLevels(ascensionLevel).Count,
 *    compares Count with that table's [Level + 1].SummonsRequired on its 0-based Level: on success
 *    it subtracts the requirement and moves up one level. In this 1-based code, leaving level L
 *    needs `levels[L].SummonsRequired` (the NEXT row), and the top level is `levels.length` of the
 *    current ascension's table.
 *  - Freebies (extra chance) count toward progress and never chain (2026_10_08 build, RVA
 *    0x7843A3C), so the expected units per paid summon are `PossibleSummonCount[0] * (1 + extraChance)`.
 *  - Units per paid summon: SummonConfig.BaseSummonCount (RVA 0x7D034D4) = PossibleSummonCount[0].
 *  - Cost: SummonConfig.CanAffordSummon (RVA 0x7CF2028, unchanged from the previous build) is
 *    RoundToInt(Amount * count * (1 - reduction)) for the whole batch.
 *
 *  - Ascension: PlayerMountCollectionModel.Ascend (RVA 0x7CE0340) and PlayerPetCollectionModel.Ascend
 *    (RVA 0x7CE78D8) call SummonModel.Reset (RVA 0x7CF49C0), a single 8-byte store of zero over
 *    Count (+0x10) and Level (+0x14); PlayerSkillCollectionModel.Ascend (RVA 0x7CF4954) inlines the
 *    same store. The summoner restarts at level 1 with no progress (leftover Count is lost) and
 *    from then on levels through the new ascension's table.
 *
 * The player is assumed to ascend as soon as the summoner reaches the top level (levels and
 * phases restart at level 1 of the next ascension, up to `maxAscension`).
 *
 * Expected values, not random draws: every summon adds `chance * unitsPerSummon` of each rarity
 * from the probability row of the level it was made at.
 */

/** Rarities in game order (GameTiers.json): the columns of a summon config's Levels rows. */
export const SUMMON_RARITIES = RARITIES;

/**
 * The level table of every ascension, as SummonConfig.PostLoad (RVA 0x7D03528) builds
 * `_levelsByAscension`: one accumulator walks `Ascensions` in order, a non-null entry with rows
 * appends them, and every entry (null included) stores the accumulator as it stands. Configs
 * before 2026_11_16 have a single top-level `Levels[]`, used for every ascension.
 * Empty while the config is missing.
 */
export function summonLevelsByAscension(config: any): any[][] {
    if (Array.isArray(config?.Ascensions)) {
        const tables: any[][] = [];
        let acc: any[] = [];
        for (const asc of config.Ascensions) {
            const rows = asc?.Levels;
            if (Array.isArray(rows) && rows.length > 0) acc = acc.concat(rows);
            tables.push(acc);
        }
        return tables;
    }
    return Array.isArray(config?.Levels) ? [config.Levels] : [];
}

/**
 * The table a summoner at `ascension` levels through and draws on: SummonConfig.GetLevels(int)
 * (RVA 0x7D03870) = tables[Min(ascension, tables.Count - 1)].
 */
export function summonLevelsAt(tables: any[][], ascension: number): any[] {
    if (!tables.length) return [];
    return tables[Math.max(0, Math.min(Math.floor(ascension) || 0, tables.length - 1))] || [];
}

/**
 * Ascensions a collection has: the length of AscensionConfigsLibrary[kind].AscensionConfigPerLevel
 * (kind is 'Pets' for eggs, 'Mounts' or 'Skills'). 0 until the config has loaded: no hardcoded count.
 */
export function maxAscensionFrom(ascensionConfigs: any, kind: 'Pets' | 'Mounts' | 'Skills'): number {
    const n = ascensionConfigs?.[kind]?.AscensionConfigPerLevel?.length;
    return typeof n === 'number' && n > 0 ? n : 0;
}

export interface SummonPhase {
    label: string;
    startLevel: number;
    startAscension: number;
    endLevel: number;
    endAscension: number;
    /** Expected units obtained in this phase, per rarity. */
    counts: Record<string, number>;
}

export interface SummonSimulation {
    /** Expected units obtained, per rarity. */
    byRarity: Record<string, number>;
    /** Sum of `byRarity`. */
    units: number;
    summons: number;
    endLevel: number;
    /** Raw (unrounded) progress toward the next level at the end. */
    endProgress: number;
    endAscension: number;
    /** Paid summons spent before the first ascension, or null when none happened. */
    summonsToMax: number | null;
    /** One entry per ascension crossed, in order. */
    phases: SummonPhase[];
    /** True when the loop hit `maxIterations` and the tail was multiplied out on the last row. */
    extrapolated: boolean;
}

export interface SummonSimulationParams {
    /** The level table of each ascension, from `summonLevelsByAscension`. */
    levelsByAscension: any[][];
    /** 1-based summon level. */
    startLevel: number;
    startProgress: number;
    startAscension: number;
    simulateAscension: boolean;
    /** Ascensions available, from `maxAscensionFrom` (AscensionConfigsLibrary). */
    maxAscension: number;
    /** Paid summons to make. */
    summons: number;
    /** Expected units per paid summon, freebies included. */
    unitsPerSummon: number;
    /** Iteration ceiling; past it the remaining summons are multiplied out on the current row. */
    maxIterations?: number;
}

const emptyCounts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const rarity of SUMMON_RARITIES) out[rarity] = 0;
    return out;
};

const phaseLabel = (ascension: number) => (ascension === 0 ? 'Normal' : `Ascension ${ascension}`);

/** Summoner position: 1-based level, raw progress toward the next level, ascension. */
interface SummonState {
    level: number;
    progress: number;
    ascension: number;
}

/**
 * Applies one paid summon's units to `s` the way IncrementSummonCount (RVA 0x7CF2D4C) does:
 * leaving 1-based level L needs `levels[L].SummonsRequired` of the current ascension's table,
 * overflow inside the batch carries to the next level. With `ascendAtTop` the summoner ascends the
 * moment it reaches the top level and `ascend` performs SummonModel.Reset, so the rest of that
 * batch is lost.
 */
function addSummonProgress(
    tables: any[][], s: SummonState, units: number,
    ascendAtTop: boolean, ascend: () => void,
): void {
    const levels = summonLevelsAt(tables, s.ascension);
    const maxLevel = levels.length;
    s.progress += units;
    let threshold = levels[s.level]?.SummonsRequired;
    while (threshold && s.progress >= threshold) {
        s.progress -= threshold;
        s.level += 1;
        if (ascendAtTop && s.level >= maxLevel) {
            ascend();
            return;
        }
        if (s.level > maxLevel) {
            s.level = maxLevel;
            return;
        }
        threshold = levels[s.level]?.SummonsRequired;
    }
}

export function simulateSummons(params: SummonSimulationParams): SummonSimulation {
    const {
        levelsByAscension: tables, startProgress, startAscension, simulateAscension, summons,
        unitsPerSummon: perSummon,
    } = params;
    const maxAscension = params.maxAscension;
    const maxIterations = params.maxIterations ?? Infinity;
    // The top level is the length of the current ascension's table (GetLevels, RVA 0x7D03870).
    const maxLevelAt = (asc: number) => summonLevelsAt(tables, asc).length;

    const s: SummonState = { level: params.startLevel, progress: startProgress, ascension: startAscension };
    let summonsToMax: number | null = null;
    let extrapolated = false;

    const phases: SummonPhase[] = [];
    const newPhase = (lvl: number, asc: number): SummonPhase => ({
        label: phaseLabel(asc),
        startLevel: lvl,
        startAscension: asc,
        endLevel: lvl,
        endAscension: asc,
        counts: emptyCounts(),
    });
    let phase = newPhase(s.level, s.ascension);

    let done = 0;
    /** Close the current phase at the top level and open the next ascension at level 1. */
    const ascend = () => {
        if (summonsToMax === null) summonsToMax = done;
        phase.endLevel = maxLevelAt(s.ascension);
        phase.endAscension = s.ascension;
        phases.push(phase);
        // SummonModel.Reset (RVA 0x7CF49C0): Count and Level both go back to 0.
        s.level = 1;
        s.progress = 0;
        s.ascension += 1;
        phase = newPhase(s.level, s.ascension);
    };

    /** Add `times` summons drawn on the probability row of 1-based level `lvl` at the current ascension. */
    const addRow = (lvl: number, times: number) => {
        const row = summonRowAt(summonLevelsAt(tables, s.ascension), lvl);
        if (times <= 0) return;
        for (const rarity of SUMMON_RARITIES) {
            const chance = row[rarity] || 0;
            if (times === 1) {
                phase.counts[rarity] += chance * perSummon;
            } else if (chance > 0) {
                phase.counts[rarity] += chance * perSummon * times;
            }
        }
    };

    while (done < summons) {
        const canAscend = simulateAscension && s.ascension < maxAscension;
        const maxLevel = maxLevelAt(s.ascension);

        // Frozen: no further level-up or ascension is possible, so every remaining summon draws
        // this exact row. Multiplying it out is exact and keeps huge banks synchronous.
        // Count still grows at the top level (IncrementSummonCount keeps adding), it just never levels.
        if (s.level >= maxLevel && !canAscend) {
            addRow(s.level, summons - done);
            // Added one summon at a time (not multiplied) so the rounded end progress matches
            // the per-summon loop to the last bit; it is a plain add, cheap even for huge piles.
            for (let k = done; k < summons; k++) s.progress += perSummon;
            done = summons;
            break;
        }
        if (done >= maxIterations) {
            addRow(s.level, summons - done);
            s.progress += perSummon * (summons - done);
            extrapolated = true;
            done = summons;
            break;
        }

        // Starting a summon at the top level with an ascension left: ascend first.
        if (canAscend && s.level >= maxLevel) ascend();

        addRow(s.level, 1);
        done += 1;
        addSummonProgress(tables, s, perSummon, canAscend, ascend);
    }

    phase.endLevel = s.level;
    phase.endAscension = s.ascension;
    phases.push(phase);

    const byRarity = emptyCounts();
    for (const p of phases) {
        for (const rarity of SUMMON_RARITIES) byRarity[rarity] += p.counts[rarity];
    }
    let units = 0;
    for (const rarity of SUMMON_RARITIES) units += byRarity[rarity];

    return {
        byRarity,
        units,
        summons,
        endLevel: s.level,
        endProgress: s.progress,
        endAscension: s.ascension,
        summonsToMax,
        phases,
        extrapolated,
    };
}

/**
 * Units one paid summon yields: PossibleSummonCount[0] (SummonConfig.BaseSummonCount, RVA 0x7D034D4).
 * NaN while the config is missing or has no such entry: callers show a loading / unavailable state
 * instead of a guessed count.
 */
export function baseSummonCount(config: any): number {
    const first = Number(config?.PossibleSummonCount?.[0]);
    return Number.isFinite(first) && first > 0 ? first : NaN;
}

/**
 * Currency for one paid summon: RoundToInt(Amount * count * (1 - reduction))
 * (SummonConfig.CanAffordSummon, RVA 0x7CF2028). The reduction applies to the whole batch and
 * rounds to nearest.
 */
export function summonCost(amountPerUnit: number, unitsPerSummon: number, costReduction: number): number {
    return Math.round(amountPerUnit * unitsPerSummon * (1 - costReduction));
}

/** Paid summons a currency pile buys. */
export function affordableSummons(currency: number, costPerSummon: number): number {
    return Math.floor(currency / Math.max(1, costPerSummon));
}

/** The probability row the summoner draws on at 1-based level `level` of one ascension's table. */
export function summonRowAt(levels: any[], level: number): any {
    return levels[Math.min(level - 1, levels.length - 1)] || {};
}

/**
 * Paid-summon currency needed to go from (level, progress, ascension) to (targetLevel,
 * targetAscension). It steps whole paid summons through `addSummonProgress`, the same level-up
 * and ascension rules as `simulateSummons` with ascension enabled: overflow inside a batch carries
 * to the next level, while reaching the top level ascends at once and SummonModel.Reset drops the
 * leftover progress. A target past the last ascension's top level costs what reaching it does.
 */
export function currencyToReach(params: {
    levelsByAscension: any[][];
    level: number;
    progress: number;
    ascension: number;
    targetLevel: number;
    targetAscension: number;
    unitsPerSummon: number;
    costPerSummon: number;
    maxAscension: number;
}): number {
    const { levelsByAscension: tables, targetLevel, targetAscension, unitsPerSummon, costPerSummon } = params;
    if (!tables.length || !(unitsPerSummon > 0)) return 0;
    const maxAscension = params.maxAscension;
    const maxLevelAt = (asc: number) => summonLevelsAt(tables, asc).length;

    const s: SummonState = { level: params.level, progress: params.progress, ascension: params.ascension };
    const ascend = () => {
        s.level = 1;
        s.progress = 0;
        s.ascension += 1;
    };
    const reached = () => s.ascension > targetAscension
        || (s.ascension === targetAscension && s.level >= targetLevel);

    // Already at the top with an ascension left: ascending costs no summon currency.
    if (!reached() && s.level >= maxLevelAt(s.ascension) && s.ascension < maxAscension) ascend();

    let summons = 0;
    while (!reached()) {
        const canAscend = s.ascension < maxAscension;
        if (!(maxLevelAt(s.ascension) > 0)) break;
        if (s.level >= maxLevelAt(s.ascension) && !canAscend) break;
        addSummonProgress(tables, s, unitsPerSummon, canAscend, ascend);
        summons += 1;
    }
    return summons * costPerSummon;
}
