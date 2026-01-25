import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';


export interface EggOptimizationResult {
    toOpen: Record<string, number>;
    totalPoints: number;
    hatchPoints: number;
    mergePoints: number;
    timeUsed: number;
    timeLeft: number;
}

export function useEggsCalculator() {
    // Game Data
    const { data: eggLibrary } = useGameData<any>('EggLibrary.json');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: dungeonEggData } = useGameData<any>('DungeonRewardEggLibrary.json');
    const { data: petConfig } = useGameData<any>('PetBaseConfig.json');
    const { profile, updateNestedProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // Helper to get effective tech level based on Mode
    const getTechLevel = (treeName: 'Forge' | 'Power' | 'SkillsPetTech', nodeId: number, maxLevel: number = 0) => {
        if (treeMode === 'max') return maxLevel || 999;
        if (treeMode === 'empty') return 0;
        return profile?.techTree?.[treeName]?.[nodeId] || 0;
    };

    // --- Optimization State ---
    const [ownedEggs, setOwnedEggs] = useState<Record<string, number>>({
        Common: 0, Rare: 0, Epic: 0, Legendary: 0, Ultimate: 0, Mythic: 0
    });
    const [timeLimitHours, setTimeLimitHours] = useState(24);
    const [availableSlots, _setAvailableSlots] = useState(3);
    const maxSlots = petConfig?.EggHatchSlotMaxCount || 4; // Dynamic max from config

    const setAvailableSlots = (val: number) => {
        const safeVal = Math.min(maxSlots, Math.max(1, val));
        _setAvailableSlots(safeVal);
        if (profile) {
            updateNestedProfile('misc', { eggSlots: safeVal });
        }
    };

    // --- Drop Rate State (Stage Selector) ---
    const [selectedStage, _setSelectedStage] = useState(1);

    const setSelectedStage = (val: number) => {
        const safeVal = Math.min(Math.max(1, val), 100); // 1-100 limit?
        _setSelectedStage(safeVal);
        if (profile) {
            updateNestedProfile('misc', { eggStage: safeVal });
        }
    };

    const [dungeonKeys, _setDungeonKeys] = useState(1);

    const setDungeonKeys = (val: number) => {
        const safeVal = Math.max(1, val);
        _setDungeonKeys(safeVal);
        if (profile) {
            updateNestedProfile('misc', { dungeonKeys: safeVal });
        }
    };

    // Load State
    useEffect(() => {
        if (profile) {
            const savedOwned = localStorage.getItem('eggCalc_owned');
            if (savedOwned) setOwnedEggs(JSON.parse(savedOwned));

            if (profile.misc?.eggSlots) {
                if (profile.misc?.eggSlots && profile.misc.eggSlots !== availableSlots) {
                    _setAvailableSlots(profile.misc.eggSlots);
                }
            }

            if (profile.misc?.eggStage) {
                _setSelectedStage(profile.misc.eggStage);
            }

            if (profile.misc?.dungeonKeys) {
                _setDungeonKeys(profile.misc.dungeonKeys);
            }
        }
    }, [profile]);

    // Save State
    const updateOwnedEggs = (rarity: string, count: number) => {
        const newEggs = { ...ownedEggs, [rarity]: count };
        setOwnedEggs(newEggs);
        localStorage.setItem('eggCalc_owned', JSON.stringify(newEggs));

        // Optional: Save to profile if we had a dedicated field
    };



    // --- Hatch Time Logic (Shared) ---
    // 1. Profile-based Hatch Values (for Calculator & Info)
    const hatchValuesProfile = useMemo(() => {
        if (!eggLibrary || !profile?.techTree || !techTreeMapping) return null;

        const times: Record<string, number> = {};
        const raritiesKeys = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // Helper to find Node ID by Type name in SkillsPetTech tree
        const findNodeId = (type: string): number | null => {
            const nodes = techTreeMapping.trees?.SkillsPetTech?.nodes;
            if (!nodes) return null;
            const node = nodes.find((n: any) => n.type === type);
            return node ? node.id : null;
        };

        raritiesKeys.forEach(rarity => {
            let baseTime = eggLibrary[rarity]?.HatchTime || 0;
            let speedDivisor = 1.0;

            // 1. Find the Node Config in Library (for stats per level)
            const nodeTypeName = `${rarity}EggTimer`; // e.g. CommonEggTimer
            const nodeConfig = techTreeLibrary?.[nodeTypeName];

            // 2. Find the Node ID in Mapping (to start lookup in Profile)
            const nodeId = findNodeId(nodeTypeName);

            if (nodeConfig && nodeId !== null) {
                // 3. Get User Level (respecting Tree Mode)
                const userLevel = getTechLevel('SkillsPetTech', nodeId, nodeConfig.MaxLevel);

                if (userLevel > 0) {
                    const stat = nodeConfig.Stats?.[0]; // Usually only one stat for these
                    if (stat) {
                        const valIncrease = stat.ValueIncrease || 0; // e.g. 0.10
                        // Bonus is additive: 1 + (Level * 0.10)
                        speedDivisor += (userLevel * valIncrease);
                    }
                }
            }
            times[rarity] = baseTime / speedDivisor;
        });
        return times;
    }, [eggLibrary, profile, techTreeLibrary, techTreeMapping, treeMode]);

    // --- Drop Rate Logic (Dynamic from Stage) ---
    const stageDropRates = useMemo(() => {
        if (!dungeonEggData) return [];

        // Data index is (Level - 1) string
        const levelKey = (selectedStage - 1).toString();
        const dropRates = dungeonEggData[levelKey];

        if (!dropRates) return [];

        const tiers = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        return tiers.map(tier => {
            const probability = dropRates[tier] || 0;
            return {
                tier,
                probability
            };
        }).filter(item => item.probability > 0 || item.tier === 'Common'); // Keep at least one or filter zeros? Keeping zeros might be informative.
    }, [dungeonEggData, selectedStage]);

    // --- War Logic ---
    const warPoints = useMemo(() => {
        if (!guildWarConfig) return null;
        // Day 1 seems to be the Summon/Merge day based on task list
        const dayConfig = guildWarConfig["1"]; // Day 1
        if (!dayConfig) return null;

        const points: Record<string, { hatch: number, merge: number }> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        rarities.forEach(rarity => {
            const hatchTask = dayConfig.Tasks.find((t: any) => t.Task === `Hatch${rarity}Egg`);
            const mergeTask = dayConfig.Tasks.find((t: any) => t.Task === `Merge${rarity}Pet`);

            points[rarity] = {
                hatch: hatchTask?.Rewards?.[0]?.Amount || 0,
                merge: mergeTask?.Rewards?.[0]?.Amount || 0
            };
        });

        return points;
    }, [guildWarConfig]);

    // --- Optimization Logic ---
    const optimization = useMemo((): EggOptimizationResult | null => {
        if (!hatchValuesProfile || !warPoints) return null;

        const totalMinutesAvailable = timeLimitHours * 60;
        const totalSlotMinutes = totalMinutesAvailable * availableSlots;

        let remainingSlotMinutes = totalSlotMinutes;
        const toOpen: Record<string, number> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // Metrics for Efficiency: Points per Minute
        // Note: Opening an egg gives Hatch Points AND potential Merge points.
        // If we assume we hold onto them to merge, 1 Hatch = 1 Pet.
        // 5 Pets = 1 Merge + 1 Next Rarity Pet.
        // For simple maximization, we focus on Hatch Points density first?
        // Actually, pure Hatch Points per minute is the constraint for TIME.
        // Merge points come "free" instantly after hatching.

        const efficiencies = rarities.map(rarity => {
            const hatchTimeMin = (hatchValuesProfile[rarity] || 0) / 60;
            const pts = warPoints[rarity]?.hatch || 0;
            // Add expected merge value? (1/5 of a merge reward)
            // + (MergePoints / 5)? 
            // Let's stick to Hatch Efficiency for the Knapsack, as Merges are derivative.

            const eff = hatchTimeMin > 0 ? pts / hatchTimeMin : 0;
            return { rarity, eff, timeCost: hatchTimeMin };
        }).sort((a, b) => b.eff - a.eff); // Highest efficiency first

        // Fill slots
        efficiencies.forEach(({ rarity, timeCost }) => {
            const count = ownedEggs[rarity] || 0;
            if (count === 0) return;

            const maxCanDo = Math.floor(remainingSlotMinutes / timeCost);
            const doCount = Math.min(count, maxCanDo);

            toOpen[rarity] = doCount;
            remainingSlotMinutes -= (doCount * timeCost);
        });

        // Compute Totals
        let hPoints = 0;
        let mPoints = 0;

        Object.keys(toOpen).forEach(rarity => {
            const count = toOpen[rarity];
            if (count > 0) {
                hPoints += count * (warPoints[rarity]?.hatch || 0);

                // User Feedback: "Every egg you open, you also merge".
                // Detailed meaning: Hatching provides a pet which is immediately used for an upgrade/merge action.
                // Thus, 1 Hatch Event = 1 Merge Event.
                mPoints += count * (warPoints[rarity]?.merge || 0);
            }
        });

        return {
            toOpen,
            totalPoints: hPoints + mPoints,
            hatchPoints: hPoints,
            mergePoints: mPoints,
            timeUsed: (totalSlotMinutes - remainingSlotMinutes) / availableSlots, // Average time used per slot? or Total?
            // Actually "Time Used" usually means "When will I finish?". 
            // If valid, it's total minutes / slots.
            timeLeft: remainingSlotMinutes / availableSlots
        };

    }, [ownedEggs, timeLimitHours, availableSlots, hatchValuesProfile, warPoints]);

    // --- Tech Tree Multiplier ---
    const eggDungeonMultiplier = useMemo(() => {
        if (!profile || !techTreeMapping || !techTreeLibrary) return 1;

        let bonus = 0;
        // Check all trees for ExtraEggChance
        ['Forge', 'Power', 'SkillsPetTech'].forEach((treeName) => {
            const nodes = techTreeMapping.trees?.[treeName]?.nodes;
            if (!nodes) return;

            nodes.forEach((node: any) => {
                if (node.type === 'ExtraEggChance') {
                    // Check Mode
                    const def = techTreeLibrary[node.type];
                    const level = getTechLevel(treeName as any, node.id, def?.MaxLevel || 0);

                    if (level > 0) {
                        if (def && def.Stats && def.Stats[0]) {
                            const stat = def.Stats[0];
                            const val = stat.Value + ((level - 1) * stat.ValueIncrease);
                            bonus += val;
                        }
                    }
                }
            });
        });

        return 1 + bonus;
    }, [profile, techTreeMapping, techTreeLibrary, treeMode]);

    return {
        // Optimization
        ownedEggs, setOwnedEggs, updateOwnedEggs,
        timeLimitHours, setTimeLimitHours,
        availableSlots, setAvailableSlots, maxSlots,
        hatchValues: hatchValuesProfile, // Default to profile values
        optimization,
        eggDungeonMultiplier, // Export this

        // Info / Manual
        selectedStage, setSelectedStage,
        dungeonKeys, setDungeonKeys,
        stageDropRates,
        todayTotalDrops: dungeonKeys * 2 * eggDungeonMultiplier, // Export total for display
        hatchingTimes: hatchValuesProfile, // Use real profile times now
        warPoints
    };
}
