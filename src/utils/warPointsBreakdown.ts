/**
 * WAR POINTS BREAKDOWN — turning one clan mate's published summary back into itemised rows.
 * =========================================================================================
 *
 * `src/utils/warPoints.ts` already computes everything on this screen. Every category it emits
 * carries `parts: Record<string, number>` — the itemised split — and a documented invariant:
 *
 *     Σ (plain keys) === points          keys prefixed `excluded:` are NOT in points
 *
 * `clan_share` publishes only the eight totals and the ceilings (`ClanShareProvenanceEntry.ceiling`
 * is Σ of the `excluded:` keys, collapsed to one number). The itemisation is thrown away at publish
 * time, and it has to be, because fifty of these documents share a 16 KB-per-member budget.
 *
 * So this module does NOT invent the missing rows. It RE-RUNS the engine on the reader's machine
 * over the trees and resources the member did publish, and reads `parts` off the result.
 *
 * THE ONE HARD PROBLEM, AND THE ONLY HONEST ANSWER TO IT
 * -----------------------------------------------------
 * A recomputation is a SECOND answer. `MemberSummaryCard`'s header has said since it was written
 * that nothing may be recomputed, for a good reason: the reader's game-data version, and the parts
 * of the publisher's profile that `clan_share` does not carry, both move the number. Rendering
 * rows that sum to something other than the headline would break exactly the invariant this file
 * exists to display.
 *
 * The answer is not to trust the recomputation. It is to CHECK it, per category, against the figure
 * the member actually published, and to show rows only where the check passes:
 *
 *     reconciled  ⇔  recomputed points === published points
 *                 ∧  recomputed Σ excluded === published ceiling
 *                 ∧  recomputed confidence === published confidence
 *
 * When all three agree, the recomputed `parts` are provably the itemisation OF THE PUBLISHED
 * NUMBER: the rows sum to the headline because they are the same computation. When any of them
 * disagrees, the category shows NO rows and says which input is missing or that the game-data
 * versions differ. That turns the weakness into the feature — the reader is told precisely which
 * five of eight categories can be itemised and why the other three cannot.
 *
 * WHAT `clan_share` DOES NOT CARRY, measured against the sixteen `misc.*` keys the engine reads
 * ---------------------------------------------------------------------------------------------
 * `ClanContext.readResources()` publishes eleven of them. These five are absent, and each one is
 * named in `SHARE_INPUT_GAPS` together with the categories it silences:
 *
 *     forgeLevel                        forge (no age drop table ⇒ unavailable), forgeSpend (the
 *                                       coin sink is "every upgrade above level N", and N defaults
 *                                       to 1, i.e. the whole ladder)
 *     useGemsInCalculators              forgeSpend (the gem half; the flag defaults to off, so a
 *                                       reader counts no gems for a member who opted in)
 *     eggSummonLevel, eggSummonProgress eggs (the eggshell rarity mix; a Mythic hatch pays 64x a
 *     petAscensionLevel                      Common one, so the summoner's row is the whole answer),
 *     simulateAscensionInCalculators         and pets, whose ceiling is `hatchableEggs x 1250`
 *
 * `eggSlots` is absent too but feeds only the hatch-feasibility NOTE, which is published verbatim
 * in `prov.notes`, so nothing is lost.
 *
 * THE CLOCK IS PART OF THE INPUT, AND IT IS PUBLISHED
 * --------------------------------------------------
 * `tech` runs the greedy optimiser, which awards a point only when an upgrade COMPLETES on a tech
 * war day — so the figure is a step function of the instant the plan starts. Recomputing at the
 * reader's `Date.now()` would fail to reconcile for no reason but the hour. `share.at` is the
 * epoch-ms the publisher computed at, so that is the clock used here, which also makes
 * `techTimeLimitHours` (the hours left in the war week) come out identical. Measured on the
 * harness fixture: with the reader's clock `tech` reconciled 0 times out of 3 real shares; with
 * `share.at`, 3 of 3.
 *
 * NOT A HOOK, AND NO REACT: the roster memoises calls to this, the timing probe runs it in a loop,
 * and `reverseForge/scratch/breakdown_probe.tsx` runs it 50 times to measure the cost.
 */

import type { ClanShare } from '../services/clanApi';
import { AGES, RARITIES } from './constants';
import type { WarCategory } from './guildWarUtils';
import {
    WAR_CATEGORIES,
    computeWarPoints,
    type WarCategoryPoints,
    type WarConfidence,
    type WarPointsConfigs,
    type WarPointsProfile,
    type WarPointsResult,
} from './warPoints';

/* ------------------------------------------------------------------------------------------ *
 * The inputs the share does not carry
 * ------------------------------------------------------------------------------------------ */

export interface ShareInputGap {
    /** Player-facing name of the thing that is missing. Never the `misc` key. */
    label: string;
    /** Categories whose figure this input moves, so a withheld row can name the cause. */
    affects: WarCategory[];
}

/**
 * Derived by reading `computeWarPoints` — every `misc.*` it touches, minus the eleven
 * `readResources()` publishes — and PROVED at runtime by the reconciliation check, which is what
 * actually decides whether a category is itemised. This table only supplies the wording.
 */
export const SHARE_INPUT_GAPS: ShareInputGap[] = [
    { label: 'forge level', affects: ['forge', 'forgeSpend'] },
    { label: 'whether they let calculators spend their gems', affects: ['forgeSpend'] },
    { label: 'egg summoner level and ascension', affects: ['eggs', 'pets'] },
];

/** The gaps that could explain a given category refusing to reconcile. */
export function gapsFor(category: WarCategory): string[] {
    return SHARE_INPUT_GAPS.filter(gap => gap.affects.includes(category)).map(gap => gap.label);
}

/* ------------------------------------------------------------------------------------------ *
 * Rebuilding the engine's input from a published share
 * ------------------------------------------------------------------------------------------ */

/** A count out of member-written JSON: non-negative, integral, finite. Never throws. */
function num(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `{ "12": 3 }` -> `{ 12: 3 }`, dropping anything that is not a real node id or level. */
function treeLevels(raw: unknown): Record<number, number> {
    const out: Record<number, number> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const id = Number(key);
        const level = num(value);
        if (Number.isInteger(id) && id >= 0 && level > 0) out[id] = level;
    }
    return out;
}

/**
 * The `WarPointsProfile` a published share describes.
 *
 * DELIBERATELY INCOMPLETE. The five keys in `SHARE_INPUT_GAPS` are left ABSENT rather than
 * defaulted, because the engine tells "never entered" from "zero" (`recorded()`) and a fabricated
 * `forgeLevel: 1` would make `forge` publish a confident wrong number instead of refusing. Absent
 * is the truth, and the reconciliation check downstream turns it into a withheld row.
 *
 * `forgeCalculator.hammers` is a STRING here because that is what the engine parses (the Forge
 * calculator stores the field as typed text); `res.hammers` is already an integer.
 */
export function profileFromShare(share: ClanShare): WarPointsProfile {
    const res = (share?.res || {}) as Partial<ClanShare['res']>;
    const eggs = (res.eggs || {}) as Record<string, unknown>;
    const keys = (res.keys || {}) as Record<string, unknown>;

    const ownedEggs: Record<string, number> = {};
    for (const rarity of RARITIES) ownedEggs[rarity] = num(eggs[rarity]);

    return {
        misc: {
            coins: num(res.coins),
            gemCount: num(res.gems),
            forgeCalculator: { hammers: String(num(res.hammers)) },
            skillCalculatorTickets: num(res.skillTickets),
            mountCalculatorWinders: num(res.clockWinders),
            eggshellCount: num(res.eggshells),
            techPotions: num(res.techPotions),
            ownedEggs,
            dungeonKeyCounts: {
                Hammer: num(keys.Hammer),
                Skill: num(keys.Skill),
                Egg: num(keys.Egg),
                Potion: num(keys.Potion),
            },
        },
        techTree: {
            Forge: treeLevels(share?.trees?.Forge),
            Power: treeLevels(share?.trees?.Power),
            SkillsPetTech: treeLevels(share?.trees?.SkillsPetTech),
            Clan: treeLevels(share?.trees?.Clan),
        },
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Labels — from the keys the engine really emits, not from a guessed list
 * ------------------------------------------------------------------------------------------ */

/**
 * The four dungeon key names, as the Dungeons page titles them.
 *
 * The engine's `parts` keys here are `Object.keys(DUNGEON_KEY_TASKS)` — `Hammer`, `Skill`, `Egg`,
 * `Potion`, which are the app's own `misc.dungeonKeyCounts` field names. Copied from
 * `src/pages/Dungeons.tsx`'s `DUNGEON_TABS` (it exports nothing) so the roster and the page call
 * the same dungeon the same thing.
 */
const DUNGEON_LABELS: Record<string, string> = {
    Hammer: 'Hammer Thief keys',
    Skill: 'Skill Dungeon keys',
    Egg: 'Egg Dungeon keys',
    Potion: 'Potion Dungeon keys',
};

/**
 * Every literal `parts` key the engine emits, in the order the categories declare them, with the
 * sentence a player would use. Read off `warPoints.ts` rather than guessed:
 *
 *   forgeSpend  `coins`, `gems`, `excluded:coinsBeyondKnownForgeSink`, `excluded:gemsNotAllocatedHere`
 *   skills      `summons`
 *   mounts      `summons`, `excluded:mergeCeiling`
 *   pets        `excluded:mergeCeiling`
 *   tech        `excluded:completionsNotTimedToAWarDay`
 *   dungeons    the four dungeon key names (above)
 *   forge       an `AGES` entry, or `Age<n>` when the config names an age this app does not know
 *   eggs        `held:<Rarity>` and `shells:<Rarity>`
 *
 * A key that is in none of these is humanised by `sentenceCase` — a new engine part must degrade
 * to a readable phrase, never to a raw identifier on screen and never to a silently dropped row
 * (dropping one would break the sum, which is the whole point of the block).
 */
const PART_LABELS: Partial<Record<WarCategory, Record<string, string>>> = {
    forgeSpend: {
        coins: 'Coins spent in the forge',
        gems: 'Gems spent in the forge',
        'excluded:coinsBeyondKnownForgeSink': 'Coins with nothing left to buy',
        'excluded:gemsNotAllocatedHere': 'Gems held back for research',
    },
    skills: { summons: 'Skills summoned with tickets' },
    mounts: { summons: 'Mounts summoned with winders', 'excluded:mergeCeiling': 'If every mount were also merged' },
    pets: { 'excluded:mergeCeiling': 'If every hatched egg gave one pet merge' },
    tech: { 'excluded:completionsNotTimedToAWarDay': 'Research that finishes off a war day' },
};

/** `coinsBeyondKnownForgeSink` -> `Coins beyond known forge sink`. The last-resort humaniser. */
function sentenceCase(key: string): string {
    const words = key
        .replace(/[_:]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other';
}

/**
 * One `parts` key as a player-facing row label.
 *
 * The `excluded:` prefix is stripped before anything else, so it can never reach the screen: the
 * fact that a row is excluded is carried by which GROUP it is rendered in, not by its text.
 */
export function partLabel(category: WarCategory, key: string): string {
    const exact = PART_LABELS[category]?.[key];
    if (exact) return exact;

    const bare = key.startsWith('excluded:') ? key.slice('excluded:'.length) : key;

    if (category === 'dungeons' && DUNGEON_LABELS[bare]) return DUNGEON_LABELS[bare];
    // `forge` keys are age names: `AGES[ageIdx] || "Age<n>"`. Both read as an age to a player.
    if (category === 'forge') {
        if (AGES.includes(bare)) return `${bare.replace('-', ' ')} age gear`;
        const numbered = /^Age(\d+)$/.exec(bare);
        if (numbered) return `Age ${Number(numbered[1]) + 1} gear`;
    }
    if (category === 'eggs') {
        const split = /^(held|shells):(.+)$/.exec(bare);
        if (split && RARITIES.includes(split[2])) {
            return split[1] === 'held' ? `${split[2]} eggs on hand` : `${split[2]} eggs from eggshells`;
        }
    }
    return sentenceCase(bare);
}

/* ------------------------------------------------------------------------------------------ *
 * The two currencies of a clan node — `ValuePerLevel` and `PointsPerLevel`
 * ------------------------------------------------------------------------------------------ */

/**
 * Which clan node's `ValuePerLevel` multiplies each war category.
 *
 * READ OFF `warPoints.ts`'s eight `emit(...)` call sites — the second argument of each — not
 * recalled and not guessed. It is duplicated here because `warPoints.ts` is read-only for this
 * feature and exports no such table, so the copy is CHECKED at runtime rather than trusted:
 * `categoryCurrencies()` compares the node it looks up against `WarCategoryPoints.categoryBonus`,
 * the fraction the engine really applied, and refuses to render anything when the two disagree. A
 * table that drifts therefore produces a withheld block, never a wrong multiplier on screen.
 *
 * `pets` is in here even though its figure is always `unavailable`: the node still exists, its
 * `ValuePerLevel` still scales the merge CEILING the engine publishes, and a leader asking "is my
 * pet-merge node worth another level" deserves the same answer as everybody else.
 */
export const CATEGORY_MULTIPLIER_NODE: Record<WarCategory, string> = {
    tech: 'WarPointsFromTechUpgrade',
    forge: 'WarPointsFromForging',
    forgeSpend: 'WarPointsFromForgeSpend',
    dungeons: 'WarPointsFromDungeonKey',
    skills: 'WarPointsFromSkillSummon',
    mounts: 'WarPointsFromMountSummon',
    eggs: 'WarPointsFromEggHatch',
    pets: 'WarPointsFromPetMerge',
};

/**
 * The `GuildTechTreeUpgradeLibrary.json` entry for one clan node, as the caller has to hand it over.
 *
 * Deliberately a plain struct rather than the raw config object: this module is React-free and
 * config-free by design (the roster's harness runs it with no `useGameData` anywhere), and taking
 * the four numbers means the caller has already decided which config version they came from.
 *
 * `useGameData` NORMALISES this library — `ValuePerLevel` is doubled for versions before
 * `2026_08_21_00_29` — so what arrives here must be what that hook served, never the raw file.
 */
export interface GuildNodeDef {
    maxLevel: number;
    /** `PointsPerLevel`: clan tech points charged ONCE, per level, to raise the node. A price. */
    costPerLevel: number;
    /** `PointsPerInfiniteLevel`: the price of a level past `maxLevel`. 0 when the node caps hard. */
    costPerInfiniteLevel: number;
    /** `ValuePerLevel`: the fraction each level adds to the category multiplier. */
    valuePerLevel: number;
    /** `ValuePerInfiniteLevel`: the smaller fraction a level past `maxLevel` adds. */
    valuePerInfiniteLevel: number;
}

/**
 * The two numbers a clan node contributes, kept apart because they are not the same kind of thing.
 *
 * THE WHOLE POINT OF THIS TYPE is that `multiplier` and `costOfNextLevel` never meet in one column.
 * One is dimensionless and recurring — it scales every point the category ever scores, on every day
 * the category pays. The other is a one-off price in clan tech points, which are bought with guild
 * potions or gems and are not war points at all. A UI that put them side by side under one heading
 * would invite exactly the addition that makes both meaningless.
 */
export interface CategoryCurrencies {
    category: WarCategory;
    /** The config key. For test hooks only — a UI must show `getTechNodeName(node)` instead. */
    node: string;
    /** The member's level in that node, summed over its occurrences in their published Clan tree. */
    level: number;
    maxLevel: number;

    // ---- the recurring one: ValuePerLevel ----
    /** `1 + categoryBonus`, taken from the ENGINE, not re-derived. `1` for a member with no levels. */
    multiplier: number;
    /** What `multiplier` becomes at `level + 1`. Past `maxLevel` this uses the infinite value. */
    nextMultiplier: number;
    /** The fraction `level + 1` adds — `valuePerLevel`, or `valuePerInfiniteLevel` past the cap. */
    nextValueStep: number;

    // ---- the one-off one: PointsPerLevel ----
    /** Clan tech points the NEXT level costs. Past `maxLevel` this is `costPerInfiniteLevel`. */
    costOfNextLevel: number;
    /** Guild potions per clan tech point, from the config. `null` when the config does not say. */
    potionsPerPoint: number | null;

    /**
     * What one more level would do to THIS member's figure for THIS category, in war points.
     *
     * `basePoints * nextValueStep`, where `basePoints` is the engine's own pre-multiplier figure —
     * so it is the same arithmetic `emit` does, not an estimate.
     *
     * `null` in two cases, and the second one was a real over-claim caught on screen:
     *   * the category published no usable base (an `unavailable` one has `basePoints === 0` by
     *     construction, and a zero multiplied by anything is not an answer worth printing);
     *   * THE CATEGORY DID NOT RECONCILE. `basePoints` then belongs to a recomputation the reader
     *     has already refused — the `tech` row of the harness fixture recomputes 123,605 against a
     *     published 0, and the block was offering "one more level is worth 3,746 more war points"
     *     three lines under "working this figure out again gives a different number". The multiplier
     *     and the price survive (one is read off their own published clan tree, the other is config)
     *     but a war-point delta off an unverified base does not.
     */
    nextLevelWorth: number | null;
}

/**
 * The two currencies for one category, or `null` when they cannot be shown honestly.
 *
 * `null` in four cases, all of them measured rather than assumed:
 *   * no `GuildNodeDef` — the reader's config version ships no clan tech tree library (21 of the 23
 *     selectable ones do not), so there is no `ValuePerLevel` and no price to name;
 *   * `CATEGORY_MULTIPLIER_NODE` names a node whose bonus does not match the fraction the engine
 *     applied to this category. That means this table has drifted from `warPoints.ts`'s emit sites,
 *     and a mislabelled multiplier is worse than none;
 *   * the engine could not resolve any clan bonus at all (`clanBonuses` empty AND a non-zero
 *     `categoryBonus` — a contradiction that should be impossible, so it is refused rather than
 *     rationalised);
 *   * a non-finite number anywhere in the config entry.
 */
export function categoryCurrencies(params: {
    category: WarCategory;
    /** The engine's own entry for this category, for `categoryBonus` and `basePoints`. */
    entry: WarCategoryPoints | undefined;
    /** Every clan bonus the engine resolved, by node type — `WarPointsResult.clanBonuses`. */
    clanBonuses: Record<string, number>;
    /** The member's clan levels, by node TYPE. Summed by the caller from their published tree. */
    levelsByNode: Record<string, number>;
    /** `GuildTechTreeUpgradeLibrary.json[node]`, already normalised by `useGameData`. */
    def: GuildNodeDef | null | undefined;
    /** `GuildBaseConfig.TechTreeDonationCurrencies` → guild potions per clan tech point. */
    potionsPerPoint?: number | null;
    /**
     * Did this category's itemisation reconcile against the published figure?
     *
     * Gates `nextLevelWorth` and nothing else. See that field: the multiplier and the price stand on
     * the member's own published clan tree and on the config, but a war-point delta computed from a
     * base the reader has just refused is a number with no owner.
     */
    reconciled: boolean;
}): CategoryCurrencies | null {
    const { category, entry, clanBonuses, levelsByNode, def } = params;
    if (!entry || !def) return null;

    const node = CATEGORY_MULTIPLIER_NODE[category];
    if (!node) return null;

    const finite = (n: unknown): number => {
        const v = typeof n === 'number' ? n : Number(n);
        return Number.isFinite(v) ? v : 0;
    };

    const maxLevel = Math.max(0, Math.floor(finite(def.maxLevel)));
    const valuePerLevel = finite(def.valuePerLevel);
    const valuePerInfiniteLevel = finite(def.valuePerInfiniteLevel);
    const costPerLevel = Math.max(0, Math.round(finite(def.costPerLevel)));
    const costPerInfiniteLevel = Math.max(0, Math.round(finite(def.costPerInfiniteLevel)));
    if (valuePerLevel <= 0 && valuePerInfiniteLevel <= 0) return null;

    const level = Math.max(0, Math.floor(finite(levelsByNode[node])));

    /**
     * THE CHECK. `clanNodeValue` in `warPoints.ts` is `perLevel × min(level, max) + perInfinite ×
     * overflow`, and `readClanBonuses` sums it over every occurrence of the type. Re-deriving it
     * from the same inputs must land on the fraction the engine put in `categoryBonus`; if it does
     * not, either this table names the wrong node or the reader's config differs from the one the
     * engine ran on, and in both cases nothing here may be rendered.
     *
     * The tolerance is 1e-9 and it is for float addition only (0.04 × 7 is not 0.28 in binary),
     * not a licence for a near-miss: a wrong node is out by whole percent, not by 1e-16.
     */
    const derived = maxLevel > 0 && level > maxLevel
        ? valuePerLevel * maxLevel + valuePerInfiniteLevel * (level - maxLevel)
        : valuePerLevel * level;
    const applied = finite(clanBonuses[node]);
    if (Math.abs(derived - finite(entry.categoryBonus)) > 1e-9) return null;
    if (Math.abs(applied - finite(entry.categoryBonus)) > 1e-9) return null;

    const pastCap = maxLevel > 0 && level >= maxLevel;
    const nextValueStep = pastCap ? valuePerInfiniteLevel : valuePerLevel;
    // A hard-capped node (`ValuePerInfiniteLevel: null`) has no next level to price or to value.
    if (nextValueStep <= 0) {
        return {
            category, node, level, maxLevel,
            multiplier: 1 + applied,
            nextMultiplier: 1 + applied,
            nextValueStep: 0,
            costOfNextLevel: 0,
            potionsPerPoint: params.potionsPerPoint ?? null,
            nextLevelWorth: null,
        };
    }

    const base = params.reconciled ? Math.max(0, finite(entry.basePoints)) : 0;
    return {
        category,
        node,
        level,
        maxLevel,
        multiplier: 1 + applied,
        nextMultiplier: 1 + applied + nextValueStep,
        nextValueStep,
        costOfNextLevel: pastCap ? costPerInfiniteLevel : costPerLevel,
        potionsPerPoint: params.potionsPerPoint ?? null,
        nextLevelWorth: base > 0 ? Math.round(base * nextValueStep) : null,
    };
}

/* ------------------------------------------------------------------------------------------ *
 * One category, itemised
 * ------------------------------------------------------------------------------------------ */

export interface BreakdownRow {
    /** The raw `parts` key. For React keys and test hooks only — never rendered. */
    key: string;
    label: string;
    points: number;
}

/** What the member published for one category, as `MemberSummaryCard` already sanitized it. */
export interface PublishedCategory {
    points: number;
    /** Σ of the publisher's `excluded:` parts, or 0 when they named none. */
    ceiling: number;
    /** `unknown` for a `v1` share, which recorded no provenance at all. */
    confidence: WarConfidence | 'unknown';
}

/** Why a category could not be itemised. `null` when it could. */
export type WithheldReason =
    | { kind: 'points'; recomputed: number; published: number }
    | { kind: 'ceiling'; recomputed: number; published: number }
    | { kind: 'confidence'; recomputed: WarConfidence; published: WarConfidence | 'unknown' };

export interface CategoryBreakdown {
    category: WarCategory;
    /** True when the recomputation provably describes the published figure. */
    reconciled: boolean;
    withheld: WithheldReason | null;
    /** Named inputs the share does not carry that could explain a mismatch. May be empty. */
    gaps: string[];
    /** Rows that ARE in the total. Σ points === `total`. */
    counted: BreakdownRow[];
    /** Rows that are NOT in the total — the ceilings the engine deliberately refuses to count. */
    excluded: BreakdownRow[];
    /** Σ `counted`. Equal to the published figure whenever `reconciled`. */
    total: number;
    /** Σ `excluded`. */
    ceiling: number;
    /** The engine's own numbers that are not war points: potions spent, forges performed. */
    diagnostics: Record<string, number>;
}

/** Sorts descending by points so the row that matters is first, with a stable tie-break. */
function toRows(category: WarCategory, parts: Record<string, number>, excluded: boolean): BreakdownRow[] {
    return Object.entries(parts)
        .filter(([key, value]) => key.startsWith('excluded:') === excluded && Number.isFinite(value) && value > 0)
        .map(([key, value]) => ({ key, label: partLabel(category, key), points: Math.round(value) }))
        .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label));
}

function itemise(
    category: WarCategory,
    entry: WarCategoryPoints | undefined,
    published: PublishedCategory,
): CategoryBreakdown {
    const counted = entry ? toRows(category, entry.parts, false) : [];
    const excluded = entry ? toRows(category, entry.parts, true) : [];
    const ceiling = excluded.reduce((sum, row) => sum + row.points, 0);
    const recomputed = entry ? entry.points : 0;

    /**
     * Three checks, and the ORDER matters: report the one a reader can act on.
     *
     * The rows are shown only when all three pass, so which one is reported changes nothing about
     * what is rendered — but "their figure is 4.1 M and mine is 2.6 M" is a far more useful thing
     * to read than "the confidence markers differ", and a points mismatch always drags the
     * confidence with it.
     */
    let withheld: WithheldReason | null = null;
    if (recomputed !== published.points) {
        withheld = { kind: 'points', recomputed, published: published.points };
    } else if (ceiling !== published.ceiling) {
        withheld = { kind: 'ceiling', recomputed: ceiling, published: published.ceiling };
    } else if (entry && entry.confidence !== published.confidence) {
        withheld = { kind: 'confidence', recomputed: entry.confidence, published: published.confidence };
    }

    return {
        category,
        reconciled: withheld === null,
        withheld,
        gaps: withheld ? gapsFor(category) : [],
        counted,
        excluded,
        // Σ of the rows, not `entry.points`: this is the number the UI puts under the rows, and it
        // has to be arrived at the same way a reader adds them up. `emit` rounds each part on its
        // own, so the two can legitimately sit a point or two apart, and the sum is the honest one.
        total: counted.reduce((sum, row) => sum + row.points, 0),
        ceiling,
        diagnostics: entry ? { ...entry.diagnostics } : {},
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Mounts — the question the owner asked, in the words a player uses
 * ------------------------------------------------------------------------------------------ */

/**
 * Whether an ascension changes what this member's winders are worth.
 *
 * `possible: false` is not a hedge, it is a measurement of the engine. `computeWarPoints`'s mount
 * branch (`warPoints.ts` ~950-984) never calls `simulateSummonPool`: `Summon<Rarity>Mount` pays 600
 * flat, so the rarity mix cancels and the whole category is `units x 600` with no level, progress
 * or ascension term anywhere in it. `misc.mountAscensionLevel` exists in `Profile.ts` and the
 * engine does not read it (`grep -n "mountAscension" src/utils/warPoints.ts` finds nothing). So
 * there is no projection at the current ascension state to compare against the one after ascending
 * — not a hard comparison, an absent one — and this renders nothing rather than a guess.
 *
 * The egg summoner IS ascension-driven (`startAscension: misc.petAscensionLevel`,
 * `simulateAscension: misc.simulateAscensionInCalculators !== false`, `maxAscension: 3`), so the
 * comparison exists there in principle — but `clan_share` publishes neither field, so the baseline
 * would be a fabricated "level 1, never ascended" member. Also refused, and for that reason.
 */
export interface AscensionVerdict {
    possible: boolean;
    /** One sentence, ready to render. Says what could not be compared and why. */
    reason: string;
}

export const MOUNT_ASCENSION_VERDICT: AscensionVerdict = {
    possible: false,
    reason:
        'Whether to ascend cannot be answered from this: the engine prices every mount at the same '
        + 'flat rate whichever summoner level it came from, so it never reads a mount ascension at '
        + 'all and there is no before-and-after to compare.',
};

export interface MountsStory {
    /** True when the mounts category reconciled, i.e. these numbers describe the published figure. */
    known: boolean;
    /** Points from the summon task — the counted half. */
    summonPoints: number;
    /** Points the merge task would add — a ceiling, never counted. */
    mergePoints: number;
    /** Engine diagnostics: `winders`, `summons`, `mounts`, `costPerSummon`. */
    winders: number;
    summons: number;
    mounts: number;
    costPerSummon: number;
    /**
     * Winders that cannot buy another summon — `winders - summons x costPerSummon`, straight out of
     * the engine's own diagnostics. This is the only "wasted resources" figure the engine supports,
     * and it is not the ascension question; it is rendered as what it is.
     */
    strandedWinders: number;
    ascension: AscensionVerdict;
}

function mountsStory(breakdown: CategoryBreakdown): MountsStory {
    const d = breakdown.diagnostics;
    const winders = num(d.winders);
    const summons = num(d.summons);
    const costPerSummon = num(d.costPerSummon);
    return {
        known: breakdown.reconciled,
        summonPoints: breakdown.counted.reduce((sum, row) => sum + row.points, 0),
        mergePoints: breakdown.ceiling,
        winders,
        summons,
        mounts: num(d.mounts),
        costPerSummon,
        strandedWinders: Math.max(0, winders - summons * costPerSummon),
        ascension: MOUNT_ASCENSION_VERDICT,
    };
}

/* ------------------------------------------------------------------------------------------ *
 * The whole member
 * ------------------------------------------------------------------------------------------ */

export interface MemberBreakdown {
    categories: Record<WarCategory, CategoryBreakdown>;
    mounts: MountsStory;
    /** How many of the eight could be itemised. The honest headline for the block. */
    reconciledCount: number;
    /** The engine result, kept so a caller can reach `notes` or `clanBonuses` without a second run. */
    result: WarPointsResult;
    /** Wall-clock cost of the engine pass, in ms. Rendered nowhere; measured by the probe. */
    ms: number;
}

/**
 * Re-run the engine over one member's published share and itemise every category it can prove.
 *
 * `published` is what `MemberSummaryCard` already read out of the document — passing it in rather
 * than re-parsing the share keeps ONE sanitizer for member-written numbers, which is the rule that
 * file is built on.
 *
 * Returns `null` for a member who published nothing. That is the caller's cue to keep saying
 * "nothing shared": there is no document, so there is nothing to itemise and no zero to print.
 */
export function buildMemberBreakdown(
    share: ClanShare | null,
    published: Record<WarCategory, PublishedCategory>,
    configs: WarPointsConfigs,
): MemberBreakdown | null {
    if (!share || typeof share !== 'object') return null;

    /**
     * The publisher's clock, not the reader's. See the header: `tech` is a step function of the
     * instant the research plan starts, so recomputing at `Date.now()` would fail to reconcile for
     * no reason but the hour. A share with no usable `at` falls back to the wall clock and `tech`
     * then simply will not reconcile, which is the correct outcome rather than a hidden guess.
     */
    const at = Number(share.at);
    const now = Number.isFinite(at) && at > 0 ? new Date(at) : new Date();

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = computeWarPoints(profileFromShare(share), configs, { now });
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const categories = {} as Record<WarCategory, CategoryBreakdown>;
    let reconciledCount = 0;
    for (const category of WAR_CATEGORIES) {
        const entry = itemise(
            category,
            result.categories[category],
            published[category] ?? { points: 0, ceiling: 0, confidence: 'unknown' },
        );
        categories[category] = entry;
        if (entry.reconciled) reconciledCount += 1;
    }

    return { categories, mounts: mountsStory(categories.mounts), reconciledCount, result, ms: t1 - t0 };
}

/* ------------------------------------------------------------------------------------------ *
 * Time-anchored numbers — what the share would have to carry
 * ------------------------------------------------------------------------------------------ */

/**
 * Does anything in `clan_share` say whether a member's projection is anchored to real completion
 * times?
 *
 * NO, and this constant records the audit rather than a guess. The research plan a member builds in
 * the planner lives in `profile.misc.techPlanQueue` / `techPlanStartDate` (read by
 * `useTreePlanner`), the sleep window in `plannerSleepStart` / `plannerSleepEnd`, and alarms are a
 * per-DEVICE push subscription (`PushPanel`), not a profile field at all.
 * `ClanContext.readResources()` publishes none of them, and the only time-ish field in the whole
 * document — `prov.hrs` — is `warWeekHoursRemaining()`, the same number for every member in the
 * clan on the same day. It says nothing about whether anybody has a plan.
 *
 * So every figure on the roster is a RESOURCE total: "what this bank is worth if it is all spent
 * before the reset". Nothing on the roster is anchored to a completion time, and the UI says so
 * once, for everybody, instead of sorting members into two groups it cannot tell apart.
 *
 * WHAT WOULD BE NEEDED (a `v3` share; deliberately not implemented here, publishing is not this
 * module's to change): one boolean and one integer — whether `techPlanQueue` is non-empty, and the
 * epoch-ms the last queued upgrade completes. ~30 bytes per member, well inside the 16 KB cap.
 */
export const ANCHORED_TIMES_IN_SHARE = false;

export const ANCHORED_TIMES_LINE =
    'Nobody on this roster has time-anchored numbers. A clan summary carries resource totals only. '
    + 'what a bank is worth if it is all spent before the reset. And no part of it records whether '
    + 'a member is running the research planner or has alarms set, so this reader cannot tell who is '
    + 'working to a schedule and who is holding a pile.';
