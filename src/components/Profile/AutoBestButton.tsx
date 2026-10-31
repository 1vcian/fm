import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../UI/Button';
import { BuildOptimizerModal } from './BuildOptimizerModal';
import { comparisonSideProfile } from './DummyTestButton';
import { useComparison } from '../../context/ComparisonContext';
import { useProfile } from '../../context/ProfileContext';
import { applySkinChoice, type Candidate, type FairyChoice, type SkinChoice } from '../../optimizer/buildOptimizer';
import type { MountSlot, PetSlot, SkillSlot, UserProfile } from '../../types/Profile';
import { GameAssetIcon } from '../UI/GameAssetIcon';

/**
 * AUTO BEST: the build optimizer (BuildOptimizerModal) over the profile ('default') or over a
 * snapshot of the Test side of Compare Build ('test'). A loaded row replaces that build's skills,
 * pets, mount, fairy and the skins on its Weapon/Helmet/Body; REVERT puts back what it had before the first row was loaded.
 */
export function AutoBestButton({ variant = 'default' }: { variant?: 'default' | 'test' }) {
    const cmp = useComparison();
    const { profile, updateNestedProfile } = useProfile();
    const isTest = variant === 'test';
    // The build being optimised and where a loaded row goes.
    const cur = {
        pets: isTest ? cmp.testPets ?? profile.pets.active : profile.pets.active,
        mount: isTest ? cmp.testMount : profile.mount.active,
        skills: isTest ? cmp.testSkills ?? profile.skills.equipped : profile.skills.equipped,
        fairy: isTest ? cmp.testFairy ?? profile.misc.fairy : profile.misc.fairy,
        items: (isTest ? cmp.testItems : null) ?? profile.items,
    };
    const set = {
        pets: (v: PetSlot[]) => (isTest ? cmp.updateTestPet(v) : updateNestedProfile('pets', { active: v })),
        mount: (v: MountSlot | null) => (isTest ? cmp.updateTestMount(v) : updateNestedProfile('mount', { active: v })),
        skills: (v: SkillSlot[]) => (isTest ? cmp.updateTestSkill(v) : updateNestedProfile('skills', { equipped: v })),
        fairy: (v: FairyChoice) => (isTest ? cmp.updateTestFairy(v) : updateNestedProfile('misc', { fairy: v })),
        /** Puts the chosen skins on that build's items (only the skin slots of the choice change). */
        skins: (choice: SkinChoice) => {
            const next = applySkinChoice(cur.items, choice);
            if (isTest) for (const slot of Object.keys(choice) as (keyof UserProfile['items'])[]) cmp.updateTestItem(slot, next[slot]);
            else updateNestedProfile('items', Object.fromEntries(Object.keys(choice).map(slot => [slot, next[slot as keyof UserProfile['items']]])));
        },
    };
    const [base, setBase] = useState<UserProfile | null>(null);
    // undefined = nothing to revert; null = revert to "no mount" / "no fairy data".
    const [prevPets, setPrevPets] = useState<PetSlot[] | null>(null);
    const [prevMount, setPrevMount] = useState<MountSlot | null | undefined>(undefined);
    const [prevSkills, setPrevSkills] = useState<SkillSlot[] | null>(null);
    const [prevFairy, setPrevFairy] = useState<FairyChoice | null | undefined>(undefined);
    const [prevSkins, setPrevSkins] = useState<SkinChoice | null>(null);

    const load = (c: Candidate) => {
        if (!prevPets && prevMount === undefined) {
            setPrevPets([...cur.pets]);
            setPrevMount(cur.mount);
        }
        if (!prevSkills) setPrevSkills([...cur.skills]);
        set.pets(c.petSet);
        set.mount(c.mount);
        set.skills(c.skills);
        if (c.fairy) {
            if (prevFairy === undefined) setPrevFairy(cur.fairy ?? null);
            set.fairy(c.fairy);
        }
        if (c.skins) {
            if (!prevSkins) {
                const before: SkinChoice = {};
                for (const slot of Object.keys(c.skins) as (keyof SkinChoice)[]) before[slot] = cur.items[slot]?.skin ?? null;
                setPrevSkins(before);
            }
            set.skins(c.skins);
        }
    };

    const revert = () => {
        if (prevPets) set.pets(prevPets);
        if (prevMount !== undefined) set.mount(prevMount);
        if (prevSkills) set.skills(prevSkills);
        if (prevFairy) set.fairy(prevFairy);
        if (prevSkins) set.skins(prevSkins);
        setPrevPets(null);
        setPrevMount(undefined);
        setPrevSkills(null);
        setPrevFairy(undefined);
        setPrevSkins(null);
    };

    const canRevert = !!prevPets || prevMount !== undefined || !!prevSkills || prevFairy !== undefined || !!prevSkins;

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                data-testid="auto-best-build"
                // The header's tree mode is applied inside the optimizer, so the profile's own tree goes in.
                onClick={() => setBase(isTest ? comparisonSideProfile(profile, cmp, 'test', profile.techTree) : profile)}
                title={`Find the best skills, pets, mount, fairy and skins for ${isTest ? 'the Test build' : 'your build'} by simulated arena win rate`}
                className="flex-1 sm:flex-none py-1.5 border-yellow-500/40 text-yellow-400 hover:border-yellow-500/70"
            >
                <GameAssetIcon asset={{ sheet: 'ArenaRankIcons', index: 0 }} size={16} className="mr-1.5 sm:mr-2" />
                <span className="text-xs sm:text-sm">Auto best</span>
            </Button>
            {canRevert && (
                <Button variant="ghost" size="sm" onClick={revert} className="py-1.5 text-text-muted hover:text-white" title="Put back the build from before the first loaded row">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    <span className="text-xs sm:text-sm">Revert</span>
                </Button>
            )}
            {base && <BuildOptimizerModal base={base} onLoad={load} onClose={() => setBase(null)} targetLabel={isTest ? 'Test' : 'your profile'} />}
        </>
    );
}
