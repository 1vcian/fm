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

/**
 * MissionFormationBuilder.GetPositions (0x77AF1B0). maxPerCol = count > 10 ? 3 : 2, and the
 * columns ALTERNATE between maxPerCol and maxPerCol - 1 units (n = min(maxPerCol - col % 2,
 * remaining)). Unit j of column col sits at
 *   x = col - 0.4 * j
 *   y = (j - n / 2 + c) * 1.4 + (count >= 11 ? 0.5 : 0),  c = 0.5 when n % 2 == col % 2, else 0
 * (n / 2 is fractional). Six units therefore make four columns 2-1-2-1, not three columns of 2.
 */
export function missionFormation(count: number): Vec2[] {
    const maxPerCol = count > 10 ? 3 : 2;
    const yShift = count >= 11 ? 0.5 : 0;
    const out: Vec2[] = [];
    let remaining = count;
    for (let col = 0; remaining > 0; col++) {
        const n = Math.min(maxPerCol - (col % 2), remaining);
        const c = n % 2 === col % 2 ? 0.5 : 0;
        for (let j = 0; j < n; j++) out.push({ x: col - 0.4 * j, y: (j - n / 2 + c) * 1.4 + yShift });
        remaining -= n;
    }
    return out;
}

/**
 * Where a mission participant stands (MissionCombatScene.SetupPlayers 0x780E5A0 ->
 * SetupPlayerGroup 0x780EB60 -> GuildWarFormationBuilder.GetPositions 0x783FB1C, ally side).
 * Melee members form the first group at xOffset 2; ranged members the second group at
 * xOffset = (columns used by the melee group) + 2 + 1. A lone player is the only unit of its
 * group, so it stands at (-2, 0) with a melee weapon and at (-3, 0) with a ranged one.
 */
export function missionSoloPlayerPosition(isRanged: boolean): Vec2 {
    return { x: isRanged ? -3 : -2, y: 0 };
}

/** Mission participants' collider radius: SetupPlayerGroup writes F64.Ratio100(50) = 0.5. */
export const MISSION_PLAYER_RADIUS = 0.5;

/** Mission enemies spawn at the absolute base (15, 0) (MissionCombatScene.SetupEnemies). */
export const MISSION_ENEMY_BASE_X = 15;

/** dt in Q32.32: F64.Ratio(1, 10). */
const DT_RAW_Q32 = 429_496_729;

/**
 * Frames a battle timer of `seconds` lets run: the game subtracts dt BEFORE the frame and stops
 * once the timer is <= 0, so a T-second timer runs ceil(T * 2^32 / dt_raw) - 1 frames
 * (60 s -> 600, 180 s -> 1800).
 */
export function timerFrames(seconds: number): number {
    return Math.ceil((seconds * 4294967296) / DT_RAW_Q32) - 1;
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
    /** PvpMatchTimerSeconds: the BattleTimer runPvp counts down. */
    timerSeconds: number;
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
        timerSeconds: cfg.PvpMatchTimerSeconds,
    };
}

export type PvpOutcome = 'p1' | 'p2' | 'draw';

/**
 * Run to completion, the way PvpCombatScene.Update (0x78520AC) does it, one Update per step:
 *   1. both players are looked up in the entity table (IsKilled is not read). A player killed in
 *      frame N is removed at the start of frame N+1, so the death is seen one Update later;
 *      whoever is missing loses, both missing = draw.
 *   2. BattleTimer (PvpMatchTimerSeconds) -= dt; at <= 0 the higher Hp/HpMax fraction wins,
 *      equal = draw, and no frame runs: 600 frames for 60 s (timerFrames).
 *   3. NextFrame, then TryActivateSkills(ally), TryActivateSkills(enemy) (PvpBattleSimulator.Step).
 * maxTicks (PvpMatchTimerSeconds*10 + 100) is only the simulator's outer safety cap.
 * src/pvp/simulate.ts PvpBattle implements the same loop for the PvP page.
 */
export function runPvp(setup: PvpSetup, skills?: SkillManager): { outcome: PvpOutcome; ticks: number } {
    const { scene, ally, enemy, maxTicks } = setup;
    const frames = Math.min(timerFrames(setup.timerSeconds), maxTicks);
    for (let t = 0; ; t++) {
        if (ally.destroyed || enemy.destroyed) {
            const outcome: PvpOutcome = ally.destroyed && enemy.destroyed ? 'draw' : ally.destroyed ? 'p2' : 'p1';
            return { outcome, ticks: scene.tickCount };
        }
        if (t >= frames) break;
        scene.tick();
        skills?.tryAutoActivate(scene, true);
        skills?.tryAutoActivate(scene, false);
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
    /** Missions: enemies spawn at this absolute X instead of relative to the player. */
    absoluteBaseX?: number;
    /**
     * Seconds before the first wave and between waves. Main battle: 2.0 / 0. SetupBattle
     * (0x77EAB50) sets WaveTimer = 2.0 when delayStart, else 0. Update (0x77EBBC4) runs
     * WaveTimer -= dt, then StartWave (0x77EB2A8) when WaveTimer < 0 and State is ReadyToStartWave
     * or WaveFinished; StartWave turns WaveFinished into the next wave (idx++, Ready, SetupEnemies,
     * Running). The timer is never reset while Running, so it is already negative when a wave is
     * seen cleared and the next wave spawns on the very next Update. The `WaveTimer = 1.0` store
     * for State == WaveFinished in Update sits after StartWave and is never reached with a
     * non negative timer. Dungeons and missions: 0 / 0, their models spawn the first wave in
     * SetupBattle and the next one on the Update right after a wave is seen cleared
     * (NormalDungeonBattleModel.Update 0x78031E0).
     */
    initialDelay?: number;
    interWaveDelay?: number;
    /** Frames the battle may run; past it the battle is lost (mission BattleTimer, safety cap elsewhere). */
    maxTicks?: number;
}

export interface WaveLogEntry {
    /** Ticks when the wave spawned and when it was seen cleared (or the run ended). */
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
 * Drives waves the way the PvE battle models do. After every frame the model counts the units
 * still in the entity table per side, skill summons excluded (CombatScene.GetUnitCounts
 * 0x77EC59C, IsKilled NOT read). A unit killed in frame N stays in the table until the sweep at
 * the start of frame N+1, so a death is seen one frame late: the frame after the last kill still
 * runs (projectiles in flight can land, regen ticks) before the wave counts as cleared. No ally
 * left = lost, checked before the enemy side (so a mutual last kill is a loss).
 */
export class WaveRunner {
    private waveIdx = 0;
    private delayTicks: number;
    private readonly spawnDistance: number;
    private readonly absoluteBaseX?: number;
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
        this.absoluteBaseX = cfg.absoluteBaseX;
        this.delayTicks = Math.round((cfg.initialDelay ?? 2.0) * 10);
        this.interDelayTicks = Math.round((cfg.interWaveDelay ?? 0) * 10);
        this.maxTicks = cfg.maxTicks ?? 6000;
    }

    /** GetUnitCounts: units of a side still in the table, summons excluded. */
    private present(isAlly: boolean): number {
        let n = 0;
        for (const u of this.scene.units) if (u.isAlly === isAlly && !u.destroyed && !u.isSummon) n++;
        return n;
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
        let waveActive = false;
        const result = (victory: boolean): WaveResultLite => ({
            victory,
            ticks: this.scene.tickCount,
            wavesCleared: victory ? this.waves.length : Math.max(0, this.waveIdx - (waveActive ? 1 : 0)),
            playerHp: victory ? this.player.hp : Math.max(0, this.player.hp),
            waveLog: log,
        });
        if (this.waves.length === 0) return result(true);
        for (let t = 0; t < this.maxTicks; t++) {
            if (!waveActive && this.delayTicks-- <= 0) {
                log.push({
                    startTick: this.scene.tickCount,
                    endTick: -1,
                    playerHpBefore: this.player.hp,
                    playerHpAfter: this.player.hp,
                    survived: false,
                });
                this.spawnWave(this.waves[this.waveIdx++]);
                this.delayTicks = this.interDelayTicks;
                waveActive = true;
            }
            this.scene.tick();
            // Optimal play = the game's own auto mode: activate everything ready, each tick.
            this.skills?.tryAutoActivate(this.scene, true);
            if (this.present(true) === 0) {
                closeWave(false);
                return result(false);
            }
            if (waveActive && this.present(false) === 0) {
                closeWave(true);
                waveActive = false;
                if (this.waveIdx >= this.waves.length) return result(true);
            }
        }
        closeWave(false);
        return result(false);
    }

    private spawnWave(wave: WaveEnemySpec[]): void {
        const baseX = this.absoluteBaseX ?? this.player.pos.x + this.spawnDistance;
        for (const e of wave) {
            const { offset, ...spec } = e;
            this.scene.addUnit({ ...spec, isAlly: false, pos: { x: baseX + offset.x, y: offset.y } });
        }
    }
}

export type { SceneConfig };
