const HammerModel=(()=>{
const ITEM_TYPE_NAMES = ['Helmet', 'Armour', 'Gloves', 'Necklace', 'Ring', 'Weapon', 'Shoes', 'Belt'];
function sortBrackets(lib) {
    const out = new Map();
    Object.keys(lib).map(Number).sort((a, b) => a - b).forEach(k => out.set(k, lib[String(k)]));
    return out;
}
function counterCap(brackets, maxLevel) {
    for (const row of brackets.values()) {
        if (row.UpperRange >= maxLevel)
            return row.Level;
    }
    return 0;
}
function levelWindow(brackets, counter, maxLevel) {
    const row = brackets.get(counter);
    if (!row)
        return [0, Math.floor(maxLevel)];
    const lo = row.LowerRange;
    const hi = Math.min(row.UpperRange, Math.floor(maxLevel));
    return [lo, Math.max(lo, hi)];
}
function sellValue(level, sellBonus, p) {
    return Math.round(p.sellBasePrice * Math.pow(p.levelScalingBase, level) * (1 + sellBonus));
}
function windowStats(lo, hi, sellBonus, p) {
    let sum = 0;
    for (let l = lo; l <= hi; l++)
        sum += sellValue(l, sellBonus, p);
    const n = hi - lo + 1;
    return {
        lo, hi,
        avgLevel: (lo + hi) / 2,
        avgCoins: sum / n,
        minCoins: sellValue(lo, sellBonus, p),
        maxCoins: sellValue(hi, sellBonus, p),
    };
}
function binomialPmf(n, q, kMax) {
    const out = new Array(kMax + 1).fill(0);
    if (q <= 0 || n <= 0) {
        out[0] = 1;
        return out;
    }
    if (q >= 1) {
        if (n <= kMax)
            out[n] = 1;
        return out;
    }
    let lp = n * Math.log1p(-q);
    const ratio = Math.log(q) - Math.log1p(-q);
    for (let k = 0; k <= kMax && k <= n; k++) {
        out[k] = Math.exp(lp);
        lp += Math.log(n - k) - Math.log(k + 1) + ratio;
    }
    return out;
}
function negBinomialPmf(h, r, kMax) {
    const out = new Array(kMax + 1).fill(0);
    if (r <= 0 || h <= 0) {
        out[0] = 1;
        return out;
    }
    let lp = h * Math.log1p(-r);
    const lr = Math.log(r);
    for (let k = 0; k <= kMax; k++) {
        out[k] = Math.exp(lp);
        lp += Math.log(h + k) - Math.log(k + 1) + lr;
    }
    return out;
}
function convolve(a, b, kMax) {
    const out = new Array(kMax + 1).fill(0);
    for (let i = 0; i <= kMax; i++) {
        if (!a[i])
            continue;
        for (let j = 0; i + j <= kMax; j++)
            out[i + j] += a[i] * b[j];
    }
    return out;
}
function cdf(pmf) {
    const out = [];
    let s = 0;
    for (const v of pmf) {
        s += v;
        out.push(Math.min(1, s));
    }
    return out;
}
function computeForgeModel(input, hammers) {
    const { brackets, ageChances, typesByAge, slots, sell, state } = input;
    const p = Math.min(Math.max(input.freeChance, 0), 0.999);
    const H = Math.max(0, Math.floor(hammers));
    const forges = H / (1 - p);
    const ages = [];
    let coins = 0, coinsMin = 0, coinsMax = 0, items = 0;
    for (const [ageStr, chance] of Object.entries(ageChances)) {
        const age = Number(ageStr);
        if (!(chance > 0))
            continue;
        const types = (typesByAge[age] || []).filter(t => slots[t]);
        if (types.length === 0)
            continue;
        const q = chance / types.length;
        let aCoins = 0, aMin = 0, aMax = 0, aLevel = 0, aLow = 0, aHigh = 0, aItems = 0;
        const windows = [];
        for (const t of types) {
            const slot = slots[t];
            const cap = counterCap(brackets, slot.maxLevel);
            const stats = [];
            for (let c = 0; c <= cap; c++) {
                const [lo, hi] = levelWindow(brackets, c, slot.maxLevel);
                stats.push(windowStats(lo, hi, slot.sellBonus, sell));
            }
            const top = stats[cap];
            const expM = H * q / (1 - p);
            let k0Cdf;
            if (state.kind === 'atCap') {
                k0Cdf = new Array(cap + 1).fill(0);
            }
            else {
                k0Cdf = cdf(binomialPmf(state.forges, q, cap));
            }
            let sessionCdf;
            if (state.kind === 'atCap') {
                sessionCdf = new Array(cap + 1).fill(0);
            }
            else {
                const k0 = binomialPmf(state.forges, q, cap);
                const r = p * q / (p * q + 1 - p);
                const m = convolve(binomialPmf(H, q, cap), negBinomialPmf(H, r, cap), cap);
                sessionCdf = cdf(convolve(k0, m, cap));
            }
            const sumOf = (pick) => {
                let v = expM * pick(top);
                for (let i = 0; i < cap; i++) {
                    const w = k0Cdf[i] - sessionCdf[i];
                    if (w > 0)
                        v -= (pick(top) - pick(stats[i])) * w;
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
        coins += aCoins;
        coinsMin += aMin;
        coinsMax += aMax;
        items += aItems;
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
function hammersForCoins(input, targetCoins, pick = r => r.coins) {
    if (!(targetCoins > 0))
        return 0;
    let hi = 1;
    while (pick(computeForgeModel(input, hi)) < targetCoins) {
        hi *= 2;
        if (hi > 1e12)
            return hi;
    }
    let lo = 0;
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (pick(computeForgeModel(input, mid)) >= targetCoins)
            hi = mid;
        else
            lo = mid;
    }
    return hi;
}

return {sortBrackets,computeForgeModel,sellValue};})();
