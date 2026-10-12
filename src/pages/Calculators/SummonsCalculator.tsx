import { useSearchParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import EggSummonCalculator from './EggSummonCalculator';
import MountCalculator from './MountCalculator';
import SkillCalculator from './SkillCalculator';

export type SummonTab = 'eggs' | 'mounts' | 'skills';

const TABS: { id: SummonTab; label: string; icon: string; blurb: string }[] = [
    { id: 'eggs', label: 'Eggs', icon: 'Eggshell', blurb: 'Simulate eggshell summons: level-ups, ascensions and the eggs you get.' },
    { id: 'mounts', label: 'Mounts', icon: 'MountKey', blurb: 'Simulate level-ups, rarity drops and war points from your winders.' },
    { id: 'skills', label: 'Skills', icon: 'SkillTicket', blurb: 'Calculate expected skills and war points from your tickets.' },
];

const isTab = (v: string | null): v is SummonTab => v === 'eggs' || v === 'mounts' || v === 'skills';

/**
 * One calculator for every summon pool. The three tabs share the summon engine
 * (src/utils/summonEngine.ts); the tab lives in `?tab=` so old routes can redirect to it.
 */
export default function SummonsCalculator() {
    const [params, setParams] = useSearchParams();
    const raw = params.get('tab');
    const tab: SummonTab = isTab(raw) ? raw : 'eggs';
    const current = TABS.find(t => t.id === tab)!;

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <SpriteIcon name={current.icon} size={36} />
                    Summons Calculator
                </h1>
                <p className="text-text-secondary">{current.blurb}</p>
            </div>

            <div className="flex justify-center gap-2 sm:gap-4 flex-wrap" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setParams(p => { p.set('tab', t.id); return p; }, { replace: true })}
                        className={cn(
                            'px-5 py-2 rounded-lg font-bold transition-all',
                            tab === t.id
                                ? 'bg-accent-primary text-bg-primary shadow-lg scale-105'
                                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <SpriteIcon name={t.icon} size={18} />
                            {t.label}
                        </div>
                    </button>
                ))}
            </div>

            {tab === 'eggs' && <EggSummonCalculator />}
            {tab === 'mounts' && <MountCalculator embedded />}
            {tab === 'skills' && <SkillCalculator embedded />}
        </div>
    );
}
