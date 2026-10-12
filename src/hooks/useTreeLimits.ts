import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { clanNodeValueAtLevel } from '../utils/clanTechStacking';

export interface TreeLimit {
    /** Highest value the trees can give (every node of that type at MaxLevel). 0 = no node grants it. */
    max: number;
    /** Smallest value one level adds: the slider step, so only reachable values are offered. */
    step: number;
}

const NONE: TreeLimit = { max: 0, step: 0.01 };

/**
 * The real limits of the tree bonuses, from the selected config: what the calculator sandboxes
 * may offer. Personal trees sum every node of a type (one per tier) at its MaxLevel; the clan tree
 * caps each node at MaxLevel (infinite nodes go further only once the whole clan tree is maxed,
 * which a profile shows in its own value: the sandbox panel keeps the profile value reachable).
 */
export function useTreeLimits() {
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: positionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');

    return useMemo(() => {
        const personal: Record<string, TreeLimit> = {};
        if (techTreeLibrary && positionLibrary) {
            for (const tree of ['Forge', 'Power', 'SkillsPetTech']) {
                for (const node of positionLibrary[tree]?.Nodes || []) {
                    const def = techTreeLibrary[node.Type];
                    if (!def) continue;
                    const stat = def.StatsByTier?.[node.Tier ?? 0]?.[0] ?? def.Stats?.[0];
                    if (!stat) continue;
                    const maxLevel = def.MaxLevel || 1;
                    const atMax = (stat.Value || 0) + (maxLevel - 1) * (stat.ValueIncrease || 0);
                    const perLevel = Math.min(...[stat.Value, stat.ValueIncrease].filter((v: number) => v > 0));
                    const cur = personal[node.Type] ?? { max: 0, step: Infinity };
                    personal[node.Type] = { max: cur.max + atMax, step: Math.min(cur.step, perLevel) };
                }
            }
        }
        const clan: Record<string, TreeLimit> = {};
        for (const [type, def] of Object.entries<any>(guildUpgradeLibrary || {})) {
            const max = clanNodeValueAtLevel(def, def?.MaxLevel || 0);
            if (max > 0) clan[type] = { max, step: def.ValuePerLevel || max };
        }
        const fix = (l: TreeLimit | undefined): TreeLimit =>
            l && l.max > 0 ? { max: round(l.max), step: Number.isFinite(l.step) && l.step > 0 ? round(l.step) : 0.01 } : NONE;
        return {
            personal: (type: string) => fix(personal[type]),
            clan: (type: string) => fix(clan[type]),
        };
    }, [techTreeLibrary, positionLibrary, guildUpgradeLibrary]);
}

/** Config values are binary fractions (0.1 = 0.1000000015); keep slider math clean. */
const round = (v: number) => Math.round(v * 1e6) / 1e6;
