import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeModifiers } from './useCalculatedStats';
import { useTreeLimits } from './useTreeLimits';
import { getWarPointsForTask, isWarPointDay, getDayBoostNodeType } from '../utils/guildWarUtils';
import { simulateSummons, summonCost, affordableSummons, currencyToReach, summonRowAt, maxAscensionFrom, baseSummonCount, SUMMON_RARITIES } from '../utils/summonEngine';

/** Mount summon simulation plus war points, shaped for the Summons calculator's Mounts tab. */
export function buildMountSummonResults(p: {
    levels: any[];
    level: number;
    progress: number;
    currency: number;
    costPerSummon: number;
    unitsPerSummon: number;
    startAscension: number;
    simulateAscension: boolean;
    maxAscension: number;
    dayConfig: any;
    summonWarBonus: number;
    mergeWarBonus: number;
    dayBoost: number;
    readyMerges: number;
}) {
    // Read amounts from whatever day holds the task (independent of day layout),
    // then apply the clan tech tree war-point boosts.
    const pointsBreakdown: Record<string, { summon: number; merge: number }> = {};
    SUMMON_RARITIES.forEach(rarity => {
        const baseSummon = getWarPointsForTask(p.dayConfig, `Summon${rarity}Mount`);
        const baseMerge = getWarPointsForTask(p.dayConfig, `Merge${rarity}Mount`);
        pointsBreakdown[rarity] = {
            summon: baseSummon * (1 + p.summonWarBonus + p.dayBoost),
            merge: baseMerge * (1 + p.mergeWarBonus + p.dayBoost)
        };
    });

    const totalSummons = affordableSummons(p.currency, p.costPerSummon);
    const sim = simulateSummons({
        levels: p.levels,
        startLevel: p.level,
        startProgress: p.progress,
        startAscension: p.startAscension,
        simulateAscension: p.simulateAscension,
        maxAscension: p.maxAscension,
        summons: totalSummons,
        unitsPerSummon: p.unitsPerSummon,
    });

    const pointsOf = (counts: Record<string, number>) => {
        let summonPoints = 0;
        let mergePoints = 0;
        for (const rarity of SUMMON_RARITIES) {
            summonPoints += (counts[rarity] || 0) * (pointsBreakdown[rarity]?.summon || 0);
            mergePoints += (counts[rarity] || 0) * (pointsBreakdown[rarity]?.merge || 0);
        }
        return { summonPoints, mergePoints };
    };

    const phases = sim.phases.map(ph => {
        const { summonPoints, mergePoints } = pointsOf(ph.counts);
        return { ...ph, summonPoints, mergePoints, totalPoints: summonPoints + mergePoints };
    });
    const { summonPoints: totalSummonPoints, mergePoints: totalMergePoints } = pointsOf(sim.byRarity);

    // Declared ready merges from mounts already obtained (synced with Resources).
    let readyMergeFlat = 0;
    Object.values(pointsBreakdown).forEach((pts) => {
        if (pts.merge > 0) readyMergeFlat = readyMergeFlat === 0 ? pts.merge : Math.min(readyMergeFlat, pts.merge);
    });
    const readyMergePoints = p.readyMerges * readyMergeFlat;

    const endProbs = summonRowAt(p.levels, sim.endLevel);
    return {
        simulateAscension: p.simulateAscension,
        totalPoints: totalSummonPoints + totalMergePoints + readyMergePoints,
        totalSummonPoints,
        totalMergePoints,
        readyMergePoints,
        phases,
        breakdown: Object.entries(sim.byRarity)
            .map(([rarity, count]) => ({
                rarity,
                count,
                summonPoints: count * (pointsBreakdown[rarity]?.summon || 0),
                mergePoints: count * (pointsBreakdown[rarity]?.merge || 0),
                percentage: (endProbs[rarity] || 0) * 100,
                pointsPerUnit: pointsBreakdown[rarity],
                phaseCounts: phases.map(ph => ({
                    ascension: ph.startAscension,
                    count: ph.counts[rarity] || 0
                }))
            }))
            .filter(b => b.count > 0 || b.percentage > 0),
        totalSummons,
        endLevel: sim.endLevel,
        endProgress: Math.round(sim.endProgress),
        endAscensionLevel: sim.endAscension,
        summonsToMax: sim.summonsToMax
    };
}

export function useMountsCalculator() {
    const { profile, updateProfile } = useProfile();

    // 1. Data Loading — use unified MountSummonConfig.json (has Levels with SummonsRequired + probabilities)
    const { data: mountSummonConfig } = useGameData<any>('MountSummonConfig.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const maxAscension = maxAscensionFrom(ascensionConfigs, 'Mounts');
    const { data: guildWarDayConfigLibrary } = useGameData<any>('GuildWarDayConfigLibrary.json');

    // 2. State (Initialized from Profile)
    const [level, setLevel] = useState(profile.misc.mountCalculatorLevel || 1);
    const [progress, setProgress] = useState(profile.misc.mountCalculatorProgress || 0);
    const [windersCount, setWindersCount] = useState(profile.misc.mountCalculatorWinders || 0);
    // Mount merges still performable from mounts already obtained (war input, Resources).
    const [readyMerges, setReadyMerges] = useState(profile.misc.mountMergesReady || 0);

    // Sync state to profile
    useEffect(() => {
        updateProfile({
            misc: {
                ...profile.misc,
                mountCalculatorLevel: level,
                mountCalculatorProgress: progress,
                mountCalculatorWinders: windersCount,
                mountMergesReady: readyMerges
            }
        });
    }, [level, progress, windersCount, readyMerges]);

    // 3. Tech Bonuses
    const treeModifiers = useTreeModifiers();
    // Personal + clan tree sums from useTreeModifiers (tree mode aware, unlock requirements checked).
    // Cost is a OneMinusMultiplier node and the extra chance a FreebieChance roll (TechNodesLibrary).
    const techBonuses = useMemo(() => ({
        costReduction: treeModifiers['MountSummonCost'] || 0,
        extraChance: treeModifiers['ExtraMountChance'] || 0,
    }), [treeModifiers]);

    // Clan tech tree boosts to war points earned (already effective values, see useGameData).
    const treeLimits = useTreeLimits();
    const profileSummonWarBonus = treeModifiers['WarPointsFromMountSummon'] || 0;
    const profileMergeWarBonus = treeModifiers['WarPointsFromMountMerge'] || 0;

    // Sandbox: local overrides of the result-altering tree bonuses (see SandboxPanel).
    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const costReduction = sandbox.costReduction ?? techBonuses.costReduction;
    const extraChance = sandbox.extraChance ?? techBonuses.extraChance;
    const mountSummonWarBonus = sandbox.warSummon ?? profileSummonWarBonus;
    const mountMergeWarBonus = sandbox.warMerge ?? profileMergeWarBonus;
    // Day boost: WarPointsOnDayN multiplier, only when mounts are active today.
    const dayActive = isWarPointDay(new Date(), 'mounts', guildWarDayConfigLibrary);
    const profileDayBoost = dayActive ? (treeModifiers[getDayBoostNodeType()] || 0) : 0;
    const dayBoost = sandbox.dayBoost ?? profileDayBoost;
    const sandboxControls = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'costReduction', label: 'Summon cost reduction', value: costReduction, profileValue: techBonuses.costReduction, min: 0, ...treeLimits.personal('MountSummonCost'), onChange: (v: number) => setSandbox(p => ({ ...p, costReduction: v })) },
            { key: 'extraChance', label: 'Extra mount chance', value: extraChance, profileValue: techBonuses.extraChance, min: 0, ...treeLimits.personal('ExtraMountChance'), onChange: (v: number) => setSandbox(p => ({ ...p, extraChance: v })) },
            { key: 'warSummon', label: 'War points: mount summon', value: mountSummonWarBonus, profileValue: profileSummonWarBonus, min: 0, ...treeLimits.clan('WarPointsFromMountSummon'), onChange: (v: number) => setSandbox(p => ({ ...p, warSummon: v })) },
            { key: 'warMerge', label: 'War points: mount merge', value: mountMergeWarBonus, profileValue: profileMergeWarBonus, min: 0, ...treeLimits.clan('WarPointsFromMountMerge'), onChange: (v: number) => setSandbox(p => ({ ...p, warMerge: v })) },
            { key: 'dayBoost', label: 'Day war-points boost (today)', value: dayBoost, profileValue: profileDayBoost, min: 0, ...treeLimits.clan('WarPointsOnDay1'), onChange: (v: number) => setSandbox(p => ({ ...p, dayBoost: v })) },
        ],
    };

    // 4. Constants from config — read from unified Levels array
    const BASE_COST = mountSummonConfig?.SingleSummonCost?.Amount || 50;
    // SummonConfig.BaseSummonCount (RVA 0x7865E88) = PossibleSummonCount[0].
    const BASE_MOUNTS_PER_SUMMON = baseSummonCount(mountSummonConfig, 1);
    const MOUNTS_PER_SUMMON = BASE_MOUNTS_PER_SUMMON * (1 + extraChance);
    // SummonConfig.CanAffordSummon (RVA 0x7865EDC): RoundToInt(CalculateValue(Cost, Amount * count)),
    // so the reduction applies to the whole batch and rounds to nearest, not up.
    const finalCostPerSummon = summonCost(BASE_COST, BASE_MOUNTS_PER_SUMMON, costReduction);
    const levels: any[] = mountSummonConfig?.Levels || [];
    const maxPossibleLevel = levels.length || 100;
    const currency = mountSummonConfig?.SingleSummonCost?.Currency || 'ClockWinders';

    // 5. Simulation Results
    const results = useMemo(() => {
        if (!levels.length || !guildWarDayConfigLibrary) {
            return null;
        }
        return {
            ...buildMountSummonResults({
                levels,
                level,
                progress,
                currency: windersCount,
                costPerSummon: finalCostPerSummon,
                unitsPerSummon: MOUNTS_PER_SUMMON,
                startAscension: profile?.misc?.mountAscensionLevel || 0,
                simulateAscension: profile?.misc?.simulateAscensionInCalculators ?? true,
                maxAscension,
                dayConfig: guildWarDayConfigLibrary,
                summonWarBonus: mountSummonWarBonus,
                mergeWarBonus: mountMergeWarBonus,
                dayBoost,
                readyMerges,
            }),
            finalCost: finalCostPerSummon,
            baseCost: BASE_COST * BASE_MOUNTS_PER_SUMMON,
            costReduction: techBonuses.costReduction,
        };
    }, [windersCount, level, progress, levels, guildWarDayConfigLibrary, techBonuses, finalCostPerSummon, BASE_COST, BASE_MOUNTS_PER_SUMMON, MOUNTS_PER_SUMMON, mountSummonWarBonus, mountMergeWarBonus, dayBoost, readyMerges, profile?.misc?.simulateAscensionInCalculators, maxAscension, profile?.misc?.mountAscensionLevel]);

    // Action to apply results to profile
    const applyResultsToProfile = () => {
        if (!results) return;
        setLevel(results.endLevel);
        setProgress(results.endProgress);
    };

    // Target Calculation
    const calculateNeededCurrency = (targetLevel: number, targetAscension: number) => currencyToReach({
        levels,
        level,
        progress,
        ascension: profile?.misc?.mountAscensionLevel || 0,
        targetLevel,
        targetAscension,
        unitsPerSummon: MOUNTS_PER_SUMMON,
        costPerSummon: finalCostPerSummon,
        maxAscension,
    });

    return {
        level, setLevel,
        progress, setProgress,
        windersCount, setWindersCount,
        readyMerges, setReadyMerges,
        techBonuses,
        results,
        maxPossibleLevel,
        levels,
        applyResultsToProfile,
        calculateNeededCurrency,
        maxAscension,
        currency,
        baseCost: BASE_COST * BASE_MOUNTS_PER_SUMMON,
        finalCostPerSummon,
        mountsPerSummon: MOUNTS_PER_SUMMON,
        warPointBonuses: { summon: mountSummonWarBonus, merge: mountMergeWarBonus },
        sandbox: sandboxControls
    };
}
