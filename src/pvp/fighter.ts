/**
 * A PvP fighter: everything the arena battle needs about one player, derived from a profile.
 *
 * Every fighter is a UserProfile first (the active one, a saved one, or one rebuilt from a profile
 * card screenshot). The stat engine turns it into aggregates, and this file maps those onto the
 * engine's PvpLoadout the way the game's PvpCombatScene.SetupPlayer does (0x7852A88):
 *
 *   base health = TotalStats.PlayerHealth   (exactly the card's "Total Health")
 *   damage      = TotalStats.PlayerDamage   (exactly the card's "Total Damage")
 *   HP multiplier counts: equipped pets, equipped skills, an equipped mount (see simulate.ts)
 *
 * A card-built fighter passes the card's totals as overrides: the battle then runs on the numbers
 * the game itself would use, even when the reconstructed profile only approximates them.
 */
import type { UserProfile } from '../types/Profile';
import type { AggregatedStats, LibraryData } from '../utils/statEngine';
import { playerUnitSpec, skillSpecs, type PvpLoadout, type SkillSpec } from '../engine';

export interface PvpFighter {
    name: string;
    loadout: PvpLoadout;
    /** Skill specs with isAlly = true; the simulator flips the side for player 2. */
    skills: SkillSpec[];
    /** What the fighter's numbers came from, for the UI. */
    source: 'profile' | 'card';
    /** Totals before overrides, to show how close a rebuilt profile came to the card. */
    computed: { damage: number; health: number };
    /** The profile and its aggregates, for the battle visualizer's panels. */
    profile: UserProfile;
    stats: AggregatedStats;
    /** WeaponLibrary sprite key "<age>_5_<idx>" of the equipped weapon, for drawing. */
    weaponSpriteKey?: string;
}

export interface FighterOverrides {
    totalDamage?: number | null;
    totalHealth?: number | null;
}

export function fighterFromProfile(
    name: string,
    profile: UserProfile,
    stats: AggregatedStats,
    libs: LibraryData,
    overrides: FighterOverrides = {},
    source: PvpFighter['source'] = 'profile',
): PvpFighter {
    // The arena runs under BattleContext.ArenaBattle: only InLeagueBattle nodes differ from the
    // card, and no tree grants them in the current config.
    const spec = playerUnitSpec(stats as never, { x: 0, y: 0 }, 'league');
    const computedHealth = spec.stats.hpMax ?? 0;
    const computedDamage = spec.stats.dmg ?? 0;
    const health = overrides.totalHealth ?? computedHealth;
    const damage = overrides.totalDamage ?? computedDamage;

    const equipped = (profile.skills?.equipped ?? []).filter(s => s && s.id && (s.level ?? 0) > 0);
    const skills = libs.skillLibrary
        ? skillSpecs(stats as never, equipped.map(s => ({ id: s.id, level: s.level })), libs.skillLibrary as never)
        : [];

    const loadout: PvpLoadout = {
        health,
        stats: { ...spec.stats, dmg: damage },
        attackRange: spec.attackRange,
        windupTime: spec.windupTime,
        attackDuration: spec.attackDuration,
        projectile: spec.projectile,
        petCount: (profile.pets?.active ?? []).filter(Boolean).length,
        skillCount: equipped.length,
        hasMount: !!profile.mount?.active,
        tag: name,
    };
    const weapon = profile.items?.Weapon;
    return {
        name, loadout, skills, source,
        computed: { damage: computedDamage, health: computedHealth },
        profile, stats,
        weaponSpriteKey: weapon ? `${weapon.age}_5_${weapon.idx}` : undefined,
    };
}
