export const AGES = [
    "Primitive",
    "Medieval",
    "Early-Modern",
    "Modern",
    "Space",
    "Interstellar",
    "Multiverse",
    "Quantum",
    "Underworld",
    "Divine"
];

export const RARITIES = [
    "Common",
    "Rare",
    "Epic",
    "Legendary",
    "Ultimate",
    "Mythic"
];

/**
 * Active pet slots, still used only by the screenshot reader (src/utils/ocr/autoSync.ts and
 * AutoSyncModal), which does not receive the configs yet. Equals PetBaseConfig.PetSlotsCount in
 * 2026_10_08_09_03; everything else reads that config field.
 */
export const MAX_ACTIVE_PETS = 3;

/**
 * Skill Mechanics Definitions
 * Defines hit counts, AOE status, and timing/intervals for skills.
 * 
 * Key Rules (reverse-engineered from libil2cpp.so 2.8.2 — SkillBuilder.GetSkillDamageCount,
 * HandleAreaProjectiles / AoeDamage; confirmed level/rarity/ascension-INVARIANT):
 * - Library `Damage` is the TOTAL per activation; only Damage/Health scale per level.
 * - `count` is a DIVISOR by default (Damage split into `count` projectiles/pulses -> total = Damage);
 *   it becomes a MULTIPLIER only when `damageIsPerHit` (each hit deals the full Damage).
 * - isSingleTarget: target nearest, re-target on kill. isAOE: hit every unit in radius.
 * - `count` is the nominal split, NOT what lands: DPS and landed hit counts come from the engine
 *   (src/engine/skillYield.ts), e.g. Rain of Arrows lands 10 of 15 pulses, the Drone 10-12 shots.
 */
export const SKILL_MECHANICS: {
    [key: string]: {
        count: number,
        isAOE?: boolean,
        isSingleTarget?: boolean,
        interval?: number,
        delay?: number,
        isDuration?: boolean,
        damageIsPerHit?: boolean,
        descriptionIsPerHit?: boolean
    }
} = {
    // --- Buff Skills (No direct damage, apply bonuses while active) ---
    "0": { count: 0 }, // Meat: Healing Buff
    "Meat": { count: 0 },
    "1": { count: 0 }, // Morale: Damage + Healing Buff
    "Morale": { count: 0 },
    "6": { count: 0 }, // Berserk: Damage Buff
    "Berserk": { count: 0 },
    "12": { count: 0 }, // Buff: Generic Buff
    "Buff": { count: 0 },
    "13": { count: 0 }, // HigherMorale: Damage + Healing Buff
    "HigherMorale": { count: 0 },

    // --- Multi-Hit Single Target Skills (Target nearest, re-target on kill) ---
    "2": { count: 3, isSingleTarget: true, delay: 0.2, descriptionIsPerHit: true }, // Arrows (Per Arrow)
    "Arrows": { count: 3, isSingleTarget: true, delay: 0.2, descriptionIsPerHit: true },
    "3": { count: 5, isSingleTarget: true, delay: 0.2, descriptionIsPerHit: true }, // Shuriken (Per Shuriken)
    "Shuriken": { count: 5, isSingleTarget: true, delay: 0.2, descriptionIsPerHit: true },
    "11": { count: 5, isAOE: true, interval: 0.2, delay: 0.1, descriptionIsPerHit: true }, // Lightning: Damage split into 5 (RE)
    "Lightning": { count: 5, isAOE: true, interval: 0.2, delay: 0.1, descriptionIsPerHit: true },

    // --- Multi-Hit AOE Skills ---
    "4": { count: 8, isAOE: true, interval: 0.15, descriptionIsPerHit: true }, // Shout (Per Hit)
    "Shout": { count: 8, isAOE: true, interval: 0.15, descriptionIsPerHit: true },
    "5": { count: 5, isAOE: true, interval: 0.3, delay: 1.0, descriptionIsPerHit: true }, // Meteorite (Per Hit)
    "Meteorite": { count: 5, isAOE: true, interval: 0.3, delay: 1.0, descriptionIsPerHit: true },
    "16": { count: 3, isAOE: true, interval: 0.3, delay: 0.5, descriptionIsPerHit: true }, // CannonBarrage (Per Hit)
    "CannonBarrage": { count: 3, isAOE: true, interval: 0.3, delay: 0.5, descriptionIsPerHit: true },

    // --- Single Hit AOE Skills ---
    "7": { count: 2, isAOE: true, delay: 0.25 }, // Stampede (Avg 2 hits/target, Per Hit)
    "Stampede": { count: 2, isAOE: true, delay: 0.25, damageIsPerHit: true },
    "8": { count: 3, isAOE: true, delay: 0.5, damageIsPerHit: true }, // Thorns: 3 full-damage pulses (RE)
    "Thorns": { count: 3, isAOE: true, delay: 0.5, damageIsPerHit: true },
    "9": { count: 1, isAOE: true, delay: 1.5 }, // Bomb (Total)
    "Bomb": { count: 1, isAOE: true, delay: 1.5 },
    "10": { count: 1, isAOE: true, delay: 0.5 }, // Worm (Total)
    "Worm": { count: 1, isAOE: true, delay: 0.5 },
    "14": { count: 15, isAOE: true, interval: 0.2, delay: 0.5 }, // RainOfArrows (Total / hits)
    "RainOfArrows": { count: 15, isAOE: true, interval: 0.2, delay: 0.5 },
    "15": { count: 3, isAOE: true, delay: 0.5, interval: 0.25, damageIsPerHit: true, descriptionIsPerHit: true }, // StrafeRun (Per Hit)
    "StrafeRun": { count: 3, isAOE: true, delay: 0.5, interval: 0.25, damageIsPerHit: true, descriptionIsPerHit: true },

    // --- Summon Skills (Creates entity that attacks periodically) ---
    "17": { count: 10, isAOE: false, isSingleTarget: true, interval: 0.8, isDuration: true, damageIsPerHit: true, descriptionIsPerHit: true }, // Drone
    "Drone": { count: 10, isAOE: false, isSingleTarget: true, interval: 0.8, isDuration: true, damageIsPerHit: true, descriptionIsPerHit: true },
};

// === Attack timing (reverse-engineered from libil2cpp.so; RVAs for build 2026_10_08_09_03 in
// docs/attack-timing.md) ===
// Combat runs at 10 sim-ticks/s. One continuous AttackTimer per unit: it counts 0 -> windup
// (fires the hit) -> AttackDuration (resets), with NO reset at the windup fire. Per tick the
// timer advances by dt*attackSpeedMultiplier, where dt = floor(2^32/10)/2^32 ~= 0.09999999976s.
// All quantities are FD6 raw (value*1e6); the multiply truncates toward zero.
export const SIM_DT_RAW = 429496729; // floor(2^32 / 10)

// Per-tick timer increment in FD6 raw units for a given attack-speed multiplier (>=1).
export function attackIncRaw(mult: number): number {
    return Math.floor((SIM_DT_RAW * Math.round(mult * 1e6)) / 4294967296) || 1;
}

/**
 * FD6.op_Implicit(F64) (FromF64 0x71961B4): raw_fd6 = (raw_q32 * 10^6) >> 32, a floor. Weapon
 * windup and attack duration are F64 config values that SetUnitWeapon converts this way, so
 * 0.6666667000390589 (the Q32.32 of 2/3) is 666666 micro, not the rounded 666667.
 */
export function fd6MicroFromF64(seconds: number): number {
    const raw = BigInt(Math.round(seconds * 4294967296));
    return Number((raw * 1000000n) >> 32n);
}

/** Ticks to climb `micro` FD6 units at `inc` per tick; a phase always costs at least one tick. */
const climbTicks = (micro: number, inc: number) => Math.max(1, Math.ceil(micro / inc));

// Single-attack cycle in ticks: ceil(AttackDuration / inc) ticks + 1 idle re-acquire tick.
// WINDUP-INDEPENDENT (windup & recovery share one timer). Reproduces the measured table exactly.
export function attackCycleTicks(mult: number, attackDuration = 1.5): number {
    return climbTicks(fd6MicroFromF64(attackDuration), attackIncRaw(mult)) + 1;
}

// Single-attack interval (seconds). Each tick = 0.1s.
export function attackIntervalSeconds(mult: number, attackDuration = 1.5): number {
    return attackCycleTicks(mult, attackDuration) * 0.1;
}

// Double-attack cycle in ticks (both strikes, idle tick included). On a proc the game does NOT
// keep the timer: it re-seeds it to floor(0.75 * windup) from scratch (HandleUnits 0x77F3D34,
// re-seed 0x77F482C..0x77F4874), so the overshoot past the windup at the first fire is lost:
//   ceil(W / inc)                      first strike
// + ceil((D - floor(0.75 * W)) / inc)  re-seeded climb: second strike at W, then on to D
// + 1                                  idle re-acquire tick
export function doubleCycleTicks(mult: number, windup: number, attackDuration = 1.5): number {
    const inc = attackIncRaw(mult);
    const W = fd6MicroFromF64(windup);
    const D = fd6MicroFromF64(attackDuration);
    return climbTicks(W, inc) + climbTicks(D - Math.floor(W * 0.75), inc) + 1;
}

// Double-attack cycle (seconds), both strikes included.
export function doubleCycleSeconds(mult: number, windup: number, attackDuration = 1.5): number {
    return doubleCycleTicks(mult, windup, attackDuration) * 0.1;
}

// Gap between the two strikes of a double (seconds): the climb from floor(0.75*W) back to W.
export function doubleSecondStrikeSeconds(mult: number, windup: number): number {
    const W = fd6MicroFromF64(windup);
    return climbTicks(W - Math.floor(W * 0.75), attackIncRaw(mult)) * 0.1;
}

// Steady-state weapon hits per second for a double chance d (each roll is independent and a
// double cannot chain): (1 + d) hits per ((1 - d) * single + d * double) seconds.
export function weaponHitsPerSecond(mult: number, windup: number, attackDuration: number, doubleChance: number): number {
    const d = Math.min(Math.max(doubleChance, 0), 1);
    const single = attackIntervalSeconds(mult, attackDuration);
    const dbl = doubleCycleSeconds(mult, windup, attackDuration);
    return (1 + d) / ((1 - d) * single + d * dbl);
}
