/**
 * The stat-engine libraries of one game data version for the preset search, built from its parsed
 * config files with the same transforms the app uses (src/utils/gameDataTransforms.ts). Shared by
 * scripts/build_presets.ts (files read from disk) and the "my best variants" worker (fetched).
 */
import type { LibraryData } from '../utils/statEngine';
import { isVarintFixed, normalizeGuildUpgradeLibrary, reconstructTechTreeLibrary } from '../utils/gameDataTransforms';
import type { ConfigFiles } from './buildPresets';

/** Every parsed config file the preset search reads, by name without ".json". */
export const PRESET_CONFIG_FILES = [
    'PetUpgradeLibrary', 'PetBalancingLibrary', 'PetLibrary', 'SkillLibrary', 'SkillPassiveLibrary', 'MountUpgradeLibrary',
    'TechNodesLibrary', 'PlayerTechTreeNodeValuesLibrary', 'PlayerTechTreePositionLibrary', 'GuildTechTreePositionLibrary',
    'GuildTechTreeUpgradeLibrary', 'ItemBalancingLibrary', 'ItemBalancingConfig', 'WeaponLibrary', 'ProjectilesLibrary',
    'SecondaryStatLibrary', 'SkinsLibrary', 'SetsLibrary', 'SkinUpgradeLibrary', 'AscensionConfigsLibrary', 'PetBaseConfig',
    'SkillBaseConfig', 'BaseConfig', 'EnemyAgeScalingLibrary', 'EnemyLibrary', 'FairyUpgradesLibrary', 'ForgeUpgradeLibrary',
    'MainBattleConfig', 'MainBattleLibrary', 'MountLibrary', 'PvpBaseConfig', 'SecondaryStatItemUnlockLibrary',
    'SecondaryStatPetUnlockLibrary', 'SkillUpgradeLibrary',
];

export function presetLibsFrom(version: string, cfg: ConfigFiles): LibraryData {
    return {
        petUpgradeLibrary: cfg.PetUpgradeLibrary,
        petBalancingLibrary: cfg.PetBalancingLibrary,
        petLibrary: cfg.PetLibrary,
        skillLibrary: cfg.SkillLibrary,
        skillPassiveLibrary: cfg.SkillPassiveLibrary,
        mountUpgradeLibrary: cfg.MountUpgradeLibrary,
        techTreeLibrary: reconstructTechTreeLibrary(cfg.TechNodesLibrary, cfg.PlayerTechTreeNodeValuesLibrary, version),
        techTreePositionLibrary: cfg.PlayerTechTreePositionLibrary,
        guildTechTreePositionLibrary: cfg.GuildTechTreePositionLibrary,
        guildTechTreeUpgradeLibrary: normalizeGuildUpgradeLibrary(cfg.GuildTechTreeUpgradeLibrary, isVarintFixed(version)),
        itemBalancingLibrary: cfg.ItemBalancingLibrary,
        itemBalancingConfig: cfg.ItemBalancingConfig,
        weaponLibrary: cfg.WeaponLibrary,
        projectilesLibrary: cfg.ProjectilesLibrary,
        secondaryStatLibrary: cfg.SecondaryStatLibrary,
        skinsLibrary: cfg.SkinsLibrary,
        setsLibrary: cfg.SetsLibrary,
        skinUpgradeLibrary: cfg.SkinUpgradeLibrary,
        ascensionConfigsLibrary: cfg.AscensionConfigsLibrary,
        petBaseConfig: cfg.PetBaseConfig,
        skillBaseConfig: cfg.SkillBaseConfig,
        baseConfig: cfg.BaseConfig,
    } as unknown as LibraryData;
}
