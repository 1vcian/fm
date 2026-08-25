/**
 * ClanContext — the clan state every clan surface reads.
 * ======================================================
 *
 * `clanApi` is the wire. This is the state: who the ACTIVE PROFILE is in a clan with, what it may
 * do there, the roster, the shared tree, and the summary it publishes back. One provider, one hook,
 * and every rule the user laid down encoded once as a named boolean rather than re-derived in each
 * component.
 *
 * MEMBERSHIP IS PER PROFILE, NOT PER ACCOUNT
 * ------------------------------------------
 * `clan_members`' primary key is `profile_id`. One account can hold profiles in different clans, so
 * everything here is keyed on `activeProfileId` and every switch of profile is a full reload plus a
 * new Realtime channel. `role` is therefore "the role of the profile on screen", never "the role of
 * the user" — the account has no role.
 *
 * A SHARED PROFILE IS CLANLESS, AND NOTHING CAN BE WRITTEN WHILE ONE IS ON SCREEN
 * ------------------------------------------------------------------------------
 * `ProfileContext` signals that with `profile.isShared === true` (it is set when a `#p=` share
 * payload is decoded, and `activeProfileId` then reports the imported profile's freshly minted id,
 * which exists in no database). Membership never travels inside a profile — that is the §4b
 * invariant — so an imported profile is by definition not in a clan. This provider reports
 * `status: 'shared-profile'`, `role: null`, an empty roster, and refuses every write with a clear
 * error instead of sending a request that would fail server-side (or, worse, succeed against the
 * *other* profile's row).
 *
 * NO BACKEND, OR SIGNED OUT, IS A RESTING STATE
 * --------------------------------------------
 * `status` settles on `'unconfigured'` when the build has no `VITE_SUPABASE_*` and `'signed-out'`
 * when there is no session. Neither is an error and neither logs anything. Nothing is fetched, no
 * channel is opened, and every action resolves to a `no-backend` / `not-signed-in` result, so a
 * surface can render the existing local-only tree editor without asking a second question.
 *
 * Mounting this provider app-wide costs one `useAuth()` subscription, which on a signed-out visitor
 * settles without even requesting the supabase-js chunk (see `AuthContext`), and zero game-config
 * fetches until a membership actually exists (the war configs below are requested with an empty
 * file name until then, which `useGameData` treats as "nothing to load").
 *
 * REALTIME COVERS TWO TABLES, AND THAT IS ON PURPOSE
 * -------------------------------------------------
 * Only `clan_members` and `clan_tree` are in the publication (0003 keeps `clan_secrets` out, 0005
 * removes `clans` and `profiles`). So joins, leaves, role changes and shared-tree edits arrive
 * live; a rename, a badge change and a mate's new summary do not, and are picked up by `refresh()`.
 * The channel is torn down on unmount **and on every profile/clan change** — a leaked channel per
 * profile switch is a real bug, so the effect's dependency list is the clan id and nothing else
 * that changes on every render.
 *
 * THE WAR NUMBERS ARE NOT COMPUTED HERE ANY MORE
 * ---------------------------------------------
 * `src/utils/warPoints.ts` computes all eight categories with a confidence marker each, and this
 * provider's job is now to feed it the right configs, the right profile and the right moment, then
 * publish the result as `clan_share` v2. Phase 2's `estimateWarPoints()` is gone rather than fixed;
 * the section comment above `buildShare` says exactly why, and what `v2` added.
 *
 * Because that engine runs the real tech-tree optimiser, the computation is debounced separately
 * from the publish (`WAR_COMPUTE_DEBOUNCE_MS`) — this provider is mounted app-wide and would
 * otherwise re-run 500 greedy iterations on every keystroke in every calculator.
 *
 * CLAN SYNC: ONE SETTING, TWO DIRECTIONS, REMEMBERED PER BROWSER
 * -------------------------------------------------------------
 * `clanSyncEnabled` is the whole of it. On (the default) it means both halves of the exchange with
 * the clan run by themselves: this profile's summary is published after every change, and this
 * profile's `techTree.Clan` follows the row the leaders publish. Off means neither happens and the
 * summary row is cleared, so clan mates see "nothing shared" rather than a stale document.
 *
 * It is a PREFERENCE ABOUT THIS BROWSER, not data about a character, so it lives in
 * `localStorage` under `CLAN_SYNC_KEY` and never inside the profile. Three reasons, in order of
 * how bad the alternative is:
 *   - a profile travels. `profile.isShared` decodes somebody else's profile out of a `#p=` link,
 *     and a preference carried in the body would let a stranger's link decide whether this browser
 *     publishes to a clan;
 *   - a profile syncs. Storing it in the body would push a local UI choice to every other device
 *     of the same account, and back again, through the conflict machinery;
 *   - it is about the app's behaviour here, which is what a browser-scoped key means.
 * A missing or unreadable value reads as ON, because that is the default; a blocked or full
 * `localStorage` degrades to "on for this session" exactly the way `syncLedger` does.
 *
 * THE AUTO-PULL, AND THE TWO THINGS IT MUST NOT DO
 * -----------------------------------------------
 * `clan_tree` is in the Realtime publication, so a leader's publish already reaches every member as
 * an `onTreeChange` event. With the setting on, that event now writes the clan's levels into the
 * profile instead of waiting for the "Copy from clan" button. Nothing polls.
 *
 * It must not fight a leader who is editing: `lastLocalEditAt` records every change to
 * `techTree.Clan` that this provider did not itself write, and the pull is held off until the tree
 * has been still for `CLAN_TREE_EDIT_QUIET_MS`. A leader's own publish never bounces back either —
 * `publishedRowSig` remembers the row content this browser published, and a row that matches it is
 * our own echo.
 *
 * BOTH GUARDS ARE TESTED TWICE: once before the round trip and again when it lands. They exist to
 * protect somebody's typing, and the answer to "is somebody typing?" from before a network read is
 * not an answer about now. The first version tested them only before, and a level typed while the
 * read was open was destroyed by it.
 *
 * It must not loop: a pull writes exactly `clampLevels(row.levels)`, which is also the value the
 * effect compares against, so the second evaluation finds the two in step and does nothing. That
 * is a fixed point rather than a debounce — see the effect's own comment for why the clamp has to
 * be on both sides of the comparison, and `reverseForge/scratch/alwayson_shots.mjs` for the
 * 60-second quiet test that counts the writes.
 *
 * WHY PUBLISHING THE SUMMARY TOUCHES THE SYNC LEDGER
 * -------------------------------------------------
 * `profiles.clan_share` lives on the profile row, and `profiles_touch` bumps `profiles.version` on
 * **every** update — including this one. The sync engine pushes bodies with
 * `where id = ? and version = <last seen>` and reads zero rows as "somebody else wrote", i.e. it
 * would raise the keep-mine/take-theirs conflict UX for a row nobody edited. So a successful
 * publish carries the new version into `syncLedger` (monotonically: never lower a version, so a
 * body push that landed in between is not un-remembered). `useProfileSync.ts` is not touched.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useProfile } from './ProfileContext';
import { useAuth } from './AuthContext';
import { useGameDataContext } from './GameDataContext';
import { useGameData } from '../hooks/useGameData';
import { type WarCategory } from '../utils/guildWarUtils';
import {
    WAR_CATEGORIES,
    computeWarPoints,
    type WarPointsConfigs,
    type WarPointsResult,
} from '../utils/warPoints';
import {
    buildMemberBreakdown,
    type MemberBreakdown,
    type PublishedCategory,
} from '../utils/warPointsBreakdown';
import { fingerprint, readLedger, rememberEntry } from '../services/syncLedger';
import type { ClanBadge } from '../utils/clanBadge';
import type { UserProfile } from '../types/Profile';
import {
    CLAN_SHARE_MAX_BYTES,
    CLAN_SHARE_VERSION,
    approveClanRequest,
    badgeOf,
    clanShareByteSize,
    clearClanShare,
    createClan,
    deleteClan as deleteClanRow,
    denyClanRequest,
    generateJoinPassword,
    getClan,
    getClanTree,
    getClanTreeInfo,
    getJoinPassword,
    getMembership,
    getRosterDetail,
    joinClan,
    kickMember,
    leaveClan,
    listClanRequests,
    publishClanShare,
    recentClans,
    searchClans,
    setClanBadge,
    setClanTree,
    setJoinPassword,
    setMemberRole,
    subscribeToClan,
    transferOwnership,
    updateClan,
    type ClanError,
    type ClanJoinPolicy,
    type ClanMemberRow,
    type ClanPublic,
    type ClanRequestRow,
    type ClanResult,
    type ClanRole,
    type ClanRosterDetailRow,
    type ClanRow,
    type ClanShare,
    type ClanShareConfidence,
    type ClanShareProvenanceEntry,
    type ClanTreeInfoRow,
    type ClanTreeRow,
    type CreatedClan,
    type JoinClanOutcome,
} from '../services/clanApi';
import {
    WAR_PUSH_OPT_OUT_IS_SERVER_SIDE,
    battleDayFromDayConfig,
    buildDiscordExport,
    clearWarAssignments,
    createEnemyDummies,
    currentWarWeekStart,
    loadAssignmentSheet,
    loadWarBoard,
    notifyClan,
    publishWarPlan,
    removeWarParticipant,
    renameWarParticipant,
    saveWarPlan,
    setAttackerOrders,
    shiftWarWeek,
    addWarParticipant,
    updateWarParticipant,
    type CreateEnemiesResult,
    type PublishWarPlanResult,
    type WarBoard,
    type WarOrder,
    type WarParticipantPatch,
    type WarPlanError,
    type WarPlanPatch,
    type WarPlanResult,
    type WarPlanRow,
    type WarSheetRow,
    type WarSide,
} from '../services/warPlanApi';

/* ------------------------------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------------------------------ */

/** Search is a round trip per keystroke without this. 300 ms is under the "feels instant" bar. */
const SEARCH_DEBOUNCE_MS = 300;
/**
 * How long the profile must sit still before its summary is published. Long, on purpose: a member
 * dragging a stepper produces one change per pointer move, and every publish is a row version and
 * a `clans.activity_at` candidate. The content fingerprint below then suppresses the no-op writes
 * that a debounce alone cannot see (a value edited and edited back).
 */
const SHARE_DEBOUNCE_MS = 8000;
/**
 * How long the profile must sit still before the war numbers are RECOMPUTED.
 *
 * Separate from the publish debounce, and it exists because of what the maths now costs.
 * `computeWarPoints` runs the real tech-tree optimiser — up to 500 greedy iterations over 235
 * nodes — and this provider is mounted app-wide, so tying it to `profile` alone would run that on
 * every keystroke in every calculator on every page. 1.2 s is long enough that a stepper drag is
 * one run and short enough that `useClan().warPoints` still reads as live when a resource is typed.
 *
 * A PROFILE SWITCH BYPASSES IT. Trailing the live profile by a second is harmless for numbers about
 * the same profile; keeping the previous profile's numbers while `profileId` already points at the
 * next one would publish A's war points into B's row, which is the same class of bug
 * `LoadedState.forProfileId` exists to prevent.
 */
const WAR_COMPUTE_DEBOUNCE_MS = 1200;
/** Realtime events arrive one row at a time; a burst (a role change is two rows) becomes one refetch. */
const REFETCH_DEBOUNCE_MS = 250;
/**
 * How long `techTree.Clan` must be untouched before the auto-pull is allowed to replace it.
 *
 * This is the anti-clobber window, and it exists for ONE person: a leader. A plain member cannot
 * edit this tree at all (`pages/Clan.tsx` hides the steppers and the scanner for them, and
 * `set_clan_tree` answers 42501 regardless), so for a member the pull can never land on top of
 * anything they were doing. A leader, on the other hand, types the draft they are about to publish
 * into the very same numbers the pull overwrites — so every keystroke restarts this window, and a
 * second leader's publish waits behind it.
 *
 * 15 s is a compromise measured against the only two ways to be wrong: shorter, and a leader
 * pausing to read the in-game tree loses the levels they had typed; longer, and a member of a clan
 * whose leader is mid-edit keeps seeing the old numbers for no reason. The window only ever DELAYS
 * a pull — once the tree is still, the clan's published row is the clan's truth and it lands, with
 * the notice saying exactly what it changed.
 */
const CLAN_TREE_EDIT_QUIET_MS = 15000;

/**
 * The shortest gap between two focus-triggered reloads of the war board.
 *
 * This is the whole of the attacks planner's live-ness, and it exists because the war tables are
 * NOT in the Realtime publication (0009 declined to add them, and adding them would also mean
 * `replica identity full` on the busiest table of the feature). A leader who alt-tabs to the game,
 * reads the enemy roster off their phone and comes back gets the other leader's edits; alt-tabbing
 * ten times in a minute costs one request, not ten.
 *
 * 20 s is set against the only two ways to be wrong: shorter and a leader flicking between windows
 * generates traffic per switch, longer and two people editing together see stale rosters for long
 * enough to duplicate each other's work.
 */
const WAR_FOCUS_REFRESH_MS = 20000;

/**
 * Where "clan sync" is remembered, per browser. Follows the app's ad-hoc `forgeMaster_*` convention
 * (`forgeMaster_profiles`, `forgeMaster_syncMeta`, `forgeMaster_savedEnemies`) rather than inventing
 * a preferences store for one boolean.
 */
export const CLAN_SYNC_KEY = 'forgeMaster_clanSync';

/**
 * The game's six rarity names, in ascending order. One list, because eggs, skills and mounts all
 * use it: the war tasks are `Hatch<Rarity>Egg`, `Summon<Rarity>Skill`, `Summon<Rarity>Mount`, and
 * `profile.misc.ownedEggs` is keyed by the same strings (see `ResourcesEditor`).
 */
const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

/**
 * The four dungeon key names `profile.misc.dungeonKeyCounts` is keyed by, which is also the set
 * `ResourcesEditor` edits. Only the NAMES are needed here — which war task each key spends is
 * `src/utils/warPoints.ts`'s business, and duplicating that pairing is how the two would drift.
 */
const DUNGEON_KEYS = ['Hammer', 'Skill', 'Egg', 'Potion'] as const;

/**
 * How long a published reason / note may be.
 *
 * The engine's reasons are written to be read ("Of 250,000,000 coins only 16,800,000 are counted —
 * that is every forge upgrade left above level 12"), and they are the only thing that can tell a
 * clan mate WHY a figure is a floor under the publisher's config and resources. Eight of them plus
 * the global notes is the single biggest addition `v2` makes to the document, so they are capped:
 * the whole share has to stay far under 16 KB with fifty of them in one roster fetch.
 */
const MAX_REASON_CHARS = 260;
const MAX_NOTE_CHARS = 200;
const MAX_NOTES = 6;

/* ------------------------------------------------------------------------------------------ *
 * The setting — read once, written on every change, never allowed to throw
 * ------------------------------------------------------------------------------------------ */

/**
 * In-memory mirror, and the fallback when `localStorage` cannot be used at all (private mode, a
 * blocked origin, a full quota). Same degradation as `syncLedger`: the choice holds for this
 * session and is forgotten on reload, which lands back on the default — on.
 */
let clanSyncCache: boolean | null = null;

/**
 * Is clan sync on in this browser? A missing value, a value written by a build that did not know
 * about this key, or a storage that cannot be read at all all answer `true`, because on is the
 * default and "I could not find out" must never silently stop publishing somebody's summary.
 */
export function readClanSyncPref(): boolean {
    if (clanSyncCache !== null) return clanSyncCache;
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAN_SYNC_KEY) : null;
        clanSyncCache = raw !== 'off';
    } catch {
        clanSyncCache = true;
    }
    return clanSyncCache;
}

/** Remembers the choice. A storage that refuses still leaves the in-memory mirror correct. */
export function writeClanSyncPref(enabled: boolean): void {
    clanSyncCache = enabled;
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(CLAN_SYNC_KEY, enabled ? 'on' : 'off');
    } catch {
        // Quota or private mode: this session behaves as chosen, the next one starts from the default.
    }
}

/** Test hook: forget the mirror so the next read hits storage again. */
export function resetClanSyncCache(): void {
    clanSyncCache = null;
}

/* ------------------------------------------------------------------------------------------ *
 * Clan-tree levels — the shapes the pull and the auto-pull both reason about
 * ------------------------------------------------------------------------------------------ */

/**
 * A canonical string for one set of tree levels, so "did this change?" is a string compare.
 *
 * Zeros and junk are dropped exactly as `clampLevels` and `pages/Clan.tsx`'s `readLevels` drop
 * them, so `{}`, `{ "3": 0 }` and `{ "3": null }` all sign the same: they mean the same thing.
 */
function signLevels(levels: Record<string, number> | Record<number, number> | null | undefined): string {
    if (!levels) return '';
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(levels)) {
        const id = Number(key);
        const level = Number(raw);
        if (!Number.isInteger(id) || id < 0 || !Number.isFinite(level) || level <= 0) continue;
        parts.push(`${id}:${Math.floor(level)}`);
    }
    return parts.sort().join(',');
}

/**
 * The one clamp. `pullTree` and the auto-pull's "are we already in step?" test MUST agree, and the
 * reason is not tidiness: a shared 40 on a /20 node stores 20, so comparing the stored levels
 * against the RAW row would find a difference for ever and pull in a loop, once per render. The
 * comparison is therefore against this function's output on both sides.
 *
 * An id with no cap is not a node in the selected config — no card, no `ValuePerLevel`, no
 * consumer — so it is dropped rather than carried as an unbounded number.
 */
function clampLevels(
    raw: Record<string, number> | null | undefined,
    caps: Map<number, number>,
): { levels: Record<number, number>; clamped: number } {
    const levels: Record<number, number> = {};
    let clamped = 0;
    for (const [key, value] of Object.entries(raw || {})) {
        const id = Number(key);
        const level = Number(value);
        if (!Number.isInteger(id) || id < 0 || !Number.isFinite(level) || level <= 0) continue;
        const cap = caps.get(id);
        if (cap === undefined) continue;
        const capped = Math.min(Math.floor(level), cap);
        if (capped < Math.floor(level)) clamped += 1;
        if (capped > 0) levels[id] = capped;
    }
    return { levels, clamped };
}

/** What replacing `before` with `after` does, per node. Direction matters, so it is counted. */
function countTreeDelta(
    before: Record<string, number> | Record<number, number> | null | undefined,
    after: Record<number, number>,
): { changed: number; up: number; down: number } {
    const mine = new Map<number, number>();
    for (const [key, raw] of Object.entries(before || {})) {
        const id = Number(key);
        const level = Number(raw);
        if (Number.isInteger(id) && id >= 0 && Number.isFinite(level) && level > 0) mine.set(id, Math.floor(level));
    }
    let changed = 0;
    let up = 0;
    let down = 0;
    for (const id of new Set([...mine.keys(), ...Object.keys(after).map(Number)])) {
        const a = mine.get(id) || 0;
        const b = after[id] || 0;
        if (a === b) continue;
        changed += 1;
        if (b > a) up += 1;
        else down += 1;
    }
    return { changed, up, down };
}

/** Trims a publisher-written sentence to the budget above, on a word boundary where possible. */
function trimText(text: string, limit: number): string {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}`;
}

/* ------------------------------------------------------------------------------------------ *
 * Public shape
 * ------------------------------------------------------------------------------------------ */

export type ClanStatus =
    /** No `VITE_SUPABASE_*` in this build. Clans do not exist here. Not an error. */
    | 'unconfigured'
    /** Backend configured, nobody signed in. Not an error. */
    | 'signed-out'
    /** A shared profile is on screen: clanless by definition, and read-only. */
    | 'shared-profile'
    /** Resolving the active profile's membership. */
    | 'loading'
    /** Signed in, and this profile is in no clan. */
    | 'no-clan'
    /** Signed in and in a clan: `clan`, `roster` and `tree` are populated. */
    | 'ready'
    /** The last load failed. `error` says why; `refresh()` retries. */
    | 'error';

export type SharePublishStatus = 'idle' | 'pending' | 'publishing' | 'published' | 'error' | 'off';

export interface ClanDiscovery {
    /** ~10 most recently active clans. Loaded once per session and on `refreshRecent()`. */
    recent: ClanPublic[];
    recentLoading: boolean;
    /** Server-ranked results for `query`. Render in the order received — do not re-sort. */
    results: ClanPublic[];
    searching: boolean;
    query: string;
    setQuery: (q: string) => void;
    refreshRecent: () => void;
    error: ClanError | null;
}

export interface ClanShareState {
    status: SharePublishStatus;
    /** Epoch ms of the last successful publish in this session. */
    publishedAt: number | null;
    /** Byte size of the document as it would be sent. The ceiling is 16 KB. */
    bytes: number;
    error: ClanError | null;
    /** The document itself, so a debug panel can show exactly what the clan sees. */
    preview: ClanShare | null;
}

/**
 * What a pull actually wrote. `clamped` is not a statistic: a shared row may legitimately carry a
 * level above the cap the CURRENT config gives that node (a leader published under an older config,
 * or the game lowered a cap), and such a level is reduced on the way into the profile. The caller
 * has to be able to say so, because the number the user sees on the card is then not the number the
 * clan published.
 */
export interface PullTreeResult {
    /** Nodes written above 0. */
    nodes: number;
    /** How many of those were reduced to the node's `MaxLevel` in the selected config version. */
    clamped: number;
    /**
     * How many nodes the write actually MOVED, and in which direction. `changed: 0` is the answer
     * "the profile already had exactly these levels" — which is what a manual "Copy from clan"
     * gets whenever the auto-pull has already been here, and the difference between saying so and
     * claiming to have copied something.
     */
    changed: number;
    up: number;
    down: number;
}

/**
 * The last automatic clan-tree pull, kept until the user dismisses it.
 *
 * Deliberately state and not a toast: this write replaced numbers every calculator in the app reads,
 * and a notice that fades before it is read is indistinguishable from no notice at all.
 */
export interface AutoPullNotice {
    /** Epoch ms of the write. */
    at: number;
    /** Nodes above 0 in the profile afterwards. */
    nodes: number;
    /** Nodes whose level moved, and which way. */
    changed: number;
    up: number;
    down: number;
    /** How many landed below the level the clan published, because this config caps them lower. */
    clamped: number;
}

/**
 * The attacks planner's own status, which is NOT the clan's.
 *
 * `idle` is the important one and it is the resting state: this provider is mounted app-wide, so
 * the war board must not be fetched until something actually asks for it. `openWarPlan()` is that
 * ask, and until it is called nothing about the war plan costs a request.
 */
export type WarPlanTabStatus =
    /** Nobody has opened the planner yet. Nothing has been fetched. */
    | 'idle'
    /** No backend, signed out, a shared profile on screen, or this profile is in no clan. */
    | 'unavailable'
    | 'loading'
    /** Loaded, and there is no plan this profile may see for this week. NOT an error. */
    | 'none'
    | 'ready'
    | 'error';

/**
 * The attacks planner, as `useClan().war`.
 *
 * WHY IT LIVES HERE AND NOT IN ITS OWN PROVIDER. Every gate it needs is already computed in this
 * file and would otherwise be computed a second time, differently: which profile is on screen,
 * whether that profile is shared, which clan it is in, what role it holds there, and the war day
 * config the battle day is derived from. A second provider would be a second answer to "who am I
 * acting as", which is the exact bug `LoadedState.forProfileId` exists to prevent.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It opens no Realtime channel. The war tables are not in the
 * publication (0009 says so and no migration adds them), so a subscription would deliver silence
 * while spending one of the free plan's 200 concurrent connections on top of the one
 * `subscribeToClan()` already holds per signed-in member. Freshness comes from `refreshWar()`,
 * from every successful write reloading the board, and from a throttled reload when the window
 * regains focus while the planner is open.
 */
export interface UseWarPlan {
    status: WarPlanTabStatus;
    /** `YYYY-MM-DD`, always the UTC Tuesday that opens the week being looked at. */
    weekStart: string;
    /** Is `weekStart` the week we are actually in right now? Drives a "back to this week" control. */
    isCurrentWeek: boolean;
    setWeekStart: (iso: string) => void;
    /** Move the picker by whole war weeks. Negative goes back. */
    stepWeek: (weeks: number) => void;

    /** The plan, both rosters and every attack order. `null` while idle, loading, or when none exists. */
    board: WarBoard | null;
    error: WarPlanError | null;
    /** True while a war write is in flight. Separate from `busy` so a clan action does not grey this out. */
    busy: boolean;

    /**
     * Owner or admin of THIS clan, with a real profile on screen. The single gate for every editing
     * control in the planner — and a courtesy on top of the database, which refuses a member with
     * 42501 and holds no INSERT/UPDATE/DELETE grant for anyone on any war table.
     */
    canEdit: boolean;
    /**
     * The config day index of the battle day, DERIVED from "the day whose Tasks array is empty",
     * never hard-coded. `null` until the war day config has loaded. Label it `battleDay + 1`:
     * `GuildWar.tsx` renders index 5 as "Day 6".
     */
    battleDay: number | null;
    /**
     * Clan mates who are not yet on the ally roster, so an "add player" picker does not offer
     * somebody twice. Empty while the board is idle.
     */
    addableMembers: { profileId: string; name: string; role: ClanRole }[];
    /**
     * `false`, and it is measured. `broadcast_clan_notification()` fans out to every account in the
     * clan with no preference filter and `push_subscriptions` has no per-kind column, so a member
     * cannot opt out of war pushes. A surface must say so rather than draw a switch that does
     * nothing. See `warPlanApi`'s header for the two-line migration that would change it.
     */
    pushOptOutIsServerSide: boolean;

    /** Start using the planner: the first fetch of the board. Idempotent, safe to call from an effect. */
    openWarPlan: () => void;
    /** Refetch now. One request (or three on the embedding fallback), never one per member. */
    refreshWar: () => Promise<void>;

    // ---- leaders only; every one refuses locally for a shared profile or a plain member ----
    /** Create this week's plan, or edit it. Omitted fields are left unchanged; nothing can be cleared. */
    savePlan: (patch: WarPlanPatch, options?: { expectedRevision?: number }) => Promise<WarPlanResult<WarPlanRow>>;
    /** Start this week's plan, with the battle day derived from the config rather than assumed. */
    createPlan: () => Promise<WarPlanResult<WarPlanRow>>;
    /** Add a real clan mate, or a stand-in when `profileId` is omitted. */
    addAlly: (params: { profileId?: string; displayName?: string; powerEstimate?: number }) => Promise<WarPlanResult<string>>;
    /** Add one enemy. An enemy is always a typed name: the tool cannot know another guild's accounts. */
    addEnemy: (displayName: string, powerEstimate?: number) => Promise<WarPlanResult<string>>;
    /** "Choose the number of users": N enemies at once. N round trips — 0009 has no batch RPC. */
    addEnemies: (count: number, options?: { prefix?: string }) => Promise<WarPlanResult<CreateEnemiesResult>>;
    /** Rename anybody on either roster, so the export names a person instead of "enemy 7". */
    rename: (participantId: string, side: WarSide, displayName: string) => Promise<WarPlanResult<string>>;
    updateParticipant: (participantId: string, side: WarSide, patch: WarParticipantPatch) => Promise<WarPlanResult<string>>;
    /** Resolves with how many attack orders went with them (the FK cascade). Show that number. */
    removeParticipant: (participantId: string) => Promise<WarPlanResult<number>>;
    /**
     * Replace one ally's whole order list. An empty array is the "clear this player" gesture.
     *
     * Pass `expectedAssignmentIds` — the ids currently on the board for this attacker, in slot
     * order — and the write is refused with `version-conflict` if another leader moved them first,
     * instead of silently overwriting their work. `warPlanApi` has always accepted the precondition;
     * omitting it is last-one-wins.
     */
    setOrders: (
        attackerId: string,
        orders: WarOrder[],
        options?: { expectedAssignmentIds?: string[] },
    ) => Promise<WarPlanResult<number>>;
    /** Delete every attack order in the plan, keeping both rosters. There is no undo. */
    clearOrders: () => Promise<WarPlanResult<number>>;
    /** Publish and (by default) push to the clan, in one transaction. */
    publish: (options?: { notify?: boolean }) => Promise<WarPlanResult<PublishWarPlanResult>>;
    /** Take it back to a draft, which also hides it from plain members again. */
    retract: () => Promise<WarPlanResult<WarPlanRow>>;
    /** Remind the clan without republishing. One a minute, per clan. */
    notify: (title: string, body: string) => Promise<WarPlanResult<number>>;

    // ---- the export ----
    /** The canonical sheet rows: one per (ally, order), plus one per ally with no order yet. */
    loadSheet: () => Promise<WarPlanResult<WarSheetRow[]>>;
    /** The same sheet as text to paste into Discord. Split it with `splitForDiscord` if it is long. */
    exportText: (options?: { codeBlock?: boolean }) => Promise<WarPlanResult<string>>;
}

export interface UseClan {
    status: ClanStatus;
    error: ClanError | null;
    /** True while any action is in flight, for disabling buttons. */
    busy: boolean;

    /** `true` when a share link is being viewed: clanless, and every write is refused. */
    isSharedProfile: boolean;
    /** The profile this state is about — `null` when there is nothing to be about. */
    profileId: string | null;

    membership: ClanMemberRow | null;
    /** The ACTIVE PROFILE's role, never the account's. */
    role: ClanRole | null;
    clan: ClanRow | null;
    badge: ClanBadge | null;
    roster: ClanRosterDetailRow[];
    requests: ClanRequestRow[];
    tree: ClanTreeRow | null;
    treeInfo: ClanTreeInfoRow | null;
    /** `true` while the Realtime channel is subscribed. Purely cosmetic. */
    live: boolean;

    // ---- the rules, as booleans that read like the rules ----
    /** Owner or admin. The single gate for the steppers, the level input and the scanner. */
    canEditTree: boolean;
    /** Owner only: promote, demote. */
    canManageRoles: boolean;
    /** Owner or admin: `clan_secrets` returns rows for exactly these two. */
    canSeePassword: boolean;
    /** Owner kicks anyone but themself; admin kicks members only; the owner is unkickable. */
    canKick: (memberRole: ClanRole) => boolean;
    /** Owner only. */
    canDeleteClan: boolean;
    /** Anyone in a clan may leave — but see `mustTransferBeforeLeaving`. */
    canLeave: boolean;
    /** An owner with other members must hand the clan over first; the sole member takes it with them. */
    mustTransferBeforeLeaving: boolean;
    /** Any member may pull the shared tree into their own profile. */
    canPullTree: boolean;

    // ---- actions ----
    create: (params: { name: string; tag: string; joinPolicy?: ClanJoinPolicy }) => Promise<ClanResult<CreatedClan>>;
    join: (params: { name: string; tag: string; password: string }) => Promise<ClanResult<JoinClanOutcome>>;
    leave: () => Promise<ClanResult<null>>;
    kick: (profileId: string) => Promise<ClanResult<null>>;
    promote: (profileId: string) => Promise<ClanResult<null>>;
    demote: (profileId: string) => Promise<ClanResult<null>>;
    handOver: (toProfileId: string) => Promise<ClanResult<null>>;
    remove: () => Promise<ClanResult<null>>;
    edit: (patch: { name?: string; tag?: string; joinPolicy?: ClanJoinPolicy; memberCap?: number }) => Promise<ClanResult<ClanRow>>;
    setBadge: (badge: ClanBadge) => Promise<ClanResult<null>>;
    approve: (profileId: string) => Promise<ClanResult<null>>;
    deny: (profileId: string) => Promise<ClanResult<null>>;

    /** Leaders only. Writes the SHARED tree; `{ "<globalId>": level }`, zeros are stripped server-side. */
    saveTree: (levels: Record<string, number>) => Promise<ClanResult<ClanTreeRow>>;
    /** Every member. Copies the shared tree into `profile.techTree.Clan` — a read plus a local write. */
    pullTree: () => Promise<ClanResult<PullTreeResult>>;

    /** Leaders only. `null` means "not visible to you", which is not an error. */
    password: string | null;
    passwordLoading: boolean;
    revealPassword: () => Promise<ClanResult<string | null>>;
    setPassword: (password: string) => Promise<ClanResult<null>>;
    regeneratePassword: () => Promise<ClanResult<string>>;

    share: ClanShareState;
    /** Publish now instead of waiting for the debounce. */
    publishShare: () => Promise<ClanResult<null>>;
    /**
     * Turns clan sync OFF: remembers the choice for this browser, clears `clan_share` so clan mates
     * see "nothing shared" instead of a document that has stopped moving, and stops the auto-pull.
     * The preference is written FIRST and unconditionally — a signed-out or offline user who turns
     * this off has still said what they want.
     */
    stopSharing: () => Promise<ClanResult<null>>;
    /**
     * Turn clan sync on or off. Persisted per browser (`CLAN_SYNC_KEY`).
     *
     * Prefer `stopSharing()` for the OFF transition: this setter only stops future writes, and a
     * summary already on the server would stay there, readable and slowly going stale.
     */
    setClanSyncEnabled: (enabled: boolean) => void;
    /**
     * ON (the default) means both halves run by themselves: the summary is published after every
     * change, and this profile's `techTree.Clan` follows the clan's published row.
     */
    clanSyncEnabled: boolean;
    /** The last automatic clan-tree pull, until dismissed. `null` when there is nothing to report. */
    autoPull: AutoPullNotice | null;
    dismissAutoPull: () => void;
    /**
     * The war numbers exactly as they will be published, plus every reason and caveat behind them.
     *
     * `null` until the game configs the engine needs have loaded. This is the LOCAL member's own
     * result — a surface that wants to explain the published figures (or to warn that a category is
     * blind because a resource was never entered) reads it from here rather than running
     * `computeWarPoints` a second time with a different tree mode.
     *
     * This replaces phase 2's `setWarPointsOverride()` seam. That existed because the publisher
     * could not compute `tech`, `forge` or `pets` at all and something else had to inject them;
     * `src/utils/warPoints.ts` now computes all eight WITH a confidence marker, and an injected
     * number could not carry one — so the seam was removed rather than left as a way to publish a
     * figure nobody can vouch for.
     */
    warPoints: WarPointsResult | null;

    /**
     * Itemise ONE clan mate's published summary, on demand.
     *
     * `clan_share` carries the eight category totals and one collapsed ceiling each; the itemised
     * `parts` the engine produced are dropped at publish time, and have to be — fifty members share
     * a 16 KB-per-member budget. So the breakdown is not published, it is RE-DERIVED here, by
     * running `computeWarPoints` over the trees and resources that member did publish, and then
     * checked category by category against their own figures. See
     * `src/utils/warPointsBreakdown.ts` for why the check is the whole design.
     *
     * ON DEMAND, and that is measured rather than assumed. One pass over a profile the tech
     * optimiser has real work in costs 11 ms (0.7 ms when the tree is maxed and it plans nothing —
     * the optimiser is 16x the rest of the engine put together), so fifty of them is 495 ms median
     * and 598 ms worst on this machine: `reverseForge/scratch/breakdown_timing.mjs`. That is half a
     * second of frozen roster, so the cheap published totals paint first and this runs only for the
     * row a reader actually opens. Results are cached per member+document, so opening, closing and
     * reopening a row costs one pass.
     *
     * `null` when the member published nothing (nothing to itemise — and a caller must keep saying
     * "nothing shared" rather than printing zeros) or while the game configs are still loading.
     */
    memberBreakdown: (
        profileId: string,
        share: ClanShare | null,
        published: Record<WarCategory, PublishedCategory>,
    ) => MemberBreakdown | null;

    /**
     * The day-5 attacks planner. Fetches NOTHING until `war.openWarPlan()` is called, so mounting
     * this provider app-wide still costs no war request on any other screen.
     */
    war: UseWarPlan;

    discovery: ClanDiscovery;
    refresh: () => Promise<void>;
}

/* ------------------------------------------------------------------------------------------ *
 * clan_share — the document, built from the war-points engine
 * ------------------------------------------------------------------------------------------ */

/**
 * WHERE THE WAR NUMBERS COME FROM NOW.
 *
 * Phase 2 computed them here, in a function called `estimateWarPoints`, and that function has been
 * deleted rather than fixed. It was a first-order projection: `tech`, `forge` and `pets` were
 * structurally 0 because they need the tree optimiser, the age drop table and a pet collection;
 * `skills` and `mounts` dropped every cost reduction and the whole merge half; and `forgeSpend`
 * was not a lower bound at all but an UPPER one — `floor(coins / 1000) × 27` over the entire coin
 * bank pays a player with 500 M coins twelve times more points than every forge upgrade in the
 * game costs.
 *
 * `src/utils/warPoints.ts` is the replacement: a React-free engine that runs the real greedy tech
 * optimiser (extracted out of `useTreeOptimizer` precisely so a data layer can call it without the
 * hook writing to the profile on mount), prices hammers through `ItemAgeDropChancesLibrary`, caps
 * coins by the forge upgrades the member still has ahead of them, applies each clan
 * `WarPointsFrom` node, and — this is the part the document had no room for before — attaches a
 * `confidence` and a one-sentence `reason` to every one of the eight categories.
 *
 * WHY THAT NEEDED A `v` BUMP AND A SIBLING FIELD.
 * `war[c].points` still means what §4g says it means, so a `v1` reader is not broken. What changed
 * is that a reader can now tell an exact figure from a floor from a blind spot — and that
 * information cannot go inside `war`, because a `v1` reader walks those entries and would carry
 * unknown keys into its own arithmetic. So it is a sibling, `prov`, and it is OPTIONAL: shares
 * published by phase 2 stay in the wild until their author next opens the app, and "no `prov`"
 * has to keep meaning "this member's tool did not record provenance" rather than "exact".
 *
 * WHAT IS DELIBERATELY NOT PUBLISHED.
 * `byDay` carries NO per-day clan node (`WarPointsOnDayN`), so it still adds up to the category
 * totals that have a day — the one consistency check a reader can run on a member-written
 * document, and `MemberSummaryCard` runs it. The boosted six numbers ride along as `prov.dayPts`
 * with the multipliers themselves in `prov.dayMul`, which is what a planner actually wants to see
 * on the day a member's node fires.
 */

/** Tech-tree levels with the zeros dropped — they are the default, and 61+90 zeros is pure weight. */
function compactTree(tree: Record<number, number> | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    if (!tree) return out;
    for (const [id, level] of Object.entries(tree)) {
        const value = Number(level);
        if (Number.isFinite(value) && value > 0) out[id] = value;
    }
    return out;
}

/**
 * The war-relevant resources, read from the SAME `profile.misc` keys the calculators use.
 *
 * These are PUBLISHED FIGURES, not the engine's input: the engine reads `profile.misc` itself,
 * where it can tell "never entered" from "zero" (`recorded()`), which this block cannot — `|| 0`
 * flattens both to 0. That is fine for a display of what somebody is holding, and it is exactly
 * why the confidence markers exist next to the points instead of being inferred from these.
 */
function readResources(profile: UserProfile): ClanShare['res'] {
    const misc = profile.misc || ({} as UserProfile['misc']);
    const ownedEggs = (misc.ownedEggs || {}) as Record<string, number>;
    const keys = (misc.dungeonKeyCounts || {}) as unknown as Record<string, number>;

    const eggs: Record<string, number> = {};
    for (const rarity of RARITIES) eggs[rarity] = Math.max(0, Math.round(ownedEggs[rarity] || 0));

    const keyCounts: Record<string, number> = {};
    for (const key of DUNGEON_KEYS) {
        keyCounts[key] = Math.max(0, Math.round(keys[key] || 0));
    }

    return {
        coins: Math.max(0, Math.round(misc.coins || 0)),
        gems: Math.max(0, Math.round(misc.gemCount || 0)),
        hammers: Math.max(0, parseInt(misc.forgeCalculator?.hammers || '0', 10) || 0),
        skillTickets: Math.max(0, Math.round(misc.skillCalculatorTickets || 0)),
        clockWinders: Math.max(0, Math.round(misc.mountCalculatorWinders || 0)),
        eggshells: Math.max(0, Math.round(misc.eggshellCount || 0)),
        techPotions: Math.max(0, Math.round(misc.techPotions || 0)),
        guildPotions: Math.max(0, Math.round(misc.guildPotions || 0)),
        eggs,
        keys: keyCounts,
    };
}

/**
 * The ceiling a category knowingly left out, as one number.
 *
 * `WarCategoryPoints.parts` mixes two kinds of key: plain ones that are slices OF `points`, and
 * `excluded:` ones that are NOT — the mount-merge half, the pet-merge ceiling, the coins past the
 * known forge sink. Only the second kind belongs here, and they are already final (each carries
 * its own clan node), so they are simply summed.
 */
function excludedCeiling(parts: Record<string, number>): number {
    let total = 0;
    for (const [key, value] of Object.entries(parts)) {
        if (key.startsWith('excluded:') && Number.isFinite(value) && value > 0) total += value;
    }
    return Math.round(total);
}

/**
 * Builds the whole `clan_share` document, minus `at` — the timestamp is added at publish time so
 * that two identical documents computed a minute apart still fingerprint the same and the debounced
 * publisher can suppress the write.
 *
 * Returns the engine's own result alongside the draft, because `useClan().warPoints` hands it to
 * the UI: the reasons and notes a member needs in order to fix a blind category ("no hammer count
 * recorded") are the same strings that go into the document, and computing them twice under two
 * different clocks would put two different numbers on one screen.
 */
export function buildShare(
    profile: UserProfile,
    configVersion: string,
    configs: WarPointsConfigs,
): { draft: Omit<ClanShare, 'at'>; computed: WarPointsResult } {
    const res = readResources(profile);
    const computed = computeWarPoints(profile, configs);

    const war = {} as ClanShare['war'];
    const cat = {} as Record<WarCategory, ClanShareProvenanceEntry>;

    for (const category of WAR_CATEGORIES) {
        const entry = computed.categories[category];
        war[category] = {
            points: entry ? entry.points : 0,
            days: entry ? [...entry.days] : [],
        };
        const ceiling = entry ? excludedCeiling(entry.parts) : 0;
        cat[category] = {
            conf: (entry ? entry.confidence : 'unavailable') as ClanShareConfidence,
            base: entry ? entry.basePoints : 0,
            ...(ceiling > 0 ? { ceiling } : {}),
            ...(entry?.reason ? { why: trimText(entry.reason, MAX_REASON_CHARS) } : {}),
        };
    }

    const anyDayBoost = computed.dayBoosts.some(v => v !== 0);

    return {
        computed,
        draft: {
            v: CLAN_SHARE_VERSION,
            cfg: configVersion,
            trees: {
                Forge: compactTree(profile.techTree?.Forge),
                Power: compactTree(profile.techTree?.Power),
                SkillsPetTech: compactTree(profile.techTree?.SkillsPetTech),
                Clan: compactTree(profile.techTree?.Clan),
            },
            res,
            war,
            // The unboosted split: this is the array that has to add up (see the header note).
            byDay: [...computed.byDayBase],
            prov: {
                conf: computed.confidence as ClanShareConfidence,
                cat,
                // Six zeros are not worth 20 bytes × 50 members; omitted when the member holds no
                // day node at all, and a reader then treats them as absent, not as boosted.
                ...(anyDayBoost
                    ? { dayMul: computed.dayBoosts.map(v => Math.round(v * 1000) / 1000), dayPts: [...computed.byDay] }
                    : {}),
                hrs: Math.round(computed.techTimeLimitHours),
                full: computed.configComplete,
                ...(computed.notes.length
                    ? { notes: computed.notes.slice(0, MAX_NOTES).map(n => trimText(n, MAX_NOTE_CHARS)) }
                    : {}),
            },
        },
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Inert state — what a caller gets with no provider, no backend or no session
 * ------------------------------------------------------------------------------------------ */

const NO_BACKEND_ERROR: ClanError = {
    kind: 'no-backend',
    message: 'Clans need an account, and this build has no server configured. Everything else keeps working locally.',
};

const SIGNED_OUT_ERROR: ClanError = {
    kind: 'not-signed-in',
    message: 'Sign in to use clans.',
};

const SHARED_PROFILE_ERROR: ClanError = {
    kind: 'not-your-profile',
    message: 'You are viewing a shared profile. Save it to your own profiles first.',
};

const EMPTY_SHARE_STATE: ClanShareState = {
    status: 'idle',
    publishedAt: null,
    bytes: 0,
    error: null,
    preview: null,
};

function refuse<T>(error: ClanError): Promise<ClanResult<T>> {
    return Promise.resolve({ ok: false, error });
}

/* ---- the same three refusals, in the war planner's wider error type -------------------- */

const WAR_NO_BACKEND_ERROR: WarPlanError = {
    kind: 'no-backend',
    message: 'The attacks planner needs an account, and this build has no server configured. Everything else keeps working locally.',
};

const WAR_SIGNED_OUT_ERROR: WarPlanError = {
    kind: 'not-signed-in',
    message: 'Sign in to use the attacks planner.',
};

/**
 * A shared profile can do NOTHING here, and this is the one place that is decided.
 *
 * An imported `#p=` profile has a freshly minted id that exists in no database and is in no clan
 * by construction (membership never travels inside a profile). Sending its id to a war RPC would
 * either fail server-side or, far worse, act as whichever of the user's OWN profiles is signed in
 * — a leader viewing somebody's share link could publish a war plan without meaning to. So every
 * war write is refused before the request is built, exactly as `act()` already does for clans.
 */
const WAR_SHARED_PROFILE_ERROR: WarPlanError = {
    kind: 'not-your-profile',
    message: 'You are viewing a shared profile. Save it to your own profiles first.',
};

const WAR_NOT_A_LEADER_ERROR: WarPlanError = {
    kind: 'not-a-leader',
    message: 'Only the clan owner or an admin can change the attack plan.',
};

const WAR_NO_CLAN_ERROR: WarPlanError = {
    kind: 'not-a-member',
    message: 'This profile is not in a clan.',
};

const WAR_NO_PLAN_ERROR: WarPlanError = {
    kind: 'not-found',
    message: 'There is no plan for this war week yet. Start one first.',
};

function refuseWar<T>(error: WarPlanError): Promise<WarPlanResult<T>> {
    return Promise.resolve({ ok: false, error });
}

/**
 * The war planner with no provider, no backend or no session: idle, empty, and every action a
 * `no-backend` result. Mirrors `INERT` below, for the same reason — a surface must be writable
 * before the provider is wired up without taking the app down.
 */
const INERT_WAR: UseWarPlan = {
    status: 'unavailable',
    weekStart: currentWarWeekStart(),
    isCurrentWeek: true,
    setWeekStart: () => undefined,
    stepWeek: () => undefined,
    board: null,
    error: null,
    busy: false,
    canEdit: false,
    battleDay: null,
    addableMembers: [],
    pushOptOutIsServerSide: WAR_PUSH_OPT_OUT_IS_SERVER_SIDE,
    openWarPlan: () => undefined,
    refreshWar: async () => undefined,
    savePlan: () => refuseWar(WAR_NO_BACKEND_ERROR),
    createPlan: () => refuseWar(WAR_NO_BACKEND_ERROR),
    addAlly: () => refuseWar(WAR_NO_BACKEND_ERROR),
    addEnemy: () => refuseWar(WAR_NO_BACKEND_ERROR),
    addEnemies: () => refuseWar(WAR_NO_BACKEND_ERROR),
    rename: () => refuseWar(WAR_NO_BACKEND_ERROR),
    updateParticipant: () => refuseWar(WAR_NO_BACKEND_ERROR),
    removeParticipant: () => refuseWar(WAR_NO_BACKEND_ERROR),
    setOrders: () => refuseWar(WAR_NO_BACKEND_ERROR),
    clearOrders: () => refuseWar(WAR_NO_BACKEND_ERROR),
    publish: () => refuseWar(WAR_NO_BACKEND_ERROR),
    retract: () => refuseWar(WAR_NO_BACKEND_ERROR),
    notify: () => refuseWar(WAR_NO_BACKEND_ERROR),
    loadSheet: () => refuseWar(WAR_NO_BACKEND_ERROR),
    exportText: () => refuseWar(WAR_NO_BACKEND_ERROR),
};

/**
 * The value `useClan()` returns when no `<ClanProvider>` is mounted above it.
 *
 * A throw would be the house style (`useProfile` does), but it would also mean that adding a clan
 * widget to a page before the provider is wired up takes the whole app down — and the hard rule is
 * that the app must keep working with no backend at all. So the hook degrades to exactly the state
 * an unconfigured build produces, which every surface already has to handle.
 */
const INERT: UseClan = {
    status: 'unconfigured',
    error: null,
    busy: false,
    isSharedProfile: false,
    profileId: null,
    membership: null,
    role: null,
    clan: null,
    badge: null,
    roster: [],
    requests: [],
    tree: null,
    treeInfo: null,
    live: false,
    canEditTree: false,
    canManageRoles: false,
    canSeePassword: false,
    canKick: () => false,
    canDeleteClan: false,
    canLeave: false,
    mustTransferBeforeLeaving: false,
    canPullTree: false,
    create: () => refuse(NO_BACKEND_ERROR),
    join: () => refuse(NO_BACKEND_ERROR),
    leave: () => refuse(NO_BACKEND_ERROR),
    kick: () => refuse(NO_BACKEND_ERROR),
    promote: () => refuse(NO_BACKEND_ERROR),
    demote: () => refuse(NO_BACKEND_ERROR),
    handOver: () => refuse(NO_BACKEND_ERROR),
    remove: () => refuse(NO_BACKEND_ERROR),
    edit: () => refuse(NO_BACKEND_ERROR),
    setBadge: () => refuse(NO_BACKEND_ERROR),
    approve: () => refuse(NO_BACKEND_ERROR),
    deny: () => refuse(NO_BACKEND_ERROR),
    saveTree: () => refuse(NO_BACKEND_ERROR),
    pullTree: () => refuse(NO_BACKEND_ERROR),
    password: null,
    passwordLoading: false,
    revealPassword: () => refuse(NO_BACKEND_ERROR),
    setPassword: () => refuse(NO_BACKEND_ERROR),
    regeneratePassword: () => refuse(NO_BACKEND_ERROR),
    share: EMPTY_SHARE_STATE,
    publishShare: () => refuse(NO_BACKEND_ERROR),
    stopSharing: () => refuse(NO_BACKEND_ERROR),
    setClanSyncEnabled: () => undefined,
    // `false`, not the stored preference: with no provider and no backend nothing is synchronised
    // with anything, and a surface that reads this must render nothing rather than promise a
    // behaviour this build cannot have. `ClanSyncPanel` checks `status === 'unconfigured'` too.
    clanSyncEnabled: false,
    autoPull: null,
    dismissAutoPull: () => undefined,
    warPoints: null,
    // No configs can have loaded without a provider, and the honest answer to "itemise this member"
    // is then the same as for a member who published nothing: nothing, so the caller keeps saying so.
    memberBreakdown: () => null,
    war: INERT_WAR,
    discovery: {
        recent: [],
        recentLoading: false,
        results: [],
        searching: false,
        query: '',
        setQuery: () => undefined,
        refreshRecent: () => undefined,
        error: null,
    },
    refresh: async () => undefined,
};

const ClanContext = createContext<UseClan | undefined>(undefined);

/* ------------------------------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------------------------------ */

interface LoadedState {
    /**
     * WHICH PROFILE THIS SNAPSHOT DESCRIBES. Load-bearing, not bookkeeping.
     *
     * `activeProfileId` changes SYNCHRONOUSLY when the user picks another profile; a membership
     * read is a round trip. Between the two, this state still holds the previous profile's clan —
     * and `clanId`/`role` are what every write and every permission gate is computed from. Without
     * this stamp a leader of clan A who switches to a plain-member profile of clan B keeps A's
     * clan id and A's `owner` role for the length of one HTTP request, which was enough to publish
     * profile B's local tree over clan A's shared tree (measured: `set_clan_tree(A, {"3":4})`
     * replacing six nodes). The server cannot catch that — the caller really is A's owner, so the
     * request is authorised; it is simply the wrong request. Only the client knows which profile
     * the user is acting as, so the check has to live here.
     *
     * Everything below is therefore read through `view`, which is this snapshot only while it
     * still belongs to the active profile and `EMPTY_LOADED` the moment it does not.
     */
    forProfileId: string | null;
    membership: ClanMemberRow | null;
    clan: ClanRow | null;
    roster: ClanRosterDetailRow[];
    requests: ClanRequestRow[];
    tree: ClanTreeRow | null;
    treeInfo: ClanTreeInfoRow | null;
}

const EMPTY_LOADED: LoadedState = {
    forProfileId: null,
    membership: null,
    clan: null,
    roster: [],
    requests: [],
    tree: null,
    treeInfo: null,
};

export const ClanProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { profile, activeProfileId, updateNestedProfile } = useProfile();
    const { status: authStatus, userId, backendConfigured } = useAuth();
    const { selectedVersion } = useGameDataContext();

    // `profile.isShared` is how ProfileContext says "a share link is on screen". `activeProfileId`
    // then reports the imported profile's freshly minted id, which exists in no database — so the
    // id is only ever used when this is false.
    const isSharedProfile = !!profile?.isShared;
    const signedIn = authStatus === 'signed-in' && !!userId;
    const profileId = !isSharedProfile && activeProfileId ? activeProfileId : null;
    const canTalk = backendConfigured && signedIn && !!profileId;

    const [loaded, setLoaded] = useState<LoadedState>(EMPTY_LOADED);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ClanError | null>(null);
    const [busy, setBusy] = useState(false);
    const [live, setLive] = useState(false);

    const [password, setPasswordValue] = useState<string | null>(null);
    const [passwordLoading, setPasswordLoading] = useState(false);

    const [recent, setRecent] = useState<ClanPublic[]>([]);
    const [recentLoading, setRecentLoading] = useState(false);
    const [results, setResults] = useState<ClanPublic[]>([]);
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState('');
    const [discoveryError, setDiscoveryError] = useState<ClanError | null>(null);

    /* ---- the attacks planner. Nothing here fetches until `openWarPlan()` is called. ---- */

    /**
     * Has anything asked for the war board yet?
     *
     * STATE and not a ref, because `status` is derived from it and flipping it has to re-render.
     * It is what keeps this provider — which is mounted app-wide — from spending a request on the
     * war plan for every visitor who never opens the planner.
     */
    const [warOpened, setWarOpened] = useState(false);
    /** UTC, always a Tuesday. See `currentWarWeekStart()` for why local dates would be wrong. */
    const [warWeekStart, setWarWeekStartValue] = useState<string>(() => currentWarWeekStart());
    const [warLoading, setWarLoading] = useState(false);
    const [warBusy, setWarBusy] = useState(false);
    const [warError, setWarError] = useState<WarPlanError | null>(null);
    /**
     * The board, STAMPED with the clan and the week it describes — the same discipline
     * `LoadedState.forProfileId` applies, and for the same reason. `clanId` and `warWeekStart`
     * change synchronously; a board read is a round trip. Between the two, unguarded state would
     * still be showing clan A's enemy roster while every action was already aimed at clan B.
     */
    const [warLoaded, setWarLoaded] = useState<{ forClanId: string | null; forWeek: string; board: WarBoard | null }>(
        { forClanId: null, forWeek: '', board: null },
    );
    /** Bumped on every war load, so a response for the previous clan or week cannot be applied. */
    const warGeneration = useRef(0);
    /** Last focus-triggered reload, so alt-tabbing repeatedly is not a request per switch. */
    const warLastFocusReload = useRef(0);

    const [shareState, setShareState] = useState<ClanShareState>(EMPTY_SHARE_STATE);
    /**
     * Clan sync. Read from storage on first render (lazy initialiser, so it is one read per mount)
     * and defaulting to ON for a browser that has never been asked. See `readClanSyncPref`.
     */
    const [clanSyncEnabled, setClanSyncState] = useState<boolean>(readClanSyncPref);
    const [autoPull, setAutoPull] = useState<AutoPullNotice | null>(null);

    /** The public setter: state and storage move together, so a reload cannot disagree with the UI. */
    const setClanSyncEnabled = useCallback((enabled: boolean) => {
        writeClanSyncPref(enabled);
        setClanSyncState(enabled);
        // Turning it back on has nothing to announce yet, and a notice about a pull from before it
        // was switched off is stale the moment it is off.
        if (!enabled) setAutoPull(null);
    }, []);

    const dismissAutoPull = useCallback(() => setAutoPull(null), []);

    /**
     * The snapshot, but ONLY while it still describes the profile that is active right now. A
     * profile switch invalidates it synchronously, so no clan id, role, roster, tree or permission
     * derived below can outlive the profile it was loaded for. See `LoadedState.forProfileId`.
     */
    const view = loaded.forProfileId === profileId ? loaded : EMPTY_LOADED;

    const clanId = view.membership?.clan_id ?? null;
    const role = view.membership?.role ?? null;

    /**
     * Guards every async write against landing in a provider that has moved on (profile switched,
     * signed out, unmounted). Incrementing on every reload is what makes a late response from the
     * previous profile impossible to apply.
     */
    const generation = useRef(0);

    /**
     * Fingerprint of the summary the server already has. Content-only (the draft carries no `at`),
     * which is what lets an edit-and-undo resolve to "nothing to send" instead of a pointless write.
     */
    const lastPublished = useRef<string | null>(null);

    /* ---- the four facts the auto-pull needs, none of which belong in render state ---- *
     *
     * They are refs because changing any of them must NOT re-render (three of them change on every
     * keystroke in the clan tree) and because the auto-pull effect has to read the value as of the
     * moment it runs, not as of the render it was created in.
     */

    /** Signature of `techTree.Clan` as last SEEN, with the profile it belonged to. */
    const seenClanTree = useRef<{ profileId: string | null; sig: string }>({ profileId: null, sig: '' });
    /** Signature this provider last wrote itself, so its own write is not mistaken for a user edit. */
    const writtenClanTree = useRef<string | null>(null);
    /**
     * `techTree.Clan` AS IT IS NOW, not as it was when a pull started.
     *
     * `runPull` awaits a network round trip, and everything it decides afterwards — is anything
     * different, how many nodes move, which way — has to be decided against the tree the user is
     * looking at when the answer lands, not the one from the render that started the read. Reading
     * the closure's copy instead lost a level typed during the round trip: measured, node 1 typed to
     * 15 and stored back as the clan's 1, with the quiet window powerless because it is tested
     * before the await.
     */
    const liveClanTree = useRef<Record<string, number> | Record<number, number> | null | undefined>(
        profile.techTree?.Clan,
    );
    useEffect(() => { liveClanTree.current = profile.techTree?.Clan; }, [profile.techTree]);
    /** When the local user last changed `techTree.Clan`. 0 = never, in this session. */
    const lastLocalEditAt = useRef(0);
    /**
     * THE ECHO TEST: the shared-row content THIS browser published, if any. `null` until this
     * browser's own `set_clan_tree` succeeds, and reset on every profile switch.
     *
     * Content is the WHOLE test, deliberately. An earlier version also required
     * `clan_tree.updated_by === userId`, on the reasoning that content alone would silence a second
     * leader who published a byte-identical tree. It would — and that silence costs nothing, because
     * a row identical to what this browser published is a row this browser's user already has (or
     * has since typed past, which is their own newer work). Requiring `updated_by` had a real cost
     * in the other direction: measured, a row whose attribution was missing failed the test and ate
     * the level the publishing leader had typed next. The same account's OTHER browser is not
     * silenced by content either — it never published, so its `publishedRowSig` is `null` and no
     * signature can match it.
     */
    const publishedRowSig = useRef<string | null>(null);
    /** True while an automatic pull is in flight, so one Realtime burst cannot start two. */
    const autoPullBusy = useRef(false);
    /** Bumped by the quiet-window timer to re-evaluate the auto-pull without any other input. */
    const [autoPullTick, setAutoPullTick] = useState(0);

    /* -------------------------------------------------------------------------------------- *
     * Loading
     * -------------------------------------------------------------------------------------- */

    const loadAll = useCallback(async () => {
        if (!canTalk || !profileId) {
            // Bump the generation even here: a load may be in flight for the profile we just left,
            // and its response must not repopulate the screen with the previous clan.
            generation.current++;
            setLoaded(EMPTY_LOADED);
            setPasswordValue(null);
            setError(null);
            setLoading(false);
            return;
        }

        const mine = ++generation.current;
        setLoading(true);
        setError(null);

        const membershipResult = await getMembership(profileId);
        if (mine !== generation.current) return;

        if (!membershipResult.ok) {
            setLoaded(EMPTY_LOADED);
            setError(membershipResult.error);
            setLoading(false);
            return;
        }

        const membership = membershipResult.data;
        if (!membership) {
            // No clan: the resting state for most profiles, and not an error.
            setLoaded(EMPTY_LOADED);
            setPasswordValue(null);
            setLoading(false);
            return;
        }

        // One round of parallel reads. The roster comes from clan_roster_detail rather than
        // clan_roster because the war planner needs the shares and a second fetch of the same 50
        // rows would cost more than the extra columns do.
        const [clanResult, rosterResult, treeResult, infoResult] = await Promise.all([
            getClan(membership.clan_id),
            getRosterDetail(membership.clan_id),
            getClanTree(membership.clan_id),
            getClanTreeInfo(membership.clan_id),
        ]);
        if (mine !== generation.current) return;

        // Requests only exist for a `request` clan and are only visible to leaders, so this is
        // asked for separately and its failure is not the screen's failure.
        let requests: ClanRequestRow[] = [];
        if (membership.role === 'owner' || membership.role === 'admin') {
            const requestResult = await listClanRequests(membership.clan_id);
            if (mine !== generation.current) return;
            if (requestResult.ok) requests = requestResult.data;
        }

        setLoaded({
            // Stamped with the profile this whole snapshot belongs to, so `view` above can discard
            // it the instant the active profile changes.
            forProfileId: profileId,
            membership,
            clan: clanResult.ok ? clanResult.data : null,
            roster: rosterResult.ok ? rosterResult.data : [],
            requests,
            tree: treeResult.ok ? treeResult.data : null,
            treeInfo: infoResult.ok ? infoResult.data : null,
        });
        // A failed sub-read is reported but does not blank the screen: a roster without a tree is
        // still a usable roster.
        const firstFailure = [clanResult, rosterResult, treeResult, infoResult].find(r => !r.ok);
        setError(firstFailure && !firstFailure.ok ? firstFailure.error : null);
        setLoading(false);
    }, [canTalk, profileId]);

    // Reload on: sign-in/out, profile switch, backend appearing. NOT on every `profile` change —
    // that object is a new identity on every keystroke in the app.
    useEffect(() => {
        void loadAll();
        // A profile switch must also forget the previous clan's password and share bookkeeping.
        setPasswordValue(null);
        setShareState(EMPTY_SHARE_STATE);
        // including the "already published this content" fingerprint. It is keyed on CONTENT, not on
        // the profile, so carrying it across a switch makes the new profile's first publish a no-op
        // whenever the two profiles' summaries hash the same — which is exactly what a cloned profile
        // produces. Its clan mates would then see nothing until something about it changed.
        lastPublished.current = null;
        // The auto-pull's memory is per profile too. "I published this row" and "the user was just
        // editing" are statements about the profile that was on screen; carried across a switch they
        // would suppress the first pull the NEW profile is owed, which is the one that matters most.
        publishedRowSig.current = null;
        writtenClanTree.current = null;
        lastLocalEditAt.current = 0;
        setAutoPull(null);
        // The war board is already self-invalidating (`warLoaded` is stamped with its clan and
        // week), but the ERROR is not: a "you are not in that clan" left over from the previous
        // profile would keep the planner in `status: 'error'` until the next load landed, i.e. it
        // would show a failure about a clan the user has already left. `warOpened` is deliberately
        // NOT reset — a planner tab that is still mounted is still owed the new profile's board.
        warGeneration.current += 1;
        setWarError(null);
    }, [loadAll]);

    /* -------------------------------------------------------------------------------------- *
     * Realtime — clan_members and clan_tree only
     * -------------------------------------------------------------------------------------- */

    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!canTalk || !clanId) {
            setLive(false);
            return;
        }

        let disposed = false;
        const schedule = () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
                if (!disposed) void loadAll();
            }, REFETCH_DEBOUNCE_MS);
        };

        const unsubscribe = subscribeToClan(clanId, {
            onMembersChange: schedule,
            onTreeChange: schedule,
            onStatus: status => {
                if (!disposed) setLive(status === 'SUBSCRIBED');
            },
        });

        return () => {
            disposed = true;
            setLive(false);
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = null;
            // The channel must go with the clan id, not with the component: switching profile is a
            // new subscription, and keeping the old one would leak a socket per switch.
            unsubscribe();
        };
    }, [canTalk, clanId, loadAll]);

    /* -------------------------------------------------------------------------------------- *
     * Permissions — the rules, once
     * -------------------------------------------------------------------------------------- */

    const isLeader = role === 'owner' || role === 'admin';
    const canEditTree = !isSharedProfile && isLeader;
    const canManageRoles = !isSharedProfile && role === 'owner';
    const canSeePassword = !isSharedProfile && isLeader;
    const canDeleteClan = !isSharedProfile && role === 'owner';
    const canLeave = !isSharedProfile && !!role;
    const canPullTree = !isSharedProfile && !!role && !!view.tree;

    /**
     * The password lives in memory only while the active profile is still a leader of the clan it was
     * read from. A demotion arrives over Realtime, and `ClanAdminPanel` unmounts its whole password
     * section the moment `canSeePassword` goes false — so the string is already out of the DOM — but
     * without this it would sit in this provider's state until the next profile switch, ready to be
     * handed back by `clan.password` to whatever renders next. The one secret in the system does not
     * get to outlive the permission that fetched it.
     */
    useEffect(() => {
        if (!canSeePassword) setPasswordValue(null);
    }, [canSeePassword]);

    const canKick = useCallback(
        (memberRole: ClanRole): boolean => {
            if (isSharedProfile) return false;
            // The owner removes anyone but themself (admins included); an admin removes members
            // only; the owner is never removable. Mirrors kick_member() exactly — the server is the
            // enforcement, this is what keeps a button from appearing that cannot work.
            if (role === 'owner') return memberRole !== 'owner';
            if (role === 'admin') return memberRole === 'member';
            return false;
        },
        [role, isSharedProfile],
    );

    const mustTransferBeforeLeaving = useMemo(() => {
        if (role !== 'owner') return false;
        // The sole member of a clan takes the clan with them, so there is nothing to transfer.
        if (view.roster.length <= 1) return false;
        return !view.roster.some(m => m.role === 'owner' && m.profile_id !== view.membership?.profile_id);
    }, [role, view.roster, view.membership?.profile_id]);

    /* -------------------------------------------------------------------------------------- *
     * Action plumbing
     * -------------------------------------------------------------------------------------- */

    /**
     * Wraps one write: refuses locally when there is nothing to write to (so a shared profile or a
     * signed-out user never sends a request), flips `busy`, and reloads on success so the roster,
     * the tree and the role are whatever the server now says.
     */
    const act = useCallback(
        async <T,>(
            run: () => Promise<ClanResult<T>>,
            options?: {
                needsClan?: boolean;
                reload?: boolean;
                /** For calls whose success does not always change the membership — see `join`. */
                shouldReload?: (data: T) => boolean;
            },
        ): Promise<ClanResult<T>> => {
            if (isSharedProfile) return refuse<T>(SHARED_PROFILE_ERROR);
            if (!backendConfigured) return refuse<T>(NO_BACKEND_ERROR);
            if (!signedIn || !profileId) return refuse<T>(SIGNED_OUT_ERROR);
            if (options?.needsClan && !clanId) {
                return refuse<T>({ kind: 'not-a-member', message: 'This profile is not in a clan.' });
            }

            setBusy(true);
            try {
                const result = await run();
                if (!result.ok) return result;
                const reload = options?.shouldReload
                    ? options.shouldReload(result.data)
                    : (options?.reload ?? true);
                if (reload) await loadAll();
                return result;
            } finally {
                setBusy(false);
            }
        },
        [isSharedProfile, backendConfigured, signedIn, profileId, clanId, loadAll],
    );

    /**
     * Carries a `profiles.version` we just caused into the sync ledger, monotonically.
     *
     * Any write to `profiles` bumps its version (`profiles_touch`), so publishing or clearing
     * `clan_share` moves the number the sync engine believes it is editing on top of. Without this,
     * its next body push matches zero rows and it raises the conflict UX for a row nobody touched.
     * Only ever raises the stored version: if a body push landed between our write and this call, it
     * already recorded something newer and must not be walked back.
     */
    const rememberVersion = useCallback(
        (version: number) => {
            if (!userId || !profileId || !Number.isFinite(version)) return;
            const entry = readLedger(userId).entries[profileId];
            if (entry && version > entry.version) {
                rememberEntry(userId, profileId, { ...entry, version, at: Date.now() });
            }
        },
        [userId, profileId],
    );

    /* -------------------------------------------------------------------------------------- *
     * Membership actions
     * -------------------------------------------------------------------------------------- */

    const create = useCallback(
        (params: { name: string; tag: string; joinPolicy?: ClanJoinPolicy }) =>
            act(() => createClan({ ...params, profileId: profileId! }), { reload: true }),
        [act, profileId],
    );

    /**
     * `failed` and `rate_limited` are SUCCESSFUL calls that did not get us in — the wrong-password
     * path is a result, not an exception (see `clanApi`). Reloading on those would be a wasted round
     * trip, so only a real `joined` / `requested` refreshes the state.
     */
    const join = useCallback(
        (params: { name: string; tag: string; password: string }) =>
            act(() => joinClan({ ...params, profileId: profileId! }), {
                shouldReload: outcome => outcome.status === 'joined' || outcome.status === 'requested',
            }),
        [act, profileId],
    );

    const leave = useCallback(
        () =>
            act(async () => {
                const result = await leaveClan(profileId!);
                if (result.ok) {
                    // Hygiene, not enforcement: leaving does not clear the share server-side (the
                    // row is its owner's data), and it already stops being visible to anyone the
                    // moment the membership goes, because clan_roster_detail joins through
                    // clan_members. Awaited so the version bump reaches the ledger.
                    const cleared = await clearClanShare(profileId!);
                    if (cleared.ok) rememberVersion(cleared.data.version);
                    lastPublished.current = null;
                    setShareState(EMPTY_SHARE_STATE);
                }
                return result;
            }, { needsClan: true }),
        [act, profileId, rememberVersion],
    );

    const kick = useCallback(
        (targetProfileId: string) => act(() => kickMember(clanId!, targetProfileId), { needsClan: true }),
        [act, clanId],
    );

    const promote = useCallback(
        (targetProfileId: string) => act(() => setMemberRole(clanId!, targetProfileId, 'admin'), { needsClan: true }),
        [act, clanId],
    );

    const demote = useCallback(
        (targetProfileId: string) => act(() => setMemberRole(clanId!, targetProfileId, 'member'), { needsClan: true }),
        [act, clanId],
    );

    const handOver = useCallback(
        (toProfileId: string) => act(() => transferOwnership(clanId!, toProfileId), { needsClan: true }),
        [act, clanId],
    );

    const remove = useCallback(
        () => act(() => deleteClanRow(clanId!), { needsClan: true }),
        [act, clanId],
    );

    const edit = useCallback(
        (patch: { name?: string; tag?: string; joinPolicy?: ClanJoinPolicy; memberCap?: number }) =>
            act(() => updateClan(clanId!, patch), { needsClan: true }),
        [act, clanId],
    );

    const setBadge = useCallback(
        (badge: ClanBadge) => act(() => setClanBadge(clanId!, badge), { needsClan: true }),
        [act, clanId],
    );

    const approve = useCallback(
        (targetProfileId: string) => act(() => approveClanRequest(clanId!, targetProfileId), { needsClan: true }),
        [act, clanId],
    );

    const deny = useCallback(
        (targetProfileId: string) => act(() => denyClanRequest(clanId!, targetProfileId), { needsClan: true }),
        [act, clanId],
    );

    /* -------------------------------------------------------------------------------------- *
     * The shared tree: leaders write it, every member pulls it
     * -------------------------------------------------------------------------------------- */

    /**
     * THE CLAN TREE'S LEVEL CAPS, keyed by the flattened `globalId` the whole app uses.
     *
     * A pull writes somebody else's numbers into THIS profile, and from that moment every
     * calculator in the app reads them as if the user had typed them. `set_clan_tree()` stores
     * whatever a leader sent under the config THEY had, so a level above the cap the selected
     * config gives that node is a legitimate row, not corruption — a cap can be lowered by a game
     * update, and an older client's row outlives it. Writing it through unclamped produced
     * `RANK 40/20` on the card and fed 40 to every consumer, which is why the clamp lives here and
     * not only in the page's own stepper.
     *
     * The flattening MUST match `pages/Clan.tsx` and `TechTree.tsx`: category order as the position
     * library lists it, nodes in order, one id each. Both files derive it the same way.
     *
     * Loaded only for a profile that is actually in a clan — an empty file name is `useGameData`'s
     * own "nothing to load", so a clanless or signed-out visitor pays no fetch.
     */
    // `loading` is kept as well as `data`: these two are also the source of the clan
    // `WarPointsFrom` multipliers the share applies, and publishing before they land would send
    // fifty people a set of unboosted numbers that look like real ones. See `configsLoading`.
    const { data: guildPositionLibrary, loading: guildPositionLoading } =
        useGameData<Record<string, { Nodes?: string[] } | null>>(clanId ? 'GuildTechTreePositionLibrary.json' : '');
    const { data: guildUpgradeLibrary, loading: guildUpgradeLoading } =
        useGameData<Record<string, { MaxLevel?: number } | null>>(clanId ? 'GuildTechTreeUpgradeLibrary.json' : '');

    const clanNodeCaps = useMemo(() => {
        const caps = new Map<number, number>();
        if (!guildPositionLibrary || !guildUpgradeLibrary) return caps;
        let globalId = 0;
        for (const category of Object.keys(guildPositionLibrary)) {
            for (const type of guildPositionLibrary[category]?.Nodes || []) {
                const max = guildUpgradeLibrary[type]?.MaxLevel;
                // The same fallback the page and MiscPanel use, so the two never disagree on a cap.
                caps.set(globalId, typeof max === 'number' && max > 0 ? Math.floor(max) : 20);
                globalId += 1;
            }
        }
        return caps;
    }, [guildPositionLibrary, guildUpgradeLibrary]);

    const saveTree = useCallback(
        (levels: Record<string, number>) =>
            act(async () => {
                const result = await setClanTree(clanId!, levels);
                // Remember WHAT we published, not just that we did. The row we are about to receive
                // back over Realtime is then recognisable as our own echo, and the auto-pull leaves
                // this leader's draft alone even if they keep typing after publishing. The row the
                // RPC returns is authoritative (zeros stripped server-side); `levels` is the
                // fallback for a server that answered oddly, which must not take the page down.
                if (result.ok) publishedRowSig.current = signLevels(result.data?.levels ?? levels);
                return result;
            }, { needsClan: true }),
        [act, clanId],
    );

    /**
     * Copies the clan's shared tree into `profile.techTree.Clan`. This is the member-facing
     * direction, and it needs no privilege: a read the RLS policy already allows plus a local
     * write. Nothing is sent back — the shared row is untouched.
     *
     * Resolves with the number of nodes written and how many of them had to be reduced to the
     * node's cap. The write stamps `techTreeUpdatedAt`, so the "stale tree" flag in the
     * profile UI resets as it would after a manual edit.
     *
     * EVERY level is clamped to `clanNodeCaps` on the way in. The shared row is written by a leader
     * under whatever config THEY had, and `set_clan_tree()` does not validate against a config at
     * all, so a level above the cap the selected config gives that node is a legitimate row rather
     * than corruption. Unclamped it produced `RANK 40/20` on the card and handed 40 to every
     * calculator downstream — the page's own stepper clamps, so only this path could introduce it.
     */
    const runPull = useCallback(async (auto: boolean): Promise<ClanResult<PullTreeResult>> => {
        if (isSharedProfile) return refuse<PullTreeResult>(SHARED_PROFILE_ERROR);
        if (!clanId) {
            return refuse<PullTreeResult>({ kind: 'not-a-member', message: 'This profile is not in a clan.' });
        }
        // No caps means the two tree configs have not arrived yet. Refusing costs the user a retry;
        // writing unvalidated levels into the profile is the bug this clamp exists to prevent, and
        // it would be silent. So we never write a level we cannot check.
        if (clanNodeCaps.size === 0) {
            return refuse<PullTreeResult>({
                kind: 'unknown',
                message: 'Still loading the clan tree configuration. Try again in a moment.',
            });
        }

        // `busy` disables every clan button on screen, which is right for a press and wrong for a
        // background pull: a Realtime event must not grey out the control somebody is aiming at.
        if (!auto) setBusy(true);
        // Which profile this pull is FOR. The profile write always lands on whichever profile is active
        // when it is called, so a switch during the round trip would write clan A's tree into
        // profile B. `generation` is bumped by `loadAll` on every profile/auth change, which makes
        // it the same guard every other async write in this provider uses.
        const mine = generation.current;
        try {
            // Re-read rather than trusting `tree` in state: the pull is the one moment where being
            // one Realtime event behind would write stale numbers into somebody's profile.
            const result = await getClanTree(clanId);
            if (!result.ok) return result;
            const row = result.data;
            if (!row) {
                return refuse<PullTreeResult>({ kind: 'not-found', message: 'This clan has no shared tree yet.' });
            }
            if (mine !== generation.current) {
                return refuse<PullTreeResult>({
                    kind: 'not-your-profile',
                    message: 'The active profile changed while the clan tree was loading. Nothing was written.',
                });
            }

            const { levels, clamped } = clampLevels(row.levels, clanNodeCaps);
            // EVERY DECISION BELOW IS AGAINST THE TREE AS IT IS NOW. The round trip above is the
            // whole reason this function can lose data: the checks the auto-pull effect made before
            // starting it describe a moment that has passed. See `liveClanTree`.
            const localNow = liveClanTree.current;
            const delta = countTreeDelta(localNow, levels);
            const data: PullTreeResult = { nodes: Object.keys(levels).length, clamped, ...delta };

            // Nothing moved: do not write. This is not an optimisation — `updateNestedProfile`
            // stamps `techTreeUpdatedAt` and marks the profile dirty, so writing an identical tree
            // would reset the "tree confirmed" clock and push a body for no reason. It is also the
            // exact point where the auto-pull's loop would close if it wrote unconditionally.
            if (delta.changed === 0) {
                setLoaded(prev => (prev.tree === row ? prev : { ...prev, tree: row }));
                return { ok: true, data };
            }

            if (auto) {
                // THE TWO GUARDS THE EFFECT ALREADY APPLIED, RE-APPLIED AGAINST NOW.
                //
                // Both were true when this pull started and can have stopped being true while it was
                // in flight, and both protect somebody's typing, so neither may be decided on stale
                // information. Nothing is written: `setLoaded(row)` hands the row back to the effect,
                // which re-arms the quiet-window timer and comes back when the tree is still. That
                // path costs no further read until the timer fires, so a leader who keeps typing
                // through a whole publish does not generate traffic per keystroke.
                if (
                    publishedRowSig.current !== null &&
                    signLevels(row.levels) === publishedRowSig.current
                ) {
                    setLoaded(prev => (prev.tree === row ? prev : { ...prev, tree: row }));
                    return refuse<PullTreeResult>({
                        kind: 'unknown',
                        message: 'That row is this browser\'s own publish. Nothing was written.',
                    });
                }
                const quietFor = Date.now() - lastLocalEditAt.current;
                if (lastLocalEditAt.current > 0 && quietFor < CLAN_TREE_EDIT_QUIET_MS) {
                    setLoaded(prev => (prev.tree === row ? prev : { ...prev, tree: row }));
                    return refuse<PullTreeResult>({
                        kind: 'unknown',
                        message: 'The clan tree is being edited here. Nothing was written.',
                    });
                }
            }

            // Recorded BEFORE the write, so the observer effect below sees the new signature arrive
            // and knows it was us — otherwise every pull would look like a user edit and start the
            // quiet window against the next one.
            writtenClanTree.current = signLevels(levels);
            // A full replacement of `Clan`, not a merge: the clan's tree IS the clan's tree, and a
            // leftover local level for a node the leaders have since zeroed would be a silent lie.
            //
            // `updateNestedProfile` and not `updateProfile({ techTree: { ...profile.techTree } })`:
            // the latter spreads the techTree captured when this callback was created, so a Forge,
            // Power or Skills level typed during the round trip was reverted — measured, Forge node
            // 0 typed to 1 and stored back as absent. This merges inside the state updater, so the
            // other three trees are whatever they are at the moment of the write, and only `Clan`
            // is replaced.
            updateNestedProfile('techTree', { Clan: levels });
            setLoaded(prev => ({ ...prev, tree: row }));
            // NEVER SILENT. The user's own numbers were just replaced by somebody else's, so an
            // automatic pull leaves a notice with the counts behind it until it is dismissed.
            if (auto) setAutoPull({ at: Date.now(), ...data });
            return { ok: true, data };
        } finally {
            if (!auto) setBusy(false);
        }
    }, [isSharedProfile, clanId, clanNodeCaps, updateNestedProfile]);

    const pullTree = useCallback(() => runPull(false), [runPull]);

    /* ---- the auto-pull ------------------------------------------------------------------- */

    /** `techTree.Clan` as it stands, canonicalised, so a change is a string compare. */
    const localTreeSig = useMemo(() => signLevels(profile.techTree?.Clan), [profile.techTree?.Clan]);

    /**
     * WHO LAST TOUCHED THE LOCAL CLAN TREE, AND WHEN.
     *
     * The only edit surfaces are `pages/Clan.tsx`'s 61 steppers and the Clan tab of
     * `components/Profile/TechTreePanel.tsx`, and both write through `updateProfile` like everything
     * else. Rather than have each of them announce itself (which would leave any future third
     * surface silently unprotected), this watches the value: a signature that changed to something
     * this provider did not write is, by elimination, a person typing.
     */
    useEffect(() => {
        const previous = seenClanTree.current;
        seenClanTree.current = { profileId, sig: localTreeSig };
        // A different profile's numbers appearing is a switch, not an edit.
        if (previous.profileId !== profileId) return;
        if (previous.sig === localTreeSig) return;
        if (localTreeSig === writtenClanTree.current) {
            // Our own pull landing. Consumed, so that a later edit which happens to arrive back at
            // this exact tree is still recognised as an edit.
            writtenClanTree.current = null;
            return;
        }
        lastLocalEditAt.current = Date.now();
    }, [localTreeSig, profileId]);

    const autoPullOn = clanSyncEnabled && canTalk && !!clanId && !isSharedProfile;

    /**
     * THE AUTO-PULL. Realtime-driven: `onTreeChange` above already refetches `clan_tree`, so this
     * effect only has to decide what to do about a row that changed. Nothing polls, and nothing
     * here runs on a timer except the quiet window.
     *
     * WHY IT CANNOT LOOP. The write is `clampLevels(row.levels)` and the test is
     * `signLevels(clampLevels(row.levels)) === signLevels(techTree.Clan)`, so the value written is
     * the value that makes the test pass: one write per distinct published row, then a fixed point.
     * The clamp has to be on BOTH sides or the fixed point does not exist — a shared 40 on a /20
     * node stores 20, and comparing 20 against the raw 40 would differ for ever.
     *
     * The three things the write sets in motion all terminate:
     *   - `techTreeUpdatedAt` + a dirty profile -> `useProfileSync` pushes a body. `profiles` is not
     *     in the Realtime publication (0005 §7), so nothing comes back.
     *   - the share draft changes -> the debounced publisher writes `clan_share`. Same table, same
     *     reason: no event, and it does not touch `clan_tree`.
     *   - `setLoaded({ tree: row })` re-runs this effect with the row it already handled, which the
     *     signature test rejects.
     *
     * WHICH CASE THIS IS OPTIMISED FOR: the plain member, who cannot edit this tree at all and for
     * whom every pull is pure gain. The leader is protected by the quiet window and by the echo
     * test, and that protection is deliberately IN-SESSION only: a leader who types a draft, does
     * not publish it, and reloads the page will find the clan's row in its place, because after a
     * reload there is no way to tell an abandoned draft from a stale copy — and of the two possible
     * mistakes, showing a leader the tree their clan actually published is the recoverable one. The
     * notice says what changed, and their draft is one "Publish to clan" away from being the row.
     */
    useEffect(() => {
        if (!autoPullOn) return;
        const row = view.tree;
        // No shared row, or the two tree configs have not landed: nothing to pull, and a pull
        // without caps is the unvalidated write `clampLevels` exists to prevent.
        if (!row || clanNodeCaps.size === 0) return;

        // Our own publish coming back. See `publishedRowSig` for why content is the whole test.
        const rowSig = signLevels(row.levels);
        if (publishedRowSig.current !== null && rowSig === publishedRowSig.current) return;

        const target = clampLevels(row.levels, clanNodeCaps).levels;
        if (signLevels(target) === localTreeSig) return; // already in step: the fixed point

        // Somebody is typing in this tree right now (only a leader can be — see
        // CLAN_TREE_EDIT_QUIET_MS). Come back when they stop, rather than deleting what they typed.
        const quietFor = Date.now() - lastLocalEditAt.current;
        if (lastLocalEditAt.current > 0 && quietFor < CLAN_TREE_EDIT_QUIET_MS) {
            const timer = setTimeout(
                () => setAutoPullTick(t => t + 1),
                CLAN_TREE_EDIT_QUIET_MS - quietFor + 50,
            );
            return () => clearTimeout(timer);
        }

        if (autoPullBusy.current) return;
        autoPullBusy.current = true;
        void runPull(true).finally(() => { autoPullBusy.current = false; });
    }, [autoPullOn, view.tree, clanNodeCaps, localTreeSig, autoPullTick, runPull]);

    /* -------------------------------------------------------------------------------------- *
     * The join password — leaders only, and "no rows" is not an error
     * -------------------------------------------------------------------------------------- */

    const revealPassword = useCallback(async (): Promise<ClanResult<string | null>> => {
        if (!canSeePassword || !clanId) {
            // Not a leader: the row is filtered out by RLS anyway. Say so without a round trip.
            return { ok: true, data: null };
        }
        setPasswordLoading(true);
        try {
            const result = await getJoinPassword(clanId);
            if (!result.ok) return result;
            const value = result.data?.join_password ?? null;
            setPasswordValue(value);
            return { ok: true, data: value };
        } finally {
            setPasswordLoading(false);
        }
    }, [canSeePassword, clanId]);

    const setPassword = useCallback(
        (value: string) =>
            act(async () => {
                const result = await setJoinPassword(clanId!, value);
                if (result.ok) setPasswordValue(value.trim());
                return result;
            }, { needsClan: true, reload: false }),
        [act, clanId],
    );

    const regeneratePassword = useCallback(
        () =>
            act(async () => {
                const result = await generateJoinPassword(clanId!);
                if (result.ok) setPasswordValue(result.data);
                return result;
            }, { needsClan: true, reload: false }),
        [act, clanId],
    );

    /* -------------------------------------------------------------------------------------- *
     * Discovery — recent_clans(10) + a debounced search_clans(query). Never "all clans".
     * -------------------------------------------------------------------------------------- */

    const refreshRecent = useCallback(() => {
        if (!backendConfigured || !signedIn) return;
        setRecentLoading(true);
        void recentClans(10).then(result => {
            setRecentLoading(false);
            if (result.ok) {
                setRecent(result.data);
                setDiscoveryError(null);
            } else {
                setDiscoveryError(result.error);
            }
        });
    }, [backendConfigured, signedIn]);

    useEffect(() => {
        const needle = query.trim();
        if (!needle) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const timer = setTimeout(() => {
            void searchClans(needle, 10).then(result => {
                setSearching(false);
                if (result.ok) {
                    setResults(result.data);
                    setDiscoveryError(null);
                } else {
                    setResults([]);
                    setDiscoveryError(result.error);
                }
            });
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    /* -------------------------------------------------------------------------------------- *
     * clan_share — computed here, published debounced
     * -------------------------------------------------------------------------------------- */

    /**
     * THE THIRTEEN CONFIGS THE ENGINE READS, and why they are all requested here.
     *
     * `computeWarPoints` needs the war day config for every point value and day assignment, the
     * three tech-tree libraries plus ForgeConfig for the real optimiser, the age drop table and the
     * forge upgrade costs for the forge and forge-spend halves, the three summon configs for
     * tickets/winders/eggshells, and the two guild libraries for the clan `WarPointsFrom`
     * multipliers. A missing one is not a crash — it downgrades the categories that needed it to
     * `unavailable` with a reason — but publishing a document full of `unavailable` because a fetch
     * had not landed yet would tell fifty people the wrong thing, so the draft waits for all of
     * them (`configsLoading` below).
     *
     * A profile that is in no clan needs none of them. An empty file name is `useGameData`'s own
     * "nothing to load", so an unconfigured, signed-out or clanless visitor pays no fetch at all —
     * and `GuildTechTreePositionLibrary` / `GuildTechTreeUpgradeLibrary` are the very same two
     * requests `clanNodeCaps` already makes, deduplicated by `useGameData`'s cache.
     *
     * TWO GATES, NOT ONE, and the difference is `clanSyncEnabled`. The DRAFT is only built for a
     * member who has clan sync on (`wantsShare`) — publishing is opt-in. But `memberBreakdown()`
     * re-runs the same engine over other people's shares, and a member who turned their own sharing
     * OFF still opens the roster and still deserves to see why a clan mate's forge figure is a
     * floor. So the FETCH is gated on being in a clan at all (`wantsWarConfigs`), which is exactly
     * when a roster exists to read. Nothing about the publisher changes: `built` below still waits
     * on `wantsShare`.
     */
    const wantsWarConfigs = canTalk && !!clanId;
    const wantsShare = wantsWarConfigs && clanSyncEnabled;
    const file = (name: string) => (wantsWarConfigs ? name : '');
    const dayConfigQuery = useGameData<unknown>(file('GuildWarDayConfigLibrary.json'));
    const warConfigQuery = useGameData<unknown>(file('GuildWarConfig.json'));
    const techMappingQuery = useGameData<unknown>(file('TechTreeMapping.json'));
    const techLibraryQuery = useGameData<unknown>(file('TechTreeLibrary.json'));
    const techUpgradeQuery = useGameData<unknown>(file('TechTreeUpgradeLibrary.json'));
    const forgeConfigQuery = useGameData<unknown>(file('ForgeConfig.json'));
    const ageDropQuery = useGameData<unknown>(file('ItemAgeDropChancesLibrary.json'));
    const forgeUpgradeQuery = useGameData<unknown>(file('ForgeUpgradeLibrary.json'));
    const skillSummonQuery = useGameData<unknown>(file('SkillSummonConfig.json'));
    const mountSummonQuery = useGameData<unknown>(file('MountSummonConfig.json'));
    const eggSummonQuery = useGameData<unknown>(file('EggSummonConfig.json'));
    const eggLibraryQuery = useGameData<unknown>(file('EggLibrary.json'));

    const dayConfig = dayConfigQuery.data;

    /**
     * True while ANY of them is in flight. `useGameData` reports `loading` for an empty file name
     * too (it never fetches), which is why `wantsShare` gates this rather than being folded in.
     */
    const configsLoading =
        dayConfigQuery.loading || warConfigQuery.loading || techMappingQuery.loading ||
        techLibraryQuery.loading || techUpgradeQuery.loading || forgeConfigQuery.loading ||
        ageDropQuery.loading || forgeUpgradeQuery.loading || skillSummonQuery.loading ||
        mountSummonQuery.loading || eggSummonQuery.loading || eggLibraryQuery.loading ||
        guildPositionLoading || guildUpgradeLoading;

    /**
     * The profile the war maths is run against: `profile`, trailing by `WAR_COMPUTE_DEBOUNCE_MS`
     * while it is being edited, and the live object the instant a different profile becomes active.
     */
    const [computeSnapshot, setComputeSnapshot] = useState<UserProfile>(profile);
    const computeProfile = computeSnapshot.id === profile.id ? computeSnapshot : profile;

    useEffect(() => {
        if (computeSnapshot === profile) return;
        if (computeSnapshot.id !== profile.id) {
            // Another profile is on screen. Catch up now, not in a second.
            setComputeSnapshot(profile);
            return;
        }
        const timer = setTimeout(() => setComputeSnapshot(profile), WAR_COMPUTE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [profile, computeSnapshot]);

    /**
     * The thirteen configs as one object, hoisted so the local draft and every clan mate's
     * breakdown run against the SAME game data. Two assemblies would be two versions of the truth
     * the moment one of them forgot a field.
     *
     * `null` until they have all landed, which is what makes `memberBreakdown()` refuse rather than
     * itemise a member against half a config set.
     *
     * The queries are listed by their `.data` so that a re-render with identical configs keeps the
     * object identity — `useGameData` returns its cached object, and the identity is what stops the
     * draft being rebuilt and the breakdown cache being thrown away on every render.
     */
    const warConfigs = useMemo<WarPointsConfigs | null>(() => {
        if (!wantsWarConfigs || configsLoading || !dayConfig) return null;
        return {
            dayConfig,
            warConfig: warConfigQuery.data,
            guildPositionLibrary,
            guildUpgradeLibrary,
            techTreeMapping: techMappingQuery.data,
            techTreeLibrary: techLibraryQuery.data,
            techTreeUpgradeLibrary: techUpgradeQuery.data,
            forgeConfig: forgeConfigQuery.data,
            itemAgeDropChances: ageDropQuery.data,
            forgeUpgradeLibrary: forgeUpgradeQuery.data,
            skillSummonConfig: skillSummonQuery.data,
            mountSummonConfig: mountSummonQuery.data,
            eggSummonConfig: eggSummonQuery.data,
            eggLibrary: eggLibraryQuery.data,
        };
    }, [
        wantsWarConfigs, configsLoading, dayConfig, warConfigQuery.data,
        guildPositionLibrary, guildUpgradeLibrary,
        techMappingQuery.data, techLibraryQuery.data, techUpgradeQuery.data, forgeConfigQuery.data,
        ageDropQuery.data, forgeUpgradeQuery.data, skillSummonQuery.data, mountSummonQuery.data,
        eggSummonQuery.data, eggLibraryQuery.data,
    ]);

    const built = useMemo(() => {
        // `wantsShare`, not `wantsWarConfigs`: the configs are fetched for anybody in a clan so the
        // roster can itemise, but a draft is only built for a member who has sharing switched on.
        if (!wantsShare || !warConfigs) return null;
        return buildShare(computeProfile, selectedVersion || '', warConfigs);
    }, [wantsShare, warConfigs, computeProfile, selectedVersion]);

    const shareDraft = built?.draft ?? null;
    const warPoints = built?.computed ?? null;

    /**
     * One engine pass per member+document, remembered.
     *
     * Keyed on the profile id, the document's own `at` and its config version — the three things
     * that change when the numbers change. A member who republishes gets a new `at` and so a new
     * entry; a reader who opens, closes and reopens the same row pays once. The map is cleared
     * whenever the configs change identity, because every cached result was computed against the
     * old ones.
     *
     * A plain `useRef` map and not a `useMemo`: the call is made from a render (the card itemises
     * while it is open), so the cache has to survive renders without being a dependency of one.
     */
    const breakdownCache = useRef(new Map<string, MemberBreakdown | null>());
    useEffect(() => { breakdownCache.current.clear(); }, [warConfigs]);

    const memberBreakdown = useCallback((
        memberProfileId: string,
        share: ClanShare | null,
        published: Record<WarCategory, PublishedCategory>,
    ): MemberBreakdown | null => {
        if (!warConfigs || !share) return null;
        const key = `${memberProfileId}|${Number(share.at) || 0}|${share.cfg || ''}|${share.v}`;
        const cached = breakdownCache.current.get(key);
        if (cached !== undefined) return cached;
        const value = buildMemberBreakdown(share, published, warConfigs);
        // 50 members x a few documents each is a bounded map, but a long-lived tab watching a busy
        // clan republish is not, so the oldest entries go rather than growing without a ceiling.
        if (breakdownCache.current.size >= 200) {
            const oldest = breakdownCache.current.keys().next();
            if (!oldest.done) breakdownCache.current.delete(oldest.value);
        }
        breakdownCache.current.set(key, value);
        return value;
    }, [warConfigs]);

    /** Publishes the current draft. The debounce and the manual button share this one code path. */
    const doPublish = useCallback(async (): Promise<ClanResult<null>> => {
        if (isSharedProfile) return refuse<null>(SHARED_PROFILE_ERROR);
        if (!canTalk || !profileId) return refuse<null>(SIGNED_OUT_ERROR);
        if (!clanId) return refuse<null>({ kind: 'not-a-member', message: 'This profile is not in a clan.' });
        if (!shareDraft) {
            return refuse<null>({
                kind: 'unknown',
                message: 'The war data is still loading. Try again in a moment.',
            });
        }

        const payload: ClanShare = { ...shareDraft, at: Date.now() };
        const bytes = clanShareByteSize(payload);
        if (bytes > CLAN_SHARE_MAX_BYTES) {
            const error: ClanError = {
                kind: 'too-large',
                message: 'Your clan summary is too big to publish (the limit is 16 KB). Nothing was sent.',
                raw: `clan_share would be ${bytes} bytes`,
            };
            setShareState({ status: 'error', publishedAt: null, bytes, error, preview: payload });
            return { ok: false, error };
        }

        setShareState(prev => ({ ...prev, status: 'publishing', bytes, preview: payload, error: null }));
        const result = await publishClanShare(profileId, payload);
        if (!result.ok) {
            setShareState({
                status: 'error',
                publishedAt: null,
                bytes,
                error: result.error,
                preview: payload,
            });
            return result;
        }

        lastPublished.current = fingerprint(shareDraft);
        setShareState({
            status: 'published',
            publishedAt: payload.at,
            bytes,
            error: null,
            preview: payload,
        });

        // This write bumped `profiles.version`; tell the sync engine before its next push does.
        rememberVersion(result.data.version);
        return { ok: true, data: null };
    }, [isSharedProfile, canTalk, profileId, clanId, shareDraft, rememberVersion]);

    // The debounced publisher. It fires only when the CONTENT changed, so a profile that is merely
    // re-rendering (or a war config that reloaded to the same numbers) costs nothing.
    useEffect(() => {
        if (!wantsShare || !shareDraft) return;
        const hash = fingerprint(shareDraft);
        if (hash === lastPublished.current) return;

        setShareState(prev => ({ ...prev, status: 'pending' }));
        const timer = setTimeout(() => { void doPublish(); }, SHARE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [wantsShare, shareDraft, doPublish]);

    /**
     * The one place `clan_share` is cleared, and at most once per profile while the setting is off.
     *
     * Two callers race for it — the OFF click, and the convergence effect below — so the key is
     * claimed BEFORE the round trip and released again if it fails. Whoever loses the race gets a
     * successful no-op instead of a second identical write, and a clear that genuinely failed is
     * still owed and will be retried.
     */
    const clearedFor = useRef<string | null>(null);
    const clearShareNow = useCallback(async (): Promise<ClanResult<null>> => {
        if (isSharedProfile) return refuse<null>(SHARED_PROFILE_ERROR);
        if (!canTalk || !profileId) return refuse<null>(SIGNED_OUT_ERROR);
        const key = `${profileId}:${clanId ?? 'none'}`;
        if (clearedFor.current === key) return { ok: true, data: null };
        clearedFor.current = key;
        const result = await clearClanShare(profileId);
        if (!result.ok) {
            clearedFor.current = null;
            return result;
        }
        rememberVersion(result.data.version);
        return { ok: true, data: null };
    }, [isSharedProfile, canTalk, profileId, clanId, rememberVersion]);

    const stopSharing = useCallback(async (): Promise<ClanResult<null>> => {
        // THE PREFERENCE IS WRITTEN FIRST, AND WITHOUT CONDITIONS.
        //
        // Everything below can legitimately fail to happen — there may be no session, no clan, or
        // no network — but the user has still said "stop". Refusing before recording that was the
        // bug in this function's first version: turning the setting off while signed out returned
        // `not-signed-in` and left it on, so the next sign-in resumed publishing.
        setClanSyncEnabled(false);
        lastPublished.current = null;
        setShareState({ ...EMPTY_SHARE_STATE, status: 'off' });
        // Clearing the row is the point: a summary left behind would keep being read, and would keep
        // looking like this member's current standing while going quietly stale.
        const result = await clearShareNow();
        if (!result.ok) {
            // THE ROW IS STILL THERE, AND THE UI HAS TO BE ABLE TO SAY SO. Measured: clicking the
            // switch off while a `#p=` share link was on screen turned the preference off, cleared
            // nothing, and printed "your clan mates see it as nothing shared" — which was false, and
            // silently so. `status: 'error'` while off is how `ClanSyncPanel` knows not to make that
            // claim yet. The effect below then makes it true as soon as it can.
            setShareState({ ...EMPTY_SHARE_STATE, status: 'error', error: result.error });
            return result;
        }
        return { ok: true, data: null };
    }, [clearShareNow, setClanSyncEnabled]);

    /**
     * OFF CONVERGES ON "THE SERVER HOLDS NOTHING" INSTEAD OF PROMISING IT.
     *
     * The switch can be pressed at a moment when the row cannot be reached: over a shared profile
     * (there is no own-profile id on screen) or while signed out. The preference is still recorded —
     * the user said stop — but the summary the clan can read is untouched, so the OFF copy's
     * statement about what clan mates see would be a lie until something fixed it. This is what
     * fixes it: the moment a session and a clan exist for a profile whose preference is off, the row
     * is cleared, once.
     *
     * AND ONLY IF THERE IS SOMETHING THERE. `loadAll` has already fetched `clan_roster_detail`,
     * which carries this profile's own `clan_share`, so "is a clear owed?" is answered from data
     * already in hand rather than by writing `null` over `null` on every page load. `clearShareNow`
     * keeps it to one write even so.
     */
    const myShareOnServer = view.roster.find(row => row.is_mine)?.clan_share ?? null;
    useEffect(() => {
        if (clanSyncEnabled) {
            // Back on: whatever was cleared is about to be republished anyway.
            clearedFor.current = null;
            return;
        }
        if (!canTalk || !profileId || !clanId) return;
        if (!myShareOnServer) return;
        void clearShareNow().then(result => {
            // A convergence clear that fails leaves the row readable, and the panel's OFF copy is
            // only allowed to say what clan mates see when it can vouch for it. Same signal
            // `stopSharing` uses, so one condition covers both routes to the same state.
            if (!result.ok) setShareState({ ...EMPTY_SHARE_STATE, status: 'error', error: result.error });
        });
    }, [clanSyncEnabled, canTalk, profileId, clanId, myShareOnServer, clearShareNow]);

    /* -------------------------------------------------------------------------------------- *
     * The attacks planner (0009 §6-§9)
     *
     * THE THREE THINGS THIS SECTION IS CAREFUL ABOUT, stated once here rather than repeated:
     *
     *  1. IT COSTS NOTHING UNTIL IT IS OPENED. This provider is mounted app-wide. `warOpened` is
     *     false until a surface calls `openWarPlan()`, and every effect below returns early on it.
     *  2. THE BOARD IS STAMPED WITH THE CLAN AND WEEK IT DESCRIBES. `warView` is the snapshot only
     *     while it still belongs to the clan and week on screen, and `null` the instant it does not
     *     — so no plan id, participant id or permission derived from it can outlive its subject.
     *  3. NO WEBSOCKET. The war tables are not in the Realtime publication (0009 declined to add
     *     them, and nothing since has), so a subscription would deliver silence at the cost of one
     *     of the free plan's 200 concurrent connections — on top of the one `subscribeToClan()`
     *     already holds for every signed-in member. Freshness is: every successful write reloads
     *     the board, `refreshWar()` reloads it on demand, and a window focus reloads it at most
     *     once every WAR_FOCUS_REFRESH_MS while the planner is open.
     * -------------------------------------------------------------------------------------- */

    /**
     * The board, only while it still describes the clan and week on screen. See `warLoaded`.
     */
    const warView =
        warLoaded.forClanId === clanId && warLoaded.forWeek === warWeekStart ? warLoaded : null;
    const warBoard = warView?.board ?? null;
    const warPlanId = warBoard?.plan.id ?? null;

    /** Everything the planner needs a live connection and a real profile for. */
    const warReachable = !isSharedProfile && canTalk && !!clanId;
    /** Owner or admin of THIS clan. The server refuses a member with 42501; this hides the buttons. */
    const warCanEdit = warReachable && isLeader;

    /**
     * The battle day, DERIVED. 0009 is emphatic that nothing about the war calendar may be
     * hard-coded: `battle_day` defaults to 5 in the column, but between config versions `DayPoints`
     * flattened, day 5 went 2 to 4, and four of the eight task categories changed day outright. So
     * the default a leader is offered comes from "the day whose Tasks array is empty", and is
     * `null` until that config has landed rather than falling back to a literal.
     *
     * `dayConfig` is already fetched above for anybody in a clan (the war-points engine needs it),
     * so this costs no extra request.
     */
    const warBattleDay = useMemo(() => battleDayFromDayConfig(dayConfig), [dayConfig]);

    const loadWarBoardNow = useCallback(async (): Promise<void> => {
        if (!warReachable || !clanId) {
            // Not an error state: a signed-out visitor, a shared profile and a clanless profile all
            // land here, and the planner simply has nothing to be about.
            warGeneration.current += 1;
            setWarLoaded({ forClanId: null, forWeek: '', board: null });
            setWarError(null);
            setWarLoading(false);
            return;
        }

        const mine = ++warGeneration.current;
        const forClanId = clanId;
        const forWeek = warWeekStart;
        setWarLoading(true);
        setWarError(null);

        const result = await loadWarBoard(forClanId, forWeek);
        if (mine !== warGeneration.current) return;

        if (!result.ok) {
            setWarLoaded({ forClanId: null, forWeek: '', board: null });
            setWarError(result.error);
            setWarLoading(false);
            return;
        }
        // `null` is the NORMAL answer twice over: a leader has not started this week, or a member is
        // looking at a week whose plan is still a draft and therefore invisible to them. Both are
        // `status: 'none'`, never `'error'`.
        setWarLoaded({ forClanId, forWeek, board: result.data });
        setWarError(null);
        setWarLoading(false);
    }, [warReachable, clanId, warWeekStart]);

    const openWarPlan = useCallback(() => {
        setWarOpened(true);
    }, []);

    const refreshWar = useCallback(() => loadWarBoardNow(), [loadWarBoardNow]);

    /**
     * The only place the board is fetched automatically, and it is gated on `warOpened`.
     *
     * `loadWarBoardNow` changes identity when the clan or the week changes, which is exactly when a
     * reload is owed, so the dependency list is the whole trigger. Switching profile changes
     * `clanId` and therefore lands here too.
     */
    useEffect(() => {
        if (!warOpened) return;
        void loadWarBoardNow();
    }, [warOpened, loadWarBoardNow]);

    /**
     * Focus refresh, the stand-in for the Realtime this feature does not have.
     *
     * Two leaders editing the same board see each other's work when they come back to the tab, at
     * the cost of at most one request per WAR_FOCUS_REFRESH_MS. Only while the planner is open, and
     * only while a write is not already in flight — reloading under a save would apply an older
     * board on top of a newer one.
     */
    useEffect(() => {
        if (!warOpened || !warReachable) return;
        if (typeof window === 'undefined') return;

        const onFocus = () => {
            const now = Date.now();
            if (now - warLastFocusReload.current < WAR_FOCUS_REFRESH_MS) return;
            warLastFocusReload.current = now;
            void loadWarBoardNow();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [warOpened, warReachable, loadWarBoardNow]);

    /**
     * Wraps one war write. The four refusals happen BEFORE any request is built, so a shared
     * profile, a signed-out user, a clanless profile and a plain member never send something the
     * server would have to refuse — and, in the shared-profile case, never send something that
     * would succeed against the wrong profile's clan.
     *
     * `reload` defaults to true because every write changes the board and the board is one cheap
     * request; the exceptions are the reads (`loadSheet`, `exportText`), which pass `false`.
     */
    const warWrite = useCallback(
        async <T,>(
            run: () => Promise<WarPlanResult<T>>,
            options?: { reload?: boolean },
        ): Promise<WarPlanResult<T>> => {
            if (isSharedProfile) return refuseWar<T>(WAR_SHARED_PROFILE_ERROR);
            if (!backendConfigured) return refuseWar<T>(WAR_NO_BACKEND_ERROR);
            if (!signedIn || !profileId) return refuseWar<T>(WAR_SIGNED_OUT_ERROR);
            if (!clanId) return refuseWar<T>(WAR_NO_CLAN_ERROR);
            if (!isLeader) return refuseWar<T>(WAR_NOT_A_LEADER_ERROR);

            setWarBusy(true);
            try {
                const result = await run();
                if (result.ok && (options?.reload ?? true)) await loadWarBoardNow();
                return result;
            } finally {
                setWarBusy(false);
            }
        },
        [isSharedProfile, backendConfigured, signedIn, profileId, clanId, isLeader, loadWarBoardNow],
    );

    /** The same wrapper for the calls that need a plan id, which does not exist until one is made. */
    const warWriteOnPlan = useCallback(
        <T,>(
            run: (planId: string) => Promise<WarPlanResult<T>>,
            options?: { reload?: boolean },
        ): Promise<WarPlanResult<T>> =>
            warWrite<T>(() => {
                if (!warPlanId) return refuseWar<T>(WAR_NO_PLAN_ERROR);
                return run(warPlanId);
            }, options),
        [warWrite, warPlanId],
    );

    const setWeekStart = useCallback((iso: string) => {
        // Snapped to the Tuesday that owns whatever day was picked, so a date input handing back a
        // Thursday asks for the right week instead of being refused by the column CHECK.
        setWarWeekStartValue(currentWarWeekStart(new Date(`${iso}T12:00:00Z`)));
    }, []);

    const stepWeek = useCallback((weeks: number) => {
        setWarWeekStartValue(prev => shiftWarWeek(prev, weeks));
    }, []);

    const warSavePlan = useCallback(
        (patch: WarPlanPatch, options?: { expectedRevision?: number }) =>
            warWrite(() => saveWarPlan(clanId!, { ...patch, weekStart: patch.weekStart ?? warWeekStart }, options)),
        [warWrite, clanId, warWeekStart],
    );

    /**
     * Start this week's plan. The battle day is sent EXPLICITLY, from the config, rather than left
     * to the column default of 5 — the default happens to be right today and is not a fact.
     */
    const warCreatePlan = useCallback(
        () =>
            warWrite(() =>
                saveWarPlan(clanId!, {
                    weekStart: warWeekStart,
                    ...(warBattleDay !== null ? { battleDay: warBattleDay } : {}),
                }),
            ),
        [warWrite, clanId, warWeekStart, warBattleDay],
    );

    const warAddAlly = useCallback(
        (params: { profileId?: string; displayName?: string; powerEstimate?: number }) =>
            warWriteOnPlan(planId => addWarParticipant(planId, { side: 'ally', ...params })),
        [warWriteOnPlan],
    );

    const warAddEnemy = useCallback(
        (displayName: string, powerEstimate?: number) =>
            warWriteOnPlan(planId =>
                addWarParticipant(planId, { side: 'enemy', displayName, powerEstimate }),
            ),
        [warWriteOnPlan],
    );

    const warAddEnemies = useCallback(
        (count: number, options?: { prefix?: string }) =>
            warWriteOnPlan(planId => createEnemyDummies(planId, count, options)),
        [warWriteOnPlan],
    );

    const warRename = useCallback(
        (participantId: string, side: WarSide, displayName: string) =>
            warWriteOnPlan(planId => renameWarParticipant(planId, participantId, side, displayName)),
        [warWriteOnPlan],
    );

    const warUpdateParticipant = useCallback(
        (participantId: string, side: WarSide, patch: WarParticipantPatch) =>
            warWriteOnPlan(planId => updateWarParticipant(planId, participantId, side, patch)),
        [warWriteOnPlan],
    );

    const warRemoveParticipant = useCallback(
        (participantId: string) => warWrite(() => removeWarParticipant(participantId)),
        [warWrite],
    );

    const warSetOrders = useCallback(
        (attackerId: string, orders: WarOrder[], options?: { expectedAssignmentIds?: string[] }) =>
            warWrite(() => setAttackerOrders(attackerId, orders, options)),
        [warWrite],
    );

    const warClearOrders = useCallback(
        () => warWriteOnPlan(planId => clearWarAssignments(planId)),
        [warWriteOnPlan],
    );

    const warPublish = useCallback(
        (options?: { notify?: boolean }) => warWriteOnPlan(planId => publishWarPlan(planId, options)),
        [warWriteOnPlan],
    );

    const warRetract = useCallback(
        () => warWrite(() => saveWarPlan(clanId!, { weekStart: warWeekStart, status: 'draft' })),
        [warWrite, clanId, warWeekStart],
    );

    /**
     * The destination is fixed to the clan tab by `warPlanApi`, not chosen here: a broadcast is
     * leader-authored text delivered to up to fifty devices, so where it LEADS must not be
     * author-controlled. Title and body stay the leader's own words and must be rendered as text.
     */
    const warNotify = useCallback(
        (title: string, body: string) =>
            warWrite(() => notifyClan(clanId!, title, body, { route: '/clan' }), { reload: false }),
        [warWrite, clanId],
    );

    /**
     * The sheet is a READ, so it is not gated on being a leader — a member looking at a published
     * plan may export their clan's orders. It is still refused for a shared profile and with no
     * plan, which is why it does not simply call the service directly.
     */
    const warLoadSheet = useCallback((): Promise<WarPlanResult<WarSheetRow[]>> => {
        if (isSharedProfile) return refuseWar<WarSheetRow[]>(WAR_SHARED_PROFILE_ERROR);
        if (!backendConfigured) return refuseWar<WarSheetRow[]>(WAR_NO_BACKEND_ERROR);
        if (!signedIn) return refuseWar<WarSheetRow[]>(WAR_SIGNED_OUT_ERROR);
        if (!warPlanId) return refuseWar<WarSheetRow[]>(WAR_NO_PLAN_ERROR);
        return loadAssignmentSheet(warPlanId);
    }, [isSharedProfile, backendConfigured, signedIn, warPlanId]);

    /**
     * The export text, built from the SHEET VIEW rather than from `board`.
     *
     * That is deliberate and it is the whole reason the view exists: the view is the one place a
     * live profile name is resolved, and it resolves only through `clan_members`, so a member who
     * was kicked keeps the snapshot taken when they were added instead of leaking their current
     * profile name into a message posted in a public Discord.
     */
    const warExportText = useCallback(
        async (options?: { codeBlock?: boolean }): Promise<WarPlanResult<string>> => {
            const sheet = await warLoadSheet();
            if (!sheet.ok) return sheet;
            return { ok: true, data: buildDiscordExport(sheet.data, options) };
        },
        [warLoadSheet],
    );

    /**
     * Clan mates who are not yet on the ally roster.
     *
     * Derived from data already in hand (`view.roster` is fetched by `loadAll`, and the ally list
     * comes with the board), so the "add player" picker costs no request of its own and cannot
     * offer somebody who is already a participant — which would fail with `duplicate-name` on the
     * partial unique index over `(plan_id, side, profile_id)`.
     */
    const warAddableMembers = useMemo(() => {
        if (!warBoard) return [];
        const already = new Set(
            warBoard.allies.map(a => a.profile_id).filter((id): id is string => !!id),
        );
        return view.roster
            .filter(row => !already.has(row.profile_id))
            .map(row => ({ profileId: row.profile_id, name: row.name, role: row.role }));
    }, [warBoard, view.roster]);

    const warStatus: WarPlanTabStatus = useMemo(() => {
        if (!warOpened) return 'idle';
        if (!warReachable) return 'unavailable';
        if (warError) return 'error';
        // No stamped snapshot yet (first load, or the clan/week just changed) reads as loading
        // rather than as "no plan", so the empty state is never shown for a board in flight.
        if (warLoading || !warView) return 'loading';
        return warView.board ? 'ready' : 'none';
    }, [warOpened, warReachable, warError, warLoading, warView]);

    const war = useMemo<UseWarPlan>(
        () => ({
            status: warStatus,
            weekStart: warWeekStart,
            isCurrentWeek: warWeekStart === currentWarWeekStart(),
            setWeekStart,
            stepWeek,
            board: warBoard,
            error: warError,
            busy: warBusy,
            canEdit: warCanEdit,
            battleDay: warBattleDay,
            addableMembers: warAddableMembers,
            pushOptOutIsServerSide: WAR_PUSH_OPT_OUT_IS_SERVER_SIDE,
            openWarPlan,
            refreshWar,
            savePlan: warSavePlan,
            createPlan: warCreatePlan,
            addAlly: warAddAlly,
            addEnemy: warAddEnemy,
            addEnemies: warAddEnemies,
            rename: warRename,
            updateParticipant: warUpdateParticipant,
            removeParticipant: warRemoveParticipant,
            setOrders: warSetOrders,
            clearOrders: warClearOrders,
            publish: warPublish,
            retract: warRetract,
            notify: warNotify,
            loadSheet: warLoadSheet,
            exportText: warExportText,
        }),
        [
            warStatus, warWeekStart, setWeekStart, stepWeek, warBoard, warError, warBusy,
            warCanEdit, warBattleDay, warAddableMembers, openWarPlan, refreshWar,
            warSavePlan, warCreatePlan, warAddAlly, warAddEnemy, warAddEnemies, warRename,
            warUpdateParticipant, warRemoveParticipant, warSetOrders, warClearOrders,
            warPublish, warRetract, warNotify, warLoadSheet, warExportText,
        ],
    );

    /* -------------------------------------------------------------------------------------- *
     * Assembly
     * -------------------------------------------------------------------------------------- */

    const status: ClanStatus = useMemo(() => {
        if (!backendConfigured) return 'unconfigured';
        if (isSharedProfile) return 'shared-profile';
        if (!signedIn) return authStatus === 'initialising' ? 'loading' : 'signed-out';
        if (loading) return 'loading';
        if (error && !view.membership) return 'error';
        return view.membership ? 'ready' : 'no-clan';
    }, [backendConfigured, isSharedProfile, signedIn, authStatus, loading, error, view.membership]);

    const badge = useMemo(() => (view.clan ? badgeOf(view.clan) : null), [view.clan]);

    const discovery = useMemo<ClanDiscovery>(
        () => ({
            recent,
            recentLoading,
            results,
            searching,
            query,
            setQuery,
            refreshRecent,
            error: discoveryError,
        }),
        [recent, recentLoading, results, searching, query, refreshRecent, discoveryError],
    );

    const value = useMemo<UseClan>(
        () => ({
            status,
            error,
            busy,
            isSharedProfile,
            profileId,
            membership: view.membership,
            role,
            clan: view.clan,
            badge,
            roster: view.roster,
            requests: view.requests,
            tree: view.tree,
            treeInfo: view.treeInfo,
            live,
            canEditTree,
            canManageRoles,
            canSeePassword,
            canKick,
            canDeleteClan,
            canLeave,
            mustTransferBeforeLeaving,
            canPullTree,
            create,
            join,
            leave,
            kick,
            promote,
            demote,
            handOver,
            remove,
            edit,
            setBadge,
            approve,
            deny,
            saveTree,
            pullTree,
            password,
            passwordLoading,
            revealPassword,
            setPassword,
            regeneratePassword,
            share: shareState,
            publishShare: doPublish,
            stopSharing,
            setClanSyncEnabled,
            clanSyncEnabled,
            autoPull,
            dismissAutoPull,
            warPoints,
            memberBreakdown,
            war,
            discovery,
            refresh: loadAll,
        }),
        [
            status, error, busy, isSharedProfile, profileId, loaded, role, badge, live,
            canEditTree, canManageRoles, canSeePassword, canKick, canDeleteClan, canLeave,
            mustTransferBeforeLeaving, canPullTree,
            create, join, leave, kick, promote, demote, handOver, remove, edit, setBadge,
            approve, deny, saveTree, pullTree,
            password, passwordLoading, revealPassword, setPassword, regeneratePassword,
            shareState, doPublish, stopSharing, setClanSyncEnabled, clanSyncEnabled,
            autoPull, dismissAutoPull, warPoints, memberBreakdown,
            war,
            discovery, loadAll,
        ],
    );

    return <ClanContext.Provider value={value}>{children}</ClanContext.Provider>;
};

/**
 * The clan state for the ACTIVE PROFILE.
 *
 * Returns the inert (`status: 'unconfigured'`) snapshot when no `<ClanProvider>` is mounted, so a
 * surface can be written before the provider is wired into `App.tsx` and a build with no backend
 * behaves identically to one whose provider is missing. Mount the provider inside
 * `ProfileProvider` (it needs the active profile) and inside `GameDataProvider` (it reads the war
 * configs) — in `App.tsx` that is anywhere below `<ProfileProvider>`.
 */
export function useClan(): UseClan {
    return useContext(ClanContext) ?? INERT;
}
