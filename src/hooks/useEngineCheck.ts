import { useEffect, useMemo, useRef, useState } from 'react';
import { playerUnitSpec, skillSpecs, type EngineCheckResult } from '../engine';
import type { AggregatedStats } from '../utils/statEngine';
import type { SkillSlot } from '../types/Profile';

/**
 * Engine-measured DPS/HPS for a build (src/engine/dummyRun.ts), computed in a Web Worker.
 *
 * The worker receives the exact engine input (player UnitSpec + SkillSpecs, both derived from
 * the same aggregates the page shows), so the cache key is that input itself: an unchanged build
 * is never measured twice. Changes are debounced; a stale answer is dropped.
 */
const DEBOUNCE_MS = 400;
const CACHE_MAX = 50;
const cache = new Map<string, EngineCheckResult>();
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: { result?: EngineCheckResult; error?: string }) => void>();

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(new URL('../workers/engineCheck.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const cb = pending.get(e.data?.id);
            if (cb) { pending.delete(e.data.id); cb(e.data); }
        };
    }
    return worker;
}

export type EngineCheckState =
    | { status: 'idle' | 'loading'; result: null; error: null }
    | { status: 'done'; result: EngineCheckResult; error: null }
    | { status: 'error'; result: null; error: string };

export function useEngineCheck(
    stats: AggregatedStats | null | undefined,
    equipped: SkillSlot[] | null | undefined,
    skillLibrary: any,
    enabled = true
): EngineCheckState {
    const input = useMemo(() => {
        if (!enabled || !stats || !skillLibrary) return null;
        const unit = playerUnitSpec(stats as never);
        const skills = skillSpecs(
            stats as never,
            (equipped || []).filter(s => s && s.id && s.level > 0).map(s => ({ id: s.id, level: s.level })),
            skillLibrary
        );
        return { unit, skills, key: JSON.stringify([unit, skills]) };
    }, [enabled, stats, equipped, skillLibrary]);

    const [state, setState] = useState<EngineCheckState>({ status: 'idle', result: null, error: null });
    // Keyed on the engine input's content: a new stats object for the same build changes nothing.
    const inputRef = useRef(input);
    inputRef.current = input;
    const key = input?.key ?? null;

    useEffect(() => {
        const input = inputRef.current;
        if (!input || key === null) { setState({ status: 'idle', result: null, error: null }); return; }
        const hit = cache.get(input.key);
        if (hit) { setState({ status: 'done', result: hit, error: null }); return; }
        setState({ status: 'loading', result: null, error: null });
        let live = true;
        const timer = setTimeout(() => {
            const id = nextId++;
            pending.set(id, ({ result, error }) => {
                if (result) {
                    cache.set(input.key, result);
                    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
                }
                if (!live) return;
                setState(result ? { status: 'done', result, error: null } : { status: 'error', result: null, error: error || 'Engine check failed' });
            });
            getWorker().postMessage({ id, unit: input.unit, skills: input.skills });
        }, DEBOUNCE_MS);
        return () => { live = false; clearTimeout(timer); };
    }, [key]);

    return state;
}
