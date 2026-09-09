/**
 * Mode adapters: the ONE engine, parameterised.
 *
 * The binary runs the identical CombatScene for every mode; what differs is setup and the
 * stop condition, and that is all this file contains. Sources in docs/combat-model.md.
 *
 *   - main battle / dungeon / mission: waves, no HP multiplier, fight until one side is gone
 *   - pvp: 1v1 at (0,0) vs (18,0), the shared HP multiplier, 60 s timeout where the higher
 *     Hp/HpMax fraction wins. Per the binary this HP rule is the real gameplay difference.
 */
import { CombatScene, SceneConfig } from './scene';
import { SkillManager } from './skills';
import { CombatStatsVec, Unit, UnitSpec, Vec2 } from './types';

// ---------------------------------------------------------------------------------------------
// Formations (FormationBuilder 0x7703084, GuildWar 0x778784c, Mission 0x7706e04)
// ---------------------------------------------------------------------------------------------

/** Main battle: columns of 3 (2 when the wave has 4 or fewer), spacing 1.0, growing away. */
export function mainBattleFormation(count: number, spacing = 1.0): Vec2[] {
    const perCol = count > 4 ? 3 : 2;
    const out: Vec2[] = [];
    for (let i = 0; i < count; i++) {
        const col = Math.floor(i / perCol);
        const j = i % perCol;
        out.push({ x: col * spacing, y: (j - perCol / 2 + 0.5) * spacing });
    }
    return out;
}

/** Missions: columns of 2 (3 when count > 10), Y spacing 1.4, 0.4 X slant per row. */
export function missionFormation(count: number): Vec2[] {
    const perCol = count > 10 ? 3 : 2;
    const out: Vec2[] = [];
    for (let i = 0; i < count; i++) {
        const col = Math.floor(i / perCol);
        const j = i % perCol;
        const stagger = count >= 11 ? 0.5 : 0;
        out.push({ x: col * 1.0 - 0.4 * j, y: (j - perCol / 2) * 1.4 + stagger });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// PvP
// ---------------------------------------------------------------------------------------------

export interface PvpHpConfig {
    PvpHpBaseMultiplier: number; // 1.0
    PvpHpPetMultiplier: number; // 0.5
    PvpHpSkillMultiplier: number; // 0.5
    PvpHpMountMultiplier: number; // 2.0
    PvpMatchTimerSeconds: number; // 60
}

export interface PvpLoadout {
    /** Base health BEFORE the pvp multiplier (the game's PlayerHealth). */
    health: number;
    stats: Partial<CombatStatsVec>;
    attackRange: number;
    windupTime: number;
    attackDuration: number;
    projectile?: UnitSpec['projectile'];
    /** For the shared HP multiplier: m = 1 + 0.5*pets + 0.5*skills + 2*mount. */
    petCount: number;
    skillCount: number;
    hasMount: boolean;
    radius?: number;
    tag?: string;
}

/** m(p) — GetMultiplier (0x77988D0). */
export function pvpHpMultiplier(p: PvpLoadout, cfg: PvpHpConfig): number {
    return (
        cfg.PvpHpBaseMultiplier +
        p.petCount * cfg.PvpHpPetMultiplier +
        p.skillCount * cfg.PvpHpSkillMultiplier +
        (p.hasMount ? 1 : 0) * cfg.PvpHpMountMultiplier
    );
}

export interface PvpSetup {
    scene: CombatScene;
    ally: Unit;
    enemy: Unit;
    maxTicks: number;
}

/**
 * The PvP parameterisation. ONE shared multiplier — the max of the two players' — lands on
 * both units' HpMax while HpMaxNoMulti keeps the raw health (regen scales on it). Spawns at
 * (0,0) vs (18,0); budget PvpMatchTimerSeconds*10 + 100 ticks (0x7798794).
 */
export function setupPvp(a: PvpLoadout, b: PvpLoadout, cfg: PvpHpConfig, scene: CombatScene): PvpSetup {
    const shared = Math.max(pvpHpMultiplier(a, cfg), pvpHpMultiplier(b, cfg));
    const mk = (p: PvpLoadout, isAlly: boolean, x: number): Unit =>
        scene.addUnit({
            isAlly,
            isPlayer: true,
            pos: { x, y: 0 },
            stats: { ...p.stats, hpMax: p.health * shared, hpMaxNoMulti: p.health },
            hp: p.health * shared,
            attackRange: p.attackRange,
            windupTime: p.windupTime,
            attackDuration: p.attackDuration,
            projectile: p.projectile,
            radius: p.radius,
            tag: p.tag,
        });
    return {
        scene,
        ally: mk(a, true, 0),
        enemy: mk(b, false, 18),
        maxTicks: cfg.PvpMatchTimerSeconds * 10 + 100,
    };
}

export type PvpOutcome = 'p1' | 'p2' | 'draw';

/**
 * Run to completion: a death decides it (both in the same tick = draw); at timeout the higher
 * Hp/HpMax FRACTION wins, equal = draw (0x7798128).
 */
export function runPvp(setup: PvpSetup, skills?: SkillManager): { outcome: PvpOutcome; ticks: number } {
    const { scene, ally, enemy, maxTicks } = setup;
    for (let t = 0; t < maxTicks; t++) {
        scene.tick();
        // PvpBattleSimulator.Step order: NextFrame, then activations, ally side first.
        skills?.tryAutoActivate(scene, true);
        skills?.tryAutoActivate(scene, false);
        const aliveA = !ally.killed;
        const aliveB = !enemy.killed;
        if (!aliveA || !aliveB) {
            return { outcome: aliveA ? 'p1' : aliveB ? 'p2' : 'draw', ticks: scene.tickCount };
        }
    }
    const fa = ally.hp / ally.stats.hpMax;
    const fb = enemy.hp / enemy.stats.hpMax;
    return { outcome: fa > fb ? 'p1' : fb > fa ? 'p2' : 'draw', ticks: scene.tickCount };
}

// ---------------------------------------------------------------------------------------------
// Waves (main battle / dungeons / missions)
// ---------------------------------------------------------------------------------------------

export interface WaveEnemySpec extends Omit<UnitSpec, 'isAlly' | 'pos'> {
    /** Formation slot offset from the wave base; assign via mainBattleFormation/missionFormation. */
    offset: Vec2;
}

export interface WaveRunnerConfig {
    /** Enemy base = (player.X + spawnDistance, 0); 15.0 in the binary. */
    spawnDistance?: number;
    /** 2.0 s before the first wave, 1.0 s between waves (0x7736968 / 0x77377E0). */
    initialDelay?: number;
    interWaveDelay?: number;
    maxTicks?: number;
}

export interface WaveLogEntry {
    /** Ticks when the wave spawned and when its last enemy died (or the run ended). */
    startTick: number;
    endTick: number;
    playerHpBefore: number;
    playerHpAfter: number;
    survived: boolean;
}

export interface WaveResultLite {
    victory: boolean;
    ticks: number;
    wavesCleared: number;
    playerHp: number;
    waveLog: WaveLogEntry[];
}

/**
 * Drives waves the way MainBattleModel does: the next wave spawns relative to the player's
 * CURRENT position after a delay, so pushing forward matters exactly as much as in the game.
 */
export class WaveRunner {
    private waveIdx = 0;
    private delayTicks: number;
    private readonly spawnDistance: number;
    private readonly interDelayTicks: number;
    private readonly maxTicks: number;

    constructor(
        private readonly scene: CombatScene,
        private readonly player: Unit,
        private readonly waves: WaveEnemySpec[][],
        cfg: WaveRunnerConfig = {},
        private readonly skills?: SkillManager
    ) {
        this.spawnDistance = cfg.spawnDistance ?? 15;
        this.delayTicks = Math.round((cfg.initialDelay ?? 2.0) * 10);
        this.interDelayTicks = Math.round((cfg.interWaveDelay ?? 1.0) * 10);
        this.maxTicks = cfg.maxTicks ?? 6000;
    }

    run(): WaveResultLite {
        const log: WaveLogEntry[] = [];
        const closeWave = (survived: boolean) => {
            const open = log[log.length - 1];
            if (open && open.endTick < 0) {
                open.endTick = this.scene.tickCount;
                open.playerHpAfter = Math.max(0, this.player.hp);
                open.survived = survived;
            }
        };
        for (let t = 0; t < this.maxTicks; t++) {
            if (this.scene.alive(false).length === 0) {
                closeWave(true);
                if (this.waveIdx >= this.waves.length) {
                    return { victory: true, ticks: this.scene.tickCount, wavesCleared: this.waveIdx, playerHp: this.player.hp, waveLog: log };
                }
                if (this.delayTicks-- <= 0) {
                    log.push({
                        startTick: this.scene.tickCount,
                        endTick: -1,
                        playerHpBefore: this.player.hp,
                        playerHpAfter: this.player.hp,
                        survived: false,
                    });
                    this.spawnWave(this.waves[this.waveIdx++]);
                    this.delayTicks = this.interDelayTicks;
                }
            }
            this.scene.tick();
            // Optimal play = the game's own auto mode: activate everything ready, each tick.
            this.skills?.tryAutoActivate(this.scene, true);
            if (this.player.killed) {
                closeWave(false);
                return { victory: false, ticks: this.scene.tickCount, wavesCleared: this.waveIdx - 1, playerHp: 0, waveLog: log };
            }
        }
        closeWave(false);
        return { victory: false, ticks: this.scene.tickCount, wavesCleared: this.waveIdx - 1, playerHp: this.player.hp, waveLog: log };
    }

    private spawnWave(wave: WaveEnemySpec[]): void {
        const baseX = this.player.pos.x + this.spawnDistance;
        for (const e of wave) {
            const { offset, ...spec } = e;
            this.scene.addUnit({ ...spec, isAlly: false, pos: { x: baseX + offset.x, y: offset.y } });
        }
    }
}

export type { SceneConfig };
