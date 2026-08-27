/**
 * Texture sheets are shipped per game-data version, but a config version does not always come with
 * one: a server side config retune produces a new config id while the client build, and therefore
 * every sprite sheet, is unchanged. Ten of the config versions in versions.json have no Texture2D
 * folder at all, and until this resolver existed selecting one of them pointed every sprite at a
 * path that 404s.
 *
 * So a config version is mapped to the newest texture version at or below it. Same client build
 * means identical sheets, and an older sheet is always better than a broken image.
 *
 * This list mirrors the folder names under `public/Texture2D`, which are also the keys of
 * `public/parsed_configs/TextureMD5Manifest.json`. To regenerate:
 *     ls public/Texture2D
 * A folder missing from this list is not a failure: the resolver simply falls back further.
 */
const TEXTURE_VERSIONS = [
    '2026_04_02',
    '2026_05_06_11_12',
    '2026_05_08_11_17',
    '2026_05_08_11_30',
    '2026_05_12_12_51',
    '2026_05_15_20_01',
    '2026_05_21_13_52',
    '2026_05_21_16_30',
    '2026_05_23_14_08',
    '2026_07_03_12_39',
    '2026_07_14_17_28',
    '2026_07_15_12_09',
    '2026_08_21_00_29',
    '2026_08_26_08_49',
] as const;

/**
 * The texture folder to use for a given config version: the newest one at or below it, or the
 * oldest available when the config version predates every sheet we ship.
 *
 * Folder names are zero padded timestamps, so a plain string comparison is a date comparison.
 */
export function resolveTextureVersion(version?: string | null): string | undefined {
    if (!version) return undefined;
    if (TEXTURE_VERSIONS.includes(version as typeof TEXTURE_VERSIONS[number])) return version;
    let best: string | undefined;
    for (const candidate of TEXTURE_VERSIONS) {
        if (candidate <= version) best = candidate;
    }
    return best ?? TEXTURE_VERSIONS[0];
}

export function getAscensionTexturePath(baseTexture: 'Pets' | 'MountIcons' | 'SkillIcons' | 'Eggs' | 'Icons', ascensionLevel: number, version?: string): string {
    const baseUrl = import.meta.env.BASE_URL;
    const textureVersion = resolveTextureVersion(version);
    const versionPath = textureVersion ? `${textureVersion}/` : '';
    const textureBase = `${baseUrl}Texture2D/${versionPath}`;
    
    // Icons sheet doesn't have ascended versions, always return standard
    if (baseTexture === 'Icons') return `${textureBase}Icons.png`;

    if (ascensionLevel === 1) return `${textureBase}Mega${baseTexture}.png`;
    if (ascensionLevel === 2) return `${textureBase}Ultra${baseTexture}.png`;
    if (ascensionLevel === 3) return `${textureBase}Apex${baseTexture}.png`;
    
    return `${textureBase}${baseTexture}.png`;
}

export function getAnvilTexturePath(ascensionLevel: number, version?: string): string {
    const baseUrl = import.meta.env.BASE_URL;
    const textureVersion = resolveTextureVersion(version);
    const versionPath = textureVersion ? `${textureVersion}/` : '';
    const textureBase = `${baseUrl}Texture2D/${versionPath}`;

    if (ascensionLevel === 1) return `${textureBase}Anvil _.png`;
    if (ascensionLevel === 2) return `${textureBase}Anvil __.png`;
    if (ascensionLevel === 3) return `${textureBase}Anvil ___.png`;
    
    return `${textureBase}Anvil.png`;
}

interface NormalizedTarget {
    $type?: string;
    ItemType?: number;
    DungeonType?: number;
    CurrencyType?: number;
}

export function getNormalizedTarget(statNode: any): NormalizedTarget {
    if (!statNode) return {};

    if (statNode.StatTarget) {
        return {
            $type: statNode.StatTarget.$type,
            ItemType: statNode.StatTarget.ItemType,
            DungeonType: statNode.StatTarget.DungeonType,
            CurrencyType: statNode.StatTarget.CurrencyType,
        };
    }

    if (statNode.Target) {
        const kind = statNode.Target.Kind;
        const qualifiers = statNode.Target.Qualifiers || [];
        const condition = statNode.Condition || "None";

        const getQualifierValue = (typeStr: string): any => {
            const q = qualifiers.find((x: any) => x.Type === typeStr);
            return q ? q.Value : undefined;
        };

        const itemTypeVal = getQualifierValue("ItemType");
        const dungeonTypeVal = getQualifierValue("DungeonType");
        const currencyTypeVal = getQualifierValue("CurrencyType");

        let type: string | undefined;

        switch (kind) {
            case "Player":
                if (condition === "Melee") {
                    type = "PlayerMeleeOnlyStatTarget";
                } else if (condition === "Ranged") {
                    type = "PlayerRangedOnlyStatTarget";
                } else {
                    type = "PlayerStatTarget";
                }
                break;
            case "Equipment":
                if (itemTypeVal === 5) {
                    type = "WeaponStatTarget";
                } else {
                    type = "EquipmentStatTarget";
                }
                break;
            case "Forge":
                type = "ForgeStatTarget";
                break;
            case "ActiveSkill":
            case "SkillActive":
                type = "ActiveSkillStatTarget";
                break;
            case "PassiveSkill":
            case "SkillPassive":
                type = "PassiveSkillStatTarget";
                break;
            case "Pet":
                type = "PetStatTarget";
                break;
            case "Mount":
                type = "MountStatTarget";
                break;
            case "Egg":
                type = "EggStatTarget";
                break;
            case "Currency":
                type = "OfflineCurrencyStatTarget";
                break;
            case "Timer":
                type = "OfflineTimerStatTarget";
                break;
            case "Dungeon":
                type = "DungeonStatTarget";
                break;
        }

        return {
            $type: type,
            ItemType: itemTypeVal,
            DungeonType: dungeonTypeVal,
            CurrencyType: currencyTypeVal,
        };
    }

    if (statNode.LegacyTarget) {
        return {
            $type: statNode.LegacyTarget.$type,
            ItemType: statNode.LegacyTarget.ItemType,
            DungeonType: statNode.LegacyTarget.DungeonType,
            CurrencyType: statNode.LegacyTarget.CurrencyType,
        };
    }

    return {};
}
