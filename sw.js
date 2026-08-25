/* eslint-disable no-undef */
/**
 * sw.js — the service worker. PUSH ONLY. It does not cache, and it must never start.
 * ==================================================================================
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `PushManager` is only reachable from a *registered* service worker, on every platform — not
 * just iOS. So a worker is a hard prerequisite for web push even though this app wants nothing
 * else a worker can do. That is the whole brief: be the smallest thing that can receive a push
 * and show it, and be invisible the rest of the time.
 *
 * WHY IT LIVES IN `public/` AS PLAIN JS, AND NOT IN `src/`
 * -------------------------------------------------------
 * A worker's default scope is the DIRECTORY ITS SCRIPT IS SERVED FROM. This site is deployed
 * under `/fm/` on GitHub Pages, where we control no response headers, so `Service-Worker-Allowed`
 * is not available to widen a scope — placement is the only lever. `public/` is copied verbatim
 * to the deploy root, which *is* `/fm/`, so this file is served at `/fm/sw.js` and its scope is
 * `/fm/` for free.
 *
 * Putting it in `src/` would hand it to Rollup, and `vite.config.ts` renames every emitted chunk
 * to `assets/[name].[hash].js`. That would (a) move the script to `/fm/assets/`, capping its scope
 * at `/fm/assets/` — i.e. it could never control the app — and (b) change its URL on every build.
 * There is nothing to bundle here anyway: no imports, no TypeScript, no npm.
 *
 * THERE IS NO `fetch` LISTENER, DELIBERATELY
 * ------------------------------------------
 * This app fetches `public/parsed_configs/**` — 23 game-data versions plus sprite atlases — and
 * every calculator's output is a pure function of those files. A cache that served a stale config
 * would not break the site; it would make it QUIETLY WRONG, which is worse. Nobody asked for
 * offline support, so there is no upside to weigh against that.
 *
 * A pass-through `fetch` handler (`event.respondWith(fetch(event.request))`) is not a safe middle
 * ground either: it routes every request in the app through the worker thread, adds a hop, and
 * invents a new way for the site to fail (a worker that dies takes the requests with it). Adding
 * NO handler is strictly better than adding a transparent one — a registration with no fetch
 * listener is skipped entirely for navigations ("no-fetch-handler" optimisation), so with this
 * worker installed the app loads over exactly the same path it does today.
 *
 * If caching is ever added here, `parsed_configs/` and `Texture2D/` must be excluded explicitly
 * and the exclusion must be tested, not asserted.
 *
 * WHAT IT DOES HANDLE
 * -------------------
 *   push                     show the notification (never silently — see userVisibleOnly below)
 *   notificationclick        focus an existing window and route it, or open one
 *   pushsubscriptionchange   re-subscribe, and leave a handoff record for the page to report
 *
 * userVisibleOnly IS A PROMISE WITH TEETH. WebKit revokes a subscription that receives a push and
 * displays nothing ("Violations of the userVisibleOnly promise will result in a push subscription
 * being revoked"). So every path through `onPush` ends in a `showNotification`, including the
 * paths where the payload is missing, unparseable or titleless. Showing something slightly wrong
 * costs a moment's confusion; showing nothing costs the subscriber.
 *
 * TITLE AND BODY ARE UNTRUSTED TEXT. A clan broadcast is written by a clan leader and delivered to
 * up to 50 other people's devices. `showNotification(title, { body })` takes strings and renders
 * them as text — the Notification API never parses markup — and nothing here builds HTML or
 * touches a DOM, so there is no injection sink to guard. The one thing that IS author-controlled
 * and dangerous is the destination, and `safeTarget()` below refuses to leave this origin.
 */

const SW_VERSION = 'fm-push-1';

/* ------------------------------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------------------------------ */

// Take over immediately. With no `fetch` listener there is no page/worker version skew to fear —
// the classic reason to let a new worker wait does not apply — and `pushManager.subscribe()` needs
// an ACTIVE worker, so waiting would mean the first visit cannot subscribe until a reload.
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------------------------------------------ *
 * A two-key IndexedDB, because a worker cannot read localStorage
 * ------------------------------------------------------------------------------------------ *
 *   appServerKey  the base64url VAPID public key this device subscribed with. `subscribe()`
 *                 REFUSES to change application server key, so re-subscribing after a
 *                 `pushsubscriptionchange` has to use the same one — and the worker has no other
 *                 way to learn it (no import.meta.env, no localStorage).
 *   endpoint      the endpoint we last told the server about, so a change event that arrives
 *                 without `oldSubscription` (Chrome fires a bare event) can still name the dead
 *                 endpoint for the page to unregister.
 *   handoff       change records the page drains on its next boot. See onSubscriptionChange().
 */

const DB_NAME = 'fm-push';
const STORE = 'kv';

function openDb() {
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

async function kvGet(key) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result ? req.result.v : null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

async function kvSet(key, value) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ k: key, v: value });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------------ */

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function base64UrlFromBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** `{ endpoint, p256dh, auth, ... }` from a PushSubscription, or null. */
function describeSubscription(subscription) {
    if (!subscription) return null;
    try {
        const p256dh = subscription.getKey ? subscription.getKey('p256dh') : null;
        const auth = subscription.getKey ? subscription.getKey('auth') : null;
        if (!p256dh || !auth) return null;
        return {
            endpoint: subscription.endpoint,
            p256dh: base64UrlFromBuffer(p256dh),
            auth: base64UrlFromBuffer(auth),
        };
    } catch {
        return null;
    }
}

/** An absolute URL inside this registration's scope. Used for the notification icon. */
function scoped(relative) {
    return new URL(relative, self.registration.scope).href;
}

/**
 * WHERE A NOTIFICATION IS ALLOWED TO SEND THE USER.
 *
 * 0009's `assert_push_payload()` already pins `notification.navigate` to
 * `https://1vcian.me/fm/…` server-side, so a clan leader cannot aim a broadcast at their own site.
 * This is the second lock, and it also solves a practical problem: a build served from anywhere
 * ELSE — a local `vite preview`, a fork's Pages site — receives payloads carrying the canonical
 * production URL, and following it literally would walk out of the app.
 *
 * Every route in this app lives in the fragment (`HashRouter`), so a foreign-origin target is
 * honoured by keeping its fragment and dropping it on THIS origin's scope root. Anything we cannot
 * make sense of falls back to the scope root itself, which is always a valid page.
 */
function safeTarget(raw) {
    const scope = new URL(self.registration.scope);
    const candidate = text(raw);
    if (!candidate) return scope.href;
    let url;
    try {
        url = new URL(candidate, scope);
    } catch {
        return scope.href;
    }
    if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) return url.href;
    return new URL(url.hash || '', scope).href;
}

/* ------------------------------------------------------------------------------------------ *
 * push
 * ------------------------------------------------------------------------------------------ */

/**
 * The Declarative Web Push shape 0009 sends:
 *
 *   {"web_push": 8030,
 *    "notification": {"title": "…", "body": "…", "navigate": "https://1vcian.me/fm/#/…"}}
 *
 * Chrome and Firefox ignore `web_push` and hand the bytes to this handler. iOS/iPadOS 18.4+ and
 * macOS 15.5+ can render that payload WITHOUT running a service worker, which removes the worst
 * iOS failure mode — but whether they then also dispatch `push` here is not something to guess at,
 * and getting it wrong means two identical notifications. So for a declarative payload only, and
 * before showing anything, this checks the tray for a notification with the same title and body
 * and stands down if the platform already showed it. Behaviour, not spec archaeology.
 */
async function onPush(event) {
    let payload = null;
    if (event.data) {
        try {
            const parsed = event.data.json();
            if (parsed && typeof parsed === 'object') payload = parsed;
        } catch {
            /* not JSON — fall through to text() */
        }
        if (!payload) {
            try {
                const body = text(event.data.text());
                if (body) payload = { notification: { title: 'Forge Master', body } };
            } catch {
                /* nothing readable at all */
            }
        }
    }

    const notification = (payload && typeof payload.notification === 'object' && payload.notification) || {};
    // A title is mandatory: an empty one is a notification that displays nothing, which is how a
    // subscription gets revoked. 0009 enforces it server-side too; this is the client half.
    const title = text(notification.title) || 'Forge Master';
    const body = text(notification.body);
    const tag = text(notification.tag);

    if (payload && payload.web_push) {
        try {
            const shown = await self.registration.getNotifications();
            if (shown.some((n) => n.title === title && text(n.body) === body)) return;
        } catch {
            /* if the tray cannot be read, showing is the safer error */
        }
    }

    const options = {
        body,
        icon: scoped('icons/icon-192.png'),
        badge: scoped('icons/icon-192.png'),
        // Sit in the tray until acted on: a planner alarm two minutes before something finishes is
        // useless if it auto-dismisses while the phone is in a pocket.
        requireInteraction: false,
        data: { navigate: safeTarget(notification.navigate), version: SW_VERSION },
    };
    // Only set `tag` when the sender chose one. Inventing a tag would make two distinct alarms
    // replace each other.
    if (tag) options.tag = tag;

    try {
        await self.registration.showNotification(title, options);
    } catch {
        // Last resort. Something must be displayed, so try again with nothing that can fail.
        await self.registration.showNotification(title, { body });
    }
}

self.addEventListener('push', (event) => {
    event.waitUntil(onPush(event));
});

/* ------------------------------------------------------------------------------------------ *
 * notificationclick
 * ------------------------------------------------------------------------------------------ */

/**
 * Focus a window that is already on this app and route it; open one only if there is none.
 * Opening unconditionally is the common bug — it leaves the user with two copies of a
 * single-page app, each with its own profile state in memory.
 */
async function onNotificationClick(notification) {
    const target = safeTarget(notification && notification.data ? notification.data.navigate : null);
    const scope = self.registration.scope;

    let clientList = [];
    try {
        clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    } catch {
        clientList = [];
    }
    const mine = clientList.filter((c) => typeof c.url === 'string' && c.url.startsWith(scope));
    const client = mine.find((c) => c.focused) || mine[0] || null;

    if (client) {
        try {
            await client.focus();
        } catch {
            /* focus can be refused; carry on and still try to route */
        }
        try {
            // `navigate()` is refused for a client this worker does not control (InvalidStateError).
            await client.navigate(target);
            return;
        } catch {
            /* fall through to the message bridge */
        }
        try {
            // `pushClient.ts` listens for this and applies the fragment itself. Cheap insurance for
            // the uncontrolled-client case above.
            client.postMessage({ type: 'fm-push-navigate', url: target });
        } catch {
            /* the window is focused, which is most of what the user asked for */
        }
        return;
    }

    try {
        await self.clients.openWindow(target);
    } catch {
        /* the browser refused to open a window; nothing further to try */
    }
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(onNotificationClick(event.notification));
});

/* ------------------------------------------------------------------------------------------ *
 * pushsubscriptionchange
 * ------------------------------------------------------------------------------------------ */

/**
 * The browser replaced (or dropped) the subscription behind our back. Left alone, pushes stop
 * arriving and NOTHING tells anybody: the server keeps posting to the dead endpoint until a 404/410
 * tombstones it, and the user just stops getting notifications.
 *
 * WHY THIS DOES NOT CALL THE SERVER ITSELF, WHICH IS THE HONEST LIMITATION.
 * `register_push_subscription()` is `security definer` and starts with `auth.uid()`, so it needs
 * the USER's JWT. A service worker cannot get one: it has no access to localStorage, which is where
 * supabase-js keeps the session, and the anon key alone authenticates as `anon`, for which the RPC
 * raises 42501. The alternative would be copying an access or refresh token into IndexedDB where
 * this worker could read it — handing a long-lived credential to a context that outlives every tab,
 * to save one round trip. Not worth it.
 *
 * So the worker does the half only it can do — re-subscribe now, so pushes resume immediately —
 * and records the change for the page to report on its next boot. That is not a workaround grafted
 * on: 0009 §3.1 makes `register_push_subscription()` idempotent by endpoint precisely so the client
 * can call it on EVERY boot, and calls that "the real safety net for a subscription lost outside
 * our control". `syncPushSubscription()` in `pushClient.ts` drains the handoff and unregisters the
 * dead endpoint.
 */
async function onSubscriptionChange(event) {
    const storedKey = await kvGet('appServerKey');
    const knownEndpoint = await kvGet('endpoint');

    // `oldSubscription` / `newSubscription` are in the spec but not everywhere in practice —
    // Chrome dispatches a bare event — so both are treated as hints, not as the source of truth.
    const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || knownEndpoint || null;

    let subscription = event.newSubscription || null;
    if (!subscription) {
        try {
            subscription = await self.registration.pushManager.getSubscription();
        } catch {
            subscription = null;
        }
    }
    if (!subscription && storedKey) {
        try {
            // Permission is already granted, so this needs no user gesture. It must use the SAME
            // application server key: `subscribe()` throws InvalidStateError on a different one.
            subscription = await self.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: bytesFromBase64Url(storedKey),
            });
        } catch {
            subscription = null;
        }
    }

    const described = describeSubscription(subscription);
    if (!described) {
        // Could not get a live subscription back. Still record the death, so the page can at least
        // delete the row that is no longer deliverable and tell the user this device went quiet.
        if (oldEndpoint) await appendHandoff({ oldEndpoint, endpoint: null, at: Date.now() });
        return;
    }

    await kvSet('endpoint', described.endpoint);
    await appendHandoff({
        oldEndpoint: oldEndpoint && oldEndpoint !== described.endpoint ? oldEndpoint : null,
        endpoint: described.endpoint,
        p256dh: described.p256dh,
        auth: described.auth,
        vapidPublicKey: storedKey || null,
        at: Date.now(),
    });
}

/** Newest last, capped — this is a mailbox for the next boot, not a log. */
async function appendHandoff(record) {
    const existing = (await kvGet('handoff')) || [];
    const list = Array.isArray(existing) ? existing : [];
    list.push(record);
    await kvSet('handoff', list.slice(-5));
}

self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(onSubscriptionChange(event));
});
