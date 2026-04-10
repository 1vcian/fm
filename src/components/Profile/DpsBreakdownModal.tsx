import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../UI/Button';
import { X, Swords, Zap, TrendingUp, Sparkles, HelpCircle, Hash } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { UserProfile } from '../../types/Profile';
import { formatPercent, formatCompactNumber } from '../../utils/statsCalculator';
import { SKILL_MECHANICS } from '../../utils/constants';
import { BreakpointTables, BreakpointExplanation } from './BreakpointTables';

interface DpsBreakdownModalProps {
    isOpen: boolean;
    onClose: () => void;
    stats: AggregatedStats;
    profile: UserProfile;
    skillLibrary: any;
}

// Internal component to handle content and memoization to prevent flickering
const ModalContent = memo(({ stats, profile, skillLibrary, onClose }: Omit<DpsBreakdownModalProps, 'isOpen'>) => {
    const [showFullNumbers, setShowFullNumbers] = useState(false);
    const [useRealTime, setUseRealTime] = useState(true);
    const [showBreakpoints, setShowBreakpoints] = useState(false);

    // Local helper for compact formatting of large values
    const formatVal = (val: number, decimals: number = 0) => {
        if (showFullNumbers) return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
        if (val >= 1000000) return formatCompactNumber(val);
        return val.toLocaleString(undefined, { maximumFractionDigits: decimals });
    };

    // --- WEAPON DPS CALCULATIONS ---
    const { 
        cappedCritChance, cappedDoubleChance, critMult, doubleMult, 
        theoreticalAps, weaponDps, realWeaponDps, realAps,
        speedBonus, effectiveWindup, realCycleTime
    } = useMemo(() => {
        const cCrit = Math.min(stats.criticalChance, 1);
        const cDouble = Math.min(stats.doubleDamageChance, 1);
        const bDuration = stats.weaponAttackDuration;
        const sBonus = stats.attackSpeedMultiplier;
        
        return {
            cappedCritChance: cCrit,
            cappedDoubleChance: cDouble,
            critMult: 1 + cCrit * (stats.criticalDamage - 1),
            doubleMult: 1 + cDouble,
            speedBonus: sBonus,
            effectiveWindup: stats.weaponWindupTime / sBonus,
            theoreticalAps: 1 / (bDuration / sBonus),
            weaponDps: stats.weaponDps,
            realAps: stats.realAps,
            realWeaponDps: stats.realWeaponDps,
            realCycleTime: stats.realCycleTime
        };
    }, [stats]);

    // Used for display throughout the modal
    const displayAps = useRealTime ? realAps : theoreticalAps;
    const displayWeaponDps = useRealTime ? realWeaponDps : weaponDps;

    // --- SKILL DPS CALCULATIONS ---
    const { damageSkills, buffSkills } = useMemo(() => {
        const BUFF_SKILLS = ["Meat", "Morale", "Berserk", "Buff", "HigherMorale", "0", "1", "6", "12", "13"];

        const processed = (profile.skills.equipped || []).map((skill: { id: string | number; level: number }) => {
            const skillData = skillLibrary?.[skill.id];
            if (!skillData) return null;

            const levelIdx = Math.max(0, skill.level - 1);
            const baseSkillValue = (skillData.DamagePerLevel?.[levelIdx] || 0) || (skillData.HealthPerLevel?.[levelIdx] || 0);
            const baseCooldown = skillData.Cooldown || 1;
            const duration = skillData.ActiveDuration || 0;

            if (baseSkillValue <= 0) return null;

            const cdr = stats.skillCooldownReduction;
            const cdMult = Math.max(0.1, 1 - cdr);
            const finalCd = Math.max(0.1, baseCooldown * cdMult);

            const globalDamageMulti = stats.damageMultiplier;
            const skillMulti = stats.skillDamageMultiplier;
            
            // FORMULA ALIGNMENT: Match BattleSimulator (skillMulti + globalMulti - 1)
            const effectiveMultiplier = skillMulti + globalDamageMulti - 1;

            const isBuff = BUFF_SKILLS.includes(String(skill.id));
            const mechanics = SKILL_MECHANICS[String(skill.id)] || { count: 1 };
            const hitCount = mechanics.count || 1;

            if (isBuff) {
                const cycle = finalCd + duration;
                const uptime = duration / Math.max(0.1, cycle);
                const bonusPower = baseSkillValue * effectiveMultiplier;
                // Buffs benefit from weapon stats (Power x APS x Crit x Double)
                const weaponSynergy = displayAps * critMult * doubleMult;
                const dpsContrib = bonusPower * weaponSynergy * uptime;

                return {
                    name: skillData.Name || `Skill #${skill.id}`,
                    isBuff: true,
                    base: baseSkillValue,
                    multi: effectiveMultiplier,
                    duration,
                    cooldown: finalCd,
                    uptime,
                    weaponSynergy,
                    dps: dpsContrib
                };
            } else {
                const dmgPerHit = baseSkillValue * effectiveMultiplier;
                const totalDmgPerActivation = dmgPerHit * hitCount;
                const dps = totalDmgPerActivation / finalCd;

                return {
                    name: skillData.Name || `Skill #${skill.id}`,
                    isBuff: false,
                    base: baseSkillValue,
                    multi: effectiveMultiplier,
                    hitCount,
                    cooldown: finalCd,
                    dps: dps
                };
            }
        }).filter(Boolean);

        const dSkills = processed.filter(s => s && !s.isBuff);
        const bSkills = processed.filter(s => s && s.isBuff);
        const tSkillDps = processed.reduce((acc: number, curr: any) => acc + curr.dps, 0);

        return { damageSkills: dSkills, buffSkills: bSkills, totalSkillDps: tSkillDps };
    }, [profile.skills.equipped, skillLibrary, stats, displayAps, critMult, doubleMult]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div className="bg-bg-primary w-full max-w-[calc(100vw-1rem)] md:max-w-4xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-300" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 md:p-4 border-b border-border bg-bg-secondary/40">
                    <div className="flex items-center gap-2 md:gap-3">
                        <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-orange-400" />
                        <div>
                            <h3 className="text-lg md:text-xl font-bold text-white tracking-tight">DPS Breakdown</h3>
                            <p className="text-[9px] md:text-[10px] text-white/40 font-mono uppercase tracking-[0.1em]">Mathematical Formula Analysis</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 md:gap-2">
                        <div className="flex items-center bg-bg-secondary rounded-lg p-1 mr-2 border border-border/40">
                             <button 
                                onClick={() => setShowBreakpoints(!showBreakpoints)}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all flex items-center gap-2 ${showBreakpoints ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                                title="View Attack Speed Thresholds"
                            >
                                <Zap className="w-3 h-3" />
                                Breakpoints
                            </button>
                            <div className="w-px h-4 bg-border/40 mx-1" />
                            <button 
                                onClick={() => setUseRealTime(false)}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${!useRealTime ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                            >
                                Theoretical
                            </button>
                            <button 
                                onClick={() => setUseRealTime(true)}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${useRealTime ? 'bg-orange-500 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                            >
                                Real-Time
                            </button>
                        </div>
                        <button 
                            onClick={() => setShowFullNumbers(!showFullNumbers)} 
                            className={`p-2 rounded-lg transition-all flex items-center gap-2 ${showFullNumbers ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30' : 'hover:bg-white/5 text-white/40 hover:text-white/60'}`}
                            title={showFullNumbers ? "Switch to Compact Numbers" : "Show Full Numbers"}
                        >
                            <Hash className="w-4 h-4 md:w-5 md:h-5" />
                            <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wider">{showFullNumbers ? 'Full' : 'Compact'}</span>
                        </button>
                        <div className="w-px h-6 bg-border mx-1 md:mx-2" />
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-white/60 hover:text-white">
                            <X className="w-5 h-5 md:w-6 md:h-6" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 md:space-y-10 custom-scrollbar bg-bg-primary font-sans">
                    {/* Weapon Section */}
                    <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center gap-3 text-orange-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-orange-500/20 pb-3 font-sans">
                            <Swords className="w-4 h-4 md:w-5 md:h-5" />
                            Weapon Damage Scaling
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                            {/* Base Stats */}
                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans flex justify-between">
                                    Core Power
                                    {useRealTime && <span className="text-orange-400/60 animate-pulse text-[8px]">Steps Active</span>}
                                </div>
                                <div className="flex justify-between items-baseline gap-2">
                                    <span className="text-[11px] text-white/60">Base Dmg</span>
                                    <span className="text-base md:text-lg font-mono font-bold text-white break-all">{formatVal(stats.totalDamage)}</span>
                                </div>
                                <div className="space-y-2 pt-3 border-t border-white/5">
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40">Attack Cycle</span>
                                        <span className={`font-mono transition-colors ${useRealTime ? 'text-orange-400 font-bold' : 'text-white/80'}`}>
                                            {useRealTime ? realCycleTime.toFixed(2) : (stats.weaponAttackDuration / speedBonus).toFixed(3)}s
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40">Base Duration</span>
                                        <span className="font-mono text-white/60">{stats.weaponAttackDuration.toFixed(2)}s</span>
                                    </div>
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs border-b border-white/5 pb-2">
                                        <span className="text-white/40">Base Windup</span>
                                        <span className="font-mono text-white/60">{stats.weaponWindupTime.toFixed(2)}s</span>
                                    </div>
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40">Speed Mult</span>
                                        <span className="font-mono text-white/80">{speedBonus.toFixed(2)}x</span>
                                    </div>
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40">Eff. Windup</span>
                                        <span className="font-mono text-white/80">{effectiveWindup.toFixed(2)}s</span>
                                    </div>
                                    <div className="flex justify-end text-[10px] md:text-[11px] text-orange-400 font-bold pt-1 font-mono">
                                        APS: {displayAps.toFixed(2)}
                                    </div>
                                </div>
                            </div>

                            {/* Critical Breakdown */}
                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans">Critical luck</div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40 whitespace-nowrap">Chance</span>
                                        <span className="font-mono text-white font-bold">{formatPercent(cappedCritChance)}</span>
                                    </div>
                                    <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-white/30 pl-2 font-mono">
                                        <span>Tree: {formatPercent(stats.critChanceBreakdown.tree)}</span>
                                        <span>Items: {formatPercent(stats.critChanceBreakdown.substats)}</span>
                                    </div>
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs pt-2 border-t border-white/5">
                                        <span className="text-white/40 whitespace-nowrap">Multi</span>
                                        <span className="font-mono text-white font-bold">{formatPercent(stats.criticalDamage, 0)}</span>
                                    </div>
                                    <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-white/30 pl-2 font-mono">
                                        <span>Tree: {formatPercent(stats.critDamageBreakdown.tree)}</span>
                                        <span>Items: {formatPercent(stats.critDamageBreakdown.substats)}</span>
                                    </div>
                                    <div className="flex justify-end text-[10px] md:text-[11px] text-orange-400 font-bold pt-1 font-mono">
                                        Avg: {critMult.toFixed(2)}x
                                    </div>
                                </div>
                            </div>

                            <div className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-3 min-w-0">
                                <div className="text-[10px] uppercase text-white/40 font-bold tracking-widest font-sans flex justify-between">
                                    Double Chance
                                    {useRealTime && stats.doubleDamageChance > 0 && <span className="text-orange-400/60 animate-pulse text-[8px]">Steps Active</span>}
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                        <span className="text-white/40 whitespace-nowrap">Proc Chance</span>
                                        <span className="font-mono text-white font-bold">{formatPercent(cappedDoubleChance)}</span>
                                    </div>
                                    <div className="flex flex-wrap justify-between gap-x-2 text-[9px] text-white/30 pl-2 font-mono">
                                        <span>Tree: {formatPercent(stats.doubleDamageBreakdown.tree)}</span>
                                        <span>Items: {formatPercent(stats.doubleDamageBreakdown.substats)}</span>
                                    </div>
                                    {useRealTime && stats.doubleDamageChance > 0 && (
                                        <div className="pt-2 border-t border-white/5 space-y-1">
                                            <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                                <span className="text-white/40">Seq. Delay</span>
                                                <span className="font-mono text-orange-400 font-bold">{(stats.doubleHitDelay / speedBonus).toFixed(2)}s → {(stats.realDoubleHitCycle - realCycleTime).toFixed(1)}s</span>
                                            </div>
                                            <div className="flex justify-between items-baseline text-[11px] md:text-xs">
                                                <span className="text-white/40">Full Cycle</span>
                                                <span className="font-mono text-white/80">{stats.realDoubleHitCycle.toFixed(2)}s</span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex justify-end text-[10px] md:text-[11px] text-orange-400 font-bold pt-2 font-mono">
                                        Multi: {doubleMult.toFixed(2)}x
                                    </div>
                                    <div className="text-[8px] md:text-[9px] text-white/20 italic mt-1 text-center font-mono">Capped at 100% (x2.0 dmg)</div>
                                </div>
                            </div>

                            {/* Weapon Result */}
                            <div className="bg-orange-500/10 rounded-2xl p-4 md:p-6 border border-orange-500/20 sm:col-span-2 lg:col-span-3 group transition-all hover:bg-orange-500/[0.12]">
                                {showBreakpoints ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b border-orange-500/20 pb-3">
                                            <div className="text-[10px] uppercase text-orange-400 font-bold tracking-[0.1em]">Dynamic Breakpoints for {stats.weaponAttackDuration.toFixed(1)}s Base</div>
                                            <button onClick={() => setShowBreakpoints(false)} className="text-[10px] text-white/40 hover:text-white/60 uppercase font-bold">Back to Result</button>
                                        </div>
                                        <div className="overflow-x-auto custom-scrollbar">
                                        <BreakpointTables 
                                            weaponAttackDuration={stats.weaponAttackDuration}
                                            weaponWindupTime={stats.weaponWindupTime}
                                            currentAttackSpeedMultiplier={stats.attackSpeedMultiplier}
                                            realCycleTime={stats.realCycleTime}
                                            realWindup={stats.weaponWindupTime / stats.attackSpeedMultiplier}
                                        />

                                        <BreakpointExplanation />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                                        <div className="min-w-0 text-left">
                                            <div className="text-[9px] md:text-[10px] uppercase text-orange-400 font-bold tracking-widest mb-1 font-sans">
                                                Effective {useRealTime ? 'Weighted Real-Time' : 'Theoretical'} Weapon DPS
                                            </div>
                                            <div className="text-2xl sm:text-3xl md:text-4xl font-mono font-bold text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.2)] break-all">
                                                {formatVal(displayWeaponDps)}
                                            </div>
                                            {useRealTime && (
                                                <div className="text-[10px] text-white/40 mt-1 font-mono">
                                                    {stats.doubleDamageChance > 0 
                                                        ? `Weighted avg of Normal (${realCycleTime.toFixed(2)}s) and Double (${stats.realDoubleHitCycle.toFixed(2)}s) cycles`
                                                        : `Rounded to 0.1s frame steps + 0.2s fixed delay`}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-left md:text-right text-[10px] md:text-[11px] text-white/30 font-mono leading-relaxed max-w-sm flex flex-wrap md:flex-col gap-x-2">
                                            <div className="text-orange-300/40 font-bold uppercase text-[8px] md:text-[9px] w-full mb-1">Calculation:</div>
                                            <span className="whitespace-nowrap">Dmg({formatVal(stats.totalDamage)}) ×</span>
                                            {useRealTime && stats.doubleDamageChance > 0 ? (
                                                <>
                                                    <span className="whitespace-nowrap text-purple-400 font-bold">WeightedAPS({displayAps.toFixed(2)}) ×</span>
                                                    <span className="whitespace-nowrap">Crit({critMult.toFixed(2)})</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="whitespace-nowrap">APS({displayAps.toFixed(2)}) ×</span>
                                                    <span className="whitespace-nowrap">Crit({critMult.toFixed(2)}) ×</span>
                                                    <span className="whitespace-nowrap">Double({doubleMult.toFixed(2)})</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Skill Boosts Section */}
                    {buffSkills.length > 0 && (
                        <section className="space-y-4 md:space-y-6">
                            <div className="flex items-center gap-3 text-purple-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-purple-500/20 pb-3 font-sans">
                                <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
                                Temporary Boost Contribution
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                                {buffSkills.map((s: any, i) => (
                                    <div key={i} className="bg-purple-500/5 rounded-2xl p-4 md:p-5 border border-purple-500/10 space-y-4 min-w-0">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="text-xs md:text-sm font-bold text-purple-300 uppercase tracking-tight truncate">{s.name}</div>
                                            <div className="text-right shrink-0">
                                                <div className="text-base md:text-lg font-mono font-bold text-white">+{formatVal(s.dps)}</div>
                                                <div className="text-[8px] md:text-[9px] text-purple-400 font-bold uppercase font-sans">Avg DPS</div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-y-3 text-[10px] font-mono p-3 bg-purple-500/10 rounded-xl">
                                            <div className="space-y-0.5">
                                                <div className="text-purple-300/50 uppercase text-[8px] font-sans">Power</div>
                                                <div className="text-white break-all">{formatVal(s.base * s.multi)}</div>
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-purple-300/50 uppercase text-[8px] font-sans">Uptime</div>
                                                <div className="text-white">{(s.uptime * 100).toFixed(1)}%</div>
                                            </div>
                                            <div className="col-span-2 pt-2 border-t border-purple-300/10">
                                                <div className="text-purple-300/50 uppercase text-[8px] mb-1 font-sans">Weapon Synergy</div>
                                                <div className="text-white">{s.weaponSynergy.toFixed(2)}x Factor</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="bg-bg-input/60 rounded-xl p-4 border border-dashed border-purple-500/30">
                                <div className="flex gap-4">
                                    <HelpCircle className="w-5 h-5 md:w-6 md:h-6 text-purple-400 shrink-0" />
                                    <div className="text-[10px] md:text-[11px] text-white/50 leading-relaxed font-sans">
                                        <p className="mb-2"><strong className="text-purple-300">Weapon Synergy:</strong> Buffs add flat damage to your weapon. Because you hit multiple times per second and can deal Critical/Double hits, every point is scaled by weapon quality.</p>
                                        <p className="italic text-[9px] md:text-[10px]">Factor = APS × Crit Multi × Double Multi</p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Active Damage Skills Section */}
                    <section className="space-y-4 md:space-y-6">
                        <div className="flex items-center gap-3 text-blue-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-blue-500/20 pb-3 font-sans">
                            <Zap className="w-4 h-4 md:w-5 md:h-5" />
                            Direct Skill Damage
                        </div>

                        {damageSkills.length > 0 ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                                {damageSkills.map((s: any, i) => (
                                    <div key={i} className="bg-bg-input/40 rounded-2xl p-4 md:p-5 border border-white/5 space-y-4 min-w-0">
                                        <div className="flex justify-between items-center pb-3 border-b border-white/5 gap-4">
                                            <div className="text-xs md:text-sm font-bold text-white uppercase truncate">{s.name}</div>
                                            <div className="text-right shrink-0">
                                                <div className="text-lg md:text-xl font-mono font-bold text-blue-400">{formatVal(s.dps)}</div>
                                                <div className="text-[8px] md:text-[9px] text-white/40 font-bold uppercase font-sans">Avg DPS</div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 md:gap-6">
                                            <div className="space-y-2">
                                                <div className="text-[9px] md:text-[10px] text-blue-300/60 font-bold uppercase font-sans">Power</div>
                                                <div className="flex justify-between items-baseline text-[10px] md:text-[11px] font-mono gap-2">
                                                    <span className="text-white/40 truncate">Hit</span>
                                                    <span className="text-white font-bold">{formatVal(s.base * s.multi)}</span>
                                                </div>
                                                <div className="flex justify-between items-baseline text-[10px] md:text-[11px] pt-1 border-t border-white/5 font-mono gap-2">
                                                    <span className="text-white/40">Hits</span>
                                                    <span className="text-blue-300 font-bold">x{s.hitCount}</span>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="text-[9px] md:text-[10px] text-blue-300/60 font-bold uppercase font-sans">Timing</div>
                                                <div className="flex justify-between items-baseline text-[10px] md:text-[11px] font-mono gap-2">
                                                    <span className="text-white/40">CD</span>
                                                    <span className="text-white font-bold">{s.cooldown.toFixed(2)}s</span>
                                                </div>
                                                <div className="mt-3 p-1.5 bg-blue-500/5 rounded border border-blue-500/10 text-[8px] md:text-[9px] text-white/20 italic font-mono text-center">
                                                    (Hit×Mult×#) / CD
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-10 bg-bg-input/20 rounded-2xl border border-dashed border-white/10 text-white/30 text-[11px] italic font-mono">
                                No direct damage skills equipped
                            </div>
                        )}
                    </section>
                </div>

                {/* Footer */}
                <div className="p-4 md:p-6 border-t border-border bg-bg-secondary flex flex-col md:flex-row gap-4 md:items-center font-mono">
                    <div className="flex-1 flex flex-wrap items-center justify-between md:justify-start gap-x-4 gap-y-3 md:gap-8 min-w-0">
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider leading-none mb-1 font-sans">Weapon</span>
                            <span className="text-sm md:text-xl font-bold text-orange-400 leading-none truncate">
                                {formatVal(displayWeaponDps)}
                            </span>
                        </div>
                        <div className="text-white/10 font-bold text-sm md:text-base">+</div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-white/40 font-bold tracking-wider leading-none mb-1 font-sans">Skills</span>
                            <span className="text-sm md:text-xl font-bold text-blue-400 leading-none truncate">
                                {formatVal(stats.skillDps + (stats.skillBuffDps || 0))}
                            </span>
                        </div>
                        <div className="flex flex-col w-full md:w-auto md:ml-auto border-t md:border-t-0 border-white/5 pt-3 md:pt-0">
                            <span className="text-[8px] md:text-[9px] uppercase text-orange-400 font-bold tracking-widest bg-orange-500/10 px-2 py-1 rounded-md mb-1 leading-none font-sans w-fit">
                                Total {useRealTime ? 'Real-Time' : 'Theoretical'} DPS
                            </span>
                            <span className="text-xl sm:text-2xl md:text-3xl font-bold text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] leading-none mt-1 break-all">
                                {formatVal(useRealTime ? stats.realTotalDps : stats.averageTotalDps)}
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

export const DpsBreakdownModal = memo(({ isOpen, onClose, stats, profile, skillLibrary }: DpsBreakdownModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <ModalContent 
            stats={stats} 
            profile={profile} 
            skillLibrary={skillLibrary} 
            onClose={onClose} 
        />,
        document.body
    );
});
