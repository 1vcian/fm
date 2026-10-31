/// <reference lib="webworker" />
/**
 * One Battle Predictor worker: it holds the page's own player stats, profile and battle libraries
 * (sent once, so the numbers are exactly the page's) and measures battles on request
 * (src/progress/adaptive.ts).
 */
import { dungeonBattleWins, mainBattleWins } from '../utils/BattleSimulator';
import { measureAdaptive, type LevelOutcome } from './adaptive';
import type { AggregatedStats } from '../utils/statEngine';
import type { UserProfile } from '../types/Profile';
import type { DebugConfig } from '../utils/VisualBattleEngine';

export type BattleTarget =
    | { mode: 'main'; difficulty: number; ageIdx: number; battleIdx: number }
    | { mode: 'dungeon'; dungeon: 'hammer' | 'skill' | 'egg' | 'potion'; level: number };

export type WorkerIn =
    | { type: 'init'; stats: AggregatedStats; profile: UserProfile | null; libs: any; debugConfig?: DebugConfig }
    | { type: 'task'; id: number; target: BattleTarget };

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
        const { stats, profile, libs, debugConfig } = ctx;
        const t = m.target;
        const outcome = measureAdaptive((from, to) => t.mode === 'main'
            ? mainBattleWins(stats, profile, t.ageIdx, t.battleIdx, t.difficulty, libs, from, to, debugConfig)
            : dungeonBattleWins(stats, profile, t.dungeon, t.level, libs, from, to, debugConfig));
        post({ type: 'result', id: m.id, outcome });
    } catch (err) {
        post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
};
