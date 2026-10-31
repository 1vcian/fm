import type { ReactNode } from 'react';
import { GameIcon } from '../UI/GameIcon';
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { EggIcon } from '../UI/EggIcon';
import { cn } from '../../lib/utils';
import { fmtAmount, fmtRate, rewardIcon, rewardKey, rewardLabel, type Product, type Reward } from './shopValue';

/**
 * The Currency and Special tabs of the shop: every pack with what a dollar buys in it, the best
 * pack of each kind marked, and the Progress Pass's premium track priced against the daily deals.
 */

interface Row { reward: Reward; rate: number | null; share: number | null; times?: number | null }

function ValueRow({ row }: { row: Row }) {
    const top = row.share !== null && row.share >= 0.995;
    return (
        <div className="flex items-center gap-2 text-xs">
            <GameIcon name={rewardIcon(row.reward)} size={18} />
            <span className="flex-1 min-w-0 text-text-secondary">{rewardLabel(row.reward)}</span>
            <span className="font-mono font-black text-white">+{fmtAmount(row.reward.Amount)}</span>
            {row.rate !== null && (
                <span className={cn('font-mono text-[10px] whitespace-nowrap text-right min-w-[5.5rem]', top ? 'text-green-300 font-bold' : row.share !== null && row.share >= 0.9 ? 'text-lime-200/80' : 'text-text-muted')}>
                    {fmtRate(row.rate)}/$ {row.share === null ? '' : top ? 'best' : `${Math.round(row.share * 100)}%`}
                </span>
            )}
            {row.times !== undefined && row.times !== null && (
                <span title="Times what a dollar buys of it in the best daily deal"
                    className={cn('font-mono text-[10px] font-bold whitespace-nowrap px-1.5 py-0.5 rounded', row.times >= 1 ? 'bg-green-400/15 text-green-300' : 'bg-red-400/15 text-red-300')}>
                    {row.times.toFixed(1)}x deals
                </span>
            )}
        </div>
    );
}

function PackCard({ icon, title, price, rows, badge, footer, className }: {
    icon: ReactNode; title: string; price: string; rows: Row[]; badge?: string | null; footer?: ReactNode; className?: string;
}) {
    return (
        <div className={cn('relative rounded-2xl border flex flex-col overflow-hidden bg-bg-primary/50', badge ? 'border-green-400/50 shadow-[0_0_24px_rgba(74,222,128,0.12)]' : 'border-border/50', className)}>
            {badge && <div className="text-[10px] font-black uppercase tracking-wider text-center py-0.5 bg-green-400 text-black">{badge}</div>}
            <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/40">
                <div className="w-14 h-14 shrink-0 rounded-xl bg-bg-input border border-border flex items-center justify-center overflow-hidden">{icon}</div>
                <div className="min-w-0 flex-1">
                    <div className="font-black uppercase tracking-tight text-sm leading-tight">{title}</div>
                    <div className="mt-1 inline-block font-black text-sm px-2 py-0.5 rounded-lg bg-accent-secondary/15 text-accent-secondary border border-accent-secondary/30">{price}</div>
                </div>
            </div>
            <div className="p-3 space-y-1.5 flex-1">{rows.map((r, i) => <ValueRow key={i} row={r} />)}</div>
            {footer && <div className="px-3 pb-3 text-[10px] text-text-muted">{footer}</div>}
        </div>
    );
}

const Section = ({ icon, title, note, children }: { icon: ReactNode; title: string; note?: ReactNode; children: ReactNode }) => (
    <section className="space-y-4">
        <div>
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">{icon} {title}</h2>
            {note && <p className="text-xs text-text-muted mt-1 max-w-3xl">{note}</p>}
        </div>
        {children}
    </section>
);

/** Packs of one currency, each against the best pack of it. */
function PackGrid({ packs, iconOf }: { packs: Product[]; iconOf: (p: Product) => string }) {
    const rate = (p: Product) => (p.Price ? (p.Rewards?.[0]?.Amount ?? 0) / p.Price : 0);
    const best = Math.max(0, ...packs.map(rate));
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...packs].sort((a, b) => a.Price - b.Price).map(p => {
                const r = p.Rewards?.[0] as Reward | undefined;
                const top = best > 0 && rate(p) >= best * 0.995;
                return (
                    <PackCard key={p.ProductId} title={p.Name} price={`$${p.Price}`} badge={top ? 'Best value' : null}
                        icon={<GameIcon name={iconOf(p)} className="w-12 h-12" />}
                        rows={r ? [{ reward: r, rate: rate(p), share: best ? rate(p) / best : null }] : []} />
                );
            })}
        </div>
    );
}

export function CurrencyTab({ products, freeTokens, bestDaily, unlockLabel }: {
    products: Product[]; freeTokens: Reward | null; bestDaily: Map<string, number>; unlockLabel: string | null;
}) {
    const gems = products.filter(p => /^GemPack\d+$/.test(p.ProductId));
    const tokens = products.filter(p => /^TokenPack\d+$/.test(p.ProductId));
    const bestGemPack = Math.max(0, ...gems.map(p => (p.Rewards?.[0]?.Amount ?? 0) / (p.Price || Infinity)));
    const dailyGems = bestDaily.get('CurrencyReward:Gems');
    return (
        <div className="space-y-10">
            <Section icon={<GameIcon name="GemSquare" size={22} />} title="Gem packs"
                note={<>Bigger packs give more gems per dollar.{dailyGems ? <> The best daily deal gives {fmtRate(dailyGems)} gems per dollar, {Math.round((dailyGems / bestGemPack) * 100)}% of the best pack: daily deals are worth buying for their resources, not their gems.</> : null}</>}>
                <PackGrid packs={gems} iconOf={p => `GemPack_${p.ProductId.replace('GemPack', '')}`} />
            </Section>
            <Section icon={<GameIcon name="SteppingStone" size={22} />} title="Token packs"
                note={<>Tokens are the Stepping Stones event's currency. The token packs, the free one too, are in the shop only while that event runs
                    (TokenPacksCreationSystem adds them when the event starts and removes them when it ends). The event is a live event the game's server schedules:
                    its dates are not in the game files, so they cannot be known in advance.{unlockLabel ? <> It unlocks after battle {unlockLabel}.</> : null}</>}>
                <PackGrid packs={tokens} iconOf={p => `TokenPack_${p.ProductId.replace('TokenPack', '')}`} />
                {freeTokens && (
                    <PackCard className="max-w-sm" title="Daily Token Pack" price="Free"
                        icon={<GameIcon name="TokenPack_0" className="w-12 h-12" />}
                        rows={[{ reward: freeTokens, rate: null, share: null }]}
                        footer="Once a day while the Stepping Stones event runs (ShopResourcesLibrary: one purchase, resets with the new day)." />
                )}
            </Section>
        </div>
    );
}

export function SpecialTab({ products, passPremium, bestDaily, renderProduct }: {
    products: Product[]; passPremium: Reward[]; bestDaily: Map<string, number>; renderProduct: (p: Product) => ReactNode;
}) {
    const pass = products.find(p => /^ProgressPass\d+$/.test(p.ProductId));
    const egg = products.find(p => p.Rewards?.[0]?.$type === 'EggStarterOfferPackageReward');
    const starters = products.filter(p => /^StarterOffer\d+$/.test(p.ProductId));
    const known = new Set([pass, egg, ...starters].filter(Boolean).map(p => p!.ProductId));
    const others = products.filter(p => !known.has(p.ProductId) && !/^(GemPack|TokenPack|DailyDeal)\d+$/.test(p.ProductId));
    return (
        <div className="space-y-10">
            {pass && passPremium.length > 0 && (
                <Section icon={<GameAssetIcon asset={{ icon: 'MainProgressPassIcon' }} size={22} />} title="Progress Pass"
                    note="The premium track of the main quest pass, every difficulty together (MainGameProgressPassLibrary). It pays out as you clear the milestone battles, so its value is reached over time. Compared with the best daily deal for each resource.">
                    <PackCard className="max-w-xl" title={pass.Name} price={`$${pass.Price}`}
                        icon={<GameAssetIcon asset={{ icon: 'MainProgressPassIcon' }} size={44} />}
                        rows={passPremium.map(r => {
                            const rate = r.Amount / pass.Price;
                            const daily = bestDaily.get(rewardKey(r));
                            return { reward: r, rate, share: null, times: daily ? rate / daily : null };
                        })}
                        badge={passPremium.some(r => (bestDaily.get(rewardKey(r)) ?? Infinity) < r.Amount / pass.Price) ? 'Beats the daily deals' : null} />
                </Section>
            )}
            {egg && (
                <Section icon={<EggIcon rarity={egg.Rewards![0].Rarity} size={22} />} title="Egg offer">
                    <PackCard className="max-w-sm" title={`${egg.Rewards![0].Amount} ${egg.Rewards![0].Rarity} Eggs`} price={`$${egg.Price}`}
                        icon={<EggIcon rarity={egg.Rewards![0].Rarity} size={48} />}
                        rows={[]} footer={`${fmtRate(egg.Rewards![0].Amount / egg.Price)} eggs per dollar.`} />
                </Section>
            )}
            {starters.length > 0 && (
                <Section icon={<GameAssetIcon asset={{ icon: 'Sparkle' }} size={22} />} title="Starter offers"
                    note="One item each, with a fixed substat; their value depends on your build, so they are not ranked.">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{starters.map(renderProduct)}</div>
                </Section>
            )}
            {others.length > 0 && (
                <Section icon={<GameAssetIcon asset={{ icon: 'CommonChest' }} size={22} />} title="Other offers">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{others.map(renderProduct)}</div>
                </Section>
            )}
        </div>
    );
}
