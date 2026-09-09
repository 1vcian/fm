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
    skillDamageMultiplier: number;
    skillHealthMultiplier: number;
    secondaryDamageMulti?: number;
    secondaryHealthMulti?: number;
    skillCooldownReduction?: number;
    attackRangeMultiplier?: number;
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

export function playerCombatStats(agg: PlayerAggregates, context?: BattleContext): Partial<CombatStatsVec> {
    const ctx = contextBonus(agg, context);
    return {
        hpMax: agg.totalHealth * (1 + ctx.hp),
        hpMaxNoMulti: agg.totalHealth * (1 + ctx.hp),
        dmg: agg.totalDamage * (1 + ctx.dmg),
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
        // The PlayerAttackRange node runs the weapon's range through the stat pipeline.
        attackRange: (agg.weaponAttackRange || 0.3) * (1 + (agg.attackRangeMultiplier ?? 0)),
        windupTime: agg.weaponWindupTime || 0.5,
        attackDuration: agg.weaponAttackDuration || 1.5,
        projectile:
            agg.isRangedWeapon && agg.hasProjectile
                ? {
                      speed: agg.projectileSpeed || 15,
                      collisionRadius: agg.projectileRadius || 0.2,
                      affectedByGravity: agg.projectileAffectedByGravity ?? false,
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
        const idx = Math.min(Math.max(sk.level - 1, 0), (cfg.DamagePerLevel?.length ?? 1) - 1);
        out.push({
            id: cfg.Type ?? sk.id,
            slot,
            isAlly,
            damage: (cfg.DamagePerLevel?.[idx] ?? 0) * dmgCommon * agg.skillDamageMultiplier,
            health: (cfg.HealthPerLevel?.[idx] ?? 0) * hpCommon * agg.skillHealthMultiplier,
            cooldown: Math.max(0.5, cfg.Cooldown * cdr),
            activeDuration: cfg.ActiveDuration ?? 0,
        });
    });
    return out;
}
