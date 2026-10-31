/// <reference lib="webworker" />
/**
 * One Battle Predictor worker: it holds the page's own player stats, profile and battle libraries
 * (sent once, so the numbers are exactly the page's) and measures battles on request
 * (src/progress/adaptive.ts).
 */
import { dungeonBattleWins, mainBattleWins } from '../utils/BattleSimulator';
import { measureAdaptive, measureFixed, type LevelOutcome } from './adaptive';
import type { AggregatedStats } from '../utils/statEngine';
import type { UserProfile } from '../types/Profile';
import type { DebugConfig } from '../utils/VisualBattleEngine';

export type BattleTarget =
    | { mode: 'main'; difficulty: number; ageIdx: number; battleIdx: number }
    | { mode: 'dungeon'; dungeon: 'hammer' | 'skill' | 'egg' | 'potion'; level: number };

/** What a task may change: another build instead of the page's, and fixed seeds 1..runs instead of adaptive runs. */
export interface TaskOptions {
    build?: { stats: AggregatedStats; profile: UserProfile | null };
    runs?: number;
}

export type WorkerIn =
    | { type: 'init'; stats: AggregatedStats; profile: UserProfile | null; libs: any; debugConfig?: DebugConfig }
    | { type: 'task'; id: number; target: BattleTarget; options?: TaskOptions };

export type WorkerOut =
    | { type: 'result'; id: number; outcome: LevelOutcome | null }
    | { type: 'error'; id: number; message: string };

let ctx: Extract<WorkerIn, { type: 'init' }> | null = null;
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerIn>) => {
    const m = e.data;
    if (m.type === 'init') { ctx = m; return; }
    try {
        if (!ctx) throw new Error('worker not initialised');
        const { libs, debugConfig } = ctx;
        const { stats, profile } = m.options?.build ?? ctx;
        const t = m.target;
        const batch = (from: number, to: number) => t.mode === 'main'
            ? mainBattleWins(stats, profile, t.ageIdx, t.battleIdx, t.difficulty, libs, from, to, debugConfig)
            : dungeonBattleWins(stats, profile, t.dungeon, t.level, libs, from, to, debugConfig);
        const runs = m.options?.runs;
        const outcome = runs ? measureFixed(batch, runs) : measureAdaptive(batch);
        post({ type: 'result', id: m.id, outcome });
    } catch (err) {
        post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
};
