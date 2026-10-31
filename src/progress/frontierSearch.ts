/**
 * Where a build gets in a line of battles played in order (the main quest: every age of a
 * difficulty, then the next difficulty; a dungeon: its levels), with as few battles simulated as
 * the answer allows.
 *
 *   1. Search: from the hint (the last answer for this profile), galloping up while battles are
 *      cleared or down while they are not (a build changed for the worse finds its new place
 *      too), then narrowing, `width` battles at a time. This gives a first answer quickly.
 *   2. Verify: every battle before that answer is measured as well, because a battle counts only
 *      once all the ones before it are cleared; the first one that is not moves the answer back.
 *   3. Look ahead: the battles after it, until LOOKAHEAD_ZEROS in a row are never won (or
 *      LOOKAHEAD_MAX), so the page shows how close the next ones are.
 *
 * "Cleared" is a win rate of at least 50% (LevelOutcome from src/progress/adaptive.ts).
 */
import type { LevelOutcome } from './adaptive';

const LOOKAHEAD_ZEROS = 3;
const LOOKAHEAD_MAX = 12;

export interface FrontierCallbacks {
    /** Each battle as it is measured (null: the battle does not exist). */
    onResult: (i: number, o: LevelOutcome | null) => void;
    /** The first answer, before the verification. */
    onEstimate: (frontier: number) => void;
    /** True once the caller no longer wants results. */
    cancelled: () => boolean;
}

/** Index of the last battle cleared in order (-1: none). */
export async function searchFrontier(
    count: number,
    hint: number,
    width: number,
    measureOne: (i: number) => Promise<LevelOutcome | null>,
    cb: FrontierCallbacks,
): Promise<number> {
    const results = new Map<number, LevelOutcome | null>();
    const range = (a: number, b: number) => {
        const out: number[] = [];
        for (let i = Math.max(0, a); i <= Math.min(count - 1, b); i++) out.push(i);
        return out;
    };
    const measure = async (idxs: number[]) => {
        await Promise.all(idxs.filter(i => !results.has(i)).map(async i => {
            const o = await measureOne(i);
            results.set(i, o);
            if (!cb.cancelled()) cb.onResult(i, o);
        }));
    };
    const cleared = (i: number) => (results.get(i)?.winRate ?? 0) >= 0.5;
    if (count <= 0) return -1;

    // 1. search: gallop from the hint (1, 2, 4, 8... battles away, `width` at a time) until a
    //    cleared battle and a lost one bracket the answer, then narrow the bracket with `width`
    //    battles at a time. lo: a cleared battle (-1: none), hi: a lost one (count: none).
    const at = Math.min(Math.max(hint, 0), count - 1);
    await measure([at]);
    let lo: number, hi: number;
    if (cleared(at)) {
        lo = at; hi = count;
        let step = 1;
        while (hi === count) {
            if (cb.cancelled()) return -1;
            const probes: number[] = [];
            for (let k = 0; k < width && lo + step < count; k++, step *= 2) probes.push(lo + step);
            if (!probes.length) break;
            await measure(probes);
            const lost = probes.find(i => !cleared(i));
            if (lost === undefined) lo = probes[probes.length - 1];
            else { hi = lost; for (const i of probes) if (i < lost && cleared(i)) lo = i; }
        }
    } else {
        lo = -1; hi = at;
        let step = 1;
        while (lo === -1) {
            if (cb.cancelled()) return -1;
            const probes: number[] = [];
            for (let k = 0; k < width && hi - step >= 0; k++, step *= 2) probes.push(hi - step);
            if (!probes.length) break;
            await measure(probes);
            const won = probes.find(i => cleared(i));
            if (won === undefined) hi = probes[probes.length - 1];
            else { lo = won; for (const i of probes) if (i > won && !cleared(i)) hi = Math.min(hi, i); }
        }
    }
    while (hi - lo > 1) {
        if (cb.cancelled()) return -1;
        const gap = hi - lo, k = Math.min(width, gap - 1);
        const probes = [...new Set(Array.from({ length: k }, (_, j) => lo + Math.max(1, Math.round((gap * (j + 1)) / (k + 1)))))].filter(i => i > lo && i < hi);
        await measure(probes);
        const lost = probes.find(i => !cleared(i));
        if (lost === undefined) lo = probes[probes.length - 1];
        else { hi = lost; for (const i of probes) if (i < lost && cleared(i)) lo = i; }
    }
    const estimate = lo;
    if (cb.cancelled()) return -1;
    cb.onEstimate(estimate);

    // 2. verify: everything before the estimate, nearest first
    await measure(range(0, estimate).reverse());
    if (cb.cancelled()) return -1;
    let frontier = estimate;
    for (let i = 0; i <= estimate; i++) if (!cleared(i)) { frontier = i - 1; break; }

    // 3. look ahead
    let next = frontier + 1, zeros = 0;
    while (next < count && next <= frontier + LOOKAHEAD_MAX && zeros < LOOKAHEAD_ZEROS) {
        if (cb.cancelled()) return -1;
        const win = range(next, next + width - 1);
        await measure(win);
        for (const i of win) {
            zeros = (results.get(i)?.winRate ?? 0) === 0 ? zeros + 1 : 0;
            if (zeros >= LOOKAHEAD_ZEROS) break;
        }
        next += width;
    }
    return frontier;
}
