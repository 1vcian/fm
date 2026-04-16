import { useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { StatEngine, LibraryData } from '../utils/statEngine';
import { PetSlot, SkillSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS, MAX_ACTIVE_SKILLS } from '../utils/constants';

export function useProfileOptimizer() {
    const { profile, updateNestedProfile } = useProfile();
    
    // Load all necessary libraries for StatEngine
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('PassiveSkillLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    const libs: LibraryData = {
        petLibrary,
        petUpgradeLibrary,
        petBalancingLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
        skinsLibrary,
        setsLibrary,
        ascensionConfigsLibrary
    };

    const optimizePets = useCallback((metric: 'dps' | 'power'): PetSlot[] | null => {
        const savedPets = profile.pets.savedBuilds || [];
        if (savedPets.length === 0) return null;

        let bestSet: PetSlot[] = [];
        let bestValue = -1;

        // Helper to generate combinations
        const n = savedPets.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_PETS);

        // Simple nested loops for small N (up to 3 slots)
        const checkSet = (candidate: PetSlot[]) => {
            const tempProfile: UserProfile = {
                ...profile,
                pets: {
                    ...profile.pets,
                    active: candidate
                }
            };

            const engine = new StatEngine(tempProfile, libs);
            const stats = engine.calculate();
            
            const value = metric === 'dps' ? stats.averageTotalDps : stats.power;
            
            if (value > bestValue) {
                bestValue = value;
                bestSet = candidate;
            }
        };

        for (let i = 0; i < n; i++) {
            const set1 = [savedPets[i]];
            if (slotsToFill === 1) {
                checkSet(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, savedPets[j]];
                if (slotsToFill === 2) {
                    checkSet(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    checkSet([...set2, savedPets[k]]);
                }
            }
        }

        return bestSet.length > 0 ? bestSet : null;
    }, [profile, libs]);

    const optimizeSkills = useCallback((): SkillSlot[] | null => {
        if (!skillLibrary) return null;

        // Build the candidate list from the library, using levels from passives
        const collection: SkillSlot[] = Object.keys(skillLibrary).map(id => ({
            id: id,
            rarity: skillLibrary[id].Rarity || 'Common',
            level: profile.skills.passives[id] || 1,
            evolution: 0,
            ascensionLevel: profile.misc.skillAscensionLevel || 0
        }));

        if (collection.length === 0) return null;

        let bestSet: SkillSlot[] = [];
        let bestValue = -1;

        const n = collection.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_SKILLS);

        const checkSet = (candidate: SkillSlot[]) => {
            const tempProfile: UserProfile = {
                ...profile,
                skills: {
                    ...profile.skills,
                    equipped: candidate
                }
            };

            const engine = new StatEngine(tempProfile, libs);
            const stats = engine.calculate();
            
            const value = stats.averageTotalDps;
            
            if (value > bestValue) {
                bestValue = value;
                bestSet = candidate;
            }
        };

        for (let i = 0; i < n; i++) {
            const set1 = [collection[i]];
            if (slotsToFill === 1) {
                checkSet(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, collection[j]];
                if (slotsToFill === 2) {
                    checkSet(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    checkSet([...set2, collection[k]]);
                }
            }
        }

        return bestSet.length > 0 ? bestSet : null;
    }, [profile, libs, skillLibrary]);

    return {
        optimizePets,
        optimizeSkills,
        isReady: !!petLibrary && !!skillLibrary && !!itemBalancingConfig
    };
}
