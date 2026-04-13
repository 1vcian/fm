import { useMemo, useState } from 'react';
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
import { calculateStats, LibraryData, AggregatedStats } from '../../utils/statEngine';
import { useTreeMode } from '../../context/TreeModeContext';
import { UserProfile } from '../../types/Profile';
import { DpsBreakdownModal } from './DpsBreakdownModal';

interface StatRowProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subValue?: string;
    count?: number;
    color?: string;
    onInfoPointsClick?: () => void;
}

function StatRow({ icon, label, value, subValue, count, color = 'text-accent-primary', onInfoPointsClick }: StatRowProps) {
    return (
        <div className="flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[5rem]">
            <div className="flex items-center gap-2 w-full">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="text-sm font-medium text-text-primary leading-tight break-words">{label}</div>
                        {onInfoPointsClick && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onInfoPointsClick();
                                }}
                                className="px-2 py-0.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-md transition-all text-orange-400 hover:text-orange-300 flex items-center gap-1 group shadow-[0_0_10px_rgba(249,115,22,0.1)] active:scale-95 ml-auto"
                                title="Show Detailed Breakdown"
                            >
                                <Sparkles className="w-3 h-3 animate-pulse text-orange-400 group-hover:text-orange-300" />
                                <span className="text-[9px] font-bold uppercase tracking-wider">Details</span>
                            </button>
                        )}
                    </div>
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
    onOriginalDetailsClick?: () => void;
    onTestDetailsClick?: () => void;
}

function ComparisonStatRow({
    icon,
    label,
    originalValue,
    testValue,
    formatFn = (val) => val.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    color = 'text-accent-primary',
    originalDetails,
    testDetails,
    onOriginalDetailsClick,
    onTestDetailsClick
}: ComparisonStatRowProps) {
    const delta = formatDelta(originalValue, testValue);
    const isExactlySame = originalValue === testValue;
    const testIsHigher = testValue > originalValue;
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
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <div className="text-xs text-text-muted">Equipped</div>
                        {onOriginalDetailsClick && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onOriginalDetailsClick();
                                }}
                                className="p-1 px-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded transition-all text-orange-400 hover:text-orange-300 flex items-center gap-1 group active:scale-95"
                                title="Show Detailed Breakdown (Equipped)"
                            >
                                <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                                <span className="text-[8px] font-bold uppercase tracking-wider">Details</span>
                            </button>
                        )}
                    </div>
                    <div className={cn("font-mono font-bold text-base", !isExactlySame && !testIsHigher && color)}>
                        {formatFn(originalValue)}
                    </div>
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
                    <div className="flex items-center justify-center gap-2 mb-1">
                        <div className="text-xs text-text-muted">Test Build</div>
                        {onTestDetailsClick && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTestDetailsClick();
                                }}
                                className="p-1 px-1.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded transition-all text-orange-400 hover:text-orange-300 flex items-center gap-1 group active:scale-95"
                                title="Show Detailed Breakdown (Test Build)"
                            >
                                <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                                <span className="text-[8px] font-bold uppercase tracking-wider">Details</span>
                            </button>
                        )}
                    </div>
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
    const [showDpsModal, setShowDpsModal] = useState(false);
    const [modalData, setModalData] = useState<{ stats: AggregatedStats; profile: UserProfile } | null>(null);
    const stats = useGlobalStats();
    const techModifiers = useTreeModifiers();
    const {
        isComparing,
        originalItems,
        testItems,
        originalMount,
        testMount,
        originalMountAscension,
        testMountAscension,
        originalForgeAscension,
        testForgeAscension
    } = useComparison();
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
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

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
        skinsLibrary,
        setsLibrary,
        ascensionConfigsLibrary,
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
        skinsLibrary, setsLibrary, ascensionConfigsLibrary
    ]);

    // Calculate stats and profiles for original and test items when comparing
    const { originalStats, testStats, originalProfile, testProfile } = useMemo(() => {
        if (!isComparing || !originalItems || !testItems || !itemBalancingConfig || !itemBalancingLibrary) {
            return { originalStats: null, testStats: null, originalProfile: null, testProfile: null };
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
            mount: { ...profile.mount, active: originalMount },
            misc: {
                ...profile.misc,
                forgeAscensionLevel: originalForgeAscension ?? profile.misc.forgeAscensionLevel,
                mountAscensionLevel: originalMountAscension ?? profile.misc.mountAscensionLevel
            }
        };
        const testProfile = {
            ...profile,
            items: testItems,
            techTree: effectiveTechTree,
            mount: { ...profile.mount, active: testMount },
            misc: {
                ...profile.misc,
                forgeAscensionLevel: testForgeAscension ?? profile.misc.forgeAscensionLevel,
                mountAscensionLevel: testMountAscension ?? profile.misc.mountAscensionLevel
            }
        };

        const origStats = calculateStats(originalProfile, libs);
        const testStats = calculateStats(testProfile, libs);

        return { originalStats: origStats, testStats: testStats, originalProfile, testProfile };
    }, [
        isComparing, originalItems, testItems, itemBalancingConfig, itemBalancingLibrary,
        profile, originalMount, testMount, originalForgeAscension, originalMountAscension,
        testForgeAscension, testMountAscension, treeMode, techTreePositionLibrary, techTreeLibrary, libs
    ]);

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
    }    // DPS values are now pre-calculated in StatEngine.ts to ensure 100% synchronization
    const weaponDps = stats.weaponDps;
    const effectiveDps = stats.averageTotalDps;

    // Healing Per Second calculations
    // 1. Passive Health Regen: MaxHP × HealthRegen% per second
    const regenHps = stats.totalHealth * stats.healthRegen;
    // 2. Lifesteal: Weapon DPS × Lifesteal% (healing from basic attacks)
    const lifestealHps = weaponDps * stats.lifeSteal;
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
        const aps = 1 / (s.weaponAttackDuration / s.attackSpeedMultiplier);
        const weapon = s.totalDamage * aps * critMult * doubleMult;

        // Use pre-calculated real-time values from StatEngine
        const realWeapon = s.realWeaponDps;

        const skills = s.skillDps + (s.skillBuffDps || 0);
        return {
            total: weapon + skills,
            weapon,
            skills,
            realTotal: realWeapon + skills,
            realWeapon
        };
    };

    // Helper to calculate HPS from stats with breakdown
    const calculateHpsDetails = (s: typeof stats, dps: number) => {
        const regen = s.totalHealth * s.healthRegen;
        const lifesteal = dps * s.lifeSteal;
        const skills = s.skillHps;
        return { total: regen + lifesteal + skills, regen, lifesteal, skills };
    };

    // Calculate DPS/HPS for comparison stats with details
    const originalDpsDetails = originalStats ? calculateDpsDetails(originalStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const testDpsDetails = testStats ? calculateDpsDetails(testStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const originalHpsDetails = originalStats ? calculateHpsDetails(originalStats, originalDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const testHpsDetails = testStats ? calculateHpsDetails(testStats, testDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };

    // Legacy aliases for backwards compatibility
    const originalDps = originalDpsDetails.total;
    const testDps = testDpsDetails.total;
    const originalHps = originalHpsDetails.total;
    const testHps = testHpsDetails.total;

    // Show comparison view when comparing
    const mainContent = (isComparing && originalStats && testStats) ? (
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
                    label="Theoretical DPS"
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
                    onOriginalDetailsClick={() => {
                        if (originalStats && originalProfile) {
                            setModalData({ stats: originalStats, profile: originalProfile });
                            setShowDpsModal(true);
                        }
                    }}
                    onTestDetailsClick={() => {
                        if (testStats && testProfile) {
                            setModalData({ stats: testStats, profile: testProfile });
                            setShowDpsModal(true);
                        }
                    }}
                />
                <ComparisonStatRow
                    icon={<Zap className="w-4 h-4" />}
                    label="Real-Time DPS"
                    originalValue={originalDpsDetails.realTotal}
                    testValue={testDpsDetails.realTotal}
                    color="text-orange-500"
                    originalDetails={[
                        { label: 'Weapon', value: originalDpsDetails.realWeapon },
                        { label: 'Skills', value: originalDpsDetails.skills }
                    ]}
                    testDetails={[
                        { label: 'Weapon', value: testDpsDetails.realWeapon },
                        { label: 'Skills', value: testDpsDetails.skills }
                    ]}
                    onOriginalDetailsClick={() => {
                        if (originalStats && originalProfile) {
                            setModalData({ stats: originalStats, profile: originalProfile });
                            setShowDpsModal(true);
                        }
                    }}
                    onTestDetailsClick={() => {
                        if (testStats && testProfile) {
                            setModalData({ stats: testStats, profile: testProfile });
                            setShowDpsModal(true);
                        }
                    }}
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
    ) : (
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
                        subValue={`${formatMultiplier(stats.damageMultiplier)} ${stats.isRangedWeapon ? `(Ranged: ${formatPercent(stats.rangedDamageMultiplier)})` : `(Melee: ${formatPercent(stats.meleeDamageMultiplier)})`} (Sub: ${formatPercent(stats.damageBreakdown.substats, 1)}, Asc: x${(stats.damageBreakdown.ascension + 1).toFixed(1)} [${formatPercent(stats.damageBreakdown.ascension, 0)}])`}
                        color="text-red-400"
                    />
                    <StatRow
                        icon={<Heart className="w-4 h-4" />}
                        label="Total Health"
                        value={stats.totalHealth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={`${formatMultiplier(stats.healthMultiplier)} (Sub: ${formatPercent(stats.healthBreakdown.substats, 1)}, Asc: x${(stats.healthBreakdown.ascension + 1).toFixed(1)} [${formatPercent(stats.healthBreakdown.ascension, 0)}])`}
                        color="text-green-400"
                    />
                    <StatRow
                        icon={<Zap className="w-4 h-4" />}
                        label="Effective DPS"
                        value={effectiveDps.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={`Theoretical (Linear Scaling)`}
                        color="text-orange-400"
                        onInfoPointsClick={() => setShowDpsModal(true)}
                    />
                    <StatRow
                        icon={<Zap className="w-4 h-4" />}
                        label="Real-Time DPS"
                        value={stats.realTotalDps.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        subValue={`Stepped (Breakpoints & Frame Rounding)`}
                        color="text-orange-500"
                        onInfoPointsClick={() => setShowDpsModal(true)}
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
                            onInfoPointsClick={() => setShowDpsModal(true)}
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
                            subValue={`Sub: ${formatPercent(stats.skillDamageBreakdown.substats, 1)}, Tree: ${formatPercent(stats.skillDamageBreakdown.tree, 1)}, Asc: x${(stats.skillDamageBreakdown.ascension + 1).toFixed(1)} [${formatPercent(stats.skillDamageBreakdown.ascension, 0)}]`}
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
                            subValue={`Sub: ${formatPercent(stats.damageBreakdown.substats, 1)}, Asc: x${(stats.damageBreakdown.ascension + 1).toFixed(1)} [${formatPercent(stats.damageBreakdown.ascension, 0)}]`}
                            count={stats.statCounts?.['DamageMulti']}
                            color="text-red-400"
                        />
                        <StatRow
                            icon={<Heart className="w-4 h-4" />}
                            label={getStatName('HealthMulti')}
                            value={formatPercent(stats.secondaryHealthMulti)}
                            subValue={`Sub: ${formatPercent(stats.healthBreakdown.substats, 1)}, Asc: x${(stats.healthBreakdown.ascension + 1).toFixed(1)} [${formatPercent(stats.healthBreakdown.ascension, 0)}]`}
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
                                <span>APS (1 / {(stats.weaponAttackDuration / stats.attackSpeedMultiplier).toFixed(2)}s)</span>
                                <span className="text-text-primary">{(1 / (stats.weaponAttackDuration / stats.attackSpeedMultiplier)).toFixed(2)}/s</span>
                            </div>

                            {(() => {
                                const critMultiplier = 1 + Math.min(stats.criticalChance, 1) * (stats.criticalDamage - 1);
                                const doubleDmgMultiplier = 1 + Math.min(stats.doubleDamageChance, 1);
                                return (
                                    <>
                                        <div className="flex justify-between">
                                            <span>Crit Avg (1 + {formatPercent(Math.min(stats.criticalChance, 1))} × {(stats.criticalDamage - 1).toFixed(2)})</span>
                                            <span className="text-text-primary">{critMultiplier.toFixed(2)}x</span>
                                        </div>

                                        <div className="flex justify-between">
                                            <span>Double Dmg (1 + {formatPercent(Math.min(stats.doubleDamageChance, 1))})</span>
                                            <span className="text-text-primary">{doubleDmgMultiplier.toFixed(2)}x</span>
                                        </div>
                                    </>
                                );
                            })()}

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

    return (
        <>
            {mainContent}
            <DpsBreakdownModal
                isOpen={showDpsModal}
                onClose={() => {
                    setShowDpsModal(false);
                    setModalData(null);
                }}
                stats={modalData?.stats || stats}
                profile={modalData?.profile || profile}
                skillLibrary={libs.skillLibrary}
            />
        </>
    );
}
