import { useCallback, useEffect, useRef, useState } from 'react';
import type { OptimizerInput, OptimizerResult } from '../optimizer/buildOptimizer';
import type { LibraryData } from '../utils/statEngine';

export type BuildOptimizerStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface BuildOptimizerState {
    status: BuildOptimizerStatus;
    stage: 1 | 2;
    done: number;
    total: number;
    result: OptimizerResult | null;
    error: string | null;
    /** Wall time of the last finished run (worker start to answer), ms. */
    wallMs: number | null;
}

const IDLE: BuildOptimizerState = { status: 'idle', stage: 1, done: 0, total: 0, result: null, error: null, wallMs: null };

/**
 * Runs the build optimizer (src/optimizer/buildOptimizer.ts) in a Web Worker. One run at a time;
 * cancel terminates the worker (the search is one synchronous loop inside it), the next run
 * starts a fresh one. The game libraries are posted once per worker and library set.
 */
export function useBuildOptimizer() {
    const workerRef = useRef<Worker | null>(null);
    const libsSent = useRef<LibraryData | null>(null);
    const runId = useRef(0);
    const startedAt = useRef(0);
    const [state, setState] = useState<BuildOptimizerState>(IDLE);

    const kill = useCallback(() => {
        workerRef.current?.terminate();
        workerRef.current = null;
        libsSent.current = null;
    }, []);

    useEffect(() => kill, [kill]);

    const run = useCallback((input: Omit<OptimizerInput, 'libs'>, libs: LibraryData) => {
        if (!workerRef.current) {
            const w = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
            w.onmessage = (e: MessageEvent) => {
                const m = e.data || {};
                if (m.id !== runId.current) return;
                if (m.type === 'progress') {
                    setState(s => ({ ...s, stage: m.stage, done: m.done, total: m.total }));
                } else if (m.type === 'done') {
                    setState({ status: 'done', stage: 2, done: 1, total: 1, result: m.result, error: null, wallMs: performance.now() - startedAt.current });
                } else if (m.type === 'error') {
                    setState({ ...IDLE, status: 'error', error: m.error });
                }
            };
            w.onerror = (e) => setState({ ...IDLE, status: 'error', error: e.message || 'Optimizer worker failed' });
            workerRef.current = w;
        }
        if (libsSent.current !== libs) {
            workerRef.current.postMessage({ type: 'libs', libs });
            libsSent.current = libs;
        }
        const id = ++runId.current;
        startedAt.current = performance.now();
        setState({ ...IDLE, status: 'running' });
        workerRef.current.postMessage({ type: 'run', id, input });
    }, []);

    const cancel = useCallback(() => {
        runId.current++;
        kill();
        setState(s => ({ ...s, status: 'cancelled' }));
    }, [kill]);

    return { ...state, run, cancel };
}
