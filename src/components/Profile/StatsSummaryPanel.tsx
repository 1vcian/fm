import { useMemo } from 'react';
import {
    Swords, Heart, Shield, Zap, Target, Gauge,
    TrendingUp, Clock, Coins, Star, Crosshair, TreeDeciduous, Sparkles,
    ArrowUp, ArrowDown
} from 'lucide-react';
import { AnimatedClock } from '../UI/AnimatedClock';
import { Card } from '../UI/Card';
import { cn } from '../../lib/utils';
import { formatPercent, formatMultiplier, formatCompactNumber } from '../../utils/statsCalculator';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { getStatName } from '../../utils/statNames';
import { useComparison } from '../../context/ComparisonContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { calculateStats, LibraryData } from '../../utils/statEngine';
import { useTreeMode } from '../../context/TreeModeContext';

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
        <div className="flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[5rem]">
            <div className="flex items-center gap-2 w-full">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary leading-tight break-words">{label}</div>
                    {count !== undefined && count > 0 && (
                        <div className="text-[11px] text-text-muted">({count} Stats)</div>
                    )}
                </div>
            </div>
            <div className="mt-2 w-full text-right">
                <div className={cn("font-mono font-bold text-base", color)}>
                    {value}
                </div>
                {subValue && <div className="text-xs text-text-muted leading-tight break-words">{subValue}</div>}
            </div>
        </div>
    );
}

// Compact stat for grid layouts
function CompactStat({ icon, label, value, color = 'text-accent-primary' }: Omit<StatRowProps, 'subValue'>) {
    return (
        <div className="flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[4.5rem]">
            <div className="flex items-center gap-1.5 mb-1">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center", color)}>
                    {icon}
                </div>
                <span className="text-sm text-text-muted break-words leading-tight">{label}</span>
            </div>
            <div className={cn("font-mono font-bold text-base text-right mt-auto", color)}>
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

// Format delta for comparison display
function formatDelta(original: number, comparison: number): { text: string; isPositive: boolean; percent: string } {
    const delta = comparison - original;
    const percent = original !== 0 ? ((delta / original) * 100) : (delta !== 0 ? 100 : 0);
    const isPositive = delta >= 0;
    const sign = isPositive ? '+' : '';
    return {
        text: `${sign}${delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        isPositive,
        percent: `${sign}${percent.toFixed(1)}%`
    };
}

interface ComparisonStatRowProps {
    icon: React.ReactNode;
    label: string;
    originalValue: number;
    testValue: number;
    formatFn?: (val: number) => string;
    color?: string;
    originalDetails?: { label: string; value: number }[];
    testDetails?: { label: string; value: number }[];
}

function ComparisonStatRow({
    icon,
    label,
    originalValue,
    testValue,
    formatFn = (val) => val.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    color = 'text-accent-primary',
    originalDetails,
    testDetails
}: ComparisonStatRowProps) {
    const delta = formatDelta(originalValue, testValue);
    const isExactlySame = originalValue === testValue;
    const testIsHigher = testValue > originalValue;
    const hasDetails = (originalDetails && originalDetails.length > 0) || (testDetails && testDetails.length > 0);

    // Calculate deltas for details
    const detailDeltas = originalDetails?.map((orig, i) => {
        const test = testDetails?.[i];
        if (!test) return null;
        return formatDelta(orig.value, test.value);
    });

    // Determine delta color and icon
    const getDeltaStyle = () => {
        if (isExactlySame) return { color: "text-text-muted", icon: <span className="text-sm">=</span> };
        if (delta.isPositive) return { color: "text-green-400", icon: <ArrowUp className="w-3.5 h-3.5" /> };
        return { color: "text-red-400", icon: <ArrowDown className="w-3.5 h-3.5" /> };
    };
    const deltaStyle = getDeltaStyle();

    return (
        <div className="flex flex-col p-3 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors">
            <div className="flex items-center gap-2 mb-3">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <span className="text-sm font-medium text-text-primary">{label}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
                {/* Equipped Column */}
                <div className="text-center">
                    <div className="text-xs text-text-muted mb-1">Equipped</div>
                    <div className={cn("font-mono font-bold text-base", !isExactlySame && !testIsHigher && color)}>
                        {formatFn(originalValue)}
                    </div>
                    {/* Spacer to align with Test column's delta area */}
                    {hasDetails && <div className="h-[42px]" />}
                    {originalDetails && originalDetails.length > 0 && (
                        <div className="mt-2 text-[10px] text-text-muted space-y-0.5">
                            {originalDetails.map((d, i) => (
                                <div key={i}>{d.label}: {d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            ))}
                        </div>
                    )}
                </div>
                {/* Test Column with Delta */}
                <div className="text-center">
                    <div className="text-xs text-text-muted mb-1">Test Build</div>
                    <div className={cn("font-mono font-bold text-base", !isExactlySame && testIsHigher && color)}>
                        {formatFn(testValue)}
                    </div>
                    {/* Delta inside Test column */}
                    <div className={cn("mt-1 flex flex-col items-center", deltaStyle.color)}>
                        <div className="flex items-center gap-0.5 font-mono font-bold text-sm">
                            {deltaStyle.icon}
                            <span>{delta.percent}</span>
                        </div>
                        <div className="text-[11px] opacity-70 font-mono">
                            {delta.text}
                        </div>
                    </div>
                    {testDetails && testDetails.length > 0 && (
                        <div className="mt-2 text-[10px] text-text-muted space-y-0.5">
                            {testDetails.map((d, i) => {
                                const detailDelta = detailDeltas?.[i];
                                const detailIsZero = detailDelta && originalDetails?.[i]?.value === testDetails[i]?.value;
                                return (
                                    <div key={i} className="flex items-center justify-center gap-1 flex-wrap">
                                        <span>{d.label}: {d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        {detailDelta && !detailIsZero && (
                                            <span className={cn(
                                                "font-mono",
                                                detailDelta.isPositive ? "text-green-600" : "text-red-600"
                                            )}>
                                                ({detailDelta.percent} | {detailDelta.text})
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function StatsSummaryPanel() {
    const stats = useGlobalStats();
    const techModifiers = useTreeModifiers();
    const { isComparing, originalItems, testItems, originalMount, testMount } = useComparison();
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();

    // Load all libraries for comparison calculations
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');

    const libs: LibraryData = useMemo(() => ({
        petUpgradeLibrary,
        petBalancingLibrary,
        petLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
    ]);

    // Calculate stats for original and test items when comparing
    const { originalStats, testStats } = useMemo(() => {
        if (!isComparing || !originalItems || !testItems || !itemBalancingConfig || !itemBalancingLibrary) {
            return { originalStats: null, testStats: null };
        }

        // Build effective tech tree based on tree mode
        let effectiveTechTree = profile.techTree;
        if (treeMode === 'empty') {
            effectiveTechTree = { Forge: {}, Power: {}, SkillsPetTech: {} };
        } else if (treeMode === 'max' && techTreePositionLibrary && techTreeLibrary) {
            const maxTree: typeof profile.techTree = { Forge: {}, Power: {}, SkillsPetTech: {} };
            const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];
            for (const tree of trees) {
                const treeData = techTreePositionLibrary[tree];
                if (treeData?.Nodes) {
                    for (const node of treeData.Nodes) {
                        const nodeData = techTreeLibrary[node.Type];
                        const maxLevel = nodeData?.MaxLevel || 5;
                        maxTree[tree][node.Id] = maxLevel;
                    }
                }
            }
            effectiveTechTree = maxTree;
        }

        const originalProfile = {
            ...profile,
            items: originalItems,
            techTree: effectiveTechTree,
            mount: { ...profile.mount, active: originalMount }
        };
        const testProfile = {
            ...profile,
            items: testItems,
            techTree: effectiveTechTree,
            mount: { ...profile.mount, active: testMount }
        };

        const origStats = calculateStats(originalProfile, libs);
        const tstStats = calculateStats(testProfile, libs);

        return { originalStats: origStats, testStats: tstStats };
    }, [isComparing, originalItems, testItems, originalMount, testMount, profile, libs, itemBalancingConfig, itemBalancingLibrary, treeMode, techTreePositionLibrary, techTreeLibrary]);

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
    // User Requirement: Caps at 100% (1.0)
    const cappedCritChance = Math.min(stats.criticalChance, 1);
    const cappedDoubleDamageChance = Math.min(stats.doubleDamageChance, 1);

    const critMultiplier = 1 + cappedCritChance * (stats.criticalDamage - 1);
    const doubleDmgMultiplier = 1 + cappedDoubleDamageChance;
    const modifiedAttackDuration = (stats.weaponAttackDuration) / stats.attackSpeedMultiplier;

    // Tempo totale per attacco
    const totalAttackTime = modifiedAttackDuration;

    // Attacchi al secondo
    const attacksPerSecond = 1 / totalAttackTime;

    // DPS finale
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

    // Helper to calculate DPS from stats with breakdown
    const calculateDpsDetails = (s: typeof stats) => {
        const cappedCrit = Math.min(s.criticalChance, 1);
        const cappedDouble = Math.min(s.doubleDamageChance, 1);
        const critMult = 1 + cappedCrit * (s.criticalDamage - 1);
        const doubleMult = 1 + cappedDouble;
        const attackDuration = s.weaponAttackDuration / s.attackSpeedMultiplier;
        const aps = 1 / attackDuration;
        const weapon = s.totalDamage * aps * critMult * doubleMult;
        const skills = s.skillDps;
        return { total: weapon + skills, weapon, skills };
    };

    // Helper to calculate HPS from stats with breakdown
    const calculateHpsDetails = (s: typeof stats, dps: number) => {
        const regen = s.totalHealth * s.healthRegen;
        const lifesteal = dps * s.lifeSteal;
        const skills = s.skillHps;
        return { total: regen + lifesteal + skills, regen, lifesteal, skills };
    };

    // Calculate DPS/HPS for comparison stats with details
    const originalDpsDetails = originalStats ? calculateDpsDetails(originalStats) : { total: 0, weapon: 0, skills: 0 };
    const testDpsDetails = testStats ? calculateDpsDetails(testStats) : { total: 0, weapon: 0, skills: 0 };
    const originalHpsDetails = originalStats ? calculateHpsDetails(originalStats, originalDpsDetails.total) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const testHpsDetails = testStats ? calculateHpsDetails(testStats, testDpsDetails.total) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };

    // Legacy aliases for backwards compatibility
    const originalDps = originalDpsDetails.total;
    const testDps = testDpsDetails.total;
    const originalHps = originalHpsDetails.total;
    const testHps = testHpsDetails.total;

    // Show comparison view when comparing
    if (isComparing && originalStats && testStats) {
        return (
            <Card className="p-6">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <AnimatedClock className="w-8 h-8" />
                    Stats Comparison
                </h2>

                <div className="space-y-3">
                    <ComparisonStatRow
                        icon={<Gauge className="w-4 h-4" />}
                        label="Power"
                        originalValue={originalStats.power}
                        testValue={testStats.power}
                        color="text-purple-400"
                    />
                    <ComparisonStatRow
                        icon={<Swords className="w-4 h-4" />}
                        label="Damage"
                        originalValue={originalStats.totalDamage}
                        testValue={testStats.totalDamage}
                        color="text-red-400"
                    />
                    <ComparisonStatRow
                        icon={<Heart className="w-4 h-4" />}
                        label="Health"
                        originalValue={originalStats.totalHealth}
                        testValue={testStats.totalHealth}
                        color="text-green-400"
                    />
                    <ComparisonStatRow
                        icon={<Zap className="w-4 h-4" />}
                        label="DPS"
                        originalValue={originalDps}
                        testValue={testDps}
                        color="text-orange-400"
                        originalDetails={[
                            { label: 'Weapon', value: originalDpsDetails.weapon },
                            { label: 'Skills', value: originalDpsDetails.skills }
                        ]}
                        testDetails={[
                            { label: 'Weapon', value: testDpsDetails.weapon },
                            { label: 'Skills', value: testDpsDetails.skills }
                        ]}
                    />
                    <ComparisonStatRow
                        icon={<TrendingUp className="w-4 h-4" />}
                        label="HPS"
                        originalValue={originalHps}
                        testValue={testHps}
                        color="text-emerald-400"
                        originalDetails={[
                            { label: 'Regen', value: originalHpsDetails.regen },
                            { label: 'Lifesteal', value: originalHpsDetails.lifesteal },
                            { label: 'Skills', value: originalHpsDetails.skills }
                        ]}
                        testDetails={[
                            { label: 'Regen', value: testHpsDetails.regen },
                            { label: 'Lifesteal', value: testHpsDetails.lifesteal },
                            { label: 'Skills', value: testHpsDetails.skills }
                        ]}
                    />
                </div>
            </Card>
        );
    }

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
                {/* DPS Breakdown */}
                <CollapsibleSection
                    title="DPS Calculation"
                    icon={<Target className="w-4 h-4 text-pink-400" />}
                >
                    <div className="p-3 bg-bg-input/30 rounded-lg border border-border/30 space-y-3 font-mono text-xs text-text-muted">
                        <div className="flex flex-col gap-1">
                            <span className="font-bold text-text-primary mb-1 border-b border-border/30 pb-1">Weapon DPS Formula</span>
                            <div className="text-[10px] text-text-tertiary">
                                DPS = Damage × APS × CritMult × DoubleMult
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <span>Base Damage</span>
                                <span className="text-text-primary">{formatCompactNumber(stats.totalDamage)}</span>
                            </div>

                            <div className="flex justify-between">
                                <span>APS (1 / {totalAttackTime.toFixed(2)}s)</span>
                                <span className="text-text-primary">{attacksPerSecond.toFixed(2)}/s</span>
                            </div>

                            <div className="flex justify-between">
                                <span>Crit Avg (1 + {formatPercent(Math.min(stats.criticalChance, 1))} × {(stats.criticalDamage - 1).toFixed(2)})</span>
                                <span className="text-text-primary">{critMultiplier.toFixed(2)}x</span>
                            </div>

                            <div className="flex justify-between">
                                <span>Double Dmg (1 + {formatPercent(Math.min(stats.doubleDamageChance, 1))})</span>
                                <span className="text-text-primary">{doubleDmgMultiplier.toFixed(2)}x</span>
                            </div>

                            <div className="border-t border-border/30 pt-2 flex justify-between font-bold">
                                <span className="text-accent-primary">Weapon DPS</span>
                                <span className="text-accent-primary">{formatCompactNumber(weaponDps)}</span>
                            </div>
                        </div>
                    </div>
                </CollapsibleSection>

            </div>
        </Card>
    );
}
