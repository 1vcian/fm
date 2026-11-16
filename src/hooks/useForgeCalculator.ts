import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { useTreeModifiers } from './useCalculatedStats';
import { timerSpeedDurationSeconds } from '../utils/techOptimizer';
import { parseForgeUpgrades, forgeLevelDef } from '../utils/forgeConfig';

/**
 * Coins for one forge tier, as ForgeExtensions.GetForgeTierUpgradeCost (RVA 0x7C44E28):
 * RoundToInt(CalculateValue(Cost, Forge, Cost / Tiers)) with an integer division first. The
 * ForgeUpgradeCost node is a OneMinusMultiplier. The row is ForgeUpgradesByLevel[ForgeLevel + 1] on the
 * game's 0-based ForgeLevel, which is the displayed level, so key N prices leaving level N.
 */
export function forgeTierCost(def: { Cost?: number; Tiers?: number } | null | undefined, costReduction: number): number {
    if (!def?.Cost) return 0;
    const tiers = Math.max(1, def.Tiers || 1);
    return Math.round(Math.floor(def.Cost / tiers) * (1 - costReduction));
}

/** Coins for a whole forge level: every tier is paid separately (ForgeTierUpgradeAction, RVA 0x7CD4A48). */
export function forgeLevelCost(def: { Cost?: number; Tiers?: number } | null | undefined, costReduction: number): number {
    return forgeTierCost(def, costReduction) * Math.max(1, def?.Tiers || 1);
}

/**
 * Seconds of the forge upgrade timer for one level. ForgeUpgradeStartAction.Execute (RVA 0x7CD4DEC)
 * runs once the level's tiers are all bought (ForgeTiersMaxed 0x7CD4CAC; ForgeTierUpgradeAction
 * 0x7CD4A48 starts no timer), reads ForgeUpgradesByLevel[ForgeLevel + 1].Duration, passes it through
 * StatHelper.CalculateValue(TimerSpeed, StatTarget.Forge) (0x7CFDB64) and hands the F64 result to
 * TimerModel..ctor (0x7D06CEC). ForgeTimerSpeed is a TimerSpeed Divisor node, so the duration is per
 * LEVEL and equals Duration / (1 + ForgeTimerSpeed), floored to whole milliseconds.
 */
export function forgeUpgradeDurationSeconds(def: { Duration?: number } | null | undefined, forgeTimerSpeed: number): number {
    if (!def?.Duration) return 0;
    return timerSpeedDurationSeconds(def.Duration, forgeTimerSpeed);
}

/**
 * Gems to skip a forge timer with `remainingSeconds` left: TimerModel.CalculateGemSkipCost (RVA 0x7D06154)
 * with GemSkipTarget.Forge, called by ForgeGemSkipAction (0x7CD5624). Remaining time is
 * FloorToInt(seconds) (GetRemainingSeconds 0x7D08210), the rate is ForgeConfig.ForgeGemSkipCostPerSecond
 * (GetCostPerSecond 0x7D08CF0), the product is an F64 (Q32.32) rounded half up (RoundToInt 0x761C68C)
 * and the result is at least 1. Returns null while the rate is not loaded.
 */
export function forgeGemSkipCost(remainingSeconds: number, costPerSecond: number | null | undefined): number | null {
    if (typeof costPerSecond !== 'number' || !Number.isFinite(costPerSecond)) return null;
    const seconds = BigInt(Math.max(0, Math.floor(remainingSeconds)));
    const rateRaw = BigInt(Math.round(costPerSecond * 2 ** 32));
    const product = seconds * rateRaw;
    const rounded = Number((product + (1n << 31n)) >> 32n);
    return Math.max(1, rounded);
}

// Separate hook for reuse in Profile/MiscPanel
export function useForgeUpgradeStats(level: number) {
    const { data: upgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const techModifiers = useTreeModifiers();
    const forgeCostReduction = techModifiers['ForgeUpgradeCost'] || 0;
    const forgeTimerSpeed = techModifiers['ForgeTimerSpeed'] || 0;

    return useMemo(() => {
        // ForgeUpgradesByLevel key N is the upgrade FROM displayed level N to N+1 (utils/forgeConfig.ts).
        const nextLevelData = forgeLevelDef(parseForgeUpgrades(upgradeData), level);
        if (!nextLevelData) return null;

        const baseCost = nextLevelData.Cost || 0;
        const reduction = forgeCostReduction;

        // Tiers (Steps), each paid on its own
        const tiers = nextLevelData.Tiers || 1;
        const costPerTier = forgeTierCost(nextLevelData, reduction);
        const cost = costPerTier * tiers;

        // One timer per level, started after the last tier (forgeUpgradeDurationSeconds).
        const totalTimeSeconds = forgeUpgradeDurationSeconds(nextLevelData, forgeTimerSpeed);

        return {
            cost,
            baseCost,
            reduction,
            tiers,
            costPerTier,
            totalTimeSeconds
        };
    }, [level, upgradeData, forgeCostReduction, forgeTimerSpeed]);
}
