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

/** Versions from this one on ship the split tech tree files that reconstructTechTreeLibrary joins. */
export const SPLIT_TECH_TREE_VERSION = '2026_07_14_16_51';

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
            TierAddition: nodeType === 'AutoForge' ? [0, 1, 2, 3, 4] : null,
            // The clan copy of this node compounds with the personal one instead of
            // adding to it (see utils/clanTechStacking.ts).
            ClanTechTreeLayer: (nodeDef.StatNodes || []).some((n: any) => goesToClanLayer(n))
        };
    }
    return reconstructed;
}
