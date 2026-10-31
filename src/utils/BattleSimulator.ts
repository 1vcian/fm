/**
 * BattleSimulator — the page-facing API, now a thin adapter over src/engine.
 *
 * The signatures and result shapes are unchanged (ProgressPrediction, Dungeons, MissionSolo
 * and the visualizer keep working), but every number now comes from the shared tick-accurate
 * engine instead of the old 60 fps approximation. What changed underneath, and why the
 * numbers moved, is documented in docs/combat-model.md; the old simulator's output is frozen
 * in reverseForge/sim_baseline_2026_09_02_09_08.json for comparison.
 *
 * Notable fidelity wins over the old implementation:
 *  - real attack timing (the verified 10 Hz quantisation with breakpoints)
 *  - real geometry: spawns at player.X + 15, move speed 2.0, collisions with attacker
 *    anchoring (melee waves queue up instead of all hitting at once)
 *  - real skill model: 4.0 s initial charge, cooldown from effect end, per-skill hardcoded
 *    areas/timings, buffs that raise max HP without healing per tick, the activation Hp grant
 *  - real enemy scaling: AgeScaling * difficulty multiplier (src/engine/enemies.ts), no cancelling magic numbers
 *  - Monte Carlo runs are seeded (1..N), so the same inputs give the same win rate
 */
import { runSeed } from '../engine/rng';
import { AggregatedStats } from './statEngine';
import { UserProfile } from '../types/Profile';
import {
    BattleResult,
    DungeonLevelConfig,
    LibraryData,
    MissionBattleConfig,
    WaveResult,
} from './BattleHelper';
import {
    CombatScene,
    SkillManager,
    WaveEnemySpec,
    WaveRunner,
    MISSION_ENEMY_BASE_X,
    MISSION_PLAYER_RADIUS,
    dungeonWaveSpecs,
    missionSoloPlayerPosition,
    timerFrames,
    mainBattleWaveSpecs,
    missionWaveSpecs,
    playerUnitSpec,
    skillSpecs,
} from '../engine';
import type { DebugConfig } from './VisualBattleEngine';
import type { BattleContext } from '../engine';

export * from './BattleHelper';

/** Kept for import compatibility; the engine derives buffs from its own skill table. */
export const BUFF_SKILLS = ['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale'];

// ---------------------------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------------------------

interface BuiltScene {
    scene: CombatScene;
    player: ReturnType<CombatScene['addUnit']>;
    mgr: SkillManager;
}

/**
 * The equipped mount's collider (BattleModelExtensions.UpdateMount, 0x77E96EC, run by UpdatePlayer
 * in main battles and dungeons): Radius = ColliderRadius, CenterOfMass and UnitOffSet from the
 * MountLibrary row. Without a mount the unit keeps the defaults (radius 0.35, COM (0, 0.45),
 * UnitOffSet (0, 0)). The radius is part of every range check, so a bigger mount reaches (and is
 * reached) further; UnitOffSet only moves the muzzle of ranged shots (ExecuteAttack 0x77F58C8).
 * PvP (PvpCombatScene.SetupPlayer 0x7852A88) and missions never call UpdateMount.
 */
export function mountCollider(
    profile: UserProfile | null,
    libs: Pick<LibraryData, 'mountLibrary'>
): { radius: number; centerOfMass: { x: number; y: number }; unitOffset: { x: number; y: number } } | null {
    const active = profile?.mount?.active;
    if (!active || !libs.mountLibrary) return null;
    const row = libs.mountLibrary[`{'Rarity': '${active.rarity}', 'Id': ${active.id}}`];
    if (!row || typeof row.ColliderRadius !== 'number') return null;
    return {
        radius: row.ColliderRadius,
        centerOfMass: { x: row.CenterOfMass?.X ?? 0, y: row.CenterOfMass?.Y ?? 0.45 },
        unitOffset: { x: row.UnitOffset?.X ?? 0, y: row.UnitOffset?.Y ?? 0 },
    };
}

type SceneMode = 'main' | 'dungeon' | 'mission';

function buildScene(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    seed: bigint | number,
    debugConfig?: DebugConfig,
    context?: BattleContext,
    mode: SceneMode = 'main'
): BuiltScene {
    const mgr = new SkillManager(debugConfig?.skillStartupTimer);
    const scene = new CombatScene({ seed, skillSystem: (s) => mgr.execute(s) });

    const isMission = mode === 'mission';
    // SetupPlayers groups participants by the combat (skinned) weapon row's IsRanged (0x780EEA4).
    const defaultPos = isMission ? missionSoloPlayerPosition(!!(playerStats.combatIsRanged ?? playerStats.isRangedWeapon)) : { x: 0, y: 0 };
    const spec = playerUnitSpec(playerStats as never, {
        x: debugConfig?.playerStartPos ?? defaultPos.x,
        y: defaultPos.y,
    }, context);
    if (isMission) {
        // SetupPlayerGroup gives every mission participant radius 0.5 and never runs UpdateMount.
        spec.radius = MISSION_PLAYER_RADIUS;
    } else {
        const mount = mountCollider(profile, libs);
        if (mount) {
            spec.radius = mount.radius;
            spec.centerOfMass = mount.centerOfMass;
            spec.unitOffset = mount.unitOffset;
        }
    }
    if (debugConfig?.playerSpeed !== undefined) spec.stats.moveSpeed = debugConfig.playerSpeed;
    if (debugConfig?.playerRangeMultiplier) spec.attackRange *= debugConfig.playerRangeMultiplier;
    const player = scene.addUnit(spec);

    // Mission participants carry no skills (MissionParticipantModel has none and SetupPlayers
    // adds none): the skills' passive stats are in the profile, their actives never fire.
    if (!isMission && profile?.skills?.equipped?.length && libs.skillLibrary) {
        for (const sk of skillSpecs(playerStats as never, profile.skills.equipped, libs.skillLibrary as never)) {
            mgr.addSkill(sk);
        }
    }
    return { scene, player, mgr };
}

function applyEnemyDebug(waves: WaveEnemySpec[][], debugConfig?: DebugConfig): WaveEnemySpec[][] {
    if (debugConfig?.enemySpeed === undefined) return waves;
    return waves.map((w) => w.map((e) => ({ ...e, stats: { ...e.stats, moveSpeed: debugConfig.enemySpeed } })));
}

// ---------------------------------------------------------------------------------------------
// Result assembly (the shape every page reads)
// ---------------------------------------------------------------------------------------------

function waveResults(
    waves: WaveEnemySpec[][],
    lite: { waveLog: { startTick: number; endTick: number; playerHpBefore: number; playerHpAfter: number; survived: boolean }[] },
    playerMaxHp: number
): WaveResult[] {
    return waves.map((wave, i) => {
        const log = lite.waveLog[i];
        const groups: Record<string, { id: number; count: number; damagePerHit: number; isRanged: boolean }> = {};
        let totalHp = 0;
        let totalDps = 0;
        for (const e of wave) {
            const id = Number(String(e.tag ?? '0').split(':')[1] ?? 0);
            const key = `${id}-${e.stats.dmg}`;
            if (!groups[key]) {
                groups[key] = { id, count: 0, damagePerHit: e.stats.dmg ?? 0, isRanged: !!e.projectile || e.attackRange > 1 };
            }
            groups[key].count++;
            totalHp += e.stats.hpMax ?? 0;
            totalDps += (e.stats.dmg ?? 0) / (e.attackDuration || 1.5);
        }
        return {
            waveIndex: i,
            enemies: Object.values(groups),
            totalEnemyHp: totalHp,
            totalEnemyDps: totalDps,
            playerHealthBeforeWave: log?.playerHpBefore ?? (i === 0 ? playerMaxHp : 0),
            playerHealthAfterWave: log?.playerHpAfter ?? 0,
            survived: log?.survived ?? false,
            timeToComplete: log && log.endTick > log.startTick ? (log.endTick - log.startTick) / 10 : 0,
        };
    });
}

function playerStatsBlock(agg: AggregatedStats): BattleResult['playerStats'] {
    const a = agg as unknown as Record<string, number>;
    return {
        effectiveDps: a.realTotalDps ?? a.averageTotalDps ?? a.weaponDps ?? 0,
        effectiveHp: a.totalHealth ?? 0,
        healingPerSecond: a.realTotalHps ?? 0,
        damagePerHit: a.totalDamage ?? 0,
    };
}

interface RunOutcome {
    victory: boolean;
    ticks: number;
    playerHp: number;
    waves: WaveResult[];
    progress?: number;
}

function runOnce(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    waves: WaveEnemySpec[][],
    seed: bigint | number,
    debugConfig: DebugConfig | undefined,
    maxTicks: number,
    context?: BattleContext,
    mode: SceneMode = 'main'
): RunOutcome {
    const { scene, player, mgr } = buildScene(playerStats, profile, libs, seed, debugConfig, context, mode);
    // Dungeon models spawn the first wave in SetupBattle and each next wave on the Update after
    // the previous one is seen cleared: no wave timer (NormalDungeonBattleModel 0x7802ADC/0x78031E0,
    // HammerThiefDungeonBattleModel 0x78022E4).
    const delays = mode === 'main' ? {} : { initialDelay: 0, interWaveDelay: 0 };
    const runner = new WaveRunner(
        scene,
        player,
        applyEnemyDebug(waves, debugConfig),
        { spawnDistance: debugConfig?.enemySpawnDistance ?? 15, maxTicks, ...delays },
        mgr
    );
    const lite = runner.run();
    return {
        victory: lite.victory,
        ticks: lite.ticks,
        playerHp: lite.playerHp,
        waves: waveResults(waves, lite, player.stats.hpMax),
        progress: lite.enemyProgress,
    };
}

function toResult(
    agg: AggregatedStats,
    outcomes: RunOutcome[],
    extra: Partial<BattleResult>
): BattleResult {
    const wins = outcomes.filter((o) => o.victory).length;
    const representative = outcomes.find((o) => o.victory) ?? outcomes[0];
    const losses = outcomes.filter((o) => !o.victory);
    return {
        difficultyIdx: 0,
        ...extra,
        waves: representative.waves,
        victory: representative.victory,
        winProbability: (wins / outcomes.length) * 100,
        totalRuns: outcomes.length,
        lossProgress: losses.length ? losses.reduce((s, o) => s + (o.progress ?? 0), 0) / losses.length : undefined,
        playerHealthRemaining: representative.playerHp,
        totalTime: representative.ticks / 10,
        totalEnemyHp: representative.waves.reduce((s, w) => s + w.totalEnemyHp, 0),
        totalEnemyDps: representative.waves[0]?.totalEnemyDps ?? 0,
        playerStats: playerStatsBlock(agg),
    };
}

// ---------------------------------------------------------------------------------------------
// Wave builders per mode
// ---------------------------------------------------------------------------------------------

function mainWaves(ageIdx: number, battleIdx: number, difficultyIdx: number, libs: LibraryData): WaveEnemySpec[][] | null {
    const battleConfig =
        libs.mainBattleLookup?.[`${ageIdx}-${battleIdx}`] ??
        libs.mainBattleLibrary?.[`{'AgeIdx': ${ageIdx}, 'BattleIdx': ${battleIdx}}`];
    const ageScaling = libs.enemyAgeScalingLibrary?.[String(ageIdx)];
    if (!battleConfig || !ageScaling) return null;
    const enemyLibs = {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    };
    const rawWaves = battleConfig.Waves?.length ? battleConfig.Waves : [battleConfig as never];
    return rawWaves.map((w: { Enemies: { Id: number; Count: number }[] | null }) =>
        mainBattleWaveSpecs(w, ageScaling, difficultyIdx, libs.mainBattleConfig, enemyLibs)
    );
}

function dungeonLibraryFor(type: 'hammer' | 'skill' | 'egg' | 'potion', libs: LibraryData) {
    switch (type) {
        case 'hammer':
            return libs.hammerThiefDungeonBattleLibrary;
        case 'skill':
            return libs.skillDungeonBattleLibrary;
        case 'egg':
            return libs.eggDungeonBattleLibrary;
        case 'potion':
            return libs.potionDungeonBattleLibrary;
    }
}

// ---------------------------------------------------------------------------------------------
// Public API — signatures unchanged
// ---------------------------------------------------------------------------------------------

const DEFAULT_MAX_TICKS = 6000;

export function simulateBattle(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number = 0,
    libs: LibraryData,
    debugConfig?: DebugConfig
): BattleResult | null {
    return simulateBattleMulti(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, 1, debugConfig);
}

export function simulateBattleMulti(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number = 0,
    libs: LibraryData,
    runs: number = 0,
    debugConfig?: DebugConfig
): BattleResult | null {
    const waves = mainWaves(ageIdx, battleIdx, difficultyMode, libs);
    if (!waves) return null;
    const n = runs > 0 ? runs : 100;
    const outcomes: RunOutcome[] = [];
    for (let seed = 1; seed <= n; seed++) {
        outcomes.push(runOnce(playerStats, profile, libs, waves, runSeed(seed), debugConfig, DEFAULT_MAX_TICKS, 'main'));
    }
    return toResult(playerStats, outcomes, { ageIdx, battleIdx, difficultyIdx: difficultyMode });
}

/**
 * Wins of the main battle over the seeds seedFrom..seedTo (inclusive), the same runs
 * simulateBattleMulti makes: lets a caller split one measurement's seeds across threads. Also the
 * sum, over the lost runs, of the share of the battle's enemy HP removed (WaveRunner
 * enemyProgress), so a caller can average it over all the lost runs.
 */
export function mainBattleWins(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number,
    libs: LibraryData,
    seedFrom: number,
    seedTo: number,
    debugConfig?: DebugConfig,
): { wins: number; lostProgress: number } | null {
    const waves = mainWaves(ageIdx, battleIdx, difficultyMode, libs);
    if (!waves) return null;
    let wins = 0, lostProgress = 0;
    for (let seed = seedFrom; seed <= seedTo; seed++) {
        const r = runOnce(playerStats, profile, libs, waves, runSeed(seed), debugConfig, DEFAULT_MAX_TICKS, 'main');
        if (r.victory) wins++;
        else lostProgress += r.progress ?? 0;
    }
    return { wins, lostProgress };
}

/** mainBattleWins for a dungeon level: the same runs simulateDungeonBattleMulti makes. */
export function dungeonBattleWins(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
    level: number,
    libs: LibraryData,
    seedFrom: number,
    seedTo: number,
    debugConfig?: DebugConfig,
): { wins: number; lostProgress: number } | null {
    const row = dungeonLibraryFor(dungeonType, libs)?.[String(level)] as DungeonLevelConfig | undefined;
    if (!row) return null;
    const waves = dungeonWaveSpecs(row, {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    });
    let wins = 0, lostProgress = 0;
    for (let seed = seedFrom; seed <= seedTo; seed++) {
        const r = runOnce(playerStats, profile, libs, waves, runSeed(seed), debugConfig, DEFAULT_MAX_TICKS, `dungeon:${dungeonType}` as BattleContext, 'dungeon');
        if (r.victory) wins++;
        else lostProgress += r.progress ?? 0;
    }
    return { wins, lostProgress };
}

export function simulateDungeonBattle(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
    level: number,
    libs: LibraryData,
    debugConfig?: DebugConfig
): BattleResult | null {
    return simulateDungeonBattleMulti(playerStats, profile, dungeonType, level, libs, 1, debugConfig);
}

export function simulateDungeonBattleMulti(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion',
    level: number,
    libs: LibraryData,
    runs: number = 100,
    debugConfig?: DebugConfig
): BattleResult | null {
    const library = dungeonLibraryFor(dungeonType, libs);
    const row = library?.[String(level)] as DungeonLevelConfig | undefined;
    if (!row) return null;
    const waves = dungeonWaveSpecs(row, {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    });
    const n = runs > 0 ? runs : 100;
    const outcomes: RunOutcome[] = [];
    for (let seed = 1; seed <= n; seed++) {
        outcomes.push(runOnce(playerStats, profile, libs, waves, runSeed(seed), debugConfig, DEFAULT_MAX_TICKS, `dungeon:${dungeonType}` as BattleContext, 'dungeon'));
    }
    return toResult(playerStats, outcomes, { dungeonType, dungeonLevel: level, difficultyIdx: 0 });
}

export function simulateMissionBattle(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    mission: MissionBattleConfig,
    level: number,
    libs: LibraryData,
    debugConfig?: DebugConfig
): BattleResult | null {
    return simulateMissionBattleMulti(playerStats, profile, mission, level, libs, 1, debugConfig);
}

export function simulateMissionBattleMulti(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    mission: MissionBattleConfig,
    level: number,
    libs: LibraryData,
    runs: number = 100,
    debugConfig?: DebugConfig
): BattleResult | null {
    // MissionBaseConfig drives the level multiplier and the timer: no result until it loads.
    const levelMulti = libs.missionBaseConfig?.HealthAndDamageLevelMultiplier;
    const timerSeconds = libs.missionBaseConfig?.MissionBattleMatchTimerSeconds;
    if (!mission || typeof levelMulti !== 'number' || typeof timerSeconds !== 'number') return null;
    // MissionCombatScene.BattleTimer = MissionBattleMatchTimerSeconds, minus dt before each frame;
    // at <= 0 the mission is LOST (Update 0x780DE54): 180 s in 2026_10_08_09_03 -> 1800 frames.
    const maxTicks = timerFrames(timerSeconds);
    const enemyLibs = {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    };
    const n = runs > 0 ? runs : 100;
    const outcomes: RunOutcome[] = [];
    for (let seed = 1; seed <= n; seed++) {
        // Enemy items come from their own RandomPCG built from the battle seed, like the game's
        // RandomPCG.CreateFromSeed in SetupEnemies; the combat RNG is untouched by them.
        const { scene, player, mgr } = buildScene(playerStats, profile, libs, runSeed(seed), debugConfig, 'mission', 'mission');
        const wave = missionWaveSpecs(mission as never, level, levelMulti, enemyLibs, runSeed(seed));
        const runner = new WaveRunner(
            scene,
            player,
            applyEnemyDebug([wave], debugConfig),
            {
                absoluteBaseX: debugConfig?.enemySpawnDistance ?? MISSION_ENEMY_BASE_X,
                initialDelay: 0,
                interWaveDelay: 0,
                maxTicks,
            },
            mgr
        );
        const lite = runner.run();
        outcomes.push({
            victory: lite.victory,
            ticks: lite.ticks,
            playerHp: lite.playerHp,
            waves: waveResults([wave], lite, player.stats.hpMax),
            progress: lite.enemyProgress,
        });
    }
    // battleIdx carries the MissionId: the visualizer modal looks the mission row up again
    // by this value, so omitting it made the modal always render mission 0's loadout.
    return toResult(playerStats, outcomes, { difficultyIdx: level, battleIdx: mission.MissionId });
}

export function calculateWinProbability(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number = 0,
    libs: LibraryData,
    simulations: number = 100
): number {
    const res = simulateBattleMulti(playerStats, profile, ageIdx, battleIdx, difficultyMode, libs, simulations);
    return res ? res.winProbability : 0;
}

export function findMaxBeatableStage(
    playerStats: AggregatedStats,
    libs: LibraryData,
    _minWinProbability: number = 50,
    difficultyMode: number = 0
): { ageIdx: number; battleIdx: number } | null {
    const stages = Object.keys(libs.mainBattleLibrary)
        .map((key) => {
            const age = key.match(/'AgeIdx': (\d+)/);
            const battle = key.match(/'BattleIdx': (\d+)/);
            return { ageIdx: age ? parseInt(age[1]) : 0, battleIdx: battle ? parseInt(battle[1]) : 0 };
        })
        .sort((a, b) => (b.ageIdx !== a.ageIdx ? b.ageIdx - a.ageIdx : b.battleIdx - a.battleIdx));

    for (const stage of stages) {
        const result = simulateBattle(playerStats, null, stage.ageIdx, stage.battleIdx, difficultyMode, libs);
        if (result?.victory) return stage;
    }
    return null;
}

export function findMaxBeatableDungeonStage(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion'
): number {
    const library = dungeonLibraryFor(dungeonType, libs);
    if (!library) return -1;
    const levels = Object.keys(library)
        .map((k) => parseInt(k))
        .sort((a, b) => b - a);
    for (const lvl of levels) {
        const result = simulateDungeonBattle(playerStats, profile, dungeonType, lvl, libs);
        if (result?.victory) return lvl;
    }
    return -1;
}
