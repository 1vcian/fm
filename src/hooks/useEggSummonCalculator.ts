import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';

export function useEggSummonCalculator() {
    const { profile, updateProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // Data Loading
    const { data: eggSummonConfig } = useGameData<any>('EggSummonConfig.json');
    const { data: guildWarDayConfigLibrary } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');

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
    const techBonuses = useMemo(() => {
        if (!techTreeLibrary || !techTreeMapping) {
            return { costReduction: 0, extraChance: 0 };
        }

        let costReduction = 0;
        let extraChance = 0;

        Object.entries(profile.techTree).forEach(([treeName, treeNodes]) => {
            const treeDef = techTreeMapping.trees?.[treeName];
            if (!treeDef || !treeDef.nodes) return;

            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                const config = techTreeLibrary[nodeType];
                if (!config) return;

                const maxLevel = config.MaxLevel || 0;
                let nodeLevel = 0;

                if (treeMode === 'max') nodeLevel = maxLevel;
                else if (treeMode === 'empty') nodeLevel = 0;
                else nodeLevel = (treeNodes as any)[node.id] || 0;

                if (nodeLevel > 0 && config.Stats?.[0]) {
                    const stat = config.Stats[0];
                    const val = stat.Value + ((nodeLevel - 1) * stat.ValueIncrease);

                    if (nodeType === 'EggsSummonCost') {
                        costReduction += val;
                    } else if (nodeType === 'ExtraEggChance') {
                        extraChance += val;
                    }
                }
            });
        });

        return {
            costReduction: Math.min(0.9, costReduction),
            extraChance: extraChance
        };
    }, [techTreeLibrary, techTreeMapping, treeMode, profile]);

    // Constants from config
    const BASE_COST = eggSummonConfig?.SingleSummonCost?.Amount || 100;
    const EGGS_PER_SUMMON = 1 + techBonuses.extraChance;
    const finalCostPerSummon = Math.ceil(BASE_COST * (1 - techBonuses.costReduction));

    // Levels data
    const levels = eggSummonConfig?.Levels || [];
    const maxPossibleLevel = levels.length || 100;

    // Simulation Results
    const results = useMemo(() => {
        if (!eggSummonConfig || !levels.length || !guildWarDayConfigLibrary) {
            return null;
        }

        const totalPaidSummons = Math.floor(eggshellCount / Math.max(1, finalCostPerSummon));

        // Simulation state
        let currentLevel = level;
        let currentProgress = progress;
        const simulateAscension = profile?.misc?.simulateAscensionInCalculators ?? true;
        let ascensionLevel = profile?.misc?.petAscensionLevel || 0;
        let summonsToMax: number | null = null;

        const breakdown: Record<string, { count: number }> = {
            Common: { count: 0 },
            Rare: { count: 0 },
            Epic: { count: 0 },
            Legendary: { count: 0 },
            Ultimate: { count: 0 },
            Mythic: { count: 0 }
        };

        for (let i = 0; i < totalPaidSummons; i++) {
            // Level index is 0-based, our level is 1-based
            const levelIdx = Math.min(currentLevel - 1, levels.length - 1);
            const probabilities = levels[levelIdx];

            if (probabilities) {
                ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(rarity => {
                    const chance = probabilities[rarity] || 0;
                    const expectedCount = chance * EGGS_PER_SUMMON;

                    breakdown[rarity].count += expectedCount;
                });
            }

            // Progress level - each summon produces EGGS_PER_SUMMON eggs
            currentProgress += EGGS_PER_SUMMON;
            let threshold = levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired;
            while (threshold && currentProgress >= threshold) {
                currentProgress -= threshold;
                currentLevel++;
                
                // Ascension check
                if (currentLevel > maxPossibleLevel) {
                    if (summonsToMax === null) {
                        summonsToMax = i + 1;
                    }
                    
                    if (simulateAscension) {
                        currentLevel = 1;
                        ascensionLevel++;
                    } else {
                        currentLevel = maxPossibleLevel;
                        // Break the while loop since we won't progress further
                        break;
                    }
                }

                threshold = levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired;
            }
        }

        return {
            totalSummons: totalPaidSummons,
            endLevel: currentLevel,
            endProgress: Math.round(currentProgress),
            endAscensionLevel: ascensionLevel,
            summonsToMax,
            simulateAscension,
            breakdown: Object.entries(breakdown)
                .map(([rarity, data]) => ({
                    rarity,
                    ...data,
                    percentage: (getCurrentProbs(currentLevel)[rarity] || 0) * 100
                }))
                .filter(b => b.count > 0 || b.percentage > 0),
            finalCost: finalCostPerSummon,
            baseCost: BASE_COST,
            costReduction: techBonuses.costReduction
        };

        function getCurrentProbs(lvl: number) {
            const idx = Math.min(lvl - 1, levels.length - 1);
            return levels[idx] || {};
        }

    }, [eggshellCount, level, progress, eggSummonConfig, levels, guildWarDayConfigLibrary, techBonuses, finalCostPerSummon, BASE_COST, EGGS_PER_SUMMON, profile?.misc?.simulateAscensionInCalculators]);



    // Apply results to profile
    const applyResultsToProfile = () => {
        if (!results) return;
        setLevel(results.endLevel);
        setProgress(results.endProgress);
    };

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
        currency: eggSummonConfig?.SingleSummonCost?.Currency || 'Eggshells',
        baseCost: BASE_COST,
        finalCostPerSummon,
        eggsPerSummon: EGGS_PER_SUMMON
    };
}
