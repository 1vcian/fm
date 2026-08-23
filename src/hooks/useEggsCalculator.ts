import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { useTreeModifiers, useClanNodeMax } from './useCalculatedStats';
import { getWarPointsForTask, isWarPointDay, getDayBoostNodeType } from '../utils/guildWarUtils';


export interface EggOptimizationResult {
    toOpen: Record<string, number>;
    totalPoints: number;
    hatchPoints: number;
    mergePoints: number;
    timeUsed: number;
    baseTimeUsed: number;
    gemTimeUsed: number;
    timeLeft: number;
    timeline: Timeline;
    totalGemsUsed: number;
}

export interface TimelineEvent {
    rarity: string;
    startTime: number; // minutes
    endTime: number; // minutes
    duration: number; // minutes
    efficiency: number; // Points Per Second
    gemCost?: number;
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
    // Load from Profile instead of LocalStorage
    const [ownedEggs, setOwnedEggs] = useState<Record<string, number>>(() => {
        return (profile?.misc as any)?.ownedEggs || {
            Common: 0, Rare: 0, Epic: 0, Legendary: 0, Ultimate: 0, Mythic: 0
        };
    });

    const [timeLimitHours, setTimeLimitHours] = useState(24);
    const [availableSlots, _setAvailableSlots] = useState(3);
    const maxSlots = petConfig?.EggHatchSlotMaxCount || 4;

    // Sync from profile when profile changes (e.g. user switch)
    useEffect(() => {
        const saved = (profile?.misc as any)?.ownedEggs;
        if (saved) {
            setOwnedEggs(saved);
        }
    }, [profile]);


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
        const safeVal = Math.min(Math.max(1, val), 100);
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

    // Load generic misc settings
    useEffect(() => {
        if (profile) {
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

    // Save State to Profile
    const updateOwnedEggs = (rarity: string, count: number) => {
        const newEggs = { ...ownedEggs, [rarity]: count };
        setOwnedEggs(newEggs);

        // Save to Profile
        updateNestedProfile('misc', { ownedEggs: newEggs });
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
    // Clan tech tree boosts to war points earned (already effective values, see useGameData).
    const treeModifiers = useTreeModifiers();
    const clanMax = useClanNodeMax();
    const profileHatchWarBonus = treeModifiers['WarPointsFromEggHatch'] || 0;
    const profilePetMergeWarBonus = treeModifiers['WarPointsFromPetMerge'] || 0;

    // Sandbox: local overrides of the result-altering tree bonuses (see SandboxPanel).
    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const hatchWarBonus = sandbox.warHatch ?? profileHatchWarBonus;
    const petMergeWarBonus = sandbox.warMerge ?? profilePetMergeWarBonus;
    // Day boost: WarPointsOnDayN multiplier, only when eggs are active today.
    const dayActive = isWarPointDay(new Date(), 'eggs', guildWarConfig);
    const profileDayBoost = dayActive ? (treeModifiers[getDayBoostNodeType()] || 0) : 0;
    const dayBoost = sandbox.dayBoost ?? profileDayBoost;
    const sandboxControls = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'warHatch', label: 'War points: egg hatch', value: hatchWarBonus, profileValue: profileHatchWarBonus, min: 0, max: clanMax['WarPointsFromEggHatch'] || 0.4, step: 0.02, onChange: (v: number) => setSandbox(p => ({ ...p, warHatch: v })) },
            { key: 'warMerge', label: 'War points: pet merge', value: petMergeWarBonus, profileValue: profilePetMergeWarBonus, min: 0, max: clanMax['WarPointsFromPetMerge'] || 0.4, step: 0.02, onChange: (v: number) => setSandbox(p => ({ ...p, warMerge: v })) },
            { key: 'dayBoost', label: 'Day war-points boost (today)', value: dayBoost, profileValue: profileDayBoost, min: 0, max: clanMax['WarPointsOnDay1'] || 0.4, step: 0.02, onChange: (v: number) => setSandbox(p => ({ ...p, dayBoost: v })) },
        ],
    };

    const warPoints = useMemo(() => {
        if (!guildWarConfig) return null;

        const points: Record<string, { hatch: number, merge: number }> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // Read amounts from whatever day holds the task (independent of day layout),
        // then apply the clan tech tree war-point boosts.
        rarities.forEach(rarity => {
            const baseHatch = getWarPointsForTask(guildWarConfig, `Hatch${rarity}Egg`);
            const baseMerge = getWarPointsForTask(guildWarConfig, `Merge${rarity}Pet`);

            points[rarity] = {
                hatch: baseHatch * (1 + hatchWarBonus + dayBoost),
                merge: baseMerge * (1 + petMergeWarBonus + dayBoost)
            };
        });

        return points;
    }, [guildWarConfig, hatchWarBonus, petMergeWarBonus, dayBoost]);

    // --- Optimization Logic ---
    const { data: forgeConfig } = useGameData<any>('ForgeConfig.json');

    const optimization = useMemo((): EggOptimizationResult | null => {
        if (!hatchValuesProfile || !warPoints || !forgeConfig) return null;

        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // 1. Prepare Pool of All Eggs
        interface EggCandidate {
            rarity: string;
            time: number; // minutes
            timeSeconds: number; // seconds
            eff: number;  // points per SECOND
            hPoints: number;
            mPoints: number;
        }

        const allCandidates: EggCandidate[] = [];
        rarities.forEach(rarity => {
            const count = ownedEggs[rarity] || 0;
            if (count <= 0) return;

            const timeSeconds = (hatchValuesProfile[rarity] || 0);
            const time = timeSeconds / 60; // minutes

            const h = warPoints[rarity]?.hatch || 0;
            const m = warPoints[rarity]?.merge || 0;
            const totalP = h + m;

            // Efficiency: Points / Seconds (Higher precision)
            const eff = timeSeconds > 0 ? totalP / timeSeconds : 999999;

            for (let i = 0; i < count; i++) {
                allCandidates.push({ rarity, time, timeSeconds, eff, hPoints: h, mPoints: m });
            }
        });

        // Sort descending by Efficiency (PPS)
        allCandidates.sort((a, b) => {
            // Primary: Efficiency (PPS) - Relaxed epsilon to allow Big Rocks preference for similar efficiencies
            if (Math.abs(b.eff - a.eff) > 0.0001) return b.eff - a.eff;

            // Secondary: Total Points (Importance/Size)
            const pointsA = a.hPoints + a.mPoints;
            const pointsB = b.hPoints + b.mPoints;
            return pointsB - pointsA;
        });

        // 2. Simulation State
        const slots = new Array(availableSlots).fill(0);
        const timeline: Timeline = Array.from({ length: availableSlots }, () => []);
        const toOpen: Record<string, number> = {
            Common: 0, Rare: 0, Epic: 0, Legendary: 0, Ultimate: 0, Mythic: 0
        };
        let hPoints = 0;
        let mPoints = 0;

        let totalGemCost = 0;
        const gemLimit = profile.misc.useGemsInCalculators ? profile.misc.gemCount : 0;
        const gemCostPerSecond = forgeConfig.PetGemSkipCostPerSecond || 0.003;

        // 3. Greedy Assignment (Least Loaded / Earliest Finish)
        // User wants to balance slots ("non tutto sul primo") and minimize makespan.
        // Since we sorted by Time Descending (Big Rocks), using parameters of LPT (Longest Processing Time) 
        // with Least Loaded assignment gives the most balanced schedule.

        for (const egg of allCandidates) {
            // Find slot with minimum current time that fits the egg
            let bestSlotIdx = -1;
            let minCurrentTime = Number.MAX_VALUE;

            for (let i = 0; i < availableSlots; i++) {
                // Check if this slot is better (earlier)
                if (slots[i] < minCurrentTime) {
                    // Tentatively check if we can afford it with gems
                    const startTime = slots[i];
                    const endTime = startTime + egg.time;
                    const baseMinutesAvailable = timeLimitHours * 60;

                    let potentialGemCost = 0;
                    if (endTime > baseMinutesAvailable) {
                        const gemMinutes = Math.min(egg.time, endTime - Math.max(startTime, baseMinutesAvailable));
                        if (gemMinutes > 0) {
                            potentialGemCost = Math.ceil((gemMinutes * 60) * gemCostPerSecond);
                        }
                    }

                    // Only consider this slot if we can afford the gems AND it fits within the base time limit
                    // OR if it exceeds base time but we have gems for it.
                    if (endTime <= baseMinutesAvailable || (totalGemCost + potentialGemCost <= gemLimit)) {
                        minCurrentTime = slots[i];
                        bestSlotIdx = i;
                    }
                }
            }

            // If we found a valid slot
            if (bestSlotIdx !== -1) {
                const startTime = slots[bestSlotIdx];
                const endTime = startTime + egg.time;

                // Re-calculate Gem Cost (it should be the same as the check, but cleaner to recalc)
                const baseMinutesAvailable = timeLimitHours * 60;
                let gemCost = 0;

                if (endTime > baseMinutesAvailable) {
                    const gemMinutes = Math.min(egg.time, endTime - Math.max(startTime, baseMinutesAvailable));
                    if (gemMinutes > 0) {
                        gemCost = Math.ceil((gemMinutes * 60) * gemCostPerSecond);
                    }
                }

                // Commit
                slots[bestSlotIdx] = endTime;
                timeline[bestSlotIdx].push({
                    rarity: egg.rarity,
                    startTime,
                    endTime,
                    duration: egg.time,
                    efficiency: egg.eff,
                    gemCost
                });
                toOpen[egg.rarity] = (toOpen[egg.rarity] || 0) + 1;
                hPoints += egg.hPoints;
                mPoints += egg.mPoints;
                totalGemCost += gemCost;
            }
        }

        const makeSpan = Math.max(...slots);

        return {
            toOpen,
            totalPoints: hPoints + mPoints,
            hatchPoints: hPoints,
            mergePoints: mPoints,
            timeUsed: makeSpan,
            baseTimeUsed: Math.min(makeSpan, (timeLimitHours * 60)),
            gemTimeUsed: Math.max(0, makeSpan - (timeLimitHours * 60)),
            timeLeft: Math.max(0, (timeLimitHours * 60) - makeSpan),
            timeline,
            totalGemsUsed: totalGemCost
        };

    }, [ownedEggs, timeLimitHours, availableSlots, hatchValuesProfile, warPoints, forgeConfig, profile.misc.gemCount, profile.misc.useGemsInCalculators]);

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
        warPoints,
        warPointBonuses: { hatch: hatchWarBonus, merge: petMergeWarBonus },
        sandbox: sandboxControls
    };
}
