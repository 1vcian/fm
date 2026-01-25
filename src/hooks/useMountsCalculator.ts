import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { mountSummonRates, mountWarPoints, WINDERS_PER_SUMMON } from '../constants/mountData';

export type CalculationMode = 'calculate' | 'target';

export function useMountsCalculator() {
    // Contexts
    const { profile } = useProfile();
    const { isTreeMode, activeTree, simulatedTree } = useTreeMode();

    // Game Data
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');

    const [level, setLevel] = useState(1);
    const [mode, setMode] = useState<CalculationMode>('calculate');

    // Inputs
    const [windersCount, setWindersCount] = useState(0);
    const [targetPoints, setTargetPoints] = useState(0);

    // Persist level
    useEffect(() => {
        const saved = localStorage.getItem('mountLevel');
        if (saved) setLevel(parseInt(saved));
    }, []);

    useEffect(() => {
        localStorage.setItem('mountLevel', level.toString());
    }, [level]);

    // Tech Bonus Calculation
    const techBonuses = useMemo(() => {
        if (!techTreeLibrary || !techTreePositionLibrary || !profile) {
            return { costReduction: 0, extraChance: 0 };
        }

        const treeSource = isTreeMode ? simulatedTree : profile.techTree;
        const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];

        let costReduction = 0;
        let extraChance = 0;

        // Tree Walker Helper
        const checkNodeValidity = (treeName: string, levels: Record<string, number>, nodeId: number, visited = new Set<number>()): boolean => {
            if (visited.has(nodeId)) return false;
            const level = levels[nodeId];
            if (!level || level <= 0) return false;

            const treeData = techTreePositionLibrary[treeName];
            const node = treeData?.Nodes?.find((n: any) => n.Id === nodeId);
            if (!node) return false;

            visited.add(nodeId);
            if (node.Requirements?.length > 0) {
                for (const reqId of node.Requirements) {
                    if (!checkNodeValidity(treeName, levels, reqId, visited)) return false;
                }
            }
            visited.delete(nodeId);
            return true;
        };

        for (const tree of trees) {
            const treeLevels = treeSource[tree] || {};
            const treeData = techTreePositionLibrary[tree];
            if (!treeData) continue;

            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);

                if (checkNodeValidity(tree, treeLevels, nodeId)) {
                    const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                    const nodeConf = techTreeLibrary[node?.Type];

                    if (nodeConf?.Type === 'MountSummonCost') {
                        const base = nodeConf.Stats[0].Value;
                        const inc = nodeConf.Stats[0].ValueIncrease;
                        // OneMinusMultiplier: 0.01 means 1% reduction
                        costReduction += base + (Math.max(0, level - 1) * inc);
                    }
                    if (nodeConf?.Type === 'ExtraMountChance') {
                        const base = nodeConf.Stats[0].Value;
                        const inc = nodeConf.Stats[0].ValueIncrease;
                        // Multiplier: 0.02 means +2% chance
                        extraChance += base + (Math.max(0, level - 1) * inc);
                    }
                }
            }
        }

        return {
            costReduction: Math.min(0.9, costReduction), // Cap reduction?
            extraChance
        };
    }, [techTreeLibrary, techTreePositionLibrary, profile, isTreeMode, simulatedTree]);

    // Derived Values
    const effectiveCostPerSummon = useMemo(() => {
        // Cost Reduction is "OneMinusMultiplier" in engine => Cost * (1 - Reduction)
        return WINDERS_PER_SUMMON * (1 - techBonuses.costReduction);
    }, [techBonuses]);

    const effectiveSummonsPerWinder = useMemo(() => {
        // Extra Chance is "Freebie" => If 10% chance, 100 winders = 100 summons + 10 free + 1 free... 
        // Or simple: 1 / (1 - Chance) multiplier on yield? 
        // Engine calls it "FreebieChance". Usually means "Chance to get result without cost" or "Double Drop".
        // If it's "Free Summon Chance": Expected Summons = BaseSummons * (1 + Chance)? 
        // Let's assume linear bonus: 100 paid summons + 20 free ones = 120 total.
        // So Multiplier = 1 + Chance.
        return 1 + techBonuses.extraChance;
    }, [techBonuses]);

    const expectedPointsPerSummon = useMemo(() => {
        const rates = mountSummonRates[level];
        if (!rates) return 0;
        let expected = 0;
        const tiers = ['common', 'rare', 'epic', 'legendary', 'ultimate', 'mythic'];
        for (const tier of tiers) {
            if (rates[tier]) expected += rates[tier] * mountWarPoints[tier];
        }
        return expected;
    }, [level]);

    // Results
    const calculationResults = useMemo(() => {
        const paidSummons = windersCount / effectiveCostPerSummon;
        const totalSummons = paidSummons * effectiveSummonsPerWinder; // Apply extra chance multiplier
        const totalPoints = totalSummons * expectedPointsPerSummon;

        return {
            paidSummons: Math.floor(paidSummons),
            totalSummons: Math.floor(totalSummons),
            totalPoints
        };
    }, [windersCount, effectiveCostPerSummon, effectiveSummonsPerWinder, expectedPointsPerSummon]);

    const targetResults = useMemo(() => {
        if (expectedPointsPerSummon <= 0) return { summonsNeeded: 0, windersNeeded: 0 };

        // Points = TotalSummons * PointsPerSummon
        // TotalSummonsNeeded = Target / PointsPerSummon
        const totalSummonsNeeded = targetPoints / expectedPointsPerSummon;

        // TotalSummons = PaidSummons * (1 + ExtraChance)
        // PaidSummons = TotalSummons / (1 + ExtraChance)
        const paidSummonsNeeded = totalSummonsNeeded / effectiveSummonsPerWinder;

        // Winders = PaidSummons * EffectiveCost
        const windersNeeded = paidSummonsNeeded * effectiveCostPerSummon;

        return {
            summonsNeeded: Math.ceil(totalSummonsNeeded),
            windersNeeded: Math.ceil(windersNeeded)
        };
    }, [targetPoints, expectedPointsPerSummon, effectiveSummonsPerWinder, effectiveCostPerSummon]);

    return {
        level, setLevel,
        mode, setMode,
        windersCount, setWindersCount,
        targetPoints, setTargetPoints,
        techBonuses,
        calculationResults,
        targetResults,
        expectedPointsPerSummon
    };
}
