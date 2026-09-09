import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { useProfile } from '../../context/ProfileContext';
import { useComparison, FairySelection } from '../../context/ComparisonContext';
import { useGameData } from '../../hooks/useGameData';
import { StatsSummaryPanel } from '../../components/Profile/StatsSummaryPanel';
import { RefreshCw, Sliders, Hash, Zap, TrendingUp, Sparkles, Wand2, Swords, Crosshair, User } from 'lucide-react';
import { getStatName } from '../../utils/statNames';
import { cn } from '../../lib/utils';
import { UserProfile } from '../../types/Profile';
import { calculateStats, LibraryData } from '../../utils/statEngine';
import { FAIRIES, FAIRY_MAX_LEVEL, FairyName, SEASON_STATS, fairyRawBonus } from '../../utils/fairies';

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
 * The optimizer also DECIDES the fairy: every run evaluates no fairy plus each of the
 * season's three at max level (the conversion math, steps + cap, is the binary-verified
 * one), optimizes the substats under each, and keeps the winning pair. The melee/ranged
 * weapon choice stays a manual scenario input.
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

interface Body {
    key: string;
    label: string;
    slots: number;
}

/**
 * Spread the allocation over the bodies, one instance of a stat per body: highest remaining
 * count first, always into the body with the most free slots that does not hold it yet.
 */
function distribute(allocs: Record<string, number>, bodies: Body[]): Map<string, string[]> {
    const free = new Map(bodies.map((b) => [b.key, b.slots]));
    const out = new Map(bodies.map((b) => [b.key, [] as string[]]));
    const stats = Object.entries(allocs)
        .filter(([, c]) => c > 0)
        .map(([s, c]) => ({ s, c }))
        .sort((a, b) => b.c - a.c);
    for (const { s, c } of stats) {
        // All copies of one stat at once, onto the c bodies with the most free slots: batch
        // placement cannot strand a later copy on a body that already holds the stat, which
        // the per-copy interleaving this replaces could (and did, leaving slots empty).
        const targets = bodies
            .filter((b) => (free.get(b.key) || 0) > 0)
            .sort((a, b) => free.get(b.key)! - free.get(a.key)!)
            .slice(0, c);
        for (const b of targets) {
            free.set(b.key, free.get(b.key)! - 1);
            out.get(b.key)!.push(s);
        }
        // Copies beyond the eligible bodies are stranded and dropped here; the optimizer
        // repairs its allocation against this same function so they never reach the UI.
    }
    return out;
}

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

    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
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
    const { data: itemUnlockLibrary } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: petUnlockLibrary } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: fairyUpgrades } = useGameData<any>('FairyUpgradesLibrary.json');

    const libs: LibraryData = useMemo(() => ({
        petUpgradeLibrary, petBalancingLibrary, petLibrary, skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        guildTechTreePositionLibrary: guildPositionLibrary || undefined,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary || undefined,
        itemBalancingLibrary, itemBalancingConfig, weaponLibrary,
        projectilesLibrary, secondaryStatLibrary, skinsLibrary, setsLibrary, ascensionConfigsLibrary
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary, skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary, guildPositionLibrary, guildUpgradeLibrary,
        itemBalancingLibrary, itemBalancingConfig, weaponLibrary,
        projectilesLibrary, secondaryStatLibrary, skinsLibrary, setsLibrary, ascensionConfigsLibrary
    ]);

    const [slotMode, setSlotMode] = useState<'profile' | 'max'>('profile');
    const [weaponType, setWeaponType] = useState<'profile' | 'melee' | 'ranged'>('profile');
    // Output of the optimizer, not an input: which fairy (at max level) won the search.
    const [bestFairy, setBestFairy] = useState<FairySelection>(
        () => ({ name: profile.misc.fairy?.name ?? null, level: FAIRY_MAX_LEVEL })
    );
    const [statAllocations, setStatAllocations] = useState<Record<string, number>>({});
    const [optimizeType, setOptimizeType] = useState<'real' | 'theor'>('real');
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [includeSkills, setIncludeSkills] = useState(false);
    const [perfectionPercentage, setPerfectionPercentage] = useState(100);

    useEffect(() => {
        enterCompareMode();
        return () => {
            exitCompareMode();
        };
    }, [enterCompareMode, exitCompareMode]);

    const maxFairyLevel = useMemo(
        () => (fairyUpgrades ? Math.max(...Object.keys(fairyUpgrades).map(Number)) : FAIRY_MAX_LEVEL),
        [fairyUpgrades]
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
        if (!rarity || !petUnlockLibrary) return 1;
        return petUnlockLibrary[rarity]?.NumberOfSecondStats ?? 1;
    }, [petUnlockLibrary]);

    const maxItemSlots = useMemo(() => {
        if (!itemUnlockLibrary) return 2;
        return Math.max(...Object.values<any>(itemUnlockLibrary).map((r) => r.NumberOfSecondStats));
    }, [itemUnlockLibrary]);
    const maxRaritySlots = useMemo(() => {
        if (!petUnlockLibrary) return 2;
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

    const optimizeSubstats = useCallback((objective: 'dps' | 'hps' | 'hybrid' | 'power' | 'damage' | 'health') => {
        if (!secondaryStatLibrary || !itemBalancingConfig || !itemBalancingLibrary) return;
        setIsOptimizing(true);

        setTimeout(() => {
            const statList = rollableStats;

            /** A scorer bound to one fairy candidate (max level) on its own scenario clone. */
            const makeScorer = (fairyName: FairyName | null) => {
                const base = JSON.parse(JSON.stringify(profile));
                if (!base.items.Weapon) {
                    base.items.Weapon = { age: 1, idx: 0, level: 1, rarity: "Legendary", secondaryStats: [] };
                }
                applyWeapon(base);
                base.misc.fairy = { name: fairyName, level: maxFairyLevel };
                const slots: (keyof UserProfile['items'])[] = ['Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
                slots.forEach(slot => { if (base.items[slot]) base.items[slot].secondaryStats = []; });
                base.pets.active.forEach((pet: any) => { pet.secondaryStats = []; });
                if (base.mount.active) base.mount.active.secondaryStats = [];

                return (allocs: Record<string, number>) => {
                    // Where a substat sits does not change the totals, so scoring can stack
                    // the whole allocation on the weapon and skip re-distributing.
                    base.items.Weapon.secondaryStats = Object.entries(allocs)
                        .filter(([_, count]) => count > 0)
                        .map(([statId, count]) => ({ statId, value: count * (secondaryStatLibrary[statId]?.UpperRange || 0) * perfectionPercentage }));

                    const stats = calculateStats(base, libs);

                    const cappedCrit = Math.min(stats.criticalChance, 1);
                    const cappedDouble = Math.min(stats.doubleDamageChance, 1);
                    const critMult = 1 + cappedCrit * (stats.criticalDamage - 1);
                    const doubleMult = 1 + cappedDouble;
                    const aps = 1 / (stats.weaponAttackDuration / stats.attackSpeedMultiplier);
                    const weaponTheor = stats.totalDamage * aps * critMult * doubleMult;
                    const weaponReal = stats.realWeaponDps;

                    // Reflect thorns count as DPS against the engine's assumed mirror enemy,
                    // so Lora competes with the offensive fairies on equal ground.
                    const theorDps = weaponTheor + (stats.reflectDps || 0) + (includeSkills ? stats.skillDps + (stats.skillBuffDps || 0) : 0);
                    const realDps = weaponReal + (stats.realReflectDps || 0) + (includeSkills ? stats.skillDps + (stats.skillBuffDps || 0) : 0);

                    const blockChance = Math.min(stats.blockChance || 0, 0.95);
                    const theorHps = (stats.totalHealth * stats.healthRegen + weaponTheor * stats.lifeSteal + (includeSkills ? stats.skillHps : 0)) / (1 - blockChance);
                    const realHps = (stats.totalHealth * stats.healthRegen + weaponReal * stats.lifeSteal + (includeSkills ? stats.skillHps : 0)) / (1 - blockChance);

                    const dps = optimizeType === 'real' ? realDps : theorDps;
                    const hps = optimizeType === 'real' ? realHps : theorHps;

                    if (objective === 'dps') return dps;
                    if (objective === 'hps') return hps;
                    if (objective === 'power') {
                        const powerDmgMulti = stats.powerDamageMultiplier || 8.0;
                        return ((stats.totalDamage - 10) * powerDmgMulti + (stats.totalHealth - 80)) * 3;
                    }
                    if (objective === 'damage') return stats.totalDamage;
                    if (objective === 'health') return stats.totalHealth;
                    return dps * hps; // hybrid
                };
            };

            // Lookahead greedy ascent: per stat, probe every add-count for breakpoint jumps
            // (fairy steps, crit cap, block cap), then take the best return per point.
            const greedy = (getScore: (a: Record<string, number>) => number) => {
                const allocs: Record<string, number> = {};
                let remainingPoints = totalAvailablePool;
                while (remainingPoints > 0) {
                    let bestStat = '';
                    let bestPointsToADD = 0;
                    let bestScoreIncreasePerPoint = -1;
                    const baseScore = getScore(allocs);

                    for (const stat of statList) {
                        const currentPoints = allocs[stat] || 0;
                        const maxToAdd = Math.min(remainingPoints, perStatCap - currentPoints);
                        if (maxToAdd <= 0) continue;

                        let localBestIncreasePerPoint = -1;
                        let localBestPoints = 0;
                        for (let k = 1; k <= maxToAdd; k++) {
                            const tempAllocs = { ...allocs, [stat]: currentPoints + k };
                            const score = getScore(tempAllocs);
                            const increasePerPoint = (score - baseScore) / k;
                            if (increasePerPoint > localBestIncreasePerPoint) {
                                localBestIncreasePerPoint = increasePerPoint;
                                localBestPoints = k;
                            }
                        }

                        if (localBestIncreasePerPoint > bestScoreIncreasePerPoint) {
                            bestScoreIncreasePerPoint = localBestIncreasePerPoint;
                            bestStat = stat;
                            bestPointsToADD = localBestPoints;
                        }
                    }

                    if (bestStat && bestScoreIncreasePerPoint > 0) {
                        allocs[bestStat] = (allocs[bestStat] || 0) + bestPointsToADD;
                        remainingPoints -= bestPointsToADD;
                    } else {
                        const fallbackStat = statList.find(s => (allocs[s] || 0) < perStatCap);
                        if (fallbackStat) {
                            allocs[fallbackStat] = (allocs[fallbackStat] || 0) + 1;
                            remainingPoints -= 1;
                        } else {
                            break;
                        }
                    }
                }
                return allocs;
            };

            // Shared restart seeds: every candidate hill-climbs from the SAME random
            // starts, so two equally good candidates score identically instead of one
            // winning on restart luck (that is how a 0-grant fairy used to "win").
            const sharedSeeds: Record<string, number>[] = [];
            for (let i = 0; i < 10; i++) {
                let randomAlloc: Record<string, number> = {};
                let pointsLeft = totalAvailablePool;
                let availableStats = [...statList];
                while (pointsLeft > 0 && availableStats.length > 0) {
                    const idx = Math.floor(Math.random() * availableStats.length);
                    const st = availableStats[idx];
                    const maxCanAdd = Math.min(pointsLeft, perStatCap - (randomAlloc[st] || 0));
                    if (maxCanAdd <= 0) {
                        availableStats.splice(idx, 1);
                        continue;
                    }
                    const add = Math.floor(Math.random() * maxCanAdd) + 1;
                    randomAlloc[st] = (randomAlloc[st] || 0) + add;
                    pointsLeft -= add;
                    if (randomAlloc[st] === perStatCap) availableStats.splice(idx, 1);
                }
                sharedSeeds.push(randomAlloc);
            }

            // Random-restart local search: swaps of 1-2 points jump the local optima that
            // breakpoint synergies create. Deterministic given its starting points.
            const refine = (getScore: (a: Record<string, number>) => number, greedySeed: Record<string, number>) => {
                let globalBestAllocs = { ...greedySeed };
                let globalBestScore = getScore(globalBestAllocs);
                const startingPoints: Record<string, number>[] = [greedySeed, ...sharedSeeds];

                for (const startAlloc of startingPoints) {
                    let localAllocs = { ...startAlloc };
                    let improved = true;
                    while (improved) {
                        improved = false;
                        let bestSwapScore = getScore(localAllocs);
                        let bestSwap: { remove: string, add: string, count: number } | null = null;

                        const currentStats = Object.keys(localAllocs).filter(st => localAllocs[st] > 0);
                        for (const removeStat of currentStats) {
                            const removeAvailable = localAllocs[removeStat];
                            for (const addStat of statList) {
                                if (removeStat === addStat) continue;
                                const addAvailable = perStatCap - (localAllocs[addStat] || 0);
                                if (addAvailable <= 0) continue;
                                const maxSwap = Math.min(removeAvailable, addAvailable, 2);
                                for (let k = 1; k <= maxSwap; k++) {
                                    const tempAllocs = { ...localAllocs };
                                    tempAllocs[removeStat] -= k;
                                    tempAllocs[addStat] = (tempAllocs[addStat] || 0) + k;
                                    const score = getScore(tempAllocs);
                                    if (score > bestSwapScore) {
                                        bestSwapScore = score;
                                        bestSwap = { remove: removeStat, add: addStat, count: k };
                                    }
                                }
                            }
                        }

                        if (bestSwap) {
                            localAllocs[bestSwap.remove] -= bestSwap.count;
                            localAllocs[bestSwap.add] = (localAllocs[bestSwap.add] || 0) + bestSwap.count;
                            improved = true;
                        }
                    }

                    const finalLocalScore = getScore(localAllocs);
                    if (finalLocalScore > globalBestScore) {
                        globalBestScore = finalLocalScore;
                        globalBestAllocs = { ...localAllocs };
                    }
                }
                return { allocs: globalBestAllocs, value: globalBestScore };
            };

            // Phase A: greedy under no fairy and under each fairy at max level.
            const candidates: (FairyName | null)[] = [null, ...FAIRIES.map((f) => f.name)];
            const phaseA = candidates.map((name) => {
                const score = makeScorer(name);
                const allocs = greedy(score);
                return { name, score, allocs, value: score(allocs) };
            });

            // Phase B: refine no-fairy always, plus the two most promising fairies. A fairy
            // wins only by STRICTLY beating no-fairy; a tie means it granted nothing.
            const nullCand = phaseA[0];
            const nonNull = phaseA.slice(1).sort((a, b) => b.value - a.value).slice(0, 2);
            const refinedNull = refine(nullCand.score, nullCand.allocs);
            let best: { name: FairyName | null; allocs: Record<string, number>; value: number; score: (a: Record<string, number>) => number } =
                { name: null, allocs: refinedNull.allocs, value: refinedNull.value, score: nullCand.score };
            for (const cand of nonNull) {
                const refined = refine(cand.score, cand.allocs);
                if (refined.value > best.value * (1 + 1e-6)) {
                    best = { name: cand.name, allocs: refined.allocs, value: refined.value, score: cand.score };
                }
            }

            // Feasibility repair against the real per-body layout: drop copies distribute()
            // cannot place, then refill the freed slots with the best placeable stats.
            const placedCounts = (allocs: Record<string, number>) => {
                const layout = distribute(allocs, bodies);
                const counts: Record<string, number> = {};
                for (const assigned of layout.values()) {
                    for (const st of assigned) counts[st] = (counts[st] || 0) + 1;
                }
                return counts;
            };
            const repaired = placedCounts(best.allocs);
            let placedTotal = Object.values(repaired).reduce((a, b) => a + b, 0);
            let guard = 0;
            while (placedTotal < totalAvailablePool && guard++ < totalAvailablePool * 2) {
                let bestAdd: string | null = null;
                let bestAddScore = -Infinity;
                for (const st of statList) {
                    if ((repaired[st] || 0) >= perStatCap) continue;
                    const tryAllocs = { ...repaired, [st]: (repaired[st] || 0) + 1 };
                    const placedAfter = Object.values(placedCounts(tryAllocs)).reduce((a, b) => a + b, 0);
                    if (placedAfter <= placedTotal) continue; // this copy would strand too
                    const sc = best.score(tryAllocs);
                    if (sc > bestAddScore) {
                        bestAddScore = sc;
                        bestAdd = st;
                    }
                }
                if (!bestAdd) break;
                repaired[bestAdd] = (repaired[bestAdd] || 0) + 1;
                placedTotal += 1;
            }

            setStatAllocations(repaired);
            setBestFairy({ name: best.name, level: maxFairyLevel });
            setIsOptimizing(false);
        }, 50);
    }, [secondaryStatLibrary, rollableStats, profile, libs, optimizeType, includeSkills, itemBalancingConfig, itemBalancingLibrary, totalAvailablePool, perStatCap, perfectionPercentage, applyWeapon, maxFairyLevel, bodies]);

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
                    <Card className="p-4 border-orange-500/30 bg-orange-500/5 relative overflow-hidden">
                        {isOptimizing && (
                            <div className="absolute inset-0 bg-bg-primary/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center">
                                <RefreshCw className="w-6 h-6 text-orange-400 animate-spin mb-2" />
                                <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">Optimizing</span>
                            </div>
                        )}
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-orange-400">
                            <Wand2 className="w-5 h-5" /> Auto-Optimizer
                        </h3>

                        <div className="flex bg-bg-secondary border border-border/50 rounded-lg p-1 mb-4">
                            <button
                                onClick={() => setOptimizeType('theor')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    optimizeType === 'theor' ? "bg-orange-500 text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                Theoretical
                            </button>
                            <button
                                onClick={() => setOptimizeType('real')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    optimizeType === 'real' ? "bg-orange-500 text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                Real-Time
                            </button>
                        </div>

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
                                onChange={(e) => setPerfectionPercentage(Number(e.target.value))}
                                className="w-full accent-accent-primary"
                            />
                        </div>

                        <div className="flex items-center justify-between bg-bg-input/30 p-2 rounded-lg border border-border/30 mb-4 cursor-pointer" onClick={() => setIncludeSkills(!includeSkills)}>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Include Skills</span>
                                <span className="text-[9px] text-orange-400 font-bold uppercase tracking-wider">Experimental. Recommend disabled.</span>
                            </div>
                            <div className={cn("w-10 h-5 rounded-full relative transition-colors", includeSkills ? "bg-emerald-500" : "bg-bg-card")}>
                                <div className={cn("w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all", includeSkills ? "left-5" : "left-1")}></div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500/50 hover:text-orange-400"
                                onClick={() => optimizeSubstats('dps')}
                            >
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Maximize DPS</span>
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50 hover:text-emerald-400"
                                onClick={() => optimizeSubstats('hps')}
                            >
                                <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Maximize HPS</span>
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50 hover:text-purple-400"
                                onClick={() => optimizeSubstats('hybrid')}
                            >
                                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> Maximize DPS & HPS</span>
                            </Button>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-4 text-text-muted">
                            <span className="text-[10px] font-bold uppercase tracking-widest border-t border-border/50 flex-1 ml-2"></span>
                            <span className="text-[10px] font-bold uppercase tracking-widest">Base Stats</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest border-t border-border/50 flex-1 mr-2"></span>
                        </div>
                        <div className="space-y-2 mt-2">
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-cyan-500/30 hover:bg-cyan-500/10 hover:border-cyan-500/50 hover:text-cyan-400"
                                onClick={() => optimizeSubstats('power')}
                            >
                                <span className="flex items-center gap-2"><Hash className="w-4 h-4" /> Maximize Power</span>
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400"
                                onClick={() => optimizeSubstats('damage')}
                            >
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Maximize Damage</span>
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full flex justify-between items-center bg-bg-input/50 border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50 hover:text-green-400"
                                onClick={() => optimizeSubstats('health')}
                            >
                                <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Maximize Health</span>
                            </Button>
                        </div>
                        <p className="text-[10px] text-text-muted mt-3 text-center uppercase tracking-wide">Calculates using {optimizeType === 'real' ? 'Real-Time' : 'Theoretical'} Metrics {includeSkills ? '(With Skills)' : '(Weapon Attacks Only)'}</p>
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
