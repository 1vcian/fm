/**
 * pushClient — registration, permission, subscribe/unsubscribe for Web Push.
 * =========================================================================
 *
 * Everything in this file exists because `PushManager` is reachable ONLY from a registered service
 * worker, on every platform. There is no path to a push subscription that skips `public/sw.js`.
 *
 * THE SCOPE PROBLEM, AND HOW IT IS SOLVED HERE
 * -------------------------------------------
 * A worker's scope can never be wider than the directory its script is served from, and it can only
 * be widened by a `Service-Worker-Allowed` response header — which GitHub Pages does not let us
 * send. So the answer is placement, not configuration: `public/sw.js` is copied to the deploy root,
 * the deploy root is `/fm/`, and the script therefore lands at `/fm/sw.js` with a default scope of
 * `/fm/`. This module registers it at `${import.meta.env.BASE_URL}sw.js` and passes
 * `scope: import.meta.env.BASE_URL` explicitly — not because the default is wrong, but so that a
 * future move of the file fails loudly (`register()` rejects when the requested scope is outside the
 * script's path) instead of silently yielding a worker that controls nothing.
 *
 * SECRETS — READ THIS BEFORE ADDING AN ENV VAR
 * -------------------------------------------
 *   VITE_VAPID_PUBLIC_KEY   the PUBLIC half of the VAPID ECDSA P-256 key pair, base64url, 87 chars
 *                           (65 raw bytes, uncompressed point, first byte 0x04). This is meant to be
 *                           public: the browser needs it to mint a subscription and it identifies
 *                           the application server, nothing more. Shipping it in the bundle is what
 *                           it is for.
 *
 * The PRIVATE half must never appear in this repo, in any `.env*` file, in a `VITE_`-prefixed
 * variable, or in anything Vite can see — a `VITE_*` value is compiled into a public JavaScript
 * file. It belongs in the Supabase Edge Function's secrets (`supabase secrets set
 * VAPID_PRIVATE_KEY=`, alongside `VAPID_SUBJECT=mailto:`), where only the sender reads it.
 * Rotating it invalidates every existing subscription, which is why `push_subscriptions`
 * (0009 §1) stores `vapid_public_key` per row and why `readSubscriptionState()` below compares the
 * key this build ships against the key the local subscription was minted with.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------
 * It does not register the worker on page load. A visitor who never asks for notifications should
 * pay nothing for them, and once `enablePush()` has run the registration persists across sessions
 * on its own — so `ensureServiceWorker()` is called from a tap, and from `syncPushSubscription()`
 * which the panel only runs for a signed-in user whose permission is already `granted`.
 */

import { getSupabaseClient, isBackendConfigured } from './supabaseClient';
import { getAuthSnapshot } from '../context/AuthContext';

declare global {
    interface ImportMetaEnv {
        /**
         * Base64url VAPID **public** key. Absent means this build cannot subscribe anybody — the
         * panel says so rather than firing a permission prompt that leads nowhere.
         */
        readonly VITE_VAPID_PUBLIC_KEY?: string;
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------------------------------ */

/**
 * Why push is not available. Each of these is a DIFFERENT sentence to the user, which is the whole
 * reason they are separate values: "your browser cannot do this" and "you have to add this to your
 * Home Screen first" and "you said no and only you can undo it" are three different problems and
 * two of them are fixable by the person reading.
 */
export type PushBlocker =
    /** No `VITE_SUPABASE_*` in this build: there are no accounts, so there is nothing to notify. */
    | 'no-backend'
    /** Not `https:` and not localhost. Service workers do not exist in an insecure context. */
    | 'insecure-context'
    /** No `serviceWorker`, no `PushManager`, or no `Notification` in this browser. */
    | 'unsupported'
    /** iOS/iPadOS, and the site is not running from the Home Screen. No prompt can succeed. */
    | 'ios-not-installed'
    /** This build shipped without `VITE_VAPID_PUBLIC_KEY`, or with one that is not a P-256 point. */
    | 'no-vapid-key';

/** Everything the panel needs to decide what to render, read synchronously and with no side effects. */
export interface PushEnvironment {
    /** True when a subscription is possible *in principle* here. Says nothing about permission. */
    supported: boolean;
    /** The first reason it is not, or `null`. */
    blocker: PushBlocker | null;
    /** `'unavailable'` when the Notification API is missing entirely. */
    permission: NotificationPermission | 'unavailable';
    /** Running from a Home Screen icon / installed window rather than a browser tab. */
    standalone: boolean;
    /** iOS or iPadOS — the one platform where installing is a *precondition*, not a nicety. */
    applePlatform: boolean;
}

export interface PushSubscriptionState {
    permission: NotificationPermission | 'unavailable';
    /** A live `PushSubscription` exists in this browser. */
    subscribed: boolean;
    /** and the server accepted it (the last `register_push_subscription` call succeeded). */
    registered: boolean;
    endpoint: string | null;
    /**
     * The local subscription was minted with a different application server key than this build
     * ships. `subscribe()` refuses to change it, so the only cure is unsubscribe + subscribe, which
     * `syncPushSubscription()` does automatically — permission is already granted, so it needs no
     * prompt and the user sees nothing.
     */
    keyMismatch: boolean;
}

export type PushFailure =
    | PushBlocker
    /** Configured backend, nobody signed in. Push is sign-in-only by the owner's decision. */
    | 'signed-out'
    /** The user answered "Don't allow". Only they can undo it, in browser settings. */
    | 'denied'
    /** The prompt was closed without an answer; permission is still `default`. */
    | 'dismissed'
    /** `register()` rejected: the script 404'd, was served as HTML, or the scope was refused. */
    | 'sw-failed'
    /** `pushManager.subscribe()` rejected. Usually a malformed VAPID key or a blocked push service. */
    | 'subscribe-failed'
    /** The RPC refused the endpoint — 0009 §3.1's "already registered to another account". */
    | 'server-rejected'
    /** 0009 §3.1's 20-live-devices cap. */
    | 'device-limit'
    | 'network'
    | 'unknown';

export type PushResult =
    | { ok: true; state: PushSubscriptionState; note?: string }
    | { ok: false; reason: PushFailure; message: string };

/* ------------------------------------------------------------------------------------------ *
 * Environment probing
 * ------------------------------------------------------------------------------------------ */

/**
 * Apple mobile, which is the only platform where the app must be INSTALLED before a subscription is
 * possible at all.
 *
 * iPadOS 13+ sends a desktop Safari user-agent string ("Macintosh"), so the UA alone cannot tell an
 * iPad from a MacBook — and the distinction matters, because macOS Safari 16.1+ can subscribe from
 * an ordinary tab with no install. `maxTouchPoints` is what separates them.
 */
function detectApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
    return /Macintosh/.test(ua) && touchPoints > 1;
}

/**
 * Installed, rather than in a tab.
 *
 * Two mechanisms, because neither alone is enough: `display-mode` is the standard media feature and
 * is what Android and desktop report, while `navigator.standalone` is Safari's own non-standard flag
 * and is the ONLY signal on iOS. `fullscreen` and `minimal-ui` count as installed too — a manifest
 * can ask for either, and both are launched from a Home Screen icon.
 */
export function isStandaloneDisplay(): boolean {
    if (typeof window === 'undefined') return false;
    const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone;
    if (legacy === true) return true;
    if (typeof window.matchMedia !== 'function') return false;
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']) {
        try {
            if (window.matchMedia(`(display-mode: ${mode})`).matches) return true;
        } catch {
            /* an old engine that cannot parse the feature: treat as "not installed" */
        }
    }
    return false;
}

function readPermission(): NotificationPermission | 'unavailable' {
    if (typeof Notification === 'undefined') return 'unavailable';
    try {
        return Notification.permission;
    } catch {
        return 'unavailable';
    }
}

/**
 * The VAPID public key as raw bytes, or `null` when this build has none / a broken one.
 *
 * The length check is not pedantry. A malformed application server key makes
 * `pushManager.subscribe()` reject with a bare `AbortError` — no message, no cause, identical to a
 * push service being unreachable. Validating the shape here turns that into "this build was
 * deployed without a usable VAPID key", which is a sentence somebody can act on.
 */
function readVapidKey() {
    const env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) as
        | Partial<ImportMetaEnv>
        | undefined;
    const raw = typeof env?.VITE_VAPID_PUBLIC_KEY === 'string' ? env.VITE_VAPID_PUBLIC_KEY.trim() : '';
    if (!raw || raw === 'undefined' || raw === 'null') return null;
    try {
        const bytes = base64UrlToBytes(raw);
        // Uncompressed P-256 public point: 0x04 followed by two 32-byte coordinates.
        if (bytes.length !== 65 || bytes[0] !== 0x04) return null;
        return { raw, bytes };
    } catch {
        return null;
    }
}

/** Cheap, pure, safe to call on every render. */
export function readPushEnvironment(): PushEnvironment {
    const applePlatform = detectApplePlatform();
    const standalone = isStandaloneDisplay();
    const permission = readPermission();
    const base: Omit<PushEnvironment, 'supported' | 'blocker'> = { permission, standalone, applePlatform };

    const blocked = (blocker: PushBlocker): PushEnvironment => ({ ...base, supported: false, blocker });

    if (!isBackendConfigured()) return blocked('no-backend');
    if (typeof window === 'undefined') return blocked('unsupported');
    if (!window.isSecureContext) return blocked('insecure-context');

    // ORDER MATTERS. On iOS every browser is WebKit and `PushManager` is simply absent in a tab, so
    // checking "unsupported" first would tell an iPhone user their browser cannot do this — when in
    // fact it can, once the app is on the Home Screen. The install check has to come first.
    if (applePlatform && !standalone) return blocked('ios-not-installed');

    if (!('serviceWorker' in navigator)) return blocked('unsupported');
    if (!('PushManager' in window)) return blocked('unsupported');
    if (permission === 'unavailable') return blocked('unsupported');

    if (!readVapidKey()) return blocked('no-vapid-key');

    return { ...base, supported: true, blocker: null };
}

/* ------------------------------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------------------------------ */

/**
 * No explicit return type, and the buffer is allocated explicitly. `applicationServerKey` is typed
 * `BufferSource`, which since TypeScript 5.7 means `ArrayBufferView<ArrayBuffer>` — a bare
 * `Uint8Array` annotation widens to `Uint8Array<ArrayBufferLike>` and stops being assignable.
 * Letting inference see the `new ArrayBuffer(...)` keeps this compiling on both sides of that change
 * without naming a generic parameter older TypeScript does not have.
 */
function base64UrlToBytes(value: string) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
    if (!a) return false;
    const left = new Uint8Array(a);
    if (left.length !== b.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== b[i]) return false;
    return true;
}

/* ------------------------------------------------------------------------------------------ *
 * The worker
 * ------------------------------------------------------------------------------------------ */

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

/** `https://1vcian.me/fm/sw.js` in production, `http://localhost:3000/sw.js` in dev. */
export function serviceWorkerUrl(): string {
    return new URL(`${BASE}sw.js`, window.location.href).href;
}

/** `https://1vcian.me/fm/` in production. This is the scope the worker must end up with. */
export function serviceWorkerScope(): string {
    return new URL(BASE, window.location.href).href;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Register (or reuse) the worker and wait until it is usable.
 *
 * `pushManager.subscribe()` needs an ACTIVE worker, and a fresh `register()` returns while the new
 * worker is still installing — so this waits. `sw.js` calls `skipWaiting()`/`clients.claim()`, which
 * is safe precisely because it has no `fetch` listener: there is no page-versus-worker version skew
 * to create.
 *
 * `updateViaCache: 'none'` because GitHub Pages serves `sw.js` with a plain `max-age`, and without
 * this the browser is allowed to answer its own update check from the HTTP cache — a fixed worker
 * would then take up to that long to reach anybody.
 */
export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (registrationPromise) return registrationPromise;

    registrationPromise = (async () => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
        try {
            const registration = await navigator.serviceWorker.register(serviceWorkerUrl(), {
                scope: serviceWorkerScope(),
                updateViaCache: 'none',
            });
            installNavigationBridge();
            if (registration.active) return registration;
            await navigator.serviceWorker.ready;
            return (await navigator.serviceWorker.getRegistration(serviceWorkerScope())) || registration;
        } catch {
            // A 404, an HTML error page served with the wrong content type, a refused scope, or a
            // browser with workers disabled. All of them mean the same thing to the caller.
            registrationPromise = null;
            return null;
        }
    })();

    return registrationPromise;
}

/**
 * The scope the browser actually granted, for verification rather than for logic. Used by
 * `reverseForge/scratch/pwa_shots.mjs` to assert the registered scope is `/fm/` in a real browser
 * instead of trusting the argument we passed in.
 */
export async function readRegisteredScope(): Promise<string | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.getRegistration(serviceWorkerScope());
        return registration ? registration.scope : null;
    } catch {
        return null;
    }
}

/**
 * The worker's fallback route for a notification click, used only when `WindowClient.navigate()` is
 * refused (it is, for a client this worker does not control). Every route in the app lives in the
 * fragment, so applying the hash is the whole job — `HashRouter` picks up the rest.
 */
let bridgeInstalled = false;
function installNavigationBridge(): void {
    if (bridgeInstalled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    bridgeInstalled = true;
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.type !== 'fm-push-navigate' || typeof data.url !== 'string') return;
        try {
            const url = new URL(data.url, window.location.href);
            // Same-origin only: the message crosses a boundary, so it is treated as untrusted.
            if (url.origin !== window.location.origin) return;
            if (url.hash) window.location.hash = url.hash;
        } catch {
            /* unusable URL: ignore */
        }
    });
}

/* ------------------------------------------------------------------------------------------ *
 * The worker's IndexedDB — the only channel a worker has to remember anything
 * ------------------------------------------------------------------------------------------ *
 * `public/sw.js` cannot read localStorage, so the application server key it needs to re-subscribe
 * after a `pushsubscriptionchange` has to be handed over through IndexedDB. Same database, same
 * store, same keys — see the header of `sw.js`.
 */

const DB_NAME = 'fm-push';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function kvGet<T>(key: string): Promise<T | null> {
    try {
        const db = await openDb();
        return await new Promise<T | null>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result ? (req.result.v as T) : null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function kvSet(key: string, value: unknown): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ k: key, v: value });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* private mode, or storage denied. The page path still works; only the worker's
           self-healing re-subscribe is lost, and boot-time re-registration covers it. */
    }
}

interface HandoffRecord {
    oldEndpoint: string | null;
    endpoint: string | null;
    p256dh?: string;
    auth?: string;
    vapidPublicKey?: string | null;
    at: number;
}

/* ------------------------------------------------------------------------------------------ *
 * Reading the current state
 * ------------------------------------------------------------------------------------------ */

interface SubscriptionKeys {
    endpoint: string;
    p256dh: string;
    auth: string;
}

function describeSubscription(subscription: PushSubscription | null): SubscriptionKeys | null {
    if (!subscription) return null;
    const p256dh = subscription.getKey('p256dh');
    const auth = subscription.getKey('auth');
    if (!p256dh || !auth) return null;
    return {
        endpoint: subscription.endpoint,
        p256dh: bytesToBase64Url(p256dh),
        auth: bytesToBase64Url(auth),
    };
}

const EMPTY_STATE: PushSubscriptionState = {
    permission: 'unavailable',
    subscribed: false,
    registered: false,
    endpoint: null,
    keyMismatch: false,
};

/**
 * What this browser holds right now. Does NOT ask the server — `registered` reflects whether our
 * own last `register_push_subscription()` succeeded, which `syncPushSubscription()` refreshes on
 * boot. Reading the row instead would cost a request on every render for a fact the RPC already
 * told us.
 */
export async function readSubscriptionState(): Promise<PushSubscriptionState> {
    const permission = readPermission();
    const key = readVapidKey();
    const registration = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration(serviceWorkerScope()).catch(() => null)
        : null;
    if (!registration || !registration.pushManager) return { ...EMPTY_STATE, permission };

    let subscription: PushSubscription | null = null;
    try {
        subscription = await registration.pushManager.getSubscription();
    } catch {
        subscription = null;
    }
    if (!subscription) return { ...EMPTY_STATE, permission };

    const applicationServerKey = (subscription.options && subscription.options.applicationServerKey) || null;
    return {
        permission,
        subscribed: true,
        registered: (await kvGet<string>('registeredEndpoint')) === subscription.endpoint,
        endpoint: subscription.endpoint,
        keyMismatch: key ? !sameBytes(applicationServerKey, key.bytes) : false,
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Talking to Postgres
 * ------------------------------------------------------------------------------------------ */

interface RpcError {
    code?: string;
    message?: string;
}

/**
 * `register_push_subscription()` — 0009 §3.1. Idempotent by endpoint, which is the point: the
 * migration's own comment calls calling it on every boot "the real safety net for a subscription
 * lost outside our control".
 */
async function registerOnServer(keys: SubscriptionKeys, vapidPublicKey: string): Promise<PushResult | null> {
    const client = await getSupabaseClient();
    if (!client) return { ok: false, reason: 'no-backend', message: 'This build has no backend configured.' };

    const { error } = await client.rpc('register_push_subscription', {
        p_endpoint: keys.endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_vapid_public_key: vapidPublicKey,
        // The column is capped at 256 chars and `left()` truncates server-side anyway; this is only
        // so a device is recognisable in the account's device list.
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 256) : null,
    });

    if (!error) {
        await kvSet('registeredEndpoint', keys.endpoint);
        return null;
    }
    return { ok: false, ...interpretRpcError(error as RpcError) };
}

function interpretRpcError(error: RpcError): { reason: PushFailure; message: string } {
    const code = error.code || '';
    const raw = (error.message || '').trim();
    const lower = raw.toLowerCase();

    if (code === '54000' || lower.includes('device limit')) {
        return {
            reason: 'device-limit',
            message:
                'Your account already has 20 devices registered for notifications. Turn notifications off on one of them first.',
        };
    }
    if (code === '42501' && lower.includes('another account')) {
        return {
            reason: 'server-rejected',
            message:
                'This browser’s push endpoint is registered to a different account. Turning notifications off and on again mints a new one.',
        };
    }
    if (code === '42501') {
        return { reason: 'signed-out', message: 'Sign in again. The server did not recognise your session.' };
    }
    if (!code && (lower.includes('failed to fetch') || lower.includes('network'))) {
        return { reason: 'network', message: 'Could not reach the server. Check your connection and try again.' };
    }
    return { reason: 'unknown', message: raw || 'The server refused the subscription.' };
}

/* ------------------------------------------------------------------------------------------ *
 * Enable
 * ------------------------------------------------------------------------------------------ */

/**
 * The prompt is requested HERE and nowhere else, and this function is only ever reached from a
 * click. That is not a style choice:
 *
 *  - Chrome and Firefox refuse `Notification.requestPermission()` outside a user gesture.
 *  - On iOS a denial is close to permanent. The only way back is deleting the Home Screen icon and
 *    re-adding it, which also wipes site storage and every profile in it. So a prompt fired on load,
 *    before the user has read what it is for, can cost them their data to undo.
 *
 * The two-step explainer in `PushPanel` is what makes the tap informed.
 */
export async function enablePush(): Promise<PushResult> {
    const environment = readPushEnvironment();
    if (environment.blocker) {
        return { ok: false, reason: environment.blocker, message: describeBlocker(environment.blocker, environment) };
    }

    const auth = getAuthSnapshot();
    if (auth.status !== 'signed-in') {
        return {
            ok: false,
            reason: 'signed-out',
            message: 'Notifications are sent to your account, so you have to be signed in to turn them on.',
        };
    }

    const key = readVapidKey();
    if (!key) return { ok: false, reason: 'no-vapid-key', message: describeBlocker('no-vapid-key', environment) };

    // --- permission ------------------------------------------------------------------------
    if (readPermission() === 'denied') {
        return { ok: false, reason: 'denied', message: describeDenied(environment) };
    }
    if (readPermission() !== 'granted') {
        let answer: NotificationPermission;
        try {
            answer = await requestPermission();
        } catch {
            return { ok: false, reason: 'unknown', message: 'The browser did not answer the permission request.' };
        }
        if (answer === 'denied') return { ok: false, reason: 'denied', message: describeDenied(environment) };
        if (answer !== 'granted') {
            return {
                ok: false,
                reason: 'dismissed',
                message: 'The permission request was closed without an answer. Nothing changed. You can ask again.',
            };
        }
    }

    // --- worker ----------------------------------------------------------------------------
    const registration = await ensureServiceWorker();
    if (!registration || !registration.pushManager) {
        return {
            ok: false,
            reason: 'sw-failed',
            message:
                'The background worker that receives notifications could not start. Reload the page and try again; if it keeps failing, notifications cannot work in this browser.',
        };
    }

    // --- subscribe -------------------------------------------------------------------------
    let subscription: PushSubscription | null = null;
    try {
        subscription = await registration.pushManager.getSubscription();
        // A subscription minted with a different VAPID key cannot be re-pointed: `subscribe()`
        // throws InvalidStateError rather than changing the application server key. Drop it.
        if (subscription && !sameBytes(subscription.options?.applicationServerKey ?? null, key.bytes)) {
            await subscription.unsubscribe().catch(() => false);
            subscription = null;
        }
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: key.bytes,
            });
        }
    } catch (e) {
        const name = (e as { name?: string }).name || '';
        return {
            ok: false,
            reason: 'subscribe-failed',
            message:
                name === 'NotAllowedError'
                    ? 'The browser blocked the subscription even though notifications are allowed. Check that notifications are not blocked for this site at the system level.'
                    : 'The browser could not create a push subscription. This usually means the push service is unreachable, or that this build was deployed with an invalid VAPID key.',
        };
    }

    const keys = describeSubscription(subscription);
    if (!keys) {
        return {
            ok: false,
            reason: 'subscribe-failed',
            message: 'The browser produced a subscription without encryption keys, which cannot be used.',
        };
    }

    // The worker needs both of these to survive a `pushsubscriptionchange` on its own.
    await kvSet('appServerKey', key.raw);
    await kvSet('endpoint', keys.endpoint);

    // --- tell the server -------------------------------------------------------------------
    let failure = await registerOnServer(keys, key.raw);

    // 0009 §3.1 refuses an endpoint that belongs to another account and names the cure in the error:
    // unsubscribe, subscribe, register the new endpoint. Do it once, unprompted — this happens when
    // a shared device changes hands, and the user cannot be expected to understand it.
    if (failure && failure.ok === false && failure.reason === 'server-rejected') {
        try {
            await subscription.unsubscribe();
            const fresh = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: key.bytes,
            });
            const freshKeys = describeSubscription(fresh);
            if (freshKeys) {
                await kvSet('endpoint', freshKeys.endpoint);
                failure = await registerOnServer(freshKeys, key.raw);
            }
        } catch {
            /* keep the original refusal */
        }
    }

    if (failure) return failure;
    return { ok: true, state: await readSubscriptionState() };
}

/** Safari shipped the callback form long before the promise form; accept either. */
function requestPermission(): Promise<NotificationPermission> {
    return new Promise((resolve, reject) => {
        try {
            const maybe = Notification.requestPermission((result) => resolve(result));
            if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
        } catch (e) {
            reject(e);
        }
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Disable
 * ------------------------------------------------------------------------------------------ */

/**
 * Forget this device: drop the browser's subscription and DELETE the row.
 *
 * The order is deliberate. The server is told first, because a subscription that is gone locally but
 * still on the server keeps receiving pushes that land nowhere and slowly rots into a 410. If the
 * RPC fails we still unsubscribe locally — the user asked to stop being notified, and the endpoint
 * they no longer hold will be tombstoned by the sender's first 404/410.
 */
export async function disablePush(): Promise<PushResult> {
    const registration = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration(serviceWorkerScope()).catch(() => null)
        : null;
    const subscription = registration?.pushManager ? await registration.pushManager.getSubscription().catch(() => null) : null;

    let note: string | undefined;
    if (subscription) {
        const client = await getSupabaseClient();
        if (client) {
            const { error } = await client.rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint });
            if (error) {
                note =
                    'This device will stop showing notifications, but the server could not be told right now. It drops the device automatically the first time a notification cannot be delivered.';
            }
        }
        try {
            await subscription.unsubscribe();
        } catch {
            return {
                ok: false,
                reason: 'unknown',
                message: 'The browser refused to drop the subscription. Reload the page and try again.',
            };
        }
    }

    await kvSet('registeredEndpoint', null);
    await kvSet('endpoint', null);
    return { ok: true, state: await readSubscriptionState(), note };
}

/* ------------------------------------------------------------------------------------------ *
 * Boot-time reconciliation
 * ------------------------------------------------------------------------------------------ */

/**
 * Called once per app boot for a signed-in user who already granted permission. Three jobs:
 *
 *  1. RE-REGISTER the live subscription. 0009 §3.1 is idempotent by endpoint precisely so this is
 *     safe to do every time, and it is what resurrects a row that was tombstoned by a transient
 *     410, or that never landed because the network was down when the user pressed the button.
 *  2. DRAIN THE WORKER'S HANDOFF. `pushsubscriptionchange` fires in a context with no session, so
 *     the worker re-subscribes and leaves a record instead of calling the RPC (it cannot: the RPC
 *     needs `auth.uid()`). Here we delete the dead endpoint's row so the sender stops posting to it.
 *  3. HEAL A VAPID ROTATION. A subscription minted with an older application server key can never
 *     receive again, and `subscribe()` will not re-point it — so it is replaced. Permission is
 *     already granted, so this is silent.
 */
export async function syncPushSubscription(): Promise<PushSubscriptionState> {
    const environment = readPushEnvironment();
    if (environment.blocker || environment.permission !== 'granted') {
        return { ...EMPTY_STATE, permission: environment.permission };
    }
    if (getAuthSnapshot().status !== 'signed-in') {
        return { ...EMPTY_STATE, permission: environment.permission };
    }
    const key = readVapidKey();
    if (!key) return { ...EMPTY_STATE, permission: environment.permission };

    const registration = await ensureServiceWorker();
    if (!registration || !registration.pushManager) return { ...EMPTY_STATE, permission: environment.permission };

    let subscription = await registration.pushManager.getSubscription().catch(() => null);

    if (subscription && !sameBytes(subscription.options?.applicationServerKey ?? null, key.bytes)) {
        const dead = subscription.endpoint;
        try {
            await subscription.unsubscribe();
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: key.bytes,
            });
            await forgetOnServer(dead);
        } catch {
            /* leave the mismatch visible in the state rather than pretending it is fixed */
        }
    }

    if (subscription) {
        const keys = describeSubscription(subscription);
        if (keys) {
            await kvSet('appServerKey', key.raw);
            await kvSet('endpoint', keys.endpoint);
            await registerOnServer(keys, key.raw);
        }
    }

    // --- the worker's mailbox ---------------------------------------------------------------
    const handoff = (await kvGet<HandoffRecord[]>('handoff')) || [];
    if (Array.isArray(handoff) && handoff.length > 0) {
        const live = subscription ? subscription.endpoint : null;
        for (const record of handoff) {
            if (record && record.oldEndpoint && record.oldEndpoint !== live) {
                await forgetOnServer(record.oldEndpoint);
            }
        }
        await kvSet('handoff', []);
    }

    return readSubscriptionState();
}

async function forgetOnServer(endpoint: string): Promise<void> {
    const client = await getSupabaseClient();
    if (!client) return;
    // Deliberately unchecked: this is best-effort cleanup of a row that is already undeliverable.
    // Failing here must not stop the rest of the reconciliation.
    await client.rpc('unregister_push_subscription', { p_endpoint: endpoint }).then(
        () => undefined,
        () => undefined,
    );
}

/* ------------------------------------------------------------------------------------------ *
 * The end-to-end check
 * ------------------------------------------------------------------------------------------ */

/**
 * `send_test_notification()` — 0009 §3.3. It only ENQUEUES: five hand-installed pieces sit between
 * the row and the phone (the cron job, the Edge Function, the VAPID secrets, the push service, this
 * worker), so a success here means "the server accepted it", never "your phone will buzz". The copy
 * in `PushPanel` says exactly that.
 */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
    const client = await getSupabaseClient();
    if (!client) return { ok: false, message: 'This build has no backend configured.' };

    const { error } = await client.rpc('send_test_notification', {});
    if (!error) {
        return {
            ok: true,
            message: 'Queued. It should arrive within a minute. If it never does, the server side of the pipeline is not running yet.',
        };
    }
    const code = (error as RpcError).code || '';
    const raw = ((error as RpcError).message || '').toLowerCase();
    if (code === '54000' || raw.includes('one test notification a minute')) {
        return { ok: false, message: 'One test a minute. Try again shortly.' };
    }
    if (raw.includes('no live push device')) {
        return { ok: false, message: 'This account has no registered device. Turn notifications off and on again.' };
    }
    return { ok: false, message: (error as RpcError).message || 'The server refused the test notification.' };
}

/* ------------------------------------------------------------------------------------------ *
 * Copy for the refusal paths
 * ------------------------------------------------------------------------------------------ */

export function describeBlocker(blocker: PushBlocker, environment: PushEnvironment): string {
    switch (blocker) {
        case 'no-backend':
            return 'This build has no backend configured, so there are no accounts and nothing to notify.';
        case 'insecure-context':
            return 'Notifications need a secure connection (https). This page is not on one, so the browser will not allow them.';
        case 'ios-not-installed':
            return 'On iPhone and iPad, notifications only work once the site is added to the Home Screen.';
        case 'no-vapid-key':
            return 'This build was deployed without a notification signing key, so it cannot subscribe anybody. Nothing you can fix from here. It is a deployment setting.';
        case 'unsupported':
        default:
            return environment.applePlatform
                ? 'This iPhone or iPad is on a version of iOS older than 16.4, which cannot receive web notifications at all.'
                : 'This browser cannot receive web notifications. Chrome, Edge, Firefox and Safari 16.4 or later can.';
    }
}

export function describeDenied(environment: PushEnvironment): string {
    if (environment.applePlatform) {
        return 'You chose not to allow notifications. iOS does not ask twice: the only way to be asked again is to delete this app from the Home Screen and add it back. Which also erases every profile stored in it, so export anything you want to keep first.';
    }
    return 'Notifications are blocked for this site. Your browser will not ask again. Allow them in the site settings (the icon at the left of the address bar) and then come back.';
}
