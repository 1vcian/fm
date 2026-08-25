import { useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useFeatureUnlocks, type FeatureUnlock } from '../hooks/useFeatureUnlocks';
import { Unlock, AlertCircle, Shield, Info, ListChecks } from 'lucide-react';
import { cn } from '../lib/utils';
// Constants for Ages as they might not be in a simple config list
const AGES = ['Primitive', 'Medieval', 'Early-Modern', 'Modern', 'Space', 'Interstellar', 'Multiverse', 'Quantum', 'Underworld', 'Divine'];
const AGE_COLORS = ['#F1F1F1', '#5DD8FF', '#5CFE89', '#FDFF5D', '#FF5D5D', '#D55DFF', '#75FFEE', '#886DFF', '#A77373', '#FF9E0D'];


export default function Unlocks() {
    const { features, loading, failed, version } = useFeatureUnlocks();

    const showCompliance = features.some(f => f.requiresCompliance);

    // Features with no story gate cannot be placed on the timeline, so they get their
    // own section rather than being dropped or parked in an age they do not belong to.
    const conditional = useMemo(
        () => features.filter(f => f.ageIdx === null).sort((a, b) => a.name.localeCompare(b.name)),
        [features]
    );

    const timeline = useMemo(() => {
        const byAge: Record<number, FeatureUnlock[]> = {};
        features.forEach(feature => {
            if (feature.ageIdx === null) return;
            if (!byAge[feature.ageIdx]) byAge[feature.ageIdx] = [];
            byAge[feature.ageIdx].push(feature);
        });

        return Object.entries(byAge)
            .map(([ageStr, entries]) => {
                const age = parseInt(ageStr);
                entries.sort((a, b) => (a.battleIdx ?? 0) - (b.battleIdx ?? 0));
                return {
                    age,
                    ageName: AGES[age] || `Age ${age + 1}`,
                    color: AGE_COLORS[age] || '#FFF',
                    features: entries
                };
            })
            .sort((a, b) => a.age - b.age);
    }, [features]);

    if (loading) return <div className="text-center p-12 text-text-muted animate-pulse">Loading Unlock Data</div>;
    if (failed) return (
        <div className="text-center p-12 text-amber-300 flex flex-col items-center gap-2">
            <AlertCircle className="w-8 h-8" />
            <p>This game version does not carry the feature unlock table.</p>
            <p className="text-xs text-text-muted">
                Nothing to show for version {version}. Pick another game version at the top of the page.
            </p>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Unlock className="w-10 h-10 text-accent-primary" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Feature Unlocks
                    </h1>
                    <p className="text-text-muted">Timeline of when game features become available</p>
                </div>
            </div>

            {/* Legend / Info Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-bg-secondary/30 p-6 rounded-2xl border border-border">
                <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-accent-primary flex items-center gap-2">
                        <Info className="w-4 h-4" /> Understanding Unlocks
                    </h3>
                    <p className="text-xs text-text-muted leading-relaxed">
                        Features unlock as you progress through the ages and battle stages. 
                        Each age consists of multiple stages you must conquer to advance.
                    </p>
                </div>
                <div className="flex flex-col gap-3 justify-center">
                    {showCompliance && (
                        <div className="flex items-center gap-3 text-xs">
                            <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                                <Shield className="w-4 h-4 text-blue-400" />
                            </div>
                            <span className="text-text-secondary"><span className="font-bold text-blue-400">Compliance Required:</span> This feature requires platform login or social verification.</span>
                        </div>
                    )}
                    <div className="flex items-center gap-3 text-xs opacity-50">
                        <div className="w-8 h-8 rounded bg-bg-tertiary flex items-center justify-center shrink-0 border border-red-500/20">
                            <AlertCircle className="w-4 h-4 text-red-400" />
                        </div>
                        <span className="text-text-secondary"><span className="font-bold text-red-400">Disabled:</span> Feature is present in game files but currently toggled off.</span>
                    </div>
                </div>
            </div>

            <div className="relative pl-8 border-l-2 border-border space-y-12">
                {timeline.map((group) => (
                    <div key={group.age} className="relative">
                        {/* Age Dot */}
                        <div
                            className="absolute -left-[41px] top-0 w-5 h-5 rounded-full border-4 border-bg-primary"
                            style={{ backgroundColor: group.color }}
                        />

                        <h2
                            className="text-xl font-bold mb-6 flex items-center gap-3"
                            style={{ color: group.color }}
                        >
                            {group.ageName} Age
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.features.map(feature => (
                                <FeatureCard
                                    key={feature.id}
                                    feature={feature}
                                    stage={`Stage ${group.age + 1}-${(feature.battleIdx ?? 0) + 1}`}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {conditional.length > 0 && (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 border-t border-border pt-8">
                        <ListChecks className="w-5 h-5 text-accent-primary" />
                        <div>
                            <h2 className="text-xl font-bold">Other Requirements</h2>
                            <p className="text-xs text-text-muted">
                                These features are not tied to a battle stage, so they open on their own conditions.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {conditional.map(feature => (
                            <FeatureCard key={feature.id} feature={feature} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function FeatureCard({ feature, stage }: { feature: FeatureUnlock; stage?: string }) {
    const chips = feature.extraRequirements;

    return (
        <Card className={cn(
            "flex items-start gap-4 p-4 hover:border-accent-primary/50 transition-colors relative group",
            feature.forceLocked && "opacity-40 grayscale"
        )}>
            <div className="w-10 h-10 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                <GameIcon name={getFeatureIcon(feature.id)} className="w-6 h-6" />
            </div>
            <div className="overflow-hidden flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="font-semibold whitespace-nowrap overflow-hidden text-clip" title={feature.description || feature.name}>
                        {feature.name}
                    </div>
                    {feature.requiresCompliance && (
                        <div className="shrink-0 group-hover:scale-110 transition-transform" title="Requires Compliance / Social Login">
                            <Shield className="w-3.5 h-3.5 text-blue-400" />
                        </div>
                    )}
                </div>

                <div className="text-sm text-text-muted flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap overflow-hidden text-clip">{stage || (chips.length === 0 ? 'Available from the start' : 'Conditional')}</span>
                    {feature.forceLocked && (
                        <span className="text-[10px] font-black uppercase tracking-tighter text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 shrink-0">
                            Locked / Off
                        </span>
                    )}
                </div>

                {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {chips.map(chip => (
                            <span
                                key={chip}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary border border-border text-text-secondary"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}

function getFeatureIcon(feature: string): string {
    const f = feature.toLowerCase();
    // The dungeon keys have to be tested first: every one of these ids also contains
    // the plain resource word, so a later branch can never be reached.
    if (f.includes('dungeon_hammer')) return 'HammerKey';
    if (f.includes('dungeon_skill')) return 'SkillKey';
    if (f.includes('dungeon_pet')) return 'PetKey';
    if (f.includes('dungeon_potion')) return 'PotionKey';
    if (f.includes('dungeon')) return 'Battle';
    if (f.includes('ascension')) return 'Star';
    if (f.includes('hammer')) return 'Hammer';
    if (f.includes('coin') || f.includes('idle')) return 'Coin';
    if (f.includes('shop') || f.includes('starter')) return 'GemSquare';
    if (f.includes('skill')) return 'SkillTicket';
    if (f.includes('pet') || f.includes('egg')) return 'Egg';
    if (f.includes('arena')) return 'Battle';
    if (f.includes('techtree')) return 'Potion';
    if (f.includes('guild')) return 'Diamond';
    if (f.includes('rateus')) return 'Star';
    if (f.includes('login') || f.includes('name')) return 'Male';
    return 'CommonChest';
}
