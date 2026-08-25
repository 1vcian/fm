/**
 * authUrl — capture and strip Supabase auth callback parameters, BEFORE anything else reads
 * the URL.
 * =============================================================================================
 *
 * WHY THIS RUNS FIRST
 * -------------------
 * Two different features want the URL at boot:
 *
 *  1. **Share links** (`src/utils/shareCodec.ts`): the profile payload travels in the URL
 *     *fragment* as `#/?p=`, and `src/context/ProfileContext.tsx` snapshots
 *     `window.location.{search,hash}` at *module load* — before React, before the HashRouter.
 *  2. **Magic-link sign-in**: Supabase sends the user back to the app with auth material in the
 *     URL. With the **implicit** flow that material is in the *fragment*
 *     (`#access_token=&refresh_token=`) — the exact place the share payload lives, so the two
 *     collide and the fragment becomes ambiguous. With **PKCE** it is a query parameter
 *     (`?code=`), which collides with nothing.
 *
 * So the client is configured for PKCE (`src/services/supabaseClient.ts`), and this module runs
 * as the very first import of `ProfileContext` to:
 *
 *   a. lift any auth parameters out of the URL (query *and* fragment, so an implicit-flow link
 *      from an older Supabase project template still works),
 *   b. rewrite the address bar without them — keeping the HashRouter route and any share
 *      payload intact,
 *   c. hand them to `AuthContext`, which redeems them explicitly.
 *
 * After this module has run, `hasSharedPayload()` sees a clean URL and can never mistake an
 * access token for a share payload.
 *
 * NOTHING HERE NEEDS A BACKEND. With no `VITE_SUPABASE_*` configured the URL never contains
 * these parameters, `capture()` finds nothing, no `replaceState` happens, and the boot is
 * byte-for-byte what it is today.
 */

/* ------------------------------------------------------------------------------------------ *
 * What we look for
 * ------------------------------------------------------------------------------------------ */

/**
 * Presence of ANY of these marks the URL as an auth callback. Deliberately narrow: `type` and
 * `expires_in` are too generic to trigger on their own, so they are only removed once one of
 * these markers is found.
 */
const AUTH_MARKERS = ['code', 'access_token', 'token_hash', 'error', 'error_description'] as const;

/** Everything Supabase may append, removed as a block once a marker is present. */
const AUTH_KEYS = [
    'code',
    'access_token',
    'refresh_token',
    'expires_in',
    'expires_at',
    'token_type',
    'provider_token',
    'provider_refresh_token',
    'token_hash',
    'type',
    'error',
    'error_code',
    'error_description',
] as const;

export interface CapturedAuthParams {
    /** PKCE authorization code — redeemed with `exchangeCodeForSession`. */
    code?: string;
    /** Implicit-flow tokens — redeemed with `setSession`. */
    accessToken?: string;
    refreshToken?: string;
    /** Hashed-token link — redeemed with `verifyOtp`. */
    tokenHash?: string;
    /** OTP `type` (`magiclink`, `email`, `recovery`, ), only meaningful with `tokenHash`. */
    otpType?: string;
    /** Machine-readable failure (`access_denied`, `otp_expired`, ). */
    error?: string;
    errorCode?: string;
    /** Human-readable failure text as sent by Supabase (already URL-decoded). */
    errorDescription?: string;
}

/* ------------------------------------------------------------------------------------------ *
 * Fragment helpers
 *
 * The app uses a HashRouter, so the fragment is `#/route?a=b`. An implicit-flow callback is a
 * bare `#a=b`. Both shapes have to survive a round trip through this parser.
 * ------------------------------------------------------------------------------------------ */

interface SplitFragment {
    /** Route part, without the leading `#` (may be empty). */
    route: string;
    /** Query part, without the leading `?` (may be empty). */
    query: string;
}

function splitFragment(hash: string): SplitFragment {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const q = raw.indexOf('?');
    if (q >= 0) return { route: raw.slice(0, q), query: raw.slice(q + 1) };
    // No `?`: either a pure route (`#/clan`) or a bare parameter blob (`#access_token=`).
    return raw.includes('=') ? { route: '', query: raw } : { route: raw, query: '' };
}

function joinFragment(route: string, query: string): string {
    if (!route && !query) return '';
    return `#${route}${query ? `?${query}` : ''}`;
}

/* ------------------------------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------------------------------ */

let captured: CapturedAuthParams | null = null;
let hasRun = false;

function pick(params: URLSearchParams, key: string): string | undefined {
    const value = params.get(key);
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function readFrom(params: URLSearchParams): CapturedAuthParams | null {
    if (!AUTH_MARKERS.some(marker => params.has(marker))) return null;
    return {
        code: pick(params, 'code'),
        accessToken: pick(params, 'access_token'),
        refreshToken: pick(params, 'refresh_token'),
        tokenHash: pick(params, 'token_hash'),
        otpType: pick(params, 'type'),
        error: pick(params, 'error'),
        errorCode: pick(params, 'error_code'),
        errorDescription: pick(params, 'error_description'),
    };
}

/**
 * Reads (and removes) auth parameters from the current URL. Idempotent: only the first call
 * does anything, so importing this module from several places is harmless.
 *
 * Never throws — a browser that refuses `history.replaceState` (or a non-browser context)
 * simply leaves the URL alone.
 */
export function captureAuthParamsFromUrl(): CapturedAuthParams | null {
    if (hasRun) return captured;
    hasRun = true;

    if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;

    try {
        const search = new URLSearchParams(window.location.search);
        const fragment = splitFragment(window.location.hash);
        const fragmentParams = new URLSearchParams(fragment.query);

        // Query first (PKCE), fragment second (implicit / older templates).
        const fromQuery = readFrom(search);
        const fromFragment = readFrom(fragmentParams);
        if (!fromQuery && !fromFragment) return null;

        captured = { ...fromFragment, ...fromQuery };
        // Drop keys that ended up undefined so callers can use plain truthiness.
        for (const key of Object.keys(captured) as (keyof CapturedAuthParams)[]) {
            if (captured[key] === undefined) delete captured[key];
        }

        for (const key of AUTH_KEYS) {
            search.delete(key);
            fragmentParams.delete(key);
        }

        const nextSearch = search.toString();
        const nextHash = joinFragment(fragment.route, fragmentParams.toString());
        const nextUrl =
            window.location.pathname + (nextSearch ? `?${nextSearch}` : '') + nextHash;

        // The address bar must not keep a usable authorization code / access token: it ends up
        // in history, in screenshots and in anything the user pastes.
        window.history.replaceState(window.history.state, '', nextUrl);
    } catch {
        // A malformed URL or a blocked History API must never take the app down; the worst case
        // is that supabase-js's own `detectSessionInUrl` handles the link instead.
    }

    return captured;
}

/** The parameters lifted out of the URL at boot, or `null`. */
export function getCapturedAuthParams(): CapturedAuthParams | null {
    // Defensive: if someone reads before the boot call, do the capture now rather than miss it.
    return hasRun ? captured : captureAuthParamsFromUrl();
}

/** Forget them once redeemed, so a re-render cannot try to redeem a spent code twice. */
export function clearCapturedAuthParams(): void {
    captured = null;
}

/** True when the boot URL carried a sign-in attempt (success or failure). */
export function hadAuthCallback(): boolean {
    return getCapturedAuthParams() !== null;
}

/**
 * Where Supabase should send the user back to. `import.meta.env.BASE_URL` is `/fm/` in the
 * GitHub Pages build and `/` in dev, so this is the app root in both — and it must be listed in
 * the project's "Redirect URLs" allow-list (docs/SUPABASE_SETUP.md).
 */
export function getAuthRedirectUrl(): string {
    if (typeof window === 'undefined') return '';
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
    return `${window.location.origin}${base.startsWith('/') ? base : `/${base}`}`;
}

// Side effect on import: this module exists to win the race against ProfileContext's snapshot of
// `window.location`, so it does its work as soon as it is loaded.
captureAuthParamsFromUrl();
