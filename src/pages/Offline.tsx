import { useState, useMemo } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { useTreeMode } from '../context/TreeModeContext';
import { Card } from '../components/UI/Card';
import { TrendingUp, Info } from 'lucide-react';
import { GameIcon } from '../components/UI/GameIcon';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { formatNumber } from '../utils/format';
import { cn } from '../lib/utils';

export default function Offline() {
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { data: techLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techMapping } = useGameData<any>('TechTreeMapping.json');
    const { data: idleConfig } = useGameData<any>('IdleConfig.json');

    const [totalOfflineHours, setTotalOfflineHours] = useState(2);

    // Calculate bonuses based on current Tree Mode
    const bonuses = useMemo(() => {
        let coinMultiplier = 1;
        let hammerMultiplier = 1;
        let maxTimeMultiplier = 1;

        if (!profile?.techTree || !techLibrary || !techMapping?.trees) {
            return { coinMultiplier, hammerMultiplier, maxTimeMultiplier };
        }

        const getEffectiveTree = () => {
            if (treeMode === 'my') return profile.techTree;
            if (treeMode === 'empty') return { Forge: {}, Power: {}, SkillsPetTech: {} } as any;

            // for 'max' mode, build tree from mapping and max levels from library
            const maxTree: any = { Forge: {}, Power: {}, SkillsPetTech: {} };
            Object.entries(techMapping.trees).forEach(([treeName, treeDef]: [string, any]) => {
                if (treeDef.nodes) {
                    treeDef.nodes.forEach((node: any) => {
                        const nodeConfig = techLibrary[node.type];
                        maxTree[treeName][node.id] = nodeConfig?.MaxLevel || 5;
                    });
                }
            });
            return maxTree;
        };

        const activeTree = getEffectiveTree();

        Object.entries(activeTree).forEach(([treeName, nodes]) => {
            const treeMapping = techMapping.trees[treeName];
            if (!treeMapping?.nodes) return;

            Object.entries(nodes as Record<string, number>).forEach(([nodeId, level]) => {
                if (level <= 0) return;

                const nodeDef = treeMapping.nodes.find((n: any) => n.id === parseInt(nodeId));
                if (!nodeDef) return;

                const nodeConfig = techLibrary[nodeDef.type];
                if (!nodeConfig?.Stats?.[0]) return;

                const stat = nodeConfig.Stats[0];
                const bonusValue = stat.Value + ((level - 1) * stat.ValueIncrease);

                if (nodeDef.type === 'CoinOfflineReward') {
                    coinMultiplier += bonusValue;
                } else if (nodeDef.type === 'HammerOfflineReward') {
                    hammerMultiplier += bonusValue;
                } else if (nodeDef.type === 'MaxOfflineReward') {
                    maxTimeMultiplier += bonusValue;
                }
            });
        });

        return { coinMultiplier, hammerMultiplier, maxTimeMultiplier };
    }, [profile, techLibrary, techMapping, treeMode]);

    const baseMaxTimeHours = idleConfig?.MaxIdleSeconds ? idleConfig.MaxIdleSeconds / 3600 : 2;
    const maxOfflineHours = baseMaxTimeHours * bonuses.maxTimeMultiplier;

    // Formatting Helpers
    const formatHmMessages = (totalHours: number) => {
        const totalMinutes = Math.round(totalHours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h}h${m > 0 ? ` ${m}m` : ''}`;
    };

    // Constrain total offline hours to max for ACTUAL earnings
    const effectiveHours = Math.min(totalOfflineHours, maxOfflineHours);
    const isOverCap = totalOfflineHours > maxOfflineHours;

    // Calculate rates
    const rates = useMemo(() => {
        if (!idleConfig) return { coinsPerSec: 0, hammersPerMin: 0 };

        const baseCoinsPerSec = idleConfig.CoinsPerSecond || 1;
        const baseHammersPerMin = idleConfig.HammersPerMinute || 1;

        return {
            coinsPerSec: baseCoinsPerSec * bonuses.coinMultiplier,
            hammersPerMin: baseHammersPerMin * bonuses.hammerMultiplier
        };
    }, [idleConfig, bonuses]);

    // Actual Earnings (Capped)
    const totalCoins = Math.floor(rates.coinsPerSec * effectiveHours * 3600);
    const totalHammers = Math.floor((rates.hammersPerMin / 60) * effectiveHours * 3600);

    // Projected Earnings (If uncapped)
    const projectedCoins = Math.floor(rates.coinsPerSec * totalOfflineHours * 3600);
    const projectedHammers = Math.floor((rates.hammersPerMin / 60) * totalOfflineHours * 3600);

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in relative">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <SpriteIcon name="Timer" size={40} className="drop-shadow-glow" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Offline Rewards
                    </h1>
                    <p className="text-text-muted">Calculate earnings while you are away</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Inputs */}
                <div className="space-y-6">
                    <Card>
                        <h2 className="font-semibold mb-6 text-accent-primary flex items-center gap-2">
                            <SpriteIcon name="Timer" size={20} />
                            Time Offline
                        </h2>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Hours */}
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                    <SpriteIcon name="Timer" size={24} />
                                </div>
                                <input
                                    type="number"
                                    min="0"
                                    className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-12 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                    value={Math.floor(totalOfflineHours)}
                                    onChange={(e) => {
                                        const h = Math.max(0, parseInt(e.target.value) || 0);
                                        const m = Math.round((totalOfflineHours - Math.floor(totalOfflineHours)) * 60);
                                        setTotalOfflineHours(h + (m / 60));
                                    }}
                                    placeholder="0"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-muted">H</span>
                            </div>

                            {/* Minutes */}
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                    <SpriteIcon name="Timer" size={24} className="opacity-50" />
                                </div>
                                <input
                                    type="number"
                                    min="0"
                                    max="59"
                                    className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-12 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                    value={Math.round((totalOfflineHours - Math.floor(totalOfflineHours)) * 60)}
                                    onChange={(e) => {
                                        const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                        const h = Math.floor(totalOfflineHours);
                                        setTotalOfflineHours(h + (m / 60));
                                    }}
                                    placeholder="0"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-muted">M</span>
                            </div>
                        </div>
                        <p className="text-[10px] text-text-muted italic mt-6 px-1">
                            Calculated using base game rates from IdleConfig. Rewards are constant across all stages.
                        </p>
                    </Card>

                    <Card className="bg-gradient-to-br from-bg-secondary to-bg-card border-none">
                        <h3 className="font-bold text-accent-secondary mb-3 text-center uppercase text-xs tracking-widest">Offline Capacity</h3>
                        <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="p-3 bg-black/20 rounded">
                                <div className="text-xs text-text-muted uppercase font-bold">Base</div>
                                <div className="font-bold">{baseMaxTimeHours}h</div>
                            </div>
                            <div className="p-3 bg-accent-primary/10 rounded border border-accent-primary/20">
                                <div className="text-xs text-accent-primary uppercase font-bold">With Tech</div>
                                <div className="font-bold text-accent-primary">
                                    {formatHmMessages(maxOfflineHours)}
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Results */}
                <div className="space-y-6">
                    <Card className="h-full">
                        <h2 className="font-semibold mb-6 text-accent-primary text-center">Calculated Rates</h2>

                        {isOverCap && (
                            <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                                <div className="flex items-center gap-2 mb-2 text-orange-400 font-bold text-sm">
                                    <Info className="w-4 h-4" />
                                    <span>Time Exceeds Capacity ({formatHmMessages(maxOfflineHours)})</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-center">
                                    <div className="p-2 bg-black/20 rounded">
                                        <div className="text-[10px] uppercase text-text-muted">Projected</div>
                                        <div className="text-white font-bold">{formatHmMessages(totalOfflineHours)}</div>
                                    </div>
                                    <div className="p-2 bg-black/20 rounded ring-1 ring-orange-500/30">
                                        <div className="text-[10px] uppercase text-orange-400/80">Actual Cap</div>
                                        <div className="text-orange-400 font-bold">{formatHmMessages(maxOfflineHours)}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 mb-4">
                            <div className="p-4 bg-bg-input rounded-xl border border-border/50 flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-text-secondary text-sm">
                                        <GameIcon name="coin" className="w-5 h-5" />
                                        <span>Coins / Second</span>
                                    </div>
                                    <div className="text-xl font-bold text-accent-primary">
                                        {rates.coinsPerSec.toFixed(2)}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-text-muted">With Tech</span>
                                    <span className="text-accent-primary">+{Math.round((bonuses.coinMultiplier - 1) * 100)}%</span>
                                </div>
                            </div>

                            <div className="p-4 bg-bg-input rounded-xl border border-border/50 flex flex-col gap-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-text-secondary text-sm">
                                        <GameIcon name="hammer" className="w-5 h-5" />
                                        <span>Hammers / Minute</span>
                                    </div>
                                    <div className="text-xl font-bold text-white">
                                        {rates.hammersPerMin.toFixed(2)}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-text-muted">With Tech</span>
                                    <span className="text-accent-tertiary">+{Math.round((bonuses.hammerMultiplier - 1) * 100)}%</span>
                                </div>
                            </div>
                        </div>

                        <div className="py-6 border-t border-border/50 mt-4">
                            <h2 className="font-semibold mb-6 text-accent-primary text-center flex items-center justify-center gap-2">
                                <TrendingUp className="w-5 h-5" />
                                {isOverCap ? 'Earnings Comparison' : 'Estimated Total Earnings'}
                            </h2>

                            {isOverCap ? (
                                <div className="grid grid-cols-2 gap-3">
                                    {/* Projected */}
                                    <div className="p-3 bg-white/5 rounded-xl border border-white/10 opacity-60">
                                        <div className="text-xs text-center mb-3 font-bold text-text-muted uppercase tracking-wider">Projected</div>
                                        <div className="space-y-3">
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <GameIcon name="coin" className="w-4 h-4 grayscale opacity-70" />
                                                    <span className="text-[10px] text-text-muted uppercase">Coins</span>
                                                </div>
                                                <div className="font-mono font-bold text-white">{formatNumber(projectedCoins)}</div>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <GameIcon name="hammer" className="w-4 h-4 grayscale opacity-70" />
                                                    <span className="text-[10px] text-text-muted uppercase">Hammers</span>
                                                </div>
                                                <div className="font-mono font-bold text-white">{formatNumber(projectedHammers)}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actual */}
                                    <div className="p-3 bg-accent-primary/10 rounded-xl border border-accent-primary/30 relative overflow-hidden ring-1 ring-accent-primary/50">
                                        <div className="absolute top-0 right-0 bg-accent-primary text-black text-[9px] font-bold px-2 py-0.5 rounded-bl shadow-sm">REAL</div>
                                        <div className="text-xs text-center mb-3 font-bold text-accent-primary uppercase tracking-wider">Actual</div>
                                        <div className="space-y-3">
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <GameIcon name="coin" className="w-4 h-4" />
                                                    <span className="text-[10px] text-text-muted uppercase">Coins</span>
                                                </div>
                                                <div className="font-mono font-black text-accent-primary text-lg">{formatNumber(totalCoins)}</div>
                                            </div>
                                            <div className="flex flex-col items-center">
                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                    <GameIcon name="hammer" className="w-4 h-4" />
                                                    <span className="text-[10px] text-text-muted uppercase">Hammers</span>
                                                </div>
                                                <div className="font-mono font-black text-white text-lg">{formatNumber(totalHammers)}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="p-4 bg-accent-primary/5 rounded-xl border border-accent-primary/20 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <GameIcon name="coin" className="w-10 h-10" />
                                            <span className="font-bold text-text-secondary">Coins</span>
                                        </div>
                                        <div className="text-3xl font-black text-accent-primary drop-shadow-glow">
                                            {formatNumber(totalCoins)}
                                        </div>
                                    </div>

                                    <div className="p-4 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <GameIcon name="hammer" className="w-10 h-10" />
                                            <span className="font-bold text-text-secondary">Hammers</span>
                                        </div>
                                        <div className="text-3xl font-black text-white">
                                            {formatNumber(totalHammers)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>

            {/* Background Decoration */}
            <div className="fixed -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <SpriteIcon name="Timer" size={256} className="grayscale" />
            </div>
        </div>
    );
}
