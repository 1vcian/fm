/**
 * The expensive measurements of the preset search (survival duels, arena battles, main quest
 * battles). Two ways to spread them over threads: one measurement cut into seed ranges
 * (survival, arena, questOutcome), or many whole measurements of different builds at once (many),
 * which is what the search mostly needs: it knows every candidate of a step in advance.
 *
 * EvalCore runs the work; EvalPool is what the search calls. localPool runs everything in this
 * thread; scripts/presetPool.ts runs it on worker threads and waits for them synchronously, so
 * the search code is the same either way and the results are identical (same seeds, same sums).
 */
import { runSeed } from '../engine/rng';
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { mainBattleWins } from '../utils/BattleSimulator';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { PvpBattle } from '../pvp/simulate';
import type { PvpHpConfig } from '../engine';
import { survivalDuel } from './survivalDuel';
import { QuestMeter, type QuestBattle, type QuestOutcome } from './mainProgress';

/** One whole measurement of one build, for EvalPool.many. */
export type ScoreTask =
    /** Mean hits survived (survival duels, seeds 1..runs). */
    | { kind: 'survival'; p: UserProfile; attacker: UserProfile; seconds: number; runs: number }
    /** EvalPool.arena. */
    | { kind: 'arena'; p: UserProfile; field: UserProfile[]; perSide: number }
    /** QuestMeter score, walking from the given hint (the result can depend on where the walk starts). */
    | { kind: 'quest'; p: UserProfile; runs: number; hint: number };

export interface EvalPool {
    /** Mean hits and seconds the defender survives against the attacker, seeds 1..runs. */
    survival(defender: UserProfile, attacker: UserProfile, seconds: number, runs: number): { hits: number; seconds: number };
    /**
     * Arena score against the field: perSide seeds on each side per opponent, a win 1, a draw
     * 0.5, plus the mean HP margin x 1e-3 as a tiebreak.
     */
    arena(me: UserProfile, field: UserProfile[], perSide: number): number;
    /** Win rate and loss progress of a main quest battle over seeds 1..runs; null when the battle has no waves. */
    questOutcome(p: UserProfile, battle: QuestBattle, runs: number): QuestOutcome | null;
    /** Many measurements at once, in order. */
    many(tasks: ScoreTask[]): number[];
}

/** The ranges themselves. Fighters of reused profiles (attacker, field) are built once. */
export class EvalCore {
    private readonly fighters = new WeakMap<UserProfile, PvpFighter>();
    private readonly meters = new Map<number, QuestMeter>();

    constructor(private readonly libs: LibraryData, private readonly questLibs: any, private readonly arenaCfg: PvpHpConfig | null) {}

    fighter(p: UserProfile, cache: boolean): PvpFighter {
        const hit = cache ? this.fighters.get(p) : undefined;
        if (hit) return hit;
        const f = fighterFromProfile('Preset', p, calculateStats(p, this.libs), this.libs);
        if (cache) this.fighters.set(p, f);
        return f;
    }

    /** Sum of hits and seconds over seeds from..to. */
    survival(defender: UserProfile, attacker: UserProfile, seconds: number, from: number, to: number): [number, number] {
        const me = this.fighter(defender, false), them = this.fighter(attacker, true);
        let hits = 0, secs = 0;
        for (let seed = from; seed <= to; seed++) {
            const r = survivalDuel(me, them, seconds, runSeed(seed));
            hits += r.hits;
            secs += r.seconds;
        }
        return [hits, secs];
    }

    /**
     * Points and HP margin of the battles from..to of the flat list (opponent i, seed s) at index
     * i x perSide + s - 1, each one battle on either side.
     */
    arena(me: UserProfile, field: UserProfile[], perSide: number, from: number, to: number): [number, number] {
        if (!this.arenaCfg) throw new Error('arena config missing');
        const f = this.fighter(me, false);
        let points = 0, margin = 0;
        for (let k = from; k <= to; k++) {
            const opp = this.fighter(field[Math.floor(k / perSide)], true);
            const seed = runSeed((k % perSide) + 1);
            const a = new PvpBattle(f, opp, this.arenaCfg, seed).run();
            points += a.outcome === 'p1' ? 1 : a.outcome === 'draw' ? 0.5 : 0;
            margin += a.p1HpFrac - a.p2HpFrac;
            const b = new PvpBattle(opp, f, this.arenaCfg, seed).run();
            points += b.outcome === 'p2' ? 1 : b.outcome === 'draw' ? 0.5 : 0;
            margin += b.p2HpFrac - b.p1HpFrac;
        }
        return [points, margin];
    }

    /** One whole measurement in this thread. */
    score(t: ScoreTask): number {
        if (t.kind === 'survival') return this.survival(t.p, t.attacker, t.seconds, 1, t.runs)[0] / t.runs;
        if (t.kind === 'arena') {
            const n = t.field.length * t.perSide;
            const [points, margin] = this.arena(t.p, t.field, t.perSide, 0, n - 1);
            return points / (2 * n) + (margin / (2 * n)) * 1e-3;
        }
        let m = this.meters.get(t.runs);
        if (!m) { m = new QuestMeter(this.questLibs, t.runs); this.meters.set(t.runs, m); }
        return m.measure(t.p, t.hint).score;
    }

    /**
     * Wins of a main quest battle over seeds from..to and the summed enemy HP share removed in the
     * lost ones; wins -1 when the battle has no waves.
     */
    quest(p: UserProfile, b: QuestBattle, from: number, to: number): [number, number] {
        const r = mainBattleWins(calculateStats(p, this.questLibs), p, b.ageIdx, b.battleIdx, b.difficulty, this.questLibs, from, to);
        return r ? [r.wins, r.lostProgress] : [-1, 0];
    }
}

/** Win rate, and the mean enemy HP share removed over the lost runs (0 when none was lost). */
export const questOutcomeOf = (wins: number, lostProgress: number, runs: number): QuestOutcome => ({
    win: wins / runs,
    lossProgress: runs > wins ? lostProgress / (runs - wins) : 0,
});

/** Every range in this thread. */
export function localPool(core: EvalCore): EvalPool {
    return {
        survival(defender, attacker, seconds, runs) {
            const [h, s] = core.survival(defender, attacker, seconds, 1, runs);
            return { hits: h / runs, seconds: s / runs };
        },
        arena(me, field, perSide) {
            const n = field.length * perSide;
            const [points, margin] = core.arena(me, field, perSide, 0, n - 1);
            return points / (2 * n) + (margin / (2 * n)) * 1e-3;
        },
        questOutcome(p, b, runs) {
            const [wins, lost] = core.quest(p, b, 1, runs);
            return wins < 0 ? null : questOutcomeOf(wins, lost, runs);
        },
        many(tasks) {
            return tasks.map(t => core.score(t));
        },
    };
}
