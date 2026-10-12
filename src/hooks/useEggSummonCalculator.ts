import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeModifiers } from './useCalculatedStats';
import { simulateSummons, summonCost, affordableSummons, currencyToReach, summonRowAt, maxAscensionFrom, baseSummonCount } from '../utils/summonEngine';

/** Egg summon simulation for a currency pile, shaped for the Summons calculator's Eggs tab. */
export function buildEggSummonResults(p: {
    levels: any[];
    level: number;
    progress: number;
    currency: number;
    costPerSummon: number;
    unitsPerSummon: number;
    startAscension: number;
    simulateAscension: boolean;
    maxAscension: number;
}) {
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
    const endProbs = summonRowAt(p.levels, sim.endLevel);
    return {
        totalSummons,
        endLevel: sim.endLevel,
        endProgress: Math.round(sim.endProgress),
        endAscensionLevel: sim.endAscension,
        summonsToMax: sim.summonsToMax,
        simulateAscension: p.simulateAscension,
        phases: sim.phases,
        breakdown: Object.entries(sim.byRarity)
            .map(([rarity, count]) => ({
                rarity,
                count,
                percentage: (endProbs[rarity] || 0) * 100,
                phaseCounts: sim.phases.map(ph => ({
                    ascension: ph.startAscension,
                    count: ph.counts[rarity] || 0
                }))
            }))
            .filter(b => b.count > 0 || b.percentage > 0),
    };
}

export function useEggSummonCalculator() {
    const { profile, updateProfile } = useProfile();

    // Data Loading
    const { data: eggSummonConfig } = useGameData<any>('EggSummonConfig.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const maxAscension = maxAscensionFrom(ascensionConfigs, 'Pets');

    // State (synced to profile)
    const [level, setLevel] = useState(profile.misc.eggSummonLevel || 1);
    const [progress, setProgress] = useState(profile.misc.eggSummonProgress || 0);
    const [eggshellCount, setEggshellCount] = useState(profile.misc.eggshellCount || 0);

    // Sync state to profile
    useEffect(() => {
        updateProfile({
            misc: {
                ...profile.misc,
                eggSummonLevel: level,
                eggSummonProgress: progress,
                eggshellCount: eggshellCount
            }
        });
    }, [level, progress, eggshellCount]);

    // Tech Bonuses
    const treeModifiers = useTreeModifiers();
    // Personal + clan tree sums from useTreeModifiers (tree mode aware, unlock requirements checked).
    // Cost is a OneMinusMultiplier node and the extra chance a FreebieChance roll (TechNodesLibrary).
    const techBonuses = useMemo(() => ({
        costReduction: 0, // no tech node lowers the egg summon cost (TechNodesLibrary)
        extraChance: treeModifiers['ExtraEggChance'] || 0,
    }), [treeModifiers]);

    // Constants from config
    const BASE_COST = eggSummonConfig?.SingleSummonCost?.Amount || 100;
    // SummonConfig.BaseSummonCount (RVA 0x7865E88) = PossibleSummonCount[0].
    const BASE_EGGS_PER_SUMMON = baseSummonCount(eggSummonConfig, 1);
    const EGGS_PER_SUMMON = BASE_EGGS_PER_SUMMON * (1 + techBonuses.extraChance);
    // SummonConfig.CanAffordSummon (RVA 0x7865EDC): RoundToInt(CalculateValue(Cost, Amount * count)),
    // so the reduction applies to the whole batch and rounds to nearest, not up.
    const finalCostPerSummon = summonCost(BASE_COST, BASE_EGGS_PER_SUMMON, techBonuses.costReduction);

    // Levels data
    const levels = eggSummonConfig?.Levels || [];
    const maxPossibleLevel = levels.length || 100;

    // Simulation Results
    const results = useMemo(() => {
        if (!eggSummonConfig || !levels.length) {
            return null;
        }
        return {
            ...buildEggSummonResults({
                levels,
                level,
                progress,
                currency: eggshellCount,
                costPerSummon: finalCostPerSummon,
                unitsPerSummon: EGGS_PER_SUMMON,
                startAscension: profile?.misc?.petAscensionLevel || 0,
                simulateAscension: profile?.misc?.simulateAscensionInCalculators ?? true,
                maxAscension,
            }),
            finalCost: finalCostPerSummon,
            baseCost: BASE_COST * BASE_EGGS_PER_SUMMON,
            costReduction: techBonuses.costReduction
        };
    }, [eggshellCount, level, progress, eggSummonConfig, levels, techBonuses, finalCostPerSummon, BASE_COST, BASE_EGGS_PER_SUMMON, EGGS_PER_SUMMON, profile?.misc?.simulateAscensionInCalculators, maxAscension, profile?.misc?.petAscensionLevel]);

    // Apply results to profile
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
        ascension: profile?.misc?.petAscensionLevel || 0,
        targetLevel,
        targetAscension,
        unitsPerSummon: EGGS_PER_SUMMON,
        costPerSummon: finalCostPerSummon,
        maxAscension,
    });

    return {
        available: !!eggSummonConfig, // Whether the new system is available for this version
        level, setLevel,
        progress, setProgress,
        eggshellCount, setEggshellCount,
        techBonuses,
        results,
        maxPossibleLevel,
        levels,
        applyResultsToProfile,
        calculateNeededCurrency,
        maxAscension,
        currency: eggSummonConfig?.SingleSummonCost?.Currency || 'Eggshells',
        baseCost: BASE_COST * BASE_EGGS_PER_SUMMON,
        finalCostPerSummon,
        eggsPerSummon: EGGS_PER_SUMMON
    };
}
