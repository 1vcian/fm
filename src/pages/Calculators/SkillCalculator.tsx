import { useSkillsCalculator } from '../../hooks/useSkillsCalculator';
import { useProfile } from '../../context/ProfileContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { Info, Trophy, Zap, Minus, Plus, RefreshCcw } from 'lucide-react';

export default function SkillCalculator() {
    const { profile, updateNestedProfile } = useProfile();
    const {
        level, setLevel,
        progress, setProgress,
        ticketCount, setTicketCount,
        results,
        techBonuses,
        maxPossibleLevel,
        levels,
        applyResultsToProfile
    } = useSkillsCalculator();

    // Correct Colors from Tailwind Config
    const RARITY_COLORS: Record<string, string> = {
        Common: '#F1F1F1',    // Age 1 / Common
        Rare: '#5DD8FF',      // Age 2 / Rare
        Epic: '#5CFE89',      // Age 3 / Epic
        Legendary: '#FDFF5D', // Age 4 / Legendary
        Ultimate: '#FF5D5D',  // Age 5 / Ultimate
        Mythic: '#D55DFF',    // Age 6 / Interstellar / Mythic?? (Checking config: Interstellar is D55DFF, Mythic is D55DFF). OK.
    };


    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <SpriteIcon name="SkillTicket" size={40} />
                    Skill Calculator
                </h1>
                <p className="text-text-secondary">Calculate expected skills and War Points from your tickets.</p>


                {techBonuses.extraChance > 0 && (
                    <div className="flex flex-wrap justify-center gap-3 text-xs pt-3">
                        <span className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 font-mono flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            +{Math.round(techBonuses.extraChance * 100)}% Extra Skills (Tree)
                        </span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* INPUTS */}
                {/* INPUTS: Configuration (Adapted from Eggs.tsx Select Stage) */}
                <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 h-fit">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SpriteIcon name="SkillKey" size={20} className="text-accent-tertiary" />
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
                                        onClick={() => setLevel(Math.max(1, level - 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={level <= 1}
                                    >
                                        <Minus className="w-3 h-3 text-text-primary" />
                                    </button>
                                    <input
                                        type="number"
                                        min="1"
                                        max={maxPossibleLevel}
                                        value={level}
                                        onChange={(e) => setLevel(Math.max(1, Math.min(maxPossibleLevel, Number(e.target.value))))}
                                        className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                    />
                                    <button
                                        onClick={() => setLevel(Math.min(maxPossibleLevel, level + 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={level >= maxPossibleLevel}
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
                                        onClick={() => setProgress(Math.max(0, progress - 1))}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                        disabled={progress <= 0}
                                    >
                                        <Minus className="w-3 h-3 text-text-primary" />
                                    </button>
                                    <input
                                        type="number"
                                        min="0"
                                        value={progress}
                                        onChange={(e) => setProgress(Number(e.target.value))}
                                        className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                    />
                                    <button
                                        onClick={() => setProgress(progress + 1)}
                                        className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors flex items-center justify-center shrink-0 w-8 h-8"
                                    >
                                        <Plus className="w-3 h-3 text-text-primary" />
                                    </button>
                                </div>
                                <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Next: {levels[Math.min(level - 1, levels.length - 1)]?.SummonsRequired || '?'}</div>
                            </div>
                        </div>

                        {/* Ticket Input */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-text-secondary uppercase flex items-center gap-2">
                                    <SpriteIcon name="SkillTicket" size={16} />
                                    Available Tickets
                                </label>
                                <div className="relative group">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                        <SpriteIcon name="SkillTicket" size={20} className="opacity-50" />
                                    </div>
                                    <input
                                        type="number"
                                        value={ticketCount}
                                        onChange={(e) => setTicketCount(Number(e.target.value))}
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
                                    When ON, reaching max level resets it to 1 of the next tier. When OFF, extra tickets progress only the max level.
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
                                {/* Total Points */}
                                <div className="p-4 bg-bg-primary rounded-xl border border-border flex items-center justify-between">
                                    <div>
                                        <div className="text-xs text-text-secondary font-bold uppercase mb-1">Total War Points</div>
                                        <div className="text-2xl font-black text-white drop-shadow-md">
                                            {Math.floor(results.totalPoints).toLocaleString()}
                                        </div>
                                    </div>
                                    <Trophy className="w-8 h-8 text-accent-primary opacity-50" />
                                </div>
                                <div className="text-[10px] text-text-muted/60 px-2 -mt-4 mb-4 text-right">
                                    * Points from Skill Level Ups are not included (drop dependent)
                                </div>

                                {results.summonsToMax && (
                                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                                            <img src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} alt="Star" className="w-6 h-6 object-contain" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-xs font-bold text-amber-400 uppercase">Max Level Milestone</div>
                                            <div className="text-[11px] text-text-secondary leading-relaxed">
                                                You reach <span className="text-white font-bold">Max Level</span> in <span className="text-amber-400 font-bold">{results.summonsToMax.toLocaleString()} summons</span> ({(results.summonsToMax * results.finalCost).toLocaleString()} tickets).
                                                The remaining <span className="text-white font-bold">{((results.numSummons - results.summonsToMax) * results.finalCost).toLocaleString()}</span> tickets progress 
                                                into <span className="text-amber-400 font-bold">{results.simulateAscension ? `Ascension ${results.endAscensionLevel}` : 'Max Level'}</span>.
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Summons Info Grid */}
                                <div className="grid grid-cols-4 gap-3 pb-2 border-b border-white/5">
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Summons</div>
                                        <div className="text-lg font-mono font-bold text-white">
                                            {Math.floor(results.numSummons).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Skills</div>
                                        <div className="text-lg font-mono font-bold text-accent-primary">
                                            {Math.floor(results.totalSkills).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">End Level</div>
                                        <div className="text-lg font-mono font-bold text-accent-primary flex flex-col justify-center">
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs opacity-50 font-normal">Lv.{level} ➔</span>
                                                Lv.{results.endLevel}
                                            </div>
                                            {results.endAscensionLevel > (profile.misc.skillAscensionLevel || 0) && (
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

                                {/* Skills Breakdown */}
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                        <span>Rarity</span>
                                        <span>Expected Count</span>
                                    </div>
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
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
                                                <div className="flex flex-col items-end">
                                                    <span className="font-mono font-bold text-accent-primary">
                                                        {Math.floor(item.count).toLocaleString()}
                                                    </span>
                                                    {(item.pointsPerUnit ?? 0) > 0 && (
                                                        <div className="flex flex-col items-end text-[10px] text-text-muted font-mono leading-tight">
                                                            <span>{item.pointsPerUnit.toLocaleString()} pts/unit</span>
                                                            <span className="text-accent-secondary font-bold">
                                                                {Math.floor(item.totalPoints || 0).toLocaleString()} pts
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="text-xs text-right text-text-muted mt-2 border-t border-white/5 pt-2">
                                    Yield: {Math.floor(results.totalSkills).toLocaleString()} Skills
                                    <span className="opacity-50 mx-1">|</span>
                                    Skills/Ticket: {(results.totalSkills / (ticketCount || 1)).toFixed(2)}
                                </div>

                                <button
                                    onClick={applyResultsToProfile}
                                    className="w-full py-3 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 rounded-xl text-accent-primary font-bold text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-accent-primary/5 active:scale-95"
                                >
                                    <RefreshCcw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                                    Update Level to Lv.{results.endLevel}{results.endAscensionLevel > (profile.misc.skillAscensionLevel || 0) ? ` (Asc. ${results.endAscensionLevel})` : ''}
                                </button>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                <Info className="w-8 h-8 opacity-50" />
                                <p>Enter tickets to see results</p>
                            </div>
                        )}
                    </CardContent>

                    {/* Background Decoration */}
                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                        <SpriteIcon name="SkillTicket" size={256} className="grayscale" />
                    </div>
                </Card>
            </div>
        </div >
    );
}
