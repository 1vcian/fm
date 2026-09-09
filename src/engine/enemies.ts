/**
 * Enemy builders — the REAL scaling formulas from the binary, replacing the old engine's
 * cancelling magic numbers (x50 fixed-point patch and x0.02 "calibration").
 *
 *   main battle (MainBattleBalancing, 0x7736064):
 *     hp  = AgeScaling[age].Health * pow(EnemyHpDifficultyMulti,  difficultyIdx)
 *     dmg = AgeScaling[age].Damage * pow(EnemyDmgDifficultyMulti, difficultyIdx)
 *           * (weapon.IsRanged ? EnemyRangedDamageMultiplier : 1)
 *   dungeons: flat Health/Damage straight from the level's library row.
 *   missions: floor(Base * HealthAndDamageLevelMultiplier^(level-1)), UnitCount clones.
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
    projectilesLibrary?: Record<string, { Speed?: number; CollisionRadius?: number; AffectedByGravity?: boolean }>;
    itemBalancingConfig?: { EnemyRangedDamageMultiplier?: number };
}

interface WeaponInfoJson {
    AttackRange: number;
    WindupTime: number;
    AttackDuration: number;
    IsRanged?: boolean;
    ProjectileId?: number;
}

/** Weapon + projectile of an enemy id, resolved exactly like SetupEnemies does. */
function enemyLoadout(enemyId: number | string, libs: EnemyConfigLibs) {
    const enemy = libs.enemyLibrary[String(enemyId)];
    const wid = enemy?.WeaponId;
    const weaponSpriteKey = wid ? `${wid.Age}_5_${wid.Idx}` : undefined;
    const weapon: WeaponInfoJson | undefined = wid
        ? libs.weaponLibrary[`{'Age': ${wid.Age}, 'Type': 'Weapon', 'Idx': ${wid.Idx}}`]
        : undefined;
    const isRanged = weapon?.IsRanged ?? (weapon ? weapon.AttackRange > 1.0 : false);
    const proj =
        isRanged && weapon && weapon.ProjectileId !== undefined && weapon.ProjectileId >= 0
            ? libs.projectilesLibrary?.[String(weapon.ProjectileId)]
            : undefined;
    return {
        weaponSpriteKey,
        attackRange: weapon?.AttackRange ?? 0.3,
        windupTime: weapon?.WindupTime ?? 0.5,
        attackDuration: weapon?.AttackDuration ?? 1.5,
        isRanged,
        projectile: proj
            ? {
                  speed: proj.Speed ?? 15,
                  collisionRadius: proj.CollisionRadius ?? 0.2,
                  affectedByGravity: proj.AffectedByGravity ?? false,
              }
            : undefined,
    };
}

export interface MainBattleWave {
    Enemies: { Id: number; Count: number }[] | null;
}

/** One main-battle wave -> engine specs, at the real magnitudes. */
export function mainBattleWaveSpecs(
    wave: MainBattleWave,
    ageScaling: { Health: unknown; Damage: unknown },
    difficultyIdx: number,
    hpDifficultyMulti: number,
    dmgDifficultyMulti: number,
    libs: EnemyConfigLibs
): WaveEnemySpec[] {
    const baseHp = realAgeScale(ageScaling.Health) * Math.pow(hpDifficultyMulti, difficultyIdx);
    const baseDmg = realAgeScale(ageScaling.Damage) * Math.pow(dmgDifficultyMulti, difficultyIdx);
    const rangedMulti = libs.itemBalancingConfig?.EnemyRangedDamageMultiplier ?? 0.67;

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
 * Dungeon waves: flat stats, enemies alternating between the two ids. A row with no Wave
 * fields is a single boss (the Hammer Thief library ships only Level/Damage/Health), and a
 * NEGATIVE enemy id means "unused" (skill/potion dungeons ship EnemyId2 = -1).
 */
export function dungeonWaveSpecs(row: DungeonLevelRow, libs: EnemyConfigLibs): WaveEnemySpec[][] {
    const id1 = row.EnemyId1 !== undefined && row.EnemyId1 >= 0 ? row.EnemyId1 : 0;
    const id2 = row.EnemyId2 !== undefined && row.EnemyId2 >= 0 ? row.EnemyId2 : id1;
    const counts = row.Wave1 === undefined ? [1] : [row.Wave1 ?? 0, row.Wave2 ?? 0, row.Wave3 ?? 0];
    const waves: WaveEnemySpec[][] = [];
    for (const count of counts) {
        if (count <= 0) continue;
        const offsets = mainBattleFormation(count);
        const wave: WaveEnemySpec[] = [];
        for (let k = 0; k < count; k++) {
            const id = k % 2 === 0 ? id1 : id2;
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
        waves.push(wave);
    }
    return waves;
}

export interface MissionConfigRow {
    BaseDamage: number;
    BaseHealth: number;
    UnitCount?: number;
    PossibleWeapons?: { Item1: number; Item2: number }[] | null;
}

/**
 * Mission wave: UnitCount clones at floor(base * multiplier^(level-1)); each picks a random
 * weapon from PossibleWeapons — randomness drawn from the caller's RNG so a seeded run stays
 * reproducible.
 */
export function missionWaveSpecs(
    mission: MissionConfigRow,
    level: number,
    levelMultiplier: number,
    libs: EnemyConfigLibs,
    rng: RandomPCG
): WaveEnemySpec[] {
    const count = mission.UnitCount ?? 6;
    const hp = Math.floor(mission.BaseHealth * Math.pow(levelMultiplier, level - 1));
    const dmg = Math.floor(mission.BaseDamage * Math.pow(levelMultiplier, level - 1));
    const offsets = missionFormation(count);
    const weapons = mission.PossibleWeapons ?? [];

    const out: WaveEnemySpec[] = [];
    for (let i = 0; i < count; i++) {
        let loadout = { attackRange: 0.3, windupTime: 0.5, attackDuration: 1.5, isRanged: false, projectile: undefined as WaveEnemySpec['projectile'] };
        let weaponSpriteKey: string | undefined;
        if (weapons.length) {
            const pick = weapons[Math.floor(rng.nextF64() * weapons.length) % weapons.length];
            weaponSpriteKey = `${pick.Item1}_5_${pick.Item2}`;
            const weapon = libs.weaponLibrary[`{'Age': ${pick.Item1}, 'Type': 'Weapon', 'Idx': ${pick.Item2}}`];
            if (weapon) {
                const isRanged = weapon.IsRanged ?? weapon.AttackRange > 1.0;
                const proj =
                    isRanged && weapon.ProjectileId !== undefined && weapon.ProjectileId >= 0
                        ? libs.projectilesLibrary?.[String(weapon.ProjectileId)]
                        : undefined;
                loadout = {
                    attackRange: weapon.AttackRange,
                    windupTime: weapon.WindupTime,
                    attackDuration: weapon.AttackDuration,
                    isRanged,
                    projectile: proj
                        ? { speed: proj.Speed ?? 15, collisionRadius: proj.CollisionRadius ?? 0.2, affectedByGravity: proj.AffectedByGravity ?? false }
                        : undefined,
                };
            }
        }
        out.push({
            offset: offsets[i],
            stats: { hpMax: hp, hpMaxNoMulti: hp, dmg },
            hp,
            attackRange: loadout.attackRange,
            windupTime: loadout.windupTime,
            attackDuration: loadout.attackDuration,
            projectile: loadout.projectile,
            tag: 'mission',
            weaponSpriteKey,
        });
    }
    return out;
}
