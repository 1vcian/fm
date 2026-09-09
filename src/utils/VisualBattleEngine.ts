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
    SkillManager,
    SkillSpec,
    Unit,
    UnitSpec,
    WaveEnemySpec,
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
    private readonly interDelayTicks = 10; // 1.0 s between waves (0x77377E0)
    private readonly spawnDistance: number;
    private acc = 0;

    get rng() {
        return this.scene.rng;
    }

    constructor(playerStats: AggregatedStats, debugConfig?: DebugConfig, seed?: number, context?: BattleContext) {
        this.agg = playerStats;
        this.mgr = new SkillManager(debugConfig?.skillStartupTimer);
        this.scene = new CombatScene({
            seed: seed ?? Math.floor(Math.random() * 2 ** 31),
            keepEvents: true,
            skillSystem: (s) => this.mgr.execute(s),
        });
        const spec = playerUnitSpec(playerStats as never, { x: debugConfig?.playerStartPos ?? 0, y: 0 }, context);
        if (debugConfig?.playerSpeed !== undefined) spec.stats.moveSpeed = debugConfig.playerSpeed;
        if (debugConfig?.playerRangeMultiplier) spec.attackRange *= debugConfig.playerRangeMultiplier;
        this.player = this.scene.addUnit(spec);
        this.spawnDistance = debugConfig?.enemySpawnDistance ?? 15;
        this.delayTicks = 20; // 2.0 s before the first wave (0x7736968)
    }

    addSkillSpec(spec: SkillSpec): void {
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
        const baseX = this.player.pos.x + this.spawnDistance;
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

    /** Render-frame driver: fractional dt accumulates into whole 0.1 s engine ticks. */
    tick(dt: number): void {
        this.acc += dt;
        while (this.acc >= 0.1 - 1e-9) {
            this.acc -= 0.1;
            this.step();
        }
    }

    private step(): void {
        if (this.player.killed) return;
        if (this.scene.alive(false).length === 0 && this.pendingWaves.length > 0) {
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
                event: e.heal ? 'Heal' : e.dodged ? 'Dodge' : e.blocked ? 'Block' : e.critical ? 'Crit' : 'Hit',
                details: `${Math.round(e.dmg).toLocaleString()} (#${e.targetId})`,
            })),
            remainingWaves: this.pendingWaves.length,
            waveIndex: this.waveIdx - 1,
            playerStats: this.agg,
            isEngaged: this.player.targetInRange,
            engagementTime: this.scene.tickCount / 10,
            waveEngagementTimer: 0,
        };
    }
}
