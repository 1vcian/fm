/**
 * Engine check worker: runs src/engine/dummyRun.ts engineCheck off the main thread.
 * In:  { id, unit: UnitSpec, skills: SkillSpec[] }
 * Out: { id, result: EngineCheckResult } or { id, error }
 */
import { engineCheck } from '../engine/dummyRun';

self.onmessage = (e: MessageEvent) => {
    const { id, unit, skills } = e.data || {};
    try {
        const result = engineCheck(unit, skills || []);
        (self as unknown as Worker).postMessage({ id, result });
    } catch (err) {
        (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message || err) });
    }
};
