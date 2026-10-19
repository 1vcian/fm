/**
 * Engine check worker: runs src/engine/dummyRun.ts engineCheck off the main thread.
 * In:  { id, unit: UnitSpec, skills: SkillSpec[] }
 * Out: { id, progress } while running (0..1), then { id, result: EngineCheckResult } or { id, error }
 */
import { engineCheck } from '../engine/dummyRun';

self.onmessage = (e: MessageEvent) => {
    const { id, unit, skills } = e.data || {};
    const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
    try {
        let last = -1;
        const result = engineCheck(unit, skills || [], {
            onProgress: (f) => {
                const pct = Math.floor(f * 100);
                if (pct !== last) { last = pct; post({ id, progress: f }); }
            },
        });
        post({ id, result });
    } catch (err) {
        post({ id, error: String((err as Error)?.message || err) });
    }
};
