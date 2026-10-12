import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameData } from '../hooks/useGameData';
import { useTreeModifiers } from '../hooks/useCalculatedStats';
import { forgeTierCost } from '../hooks/useForgeCalculator';
import { Card, CardHeader, CardTitle } from '../components/UI/Card';
import { Hammer, ArrowRight } from 'lucide-react';

export default function ForgeWiki() {
    const { data: upgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const { data: dropData } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const techModifiers = useTreeModifiers();
    const forgeCostReduction = techModifiers['ForgeUpgradeCost'] || 0;
    const forgeTimerSpeed = techModifiers['ForgeTimerSpeed'] || 0;

    const data = useMemo(() => {
        if (!upgradeData || !dropData) return [];

        // Build levels list from dropData (0..34 -> Level 1..35)
        const sortedKeys = Object.keys(dropData).map(Number).sort((a, b) => a - b);
        
        return sortedKeys.map(id => {
            const level = id + 1;

            // Upgrade Data for THIS level (Upgrade FROM level -> level+1)
            const nextLevelData = upgradeData[String(level)];

            if (!nextLevelData) {
                // Represents max level (or missing data).
                return {
                    level,
                    tiers: 0,
                    baseCost: 0,
                    cost: 0,
                    costPerTier: 0,
                    totalTimeSeconds: 0,
                    isMax: true,
                    ascensionCost: ascensionConfigs?.Forge?.AscensionConfigPerLevel?.[0]?.Cost?.Amount || 0
                };
            }

            // Normal calculation for upgrade TO nextLevel
            const baseCost = nextLevelData.Cost || 0;
            const tiers = nextLevelData.Tiers || 1;
            const baseDuration = nextLevelData.Duration || 0;

            // Each tier is priced and paid on its own (ForgeExtensions.GetForgeTierUpgradeCost 0x77B2C74).
            const costPerTier = forgeTierCost(nextLevelData, forgeCostReduction);
            const cost = costPerTier * tiers;

            // Duration is Total Seconds
            const baseDurationSeconds = baseDuration;

            // Time
            const speedMultiplier = 1 + forgeTimerSpeed;
            const totalTimeSeconds = baseDurationSeconds / speedMultiplier;

            // Ascension cost if max level
            const ascensionCost = ascensionConfigs?.Forge?.AscensionConfigPerLevel?.[0]?.Cost?.Amount || 0;

            return {
                level,
                tiers,
                baseCost,
                cost,
                costPerTier,
                totalTimeSeconds,
                isMax: false,
                ascensionCost: level === sortedKeys.length ? ascensionCost : 0
            };
        });

    }, [upgradeData, dropData, ascensionConfigs, forgeCostReduction, forgeTimerSpeed]);

    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.ceil(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m ${Math.ceil(seconds % 60)}s`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ${Math.ceil(mins % 60)}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    };

    if (!upgradeData || !dropData) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted animate-pulse">
                <Hammer className="w-12 h-12 mb-4 opacity-20" />
                <p>Loading Forge configurations</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header */}
            <div className="text-center space-y-2 mb-8">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <Hammer className="w-8 h-8 text-accent-primary" />
                    Forge Upgrade Wiki
                </h1>
                <p className="text-text-secondary">
                    Detailed stats for every Forge level, adjusted by your active Tech Tree.
                </p>
            </div>

            {/* The per level Age odds live on the Base Drops page (one table, with version compare). */}
            <Link
                to="/wiki/base-drops?tab=forge"
                className="flex items-center justify-between gap-3 p-4 rounded-xl border border-accent-primary/30 bg-accent-primary/5 hover:bg-accent-primary/10 transition-colors"
            >
                <span className="text-sm text-text-secondary">
                    The chance of forging each Age at every Forge level is on the <span className="font-bold text-accent-primary">Base Drops</span> page.
                </span>
                <ArrowRight className="w-4 h-4 text-accent-primary shrink-0" />
            </Link>

            <Card className="overflow-hidden border-border/40 shadow-xl">
                <CardHeader className="border-b border-border/50 bg-bg-secondary/20">
                    <CardTitle className="text-lg">Upgrade Table</CardTitle>
                </CardHeader>
                
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-bg-secondary/50 text-text-secondary font-medium uppercase tracking-wider text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Lvl</th>
                                <th className="px-4 py-3 text-right">Cost (Total)</th>
                                <th className="px-4 py-3 text-right">Cost (Step)</th>
                                <th className="px-4 py-3 text-right">Steps</th>
                                <th className="px-4 py-3 text-right">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {data.map((row) => (
                                <tr key={row.level} className="hover:bg-white/5 transition-colors">
                                    <td className="px-4 py-3 font-bold text-accent-primary">
                                        {row.level}
                                        <span className="text-xs text-text-muted font-normal block">
                                            {row.isMax ? " (Max)" : `→ ${row.level + 1}`}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-yellow-500 font-mono">
                                        {row.isMax ? (
                                            row.ascensionCost > 0 ? (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-amber-400 font-black">ASCEND</span>
                                                    <span className="text-[10px] text-yellow-500/80">
                                                        {new Intl.NumberFormat('en-US').format(row.ascensionCost)} Coins
                                                    </span>
                                                </div>
                                            ) : '-'
                                        ) : (
                                            <>
                                                {new Intl.NumberFormat('en-US', {
                                                    maximumFractionDigits: 0
                                                }).format(row.cost)}
                                                {row.baseCost !== row.cost && (
                                                    <span className="block text-[10px] text-text-muted line-through">
                                                        {new Intl.NumberFormat('en-US', {
                                                            maximumFractionDigits: 0
                                                        }).format(row.baseCost)}
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right text-yellow-500/80 font-mono">
                                        {row.isMax ? '-' : new Intl.NumberFormat('en-US', {
                                            maximumFractionDigits: 0
                                        }).format(row.costPerTier)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">
                                        {row.isMax ? '-' : row.tiers}
                                    </td>
                                    <td className="px-4 py-3 text-right text-text-secondary">
                                        {row.isMax ? '-' : formatTime(row.totalTimeSeconds)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden divide-y divide-border/30">
                    {data.map((row) => (
                        <div key={row.level} className="p-4 space-y-4 hover:bg-white/5 transition-colors">
                            <div className="flex justify-between items-center">
                                <div className="font-black text-xl text-accent-primary">
                                    Lvl {row.level}
                                    {!row.isMax && <span className="text-text-muted text-xs font-normal ml-2">→ {row.level + 1}</span>}
                                    {row.isMax && <span className="text-text-muted text-xs font-normal ml-2">(Max)</span>}
                                </div>
                                <div className="text-text-secondary font-bold text-sm">
                                    {row.isMax ? '-' : formatTime(row.totalTimeSeconds)}
                                </div>
                            </div>

                            {!row.isMax && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-bg-input/50 p-2 rounded border border-border/50">
                                        <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Total Cost</div>
                                        <div className="text-yellow-500 font-mono font-bold">
                                            {new Intl.NumberFormat('en-US').format(row.cost)}
                                        </div>
                                    </div>
                                    <div className="bg-bg-input/50 p-2 rounded border border-border/50">
                                        <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Cost Per Step</div>
                                        <div className="text-yellow-500/80 font-mono text-sm capitalize">
                                            {new Intl.NumberFormat('en-US').format(row.costPerTier)} × {row.tiers}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {row.isMax && row.ascensionCost > 0 && (
                                <div className="bg-amber-400/10 p-3 rounded-xl border border-amber-400/30 flex items-center justify-between">
                                    <div className="text-xs font-black text-amber-400 uppercase tracking-wider">Ascension Price</div>
                                    <div className="text-yellow-500 font-mono font-bold">
                                        {new Intl.NumberFormat('en-US').format(row.ascensionCost)} Coins
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
