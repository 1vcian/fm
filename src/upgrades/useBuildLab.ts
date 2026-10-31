/**
 * The measuring bench the build pages share: the battle pool, where the current build gets in each
 * mode, and what each stat is worth there. Everything follows the header's tree mode.
 */
import { useEffect, useMemo, useState } from 'react';
import { useBattleSimulation } from '../hooks/useBattleSimulation';
import { useTreeModeProfile } from '../hooks/useGlobalStats';
import { BattlePool } from '../progress/battlePool';
import { readHint, saveHint, searchFrontier } from '../progress/frontierSearch';
import type { LevelOutcome } from '../progress/adaptive';
import type { BattleTarget } from '../progress/battleWorker';
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { measureRates, modeLine, modeScores, RANK_MODES, type Build, type RankMode, type Rates } from './ranking';

/** Where the build gets in a mode: the last battle cleared in order, and the one after it (null: the line is finished). */
export interface Reached { cleared: number; next: LevelOutcome | null }

export interface BuildLab {
    profile: UserProfile;
    libs: LibraryData;
    lines: Record<RankMode, BattleTarget[]> | null;
    reached: Partial<Record<RankMode, Reached>>;
    /** Set once every mode is measured, with `pool` and `base`. */
    frontiers: Record<RankMode, number> | null;
    pool: BattlePool | null;
    base: Build | null;
    failed: string | null;
}

/** A pool stopped under a running measurement rejects it; that is not an error to show. */
export const wasStopped = (e: unknown) => e instanceof Error && e.message === 'stopped';

export function useBuildLab(): BuildLab {
    const { libs: battleLibs, isLoading, maxDungeonLevel } = useBattleSimulation();
    const { profile, libs, ready } = useTreeModeProfile();
    const [reached, setReached] = useState<BuildLab['reached']>({});
    const [state, setState] = useState<Pick<BuildLab, 'frontiers' | 'pool' | 'base'>>({ frontiers: null, pool: null, base: null });
    const [failed, setFailed] = useState<string | null>(null);

    const lines = useMemo(() => {
        if (isLoading || !battleLibs.mainBattleLibrary || maxDungeonLevel === null) return null;
        return Object.fromEntries(RANK_MODES.map(m => [m, modeLine(m, battleLibs, maxDungeonLevel)])) as Record<RankMode, BattleTarget[]>;
    }, [battleLibs, isLoading, maxDungeonLevel]);

    useEffect(() => {
        if (!ready || !lines) return;
        const stats = calculateStats(profile, libs);
        const pool = new BattlePool({ type: 'init', stats, profile, libs: battleLibs });
        let cancelled = false;
        setReached({}); setState({ frontiers: null, pool: null, base: null }); setFailed(null);

        Promise.all(RANK_MODES.map(async m => {
            const hintMode = m === 'main' ? 'main' : `dungeon-${m}`;
            const line = lines[m];
            const seen = new Map<number, LevelOutcome | null>();
            const frontier = await searchFrontier(line.length, readHint(profile, hintMode), pool.size, i => pool.run(line[i]), {
                cancelled: () => cancelled, onResult: (i, o) => seen.set(i, o), onEstimate: () => { },
            });
            if (!cancelled) {
                saveHint(profile, hintMode, frontier);
                setReached(r => ({ ...r, [m]: { cleared: frontier, next: seen.get(frontier + 1) ?? null } }));
            }
            return [m, frontier] as const;
        })).then(entries => {
            if (!cancelled) setState({ frontiers: Object.fromEntries(entries) as Record<RankMode, number>, pool, base: { stats, profile } });
        }).catch(e => {
            if (!cancelled && !wasStopped(e)) setFailed(String(e?.message ?? e));
        });
        return () => { cancelled = true; pool.dispose(); };
    }, [profile, libs, ready, lines, battleLibs]);

    return { profile, libs, lines, reached, failed, ...state };
}

/** A profile's score in every mode, at the lab's frontiers. */
export function scoreProfile(lab: BuildLab, profile: UserProfile) {
    return modeScores(lab.pool!, lab.lines!, { stats: calculateStats(profile, lab.libs), profile }, lab.frontiers!);
}

/** What each stat is worth for the lab's build. */
export function useRates(lab: BuildLab): { rates: Rates | null; failed: string | null } {
    const { pool, lines, base, frontiers, libs } = lab;
    const [rates, setRates] = useState<Rates | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    useEffect(() => {
        setRates(null); setFailed(null);
        if (!pool || !lines || !base || !frontiers) return;
        let live = true;
        measureRates(pool, lines, base, frontiers, libs).then(r => {
            if (!live) return;
            if (r) setRates(r); else setFailed('Add at least one item to your profile first.');
        }).catch(e => { if (live && !wasStopped(e)) setFailed(String(e?.message ?? e)); });
        return () => { live = false; };
    }, [pool, lines, base, frontiers, libs]);
    return { rates, failed: failed ?? lab.failed };
}
