import React, { useEffect, useRef, useState } from 'react';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import type { EntityState, VisualProjectile as Projectile, DebugConfig } from '../../utils/VisualBattleEngine';
import { VisualBattleEngine } from '../../utils/VisualBattleEngine';
import { dungeonWaveSpecs, mainBattleWaveSpecs, missionWaveSpecs, skillSpecs, skillDamageCount } from '../../engine';
import type { AggregatedStats } from '../../utils/statEngine';
import type { LibraryData } from '../../utils/BattleHelper';
import { calculateEnemyHp, calculateEnemyDmg, calculateProgressDifficultyIdx } from '../../utils/BattleHelper';
import { UserProfile } from '../../types/Profile';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { SpriteIcon } from '../UI/SpriteIcon';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { Play, Pause, X, Zap, Heart, Sword, Shield, Clock, Users } from 'lucide-react';

const basePath = import.meta.env.BASE_URL;
import { getItemImage } from '../../utils/itemAssets';
import { AGES, SKILL_MECHANICS } from '../../utils/constants';
import { getRarityBgStyle } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';

interface BattleVisualizerModalProps {
    isOpen: boolean;
    onClose: () => void;
    playerStats: AggregatedStats;
    profile: UserProfile | null;
    libs: LibraryData;
    ageIdx: number;
    battleIdx: number;
    difficultyMode: number;
    dungeonType?: string;
    dungeonLevel?: number;
    customWaves?: any[];
    debugConfig?: DebugConfig;
    onDebugConfigChange?: (config: DebugConfig) => void;
}

export const BattleVisualizerModal: React.FC<BattleVisualizerModalProps> = ({
    isOpen,
    onClose,
    playerStats,
    profile,
    libs,
    ageIdx,
    battleIdx,
    difficultyMode,
    dungeonType,
    dungeonLevel,
    customWaves,
    debugConfig,
    onDebugConfigChange
}) => {
    const { selectedVersion } = useGameDataContext();
    const [engine, setEngine] = useState<VisualBattleEngine | null>(null);
    const [snapshot, setSnapshot] = useState<any>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [waveIndex, setWaveIndex] = useState(0);
    const [battleOutcome, setBattleOutcome] = useState<'playing' | 'victory' | 'defeat'>('playing');
    const [restartKey, setRestartKey] = useState(0); // Used to trigger re-initialization
    const animationFrameRef = useRef<number>();
    const autoPlayRef = useRef(false);

    // Battle Logs (Local State for Stream)
    const [battleLogs, setBattleLogs] = useState<string[]>([]);

    // Combat Stats for display
    const [combatStats, setCombatStats] = useState<{
        playerDamageBase: number;
        playerDamageWithBuff: number;
        buffDamage: number;
        buffHealth: number;
        enemyDamage: number;
        skillDamages: { id: string; damage: number; hits: number; damageIsPerHit: boolean }[];
        skillDmgMultiTotal: number;
        skillDmgMultiFromTree: number;
        skillDmgMultiFromStats: number;
    } | null>(null);

    // Local state for dungeon wave counts
    // Local state for dungeon wave counts
    // const [dungeonWaves, setDungeonWaves] = useState<number[]>([]); // Unused

    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skillsConfig } = useGameData<any>('SkillLibrary.json');

    // Debug State
    const [isDebugMode, setIsDebugMode] = useState(false);
    // Local debugConfig REMOVED - using prop instead

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        setIsDebugMode(searchParams.get('debug') === 'true');
    }, []);

    // Initialization
    useEffect(() => {
        if (!isOpen || !libs.mainBattleLibrary) return;

        // Reset state
        setBattleOutcome('playing');
        setBattleLogs([]);

        // Create Engine
        // Use debugConfig prop if available, otherwise fallback
        const battleContext: import('../../engine').BattleContext = dungeonType
            ? (`dungeon:${dungeonType}` as import('../../engine').BattleContext)
            : ageIdx === -2
                ? 'mission'
                : 'main';
        const newEngine = new VisualBattleEngine(playerStats, debugConfig, undefined, battleContext);

        // Skills through the shared resolver (verified layers; the engine owns per-skill
        // mechanics, hit counts and buff behaviour). Missions included: the game gives you
        // your skills there too.
        const specs = profile && libs.skillLibrary
            ? skillSpecs(playerStats as any, profile.skills.equipped || [], libs.skillLibrary as any)
            : [];
        for (const spec of specs) newEngine.addSkillSpec(spec);

        // Waves from the shared builders: the modal no longer owns copies of the scaling
        // formulas (docs/combat-model.md). customWaves keeps the legacy shape and is
        // normalised inside VisualBattleEngine.
        const enemyLibs = {
            enemyLibrary: libs.enemyLibrary,
            weaponLibrary: libs.weaponLibrary,
            projectilesLibrary: libs.projectilesLibrary,
            itemBalancingConfig: libs.itemBalancingConfig,
        } as any;
        let wavesList: any[] = [];
        if (customWaves && customWaves.length) {
            wavesList = customWaves;
        } else if (dungeonType && dungeonLevel !== undefined) {
            const library = ({
                hammer: libs.hammerThiefDungeonBattleLibrary,
                skill: libs.skillDungeonBattleLibrary,
                egg: libs.eggDungeonBattleLibrary,
                potion: libs.potionDungeonBattleLibrary,
            } as any)[dungeonType];
            const row = library?.[String(dungeonLevel)];
            if (row) wavesList = dungeonWaveSpecs(row, enemyLibs);
        } else if (ageIdx === -2) {
            const mission = (libs as any).missionBattleLibrary?.[String(battleIdx)];
            if (mission) {
                const levelMulti = (libs as any).missionBaseConfig?.HealthAndDamageLevelMultiplier ?? 1.524;
                wavesList = [missionWaveSpecs(mission, difficultyMode, levelMulti, enemyLibs, newEngine.rng)];
            }
        } else {
            const battleConfig =
                (libs as any).mainBattleLookup?.[`${ageIdx}-${battleIdx}`] ??
                libs.mainBattleLibrary?.[`{'AgeIdx': ${ageIdx}, 'BattleIdx': ${battleIdx}}`];
            const ageScaling = libs.enemyAgeScalingLibrary?.[String(ageIdx)];
            if (battleConfig && ageScaling) {
                const hpM = libs.mainBattleConfig?.EnemyHpDifficultyMulti ?? 6_000_000;
                const dmgM = libs.mainBattleConfig?.EnemyDmgDifficultyMulti ?? 6_000_000;
                const raw = (battleConfig as any).Waves?.length ? (battleConfig as any).Waves : [battleConfig];
                wavesList = raw.map((w: any) =>
                    mainBattleWaveSpecs(w, ageScaling as any, difficultyMode, hpM, dmgM, enemyLibs)
                );
            }
        }

        // Setup Engine
        if (wavesList.length > 0) {
            newEngine.setNextWaves(wavesList.slice(1));
            newEngine.startWave(wavesList[0]);
        }

        setEngine(newEngine);
        setSnapshot(newEngine.getSnapshot());

        // Handle Auto-Play on Restart
        if (autoPlayRef.current) {
            setIsPlaying(true);
            autoPlayRef.current = false;
        } else {
            setIsPlaying(false);
        }

        setWaveIndex(0);

        // Combat stats for display, from the shared specs. The skill multiplier split is the
        // REAL breakdown from statEngine (skillDamageBreakdown), not an estimate.
        const firstWaveEnemies = wavesList[0] || [];
        const first = firstWaveEnemies[0] as any;
        const enemyDmg = first?.stats?.dmg ?? first?.dmg ?? 0;
        const BUFF_IDS = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);
        const skillDamages = specs
            .filter((sk) => sk.damage > 0 && !BUFF_IDS.has(sk.id))
            .map((sk) => ({ id: sk.id, damage: sk.damage, hits: skillDamageCount(sk.id), damageIsPerHit: false }));
        let buffDmg = 0;
        let buffHp = 0;
        for (const sk of specs) {
            if (BUFF_IDS.has(sk.id)) {
                buffDmg += sk.damage;
                buffHp += sk.health;
            }
        }
        const skillDmgMultiTotal = ((playerStats as any).skillDamageMultiplier || 1) - 1;
        const skillDmgMultiFromStats = (playerStats as any).skillDamageBreakdown?.substats ?? 0;

        setCombatStats({
            playerDamageBase: playerStats.totalDamage,
            playerDamageWithBuff: playerStats.totalDamage + buffDmg,
            buffDamage: buffDmg,
            buffHealth: buffHp,
            enemyDamage: enemyDmg,
            skillDamages,
            skillDmgMultiTotal: skillDmgMultiTotal * 100,
            skillDmgMultiFromTree: (skillDmgMultiTotal - skillDmgMultiFromStats) * 100,
            skillDmgMultiFromStats: skillDmgMultiFromStats * 100
        });

        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isOpen, ageIdx, battleIdx, difficultyMode, libs, playerStats, customWaves, dungeonType, dungeonLevel, restartKey, debugConfig, isDebugMode]);

    // Helper functions setupDungeonWave, setupWave, startWaveLogic removed as we preload everything now


    // Main Loop
    const accumulatorRef = useRef(0);

    useEffect(() => {
        if (!isPlaying || !engine) return;

        let prevTime = performance.now();
        let loopCancelled = false;
        const FIXED_STEP = 1 / 60; // 60 FPS fixed physics step
        const MAX_STEPS = 5; // Max steps per frame to avoid spiral of death

        const loop = (currentTime: number) => {
            if (loopCancelled) return;

            const delta = (currentTime - prevTime) / 1000;
            prevTime = currentTime;

            // Accumulate time scaled by speed
            accumulatorRef.current += delta * speed;

            let steps = 0;
            // Consume accumulator in fixed steps
            while (accumulatorRef.current >= FIXED_STEP && steps < MAX_STEPS) {
                try {
                    engine.tick(FIXED_STEP);
                } catch (e) {
                    console.error("BattleLoop Error:", e);
                    loopCancelled = true;
                    return;
                }
                accumulatorRef.current -= FIXED_STEP;
                steps++;
            }

            // Safety: Discard excess time if we couldn't keep up
            if (accumulatorRef.current > FIXED_STEP * MAX_STEPS) {
                accumulatorRef.current = 0;
            }

            const state = engine.getSnapshot();
            setSnapshot(state);

            // Update logs (throttled/every frame is fine for < 100 items)
            const logs = state.logs || [];
            if (logs.length > 0) {
                const formattedLogs = logs.map((l: any) => `[${l.time.toFixed(1)}s] ${l.event}: ${l.details}`);
                setBattleLogs(formattedLogs);
            }

            // Check End Conditions
            if (state.player.isDead) {
                setBattleOutcome('defeat');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }

            const hasLiveEnemies = state.enemies.some((e: any) => !e.isDead);
            if (!hasLiveEnemies && state.remainingWaves === 0) {
                setBattleOutcome('victory');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }

            if (!loopCancelled) {
                animationFrameRef.current = requestAnimationFrame(loop);
            }
        };

        animationFrameRef.current = requestAnimationFrame(loop);

        return () => {
            loopCancelled = true;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isPlaying, engine, speed, waveIndex, ageIdx, battleIdx, libs]);

    if (!isOpen || !snapshot) return null;

    const { player, enemies, skills, time, isEngaged, engagementTime, waveEngagementTimer } = snapshot;

    // --- Visualization Helpers ---
    // Dynamic viewport that follows the player
    // Game uses: player starts at X=8, enemies spawn at X+15
    // We show a viewport window centered around the action
    // ADAPTIVE VIEWPORT: "si adatta all'input graficamente"
    // "niente min 20, metti la grandezza vera"
    const fieldW = debugConfig?.fieldWidth ?? 28;
    const VIEWPORT_WIDTH = fieldW; // Show the full field width

    // Calculate viewport bounds based on player position
    // Keep player at ~25% from left edge, showing combat ahead
    const viewportStart = Math.max(0, player.position - VIEWPORT_WIDTH * 0.25);

    const worldToScreen = (worldPos: number): number => {
        // Convert world position to screen percentage (5% - 95% to leave margins)
        const normalized = (worldPos - viewportStart) / VIEWPORT_WIDTH;
        return 5 + normalized * 90;
    };

    const getPlayerPosition = () => {
        return worldToScreen(player.position);
    };

    const getEnemyPosition = (enemyPos: number) => {
        return worldToScreen(enemyPos);
    };

    // Format number with dot separators (Italian style: 1.593.590)
    const fmt = (n: number) => Math.round(n).toLocaleString('it-IT');

    // Get title - use same format as main app
    const getTitle = () => {
        if (dungeonType) {
            const world = Math.floor((dungeonLevel || 0) / 10) + 1;
            const stage = ((dungeonLevel || 0) % 10) + 1;
            const typeLabel = dungeonType.charAt(0).toUpperCase() + dungeonType.slice(1);
            return `${typeLabel} ${world}-${stage}`;
        }
        if (ageIdx === -2) {
            const mission = libs.missionBattleLibrary?.[String(battleIdx)];
            return mission ? (mission.MissionTitleId.replace(/([A-Z])/g, ' $1').trim()) : 'Mission';
        }
        // Main battle: format as "Age-Battle" like "5-10" for Age 5, Battle 10
        return `${difficultyMode > 0 ? 'Hard ' : ''}${ageIdx + 1}-${battleIdx + 1}`;
    };

    return (
        <div style={{ margin: '0' }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-[#0d0d11] w-full max-w-4xl max-h-[95vh] rounded-xl border border-gray-800 flex flex-col overflow-hidden shadow-2xl">

                {/* Compact Header */}
                <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-800 bg-[#12121a] flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-white whitespace-nowrap overflow-hidden text-clip">{getTitle()}</h2>
                        <div className="text-[10px] sm:text-xs text-gray-400 flex gap-2 sm:gap-3 flex-wrap">
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {(time || 0).toFixed(1)}s
                            </span>
                            <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                Wave {(snapshot?.waveIndex || 0) + 1}
                            </span>
                            <span className={isEngaged ? "text-red-400 font-semibold" : "text-blue-400"}>
                                {isEngaged ? "⚔️ Combat" : `🏃 ${(engagementTime - waveEngagementTimer).toFixed(1)}s`}
                            </span>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                        {/* Speed buttons - hidden on very small screens */}
                        <div className="flex bg-gray-800/50 rounded-lg p-0.5">
                            {[0.25, 0.5, 1, 1.5, 2].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSpeed(s)}
                                    className={`px-1.5 py-1 rounded text-[10px] sm:text-xs font-bold transition-all ${speed === s ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            disabled={battleOutcome !== 'playing'}
                            className={`p-2 rounded-lg transition-all ${battleOutcome !== 'playing'
                                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                : isPlaying
                                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                }`}
                        >
                            {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
                        </button>

                        <button
                            onClick={onClose}
                            className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>
                </div>

                {/* Debug Inputs (Synced with Parent) */}
                {isDebugMode && debugConfig && onDebugConfigChange && (
                    <div className="px-3 py-2 bg-red-900/10 border-b border-red-500/20 flex flex-wrap gap-4 justify-center items-center text-xs">
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Skill Start (s):</label>
                            <input
                                type="number"
                                step="0.1"
                                value={debugConfig.skillStartupTimer ?? 4.0} // game: hardcoded 4.0s charge
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, skillStartupTimer: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Player Start:</label>
                            <input
                                type="number"
                                step="1"
                                value={debugConfig.playerStartPos ?? 0.0}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, playerStartPos: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Actual Width:</label>
                            <input
                                type="number"
                                step="1"
                                value={debugConfig.fieldWidth ?? 28}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    onDebugConfigChange({
                                        ...debugConfig,
                                        fieldWidth: val,
                                        // Auto-update spawn distances if they match the old field width (convenience)
                                        enemySpawnDistance: val / 2, // Approx logic or just let user set it
                                        enemySpawnDistanceNext: val,
                                    });
                                }}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Spawn Dist:</label>
                            <input
                                type="number"
                                step="1"
                                value={debugConfig.enemySpawnDistance ?? 15}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, enemySpawnDistance: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Next:</label>
                            <input
                                type="number"
                                step="1"
                                value={debugConfig.enemySpawnDistanceNext ?? 15}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, enemySpawnDistanceNext: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">P. Speed:</label>
                            <input
                                type="number"
                                step="0.1"
                                value={debugConfig.playerSpeed ?? debugConfig.walkingSpeed ?? 2.0}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, playerSpeed: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">E. Speed:</label>
                            <input
                                type="number"
                                step="0.1"
                                value={debugConfig.enemySpeed ?? debugConfig.walkingSpeed ?? 2.0}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, enemySpeed: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-red-300 font-bold">Range Mul:</label>
                            <input
                                type="number"
                                step="0.1"
                                value={debugConfig.playerRangeMultiplier ?? 1.0}
                                onChange={(e) => onDebugConfigChange({ ...debugConfig, playerRangeMultiplier: parseFloat(e.target.value) })}
                                className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                            />
                        </div>
                    </div>
                )}

                {/* Combat Stats Panel */}
                {combatStats && (
                    <div className="px-3 py-2 border-b border-gray-800 bg-[#0a0a12]">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs justify-center">
                            <div className="flex items-center gap-1">
                                <Sword className="w-3 h-3 text-orange-400" />
                                <span className="text-gray-400">Player Damage:</span>
                                <span className="text-orange-300 font-bold">{fmt(combatStats.playerDamageBase)}</span>
                                {combatStats.buffDamage > 0 && (
                                    <span className="text-green-400 font-bold">
                                        → {fmt(combatStats.playerDamageWithBuff)}
                                        <span className="text-green-300 text-[10px] ml-1">(+{fmt(combatStats.buffDamage)})</span>
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Shield className="w-3 h-3 text-red-400" />
                                <span className="text-gray-400">Enemy Damage:</span>
                                <span className="text-red-300 font-bold">{fmt(combatStats.enemyDamage)}</span>
                            </div>
                            {ageIdx !== -2 && (
                                <div className="flex items-center gap-1">
                                    <Zap className="w-3 h-3 text-purple-400" />
                                    <span className="text-gray-400">Skill Dmg:</span>
                                    <span className="text-purple-300 font-bold">+{combatStats.skillDmgMultiTotal.toFixed(1)}%</span>
                                    <span className="text-gray-500 text-[10px]">
                                        ({combatStats.skillDmgMultiFromTree.toFixed(1)}% tree, {combatStats.skillDmgMultiFromStats.toFixed(1)}% stats)
                                    </span>
                                </div>
                            )}
                        </div>
                        {ageIdx !== -2 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1 justify-center">
                                {combatStats.skillDamages.map(skill => {
                                    // If damage is already per hit, use it directly. Otherwise divide by hits.
                                    const perHitDamage = skill.damageIsPerHit
                                        ? skill.damage
                                        : (skill.hits > 1 ? skill.damage / skill.hits : skill.damage);
                                    return (
                                        <div key={skill.id} className="flex items-center gap-1">
                                            <Zap className="w-3 h-3 text-yellow-400" />
                                            <span className="text-gray-400">{skill.id}:</span>
                                            <span className="text-yellow-300 font-bold">{fmt(perHitDamage)}</span>
                                            {skill.hits > 1 && <span className="text-gray-500">×{skill.hits}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Battle Outcome Overlay */}
                {battleOutcome !== 'playing' && (
                    <div className={`py-3 text-center font-bold text-lg flex items-center justify-center gap-4 ${battleOutcome === 'victory' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                        <span>{battleOutcome === 'victory' ? 'VICTORY!' : 'DEFEAT'}</span>
                        <button
                            onClick={() => {
                                autoPlayRef.current = true;
                                setRestartKey(k => k + 1);
                            }}
                            className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 4v6h6M23 20v-6h-6" />
                                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                            </svg>
                            Restart
                        </button>
                    </div>
                )}

                {/* Battlefield */}
                <div className="flex-1 bg-[#080810] relative overflow-hidden min-h-[200px] sm:min-h-[280px]">
                    {/* Grid background - scrolls with world movement */}
                    <div className="absolute inset-0 opacity-10"
                        style={{
                            backgroundImage: 'linear-gradient(#444 1px, transparent 1px), linear-gradient(90deg, #444 1px, transparent 1px)',
                            backgroundSize: '40px 40px',
                            backgroundPosition: `${-viewportStart * 30}px 0px`,
                        }}>
                    </div>

                    {/* Ground markers that scroll */}
                    <div className="absolute bottom-[15%] left-0 h-1 opacity-20"
                        style={{
                            width: '200%',
                            backgroundImage: 'repeating-linear-gradient(90deg, #555 0px, #555 5px, transparent 5px, transparent 100px)',
                            transform: `translateX(${-(viewportStart * 30) % 100}px)`,
                        }}>
                    </div>

                    {/* Center line */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-700/30"></div>

                    {/* Player */}
                    <div
                        className="absolute top-1/2 z-50 flex flex-col items-center"
                        style={{ left: `${getPlayerPosition()}%`, transform: `translate(-50%, calc(-50% + ${((snapshot.player as any)?.positionY ?? 0) * 11}px))` }}
                    >
                        {/* Active Buffs Display */}
                        <div className="flex gap-1 mb-1 absolute bottom-full pb-2">
                            {(snapshot.activeBuffs || []).map((buff: any, idx: number) => {
                                const mapping = spriteMapping?.[buff.skillId];
                                if (!mapping) return null; // Or fallback

                                return (
                                    <div key={`${buff.skillId}-${idx}`} className="relative group">
                                        <div className="w-6 h-6 border border-yellow-500 rounded bg-black/50 overflow-hidden relative">
                                            <SpriteSheetIcon
                                                textureSrc={`${basePath}${mapping.texture}`}
                                                spriteWidth={mapping.sprite_size.width}
                                                spriteHeight={mapping.sprite_size.height}
                                                sheetWidth={mapping.texture_size.width}
                                                sheetHeight={mapping.texture_size.height}
                                                iconIndex={mapping.index}
                                                className="w-full h-full"
                                            />
                                            {/* Buff Type Indicator */}
                                            <div className={`absolute bottom-0 right-0 text-[6px] font-bold px-0.5 rounded-tl flex items-center justify-center ${buff.bonusMaxHealth > 0 ? 'bg-green-600' : 'bg-red-600'
                                                } text-white`}>
                                                {buff.bonusMaxHealth > 0 ? 'HP' : 'DMG'}
                                            </div>
                                        </div>
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-black/90 border border-gray-700 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                                            <div className="font-bold text-yellow-400">{buff.skillId}</div>
                                            {buff.bonusMaxHealth > 0 && <span className="block text-green-400">+{fmt(buff.bonusMaxHealth)} HP</span>}
                                            {buff.bonusDamage > 0 && <span className="block text-red-400">+{fmt(buff.bonusDamage)} DMG</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* HP Text (Real Values) */}
                        <span className="text-[9px] sm:text-[10px] font-mono text-gray-300 mb-1 font-bold drop-shadow-md">
                            {Math.round(snapshot.player?.health || 0).toLocaleString()} / {Math.round(snapshot.player?.maxHealth || 0).toLocaleString()}
                        </span>

                        {/* Health Bar */}
                        <div className="w-20 h-2.5 bg-gray-800 rounded-full mb-1 overflow-hidden border border-gray-700 relative">
                            {/* Max Health change indicator */}
                            <div
                                className="h-full bg-green-500"
                                style={{ width: `${Math.max(0, Math.min(100, (snapshot.player?.health || 0) / (snapshot.player?.maxHealth || 1) * 100))}%` }}
                            />
                        </div>

                        {/* Character Sprite */}
                        <div className={`relative ${snapshot.player?.combatPhase === 'CHARGING' ? 'scale-110' : 'scale-100'} transition-transform`}>
                            <ProfileIcon
                                iconIndex={profile?.iconIndex ?? 0}
                                size={48}
                                className="border-2 border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.4)] transform scale-x-[-1] rounded-full bg-gray-900"
                            />
                        </div>
                    </div>
                    {/* Enemies */}
                    {enemies.map((enemy: EntityState, idx: number) => {
                        if (enemy.isDead) return null;
                        const pos = getEnemyPosition(enemy.position);
                        const ehp = Math.max(0, Math.min(100, (enemy.health / (enemy.maxHealth || 1)) * 100));

                        // Get weapon sprite from AutoItemMapping

                        const weaponSpriteKey = enemy.weaponSpriteKey; // e.g. "0_5_0"

                        // Resolve image path using helper
                        let weaponImage = null;
                        if (dungeonType === 'hammer') {
                            // Specific override for hammer
                        } else if (weaponSpriteKey) {
                            const parts = weaponSpriteKey.split('_').map(Number);
                            if (parts.length === 3) {
                                const ageName = AGES[parts[0]];
                                // 5 is Weapon type id
                                if (ageName) {
                                    weaponImage = getItemImage(ageName, 'Weapon', parts[2], autoItemMapping, selectedVersion);
                                }
                            }
                        }

                        // Fallback to simpler spriteName check if key logic fails but spriteName exists and ends in .png (legacy)
                        // But currently spriteName IS the key, so we rely on logic above.

                        return (
                            <div
                                key={idx}
                                className="absolute top-1/2 -translate-y-1/2 z-40"
                                style={{ left: `${pos}%`, transform: `translateX(-50%) translateY(${((enemy as any).positionY ?? 0) * 11}px)` }}
                            >
                                <div className="relative flex flex-col items-center">
                                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full ${enemy.isRanged ? 'bg-purple-600/80' : 'bg-red-600/80'} flex items-center justify-center border-2 ${enemy.isWindingUp ? 'border-yellow-400 animate-pulse' : 'border-gray-700'} overflow-hidden relative shadow-md z-10`}>
                                        {dungeonType === 'hammer' ? (
                                            <SpriteIcon name="Hammer" size={24} />
                                        ) : weaponImage ? (
                                            <img
                                                src={weaponImage}
                                                alt="Weapon"
                                                className="w-6 h-6 sm:w-7 sm:h-7 object-contain"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                                }}
                                            />
                                        ) : (
                                            /* Fallback to SpriteIcon if no texture found */
                                            <SpriteIcon name={enemy.isRanged ? "Bow" : "Sword"} size={20} />
                                        )}
                                        {/* Hidden fallback for error on image load */}
                                        <div className="hidden">
                                            <SpriteIcon name={enemy.isRanged ? "Bow" : "Sword"} size={20} />
                                        </div>
                                    </div>

                                    {/* Staggered HP Bar Group - Below Sprite */}
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 flex flex-col items-center z-20 pointer-events-none"
                                        style={{ marginTop: `${((idx % 4) + 3) * 10}px` }}
                                    >
                                        {/* Connecting Line */}
                                        <div
                                            className="absolute bottom-full left-1/2 w-0.5 bg-white/40"
                                            style={{
                                                height: `${((idx % 4) + 3) * 10}px`,
                                                transform: 'translateX(-50%)'
                                            }}
                                        />

                                        {/* HP Bar */}
                                        <div className="w-8 sm:w-10 h-1 bg-gray-900 rounded-full overflow-hidden border border-gray-600 shadow-sm relative">
                                            <div className="h-full bg-red-500" style={{ width: `${ehp}%` }}></div>
                                        </div>

                                        {/* HP Text */}
                                        <span className="text-[9px] sm:text-[10px] text-gray-200 font-bold drop-shadow-md leading-none bg-black/60 px-1 rounded-sm mt-0.5 border border-black/20">{fmt(enemy.health)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Projectiles */}
                    {(snapshot.projectiles || []).map((proj: Projectile) => {
                        const posPercent = worldToScreen(proj.currentX);
                        // Real vertical position from the engine (ballistic arcs included).
                        const yPx = -((proj as any).currentY ?? 0) * 11;

                        return (
                            <div
                                key={proj.id}
                                className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-20 ${!proj.isPlayerSource ? 'flex-row-reverse' : ''}`}
                                style={{
                                    left: `${posPercent}%`,
                                    transform: `translateX(-50%) translateY(calc(-50% + ${yPx}px))`
                                }}
                            >
                                {/* Trail */}
                                <div className={`w-2 h-1 rounded-full opacity-50 ${proj.isPlayerSource ? 'bg-yellow-300' : 'bg-red-400'}`} />
                                <div className={`w-3 h-1.5 rounded-full opacity-70 ${proj.isPlayerSource ? 'bg-yellow-400' : 'bg-red-500'}`} />
                                {/* Main projectile */}
                                <div className={`w-4 h-4 rounded-full ${proj.isPlayerSource
                                    ? 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,1)]'
                                    : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)]'
                                    }`} />
                            </div>
                        );
                    })}
                </div>

                {/* Bottom Stats & Skills */}
                <div className="border-t border-gray-800 bg-[#0a0a10]">
                    {/* Stats Bar */}
                    {/* All Passive Stats */}
                    <div className="px-3 py-2 border-b border-gray-800/50">
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {/* Row 1: Offensive Basics */}
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" /> Crit %</div>
                                <div className="text-xs font-bold text-yellow-400">{((snapshot.playerStats?.criticalChance || 0) * 100).toFixed(0)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-red-500" /> Crit Dmg</div>
                                <div className="text-xs font-bold text-red-400">x{(snapshot.playerStats?.criticalDamage || 1).toFixed(1)}</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-500" /> Double</div>
                                <div className="text-xs font-bold text-orange-400">{((snapshot.playerStats?.doubleDamageChance || 0) * 100).toFixed(0)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3 text-blue-300" /> Atk Spd</div>
                                <div className="text-xs font-bold text-blue-300">x{(snapshot.playerStats?.attackSpeedMultiplier || 1).toFixed(2)}</div>
                            </div>

                            {/* Row 2: Defensive & Utility */}
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Shield className="w-3 h-3 text-blue-500" /> Block</div>
                                <div className="text-xs font-bold text-blue-400">{((snapshot.playerStats?.blockChance || 0) * 100).toFixed(0)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Heart className="w-3 h-3 text-pink-500" /> Steal</div>
                                <div className="text-xs font-bold text-pink-400">{((snapshot.playerStats?.lifeSteal || 0) * 100).toFixed(1)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Heart className="w-3 h-3 text-green-500" /> Regen</div>
                                <div className="text-xs font-bold text-green-400">{((snapshot.playerStats?.healthRegen || 0) * 100).toFixed(1)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-purple-400" /> Skill Dmg</div>
                                <div className="text-xs font-bold text-purple-400">+{((snapshot.playerStats?.skillDamageMultiplier || 0) * 100).toFixed(0)}%</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3 text-purple-400" /> Skill CD</div>
                                <div className="text-xs font-bold text-purple-400">-{((snapshot.playerStats?.skillCooldownReduction || 0) * 100).toFixed(0)}%</div>
                            </div>
                        </div>
                    </div>

                    {/* Skills */}
                    {skills.length > 0 && ageIdx !== -2 && (
                        <div className="px-3 py-2 flex gap-2 justify-center flex-wrap">
                            {skills.map((skill: any, idx: number) => {
                                const isActive = skill.state === 'Active';
                                const isCooldown = skill.state === 'Cooldown';

                                // Get skill sprite index from ManualSpriteMapping
                                // Get skill sprite index from ManualSpriteMapping
                                const spriteMap = spriteMapping?.skills;
                                const spriteEntry = spriteMap?.mapping
                                    ? Object.entries(spriteMap.mapping).find(([_, info]: [string, any]) => info.name === skill.id)
                                    : null;
                                const spriteIndex = spriteEntry ? parseInt(spriteEntry[0]) : -1;

                                // Get Rarity directly from SkillLibrary
                                const libSkill = skillsConfig ? skillsConfig[skill.id] : null;
                                const rarity = libSkill?.Rarity || 'Common';

                                return (
                                    <div
                                        key={idx}
                                        className={`relative w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center border-2 transition-all overflow-hidden ${isActive ? 'border-green-500 bg-green-900/30' :
                                            isCooldown ? 'border-gray-700 bg-gray-900 opacity-60' :
                                                'border-gray-600 bg-gray-800'
                                            }`}
                                        title={skill.id}
                                        style={getRarityBgStyle(rarity)}
                                    >
                                        {(spriteIndex >= 0 && spriteMapping) ? (
                                            <SpriteSheetIcon
                                                textureSrc={`./Texture2D/${resolveTextureVersion(selectedVersion) ?? selectedVersion}/SkillIcons.png`}
                                                spriteWidth={spriteMapping.skills.sprite_size.width}
                                                spriteHeight={spriteMapping.skills.sprite_size.height}
                                                sheetWidth={spriteMapping.skills.texture_size.width}
                                                sheetHeight={spriteMapping.skills.texture_size.height}
                                                iconIndex={spriteIndex}
                                                className="w-full h-full"
                                            />
                                        ) : (
                                            /* Fallback text */
                                            <span className="text-[10px] text-gray-400 font-bold">{skill.id.substring(0, 3)}</span>
                                        )}
                                        {isCooldown && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-lg">
                                                <span className="text-sm font-bold text-white">{Math.ceil(skill.timer)}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Compact Log */}
                    {/* Compact Log */}
                    <div className="max-h-32 sm:max-h-40 overflow-y-auto px-3 py-2 border-t border-gray-800/50 flex flex-col-reverse">
                        {battleLogs.length === 0 ? (
                            <p className="text-[10px] text-gray-600 italic text-center">Press play to start battle</p>
                        ) : (
                            <div className="space-y-0.5">
                                {battleLogs.map((log, i) => ( // Show ALL logs
                                    <div key={i} className="text-[10px] text-gray-400 font-mono whitespace-nowrap overflow-hidden text-clip">{log}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
