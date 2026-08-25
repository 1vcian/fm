/**
 * syncLedger — what this browser believes the server already has.
 * ==============================================================
 *
 * WHY A LEDGER IS NECESSARY (and why `updated_at` is not enough)
 * -------------------------------------------------------------
 * Optimistic concurrency on `profiles.version` only works if the client knows the version it is
 * *basing its edit on*. Without that number every push has to be unconditional ("last write
 * wins"), which silently eats the other device's work — precisely the failure the plan's conflict
 * UX exists to prevent.
 *
 * Comparing timestamps instead does not work either: clocks disagree, and `updated_at` is set by
 * the server on writes we did not make. So each browser keeps its own small ledger:
 *
 *     { [userId]: { mergedAt, entries: { [profileId]: { version, hash, at } }, keptLocal: [id] } }
 *
 *  - `version` — the `profiles.version` we last observed for that row. It is the `expectedVersion`
 *    of the next push. A server row at a *different* version means somebody else wrote: conflict.
 *  - `hash` — a fingerprint of the body we last pushed or pulled. It answers "did the user change
 *    anything since?" without keeping a second copy of the profile, so a reload does not re-push
 *    twenty unchanged profiles.
 *  - `mergedAt` — when the first-login merge for this account was completed. Its absence is what
 *    makes the merge screen appear exactly once per account per browser.
 *  - `keptLocal` — see below.
 *
 * WHY `keptLocal` HAS TO BE REMEMBERED
 * ------------------------------------
 * The merge screen offers "leave this in this browser only" for a profile that has never been
 * uploaded. Nothing else in this file can express that answer, and without it the app is forced to
 * pick one of two wrong behaviours:
 *
 *   - forget the answer, and let the next sync push the profile anyway — silently reversing an
 *     explicit decision, which is the one thing this whole subsystem exists to avoid;
 *   - or drop the row from the screen and never mention the profile again — leaving the user with
 *     no way to change their mind and upload it later.
 *
 * So the ids of those profiles are remembered here. They are excluded from every *automatic* push
 * and offered again — never pushed by itself — whenever the user asks to sync. A stale id (the
 * profile was deleted in this browser) is harmless: nothing iterates the set on its own.
 *
 * Keyed by user id, because signing in with a different account must not inherit the first
 * account's beliefs about the server.
 *
 * THIS FILE IS PURE BOOKKEEPING. It stores no profile data (only a hash), so it can be deleted at
 * any time: the worst consequence is one extra merge screen, never data loss. Losing `keptLocal`
 * degrades to "the profile is offered for upload again", which is safe in the same way. It never
 * throws — a blocked `localStorage` degrades to an in-memory ledger that lasts for the session.
 */

/** Sidecar key. Distinct from `forgeMaster_syncMeta`, which belongs to `LocalProfileStore`. */
export const SYNC_LEDGER_KEY = 'forgeMaster_remoteSyncLedger';

export interface LedgerEntry {
    /** `profiles.version` as last observed. The base of the next optimistic write. */
    version: number;
    /** Fingerprint of the body last pushed or pulled. */
    hash: string;
    /** Epoch ms of that push/pull. */
    at: number;
}

export interface UserLedger {
    /** Epoch ms the first-login merge was completed, or `undefined` while it is still pending. */
    mergedAt?: number;
    entries: Record<string, LedgerEntry>;
    /**
     * Ids of profiles the user was asked about and deliberately chose to keep out of the account.
     * Absent on a legacy blob written before this field existed, which reads as "nobody has said
     * that about anything yet" — the safe default.
     */
    keptLocal?: string[];
}

type LedgerFile = Record<string, UserLedger>;

/* ------------------------------------------------------------------------------------------ *
 * Fingerprint
 * ------------------------------------------------------------------------------------------ */

/**
 * FNV-1a over the JSON of the body. Not cryptographic and does not need to be: a collision would
 * mean "we think the profile is unchanged when it is not", and the 60-second hard flush plus the
 * next real edit both recover from that. What matters is that it is cheap enough to run on every
 * autosave tick for every profile.
 */
export function fingerprint(value: unknown): string {
    const json = JSON.stringify(value) ?? '';
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        // 16777619, via shifts, to stay in 32-bit int land.
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    // Length guards against the (rare) case of two different bodies hashing alike.
    return `${h.toString(36)}:${json.length.toString(36)}`;
}

/* ------------------------------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------------------------------ */

/** In-memory mirror, also the fallback when `localStorage` is unavailable. */
let cache: LedgerFile | null = null;

function readFile(): LedgerFile {
    if (cache) return cache;
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNC_LEDGER_KEY) : null;
        const parsed = raw ? (JSON.parse(raw) as LedgerFile) : {};
        cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        cache = {};
    }
    return cache;
}

function writeFile(file: LedgerFile): void {
    cache = file;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SYNC_LEDGER_KEY, JSON.stringify(file));
        }
    } catch {
        // Quota or private mode: the in-memory cache still serves this session.
    }
}

/** The ledger for one account. Always returns an object, never `null`. */
export function readLedger(userId: string): UserLedger {
    const file = readFile();
    const ledger = file[userId];
    if (ledger && typeof ledger === 'object' && ledger.entries && typeof ledger.entries === 'object') {
        return ledger;
    }
    return { entries: {} };
}

export function writeLedger(userId: string, ledger: UserLedger): void {
    const file = { ...readFile(), [userId]: ledger };
    writeFile(file);
}

/** Record a successful push/pull of one profile. */
export function rememberEntry(
    userId: string,
    profileId: string,
    entry: LedgerEntry,
): UserLedger {
    const ledger = readLedger(userId);
    const next: UserLedger = { ...ledger, entries: { ...ledger.entries, [profileId]: entry } };
    writeLedger(userId, next);
    return next;
}

/** Forget one profile (its row was deleted, or the entry turned out to be stale). */
export function forgetEntry(userId: string, profileId: string): UserLedger {
    const ledger = readLedger(userId);
    if (!(profileId in ledger.entries)) return ledger;
    const entries = { ...ledger.entries };
    delete entries[profileId];
    const next: UserLedger = { ...ledger, entries };
    writeLedger(userId, next);
    return next;
}

/** Mark the first-login merge as done, so the merge screen stops opening by itself. */
export function markMerged(userId: string, at: number = Date.now()): UserLedger {
    const ledger = readLedger(userId);
    const next: UserLedger = { ...ledger, mergedAt: at };
    writeLedger(userId, next);
    return next;
}

/** True once this browser has completed the merge screen for this account. */
export function hasMerged(userId: string): boolean {
    return typeof readLedger(userId).mergedAt === 'number';
}

/* ------------------------------------------------------------------------------------------ *
 * "Leave it in this browser only"
 * ------------------------------------------------------------------------------------------ */

/**
 * The kept-local ids of an already-read ledger, as a set. Pure, and deliberately forgiving: a
 * missing field (legacy blob) or a corrupt one (an object where an array belongs, a stray number
 * among the ids) reads as "no decision recorded", never as an exception.
 */
export function keptLocalOf(ledger: UserLedger): Set<string> {
    const list = ledger.keptLocal;
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0));
}

/** The kept-local ids for one account. */
export function readKeptLocal(userId: string): Set<string> {
    return keptLocalOf(readLedger(userId));
}

/** Record "leave this profile in this browser only" for one profile. */
export function rememberKeptLocal(userId: string, profileId: string): UserLedger {
    const ledger = readLedger(userId);
    const kept = keptLocalOf(ledger);
    if (kept.has(profileId)) return ledger;
    kept.add(profileId);
    const next: UserLedger = { ...ledger, keptLocal: [...kept] };
    writeLedger(userId, next);
    return next;
}

/**
 * Forget that decision, because the profile demonstrably *is* in the account now. Only ever called
 * where that is proven — a successful push (the user changed their mind) or a successful pull (it
 * arrived from another device). A failed push must leave the decision standing, and a stale id must
 * never outlive the profile's absence: an id kept here after the profile reached the account would
 * exclude it from every automatic push the moment its ledger entry is dropped.
 */
export function forgetKeptLocal(userId: string, profileId: string): UserLedger {
    const ledger = readLedger(userId);
    const kept = keptLocalOf(ledger);
    if (!kept.delete(profileId)) return ledger;
    const next: UserLedger = { ...ledger, keptLocal: [...kept] };
    writeLedger(userId, next);
    return next;
}

/** Drop everything we believe about one account (sign-out of a shared machine, tests). */
export function clearLedger(userId: string): void {
    const file = { ...readFile() };
    delete file[userId];
    writeFile(file);
}

/** Test hook: forget the in-memory mirror so the next read hits storage again. */
export function resetLedgerCache(): void {
    cache = null;
}
