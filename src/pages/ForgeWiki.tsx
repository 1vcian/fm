import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useTreeModifiers } from '../hooks/useCalculatedStats';
import { forgeProbabilities, expValues, tierNames } from '../constants/forgeData';
import { Card, CardHeader, CardTitle } from '../components/UI/Card';
import { Hammer } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ForgeWiki() {
    const { data: upgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const techModifiers = useTreeModifiers();
    const forgeCostReduction = techModifiers['ForgeUpgradeCost'] || 0;
    const forgeTimerSpeed = techModifiers['ForgeTimerSpeed'] || 0;
    const freeForgeChance = techModifiers['FreeForgeChance'] || 0;

    const data = useMemo(() => {
        if (!upgradeData) return [];

        // Use forgeProbabilities as the source of truth for levels we want to display.
        // Match them with upgrade data if available.
        const allLevels = Object.keys(forgeProbabilities).map(Number).sort((a, b) => a - b);

        return allLevels.map(level => {
            // Upgrade Data for THIS level (Upgrade FROM level -> level+1)
            // JSON Key N represents the upgrade FROM N to N+1.
            const nextLevelData = upgradeData ? (upgradeData[String(level)] || upgradeData[level]) : null;

            if (!nextLevelData) {
                // Represents max level (or missing data).
                return {
                    level,
                    tiers: 0,
                    baseCost: 0,
                    cost: 0,
                    costPerTier: 0,
                    totalExp: 0,
                    expPerTier: 0,
                    hammersToUpgrade: 0,
                    hammersPerTier: 0,
                    totalTimeSeconds: 0,
                    probs: forgeProbabilities[level], // Still show probabilities for this level
                    isMax: true
                };
            }

            // Normal calculation for upgrade TO nextLevel
            const baseCost = nextLevelData.Cost || 0;
            const tiers = nextLevelData.Tiers || 1;
            const baseDuration = nextLevelData.Duration || 0;

            // Calculate EXP Per Hammer for THIS level
            const probs = forgeProbabilities[level];
            let expPerHammer = 0;
            if (probs) {
                for (const [tier, probability] of Object.entries(probs)) {
                    const exp = expValues[tier] || 0;
                    expPerHammer += (probability / 100) * exp;
                }
            }
            if (expPerHammer === 0) expPerHammer = 1;

            // Apply Modifiers
            const cost = Math.floor(baseCost * (1 - forgeCostReduction));

            // Duration is Total Seconds
            const baseDurationSeconds = baseDuration;

            // Time
            const speedMultiplier = 1 + forgeTimerSpeed;
            const totalTimeSeconds = baseDurationSeconds / speedMultiplier;

            // Hammers
            const baseSecondsPerHammer = 0.25;
            const rawHammersNeeded = Math.ceil(baseDurationSeconds / baseSecondsPerHammer);
            const hammersToUpgrade = Math.ceil(rawHammersNeeded * (1 - freeForgeChance));
            const hammersPerTier = Math.ceil(hammersToUpgrade / tiers);

            const totalExp = baseDurationSeconds;
            const expPerTier = totalExp / tiers;

            return {
                level,
                tiers,
                baseCost,
                cost,
                costPerTier: Math.floor(cost / tiers),
                totalExp,
                expPerTier,
                hammersToUpgrade,
                hammersPerTier,
                totalTimeSeconds,
                probs,
                isMax: false
            };
        });

    }, [upgradeData, forgeCostReduction, forgeTimerSpeed, freeForgeChance]);

    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.ceil(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m ${Math.ceil(seconds % 60)}s`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ${Math.ceil(mins % 60)}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    };

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

            <Card>
                <CardHeader>
                    <CardTitle>Upgrade Table</CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-bg-secondary/50 text-text-secondary font-medium uppercase tracking-wider text-xs">
                            <tr>
                                <th className="px-4 py-3 text-left">Lvl</th>
                                <th className="px-4 py-3 text-right">Cost (Total)</th>
                                <th className="px-4 py-3 text-right">Cost (Step)</th>
                                <th className="px-4 py-3 text-right">Steps</th>
                                <th className="px-4 py-3 text-right text-text-muted">Hammers (Total)</th>
                                <th className="px-4 py-3 text-right">Time</th>
                                <th className="px-4 py-3 text-left">Probabilities</th>
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
                                        {row.isMax ? '-' : (
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
                                    <td className="px-4 py-3 text-right text-text-muted font-mono">
                                        {row.isMax ? '-' : new Intl.NumberFormat('en-US', {
                                            maximumFractionDigits: 0
                                        }).format(row.hammersToUpgrade)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-text-secondary">
                                        {row.isMax ? '-' : formatTime(row.totalTimeSeconds)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {row.probs && Object.entries(row.probs)
                                                .sort((a, b) => b[1] - a[1])
                                                .map(([tier, prob]) => (
                                                    <span key={tier} className={cn(
                                                        "text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary border border-border",
                                                        `text-age-${tier.toLowerCase()}`
                                                    )}>
                                                        {tierNames[tier]}: {prob.toFixed(2)}%
                                                    </span>
                                                ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
