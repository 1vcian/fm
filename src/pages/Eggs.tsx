import { useState, useEffect } from 'react';
import { useEggsCalculator } from '../hooks/useEggsCalculator';
import { useEggSummonCalculator } from '../hooks/useEggSummonCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../components/UI/Card';
import { cn } from '../lib/utils';
import { Calculator, Plus, Egg, Info, Minus, RefreshCcw } from 'lucide-react';
import { useProfile } from '../context/ProfileContext';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { getAscensionTexturePath } from '../utils/ascensionUtils';

function EggIcon({ rarity, size = 48, className, ascensionLevel = 0 }: { rarity: string; size?: number; className?: string; ascensionLevel?: number }) {
    const rarityIndex: Record<string, number> = {
        'Common': 0, 'Rare': 1, 'Epic': 2,
        'Legendary': 3, 'Ultimate': 4, 'Mythic': 5
    };

    const idx = rarityIndex[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);

    // For a 4x4 grid, we use standard CSS sprite percentage positioning
    const xPos = (col / 3) * 100;
    const yPos = (row / 3) * 100;

    const texturePath = getAscensionTexturePath('Eggs', ascensionLevel);

    return (
        <div
            className={cn("inline-block shrink-0", className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${texturePath})`,
                backgroundPosition: `${xPos}% ${yPos}%`,
                backgroundSize: '400% 400%', // 4x4 grid means the background image is 400% of the container size
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated'
            }}
            title={rarity}
        />
    );
}

export default function Eggs() {
    const { profile, updateNestedProfile } = useProfile();
    const {
        ownedEggs, updateOwnedEggs,
        timeLimitHours, setTimeLimitHours,
        availableSlots, setAvailableSlots, maxSlots,
        optimization,
        hatchValues,
        warPoints
    } = useEggsCalculator();

    const eggSummon = useEggSummonCalculator();



    // Helpers
    const [activeTab, setActiveTab] = useState<'summon' | 'calculator'>(eggSummon.available ? 'summon' : 'calculator');

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
            </div>

            {/* Tabs */}
            <div className="flex justify-center gap-2 sm:gap-4 mb-6 flex-wrap">
                {eggSummon.available && (
                    <button
                        onClick={() => setActiveTab('summon')}
                        className={cn(
                            "px-5 py-2 rounded-lg font-bold transition-all",
                            activeTab === 'summon'
                                ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                                : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <Egg className="w-4 h-4" />
                            Summon
                        </div>
                    </button>
                )}
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

            {/* Eggshell Summon Calculator */}
            {activeTab === 'summon' && eggSummon.available && (
                <div className="space-y-6">
                    {/* Tech Status Tag (Consistent with Mount Calculator) */}
                    <div className="flex justify-center gap-3 text-xs -mt-2 mb-4">
                        {eggSummon.techBonuses.costReduction > 0 && (
                            <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                                <span className="text-text-muted uppercase font-bold">Cost Red.:</span>
                                <span className="text-accent-primary font-bold">-{Math.round(eggSummon.techBonuses.costReduction * 100)}%</span>
                            </div>
                        )}
                        {eggSummon.techBonuses.extraChance > 0 && (
                            <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                                <span className="text-text-muted uppercase font-bold">Extra Eggs:</span>
                                <span className="text-accent-secondary font-bold">x{(1 + eggSummon.techBonuses.extraChance).toFixed(2)}</span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* CONFIGURATION */}
                        <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SpriteIcon name="Timer" size={20} className="text-text-tertiary" />
                                    Configuration
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Level & Progress */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                                        <label className="text-[10px] font-bold text-text-secondary uppercase">Current Level</label>
                                        <div className="flex items-center justify-between gap-2">
                                            <button
                                                onClick={() => eggSummon.setLevel(Math.max(1, eggSummon.level - 1))}
                                                className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                                disabled={eggSummon.level <= 1}
                                            >
                                                <Minus className="w-3 h-3 text-text-primary" />
                                            </button>
                                            <input
                                                type="number"
                                                min="1"
                                                max={eggSummon.maxPossibleLevel}
                                                value={eggSummon.level}
                                                onChange={(e) => eggSummon.setLevel(Math.max(1, Math.min(eggSummon.maxPossibleLevel, Number(e.target.value))))}
                                                className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                            />
                                            <button
                                                onClick={() => eggSummon.setLevel(Math.min(eggSummon.maxPossibleLevel, eggSummon.level + 1))}
                                                className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                                disabled={eggSummon.level >= eggSummon.maxPossibleLevel}
                                            >
                                                <Plus className="w-3 h-3 text-text-primary" />
                                            </button>
                                        </div>
                                        <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Max: {eggSummon.maxPossibleLevel}</div>
                                    </div>
                                    <div className="space-y-3 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                                        <label className="text-[10px] font-bold text-text-secondary uppercase">Current Progress</label>
                                        <div className="flex items-center justify-between gap-2">
                                            <button
                                                onClick={() => eggSummon.setProgress(Math.max(0, eggSummon.progress - 1))}
                                                className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                                disabled={eggSummon.progress <= 0}
                                            >
                                                <Minus className="w-3 h-3 text-text-primary" />
                                            </button>
                                            <input
                                                type="number"
                                                min="0"
                                                value={eggSummon.progress}
                                                onChange={(e) => eggSummon.setProgress(Number(e.target.value))}
                                                className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                            />
                                            <button
                                                onClick={() => eggSummon.setProgress(eggSummon.progress + 1)}
                                                className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors flex items-center justify-center shrink-0 w-8 h-8"
                                            >
                                                <Plus className="w-3 h-3 text-text-primary" />
                                            </button>
                                        </div>
                                        <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Next: {eggSummon.levels[Math.min(eggSummon.level - 1, eggSummon.levels.length - 1)]?.SummonsRequired || '?'}</div>
                                    </div>
                                </div>

                                {/* Currency Input */}
                                <div className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-text-secondary uppercase flex items-center gap-2">
                                            <SpriteIcon name="Eggshell" size={16} />
                                            Available {eggSummon.currency}
                                        </label>
                                        <div className="relative group">
                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors">
                                                <SpriteIcon name="Eggshell" size={20} />
                                            </div>
                                            <input
                                                type="number"
                                                value={eggSummon.eggshellCount}
                                                onChange={(e) => eggSummon.setEggshellCount(Number(e.target.value))}
                                                className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                placeholder="0"
                                                min="0"
                                            />
                                        </div>
                                        <div className="text-[10px] text-text-muted px-1">
                                            Estimated cost per summon: <span className="text-accent-primary font-bold">{eggSummon.finalCostPerSummon}</span> 🥚
                                        </div>
                                    </div>

                                    {/* Ascension Toggle */}
                                    <div className="p-4 bg-bg-primary/30 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase">
                                        <img src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} alt="Star" className="w-4 h-4 object-contain" />
                                        Simulate Ascension
                                    </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={profile.misc.simulateAscensionInCalculators}
                                                    onChange={(e) => updateNestedProfile('misc', { simulateAscensionInCalculators: e.target.checked })}
                                                />
                                                <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                            </label>
                                        </div>
                                        <p className="text-[10px] text-text-muted leading-relaxed">
                                            When ON, reaching max level resets it to 1 of the next tier. When OFF, extra eggshells progress only the max level.
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* RESULTS */}
                        <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 relative overflow-hidden">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2 text-accent-primary">
                                    <RefreshCcw className="w-5 h-5" />
                                    Simulation Results
                                </CardTitle>
                            </CardHeader>

                            <CardContent className="space-y-6 relative z-10">
                                {eggSummon.results && eggSummon.results.totalSummons > 0 ? (
                                    <>
                                        {eggSummon.results.summonsToMax && (
                                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                                                    <img src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} alt="Star" className="w-6 h-6 object-contain" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-xs font-bold text-amber-400 uppercase">Max Level Milestone</div>
                                                    <div className="text-[11px] text-text-secondary leading-relaxed">
                                                        You reach <span className="text-white font-bold">Max Level</span> in <span className="text-amber-400 font-bold">{eggSummon.results.summonsToMax.toLocaleString()} summons</span> ({(eggSummon.results.summonsToMax * eggSummon.results.finalCost).toLocaleString()} shells).
                                                        The remaining <span className="text-white font-bold">{((eggSummon.results.totalSummons - eggSummon.results.summonsToMax) * eggSummon.results.finalCost).toLocaleString()}</span> shells progress 
                                                        into <span className="text-amber-400 font-bold">{eggSummon.results.simulateAscension ? `Ascension ${eggSummon.results.endAscensionLevel}` : 'Max Level'}</span>.
                                                    </div>
                                                </div>
                                            </div>
                                        )}


                                        {/* Summons Info Grid */}
                                        <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/5">
                                            <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                                <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Summons</div>
                                                <div className="text-lg font-mono font-bold text-white">
                                                    {eggSummon.results.totalSummons.toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                                <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">End Level</div>
                                                <div className="text-lg font-mono font-bold text-accent-primary flex flex-col justify-center">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs opacity-50 font-normal">Lv.{eggSummon.level} ➔</span>
                                                        Lv.{eggSummon.results.endLevel}
                                                    </div>
                                                    {eggSummon.results.endAscensionLevel > (profile.misc.petAscensionLevel || 0) && (
                                                        <div className="text-[10px] text-amber-500 font-bold">
                                                            (Ascension {eggSummon.results.endAscensionLevel})
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                                <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Price</div>
                                                <div className="text-lg font-mono font-bold text-green-400 flex items-baseline gap-1">
                                                    {eggSummon.results.finalCost}
                                                    {eggSummon.results.costReduction > 0 && (
                                                        <span className="text-[10px] text-text-muted line-through font-normal decoration-white/30">
                                                            {eggSummon.results.baseCost}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Rarity Breakdown */}
                                        <div className="space-y-3">
                                            <div className="flex justify-between text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                                <span>Rarity</span>
                                                <span>Expected Eggs</span>
                                            </div>
                                            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                                {eggSummon.results.breakdown.map((item) => (
                                                    <div key={item.rarity} className="flex justify-between items-center p-2 rounded bg-bg-tertiary/50 border border-white/5 hover:bg-bg-tertiary transition-colors">
                                                        <div className="flex items-center gap-2">
                                                            <EggIcon
                                                                rarity={item.rarity}
                                                                size={24}
                                                                ascensionLevel={profile.misc.petAscensionLevel || 0}
                                                                className="shrink-0"
                                                            />
                                                            <span className="text-sm font-medium text-white">{item.rarity}</span>
                                                            <span className="text-xs text-text-muted">({item.percentage.toFixed(2)}%)</span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1">
                                                            <span className="font-mono font-bold text-accent-primary leading-none">
                                                                {Math.floor(item.count).toLocaleString()}
                                                            </span>

                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => eggSummon.applyResultsToProfile()}
                                            className="w-full py-3 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 rounded-xl text-accent-primary font-bold text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-accent-primary/5 active:scale-95"
                                        >
                                            <RefreshCcw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                                            Update Level to Lv.{eggSummon.results.endLevel}{eggSummon.results.endAscensionLevel > (profile.misc.petAscensionLevel || 0) ? ` (Asc. ${eggSummon.results.endAscensionLevel})` : ''}
                                        </button>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                        <Info className="w-8 h-8 opacity-50" />
                                        <p>Enter eggshells to see results</p>
                                    </div>
                                )}
                            </CardContent>

                            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                                <SpriteIcon name="Eggshell" size={256} className="text-accent-primary" />
                            </div>
                        </Card>
                    </div>
                </div>
            )}

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
                                                <img src={`${import.meta.env.BASE_URL}Texture2D/HatchBed.png`} alt="Bed" className="w-6 h-6 object-contain opacity-70 group-focus-within:opacity-100 transition-opacity" />
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
                                                    <span>H:<span className="text-text-primary ml-0.5">{warPoints[rarity].hatch}</span></span>
                                                    <span>M:<span className="text-text-primary ml-0.5">{warPoints[rarity].merge}</span></span>
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
                                                                    <img src={`${import.meta.env.BASE_URL}Texture2D/HatchBed.png`} alt="Bed" className="w-4 h-4 opacity-70" />
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
