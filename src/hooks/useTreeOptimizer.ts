import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { useTreeModifiers } from './useCalculatedStats';
import { optimizeTechTree, type TechUpgrade } from '../utils/techOptimizer';

export type { TechUpgrade } from '../utils/techOptimizer';

/**
 * The Tree Calculator's optimiser, and nothing more.
 *
 * The algorithm itself lives in `src/utils/techOptimizer.ts` as a pure function — see that file's
 * header for why it was moved out (short version: this hook writes the profile on mount, so a data
 * layer such as the clan share cannot mount it, and `src/utils/warPoints.ts` calls the pure core
 * instead). What stays here is exactly what cannot be pure: the game-data fetches, the two pieces
 * of local state, the potions write-back, the My/Max/Empty display toggle, and `applyUpgrades`.
 *
 * Behaviour is unchanged from the pre-extraction version, including the `'max'` early return and
 * its deliberately partial result object.
 */
export function useTreeOptimizer(warBonusOverride?: number, dayBoostOverride?: number) {
    const { profile, updateProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // 1. Data Loading
    const { data: mapping } = useGameData<any>('TechTreeMapping.json');
    const { data: library } = useGameData<any>('TechTreeLibrary.json');
    const { data: upgradeLibrary } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: dayConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: forgeConfig } = useGameData<any>('ForgeConfig.json');

    // Clan tech tree boost to war points earned from finishing tech upgrades.
    // A sandbox override (from the Tree Calculator) takes precedence over the profile value.
    const treeModifiers = useTreeModifiers();
    const techUpgradeWarBonus = warBonusOverride ?? (treeModifiers['WarPointsFromTechUpgrade'] || 0);

    const gemSkipCostPerSecond = forgeConfig?.TechTreeGemSkipCostPerSecond || 0.0023;

    // 2. State
    const [timeLimitHours, setTimeLimitHours] = useState(() => {
        const now = new Date();
        const target = new Date(now);
        target.setHours(23, 59, 0, 0);
        if (now.getTime() >= target.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return (target.getTime() - now.getTime()) / (3600 * 1000);
    });
    const [potions, setPotions] = useState(profile.misc.techPotions || 0);

    // Sync potions to profile
    useEffect(() => {
        updateProfile({
            misc: {
                ...profile.misc,
                techPotions: potions
            }
        });
    }, [potions]);

    // 3. Optimization
    const optimization = useMemo(() => {
        if (!mapping || !library || !upgradeLibrary || !dayConfig || !forgeConfig) return null;

        if (treeMode === 'max') {
            // If mode is max, we can't really optimize further.
            //
            // The cast keeps this branch byte-identical to the pre-extraction code: it returns a
            // PARTIAL object, so `optimization.totalGemsUsed` is `undefined` in Max mode and the
            // Tree Calculator renders an empty cell rather than a "0". Filling the missing fields
            // in would be tidier and would also change what is on screen, so it stays a hole and
            // the cast documents it.
            return { totalPoints: 0, actions: [], timeUsed: 0, potionsUsed: 0 } as unknown as ReturnType<typeof optimizeTechTree>;
        }

        // 'empty' plans from a blank tree; 'my' plans from the profile. Resolving the toggle HERE
        // is what lets `warPoints.ts` call the same core against the real tree unconditionally —
        // a member with the header on "Max" must never publish a fabricated projection.
        const techTree = treeMode === 'empty'
            ? { Forge: {}, Power: {}, SkillsPetTech: {}, Clan: {} }
            : {
                Forge: { ...profile.techTree.Forge },
                Power: { ...profile.techTree.Power },
                SkillsPetTech: { ...profile.techTree.SkillsPetTech },
                Clan: { ...profile.techTree.Clan },
            };

        return optimizeTechTree({
            mapping,
            library,
            upgradeLibrary,
            dayConfig,
            forgeConfig,
            techTree,
            potions,
            timeLimitHours,
            gemBudget: (profile.misc.useGemsInCalculators ? profile.misc.gemCount : 0),
            warBonus: techUpgradeWarBonus,
            dayBoost: dayBoostOverride ?? 0,
            planStartMs: new Date().getTime(),
        });

    }, [mapping, library, upgradeLibrary, dayConfig, treeMode, profile.techTree, timeLimitHours, potions, forgeConfig, techUpgradeWarBonus, dayBoostOverride, profile.misc.gemCount, profile.misc.useGemsInCalculators]);

    const applyUpgrades = (selectedActions: TechUpgrade[]) => {
        if (selectedActions.length === 0) return;

        const newTree = {
            Forge: { ...profile.techTree.Forge },
            Power: { ...profile.techTree.Power },
            SkillsPetTech: { ...profile.techTree.SkillsPetTech },
            Clan: { ...profile.techTree.Clan }
        };

        let totalCost = 0;
        selectedActions.forEach(action => {
            if (!newTree[action.tree as keyof typeof newTree]) {
                newTree[action.tree as keyof typeof newTree] = {};
            }
            newTree[action.tree as keyof typeof newTree][action.nodeId] = action.toLevel;
            totalCost += action.cost;
        });

        updateProfile({
            techTree: newTree,
            misc: {
                ...profile.misc,
                techPotions: Math.max(0, potions - totalCost)
            }
        });

        // Update local potions state to match new profile value
        setPotions(Math.max(0, potions - totalCost));
    };

    return {
        timeLimitHours, setTimeLimitHours,
        potions, setPotions,
        optimization,
        applyUpgrades,
        gemSkipCostPerSecond
    };
}
