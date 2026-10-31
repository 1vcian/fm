import type { UserProfile } from '../types/Profile';
import type { LibraryData } from './statEngine';
import type { TreeMode } from '../context/TreeModeContext';

/**
 * The profile with its tech tree replaced according to the header's tree mode
 * ('my' keeps the profile tree, 'empty' zeroes every node, 'max' maxes every node).
 * Pure so every stat consumer (useGlobalStats, useLoadoutSweep) builds the exact same input.
 */
export function applyTreeMode(profile: UserProfile, treeMode: TreeMode, libs: LibraryData): UserProfile {
    if (treeMode === 'my') {
        return profile;
    }

    if (treeMode === 'empty') {
        // Empty tree: all nodes at 0
        return {
            ...profile,
            techTree: {
                Forge: {},
                Power: {},
                SkillsPetTech: {},
                Clan: {}
            }
        };
    }

    const { techTreeLibrary, techTreePositionLibrary, guildTechTreePositionLibrary: guildPositionLibrary, guildTechTreeUpgradeLibrary: guildUpgradeLibrary } = libs as any;

    // Max tree: all nodes at max level, built from techTreePositionLibrary
    const maxTree: UserProfile['techTree'] = {
        Forge: {},
        Power: {},
        SkillsPetTech: {},
        Clan: {}
    };

    if (techTreePositionLibrary && techTreeLibrary) {
        const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];
        for (const tree of trees) {
            const treeData = techTreePositionLibrary[tree];
            if (treeData?.Nodes) {
                for (const node of treeData.Nodes) {
                    const nodeData = techTreeLibrary[node.Type];
                    const maxLevel = nodeData?.MaxLevel ?? 0;
                    maxTree[tree][node.Id] = maxLevel;
                }
            }
        }
    }

    if (guildPositionLibrary && guildUpgradeLibrary) {
        const nodesList: string[] = [];
        for (const cat of Object.keys(guildPositionLibrary)) {
            if (guildPositionLibrary[cat]?.Nodes) {
                nodesList.push(...guildPositionLibrary[cat].Nodes);
            }
        }
        nodesList.forEach((type, idx) => {
            maxTree.Clan[idx] = guildUpgradeLibrary[type]?.MaxLevel ?? 0;
        });
    }

    return {
        ...profile,
        techTree: maxTree
    };
}
