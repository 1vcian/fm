/**
 * Adaptive measurement of one battle for the Battle Predictor: seeded runs in steps of STEP, until
 * the win rate is clearly at least 50% or clearly below it (the 95% Wilson interval lies on one
 * side), or MAX_RUNS. A battle won 4 times out of 4 (or lost 4 out of 4) is decided after 4 runs; one near 50% gets
 * up to MAX_RUNS. The seeds are 1, 2, 3... as in every multi-run simulation (runSeed), so a
 * measurement is reproducible and its first n runs are the same as simulateBattleMulti(n).
 */

export const STEP = 4;
export const MAX_RUNS = 256;
const Z = 1.96;

/** One battle measured. */
export interface LevelOutcome {
    /** Wins over runs (0..1). */
    winRate: number;
    runs: number;
    /** Mean share of the battle's enemy HP removed in the lost runs (0..1), null when none was lost. */
    lossProgress: number | null;
    /** The interval settled on one side of 50% (false: stopped at MAX_RUNS). */
    decided: boolean;
}

/** 95% Wilson score interval of a win rate. */
export function wilson(wins: number, runs: number): [number, number] {
    if (runs <= 0) return [0, 1];
    const p = wins / runs, z2 = Z * Z;
    const centre = (p + z2 / (2 * runs)) / (1 + z2 / runs);
    const half = (Z * Math.sqrt((p * (1 - p)) / runs + z2 / (4 * runs * runs))) / (1 + z2 / runs);
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** `batch(from, to)`: wins and summed lost-run progress over seeds from..to; null when there is no such battle. */
export function measureAdaptive(batch: (from: number, to: number) => { wins: number; lostProgress: number } | null): LevelOutcome | null {
    let wins = 0, runs = 0, lost = 0, decided = false;
    while (runs < MAX_RUNS) {
        const r = batch(runs + 1, runs + STEP);
        if (!r) return null;
        wins += r.wins;
        lost += r.lostProgress;
        runs += STEP;
        const [lo, hi] = wilson(wins, runs);
        if (lo >= 0.5 || hi < 0.5) { decided = true; break; }
    }
    return { winRate: wins / runs, runs, lossProgress: runs > wins ? lost / (runs - wins) : null, decided };
}
