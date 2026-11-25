import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { useTreeModifiers } from './useCalculatedStats';
import { ITEM_TYPE_NAMES } from '../utils/forgeItemLevels';

export interface TechTreeNode {
    Type: string;
    MaxLevel?: number;
    Stats: {
        StatNode: {
            UniqueStat: {
                StatType: string;
                StatNature: string;
            };
            Target?: {
                Kind?: string;
                Qualifiers?: { Type: string; Value: number }[];
            };
            StatTarget?: {
                ItemType?: number;
                $type?: string;
            };
        };
        Value: number;
        ValueIncrease: number;
    }[];
}

/**
 * Which forge input a tech node feeds, from its stat node (config driven):
 * SellPrice on Equipment (GetSellValue), FreebieChance on Forge (free forge roll) and
 * MaxLevel on Equipment with an ItemType qualifier (RollItemLevel). Older builds carry a
 * StatTarget object instead of Target, handled as a fallback.
 */
export function classifyForgeNode(def: TechTreeNode | undefined): { key: string; itemType?: number } | null {
    const node = def?.Stats?.[0]?.StatNode;
    if (!def || !node) return null;
    const statType = node.UniqueStat?.StatType;
    const kind = node.Target?.Kind
        ?? (node.StatTarget?.$type ? node.StatTarget.$type.replace('StatTarget', '') : undefined);
    if (statType === 'SellPrice' && kind === 'Equipment') return { key: 'SellPrice' };
    if (statType === 'FreebieChance' && kind === 'Forge') return { key: 'FreeForgeChance' };
    if (statType === 'MaxLevel' && (kind === 'Equipment' || kind === 'Weapon')) {
        const q = node.Target?.Qualifiers?.find(x => x.Type === 'ItemType');
        const itemType = q?.Value ?? node.StatTarget?.ItemType
            ?? (kind === 'Weapon' ? ITEM_TYPE_NAMES.indexOf('Weapon') : undefined);
        if (itemType === undefined) return null;
        return { key: def.Type.replace(/LevelUp$/, ''), itemType };
    }
    return null;
}

export interface TechTreeLibrary {
    [key: string]: TechTreeNode;
}

export interface ForgeTreeBonuses {
    sellPriceBonus: number;
    freeForgeChance: number;
    slotBonuses: Record<string, number>;
    slotTypes: Record<string, number>;
}

/** Forge-related tree bonuses from the profile (tier aware, requirement checked, follows the tree mode). */
export function useForgeTreeBonuses(): ForgeTreeBonuses {
    const { data: techTreeLib } = useGameData<TechTreeLibrary>('TechTreeLibrary.json');
    const treeModifiers = useTreeModifiers();

    const forgeNodes = useMemo(() => {
        const out: { type: string; key: string; itemType?: number }[] = [];
        if (!techTreeLib) return out;
        Object.values(techTreeLib).forEach(def => {
            const c = classifyForgeNode(def);
            if (c) out.push({ type: def.Type, ...c });
        });
        return out;
    }, [techTreeLib]);

    return useMemo(() => {
        let sellPriceBonus = 0;
        let freeForgeChance = 0;
        const slotBonuses: Record<string, number> = {};
        const slotTypes: Record<string, number> = {};
        forgeNodes.forEach(n => {
            const v = treeModifiers[n.type] || 0;
            if (n.key === 'SellPrice') sellPriceBonus += v;
            else if (n.key === 'FreeForgeChance') freeForgeChance += v;
            else if (n.itemType !== undefined) {
                slotBonuses[n.key] = (slotBonuses[n.key] || 0) + v;
                slotTypes[n.key] = n.itemType;
            }
        });
        return { sellPriceBonus, freeForgeChance, slotBonuses, slotTypes };
    }, [forgeNodes, treeModifiers]);
}
