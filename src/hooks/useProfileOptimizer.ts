import { useCallback } from 'react';
import { useTreeModeProfile } from './useGlobalStats';
import { StatEngine } from '../utils/statEngine';
import { SkillSlot, UserProfile } from '../types/Profile';

export function useProfileOptimizer() {
    // Same libraries and header tree mode as the profile stats (useGlobalStats).
    const { profile, libs } = useTreeModeProfile();
    const { petLibrary, skillLibrary, mountUpgradeLibrary, itemBalancingConfig, skillBaseConfig } = libs as any;
    // Equipped skill slots, SkillBaseConfig.SkillSlotsCount.
    const skillSlots: number | undefined = skillBaseConfig?.SkillSlotsCount;

    // Pets + mount search lives in useLoadoutSweep (time-sliced, tree-mode aware), shown by
    // LoadoutSweepPopover from the AUTO buttons.

    const optimizeSkills = useCallback((): SkillSlot[] | null => {
        if (!skillLibrary || !itemBalancingConfig || typeof skillSlots !== 'number') return null;

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
        const slotsToFill = Math.min(n, skillSlots);

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
            
            // Real-time DPS: the stepped attack timing the engine verifies (statEngine realTotalDps).
            const value = stats.realTotalDps;
            
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
    }, [profile, libs, skillLibrary, itemBalancingConfig, skillSlots]);

    return {
        optimizeSkills,
        isReady: !!petLibrary && !!skillLibrary && !!mountUpgradeLibrary && !!itemBalancingConfig && typeof skillSlots === 'number'
    };
}
