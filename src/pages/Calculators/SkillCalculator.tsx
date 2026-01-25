import { useSkillsCalculator } from '../../hooks/useSkillsCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { RefreshCw, Ticket, Info, Trophy, Zap, ChevronLeft, ChevronRight } from 'lucide-react';

export default function SkillCalculator() {
    const {
        level, setLevel,
        ticketCount, setTicketCount,
        results,
        techBonuses
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

    // Helpers
    const getStageLabel = (lvl: number) => {
        const world = Math.floor((lvl - 1) / 10) + 1;
        const stage = ((lvl - 1) % 10) + 1;
        return `${world}-${stage}`;
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <Ticket className="w-8 h-8 text-accent-primary" />
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
                        {/* Stage Selector */}
                        <div className="space-y-4 pt-2">
                            <div className="flex items-center justify-between bg-bg-primary/50 p-4 rounded-xl border border-white/5">
                                <div>
                                    <div className="text-xs font-bold text-text-secondary uppercase">Summon Level</div>
                                    <div className="text-3xl font-black text-white flex items-center gap-3">
                                        Stage {getStageLabel(level)}
                                        <span className="text-sm font-bold text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded border border-accent-primary/20">
                                            Level {level}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => setLevel(Math.max(1, level - 1))}
                                        disabled={level <= 1}
                                        className="p-3 bg-bg-input rounded-xl hover:bg-bg-tertiary disabled:opacity-30 border border-white/5 transition-all active:scale-95"
                                    >
                                        <ChevronLeft className="w-6 h-6" />
                                    </button>

                                    <button
                                        onClick={() => setLevel(Math.min(100, level + 1))}
                                        className="p-3 bg-bg-input rounded-xl hover:bg-bg-tertiary disabled:opacity-30 border border-white/5 transition-all active:scale-95"
                                    >
                                        <ChevronRight className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>

                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={level}
                                onChange={(e) => setLevel(parseInt(e.target.value))}
                                className="w-full h-4 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                            />
                            <div className="flex justify-between text-[10px] text-text-secondary font-mono px-1">
                                <span>World 1</span>
                                <span>World 5</span>
                                <span>World 10</span>
                            </div>
                        </div>

                        {/* Ticket Input */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-text-secondary uppercase flex items-center gap-2">
                                <SpriteIcon name="SkillTicket" size={16} />
                                Available Tickets
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                    <Ticket className="w-5 h-5" />
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
                    </CardContent>
                </Card>

                {/* RESULTS */}
                <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 relative overflow-hidden">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-accent-primary">
                            <RefreshCw className="w-5 h-5" />
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

                                {/* Summons Info Grid */}
                                <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/5">
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
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                <Info className="w-8 h-8 opacity-50" />
                                <p>Enter tickets to see results</p>
                            </div>
                        )}
                    </CardContent>

                    {/* Background Decoration */}
                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <Ticket className="w-64 h-64 text-accent-primary" />
                    </div>
                </Card>
            </div>
        </div >
    );
}
