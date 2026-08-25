import { useMemo, useState } from 'react';
import { ChevronDown, Timer } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { SkillSlot } from '../../types/Profile';
import { Input } from '../UI/Input';
import { cn } from '../../lib/utils';

/**
 * ==== Cast timing model (mirrors the app's battle engine — do not change independently) ====
 * - Every skill starts in 'Startup' with timer 3.2s, so the FIRST cast lands at t = 3.2s
 *   (BattleEngine.ts -> addSkill: state 'Startup', timer 3.2).
 * - After a cast the skill goes 'Active' for ActiveDuration (if > 0), THEN 'Cooldown' for
 *   the effective cooldown, then fires again (BattleEngine.ts update loop), so:
 *       cast_n = 3.2 + n * (ActiveDuration + cooldown_eff)
 * - cooldown_eff = max(0.5, Cooldown * (1 - reduction))
 *   (BattleVisualizerModal.tsx / BattleSimulator.ts).
 */
const START_TIME = 3.2;
const MIN_COOLDOWN = 0.5;
const EPS = 1e-9;

/** Same list BattleVisualizerModal / BattleSimulator use to separate buffs from damage casts */
const BUFF_SKILLS = ['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale'];

const SWEEP_STEP = 0.001; // 0.1%
const SWEEP_MAX = 0.25;   // 25% (SkillCooldownMulti rolls are 1%–7% each, 3+ sources stack)
const GRID_N = Math.round(SWEEP_MAX / SWEEP_STEP);

interface CastInfo { count: number; last: number; period: number; }
interface CycleWindow { from: number; to: number; casts: number; }

function castModel(T: number, baseCd: number, duration: number, r: number): CastInfo {
    const period = Math.max(MIN_COOLDOWN, baseCd * (1 - r)) + duration;
    if (T <= START_TIME || period <= 0) return { count: 0, last: -1, period };
    const n = Math.floor((T - START_TIME - EPS) / period);
    return { count: n + 1, last: START_TIME + n * period, period };
}

function landsInFinalSecond(T: number, info: CastInfo): boolean {
    // last cast lands inside the final second: [T-1, T)
    return info.count > 0 && info.last >= T - 1 - EPS && info.last < T;
}

function castTimes(T: number, baseCd: number, duration: number, r: number): number[] {
    const { count, period } = castModel(T, baseCd, duration, r);
    const times: number[] = [];
    for (let n = 0; n < Math.min(count, 200); n++) times.push(START_TIME + n * period);
    return times;
}

function pct(r: number, decimals = 1): string {
    return `${(r * 100).toFixed(decimals)}%`;
}

function prettyName(id: string): string {
    return id.replace(/([a-z])([A-Z])/g, '$1 $2');
}

interface SkillAdvice {
    id: string;
    rarity: string;
    baseCd: number;
    duration: number;
    isBuff: boolean;
    windows: CycleWindow[];
    current: CastInfo & { inWindow: boolean };
    nearest: { window: CycleWindow; delta: number } | null;
    coverage: { pct: number; lastSecCovered: boolean } | null;
}

interface SkillsCycleProps {
    skills: SkillSlot[];
}

export function SkillsCycle({ skills }: SkillsCycleProps) {
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const globalStats = useGlobalStats();

    const [expanded, setExpanded] = useState(false);
    const [customLen, setCustomLen] = useState<number | null>(null);
    const [timelineMode, setTimelineMode] = useState<'current' | 'target'>('current');

    const configDuration = typeof pvpBaseConfig?.PvpMatchTimerSeconds === 'number'
        ? pvpBaseConfig.PvpMatchTimerSeconds
        : null;
    const T = customLen ?? configDuration ?? 60;
    const isGameDefault = configDuration !== null && T === configDuration;
    const currentR = globalStats?.skillCooldownReduction ?? 0;

    const analysis = useMemo(() => {
        if (!skillLibrary || skills.length === 0 || !isFinite(T) || T <= START_TIME + 1) return null;

        const perSkill: SkillAdvice[] = [];
        for (const slot of skills) {
            const cfg = skillLibrary[slot.id];
            if (!cfg) continue;
            const baseCd = cfg.Cooldown || 0;
            const duration = cfg.ActiveDuration || 0;
            const isBuff = BUFF_SKILLS.includes(cfg.Type || slot.id) && duration > 0;

            // Sweep 0 -> 25% at 0.1% steps, merge contiguous aligned steps (same cast count) into windows
            const windows: CycleWindow[] = [];
            if (!isBuff && baseCd > 0) {
                let open: CycleWindow | null = null;
                for (let i = 0; i <= GRID_N; i++) {
                    const r = i * SWEEP_STEP;
                    const info = castModel(T, baseCd, duration, r);
                    if (landsInFinalSecond(T, info)) {
                        if (open && open.casts === info.count && Math.round(open.to / SWEEP_STEP) === i - 1) {
                            open.to = r;
                        } else {
                            open = { from: r, to: r, casts: info.count };
                            windows.push(open);
                        }
                    } else {
                        open = null;
                    }
                }
            }

            const now = castModel(T, baseCd, duration, currentR);
            const inWindow = !isBuff && landsInFinalSecond(T, now);

            let nearest: SkillAdvice['nearest'] = null;
            if (!isBuff && !inWindow && windows.length > 0) {
                let bestW = windows[0];
                let bestDist = Infinity;
                let bestDelta = 0;
                for (const w of windows) {
                    const delta = currentR < w.from ? w.from - currentR : (currentR > w.to ? w.to - currentR : 0);
                    if (Math.abs(delta) < bestDist) {
                        bestDist = Math.abs(delta);
                        bestW = w;
                        bestDelta = delta;
                    }
                }
                nearest = { window: bestW, delta: bestDelta };
            }

            let coverage: SkillAdvice['coverage'] = null;
            if (isBuff) {
                const { count, period } = castModel(T, baseCd, duration, currentR);
                let uptime = 0;
                let lastSecCovered = false;
                for (let n = 0; n < count; n++) {
                    const t0 = START_TIME + n * period;
                    uptime += Math.max(0, Math.min(duration, T - t0));
                    if (t0 < T && t0 + duration > T - 1) lastSecCovered = true;
                }
                coverage = { pct: uptime / T, lastSecCovered };
            }

            perSkill.push({
                id: slot.id, rarity: slot.rarity, baseCd, duration, isBuff,
                windows, current: { ...now, inWindow }, nearest, coverage
            });
        }

        // Combined recommendation across DAMAGE skills only
        const dmgSkills = perSkill.filter(s => !s.isBuff && s.baseCd > 0);
        let combined: {
            allAligned: boolean;
            score: number;
            of: number;
            ranges: { from: number; to: number; totalCasts: number }[];
            best: { from: number; to: number; totalCasts: number };
            recommendedR: number;
            currentScore: number;
        } | null = null;

        if (dmgSkills.length > 0) {
            const scoreAt = (r: number) => {
                let score = 0, total = 0;
                for (const s of dmgSkills) {
                    const info = castModel(T, s.baseCd, s.duration, r);
                    if (landsInFinalSecond(T, info)) score++;
                    total += info.count;
                }
                return { score, total };
            };

            const grid = Array.from({ length: GRID_N + 1 }, (_, i) => scoreAt(i * SWEEP_STEP));
            const maxScore = grid.reduce((m, g) => Math.max(m, g.score), 0);

            if (maxScore > 0) {
                const ranges: { from: number; to: number; totalCasts: number }[] = [];
                let open: { from: number; to: number; totalCasts: number } | null = null;
                for (let i = 0; i <= GRID_N; i++) {
                    if (grid[i].score === maxScore) {
                        const r = i * SWEEP_STEP;
                        if (open && Math.round(open.to / SWEEP_STEP) === i - 1) {
                            open.to = r;
                            open.totalCasts = Math.max(open.totalCasts, grid[i].total);
                        } else {
                            open = { from: r, to: r, totalCasts: grid[i].total };
                            ranges.push(open);
                        }
                    } else {
                        open = null;
                    }
                }

                // Pick best range: highest total cast count, tie-break nearest to current reduction
                const distTo = (g: { from: number; to: number }) =>
                    currentR < g.from ? g.from - currentR : (currentR > g.to ? currentR - g.to : 0);
                let best = ranges[0];
                for (const g of ranges) {
                    if (g.totalCasts > best.totalCasts) best = g;
                    else if (g.totalCasts === best.totalCasts && distTo(g) < distTo(best)) best = g;
                }

                const atCurrent = scoreAt(currentR);
                const currentIsOptimal = atCurrent.score === maxScore;
                const recommendedR = currentIsOptimal ? currentR : (best.from + best.to) / 2;

                combined = {
                    allAligned: maxScore === dmgSkills.length,
                    score: maxScore,
                    of: dmgSkills.length,
                    ranges,
                    best,
                    recommendedR,
                    currentScore: atCurrent.score
                };
            } else {
                combined = {
                    allAligned: false, score: 0, of: dmgSkills.length,
                    ranges: [], best: { from: currentR, to: currentR, totalCasts: 0 },
                    recommendedR: currentR,
                    currentScore: 0
                };
            }
        }

        return { perSkill, dmgSkills, combined };
    }, [skillLibrary, skills, T, currentR]);

    if (!analysis || analysis.perSkill.length === 0) return null;

    const { perSkill, combined } = analysis;
    const recommendedR = combined?.recommendedR ?? currentR;
    const shownR = timelineMode === 'target' ? recommendedR : currentR;
    const currentOptimal = combined !== null && combined.currentScore === combined.score && combined.score > 0;
    const headerStatus = combined === null
        ? null
        : currentOptimal
            ? { label: combined.allAligned ? 'ALIGNED' : `${combined.currentScore}/${combined.of} ALIGNED`, className: 'bg-green-500/15 text-green-400 border-green-500/30' }
            : { label: combined.score > 0 ? `GO ${pct(recommendedR)}` : 'NO WINDOW', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };

    return (
        <div className="rounded-xl border border-border bg-bg-input/30 overflow-hidden">
            {/* Header (collapsible) */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-bg-input/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-accent-primary" />
                    <span className="text-xs font-bold text-text-primary uppercase tracking-wide">Skills Cycle</span>
                    <span className="text-[10px] font-mono text-text-muted">CDR {pct(currentR)}</span>
                </div>
                <div className="flex items-center gap-2">
                    {headerStatus && (
                        <span className={cn('text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border', headerStatus.className)}>
                            {headerStatus.label}
                        </span>
                    )}
                    <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform', expanded && 'rotate-180')} />
                </div>
            </button>

            {expanded && (
                <div className="px-3 pb-3 flex flex-col gap-3">
                    {/* Battle length + current reduction */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 bg-bg-input/50 p-1 rounded border border-border/30">
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
                            {isGameDefault && (
                                <span className="text-[9px] text-green-400/80 pr-1 whitespace-nowrap">(game default)</span>
                            )}
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
                        <span className="text-[10px] text-text-secondary font-mono">
                            Your reduction: <span className="font-bold text-text-primary">{pct(currentR, 2)}</span>
                        </span>
                    </div>

                    {/* Combined recommendation */}
                    {combined && (
                        <div className={cn(
                            'rounded p-2 border text-[11px] leading-snug',
                            currentOptimal
                                ? 'bg-green-500/10 border-green-500/25 text-green-400'
                                : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                        )}>
                            {combined.score === 0 ? (
                                <span>No reduction &le; {pct(SWEEP_MAX, 0)} lands a final cast in the last second for any damage skill at {T}s.</span>
                            ) : (
                                <>
                                    <span className="font-bold">
                                        {combined.allAligned
                                            ? `All ${combined.of} damage skill${combined.of > 1 ? "s" : ""} land a final cast`
                                            : `Best compromise: ${combined.score}/${combined.of} damage skills land a final cast`}
                                    </span>
                                    <span className="text-text-secondary"> at </span>
                                    <span className="font-mono font-bold">
                                        {combined.best.from === combined.best.to
                                            ? pct(combined.best.from)
                                            : `${pct(combined.best.from)}-${pct(combined.best.to)}`}
                                    </span>
                                    {currentOptimal ? (
                                        <span>. You are in the window.</span>
                                    ) : (
                                        <span>
                                            {' '}— you are at <span className="font-mono">{pct(currentR)}</span>, adjust by{' '}
                                            <span className="font-mono font-bold">
                                                {recommendedR >= currentR ? '+' : '−'}{pct(Math.abs(recommendedR - currentR))}
                                            </span>.
                                        </span>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Per-skill windows */}
                    <div className="flex flex-col gap-1.5">
                        {perSkill.map((s) => (
                            <div key={s.id} className="bg-bg-input/50 rounded p-2 border border-border/30">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-1.5">
                                        <span className={cn('text-[11px] font-bold', `text-rarity-${s.rarity.toLowerCase()}`)}>
                                            {prettyName(s.id)}
                                        </span>
                                        <span className="text-[9px] font-mono text-text-muted">
                                            CD {s.baseCd}s{s.duration > 0 ? ` · DUR ${s.duration}s` : ''}
                                        </span>
                                    </div>
                                    {s.isBuff ? (
                                        <span className={cn(
                                            'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border',
                                            s.coverage?.lastSecCovered
                                                ? 'bg-green-500/15 text-green-400 border-green-500/30'
                                                : 'bg-bg-secondary/50 text-text-secondary border-border/30'
                                        )}>
                                            BUFF · {((s.coverage?.pct ?? 0) * 100).toFixed(0)}% uptime{s.coverage?.lastSecCovered ? ' · covers final second' : ''}
                                        </span>
                                    ) : s.current.inWindow ? (
                                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border bg-green-500/15 text-green-400 border-green-500/30">
                                            IN WINDOW · last {s.current.last.toFixed(1)}s · {s.current.count} casts
                                        </span>
                                    ) : (
                                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
                                            {s.nearest
                                                ? `at ${pct(currentR)} → ${s.nearest.delta >= 0 ? '+' : '−'}${pct(Math.abs(s.nearest.delta))} to ${pct(s.nearest.window.from)}-${pct(s.nearest.window.to)}`
                                                : `no window ≤ ${pct(SWEEP_MAX, 0)}`}
                                            {' '}· last {s.current.last.toFixed(1)}s
                                        </span>
                                    )}
                                </div>
                                {!s.isBuff && s.windows.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap mt-1.5">
                                        {s.windows.map((w, i) => {
                                            const active = currentR >= w.from - EPS && currentR <= w.to + EPS;
                                            return (
                                                <span
                                                    key={i}
                                                    title={`${w.casts} casts, final one in the last second`}
                                                    className={cn(
                                                        'text-[9px] font-mono px-1.5 py-0.5 rounded border',
                                                        active
                                                            ? 'bg-green-500/20 text-green-400 border-green-500/40 font-bold'
                                                            : 'bg-bg-secondary/60 text-text-secondary border-border/40'
                                                    )}
                                                >
                                                    {pct(w.from)}-{pct(w.to)} <span className="opacity-70">({w.casts}x)</span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Timeline */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] text-text-muted uppercase font-bold tracking-wide">Cast timeline</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setTimelineMode('current')}
                                    className={cn(
                                        'px-2 py-0.5 text-[9px] font-bold font-mono rounded border transition-colors',
                                        timelineMode === 'current'
                                            ? 'bg-accent-primary text-black border-accent-primary'
                                            : 'bg-transparent text-text-muted border-border/40 hover:border-text-muted'
                                    )}
                                >
                                    CURRENT {pct(currentR)}
                                </button>
                                {combined && combined.score > 0 && (
                                    <button
                                        onClick={() => setTimelineMode('target')}
                                        className={cn(
                                            'px-2 py-0.5 text-[9px] font-bold font-mono rounded border transition-colors',
                                            timelineMode === 'target'
                                                ? 'bg-accent-primary text-black border-accent-primary'
                                                : 'bg-transparent text-text-muted border-border/40 hover:border-text-muted'
                                        )}
                                    >
                                        TARGET {pct(recommendedR)}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            {perSkill.map((s) => {
                                const times = castTimes(T, s.baseCd, s.duration, shownR);
                                const lastT = times.length > 0 ? times[times.length - 1] : -1;
                                return (
                                    <div key={s.id} className="flex items-center gap-1.5">
                                        <span className={cn('w-20 shrink-0 whitespace-nowrap overflow-hidden text-clip text-right text-[9px] font-bold', `text-rarity-${s.rarity.toLowerCase()}`)}>
                                            {prettyName(s.id)}
                                        </span>
                                        <div className="relative flex-1 h-5 rounded bg-bg-secondary/70 border border-border/30 overflow-hidden">
                                            {/* last-second zone */}
                                            <div
                                                className="absolute top-0 bottom-0 bg-red-500/20 border-l border-red-400/60"
                                                style={{ left: `${((T - 1) / T) * 100}%`, right: 0 }}
                                            />
                                            {/* buff duration bars */}
                                            {s.isBuff && times.map((t, i) => (
                                                <div
                                                    key={`b${i}`}
                                                    className="absolute top-[3px] bottom-[3px] bg-green-500/25 rounded-sm"
                                                    style={{
                                                        left: `${(t / T) * 100}%`,
                                                        width: `${(Math.min(s.duration, T - t) / T) * 100}%`
                                                    }}
                                                />
                                            ))}
                                            {/* cast ticks */}
                                            {times.map((t, i) => (
                                                <div
                                                    key={i}
                                                    title={`Cast ${i + 1} @ ${t.toFixed(1)}s`}
                                                    className={cn(
                                                        'absolute top-0 bottom-0',
                                                        t === lastT
                                                            ? (t >= T - 1 ? 'w-[3px] bg-green-400' : 'w-[3px] bg-amber-400')
                                                            : s.isBuff ? 'w-[2px] bg-green-400/70' : 'w-[2px] bg-red-400/80'
                                                    )}
                                                    style={{ left: `calc(${(t / T) * 100}% - 1px)` }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            {/* axis */}
                            <div className="flex items-center gap-1.5">
                                <span className="w-20 shrink-0" />
                                <div className="relative flex-1 h-3 text-[8px] font-mono text-text-muted">
                                    <span className="absolute left-0">0s</span>
                                    <span className="absolute" style={{ left: '50%', transform: 'translateX(-50%)' }}>{(T / 2).toFixed(0)}s</span>
                                    <span className="absolute" style={{ left: `${((T - 1) / T) * 100}%`, transform: 'translateX(-50%)' }} >{(T - 1).toFixed(0)}s</span>
                                    <span className="absolute right-0">{T}s</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Model footnote */}
                    <p className="text-[9px] text-text-muted leading-snug">
                        Engine model: first cast at {START_TIME}s (skill startup), then every eff. CD + active duration;
                        eff. CD = max({MIN_COOLDOWN}s, CD × (1 − reduction)). A skill is "aligned" when its final cast lands in
                        the last second [{(T - 1).toFixed(0)}-{T}s). Sweep: 0-{pct(SWEEP_MAX, 0)} in {pct(SWEEP_STEP)} steps.
                        {configDuration !== null && ` Battle length ${configDuration}s from PvpBaseConfig (PvpMatchTimerSeconds).`}
                    </p>
                </div>
            )}
        </div>
    );
}
