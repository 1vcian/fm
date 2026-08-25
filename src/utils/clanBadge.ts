/**
 * Clan badge — 4 small integers instead of an uploaded image.
 * ---------------------------------------------------------------------------
 * A clan's emblem is stored as four smallints on `clans`:
 *
 *   badge_shape       0..15  cell in EmblemShapes.png (4x4 grid)
 *   badge_shape_color        GuildEmblemColors.json ColorId, ColorType Background
 *   badge_icon        0..63  cell in EmblemIcons.png  (8x8 grid)
 *   badge_icon_color         GuildEmblemColors.json ColorId, ColorType Foreground
 *
 * = 8 bytes per clan and zero storage/CDN cost: the art and the colours are
 * both game data the app already ships (public/Texture2D/<version>/ and
 * public/parsed_configs/<version>/GuildEmblemColors.json).
 *
 * THE COLOURS ARE NOT OURS. Which ids are legal, and what they look like, comes
 * from GuildEmblemColors.json at runtime — 7 Background ids and 2 Foreground
 * ids today. This module therefore knows the *field width* of a colour column
 * (BADGE_COLOR_ID_LIMIT, below) but never a colour, a count or a hex; anything
 * that needs to know what a colour IS goes through src/utils/emblem.ts with the
 * loaded config in hand.
 *
 * There is deliberately no contrast/visibility check anywhere in here. An
 * earlier draft of this file shipped a 16-entry palette of its own and a 3:1
 * WCAG floor to police it. Both are gone: the palette is the game's, so
 * "is this colour legible on our card background" is not a question this app
 * gets to answer by rejecting a colour — the game already shipped it, players
 * already use it, and a badge must look like the one in the game.
 *
 * Pure (no React, no fetch) so it can be exercised from node — see
 * reverseForge/scratch/clan_badge_roundtrip.ts.
 */

import {
    EMBLEM_ICON_COUNT,
    EMBLEM_SHAPE_COUNT,
    type EmblemColors,
    type EmblemSelection,
    coerceEmblemColorId,
} from './emblem';

/* -------------------------------------------------------------------------- */
/* Type + cardinalities                                                       */
/* -------------------------------------------------------------------------- */

export interface ClanBadge {
    /** EmblemShapes.png cell, 0..15 */
    shape: number;
    /** GuildEmblemColors.json ColorId with ColorType 'Background' */
    shapeColor: number;
    /** EmblemIcons.png cell, 0..63 */
    icon: number;
    /** GuildEmblemColors.json ColorId with ColorType 'Foreground' */
    iconColor: number;
}

/** 16 — derived from EmblemShapes.png's 4x4 grid. */
export const BADGE_SHAPE_COUNT = EMBLEM_SHAPE_COUNT;
/** 64 — derived from EmblemIcons.png's 8x8 grid. */
export const BADGE_ICON_COUNT = EMBLEM_ICON_COUNT;

/**
 * How wide a colour FIELD is — not how many colours exist.
 *
 * The number of colours is data (7 + 2 today) and will change if the game ships
 * more. Two things nonetheless need a fixed width: the smallint columns, and
 * the shareable code's radix (see the code spec below). Pinning the field at 16
 * ids means a colour drop that adds ids up to 15 changes nothing here — no
 * re-radix, no invalidated codes, no migration to the codec. A drop that pushes
 * a ColorId past 15 needs a new code version, and that is a deliberate,
 * visible breakage rather than silent aliasing.
 */
export const BADGE_COLOR_ID_LIMIT = 16;

/** Addressable badges in the shareable code: 16 * 16 * 64 * 16 = 262 144. */
export const BADGE_SPACE = BADGE_SHAPE_COUNT * BADGE_COLOR_ID_LIMIT * BADGE_ICON_COUNT * BADGE_COLOR_ID_LIMIT;

/* -------------------------------------------------------------------------- */
/* Cosmetic names (labels/tooltips only — never persisted)                     */
/* -------------------------------------------------------------------------- */

export const BADGE_SHAPE_NAMES: readonly string[] = [
    'Pointed Shield', 'Square', 'Spade Shield', 'Rounded Square',
    'Round Foot', 'Swallowtail', 'Chamfered', 'Arched Foot',
    'Curved Sides', 'Notched Pennant', 'Battlement', 'Wide Swallowtail',
    'Crenellated', 'Angled Swallowtail', 'Wavy Sides', 'Angled Foot',
];

export const BADGE_ICON_NAMES: readonly string[] = [
    'Members', 'Flag', 'Crossed Swords', 'Star', 'Torch', 'Laurel', 'Rhombus', 'Flask',
    'Crosshair', 'Galleon', 'Flower', 'Paw', 'Helmet', 'Trophy', 'Tower', 'Molecule',
    'Gauntlet', 'Pocket Watch', 'Heart', 'Medal', 'Spark', 'Crown', 'Book', 'Anchor',
    'Anvil', 'Coin', 'Bolt', 'Crossed Arrows', 'Ammunition', 'Knight', 'Tickets', 'Wing',
    'Star Medal', 'Tree', 'Mallet', 'Sword', 'Ship Wheel', 'Axe', 'Wrench', 'Vial',
    'Eye', 'Spider', 'Horseshoe', 'Horn', 'Clover', 'Leaves', 'Apple', 'Revolver',
    'Rose', 'Compass', 'Cup', 'Droplet', 'Lion', 'Hourglass', 'Cobra', 'Shield',
    'Gem', 'Bat', 'Flame', 'Triskelion', 'Owl', 'Bull', 'Butterfly', 'Lotus',
];

export function badgeShapeName(shape: number): string {
    return BADGE_SHAPE_NAMES[clampInt(shape, 0, BADGE_SHAPE_COUNT - 1)];
}

export function badgeIconName(icon: number): string {
    return BADGE_ICON_NAMES[clampInt(icon, 0, BADGE_ICON_COUNT - 1)];
}

/* -------------------------------------------------------------------------- */
/* Clamping / defaults / randomisation                                        */
/* -------------------------------------------------------------------------- */

function clampInt(value: unknown, min: number, max: number, fallback: number = min): number {
    // null / '' would become 0 through Number(), which is a real value here, so
    // treat every empty-ish input as "missing" and use the fallback instead.
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * The "unset" badge: all zeros, which is what the `clans` column defaults are
 * (0006 defaults badge_icon_color to the first Foreground id instead, because
 * the tightened CHECK will not accept 0 there).
 *
 * A zero colour is not a claim that 0 is a valid Foreground id — it is not.
 * Colour ids are resolved through the config at render time
 * (emblemComposition -> coerceEmblemColorId), which folds 0 onto the first
 * Foreground colour the game actually ships. That is the same fold the database
 * applies, so an unset badge looks the same everywhere.
 */
export const DEFAULT_BADGE: ClanBadge = { shape: 0, shapeColor: 0, icon: 0, iconColor: 0 };

/**
 * Coerce anything (missing row, NULL columns, a hand-edited API response, an
 * out-of-range value that slipped past the CHECK constraints) into a
 * STRUCTURALLY valid badge: cells inside their sheet, colour ids inside the
 * column's field width.
 *
 * It cannot validate a colour id — whether 3 is a Background colour is a
 * question only GuildEmblemColors.json answers, and this module never loads it.
 * That second, semantic step happens in emblemComposition().
 */
export function clampBadge(badge: Partial<ClanBadge> | null | undefined): ClanBadge {
    if (!badge) return { ...DEFAULT_BADGE };
    return {
        shape: clampInt(badge.shape, 0, BADGE_SHAPE_COUNT - 1, DEFAULT_BADGE.shape),
        shapeColor: clampInt(badge.shapeColor, 0, BADGE_COLOR_ID_LIMIT - 1, DEFAULT_BADGE.shapeColor),
        icon: clampInt(badge.icon, 0, BADGE_ICON_COUNT - 1, DEFAULT_BADGE.icon),
        iconColor: clampInt(badge.iconColor, 0, BADGE_COLOR_ID_LIMIT - 1, DEFAULT_BADGE.iconColor),
    };
}

export function badgesEqual(a: ClanBadge, b: ClanBadge): boolean {
    return a.shape === b.shape && a.shapeColor === b.shapeColor
        && a.icon === b.icon && a.iconColor === b.iconColor;
}

/** Badge -> the four values <Emblem> takes. */
export function badgeSelection(badge: ClanBadge): EmblemSelection {
    return {
        shape: badge.shape,
        icon: badge.icon,
        shapeColorId: badge.shapeColor,
        iconColorId: badge.iconColor,
    };
}

/**
 * Snap a badge's colours onto ids the game actually defines.
 *
 * Same fold as the renderer, exposed separately so a picker can hand back a
 * value that is already legal for set_clan_badge() rather than one the server
 * would reject.
 */
export function normalizeBadgeColors(badge: ClanBadge, colors: EmblemColors): ClanBadge {
    if (!colors.loaded) return badge;
    const shapeColor = coerceEmblemColorId(colors.background, badge.shapeColor);
    const iconColor = coerceEmblemColorId(colors.foreground, badge.iconColor);
    return {
        ...badge,
        shapeColor: shapeColor ?? badge.shapeColor,
        iconColor: iconColor ?? badge.iconColor,
    };
}

function randomInt(bound: number): number {
    const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
    if (g?.getRandomValues) {
        const buf = new Uint32Array(1);
        g.getRandomValues(buf);
        // Modulo bias is irrelevant for a cosmetic badge.
        return buf[0] % bound;
    }
    return Math.floor(Math.random() * bound);
}

/**
 * Client-side random badge (the picker's "Random" button), drawn only from
 * colours the config actually offers. The authoritative random badge at clan
 * creation is assigned by the clans_random_badge trigger in SQL.
 *
 * Nothing has to keep the two colours apart the way the old invented palette
 * did: a shape can only take a Background colour and a symbol only a
 * Foreground one, and those two sets are disjoint by construction.
 */
export function randomBadge(colors: EmblemColors): ClanBadge {
    const bg = colors.background;
    const fg = colors.foreground;
    return {
        shape: randomInt(BADGE_SHAPE_COUNT),
        shapeColor: bg.length ? bg[randomInt(bg.length)].ColorId : DEFAULT_BADGE.shapeColor,
        icon: randomInt(BADGE_ICON_COUNT),
        iconColor: fg.length ? fg[randomInt(fg.length)].ColorId : DEFAULT_BADGE.iconColor,
    };
}

/* -------------------------------------------------------------------------- */
/* Shareable code                                                             */
/* -------------------------------------------------------------------------- */

/**
 * CODE SPEC (this is the contract the SQL side must mirror byte for byte).
 *
 * 1. Pack, big-endian, most significant field first, with BADGE_COLOR_ID_LIMIT
 *    (16) as the colour radix — the field width, not the number of colours in
 *    the config, so adding a colour cannot renumber existing codes:
 *
 *      v = ((shape * 16 + shapeColor) * 64 + icon) * 16 + iconColor
 *
 *    0 <= v <= 262143, i.e. 18 bits — pure integer arithmetic, no bit twiddling,
 *    identical in JS and in plpgsql.
 *
 * 2. Split v into FOUR base-32 digits, most significant first (32^4 = 1048576,
 *    so v always fits and the code is fixed length, zero padded):
 *
 *      d0 = v / 32768 (floor)      d2 = (v / 32) mod 32
 *      d1 = (v / 1024) mod 32      d3 = v mod 32
 *
 * 3. One check digit, weights 1..4 over the data digits, MODULO 31:
 *
 *      c = (1*d0 + 2*d1 + 3*d2 + 4*d3) mod 31        (0..30)
 *
 *    The modulus is prime on purpose. Mod 32 (the obvious choice for base32)
 *    is worthless here: with an even weight w a digit error of 32/gcd slips
 *    through — e.g. weight 2 misses every error of exactly 16, so `00000` and
 *    `0G000` would both be valid. With a prime modulus and weights 1..4 (all
 *    coprime to 31, and their pairwise differences 1..3 likewise) every
 *    single-digit substitution and every adjacent transposition is rejected,
 *    with ONE documented hole: the digits 0 and 31 are congruent mod 31, so
 *    swapping a '0' for a 'Z' (or vice versa) in a data position is not
 *    detected. '0' and 'Z' are not confusable by eye or by keyboard, so that is
 *    an acceptable trade for keeping the code 5 characters and the arithmetic
 *    trivial in plpgsql. A side effect: the check digit is never 31, so a
 *    trailing 'Z' is always an invalid code.
 *
 * 4. Map the five digits through Crockford base32 (no I, L, O, U — so no
 *    1/I/l, 0/O confusion and no accidental profanity):
 *
 *      0123456789ABCDEFGHJKMNPQRSTVWXYZ
 *
 * Result: a fixed 5-character code such as `07Q2W`. Decoding is case
 * insensitive, tolerates separators (space, '-', '_'), and folds the excluded
 * letters (I/l -> 1, L -> 1, O/o -> 0) the way Crockford prescribes.
 *
 * A decoded code is only STRUCTURALLY valid: its colour digits are 0..15 and
 * may name ids the game does not define. The renderer folds those the same way
 * it folds a legacy database row, so a code always draws something.
 *
 * Reference SQL for whoever owns the migration (immutable, no extensions):
 *
 *   create or replace function clan_badge_code(
 *       p_shape smallint, p_shape_color smallint,
 *       p_icon smallint, p_icon_color smallint) returns text
 *   language sql immutable strict as $$
 *     with a as (select '0123456789ABCDEFGHJKMNPQRSTVWXYZ'::text alpha),
 *     v as (select (((p_shape * 16 + p_shape_color) * 64 + p_icon) * 16
 *                   + p_icon_color)::int n),
 *     d as (select (n / 32768) d0, (n / 1024) % 32 d1,
 *                  (n / 32) % 32 d2, n % 32 d3 from v)
 *     select substr(alpha, d0 + 1, 1) || substr(alpha, d1 + 1, 1)
 *         || substr(alpha, d2 + 1, 1) || substr(alpha, d3 + 1, 1)
 *         || substr(alpha, ((d0 + 2*d1 + 3*d2 + 4*d3) % 31) + 1, 1)
 *     from d, a;
 *   $$;
 */
export const BADGE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BADGE_CODE_LENGTH = 5;
/** Prime modulus of the check digit — see the code spec above. */
export const BADGE_CODE_CHECK_MODULUS = 31;

/** Badge -> 18-bit integer (step 1 of the code spec). */
export function packBadge(badge: ClanBadge): number {
    const b = clampBadge(badge);
    return ((b.shape * BADGE_COLOR_ID_LIMIT + b.shapeColor) * BADGE_ICON_COUNT + b.icon) * BADGE_COLOR_ID_LIMIT + b.iconColor;
}

/** 18-bit integer -> badge (inverse of packBadge). */
export function unpackBadge(value: number): ClanBadge {
    const v = clampInt(value, 0, BADGE_SPACE - 1);
    const iconColor = v % BADGE_COLOR_ID_LIMIT;
    const rest1 = Math.floor(v / BADGE_COLOR_ID_LIMIT);
    const icon = rest1 % BADGE_ICON_COUNT;
    const rest2 = Math.floor(rest1 / BADGE_ICON_COUNT);
    return {
        shape: Math.floor(rest2 / BADGE_COLOR_ID_LIMIT),
        shapeColor: rest2 % BADGE_COLOR_ID_LIMIT,
        icon,
        iconColor,
    };
}

function checkDigit(digits: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += (i + 1) * digits[i];
    return sum % BADGE_CODE_CHECK_MODULUS;
}

/** Badge -> 5-character shareable code. Always succeeds (input is clamped). */
export function badgeToCode(badge: ClanBadge): string {
    const v = packBadge(badge);
    const digits = [
        Math.floor(v / 32768),
        Math.floor(v / 1024) % 32,
        Math.floor(v / 32) % 32,
        v % 32,
    ];
    const all = [...digits, checkDigit(digits)];
    return all.map(d => BADGE_CODE_ALPHABET[d]).join('');
}

/** Strip separators, upper-case, fold the Crockford-excluded letters. */
function normalizeCode(code: string): string {
    return code
        .toUpperCase()
        .replace(/[\s\-_.]/g, '')
        .replace(/[IL]/g, '1')
        .replace(/O/g, '0');
}

/**
 * Code -> badge, or null if the code is not exactly 5 valid base32 characters
 * or the check digit does not match. Never throws.
 */
export function badgeFromCode(code: string | null | undefined): ClanBadge | null {
    if (typeof code !== 'string') return null;
    const s = normalizeCode(code);
    if (s.length !== BADGE_CODE_LENGTH) return null;

    const digits: number[] = [];
    for (const ch of s) {
        const d = BADGE_CODE_ALPHABET.indexOf(ch);
        if (d < 0) return null;
        digits.push(d);
    }

    const data = digits.slice(0, 4);
    if (checkDigit(data) !== digits[4]) return null;

    const v = ((data[0] * 32 + data[1]) * 32 + data[2]) * 32 + data[3];
    if (v >= BADGE_SPACE) return null; // 32^4 > 2^18, so the top range is unused
    return unpackBadge(v);
}

/** True when `code` decodes to a badge. */
export function isBadgeCode(code: string | null | undefined): boolean {
    return badgeFromCode(code) !== null;
}

/* -------------------------------------------------------------------------- */
/* DB row <-> badge                                                           */
/* -------------------------------------------------------------------------- */

/** Shape of the four badge columns as they come back from Supabase. */
export interface ClanBadgeRow {
    badge_shape?: number | null;
    badge_shape_color?: number | null;
    badge_icon?: number | null;
    badge_icon_color?: number | null;
}

export function badgeFromRow(row: ClanBadgeRow | null | undefined): ClanBadge {
    return clampBadge(row ? {
        shape: row.badge_shape ?? undefined,
        shapeColor: row.badge_shape_color ?? undefined,
        icon: row.badge_icon ?? undefined,
        iconColor: row.badge_icon_color ?? undefined,
    } : null);
}

export function badgeToRow(badge: ClanBadge): Required<ClanBadgeRow> {
    const b = clampBadge(badge);
    return {
        badge_shape: b.shape,
        badge_shape_color: b.shapeColor,
        badge_icon: b.icon,
        badge_icon_color: b.iconColor,
    };
}
