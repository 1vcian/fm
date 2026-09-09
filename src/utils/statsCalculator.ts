/**
 * Formatting helpers. This file used to carry a second, superseded stat engine (~750 lines,
 * never imported); it was removed when the shared combat engine landed so nobody audits dead
 * math again. Stats live in statEngine.ts, combat in src/engine.
 */

export function formatPercent(value: number, decimals: number = 2): string {
    return `${(value * 100).toFixed(decimals)}%`;
}

export function formatMultiplier(value: number, decimals: number = 2): string {
    const percent = (value - 1) * 100;
    return percent >= 0 ? `+${percent.toFixed(decimals)}%` : `${percent.toFixed(decimals)}%`;
}

export function formatCompactNumber(n: number): string {
    if (n < 1000) return Math.floor(n).toLocaleString();

    const suffixes = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N', 'd', 'U', 'D'];
    const tier = Math.floor(Math.log10(n) / 3);

    if (tier >= suffixes.length) return n.toExponential(2);

    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaled = n / scale;

    let formatted = '';
    if (scaled >= 100) {
        // 100-999: 0 decimals (e.g. 123M)
        formatted = Math.floor(scaled).toString();
    } else if (scaled >= 10) {
        // 10-99.9: 1 decimal (e.g. 12.3M)
        formatted = (Math.floor(scaled * 10) / 10).toString();
    } else {
        // 1-9.99: 2 decimals (e.g. 1.23M)
        formatted = (Math.floor(scaled * 100) / 100).toString();
    }

    return formatted + suffix;
}
