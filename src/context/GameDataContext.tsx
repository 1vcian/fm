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
    const [isDebug, setIsDebug] = useState(false);

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
            try {
                const res = await fetch('./parsed_configs/versions.json');
                if (res.ok) {
                    const v = await res.json();
                    v.sort((a: string, b: string) => b.localeCompare(a));
                    setVersions(v);
                    if (v.length > 0) {
                        setSelectedVersion(v[0]); // Default to latest
                    }
                }
            } catch (e) {
                console.error("Failed to load versions", e);
            } finally {
                setIsLoadingVersions(false);
            }
        }
        fetchVersions();
    }, []);

    return (
        <GameDataContext.Provider value={{ versions, selectedVersion, setSelectedVersion, isLoadingVersions, isDebug }}>
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
