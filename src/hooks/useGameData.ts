import { useState, useEffect } from 'react';
import { useGameDataContext } from '../context/GameDataContext';
import { isVarintFixed, normalizeGuildUpgradeLibrary, parseValue, reconstructTechTreeLibrary, SPLIT_TECH_TREE_VERSION } from '../utils/gameDataTransforms';

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
 * Fetch one config file and parse it as JSON.
 *
 * Checking `response.ok` is not enough on its own. The dev server, and any
 * static host that falls back to index.html for unknown paths, answers a request
 * for a config that does not exist with the app shell and a 200. `res.json()`
 * then trips on the leading "<" and the page reports
 * `Unexpected token '<', "<!doctype "... is not valid JSON`, which names neither
 * the file nor the version and sends you looking for a parser bug that is not
 * there. Rejecting an HTML body turns a missing config into an error a page can
 * actually render.
 */
async function fetchJsonConfig(url: string, fileName: string): Promise<any> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${fileName}`);
    }
    if ((response.headers.get('content-type') || '').includes('html')) {
        throw new Error(`${fileName} is not part of this game version`);
    }
    return response.json();
}

async function fetchAndReconstruct(selectedVersion: string, fileName: string): Promise<any> {
    const baseUrl = `${import.meta.env.BASE_URL}parsed_configs/${selectedVersion}/`;
    
    if (fileName === 'TechTreeLibrary.json') {
        const [nodesLib, valuesLib] = await Promise.all([
            fetchJsonConfig(`${baseUrl}TechNodesLibrary.json`, 'TechNodesLibrary.json'),
            fetchJsonConfig(`${baseUrl}PlayerTechTreeNodeValuesLibrary.json`, 'PlayerTechTreeNodeValuesLibrary.json')
        ]);
        return reconstructTechTreeLibrary(nodesLib, valuesLib, selectedVersion);
    }
    
    if (fileName === 'TechTreeUpgradeLibrary.json') {
        const tierLib = await fetchJsonConfig(`${baseUrl}PlayerTechTreeTierLibrary.json`, 'PlayerTechTreeTierLibrary.json');
        
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
        return fetchJsonConfig(`${baseUrl}PlayerTechTreePositionLibrary.json`, 'PlayerTechTreePositionLibrary.json');
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
                if (!isGlobalFile && selectedVersion >= SPLIT_TECH_TREE_VERSION) {
                    if (fileName === 'TechTreeLibrary.json' || fileName === 'TechTreeUpgradeLibrary.json' || fileName === 'TechTreePositionLibrary.json') {
                        return fetchAndReconstruct(selectedVersion, fileName);
                    }
                }
                const url = isGlobalFile 
                    ? `${import.meta.env.BASE_URL}parsed_configs/${fileName}`
                    : `${import.meta.env.BASE_URL}parsed_configs/${selectedVersion}/${fileName}`;
                const json = await fetchJsonConfig(url, fileName);
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
