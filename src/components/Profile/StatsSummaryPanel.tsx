import React, { useMemo, useState } from 'react';
import {
    Swords, Heart, Shield, Zap, Target, Gauge,
    TrendingUp, Clock, Coins, Star, Crosshair, TreeDeciduous, Sparkles,
    ArrowUp, ArrowDown, X, Check, ArrowRight, Hash, Minimize2, Layout
} from 'lucide-react';
import { Button } from '../UI/Button';
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
    isOpen: boolean;
    onToggle: () => void;
}

function CollapsibleSection({ title, icon, children, isOpen, onToggle }: CollapsibleSectionProps) {
    return (
        <div className="group">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 cursor-pointer select-none p-2 -mx-2 rounded-lg hover:bg-bg-input/30 transition-colors"
            >
                <span className={cn("text-text-muted transition-transform", isOpen && "rotate-90")}>▶</span>
                {icon}
                <span className="text-xs font-bold uppercase text-text-muted">{title}</span>
            </button>
            {isOpen && (
                <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                    {children}
                </div>
            )}
        </div>
    );
}

// Format delta for comparison display
function formatDelta(original: number, comparison: number, isCompact: boolean): { text: string; isPositive: boolean; percent: string } {
    const delta = comparison - original;
    const percent = original !== 0 ? ((delta / original) * 100) : (delta !== 0 ? 100 : 0);
    const isPositive = delta >= 0;
    const sign = isPositive ? '+' : '';

    const formattedDelta = isCompact
        ? formatCompactNumber(Math.abs(delta))
        : Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 0 });

    return {
        text: `${sign}${formattedDelta}`,
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
    variant?: 'default' | 'minimal';
    isCompact?: boolean;
    className?: string;
}

function ComparisonStatRow({
    icon,
    label,
    originalValue,
    testValue,
    formatFn,
    color = 'text-accent-primary',
    originalDetails,
    testDetails,
    onOriginalDetailsClick,
    onTestDetailsClick,
    variant = 'default',
    isCompact = true
}: ComparisonStatRowProps) {
    const isMinimal = variant === 'minimal';

    const defaultFormat = (val: number) => isCompact
        ? formatCompactNumber(val)
        : val.toLocaleString(undefined, { maximumFractionDigits: 0 });

    const finalFormat = formatFn || defaultFormat;

    const delta = formatDelta(originalValue, testValue, isCompact);
    const isExactlySame = originalValue === testValue;
    const testIsHigher = testValue > originalValue;
    // Calculate deltas for details
    const detailDeltas = originalDetails?.map((orig, i) => {
        const test = testDetails?.[i];
        if (!test) return null;
        return formatDelta(orig.value, test.value, isCompact);
    });

    // Determine delta color and icon
    const getDeltaStyle = () => {
        if (isExactlySame) return { color: "text-text-muted", icon: <span className="text-sm">=</span> };
        if (delta.isPositive) return { color: "text-green-400", icon: <ArrowUp className="w-3.5 h-3.5" /> };
        return { color: "text-red-400", icon: <ArrowDown className="w-3.5 h-3.5" /> };
    };
    const deltaStyle = getDeltaStyle();

    if (isMinimal) {
        return (
            <div className="flex items-center gap-3 p-1.5 px-2 bg-bg-input/20 rounded-lg border border-border/20 hover:bg-bg-input/40 transition-colors">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {React.cloneElement(icon as React.ReactElement, { className: 'w-3 h-3' })}
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted leading-tight">{label}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono text-text-muted">{finalFormat(originalValue)}</span>
                            <span className="text-[10px] text-text-muted/50">→</span>
                            <span className={cn("text-[11px] font-mono font-bold", !isExactlySame && testIsHigher ? color : (testIsHigher ? color : 'text-text-primary'))}>
                                {finalFormat(testValue)}
                            </span>
                        </div>
                        <div className={cn("flex items-center gap-0.5 font-mono font-bold text-[10px]", deltaStyle.color)}>
                            {deltaStyle.icon && React.cloneElement(deltaStyle.icon as React.ReactElement, { className: 'w-2.5 h-2.5' })}
                            <span>{delta.percent}</span>
                        </div>
                    </div>
                </div>
                {(onOriginalDetailsClick || onTestDetailsClick) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onTestDetailsClick) onTestDetailsClick();
                            else if (onOriginalDetailsClick) onOriginalDetailsClick();
                        }}
                        className="ml-auto p-1 bg-accent-primary/5 hover:bg-accent-primary/10 border border-accent-primary/20 rounded transition-all text-accent-primary active:scale-95"
                    >
                        <Sparkles className="w-2.5 h-2.5" />
                    </button>
                )}
            </div>
        );
    }

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
                        {finalFormat(originalValue)}
                    </div>
                    {originalDetails && originalDetails.length > 0 && (
                        <div className="mt-2 text-[10px] text-text-muted space-y-0.5">
                            {originalDetails.map((d, i) => (
                                <div key={i}>{d.label}: {finalFormat(d.value)}</div>
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
                        {finalFormat(testValue)}
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
                                        <span>{d.label}: {finalFormat(d.value)}</span>
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

export function StatsSummaryPanel({ variant = 'sidebar', onClose }: { variant?: 'sidebar' | 'horizontal-strip', onClose?: () => void }) {
    const isStrip = variant === 'horizontal-strip';
    const [showDpsModal, setShowDpsModal] = useState(false);
    const [modalData, setModalData] = useState<{ stats: AggregatedStats; profile: UserProfile } | null>(null);
    const [openSection, setOpenSection] = useState<string | null>(null);
    const [stripViewMode, setStripViewMode] = useState<'general' | 'hits'>('general');
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
        testForgeAscension,
        originalPetAscension,
        testPetAscension,
        originalSkillAscension,
        testSkillAscension,
        originalPets,
        testPets,
        originalSkills,
        testSkills,
        exitCompareMode,
        keepOriginal,
        applyTestBuild,
        isCompactStats,
        setIsCompactStats
    } = useComparison();
    const { profile } = useProfile();
    const { treeMode, setTreeMode } = useTreeMode();

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

    const treeModeLabels: Record<typeof treeMode, string> = {
        empty: 'Empty Tree',
        my: 'My Tree',
        max: 'Max Tree'
    };

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

    const { originalStats, testStats, originalProfile, testProfile } = useMemo(() => {
        if (!isComparing || !originalItems || !testItems || !itemBalancingConfig || !itemBalancingLibrary) {
            return { originalStats: null, testStats: null, originalProfile: null, testProfile: null };
        }

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
            pets: { ...profile.pets, active: originalPets || profile.pets.active },
            skills: { ...profile.skills, equipped: originalSkills || profile.skills.equipped },
            misc: {
                ...profile.misc,
                forgeAscensionLevel: originalForgeAscension ?? profile.misc.forgeAscensionLevel,
                mountAscensionLevel: originalMountAscension ?? profile.misc.mountAscensionLevel,
                petAscensionLevel: originalPetAscension ?? profile.misc.petAscensionLevel,
                skillAscensionLevel: originalSkillAscension ?? profile.misc.skillAscensionLevel
            }
        };
        const testProfile = {
            ...profile,
            items: testItems,
            techTree: effectiveTechTree,
            mount: { ...profile.mount, active: testMount },
            pets: { ...profile.pets, active: testPets || profile.pets.active },
            skills: { ...profile.skills, equipped: testSkills || profile.skills.equipped },
            misc: {
                ...profile.misc,
                forgeAscensionLevel: testForgeAscension ?? profile.misc.forgeAscensionLevel,
                mountAscensionLevel: testMountAscension ?? profile.misc.mountAscensionLevel,
                petAscensionLevel: testPetAscension ?? profile.misc.petAscensionLevel,
                skillAscensionLevel: testSkillAscension ?? profile.misc.skillAscensionLevel
            }
        };

        const origStats = calculateStats(originalProfile, libs);
        const testStats = calculateStats(testProfile, libs);

        return { originalStats: origStats, testStats: testStats, originalProfile, testProfile };
    }, [
        isComparing, originalItems, testItems, itemBalancingConfig, itemBalancingLibrary,
        profile, originalMount, testMount, originalForgeAscension, originalMountAscension,
        testForgeAscension, testMountAscension,
        originalPets, testPets, originalSkills, testSkills,
        originalPetAscension, testPetAscension, originalSkillAscension, testSkillAscension,
        treeMode, techTreePositionLibrary, techTreeLibrary, libs
    ]);

    if (!stats) {
        return (
            <Card className="h-full flex items-center justify-center">
                <div className="text-center">
                    <AnimatedClock className="w-12 h-12 mx-auto mb-4 text-accent-primary" />
                    <div className="animate-spin w-8 h-8 border-4 border-accent-primary border-t-transparent rounded-full mx-auto" />
                    <p className="mt-4 text-text-muted font-bold animate-pulse">Calculating Stats...</p>
                </div>
            </Card>
        );
    }

    const weaponDps = stats.weaponDps;
    const effectiveDps = stats.averageTotalDps;
    const regenHps = stats.totalHealth * stats.healthRegen;
    const lifestealHps = weaponDps * stats.lifeSteal;
    const skillHps = stats.skillHps;
    const effectiveHps = regenHps + lifestealHps + skillHps;
    const treeBonusEntries = Object.entries(techModifiers).filter(([_, v]) => v > 0);

    const calculateDpsDetails = (s: typeof stats) => {
        const cappedCrit = Math.min(s.criticalChance, 1);
        const cappedDouble = Math.min(s.doubleDamageChance, 1);
        const critMult = 1 + cappedCrit * (s.criticalDamage - 1);
        const doubleMult = 1 + cappedDouble;
        const aps = 1 / (s.weaponAttackDuration / s.attackSpeedMultiplier);
        const weapon = s.totalDamage * aps * critMult * doubleMult;
        const realWeapon = s.realWeaponDps;
        const skills = s.skillDps + (s.skillBuffDps || 0);
        return { total: weapon + skills, weapon, skills, realTotal: realWeapon + skills, realWeapon };
    };

    const calculateHpsDetails = (s: typeof stats, dps: number) => {
        const regen = s.totalHealth * s.healthRegen;
        const lifesteal = dps * s.lifeSteal;
        const skills = s.skillHps;
        return { total: regen + lifesteal + skills, regen, lifesteal, skills };
    };

    const originalDpsDetails = originalStats ? calculateDpsDetails(originalStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const testDpsDetails = testStats ? calculateDpsDetails(testStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const originalHpsDetails = originalStats ? calculateHpsDetails(originalStats, originalDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const testHpsDetails = testStats ? calculateHpsDetails(testStats, testDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };

    const originalDps = originalDpsDetails.total;
    const testDps = testDpsDetails.total;
    const originalHps = originalHpsDetails.total;
    const testHps = testHpsDetails.total;

    const formatValue = (val: number) => isCompactStats
        ? formatCompactNumber(val)
        : val.toLocaleString(undefined, { maximumFractionDigits: 0 });

    // The comparison UI block
    const comparisonContent = (isComparing && originalStats && testStats) && (
        <div className="space-y-3">
            <ComparisonStatRow
                isCompact={isCompactStats}
                icon={<Gauge className="w-4 h-4" />}
                label="Power"
                originalValue={originalStats.power}
                testValue={testStats.power}
                color="text-purple-400"
            />
            <ComparisonStatRow
                isCompact={isCompactStats}
                icon={<Swords className="w-4 h-4" />}
                label="Damage"
                originalValue={originalStats.totalDamage}
                testValue={testStats.totalDamage}
                color="text-red-400"
            />
            <ComparisonStatRow
                isCompact={isCompactStats}
                icon={<Heart className="w-4 h-4" />}
                label="Health"
                originalValue={originalStats.totalHealth}
                testValue={testStats.totalHealth}
                color="text-green-400"
            />
            <ComparisonStatRow
                isCompact={isCompactStats}
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
                isCompact={isCompactStats}
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
                isCompact={isCompactStats}
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

            <CollapsibleSection
                title="Single Hit Damage"
                icon={<Sparkles className="w-4 h-4 text-orange-400" />}
                isOpen={openSection === 'hit-damage'}
                onToggle={() => setOpenSection(openSection === 'hit-damage' ? null : 'hit-damage')}
            >
                <div className="space-y-3">
                    {/* Base Hit Card */}
                    <div className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Base Hit</span>
                        </div>
                        <div className="p-2 space-y-2">
                            <ComparisonStatRow
                                isCompact={true}
                                icon={<Swords />}
                                label="Normal"
                                originalValue={originalStats.hitDamage}
                                testValue={testStats.hitDamage}
                                color="text-red-400"
                                className="!p-1.5 !bg-transparent !border-0"
                            />
                            <ComparisonStatRow
                                isCompact={true}
                                icon={<Sparkles />}
                                label="Critical"
                                originalValue={originalStats.hitDamageCrit}
                                testValue={testStats.hitDamageCrit}
                                color="text-yellow-400"
                                className="!p-1.5 !bg-transparent !border-0"
                            />
                        </div>
                    </div>

                    {/* All Buffs Card */}
                    {testStats.hitDamageBuffed !== testStats.hitDamage && (
                        <div className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                            <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">All Buffs Active</span>
                            </div>
                            <div className="p-2 space-y-2">
                                <ComparisonStatRow
                                    isCompact={true}
                                    icon={<Zap />}
                                    label="Normal"
                                    originalValue={originalStats.hitDamageBuffed}
                                    testValue={testStats.hitDamageBuffed}
                                    color="text-orange-400"
                                    className="!p-1.5 !bg-transparent !border-0"
                                />
                                <ComparisonStatRow
                                    isCompact={true}
                                    icon={<Sparkles />}
                                    label="Critical"
                                    originalValue={originalStats.hitDamageBuffedCrit}
                                    testValue={testStats.hitDamageBuffedCrit}
                                    color="text-orange-500"
                                    className="!p-1.5 !bg-transparent !border-0"
                                />
                            </div>
                        </div>
                    )}

                </div>

            </CollapsibleSection >
        </div >
    );

    // The strip view (build comparison small bar)
    if (isStrip) {
        if (!isComparing) return null;
        return (
            <div className="relative bg-bg-secondary/95 backdrop-blur-md rounded-2xl border border-accent-primary/20 shadow-2xl p-4 flex flex-col items-center animate-in slide-in-from-top duration-300">
                {/* Centered Comparison Label - Floating above */}
                <div className="absolute left-1/2 -top-3.5 -translate-x-1/2 bg-bg-secondary border border-accent-primary/40 px-3 py-1 rounded-full flex items-center gap-2 shadow-xl z-20 backdrop-blur-xl">
                    <AnimatedClock className="w-3.5 h-3.5 text-accent-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-accent-primary leading-none">Comparison Mode</span>
                </div>

                {/* View Mode Toggler - Floating Top Left */}
                <div className="absolute left-4 -top-3.5">
                    <div className="flex bg-bg-secondary border border-border/50 rounded-full p-0.5 shadow-lg backdrop-blur-xl">
                        <button
                            onClick={() => setStripViewMode('general')}
                            className={cn(
                                // Modificato: gap e px orizzontale applicati solo da sm (schermi medi) in su
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                stripViewMode === 'general' ? "bg-accent-primary text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="General Stats"
                        >
                            <Layout className="w-3 h-3" />
                            {/* Modificato: aggiunto hidden per mobile, sm:block per tablet/desktop */}
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">General</span>
                        </button>
                        <button
                            onClick={() => setStripViewMode('hits')}
                            className={cn(
                                // Modificato: gap e px orizzontale applicati solo da sm (schermi medi) in su
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                stripViewMode === 'hits' ? "bg-orange-500 text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="Hit Damage"
                        >
                            <Swords className="w-3 h-3" />
                            {/* Modificato: aggiunto hidden per mobile, sm:block per tablet/desktop */}
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">Hits</span>
                        </button>
                    </div>
                </div>

                {/* Stat Compactness Toggler - Floating Top Right */}
                <div className="absolute right-4 -top-3.5">
                    <div className="flex bg-bg-secondary border border-border/50 rounded-full p-0.5 shadow-lg backdrop-blur-xl">
                        <button
                            onClick={() => setIsCompactStats(true)}
                            className={cn(
                                "p-1.5 rounded-full transition-all",
                                isCompactStats ? "bg-accent-primary text-white scale-110 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="Compact Numbers"
                        >
                            <Minimize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setIsCompactStats(false)}
                            className={cn(
                                "p-1.5 rounded-full transition-all",
                                !isCompactStats ? "bg-accent-primary text-white scale-110 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="Full Numbers"
                        >
                            <Hash className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Top Row: Build Stats comparison */}
                <div className="flex items-center justify-start gap-6 overflow-x-auto no-scrollbar w-full pb-2 px-8 snap-x snap-mandatory">
                    {stripViewMode === 'general' ? (
                        <>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Gauge className="w-4 h-4 text-purple-400" />} label="Power" originalValue={originalStats?.power ?? 0} testValue={testStats?.power ?? 0} color="text-purple-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-red-400" />} label="Damage" originalValue={originalStats?.totalDamage ?? 0} testValue={testStats?.totalDamage ?? 0} color="text-red-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-green-400" />} label="Health" originalValue={originalStats?.totalHealth ?? 0} testValue={testStats?.totalHealth ?? 0} color="text-green-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-orange-400" />} label="Theoretical" originalValue={originalDps} testValue={testDps} color="text-orange-400" onTestDetailsClick={() => { if (testStats && testProfile) { setModalData({ stats: testStats, profile: testProfile }); setShowDpsModal(true); } }} />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-orange-500" />} label="Real-Time" originalValue={originalDpsDetails.realTotal} testValue={testDpsDetails.realTotal} color="text-orange-500" onTestDetailsClick={() => { if (testStats && testProfile) { setModalData({ stats: testStats, profile: testProfile }); setShowDpsModal(true); } }} />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="HPS" originalValue={originalHps} testValue={testHps} color="text-emerald-400" />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-red-400" />} label="Base Hit" originalValue={originalStats?.hitDamage ?? 0} testValue={testStats?.hitDamage ?? 0} color="text-red-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Sparkles className="w-4 h-4 text-yellow-400" />} label="Crit Hit" originalValue={originalStats?.hitDamageCrit ?? 0} testValue={testStats?.hitDamageCrit ?? 0} color="text-yellow-400" />
                            </div>
                            {testStats && testStats.hitDamageBuffed !== testStats.hitDamage && (
                                <>
                                    <div className="shrink-0">
                                        <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-orange-400" />} label="Buffed Hit" originalValue={originalStats?.hitDamageBuffed ?? 0} testValue={testStats?.hitDamageBuffed ?? 0} color="text-orange-400" />
                                    </div>
                                    <div className="shrink-0">
                                        <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Sparkles className="w-4 h-4 text-orange-500" />} label="Buffed Crit" originalValue={originalStats?.hitDamageBuffedCrit ?? 0} testValue={testStats?.hitDamageBuffedCrit ?? 0} color="text-orange-500" />
                                    </div>
                                </>
                            )}

                        </>
                    )}
                </div>

                {/* Bottom Row: Action Buttons (Always Visible and Centered) */}
                <div className="flex items-center justify-center gap-1.5 sm:gap-4 w-full pt-2 border-t border-white/5">
                    <Button variant="ghost" size="sm" onClick={exitCompareMode} className="h-8 sm:h-10 px-2 sm:px-6 gap-1 sm:gap-2 text-[10px] sm:text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all font-bold">
                        <X className="w-3.5 h-3.5 sm:w-4 h-4" />
                        <span className="hidden sm:inline">Exit Comparison</span>
                        <span className="inline sm:hidden uppercase tracking-tight">Exit</span>
                    </Button>
                    <Button variant="secondary" size="sm" onClick={keepOriginal} className="h-8 sm:h-10 px-2 sm:px-8 gap-1 sm:gap-2 text-[10px] sm:text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-text-primary">
                        <Check className="w-3.5 h-3.5 sm:w-4 h-4 text-green-400" />
                        <span className="hidden sm:inline">Keep Equipped</span>
                        <span className="inline sm:hidden uppercase tracking-tight">Keep Equipped</span>
                    </Button>
                    <Button variant="primary" size="sm" onClick={applyTestBuild} className="h-8 sm:h-10 px-3 sm:px-12 gap-1 sm:gap-2 text-[10px] sm:text-xs font-black uppercase tracking-widest bg-accent-primary hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-accent-primary/25">
                        <ArrowRight className="w-3.5 h-3.5 sm:w-4 h-4" />
                        <span className="hidden sm:inline">Apply Test Build</span>
                        <span className="inline sm:hidden tracking-tight">Apply Test</span>
                    </Button>
                </div>

                <DpsBreakdownModal isOpen={showDpsModal} onClose={() => setShowDpsModal(false)} stats={modalData?.stats || stats} profile={modalData?.profile || profile} skillLibrary={skillLibrary} />
            </div>
        );
    }

    // Main unified Sidebar/Drawer rendering
    return (
        <Card className="h-full flex flex-col overflow-hidden shadow-2xl border-border/50 bg-bg-primary">
            {/* Unified Header */}
            <div className="p-5 border-b border-border bg-bg-secondary/30">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-6 h-6 text-accent-primary" />
                        <span className="bg-gradient-to-r from-white to-text-muted bg-clip-text text-transparent">
                            Character Stats
                        </span>
                    </h3>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    )}
                </div>

                {/* Tree Mode Selection - Top Level Segmented Control */}
                <div className="p-1.5 bg-bg-input/50 rounded-xl border border-border/30 shadow-inner">
                    <div className="flex items-center gap-2 mb-2 px-2">
                        <TreeDeciduous className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-text-muted opacity-70">Calculation Basis (Tree)</span>
                    </div>

                    <div className="grid grid-cols-3 gap-1">
                        {(['empty', 'my', 'max'] as const).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setTreeMode(mode)}
                                className={cn(
                                    "flex flex-col items-center justify-center py-2 px-1 rounded-lg border transition-all text-center gap-0.5",
                                    treeMode === mode
                                        ? "border-accent-primary bg-accent-primary/20 text-accent-primary shadow-lg shadow-accent-primary/10"
                                        : "border-transparent bg-bg-input/20 text-text-muted hover:bg-bg-input hover:text-text-primary"
                                )}
                            >
                                <span className="text-[10px] font-bold uppercase tracking-tight">{treeModeLabels[mode]}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Display Format Toggler - Always Visible */}
                <div className="mt-4 flex items-center justify-between px-2 py-2 bg-bg-input/30 rounded-lg border border-border/20">
                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest opacity-60">Display Format</div>
                    <div className="flex bg-bg-input/50 rounded-lg p-0.5 border border-border/30">
                        <button
                            onClick={() => setIsCompactStats(true)}
                            className={cn(
                                "px-3 py-1 rounded text-[9px] font-bold transition-all",
                                isCompactStats ? "bg-accent-primary text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                            )}
                        >
                            Compact
                        </button>
                        <button
                            onClick={() => setIsCompactStats(false)}
                            className={cn(
                                "px-3 py-1 rounded text-[9px] font-bold transition-all",
                                !isCompactStats ? "bg-accent-primary text-white shadow-sm" : "text-text-muted hover:text-text-primary"
                            )}
                        >
                            Extended
                        </button>
                    </div>
                </div>

                {isComparing && (
                    <div className="mt-4 pt-4 border-t border-border/30 space-y-4">


                        <div className="space-y-3">
                            <div className="text-[10px] text-text-muted text-center font-bold uppercase tracking-widest opacity-60">Build Actions</div>
                            <div className="grid grid-cols-3 gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={exitCompareMode}
                                    className="h-10 flex flex-col items-center justify-center p-0 gap-1 text-[10px] text-text-muted hover:text-red-400 grayscale hover:grayscale-0 transition-all font-bold uppercase tracking-tight border border-transparent hover:border-red-500/20"
                                >
                                    <X className="w-4 h-4" />
                                    <span>Exit</span>
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={keepOriginal}
                                    className="h-10 flex flex-col items-center justify-center p-0 gap-1 text-[10px] font-bold uppercase tracking-tight bg-bg-input/50 border border-border/30"
                                >
                                    <Check className="w-4 h-4 text-green-400" />
                                    <span>Keep Equipped</span>
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={applyTestBuild}
                                    className="h-10 flex flex-col items-center justify-center p-0 gap-1 text-[10px] font-bold uppercase tracking-tight bg-accent-primary shadow-lg shadow-accent-primary/10 hover:scale-105 transition-transform"
                                >
                                    <ArrowRight className="w-4 h-4" />
                                    <span>Apply Test</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
                {(isComparing && originalStats && testStats) ? (
                    <div className="space-y-6">
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-200 text-center font-medium">
                            Comparing Equipped vs Test Build
                        </div>
                        {comparisonContent}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Summary Section */}
                        <div className="space-y-3">
                            <StatRow
                                icon={<Gauge className="w-4 h-4" />}
                                label="Total Power"
                                value={formatValue(stats.power)}
                                color="text-purple-400"
                            />
                            <StatRow
                                icon={<Swords className="w-4 h-4" />}
                                label="Total Damage"
                                value={formatValue(stats.totalDamage)}
                                subValue={`${formatMultiplier(stats.damageMultiplier || 1, 2)} (Sub: ${formatPercent(stats.damageBreakdown?.substats || 0, 2)}, Asc: x${((stats.damageBreakdown?.ascension || 0) + 1).toFixed(2)})`}
                                color="text-red-400"
                            />
                            <StatRow
                                icon={<Heart className="w-4 h-4" />}
                                label="Total Health"
                                value={formatValue(stats.totalHealth)}
                                subValue={`${formatMultiplier(stats.healthMultiplier || 1, 2)} (Sub: ${formatPercent(stats.healthBreakdown?.substats || 0, 2)}, Asc: x${((stats.healthBreakdown?.ascension || 0) + 1).toFixed(2)})`}
                                color="text-green-400"
                            />
                            <StatRow
                                icon={<Zap className="w-4 h-4" />}
                                label="Theoretical DPS"
                                value={formatValue(effectiveDps)}
                                subValue={`Weapon: ${formatCompactNumber(weaponDps)}, Skills: ${formatCompactNumber(stats.skillDps + (stats.skillBuffDps || 0))}`}
                                color="text-orange-400"
                                onInfoPointsClick={() => setShowDpsModal(true)}
                            />
                            <StatRow
                                icon={<Zap className="w-4 h-4" />}
                                label="Real-Time DPS"
                                value={formatValue(stats.realTotalDps)}
                                subValue={`Weapon: ${formatCompactNumber(stats.realWeaponDps)}, Skills: ${formatCompactNumber(stats.skillDps + (stats.skillBuffDps || 0))}`}
                                color="text-orange-500"
                                onInfoPointsClick={() => setShowDpsModal(true)}
                            />
                        </div>

                        {/* Single Hit Damage Section */}
                        <CollapsibleSection
                            title="Single Hit Damage"
                            icon={<Sparkles className="w-4 h-4 text-orange-400" />}
                            isOpen={openSection === 'hit-damage'}
                            onToggle={() => setOpenSection(openSection === 'hit-damage' ? null : 'hit-damage')}
                        >
                            <div className="space-y-2">
                                <StatRow
                                    icon={<Swords className="w-4 h-4" />}
                                    label="Base Hit"
                                    value={formatValue(stats.hitDamage)}
                                    subValue={`Crit: ${formatValue(stats.hitDamageCrit)}`}
                                    color="text-red-400"
                                />
                                {stats.hitDamageBuffed !== stats.hitDamage && (
                                    <StatRow
                                        icon={<Sparkles className="w-4 h-4" />}
                                        label="All Buffs Active"
                                        value={formatValue(stats.hitDamageBuffed)}
                                        subValue={`Crit: ${formatValue(stats.hitDamageBuffedCrit)}`}
                                        color="text-orange-500"
                                    />
                                )}

                                {/* Grouped Buff Scenarios Card */}
                                {stats.buffHitMetrics && stats.buffHitMetrics.length > 0 && (
                                    <div className="mt-2 bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Buff Scenarios</span>
                                        </div>
                                        <div className="divide-y divide-white/5">
                                            {stats.buffHitMetrics.map((metric, idx) => (
                                                <div key={`buff-${idx}`} className="px-3 py-2 flex items-center justify-between gap-4">
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-medium text-text-primary">{metric.name}</span>
                                                    </div>
                                                    <div className="flex flex-col items-end shrink-0">
                                                        <span className="text-xs font-mono text-orange-300">{formatValue(metric.damage)}</span>
                                                        <span className="text-[10px] font-mono text-orange-400/70">Crit: {formatValue(metric.damageCrit)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CollapsibleSection>

                        {/* Passive Detailed Section */}
                        <CollapsibleSection
                            title="Passives & Multipliers"
                            icon={<Sparkles className="w-4 h-4 text-yellow-400" />}
                            isOpen={openSection === 'passives'}
                            onToggle={() => setOpenSection(openSection === 'passives' ? null : 'passives')}
                        >
                            <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <CompactStat icon={<Star className="w-3 h-3" />} label="Crit %" value={formatPercent(stats.criticalChance || 0)} color="text-yellow-400" />
                                    <CompactStat icon={<TrendingUp className="w-3 h-3" />} label="Crit x" value={`${(stats.criticalDamage || 0).toFixed(2)}x`} color="text-yellow-500" />
                                    <CompactStat icon={<Shield className="w-3 h-3" />} label="Block %" value={formatPercent(stats.blockChance || 0)} color="text-blue-400" />
                                    <CompactStat icon={<Zap className="w-3 h-3" />} label="Double %" value={formatPercent(stats.doubleDamageChance || 0)} color="text-purple-400" />
                                    <CompactStat icon={<Heart className="w-3 h-3" />} label="Life Steal %" value={formatPercent(stats.lifeSteal || 0)} color="text-purple-400" />
                                    <CompactStat icon={<Heart className="w-3 h-3" />} label="Health Regen %" value={formatPercent(stats.healthRegen || 0)} color="text-purple-400" />
                                    <CompactStat icon={<TrendingUp className="w-3 h-3" />} label="Attack Speed %" value={formatPercent(stats.attackSpeedMultiplier)} color="text-orange-400" />
                                    <CompactStat icon={<TrendingUp className="w-3 h-3" />} label="Skill Cooldown %" value={formatPercent(stats.skillCooldownReduction)} color="text-emerald-400" />


                                </div>
                                <StatRow icon={<Swords className="w-3 h-3" />} label="Skill Damage %" value={formatPercent(stats.skillDamageMultiplier)} color="text-red-400" />
                                <StatRow icon={<Swords className="w-3 h-3" />} label="Damage Multiplier %" value={formatPercent(stats.damageMultiplier)} color="text-red-400" />
                                <StatRow icon={<Heart className="w-3 h-3" />} label="Health Multiplier %" value={formatPercent(stats.healthMultiplier)} color="text-emerald-400" />
                                <StatRow
                                    icon={<TrendingUp className="w-4 h-4 text-text-primary" />}
                                    label="Total HPS"
                                    value={formatCompactNumber(effectiveHps)}
                                    subValue={`Regen: ${formatCompactNumber(regenHps)}, Life: ${formatCompactNumber(lifestealHps)}, Skills: ${formatCompactNumber(skillHps)}`}
                                    color="text-emerald-400"
                                />

                                <StatRow
                                    icon={<Clock className="w-4 h-4" />}
                                    label={getStatName('AttackDuration')}
                                    value={`${stats.weaponAttackDuration.toFixed(2)}s`}
                                    subValue={`Final: ${(stats.weaponAttackDuration / stats.attackSpeedMultiplier).toFixed(2)}s`}
                                    color="text-amber-400"
                                />

                            </div>
                        </CollapsibleSection>

                        {/* Weapon Section */}
                        <CollapsibleSection
                            title="Weapon Metrics"
                            icon={<Crosshair className="w-4 h-4 text-amber-400" />}
                            isOpen={openSection === 'weapon'}
                            onToggle={() => setOpenSection(openSection === 'weapon' ? null : 'weapon')}
                        >
                            <div className="space-y-2">
                                <div className="p-3 bg-bg-input/30 rounded-lg border border-border/30 mb-1 flex items-center justify-between">
                                    <span className="text-xs text-text-muted">Type</span>
                                    <span className={cn(
                                        "font-bold px-2 py-0.5 rounded text-[10px]",
                                        stats.isRangedWeapon ? "bg-sky-500/20 text-sky-400 border border-sky-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                    )}>
                                        {stats.isRangedWeapon ? '🏹 RANGED' : '⚔️ MELEE'}
                                    </span>
                                </div>
                                <StatRow icon={<Target className="w-4 h-4" />} label="Atk Range" value={`${stats.weaponAttackRange.toFixed(1)}m`} color="text-cyan-400" />
                                <StatRow icon={<Clock className="w-4 h-4" />} label="Windup" value={`${stats.weaponWindupTime.toFixed(2)}s`} color="text-amber-400" />
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
                            </div>
                        </CollapsibleSection>

                        {/* Economy Section */}
                        <CollapsibleSection
                            title="Economy & Freebies"
                            icon={<Coins className="w-4 h-4 text-amber-500" />}
                            isOpen={openSection === 'economy'}
                            onToggle={() => setOpenSection(openSection === 'economy' ? null : 'economy')}
                        >
                            <div className="space-y-2">

                                <div className="grid grid-cols-2 gap-2">
                                    <CompactStat icon={<Coins className="w-3 h-3" />} label="Sell Price" value={formatMultiplier(stats.sellPriceMultiplier)} color="text-amber-400" />
                                    <CompactStat icon={<Star className="w-3 h-3" />} label="Forge Free" value={formatPercent(stats.forgeFreebieChance)} color="text-pink-400" />
                                    <CompactStat icon={<Star className="w-3 h-3" />} label="Egg Free" value={formatPercent(stats.eggFreebieChance)} color="text-amber-400" />
                                    <CompactStat icon={<Star className="w-3 h-3" />} label="Mount Free" value={formatPercent(stats.mountFreebieChance)} color="text-cyan-400" />
                                </div>
                            </div>
                        </CollapsibleSection>

                        {/* Tree Bonuses */}
                        <CollapsibleSection
                            title="Active Tree Passive Modifiers"
                            icon={<TreeDeciduous className="w-4 h-4 text-green-400" />}
                            isOpen={openSection === 'tree'}
                            onToggle={() => setOpenSection(openSection === 'tree' ? null : 'tree')}
                        >
                            {treeBonusEntries.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {treeBonusEntries.map(([key, value]) => (
                                        <div key={key} className="p-2 bg-bg-input/30 rounded-lg border border-border/30">
                                            <div className="text-[10px] text-text-muted truncate mb-1" title={key}>{key}</div>
                                            <div className="font-mono font-bold text-green-400 text-xs">+{(value * 100).toFixed(1)}%</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-text-muted text-xs py-4 bg-bg-input/10 rounded-lg border border-dashed border-border/30">
                                    No active bonuses from nodes
                                </div>
                            )}
                        </CollapsibleSection>
                    </div>
                )}
            </div>

            <DpsBreakdownModal
                isOpen={showDpsModal}
                onClose={() => { setShowDpsModal(false); setModalData(null); }}
                stats={modalData?.stats || stats}
                profile={modalData?.profile || profile}
                skillLibrary={skillLibrary}
            />
        </Card>
    );
}
