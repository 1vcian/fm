/**
 * AggregatedStats -> engine mapping. The one place where the tool's stat vector is
 * translated into the game-shaped CombatStats the engine runs on.
 *
 * Shape notes that matter (all verified, see docs/combat-model.md):
 *
 *  - criticalMulti: the game's crit is `dmg * CriticalMulti` with the stat built as
 *    default 1.0 + PlayerBaseCritDamage (0.2) + gear. statEngine.criticalDamage is
 *    `1 + baseCritDamage + gear` = the SAME shape, so it maps through unchanged.
 *  - moveSpeed: the game runs base 2.0 through the MoveSpeed stat pipeline (multiplier
 *    contributions). statEngine.moveSpeed is the summed fraction, so 2.0 * (1 + it).
 *  - skill damage: the tech tree's generic Damage nodes target Equipment/Player, never
 *    ActiveSkill, so the skill common layer is ONLY the DamageMulti substat pool
 *    (agg.secondaryDamageMulti) — not agg.damageMultiplier, which folds the tech tree in.
 *    Skill health takes the HealthMulti pool the same way.
 *  - cooldown: TimerSpeed scales only the cooldown; skillCooldownReduction is already the
 *    combined OneMinusMultiplier fraction.
 */
import { SkillSpec } from './skills';
import { CombatStatsVec, UnitSpec } from './types';

/** The AggregatedStats fields this mapping consumes (a structural subset, not the class). */
export interface PlayerAggregates {
    totalDamage: number;
    totalHealth: number;
    attackSpeedMultiplier: number;
    criticalChance: number;
    criticalDamage: number;
    blockChance: number;
    doubleDamageChance: number;
    lifeSteal: number;
    healthRegen: number;
    moveSpeed?: number;
    reflectChance?: number;
    weaponAttackRange: number;
    weaponWindupTime: number;
    weaponAttackDuration: number;
    isRangedWeapon: boolean;
    hasProjectile?: boolean;
    projectileSpeed?: number;
    projectileRadius?: number;
    projectileAffectedByGravity?: boolean;
    isAiming?: boolean;
    weaponHandOffset?: { x: number; y: number };
    weaponMuzzleOffset?: { x: number; y: number };
    skillDamageMultiplier: number;
    skillHealthMultiplier: number;
    secondaryDamageMulti?: number;
    secondaryHealthMulti?: number;
    skillCooldownReduction?: number;
    attackRangeBonus?: number;
    contextBonuses?: {
        mission: { dmg: number; hp: number };
        clanWar: { dmg: number; hp: number };
        league: { dmg: number; hp: number };
        dungeon: Record<'hammer' | 'skill' | 'egg' | 'potion', { dmg: number; hp: number }>;
    };
}

/**
 * The battle the unit is entering. Conditional tech/clan nodes (StatCondition in the binary)
 * only apply in their matching context; 'main' has none.
 */
export type BattleContext =
    | 'main'
    | 'mission'
    | 'clanWar'
    | 'league'
    | 'dungeon:hammer'
    | 'dungeon:skill'
    | 'dungeon:egg'
    | 'dungeon:potion';

export function contextBonus(agg: PlayerAggregates, context?: BattleContext): { dmg: number; hp: number } {
    const cb = agg.contextBonuses;
    if (!cb || !context || context === 'main') return { dmg: 0, hp: 0 };
    if (context === 'mission') return cb.mission;
    if (context === 'clanWar') return cb.clanWar;
    if (context === 'league') return cb.league;
    return cb.dungeon[context.split(':')[1] as 'hammer' | 'skill' | 'egg' | 'potion'];
}

/**
 * The context node's factor on the final Damage / Health.
 *
 * The mission, clan war and dungeon nodes are CLAN tech nodes (Damage/Health Multiplier), which
 * GuildTechTreeHelpers.ToClanLayer (0x78227C8) moves to StatLayer.ClanTechTree: their own layer,
 * so they compound, `x (1 + ctx)`. LeagueBattleDamage/Health only exists as a PERSONAL node
 * definition (TechNodesLibrary: Layer None, Condition InLeagueBattle), and Layer None is where the
 * DamageMulti/HealthMulti substat pool lives, so it adds to that pool:
 * `(1 + substats + league) / (1 + substats)`. No shipped tree carries a league node today.
 */
function contextFactor(agg: PlayerAggregates, context: BattleContext | undefined, ctx: number, pool: number): number {
    if (context === 'league') return (1 + pool + ctx) / (1 + pool);
    return 1 + ctx;
}

export function playerCombatStats(agg: PlayerAggregates, context?: BattleContext): Partial<CombatStatsVec> {
    const ctx = contextBonus(agg, context);
    const hpFactor = contextFactor(agg, context, ctx.hp, agg.secondaryHealthMulti ?? 0);
    const dmgFactor = contextFactor(agg, context, ctx.dmg, agg.secondaryDamageMulti ?? 0);
    return {
        hpMax: agg.totalHealth * hpFactor,
        hpMaxNoMulti: agg.totalHealth * hpFactor,
        dmg: agg.totalDamage * dmgFactor,
        moveSpeed: 2.0 * (1 + (agg.moveSpeed ?? 0)),
        criticalChance: agg.criticalChance,
        criticalMulti: agg.criticalDamage,
        blockChance: agg.blockChance,
        dodgeChance: 0,
        healthRegen: agg.healthRegen,
        lifeSteal: agg.lifeSteal,
        doubleDamageChance: agg.doubleDamageChance,
        attackSpeedMulti: agg.attackSpeedMultiplier,
        reflectChance: agg.reflectChance ?? 0,
    };
}

/** The player's UnitSpec for a main battle / dungeon / mission (no PvP HP multiplier). */
export function playerUnitSpec(agg: PlayerAggregates, pos = { x: 0, y: 0 }, context?: BattleContext): UnitSpec {
    return {
        isAlly: true,
        isPlayer: true,
        pos,
        stats: playerCombatStats(agg, context),
        // The weapon's range runs through the stat pipeline (StatType AttackRange). The
        // PlayerAttackRange node is Additive in Layer None, so it adds world units:
        // (weaponRange + bonus), e.g. melee 0.3 + 3 at clan max, not 0.3 * 4.
        attackRange: (agg.weaponAttackRange || 0.3) + (agg.attackRangeBonus ?? 0),
        windupTime: agg.weaponWindupTime || 0.5,
        attackDuration: agg.weaponAttackDuration || 1.5,
        // hasProjectile already follows SetUnitWeapon on the combat (skinned) weapon row:
        // IsRanged and ProjectileId >= 0. Without it the hit lands at once at any range.
        projectile: agg.hasProjectile
            ? {
                  speed: agg.projectileSpeed || 15,
                  collisionRadius: agg.projectileRadius || 0.2,
                  affectedByGravity: agg.projectileAffectedByGravity ?? false,
                  isAiming: !!agg.isAiming,
                  handOffset: { ...(agg.weaponHandOffset ?? { x: 0, y: 0 }) },
                  weaponOffset: { ...(agg.weaponMuzzleOffset ?? { x: 0, y: 0 }) },
              }
            : undefined,
        tag: 'player',
    };
}

export interface EquippedSkill {
    id: string;
    level: number;
}

interface SkillLibraryEntry {
    Type?: string;
    Cooldown: number;
    ActiveDuration: number;
    DamagePerLevel: number[];
    HealthPerLevel: number[];
}

/**
 * Resolve the equipped skills into engine SkillSpecs with the verified layer math:
 * damage = base * (1 + DamageMulti substats) * skillDamageMultiplier
 * health = base * (1 + HealthMulti substats) * skillHealthMultiplier
 * cooldown = Cooldown * (1 - skillCooldownReduction)
 */
export function skillSpecs(
    agg: PlayerAggregates,
    equipped: EquippedSkill[],
    skillLibrary: Record<string, SkillLibraryEntry>,
    isAlly = true
): SkillSpec[] {
    const dmgCommon = 1 + (agg.secondaryDamageMulti ?? 0);
    const hpCommon = 1 + (agg.secondaryHealthMulti ?? 0);
    const cdr = 1 - (agg.skillCooldownReduction ?? 0);
    const out: SkillSpec[] = [];
    equipped.forEach((sk, slot) => {
        const cfg = skillLibrary[sk.id];
        if (!cfg || sk.level <= 0) return;
        // Level is 0-based in the game (Lv.N reads index N-1); each array is indexed on its own and
        // out of range reads 0 (GetDamage 0x7853230 / GetHealth 0x78532E4). Meat has no damage
        // array but a health one, so a shared clamped index would zero its heal.
        const idx = sk.level - 1;
        const at = (a?: number[]) => (a && idx >= 0 && idx < a.length ? a[idx] : 0);
        out.push({
            id: cfg.Type ?? sk.id,
            slot,
            isAlly,
            damage: at(cfg.DamagePerLevel) * dmgCommon * agg.skillDamageMultiplier,
            health: at(cfg.HealthPerLevel) * hpCommon * agg.skillHealthMultiplier,
            cooldown: cfg.Cooldown * cdr, // no floor in the game
            activeDuration: cfg.ActiveDuration ?? 0,
        });
    });
    return out;
}
