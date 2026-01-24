import { useState, useEffect } from 'react';
import { useGameDataContext } from '../context/GameDataContext';

// Cache to store loaded data and prevent redundant fetches
const dataCache: Record<string, any> = {};
// Cache to store generic promises for in-flight requests
const promiseCache: Record<string, Promise<any> | undefined> = {};

export function useGameData<T>(fileName: string) {
    const { selectedVersion } = useGameDataContext();
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedVersion || !fileName) return;

        // Create a unique cache key that includes the version
        const cacheKey = `${selectedVersion}/${fileName}`;

        if (dataCache[cacheKey]) {
            setData(dataCache[cacheKey]);
            setLoading(false);
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
                const response = await fetch(`/parsed_configs/${selectedVersion}/${fileName}`);
                if (!response.ok) {
                    throw new Error(`Failed to load ${fileName}`);
                }
                return response.json();
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
