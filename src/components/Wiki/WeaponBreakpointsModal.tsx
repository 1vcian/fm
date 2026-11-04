import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { attackCycleTicks, doubleCycleTicks, doubleSecondStrikeSeconds } from '../../utils/constants';
import { cn } from '../../lib/utils';

/** Attack speed bonus searched, in % (the Attack page's slider goes to the same). */
const SPEED_MAX = 500;
/** Breakpoints are given to 3 decimals: the smallest bonus, in steps of 0.001%, that reaches them. */
const FINE = 1000;

/**
 * Every bonus (to 0.001%) where `ticks` reaches a new low, from +0% to +SPEED_MAX%. A coarse pass in
 * steps of 1% finds the stretches where it drops, and only those are walked at 0.001%, so the
 * modal opens at once instead of evaluating half a million speeds.
 */
function breakpoints(ticks: (mult: number) => number): { bonus: number; ticks: number }[] {
    const at = (b: number) => ticks(1 + b / 100);
    const out = [{ bonus: 0, ticks: at(0) }];
    let best = out[0].ticks;
    for (let b = 1; b <= SPEED_MAX; b++) {
        if (at(b) >= best) continue;
        for (let i = (b - 1) * FINE + 1; i <= b * FINE; i++) {
            const t = at(i / FINE);
            if (t < best) { best = t; out.push({ bonus: i / FINE, ticks: t }); }
        }
    }
    return out;
}

export interface BreakpointWeapon {
    name: string;
    windup: number;
    duration: number;
    ranged: boolean;
}

/**
 * The attack-speed breakpoints of one weapon or skin: the normal attack (the same for every weapon
 * with the same Attack Duration) and the double attack, which depends on the windup. The rows
 * reached at `bonus` are marked, and the next one to aim for.
 */
export function WeaponBreakpointsModal({ weapon, bonus, onClose, icon }: { weapon: BreakpointWeapon; bonus: number; onClose: () => void; icon?: ReactNode }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const normal = useMemo(() => breakpoints(m => attackCycleTicks(m, weapon.duration)), [weapon.duration]);
    const double = useMemo(() => breakpoints(m => doubleCycleTicks(m, weapon.windup, weapon.duration))
        .map(r => {
            const gap = doubleSecondStrikeSeconds(1 + r.bonus / 100, weapon.windup);
            return { ...r, gap, rest: r.ticks / 10 - gap };
        }), [weapon.windup, weapon.duration]);

    /** Index of the row reached at `bonus` (the last threshold at or under it). */
    const reached = (rows: { bonus: number }[]) => rows.reduce((k, r, i) => (r.bonus <= bonus + 1e-9 ? i : k), 0);
    const nRow = reached(normal), dRow = reached(double);
    const status = (i: number, cur: number) => (i === cur ? 'yours' : i === cur + 1 ? 'next' : '');
    const rowCls = (i: number, cur: number) => cn(i === cur && 'bg-accent-primary/15 text-accent-primary', i === cur + 1 && 'text-amber-200');
    const pctTxt = (b: number) => `${b.toFixed(3)}%`;

    return createPortal(
        <div className="fixed inset-0 z-[90] flex items-start md:items-center justify-center bg-black/80 backdrop-blur-sm p-2 md:p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-label={`${weapon.name} breakpoints`} className="bg-bg-primary text-text-primary w-full max-w-3xl max-h-[95dvh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    {icon}
                    <div className="flex-1 min-w-0">
                        <h2 className="font-black text-lg leading-tight">{weapon.name} breakpoints</h2>
                        <div className="text-[11px] text-text-muted">
                            {weapon.ranged ? 'Ranged' : 'Melee'}, windup {weapon.windup.toFixed(3)} s, attack duration {weapon.duration.toFixed(3)} s. Marked at your +{bonus}% attack speed.
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                    <section className="space-y-2">
                        <h3 className="font-bold text-sm">Normal attack</h3>
                        <p className="text-[11px] text-text-muted">Time from one hit to the next. It depends on the attack duration only, not on the windup.</p>
                        <table className="w-full font-mono border border-white/5 rounded-lg overflow-hidden">
                            <thead><tr className="text-text-muted text-[10px] uppercase border-b border-white/5">
                                <th className="p-2 text-left">From</th><th className="p-2 text-left">Cycle</th><th className="p-2 text-left">Ticks</th><th className="p-2 text-left" />
                            </tr></thead>
                            <tbody className="divide-y divide-white/5">
                                {normal.map((r, i) => (
                                    <tr key={r.bonus} className={rowCls(i, nRow)}>
                                        <td className="p-2 font-bold">+{pctTxt(r.bonus)}</td>
                                        <td className="p-2">{(r.ticks / 10).toFixed(2)} s</td>
                                        <td className="p-2">{r.ticks}</td>
                                        <td className="p-2 text-[10px] uppercase font-sans font-bold">{status(i, nRow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                    <section className="space-y-2">
                        <h3 className="font-bold text-sm">Double attack</h3>
                        <p className="text-[11px] text-text-muted">Full sequence: first hit to the next normal hit. The second hit comes after the gap, then the rest of the attack.</p>
                        <table className="w-full font-mono border border-white/5 rounded-lg overflow-hidden">
                            <thead><tr className="text-text-muted text-[10px] uppercase border-b border-white/5">
                                <th className="p-2 text-left">From</th><th className="p-2 text-left">Sequence</th><th className="p-2 text-left">1st to 2nd</th><th className="p-2 text-left">2nd to next</th><th className="p-2 text-left" />
                            </tr></thead>
                            <tbody className="divide-y divide-white/5">
                                {double.map((r, i) => (
                                    <tr key={r.bonus} className={rowCls(i, dRow)}>
                                        <td className="p-2 font-bold">+{pctTxt(r.bonus)}</td>
                                        <td className="p-2">{(r.ticks / 10).toFixed(2)} s</td>
                                        <td className="p-2">{r.gap.toFixed(2)} s</td>
                                        <td className="p-2">{r.rest.toFixed(2)} s</td>
                                        <td className="p-2 text-[10px] uppercase font-sans font-bold">{status(i, dRow)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                    <p className="lg:col-span-2 text-[11px] text-text-muted">
                        Battles run in ticks of 0.1 s, so attack speed only helps when it removes a tick. "From" is the smallest bonus, to 0.001%, that reaches the row.
                    </p>
                </div>
            </div>
        </div>,
        document.body,
    );
}
