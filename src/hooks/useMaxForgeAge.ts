import { useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';

/**
 * The highest age the profile's forge level can drop, by index (0 = Primitive).
 *
 * ForgeAction.RollAge (0x7838958) rolls the age from ItemAgeDropChancesLibrary[PlayerForgeModel.ForgeLevel]
 * (stored, 0-based); ForgeLevelUiView.UpdateUi (0x404800C) displays ForgeLevel + 1. profile.misc.forgeLevel is
 * the displayed level (1..35, as the Misc panel and warPoints.ts read it), so its row is forgeLevel - 1; an
 * age appears from the first level whose row gives it a chance > 0 (Divine: row 28, displayed 29).
 */
export function useMaxForgeAge(): number {
    const { profile } = useProfile();
    const { data: chances } = useGameData<Record<string, Record<string, number>>>('ItemAgeDropChancesLibrary.json');
    return useMemo(() => {
        const row = chances?.[String(Math.max(1, profile.misc.forgeLevel || 1) - 1)];
        if (row) for (let a = 9; a >= 0; a--) if ((row[`Age${a}`] ?? 0) > 0) return a;
        return 0;
    }, [profile.misc.forgeLevel, chances]);
}
