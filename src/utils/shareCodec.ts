/**
 * Share / export codec — BACKEND_PLAN.md §4b.3 + §4c.
 *
 * Two jobs:
 *
 * 1. **Sanitisation.** A shared or exported profile is *build data only*: the profile `id`,
 *    the `isShared` view flag and any sync metadata are stripped. The id is useless to the
 *    receiver (import always mints a fresh one — see `generateProfileId` callers in
 *    ProfileContext) and, once profiles live server-side, leaking it would let someone
 *    squat the row before the owner first syncs. Everything else travels: collections,
 *    saved builds, saved items, misc, the whole profile (explicit decision, §4c.4).
 *
 * 2. **Codec.** gzip (native `CompressionStream`) + base64url in the URL **fragment**, which
 *    is never sent to the server. ~65 % shorter than the old lz-string query payload.
 *    Legacy links (`?b62c=` lz-string, `?b62=` plain base64) keep decoding forever.
 *
 * Payload tokens are tagged with one leading character so several codecs can coexist under
 * the same `p` parameter: `g` = gzip+base64url, `l` = lz-string (fallback for browsers with
 * no `CompressionStream`, e.g. Safari < 16.4).
 */

import LZString from 'lz-string';
import { INITIAL_PROFILE, UserProfile } from '../types/Profile';

/** Fragment parameter carrying the payload. */
export const SHARE_PARAM = 'p';
/** gzip + base64url payload tag. */
export const TAG_GZIP = 'g';
/** lz-string payload tag (fallback codec). */
export const TAG_LZ = 'l';

/**
 * Fields never included in a share link or an export.
 * `id` / `isShared` / `techTreeUpdatedAt` exist today; the rest are the sync metadata the
 * backend phases will add (kept here so a future field cannot silently start travelling).
 */
const STRIPPED_FIELDS = [
    'id',
    'isShared',
    'techTreeUpdatedAt',
    // sync metadata (present or planned) — §4b.3
    'version',
    'updatedAt',
    'createdAt',
    'deletedAt',
    'syncedAt',
    'userId',
    'user_id',
    'syncVersion',
    'remoteVersion',
    'dirty',
    // clan membership can never live in the body (§4b.1) — belt and braces
    'clanId',
    'clanTag',
] as const;

/** The shape that travels: a UserProfile without the stripped fields. */
export type SharedProfilePayload = Omit<UserProfile, 'id' | 'isShared' | 'techTreeUpdatedAt' | 'version'>;

const isPlainObject = (v: unknown): v is Record<string, any> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const isEmptyContainer = (v: unknown): boolean =>
    (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).length === 0);

/**
 * Drops `undefined` values and empty containers, but ONLY where a fresh profile
 * (`INITIAL_PROFILE`) does not define that key — i.e. where the app already runs without it.
 * Recursion only enters objects that `INITIAL_PROFILE` describes as objects, so nothing
 * inside user data (items, pet/mount entries, saved builds) is ever reshaped.
 */
const pruneEmptyOptional = (value: Record<string, any>, initial: any): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [key, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const init = isPlainObject(initial) ? initial[key] : undefined;
        const pruned = isPlainObject(v) && isPlainObject(init) ? pruneEmptyOptional(v, init) : v;
        if (init === undefined && isEmptyContainer(pruned)) continue;
        out[key] = pruned;
    }
    return out;
};

/** Tech-tree levels of 0 are the default: omitting them is zero-loss (§4c.5). */
const trimTechTree = (techTree: UserProfile['techTree']): UserProfile['techTree'] => {
    const out: any = {};
    for (const tree of ['Forge', 'Power', 'SkillsPetTech', 'Clan'] as const) {
        const levels = techTree?.[tree] || {};
        const kept: Record<string, number> = {};
        for (const [nodeId, level] of Object.entries(levels)) {
            if (Number(level) > 0) kept[nodeId] = level as number;
        }
        // The four keys always exist (INITIAL_PROFILE guarantees them), so consumers that
        // read `techTree.Clan` directly keep working; only the zero entries disappear.
        out[tree] = kept;
    }
    return out as UserProfile['techTree'];
};

/**
 * The single sanitisation used by BOTH the share link and the .json export.
 * Returns a deep, JSON-safe copy — the input is never mutated.
 */
export function sanitizeProfileForTransport(profile: UserProfile): SharedProfilePayload {
    const clone = JSON.parse(JSON.stringify(profile)) as Record<string, any>;
    for (const field of STRIPPED_FIELDS) delete clone[field];
    const pruned = pruneEmptyOptional(clone, INITIAL_PROFILE);
    if (pruned.techTree || profile.techTree) {
        pruned.techTree = trimTechTree((pruned.techTree || {}) as UserProfile['techTree']);
    }
    return pruned as SharedProfilePayload;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

const bytesToBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToBytes = (value: string): Uint8Array => {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

// ---------------------------------------------------------------------------
// gzip via CompressionStream / DecompressionStream
// ---------------------------------------------------------------------------

const hasCompression = (): boolean => typeof CompressionStream !== 'undefined';
const hasDecompression = (): boolean => typeof DecompressionStream !== 'undefined';

const pumpThroughStream = async (
    input: Uint8Array,
    transform: GenericTransformStream
): Promise<Uint8Array> => {
    const writer = (transform.writable as WritableStream<Uint8Array>).getWriter();
    // Not awaited on purpose: the writer only resolves once the reader drains the stream.
    void writer.write(input).catch(() => { /* surfaced by the reader below */ });
    void writer.close().catch(() => { /* idem */ });

    const reader = (transform.readable as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            total += value.length;
        }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
};

const gzip = (text: string): Promise<Uint8Array> =>
    pumpThroughStream(new TextEncoder().encode(text), new CompressionStream('gzip'));

const gunzip = async (bytes: Uint8Array): Promise<string> =>
    new TextDecoder().decode(await pumpThroughStream(bytes, new DecompressionStream('gzip')));

// ---------------------------------------------------------------------------
// encode
// ---------------------------------------------------------------------------

/**
 * Sanitises + compresses a profile into the tagged payload token that goes after `#p=`.
 * gzip+base64url when the platform has `CompressionStream`, lz-string otherwise, so
 * sharing never breaks on old Safari.
 */
export async function encodeProfileForShare(profile: UserProfile): Promise<string> {
    const json = JSON.stringify(sanitizeProfileForTransport(profile));
    if (hasCompression()) {
        try {
            return TAG_GZIP + bytesToBase64Url(await gzip(json));
        } catch (e) {
            console.warn('gzip share encoding failed, falling back to lz-string', e);
        }
    }
    return TAG_LZ + LZString.compressToEncodedURIComponent(json);
}

/**
 * Full share URL. The payload lives in the fragment (§4c.3: never reaches the server, never
 * lands in Pages/CDN logs or a `Referer`). The app uses a HashRouter, so the fragment is
 * shaped as a route + query (`#/?p=`) instead of a bare `#p=`, which the router would
 * read as an unknown path.
 */
export async function buildShareUrl(profile: UserProfile, base?: string): Promise<string> {
    const root = base ?? `${window.location.origin}${window.location.pathname}`;
    return `${root}#/?${SHARE_PARAM}=${await encodeProfileForShare(profile)}`;
}

// ---------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------

export interface SharePayloadSource {
    /** `window.location.search` */
    search?: string;
    /** `window.location.hash` */
    hash?: string;
}

/** Query string embedded in the fragment: `#/?p=`, `#p=` and `#/route?p=` all work. */
const fragmentParams = (hash?: string): URLSearchParams => {
    if (!hash) return new URLSearchParams();
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const q = raw.indexOf('?');
    return new URLSearchParams(q >= 0 ? raw.slice(q + 1) : raw);
};

/** Cheap synchronous test: is there anything to decode at all? */
export function hasSharedPayload(source: SharePayloadSource): boolean {
    const search = new URLSearchParams(source.search || '');
    return Boolean(
        fragmentParams(source.hash).get(SHARE_PARAM) ||
        search.get(SHARE_PARAM) ||
        search.get('b62c') ||
        search.get('b62')
    );
}

const decodeToken = async (token: string): Promise<string | null> => {
    const tag = token[0];
    const body = token.slice(1);
    if (tag === TAG_GZIP) {
        if (!hasDecompression()) {
            console.error('This browser cannot read gzip share links (no DecompressionStream).');
            return null;
        }
        return gunzip(base64UrlToBytes(body));
    }
    if (tag === TAG_LZ) {
        return LZString.decompressFromEncodedURIComponent(body);
    }
    // Untagged payload: be liberal and try both codecs before giving up.
    if (hasDecompression()) {
        try {
            return await gunzip(base64UrlToBytes(token));
        } catch { /* fall through */ }
    }
    return LZString.decompressFromEncodedURIComponent(token);
};

/**
 * Decodes a shared profile from a location, accepting (in order):
 *   1. `#p=` — current format, gzip+base64url (or lz-string fallback), in the fragment;
 *   2. `?p=`   — same token in the query string (defensive: hand-edited / proxied links);
 *   3. `?b62c=` — legacy lz-string;
 *   4. `?b62=`  — legacy plain base64.
 *
 * Returns the raw payload object, or `null` when there is nothing to decode or the payload is
 * malformed (malformed is simply ignored, exactly like before).
 */
export async function decodeSharedPayload(
    source: SharePayloadSource
): Promise<Record<string, any> | null> {
    const search = new URLSearchParams(source.search || '');
    const fragment = fragmentParams(source.hash);

    const token = fragment.get(SHARE_PARAM) || search.get(SHARE_PARAM);
    const b62c = search.get('b62c');
    const b62 = search.get('b62');

    try {
        let json: string | null = null;
        if (token) {
            json = await decodeToken(token);
        } else if (b62c) {
            json = LZString.decompressFromEncodedURIComponent(b62c);
        } else if (b62) {
            json = atob(b62);
        }

        if (!json) return null;
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, any>;
    } catch (e) {
        console.error('Failed to parse shared profile', e);
        return null;
    }
}
