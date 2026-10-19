/**
 * How a clan tech node stacks with the personal tech tree.
 *
 * The game keeps every stat contribution in buckets keyed by StatLayer: values inside one layer
 * add up, layers multiply, so a stat ends up as  prod over layers of (1 + sum of that layer).
 * The aggregation code is identical in 2026_09 and 2026_10; what changed is the layer:
 *
 *   up to 2026_09   a clan node and the personal node of the same type were the same StatNode
 *                   (same TechNodesLibrary entry, Layer TechTree), so they summed:
 *                       1 + personal + clan
 *   from 2026_10    GuildTechTreeHelpers.ComputeBonus passes every clan node through the new
 *                   ToClanLayer (0x78227C8), which moves Damage/Health Multiplier nodes to the new
 *                   StatLayer.ClanTechTree (5). They now compound:
 *                       (1 + personal) * (1 + clan)
 *                   Every other nature/type (Bonus, TimerSpeed, MaxCount, ...) keeps its config
 *                   layer and still adds.
 *
 * The flag is stamped per node type on the reconstructed TechTreeLibrary (see useGameData). Only
 * the current rule is modelled: players always run the latest game build.
 */

interface StatNodeLike {
    UniqueStat?: { StatType?: string; StatNature?: string };
}

/** ToClanLayer's test: StatNature Multiplier and StatType Damage or Health. */
export function goesToClanLayer(statNode: StatNodeLike | null | undefined): boolean {
    const u = statNode?.UniqueStat;
    return u?.StatNature === 'Multiplier' && (u.StatType === 'Damage' || u.StatType === 'Health');
}

/**
 * Personal + clan for one node type, as a single "+x" modifier that consumers apply as
 * `1 + modifier`. `ownLayer` comes from TechTreeLibrary[type].ClanTechTreeLayer.
 */
export function combineTechAndClan(personal: number, clan: number, ownLayer: boolean): number {
    if (!clan) return personal;
    return ownLayer ? (1 + personal) * (1 + clan) - 1 : personal + clan;
}

/**
 * Inverse of combineTechAndClan: the personal-tree share of a merged modifier. Used by the stat
 * hovers, which show the personal tree and the clan tree as two separate factors.
 */
export function personalTechShare(merged: number, clan: number, ownLayer = true): number {
    if (!clan) return merged;
    return ownLayer ? (1 + merged) / (1 + clan) - 1 : merged - clan;
}

/**
 * Folds per-type clan sums into a personal modifier map, in place. All clan points of one type
 * form one bucket (the game keys contributions by node), so sum them before calling this.
 */
export function mergeClanModifiers(
    modifiers: Record<string, number>,
    clanSums: Record<string, number>,
    techTreeLibrary: Record<string, { ClanTechTreeLayer?: boolean } | undefined> | null | undefined
): void {
    for (const [type, clan] of Object.entries(clanSums)) {
        const ownLayer = !!techTreeLibrary?.[type]?.ClanTechTreeLayer;
        modifiers[type] = combineTechAndClan(modifiers[type] || 0, clan, ownLayer);
    }
}

interface ClanUpgradeDef {
    MaxLevel?: number;
    ValuePerLevel?: number;
    ValuePerInfiniteLevel?: number | null;
}

/**
 * A clan node's value at a level, as GuildTechTreeUpgradeLibrary.ValueAtLevel (0x7821CCC):
 *   infinite node past the cap   ValuePerLevel * MaxLevel + ValuePerInfiniteLevel * (level - MaxLevel)
 *   otherwise                    ValuePerLevel * clamp(level, 0, MaxLevel)
 * Only nodes with a ValuePerInfiniteLevel keep growing; every other node stops at MaxLevel.
 */
export function clanNodeValueAtLevel(def: ClanUpgradeDef | null | undefined, level: number): number {
    if (!def || level <= 0) return 0;
    const perLevel = def.ValuePerLevel || 0;
    const maxLevel = def.MaxLevel || 0;
    const perInfinite = def.ValuePerInfiniteLevel;
    if (perInfinite != null && maxLevel > 0 && level > maxLevel) {
        return perLevel * maxLevel + perInfinite * (level - maxLevel);
    }
    return perLevel * (maxLevel > 0 ? Math.min(level, maxLevel) : level);
}

/** Upper bound the editors accept on an unlocked infinite node. The game has none. */
export const INFINITE_CLAN_LEVEL_LIMIT = 9999;

/** A node with a ValuePerInfiniteLevel keeps levelling past MaxLevel once the tree is maxed. */
export function isInfiniteClanNode(def: ClanUpgradeDef | null | undefined): boolean {
    return def?.ValuePerInfiniteLevel != null;
}

/** GuildTechTreeUpgradeLibrary MaxLevel; a node missing from the config has no levels (0). */
export function clanNodeMaxLevel(def: ClanUpgradeDef | null | undefined): number {
    const max = def?.MaxLevel;
    return typeof max === 'number' && max > 0 ? Math.floor(max) : 0;
}

type LevelSource = Map<number, number> | Record<string | number, number> | null | undefined;

function levelOf(levels: LevelSource, globalId: number): number {
    if (!levels) return 0;
    if (levels instanceof Map) return levels.get(globalId) ?? 0;
    return Number(levels[globalId]) || 0;
}

/**
 * Per-node level caps for a clan tree, keyed by flattened globalId (category order x Nodes[], the
 * numbering every clan screen uses).
 *
 * GuildTechTreeHelpers.IsInfinite (0x78223F4) = IsTechTreeMaxed(guild) && ValuePerInfiniteLevel
 * is set: a node may only go past MaxLevel once EVERY node of the tree has reached its MaxLevel.
 * Until then each node caps at MaxLevel; afterwards the infinite nodes are open-ended.
 */
export function clanNodeCaps(
    positionLibrary: Record<string, { Nodes?: string[] } | null> | null | undefined,
    upgradeLibrary: Record<string, ClanUpgradeDef | null | undefined> | null | undefined,
    levels: LevelSource
): { caps: Map<number, number>; treeMaxed: boolean } {
    const caps = new Map<number, number>();
    const nodes: { globalId: number; def: ClanUpgradeDef | null | undefined }[] = [];
    if (!positionLibrary) return { caps, treeMaxed: false };
    let globalId = 0;
    for (const category of Object.keys(positionLibrary)) {
        for (const type of positionLibrary[category]?.Nodes || []) {
            nodes.push({ globalId, def: upgradeLibrary?.[type] });
            globalId += 1;
        }
    }
    const treeMaxed = nodes.length > 0 && nodes.every(n => levelOf(levels, n.globalId) >= clanNodeMaxLevel(n.def));
    for (const n of nodes) {
        const max = clanNodeMaxLevel(n.def);
        caps.set(n.globalId, treeMaxed && isInfiniteClanNode(n.def) ? INFINITE_CLAN_LEVEL_LIMIT : max);
    }
    return { caps, treeMaxed };
}
