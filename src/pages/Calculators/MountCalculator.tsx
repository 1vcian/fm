import { useMountsCalculator } from '../../hooks/useMountsCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { Trophy, Info, Minus, Plus, RefreshCcw } from 'lucide-react';

export default function MountCalculator() {
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
                                        disabled={currentProgress <= 0}
                                    >
                                        <Minus className="w-3 h-3 text-text-primary" />
                                    </button>
                                    <input
                                        type="number"
                                        min="0"
                                        value={currentProgress}
                                        onChange={(e) => setProgress(Number(e.target.value))}
                                        className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                    />
                                    <button
                                        onClick={() => setProgress(currentProgress + 1)}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors flex items-center justify-center shrink-0 w-8 h-8"
                                    >
                                        <Plus className="w-3 h-3 text-text-primary" />
                                    </button>
                                </div>
                                <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Next: {levels[Math.min(currentLevel - 1, levels.length - 1)]?.SummonsRequired || '?'}</div>
                            </div>
                        </div>

                        {/* Winders Input */}
                        <div className="space-y-2 pt-2 pb-2">
                            <label className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
                                <SpriteIcon name="MountKey" size={16} />
                                Available Winders
                            </label>
                            <div className="relative group">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors">
                                    <SpriteIcon name="MountKey" size={20} />
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
                                        <div className="text-lg font-mono font-bold text-accent-primary flex items-center gap-1">
                                            <span className="text-xs opacity-50 font-normal">Lv.{currentLevel} ➔</span>
                                            Lv.{results.endLevel}
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
                                                        {Math.floor(item.count).toLocaleString()}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        {item.summonPoints > 0 && (
                                                            <div className="flex flex-col items-end text-[9px] text-text-muted font-mono leading-tight bg-white/5 px-1.5 py-0.5 rounded">
                                                                <span className="opacity-50">Summon</span>
                                                                <span className="text-white font-bold">{Math.floor(item.summonPoints).toLocaleString()}</span>
                                                            </div>
                                                        )}
                                                        {item.mergePoints > 0 && (
                                                            <div className="flex flex-col items-end text-[9px] text-accent-secondary/70 font-mono leading-tight bg-accent-secondary/5 px-1.5 py-0.5 rounded">
                                                                <span className="opacity-50">Merge</span>
                                                                <span className="text-accent-secondary font-bold">{Math.floor(item.mergePoints).toLocaleString()}</span>
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
                                    Update Level & Progress to Lv.{results.endLevel}
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
