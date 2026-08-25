/**
 * profileIdMigration — one-time rewrite of local profile ids to UUIDs.
 * ===================================================================
 *
 * THE PROBLEM (BACKEND_PLAN.md §7b)
 * ---------------------------------
 * `public.profiles.id` is a `uuid` column. `generateProfileId()` used to return
 * `profile_<epoch>_<random>`, which Postgres rejects outright:
 *
 *     22P02  invalid input syntax for type uuid: "profile_1737059412345_k3f9a2b1c"
 *
 * So the *first* remote write of *every* existing user would fail. Widening the column to `text`
 * was the alternative, but the schema is already applied on the live project and `uuid` is the
 * right type (it is a primary key referenced by `clan_members.profile_id`), so the client moves
 * instead: new ids are `crypto.randomUUID()` and existing local ids are rewritten **once**,
 * before anything reads them.
 *
 * WHY IT IS SAFE TO REWRITE A USER'S ONLY COPY OF THEIR DATA
 * ---------------------------------------------------------
 * Because profile ids are *purely local handles*. Three facts make this a rename, not a data
 * change:
 *
 *  1. `id` is stripped from every share link and every `.json` export
 *     (`STRIPPED_FIELDS` in `src/utils/shareCodec.ts`), and import always mints a fresh id.
 *     So no id has ever left this browser, and nothing outside it can reference one.
 *  2. Inside the browser an id appears in exactly three places, all rewritten together here:
 *     `forgeMaster_profiles[].id`, `forgeMaster_activeProfileId`, and the keys of the
 *     `forgeMaster_syncMeta` sidecar. (Verified by grep: no other storage key and no other
 *     module embeds a profile id. `dungeon_simulator_level_*`, `fm_*`, `forgeMasterLevel`,
 *     `forgeMaster_savedEnemies` are all profile-independent.)
 *  3. Nothing has been pushed to a server yet — this runs before the first sync is even
 *     possible — so there is no remote row whose id could be orphaned.
 *
 * Even so, the original `forgeMaster_profiles` string is copied to a backup key untouched before
 * anything is written, and the old→new map is kept, so the rename is reversible by hand.
 *
 * ORDER OF OPERATIONS
 * -------------------
 * `ensureProfileIdsMigrated()` is called as the first statement of
 * `ProfileContext.getInitialProfiles()`, i.e. before React reads `localStorage` at all. It is
 * memoised, synchronous, and never throws: any failure leaves storage exactly as it was and the
 * app boots on the old ids (only remote sync would then be unavailable for those profiles).
 */

/* ------------------------------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------------------------------ */

const PROFILES_KEY = 'forgeMaster_profiles';
const ACTIVE_PROFILE_KEY = 'forgeMaster_activeProfileId';
const SYNC_META_KEY = 'forgeMaster_syncMeta';

/** Marker + audit trail: `{ version, at, migrated, map }`. Presence means "do not run again". */
export const ID_MIGRATION_KEY = 'forgeMaster_profileIdMigration';
/** Verbatim copy of the pre-migration profiles array. Written once, never overwritten. */
export const PROFILES_BACKUP_KEY = 'forgeMaster_profiles_preUuidBackup';
/** Verbatim copy of the pre-migration active id. */
export const ACTIVE_BACKUP_KEY = 'forgeMaster_activeProfileId_preUuidBackup';

const MIGRATION_VERSION = 1;

export interface IdMigrationRecord {
    version: number;
    /** Epoch ms. */
    at: number;
    /** How many PROFILES were rewritten (0 when there was nothing to do). */
    migrated: number;
    /**
     * old id -> new uuid, for forensics and manual repair. Only profiles that had a usable old
     * string id appear, and a duplicated old id appears once (mapped to the first profile that
     * carried it), so this can be smaller than {@link migrated}.
     */
    map: Record<string, string>;
}

/* ------------------------------------------------------------------------------------------ *
 * UUID generation
 * ------------------------------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a string is already a UUID, so the migration can leave it alone. */
export function isUuid(value: unknown): boolean {
    return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A v4 UUID.
 *
 * `crypto.randomUUID()` needs a *secure context*: it exists on `https://` and on `localhost`,
 * which covers GitHub Pages and `vite dev`. The two fallbacks are for the odd case of the app
 * being served over plain `http://` on a LAN address — a bad id there would be worse than a
 * slightly weaker one.
 */
export function newProfileUuid(): string {
    const c = typeof crypto !== 'undefined' ? crypto : undefined;
    if (c && typeof c.randomUUID === 'function') {
        try { return c.randomUUID(); } catch { /* fall through */ }
    }
    if (c && typeof c.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        c.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
        const hex: string[] = [];
        for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
    // Last resort: shape-correct v4 from Math.random. Only reachable in exotic contexts.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = (Math.random() * 16) | 0;
        const v = ch === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------------------------------ */

interface Storage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function safeStorage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        // Probe: Safari private mode throws on write, not on access.
        localStorage.getItem(PROFILES_KEY);
        return localStorage;
    } catch {
        return null;
    }
}

let done = false;
let lastResult: IdMigrationRecord | null = null;

/** The stored audit record, or a fresh empty one. Never throws. */
function readRecord(storage: Storage): IdMigrationRecord {
    try {
        const raw = storage.getItem(ID_MIGRATION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as IdMigrationRecord;
            if (parsed && typeof parsed === 'object' && parsed.map && typeof parsed.map === 'object') {
                return { version: MIGRATION_VERSION, at: parsed.at ?? 0, migrated: parsed.migrated ?? 0, map: parsed.map };
            }
        }
    } catch {
        // Corrupt record: treat it as absent. Migrating again is harmless (see below).
    }
    return { version: MIGRATION_VERSION, at: 0, migrated: 0, map: {} };
}

/**
 * Rewrites every non-UUID local profile id to a UUID.
 *
 * WHAT DECIDES WHETHER WORK HAPPENS
 * --------------------------------
 * The stored ids themselves — **not** the marker key. That distinction matters: a browser can
 * acquire pre-UUID ids *after* a successful migration (restoring a `forgeMaster_profiles` backup
 * by hand, an old tab still running the previous bundle, a device-transfer tool copying
 * localStorage). Gating on the marker would leave those profiles permanently un-syncable, failing
 * with `22P02` forever and no obvious cause. Gating on the ids makes the function a true
 * invariant: *after it returns, every stored profile id is a UUID.*
 *
 * It is safe to run repeatedly because it is a no-op whenever every id is already a UUID — which
 * is the normal case, costing one `JSON.parse` of at most twenty small objects per boot.
 * {@link ID_MIGRATION_KEY} is therefore an audit trail (old id -> new id, for manual repair), not
 * a lock.
 *
 * Returns the accumulated record, or `null` when storage was unavailable / the write failed.
 */
export function ensureProfileIdsMigrated(): IdMigrationRecord | null {
    if (done) return lastResult;
    done = true;

    const storage = safeStorage();
    if (!storage) return null;

    try {
        const rawProfiles = storage.getItem(PROFILES_KEY);
        const rawActive = storage.getItem(ACTIVE_PROFILE_KEY);

        let profiles: Record<string, unknown>[] = [];
        if (rawProfiles) {
            const parsed = JSON.parse(rawProfiles);
            if (Array.isArray(parsed)) profiles = parsed as Record<string, unknown>[];
        }

        // Which ids need a new identity? Anything that is not already a UUID — including an
        // empty/missing id, which `getInitialProfiles` would have filled in anyway.
        //
        // TWO COUNTS, AND THE DIFFERENCE MATTERS
        // -------------------------------------
        // `map` records old id -> new id, so it can only hold entries for profiles that HAD a
        // usable old string id. `changed` counts profiles actually rewritten. They diverge in
        // exactly the cases that used to be mishandled:
        //
        //   * a profile whose id is missing, empty, or not a string (a number from a very old
        //     format) contributes 0 map entries but 1 rewrite. Deciding "was there work?" from
        //     the map size meant that when NO profile had a mappable id, the rewritten array was
        //     never persisted and the ids stayed non-UUID — the 22P02 this module exists to
        //     prevent, silently unfixed on every subsequent boot.
        //   * two profiles sharing one old id contribute 1 map entry but 2 rewrites.
        const map: Record<string, string> = {};
        let changed = 0;
        for (const profile of profiles) {
            if (!profile || typeof profile !== 'object') continue;
            const id = profile.id;
            if (typeof id === 'string' && isUuid(id)) continue;
            const key = typeof id === 'string' ? id : '';
            const fresh = newProfileUuid();
            // Duplicates each get their OWN uuid rather than collapsing onto one: `profiles.id`
            // is a primary key remotely, and locally two profiles sharing an id make
            // `updateProfile` write to both at once. Only the FIRST mapping is recorded, because
            // that is what the stored active-profile id resolves to below.
            if (key && !map[key]) map[key] = fresh;
            profile.id = fresh;                          // mutate our parsed copy only
            changed++;
        }

        const migrated = changed;
        const previous = readRecord(storage);
        // Keep every mapping ever made, so an old id can still be traced after two migrations.
        const record: IdMigrationRecord = {
            version: MIGRATION_VERSION,
            at: Date.now(),
            migrated: previous.migrated + migrated,
            map: { ...previous.map, ...map },
        };

        if (migrated === 0) {
            // Every id is already a UUID (or there is nothing stored yet). Record the check the
            // first time so there is a trace of when this browser became UUID-clean.
            if (previous.at === 0) storage.setItem(ID_MIGRATION_KEY, JSON.stringify(record));
            lastResult = record;
            return record;
        }

        // ---- Back up BEFORE the first destructive write ----------------------------------
        // Written only once, and never overwritten: the value of a backup is that it is the
        // *original*, so a second migration (see the note above about restored data) must not
        // replace it with an already-rewritten array.
        if (rawProfiles && storage.getItem(PROFILES_BACKUP_KEY) === null) {
            storage.setItem(PROFILES_BACKUP_KEY, rawProfiles);
        }
        if (rawActive && storage.getItem(ACTIVE_BACKUP_KEY) === null) {
            storage.setItem(ACTIVE_BACKUP_KEY, rawActive);
        }

        // ---- Rewrite --------------------------------------------------------------------
        // Profiles first: if anything below fails, the worst case is a stale active id, which
        // `getInitialProfiles` already handles by falling back to the first profile.
        storage.setItem(PROFILES_KEY, JSON.stringify(profiles));

        if (rawActive && map[rawActive]) {
            storage.setItem(ACTIVE_PROFILE_KEY, map[rawActive]);
        }

        // The sync sidecar is keyed by profile id. It is additive metadata (nothing in the app
        // reads it yet), so a failure here is cosmetic — but keep it consistent anyway.
        const rawMeta = storage.getItem(SYNC_META_KEY);
        if (rawMeta && migrated > 0) {
            try {
                const meta = JSON.parse(rawMeta) as Record<string, unknown>;
                if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
                    const nextMeta: Record<string, unknown> = {};
                    for (const [id, value] of Object.entries(meta)) {
                        nextMeta[map[id] ?? id] = value;
                    }
                    storage.setItem(SYNC_META_KEY, JSON.stringify(nextMeta));
                }
            } catch {
                // Corrupt sidecar: leave it. `metaFor()` falls back to inferred defaults.
            }
        }

        storage.setItem(ID_MIGRATION_KEY, JSON.stringify(record));
        lastResult = record;
        return record;
    } catch {
        // Quota, corrupt JSON, blocked storage: leave everything as it was. The app boots on the
        // old ids and simply cannot sync those profiles until a later boot succeeds.
        return null;
    }
}

/** What the last (or a previous) migration did. For diagnostics in the account panel. */
export function readIdMigrationRecord(): IdMigrationRecord | null {
    if (lastResult) return lastResult;
    const storage = safeStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(ID_MIGRATION_KEY);
        return raw ? (JSON.parse(raw) as IdMigrationRecord) : null;
    } catch {
        return null;
    }
}
