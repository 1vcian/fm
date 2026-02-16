import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { UserProfile } from '../types/Profile';

interface SkinEntry {
    SkinId: {
        Type: string;
        Idx: number;
    };
    SetId?: string;
}

interface SetBonus {
    RequiredPieces: number;
    BonusStats: {
        Stats: Array<{
            StatNode: {
                UniqueStat: {
                    StatType: string;
                    StatNature: string;
                };
            };
            Value: number;
        }>;
    };
}

interface SetEntry {
    Id: string;
    BonusTiers: SetBonus[];
}

interface ActiveSet {
    id: string;
    equippedPieces: number;
    activeBonuses: {
        stats: Record<string, number>;
    };
}

const SLOT_TO_JSON_TYPE: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Helmet',
    'Body': 'Armour',
    'Gloves': 'Gloves',
    'Belt': 'Belt',
    'Necklace': 'Necklace',
    'Ring': 'Ring',
    'Shoe': 'Shoes'
};

export function useSetBonuses(items: UserProfile['items']) {
    const { data: skinsData } = useGameData<Record<string, SkinEntry>>('SkinsLibrary.json');
    const { data: setsData } = useGameData<Record<string, SetEntry>>('SetsLibrary.json');

    return useMemo(() => {
        if (!skinsData || !setsData || !items) {
            return { activeSets: [], totalBonuses: {} };
        }

        const equippedSetCounts: Record<string, number> = {};

        // Iterate through equipped items and count set pieces
        Object.entries(items).forEach(([slot, item]) => {
            if (!item || !item.skin) return;

            // Find skin entry in library
            // We need to match by Type and Idx.
            // But skinsData uses complex keys. We should iterate values.
            const jsonType = SLOT_TO_JSON_TYPE[slot];

            // Optimization: Create a lookup map if performance becomes an issue, but for 8 items it's fine.
            const skinEntry = Object.values(skinsData).find(
                s => s.SkinId.Type === jsonType && s.SkinId.Idx === item.skin?.idx
            );

            if (skinEntry?.SetId) {
                equippedSetCounts[skinEntry.SetId] = (equippedSetCounts[skinEntry.SetId] || 0) + 1;
            }
        });

        const activeSets: ActiveSet[] = [];
        const totalBonuses: Record<string, number> = {};

        // Calculate bonuses for each active set
        Object.entries(equippedSetCounts).forEach(([setId, count]) => {
            const setEntry = setsData[setId];
            if (!setEntry) return;

            const setBonuses: Record<string, number> = {};
            let isActive = false;

            // Check all activated tiers
            setEntry.BonusTiers.forEach(tier => {
                if (count >= tier.RequiredPieces) {
                    isActive = true;
                    tier.BonusStats.Stats.forEach(stat => {
                        const type = stat.StatNode.UniqueStat.StatType;
                        const value = stat.Value;
                        setBonuses[type] = (setBonuses[type] || 0) + value;
                        totalBonuses[type] = (totalBonuses[type] || 0) + value;
                    });
                }
            });

            if (isActive) {
                activeSets.push({
                    id: setId,
                    equippedPieces: count,
                    activeBonuses: { stats: setBonuses }
                });
            }
        });

        return { activeSets, totalBonuses };
    }, [items, skinsData, setsData]);
}
