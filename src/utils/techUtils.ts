import { getNormalizedTarget } from './ascensionUtils';

/**
 * Maps technical tech node types to human-readable names
 */
export function getTechNodeName(type: string): string {
    return type
        .replace(/([A-Z])/g, ' $1')
        .replace(/^Base/, 'Base ')
        .trim();
}

/**
 * Generates a human-readable description for a tech node based on its effect data
 */
export function getTechNodeDescription(nodeType: string, effect: any): string {
    const clanDescriptions: Record<string, string> = {
        "WeaponBonus": "Increases Weapon stats.",
        "HelmetBonus": "Increases Helmet stats.",
        "BodyBonus": "Increases Body stats.",
        "ShoeBonus": "Increases Shoe stats.",
        "GloveBonus": "Increases Gloves stats.",
        "BeltBonus": "Increases Belt stats.",
        "NecklaceBonus": "Increases Necklace stats.",
        "RingBonus": "Increases Ring stats.",
        "SkillDamage": "Increases damage of active skills.",
        "PetBonusDamage": "Increases Pet damage stats.",
        "PetBonusHealth": "Increases Pet health stats.",
        "MountDamage": "Increases Mount damage stats.",
        "MountHealth": "Increases Mount health stats.",
        "CommonEggTimer": "Reduces hatching time for Common eggs.",
        "RareEggTimer": "Reduces hatching time for Rare eggs.",
        "EpicEggTimer": "Reduces hatching time for Epic eggs.",
        "LegendaryEggTimer": "Reduces hatching time for Legendary eggs.",
        "UltimateEggTimer": "Reduces hatching time for Ultimate eggs.",
        "MythicEggTimer": "Reduces hatching time for Mythic eggs.",
        "AutoForge": "Unlocks automatic forging option.",
        "ForgeAnimationSpeed": "Increases animation speed of forging.",
        "PlayerMoveSpeed": "Increases player movement speed.",
        "PlayerAttackRange": "Increases player attack range.",
        "WarPointsFromForging": "Increases War Points earned from forging.",
        "WarPointsFromSkillSummon": "Increases War Points earned from summoning skills.",
        "WarPointsFromSkillUpgrade": "Increases War Points earned from upgrading skills.",
        "WarPointsFromTechUpgrade": "Increases War Points earned from upgrading tech tree.",
        "WarPointsFromForgeSpend": "Increases War Points earned from spending resources in the forge.",
        "WarPointsFromDungeonKey": "Increases War Points earned from spending dungeon keys.",
        "WarPointsFromEggHatch": "Increases War Points earned from hatching eggs.",
        "WarPointsFromPetMerge": "Increases War Points earned from merging pets.",
        "WarPointsFromMountSummon": "Increases War Points earned from summoning mounts.",
        "WarPointsFromMountMerge": "Increases War Points earned from merging mounts.",
        "WarPointsOnDay1": "Increases day 1 War Points multiplier.",
        "WarPointsOnDay2": "Increases day 2 War Points multiplier.",
        "WarPointsOnDay3": "Increases day 3 War Points multiplier.",
        "WarPointsOnDay4": "Increases day 4 War Points multiplier.",
        "WarPointsOnDay5": "Increases day 5 War Points multiplier.",
        "WarPointsOnDay6": "Increases day 6 War Points multiplier.",
        "ClanWarDamage": "Increases damage dealt in Clan Wars.",
        "ClanWarHealth": "Increases player health in Clan Wars.",
        "PersonalWarRewards": "Increases personal rewards from Clan Wars.",
        "ClanWarWinRewards": "Increases win rewards from Clan Wars.",
        "ClanWarLoseRewards": "Increases lose rewards from Clan Wars.",
        "MissionDamage": "Increases damage dealt in Clan Missions.",
        "MissionHealth": "Increases player health in Clan Missions.",
        "MissionRewards": "Increases rewards earned from Clan Missions.",
        "HammerThiefDungeonDamage": "Increases damage dealt in Hammer Thief Dungeon.",
        "HammerThiefDungeonHealth": "Increases player health in Hammer Thief Dungeon.",
        "GhostTownDungeonDamage": "Increases damage dealt in Ghost Town Dungeon.",
        "GhostTownDungeonHealth": "Increases player health in Ghost Town Dungeon.",
        "InvasionDungeonDamage": "Increases damage dealt in Invasion Dungeon.",
        "InvasionDungeonHealth": "Increases player health in Invasion Dungeon.",
        "ZombieRushDungeonDamage": "Increases damage dealt in Zombie Rush Dungeon.",
        "ZombieRushDungeonHealth": "Increases player health in Zombie Rush Dungeon.",
        "GuildPotionsFromMissions": "Increases Guild Potions earned from Clan Missions.",
        "GuildPotionsFromPersonalWar": "Increases Guild Potions earned from Personal Wars.",
        "GuildPotionsFromClanWarWin": "Increases Guild Potions earned from winning Clan Wars.",
        "GuildPotionsFromClanWarLose": "Increases Guild Potions earned from losing Clan Wars.",
        "GuildTechRaceScoreMultiplier": "Increases your Clan's score gained in the Guild Tech Race.",
        "GuildTechRaceRewardMultiplier": "Increases the rewards earned from the Guild Tech Race."
    };

    if (clanDescriptions[nodeType]) {
        return clanDescriptions[nodeType];
    }

    if (!effect?.Stats || effect.Stats.length === 0) {
        // Fallback for nodes without structured stats
        switch (nodeType) {
            case 'AutoForge': return 'Enables automatic forging of equipment.';
            default: return 'Provides various bonuses to your progress.';
        }
    }

    const stat = effect.Stats[0];
    const target = getNormalizedTarget(stat.StatNode);
    const type = stat.StatNode?.UniqueStat?.StatType;
    const nature = stat.StatNode?.UniqueStat?.StatNature;

    let action = "Increases";
    if (nature === 'OneMinusMultiplier' || type === 'Cost') action = "Decreases";
    if (type === 'TimerSpeed') action = "Increases speed of";

    let subject = "the attribute";
    const targetType = target.$type;

    switch (targetType) {
        case 'WeaponStatTarget':
            subject = "Weapon";
            break;
        case 'EquipmentStatTarget':
            const itemTypes = ['Helmet', 'Armour', 'Gloves', 'Necklace', 'Ring', 'Weapon', 'Shoes', 'Belt'];
            subject = (target.ItemType !== undefined && target.ItemType !== null) ? (itemTypes[target.ItemType] || "Equipment") : "Equipment";
            break;
        case 'ForgeStatTarget':
            subject = "Forge";
            break;
        case 'ActiveSkillStatTarget':
            subject = "Active Skills";
            break;
        case 'PassiveSkillStatTarget':
            subject = "Passive Skills";
            break;
        case 'PetStatTarget':
            subject = "Pets";
            break;
        case 'MountStatTarget':
            subject = "Mounts";
            break;
        case 'EggStatTarget':
            subject = "Egg hatching";
            break;
        case 'OfflineCurrencyStatTarget':
            const currencies = ['Coin', 'Gem', 'Hammer'];
            subject = `Offline ${(target.CurrencyType !== undefined && target.CurrencyType !== null) ? (currencies[target.CurrencyType] || 'Currency') : 'Currency'} rewards`;
            break;
        case 'OfflineTimerStatTarget':
            subject = "Maximum offline duration";
            break;
        case 'DungeonStatTarget':
            const dungeons = ['Hammer Thief', 'Ghost Town', 'Egg Farm'];
            subject = `${(target.DungeonType !== undefined && target.DungeonType !== null) ? (dungeons[target.DungeonType] || 'Dungeon') : 'Dungeon'} rewards`;
            break;
    }

    let statName = type;
    switch (type) {
        case 'Damage': statName = "Damage"; break;
        case 'Health': statName = "Health"; break;
        case 'Cost': statName = "Cost"; break;
        case 'MaxLevel': statName = "Maximum Level"; break;
        case 'SellPrice': statName = "Sell Price"; break;
        case 'FreebieChance': statName = "Free Upgrade Chance"; break;
        case 'TimerSpeed': statName = nature === 'Divisor' ? "Speed" : "Cooldowns"; break;
        case 'Bonus': statName = "Bonus Amount"; break;
    }

    if (nature === 'Additive') {
        return `${action} ${subject} ${statName} by a flat amount per level.`;
    }

    return `${action} ${subject} ${statName} for each level researched.`;
}

/**
 * Clan Tech Tree icon mapping.
 *
 * ClanTechTreeIcons.png is an 8x8 sprite sheet (128px per sprite). The physical
 * order of the icons in the sheet does NOT match the order in which nodes are
 * enumerated from GuildTechTreePositionLibrary. To allow manual reordering of
 * the mapping, a global config `ClanTechTreeIconsMap.json` (same shape as
 * IconsMap.json) maps a sprite index -> node type `name`. The helpers below look
 * up the sprite index by node type and build the background style.
 */

export function getClanIconIndex(clanIconsMap: any, nodeType: string): { key: string; entry: any } | null {
    if (!clanIconsMap?.mapping) return null;
    for (const [key, entry] of Object.entries(clanIconsMap.mapping)) {
        if ((entry as any)?.name === nodeType) return { key, entry };
    }
    return null;
}

/** Look up a player-tree sprite (texture + rect) by node type from TechTreeMapping.json. */
function getPlayerSpriteByType(playerMapping: any, nodeType: string): { texture: string; rect: any; textureSize: any } | null {
    if (!playerMapping?.trees) return null;
    for (const tree of Object.values(playerMapping.trees) as any[]) {
        const node = (tree.nodes || []).find((n: any) => n.type === nodeType && n.sprite_rect);
        if (node) return { texture: playerMapping.texture || 'TechTreeIcons.png', rect: node.sprite_rect, textureSize: playerMapping.texture_size };
    }
    return null;
}

/** Build a background style for a sprite defined by a pixel rect within a sheet. */
function styleFromRect(texture: string, textureSize: any, rect: any, baseUrl: string, versionPath: string): Record<string, any> {
    const texW = textureSize?.width || 1024;
    const texH = textureSize?.height || 1024;
    const cols = Math.max(1, Math.round(texW / rect.width));
    const rows = Math.max(1, Math.round(texH / rect.height));
    const col = Math.round(rect.x / rect.width);
    const row = Math.round(rect.y / rect.height);
    return {
        backgroundImage: `url(${baseUrl}Texture2D/${versionPath}${texture})`,
        backgroundPositionX: cols > 1 ? `${col * (100 / (cols - 1))}%` : '0%',
        backgroundPositionY: rows > 1 ? `${row * (100 / (rows - 1))}%` : '0%',
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated' as const,
        backgroundRepeat: 'no-repeat',
    };
}

/**
 * Resolves the icon for a clan node. Priority:
 *  1. Explicit clan map entry with a `sprite_rect` + `texture` (icon borrowed from
 *     another sheet, e.g. the player TechTreeIcons — the game reuses those to avoid
 *     duplicating identical icons).
 *  2. Explicit clan map entry keyed by clan-sheet index → ClanTechTreeIcons.png grid.
 *  3. Auto-reuse: if the node type also exists in the player tree, use that sprite.
 */
export function getClanIconStyle(
    nodeType: string,
    clanIconsMap: any,
    version: string | undefined,
    baseUrl: string,
    playerMapping?: any
): Record<string, any> | null {
    const versionPath = version ? `${version}/` : '';
    const found = clanIconsMap ? getClanIconIndex(clanIconsMap, nodeType) : null;

    // (1) Explicit deliberate mapper pick: an entry carrying a texture + sprite_rect
    // (from either the clan or the player sheet). Always wins.
    if (found && found.entry.sprite_rect && found.entry.texture) {
        return styleFromRect(found.entry.texture, found.entry.texture_size, found.entry.sprite_rect, baseUrl, versionPath);
    }

    // (2) Auto-reuse the player-tree icon for shared node types. This takes precedence
    // over legacy sprite-index-only entries, which are the auto-generated sequential
    // placeholder (the clan sheet does not physically contain the shared icons — the
    // game reuses the player sheet to avoid duplicating identical icons).
    const player = getPlayerSpriteByType(playerMapping, nodeType);
    if (player) return styleFromRect(player.texture, player.textureSize, player.rect, baseUrl, versionPath);

    // (3) Legacy clan-sheet grid entry keyed by sprite index (clan-unique nodes).
    if (found) {
        const idx = parseInt(found.key);
        if (!Number.isNaN(idx)) {
            const grid = clanIconsMap.grid || { columns: 8, rows: 8 };
            const size = clanIconsMap.sprite_size?.width || 128;
            const rect = { x: (idx % (grid.columns || 8)) * size, y: Math.floor(idx / (grid.columns || 8)) * size, width: size, height: size };
            return styleFromRect(clanIconsMap.texture || 'ClanTechTreeIcons.png', clanIconsMap.texture_size, rect, baseUrl, versionPath);
        }
    }

    return null;
}
