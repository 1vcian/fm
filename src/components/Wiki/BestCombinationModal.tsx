import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { attackCycleTicks, doubleCycleTicks, weaponHitsPerSecond } from '../../utils/constants';
import { breakpoints, Slider, SPEED_MAX } from './WeaponBreakpointsModal';
import { cn } from '../../lib/utils';

export interface Rival {
    key: string;
    name: string;
    windup: number;
    duration: number;
}

/** Where one weapon stands over a stretch of attack speeds at one double chance. */
interface Range {
    from: number;
    /** Exclusive, except the last range, which ends at +SPEED_MAX% included. */
    to: number;
    status: 'alone' | 'shared' | 'behind';
    /** The other rows with the same hits per second, when shared. */
    with: string[];
    /** Hits per second under the best, as a fraction (the largest in the range), when behind. */
    behind: number;
}

/** Double chances (%) with the same ranges: one block of the modal. */
interface Group {
    lo: number;
    hi: number;
    ranges: Range[];
}

const TIE = 1e-12;
const pctTxt = (b: number) => `+${Number.isInteger(b) ? b : b.toFixed(3)}%`;

/**
 * Every attack speed (to 0.001%) and double chance (in steps of 1%) where `target` has the most
 * hits per second among `rivals`. Hits per second only change where a normal or a double cycle
 * drops a tick, so the attack-speed axis is cut at every breakpoint of every rival (the same
 * breakpoints as the Breakpoints modal) and each piece is compared once.
 */
function bestMap(target: Rival, rivals: Rival[]): Group[] {
    const pairKey = (r: { windup: number; duration: number }) => `${r.windup}|${r.duration}`;
    const pairs = [...new Map(rivals.map(r => [pairKey(r), { windup: r.windup, duration: r.duration }])).values()];
    const durations = [...new Set(rivals.map(r => r.duration))];

    const cuts = new Set<number>([0]);
    for (const d of durations) for (const b of breakpoints(m => attackCycleTicks(m, d))) cuts.add(b.bonus);
    for (const p of pairs) for (const b of breakpoints(m => doubleCycleTicks(m, p.windup, p.duration))) cuts.add(b.bonus);
    const starts = [...cuts].sort((a, b) => a - b);

    // Ticks are constant on each piece: read them at its start.
    const pieces = starts.map((from, i) => {
        const m = 1 + from / 100;
        const single = new Map(durations.map(d => [d, attackCycleTicks(m, d)]));
        const dbl = new Map(pairs.map(p => [pairKey(p), doubleCycleTicks(m, p.windup, p.duration)]));
        return { from, to: starts[i + 1] ?? SPEED_MAX, single, dbl };
    });

    const groups: Group[] = [];
    let lastSig = '';
    for (let pct = 0; pct <= 100; pct++) {
        const dc = pct / 100;
        const ranges: Range[] = [];
        for (const piece of pieces) {
            const hits = (r: Rival) => (1 + dc) / ((1 - dc) * piece.single.get(r.duration)! + dc * piece.dbl.get(pairKey(r))!);
            const all = rivals.map(r => ({ r, h: hits(r) }));
            const top = Math.max(...all.map(x => x.h));
            const mine = hits(target);
            const best = mine >= top - TIE;
            const others = best ? all.filter(x => x.r.key !== target.key && x.h >= top - TIE).map(x => x.r.name) : [];
            const status: Range['status'] = !best ? 'behind' : others.length ? 'shared' : 'alone';
            const behind = best ? 0 : 1 - mine / top;
            const prev = ranges[ranges.length - 1];
            if (prev && prev.status === status && prev.with.join() === others.join()) {
                prev.to = piece.to;
                prev.behind = Math.max(prev.behind, behind);
            } else {
                ranges.push({ from: piece.from, to: piece.to, status, with: others, behind });
            }
        }
        const sig = JSON.stringify(ranges.map(r => [r.from, r.status, r.with]));
        if (sig === lastSig) groups[groups.length - 1].hi = pct;
        else groups.push({ lo: pct, hi: pct, ranges });
        lastSig = sig;
    }
    return groups;
}

/** Names, shortened after three. */
const namesTxt = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '));

/**
 * The best ranges joined where they touch, so a stretch where the weapon stays on top reads as one
 * line however often the rows tied with it change (the bar shows each piece).
 */
function stretchesOf(ranges: Range[], others: number): { from: number; to: number; alone: number; text: string }[] {
    const out: { from: number; to: number; parts: Range[] }[] = [];
    for (const r of ranges) {
        if (r.status === 'behind') continue;
        const last = out[out.length - 1];
        if (last && last.to === r.from) { last.to = r.to; last.parts.push(r); } else out.push({ from: r.from, to: r.to, parts: [r] });
    }
    return out.map(st => {
        const width = st.to - st.from;
        const aloneWidth = st.parts.filter(r => r.status === 'alone').reduce((n, r) => n + r.to - r.from, 0);
        const alone = width > 0 ? aloneWidth / width : 1;
        const shared = st.parts.filter(r => r.status === 'shared');
        const always = shared.length ? shared.map(r => r.with).reduce((a, b) => a.filter(x => b.includes(x))) : [];
        let text: string;
        if (alone >= 1) text = 'best alone';
        else if (shared.every(r => r.with.length === others)) text = alone > 0 ? `best: alone on ${Math.round(alone * 100)}% of it, every row ties on the rest` : 'every row ties';
        else if (alone > 0) text = `best: alone on ${Math.round(alone * 100)}% of it, tied on the rest`;
        else text = always.length && shared.every(r => r.with.join() === always.join()) ? `tied with ${namesTxt(always)}` : `tied for best${always.length ? `, always with ${namesTxt(always)}` : ''}`;
        return { from: st.from, to: st.to, alone, text };
    });
}

const COLORS: Record<Range['status'], string> = {
    alone: 'bg-green-500',
    shared: 'bg-emerald-300/70',
    behind: 'bg-red-400',
};

/**
 * "Find the best combination" for one weapon or skin: the attack speeds and double chances where
 * it has the most hits per second among the rows the ranking shows. "Go there" moves the
 * page's sliders there.
 */
export function BestCombinationModal({ target, rivals, kind, bonus, doublePct, onBonus, onDouble, onClose, icon }: {
    target: Rival;
    rivals: Rival[];
    kind: string;
    bonus: number;
    doublePct: number;
    onBonus: (v: number) => void;
    onDouble: (v: number) => void;
    onClose: () => void;
    icon?: ReactNode;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const groups = useMemo(() => bestMap(target, rivals), [target, rivals]);
    /** Where the sliders are: the range holding the bonus, at the slider's double chance. */
    const now = useMemo(() => {
        const g = groups.find(x => doublePct >= x.lo && doublePct <= x.hi);
        const r = g?.ranges.find(x => bonus >= x.from && (bonus < x.to || x.to === SPEED_MAX));
        if (!r) return null;
        if (r.status !== 'behind') return r;
        // A merged range keeps its largest gap: the gap at the sliders is read here.
        const hits = (x: Rival) => weaponHitsPerSecond(1 + bonus / 100, x.windup, x.duration, doublePct / 100);
        const top = Math.max(...rivals.map(hits));
        return { ...r, behind: 1 - hits(target) / top };
    }, [groups, bonus, doublePct, rivals, target]);
    const everywhere = groups.every(g => g.ranges.every(r => r.status !== 'behind'));
    const nowhere = groups.every(g => g.ranges.every(r => r.status === 'behind'));
    const dcTxt = (g: Group) => (g.lo === g.hi ? `${g.lo}% double chance` : `${g.lo}% to ${g.hi}% double chance`);

    return createPortal(
        <div className="fixed inset-0 z-[90] flex items-start md:items-center justify-center bg-black/80 backdrop-blur-sm p-2 md:p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-label={`Where ${target.name} is best`} className="bg-bg-primary text-text-primary w-full max-w-3xl max-h-[95dvh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    {icon}
                    <div className="flex-1 min-w-0">
                        <h2 className="font-black text-lg leading-tight">Where {target.name} is best</h2>
                        <div className="text-[11px] text-text-muted">
                            {kind}, windup {target.windup.toFixed(3)} s. Compared by hits per second with the {rivals.length - 1} other {kind.toLowerCase()} rows the ranking shows, from +0% to +{SPEED_MAX}% attack speed.
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-4 py-3 border-b border-border flex flex-wrap gap-x-6 gap-y-2">
                    <Slider label="Attack speed bonus" value={bonus} max={SPEED_MAX} onChange={onBonus} suffix="%" />
                    <Slider label="Double chance" value={doublePct} max={100} onChange={onDouble} suffix="" />
                    {now && (
                        <div className="w-full text-[11px] text-text-secondary">
                            At +{bonus}% and {doublePct}% double, {target.name} is{' '}
                            <span className={cn('font-bold', now.status === 'behind' ? 'text-red-300' : 'text-green-400')}>
                                {now.status === 'alone' ? 'the best alone' : now.status === 'shared' ? (now.with.length === rivals.length - 1 ? 'tied with every row' : `tied for best with ${namesTxt(now.with)}`) : `${(now.behind * 100).toFixed(1)}% behind the best`}
                            </span>.
                        </div>
                    )}
                </div>
                <div className="px-4 py-2 border-b border-border flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
                    <span className="flex items-center gap-1.5"><span className={cn('w-3 h-3 rounded-sm', COLORS.alone)} /> Best, alone</span>
                    <span className="flex items-center gap-1.5"><span className={cn('w-3 h-3 rounded-sm', COLORS.shared)} /> Best, tied with others</span>
                    <span className="flex items-center gap-1.5"><span className={cn('w-3 h-3 rounded-sm', COLORS.behind)} /> Behind (darker: further behind)</span>
                    <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-white" /> Your sliders</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 text-xs">
                    {everywhere && <p className="text-green-400 font-semibold">Best at every attack speed and double chance in the range.</p>}
                    {nowhere && <p className="text-red-300 font-semibold">Never the best among the rows shown: another windup always has at least as many hits per second, and more somewhere.</p>}
                    {groups.map(g => {
                        const mine = doublePct >= g.lo && doublePct <= g.hi;
                        const stretches = stretchesOf(g.ranges, rivals.length - 1);
                        return (
                            <section key={g.lo} className={cn('rounded-xl border p-3 space-y-2', mine ? 'border-accent-primary/50 bg-accent-primary/5' : 'border-white/5')}>
                                <h3 className="font-bold text-sm">{dcTxt(g)}</h3>
                                <div className="relative h-5 rounded-md overflow-hidden flex bg-bg-input">
                                    {g.ranges.map(r => (
                                        <div key={r.from} title={`${pctTxt(r.from)} to ${pctTxt(r.to)}: ${r.status === 'behind' ? `up to ${(r.behind * 100).toFixed(1)}% behind` : r.status === 'alone' ? 'best alone' : `best with ${r.with.join(', ')}`}`}
                                            className={COLORS[r.status]}
                                            style={{ width: `${((r.to - r.from) / SPEED_MAX) * 100}%`, opacity: r.status === 'behind' ? 0.25 + Math.min(r.behind / 0.2, 1) * 0.75 : 1 }} />
                                    ))}
                                    {mine && <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${(bonus / SPEED_MAX) * 100}%` }} />}
                                </div>
                                <div className="flex justify-between text-[10px] text-text-muted font-mono"><span>+0%</span><span>+{SPEED_MAX / 2}%</span><span>+{SPEED_MAX}%</span></div>
                                {!stretches.length
                                    ? <div className="text-text-muted">Never the best at these double chances.</div>
                                    : (
                                        <ul className="space-y-1">
                                            {stretches.map(st => {
                                                // The sliders move in whole percents: the first one inside the stretch, if any.
                                                const at = Math.ceil(st.from - 1e-9);
                                                const reachable = at < st.to || (at === st.to && st.to === SPEED_MAX);
                                                const dc = mine ? doublePct : g.lo;
                                                return (
                                                    <li key={st.from} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span className={cn('w-2 h-2 rounded-full shrink-0', COLORS[st.alone === 1 ? 'alone' : 'shared'])} />
                                                        <span className="font-mono font-bold">{pctTxt(st.from)} to {st.to === SPEED_MAX ? `+${SPEED_MAX}%` : `under ${pctTxt(st.to)}`}</span>
                                                        <span className="text-text-secondary">{st.text}</span>
                                                        <button disabled={!reachable} onClick={() => { onBonus(at); onDouble(dc); }}
                                                            title={reachable ? `Move the sliders to +${at}% and ${dc}% double` : 'No whole percent falls in this range'}
                                                            className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg border border-accent-primary/60 text-accent-primary hover:bg-accent-primary/15 disabled:opacity-40 disabled:pointer-events-none">
                                                            Go there
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                            </section>
                        );
                    })}
                    <p className="text-[11px] text-text-muted">
                        Ranges are exact to 0.001% of attack speed: hits per second only change where a normal or a double attack drops a tick. Double chance is checked at every whole percent.
                        Change the sources in the ranking filter to compare with other weapons.
                    </p>
                </div>
            </div>
        </div>,
        document.body,
    );
}
