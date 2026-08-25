/**
 * clanApi — every clan call the client can make, and nothing else.
 * ================================================================
 *
 * This module is the ONLY place in the app that names a clan RPC, a clan table or a clan view.
 * It is pure TypeScript: no React, no state, no timers. `ClanContext` (and any surface that wants
 * a one-off call) goes through here so that:
 *
 *   * the exact SQL parameter names live in one file. PostgREST sends RPC arguments **by name**
 *     (`{"p_profile_id": }`), so `p_profileId` or `profile_id` is not a type error and not a
 *     runtime error either — it is a silent `PGRST202 function not found`. Every wrapper below
 *     was checked against `pg_get_function_arguments()` on a throwaway cluster with
 *     0001+0003+0004+0005+0006 applied; the signatures are quoted next to each function.
 *   * one error taxonomy turns Postgres/PostgREST failures into meanings the UI can act on, so no
 *     component ever pattern-matches a Postgres message again.
 *   * nothing throws. Every export resolves to `{ ok: true, data }` or `{ ok: false, error }`.
 *
 * NO BACKEND IS A NORMAL OUTCOME, NOT AN ERROR
 * --------------------------------------------
 * The app ships to GitHub Pages and must work with no `VITE_SUPABASE_*` at all. The client comes
 * from `getSupabaseClient()` (this module never creates one — a second client would mean a second
 * auth session and a second `localStorage` key), and when it is `null` every call here resolves to
 * `{ ok: false, error: { kind: 'no-backend' } }`. Callers render the local-only UI on that kind;
 * they must not show it as a failure.
 *
 * WHY JOINING IS AN RPC AND NOT AN INSERT
 * --------------------------------------
 * 0005 §6 **revoked `INSERT` on `clan_members` from `authenticated`** (verified: the role now holds
 * only `SELECT, DELETE` on that table plus `UPDATE(role)`). The old self-enrolment path existed for
 * `join_policy = 'open'`, and open clans stopped existing in 0005 — `clan_is_joinable()` is now a
 * constant `false`, so even the surviving policy denies. Joining therefore goes exclusively through
 * `join_clan(p_name, p_tag, p_password, p_profile_id)`, which is `security definer` and compares the
 * password before it writes a row. There is no client-side path to a membership, and an attempt to
 * insert one comes back `42501 permission denied for table clan_members`.
 *
 * WHY THE JOIN PASSWORD IS READABLE AND NOT HASHED
 * -----------------------------------------------
 * A leader must be able to **read the password back** — the whole point is to re-post it in the
 * clan's real in-game chat. A bcrypt/argon hash is by construction unreadable, so it cannot serve
 * that use case. 0003 therefore stores the password in plaintext in its own table,
 * `clan_secrets`, protected by RLS instead of by hashing: `select` is allowed only when
 * `has_clan_role(clan_id, ['owner','admin'])`, and `authenticated` holds `SELECT` and nothing else
 * on it. The consequences the client must respect:
 *
 *   * `getJoinPassword()` returns `{ ok: true, data: null }` for a plain member or a stranger —
 *     RLS filters the row out, which is **zero rows, not an error**. The UI simply does not render
 *     the field. Do not treat `null` as a failure.
 *   * the password must never be logged, never enter a `UserProfile`, never appear in a share
 *     payload or an export (plan §4d rules 1–2). `createClan()`'s response is the only response in
 *     the schema that carries it; treat it like a one-time token.
 *
 * WHY A WRONG PASSWORD IS A RESULT AND NOT AN EXCEPTION
 * ----------------------------------------------------
 * `join_clan()` **returns** `{"status":"failed"}` for a wrong name, a wrong tag and a wrong
 * password alike — identical single-key object, same constant ~0.4 s delay — and it returns
 * `{"status":"rate_limited", "retry_after_seconds": N}` when the caller has spent its 12 attempts
 * in the current 10-minute window. It does that because a `raise` would roll its own brute-force
 * counter bump back (PostgREST runs one transaction per RPC), which made the limiter unreachable —
 * 0003 §3 has the measurement. So `joinClan()` below resolves `ok: true` with a discriminated
 * union and **`.status` is the primary signal**; `ok: false` is reserved for the genuine
 * impossibilities that still raise (not signed in, not your profile, already in a clan, clan full).
 * Never write code that treats an exception as "wrong password" — there is no such exception.
 *
 * RAW MESSAGES STAY IN THE CONSOLE
 * -------------------------------
 * `ClanError.message` is written for a person and is safe to render. The Postgres text is kept on
 * `ClanError.raw` for a `console.debug` and must never reach the DOM: it contains profile uuids,
 * clan ids, byte counts and function names.
 */

import { getSupabaseClient } from './supabaseClient';
import type { SupabaseClient } from './supabaseClient';
// Type-only: erased at compile time. Reusing the existing badge type instead of declaring a second
// one is what keeps `<ClanBadge>` / `ClanBadgePicker` and this module from drifting apart.
import type { ClanBadge } from '../utils/clanBadge';

/* ------------------------------------------------------------------------------------------ *
 * Limits — mirrored from the game, enforced by the database
 * ------------------------------------------------------------------------------------------ */

/**
 * These four mirror `GuildBaseConfig.json` (`MaxGuildNameLength` 9, `MaxGuildTagLength` 5,
 * `MaxGuildMemberCount` 50) **and** the CHECK constraints 0001 put on `public.clans`. They are
 * duplicated here only so a form can validate before it spends a round trip: the database is the
 * enforcement, and it answers `23514 clans_name_check` / `clans_tag_check` if these ever drift.
 * A surface that already has the parsed config loaded should prefer the config's own values.
 */
export const CLAN_NAME_MAX_LENGTH = 9;
export const CLAN_TAG_MAX_LENGTH = 5;
/** `^[A-Za-z0-9 '&\-_]+$` — GuildBaseConfig.NameValidationRegex, and 0001's clans_name_check. */
export const CLAN_NAME_PATTERN = /^[A-Za-z0-9 '&\-_]+$/;
/** `^[A-Z0-9_-]+$` — GuildBaseConfig.TagValidationRegex. The tag is upper-cased by a trigger. */
export const CLAN_TAG_PATTERN = /^[A-Z0-9_-]+$/;
/** Default `clans.member_cap`. A clan may have been created with less; read the row, not this. */
export const CLAN_MEMBER_CAP_DEFAULT = 50;

/** 0003 §1/§8: every NEW password is 12..64 printable characters. Migrated ones may be 8 at rest. */
export const JOIN_PASSWORD_MIN_LENGTH = 12;
export const JOIN_PASSWORD_MAX_LENGTH = 64;

/**
 * 16 KB, the ceiling `enforce_profile_limits()` puts on `profiles.clan_share` (0005 §4). Measured
 * against the real document, not guessed: a fully populated share is ~1.9 KB as sent and ~2.3 KB
 * once jsonb has normalised it, so this is 7x the real thing. `publishClanShare()` measures the
 * encoded byte length and refuses locally rather than letting the trigger raise `22023` — the
 * server's message carries the byte count but the client can say something actionable instead.
 */
export const CLAN_SHARE_MAX_BYTES = 16384;

/** Server-side ceiling on both discovery RPCs (0005 §3). `p_limit` is a request, not a promise. */
export const CLAN_DISCOVERY_MAX_ROWS = 25;

/* ------------------------------------------------------------------------------------------ *
 * Row shapes — each one is the real column list, in the real order
 * ------------------------------------------------------------------------------------------ */

export type ClanRole = 'owner' | 'admin' | 'member';
/** 0005 §1 removed `'open'`: `clans_join_policy_chk` now allows exactly these two. */
export type ClanJoinPolicy = 'invite' | 'request';

/**
 * A guild tier: one KEY of `GuildTierConfig.json`, or `null` for "nobody has told us yet".
 *
 * 0011 added `clans.tier` as a NULLABLE `text` with NO default, on purpose: the app-side clan is not
 * the in-game guild, so the database has never observed the tier and cannot compute it. A default
 * would be a claim nobody made, and it is not a harmless one — the tier picks concrete reward
 * amounts and the SIGN of `TierPointsOnLose` (at the bottom a defeat still pays, at the top it
 * costs), so guessing puts a wrong number on screen as a fact.
 */
export type ClanTier = 'E' | 'D' | 'C' | 'B' | 'A' | 'S' | 'SS' | 'SSS';

/**
 * The eight tiers the DATABASE accepts: `clans_tier_chk` and `set_clan_settings()`'s own literal
 * list, both written out in 0011.
 *
 * ⚠️ **This is not the list a picker should offer.** The tiers that exist are whatever
 * `GuildTierConfig.json` holds for the game config version the user has selected, and that set has
 * really changed: versions before 2026_05 ship SIX tiers (E..S) and newer ones ship eight. A UI
 * therefore reads its options from the config and uses this constant only to check that a key the
 * config offers is one the server will accept — a config newer than the schema would otherwise earn
 * a `22023` on save. If the game ever ships a ninth tier, 0011 says plainly that the migration is
 * not self-updating: the CHECK, the RPC's list and this constant all have to be widened together.
 */
export const CLAN_TIER_KEYS: readonly ClanTier[] = ['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

/**
 * What `set_clan_settings(p_tier => )` takes to mean "clear the tier back to not set".
 *
 * `null` cannot mean that: on every parameter of that function `null` already means "leave
 * unchanged", and `tier` is the first NULLABLE setting, so it is the first that needed a way back.
 * 0011 chose the empty string, which the CHECK would reject anyway and so can never be mistaken for
 * a tier. `updateClan()` below is the only place this value is ever produced.
 */
const CLAN_TIER_CLEAR = '';

/** Type guard for a string that arrived from a config file or from the server. */
export function isClanTier(value: unknown): value is ClanTier {
    return typeof value === 'string' && (CLAN_TIER_KEYS as readonly string[]).includes(value);
}

/**
 * `public.clans`, minus nothing — the table has no secret column by design (0003 moved the
 * password out to `clan_secrets` precisely so `select *` can never leak it). `invite_code` was
 * dropped by 0003 and is not here.
 */
export interface ClanRow {
    id: string;
    name: string;
    tag: string;
    join_policy: ClanJoinPolicy;
    member_cap: number;
    created_by: string;
    created_at: string;
    badge_shape: number;
    badge_shape_color: number;
    badge_icon: number;
    badge_icon_color: number;
    /** 5-minute granularity by design (0005 §2). Render as "active recently", never as a clock. */
    activity_at: string;
    /**
     * 0011. A `GuildTierConfig.json` key, or `null` for "not set" — which is the state every clan
     * created before 0011 is in, and the state a clan stays in until its owner says otherwise.
     * **Never sort or compare this.** Text order (A < B < C < D < E < S < SS < SSS) is the game's
     * ranking almost backwards at the front; rank is `RequiredPoints`, read from the config.
     */
    tier: ClanTier | null;
}

/**
 * The columns of `clans`, spelled out. `select('*')` would work; naming them documents the row.
 *
 * ⚠️ **DEPLOY ORDER: 0011 MUST BE APPLIED BEFORE THIS BUNDLE SHIPS.** PostgREST answers a request
 * for a column that does not exist with a 400, so naming a column from an unapplied migration does
 * not degrade — it fails outright: `getClan()` errors, `clan.clan` stays null, and `ClanTabShell`'s
 * `if (status === 'no-clan' || !clan.clan || !clan.role)` then shows the create/browse screen to
 * somebody who owns a clan. That happened on the live project the moment a dev server restart picked
 * up the column list ahead of the migration, and it is hard to diagnose because the clan browser
 * keeps showing its YOUR CLAN badge: that badge reads `membership`, which loads fine, so two
 * surfaces disagree and neither looks broken.
 *
 * The rule this file follows: **the column list may only name columns that are live, and it must
 * name every column the app reads.** Both halves matter. `tier` sat out of this list while 0011 was
 * unwritten, which was right then and is wrong now: 0011 ships with this bundle, `ClanRow` declares
 * `tier`, and `ClanTierPanel` reads `clan.clan.tier`. A missing name here does not fail loudly the
 * way a surplus one does — the key is simply absent from the row, `clanRow?.tier ?? null` quietly
 * yields `null`, and EVERY clan renders the "nobody has recorded this clan's tier" empty state
 * forever, however many times its owner sets it. It is the client-side twin of the failure 0011 §5.4
 * asserts against on the server (a discovery RPC that returns `clan_public` but never selects
 * `p.tier`), and unlike that one nothing raises. Verified against a live row: with `tier` absent from
 * this list, a clan whose `clans.tier` is `'SSS'` comes back as a row with no `tier` key at all.
 */
const CLAN_COLUMNS =
    'id,name,tag,join_policy,member_cap,created_by,created_at,' +
    'badge_shape,badge_shape_color,badge_icon,badge_icon_color,activity_at,tier';

/** `public.clan_members`. PK is `profile_id`: one clan per PROFILE, not per account. */
export interface ClanMemberRow {
    clan_id: string;
    profile_id: string;
    user_id: string;
    role: ClanRole;
    joined_at: string;
}

const CLAN_MEMBER_COLUMNS = 'clan_id,profile_id,user_id,role,joined_at';

/** `public.clan_tree`. `levels` is `{ "<globalId>": level }` with zero levels stripped. */
export interface ClanTreeRow {
    clan_id: string;
    levels: Record<string, number>;
    updated_by: string | null;
    updated_at: string;
}

const CLAN_TREE_COLUMNS = 'clan_id,levels,updated_by,updated_at';

/**
 * `public.clan_tree_info` (view, 0005 §5). Exists because `updated_by` is an `auth.users` id and
 * clients cannot read `auth.users` — correctly, it holds email addresses. `updated_by_name` is the
 * updater's profile name *inside this clan*, or `null` when they have left (the UI should then say
 * "unknown"; rows were deliberately not backfilled to the owner).
 */
export interface ClanTreeInfoRow {
    clan_id: string;
    updated_at: string;
    updated_by: string | null;
    updated_by_name: string | null;
    node_count: number;
}

/** `public.clan_roster` (view, 0001 §6). Eight narrow columns; use this on every clan screen. */
export interface ClanRosterRow {
    clan_id: string;
    profile_id: string;
    role: ClanRole;
    joined_at: string;
    name: string;
    power: number | null;
    /** The member's last sync. Tells the reader how stale their `clan_share` is. */
    updated_at: string;
    is_mine: boolean;
}

/**
 * `public.clan_roster_detail` (view, 0005 §4) — `clan_roster` plus each member's `clan_share`.
 * Deliberately a second view: adding the share to `clan_roster` would turn a ~4 KB read into a
 * ~117 KB one on every screen that only wanted names and power.
 *
 * ⚠️ `clan_share` is MEMBER-WRITTEN, CLAN-MATE-READ DATA. It is attributed (it arrives joined to
 * `profile_id`, `name` and `role`) but it is not verified, and the database validates only its
 * type and its size. Render it as data, never as HTML, and treat every number in it as a claim.
 */
export interface ClanRosterDetailRow extends ClanRosterRow {
    clan_share: ClanShare | null;
}

/** `public.clan_secrets`, readable only by that clan's owner/admin (0003 §2). */
export interface ClanSecretRow {
    clan_id: string;
    join_password: string;
    updated_at: string;
    updated_by: string | null;
}

/** `public.clan_requests` — pending joins for a `join_policy = 'request'` clan. */
export interface ClanRequestRow {
    clan_id: string;
    profile_id: string;
    user_id: string;
    created_at: string;
}

/**
 * `public.clan_public` — the composite TYPE both discovery RPCs return (0005 §3). It is a type and
 * not a view on purpose: a type cannot be selected from, so there is no endpoint to bulk-download
 * and no grant to leak. Only `recent_clans()` and `search_clans()` produce rows of it, and both
 * clamp the count server-side.
 */
export interface ClanPublic {
    id: string;
    name: string;
    tag: string;
    join_policy: ClanJoinPolicy;
    badge_shape: number;
    badge_shape_color: number;
    badge_icon: number;
    badge_icon_color: number;
    member_count: number;
    member_cap: number;
    activity_at: string;
    created_at: string;
    /**
     * 0011 appended `tier` to the type, last, so every existing column kept its ordinal. It is the
     * same class of fact as the badge — the guild's own screen shows it in game — and it is what a
     * player weighing a join request most wants to know. It is deliberately NOT a search key:
     * `search_clans()` selects it but never filters on it, because "show me every SSS clan" is the
     * enumeration 0005 §3 exists to prevent. `null` means "not set", not "tier E".
     */
    tier: ClanTier | null;
}

/**
 * What `create_clan()` returns. 0003 changed the return type from `public.clans` to `jsonb`
 * because the creator has to get the generated password back in the same round trip and the
 * password is not a column of `clans`. Note what is NOT in it: the badge (0004 deliberately did
 * not touch `create_clan`; a trigger assigns a random badge, so read it from `clans` afterwards)
 * and `activity_at`.
 */
export interface CreatedClan {
    id: string;
    name: string;
    tag: string;
    join_policy: ClanJoinPolicy;
    member_cap: number;
    created_at: string;
    role: 'owner';
    /** Show it once, then forget it. Never log it. Read it back from `clan_secrets` later. */
    join_password: string;
}

/**
 * The four shapes `join_clan()` returns. **Branch on `.status`.** `failed` carries nothing else on
 * purpose — which of "no such clan", "wrong tag", "wrong password" it was is not knowable, and the
 * UI must show one neutral message rather than trying to be helpful.
 */
export type JoinClanOutcome =
    | { status: 'joined'; clan_id: string; name: string; tag: string; role: 'member' }
    | { status: 'requested'; clan_id: string; name: string; tag: string }
    | { status: 'failed' }
    | { status: 'rate_limited'; retry_after_seconds: number };

/* ------------------------------------------------------------------------------------------ *
 * The shared per-member summary (plan §4g / 0005 §4)
 * ------------------------------------------------------------------------------------------ */

/** The eight war categories, verbatim from `src/utils/guildWarUtils.ts`. */
export type ClanShareWarCategory =
    | 'tech' | 'skills' | 'mounts' | 'eggs' | 'pets' | 'dungeons' | 'forge' | 'forgeSpend';

export interface ClanShareWarEntry {
    /** Points STILL OBTAINABLE from what the member holds right now — not points already scored. */
    points: number;
    /** War day indices this category scores on, from `computeWarDaysMap()`. Never hard-coded. */
    days: number[];
}

/**
 * How much one published figure can be trusted. Mirrors `WarConfidence` in
 * `src/utils/warPoints.ts`, which is what produces it, and it is spelled out rather than coded to
 * a letter because this document is read in a SQL editor as often as by the app.
 *
 *   `exact`        the config pays this for those resources (expected value where the game rolls).
 *   `lower-bound`  something obtainable is knowingly not counted. `why` names it.
 *   `unavailable`  the input or the mechanic is not modelled. `points` is 0 and that 0 IS NOT A
 *                  VALUE — a reader must render it as "n/a", never as a digit.
 */
export type ClanShareConfidence = 'exact' | 'lower-bound' | 'unavailable';

/** Per-category provenance: how the number next to it was arrived at. */
export interface ClanShareProvenanceEntry {
    conf: ClanShareConfidence;
    /** `war[c].points` before the publisher's own clan `WarPointsFrom` multiplier. */
    base?: number;
    /**
     * A figure the publisher deliberately did NOT count — a mount-merge half, a pet-merge ceiling,
     * coins past the known forge sink. Lets a reader show "≥ 4.1 M (≤ 6.8 M)" instead of one number
     * that is quietly a floor. Carries its own multipliers, so it is not `points × anything`.
     */
    ceiling?: number;
    /** The publisher's own one-sentence explanation. Member-written text: render as TEXT, never HTML. */
    why?: string;
}

/**
 * The sibling of `war`, added in `v2`: where every number in `war` came from.
 *
 * A SIBLING and not extra keys inside `war`, because a `v1` reader walks `war` and would carry the
 * new keys into its own arithmetic; and OPTIONAL, because a `v1` share stays in the wild until its
 * author next opens the app. Absent `prov` means "published before this tool tracked provenance",
 * which a reader must say out loud rather than assume means exact.
 */
export interface ClanShareProvenance {
    /** Confidence in the SUM of the eight categories. `exact` only when all eight are. */
    conf: ClanShareConfidence;
    /** One entry per `war` key. */
    cat: Record<ClanShareWarCategory, ClanShareProvenanceEntry>;
    /**
     * The publisher's `WarPointsOnDay16` clan nodes as fractions, index = war day. `byDay` carries
     * NO day boost (so it still adds up to the category totals); `dayPts` is the same six numbers
     * with each day's node applied, which is what that member would really score per day.
     */
    dayMul?: number[];
    dayPts?: number[];
    /** Hours of the current war week the tech projection was allowed to plan over. */
    hrs?: number;
    /** Whole-document caveats: gem allocation, hatch feasibility, days the config leaves empty. */
    notes?: string[];
    /** `false` when a game config the publisher's engine needed had not loaded. */
    full?: boolean;
}

/**
 * The document a member publishes to their clan. The database enforces ownership, `jsonb_typeof =
 * 'object'` and 16 KB — and deliberately nothing about the shape, because the formula behind it
 * lives in the client and moves with every game config version. Hence `v`: the shape is the
 * client's and it versions itself. Keys are short because fifty of these is one war-planner fetch.
 */
export interface ClanShare {
    /** Shape version. Bump when a field's MEANING changes, not when a value does. */
    v: number;
    /** Epoch ms — when the CLIENT computed this. */
    at: number;
    /** `parsed_configs` version the numbers were computed from, so a reader can spot stale maths. */
    cfg: string;
    trees: {
        Forge: Record<string, number>;
        Power: Record<string, number>;
        SkillsPetTech: Record<string, number>;
        Clan: Record<string, number>;
    };
    res: {
        coins: number;
        gems: number;
        hammers: number;
        skillTickets: number;
        clockWinders: number;
        eggshells: number;
        techPotions: number;
        guildPotions: number;
        eggs: Record<string, number>;
        keys: Record<string, number>;
    };
    war: Record<ClanShareWarCategory, ClanShareWarEntry>;
    /**
     * The same points projected onto the six war days: Tuesday = 0  Sunday/Monday = 5.
     *
     * NO per-day clan node is applied here, on purpose: this array must keep adding up to the
     * `war[*].points` that have a day, which is the one consistency check a reader can run on a
     * member-written document. The boosted version is `prov.dayPts`.
     */
    byDay: number[];
    /** `v2`: where every number above came from. Absent in a `v1` share. */
    prov?: ClanShareProvenance;
}

/**
 * Current `ClanShare.v`. Bump together with the shape.
 *
 * 1 → 2: `prov` added (per-category confidence, the excluded ceilings, the publisher's reasons and
 * the day multipliers), and `war` stopped being a first-order projection — `tech`, `forge` and
 * `pets` are no longer structurally 0 and `forgeSpend` is no longer an over-estimate. Nothing was
 * removed or repurposed, so a `v1` document still reads correctly; it simply cannot say how much
 * any of its numbers can be trusted, and a reader must label it as such.
 */
export const CLAN_SHARE_VERSION = 2;

/* ------------------------------------------------------------------------------------------ *
 * Error taxonomy
 * ------------------------------------------------------------------------------------------ */

/**
 * Every failure this module can report, as a MEANING rather than a code. The mapping from
 * SQLSTATE + message was not guessed: each one was provoked on a throwaway cluster carrying
 * 0001+0003+0004+0005+0006 and the observed code is quoted in `classifyError()`.
 *
 *  - `no-backend`          no `VITE_SUPABASE_*` in this build. Render the local-only UI.
 *  - `not-signed-in`       no session (or an expired one). 42501 `authentication required`, or
 *                          `permission denied for function ` because the call went out as `anon`.
 *  - `not-a-member`        the caller (or the profile they named) is not in that clan. P0002.
 *  - `not-a-leader`        42501 from an owner/admin-only RPC, or an RLS write that matched no row.
 *  - `not-your-profile`    42501 `profile  does not belong to you`. Switch profile, do not retry.
 *  - `already-in-a-clan`   42501 — one clan per profile. Leave first.
 *  - `needs-owner-transfer` the owner must hand the clan over before leaving / being removed.
 *  - `rate-limited`        the join limiter, or an HTTP 429. `retryAfterSeconds` when known.
 *  - `wrong-credentials`   name + tag + password did not match. NOT raised by the database —
 *                          `joinClan()` reports it as a `failed` OUTCOME; this kind exists so a
 *                          caller that prefers one code path can normalise it.
 *  - `clan-full`           54000.
 *  - `name-or-tag-taken`   23505 on `clans_name_tag_key` (case-insensitive on both).
 *  - `version-conflict`    a write conditioned on a row version touched nothing, or 40001/40P01.
 *  - `invalid-input`       22023 / 23514 / 22P02 — the client sent something the schema refuses.
 *  - `too-large`           the 16 KB `clan_share` ceiling (or the 256 KB body one).
 *  - `not-found`           the row is not there (P0002, or a targeted write that matched nothing).
 *  - `quota`               54000 from a profile quota, not from a full clan.
 *  - `offline`             the request never reached Postgres.
 *  - `unknown`             everything else, including a schema/bundle mismatch (PGRST202).
 */
export type ClanErrorKind =
    | 'no-backend'
    | 'not-signed-in'
    | 'not-a-member'
    | 'not-a-leader'
    | 'not-your-profile'
    | 'already-in-a-clan'
    | 'needs-owner-transfer'
    | 'rate-limited'
    | 'wrong-credentials'
    | 'clan-full'
    | 'name-or-tag-taken'
    | 'version-conflict'
    | 'invalid-input'
    | 'too-large'
    | 'not-found'
    | 'quota'
    | 'offline'
    | 'unknown';

export interface ClanError {
    kind: ClanErrorKind;
    /** Safe to render. Written for a person; carries no uuid, no byte count, no function name. */
    message: string;
    /** Seconds to wait, when the server said so. Only ever set on `rate-limited`. */
    retryAfterSeconds?: number;
    /** The raw Postgres/PostgREST text. For `console.debug` ONLY — never put this in the DOM. */
    raw?: string;
    /** SQLSTATE or PostgREST code, for the same debugging purpose. */
    code?: string;
}

export type ClanResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: ClanError };

const ok = <T>(data: T): ClanResult<T> => ({ ok: true, data });
const fail = <T>(error: ClanError): ClanResult<T> => ({ ok: false, error });

/** The one place `no-backend` is constructed, so its wording cannot drift between call sites. */
function noBackend<T>(): ClanResult<T> {
    return fail({
        kind: 'no-backend',
        message: 'Clans need an account, and this build has no server configured. Everything else keeps working locally.',
    });
}

interface PostgrestErrorLike {
    message?: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
    name?: string;
    status?: number;
}

/**
 * Did the request even leave the browser? Checked first, because an offline `fetch` rejects with a
 * `TypeError` that carries no code and would otherwise land in `unknown`. Safari says "Load
 * failed" where Chrome says "Failed to fetch", so both are matched.
 */
function isOffline(error: PostgrestErrorLike): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const message = (error.message || '').toLowerCase();
    return (
        error.name === 'TypeError' ||
        message.includes('failed to fetch') ||
        message.includes('load failed') ||
        message.includes('networkerror') ||
        message.includes('network request failed')
    );
}

/**
 * SQLSTATE + message -> meaning. The message tests are ordered from most specific to least, and
 * every one of them is anchored on a string that a migration writes deliberately (they are quoted
 * from 0001/0003/0004/0005/0006). If a future migration rewords one, the fallback for that code is
 * still safe — `42501` degrades to `not-a-leader`, which is the conservative reading of "the
 * database refused this write".
 */
export function classifyError(raw: unknown): ClanError {
    const error = (raw ?? {}) as PostgrestErrorLike;
    const message = (error.message || '').trim();
    const lower = message.toLowerCase();
    const code = error.code ? String(error.code) : undefined;
    const base = { raw: message || undefined, code };

    if (isOffline(error)) {
        return {
            ...base,
            kind: 'offline',
            message: 'Cannot reach the server. Your profiles are safe in this browser. Try again when you are back online.',
        };
    }

    // HTTP-level throttling (the API gateway, not the join limiter).
    if (error.status === 429) {
        return { ...base, kind: 'rate-limited', message: 'Too many requests. Wait a moment and try again.' };
    }

    // PostgREST's own codes. PGRST202 means "no function with that name and those argument names":
    // in this codebase that is always a bundle/schema mismatch, never a user error.
    if (code === 'PGRST301' || code === 'PGRST303' || error.status === 401) {
        return { ...base, kind: 'not-signed-in', message: 'Your session has expired. Sign in again to continue.' };
    }
    if (code === 'PGRST202' || code === '42883') {
        return {
            ...base,
            kind: 'unknown',
            // No "migrations" and no "backend": this panel is read by players, and the only thing
            // they can do about it is reload and then wait. It must also say the one thing they
            // will actually worry about — whether their own data is at risk.
            message: 'This app and the clan server are not the same version, so clans are unavailable for the moment. Reload the page; if it keeps happening, it is being fixed on the server and there is nothing to do at your end. Your profiles are untouched and everything else keeps working.',
        };
    }

    switch (code) {
        case '42501': {
            // Every clan RPC raises 42501 for four very different situations. The message is the
            // only discriminator the database gives us, and each string below is one a migration
            // writes verbatim.
            if (lower.includes('authentication required')) {
                return { ...base, kind: 'not-signed-in', message: 'Sign in to use clans.' };
            }
            if (lower.includes('permission denied')) {
                // `anon` holds EXECUTE on nothing but ping(), so this is a missing session rather
                // than a missing privilege — every clan RPC is granted to `authenticated`.
                return { ...base, kind: 'not-signed-in', message: 'Sign in to use clans.' };
            }
            if (lower.includes('does not belong to you')) {
                return {
                    ...base,
                    kind: 'not-your-profile',
                    message: 'That profile is not on this account. Switch to one of your own profiles first.',
                };
            }
            if (lower.includes('already in a clan')) {
                return {
                    ...base,
                    kind: 'already-in-a-clan',
                    message: 'This profile is already in a clan. Leave it before joining another one.',
                };
            }
            if (lower.includes('transfer ownership') || lower.includes('cannot be kicked')) {
                return {
                    ...base,
                    kind: 'needs-owner-transfer',
                    message: 'The owner has to hand the clan to somebody else first.',
                };
            }
            if (lower.includes('use leave_clan')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'Use "leave clan" to remove your own profile.',
                };
            }
            // 0008's set_clan_settings() is the one refusal on this surface that an ADMIN also
            // gets, so the generic wording below ("owner or an admin") would tell an admin they
            // are allowed to do the thing they were just refused. Same `kind`, accurate text.
            if (lower.includes('change the clan settings')) {
                return {
                    ...base,
                    kind: 'not-a-leader',
                    message: 'Only the clan owner can change the clan name, tag, join policy, member cap or guild tier.',
                };
            }
            return {
                ...base,
                kind: 'not-a-leader',
                message: 'Only the clan owner or an admin can do that.',
            };
        }

        case '23505':
            return {
                ...base,
                kind: 'name-or-tag-taken',
                message: 'A clan with that name and tag already exists. Pick another one.',
            };

        case '54000':
            // 54000 is used both for a full clan and for the per-account profile quotas.
            if (lower.includes('is full')) {
                return { ...base, kind: 'clan-full', message: 'That clan is full.' };
            }
            return {
                ...base,
                kind: 'quota',
                message: 'You have reached a storage limit on this account.',
            };

        case '22023':
            if (lower.includes('clan_share is') || lower.includes('limit is')) {
                return {
                    ...base,
                    kind: 'too-large',
                    message: 'Your clan summary is too big to publish. Reduce what you share and try again.',
                };
            }
            if (lower.includes('join password')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `The join password must be ${JOIN_PASSWORD_MIN_LENGTH}-${JOIN_PASSWORD_MAX_LENGTH} printable characters.`,
                };
            }
            if (lower.includes('badge')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'That badge is not one the game defines. Pick a shape, a symbol and their colours from the picker.',
                };
            }
            // 0008's set_clan_settings(). Two causes behind one code, and the second one is the
            // only message in this module that tells the owner to do something to the clan rather
            // than to the field: a cap below the people already in it would leave the clan
            // permanently "full" (clan_members_guard compares count >= cap on every join), so the
            // RPC refuses instead of writing it.
            if (lower.includes('member cap')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: lower.includes('already in the clan')
                        ? 'That member cap is lower than the number of members already in the clan. Remove members first, or choose a higher cap.'
                        : `A member cap is between 1 and ${CLAN_MEMBER_CAP_DEFAULT}.`,
                };
            }
            if (lower.includes('join policy')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'A clan is either invite-only or request-to-join.',
                };
            }
            // 0011's set_clan_settings(). The only realistic cause is a game config newer than the
            // deployed schema offering a tier the CHECK has never heard of, so the message says that
            // rather than blaming the owner for a value this app put in front of them.
            if (lower.includes('clan tier')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'The clan server does not know that guild tier yet. It can be recorded once the server catches up with your game config.',
                };
            }
            if (lower.includes('nothing to change')) {
                return { ...base, kind: 'invalid-input', message: 'Nothing to change.' };
            }
            return { ...base, kind: 'invalid-input', message: 'The server refused that value.' };

        case '23514':
            // A table CHECK: the clan name/tag rules, the join policy, the clan_share type.
            if (lower.includes('clan_share')) {
                return { ...base, kind: 'invalid-input', message: 'That clan summary is not a valid document.' };
            }
            // `clans_tier_chk`. Unreachable through set_clan_settings(), which validates the tier
            // itself and raises 22023 naming the eight keys — so if this branch ever fires, a write
            // path exists that 0011 did not intend, and the message must still be a sentence.
            if (lower.includes('tier')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'The clan server does not know that guild tier yet. It can be recorded once the server catches up with your game config.',
                };
            }
            if (lower.includes('name')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `A clan name is 1-${CLAN_NAME_MAX_LENGTH} characters: letters, digits, spaces and ' & - _`,
                };
            }
            if (lower.includes('tag')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `A clan tag is 1-${CLAN_TAG_MAX_LENGTH} characters: A-Z, 0-9, - and _`,
                };
            }
            return { ...base, kind: 'invalid-input', message: 'The server refused that value.' };

        case '22P02':
            // An id that is not a uuid. Reachable in this app only through a corrupted local
            // profile id, which `profileIdMigration` exists to prevent.
            return { ...base, kind: 'invalid-input', message: 'That profile id is not valid on this account.' };

        case 'P0002':
            if (lower.includes('not in a clan') || lower.includes('not in clan')) {
                return { ...base, kind: 'not-a-member', message: 'That profile is not in this clan.' };
            }
            return { ...base, kind: 'not-found', message: 'That is not there any more. Refresh and try again.' };

        case '40001':
        case '40P01':
            return {
                ...base,
                kind: 'version-conflict',
                message: 'Somebody else changed that at the same moment. Refresh and try again.',
            };

        default:
            return {
                ...base,
                kind: 'unknown',
                message: 'Something went wrong talking to the server. Try again in a moment.',
            };
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------------------------------ */

/**
 * supabase-js is reached through an untyped client (there are no generated database types in this
 * repo), so `rpc`/`from` hand back `any`-shaped builders. The casts are confined to these two
 * helpers instead of being sprinkled through twenty wrappers.
 */
interface QueryOutcome<T> { data: T | null; error: PostgrestErrorLike | null }

/** Runs `body` with a client, or resolves `no-backend`. Never throws: a throw becomes a ClanError. */
async function withClient<T>(
    body: (client: SupabaseClient) => Promise<ClanResult<T>>,
): Promise<ClanResult<T>> {
    const client = await getSupabaseClient();
    if (!client) return noBackend<T>();
    try {
        return await body(client);
    } catch (e) {
        return fail<T>(classifyError(e));
    }
}

/** One RPC call, one place where the argument object is passed straight through by name. */
async function callRpc<T>(
    client: SupabaseClient,
    fn: string,
    args: Record<string, unknown>,
): Promise<ClanResult<T>> {
    const rpc = (client as unknown as {
        rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<QueryOutcome<T>>;
    }).rpc;
    const { data, error } = await rpc.call(client, fn, args);
    if (error) return fail<T>(classifyError(error));
    return ok(data as T);
}

/** A table/view read or write. `select` and the filters are applied by the caller's callback. */
type TableBuilder = {
    select: (columns?: string) => TableBuilder;
    update: (values: Record<string, unknown>) => TableBuilder;
    delete: () => TableBuilder;
    eq: (column: string, value: unknown) => TableBuilder;
    order: (column: string, options?: { ascending?: boolean }) => TableBuilder;
    limit: (n: number) => TableBuilder;
    maybeSingle: () => PromiseLike<QueryOutcome<unknown>>;
} & PromiseLike<QueryOutcome<unknown>>;

function table(client: SupabaseClient, name: string): TableBuilder {
    return (client as unknown as { from: (n: string) => TableBuilder }).from(name);
}

async function runQuery<T>(builder: PromiseLike<QueryOutcome<unknown>>): Promise<ClanResult<T>> {
    const { data, error } = await builder;
    if (error) return fail<T>(classifyError(error));
    return ok(data as T);
}

/* ------------------------------------------------------------------------------------------ *
 * Reads: membership, clan, roster, tree, secret, requests
 * ------------------------------------------------------------------------------------------ */

/**
 * The membership of ONE profile, or `null`.
 *
 * `clan_members`' primary key is `profile_id`, so this is a single index probe and there can never
 * be two rows. `null` is the normal answer for a profile that is not in a clan.
 *
 * Note what `clan_members_select_member` allows: `is_clan_member(clan_id) OR user_id = auth.uid()`,
 * i.e. **your own rows and every row of a clan you are in**. So this call would happily return a
 * clan mate's membership if you passed their profile id. Callers pass their own active profile id.
 */
export function getMembership(profileId: string): Promise<ClanResult<ClanMemberRow | null>> {
    return withClient(client =>
        runQuery<ClanMemberRow | null>(
            table(client, 'clan_members').select(CLAN_MEMBER_COLUMNS).eq('profile_id', profileId).maybeSingle(),
        ),
    );
}

/**
 * Every membership this ACCOUNT holds — one row per profile of yours that is in a clan, so an
 * account with profiles in two different clans gets two rows. Useful for a profile switcher that
 * wants to show a clan tag next to each profile.
 *
 * `userId` is a required argument and not an implicit "whoever is signed in" **because the RLS
 * policy is wider than this function's name**: it also exposes every clan mate's row (see
 * `getMembership`). Filtering server-side on `user_id` is what makes the result actually mine, and
 * it uses `clan_members_user_idx`. Pass `useAuth().userId`.
 */
export function listMyMemberships(userId: string): Promise<ClanResult<ClanMemberRow[]>> {
    return withClient(async client => {
        const result = await runQuery<ClanMemberRow[] | null>(
            table(client, 'clan_members').select(CLAN_MEMBER_COLUMNS).eq('user_id', userId),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/**
 * One clan row. Visible to its own members, and to anyone with a PENDING REQUEST to it (0005 §3a)
 * — that second case is what lets an "awaiting approval from " screen draw a name and a badge.
 * A stranger gets `null`, not an error: use `searchClans()` to find clans you are not in.
 */
export function getClan(clanId: string): Promise<ClanResult<ClanRow | null>> {
    return withClient(client =>
        runQuery<ClanRow | null>(table(client, 'clans').select(CLAN_COLUMNS).eq('id', clanId).maybeSingle()),
    );
}

/** The cheap roster: names, power, roles. Use this on every clan screen. */
export function getRoster(clanId: string): Promise<ClanResult<ClanRosterRow[]>> {
    return withClient(async client => {
        const result = await runQuery<ClanRosterRow[] | null>(
            table(client, 'clan_roster').select('*').eq('clan_id', clanId),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/**
 * The expensive roster: the same rows plus every member's `clan_share`. ~2.3 KB per sharing member,
 * so ~117 KB for a full clan — fetch it for the war planner, not for a member list.
 */
export function getRosterDetail(clanId: string): Promise<ClanResult<ClanRosterDetailRow[]>> {
    return withClient(async client => {
        const result = await runQuery<ClanRosterDetailRow[] | null>(
            table(client, 'clan_roster_detail').select('*').eq('clan_id', clanId),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/**
 * The shared clan tree. **Every member may read this** — that is the whole mechanism behind "pull
 * the clan tree into my profile": a read here plus a local write to `profile.techTree.Clan`. No
 * privilege is needed beyond membership (policy `clan_tree_select_member`), and 0005 §7 fails the
 * migration if that ever stops being true.
 */
export function getClanTree(clanId: string): Promise<ClanResult<ClanTreeRow | null>> {
    return withClient(client =>
        runQuery<ClanTreeRow | null>(
            table(client, 'clan_tree').select(CLAN_TREE_COLUMNS).eq('clan_id', clanId).maybeSingle(),
        ),
    );
}

/** Who last wrote the shared tree and when, with the id resolved to a name inside this clan. */
export function getClanTreeInfo(clanId: string): Promise<ClanResult<ClanTreeInfoRow | null>> {
    return withClient(client =>
        runQuery<ClanTreeInfoRow | null>(
            table(client, 'clan_tree_info').select('*').eq('clan_id', clanId).maybeSingle(),
        ),
    );
}

/**
 * The clan's join password — **or `null`, which is not an error**.
 *
 * `clan_secrets_select_leader` filters the row out for a plain member and for a stranger, so RLS
 * answers "zero rows" rather than "denied". The UI must read `null` as "you may not see this" and
 * simply not render the field. Verified: a member's `select count(*) from clan_secrets` is 0.
 *
 * Never log the returned string.
 */
export function getJoinPassword(clanId: string): Promise<ClanResult<ClanSecretRow | null>> {
    return withClient(client =>
        runQuery<ClanSecretRow | null>(
            table(client, 'clan_secrets')
                .select('clan_id,join_password,updated_at,updated_by')
                .eq('clan_id', clanId)
                .maybeSingle(),
        ),
    );
}

/** Pending join requests. Visible to the requester (their own) and to that clan's leaders. */
export function listClanRequests(clanId: string): Promise<ClanResult<ClanRequestRow[]>> {
    return withClient(async client => {
        const result = await runQuery<ClanRequestRow[] | null>(
            table(client, 'clan_requests')
                .select('clan_id,profile_id,user_id,created_at')
                .eq('clan_id', clanId)
                .order('created_at', { ascending: true }),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Discovery — the only two doors, and neither one can be paged
 * ------------------------------------------------------------------------------------------ */

/**
 * `recent_clans(p_limit integer DEFAULT 10) RETURNS SETOF clan_public`
 *
 * The browser's front page: the most recently ACTIVE clans. `p_limit` is clamped to `[1, 25]`
 * server-side, so asking for 1000 returns at most 25 — do not build a UI that assumes it got what
 * it asked for. There is no offset or cursor parameter, deliberately: without one, "every clan is
 * discoverable" cannot decay into "every clan is enumerable".
 */
export function recentClans(limit = 10): Promise<ClanResult<ClanPublic[]>> {
    return withClient(async client => {
        const result = await callRpc<ClanPublic[] | null>(client, 'recent_clans', { p_limit: limit });
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/**
 * `search_clans(p_query text, p_limit integer DEFAULT 10) RETURNS SETOF clan_public`
 *
 * Server-side search over name and tag. Three things the caller must respect:
 *
 *   1. **An empty (or blank) query returns zero rows** by design — an empty needle must not mean
 *      "everything". Short-circuit here so the round trip is not even spent, and call
 *      `recentClans()` for the default screen.
 *   2. **Ranking is the server's**: exact tag, tag prefix, name prefix, tag contains, name
 *      contains, then most recently active. Render in the order received; re-sorting throws it away.
 *   3. **There are no wildcards.** Matching uses `strpos`, not `LIKE`, so `%` and `_` are ordinary
 *      characters that match nothing. Nothing needs escaping.
 */
export function searchClans(query: string, limit = 10): Promise<ClanResult<ClanPublic[]>> {
    const needle = (query || '').trim();
    if (!needle) return Promise.resolve(ok<ClanPublic[]>([]));
    return withClient(async client => {
        const result = await callRpc<ClanPublic[] | null>(client, 'search_clans', {
            p_query: needle,
            p_limit: limit,
        });
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Membership lifecycle
 * ------------------------------------------------------------------------------------------ */

/**
 * `create_clan(p_name text, p_tag text, p_profile_id uuid, p_join_policy text DEFAULT 'invite')
 *  RETURNS jsonb`
 *
 * Creates the clan, the owner membership, the empty shared tree and the auto-generated join
 * password in one transaction, and returns all of it **including the password**. That response is
 * the only one in the schema that carries it: show it once, do not log it, and read it back from
 * `clan_secrets` afterwards.
 *
 * `name-or-tag-taken` (23505) is the expected failure and it doubles as the one existence oracle
 * in the schema (0003 §3d) — that is a known, accepted trade, not something the client can fix.
 */
export function createClan(params: {
    name: string;
    tag: string;
    profileId: string;
    joinPolicy?: ClanJoinPolicy;
}): Promise<ClanResult<CreatedClan>> {
    return withClient(client =>
        callRpc<CreatedClan>(client, 'create_clan', {
            p_name: params.name,
            p_tag: params.tag,
            p_profile_id: params.profileId,
            p_join_policy: params.joinPolicy ?? 'invite',
        }),
    );
}

/**
 * `join_clan(p_name text, p_tag text, p_password text, p_profile_id uuid) RETURNS jsonb`
 *
 * **Read `.status`, do not rely on `try/catch`.** `ok: true` covers all four outcomes, including
 * the two that mean "you did not get in":
 *
 *   `joined` / `requested`  — you are in, or a leader has to approve you.
 *   `failed`                — one of: no such clan, wrong tag, wrong password. Which one is not
 *                             knowable and the UI must not guess: show one neutral message.
 *   `rate_limited`          — 12 attempts per 10 minutes, per account, and the password was NOT
 *                             evaluated, so a correct password gets this too. Disable the button
 *                             for `retry_after_seconds` (<= 600, and hammering does not extend it).
 *
 * `ok: false` is reserved for the genuine impossibilities that still raise: `not-signed-in`,
 * `not-your-profile`, `already-in-a-clan`, `clan-full`.
 */
export function joinClan(params: {
    name: string;
    tag: string;
    password: string;
    profileId: string;
}): Promise<ClanResult<JoinClanOutcome>> {
    return withClient(client =>
        callRpc<JoinClanOutcome>(client, 'join_clan', {
            p_name: params.name,
            p_tag: params.tag,
            p_password: params.password,
            p_profile_id: params.profileId,
        }),
    );
}

/**
 * `leave_clan(p_profile_id uuid) RETURNS void`
 *
 * Anyone may leave at any time — except an owner who is not alone, who gets
 * `needs-owner-transfer` until they call `transferOwnership()`. The **sole** member of a clan takes
 * the clan with them (there is nobody to transfer to), which cascades the tree, the secret and the
 * membership.
 */
export function leaveClan(profileId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'leave_clan', { p_profile_id: profileId });
        return result.ok ? ok(null) : result;
    });
}

/**
 * `kick_member(p_clan_id uuid, p_profile_id uuid) RETURNS void`
 *
 * The hierarchy, enforced server-side and mirrored by `canKick()` in `ClanContext`: the owner
 * removes anyone but themself (admins included); an admin removes members only; the owner can
 * never be kicked. Removing your own profile is `leaveClan()` — it is the only path that handles
 * the last-owner rule — and asking to kick yourself comes back as `invalid-input`.
 */
export function kickMember(clanId: string, profileId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'kick_member', {
            p_clan_id: clanId,
            p_profile_id: profileId,
        });
        return result.ok ? ok(null) : result;
    });
}

/**
 * `transfer_ownership(p_clan_id uuid, p_to_profile_id uuid) RETURNS void`
 *
 * Owner only. The new owner is promoted first so the clan is never ownerless mid-statement, then
 * the previous owner becomes `admin`.
 */
export function transferOwnership(clanId: string, toProfileId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'transfer_ownership', {
            p_clan_id: clanId,
            p_to_profile_id: toProfileId,
        });
        return result.ok ? ok(null) : result;
    });
}

/**
 * `set_member_role(p_clan_id uuid, p_profile_id uuid, p_role text) RETURNS void`
 *
 * OWNER ONLY, and only between `admin` and `member` — `owner` is refused with `invalid-input`
 * because promoting to owner is `transferOwnership()`, which also demotes the previous one.
 */
export function setMemberRole(
    clanId: string,
    profileId: string,
    role: 'admin' | 'member',
): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'set_member_role', {
            p_clan_id: clanId,
            p_profile_id: profileId,
            p_role: role,
        });
        return result.ok ? ok(null) : result;
    });
}

/** `approve_clan_request(p_clan_id uuid, p_profile_id uuid) RETURNS void` — leaders only. */
export function approveClanRequest(clanId: string, profileId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'approve_clan_request', {
            p_clan_id: clanId,
            p_profile_id: profileId,
        });
        return result.ok ? ok(null) : result;
    });
}

/** `deny_clan_request(p_clan_id uuid, p_profile_id uuid) RETURNS void` — leaders only. */
export function denyClanRequest(clanId: string, profileId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'deny_clan_request', {
            p_clan_id: clanId,
            p_profile_id: profileId,
        });
        return result.ok ? ok(null) : result;
    });
}

/**
 * Deletes the clan. **Owner only, and enforced by RLS rather than by an RPC** — `clans_delete_owner`
 * is `using (clan_role(id) = 'owner')`.
 *
 * That makes the failure mode unusual and worth spelling out: RLS does not raise, it filters. A
 * member's DELETE matches no row and Postgres reports success with zero rows affected (measured).
 * So the row is asked for back with `.select('id')` and an empty result is reported as
 * `not-a-leader` — otherwise the UI would cheerfully claim the clan was deleted.
 */
export function deleteClan(clanId: string): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await runQuery<{ id: string }[] | null>(
            table(client, 'clans').delete().eq('id', clanId).select('id'),
        );
        if (!result.ok) return result;
        if (!result.data || result.data.length === 0) {
            return fail<null>({
                kind: 'not-a-leader',
                message: 'Only the clan owner can delete the clan.',
            });
        }
        return ok(null);
    });
}

/**
 * Renames a clan / changes its policy, cap or tier. **OWNER ONLY, and RPC-only since 0008.**
 *
 * `set_clan_settings(p_clan_id uuid, p_name text default null, p_tag text default null,
 *  p_join_policy text default null, p_member_cap int default null, p_tier text default null)
 *  RETURNS jsonb`
 *
 * 0011 added the sixth argument, and it dropped the five-argument overload before recreating the
 * function rather than leaving both in place: PostgREST calls by NAME, so two candidates make the
 * already-deployed five-argument call ambiguous and it fails with `42725  is not unique` on a call
 * that never mentioned the tier. There is exactly one `set_clan_settings` and it takes six
 * arguments; omitting `p_tier` still means "leave the tier alone".
 *
 * This used to PATCH `clans` directly — 0001 granted `UPDATE (name, tag, join_policy, member_cap)`
 * to `authenticated` and the policy `clans_update_admin` admitted owner *and admin*. 0008 closed
 * that: it revoked UPDATE (and INSERT) on **every** column of `clans` from every client role and
 * narrowed the policy to the owner, so the old statement now answers
 * `42501 permission denied for table clans` for everybody — the owner included. The RPC is the only
 * write path, exactly like `setClanBadge()`.
 *
 * `undefined` fields are simply not sent, and a missing argument means "leave unchanged" on the
 * server. For the first four settings that is the whole story — they are NOT NULL columns, so "set
 * it to null" was never a request anyone could make. `tier` is different: it is nullable, so
 * `tier: null` in the patch is a real request ("clear it back to not set") and is sent as the empty
 * string, which is the sentinel 0011 chose for exactly this. `tier: undefined` still means "leave
 * it alone". An empty patch is refused HERE, before the round trip; the RPC would answer
 * `22023 nothing to change`.
 *
 * The zero-row caveat that used to live here is GONE, and that is the point: the RPC raises, so
 * every refusal arrives as a code instead of as "success, 0 rows".
 *
 *   * `42501 only the clan owner can change the clan settings` -> `not-a-leader`. An **admin** now
 *     lands here too — that is the deviation 0008 closed — and so does a stranger and a caller
 *     naming a clan that does not exist (the RPC is deliberately not an existence oracle).
 *     No session at all is `42501 authentication required` -> `not-signed-in`.
 *   * `22023` -> `invalid-input`: a `join_policy` outside invite/request, a `member_cap` outside
 *     1..50, or — new in 0008 — a cap BELOW the clan's current member count, which would leave the
 *     clan permanently "full".
 *   * `23514` from `clans_name_check` / `clans_tag_check` -> `invalid-input` (shape of name/tag).
 *   * `23505` -> `name-or-tag-taken`, the same collision `createClan()` reports.
 *   * `P0002` -> `not-found`.
 *
 *   * `22023 clan tier must be one of ` -> `invalid-input`. The RPC answers this rather than
 *     letting `clans_tier_chk` report a bare `23514` with a constraint name, precisely so a client
 *     built against a config the server has not caught up with can learn what went wrong.
 *
 * The return shape is unchanged — `ClanResult<ClanRow>` carrying the updated row — because
 * `to_jsonb(clans)` is every column `CLAN_COLUMNS` names, `tier` included, and `clans` has no
 * secret column by design (0003 moved the password to `clan_secrets`).
 */
export function updateClan(
    clanId: string,
    patch: {
        name?: string;
        tag?: string;
        joinPolicy?: ClanJoinPolicy;
        memberCap?: number;
        /** A tier to record, or `null` to clear it back to "not set". Omit to leave it alone. */
        tier?: ClanTier | null;
    },
): Promise<ClanResult<ClanRow>> {
    const args: Record<string, unknown> = { p_clan_id: clanId };
    if (patch.name !== undefined) args.p_name = patch.name;
    if (patch.tag !== undefined) args.p_tag = patch.tag;
    if (patch.joinPolicy !== undefined) args.p_join_policy = patch.joinPolicy;
    if (patch.memberCap !== undefined) args.p_member_cap = patch.memberCap;
    // `null` is a request, not an omission: it is sent as 0011's clear sentinel. `undefined` is the
    // omission, and it never reaches the wire.
    if (patch.tier !== undefined) args.p_tier = patch.tier === null ? CLAN_TIER_CLEAR : patch.tier;

    // 1 = just p_clan_id, i.e. the caller asked for no change at all.
    if (Object.keys(args).length === 1) {
        return Promise.resolve(fail<ClanRow>({ kind: 'invalid-input', message: 'Nothing to change.' }));
    }

    return withClient(async client => {
        const result = await callRpc<ClanRow | null>(client, 'set_clan_settings', args);
        if (!result.ok) return result;
        if (!result.data) {
            // Unreachable: the function either returns the row or raises. Kept because handing a
            // null on as a `ClanRow` would put `undefined` into every field the UI then renders.
            return fail<ClanRow>({
                kind: 'unknown',
                message: 'The server did not send the updated clan back. Refresh to see what changed.',
            });
        }
        return ok(result.data);
    });
}

/**
 * Record (or clear) the clan's guild tier. **OWNER ONLY** — the same door and the same refusal as
 * every other clan setting, because 0011 deliberately extended `set_clan_settings()` instead of
 * adding a second write path that could drift out of step with 0008's authorisation.
 *
 * `null` clears the tier back to "not set". That is a real state and not a failure: a clan whose
 * leader has never opened this control has no tier, and saying so is the honest answer. The
 * alternative — showing tier E's numbers — would tell a top-tier clan that losing a war GAINS them
 * points when it in fact costs them five.
 *
 * **This is a statement, not an enforcement.** Nothing in this app can read the game, so the value
 * is whatever a human typed after looking at their guild screen; it does not move when a war is won
 * or lost, and it changes nothing in game. The screens that show it have to say so.
 *
 * A key the SERVER will not accept is refused here rather than spending a round trip, because there
 * is one way to reach it that is not a bug: a game config newer than the deployed schema, offering a
 * tier `clans_tier_chk` has never heard of. The message names that situation instead of blaming the
 * user for a value they picked out of a list this app gave them.
 */
export function setClanTier(clanId: string, tier: ClanTier | null): Promise<ClanResult<ClanRow>> {
    if (tier !== null && !isClanTier(tier)) {
        return Promise.resolve(
            fail<ClanRow>({
                kind: 'invalid-input',
                message: `The server does not know a tier called "${String(tier)}". Your game config is newer than the clan server; the tier can be recorded once the server catches up.`,
            }),
        );
    }
    return updateClan(clanId, { tier });
}

/* ------------------------------------------------------------------------------------------ *
 * The join password
 * ------------------------------------------------------------------------------------------ */

/**
 * `set_join_password(p_clan_id uuid, p_password text) RETURNS void`
 *
 * Leaders only, 12..64 printable characters (the input is trimmed server-side; stored passwords
 * never carry edge whitespace). The length is checked here too so a form can say so without
 * spending a round trip — but the function is the enforcement.
 */
export function setJoinPassword(clanId: string, password: string): Promise<ClanResult<null>> {
    const trimmed = (password || '').trim();
    if (trimmed.length < JOIN_PASSWORD_MIN_LENGTH || trimmed.length > JOIN_PASSWORD_MAX_LENGTH) {
        return Promise.resolve(
            fail<null>({
                kind: 'invalid-input',
                message: `The join password must be ${JOIN_PASSWORD_MIN_LENGTH}-${JOIN_PASSWORD_MAX_LENGTH} characters.`,
            }),
        );
    }
    return withClient(async client => {
        const result = await callRpc<null>(client, 'set_join_password', {
            p_clan_id: clanId,
            p_password: trimmed,
        });
        return result.ok ? ok(null) : result;
    });
}

/**
 * `generate_join_password(p_clan_id uuid) RETURNS text`
 *
 * Leaders only. Replaces the password with a fresh crypto-random 12-character one and returns it —
 * **the old one stops working immediately**, so the UI has to make that consequence obvious before
 * calling. Do not log the return value.
 */
export function generateJoinPassword(clanId: string): Promise<ClanResult<string>> {
    return withClient(client => callRpc<string>(client, 'generate_join_password', { p_clan_id: clanId }));
}

/* ------------------------------------------------------------------------------------------ *
 * The badge
 * ------------------------------------------------------------------------------------------ */

/**
 * `set_clan_badge(p_clan_id uuid, p_shape int, p_shape_color int, p_icon int, p_icon_color int)
 *  RETURNS void`
 *
 * Leaders only, and RPC-only: `authenticated` holds no column UPDATE on `clans.badge_*`, so
 * neither the role check nor the ranges can be sidestepped by a direct PATCH.
 *
 * The two colour columns do NOT share a domain (0006): `shapeColor` is a **Background** ColorId
 * `0..6` and `iconColor` is a **Foreground** ColorId `7..8`, both from `GuildEmblemColors.json`.
 * `<ClanBadgePicker>` already only offers legal values; a stale caller gets `invalid-input`.
 */
export function setClanBadge(clanId: string, badge: ClanBadge): Promise<ClanResult<null>> {
    return withClient(async client => {
        const result = await callRpc<null>(client, 'set_clan_badge', {
            p_clan_id: clanId,
            p_shape: badge.shape,
            p_shape_color: badge.shapeColor,
            p_icon: badge.icon,
            p_icon_color: badge.iconColor,
        });
        return result.ok ? ok(null) : result;
    });
}

/** The four `badge_*` columns of a clan (or a `clan_public` row) as the shared `ClanBadge` type. */
export function badgeOf(row: {
    badge_shape: number;
    badge_shape_color: number;
    badge_icon: number;
    badge_icon_color: number;
}): ClanBadge {
    return {
        shape: row.badge_shape,
        shapeColor: row.badge_shape_color,
        icon: row.badge_icon,
        iconColor: row.badge_icon_color,
    };
}

/* ------------------------------------------------------------------------------------------ *
 * The shared clan tree
 * ------------------------------------------------------------------------------------------ */

/**
 * `set_clan_tree(p_clan_id uuid, p_levels jsonb) RETURNS clan_tree`
 *
 * **Leaders only, and the only write path there is.** `authenticated` holds no INSERT or UPDATE
 * privilege on `clan_tree` (verified: `SELECT, DELETE` and nothing else), so the RPC's
 * normalisation cannot be skipped: it strips levels <= 0, requires numeric globalId keys and
 * integer levels 1..999, and caps the node count.
 *
 * A plain member calling this gets `not-a-leader` (42501). That is the enforcement — the hidden
 * steppers in the UI are a courtesy on top of it.
 */
export function setClanTree(
    clanId: string,
    levels: Record<string, number>,
): Promise<ClanResult<ClanTreeRow>> {
    return withClient(client =>
        callRpc<ClanTreeRow>(client, 'set_clan_tree', { p_clan_id: clanId, p_levels: levels }),
    );
}

/* ------------------------------------------------------------------------------------------ *
 * The shared per-member summary
 * ------------------------------------------------------------------------------------------ */

/** Encoded byte size of a share document — what the 16 KB trigger actually measures. */
export function clanShareByteSize(share: ClanShare): number {
    const json = JSON.stringify(share);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
    // Node/test fallback: JSON of a share is ASCII apart from a profile name, so length is close
    // enough for a guard whose only job is to stay under a 7x-headroom ceiling.
    return json.length;
}

export interface PublishShareResult {
    /**
     * `profiles.version` AFTER the write. It matters: `profiles_touch` bumps the version on every
     * update, including this one, so the sync engine's `where version = <last seen>` would miss and
     * raise its conflict UX for a row nobody actually edited. The caller is expected to carry this
     * number into `syncLedger` (see `ClanContext`), which is why it is returned rather than dropped.
     */
    version: number;
}

/**
 * Publishes (or refreshes) the calling profile's clan summary.
 *
 * There is no RPC: 0005 §4 chose a column on `profiles` because it has exactly the profile's
 * lifecycle and exactly the same RLS answer ("your own rows"), and `profiles_update_own` already
 * confines the write to its owner. Clan mates read it through `clan_roster_detail`; nothing else
 * can see it, and `profiles.body` is never exposed by anything.
 *
 * Two guards before the round trip:
 *   * the 16 KB ceiling is measured locally and refused as `too-large`, so the UI can say what to
 *     do instead of surfacing a `22023` with a byte count in it;
 *   * `expectedVersion`, when given, makes the write conditional and a no-match becomes
 *     `version-conflict` instead of silently overwriting a newer row. Without it the write is
 *     last-one-wins, which is correct for a summary that is recomputed from scratch every time.
 *
 * A missing row (`not-found`) means this profile has never been synced to the account. That is not
 * an error to shout about: publish again after the next sync.
 */
export function publishClanShare(
    profileId: string,
    share: ClanShare,
    options?: { expectedVersion?: number },
): Promise<ClanResult<PublishShareResult>> {
    const size = clanShareByteSize(share);
    if (size > CLAN_SHARE_MAX_BYTES) {
        return Promise.resolve(
            fail<PublishShareResult>({
                kind: 'too-large',
                message: 'Your clan summary is too big to publish (the limit is 16 KB). Nothing was sent.',
                raw: `clan_share would be ${size} bytes, limit ${CLAN_SHARE_MAX_BYTES}`,
            }),
        );
    }
    return writeClanShare(profileId, share, options?.expectedVersion);
}

/**
 * Stops sharing: `clan_share = null`.
 *
 * Leaving a clan does not clear it server-side (the row is its owner's data, and losing the
 * membership already removes it from every clan mate's view, because the view joins through
 * `clan_members`). The client should still call this on leave, as hygiene.
 */
export function clearClanShare(
    profileId: string,
    options?: { expectedVersion?: number },
): Promise<ClanResult<PublishShareResult>> {
    return writeClanShare(profileId, null, options?.expectedVersion);
}

function writeClanShare(
    profileId: string,
    share: ClanShare | null,
    expectedVersion?: number,
): Promise<ClanResult<PublishShareResult>> {
    return withClient(async client => {
        let builder = table(client, 'profiles').update({ clan_share: share }).eq('id', profileId);
        if (typeof expectedVersion === 'number') builder = builder.eq('version', expectedVersion);

        const result = await runQuery<{ id: string; version: number } | null>(
            builder.select('id,version').maybeSingle(),
        );
        if (!result.ok) return result;
        if (!result.data) {
            return typeof expectedVersion === 'number'
                ? fail<PublishShareResult>({
                    kind: 'version-conflict',
                    message: 'That profile changed while the summary was being published. It will be republished on the next update.',
                })
                : fail<PublishShareResult>({
                    kind: 'not-found',
                    message: 'This profile is not on your account yet. It will publish to the clan after the next sync.',
                });
        }
        return ok({ version: Number(result.data.version) });
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Realtime
 * ------------------------------------------------------------------------------------------ */

export interface ClanRealtimeHandlers {
    /** Somebody joined, left, or had their role changed. */
    onMembersChange?: () => void;
    /** A leader wrote the shared tree. */
    onTreeChange?: () => void;
    /** Channel lifecycle, for a "live" indicator. `SUBSCRIBED`, `CLOSED`, `CHANNEL_ERROR`,  */
    onStatus?: (status: string) => void;
}

/**
 * Subscribes to the two tables that are in the Realtime publication — **and only those two**.
 *
 * 0001 §9 added `clan_members` and `clan_tree`; 0003 §10 asserts `clan_secrets` is absent (a
 * password has no business on a websocket) and 0005 §7 removes `clans` and `profiles` (`clans`
 * carries an `activity_at` that changes every five minutes for every active clan, and `profiles`
 * carries `body` and `clan_share`). Verified against `pg_publication_tables`: exactly two tables.
 * So a clan rename, a badge change or a mate's new summary do NOT arrive live — refetch on focus,
 * on a membership event, or when the user asks.
 *
 * The handlers get no payload on purpose. A `postgres_changes` event for `clan_members` carries one
 * row, and reconstructing a roster from row deltas means reimplementing the view's join (it also
 * carries the *old* row on DELETE because both tables are `replica identity full`). Refetching the
 * roster is one small request and cannot drift.
 *
 * Returns the unsubscriber synchronously even though obtaining a client is async: calling it before
 * the channel exists cancels the subscription instead of leaking it. **Call it on unmount and on
 * every clan/profile switch** — one leaked channel per profile switch is a real bug.
 */
export function subscribeToClan(clanId: string, handlers: ClanRealtimeHandlers): () => void {
    let cancelled = false;
    let channel: RealtimeChannelLike | null = null;
    let client: SupabaseClient | null = null;

    void (async () => {
        client = await getSupabaseClient();
        if (!client || cancelled) return;

        try {
            const api = client as unknown as { channel: (name: string) => RealtimeChannelLike };

            // ONE channel for both tables: two topics would mean two websocket subscriptions for
            // one screen, and their events would interleave unpredictably.
            channel = api
                .channel(`clan:${clanId}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'clan_members', filter: `clan_id=eq.${clanId}` },
                    () => handlers.onMembersChange?.(),
                )
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'clan_tree', filter: `clan_id=eq.${clanId}` },
                    () => handlers.onTreeChange?.(),
                )
                .subscribe(status => handlers.onStatus?.(status));

            // A disposer that ran while the client chunk was still loading must still take effect.
            if (cancelled) removeChannel(client, channel);
        } catch {
            // Realtime is an enhancement: a websocket that cannot be opened must not break a screen
            // whose data has already been fetched.
            handlers.onStatus?.('CHANNEL_ERROR');
        }
    })();

    return () => {
        cancelled = true;
        if (client && channel) removeChannel(client, channel);
        channel = null;
    };
}

/** The slice of `RealtimeChannel` used above. Declared locally so nothing imports the package. */
interface RealtimeChannelLike {
    on: (
        type: string,
        filter: Record<string, unknown>,
        callback: (payload: unknown) => void,
    ) => RealtimeChannelLike;
    subscribe: (callback?: (status: string) => void) => RealtimeChannelLike;
    unsubscribe?: () => void;
}

function removeChannel(client: SupabaseClient, channel: RealtimeChannelLike): void {
    try {
        const api = client as unknown as { removeChannel?: (c: unknown) => unknown };
        if (api.removeChannel) api.removeChannel(channel);
        else channel.unsubscribe?.();
    } catch {
        // Already closed, or the socket is gone. Nothing left to release.
    }
}
