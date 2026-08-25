/**
 * useProfileSync — the profile sync engine.
 * ========================================
 *
 * WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT
 * -------------------------------------------
 * `localStorage` remains the working copy: `ProfileContext` writes it 500 ms after every edit,
 * exactly as it always has, and **nothing in the UI ever waits on the network to read or write a
 * profile**. This engine is a *second, additive* writer that mirrors those local profiles into
 * `public.profiles`. That asymmetry is the whole design:
 *
 *   - signed out, or no `VITE_SUPABASE_*` in the build  -> this engine does nothing at all;
 *   - signed in but offline                             -> edits keep landing in localStorage and
 *                                                          are pushed when the network returns;
 *   - signed in and online                              -> localStorage first, server shortly after.
 *
 * So "no backend" and "offline" are not degraded modes: they are the same code path the app has
 * always used, with an idle mirror alongside.
 *
 * WHEN IT WRITES (BACKEND_PLAN §5)
 * --------------------------------
 *   - 5 s after the last edit (debounce — a profile edit is a burst of small state updates);
 *   - every 60 s regardless, so a long editing session cannot sit unsaved for minutes;
 *   - when the tab is hidden (`visibilitychange`) or being unloaded (`pagehide` /
 *     `beforeunload`) — the hidden-tab hook is the reliable one on mobile, unload is best effort;
 *   - when the browser reports the network is back (`online`).
 *
 * HOW IT AVOIDS EATING THE OTHER DEVICE'S WORK
 * --------------------------------------------
 * Every push is `update  where id = ? and version = <the version we last saw>`
 * (`RemoteProfileStore.put`). The "version we last saw" comes from `syncLedger`. Zero rows
 * updated means another device wrote first, and instead of retrying harder the engine **stops
 * pushing that profile** and raises the conflict UX: keep mine / take theirs / duplicate mine.
 * Nothing is ever overwritten without a person choosing it.
 *
 * FIRST LOGIN IS AN EXPLICIT SCREEN, NEVER A GUESS
 * -----------------------------------------------
 * The first time an account signs in *in this browser*, local and server profiles are listed side
 * by side — local-only, server-only, present in both — and each row gets a decision. `mergedAt` in
 * the ledger records that it happened, so it appears once and can be reopened on demand
 * ("Review differences"). After that the steady state is: local edits push, profiles created on
 * another device are pulled, local deletes propagate as soft deletes, and anything ambiguous
 * raises the conflict UX instead of resolving itself.
 *
 * A DECISION NOT TO UPLOAD IS ALSO A DECISION
 * -------------------------------------------
 * Answering "leave this in this browser only" on that screen is remembered (`keptLocal` in the
 * ledger) and honoured by every automatic path: `flush` never pushes such a profile, so the answer
 * cannot be reversed behind the user's back. It is not a dead end either — the profile keeps its
 * row on the merge screen, which is what `syncNow()` reopens, so "upload it after all" is always
 * available. That row comes back with the recorded answer pre-selected, never with "Upload":
 * confirming a screen must not be able to reverse a decision the user is not looking at. Only a
 * profile *created after* that screen auto-pushes: nobody was ever asked about it, so asking now
 * would be noise.
 *
 * The set is cleared the moment a push or a pull proves the profile *is* in the account
 * (`pushProfile` / `pullProfile`), so a stale id can never outlive its meaning and quietly exclude
 * a profile from syncing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserProfile } from '../types/Profile';
import { generateProfileId } from '../types/Profile';
import {
    bodyForStorage,
    createRemoteProfileStore,
    isDeleted,
    type ProfileSummary,
    type RemoteProfileStore,
    type SyncStatus,
} from './profileStore';
import {
    fingerprint,
    forgetEntry,
    forgetKeptLocal,
    keptLocalOf,
    markMerged,
    readLedger,
    rememberEntry,
    rememberKeptLocal,
    type LedgerEntry,
    type UserLedger,
} from './syncLedger';
import { getAuthSnapshot, subscribeAuth } from '../context/AuthContext';

/* ------------------------------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------------------------------ */

/** Idle time before a push. Long enough that dragging a slider is one write, not fifty. */
const DEBOUNCE_MS = 5_000;
/** Ceiling on how long an edited profile can stay unpushed while the user keeps working. */
const HARD_FLUSH_MS = 60_000;

/* ------------------------------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------------------------------ */

/** How a local profile and its server row differ. */
export type DiffKind =
    /** Exists locally, no row on the server. */
    | 'local-only'
    /** Live row on the server, no local profile. */
    | 'server-only'
    /** Both exist, but this browser has no record of a shared base (first login, cleared ledger). */
    | 'unknown-base'
    /** Both exist and the server moved past the version we based our copy on. */
    | 'diverged'
    /** The server row is a tombstone, but the profile is still here. */
    | 'server-deleted';

/**
 * Per-row decision.
 *  - `local`  keep this browser's copy (push it, overwriting the server row)
 *  - `server` keep the server's copy (replace the local body with it)
 *  - `both`   keep both: the local one stays as it is, the server one arrives as a NEW profile
 *  - `skip`   change nothing anywhere; the row stays out of sync until next time
 */
export type MergeChoice = 'local' | 'server' | 'both' | 'skip';

export interface MergeRow {
    /** Profile id. For `server-only` rows this is the id the pulled profile will keep. */
    id: string;
    kind: DiffKind;
    localName: string | null;
    localIconIndex: number | null;
    serverName: string | null;
    serverVersion: number | null;
    /** Epoch ms of the server row's `updated_at`. */
    serverUpdatedAt: number | null;
    /** Epoch ms of the last successful sync of this profile from this browser, if any. */
    lastSyncedAt: number | null;
    /** Which choices make sense for this row. */
    choices: MergeChoice[];
    choice: MergeChoice;
}

/** A push that was rejected because the server row had moved on. */
export interface ConflictInfo {
    id: string;
    localName: string;
    serverName: string;
    serverVersion: number;
    serverUpdatedAt: number;
}

export type ConflictResolution = 'mine' | 'theirs' | 'duplicate';

/**
 * How the engine writes back into `ProfileContext`'s state. A functional updater (rather than a
 * plain setter) because a pull can land while the user is typing: the engine must merge into the
 * *current* array, not one captured when the request started. Returning `null` means "nothing to
 * change", which avoids a pointless re-render.
 */
export type ApplyLocalProfiles = (
    mutate: (
        profiles: UserProfile[],
        activeId: string,
    ) => { profiles: UserProfile[]; activeId: string } | null,
) => void;

export interface ProfileSyncApi {
    status: SyncStatus;
    /** Extra detail for the indicator's tooltip; `null` when there is nothing to say. */
    message: string | null;
    /** Epoch ms of the last successful push/pull, or `null`. */
    lastSyncedAt: number | null;
    /** Profiles with unpushed local edits. */
    pendingCount: number;
    /**
     * Local profiles that, as far as this browser knows, have no row in the account: never
     * uploaded, or uploaded-then-hard-deleted elsewhere. Kept separate from `pendingCount` on
     * purpose — these are not edits queued behind a slow network, they are profiles that are
     * deliberately absent, and counting them in the indicator's badge would make it lie.
     */
    notUploadedCount: number;
    /** A network operation is in flight (push, pull, merge). */
    busy: boolean;

    /** The merge screen's rows, or `null` when there is nothing to decide. */
    review: MergeRow[] | null;
    reviewOpen: boolean;
    openReview: () => void;
    closeReview: () => void;
    setReviewChoice: (id: string, choice: MergeChoice) => void;
    applyReview: () => Promise<void>;
    /** True while the first-login merge has not been completed in this browser. */
    mergePending: boolean;

    conflict: ConflictInfo | null;
    resolveConflict: (resolution: ConflictResolution) => Promise<void>;

    /**
     * The "Sync now" button. Re-reads the account first, so the outcome is decided on the server's
     * actual contents: if anything is waiting for the user — a divergence, or a profile that is
     * simply not in the account — the merge screen opens instead of writing. Otherwise it pushes,
     * exactly like `flushNow()`.
     */
    syncNow: () => Promise<void>;
    /** Push now, ignoring the debounce. Also the entry point of every automatic trigger. */
    flushNow: () => Promise<void>;
    /** Re-read the server and recompute the diff. */
    refresh: () => Promise<void>;
}

export interface UseProfileSyncArgs {
    profiles: UserProfile[];
    activeProfileId: string;
    /**
     * True while the app is showing someone else's shared profile (or still decoding a share
     * link). Nothing may be pushed then: what is on screen is not the user's own data.
     */
    suspended: boolean;
    applyLocalProfiles: ApplyLocalProfiles;
}

/* ------------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------------ */

const IDLE: ProfileSyncApi['status'] = 'local-only';

function uniqueName(desired: string, taken: Set<string>): string {
    const base = desired.trim() || 'Profile';
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 500; i++) {
        const candidate = `${base} (${i})`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${Date.now()}`;
}

const nameSet = (profiles: UserProfile[]): Set<string> =>
    new Set(profiles.map(p => (p.name || '').toLowerCase()));

/**
 * How many local profiles are out of the account **because the user said so**.
 *
 * The tempting definition — "has no ledger entry" — is wrong, and wrong in a way that makes the UI
 * lie. A missing entry also covers a profile created two seconds ago, and one whose push just
 * failed: calling either of those "only in this browser" presents an accident as a decision, and it
 * lets the panel print a count that disagrees with the number of rows the merge screen can show.
 * A failed push is already reported, honestly, by `pendingCount` and the status pill.
 *
 * So this counts exactly the `keptLocal` ids that are still here and still absent from the account.
 * That set is also the one `computeReview` always turns into rows, which is what keeps the panel's
 * count and the modal's row count in agreement.
 */
function countKeptOutOfAccount(localProfiles: UserProfile[], ledger: UserLedger): number {
    const keptLocal = keptLocalOf(ledger);
    if (keptLocal.size === 0) return 0;
    return localProfiles.reduce(
        (n, p) => (keptLocal.has(p.id) && !ledger.entries[p.id] ? n + 1 : n),
        0,
    );
}

/**
 * Is this row an outstanding question, or a standing offer? A `local-only` row for a profile the
 * user has already answered "leave it in this browser" about is the second kind: it keeps its place
 * on the merge screen so it can still be uploaded later, but it must NOT stop the automatic pushes
 * and pulls of every other profile, the way a real undecided row does.
 */
function needsDecision(row: MergeRow, keptLocal: ReadonlySet<string>): boolean {
    return !(row.kind === 'local-only' && keptLocal.has(row.id));
}

/* ------------------------------------------------------------------------------------------ *
 * Diff computation
 * ------------------------------------------------------------------------------------------ *
 * Pure, and at module scope because it is: it reads nothing but its arguments, which also makes it
 * directly testable (reverseForge/scratch/kept_local_check.ts).
 */

export function computeReview(
    localProfiles: UserProfile[],
    summaries: ProfileSummary[],
    ledger: UserLedger,
    firstLogin: boolean,
): { rows: MergeRow[]; autoPush: string[]; autoPull: string[]; autoDelete: string[] } {
    const byId = new Map(localProfiles.map(p => [p.id, p] as const));
    const server = new Map(summaries.map(s => [s.id, s] as const));
    const keptLocal = keptLocalOf(ledger);

    const rows: MergeRow[] = [];
    const autoPush: string[] = [];
    const autoPull: string[] = [];
    const autoDelete: string[] = [];

    for (const profile of localProfiles) {
        const row = server.get(profile.id);
        const entry = ledger.entries[profile.id];

        if (!row) {
            // Never pushed (or the row was hard-deleted server side). Two reasons to ask instead
            // of pushing: the first-login merge asks about everything, and a profile the user has
            // already chosen to keep here must be *offered* every time, never pushed by itself.
            // Anything else is a profile created after that screen — nobody was asked about it,
            // so asking now would be noise.
            if (firstLogin || keptLocal.has(profile.id)) {
                rows.push({
                    id: profile.id,
                    kind: 'local-only',
                    localName: profile.name,
                    localIconIndex: profile.iconIndex ?? 0,
                    serverName: null,
                    serverVersion: null,
                    serverUpdatedAt: null,
                    lastSyncedAt: entry?.at ?? null,
                    choices: ['local', 'skip'],
                    // The default must be the answer already on record, never its opposite. For a
                    // profile the user chose to keep here, pre-selecting "Upload" would mean that
                    // an Apply — including one aimed at a *different* row on the same screen —
                    // silently reverses that decision. On a first login nothing is on record yet,
                    // and there "Upload" is the lossless default.
                    choice: keptLocal.has(profile.id) ? 'skip' : 'local',
                });
            } else {
                autoPush.push(profile.id);
            }
            continue;
        }

        if (isDeleted(row)) {
            // Deleted on another device but still here. Resurrect or accept — a decision,
            // never a silent removal of a profile the user can still see.
            rows.push({
                id: profile.id,
                kind: 'server-deleted',
                localName: profile.name,
                localIconIndex: profile.iconIndex ?? 0,
                serverName: row.name,
                serverVersion: row.version,
                serverUpdatedAt: row.updatedAt,
                lastSyncedAt: entry?.at ?? null,
                choices: ['local', 'server'],
                choice: 'local',
            });
            continue;
        }

        const localHash = fingerprint(bodyForStorage(profile));

        if (!entry) {
            // Both sides have it, but this browser has no shared base to reason from.
            //
            // The default is normally 'server': with no base, the account copy is the one another
            // device deliberately put there, and taking it is the least surprising outcome.
            //
            // EXCEPT for a profile the user explicitly kept out of the account. Its id turning up
            // on the server means somebody uploaded it elsewhere — and offering "Take theirs" as
            // the pre-selected answer would default to replacing the very body the user asked us
            // to leave alone. 'both' is the lossless reading of the same situation: their copy
            // arrives as an extra profile and nothing local is touched.
            rows.push({
                id: profile.id,
                kind: 'unknown-base',
                localName: profile.name,
                localIconIndex: profile.iconIndex ?? 0,
                serverName: row.name,
                serverVersion: row.version,
                serverUpdatedAt: row.updatedAt,
                lastSyncedAt: null,
                choices: ['local', 'server', 'both'],
                choice: keptLocal.has(profile.id) ? 'both' : 'server',
            });
            continue;
        }

        if (entry.version !== row.version) {
            rows.push({
                id: profile.id,
                kind: 'diverged',
                localName: profile.name,
                localIconIndex: profile.iconIndex ?? 0,
                serverName: row.name,
                serverVersion: row.version,
                serverUpdatedAt: row.updatedAt,
                lastSyncedAt: entry.at,
                // The server moved; our local edits (if any) are on an old base.
                choices: ['local', 'server', 'both'],
                choice: entry.hash === localHash ? 'server' : 'both',
            });
            continue;
        }

        // Same base. Push only if the user actually changed something.
        if (entry.hash !== localHash) autoPush.push(profile.id);
    }

    for (const summary of summaries) {
        if (byId.has(summary.id)) continue;
        const entry = ledger.entries[summary.id];

        if (isDeleted(summary)) {
            // Gone on both sides: the tombstone has served its purpose here.
            if (entry) autoDelete.push(`__forget:${summary.id}`);
            continue;
        }

        if (entry) {
            // We had it, it is gone locally, and the server row is still live: the user
            // deleted it here. Propagate as a soft delete so other devices learn about it.
            autoDelete.push(summary.id);
            continue;
        }

        if (firstLogin) {
            rows.push({
                id: summary.id,
                kind: 'server-only',
                localName: null,
                localIconIndex: null,
                serverName: summary.name,
                serverVersion: summary.version,
                serverUpdatedAt: summary.updatedAt,
                lastSyncedAt: null,
                choices: ['server', 'skip'],
                choice: 'server',
            });
        } else {
            // Created on another device by this same account: bringing it in adds data
            // and removes none, so it needs no confirmation.
            //
            // DELIBERATE ASYMMETRY WITH `keptLocal`, decided by the project owner. Answering
            // "leave as is" on a `server-only` row is NOT remembered: a profile that lives in
            // the account is expected to reach every device eventually, so that answer means
            // "not right now" rather than "never here". Upload is the direction where the
            // opposite is true — pushing a profile the user asked us not to push publishes
            // something against their word, while pulling one only adds a local copy they can
            // delete. Do not "fix" this into a symmetric `keptRemote` set without asking.
            autoPull.push(summary.id);
        }
    }

    return { rows, autoPush, autoPull, autoDelete };
}

/* ------------------------------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------------------------------ */

export function useProfileSync({
    profiles,
    activeProfileId,
    suspended,
    applyLocalProfiles,
}: UseProfileSyncArgs): ProfileSyncApi {
    // `createRemoteProfileStore()` returns null when no backend is configured, which short-circuits
    // every code path below. One check, one decision.
    const remote = useMemo<RemoteProfileStore | null>(() => createRemoteProfileStore(), []);

    const [status, setStatus] = useState<SyncStatus>(IDLE);
    const [message, setMessage] = useState<string | null>(null);
    const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
    const [pendingCount, setPendingCount] = useState(0);
    // Recomputed after every operation that can change what the account holds, rather than derived
    // from `profiles` on each render: a profile created a second ago is on its way up already, and
    // a panel line that blinked "not in your account" for the five seconds before the debounce
    // fires would be noise, not information.
    const [notUploadedCount, setNotUploadedCount] = useState(0);
    const [busy, setBusy] = useState(false);
    const [review, setReview] = useState<MergeRow[] | null>(null);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [mergePending, setMergePending] = useState(false);
    const [conflict, setConflict] = useState<ConflictInfo | null>(null);

    /* ---- always-fresh mirrors, so timers and event handlers never read stale props ---- */
    const profilesRef = useRef(profiles);
    profilesRef.current = profiles;
    const activeIdRef = useRef(activeProfileId);
    activeIdRef.current = activeProfileId;
    const suspendedRef = useRef(suspended);
    suspendedRef.current = suspended;
    const applyRef = useRef(applyLocalProfiles);
    applyRef.current = applyLocalProfiles;

    /**
     * Change the local profiles **and advance this engine's own mirror in the same breath.**
     *
     * `profilesRef` is otherwise only refreshed while rendering, and the render does not happen
     * until React's scheduler runs — which is *after* the rest of the `await` chain that made the
     * change. Every write here is paired with a ledger write that lands immediately, so a `flush()`
     * inside that window compares a brand-new ledger against a pre-change array and reaches two
     * catastrophic conclusions: "here is a ledger entry with no local profile" (soft-delete the
     * profile we just pulled) and "this profile has no entry" (push back, i.e. resurrect, the one
     * the user just accepted as deleted). Both are proven in
     * `reverseForge/scratch/sync_mirror_check.ts`.
     *
     * So the change is applied twice, to two different bases, on purpose:
     *   - to `profilesRef` now, because control flow below reads it and cannot wait for a render;
     *   - through `applyRef` (a functional updater) for React, because the authoritative array is
     *     whatever state holds when the update is processed — a user edit may have landed since.
     * `mutate` must therefore be pure. It is: the two places that mint a profile id do it *outside*
     * the updater for exactly this reason.
     */
    const applyProfiles = useCallback((
        mutate: (profiles: UserProfile[], activeId: string) => { profiles: UserProfile[]; activeId: string } | null,
    ) => {
        const optimistic = mutate(profilesRef.current, activeIdRef.current);
        if (optimistic) profilesRef.current = optimistic.profiles;
        applyRef.current(mutate);
    }, []);

    /** Signed-in user id, tracked here so the engine has no React dependency on AuthContext. */
    const [userId, setUserId] = useState<string | null>(() => getAuthSnapshot().userId);
    const userIdRef = useRef(userId);
    userIdRef.current = userId;

    /**
     * Guards read by timers and by the `await`-chains below. They exist as refs *as well as*
     * state because React batches state updates: `applyReview()` clears `mergePending` and then
     * immediately flushes, and a flush that read the (still stale) rendered value would refuse to
     * run. The refs are the truth for control flow; the state is the truth for rendering.
     */
    const mergePendingRef = useRef(false);
    const conflictRef = useRef<ConflictInfo | null>(null);

    const setMergePendingNow = useCallback((value: boolean) => {
        mergePendingRef.current = value;
        setMergePending(value);
    }, []);
    const setConflictNow = useCallback((value: ConflictInfo | null) => {
        conflictRef.current = value;
        setConflict(value);
    }, []);

    /** Profiles this engine refuses to push until a conflict is resolved. */
    const blockedRef = useRef<Set<string>>(new Set());
    /** Serialises every network operation: no two flushes, and no flush during a merge. */
    const runningRef = useRef(false);
    const debounceRef = useRef<number | null>(null);
    /** Which user the bootstrap has already run for (guards StrictMode's double effect). */
    const bootstrappedRef = useRef<string | null>(null);

    /* -------------------------------------------------------------------------------------- *
     * Track the session
     * -------------------------------------------------------------------------------------- */

    useEffect(() => {
        if (!remote) return;
        // Subscribe to the auth store directly rather than through `useAuth()`: the engine only
        // cares about one field, and subscribing here is also what lazily starts auth (session
        // restore + callback redemption) for a user who never opens the account panel.
        const update = () => {
            const next = getAuthSnapshot().userId;
            setUserId(prev => (prev === next ? prev : next));
        };
        const unsubscribe = subscribeAuth(update);
        update();
        return unsubscribe;
    }, [remote]);

    /* -------------------------------------------------------------------------------------- *
     * Primitive operations
     * -------------------------------------------------------------------------------------- */

    /** Push one profile. Returns `true` when the ledger advanced. */
    const pushProfile = useCallback(
        async (
            profile: UserProfile,
            expectedVersion: number | null,
        ): Promise<'ok' | 'conflict' | 'offline' | 'error'> => {
            if (!remote) return 'error';
            const uid = userIdRef.current;
            if (!uid) return 'error';

            const hash = fingerprint(bodyForStorage(profile));
            const result = await remote.put(profile, { expectedVersion });

            if (result.ok) {
                const entry: LedgerEntry = { version: result.summary.version, hash, at: Date.now() };
                rememberEntry(uid, profile.id, entry);
                // The profile is in the account now, so any "leave it in this browser only" on
                // record is spent. Clearing it *here* — the one place that learns the profile
                // arrived — is what keeps the set from going stale: a stale id survives a later
                // `forgetEntry` (a hard delete elsewhere) and would then freeze the profile out of
                // every automatic push, silently, for a decision the user has already reversed.
                forgetKeptLocal(uid, profile.id);
                return 'ok';
            }
            if (result.reason === 'conflict') {
                const current = result.current;
                blockedRef.current.add(profile.id);
                setConflictNow({
                    id: profile.id,
                    localName: profile.name,
                    serverName: current?.summary.name ?? profile.name,
                    serverVersion: current?.summary.version ?? 0,
                    serverUpdatedAt: current?.summary.updatedAt ?? 0,
                });
                return 'conflict';
            }
            if (result.reason === 'offline') return 'offline';
            if (result.reason === 'not-found') {
                // The row vanished (hard delete elsewhere). Forget the base and let the next
                // flush re-insert it: a profile the user still has locally must not disappear.
                forgetEntry(uid, profile.id);
                return 'error';
            }
            setMessage(result.message ?? null);
            return 'error';
        },
        [remote, setConflictNow],
    );

    /** Pull one profile into the local array (adding or replacing). */
    const pullProfile = useCallback(
        async (id: string, mode: 'replace' | 'add-copy'): Promise<'ok' | 'offline' | 'error'> => {
            if (!remote) return 'error';
            const uid = userIdRef.current;
            if (!uid) return 'error';

            const result = await remote.get(id);
            if (!result.ok) {
                if (result.reason === 'offline') return 'offline';
                setMessage(result.message ?? null);
                return 'error';
            }

            const { summary, body } = result.record;

            if (mode === 'replace') {
                applyProfiles((prev, activeId) => {
                    const index = prev.findIndex(p => p.id === id);
                    const next = index >= 0
                        ? prev.map((p, i) => (i === index ? body : p))
                        : [...prev, body];
                    return { profiles: next, activeId: next.some(p => p.id === activeId) ? activeId : body.id };
                });
                rememberEntry(uid, id, {
                    version: summary.version,
                    hash: fingerprint(bodyForStorage(body)),
                    at: Date.now(),
                });
                // It demonstrably is in the account: same reasoning as in `pushProfile`.
                forgetKeptLocal(uid, id);
                return 'ok';
            }

            // 'add-copy': the server row arrives as a brand-new local profile so the local one is
            // untouched. It gets a fresh id, which means it is NOT tracked against the server row
            // (a new id would be a new row) — deliberate: "keep both" must not silently start
            // overwriting the copy the user wanted to preserve.
            // Minted out here, not inside the updater: the updater must be pure (see
            // `applyProfiles`, and React re-runs updaters in StrictMode), and a fresh id is not.
            const copy: UserProfile = {
                ...body,
                id: generateProfileId(),
                name: uniqueName(`${body.name} (from server)`, nameSet(profilesRef.current)),
                isShared: undefined,
            };
            applyProfiles(prev => ({ profiles: [...prev, copy], activeId: activeIdRef.current }));
            return 'ok';
        },
        [remote, applyProfiles],
    );

    /* -------------------------------------------------------------------------------------- *
     * Flush: push every locally-changed profile, propagate local deletes
     * -------------------------------------------------------------------------------------- */

    const flush = useCallback(async (): Promise<void> => {
        if (!remote) return;
        const uid = userIdRef.current;
        if (!uid || suspendedRef.current) return;
        if (runningRef.current) return;
        // A pending merge means the user has not told us what the server copy is worth yet; and a
        // live conflict means one profile is disputed. Neither may be resolved by pushing.
        if (mergePendingRef.current || conflictRef.current) return;

        runningRef.current = true;
        setBusy(true);
        try {
            let ledger = readLedger(uid);
            const keptLocal = keptLocalOf(ledger);
            const localProfiles = profilesRef.current;
            const localIds = new Set(localProfiles.map(p => p.id));

            let wrote = false;
            let offline = false;

            // ---- local deletes: a ledger entry with no local profile ------------------------
            // Correct only because `profilesRef` is never behind the ledger — see `applyProfiles`.
            for (const id of Object.keys(ledger.entries)) {
                if (localIds.has(id)) continue;
                const result = await remote.softDelete(id, { expectedVersion: null });
                if (result.ok || result.reason === 'not-found') {
                    ledger = forgetEntry(uid, id);
                    wrote = true;
                } else if (result.reason === 'offline') {
                    offline = true;
                    break;
                } else {
                    // Conflict or denial on a delete: drop the entry rather than retry forever.
                    // The profile is already gone locally; the server row keeps its own history.
                    ledger = forgetEntry(uid, id);
                }
            }

            // ---- pushes --------------------------------------------------------------------
            let pending = 0;
            if (!offline) {
                for (const profile of localProfiles) {
                    if (blockedRef.current.has(profile.id)) { pending++; continue; }
                    const entry = ledger.entries[profile.id];
                    // "Leave it in this browser only" is honoured here, and this is the line that
                    // makes it real: without it the very next flush would upload the profile and
                    // silently undo the answer the user gave on the merge screen. It does not count
                    // as pending either — nothing is waiting, it is deliberately absent. An id that
                    // somehow has a ledger entry is stale bookkeeping (it *is* in the account), so
                    // the guard only applies while there is no entry.
                    if (!entry && keptLocal.has(profile.id)) continue;
                    const hash = fingerprint(bodyForStorage(profile));
                    if (entry && entry.hash === hash) continue;

                    const outcome = await pushProfile(profile, entry ? entry.version : null);
                    if (outcome === 'ok') {
                        wrote = true;
                        ledger = readLedger(uid);
                    } else if (outcome === 'offline') {
                        offline = true;
                        pending++;
                        break;
                    } else {
                        pending++;
                        if (outcome === 'conflict') break;
                    }
                }
            }

            setPendingCount(pending);
            setNotUploadedCount(countKeptOutOfAccount(localProfiles, readLedger(uid)));
            if (wrote) setLastSyncedAt(Date.now());

            if (offline) {
                setStatus('offline');
                setMessage('Offline. Your edits are saved in this browser and will sync when the connection is back.');
            } else if (blockedRef.current.size > 0) {
                setStatus('conflict');
            } else if (pending > 0) {
                setStatus('error');
            } else {
                setStatus('synced');
                setMessage(null);
            }
        } finally {
            runningRef.current = false;
            setBusy(false);
        }
    }, [remote, pushProfile]);

    const flushRef = useRef(flush);
    flushRef.current = flush;

    /* -------------------------------------------------------------------------------------- *
     * Bootstrap on sign-in
     * -------------------------------------------------------------------------------------- */

    /**
     * Read the account and act on the difference. Returns the rows that ended up on the merge
     * screen — empty when there is nothing to show — so a caller such as `syncNow()` can open that
     * screen immediately, instead of waiting a render to observe `review`.
     */
    const bootstrap = useCallback(async (uid: string): Promise<MergeRow[]> => {
        if (!remote) return [];
        if (runningRef.current) return [];
        runningRef.current = true;
        setBusy(true);
        setStatus('saving');
        let shown: MergeRow[] = [];
        try {
            const listed = await remote.list({ includeDeleted: true });
            if (!listed.ok) {
                if (listed.reason === 'offline') {
                    setStatus('offline');
                    setMessage('Signed in, but the server is unreachable. Everything still works from this browser.');
                } else if (listed.reason === 'unauthenticated' || listed.reason === 'not-configured') {
                    setStatus(IDLE);
                } else {
                    setStatus('error');
                    setMessage(listed.message ?? 'Could not read your profiles from the server.');
                }
                return shown;
            }

            const ledger = readLedger(uid);
            const firstLogin = typeof ledger.mergedAt !== 'number';
            const { rows, autoPull, autoDelete } = computeReview(
                profilesRef.current,
                listed.summaries,
                ledger,
                firstLogin,
            );
            // Of those rows, the ones that are actually a question. A kept-local row is not: it is
            // a standing offer to upload something the user already chose to keep here, so it stays
            // on the screen but must not freeze the pushes and pulls of every other profile — which
            // is what treating it as undecided would do, for as long as the user keeps that choice.
            const keptLocal = keptLocalOf(ledger);
            const undecided = rows.filter(row => needsDecision(row, keptLocal));

            // Nothing to decide on a first login (e.g. an empty server and no local profiles):
            // record the merge as done so the screen never shows up empty.
            if (firstLogin && undecided.length === 0) markMerged(uid);

            shown = rows;
            setReview(rows.length > 0 ? rows : null);
            setMergePendingNow(firstLogin && undecided.length > 0);
            setReviewOpen(firstLogin && undecided.length > 0);
            setNotUploadedCount(countKeptOutOfAccount(profilesRef.current, ledger));

            if (undecided.length > 0) {
                // `conflict` is the indicator state for "waiting on you", which is exactly what
                // both the first-login merge and a later divergence are.
                setStatus('conflict');
                setMessage(
                    firstLogin
                        ? 'Choose what to keep before syncing starts.'
                        : `${undecided.length} profile${undecided.length === 1 ? '' : 's'} need${undecided.length === 1 ? 's' : ''} a decision.`,
                );
                return shown; // no automatic writes while a decision is outstanding
            }

            // Steady state: apply the unambiguous actions. `autoPush` is intentionally ignored
            // here — the flush at the end re-derives what is dirty from the ledger, so there is
            // exactly one code path that writes.
            for (const marker of autoDelete) {
                if (marker.startsWith('__forget:')) {
                    forgetEntry(uid, marker.slice('__forget:'.length));
                }
            }
            // Not while someone else's shared profile is on screen. `ProfileContext` stops writing
            // `localStorage` in that state, so a pulled profile would exist in React state only:
            // the ledger would claim the account row is ours, the reload that ends the share view
            // would drop the body, and the *next* session would read "entry with no local profile"
            // and soft-delete a profile the user never even saw. The pull simply waits for the
            // next bootstrap, which is one page load away.
            if (!suspendedRef.current) {
                for (const id of autoPull) {
                    await pullProfile(id, 'replace');
                }
            }

            setStatus('synced');
            setMessage(null);
        } finally {
            runningRef.current = false;
            setBusy(false);
        }

        await flushRef.current();
        return shown;
    }, [remote, pullProfile, setMergePendingNow]);

    useEffect(() => {
        if (!remote) { setStatus(IDLE); return; }
        if (!userId) {
            // Signed out: forget everything transient and go back to exactly today's behaviour.
            bootstrappedRef.current = null;
            blockedRef.current = new Set();
            setStatus(IDLE);
            setMessage(null);
            setReview(null);
            setReviewOpen(false);
            setMergePendingNow(false);
            setConflictNow(null);
            setPendingCount(0);
            setNotUploadedCount(0);
            return;
        }
        if (bootstrappedRef.current === userId) return;
        bootstrappedRef.current = userId;
        void bootstrap(userId);
    }, [remote, userId, bootstrap, setMergePendingNow, setConflictNow]);

    /* -------------------------------------------------------------------------------------- *
     * Autosave triggers
     * -------------------------------------------------------------------------------------- */

    // Debounce: restart the 5 s timer on every change to the profiles array.
    useEffect(() => {
        if (!remote || !userId || suspended || mergePending || conflict) return;
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null;
            void flushRef.current();
        }, DEBOUNCE_MS);
        return () => {
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
        };
    }, [remote, userId, suspended, mergePending, conflict, profiles]);

    // Hard flush, so a long session cannot sit unpushed behind a constantly-restarting debounce.
    useEffect(() => {
        if (!remote || !userId) return;
        const id = window.setInterval(() => { void flushRef.current(); }, HARD_FLUSH_MS);
        return () => window.clearInterval(id);
    }, [remote, userId]);

    // Leaving / hiding the tab, and the network coming back.
    useEffect(() => {
        if (!remote || !userId) return;

        const onHide = () => {
            // `hidden` is the reliable "the user is leaving" signal on mobile; it fires long
            // before unload and the request has a real chance to complete.
            if (document.visibilityState === 'hidden') void flushRef.current();
        };
        const onUnload = () => { void flushRef.current(); }; // best effort only
        const onOnline = () => { void flushRef.current(); };

        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onUnload);
        window.addEventListener('beforeunload', onUnload);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onUnload);
            window.removeEventListener('beforeunload', onUnload);
            window.removeEventListener('online', onOnline);
        };
    }, [remote, userId]);

    /* -------------------------------------------------------------------------------------- *
     * Merge screen
     * -------------------------------------------------------------------------------------- */

    const setReviewChoice = useCallback((id: string, choice: MergeChoice) => {
        setReview(prev => prev?.map(row => (row.id === id ? { ...row, choice } : row)) ?? prev);
    }, []);

    const applyReview = useCallback(async (): Promise<void> => {
        const uid = userIdRef.current;
        const rows = review;
        if (!remote || !uid || !rows) return;
        if (runningRef.current) return;
        // Someone else's shared profile is on screen, which means `ProfileContext` is not writing
        // `localStorage`: a profile downloaded now would live in React state only, while the ledger
        // would already claim the account row is ours. Say so instead of writing.
        if (suspendedRef.current) {
            setMessage('Close the shared profile you are viewing first, then merge.');
            return;
        }
        runningRef.current = true;
        setBusy(true);
        setStatus('saving');
        // Cleared so that a message read back at the end can only be one *this* operation set.
        setMessage(null);

        /** Pushes/pulls that actually landed, and ones that failed for a non-offline reason. */
        let applied = 0;
        let failed = 0;

        try {
            /** Index of the row a lost connection stopped on, or `-1`. */
            let offlineAt = -1;
            /** That same row, possibly downgraded so retrying it cannot apply anything twice. */
            let offlineRetry: MergeRow | null = null;
            /**
             * Rows that survive this screen: the profiles the user has just told us to keep out of
             * the account. They are still something to act on later ("upload it after all"), so
             * they stay, while every resolved row goes. Their choice stays on the answer the user
             * gave — pre-selecting "Upload" would turn the next Apply on this screen, including one
             * aimed at another row, into a silent reversal of that answer.
             */
            const keptLocalRows: MergeRow[] = [];

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                if (row.kind === 'local-only' && row.choice === 'skip') {
                    // 'skip' here is not "do nothing": it is the answer "leave this in this browser
                    // only", and unless it is written down the next flush uploads the profile
                    // anyway and the answer never happened.
                    rememberKeptLocal(uid, row.id);
                    keptLocalRows.push({ ...row, choice: 'skip' });
                    continue;
                }

                if (row.choice === 'skip') continue;

                if (row.kind === 'server-only') {
                    // 'server' is the only meaningful action here.
                    const outcome = await pullProfile(row.id, 'replace');
                    if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                    if (outcome === 'ok') applied++; else failed++;
                    continue;
                }

                if (row.kind === 'local-only') {
                    const profile = profilesRef.current.find(p => p.id === row.id);
                    if (!profile) continue;
                    // A successful push clears any "keep it here" for this id — see `pushProfile`,
                    // which owns that, precisely so a *failed* push leaves the decision standing.
                    const outcome = await pushProfile(profile, null);
                    if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                    if (outcome === 'ok') applied++; else failed++;
                    continue;
                }

                if (row.kind === 'server-deleted') {
                    if (row.choice === 'local') {
                        // Re-push: `put` clears `deleted_at`, so the profile comes back for
                        // everyone. Unconditional, because the tombstone bumped the version.
                        const profile = profilesRef.current.find(p => p.id === row.id);
                        if (!profile) continue;
                        const outcome = await pushProfile(profile, null);
                        if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                        if (outcome === 'ok') applied++; else failed++;
                    } else {
                        // Accept the delete: drop it locally too and stop tracking it. Both writes
                        // go through `applyProfiles`, so the flush at the end of this function
                        // cannot still see the profile and push it straight back up.
                        applyProfiles((prev, activeId) => {
                            const next = prev.filter(p => p.id !== row.id);
                            if (next.length === prev.length) return null;
                            return {
                                profiles: next,
                                activeId: next.some(p => p.id === activeId) ? activeId : (next[0]?.id ?? activeId),
                            };
                        });
                        forgetEntry(uid, row.id);
                    }
                    continue;
                }

                // 'unknown-base' and 'diverged' — both exist and disagree.
                if (row.choice === 'both') {
                    const outcome = await pullProfile(row.id, 'add-copy');
                    if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                    if (outcome === 'ok') applied++; else failed++;
                    // Then the local copy wins the original row.
                    const profile = profilesRef.current.find(p => p.id === row.id);
                    if (profile) {
                        const pushed = await pushProfile(profile, null);
                        if (pushed === 'offline') {
                            offlineAt = i;
                            // The extra copy already arrived: retrying "keep both" would add a
                            // second one. Only the push is left to do.
                            offlineRetry = outcome === 'ok' ? { ...row, choice: 'local' } : row;
                            break;
                        }
                        if (pushed === 'ok') applied++; else failed++;
                    }
                } else if (row.choice === 'local') {
                    const profile = profilesRef.current.find(p => p.id === row.id);
                    if (!profile) continue;
                    const outcome = await pushProfile(profile, null);
                    if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                    if (outcome === 'ok') applied++; else failed++;
                } else {
                    const outcome = await pullProfile(row.id, 'replace');
                    if (outcome === 'offline') { offlineAt = i; offlineRetry = row; break; }
                    if (outcome === 'ok') applied++; else failed++;
                }
            }

            if (offlineAt >= 0) {
                // Everything before `offlineAt` is done. Keeping those rows on the screen would
                // make the retry apply them twice — harmless for a push, but a second "keep both"
                // adds a second copy of the server profile, and a second "take theirs" overwrites
                // edits made in between. So the screen keeps exactly what is left to do.
                const remaining = [
                    ...keptLocalRows,
                    ...(offlineRetry ? [offlineRetry] : []),
                    ...rows.slice(offlineAt + 1),
                ];
                setReview(remaining.length > 0 ? remaining : null);
                if (applied > 0) setLastSyncedAt(Date.now());
                setStatus('offline');
                setMessage('Offline. Nothing was lost. What is left is still on this screen; apply it again when you are back online.');
                return;
            }

            markMerged(uid);
            setMergePendingNow(false);
            // Deliberately not `setReview(null)`: a blanket clear would make the user's own "leave
            // it here" answer erase the only route back to "upload it after all" — the row would
            // vanish and no button anywhere would bring it back. Resolved rows do go.
            setReview(keptLocalRows.length > 0 ? keptLocalRows : null);
            setReviewOpen(false);
            blockedRef.current = new Set();
            setConflictNow(null);
            setNotUploadedCount(countKeptOutOfAccount(profilesRef.current, readLedger(uid)));
            if (applied > 0) setLastSyncedAt(Date.now());
            if (failed > 0) {
                // Something the user asked for did not happen. Saying "Synced" here — and wiping
                // the reason `pushProfile` just recorded — would be the one lie this subsystem
                // cannot afford: the row is gone from the screen and nothing was uploaded.
                setStatus('error');
                setMessage(prev => prev ?? `${failed} profile${failed === 1 ? '' : 's'} could not be synced. Nothing was lost. Try again.`);
            } else {
                setStatus('synced');
                setMessage(null);
            }
        } finally {
            runningRef.current = false;
            setBusy(false);
        }

        // Only when this screen resolved cleanly. After a failure the flush would immediately
        // recompute the status from the ledger — and for a profile that is still marked "keep it
        // here", the ledger looks perfectly quiet, so it would paint "Synced" over the fact that
        // the upload the user just asked for did not happen. The 60 s flush retries anyway.
        if (failed === 0) await flushRef.current();
    }, [remote, review, pullProfile, pushProfile, applyProfiles, setMergePendingNow, setConflictNow]);

    const openReview = useCallback(() => {
        if (review && review.length > 0) { setReviewOpen(true); return; }
        const uid = userIdRef.current;
        if (!uid) return;
        // No rows in hand: re-read the account and show whatever that turns up, so the link is
        // never a button that appears to do nothing.
        void (async () => {
            bootstrappedRef.current = null;
            const rows = await bootstrap(uid);
            bootstrappedRef.current = uid;
            if (rows.length > 0) setReviewOpen(true);
        })();
    }, [review, bootstrap]);

    const closeReview = useCallback(() => setReviewOpen(false), []);

    /* -------------------------------------------------------------------------------------- *
     * Live conflict resolution
     * -------------------------------------------------------------------------------------- */

    const resolveConflict = useCallback(
        async (resolution: ConflictResolution): Promise<void> => {
            const uid = userIdRef.current;
            const current = conflict;
            if (!remote || !uid || !current) return;
            if (runningRef.current) return;
            runningRef.current = true;
            setBusy(true);
            try {
                let resolved = false;

                if (resolution === 'theirs') {
                    resolved = (await pullProfile(current.id, 'replace')) === 'ok';
                } else if (resolution === 'duplicate') {
                    // The local body becomes a NEW profile (fresh id, fresh row), and the disputed
                    // id takes the server copy. Nothing is discarded on either side.
                    const profile = profilesRef.current.find(p => p.id === current.id);
                    if (profile) {
                        // Minted outside the updater, for the reason given in `applyProfiles`.
                        const copy: UserProfile = {
                            ...JSON.parse(JSON.stringify(profile)),
                            id: generateProfileId(),
                            name: uniqueName(`${profile.name} (mine)`, nameSet(profilesRef.current)),
                            isShared: undefined,
                        };
                        applyProfiles(prev => ({ profiles: [...prev, copy], activeId: copy.id }));
                    }
                    resolved = (await pullProfile(current.id, 'replace')) === 'ok';
                } else {
                    // 'mine': overwrite the server row, based on the version we just observed.
                    const profile = profilesRef.current.find(p => p.id === current.id);
                    resolved = profile
                        ? (await pushProfile(profile, current.serverVersion || null)) === 'ok'
                        : true;
                }

                if (!resolved) {
                    // The resolution itself failed (offline, or the row moved again). Keep the
                    // profile blocked and the dialog open rather than pretending it is settled.
                    setStatus('conflict');
                    return;
                }

                blockedRef.current.delete(current.id);
                setConflictNow(null);
                setStatus(blockedRef.current.size > 0 ? 'conflict' : 'synced');
                setMessage(null);
                setLastSyncedAt(Date.now());
            } finally {
                runningRef.current = false;
                setBusy(false);
            }

            await flushRef.current();
        },
        [remote, conflict, applyProfiles, pullProfile, pushProfile, setConflictNow],
    );

    /* -------------------------------------------------------------------------------------- *
     * Manual controls
     * -------------------------------------------------------------------------------------- */

    const flushNow = useCallback(async () => { await flushRef.current(); }, []);

    const refresh = useCallback(async () => {
        const uid = userIdRef.current;
        if (!uid) return;
        bootstrappedRef.current = null;
        await bootstrap(uid);
        bootstrappedRef.current = uid;
    }, [bootstrap]);

    /**
     * What the "Sync now" button does. Pushing blindly is the wrong first move: the profiles the
     * user most wants this button for are the ones that are *not* in the account, and a flush is
     * exactly the code path that refuses to touch those. So it re-reads the account first — on
     * fresh rows, never on a stale summary list — and if anything is waiting for a person it opens
     * the merge screen instead of writing. With nothing waiting it is `flushNow()`.
     */
    const syncNow = useCallback(async () => {
        const uid = userIdRef.current;
        if (!remote || !uid) return;
        // Someone else's shared profile on screen, or an operation already in flight: nothing to do.
        if (suspendedRef.current) return;
        if (runningRef.current) return;

        /**
         * A pending merge is NOT a reason to do nothing — it is a reason to put the screen back.
         *
         * This used to `return` here, and that produced a dead end the user actually hit: while
         * `mergePending` is true `bootstrap` performs no automatic writes ("no automatic writes
         * while a decision is outstanding"), and `closeReview()` clears `reviewOpen` WITHOUT
         * clearing `mergePending`. So one dismissal left the dialog unrendered, this function
         * refusing, nothing syncing, and the button explaining that the user should finish a merge
         * screen they could no longer open. Reopening is the only correct response: the decision
         * really is outstanding, so show it.
         *
         * `review` can be null here (a reload drops it while `mergedAt` stays absent in the
         * ledger), which is why this re-reads instead of just flipping `reviewOpen`.
         */
        if (mergePendingRef.current) {
            if (review && review.length > 0) { setReviewOpen(true); return; }
            bootstrappedRef.current = null;
            const reopened = await bootstrap(uid);
            bootstrappedRef.current = uid;
            if (reopened.length > 0) setReviewOpen(true);
            return;
        }

        // A live conflict has its own dialog, always mounted, so there is nothing to reopen.
        if (conflictRef.current) return;

        bootstrappedRef.current = null;
        const rows = await bootstrap(uid);
        bootstrappedRef.current = uid;

        if (rows.length > 0) { setReviewOpen(true); return; }
        await flushRef.current();
    }, [remote, bootstrap, review]);

    return {
        status,
        message,
        lastSyncedAt,
        pendingCount,
        notUploadedCount,
        busy,
        review,
        reviewOpen,
        openReview,
        closeReview,
        setReviewChoice,
        applyReview,
        mergePending,
        conflict,
        resolveConflict,
        syncNow,
        flushNow,
        refresh,
    };
}
