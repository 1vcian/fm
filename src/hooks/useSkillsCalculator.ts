import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext'; // Fix 1: Tree Context

export interface ProbabilityResult {
    rarity: string;
    count: number;
    percentage: number;
}

export function useSkillsCalculator() {
    // 1. Contexts
    const { profile, updateNestedProfile } = useProfile();
    // Fix: Destructure treeMode correctly
    const { treeMode, simulatedTree } = useTreeMode();

    // 2. Game Data
    const { data: dropChancesLibrary } = useGameData<any>('SkillSummonDropChancesLibrary.json');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: skillBaseConfig } = useGameData<any>('SkillBaseConfig.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');

    // 3. State
    const [level, _setLevel] = useState<number>(1);
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
        const safeVal = Math.min(Math.max(1, val), 100);
        _setLevel(safeVal);
        updateNestedProfile('misc', { skillCalculatorLevel: safeVal });
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

        // For 'my' mode, use profile or simulated tree if available
        // Note: simulatedTree in context might be the active editing tree
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

        // Iterate over relevant trees to find SkillSummonCost and ExtraSkillChance
        // SkillSummonCost is in SkillsPetTech (id 7?) but might be elsewhere. 
        // Safer to iterate relevant trees.
        const trees = ['Forge', 'Power', 'SkillsPetTech'];

        trees.forEach(treeName => {
            const treeDef = techTreeMapping.trees?.[treeName];
            if (!treeDef || !treeDef.nodes) return;

            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                const config = techTreeLibrary[nodeType];
                if (!config) return;

                const maxLevel = config.MaxLevel || 0;
                // Use helper to resolve level (handles My/Max/Empty)
                const level = getTechLevel(treeName as any, node.id, maxLevel);

                if (level > 0 && config.Stats && config.Stats.length > 0) {
                    // Identify Cost Reduction Nodes
                    if (nodeType === 'SkillSummonCost') {
                        const stat = config.Stats[0];
                        const val = stat.Value + ((level - 1) * stat.ValueIncrease);
                        costReduction += val;
                    }
                    // Identify Extra Bonus Nodes
                    if (nodeType === 'ExtraSkillChance' || nodeType === 'ExtraSummonChance') {
                        const stat = config.Stats[0];
                        const val = stat.Value + ((level - 1) * stat.ValueIncrease);
                        extraChance += val;
                    }
                }
            });
        });

        // Cap cost reduction at 90% (0.9) to prevent division by zero or negative cost
        return {
            costReduction: Math.min(0.9, costReduction),
            extraChance: extraChance
        };
    }, [techTreeLibrary, techTreeMapping, treeMode, simulatedTree, profile]);

    // 7. Base Config & Cost
    const SKILLS_PER_SUMMON = skillBaseConfig?.SummonCount || 5;
    const BASE_SUMMON_COST = skillBaseConfig?.SummonCost || 200; // Config usually says 200

    // 8. Probability Calculation (Fix Off-By-One)
    const probabilities = useMemo(() => {
        if (!dropChancesLibrary) return null;

        // Input 1-100. Data 0-99.
        // Level 1 -> Key "0"
        // Level 100 -> Key "99"
        const levelKey = (Math.max(0, level - 1)).toString();

        const levelData = dropChancesLibrary[levelKey];
        if (!levelData) return null;

        return {
            Common: levelData.Common || 0,
            Rare: levelData.Rare || 0,
            Epic: levelData.Epic || 0,
            Legendary: levelData.Legendary || 0,
            Ultimate: levelData.Ultimate || 0,
            Mythic: levelData.Mythic || 0
        };
    }, [dropChancesLibrary, level]);

    // 9. War Points
    const warPointsPerSummonSkill = useMemo(() => {
        if (!guildWarConfig) return null;
        const day0 = guildWarConfig["0"]; // Assuming Day 0 is Skill day
        if (!day0) return null;

        const points: Record<string, number> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        rarities.forEach(rarity => {
            const task = day0.Tasks.find((t: any) => t.Task === `Summon${rarity}Skill`);
            points[rarity] = task?.Rewards?.[0]?.Amount || 0;
        });

        return points;
    }, [guildWarConfig]);

    // 10. Results Logic
    const results = useMemo(() => {
        if (!probabilities || !warPointsPerSummonSkill) return null;

        // Cost Calculation
        // Reductions are OneMinusMultiplier e.g. 0.05
        // Total Reduction capped at 0.9 (90%)
        // User requested rounding UP (Arrotondato per eccesso)
        const finalCostPerSummon = Math.ceil(BASE_SUMMON_COST * (1 - techBonuses.costReduction));

        // Number of Summons possible with available tickets
        // prevent div by 0
        const safeCost = Math.max(1, finalCostPerSummon);
        const numSummons = Math.floor(ticketCount / safeCost);

        // Total Skills Yield
        // Skills = Summons * 5 * (1 + ExtraChance)
        const effectiveSkills = numSummons * SKILLS_PER_SUMMON * (1 + techBonuses.extraChance);

        const breakdown: { rarity: string; count: number; percentage: number; pointsPerUnit: number; totalPoints: number; }[] = [];
        let grandTotalPoints = 0;

        Object.entries(probabilities).forEach(([rarity, chance]) => {
            if (typeof chance !== 'number') return;

            const unitPoints = warPointsPerSummonSkill[rarity] || 0;
            const expectedCount = effectiveSkills * chance;
            const points = expectedCount * unitPoints;

            breakdown.push({
                rarity,
                count: expectedCount,
                percentage: chance * 100,
                pointsPerUnit: unitPoints,
                totalPoints: points
            });

            grandTotalPoints += points;
        });

        return {
            breakdown,
            totalSkills: effectiveSkills,
            totalPoints: grandTotalPoints,
            numSummons,
            finalCost: finalCostPerSummon,
            baseCost: BASE_SUMMON_COST,
            costReduction: techBonuses.costReduction
        };

    }, [ticketCount, probabilities, warPointsPerSummonSkill, SKILLS_PER_SUMMON, techBonuses, BASE_SUMMON_COST]);

    return {
        level, setLevel,
        ticketCount, setTicketCount,
        results,
        techBonuses
    };
}
