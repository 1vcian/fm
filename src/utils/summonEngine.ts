/**
 * The one summon simulation shared by the Summons calculator (eggs, mounts, skills) and the
 * war-points engine (`warPoints.ts`).
 *
 * Game facts, each read from the 2026_10_08_09_03 binary:
 *  - Levelling: SummonModel.IncrementSummonCount (RVA 0x78666A4) runs once per unit obtained. It
 *    adds 1 to Count and, while Level + 1 < Levels.Count, compares Count with
 *    Levels[Level + 1].SummonsRequired on its 0-based Level: on success it subtracts the
 *    requirement and moves up one level. In this 1-based code, leaving level L needs
 *    `levels[L].SummonsRequired` (the NEXT row), and the top level is `levels.length`.
 *  - Freebies (extra chance) count toward progress and never chain (RVA 0x7843A3C), so the
 *    expected units per paid summon are `PossibleSummonCount[0] * (1 + extraChance)`.
 *  - Units per paid summon: SummonConfig.BaseSummonCount (RVA 0x7865E88) = PossibleSummonCount[0].
 *  - Cost: SummonConfig.CanAffordSummon (RVA 0x7865EDC) is
 *    RoundToInt(Amount * count * (1 - reduction)) for the whole batch.
 *
 *  - Ascension: PlayerMountCollectionModel.Ascend (RVA 0x7844E78), PlayerPetCollectionModel.Ascend
 *    (RVA 0x784A1EC) and PlayerSkillCollectionModel.Ascend (RVA 0x785894C) each call
 *    SummonModel.Reset (RVA 0x786677C), a single 8-byte store of zero over Count (+0x10) and
 *    Level (+0x14). The summoner restarts at level 1 with no progress: leftover Count is lost.
 *
 * The player is assumed to ascend as soon as the summoner reaches the top level (levels and
 * phases restart at level 1 of the next ascension, up to `maxAscension`).
 *
 * Expected values, not random draws: every summon adds `chance * unitsPerSummon` of each rarity
 * from the probability row of the level it was made at.
 */

export const SUMMON_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

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
    /** The config's `Levels` array (probabilities per rarity and SummonsRequired per row). */
    levels: any[];
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
 * Applies one paid summon's units to `s` the way IncrementSummonCount (RVA 0x78666A4) does:
 * leaving 1-based level L needs `levels[L].SummonsRequired`, overflow inside the batch carries to
 * the next level. With `ascendAtTop` the summoner ascends the moment it reaches the top level and
 * `ascend` performs SummonModel.Reset, so the rest of that batch is lost.
 */
function addSummonProgress(
    levels: any[], maxLevel: number, s: SummonState, units: number,
    ascendAtTop: boolean, ascend: () => void,
): void {
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
        levels, startProgress, startAscension, simulateAscension, summons,
        unitsPerSummon: perSummon,
    } = params;
    const maxAscension = params.maxAscension;
    const maxIterations = params.maxIterations ?? Infinity;
    const maxLevel = levels.length || 100;

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
        phase.endLevel = maxLevel;
        phase.endAscension = s.ascension;
        phases.push(phase);
        // SummonModel.Reset (RVA 0x786677C): Count and Level both go back to 0.
        s.level = 1;
        s.progress = 0;
        s.ascension += 1;
        phase = newPhase(s.level, s.ascension);
    };

    /** Add `times` summons drawn on the probability row of 1-based level `lvl`. */
    const addRow = (lvl: number, times: number) => {
        const row = levels[Math.min(lvl - 1, levels.length - 1)];
        if (!row || times <= 0) return;
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
        addSummonProgress(levels, maxLevel, s, perSummon, canAscend, ascend);
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

/** Units one paid summon yields: PossibleSummonCount[0] (SummonConfig.BaseSummonCount, RVA 0x7865E88). */
export function baseSummonCount(config: any, fallback: number): number {
    const first = Number(config?.PossibleSummonCount?.[0]);
    return Number.isFinite(first) && first > 0 ? first : fallback;
}

/**
 * Currency for one paid summon: RoundToInt(Amount * count * (1 - reduction))
 * (SummonConfig.CanAffordSummon, RVA 0x7865EDC). The reduction applies to the whole batch and
 * rounds to nearest.
 */
export function summonCost(amountPerUnit: number, unitsPerSummon: number, costReduction: number): number {
    return Math.round(amountPerUnit * unitsPerSummon * (1 - costReduction));
}

/** Paid summons a currency pile buys. */
export function affordableSummons(currency: number, costPerSummon: number): number {
    return Math.floor(currency / Math.max(1, costPerSummon));
}

/** The probability row the summoner draws on at 1-based level `level`. */
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
    levels: any[];
    level: number;
    progress: number;
    ascension: number;
    targetLevel: number;
    targetAscension: number;
    unitsPerSummon: number;
    costPerSummon: number;
    maxAscension: number;
}): number {
    const { levels, targetLevel, targetAscension, unitsPerSummon, costPerSummon } = params;
    if (!levels.length || !(unitsPerSummon > 0)) return 0;
    const maxAscension = params.maxAscension;
    const maxLevel = levels.length;

    const s: SummonState = { level: params.level, progress: params.progress, ascension: params.ascension };
    const ascend = () => {
        s.level = 1;
        s.progress = 0;
        s.ascension += 1;
    };
    const reached = () => s.ascension > targetAscension
        || (s.ascension === targetAscension && s.level >= targetLevel);

    // Already at the top with an ascension left: ascending costs no summon currency.
    if (!reached() && s.level >= maxLevel && s.ascension < maxAscension) ascend();

    let summons = 0;
    while (!reached()) {
        const canAscend = s.ascension < maxAscension;
        if (s.level >= maxLevel && !canAscend) break;
        addSummonProgress(levels, maxLevel, s, unitsPerSummon, canAscend, ascend);
        summons += 1;
    }
    return summons * costPerSummon;
}
