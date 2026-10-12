import { useState, useEffect, useMemo } from 'react';
import { useEggsCalculator } from '../hooks/useEggsCalculator';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/UI/Card';
import { cn } from '../lib/utils';
import { Calculator, Plus, Egg, Info, Trophy } from 'lucide-react';
import { SandboxPanel } from '../components/UI/SandboxPanel';
import { useProfile } from '../context/ProfileContext';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { useGameDataContext } from '../context/GameDataContext';
import { EggIcon } from '../components/UI/EggIcon';
import { PlannerAlarms } from '../components/Planner/PlannerAlarms';
import { eggLanes } from '../utils/plannerSchedule';

export default function Eggs() {
    const { profile, updateNestedProfile } = useProfile();
    const {
        ownedEggs, updateOwnedEggs,
        readyMerges, setReadyMerges,
        timeLimitHours, setTimeLimitHours,
        availableSlots, setAvailableSlots, maxSlots,
        optimization,
        hatchValues,
        warPoints,
        warPointBonuses,
        sandbox
    } = useEggsCalculator();
    const eggWarBoost = Math.max(warPointBonuses?.hatch || 0, warPointBonuses?.merge || 0);
    const { selectedVersion } = useGameDataContext();

    // The eggshell summon calculator lives in the Summons calculator (Eggs tab); this page links there.
    const [activeTab, setActiveTab] = useState<'calculator'>('calculator');

    const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

    // Create a stable hash of the timeline structure.
    // We strictly want to reset only if the ACTUAL schedule changes.
    // JSON.stringify is efficient enough for this data size.
    const timelineHash = optimization && optimization.timeline
        ? JSON.stringify(optimization.timeline)
        : '';

    // Effect to reset checks only when the timeline content actually changes
    useEffect(() => {
        setCheckedItems({});
    }, [timelineHash]);

    /**
     * The hatch plan, reduced to "what finishes in which slot, and how long after THAT SLOT comes
     * free".
     *
     * `optimization.timeline` is `TimelineEvent[][]` — one lane per hatch slot, `startTime`/`endTime`
     * in MINUTES from an implicit zero, with no `Date` anywhere. Each lane's zero is the moment that
     * slot comes free, which is exactly what that slot's own alarm anchor supplies, so the lanes go
     * to `PlannerAlarms` as lanes and each one is timed from its own reading. Keyed on `timelineHash`
     * rather than on `optimization` so a re-render that did not change the schedule does not look
     * like a new plan to the queue.
     */
    const alarmLanes = useMemo(
        () => eggLanes(optimization?.timeline || []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [timelineHash],
    );

    // Format Helpers
    const formatTime = (seconds: number) => {
        const totalMinutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        if (totalMinutes >= 1440) {
            const days = Math.floor(totalMinutes / 1440);
            const hours = Math.floor((totalMinutes % 1440) / 60);
            return `${days}d ${hours}h`;
        } else if (totalMinutes >= 60) {
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            return `${hours}h ${mins.toString().padStart(2, '0')}m`;
        } else {
            // Updated to show seconds if present
            if (secs > 0) {
                return `${totalMinutes}m ${secs}s`;
            }
            return `${totalMinutes}m`;
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <SpriteIcon name="Eggshell" size={40} />
                    Egg Calculator
                </h1>
                <p className="text-text-secondary">Optimize your egg hatching for Guild Wars</p>
                {eggWarBoost > 0 && (
                    <div className="flex justify-center pt-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">
                            <Trophy size={14} />
                            Clan Boost: +{(eggWarBoost * 100).toFixed(0)}% War Points
                        </div>
                    </div>
                )}
            </div>

            <SandboxPanel fields={sandbox.fields} onReset={sandbox.reset} />

            {/* Tabs */}
            <div className="flex justify-center gap-2 sm:gap-4 mb-6 flex-wrap">
                <Link
                    to="/calculators/summons?tab=eggs"
                    className="px-5 py-2 rounded-lg font-bold transition-all bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    title="Open the eggshell summon calculator in the Summons calculator"
                >
                    <div className="flex items-center gap-2">
                        <Egg className="w-4 h-4" />
                        Summon Calculator
                    </div>
                </Link>
                <button
                    onClick={() => setActiveTab('calculator')}
                    className={cn(
                        "px-5 py-2 rounded-lg font-bold transition-all",
                        activeTab === 'calculator'
                            ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                            : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4" />
                        Hatch Optimizer
                    </div>
                </button>
            </div>


            {activeTab === 'calculator' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Input Section */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SpriteIcon name="Timer" size={20} className="text-accent-tertiary" />
                                    Parameters
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {/* Hours Available */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-text-secondary uppercase">Time Available</label>
                                        <div className="flex flex-col gap-4">
                                            {/* Hours */}
                                            <div className="relative group flex-1">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                                    <SpriteIcon name="Timer" size={24} />
                                                </div>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-16 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                    value={Math.floor(timeLimitHours)}
                                                    onChange={(e) => {
                                                        const h = parseInt(e.target.value) || 0;
                                                        const m = Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60);
                                                        setTimeLimitHours(h + (m / 60));
                                                    }}
                                                    placeholder="0"
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted bg-bg-input px-1 pointer-events-none">HOURS</span>
                                            </div>

                                            {/* Minutes */}
                                            <div className="relative group flex-1">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                                    <SpriteIcon name="Timer" size={24} className="opacity-50" />
                                                </div>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="59"
                                                    className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-16 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                    value={Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60)}
                                                    onChange={(e) => {
                                                        const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                                        const h = Math.floor(timeLimitHours);
                                                        setTimeLimitHours(h + (m / 60));
                                                    }}
                                                    placeholder="0"
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted bg-bg-input px-1 pointer-events-none">MINS</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Slots Available */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-text-secondary uppercase">Slots Available</label>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                                <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}HatchBed.png`} alt="Bed" className="w-6 h-6 object-contain opacity-70 group-focus-within:opacity-100 transition-opacity" />
                                            </div>
                                            <input
                                                type="number"
                                                min="1"
                                                max={maxSlots}
                                                className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                value={availableSlots}
                                                onChange={(e) => setAvailableSlots(Math.min(maxSlots, Math.max(1, parseInt(e.target.value) || 1)))}
                                            />
                                        </div>

                                        {/* Gem Speedup */}
                                        <div className="space-y-2 col-span-1 sm:col-span-2 border-t border-white/5 pt-4 mt-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <SpriteIcon name="GemSquare" size={20} />
                                                    <span className="text-sm font-bold text-text-secondary uppercase">Use Gems for Time Skips</span>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={profile.misc.useGemsInCalculators}
                                                        onChange={(e) => updateNestedProfile('misc', { useGemsInCalculators: e.target.checked })}
                                                    />
                                                    <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-primary"></div>
                                                </label>
                                            </div>

                                            {profile.misc.useGemsInCalculators && (
                                                <div className="relative group animate-in fade-in slide-in-from-top-2">
                                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                                        <SpriteIcon name="GemSquare" size={24} className="opacity-70" />
                                                    </div>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                        value={profile.misc.gemCount}
                                                        onChange={(e) => updateNestedProfile('misc', { gemCount: Math.max(0, parseInt(e.target.value) || 0) })}
                                                        placeholder="Enter Gem Count"
                                                    />
                                                    {optimization && (
                                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-text-secondary">
                                                            <span className={optimization.totalGemsUsed > profile.misc.gemCount ? "text-error" : "text-accent-primary"}>
                                                                {optimization.totalGemsUsed}
                                                            </span>
                                                            <span className="mx-1">/</span>
                                                            <span>{profile.misc.gemCount}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Alarms. Renders nothing at all when the build has no backend or nobody is
                            signed in — push is sign-in-only, by the owner's decision.

                            `slotCount` comes from `availableSlots` and NOT from the timeline: the
                            panel has to go on asking about slot 4 while the plan for it is empty,
                            and the player changing their slot count must add or drop an anchor
                            without disturbing the ones already set. */}
                        <PlannerAlarms
                            planner="eggs"
                            route="#/eggs"
                            lanes={alarmLanes}
                            slotCount={availableSlots}
                            laneLabel={(i) => `slot ${i + 1}`}
                            assumption="Each slot is timed from its own reading, so the only thing still assumed is that you reload a slot the moment its egg pops and follow the order shown for that slot."
                        />

                        <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SpriteIcon name="Eggshell" size={20} />
                                    Inventory
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    {Object.entries(ownedEggs).map(([rarity, count]) => (
                                        <div key={rarity} className="relative flex flex-col items-center gap-2 p-3 bg-bg-tertiary rounded-lg border border-border/50 pt-6">
                                            {/* Points Info */}
                                            {warPoints && warPoints[rarity] && (
                                                <div className="absolute top-1 left-0 right-0 flex justify-center gap-2 text-[9px] font-mono text-text-tertiary opacity-80">
                                                    <span>H:<span className="text-text-primary ml-0.5">{Math.round(warPoints[rarity].hatch)}</span></span>
                                                    <span>M:<span className="text-text-primary ml-0.5">{Math.round(warPoints[rarity].merge)}</span></span>
                                                </div>
                                            )}
                                            <EggIcon rarity={rarity} size={48} ascensionLevel={profile.misc.petAscensionLevel || 0} />
                                            <span className={cn("text-xs font-bold uppercase", `text-rarity-${rarity}`)}>
                                                {rarity}
                                            </span>

                                            <div className="flex items-center gap-1 w-full">
                                                <button
                                                    onClick={() => updateOwnedEggs(rarity, Math.max(0, count - 1))}
                                                    className="p-1 bg-black/40 rounded hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors"
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={count}
                                                    onChange={(e) => updateOwnedEggs(rarity, parseInt(e.target.value) || 0)}
                                                    className="w-full text-center bg-transparent border-none outline-none font-mono text-sm h-6 p-0"
                                                    onFocus={(e) => e.target.select()}
                                                />
                                                <button
                                                    onClick={() => updateOwnedEggs(rarity, count + 1)}
                                                    className="p-1 bg-black/40 rounded hover:bg-green-500/20 text-text-secondary hover:text-green-400 transition-colors"
                                                >
                                                    +
                                                </button>
                                            </div>

                                            {hatchValues && hatchValues[rarity] && (
                                                <div className="flex items-center gap-1 text-[10px] text-text-tertiary bg-black/20 px-2 py-0.5 rounded-full">
                                                    <SpriteIcon name="Timer" size={12} />
                                                    {formatTime(hatchValues[rarity])}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Always visible: pet merges the merge screen already offers,
                                    from pets already hatched. Synced with Resources. */}
                                <div className="mt-3 flex items-center justify-between gap-3 p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-text-primary">Ready Pet Merges</div>
                                        <div className="text-[10px] text-text-muted">From pets already hatched. Counted in the war points below and synced with Resources.</div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => setReadyMerges(Math.max(0, readyMerges - 1))}
                                            className="p-1 bg-black/40 rounded hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors"
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            min="0"
                                            value={readyMerges}
                                            onChange={(e) => setReadyMerges(parseInt(e.target.value) || 0)}
                                            onFocus={(e) => e.target.select()}
                                            className="w-20 text-center bg-bg-input border border-border rounded font-mono text-sm py-1"
                                        />
                                        <button
                                            onClick={() => setReadyMerges(readyMerges + 1)}
                                            className="p-1 bg-black/40 rounded hover:bg-green-500/20 text-text-secondary hover:text-green-400 transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Results Section */}
                    <div className="space-y-6">
                        <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                            <CardHeader>
                                <CardTitle className="text-xl text-accent-primary">Optimization Strategy</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {optimization && optimization.totalPoints > 0 ? (
                                    <>
                                        {/* Summary Stats */}
                                        <div className="grid grid-cols-2 gap-4 p-4 bg-bg-primary rounded-xl border border-border">
                                            <div>
                                                <div className="text-sm text-text-secondary">Expected Total Points</div>
                                                <div className="text-2xl font-bold text-accent-primary">
                                                    {Math.floor(optimization.totalPoints).toLocaleString()}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-text-secondary">Time Required</div>
                                                <div className="text-2xl font-bold text-text-primary">
                                                    {formatTime(optimization.timeUsed * 60)} <span className="text-sm font-normal text-text-tertiary">/ {timeLimitHours}h</span>
                                                </div>
                                            </div>
                                            <div className="col-span-2 pt-2 border-t border-border/50 flex justify-between text-sm">
                                                <span>Hatch Pts: <span className="text-text-primary font-bold">{Math.floor(optimization.hatchPoints).toLocaleString()}</span></span>
                                                <span>Merge Pts: <span className="text-text-primary font-bold">{Math.floor(optimization.mergePoints).toLocaleString()}</span></span>
                                            </div>
                                            {(optimization.readyMergePoints || 0) > 0 && (
                                                <div className="col-span-2 flex justify-between text-sm">
                                                    <span className="text-text-secondary">Ready Pet Merges ({readyMerges.toLocaleString()})</span>
                                                    <span className="text-emerald-400 font-bold">+{Math.floor(optimization.readyMergePoints).toLocaleString()} pts</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Parallel Slot Timelines */}
                                        <div className="space-y-4">
                                            <h3 className="font-bold text-text-primary">Slot Schedule (Priority by Points)</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {optimization.timeline?.map((slotEvents: any[], slotIdx: number) => {
                                                    const slotDuration = slotEvents.length > 0 ? slotEvents[slotEvents.length - 1].endTime : 0;

                                                    return (
                                                        <div key={slotIdx} className="bg-bg-primary rounded-xl border border-border overflow-hidden flex flex-col">
                                                            {/* Slot Header */}
                                                            <div className="bg-black/20 p-3 border-b border-border/50 flex justify-between items-center">
                                                                <div className="font-bold text-text-secondary flex items-center gap-2">
                                                                    <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}HatchBed.png`} alt="Bed" className="w-4 h-4 opacity-70" />
                                                                    Slot {slotIdx + 1}
                                                                </div>
                                                                <div className="flex flex-col items-end">
                                                                    <div className="text-xs font-bold text-text-primary">
                                                                        {formatTime(slotDuration * 60)}
                                                                    </div>
                                                                    <div className="text-[10px] text-text-tertiary font-mono">
                                                                        {slotEvents.length} Eggs
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Vertical List */}
                                                            <div className="p-2 space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                                                                {slotEvents.length > 0 ? (
                                                                    slotEvents.map((event: any, idx: number) => {
                                                                        const itemKey = `${slotIdx}-${idx}`;
                                                                        const isChecked = checkedItems[itemKey] || false;

                                                                        return (
                                                                            <div
                                                                                key={idx}
                                                                                onClick={() => {
                                                                                    setCheckedItems(prev => ({
                                                                                        ...prev,
                                                                                        [itemKey]: !prev[itemKey]
                                                                                    }));
                                                                                }}
                                                                                className={cn(
                                                                                    "relative flex items-center gap-3 p-2 rounded-lg border transition-all cursor-pointer group",
                                                                                    isChecked
                                                                                        ? "bg-black/20 border-border/20 opacity-50 grayscale hover:opacity-70 hover:grayscale-0"
                                                                                        : `border-rarity-${event.rarity}/30 bg-rarity-${event.rarity}/5 hover:bg-white/5`
                                                                                )}
                                                                            >
                                                                                {/* Time Marker */}
                                                                                <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-lg transition-colors", isChecked ? "bg-text-tertiary" : "")} style={!isChecked ? { backgroundColor: `var(--color-rarity-${event.rarity})` } : {}} />

                                                                                {/* Checkbox */}
                                                                                <div className={cn(
                                                                                    "w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all",
                                                                                    isChecked
                                                                                        ? "bg-accent-primary border-accent-primary text-bg-primary"
                                                                                        : "border-text-tertiary/50 group-hover:border-text-secondary"
                                                                                )}>
                                                                                    {isChecked && <Plus className="w-3 h-3 rotate-45" />}
                                                                                </div>

                                                                                <EggIcon rarity={event.rarity} size={32} ascensionLevel={profile.misc.petAscensionLevel || 0} />

                                                                                <div className="flex-1 min-w-0 grid grid-cols-1 gap-1">
                                                                                    <div className={cn("font-bold text-sm leading-tight break-words", isChecked ? "text-text-muted line-through" : `text-rarity-${event.rarity}`)}>
                                                                                        {event.rarity}
                                                                                    </div>

                                                                                    <div className="flex items-center gap-2 text-[10px] text-text-muted font-mono">
                                                                                        <span>{formatTime(event.startTime * 60)}</span>
                                                                                        <span className="text-text-tertiary">➜</span>
                                                                                        <span>{formatTime(event.endTime * 60)}</span>
                                                                                    </div>

                                                                                    {event.efficiency > 0 && (
                                                                                        <div className="justify-self-start text-[10px] font-mono text-text-tertiary bg-black/30 px-1.5 py-0.5 rounded border border-white/5 whitespace-nowrap">
                                                                                            {event.efficiency.toFixed(4)} PPS
                                                                                        </div>
                                                                                    )}

                                                                                    {event.gemCost && event.gemCost > 0 && (
                                                                                        <div className="flex items-center gap-1 text-[10px] font-bold text-accent-primary bg-accent-primary/5 px-1.5 py-0.5 rounded border border-accent-primary/20 w-fit">
                                                                                            <SpriteIcon name="GemSquare" size={12} />
                                                                                            {Math.ceil(event.gemCost)}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    <div className="text-center py-8 text-xs text-text-tertiary italic">
                                                                        Unused
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center py-12 text-text-tertiary">
                                        <p>Enter your egg inventory to calculate the best strategy.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {/* Timeline Visualizer (REMOVED as per request) */}



            {/* Background Decoration */}
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <SpriteIcon name="Eggshell" size={256} className="grayscale" />
            </div>
        </div>
    );
}
