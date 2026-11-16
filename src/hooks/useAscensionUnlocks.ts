import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { ageAscensionFromForge, rarityAscensionFromSummon } from '../utils/ascensionUnlocks';

/** Summon configs whose tables decide when a rarity can be obtained (pets hatch from eggs). */
export type SummonConfigFile = 'EggSummonConfig.json' | 'MountSummonConfig.json' | 'SkillSummonConfig.json';

/** Rarity -> first ascension that can summon it, for rarities that need one (selected version). */
export function useRarityAscensionFrom(file: SummonConfigFile): Record<string, number> {
    const { data } = useGameData<any>(file);
    return useMemo(() => rarityAscensionFromSummon(data), [data]);
}

/** Age index -> first forge ascension that can forge it, for ages that need one (selected version). */
export function useAgeAscensionFrom(): Record<number, number> {
    const { data: upgrades } = useGameData<any>('ForgeUpgradeLibrary.json');
    const { data: drops } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    return useMemo(() => ageAscensionFromForge(upgrades, drops), [upgrades, drops]);
}
