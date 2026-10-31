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
 * Score: (index of the furthest cleared battle + 1) + the win rate of the battle after it, so a
 * build that is closer to clearing the next battle ranks above one that is not. The search walks
 * from a hint (the last result) instead of scanning from the start: later battles are harder
 * (enemy stats grow with the age and the difficulty), so the frontier is found in a few steps.
 */
import type { UserProfile } from '../types/Profile';
import { calculateStats } from '../utils/statEngine';
import { simulateBattleMulti } from '../utils/BattleSimulator';
import { getAvailableStages } from '../utils/BattleHelper';
import { mainBattleDifficultyCount } from '../engine/enemies';
import { difficultyName } from '../utils/difficulty';
import { AGES } from '../utils/constants';
import type { EvalPool } from './evalPool';

export interface QuestBattle {
    difficulty: number;
    ageIdx: number;
    battleIdx: number;
}

export interface QuestProgress {
    /** Index of the furthest cleared battle in the quest line, -1 when none. */
    index: number;
    /** That battle (null when none) and its win rate (0..1). */
    battle: QuestBattle | null;
    winRate: number;
    /** Win rate of the battle after it (0..1), 0 at the end of the quest. */
    nextWinRate: number;
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

export function questBattleLabel(b: QuestBattle | null): string {
    if (!b) return 'none';
    return `${difficultyName(b.difficulty)} ${AGES[b.ageIdx] ?? `Age ${b.ageIdx + 1}`} ${b.battleIdx + 1}`;
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
        const cache = new Map<number, number>();
        const win = (i: number): number => {
            if (i < 0) return 1;
            if (i >= this.line.length) return 0;
            let w = cache.get(i);
            if (w === undefined) {
                const b = this.line[i];
                if (this.pool) w = this.pool.questWinRate(p, b, this.runs) ?? 0;
                else w = (simulateBattleMulti(stats(), p, b.ageIdx, b.battleIdx, b.difficulty, this.libs, this.runs)?.winProbability ?? 0) / 100;
                cache.set(i, w);
            }
            return w;
        };
        let i = Math.min(Math.max(hint ?? this.hint, 0), this.line.length - 1);
        if (win(i) >= 0.5) {
            while (i + 1 < this.line.length && win(i + 1) >= 0.5) i++;
        } else {
            while (i >= 0 && win(i) < 0.5) i--;
        }
        this.hint = Math.max(0, i);
        const next = win(i + 1);
        return {
            index: i,
            battle: i >= 0 ? this.line[i] : null,
            winRate: i >= 0 ? win(i) : 0,
            nextWinRate: i + 1 < this.line.length ? next : 0,
            total: this.line.length,
            score: i + 1 + (i + 1 < this.line.length ? next : 0),
        };
    }
}
