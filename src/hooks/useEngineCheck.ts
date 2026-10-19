import { useEffect, useMemo, useRef, useState } from 'react';
import { playerUnitSpec, skillSpecs, type EngineCheckResult } from '../engine';
import type { AggregatedStats } from '../utils/statEngine';
import type { SkillSlot } from '../types/Profile';

/**
 * Engine-measured DPS/HPS for a build (src/engine/dummyRun.ts engineCheck: the 24 h tested run
 * plus the short opening and several-targets runs), computed in a Web Worker with progress.
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
type WorkerMessage = { result?: EngineCheckResult; error?: string; progress?: number };
type Listener = (m: WorkerMessage) => void;
const pending = new Map<number, Listener>();
/** Jobs scheduled or running and not answered yet, by input key. */
interface Job { listeners: Set<Listener>; timer: ReturnType<typeof setTimeout> | null; posted: boolean }
const inflight = new Map<string, Job>();

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(new URL('../workers/engineCheck.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const cb = pending.get(e.data?.id);
            if (!cb) return;
            if (e.data.result === undefined && e.data.error === undefined) { cb(e.data); return; }
            pending.delete(e.data.id);
            cb(e.data);
        };
    }
    return worker;
}

export type EngineCheckState =
    | { status: 'idle'; result: null; error: null }
    | { status: 'loading'; result: null; error: null; progress?: number }
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
        const listener: Listener = (m) => {
            if (!live) return;
            if (m.result) setState({ status: 'done', result: m.result, error: null });
            else if (m.error !== undefined) setState({ status: 'error', result: null, error: m.error || 'Engine check failed' });
            else setState({ status: 'loading', result: null, error: null, progress: m.progress });
        };
        // One job per build: hooks with the same input (a panel and its modal, the original and
        // the current build of a comparison) join the job that is already scheduled or running.
        let job = inflight.get(input.key);
        if (!job) {
            const created: Job = { listeners: new Set(), timer: null, posted: false };
            const k = input.key, unit = input.unit, skills = input.skills;
            created.timer = setTimeout(() => {
                created.posted = true;
                const id = nextId++;
                pending.set(id, (m) => {
                    const done = m.result !== undefined || m.error !== undefined;
                    if (m.result) {
                        cache.set(k, m.result);
                        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
                    }
                    if (done) inflight.delete(k);
                    for (const l of created.listeners) l(m);
                });
                getWorker().postMessage({ id, unit, skills });
            }, DEBOUNCE_MS);
            inflight.set(k, created);
            job = created;
        }
        const joined = job;
        joined.listeners.add(listener);
        return () => {
            live = false;
            joined.listeners.delete(listener);
            // Nobody waits for a job that has not started yet: drop it.
            if (!joined.posted && joined.listeners.size === 0) {
                if (joined.timer) clearTimeout(joined.timer);
                inflight.delete(input.key);
            }
        };
    }, [key]);

    return state;
}
