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

export const MAX_ACTIVE_PETS = 3;
export const MAX_ACTIVE_SKILLS = 3;

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

// === Attack timing (reverse-engineered from libil2cpp.so, Forge Master 2.8.2) ===
// Combat runs at 10 sim-ticks/s. One continuous AttackTimer per unit: it counts 0 -> windup
// (fires the hit) -> AttackDuration (resets), with NO reset at the windup fire. Per tick the
// timer advances by dt*attackSpeedMultiplier, where dt = floor(2^32/10)/2^32 ~= 0.09999999976s.
// All quantities are FD6 raw (value*1e6); the multiply truncates toward zero.
export const SIM_DT_RAW = 429496729; // floor(2^32 / 10)

// Per-tick timer increment in FD6 raw units for a given attack-speed multiplier (>=1).
export function attackIncRaw(mult: number): number {
    return Math.floor((SIM_DT_RAW * Math.round(mult * 1e6)) / 4294967296) || 1;
}

// Single-attack interval (seconds): ceil(AttackDuration / inc) ticks + 1 idle re-acquire tick,
// each tick = 0.1s. WINDUP-INDEPENDENT (windup & recovery share one timer). AttackDuration is
// 1.5s for every weapon. Reproduces the measured breakpoint table exactly.
export function attackIntervalSeconds(mult: number, attackDuration = 1.5): number {
    const inc = attackIncRaw(mult);
    return (Math.ceil(Math.round(attackDuration * 1e6) / inc) + 1) * 0.1;
}

// Double-attack second-strike delay (seconds): the timer is re-seeded to windup*0.75, so it must
// climb the remaining 0.25*windup to re-fire: ceil(0.25*windup / inc) ticks, minimum 1 tick (0.1s).
// WINDUP-DEPENDENT — this is the ONLY place the weapon's windup changes attack timing.
export function doubleDelaySeconds(mult: number, windup: number): number {
    const inc = attackIncRaw(mult);
    return Math.max(1, Math.ceil((Math.round(windup * 1e6) * 0.25) / inc)) * 0.1;
}
