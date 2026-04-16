import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';

export function useMountsCalculator() {
    const { profile, updateProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // 1. Data Loading — use unified MountSummonConfig.json (has Levels with SummonsRequired + probabilities)
    const { data: mountSummonConfig } = useGameData<any>('MountSummonConfig.json');
    const { data: guildWarDayConfigLibrary } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');

    // 2. State (Initialized from Profile)
    const [level, setLevel] = useState(profile.misc.mountCalculatorLevel || 1);
    const [progress, setProgress] = useState(profile.misc.mountCalculatorProgress || 0);
    const [windersCount, setWindersCount] = useState(profile.misc.mountCalculatorWinders || 0);

    // Sync state to profile
    useEffect(() => {
        updateProfile({
            misc: {
                ...profile.misc,
                mountCalculatorLevel: level,
                mountCalculatorProgress: progress,
                mountCalculatorWinders: windersCount
            }
        });
    }, [level, progress, windersCount]);

    // 3. Tech Bonuses
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

                    if (nodeType === 'MountSummonCost') {
                        costReduction += val;
                    } else if (nodeType === 'ExtraMountChance') {
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

    // 4. Constants from config — read from unified Levels array
    const BASE_COST = mountSummonConfig?.SingleSummonCost?.Amount || 50;
    const MOUNTS_PER_SUMMON = 1 + techBonuses.extraChance;
    const finalCostPerSummon = Math.ceil(BASE_COST * (1 - techBonuses.costReduction));
    const levels: any[] = mountSummonConfig?.Levels || [];
    const maxPossibleLevel = levels.length || 100;
    const currency = mountSummonConfig?.SingleSummonCost?.Currency || 'ClockWinders';

    // 5. Simulation Results
    const results = useMemo(() => {
        if (!levels.length || !guildWarDayConfigLibrary) {
            return null;
        }

        const pointsBreakdown: Record<string, { summon: number; merge: number }> = {};
        const day2 = guildWarDayConfigLibrary["2"]; // Day 2 is usually Mount day
        if (day2) {
            ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(rarity => {
                const summonTask = day2.Tasks.find((t: any) => t.Task === `Summon${rarity}Mount`);
                const mergeTask = day2.Tasks.find((t: any) => t.Task === `Merge${rarity}Mount`);
                pointsBreakdown[rarity] = {
                    summon: summonTask?.Rewards?.[0]?.Amount || 0,
                    merge: mergeTask?.Rewards?.[0]?.Amount || 0
                };
            });
        }

        const totalPaidSummons = Math.floor(windersCount / Math.max(1, finalCostPerSummon));

        // Simulation state
        let currentLevel = level;
        let currentProgress = progress;
        const simulateAscension = profile?.misc?.simulateAscensionInCalculators ?? true;
        let ascensionLevel = profile?.misc?.mountAscensionLevel || 0;
        let summonsToMax: number | null = null;

        const breakdown: Record<string, { count: number; summonPoints: number; mergePoints: number }> = {
            Common: { count: 0, summonPoints: 0, mergePoints: 0 },
            Rare: { count: 0, summonPoints: 0, mergePoints: 0 },
            Epic: { count: 0, summonPoints: 0, mergePoints: 0 },
            Legendary: { count: 0, summonPoints: 0, mergePoints: 0 },
            Ultimate: { count: 0, summonPoints: 0, mergePoints: 0 },
            Mythic: { count: 0, summonPoints: 0, mergePoints: 0 }
        };

        interface PhaseData {
            label: string;
            startLevel: number;
            startAscension: number;
            endLevel: number;
            endAscension: number;
            summonPoints: number;
            mergePoints: number;
            totalPoints: number;
            counts: Record<string, number>;
        }
        
        const phases: PhaseData[] = [];
        
        const createPhase = (lvl: number, asc: number): PhaseData => ({
            label: asc === 0 ? "Normal" : `Ascension ${asc}`,
            startLevel: lvl,
            startAscension: asc,
            endLevel: lvl,
            endAscension: asc,
            summonPoints: 0,
            mergePoints: 0,
            totalPoints: 0,
            counts: {
                Common: 0, Rare: 0, Epic: 0, Legendary: 0, Ultimate: 0, Mythic: 0
            }
        });

        let currentPhase = createPhase(currentLevel, ascensionLevel);
        let totalSummonPoints = 0;
        let totalMergePoints = 0;

        // Perform simulation summons one by one to track level progression
        for (let i = 0; i < totalPaidSummons; i++) {
            // Immediate Ascension Check: If we are at max level, we can ascend for free (no summons required)
            if (simulateAscension && ascensionLevel < 3 && currentLevel >= maxPossibleLevel) {
                if (summonsToMax === null) summonsToMax = i;

                currentPhase.endLevel = maxPossibleLevel;
                currentPhase.endAscension = ascensionLevel;
                phases.push(currentPhase);

                currentLevel = 1;
                ascensionLevel++;
                currentPhase = createPhase(currentLevel, ascensionLevel);
            }

            // Level index is 0-based, our level is 1-based
            const levelIdx = Math.min(currentLevel - 1, levels.length - 1);
            const probabilities = levels[levelIdx];

            if (probabilities) {
                ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(rarity => {
                    const chance = probabilities[rarity] || 0;
                    const expectedCount = chance * MOUNTS_PER_SUMMON;
                    const sPts = expectedCount * (pointsBreakdown[rarity]?.summon || 0);
                    const mPts = expectedCount * (pointsBreakdown[rarity]?.merge || 0);

                    breakdown[rarity].count += expectedCount;
                    breakdown[rarity].summonPoints += sPts;
                    breakdown[rarity].mergePoints += mPts;
                    
                    currentPhase.counts[rarity] += expectedCount;
                    currentPhase.summonPoints += sPts;
                    currentPhase.mergePoints += mPts;
                    currentPhase.totalPoints += (sPts + mPts);

                    totalSummonPoints += sPts;
                    totalMergePoints += mPts;
                });
            }

            // Progress level
            currentProgress += MOUNTS_PER_SUMMON;
            let threshold = levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired;
            
            while (threshold && currentProgress >= threshold) {
                currentProgress -= threshold;
                currentLevel++;
                
                // If we just reached max level, check if we should immediately ascend
                if (simulateAscension && ascensionLevel < 3 && currentLevel >= maxPossibleLevel) {
                    if (summonsToMax === null) summonsToMax = i + 1;
                    
                    currentPhase.endLevel = maxPossibleLevel;
                    currentPhase.endAscension = ascensionLevel;
                    phases.push(currentPhase);

                    currentLevel = 1;
                    ascensionLevel++;
                    currentPhase = createPhase(currentLevel, ascensionLevel);
                    // Update threshold for the new Level 1
                    threshold = levels[0]?.SummonsRequired;
                } else if (currentLevel > maxPossibleLevel) {
                    currentLevel = maxPossibleLevel;
                    break;
                } else {
                    threshold = levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired;
                }
            }
        }

        // Finalize last phase
        currentPhase.endLevel = currentLevel;
        currentPhase.endAscension = ascensionLevel;
        phases.push(currentPhase);

        return {
            simulateAscension,
            totalPoints: totalSummonPoints + totalMergePoints,
            totalSummonPoints,
            totalMergePoints,
            phases,
            breakdown: Object.entries(breakdown)
                .map(([rarity, data]) => ({
                    rarity,
                    ...data,
                    percentage: (getCurrentProbs(currentLevel)[rarity] || 0) * 100,
                    pointsPerUnit: pointsBreakdown[rarity],
                    phaseCounts: phases.map(p => ({
                        ascension: p.startAscension,
                        count: p.counts[rarity] || 0
                    }))
                }))
                .filter(b => b.count > 0 || b.percentage > 0),
            finalCost: finalCostPerSummon,
            baseCost: BASE_COST,
            costReduction: techBonuses.costReduction,
            totalSummons: totalPaidSummons,
            endLevel: currentLevel,
            endProgress: Math.round(currentProgress),
            endAscensionLevel: ascensionLevel,
            summonsToMax
        };

        function getCurrentProbs(lvl: number) {
            const idx = Math.min(lvl - 1, levels.length - 1);
            return levels[idx] || {};
        }

    }, [windersCount, level, progress, levels, guildWarDayConfigLibrary, techBonuses, finalCostPerSummon, BASE_COST, MOUNTS_PER_SUMMON, profile?.misc?.simulateAscensionInCalculators]);



    // Action to apply results to profile
    const applyResultsToProfile = () => {
        if (!results) return;
        setLevel(results.endLevel);
        setProgress(results.endProgress);
    };

    return {
        level, setLevel,
        progress, setProgress,
        windersCount, setWindersCount,
        techBonuses,
        results,
        maxPossibleLevel,
        levels,
        applyResultsToProfile,
        currency,
        baseCost: BASE_COST,
        finalCostPerSummon,
        mountsPerSummon: MOUNTS_PER_SUMMON
    };
}
