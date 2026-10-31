/**
 * Arena (PvP) battles on the shared combat engine, as PvpCombatScene runs them (build 2026_10).
 * All coefficients below are PvpBaseConfig.json fields, read at runtime (pvpConfigFromJson):
 *
 *   HP multiplier  m(p) = PvpHpBaseMultiplier + PvpHpPetMultiplier * equipped pets
 *                       + PvpHpSkillMultiplier * equipped skills + PvpHpMountMultiplier * (mount ? 1 : 0)
 *                  ONE shared value, max(m(p1), m(p2)), on both players (Init, 0x785178C).
 *                  HpMax = base * shared, HpMaxNoMulti = base (regen scales on it); damage gets none.
 *   spawns         (0,0) vs (18,0)
 *   each step      scene update, then TryActivateSkills(ally), then TryActivateSkills(enemy):
 *                  every ready skill fires as soon as it is off cooldown
 *   end            a death decides it (both killed in the same frame = draw), seen by Update one
 *                  step later as a missing player. Otherwise BattleTimer starts at
 *                  PvpMatchTimerSeconds and loses dt per Update, BEFORE the frame; when it reaches
 *                  0 the higher Hp/HpMax fraction wins, equal = draw, and that Update runs no frame.
 *                  RunToCompletion also hard-caps the run at PvpMatchTimerSeconds*10 + 100 steps.
 *   in-tick order  units act in table (insertion) order, Player 1 first (Init 0x785178C calls
 *                  SetupPlayer(ally) before SetupPlayer(enemy); MetaDictionary iterates in
 *                  insertion order), and ApplyDmg (0x77F4BD0) applies damage, lifesteal
 *                  (min(Hp + heal, HpMax)) and reflect at once. The game is sequential, not
 *                  simultaneous: the side acting first wastes lifesteal/regen clamped at full HP
 *                  that the second side banks, a small structural Player 2 edge with lifesteal.
 *   sides          the local player is Player 1: UiContextExtensions.StartLocalPvpBattle (0x3EB4A10)
 *                  calls RunToCompletion (0x78526A4) with player1 = GetPvpProfile(own PlayerModel)
 *                  (0x77F9914) and player2 = the opponent, seed = ToUInt64(Guid.NewGuid()).
 *   RNG            one RandomPCG per battle for all combat rolls, both sides in call order
 *                  (AttacksSystem ctor 0x77F32D0 -> CreateFromSeed 0x72CB9CC, built once in
 *                  CombatScene ctor 0x77EAE68); skill jitter is the unseeded shared PseudoRandom.
 *
 * dt is F64.Ratio(1, 10) = floor(2^32/10) / 2^32, a hair under 0.1 s, so a 60 s timer reaches 0 on
 * Update 601: frames 1..600 run, Update 601 decides.
 */
import { runSeed } from '../engine/rng';
import { CombatScene, SkillManager, describeEvent, sceneVisuals, setupPvp, type PvpHpConfig, type PvpSetup, type Unit } from '../engine';
import type { PvpFighter } from './fighter';

/**
 * The arena rules from PvpBaseConfig.json of the selected version. Every coefficient comes from
 * the config, never from a constant here: null until a complete config is loaded.
 */
export function pvpConfigFromJson(json: any): PvpHpConfig | null {
    const keys = ['PvpHpBaseMultiplier', 'PvpHpPetMultiplier', 'PvpHpSkillMultiplier', 'PvpHpMountMultiplier', 'PvpMatchTimerSeconds'] as const;
    if (!json || keys.some(k => typeof json[k] !== 'number')) return null;
    return Object.fromEntries(keys.map(k => [k, json[k]])) as unknown as PvpHpConfig;
}

const DT_RAW = 429_496_729; // floor(2^32 / 10)
const TWO_32 = 4_294_967_296;

/** Steps until BattleTimer <= 0, in the game's Q32.32 arithmetic. */
export function timerSteps(seconds: number): number {
    return Math.ceil((seconds * TWO_32) / DT_RAW);
}

export type PvpOutcome = 'p1' | 'p2' | 'draw';

export interface PvpRunResult {
    outcome: PvpOutcome;
    seconds: number;
    timedOut: boolean;
    /** Remaining HP fraction at the end, per player. */
    p1HpFrac: number;
    p2HpFrac: number;
}

export interface PvpBatchResult {
    runs: number;
    p1Wins: number;
    p2Wins: number;
    draws: number;
    timeouts: number;
    avgSeconds: number;
    avgP1HpFrac: number;
    avgP2HpFrac: number;
    /** The shared HP multiplier both players fought with. */
    hpMultiplier: number;
}

/** One battle, steppable for the visual replay and run to the end for the batch. */
export class PvpBattle {
    readonly scene: CombatScene;
    readonly skills: SkillManager;
    readonly setup: PvpSetup;
    readonly hpMultiplier: number;
    private readonly timeoutStep: number;
    private readonly hardCap: number;
    private step = 0;
    /** PvpCombatScene.Update calls so far (each decrements BattleTimer by dt). */
    private updates = 0;
    result: PvpRunResult | null = null;

    constructor(p1: PvpFighter, p2: PvpFighter, cfg: PvpHpConfig, seed: bigint | number = 1, keepEvents = false) {
        this.skills = new SkillManager();
        this.scene = new CombatScene({ seed, keepEvents, skillSystem: s => this.skills.execute(s) });
        this.setup = setupPvp(p1.loadout, p2.loadout, cfg, this.scene);
        this.hpMultiplier = this.setup.ally.stats.hpMax / Math.max(1e-9, p1.loadout.health);
        this.setup.ally.weaponSpriteKey = p1.weaponSpriteKey;
        this.setup.enemy.weaponSpriteKey = p2.weaponSpriteKey;
        for (const s of p1.skills) this.skills.addSkill({ ...s, isAlly: true });
        for (const s of p2.skills) this.skills.addSkill({ ...s, isAlly: false });
        this.timeoutStep = timerSteps(cfg.PvpMatchTimerSeconds);
        this.hardCap = this.setup.maxTicks;
    }

    get ally(): Unit { return this.setup.ally; }
    get enemy(): Unit { return this.setup.enemy; }
    get seconds(): number { return this.step / 10; }
    get done(): boolean { return this.result !== null; }

    /**
     * One PvpBattleSimulator.Step (0x784C5A4): PvpCombatScene.Update (0x78520AC), then
     * TryActivateSkills(ally), TryActivateSkills(enemy). Update itself, in order:
     *   1. TryGetPlayerEntity for both sides: a plain table lookup, IsKilled is not read. A player
     *      killed in frame N is removed at the start of frame N+1, so the death is only seen here
     *      one Update later; whoever is missing loses, both missing = draw (Party1Win/Party2Win/Draw).
     *   2. BattleTimer -= dt; if BattleTimer <= 0 the higher Hp/HpMax wins, equal = draw, and no
     *      frame runs. The timer starts at PvpMatchTimerSeconds (exact), so a 60 s match runs
     *      exactly 600 frames and is decided on Update 601.
     *   3. otherwise CombatScene.NextFrame.
     * Returns the result once the battle has ended.
     */
    tick(): PvpRunResult | null {
        if (this.result) return this.result;
        const { ally, enemy } = this.setup;
        const frac = (u: Unit) => Math.max(0, u.hp) / u.stats.hpMax;
        // Removed = killed in a frame that has since been followed by another frame's sweep.
        if (ally.destroyed || enemy.destroyed) {
            const outcome: PvpOutcome = ally.destroyed && enemy.destroyed ? 'draw' : ally.destroyed ? 'p2' : 'p1';
            this.result = { outcome, seconds: this.seconds, timedOut: false, p1HpFrac: frac(ally), p2HpFrac: frac(enemy) };
            return this.result;
        }
        this.updates += 1;
        if (this.updates >= this.timeoutStep || this.updates >= this.hardCap) {
            // Raw FD6 Hp / HpMax: a unit killed in the last frame is still in the table here.
            const fa = ally.hp / ally.stats.hpMax, fb = enemy.hp / enemy.stats.hpMax;
            const outcome: PvpOutcome = fa > fb ? 'p1' : fb > fa ? 'p2' : 'draw';
            this.result = { outcome, seconds: this.seconds, timedOut: true, p1HpFrac: frac(ally), p2HpFrac: frac(enemy) };
            return this.result;
        }
        this.scene.tick();
        this.skills.tryAutoActivate(this.scene, true);
        this.skills.tryAutoActivate(this.scene, false);
        this.step += 1;
        return this.result;
    }

    run(): PvpRunResult {
        while (!this.result) this.tick();
        return this.result;
    }
}

/** Many seeded runs (runSeed(1..runs)), so the same inputs always give the same numbers. */
export function simulatePvpBatch(
    p1: PvpFighter,
    p2: PvpFighter,
    cfg: PvpHpConfig,
    runs = 1000,
): PvpBatchResult {
    let p1Wins = 0, p2Wins = 0, draws = 0, timeouts = 0, secs = 0, f1 = 0, f2 = 0, mult = 1;
    for (let seed = 1; seed <= runs; seed++) {
        const battle = new PvpBattle(p1, p2, cfg, runSeed(seed));
        mult = battle.hpMultiplier;
        const r = battle.run();
        if (r.outcome === 'p1') p1Wins++;
        else if (r.outcome === 'p2') p2Wins++;
        else draws++;
        if (r.timedOut) timeouts++;
        secs += r.seconds;
        f1 += r.p1HpFrac;
        f2 += r.p2HpFrac;
    }
    return {
        runs, p1Wins, p2Wins, draws, timeouts,
        avgSeconds: secs / runs, avgP1HpFrac: f1 / runs, avgP2HpFrac: f2 / runs,
        hpMultiplier: mult,
    };
}

/**
 * The battle visualizer's engine surface (the same one VisualBattleEngine offers for main battles
 * and missions) over a PvP battle: Player 2 is drawn where the enemies go. Render frames
 * accumulate into whole 0.1 s game steps, so playback speed never bends the battle.
 */
export class PvpVisualEngine {
    readonly battle: PvpBattle;
    private acc = 0;

    private readonly p1Name: string;
    private readonly p2Name: string;

    constructor(p1: PvpFighter, p2: PvpFighter, cfg: PvpHpConfig, seed: number, private readonly p1Stats: unknown) {
        this.battle = new PvpBattle(p1, p2, cfg, seed, true);
        this.p1Name = p1.name || 'P1';
        this.p2Name = p2.name || 'P2';
    }

    /** Engine ticks run so far: the visualizer takes a new snapshot only when this moves. */
    ticks(): number {
        return this.battle.scene.tickCount;
    }

    tick(dt: number): void {
        this.acc += dt;
        while (this.acc >= 0.1 - 1e-9 && !this.battle.done) {
            this.acc -= 0.1;
            this.battle.tick();
        }
    }

    getSnapshot() {
        const { scene } = this.battle;
        const { ally, enemy } = this.battle;
        const who = (id: number) => id === ally.id ? this.p1Name : id === enemy.id ? this.p2Name
            : scene.units.find(u => u.id === id)?.isAlly ? `${this.p1Name}'s Drone` : `${this.p2Name}'s Drone`;
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
            isSummon: u.isSummon,
            shield: 0,
        });
        const buffIds = new Set(['Meat', 'Morale', 'Berserk', 'Buff', 'HigherMorale']);
        const skillView = (isAlly: boolean) => this.battle.skills.snapshot().filter(sk => sk.isAlly === isAlly).map(sk => ({
            id: sk.id,
            state: sk.state === 'ready' ? 'Ready' : sk.state === 'active' ? 'Active' : 'Cooldown',
            timer: sk.secondsLeft,
        }));
        return {
            time: this.battle.seconds,
            player: unitView(this.battle.ally),
            // Player 2 first, then whatever it summoned.
            enemies: [this.battle.enemy, ...scene.units.filter(u => !u.isAlly && u.isSummon && !u.destroyed)].map(unitView),
            allySummons: scene.units.filter(u => u.isAlly && u.isSummon && !u.destroyed).map(unitView),
            skills: skillView(true),
            enemySkills: skillView(false),
            activeEffects: scene.areaProjectiles
                .filter(a => !a.destroyed)
                .map(a => ({ id: a.id, x: a.pos.x, radius: a.radius, timer: a.timer, duration: a.duration, isAllied: a.isAllied })),
            activeBuffs: this.battle.skills.snapshot()
                .filter(sk => sk.isAlly && sk.state === 'active' && buffIds.has(sk.id))
                .map(sk => ({ skillId: sk.id, bonusDamage: 0, bonusMaxHealth: 0 })),
            projectiles: scene.projectiles
                .filter(p => !p.destroyed)
                .map(p => ({ id: p.id, currentX: p.pos.x, currentY: p.pos.y, isPlayerSource: p.isAllied })),
            logs: scene.events.slice(-100).map(e => ({
                time: e.tick / 10,
                ...describeEvent(e, who, n => Math.round(n).toLocaleString('en-US')),
            })),
            visuals: sceneVisuals(scene, this.battle.skills),
            remainingWaves: 0,
            waveIndex: 0,
            playerStats: this.p1Stats,
            isEngaged: this.battle.ally.targetInRange,
            engagementTime: this.battle.seconds,
            waveEngagementTimer: 0,
            pvpResult: this.battle.result,
        };
    }
}
