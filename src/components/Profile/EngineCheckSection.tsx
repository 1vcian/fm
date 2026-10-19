import { Cpu, Loader2 } from 'lucide-react';
import { AggregatedStats } from '../../utils/statEngine';
import { SkillSlot } from '../../types/Profile';
import { useEngineCheck, type EngineCheckState } from '../../hooks/useEngineCheck';
import { OPENING_SECONDS, WARMUP_SECONDS, TESTED_SECONDS } from '../../engine/dummyRun';
import { cn } from '../../lib/utils';

interface EngineCheckSectionProps {
    stats: AggregatedStats;
    equipped: SkillSlot[];
    skillLibrary: any;
    formatVal: (v: number) => string;
    /** Which half of the tested run to show. */
    mode?: 'dps' | 'hps';
    /** The weapon-only theoretical figure of the same mode, shown next to the tested one. */
    weaponTheoretical?: number;
    /** A run the parent already holds (so the build is not posted twice). */
    check?: EngineCheckState;
}

const skillName = (lib: any, id: string) => lib?.[id]?.Name || id.replace(/([a-z])([A-Z])/g, '$1 $2');

/** Readable label of a dummyRun TestedRunResult source key. */
export function sourceLabel(key: string, lib: any): string {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    if (kind === 'weapon') return 'Weapon hits';
    if (kind === 'regen') return 'Health regen';
    if (kind === 'reflect') return 'Reflect';
    if (kind === 'buff') return `${skillName(lib, id)} (buff on weapon hits)`;
    if (kind === 'skill') return skillName(lib, id);
    if (kind === 'heal') return `${skillName(lib, id)} (heal on activation)`;
    if (kind === 'lifesteal') {
        const src = id.split(':');
        return src[0] === 'skill' ? `Lifesteal on ${skillName(lib, src[1])}` : 'Lifesteal on weapon hits';
    }
    return key;
}

const hours = (s: number) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : `${Math.round(s)} s`);

/**
 * The tested figures: the combat engine itself (src/engine/dummyRun.ts testedRun) run in a Web
 * Worker for TESTED_SECONDS of game time against a dummy that never attacks and never dies,
 * averaged per second and split by source. Everything the game applies is in it: skills with their
 * real cooldowns and uptime, buffs, crit and double rolls, the 0.1 s tick breakpoints.
 */
export function EngineCheckSection({ stats, equipped, skillLibrary, formatVal, mode = 'dps', weaponTheoretical, check: given }: EngineCheckSectionProps) {
    const own = useEngineCheck(stats, equipped, skillLibrary, !given);
    const check = given ?? own;
    const r = check.result;
    const t = r?.tested;
    const total = t ? (mode === 'dps' ? t.dps : t.hps) : 0;
    const rows = t
        ? Object.entries(mode === 'dps' ? t.dpsBySource : t.hpsBySource)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
        : [];
    const accent = mode === 'dps' ? 'text-emerald-400' : 'text-pink-400';
    const bar = mode === 'dps' ? 'bg-emerald-400/70' : 'bg-pink-400/70';
    const progress = check.status === 'loading' ? check.progress ?? 0 : 0;

    return (
        <section className="space-y-4" data-testid="engine-check">
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] border-b pb-3 font-sans', accent, mode === 'dps' ? 'border-emerald-500/20' : 'border-pink-500/20')}>
                <Cpu className="w-4 h-4 md:w-5 md:h-5" />
                Tested {mode === 'dps' ? 'DPS' : 'HPS'} ({hours(TESTED_SECONDS)} simulation)
                <span className="ml-auto text-[8px] md:text-[9px] tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10 normal-case font-semibold">
                    Measured by the combat engine
                </span>
            </div>
            <p className="text-[10px] md:text-[11px] text-white/50 leading-snug">
                Your build fights a dummy with infinite health that never attacks, for {hours(TESTED_SECONDS)} of game time
                (the first {WARMUP_SECONDS} s are left out), and the {mode === 'dps' ? 'damage dealt' : 'health gained'} is
                averaged per second. It uses the same engine as the battle simulator: every skill with its real cooldown and
                uptime, buffs, crit and double rolls and the 0.1 s attack breakpoints.
                {mode === 'hps' && ' Healing is counted before the max HP cap (as if you were never full), so in a real fight it is this or less.'}
            </p>

            {check.status !== 'done' && check.status !== 'error' && (
                <div className="space-y-2 py-2" data-testid="engine-check-loading">
                    <div className="flex items-center gap-2 text-[11px] text-white/50">
                        <Loader2 className="w-4 h-4 animate-spin" /> Simulating {hours(TESTED_SECONDS)} of combat {Math.round(progress * 100)}%
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className={cn('h-full transition-[width] duration-150', bar)} style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                </div>
            )}
            {check.status === 'error' && (
                <div className="text-[11px] text-red-400 py-3">Simulation failed: {check.error}</div>
            )}

            {r && t && (
                <div className="space-y-3" data-testid="engine-check-values">
                    <div className="bg-bg-input/40 rounded-xl p-3 md:p-4 border border-white/5 flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">Tested {mode === 'dps' ? 'DPS' : 'HPS'}</div>
                            <div className={cn('text-2xl md:text-3xl font-bold font-mono break-all', accent)} data-testid={`tested-${mode}`}>{formatVal(total)}</div>
                        </div>
                        {weaponTheoretical !== undefined && weaponTheoretical > 0 && total > 0 && (
                            <div className="text-right text-[10px] font-mono text-white/40">
                                {(total / weaponTheoretical).toFixed(2)}x the weapon only figure
                            </div>
                        )}
                    </div>

                    {rows.length > 0 ? (
                        <div className="bg-bg-input/30 rounded-xl border border-white/5 divide-y divide-white/5">
                            {rows.map(([key, v]) => (
                                <div key={key} className="px-3 py-2 space-y-1" data-testid="tested-source">
                                    <div className="flex justify-between items-baseline gap-3 text-[11px] font-mono">
                                        <span className="text-white/70 min-w-0 truncate font-sans">{sourceLabel(key, skillLibrary)}</span>
                                        <span className="text-white shrink-0">
                                            {formatVal(v)} <span className="text-white/40">{total > 0 ? ((v / total) * 100).toFixed(1) : '0'}%</span>
                                        </span>
                                    </div>
                                    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                                        <div className={cn('h-full', bar)} style={{ width: `${total > 0 ? Math.max(0.5, (v / total) * 100) : 0}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6 bg-bg-input/20 rounded-xl border border-dashed border-white/10 text-white/30 text-[11px] italic font-mono">
                            {mode === 'dps' ? 'No damage dealt' : 'No healing on this build'}
                        </div>
                    )}

                    {mode === 'dps' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0">
                                <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">First {OPENING_SECONDS} s of a battle</div>
                                <div className="text-sm md:text-base font-bold font-mono text-white truncate">{formatVal(r.openingDps)}</div>
                                <span className="text-[9px] font-mono text-white/40">{t.dps > 0 ? ((r.openingDps / t.dps) * 100).toFixed(0) : 0}% of tested</span>
                            </div>
                            <div className="bg-bg-input/40 rounded-xl p-3 border border-white/5 min-w-0">
                                <div className="text-[9px] uppercase text-white/40 font-bold tracking-widest">Several enemies</div>
                                <div className="space-y-0.5 mt-1">
                                    {r.targets.map(row => (
                                        <div key={row.count} className="flex justify-between gap-2 text-[11px] font-mono">
                                            <span className="text-white/50">{row.count} {row.count === 1 ? 'enemy' : 'enemies'}</span>
                                            <span className="text-white truncate">
                                                {formatVal(row.dps)} <span className="text-white/40">x{r.dps > 0 ? (row.dps / r.dps).toFixed(2) : '0'}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                    {mode === 'dps' && (
                        <p className="text-[9px] md:text-[10px] text-white/30 leading-snug">
                            First {OPENING_SECONDS} s: a main battle start (2 s before the wave, the 4 s initial skill charge, the
                            enemy spawning 15 units away so you walk into range). Several enemies: the main battle formation, total
                            damage over {r.seeds} runs of {r.seconds} s; area skills hit every enemy they reach, the weapon hits one.
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}
