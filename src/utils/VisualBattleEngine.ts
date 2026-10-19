/**
 * VisualBattleEngine — the visualizer's handle onto the shared engine.
 *
 * Exposes the same surface BattleVisualizerModal used on the old BattleEngine (constructor,
 * addSkill-ish, setNextWaves/startWave, tick(renderDt), getSnapshot) but every number comes
 * from src/engine. Render frames accumulate into the engine's real 0.1 s ticks, so playback
 * speed changes cannot bend the simulation.
 */
import { AggregatedStats } from './statEngine';

/**
 * The visualizer debug panel's knobs. Defaults now come from the engine's real constants;
 * these exist to bend them. (Moved here from the retired BattleEngine.)
 */
export interface DebugConfig {
    skillStartupTimer?: number;
    enemySpawnDistance?: number;
    enemySpawnDistanceNext?: number;
    fieldWidth?: number;

    walkingSpeed?: number; // Legacy, kept for compatibility if needed, but we prefer specific
    playerSpeed?: number;
    enemySpeed?: number;
    playerStartPos?: number;
    playerRangeMultiplier?: number;
}

/** Legacy view-model types kept for the modal's render half. */
export interface EntityState {
    id: number;
    position: number;
    health: number;
    maxHealth: number;
    damage: number;
    attackRange: number;
    isRanged: boolean;
    isDead: boolean;
    isWindingUp: boolean;
    combatPhase: 'IDLE' | 'CHARGING' | 'RECOVERING';
    weaponSpriteKey?: string;
    shield: number;
}

export interface VisualProjectile {
    id: number;
    currentX: number;
    currentY?: number;
    isPlayerSource: boolean;
}
import {
    BattleContext,
    CombatScene,
    MISSION_ENEMY_BASE_X,
    MISSION_PLAYER_RADIUS,
    RandomPCG,
    missionSoloPlayerPosition,
    timerFrames,
    SkillManager,
    SkillSpec,
    Unit,
    UnitSpec,
    WaveEnemySpec,
    describeEvent,
    sceneVisuals,
    playerUnitSpec,
} from '../engine';

/** The old visualizer enemy config, still produced by customWaves callers. */
interface LegacyEnemyConfig {
    id?: number;
    hp: number;
    damagePerHit?: number;
    dmg?: number;
    isRanged?: boolean;
    attackRange?: number;
    windup?: number;
    windupTime?: number;
    attackDuration?: number;
    projectileSpeed?: number;
    weaponSpriteKey?: string;
}

type WaveInput = WaveEnemySpec | LegacyEnemyConfig;

function isSpec(e: WaveInput): e is WaveEnemySpec {
    return (e as WaveEnemySpec).stats !== undefined && (e as WaveEnemySpec).offset !== undefined;
}

export class VisualBattleEngine {
    readonly scene: CombatScene;
    readonly mgr: SkillManager;
    private readonly agg: AggregatedStats;
    private readonly player: Unit;
    private pendingWaves: WaveInput[][] = [];
    private waveIdx = 0;
    private totalWaves = 0;
    private delayTicks: number;
    /**
     * No delay between waves in any mode, like WaveRunner: the main battle's WaveTimer is already
     * negative when a wave is seen cleared, so the next one spawns on the next Update (see
     * WaveRunnerConfig.initialDelay in src/engine/modes.ts).
     */
    private readonly interDelayTicks = 0;
    private readonly spawnDistance: number;
    /** Missions spawn at the absolute X = 15 (MissionCombatScene.SetupEnemies). */
    private readonly absoluteBaseX?: number;
    private readonly isMission: boolean;
    private readonly itemRng: RandomPCG;
    private acc = 0;
    /** Frames the battle may run (mission BattleTimer); past it the battle is lost. */
    private frameLimit = Infinity;

    /**
     * The enemy item stream for missionWaveSpecs: the game builds it with
     * RandomPCG.CreateFromSeed(battleSeed), separate from the combat RNG.
     */
    get rng() {
        return this.itemRng;
    }

    constructor(playerStats: AggregatedStats, debugConfig?: DebugConfig, seed?: number, context?: BattleContext) {
        this.agg = playerStats;
        const battleSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
        this.itemRng = new RandomPCG(battleSeed);
        this.isMission = context === 'mission';
        this.mgr = new SkillManager(debugConfig?.skillStartupTimer);
        this.scene = new CombatScene({
            seed: battleSeed,
            keepEvents: true,
            skillSystem: (s) => this.mgr.execute(s),
        });
        // SetupPlayers groups participants by the combat (skinned) weapon row's IsRanged (0x780EEA4).
        const start = this.isMission ? missionSoloPlayerPosition(!!(playerStats.combatIsRanged ?? playerStats.isRangedWeapon)) : { x: 0, y: 0 };
        const spec = playerUnitSpec(playerStats as never, { x: debugConfig?.playerStartPos ?? start.x, y: start.y }, context);
        if (this.isMission) spec.radius = MISSION_PLAYER_RADIUS;
        if (debugConfig?.playerSpeed !== undefined) spec.stats.moveSpeed = debugConfig.playerSpeed;
        if (debugConfig?.playerRangeMultiplier) spec.attackRange *= debugConfig.playerRangeMultiplier;
        this.player = this.scene.addUnit(spec);
        this.spawnDistance = debugConfig?.enemySpawnDistance ?? 15;
        this.absoluteBaseX = this.isMission ? debugConfig?.enemySpawnDistance ?? MISSION_ENEMY_BASE_X : undefined;
        const isMainBattle = !context || context === 'main';
        this.delayTicks = isMainBattle ? 20 : 0; // 2.0 s before the first main-battle wave (SetupBattle)
    }

    /** Mission BattleTimer: the same frame budget the batch simulator gives WaveRunner. */
    setTimeLimit(seconds: number): void {
        this.frameLimit = timerFrames(seconds);
    }

    /** True once the frame budget ran out with the battle still undecided. */
    get timedOut(): boolean {
        return this.scene.tickCount >= this.frameLimit && !this.player.destroyed;
    }

    /** The equipped mount's collider (UpdateMount); main battles and dungeons only. */
    setPlayerCollider(radius: number, centerOfMass?: { x: number; y: number }, unitOffset?: { x: number; y: number }): void {
        if (this.isMission) return;
        this.player.radius = radius;
        if (centerOfMass) this.player.com = { ...centerOfMass };
        if (unitOffset) this.player.unitOffset = { ...unitOffset };
    }

    /** Mission participants fight without active skills, so skill specs are ignored there. */
    addSkillSpec(spec: SkillSpec): void {
        if (this.isMission) return;
        this.mgr.addSkill(spec);
    }

    setNextWaves(waves: WaveInput[][]): void {
        this.pendingWaves = waves;
        this.totalWaves = this.waveIdx + waves.length;
    }

    startWave(wave: WaveInput[]): void {
        this.totalWaves = Math.max(this.totalWaves, this.waveIdx + 1);
        this.spawn(wave);
        this.waveIdx++;
        this.delayTicks = this.interDelayTicks;
    }

    private spawn(wave: WaveInput[]): void {
        const baseX = this.absoluteBaseX ?? this.player.pos.x + this.spawnDistance;
        wave.forEach((e, i) => {
            if (isSpec(e)) {
                const { offset, ...spec } = e;
                this.scene.addUnit({ ...spec, isAlly: false, pos: { x: baseX + offset.x, y: offset.y } });
            } else {
                // Legacy shape from customWaves callers.
                const spec: UnitSpec = {
                    isAlly: false,
                    pos: { x: baseX + Math.floor(i / 3), y: ((i % 3) - 1) * 1.0 },
                    stats: { hpMax: e.hp, hpMaxNoMulti: e.hp, dmg: e.damagePerHit ?? e.dmg ?? 0 },
                    hp: e.hp,
                    attackRange: e.attackRange ?? (e.isRanged ? 7.0 : 0.3),
                    windupTime: e.windup ?? e.windupTime ?? 0.5,
                    attackDuration: e.attackDuration ?? 1.5,
                    projectile: e.isRanged
                        ? { speed: e.projectileSpeed ?? 15, collisionRadius: 0.2, affectedByGravity: false }
                        : undefined,
                    tag: `enemy:${e.id ?? 0}`,
                    weaponSpriteKey: e.weaponSpriteKey,
                };
                this.scene.addUnit(spec);
            }
        });
    }

    /** Engine ticks run so far: the visualizer takes a new snapshot only when this moves. */
    ticks(): number {
        return this.scene.tickCount;
    }

    /** Render-frame driver: fractional dt accumulates into whole 0.1 s engine ticks. */
    tick(dt: number): void {
        this.acc += dt;
        while (this.acc >= 0.1 - 1e-9) {
            this.acc -= 0.1;
            this.step();
        }
    }

    /**
     * One battle Update. Wave completion and defeat are read from the entity table like the
     * game's GetUnitCounts: a unit killed in a frame is only gone after the next frame's sweep.
     */
    private step(): void {
        if (this.player.destroyed || this.scene.tickCount >= this.frameLimit) return;
        const enemiesPresent = this.scene.units.some((u) => !u.isAlly && !u.destroyed && !u.isSummon);
        if (!enemiesPresent && this.pendingWaves.length > 0) {
            if (this.delayTicks-- <= 0) {
                const wave = this.pendingWaves.shift();
                if (wave) {
                    this.spawn(wave);
                    this.waveIdx++;
                }
                this.delayTicks = this.interDelayTicks;
            }
        }
        this.scene.tick();
        this.mgr.tryAutoActivate(this.scene, true);
    }

    getSnapshot() {
        const unitView = (u: Unit) => ({
            id: u.id,
            position: u.pos.x,
            positionY: u.pos.y,
            health: Math.max(0, u.hp),
            maxHealth: u.stats.hpMax,
            damage: u.stats.dmg,
            damagePerHit: u.stats.dmg,
            attackRange: u.attackRange,
            isRanged: !!u.projectile,
            isDead: u.killed,
            isWindingUp: u.state === 'windingUp',
            combatPhase: u.state === 'windingUp' ? 'CHARGING' : u.state === 'onCooldown' ? 'RECOVERING' : 'IDLE',
            weaponSpriteKey: u.weaponSpriteKey,
            shield: 0,
        });
        const buffIds = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);
        return {
            time: this.scene.tickCount / 10,
            player: unitView(this.player),
            enemies: this.scene.units.filter((u) => !u.isAlly && !u.destroyed).map(unitView),
            skills: this.mgr.snapshot().map((sk) => ({
                id: sk.id,
                state: sk.state === 'ready' ? 'Ready' : sk.state === 'active' ? 'Active' : 'Cooldown',
                timer: sk.secondsLeft,
            })),
            activeEffects: this.scene.areaProjectiles
                .filter((a) => !a.destroyed)
                .map((a) => ({ id: a.id, x: a.pos.x, radius: a.radius, timer: a.timer, duration: a.duration })),
            activeBuffs: this.mgr
                .snapshot()
                .filter((sk) => sk.state === 'active' && buffIds.has(sk.id))
                .map((sk) => ({ skillId: sk.id, bonusDamage: 0, bonusMaxHealth: 0 })),
            projectiles: this.scene.projectiles
                .filter((p) => !p.destroyed)
                .map((p) => ({ id: p.id, currentX: p.pos.x, currentY: p.pos.y, isPlayerSource: p.isAllied })),
            logs: this.scene.events.slice(-100).map((e) => ({
                time: e.tick / 10,
                ...describeEvent(
                    e,
                    (id) => (id === this.player.id ? 'you' : this.scene.units.find((u) => u.id === id)?.isAlly ? 'your Drone' : `enemy #${id}`),
                    (n) => Math.round(n).toLocaleString('en-US')
                ),
            })),
            visuals: sceneVisuals(this.scene, this.mgr),
            remainingWaves: this.pendingWaves.length,
            waveIndex: this.waveIdx - 1,
            playerStats: this.agg,
            isEngaged: this.player.targetInRange,
            engagementTime: this.scene.tickCount / 10,
            waveEngagementTimer: 0,
            timedOut: this.timedOut,
        };
    }
}
