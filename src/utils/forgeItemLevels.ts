/**
 * Forge item level and sell value model, mirroring the game's own rules.
 *
 * Everything below is read from libil2cpp.so of build 2026_10_08_09_03 (RVAs from dump.cs):
 *
 * - ForgeAction.Execute (0x7838124): one item per loop iteration. Each iteration rolls
 *   StatHelper.RollStat(FreebieChance, StatTarget.Forge) (0x78613A0, `NextFixedD6 < value`).
 *   A success either refunds the hammer (SpendContext.Free, when the whole batch was affordable)
 *   or extends the batch by one forge: every forge consumes a hammer with probability 1 - p, so
 *   H hammers give H paid forges plus the free ones rolled before the H-th paid forge.
 * - RollAge (0x7838958): cumulative pick over ItemAgeDropChancesLibrary[ForgeLevel].
 * - CreateRandomItem (0x78390BC): the item type is RandomPCG.Choice (NextInt(count)) over the keys
 *   of GetPossibleItems(age) (0x7838B00), i.e. uniform over the item types the Items library has
 *   for that age.
 * - RollItemLevel (0x7839768): row = ItemLevelBracketsLibrary[HiddenItemLevels[type][age]]
 *   (default 0); maxLevel = FloorToInt(CalculateValue(MaxLevel, Equipment.WithItemType(type),
 *   ItemBalancingConfig.ItemBaseMaxLevel)); level = NextIntMinMax(Lower, Min(Upper, maxLevel) + 1),
 *   uniform and inclusive. Stored level is 0-based, the UI shows +1.
 * - PlayerEquipmentModel.IncrementHiddenItemLevel (0x783658C), called after every forged item
 *   (0x7838590): counter += 1 while counter < cap, where cap is the Level of the first library row
 *   (in key order) whose UpperRange >= the unfloored maxLevel, or 0 when no row reaches it.
 * - PlayerEquipmentModel.Ascend (0x7836CB0, called by AscensionExtensions.AscendForge 0x77E6B44)
 *   clears HiddenItemLevels: every counter restarts at 0 after a forge ascension.
 * - SellValueHelper.GetSellValue (0x7835744): RoundToInt(CalculateValue(SellPrice,
 *   Equipment.WithItemType(type), SellBasePrice * LevelScalingBase ^ Level)). Only the level and
 *   the type enter the price (not age or rarity).
 */

export interface LevelBracket {
    Level: number;
    LowerRange: number;
    UpperRange: number;
}

/** ItemType enum order in the binary (TypeDefIndex 8908): Helmet=0 ... Belt=7. */
export const ITEM_TYPE_NAMES = ['Helmet', 'Armour', 'Gloves', 'Necklace', 'Ring', 'Weapon', 'Shoes', 'Belt'] as const;

export interface ForgeSlot {
    /** ItemType enum value. */
    itemType: number;
    /** Label key (tech node type without "LevelUp", e.g. "Weapon", "Body"). */
    key: string;
    /** CalculateValue(MaxLevel) for this type: ItemBaseMaxLevel + every MaxLevel node on it (0-based). */
    maxLevel: number;
    /** Summed SellPrice multipliers that apply to this type. */
    sellBonus: number;
}

export interface SellParams {
    sellBasePrice: number;
    levelScalingBase: number;
}

/** Sorted (by key) bracket rows; the hidden counter value is the row key. */
export function sortBrackets(lib: Record<string, LevelBracket>): Map<number, LevelBracket> {
    const out = new Map<number, LevelBracket>();
    Object.keys(lib).map(Number).sort((a, b) => a - b).forEach(k => out.set(k, lib[String(k)]));
    return out;
}

/** Counter cap for a type (IncrementHiddenItemLevel). */
export function counterCap(brackets: Map<number, LevelBracket>, maxLevel: number): number {
    for (const row of brackets.values()) {
        if (row.UpperRange >= maxLevel) return row.Level;
    }
    return 0;
}

/** Inclusive 0-based level window used when the counter is `counter` (RollItemLevel). */
export function levelWindow(brackets: Map<number, LevelBracket>, counter: number, maxLevel: number): [number, number] {
    const row = brackets.get(counter);
    if (!row) return [0, Math.floor(maxLevel)];
    const lo = row.LowerRange;
    const hi = Math.min(row.UpperRange, Math.floor(maxLevel));
    return [lo, Math.max(lo, hi)];
}

/** GetSellValue for a stored (0-based) level. */
export function sellValue(level: number, sellBonus: number, p: SellParams): number {
    return Math.round(p.sellBasePrice * Math.pow(p.levelScalingBase, level) * (1 + sellBonus));
}

interface WindowStats {
    lo: number;
    hi: number;
    avgLevel: number;
    avgCoins: number;
    minCoins: number;
    maxCoins: number;
}

function windowStats(lo: number, hi: number, sellBonus: number, p: SellParams): WindowStats {
    let sum = 0;
    for (let l = lo; l <= hi; l++) sum += sellValue(l, sellBonus, p);
    const n = hi - lo + 1;
    return {
        lo, hi,
        avgLevel: (lo + hi) / 2,
        avgCoins: sum / n,
        minCoins: sellValue(lo, sellBonus, p),
        maxCoins: sellValue(hi, sellBonus, p),
    };
}

/** P(X = k) for k = 0..kMax of Binomial(n, q), computed in log space (no overflow for huge n). */
function binomialPmf(n: number, q: number, kMax: number): number[] {
    const out = new Array(kMax + 1).fill(0);
    if (q <= 0 || n <= 0) { out[0] = 1; return out; }
    if (q >= 1) { if (n <= kMax) out[n] = 1; return out; }
    let lp = n * Math.log1p(-q);
    const ratio = Math.log(q) - Math.log1p(-q);
    for (let k = 0; k <= kMax && k <= n; k++) {
        out[k] = Math.exp(lp);
        lp += Math.log(n - k) - Math.log(k + 1) + ratio;
    }
    return out;
}

/** P(X = k), k = 0..kMax, X = failures before the h-th success, failure prob r. */
function negBinomialPmf(h: number, r: number, kMax: number): number[] {
    const out = new Array(kMax + 1).fill(0);
    if (r <= 0 || h <= 0) { out[0] = 1; return out; }
    let lp = h * Math.log1p(-r);
    const lr = Math.log(r);
    for (let k = 0; k <= kMax; k++) {
        out[k] = Math.exp(lp);
        lp += Math.log(h + k) - Math.log(k + 1) + lr;
    }
    return out;
}

function convolve(a: number[], b: number[], kMax: number): number[] {
    const out = new Array(kMax + 1).fill(0);
    for (let i = 0; i <= kMax; i++) {
        if (!a[i]) continue;
        for (let j = 0; i + j <= kMax; j++) out[i + j] += a[i] * b[j];
    }
    return out;
}

function cdf(pmf: number[]): number[] {
    const out: number[] = [];
    let s = 0;
    for (const v of pmf) { s += v; out.push(Math.min(1, s)); }
    return out;
}

export type CounterState =
    | { kind: 'atCap' }
    /** Counters were reset by a forge ascension `forges` forges ago (all at this forge level). */
    | { kind: 'sinceAscension'; forges: number };

export interface ForgeModelInput {
    brackets: Map<number, LevelBracket>;
    /** Age index -> drop chance at the forge level (ItemAgeDropChancesLibrary row). */
    ageChances: Record<number, number>;
    /** Age index -> item types the Items library holds for that age (uniform pick). */
    typesByAge: Record<number, number[]>;
    slots: Record<number, ForgeSlot>;
    sell: SellParams;
    freeChance: number;
    state: CounterState;
}

export interface SlotWindow {
    itemType: number;
    key: string;
    maxLevel: number;
    cap: number;
    /** Window right after a forge ascension (counter 0). */
    freshWindow: [number, number];
    /** Window once the counter reached its cap. */
    capWindow: [number, number];
}

export interface AgeResult {
    age: number;
    chance: number;
    items: number;
    coins: number;
    coinsMin: number;
    coinsMax: number;
    /** Expected 0-based level of the items of this age forged in the session. */
    avgLevel: number;
    /** Average 0-based level if every roll lands on the window's low / high end. */
    avgLevelLow: number;
    avgLevelHigh: number;
    windows: SlotWindow[];
}

export interface ForgeModelResult {
    hammers: number;
    forges: number;
    freeForges: number;
    items: number;
    coins: number;
    coinsMin: number;
    coinsMax: number;
    ages: AgeResult[];
}

/**
 * Exact expectation of the session for `hammers` hammers.
 *
 * For one (type, age) pair hit with probability q per forge, the i-th item of that pair since the
 * last ascension reads counter min(i, cap). Hits before the session: K0 ~ Bin(N, q). Hits in the
 * session: M = Bin(H, q) (paid forges) + NegBin(H, pq / (pq + 1 - p)) (free forges before the H-th
 * paid one). Sum over the session = M f(cap) - sum_{i<cap} (f(cap) - f(i)) [K0 <= i < K0 + M], so
 * E = E[M] f(cap) - sum_{i<cap} (f(cap) - f(i)) (P(K0 <= i) - P(K0 + M <= i)).
 */
export function computeForgeModel(input: ForgeModelInput, hammers: number): ForgeModelResult {
    const { brackets, ageChances, typesByAge, slots, sell, state } = input;
    const p = Math.min(Math.max(input.freeChance, 0), 0.999);
    const H = Math.max(0, Math.floor(hammers));
    const forges = H / (1 - p);

    const ages: AgeResult[] = [];
    let coins = 0, coinsMin = 0, coinsMax = 0, items = 0;

    for (const [ageStr, chance] of Object.entries(ageChances)) {
        const age = Number(ageStr);
        if (!(chance > 0)) continue;
        const types = (typesByAge[age] || []).filter(t => slots[t]);
        if (types.length === 0) continue;
        const q = chance / types.length;

        let aCoins = 0, aMin = 0, aMax = 0, aLevel = 0, aLow = 0, aHigh = 0, aItems = 0;
        const windows: SlotWindow[] = [];

        for (const t of types) {
            const slot = slots[t];
            const cap = counterCap(brackets, slot.maxLevel);
            const stats: WindowStats[] = [];
            for (let c = 0; c <= cap; c++) {
                const [lo, hi] = levelWindow(brackets, c, slot.maxLevel);
                stats.push(windowStats(lo, hi, slot.sellBonus, sell));
            }
            const top = stats[cap];
            const expM = H * q / (1 - p);

            // Counters before the session: K0 ~ Bin(N, q), read as min(K0, cap).
            let k0Cdf: number[];
            if (state.kind === 'atCap') {
                k0Cdf = new Array(cap + 1).fill(0);
            } else {
                k0Cdf = cdf(binomialPmf(state.forges, q, cap));
            }
            let sessionCdf: number[];
            if (state.kind === 'atCap') {
                sessionCdf = new Array(cap + 1).fill(0);
            } else {
                const k0 = binomialPmf(state.forges, q, cap);
                const r = p * q / (p * q + 1 - p);
                const m = convolve(binomialPmf(H, q, cap), negBinomialPmf(H, r, cap), cap);
                sessionCdf = cdf(convolve(k0, m, cap));
            }

            const sumOf = (pick: (s: WindowStats) => number) => {
                let v = expM * pick(top);
                for (let i = 0; i < cap; i++) {
                    const w = k0Cdf[i] - sessionCdf[i];
                    if (w > 0) v -= (pick(top) - pick(stats[i])) * w;
                }
                return v;
            };

            aCoins += sumOf(s => s.avgCoins);
            aMin += sumOf(s => s.minCoins);
            aMax += sumOf(s => s.maxCoins);
            aLevel += sumOf(s => s.avgLevel);
            aLow += sumOf(s => s.lo);
            aHigh += sumOf(s => s.hi);
            aItems += expM;

            windows.push({
                itemType: t,
                key: slot.key,
                maxLevel: slot.maxLevel,
                cap,
                freshWindow: [stats[0].lo, stats[0].hi],
                capWindow: [top.lo, top.hi],
            });
        }

        coins += aCoins; coinsMin += aMin; coinsMax += aMax; items += aItems;
        ages.push({
            age, chance, items: aItems, coins: aCoins, coinsMin: aMin, coinsMax: aMax,
            avgLevel: aItems > 0 ? aLevel / aItems : 0,
            avgLevelLow: aItems > 0 ? aLow / aItems : 0,
            avgLevelHigh: aItems > 0 ? aHigh / aItems : 0,
            windows,
        });
    }

    return { hammers: H, forges, freeForges: forges - H, items, coins, coinsMin, coinsMax, ages };
}

/**
 * Smallest hammer count whose coins reach `targetCoins`, where `pick` chooses which total of the
 * model is compared (expected, low-roll or high-roll).
 */
export function hammersForCoins(
    input: ForgeModelInput,
    targetCoins: number,
    pick: (r: ForgeModelResult) => number = r => r.coins,
): number {
    if (!(targetCoins > 0)) return 0;
    let hi = 1;
    while (pick(computeForgeModel(input, hi)) < targetCoins) {
        hi *= 2;
        if (hi > 1e12) return hi;
    }
    let lo = 0;
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (pick(computeForgeModel(input, mid)) >= targetCoins) hi = mid; else lo = mid;
    }
    return hi;
}
