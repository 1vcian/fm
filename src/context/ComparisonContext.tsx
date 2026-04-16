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
    originalPets: UserProfile['pets']['active'] | null;
    testPets: UserProfile['pets']['active'] | null;
    snapshotPets: UserProfile['pets']['active'] | null;
    originalPetAscension: number | null;
    testPetAscension: number | null;
    snapshotPetAscension: number | null;
    originalSkills: UserProfile['skills']['equipped'] | null;
    testSkills: UserProfile['skills']['equipped'] | null;
    snapshotSkills: UserProfile['skills']['equipped'] | null;
    originalSkillAscension: number | null;
    testSkillAscension: number | null;
    snapshotSkillAscension: number | null;

    enterCompareMode: () => void;
    exitCompareMode: () => void;
    updateOriginalItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateTestItem: (slot: keyof UserProfile['items'], item: UserProfile['items'][keyof UserProfile['items']]) => void;
    updateOriginalMount: (mount: MountSlot | null) => void;
    updateTestMount: (mount: MountSlot | null) => void;
    updateOriginalPet: (pets: UserProfile['pets']['active']) => void;
    updateTestPet: (pets: UserProfile['pets']['active']) => void;
    updateOriginalSkill: (skills: UserProfile['skills']['equipped']) => void;
    updateTestSkill: (skills: UserProfile['skills']['equipped']) => void;
    updateOriginalForgeAscension: (level: number) => void;
    updateTestForgeAscension: (level: number) => void;
    updateOriginalMountAscension: (level: number) => void;
    updateTestMountAscension: (level: number) => void;
    updateOriginalPetAscension: (level: number) => void;
    updateTestPetAscension: (level: number) => void;
    updateOriginalSkillAscension: (level: number) => void;
    updateTestSkillAscension: (level: number) => void;
    keepOriginal: () => void;
    applyTestBuild: () => void;
    isCompactStats: boolean;
    setIsCompactStats: (val: boolean) => void;
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

    const [originalPets, setOriginalPets] = useState<UserProfile['pets']['active'] | null>(null);
    const [testPets, setTestPets] = useState<UserProfile['pets']['active'] | null>(null);
    const [snapshotPets, setSnapshotPets] = useState<UserProfile['pets']['active'] | null>(null);
    const [originalPetAscension, setOriginalPetAscension] = useState<number | null>(null);
    const [testPetAscension, setTestPetAscension] = useState<number | null>(null);
    const [snapshotPetAscension, setSnapshotPetAscension] = useState<number | null>(null);

    const [originalSkills, setOriginalSkills] = useState<UserProfile['skills']['equipped'] | null>(null);
    const [testSkills, setTestSkills] = useState<UserProfile['skills']['equipped'] | null>(null);
    const [snapshotSkills, setSnapshotSkills] = useState<UserProfile['skills']['equipped'] | null>(null);
    const [originalSkillAscension, setOriginalSkillAscension] = useState<number | null>(null);
    const [testSkillAscension, setTestSkillAscension] = useState<number | null>(null);
    const [snapshotSkillAscension, setSnapshotSkillAscension] = useState<number | null>(null);
    const [isCompactStats, setIsCompactStats] = useState(true);

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

        const clonedPets = JSON.parse(JSON.stringify(profile.pets.active));
        setOriginalPets(clonedPets);
        setTestPets(JSON.parse(JSON.stringify(clonedPets)));
        setSnapshotPets(JSON.parse(JSON.stringify(clonedPets)));
        const currentPetAsc = profile.misc.petAscensionLevel || 0;
        setOriginalPetAscension(currentPetAsc);
        setTestPetAscension(currentPetAsc);
        setSnapshotPetAscension(currentPetAsc);

        const clonedSkills = JSON.parse(JSON.stringify(profile.skills.equipped));
        setOriginalSkills(clonedSkills);
        setTestSkills(JSON.parse(JSON.stringify(clonedSkills)));
        setSnapshotSkills(JSON.parse(JSON.stringify(clonedSkills)));
        const currentSkillAsc = profile.misc.skillAscensionLevel || 0;
        setOriginalSkillAscension(currentSkillAsc);
        setTestSkillAscension(currentSkillAsc);
        setSnapshotSkillAscension(currentSkillAsc);

        setIsComparing(true);
    }, [profile]);

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
        setOriginalPets(null);
        setTestPets(null);
        setSnapshotPets(null);
        setOriginalPetAscension(null);
        setTestPetAscension(null);
        setSnapshotPetAscension(null);
        setOriginalSkills(null);
        setTestSkills(null);
        setSnapshotSkills(null);
        setOriginalSkillAscension(null);
        setTestSkillAscension(null);
        setSnapshotSkillAscension(null);
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

    const updateOriginalPet = useCallback((pets: UserProfile['pets']['active']) => {
        setOriginalPets(pets);
    }, []);

    const updateTestPet = useCallback((pets: UserProfile['pets']['active']) => {
        setTestPets(pets);
    }, []);

    const updateOriginalSkill = useCallback((skills: UserProfile['skills']['equipped']) => {
        setOriginalSkills(skills);
    }, []);

    const updateTestSkill = useCallback((skills: UserProfile['skills']['equipped']) => {
        setTestSkills(skills);
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

    const updateOriginalPetAscension = useCallback((level: number) => {
        setOriginalPetAscension(level);
    }, []);

    const updateTestPetAscension = useCallback((level: number) => {
        setTestPetAscension(level);
    }, []);

    const updateOriginalSkillAscension = useCallback((level: number) => {
        setOriginalSkillAscension(level);
    }, []);

    const updateTestSkillAscension = useCallback((level: number) => {
        setTestSkillAscension(level);
    }, []);

    const keepOriginal = useCallback(() => {
        if (originalItems) {
            updateNestedProfile('items', originalItems);
        }
        if (originalMount !== undefined) {
            updateNestedProfile('mount', { active: originalMount });
        }
        if (originalPets) {
            updateNestedProfile('pets', { active: originalPets });
        }
        if (originalSkills) {
            updateNestedProfile('skills', { equipped: originalSkills });
        }
        
        const miscUpdates: any = {};
        if (originalForgeAscension !== null) miscUpdates.forgeAscensionLevel = originalForgeAscension;
        if (originalMountAscension !== null) miscUpdates.mountAscensionLevel = originalMountAscension;
        if (originalPetAscension !== null) miscUpdates.petAscensionLevel = originalPetAscension;
        if (originalSkillAscension !== null) miscUpdates.skillAscensionLevel = originalSkillAscension;
        
        if (Object.keys(miscUpdates).length > 0) {
            updateNestedProfile('misc', miscUpdates);
        }
        exitCompareMode();
    }, [originalItems, originalMount, originalPets, originalSkills, originalForgeAscension, originalMountAscension, originalPetAscension, originalSkillAscension, updateNestedProfile, exitCompareMode]);

    const applyTestBuild = useCallback(() => {
        if (testItems) {
            updateNestedProfile('items', testItems);
        }
        if (testMount !== undefined) {
            updateNestedProfile('mount', { active: testMount });
        }
        if (testPets) {
            updateNestedProfile('pets', { active: testPets });
        }
        if (testSkills) {
            updateNestedProfile('skills', { equipped: testSkills });
        }

        const miscUpdates: any = {};
        if (testForgeAscension !== null) miscUpdates.forgeAscensionLevel = testForgeAscension;
        if (testMountAscension !== null) miscUpdates.mountAscensionLevel = testMountAscension;
        if (testPetAscension !== null) miscUpdates.petAscensionLevel = testPetAscension;
        if (testSkillAscension !== null) miscUpdates.skillAscensionLevel = testSkillAscension;

        if (Object.keys(miscUpdates).length > 0) {
            updateNestedProfile('misc', miscUpdates);
        }
        exitCompareMode();
    }, [testItems, testMount, testPets, testSkills, testForgeAscension, testMountAscension, testPetAscension, testSkillAscension, updateNestedProfile, exitCompareMode]);

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
            originalPets,
            testPets,
            snapshotPets,
            originalPetAscension,
            testPetAscension,
            snapshotPetAscension,
            originalSkills,
            testSkills,
            snapshotSkills,
            originalSkillAscension,
            testSkillAscension,
            snapshotSkillAscension,
            enterCompareMode,
            exitCompareMode,
            updateOriginalItem,
            updateTestItem,
            updateOriginalMount,
            updateTestMount,
            updateOriginalPet,
            updateTestPet,
            updateOriginalSkill,
            updateTestSkill,
            updateOriginalForgeAscension,
            updateTestForgeAscension,
            updateOriginalMountAscension,
            updateTestMountAscension,
            updateOriginalPetAscension,
            updateTestPetAscension,
            updateOriginalSkillAscension,
            updateTestSkillAscension,
            keepOriginal,
            applyTestBuild,
            isCompactStats,
            setIsCompactStats,
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
