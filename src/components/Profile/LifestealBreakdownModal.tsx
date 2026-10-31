import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../UI/Button';
import { X, Hash } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { UserProfile } from '../../types/Profile';
import { formatPercent } from '../../utils/statsCalculator';
import { cn } from '../../lib/utils';

import { formatNumber } from '../../utils/format';
import { EngineCheckSection } from './EngineCheckSection';
import { useEngineCheck } from '../../hooks/useEngineCheck';
import { TESTED_SECONDS } from '../../engine/dummyRun';
import { GameAssetIcon } from '../UI/GameAssetIcon';

interface LifestealBreakdownModalProps {
    isOpen: boolean;
    onClose: () => void;
    stats: AggregatedStats;
    profile: UserProfile;
    /** SkillLibrary config: the tested run needs the equipped skills. */
    skillLibrary?: any;
    variant?: 'default' | 'original' | 'test';
}

// Internal component to handle content and memoization to prevent flickering
const ModalContent = memo(({ stats, profile, skillLibrary, onClose }: Omit<LifestealBreakdownModalProps, 'isOpen'>) => {
    const [showFullNumbers, setShowFullNumbers] = useState(false);

    const formatVal = (val: number, decimals: number = 0) => {
        if (showFullNumbers) return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
        return formatNumber(val);
    };

    // --- WEAPON HPS (theoretical): regen + lifesteal on the weapon's own hits, no skills ---
    // Regen: HealthRegen x HpMaxNoMulti per second (HandleUnits 0x77F4534, SecondsToFullyRegenerate
    // 1.0). Lifesteal: Dmg x LifeSteal on every weapon hit (ApplyDmg 0x77F4BD0), at the weapon's
    // tick-stepped hit rate. Block never scales healing (it only cuts incoming damage).
    const { regen, lifesteal, total } = useMemo(() => {
        const regen = stats.totalHealth * stats.healthRegen;
        const lifesteal = stats.realWeaponDps * stats.lifeSteal;
        return { regen, lifesteal, total: regen + lifesteal };
    }, [stats]);
    const check = useEngineCheck(stats, profile.skills?.equipped || [], skillLibrary);
    const tested = check.result?.tested;
    const blockChance = stats.blockChance || 0;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div className="bg-bg-primary w-full max-w-[calc(100vw-1rem)] md:max-w-3xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 md:p-4 border-b border-border bg-bg-secondary/40 gap-4">
                    <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 1 }} size={24} />
                        <div className="min-w-0">
                            <h3 className="text-base md:text-xl font-bold text-white tracking-tight whitespace-nowrap overflow-hidden text-clip">HPS Breakdown</h3>
                            <p className="text-[8px] md:text-[10px] text-white/40 font-mono uppercase tracking-[0.1em] whitespace-nowrap overflow-hidden text-clip">Weapon formula and 24 h test</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setShowFullNumbers(!showFullNumbers)}
                            className={cn(
                                "p-2 rounded-lg transition-all flex items-center gap-2",
                                showFullNumbers ? 'bg-pink-500/20 text-pink-400 ring-1 ring-pink-500/30' : 'hover:bg-white/5 text-white/40 hover:text-white/60'
                            )}
                            title={showFullNumbers ? "Switch to Compact Numbers" : "Show Full Numbers"}
                        >
                            <Hash className="w-4 h-4 md:w-5 md:h-5" />
                            <span className={cn(showFullNumbers ? "inline" : "hidden lg:inline", "text-[10px] uppercase font-bold tracking-wider")}>
                                {showFullNumbers ? 'Full' : 'Compact'}
                            </span>
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white">
                            <X className="w-5 h-5 md:w-6 md:h-6" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 md:space-y-10 custom-scrollbar bg-bg-primary font-sans">
                    <div className="bg-bg-input/60 rounded-xl p-3 md:p-4 border border-dashed border-white/10 flex gap-3" data-testid="hps-explainer">
                        <GameAssetIcon asset={{ icon: 'InfoIcon' }} size={20} className="mt-0.5" />
                        <div className="text-[10px] md:text-[11px] text-white/60 leading-relaxed space-y-1.5">
                            <p><strong className="text-pink-300">Weapon HPS (theoretical)</strong> is a formula without skills: health regen plus lifesteal on your weapon's own hits, at the weapon DPS of the DPS breakdown.</p>
                            <p><strong className="text-pink-300">Tested HPS ({TESTED_SECONDS / 3600} h simulation)</strong> is measured by the combat engine over {TESTED_SECONDS / 3600} hours of game time against a dummy with infinite health: it adds the heals of your skills, lifesteal on the damage buffs add to your hits, and the extra regen while health buffs are up.</p>
                            <p className="text-white/40">Both count healing before the max HP cap, as if you were never at full health. In a real fight anything past max HP is lost, so the real healing is this or less.</p>
                        </div>
                    </div>

                    <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center gap-3 text-pink-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-pink-500/20 pb-3 font-sans">
                            <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 1 }} size={18} />
                            Weapon HPS (theoretical)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-2 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest">Health regen</div>
                                <div className="text-base md:text-lg font-mono font-bold text-white break-all" data-testid="hps-regen">{formatVal(regen)}</div>
                                <div className="text-[10px] font-mono text-white/40">Health({formatVal(stats.totalHealth)}) x Regen({formatPercent(stats.healthRegen)}) per second</div>
                            </div>
                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-2 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest">Lifesteal on weapon hits</div>
                                <div className="text-base md:text-lg font-mono font-bold text-white break-all" data-testid="hps-lifesteal">{formatVal(lifesteal)}</div>
                                <div className="text-[10px] font-mono text-white/40">Weapon DPS({formatVal(stats.realWeaponDps)}) x Lifesteal({formatPercent(stats.lifeSteal)})</div>
                            </div>
                            <div className="bg-pink-500/10 rounded-2xl p-4 md:p-6 border border-pink-500/20 sm:col-span-2">
                                <div className="text-[9px] md:text-[10px] uppercase text-pink-400 font-bold tracking-widest mb-1">Weapon HPS (theoretical)</div>
                                <div className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold text-pink-400 break-all" data-testid="weapon-hps">{formatVal(total)}</div>
                            </div>
                            {blockChance > 0 && (
                                <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-2 min-w-0 sm:col-span-2">
                                    <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest">Block (damage avoided)</div>
                                    <div className="flex justify-between items-baseline gap-2">
                                        <span className="text-[11px] text-white/60">Share of incoming hits blocked</span>
                                        <span className="text-base md:text-lg font-mono font-bold text-white">{formatPercent(blockChance)}</span>
                                    </div>
                                    <div className="text-[9px] md:text-[10px] text-white/30 italic leading-relaxed">Block only reduces damage you take. It does not add to any healing.</div>
                                </div>
                            )}
                        </div>
                    </section>

                    <EngineCheckSection
                        stats={stats}
                        equipped={profile.skills?.equipped || []}
                        skillLibrary={skillLibrary}
                        formatVal={v => formatVal(v)}
                        mode="hps"
                        weaponTheoretical={total}
                        check={check}
                    />
                </div>

                {/* Footer */}
                <div className="p-4 md:p-6 border-t border-border bg-bg-secondary flex flex-col md:flex-row gap-4 md:items-center font-mono">
                    <div className="flex-1 flex flex-wrap items-end justify-between md:justify-start gap-x-6 gap-y-3 md:gap-10 min-w-0">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider leading-none mb-1 font-sans">Weapon HPS (theoretical)</span>
                            <span className="text-lg md:text-2xl font-bold text-pink-400 leading-none whitespace-nowrap overflow-hidden text-clip">{formatVal(total)}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-pink-400 font-bold tracking-widest bg-pink-500/10 px-2 py-1 rounded-md mb-1 leading-none font-sans w-fit">Tested HPS ({TESTED_SECONDS / 3600} h)</span>
                            <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white leading-none mt-1 break-all" data-testid="footer-tested-hps">
                                {tested ? formatVal(tested.hps) : check.status === 'error' ? 'n/a' : `${Math.round(((check.status === 'loading' && check.progress) || 0) * 100)}%`}
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

export const LifestealBreakdownModal = memo(({ isOpen, onClose, stats, profile, skillLibrary, variant }: LifestealBreakdownModalProps) => {
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
