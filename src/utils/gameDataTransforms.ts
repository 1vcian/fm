import { goesToClanLayer } from './clanTechStacking';

/**
 * The pure transforms between the parsed config JSON and the library shapes the stat engine reads.
 * useGameData applies them when it fetches a file; scripts that run the engine under Node (the
 * profile presets) apply the same ones to files read from disk, so both see identical libraries.
 */

/**
 * Config versions from this timestamp on were parsed with the fixed Metaplay parser
 * (type-aware VarInt decode). In those versions the fixed-point magnitudes (FD6/F1D:
 * guild ValuePerLevel, player StatValuePerLevel, tech Duration, ) are stored at their
 * REAL in-game value, so the legacy "* 2" compensation must NOT be applied. Older
 * versions were parsed with the buggy parser (values serialized at half) and still need
 * the * 2. Gate on the version string (folders are zero-padded timestamps).
 */
const VARINT_FIX_VERSION = '2026_08_21_00_29';
export function isVarintFixed(version?: string | null): boolean {
    return !!version && version >= VARINT_FIX_VERSION;
}

/**
 * StatContribution (dump.cs, build 2026_11_16_09_55) turned Value from F64 into FD6 (member 3) and
 * kept the old F64 member as `_legacyValue` (member 2). After deserializing, the game runs
 * MigrateLegacyValue (0x7CFD5E0): if _legacyValue != 0 then Value = FD6.FromF64(_legacyValue)
 * (0x7625448: (raw * 10^6) >> 32, a floor to the micro-unit); a zero _legacyValue leaves Value as
 * it is. Every shipped 2026_11_16 entry has _legacyValue 0.0, so this is a no-op today; it walks the
 * parsed JSON in place so a config that still carries the old value gets the game's Value.
 * Files without the key (every older version) are untouched.
 */
export function migrateLegacyStatValues<T>(json: T): T {
    const walk = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const v of node) walk(v);
            return;
        }
        if (typeof node._legacyValue === 'number' && node._legacyValue !== 0) {
            node.Value = Math.floor(node._legacyValue * 1e6) / 1e6;
        }
        for (const k in node) {
            const v = node[k];
            if (v && typeof v === 'object') walk(v);
        }
    };
    walk(json);
    return json;
}

/** Versions from this one on ship the split tech tree files that reconstructTechTreeLibrary joins. */
export const SPLIT_TECH_TREE_VERSION = '2026_07_14_16_51';

/** The three personal trees; the "Clan" entry of the position library is the guild layout. */
const PLAYER_TREE_TYPES = ['Forge', 'Power', 'SkillsPetTech'];

/**
 * TechTreeMapping for one config version: the node graph of that version's
 * PlayerTechTreePositionLibrary (TechTreePositionLibrary before the split) with every node's icon.
 *
 * The global TechTreeMapping.json used to be the graph itself, frozen at the 50/100/85-node layout.
 * Build 2026_11_16_09_55 added a sixth tier (Tier 5: +7 Forge, +11 Power, +18 SkillsPetTech nodes,
 * existing ids unchanged), so the graph now comes from the selected version's own position library
 * and older versions keep exactly the nodes they shipped. The game checks a node's prerequisites
 * the same way in both builds: PlayerTechTreeModel.NodeRequirementsMet (0x7D06964; 0x78A5564 in
 * 2026_10_27_09_45) only asks that every id in Position[tree].Nodes[id].Requirements is present
 * in the player's tree; there is no tier, ascension or segment gate, so a Tier 5 node opens as
 * soon as its Tier 4 requirements are researched.
 *
 * Icons: `node_sprites` (TechTreeVisualConfig.Nodes, extracted by reverseForge/extract_techtree_icons.py)
 * maps every node type to its sprite on TechTreeIcons; the frozen graph's own sprite fields are the
 * fallback for a mapping file without that table. When the position library cannot be read the
 * frozen graph is returned as it is.
 */
export function buildTechTreeMapping(globalMapping: any, positionLibrary: any): any {
    if (!globalMapping || typeof globalMapping !== 'object') return globalMapping;
    const spriteByType: Record<string, any> = {};
    for (const tree of Object.values(globalMapping.trees || {}) as any[]) {
        for (const n of tree?.nodes || []) {
            if (n?.type && n.sprite_rect && !spriteByType[n.type]) {
                spriteByType[n.type] = { sprite_index: n.sprite_index, sprite_file: n.sprite_file, sprite_rect: n.sprite_rect };
            }
        }
    }
    Object.assign(spriteByType, globalMapping.node_sprites || {});

    if (!positionLibrary || typeof positionLibrary !== 'object') return globalMapping;
    const trees: Record<string, any> = {};
    for (const treeName of PLAYER_TREE_TYPES) {
        const nodes = positionLibrary[treeName]?.Nodes;
        if (!Array.isArray(nodes)) {
            if (globalMapping.trees?.[treeName]) trees[treeName] = globalMapping.trees[treeName];
            continue;
        }
        trees[treeName] = {
            type: treeName,
            nodes: nodes.map((n: any) => ({
                id: n.Id,
                tier: n.Tier ?? 0,
                layer: n.Layer ?? 0,
                type: n.Type,
                ...(spriteByType[n.Type] || {}),
                requirements: Array.isArray(n.Requirements) ? n.Requirements : [],
            })),
        };
    }
    return { ...globalMapping, trees };
}

export function parseValue(val: any): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object') {
        const raw = val.Raw?.v || val;
        if (raw && (raw.s0 !== undefined || raw.s1 !== undefined)) {
            return ((raw.s0 || 0) + (raw.s1 || 0) * 4294967296) / 500000;
        }
    }
    return Number(val) || 0;
}

/**
 * The new (2026_07 split) config format serializes tech-tree bonus magnitudes at
 * HALF of their effective in-game value: the game doubles them at runtime.
 * (Proof: old combined TechTreeLibrary stored WeaponBonus L1 = 0.02, the new
 * PlayerTechTreeNodeValuesLibrary stores 0.01 for the same node; guild forging is
 * stored 0.02 but is +4%/level in game.) The player tree already gets this x2
 * baked in during reconstruction (see reconstructTechTreeLibrary). For the guild/clan
 * tree we normalise GuildTechTreeUpgradeLibrary here, at the single data-loading
 * boundary, so every consumer reads the real (doubled) ValuePerLevel directly and
 * no ad-hoc "* 2" is scattered around the codebase.
 */
export function normalizeGuildUpgradeLibrary(json: any, fixed: boolean): any {
    if (!json || typeof json !== 'object') return json;
    const normalized: Record<string, any> = {};
    for (const nodeType of Object.keys(json)) {
        const def = json[nodeType];
        if (def && typeof def === 'object') {
            // Fixed-parser versions already store the real value -> no x2.
            // Legacy versions store it halved: number form x2, or {Raw:{v:{s0,s1}}}
            // decoded by parseValue via /500000 (which already folds in the x2).
            const raw = def.ValuePerLevel;
            const effective = (typeof raw === 'number') ? (fixed ? raw : raw * 2) : parseValue(raw);
            normalized[nodeType] = { ...def, ValuePerLevel: effective };
        } else {
            normalized[nodeType] = def;
        }
    }
    return normalized;
}

/** TechTreeLibrary rebuilt from TechNodesLibrary + PlayerTechTreeNodeValuesLibrary (split format). */
export function reconstructTechTreeLibrary(nodesLib: any, valuesLib: any, version: string): Record<string, any> {
    // Tech tree values are serialized at half of their runtime value (the game
    // doubles them at runtime; the guild/clan tree already has this x2 applied
    // in the consumer code via ValuePerLevel*2). To keep the reconstructed
    // TechTreeLibrary shape consistent with the old serialized config (which
    // contained the full doubled Value/ValueIncrease), we apply x2 here too
    // for player-tree nodes that have a valuesDef entry. For node types that
    // only exist in the guild/clan tree (no valuesDef, value provided by
    // GuildTechTreeUpgradeLibrary), we emit placeholder Stats so consumers
    // stop skipping them via `!nodeData?.Stats`.
    const reconstructed: Record<string, any> = {};
    for (const nodeType of Object.keys(nodesLib)) {
        const nodeDef = nodesLib[nodeType];
        const valuesDef = valuesLib[nodeType];
        const hasValues = valuesDef && valuesDef.Tiers && valuesDef.Tiers.length > 0;

        let maxLevel = 1;
        if (hasValues) {
            const firstTier = valuesDef.Tiers[0];
            maxLevel = firstTier.StatValuePerLevel ? firstTier.StatValuePerLevel.length : 1;
        }

        // Fixed-parser versions store StatValuePerLevel at real value (no x2);
        // legacy versions store it halved and need the runtime x2.
        const mult = isVarintFixed(version) ? 1 : 2;
        const buildStats = (tier: any, tierLevels: number) => (nodeDef.StatNodes || []).map((statNode: any) => {
            let val1 = 0;
            let val2 = 0;
            if (tier) {
                val1 = parseValue(tier.StatValuePerLevel?.[0]) * mult;
                if (tierLevels > 1) {
                    val2 = parseValue(tier.StatValuePerLevel?.[1]) * mult;
                } else {
                    val2 = val1;
                }
            }
            return { StatNode: statNode, Value: val1, ValueIncrease: val2 - val1 };
        });

        const firstTier = hasValues ? valuesDef.Tiers[0] : null;
        const stats = buildStats(firstTier, maxLevel);

        const statsByTier: Record<number, { Value: number; ValueIncrease: number }[]> = {};
        if (hasValues) {
            for (let t = 0; t < valuesDef.Tiers.length; t++) {
                const tier = valuesDef.Tiers[t];
                const tierLevels = tier.StatValuePerLevel ? tier.StatValuePerLevel.length : 1;
                statsByTier[t] = buildStats(tier, tierLevels);
            }
        }

        reconstructed[nodeType] = {
            Type: nodeType,
            Stats: stats,
            StatsByTier: statsByTier,
            MaxLevel: maxLevel,
            // One entry per tier the values library ships (five up to 2026_10_27, six from 2026_11_16).
            TierAddition: nodeType === 'AutoForge' && hasValues ? valuesDef.Tiers.map((_: unknown, t: number) => t) : null,
            // The clan copy of this node compounds with the personal one instead of
            // adding to it (see utils/clanTechStacking.ts).
            ClanTechTreeLayer: (nodeDef.StatNodes || []).some((n: any) => goesToClanLayer(n))
        };
    }
    return reconstructed;
}

/**
 * The stats a player-tree node of `def`'s type grants at `tier`: StatsByTier[tier] (one entry per
 * PlayerTechTreeNodeValuesLibrary Tiers element, the list the game indexes with the node's Tier in
 * TechNodesLibrary.MaxLevel 0x7D04EF4 and the value lookup), falling back to the tier-0 `Stats`
 * for a library without per-tier data (pre-split configs). Most node types carry identical tiers,
 * but not all: from 2026_11_16_09_55 the three egg timer types that only sit in Tier 5 have Tier 5
 * values several times their Tier 0 ones, so a node's own tier must be used.
 */
export function techNodeTierStats(def: any, tier: number | null | undefined): any[] {
    const byTier = def?.StatsByTier?.[tier ?? 0];
    return Array.isArray(byTier) && byTier.length ? byTier : (def?.Stats || []);
}
