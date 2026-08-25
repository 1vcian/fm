/**
 * warPlanApi — every war-plan call the client can make, and nothing else.
 * =======================================================================
 *
 * The sibling of `clanApi`, for the day-5 attacks planner. Same contract, same shape, and it is
 * the ONLY place in the app that names a `clan_war_*` table, view or RPC. Pure TypeScript: no
 * React, no state, no timers.
 *
 * Every wrapper below was checked against `pg_get_function_arguments()` / `pg_get_function_result()`
 * on a throwaway PostgreSQL 14.16 cluster carrying the Supabase shim plus 0001+0003+0004+0005+0006
 * +0007+0008+0009, and the real signature is quoted above each one. That matters more here than
 * anywhere else in the codebase, because PostgREST sends RPC arguments **by name**: `p_planId`
 * instead of `p_plan_id` is not a type error and not a runtime error either, it is a silent
 * `PGRST202 function not found`.
 *
 * NOTHING THROWS. Every export resolves to `{ ok: true, data }` or `{ ok: false, error }`, and no
 * raw Postgres string ever reaches a `WarPlanError.message` — the raw text is parked on `.raw` for
 * a `console.debug` and carries plan uuids, participant uuids and constraint names.
 *
 *
 * ONE TAXONOMY, WIDENED BY EXACTLY TWO MEMBERS
 * --------------------------------------------
 * `WarPlanErrorKind` is `ClanErrorKind` plus `roster-full` and `duplicate-name`, and
 * `classifyWarPlanError()` delegates to `clanApi.classifyError()` for everything it does not
 * recognise. There is therefore still exactly ONE mapping of SQLSTATE to meaning in this codebase.
 * The two additions are not decoration; they are two different things a leader must DO:
 *
 *   `roster-full`     the ally or enemy side of THIS PLAN holds 50. Remove someone, or stop adding.
 *   `duplicate-name`  that name is already on that side of this plan. Type a different one.
 *
 * Both would otherwise be mapped wrong rather than vaguely, which is why the override exists at
 * all. Measured on the harness:
 *
 *   * `set_war_participant()` past 50 raises `54000 enemy roster is full (50 is the game's
 *     MaxGuildMemberCount)`. `clanApi.classifyError()`'s 54000 branch tests `message.includes('is
 *     full')` and would answer `clan-full` / **"That clan is full."** — a sentence about the wrong
 *     object entirely, telling the leader their 3-member clan is full.
 *   * a duplicate name raises `23505`, which `classifyError()` maps to `name-or-tag-taken` /
 *     **"A clan with that name and tag already exists. Pick another one."** — again about the clan.
 *
 * AND ONE PLACE 0009 LEAKS A RAW POSTGRES MESSAGE, WHICH THIS MODULE HAS TO CATCH. The INSERT path
 * of `set_war_participant()` wraps `unique_violation` and re-raises a sentence a human wrote. The
 * UPDATE path (i.e. RENAMING a participant) does not, so renaming an enemy onto a name that is
 * already taken comes back as, verbatim and measured:
 *
 *     23505  duplicate key value violates unique constraint "clan_war_participants_name_key"
 *
 * `classifyWarPlanError()` therefore matches the CONSTRAINT NAME as well as the friendly sentence.
 * Without that, the one gesture the owner asked for by name — renaming an enemy dummy — is the one
 * gesture that puts a Postgres constraint name on screen.
 *
 *
 * WHAT 0009 DOES NOT GIVE US, STATED HERE SO NOBODY LOOKS FOR IT
 * -------------------------------------------------------------
 * 1. **NO BATCH-CREATE RPC.** The owner asked to "create them in batch by choosing the number of
 *    users", and there is no such function: `set_war_participant()` inserts exactly one row.
 *    `createEnemyDummies()` below is therefore a CLIENT loop of N calls, capped, with a single
 *    name-collision-avoiding read in front of it. It is honest about that in its return value.
 * 2. **NO COMPARE-AND-SWAP.** Not one war RPC takes an expected-revision argument, so the database
 *    cannot refuse a stale write. See "CONCURRENCY" below for what is done instead.
 * 3. **NULL MEANS UNCHANGED EVERYWHERE, SO NOTHING CAN BE CLEARED.** Measured: calling
 *    `set_war_participant(..., p_attacks_budget => null, p_note => null)` on a row holding `7` and
 *    `'tank'` leaves it holding `7` and `'tank'`. The same is true of every nullable column on
 *    `upsert_clan_war_plan()`. There is no sentinel and no "unset" RPC, so a leader cannot take a
 *    per-player attack override back off, and cannot delete a note. The wrappers below expose only
 *    what is really possible, rather than accepting an `undefined` that would silently do nothing.
 * 4. **AN EMPTY STRING IS NOT "CLEAR", IT IS A CONSTRAINT VIOLATION.** Measured:
 *    `upsert_clan_war_plan(clan, p_opponent_name => '')` dies with
 *    `23514 ... violates check constraint "clan_war_plans_opponent_name_check"` — a raw message,
 *    because the CHECK is reached before the ON CONFLICT branch. So every text argument here is
 *    trimmed and DROPPED when it comes out empty; `''` is never put on the wire.
 * 5. **NO REALTIME.** 0009 deliberately adds nothing to the publication and says so. Verified
 *    structurally: 0001 §9 adds `clan_tree` and `clan_members`, 0003 and 0005 only ever REMOVE
 *    tables, and no migration mentions `clan_war_*` and `supabase_realtime` in the same statement.
 *    A `postgres_changes` subscription on the war tables would therefore be a websocket that
 *    delivers silence — and it would spend one of the free plan's 200 concurrent connections to do
 *    it, on top of the one `subscribeToClan()` already holds per signed-in member. There is no
 *    `subscribeToWarPlan()` in this module on purpose.
 * 6. **NO PER-KIND PUSH PREFERENCE.** `broadcast_clan_notification()` fans out to
 *    `select distinct user_id from clan_members` with no filter, and `push_subscriptions` has no
 *    preference column (measured column list: id, user_id, endpoint, p256dh, auth_secret,
 *    vapid_public_key, user_agent, created_at, last_ok_at, fail_count, expired_at,
 *    expired_reason). So "only those who have notifications enabled THERE will get it" cannot be
 *    honoured by any client code: the row is queued for every account in the clan and the sender
 *    pushes it to every live device. `WAR_PUSH_OPT_OUT_IS_SERVER_SIDE` is exported as `false` so a
 *    surface can say so out loud instead of drawing a switch that does nothing.
 *
 *
 * CONCURRENCY: WHAT THE DATABASE MAKES ATOMIC, AND WHAT IT DOES NOT
 * ----------------------------------------------------------------
 * `clan_war_plans.revision` looks like the answer and is not. It is bumped by `touch_war_plan()` on
 * every UPDATE **of the plan header**, and measured on the harness: eight participant inserts, one
 * rename and four assignment writes left `revision` at 1 and `updated_at` untouched. Publishing
 * moved it (1 -> 2 -> 3), because publishing updates the header. So `revision` versions the HEADER,
 * never the board.
 *
 * What 0009 does give, free, is that the write RPCs are already scoped narrowly enough that
 * DISJOINT edits merge instead of clobbering:
 *
 *   * `upsert_clan_war_plan()` is a null-means-unchanged patch, so two leaders editing two
 *     different header fields both land, in either order.
 *   * `set_war_assignments(attacker, targets)` replaces exactly ONE attacker's rows, so two leaders
 *     dragging targets onto two different players never touch each other's work.
 *   * `set_war_participant()`'s update branch is a null-means-unchanged patch on one row.
 *
 * The residual conflict surface is therefore small and nameable: the same header FIELD, the same
 * participant ROW, or the same attacker's ORDERS. For those three, and only those three, every
 * write here accepts an optional precondition and verifies it with ONE narrow read taken
 * immediately before the write; a mismatch returns `version-conflict` and writes NOTHING.
 *
 *   `saveWarPlan(..., { expectedRevision })`            -> reads `clan_war_plans.revision`
 *   `updateWarParticipant(..., { expectedUpdatedAt })`  -> reads `clan_war_participants.updated_at`
 *   `setAttackerOrders(..., { expectedAssignmentIds })` -> reads that attacker's assignment ids
 *
 * THE HONEST LIMIT: check-then-write is not compare-and-swap. The race window is one round trip
 * wide, and two leaders who press save inside the same ~100 ms still resolve last-one-wins. Closing
 * it properly needs an `p_expected_revision` argument on the three RPCs, which is a migration and
 * not client code. What this buys instead is the case that actually happens — a leader who opened
 * the board five minutes ago and is about to overwrite work done since — and it buys it without a
 * websocket. Omitting the precondition is last-one-wins, which is the right default for a leader
 * who loaded the row a second ago.
 *
 * `warBoardStamp()` is the cheap "did anything at all move?" test on top of that: one short hash
 * over the header revision plus every participant and assignment identity the caller already
 * holds. Compare the stamp from before a `loadWarBoard()` with the one after and you know whether
 * to warn. It needs no column 0009 does not have.
 *
 *
 * WHAT A FULL BOARD COSTS
 * -----------------------
 * `loadWarBoard()` is **one HTTP request** when PostgREST resolves the embedded selects, and
 * **three requests over two round trips** on the fallback (the plan, then participants and
 * assignments in parallel). Either way it is O(1) in the size of the clan and of the rosters — it
 * is never one request per member, and it never fetches `clan_roster_detail` (~117 KB for a full
 * clan) to draw a board.
 *
 * The single-request path asks for `clan_war_plans?select=,clan_war_participants(),
 * clan_war_assignments()`. Both embeds are unambiguous: measured with `pg_get_constraintdef`,
 * each child table has exactly ONE foreign key to `clan_war_plans`
 * (`clan_war_participants_plan_fkey` and `clan_war_assignments_plan_fkey`, both composite on
 * `(plan_id, clan_id) -> (id, clan_id)`), so PostgREST has one relationship to choose from in each
 * direction. The two FKs from assignments to participants are never embedded here, precisely
 * because THOSE are ambiguous (attacker and target) and would need a constraint-name hint.
 *
 * The fallback exists because the FK metadata is what could be verified locally and PostgREST's
 * answer is not: no PostgREST and no Docker on the machine this was written on. So if the server
 * replies `PGRST200 could not find a relationship`, this module remembers that for the session and
 * goes straight to the three-request path from then on. It is a real code path, not a comment.
 *
 *
 * WHO MAY DO WHAT
 * ---------------
 * Leaders (owner + admin) alone write. Enforced twice in the database and re-measured here: a
 * plain member calling `set_war_participant()` gets `42501 only the clan owner or an admin can
 * change the war plan`, and a plain member's direct `UPDATE` on `clan_war_participants` gets
 * `42501 permission denied for table clan_war_participants` because `authenticated` holds SELECT
 * and nothing else on all four war objects. This module never issues a direct write to a war table
 * for that reason — every write is an RPC.
 *
 * Members read their own clan's plan, and only once it is PUBLISHED. Measured: while the plan was
 * a draft, the plain member's `select count(*)` answered 0 plans / 0 participants / 0 assignments /
 * 0 sheet rows; after `publish_clan_war_plan()` the same reads answered 1 / 54 / 4 / 6; a stranger
 * saw 0 throughout. So a member's `loadWarBoard()` returning `null` is the NORMAL answer for "the
 * leaders have not published this week yet" and must be rendered as such, never as an error.
 */

import { getSupabaseClient } from './supabaseClient';
import type { SupabaseClient } from './supabaseClient';
// The taxonomy is imported, not re-invented: one mapping of SQLSTATE to meaning for the whole app.
import { classifyError, type ClanError, type ClanErrorKind } from './clanApi';

/* ------------------------------------------------------------------------------------------ *
 * Limits — mirrored from 0009 and from the game, enforced by the database
 * ------------------------------------------------------------------------------------------ */

/**
 * `max_per_side` in `set_war_participant()`, which is `GuildBaseConfig.MaxGuildMemberCount`. Past
 * it the RPC raises 54000. Duplicated here only so a form can stop before spending a round trip.
 */
export const WAR_ROSTER_MAX_PER_SIDE = 50;

/** `max_slots` in `set_war_assignments()`, and `clan_war_assignments.slot between 1 and 20`. */
export const WAR_MAX_SLOTS_PER_ATTACKER = 20;

/** `clan_war_participants.display_name`: `char_length(btrim(...)) between 1 and 32`. */
export const WAR_NAME_MAX_LENGTH = 32;
/** `clan_war_participants.note` and `clan_war_assignments.note`. */
export const WAR_NOTE_MAX_LENGTH = 200;
/** `clan_war_plans.notes`. */
export const WAR_PLAN_NOTES_MAX_LENGTH = 2000;
/** `clan_war_plans.opponent_name` / `opponent_tag`. Note the tag is 8, not the clan tag's 5. */
export const WAR_OPPONENT_NAME_MAX_LENGTH = 32;
export const WAR_OPPONENT_TAG_MAX_LENGTH = 8;

/**
 * `clan_war_plans.attacks_per_player` default, from `GuildWarConfig.MaxWarTicketsPerMember`.
 *
 * 0009 says at length why this is probably WRONG (`ShopResourcesLibrary.TokenPack0` grants 8 free
 * `Token` a day and the app maps `Token -> WarTicket`), which is exactly why the column is
 * leader-editable. Do not present it as a fact from the game.
 */
export const WAR_ATTACKS_PER_PLAYER_DEFAULT = 5;

/**
 * How many enemy dummies one `createEnemyDummies()` call will make.
 *
 * The ceiling is the roster's own 50, and this is lower than nothing else: it exists because the
 * batch is N SEPARATE round trips (0009 has no batch RPC), so a mistyped "500" would be 500
 * requests before the server's own limit stopped it at 50 refusals. 50 is the most that can ever
 * succeed, so it is the most that is ever attempted.
 */
export const WAR_ENEMY_BATCH_MAX = WAR_ROSTER_MAX_PER_SIDE;

/**
 * The one host a war notification may lead to, pinned by `assert_push_payload()` in the database.
 *
 * A broadcast is LEADER-AUTHORED text delivered to up to 50 devices, so the destination is not
 * author-controlled: `notifyClan()` below builds the URL from this constant and a route it
 * validates itself, and there is deliberately no parameter that accepts a whole URL.
 */
export const WAR_PUSH_BASE_URL = 'https://1vcian.me/fm/';

/**
 * Can a member opt OUT of war broadcasts on the server? **No, and this is measured, not assumed.**
 *
 * `broadcast_clan_notification()` inserts one queue row per `distinct user_id` in `clan_members`
 * with no preference test, and `push_subscriptions` carries no per-kind column. So a member who
 * turns war notifications "off" anywhere in this app is not describing anything the server can
 * act on. A surface must either not offer the switch, or say plainly that it is not in effect yet.
 * Flip this to `true` in the same commit as the migration that adds the column and the `where`.
 */
export const WAR_PUSH_OPT_OUT_IS_SERVER_SIDE = false;

/* ------------------------------------------------------------------------------------------ *
 * Row shapes — each one is the real column list, in the real order
 * ------------------------------------------------------------------------------------------ */

/** `clan_war_participants.side`. An enemy is structurally a dummy (0009 §6.2). */
export type WarSide = 'ally' | 'enemy';
/** `clan_war_participants.member_kind`. */
export type WarMemberKind = 'profile' | 'dummy';
/** `clan_war_plans.status`. Only `publish_clan_war_plan()` can reach `published`. */
export type WarPlanStatus = 'draft' | 'published';
/** `clan_war_plans.reattack_policy`. Defaults to `unknown` rather than to a guess. */
export type WarReattackPolicy = 'unknown' | 'never' | 'after_reset' | 'always';

/**
 * `public.clan_war_plans`, all 23 columns in table order, verified against `pg_attribute`.
 *
 * Everything from `opponent_name` down to `defence_slots` is LEADER-ENTERED because the game
 * config is silent about all of it — there is no opponent, no enemy roster, no per-enemy attack
 * allowance and no defence slot anywhere in `parsed_configs`. A surface must render these as the
 * leader's own numbers, never as facts from the game, and `points_per_attack` must not be given a
 * unit: `GuildWarConfig.MaxPointsForAttackingOpponentGuildMember` is 50 with no stated unit.
 */
export interface WarPlanRow {
    id: string;
    clan_id: string;
    /** `YYYY-MM-DD`, always a Tuesday (day index 0). CHECKed by `clan_war_plans_week_start_check`. */
    week_start: string;
    /** Config day index 0..5. Derive the default from `battleDayFromDayConfig()`, label it +1. */
    battle_day: number;
    status: WarPlanStatus;
    opponent_name: string | null;
    opponent_tag: string | null;
    /** DECLARED sizes, which may exceed the named rosters while a leader is still typing them in. */
    enemy_roster_size: number | null;
    ally_roster_size: number | null;
    attacks_per_player: number;
    /** NO UNIT. Do not append one in the UI. */
    points_per_attack: number | null;
    brawl_win_points: number | null;
    reattack_policy: WarReattackPolicy;
    reset_threshold: number | null;
    defence_slots: number | null;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_by: string | null;
    updated_at: string;
    published_at: string | null;
    published_by: string | null;
    /** Bumped by `touch_war_plan()` on every HEADER update. Not a board version — see the header. */
    revision: number;
}

const WAR_PLAN_COLUMNS =
    'id,clan_id,week_start,battle_day,status,' +
    'opponent_name,opponent_tag,enemy_roster_size,ally_roster_size,' +
    'attacks_per_player,points_per_attack,brawl_win_points,' +
    'reattack_policy,reset_threshold,defence_slots,notes,' +
    'created_by,created_at,updated_by,updated_at,published_at,published_by,revision';

/**
 * `public.clan_war_participants`, all 14 columns.
 *
 * `member_kind: 'profile'` with `profile_id: null` is a MEANINGFUL third state — that ally's
 * profile was deleted, and the FK is `on delete set null` so deleting a profile is never blocked
 * by a war plan. The export view surfaces it as `attacker_orphaned`; render it, do not hide it.
 *
 * `display_name` is NOT NULL for everyone. For a dummy it is what the leader typed; for a real
 * member it is a SNAPSHOT taken when they were added, so the sheet still reads after that member
 * is kicked or deletes their profile.
 */
export interface WarParticipantRow {
    id: string;
    plan_id: string;
    clan_id: string;
    side: WarSide;
    member_kind: WarMemberKind;
    profile_id: string | null;
    display_name: string;
    /** Leader-entered on BOTH sides: in-war strength is not profile power (0009 §6.2). */
    power_estimate: number | null;
    /** `null` means "use the plan's `attacks_per_player`". Cannot be set back to null — see §3. */
    attacks_budget: number | null;
    sort_order: number;
    note: string | null;
    created_by: string | null;
    created_at: string;
    /** Moved by `war_participant_guard()` on every insert and update. The row's own version. */
    updated_at: string;
}

const WAR_PARTICIPANT_COLUMNS =
    'id,plan_id,clan_id,side,member_kind,profile_id,display_name,' +
    'power_estimate,attacks_budget,sort_order,note,created_by,created_at,updated_at';

/**
 * `public.clan_war_assignments`, all 11 columns.
 *
 * `attacker_side` and `target_side` are pinned by CHECK to `'ally'` and `'enemy'` and exist only so
 * the composite FKs can enforce the side rule; they are never anything else and a UI has no reason
 * to read them. There is deliberately NO unique on `(attacker_id, target_id)` — whether a defeated
 * enemy may be hit again is `reattack_policy`, i.e. unknown, so two slots on one enemy must stay
 * expressible.
 */
export interface WarAssignmentRow {
    id: string;
    plan_id: string;
    clan_id: string;
    attacker_id: string;
    attacker_side: 'ally';
    target_id: string;
    target_side: 'enemy';
    /** 1..20, and it is the array position `set_war_assignments()` was given. */
    slot: number;
    note: string | null;
    created_by: string | null;
    created_at: string;
}

const WAR_ASSIGNMENT_COLUMNS =
    'id,plan_id,clan_id,attacker_id,attacker_side,target_id,target_side,slot,note,created_by,created_at';

/**
 * `public.clan_war_assignment_sheet` (view, 0009 §9) — all 25 columns, verified against
 * `pg_attribute`. THE EXPORT.
 *
 * One row per (ally, attack order), **and one row per ally who has no order yet** with `slot`,
 * `assignment_id`, `target_id` and `target_name` all null. That is the difference between an export
 * and a dump: "nobody has been given a target" is the single most important thing a leader needs to
 * see before handing the sheet out, and an assignment-driven query cannot express it.
 *
 * It carries the ENEMY side only through the targets that were actually assigned. An enemy nobody
 * has been pointed at does not appear, which is why `loadWarBoard()` reads the participants table
 * as well and does not try to drive the whole screen from this view.
 *
 * The view has no ORDER BY of its own; order by `attacker_sort, attacker_name, slot`.
 */
export interface WarSheetRow {
    clan_id: string;
    plan_id: string;
    week_start: string;
    battle_day: number;
    status: WarPlanStatus;
    revision: number;
    opponent_name: string | null;
    opponent_tag: string | null;

    attacker_id: string;
    attacker_profile_id: string | null;
    attacker_kind: WarMemberKind;
    /** The LIVE profile name while they are still in this clan, else the snapshot. */
    attacker_name: string;
    attacker_name_snapshot: string;
    /** A real ally whose profile was deleted. Say so on the sheet rather than showing a stale name. */
    attacker_orphaned: boolean;
    attacker_power_estimate: number | null;
    /** The per-player override resolved against the plan default, in one place, by the database. */
    attacker_attacks: number;
    attacker_sort: number;
    attacker_note: string | null;

    assignment_id: string | null;
    slot: number | null;
    order_note: string | null;
    target_id: string | null;
    target_name: string | null;
    target_power_estimate: number | null;
    target_note: string | null;
}

const WAR_SHEET_COLUMNS =
    'clan_id,plan_id,week_start,battle_day,status,revision,opponent_name,opponent_tag,' +
    'attacker_id,attacker_profile_id,attacker_kind,attacker_name,attacker_name_snapshot,' +
    'attacker_orphaned,attacker_power_estimate,attacker_attacks,attacker_sort,attacker_note,' +
    'assignment_id,slot,order_note,target_id,target_name,target_power_estimate,target_note';

/**
 * The whole board for one clan and one war week, as one object.
 *
 * `allies` and `enemies` are the participants split by side and sorted the way every screen wants
 * them (`sort_order`, then name) so no caller sorts them twice and differently. `assignments` is
 * flat and keyed by `attacker_id`; `ordersByAttacker` is the same rows indexed, because every
 * surface in the feature immediately builds that map.
 */
export interface WarBoard {
    plan: WarPlanRow;
    allies: WarParticipantRow[];
    enemies: WarParticipantRow[];
    assignments: WarAssignmentRow[];
    /** `attacker_id -> that attacker's orders, ascending by slot`. */
    ordersByAttacker: Map<string, WarAssignmentRow[]>;
    /** See `warBoardStamp()`. Carry it into a write's precondition, or compare two loads. */
    stamp: string;
}

/** What `publish_clan_war_plan()` returns, as jsonb: `{plan, allies, orders, notified}`. */
export interface PublishWarPlanResult {
    plan: WarPlanRow;
    /** How many allies are on the roster. */
    allies: number;
    /** How many attack orders exist across the whole plan. */
    orders: number;
    /**
     * How many notification rows were QUEUED — one per clan-mate ACCOUNT, not per device and not
     * per profile (several profiles of one account may share a clan, and that human wants one
     * notification). It is not a delivery count: the sender drains the queue later, and an account
     * with no live device is marked sent with zero delivered.
     */
    notified: number;
}

/**
 * The result of a batch enemy creation, which is a client loop because 0009 has no batch RPC.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT HIDDEN. If the 17th of 30 calls fails, 16 enemies really do
 * exist on the server and pretending otherwise would leave the leader with a roster they did not
 * ask for and no idea why. So this resolves `ok: true` with `stoppedBy` set, and the caller reads
 * `created.length` against `requested`.
 */
export interface CreateEnemiesResult {
    requested: number;
    /** Participant ids, in creation order. */
    created: string[];
    /** The names that were actually used, in the same order. */
    names: string[];
    /** `null` when all `requested` were made. Otherwise why the loop stopped, on the first failure. */
    stoppedBy: WarPlanError | null;
}

/* ------------------------------------------------------------------------------------------ *
 * Error taxonomy — clanApi's, widened by two
 * ------------------------------------------------------------------------------------------ */

/**
 * `ClanErrorKind` plus the two meanings that are about a WAR ROSTER rather than about a clan.
 * Everything else is delegated, so there is one mapping in the codebase, not two.
 */
export type WarPlanErrorKind = ClanErrorKind | 'roster-full' | 'duplicate-name';

/** Structurally `ClanError` with the widened kind, so a `ClanResult` can be handed straight on. */
export interface WarPlanError extends Omit<ClanError, 'kind'> {
    kind: WarPlanErrorKind;
}

export type WarPlanResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: WarPlanError };

const ok = <T>(data: T): WarPlanResult<T> => ({ ok: true, data });
const fail = <T>(error: WarPlanError): WarPlanResult<T> => ({ ok: false, error });

/** The one place `no-backend` is constructed here, so its wording cannot drift between call sites. */
function noBackend<T>(): WarPlanResult<T> {
    return fail<T>({
        kind: 'no-backend',
        message: 'The attacks planner needs an account, and this build has no server configured. Everything else keeps working locally.',
    });
}

/**
 * SQLSTATE + message -> meaning, for the messages 0009 writes and `clanApi` does not know about.
 *
 * Ordered most specific first, and every string tested here is quoted from a `raise` in 0009 or
 * from a constraint name that was PROVOKED on the harness (the raw ones are noted in the module
 * header). Anything not matched falls through to `classifyError()`, whose fallbacks are safe:
 * 42501 degrades to `not-a-leader`, which is the conservative reading of "the database refused
 * this write".
 */
export function classifyWarPlanError(raw: unknown): WarPlanError {
    const base = classifyError(raw);
    const lower = (base.raw || '').toLowerCase();
    const code = base.code;

    switch (code) {
        case '54000':
            // `% roster is full (% is the game's MaxGuildMemberCount)`. This MUST be caught before
            // clanApi's own 54000 branch, which tests `includes('is full')` and answers "That clan
            // is full." — a sentence about the wrong object.
            if (lower.includes('roster is full')) {
                return {
                    ...base,
                    kind: 'roster-full',
                    message: lower.startsWith('enemy')
                        ? `This war plan already lists ${WAR_ROSTER_MAX_PER_SIDE} enemies, which is the most a guild can have. Remove one first.`
                        : `This war plan already lists ${WAR_ROSTER_MAX_PER_SIDE} players, which is the most a guild can have. Remove one first.`,
                };
            }
            // The publish/broadcast limiter: one notification a minute, per clan.
            if (lower.includes('notified less than a minute ago')) {
                return {
                    ...base,
                    kind: 'rate-limited',
                    message: 'The clan was notified less than a minute ago. Wait a moment before sending again.',
                    retryAfterSeconds: 60,
                };
            }
            return { ...base, kind: base.kind };

        case '23505':
            // TWO LEADERS WRITING THE SAME PLAYER'S ORDERS AT THE SAME INSTANT.
            // `set_war_assignments()` deletes that attacker's rows and re-inserts them; two
            // overlapping transactions therefore both delete, both insert, and the second one
            // collides on `(attacker_id, slot)`. Measured on a real PG 14.16 cluster with
            // 0001..0011 applied, two concurrent leaders on one attacker:
            //     23505  duplicate key value violates unique constraint
            //            "clan_war_assignments_slot_key"
            // Nothing below matched it, so it fell through to `clanApi.classifyError()`'s own
            // 23505 branch and the leader was told, while assigning an attack, "A clan with that
            // name and tag already exists. Pick another one." — a sentence about a different
            // object, in a dialog about a different action. The write is rolled back whole, so the
            // honest answer is the one a stale board gets: reload and look again.
            if (lower.includes('clan_war_assignments_slot_key')) {
                return {
                    ...base,
                    kind: 'version-conflict',
                    message:
                        'Somebody else was changing this player\'s attacks at the same moment. Nothing was saved. Refresh the board and try again.',
                };
            }
            // Two shapes, one meaning. The INSERT path of set_war_participant() re-raises a
            // sentence a human wrote; the UPDATE path (a RENAME) does not, and hands back the raw
            // `duplicate key value violates unique constraint "clan_war_participants_name_key"`.
            // Matching the constraint name is what stops that reaching the DOM.
            if (
                lower.includes('names must be unique') ||
                lower.includes('clan_war_participants_name_key') ||
                lower.includes('clan_war_participants_profile_key')
            ) {
                return {
                    ...base,
                    kind: 'duplicate-name',
                    message: lower.includes('clan_war_participants_profile_key')
                        ? 'That player is already on this side of the war plan.'
                        : 'That name is already taken on this side of the war plan. Names have to be unique so the export says who to hit.',
                };
            }
            return { ...base, kind: base.kind };

        case '22023':
            if (lower.includes('is not an enemy of this war plan')) {
                return {
                    ...base,
                    kind: 'not-found',
                    message: 'One of those targets is no longer an enemy in this plan. Refresh the board and try again.',
                };
            }
            if (lower.includes('at most') && lower.includes('attacks per player')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `A player can be given at most ${WAR_MAX_SLOTS_PER_ATTACKER} attacks.`,
                };
            }
            if (lower.includes('week_start must be a tuesday')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'A war week starts on a Tuesday. Pick the Tuesday that opens the week.',
                };
            }
            if (lower.includes('use publish_clan_war_plan')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'Use "publish" to make the plan visible to the clan.',
                };
            }
            if (lower.includes('battle_day must be')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'The battle day has to be one of the six war days.',
                };
            }
            if (lower.includes('reattack_policy must be')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'Pick one of: unknown, never, after a reset, always.',
                };
            }
            if (lower.includes('not a member of this clan')) {
                return {
                    ...base,
                    kind: 'not-a-member',
                    message: 'That player is not in this clan. Add them as a stand-in instead.',
                };
            }
            if (lower.includes('no such profile')) {
                return {
                    ...base,
                    kind: 'not-found',
                    message: 'That player is not there any more. Refresh the roster and try again.',
                };
            }
            if (lower.includes('profile cannot be changed after it is added')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'A slot cannot be handed to a different player. Remove this one and add the other, which also removes their attack orders.',
                };
            }
            if (lower.includes('only an ally can be given attack orders')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'Attack orders belong to your own players, not to an enemy.',
                };
            }
            if (lower.includes('a dummy') && lower.includes('needs a name')) {
                return { ...base, kind: 'invalid-input', message: 'Type a name for this stand-in first.' };
            }
            return { ...base, kind: base.kind };

        case '23514':
            // A CHECK reached before any friendly raise. The one this app can actually provoke is
            // an empty opponent name / tag, which is why every text argument below is dropped when
            // it trims to nothing — this branch is the safety net, not the plan.
            if (lower.includes('opponent_name')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `An opponent name is 1 to ${WAR_OPPONENT_NAME_MAX_LENGTH} characters.`,
                };
            }
            if (lower.includes('opponent_tag')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `An opponent tag is 1 to ${WAR_OPPONENT_TAG_MAX_LENGTH} characters.`,
                };
            }
            if (lower.includes('display_name')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: `A name is 1 to ${WAR_NAME_MAX_LENGTH} characters.`,
                };
            }
            if (lower.includes('week_start')) {
                return {
                    ...base,
                    kind: 'invalid-input',
                    message: 'A war week starts on a Tuesday. Pick the Tuesday that opens the week.',
                };
            }
            return { ...base, kind: base.kind };

        case '42501':
            // Every war RPC raises this for "no such plan", "not your clan" and "you are only a
            // member" alike, on purpose, so it is not an existence oracle. clanApi's fallback is
            // already `not-a-leader`; only the wording is made specific to the war plan.
            if (lower.includes('change the war plan') || lower.includes('notify the clan')) {
                return {
                    ...base,
                    kind: 'not-a-leader',
                    message: 'Only the clan owner or an admin can change the attack plan.',
                };
            }
            return { ...base, kind: base.kind };

        default:
            return { ...base, kind: base.kind };
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Plumbing
 *
 * These four are deliberate copies of `clanApi`'s private helpers rather than an import: they are
 * module-private there BY DESIGN (exporting them would widen clanApi's public surface from "the
 * clan calls" to "a query builder"), and they are forty lines. What is NOT copied is the part that
 * matters — `classifyError` is imported, so the taxonomy stays single-sourced.
 * ------------------------------------------------------------------------------------------ */

interface PostgrestErrorLike {
    message?: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
    name?: string;
    status?: number;
}

interface QueryOutcome<T> { data: T | null; error: PostgrestErrorLike | null }

/** Runs `body` with a client, or resolves `no-backend`. Never throws: a throw becomes an error. */
async function withClient<T>(
    body: (client: SupabaseClient) => Promise<WarPlanResult<T>>,
): Promise<WarPlanResult<T>> {
    const client = await getSupabaseClient();
    if (!client) return noBackend<T>();
    try {
        return await body(client);
    } catch (e) {
        return fail<T>(classifyWarPlanError(e));
    }
}

/** One RPC call, one place where the argument object is passed straight through BY NAME. */
async function callRpc<T>(
    client: SupabaseClient,
    fn: string,
    args: Record<string, unknown>,
): Promise<WarPlanResult<T>> {
    const rpc = (client as unknown as {
        rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<QueryOutcome<T>>;
    }).rpc;
    const { data, error } = await rpc.call(client, fn, args);
    if (error) return fail<T>(classifyWarPlanError(error));
    return ok(data as T);
}

/** The slice of the PostgREST builder this module uses. */
type TableBuilder = {
    select: (columns?: string) => TableBuilder;
    eq: (column: string, value: unknown) => TableBuilder;
    order: (column: string, options?: { ascending?: boolean }) => TableBuilder;
    limit: (n: number) => TableBuilder;
    maybeSingle: () => PromiseLike<QueryOutcome<unknown>>;
} & PromiseLike<QueryOutcome<unknown>>;

function table(client: SupabaseClient, name: string): TableBuilder {
    return (client as unknown as { from: (n: string) => TableBuilder }).from(name);
}

async function runQuery<T>(builder: PromiseLike<QueryOutcome<unknown>>): Promise<WarPlanResult<T>> {
    const { data, error } = await builder;
    if (error) return fail<T>(classifyWarPlanError(error));
    return ok(data as T);
}

/* ------------------------------------------------------------------------------------------ *
 * Pure helpers — no network, safe to call in a render
 * ------------------------------------------------------------------------------------------ */

/**
 * The UTC Tuesday that opens the war week containing `at`, as `YYYY-MM-DD`.
 *
 * This MUST agree with `public.war_week_start()` to the day, or two clients create two rows for one
 * war week and the plan splits in half — which is exactly the bug `clan_war_plans.week_start`'s
 * "must be a Tuesday" CHECK exists to make loud instead of silent.
 *
 * The arithmetic is the same one, transcribed: SQL subtracts `(isodow + 5) % 7` days, and
 * `(getUTCDay() + 5) % 7` is the same offset on the other day numbering — Tue 0, Wed 1, Thu 2,
 * Fri 3, Sat 4, Sun 5, Mon 6. Monday therefore belongs to the week that opened the PREVIOUS
 * Tuesday, matching `getWarDayIndex()` mapping both Sunday and Monday to index 5.
 *
 * PURE UTC, and that is not a detail. Verified on the harness: run at 01:32 local (UTC+2) on
 * Tuesday 25 August, `war_week_start(now())` answered **2026-08-18**, because in UTC it was still
 * Monday. A client that used local dates would have asked for the wrong week for two hours a day.
 */
export function currentWarWeekStart(at: Date = new Date()): string {
    const utc = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const offsetDays = (new Date(utc).getUTCDay() + 5) % 7;
    const start = new Date(utc - offsetDays * 86400000);
    const month = String(start.getUTCMonth() + 1).padStart(2, '0');
    const day = String(start.getUTCDate()).padStart(2, '0');
    return `${start.getUTCFullYear()}-${month}-${day}`;
}

/** Is this `YYYY-MM-DD` a Tuesday? The same test `clan_war_plans_week_start_check` applies. */
export function isWarWeekStart(iso: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const parsed = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 2;
}

/** The Tuesday `weeks` war weeks away from `iso`. Negative goes back. For a week picker. */
export function shiftWarWeek(iso: string, weeks: number): string {
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return iso;
    return currentWarWeekStart(new Date(parsed.getTime() + weeks * 7 * 86400000));
}

/**
 * THE BATTLE DAY, DERIVED, NEVER HARD-CODED.
 *
 * 0009 is emphatic about this and it is right: `battle_day` defaults to 5 in the column, but the
 * client must derive it from **the day whose `Tasks` array is empty**, because nothing about the
 * war calendar is stable between config versions. Measured across the shipped configs: `DayPoints`
 * flattened, day 5 went 2 -> 4 in `2026_02_09`, and in `2026_07_14` four of the eight task
 * categories changed day outright.
 *
 * The shape is `Record<string, { Day: number; Tasks: unknown[]; DayPoints: number }>` with keys
 * "0".."5" — verified against `public/parsed_configs/2026_08_21_00_29/GuildWarDayConfigLibrary.json`,
 * where entry "5" is the only one with `Tasks: []` and pays `DayPoints: 4`.
 *
 * Returns `null` when the config has not loaded or has no empty-task day, so a caller can wait
 * rather than fall back to a literal. **Label it `battle_day + 1`** for humans: `GuildWar.tsx`
 * renders index 5 as "Day 6".
 */
export function battleDayFromDayConfig(dayConfig: unknown): number | null {
    if (!dayConfig || typeof dayConfig !== 'object') return null;
    const entries = Object.entries(dayConfig as Record<string, unknown>);
    for (const [key, value] of entries) {
        if (!value || typeof value !== 'object') continue;
        const tasks = (value as { Tasks?: unknown }).Tasks;
        if (!Array.isArray(tasks) || tasks.length > 0) continue;
        const day = (value as { Day?: unknown }).Day;
        const index = typeof day === 'number' ? day : Number(key);
        if (Number.isInteger(index) && index >= 0 && index <= 5) return index;
    }
    return null;
}

/**
 * A short hash of everything about a board that a leader could have changed.
 *
 * FNV-1a over the header revision plus every participant and assignment identity, so two loads that
 * differ anywhere differ here. It exists because `clan_war_plans.revision` covers the header ONLY
 * (measured: eight participant inserts and four assignment writes left it at 1), so there is no
 * single column that says "the board moved".
 *
 * What goes in, and why each part: the participant's `updated_at` catches a rename, a power
 * estimate, a budget or a re-order; its `id` catches an add or a remove; the assignment's `id`
 * catches everything about the orders, because `set_war_assignments()` DELETES and re-inserts, so
 * the ids change even when the targets do not.
 */
export function warBoardStamp(board: {
    plan: Pick<WarPlanRow, 'revision' | 'status'>;
    allies: Pick<WarParticipantRow, 'id' | 'updated_at'>[];
    enemies: Pick<WarParticipantRow, 'id' | 'updated_at'>[];
    assignments: Pick<WarAssignmentRow, 'id'>[];
}): string {
    const parts: string[] = [`r${board.plan.revision}`, board.plan.status];
    for (const row of [...board.allies, ...board.enemies]) parts.push(`${row.id}@${row.updated_at}`);
    for (const row of board.assignments) parts.push(row.id);
    parts.sort();

    // FNV-1a, 32-bit. Not a security hash: a leader is not an adversary, and the only job is to
    // tell "identical" from "different" in a string short enough to sit in component state.
    let hash = 0x811c9dc5;
    const text = parts.join('|');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${board.plan.revision}.${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Trim, collapse runs of whitespace, cap, and answer `null` when nothing is left.
 *
 * `null` is what the RPC argument builders below drop, and dropping it is the whole point: 0009
 * treats a missing argument as "leave unchanged" but treats `''` as a value, and an empty string
 * hits the column CHECK before any friendly `raise` can run — measured, `p_opponent_name => ''`
 * answers `23514 ... violates check constraint "clan_war_plans_opponent_name_check"`, a raw
 * Postgres message with a constraint name in it.
 */
function cleanText(value: string | null | undefined, max: number): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
}

/** A non-negative integer, or `null`. Keeps a form's `''` and `NaN` off the wire. */
function cleanInt(value: number | null | undefined, min: number, max: number): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(Math.max(Math.round(n), min), max);
}

/* ------------------------------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------------------------------ */

/**
 * Has the embedded single-request read been ruled out for this session?
 *
 * Set once, on the first `PGRST200`, and never unset: the answer depends on the schema cache of the
 * project this build talks to, which does not change under a running tab. Without the latch, every
 * board load would pay a failed request first.
 */
let embeddingUnavailable = false;

/** PostgREST's "I have no such relationship" answer. Anything else is a real failure. */
function isEmbeddingFailure(error: WarPlanError): boolean {
    const raw = (error.raw || '').toLowerCase();
    return error.code === 'PGRST200' || raw.includes('could not find a relationship');
}

interface EmbeddedPlanRow extends WarPlanRow {
    clan_war_participants?: WarParticipantRow[] | null;
    clan_war_assignments?: WarAssignmentRow[] | null;
}

/** Splits, sorts and indexes the three row sets into the shape every screen wants. */
function assembleBoard(
    plan: WarPlanRow,
    participants: WarParticipantRow[],
    assignments: WarAssignmentRow[],
): WarBoard {
    const bySort = (a: WarParticipantRow, b: WarParticipantRow) =>
        a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name);

    const allies = participants.filter(p => p.side === 'ally').sort(bySort);
    const enemies = participants.filter(p => p.side === 'enemy').sort(bySort);
    const orders = [...assignments].sort((a, b) => a.slot - b.slot);

    const ordersByAttacker = new Map<string, WarAssignmentRow[]>();
    for (const row of orders) {
        const list = ordersByAttacker.get(row.attacker_id);
        if (list) list.push(row);
        else ordersByAttacker.set(row.attacker_id, [row]);
    }

    return {
        plan,
        allies,
        enemies,
        assignments: orders,
        ordersByAttacker,
        stamp: warBoardStamp({ plan, allies, enemies, assignments: orders }),
    };
}

/**
 * THE ONE READ A TAB OPENS WITH: the plan for `clanId` and `weekStart`, with both rosters and every
 * attack order.
 *
 * `null` is a NORMAL answer, not an error, and it means one of two things the caller must not
 * conflate with a failure:
 *   * a leader sees `null` when nobody has started this week's plan. Offer to create one.
 *   * a plain member sees `null` when the leaders have not PUBLISHED this week's plan. Drafts are
 *     invisible to members by design (`war_plan_visible()`), so say "no plan published yet".
 * Measured: while the plan was a draft the member's reads answered 0 rows on all four objects;
 * after publish, 1 plan / 54 participants / 4 assignments / 6 sheet rows.
 *
 * COST: one request, or three over two round trips on the fallback. Never one per member.
 */
export function loadWarBoard(
    clanId: string,
    weekStart: string = currentWarWeekStart(),
): Promise<WarPlanResult<WarBoard | null>> {
    return withClient(async client => {
        if (!embeddingUnavailable) {
            // ONE REQUEST. Both embeds resolve through a single, unambiguous foreign key
            // (`clan_war_participants_plan_fkey` / `clan_war_assignments_plan_fkey`); the two FKs
            // from assignments to participants are NOT embedded here because those are ambiguous
            // (attacker and target) and would need a constraint-name hint.
            const embedded = await runQuery<EmbeddedPlanRow | null>(
                table(client, 'clan_war_plans')
                    .select(
                        `${WAR_PLAN_COLUMNS},` +
                        `clan_war_participants(${WAR_PARTICIPANT_COLUMNS}),` +
                        `clan_war_assignments(${WAR_ASSIGNMENT_COLUMNS})`,
                    )
                    .eq('clan_id', clanId)
                    .eq('week_start', weekStart)
                    .maybeSingle(),
            );

            if (embedded.ok) {
                if (!embedded.data) return ok<WarBoard | null>(null);
                const { clan_war_participants, clan_war_assignments, ...plan } = embedded.data;
                return ok<WarBoard | null>(
                    assembleBoard(plan as WarPlanRow, clan_war_participants ?? [], clan_war_assignments ?? []),
                );
            }
            if (!isEmbeddingFailure(embedded.error)) return embedded;
            // The project's schema cache has no such relationship. Remember, and never pay for
            // this attempt again in this session.
            embeddingUnavailable = true;
        }

        // FALLBACK: the plan first (its id is the filter for both children), then the two child
        // reads IN PARALLEL — three requests, two round trips, still O(1) in the roster size.
        const planResult = await runQuery<WarPlanRow | null>(
            table(client, 'clan_war_plans')
                .select(WAR_PLAN_COLUMNS)
                .eq('clan_id', clanId)
                .eq('week_start', weekStart)
                .maybeSingle(),
        );
        if (!planResult.ok) return planResult;
        if (!planResult.data) return ok<WarBoard | null>(null);
        const plan = planResult.data;

        const [participants, assignments] = await Promise.all([
            runQuery<WarParticipantRow[] | null>(
                table(client, 'clan_war_participants').select(WAR_PARTICIPANT_COLUMNS).eq('plan_id', plan.id),
            ),
            runQuery<WarAssignmentRow[] | null>(
                table(client, 'clan_war_assignments').select(WAR_ASSIGNMENT_COLUMNS).eq('plan_id', plan.id),
            ),
        ]);
        if (!participants.ok) return participants;
        if (!assignments.ok) return assignments;

        return ok<WarBoard | null>(
            assembleBoard(plan, participants.data ?? [], assignments.data ?? []),
        );
    });
}

/**
 * The plan HEADERS for the last `limit` war weeks of one clan, newest first — for a week picker.
 *
 * Headers only: this must never become a way to pull every roster of every week into a dropdown.
 * A member sees only the published ones, which is what makes the picker's contents differ by role.
 * One request, and it rides `clan_war_plans_clan_week_idx`.
 */
export function listWarWeeks(clanId: string, limit = 8): Promise<WarPlanResult<WarPlanRow[]>> {
    return withClient(async client => {
        const result = await runQuery<WarPlanRow[] | null>(
            table(client, 'clan_war_plans')
                .select(WAR_PLAN_COLUMNS)
                .eq('clan_id', clanId)
                .order('week_start', { ascending: false })
                .limit(Math.min(Math.max(Math.round(limit) || 1, 1), 52)),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/**
 * `public.clan_war_assignment_sheet` for one plan — the canonical export projection.
 *
 * A VIEW and not a client-side join, so the sheet a leader hands out and the screen they built it
 * on cannot disagree. It is also the only place a LIVE profile name is resolved, and it resolves
 * only through `clan_members`, so a kicked member keeps their snapshot rather than leaking their
 * current profile name.
 *
 * Ordered here, once, the way the view's own comment prescribes: `attacker_sort`, `attacker_name`,
 * `slot`. One request.
 */
export function loadAssignmentSheet(planId: string): Promise<WarPlanResult<WarSheetRow[]>> {
    return withClient(async client => {
        const result = await runQuery<WarSheetRow[] | null>(
            table(client, 'clan_war_assignment_sheet')
                .select(WAR_SHEET_COLUMNS)
                .eq('plan_id', planId)
                .order('attacker_sort', { ascending: true })
                .order('attacker_name', { ascending: true })
                .order('slot', { ascending: true }),
        );
        return result.ok ? ok(result.data ?? []) : result;
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Writes — leaders only, every one an RPC
 * ------------------------------------------------------------------------------------------ */

/** What `saveWarPlan()` can change. Every field is optional; omitted means "leave unchanged". */
export interface WarPlanPatch {
    weekStart?: string;
    battleDay?: number;
    opponentName?: string;
    opponentTag?: string;
    enemyRosterSize?: number;
    allyRosterSize?: number;
    attacksPerPlayer?: number;
    pointsPerAttack?: number;
    brawlWinPoints?: number;
    reattackPolicy?: WarReattackPolicy;
    resetThreshold?: number;
    defenceSlots?: number;
    notes?: string;
    /**
     * Only `'draft'` is accepted, and it is the RETRACT gesture: it clears `published_at` and
     * `published_by` and makes the plan invisible to plain members again. Measured: after a
     * retract the member's `select count(*)` went back to 0. Publishing is `publishWarPlan()`.
     */
    status?: 'draft';
}

/**
 * `upsert_clan_war_plan(p_clan_id uuid, p_week_start date DEFAULT NULL, p_battle_day integer
 *  DEFAULT NULL, p_status text DEFAULT NULL, p_opponent_name text DEFAULT NULL, p_opponent_tag
 *  text DEFAULT NULL, p_enemy_roster_size integer DEFAULT NULL, p_ally_roster_size integer DEFAULT
 *  NULL, p_attacks_per_player integer DEFAULT NULL, p_points_per_attack integer DEFAULT NULL,
 *  p_brawl_win_points integer DEFAULT NULL, p_reattack_policy text DEFAULT NULL, p_reset_threshold
 *  integer DEFAULT NULL, p_defence_slots integer DEFAULT NULL, p_notes text DEFAULT NULL)
 *  RETURNS jsonb`
 *
 * Creates the week's plan or edits it. LEADERS ONLY. Returns the whole row.
 *
 * `expectedRevision` is the precondition described in the module header: when given, the current
 * `revision` is read first and a mismatch returns `version-conflict` WITHOUT writing. Leave it out
 * for a form the leader opened a moment ago; pass it when the board has been on screen a while.
 *
 * Because the RPC is a null-means-unchanged patch, two leaders editing DIFFERENT fields both land
 * regardless. The precondition is for the case where they typed into the SAME field.
 */
export function saveWarPlan(
    clanId: string,
    patch: WarPlanPatch,
    options?: { expectedRevision?: number },
): Promise<WarPlanResult<WarPlanRow>> {
    const week = patch.weekStart;
    if (week !== undefined && !isWarWeekStart(week)) {
        // Refused here rather than server-side so the message can name the anchor instead of a
        // constraint. The RPC would answer 22023 with the weekday spelled out.
        return Promise.resolve(fail<WarPlanRow>({
            kind: 'invalid-input',
            message: 'A war week starts on a Tuesday. Pick the Tuesday that opens the week.',
        }));
    }

    const args: Record<string, unknown> = { p_clan_id: clanId };
    if (week !== undefined) args.p_week_start = week;
    if (patch.battleDay !== undefined) args.p_battle_day = cleanInt(patch.battleDay, 0, 5);
    if (patch.status !== undefined) args.p_status = 'draft';

    // Text: dropped when it trims to nothing, because '' is a CHECK violation with a raw message,
    // not a way to clear the field (see cleanText).
    const opponentName = cleanText(patch.opponentName, WAR_OPPONENT_NAME_MAX_LENGTH);
    if (opponentName) args.p_opponent_name = opponentName;
    const opponentTag = cleanText(patch.opponentTag, WAR_OPPONENT_TAG_MAX_LENGTH);
    if (opponentTag) args.p_opponent_tag = opponentTag;
    const notes = cleanText(patch.notes, WAR_PLAN_NOTES_MAX_LENGTH);
    if (notes) args.p_notes = notes;

    if (patch.enemyRosterSize !== undefined) args.p_enemy_roster_size = cleanInt(patch.enemyRosterSize, 0, 50);
    if (patch.allyRosterSize !== undefined) args.p_ally_roster_size = cleanInt(patch.allyRosterSize, 0, 50);
    if (patch.attacksPerPlayer !== undefined) args.p_attacks_per_player = cleanInt(patch.attacksPerPlayer, 0, 100);
    if (patch.pointsPerAttack !== undefined) args.p_points_per_attack = cleanInt(patch.pointsPerAttack, 0, 1000000);
    if (patch.brawlWinPoints !== undefined) args.p_brawl_win_points = cleanInt(patch.brawlWinPoints, 0, 1000000);
    if (patch.resetThreshold !== undefined) args.p_reset_threshold = cleanInt(patch.resetThreshold, 0, 50);
    if (patch.defenceSlots !== undefined) args.p_defence_slots = cleanInt(patch.defenceSlots, 0, 50);
    if (patch.reattackPolicy !== undefined) args.p_reattack_policy = patch.reattackPolicy;

    return withClient(async client => {
        if (typeof options?.expectedRevision === 'number') {
            const guard = await guardPlanRevision(client, clanId, week ?? null, options.expectedRevision);
            if (guard) return fail<WarPlanRow>(guard);
        }
        const result = await callRpc<WarPlanRow | null>(client, 'upsert_clan_war_plan', args);
        if (!result.ok) return result;
        if (!result.data) {
            // Unreachable: the function either returns the row or raises. Kept because handing a
            // null on as a WarPlanRow would put `undefined` into every field the UI then renders.
            return fail<WarPlanRow>({
                kind: 'unknown',
                message: 'The server did not send the updated plan back. Refresh to see what changed.',
            });
        }
        return ok(result.data);
    });
}

/**
 * The precondition read for the plan header: one narrow request for `revision` alone.
 *
 * Returns the error to report, or `null` to go ahead. A plan that does not exist yet is NOT a
 * conflict — there is nothing to clobber, and `upsert_clan_war_plan()` will create it.
 */
async function guardPlanRevision(
    client: SupabaseClient,
    clanId: string,
    weekStart: string | null,
    expected: number,
): Promise<WarPlanError | null> {
    const current = await runQuery<{ revision: number } | null>(
        table(client, 'clan_war_plans')
            .select('revision')
            .eq('clan_id', clanId)
            .eq('week_start', weekStart ?? currentWarWeekStart())
            .maybeSingle(),
    );
    if (!current.ok) return current.error;
    if (!current.data) return null;
    if (Number(current.data.revision) === expected) return null;
    return {
        kind: 'version-conflict',
        message: 'Somebody else changed this plan while you were editing. Nothing was saved. Refresh to see their version.',
        raw: `expected revision ${expected}, server has ${current.data.revision}`,
    };
}

/** What `addWarParticipant()` puts on a new roster row. */
export interface WarParticipantDraft {
    side: WarSide;
    /**
     * A REAL clan member. Omit for a dummy. An enemy can never carry one — the tool cannot know
     * another guild's accounts, and `war_participant_guard()` refuses it with 22023.
     */
    profileId?: string;
    /** Required for a dummy; optional for a real member, whose current name is snapshotted. */
    displayName?: string;
    powerEstimate?: number;
    /** Per-player override of the plan's `attacks_per_player`. Cannot be taken back off later. */
    attacksBudget?: number;
    sortOrder?: number;
    note?: string;
}

/**
 * `set_war_participant(p_plan_id uuid, p_side text, p_participant_id uuid DEFAULT NULL,
 *  p_profile_id uuid DEFAULT NULL, p_display_name text DEFAULT NULL, p_power_estimate bigint
 *  DEFAULT NULL, p_attacks_budget integer DEFAULT NULL, p_sort_order integer DEFAULT NULL,
 *  p_note text DEFAULT NULL) RETURNS uuid`
 *
 * Adds one roster row and resolves with its id. LEADERS ONLY.
 *
 * `p_profile_id` null makes it a DUMMY, which is the only kind an enemy can be. With a profile id
 * the row is a real ally whose CLAN MEMBERSHIP is verified by the trigger (measured: a profile in
 * no clan answers `22023 that profile is not a member of this clan; add them as a dummy ally
 * instead`) and whose name is snapshotted so the sheet survives them being kicked.
 *
 * `duplicate-name` (23505) is the expected refusal and it is DELIBERATE: two allies called "Bob"
 * make a sheet nobody can act on, so the second one has to be "Bob2".
 */
export function addWarParticipant(
    planId: string,
    draft: WarParticipantDraft,
): Promise<WarPlanResult<string>> {
    const name = cleanText(draft.displayName, WAR_NAME_MAX_LENGTH);
    if (!draft.profileId && !name) {
        return Promise.resolve(fail<string>({
            kind: 'invalid-input',
            message: 'Type a name for this stand-in first.',
        }));
    }
    if (draft.side === 'enemy' && draft.profileId) {
        // Refused here, with the reason, rather than as a 22023: an enemy is structurally a dummy
        // because this tool can never know another guild's accounts.
        return Promise.resolve(fail<string>({
            kind: 'invalid-input',
            message: 'An enemy is always a name you type. This tool cannot see the other guild\'s players.',
        }));
    }

    const args: Record<string, unknown> = { p_plan_id: planId, p_side: draft.side };
    if (draft.profileId) args.p_profile_id = draft.profileId;
    if (name) args.p_display_name = name;
    if (draft.powerEstimate !== undefined) args.p_power_estimate = cleanInt(draft.powerEstimate, 0, Number.MAX_SAFE_INTEGER);
    if (draft.attacksBudget !== undefined) args.p_attacks_budget = cleanInt(draft.attacksBudget, 0, 100);
    if (draft.sortOrder !== undefined) args.p_sort_order = cleanInt(draft.sortOrder, 0, 1000);
    const note = cleanText(draft.note, WAR_NOTE_MAX_LENGTH);
    if (note) args.p_note = note;

    return withClient(client => callRpc<string>(client, 'set_war_participant', args));
}

/** What `updateWarParticipant()` can change. A participant's PROFILE is immutable after insert. */
export interface WarParticipantPatch {
    displayName?: string;
    powerEstimate?: number;
    attacksBudget?: number;
    sortOrder?: number;
    note?: string;
}

/**
 * Same RPC, update branch: `set_war_participant(p_plan_id, p_side, p_participant_id, )`.
 *
 * LEADERS ONLY. Edits one roster row and resolves with its id.
 *
 * TWO THINGS THE DATABASE WILL NOT DO, so a caller must not offer them:
 *   * a participant's PROFILE cannot be repointed. Sending one raises 22023 — and note the RPC
 *     applies the rest of the patch BEFORE it raises, so this wrapper never sends a profile id at
 *     all rather than relying on the refusal.
 *   * nothing can be CLEARED. `p_attacks_budget => null` is "leave unchanged", not "unset";
 *     measured, a row holding 7 kept 7. An omitted field here means the same thing.
 *
 * `expectedUpdatedAt` is the precondition: the row's current `updated_at` is read first and a
 * mismatch returns `version-conflict` without writing.
 */
export function updateWarParticipant(
    planId: string,
    participantId: string,
    side: WarSide,
    patch: WarParticipantPatch,
    options?: { expectedUpdatedAt?: string },
): Promise<WarPlanResult<string>> {
    const args: Record<string, unknown> = {
        p_plan_id: planId,
        p_side: side,
        p_participant_id: participantId,
    };
    const name = cleanText(patch.displayName, WAR_NAME_MAX_LENGTH);
    if (name) args.p_display_name = name;
    if (patch.powerEstimate !== undefined) args.p_power_estimate = cleanInt(patch.powerEstimate, 0, Number.MAX_SAFE_INTEGER);
    if (patch.attacksBudget !== undefined) args.p_attacks_budget = cleanInt(patch.attacksBudget, 0, 100);
    if (patch.sortOrder !== undefined) args.p_sort_order = cleanInt(patch.sortOrder, 0, 1000);
    const note = cleanText(patch.note, WAR_NOTE_MAX_LENGTH);
    if (note) args.p_note = note;

    if (Object.keys(args).length === 3) {
        return Promise.resolve(fail<string>({ kind: 'invalid-input', message: 'Nothing to change.' }));
    }

    return withClient(async client => {
        if (options?.expectedUpdatedAt) {
            const current = await runQuery<{ updated_at: string } | null>(
                table(client, 'clan_war_participants')
                    .select('updated_at')
                    .eq('id', participantId)
                    .maybeSingle(),
            );
            if (!current.ok) return current;
            if (!current.data) {
                return fail<string>({
                    kind: 'not-found',
                    message: 'That player is no longer on this war plan. Refresh the board.',
                });
            }
            if (current.data.updated_at !== options.expectedUpdatedAt) {
                return fail<string>({
                    kind: 'version-conflict',
                    message: 'Somebody else changed this player while you were editing. Nothing was saved. Refresh to see their version.',
                    raw: `expected updated_at ${options.expectedUpdatedAt}, server has ${current.data.updated_at}`,
                });
            }
        }
        return callRpc<string>(client, 'set_war_participant', args);
    });
}

/**
 * RENAME a roster entry — the gesture the owner asked for by name, so the export says "hit Warlord
 * Bob" rather than "hit enemy 7".
 *
 * There is no dedicated rename RPC; this is `set_war_participant()`'s update branch with only the
 * name set, and it is spelled out as its own function because it is the ONE call in this module
 * whose failure carries a raw Postgres message from the server: renaming onto a name that is
 * already used on that side answers `23505 duplicate key value violates unique constraint
 * "clan_war_participants_name_key"` (measured, verbatim). `classifyWarPlanError()` catches the
 * constraint name, which is why that string cannot reach the DOM.
 *
 * It renames DUMMIES and real members alike. Renaming a real member changes only the SNAPSHOT: the
 * export view prefers their live profile name while they are still in the clan, so a rename shows
 * up on the sheet only once they have left. That is deliberate, not a bug.
 */
export function renameWarParticipant(
    planId: string,
    participantId: string,
    side: WarSide,
    displayName: string,
    options?: { expectedUpdatedAt?: string },
): Promise<WarPlanResult<string>> {
    const name = cleanText(displayName, WAR_NAME_MAX_LENGTH);
    if (!name) {
        return Promise.resolve(fail<string>({
            kind: 'invalid-input',
            message: 'A name cannot be empty.',
        }));
    }
    return updateWarParticipant(planId, participantId, side, { displayName: name }, options);
}

/**
 * "CREATE THEM IN BATCH BY CHOOSING THE NUMBER OF USERS" — the owner's words, built as a client
 * loop because **0009 has no batch RPC**. Verified: the only function that inserts a participant is
 * `set_war_participant()`, and it inserts exactly one row.
 *
 * COST: `1 + count` requests. The leading one reads the names already on that side so the generated
 * ones do not collide — without it, "add 20 enemies" onto a roster that already has "Enemy 3" would
 * fail at the third call with a duplicate-name error the leader did not cause and cannot see the
 * reason for. With it, the numbering simply skips what is taken.
 *
 * PARTIAL SUCCESS IS REPORTED, NOT ROLLED BACK. There is no transaction across N HTTP requests, so
 * if the 17th fails, 16 enemies exist. Resolving `ok: false` would tell the leader nothing happened
 * and leave them to discover otherwise, so this resolves `ok: true` with `stoppedBy` set and the
 * caller compares `created.length` with `requested`.
 *
 * The names are `${prefix} ${n}` and every one of them is meant to be RENAMED — that is the whole
 * point of `renameWarParticipant()`. A batch is scaffolding for a roster the leader then fills in
 * as they read the opposing guild off their own screen.
 */
export function createEnemyDummies(
    planId: string,
    count: number,
    options?: { prefix?: string; powerEstimate?: number },
): Promise<WarPlanResult<CreateEnemiesResult>> {
    const requested = Math.min(Math.max(Math.round(Number(count) || 0), 0), WAR_ENEMY_BATCH_MAX);
    if (requested <= 0) {
        return Promise.resolve(fail<CreateEnemiesResult>({
            kind: 'invalid-input',
            message: `Choose how many enemies to add, between 1 and ${WAR_ENEMY_BATCH_MAX}.`,
        }));
    }
    // Leave room for " 50": the column caps the whole name at 32 characters, and a prefix that
    // used all of it would make every generated name collide after truncation.
    const prefix = cleanText(options?.prefix, WAR_NAME_MAX_LENGTH - 4) || 'Enemy';

    return withClient(async client => {
        const existing = await runQuery<{ display_name: string }[] | null>(
            table(client, 'clan_war_participants')
                .select('display_name')
                .eq('plan_id', planId)
                .eq('side', 'enemy'),
        );
        if (!existing.ok) return existing;

        // The unique index is on `lower(btrim(display_name))`, so the taken set has to be compared
        // the same way or the skip would not actually skip.
        const taken = new Set((existing.data ?? []).map(r => r.display_name.trim().toLowerCase()));

        const created: string[] = [];
        const names: string[] = [];
        let next = 1;
        let stoppedBy: WarPlanError | null = null;

        for (let made = 0; made < requested; made += 1) {
            let name = `${prefix} ${next}`;
            while (taken.has(name.toLowerCase())) {
                next += 1;
                name = `${prefix} ${next}`;
            }
            next += 1;

            const args: Record<string, unknown> = {
                p_plan_id: planId,
                p_side: 'enemy',
                p_display_name: name,
            };
            if (options?.powerEstimate !== undefined) {
                args.p_power_estimate = cleanInt(options.powerEstimate, 0, Number.MAX_SAFE_INTEGER);
            }

            const result = await callRpc<string>(client, 'set_war_participant', args);
            if (!result.ok) {
                stoppedBy = result.error;
                break;
            }
            taken.add(name.toLowerCase());
            created.push(result.data);
            names.push(name);
        }

        return ok<CreateEnemiesResult>({ requested, created, names, stoppedBy });
    });
}

/**
 * `delete_war_participant(p_participant_id uuid) RETURNS integer`
 *
 * LEADERS ONLY. Resolves with HOW MANY ATTACK ORDERS WENT WITH IT — the FK cascade removes every
 * assignment where this row was the attacker OR the target, so removing one enemy silently deletes
 * everybody's orders against it. Show the number: measured, deleting one enemy that was somebody's
 * target returned 1.
 *
 * A participant that does not exist and one belonging to another clan both answer 42501, on
 * purpose, so this is not an existence oracle.
 */
export function removeWarParticipant(participantId: string): Promise<WarPlanResult<number>> {
    return withClient(async client => {
        const result = await callRpc<number>(client, 'delete_war_participant', {
            p_participant_id: participantId,
        });
        return result.ok ? ok(Number(result.data) || 0) : result;
    });
}

/** One attack order: who to hit, and optionally why. `slot` is the array position, not a field. */
export interface WarOrder {
    targetId: string;
    note?: string;
}

/**
 * `set_war_assignments(p_attacker_id uuid, p_targets jsonb) RETURNS integer`
 *
 * LEADERS ONLY. REPLACES one ally's whole order list atomically, so a half-saved board cannot
 * exist, and the array POSITION becomes `slot` — the leader's order is the export's order.
 *
 * An EMPTY array is the "clear this player's orders" gesture and is not an error: measured,
 * `set_war_assignments(ally, '[]')` returned 0 and left that attacker with no rows.
 *
 * THIS IS WHERE "a member cannot assign themselves a softer target" IS ENFORCED, and it is enforced
 * by refusing the member outright rather than by comparing strengths — which could not be trusted
 * anyway, since `power_estimate` is a leader's guess about an opponent the tool cannot read.
 *
 * `expectedAssignmentIds` is the precondition, and this attacker's current ids are the right thing
 * to compare because the RPC deletes and re-inserts: the ids change whenever anything about the
 * orders changed, including a reorder that kept the same targets.
 */
export function setAttackerOrders(
    attackerId: string,
    orders: WarOrder[],
    options?: { expectedAssignmentIds?: string[] },
): Promise<WarPlanResult<number>> {
    if (orders.length > WAR_MAX_SLOTS_PER_ATTACKER) {
        return Promise.resolve(fail<number>({
            kind: 'invalid-input',
            message: `A player can be given at most ${WAR_MAX_SLOTS_PER_ATTACKER} attacks.`,
        }));
    }

    const targets = orders.map(order => {
        const note = cleanText(order.note, WAR_NOTE_MAX_LENGTH);
        return note ? { target_id: order.targetId, note } : { target_id: order.targetId };
    });

    return withClient(async client => {
        if (options?.expectedAssignmentIds) {
            const current = await runQuery<{ id: string }[] | null>(
                table(client, 'clan_war_assignments')
                    .select('id')
                    .eq('attacker_id', attackerId)
                    .order('slot', { ascending: true }),
            );
            if (!current.ok) return current;
            const seen = (current.data ?? []).map(r => r.id).join(',');
            const expected = [...options.expectedAssignmentIds].join(',');
            if (seen !== expected) {
                return fail<number>({
                    kind: 'version-conflict',
                    message: 'Somebody else changed this player\'s attacks while you were editing. Nothing was saved. Refresh to see their version.',
                    raw: `expected [${expected}], server has [${seen}]`,
                });
            }
        }
        const result = await callRpc<number>(client, 'set_war_assignments', {
            p_attacker_id: attackerId,
            p_targets: targets,
        });
        return result.ok ? ok(Number(result.data) || 0) : result;
    });
}

/**
 * `clear_war_assignments(p_plan_id uuid) RETURNS integer`
 *
 * LEADERS ONLY. Deletes every attack order in the plan and leaves both rosters standing. Resolves
 * with how many were removed. There is no undo: make the UI say so before calling.
 */
export function clearWarAssignments(planId: string): Promise<WarPlanResult<number>> {
    return withClient(async client => {
        const result = await callRpc<number>(client, 'clear_war_assignments', { p_plan_id: planId });
        return result.ok ? ok(Number(result.data) || 0) : result;
    });
}

/**
 * `publish_clan_war_plan(p_plan_id uuid, p_notify boolean DEFAULT true) RETURNS jsonb`
 *
 * LEADERS ONLY. Publishing does TWO things in ONE transaction, and both matter:
 *   * it makes the plan visible to plain members at all (drafts are leader-only), and
 *   * unless `notify: false`, it queues one notification per clan-mate ACCOUNT.
 * A failed broadcast rolls the publish back, so the clan is never told to look at a draft.
 *
 * `rate-limited` is the expected refusal on a double click: the broadcast is capped at one a
 * minute per clan and the whole publish rolls back with it — which is right, since nothing had
 * changed. Measured: the second publish inside a minute raised `54000 the clan was notified less
 * than a minute ago; wait before sending again`.
 *
 * `notify: false` is the typo-fix path: republish without pinging fifty phones. Measured to return
 * `notified: 0`.
 *
 * READ THE MODULE HEADER ABOUT WHO GETS THE PUSH. The fan-out has no preference filter, so this
 * reaches every account in the clan that has a live device, whether or not they asked for war
 * notifications. `WAR_PUSH_OPT_OUT_IS_SERVER_SIDE` is `false` until a migration adds the column.
 */
export function publishWarPlan(
    planId: string,
    options?: { notify?: boolean },
): Promise<WarPlanResult<PublishWarPlanResult>> {
    return withClient(async client => {
        const result = await callRpc<PublishWarPlanResult | null>(client, 'publish_clan_war_plan', {
            p_plan_id: planId,
            p_notify: options?.notify ?? true,
        });
        if (!result.ok) return result;
        if (!result.data || !result.data.plan) {
            return fail<PublishWarPlanResult>({
                kind: 'unknown',
                message: 'The plan was published but the server did not say what it now holds. Refresh the board.',
            });
        }
        return ok(result.data);
    });
}

/**
 * `broadcast_clan_notification(p_clan_id uuid, p_title text, p_body text, p_url text DEFAULT NULL,
 *  p_dedupe_key text DEFAULT NULL) RETURNS integer`
 *
 * LEADERS ONLY. "Remind the clan" without republishing — one queue row per clan-mate ACCOUNT,
 * resolving with how many were queued. One a minute per clan.
 *
 * THE DESTINATION IS NOT AUTHOR-CONTROLLED, and that is the security decision in this function.
 * The title and body are leader-authored free text, but a leader must not choose where fifty
 * devices are sent when the notification is tapped, or a clan admin could phish their own clan
 * with a push that looks like it came from this tool. So there is no URL parameter: `route` is a
 * hash fragment, it is validated against a deliberately narrow character set, and it is appended to
 * `WAR_PUSH_BASE_URL`, which is the host `assert_push_payload()` pins server-side anyway.
 *
 * The title and body must be rendered as TEXT and never as HTML wherever they are echoed back —
 * the same reader discipline `clan_share` gets, and for the same reason: attributed, but unverified.
 */
export function notifyClan(
    clanId: string,
    title: string,
    body: string,
    options?: { route?: string; dedupeKey?: string },
): Promise<WarPlanResult<number>> {
    const cleanTitle = cleanText(title, 120);
    if (!cleanTitle) {
        return Promise.resolve(fail<number>({
            kind: 'invalid-input',
            message: 'A notification needs a title.',
        }));
    }

    // A route is `/clan`, `/war-plan`, `/attacks/3` and nothing else. Anything with a scheme, a
    // host, a backslash or a `..` in it is dropped rather than sanitised, because a URL that is
    // ALMOST right is the dangerous case.
    const route = options?.route;
    const safeRoute = route && /^\/[A-Za-z0-9/_-]{0,80}$/.test(route) && !route.includes('..')
        ? route
        : '/clan';

    const args: Record<string, unknown> = {
        p_clan_id: clanId,
        p_title: cleanTitle,
        p_body: cleanText(body, 400) ?? '',
        p_url: `${WAR_PUSH_BASE_URL}#${safeRoute}`,
    };
    const dedupe = cleanText(options?.dedupeKey, 200);
    if (dedupe) args.p_dedupe_key = dedupe;

    return withClient(async client => {
        const result = await callRpc<number>(client, 'broadcast_clan_notification', args);
        return result.ok ? ok(Number(result.data) || 0) : result;
    });
}

/* ------------------------------------------------------------------------------------------ *
 * The export — "for every character, who they must attack"
 * ------------------------------------------------------------------------------------------ */

/** One attacker and their orders, as the sheet groups them. `orders` is empty for an unassigned ally. */
export interface WarSheetGroup {
    attackerId: string;
    name: string;
    /** A real ally whose profile was deleted. Say so rather than showing a stale name silently. */
    orphaned: boolean;
    kind: WarMemberKind;
    /** The per-player override already resolved against the plan default, by the database. */
    attacks: number;
    note: string | null;
    orders: { slot: number; targetName: string; note: string | null }[];
}

/**
 * Groups `clan_war_assignment_sheet` rows by attacker, preserving the view's order.
 *
 * An ally with no orders arrives as ONE row with every `slot`/`target_*` column null, and comes out
 * here as a group with an empty `orders` array — never dropped. "Nobody has been given a target" is
 * the thing a leader most needs to see before handing the sheet out.
 */
export function groupSheetByAttacker(rows: WarSheetRow[]): WarSheetGroup[] {
    const groups: WarSheetGroup[] = [];
    const index = new Map<string, WarSheetGroup>();

    for (const row of rows) {
        let group = index.get(row.attacker_id);
        if (!group) {
            group = {
                attackerId: row.attacker_id,
                name: row.attacker_name,
                orphaned: row.attacker_orphaned,
                kind: row.attacker_kind,
                attacks: row.attacker_attacks,
                note: row.attacker_note,
                orders: [],
            };
            index.set(row.attacker_id, group);
            groups.push(group);
        }
        if (row.slot !== null && row.target_name !== null) {
            group.orders.push({ slot: row.slot, targetName: row.target_name, note: row.order_note });
        }
    }
    return groups;
}

/**
 * The plan as plain text, for pasting into Discord.
 *
 * DRIVEN FROM THE SHEET VIEW, never from the board, so the text a leader pastes and the screen they
 * built it on cannot disagree — the view is the one place a live profile name is resolved, and it
 * resolves only through `clan_members` so a kicked member's current name never leaks into a message
 * posted in public.
 *
 * PLAIN TEXT, NOT MARKDOWN, by default. Discord renders `_` and `*` inside a player's name as
 * formatting, so a name like `*_Bob_*` would come out as a bold-italic "Bob" and the sheet would no
 * longer say who to hit. `codeBlock: true` wraps the whole thing in a fence, which is the reliable
 * way to make Discord leave a roster alone.
 *
 * ALLIES WITH NO ORDERS ARE LISTED, under their own heading. A leader who pastes this into their
 * clan chat needs the sheet to say "these four have nothing yet" out loud.
 */
export function buildDiscordExport(
    rows: WarSheetRow[],
    options?: { codeBlock?: boolean; includeUnassigned?: boolean; heading?: string },
): string {
    if (rows.length === 0) return 'No war plan to export yet.';

    const first = rows[0];
    const groups = groupSheetByAttacker(rows);
    const assigned = groups.filter(g => g.orders.length > 0);
    const idle = groups.filter(g => g.orders.length === 0);

    const lines: string[] = [];
    const opponent = first.opponent_name
        ? `${first.opponent_name}${first.opponent_tag ? ` [${first.opponent_tag}]` : ''}`
        : 'the other guild';
    lines.push(options?.heading ?? `War plan, week of ${first.week_start} vs ${opponent}`);
    // battle_day is a config index; humans see it +1, because GuildWar.tsx labels index 5 "Day 6".
    lines.push(`Battle day: Day ${first.battle_day + 1}${first.status === 'draft' ? ' (DRAFT)' : ''}`);
    lines.push('');

    for (const group of assigned) {
        const suffix = group.orphaned ? ' (profile deleted)' : '';
        lines.push(`${group.name}${suffix} - ${group.orders.length}/${group.attacks} attacks`);
        for (const order of group.orders) {
            lines.push(`  ${order.slot}. ${order.targetName}${order.note ? ` - ${order.note}` : ''}`);
        }
        lines.push('');
    }

    if ((options?.includeUnassigned ?? true) && idle.length > 0) {
        // The orphan marker rides along HERE TOO, not only in the assigned blocks above. An ally
        // whose profile was deleted and who has no orders is the single row a leader most needs
        // flagged before they hand the sheet out: it is a name that will never act on it. The first
        // version of this function marked orphans only where they had orders, and that row went out
        // looking like an ordinary player who had simply been forgotten.
        lines.push(
            `No orders yet: ${idle.map(g => `${g.name}${g.orphaned ? ' (profile deleted)' : ''}`).join(', ')}`,
        );
        lines.push('');
    }

    const text = lines.join('\n').trimEnd();
    return options?.codeBlock ? `\`\`\`\n${text}\n\`\`\`` : text;
}

/**
 * Splits an export into Discord-sized messages.
 *
 * Discord refuses a message over 2000 characters, and a 50-player sheet with five attacks each is
 * comfortably past that — so an export that is not split is an export that cannot be pasted. Breaks
 * on blank lines first (which is a whole player's block) and on line ends after that, so a player's
 * orders are never cut in half. 1900 leaves room for a code fence the caller may add.
 */
export function splitForDiscord(text: string, limit = 1900): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let current = '';
    for (const block of text.split('\n\n')) {
        const candidate = current ? `${current}\n\n${block}` : block;
        if (candidate.length <= limit) {
            current = candidate;
            continue;
        }
        if (current) {
            chunks.push(current);
            current = '';
        }
        if (block.length <= limit) {
            current = block;
            continue;
        }
        // One block bigger than a whole message: a single player with very long notes. Fall back to
        // line granularity, and to a hard cut only if even one line is too long.
        let line = '';
        for (const raw of block.split('\n')) {
            const next = line ? `${line}\n${raw}` : raw;
            if (next.length <= limit) {
                line = next;
                continue;
            }
            if (line) chunks.push(line);
            line = raw.length <= limit ? raw : raw.slice(0, limit);
        }
        current = line;
    }
    if (current) chunks.push(current);
    return chunks;
}
