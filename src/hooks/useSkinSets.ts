import { useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { UserProfile } from '../types/Profile';

export interface SkinSetInfo {
    setId: string;
    equippedCount: number;
    totalPieces: number;
    isActive: boolean;
    isComplete: boolean;
    bonuses: { type: string; value: number }[];
    pieces: { type: string; idx: number; isEquipped: boolean }[];
}

export function useSkinSets() {
    const { profile } = useProfile();
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');

    const sets = useMemo(() => {
        if (!skinsLibrary || !setsLibrary) return [];

        const slotToJsonType: Record<string, string> = {
            'Weapon': 'Weapon', 'Helmet': 'Helmet', 'Body': 'Armour',
            'Gloves': 'Gloves', 'Belt': 'Belt', 'Necklace': 'Necklace',
            'Ring': 'Ring', 'Shoe': 'Shoes'
        };

        const equippedSkins = Object.entries(profile.items)
            .filter(([_, item]) => item?.skin)
            .map(([slot, item]) => ({
                slot,
                type: item!.skin!.type || slotToJsonType[slot],
                idx: item!.skin!.idx
            }));

        // Group all skins by BaseSetId
        const setMap: Record<string, SkinSetInfo> = {};
        
        // First, initialize all sets from library
        Object.entries(setsLibrary).forEach(([setId, setEntry]: [string, any]) => {
            setMap[setId] = {
                setId,
                equippedCount: 0,
                totalPieces: 0,
                isActive: false,
                isComplete: false,
                bonuses: [],
                pieces: []
            };
        });

        // Fill in pieces and total counts from skinsLibrary
        Object.values(skinsLibrary).forEach((skin: any) => {
            const setId = skin.BaseSetId;
            if (setId && setMap[setId]) {
                const isEquipped = equippedSkins.some(s => s.type === skin.SkinId.Type && s.idx === skin.SkinId.Idx);
                setMap[setId].totalPieces++;
                setMap[setId].pieces.push({
                    type: skin.SkinId.Type,
                    idx: skin.SkinId.Idx,
                    isEquipped
                });
                if (isEquipped) {
                    setMap[setId].equippedCount++;
                }
            }
        });

        // Same piece order in every set (Helmet, Armour, Weapon), whatever the library order.
        const TYPE_ORDER: Record<string, number> = { Helmet: 0, Armour: 1, Weapon: 2 };
        Object.values(setMap).forEach(set => set.pieces.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)));

        // Calculate bonuses and completion
        return Object.values(setMap)
            .filter(set => set.totalPieces > 0) // Only sets that exist in skinsLib
            .map(set => {
                const setEntry = setsLibrary[set.setId];
                const bonuses: { type: string; value: number }[] = [];
                let isActive = false;

                if (setEntry?.BonusTiers) {
                    setEntry.BonusTiers.forEach((tier: any) => {
                        if (set.equippedCount >= tier.RequiredPieces) {
                            isActive = true;
                            tier.BonusStats.Stats.forEach((stat: any) => {
                                const type = stat.StatNode?.UniqueStat?.StatType;
                                const value = stat.Value || 0;
                                bonuses.push({ type, value });
                            });
                        }
                    });
                }

                return {
                    ...set,
                    isActive,
                    isComplete: set.equippedCount === set.totalPieces,
                    bonuses
                };
            })
            .filter(set => set.equippedCount > 0) // Only show sets the user has at least one piece of
            .sort((a, b) => {
                if (a.isComplete && !b.isComplete) return -1;
                if (!a.isComplete && b.isComplete) return 1;
                return b.equippedCount - a.equippedCount;
            });

    }, [profile.items, skinsLibrary, setsLibrary]);

    return { sets, loading: !skinsLibrary || !setsLibrary };
}
