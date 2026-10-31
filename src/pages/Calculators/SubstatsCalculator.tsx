import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { useProfile } from '../../context/ProfileContext';
import { useComparison, FairySelection } from '../../context/ComparisonContext';
import { useGameData } from '../../hooks/useGameData';
import { StatsSummaryPanel } from '../../components/Profile/StatsSummaryPanel';
import { Link } from 'react-router-dom';
import { RefreshCw, Hash, User, Check } from 'lucide-react';
import { getStatName } from '../../utils/statNames';
import { cn } from '../../lib/utils';
import { UserProfile } from '../../types/Profile';
import { FAIRIES, SEASON_STATS, fairyRawBonus, fairyGranted } from '../../utils/fairies';
import { useStatLibraries } from '../../hooks/useGlobalStats';
import { distribute, placedCounts, currentAlloc, type SubstatBody } from '../../optimizer/substatOptimizer';
import type { ProfilePreset, ProfilePresetsFile } from '../../presets/buildPresets';
import { GameAssetIcon } from '../../components/UI/GameAssetIcon';

/**
 * Substats Calculator: tries gear substat combinations on the profile, against the profile.
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
 * Nothing is searched on this page: the best allocations are searched once per game version
 * with the preset builds (scripts/build_presets.ts, src/presets/buildPresets.ts) and loaded from
 * ProfilePresets.json. Loading one sets the sliders (its roll counts laid onto this build's slots),
 * its fairy, its weapon kind and 100% perfection; the sliders, the fairy picker and the comparison
 * strip then work as before. Power never changes with substats: in game it is computed with every
 * substat removed (CalculatePower 0x785E258 -> Stats.WithoutSecondaryStats 0x785E500).
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

    // Same libraries as the header and the comparison strip (useGlobalStats).
    const { libs: statLibs } = useStatLibraries();
    const secondaryStatLibrary = (statLibs as any).secondaryStatLibrary;
    const weaponLibrary = (statLibs as any).weaponLibrary;
    const { data: itemUnlockLibrary } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: petUnlockLibrary } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: fairyUpgrades } = useGameData<any>('FairyUpgradesLibrary.json');

    const [slotMode, setSlotMode] = useState<'profile' | 'max'>('profile');
    const [weaponType, setWeaponType] = useState<'profile' | 'melee' | 'ranged'>('profile');
    // The fairy on the Test side: picked here or loaded from a preset.
    // `level: null` = the top level of FairyUpgradesLibrary, resolved below once it loads.
    const [bestFairyPick, setBestFairy] = useState<{ name: FairySelection['name']; level: number | null }>(
        () => ({ name: profile.misc.fairy?.name ?? null, level: null })
    );
    const [statAllocations, setStatAllocations] = useState<Record<string, number>>({});
    const [perfectionPercentage, setPerfectionPercentage] = useState(100);

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

    // ------------------------------------------------------------------ preset builds
    // The best allocations are searched once per game version (scripts/build_presets.ts) and
    // published with the presets; loading one puts its rolls on the sliders, laid onto this
    // build's own slots (placedCounts: the stats with the most rolls first when slots run short).
    const { data: presetFile } = useGameData<ProfilePresetsFile>('ProfilePresets.json');
    // The best build of each category (the file also holds the runners-up).
    const presets = (presetFile?.presets ?? []).filter(p => (p.rank ?? 1) === 1);
    const [loadedPreset, setLoadedPreset] = useState<string | null>(null);

    const loadPreset = useCallback((preset: ProfilePreset) => {
        setStatAllocations(placedCounts(currentAlloc(preset.profile), bodies));
        setBestFairy({ name: (preset.profile.misc.fairy?.name ?? null) as FairySelection['name'], level: maxFairyLevel });
        setPerfectionPercentage(100);
        setWeaponType(preset.weapons === 'any' ? 'profile' : preset.weapons);
        setLoadedPreset(preset.key);
    }, [bodies, maxFairyLevel]);

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
        const required = cfg.requiredStat ? poolOf(cfg.requiredStat) : 0;
        const targetBefore = poolOf(cfg.targetStat);
        const raw = fairyRawBonus(cfg, bestFairy.level, required);
        const granted = fairyGranted(cfg, raw, targetBefore);
        return { cfg, required, granted };
    }, [bestFairy, statAllocations, secondaryStatLibrary, perfectionPercentage]);


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
                        <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 14 }} size={32} />
                        Substats Calculator
                    </h1>
                    <p className="text-text-secondary max-w-2xl mt-2 font-medium">
                        Try substat combinations on your build, or load the best ones of a preset build. Slots
                        follow the game's unlock rules for your gear, tree-only stats never take a slot, and the
                        fairy conversion and weapon type work exactly like in game.
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
                                { id: 'melee', label: 'Melee', icon: <GameAssetIcon asset={{ icon: 'Battle' }} size={14} /> },
                                { id: 'ranged', label: 'Ranged', icon: <GameAssetIcon asset={{ icon: 'IconMedievalWeaponBow' }} size={14} /> },
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

                    {/* Preset builds */}
                    <Card className="p-4 border-orange-500/30 bg-orange-500/5" data-testid="substats-presets">
                        <h3 className="text-lg font-bold mb-1 flex items-center gap-2 text-orange-400">
                            <GameAssetIcon asset={{ sheet: 'ArenaRankIcons', index: 0 }} size={20} /> Best substats
                        </h3>
                        <p className="text-[11px] text-text-muted leading-snug mb-3">
                            The best allocations of every <Link to="/presets" className="text-accent-primary hover:underline">preset build</Link>,
                            searched for this game version. Load one to put its rolls and fairy on the sliders (only substats and
                            fairy: your gear, levels and trees stay yours) and compare it with your build.
                        </p>
                        {presets.length === 0 ? (
                            <div className="text-xs text-text-muted">No preset builds for this game version yet.</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-1.5">
                                {presets.map((p) => (
                                    <button
                                        key={p.key}
                                        onClick={() => loadPreset(p)}
                                        data-testid={`substats-preset-${p.key}`}
                                        className={cn(
                                            'text-left px-2.5 py-1.5 rounded-lg border transition-colors',
                                            loadedPreset === p.key ? 'border-orange-400 bg-orange-500/15' : 'border-border bg-bg-input/40 hover:bg-orange-500/10',
                                        )}
                                    >
                                        <div className="text-xs font-bold flex items-center gap-1">
                                            {loadedPreset === p.key && <Check className="w-3 h-3 text-orange-400" />}{p.name}
                                        </div>
                                        <div className="text-[10px] text-text-muted">{p.goal}</div>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="bg-bg-input/30 p-3 rounded-lg border border-border/30 mt-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium">Substats Perfection</span>
                                <span className="text-xs font-bold text-accent-primary">{perfectionPercentage}%</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={perfectionPercentage}
                                onChange={(e) => setPerfectionPercentage(Number(e.target.value))}
                                className="w-full accent-accent-primary"
                            />
                        </div>
                    </Card>

                    {/* Fairy */}
                    <Card className="p-4 border-accent-primary/20 bg-accent-primary/5" data-testid="substats-fairy">
                        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <GameAssetIcon asset={{ icon: 'FairyIconLora' }} size={20} /> Fairy
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                            {([null, ...FAIRIES.map((f) => f.name)] as FairySelection['name'][]).map((name) => (
                                <button
                                    key={name ?? 'none'}
                                    onClick={() => setBestFairy({ name, level: bestFairy.level || maxFairyLevel })}
                                    className={cn(
                                        'px-2.5 py-1 rounded-lg border text-xs font-bold',
                                        bestFairy.name === name ? 'border-accent-primary bg-accent-primary/15 text-accent-primary' : 'border-border text-text-secondary hover:bg-bg-input',
                                    )}
                                >
                                    {name ?? 'None'}
                                </button>
                            ))}
                        </div>
                        {bestFairy.name && (
                            <div className="mt-3">
                                <div className="flex justify-between items-center mb-1 text-xs">
                                    <span className="text-text-secondary">Level</span>
                                    <span className="font-mono font-bold text-accent-primary">{bestFairy.level} / {maxFairyLevel}</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max={Math.max(1, maxFairyLevel)}
                                    value={bestFairy.level}
                                    onChange={(e) => setBestFairy({ name: bestFairy.name, level: Number(e.target.value) })}
                                    className="w-full accent-accent-primary"
                                />
                                <p className="text-[10px] text-text-muted mt-1 leading-snug">{SEASON_STATS[bestFairy.name].targetLabel} from {SEASON_STATS[bestFairy.name].requiredLabel}{SEASON_STATS[bestFairy.name].targetStatTotalCap !== null ? `, up to ${pctLabel(SEASON_STATS[bestFairy.name].targetStatTotalCap!)} in total` : ''}.</p>
                            </div>
                        )}
                    </Card>

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
                            <li>Pick a weapon type in the Scenario and a fairy; loading a preset sets both to the preset's.</li>
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
