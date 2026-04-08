import React, { createContext, useContext, useState, useCallback } from 'react';
import { UserProfile, MountSlot } from '../types/Profile';
import { useProfile } from './ProfileContext';

interface ComparisonContextType {
    isComparing: boolean;
    originalItems: UserProfile['items'] | null;
    testItems: UserProfile['items'] | null;
    snapshotItems: UserProfile['items'] | null;
    originalMount: MountSlot | null;
    testMount: MountSlot | null;
    snapshotMount: MountSlot | null;
    originalForgeAscension: number | null;
    testForgeAscension: number | null;
    snapshotForgeAscension: number | null;
    originalMountAscension: number | null;
    testMountAscension: number | null;
    snapshotMountAscension: number | null;

    enterCompareMode: () => void;
    exitCompareMode: () => void;
    updateOriginalItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateTestItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateOriginalMount: (mount: MountSlot | null) => void;
    updateTestMount: (mount: MountSlot | null) => void;
    updateOriginalForgeAscension: (level: number) => void;
    updateTestForgeAscension: (level: number) => void;
    updateOriginalMountAscension: (level: number) => void;
    updateTestMountAscension: (level: number) => void;
    keepOriginal: () => void;
    applyTestBuild: () => void;
}

const ComparisonContext = createContext<ComparisonContextType | undefined>(undefined);

export const ComparisonProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { profile, updateNestedProfile } = useProfile();

    const [isComparing, setIsComparing] = useState(false);
    const [originalItems, setOriginalItems] = useState<UserProfile['items'] | null>(null);
    const [testItems, setTestItems] = useState<UserProfile['items'] | null>(null);
    const [snapshotItems, setSnapshotItems] = useState<UserProfile['items'] | null>(null);
    const [originalMount, setOriginalMount] = useState<MountSlot | null>(null);
    const [testMount, setTestMount] = useState<MountSlot | null>(null);
    const [snapshotMount, setSnapshotMount] = useState<MountSlot | null>(null);
    const [originalForgeAscension, setOriginalForgeAscension] = useState<number | null>(null);
    const [testForgeAscension, setTestForgeAscension] = useState<number | null>(null);
    const [snapshotForgeAscension, setSnapshotForgeAscension] = useState<number | null>(null);
    const [originalMountAscension, setOriginalMountAscension] = useState<number | null>(null);
    const [testMountAscension, setTestMountAscension] = useState<number | null>(null);
    const [snapshotMountAscension, setSnapshotMountAscension] = useState<number | null>(null);

    const enterCompareMode = useCallback(() => {
        const clonedItems = JSON.parse(JSON.stringify(profile.items));
        setOriginalItems(clonedItems);
        setTestItems(JSON.parse(JSON.stringify(clonedItems)));
        setSnapshotItems(JSON.parse(JSON.stringify(clonedItems)));

        const clonedMount = profile.mount.active ? JSON.parse(JSON.stringify(profile.mount.active)) : null;
        setOriginalMount(clonedMount);
        setTestMount(clonedMount ? JSON.parse(JSON.stringify(clonedMount)) : null);
        setSnapshotMount(clonedMount ? JSON.parse(JSON.stringify(clonedMount)) : null);

        const currentForgeAsc = profile.misc.forgeAscensionLevel || 0;
        setOriginalForgeAscension(currentForgeAsc);
        setTestForgeAscension(currentForgeAsc);
        setSnapshotForgeAscension(currentForgeAsc);

        const currentMountAsc = profile.misc.mountAscensionLevel || 0;
        setOriginalMountAscension(currentMountAsc);
        setTestMountAscension(currentMountAsc);
        setSnapshotMountAscension(currentMountAsc);

        setIsComparing(true);
    }, [profile.items, profile.mount.active, profile.misc.forgeAscensionLevel, profile.misc.mountAscensionLevel]);

    const exitCompareMode = useCallback(() => {
        setIsComparing(false);
        setOriginalItems(null);
        setTestItems(null);
        setSnapshotItems(null);
        setOriginalMount(null);
        setTestMount(null);
        setSnapshotMount(null);
        setOriginalForgeAscension(null);
        setTestForgeAscension(null);
        setSnapshotForgeAscension(null);
        setOriginalMountAscension(null);
        setTestMountAscension(null);
        setSnapshotMountAscension(null);
    }, []);

    const updateOriginalItem = useCallback((slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => {
        setOriginalItems(prev => prev ? { ...prev, [slot]: item } : null);
    }, []);

    const updateTestItem = useCallback((slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => {
        setTestItems(prev => prev ? { ...prev, [slot]: item } : null);
    }, []);

    const updateOriginalMount = useCallback((mount: MountSlot | null) => {
        setOriginalMount(mount);
    }, []);

    const updateTestMount = useCallback((mount: MountSlot | null) => {
        setTestMount(mount);
    }, []);

    const updateOriginalForgeAscension = useCallback((level: number) => {
        setOriginalForgeAscension(level);
    }, []);

    const updateTestForgeAscension = useCallback((level: number) => {
        setTestForgeAscension(level);
    }, []);

    const updateOriginalMountAscension = useCallback((level: number) => {
        setOriginalMountAscension(level);
    }, []);

    const updateTestMountAscension = useCallback((level: number) => {
        setTestMountAscension(level);
    }, []);

    const keepOriginal = useCallback(() => {
        if (originalItems) {
            updateNestedProfile('items', originalItems);
        }
        if (originalMount !== undefined) {
            updateNestedProfile('mount', { active: originalMount });
        }
        if (originalForgeAscension !== null) {
            updateNestedProfile('misc', { forgeAscensionLevel: originalForgeAscension });
        }
        if (originalMountAscension !== null) {
            updateNestedProfile('misc', { mountAscensionLevel: originalMountAscension });
        }
        exitCompareMode();
    }, [originalItems, originalMount, originalForgeAscension, originalMountAscension, updateNestedProfile, exitCompareMode]);

    const applyTestBuild = useCallback(() => {
        if (testItems) {
            updateNestedProfile('items', testItems);
        }
        if (testMount !== undefined) {
            updateNestedProfile('mount', { active: testMount });
        }
        if (testForgeAscension !== null) {
            updateNestedProfile('misc', { forgeAscensionLevel: testForgeAscension });
        }
        if (testMountAscension !== null) {
            updateNestedProfile('misc', { mountAscensionLevel: testMountAscension });
        }
        exitCompareMode();
    }, [testItems, testMount, testForgeAscension, testMountAscension, updateNestedProfile, exitCompareMode]);

    return (
        <ComparisonContext.Provider value={{
            isComparing,
            originalItems,
            testItems,
            snapshotItems,
            originalMount,
            testMount,
            snapshotMount,
            originalForgeAscension,
            testForgeAscension,
            snapshotForgeAscension,
            originalMountAscension,
            testMountAscension,
            snapshotMountAscension,
            enterCompareMode,
            exitCompareMode,
            updateOriginalItem,
            updateTestItem,
            updateOriginalMount,
            updateTestMount,
            updateOriginalForgeAscension,
            updateTestForgeAscension,
            updateOriginalMountAscension,
            updateTestMountAscension,
            keepOriginal,
            applyTestBuild,
        }}>
            {children}
        </ComparisonContext.Provider>
    );
};

export const useComparison = () => {
    const context = useContext(ComparisonContext);
    if (context === undefined) {
        throw new Error('useComparison must be used within a ComparisonProvider');
    }
    return context;
};
