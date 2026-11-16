/**
 * The stat-engine libraries of one game data version for the preset search, built from its parsed
 * config files with the same transforms the app uses (src/utils/gameDataTransforms.ts). Shared by
 * scripts/build_presets.ts (files read from disk) and the "my best variants" worker (fetched).
 */
import type { LibraryData } from '../utils/statEngine';
import { isVarintFixed, migrateLegacyStatValues, normalizeGuildUpgradeLibrary, reconstructTechTreeLibrary } from '../utils/gameDataTransforms';
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
    // Pet / skill slot counts from 2026_11_16, when PetBaseConfig.PetSlotsCount and SkillBaseConfig.json
    // are gone (petSlotCount / skillSlotCount in utils/constants).
    'PlayerSegments',
];

export function presetLibsFrom(version: string, cfg: ConfigFiles): LibraryData {
    // StatContribution._legacyValue -> Value, as useGameData does on every fetched file.
    for (const name of Object.keys(cfg)) migrateLegacyStatValues((cfg as Record<string, unknown>)[name]);
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
        playerSegments: cfg.PlayerSegments,
        baseConfig: cfg.BaseConfig,
    } as unknown as LibraryData;
}
