import { RARITIES } from './gameTiers';
import { summonLevelsByAscension } from './summonEngine';
import { ageChanceRows, maxForgeLevel, parseForgeUpgrades } from './forgeConfig';
import { getNormalizedTarget } from './ascensionUtils';

/**
 * Ascension facts the wiki pages share, all derived from the loaded config (no rarity, age or
 * ascension number is hardcoded here).
 *
 * Game facts, read from the 2026_11_16_09_55 binary:
 *  - AscensionModel.GetLevelStats (RVA 0x7C79F80) returns the StatContributions of
 *    AscensionConfigPerLevel[CurrentLevel - 1] only (an empty set at level 0 or past the list).
 *    The levels do not stack: the config values are already the totals (49, 2499, 124999 are
 *    x50, x2500, x125000).
 *  - PlayerModelItemExtensions.GetAscensionStats (RVA 0x7C46D20) adds the four tracks (Forge,
 *    Mounts, Pets, Skills) to one Stats, and CalculateTotalStats (RVA 0x7C45D8C) adds that to the
 *    player's total stats before the equipped items, pets, mount and skills are resolved.
 *  - The contributions sit on StatLayer.Ascensions (3): sums inside a layer, layers multiply, so the
 *    ascension is its own x(1 + Value) on top of tech tree, clan and skins. The targets are Kind
 *    Equipment / Mount / Pet / ActiveSkill / PassiveSkill with no qualifier, so they reach every
 *    rarity and every age alike, the new ones included.
 *  - The game's own collection screens (PetDetailsUiView.UpdateUi RVA 0x41966F0, MountDetailsUiView
 *    .UpdateUi RVA 0x41868B4) format a unit with GetTotalStats(player), i.e. WITH the player's current
 *    ascension and every other bonus. A wiki has no player, so it shows base values and applies an
 *    ascension only when one is picked.
 */

export type AscensionTrack = 'Forge' | 'Pets' | 'Mounts' | 'Skills';

export interface AscensionMultipliers {
    /** x(1 + summed Value) per normalized target type ('PetStatTarget', 'ActiveSkillStatTarget', ...). */
    damage: Record<string, number>;
    health: Record<string, number>;
}

/**
 * The Ascensions-layer multipliers of one track at one ascension level, per target type.
 * Level 0, or a level past the config's list, gives no multiplier (GetLevelStats returns empty).
 */
export function ascensionMultipliers(ascensionConfigs: any, track: AscensionTrack, level: number): AscensionMultipliers {
    const out: AscensionMultipliers = { damage: {}, health: {} };
    const rows: any[] = ascensionConfigs?.[track]?.AscensionConfigPerLevel ?? [];
    if (!(level >= 1) || level > rows.length) return out;
    const sums: { damage: Record<string, number>; health: Record<string, number> } = { damage: {}, health: {} };
    for (const s of rows[level - 1]?.StatContributions ?? []) {
        const nature = s?.StatNode?.UniqueStat?.StatNature;
        if (nature && nature !== 'Multiplier') continue;
        const statType = s?.StatNode?.UniqueStat?.StatType;
        const target = getNormalizedTarget(s?.StatNode).$type ?? '';
        const bucket = statType === 'Damage' || statType === 'AscensionDamage' ? sums.damage
            : statType === 'Health' || statType === 'AscensionHealth' ? sums.health : null;
        if (!bucket) continue;
        bucket[target] = (bucket[target] ?? 0) + (Number(s?.Value) || 0);
    }
    for (const k of Object.keys(sums.damage)) out.damage[k] = 1 + sums.damage[k];
    for (const k of Object.keys(sums.health)) out.health[k] = 1 + sums.health[k];
    return out;
}

/** One target's damage and health multipliers (1 when the track has none for it). */
export function ascensionMultiplierFor(ascensionConfigs: any, track: AscensionTrack, level: number, targetType: string) {
    const m = ascensionMultipliers(ascensionConfigs, track, level);
    return { dmg: m.damage[targetType] ?? 1, hp: m.health[targetType] ?? 1 };
}

/**
 * For each rarity, the first ascension whose summon table (SummonConfig.PostLoad RVA 0x7D03528,
 * GetLevels RVA 0x7D03870) gives it a non-zero chance at some level. Only rarities that need an
 * ascension (> 0) are returned, and only when the config has a table per ascension: a config with
 * one table for every ascension (before 2026_11_16) returns an empty map.
 */
export function rarityAscensionFromSummon(summonConfig: any): Record<string, number> {
    const tables = summonLevelsByAscension(summonConfig);
    const out: Record<string, number> = {};
    if (tables.length <= 1) return out;
    for (const rarity of RARITIES) {
        const first = tables.findIndex(t => t.some(row => (Number(row?.[rarity]) || 0) > 0));
        if (first > 0) out[rarity] = first;
    }
    return out;
}

/**
 * For each age index, the first forge ascension that can forge it: the forge levels allowed at
 * ascension a are 0..MaxForgeLevel(a) (0-based, SharedGameConfigExtensions.MaxForgeLevel RVA
 * 0x7C3DE08), and ForgeAction.RollAge (RVA 0x7CD3328) reads ItemAgeDropChancesLibrary at that
 * level. Only ages that need an ascension (> 0) are returned, and only when ForgeUpgradeLibrary
 * lists levels per forge ascension (from 2026_11): older configs return an empty map.
 */
export function ageAscensionFromForge(forgeUpgradeLib: any, ageDropLib: any): Record<number, number> {
    const out: Record<number, number> = {};
    const fu = parseForgeUpgrades(forgeUpgradeLib);
    if (!fu?.maxByAscension || fu.maxByAscension.length <= 1) return out;
    const rows = ageChanceRows(ageDropLib);
    const ages = rows.reduce((n, [, c]) => Math.max(n, c.length), 0);
    for (let age = 0; age < ages; age++) {
        for (let asc = 0; asc < fu.maxByAscension.length; asc++) {
            const cap = maxForgeLevel(fu, asc);
            if (rows.some(([lv, c]) => lv <= cap && (c[age] ?? 0) > 0)) {
                if (asc > 0) out[age] = asc;
                break;
            }
        }
    }
    return out;
}
