/**
 * ⚠️ THIS IMPORT MUST STAY FIRST.
 *
 * `authUrl` lifts Supabase's magic-link parameters out of the URL as a side effect of being
 * loaded. It has to win the race against `SHARE_SOURCE` below, which snapshots
 * `window.location.{search,hash}` at module-evaluation time: an implicit-flow callback puts
 * `#access_token=` in the very fragment the share payload lives in, and the share decoder would
 * see a garbled payload. Module evaluation is depth-first over the import list, so being the first
 * import is what guarantees the ordering. See `src/services/authUrl.ts`.
 */
import '../services/authUrl';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, INITIAL_PROFILE, generateProfileId } from '../types/Profile';
import {
    decodeSharedPayload,
    hasSharedPayload,
    sanitizeProfileForTransport,
    SharePayloadSource
} from '../utils/shareCodec';
import { ensureProfileIdsMigrated } from '../services/profileIdMigration';
import { useProfileSync, type ProfileSyncApi } from '../services/useProfileSync';

const STORAGE_KEY = 'forgeMaster_profiles';
const ACTIVE_PROFILE_KEY = 'forgeMaster_activeProfileId';

/**
 * The share payload is read from the URL at module load, BEFORE React (and the HashRouter
 * mounted inside this provider) can touch the fragment. Decoding it is async (gzip via
 * DecompressionStream), so the raw location is captured here and consumed by the effect below.
 */
const SHARE_SOURCE: SharePayloadSource = typeof window !== 'undefined'
    ? { search: window.location.search, hash: window.location.hash }
    : {};
const HAS_SHARE_PAYLOAD = hasSharedPayload(SHARE_SOURCE);

/** Drops the share payload (fragment or legacy query) but keeps the HashRouter route. */
const clearShareUrl = () => {
    window.history.replaceState({}, '', `${window.location.pathname}#/`);
};

const SLOT_TO_JSON_TYPE: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Helmet',
    'Body': 'Armour',
    'Gloves': 'Gloves',
    'Belt': 'Belt',
    'Necklace': 'Necklace',
    'Ring': 'Ring',
    'Shoe': 'Shoes'
};

const sanitizeProfile = (profile: UserProfile): UserProfile => {
    let itemsChanged = false;
    const newItems = { ...profile.items };

    for (const key of Object.keys(newItems)) {
        const item = newItems[key as keyof UserProfile['items']];
        const expectedType = SLOT_TO_JSON_TYPE[key] || key;
        
        if (item && item.skin && item.skin.type !== expectedType) {
            newItems[key as keyof UserProfile['items']] = { ...item, skin: undefined };
            itemsChanged = true;
        }
    }

    let savedItemsChanged = false;
    let newSavedItems = profile.savedItems;

    if (newSavedItems) {
        newSavedItems = { ...newSavedItems };
        for (const key of Object.keys(newSavedItems)) {
            const expectedType = SLOT_TO_JSON_TYPE[key] || key;
            let arrayChanged = false;
            const newArray = newSavedItems[key].map(item => {
                if (item && item.skin && item.skin.type !== expectedType) {
                        arrayChanged = true;
                        return { ...item, skin: undefined };
                    }
                    return item;
                });
                if (arrayChanged) {
                    newSavedItems[key] = newArray;
                    savedItemsChanged = true;
                }
        }
    }

    if (itemsChanged || savedItemsChanged) {
        return {
            ...profile,
            items: itemsChanged ? newItems : profile.items,
            savedItems: savedItemsChanged ? newSavedItems : profile.savedItems
        };
    }

    return profile;
};

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
    getTechLevel: (tree: 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan', nodeId: number) => number;
    getDungeonLevel: (dungeonId: string) => number;

    // Validation
    isNameTaken: (name: string, excludeId?: string) => boolean;

    /**
     * Account sync. Always present, and inert unless a backend is configured AND somebody is
     * signed in — `sync.status === 'local-only'` is the normal, non-error resting state.
     * See `src/services/useProfileSync.ts`.
     */
    sync: ProfileSyncApi;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// Initialize profiles synchronously from localStorage
const getInitialProfiles = (): { profiles: UserProfile[], activeId: string } => {
    // Rewrite pre-UUID profile ids before anything reads them. Runs at most once per browser,
    // never throws, and leaves storage untouched if it cannot complete. `profiles.id` is a `uuid`
    // column, so without this the first sync of an existing user would fail with 22P02 —
    // BACKEND_PLAN §7b, details in `src/services/profileIdMigration.ts`.
    ensureProfileIdsMigrated();

    try {
        const savedProfiles = localStorage.getItem(STORAGE_KEY);
        const savedActiveId = localStorage.getItem(ACTIVE_PROFILE_KEY);

        if (savedProfiles) {
            const parsed = JSON.parse(savedProfiles) as UserProfile[];
            const migrated = parsed.map((p) => {
                const migratedP = {
                    ...INITIAL_PROFILE,
                    ...p,
                    id: p.id || generateProfileId(),
                    iconIndex: p.iconIndex ?? 0,
                };
                return sanitizeProfile(migratedP);
            });

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
            const sanitizedProfile = sanitizeProfile(migratedProfile);
            localStorage.removeItem('forgeMaster_profile');
            return { profiles: [sanitizedProfile], activeId: sanitizedProfile.id };
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
    // True only while a share link is being decoded, so the app never flashes the local
    // profile before swapping to the shared one. Without a payload this is false from the
    // first render and nothing about the offline/normal boot changes.
    const [decodingShare, setDecodingShare] = useState(HAS_SHARE_PAYLOAD);

    // Check for shared profile in URL on mount (new '#p=' gzip format + legacy ?b62c / ?b62)
    useEffect(() => {
        if (!HAS_SHARE_PAYLOAD) return;
        let cancelled = false;

        decodeSharedPayload(SHARE_SOURCE)
            .then(parsed => {
                if (cancelled) return;
                // A malformed payload is simply ignored: the app boots on the local profiles.
                if (parsed) {
                    // Import ALWAYS mints a fresh id — the invariant clan membership rests on.
                    const sharedProfile: UserProfile = sanitizeProfile({
                        ...INITIAL_PROFILE,
                        ...parsed,
                        id: generateProfileId(),
                        name: parsed.name ? `${parsed.name} (Shared)` : 'Shared Profile',
                        isShared: true
                    });
                    setImportedProfile(sharedProfile);
                }
                setDecodingShare(false);
            })
            .catch(e => {
                console.error("Failed to parse shared profile", e);
                if (!cancelled) setDecodingShare(false);
            });

        return () => { cancelled = true; };
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

    /**
     * The write path the sync engine uses to bring server-side profiles in.
     *
     * A functional updater rather than a setter on purpose: a download can land while the user is
     * editing, so the engine must merge into whatever is in state *at that moment*, not into an
     * array captured when the request was sent. Returning `null` means "nothing changed", which
     * keeps a no-op pull from re-rendering the whole app.
     */
    const applyLocalProfiles = useCallback<
        (mutate: (profiles: UserProfile[], activeId: string) => { profiles: UserProfile[]; activeId: string } | null) => void
    >(mutate => {
        setState(prev => {
            const next = mutate(prev.profiles, prev.activeId);
            if (!next) return prev;
            const activeId = next.profiles.some(p => p.id === next.activeId)
                ? next.activeId
                : (next.profiles[0]?.id ?? prev.activeId);
            return { profiles: next.profiles, activeId };
        });
    }, []);

    // Get current profile (prioritize imported profile if viewing)
    const profile = importedProfile || profiles.find(p => p.id === activeProfileId) || profiles[0] || INITIAL_PROFILE;

    // Save all profiles to localStorage
    const saveAllProfiles = useCallback((profilesToSave: UserProfile[], activeId: string) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profilesToSave));
        localStorage.setItem(ACTIVE_PROFILE_KEY, activeId);
    }, []);

    // Auto-save on change (ONLY if NOT viewing a shared profile, and never while a share
    // link is still being decoded)
    useEffect(() => {
        if (!importedProfile && !decodingShare && profiles.length > 0 && activeProfileId) {
            const timeout = setTimeout(() => {
                saveAllProfiles(profiles, activeProfileId);
            }, 500);
            return () => clearTimeout(timeout);
        }
    }, [profiles, activeProfileId, saveAllProfiles, importedProfile, decodingShare]);

    const updateProfile = useCallback((updates: Partial<UserProfile>) => {
        // Any techTree write stamps techTreeUpdatedAt (used to flag stale tree data in the UI).
        const stamped = updates.techTree ? { ...updates, techTreeUpdatedAt: Date.now() } : updates;
        if (importedProfile) {
            // Allow updates to local shared profile state without persistence
            setImportedProfile(prev => prev ? { ...prev, ...stamped } : null);
        } else {
            setProfiles(prev => prev.map(p =>
                p.id === activeProfileId ? { ...p, ...stamped } : p
            ));
        }
    }, [activeProfileId, importedProfile]);

    const updateNestedProfile = useCallback((section: keyof UserProfile, data: any) => {
        const stamp = section === 'techTree' ? { techTreeUpdatedAt: Date.now() } : {};
        if (importedProfile) {
            setImportedProfile(prev => {
                if (!prev) return null;
                const sectionValue = prev[section];
                if (typeof sectionValue === 'object' && sectionValue !== null) {
                    return { ...prev, ...stamp, [section]: { ...sectionValue, ...data } };
                }
                return { ...prev, ...stamp, [section]: data };
            });
        } else {
            setProfiles(prev => prev.map(p => {
                if (p.id !== activeProfileId) return p;
                const sectionValue = p[section];
                if (typeof sectionValue === 'object' && sectionValue !== null) {
                    return {
                        ...p,
                        ...stamp,
                        [section]: {
                            ...sectionValue,
                            ...data
                        }
                    };
                }
                return { ...p, ...stamp, [section]: data };
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

        // Clean URL (keeps the router route, drops the shared payload)
        clearShareUrl();
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
        // Same sanitisation as the share link (no id / isShared / sync metadata), but plain
        // readable JSON — the export file is meant to be human-inspectable.
        const jsonStr = JSON.stringify(sanitizeProfileForTransport(currentProfile), null, 2);
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
                const importedProfileData: UserProfile = sanitizeProfile({
                    ...INITIAL_PROFILE,
                    ...parsed,
                    id: newId,
                    iconIndex: parsed.iconIndex ?? 0,
                    isShared: undefined // Ensure not shared status
                });

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
    const getTechLevel = useCallback((tree: 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan', nodeId: number) => {
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
                const importedProfileData: UserProfile = sanitizeProfile({
                    ...INITIAL_PROFILE,
                    ...parsed,
                    id: newId,
                    iconIndex: parsed.iconIndex ?? 0,
                    isShared: undefined
                });

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

    /**
     * Account sync. Additive by construction: `localStorage` above is still the working copy and
     * still the only thing the UI waits on. `suspended` covers the two cases where what is on
     * screen is not the user's own data (a share link being decoded, or one being viewed), which
     * must never be pushed to their account.
     */
    const sync = useProfileSync({
        profiles,
        activeProfileId,
        suspended: decodingShare || !!importedProfile,
        applyLocalProfiles,
    });

    const contextValue = React.useMemo(() => ({
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
        importProfileFromJsonString,
        saveSharedProfile,
        getTechLevel,
        getDungeonLevel,
        isNameTaken,
        sync,
    }), [
        profile, updateProfile, updateNestedProfile, profiles, importedProfile,
        activeProfileId, switchProfile, createProfile, cloneProfile, deleteProfile,
        renameProfile, setProfileIcon, saveProfile, resetProfile, exportProfile,
        importProfile, importProfileFromJsonString, saveSharedProfile, getTechLevel,
        getDungeonLevel, isNameTaken, sync
    ]);

    return (
        <ProfileContext.Provider value={contextValue}>
            {decodingShare ? (
                <div className="min-h-screen flex items-center justify-center bg-bg-primary text-text-secondary text-sm">
                    Loading shared profile
                </div>
            ) : children}
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
