/**
 * The egg counts a hatch plan link carries (`#/eggs?plan=Common.81,Rare.86`): the Summons
 * calculator's Eggs tab opens the hatch planner on the eggs a simulated pull gives.
 */
export function encodeEggPlan(eggs: Record<string, number>): string {
    return Object.entries(eggs)
        .filter(([, n]) => n > 0)
        .map(([rarity, n]) => `${encodeURIComponent(rarity)}.${Math.floor(n)}`)
        .join(',');
}

export function decodeEggPlan(raw: string | null): Record<string, number> | null {
    if (!raw) return null;
    const out: Record<string, number> = {};
    for (const part of raw.split(',')) {
        const [rarity, n] = part.split('.');
        const count = Math.floor(Number(n));
        if (rarity && Number.isFinite(count) && count > 0) out[decodeURIComponent(rarity)] = count;
    }
    return Object.keys(out).length ? out : null;
}
