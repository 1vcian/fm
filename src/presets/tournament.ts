/**
 * The preset tournament: every preset fights every other one in the arena, as the game runs PvP
 * (src/pvp/simulate.ts PvpBattle: PvpBaseConfig's shared HP multiplier, the 60 s timer, the
 * higher HP fraction wins a timeout). Each pair plays `battlesPerSide` seeded battles on each
 * side (Player 1 and Player 2 on the same seeds), so neither build gets the side advantage.
 *
 * Standings: points = wins + draws / 2, then the mean HP margin (own HP fraction minus the
 * opponent's at the end, over every battle), then the name.
 *
 * Builds that are the same fighter (the battle reads only PvpFighter.loadout and .skills) enter
 * once, under the first of them; the others are listed in its `same`.
 */
import { runSeed } from '../engine/rng';
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { PvpBattle } from '../pvp/simulate';
import type { PvpHpConfig } from '../engine';

export interface TournamentStanding {
    key: string;
    name: string;
    battles: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
    winRate: number;
    hpMargin: number;
    /** Keys of the other builds that are the same fighter, so they did not play separately. */
    same?: string[];
}

export interface TournamentResult {
    battlesPerSide: number;
    /** Best first. */
    standings: TournamentStanding[];
    /** Win rate of the row build against the column build (0..1, a draw counts half), by key. */
    matrix: Record<string, Record<string, number>>;
}

/** One pairing of the tournament: `battlesPerSide` seeds with A as Player 1, the same seeds with B. */
export function playPair(a: PvpFighter, b: PvpFighter, cfg: PvpHpConfig, battlesPerSide: number): { aWins: number; bWins: number; draws: number; margin: number } {
    let aWins = 0, bWins = 0, draws = 0, margin = 0;
    for (let seed = 1; seed <= battlesPerSide; seed++) {
        const x = new PvpBattle(a, b, cfg, runSeed(seed)).run();
        if (x.outcome === 'p1') aWins++; else if (x.outcome === 'p2') bWins++; else draws++;
        margin += x.p1HpFrac - x.p2HpFrac;
        const y = new PvpBattle(b, a, cfg, runSeed(seed)).run();
        if (y.outcome === 'p2') aWins++; else if (y.outcome === 'p1') bWins++; else draws++;
        margin += y.p2HpFrac - y.p1HpFrac;
    }
    return { aWins, bWins, draws, margin };
}

/**
 * What a battle reads of a fighter (its loadout and skills, without the loadout's tag, which only
 * names it): two builds with the same signature fight identically.
 */
export const fighterSignature = (f: PvpFighter) => JSON.stringify([{ ...f.loadout, tag: undefined }, f.skills]);

/** Best first: points, then the mean HP margin, then the name. */
export const byStanding = (a: TournamentStanding, b: TournamentStanding) => b.points - a.points || b.hpMargin - a.hpMargin || a.name.localeCompare(b.name);

export function runTournament(
    entrants: { key: string; name: string; profile: UserProfile }[],
    libs: LibraryData,
    cfg: PvpHpConfig,
    battlesPerSide: number,
    log: (m: string) => void = () => {},
): TournamentResult {
    const all = entrants.map(e => fighterFromProfile(e.name, e.profile, calculateStats(e.profile, libs), libs));
    const same = new Map<number, string[]>();
    const keep: number[] = [];
    const bySig = new Map<string, number>();
    all.forEach((f, i) => {
        const sig = fighterSignature(f);
        const first = bySig.get(sig);
        if (first === undefined) { bySig.set(sig, i); keep.push(i); same.set(i, []); }
        else same.get(first)!.push(entrants[i].key);
    });
    const fighters = keep.map(i => all[i]);
    entrants = keep.map(i => entrants[i]);
    const rows = entrants.map(e => ({ key: e.key, name: e.name, battles: 0, wins: 0, draws: 0, losses: 0, margin: 0 }));
    const matrix: Record<string, Record<string, number>> = Object.fromEntries(entrants.map(e => [e.key, {}]));
    for (let i = 0; i < entrants.length; i++) {
        for (let j = i + 1; j < entrants.length; j++) {
            const { aWins: iw, bWins: jw, draws: dr, margin } = playPair(fighters[i], fighters[j], cfg, battlesPerSide);
            const n = 2 * battlesPerSide;
            const ri = rows[i], rj = rows[j];
            ri.battles += n; rj.battles += n;
            ri.wins += iw; ri.losses += jw; ri.draws += dr; ri.margin += margin;
            rj.wins += jw; rj.losses += iw; rj.draws += dr; rj.margin -= margin;
            matrix[ri.key][rj.key] = (iw + dr / 2) / n;
            matrix[rj.key][ri.key] = (jw + dr / 2) / n;
            log(`  ${ri.name} vs ${rj.name}: ${iw}-${dr}-${jw}`);
        }
    }
    const standings: TournamentStanding[] = rows.map((r, n) => ({
        ...(same.get(keep[n])!.length ? { same: same.get(keep[n]) } : {}),
        key: r.key, name: r.name, battles: r.battles, wins: r.wins, draws: r.draws, losses: r.losses,
        points: r.wins + r.draws / 2,
        winRate: r.battles ? (r.wins + r.draws / 2) / r.battles : 0,
        hpMargin: r.battles ? r.margin / r.battles : 0,
    }));
    standings.sort(byStanding);
    return { battlesPerSide, standings, matrix };
}
