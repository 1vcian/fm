import { useState, useMemo, useCallback, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { getWarDayIndex } from '../utils/guildWarUtils';
import { calculateStats, LibraryData } from '../utils/statEngine';
import { UserProfile } from '../types/Profile';

export interface PlanStep {
    id: string;
    type: 'node' | 'delay';
    tree?: string;
    nodeId?: number;
    nodeType?: string;
    delayMinutes?: number;
}

export interface ScheduleEntry {
    step: PlanStep;
    index: number;
    // For nodes:
    nodeName: string;
    tier: number;
    fromLevel: number;
    toLevel: number;
    duration: number; // seconds
    potionCost: number;
    points: number;
    sprite_rect?: { x: number; y: number; width: number; height: number };
    // For delays:
    delaySeconds: number;
    // Cumulative:
    cumulativeStartSeconds: number;
    cumulativeEndSeconds: number;
    startDate: Date;
    endDate: Date;
    // Validation:
    isInvalid: boolean;
    // DPS impact:
    dpsImpactPercent: number;
    startDps: number;
    endDps: number;
    isWarDay: boolean;
}

export interface AvailableNode {
    tree: string;
    nodeId: number;
    nodeType: string;
    nodeName: string;
    tier: number;
    currentLevel: number;
    nextLevel: number;
    maxLevel: number;
    duration: number;
    potionCost: number;
    points: number;
    sprite_rect?: { x: number; y: number; width: number; height: number };
}

export function useTreePlanner() {
    const { profile, updateProfile, updateNestedProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // Data
    const { data: mapping } = useGameData<any>('TechTreeMapping.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: upgradeLibrary } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: dayConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');

    // Additional data for StatEngine
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    const libs: LibraryData = useMemo(() => ({
        petUpgradeLibrary, petBalancingLibrary, petLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
        skinsLibrary, setsLibrary, ascensionConfigsLibrary
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
        skinsLibrary, setsLibrary, ascensionConfigsLibrary
    ]);



    // Helpers
    const generateId = () => Math.random().toString(36).substr(2, 9);

    // State
    const [planQueue, setPlanQueue] = useState<PlanStep[]>(() => {
        const queue = (profile.misc.techPlanQueue || []) as any[];
        return queue.map(step => ({
            id: step.id || generateId(),
            ...step
        })) as PlanStep[];
    });
    const [planStartDate, setPlanStartDate] = useState<string>(() => {
        if (profile.misc.techPlanStartDate) return profile.misc.techPlanStartDate;
        const now = new Date();
        now.setSeconds(0, 0);
        const tzOffset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    });

    // Persist to profile
    useEffect(() => {
        updateNestedProfile('misc', { techPlanQueue: planQueue, techPlanStartDate: planStartDate });
    }, [planQueue, planStartDate]);

    // Tier -> War Points
    const tierPoints = useMemo(() => {
        const points: Record<number, number> = { 0: 300, 1: 7500, 2: 20000, 3: 35000, 4: 62000 };
        if (dayConfig) {
            const taskToTier: Record<string, number> = {
                'FinishITechTreeUpgrade': 0, 'FinishIITechTreeUpgrade': 1,
                'FinishIIITechTreeUpgrade': 2, 'FinishIVTechTreeUpgrade': 3,
                'FinishVTechTreeUpgrade': 4
            };
            Object.values(dayConfig).forEach((dayData: any) => {
                dayData.Tasks?.forEach((task: any) => {
                    const tier = taskToTier[task.Task];
                    if (tier !== undefined) {
                        const amount = task.Rewards?.find((r: any) => r.$type === "WarPointsReward")?.Amount;
                        if (amount) points[tier] = amount;
                    }
                });
            });
        }
        return points;
    }, [dayConfig]);

    // War Point Days: which GW days give war points for tech upgrades
    const warPointDays = useMemo((): number[] => {
        if (!dayConfig) return [0, 3]; // defaults
        const days: number[] = [];
        const taskToTier: Record<string, number> = {
            'FinishITechTreeUpgrade': 0, 'FinishIITechTreeUpgrade': 1,
            'FinishIIITechTreeUpgrade': 2, 'FinishIVTechTreeUpgrade': 3,
            'FinishVTechTreeUpgrade': 4
        };
        Object.entries(dayConfig).forEach(([dayKey, dayData]: [string, any]) => {
            const hasTechTask = dayData.Tasks?.some((task: any) => taskToTier[task.Task] !== undefined);
            if (hasTechTask) days.push(Number(dayKey));
        });
        return days;
    }, [dayConfig]);

    // Tech Bonuses
    const calculateTechBonuses = useCallback((tree: Record<string, Record<number, number>>) => {
        let costReduction = 0;
        let speedBonus = 0;

        Object.entries(tree).forEach(([treeName, treeNodes]) => {
            const treeDef = mapping?.trees?.[treeName];
            if (!treeDef?.nodes) return;
            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                if (nodeType !== 'TechNodeUpgradeCost' && nodeType !== 'TechResearchTimer') return;
                const nodeConfig = techTreeLibrary?.[nodeType];
                if (!nodeConfig) return;
                const nodeLevel = treeNodes[node.id] || 0;
                if (nodeLevel > 0 && nodeConfig.Stats?.[0]) {
                    const stat = nodeConfig.Stats[0];
                    const val = stat.Value + ((nodeLevel - 1) * stat.ValueIncrease);
                    if (nodeType === 'TechNodeUpgradeCost') costReduction += val;
                    else if (nodeType === 'TechResearchTimer') speedBonus += val;
                }
            });
        });

        return { costReduction: Math.min(0.95, costReduction), speedBonus };
    }, [mapping, techTreeLibrary]);

    // Calculate the schedule from the queue
    const schedule = useMemo((): ScheduleEntry[] => {
        if (!mapping || !techTreeLibrary || !upgradeLibrary || !planQueue.length) return [];

        const startMs = new Date(planStartDate).getTime();
        if (isNaN(startMs)) return [];

        // Build current tree state based on profile (or empty for 'empty' mode)
        const virtualTree: UserProfile['techTree'] = {
            Forge: { ...(treeMode === 'empty' ? {} : profile.techTree.Forge) },
            Power: { ...(treeMode === 'empty' ? {} : profile.techTree.Power) },
            SkillsPetTech: { ...(treeMode === 'empty' ? {} : profile.techTree.SkillsPetTech) }
        };

        // Simulated profile for real-time DPS tracking
        let simProfile: UserProfile = JSON.parse(JSON.stringify(profile));
        simProfile.techTree = virtualTree;

        const canSimDps = libs.itemBalancingConfig && libs.itemBalancingLibrary;
        const initialPotions = profile.misc.techPotions || 0;
        const hasBudgetLimit = initialPotions > 0;
        let runningPotions = initialPotions;
        let cumulativeSeconds = 0;
        const entries: ScheduleEntry[] = [];

        for (let i = 0; i < planQueue.length; i++) {
            const step = planQueue[i];

            if (step.type === 'delay') {
                const delaySec = (step.delayMinutes || 0) * 60;
                const startDate = new Date(startMs + cumulativeSeconds * 1000);
                const endDate = new Date(startMs + (cumulativeSeconds + delaySec) * 1000);

                entries.push({
                    step, index: i, nodeName: 'Delay', tier: 0, fromLevel: 0, toLevel: 0,
                    duration: 0, potionCost: 0, points: 0, delaySeconds: delaySec,
                    cumulativeStartSeconds: cumulativeSeconds, 
                    cumulativeEndSeconds: cumulativeSeconds + delaySec,
                    startDate, endDate,
                    isInvalid: false, dpsImpactPercent: 0, startDps: 0, endDps: 0,
                    isWarDay: warPointDays.includes(getWarDayIndex(endDate))
                });

                cumulativeSeconds += delaySec;
                continue;
            }

            // Node step
            if (!step.tree || step.nodeId === undefined) {
                entries.push({
                    step, index: i, nodeName: 'Unknown', tier: 0, fromLevel: 0, toLevel: 0,
                    duration: 0, potionCost: 0, points: 0, delaySeconds: 0,
                    cumulativeStartSeconds: cumulativeSeconds, cumulativeEndSeconds: cumulativeSeconds,
                    startDate: new Date(startMs + cumulativeSeconds * 1000),
                    endDate: new Date(startMs + cumulativeSeconds * 1000),
                    isInvalid: true, dpsImpactPercent: 0, startDps: 0, endDps: 0,
                    isWarDay: false
                });
                continue;
            }

            const treeName = step.tree as keyof UserProfile['techTree'];
            const treeDef = mapping.trees?.[treeName];
            const nodeDetails = treeDef?.nodes?.find((n: any) => n.id === step.nodeId);
            if (!nodeDetails) {
                entries.push({
                    step, index: i, nodeName: 'Unknown Node', tier: 0, fromLevel: 0, toLevel: 0,
                    duration: 0, potionCost: 0, points: 0, delaySeconds: 0,
                    cumulativeStartSeconds: cumulativeSeconds, cumulativeEndSeconds: cumulativeSeconds,
                    startDate: new Date(startMs + cumulativeSeconds * 1000),
                    endDate: new Date(startMs + cumulativeSeconds * 1000),
                    isInvalid: true, dpsImpactPercent: 0, startDps: 0, endDps: 0,
                    isWarDay: false
                });
                continue;
            }

            const nodeConfig = techTreeLibrary[step.nodeType!];
            const maxLvl = nodeConfig?.MaxLevel || 5;
            const currentLvl = (virtualTree as any)[treeName!]?.[step.nodeId!] || 0;

            // Check prerequisites
            const reqsMet = (nodeDetails.requirements || []).every((reqId: number) => {
                return ((virtualTree as any)[treeName!]?.[reqId] || 0) >= 1;
            });

            const bonuses = calculateTechBonuses(virtualTree);
            const tier = nodeDetails.tier || 0;
            const upgradeData = upgradeLibrary[tier.toString()];
            const levelData = upgradeData?.Levels?.find((l: any) => l.Level === currentLvl);

            const finalCost = levelData ? Math.ceil(levelData.Cost * (1 - bonuses.costReduction)) : 0;
            const finalDuration = levelData ? Math.ceil(levelData.Duration / (1 + bonuses.speedBonus)) : 0;
            const pts = tierPoints[tier] || 0;

            // Cost validation: if hasBudgetLimit, must have enough runningPotions
            const isCostInvalid = hasBudgetLimit && finalCost > runningPotions;
            const isInvalid = currentLvl >= maxLvl || !reqsMet || isCostInvalid;

            // Real DPS Calculation
            let startDps = 0;
            let endDps = 0;
            let dpsImpact = 0;

            if (canSimDps && !isInvalid) {
                const resultsBefore = calculateStats(simProfile, libs);
                startDps = resultsBefore?.realTotalDps || 0;

                // Update virtual tree for NEXT step AND for this step's "After" calculation
                if (step.tree) {
                    const treeName = step.tree as keyof UserProfile['techTree'];
                    if (!virtualTree[treeName]) virtualTree[treeName] = {} as any;
                    virtualTree[treeName][step.nodeId!] = currentLvl + 1;
                    simProfile.techTree = virtualTree;
                }

                const resultsAfter = calculateStats(simProfile, libs);
                endDps = resultsAfter?.realTotalDps || 0;

                if (startDps > 0) {
                    dpsImpact = ((endDps / startDps) - 1) * 100;
                }
                
                // If valid, apply cost to budget
                if (hasBudgetLimit) runningPotions -= finalCost;
            } else {
                // If invalid or no sim, still update tree for progression calculation
                if (step.tree) {
                    const treeName = step.tree as keyof UserProfile['techTree'];
                    if (!virtualTree[treeName]) virtualTree[treeName] = {} as any;
                    virtualTree[treeName][step.nodeId!] = currentLvl + 1;
                    simProfile.techTree = virtualTree;
                }
                
                // Even if manually invalid but not cost invalid, we might want to subtract cost?
                // Usually, if it's red, it's not "done". So we DON'T subtract.
            }

            // Min wait logic
            let waitSec = 0;
            if (i > 0) {
                waitSec = (profile.misc.plannerMinWaitBetweenNodes || 1) * 60;
            }

            const startDate = new Date(startMs + (cumulativeSeconds + waitSec) * 1000);
            const endDate = new Date(startMs + (cumulativeSeconds + waitSec + finalDuration) * 1000);

            entries.push({
                step, index: i, nodeName: nodeDetails.name || nodeConfig?.Name || step.nodeType!,
                tier, fromLevel: currentLvl, toLevel: currentLvl + 1,
                duration: finalDuration, potionCost: finalCost, points: pts,
                delaySeconds: waitSec,
                cumulativeStartSeconds: cumulativeSeconds + waitSec,
                cumulativeEndSeconds: cumulativeSeconds + waitSec + finalDuration,
                startDate, endDate,
                sprite_rect: nodeDetails.sprite_rect,
                isInvalid,
                dpsImpactPercent: dpsImpact,
                startDps, endDps,
                isWarDay: warPointDays.includes(getWarDayIndex(endDate))
            });

            cumulativeSeconds += (waitSec + finalDuration);
        }

        return entries;
    }, [planQueue, planStartDate, mapping, techTreeLibrary, upgradeLibrary, treeMode, profile.techTree, profile.misc.techPotions || 0, profile.misc.plannerMinWaitBetweenNodes, tierPoints, calculateTechBonuses, libs]);

    // Summary stats
    const summary = useMemo(() => {
        const valid = schedule.filter(e => !e.isInvalid);
        return {
            totalTime: valid.reduce((s, e) => s + e.duration + e.delaySeconds, 0),
            totalPotions: valid.reduce((s, e) => s + e.potionCost, 0),
            totalPoints: valid.reduce((s, e) => s + e.points, 0),
            totalWarPoints: valid.reduce((s, e) => s + (e.isWarDay ? e.points : 0), 0),
            invalidCount: schedule.filter(e => e.isInvalid).length,
            completionDate: schedule.length > 0 ? schedule[schedule.length - 1].endDate : new Date(planStartDate)
        };
    }, [schedule, planStartDate]);

    // Available nodes to add (at end of current queue)
    const availableNodes = useMemo((): AvailableNode[] => {
        if (!mapping || !techTreeLibrary || !upgradeLibrary) return [];

        // Build the final tree state after all queue entries
        const virtualTree: UserProfile['techTree'] = {
            Forge: { ...(treeMode === 'empty' ? {} : profile.techTree.Forge) },
            Power: { ...(treeMode === 'empty' ? {} : profile.techTree.Power) },
            SkillsPetTech: { ...(treeMode === 'empty' ? {} : profile.techTree.SkillsPetTech) }
        };

        // Apply queue
        for (const step of planQueue) {
            if (step.type === 'node' && step.tree && step.nodeId !== undefined) {
                const tKey = step.tree as keyof UserProfile['techTree'];
                if (!(virtualTree as any)[tKey]) (virtualTree as any)[tKey] = {};
                (virtualTree as any)[tKey][step.nodeId] = ((virtualTree as any)[tKey][step.nodeId] || 0) + 1;
            }
        }

        const bonuses = calculateTechBonuses(virtualTree);
        const nodes: AvailableNode[] = [];

        Object.entries(mapping.trees || {}).forEach(([treeName, treeDef]: [string, any]) => {
            const tKey = treeName as keyof UserProfile['techTree'];
            treeDef.nodes.forEach((node: any) => {
                const currentLvl = (virtualTree as any)[tKey]?.[node.id] || 0;
                const nodeType = node.type;
                const nodeConfig = techTreeLibrary[nodeType];
                const maxLvl = nodeConfig?.MaxLevel || 0;

                if (currentLvl < maxLvl) {
                    const reqsMet = (node.requirements || []).every((reqId: number) => {
                        return ((virtualTree as any)[tKey]?.[reqId] || 0) >= 1;
                    });

                    if (reqsMet) {
                        const tier = node.tier || 0;
                        const upgradeData = upgradeLibrary[tier.toString()];
                        const levelData = upgradeData?.Levels?.find((l: any) => l.Level === currentLvl);
                        if (!levelData) return;

                        const finalCost = Math.ceil(levelData.Cost * (1 - bonuses.costReduction));
                        const finalDuration = Math.ceil(levelData.Duration / (1 + bonuses.speedBonus));

                        nodes.push({
                            tree: treeName,
                            nodeId: node.id,
                            nodeType,
                            nodeName: nodeType,
                            tier,
                            currentLevel: currentLvl,
                            nextLevel: currentLvl + 1,
                            maxLevel: maxLvl,
                            duration: finalDuration,
                            potionCost: finalCost,
                            points: tierPoints[tier] || 0,
                            sprite_rect: node.sprite_rect
                        });
                    }
                }
            });
        });

        return nodes;
    }, [mapping, techTreeLibrary, upgradeLibrary, planQueue, treeMode, profile.techTree, tierPoints, calculateTechBonuses]);
    
    // Total remaining node levels across all trees
    const totalRemainingNodes = useMemo(() => {
        if (!mapping || !techTreeLibrary) return 0;
        let total = 0;
        Object.entries(mapping.trees || {}).forEach(([treeName, treeDef]: [string, any]) => {
            treeDef.nodes.forEach((node: any) => {
                const nodeConfig = techTreeLibrary[node.type];
                if (!nodeConfig) return;
                const currentLvl = profile.techTree[treeName as keyof UserProfile['techTree']]?.[node.id] || 0;
                total += Math.max(0, nodeConfig.MaxLevel - currentLvl);
            });
        });
        return total;
    }, [mapping, techTreeLibrary, profile.techTree]);

    // DPS-related node types for auto-planner scoring
    const DPS_NODE_TYPES = useMemo(() => new Set([
        'WeaponBonus', 'GloveBonus', 'NecklaceBonus', 'RingBonus',
        'HelmetBonus', 'BodyBonus', 'BeltBonus', 'ShoeBonus',
        'WeaponLevelUp', 'GloveLevelUp', 'NecklaceLevelUp', 'RingLevelUp',
        'HelmetLevelUp', 'BodyLevelUp', 'BeltLevelUp', 'ShoeLevelUp',
        'PetBonusDamage', 'PetBonusHealth', 'MountDamage', 'MountHealth',
        'SkillDamage', 'SkillPassiveDamage', 'SkillPassiveHealth',
    ]), []);

    const SPEED_NODE_TYPES = useMemo(() => new Set([
        'TechResearchTimer', 'TechNodeUpgradeCost',
    ]), []);

    // Auto-Planner Helpers
    const isSleepTime = (date: Date, sleepStart: string, sleepEnd: string) => {
        const h = date.getHours();
        const m = date.getMinutes();
        const timeVal = h * 60 + m;

        const [startH, startM] = sleepStart.split(':').map(Number);
        const [endH, endM] = sleepEnd.split(':').map(Number);
        const startVal = startH * 60 + startM;
        const endVal = endH * 60 + endM;

        if (startVal < endVal) {
            return timeVal >= startVal && timeVal <= endVal;
        } else {
            // Overnights (e.g. 23:00 to 07:00)
            return timeVal >= startVal || timeVal <= endVal;
        }
    };

    const getSleepOverlapMinutes = (start: Date, end: Date, sleepStart: string, sleepEnd: string) => {
        let overlap = 0;
        let curr = new Date(start.getTime());
        // Simple approximation: check every 30 mins
        const step = 30;
        while (curr < end) {
            if (isSleepTime(curr, sleepStart, sleepEnd)) {
                overlap += step;
            }
            curr = new Date(curr.getTime() + step * 60 * 1000);
        }
        return Math.min(overlap, (end.getTime() - start.getTime()) / 60000);
    };

    // Auto-Planner: generates an optimized plan queue
    const autoPlan = useCallback((
        priorities: Set<string>,
        maxSteps: number = 200,
        potionBudget?: number,
        sleepStart: string = profile.misc.plannerSleepStart || '23:00',
        sleepEnd: string = profile.misc.plannerSleepEnd || '07:00',
        maxWaitMinutes: number = profile.misc.plannerMaxWait || 120,
        minWaitMinutes: number = profile.misc.plannerMinWaitBetweenNodes || 1,
        allowedTrees: string[] = ['Forge', 'Power', 'SkillsPetTech']
    ) => {
        if (!mapping || !techTreeLibrary || !upgradeLibrary) return;

        const budget = potionBudget ?? Infinity;
        const startMs = new Date(planStartDate).getTime();
        const onlyTime = priorities.size === 1 && priorities.has('time');

        // Build virtual tree from profile
        const virtualTree: UserProfile['techTree'] = {
            Forge: { ...(treeMode === 'empty' ? {} : profile.techTree.Forge) },
            Power: { ...(treeMode === 'empty' ? {} : profile.techTree.Power) },
            SkillsPetTech: { ...(treeMode === 'empty' ? {} : profile.techTree.SkillsPetTech) }
        };

        const newQueue: PlanStep[] = [];
        let totalPotions = 0;
        let iter = 0;
        let simClockMs = startMs;

        // --- PRE-CALCULATE INHERITED POTENTIAL ---
        // Build dependency map (children of each node) and base scores
        const childrenMap: Record<string, Record<number, number[]>> = {};
        const nodeBaseScores: Record<string, Record<number, number>> = {};
        
        Object.entries(mapping.trees || {})
            .filter(([name]) => allowedTrees.includes(name))
            .forEach(([treeName, treeDef]: [string, any]) => {
            childrenMap[treeName] = {};
            nodeBaseScores[treeName] = {};
            treeDef.nodes.forEach((node: any) => {
                const nodeType = node.type;
                
                let bScore = 0;
                if (priorities.has('dps') && DPS_NODE_TYPES.has(nodeType)) bScore += 5000;
                if (priorities.has('speed') && SPEED_NODE_TYPES.has(nodeType)) bScore += 5000;
                if (priorities.has('time')) {
                    if (nodeType === 'TechResearchTimer') bScore += 10000;
                    else if (SPEED_NODE_TYPES.has(nodeType)) bScore += 5000;
                }
                if (priorities.has('war_points')) bScore += (tierPoints[node.tier] || 0) / 10;
                
                nodeBaseScores[treeName][node.id] = bScore;
                (node.requirements || []).forEach((reqId: number) => {
                    if (!childrenMap[treeName][reqId]) childrenMap[treeName][reqId] = [];
                    childrenMap[treeName][reqId].push(node.id);
                });
            });
        });

        const potentialCache: Record<string, Record<number, number>> = {};
        const getPotential = (tree: string, nid: number): number => {
            if (potentialCache[tree]?.[nid] !== undefined) return potentialCache[tree][nid];
            if (!potentialCache[tree]) potentialCache[tree] = {};
            
            let p = nodeBaseScores[tree][nid] || 0;
            const children = childrenMap[tree][nid] || [];
            // Recursively add child potential (descending factor)
            children.forEach(childId => {
                p += getPotential(tree, childId) * 0.4; // 40% inheritance factor
            });
            
            potentialCache[tree][nid] = p;
            return p;
        };

        const inheritedPotential: Record<string, Record<number, number>> = {};
        Object.keys(nodeBaseScores).forEach(tree => {
            inheritedPotential[tree] = {};
            Object.keys(nodeBaseScores[tree]).forEach(nid => {
                const id = Number(nid);
                inheritedPotential[tree][id] = getPotential(tree, id);
            });
        });
        // ------------------------------------------

        while (iter < maxSteps) {
            iter++;

            const bonuses = calculateTechBonuses(virtualTree);
            const candidates: {
                step: PlanStep;
                score: number;
                cost: number;
                nodeId: number;
                tree: string;
                delayMinutes: number;
                finishTime: Date;
            }[] = [];

            Object.entries(mapping.trees || {})
                .filter(([name]) => allowedTrees.includes(name))
                .forEach(([treeName, treeDef]: [string, any]) => {
                treeDef.nodes.forEach((node: any) => {
                    const tKey = treeName as keyof UserProfile['techTree'];
                    const currentLvl = (virtualTree as any)[tKey]?.[node.id] || 0;
                    const nodeType = node.type;
                    const nodeConfig = techTreeLibrary[nodeType];
                    const maxLvl = nodeConfig?.MaxLevel || 0;

                    if (currentLvl >= maxLvl) return;

                    const reqsMet = (node.requirements || []).every((reqId: number) => {
                        return ((virtualTree as any)[treeName!]?.[reqId] || 0) >= 1;
                    });
                    if (!reqsMet) return;

                    const tier = node.tier || 0;
                    const upgradeData = upgradeLibrary[tier.toString()];
                    const levelData = upgradeData?.Levels?.find((l: any) => l.Level === currentLvl);
                    if (!levelData) return;

                    const finalCost = Math.ceil(levelData.Cost * (1 - bonuses.costReduction));
                    const finalDuration = Math.max(1, Math.ceil(levelData.Duration / (1 + bonuses.speedBonus)));

                    if (totalPotions + finalCost > budget) return;

                    const pts = tierPoints[tier] || 0;

                    // Evaluate potential delays (MaxWait alignment)
                    // We check if delaying allows landing on a War Point Day
                    let bestDelay = 0;
                    let finishTime = new Date(simClockMs + finalDuration * 1000);

                    // War Points Optimization: Check if adding delay puts finishTime in a War Day
                    const checkWarDay = (date: Date) => {
                        const dayInWeek = getWarDayIndex(date);
                        return warPointDays.includes(dayInWeek);
                    };

                    if (priorities.has('war_points') && !checkWarDay(finishTime)) {
                        // See if we can delay to next war day start (00:00)
                        const nextWarDayStart = new Date(finishTime);
                        nextWarDayStart.setHours(0, 0, 0, 0);
                        // This is crude, find the actual next war day
                        for (let d = 1; d <= 7; d++) {
                            const test = new Date(finishTime.getTime() + d * 86400000);
                            test.setHours(0, 0, 0, 0);
                            if (checkWarDay(test)) {
                                const delayNeeded = (test.getTime() - finishTime.getTime()) / 60000;
                                if (delayNeeded > 0 && delayNeeded <= maxWaitMinutes) {
                                    bestDelay = delayNeeded;
                                    finishTime = test;
                                }
                                break;
                            }
                        }
                    }

                    // General Alignment Enhancement: if we finish in sleep, maybe start earlier/later?
                    // But usually, more helpful to delay a node so it starts AFTER waking up if it's very short,
                    // or delay a long node so it spans the sleep window and finishes as we wake up.
                    if (bestDelay === 0 && !onlyTime && isSleepTime(finishTime, sleepStart, sleepEnd)) {
                        // If it finishes mid-sleep, see if delaying slightly finishes it closer to awake time
                        const [endH, endM] = sleepEnd.split(':').map(Number);
                        const wakeTime = new Date(finishTime);
                        wakeTime.setHours(endH, endM, 0, 0);
                        if (finishTime > wakeTime) wakeTime.setDate(wakeTime.getDate() + 1);

                        const delayToWake = (wakeTime.getTime() - finishTime.getTime()) / 60000;
                        if (delayToWake > 0 && delayToWake <= maxWaitMinutes) {
                            bestDelay = delayToWake;
                            finishTime = wakeTime;
                        }
                    }

                    if (onlyTime) {
                        bestDelay = 0;
                        finishTime = new Date(simClockMs + finalDuration * 1000);
                    }

                    // Score based on priorities
                    let score = 0;
                    const durationMins = finalDuration / 60;

                    if (priorities.has('war_points')) {
                        const isWar = checkWarDay(finishTime);
                        if (isWar) score += 5000; // Large bonus for war landing
                        score += (pts / durationMins) * 100;
                    }

                    if (priorities.has('dps')) {
                        if (DPS_NODE_TYPES.has(nodeType)) {
                            score += 2000;
                            const statWeight = (nodeConfig.Stats?.[0]?.Value || 0.01) * 1000;
                            score += statWeight / (durationMins / 60);
                        }
                    }

                    if (priorities.has('speed')) {
                        if (SPEED_NODE_TYPES.has(nodeType)) {
                            score += 10000; // Research speed always massive
                        }
                    }

                    if (priorities.has('time')) {
                        // Greedy approach: prioritize nodes that reduce future research time
                        if (nodeType === 'TechResearchTimer') {
                            score += 50000; // Massively prioritize research speed
                        } else if (SPEED_NODE_TYPES.has(nodeType)) {
                            score += 15000; // Prioritize cost reductions too
                        }
                        
                        // Favor short, efficient nodes
                        score += 5000 / (durationMins || 1);
                    }

                    // Sleep efficiency: Prefer nodes that overlap more with sleep
                    const sleepOverlap = getSleepOverlapMinutes(new Date(simClockMs + bestDelay * 60000), finishTime, sleepStart, sleepEnd);
                    if (sleepOverlap > 0) {
                        score += (sleepOverlap / durationMins) * 1000;
                    }

                    // Inherited potential bonus (guides planner through prerequisites)
                    score += (inheritedPotential[treeName]?.[node.id] || 0);

                    // Penalty for waiting (delay)
                    score -= bestDelay * 2;

                    candidates.push({
                        step: { id: generateId(), type: 'node', tree: treeName, nodeId: node.id, nodeType },
                        score,
                        cost: finalCost,
                        nodeId: node.id,
                        tree: treeName,
                        delayMinutes: bestDelay,
                        finishTime
                    });
                });
            });

            if (candidates.length === 0) break;

            // Pick best candidate
            candidates.sort((a, b) => b.score - a.score);
            const best = candidates[0];

            if (best.delayMinutes > 0) {
                newQueue.push({ id: generateId(), type: 'delay', delayMinutes: best.delayMinutes });
                simClockMs += best.delayMinutes * 60 * 1000;
            }

            newQueue.push(best.step);
            totalPotions += best.cost;
            
            // Advance clock by node duration + minWait
            simClockMs = best.finishTime.getTime() + (minWaitMinutes * 60000);

            // Update virtual tree
            if (best.tree) {
                const bKey = best.tree as keyof UserProfile['techTree'];
                if (!(virtualTree as any)[bKey]) (virtualTree as any)[bKey] = {};
                (virtualTree as any)[bKey][best.nodeId] = ((virtualTree as any)[bKey][best.nodeId] || 0) + 1;
            }
        }

        setPlanQueue(newQueue);
    }, [mapping, techTreeLibrary, upgradeLibrary, treeMode, profile.techTree, profile.misc, tierPoints, calculateTechBonuses, warPointDays, DPS_NODE_TYPES, SPEED_NODE_TYPES, planStartDate, isSleepTime, updateProfile]);

    // Actions
    const addStep = useCallback((node: AvailableNode, position?: number) => {
        const step: PlanStep = { id: generateId(), type: 'node', tree: node.tree, nodeId: node.nodeId, nodeType: node.nodeType };
        setPlanQueue(prev => {
            const next = [...prev];
            if (position !== undefined) next.splice(position, 0, step);
            else next.push(step);
            return next;
        });
    }, []);

    const removeStep = useCallback((index: number) => {
        setPlanQueue(prev => prev.filter((_, i) => i !== index));
    }, []);

    const addDelay = useCallback((afterIndex: number, minutes: number) => {
        const step: PlanStep = { id: generateId(), type: 'delay', delayMinutes: minutes };
        setPlanQueue(prev => {
            const next = [...prev];
            next.splice(afterIndex + 1, 0, step);
            return next;
        });
    }, []);

    const moveStep = useCallback((from: number, to: number) => {
        setPlanQueue(prev => {
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
        });
    }, []);

    const clearQueue = useCallback(() => {
        setPlanQueue([]);
    }, []);

    const markDone = useCallback((upToIndex: number) => {
        // Apply all node steps up to index to profile
        const newTree = {
            Forge: { ...profile.techTree.Forge },
            Power: { ...profile.techTree.Power },
            SkillsPetTech: { ...profile.techTree.SkillsPetTech }
        };

        let totalPotionCost = 0;

        for (let i = 0; i <= upToIndex; i++) {
            const entry = schedule[i];
            if (!entry || entry.isInvalid) continue;
            if (entry.step.type === 'node' && entry.step.tree && entry.step.nodeId !== undefined) {
                const treeName = entry.step.tree as keyof typeof newTree;
                if (!newTree[treeName]) (newTree as any)[treeName] = {};
                newTree[treeName][entry.step.nodeId] = entry.toLevel;
                totalPotionCost += entry.potionCost;
            }
        }

        updateProfile({
            techTree: newTree,
            misc: {
                ...profile.misc,
                techPotions: Math.max(0, (profile.misc.techPotions || 0) - totalPotionCost)
            }
        });

        // Update start date to the completion time of the last done step
        const lastEntry = schedule[upToIndex];
        if (lastEntry) {
            const tzOffset = lastEntry.endDate.getTimezoneOffset() * 60000;
            const newStart = new Date(lastEntry.endDate.getTime() - tzOffset).toISOString().slice(0, 16);
            setPlanStartDate(newStart);
        }

        // Remove completed steps from queue
        setPlanQueue(prev => prev.slice(upToIndex + 1));
    }, [schedule, profile, updateProfile]);

    return {
        planQueue,
        setPlanQueue,
        planStartDate,
        setPlanStartDate,
        schedule,
        summary,
        availableNodes,
        addStep,
        removeStep,
        addDelay,
        moveStep,
        clearQueue,
        markDone,
        autoPlan,
        warPointDays,
        tierPoints,
        totalRemainingNodes
    };
}

