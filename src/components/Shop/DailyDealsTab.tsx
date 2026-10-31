import { useEffect, useMemo, useState } from 'react';
import { GameIcon } from '../UI/GameIcon';
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { cn } from '../../lib/utils';
import { DEALS_PER_SET, rollDailyDeals, type DailyDealRow } from '../../utils/dailyDeals';

/**
 * Daily Deals: today's three deals (rolled the way the game rolls them, src/utils/dailyDeals.ts),
 * the next sets and days, how the deals work, and every deal with what a dollar buys in it.
 */

import { rewardIcon, rewardKey, rewardLabel, fmtAmount, fmtRate, TYPE_ICON, type Reward, type Product } from './shopValue';

interface DealInfo { type: string; sizeId: number; rewards: Reward[]; price: number | null; sizeName: string }

export function DailyDealsTab({ library, products }: { library: Record<string, DailyDealRow>; products: Product[] }) {
    const priceOf = useMemo(() => {
        const m = new Map<number, Product>();
        for (const p of products) {
            const id = p.ProductId.match(/^DailyDeal(\d+)$/);
            if (id) m.set(Number(id[1]), p);
        }
        return m;
    }, [products]);
    const info = (type: string, sizeId: number): DealInfo => {
        const p = priceOf.get(sizeId);
        return {
            type, sizeId,
            rewards: library[type]?.Size.find(s => s.SizeId === sizeId)?.Rewards ?? [],
            price: p?.Price ?? null,
            sizeName: p?.Name.replace(/ Daily Deal$/, '') ?? `Size ${sizeId}`,
        };
    };

    // What a dollar buys of each reward in each deal, and the best of every reward across all deals.
    const best = useMemo(() => {
        const m = new Map<string, number>();
        for (const row of Object.values(library)) {
            for (const s of row.Size) {
                const price = priceOf.get(s.SizeId)?.Price;
                if (!price) continue;
                for (const r of s.Rewards) m.set(rewardKey(r), Math.max(m.get(rewardKey(r)) ?? 0, r.Amount / price));
            }
        }
        return m;
    }, [library, priceOf]);
    // Per resource, every deal that gives it, best first.
    const ranking = useMemo(() => {
        const m = new Map<string, { key: string; sample: Reward; deals: (DealInfo & { rate: number })[] }>();
        for (const [type, row] of Object.entries(library)) {
            for (const s of row.Size) {
                const d = info(type, s.SizeId);
                if (!d.price) continue;
                for (const r of d.rewards) {
                    const k = rewardKey(r);
                    const e = m.get(k) ?? { key: k, sample: r, deals: [] };
                    e.deals.push({ ...d, rate: r.Amount / d.price });
                    m.set(k, e);
                }
            }
        }
        for (const e of m.values()) e.deals.sort((a, b) => b.rate - a.rate);
        return [...m.values()].sort((a, b) => rewardLabel(a.sample).localeCompare(rewardLabel(b.sample)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [library, priceOf]);
    const bestFor = (d: DealInfo) => (d.price ? d.rewards.filter(r => r.Amount / d.price! >= (best.get(rewardKey(r)) ?? Infinity) * 0.995) : []);

    // Today (UTC), the countdown to the next day, and which day / set is shown.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
    const [dayOffset, setDayOffset] = useState(0);
    const [resets, setResets] = useState(0);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const shownDate = new Date(today + dayOffset * 86400000);
    const msLeft = today + 86400000 - now.getTime();
    const countdown = `${Math.floor(msLeft / 3600000)}h ${String(Math.floor(msLeft / 60000) % 60).padStart(2, '0')}m ${String(Math.floor(msLeft / 1000) % 60).padStart(2, '0')}s`;
    // Cheapest first (the game rolls them in random order).
    const deals = useMemo(() => rollDailyDeals(library, shownDate, resets).map(d => info(d.type, d.sizeId))
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [library, shownDate.getTime(), resets, priceOf]);
    const dayLabel = (o: number) => (o === 0 ? 'Today' : o === 1 ? 'Tomorrow' : new Date(today + o * 86400000).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));

    return (
        <div className="space-y-8">
            {/* Today's deals */}
            <section className="rounded-3xl border border-accent-primary/30 bg-gradient-to-b from-accent-primary/10 via-bg-secondary/20 to-transparent p-4 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
                            <GameAssetIcon asset={{ icon: 'Timer' }} size={22} /> {dayOffset === 0 ? "Today's deals" : `Deals of ${dayLabel(dayOffset)}`}
                        </h2>
                        <p className="text-xs text-text-secondary mt-1 max-w-2xl">
                            The same three for every player: the game rolls them from the date alone. New ones at 00:00 UTC, in <span className="font-mono font-bold text-text-primary">{countdown}</span>.
                            Buy all three and a new set is rolled at once.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: 7 }, (_, o) => (
                            <button key={o} onClick={() => { setDayOffset(o); setResets(0); }}
                                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors', dayOffset === o ? 'bg-accent-primary text-black border-accent-primary' : 'border-border text-text-secondary hover:bg-bg-input')}>
                                {dayLabel(o)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* No limit in the game: no code reads ResetsToday as one, every complete purchase rolls a new set. */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-text-muted font-bold uppercase tracking-wider">Set</span>
                    <button onClick={() => setResets(r => Math.max(0, r - 1))} disabled={resets === 0}
                        className="w-8 h-8 rounded-lg border border-border font-black text-text-secondary hover:bg-bg-input disabled:opacity-30">-</button>
                    <span className="min-w-[13rem] text-center font-bold text-white px-3 py-1.5 rounded-lg bg-white/10 border border-white/20">
                        {resets === 0 ? 'First set of the day' : `After buying all three ${resets === 1 ? 'once' : `${resets} times`}`}
                    </span>
                    <button onClick={() => setResets(r => r + 1)}
                        className="w-8 h-8 rounded-lg border border-border font-black text-text-secondary hover:bg-bg-input">+</button>
                    <span className="text-text-muted">No limit: every time you buy all three, a new set comes.</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {deals.map(d => <DealCard key={`${d.type}-${d.sizeId}`} deal={d} bestFor={bestFor(d)} best={best} big />)}
                </div>
                {deals.length < DEALS_PER_SET && <p className="text-xs text-text-muted">The config gives fewer than {DEALS_PER_SET} deals for this day.</p>}
            </section>

            {/* The best deal for each resource, across every type and size */}
            <section className="rounded-2xl border border-green-400/25 bg-green-400/[0.04] p-5 space-y-3">
                <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary flex items-center gap-2">
                    <GameAssetIcon asset={{ icon: 'Star' }} size={16} /> Best deal for each resource
                </h3>
                <p className="text-xs text-text-muted">Every deal of every type compared on what a dollar buys of the resource; the next ones follow with their share of the best.</p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {ranking.map(row => (
                        <div key={row.key} className="rounded-xl bg-bg-primary/50 border border-border/40 p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                                <GameIcon name={rewardIcon(row.sample)} size={20} />
                                <span className="font-bold text-sm flex-1">{rewardLabel(row.sample)}</span>
                            </div>
                            {row.deals.slice(0, 3).map((d, i) => (
                                <div key={`${d.type}-${d.sizeId}`} className={cn('flex items-center gap-2 text-xs', i === 0 ? 'text-green-300 font-bold' : 'text-text-secondary')}>
                                    <span className="w-4 text-text-muted">{i + 1}</span>
                                    <span className="flex-1">{d.type} {d.sizeName} <span className="text-text-muted font-normal">${d.price}</span></span>
                                    <span className="font-mono">{fmtRate(d.rate)}/$</span>
                                    <span className="font-mono w-10 text-right text-[10px]">{i === 0 ? 'best' : `${Math.round((d.rate / row.deals[0].rate) * 100)}%`}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </section>

            {/* How they work */}
            <section className="rounded-2xl border border-border bg-bg-secondary/20 p-5">
                <h3 className="text-sm font-black uppercase tracking-widest text-text-secondary mb-3 flex items-center gap-2">
                    <GameAssetIcon asset={{ icon: 'InfoIcon' }} size={16} /> How daily deals work
                </h3>
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-text-secondary list-disc pl-4">
                    <li>Three deals at a time, each of a different type and a different size, picked at random.</li>
                    <li>Nothing of yours changes them: not your progress, age, forge, spending or past purchases. Every player sees the same deals.</li>
                    <li>The price depends only on the size: {[...priceOf.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => `${p.Name.replace(/ Daily Deal$/, '')} $${p.Price}`).join(', ')}.</li>
                    <li>The contents are fixed: they do not grow with your progress.</li>
                    <li>Each deal can be bought once. Buying all three rolls the next set straight away, with no limit on how many sets a day.</li>
                    <li>A new day, and new deals, start at 00:00 UTC.</li>
                </ul>
            </section>

            {/* Every deal */}
            <section className="space-y-4">
                <div>
                    <h2 className="text-xl font-black uppercase tracking-tight">Every deal</h2>
                    <p className="text-xs text-text-muted mt-1">
                        Under each reward, how much a dollar buys of it. <span className="text-green-300 font-bold">Best</span> marks the deal that gives the most of that reward per dollar of all the deals.
                        The game sells these resources for no gem price, so they are compared per dollar, not converted to one value.
                    </p>
                </div>
                {Object.keys(library).map(type => (
                    <div key={type} className="rounded-2xl border border-border/40 bg-bg-secondary/10 p-4 space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-bg-input border border-border flex items-center justify-center"><GameIcon name={TYPE_ICON[type] ?? 'Star'} size={26} /></div>
                            <h3 className="text-lg font-black uppercase tracking-tight">{type}</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            {[...library[type].Size].sort((a, b) => (priceOf.get(a.SizeId)?.Price ?? Infinity) - (priceOf.get(b.SizeId)?.Price ?? Infinity)).map(s => {
                                const d = info(type, s.SizeId);
                                return <DealCard key={s.SizeId} deal={d} bestFor={bestFor(d)} best={best} />;
                            })}
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}

function DealCard({ deal, bestFor, best, big = false }: { deal: DealInfo; bestFor: Reward[]; best: Map<string, number>; big?: boolean }) {
    const bestKeys = new Set(bestFor.map(rewardKey));
    return (
        <div className={cn('rounded-2xl border flex flex-col overflow-hidden', big ? 'border-accent-primary/40 bg-bg-primary/60 shadow-lg' : 'border-border/50 bg-bg-primary/40')}>
            <div className={cn('flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40', big && 'bg-accent-primary/10')}>
                <div className="flex items-center gap-2 min-w-0">
                    {big && <GameIcon name={TYPE_ICON[deal.type] ?? 'Star'} size={28} />}
                    <div className="min-w-0">
                        <div className={cn('font-black uppercase tracking-tight', big ? 'text-base' : 'text-sm')}>{big ? `${deal.type} ` : ''}{deal.sizeName}</div>
                        {bestFor.length > 0 && <div className="text-[10px] font-bold text-green-300">Best for {bestFor.map(rewardLabel).join(', ')}</div>}
                    </div>
                </div>
                <span className="shrink-0 font-black text-sm px-2.5 py-1 rounded-lg bg-accent-secondary/15 text-accent-secondary border border-accent-secondary/30">
                    {deal.price !== null ? `$${deal.price}` : 'price unknown'}
                </span>
            </div>
            <div className="p-3 space-y-1.5 flex-1">
                {deal.rewards.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                        <GameIcon name={rewardIcon(r)} size={18} />
                        <span className="flex-1 min-w-0 text-text-secondary">{rewardLabel(r)}</span>
                        <span className="font-mono font-black text-white">+{fmtAmount(r.Amount)}</span>
                        {deal.price ? (() => {
                            const rate = r.Amount / deal.price!;
                            const share = rate / (best.get(rewardKey(r)) ?? rate);
                            const top = bestKeys.has(rewardKey(r));
                            return (
                                <span title={`${fmtRate(rate)} per dollar, ${Math.round(share * 100)}% of the best deal for ${rewardLabel(r)}`}
                                    className={cn('font-mono text-[10px] w-24 text-right', top ? 'text-green-300 font-bold' : share >= 0.9 ? 'text-lime-200/80' : 'text-text-muted')}>
                                    {fmtRate(rate)}/$ <span className="opacity-80">{top ? 'best' : `${Math.round(share * 100)}%`}</span>
                                </span>
                            );
                        })() : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
