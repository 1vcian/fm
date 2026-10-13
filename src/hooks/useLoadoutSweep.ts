import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyTreeMode, useStatLibraries } from './useGlobalStats';
import { useProfile } from '../context/ProfileContext';
import { useTreeMode } from '../context/TreeModeContext';
import { useComparison } from '../context/ComparisonContext';
import { StatEngine, LibraryData, AggregatedStats, calculateStats } from '../utils/statEngine';
import { PetSlot, MountSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS } from '../utils/constants';

/** How many combinations to evaluate per animation frame. */
const BATCH_SIZE = 200;

export type SweepMetric = 'lifesteal' | 'dps' | 'power' | 'heal' | 'balanced';

export interface LoadoutCombo {
    petSet: PetSlot[];
    mount: MountSlot | null;
}

/** One scored combination. Only the ranking metrics, cheap enough for the whole sweep. */
export interface SweepResult extends LoadoutCombo {
    dps: number;
    power: number;
    /** Upper bound: in-game healing is capped at max HP (BattleSystem.ApplyDmg, RVA 0x77F4BD0). */
    lifestealPerSec: number;
    /** Upper bound, same cap as lifestealPerSec. */
    healPerSec: number;
}

export interface SweepOptions {
    /**
     * Profile to sweep. Omitted: the active profile. null: no sweep (idle, no CPU spent).
     * The header's tree mode is applied on top, exactly as useGlobalStats does.
     * Pass a stable snapshot: a new object identity restarts the sweep.
     */
    base?: UserProfile | null;
    /**
     * True (default): each saved build is scored at its own stored level. False: every
     * candidate is scored at level 1 so only secondary stats decide; equipping still
     * uses the saved level.
     */
    respectSavedLevels?: boolean;
}

export type SweepStatus = 'idle' | 'running' | 'done';

const mountKey = (m: MountSlot) => `${m.id}|${m.rarity}|${m.level}|${JSON.stringify(m.secondaryStats)}`;

/**
 * Enumerates every pets+mount combination over the saved builds and scores each one.
 *
 * The sweep is time-sliced across animation frames so the page stays interactive:
 * a full roster is tens of thousands of StatEngine runs. Results are cached, so
 * switching the ranking metric only re-sorts, it never re-sweeps.
 */
export function useLoadoutSweep(options: SweepOptions = {}) {
    const { base, respectSavedLevels = true } = options;
    const { profile: activeProfile } = useProfile();
    const { treeMode } = useTreeMode();
    // Power follows the In-game/Substats toggle like the profile card; it is the only output
    // the flag changes, so DPS/HPS/lifesteal are identical either way.
    const { excludeSubstats } = useComparison();
    const { libs } = useStatLibraries();
    const enabled = base !== null;
    const source = base ?? activeProfile;
    // Same tree-mode transform and libraries as the profile stats (useGlobalStats), so a
    // sweep row equals the profile panel under every My/Max/Empty tree setting.
    const profile = useMemo(() => applyTreeMode(source, treeMode, libs), [source, treeMode, libs]);

    const profileRef = useRef(profile);
    profileRef.current = profile;
    const { petLibrary, mountUpgradeLibrary, itemBalancingConfig, itemBalancingLibrary } = libs;

    const isReady = !!petLibrary && !!mountUpgradeLibrary && !!itemBalancingConfig && !!itemBalancingLibrary;

    // --- Candidate pool -----------------------------------------------------
    // Keyed on content rather than array identity: equipping a loadout picked
    // from this very pool must not invalidate it and trigger a fresh sweep.
    const poolKey = useMemo(() => {
        const pets = profile.pets.savedBuilds?.length ? profile.pets.savedBuilds : profile.pets.active;
        const mounts = [profile.mount.active, ...(profile.mount.savedBuilds || [])].filter(Boolean) as MountSlot[];
        return JSON.stringify([pets, [...mounts.map(mountKey)].sort()]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile.pets.savedBuilds, profile.pets.active, profile.mount.active, profile.mount.savedBuilds]);

    const combos = useMemo((): LoadoutCombo[] => {
        const p = profileRef.current;

        // Every combination of up to MAX_ACTIVE_PETS from the saved roster.
        const savedPets = p.pets.savedBuilds || [];
        const petSets: PetSlot[][] = [];
        const n = savedPets.length;
        const slotsToFill = Math.min(n, MAX_ACTIVE_PETS);

        for (let i = 0; i < n; i++) {
            const set1 = [savedPets[i]];
            if (slotsToFill === 1) {
                petSets.push(set1);
                continue;
            }
            for (let j = i + 1; j < n; j++) {
                const set2 = [...set1, savedPets[j]];
                if (slotsToFill === 2) {
                    petSets.push(set2);
                    continue;
                }
                for (let k = j + 1; k < n; k++) {
                    petSets.push([...set2, savedPets[k]]);
                }
            }
        }
        // No saved pets: keep the current active pets rather than forcing a change.
        if (petSets.length === 0) petSets.push(p.pets.active);

        // Mount candidates: current active + saved builds, deduped.
        const mountCandidates: (MountSlot | null)[] = [];
        const seen = new Set<string>();
        const addMount = (m: MountSlot | null) => {
            if (!m) return;
            const key = mountKey(m);
            if (seen.has(key)) return;
            seen.add(key);
            mountCandidates.push(m);
        };
        addMount(p.mount.active);
        (p.mount.savedBuilds || []).forEach(addMount);
        if (mountCandidates.length === 0) mountCandidates.push(p.mount.active);

        const out: LoadoutCombo[] = [];
        for (const petSet of petSets) {
            for (const mount of mountCandidates) {
                out.push({ petSet, mount });
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poolKey]);

    // Everything that feeds the engine *except* the two slots the sweep overrides.
    // Equipping a result changes only those, so it must not restart the sweep.
    const engineKey = useMemo(() => {
        const { pets, mount, ...rest } = profile;
        return JSON.stringify({ ...rest, savedPets: pets.savedBuilds, savedMounts: mount.savedBuilds });
    }, [profile]);

    const buildTempProfile = useCallback((combo: LoadoutCombo): UserProfile => {
        const p = profileRef.current;
        // Off mode: score every candidate at level 1 so only secondary stats decide.
        const petSet = respectSavedLevels
            ? combo.petSet
            : combo.petSet.map(pet => ({ ...pet, level: 1 }));
        const mount = (respectSavedLevels || !combo.mount)
            ? combo.mount
            : { ...combo.mount, level: 1 };
        return {
            ...p,
            pets: { ...p.pets, active: petSet },
            mount: { ...p.mount, active: mount }
        };
    }, [respectSavedLevels]);

    // --- Time-sliced sweep --------------------------------------------------
    const [status, setStatus] = useState<SweepStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState<SweepResult[]>([]);

    useEffect(() => {
        if (!enabled) {
            setStatus('idle');
            setProgress(0);
            setResults([]);
            return;
        }
        if (!isReady || combos.length === 0) return;

        let cancelled = false;
        let frame = 0;
        let i = 0;
        const acc: SweepResult[] = [];

        setStatus('running');
        setProgress(0);
        setResults([]);

        const step = () => {
            if (cancelled) return;

            const end = Math.min(i + BATCH_SIZE, combos.length);
            for (; i < end; i++) {
                const combo = combos[i];
                const stats = new StatEngine(buildTempProfile(combo), libs, excludeSubstats).calculate();
                acc.push({
                    ...combo,
                    // Real-time throughout: the stepped breakpoint model, matching
                    // the Real-Time Metrics card. Lifesteal/sec and HPS below
                    // are real-time too, so all three headline metrics agree.
                    dps: stats.realTotalDps,
                    power: stats.power,
                    lifestealPerSec: stats.realWeaponDps * stats.lifeSteal,
                    healPerSec: stats.realTotalHps
                });
            }

            if (i >= combos.length) {
                setResults(acc);
                setProgress(100);
                setStatus('done');
                return;
            }

            setProgress(Math.round((i / combos.length) * 100));
            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
        };
    }, [combos, libs, isReady, engineKey, buildTempProfile, enabled, excludeSubstats]);

    // --- Scoring ------------------------------------------------------------
    // Each metric is normalised by its own max across the sweep so that combining
    // DPS and HPS isn't dominated by whichever has the bigger raw scale.
    const maxima = useMemo(() => {
        let dps = 0, power = 0, lifesteal = 0, heal = 0;
        for (const r of results) {
            if (r.dps > dps) dps = r.dps;
            if (r.power > power) power = r.power;
            if (r.lifestealPerSec > lifesteal) lifesteal = r.lifestealPerSec;
            if (r.healPerSec > heal) heal = r.healPerSec;
        }
        return { dps, power, lifesteal, heal };
    }, [results]);

    /** 0..1 score for a result under the given metric (relative to the sweep's best). */
    const scoreOf = useCallback((r: SweepResult, metric: SweepMetric): number => {
        const dpsScore = maxima.dps > 0 ? r.dps / maxima.dps : 0;
        const lsScore = maxima.lifesteal > 0 ? r.lifestealPerSec / maxima.lifesteal : 0;
        const healScore = maxima.heal > 0 ? r.healPerSec / maxima.heal : 0;

        switch (metric) {
            case 'dps': return dpsScore;
            case 'power': return maxima.power > 0 ? r.power / maxima.power : 0;
            case 'lifesteal': return lsScore;
            case 'heal': return healScore;
            // A heuristic, not a game number: the geometric mean of DPS and HPS, each
            // normalised by its best in the sweep. The product rewards being strong on BOTH
            // axes and collapses if either is weak. sqrt(dps/max * heal/max) ranks
            // identically to the raw product dps*heal (the constants and sqrt are monotonic)
            // and stays in 0..1 so a "% of best" can be shown. Matches the Substats
            // Calculator's dps*hps objective.
            case 'balanced': return Math.sqrt(dpsScore * healScore);
        }
    }, [maxima]);

    /** Results sorted best-first for the given metric, each with its score. */
    const rank = useCallback((metric: SweepMetric): { result: SweepResult; score: number }[] => {
        return results
            .map(result => ({ result, score: scoreOf(result, metric) }))
            .sort((a, b) => b.score - a.score);
    }, [results, scoreOf]);

    return {
        status,
        progress,
        results,
        evaluatedCount: results.length,
        totalCombos: combos.length,
        rank,
        scoreOf,
        isReady
    };
}
