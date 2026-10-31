/**
 * How far a build gets in the main quest, measured by the battle simulator the Progress page uses
 * (src/utils/BattleSimulator.ts simulateBattleMulti: the combat engine, every wave of the battle,
 * the player's HP carried from wave to wave, skills on auto).
 *
 * The quest is one line of battles: every MainBattleLibrary battle in (age, battle) order on the
 * first difficulty, then the same line on the next difficulty (GetNextBattleId 0x78252FC raises
 * the difficulty after the last battle), for as many difficulties as the config has
 * (mainBattleDifficultyCount). A battle counts as cleared when the build wins at least half of
 * its seeded runs.
 *
 * Score: (index of the furthest cleared battle + 1) + how close the build gets to the battle after
 * it: its win rate plus, for the runs it loses, the mean share of the battle's enemy HP removed
 * (win + (1 - win) x lossProgress, below 1). Two builds that both lose every run there are still
 * told apart by how far into the enemy HP they get. The search walks
 * from a hint (the last result) instead of scanning from the start: later battles are harder
 * (enemy stats grow with the age and the difficulty), so the frontier is found in a few steps.
 */
import type { UserProfile } from '../types/Profile';
import { calculateStats } from '../utils/statEngine';
import { mainBattleWins } from '../utils/BattleSimulator';
import { getAvailableStages } from '../utils/BattleHelper';
import { mainBattleDifficultyCount } from '../engine/enemies';
import { difficultyName } from '../utils/difficulty';
import type { EvalPool } from './evalPool';

export interface QuestBattle {
    difficulty: number;
    ageIdx: number;
    battleIdx: number;
}

/** One battle measured: win rate (0..1) and the mean enemy HP share removed in the lost runs (0..1). */
export interface QuestOutcome {
    win: number;
    lossProgress: number;
}

/** How close a battle's outcome is to a clear, 0..1: the win rate, and the losses by enemy HP removed. */
export const questReach = (o: QuestOutcome) => o.win + (1 - o.win) * o.lossProgress;

export interface QuestProgress {
    /** Index of the furthest cleared battle in the quest line, -1 when none. */
    index: number;
    /** That battle (null when none) and its win rate (0..1). */
    battle: QuestBattle | null;
    winRate: number;
    /** Win rate of the battle after it (0..1), 0 at the end of the quest. */
    nextWinRate: number;
    /** Mean share of the next battle's enemy HP removed in its lost runs (0..1), 0 at the end. */
    nextLossProgress: number;
    /** Battles in the quest line. */
    total: number;
    score: number;
}

export function questLine(libs: any): QuestBattle[] {
    const stages = getAvailableStages(libs);
    const out: QuestBattle[] = [];
    const count = mainBattleDifficultyCount(libs.mainBattleConfig);
    for (let difficulty = 0; difficulty < count; difficulty++) {
        for (const s of stages) out.push({ difficulty, ageIdx: s.ageIdx, battleIdx: s.battleIdx });
    }
    return out;
}

/**
 * A battle as the game names it: GameContextExtensions.FormatBattleNumber (0x402C334 in
 * 2026_10_27_09_45) formats the difficulty's text with ageIdx + 1 and battleIdx + 1, numbers
 * only, no age name ("Hard 11-15").
 */
export function questBattleLabel(b: QuestBattle | null): string {
    if (!b) return 'none';
    return `${difficultyName(b.difficulty)} ${b.ageIdx + 1}-${b.battleIdx + 1}`;
}

export class QuestMeter {
    readonly line: QuestBattle[];
    private hint = 0;

    constructor(private readonly libs: any, private readonly runs: number, private readonly pool?: EvalPool) {
        this.line = questLine(libs);
    }

    /** Where the next walk starts (the last result). */
    get hintIndex(): number {
        return this.hint;
    }

    /** `hint`: where the walk starts instead of the last result. */
    measure(p: UserProfile, hint?: number): QuestProgress {
        let s: ReturnType<typeof calculateStats> | null = null;
        const stats = () => (s ??= calculateStats(p, this.libs));
        const cache = new Map<number, QuestOutcome>();
        const outcome = (i: number): QuestOutcome => {
            if (i < 0) return { win: 1, lossProgress: 0 };
            if (i >= this.line.length) return { win: 0, lossProgress: 0 };
            let o = cache.get(i);
            if (o === undefined) {
                const b = this.line[i];
                if (this.pool) o = this.pool.questOutcome(p, b, this.runs) ?? { win: 0, lossProgress: 0 };
                else {
                    // The same seeds 1..runs as simulateBattleMulti.
                    const r = mainBattleWins(stats(), p, b.ageIdx, b.battleIdx, b.difficulty, this.libs, 1, this.runs);
                    o = r ? { win: r.wins / this.runs, lossProgress: this.runs > r.wins ? r.lostProgress / (this.runs - r.wins) : 0 } : { win: 0, lossProgress: 0 };
                }
                cache.set(i, o);
            }
            return o;
        };
        const win = (i: number) => outcome(i).win;
        let i = Math.min(Math.max(hint ?? this.hint, 0), this.line.length - 1);
        if (win(i) >= 0.5) {
            while (i + 1 < this.line.length && win(i + 1) >= 0.5) i++;
        } else {
            while (i >= 0 && win(i) < 0.5) i--;
        }
        this.hint = Math.max(0, i);
        const atEnd = i + 1 >= this.line.length;
        const next = outcome(i + 1);
        return {
            index: i,
            battle: i >= 0 ? this.line[i] : null,
            winRate: i >= 0 ? win(i) : 0,
            nextWinRate: atEnd ? 0 : next.win,
            nextLossProgress: atEnd ? 0 : next.lossProgress,
            total: this.line.length,
            score: i + 1 + (atEnd ? 0 : questReach(next)),
        };
    }
}
