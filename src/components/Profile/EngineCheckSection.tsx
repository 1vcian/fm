import { Cpu, Loader2 } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { SkillSlot } from '../../types/Profile';
import { useEngineCheck } from '../../hooks/useEngineCheck';
import { OPENING_SECONDS, WARMUP_SECONDS } from '../../engine/dummyRun';
import { cn } from '../../lib/utils';

interface EngineCheckSectionProps {
    stats: AggregatedStats;
    equipped: SkillSlot[];
    skillLibrary: any;
    formatVal: (v: number) => string;
}

const diffPct = (engine: number, formula: number) => (formula > 0 ? (engine / formula - 1) * 100 : 0);

/**
 * "Engine check" in the DPS breakdown: the combat engine run against non-attacking dummies in a
 * Web Worker (useEngineCheck). A cross-check of the formulas above, plus what they can't give.
 */
export function EngineCheckSection({ stats, equipped, skillLibrary, formatVal }: EngineCheckSectionProps) {
    const check = useEngineCheck(stats, equipped, skillLibrary);
    const r = check.result;

    const Diff = ({ engine, formula }: { engine: number; formula: number }) => {
        const d = diffPct(engine, formula);
        return (
            <span className={cn('text-[9px] font-mono', Math.abs(d) <= 1.5 ? 'text-green-400/80' : 'text-amber-400/90')}>
                {d >= 0 ? '+' : ''}{d.toFixed(1)}% vs formula
            </span>
        );
    };

    return (
        <section className="space-y-4" data-testid="engine-check">
            <div className="flex items-center gap-3 text-emerald-400 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b border-emerald-500/20 pb-3 font-sans">
                <Cpu className="w-4 h-4 md:w-5 md:h-5" />
                Engine check
                <span className="ml-auto text-[8px] md:text-[9px] tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 normal-case font-semibold">
                    Simulated, not a formula
                </span>
            </div>
            <p className="text-[10px] md:text-[11px] text-white/40 leading-snug">
                The combat engine run against dummies that never attack and never die
                {r ? ` (${r.seeds} seeds x ${r.seconds} s, the first ${WARMUP_SECONDS} s left out of the steady state)` : ''}.
                Healing is counted before the full HP cap.
            </p>

            {check.status !== 'done' && check.status !== 'error' && (
                <div className="flex items-center gap-2 text-[11px] text-white/50 py-3" data-testid="engine-check-loading">
                    <Loader2 className="w-4 h-4 animate-spin" /> Running the engine
                </div>
            )}
            {check.status === 'error' && (
                <div className="text-[11px] text-red-400 py-3">Engine check failed: {check.error}</div>
            )}

            {r && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="engine-check-values">
                    <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0">
                        <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">Steady DPS</div>
                        <div className="text-sm md:text-lg font-bold font-mono text-white truncate">{formatVal(r.dps)}</div>
                        <Diff engine={r.dps} formula={stats.realTotalDps} />
                    </div>
                    <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0">
                        <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">Steady HPS</div>
                        <div className="text-sm md:text-lg font-bold font-mono text-white truncate">{formatVal(r.hps)}</div>
                        <Diff engine={r.hps} formula={stats.realTotalHps} />
                    </div>
                    <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0">
                        <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">First {OPENING_SECONDS} s DPS</div>
                        <div className="text-sm md:text-lg font-bold font-mono text-white truncate">{formatVal(r.openingDps)}</div>
                        <span className="text-[9px] font-mono text-white/40">{r.dps > 0 ? ((r.openingDps / r.dps) * 100).toFixed(0) : 0}% of steady</span>
                    </div>
                    <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0 col-span-2 lg:col-span-1">
                        <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">DPS by targets</div>
                        <div className="space-y-0.5 mt-1">
                            {r.targets.map(t => (
                                <div key={t.count} className="flex justify-between gap-2 text-[11px] font-mono">
                                    <span className="text-white/50">{t.count} {t.count === 1 ? 'enemy' : 'enemies'}</span>
                                    <span className="text-white truncate">
                                        {formatVal(t.dps)} <span className="text-white/40">x{r.dps > 0 ? (t.dps / r.dps).toFixed(2) : '0'}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            <p className="text-[9px] md:text-[10px] text-white/30 leading-snug">
                First {OPENING_SECONDS} s: a main battle start (2 s before the wave, the 4 s initial skill charge, the
                enemy spawning 15 units away so the hero walks into range). Several targets: the main battle
                formation; area skills hit every enemy they reach, the weapon hits one.
            </p>
        </section>
    );
}
