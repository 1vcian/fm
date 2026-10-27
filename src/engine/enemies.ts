/**
 * Enemy builders — the REAL scaling formulas from the binary, replacing the old engine's
 * cancelling magic numbers (x50 fixed-point patch and x0.02 "calibration").
 *
 *   main battle (MainBattleBalancing, 0x7824548 / 0x78245F0 in 2026_10_27_09_45):
 *     hp  = AgeScaling[age].Health * pow(EnemyHpDifficultyMulti, difficultyIdx)
 *     dmg = AgeScaling[age].Damage * pow(EnemyDmgDifficultyMulti, difficultyIdx)
 *           * (weapon.IsRanged ? EnemyRangedDamageMultiplier : 1)
 *     (2026_10_08_09_03 alone took the multipliers from a DifficultyScaling table)
 *   dungeons: flat Health/Damage straight from the level's library row (Hammer Thief: one
 *     hardcoded thief, see hammerThiefSpec).
 *   missions: ToInt64(Base * (float)HealthAndDamageLevelMultiplier^(level-1)), UnitCount clones.
 *
 * BattleIdx never scales stats; it only picks the wave composition. Enemies carry ONLY
 * hp/dmg (never crit/block/dodge/reflect/lifesteal/regen, speed 1.0, move 2.0).
 */
import { WaveEnemySpec, mainBattleFormation, missionFormation } from './modes';
import { RandomPCG } from './rng';

/**
 * An AgeScaling value at its REAL magnitude. Configs before 2026_08_21 store {Raw: n} at
 * x50 fixed point (70.0 -> {Raw: 3500}); from then on the plain number. Same rule as
 * BattleHelper.ageScale, without the legacy x50 output convention.
 */
export function realAgeScale(v: unknown): number {
    if (v && typeof v === 'object' && 'Raw' in (v as Record<string, unknown>)) {
        return Number((v as { Raw: number }).Raw) / 50;
    }
    return Number(v) || 0;
}

interface EnemyConfigLibs {
    enemyLibrary: Record<string, { WeaponId?: { Age: number; Type: string; Idx: number } }>;
    weaponLibrary: Record<string, WeaponInfoJson>;
    projectilesLibrary?: Record<string, { Speed: number; CollisionRadius: number; AffectedByGravity: boolean }>;
    itemBalancingConfig?: { EnemyRangedDamageMultiplier?: number };
}

interface WeaponInfoJson {
    AttackRange: number;
    WindupTime: number;
    AttackDuration: number;
    IsRanged?: boolean;
    IsAiming?: boolean;
    ProjectileId?: number;
    Hand?: { X: number; Y: number };
    Offset?: { X: number; Y: number };
}

/** ItemId.get_DefaultWeapon (0x7835200): Age 10000, Weapon, Idx 0 (the bare-handed enemy weapon). */
export const DEFAULT_WEAPON = { Age: 10000, Idx: 0 } as const;

const weaponKey = (age: number, idx: number) => `{'Age': ${age}, 'Type': 'Weapon', 'Idx': ${idx}}`;

/**
 * SetUnitWeapon (0x77E8D10): AttackRange, WindUp and AttackDuration straight from the weapon row;
 * a projectile only when IsRanged and ProjectileId >= 0 (a ranged weapon without one hits
 * instantly at range, like melee). Every value comes from the WeaponLibrary / ProjectilesLibrary
 * rows; a missing row is a broken config and throws instead of using a guessed number.
 */
function weaponLoadout(age: number, idx: number, libs: EnemyConfigLibs) {
    const weapon: WeaponInfoJson | undefined = libs.weaponLibrary[weaponKey(age, idx)];
    if (!weapon) throw new Error(`WeaponLibrary has no row ${weaponKey(age, idx)}`);
    const isRanged = weapon.IsRanged ?? weapon.AttackRange > 1.0;
    const proj =
        isRanged && weapon.ProjectileId !== undefined && weapon.ProjectileId >= 0
            ? libs.projectilesLibrary?.[String(weapon.ProjectileId)]
            : undefined;
    if (isRanged && weapon.ProjectileId !== undefined && weapon.ProjectileId >= 0 && !proj) {
        throw new Error(`ProjectilesLibrary has no row ${weapon.ProjectileId}`);
    }
    return {
        weaponSpriteKey: `${age}_5_${idx}`,
        attackRange: weapon.AttackRange,
        windupTime: weapon.WindupTime,
        attackDuration: weapon.AttackDuration,
        isRanged,
        projectile: proj
            ? {
                  speed: proj.Speed,
                  collisionRadius: proj.CollisionRadius,
                  affectedByGravity: proj.AffectedByGravity,
                  // IsAiming, Hand and Offset place the muzzle (ExecuteAttack 0x77F58C8).
                  isAiming: !!weapon.IsAiming,
                  handOffset: { x: weapon.Hand?.X ?? 0, y: weapon.Hand?.Y ?? 0 },
                  weaponOffset: { x: weapon.Offset?.X ?? 0, y: weapon.Offset?.Y ?? 0 },
              }
            : undefined,
    };
}

/** Weapon + projectile of an enemy id, resolved exactly like SetupEnemies does. */
function enemyLoadout(enemyId: number | string, libs: EnemyConfigLibs) {
    const wid = libs.enemyLibrary[String(enemyId)]?.WeaponId ?? DEFAULT_WEAPON;
    return weaponLoadout(wid.Age, wid.Idx, libs);
}

export interface MainBattleWave {
    Enemies: { Id: number; Count: number }[] | null;
}

export interface MainBattleConfigJson {
    EnemyHpDifficultyMulti?: number;
    EnemyDmgDifficultyMulti?: number;
    DifficultyScaling?: { DifficultyIdx: number; HpMulti: number; DmgMulti: number }[] | null;
}

/**
 * The highest main-battle difficulty index when the config carries no DifficultyScaling table.
 * Build 2026_10_27_09_45 dropped the table and went back to `Pow(Enemy*DifficultyMulti, idx)`;
 * `MainBattleBalancing.MaxDifficultyIdx` is 2 and GetNextBattleId (0x78252FC) raises the
 * difficulty only while it is <= 1, so the reachable indices are 0..2.
 */
const MAX_DIFFICULTY_IDX_WITHOUT_TABLE = 2;

/**
 * How many main-battle difficulties a build has: the length of
 * MainBattleConfig.DifficultyScaling when the build ships it (2026_10_08_09_03, `HasDifficulty(i)`
 * is `0 <= i < Count`), otherwise MaxDifficultyIdx + 1.
 */
export function mainBattleDifficultyCount(config: MainBattleConfigJson | null | undefined): number {
    // No config loaded: no difficulties yet (callers render nothing until it arrives).
    if (!config) return 0;
    const table = config.DifficultyScaling;
    return table && table.length > 0 ? table.length : MAX_DIFFICULTY_IDX_WITHOUT_TABLE + 1;
}

/**
 * Total enemy HP/damage multipliers for a difficulty.
 *
 * Build 2026_10_08_09_03 read them from the DifficultyScaling table, clamping the index into
 * [0, Count-1] (`MainBattleConfig.GetDifficultyScaling`). Without the table (2026_10_27_09_45 and
 * the builds before 2026_10) the binary computes `Pow(Enemy*DifficultyMulti, idx)` in FD6
 * (MainBattleBalancing.GetEnemyHp 0x7824548, GetEnemyDmg 0x78245F0), which the table reproduced
 * for 0..2.
 */
export function mainBattleDifficultyMultipliers(
    config: MainBattleConfigJson | null | undefined,
    difficultyIdx: number
): { hp: number; dmg: number } {
    const table = config?.DifficultyScaling;
    if (table && table.length > 0) {
        // GetDifficultyScaling (0x77FD084): DifficultyScaling[clamp(idx, 0, Count - 1)], by list
        // position (the row's DifficultyIdx field is not consulted).
        const clamped = Math.min(Math.max(difficultyIdx, 0), table.length - 1);
        const row = table[clamped];
        return { hp: row.HpMulti, dmg: row.DmgMulti };
    }
    const hpBase = config?.EnemyHpDifficultyMulti;
    const dmgBase = config?.EnemyDmgDifficultyMulti;
    if (typeof hpBase !== 'number' || typeof dmgBase !== 'number') {
        throw new Error('MainBattleConfig.json is not loaded');
    }
    return { hp: Math.pow(hpBase, difficultyIdx), dmg: Math.pow(dmgBase, difficultyIdx) };
}

/** One main-battle wave -> engine specs, at the real magnitudes. */
export function mainBattleWaveSpecs(
    wave: MainBattleWave,
    ageScaling: { Health: unknown; Damage: unknown },
    difficultyIdx: number,
    mainBattleConfig: MainBattleConfigJson | null | undefined,
    libs: EnemyConfigLibs
): WaveEnemySpec[] {
    const multi = mainBattleDifficultyMultipliers(mainBattleConfig, difficultyIdx);
    const baseHp = realAgeScale(ageScaling.Health) * multi.hp;
    const baseDmg = realAgeScale(ageScaling.Damage) * multi.dmg;
    const rangedMulti = libs.itemBalancingConfig?.EnemyRangedDamageMultiplier;
    if (typeof rangedMulti !== 'number') throw new Error('ItemBalancingConfig.EnemyRangedDamageMultiplier is not loaded');

    const flat: { id: number }[] = [];
    for (const group of wave.Enemies ?? []) {
        for (let i = 0; i < group.Count; i++) flat.push({ id: group.Id });
    }
    const offsets = mainBattleFormation(flat.length);
    return flat.map((e, i) => {
        const w = enemyLoadout(e.id, libs);
        const dmg = baseDmg * (w.isRanged ? rangedMulti : 1);
        return {
            offset: offsets[i],
            stats: { hpMax: baseHp, hpMaxNoMulti: baseHp, dmg },
            hp: baseHp,
            attackRange: w.attackRange,
            windupTime: w.windupTime,
            attackDuration: w.attackDuration,
            projectile: w.projectile,
            tag: `enemy:${e.id}`,
            weaponSpriteKey: w.weaponSpriteKey,
        };
    });
}

export interface DungeonLevelRow {
    Health: number;
    Damage: number;
    Wave1?: number;
    Wave2?: number;
    Wave3?: number;
    EnemyId1?: number;
    EnemyId2?: number;
}

/**
 * Simulator-only "test against dummy" target, not a game unit: infinite HP, it walks at the
 * default unit move speed like every enemy (so it reaches a ranged player too), and it swings
 * the bare-handed enemy weapon (DEFAULT_WEAPON row of WeaponLibrary). Every hit takes the
 * player straight down to a quarter of HpMax (up to 75% of HpMax per hit, never below 25%), so
 * regen, lifesteal, block, dodge and reflect all stay visible for as long as the test runs.
 */
export const TEST_DUMMY_HIT_FRACTION = 0.75;
export const TEST_DUMMY_FLOOR_FRACTION = 0.25;

export function testDummySpec(libs: EnemyConfigLibs): WaveEnemySpec {
    const w = weaponLoadout(DEFAULT_WEAPON.Age, DEFAULT_WEAPON.Idx, libs);
    const HUGE = 1e18;
    return {
        offset: { x: 0, y: 0 },
        stats: { hpMax: HUGE, hpMaxNoMulti: HUGE, dmg: 0 },
        hp: HUGE,
        attackRange: w.attackRange,
        windupTime: w.windupTime,
        attackDuration: w.attackDuration,
        projectile: w.projectile,
        tag: 'dummy',
        weaponSpriteKey: w.weaponSpriteKey,
        testDummy: { hitFraction: TEST_DUMMY_HIT_FRACTION, floorFraction: TEST_DUMMY_FLOOR_FRACTION },
    };
}

/**
 * The Hammer Thief (HammerThiefDungeonBattleModel.SetupEnemies, 0x7802464): ONE unit, no
 * weapon item, IsHammerThief set, at (player.X + 15, 0), with hardcoded combat data:
 * Radius 1.0, AttackRange 0.5 (F64.Ratio(1,2)), WindUp 0.8 (Ratio(48,60)), AttackDuration 1.5
 * (Ratio(3,2)), MoveSpeed 2.0, Hp/HpMax = Health, Dmg = Damage. It is melee.
 */
export function hammerThiefSpec(row: { Health: number; Damage: number }): WaveEnemySpec {
    return {
        offset: { x: 0, y: 0 },
        stats: { hpMax: row.Health, hpMaxNoMulti: row.Health, dmg: row.Damage },
        hp: row.Health,
        radius: 1.0,
        attackRange: 0.5,
        // F64.Ratio(48, 60) is Q32.32-truncated (0.79999999981...), then FD6: 799999 micro.
        windupTime: Math.floor((48 * 4294967296) / 60) / 4294967296,
        attackDuration: 1.5,
        tag: 'enemy:hammerThief',
    };
}

/**
 * Dungeon waves (NormalDungeonBattleModel.SetupEnemies, 0x7802CC8): flat Health/Damage from the
 * level's row (no ranged multiplier), enemy i takes EnemyIds[i % count] where EnemyIds is
 * [EnemyId1, EnemyId2] without the negative ones (DungeonBattleLibrary.EnemyIds, 0x7801F2C), and
 * the waves are [Wave1, Wave2, Wave3] without the negative ones (0x7802070): a zero-sized wave
 * stays (it clears on its first frame). Positions: player.X + 15 plus the main-battle formation.
 * A row with no Wave fields is the Hammer Thief library: one hardcoded thief.
 */
export function dungeonWaveSpecs(row: DungeonLevelRow, libs: EnemyConfigLibs): WaveEnemySpec[][] {
    if (row.Wave1 === undefined) return [[hammerThiefSpec(row)]];
    const ids = [row.EnemyId1, row.EnemyId2].filter((id): id is number => id !== undefined && id >= 0);
    if (ids.length === 0) ids.push(0);
    const counts = [row.Wave1, row.Wave2, row.Wave3].filter((c): c is number => c !== undefined && c >= 0);
    return counts.map((count) => {
        const offsets = mainBattleFormation(count);
        const wave: WaveEnemySpec[] = [];
        for (let k = 0; k < count; k++) {
            const id = ids[k % ids.length];
            const w = enemyLoadout(id, libs);
            wave.push({
                offset: offsets[k],
                stats: { hpMax: row.Health, hpMaxNoMulti: row.Health, dmg: row.Damage },
                hp: row.Health,
                attackRange: w.attackRange,
                windupTime: w.windupTime,
                attackDuration: w.attackDuration,
                projectile: w.projectile,
                tag: `enemy:${id}`,
                weaponSpriteKey: w.weaponSpriteKey,
            });
        }
        return wave;
    });
}

export interface MissionConfigRow {
    BaseDamage: number;
    BaseHealth: number;
    UnitCount?: number;
    ChanceToHaveWeapon?: number;
    ChanceToHaveHelmet?: number;
    ChanceToHaveArmour?: number;
    PossibleWeapons?: { Item1: number; Item2: number }[] | null;
    PossibleHelmets?: { Item1: number; Item2: number }[] | null;
    PossibleArmours?: { Item1: number; Item2: number }[] | null;
}

/** .NET Convert.ToInt64(double): round to nearest, ties to even. */
function toInt64(x: number): number {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
}

/**
 * GetMissionLevelMultiplier (0x785E6DC): Math.Pow((double)(float)HealthAndDamageLevelMultiplier,
 * level - 1). The F64 config value goes through a FLOAT first, so 1.524 becomes 1.52400005...
 */
export function missionLevelMultiplier(levelMultiplier: number, level: number): number {
    return Math.pow(Math.fround(levelMultiplier), level - 1);
}

/** Mission enemy Hp / Dmg: Convert.ToInt64(multiplier * Base) (MissionCombatScene.SetupEnemies). */
export function missionEnemyStats(mission: Pick<MissionConfigRow, 'BaseDamage' | 'BaseHealth'>, level: number, levelMultiplier: number) {
    const m = missionLevelMultiplier(levelMultiplier, level);
    return { hp: toInt64(m * mission.BaseHealth), dmg: toInt64(m * mission.BaseDamage) };
}

/**
 * Suggested mission power, MissionExtensions.CalculateMissionPower (0x780FEEC) ->
 * PlayerPowerExtensions.CalculateMissionPower (0x785E79C), 2026_10_08_09_03 binary:
 *   m      = GetMissionLevelMultiplier(level)                       (0x785E6DC, see above)
 *   dmg    = Convert.ToInt64(m * BaseDamage * (double)(float)ItemBalancingConfig.PlayerPowerDamageMultiplier)
 *   hp     = Convert.ToInt64(m * BaseHealth)
 *   power  = (long)((float)(dmg + hp) * 0.8f * (float)UnitCount)   (float32 math, truncation)
 * The 0.8f is PlayerPowerExtensions.MissionPowerMultiplier (constant at 0x19B43B8).
 */
export function calculateMissionPower(
    mission: Pick<MissionConfigRow, 'BaseDamage' | 'BaseHealth' | 'UnitCount'>,
    level: number,
    levelMultiplier: number,
    playerPowerDamageMultiplier: number
): number {
    const m = missionLevelMultiplier(levelMultiplier, level);
    const dmg = toInt64(m * mission.BaseDamage * Math.fround(playerPowerDamageMultiplier));
    const hp = toInt64(m * mission.BaseHealth);
    const f = Math.fround(Math.fround(Math.fround(dmg + hp) * Math.fround(0.8)) * Math.fround(mission.UnitCount ?? 0));
    return Math.trunc(f);
}

/**
 * BattleModelExtensions.GetRandomItem (0x77E8B8C): one NextF64 roll, ALWAYS consumed; the item
 * exists iff roll != 0 and roll <= chance (Q32.32 compare), and then a second draw,
 * Choice = list[NextInt(count)] with NextInt(n) = (NextUInt >> 1) % n, picks it.
 */
function randomItem(
    chance: number | undefined,
    possible: { Item1: number; Item2: number }[] | null | undefined,
    rng: RandomPCG
): { Item1: number; Item2: number } | null {
    const roll = rng.nextUInt32();
    const chanceRaw = Math.round((chance ?? 0) * 4294967296);
    if (roll === 0 || roll > chanceRaw || !possible || possible.length < 1) return null;
    return possible[(rng.nextUInt32() >>> 1) % possible.length];
}

/**
 * Mission wave (MissionCombatScene.SetupEnemies, 0x780E7D0): UnitCount clones at
 * (15, 0) + MissionFormationBuilder.GetPositions(count), Hp/Dmg from missionEnemyStats. The items
 * come from their OWN RandomPCG created from the battle seed (RandomPCG.CreateFromSeed), not from
 * the combat RNG: per unit GetRandomItems rolls weapon, helmet, armour in that order (helmets and
 * armour are cosmetic but consume draws). No weapon = ItemId.DefaultWeapon.
 *
 * `rng` must be that dedicated item stream: pass `new RandomPCG(seed)` (or the seed itself).
 */
export function missionWaveSpecs(
    mission: MissionConfigRow,
    level: number,
    levelMultiplier: number,
    libs: EnemyConfigLibs,
    rng: RandomPCG | number | bigint
): WaveEnemySpec[] {
    const itemRng = rng instanceof RandomPCG ? rng : new RandomPCG(rng);
    const count = mission.UnitCount;
    if (typeof count !== 'number') throw new Error('MissionBattleLibrary row has no UnitCount');
    const { hp, dmg } = missionEnemyStats(mission, level, levelMultiplier);
    const offsets = missionFormation(count);

    const out: WaveEnemySpec[] = [];
    for (let i = 0; i < count; i++) {
        const weapon = randomItem(mission.ChanceToHaveWeapon, mission.PossibleWeapons, itemRng);
        const helmet = randomItem(mission.ChanceToHaveHelmet, mission.PossibleHelmets, itemRng);
        const armour = randomItem(mission.ChanceToHaveArmour, mission.PossibleArmours, itemRng);
        const w = weapon ? weaponLoadout(weapon.Item1, weapon.Item2, libs) : weaponLoadout(DEFAULT_WEAPON.Age, DEFAULT_WEAPON.Idx, libs);
        out.push({
            offset: offsets[i],
            stats: { hpMax: hp, hpMaxNoMulti: hp, dmg },
            hp,
            attackRange: w.attackRange,
            windupTime: w.windupTime,
            attackDuration: w.attackDuration,
            projectile: w.projectile,
            tag: 'mission',
            weaponSpriteKey: w.weaponSpriteKey,
            // Display only: the rolled helmet / armour, drawn by the battle viewer.
            cosmeticKeys: {
                helmet: helmet ? `${helmet.Item1}_0_${helmet.Item2}` : undefined,
                armour: armour ? `${armour.Item1}_1_${armour.Item2}` : undefined,
            },
        });
    }
    return out;
}
