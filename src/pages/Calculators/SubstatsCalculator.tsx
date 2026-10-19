import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { useProfile } from '../../context/ProfileContext';
import { useComparison, FairySelection } from '../../context/ComparisonContext';
import { useGameData } from '../../hooks/useGameData';
import { StatsSummaryPanel } from '../../components/Profile/StatsSummaryPanel';
import { RefreshCw, Sliders, Hash, Zap, TrendingUp, Wand2, Swords, Crosshair, User, Trophy, Heart, Square, Check } from 'lucide-react';
import { getStatName } from '../../utils/statNames';
import { cn } from '../../lib/utils';
import { UserProfile } from '../../types/Profile';
import { FAIRIES, SEASON_STATS, fairyRawBonus } from '../../utils/fairies';
import { applyTreeMode, useStatLibraries } from '../../hooks/useGlobalStats';
import { useTreeMode } from '../../context/TreeModeContext';
import { useSubstatOptimizer } from '../../hooks/useBuildOptimizer';
import { pvpConfigFromJson } from '../../pvp/simulate';
import { formatCompactNumber } from '../../utils/statsCalculator';
import {
    allocKey, distribute,
    type SubstatBody, type SubstatCandidate, type SubstatObjective, type SubstatOptimizerInput,
} from '../../optimizer/substatOptimizer';

/**
 * Substats Calculator: finds the best gear substat combination for the profile.
 *
 * The allocatable list is ONLY what can actually roll on gear: SecondaryStatLibrary rows
 * with UpperRange > 0. The library also carries tree-only stats (MoveSpeed, AttackRange,
 * ReflectChance ship with a 0..0 range and exist for tech/clan nodes and the fairy), and
 * those must never consume substat slots.
 *
 * The slot budget comes from the game's unlock rules, not from a guess:
 *   items  -> SecondaryStatItemUnlockLibrary by item age (0-2: none, 3-6: one, 7-9: two)
 *   pets   -> SecondaryStatPetUnlockLibrary by rarity (Legendary+: two)
 *   mount  -> same rarity rule (mounts share the Rarity enum; no separate library ships)
 * A body can hold each substat once, so a stat's cap is the number of bodies with a slot.
 *
 * The optimizer (src/optimizer/substatOptimizer.ts, in a worker) also DECIDES the fairy: no
 * fairy plus each of the season's three at max level. Objectives are numbers the game runs on:
 * real-time DPS and HPS (the stat engine, within 1% of the combat engine), Damage, Health, and
 * "Best build (simulated)", which fights a shortlist of allocations against a reference in
 * simulated arena battles. Power is not an objective: in game it is computed with every
 * substat removed (CalculatePower 0x785E258 -> Stats.WithoutSecondaryStats 0x785E500).
 * The melee/ranged weapon choice stays a manual scenario input.
 */

const ITEM_SLOTS: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

/** Engine pool name -> SecondaryStatLibrary id, for the fairy preview line. */
const POOL_TO_SUBSTAT: Record<string, string> = {
    skillDamageMulti: 'SkillDamageMulti',
    skillCooldownMulti: 'SkillCooldownMulti',
    healthMulti: 'HealthMulti',
    criticalChance: 'CriticalChance',
    blockChance: 'BlockChance',
};

type Body = SubstatBody;

/** Battles per side for "Best build (simulated)": each candidate fights twice this many. */
const BATTLES_PER_SIDE = 100;

const candidateKey = (c: SubstatCandidate) => `${c.isCurrent ? 'current' : c.fairy}|${allocKey(c.alloc)}`;

const OBJECTIVES: { id: Exclude<SubstatObjective, 'simulated'>; label: string; icon: JSX.Element; tone: string }[] = [
    { id: 'dps', label: 'DPS', icon: <Zap className="w-4 h-4" />, tone: 'border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500/50 hover:text-orange-400' },
    { id: 'hps', label: 'HPS', icon: <TrendingUp className="w-4 h-4" />, tone: 'border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50 hover:text-emerald-400' },
    { id: 'damage', label: 'Damage', icon: <Swords className="w-4 h-4" />, tone: 'border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400' },
    { id: 'health', label: 'Health', icon: <Heart className="w-4 h-4" />, tone: 'border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50 hover:text-green-400' },
];
const OBJECTIVE_LABEL: Record<SubstatObjective, string> = {
    dps: 'DPS', hps: 'HPS', damage: 'Damage', health: 'Health', simulated: 'Best build (simulated)',
};

export default function SubstatsCalculator() {
    const { profile } = useProfile();
    const {
        isComparing,
        enterCompareMode,
        exitCompareMode,
        updateTestItem,
        updateTestPet,
        updateTestMount,
        updateTestFairy,
    } = useComparison();

    // Same libraries and tree mode as the header and the comparison strip (useGlobalStats).
    const { libs: statLibs, ready: statsReady } = useStatLibraries();
    const { treeMode } = useTreeMode();
    const { profiles, activeProfileId } = useProfile();
    const secondaryStatLibrary = (statLibs as any).secondaryStatLibrary;
    const weaponLibrary = (statLibs as any).weaponLibrary;
    const { data: itemUnlockLibrary } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: petUnlockLibrary } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: fairyUpgrades } = useGameData<any>('FairyUpgradesLibrary.json');
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const pvpConfig = useMemo(() => pvpConfigFromJson(pvpBaseConfig), [pvpBaseConfig]);

    const [slotMode, setSlotMode] = useState<'profile' | 'max'>('profile');
    const [weaponType, setWeaponType] = useState<'profile' | 'melee' | 'ranged'>('profile');
    // Output of the optimizer, not an input: which fairy (at max level) won the search.
    // `level: null` = the top level of FairyUpgradesLibrary, resolved below once it loads.
    const [bestFairyPick, setBestFairy] = useState<{ name: FairySelection['name']; level: number | null }>(
        () => ({ name: profile.misc.fairy?.name ?? null, level: null })
    );
    const [statAllocations, setStatAllocations] = useState<Record<string, number>>({});
    const [includeSkills, setIncludeSkills] = useState(true);
    const [perfectionPercentage, setPerfectionPercentage] = useState(100);
    const [referenceId, setReferenceId] = useState<string>('mirror');

    useEffect(() => {
        enterCompareMode();
        return () => {
            exitCompareMode();
        };
    }, [enterCompareMode, exitCompareMode]);

    const maxFairyLevel = useMemo(
        // Top level of FairyUpgradesLibrary; 0 until it loads (canOptimize waits for it).
        () => (fairyUpgrades ? Math.max(...Object.keys(fairyUpgrades).map(Number)) : 0),
        [fairyUpgrades]
    );
    const bestFairy: FairySelection = useMemo(
        () => ({ name: bestFairyPick.name, level: bestFairyPick.level ?? maxFairyLevel }),
        [bestFairyPick, maxFairyLevel]
    );

    // Only what can actually roll on gear: tree-only stats ship with a 0..0 range.
    const rollableStats = useMemo(
        () => (secondaryStatLibrary
            ? Object.keys(secondaryStatLibrary).filter((k) => (secondaryStatLibrary[k]?.UpperRange || 0) > 0).sort()
            : []),
        [secondaryStatLibrary]
    );

    const itemSlotCount = useCallback((age: number | undefined): number => {
        if (age === undefined || !itemUnlockLibrary) return 0;
        let best = 0;
        for (const row of Object.values<any>(itemUnlockLibrary)) {
            if (row.ItemAge <= age) best = Math.max(best, 0) === 0 ? row.NumberOfSecondStats : Math.max(best, row.NumberOfSecondStats);
        }
        return best;
    }, [itemUnlockLibrary]);

    const rarSlotCount = useCallback((rarity: string | undefined): number => {
        // SecondaryStatPetUnlockLibrary; no slots until it loads (same as itemSlotCount).
        if (!rarity || !petUnlockLibrary) return 0;
        return petUnlockLibrary[rarity]?.NumberOfSecondStats ?? 0;
    }, [petUnlockLibrary]);

    const maxItemSlots = useMemo(() => {
        if (!itemUnlockLibrary) return 0;
        return Math.max(...Object.values<any>(itemUnlockLibrary).map((r) => r.NumberOfSecondStats));
    }, [itemUnlockLibrary]);
    const maxRaritySlots = useMemo(() => {
        if (!petUnlockLibrary) return 0;
        return Math.max(...Object.values<any>(petUnlockLibrary).map((r) => r.NumberOfSecondStats));
    }, [petUnlockLibrary]);

    /** The bodies that can carry substats, with their slot counts for the selected mode. */
    const bodies: Body[] = useMemo(() => {
        const out: Body[] = [];
        for (const slot of ITEM_SLOTS) {
            const item = profile.items[slot];
            if (!item) continue;
            out.push({ key: `item:${slot}`, label: slot, slots: slotMode === 'max' ? maxItemSlots : itemSlotCount(item.age) });
        }
        profile.pets.active.forEach((pet, i) => {
            if (!pet) return;
            out.push({ key: `pet:${i}`, label: `Pet ${i + 1}`, slots: slotMode === 'max' ? maxRaritySlots : rarSlotCount(pet.rarity) });
        });
        if (profile.mount.active) {
            out.push({ key: 'mount', label: 'Mount', slots: slotMode === 'max' ? maxRaritySlots : rarSlotCount(profile.mount.active.rarity) });
        }
        return out;
    }, [profile, slotMode, itemSlotCount, rarSlotCount, maxItemSlots, maxRaritySlots]);

    const totalAvailablePool = bodies.reduce((s, b) => s + b.slots, 0);
    // One instance per body, so a single stat can appear at most once per body with a slot.
    const perStatCap = bodies.filter((b) => b.slots > 0).length;
    const currentAllocated = Object.values(statAllocations).reduce((sum, val) => sum + val, 0);
    const remainingPool = totalAvailablePool - currentAllocated;

    /** Same-age weapon of the requested kind, when the profile's weapon is not already it. */
    const weaponOverride = useMemo(() => {
        if (weaponType === 'profile' || !weaponLibrary || !profile.items.Weapon) return null;
        const age = profile.items.Weapon.age;
        const wantRanged = weaponType === 'ranged';
        const isRanged = (w: any) => w?.IsRanged ?? ((w?.AttackRange ?? 0) > 1.0);
        const cur = weaponLibrary[`{'Age': ${age}, 'Type': 'Weapon', 'Idx': ${profile.items.Weapon.idx}}`];
        if (cur && isRanged(cur) === wantRanged) return null;
        for (let idx = 0; idx < 64; idx++) {
            const w = weaponLibrary[`{'Age': ${age}, 'Type': 'Weapon', 'Idx': ${idx}}`];
            if (w && isRanged(w) === wantRanged) return { idx };
        }
        return null;
    }, [weaponType, weaponLibrary, profile.items.Weapon]);

    const weaponSwapUnavailable = weaponType !== 'profile' && !!profile.items.Weapon && weaponOverride === null
        && (() => {
            const cur = weaponLibrary?.[`{'Age': ${profile.items.Weapon.age}, 'Type': 'Weapon', 'Idx': ${profile.items.Weapon.idx}}`];
            const isRanged = cur?.IsRanged ?? ((cur?.AttackRange ?? 0) > 1.0);
            return isRanged !== (weaponType === 'ranged');
        })();

    /** Applies the weapon scenario onto a cloned profile. */
    const applyWeapon = useCallback((p: any) => {
        if (weaponOverride && p.items.Weapon) {
            p.items.Weapon.idx = weaponOverride.idx;
            // The skin would keep overriding the weapon's data, defeating the swap.
            delete p.items.Weapon.skin;
        }
    }, [weaponOverride]);

    const handleResetToProfile = useCallback(() => {
        const initialAllocations: Record<string, number> = {};
        const addAlloc = (statId: string) => {
            initialAllocations[statId] = (initialAllocations[statId] || 0) + 1;
        };
        ITEM_SLOTS.forEach((slot) => {
            profile.items[slot]?.secondaryStats?.forEach((s) => addAlloc(s.statId));
        });
        profile.pets.active.forEach((pet) => pet?.secondaryStats?.forEach((s) => addAlloc(s.statId)));
        profile.mount.active?.secondaryStats?.forEach((s) => addAlloc(s.statId));

        const clamped: Record<string, number> = {};
        Object.keys(initialAllocations).forEach((key) => {
            clamped[key] = Math.min(initialAllocations[key], perStatCap);
        });
        setStatAllocations(clamped);
    }, [profile, perStatCap]);

    useEffect(() => {
        if (!secondaryStatLibrary) return;
        handleResetToProfile();
    }, [secondaryStatLibrary, profile, handleResetToProfile]);

    // Keep the comparison's test side on the fairy the optimizer chose.
    useEffect(() => {
        if (isComparing) updateTestFairy({ ...bestFairy });
    }, [isComparing, bestFairy, updateTestFairy]);

    // ------------------------------------------------------------------ optimizer (worker)
    const runOpt = useSubstatOptimizer();
    const [lastObjective, setLastObjective] = useState<SubstatObjective | null>(null);
    const [lastRunWithSkills, setLastRunWithSkills] = useState(true);
    const [appliedKey, setAppliedKey] = useState<string | null>(null);
    const otherProfiles = profiles.filter((p) => p.id !== activeProfileId);
    const canOptimize = statsReady && !!pvpConfig && !!fairyUpgrades && rollableStats.length > 0 && totalAvailablePool > 0;

    /** The scenario build: header tree mode + the weapon type. The current build has no weapon swap. */
    const scenarioProfiles = useCallback(() => {
        const current = applyTreeMode(profile, treeMode, statLibs);
        const base = JSON.parse(JSON.stringify(current));
        applyWeapon(base);
        return { current, base };
    }, [profile, treeMode, statLibs, applyWeapon]);

    const optimize = useCallback((objective: SubstatObjective) => {
        if (!canOptimize || !pvpConfig) return;
        const { current, base } = scenarioProfiles();
        const ref = referenceId === 'mirror' ? null : profiles.find((p) => p.id === referenceId) ?? null;
        const input: SubstatOptimizerInput = {
            base,
            current,
            reference: ref ?? current,
            referenceName: ref ? (ref.name || 'Saved profile') : 'Mirror of your build',
            objective,
            withSkills: includeSkills,
            stats: rollableStats.map((id) => ({ id, upper: secondaryStatLibrary[id]?.UpperRange || 0 })),
            bodies,
            perfection: perfectionPercentage,
            fairies: [null, ...FAIRIES.map((f) => f.name)],
            fairyLevel: maxFairyLevel,
            extra: currentAllocated > 0 ? { alloc: { ...statAllocations }, fairy: bestFairy.name } : null,
            pvpConfig,
            battlesPerSide: BATTLES_PER_SIDE,
            keep: 12,
        };
        setLastObjective(objective);
        setLastRunWithSkills(includeSkills);
        setAppliedKey(null);
        runOpt.run(input, statLibs);
    }, [canOptimize, pvpConfig, scenarioProfiles, referenceId, profiles, includeSkills, rollableStats, secondaryStatLibrary, bodies,
        perfectionPercentage, maxFairyLevel, currentAllocated, statAllocations, bestFairy.name, runOpt, statLibs]);

    const applyCandidate = useCallback((c: SubstatCandidate) => {
        if (c.isCurrent) {
            handleResetToProfile();
            setBestFairy({ name: profile.misc.fairy?.name ?? null, level: profile.misc.fairy?.level ?? maxFairyLevel });
        } else {
            setStatAllocations({ ...c.alloc });
            setBestFairy({ name: c.fairy, level: maxFairyLevel });
        }
        setAppliedKey(candidateKey(c));
    }, [handleResetToProfile, profile.misc.fairy, maxFairyLevel]);

    // A single-objective run applies its answer straight away, like before.
    const result = runOpt.result;
    useEffect(() => {
        if (runOpt.status !== 'done' || !result || result.objective === 'simulated') return;
        applyCandidate(result.best);
        // Only when a new result lands (applyCandidate is stable enough not to re-fire it).
    }, [result]); // eslint-disable-line

    /** The per-body layout of the current allocation: what to roll where. */
    const layout = useMemo(() => distribute(statAllocations, bodies), [statAllocations, bodies]);

    // Push the distributed test build into the comparison whenever anything moves.
    useEffect(() => {
        if (!isComparing || !secondaryStatLibrary) return;

        const rollValue = (statId: string) => (secondaryStatLibrary[statId]?.UpperRange || 0) * perfectionPercentage;
        const statsFor = (key: string) => (layout.get(key) ?? []).map((statId) => ({ statId, value: rollValue(statId) }));

        ITEM_SLOTS.forEach((slot) => {
            if (!profile.items[slot]) return;
            const testItem = JSON.parse(JSON.stringify(profile.items[slot]));
            testItem.secondaryStats = statsFor(`item:${slot}`);
            if (slot === 'Weapon' && weaponOverride) {
                testItem.idx = weaponOverride.idx;
                delete testItem.skin;
            }
            updateTestItem(slot, testItem);
        });

        const testPets = JSON.parse(JSON.stringify(profile.pets.active));
        testPets.forEach((pet: any, i: number) => { if (pet) pet.secondaryStats = statsFor(`pet:${i}`); });
        updateTestPet(testPets);

        if (profile.mount.active) {
            const testMount = JSON.parse(JSON.stringify(profile.mount.active));
            testMount.secondaryStats = statsFor('mount');
            updateTestMount(testMount);
        }
    }, [layout, isComparing, secondaryStatLibrary, profile, perfectionPercentage, weaponOverride, updateTestItem, updateTestPet, updateTestMount]);

    const handleSliderChange = (statId: string, newValue: number) => {
        setStatAllocations(prev => {
            const currentValue = prev[statId] || 0;
            const diff = newValue - currentValue;
            if (diff <= 0 || diff <= remainingPool) {
                return { ...prev, [statId]: newValue };
            }
            if (remainingPool > 0) {
                return { ...prev, [statId]: currentValue + remainingPool };
            }
            return prev;
        });
    };

    // Fairy preview for the allocated pools (steps + cap, same math as the engine).
    const fairyPreview = useMemo(() => {
        if (!bestFairy.name || !secondaryStatLibrary) return null;
        const cfg = SEASON_STATS[bestFairy.name];
        const poolOf = (engineKey: string) => {
            const id = POOL_TO_SUBSTAT[engineKey];
            if (!id) return 0;
            return (statAllocations[id] || 0) * (secondaryStatLibrary[id]?.UpperRange || 0) * (perfectionPercentage / 100);
        };
        const required = poolOf(cfg.requiredStat);
        const targetBefore = poolOf(cfg.targetStat);
        const raw = fairyRawBonus(cfg, bestFairy.level, required);
        const granted = raw > 0 ? Math.max(0, Math.min(targetBefore + raw, cfg.targetStatTotalCap) - targetBefore) : 0;
        return { cfg, required, granted };
    }, [bestFairy, statAllocations, secondaryStatLibrary, perfectionPercentage]);

    const running = runOpt.status === 'running';
    const ranked = result?.objective === 'simulated' ? result.ranked : [];
    const includeSkillsOfResult = lastRunWithSkills;
    const topTied = ranked.length > 1 && ranked[0].winRate >= 0.99 && ranked[1].winRate >= 0.99;
    const pct = running && runOpt.total > 0
        ? (lastObjective === 'simulated' ? (runOpt.stage === 1 ? 0 : 60) + (runOpt.done / runOpt.total) * (runOpt.stage === 1 ? 60 : 40) : (runOpt.done / runOpt.total) * 100)
        : runOpt.status === 'done' ? 100 : 0;
    const statusText = (() => {
        if (!canOptimize) return totalAvailablePool === 0 ? 'No substat slots on this build' : 'Loading game data';
        if (running) {
            if (runOpt.stage === 2) return `Stage 2: arena battles (${runOpt.done} / ${runOpt.total} builds)`;
            return lastObjective === 'simulated'
                ? `Stage 1: searching allocations${runOpt.total ? ` (${runOpt.done} / ${runOpt.total})` : ''}`
                : `Searching the best ${OBJECTIVE_LABEL[lastObjective ?? 'dps']} allocation`;
        }
        if (runOpt.status === 'cancelled') return 'Cancelled';
        if (runOpt.status === 'error') return `Failed: ${runOpt.error}`;
        if (runOpt.status === 'done' && result && runOpt.wallMs !== null) {
            const secs = `${(runOpt.wallMs / 1000).toFixed(1)} s`;
            if (result.objective === 'simulated') {
                return `${result.scored.toLocaleString()} allocations scored, ${result.battles.toLocaleString()} battles vs ${result.referenceName}, ${secs}`;
            }
            const b = result.best;
            const value = { dps: b.dps, hps: b.hps, damage: b.damage, health: b.health }[result.objective as Exclude<SubstatObjective, 'simulated'>];
            return `Best ${OBJECTIVE_LABEL[result.objective]}: ${formatCompactNumber(value)} (${b.fairy ?? 'no fairy'}), applied. ${result.scored.toLocaleString()} allocations scored, ${secs}`;
        }
        return 'Ready';
    })();

    if (!secondaryStatLibrary || !itemUnlockLibrary || !petUnlockLibrary) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-accent-primary opacity-20" />
                <p className="text-text-muted">Loading</p>
            </div>
        );
    }

    const pctLabel = (v: number) => `${Math.round(v * 1000) / 10}%`;

    return (
        <div className="max-w-[100rem] mx-auto space-y-6 animate-fade-in pb-12 px-4 xl:px-8">
            <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent flex items-center gap-3">
                        <Sliders className="w-8 h-8 text-accent-primary" />
                        Substats Calculator
                    </h1>
                    <p className="text-text-secondary max-w-2xl mt-2 font-medium">
                        Find the best substat combination for your build. Slots follow the game's unlock
                        rules for your gear, tree-only stats never take a slot, and the fairy conversion
                        and weapon type shift the optimum exactly like in game.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStatAllocations({})}>
                        Clear All
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleResetToProfile}>
                        Reset to Profile
                    </Button>
                </div>
            </div>

            {/* Comparison Strip */}
            <div className="sticky top-0 z-40 py-2 -mx-4 px-4 bg-bg-primary/80 backdrop-blur-md border-b border-border shadow-lg">
                <StatsSummaryPanel variant="horizontal-strip" hideActions={true} defaultTab="metrics" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Scenario, Optimizer, Slots */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Scenario */}
                    <Card className="p-4 border-accent-primary/20 bg-accent-primary/5">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <User className="w-5 h-5 text-accent-primary" /> Scenario
                        </h3>

                        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">Weapon</div>
                        <div className="flex bg-bg-secondary border border-border/50 rounded-lg p-1 mb-1">
                            {([
                                { id: 'profile', label: 'Profile', icon: <User className="w-3.5 h-3.5" /> },
                                { id: 'melee', label: 'Melee', icon: <Swords className="w-3.5 h-3.5" /> },
                                { id: 'ranged', label: 'Ranged', icon: <Crosshair className="w-3.5 h-3.5" /> },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.id}
                                    onClick={() => setWeaponType(opt.id)}
                                    className={cn(
                                        "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all flex items-center justify-center gap-1",
                                        weaponType === opt.id ? "bg-accent-primary text-white shadow" : "text-text-muted hover:text-text-primary"
                                    )}
                                >
                                    {opt.icon} {opt.label}
                                </button>
                            ))}
                        </div>
                        {weaponSwapUnavailable && (
                            <p className="text-[10px] text-orange-400 mb-2">
                                No {weaponType} weapon exists in your weapon's age; using the profile weapon.
                            </p>
                        )}
                    </Card>

                    {/* Auto-Optimizer */}
                    <Card className="p-4 border-orange-500/30 bg-orange-500/5" data-testid="substats-optimizer">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-orange-400">
                            <Wand2 className="w-5 h-5" /> Auto-Optimizer
                        </h3>

                        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">Skills</div>
                        <div className="flex bg-bg-secondary border border-border/50 rounded-lg p-1 mb-1" role="radiogroup" aria-label="Skills">
                            {([
                                { on: true, label: 'With skills' },
                                { on: false, label: 'Without skills' },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.label}
                                    role="radio"
                                    aria-checked={includeSkills === opt.on}
                                    data-testid={opt.on ? 'substats-with-skills' : 'substats-without-skills'}
                                    disabled={running}
                                    onClick={() => setIncludeSkills(opt.on)}
                                    className={cn(
                                        "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                        includeSkills === opt.on ? "bg-orange-500 text-white shadow" : "text-text-muted hover:text-text-primary"
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-text-muted leading-snug mb-4">
                            {includeSkills
                                ? 'Your equipped skills count in DPS and HPS, and they fight in the simulated battles.'
                                : 'Weapon only. In the simulated battles both you and the opponent fight without skills (skills also raise arena HP, so both sides drop them).'}
                        </p>

                        <div className="bg-bg-input/30 p-3 rounded-lg border border-border/30 mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium">Substats Perfection</span>
                                <span className="text-xs font-bold text-accent-primary">{perfectionPercentage}%</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={perfectionPercentage}
                                disabled={running}
                                onChange={(e) => setPerfectionPercentage(Number(e.target.value))}
                                className="w-full accent-accent-primary"
                            />
                        </div>

                        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">Maximize</div>
                        <div className="grid grid-cols-2 gap-2">
                            {OBJECTIVES.map((o) => (
                                <Button
                                    key={o.id}
                                    variant="outline"
                                    data-testid={`substats-opt-${o.id}`}
                                    aria-label={`Maximize ${o.label}`}
                                    disabled={!canOptimize || running}
                                    className={cn("w-full flex justify-start items-center gap-2 bg-bg-input/50 text-xs px-2", o.tone)}
                                    onClick={() => optimize(o.id)}
                                >
                                    {o.icon} <span>{o.label}</span>
                                </Button>
                            ))}
                        </div>

                        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
                            <Button
                                variant="outline"
                                data-testid="substats-opt-simulated"
                                disabled={!canOptimize || running}
                                className="w-full flex justify-start items-center gap-2 bg-bg-input/50 border-yellow-500/40 hover:bg-yellow-500/10 hover:text-yellow-300"
                                onClick={() => optimize('simulated')}
                            >
                                <Trophy className="w-4 h-4 text-yellow-400" /> Best build (simulated)
                            </Button>
                            <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                                <span>Opponent</span>
                                <select
                                    value={referenceId}
                                    onChange={(e) => setReferenceId(e.target.value)}
                                    disabled={running}
                                    data-testid="substats-opponent"
                                    className="max-w-[65%] min-w-0 px-2 py-0.5 rounded bg-bg-input border border-border text-text-primary"
                                >
                                    <option value="mirror">Mirror of your build</option>
                                    {otherProfiles.map((p) => <option key={p.id} value={p.id}>{p.name || 'Saved profile'}</option>)}
                                </select>
                            </label>
                            <p className="text-[10px] text-text-muted leading-snug">
                                Shortlists the best DPS, HPS, Damage and Health allocations and blends between DPS and HPS, for no
                                fairy and each fairy, then each one fights {BATTLES_PER_SIDE * 2} arena battles (the same {BATTLES_PER_SIDE} seeds
                                as Player 1 and as Player 2). Ranked by win rate, then HP margin.
                            </p>
                        </div>

                        <div className="mt-4 flex items-center gap-2">
                            {running && (
                                <button
                                    onClick={runOpt.cancel}
                                    data-testid="substats-cancel"
                                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/50 text-red-400 text-[11px] font-bold hover:bg-red-500/10 shrink-0"
                                >
                                    <Square className="w-3 h-3" /> Cancel
                                </button>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="h-1.5 rounded-full bg-bg-input overflow-hidden">
                                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="text-[10px] text-text-muted mt-0.5 break-words" data-testid="substats-status">{statusText}</div>
                            </div>
                        </div>

                        <p className="text-[10px] text-text-muted mt-3 leading-snug">
                            Scores are the profile's real-time DPS and HPS, the same numbers as the header (within 1% of the combat
                            engine). Power is not an option: the game computes Power with every substat removed, so no allocation
                            changes it.
                        </p>
                    </Card>

                    {lastObjective === 'simulated' && ranked.length > 0 && (
                        <Card className="p-0 border-yellow-500/30 overflow-hidden" data-testid="substats-ranking">
                            <div className="px-4 py-3 border-b border-border bg-bg-secondary/40">
                                <div className="text-sm font-bold flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-400" /> Best builds vs {result?.referenceName}</div>
                                <div className="text-[10px] text-text-muted">
                                    {includeSkillsOfResult ? 'With skills' : 'Without skills, on both sides'}. Apply a row to load it into the sliders and the Test side.
                                </div>
                            </div>
                            <ol className="divide-y divide-border/60">
                                {ranked.map((c, i) => {
                                    const applied = appliedKey === candidateKey(c);
                                    return (
                                        <li key={candidateKey(c)} className={cn('px-4 py-2.5 space-y-1', applied && 'bg-accent-primary/10')} data-testid="substats-row">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-start gap-2 min-w-0">
                                                    <span className="w-5 shrink-0 text-[11px] font-bold text-text-muted">{i + 1}</span>
                                                    <span className="text-[11px] font-bold text-text-primary break-words">
                                                        {c.tags.join(' | ')}
                                                    </span>
                                                </div>
                                                <span className={cn('shrink-0 text-[12px] font-mono font-bold', i === 0 ? 'text-green-400' : 'text-text-primary')} data-testid="substats-winrate">
                                                    {(c.winRate * 100).toFixed(1)}% <span className="text-[10px] text-text-muted font-normal">± {(c.winRateSe * 100).toFixed(1)}</span>
                                                </span>
                                            </div>
                                            <div className="pl-7 text-[10px] text-text-secondary break-words">
                                                {Object.entries(c.alloc).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
                                                    .map(([id, n]) => `${getStatName(id)} x${n}`).join(', ') || 'No substats'}
                                            </div>
                                            <div className="pl-7 flex items-center justify-between gap-2">
                                                <span className="text-[10px] font-mono text-text-muted min-w-0 break-words">
                                                    {c.fairy ? `${c.fairy}` : 'No fairy'}, {formatCompactNumber(c.dps)} DPS, {formatCompactNumber(c.hps)} HPS,
                                                    HP margin {c.hpMargin >= 0 ? '+' : ''}{(c.hpMargin * 100).toFixed(1)}%
                                                </span>
                                                <button
                                                    onClick={() => applyCandidate(c)}
                                                    data-testid="substats-apply"
                                                    className={cn(
                                                        'shrink-0 px-2 py-0.5 rounded text-[10px] font-bold border',
                                                        applied ? 'border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5'
                                                    )}
                                                >
                                                    {applied ? <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Applied</span> : 'Apply'}
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                            {topTied && (
                                <div className="px-4 py-2 border-t border-border text-[10px] text-text-muted leading-snug">
                                    Several builds win almost every battle against this opponent, so HP margin orders them. A stronger
                                    opponent (a saved profile) separates them better.
                                </div>
                            )}
                        </Card>
                    )}

                    {/* Slot budget from the game's unlock rules */}
                    <Card className="p-4 border-accent-primary/20 bg-accent-primary/5">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Hash className="w-5 h-5 text-accent-primary" /> Substat Slots
                        </h3>
                        <div className="flex bg-bg-secondary border border-border/50 rounded-lg p-1 mb-4">
                            <button
                                onClick={() => setSlotMode('profile')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    slotMode === 'profile' ? "bg-accent-primary text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                From Profile
                            </button>
                            <button
                                onClick={() => setSlotMode('max')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    slotMode === 'max' ? "bg-accent-primary text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                Max Unlocks
                            </button>
                        </div>

                        <div className="space-y-1 text-sm">
                            {(['item', 'pet', 'mount'] as const).map((kind) => {
                                const group = bodies.filter((b) => b.key.startsWith(kind));
                                if (!group.length) return null;
                                const label = kind === 'item' ? `Items (${group.length}x)` : kind === 'pet' ? `Pets (${group.length}x)` : 'Mount';
                                return (
                                    <div key={kind} className="flex justify-between items-center bg-bg-input/30 p-2 rounded-lg border border-border/30">
                                        <span className="font-medium">{label}</span>
                                        <span className="font-mono font-bold">{group.reduce((s, b) => s + b.slots, 0)} slots</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-4 pt-4 border-t border-border/30">
                            <div className="text-xs text-text-muted font-bold uppercase tracking-wider">Remaining Pool</div>
                            <div className={cn("text-3xl font-black", remainingPool > 0 ? "text-accent-primary" : "text-text-muted")}>
                                {remainingPool} <span className="text-lg font-medium text-text-muted">/ {totalAvailablePool}</span>
                            </div>
                        </div>
                    </Card>

                    <Card className="p-4 border-border/50">
                        <h3 className="text-sm font-bold text-text-muted uppercase tracking-wider mb-2">Instructions</h3>
                        <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                            <li>Slots follow the game's unlock rules for your equipped gear (age and rarity).</li>
                            <li>A single item, pet or mount cannot roll the same stat twice, so each stat caps at {perStatCap}.</li>
                            <li>Tree-only stats (move speed, attack range, reflect) never take a substat slot.</li>
                            <li>Pick a weapon type in the Scenario; the Auto-Optimizer decides the best fairy on its own, always at max level.</li>
                        </ul>
                    </Card>
                </div>

                {/* Right Column: Allocation + Best Combination */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="p-4 sm:p-6 border-border/50 bg-bg-secondary/20">
                        <h3 className="text-lg font-bold mb-6">Substats Allocation</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                            {rollableStats.map(statId => {
                                const alloc = statAllocations[statId] || 0;
                                const upperRange = secondaryStatLibrary[statId]?.UpperRange || 0;
                                const resultingValue = alloc * upperRange * (perfectionPercentage / 100);

                                return (
                                    <div key={statId} className="bg-bg-input/20 border border-border/20 p-3 rounded-xl hover:border-accent-primary/20 hover:bg-bg-input/40 transition-colors">
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-text-primary">{getStatName(statId)}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-xs font-mono font-bold text-accent-primary">
                                                    {(resultingValue * 100).toFixed(1)}%
                                                </span>
                                                <span className="text-[10px] text-text-muted">
                                                    {alloc} / {perStatCap} rolls
                                                </span>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max={perStatCap}
                                            value={alloc}
                                            onChange={e => handleSliderChange(statId, parseInt(e.target.value))}
                                            className={cn(
                                                "w-full h-2 rounded-lg appearance-none cursor-pointer",
                                                alloc > 0 ? "bg-accent-primary" : "bg-bg-card"
                                            )}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* Where to roll what */}
                    <Card className="p-4 sm:p-6 border-border/50 bg-bg-secondary/20">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold">Best Combination</h3>
                            {fairyPreview && fairyPreview.granted > 0 ? (
                                <span className="text-xs font-mono font-bold text-green-400">
                                    Best fairy: {bestFairy.name} Lv {bestFairy.level}, +{pctLabel(fairyPreview.granted)} {fairyPreview.cfg.targetLabel}
                                </span>
                            ) : (
                                <span className="text-xs font-mono text-text-muted">No fairy improves this build</span>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {bodies.filter((b) => b.slots > 0).map((b) => {
                                const assigned = layout.get(b.key) ?? [];
                                return (
                                    <div key={b.key} className="bg-bg-input/20 border border-border/20 rounded-xl p-3">
                                        <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">{b.label}</span>
                                            <span className="text-[10px] text-text-muted font-mono">{assigned.length}/{b.slots}</span>
                                        </div>
                                        {assigned.length === 0 ? (
                                            <div className="text-[11px] text-text-muted">Empty</div>
                                        ) : (
                                            <div className="space-y-1">
                                                {assigned.map((statId) => (
                                                    <div key={statId} className="flex justify-between text-[11px]">
                                                        <span className="text-text-secondary truncate">{getStatName(statId)}</span>
                                                        <span className="font-mono text-accent-primary shrink-0">
                                                            {((secondaryStatLibrary[statId]?.UpperRange || 0) * perfectionPercentage).toFixed(1)}%
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
