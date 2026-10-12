import { useState, useMemo, useEffect } from 'react';
import { tierNames } from '../constants/forgeData';
import { useGameData } from './useGameData';
import { useTreeModifiers } from './useCalculatedStats';

export type CalculationMode = 'calculate' | 'target';

interface UseForgeCalculatorProps {
    initialLevel?: number;
}

/**
 * Coins for one forge tier, as ForgeExtensions.GetForgeTierUpgradeCost (RVA 0x77B2C74):
 * RoundToInt(CalculateValue(Cost, Forge, Cost / Tiers)) with an integer division first. The
 * ForgeUpgradeCost node is a OneMinusMultiplier. The row is ForgeUpgradeLibrary[ForgeLevel + 1] on the
 * game's 0-based ForgeLevel, which is the displayed level, so key N prices leaving level N.
 */
export function forgeTierCost(def: { Cost?: number; Tiers?: number } | null | undefined, costReduction: number): number {
    if (!def?.Cost) return 0;
    const tiers = Math.max(1, def.Tiers || 1);
    return Math.round(Math.floor(def.Cost / tiers) * (1 - costReduction));
}

/** Coins for a whole forge level: every tier is paid separately (ForgeTierUpgradeAction, RVA 0x783A080). */
export function forgeLevelCost(def: { Cost?: number; Tiers?: number } | null | undefined, costReduction: number): number {
    return forgeTierCost(def, costReduction) * Math.max(1, def?.Tiers || 1);
}

// Separate hook for reuse in Profile/MiscPanel
export function useForgeUpgradeStats(level: number) {
    const { data: upgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const techModifiers = useTreeModifiers();
    const forgeCostReduction = techModifiers['ForgeUpgradeCost'] || 0;
    const forgeTimerSpeed = techModifiers['ForgeTimerSpeed'] || 0;
    // FreeForgeChance is likely a multiplier e.g. 0.01 for 1%.
    // In TechTreeLibrary it had Value: 0.01.
    const freeForgeChance = techModifiers['FreeForgeChance'] || 0;

    return useMemo(() => {
        if (!upgradeData) return null;

        // Cost Calculation
        // Use `level` directly as JSON Key N represents upgrade FROM N to N+1.
        const nextLevelData = upgradeData[String(level)] || upgradeData[level];
        if (!nextLevelData) return null;

        const baseCost = nextLevelData.Cost || 0;
        const reduction = forgeCostReduction;

        // Tiers (Steps), each paid on its own
        const tiers = nextLevelData.Tiers || 1;
        const costPerTier = forgeTierCost(nextLevelData, reduction);
        const cost = costPerTier * tiers;

        // Steps (Hammers) & Time Calculation
        // JSON "Duration" is the Base Time in SECONDS for the entire Level (Total).
        // It matches the Excel sheet's "Time" column exactly.
        const baseDurationSeconds = nextLevelData.Duration || 0;

        // Time with Speed Bonus (Speed reduces time: Time / (1 + Bonus))
        const speedMultiplier = 1 + forgeTimerSpeed;
        const totalTimeSeconds = baseDurationSeconds / speedMultiplier;

        // Hammers (Clicks)
        // Derived from Time: If base speed is 0.25s/hammer, then Hammers = Duration / 0.25.
        const baseSecondsPerHammer = 0.25;
        const rawHammersNeeded = Math.ceil(baseDurationSeconds / baseSecondsPerHammer);

        // Effective Hammers (paying for Free Forge)
        const hammersToUpgrade = Math.ceil(rawHammersNeeded * (1 - freeForgeChance));
        const hammersPerTier = tiers > 0 ? Math.ceil(hammersToUpgrade / tiers) : hammersToUpgrade;

        /* Removed old Exp Calculation */
        const requiredExp = baseDurationSeconds; // Mapping "Exp" to Seconds for stats compatibility if needed
        const expPerHammer = baseSecondsPerHammer; // 1 hammer = 0.25 "seconds" of progress

        const goldPerHammer = hammersToUpgrade > 0 ? cost / hammersToUpgrade : 0;

        return {
            cost,
            baseCost,
            reduction,
            tiers,
            costPerTier,
            requiredExp,
            hammersToUpgrade, // Now reflects "Expected Consumed Hammers"
            hammersPerTier,
            rawHammersNeeded, // Exposed if needed
            goldPerHammer,
            totalTimeSeconds,
            expPerHammer,
            freeForgeChance
        };
    }, [level, upgradeData, forgeCostReduction, forgeTimerSpeed, freeForgeChance]);
}

export function useForgeCalculator({ initialLevel = 1 }: UseForgeCalculatorProps = {}) {
    // State
    const [level, setLevel] = useState(initialLevel);
    const [mode, setMode] = useState<CalculationMode>('calculate');

    // Inputs
    const [freeSummonPercent, setFreeSummonPercent] = useState(0);
    const [hammerCount, setHammerCount] = useState(0);
    const [targetExp, setTargetExp] = useState(0);

    // Coin Inputs
    const [maxItemLevel, setMaxItemLevel] = useState(100);
    const [priceBonus, setPriceBonus] = useState(0);

    // Persist level
    useEffect(() => {
        const saved = localStorage.getItem('forgeMasterLevel');
        if (saved) setLevel(parseInt(saved));
    }, []);

    useEffect(() => {
        localStorage.setItem('forgeMasterLevel', level.toString());
    }, [level]);

    // Use shared hook for upgrade stats
    const upgradeStats = useForgeUpgradeStats(level);

    // Age odds (percent) from ItemAgeDropChancesLibrary, keyed by the game's 0-based ForgeLevel
    // (displayed level - 1): key 0 is 100% Primitive. Age index N is the N-th tierNames key.
    const { data: dropChances } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    const probs = useMemo((): Record<string, number> | null => {
        const row = dropChances?.[String(level - 1)];
        if (!row) return null;
        const out: Record<string, number> = {};
        Object.keys(tierNames).forEach((tier, idx) => {
            const p = Number(row[`Age${idx}`]) || 0;
            if (p > 0) out[tier] = Math.round(p * 1e6) / 1e4;
        });
        return out;
    }, [dropChances, level]);
    const expPerHammer = upgradeStats?.expPerHammer || 0;

    const freeMultiplier = useMemo(() => {
        return 1 / (1 - (freeSummonPercent / 100));
    }, [freeSummonPercent]);

    const effectiveHammers = useMemo(() => {
        return hammerCount * freeMultiplier;
    }, [hammerCount, freeMultiplier]);

    // Upgrade Cost Calculation (New)
    // This section is now handled by useForgeUpgradeStats and its result is `upgradeStats`
    // The original `upgradeStats` useMemo block is removed.

    // Results: Calculate Mode
    const totalExp = useMemo(() => {
        return expPerHammer * effectiveHammers;
    }, [expPerHammer, effectiveHammers]);

    // Results: Target Mode
    const hammersNeeded = useMemo(() => {
        if (expPerHammer === 0) return 0;
        return Math.ceil(targetExp / expPerHammer);
    }, [targetExp, expPerHammer]);

    const actualHammersNeeded = useMemo(() => {
        return Math.ceil(hammersNeeded / freeMultiplier);
    }, [hammersNeeded, freeMultiplier]);

    const expectedWithRecommended = useMemo(() => {
        return expPerHammer * hammersNeeded;
    }, [expPerHammer, hammersNeeded]);

    // Coin Calculation
    const coinEstimates = useMemo(() => {
        const bonusMultiplier = 1 + (priceBonus / 100);
        let lowestProb = 0;
        if (probs) {
            lowestProb = Math.min(...Object.values(probs));
        }
        const standardProb = 100 - lowestProb;

        const priceBase = 20;

        // Standard items Min: Max - 5 (at least 1)
        const standardItemLevelMin = Math.max(1, maxItemLevel - 5);
        const priceStandardMin = priceBase * Math.pow(1.01, standardItemLevelMin - 1);

        // Lowest Probability Item Min: Level 1
        const priceLowestMin = priceBase;

        // Max Price uses Max Level for all
        const priceMax = priceBase * Math.pow(1.01, maxItemLevel - 1);

        // Weighted Averages
        const avgPriceMin = ((standardProb * priceStandardMin) + (lowestProb * priceLowestMin)) / 100;
        const avgPriceMax = priceMax;

        return {
            min: avgPriceMin * effectiveHammers * bonusMultiplier,
            max: avgPriceMax * effectiveHammers * bonusMultiplier
        };
    }, [probs, maxItemLevel, priceBonus, effectiveHammers]);

    // Probability Breakdown Data
    const probabilityData = useMemo(() => {
        if (!probs) return [];

        return Object.entries(probs)
            .sort((a, b) => b[1] - a[1]) // Sort by probability desc
            .map(([tier, probability]) => ({
                tier,
                probability,
                count: mode === 'calculate'
                    ? Math.floor(effectiveHammers * (probability / 100))
                    : 0
            }));
    }, [probs, effectiveHammers, mode]);

    return {
        // State setters
        setLevel,
        setMode,
        setFreeSummonPercent,
        setHammerCount,
        setTargetExp,
        setMaxItemLevel,
        setPriceBonus,

        // State values
        level,
        mode,
        freeSummonPercent,
        hammerCount,
        targetExp,
        maxItemLevel,
        priceBonus,

        // Results
        expPerHammer,
        totalExp,
        actualHammersNeeded,
        expectedWithRecommended,
        coinEstimates,
        probabilityData,

        // New Upgrade Data
        upgradeStats
    };
}
