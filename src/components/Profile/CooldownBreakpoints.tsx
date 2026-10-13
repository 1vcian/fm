import { useMemo } from 'react';
import { cooldownBreakpoints, skillCycleTicks } from '../../engine/skills';
import { cn } from '../../lib/utils';

/**
 * Skill cooldown breakpoints: casts per minute against cooldown reduction, from the engine's
 * exact tick math (skill timers lose 0.099999 s per 0.1 s tick, every phase rounds up to whole
 * ticks). Reduction between two rows changes nothing; only crossing a row adds casts.
 *
 * Shown only for skills where one tick is worth at least 1% more casts, i.e. a cast cycle of at
 * most 100 ticks at the current reduction (short cooldowns); longer cycles step too finely to matter.
 */
const MAX_CYCLE_TICKS = 100;

interface Props {
    skills: { id: string; baseCd: number; duration: number }[];
    currentR: number;
}

const pct = (r: number, d = 1) => `${(r * 100).toFixed(d)}%`;
// A breakpoint is a minimum: round its reduction UP so the shown value always reaches it.
const pctUp = (r: number) => `${(Math.ceil(r * 1e4 - 1e-9) / 100).toFixed(2)}%`;
const prettyName = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');

export function CooldownBreakpoints({ skills, currentR }: Props) {
    const tables = useMemo(
        () =>
            skills
                .filter((s) => s.baseCd > 0 && skillCycleTicks(s.baseCd * (1 - currentR), s.duration) <= MAX_CYCLE_TICKS)
                .map((s) => ({ ...s, rows: cooldownBreakpoints(s.baseCd, s.duration, currentR, 5) })),
        [skills, currentR]
    );
    if (tables.length === 0) return null;

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[9px] text-text-muted uppercase font-bold tracking-wide">Cooldown breakpoints</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {tables.map((t) => {
                    const base = t.rows[0].castsPerMinute;
                    return (
                        <div key={t.id} className="bg-bg-input/50 rounded border border-border/30 overflow-hidden min-w-0">
                            <div className="px-2 py-1 text-[10px] font-bold text-text-primary border-b border-border/30">
                                {prettyName(t.id)} <span className="font-mono font-normal text-text-muted">CD {t.baseCd}s</span>
                            </div>
                            <table className="w-full text-[9px] font-mono">
                                <thead>
                                    <tr className="text-text-muted">
                                        <th className="text-left font-semibold px-2 py-0.5">Reduction</th>
                                        <th className="text-right font-semibold px-2 py-0.5">Cycle</th>
                                        <th className="text-right font-semibold px-2 py-0.5">Casts/min</th>
                                        <th className="text-right font-semibold px-2 py-0.5">Gain</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {t.rows.map((r, i) => (
                                        <tr key={i} className={cn(i === 0 ? 'text-green-400 bg-green-500/10' : 'text-text-secondary')}>
                                            <td className="px-2 py-0.5">{i === 0 ? `now ${pct(r.reduction)}` : pctUp(r.reduction)}</td>
                                            <td className="text-right px-2 py-0.5">{(r.cycleTicks / 10).toFixed(1)}s</td>
                                            <td className="text-right px-2 py-0.5">{r.castsPerMinute.toFixed(2)}</td>
                                            <td className="text-right px-2 py-0.5">{i === 0 ? '' : `+${pct(r.castsPerMinute / base - 1)}`}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })}
            </div>
            <p className="text-[9px] text-text-muted leading-snug">
                Skill timers run in 0.1s ticks, so the cooldown only shortens one whole tick at a time: reduction between two rows
                adds no casts. Listed for skills whose cycle is {MAX_CYCLE_TICKS / 10}s or less, where one tick is worth 1% or more.
            </p>
        </div>
    );
}
