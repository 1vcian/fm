/**
 * Tech tree modifier hooks for the profile panels (personal + clan, and clan alone).
 * The full stat pipeline lives in utils/statEngine.ts.
 */

import { mergeClanModifiers, clanNodeValueAtLevel } from '../utils/clanTechStacking';
import { useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { useGameData } from './useGameData';

interface TechModifiers {
    [key: string]: number;
}

/**
 * Calculate tech tree modifiers based on current tree mode
 */
export function useTreeModifiers() {
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');

    return useMemo((): TechModifiers => {
        if (!techTreeLibrary || !techTreePositionLibrary) return {};

        const modifiers: TechModifiers = {};

        // Get effective tree levels based on mode
        const getTreeLevels = (tree: 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan'): Record<string, number> => {
            if (treeMode === 'empty') return {};

            if (tree === 'Clan') {
                if (!guildPositionLibrary || !guildUpgradeLibrary) return {};
                const nodesList: string[] = [];
                for (const cat of Object.keys(guildPositionLibrary)) {
                    if (guildPositionLibrary[cat]?.Nodes) {
                        nodesList.push(...guildPositionLibrary[cat].Nodes);
                    }
                }
                if (treeMode === 'max') {
                    const maxLevels: Record<string, number> = {};
                    nodesList.forEach((type, idx) => {
                        maxLevels[idx] = guildUpgradeLibrary[type]?.MaxLevel ?? 0;
                    });
                    return maxLevels;
                }
                return profile.techTree?.Clan || {};
            }

            const treeData = techTreePositionLibrary[tree];
            if (!treeData?.Nodes) return {};

            if (treeMode === 'max') {
                const maxLevels: Record<string, number> = {};
                for (const node of treeData.Nodes) {
                    const nodeData = techTreeLibrary[node.Type];
                    maxLevels[node.Id] = nodeData?.MaxLevel ?? 0;
                }
                return maxLevels;
            }

            // 'my' mode - use profile
            return profile.techTree[tree] || {};
        };

        const validityCache = new Map<number, boolean>();

        const checkNodeValidity = (
            treeData: any,
            levels: Record<string, number>,
            nodeId: number,
            visited: Set<number> = new Set()
        ): boolean => {
            if (validityCache.has(nodeId)) return validityCache.get(nodeId)!;

            // Prevent cycles
            if (visited.has(nodeId)) return false;

            // Check level > 0
            const level = levels[nodeId];
            if (!level || level <= 0) {
                validityCache.set(nodeId, false);
                return false;
            }

            // Check requirements
            const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
            if (!node) {
                validityCache.set(nodeId, false);
                return false;
            }

            visited.add(nodeId);

            if (node.Requirements && node.Requirements.length > 0) {
                for (const reqId of node.Requirements) {
                    // Recursive validity check
                    if (!checkNodeValidity(treeData, levels, reqId, visited)) {
                        visited.delete(nodeId);
                        validityCache.set(nodeId, false);
                        return false;
                    }
                }
            }

            visited.delete(nodeId);
            validityCache.set(nodeId, true);
            return true;
        };

        const trees: ('Forge' | 'Power' | 'SkillsPetTech' | 'Clan')[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];
        for (const tree of trees) {
            const treeLevels = getTreeLevels(tree);

            if (tree === 'Clan') {
                if (!guildPositionLibrary || !guildUpgradeLibrary) continue;
                const clanSums: Record<string, number> = {};

                // Flatten all nodes to index -> type mapping
                const nodesList: string[] = [];
                for (const cat of Object.keys(guildPositionLibrary)) {
                    if (guildPositionLibrary[cat]?.Nodes) {
                        nodesList.push(...guildPositionLibrary[cat].Nodes);
                    }
                }

                for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                    if (typeof level !== 'number' || level <= 0) continue;
                    const nodeId = parseInt(nodeIdStr);
                    const nodeType = nodesList[nodeId];
                    if (!nodeType) continue;

                    const upgradeDef = guildUpgradeLibrary[nodeType];
                    if (!upgradeDef) continue;

                    // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                    const totalVal = clanNodeValueAtLevel(upgradeDef, level);

                    clanSums[nodeType] = (clanSums[nodeType] || 0) + totalVal;
                }
                // Clan is the last tree, so the personal modifiers are complete here.
                mergeClanModifiers(modifiers, clanSums, techTreeLibrary);
                continue;
            }

            const treeData = techTreePositionLibrary[tree];
            if (!treeData?.Nodes) continue;

            const validNodes = new Set<number>();

            // Pre-calculate validity for all nodes in this tree
            // We can optimize by only checking nodes with level > 0
            validityCache.clear();

            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);

                // Skip validity check for 'max' mode (assume all nodes at max level are valid/accessible)
                // or if it's 'empty' (already handled by treeLevels being empty)
                if (treeMode === 'max' || checkNodeValidity(treeData, treeLevels, nodeId)) {
                    validNodes.add(nodeId);
                }
            }

            for (const nodeId of validNodes) {
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = techTreeLibrary[node.Type];
                if (!nodeData?.Stats) continue;

                const level = treeLevels[nodeId];
                const tier = node.Tier ?? 0;
                const tierStat = nodeData.StatsByTier?.[tier]?.[0];
                const baseVal = tierStat?.Value ?? nodeData.Stats[0]?.Value ?? 0;
                const increment = tierStat?.ValueIncrease ?? nodeData.Stats[0]?.ValueIncrease ?? 0;
                const totalVal = baseVal + (Math.max(0, level - 1) * increment);

                const key = node.Type;
                modifiers[key] = (modifiers[key] || 0) + totalVal;
            }
        }

        return modifiers;
    }, [profile, treeMode, techTreeLibrary, techTreePositionLibrary, guildPositionLibrary, guildUpgradeLibrary]);
}

/**
 * Clan-tree-only modifiers, keyed by node type. Same clan values that useTreeModifiers
 * folds into the combined map, exposed separately so stat hovers can show the clan tree as
 * its own x(1 + clan) factor (see utils/clanTechStacking.ts). Values follow
 * GuildTechTreeUpgradeLibrary.ValueAtLevel (clanNodeValueAtLevel), infinite levels included.
 */
export function useClanTreeModifiers() {
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');

    return useMemo((): TechModifiers => {
        const modifiers: TechModifiers = {};
        if (treeMode === 'empty' || !guildPositionLibrary || !guildUpgradeLibrary) return modifiers;

        const nodesList: string[] = [];
        for (const cat of Object.keys(guildPositionLibrary)) {
            if (guildPositionLibrary[cat]?.Nodes) nodesList.push(...guildPositionLibrary[cat].Nodes);
        }

        let levels: Record<string, number>;
        if (treeMode === 'max') {
            levels = {};
            nodesList.forEach((type, idx) => { levels[idx] = guildUpgradeLibrary[type]?.MaxLevel ?? 0; });
        } else {
            levels = profile.techTree?.Clan || {};
        }

        for (const [nodeIdStr, level] of Object.entries(levels)) {
            if (typeof level !== 'number' || level <= 0) continue;
            const nodeType = nodesList[parseInt(nodeIdStr)];
            if (!nodeType) continue;
            const upgradeDef = guildUpgradeLibrary[nodeType];
            if (!upgradeDef) continue;
            // ValuePerLevel already effective (x2 normalised at load, see useGameData)
            modifiers[nodeType] = (modifiers[nodeType] || 0) + clanNodeValueAtLevel(upgradeDef, level);
        }
        return modifiers;
    }, [profile, treeMode, guildPositionLibrary, guildUpgradeLibrary]);
}
