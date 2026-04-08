/**
 * useBattleSimulation - Hook for battle simulation functionality
 */

import { useCallback, useMemo } from 'react';

import { useGlobalStats } from './useGlobalStats';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from './useGameData';
import {
    getAvailableStages as getStagesFromUtils,
    BattleResult
} from '../utils/BattleHelper';
import {
    simulateBattleMulti,
    simulateDungeonBattleMulti
} from '../utils/BattleSimulator';
import { DebugConfig } from '../utils/BattleEngine';


// Hook for battle simulation logic
export function useBattleSimulation() {
    // useGlobalStats handles profile, tech tree mode, and all stat calculations automatically
    const playerStats = useGlobalStats();
    const { profile } = useProfile();

    // We still need raw libraries for battle data
    const { data: mainBattleLibrary, loading: loading1 } = useGameData<any>('MainBattleLibrary.json');
    const { data: mainBattleConfig, loading: loading2 } = useGameData<any>('MainBattleConfig.json');
    const { data: enemyAgeScalingLibrary, loading: loading3 } = useGameData<any>('EnemyAgeScalingLibrary.json');
    const { data: enemyLibrary, loading: loading4 } = useGameData<any>('EnemyLibrary.json');
    const { data: weaponLibrary, loading: loading5 } = useGameData<any>('WeaponLibrary.json');
    const { data: itemBalancingConfig, loading: loading6 } = useGameData<any>('ItemBalancingConfig.json');

    // Dungeon Libraries
    const { data: hammerThiefDungeonBattleLibrary, loading: loading7 } = useGameData<any>('HammerThiefDungeonBattleLibrary.json');
    const { data: skillDungeonBattleLibrary, loading: loading8 } = useGameData<any>('SkillDungeonBattleLibrary.json');
    const { data: eggDungeonBattleLibrary, loading: loading9 } = useGameData<any>('EggDungeonBattleLibrary.json');
    const { data: potionDungeonBattleLibrary, loading: loading10 } = useGameData<any>('PotionDungeonBattleLibrary.json');
    const { data: projectilesLibrary, loading: loading11 } = useGameData<any>('ProjectileLibrary.json');
    const { data: skillLibrary, loading: loading12 } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary, loading: loading13 } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: dungeonBaseConfig, loading: loading14 } = useGameData<any>('DungeonBaseConfig.json');

    const isLoading = loading1 || loading2 || loading3 || loading4 || loading5 || loading6 || loading7 || loading8 || loading9 || loading10 || loading11 || loading12 || loading13 || loading14;

    // Derived Constants
    const maxDungeonLevel = useMemo(() => dungeonBaseConfig?.MaxDungeonLevel ?? 399, [dungeonBaseConfig]);

    const maxAgeIdx = useMemo(() => {
        if (!mainBattleLibrary) return 10; // Fallback
        let maxAge = 0;
        Object.keys(mainBattleLibrary).forEach(key => {
            const match = key.match(/['"]?AgeIdx['"]?\s*:\s*(\d+)/);
            if (match) {
                maxAge = Math.max(maxAge, parseInt(match[1]));
            }
        });
        return maxAge;
    }, [mainBattleLibrary]);

    const libs = useMemo(() => ({
        mainBattleLibrary,
        mainBattleConfig,
        enemyAgeScalingLibrary,
        enemyLibrary,
        weaponLibrary,
        itemBalancingConfig,
        hammerThiefDungeonBattleLibrary,
        skillDungeonBattleLibrary,
        eggDungeonBattleLibrary,
        potionDungeonBattleLibrary,
        projectilesLibrary,
        skillLibrary,
        skillPassiveLibrary,
        dungeonBaseConfig,
        // Build generic lookup map
        mainBattleLookup: (() => {
            if (!mainBattleLibrary) return undefined;
            const lookup: Record<string, any> = {};
            Object.keys(mainBattleLibrary).forEach(key => {
                const ageMatch = key.match(/['"]?AgeIdx['"]?\s*:\s*(\d+)/);
                const battleMatch = key.match(/['"]?BattleIdx['"]?\s*:\s*(\d+)/);
                if (ageMatch && battleMatch) {
                    const age = ageMatch[1];
                    const battle = battleMatch[1];
                    lookup[`${age}-${battle}`] = mainBattleLibrary[key];
                }
            });
            return lookup;
        })()
    }), [
        mainBattleLibrary,
        mainBattleConfig,
        enemyAgeScalingLibrary,
        enemyLibrary,
        weaponLibrary,
        itemBalancingConfig,
        hammerThiefDungeonBattleLibrary,
        skillDungeonBattleLibrary,
        eggDungeonBattleLibrary,
        potionDungeonBattleLibrary,
        projectilesLibrary,
        skillLibrary,
        skillPassiveLibrary,
        dungeonBaseConfig
    ]);

    // Simulate a specific main battle (Averaged over configurable runs for prediction)
    const simulate = useCallback((
        ageIdx: number,
        battleIdx: number,
        difficultyMode: number = 0,
        runs: number = 100,
        debugConfig?: DebugConfig
    ): BattleResult | null => {
        if (!playerStats || !libs.mainBattleLibrary) return null;

        return simulateBattleMulti(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, runs, debugConfig);
    }, [playerStats, profile, libs]);

    // Simulate a dungeon battle (Averaged over 100 runs for prediction)
    const simulateDungeon = useCallback((
        dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
        level: number,
        runs: number = 100,
        debugConfig?: DebugConfig
    ): BattleResult | null => {
        if (!playerStats) return null;
        return simulateDungeonBattleMulti(playerStats, profile, dungeonType, level, libs, runs, debugConfig);
    }, [playerStats, profile, libs]);

    // Calculate win probability for a stage
    const getWinProbability = useCallback((ageIdx: number, battleIdx: number, difficultyMode: number = 0): number => {
        const result = simulate(ageIdx, battleIdx, difficultyMode);
        return result ? result.winProbability : 0;
    }, [simulate]);

    // Find the highest beatable stage (win prob > 50%)
    const findMaxBeatable = useCallback((_minWinProb: number = 50, difficultyMode: number = 0) => {
        if (!libs.mainBattleLibrary) return null;

        const stages = getStagesFromUtils(libs);
        let maxBeatable = null;

        // Limit search range to prevent freezing on large iterates
        const searchLimit = 500; // Increased to allow discovery of later ages

        for (let i = 0; i < Math.min(stages.length, searchLimit); i++) {
            const stage = stages[i];

            // The simulation is already averaged (30 runs), so we trust it.
            const result = simulate(stage.ageIdx, stage.battleIdx, difficultyMode);

            if (result && result.victory) {
                maxBeatable = stage;
            } else {
                // If even the averaged simulation fails, we stop searching.
                break;
            }
        }

        return maxBeatable;
    }, [libs, simulate]);

    // Find the highest beatable Dungeon Level
    const findMaxBeatableDungeon = useCallback((dungeonType: 'hammer' | 'skill' | 'egg' | 'potion') => {
        // Levels 0 up to maxDungeonLevel
        let maxBeatableLevel = -1;

        for (let level = 0; level <= maxDungeonLevel; level++) {
            const result = simulateDungeon(dungeonType, level);
            if (result && result.victory) {
                maxBeatableLevel = level;
            } else {
                break;
            }
        }
        return maxBeatableLevel;
    }, [libs, simulateDungeon, maxDungeonLevel]);

    const getAvailableStages = useCallback(() => {
        return getStagesFromUtils(libs);
    }, [libs]);

    const getBattleCountForAge = useCallback((ageIdx: number) => {
        if (!libs.mainBattleLibrary) return 20;

        const stages = getStagesFromUtils(libs);
        const ageStages = stages.filter(s => s.ageIdx === ageIdx);
        if (ageStages.length === 0) return 20; // Fallback

        // Return valid count (max index + 1)
        const maxBattleIdx = Math.max(...ageStages.map(s => s.battleIdx));
        return maxBattleIdx + 1;
    }, [libs]);



    return {
        playerStats,
        profile,
        simulate,
        simulateDungeon,
        getWinProbability,
        findMaxBeatable,
        findMaxBeatableDungeon,
        getAvailableStages,
        getBattleCountForAge,
        libs,
        isLoading,
        maxDungeonLevel,
        maxAgeIdx
    };
}
