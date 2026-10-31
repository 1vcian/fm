/**
 * "Fight against": the player's own profile enters the preset tournament (src/presets/tournament.ts)
 * as one more build. It plays every build on the same seeds and sides as the builds played each
 * other, so the builds' results against one another stay as published and the new standings are
 * exactly the round robin with the player in it.
 */
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { fighterFromProfile } from '../pvp/fighter';
import type { PvpHpConfig } from '../engine';
import type { ProfilePresetsFile } from './buildPresets';
import { byStanding, playPair, type TournamentStanding } from './tournament';

/** The player's key in the standings. */
export const CHALLENGER_KEY = '__you__';

export interface ChallengeMatch {
    key: string;
    name: string;
    wins: number;
    draws: number;
    losses: number;
    /** The player's win rate against this build (a draw counts half). */
    winRate: number;
}

export interface ChallengeResult {
    battlesPerSide: number;
    /** The player's pairings, in the order of the published standings. */
    matches: ChallengeMatch[];
    /** The round robin with the player in it, best first. */
    standings: TournamentStanding[];
    /** The player's place (1 is first). */
    rank: number;
}

export function runChallenge(
    you: { name: string; profile: UserProfile },
    file: ProfilePresetsFile,
    libs: LibraryData,
    cfg: PvpHpConfig,
    onProgress: (done: number, total: number) => void = () => {},
): ChallengeResult {
    const t = file.tournament;
    if (!t) throw new Error('these preset builds have no tournament');
    const n = t.battlesPerSide;
    const byKey = new Map(file.presets.map(p => [p.key, p]));
    const me = fighterFromProfile(you.name, you.profile, calculateStats(you.profile, libs), libs);
    const mine = { key: CHALLENGER_KEY, name: you.name, battles: 0, wins: 0, draws: 0, losses: 0, margin: 0 };
    const matches: ChallengeMatch[] = [];
    const standings: TournamentStanding[] = [];
    t.standings.forEach((s, i) => {
        const p = byKey.get(s.key);
        if (!p) throw new Error(`build ${s.key} is missing from the preset file`);
        const other = fighterFromProfile(p.name, p.profile, calculateStats(p.profile, libs), libs);
        const r = playPair(me, other, cfg, n);
        const battles = 2 * n;
        mine.battles += battles; mine.wins += r.aWins; mine.losses += r.bWins; mine.draws += r.draws; mine.margin += r.margin;
        matches.push({ key: s.key, name: s.name, wins: r.aWins, draws: r.draws, losses: r.bWins, winRate: (r.aWins + r.draws / 2) / battles });
        // The build's published record plus its pairing with the player.
        const total = s.battles + battles;
        const wins = s.wins + r.bWins, draws = s.draws + r.draws, losses = s.losses + r.aWins;
        standings.push({
            ...(s.same ? { same: s.same } : {}),
            key: s.key, name: s.name, battles: total, wins, draws, losses,
            points: wins + draws / 2,
            winRate: (wins + draws / 2) / total,
            hpMargin: (s.hpMargin * s.battles - r.margin) / total,
        });
        onProgress(i + 1, t.standings.length);
    });
    standings.push({
        key: CHALLENGER_KEY, name: you.name, battles: mine.battles, wins: mine.wins, draws: mine.draws, losses: mine.losses,
        points: mine.wins + mine.draws / 2,
        winRate: mine.battles ? (mine.wins + mine.draws / 2) / mine.battles : 0,
        hpMargin: mine.battles ? mine.margin / mine.battles : 0,
    });
    standings.sort(byStanding);
    return { battlesPerSide: n, matches, standings, rank: standings.findIndex(s => s.key === CHALLENGER_KEY) + 1 };
}
