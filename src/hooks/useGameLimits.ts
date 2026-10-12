import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { buildGameLimits, limitsReady, type GameLimits } from '../utils/ocr/gameLimits';

/** The game's bounds for every value a screenshot read can write; null until the configs load. */
export function useGameLimits(): GameLimits | null {
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: techNodeValuesLibrary } = useGameData<any>('PlayerTechTreeNodeValuesLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: skillUpgradeLibrary } = useGameData<any>('SkillUpgradeLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: forgeUpgradeLibrary } = useGameData<any>('ForgeUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    return useMemo(() => {
        const cfg = {
            itemBalancingConfig, techTreePositionLibrary, techNodeValuesLibrary, petUpgradeLibrary,
            mountUpgradeLibrary, skillUpgradeLibrary, ascensionConfigsLibrary, forgeUpgradeLibrary,
            secondaryStatLibrary, guildPositionLibrary, guildUpgradeLibrary,
        };
        return limitsReady(cfg) ? buildGameLimits(cfg) : null;
    }, [itemBalancingConfig, techTreePositionLibrary, techNodeValuesLibrary, petUpgradeLibrary,
        mountUpgradeLibrary, skillUpgradeLibrary, ascensionConfigsLibrary, forgeUpgradeLibrary,
        secondaryStatLibrary, guildPositionLibrary, guildUpgradeLibrary]);
}
