import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useGameData } from '../hooks/useGameData';
import { useTreeModifiers } from '../hooks/useCalculatedStats';
import { forgeTierCost, forgeUpgradeDurationSeconds } from '../hooks/useForgeCalculator';
import { Card, CardHeader, CardTitle } from '../components/UI/Card';
import { ArrowRight } from 'lucide-react';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { parseForgeUpgrades, topDisplayedForgeLevel, maxDisplayedForgeLevel, ascensionForDisplayedLevel, forgeLevelDef } from '../utils/forgeConfig';

export default function ForgeWiki() {
    const { data: upgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const { data: dropData } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const techModifiers = useTreeModifiers();
    const forgeCostReduction = techModifiers['ForgeUpgradeCost'] || 0;
    const forgeTimerSpeed = techModifiers['ForgeTimerSpeed'] || 0;

    // Rows by displayed level, either ForgeUpgradeLibrary format (utils/forgeConfig.ts): key N is the
    // upgrade that leaves level N. In configs listing the levels per forge ascension, the top level
    // depends on the ascension (MaxForgeLevel(config, ascension)) and PlayerForgeModel.Ascend
    // (RVA 0x7CD7570) takes the forge back to level 1.
    const data = useMemo(() => {
        const fu = parseForgeUpgrades(upgradeData);
        if (!fu || !dropData) return [];
        const ascRows: any[] = ascensionConfigs?.Forge?.AscensionConfigPerLevel ?? [];
        const top = topDisplayedForgeLevel(fu);
        const rows = [];
        for (let level = 1; level <= top; level++) {
            // Ascensions whose top level is this one, with the price of the next ascension.
            const ascends = ascRows
                .map((r, a) => ({ to: a + 1, cost: r?.Cost?.Amount ?? 0, top: maxDisplayedForgeLevel(fu, a) }))
                .filter(x => x.top === level && x.cost > 0)
                .map(({ to, cost }) => ({ to, cost }));
            const def = forgeLevelDef(fu, level);
            if (!def) {
                rows.push({ level, tiers: 0, baseCost: 0, cost: 0, costPerTier: 0, totalTimeSeconds: 0, isMax: true, ascends, needsAscension: 0 });
                continue;
            }
            const baseCost = def.Cost || 0;
            const tiers = def.Tiers || 1;
            // Each tier is priced and paid on its own (ForgeExtensions.GetForgeTierUpgradeCost 0x7C44E28).
            const costPerTier = forgeTierCost(def, forgeCostReduction);
            const cost = costPerTier * tiers;
            // One timer per level, started after the last tier (ForgeUpgradeStartAction 0x7CD4DEC).
            const totalTimeSeconds = forgeUpgradeDurationSeconds(def, forgeTimerSpeed);
            // The forge ascension that allows the next level.
            const needsAscension = ascensionForDisplayedLevel(fu, level + 1) ?? 0;
            rows.push({ level, tiers, baseCost, cost, costPerTier, totalTimeSeconds, isMax: false, ascends, needsAscension });
        }
        return rows;
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
                <GameAssetIcon asset={{ icon: 'TechTreeForge' }} size={48} className="mb-4 opacity-20" />
                <p>Loading Forge configurations</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header */}
            <div className="text-center space-y-2 mb-8">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <GameAssetIcon asset={{ icon: 'TechTreeForge' }} size={32} />
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
                                            {!row.isMax && row.needsAscension > 0 && ` (ascension ${row.needsAscension})`}
                                        </span>
                                        {row.ascends.map(x => (
                                            <span key={x.to} className="text-[10px] text-amber-400 font-normal block">
                                                Ascend to {x.to}: {new Intl.NumberFormat('en-US').format(x.cost)} Coins
                                            </span>
                                        ))}
                                    </td>
                                    <td className="px-4 py-3 text-right text-yellow-500 font-mono">
                                        {row.isMax ? (
                                            row.ascends.length > 0 ? <span className="text-amber-400 font-black">ASCEND</span> : '-'
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
                                    {!row.isMax && <span className="text-text-muted text-xs font-normal ml-2">→ {row.level + 1}{row.needsAscension > 0 && ` (ascension ${row.needsAscension})`}</span>}
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

                            {row.ascends.map(x => (
                                <div key={x.to} className="bg-amber-400/10 p-3 rounded-xl border border-amber-400/30 flex items-center justify-between">
                                    <div className="text-xs font-black text-amber-400 uppercase tracking-wider">Ascend to {x.to}</div>
                                    <div className="text-yellow-500 font-mono font-bold">
                                        {new Intl.NumberFormat('en-US').format(x.cost)} Coins
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
