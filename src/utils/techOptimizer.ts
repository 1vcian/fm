/**
 * The tech-tree spend optimiser, as a pure function.
 * =================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The greedy optimiser used to live entirely inside `useTreeOptimizer`'s `useMemo`. That body was
 * already pure — no `useState`, no context reads, no `setX`, and its dependency list was a complete
 * and explicit list of its inputs — but it could only be reached by MOUNTING the hook, and the hook
 * cannot be mounted from a data layer for one hard reason:
 *
 *     useEffect(() => { updateProfile({ misc: { ...profile.misc, techPotions: potions } }); }, [potions])
 *
 * That effect writes the profile on mount. `profiles_touch` bumps `profiles.version` on every
 * update, and the sync engine reads an unexpected version as "somebody else wrote this row" and
 * raises the keep-mine/take-theirs conflict UX. So a war-points engine that mounted the hook would
 * fight the sync ledger every time it recomputed.
 *
 * Hence: the algorithm moves here, verbatim, and `useTreeOptimizer` becomes a thin wrapper that
 * still owns the state, the potions write-back and `applyUpgrades`. Nothing about the hook's
 * behaviour changes — `reverseForge/scratch/tech_optimizer_parity.ts` runs a frozen transcription of
 * the pre-extraction memo body against this function and asserts the two agree action for action.
 *
 * WHAT STAYED IN THE HOOK, AND WHY IT HAD TO
 * ------------------------------------------
 *  - `treeMode`. The header's My/Max/Empty toggle is a *display* mode, and `'max'` makes the hook
 *    return `{ totalPoints: 0, actions: [] }` because there is nothing left to optimise. A share or
 *    a war projection must always plan against the profile's REAL tree, so it resolves the tree
 *    itself and never goes near the toggle. Keeping the branch hook-side is what makes both callers
 *    correct at once.
 *  - `new Date()`. `planStartMs` decides which upgrades finish on a war day, so it is an input here
 *    rather than an ambient read: a test that cannot pin the clock cannot assert anything.
 *  - the potions state and `applyUpgrades`, which are writes.
 */

import { computeWarDaysMap, getWarDayIndex } from './guildWarUtils';

/**
 * How many day boundaries the war-day aligner will step over looking for a scoring completion.
 * A war week is six days, so 14 is already unreachable; it exists so a pathological `dayConfig`
 * (no tech day at all) cannot spin.
 */
const MAX_ALIGN_DAYS = 14;

export interface TechUpgrade {
    tree: string;
    nodeId: number;
    nodeName: string;
    type: string;
    fromLevel: number;
    toLevel: number;
    cost: number;
    duration: number;
    points: number;
    warPoints: number;
    tier: number;
    sprite_rect?: { x: number; y: number; width: number; height: number };
    gemCost?: number;
    isWarDay?: boolean;
    endDate?: Date;
}

export interface TechTreeLevels {
    Forge: Record<number, number>;
    Power: Record<number, number>;
    SkillsPetTech: Record<number, number>;
    Clan: Record<number, number>;
}

export interface TechBonuses {
    /**
     * Potion cost reduction from `TechNodeUpgradeCost` (Cost / OneMinusMultiplier, target TechTree).
     * Not clamped: the stat pipeline (StatHelper.CalculateValueFromStats 0x78605C4, LayerBucket.Add
     * 0x7860320) only sums contributions, and the action applies no cap of its own.
     */
    costReduction: number;
    /** Research speed-up from `TechResearchTimer`, applied as `duration / (1 + speedBonus)`. */
    speedBonus: number;
}

export interface TechOptimizerInput {
    /** TechTreeMapping.json — the node graph (id, type, tier, requirements) per tree. */
    mapping: any;
    /** TechTreeLibrary.json — per node type: `Stats[0]`, `MaxLevel`. Reconstructed by `useGameData`. */
    library: any;
    /** TechTreeUpgradeLibrary.json — per tier: `Levels[].{Cost,Duration}`. Also reconstructed. */
    upgradeLibrary: any;
    /** GuildWarDayConfigLibrary.json — tier point values AND which days `tech` scores on. */
    dayConfig: any;
    /** ForgeConfig.json — `TechTreeGemSkipCostPerSecond`. */
    forgeConfig: any;
    /**
     * The tree to plan from. ALWAYS pass the profile's own levels for a war projection; the
     * My/Max/Empty display toggle must not reach this function (see the header).
     */
    techTree: TechTreeLevels;
    /** Tech potions available to spend. */
    potions: number;
    /** How far ahead the plan may run before gems are needed to skip the remaining time. */
    timeLimitHours: number;
    /** Gems available for skipping research timers. 0 disables gem skipping entirely. */
    gemBudget: number;
    /** `WarPointsFromTechUpgrade` from the clan tree, as a fraction (0.4 = +40%). */
    warBonus: number;
    /** `WarPointsOnDayN` for the day in question, as a fraction. Usually 0 — see `warPoints.ts`. */
    dayBoost: number;
    /** Wall clock the plan starts at. Decides which upgrades land on a tech war day. */
    planStartMs: number;
    /** Safety break on the greedy loop. The default is the historical value. */
    maxIterations?: number;
    /**
     * Insert idle time so a completion lands INSIDE a tech war day whenever one is still reachable
     * within `timeLimitHours`.
     *
     * Default `false`, which is the shipped behaviour: start every upgrade the instant the previous
     * one finishes and award war points only to the ones that happen to land on a tech day. That is
     * what the Tree Calculator shows, and it answers "what if I start researching right now and
     * never stop" — a reasonable planning question, but it makes the war-point total a function of
     * the hour the plan was made. The same tree, the same potions and the same config score 0 at
     * 01:00 and 77,280 at 01:00 the next day, because the queue drifts across the day boundary.
     *
     * `true` is for a war projection, where the question is "how many points can these potions still
     * be turned into". A player chooses when to START research, so a completion can be walked
     * forward onto a tech day at will; the cost is the idle time, which is charged against the same
     * horizon. Only the placement changes — selection, potions, gems and tree points are untouched.
     */
    alignCompletionsToWarDays?: boolean;
}

export interface TechOptimizerResult {
    /** Tree points (the in-game research score), not war points. */
    totalPoints: number;
    /** War points from the upgrades that FINISH on a tech war day. This is the war-relevant total. */
    totalWarPoints: number;
    actions: TechUpgrade[];
    /** Wall-clock hours the plan spans, research + any idle inserted to hit a war day. */
    timeUsed: number;
    baseTimeUsed: number;
    gemTimeUsed: number;
    /** Research hours alone. Equals `timeUsed` unless `alignCompletionsToWarDays` inserted idle. */
    researchTimeUsed: number;
    /** Hours spent waiting so a completion lands on a tech war day. 0 unless aligning. */
    idleTimeUsed: number;
    potionsUsed: number;
    remainingPotions: number;
    finalBonuses: TechBonuses;
    totalGemsUsed: number;
}

/**
 * Tier → war-point value, read from the config and then boosted.
 *
 * The literal fallbacks are the pre-config values and are kept only so a missing/renamed task never
 * silently zeroes a tier; every shipped config since has overwritten all five.
 */
export function tierPointsFrom(dayConfig: any, warBonus: number, dayBoost: number): Record<number, number> {
    const tierPoints: Record<number, number> = {
        0: 300,   // I
        1: 7500,  // II
        2: 20000, // III
        3: 35000, // IV
        4: 62000, // V
    };

    if (dayConfig) {
        const taskToTier: Record<string, number> = {
            FinishITechTreeUpgrade: 0,
            FinishIITechTreeUpgrade: 1,
            FinishIIITechTreeUpgrade: 2,
            FinishIVTechTreeUpgrade: 3,
            FinishVTechTreeUpgrade: 4,
        };

        Object.values(dayConfig).forEach((dayData: any) => {
            dayData.Tasks?.forEach((task: any) => {
                const tier = taskToTier[task.Task];
                if (tier !== undefined) {
                    const amount = task.Rewards?.find((r: any) => r.$type === 'WarPointsReward')?.Amount;
                    if (amount) tierPoints[tier] = amount;
                }
            });
        });
    }

    // The clan boost is additive inside one multiplier, exactly as every other war calculator in
    // the app does it: `base * (1 + categoryNode + dayNode)`.
    for (const tier of Object.keys(tierPoints)) {
        tierPoints[Number(tier)] = tierPoints[Number(tier)] * (1 + warBonus + dayBoost);
    }

    return tierPoints;
}

/**
 * Cost reduction and research speed the tree currently grants.
 *
 * Recomputed after every accepted upgrade, because raising `TechNodeUpgradeCost` makes the NEXT
 * upgrade cheaper — that feedback loop is the whole reason the optimiser is a simulation and not a
 * sort. Requirements are deliberately NOT validated here: this mirrors the shipped behaviour, where
 * a level a user typed in counts whether or not its prerequisites are also typed in.
 */
export function calculateTechBonuses(
    mapping: any,
    library: any,
    tree: Record<string, Record<number, number>>,
): TechBonuses {
    let costReduction = 0;
    let speedBonus = 0;

    Object.entries(tree).forEach(([treeName, treeNodes]) => {
        const treeDef = mapping?.trees?.[treeName];
        if (!treeDef || !treeDef.nodes) return;

        treeDef.nodes.forEach((node: any) => {
            const nodeType = node.type;
            if (nodeType !== 'TechNodeUpgradeCost' && nodeType !== 'TechResearchTimer') return;

            const nodeConfig = library?.[nodeType];
            if (!nodeConfig) return;

            const nodeLevel = treeNodes[node.id] || 0;
            if (nodeLevel > 0 && nodeConfig.Stats?.[0]) {
                const stat = nodeConfig.Stats[0];
                const val = stat.Value + ((nodeLevel - 1) * stat.ValueIncrease);
                if (nodeType === 'TechNodeUpgradeCost') {
                    costReduction += val;
                } else if (nodeType === 'TechResearchTimer') {
                    speedBonus += val;
                }
            }
        });
    });

    return { costReduction, speedBonus };
}

/** FD6 (Metaplay.Core.Math.FD6) raw scale: values are stored as integers times 10^6. */
const FD6_ONE = 1_000_000n;

/**
 * Potion cost and research seconds of the upgrade from `currentLevel` to `currentLevel + 1` on a
 * node of `tier`, with the tree's own bonuses applied, or `null` when TechTreeUpgradeLibrary has no
 * row for that level. Shared by the optimiser and the Tree Calculator planner (`useTreePlanner`).
 *
 * Mirrors TechTreeNodeUpgradeStartAction.Execute (RVA 0x7868888) in FD6 fixed point:
 *   cost     = FD6.RoundToInt(Cost * (1 - costReduction))          (RoundToInt 0x719864C, half up)
 *   duration = StatHelper.CalculateValue(TimerSpeed, Duration) = Duration / (1 + speedBonus)
 *              (FD6 division 0x71977A8 truncates), converted with FD6.get_F64 (0x71964F8, Q32.32,
 *              truncating) and handed to TimerModel..ctor (0x78692EC), which calls
 *              MetaDuration.FromSeconds(F64, RoundingMode.Floor) (0x72B4690): whole milliseconds,
 *              floored. The returned duration is therefore in seconds with millisecond resolution.
 */
export function techUpgradeCostAndDuration(
    upgradeLibrary: any,
    tier: number,
    currentLevel: number,
    bonuses: TechBonuses,
): { cost: number; duration: number } | null {
    const levelData = upgradeLibrary?.[tier.toString()]?.Levels?.find((l: any) => l.Level === currentLevel);
    if (!levelData) return null;
    return techLevelCostAndDuration(levelData, bonuses);
}

/** The arithmetic of `techUpgradeCostAndDuration` on one TechTreeUpgradeLibrary row `{ Cost, Duration }`. */
export function techLevelCostAndDuration(
    levelData: { Cost: number; Duration: number },
    bonuses: TechBonuses,
): { cost: number; duration: number } {
    // Cost: FD6(Cost) * (1 - r) is exact for an integer Cost, then RoundToInt rounds half up.
    const oneMinusRaw = 1_000_000 - Math.round(bonuses.costReduction * 1_000_000);
    const costRaw = Math.round(levelData.Cost) * oneMinusRaw;
    const costInt = Math.trunc(costRaw / 1_000_000);
    const costRem = costRaw - costInt * 1_000_000;
    const cost = costInt + (costRem * 2 >= 1_000_000 ? 1 : 0);

    return { cost, duration: timerSpeedDurationSeconds(levelData.Duration, bonuses.speedBonus) };
}

/**
 * Timer seconds of a `Duration` row sped up by a TimerSpeed Divisor bonus, exactly as the game starts
 * the timer: StatHelper.CalculateValueFromStats (0x78605C4) divides by (DefaultValue 1 + summed Divisor
 * contributions, LayerBucket.Add 0x7860320) in FD6 (division 0x71977A8 truncates), FD6.get_F64
 * (0x71964F8) truncates to Q32.32, and TimerModel..ctor(PlayerModel, F64) (0x78692EC) floors to whole
 * milliseconds via MetaDuration.FromSeconds(F64, RoundingMode.Floor) (0x72B4690).
 * Shared by tech research and forge upgrades (ForgeUpgradeStartAction 0x783A3C8).
 */
export function timerSpeedDurationSeconds(durationSeconds: number, speedBonus: number): number {
    const durationRaw = BigInt(Math.round(durationSeconds * 1_000_000));
    const divisorRaw = FD6_ONE + BigInt(Math.round(speedBonus * 1_000_000));
    if (divisorRaw <= 0n) return durationSeconds;
    const quotientRaw = (durationRaw * FD6_ONE) / divisorRaw;
    const f64Raw = (quotientRaw << 32n) / FD6_ONE;
    const durationMs = (f64Raw * 1000n) >> 32n;
    return Number(durationMs) / 1000;
}

/**
 * Greedy "spend potions and time for the most war points" plan.
 *
 * The loop is unchanged from the version that shipped inside `useTreeOptimizer`:
 *   1. recompute the tree's own cost/speed bonuses,
 *   2. enumerate every legal next level across all 235 nodes,
 *   3. sort by tree points per second,
 *   4. take the first candidate that fits the remaining potions, time and gems,
 *   5. apply it to the virtual tree and repeat.
 *
 * It is a LOWER BOUND on what a perfect plan scores: sorting by points/duration is a ratio
 * heuristic, not an optimum, and a candidate that does not fit is skipped rather than deferred.
 *
 * War points are awarded per action and only when the action's COMPLETION lands on a tech war day
 * (`isWarPointDay(endDate, 'tech', dayConfig)`), which is why `planStartMs` matters: the same plan
 * started on a Tuesday and on a Friday scores differently.
 *
 * Returns `null` when any config is missing, so a caller can distinguish "not loaded yet" from
 * "genuinely nothing to gain" — a zero that means the former is the exact lie this whole engine is
 * built to avoid.
 */
export function optimizeTechTree(input: TechOptimizerInput): TechOptimizerResult | null {
    const {
        mapping, library, upgradeLibrary, dayConfig, forgeConfig,
        techTree, potions, timeLimitHours, gemBudget, warBonus, dayBoost, planStartMs,
    } = input;

    if (!mapping || !library || !upgradeLibrary || !dayConfig || !forgeConfig) return null;

    const tierPoints = tierPointsFrom(dayConfig, warBonus, dayBoost);

    // The virtual tree the simulation mutates. A copy, because the caller's profile must not move.
    const currentTree: Record<string, Record<number, number>> = {
        Forge: { ...techTree.Forge },
        Power: { ...techTree.Power },
        SkillsPetTech: { ...techTree.SkillsPetTech },
        Clan: { ...techTree.Clan },
    };

    let totalPoints = 0;
    let totalWarPoints = 0;
    const baseTimeLimitSeconds = timeLimitHours * 3600;

    /** Wall clock consumed since `planStartMs`: research plus any idle inserted to hit a war day. */
    let elapsedSeconds = 0;
    /** Research alone. Identical to `elapsedSeconds` unless aligning. */
    let researchSeconds = 0;
    let idleSeconds = 0;
    let accumulatedGemCost = 0;
    const gemLimit = gemBudget;
    let potionsRemaining = potions;

    const actions: TechUpgrade[] = [];
    const gemCostPerSecond = forgeConfig.TechTreeGemSkipCostPerSecond ?? 0;

    const align = input.alignCompletionsToWarDays === true;

    // Resolved once instead of per candidate. With `dayConfig` present — guaranteed by the early
    // return above — `techDays.includes(getWarDayIndex(d))` is exactly what
    // `isWarPointDay(d, 'tech', dayConfig)` computes, minus a full re-walk of the config per call.
    const techDays = computeWarDaysMap(dayConfig).tech || [];
    const onWarDay = (sec: number) => techDays.includes(getWarDayIndex(new Date(planStartMs + sec * 1000)));

    /**
     * The earliest completion at or after `earliestEnd` that lands on a tech war day and still fits
     * the horizon, or `null` when no such instant exists. Walks UTC midnights, because that is the
     * boundary `getWarDayIndex` switches on.
     */
    const firstWarDayCompletion = (earliestEnd: number): number | null => {
        if (earliestEnd > baseTimeLimitSeconds) return null;
        if (onWarDay(earliestEnd)) return earliestEnd;

        let t = earliestEnd;
        for (let i = 0; i < MAX_ALIGN_DAYS; i++) {
            const d = new Date(planStartMs + t * 1000);
            const nextMidnightMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
            t = (nextMidnightMs - planStartMs) / 1000;
            if (t > baseTimeLimitSeconds) return null;
            if (onWarDay(t)) return t;
        }
        return null;
    };

    /**
     * Where this upgrade would land, or `null` when it cannot be afforded in time or gems.
     *
     * With `align` off this reproduces the shipped arithmetic exactly: completion is
     * `elapsed + duration`, and anything past the horizon has its overflow bought with gems.
     * With `align` on an aligned slot is tried first; an aligned slot is inside the horizon by
     * construction, so idle and the gem-skip path never interact.
     */
    const place = (upg: TechUpgrade): { endSec: number; idleSec: number; gemCost: number; isWar: boolean } | null => {
        const startSec = elapsedSeconds;
        const earliestEnd = startSec + upg.duration;

        if (align) {
            const aligned = firstWarDayCompletion(earliestEnd);
            if (aligned !== null) {
                return { endSec: aligned, idleSec: aligned - earliestEnd, gemCost: 0, isWar: true };
            }
        }

        let gemCost = 0;
        if (earliestEnd > baseTimeLimitSeconds) {
            // Past the time budget the only way to finish is to buy the remaining seconds.
            if (gemLimit <= 0) return null;
            const overlap = Math.min(upg.duration, earliestEnd - Math.max(startSec, baseTimeLimitSeconds));
            if (overlap > 0 && gemCostPerSecond > 0) gemCost = Math.max(1, Math.round(Math.floor(overlap) * gemCostPerSecond)); // CalculateGemSkipCost RVA 0x7868754: whole seconds
        }
        if (gemCost > (gemLimit - accumulatedGemCost)) return null;

        return { endSec: earliestEnd, idleSec: 0, gemCost, isWar: onWarDay(earliestEnd) };
    };

    const maxIter = input.maxIterations ?? 500; // Safety break
    let iter = 0;

    while (iter < maxIter) {
        iter++;

        const bonuses = calculateTechBonuses(mapping, library, currentTree);

        const possibleUpgrades: TechUpgrade[] = [];

        Object.entries(mapping.trees || {}).forEach(([treeName, treeDef]: [string, any]) => {
            treeDef.nodes.forEach((node: any) => {
                const currentLvl = currentTree[treeName]?.[node.id] || 0;
                const nodeType = node.type;
                const nodeConfig = library[nodeType];
                const maxLvl = nodeConfig?.MaxLevel || 0;

                if (currentLvl < maxLvl) {
                    // A node is only upgradable once every prerequisite is at least level 1 — the
                    // same gate the in-game tree draws as a locked icon.
                    const reqsMet = (node.requirements || []).every((reqId: number) => {
                        return (currentTree[treeName]?.[reqId] || 0) >= 1;
                    });

                    if (reqsMet) {
                        const tier = node.tier || 0;
                        const step = techUpgradeCostAndDuration(upgradeLibrary, tier, currentLvl, bonuses);
                        if (step) {
                            possibleUpgrades.push({
                                tree: treeName,
                                nodeId: node.id,
                                nodeName: nodeType,
                                type: nodeType,
                                fromLevel: currentLvl,
                                toLevel: currentLvl + 1,
                                cost: step.cost,
                                duration: step.duration,
                                points: tierPoints[tier] || 0,
                                warPoints: 0, // Calculated on selection based on completion date
                                tier,
                                sprite_rect: node.sprite_rect,
                            });
                        }
                    }
                }
            });
        });

        if (possibleUpgrades.length === 0) break;

        // Efficiency = tree points per second of research.
        possibleUpgrades.sort((a, b) => (b.points / (b.duration || 1)) - (a.points / (a.duration || 1)));

        const best = possibleUpgrades.find(upg => upg.cost <= potionsRemaining && place(upg) !== null);

        if (best) {
            const slot = place(best)!;
            const endDate = new Date(planStartMs + slot.endSec * 1000);
            const warPts = slot.isWar ? best.points : 0;

            actions.push({ ...best, gemCost: slot.gemCost, warPoints: warPts, isWarDay: slot.isWar, endDate });

            totalPoints += best.points;
            totalWarPoints += warPts;
            potionsRemaining -= best.cost;
            researchSeconds += best.duration;
            idleSeconds += slot.idleSec;
            elapsedSeconds = slot.endSec;
            accumulatedGemCost += slot.gemCost;

            if (!currentTree[best.tree]) currentTree[best.tree] = {};
            currentTree[best.tree][best.nodeId] = best.toLevel;
        } else {
            break;
        }
    }

    const usedSeconds = elapsedSeconds;
    const gemTimeSeconds = Math.max(0, usedSeconds - baseTimeLimitSeconds);
    const baseTimeSeconds = Math.min(usedSeconds, baseTimeLimitSeconds);

    return {
        totalPoints,
        totalWarPoints,
        actions,
        timeUsed: usedSeconds / 3600,
        baseTimeUsed: baseTimeSeconds / 3600,
        gemTimeUsed: gemTimeSeconds / 3600,
        researchTimeUsed: researchSeconds / 3600,
        idleTimeUsed: idleSeconds / 3600,
        potionsUsed: potions - potionsRemaining,
        remainingPotions: potionsRemaining,
        finalBonuses: calculateTechBonuses(mapping, library, currentTree),
        totalGemsUsed: accumulatedGemCost,
    };
}
