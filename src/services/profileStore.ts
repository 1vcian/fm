/**
 * profileStore — the single persistence seam for user profiles.
 * ============================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Today every profile lives in `localStorage` and `src/context/ProfileContext.tsx` talks to
 * `localStorage` directly. `docs/BACKEND_PLAN.md` §2/§5 adds a Supabase backend, and §9 keeps
 * open the option of moving profile *bodies* to R2 behind a Cloudflare Worker once bodies grow
 * past ~1 MB or Postgres storage gets tight.
 *
 * If the React layer kept calling `localStorage.setItem` (or, later, `supabase.from('profiles')`)
 * from a dozen places, every one of those swaps would be a refactor of the UI. So *all* profile
 * persistence goes through the one interface below:
 *
 *   ProfileContext  ->  ProfileStore  ->  { localStorage | Supabase Postgres | R2 via Worker }
 *
 * Consequences that are deliberate:
 *
 *  - **Local-first stays the default.** `LocalProfileStore` is a faithful description of what the
 *    app already does, so wiring the context to it is a *no-op refactor*: same keys, same JSON
 *    shapes, same ordering. Nothing here changes behaviour when there is no backend configured.
 *  - **Optimistic concurrency is in the interface, not in the backend.** `put`/`softDelete` take
 *    an `expectedVersion` and can answer `conflict`, so the conflict UX of §5 ("this profile
 *    changed on another device") is expressible against *any* implementation — including the
 *    local one, which is what makes it testable without a server.
 *  - **Deletes are soft.** A hard delete on device A would be resurrected by the next push from
 *    device B. See `softDelete` and the tombstone note on `LocalProfileStore`.
 *  - **The seam is async everywhere**, even for `localStorage`, so swapping in a network store
 *    never changes a call site.
 *
 * INVARIANTS THIS FILE MUST NOT BREAK (see BACKEND_PLAN §4b)
 * ---------------------------------------------------------
 *  1. Clan membership is **never** part of a profile body. It lives only in `clan_members`,
 *     keyed by profile id. Nothing in this module reads or writes membership.
 *  2. Import always mints a fresh profile id (`generateProfileId()`), so an imported profile can
 *     never inherit someone else's membership row. This store never re-uses an incoming id for
 *     anything but the row it is addressed to.
 *  3. Sync metadata (`version`, `updatedAt`, `deletedAt`) is **record** metadata, not body data.
 *     It is kept beside the body (`ProfileRecord`), never merged into `UserProfile`, precisely so
 *     that export/share payloads cannot leak it.
 *
 * NOTE ON THE NAME COLLISION WITH `UserProfile.version`
 * ----------------------------------------------------
 * `UserProfile` already has a `version: number` field. It is a *schema/format* marker that is
 * currently written but never read anywhere in the app. The `version` in this module is the
 * completely unrelated **optimistic-concurrency counter** of the persistence row
 * (`profiles.version` in the SQL of §4). They must stay separate: bumping a row version must not
 * touch the body, or every sync would produce a body diff and a share payload change.
 *
 * No React imports, no side effects at module load: everything here is a pure function or a
 * small class over an injected storage. Safe to unit test in node with a fake `Storage`.
 */

import type { UserProfile } from '../types/Profile';
import { INITIAL_PROFILE } from '../types/Profile';
// Type-only import for the client; the two values are the lazy factory + the config probe, both
// of which stay `null`-safe when no backend is configured.
import type { SupabaseClient } from './supabaseClient';
import { isBackendConfigured, supabaseClientProvider } from './supabaseClient';

/* ------------------------------------------------------------------------------------------ *
 * Keys and shapes that already exist on disk (must not change)
 * ------------------------------------------------------------------------------------------ */

/** The array of `UserProfile` objects, exactly as `ProfileContext` writes it today. */
export const PROFILES_STORAGE_KEY = 'forgeMaster_profiles';

/**
 * The id of the active profile.
 * ⚠️ The real key is `forgeMaster_activeProfileId` — `BACKEND_PLAN.md` calls it
 * `forgeMaster_activeProfile`, which is a typo in the plan. The code is the source of truth.
 */
export const ACTIVE_PROFILE_STORAGE_KEY = 'forgeMaster_activeProfileId';

/** Pre-multi-profile single-profile blob. Read-once/migrate-away; kept here for completeness. */
export const LEGACY_PROFILE_STORAGE_KEY = 'forgeMaster_profile';

/**
 * Sidecar key holding *sync metadata only* (`{ [profileId]: ProfileSyncMeta }`).
 *
 * Why a sidecar instead of extra fields on the stored profiles: the profiles array must stay
 * byte-compatible with what the app writes today (and with what export/share produce), so
 * versions, timestamps and delete tombstones cannot live inside it. Nothing in the app reads this
 * key, so creating it is additive and invisible; a store that only ever reads never creates it.
 */
export const SYNC_META_STORAGE_KEY = 'forgeMaster_syncMeta';

/* ------------------------------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------------------------------ */

/** Client-generated profile id (`generateProfileId()`); also the primary key of `profiles`. */
export type ProfileId = string;

/**
 * Optimistic-concurrency counter of a stored row, starting at 1 for a freshly created row and
 * incremented by exactly 1 on every accepted write. NOT `UserProfile.version` (see file header).
 */
export type RecordVersion = number;

/**
 * `null` = "no concurrency check, last write wins".
 * Used by the local store's autosave path (there is only one writer per browser tab) and by the
 * first push of a profile that has never been stored remotely.
 */
export type ExpectedVersion = RecordVersion | null;

/** Per-profile sync metadata. Deliberately tiny: it is fetched for *all* profiles on login. */
export interface ProfileSyncMeta {
    /** Optimistic-concurrency counter of the stored row. */
    version: RecordVersion;
    /** Epoch ms of the last accepted write. */
    updatedAt: number;
    /** Epoch ms of a soft delete, or `null`/absent while the profile is alive. */
    deletedAt?: number | null;
}

/**
 * What a listing returns: enough to render the profile switcher, the clan roster and the
 * first-login merge screen (§5) *without* downloading bodies.
 */
export interface ProfileSummary extends ProfileSyncMeta {
    id: ProfileId;
    name: string;
    /** Icon index, so the switcher can render before bodies arrive. */
    iconIndex: number;
    /**
     * Denormalised total power (`profiles.power` in §4), used by clan rosters so teammates never
     * need each other's bodies. The store never computes it — the caller passes it to `put`,
     * because power depends on game config the persistence layer knows nothing about.
     */
    power?: number | null;
}

/** A full record: the body plus its record metadata, kept strictly side by side. */
export interface ProfileRecord {
    summary: ProfileSummary;
    /** The `UserProfile` JSON exactly as the app uses it (`profiles.body` jsonb in §4). */
    body: UserProfile;
}

/** Why a write could not be applied. */
export type StoreFailureReason =
    /** The stored row moved on: `expectedVersion` no longer matches. Show the conflict UX. */
    | 'conflict'
    /** No row with that id (or it is a tombstone and the operation needs a live row). */
    | 'not-found'
    /** No backend configured (`VITE_SUPABASE_*` absent) — expected, not an error. */
    | 'not-configured'
    /** Backend configured but nobody is signed in. */
    | 'unauthenticated'
    /** Network/API unreachable. Caller should keep the local copy and retry later. */
    | 'offline'
    /** Storage refused the write (quota exceeded, private-mode `localStorage`, RLS denial). */
    | 'storage'
    /** Anything unclassified. `message` carries the detail. */
    | 'unknown';

/** Result of a read that can legitimately find nothing. */
export type GetResult =
    | { ok: true; record: ProfileRecord }
    | { ok: false; reason: StoreFailureReason; message?: string };

export type ListResult =
    | { ok: true; summaries: ProfileSummary[] }
    | { ok: false; reason: StoreFailureReason; message?: string };

/**
 * Result of a write. `conflict` carries the *remote* record when the implementation can supply it
 * cheaply, so the conflict dialog can offer "Keep mine / Take theirs / Duplicate mine" (§5)
 * without a second round trip.
 */
export type WriteResult =
    | { ok: true; summary: ProfileSummary }
    | { ok: false; reason: 'conflict'; current: ProfileRecord | null; message?: string }
    | { ok: false; reason: Exclude<StoreFailureReason, 'conflict'>; message?: string };

/**
 * UI-facing sync state for the header indicator (§6.1). One profile at a time — the active one.
 *
 *  - `local-only`  no backend configured, or signed out. This is the default and NOT an error.
 *  - `saving`      a push is in flight (or debounced and pending).
 *  - `synced`      local and remote agree.
 *  - `offline`     backend configured, signed in, but unreachable; edits are queued locally.
 *  - `conflict`    a push was rejected; waiting for the user to resolve.
 *  - `error`       anything else; details live next to it in the caller's state.
 */
export type SyncStatus = 'local-only' | 'saving' | 'synced' | 'offline' | 'conflict' | 'error';

/** Options for a write, so new knobs never change the signature. */
export interface PutOptions {
    /**
     * Expected current version. `null` = unconditional (last write wins).
     * Any number = "only write if the stored row is still at this version", i.e. the
     * `where id = ? and version = ?` of §5.
     */
    expectedVersion?: ExpectedVersion;
    /** Denormalised power to store alongside the body (clan rosters). */
    power?: number | null;
    /** Override the write timestamp (tests, deterministic merges). Defaults to `Date.now()`. */
    now?: number;
}

/**
 * THE SEAM.
 *
 * Four operations, deliberately: list (cheap metadata), get (one body), put (create or update
 * with optimistic concurrency), softDelete (tombstone so the delete can propagate). Everything
 * the sync engine of §5 needs — login pull, merge screen, debounced autosave, conflict UX,
 * propagating deletes — is expressible with these four.
 *
 * Implementations MUST:
 *  - never throw for an expected condition (missing backend, offline, conflict): return a typed
 *    failure instead, so a boot with no backend can never break the app;
 *  - never mutate the `body` they are handed;
 *  - keep record metadata out of the body (see file header, invariant 3).
 */
export interface ProfileStore {
    /** Which backing store this is; handy for logs and for the sync indicator. */
    readonly kind: 'local' | 'remote';

    /**
     * Metadata for every profile. Tombstones are excluded unless `includeDeleted` is true —
     * the merge screen and delete propagation are the only callers that want them.
     */
    list(options?: { includeDeleted?: boolean }): Promise<ListResult>;

    /** One full record, tombstones included (a tombstone has `summary.deletedAt` set). */
    get(id: ProfileId): Promise<GetResult>;

    /** Create or update. See `PutOptions.expectedVersion` for the concurrency contract. */
    put(profile: UserProfile, options?: PutOptions): Promise<WriteResult>;

    /**
     * Mark a profile deleted without dropping its row, so other devices learn about the delete
     * instead of pushing the profile back (§5, "Deletes are soft").
     */
    softDelete(id: ProfileId, options?: { expectedVersion?: ExpectedVersion; now?: number }): Promise<WriteResult>;
}

/* ------------------------------------------------------------------------------------------ *
 * Small helpers (pure)
 * ------------------------------------------------------------------------------------------ */

/** Minimal shape we need from `localStorage`; lets tests inject a fake. */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * `localStorage` can be absent (SSR, node tests) or throw on access (Safari private mode,
 * blocked third-party storage). Never let that take the app down.
 */
export function getBrowserStorage(): KeyValueStorage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
    try {
        const raw = storage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as T;
        return parsed ?? fallback;
    } catch {
        // Corrupt JSON must not brick the app: behave like "nothing stored".
        return fallback;
    }
}

/** Deep clone that keeps this module free of structural assumptions about `UserProfile`. */
function cloneBody(body: UserProfile): UserProfile {
    return JSON.parse(JSON.stringify(body)) as UserProfile;
}

/** Summary of a body + its metadata. The only place the two are joined. */
export function summarise(body: UserProfile, meta: ProfileSyncMeta, power?: number | null): ProfileSummary {
    return {
        id: body.id,
        name: body.name,
        iconIndex: body.iconIndex ?? 0,
        version: meta.version,
        updatedAt: meta.updatedAt,
        deletedAt: meta.deletedAt ?? null,
        power: power ?? null,
    };
}

/** True when a summary is a tombstone. */
export function isDeleted(summary: Pick<ProfileSummary, 'deletedAt'>): boolean {
    return typeof summary.deletedAt === 'number' && summary.deletedAt > 0;
}

/**
 * Which of two records is newer, for the merge screen (§5). Returns the side to prefer when the
 * user picks "newest wins"; the UI still offers explicit Keep local / Keep server / Keep both.
 * Ties resolve to `'local'` so a no-op sync never rewrites the local copy.
 */
export function newerOf(local: ProfileSyncMeta, remote: ProfileSyncMeta): 'local' | 'remote' {
    return remote.updatedAt > local.updatedAt ? 'remote' : 'local';
}

/* ------------------------------------------------------------------------------------------ *
 * LocalProfileStore — describes what the app already does
 * ------------------------------------------------------------------------------------------ */

/**
 * The `localStorage` implementation: the offline cache and the working copy (§5, "Local first").
 *
 * Fidelity rules, so that wiring `ProfileContext` to this class changes nothing:
 *  - `forgeMaster_profiles` stays a plain `UserProfile[]` in the same order, with the same fields.
 *    `put` replaces in place when the id exists and appends otherwise — the same thing
 *    `setProfiles(prev => prev.map(...))` / `[...prev, p]` do today.
 *  - `forgeMaster_activeProfileId` keeps holding just the id string.
 *  - Nothing is written to the profiles array that the app does not already write. Versions,
 *    timestamps and tombstones go to the `forgeMaster_syncMeta` sidecar (see its doc comment).
 *  - A soft delete removes the profile from the array (so the UI stops showing it, exactly as
 *    today) and records a tombstone in the sidecar, so a later sync can propagate the delete
 *    instead of pulling the profile back.
 *  - Bodies are cloned on the way in and on the way out: callers keep React-owned objects and
 *    must not be able to mutate the store's copy (or vice versa) by accident.
 *
 * Missing metadata is *inferred*, never invented: a profile written by an older build has no
 * sidecar entry, so it is reported as `version: 1, updatedAt: 0`. `updatedAt: 0` means "unknown,
 * older than anything we have", which makes the merge screen prefer a real remote timestamp
 * without ever silently discarding local data (the user still confirms).
 */
export class LocalProfileStore implements ProfileStore {
    readonly kind = 'local' as const;

    private readonly storage: KeyValueStorage | null;

    constructor(storage: KeyValueStorage | null = getBrowserStorage()) {
        this.storage = storage;
    }

    /* ---- raw access, also useful to the merge screen and to tests ---- */

    /** The profiles array exactly as stored. Empty when storage is unavailable or unparseable. */
    readBodies(): UserProfile[] {
        if (!this.storage) return [];
        const parsed = readJson<UserProfile[]>(this.storage, PROFILES_STORAGE_KEY, []);
        return Array.isArray(parsed) ? parsed.filter((p): p is UserProfile => !!p && typeof p.id === 'string') : [];
    }

    /** The sync sidecar. `{}` when it has never been written. */
    readMeta(): Record<ProfileId, ProfileSyncMeta> {
        if (!this.storage) return {};
        const parsed = readJson<Record<ProfileId, ProfileSyncMeta>>(this.storage, SYNC_META_STORAGE_KEY, {});
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    /** Metadata for one id, with the documented defaults for rows written by older builds. */
    metaFor(id: ProfileId): ProfileSyncMeta {
        const meta = this.readMeta()[id];
        return {
            version: meta?.version ?? 1,
            updatedAt: meta?.updatedAt ?? 0,
            deletedAt: meta?.deletedAt ?? null,
        };
    }

    /**
     * The version a caller would have seen for this id, used for both the concurrency check and
     * the next version. Must match what `list`/`metaFor` report or versions would stall:
     *   sidecar entry -> its version;
     *   body but no sidecar (written by an older build) -> 1, so the next write becomes 2;
     *   neither -> 0, so the first write becomes 1 (matching `profiles.version default 1`).
     */
    private currentVersion(meta: ProfileSyncMeta | undefined, bodyExists: boolean): RecordVersion {
        if (typeof meta?.version === 'number') return meta.version;
        return bodyExists ? 1 : 0;
    }

    /** The active profile id, or `null`. This key is local-only: it never syncs. */
    getActiveProfileId(): ProfileId | null {
        if (!this.storage) return null;
        try {
            return this.storage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
        } catch {
            return null;
        }
    }

    setActiveProfileId(id: ProfileId): boolean {
        if (!this.storage) return false;
        try {
            this.storage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
            return true;
        } catch {
            return false;
        }
    }

    /* ---- ProfileStore ---- */

    async list(options?: { includeDeleted?: boolean }): Promise<ListResult> {
        if (!this.storage) return { ok: false, reason: 'storage', message: 'localStorage unavailable' };

        const meta = this.readMeta();
        const summaries = this.readBodies().map(body => summarise(body, {
            version: meta[body.id]?.version ?? 1,
            updatedAt: meta[body.id]?.updatedAt ?? 0,
            deletedAt: meta[body.id]?.deletedAt ?? null,
        }));

        if (options?.includeDeleted) {
            // Tombstones only exist in the sidecar (their bodies are gone from the array), so
            // synthesise a minimal summary for each. Enough to propagate the delete.
            const present = new Set(summaries.map(s => s.id));
            for (const [id, m] of Object.entries(meta)) {
                if (present.has(id) || !isDeleted(m)) continue;
                summaries.push({
                    id,
                    name: '',
                    iconIndex: 0,
                    version: m.version ?? 1,
                    updatedAt: m.updatedAt ?? 0,
                    deletedAt: m.deletedAt ?? null,
                    power: null,
                });
            }
        }

        return { ok: true, summaries };
    }

    async get(id: ProfileId): Promise<GetResult> {
        if (!this.storage) return { ok: false, reason: 'storage', message: 'localStorage unavailable' };

        const body = this.readBodies().find(p => p.id === id);
        if (!body) {
            const meta = this.readMeta()[id];
            // A tombstone is a legitimate answer for the sync engine, but it has no body to hand
            // back, so it is reported as not-found with the delete visible in the sidecar.
            return { ok: false, reason: 'not-found', message: meta && isDeleted(meta) ? 'deleted' : undefined };
        }
        return { ok: true, record: { summary: summarise(body, this.metaFor(id)), body: cloneBody(body) } };
    }

    async put(profile: UserProfile, options?: PutOptions): Promise<WriteResult> {
        if (!this.storage) return { ok: false, reason: 'storage', message: 'localStorage unavailable' };
        if (!profile?.id) return { ok: false, reason: 'unknown', message: 'profile has no id' };

        const now = options?.now ?? Date.now();
        const bodies = this.readBodies();
        const meta = this.readMeta();
        const index = bodies.findIndex(p => p.id === profile.id);
        const current: ProfileSyncMeta | undefined = meta[profile.id];
        const currentVersion = this.currentVersion(current, index >= 0);
        const expected = options?.expectedVersion ?? null;

        if (expected !== null && currentVersion !== expected) {
            const body = index >= 0 ? bodies[index] : null;
            return {
                ok: false,
                reason: 'conflict',
                current: body
                    ? { summary: summarise(body, this.metaFor(profile.id)), body: cloneBody(body) }
                    : null,
            };
        }

        const nextMeta: ProfileSyncMeta = {
            version: currentVersion + 1,
            updatedAt: now,
            deletedAt: null, // writing a profile un-deletes it: an explicit local edit wins
        };

        const body = cloneBody(profile);
        const nextBodies = index >= 0
            ? bodies.map((p, i) => (i === index ? body : p))
            : [...bodies, body];

        return this.commit(nextBodies, { ...meta, [profile.id]: nextMeta }, () =>
            summarise(body, nextMeta, options?.power));
    }

    async softDelete(id: ProfileId, options?: { expectedVersion?: ExpectedVersion; now?: number }): Promise<WriteResult> {
        if (!this.storage) return { ok: false, reason: 'storage', message: 'localStorage unavailable' };

        const now = options?.now ?? Date.now();
        const bodies = this.readBodies();
        const meta = this.readMeta();
        const existing = bodies.find(p => p.id === id);
        const current = meta[id];

        if (!existing && !current) return { ok: false, reason: 'not-found' };

        const currentVersion = this.currentVersion(current, !!existing);
        const expected = options?.expectedVersion ?? null;
        if (expected !== null && currentVersion !== expected) {
            return {
                ok: false,
                reason: 'conflict',
                current: existing
                    ? { summary: summarise(existing, this.metaFor(id)), body: cloneBody(existing) }
                    : null,
            };
        }

        const nextMeta: ProfileSyncMeta = {
            version: currentVersion + 1,
            updatedAt: now,
            deletedAt: now,
        };

        return this.commit(bodies.filter(p => p.id !== id), { ...meta, [id]: nextMeta }, () => ({
            id,
            name: existing?.name ?? '',
            iconIndex: existing?.iconIndex ?? 0,
            version: nextMeta.version,
            updatedAt: nextMeta.updatedAt,
            deletedAt: nextMeta.deletedAt,
            power: null,
        }));
    }

    /**
     * Write both keys, profiles first. If the sidecar write fails (quota) the app is still
     * correct — it just falls back to the inferred defaults in `metaFor`, i.e. exactly today's
     * behaviour. The reverse order could leave a tombstone with a live body, so it is avoided.
     */
    private commit(
        bodies: UserProfile[],
        meta: Record<ProfileId, ProfileSyncMeta>,
        summary: () => ProfileSummary,
    ): WriteResult {
        try {
            this.storage!.setItem(PROFILES_STORAGE_KEY, JSON.stringify(bodies));
        } catch (e) {
            return { ok: false, reason: 'storage', message: (e as Error)?.message };
        }
        try {
            this.storage!.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(meta));
        } catch {
            // Non-fatal, see above.
        }
        return { ok: true, summary: summary() };
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Remote row <-> local body
 * ------------------------------------------------------------------------------------------ */

/** The columns of `public.profiles` this store ever reads. `body` only where it says so. */
interface ProfileRow {
    id: string;
    name: string;
    version: number | string;
    power: number | string | null;
    updated_at: string;
    deleted_at: string | null;
    /** Only selected by `get()`. */
    body?: Record<string, unknown> | null;
    /** Computed column `body->>iconIndex`, so `list()` never downloads a body. */
    iconIndex?: string | number | null;
}

const SUMMARY_COLUMNS = 'id,name,version,power,updated_at,deleted_at';
/** PostgREST computed-column alias: pulls one scalar out of the jsonb without the whole body. */
const SUMMARY_COLUMNS_WITH_ICON = `${SUMMARY_COLUMNS},iconIndex:body->>iconIndex`;
const FULL_COLUMNS = `${SUMMARY_COLUMNS},body`;

/**
 * What goes into `profiles.body`.
 *
 * Everything the app uses **except** the two fields that are not build data:
 *  - `id` is the primary-key column, so keeping a copy inside the jsonb could only ever drift;
 *  - `isShared` is a transient view flag ("you are looking at someone's share link"), never a
 *    property of a stored profile.
 *
 * Note this is deliberately *not* `sanitizeProfileForTransport()`: that one also strips
 * `techTreeUpdatedAt`, which the UI reads to flag stale tech-tree data. A sync must round-trip
 * the profile the user actually has, so only genuinely non-body fields are removed.
 */
export function bodyForStorage(profile: UserProfile): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    delete clone.id;
    delete clone.isShared;
    return clone;
}

/** Rebuilds a `UserProfile` from a row: body + the id from its own column. */
export function bodyFromRow(row: ProfileRow): UserProfile {
    const body = (row.body && typeof row.body === 'object' ? row.body : {}) as Partial<UserProfile>;
    return {
        ...INITIAL_PROFILE,
        ...body,
        id: row.id,
        // The column is the authority on the name (it is what the clan roster shows).
        name: row.name || body.name || 'Profile',
        isShared: undefined,
    } as UserProfile;
}

const toNumber = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toEpoch = (value: string | null | undefined): number => {
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
};

function summaryFromRow(row: ProfileRow): ProfileSummary {
    return {
        id: row.id,
        name: row.name,
        iconIndex: toNumber(row.iconIndex, 0),
        version: toNumber(row.version, 1),
        updatedAt: toEpoch(row.updated_at),
        deletedAt: row.deleted_at ? toEpoch(row.deleted_at) : null,
        power: row.power === null || row.power === undefined ? null : toNumber(row.power, 0),
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Error classification
 * ------------------------------------------------------------------------------------------ */

interface PostgrestErrorLike {
    message?: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
    name?: string;
    status?: number;
}

/** Unique-violation: the row already exists, so an insert should become an update. */
const UNIQUE_VIOLATION = '23505';

/**
 * Maps a PostgREST / fetch failure onto `StoreFailureReason`.
 *
 * The distinction that matters most is **offline vs. denied**: offline means "keep the local copy
 * and retry", denied means "stop retrying and tell the user". Getting that wrong either loses
 * edits or spins forever.
 */
function classify(error: PostgrestErrorLike | null | undefined): {
    reason: Exclude<StoreFailureReason, 'conflict'>;
    message: string;
} {
    const message = (error?.message || 'Unknown error').trim();
    const lower = message.toLowerCase();
    const code = error?.code;

    // A `fetch` that never reached the server surfaces as a TypeError with no PostgREST code.
    if (
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        error?.name === 'TypeError' ||
        lower.includes('failed to fetch') ||
        lower.includes('network') ||
        lower.includes('load failed') ||
        code === 'ECONNREFUSED'
    ) {
        return { reason: 'offline', message };
    }

    // Expired / missing JWT.
    if (code === 'PGRST301' || code === '401' || error?.status === 401 || lower.includes('jwt')) {
        return { reason: 'unauthenticated', message };
    }

    // RLS said no, or a trigger raised 42501 (`profiles.id is immutable`, quota, ).
    if (code === '42501' || error?.status === 403 || lower.includes('row-level security') || lower.includes('permission denied')) {
        return { reason: 'storage', message };
    }

    // Quota triggers of §8: 20 profiles / 256 KB body. Worth naming explicitly, because the user
    // can act on it and a generic "unknown" would send them hunting.
    if (lower.includes('quota') || code === '54000' || lower.includes('too large')) {
        return { reason: 'storage', message };
    }

    // Should be impossible after `ensureProfileIdsMigrated()`, but if a legacy id ever reaches
    // the server this is the error, and a bare code would be baffling.
    if (code === '22P02') {
        return {
            reason: 'storage',
            message: `${message}. This profile still has a pre-UUID id; reload the app to run the id migration.`,
        };
    }

    return { reason: 'unknown', message };
}

/**
 * A failed re-read, expressed as a failed write. `get()` can never answer `conflict` (there is
 * nothing to conflict with on a read), but the shared `StoreFailureReason` union allows it, so
 * that impossible case is folded into `unknown` rather than silently widened.
 */
function readFailureToWriteFailure(
    result: { ok: false; reason: StoreFailureReason; message?: string },
): WriteResult {
    if (result.reason === 'conflict') {
        return { ok: false, reason: 'unknown', message: result.message };
    }
    return { ok: false, reason: result.reason, message: result.message };
}

/* ------------------------------------------------------------------------------------------ *
 * RemoteProfileStore
 * ------------------------------------------------------------------------------------------ */

/**
 * Supabase-backed store over `public.profiles` (BACKEND_PLAN.md §4):
 *
 * ```sql
 * create table public.profiles (
 *   id uuid primary key, user_id uuid not null default auth.uid() references auth.users,
 *   name text not null, body jsonb not null, version bigint not null default 1,
 *   power bigint, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
 * );
 * ```
 *
 * THREE PROPERTIES OF THE SCHEMA THAT SHAPE THIS CODE
 * --------------------------------------------------
 *  1. **`version` is server-owned.** The `profiles_touch` trigger does
 *     `new.version := old.version + 1` on every update, so this store must never send a version
 *     in its payload — it only *filters* on one. Same for `updated_at`.
 *  2. **RLS does all authorisation** (`user_id = auth.uid()`), and `user_id` defaults to
 *     `auth.uid()`, so no query here mentions the user. A missing session is therefore not an
 *     access error but a client-side precondition, checked before every call.
 *  3. **Deletes are soft.** `deleted_at` is set and the body is kept, so a delete propagates to
 *     other devices instead of being resurrected by them — and stays undoable.
 *
 * OPTIMISTIC CONCURRENCY
 * ----------------------
 * `update  where id = ? and version = <expected>`. Postgres reports how many rows it touched:
 * zero means somebody else wrote first. The row is then re-selected so the caller can render
 * "keep mine / take theirs / duplicate mine" without a second round trip.
 *
 * Not this class's job: clan membership (§4b invariant 1 — it lives only in `clan_members`) and
 * Realtime (clan data only).
 */
export class RemoteProfileStore implements ProfileStore {
    readonly kind = 'remote' as const;

    /** Set once a `list()` learns that this PostgREST rejects the computed icon column. */
    private iconColumnUnsupported = false;

    /**
     * @param getClient resolves the Supabase client, or `null` when the env vars are absent.
     *                  Injected rather than imported so this class stays testable.
     */
    constructor(
        private readonly getClient: () => Promise<SupabaseClient | null> = async () => null,
    ) {}

    /* ---- preconditions ---- */

    private notConfigured(): { ok: false; reason: 'not-configured'; message: string } {
        return { ok: false, reason: 'not-configured', message: 'No backend configured.' };
    }

    private unauthenticated(): { ok: false; reason: 'unauthenticated'; message: string } {
        return { ok: false, reason: 'unauthenticated', message: 'Not signed in.' };
    }

    /**
     * The client *and* a live session, or a typed failure. `getSession()` reads the cached
     * session from storage (it does not hit the network), so this is cheap enough to do per call
     * and it keeps every method from producing a confusing RLS error when signed out.
     */
    private async ready(): Promise<
        | { ok: true; client: SupabaseClient }
        | { ok: false; reason: 'not-configured' | 'unauthenticated' | 'offline'; message: string }
    > {
        const client = await this.getClient();
        if (!client) return this.notConfigured();
        try {
            const { data } = await client.auth.getSession();
            if (!data.session) return this.unauthenticated();
            return { ok: true, client };
        } catch (e) {
            const { reason, message } = classify(e as PostgrestErrorLike);
            if (reason === 'offline') return { ok: false, reason: 'offline', message };
            return this.unauthenticated();
        }
    }

    /* ---- ProfileStore ---- */

    async list(options?: { includeDeleted?: boolean }): Promise<ListResult> {
        const ready = await this.ready();
        if (!ready.ok) return ready;

        const run = async (columns: string) => {
            let query = ready.client.from('profiles').select(columns);
            if (!options?.includeDeleted) query = query.is('deleted_at', null);
            return query.order('updated_at', { ascending: false });
        };

        try {
            let { data, error } = await run(
                this.iconColumnUnsupported ? SUMMARY_COLUMNS : SUMMARY_COLUMNS_WITH_ICON,
            );

            // `iconIndex:body->>iconIndex` is a PostgREST feature; if this deployment dislikes
            // it, fall back to plain columns rather than failing the whole login pull. The icon
            // then just renders as the default until a body is fetched.
            if (error && !this.iconColumnUnsupported) {
                this.iconColumnUnsupported = true;
                ({ data, error } = await run(SUMMARY_COLUMNS));
            }

            if (error) return { ok: false, ...classify(error) };
            const rows = (data ?? []) as unknown as ProfileRow[];
            return { ok: true, summaries: rows.map(summaryFromRow) };
        } catch (e) {
            return { ok: false, ...classify(e as PostgrestErrorLike) };
        }
    }

    async get(id: ProfileId): Promise<GetResult> {
        const ready = await this.ready();
        if (!ready.ok) return ready;

        try {
            const { data, error } = await ready.client
                .from('profiles')
                .select(FULL_COLUMNS)
                .eq('id', id)
                .maybeSingle();

            if (error) return { ok: false, ...classify(error) };
            if (!data) return { ok: false, reason: 'not-found' };

            const row = data as unknown as ProfileRow;
            return { ok: true, record: { summary: summaryFromRow(row), body: bodyFromRow(row) } };
        } catch (e) {
            return { ok: false, ...classify(e as PostgrestErrorLike) };
        }
    }

    async put(profile: UserProfile, options?: PutOptions): Promise<WriteResult> {
        if (!profile?.id) return { ok: false, reason: 'unknown', message: 'profile has no id' };

        const ready = await this.ready();
        if (!ready.ok) return ready;
        const client = ready.client;

        const payload = {
            name: profile.name || 'Profile',
            body: bodyForStorage(profile),
            power: options?.power ?? null,
            // `deleted_at: null` un-deletes: an explicit local edit wins over an old tombstone,
            // matching `LocalProfileStore.put`.
            deleted_at: null as string | null,
        };
        const expected = options?.expectedVersion ?? null;

        try {
            // ---- first push of this profile: insert -------------------------------------
            if (expected === null) {
                const insert = await client
                    .from('profiles')
                    // `user_id` is omitted on purpose: it defaults to auth.uid() and the RLS
                    // `with check` makes anything else impossible anyway.
                    .insert({ id: profile.id, ...payload })
                    .select(SUMMARY_COLUMNS)
                    .single();

                if (!insert.error && insert.data) {
                    return { ok: true, summary: this.withIcon(insert.data as unknown as ProfileRow, profile, options) };
                }
                if (insert.error && (insert.error as PostgrestErrorLike).code !== UNIQUE_VIOLATION) {
                    return { ok: false, ...classify(insert.error) };
                }
                // The row exists (another device pushed it, or this is a re-sync). `expected`
                // was null, i.e. "last write wins", so overwrite unconditionally.
                const update = await client
                    .from('profiles')
                    .update(payload)
                    .eq('id', profile.id)
                    .select(SUMMARY_COLUMNS)
                    .maybeSingle();

                if (update.error) return { ok: false, ...classify(update.error) };
                if (!update.data) return { ok: false, reason: 'not-found' };
                return { ok: true, summary: this.withIcon(update.data as unknown as ProfileRow, profile, options) };
            }

            // ---- conditional update: the optimistic-concurrency path ---------------------
            const update = await client
                .from('profiles')
                .update(payload)
                .eq('id', profile.id)
                .eq('version', expected)
                .select(SUMMARY_COLUMNS)
                .maybeSingle();

            if (update.error) return { ok: false, ...classify(update.error) };
            if (update.data) {
                return { ok: true, summary: this.withIcon(update.data as unknown as ProfileRow, profile, options) };
            }

            // Zero rows: either the version moved (conflict) or the row is gone (not-found).
            const current = await this.get(profile.id);
            if (!current.ok) return readFailureToWriteFailure(current);
            return { ok: false, reason: 'conflict', current: current.record };
        } catch (e) {
            return { ok: false, ...classify(e as PostgrestErrorLike) };
        }
    }

    async softDelete(
        id: ProfileId,
        options?: { expectedVersion?: ExpectedVersion; now?: number },
    ): Promise<WriteResult> {
        const ready = await this.ready();
        if (!ready.ok) return ready;
        const client = ready.client;
        const expected = options?.expectedVersion ?? null;
        const nowIso = new Date(options?.now ?? Date.now()).toISOString();

        try {
            let query = client.from('profiles').update({ deleted_at: nowIso }).eq('id', id);
            if (expected !== null) query = query.eq('version', expected);

            const { data, error } = await query.select(SUMMARY_COLUMNS).maybeSingle();
            if (error) return { ok: false, ...classify(error) };
            if (data) {
                return { ok: true, summary: summaryFromRow(data as unknown as ProfileRow) };
            }

            const current = await this.get(id);
            if (!current.ok) return readFailureToWriteFailure(current);
            // The row is there but at a different version -> a real conflict, unless it is
            // already deleted, in which case the delete has simply already happened.
            if (isDeleted(current.record.summary)) {
                return { ok: true, summary: current.record.summary };
            }
            return expected === null
                ? { ok: false, reason: 'not-found' }
                : { ok: false, reason: 'conflict', current: current.record };
        } catch (e) {
            return { ok: false, ...classify(e as PostgrestErrorLike) };
        }
    }

    /**
     * `iconIndex` is not a column, so a returning row cannot carry it. The caller just wrote the
     * body, so take it from there — this keeps the summary identical to what a later `list()`
     * will report.
     */
    private withIcon(row: ProfileRow, profile: UserProfile, options?: PutOptions): ProfileSummary {
        const summary = summaryFromRow(row);
        summary.iconIndex = profile.iconIndex ?? 0;
        if (options?.power !== undefined) summary.power = options.power ?? null;
        return summary;
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------------------------------ */

/**
 * The store the app should use right now.
 *
 * Still the local one, always: `localStorage` is the working copy and the offline cache, and
 * nothing in the UI ever waits on the network to read or write a profile. The remote store is
 * *additive* — `useProfileSync` drives it alongside this one and owns the `SyncStatus` indicator.
 * That split is what makes "signed out" and "offline" identical to today's behaviour rather than
 * a degraded mode.
 */
export function createProfileStore(): ProfileStore {
    return new LocalProfileStore();
}

/**
 * The remote store bound to the app's Supabase client. Returns `null` when there is no backend
 * configured at all, so callers can skip every sync code path with one check.
 */
export function createRemoteProfileStore(): RemoteProfileStore | null {
    if (!isBackendConfigured()) return null;
    return new RemoteProfileStore(supabaseClientProvider);
}
