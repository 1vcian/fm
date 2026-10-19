import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Loader2, Timer, X } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { SkillSlot } from '../../types/Profile';
import { Input } from '../UI/Input';
import { cn } from '../../lib/utils';
import { BUFF_SKILL_TYPES, SKILL_EPICENTER, playerUnitSpec, pvpSkillRun, skillSpecs, type PvpLoadout, type PvpSkillRunResult } from '../../engine';
import { pvpConfigFromJson } from '../../pvp/simulate';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { CooldownBreakpoints } from './CooldownBreakpoints';

/**
 * Skills cycle, measured by the combat engine: a PvP battle against a dummy (src/engine/dummyRun.ts
 * pvpSkillRun). The player's real loadout walks in from the PvP spawn, every skill fires when ready
 * (TryActivateSkills after each frame) and only the skill damage that reaches the dummy before the
 * PvpMatchTimerSeconds timer runs out counts. A cast whose meteor or projectile lands after the
 * timer is wasted, which no cast-time formula can see.
 *
 * The run is repeated over the cooldown reduction sweep: skills never crit in the engine, so the
 * skill damage is deterministic for a seed and equal values are a true plateau.
 */
const SWEEP_STEP = 0.001; // 0.1%
const SWEEP_MAX = 0.25;   // 25% (SkillCooldownMulti rolls are 1%-7% each, 3+ sources stack)
const GRID_N = Math.round(SWEEP_MAX / SWEEP_STEP);
/** Relative difference below which two skill damage totals are the same plateau. */
const SAME = 1e-9;

const pct = (r: number, decimals = 1) => `${(r * 100).toFixed(decimals)}%`;
const prettyName = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');
const sec = (tick: number) => (tick / 10).toFixed(1);
const same = (a: number, b: number) => Math.abs(a - b) <= SAME * Math.max(1, Math.abs(a), Math.abs(b));

interface SkillsCycleProps {
    skills: SkillSlot[];
}

export function SkillsCycle({ skills }: SkillsCycleProps) {
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const globalStats = useGlobalStats();

    const [open, setOpen] = useState(false);
    const [customLen, setCustomLen] = useState<number | null>(null);
    const [timelineMode, setTimelineMode] = useState<'current' | 'target'>('current');

    const pvpConfig = useMemo(() => pvpConfigFromJson(pvpBaseConfig), [pvpBaseConfig]);
    const configDuration = pvpConfig?.PvpMatchTimerSeconds ?? null;
    const T = customLen ?? configDuration ?? NaN;
    const isGameDefault = configDuration !== null && T === configDuration;
    const currentR = globalStats?.skillCooldownReduction ?? 0;

    const equipped = useMemo(
        () => skills.filter(s => s && s.id && (s.level ?? 0) > 0),
        [skills]
    );

    /** The engine run at one reduction. */
    const runner = useMemo(() => {
        if (!globalStats || !skillLibrary || !pvpConfig || equipped.length === 0 || !isFinite(T) || T <= 0) return null;
        const spec = playerUnitSpec(globalStats as never, { x: 0, y: 0 }, 'league');
        const loadout: PvpLoadout = {
            health: spec.stats.hpMax ?? 1,
            stats: spec.stats,
            attackRange: spec.attackRange,
            windupTime: spec.windupTime,
            attackDuration: spec.attackDuration,
            projectile: spec.projectile,
            // The HP multiplier does not move skill damage: the dummy never attacks.
            petCount: 0, skillCount: 0, hasMount: false,
            tag: 'player',
        };
        const cfg = { ...pvpConfig, PvpMatchTimerSeconds: T };
        const list = equipped.map(s => ({ id: s.id, level: s.level }));
        return (r: number): PvpSkillRunResult =>
            pvpSkillRun(loadout, skillSpecs({ ...(globalStats as any), skillCooldownReduction: r }, list, skillLibrary), cfg, 1);
    }, [globalStats, skillLibrary, pvpConfig, equipped, T]);

    // One battle at the current reduction is cheap, so the card on the page always shows it.
    const preview = useMemo(() => (runner ? runner(currentR) : null), [runner, currentR]);

    // The sweep is GRID_N + 1 battles of T seconds: only while the popup is open, and one frame
    // after it opens so the popup paints its loading state first.
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    useEffect(() => {
        setAnalysis(null);
        if (!open || !runner) return;
        const id = window.setTimeout(() => setAnalysis(sweep(runner, currentR)), 30);
        return () => window.clearTimeout(id);
    }, [open, runner, currentR]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (!runner || !preview) return null;

    const previewWasted = preview.skills.reduce((n, s) => n + s.wastedCasts, 0);
    const shown = timelineMode === 'target' && analysis?.target ? analysis.target : analysis?.current ?? null;
    const shownR = timelineMode === 'target' && analysis?.next ? analysis.next.r : currentR;

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                data-testid="skills-cycle"
                className="group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-bg-input/30 hover:bg-bg-input/60 hover:border-accent-primary/50 transition-colors text-left"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-accent-primary/15 border border-accent-primary/30 flex items-center justify-center">
                        <Timer className="w-4 h-4 text-accent-primary" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-text-primary uppercase tracking-wide">Skills Cycle</div>
                        <div className="text-[10px] font-mono text-text-muted truncate">
                            CDR {pct(currentR)} · {formatCompactNumber(preview.skillDamage)} skill dmg in {T}s
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span
                        className={cn(
                            'text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border',
                            previewWasted > 0 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-green-500/15 text-green-400 border-green-500/30'
                        )}
                        data-testid="skills-cycle-status"
                    >
                        {previewWasted > 0 ? `${previewWasted} WASTED` : 'NO WASTE'}
                    </span>
                    <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold text-accent-primary group-hover:underline">
                        Simulate <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                    <ChevronRight className="sm:hidden w-4 h-4 text-text-muted" />
                </div>
            </button>

            {open && createPortal(
                <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4" onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-label="Skills cycle simulation"
                        data-testid="skills-cycle-modal"
                        className="bg-bg-primary text-text-primary w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[92vh] sm:rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-accent-primary/15 via-bg-secondary/40 to-bg-secondary/40">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 shrink-0 rounded-xl bg-accent-primary/20 border border-accent-primary/40 flex items-center justify-center">
                                    <Timer className="w-5 h-5 text-accent-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-text-primary">Skills cycle simulation</div>
                                    <div className="text-[10px] text-text-muted truncate">A PvP battle against a dummy, run by the combat engine at every reduction from 0 to {pct(SWEEP_MAX, 0)}</div>
                                </div>
                            </div>
                            <button onClick={() => setOpen(false)} aria-label="Close" data-testid="skills-cycle-close" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-bg-input/50 p-1 rounded-lg border border-border/30">
                                <span className="text-[10px] text-text-muted px-1 whitespace-nowrap">Battle length</span>
                                <Input
                                    type="number"
                                    step="1"
                                    min="5"
                                    value={T}
                                    onChange={(e) => {
                                        const v = parseFloat(e.target.value);
                                        setCustomLen(isFinite(v) && v > 0 ? v : null);
                                    }}
                                    className="w-14 h-7 text-center font-mono font-bold text-xs text-text-primary bg-bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-[10px] text-text-muted pr-1">s</span>
                                {isGameDefault && <span className="text-[9px] text-green-400/80 pr-1 whitespace-nowrap">(game default)</span>}
                                {customLen !== null && configDuration !== null && customLen !== configDuration && (
                                    <button
                                        onClick={() => setCustomLen(null)}
                                        className="text-[9px] text-accent-primary hover:underline pr-1"
                                        title={`Reset to game default (${configDuration}s from PvpBaseConfig)`}
                                    >
                                        reset
                                    </button>
                                )}
                            </div>
                            <span className="text-[10px] text-text-muted">{equipped.length} skill{equipped.length === 1 ? '' : 's'} equipped, seed 1</span>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
                            {!analysis ? (
                                <div className="flex flex-col items-center justify-center gap-2 py-16 text-[11px] text-text-secondary" data-testid="skills-cycle-loading">
                                    <Loader2 className="w-6 h-6 animate-spin text-accent-primary" />
                                    Running {GRID_N + 1} battles of {T}s
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="skills-cycle-summary">
                                        <Kpi label="Skill damage" value={formatCompactNumber(analysis.current.skillDamage)}
                                            hint={analysis.maxDmg > 0 ? `${pct(analysis.current.skillDamage / analysis.maxDmg)} of the best` : undefined} />
                                        <Kpi label="Your reduction" value={pct(currentR, 2)}
                                            hint={analysis.floor < currentR - 1e-12 ? `same damage from ${pct(analysis.floor)}` : 'no slack'}
                                            tone={analysis.floor < currentR - 1e-12 ? 'amber' : undefined} />
                                        <Kpi label="Next gain" value={analysis.next ? pct(analysis.next.r) : 'none'}
                                            hint={analysis.next
                                                ? `+${pct(analysis.next.r - currentR)} CDR, +${pct(analysis.next.dmg / Math.max(1, analysis.current.skillDamage) - 1)} dmg`
                                                : `nothing up to ${pct(SWEEP_MAX, 0)}`}
                                            tone="green" />
                                        <Kpi label="Wasted casts" value={String(analysis.current.skills.reduce((n, s) => n + s.wastedCasts, 0))}
                                            hint="landed after the timer"
                                            tone={analysis.current.skills.some(s => s.wastedCasts > 0) ? 'amber' : 'green'} />
                                    </div>

                                    <SweepChart grid={analysis.grid} maxDmg={analysis.maxDmg} currentR={currentR} nextR={analysis.next?.r ?? null} />

                                    <Section title="Skills">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {analysis.current.skills.map((s) => {
                                                const slot = equipped[s.slot];
                                                const isBuff = BUFF_SKILL_TYPES.has(s.id);
                                                const cfg = skillLibrary?.[slot?.id ?? s.id];
                                                return (
                                                    <div key={s.id} className={cn('rounded-lg p-2.5 border bg-bg-input/40', s.wastedCasts > 0 ? 'border-amber-500/40' : 'border-border/40')} data-testid="skills-cycle-skill">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className={cn('text-xs font-bold', slot && `text-rarity-${slot.rarity.toLowerCase()}`)}>{prettyName(s.id)}</span>
                                                            {cfg && <span className="text-[9px] font-mono text-text-muted">CD {cfg.Cooldown}s{cfg.ActiveDuration > 0 ? ` · DUR ${cfg.ActiveDuration}s` : ''}</span>}
                                                        </div>
                                                        <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                                                            <Stat label="casts" value={String(s.casts.length)} />
                                                            <Stat label={isBuff ? 'added to hits' : 'damage'} value={formatCompactNumber(s.damage)} />
                                                            {isBuff
                                                                ? <Stat label="uptime" value={pct(s.activeTicks / analysis.current.frames, 0)} />
                                                                : <Stat label="last hit" value={s.lastHitTick >= 0 ? `${sec(s.lastHitTick)}s` : 'none'} />}
                                                        </div>
                                                        {s.wastedCasts > 0 && (
                                                            <div className="mt-1.5 text-[10px] font-bold text-amber-400">{s.wastedCasts} cast{s.wastedCasts === 1 ? '' : 's'} landed nothing before the timer</div>
                                                        )}
                                                        {!isBuff && (
                                                            <div className="mt-1.5 text-[9px] text-text-muted leading-snug" data-testid="skills-cycle-epicenter">
                                                                {SKILL_EPICENTER[s.id] ?? 'no effect in the engine'}
                                                                {s.firstHitDelayTicks >= 0 && <> · first hit <span className="font-mono text-text-secondary">{sec(s.firstHitDelayTicks)}s</span> after the first cast</>}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Section>

                                    {shown && (
                                        <Section
                                            title="Cast timeline"
                                            right={
                                                <div className="flex items-center gap-1">
                                                    {(['current', 'target'] as const).filter(m => m === 'current' || analysis.next).map(m => (
                                                        <button
                                                            key={m}
                                                            onClick={() => setTimelineMode(m)}
                                                            className={cn(
                                                                'px-2 py-0.5 text-[9px] font-bold font-mono rounded border transition-colors',
                                                                timelineMode === m ? 'bg-accent-primary text-black border-accent-primary' : 'bg-transparent text-text-muted border-border/40 hover:border-text-muted'
                                                            )}
                                                        >
                                                            {m === 'current' ? `CURRENT ${pct(currentR)}` : `NEXT ${pct(analysis.next!.r)}`}
                                                        </button>
                                                    ))}
                                                </div>
                                            }
                                        >
                                            <div className="flex flex-col gap-1" data-testid="skills-cycle-timeline">
                                                {shown.skills.map((s) => {
                                                    const slot = equipped[s.slot];
                                                    const isBuff = BUFF_SKILL_TYPES.has(s.id);
                                                    const dur = skillLibrary?.[slot?.id ?? s.id]?.ActiveDuration ?? 0;
                                                    return (
                                                        <div key={s.id} className="flex items-center gap-1.5">
                                                            <span className={cn('w-20 shrink-0 whitespace-nowrap overflow-hidden text-clip text-right text-[9px] font-bold', slot && `text-rarity-${slot.rarity.toLowerCase()}`)}>
                                                                {prettyName(s.id)}
                                                            </span>
                                                            <div className="relative flex-1 h-6 rounded bg-bg-secondary/70 border border-border/30 overflow-hidden">
                                                                {isBuff && s.casts.map((c, i) => (
                                                                    <div key={`b${i}`} className="absolute top-[3px] bottom-[3px] bg-green-500/25 rounded-sm"
                                                                        style={{ left: `${(c / 10 / T) * 100}%`, width: `${(Math.min(dur, T - c / 10) / T) * 100}%` }} />
                                                                ))}
                                                                {s.casts.map((c, i) => {
                                                                    const lost = c > s.lastHitTick;
                                                                    return (
                                                                        <div
                                                                            key={i}
                                                                            title={`Cast ${i + 1} at ${sec(c)}s${lost ? ', nothing landed before the timer' : ''}`}
                                                                            className={cn('absolute top-0 bottom-0', lost ? 'w-[3px] bg-amber-400' : isBuff ? 'w-[2px] bg-green-400/70' : 'w-[2px] bg-red-400/80')}
                                                                            style={{ left: `calc(${(c / 10 / T) * 100}% - 1px)` }}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-20 shrink-0" />
                                                    <div className="relative flex-1 h-3 text-[8px] font-mono text-text-muted">
                                                        <span className="absolute left-0">0s</span>
                                                        <span className="absolute" style={{ left: '50%', transform: 'translateX(-50%)' }}>{(T / 2).toFixed(0)}s</span>
                                                        <span className="absolute right-0">{T}s</span>
                                                    </div>
                                                </div>
                                                <span className="text-[9px] text-text-muted">At {pct(shownR)}. Red: a hit skill cast, green: a buff and its active time, amber: a cast that landed nothing before the timer.</span>
                                            </div>
                                        </Section>
                                    )}

                                    <Section title="Cooldown breakpoints">
                                        <CooldownBreakpoints
                                            skills={equipped.map(s => ({ id: s.id, baseCd: skillLibrary?.[s.id]?.Cooldown || 0, duration: skillLibrary?.[s.id]?.ActiveDuration || 0 }))}
                                            currentR={currentR}
                                        />
                                    </Section>
                                </>
                            )}
                            <p className="pt-2 border-t border-border/40 text-[9px] text-text-muted leading-snug">
                                Measured by the combat engine: a PvP battle against a dummy that never attacks, never dies and has no dodge
                                or block. Skills run on time alone: the first cast after the fixed 4.0 s charge, then every active + cooldown
                                phase, whatever the walk. Only damage that reaches the dummy before the timer counts. Skills never crit, so the skill
                                damage is exact for the run. Sweep: 0 to {pct(SWEEP_MAX, 0)} in {pct(SWEEP_STEP)} steps.
                                {configDuration !== null && ` Battle length ${configDuration}s from PvpBaseConfig (PvpMatchTimerSeconds).`}
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

interface Analysis {
    current: PvpSkillRunResult;
    grid: { r: number; dmg: number }[];
    floor: number;
    next: { r: number; dmg: number } | null;
    maxDmg: number;
    target: PvpSkillRunResult | null;
}

function sweep(runner: (r: number) => PvpSkillRunResult, currentR: number): Analysis {
    const current = runner(currentR);
    const grid = Array.from({ length: GRID_N + 1 }, (_, i) => ({ r: i * SWEEP_STEP, dmg: runner(i * SWEEP_STEP).skillDamage }));
    // Lowest reduction that still gives the current skill damage (the start of its plateau).
    let floor = currentR;
    for (let i = grid.length - 1; i >= 0; i--) {
        if (grid[i].r > currentR + 1e-12) continue;
        if (same(grid[i].dmg, current.skillDamage)) floor = grid[i].r; else break;
    }
    // Next reduction above the current one that lands more skill damage.
    const next = grid.find(g => g.r > currentR + 1e-12 && g.dmg > current.skillDamage && !same(g.dmg, current.skillDamage)) ?? null;
    const maxDmg = grid.reduce((m, g) => Math.max(m, g.dmg), 0);
    const target = next ? runner(next.r) : null;
    return { current, grid, floor, next, maxDmg, target };
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'green' | 'amber' }) {
    return (
        <div className={cn(
            'rounded-lg border px-2.5 py-2 bg-bg-input/40',
            tone === 'green' ? 'border-green-500/30' : tone === 'amber' ? 'border-amber-500/40' : 'border-border/50'
        )}>
            <div className="text-[9px] uppercase font-bold tracking-wide text-text-muted">{label}</div>
            <div className={cn('text-base font-mono font-bold', tone === 'green' ? 'text-green-400' : tone === 'amber' ? 'text-amber-400' : 'text-text-primary')}>{value}</div>
            {hint && <div className="text-[9px] text-text-muted leading-tight">{hint}</div>}
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded bg-bg-secondary/60 py-1">
            <div className="text-[11px] font-mono font-bold text-text-primary">{value}</div>
            <div className="text-[8px] uppercase text-text-muted">{label}</div>
        </div>
    );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-text-muted uppercase font-bold tracking-wide">{title}</span>
                {right}
            </div>
            {children}
        </div>
    );
}

/** Skill damage against the reduction, as a step line, with the current and next reductions marked. */
function SweepChart({ grid, maxDmg, currentR, nextR }: { grid: { r: number; dmg: number }[]; maxDmg: number; currentR: number; nextR: number | null }) {
    if (maxDmg <= 0) return null;
    const min = grid.reduce((m, g) => Math.min(m, g.dmg), Infinity);
    const span = Math.max(maxDmg - min, maxDmg * 1e-6);
    const W = 500, H = 60;
    const x = (r: number) => (r / SWEEP_MAX) * W;
    const y = (d: number) => H - 4 - ((d - min) / span) * (H - 8);
    const points = grid.map(g => `${x(g.r).toFixed(1)},${y(g.dmg).toFixed(1)}`).join(' ');
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-text-muted uppercase font-bold tracking-wide">Skill damage by reduction</span>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-24 rounded bg-bg-secondary/70 border border-border/30" data-testid="skills-cycle-chart">
                <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-primary" vectorEffect="non-scaling-stroke" />
                {currentR <= SWEEP_MAX && <line x1={x(currentR)} x2={x(currentR)} y1={0} y2={H} stroke="currentColor" className="text-text-primary" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
                {nextR !== null && <line x1={x(nextR)} x2={x(nextR)} y1={0} y2={H} stroke="currentColor" className="text-green-400" vectorEffect="non-scaling-stroke" />}
            </svg>
            <div className="flex justify-between text-[8px] font-mono text-text-muted">
                <span>0% ({formatCompactNumber(grid[0].dmg)})</span>
                <span>dashed: you, green: next gain</span>
                <span>{pct(SWEEP_MAX, 0)} ({formatCompactNumber(grid[grid.length - 1].dmg)})</span>
            </div>
        </div>
    );
}
