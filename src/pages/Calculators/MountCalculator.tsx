import { useMountsCalculator } from '../../hooks/useMountsCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { RefreshCw, Wallet, Target } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function MountCalculator() {
    const {
        level, setLevel,
        mode, setMode,
        windersCount, setWindersCount,
        targetPoints, setTargetPoints,
        techBonuses,
        calculationResults,
        targetResults,
    } = useMountsCalculator();

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <SpriteIcon name="PetKey" size={32} className="text-accent-primary" />
                    Mount Calculator
                </h1>
                <p className="text-text-secondary">Forecast summon drops and points based on your winders.</p>

                {/* Tech Status Tag */}
                <div className="flex justify-center gap-2 text-xs pt-2">
                    {techBonuses.costReduction > 0 && (
                        <span className="px-3 py-1 rounded-full bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-mono">
                            -{Math.round(techBonuses.costReduction * 100)}% Cost
                        </span>
                    )}
                    {techBonuses.extraChance > 0 && (
                        <span className="px-3 py-1 rounded-full bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-mono">
                            +{Math.round(techBonuses.extraChance * 100)}% Free
                        </span>
                    )}
                </div>
            </div>

            {/* Mode Switcher (Tabs) */}
            <div className="flex justify-center gap-4 mb-6">
                <button
                    onClick={() => setMode('calculate')}
                    className={cn(
                        "px-6 py-2 rounded-lg font-bold transition-all",
                        mode === 'calculate'
                            ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                            : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4" />
                        Calculator
                    </div>
                </button>
                <button
                    onClick={() => setMode('target')}
                    className={cn(
                        "px-6 py-2 rounded-lg font-bold transition-all",
                        mode === 'target'
                            ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                            : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Planner
                    </div>
                </button>
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
                        {/* Level Slider */}
                        <div className="space-y-2 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                            <div className="flex justify-between text-sm">
                                <span className="text-text-secondary font-bold uppercase text-xs">Summon Level</span>
                                <span className="font-bold text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded border border-accent-primary/20">
                                    Lv. {level}
                                </span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={level}
                                onChange={(e) => setLevel(parseInt(e.target.value))}
                                className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary mt-2"
                            />
                        </div>

                        {/* Dynamic Inputs */}
                        {mode === 'calculate' ? (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
                                    Available Winders
                                </label>
                                <div className="relative group">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors">
                                        <SpriteIcon name="PetKey" size={20} />
                                    </div>
                                    <input
                                        type="number"
                                        value={windersCount}
                                        onChange={(e) => setWindersCount(Number(e.target.value))}
                                        className="w-full bg-bg-input border border-border rounded-lg py-3 pl-10 pr-4 text-white font-mono text-lg focus:border-accent-primary outline-none transition-colors"
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
                                    Target Points
                                </label>
                                <div className="relative group">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors">
                                        <Target className="w-5 h-5" />
                                    </div>
                                    <input
                                        type="number"
                                        value={targetPoints}
                                        onChange={(e) => setTargetPoints(Number(e.target.value))}
                                        className="w-full bg-bg-input border border-border rounded-lg py-3 pl-10 pr-4 text-white font-mono text-lg focus:border-accent-primary outline-none transition-colors"
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        )}
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
                        {mode === 'calculate' ? (
                            <>
                                <div className="p-4 bg-bg-primary rounded-xl border border-border">
                                    <div className="text-xs text-text-secondary font-bold uppercase mb-1">Total Points</div>
                                    <div className="text-4xl font-black text-white drop-shadow-md">
                                        {Math.floor(calculationResults.totalPoints).toLocaleString()}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                        <div className="text-xs text-text-muted mb-1 uppercase font-bold">Paid Summons</div>
                                        <div className="font-mono text-xl text-white">
                                            {calculationResults.paidSummons.toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                        <div className="text-xs text-text-muted mb-1 uppercase font-bold">Total (+Free)</div>
                                        <div className="font-mono text-xl text-accent-primary">
                                            {calculationResults.totalSummons.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="p-4 bg-bg-primary rounded-xl border border-border">
                                    <div className="text-xs text-text-secondary font-bold uppercase mb-1">Winders Needed</div>
                                    <div className="text-4xl font-black text-white drop-shadow-md">
                                        {Math.ceil(targetResults.windersNeeded).toLocaleString()}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                        <div className="text-xs text-text-muted mb-1 uppercase font-bold">Target Pts</div>
                                        <div className="font-mono text-xl text-text-secondary">{targetPoints.toLocaleString()}</div>
                                    </div>
                                    <div className="p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                        <div className="text-xs text-text-muted mb-1 uppercase font-bold">Summons</div>
                                        <div className="font-mono text-xl text-accent-primary">{targetResults.summonsNeeded.toLocaleString()}</div>
                                    </div>
                                </div>
                            </>
                        )}
                    </CardContent>

                    {/* Background Decoration */}
                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <div className="w-64 h-64 text-accent-primary">
                            <SpriteIcon name="PetKey" size={256} className="text-accent-primary" />
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
