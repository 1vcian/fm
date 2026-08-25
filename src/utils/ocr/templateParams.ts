// Validated parameters for the template-driven AutoSync readers, consolidated from the Python
// prototypes (reverseForge/*.py) that were measured against the ground-truth oracle. Single source
// of truth for the CV constants the TS readers share.

export type RGB = [number, number, number];

// ---- Item AGE palette (10 ages, index 0..9 = AutoItemMapping.Age) — tile colour encodes the age.
// From src/index.css --color-*-rgb; matched 24/24 + 8/8 diverse (Interstellar/Space/Modern/Multiverse/Underworld/Divine).
export const AGE_COLORS: RGB[] = [
    [241, 241, 241], // 0 Primitive
    [93, 216, 255],  // 1 Medieval
    [93, 255, 138],  // 2 Early-Modern
    [252, 255, 93],  // 3 Modern
    [255, 93, 93],   // 4 Space
    [213, 93, 255],  // 5 Interstellar
    [117, 255, 238], // 6 Multiverse
    [125, 93, 255],  // 7 Quantum
    [176, 120, 121], // 8 Underworld
    [255, 158, 13],  // 9 Divine
];

// ---- RARITY palette (6, index 0..5) for pets/mounts/skills. Confirmed from game config; it is the
// first 6 of the age palette (verified: Ultimate=red validated, Mythic=purple validated on 8 examples).
export const RARITY_COLORS: RGB[] = [
    [241, 241, 241], // 0 Common   #F1F1F1
    [93, 216, 255],  // 1 Rare     #5DD8FF
    [93, 255, 138],  // 2 Epic     #5DFF8A
    [252, 255, 93],  // 3 Legendary#FCFF5D
    [255, 93, 93],   // 4 Ultimate #FF5D5D
    [213, 93, 255],  // 5 Mythic   #D55DFF
];
export const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

// ---- Skills grid: FIXED cell order (rarity-rank then CombatSkill enumId, 3 per rarity). Cell index
// -> skillId, so the grid is read by position; only per-cell level + which 3 are dimmed(equipped).
export const SKILLS_ORDER = [
    'Meat', 'Arrows', 'Shout', 'Shuriken', 'Berserk',
    'CannonBarrage', 'Thorns', 'Buff', 'RainOfArrows', 'Morale',
    'Meteorite', 'Bomb', 'Stampede', 'Worm', 'Lightning',
    'HigherMorale', 'StrafeRun', 'Drone',
] as const;

// ---- Header currency icon x-bands (fraction of width) for classification + value reading.
export const CURRENCY_XBAND: Record<string, [number, number]> = {
    egg: [0.0, 0.20], ticket: [0.0, 0.20], clock: [0.0, 0.20],
    coin: [0.42, 0.72], gem: [0.66, 0.95],
};

// ---- Ascension-star detection (topology: enclosed gold pocket, saturation-gated, bottom row).
// Star band relative to a tile rect (x,y,w,h); thresholds scale-independent where noted.
export const STAR = {
    bandX0: -0.06, bandX1: 1.06,   // fraction of tile width, expanded
    bandY0: 0.40, bandY1: 1.30,    // fraction of tile height, generous
    // NOTE: there is deliberately no absolute `darkThreshold` here. The outline cut is derived
    // inside starCounter.ts from the band's own 99th-percentile luminance (DARK_FRAC), because a
    // star is only ever "much darker than the brightest thing beside it" — a tile dimmed behind a
    // modal renders its gold star at grey ~65, which a fixed cut of 90 swallowed whole, zeroing
    // every pocket. Do not reintroduce a constant grey level here.
    minSaturation: 100,            // HSV S (0..255) of the enclosed pocket (gold, not white digit-loops)
    minAreaFrac: 0.006,            // pocket area >= this * tileW * tileH
    aspectLo: 0.4, aspectHi: 1.6,
    rowTolFrac: 0.05,              // pockets within this * tileH of the bottom-most = same star cluster
    max: 3,
};

// ---- Per-stat max % bounds (SecondaryStatLibrary UpperRange*100) to catch +/- digit misreads.
export const STAT_MAX: Record<string, number> = {
    CriticalChance: 12, CriticalMulti: 80, BlockChance: 5, HealthRegen: 4, LifeSteal: 20,
    DoubleDamageChance: 20, DamageMulti: 15, MeleeDamageMulti: 50, RangedDamageMulti: 15,
    AttackSpeed: 40, SkillDamageMulti: 30, SkillCooldownMulti: 7, HealthMulti: 15,
};

export const LEVEL_MAX = 150; // sanity bound for level reads

/** Nearest palette index (squared RGB distance). Returns {idx, dist}. */
export function nearestColor(rgb: RGB, palette: RGB[]): { idx: number; dist: number } {
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const dr = rgb[0] - palette[i][0], dg = rgb[1] - palette[i][1], db = rgb[2] - palette[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = i; }
    }
    return { idx: best, dist: Math.sqrt(bd) };
}

/** Hue-based nearest palette index (robust to gloss/white-card desaturation) — used for rarity/age
 * when the tile is desaturated by overlays. Returns idx; caller supplies a desaturation gate. */
export function nearestByHue(rgb: RGB, palette: RGB[]): number {
    const hue = (c: RGB): number => {
        const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d < 1e-6) return -1;
        let h: number;
        if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360; return h;
    };
    const th = hue(rgb); if (th < 0) return 0; // undefined hue -> Common/Primitive (grey)
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const ph = hue(palette[i]); if (ph < 0) continue;
        let d = Math.abs(th - ph); if (d > 180) d = 360 - d;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}
