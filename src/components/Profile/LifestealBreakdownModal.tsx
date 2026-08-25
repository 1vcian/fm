import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../UI/Button';
import { X, Heart, Hash } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { UserProfile } from '../../types/Profile';
import { formatPercent } from '../../utils/statsCalculator';
import { cn } from '../../lib/utils';

import { formatNumber } from '../../utils/format';

interface LifestealBreakdownModalProps {
    isOpen: boolean;
    onClose: () => void;
    stats: AggregatedStats;
    profile: UserProfile;
    variant?: 'default' | 'original' | 'test';
}

// Internal component to handle content and memoization to prevent flickering
const ModalContent = memo(({ stats, onClose, variant = 'default' }: Omit<LifestealBreakdownModalProps, 'isOpen'>) => {
    const [showFullNumbers, setShowFullNumbers] = useState(false);
    const [useRealTime, setUseRealTime] = useState(true);

    // Local helper for compact formatting of large values
    const formatVal = (val: number, decimals: number = 0) => {
        if (showFullNumbers) return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
        return formatNumber(val);
    };

    // --- LIFESTEAL CALCULATIONS ---
    const { sourceWeaponDps, lifeStealPct, rawLifesteal, blockChance, blockFactor, effectiveLifesteal } = useMemo(() => {
        const weaponDps = useRealTime ? stats.realWeaponDps : stats.weaponDps;
        const lsPct = stats.lifeSteal;
        const raw = weaponDps * lsPct;
        const bChance = Math.min(stats.blockChance || 0, 0.95);
        const bFactor = 1 / (1 - bChance);
        const effective = raw * bFactor;

        return {
            sourceWeaponDps: weaponDps,
            lifeStealPct: lsPct,
            rawLifesteal: raw,
            blockChance: bChance,
            blockFactor: bFactor,
            effectiveLifesteal: effective
        };
    }, [stats, useRealTime]);

    const hasLifesteal = lifeStealPct > 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div className="bg-bg-primary w-full max-w-[calc(100vw-1rem)] md:max-w-3xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 border-b border-border bg-bg-secondary/40 gap-4">
                    <div className="flex items-center justify-between w-full sm:w-auto shrink min-w-0">
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <Heart className="w-5 h-5 md:w-6 md:h-6 text-purple-400 shrink-0" />
                            <div className="min-w-0">
                                <h3 className="text-base md:text-xl font-bold text-white tracking-tight whitespace-nowrap overflow-hidden text-clip">Lifesteal/sec Breakdown</h3>
                                <p className="text-[8px] md:text-[10px] text-white/40 font-mono uppercase tracking-[0.1em] whitespace-nowrap overflow-hidden text-clip">Math Analysis</p>
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
                                onClick={() => setUseRealTime(false)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all shrink-0",
                                    !useRealTime ? 'bg-purple-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'
                                )}
                            >
                                <span>Theoretical</span>
                            </button>
                            <button
                                onClick={() => setUseRealTime(true)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all shrink-0",
                                    useRealTime ? 'bg-purple-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'
                                )}
                            >
                                <span>Real-Time</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                            <button
                                onClick={() => setShowFullNumbers(!showFullNumbers)}
                                className={cn(
                                    "p-2 rounded-lg transition-all flex items-center gap-2",
                                    showFullNumbers ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30' : 'hover:bg-white/5 text-white/40 hover:text-white/60'
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

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 md:space-y-10 custom-scrollbar bg-bg-primary font-sans">
                    <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center gap-3 text-purple-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-purple-500/20 pb-3 font-sans">
                            <Heart className="w-4 h-4 md:w-5 md:h-5" />
                            Lifesteal Scaling
                        </div>

                        {hasLifesteal ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                {/* Source Power */}
                                <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                    <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">Source Power</div>
                                    <div className="flex justify-between items-baseline gap-2">
                                        <span className="text-[11px] text-white/60">{useRealTime ? 'Real-Time' : 'Theoretical'} Weapon DPS</span>
                                        <span className="text-base md:text-lg font-mono font-bold text-white break-all">{formatVal(sourceWeaponDps)}</span>
                                    </div>
                                    <div className="pt-3 border-t border-white/5 text-[9px] md:text-[10px] text-white/30 italic leading-relaxed">
                                        Lifesteal applies to weapon hits only. Skill damage does not lifesteal.
                                    </div>
                                </div>

                                {/* LifeSteal % */}
                                <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                    <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">LifeSteal %</div>
                                    <div className="flex justify-between items-baseline gap-2">
                                        <span className="text-[11px] text-white/60">Chance / Ratio</span>
                                        <span className="text-base md:text-lg font-mono font-bold text-purple-400 break-all">{formatPercent(lifeStealPct)}</span>
                                    </div>
                                </div>

                                {/* Result */}
                                <div className="bg-purple-500/10 rounded-2xl p-4 md:p-6 border border-purple-500/20 sm:col-span-2 group transition-all hover:bg-purple-500/[0.12]">
                                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                                        <div className="min-w-0 text-left">
                                            <div className="text-[9px] md:text-[10px] uppercase text-purple-400 font-bold tracking-widest mb-1 font-sans">
                                                Raw {useRealTime ? 'Real-Time' : 'Theoretical'} Lifesteal/sec
                                            </div>
                                            <div className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold text-purple-400 drop-shadow-[0_0_15px_rgba(192,132,252,0.2)] break-all">
                                                {formatVal(rawLifesteal)}
                                            </div>
                                        </div>
                                        <div className="text-left md:text-right text-[10px] md:text-[11px] text-white/30 font-mono leading-relaxed max-w-sm flex flex-wrap md:flex-col gap-x-2">
                                            <div className="text-purple-300/40 font-bold uppercase text-[8px] md:text-[9px] w-full mb-1">Calculation:</div>
                                            <span className="whitespace-nowrap">WeaponDPS({formatVal(sourceWeaponDps)}) ×</span>
                                            <span className="whitespace-nowrap">LifeSteal({formatPercent(lifeStealPct)})</span>
                                        </div>
                                    </div>

                                    {blockChance > 0 && (
                                        <div className="mt-4 pt-4 border-t border-purple-500/20 flex flex-col md:flex-row md:justify-between md:items-center gap-2">
                                            <div className="text-[10px] md:text-[11px] text-white/40 font-mono">
                                                Block Amplification: <span className="text-purple-300 font-bold">×{blockFactor.toFixed(2)}</span> ({formatPercent(blockChance)} block)
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider font-sans">Effective Lifesteal/sec</div>
                                                <div className="text-base md:text-lg font-mono font-bold text-purple-300">{formatVal(effectiveLifesteal)}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-10 bg-bg-input/20 rounded-2xl border border-dashed border-white/10 text-white/30 text-[11px] italic font-mono">
                                No lifesteal on this build
                            </div>
                        )}
                    </section>
                </div>

                {/* Footer */}
                <div className="p-4 md:p-6 border-t border-border bg-bg-secondary flex flex-col md:flex-row gap-4 md:items-center font-mono">
                    <div className="flex-1 flex flex-wrap items-center justify-between md:justify-start gap-x-4 gap-y-3 md:gap-8 min-w-0">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-purple-400 font-bold tracking-widest bg-purple-500/10 px-2 py-1 rounded-md mb-1 leading-none font-sans w-fit">
                                Total {useRealTime ? 'Real-Time' : 'Theoretical'} Lifesteal/sec
                            </span>
                            <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] leading-none mt-1 break-all">
                                {formatVal(rawLifesteal)}
                            </span>
                        </div>
                        {blockChance > 0 && (
                            <div className="flex flex-col min-w-0">
                                <span className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider leading-none mb-1 font-sans">Effective (Block-Amplified)</span>
                                <span className="text-sm md:text-xl font-bold text-purple-300 leading-none whitespace-nowrap overflow-hidden text-clip">
                                    {formatVal(effectiveLifesteal)}
                                </span>
                            </div>
                        )}
                    </div>
                    <Button onClick={onClose} variant="primary" className="w-full md:w-auto px-8 py-2 md:py-3 text-sm md:text-base shadow-xl active:scale-95 transition-all shrink-0">Close</Button>
                </div>
            </div>
        </div>
    );
});

ModalContent.displayName = 'ModalContent';

export const LifestealBreakdownModal = memo(({ isOpen, onClose, stats, profile, variant }: LifestealBreakdownModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <ModalContent
            stats={stats}
            profile={profile}
            onClose={onClose}
            variant={variant}
        />,
        document.body
    );
});
