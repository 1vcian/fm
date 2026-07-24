import { useCallback } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { StatEngine, LibraryData } from '../utils/statEngine';
import { PetSlot, SkillSlot, MountSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS, MAX_ACTIVE_SKILLS } from '../utils/constants';

export function useProfileOptimizer() {
    const { profile } = useProfile();
    
    // Load all necessary libraries for StatEngine
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    // Filename is SkillPassiveLibrary, not PassiveSkillLibrary — the wrong name
    // 404s silently, dropping skill passive flat damage/health from every score.
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
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
        guildTechTreePositionLibrary: guildPositionLibrary || undefined,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary || undefined,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
        skinsLibrary,
        setsLibrary,
        ascensionConfigsLibrary
    };

    // respectSavedLevels: when true (default), each saved build is scored at its own
    // stored level — the original behavior. When false, every candidate is scored at
    // level 1 so only secondary stats decide. Either way the returned build keeps its
    // saved level for equipping.
    const optimizeLoadout = useCallback((metric: 'dps' | 'power' | 'lifesteal' | 'balanced', base: UserProfile = profile, respectSavedLevels: boolean = true): { pets: PetSlot[]; mount: MountSlot | null } | null => {
        // --- Pet candidate sets: every combination of up to MAX_ACTIVE_PETS from saved builds ---
        const savedPets = base.pets.savedBuilds || [];
        const petSets: PetSlot[][] = [];
        const n = savedPets.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_PETS);

        for (let i = 0; i < n; i++) {
            const set1 = [savedPets[i]];
            if (slotsToFill === 1) {
                petSets.push(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, savedPets[j]];
                if (slotsToFill === 2) {
                    petSets.push(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    petSets.push([...set2, savedPets[k]]);
                }
            }
        }
        // If there are no saved pets, keep the current active pets (don't force a change).
        if (petSets.length === 0) petSets.push(base.pets.active);

        // --- Mount candidates: current active + saved builds, deduped ---
        const mountCandidates: (MountSlot | null)[] = [];
        const seen = new Set<string>();
        const mountKey = (m: MountSlot) => `${m.id}|${m.rarity}|${m.level}|${JSON.stringify(m.secondaryStats)}`;
        const addMount = (m: MountSlot | null) => {
            if (!m) return;
            const key = mountKey(m);
            if (seen.has(key)) return;
            seen.add(key);
            mountCandidates.push(m);
        };
        addMount(base.mount.active);
        (base.mount.savedBuilds || []).forEach(addMount);
        // If there are no mounts at all, keep the current mount (no change).
        if (mountCandidates.length === 0) mountCandidates.push(base.mount.active);

        // Evaluate every combination once. "Balanced" needs two passes (it
        // normalises DPS and HPS by their maxima across the sweep), so keep the
        // full stats around rather than collapsing to a single scalar up front.
        type Combo = { pets: PetSlot[]; mount: MountSlot | null; stats: ReturnType<StatEngine['calculate']> };
        const combos: Combo[] = [];
        for (const petSet of petSets) {
            for (const mount of mountCandidates) {
                // Score at level 1 when respectSavedLevels is off; the original
                // petSet/mount (with saved levels) are still what we push and return.
                const scoredPets = respectSavedLevels
                    ? petSet
                    : petSet.map(p => ({ ...p, level: 1 }));
                const scoredMount = (respectSavedLevels || !mount)
                    ? mount
                    : { ...mount, level: 1 };
                const tempProfile: UserProfile = {
                    ...base,
                    pets: { ...base.pets, active: scoredPets },
                    mount: { ...base.mount, active: scoredMount }
                };
                const engine = new StatEngine(tempProfile, libs);
                combos.push({ pets: petSet, mount, stats: engine.calculate() });
            }
        }
        if (combos.length === 0) return null;

        const scoreOf = (stats: ReturnType<StatEngine['calculate']>): number => {
            // Real-time DPS, matching the Loadout Optimizer sweep (not the theoretical average).
            if (metric === 'dps') return stats.realTotalDps;
            if (metric === 'power') return stats.power;
            if (metric === 'balanced') {
                // Geometric mean (product) of real-time DPS and HPS. Unlike a weighted
                // sum of the two, the product rewards being strong on BOTH axes and
                // collapses toward zero if either is weak — that's what a balanced build
                // actually is. Raw scale is fine: the product is scale-invariant for
                // ranking, so no normalisation is needed. Matches the Substats Calculator.
                return stats.realTotalDps * stats.realTotalHps;
            }
            return stats.realWeaponDps * stats.lifeSteal; // lifesteal/sec (real-time)
        };

        let bestPets: PetSlot[] = [];
        let bestMount: MountSlot | null = base.mount.active;
        let bestValue = -1;

        for (const c of combos) {
            const value = scoreOf(c.stats);
            if (value > bestValue) {
                bestValue = value;
                bestPets = c.pets;
                bestMount = c.mount;
            }
        }

        return bestPets.length > 0 ? { pets: bestPets, mount: bestMount } : null;
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
        optimizeLoadout,
        optimizeSkills,
        isReady: !!petLibrary && !!skillLibrary && !!mountUpgradeLibrary && !!itemBalancingConfig
    };
}
