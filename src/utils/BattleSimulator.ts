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
 *  - real enemy scaling: AgeScaling * pow(difficultyMulti, idx), no cancelling magic numbers
 *  - Monte Carlo runs are seeded (1..N), so the same inputs give the same win rate
 */
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
    dungeonWaveSpecs,
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

function buildScene(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    seed: number,
    debugConfig?: DebugConfig,
    context?: BattleContext
): BuiltScene {
    const mgr = new SkillManager(debugConfig?.skillStartupTimer);
    const scene = new CombatScene({ seed, skillSystem: (s) => mgr.execute(s) });

    const spec = playerUnitSpec(playerStats as never, {
        x: debugConfig?.playerStartPos ?? 0,
        y: 0,
    }, context);
    if (debugConfig?.playerSpeed !== undefined) spec.stats.moveSpeed = debugConfig.playerSpeed;
    if (debugConfig?.playerRangeMultiplier) spec.attackRange *= debugConfig.playerRangeMultiplier;
    const player = scene.addUnit(spec);

    if (profile?.skills?.equipped?.length && libs.skillLibrary) {
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
}

function runOnce(
    playerStats: AggregatedStats,
    profile: UserProfile | null,
    libs: LibraryData,
    waves: WaveEnemySpec[][],
    seed: number,
    debugConfig: DebugConfig | undefined,
    maxTicks: number,
    context?: BattleContext
): RunOutcome {
    const { scene, player, mgr } = buildScene(playerStats, profile, libs, seed, debugConfig, context);
    const runner = new WaveRunner(
        scene,
        player,
        applyEnemyDebug(waves, debugConfig),
        { spawnDistance: debugConfig?.enemySpawnDistance ?? 15, maxTicks },
        mgr
    );
    const lite = runner.run();
    return {
        victory: lite.victory,
        ticks: lite.ticks,
        playerHp: lite.playerHp,
        waves: waveResults(waves, lite, player.stats.hpMax),
    };
}

function toResult(
    agg: AggregatedStats,
    outcomes: RunOutcome[],
    extra: Partial<BattleResult>
): BattleResult {
    const wins = outcomes.filter((o) => o.victory).length;
    const representative = outcomes.find((o) => o.victory) ?? outcomes[0];
    return {
        difficultyIdx: 0,
        ...extra,
        waves: representative.waves,
        victory: representative.victory,
        winProbability: (wins / outcomes.length) * 100,
        totalRuns: outcomes.length,
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

const DIFFICULTY_MULTI_FALLBACK = 6_000_000;

function mainWaves(ageIdx: number, battleIdx: number, difficultyIdx: number, libs: LibraryData): WaveEnemySpec[][] | null {
    const battleConfig =
        libs.mainBattleLookup?.[`${ageIdx}-${battleIdx}`] ??
        libs.mainBattleLibrary?.[`{'AgeIdx': ${ageIdx}, 'BattleIdx': ${battleIdx}}`];
    const ageScaling = libs.enemyAgeScalingLibrary?.[String(ageIdx)];
    if (!battleConfig || !ageScaling) return null;
    const hpMulti = libs.mainBattleConfig?.EnemyHpDifficultyMulti ?? DIFFICULTY_MULTI_FALLBACK;
    const dmgMulti = libs.mainBattleConfig?.EnemyDmgDifficultyMulti ?? DIFFICULTY_MULTI_FALLBACK;
    const enemyLibs = {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    };
    const rawWaves = battleConfig.Waves?.length ? battleConfig.Waves : [battleConfig as never];
    return rawWaves.map((w: { Enemies: { Id: number; Count: number }[] | null }) =>
        mainBattleWaveSpecs(w, ageScaling, difficultyIdx, hpMulti, dmgMulti, enemyLibs)
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
        outcomes.push(runOnce(playerStats, profile, libs, waves, seed, debugConfig, DEFAULT_MAX_TICKS, 'main'));
    }
    return toResult(playerStats, outcomes, { ageIdx, battleIdx, difficultyIdx: difficultyMode });
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
        outcomes.push(runOnce(playerStats, profile, libs, waves, seed, debugConfig, DEFAULT_MAX_TICKS, `dungeon:${dungeonType}` as BattleContext));
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
    if (!mission) return null;
    const levelMulti = libs.missionBaseConfig?.HealthAndDamageLevelMultiplier ?? 1.524;
    const maxTicks = Math.round((libs.missionBaseConfig?.MissionBattleMatchTimerSeconds ?? 180) * 10);
    const enemyLibs = {
        enemyLibrary: libs.enemyLibrary as never,
        weaponLibrary: libs.weaponLibrary as never,
        projectilesLibrary: libs.projectilesLibrary as never,
        itemBalancingConfig: libs.itemBalancingConfig,
    };
    const n = runs > 0 ? runs : 100;
    const outcomes: RunOutcome[] = [];
    for (let seed = 1; seed <= n; seed++) {
        // The wave (weapon picks) is rolled per run from the run's own RNG, like the game
        // rolling a fresh mission battle each time.
        const { scene, player, mgr } = buildScene(playerStats, profile, libs, seed, debugConfig, 'mission');
        const wave = missionWaveSpecs(mission as never, level, levelMulti, enemyLibs, scene.rng);
        const runner = new WaveRunner(
            scene,
            player,
            applyEnemyDebug([wave], debugConfig),
            { spawnDistance: debugConfig?.enemySpawnDistance ?? 15, maxTicks },
            mgr
        );
        const lite = runner.run();
        outcomes.push({
            victory: lite.victory,
            ticks: lite.ticks,
            playerHp: lite.playerHp,
            waves: waveResults([wave], lite, player.stats.hpMax),
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
