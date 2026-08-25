/**
 * MemberSummaryCard — one clan mate, exactly as their published summary describes them.
 * ====================================================================================
 *
 * This is the row a war planner reads fifty times, so three rules shape everything below.
 *
 * 1. A MEMBER WHO HAS NEVER PUBLISHED IS NOT A ZERO.
 *    `clan_roster_detail.clan_share` is `null` until the member opts in, and a planner who reads a
 *    fabricated 0 as "this player has nothing to contribute" makes a wrong call. So `points` is
 *    `number | null` all the way through this file: `null` renders as "no data shared yet" (an
 *    amber chip and a dashed border), never as a digit, and `ClanRoster` excludes those members
 *    from every total instead of adding zero.
 *
 * 2. THE SHARE IS MEMBER-WRITTEN DATA. The database validates its TYPE and its SIZE and nothing
 *    else (0005 §4: `jsonb_typeof = 'object'`, 16 KB). Everything here therefore goes through
 *    `readMemberSummary()`, which coerces every number, drops the non-finite ones, clamps the
 *    negatives and never trusts an array's length. Nothing is rendered as HTML.
 *
 * 3. NO PUBLISHED FIGURE IS RECOMPUTED. The eight war categories, their day assignments and the
 *    six-day projection are all read from the share — `src/utils/warPoints.ts` computed them on the
 *    publisher's machine, with the publisher's game config, resources and clan tree. Recomputing
 *    them here would produce a second answer under this reader's config version, which is precisely
 *    the comparison the `cfg` badge exists to warn about. Two things follow, and both are surfaced
 *    on the row rather than hidden:
 *      * `cfg` older/newer than this app's selected version -> a chip saying so, because the point
 *        values and the day assignments MOVE between config versions;
 *      * `v` older than `CLAN_SHARE_VERSION` -> a chip saying the shape is from an older client.
 *
 *    THE ITEMISATION IS THE ONE EXCEPTION, and it is built so that it cannot violate the rule.
 *    `clan_share` publishes eight totals and one collapsed ceiling each; the engine's itemised
 *    `parts` are dropped at publish time, because fifty documents share a 16 KB-per-member budget.
 *    So `memberBreakdown()` re-runs the engine on THIS machine over the trees and resources the
 *    member did publish — and then checks, per category, that it reproduced their figure, their
 *    ceiling and their confidence marker exactly. Rows are shown only where all three match, which
 *    is what makes them provably the itemisation of the published number rather than a second
 *    opinion about it. Where they do not match the category says so and shows nothing. See
 *    `src/utils/warPointsBreakdown.ts`.
 *
 *    It is ON DEMAND because it was measured, not guessed: one engine pass over a profile the tech
 *    optimiser has real work in is 11 ms, so fifty is 495 ms median / 598 ms worst
 *    (`reverseForge/scratch/breakdown_timing.mjs`). The roster paints from the published totals and
 *    a row is itemised when a reader opens it.
 *
 * PROVENANCE IS PART OF THE NUMBER, NOT A FOOTNOTE
 * -----------------------------------------------
 * A `v2` share carries `prov` (see `clanApi.ts`): per category, whether the figure is `exact`, a
 * `lower-bound` or `unavailable`, the publisher's own one-sentence reason, and — where one exists —
 * the CEILING they knowingly left out (the mount-merge half, the pet-merge ceiling, coins past the
 * known forge sink). All three states are drawn differently, because the failure this file exists
 * to prevent is a leader benching a player over a zero that meant "this app cannot see your pet
 * collection":
 *
 *   exact        the number, plain, with a tick.
 *   lower-bound  "≥ n" in amber, and the ceiling as "≤ m" when the publisher gave one.
 *   unavailable  "n/a" — never a digit — plus "≤ m" when a ceiling is known.
 *   unknown      only for a `v1` share, which had no provenance at all: the number is shown muted
 *                with a "~", and the row says it came from an older version of the tool.
 *
 * A `v1` share additionally had three categories that its publisher could not compute at all
 * (`tech`, `forge`, `pets` were structurally 0 — they needed the tree optimiser, the age drop table
 * and a pet collection). Those still read "n/a" here, because a 0 that means "not computed" is the
 * same lie as rule 1. Everything else in a `v1` share reads as a number of unknown provenance.
 *
 * The tree recap deliberately copies `src/components/Profile/MiscPanel.tsx`: the same
 * "{nodes} nodes · {levels} levels · {clan} clan" line, the same amber "to complete · N%" chip and
 * the same amber/red staleness chip, so one player's own tree and a clan mate's tree are read the
 * same way.
 */

import React, { useMemo, useState } from 'react';
import {
    Ban,
    Check,
    ChevronDown,
    ChevronsUp,
    Clock,
    Coins,
    Crown,
    EyeOff,
    GitBranch,
    HelpCircle,
    Info,
    Rabbit,
    Shield,
    Sigma,
    Swords,
    User,
} from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { getTechNodeName } from '../../utils/techUtils';
import { getWarDayName } from '../../utils/guildWarUtils';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { CLAN_SHARE_VERSION } from '../../services/clanApi';
import {
    ANCHORED_TIMES_LINE,
    CATEGORY_MULTIPLIER_NODE,
    categoryCurrencies,
    type CategoryBreakdown,
    type CategoryCurrencies,
    type GuildNodeDef,
    type MemberBreakdown,
    type PublishedCategory,
} from '../../utils/warPointsBreakdown';
import type {
    ClanRole,
    ClanRosterDetailRow,
    ClanShare,
    ClanShareConfidence,
    ClanShareWarCategory,
} from '../../services/clanApi';
import { cn } from '../../lib/utils';
// The footer already renders a config version as "20 Aug 2026 at 22:29 UTC". Showing the raw
// `2026_08_21_00_29` here would be the only place in the app that leaks the folder name.
import { formatVersion } from '../../lib/formatVersion';

/* ------------------------------------------------------------------------------------------ *
 * The four trees
 * ------------------------------------------------------------------------------------------ */

export type TreeName = 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan';

/** Publication order, matching `ClanShare.trees` and the tabs in `TechTreePanel`. */
export const TREE_NAMES: TreeName[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];

export const TREE_LABELS: Record<TreeName, string> = {
    Forge: 'Forge',
    Power: 'Power',
    SkillsPetTech: 'Skills & Pets',
    Clan: 'Clan',
};

export interface TreeNodeDef {
    /** The `globalId` a profile's tech tree is keyed by. */
    id: number;
    type: string;
    /** MaxLevel from the config, with the same fallbacks `MiscPanel` uses (5 player, 20 clan). */
    max: number;
    /**
     * Display name. Not simply `getTechNodeName(type)`: the three player trees repeat every node
     * type once per TIER (measured: Forge has 50 nodes of 10 types, Power 100 of 20), so a plain
     * name list shows the same row five times with five different levels and reads like a bug. The
     * tier is appended only for the types that actually repeat, so the clan tree — 61 nodes, 61
     * distinct types — keeps its bare names.
     */
    label: string;
}

export interface TreeIndexEntry {
    nodes: TreeNodeDef[];
    byId: Record<number, TreeNodeDef>;
    /** Sum of every node's MaxLevel — the denominator of the "to complete" percentage. */
    maxLevels: number;
    /**
     * `GuildTechTreeUpgradeLibrary.json` by node TYPE — the `ValuePerLevel` multiplier and the
     * `PointsPerLevel` price of every clan node. Populated on the `Clan` entry only, and empty when
     * this config version ships no clan tech tree library (21 of the 23 selectable ones do not).
     *
     * It lives here rather than in a second hook because `useTreeIndex` already fetches that exact
     * file for `MaxLevel`, and the rule this file was written to — one hook for the whole roster,
     * four fetches for fifty members instead of two hundred — does not survive a card fetching for
     * itself.
     */
    guildDefs: Record<string, GuildNodeDef>;
    /**
     * Guild potions per clan tech point, from `GuildBaseConfig.TechTreeDonationCurrencies`.
     *
     * `PointsPerLevel` is denominated in clan tech POINTS, and a point is bought with potions at
     * this rate (2 today) or with gems at its own. `null` when the config does not say, in which
     * case the price is shown in points and no conversion is invented. On the `Clan` entry only.
     */
    potionsPerPoint: number | null;
}

export type TreeIndex = Record<TreeName, TreeIndexEntry>;

const EMPTY_TREE_ENTRY: TreeIndexEntry = {
    nodes: [], byId: {}, maxLevels: 0, guildDefs: {}, potionsPerPoint: null,
};

/**
 * globalId -> node type -> MaxLevel, for all four trees.
 *
 * The two id schemes are NOT the same and neither is invented here:
 *   * the three player trees are keyed by `TechTreeMapping.json`'s own `node.id`, which is what
 *     `TechTreePanel` writes into `profile.techTree[tree]`;
 *   * the clan tree has no ids in its config at all — `GuildTechTreePositionLibrary.json` is
 *     categories of node types, and the globalId is their flattened position, exactly as
 *     `src/pages/Clan.tsx` and `TechTreePanel` count it. Getting this wrong would label every
 *     clan node with its neighbour's name, so it is copied rather than re-derived.
 *
 * One hook for the whole roster: `useGameData` caches per version, so calling it here once and
 * passing the result down is four fetches for fifty members instead of two hundred.
 *
 * `enabled` exists because a surface that renders nothing (nobody signed in, no clan) must cost no
 * fetch: an empty file name is `useGameData`'s own "nothing to load", the same trick
 * `ClanContext` uses for the war configs.
 */
export function useTreeIndex(enabled = true): TreeIndex | null {
    const { data: treeMapping } = useGameData<any>(enabled ? 'TechTreeMapping.json' : '');
    const { data: techTreeLibrary } = useGameData<any>(enabled ? 'TechTreeLibrary.json' : '');
    const { data: guildPositionLibrary } = useGameData<any>(enabled ? 'GuildTechTreePositionLibrary.json' : '');
    const { data: guildUpgradeLibrary } = useGameData<any>(enabled ? 'GuildTechTreeUpgradeLibrary.json' : '');
    // Fifth file, for one number: `TechTreeDonationCurrencies` — what a clan tech point costs in
    // guild potions. Without it the node price can only be shown in points, which is true but not
    // actionable, and inventing the rate is the one thing this feature may not do.
    const { data: guildBaseConfig } = useGameData<any>(enabled ? 'GuildBaseConfig.json' : '');

    return useMemo(() => {
        if (!treeMapping?.trees) return null;

        /** Appends "· T<n>" to the names of the types that occur more than once in this tree. */
        const withLabels = (nodes: (Omit<TreeNodeDef, 'label'> & { tier?: number })[]): TreeNodeDef[] => {
            const seen = new Map<string, number>();
            for (const node of nodes) seen.set(node.type, (seen.get(node.type) ?? 0) + 1);
            return nodes.map(node => {
                const name = getTechNodeName(node.type);
                const repeated = (seen.get(node.type) ?? 0) > 1;
                return {
                    id: node.id,
                    type: node.type,
                    max: node.max,
                    label: repeated && node.tier !== undefined ? `${name} · T${node.tier + 1}` : name,
                };
            });
        };

        const build = (nodes: TreeNodeDef[]): TreeIndexEntry => {
            const byId: Record<number, TreeNodeDef> = {};
            let maxLevels = 0;
            for (const node of nodes) {
                byId[node.id] = node;
                maxLevels += node.max;
            }
            return { nodes, byId, maxLevels, guildDefs: {}, potionsPerPoint: null };
        };

        const index = {} as TreeIndex;

        for (const tree of ['Forge', 'Power', 'SkillsPetTech'] as TreeName[]) {
            const raw = (treeMapping.trees?.[tree]?.nodes || []) as
                { id: number; type: string; tier?: number }[];
            index[tree] = build(
                withLabels(
                    raw.map(node => ({
                        id: Number(node.id),
                        type: String(node.type || ''),
                        // MiscPanel's fallback, kept identical so the two "to complete" numbers agree.
                        max: techTreeLibrary?.[node.type]?.MaxLevel || 5,
                        tier: typeof node.tier === 'number' ? node.tier : undefined,
                    })),
                ),
            );
        }

        const clanNodes: (Omit<TreeNodeDef, 'label'> & { tier?: number })[] = [];
        if (guildPositionLibrary) {
            let globalId = 0;
            for (const category of Object.keys(guildPositionLibrary)) {
                for (const type of guildPositionLibrary[category]?.Nodes || []) {
                    clanNodes.push({
                        id: globalId++,
                        type: String(type),
                        max: guildUpgradeLibrary?.[type]?.MaxLevel || 20,
                    });
                }
            }
        }
        index.Clan = build(withLabels(clanNodes));

        // The clan tree's two currencies, kept by node TYPE (the clan tree has one node per type,
        // so a type is a stable key where a globalId shifts when the game inserts a node).
        const guildDefs: Record<string, GuildNodeDef> = {};
        if (guildUpgradeLibrary) {
            for (const node of index.Clan.nodes) {
                const def = guildUpgradeLibrary[node.type];
                if (!def) continue;
                guildDefs[node.type] = {
                    maxLevel: Number(def.MaxLevel) || 0,
                    costPerLevel: Number(def.PointsPerLevel) || 0,
                    costPerInfiniteLevel: Number(def.PointsPerInfiniteLevel) || 0,
                    valuePerLevel: Number(def.ValuePerLevel) || 0,
                    valuePerInfiniteLevel: Number(def.ValuePerInfiniteLevel) || 0,
                };
            }
        }
        index.Clan.guildDefs = guildDefs;

        // `TechTreeDonationCurrencies` is a list of currencies, each with its own `CostPerPoint`.
        // Only the potion one is read: potions are the currency the roster already shows a member
        // holding (`res.guildPotions`), and quoting a gem price next to a potion balance would be
        // the same category error this whole block exists to prevent.
        const donation = guildBaseConfig?.TechTreeDonationCurrencies;
        if (Array.isArray(donation)) {
            const potions = donation.find((c: any) => String(c?.Currency || '') === 'GuildPotions');
            const rate = Number(potions?.CostPerPoint);
            index.Clan.potionsPerPoint = Number.isFinite(rate) && rate > 0 ? rate : null;
        }

        return index;
    }, [treeMapping, techTreeLibrary, guildPositionLibrary, guildUpgradeLibrary, guildBaseConfig]);
}

/* ------------------------------------------------------------------------------------------ *
 * War vocabulary
 * ------------------------------------------------------------------------------------------ */

/** The eight categories in the order `guildWarUtils` declares them. */
export const WAR_CATEGORY_ORDER: ClanShareWarCategory[] = [
    'tech', 'skills', 'mounts', 'eggs', 'pets', 'dungeons', 'forge', 'forgeSpend',
];

export const WAR_CATEGORY_LABELS: Record<ClanShareWarCategory, string> = {
    tech: 'Tech tree',
    skills: 'Skills',
    mounts: 'Mounts',
    eggs: 'Eggs',
    pets: 'Pets',
    dungeons: 'Dungeons',
    forge: 'Forging',
    forgeSpend: 'Forge spend',
};

/**
 * The categories a `v1` share cannot project from resources (see the header). A 0 in one of these
 * means "not computed", so it is rendered as "n/a" rather than as a number.
 */
const NOT_PROJECTED_IN_V1: ClanShareWarCategory[] = ['tech', 'forge', 'pets'];

/* ------------------------------------------------------------------------------------------ *
 * Confidence — the one vocabulary the card, the roster and the totals all speak
 * ------------------------------------------------------------------------------------------ */

/**
 * `unknown` is this file's fourth state and it exists only for a `v1` share: a document published
 * before the tool recorded provenance carries numbers whose trust level nobody wrote down, and
 * guessing one would be exactly the over-claim the caveats are there to prevent.
 */
export type MemberConfidence = ClanShareConfidence | 'unknown';

interface ConfidenceMeta {
    /** Two words at most: this is a chip and a table cell, not a sentence. */
    label: string;
    icon: typeof Check;
    /** Text colour for a number carrying this confidence. */
    text: string;
    /** Chip colour, same three-part recipe as CHIP_AMBER below. */
    chip: string;
    /** Prepended to the figure. "≥" is the whole point of `lower-bound`. */
    prefix: string;
    /** Six words for the legend under the breakdown. */
    legend: string;
    /** What a tooltip says when the publisher gave no reason of their own. */
    fallback: string;
}

export const CONFIDENCE_META: Record<MemberConfidence, ConfidenceMeta> = {
    exact: {
        label: 'exact',
        icon: Check,
        text: 'text-emerald-300',
        chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        prefix: '',
        legend: 'exact for the resources held',
        fallback: 'The game config pays this for the resources held — an expected value where the game rolls dice.',
    },
    'lower-bound': {
        label: 'at least',
        icon: ChevronsUp,
        text: 'text-amber-300',
        chip: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        prefix: '≥ ',
        legend: 'at least this much',
        fallback: 'Something obtainable is knowingly not counted, so the real figure is at or above this one.',
    },
    unavailable: {
        label: 'n/a',
        icon: Ban,
        text: 'text-text-muted',
        chip: 'bg-white/5 text-text-muted border-border',
        prefix: '',
        legend: 'not modelled — not zero',
        fallback: 'The input does not exist in the publisher\'s profile, or the game mechanic is not modelled. This is not a zero.',
    },
    unknown: {
        label: 'unverified',
        icon: HelpCircle,
        text: 'text-text-secondary',
        chip: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
        prefix: '~ ',
        legend: 'unverified — older tool',
        fallback: 'Published by an older version of this tool, which did not record how much each figure can be trusted.',
    },
};

/** Reads a confidence out of member-written JSON. Anything unrecognised is `unknown`, never a lie. */
function readConfidence(value: unknown): MemberConfidence | null {
    return value === 'exact' || value === 'lower-bound' || value === 'unavailable' ? value : null;
}

/**
 * `ClanShare.byDay` is six numbers — Tuesday = 0  Sunday/Monday = 5, the range
 * `getWarDayIndex()` produces and `getWarDayName()` names. A share carrying more (a future config
 * with a longer war) is not truncated: `ClanRoster` widens every strip to the longest it finds.
 */
export const WAR_DAY_COUNT = 6;

/**
 * "Tuesday" -> "Tue", "Sunday/Monday" -> "Sun/Mon". Derived from `getWarDayName()`, so a renamed
 * day follows along; a day past the end of the known week (a share published under a longer war)
 * is named by its number rather than by that helper's "Unknown".
 */
export function shortWarDayName(index: number): string {
    const full = getWarDayName(index);
    if (full === 'Unknown') return `Day ${index + 1}`;
    return full
        .split('/')
        .map(part => part.slice(0, 3))
        .join('/');
}

/* ------------------------------------------------------------------------------------------ *
 * Reading one roster row — the only place the share is parsed
 * ------------------------------------------------------------------------------------------ */

/** Coerces anything to a finite number; `NaN`, `null`, `"12"` and `Infinity` all behave. */
function finite(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** A count that cannot be negative and cannot be fractional. Used for every published number. */
function count(value: unknown): number {
    return Math.max(0, Math.round(finite(value)));
}

/**
 * A published WAR-POINT figure, and whether it is one at all.
 *
 * Stricter than `count()` on purpose, and only for the war numbers. `count()` clamps a hostile
 * value into range and moves on, which is right for the resource chips — "this member claims a
 * sextillion tickets" is a harmless claim about themselves. It is NOT right for a figure that gets
 * ADDED UP: one member publishing `1e21` swamped the clan total and turned the range into
 * "≥ 126M  1s", i.e. one hostile row erased forty-seven honest ones. Clamping it to
 * `MAX_SAFE_INTEGER` would have done the same thing more quietly.
 *
 * So the rule is the strongest one available that is not arbitrary: a war-point figure that is not
 * a non-negative integer JavaScript can represent exactly is not a figure. It contributes nothing,
 * the category reads `unavailable` (never a digit — the same rule as a missing share), and the row
 * says out loud that the member published something impossible.
 */
function warFigure(value: unknown): { points: number; plausible: boolean } {
    if (value === undefined || value === null || value === '') return { points: 0, plausible: true };
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return { points: 0, plausible: false };
    return { points: Math.round(n), plausible: true };
}

export interface MemberWarEntry {
    category: ClanShareWarCategory;
    points: number;
    /** War day indices this category scores on, per the PUBLISHER's config. */
    days: number[];
    /**
     * True when `points` MUST NOT be rendered as a value — an `unavailable` category, or a `v1`
     * share's structural blind spot. Kept as its own flag because it is the one rule in this file
     * that a renderer may not get wrong.
     */
    notProjected: boolean;
    /** How much the publisher said this figure can be trusted. `unknown` for a `v1` share. */
    confidence: MemberConfidence;
    /** `points` before the publisher's clan multiplier, when they published it. */
    base: number | null;
    /** A figure the publisher deliberately did not count. 0 when they named none. */
    ceiling: number;
    /** The publisher's own explanation. Member-written TEXT — never rendered as HTML. */
    reason: string | null;
}

export interface MemberTreeRecap {
    name: TreeName;
    nodes: number;
    levels: number;
    /** Percentage of the attainable levels, or `null` while the configs are still loading. */
    pct: number | null;
    /** `{ [globalId]: level }`, sanitized. */
    levelsById: Record<number, number>;
}

export interface MemberSummary {
    row: ClanRosterDetailRow;
    profileId: string;
    name: string;
    role: ClanRole;
    isMine: boolean;
    power: number | null;

    /** `null` when this member has never published — NOT zero. */
    share: ClanShare | null;
    /**
     * Total obtainable war points, or `null` when nothing was published.
     *
     * Categories the publisher marked `unavailable` contribute 0 here, which keeps this a FLOOR:
     * nothing in the engine over-counts, so a blind category can only make the sum too small. Read
     * it together with `confidence` and `ceiling`.
     */
    points: number | null;
    /** The six-day projection as published, or `null`. */
    byDay: (number | undefined)[] | null;
    /** The same six days with the publisher's own `WarPointsOnDayN` nodes applied (`v2`). */
    dayPts: (number | undefined)[] | null;
    war: MemberWarEntry[];
    /**
     * The same eight figures keyed by category, in the shape `memberBreakdown()` checks its
     * recomputation against.
     *
     * Derived here rather than in the breakdown helper so that member-written numbers pass through
     * exactly ONE sanitizer — `warFigure()` above — whichever surface consumes them. A category
     * whose published figure was impossible arrives here as `unavailable` with 0 points, so a
     * recomputation can never "reconcile" against a number this file already refused.
     */
    published: Record<ClanShareWarCategory, PublishedCategory>;

    // ---- provenance (v2) ----
    /** `false` for a `v1` share: the numbers are there but nothing says how good they are. */
    hasProvenance: boolean;
    /** Confidence in `points` as a whole. `exact` only when all eight categories are. */
    confidence: MemberConfidence;
    /** How many of the eight categories sit in each state. Sums to 8 for any share. */
    counts: Record<MemberConfidence, number>;
    /** Σ of every category's excluded ceiling. `points + ceiling` is the top of the range. */
    ceiling: number;
    /** True when a share exists but not one category could be computed. `points` is then meaningless. */
    allBlind: boolean;
    /**
     * The share contained a figure that is not a war-point number — negative, NaN, Infinity, or too
     * large for an exact integer. Those contribute nothing and their categories read n/a; this flag
     * is what puts a chip on the row instead of letting the row look ordinary.
     */
    implausible: boolean;
    /** The publisher's whole-document caveats (gem allocation, hatch feasibility, empty war days). */
    notes: string[];
    /** Hours of the war week the publisher's tech projection planned over, when they said. */
    techHours: number | null;
    /** The publisher said a game config they needed had not loaded. */
    configIncomplete: boolean;
    /** Points in categories the publisher's config gave no war day. They score on no day. */
    unscheduled: number;
    /** `sum(byDay)` disagrees with the points that DO have days — a foreign or hand-made share. */
    daySplitMismatch: boolean;

    trees: MemberTreeRecap[];
    totalNodes: number;
    totalLevels: number;
    clanNodes: number;

    /** How this member's config version compares with the one this app has selected. */
    configState: 'same' | 'older' | 'newer' | 'unknown';
    configVersion: string | null;
    /** The share's shape version is behind this client's. */
    shapeOutdated: boolean;

    /** Epoch ms the member's client computed the summary. */
    computedAt: number | null;
    /** Whole days since `computedAt`, or `null` when it is unknown. */
    ageDays: number | null;
    /** Epoch ms of the member's last profile sync (`profiles.updated_at`). */
    syncedAt: number;
}

/**
 * Turns one `clan_roster_detail` row into everything both this card and `ClanRoster`'s totals and
 * sorting need. Pure, so the roster can map it over fifty rows in a `useMemo` and the card can stay
 * a renderer.
 */
export function readMemberSummary(
    row: ClanRosterDetailRow,
    options?: { configVersion?: string | null; treeIndex?: TreeIndex | null; now?: number },
): MemberSummary {
    const now = options?.now ?? Date.now();
    const appVersion = (options?.configVersion || '').trim();
    const treeIndex = options?.treeIndex ?? null;

    const share = row.clan_share && typeof row.clan_share === 'object' ? row.clan_share : null;

    // --- trees ---------------------------------------------------------------------------
    const trees: MemberTreeRecap[] = TREE_NAMES.map(name => {
        const raw = (share?.trees?.[name] || {}) as Record<string, unknown>;
        const levelsById: Record<number, number> = {};
        let nodes = 0;
        let levels = 0;
        for (const [key, value] of Object.entries(raw)) {
            const id = Number(key);
            const level = count(value);
            // Zero levels are stripped on publish; a hand-made document may still carry them, and
            // a node with level 0 is not a node the member has.
            if (!Number.isInteger(id) || id < 0 || level <= 0) continue;
            levelsById[id] = level;
            nodes += 1;
            levels += level;
        }
        const maxLevels = treeIndex ? treeIndex[name].maxLevels : 0;
        return {
            name,
            nodes,
            levels,
            pct: maxLevels > 0 ? Math.min(100, Math.round((levels / maxLevels) * 100)) : null,
            levelsById,
        };
    });

    const totalNodes = trees.reduce((sum, t) => sum + t.nodes, 0);
    const totalLevels = trees.reduce((sum, t) => sum + t.levels, 0);
    const clanNodes = trees.find(t => t.name === 'Clan')?.nodes ?? 0;

    // --- war + provenance ------------------------------------------------------------------
    // `prov` is the `v2` sibling of `war`. Absent for a `v1` share, and absent is NOT "exact":
    // every category then reads `unknown`, except the three a `v1` publisher structurally could
    // not compute, which stay "n/a" for the same reason a missing share is not a zero.
    const prov = share && share.prov && typeof share.prov === 'object' ? share.prov : null;
    const hasProvenance = !!prov;

    let implausible = false;

    const war: MemberWarEntry[] = WAR_CATEGORY_ORDER.map(category => {
        const entry = share?.war?.[category];
        const figure = warFigure(entry?.points);
        if (!figure.plausible) implausible = true;
        const days = Array.isArray(entry?.days)
            ? entry!.days.map(d => Math.round(finite(d))).filter(d => d >= 0)
            : [];

        const provEntry = prov?.cat && typeof prov.cat === 'object' ? prov.cat[category] : undefined;
        const declared = readConfidence(provEntry?.conf);
        const blindInV1 =
            !!share && !prov && finite(share.v) <= 1 && figure.points === 0 &&
            NOT_PROJECTED_IN_V1.includes(category);

        // An impossible number outranks whatever the publisher claimed about it.
        const confidence: MemberConfidence = !figure.plausible
            ? 'unavailable'
            : declared ?? (blindInV1 ? 'unavailable' : 'unknown');
        const reasonRaw = typeof provEntry?.why === 'string' ? provEntry.why.trim() : '';
        const ceiling = warFigure(provEntry?.ceiling);
        if (!ceiling.plausible) implausible = true;

        return {
            category,
            points: figure.points,
            days,
            // The rule from the header, in one place: an `unavailable` figure is never a digit.
            notProjected: confidence === 'unavailable',
            confidence,
            base: provEntry && provEntry.base !== undefined ? warFigure(provEntry.base).points : null,
            ceiling: ceiling.points,
            reason: !figure.plausible
                ? 'This member published a figure that is not a war-point number, so it is counted as nothing.'
                : reasonRaw ? reasonRaw.slice(0, 400) : null,
        };
    });

    const points = share ? war.reduce((sum, e) => sum + e.points, 0) : null;
    const unscheduled = war.reduce((sum, e) => (e.days.length === 0 ? sum + e.points : sum), 0);
    const scheduled = (points ?? 0) - unscheduled;

    const counts: Record<MemberConfidence, number> = { exact: 0, 'lower-bound': 0, unavailable: 0, unknown: 0 };
    let ceiling = 0;
    const published = {} as Record<ClanShareWarCategory, PublishedCategory>;
    for (const entry of war) {
        counts[entry.confidence] += 1;
        ceiling += entry.ceiling;
        published[entry.category] = {
            points: entry.points,
            ceiling: entry.ceiling,
            confidence: entry.confidence,
        };
    }

    // The SUM's confidence. A declared one wins (the publisher's engine knows things this reader
    // does not); otherwise it is derived, and derived the same way the engine does it: all-exact is
    // exact, nothing computable at all is unavailable, and everything in between is a floor —
    // because a blind category contributes 0 and so can only make the total too small.
    const declaredOverall = readConfidence(prov?.conf);
    let confidence: MemberConfidence;
    if (!share) confidence = 'unknown';
    else if (declaredOverall) confidence = declaredOverall;
    else if (!prov) confidence = 'unknown';
    else if (counts.unavailable === war.length) confidence = 'unavailable';
    else if (counts.exact === war.length) confidence = 'exact';
    else confidence = 'lower-bound';

    const allBlind = !!share && counts.unavailable === war.length;

    /**
     * Which days anything computable actually feeds.
     *
     * A category that came back `unavailable` still publishes its day list — the day assignment is a
     * property of the game config, not of whether this member could compute the number — so a day
     * whose every contributing category is blind receives 0 points purely because nothing could be
     * measured for it. Printing that `0` is the reader inventing a measurement.
     *
     * `unknown` (a v1 share, which recorded no provenance) counts as computable: the reader has no
     * grounds to refuse those numbers, only to label them.
     */
    const dayHasComputable = Array.from({ length: WAR_DAY_COUNT }, () => false);
    for (const entry of war) {
        if (entry.confidence === 'unavailable') continue;
        for (const d of entry.days) {
            if (d >= 0 && d < dayHasComputable.length) dayHasComputable[d] = true;
        }
    }

    /**
     * The day split. `undefined` — rendered as an em dash — in two cases, never 0.
     *
     *  1. The published figure is not a war-point number. A rejected figure means "this reader
     *     refuses to repeat what was published", and printing `0` for it is indistinguishable, in a
     *     strip of numbers, from a member who genuinely scores nothing that day. The row still
     *     carries the "impossible figure" chip, and dropping the day from `daySum` makes the
     *     split-mismatch check fire too, so nothing is hidden.
     *  2. The figure is 0 AND no computable category feeds that day. This is the same rule as
     *     `notProjected` and as the all-blind row (which prints six em dashes), extended to the
     *     PARTLY blind row that used to slip through: a fresh profile computes `skills` as a real
     *     `>= 0` floor and the other seven categories as `unavailable`, so `allBlind` stayed false
     *     and the strip printed six literal zeros under a headline that correctly said `>= 0`.
     *     It now reads `0 — 0 — — —`: zero where a floor really was computed, em dash where nothing
     *     could be.
     *
     * The 0-only condition matters. A day carrying a NON-zero figure is never blanked, even when the
     * category list says nothing should feed it — that is a self-contradictory document, and the
     * honest response is to show the number and let `daySplitMismatch` flag it, not to hide it.
     */
    let byDay: (number | undefined)[] | null = null;
    if (share) {
        const raw = Array.isArray(share.byDay) ? share.byDay : [];
        const width = Math.max(WAR_DAY_COUNT, raw.length);
        byDay = Array.from({ length: width }, (_, i) => {
            const figure = warFigure(raw[i]);
            if (!figure.plausible) { implausible = true; return undefined; }
            if (figure.points === 0 && !dayHasComputable[i]) return undefined;
            return figure.points;
        });
    }
    // The boosted split, when the publisher holds a `WarPointsOnDayN` node. Only trusted when it is
    // at least as wide as `byDay`; a short or hostile array would otherwise silently zero days.
    let dayPts: (number | undefined)[] | null = null;
    if (byDay && Array.isArray(prov?.dayPts) && prov!.dayPts!.length >= byDay.length) {
        const base = byDay;
        dayPts = Array.from({ length: byDay.length }, (_, i) => {
            const figure = warFigure(prov!.dayPts![i]);
            if (!figure.plausible) { implausible = true; return undefined; }
            // A boosted 0 on a day the base strip refused is refused for the same reason: a
            // multiplier applied to nothing measurable is still nothing measurable.
            if (figure.points === 0 && base[i] === undefined) return undefined;
            return figure.points;
        });
    }

    const notes = Array.isArray(prov?.notes)
        ? prov!.notes!.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
            .slice(0, 8)
            .map(n => n.trim().slice(0, 300))
        : [];
    // A day the reader refused is `undefined` and contributes nothing, which is exactly what makes
    // `daySplitMismatch` below fire for a document carrying an impossible day figure.
    const daySum = byDay ? byDay.reduce<number>((sum, n) => sum + (n ?? 0), 0) : 0;
    // Categories with no day are expected to be missing from the split, so the comparison is
    // against the SCHEDULED points, not the total. Only a genuinely inconsistent document trips it.
    const daySplitMismatch = !!share && daySum !== scheduled;

    // --- provenance ------------------------------------------------------------------------
    const configVersion = typeof share?.cfg === 'string' && share.cfg ? share.cfg : null;
    let configState: MemberSummary['configState'] = 'unknown';
    if (configVersion && appVersion) {
        configState = configVersion === appVersion ? 'same' : configVersion < appVersion ? 'older' : 'newer';
    }

    const computedAt = share && Number.isFinite(share.at) && share.at > 0 ? Number(share.at) : null;
    const ageDays = computedAt !== null ? Math.max(0, Math.floor((now - computedAt) / 86400000)) : null;
    const syncedAt = Date.parse(row.updated_at || '') || 0;

    return {
        row,
        profileId: row.profile_id,
        name: row.name || 'Unnamed',
        role: row.role,
        isMine: !!row.is_mine,
        power: row.power === null || row.power === undefined ? null : finite(row.power),
        share,
        points,
        byDay,
        dayPts,
        war,
        published,
        hasProvenance,
        confidence,
        counts,
        ceiling,
        allBlind,
        implausible,
        notes,
        techHours: prov && Number.isFinite(finite(prov.hrs)) && prov.hrs !== undefined ? count(prov.hrs) : null,
        configIncomplete: !!prov && prov.full === false,
        unscheduled,
        daySplitMismatch,
        trees,
        totalNodes,
        totalLevels,
        clanNodes,
        configState,
        configVersion,
        shapeOutdated: !!share && finite(share.v) < CLAN_SHARE_VERSION,
        computedAt,
        ageDays,
        syncedAt,
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Small shared bits of chrome
 * ------------------------------------------------------------------------------------------ */

const CHIP = 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border shrink-0 whitespace-nowrap';
const CHIP_AMBER = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
const CHIP_RED = 'bg-red-500/15 text-red-400 border-red-500/30';
const CHIP_MUTED = 'bg-white/5 text-text-muted border-border';

const ROLE_META: Record<ClanRole, { label: string; icon: typeof Crown; className: string }> = {
    owner: { label: 'Owner', icon: Crown, className: 'text-amber-400' },
    admin: { label: 'Admin', icon: Shield, className: 'text-accent-tertiary' },
    member: { label: 'Member', icon: User, className: 'text-text-muted' },
};

/** Exact value, grouped. Used wherever a planner might add numbers up by hand. */
function exact(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

/** The confidence marker, as one icon. Colour and shape both differ, so it survives greyscale. */
const ConfidenceIcon: React.FC<{ confidence: MemberConfidence; className?: string }> = ({
    confidence,
    className,
}) => {
    const meta = CONFIDENCE_META[confidence];
    const Icon = meta.icon;
    return <Icon className={cn('w-3 h-3 shrink-0', meta.text, className)} aria-hidden="true" />;
};

/**
 * The tooltip behind a figure: what the marker means, then the publisher's own words.
 *
 * The publisher's sentence goes LAST and is clearly theirs, because it is member-written text and a
 * reader has to be able to tell the tool's explanation from a clan mate's claim.
 */
function confidenceTitle(confidence: MemberConfidence, reason: string | null, ceiling: number): string {
    const meta = CONFIDENCE_META[confidence];
    const parts = [`${meta.label.toUpperCase()} — ${meta.fallback}`];
    if (ceiling > 0) parts.push(`Not counted, at most: ${exact(ceiling)} points.`);
    if (reason) parts.push(`They published: “${reason}”`);
    return parts.join('\n');
}

/** "5 exact · 2 at least · 1 n/a" as icons and counts. Only the states present are drawn. */
const ConfidenceCounts: React.FC<{ counts: Record<MemberConfidence, number>; className?: string }> = ({
    counts,
    className,
}) => {
    const order: MemberConfidence[] = ['exact', 'lower-bound', 'unavailable', 'unknown'];
    const present = order.filter(key => counts[key] > 0);
    if (!present.length) return null;
    return (
        <span className={cn('flex items-center gap-1.5', className)}>
            {present.map(key => {
                const meta = CONFIDENCE_META[key];
                return (
                    <span
                        key={key}
                        className={cn('flex items-center gap-0.5 text-[10px] tabular-nums', meta.text)}
                        title={`${counts[key]} of the eight war categories: ${meta.label} — ${meta.fallback}`}
                    >
                        <ConfidenceIcon confidence={key} />
                        {counts[key]}
                    </span>
                );
            })}
        </span>
    );
};

/** "3h", "2d", "just now" — the same granularity `clans.activity_at` is worth. */
export function formatAge(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

/* ------------------------------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------------------------------ */

/**
 * Itemises one member's published summary. `useClan().memberBreakdown` in the app; passed down
 * from `ClanRoster` so a fixture can supply its own, and `undefined` when nothing can itemise —
 * the breakdown block then does not render at all rather than showing empty rows.
 */
export type MemberBreakdownFn = (
    profileId: string,
    share: ClanShare | null,
    published: Record<ClanShareWarCategory, PublishedCategory>,
) => MemberBreakdown | null;

export interface MemberSummaryCardProps {
    summary: MemberSummary;
    /** Resolved once by the roster; `null` while the tree configs load (names degrade to ids). */
    treeIndex: TreeIndex | null;
    /**
     * Run ONLY while this card is open, which is the whole reason it is a function and not a value:
     * an engine pass is 11 ms and fifty of them is half a second of frozen roster.
     */
    memberBreakdown?: MemberBreakdownFn;
    /** Width of the day strip, so every row in the roster lines up. */
    dayCount?: number;
    /** War day index the reader is in right now, highlighted in the strip. */
    todayIndex?: number | null;
    /** Fixed clock for the "ago" labels. Defaults to the wall clock. */
    now?: number;
    /** 1-based position in the current sort. Purely a reading aid. */
    rank?: number | null;
    /** Controlled expansion. Omit both to let the card manage its own. */
    open?: boolean;
    onToggle?: () => void;
    className?: string;
}

export const MemberSummaryCard: React.FC<MemberSummaryCardProps> = ({
    summary,
    treeIndex,
    memberBreakdown,
    dayCount = WAR_DAY_COUNT,
    todayIndex = null,
    now,
    rank = null,
    open,
    onToggle,
    className,
}) => {
    const clock = now ?? Date.now();
    const [selfOpen, setSelfOpen] = useState(false);
    const isOpen = open === undefined ? selfOpen : open;
    const toggle = () => (onToggle ? onToggle() : setSelfOpen(o => !o));

    /**
     * The itemisation, computed the first time this card is opened and not before.
     *
     * `isOpen` is a dependency on purpose — that is what makes it on-demand. `memberBreakdown`
     * caches per member+document behind the scenes, so collapsing and reopening does not pay for a
     * second engine pass; without that cache this `useMemo` would recompute on every toggle.
     */
    const breakdown = useMemo(
        () => (isOpen && memberBreakdown
            ? memberBreakdown(summary.profileId, summary.share, summary.published)
            : null),
        [isOpen, memberBreakdown, summary.profileId, summary.share, summary.published],
    );

    const role = ROLE_META[summary.role] ?? ROLE_META.member;
    const RoleIcon = role.icon;
    const hasShare = summary.share !== null;
    const days = Array.from({ length: Math.max(dayCount, summary.byDay?.length ?? 0) }, (_, i) => i);

    return (
        <div
            className={cn(
                'rounded-xl border bg-bg-secondary/30 overflow-hidden transition-colors',
                // A member with nothing published gets a dashed edge: at fifty rows the eye finds
                // the gaps before it reads a single word.
                hasShare ? 'border-border/50' : 'border-dashed border-amber-500/40',
                summary.isMine && 'ring-1 ring-accent-primary/40',
                className,
            )}
            data-member={summary.profileId}
            data-has-share={hasShare ? 'yes' : 'no'}
        >
            {/* ---- the always-visible summary line ---- */}
            <button
                type="button"
                onClick={toggle}
                aria-expanded={isOpen}
                className="w-full text-left px-3 py-2.5 hover:bg-bg-input/40 transition flex flex-col gap-1.5"
            >
                <div className="flex items-center gap-2 min-w-0">
                    {rank !== null && (
                        <span className="w-6 shrink-0 text-right font-mono text-[11px] text-text-muted">
                            {rank}
                        </span>
                    )}
                    <span className="shrink-0" title={role.label} aria-label={role.label}>
                        <RoleIcon className={cn('w-3.5 h-3.5', role.className)} aria-hidden="true" />
                    </span>
                    {/* The name and its chips share ONE wrapping box, and the figure plus the
                        chevron stay pinned to the right outside it. Measured: with the provenance
                        chips added, a member carrying "older config", "stale", "impossible figure"
                        and "split mismatch" pushed the figure 38 px past a 360 px viewport, where
                        the card's `overflow-hidden` silently cut the number off. Chips wrap now;
                        nothing that matters can leave the card. */}
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                    <span className="font-bold text-sm text-text-primary whitespace-nowrap overflow-hidden text-clip max-w-full">{summary.name}</span>
                    {summary.isMine && (
                        <span className={cn(CHIP, 'bg-accent-primary/15 text-accent-primary border-accent-primary/30')}>
                            you
                        </span>
                    )}

                    {/* Provenance, loudest first. */}
                    {!hasShare && <span className={cn(CHIP, CHIP_AMBER)}>no data shared yet</span>}
                    {hasShare && summary.configState === 'older' && (
                        <span
                            className={cn(CHIP, CHIP_AMBER)}
                            title={`Computed with the game data from ${formatVersion(summary.configVersion || '')}, which is older than the one this app is using. Point values and war days move between game data versions.`}
                        >
                            older config
                        </span>
                    )}
                    {hasShare && summary.configState === 'newer' && (
                        <span
                            className={cn(CHIP, CHIP_AMBER)}
                            title={`Computed with the game data from ${formatVersion(summary.configVersion || '')}, which is newer than the one this app is using.`}
                        >
                            newer config
                        </span>
                    )}
                    {hasShare && summary.shapeOutdated && (
                        <span
                            className={cn(CHIP, CONFIDENCE_META.unknown.chip)}
                            title={`Published by an older version of this tool (summary format v${finite(summary.share?.v)}; this app writes v${CLAN_SHARE_VERSION}). Its numbers carry no record of how much they can be trusted, and three categories it could not compute at all read n/a.`}
                        >
                            older tool · v{finite(summary.share?.v)}
                        </span>
                    )}
                    {hasShare && summary.configIncomplete && (
                        <span
                            className={cn(CHIP, CHIP_AMBER)}
                            title="This member published while some of the game data their app needed had not finished loading, so those categories could not be computed."
                        >
                            game data missing
                        </span>
                    )}
                    {hasShare && summary.ageDays !== null && summary.ageDays >= 2 && (
                        <span className={cn(CHIP, CHIP_RED)} title={`Computed ${formatAge(clock - (summary.computedAt ?? 0))}`}>
                            stale · {summary.ageDays}d
                        </span>
                    )}
                    {hasShare && summary.implausible && (
                        <span
                            className={cn(CHIP, CHIP_RED)}
                            title="This member's summary contains a figure that is not a war-point number — negative, not a number, or too large to be an exact integer. Those figures count as nothing and their categories read n/a, so one hostile row cannot swamp the clan total."
                        >
                            impossible figure
                        </span>
                    )}
                    {hasShare && summary.daySplitMismatch && (
                        <span
                            className={cn(CHIP, CHIP_AMBER)}
                            title="The day-by-day split published by this member does not add up to their own category totals."
                        >
                            split mismatch
                        </span>
                    )}
                    </div>

                    {/* The headline figure carries its own provenance: an icon, a "≥"/"~" prefix
                        and a colour, so exact / floor / blind are three different things at fifty
                        rows without opening anything. An all-blind share reads "n/a", never 0. */}
                    <span
                        className="shrink-0 text-right flex items-center gap-1"
                        data-member-points={summary.points === null ? 'none' : summary.allBlind ? 'blind' : String(summary.points)}
                    >
                        {summary.points === null ? (
                            <span className="text-sm font-bold text-text-muted" title="This member has not published a summary.">
                                —
                            </span>
                        ) : summary.allBlind ? (
                            <span
                                className="text-sm font-bold text-text-muted"
                                title={`This member published a summary, but not one of the eight war categories could be computed on their machine. Their obtainable points are unknown, not zero.${
                                    summary.ceiling > 0 ? `\nCeiling they did publish: ${exact(summary.ceiling)} points.` : ''
                                }`}
                            >
                                n/a
                            </span>
                        ) : (
                            <>
                                <ConfidenceIcon confidence={summary.confidence} />
                                <span
                                    className={cn(
                                        'text-sm font-black tabular-nums',
                                        summary.confidence === 'exact' ? 'text-accent-primary' : CONFIDENCE_META[summary.confidence].text,
                                    )}
                                    title={`${CONFIDENCE_META[summary.confidence].prefix}${exact(summary.points)} obtainable war points\n${
                                        confidenceTitle(summary.confidence, null, summary.ceiling)
                                    }`}
                                >
                                    {CONFIDENCE_META[summary.confidence].prefix}
                                    {formatCompactNumber(summary.points)}
                                </span>
                            </>
                        )}
                    </span>
                    <ChevronDown
                        className={cn('w-4 h-4 shrink-0 text-text-muted transition-transform', isOpen && 'rotate-180')}
                    />
                </div>

                {/* Second line: the tree recap in MiscPanel's own words, then the day strip.
                    Separators TRAIL their item, so a line that wraps on a phone starts with a word
                    and not with an orphaned middle dot. */}
                <div className="flex items-center gap-2 flex-wrap pl-1">
                    <span className="flex items-center gap-1.5 text-[11px] text-text-muted min-w-0">
                        <GitBranch className="w-3 h-3 shrink-0 text-accent-primary" />
                        {hasShare ? (
                            <span className="whitespace-nowrap overflow-hidden text-clip">
                                {summary.totalNodes} nodes · {summary.totalLevels} levels
                                {summary.clanNodes > 0 && ` · ${summary.clanNodes} clan`} ·
                            </span>
                        ) : (
                            <span className="whitespace-nowrap overflow-hidden text-clip text-amber-400/80">trees not shared ·</span>
                        )}
                    </span>
                    {summary.power !== null && summary.power > 0 && (
                        <span className="text-[11px] text-text-muted">
                            power <span className="text-text-secondary">{formatCompactNumber(summary.power)}</span> ·
                        </span>
                    )}
                    <span className="text-[11px] text-text-muted">
                        synced {formatAge(summary.syncedAt ? clock - summary.syncedAt : null)}
                    </span>
                    {hasShare && <ConfidenceCounts counts={summary.counts} />}

                    <span className="flex-1" />

                    <span className="flex gap-0.5 shrink-0">
                        {days.map(day => {
                            // An all-blind share publishes six zeros because every category is n/a.
                            // Printing them would be the fake zero rule 1 forbids, one line below a
                            // headline that correctly reads "n/a".
                            const value = summary.allBlind ? undefined : summary.byDay?.[day];
                            return (
                                <span
                                    key={day}
                                    data-day-cell={day}
                                    title={`${shortWarDayName(day)}: ${
                                        value === undefined
                                            ? summary.allBlind
                                                ? 'nothing could be computed on this member\'s machine'
                                                : hasShare
                                                    // The member published a shorter projection than
                                                    // somebody else in this clan did. Their number
                                                    // for this day is unknown, not zero.
                                                    ? 'not in this member\'s projection'
                                                    : 'no data shared yet'
                                            : `${exact(value)} points`
                                    }`}
                                    className={cn(
                                        'w-9 sm:w-11 rounded px-0.5 py-0.5 text-center font-mono text-[9px] border tabular-nums',
                                        day === todayIndex
                                            ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                                            : 'border-border bg-bg-input text-text-secondary',
                                        value === undefined && 'text-text-muted',
                                    )}
                                >
                                    {value === undefined ? '—' : formatCompactNumber(value)}
                                </span>
                            );
                        })}
                    </span>
                </div>
            </button>

            {/* ---- the detail ---- */}
            {isOpen && (
                <div className="border-t border-border/50 p-3 space-y-4">
                    {!hasShare ? (
                        /* WHAT THIS MAY AND MAY NOT SAY.
                           It may state what is true of the DATA: there is no document, so every
                           figure on this card would be invented, and the clan totals are built
                           without this member. It may name LIKELY reasons a row is absent, but not as
                           a closed list: an earlier version said "either they have not opened the
                           planner, or they have turned clan sync off", and those two are not all of
                           them — a member who joined a minute ago, is signed out on their phone, or
                           whose publish failed also has no row, and this card cannot tell which.
                           It may NOT tell this reader to go and find a switch in somebody else's
                           browser — an earlier version promised "they appear here as soon as they
                           turn sharing on and sync", which was doubly wrong: there was no such
                           switch to turn on at the time, and even now it is not this reader's to
                           press. */
                        <p className="text-xs text-text-secondary leading-relaxed">
                            <span className="font-bold text-amber-400">Nothing shared.</span>{' '}
                            {summary.name} is in the clan, but no summary of theirs has reached it — they may not
                            have opened the planner since clan sharing existed, or may have turned clan sync off.
                            Either way their trees, resources and war points are unknown here, not zero, and this
                            card is left out of every clan and per-day total.
                        </p>
                    ) : (
                        <>
                            <WarBreakdown
                                summary={summary}
                                treeIndex={treeIndex}
                                dayCount={days.length}
                                todayIndex={todayIndex}
                                breakdown={breakdown}
                            />
                            {breakdown && <MountsStoryBlock summary={summary} breakdown={breakdown} />}
                            <AnchoredTimesNote />
                            <TreeBreakdown summary={summary} treeIndex={treeIndex} />
                            <ResourceBreakdown share={summary.share!} />

                            {/* The publisher's own whole-document caveats. Member-written text,
                                rendered as text: which gem budget they assumed, whether their eggs
                                can physically be hatched before the reset, which war days the
                                config leaves empty. Nobody can reconstruct these from the numbers. */}
                            {summary.notes.length > 0 && (
                                <div className="space-y-1">
                                    <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-primary">
                                        <Info className="w-3.5 h-3.5" /> What {summary.name} assumed
                                    </h4>
                                    <ul className="space-y-0.5">
                                        {summary.notes.map((note, index) => (
                                            <li key={index} className="flex gap-1.5 text-[10px] text-text-secondary leading-relaxed">
                                                <span className="text-text-muted shrink-0">·</span>
                                                {/* `break-words` + `min-w-0`: this is member-written
                                                    text, and a 200-character string with no spaces
                                                    in it does not wrap on its own — measured, it ran
                                                    straight off the card and was clipped. */}
                                                <span className="min-w-0 break-words">{note}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {!summary.hasProvenance && (
                                <p className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2 text-[10px] leading-relaxed text-sky-200">
                                    <span className="font-bold">Older version of the tool.</span>{' '}
                                    This summary was written in summary format v{finite(summary.share?.v)}; this app writes
                                    v{CLAN_SHARE_VERSION}. It carries no record of how each figure was arrived at, so
                                    none of the numbers above can be called exact — and the three categories that
                                    version could not compute at all (tech tree, forging, pet merges) read n/a rather
                                    than 0. They will fill in by themselves the next time {summary.name} opens the app.
                                </p>
                            )}

                            <p className="text-[10px] text-text-muted">
                                Published {formatAge(summary.computedAt === null ? null : clock - summary.computedAt)}
                                {summary.configVersion && ` · game data ${formatVersion(summary.configVersion)}`}
                                {' · '}summary format v{finite(summary.share?.v)}
                                {summary.techHours !== null && ` · tech planned over ${summary.techHours} h`}
                            </p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * Detail blocks
 * ------------------------------------------------------------------------------------------ */

/* ------------------------------------------------------------------------------------------ *
 * The itemisation — the engine's `parts`, as rows that visibly add up
 * ------------------------------------------------------------------------------------------ */

/**
 * One category's `parts`, in two groups that must never be confused for each other.
 *
 * THE INVARIANT IS THE WHOLE POINT, so it is rendered rather than trusted. The engine documents
 * that summing the plain `parts` keys equals `points`, and that `excluded:` keys are ceilings which
 * are deliberately NOT counted. On screen that becomes:
 *
 *   * the counted rows, then a Σ line carrying their ACTUAL sum (added up here, from the rows on
 *     screen — not copied from the category total, so if the two ever drifted the reader would see
 *     it rather than be told a comforting lie);
 *   * a visually separate, dimmer group headed "not counted", each row prefixed with a "+" and no
 *     Σ, because these are alternatives to the total and not contributions to it.
 *
 * A reader adding up the first group gets the headline. That is the promise, and `data-` attributes
 * carry both sums so `breakdown_shots.mjs` can assert it instead of a human squinting at pixels.
 */
const PartsList: React.FC<{ entry: CategoryBreakdown; total: number }> = ({ entry, total }) => (
    <div className="space-y-1.5" data-parts-for={entry.category}>
        {entry.counted.length > 0 && (
            <ul className="space-y-0.5" data-parts-counted={entry.counted.length}>
                {entry.counted.map(row => (
                    <li key={row.key} className="flex items-baseline gap-2 text-[10px]">
                        <span className="min-w-0 break-words text-text-secondary">{row.label}</span>
                        <span className="flex-1 border-b border-dotted border-border/60" />
                        <span className="shrink-0 font-mono tabular-nums text-text-primary">{exact(row.points)}</span>
                    </li>
                ))}
            </ul>
        )}

        {/* The Σ line. Shown even for a single row: it is what says "these are ALL of them". */}
        {entry.counted.length > 0 && (
            <div
                className="flex items-baseline gap-2 border-t border-border/60 pt-1 text-[10px]"
                data-parts-sum={entry.total}
                data-parts-headline={total}
            >
                <Sigma className="w-3 h-3 shrink-0 text-accent-primary" aria-hidden="true" />
                <span className="text-text-secondary">
                    {entry.counted.length === 1 ? 'that is the whole figure' : 'these add up to'}
                </span>
                <span className="flex-1" />
                <span className="shrink-0 font-mono font-bold tabular-nums text-text-primary">{exact(entry.total)}</span>
            </div>
        )}

        {/* A rounding difference is possible by construction — `emit` rounds every part on its own
            — so it is stated rather than hidden. It has never exceeded a couple of points. */}
        {entry.counted.length > 0 && entry.total !== total && (
            <p className="text-[10px] leading-relaxed text-amber-300">
                The headline says {exact(total)}. The {Math.abs(total - entry.total)}-point difference is
                rounding: each line above is rounded to a whole point on its own.
            </p>
        )}

        {entry.excluded.length > 0 && (
            <div className="rounded border border-dashed border-border/70 bg-black/20 p-1.5" data-parts-excluded={entry.excluded.length}>
                <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-text-muted">
                    <EyeOff className="w-3 h-3 shrink-0" aria-hidden="true" />
                    not counted above
                </div>
                <ul className="space-y-0.5">
                    {entry.excluded.map(row => (
                        <li key={row.key} className="flex items-baseline gap-2 text-[10px]">
                            <span className="min-w-0 break-words text-text-muted">{row.label}</span>
                            <span className="flex-1" />
                            <span className="shrink-0 font-mono tabular-nums text-text-muted">+ {exact(row.points)}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-1 text-[9px] leading-relaxed text-text-muted">
                    Ceilings, not amounts. Each needs something the app cannot see — a duplicate to merge, a
                    coin sink to spend into — so none of it is in the {exact(total)} above.
                </p>
            </div>
        )}

        {entry.counted.length === 0 && entry.excluded.length === 0 && (
            <p className="text-[10px] leading-relaxed text-text-muted">
                Nothing to itemise: this category has no parts, which is what a figure of n/a means.
            </p>
        )}
    </div>
);

/** Why a category shows no rows. Names the missing input, never the field that holds it. */
const WithheldNote: React.FC<{ entry: CategoryBreakdown; sameConfig: boolean }> = ({ entry, sameConfig }) => (
    <p className="text-[10px] leading-relaxed text-text-secondary" data-withheld={entry.withheld?.kind ?? ''}>
        <span className="font-bold text-amber-300">Cannot be broken down.</span>{' '}
        Working this figure out again here{' '}
        {entry.withheld?.kind === 'points'
            ? `gives ${exact(entry.withheld.recomputed)} rather than the ${exact(entry.withheld.published)} they published`
            : entry.withheld?.kind === 'ceiling'
                ? 'gives a different ceiling from the one they published'
                : 'reaches a different level of confidence from the one they published'}
        , so the lines behind it would not be the lines behind their number.{' '}
        {entry.gaps.length > 0
            ? `A clan summary does not carry their ${joinWords(entry.gaps)}, and this category needs it.`
            : sameConfig
                ? 'Their summary does not carry every input this category reads.'
                : 'They also computed on a different version of the game data, where the point values differ.'}
    </p>
);

/** "a, b and c" — an Oxford-free list, because these are read inside a sentence. */
function joinWords(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------------------------------------ *
 * The clan node behind a category — two currencies, two rows, never one column
 * ------------------------------------------------------------------------------------------ */

/**
 * `ValuePerLevel` and `PointsPerLevel` are both "per level" and they are not the same thing, which
 * is exactly why they get separate rows with separate units and a sentence between them.
 *
 *   ValuePerLevel   dimensionless and RECURRING. It multiplies every point the category ever
 *                   scores, every day the category pays. It is not a number of points anybody
 *                   holds, and it can never be added to a figure — only multiplied through one.
 *                   Rendered as "× 1.28", plus what the next level would be worth to THIS member,
 *                   which is `basePoints × ValuePerLevel` — the engine's own arithmetic, not an
 *                   estimate.
 *   PointsPerLevel  a ONE-OFF price, in clan tech points, charged when the node is raised. Clan
 *                   tech points are bought with guild potions (`CostPerPoint`, read from
 *                   `GuildBaseConfig`), so this row is denominated in a currency the roster already
 *                   shows the member holding. It is not war points and it never appears in a total.
 *
 * TWO REFUSALS, both deliberate:
 *   * `configState !== 'same'`. `useGameData` normalises `GuildTechTreeUpgradeLibrary.ValuePerLevel`
 *     — it is doubled for versions before `2026_08_21_00_29` — so this reader's multiplier for a
 *     member who published under a different version can be out by 2×. Nothing is shown, and the
 *     row says which version they used.
 *   * `categoryCurrencies()` returning `null`, which is its own runtime check that the node named
 *     for this category really is the one whose bonus the engine applied. See that function.
 *
 * There is no third state where a number is shown with a hedge attached.
 */
const NodeCurrencies: React.FC<{
    summary: MemberSummary;
    currencies: CategoryCurrencies | null;
    /** `false` when the member's game data version differs from this reader's. */
    sameConfig: boolean;
}> = ({ summary, currencies, sameConfig }) => {
    if (!sameConfig) {
        return (
            <p className="text-[10px] leading-relaxed text-text-muted" data-currencies="other-config">
                The clan node behind this category is not shown: {summary.name} computed with the game data
                from {formatVersion(summary.configVersion || '')}, and the per-level values of the clan tree
                changed between that version and this one.
            </p>
        );
    }
    if (!currencies) return null;

    const c = currencies;
    const nodeName = getTechNodeName(c.node);
    const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    const capped = c.nextValueStep <= 0;

    return (
        <div
            className="space-y-1 rounded border border-border/70 bg-black/10 p-1.5"
            data-currencies={c.node}
            data-currencies-level={c.level}
            data-currencies-multiplier={c.multiplier.toFixed(4)}
            data-currencies-cost={c.costOfNextLevel}
        >
            <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
                Their “{nodeName}” clan node · level {c.level}
                {c.maxLevel > 0 && ` of ${c.maxLevel}`}
            </div>

            {/* ROW ONE — the multiplier. A "×", never a "+", and never next to a points figure. */}
            <div className="flex items-baseline gap-2 text-[10px]" data-currency="multiplier">
                <span className="min-w-0 break-words text-text-secondary">
                    Multiplies every point in this category
                </span>
                <span className="flex-1 border-b border-dotted border-border/60" />
                <span className="shrink-0 font-mono font-bold tabular-nums text-emerald-300">
                    × {c.multiplier.toFixed(2)}
                </span>
            </div>
            <p className="text-[9px] leading-relaxed text-text-muted">
                {c.level === 0
                    ? `They hold no levels in this node, so nothing is multiplied. Each level is worth ${pct(c.nextValueStep)} more on every point this category scores, on every day it pays.`
                    : `Each level is ${pct(c.nextValueStep > 0 ? c.nextValueStep : 0)} and it applies every time they score here, on every day this category pays — it is a multiplier, not points they are holding.`}
            </p>

            {/* ROW TWO — the price. A different unit, its own line, and the word "costs". */}
            <div className="flex items-baseline gap-2 border-t border-border/60 pt-1 text-[10px]" data-currency="cost">
                <span className="min-w-0 break-words text-text-secondary">
                    {capped ? 'That node is finished — no level left to buy' : 'One more level costs, once'}
                </span>
                <span className="flex-1" />
                {!capped && (
                    <span className="shrink-0 font-mono tabular-nums text-sky-300">
                        {exact(c.costOfNextLevel)} pts
                    </span>
                )}
            </div>
            {!capped && (
                <p className="text-[9px] leading-relaxed text-text-muted">
                    Clan tech points — the clan tree&apos;s own currency, paid once
                    {c.potionsPerPoint !== null && (
                        <> and bought at {c.potionsPerPoint} guild potion{c.potionsPerPoint === 1 ? '' : 's'} each,
                        so {exact(c.costOfNextLevel * c.potionsPerPoint)} potions</>
                    )}
                    . Not war points, and never part of any figure above. Buying it moves the multiplier
                    from <span className="text-text-secondary">× {c.multiplier.toFixed(2)}</span> to{' '}
                    <span className="text-emerald-300">× {c.nextMultiplier.toFixed(2)}</span>
                    {/* The war-point delta needs a base this reader has verified. When the category
                        did not reconcile there is none, and the multiplier move is all that can
                        honestly be said — see `nextLevelWorth`. */}
                    {c.nextLevelWorth !== null
                        ? <> — worth <span className="text-emerald-300 font-mono">{exact(c.nextLevelWorth)}</span>{' '}
                          more war points from the resources they hold right now.</>
                        : <>. What that is worth in points cannot be said here: it needs their figure for this
                          category, and the lines behind that figure could not be reproduced.</>}
                </p>
            )}
        </div>
    );
};

const WarBreakdown: React.FC<{
    summary: MemberSummary;
    treeIndex: TreeIndex | null;
    dayCount: number;
    todayIndex: number | null;
    breakdown: MemberBreakdown | null;
}> = ({ summary, treeIndex, dayCount, todayIndex, breakdown }) => {
    /**
     * One category open at a time, and it lives BELOW the eight-row grid rather than inside it.
     *
     * Expanding a cell in a two-column grid stretches its neighbour to the same height, which at
     * eight rows made the block jump by 60-100 px on every click. A single panel under the grid
     * keeps the grid still, and there is only ever one breakdown a reader is looking at.
     */
    const [openCategory, setOpenCategory] = useState<ClanShareWarCategory | null>(null);
    const openEntry = openCategory && breakdown ? breakdown.categories[openCategory] : null;
    const openPublished = openCategory ? summary.war.find(e => e.category === openCategory) : null;

    /**
     * The member's clan levels keyed by node TYPE rather than by globalId.
     *
     * `readClanBonuses` in the engine walks the position library and SUMS a type's occurrences, so
     * this sums too — today's clan tree has one node per type, and a version that duplicates one
     * must not be read differently here from the way the multiplier was computed.
     */
    const clanLevelsByNode = useMemo(() => {
        const out: Record<string, number> = {};
        const levels = summary.trees.find(t => t.name === 'Clan')?.levelsById;
        const byId = treeIndex?.Clan.byId;
        if (!levels || !byId) return out;
        for (const [id, level] of Object.entries(levels)) {
            const type = byId[Number(id)]?.type;
            if (type) out[type] = (out[type] || 0) + level;
        }
        return out;
    }, [summary.trees, treeIndex]);

    const guildDefs: Record<string, GuildNodeDef> = treeIndex?.Clan.guildDefs ?? {};
    const openCurrencies = openCategory && breakdown
        ? categoryCurrencies({
            category: openCategory,
            entry: breakdown.result.categories[openCategory],
            clanBonuses: breakdown.result.clanBonuses,
            levelsByNode: clanLevelsByNode,
            def: guildDefs[CATEGORY_MULTIPLIER_NODE[openCategory]],
            potionsPerPoint: treeIndex?.Clan.potionsPerPoint ?? null,
            reconciled: !!breakdown.categories[openCategory]?.reconciled,
        })
        : null;

    return (
    <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-primary">
            <Swords className="w-3.5 h-3.5" /> War points still obtainable
        </h4>

        {/* The one sentence a planner needs before reading any of the numbers below: is this the
            answer, a floor, or a floor with a known top — and how many categories are blind. */}
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-text-secondary">
            <ConfidenceIcon confidence={summary.confidence} className="mt-0.5" />
            <span>
                {summary.allBlind ? (
                    <>
                        <span className="font-bold text-text-muted">Nothing computable.</span> All eight
                        categories came back unavailable on this member&apos;s machine, so their obtainable
                        points are unknown rather than zero.
                    </>
                ) : summary.confidence === 'exact' ? (
                    <>
                        <span className="font-bold text-emerald-300">{exact(summary.points ?? 0)}</span> — all
                        eight categories are exact for the resources this member holds.
                    </>
                ) : summary.confidence === 'unknown' ? (
                    <>
                        <span className="font-bold">~ {exact(summary.points ?? 0)}</span>, published by an older
                        version of the tool that recorded no provenance. Treat every figure below as unverified.
                    </>
                ) : (
                    <>
                        <span className="font-bold text-amber-300">at least {exact(summary.points ?? 0)}</span>
                        {summary.ceiling > 0 && (
                            <>
                                {' '}and at most{' '}
                                <span className="font-bold">{exact((summary.points ?? 0) + summary.ceiling)}</span>
                            </>
                        )}
                        {' — '}
                        {summary.counts.exact > 0 && `${summary.counts.exact} exact`}
                        {summary.counts.exact > 0 && summary.counts['lower-bound'] > 0 && ', '}
                        {summary.counts['lower-bound'] > 0 && `${summary.counts['lower-bound']} a floor`}
                        {summary.counts.unavailable > 0 && `, ${summary.counts.unavailable} not modelled`}
                        {summary.counts.unknown > 0 && `, ${summary.counts.unknown} unverified`}
                        {'. '}
                        Nothing here is over-counted, so the total can only be too small.
                    </>
                )}
            </span>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {summary.war.map(entry => {
                const itemised = breakdown ? breakdown.categories[entry.category] : null;
                const isOpen = openCategory === entry.category;
                // A row is only worth opening when there is something behind it. Without the
                // engine (configs still loading, or a fixture with none) nothing is clickable and
                // the block is exactly the read-only list it was before.
                const clickable = !!itemised;
                const Row = clickable ? 'button' : 'div';
                return (
                <Row
                    key={entry.category}
                    {...(clickable
                        ? {
                            type: 'button' as const,
                            onClick: () => setOpenCategory(isOpen ? null : entry.category),
                            'aria-expanded': isOpen,
                        }
                        : {})}
                    data-war-row={entry.category}
                    data-war-itemised={itemised ? (itemised.reconciled ? 'yes' : 'withheld') : 'none'}
                    // `flex-wrap`, and it is load-bearing at 360 px. `exact()` is used for these
                    // figures on purpose — a planner adds them up by hand — so the widest realistic
                    // one is "≥ 1,234,567,890,123" beside "≤ 2.5T", which at 360 px measured 319 px
                    // of content inside a 310 px row: the card's `overflow-hidden` then silently ate
                    // the right-hand digits of the number the whole row exists to show. Compacting
                    // the figure would have been the wrong repair (it is the one number here that
                    // must stay addable), so the row wraps and the figure keeps `ml-auto` to stay
                    // right-aligned on whichever line it lands on. Nothing wraps until it must.
                    className={cn(
                        'flex flex-wrap items-center gap-x-2 py-0.5 border-b border-border/30 last:border-b-0 text-left w-full',
                        clickable && 'hover:bg-white/5 rounded transition-colors',
                        isOpen && 'bg-white/5',
                    )}
                >
                    <span className="text-[11px] text-text-secondary w-24 shrink-0 flex items-center gap-1">
                        {clickable && (
                            <ChevronDown
                                className={cn(
                                    'w-2.5 h-2.5 shrink-0 transition-transform',
                                    isOpen ? 'rotate-180 text-accent-primary' : 'text-text-muted',
                                )}
                                aria-hidden="true"
                            />
                        )}
                        <span className="whitespace-nowrap overflow-hidden text-clip">{WAR_CATEGORY_LABELS[entry.category]}</span>
                    </span>
                    <span className="flex gap-0.5 flex-wrap min-w-0">
                        {entry.days.length === 0 ? (
                            <span className="text-[9px] text-text-muted uppercase">no war day</span>
                        ) : (
                            entry.days.map(day => (
                                <span
                                    key={day}
                                    className={cn(
                                        'px-1 rounded text-[9px] font-bold border',
                                        day === todayIndex
                                            ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                                            : 'border-border bg-bg-input text-text-muted',
                                    )}
                                >
                                    {shortWarDayName(day)}
                                </span>
                            ))
                        )}
                    </span>
                    <span className="flex-1" />
                    {/* Three states, three shapes. `n/a` is never a digit; a floor always wears its
                        "≥"; and the ceiling the publisher named rides along as "≤ m" so a leader
                        reads a range instead of mistaking a floor for the answer. */}
                    <ConfidenceIcon confidence={entry.confidence} />
                    <span
                        className="ml-auto shrink-0 text-right"
                        title={confidenceTitle(entry.confidence, entry.reason, entry.ceiling)}
                    >
                        {entry.notProjected ? (
                            <span className="text-[11px] font-mono text-text-muted">n/a</span>
                        ) : (
                            <span
                                className={cn(
                                    'text-[11px] font-mono tabular-nums',
                                    entry.points > 0 ? CONFIDENCE_META[entry.confidence].text : 'text-text-muted',
                                )}
                            >
                                {CONFIDENCE_META[entry.confidence].prefix}
                                {exact(entry.points)}
                            </span>
                        )}
                        {entry.ceiling > 0 && (
                            <span className="ml-1 text-[10px] font-mono text-text-muted tabular-nums">
                                ≤ {formatCompactNumber(entry.points + entry.ceiling)}
                            </span>
                        )}
                    </span>
                </Row>
                );
            })}
        </div>

        {/* ---- the one open category, itemised ---- */}
        {openEntry && openPublished && (
            <div
                className="rounded-lg border border-accent-primary/30 bg-bg-input/60 p-2 space-y-1.5"
                data-breakdown-panel={openEntry.category}
                data-breakdown-reconciled={openEntry.reconciled ? 'yes' : 'no'}
            >
                <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-bold text-accent-primary">
                        {WAR_CATEGORY_LABELS[openEntry.category]}
                    </span>
                    <span className="flex-1" />
                    {!openPublished.notProjected && (
                        <span className={cn('font-mono text-[11px] tabular-nums', CONFIDENCE_META[openPublished.confidence].text)}>
                            {CONFIDENCE_META[openPublished.confidence].prefix}
                            {exact(openPublished.points)}
                        </span>
                    )}
                </div>
                {openEntry.reconciled
                    ? <PartsList entry={openEntry} total={openPublished.points} />
                    : <WithheldNote entry={openEntry} sameConfig={summary.configState === 'same'} />}
                {/* The clan node behind the category, in its own two currencies. Shown whether or
                    not the itemisation reconciled: the multiplier is read off the member's own
                    published clan tree, which is present either way, and "what is another level of
                    this node worth" is the question a leader asks about a category they cannot
                    itemise just as much as one they can. */}
                <NodeCurrencies
                    summary={summary}
                    currencies={openCurrencies}
                    sameConfig={summary.configState === 'same' || summary.configState === 'unknown'}
                />
                {/* The one sentence that keeps the two rows above from ever being added together. */}
                {openCurrencies && (
                    <p className="text-[9px] leading-relaxed text-text-muted">
                        Two different currencies: the <span className="text-emerald-300">×</span> is a
                        multiplier that fires every time they score here, the{' '}
                        <span className="text-sky-300">pts</span> is a one-off price in the clan tree&apos;s
                        own points. Neither is a war-point figure, and adding them to anything above would
                        be meaningless.
                    </p>
                )}
                {/* The publisher's own sentence, last and clearly theirs — the same rule
                    `confidenceTitle` follows for the tooltips. */}
                {openPublished.reason && (
                    <p className="min-w-0 break-words border-t border-border/50 pt-1 text-[10px] leading-relaxed text-text-muted">
                        {summary.name} published: “{openPublished.reason}”
                    </p>
                )}
            </div>
        )}

        {breakdown && breakdown.reconciledCount < summary.war.length && (
            <p className="text-[10px] leading-relaxed text-text-muted" data-breakdown-count={breakdown.reconciledCount}>
                {breakdown.reconciledCount} of the {summary.war.length} categories can be broken down here.
                A clan summary carries the eight totals, not the lines behind them, so the lines are worked
                out again on this machine — and only shown where that reproduces {summary.name}&apos;s own
                figure exactly.
            </p>
        )}

        {/* What the markers mean, once per card, so the icons above never need decoding twice. */}
        <div className="flex items-center gap-3 flex-wrap text-[10px] text-text-muted">
            {(['exact', 'lower-bound', 'unavailable', 'unknown'] as MemberConfidence[])
                .filter(key => summary.counts[key] > 0)
                .map(key => (
                <span key={key} className="flex items-center gap-1">
                    <ConfidenceIcon confidence={key} />
                    <span>{CONFIDENCE_META[key].legend}</span>
                </span>
            ))}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {Array.from({ length: dayCount }, (_, day) => {
                // `undefined` means this member's projection is shorter than somebody else's in the
                // clan, so the column exists but their number for it does not. An em dash, not 0.
                const value = summary.allBlind ? undefined : summary.byDay?.[day];
                // The publisher's `WarPointsOnDayN` node, when they hold one: the day totals in the
                // document deliberately carry NO day boost so they still add up to the categories,
                // and this is the figure that member would really score on that day.
                const boosted = summary.dayPts?.[day];
                const boostedShown = boosted !== undefined && value !== undefined && boosted > value;
                return (
                    <div
                        key={day}
                        data-day-tile={day}
                        className={cn(
                            'rounded-lg border px-1 py-1.5 text-center',
                            day === todayIndex
                                ? 'border-accent-primary/60 bg-accent-primary/10'
                                : 'border-border bg-bg-input',
                        )}
                    >
                        <div className="text-[9px] uppercase tracking-wide text-text-muted whitespace-nowrap overflow-hidden text-clip">
                            {shortWarDayName(day)}
                        </div>
                        <div
                            className={cn(
                                'font-mono text-xs font-bold tabular-nums',
                                value === undefined
                                    ? 'text-text-muted'
                                    : day === todayIndex
                                        ? 'text-accent-primary'
                                        : 'text-text-primary',
                            )}
                            title={`${shortWarDayName(day)}: ${
                                value === undefined
                                    ? summary.allBlind
                                        ? 'nothing could be computed on this member\'s machine'
                                        : 'not in this member\'s projection'
                                    : `${exact(value)} points`
                            }`}
                        >
                            {value === undefined ? '—' : formatCompactNumber(value)}
                        </div>
                        {boostedShown && (
                            <div
                                className="font-mono text-[9px] tabular-nums text-emerald-300"
                                // An ARROW, not a "+". This read `+node 263K` and the plus sign was
                                // a lie: 263K is not an addition to the white figure above, it is
                                // what that figure BECOMES once the node multiplies it. The clan
                                // strip in `ClanRoster` was fixed first; a member row that still
                                // said "+" beside a clan tile that says "→" would teach the reader
                                // that the two mean different things, and they do not.
                                //
                                // The node is named the way the clan tree page names it
                                // (`getTechNodeName`), not by its config key: a player reading this
                                // tooltip has to be able to find the node it is talking about.
                                title={
                                    `${exact(value!)} becomes ${exact(boosted!)} once this member's own ` +
                                    `"${getTechNodeName(`WarPointsOnDay${day + 1}`)}" clan node is applied — that node ` +
                                    'multiplies what they score on this day and nothing else. It is a multiplier, ' +
                                    'not extra points they already hold.'
                                }
                            >
                                → {formatCompactNumber(boosted!)}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>

        {summary.unscheduled > 0 && (
            <p className="text-[10px] text-text-muted">
                {exact(summary.unscheduled)} of these points sit in categories the game config gives no war
                day, so they are counted in the total but in none of the six days.
            </p>
        )}
    </div>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * Mounts — always on the card, because it is the one a leader asks about out loud
 * ------------------------------------------------------------------------------------------ */

/**
 * "How many points from summoning, how many would the merges add, and must they ascend?"
 *
 * The first two are numbers the engine already produces and simply never showed: `parts.summons`
 * is the counted half and `parts['excluded:mergeCeiling']` is the merge half, which is a CEILING
 * because a merge consumes a duplicate mount and no collection is stored anywhere in this app. The
 * Mount Calculator page counts both, which is why its total is roughly twice the roster's — said
 * here in words, because a leader who has both screens open will otherwise assume one is broken.
 *
 * The third has no answer and the honest thing is to say which kind of "no" it is. See
 * `MOUNT_ASCENSION_VERDICT`: the engine prices every mount at the same flat rate whatever level it
 * came from, so it never reads a mount ascension and there is no before-and-after projection to
 * subtract. What CAN be said about wasted resources is the leftover: winders below the price of one
 * more summon, straight out of the engine's own `costPerSummon` diagnostic. It is rendered as
 * leftover winders and never dressed up as the ascension answer.
 */
const MountsStoryBlock: React.FC<{ summary: MemberSummary; breakdown: MemberBreakdown }> = ({
    summary,
    breakdown,
}) => {
    const m = breakdown.mounts;
    const published = summary.war.find(e => e.category === 'mounts');

    return (
        <div className="space-y-1.5" data-mounts-story={m.known ? 'known' : 'unknown'}>
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-primary">
                <Rabbit className="w-3.5 h-3.5" /> Mounts, in full
            </h4>

            {!m.known ? (
                <p className="text-[11px] leading-relaxed text-text-secondary">
                    <span className="font-bold text-amber-300">Not broken down.</span>{' '}
                    Working {summary.name}&apos;s mount figure out again here does not reproduce the
                    {published && !published.notProjected ? ` ${exact(published.points)} ` : ' figure '}
                    they published, so the split between summoning and merging would not be theirs. Their own
                    total above still stands.
                </p>
            ) : m.mounts <= 0 ? (
                <p className="text-[11px] leading-relaxed text-text-secondary">
                    {summary.name} holds {exact(m.winders)} clock winder{m.winders === 1 ? '' : 's'}, and one
                    summon costs {exact(m.costPerSummon)} — so there is nothing here to summon, merge or
                    ascend for yet.
                </p>
            ) : (
                <>
                    <p className="text-[11px] leading-relaxed text-text-secondary">
                        {exact(m.winders)} clock winders buy {exact(m.summons)} summon
                        {m.summons === 1 ? '' : 's'} at {exact(m.costPerSummon)} each, which is{' '}
                        <span className="font-bold text-text-primary">{exact(m.mounts)} mounts</span>.
                    </p>
                    <ul className="space-y-0.5">
                        <li className="flex items-baseline gap-2 text-[11px]">
                            <span className="text-text-secondary">Summoning them scores</span>
                            <span className="flex-1 border-b border-dotted border-border/60" />
                            <span className="shrink-0 font-mono font-bold tabular-nums text-amber-300">
                                {exact(m.summonPoints)}
                            </span>
                        </li>
                        <li className="flex items-baseline gap-2 text-[11px]">
                            <span className="min-w-0 break-words text-text-muted">
                                Merging every one of them would add
                            </span>
                            <span className="flex-1" />
                            <span className="shrink-0 font-mono tabular-nums text-text-muted">
                                + {exact(m.mergePoints)}
                            </span>
                        </li>
                    </ul>
                    <p className="text-[10px] leading-relaxed text-text-muted">
                        Only the {exact(m.summonPoints)} is counted. A merge needs two of the same mount, and
                        nothing in this app knows which mounts anyone owns — so the merge line is the most it
                        could ever be worth, not what it will be. The Mount calculator shows both added
                        together, which is why its total is about twice this one.
                    </p>
                    {m.strandedWinders > 0 && (
                        <p className="text-[10px] leading-relaxed text-text-muted" data-mounts-stranded={m.strandedWinders}>
                            {exact(m.strandedWinders)} winder{m.strandedWinders === 1 ? '' : 's'} cannot buy another
                            summon and score nothing at all.
                        </p>
                    )}
                </>
            )}

            {/* The ascension question. Rendered as the absence it is, never as a hedge on a number. */}
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-text-muted" data-mounts-ascension="unavailable">
                <Ban className="mt-0.5 w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{m.ascension.reason}</span>
            </p>
        </div>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * Anchored, or not
 * ------------------------------------------------------------------------------------------ */

/**
 * ONE line, for everybody, because the alternative would be a lie.
 *
 * The owner wants to see who has completion times behind their projection and who has only a
 * resource pile. `clan_share` cannot tell them apart: the research plan lives in
 * `profile.misc.techPlanQueue` / `techPlanStartDate`, the sleep window in `plannerSleepStart` /
 * `plannerSleepEnd`, and alarms are a per-DEVICE push subscription rather than a profile field at
 * all — and the publisher writes none of them. The only time-ish field in the document, `prov.hrs`,
 * is the hours left in the war week, which is the same number for every member in the clan.
 *
 * So sorting the roster into "anchored" and "not" would be this reader inventing a distinction. It
 * says the true thing once instead. `ANCHORED_TIMES_LINE` carries the wording and
 * `warPointsBreakdown.ts` records what a `v3` share would need: one boolean and one epoch-ms.
 */
const AnchoredTimesNote: React.FC = () => (
    <p
        className="flex items-start gap-1.5 rounded-lg border border-border bg-bg-input/40 p-2 text-[10px] leading-relaxed text-text-secondary"
        data-anchored-times="none"
    >
        <Clock className="mt-0.5 w-3.5 h-3.5 shrink-0 text-text-muted" aria-hidden="true" />
        <span className="min-w-0">{ANCHORED_TIMES_LINE}</span>
    </p>
);

const TreeBreakdown: React.FC<{ summary: MemberSummary; treeIndex: TreeIndex | null }> = ({
    summary,
    treeIndex,
}) => {
    const [openTree, setOpenTree] = useState<TreeName | null>(null);

    return (
        <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-primary">
                <GitBranch className="w-3.5 h-3.5" /> Tech trees
            </h4>
            {/* items-start: an expanded tree must not stretch its three neighbours to its height. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 items-start">
                {summary.trees.map(tree => {
                    const entry = treeIndex ? treeIndex[tree.name] : EMPTY_TREE_ENTRY;
                    const isOpen = openTree === tree.name;
                    return (
                        <div key={tree.name} className="rounded-lg border border-border bg-bg-input/60 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setOpenTree(isOpen ? null : tree.name)}
                                aria-expanded={isOpen}
                                className="w-full px-2 py-1.5 text-left hover:bg-white/5 transition"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-text-primary whitespace-nowrap overflow-hidden text-clip">
                                        {TREE_LABELS[tree.name]}
                                    </span>
                                    <span className="flex-1" />
                                    {tree.pct !== null && tree.pct < 100 && (
                                        <span
                                            className={cn(CHIP, CHIP_AMBER)}
                                            title={`${tree.pct}% of the levels this tree can hold — ${entry.maxLevels.toLocaleString('en-US')} in total`}
                                        >
                                            {tree.pct}%
                                        </span>
                                    )}
                                    <ChevronDown
                                        className={cn('w-3 h-3 text-text-muted transition-transform', isOpen && 'rotate-180')}
                                    />
                                </div>
                                <div className="text-[10px] text-text-muted">
                                    {tree.nodes === 0 ? (
                                        <span className="text-text-muted">empty</span>
                                    ) : (
                                        <>
                                            {tree.nodes} nodes · {tree.levels} levels
                                        </>
                                    )}
                                </div>
                            </button>
                            {isOpen && (
                                <div className="border-t border-border">
                                    {/* The list scrolls INSIDE this box — 151 nodes must not push
                                        the page, and the "still at 0" count below stays visible
                                        instead of hiding at the bottom of the scroll. */}
                                    <div className="px-2 py-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                    {tree.nodes === 0 ? (
                                        <p className="text-[10px] text-text-muted">
                                            No levelled node in this tree.
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {Object.entries(tree.levelsById)
                                                .map(([id, level]) => ({ id: Number(id), level }))
                                                .sort((a, b) => b.level - a.level || a.id - b.id)
                                                .map(({ id, level }) => {
                                                    const def = entry.byId[id];
                                                    // A published level above the config's MaxLevel
                                                    // is a claim the game cannot produce. Shown,
                                                    // not dropped — and marked, not silently kept.
                                                    const impossible = !!def && level > def.max;
                                                    return (
                                                        <li key={id} className="flex items-center gap-1.5 text-[10px]">
                                                            <span className="whitespace-nowrap overflow-hidden text-clip text-text-secondary">
                                                                {def ? def.label : `node #${id}`}
                                                            </span>
                                                            <span className="flex-1" />
                                                            <span
                                                                className={cn(
                                                                    'font-mono tabular-nums',
                                                                    impossible ? 'text-amber-400' : 'text-text-primary',
                                                                )}
                                                                title={impossible
                                                                    ? `This member published level ${level}, above the ${def!.max} the game config allows for this node.`
                                                                    : undefined}
                                                            >
                                                                {level}
                                                                {def ? (
                                                                    <span className="text-text-muted">/{def.max}</span>
                                                                ) : null}
                                                            </span>
                                                        </li>
                                                    );
                                                })}
                                        </ul>
                                    )}
                                    </div>
                                    {entry.nodes.length > tree.nodes && (
                                        <p className="border-t border-border/50 px-2 py-1 text-[10px] text-text-muted">
                                            + {entry.nodes.length - tree.nodes} node
                                            {entry.nodes.length - tree.nodes === 1 ? '' : 's'} still at 0
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/** The resources every war number above is derived from, so a reader can audit the projection. */
const ResourceBreakdown: React.FC<{ share: ClanShare }> = ({ share }) => {
    const res = share.res || ({} as ClanShare['res']);
    const flat: { label: string; value: number }[] = [
        { label: 'Coins', value: count(res.coins) },
        { label: 'Gems', value: count(res.gems) },
        { label: 'Hammers', value: count(res.hammers) },
        { label: 'Skill tickets', value: count(res.skillTickets) },
        { label: 'Clock winders', value: count(res.clockWinders) },
        { label: 'Eggshells', value: count(res.eggshells) },
        { label: 'Tech potions', value: count(res.techPotions) },
        { label: 'Guild potions', value: count(res.guildPotions) },
    ];
    const grouped = (source: unknown, suffix: string) =>
        Object.entries((source || {}) as Record<string, unknown>)
            .map(([key, value]) => ({ label: `${key} ${suffix}`, value: count(value) }))
            .filter(entry => entry.value > 0);

    const items = [...flat.filter(e => e.value > 0), ...grouped(res.eggs, 'eggs'), ...grouped(res.keys, 'keys')];

    return (
        <div className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent-primary">
                <Coins className="w-3.5 h-3.5" /> Resources behind those points
            </h4>
            {items.length === 0 ? (
                <p className="text-[11px] text-text-muted">
                    No non-zero resource in this summary. This block records what was entered, and a
                    blank field publishes as 0 — which is why the markers above, and not these chips,
                    are what say whether a category could be computed.
                </p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {items.map(item => (
                        <span
                            key={item.label}
                            className="rounded border border-border bg-bg-input px-1.5 py-0.5 text-[10px] text-text-secondary"
                        >
                            {item.label}{' '}
                            <span className="font-mono text-text-primary" title={exact(item.value)}>
                                {formatCompactNumber(item.value)}
                            </span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MemberSummaryCard;
