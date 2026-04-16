import { useState, useEffect, Dispatch, SetStateAction } from 'react';

/**
 * A custom hook that persists state in localStorage under a given key.
 * Mirrors the API of useState.
 */
export function usePersistentState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => {
        const saved = localStorage.getItem(key);
        if (saved !== null) {
            try {
                return JSON.parse(saved) as T;
            } catch (e) {
                console.warn(`Failed to parse localStorage key "${key}":`, e);
            }
        }
        return defaultValue;
    });

    useEffect(() => {
        localStorage.setItem(key, JSON.stringify(value));
    }, [key, value]);

    return [value, setValue];
}
