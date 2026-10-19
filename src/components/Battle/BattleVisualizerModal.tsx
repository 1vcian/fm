import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import type { EntityState, VisualProjectile as Projectile, DebugConfig } from '../../utils/VisualBattleEngine';
import { VisualBattleEngine } from '../../utils/VisualBattleEngine';
import { PvpVisualEngine } from '../../pvp/simulate';
import type { PvpFighter } from '../../pvp/fighter';
import type { PvpHpConfig } from '../../engine';
import { dungeonWaveSpecs, mainBattleWaveSpecs, missionWaveSpecs, skillSpecs, skillDamageCount } from '../../engine';
import type { AggregatedStats } from '../../utils/statEngine';
import type { LibraryData } from '../../utils/BattleHelper';
import { stageLabel } from '../../utils/difficulty';
import { calculateProgressDifficultyIdx } from '../../utils/BattleHelper';
import { mountCollider } from '../../utils/BattleSimulator';
import { UserProfile } from '../../types/Profile';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { SpriteIcon } from '../UI/SpriteIcon';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { SkillLayer, BuffAura, type SkillIconSource } from './SkillLayer';
import { BattleCanvas } from './gameView/BattleCanvas';
import { holdFullscreenModal } from '../Layout/donationToast';
import { BattleHud } from './gameView/BattleHud';
import { lookFromProfile, type SceneMode } from './gameView/scene';
import type { BattleVisualData } from './gameView/visualData';
import type { SceneVisuals } from '../../engine/visualSnapshot';
import { Play, Pause, X, Zap, Heart, Sword, Shield, Clock, Users } from 'lucide-react';

const basePath = import.meta.env.BASE_URL;
/** 1.69 -> "1.69", 4658.5 -> "4,658.5": multipliers here span from ~1 to thousands (skill ascension). */
const formatMultiplier = (m: number) => m >= 100 ? m.toLocaleString('en-US', { maximumFractionDigits: 1 }) : m.toFixed(2);
import { getItemImage } from '../../utils/itemAssets';
import { formatNumber } from '../../utils/format';
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
    /**
     * Arena mode: Player 2 takes the enemies' place, with the arena rules (shared HP
     * multiplier, timer, HP % decides a timeout). Everything else is the same visualizer.
     */
    pvp?: { p1: PvpFighter; p2: PvpFighter; cfg: PvpHpConfig; seed: number };
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
    onDebugConfigChange,
    pvp
}) => {
    const { selectedVersion } = useGameDataContext();
    const [engine, setEngine] = useState<{ tick(dt: number): void; getSnapshot(): any; ticks?(): number } | null>(null);
    const [snapshot, setSnapshot] = useState<any>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [waveIndex, setWaveIndex] = useState(0);
    const [battleOutcome, setBattleOutcome] = useState<'playing' | 'victory' | 'defeat' | 'draw'>('playing');
    const [restartKey, setRestartKey] = useState(0); // Used to trigger re-initialization
    // Phone only (below sm): the body is split into a Battle tab and a Log tab. The engine keeps running on both.
    const [mobileTab, setMobileTab] = useState<'battle' | 'log'>('battle');
    // The game-asset battlefield; false once its data failed to load (schematic fallback).
    const [canvasOk, setCanvasOk] = useState(true);
    // Bumped for every new engine, so the canvas scene (camera, pets, labels) starts over.
    const [engineGen, setEngineGen] = useState(0);
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
    const skillRarities = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [type, cfg] of Object.entries((skillsConfig ?? {}) as Record<string, { Rarity?: string }>)) if (cfg?.Rarity) out[type] = cfg.Rarity;
        return out;
    }, [skillsConfig]);

    // Debug State
    const [isDebugMode, setIsDebugMode] = useState(false);
    // Local debugConfig REMOVED - using prop instead

    // Fullscreen: hide the donation toast while the viewer is open and keep it from popping up.
    useEffect(() => (isOpen ? holdFullscreenModal() : undefined), [isOpen]);

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        setIsDebugMode(searchParams.get('debug') === 'true');
    }, []);

    // Initialization
    useEffect(() => {
        if (!isOpen) return;

        // Reset state
        setBattleOutcome('playing');
        setBattleLogs([]);

        if (pvp) {
            const pvpEngine = new PvpVisualEngine(pvp.p1, pvp.p2, pvp.cfg, pvp.seed, playerStats);
            lastTickRef.current = NaN;
            setEngine(pvpEngine);
            setEngineGen(g => g + 1);
            setSnapshot(pvpEngine.getSnapshot());
            setIsPlaying(autoPlayRef.current);
            autoPlayRef.current = false;
            setWaveIndex(0);
            const BUFFS = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);
            let bDmg = 0, bHp = 0;
            for (const sk of pvp.p1.skills) if (BUFFS.has(sk.id)) { bDmg += sk.damage; bHp += sk.health; }
            const total = ((playerStats as any).skillDamageMultiplier || 1) - 1;
            const fromStats = (playerStats as any).skillDamageBreakdown?.substats ?? 0;
            setCombatStats({
                playerDamageBase: pvp.p1.loadout.stats.dmg ?? 0,
                playerDamageWithBuff: (pvp.p1.loadout.stats.dmg ?? 0) + bDmg,
                buffDamage: bDmg,
                buffHealth: bHp,
                enemyDamage: pvp.p2.loadout.stats.dmg ?? 0,
                skillDamages: pvp.p1.skills.filter(sk => sk.damage > 0 && !BUFFS.has(sk.id))
                    .map(sk => ({ id: sk.id, damage: sk.damage, hits: skillDamageCount(sk.id), damageIsPerHit: false })),
                skillDmgMultiTotal: total * 100,
                skillDmgMultiFromTree: (total - fromStats) * 100,
                skillDmgMultiFromStats: fromStats * 100,
            });
            return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
        }
        if (!libs.mainBattleLibrary) return;

        // Create Engine
        // Use debugConfig prop if available, otherwise fallback
        const battleContext: import('../../engine').BattleContext = dungeonType
            ? (`dungeon:${dungeonType}` as import('../../engine').BattleContext)
            : ageIdx === -2
                ? 'mission'
                : 'main';
        const newEngine = new VisualBattleEngine(playerStats, debugConfig, undefined, battleContext);

        // The equipped mount's collider (UpdateMount 0x77E96EC, called from UpdatePlayer 0x77E8E98),
        // resolved exactly like the batch simulator (mountCollider); setPlayerCollider is a no-op in
        // missions, where SetupPlayerGroup keeps radius 0.5.
        const collider = mountCollider(profile, libs);
        if (collider) newEngine.setPlayerCollider(collider.radius, collider.centerOfMass, collider.unitOffset);

        // Skills through the shared resolver (verified layers; the engine owns per-skill
        // mechanics, hit counts and buff behaviour). Not in missions: mission participants carry
        // no active skills (MissionCombatScene.SetupPlayers), same as the batch simulator.
        const specs = battleContext !== 'mission' && profile && libs.skillLibrary
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
            // MissionBaseConfig.HealthAndDamageLevelMultiplier: no waves until it loads.
            const levelMulti = (libs as any).missionBaseConfig?.HealthAndDamageLevelMultiplier;
            if (mission && typeof levelMulti === 'number') {
                wavesList = [missionWaveSpecs(mission, difficultyMode, levelMulti, enemyLibs, newEngine.rng)];
                // MissionBattleMatchTimerSeconds: lost when it runs out, as in simulateMissionBattleMulti.
                const timer = (libs as any).missionBaseConfig?.MissionBattleMatchTimerSeconds;
                if (typeof timer === 'number') newEngine.setTimeLimit(timer);
            }
        } else {
            const battleConfig =
                (libs as any).mainBattleLookup?.[`${ageIdx}-${battleIdx}`] ??
                libs.mainBattleLibrary?.[`{'AgeIdx': ${ageIdx}, 'BattleIdx': ${battleIdx}}`];
            const ageScaling = libs.enemyAgeScalingLibrary?.[String(ageIdx)];
            if (battleConfig && ageScaling) {
                const raw = (battleConfig as any).Waves?.length ? (battleConfig as any).Waves : [battleConfig];
                wavesList = raw.map((w: any) =>
                    mainBattleWaveSpecs(w, ageScaling as any, difficultyMode, libs.mainBattleConfig, enemyLibs)
                );
            }
        }

        // Setup Engine
        // Every wave goes through the engine's own wave timer, so the main battle keeps its 2.0 s
        // before the first wave exactly like the batch simulator (WaveRunner).
        if (wavesList.length > 0) newEngine.setNextWaves(wavesList);

        lastTickRef.current = NaN;
        setEngine(newEngine);
        setEngineGen(g => g + 1);
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
    }, [isOpen, ageIdx, battleIdx, difficultyMode, libs, playerStats, customWaves, dungeonType, dungeonLevel, restartKey, debugConfig, isDebugMode, pvp]);

    // Helper functions setupDungeonWave, setupWave, startWaveLogic removed as we preload everything now


    // Main Loop
    const accumulatorRef = useRef(0);
    const logSigRef = useRef('');
    const lastTickRef = useRef(NaN);

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

            // The battle logic runs at the game's 10 ticks per second: take a snapshot (and re-render
            // the modal) only when a tick has run. The canvas interpolates between them on its own.
            const tickNow = engine.ticks ? engine.ticks() : NaN;
            if (tickNow === lastTickRef.current) {
                if (!loopCancelled) animationFrameRef.current = requestAnimationFrame(loop);
                return;
            }
            lastTickRef.current = tickNow;
            const state = engine.getSnapshot();
            setSnapshot(state);

            // Update logs (throttled/every frame is fine for < 100 items)
            const logs = state.logs || [];
            if (logs.length > 0) {
                // Only when a new line arrived: re-rendering 100 log rows every frame costs frames.
                const last = logs[logs.length - 1];
                const sig = `${logs.length}|${last.time}|${last.details}`;
                if (sig !== logSigRef.current) {
                    logSigRef.current = sig;
                    setBattleLogs(logs.map((l: any) => `[${l.time.toFixed(1)}s] ${l.event}: ${l.details}`));
                }
            }

            // Check End Conditions
            if (state.pvpResult) {
                const r = state.pvpResult;
                setBattleOutcome(r.outcome === 'p1' ? 'victory' : r.outcome === 'p2' ? 'defeat' : 'draw');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }
            if (pvp) {
                if (!loopCancelled) animationFrameRef.current = requestAnimationFrame(loop);
                return;
            }
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
            if (state.timedOut) {
                setBattleOutcome('defeat');
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
    // PvP is a fixed arena: spawns at 0 and 18 around CombatCenter (9,0), Drones 10 units behind
    // each player. Show all of it, centred, instead of following Player 1.
    const VIEWPORT_WIDTH = pvp ? 44 : fieldW; // Show the full field width

    // Calculate viewport bounds based on player position
    // Keep player at ~25% from left edge, showing combat ahead
    // Mission players stand left of 0 (-2 melee / -3 ranged), so the left bound follows them there.
    const viewportStart = pvp ? 9 - VIEWPORT_WIDTH / 2 : Math.max(Math.min(0, player.position - 1), player.position - VIEWPORT_WIDTH * 0.25);

    const worldToScreen = (worldPos: number): number => {
        // Convert world position to screen percentage (5% - 95% to leave margins)
        const normalized = (worldPos - viewportStart) / VIEWPORT_WIDTH;
        return 5 + normalized * 90;
    };

    /** World y is up; 11 px per field unit on screen. */
    const Y_PX = 11;
    const yPx = (y: number) => -y * Y_PX;
    const unitsToPct = (u: number) => (u / VIEWPORT_WIDTH) * 90;
    const visuals: SceneVisuals | null = snapshot.visuals ?? null;
    const sceneMode: SceneMode = pvp ? { kind: 'pvp' }
        : dungeonType ? { kind: 'dungeon', dungeon: (dungeonType as 'hammer' | 'skill' | 'egg' | 'potion') }
        : ageIdx === -2 ? { kind: 'mission', mapAge: Number((libs as any).missionBattleLibrary?.[String(battleIdx)]?.MapAge ?? 0) }
        : { kind: 'main', ageIdx };
    const sceneLooks = (data: BattleVisualData) => pvp
        ? {
            ally: lookFromProfile(data, pvp.p1.profile, { weaponRanged: !!(pvp.p1.stats as any)?.isRangedWeapon }),
            enemy: lookFromProfile(data, pvp.p2.profile, { weaponRanged: !!(pvp.p2.stats as any)?.isRangedWeapon }),
        }
        : { ally: lookFromProfile(data, profile, { weaponRanged: !!(playerStats as any)?.isRangedWeapon, noCompanions: false }) };
    const sceneSeed = (pvp?.seed ?? 0) + ageIdx * 1000 + battleIdx * 7 + (dungeonLevel ?? 0) * 13 + engineGen;
    const skillSheet = spriteMapping?.skills;
    const skillIcons: SkillIconSource | null = skillSheet?.mapping ? {
        textureSrc: `${basePath}Texture2D/${resolveTextureVersion(selectedVersion) ?? selectedVersion}/SkillIcons.png`,
        sheet: skillSheet,
        indexOf: (id: string) => {
            const hit = Object.entries(skillSheet.mapping).find(([, info]: [string, any]) => info.name === id);
            return hit ? parseInt(hit[0]) : -1;
        },
    } : null;

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
        if (pvp) return `${pvp.p1.name} vs ${pvp.p2.name}`;
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
        return stageLabel(difficultyMode, ageIdx, battleIdx);
    };

    const renderSkillRow = (list: any[]) => (
        <>
                            {list.map((skill: any, idx: number) => {
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
                                textureSrc={`${basePath}Texture2D/${resolveTextureVersion(selectedVersion) ?? selectedVersion}/SkillIcons.png`}
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
        </>
    );

    return (
        <div style={{ margin: '0' }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2 sm:p-4">
            <div className="bg-[#0d0d11] w-full max-w-4xl h-[95dvh] sm:h-auto max-h-[95vh] rounded-xl border border-gray-800 flex flex-col overflow-hidden shadow-2xl">

                {/* Compact Header */}
                <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-800 bg-[#12121a] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1.5 sm:gap-2">
                    <div className="w-full sm:w-auto sm:flex-1 min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-white truncate sm:text-clip" title={getTitle()}>{getTitle()}</h2>
                        <div className="text-[10px] sm:text-xs text-gray-400 flex gap-2 sm:gap-3 flex-wrap">
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {(time || 0).toFixed(1)}s
                            </span>
                            {pvp ? (
                                <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    <span className="hidden sm:inline">Timer {pvp.cfg.PvpMatchTimerSeconds}s, shared HP</span>
                                    <span className="sm:hidden">{pvp.cfg.PvpMatchTimerSeconds}s, HP</span>
                                    {' '}x{Number((snapshot.player?.maxHealth / Math.max(1e-9, pvp.p1.loadout.health)).toFixed(2))}
                                </span>
                            ) : (
                            <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                Wave {Math.max(0, snapshot?.waveIndex ?? 0) + 1}
                            </span>
                            )}
                            <span className={isEngaged ? "text-red-400 font-semibold" : "text-blue-400"}>
                                {isEngaged ? "⚔️ Combat" : `🏃 ${(engagementTime - waveEngagementTimer).toFixed(1)}s`}
                            </span>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0 w-full sm:w-auto">
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

                        <div className="flex-1 sm:hidden" />
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

                {/* Phone tabs: Battle and Log */}
                <div className="sm:hidden flex border-b border-gray-800 bg-[#12121a]" role="tablist">
                    {(['battle', 'log'] as const).map(t => (
                        <button
                            key={t}
                            role="tab"
                            aria-selected={mobileTab === t}
                            onClick={() => setMobileTab(t)}
                            className={`flex-1 py-1.5 text-xs font-bold border-b-2 transition-colors ${mobileTab === t ? 'border-blue-500 text-white' : 'border-transparent text-gray-500'}`}
                        >
                            {t === 'battle' ? 'Battle' : `Log${battleLogs.length ? ` (${battleLogs.length})` : ''}`}
                        </button>
                    ))}
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
                    <div className={`px-3 py-2 border-b border-gray-800 bg-[#0a0a12] ${mobileTab === 'log' ? 'hidden sm:block' : ''}`}>
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
                                    <span className="text-purple-300 font-bold">x{formatMultiplier(1 + combatStats.skillDmgMultiTotal / 100)}</span>
                                    {(() => {
                                        // Each stat layer multiplies: (1 + tree) x (1 + substats) x ascension.
                                        const b = (playerStats as any).skillDamageBreakdown ?? {};
                                        return (
                                            <span className="text-gray-500 text-[10px]">
                                                (tree +{((b.tree ?? 0) * 100).toFixed(1)}%, stats +{((b.substats ?? 0) * 100).toFixed(1)}%, ascension x{formatMultiplier(b.ascension || 1)})
                                            </span>
                                        );
                                    })()}
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
                    <div className={`py-3 text-center font-bold text-lg flex items-center justify-center gap-4 ${battleOutcome === 'victory' ? 'bg-green-500/20 text-green-400' : battleOutcome === 'draw' ? 'bg-gray-500/20 text-gray-300' : 'bg-red-500/20 text-red-400'
                        }`}>
                        <span>{pvp
                            ? (battleOutcome === 'draw' ? 'DRAW'
                                : `${(battleOutcome === 'victory' ? pvp.p1.name : pvp.p2.name).toUpperCase()} WINS${snapshot.pvpResult?.timedOut ? ' ON TIME' : ''}`)
                            : battleOutcome === 'victory' ? 'VICTORY!' : 'DEFEAT'}</span>
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

                {/* Battlefield: the game's own sprites, prefabs and VFX on a canvas (gameView/), with the
                    old schematic view as the fallback when the extracted game data is unavailable. */}
                <div className={`flex-1 relative overflow-hidden min-h-[220px] ${canvasOk ? 'sm:min-h-[min(52vh,520px)]' : 'sm:min-h-[300px]'} ${canvasOk ? '' : 'bg-[#080810]'} ${mobileTab === 'log' ? 'hidden sm:block' : ''}`}>
                    {canvasOk ? (
                        <BattleCanvas
                            visuals={visuals}
                            playing={isPlaying}
                            speed={speed}
                            mode={sceneMode}
                            looks={sceneLooks}
                            enemyLibrary={libs.enemyLibrary as any}
                            skillAscension={{ ally: pvp ? (pvp.p1.profile.misc?.skillAscensionLevel ?? 0) : (profile?.misc?.skillAscensionLevel ?? 0), enemy: pvp ? (pvp.p2.profile.misc?.skillAscensionLevel ?? 0) : 0 }}
                            seed={sceneSeed}
                            battleKey={engineGen}
                            onUnavailable={() => setCanvasOk(false)}
                        >
                            <BattleHud
                                title={pvp ? null : getTitle()}
                                waveIndex={Math.max(0, snapshot?.waveIndex ?? 0)}
                                waveCount={pvp ? 0 : Math.max(1, Math.max(0, snapshot?.waveIndex ?? 0) + 1 + (snapshot?.remainingWaves ?? 0))}
                                skills={(visuals?.skills ?? []).filter(k => k.isAlly)}
                                icons={skillIcons}
                                rarities={skillRarities}
                                ascension={pvp ? (pvp.p1.profile.misc?.skillAscensionLevel ?? 0) : (profile?.misc?.skillAscensionLevel ?? 0)}
                                pvp={pvp ? { p1: pvp.p1.name, p2: pvp.p2.name, total: pvp.cfg.PvpMatchTimerSeconds, elapsed: time || 0 } : null}
                            />
                        </BattleCanvas>
                    ) : (<>
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
                        style={{ left: `${getPlayerPosition()}%`, transform: `translate(-50%, calc(-100% + 24px + ${yPx((snapshot.player as any)?.positionY ?? 0)}px))` }}
                    >
                        {/* Active buffs: aura + icons with the time left */}
                        {visuals && <BuffAura buffs={visuals.buffs.ally} icons={skillIcons} />}

                        {/* HP Text (Real Values) */}
                        <span className="text-[9px] sm:text-[10px] font-mono text-gray-300 mb-1 font-bold drop-shadow-md">
                            {pvp
                                ? `${formatNumber(snapshot.player?.health || 0)} / ${formatNumber(snapshot.player?.maxHealth || 0)}`
                                : `${Math.round(snapshot.player?.health || 0).toLocaleString()} / ${Math.round(snapshot.player?.maxHealth || 0).toLocaleString()}`}
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
                    {/* Player 2 in PvP: drawn as a player, like Player 1 */}
                    {pvp && enemies[0] && !enemies[0].isDead && (() => {
                        const p2 = enemies[0];
                        return (
                            <div className="absolute top-1/2 z-40 flex flex-col items-center"
                                style={{ left: `${worldToScreen(p2.position)}%`, transform: `translate(-50%, calc(-100% + 24px + ${yPx((p2 as any).positionY ?? 0)}px))` }}>
                                {visuals && <BuffAura buffs={visuals.buffs.enemy} icons={skillIcons} />}
                                <span className="text-[9px] sm:text-[10px] font-mono text-gray-300 mb-1 font-bold drop-shadow-md">
                                    {formatNumber(p2.health)} / {formatNumber(p2.maxHealth)}
                                </span>
                                <div className="w-20 h-2.5 bg-gray-800 rounded-full mb-1 overflow-hidden border border-gray-700">
                                    <div className="h-full bg-red-500" style={{ width: `${Math.max(0, Math.min(100, (p2.health / (p2.maxHealth || 1)) * 100))}%` }} />
                                </div>
                                <div className={`relative ${p2.combatPhase === 'CHARGING' ? 'scale-110' : 'scale-100'} transition-transform`}>
                                    <ProfileIcon iconIndex={pvp.p2.profile.iconIndex ?? 0} size={48}
                                        className="border-2 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] rounded-full bg-gray-900" />
                                </div>
                            </div>
                        );
                    })()}

                    {/* Enemies */}
                    {!pvp && enemies.map((enemy: EntityState, idx: number) => {
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
                                style={{ left: `${pos}%`, transform: `translateX(-50%) translateY(calc(-50% + ${yPx((enemy as any).positionY ?? 0)}px))` }}
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

                    {/* Skills, shots, Drones and hits, straight from the engine */}
                    {visuals && <SkillLayer visuals={visuals} worldToScreen={worldToScreen} unitsToPct={unitsToPct} yPx={yPx} icons={skillIcons} />}
                                    </>)}
                </div>

                {/* Bottom Stats & Skills */}
                <div className={`border-t border-gray-800 bg-[#0a0a10] ${mobileTab === 'log' ? 'flex-1 min-h-0 flex flex-col sm:block sm:flex-none' : ''}`}>
                    {/* Stats Bar */}
                    {/* All Passive Stats */}
                    <div className={`px-3 py-2 border-b border-gray-800/50 ${mobileTab === 'log' ? 'hidden sm:block' : ''}`}>
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
                                <div className="text-xs font-bold text-purple-400">x{formatMultiplier(snapshot.playerStats?.skillDamageMultiplier || 1)}</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <div className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3 text-purple-400" /> Skill CD</div>
                                <div className="text-xs font-bold text-purple-400">-{((snapshot.playerStats?.skillCooldownReduction || 0) * 100).toFixed(0)}%</div>
                            </div>
                        </div>
                    </div>

                    {/* Skills */}
                    {skills.length > 0 && ageIdx !== -2 && !canvasOk && (
                        <div className={`px-3 py-2 flex gap-2 justify-center flex-wrap items-center ${mobileTab === 'log' ? 'hidden sm:flex' : ''}`}>
                            {pvp && <span className="text-[10px] font-bold text-blue-300 mr-1">{pvp.p1.name}</span>}
                            {renderSkillRow(skills)}
                        </div>
                    )}
                    {pvp && (snapshot.enemySkills || []).length > 0 && (
                        <div className={`px-3 pb-2 flex gap-2 justify-center flex-wrap items-center ${mobileTab === 'log' ? 'hidden sm:flex' : ''}`}>
                            <span className="text-[10px] font-bold text-red-300 mr-1">{pvp.p2.name}</span>
                            {renderSkillRow(snapshot.enemySkills)}
                        </div>
                    )}

                    {/* Compact Log: on phone it lives in the Log tab and fills the body */}
                    <div className={`overflow-y-auto px-3 py-2 border-t border-gray-800/50 flex-col-reverse sm:flex sm:max-h-40 ${mobileTab === 'log' ? 'flex flex-1 min-h-0 sm:flex-none' : 'hidden'}`}>
                        {battleLogs.length === 0 ? (
                            <p className="text-[10px] text-gray-600 italic text-center">Press play to start battle</p>
                        ) : (
                            <div className="space-y-0.5">
                                {battleLogs.map((log, i) => ( // Show ALL logs
                                    <div key={i} className={`text-[10px] text-gray-400 font-mono ${mobileTab === 'log' ? 'break-words sm:whitespace-nowrap sm:overflow-hidden sm:text-clip' : 'whitespace-nowrap overflow-hidden text-clip'}`}>{log}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
