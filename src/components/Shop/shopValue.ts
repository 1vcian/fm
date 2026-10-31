/**
 * Shared words, icons and value maths of the shop tabs: what a dollar buys of each resource.
 * The game sells these resources at no gem price, so they are compared per dollar of the
 * InAppProducts price, resource by resource, never converted to one value.
 */
import type { DailyDealRow } from '../../utils/dailyDeals';

export interface Reward { Amount: number; Type: string; $type: string; Rarity?: string }
export interface Product { ProductId: string; Name: string; Price: number; Rewards?: any[] }

/** The words a player reads for these resources (Profile/ResourcesEditor, as in ClanTierPanel). */
const CURRENCY: Record<string, { label: string; icon: string }> = {
    Hammers: { label: 'Hammers', icon: 'Hammer' },
    Coins: { label: 'Coins', icon: 'Coin' },
    Gems: { label: 'Gems', icon: 'GemSquare' },
    SkillSummonTickets: { label: 'Skill Tickets', icon: 'SkillTicket' },
    TechPotions: { label: 'Tech Potions', icon: 'Potion' },
    ClockWinders: { label: 'Clock Winders', icon: 'MountKey' },
    Eggshells: { label: 'Eggshells', icon: 'Eggshell' },
    // The Stepping Stones event's currency (TokensChangeMessage feeds SteppingStonesSystem).
    Token: { label: 'Tokens', icon: 'SteppingStone' },
};
const KEY_ICON: Record<string, string> = { Hammer: 'HammerKey', Skill: 'SkillKey', Pet: 'PetKey', Potion: 'PotionKey' };
/** The dungeon a key opens (Pet is the egg dungeon's key, as on Dungeons). */
const KEY_LABEL: Record<string, string> = { Hammer: 'Hammer Thief key', Skill: 'Ghost Town key', Pet: 'Invasion key', Potion: 'Zombie Rush key' };

export const rewardKey = (r: Reward) => `${r.$type}:${r.Type}`;
export const rewardLabel = (r: Reward) => (r.$type === 'DungeonKeyReward' ? KEY_LABEL[r.Type] ?? `${r.Type} key` : CURRENCY[r.Type]?.label ?? r.Type);
export const rewardIcon = (r: Reward) => (r.$type === 'DungeonKeyReward' ? KEY_ICON[r.Type] ?? 'UnknownKey' : CURRENCY[r.Type]?.icon ?? r.Type);
/** The resource a daily deal type is mainly for, as its icon. */
export const TYPE_ICON: Record<string, string> = { Skill: 'SkillTicket', Tech: 'Potion', Pet: 'Eggshell', Mount: 'MountKey', Resource: 'Coin', Dungeon: 'HammerKey' };

export const fmtAmount = (n: number) => (n >= 10000 ? `${(n / 1000).toLocaleString('en-US')}k` : n.toLocaleString('en-US'));
export const fmtRate = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(1) : n.toFixed(2));

/** Per resource, the most a dollar buys of it in any daily deal (DailyDealLibrary x DailyDeal<SizeId> prices). */
export function bestDailyRates(library: Record<string, DailyDealRow> | null | undefined, products: Product[]): Map<string, number> {
    const price = new Map<number, number>();
    for (const p of products) {
        const id = p.ProductId.match(/^DailyDeal(\d+)$/);
        if (id) price.set(Number(id[1]), p.Price);
    }
    const out = new Map<string, number>();
    for (const row of Object.values(library ?? {})) {
        for (const s of row.Size) {
            const pr = price.get(s.SizeId);
            if (!pr) continue;
            for (const r of s.Rewards) out.set(rewardKey(r), Math.max(out.get(rewardKey(r)) ?? 0, r.Amount / pr));
        }
    }
    return out;
}
