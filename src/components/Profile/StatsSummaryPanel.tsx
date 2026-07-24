import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Swords, Heart, Shield, Zap, Target, Gauge,
    TrendingUp, Clock, Coins, Star, Crosshair, TreeDeciduous, Sparkles,
    ArrowUp, ArrowDown, X, Check, ArrowRight, Hash, Minimize2, Layout, Download,
    ArrowLeftRight, Info, Sword, Scale, RotateCcw, Layers
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
import { UserProfile, PetSlot, MountSlot } from '../../types/Profile';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';
import { getAveragePerfection } from '../../utils/itemCalculations';
import { PerfectionMeter } from '../UI/PerfectionMeter';
import { DpsBreakdownModal } from './DpsBreakdownModal';
import { LifestealBreakdownModal } from './LifestealBreakdownModal';
import { StatSourcesModal, MultiplierBreakdown } from './StatSourcesModal';
import { TOTAL_DAMAGE_KEY, TOTAL_HEALTH_KEY, TOTAL_POWER_KEY } from '../../types/statAttribution';

interface StatRowProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subValue?: string;
    count?: number;
    perf?: number;
    color?: string;
    onInfoPointsClick?: () => void;
    /** Opens the per-source breakdown modal. Distinct from onInfoPointsClick's DETAILS pill. */
    onInfoClick?: () => void;
}

// Small neutral "i" that opens the stat's source breakdown
function InfoDot({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={cn(
                "w-4 h-4 rounded-full border border-border/60 bg-bg-secondary/80 flex items-center justify-center",
                "text-text-muted hover:text-accent-primary hover:border-accent-primary/50 transition-colors active:scale-95 shrink-0",
                className
            )}
            title="Show stat sources"
            aria-label="Show stat sources"
        >
            <Info className="w-2.5 h-2.5" />
        </button>
    );
}

function StatRow({ icon, label, value, subValue, count, perf, color = 'text-accent-primary', onInfoPointsClick, onInfoClick }: StatRowProps) {
    return (
        <div className="flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[5rem]">
            <div className="flex items-center gap-2 w-full">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="text-sm font-medium text-text-primary leading-tight break-words">{label}</div>
                        {onInfoClick && <InfoDot onClick={onInfoClick} />}
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
                        <div className="text-[11px] text-text-muted mt-0.5">
                            {count} {count === 1 ? 'Slot' : 'Slots'}
                            {perf !== undefined && ` (${perf.toFixed(1)}% Perfection)`}
                        </div>
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
function CompactStat({ icon, label, value, subValue, count, perf, color = 'text-accent-primary', onInfoClick }: StatRowProps) {
    return (
        <div className="relative flex flex-col justify-between p-2.5 bg-bg-input/30 rounded-lg border border-border/30 hover:bg-bg-input/50 transition-colors min-h-[4.5rem]">
            {onInfoClick && <InfoDot onClick={onInfoClick} className="absolute top-1 right-1" />}
            <div className="flex items-center gap-1.5 mb-1 min-w-0 pr-4">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center bg-bg-secondary shrink-0", color)}>
                    {icon}
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-sm text-text-muted break-words leading-tight block">{label}</span>
                    {count !== undefined && count > 0 && (
                        <span className="text-[9px] text-text-muted leading-none mt-0.5">
                            {count} {count === 1 ? 'Slot' : 'Slots'}
                            {perf !== undefined && ` (${perf.toFixed(1)}% Perf)`}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex flex-col items-end mt-auto">
                <div className={cn("font-mono font-bold text-base", color)}>
                    {value}
                </div>
                {subValue && (
                    <div className="text-[9px] text-text-muted leading-tight opacity-70 font-medium text-right mt-0.5">
                        {subValue}
                    </div>
                )}
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

export interface ComparisonStatRowProps {
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

export function ComparisonStatRow({
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

export function StatsSummaryPanel({ variant = 'sidebar', onClose, hideActions = false, defaultTab = 'general' }: { variant?: 'sidebar' | 'horizontal-strip', onClose?: () => void, hideActions?: boolean, defaultTab?: 'general' | 'metrics' | 'hits' | 'passives' }) {
    const isStrip = variant === 'horizontal-strip';
    const location = useLocation();
    const isSubstatsPage = location.pathname.includes('/calculators/substats');
    const actualHideActions = hideActions || isSubstatsPage;
    
    const [showDpsModal, setShowDpsModal] = useState(false);
    const [modalData, setModalData] = useState<{ stats: AggregatedStats; profile: UserProfile; variant: 'default' | 'original' | 'test' } | null>(null);

    const openDpsModal = (s: AggregatedStats, p: UserProfile, v: 'default' | 'original' | 'test' = 'default') => {
        setModalData({ stats: s, profile: p, variant: v });
        setShowDpsModal(true);
    };

    const [showLifestealModal, setShowLifestealModal] = useState(false);
    const openLifestealModal = (s: AggregatedStats, p: UserProfile, v: 'default' | 'original' | 'test' = 'default') => {
        setModalData({ stats: s, profile: p, variant: v });
        setShowLifestealModal(true);
    };
    // Per-source breakdown modal: one piece of state shared by all 16 stat cards
    const [sourceModal, setSourceModal] = useState<
        { key: string; label: string; total: string; format: (v: number) => string; multiplier?: MultiplierBreakdown } | null
    >(null);
    const infoProps = (
        key: string, label: string, total: string,
        format: (v: number) => string = formatPercent,
        multiplier?: MultiplierBreakdown
    ) => ({
        onInfoClick: () => setSourceModal({ key, label, total, format, multiplier })
    });

    // Builds the same multiplier breakdown the total cards show in their subtitle,
    // so the modal's numbers match the card by construction (mirrors formatDetailedBreakdown).
    const mulBreakdown = (label: string, totalMultiplier: number, b: any): MultiplierBreakdown => {
        const parts: { label: string; value: string }[] = [];
        if (b?.base > 0) parts.push({ label: 'Base', value: `+${formatPercent(b.base, 1)}` });
        if (b?.substats > 0) parts.push({ label: 'Items', value: `+${formatPercent(b.substats, 1)}` });
        if (b?.tree > 0) parts.push({ label: 'Tree', value: `+${formatPercent(b.tree, 1)}` });
        if (b?.ascension > 0) parts.push({ label: 'Asc', value: `+${formatPercent(b.ascension, 1)}` });
        if (b?.skins > 0) parts.push({ label: 'Skins', value: `+${formatPercent(b.skins, 1)}` });
        if (b?.sets > 0) parts.push({ label: 'Sets', value: `+${formatPercent(b.sets, 1)}` });
        return { label, total: formatPercent(totalMultiplier || 1, 0), parts };
    };

    const [openSection, setOpenSection] = useState<string | null>(null);
    const [viewTab, setViewTab] = useState<'general' | 'metrics' | 'hits' | 'passives'>(defaultTab);
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
        originalUseSkinWindup,
        testUseSkinWindup,
        updateTestPet,
        updateTestMount,
        exitCompareMode,
        keepOriginal,
        applyTestBuild,
        loadProfileIntoTest,
        isCompactStats,
        setIsCompactStats,
        excludeSubstats,
        setExcludeSubstats
    } = useComparison();
    const stats = useGlobalStats(excludeSubstats);
    const fullStats = useGlobalStats(false);
    const techModifiers = useTreeModifiers() as Record<string, number>;
    const { profile, profiles, activeProfileId } = useProfile();

    // --- Auto-optimize the Test build (drives the strip's AUTO buttons) --------
    const { optimizeLoadout, isReady: optimizerReady } = useProfileOptimizer();
    // undefined = nothing to revert; null = revert to "no mount equipped"
    const [previousTestPets, setPreviousTestPets] = useState<PetSlot[] | null>(null);
    const [previousTestMount, setPreviousTestMount] = useState<MountSlot | null | undefined>(undefined);
    // On: score saved builds at their own level. Off: score everything at level 1.
    const [respectSavedLevels, setRespectSavedLevels] = useState(true);

    // Saved builds are global, so the optimizer has candidates whenever either pool is non-empty.
    const autoOptimizeDisabled = !optimizerReady
        || ((profile.pets.savedBuilds?.length || 0) < 1 && (profile.mount.savedBuilds?.length || 0) < 1);

    const handleAutoOptimizeTest = (metric: 'dps' | 'power' | 'lifesteal' | 'balanced') => {
        // Evaluate against the Test build's own items/mount/ascensions, keeping
        // everything the Test side doesn't override (tech tree, passives, saved builds).
        const testBase: UserProfile = {
            ...profile,
            items: testItems ?? profile.items,
            mount: { ...profile.mount, active: testMount ?? profile.mount.active },
            pets: { ...profile.pets, active: testPets ?? profile.pets.active },
            skills: { ...profile.skills, equipped: testSkills ?? profile.skills.equipped },
            misc: {
                ...profile.misc,
                forgeAscensionLevel: testForgeAscension ?? profile.misc.forgeAscensionLevel,
                mountAscensionLevel: testMountAscension ?? profile.misc.mountAscensionLevel,
                petAscensionLevel: testPetAscension ?? profile.misc.petAscensionLevel,
                skillAscensionLevel: testSkillAscension ?? profile.misc.skillAscensionLevel,
                useSkinWindup: testUseSkinWindup ?? profile.misc.useSkinWindup,
            },
        };

        setPreviousTestPets(testPets ? [...testPets] : null);
        setPreviousTestMount(testMount);

        const best = optimizeLoadout(metric, testBase, respectSavedLevels);
        if (!best) return;

        updateTestPet(best.pets);
        updateTestMount(best.mount);
    };

    const handleRevertTest = () => {
        if (previousTestPets) updateTestPet(previousTestPets);
        if (previousTestMount !== undefined) updateTestMount(previousTestMount);
        setPreviousTestPets(null);
        setPreviousTestMount(undefined);
    };

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

    // Average perfection across all gear (items + pets + mount) for each compare side.
    const originalPerfection = useMemo(() => originalItems ? getAveragePerfection(
        [...Object.values(originalItems), ...(originalPets || []), originalMount],
        secondaryStatLibrary
    ) : null, [originalItems, originalPets, originalMount, secondaryStatLibrary]);
    const testPerfection = useMemo(() => testItems ? getAveragePerfection(
        [...Object.values(testItems), ...(testPets || []), testMount],
        secondaryStatLibrary
    ) : null, [testItems, testPets, testMount, secondaryStatLibrary]);

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

    const { originalStats, testStats, originalFullStats, testFullStats, originalProfile, testProfile } = useMemo(() => {
        if (!isComparing || !originalItems || !testItems || !itemBalancingConfig || !itemBalancingLibrary) {
            return { originalStats: null, testStats: null, originalFullStats: null, testFullStats: null, originalProfile: null, testProfile: null };
        }

        let effectiveTechTree = profile.techTree;
        if (treeMode === 'empty') {
            effectiveTechTree = { Forge: {}, Power: {}, SkillsPetTech: {}, Clan: {} };
        } else if (treeMode === 'max' && techTreePositionLibrary && techTreeLibrary) {
            const maxTree: typeof profile.techTree = { Forge: {}, Power: {}, SkillsPetTech: {}, Clan: {} };
            const trees: ('Forge' | 'Power' | 'SkillsPetTech' | 'Clan')[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];
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
                skillAscensionLevel: originalSkillAscension ?? profile.misc.skillAscensionLevel,
                useSkinWindup: originalUseSkinWindup ?? profile.misc.useSkinWindup
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
                skillAscensionLevel: testSkillAscension ?? profile.misc.skillAscensionLevel,
                useSkinWindup: testUseSkinWindup ?? profile.misc.useSkinWindup
            }
        };

        const origStats = calculateStats(originalProfile, libs, excludeSubstats);
        const testStats = calculateStats(testProfile, libs, excludeSubstats);
        const origFullStats = calculateStats(originalProfile, libs, false);
        const testFullStats = calculateStats(testProfile, libs, false);

        return { 
            originalStats: origStats, 
            testStats: testStats, 
            originalFullStats: origFullStats,
            testFullStats: testFullStats,
            originalProfile, 
            testProfile 
        };
    }, [
        isComparing, originalItems, testItems, itemBalancingConfig, itemBalancingLibrary,
        profile, originalMount, testMount, originalForgeAscension, originalMountAscension,
        testForgeAscension, testMountAscension,
        originalPets, testPets, originalSkills, testSkills,
        originalPetAscension, testPetAscension, originalSkillAscension, testSkillAscension,
        originalUseSkinWindup, testUseSkinWindup,
        treeMode, techTreePositionLibrary, techTreeLibrary, libs, excludeSubstats
    ]);

    const activePerfectionDetails = useMemo(() => {
        if (!secondaryStatLibrary) return {};

        const totals: Record<string, { sum: number; count: number }> = {};

        const addStatsFromSlot = (statsList?: { statId: string; value: number }[]) => {
            if (!statsList) return;
            statsList.forEach(s => {
                const libStat = secondaryStatLibrary[s.statId];
                if (libStat && libStat.UpperRange > 0) {
                    const maxVal = libStat.UpperRange * 100;
                    const perf = (s.value / maxVal) * 100;
                    if (!totals[s.statId]) {
                        totals[s.statId] = { sum: 0, count: 0 };
                    }
                    totals[s.statId].sum += Math.min(100, perf);
                    totals[s.statId].count += 1;
                }
            });
        };

        // Scan items
        const itemSlots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        itemSlots.forEach(slot => {
            const item = profile.items[slot];
            if (item) addStatsFromSlot(item.secondaryStats);
        });

        // Scan pets
        profile.pets.active.forEach(pet => {
            if (pet) addStatsFromSlot(pet.secondaryStats);
        });

        // Scan mount
        if (profile.mount.active) {
            addStatsFromSlot(profile.mount.active.secondaryStats);
        }

        const result: Record<string, { count: number; avgPerfection: number }> = {};
        Object.entries(totals).forEach(([statId, info]) => {
            result[statId] = {
                count: info.count,
                avgPerfection: info.sum / info.count
            };
        });

        return result;
    }, [profile, secondaryStatLibrary]);

    if (!stats || !fullStats) {
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

    const calculateDpsDetails = (s: AggregatedStats) => {
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

    const calculateHpsDetails = (s: AggregatedStats, dps: number) => {
        const regen = s.totalHealth * s.healthRegen;
        const lifesteal = dps * s.lifeSteal;
        const skills = s.skillHps;
        const rawTotal = regen + lifesteal + skills;

        // Effective HPS: Since blocking damage means you don't need to heal it,
        // it acts as a multiplier to your effective recovery.
        // EHPS = Raw HPS / (1 - BlockChance)
        const blockChance = Math.min(s.blockChance || 0, 0.95); // Cap at 95% for calculation
        const effectiveTotal = rawTotal / (1 - blockChance);
        const blockBenefit = effectiveTotal - rawTotal;

        return {
            total: effectiveTotal,
            rawTotal,
            regen,
            lifesteal,
            skills,
            blockBenefit
        };
    };

    const currentDpsDetails = calculateDpsDetails(fullStats);
    const weaponDps = currentDpsDetails.weapon;
    const effectiveDps = currentDpsDetails.total;
    const currentHpsDetails = calculateHpsDetails(fullStats, weaponDps);
    const currentRealHpsDetails = calculateHpsDetails(fullStats, currentDpsDetails.realWeapon);
    
    const effectiveHps = currentHpsDetails.total;
    const realHps = currentRealHpsDetails.total;
    
    const treeBonusEntries = Object.entries(techModifiers).filter(([_, v]) => v > 0);

    const originalDpsDetails = originalFullStats ? calculateDpsDetails(originalFullStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const testDpsDetails = testFullStats ? calculateDpsDetails(testFullStats) : { total: 0, weapon: 0, skills: 0, realTotal: 0, realWeapon: 0 };
    const originalHpsDetails = originalFullStats ? calculateHpsDetails(originalFullStats, originalDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const originalRealHpsDetails = originalFullStats ? calculateHpsDetails(originalFullStats, originalDpsDetails.realWeapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const testHpsDetails = testFullStats ? calculateHpsDetails(testFullStats, testDpsDetails.weapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };
    const testRealHpsDetails = testFullStats ? calculateHpsDetails(testFullStats, testDpsDetails.realWeapon) : { total: 0, regen: 0, lifesteal: 0, skills: 0 };

    const originalDps = originalDpsDetails.total;
    const testDps = testDpsDetails.total;
    const originalHps = originalHpsDetails.total;
    const testHps = testHpsDetails.total;
    const originalRealHps = originalRealHpsDetails.total;
    const testRealHps = testRealHpsDetails.total;

    const formatValue = (val: number) => isCompactStats
        ? formatCompactNumber(val)
        : val.toLocaleString(undefined, { maximumFractionDigits: 0 });

    // The comparison UI block
    // The comparison UI block
    const comparisonContent = (isComparing && originalStats && testStats) && (
        <div className="space-y-4">
            {viewTab === 'general' && (
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
                        icon={<Swords className="w-4 h-4" />}
                        label="Melee DMG"
                        originalValue={originalStats.meleeDamage}
                        testValue={testStats.meleeDamage}
                        color="text-amber-400"
                    />
                    <ComparisonStatRow
                        isCompact={isCompactStats}
                        icon={<Crosshair className="w-4 h-4" />}
                        label="Ranged DMG"
                        originalValue={originalStats.rangedDamage}
                        testValue={testStats.rangedDamage}
                        color="text-sky-400"
                    />
                    <ComparisonStatRow
                        isCompact={isCompactStats}
                        icon={<Heart className="w-4 h-4" />}
                        label="Health"
                        originalValue={originalStats.totalHealth}
                        testValue={testStats.totalHealth}
                        color="text-green-400"
                    />
                </div>
            )}
            {viewTab === 'passives' && (
                <div className="space-y-3">
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Star className="w-4 h-4 text-yellow-400" />} label="Crit %" originalValue={originalStats.criticalChance || 0} testValue={testStats.criticalChance || 0} formatFn={formatPercent} color="text-yellow-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<TrendingUp className="w-4 h-4 text-yellow-500" />} label="Crit Damage" originalValue={originalStats.criticalDamage || 0} testValue={testStats.criticalDamage || 0} formatFn={formatMultiplier} color="text-yellow-500" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Shield className="w-4 h-4 text-blue-400" />} label="Block %" originalValue={originalStats.blockChance || 0} testValue={testStats.blockChance || 0} formatFn={formatPercent} color="text-blue-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Zap className="w-4 h-4 text-purple-400" />} label="Double %" originalValue={originalStats.doubleDamageChance || 0} testValue={testStats.doubleDamageChance || 0} formatFn={formatPercent} color="text-purple-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Heart className="w-4 h-4 text-purple-400" />} label="Life Steal %" originalValue={originalStats.lifeSteal || 0} testValue={testStats.lifeSteal || 0} formatFn={formatPercent} color="text-purple-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Heart className="w-4 h-4 text-purple-400" />} label="Health Regen %" originalValue={originalStats.healthRegen || 0} testValue={testStats.healthRegen || 0} formatFn={formatPercent} color="text-purple-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<TrendingUp className="w-4 h-4 text-orange-400" />} label="Attack Speed" originalValue={originalStats.attackSpeedMultiplier || 0} testValue={testStats.attackSpeedMultiplier || 0} formatFn={formatMultiplier} color="text-orange-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Skill CDR %" originalValue={originalStats.skillCooldownReduction || 0} testValue={testStats.skillCooldownReduction || 0} formatFn={formatPercent} color="text-emerald-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Swords className="w-4 h-4 text-red-400" />} label="Damage %" originalValue={originalStats.secondaryDamageMulti || 0} testValue={testStats.secondaryDamageMulti || 0} formatFn={formatPercent} color="text-red-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Heart className="w-4 h-4 text-green-400" />} label="Health %" originalValue={originalStats.secondaryHealthMulti || 0} testValue={testStats.secondaryHealthMulti || 0} formatFn={formatPercent} color="text-green-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Swords className="w-4 h-4 text-amber-400" />} label="Melee DMG %" originalValue={originalStats.meleeDamageMultiplier || 0} testValue={testStats.meleeDamageMultiplier || 0} formatFn={formatPercent} color="text-amber-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Crosshair className="w-4 h-4 text-sky-400" />} label="Ranged DMG %" originalValue={originalStats.rangedDamageMultiplier || 0} testValue={testStats.rangedDamageMultiplier || 0} formatFn={formatPercent} color="text-sky-400" />
                    <ComparisonStatRow isCompact={isCompactStats} icon={<Swords className="w-4 h-4 text-red-400" />} label="Skill Damage %" originalValue={originalStats.skillDamageMultiplier || 0} testValue={testStats.skillDamageMultiplier || 0} formatFn={formatMultiplier} color="text-red-400" />
                </div>
            )}

            {viewTab === 'metrics' && (
                <>
                    {/* Theoretical Block */}
                    <div className="bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Theoretical Metrics</span>
                        </div>
                        <div className="p-2 space-y-2">
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
                                    if (originalFullStats && originalProfile) {
                                        openDpsModal(originalFullStats, originalProfile, 'original');
                                    }
                                }}
                                onTestDetailsClick={() => {
                                    if (testFullStats && testProfile) {
                                        openDpsModal(testFullStats, testProfile, 'test');
                                    }
                                }}
                            />
                            <ComparisonStatRow
                                isCompact={isCompactStats}
                                icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
                                label="Theoretical HPS"
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
                            <ComparisonStatRow
                                isCompact={isCompactStats}
                                icon={<Heart className="w-4 h-4 text-purple-400" />}
                                label="Lifesteal/sec"
                                originalValue={originalHpsDetails.lifesteal}
                                testValue={testHpsDetails.lifesteal}
                                color="text-purple-400"
                                onOriginalDetailsClick={() => {
                                    if (originalFullStats && originalProfile) {
                                        openLifestealModal(originalFullStats, originalProfile, 'original');
                                    }
                                }}
                                onTestDetailsClick={() => {
                                    if (testFullStats && testProfile) {
                                        openLifestealModal(testFullStats, testProfile, 'test');
                                    }
                                }}
                            />
                        </div>
                    </div>

                    {/* Real-Time Block */}
                    <div className="bg-orange-500/5 rounded-xl border border-orange-500/10 overflow-hidden ring-1 ring-orange-500/10">
                        <div className="px-3 py-1.5 bg-orange-500/10 border-b border-orange-500/10 flex items-center gap-2">
                            <Zap className="w-3 h-3 text-orange-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">Real-Time Metrics</span>
                        </div>
                        <div className="p-2 space-y-2">
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
                                    if (originalFullStats && originalProfile) {
                                        openDpsModal(originalFullStats, originalProfile, 'original');
                                    }
                                }}
                                onTestDetailsClick={() => {
                                    if (testFullStats && testProfile) {
                                        openDpsModal(testFullStats, testProfile, 'test');
                                    }
                                }}
                            />
                            <ComparisonStatRow
                                isCompact={isCompactStats}
                                icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
                                label="Real-Time HPS"
                                originalValue={originalRealHps}
                                testValue={testRealHps}
                                color="text-emerald-500"
                                originalDetails={[
                                    { label: 'Regen', value: originalRealHpsDetails.regen },
                                    { label: 'Lifesteal', value: originalRealHpsDetails.lifesteal },
                                    { label: 'Skills', value: originalRealHpsDetails.skills }
                                ]}
                                testDetails={[
                                    { label: 'Regen', value: testRealHpsDetails.regen },
                                    { label: 'Lifesteal', value: testRealHpsDetails.lifesteal },
                                    { label: 'Skills', value: testRealHpsDetails.skills }
                                ]}
                            />
                            <ComparisonStatRow
                                isCompact={isCompactStats}
                                icon={<Heart className="w-4 h-4 text-purple-500" />}
                                label="Lifesteal/sec"
                                originalValue={originalRealHpsDetails.lifesteal}
                                testValue={testRealHpsDetails.lifesteal}
                                color="text-purple-500"
                                onOriginalDetailsClick={() => {
                                    if (originalFullStats && originalProfile) {
                                        openLifestealModal(originalFullStats, originalProfile, 'original');
                                    }
                                }}
                                onTestDetailsClick={() => {
                                    if (testFullStats && testProfile) {
                                        openLifestealModal(testFullStats, testProfile, 'test');
                                    }
                                }}
                            />
                        </div>
                    </div>
                </>
            )}

            {viewTab === 'hits' && (
                <div className="space-y-3">
                    {/* Base Hit Card */}
                    <div className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Base Hit</span>
                        </div>
                        <div className="p-2 space-y-2">
                            <ComparisonStatRow
                                isCompact={true}
                                icon={<Swords className="w-4 h-4" />}
                                label="Normal"
                                originalValue={originalFullStats.hitDamage}
                                testValue={testFullStats.hitDamage}
                                color="text-red-400"
                                className="!p-1.5 !bg-transparent !border-0"
                            />
                            <ComparisonStatRow
                                isCompact={true}
                                icon={<Sparkles className="w-4 h-4" />}
                                label="Critical"
                                originalValue={originalFullStats.hitDamageCrit}
                                testValue={testFullStats.hitDamageCrit}
                                color="text-yellow-400"
                                className="!p-1.5 !bg-transparent !border-0"
                            />
                        </div>
                    </div>

                    {/* All Buffs Card */}
                    {(testFullStats.hitDamageBuffed !== testFullStats.hitDamage || originalFullStats.hitDamageBuffed !== originalFullStats.hitDamage) && (
                        <div className="bg-orange-500/5 rounded-xl border border-orange-500/10 overflow-hidden ring-1 ring-orange-500/10">
                            <div className="px-3 py-1.5 bg-orange-500/10 border-b border-orange-500/10">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">All Buffs Active</span>
                            </div>
                            <div className="p-2 space-y-2">
                                <ComparisonStatRow
                                    isCompact={true}
                                    icon={<Zap className="w-4 h-4" />}
                                    label="Normal"
                                    originalValue={originalFullStats.hitDamageBuffed}
                                    testValue={testFullStats.hitDamageBuffed}
                                    color="text-orange-400"
                                    className="!p-1.5 !bg-transparent !border-0"
                                />
                                <ComparisonStatRow
                                    isCompact={true}
                                    icon={<Sparkles className="w-4 h-4" />}
                                    label="Critical"
                                    originalValue={originalFullStats.hitDamageBuffedCrit}
                                    testValue={testFullStats.hitDamageBuffedCrit}
                                    color="text-orange-500"
                                    className="!p-1.5 !bg-transparent !border-0"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    // The strip view (build comparison small bar)
    if (isStrip) {
        if (!isComparing) return null;
        return (
            <div className="relative bg-bg-secondary/95 backdrop-blur-md rounded-2xl border border-accent-primary/20 shadow-2xl p-4 flex flex-col items-center animate-in slide-in-from-top duration-300">
                {/* Centered Comparison Label - Floating above */}
                <div className="absolute left-1/2 -top-3.5 -translate-x-1/2 bg-bg-secondary border border-accent-primary/40 px-1.5 sm:px-3 py-1 rounded-full flex items-center gap-2 shadow-xl z-20 backdrop-blur-xl">
                    <AnimatedClock className="w-3.5 h-3.5 text-accent-primary" />
                    <span className="hidden sm:block text-[10px] font-black uppercase tracking-widest text-accent-primary leading-none">Comparison Mode</span>
                </div>

                {/* View Mode Toggler - Floating Top Left */}
                <div className="absolute left-4 -top-3.5">
                    <div className="flex bg-bg-secondary border border-border/50 rounded-full p-0.5 shadow-lg backdrop-blur-xl">
                        <button
                            onClick={() => setViewTab('general')}
                            className={cn(
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                viewTab === 'general' ? "bg-accent-primary text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="General Stats"
                        >
                            <Layout className="w-3 h-3" />
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">General</span>
                        </button>
                        <button
                            onClick={() => setViewTab('metrics')}
                            className={cn(
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                viewTab === 'metrics' ? "bg-orange-500 text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="DPS & HPS Metrics"
                        >
                            <Zap className="w-3 h-3" />
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">Metrics</span>
                        </button>
                        <button
                            onClick={() => setViewTab('hits')}
                            className={cn(
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                viewTab === 'hits' ? "bg-red-500 text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="Hit Damage"
                        >
                            <Swords className="w-3 h-3" />
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">Hits</span>
                        </button>
                        <button
                            onClick={() => setViewTab('passives')}
                            className={cn(
                                "p-1.5 rounded-full transition-all flex items-center sm:gap-1.5 sm:px-2",
                                viewTab === 'passives' ? "bg-yellow-500 text-white scale-105 shadow-md" : "text-text-muted hover:text-text-primary"
                            )}
                            title="Secondary Stats"
                        >
                            <Sparkles className="w-3 h-3" />
                            <span className="hidden sm:block text-[8px] font-black uppercase tracking-tighter">Stats</span>
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
                    {viewTab === 'general' ? (
                        <>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Gauge className="w-4 h-4 text-purple-400" />} label="Power" originalValue={originalStats?.power ?? 0} testValue={testStats?.power ?? 0} color="text-purple-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-red-400" />} label="Damage" originalValue={originalStats?.totalDamage ?? 0} testValue={testStats?.totalDamage ?? 0} color="text-red-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-amber-400" />} label="Melee DMG" originalValue={originalStats?.meleeDamage ?? 0} testValue={testStats?.meleeDamage ?? 0} color="text-amber-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Crosshair className="w-4 h-4 text-sky-400" />} label="Ranged DMG" originalValue={originalStats?.rangedDamage ?? 0} testValue={testStats?.rangedDamage ?? 0} color="text-sky-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-green-400" />} label="Health" originalValue={originalStats?.totalHealth ?? 0} testValue={testStats?.totalHealth ?? 0} color="text-green-400" />
                            </div>
                        </>
                    ) : viewTab === 'metrics' ? (
                        <>
                            {/* Grouped Theoretical */}
                            <div className="shrink-0 flex items-center gap-4 p-1.5 bg-white/5 rounded-xl border border-white/5">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-orange-400" />} label="Theo DPS" originalValue={originalDps} testValue={testDps} color="text-orange-400" onTestDetailsClick={() => { if (testStats && testProfile) { setModalData({ stats: testStats, profile: testProfile, variant: 'test' }); setShowDpsModal(true); } }} />
                                <div className="w-px h-6 bg-white/10" />
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Theo HPS" originalValue={originalHps} testValue={testHps} color="text-emerald-400" />
                                <div className="w-px h-6 bg-white/10" />
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-purple-400" />} label="Theo LS/s" originalValue={originalHpsDetails.lifesteal} testValue={testHpsDetails.lifesteal} color="text-purple-400" onOriginalDetailsClick={() => { if (originalFullStats && originalProfile) { openLifestealModal(originalFullStats, originalProfile, 'original'); } }} onTestDetailsClick={() => { if (testFullStats && testProfile) { openLifestealModal(testFullStats, testProfile, 'test'); } }} />
                            </div>

                            {/* Grouped Real-Time */}
                            <div className="shrink-0 flex items-center gap-4 p-1.5 bg-orange-500/5 rounded-xl border border-orange-500/10 ring-1 ring-orange-500/10">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-orange-500" />} label="Real DPS" originalValue={originalDpsDetails.realTotal} testValue={testDpsDetails.realTotal} color="text-orange-500" onTestDetailsClick={() => { if (testStats && testProfile) { setModalData({ stats: testStats, profile: testProfile, variant: 'test' }); setShowDpsModal(true); } }} />
                                <div className="w-px h-6 bg-orange-500/10" />
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-emerald-500" />} label="Real HPS" originalValue={originalRealHps} testValue={testRealHps} color="text-emerald-500" />
                                <div className="w-px h-6 bg-orange-500/10" />
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-purple-500" />} label="Real LS/s" originalValue={originalRealHpsDetails.lifesteal} testValue={testRealHpsDetails.lifesteal} color="text-purple-500" onOriginalDetailsClick={() => { if (originalFullStats && originalProfile) { openLifestealModal(originalFullStats, originalProfile, 'original'); } }} onTestDetailsClick={() => { if (testFullStats && testProfile) { openLifestealModal(testFullStats, testProfile, 'test'); } }} />
                            </div>
                        </>
                    ) : viewTab === 'passives' ? (
                        <>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Star className="w-4 h-4 text-yellow-400" />} label="Crit %" originalValue={originalStats?.criticalChance ?? 0} testValue={testStats?.criticalChance ?? 0} formatFn={formatPercent} color="text-yellow-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-yellow-500" />} label="Crit DMG" originalValue={originalStats?.criticalDamage ?? 0} testValue={testStats?.criticalDamage ?? 0} formatFn={formatMultiplier} color="text-yellow-500" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Shield className="w-4 h-4 text-blue-400" />} label="Block %" originalValue={originalStats?.blockChance ?? 0} testValue={testStats?.blockChance ?? 0} formatFn={formatPercent} color="text-blue-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Zap className="w-4 h-4 text-purple-400" />} label="Double %" originalValue={originalStats?.doubleDamageChance ?? 0} testValue={testStats?.doubleDamageChance ?? 0} formatFn={formatPercent} color="text-purple-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-purple-400" />} label="Lifesteal %" originalValue={originalStats?.lifeSteal ?? 0} testValue={testStats?.lifeSteal ?? 0} formatFn={formatPercent} color="text-purple-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-purple-400" />} label="Regen %" originalValue={originalStats?.healthRegen ?? 0} testValue={testStats?.healthRegen ?? 0} formatFn={formatPercent} color="text-purple-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-orange-400" />} label="Atk Speed" originalValue={originalStats?.attackSpeedMultiplier ?? 0} testValue={testStats?.attackSpeedMultiplier ?? 0} formatFn={formatMultiplier} color="text-orange-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} label="Skill CDR" originalValue={originalStats?.skillCooldownReduction ?? 0} testValue={testStats?.skillCooldownReduction ?? 0} formatFn={formatPercent} color="text-emerald-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-red-400" />} label="Damage %" originalValue={originalStats?.secondaryDamageMulti ?? 0} testValue={testStats?.secondaryDamageMulti ?? 0} formatFn={formatPercent} color="text-red-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Heart className="w-4 h-4 text-green-400" />} label="Health %" originalValue={originalStats?.secondaryHealthMulti ?? 0} testValue={testStats?.secondaryHealthMulti ?? 0} formatFn={formatPercent} color="text-green-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Swords className="w-4 h-4 text-amber-400" />} label="Melee DMG %" originalValue={originalStats?.meleeDamageMultiplier ?? 0} testValue={testStats?.meleeDamageMultiplier ?? 0} formatFn={formatPercent} color="text-amber-400" />
                            </div>
                            <div className="shrink-0">
                                <ComparisonStatRow isCompact={isCompactStats} variant="minimal" icon={<Crosshair className="w-4 h-4 text-sky-400" />} label="Ranged DMG %" originalValue={originalStats?.rangedDamageMultiplier ?? 0} testValue={testStats?.rangedDamageMultiplier ?? 0} formatFn={formatPercent} color="text-sky-400" />
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
                            {testStats && (testStats.hitDamageBuffed !== testStats.hitDamage || originalStats?.hitDamageBuffed !== originalStats?.hitDamage) && (
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


                {!actualHideActions && (
                <div className="flex items-center justify-center gap-1.5 sm:gap-4 w-full pt-2 border-t border-white/5">
                    {/* Load Profile - Small Button with hidden select */}
                    {profiles.length > 1 && (
                        <div className="relative group/load">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 sm:h-10 px-2 flex flex-col items-center justify-center p-0 gap-0.5 text-[9px] text-cyan-400/70 hover:text-cyan-400 hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/20 transition-all font-bold uppercase tracking-tight"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>Load</span>
                            </Button>
                            <select
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                defaultValue=""
                                onChange={(e) => {
                                    const selectedProfile = profiles.find(p => p.id === e.target.value);
                                    if (selectedProfile) {
                                        loadProfileIntoTest(selectedProfile);
                                        e.target.value = '';
                                    }
                                }}
                            >
                                <option value="" disabled>Load Profile...</option>
                                {profiles.filter(p => p.id !== activeProfileId).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
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
                )}

                {isComparing && !actualHideActions && (
                <div className="flex items-center justify-between gap-2 flex-wrap w-full pt-2">
                    {/* Equipped build perfection (far left) */}
                    <div className="flex flex-col gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-bg-input/30 min-w-[120px] shrink-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted/70 text-center">Equipped Perfection</span>
                        <PerfectionMeter value={originalPerfection} className="gap-2" />
                    </div>

                    {/* Auto Test Build controls (center) */}
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted/60 mr-0.5">Auto Test Build</span>
                    <button
                        onClick={() => setRespectSavedLevels(v => !v)}
                        role="switch"
                        aria-checked={respectSavedLevels}
                        title="On: score saved builds at their own level. Off: score everything at level 1, so only secondary stats decide. Equipping always keeps the saved level."
                        className={cn(
                            "h-7 px-2 text-[10px] font-bold rounded border gap-1 inline-flex items-center active:scale-95 transition-all w-fit",
                            respectSavedLevels
                                ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                                : "border-border bg-bg-input/30 text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Layers className="w-3 h-3" />
                        {respectSavedLevels ? 'SAVED LVL' : 'LVL 1'}
                    </button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px] font-bold border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 gap-1 active:scale-95 transition-all w-fit"
                        onClick={() => handleAutoOptimizeTest('dps')}
                        disabled={autoOptimizeDisabled}
                        title="Set best 3 pets + mount for Max DPS on the Test build"
                    >
                        <Sword className="w-3 h-3" />
                        AUTO DPS
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px] font-bold border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40 text-amber-500 gap-1 active:scale-95 transition-all w-fit"
                        onClick={() => handleAutoOptimizeTest('power')}
                        disabled={autoOptimizeDisabled}
                        title="Set best 3 pets + mount for Max Power on the Test build"
                    >
                        <Zap className="w-3 h-3" />
                        AUTO POWER
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px] font-bold border-purple-500/20 hover:bg-purple-500/10 hover:border-purple-500/40 text-purple-400 gap-1 active:scale-95 transition-all w-fit"
                        onClick={() => handleAutoOptimizeTest('lifesteal')}
                        disabled={autoOptimizeDisabled}
                        title="Set best 3 pets + mount for Max Lifesteal/sec on the Test build"
                    >
                        <Heart className="w-3 h-3" />
                        AUTO LIFESTEAL/SEC
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px] font-bold border-violet-500/20 hover:bg-violet-500/10 hover:border-violet-500/40 text-violet-400 gap-1 active:scale-95 transition-all w-fit"
                        onClick={() => handleAutoOptimizeTest('balanced')}
                        disabled={autoOptimizeDisabled}
                        title="Set best 3 pets + mount for a balance of DPS and HPS on the Test build (same scoring as the Loadout Optimizer)"
                    >
                        <Scale className="w-3 h-3" />
                        AUTO BALANCED
                    </Button>
                    {(previousTestPets || previousTestMount !== undefined) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold text-text-muted hover:text-white gap-1 active:scale-95 transition-all w-fit"
                            onClick={handleRevertTest}
                        >
                            <RotateCcw className="w-3 h-3" />
                            REVERT
                        </Button>
                    )}
                    </div>

                    {/* Test build perfection (far right) */}
                    <div className="flex flex-col gap-1 px-2.5 py-1.5 rounded-lg border border-accent-primary/30 bg-accent-primary/5 min-w-[120px] shrink-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-accent-primary/80 text-center">Test Perfection</span>
                        <PerfectionMeter value={testPerfection} className="gap-2" />
                    </div>
                </div>
                )}

                <DpsBreakdownModal
                    isOpen={showDpsModal}
                    onClose={() => setShowDpsModal(false)}
                    stats={modalData?.stats || stats}
                    profile={modalData?.profile || profile}
                    variant={modalData?.variant || 'default'}
                    skillLibrary={skillLibrary}
                />
                <LifestealBreakdownModal
                    isOpen={showLifestealModal}
                    onClose={() => setShowLifestealModal(false)}
                    stats={modalData?.stats || stats}
                    profile={modalData?.profile || profile}
                    variant={modalData?.variant || 'default'}
                />
            </div>
        );
    }

    // Main unified Sidebar/Drawer rendering
    return (
        <Card className={cn(
            "h-full flex flex-col overflow-hidden shadow-2xl transition-all duration-300",
            excludeSubstats
                ? "border-purple-500/20 bg-gradient-to-b from-purple-950/5 to-bg-primary"
                : "border-orange-500/20 bg-gradient-to-b from-orange-950/5 to-bg-primary"
        )}>
            {/* Unified Header */}
            <div className={cn(
                "p-5 border-b transition-all duration-300",
                excludeSubstats
                    ? "border-purple-500/20 bg-purple-950/10"
                    : "border-orange-500/20 bg-orange-950/10"
            )}>
                <div 
                    onClick={() => setExcludeSubstats(!excludeSubstats)}
                    className="flex items-center justify-between mb-4 cursor-pointer select-none hover:opacity-90 transition-opacity"
                    title="Click to toggle between Sheet Stats (excludes substats) and Combat Stats (includes substats)"
                >
                    <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-3">
                        <AnimatedClock className="w-8 h-8 text-accent-primary animate-pulse" />
                        <div className="flex flex-col">
                            <span className="bg-gradient-to-r from-white to-text-muted bg-clip-text text-transparent leading-none">
                                Character Stats
                            </span>
                            <span className={cn(
                                "text-[9px] font-bold tracking-wider mt-1 uppercase",
                                excludeSubstats ? "text-purple-400" : "text-orange-400"
                            )}>
                                {excludeSubstats ? "New Stats (Substats Off)" : "Old Stats (Substats On)"}
                            </span>
                        </div>
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Substats Exclusion Toggle */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setExcludeSubstats(!excludeSubstats);
                            }}
                            className={cn(
                                "p-2 rounded-lg border transition-all shadow-md active:scale-95",
                                excludeSubstats
                                    ? "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20"
                                    : "bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20"
                            )}
                            title={excludeSubstats ? "Current: New Stats (Click to switch to Old)" : "Current: Old Stats (Click to switch to New)"}
                        >
                            <ArrowLeftRight className="w-4 h-4" />
                        </button>

                        {onClose && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                }}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        )}
                    </div>
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

                {!actualHideActions && isComparing && (
                    <div className="mt-4 pt-4 border-t border-border/30 space-y-4">
                        <div className="space-y-3">
                            <div className="text-[10px] text-text-muted text-center font-bold uppercase tracking-widest opacity-60">Build Actions</div>
                            <div className="grid grid-cols-4 gap-2">
                                {/* Load Profile - Small Button with hidden select */}
                                {profiles.length > 1 && (
                                    <div className="relative">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-10 w-full flex flex-col items-center justify-center p-0 gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 grayscale hover:grayscale-0 transition-all font-bold uppercase tracking-tight border border-transparent hover:border-cyan-500/20 bg-cyan-500/5"
                                        >
                                            <Download className="w-4 h-4" />
                                            <span>Load</span>
                                        </Button>
                                        <select
                                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                            defaultValue=""
                                            onChange={(e) => {
                                                const selectedProfile = profiles.find(p => p.id === e.target.value);
                                                if (selectedProfile) {
                                                    loadProfileIntoTest(selectedProfile);
                                                    e.target.value = '';
                                                }
                                            }}
                                        >
                                            <option value="" disabled>Load...</option>
                                            {profiles.filter(p => p.id !== activeProfileId).map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
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
                        {/* Substats Toggle Mode Warning/Notice */}
                        <div className={cn(
                            "p-2.5 rounded-xl border text-xs text-center flex items-center justify-center gap-2 shadow-sm font-semibold select-none cursor-pointer active:scale-98 transition-transform",
                            excludeSubstats
                                ? "bg-purple-500/5 text-purple-400 border-purple-500/20"
                                : "bg-orange-500/5 text-orange-400 border-orange-500/20"
                        )}
                        onClick={() => setExcludeSubstats(!excludeSubstats)}
                        title="Click to toggle calculation basis between New Stats and Old Stats"
                        >
                            <ArrowLeftRight className="w-4 h-4 shrink-0" />
                            <span>Comparing: {excludeSubstats ? 'New Stats (Substats Excluded)' : 'Old Stats (Substats Included)'}</span>
                        </div>
                        <div className="flex bg-bg-secondary border border-border/50 rounded-xl p-1 shadow-lg flex-wrap gap-1">
                            <button
                                onClick={() => setViewTab('general')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider min-w-[70px]",
                                    viewTab === 'general' ? "bg-accent-primary text-white shadow-md" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                <Layout className="w-3.5 h-3.5" />
                                <span>General</span>
                            </button>
                            <button
                                onClick={() => setViewTab('metrics')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider min-w-[70px]",
                                    viewTab === 'metrics' ? "bg-orange-500 text-white shadow-md" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                <Zap className="w-3.5 h-3.5" />
                                <span>Metrics</span>
                            </button>
                            <button
                                onClick={() => setViewTab('hits')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider min-w-[70px]",
                                    viewTab === 'hits' ? "bg-red-500 text-white shadow-md" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                <Swords className="w-3.5 h-3.5" />
                                <span>Hits</span>
                            </button>
                            <button
                                onClick={() => setViewTab('passives')}
                                className={cn(
                                    "flex-1 py-1.5 px-2 rounded-lg transition-all flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider min-w-[70px]",
                                    viewTab === 'passives' ? "bg-yellow-500 text-white shadow-md" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Stats</span>
                            </button>
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
                                {...infoProps(TOTAL_POWER_KEY, 'Total Power', formatValue(stats.power), formatValue)}
                            />
                            {(() => {
                                const formatDetailedBreakdown = (b: any) => {
                                    const parts = [];
                                    if (b.substats > 0) parts.push(`Substats: +${formatPercent(b.substats, 1)}`);
                                    if (b.tree > 0) parts.push(`Tree: +${formatPercent(b.tree, 1)}`);
                                    if (b.ascension > 0) parts.push(`Asc: +${formatPercent(b.ascension, 1)}`);
                                    if (b.skins > 0) parts.push(`Skins: +${formatPercent(b.skins, 1)}`);
                                    if (b.sets > 0) parts.push(`Sets: +${formatPercent(b.sets, 1)}`);
                                    return parts.length > 0 ? parts.join(', ') : null;
                                };

                                return (
                                    <>
                                        <StatRow
                                            icon={<Swords className="w-4 h-4" />}
                                            label="Total Damage"
                                            value={formatValue(stats.totalDamage)}
                                            subValue={`${formatPercent(stats.damageMultiplier || 1, 0)} Total (${formatDetailedBreakdown(stats.damageBreakdown) || 'Base Only'})`}
                                            color="text-red-400"
                                            {...infoProps(TOTAL_DAMAGE_KEY, 'Total Damage', formatValue(stats.totalDamage), formatValue, mulBreakdown('Damage Multiplier', stats.damageMultiplier, stats.damageBreakdown))}
                                        />
                                        <StatRow
                                            icon={<Heart className="w-4 h-4" />}
                                            label="Total Health"
                                            value={formatValue(stats.totalHealth)}
                                            subValue={`${formatPercent(stats.healthMultiplier || 1, 0)} Total (${formatDetailedBreakdown(stats.healthBreakdown) || 'Base Only'})`}
                                            color="text-green-400"
                                            {...infoProps(TOTAL_HEALTH_KEY, 'Total Health', formatValue(stats.totalHealth), formatValue, mulBreakdown('Health Multiplier', stats.healthMultiplier, stats.healthBreakdown))}
                                        />
                                    </>
                                );
                            })()}
                        <div className="space-y-4">
                            {/* Theoretical Block */}
                            <div className="bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                                <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Theoretical Metrics</span>
                                </div>
                                <div className="p-2 space-y-1">
                                    <StatRow
                                        icon={<Zap className="w-4 h-4" />}
                                        label="Theoretical DPS"
                                        value={formatValue(effectiveDps)}
                                        subValue={`Weapon: ${formatCompactNumber(weaponDps)}, Skills: ${formatCompactNumber(stats.skillDps + (stats.skillBuffDps || 0))}`}
                                        color="text-orange-400"
                                        onInfoPointsClick={() => setShowDpsModal(true)}
                                    />
                                    <StatRow
                                        icon={<TrendingUp className="w-4 h-4" />}
                                        label="Theoretical HPS"
                                        value={formatValue(effectiveHps)}
                                        subValue={`Regen: ${formatCompactNumber(currentHpsDetails.regen)}, LifeSteal: ${formatCompactNumber(currentHpsDetails.lifesteal)}, Skills: ${formatCompactNumber(currentHpsDetails.skills)}${currentHpsDetails.blockBenefit > 0 ? `, Block Benefit: +${formatCompactNumber(currentHpsDetails.blockBenefit)}` : ''}`}
                                        color="text-emerald-400"
                                    />
                                    <StatRow
                                        icon={<Heart className="w-4 h-4" />}
                                        label="Lifesteal/sec"
                                        value={formatValue(currentHpsDetails.lifesteal)}
                                        subValue={`Weapon DPS × LifeSteal ${formatPercent(fullStats.lifeSteal)}`}
                                        color="text-purple-400"
                                        onInfoPointsClick={() => setShowLifestealModal(true)}
                                    />
                                </div>
                            </div>

                            {/* Real-Time Block */}
                            <div className="bg-orange-500/5 rounded-xl border border-orange-500/10 overflow-hidden ring-1 ring-orange-500/10">
                                <div className="px-3 py-1.5 bg-orange-500/10 border-b border-orange-500/10 flex items-center gap-2">
                                    <Zap className="w-3 h-3 text-orange-400" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">Real-Time Metrics</span>
                                </div>
                                <div className="p-2 space-y-1">
                                    <StatRow
                                        icon={<Zap className="w-4 h-4" />}
                                        label="Real-Time DPS"
                                        value={formatValue(fullStats.realTotalDps)}
                                        subValue={`Weapon: ${formatCompactNumber(fullStats.realWeaponDps)}, Skills: ${formatCompactNumber(fullStats.skillDps + (fullStats.skillBuffDps || 0))}`}
                                        color="text-orange-500"
                                        onInfoPointsClick={() => setShowDpsModal(true)}
                                    />
                                    <StatRow
                                        icon={<TrendingUp className="w-4 h-4" />}
                                        label="Real-Time HPS"
                                        value={formatValue(realHps)}
                                        subValue={`Regen: ${formatCompactNumber(currentRealHpsDetails.regen)}, LifeSteal: ${formatCompactNumber(currentRealHpsDetails.lifesteal)}, Skills: ${formatCompactNumber(currentRealHpsDetails.skills)}${currentRealHpsDetails.blockBenefit > 0 ? `, Block Benefit: +${formatCompactNumber(currentRealHpsDetails.blockBenefit)}` : ''}`}
                                        color="text-emerald-500"
                                    />
                                    <StatRow
                                        icon={<Heart className="w-4 h-4" />}
                                        label="Lifesteal/sec"
                                        value={formatValue(currentRealHpsDetails.lifesteal)}
                                        subValue={`Weapon DPS × LifeSteal ${formatPercent(fullStats.lifeSteal)}`}
                                        color="text-purple-500"
                                        onInfoPointsClick={() => setShowLifestealModal(true)}
                                    />
                                </div>
                            </div>
                        </div>
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
                                    value={formatValue(fullStats.hitDamage)}
                                    subValue={`Crit: ${formatValue(fullStats.hitDamageCrit)}`}
                                    color="text-red-400"
                                />
                                {fullStats.hitDamageBuffed !== fullStats.hitDamage && (
                                    <StatRow
                                        icon={<Sparkles className="w-4 h-4" />}
                                        label="All Buffs Active"
                                        value={formatValue(fullStats.hitDamageBuffed)}
                                        subValue={`Crit: ${formatValue(fullStats.hitDamageBuffedCrit)}`}
                                        color="text-orange-500"
                                    />
                                )}

                                {/* Grouped Buff Scenarios Card */}
                                {fullStats.buffHitMetrics && fullStats.buffHitMetrics.length > 0 && (
                                    <div className="mt-2 bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                                        <div className="px-3 py-1.5 bg-white/5 border-b border-white/5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Buff Scenarios</span>
                                        </div>
                                        <div className="divide-y divide-white/5">
                                            {fullStats.buffHitMetrics.map((metric, idx) => (
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
                                {(() => {
                                    const formatBreakdown = (breakdown: any, isMultiplier: boolean = false) => {
                                        const parts = [];
                                        if (breakdown.base > 0) parts.push(`Base: ${isMultiplier ? '+' : ''}${formatPercent(breakdown.base, 1)}`);
                                        if (breakdown.substats > 0) parts.push(`Items: +${formatPercent(breakdown.substats, 1)}`);
                                        if (breakdown.tree > 0) parts.push(`Tree: +${formatPercent(breakdown.tree, 1)}`);
                                        if (breakdown.ascension > 0) parts.push(`Asc: +${formatPercent(breakdown.ascension, 1)}`);
                                        return parts.length > 0 ? parts.join(', ') : null;
                                    };

                                    return (
                                        <div className="grid grid-cols-2 gap-2">
                                            <CompactStat
                                                icon={<Star className="w-3 h-3" />}
                                                label="Crit %"
                                                value={formatPercent(stats.criticalChance || 0)}
                                                subValue={formatBreakdown(stats.critChanceBreakdown) ?? undefined}
                                                count={activePerfectionDetails['CriticalChance']?.count}
                                                perf={activePerfectionDetails['CriticalChance']?.avgPerfection}
                                                color="text-yellow-400"
                                                {...infoProps('CriticalChance', 'Crit %', formatPercent(stats.criticalChance || 0))}
                                            />
                                            <CompactStat
                                                icon={<TrendingUp className="w-3 h-3" />}
                                                label="Crit Damage"
                                                value={formatMultiplier(stats.criticalDamage || 0)}
                                                subValue={formatBreakdown(stats.critDamageBreakdown, true) ?? undefined}
                                                count={activePerfectionDetails['CriticalMulti']?.count}
                                                perf={activePerfectionDetails['CriticalMulti']?.avgPerfection}
                                                color="text-yellow-500"
                                                {...infoProps('CriticalMulti', 'Crit Damage', formatMultiplier(stats.criticalDamage || 0), formatMultiplier)}
                                            />
                                            <CompactStat
                                                icon={<Shield className="w-3 h-3" />}
                                                label="Block %"
                                                value={formatPercent(stats.blockChance || 0)}
                                                count={activePerfectionDetails['BlockChance']?.count}
                                                perf={activePerfectionDetails['BlockChance']?.avgPerfection}
                                                color="text-blue-400"
                                                {...infoProps('BlockChance', 'Block %', formatPercent(stats.blockChance || 0))}
                                            />
                                            <CompactStat
                                                icon={<Zap className="w-3 h-3" />}
                                                label="Double %"
                                                value={formatPercent(stats.doubleDamageChance || 0)}
                                                subValue={formatBreakdown(stats.doubleDamageBreakdown) ?? undefined}
                                                count={activePerfectionDetails['DoubleDamageChance']?.count}
                                                perf={activePerfectionDetails['DoubleDamageChance']?.avgPerfection}
                                                color="text-purple-400"
                                                {...infoProps('DoubleDamageChance', 'Double %', formatPercent(stats.doubleDamageChance || 0))}
                                            />
                                            <CompactStat
                                                icon={<Heart className="w-3 h-3" />}
                                                label="Life Steal %"
                                                value={formatPercent(stats.lifeSteal || 0)}
                                                count={activePerfectionDetails['LifeSteal']?.count}
                                                perf={activePerfectionDetails['LifeSteal']?.avgPerfection}
                                                color="text-purple-400"
                                                {...infoProps('LifeSteal', 'Life Steal %', formatPercent(stats.lifeSteal || 0))}
                                            />
                                            <CompactStat
                                                icon={<Heart className="w-3 h-3" />}
                                                label="Health Regen %"
                                                value={formatPercent(stats.healthRegen || 0)}
                                                count={activePerfectionDetails['HealthRegen']?.count}
                                                perf={activePerfectionDetails['HealthRegen']?.avgPerfection}
                                                color="text-purple-400"
                                                {...infoProps('HealthRegen', 'Health Regen %', formatPercent(stats.healthRegen || 0))}
                                            />
                                            <CompactStat
                                                icon={<TrendingUp className="w-3 h-3" />}
                                                label="Attack Speed"
                                                value={formatMultiplier(stats.attackSpeedMultiplier)}
                                                subValue={formatBreakdown(stats.attackSpeedBreakdown, true) ?? undefined}
                                                count={activePerfectionDetails['AttackSpeed']?.count}
                                                perf={activePerfectionDetails['AttackSpeed']?.avgPerfection}
                                                color="text-orange-400"
                                                {...infoProps('AttackSpeed', 'Attack Speed', formatMultiplier(stats.attackSpeedMultiplier), formatMultiplier)}
                                            />
                                            <CompactStat
                                                icon={<TrendingUp className="w-3 h-3" />}
                                                label="Skill CDR %"
                                                value={formatPercent(stats.skillCooldownReduction)}
                                                subValue={formatBreakdown(stats.skillCooldownBreakdown) ?? undefined}
                                                count={activePerfectionDetails['SkillCooldownMulti']?.count}
                                                perf={activePerfectionDetails['SkillCooldownMulti']?.avgPerfection}
                                                color="text-emerald-400"
                                                {...infoProps('SkillCooldownMulti', 'Skill CDR %', formatPercent(stats.skillCooldownReduction))}
                                            />
                                            <CompactStat
                                                icon={<Swords className="w-3 h-3" />}
                                                label="Damage %"
                                                value={formatPercent(stats.secondaryDamageMulti || 0)}
                                                count={activePerfectionDetails['DamageMulti']?.count}
                                                perf={activePerfectionDetails['DamageMulti']?.avgPerfection}
                                                color="text-red-400"
                                                {...infoProps('DamageMulti', 'Damage %', formatPercent(stats.secondaryDamageMulti || 0))}
                                            />
                                            <CompactStat
                                                icon={<Heart className="w-3 h-3" />}
                                                label="Health %"
                                                value={formatPercent(stats.secondaryHealthMulti || 0)}
                                                count={activePerfectionDetails['HealthMulti']?.count}
                                                perf={activePerfectionDetails['HealthMulti']?.avgPerfection}
                                                color="text-green-400"
                                                {...infoProps('HealthMulti', 'Health %', formatPercent(stats.secondaryHealthMulti || 0))}
                                            />
                                            <CompactStat
                                                icon={<Swords className="w-3 h-3" />}
                                                label="Melee DMG %"
                                                value={formatPercent(stats.meleeDamageMultiplier || 0)}
                                                count={activePerfectionDetails['MeleeDamageMulti']?.count}
                                                perf={activePerfectionDetails['MeleeDamageMulti']?.avgPerfection}
                                                color="text-amber-400"
                                                {...infoProps('MeleeDamageMulti', 'Melee DMG %', formatPercent(stats.meleeDamageMultiplier || 0))}
                                            />
                                            <CompactStat
                                                icon={<Crosshair className="w-3 h-3" />}
                                                label="Ranged DMG %"
                                                value={formatPercent(stats.rangedDamageMultiplier || 0)}
                                                count={activePerfectionDetails['RangedDamageMulti']?.count}
                                                perf={activePerfectionDetails['RangedDamageMulti']?.avgPerfection}
                                                color="text-sky-400"
                                                {...infoProps('RangedDamageMulti', 'Ranged DMG %', formatPercent(stats.rangedDamageMultiplier || 0))}
                                            />
                                        </div>
                                    );
                                })()}

                                <StatRow
                                    icon={<Swords className="w-3 h-3" />}
                                    label="Skill Damage %"
                                    value={formatMultiplier(stats.skillDamageMultiplier)}
                                    subValue={(() => {
                                        const b = stats.skillDamageBreakdown;
                                        const parts = [];
                                        if (b.substats > 0) parts.push(`Items: +${formatPercent(b.substats, 1)}`);
                                        if (b.tree > 0) parts.push(`Tree: +${formatPercent(b.tree, 1)}`);
                                        if (b.ascension > 0) parts.push(`Asc: +${formatPercent(b.ascension, 1)}`);
                                        return parts.join(', ');
                                    })()}
                                    count={activePerfectionDetails['SkillDamageMulti']?.count}
                                    perf={activePerfectionDetails['SkillDamageMulti']?.avgPerfection}
                                    color="text-red-400"
                                    {...infoProps('SkillDamageMulti', 'Skill Damage %', formatMultiplier(stats.skillDamageMultiplier), formatMultiplier)}
                                />
                                <StatRow
                                    icon={<Swords className="w-3 h-3" />}
                                    label="Overall Damage Multi"
                                    value={formatPercent(stats.damageMultiplier, 0)}
                                    subValue={(() => {
                                        const b = stats.damageBreakdown;
                                        const parts = [];
                                        if (b.substats > 0) parts.push(`Items: +${formatPercent(b.substats, 1)}`);
                                        if (b.tree > 0) parts.push(`Tree: +${formatPercent(b.tree, 1)}`);
                                        if (b.ascension > 0) parts.push(`Asc: +${formatPercent(b.ascension, 1)}`);
                                        if (b.skins > 0) parts.push(`Skins: +${formatPercent(b.skins, 1)}`);
                                        if (b.sets > 0) parts.push(`Sets: +${formatPercent(b.sets, 1)}`);
                                        return parts.length > 0 ? parts.join(', ') : 'Base Only';
                                    })()}
                                    color="text-red-400"
                                />
                                <StatRow
                                    icon={<Heart className="w-3 h-3" />}
                                    label="Health Multiplier %"
                                    value={formatPercent(stats.healthMultiplier, 0)}
                                    subValue={(() => {
                                        const b = stats.healthBreakdown;
                                        const parts = [];
                                        if (b.substats > 0) parts.push(`Items: +${formatPercent(b.substats, 1)}`);
                                        if (b.tree > 0) parts.push(`Tree: +${formatPercent(b.tree, 1)}`);
                                        if (b.ascension > 0) parts.push(`Asc: +${formatPercent(b.ascension, 1)}`);
                                        if (b.skins > 0) parts.push(`Skins: +${formatPercent(b.skins, 1)}`);
                                        if (b.sets > 0) parts.push(`Sets: +${formatPercent(b.sets, 1)}`);
                                        return parts.length > 0 ? parts.join(', ') : 'Base Only';
                                    })()}
                                    color="text-emerald-400"
                                />
                                <StatRow
                                    icon={<TrendingUp className="w-4 h-4 text-text-primary" />}
                                    label="Theo HPS"
                                    value={formatCompactNumber(effectiveHps)}
                                    subValue={`Regen: ${formatCompactNumber(currentHpsDetails.regen)}, Life: ${formatCompactNumber(currentHpsDetails.lifesteal)}, Skills: ${formatCompactNumber(currentHpsDetails.skills)}`}
                                    color="text-emerald-400"
                                />
                                <StatRow
                                    icon={<TrendingUp className="w-4 h-4 text-text-primary" />}
                                    label="Real HPS"
                                    value={formatCompactNumber(realHps)}
                                    subValue={`Regen: ${formatCompactNumber(currentRealHpsDetails.regen)}, Life: ${formatCompactNumber(currentRealHpsDetails.lifesteal)}, Skills: ${formatCompactNumber(currentRealHpsDetails.skills)}`}
                                    color="text-emerald-500"
                                />
                                <StatRow
                                    icon={<Heart className="w-4 h-4 text-purple-400" />}
                                    label="Theo Lifesteal/sec"
                                    value={formatCompactNumber(currentHpsDetails.lifesteal)}
                                    subValue={`Weapon DPS × LifeSteal ${formatPercent(fullStats.lifeSteal)}`}
                                    color="text-purple-400"
                                    onInfoPointsClick={() => setShowLifestealModal(true)}
                                />
                                <StatRow
                                    icon={<Heart className="w-4 h-4 text-purple-500" />}
                                    label="Real Lifesteal/sec"
                                    value={formatCompactNumber(currentRealHpsDetails.lifesteal)}
                                    subValue={`Weapon DPS × LifeSteal ${formatPercent(fullStats.lifeSteal)}`}
                                    color="text-purple-500"
                                    onInfoPointsClick={() => setShowLifestealModal(true)}
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
                                 <StatRow icon={<Target className="w-4 h-4" />} label="Is Aiming" value={stats.isAiming ? 'Yes' : 'No'} color="text-cyan-400" />
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
                                        <StatRow
                                            icon={<Target className="w-4 h-4" />}
                                            label="Affected By Gravity"
                                            value={stats.projectileAffectedByGravity ? 'Yes' : 'No'}
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
                stats={modalData?.stats || fullStats}
                profile={modalData?.profile || profile}
                variant={modalData?.variant || 'default'}
                skillLibrary={skillLibrary}
            />
            <LifestealBreakdownModal
                isOpen={showLifestealModal}
                onClose={() => { setShowLifestealModal(false); setModalData(null); }}
                stats={modalData?.stats || fullStats}
                profile={modalData?.profile || profile}
                variant={modalData?.variant || 'default'}
            />
            <StatSourcesModal
                isOpen={!!sourceModal}
                onClose={() => setSourceModal(null)}
                statKey={sourceModal?.key ?? null}
                label={sourceModal?.label ?? ''}
                totalDisplay={sourceModal?.total ?? ''}
                stats={stats}
                formatValue={sourceModal?.format ?? formatPercent}
                multiplier={sourceModal?.multiplier}
            />
        </Card>
    );
}
