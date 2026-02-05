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

    enterCompareMode: () => void;
    exitCompareMode: () => void;
    updateOriginalItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateTestItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateOriginalMount: (mount: MountSlot | null) => void;
    updateTestMount: (mount: MountSlot | null) => void;
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

    const enterCompareMode = useCallback(() => {
        const clonedItems = JSON.parse(JSON.stringify(profile.items));
        setOriginalItems(clonedItems);
        setTestItems(JSON.parse(JSON.stringify(clonedItems)));
        setSnapshotItems(JSON.parse(JSON.stringify(clonedItems)));

        const clonedMount = profile.mount.active ? JSON.parse(JSON.stringify(profile.mount.active)) : null;
        setOriginalMount(clonedMount);
        setTestMount(clonedMount ? JSON.parse(JSON.stringify(clonedMount)) : null);
        setSnapshotMount(clonedMount ? JSON.parse(JSON.stringify(clonedMount)) : null);

        setIsComparing(true);
    }, [profile.items, profile.mount.active]);

    const exitCompareMode = useCallback(() => {
        setIsComparing(false);
        setOriginalItems(null);
        setTestItems(null);
        setSnapshotItems(null);
        setOriginalMount(null);
        setTestMount(null);
        setSnapshotMount(null);
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

    const keepOriginal = useCallback(() => {
        if (originalItems) {
            updateNestedProfile('items', originalItems);
        }
        if (originalMount !== undefined) {
            updateNestedProfile('mount', { active: originalMount });
        }
        exitCompareMode();
    }, [originalItems, originalMount, updateNestedProfile, exitCompareMode]);

    const applyTestBuild = useCallback(() => {
        if (testItems) {
            updateNestedProfile('items', testItems);
        }
        if (testMount !== undefined) {
            updateNestedProfile('mount', { active: testMount });
        }
        exitCompareMode();
    }, [testItems, testMount, updateNestedProfile, exitCompareMode]);

    return (
        <ComparisonContext.Provider value={{
            isComparing,
            originalItems,
            testItems,
            snapshotItems,
            originalMount,
            testMount,
            snapshotMount,
            enterCompareMode,
            exitCompareMode,
            updateOriginalItem,
            updateTestItem,
            updateOriginalMount,
            updateTestMount,
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
