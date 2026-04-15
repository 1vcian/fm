import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { isWarPointDay } from '../utils/guildWarUtils';

export interface TechUpgrade {
    tree: string;
    nodeId: number;
    nodeName: string;
    type: string;
    fromLevel: number;
    toLevel: number;
    cost: number;
    duration: number;
    points: number;
    warPoints: number;
    tier: number;
    sprite_rect?: { x: number; y: number; width: number; height: number };
    gemCost?: number;
    isWarDay?: boolean;
    endDate?: Date;
}


export function useTreeOptimizer() {
    const { profile, updateProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // 1. Data Loading
    const { data: mapping } = useGameData<any>('TechTreeMapping.json');
    const { data: library } = useGameData<any>('TechTreeLibrary.json');
    const { data: upgradeLibrary } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: dayConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: forgeConfig } = useGameData<any>('ForgeConfig.json');

    const gemSkipCostPerSecond = forgeConfig?.TechTreeGemSkipCostPerSecond || 0.0023;

    // 2. State
    const [timeLimitHours, setTimeLimitHours] = useState(() => {
        const now = new Date();
        const target = new Date(now);
        target.setHours(23, 59, 0, 0);
        if (now.getTime() >= target.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return (target.getTime() - now.getTime()) / (3600 * 1000);
    });
    const [potions, setPotions] = useState(profile.misc.techPotions || 0);

    // Sync potions to profile
    useEffect(() => {
        updateProfile({
            misc: {
                ...profile.misc,
                techPotions: potions
            }
        });
    }, [potions]);

    // 3. Tech Bonuses Helper
    const calculateTechBonuses = (tree: Record<string, Record<number, number>>) => {
        let costReduction = 0;
        let speedBonus = 0;

        Object.entries(tree).forEach(([treeName, treeNodes]) => {
            const treeDef = mapping?.trees?.[treeName];
            if (!treeDef || !treeDef.nodes) return;

            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                if (nodeType !== 'TechNodeUpgradeCost' && nodeType !== 'TechResearchTimer') return;

                const nodeConfig = library[nodeType];
                if (!nodeConfig) return;

                const nodeLevel = treeNodes[node.id] || 0;
                if (nodeLevel > 0 && nodeConfig.Stats?.[0]) {
                    const stat = nodeConfig.Stats[0];
                    const val = stat.Value + ((nodeLevel - 1) * stat.ValueIncrease);
                    if (nodeType === 'TechNodeUpgradeCost') {
                        costReduction += val;
                    } else if (nodeType === 'TechResearchTimer') {
                        speedBonus += val;
                    }
                }
            });
        });

        return {
            costReduction: Math.min(0.95, costReduction), // Cap at 95%
            speedBonus
        };
    };

    // 4. Optimization Logic

    const optimization = useMemo(() => {
        if (!mapping || !library || !upgradeLibrary || !dayConfig || !forgeConfig) return null;

        // Map Tier -> Points (with fallbacks)
        const tierPoints: Record<number, number> = {
            0: 300,   // I
            1: 7500,  // II
            2: 20000, // III
            3: 35000, // IV
            4: 62000  // V
        };

        // Extract dynamic points from dayConfig if available
        if (dayConfig) {
            const taskToTier: Record<string, number> = {
                'FinishITechTreeUpgrade': 0,
                'FinishIITechTreeUpgrade': 1,
                'FinishIIITechTreeUpgrade': 2,
                'FinishIVTechTreeUpgrade': 3,
                'FinishVTechTreeUpgrade': 4
            };

            Object.values(dayConfig).forEach((dayData: any) => {
                dayData.Tasks?.forEach((task: any) => {
                    const tier = taskToTier[task.Task];
                    if (tier !== undefined) {
                        const amount = task.Rewards?.find((r: any) => r.$type === "WarPointsReward")?.Amount;
                        if (amount) tierPoints[tier] = amount;
                    }
                });
            });
        }

        // Initialize Virtual Tree (based on My/Max/Empty mode)
        const currentTree: Record<string, Record<number, number>> = {
            Forge: { ...profile.techTree.Forge },
            Power: { ...profile.techTree.Power },
            SkillsPetTech: { ...profile.techTree.SkillsPetTech }
        };

        if (treeMode === 'max') {
            // If mode is max, we can't really optimize further
            return { totalPoints: 0, actions: [], timeUsed: 0, potionsUsed: 0 };
        }
        if (treeMode === 'empty') {
            currentTree.Forge = {};
            currentTree.Power = {};
            currentTree.SkillsPetTech = {};
        }

        let totalPoints = 0;
        let totalWarPoints = 0;
        const baseTimeLimitSeconds = timeLimitHours * 3600;
        const planStartMs = new Date().getTime(); // Use current time as plan start for war day calculation

        // Track resources
        let accumulatedTimeSeconds = 0;
        let accumulatedGemCost = 0;
        const gemLimit = (profile.misc.useGemsInCalculators ? profile.misc.gemCount : 0);
        let potionsRemaining = potions;

        const actions: TechUpgrade[] = [];
        const gemCostPerSecond = forgeConfig.TechTreeGemSkipCostPerSecond || 0.003;

        // Simple Greedy Simulation
        const maxIter = 500; // Safety break
        let iter = 0;

        // We continue as long as we can potentially perform an action.
        // Determining "can perform" is handled inside by the search for a candidate.
        while (iter < maxIter) {
            iter++;

            // Calculate current bonuses
            const bonuses = calculateTechBonuses(currentTree);

            const possibleUpgrades: TechUpgrade[] = [];

            // Find all available upgrades
            Object.entries(mapping.trees || {}).forEach(([treeName, treeDef]: [string, any]) => {
                treeDef.nodes.forEach((node: any) => {
                    const currentLvl = currentTree[treeName]?.[node.id] || 0;
                    const nodeType = node.type;
                    const nodeConfig = library[nodeType];
                    const maxLvl = nodeConfig?.MaxLevel || 0;

                    if (currentLvl < maxLvl) {
                        // Check requirements
                        const reqsMet = (node.requirements || []).every((reqId: number) => {
                            return (currentTree[treeName]?.[reqId] || 0) >= 1;
                        });

                        if (reqsMet) {
                            const tier = node.tier || 0;
                            const upgradeData = upgradeLibrary[tier.toString()];
                            if (upgradeData) {
                                const levelData = upgradeData.Levels.find((l: any) => l.Level === currentLvl);
                                if (levelData) {
                                    // Apply bonuses
                                    const finalCost = Math.ceil(levelData.Cost * (1 - bonuses.costReduction));
                                    const finalDuration = Math.ceil(levelData.Duration / (1 + bonuses.speedBonus));

                                    possibleUpgrades.push({
                                        tree: treeName,
                                        nodeId: node.id,
                                        nodeName: nodeType,
                                        type: nodeType,
                                        fromLevel: currentLvl,
                                        toLevel: currentLvl + 1,
                                        cost: finalCost,
                                        duration: finalDuration,
                                        points: tierPoints[tier] || 0,
                                        warPoints: 0, // Calculated on selection based on completion date
                                        tier,
                                        sprite_rect: node.sprite_rect
                                    });
                                }
                            }
                        }
                    }
                });
            });

            if (possibleUpgrades.length === 0) break;

            // Sort by efficiency (Points / Duration)
            possibleUpgrades.sort((a, b) => (b.points / (b.duration || 1)) - (a.points / (a.duration || 1)));

            // Find first one that fits budget (Potions, Gems, and Time)
            const best = possibleUpgrades.find(upg => {
                // Check Potion Cost
                if (upg.cost > potionsRemaining) return false;

                // Check Time + Gem Cost
                const startTimeSec = accumulatedTimeSeconds;
                const endTimeSec = startTimeSec + upg.duration;
                let neededGems = 0;

                if (endTimeSec > baseTimeLimitSeconds) {
                    // If no gems allowed, this node doesn't fit
                    if (gemLimit <= 0) return false;
                    
                    const overlap = Math.min(upg.duration, endTimeSec - Math.max(startTimeSec, baseTimeLimitSeconds));
                    if (overlap > 0) {
                        neededGems = Math.ceil(overlap * gemCostPerSecond);
                    }
                }

                if (neededGems > (gemLimit - accumulatedGemCost)) return false;

                return true;
            });

            if (best) {
                // Re-calculate gem cost to attach
                const startTimeSec = accumulatedTimeSeconds;
                const endTimeSec = startTimeSec + best.duration;
                let gemCost = 0;
                if (endTimeSec > baseTimeLimitSeconds) {
                    const overlap = Math.min(best.duration, endTimeSec - Math.max(startTimeSec, baseTimeLimitSeconds));
                    if (overlap > 0) {
                        gemCost = Math.ceil(overlap * gemCostPerSecond);
                    }
                }

                // Calculate completion date for war point check
                const endDate = new Date(planStartMs + endTimeSec * 1000);
                const isWar = isWarPointDay(endDate, 'tech');
                const warPts = isWar ? best.points : 0;

                actions.push({ ...best, gemCost, warPoints: warPts, isWarDay: isWar, endDate });

                totalPoints += best.points;
                totalWarPoints += warPts;
                potionsRemaining -= best.cost;
                accumulatedTimeSeconds += best.duration;
                accumulatedGemCost += gemCost;

                // Update virtual tree
                if (!currentTree[best.tree]) currentTree[best.tree] = {};
                currentTree[best.tree][best.nodeId] = best.toLevel;
            } else {
                // No upgrades fit our remaining resources
                break;
            }
        }

        // Calculate total time used
        const usedSeconds = accumulatedTimeSeconds;
        const gemTimeSeconds = Math.max(0, usedSeconds - baseTimeLimitSeconds);
        const baseTimeSeconds = Math.min(usedSeconds, baseTimeLimitSeconds);

        return {
            totalPoints,
            totalWarPoints,
            actions,
            timeUsed: usedSeconds / 3600,
            baseTimeUsed: baseTimeSeconds / 3600,
            gemTimeUsed: gemTimeSeconds / 3600,
            potionsUsed: potions - potionsRemaining,
            remainingPotions: potionsRemaining,
            finalBonuses: calculateTechBonuses(currentTree),
            totalGemsUsed: accumulatedGemCost
        };

    }, [mapping, library, upgradeLibrary, dayConfig, treeMode, profile.techTree, timeLimitHours, potions, forgeConfig, profile.misc.gemCount, profile.misc.useGemsInCalculators]);

    const applyUpgrades = (selectedActions: TechUpgrade[]) => {
        if (selectedActions.length === 0) return;

        const newTree = {
            Forge: { ...profile.techTree.Forge },
            Power: { ...profile.techTree.Power },
            SkillsPetTech: { ...profile.techTree.SkillsPetTech }
        };

        let totalCost = 0;
        selectedActions.forEach(action => {
            if (!newTree[action.tree as keyof typeof newTree]) {
                newTree[action.tree as keyof typeof newTree] = {};
            }
            newTree[action.tree as keyof typeof newTree][action.nodeId] = action.toLevel;
            totalCost += action.cost;
        });

        updateProfile({
            techTree: newTree,
            misc: {
                ...profile.misc,
                techPotions: Math.max(0, potions - totalCost)
            }
        });

        // Update local potions state to match new profile value
        setPotions(Math.max(0, potions - totalCost));
    };

    return {
        timeLimitHours, setTimeLimitHours,
        potions, setPotions,
        optimization,
        applyUpgrades,
        gemSkipCostPerSecond
    };
}
