import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../UI/Button';
import { X, TrendingUp, Zap, Hash, Swords, Sparkles, HelpCircle } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { UserProfile } from '../../types/Profile';
import { formatPercent, formatCompactNumber } from '../../utils/statsCalculator';
import { doubleSecondStrikeSeconds, weaponHitsPerSecond } from '../../utils/constants';
import { BreakpointTables, BreakpointExplanation } from './BreakpointTables';
import { cn } from '../../lib/utils';
import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';

import { formatNumber } from '../../utils/format';
import { EngineCheckSection } from './EngineCheckSection';
import { useEngineCheck } from '../../hooks/useEngineCheck';
import { TESTED_SECONDS } from '../../engine/dummyRun';

/** How far above the current attack speed the next breakpoint is searched, in % points. */
const BREAKPOINT_SCAN_PCT = 1000;

/**
 * The next attack-speed value that makes the weapon hit faster (constants.weaponHitsPerSecond:
 * the engine's tick-stepped single and double cycles), scanned in 0.1% steps.
 */
function nextAttackSpeedBreakpoint(stats: AggregatedStats): { bonusPct: number; needPct: number; hitsPerSecond: number } | null {
    const d = Math.min(Math.max(stats.doubleDamageChance, 0), 1);
    const w = stats.weaponWindupTime || 0.5;
    const dur = stats.weaponAttackDuration || 1.5;
    const cur = stats.attackSpeedMultiplier;
    const base = weaponHitsPerSecond(cur, w, dur, d);
    const startPct = Math.floor((cur - 1) * 1000 + 1e-9) / 10;
    for (let p = startPct + 0.1; p <= startPct + BREAKPOINT_SCAN_PCT; p = Math.round((p + 0.1) * 10) / 10) {
        const h = weaponHitsPerSecond(1 + p / 100, w, dur, d);
        if (h > base + 1e-12) return { bonusPct: p, needPct: p - (cur - 1) * 100, hitsPerSecond: h };
    }
    return null;
}

interface DpsBreakdownModalProps {
    isOpen: boolean;
    onClose: () => void;
    stats: AggregatedStats;
    profile: UserProfile;
    skillLibrary: any;
    variant?: 'default' | 'original' | 'test';
}

// Internal component to handle content and memoization to prevent flickering
const ModalContent = memo(({ stats, profile, skillLibrary, onClose, variant = 'default' }: Omit<DpsBreakdownModalProps, 'isOpen'>) => {
    const { updateNestedProfile } = useProfile();
    const { isComparing, originalUseSkinWindup, testUseSkinWindup, updateOriginalUseSkinWindup, updateTestUseSkinWindup } = useComparison();
    
    const [showFullNumbers, setShowFullNumbers] = useState(false);
    const [showBreakpoints, setShowBreakpoints] = useState(false);

    // Local helper for compact formatting of large values
    const formatVal = (val: number, decimals: number = 0) => {
        if (showFullNumbers) return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
        return formatNumber(val);
    };

    const hasSkin = !!profile.items.Weapon?.skin;
    const currentUseSkinWindup = useMemo(() => {
        if (isComparing) {
            if (variant === 'original') return originalUseSkinWindup !== false;
            if (variant === 'test') return testUseSkinWindup !== false;
        }
        return profile.misc.useSkinWindup !== false;
    }, [isComparing, variant, originalUseSkinWindup, testUseSkinWindup, profile.misc.useSkinWindup]);

    const handleToggleSkinWindup = (val: boolean) => {
        if (isComparing) {
            if (variant === 'original') updateOriginalUseSkinWindup(val);
            else if (variant === 'test') updateTestUseSkinWindup(val);
        } else {
            updateNestedProfile('misc', { useSkinWindup: val });
        }
    };

    // --- WEAPON DPS (theoretical): the weapon's own hits only, no skills ---
    // Stepped to the engine's 0.1 s ticks (statEngine realWeaponDps): the single cycle is
    // ceil(D/inc)+1 ticks, a double re-seeds the timer to floor(0.75W), crit is averaged.
    const critMult = 1 + Math.min(stats.criticalChance, 1) * (stats.criticalDamage - 1);
    const speedBonus = stats.attackSpeedMultiplier;
    const effectiveWindup = stats.weaponWindupTime / speedBonus;
    const hitsPerSecond = stats.realAps;
    const weaponDps = stats.realWeaponDps;
    const realCycleTime = stats.realCycleTime;
    const next = useMemo(() => nextAttackSpeedBreakpoint(stats), [stats]);
    const check = useEngineCheck(stats, profile.skills?.equipped || [], skillLibrary);
    const tested = check.result?.tested;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div className="bg-bg-primary w-full max-w-[calc(100vw-1rem)] md:max-w-4xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 border-b border-border bg-bg-secondary/40 gap-4">
                    <div className="flex items-center justify-between w-full sm:w-auto shrink min-w-0">
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-orange-400 shrink-0" />
                            <div className="min-w-0">
                                <h3 className="text-base md:text-xl font-bold text-white tracking-tight whitespace-nowrap overflow-hidden text-clip">DPS Breakdown</h3>
                                <p className="text-[8px] md:text-[10px] text-white/40 font-mono uppercase tracking-[0.1em] whitespace-nowrap overflow-hidden text-clip">Weapon formula and 24 h test</p>
                            </div>
                        </div>
                        
                        {/* Mobile-only close to keep header balanced */}
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white sm:hidden shrink-0">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:justify-end overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                        <div className="flex items-center bg-bg-secondary rounded-lg p-1 border border-border/40 shrink-0">
                             <button 
                                onClick={() => setShowBreakpoints(!showBreakpoints)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 shrink-0",
                                    showBreakpoints ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'
                                )}
                                title="View Attack Speed Thresholds"
                            >
                                <Zap className="w-3 h-3" />
                                <span>Breakpoints</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                            <button 
                                onClick={() => setShowFullNumbers(!showFullNumbers)} 
                                className={cn(
                                    "p-2 rounded-lg transition-all flex items-center gap-2",
                                    showFullNumbers ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30' : 'hover:bg-white/5 text-white/40 hover:text-white/60'
                                )}
                                title={showFullNumbers ? "Switch to Compact Numbers" : "Show Full Numbers"}
                            >
                                <Hash className="w-4 h-4 md:w-5 md:h-5" />
                                <span className={cn(showFullNumbers ? "inline" : "hidden lg:inline", "text-[10px] uppercase font-bold tracking-wider")}>
                                    {showFullNumbers ? 'Full' : 'Compact'}
                                </span>
                            </button>
                            <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white hidden sm:block">
                                <X className="w-5 h-5 md:w-6 md:h-6" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Animation Toggle Bar - Compact */}
                {hasSkin && (
                    <div className="px-4 py-2 bg-accent-primary/5 border-b border-accent-primary/10 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary/80">Skin Performance Optimization</span>
                        </div>
                        <label 
                            htmlFor={`modal-toggle-skin-windup-${variant}`}
                            className="flex items-center gap-2 cursor-pointer group/toggle-modal"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <span className="text-[10px] font-bold text-text-muted group-hover/toggle-modal:text-accent-primary transition-colors">Use Skin Animation Speed</span>
                            <div className="relative inline-flex items-center">
                                <input 
                                    type="checkbox" 
                                    checked={currentUseSkinWindup}
                                    onChange={(e) => handleToggleSkinWindup(e.target.checked)}
                                    className="sr-only peer"
                                    id={`modal-toggle-skin-windup-${variant}`}
                                />
                                <div className="w-7 h-4 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent-primary border border-border/50" />
                            </div>
                        </label>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 md:space-y-10 custom-scrollbar bg-bg-primary font-sans">
                    {/* What the two figures are */}
                    <div className="bg-bg-input/60 rounded-xl p-3 md:p-4 border border-dashed border-white/10 flex gap-3" data-testid="dps-explainer">
                        <HelpCircle className="w-5 h-5 text-orange-300 shrink-0 mt-0.5" />
                        <div className="text-[10px] md:text-[11px] text-white/60 leading-relaxed space-y-1.5">
                            <p><strong className="text-orange-300">Weapon DPS (theoretical)</strong> is a formula for your weapon alone: damage x hits per second x average crit. Hits per second follow the game's 0.1 s attack breakpoints and your double chance. No skills are in it.</p>
                            <p><strong className="text-emerald-300">Tested DPS ({TESTED_SECONDS / 3600} h simulation)</strong> is measured: the real combat engine runs your whole build for {TESTED_SECONDS / 3600} hours of game time against a dummy with infinite health and the damage is averaged per second. It adds everything the formula leaves out: each skill with its real cooldown and uptime, buffs on your hits, and the luck of crit and double rolls averaged over hundreds of thousands of attacks.</p>
                            <p className="text-white/40">The gap between the two is what your skills add. Use the tested figure to compare builds.</p>
                        </div>
                    </div>

                    {/* Weapon Section */}
                    <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center gap-3 text-orange-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-orange-500/20 pb-3 font-sans">
                            <Swords className="w-4 h-4 md:w-5 md:h-5" />
                            Weapon DPS (theoretical)
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">Attack cycle</div>
                                <div className="flex justify-between items-baseline gap-2">
                                    <span className="text-[11px] text-white/60">Damage per hit</span>
                                    <span className="text-base md:text-lg font-mono font-bold text-white break-all">{formatVal(stats.totalDamage)}</span>
                                </div>
                                <div className="space-y-2 pt-3 border-t border-white/5 text-[11px] md:text-xs">
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Base duration</span><span className="font-mono text-white/60">{stats.weaponAttackDuration.toFixed(2)}s</span></div>
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Base windup</span><span className="font-mono text-white/60">{stats.weaponWindupTime.toFixed(2)}s</span></div>
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Attack speed</span><span className="font-mono text-white/80">{speedBonus.toFixed(3)}x</span></div>
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Windup</span><span className="font-mono text-white/80">{effectiveWindup.toFixed(2)}s</span></div>
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Single cycle (ticks)</span><span className="font-mono text-orange-400 font-bold">{realCycleTime.toFixed(1)}s</span></div>
                                    <div className="flex justify-end text-[10px] md:text-[11px] text-orange-400 font-bold pt-1 font-mono">Hits/s: {hitsPerSecond.toFixed(3)}</div>
                                </div>
                            </div>

                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">Critical</div>
                                <div className="space-y-2 text-[11px] md:text-xs">
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Chance</span><span className="font-mono text-white font-bold">{formatPercent(stats.criticalChance)}</span></div>
                                    <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-white/30 pl-2 font-mono">
                                        <span>Tree: {formatPercent(stats.critChanceBreakdown.tree)}</span>
                                        <span>Items: {formatPercent(stats.critChanceBreakdown.substats)}</span>
                                    </div>
                                    <div className="flex justify-between items-baseline pt-2 border-t border-white/5"><span className="text-white/40">Damage</span><span className="font-mono text-white font-bold">{formatPercent(stats.criticalDamage, 0)}</span></div>
                                    <div className="flex justify-end text-[10px] md:text-[11px] text-orange-400 font-bold pt-1 font-mono">Average: {critMult.toFixed(3)}x</div>
                                    {stats.criticalChance > 1 && (
                                        <div className="text-[8px] md:text-[9px] text-white/30 italic text-center font-mono">Every hit crits; the {formatPercent(stats.criticalChance - 1)} past 100% does nothing</div>
                                    )}
                                </div>
                            </div>

                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">Double strike</div>
                                <div className="space-y-2 text-[11px] md:text-xs">
                                    <div className="flex justify-between items-baseline"><span className="text-white/40">Chance</span><span className="font-mono text-white font-bold">{formatPercent(stats.doubleDamageChance)}</span></div>
                                    <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-white/30 pl-2 font-mono">
                                        <span>Tree: {formatPercent(stats.doubleDamageBreakdown.tree)}</span>
                                        <span>Items: {formatPercent(stats.doubleDamageBreakdown.substats)}</span>
                                    </div>
                                    {stats.doubleDamageChance > 0 && (
                                        <>
                                            <div className="flex justify-between items-baseline pt-2 border-t border-white/5"><span className="text-white/40">2nd strike after</span><span className="font-mono text-orange-400 font-bold">{doubleSecondStrikeSeconds(speedBonus, stats.weaponWindupTime).toFixed(1)}s</span></div>
                                            <div className="flex justify-between items-baseline"><span className="text-white/40">Double cycle</span><span className="font-mono text-white/80">{stats.realDoubleHitCycle.toFixed(1)}s</span></div>
                                        </>
                                    )}
                                    <div className="text-[8px] md:text-[9px] text-white/30 italic pt-1 text-center font-mono">Doubles are extra hits, already in hits/s</div>
                                    {stats.doubleDamageChance > 1 && (
                                        <div className="text-[8px] md:text-[9px] text-white/30 italic text-center font-mono">Every attack doubles; the {formatPercent(stats.doubleDamageChance - 1)} past 100% does nothing</div>
                                    )}
                                </div>
                            </div>

                            {/* Result + breakpoints */}
                            <div className="bg-orange-500/10 rounded-2xl p-4 md:p-6 border border-orange-500/20 sm:col-span-2 lg:col-span-3">
                                {showBreakpoints ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b border-orange-500/20 pb-3 gap-3">
                                            <div className="text-[10px] uppercase text-orange-400 font-bold tracking-[0.1em]">Attack speed breakpoints for a {stats.weaponAttackDuration.toFixed(1)}s weapon</div>
                                            <button onClick={() => setShowBreakpoints(false)} className="text-[10px] text-white/40 hover:text-white/60 uppercase font-bold shrink-0">Back</button>
                                        </div>
                                        <div className="overflow-x-auto custom-scrollbar">
                                            <BreakpointTables
                                                weaponAttackDuration={stats.weaponAttackDuration}
                                                weaponWindupTime={stats.weaponWindupTime}
                                                currentAttackSpeedMultiplier={stats.attackSpeedMultiplier}
                                                realCycleTime={stats.realCycleTime}
                                                realWindup={stats.weaponWindupTime / stats.attackSpeedMultiplier}
                                                doubleDamageChance={stats.doubleDamageChance}
                                            />
                                            <BreakpointExplanation />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                                            <div className="min-w-0">
                                                <div className="text-[9px] md:text-[10px] uppercase text-orange-400 font-bold tracking-widest mb-1">Weapon DPS (theoretical)</div>
                                                <div className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold text-orange-400 break-all" data-testid="weapon-dps">{formatVal(weaponDps)}</div>
                                            </div>
                                            <div className="text-left md:text-right text-[10px] md:text-[11px] text-white/40 font-mono leading-relaxed">
                                                Dmg({formatVal(stats.totalDamage)}) x Hits/s({hitsPerSecond.toFixed(3)}) x Crit({critMult.toFixed(3)})
                                            </div>
                                        </div>
                                        <div className="pt-3 border-t border-orange-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="next-breakpoint">
                                            <div className="text-[10px] md:text-[11px] text-white/60 leading-relaxed min-w-0">
                                                {next ? (
                                                    <>Next breakpoint at <strong className="text-orange-300">+{next.bonusPct.toFixed(1)}% attack speed</strong> ({next.needPct.toFixed(1)} points more than your +{((speedBonus - 1) * 100).toFixed(1)}%): {next.hitsPerSecond.toFixed(3)} hits/s, weapon DPS {formatVal(stats.totalDamage * next.hitsPerSecond * critMult)} (+{((next.hitsPerSecond / hitsPerSecond - 1) * 100).toFixed(1)}%).</>
                                                ) : (
                                                    <>No faster breakpoint within +{BREAKPOINT_SCAN_PCT}% attack speed: every hit already lands on the fastest tick.</>
                                                )}
                                            </div>
                                            <button onClick={() => setShowBreakpoints(true)} className="shrink-0 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 flex items-center gap-1.5 w-fit">
                                                <Zap className="w-3 h-3" /> All breakpoints
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    <EngineCheckSection
                        stats={stats}
                        equipped={profile.skills?.equipped || []}
                        skillLibrary={skillLibrary}
                        formatVal={v => formatVal(v)}
                        mode="dps"
                        weaponTheoretical={weaponDps}
                        check={check}
                    />
                </div>

                {/* Footer */}
                <div className="p-4 md:p-6 border-t border-border bg-bg-secondary flex flex-col md:flex-row gap-4 md:items-center font-mono">
                    <div className="flex-1 flex flex-wrap items-end justify-between md:justify-start gap-x-6 gap-y-3 md:gap-10 min-w-0">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider leading-none mb-1 font-sans">Weapon DPS (theoretical)</span>
                            <span className="text-lg md:text-2xl font-bold text-orange-400 leading-none whitespace-nowrap overflow-hidden text-clip">{formatVal(weaponDps)}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-emerald-400 font-bold tracking-widest bg-emerald-500/10 px-2 py-1 rounded-md mb-1 leading-none font-sans w-fit">Tested DPS ({TESTED_SECONDS / 3600} h)</span>
                            <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white leading-none mt-1 break-all" data-testid="footer-tested-dps">
                                {tested ? formatVal(tested.dps) : check.status === 'error' ? 'n/a' : `${Math.round(((check.status === 'loading' && check.progress) || 0) * 100)}%`}
                            </span>
                        </div>
                    </div>
                    <Button onClick={onClose} variant="primary" className="w-full md:w-auto px-8 py-2 md:py-3 text-sm md:text-base shadow-xl active:scale-95 transition-all shrink-0">Close</Button>
                </div>
            </div>
        </div>
    );
});

ModalContent.displayName = 'ModalContent';

export const DpsBreakdownModal = memo(({ isOpen, onClose, stats, profile, skillLibrary, variant }: DpsBreakdownModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <ModalContent 
            stats={stats} 
            profile={profile} 
            skillLibrary={skillLibrary} 
            onClose={onClose} 
            variant={variant}
        />,
        document.body
    );
});
