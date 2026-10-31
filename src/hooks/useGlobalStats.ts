import { useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { calculateStats, LibraryData, AggregatedStats } from '../utils/statEngine';
import { applyTreeMode } from '../utils/treeMode';
import { useTreeMode, TreeMode } from '../context/TreeModeContext';
import { UserProfile } from '../types/Profile';

/**
 * Every library the stat engine needs, for the selected game data version. Shared by
 * useGlobalStats (the active profile) and by pages that compute stats for other profiles (PvP).
 */
export function useStatLibraries(): { libs: LibraryData; ready: boolean } {
    // Load all required game data
    // We use deduplicated caching so this shouldn't fire multiple network requests if already loaded
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');

    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');

    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');

    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');

    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');

    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: skinUpgradeLibrary } = useGameData<any>('SkinUpgradeLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: petBaseConfig } = useGameData<any>('PetBaseConfig.json');
    const { data: skillBaseConfig } = useGameData<any>('SkillBaseConfig.json');
    const { data: baseConfig } = useGameData<any>('BaseConfig.json');

    // Combine into LibraryData object
    const libs: LibraryData = useMemo(() => ({
        petUpgradeLibrary,
        petBalancingLibrary,
        petLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        guildTechTreePositionLibrary: guildPositionLibrary,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
        skinsLibrary,
        setsLibrary,
        skinUpgradeLibrary,
        ascensionConfigsLibrary,
        petBaseConfig,
        skillBaseConfig,
        baseConfig,
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        guildPositionLibrary, guildUpgradeLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
        skinsLibrary, setsLibrary, skinUpgradeLibrary, ascensionConfigsLibrary,
        petBaseConfig, skillBaseConfig, baseConfig,
    ]);

    const ready = !!(itemBalancingConfig && itemBalancingLibrary && techTreeLibrary && techTreePositionLibrary);
    return { libs, ready };
}

export { applyTreeMode } from '../utils/treeMode';

/** The active profile with the header's tree mode applied (see applyTreeMode). */
export function useTreeModeProfile(): { profile: UserProfile; libs: LibraryData; ready: boolean } {
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { libs, ready } = useStatLibraries();
    const effectiveProfile = useMemo(
        () => applyTreeMode(profile, treeMode, libs),
        [profile, treeMode, libs]
    );
    return { profile: effectiveProfile, libs, ready };
}

export function useGlobalStats(excludeSubstats = false): AggregatedStats | null {
    const { profile: effectiveProfile, libs } = useTreeModeProfile();
    const { itemBalancingConfig, itemBalancingLibrary } = libs as any;

    // Calculate stats
    // We memoize the result to avoid recalculating on every render if inputs haven't changed
    const stats = useMemo(() => {
        // Validation: Ensure critical libraries are loaded
        if (!itemBalancingConfig || !itemBalancingLibrary) {
            return null;
        }
        // Attribution is enabled here only: this hook runs per render, not in a loop.
        // The optimizer/sweep hot paths deliberately leave it off.
        return calculateStats(effectiveProfile, libs, excludeSubstats, { attribution: true });
    }, [effectiveProfile, libs, itemBalancingConfig, itemBalancingLibrary, excludeSubstats]);

    return stats;
}
