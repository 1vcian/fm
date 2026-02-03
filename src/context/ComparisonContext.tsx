import React, { createContext, useContext, useState, useCallback } from 'react';
import { UserProfile } from '../types/Profile';
import { useProfile } from './ProfileContext';

interface ComparisonContextType {
    isComparing: boolean;
    originalItems: UserProfile['items'] | null;
    testItems: UserProfile['items'] | null;
    snapshotItems: UserProfile['items'] | null;

    enterCompareMode: () => void;
    exitCompareMode: () => void;
    updateOriginalItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateTestItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
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

    const enterCompareMode = useCallback(() => {
        const clonedItems = JSON.parse(JSON.stringify(profile.items));
        setOriginalItems(clonedItems);
        setTestItems(JSON.parse(JSON.stringify(clonedItems)));
        setSnapshotItems(JSON.parse(JSON.stringify(clonedItems)));
        setIsComparing(true);
    }, [profile.items]);

    const exitCompareMode = useCallback(() => {
        setIsComparing(false);
        setOriginalItems(null);
        setTestItems(null);
        setSnapshotItems(null);
    }, []);

    const updateOriginalItem = useCallback((slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => {
        setOriginalItems(prev => prev ? { ...prev, [slot]: item } : null);
    }, []);

    const updateTestItem = useCallback((slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => {
        setTestItems(prev => prev ? { ...prev, [slot]: item } : null);
    }, []);

    const keepOriginal = useCallback(() => {
        if (originalItems) {
            updateNestedProfile('items', originalItems);
        }
        exitCompareMode();
    }, [originalItems, updateNestedProfile, exitCompareMode]);

    const applyTestBuild = useCallback(() => {
        if (testItems) {
            updateNestedProfile('items', testItems);
        }
        exitCompareMode();
    }, [testItems, updateNestedProfile, exitCompareMode]);

    return (
        <ComparisonContext.Provider value={{
            isComparing,
            originalItems,
            testItems,
            snapshotItems,
            enterCompareMode,
            exitCompareMode,
            updateOriginalItem,
            updateTestItem,
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
