import { useForgeCalculator } from '../hooks/useForgeCalculator';
import { Card, CardHeader, CardTitle } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Input } from '../components/UI/Input';
import { Select } from '../components/UI/Select';
import { formatNumber } from '../utils/format';
import { tierNames } from '../constants/forgeData';
import { cn } from '../lib/utils';
import { Hammer, Coins, Target, Sparkles } from 'lucide-react';

export default function Home() {
    const {
        level, setLevel,
        mode, setMode,
        freeSummonPercent, setFreeSummonPercent,
        hammerCount, setHammerCount,
        targetExp, setTargetExp,
        maxItemLevel, setMaxItemLevel,
        priceBonus, setPriceBonus,
        expPerHammer,
        totalExp,
        actualHammersNeeded,
        expectedWithRecommended,
        coinEstimates,
        probabilityData,
        upgradeStats
    } = useForgeCalculator();

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Page Header */}
            <div className="text-center space-y-2 mb-8">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <Hammer className="w-8 h-8 text-accent-primary" />
                    Forge Calculator
                </h1>
                <p className="text-text-secondary">
                    Optimize your forge strategy, calculate costs, and plan your upgrades.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: Controls */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configuration</CardTitle>
                        </CardHeader>

                        <div className="space-y-6">
                            {/* Forge Level */}
                            <Select
                                label="Forge Level"
                                value={level}
                                onChange={(e) => setLevel(parseInt(e.target.value))}
                            >
                                {Array.from({ length: 34 }, (_, i) => i + 1).map((lvl) => (
                                    <option key={lvl} value={lvl}>Level {lvl}</option>
                                ))}
                            </Select>

                            {/* Upgrade Info */}
                            {upgradeStats && (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                                            <div className="text-[10px] uppercase font-bold text-yellow-500/70 mb-1">Upgrade Cost</div>
                                            <div className="flex flex-col">
                                                <div className="font-mono font-bold text-yellow-400">
                                                    {formatNumber(upgradeStats.cost)}
                                                </div>
                                                {upgradeStats.reduction > 0 && (
                                                    <div className="text-[10px] text-text-muted line-through">
                                                        {formatNumber(upgradeStats.baseCost)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="p-3 bg-accent-primary/10 rounded-lg border border-accent-primary/20">
                                            <div className="text-[10px] uppercase font-bold text-accent-primary/70 mb-1">Cost Per Hammer</div>
                                            <div className="font-mono font-bold text-accent-primary">
                                                {formatNumber(upgradeStats.goldPerHammer)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-3 bg-bg-secondary rounded-lg border border-border">
                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Total EXP Needed</div>
                                            <div className="font-mono font-bold text-text-primary">
                                                {formatNumber(upgradeStats.requiredExp)}
                                            </div>
                                        </div>
                                        <div className="p-3 bg-bg-secondary rounded-lg border border-border">
                                            <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Steps (Hammers)</div>
                                            <div className="font-mono font-bold text-text-primary">
                                                {formatNumber(upgradeStats.hammersToUpgrade)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="p-3 bg-bg-secondary rounded-lg border border-border flex justify-between items-center">
                                            <div className="text-[10px] uppercase font-bold text-text-muted">Estimated Time (Auto)</div>
                                            <div className="font-mono font-bold text-text-primary">
                                                {(() => {
                                                    const seconds = upgradeStats.totalTimeSeconds;
                                                    if (!seconds) return '-';
                                                    if (seconds < 60) return `${Math.ceil(seconds)}s`;
                                                    const mins = Math.floor(seconds / 60);
                                                    if (mins < 60) return `${mins}m ${Math.ceil(seconds % 60)}s`;
                                                    const hours = Math.floor(mins / 60);
                                                    if (hours < 24) return `${hours}h ${Math.ceil(mins % 60)}m`;
                                                    const days = Math.floor(hours / 24);
                                                    return `${days}d ${hours % 24}h`;
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Free Summon Bonus */}
                            <div className="grid grid-cols-1 gap-4">
                                <Input
                                    label="Free Summon Bonus (%)"
                                    type="number"
                                    placeholder="e.g. 10"
                                    value={freeSummonPercent || ''}
                                    onChange={(e) => setFreeSummonPercent(parseFloat(e.target.value) || 0)}
                                />
                            </div>

                            {/* Stats Summary */}
                            <div className="p-4 bg-bg-secondary rounded-lg border border-border flex justify-between items-center">
                                <span className="text-sm text-text-secondary">EXP Per Hammer</span>
                                <span className="text-xl font-bold text-accent-tertiary">{expPerHammer.toFixed(4)}</span>
                            </div>
                        </div>
                    </Card>

                    {/* Calculator Inputs */}
                    <Card>
                        <CardHeader className="flex flex-row justify-between items-center">
                            <CardTitle>Calculator Mode</CardTitle>
                            <div className="flex bg-bg-secondary p-1 rounded-lg border border-border">
                                <Button
                                    variant={mode === 'calculate' ? 'primary' : 'ghost'}
                                    size="sm"
                                    onClick={() => setMode('calculate')}
                                >
                                    Calculate
                                </Button>
                                <Button
                                    variant={mode === 'target' ? 'primary' : 'ghost'}
                                    size="sm"
                                    onClick={() => setMode('target')}
                                >
                                    Target
                                </Button>
                            </div>
                        </CardHeader>

                        <div className="space-y-6">
                            {mode === 'calculate' ? (
                                <>
                                    <Input
                                        label="Number of Hammers"
                                        type="number"
                                        placeholder="e.g. 1000"
                                        value={hammerCount || ''}
                                        onChange={(e) => setHammerCount(parseFloat(e.target.value) || 0)}
                                    />
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input
                                            label="Max Item Level"
                                            type="number"
                                            value={maxItemLevel}
                                            onChange={(e) => setMaxItemLevel(parseFloat(e.target.value) || 100)}
                                        />
                                        <Input
                                            label="Price Bonus (%)"
                                            type="number"
                                            value={priceBonus || ''}
                                            onChange={(e) => setPriceBonus(parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                </>
                            ) : (
                                <Input
                                    label="Target EXP Amount"
                                    type="number"
                                    placeholder="e.g. 50000"
                                    value={targetExp || ''}
                                    onChange={(e) => setTargetExp(parseFloat(e.target.value) || 0)}
                                />
                            )}
                        </div>
                    </Card>
                </div>

                {/* Right Column: Results */}
                <div className="space-y-6">
                    {/* Main Results */}
                    <Card className={cn("transition-all duration-300", (hammerCount > 0 || targetExp > 0) ? "opacity-100" : "opacity-60")}>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-accent-primary" />
                                Results
                            </CardTitle>
                        </CardHeader>

                        <div className="space-y-4">
                            {mode === 'calculate' ? (
                                <>
                                    <div className="flex justify-between items-center p-4 bg-bg-secondary rounded-lg border border-border">
                                        <span className="text-text-secondary">Expected EXP</span>
                                        <span className="text-2xl font-bold text-accent-primary">{formatNumber(totalExp)}</span>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-text-secondary flex items-center gap-2">
                                            <Coins className="w-4 h-4 text-yellow-500" />
                                            Estimated Coins
                                        </div>
                                        <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20 text-center">
                                            <span className="text-xl font-bold text-yellow-400">
                                                {formatNumber(coinEstimates.min)} - {formatNumber(coinEstimates.max)}
                                            </span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex justify-between items-center p-4 bg-bg-secondary rounded-lg border border-border">
                                        <span className="text-text-secondary">Hammers Needed</span>
                                        <span className="text-2xl font-bold text-accent-primary">{formatNumber(actualHammersNeeded)}</span>
                                    </div>
                                    <div className="flex justify-between items-center px-4">
                                        <span className="text-sm text-text-muted">Expected EXP with (rec.) hammers</span>
                                        <span className="text-sm font-medium text-text-secondary">{formatNumber(expectedWithRecommended)}</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>

                    {/* Probability Breakdown */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Target className="w-5 h-5 text-accent-tertiary" />
                                Drop Rates
                            </CardTitle>
                        </CardHeader>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {probabilityData.map((item) => (
                                <div
                                    key={item.tier}
                                    className="flex flex-col items-center p-3 bg-bg-secondary rounded-lg border border-border hover:border-accent-primary/30 transition-colors"
                                >
                                    <span className={cn(
                                        "text-xs font-bold uppercase tracking-wider mb-1",
                                        // Dynamic text color based on tier
                                        `text-age-${item.tier.toLowerCase()}`
                                    )}>
                                        {tierNames[item.tier]}
                                    </span>
                                    <span className="text-lg font-semibold text-text-primary">
                                        {item.probability.toFixed(2)}%
                                    </span>
                                    {mode === 'calculate' && item.count > 0 && (
                                        <span className="text-xs text-text-muted mt-1">
                                            ~{formatNumber(item.count)}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
