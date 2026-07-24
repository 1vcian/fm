import { useCallback, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Heart, Zap, Activity, Check, Trophy, Info, PawPrint, Bike, Undo2, Layers } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useLoadoutSweep, SweepMetric, LoadoutCombo, ExpandedLoadout } from '../../hooks/useLoadoutSweep';
import { LoadoutComparisonModal } from '../../components/Profile/LoadoutComparisonModal';
import { PetSlot, MountSlot } from '../../types/Profile';
import { formatSecondaryStat } from '../../utils/statNames';
import { formatNumber } from '../../utils/format';
import { cn } from '../../lib/utils';
import { Button } from '../../components/UI/Button';

const METRICS: { id: SweepMetric; label: string; icon: typeof Heart; blurb: string }[] = [
    {
        id: 'lifesteal', label: 'Lifesteal/sec', icon: Heart,
        blurb: 'Maximises real-time weapon DPS × lifesteal %. Ignores regen and skill healing.'
    },
    {
        id: 'dps', label: 'DPS', icon: Zap,
        blurb: 'Maximises real-time total DPS — weapon, skill and skill-buff damage on the stepped breakpoint model.'
    },
    {
        id: 'heal', label: 'HPS', icon: Activity,
        blurb: 'Maximises total real-time healing: lifesteal plus health regen and skill healing, block-amplified.'
    },
    {
        id: 'balanced', label: 'Balanced', icon: Check,
        blurb: 'Balances DPS and HPS 50/50, normalised across every combination so neither metric dominates by raw scale.'
    }
];

/** "Lifesteal 4.92%, Crit chance 7.7%" — uses the same formatter as the item cards. */
function describeSubstats(stats?: { statId: string; value: number }[]): string {
    if (!stats?.length) return 'No substats';
    return stats
        .map(s => {
            const { name, formattedValue } = formatSecondaryStat(s.statId, s.value);
            return `${name} ${formattedValue.replace(/^\+/, '')}`;
        })
        .join(', ');
}

export default function LoadoutOptimizer() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const [respectSavedLevels, setRespectSavedLevels] = useState(true);
    const { status, progress, results, evaluatedCount, totalCombos, rank, expand, isReady } = useLoadoutSweep(respectSavedLevels);

    const [metric, setMetric] = useState<SweepMetric>('balanced');
    const [showComparison, setShowComparison] = useState(false);
    const [snapshot, setSnapshot] = useState<{ pets: PetSlot[]; mount: MountSlot | null } | null>(null);

    const activeMetric = METRICS.find(m => m.id === metric)!;

    // "Legendary Attack" — pet type lives in the library, keyed by rarity+id.
    const describePet = useCallback((pet: PetSlot): string => {
        const type = petLibrary?.[`{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`]?.Type || 'Balanced';
        return `${pet.rarity} ${type} - ${describeSubstats(pet.secondaryStats)}`;
    }, [petLibrary]);

    const describeMount = useCallback((mount: MountSlot | null): string => {
        if (!mount) return 'No mount';
        return `${mount.rarity} - ${describeSubstats(mount.secondaryStats)}`;
    }, []);

    const ranked = useMemo(() => (status === 'done' ? rank(metric) : []), [status, rank, metric]);
    const top5 = useMemo(() => ranked.slice(0, 5), [ranked]);
    const best = ranked[0]?.result ?? null;

    const currentCombo: LoadoutCombo = useMemo(
        () => ({ petSet: profile.pets.active, mount: profile.mount.active }),
        [profile.pets.active, profile.mount.active]
    );

    const currentExpanded = useMemo(() => expand(currentCombo), [expand, currentCombo]);
    const bestExpanded = useMemo(() => (best ? expand(best) : null), [expand, best]);

    const handleEquip = () => {
        if (!best) return;
        setSnapshot({ pets: profile.pets.active, mount: profile.mount.active });
        updateNestedProfile('pets', { active: best.petSet });
        updateNestedProfile('mount', { active: best.mount });
        toast.success('Loadout equipped');
    };

    const handleRevert = () => {
        if (!snapshot) return;
        updateNestedProfile('pets', { active: snapshot.pets });
        updateNestedProfile('mount', { active: snapshot.mount });
        setSnapshot(null);
        toast.info('Previous loadout restored');
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-6xl mx-auto">
            {/* Header */}
            <div className="space-y-1">
                <h1 className="text-3xl md:text-4xl font-bold text-text-primary">Optimizer</h1>
                <p className="text-text-secondary text-sm">Best pet + mount loadout over your current gear. Choose what to optimise for.</p>
            </div>

            {/* Current build */}
            <div className="bg-bg-card/60 rounded-2xl border border-border p-4 md:p-5">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="text-lg font-bold text-text-primary">Current build</h2>
                    <button
                        onClick={() => setShowComparison(true)}
                        disabled={!currentExpanded || !bestExpanded}
                        className="p-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                        title="Compare current build against the proposed one"
                    >
                        <Info className="w-5 h-5" />
                    </button>
                </div>
                <StatStrip loadout={currentExpanded} />
                <LoadoutLines
                    pets={profile.pets.active}
                    mount={profile.mount.active}
                    describePet={describePet}
                    describeMount={describeMount}
                />
            </div>

            {/* Metric selector */}
            <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {METRICS.map(m => {
                        const Icon = m.icon;
                        const isActive = m.id === metric;
                        return (
                            <button
                                key={m.id}
                                onClick={() => setMetric(m.id)}
                                className={cn(
                                    "flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                                    isActive
                                        ? "bg-accent-primary/20 border-accent-primary/40 text-text-primary"
                                        : "bg-transparent border-border text-text-secondary hover:bg-white/5"
                                )}
                            >
                                <Icon className="w-4 h-4" />
                                {m.label}
                            </button>
                        );
                    })}
                </div>
                <p className="text-xs text-text-muted mt-2">{activeMetric.blurb}</p>

                {/* Level basis toggle */}
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                    <button
                        onClick={() => setRespectSavedLevels(v => !v)}
                        role="switch"
                        aria-checked={respectSavedLevels}
                        title="On: score each saved build at its own level. Off: score every candidate at level 1 so only secondary stats decide. Equipping always keeps the saved level."
                        className={cn(
                            "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                            respectSavedLevels
                                ? "bg-accent-primary/20 border-accent-primary/40 text-text-primary"
                                : "bg-transparent border-border text-text-secondary hover:bg-white/5"
                        )}
                    >
                        <Layers className="w-4 h-4" />
                        Level basis: {respectSavedLevels ? 'Saved' : 'Level 1'}
                    </button>
                    <span className="text-xs text-text-muted">
                        {respectSavedLevels
                            ? "Using each saved build's own level."
                            : 'Ignoring saved levels — comparing everything at level 1.'}
                    </span>
                </div>
            </div>

            {/* Sweep progress */}
            {(!isReady || status !== 'done') && (
                <div className="bg-bg-card/60 rounded-2xl border border-border p-4 md:p-5 space-y-3">
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                        <span>{isReady ? `Evaluating ${totalCombos.toLocaleString()} combinations…` : 'Loading game data…'}</span>
                        <span className="font-mono font-bold text-accent-primary">{progress}%</span>
                    </div>
                    <div className="h-2 bg-bg-input rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-accent-primary to-orange-600 transition-[width] duration-150"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Best combination */}
            {status === 'done' && best && (
                <div className="bg-blue-950/30 rounded-2xl border border-blue-500/20 p-4 md:p-5">
                    <div className="flex items-center gap-2 mb-1">
                        <Trophy className="w-5 h-5 text-blue-400" />
                        <h2 className="text-lg font-bold text-text-primary">Best {activeMetric.label}</h2>
                    </div>
                    <StatStrip loadout={bestExpanded} />
                    <LoadoutLines
                        pets={best.petSet}
                        mount={best.mount}
                        describePet={describePet}
                        describeMount={describeMount}
                    />
                    <div className="flex justify-end gap-2 mt-4">
                        {snapshot && (
                            <Button variant="ghost" onClick={handleRevert} className="gap-2">
                                <Undo2 className="w-4 h-4" />
                                Revert
                            </Button>
                        )}
                        <Button onClick={handleEquip} className="gap-2">
                            <Check className="w-4 h-4" />
                            Equip this combination
                        </Button>
                    </div>
                </div>
            )}

            {/* Ranked list */}
            {status === 'done' && (
                <div className="space-y-3">
                    <h2 className="text-2xl font-bold text-text-primary">All combinations</h2>
                    <p className="text-xs text-text-muted">
                        {evaluatedCount.toLocaleString()} evaluated, ranked by {activeMetric.label}. Showing the top {top5.length}.
                    </p>
                    <div className="space-y-2">
                        {top5.map(({ result, score }, idx) => (
                            <div
                                key={idx}
                                className="flex items-start gap-4 p-3 bg-bg-input/20 rounded-lg border border-border/30 hover:bg-bg-input/40 transition-colors"
                            >
                                <span className="text-sm font-mono text-text-muted w-4 shrink-0 pt-0.5">{idx + 1}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm text-text-primary leading-snug">
                                        {result.petSet.map(describePet).join('  |  ')}
                                        {'  -  '}
                                        {describeMount(result.mount)}
                                    </div>
                                    <div className="text-[11px] font-mono text-text-muted mt-1">
                                        DPS {formatNumber(result.dps)}
                                        {'  -  '}LS/s {formatNumber(result.lifestealPerSec)}
                                        {'  -  '}HPS {formatNumber(result.healPerSec)}
                                    </div>
                                </div>
                                <span className="text-sm font-mono text-blue-400 shrink-0 pt-0.5">{Math.round(score * 100)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {status === 'done' && results.length === 0 && (
                <div className="text-center py-10 bg-bg-input/20 rounded-2xl border border-dashed border-white/10 text-text-muted text-sm italic">
                    Nothing to optimise — save some pet and mount builds on your profile first.
                </div>
            )}

            {currentExpanded && bestExpanded && (
                <LoadoutComparisonModal
                    isOpen={showComparison}
                    onClose={() => setShowComparison(false)}
                    current={currentExpanded}
                    proposed={bestExpanded}
                />
            )}
        </div>
    );
}

/** The seven-column headline readout shared by the current and best cards. */
function StatStrip({ loadout }: { loadout: ExpandedLoadout | null }) {
    const cells: { label: string; value: number; color: string }[] = loadout ? [
        { label: 'DPS', value: loadout.dps, color: 'text-orange-400' },
        { label: 'Lifesteal/sec', value: loadout.lifestealPerSec, color: 'text-purple-400' },
        { label: 'HPS', value: loadout.healPerSec, color: 'text-emerald-400' },
        { label: 'Shown Dmg', value: loadout.shownDmg, color: 'text-red-400' },
        { label: 'Calculated Dmg', value: loadout.calcDmg, color: 'text-red-400' },
        { label: 'Shown HP', value: loadout.shownHp, color: 'text-green-400' },
        { label: 'Calculated HP', value: loadout.calcHp, color: 'text-green-400' }
    ] : [];

    if (!loadout) {
        return <div className="mt-3 h-12 rounded-lg bg-bg-input/20 animate-pulse" />;
    }

    return (
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            {cells.map(c => (
                <div key={c.label} className="min-w-0">
                    <div className="text-[10px] uppercase font-bold tracking-widest text-text-muted whitespace-nowrap">{c.label}</div>
                    <div className={cn("text-xl md:text-2xl font-mono font-bold mt-0.5", c.color)}>{formatNumber(c.value)}</div>
                </div>
            ))}
        </div>
    );
}

function LoadoutLines({
    pets, mount, describePet, describeMount
}: {
    pets: PetSlot[];
    mount: MountSlot | null;
    describePet: (p: PetSlot) => string;
    describeMount: (m: MountSlot | null) => string;
}) {
    return (
        <div className="mt-4 pt-4 border-t border-border/40 space-y-1.5 text-sm">
            <div className="flex gap-3">
                <span className="flex items-center gap-1.5 text-text-muted text-xs w-16 shrink-0 pt-0.5">
                    <PawPrint className="w-4 h-4" /> Pets
                </span>
                <span className="text-text-primary leading-snug">
                    {pets.length ? pets.map(describePet).join('  |  ') : 'No pets equipped'}
                </span>
            </div>
            <div className="flex gap-3">
                <span className="flex items-center gap-1.5 text-text-muted text-xs w-16 shrink-0 pt-0.5">
                    <Bike className="w-4 h-4" /> Mount
                </span>
                <span className="text-text-primary leading-snug">{describeMount(mount)}</span>
            </div>
        </div>
    );
}
