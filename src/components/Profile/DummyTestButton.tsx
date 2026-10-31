import { useMemo, useState } from 'react';
import { Button } from '../UI/Button';
import { BattleVisualizerModal } from '../Battle/BattleVisualizerModal';
import { useBattleSimulation } from '../../hooks/useBattleSimulation';
import { useComparison } from '../../context/ComparisonContext';
import { useProfile } from '../../context/ProfileContext';
import { useTreeMode } from '../../context/TreeModeContext';
import { useStatLibraries, applyTreeMode } from '../../hooks/useGlobalStats';
import { calculateStats } from '../../utils/statEngine';
import type { UserProfile } from '../../types/Profile';
import { GameAssetIcon } from '../UI/GameAssetIcon';

type Comparison = ReturnType<typeof useComparison>;

/**
 * The profile of one side of Compare Build: the base profile with that side's items, mount,
 * pets, skills, ascensions, skin toggle and fairy, on the tech tree of the selected tree mode.
 * StatsSummaryPanel and the dummy test both build the sides through this.
 */
export function comparisonSideProfile(profile: UserProfile, cmp: Comparison, side: 'original' | 'test', techTree: UserProfile['techTree']): UserProfile {
    const o = side === 'original';
    return {
        ...profile,
        items: (o ? cmp.originalItems : cmp.testItems) ?? profile.items,
        techTree,
        mount: { ...profile.mount, active: o ? cmp.originalMount : cmp.testMount },
        pets: { ...profile.pets, active: (o ? cmp.originalPets : cmp.testPets) || profile.pets.active },
        skills: { ...profile.skills, equipped: (o ? cmp.originalSkills : cmp.testSkills) || profile.skills.equipped },
        misc: {
            ...profile.misc,
            forgeAscensionLevel: (o ? cmp.originalForgeAscension : cmp.testForgeAscension) ?? profile.misc.forgeAscensionLevel,
            mountAscensionLevel: (o ? cmp.originalMountAscension : cmp.testMountAscension) ?? profile.misc.mountAscensionLevel,
            petAscensionLevel: (o ? cmp.originalPetAscension : cmp.testPetAscension) ?? profile.misc.petAscensionLevel,
            skillAscensionLevel: (o ? cmp.originalSkillAscension : cmp.testSkillAscension) ?? profile.misc.skillAscensionLevel,
            useSkinWindup: (o ? cmp.originalUseSkinWindup : cmp.testUseSkinWindup) ?? profile.misc.useSkinWindup,
            fairy: (o ? cmp.originalFairy : cmp.testFairy) ?? profile.misc.fairy,
        },
    } as UserProfile;
}

/**
 * "Test against dummy" for one build: the profile itself, or one side of Compare Build. Opens the
 * battle viewer against one infinite-HP dummy whose hits take the player down to a quarter of HP.
 */
export function DummyTestButton({ variant = 'default' }: { variant?: 'default' | 'original' | 'test' }) {
    const [open, setOpen] = useState(false);
    const { playerStats, libs, profile: simProfile } = useBattleSimulation();
    const cmp = useComparison();
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { libs: statLibs } = useStatLibraries();

    // Only computed while the viewer is open, so the button costs nothing on the page.
    const side = useMemo(() => {
        if (!open || variant === 'default' || !cmp.isComparing) return null;
        const sideProfile = comparisonSideProfile(profile, cmp, variant, applyTreeMode(profile, treeMode, statLibs).techTree);
        return { profile: sideProfile, stats: calculateStats(sideProfile, statLibs, false) };
    }, [open, variant, cmp, profile, treeMode, statLibs]);

    const stats = variant === 'default' ? playerStats : side?.stats;
    const viewProfile = variant === 'default' ? simProfile : side?.profile;

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                onClick={() => setOpen(true)}
                disabled={!playerStats || !libs}
                title="Your build vs a dummy with infinite HP. Every hit takes you straight down to a quarter of your HP, so you can watch regen, lifesteal, block and every skill at work."
                className="flex-1 sm:flex-none py-1.5 border-amber-500/40 text-amber-300 hover:border-amber-500/70"
            >
                <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 40 }} size={16} className="mr-1.5 sm:mr-2" />
                <span className="text-xs sm:text-sm">Test against dummy</span>
            </Button>
            {open && stats && libs && (
                <BattleVisualizerModal
                    isOpen={open}
                    onClose={() => setOpen(false)}
                    libs={libs}
                    playerStats={stats}
                    profile={viewProfile || null}
                    ageIdx={0}
                    battleIdx={0}
                    difficultyMode={0}
                    testDummy
                />
            )}
        </>
    );
}
