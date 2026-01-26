import {
    Swords, Heart, Shield, Zap, Target, Gauge,
    TrendingUp, Clock, Coins, Star, Crosshair, TreeDeciduous, Sparkles
} from 'lucide-react';
import { AnimatedClock } from '../UI/AnimatedClock';
import { Card } from '../UI/Card';
import { cn } from '../../lib/utils';
import { formatPercent, formatMultiplier, formatCompactNumber } from '../../utils/statsCalculator';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { getStatName } from '../../utils/statNames';

interface StatRowProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subValue?: string;
    count?: number;
    color?: string;
}

function StatRow({ icon, label, value, subValue, count, color = 'text-accent-primary' }: StatRowProps) {
    return (
        <div className="flex flex-col justify-between p-2 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[4.5rem]">
            <div className="flex items-center gap-2 w-full">
                <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary leading-tight break-words">{label}</div>
                    {count !== undefined && count > 0 && (
                        <div className="text-[9px] text-text-muted">({count} Stats)</div>
                    )}
                </div>
            </div>
            <div className="mt-2 w-full text-right">
                <div className={cn("font-mono font-bold text-sm", color)}>
                    {value}
                </div>
                {subValue && <div className="text-[10px] text-text-muted leading-tight break-words">{subValue}</div>}
            </div>
        </div>
    );
}

// Compact stat for grid layouts
function CompactStat({ icon, label, value, color = 'text-accent-primary' }: Omit<StatRowProps, 'subValue'>) {
    return (
        <div className="flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[4rem]">
            <div className="flex items-center gap-1.5 mb-1">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center", color)}>
                    {icon}
                </div>
                <span className="text-xs text-text-muted break-words leading-tight">{label}</span>
            </div>
            <div className={cn("font-mono font-bold text-sm text-right mt-auto", color)}>
                {value}
            </div>
        </div>
    );
}

interface CollapsibleSectionProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: CollapsibleSectionProps) {
    return (
        <details open={defaultOpen} className="group">
            <summary className="flex items-center gap-2 cursor-pointer select-none p-2 -mx-2 rounded-lg hover:bg-bg-input/30 transition-colors list-none">
                <span className="text-text-muted group-open:rotate-90 transition-transform">▶</span>
                {icon}
                <span className="text-xs font-bold uppercase text-text-muted">{title}</span>
            </summary>
            <div className="mt-3 space-y-2">
                {children}
            </div>
        </details>
    );
}

export function StatsSummaryPanel() {
    const stats = useGlobalStats();
    const techModifiers = useTreeModifiers();

    if (!stats) {
        return (
            <Card className="p-6">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <AnimatedClock className="w-8 h-8" />
                    Stats Summary
                </h2>
                <div className="flex justify-center p-8">
                    <div className="animate-spin w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full" />
                </div>
            </Card>
        );
    }

    // Calculate effective Weapon DPS
    // Formula: Damage × AttackSpeed × CritMultiplier × DoubleDamageMultiplier
    const critMultiplier = 1 + stats.criticalChance * (stats.criticalDamage - 1);
    const doubleDmgMultiplier = 1 + stats.doubleDamageChance;
    const attacksPerSecond = 1 / stats.weaponAttackDuration;
    const weaponDps = stats.totalDamage * attacksPerSecond * critMultiplier * doubleDmgMultiplier;

    // Skill DPS (already fully calculated in statEngine including crits/multipliers)
    // Total Effective DPS = Weapon DPS + Skill DPS
    const effectiveDps = weaponDps + stats.skillDps;

    // Healing Per Second calculations
    // 1. Passive Health Regen: MaxHP × HealthRegen% per second
    const regenHps = stats.totalHealth * stats.healthRegen;
    // 2. Lifesteal: DPS × Lifesteal% (healing from damage dealt)
    const lifestealHps = effectiveDps * stats.lifeSteal;
    // 3. Skill Healing (already calculated as HPS)
    const skillHps = stats.skillHps;
    // Total Effective HPS
    const effectiveHps = regenHps + lifestealHps + skillHps;


    // Group tech tree bonuses by category for display
    const treeBonusEntries = Object.entries(techModifiers).filter(([_, v]) => v > 0);

    return (
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <AnimatedClock className="w-8 h-8" />
                Stats Summary
            </h2>

            <div className="space-y-5">
                {/* Summary Stats - Open by default */}
                <CollapsibleSection
                    title="Summary Stats"
                    icon={<Gauge className="w-4 h-4 text-purple-400" />}
                    defaultOpen={true}
                >
                    <StatRow
                        icon={<Gauge className="w-4 h-4" />}
                        label="Total Power"
                        value={stats.power.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        color="text-purple-400"
                    />
                    <StatRow
                        icon={<Swords className="w-4 h-4" />}
                        label="Total Damage"
                        value={stats.totalDamage.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={formatMultiplier(stats.damageMultiplier)}
                        color="text-red-400"
                    />
                    <StatRow
                        icon={<Heart className="w-4 h-4" />}
                        label="Total Health"
                        value={stats.totalHealth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={formatMultiplier(stats.healthMultiplier)}
                        color="text-green-400"
                    />
                    <StatRow
                        icon={<Zap className="w-4 h-4" />}
                        label="Effective DPS"
                        value={effectiveDps.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={`Weapon: ${weaponDps.toLocaleString(undefined, { maximumFractionDigits: 0 })} | Skills: ${stats.skillDps.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        color="text-orange-400"
                    />
                    <StatRow
                        icon={<TrendingUp className="w-4 h-4" />}
                        label="Healing/sec"
                        value={effectiveHps.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={lifestealHps > 0 ? `Regen: ${regenHps.toFixed(0)} | Lifesteal: ${lifestealHps.toFixed(0)} | Skills: ${skillHps.toFixed(0)}` : `Regen: ${regenHps.toFixed(0)} | Skills: ${skillHps.toFixed(0)}`}
                        color="text-emerald-400"
                    />
                </CollapsibleSection>



                {/* Passive Stats */}
                <CollapsibleSection
                    title="Passive Stats"
                    icon={<Sparkles className="w-4 h-4 text-yellow-400" />}
                >
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
                        <StatRow
                            icon={<Star className="w-4 h-4" />}
                            label={getStatName('CriticalChance')}
                            value={formatPercent(stats.criticalChance)}
                            count={stats.statCounts?.['CriticalChance']}
                            color="text-yellow-400"
                        />
                        <StatRow
                            icon={<TrendingUp className="w-4 h-4" />}
                            label={getStatName('CriticalMulti')}
                            value={`${stats.criticalDamage.toFixed(2)}x`}
                            count={stats.statCounts?.['CriticalMulti']}
                            color="text-yellow-500"
                        />
                        <StatRow
                            icon={<Shield className="w-4 h-4" />}
                            label={getStatName('BlockChance')}
                            value={formatPercent(stats.blockChance)}
                            count={stats.statCounts?.['BlockChance']}
                            color="text-blue-400"
                        />
                        <StatRow
                            icon={<Zap className="w-4 h-4" />}
                            label={getStatName('DoubleDamageChance')}
                            value={formatPercent(stats.doubleDamageChance)}
                            count={stats.statCounts?.['DoubleDamageChance']}
                            color="text-purple-400"
                        />
                        <StatRow
                            icon={<Swords className="w-4 h-4 text-text-primary" />}
                            label="Damage"
                            value={formatCompactNumber(stats.totalDamage)}
                            color="text-red-400"
                        />
                        <StatRow
                            icon={<Heart className="w-4 h-4 text-text-primary" />}
                            label="Health"
                            value={formatCompactNumber(stats.totalHealth)}
                            color="text-green-400"
                        />
                        <StatRow
                            icon={<TrendingUp className="w-4 h-4 text-text-primary" />}
                            label="DPS"
                            value={formatCompactNumber(effectiveDps)}
                            color="text-orange-400"
                        />
                        <StatRow
                            icon={<Heart className="w-4 h-4 text-text-primary" />}
                            label="Total HPS"
                            value={formatCompactNumber(effectiveHps)}
                            color="text-emerald-400"
                        />
                        <StatRow
                            icon={<Gauge className="w-4 h-4" />}
                            label={getStatName('AttackSpeed')}
                            value={formatMultiplier(stats.attackSpeedMultiplier)}
                            count={stats.statCounts?.['AttackSpeed']}
                            color="text-cyan-400"
                        />
                        <StatRow
                            icon={<Heart className="w-4 h-4" />}
                            label={getStatName('LifeSteal')}
                            value={formatPercent(stats.lifeSteal)}
                            count={stats.statCounts?.['LifeSteal']}
                            color="text-red-400"
                        />
                        <StatRow
                            icon={<TrendingUp className="w-4 h-4" />}
                            label={getStatName('HealthRegen')}
                            value={formatPercent(stats.healthRegen)}
                            count={stats.statCounts?.['HealthRegen']}
                            color="text-emerald-400"
                        />
                        <StatRow
                            icon={<Clock className="w-4 h-4" />}
                            label={getStatName('SkillCooldownMulti')}
                            value={`-${formatPercent(stats.skillCooldownReduction)}`}
                            count={stats.statCounts?.['SkillCooldownMulti']}
                            color="text-indigo-400"
                        />
                        <StatRow
                            icon={<Swords className="w-4 h-4" />}
                            label={getStatName('SkillDamageMulti')}
                            value={formatMultiplier(stats.skillDamageMultiplier)}
                            count={stats.statCounts?.['SkillDamageMulti']}
                            color="text-blue-400"
                        />
                        <StatRow
                            icon={<Swords className="w-4 h-4" />}
                            label={getStatName('MeleeDamageMulti')}
                            value={formatPercent(stats.meleeDamageMultiplier)}
                            count={stats.statCounts?.['MeleeDamageMulti']}
                            color="text-amber-400"
                        />
                        <StatRow
                            icon={<Crosshair className="w-4 h-4" />}
                            label={getStatName('RangedDamageMulti')}
                            value={formatPercent(stats.rangedDamageMultiplier)}
                            count={stats.statCounts?.['RangedDamageMulti']}
                            color="text-sky-400"
                        />
                        <StatRow
                            icon={<Swords className="w-4 h-4" />}
                            label={getStatName('DamageMulti')}
                            value={formatPercent(stats.secondaryDamageMulti)}
                            count={stats.statCounts?.['DamageMulti']}
                            color="text-red-400"
                        />
                        <StatRow
                            icon={<Heart className="w-4 h-4" />}
                            label={getStatName('HealthMulti')}
                            value={formatPercent(stats.secondaryHealthMulti)}
                            count={stats.statCounts?.['HealthMulti']}
                            color="text-green-400"
                        />
                    </div>
                    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-2">
                        <CompactStat
                            icon={<TrendingUp className="w-3 h-3" />}
                            label="EXP"
                            value={formatMultiplier(stats.experienceMultiplier)}
                            color="text-violet-400"
                        />
                        <CompactStat
                            icon={<Coins className="w-3 h-3" />}
                            label="Sell"
                            value={formatMultiplier(stats.sellPriceMultiplier)}
                            color="text-amber-400"
                        />
                        <CompactStat
                            icon={<Star className="w-3 h-3" />}
                            label="Forge"
                            value={formatPercent(stats.forgeFreebieChance)}
                            color="text-pink-400"
                        />
                        <CompactStat
                            icon={<Star className="w-3 h-3" />}
                            label="Egg"
                            value={formatPercent(stats.eggFreebieChance)}
                            color="text-amber-400"
                        />
                        <CompactStat
                            icon={<Star className="w-3 h-3" />}
                            label="Mount"
                            value={formatPercent(stats.mountFreebieChance)}
                            color="text-cyan-400"
                        />
                    </div>
                </CollapsibleSection>



                {/* Weapon Stats */}
                <CollapsibleSection
                    title="Weapon Stats"
                    icon={<Crosshair className="w-4 h-4 text-amber-400" />}
                >
                    <div className="p-3 bg-bg-input/30 rounded-lg border border-border/30 mb-2">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Type</span>
                            <span className={cn(
                                "font-bold px-2 py-0.5 rounded text-xs",
                                stats.isRangedWeapon ? "bg-sky-500/20 text-sky-400" : "bg-amber-500/20 text-amber-400"
                            )}>
                                {stats.isRangedWeapon ? '🏹 RANGED' : '⚔️ MELEE'}
                            </span>
                        </div>
                    </div>
                    <StatRow
                        icon={<Target className="w-4 h-4" />}
                        label="Attack Range"
                        value={`${stats.weaponAttackRange.toFixed(1)}m`}
                        color="text-cyan-400"
                    />
                    <StatRow
                        icon={<Clock className="w-4 h-4" />}
                        label="Windup Time"
                        value={`${stats.weaponWindupTime.toFixed(2)}s`}
                        color="text-amber-400"
                    />
                    {stats.hasProjectile && (
                        <>
                            <StatRow
                                icon={<Zap className="w-4 h-4" />}
                                label="Projectile Speed"
                                value={`${stats.projectileSpeed.toFixed(1)} m/s`}
                                color="text-sky-400"
                            />
                            <StatRow
                                icon={<Target className="w-4 h-4" />}
                                label="Projectile Radius"
                                value={`${stats.projectileRadius.toFixed(2)}m`}
                                color="text-sky-400"
                            />
                        </>
                    )}
                </CollapsibleSection>

                {/* Tree Bonuses */}
                <CollapsibleSection
                    title="Tree Bonuses"
                    icon={<TreeDeciduous className="w-4 h-4 text-green-400" />}
                >
                    {treeBonusEntries.length > 0 ? (
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
                            {treeBonusEntries.map(([key, value]) => (
                                <div key={key} className="flex flex-col justify-between p-2 bg-bg-input/30 rounded-lg border border-border/30 min-h-[3.5rem]">
                                    <div className="text-xs text-text-muted break-words leading-tight" title={key}>{key}</div>
                                    <div className="font-mono font-bold text-green-400 text-right mt-1">
                                        +{(value * 100).toFixed(1)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-text-muted text-sm py-4">
                            No tree bonuses active
                        </div>
                    )}
                </CollapsibleSection>
            </div>
        </Card>
    );
}
