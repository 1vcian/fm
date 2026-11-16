import { useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { ageChancesAtForgeLevel } from '../utils/forgeConfig';

/**
 * The highest age the profile's forge level can drop, by index (0 = Primitive).
 *
 * ForgeAction.RollAge (0x7CD3328) rolls the age from ItemAgeDropChancesLibrary[PlayerForgeModel.ForgeLevel]
 * (stored, 0-based); ForgeLevelUiView.UpdateUi (0x42E08C0) displays ForgeLevel + 1. profile.misc.forgeLevel is
 * the displayed level (1 to the config's top level, as the Misc panel and warPoints.ts read it), so its row is forgeLevel - 1; an
 * age appears from the first level whose row gives it a chance > 0.
 */
export function useMaxForgeAge(): number {
    const { profile } = useProfile();
    const { data: chances } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    return useMemo(() => {
        // Either config format (Age<n> columns or the Ages list): the age count comes from the config.
        const row = ageChancesAtForgeLevel(chances, Math.max(1, profile.misc.forgeLevel || 1) - 1);
        for (let a = row.length - 1; a >= 0; a--) if (row[a] > 0) return a;
        return 0;
    }, [profile.misc.forgeLevel, chances]);
}
