import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, INITIAL_PROFILE, generateProfileId } from '../types/Profile';
import LZString from 'lz-string';

const STORAGE_KEY = 'forgeMaster_profiles';
const ACTIVE_PROFILE_KEY = 'forgeMaster_activeProfileId';

interface ProfileContextType {
    // Current profile
    profile: UserProfile;
    updateProfile: (updates: Partial<UserProfile>) => void;
    updateNestedProfile: (section: keyof UserProfile, data: any) => void;

    // Multi-profile management
    profiles: UserProfile[];
    activeProfileId: string;
    switchProfile: (profileId: string) => void;
    createProfile: (name?: string) => UserProfile;
    cloneProfile: () => UserProfile;
    deleteProfile: (profileId: string) => void;
    renameProfile: (name: string) => boolean; // Returns false if name already exists
    setProfileIcon: (iconIndex: number) => void;

    // Save/Export/Import
    saveProfile: () => void;
    resetProfile: () => void;
    exportProfile: () => void;
    importProfile: (file: File) => Promise<void>;
    importProfileFromJsonString: (jsonString: string) => void;

    // Sharing
    saveSharedProfile: () => void; // Save the currently viewed shared profile to local storage

    // Convenience Helpers
    getTechLevel: (tree: 'Forge' | 'Power' | 'SkillsPetTech', nodeId: number) => number;
    getDungeonLevel: (dungeonId: string) => number;

    // Validation
    isNameTaken: (name: string, excludeId?: string) => boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// Initialize profiles synchronously from localStorage
const getInitialProfiles = (): { profiles: UserProfile[], activeId: string } => {
    try {
        const savedProfiles = localStorage.getItem(STORAGE_KEY);
        const savedActiveId = localStorage.getItem(ACTIVE_PROFILE_KEY);

        if (savedProfiles) {
            const parsed = JSON.parse(savedProfiles) as UserProfile[];
            const migrated = parsed.map((p) => ({
                ...INITIAL_PROFILE,
                ...p,
                id: p.id || generateProfileId(),
                iconIndex: p.iconIndex ?? 0,
            }));

            if (migrated.length > 0) {
                const activeId = (savedActiveId && migrated.some(p => p.id === savedActiveId))
                    ? savedActiveId
                    : migrated[0].id;
                return { profiles: migrated, activeId };
            }
        }

        // Check for legacy single profile
        const legacyProfile = localStorage.getItem('forgeMaster_profile');
        if (legacyProfile) {
            const parsed = JSON.parse(legacyProfile);
            const migratedProfile: UserProfile = {
                ...INITIAL_PROFILE,
                ...parsed,
                id: generateProfileId(),
                iconIndex: 0,
            };
            localStorage.removeItem('forgeMaster_profile');
            return { profiles: [migratedProfile], activeId: migratedProfile.id };
        }
    } catch (e) {
        console.error("Failed to parse profiles", e);
    }

    // Default profile
    const defaultProfile: UserProfile = {
        ...INITIAL_PROFILE,
        id: generateProfileId(),
        name: 'Profile 1',
        iconIndex: 0,
    };
    return { profiles: [defaultProfile], activeId: defaultProfile.id };
};

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState(() => getInitialProfiles());
    const { profiles, activeId: activeProfileId } = state;
    const [importedProfile, setImportedProfile] = useState<UserProfile | null>(null);

    // Check for shared profile in URL on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const b62c = params.get('b62c'); // New compressed format
        const b62 = params.get('b62');   // Old format

        try {
            let json = null;

            if (b62c) {
                json = LZString.decompressFromEncodedURIComponent(b62c);
            } else if (b62) {
                json = atob(b62);
            }

            if (json) {
                const parsed = JSON.parse(json);
                // Ensure it has basic structure
                if (parsed && typeof parsed === 'object') {
                    const sharedProfile: UserProfile = {
                        ...INITIAL_PROFILE,
                        ...parsed,
                        id: generateProfileId(),
                        name: parsed.name ? `${parsed.name} (Shared)` : 'Shared Profile',
                        isShared: true
                    };
                    setImportedProfile(sharedProfile);
                }
            }
        } catch (e) {
            console.error("Failed to parse shared profile", e);
        }
    }, []);

    // Setter helpers to update state
    const setProfiles = (updater: UserProfile[] | ((prev: UserProfile[]) => UserProfile[])) => {
        setState(prev => ({
            ...prev,
            profiles: typeof updater === 'function' ? updater(prev.profiles) : updater
        }));
    };

    const setActiveProfileId = (id: string) => {
        setState(prev => ({ ...prev, activeId: id }));
    };

    // Get current profile (prioritize imported profile if viewing)
    const profile = importedProfile || profiles.find(p => p.id === activeProfileId) || profiles[0] || INITIAL_PROFILE;

    // Save all profiles to localStorage
    const saveAllProfiles = useCallback((profilesToSave: UserProfile[], activeId: string) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profilesToSave));
        localStorage.setItem(ACTIVE_PROFILE_KEY, activeId);
    }, []);

    // Auto-save on change (ONLY if NOT viewing a shared profile)
    useEffect(() => {
        if (!importedProfile && profiles.length > 0 && activeProfileId) {
            const timeout = setTimeout(() => {
                saveAllProfiles(profiles, activeProfileId);
            }, 500);
            return () => clearTimeout(timeout);
        }
    }, [profiles, activeProfileId, saveAllProfiles, importedProfile]);

    const updateProfile = useCallback((updates: Partial<UserProfile>) => {
        if (importedProfile) {
            // Allow updates to local shared profile state without persistence
            setImportedProfile(prev => prev ? { ...prev, ...updates } : null);
        } else {
            setProfiles(prev => prev.map(p =>
                p.id === activeProfileId ? { ...p, ...updates } : p
            ));
        }
    }, [activeProfileId, importedProfile]);

    const updateNestedProfile = useCallback((section: keyof UserProfile, data: any) => {
        if (importedProfile) {
            setImportedProfile(prev => {
                if (!prev) return null;
                const sectionValue = prev[section];
                if (typeof sectionValue === 'object' && sectionValue !== null) {
                    return { ...prev, [section]: { ...sectionValue, ...data } };
                }
                return { ...prev, [section]: data };
            });
        } else {
            setProfiles(prev => prev.map(p => {
                if (p.id !== activeProfileId) return p;
                const sectionValue = p[section];
                if (typeof sectionValue === 'object' && sectionValue !== null) {
                    return {
                        ...p,
                        [section]: {
                            ...sectionValue,
                            ...data
                        }
                    };
                }
                return { ...p, [section]: data };
            }));
        }
    }, [activeProfileId, importedProfile]);

    const isNameTaken = useCallback((name: string, excludeId?: string) => {
        return profiles.some(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== excludeId);
    }, [profiles]);

    const getNextProfileName = useCallback(() => {
        let counter = profiles.length + 1;
        let name = `Profile ${counter}`;
        while (isNameTaken(name)) {
            counter++;
            name = `Profile ${counter}`;
        }
        return name;
    }, [profiles.length, isNameTaken]);

    const createProfile = useCallback((name?: string) => {
        if (importedProfile) setImportedProfile(null); // Clear imported mode

        const newProfile: UserProfile = {
            ...INITIAL_PROFILE,
            id: generateProfileId(),
            name: name || getNextProfileName(),
            iconIndex: Math.floor(Math.random() * 64), // Random icon
        };

        // Check name uniqueness
        if (isNameTaken(newProfile.name)) {
            newProfile.name = getNextProfileName();
        }

        setProfiles(prev => [...prev, newProfile]);
        setActiveProfileId(newProfile.id);
        return newProfile;
    }, [getNextProfileName, isNameTaken, importedProfile]);

    const cloneProfile = useCallback(() => {
        const currentProfile = importedProfile || profiles.find(p => p.id === activeProfileId);
        if (!currentProfile) return createProfile();

        let cloneName = `${currentProfile.name} (Copy)`;
        let counter = 1;
        while (isNameTaken(cloneName)) {
            counter++;
            cloneName = `${currentProfile.name} (Copy ${counter})`;
        }

        const clonedProfile: UserProfile = {
            ...JSON.parse(JSON.stringify(currentProfile)), // Deep clone
            id: generateProfileId(),
            name: cloneName,
            isShared: undefined // Remove shared flag on clone
        };

        setImportedProfile(null); // Exit shared mode
        setProfiles(prev => [...prev, clonedProfile]);
        setActiveProfileId(clonedProfile.id);
        return clonedProfile;
    }, [profiles, activeProfileId, isNameTaken, createProfile, importedProfile]);

    const deleteProfile = useCallback((profileId: string) => {
        if (importedProfile && profileId === importedProfile.id) {
            setImportedProfile(null);
            return;
        }

        setProfiles(prev => {
            const filtered = prev.filter(p => p.id !== profileId);

            // If we deleted the active profile, switch to another
            if (profileId === activeProfileId && filtered.length > 0) {
                setActiveProfileId(filtered[0].id);
            } else if (filtered.length === 0) {
                // Create a new default profile if all deleted
                const defaultProfile: UserProfile = {
                    ...INITIAL_PROFILE,
                    id: generateProfileId(),
                    name: 'Profile 1',
                    iconIndex: 0,
                };
                setActiveProfileId(defaultProfile.id);
                return [defaultProfile];
            }

            return filtered;
        });
    }, [activeProfileId, importedProfile]);

    const switchProfile = useCallback((profileId: string) => {
        setImportedProfile(null); // Exit shared mode
        if (profiles.some(p => p.id === profileId)) {
            setActiveProfileId(profileId);
        }
    }, [profiles]);

    const renameProfile = useCallback((name: string): boolean => {
        if (isNameTaken(name, activeProfileId)) {
            return false;
        }
        updateProfile({ name });
        return true;
    }, [isNameTaken, activeProfileId, updateProfile]);

    const setProfileIcon = useCallback((iconIndex: number) => {
        updateProfile({ iconIndex });
    }, [updateProfile]);

    const saveProfile = useCallback(() => {
        if (!importedProfile) {
            saveAllProfiles(profiles, activeProfileId);
        }
    }, [profiles, activeProfileId, saveAllProfiles, importedProfile]);

    const saveSharedProfile = useCallback(() => {
        if (!importedProfile) return;

        let newName = importedProfile.name.replace(' (Shared)', '');
        let counter = 1;
        while (isNameTaken(newName)) {
            newName = `${importedProfile.name.replace(' (Shared)', '')} (${counter})`;
            counter++;
        }

        const newProfile: UserProfile = {
            ...importedProfile,
            id: generateProfileId(),
            name: newName,
            isShared: undefined
        };

        setProfiles(prev => [...prev, newProfile]);
        setActiveProfileId(newProfile.id);
        setImportedProfile(null);

        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
    }, [importedProfile, isNameTaken]);

    const resetProfile = useCallback(() => {
        if (importedProfile) {
            // Reset shared profile to initial (weird case, but ok)
            setImportedProfile(prev => prev ? { ...INITIAL_PROFILE, id: prev.id, name: prev.name, iconIndex: prev.iconIndex, isShared: true } : null);
        } else {
            setProfiles(prev => prev.map(p =>
                p.id === activeProfileId
                    ? { ...INITIAL_PROFILE, id: p.id, name: p.name, iconIndex: p.iconIndex }
                    : p
            ));
        }
    }, [activeProfileId, importedProfile]);

    const exportProfile = useCallback(async () => {
        const currentProfile = importedProfile || profiles.find(p => p.id === activeProfileId);
        if (!currentProfile) return;

        const filename = `${currentProfile.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
        const jsonStr = JSON.stringify(currentProfile, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const file = new File([blob], filename, { type: "application/json" });

        // Try Native Share (Mobile/Supported Browsers)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Export Profile',
                    text: 'ForgeMaster Profile Config',
                });
                return;
            } catch (err) {
                // User cancelled or share failed, fall through to download
                if ((err as Error).name !== 'AbortError') {
                    console.error('Share failed:', err);
                }
            }
        }

        // Fallback: Blob Download (Desktop)
        // Better than Data URI for handling filenames
        const url = URL.createObjectURL(blob);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", url);
        downloadAnchorNode.setAttribute("download", filename);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        URL.revokeObjectURL(url);
    }, [profiles, activeProfileId, importedProfile]);

    const importProfile = useCallback(async (file: File) => {
        const text = await file.text();
        try {
            const parsed = JSON.parse(text);
            if (parsed.items && parsed.techTree) {

                // Generate new ID for the imported profile
                const newId = generateProfileId();

                // Create new profile object
                const importedProfileData: UserProfile = {
                    ...INITIAL_PROFILE,
                    ...parsed,
                    id: newId,
                    iconIndex: parsed.iconIndex ?? 0,
                    isShared: undefined // Ensure not shared status
                };

                // Ensure name uniqueness
                let newName = importedProfileData.name;
                if (isNameTaken(newName)) {
                    newName = `${newName} (Imported)`;
                    let counter = 1;
                    while (isNameTaken(newName)) {
                        newName = `${importedProfileData.name} (Imported ${counter})`;
                        counter++;
                    }
                }
                importedProfileData.name = newName;

                // Clear any temporary shared profile view
                setImportedProfile(null);

                // Add to list and switch
                setProfiles(prev => [...prev, importedProfileData]);
                setActiveProfileId(newId);

            } else {
                alert("Invalid profile file format.");
            }
        } catch (e) {
            console.error("Import failed", e);
            alert("Failed to parse JSON file.");
        }
    }, [isNameTaken]);

    // --- Helpers ---
    const getTechLevel = useCallback((tree: 'Forge' | 'Power' | 'SkillsPetTech', nodeId: number) => {
        return profile.techTree[tree]?.[nodeId] || 0;
    }, [profile.techTree]);

    const getDungeonLevel = useCallback((dungeonId: string) => {
        return profile.misc.dungeonLevels[dungeonId] || 1;
    }, [profile.misc.dungeonLevels]);

    const importProfileFromJsonString = useCallback((jsonString: string) => {
        try {
            const parsed = JSON.parse(jsonString);
            if (parsed.items && parsed.techTree) {

                // Generate new ID
                const newId = generateProfileId();

                // Create new profile object
                const importedProfileData: UserProfile = {
                    ...INITIAL_PROFILE,
                    ...parsed,
                    id: newId,
                    iconIndex: parsed.iconIndex ?? 0,
                    isShared: undefined
                };

                // Ensure name uniqueness
                let newName = importedProfileData.name;
                if (isNameTaken(newName)) {
                    newName = `${newName} (Imported)`;
                    let counter = 1;
                    while (isNameTaken(newName)) {
                        newName = `${importedProfileData.name} (Imported ${counter})`;
                        counter++;
                    }
                }
                importedProfileData.name = newName;

                // Clear temporary shared profile
                setImportedProfile(null);

                // Add and switch
                setProfiles(prev => [...prev, importedProfileData]);
                setActiveProfileId(newId);

            } else {
                alert("Invalid profile format: Missing items or techTree.");
            }
        } catch (e) {
            console.error("Import failed", e);
            alert("Failed to parse JSON string.");
        }
    }, [isNameTaken]);

    return (
        <ProfileContext.Provider value={{
            profile,
            updateProfile,
            updateNestedProfile,
            profiles,
            activeProfileId: importedProfile ? importedProfile.id : activeProfileId,
            switchProfile,
            createProfile,
            cloneProfile,
            deleteProfile,
            renameProfile,
            setProfileIcon,
            saveProfile,
            resetProfile,
            exportProfile,
            importProfile,
            importProfileFromJsonString, // New export
            saveSharedProfile,
            getTechLevel,
            getDungeonLevel,
            isNameTaken,
        }}>
            {children}
        </ProfileContext.Provider>
    );
};

export const useProfile = () => {
    const context = useContext(ProfileContext);
    if (context === undefined) {
        throw new Error('useProfile must be used within a ProfileProvider');
    }
    return context;
};
