/**
 * The shop's Daily Deals as the game rolls them (build 2026_10_27_09_45).
 *
 * PlayerDailyDealsModel.GenerateDailyDeals (0x786A7F4):
 *   - seed = (ResetsToday + 1) * (Date.Year + Date.DayOfYear), the server date in UTC; nothing of
 *     the player goes in, so every player sees the same deals on the same day and reset;
 *   - RandomPCG.CreateFromSeed(seed) (0x7304A78);
 *   - types: every DailyDealType value in enum order; sizes: Range(min, max) of every SizeId in
 *     DailyDealLibrary;
 *   - while fewer than 3 deals: a random type (removed), then a random size among the remaining
 *     ones that type has (removed), and the deal's Guid (rng.NextGuid, four PCG steps). A type
 *     without a remaining size is skipped. So: 3 deals, 3 different types, 3 different sizes.
 * The day starts at 00:00 UTC (NextDayModel.Tick 0x78A6754 on MetaTime.ToDateTime, no local
 * offset), and buying all three rolls the next set at once (DailyDealPurchaseContent.OnPurchased
 * 0x78A9F90 -> ResetDeals, ResetsToday + 1). Each deal is bought once; its price is the size's
 * InAppProducts row DailyDeal<SizeId>, and its contents the DailyDealLibrary row (fixed, they do
 * not scale with progress: DailyDealModel.GetRewards 0x786A5A4).
 */

/** DailyDealType enum values, in order (the generator lists them by value, not by config key). */
export const DAILY_DEAL_TYPES = ['Dungeon', 'Resource', 'Pet', 'Skill', 'Tech', 'Mount'] as const;
export const DEALS_PER_SET = 3;

const M = 6364136223846793005n;
const INC = 1442695040888963407n;
const SEED_ADD = 0x1a08ee1184ba6d32n;
const MASK = (1n << 64n) - 1n;

/** RandomPCG: state init (0x73048C0), NextUInt XSH-RR (0x7304AF8), NextInt(n) = (NextUInt >> 1) % n (0x7304BA4). */
class RandomPCG {
    private state: bigint;
    constructor(seed: number) { this.state = (BigInt(seed) * M + SEED_ADD) & MASK; }
    nextUInt(): number {
        const x = this.state;
        this.state = (x * M + INC) & MASK;
        const xs = Number(((x >> 45n) ^ (x >> 27n)) & 0xffffffffn) >>> 0;
        const r = Number(x >> 59n);
        return ((xs >>> r) | (xs << ((32 - r) & 31))) >>> 0;
    }
    nextInt(n: number): number { return (this.nextUInt() >>> 1) % n; }
    choice<T>(list: T[]): T { return list[this.nextInt(list.length)]; }
    /** NextGuid (0x78B2644): two NextULong, four steps. */
    skipGuid(): void { for (let i = 0; i < 4; i++) this.nextUInt(); }
}

export interface DailyDealRow { DailyDealType: string; Size: { SizeId: number; Rewards: any[] }[] }
export interface RolledDeal { type: string; sizeId: number }

/** Day of the year (1..366) of a UTC date. */
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;

export const dailyDealSeed = (date: Date, resets: number) => (resets + 1) * (date.getUTCFullYear() + dayOfYear(date));

/** The deals of one UTC day after `resets` complete sets were bought. */
export function rollDailyDeals(library: Record<string, DailyDealRow>, date: Date, resets = 0): RolledDeal[] {
    const rng = new RandomPCG(dailyDealSeed(date, resets));
    const all = Object.values(library).flatMap(t => t.Size.map(s => s.SizeId));
    if (!all.length) return [];
    const sizes: number[] = [];
    for (let s = Math.min(...all); s <= Math.max(...all); s++) sizes.push(s);
    const types: string[] = [...DAILY_DEAL_TYPES];
    const out: RolledDeal[] = [];
    let failed = 0;
    while (failed !== 100 && out.length < DEALS_PER_SET && types.length > 0) {
        const type = rng.choice(types);
        types.splice(types.indexOf(type), 1);
        const has = new Set((library[type]?.Size ?? []).map(s => s.SizeId));
        const avail = sizes.filter(s => has.has(s));
        if (!avail.length) { failed++; continue; }
        const sizeId = rng.choice(avail);
        sizes.splice(sizes.indexOf(sizeId), 1);
        rng.skipGuid();
        out.push({ type, sizeId });
    }
    return out;
}
