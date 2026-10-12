import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface GameDataContextType {
    versions: string[];
    selectedVersion: string;
    setSelectedVersion: (version: string) => void;
    isLoadingVersions: boolean;
    isDebug: boolean;
}

const GameDataContext = createContext<GameDataContextType | undefined>(undefined);

export function GameDataProvider({ children }: { children: ReactNode }) {
    const [versions, setVersions] = useState<string[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');
    const [isLoadingVersions, setIsLoadingVersions] = useState(true);
    // Read synchronously so debug-only routes do not redirect away on the first render.
    const [isDebug, setIsDebug] = useState(() => typeof window !== 'undefined' && window.location.href.includes('debug=true'));

    useEffect(() => {
        const checkDebug = () => {
            const hasDebug = window.location.href.includes('debug=true');
            setIsDebug(hasDebug);
        };
        checkDebug();
        window.addEventListener('hashchange', checkDebug);
        return () => window.removeEventListener('hashchange', checkDebug);
    }, []);

    useEffect(() => {
        async function fetchVersions() {
            const versionsUrl = `${import.meta.env.BASE_URL}parsed_configs/versions.json`;
            console.log(`[GameDataContext] Fetching versions from: ${versionsUrl}`);
            
            try {
                const res = await fetch(versionsUrl);
                if (res.ok) {
                    try {
                        const v = await res.json();
                        if (Array.isArray(v) && v.length > 0) {
                            v.sort((a: string, b: string) => b.localeCompare(a));
                            console.log(`[GameDataContext] Versions loaded: ${v.join(', ')}`);
                            setVersions(v);
                            setSelectedVersion(v[0]);
                            setIsLoadingVersions(false);
                            return;
                        }
                    } catch (parseError) {
                        console.error("[GameDataContext] Failed to parse versions.json", parseError);
                    }
                } else {
                    console.error(`[GameDataContext] versions.json fetch failed with status: ${res.status}`);
                }
            } catch (e) {
                console.error("[GameDataContext] Failed to fetch versions", e);
            }
            // Last resort: version_delta.json is rewritten by every config import and names the
            // newest version, so this fallback can never pin the app to an old config.
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}parsed_configs/version_delta.json`);
                const delta = res.ok ? await res.json() : null;
                if (delta && typeof delta.version === 'string') {
                    setVersions([delta.version]);
                    setSelectedVersion(delta.version);
                }
            } catch (e) {
                console.error("[GameDataContext] Failed to resolve a fallback version", e);
            }
            setIsLoadingVersions(false);
        }
        fetchVersions();
    }, []);

    // The app only ever shows the newest config. The setter is kept for API compatibility but
    // refuses anything other than the newest version, so no page can drift onto old data.
    const setLatestOnly = (version: string) => {
        if (versions.length === 0 || version === versions[0]) setSelectedVersion(version);
    };

    return (
        <GameDataContext.Provider value={{ versions, selectedVersion, setSelectedVersion: setLatestOnly, isLoadingVersions, isDebug }}>
            {children}
        </GameDataContext.Provider>
    );
}

export function useGameDataContext() {
    const context = useContext(GameDataContext);
    if (context === undefined) {
        throw new Error('useGameDataContext must be used within a GameDataProvider');
    }
    return context;
}
