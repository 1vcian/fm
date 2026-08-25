/**
 * AuthContext — magic-link sign-in state for the whole app.
 * ========================================================
 *
 * WHY THERE IS NO `<AuthProvider>` IN THE TREE
 * -------------------------------------------
 * Auth is a **single global fact** ("who is signed in"), it is owned by supabase-js (which is
 * itself a module singleton with its own `onAuthStateChange` emitter), and it must be readable
 * from places that are mounted *outside* any provider we could add. So instead of a React
 * context this is a tiny external store read through `useSyncExternalStore` (React 18). The
 * public API is still a hook — `useAuth()` — so call sites look like any other context, and
 * `App.tsx` needs no change at all.
 *
 * THE NO-BACKEND PATH IS THE DEFAULT, NOT A FALLBACK
 * --------------------------------------------------
 * With `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` absent the store settles immediately on
 * `status: 'unconfigured'` and **never** creates a client, never touches the network and never
 * registers a listener. `useAuth()` still works; it just reports that accounts do not exist in
 * this build. Everything else in the app keeps running from `localStorage`, exactly as today.
 *
 * Initialisation is lazy: it happens on the first `useAuth()` subscription, not at import, so a
 * page that never renders the account UI pays nothing.
 *
 * WHAT "SIGNING IN" MEANS HERE
 * ---------------------------
 *   1. `sendMagicLink(email)` -> `signInWithOtp` with `emailRedirectTo` = the app root.
 *   2. The user clicks the mail; Supabase bounces them back to `/fm/?code=` (PKCE).
 *   3. `src/services/authUrl.ts` has already lifted `code` out of the URL before anything else
 *      could read it (the share-link payload lives in the fragment — see that file).
 *   4. This module redeems it with `exchangeCodeForSession`, and from then on supabase-js keeps
 *      the session fresh in `localStorage`.
 *
 * RATE LIMITS ARE A FIRST-CLASS STATE, NOT AN ERROR STRING
 * -------------------------------------------------------
 * A Supabase project on the free tier sends only a handful of mails per hour through the shared
 * SMTP sender, and there is a per-address cooldown of ~60 s on top. Users hit this constantly, so
 * `rateLimited` / `retryAfterSeconds` are modelled explicitly and the UI says what is happening
 * instead of showing a raw 429.
 */

import { useSyncExternalStore, useCallback } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient, hasPersistedSession, isBackendConfigured } from '../services/supabaseClient';
import {
    clearCapturedAuthParams,
    getAuthRedirectUrl,
    getCapturedAuthParams,
    hadAuthCallback,
} from '../services/authUrl';

/* ------------------------------------------------------------------------------------------ *
 * State shape
 * ------------------------------------------------------------------------------------------ */

/**
 *  - `unconfigured`  no `VITE_SUPABASE_*` in this build. Accounts do not exist. NOT an error.
 *  - `initialising`  configured, restoring a stored session / redeeming a callback code.
 *  - `signed-out`    configured, no session.
 *  - `signed-in`     configured, session present.
 */
export type AuthStatus = 'unconfigured' | 'initialising' | 'signed-out' | 'signed-in';

/** Lifecycle of one "send me a link" request. */
export type MagicLinkStatus = 'idle' | 'sending' | 'sent' | 'error';

export interface AuthState {
    status: AuthStatus;
    userId: string | null;
    email: string | null;
    /** Access token presence is all any caller needs; the token itself stays inside the client. */
    hasSession: boolean;

    magicLink: MagicLinkStatus;
    /** Address the last link was sent to, so the "check your inbox" panel can name it. */
    magicLinkEmail: string | null;

    /** Human-readable problem with the *last action*, or `null`. */
    error: string | null;
    /** True when `error` is a send-rate limit rather than a real failure. */
    rateLimited: boolean;
    /** Seconds Supabase asked us to wait, when it said so. */
    retryAfterSeconds: number | null;

    /**
     * Message about the sign-in *callback* (expired link, wrong browser, ). Separate from
     * `error` because it describes something that happened before this page even rendered.
     */
    notice: string | null;
}

const UNCONFIGURED: AuthState = {
    status: 'unconfigured',
    userId: null,
    email: null,
    hasSession: false,
    magicLink: 'idle',
    magicLinkEmail: null,
    error: null,
    rateLimited: false,
    retryAfterSeconds: null,
    notice: null,
};

/* ------------------------------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------------------------------ */

let state: AuthState = isBackendConfigured()
    ? { ...UNCONFIGURED, status: 'initialising' }
    : UNCONFIGURED;

const listeners = new Set<() => void>();

function setState(patch: Partial<AuthState>): void {
    const next = { ...state, ...patch };
    // Cheap identity guard: `useSyncExternalStore` re-renders on every notification, so avoid
    // notifying when nothing actually moved.
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AuthState)[]) {
        if (state[key] !== next[key]) { changed = true; break; }
    }
    if (!changed) return;
    state = next;
    for (const listener of listeners) listener();
}

function getSnapshot(): AuthState {
    return state;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void initialise();
    return () => { listeners.delete(listener); };
}

/**
 * Non-React subscription, for services (the sync engine) that need to react to sign-in/out
 * without rendering. Same store, same lazy initialisation — so a service subscribing is enough
 * to start auth, and nothing starts it when nobody cares.
 */
export function subscribeAuth(listener: () => void): () => void {
    return subscribe(listener);
}

/* ------------------------------------------------------------------------------------------ *
 * Error interpretation
 * ------------------------------------------------------------------------------------------ */

interface ErrorLike {
    message?: string;
    status?: number;
    code?: string;
    name?: string;
}

/** Seconds out of "you can only request this after 47 seconds". */
function parseRetryAfter(message: string): number | null {
    const match = /after (\d+) seconds?/i.exec(message);
    return match ? Number(match[1]) : null;
}

function isOffline(error: ErrorLike): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const message = (error.message || '').toLowerCase();
    return error.name === 'TypeError' || message.includes('failed to fetch') || message.includes('network');
}

interface Interpreted {
    message: string;
    rateLimited: boolean;
    retryAfterSeconds: number | null;
}

/**
 * Turns a Supabase auth error into something a person can act on. The rate-limit case gets an
 * explicit explanation because it is by far the most common one on a free project and looks like
 * a bug otherwise.
 */
function interpretAuthError(error: ErrorLike): Interpreted {
    const raw = (error.message || 'Sign-in failed.').trim();
    const lower = raw.toLowerCase();

    const isRateLimit =
        error.status === 429 ||
        error.code === 'over_email_send_rate_limit' ||
        error.code === 'over_request_rate_limit' ||
        lower.includes('rate limit') ||
        lower.includes('for security purposes');

    if (isRateLimit) {
        const wait = parseRetryAfter(raw);
        return {
            // Deliberately says nothing about WHICH sender or WHAT the ceiling is. The previous
            // wording named Supabase's shared free-tier sender and "a few per hour", which stopped
            // being true the day this project moved to its own SMTP, and a message that explains
            // the wrong cause sends people to debug the wrong thing.
            message: wait
                ? `Too many sign-in requests. Wait ${wait}s before asking for another link, and check your spam folder meanwhile: the one already sent stays valid for an hour.`
                : 'Too many sign-in requests in a short time. Check your spam folder before asking again, because a link already sent to you stays valid for an hour and works exactly the same.',
            rateLimited: true,
            retryAfterSeconds: wait,
        };
    }

    if (isOffline(error)) {
        return {
            message: 'Cannot reach the server. Check your connection. The app keeps working offline, your data is safe in this browser.',
            rateLimited: false,
            retryAfterSeconds: null,
        };
    }

    if (lower.includes('invalid email') || lower.includes('unable to validate email')) {
        return { message: 'That email address does not look valid.', rateLimited: false, retryAfterSeconds: null };
    }

    if (lower.includes('signups not allowed') || error.code === 'signup_disabled') {
        return {
            message: 'This project is not accepting new accounts right now.',
            rateLimited: false,
            retryAfterSeconds: null,
        };
    }

    return { message: raw, rateLimited: false, retryAfterSeconds: null };
}

/** Explains a failed callback in terms of what the user should do next. */
function describeCallbackFailure(error: ErrorLike, code?: string): string {
    const lower = (error.message || '').toLowerCase();
    if (code === 'otp_expired' || lower.includes('expired')) {
        return 'That sign-in link has expired. Magic links are valid for one hour and can only be used once. Request a new one.';
    }
    if (lower.includes('code verifier') || lower.includes('code challenge')) {
        return 'That link was opened in a different browser (or after clearing site data) than the one that requested it. Request a new link and open it in this browser.';
    }
    if (lower.includes('already') || lower.includes('used')) {
        return 'That sign-in link has already been used. Request a new one.';
    }
    return error.message || 'Sign-in failed.';
}

/* ------------------------------------------------------------------------------------------ *
 * Initialisation: restore a session and/or redeem a callback
 * ------------------------------------------------------------------------------------------ */

let initPromise: Promise<void> | null = null;

async function redeemCallback(): Promise<string | null> {
    const params = getCapturedAuthParams();
    if (!params) return null;

    const client = await getSupabaseClient();
    // Spend them exactly once, whatever happens below.
    clearCapturedAuthParams();

    if (params.error || params.errorDescription) {
        return describeCallbackFailure(
            { message: params.errorDescription || params.error },
            params.errorCode || params.error,
        );
    }
    if (!client) return null;

    try {
        if (params.code) {
            const { error } = await client.auth.exchangeCodeForSession(params.code);
            if (error) return describeCallbackFailure(error as ErrorLike);
            return null;
        }
        if (params.accessToken && params.refreshToken) {
            // Implicit-flow link (older project template). Accepted so nobody is locked out.
            const { error } = await client.auth.setSession({
                access_token: params.accessToken,
                refresh_token: params.refreshToken,
            });
            if (error) return describeCallbackFailure(error as ErrorLike);
            return null;
        }
        if (params.tokenHash) {
            const { error } = await client.auth.verifyOtp({
                token_hash: params.tokenHash,
                type: (params.otpType as 'email' | 'magiclink' | 'recovery') || 'email',
            });
            if (error) return describeCallbackFailure(error as ErrorLike);
            return null;
        }
    } catch (e) {
        return describeCallbackFailure(e as ErrorLike);
    }
    return null;
}

function applySession(session: Session | null): void {
    if (session?.user) {
        setState({
            status: 'signed-in',
            userId: session.user.id,
            email: session.user.email ?? null,
            hasSession: true,
            // A successful sign-in retires any "check your inbox" panel.
            magicLink: 'idle',
        });
    } else {
        setState({ status: 'signed-out', userId: null, email: null, hasSession: false });
    }
}

/** Attach the session listener at most once, whichever path got us a client first. */
let listenerAttached = false;
function attachAuthListener(client: { auth: { onAuthStateChange: (cb: (e: AuthChangeEvent, s: Session | null) => void) => unknown } }): void {
    if (listenerAttached) return;
    listenerAttached = true;
    client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
        applySession(session);
    });
}

function initialise(): Promise<void> {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        if (!isBackendConfigured()) {
            setState({ ...UNCONFIGURED });
            return;
        }

        // Fast path for the common case: a configured build, a visitor who is not signed in and
        // did not arrive from a sign-in link. Settling here means the 58 KB client chunk is never
        // requested — the page costs exactly what it did before accounts existed. `sendMagicLink`
        // loads the client when the user actually asks to sign in.
        if (!hadAuthCallback() && !hasPersistedSession()) {
            setState({ status: 'signed-out', userId: null, email: null, hasSession: false });
            return;
        }

        const client = await getSupabaseClient();
        if (!client) {
            // No configuration (or client creation failed): permanent local-only mode.
            setState({ ...UNCONFIGURED });
            return;
        }

        const notice = await redeemCallback();
        if (notice) setState({ notice });

        try {
            const { data } = await client.auth.getSession();
            applySession(data.session ?? null);
        } catch {
            // Session restore reads localStorage; if that is blocked we are simply signed out.
            setState({ status: 'signed-out', userId: null, email: null, hasSession: false });
        }

        attachAuthListener(client);
    })();

    return initPromise;
}

/* ------------------------------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------------------------------ */

/** Sends a magic link. Resolves to `true` when Supabase accepted the request. */
export async function sendMagicLink(email: string): Promise<boolean> {
    const address = email.trim();
    if (!address) {
        setState({ magicLink: 'error', error: 'Enter your email address first.', rateLimited: false, retryAfterSeconds: null });
        return false;
    }

    const client = await getSupabaseClient();
    if (!client) {
        setState({ magicLink: 'error', error: 'Accounts are not available in this build.', rateLimited: false });
        return false;
    }

    setState({ magicLink: 'sending', error: null, rateLimited: false, retryAfterSeconds: null, notice: null, magicLinkEmail: address });

    try {
        const { error } = await client.auth.signInWithOtp({
            email: address,
            options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        if (error) {
            const interpreted = interpretAuthError(error as ErrorLike);
            setState({
                magicLink: 'error',
                error: interpreted.message,
                rateLimited: interpreted.rateLimited,
                retryAfterSeconds: interpreted.retryAfterSeconds,
            });
            return false;
        }
        setState({ magicLink: 'sent', error: null, rateLimited: false, retryAfterSeconds: null });
        // `initialise()` may have settled on the fast path above (no session, no callback) and
        // therefore never attached `onAuthStateChange`. Now that a client exists and a sign-in is
        // in flight, attach it so a session arriving in this tab is picked up live.
        attachAuthListener(client);
        return true;
    } catch (e) {
        const interpreted = interpretAuthError(e as ErrorLike);
        setState({
            magicLink: 'error',
            error: interpreted.message,
            rateLimited: interpreted.rateLimited,
            retryAfterSeconds: interpreted.retryAfterSeconds,
        });
        return false;
    }
}

/** Ends the session. Local profiles are untouched — signing out is not a delete. */
export async function signOut(): Promise<void> {
    const client = await getSupabaseClient();
    if (!client) return;
    try {
        await client.auth.signOut();
    } catch {
        // Even a failed network call should leave the UI signed out: the local session is gone.
    }
    setState({
        status: 'signed-out',
        userId: null,
        email: null,
        hasSession: false,
        magicLink: 'idle',
        magicLinkEmail: null,
        error: null,
        rateLimited: false,
        retryAfterSeconds: null,
        notice: null,
    });
}

/** Clears the transient error / notice so the panel can go back to its resting state. */
export function dismissAuthMessages(): void {
    setState({ error: null, notice: null, rateLimited: false, retryAfterSeconds: null });
}

/** Back to the email form after a "check your inbox". */
export function resetMagicLink(): void {
    setState({ magicLink: 'idle', error: null, rateLimited: false, retryAfterSeconds: null });
}

/* ------------------------------------------------------------------------------------------ *
 * Hook
 * ------------------------------------------------------------------------------------------ */

export interface UseAuth extends AuthState {
    /** `status === 'unconfigured'` — the app has no accounts at all in this build. */
    backendConfigured: boolean;
    sendMagicLink: (email: string) => Promise<boolean>;
    signOut: () => Promise<void>;
    dismissMessages: () => void;
    resetMagicLink: () => void;
}

export function useAuth(): UseAuth {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    return {
        ...snapshot,
        backendConfigured: snapshot.status !== 'unconfigured',
        sendMagicLink: useCallback(sendMagicLink, []),
        signOut: useCallback(signOut, []),
        dismissMessages: useCallback(dismissAuthMessages, []),
        resetMagicLink: useCallback(resetMagicLink, []),
    };
}

/** Non-React read, for services that need the current user without a subscription. */
export function getAuthSnapshot(): AuthState {
    return state;
}
