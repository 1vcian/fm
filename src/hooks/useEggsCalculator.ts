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
    timeline: Timeline;
}

export interface TimelineEvent {
    rarity: string;
    startTime: number; // minutes
    endTime: number; // minutes
    duration: number; // minutes
}

export type Timeline = TimelineEvent[][];

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



        raritiesKeys.forEach(rarity => {
            let baseTime = eggLibrary[rarity]?.HatchTime || 0;
            let speedDivisor = 1.0;

            // 1. Iterate ALL nodes in the tree to find ALL matches for this type
            // (e.g. Node 8 is CommonEggTimer AND Node 25 is CommonEggTimer)
            const nodeTypeName = `${rarity}EggTimer`; // e.g. CommonEggTimer
            const treeNodes = techTreeMapping.trees?.SkillsPetTech?.nodes || [];

            treeNodes.forEach((node: any) => {
                if (node.type === nodeTypeName) {
                    const nodeConfig = techTreeLibrary?.[nodeTypeName];
                    if (nodeConfig) {
                        const userLevel = getTechLevel('SkillsPetTech', node.id, nodeConfig.MaxLevel);
                        if (userLevel > 0) {
                            const stat = nodeConfig.Stats?.[0];
                            if (stat) {
                                const valIncrease = stat.ValueIncrease || 0;
                                const baseVal = stat.Value || 0;
                                // Match TechTreePanel Logic: Base + ((Level - 1) * Increase)
                                const nodeVal = baseVal + ((userLevel - 1) * valIncrease);
                                speedDivisor += nodeVal;
                            }
                        }
                    }
                }
            });
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
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // 1. Prepare Pool of All Eggs (Sorted by Efficiency)
        interface EggCandidate {
            rarity: string;
            time: number; // minutes
            eff: number;  // points per minute
            hPoints: number;
            mPoints: number;
        }

        const allCandidates: EggCandidate[] = [];
        rarities.forEach(rarity => {
            const count = ownedEggs[rarity] || 0;
            if (count <= 0) return;

            const time = (hatchValuesProfile[rarity] || 0) / 60;
            const h = warPoints[rarity]?.hatch || 0;
            const m = warPoints[rarity]?.merge || 0;
            const totalP = h + m;

            // Efficiency: Points / Time
            // If time is 0 (shouldn't happen), use infinity
            const eff = time > 0 ? totalP / time : 999999;

            for (let i = 0; i < count; i++) {
                allCandidates.push({ rarity, time, eff, hPoints: h, mPoints: m });
            }
        });

        // Sort descending by Total Points (Importance), then Time, then Efficiency
        allCandidates.sort((a, b) => {
            const pointsA = a.hPoints + a.mPoints;
            const pointsB = b.hPoints + b.mPoints;

            // Primary: High Points items first ("Most Important")
            if (Math.abs(pointsB - pointsA) > 0.1) return pointsB - pointsA;

            // Secondary: Time Descending (Big Rocks)
            if (Math.abs(b.time - a.time) > 0.1) return b.time - a.time;

            // Tertiary: Efficiency
            return b.eff - a.eff;
        });

        // 2. Simulation State
        const slots = new Array(availableSlots).fill(0);
        const timeline: Timeline = Array.from({ length: availableSlots }, () => []);
        const toOpen: Record<string, number> = {
            Common: 0, Rare: 0, Epic: 0, Legendary: 0, Ultimate: 0, Mythic: 0
        };
        let hPoints = 0;
        let mPoints = 0;

        // 3. Greedy Assignment (Least Loaded / Earliest Finish)
        // User wants to balance slots ("non tutto sul primo") and minimize makespan.
        // Since we sorted by Time Descending (Big Rocks), using parameters of LPT (Longest Processing Time) 
        // with Least Loaded assignment gives the most balanced schedule.

        for (const egg of allCandidates) {
            // Find slot with minimum current time that fits the egg
            let bestSlotIdx = -1;
            let minCurrentTime = Number.MAX_VALUE;

            for (let i = 0; i < availableSlots; i++) {
                // Must fit within limit
                if (slots[i] + egg.time <= totalMinutesAvailable) {
                    // We want the LEAST loaded slot to balance
                    if (slots[i] < minCurrentTime) {
                        minCurrentTime = slots[i];
                        bestSlotIdx = i;
                    }
                }
            }

            // If we found a valid slot
            if (bestSlotIdx !== -1) {
                const startTime = slots[bestSlotIdx];
                const endTime = startTime + egg.time;

                // Commit
                slots[bestSlotIdx] = endTime;
                timeline[bestSlotIdx].push({
                    rarity: egg.rarity,
                    startTime,
                    endTime,
                    duration: egg.time
                });
                toOpen[egg.rarity] = (toOpen[egg.rarity] || 0) + 1;
                hPoints += egg.hPoints;
                mPoints += egg.mPoints;
            }
        }

        const makeSpan = Math.max(...slots);

        return {
            toOpen,
            totalPoints: hPoints + mPoints,
            hatchPoints: hPoints,
            mergePoints: mPoints,
            timeUsed: makeSpan, // This will now be <= totalMinutesAvailable
            timeLeft: totalMinutesAvailable - makeSpan,
            timeline
        };

    }, [ownedEggs, timeLimitHours, availableSlots, hatchValuesProfile, warPoints]);

    // --- Tech Tree Bonus (Additive Chance) ---
    const eggDungeonBonus = useMemo(() => {
        if (!profile || !techTreeMapping || !techTreeLibrary) return 0;

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

        return bonus;
    }, [profile, techTreeMapping, techTreeLibrary, treeMode]);

    return {
        // Optimization
        ownedEggs, setOwnedEggs, updateOwnedEggs,
        timeLimitHours, setTimeLimitHours,
        availableSlots, setAvailableSlots, maxSlots,
        hatchValues: hatchValuesProfile, // Default to profile values
        optimization,
        eggDungeonBonus, // Export this instead of multiplier if needed, or just for debug

        // Info / Manual
        selectedStage, setSelectedStage,
        dungeonKeys, setDungeonKeys,
        stageDropRates,
        todayTotalDrops: dungeonKeys * (2 + eggDungeonBonus), // Corrected Formula: Base(2) + Bonus
        hatchingTimes: hatchValuesProfile, // Use real profile times now
        warPoints
    };
}
