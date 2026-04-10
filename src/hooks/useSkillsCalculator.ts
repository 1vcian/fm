import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';

export interface ProbabilityResult {
    rarity: string;
    count: number;
    percentage: number;
}

export function useSkillsCalculator() {
    // 1. Contexts
    const { profile, updateNestedProfile } = useProfile();
    const { treeMode, simulatedTree } = useTreeMode();

    // 2. Game Data — use unified SkillSummonConfig.json (has Levels with SummonsRequired + probabilities)
    const { data: skillSummonConfig } = useGameData<any>('SkillSummonConfig.json');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: skillBaseConfig } = useGameData<any>('SkillBaseConfig.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');

    // 3. State
    const [level, _setLevel] = useState<number>(1);
    const [progress, _setProgress] = useState<number>(0);
    const [ticketCount, _setTicketCount] = useState<number>(0);

    // 4. Persistence Load
    useEffect(() => {
        if (profile?.misc) {
            if (profile.misc.skillCalculatorLevel) {
                _setLevel(profile.misc.skillCalculatorLevel);
            }
            if (profile.misc.skillCalculatorTickets) {
                _setTicketCount(profile.misc.skillCalculatorTickets);
            }
        }
    }, [profile]);

    // 5. Setters (Persistence)
    const setLevel = (val: number) => {
        const safeVal = Math.min(Math.max(1, val), maxPossibleLevel);
        _setLevel(safeVal);
        updateNestedProfile('misc', { skillCalculatorLevel: safeVal });
    };

    const setProgress = (val: number) => {
        _setProgress(Math.max(0, val));
    };

    const setTicketCount = (val: number) => {
        const safeVal = Math.max(0, val);
        _setTicketCount(safeVal);
        updateNestedProfile('misc', { skillCalculatorTickets: safeVal });
    };

    // Helper: Get Effective Tech Level
    const getTechLevel = (treeName: 'Forge' | 'Power' | 'SkillsPetTech', nodeId: number, maxLevel: number = 0) => {
        if (treeMode === 'max') return maxLevel || 999;
        if (treeMode === 'empty') return 0;

        if (simulatedTree) {
            return simulatedTree[treeName]?.[nodeId] || 0;
        }
        return profile?.techTree?.[treeName]?.[nodeId] || 0;
    };

    // 6. Tech Tree Bonuses
    const techBonuses = useMemo(() => {
        if (!techTreeLibrary || !techTreeMapping) {
            return { costReduction: 0, extraChance: 0 };
        }

        let costReduction = 0;
        let extraChance = 0;

        const trees = ['Forge', 'Power', 'SkillsPetTech'];

        trees.forEach(treeName => {
            const treeDef = techTreeMapping.trees?.[treeName];
            if (!treeDef || !treeDef.nodes) return;

            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                const config = techTreeLibrary[nodeType];
                if (!config) return;

                const maxLevel = config.MaxLevel || 0;
                const level = getTechLevel(treeName as any, node.id, maxLevel);

                if (level > 0 && config.Stats && config.Stats.length > 0) {
                    if (nodeType === 'SkillSummonCost') {
                        const stat = config.Stats[0];
                        const val = stat.Value + ((level - 1) * stat.ValueIncrease);
                        costReduction += val;
                    }
                    if (nodeType === 'ExtraSkillChance' || nodeType === 'ExtraSummonChance') {
                        const stat = config.Stats[0];
                        const val = stat.Value + ((level - 1) * stat.ValueIncrease);
                        extraChance += val;
                    }
                }
            });
        });

        return {
            costReduction: Math.min(0.9, costReduction),
            extraChance: extraChance
        };
    }, [techTreeLibrary, techTreeMapping, treeMode, simulatedTree, profile]);

    // 7. Constants from unified config
    const unitCost = skillSummonConfig?.SingleSummonCost?.Amount || 40;
    const SKILLS_PER_SUMMON = skillBaseConfig?.SummonCount || 5;
    const BASE_SUMMON_COST = unitCost * SKILLS_PER_SUMMON;
    const levels: any[] = skillSummonConfig?.Levels || [];
    const currency = skillSummonConfig?.SingleSummonCost?.Currency || 'SkillSummonTickets';
    const finalCostPerSummon = Math.ceil(BASE_SUMMON_COST * (1 - techBonuses.costReduction));
    const maxPossibleLevel = levels.length || 100;

    // 8. War Points
    const warPointsPerSummonSkill = useMemo(() => {
        if (!guildWarConfig) return null;
        const day0 = guildWarConfig["0"]; // Day 0 is Skill day
        if (!day0) return null;

        const points: Record<string, number> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        rarities.forEach(rarity => {
            const task = day0.Tasks.find((t: any) => t.Task === `Summon${rarity}Skill`);
            points[rarity] = task?.Rewards?.[0]?.Amount || 0;
        });

        return points;
    }, [guildWarConfig]);

    // 9. Simulation Results (with level progression like mount/egg calculators)
    const results = useMemo(() => {
        if (!levels.length || !warPointsPerSummonSkill) return null;

        const totalPaidSummons = Math.floor(ticketCount / Math.max(1, finalCostPerSummon));

        // Simulation state
        let currentLevel = level;
        let currentProgress = progress;
        const simulateAscension = profile?.misc?.simulateAscensionInCalculators ?? true;
        let ascensionLevel = profile?.misc?.skillAscensionLevel || 0;
        let summonsToMax: number | null = null;

        const breakdown: { rarity: string; count: number; percentage: number; pointsPerUnit: number; totalPoints: number; }[] = [];
        const countsByRarity: Record<string, number> = {};
        let grandTotalPoints = 0;

        // Initialize counts
        ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(r => { countsByRarity[r] = 0; });

        // Perform simulation summons one by one to track level progression
        for (let i = 0; i < totalPaidSummons; i++) {
            const levelIdx = Math.min(currentLevel - 1, levels.length - 1);
            const probabilities = levels[levelIdx];

            if (probabilities) {
                ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(rarity => {
                    const chance = probabilities[rarity] || 0;
                    const expectedCount = chance * SKILLS_PER_SUMMON * (1 + techBonuses.extraChance);
                    countsByRarity[rarity] += expectedCount;
                });
            }

            // Progress level
            currentProgress += SKILLS_PER_SUMMON * (1 + techBonuses.extraChance);
            let threshold = levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired;
            
            while (threshold && currentProgress >= threshold) {
                currentProgress -= threshold;
                currentLevel++;
                
                // Ascension check: if we go past maxLevel, handle based on toggle
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

        // Build breakdown
        ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].forEach(rarity => {
            const count = countsByRarity[rarity];
            const unitPoints = warPointsPerSummonSkill[rarity] || 0;
            const points = count * unitPoints;
            const endLevelIdx = Math.min(currentLevel - 1, levels.length - 1);
            const endProbs = levels[endLevelIdx] || {};

            breakdown.push({
                rarity,
                count,
                percentage: ((endProbs[rarity] || 0) * 100),
                pointsPerUnit: unitPoints,
                totalPoints: points
            });

            grandTotalPoints += points;
        });

        const totalSkills = Object.values(countsByRarity).reduce((a, b) => a + b, 0);

        return {
            breakdown: breakdown.filter(b => b.count > 0 || b.percentage > 0),
            totalSkills,
            totalPoints: grandTotalPoints,
            numSummons: totalPaidSummons,
            finalCost: finalCostPerSummon,
            baseCost: BASE_SUMMON_COST,
            costReduction: techBonuses.costReduction,
            endLevel: currentLevel,
            endProgress: Math.round(currentProgress),
            endAscensionLevel: ascensionLevel,
            summonsToMax,
            simulateAscension
        };

    }, [ticketCount, level, progress, levels, warPointsPerSummonSkill, SKILLS_PER_SUMMON, techBonuses, finalCostPerSummon, BASE_SUMMON_COST, profile?.misc?.simulateAscensionInCalculators]);

    // Apply results
    const applyResultsToProfile = () => {
        if (!results) return;
        setLevel(results.endLevel);
        _setProgress(results.endProgress);
    };

    return {
        level, setLevel,
        progress, setProgress,
        ticketCount, setTicketCount,
        results,
        techBonuses,
        maxPossibleLevel,
        levels,
        applyResultsToProfile,
        currency,
        baseCost: BASE_SUMMON_COST,
        finalCostPerSummon,
        skillsPerSummon: SKILLS_PER_SUMMON
    };
}
