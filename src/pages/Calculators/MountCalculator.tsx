import { useMountsCalculator } from '../../hooks/useMountsCalculator';
import { useProfile } from '../../context/ProfileContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { Trophy, Info, Minus, Plus, RefreshCcw } from 'lucide-react';
import { isWarPointDay } from '../../utils/guildWarUtils';

export default function MountCalculator() {
    const { profile, updateNestedProfile } = useProfile();
    const {
        level: currentLevel, setLevel,
        progress: currentProgress, setProgress,
        windersCount, setWindersCount,
        techBonuses,
        results,
        maxPossibleLevel,
        levels,
        applyResultsToProfile
    } = useMountsCalculator();

    // Colors helper (Consistent with Skill Calculator)
    const RARITY_COLORS: Record<string, string> = {
        Common: '#F1F1F1',
        Rare: '#5DD8FF',
        Epic: '#5CFE89',
        Legendary: '#FDFF5D',
        Ultimate: '#FF5D5D',
        Mythic: '#D55DFF',
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <SpriteIcon name="MountKey" size={32} className="text-accent-primary" />
                    Mount Calculator
                </h1>
                <p className="text-text-secondary">Simulate level-ups and rarity drops from your winders.</p>
                {isWarPointDay(new Date(), 'mounts') && (
                    <div className="flex justify-center pt-2">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-primary/20 text-accent-primary border border-accent-primary/30 text-[10px] font-black uppercase tracking-wider animate-pulse">
                            <Trophy size={14} />
                            War Points Active: High Value Day
                        </div>
                    </div>
                )}

                {/* Tech Status Tag */}
                <div className="flex justify-center gap-3 text-xs pt-3">
                    {techBonuses.costReduction > 0 && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                            <span className="text-text-muted uppercase font-bold">Cost Red.:</span>
                            <span className="text-accent-primary font-bold">-{Math.round(techBonuses.costReduction * 100)}%</span>
                        </div>
                    )}
                    {techBonuses.extraChance > 0 && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                            <span className="text-text-muted uppercase font-bold">Extra Multiplier:</span>
                            <span className="text-accent-secondary font-bold">x{(1 + techBonuses.extraChance).toFixed(2)}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* INPUTS */}
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
                                        onClick={() => setLevel(Math.max(1, currentLevel - 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={currentLevel <= 1}
                                    >
                                        <Minus className="w-3 h-3 text-text-primary" />
                                    </button>
                                    <input
                                        type="number"
                                        min="1"
                                        max={maxPossibleLevel}
                                        value={currentLevel}
                                        onChange={(e) => setLevel(Math.max(1, Math.min(maxPossibleLevel, Number(e.target.value))))}
                                        className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                    />
                                    <button
                                        onClick={() => setLevel(Math.min(maxPossibleLevel, currentLevel + 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={currentLevel >= maxPossibleLevel}
                                    >
                                        <Plus className="w-3 h-3 text-text-primary" />
                                    </button>
                                </div>
                                <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Max: {maxPossibleLevel}</div>
                            </div>
                            <div className="space-y-3 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                                <label className="text-[10px] font-bold text-text-secondary uppercase">Current Progress</label>
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        onClick={() => setProgress(Math.max(0, currentProgress - 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={currentProgress <= 0 || currentLevel >= maxPossibleLevel}
                                    >
                                        <Minus className="w-3 h-3 text-text-primary" />
                                    </button>
                                    <div className="flex-1 text-center">
                                        {currentLevel >= maxPossibleLevel ? (
                                            <span className="text-2xl font-black text-amber-500">MAX</span>
                                        ) : (
                                            <input
                                                type="number"
                                                min="0"
                                                value={currentProgress}
                                                onChange={(e) => setProgress(Number(e.target.value))}
                                                className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                            />
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setProgress(currentProgress + 1)}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={currentLevel >= maxPossibleLevel}
                                    >
                                        <Plus className="w-3 h-3 text-text-primary" />
                                    </button>
                                </div>
                                <div className="text-[10px] text-text-muted text-center font-mono opacity-50">
                                    Next: {currentLevel >= maxPossibleLevel ? 'MAX' : (levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired?.toLocaleString() || '?')}
                                </div>
                            </div>
                        </div>

                        {/* Winder Input */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-text-secondary uppercase flex items-center gap-2">
                                    <SpriteIcon name="MountKey" size={16} />
                                    Available Winders
                                </label>
                                <div className="relative group">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                        <SpriteIcon name="MountKey" size={20} className="opacity-50" />
                                    </div>
                                    <input
                                        type="number"
                                        value={windersCount}
                                        onChange={(e) => setWindersCount(Number(e.target.value))}
                                        className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                        placeholder="0"
                                        min="0"
                                    />
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
                                    When ON, reaching max level resets it to 1 of the next tier. When OFF, extra winders progress only the max level.
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
                            Results
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-6 relative z-10">
                        {results ? (
                            <>
                                {/* Total Points Breakdown */}
                                <div className="space-y-3">
                                    <div className="p-4 bg-bg-primary rounded-xl border border-border flex items-center justify-between">
                                        <div>
                                            <div className="text-xs text-text-secondary font-bold uppercase mb-1">Total War Points</div>
                                            <div className="text-3xl font-black text-white drop-shadow-md">
                                                {Math.floor(results.totalPoints).toLocaleString()}
                                            </div>
                                        </div>
                                        <Trophy className="w-8 h-8 text-accent-primary opacity-50" />
                                    </div>
                                    {results.simulateAscension && results.phases && results.phases.length > 1 && (
                                        <div className="space-y-2 -mt-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="flex items-center gap-2 text-[9px] font-bold text-text-muted uppercase px-1">
                                                <RefreshCcw size={10} className="text-accent-primary" />
                                                Phase Progression Breakdown
                                            </div>
                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                                                {results.phases.map((phase, idx) => (
                                                    <div key={idx} className="bg-bg-tertiary/20 p-2 rounded-lg border border-white/5 flex flex-col justify-center">
                                                        <div className={`text-[8px] uppercase font-black mb-0.5 ${phase.startAscension > 0 ? 'text-amber-500' : 'text-text-muted'}`}>
                                                            {phase.label}
                                                        </div>
                                                        <div className="text-sm font-mono font-bold text-white leading-none mb-1">
                                                            {phase.totalPoints.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span className="text-[8px] opacity-50">pts</span>
                                                        </div>
                                                        <div className="text-[8px] text-text-muted font-mono leading-none">
                                                            Lv.{phase.startLevel} ➔ {phase.endLevel === 100 ? 'MAX' : `Lv.${phase.endLevel}`}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-bg-tertiary/30 p-2 rounded-lg border border-white/5 text-center">
                                            <div className="text-[9px] text-text-muted uppercase font-bold">Summon Points</div>
                                            <div className="text-sm font-mono font-bold text-white">+{Math.floor(results.totalSummonPoints).toLocaleString()}</div>
                                        </div>
                                        <div className="bg-bg-tertiary/30 p-2 rounded-lg border border-white/5 text-center">
                                            <div className="text-[9px] text-text-muted uppercase font-bold">Merge Points</div>
                                            <div className="text-sm font-mono font-bold text-accent-secondary">+{Math.floor(results.totalMergePoints).toLocaleString()}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-[10px] text-text-muted/60 px-2 -mt-2 mb-4 text-right italic">
                                    * Simulation assumes all obtained mounts are merged
                                </div>

                                {results.summonsToMax && (
                                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                                            <img src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} alt="Star" className="w-6 h-6 object-contain" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-xs font-bold text-amber-400 uppercase">Max Level Milestone</div>
                                            <div className="text-[11px] text-text-secondary leading-relaxed">
                                                You reach <span className="text-white font-bold">Max Level</span> in <span className="text-amber-400 font-bold">{results.summonsToMax.toLocaleString()} summons</span> ({(results.summonsToMax * results.finalCost).toLocaleString()} winders).
                                                The remaining <span className="text-white font-bold">{((results.totalSummons - results.summonsToMax) * results.finalCost).toLocaleString()}</span> winders progress 
                                                into <span className="text-amber-400 font-bold">{results.simulateAscension ? `Ascension ${results.endAscensionLevel}` : 'Max Level'}</span>.
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Summons Info Grid */}
                                <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/5">
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Summons</div>
                                        <div className="text-lg font-mono font-bold text-white">
                                            {results.totalSummons.toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">End Level</div>
                                        <div className="text-lg font-mono font-bold text-accent-primary flex flex-col justify-center">
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs opacity-50 font-normal">Lv.{currentLevel} ➔</span>
                                                Lv.{results.endLevel}
                                            </div>
                                            {results.endAscensionLevel > (profile.misc.mountAscensionLevel || 0) && (
                                                <div className="text-[10px] text-amber-500 font-bold">
                                                    (Ascension {results.endAscensionLevel})
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Price</div>
                                        <div className="text-lg font-mono font-bold text-green-400 flex items-baseline gap-1">
                                            {results.finalCost}
                                            {results.costReduction > 0 && (
                                                <span className="text-[10px] text-text-muted line-through font-normal decoration-white/30">
                                                    {results.baseCost}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Rarity Breakdown */}
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                        <span>Rarity</span>
                                        <span>Expected Drops</span>
                                    </div>
                                    <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                                        {results.breakdown.map((item) => (
                                            <div key={item.rarity} className="flex justify-between items-center p-2 rounded bg-bg-tertiary/50 border border-white/5 hover:bg-bg-tertiary transition-colors">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2.5 h-2.5 rounded-full shadow-sm"
                                                        style={{
                                                            backgroundColor: RARITY_COLORS[item.rarity] || '#fff',
                                                            boxShadow: `0 0 8px ${RARITY_COLORS[item.rarity]}40`
                                                        }}
                                                    />
                                                    <span className="text-sm font-medium text-white">{item.rarity}</span>
                                                    <span className="text-xs text-text-muted">({item.percentage.toFixed(2)}%)</span>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className="font-mono font-bold text-accent-primary leading-none">
                                                        {item.count.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                                    </span>

                                                    {results.simulateAscension && results.phases && results.phases.length > 1 && (
                                                        <div className="flex flex-wrap gap-1 justify-end max-w-[150px] mt-1">
                                                            {(item.phaseCounts || []).map((phase, pIdx) => (
                                                                <div key={pIdx} className={`px-1 rounded border ${phase.ascension > 0 ? 'bg-amber-500/5 border-amber-500/10' : 'bg-white/5 border-white/5'}`}>
                                                                    <div className="flex items-center gap-0.5 text-[8px] font-mono leading-tight">
                                                                        <span className={phase.ascension > 0 ? 'text-amber-500/80 font-bold' : 'text-text-muted'}>
                                                                            {phase.ascension === 0 ? 'N' : `A${phase.ascension}`}:
                                                                        </span>
                                                                        <span className="text-white/90">{phase.count.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    <div className="flex gap-2">
                                                        {item.summonPoints > 0 && (
                                                            <div className="flex flex-col items-end text-[9px] text-text-muted font-mono leading-tight bg-white/5 px-1.5 py-0.5 rounded">
                                                                <span className="opacity-50">Summon</span>
                                                                <span className="text-white font-bold">{item.summonPoints.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                                            </div>
                                                        )}
                                                        {item.mergePoints > 0 && (
                                                            <div className="flex flex-col items-end text-[9px] text-accent-secondary/70 font-mono leading-tight bg-accent-secondary/5 px-1.5 py-0.5 rounded">
                                                                <span className="opacity-50">Merge</span>
                                                                <span className="text-accent-secondary font-bold">{item.mergePoints.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    onClick={applyResultsToProfile}
                                    className="w-full py-3 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 rounded-xl text-accent-primary font-bold text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-accent-primary/5 active:scale-95"
                                >
                                    <RefreshCcw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                                    Update Level to Lv.{results.endLevel}{results.endAscensionLevel > (profile.misc.mountAscensionLevel || 0) ? ` (Asc. ${results.endAscensionLevel})` : ''}
                                </button>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                <Info className="w-8 h-8 opacity-50" />
                                <p>Enter winders to see results</p>
                            </div>
                        )}
                    </CardContent>

                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <SpriteIcon name="MountKey" size={256} className="text-accent-primary" />
                    </div>
                </Card>
            </div>
        </div>
    );
}
