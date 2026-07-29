import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import { StatEngine, LibraryData, AggregatedStats, calculateStats } from '../utils/statEngine';
import { PetSlot, MountSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS } from '../utils/constants';

/** How many combinations to evaluate per animation frame. */
const BATCH_SIZE = 200;

export type SweepMetric = 'lifesteal' | 'dps' | 'heal' | 'balanced';

export interface LoadoutCombo {
    petSet: PetSlot[];
    mount: MountSlot | null;
}

/** One scored combination. Only the three ranking metrics — cheap enough for the whole sweep. */
export interface SweepResult extends LoadoutCombo {
    dps: number;
    lifestealPerSec: number;
    healPerSec: number;
}

/**
 * A combination with its full display stats. Needs a second engine run
 * (substats excluded) so this is computed on demand, never for the whole sweep.
 */
export interface ExpandedLoadout extends SweepResult {
    /** Substats ON — "Old Stats" in the header toggle. */
    calcStats: AggregatedStats;
    /** Substats OFF — "New Stats" in the header toggle. */
    shownStats: AggregatedStats;
    shownDmg: number;
    calcDmg: number;
    shownHp: number;
    calcHp: number;
}

export type SweepStatus = 'idle' | 'running' | 'done';

const mountKey = (m: MountSlot) => `${m.id}|${m.rarity}|${m.level}|${JSON.stringify(m.secondaryStats)}`;

/**
 * Enumerates every pets+mount combination over the saved builds and scores each one.
 *
 * The sweep is time-sliced across animation frames so the page stays interactive:
 * a full roster is tens of thousands of StatEngine runs. Results are cached, so
 * switching the ranking metric only re-sorts — it never re-sweeps.
 */
/**
 * @param respectSavedLevels When true (default) each saved build is scored at its own
 * stored level. When false, every candidate is scored at level 1 so only secondary
 * stats decide — equipping still uses the saved level.
 */
export function useLoadoutSweep(respectSavedLevels: boolean = true) {
    const { profile } = useProfile();

    const profileRef = useRef(profile);
    profileRef.current = profile;

    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    // Memoized so the sweep effect isn't restarted on every render.
    const libs: LibraryData = useMemo(() => ({
        petLibrary,
        petUpgradeLibrary,
        petBalancingLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        guildTechTreePositionLibrary: guildPositionLibrary || undefined,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary || undefined,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary,
        secondaryStatLibrary,
        skinsLibrary,
        setsLibrary,
        ascensionConfigsLibrary
    }), [
        petLibrary, petUpgradeLibrary, petBalancingLibrary,
        skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        guildPositionLibrary, guildUpgradeLibrary,
        itemBalancingLibrary, itemBalancingConfig,
        weaponLibrary, projectilesLibrary, secondaryStatLibrary,
        skinsLibrary, setsLibrary, ascensionConfigsLibrary
    ]);

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
                const stats = new StatEngine(buildTempProfile(combo), libs).calculate();
                acc.push({
                    ...combo,
                    // Real-time throughout: the stepped breakpoint model, matching
                    // the Real-Time Metrics card. Lifesteal/sec and HPS below
                    // are real-time too, so all three headline metrics agree.
                    dps: stats.realTotalDps,
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
    }, [combos, libs, isReady, engineKey, buildTempProfile]);

    // --- Scoring ------------------------------------------------------------
    // Each metric is normalised by its own max across the sweep so that combining
    // DPS and HPS isn't dominated by whichever has the bigger raw scale.
    const maxima = useMemo(() => {
        let dps = 0, lifesteal = 0, heal = 0;
        for (const r of results) {
            if (r.dps > dps) dps = r.dps;
            if (r.lifestealPerSec > lifesteal) lifesteal = r.lifestealPerSec;
            if (r.healPerSec > heal) heal = r.healPerSec;
        }
        return { dps, lifesteal, heal };
    }, [results]);

    /** 0..1 score for a result under the given metric (relative to the sweep's best). */
    const scoreOf = useCallback((r: SweepResult, metric: SweepMetric): number => {
        const dpsScore = maxima.dps > 0 ? r.dps / maxima.dps : 0;
        const lsScore = maxima.lifesteal > 0 ? r.lifestealPerSec / maxima.lifesteal : 0;
        const healScore = maxima.heal > 0 ? r.healPerSec / maxima.heal : 0;

        switch (metric) {
            case 'dps': return dpsScore;
            case 'lifesteal': return lsScore;
            case 'heal': return healScore;
            // Geometric mean of DPS and HPS, not a 0.5/0.5 average: the product rewards
            // being strong on BOTH axes and collapses if either is weak, which is what a
            // balanced build is. sqrt(dps/max · heal/max) ranks identically to the raw
            // product dps·heal (the extra constants and sqrt are monotonic), and stays in
            // 0..1 only so the "% of best" column can render it. Matches the Substats
            // Calculator's dps·hps and useProfileOptimizer's balanced metric.
            case 'balanced': return Math.sqrt(dpsScore * healScore);
        }
    }, [maxima]);

    /** Results sorted best-first for the given metric, each with its score. */
    const rank = useCallback((metric: SweepMetric): { result: SweepResult; score: number }[] => {
        return results
            .map(result => ({ result, score: scoreOf(result, metric) }))
            .sort((a, b) => b.score - a.score);
    }, [results, scoreOf]);

    /**
     * Adds the Shown/Calculated damage & HP columns to a combination.
     * Costs two more engine runs, so only call it for rows actually rendered.
     */
    const expand = useCallback((combo: LoadoutCombo & Partial<SweepResult>): ExpandedLoadout | null => {
        if (!isReady) return null;

        const tempProfile = buildTempProfile(combo);
        const calcStats: AggregatedStats = calculateStats(tempProfile, libs, false);
        const shownStats: AggregatedStats = calculateStats(tempProfile, libs, true);

        return {
            petSet: combo.petSet,
            mount: combo.mount,
            dps: combo.dps ?? calcStats.realTotalDps,
            lifestealPerSec: combo.lifestealPerSec ?? calcStats.realWeaponDps * calcStats.lifeSteal,
            healPerSec: combo.healPerSec ?? calcStats.realTotalHps,
            calcStats,
            shownStats,
            shownDmg: shownStats.totalDamage,
            calcDmg: calcStats.totalDamage,
            shownHp: shownStats.totalHealth,
            calcHp: calcStats.totalHealth
        };
    }, [isReady, libs, buildTempProfile]);

    return {
        status,
        progress,
        results,
        evaluatedCount: results.length,
        totalCombos: combos.length,
        rank,
        scoreOf,
        expand,
        isReady
    };
}
