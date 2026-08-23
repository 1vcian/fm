import { useState, useEffect } from 'react';
import { useGameDataContext } from '../context/GameDataContext';

// Cache to store loaded data and prevent redundant fetches
const dataCache: Record<string, any> = {};
// Cache to store generic promises for in-flight requests
const promiseCache: Record<string, Promise<any> | undefined> = {};

const GLOBAL_CONFIG_FILES = [
    'ManualSpriteMapping.json',
    'IconsMap.json',
    'TechTreeMapping.json',
    'AutoItemMapping.json',
    'ClanTechTreeIconsMap.json',
    'Localization.json'
];

/**
 * Config versions from this timestamp on were parsed with the fixed Metaplay parser
 * (type-aware VarInt decode). In those versions the fixed-point magnitudes (FD6/F1D:
 * guild ValuePerLevel, player StatValuePerLevel, tech Duration, …) are stored at their
 * REAL in-game value, so the legacy "* 2" compensation must NOT be applied. Older
 * versions were parsed with the buggy parser (values serialized at half) and still need
 * the * 2. Gate on the version string (folders are zero-padded timestamps).
 */
const VARINT_FIX_VERSION = '2026_08_21_00_29';
function isVarintFixed(version?: string | null): boolean {
    return !!version && version >= VARINT_FIX_VERSION;
}

function parseValue(val: any): number {
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
 * baked in during reconstruction (see fetchAndReconstruct). For the guild/clan
 * tree we normalise GuildTechTreeUpgradeLibrary here, at the single data-loading
 * boundary, so every consumer reads the real (doubled) ValuePerLevel directly and
 * no ad-hoc "* 2" is scattered around the codebase.
 */
function normalizeGuildUpgradeLibrary(json: any, fixed: boolean): any {
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

async function fetchAndReconstruct(selectedVersion: string, fileName: string): Promise<any> {
    const baseUrl = `${import.meta.env.BASE_URL}parsed_configs/${selectedVersion}/`;
    
    if (fileName === 'TechTreeLibrary.json') {
        const [nodesRes, valuesRes] = await Promise.all([
            fetch(`${baseUrl}TechNodesLibrary.json`),
            fetch(`${baseUrl}PlayerTechTreeNodeValuesLibrary.json`)
        ]);
        if (!nodesRes.ok || !valuesRes.ok) {
            throw new Error(`Failed to load tech tree components for reconstruction`);
        }
        const nodesLib = await nodesRes.json();
        const valuesLib = await valuesRes.json();
        
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
            const mult = isVarintFixed(selectedVersion) ? 1 : 2;
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
                TierAddition: nodeType === 'AutoForge' ? [0, 1, 2, 3, 4] : null
            };
        }
        return reconstructed;
    }
    
    if (fileName === 'TechTreeUpgradeLibrary.json') {
        const res = await fetch(`${baseUrl}PlayerTechTreeTierLibrary.json`);
        if (!res.ok) throw new Error(`Failed to load PlayerTechTreeTierLibrary.json`);
        const tierLib = await res.json();
        
        const reconstructed: Record<string, any> = {};
        for (const tierKey of Object.keys(tierLib)) {
            const tierDef = tierLib[tierKey];
            const levels = (tierDef.LevelInfoByTier || []).map((levelInfo: any, idx: number) => {
                const duration = parseValue(levelInfo.Duration);
                return {
                    Level: idx,
                    Cost: levelInfo.Cost,
                    Duration: duration
                };
            });
            reconstructed[tierKey] = {
                Tier: tierDef.Tier,
                Levels: levels
            };
        }
        return reconstructed;
    }
    
    if (fileName === 'TechTreePositionLibrary.json') {
        const res = await fetch(`${baseUrl}PlayerTechTreePositionLibrary.json`);
        if (!res.ok) throw new Error(`Failed to load PlayerTechTreePositionLibrary.json`);
        return res.json();
    }
    
    throw new Error(`Unsupported reconstruction for file: ${fileName}`);
}

export function useGameData<T>(fileName: string) {
    const { selectedVersion } = useGameDataContext();
    
    // Create a unique cache key that includes the version (global for manual files)
    const isGlobalFile = GLOBAL_CONFIG_FILES.includes(fileName);
    const cacheKey = isGlobalFile ? `global/${fileName}` : (selectedVersion && fileName ? `${selectedVersion}/${fileName}` : null);

    // Initialize from cache if available to prevent flicker
    const [data, setData] = useState<T | null>(() => {
        return cacheKey ? (dataCache[cacheKey] || null) : null;
    });
    const [loading, setLoading] = useState(() => {
        return !cacheKey || !dataCache[cacheKey];
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedVersion || !fileName) return;

        // Create a unique cache key that includes the version
        const isGlobalFile = GLOBAL_CONFIG_FILES.includes(fileName);
        const cacheKey = isGlobalFile ? `global/${fileName}` : `${selectedVersion}/${fileName}`;

        // If data is already in cache, it should have been initialized in useState.
        // But we check again to be safe and avoid unnecessary work.
        if (dataCache[cacheKey]) {
            if (data !== dataCache[cacheKey]) {
                setData(dataCache[cacheKey]);
                setLoading(false);
            }
            return;
        }

        async function fetchData() {
            // Check if there is already a pending request for this key
            if (promiseCache[cacheKey]) {
                try {
                    const json = await promiseCache[cacheKey];
                    setData(json);
                } catch (err: any) {
                    setError(err.message);
                } finally {
                    setLoading(false);
                }
                return;
            }

            setLoading(true);

            // Create the promise and store it in cache
            const fetchPromise = (async () => {
                if (!isGlobalFile && selectedVersion >= '2026_07_14_16_51') {
                    if (fileName === 'TechTreeLibrary.json' || fileName === 'TechTreeUpgradeLibrary.json' || fileName === 'TechTreePositionLibrary.json') {
                        return fetchAndReconstruct(selectedVersion, fileName);
                    }
                }
                const url = isGlobalFile 
                    ? `${import.meta.env.BASE_URL}parsed_configs/${fileName}`
                    : `${import.meta.env.BASE_URL}parsed_configs/${selectedVersion}/${fileName}`;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to load ${fileName}`);
                }
                const json = await response.json();
                if (fileName === 'GuildTechTreeUpgradeLibrary.json') {
                    return normalizeGuildUpgradeLibrary(json, isVarintFixed(selectedVersion));
                }
                return json;
            })();

            promiseCache[cacheKey] = fetchPromise;

            try {
                const json = await fetchPromise;
                dataCache[cacheKey] = json; // Cache the result
                setData(json);
            } catch (err: any) {
                setError(err.message);
                // Remove failed promise from cache so we can retry later if needed
                delete promiseCache[cacheKey];
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [fileName, selectedVersion]);

    return { data, loading, error };
}
