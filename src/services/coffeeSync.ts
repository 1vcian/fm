/**
 * The coffee buttons' hiding game on every device of a signed-in user: the hide attempts and
 * where each button rests, kept in the account's own auth metadata (`user_metadata.coffee`,
 * written with `auth.updateUser`), so no table, column or migration is needed. Signed out,
 * everything stays in this browser's localStorage exactly as before.
 *
 * Merge: the attempts only grow, so the higher count wins; a position wins when it was saved
 * later (each one carries the time it was saved). This browser's values are read and written by
 * useTeasingDrag; here they are only mirrored.
 */
import { subscribeAuth } from '../context/AuthContext';
import { peekSupabaseClient } from './supabaseClient';

export const ATTEMPTS_KEY = 'fm_coffee_hide_attempts';
/** Every button position the game stores (the desktop pill and the phone button). */
const POSITION_KEYS = ['fm_coffee_pill_pos', 'fm_coffee_button_pos'] as const;
/** When this browser last saved each position (ms), to merge with the account's. */
const STAMPS_KEY = 'fm_coffee_pos_saved_at';
const META_KEY = 'coffee';
/** Drops come in bursts: one write for a burst. */
const PUSH_DELAY_MS = 3000;

/** Fired on window after the account's values were merged into this browser. */
export const COFFEE_SYNC_EVENT = 'fm:coffee-sync';

interface SavedPos { x: number; y: number; t: number }
interface CoffeeMeta { attempts: number; pos: Record<string, SavedPos> }

function readJson<T>(key: string, fallback: T): T {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? 'null');
        return v ?? fallback;
    } catch { return fallback; }
}
function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

function readLocal(): CoffeeMeta {
    const attempts = Math.max(0, Math.floor(Number(readJson<number>(ATTEMPTS_KEY, 0)) || 0));
    const stamps = readJson<Record<string, number>>(STAMPS_KEY, {});
    const pos: Record<string, SavedPos> = {};
    for (const key of POSITION_KEYS) {
        const p = readJson<{ x?: number; y?: number } | null>(key, null);
        if (p && typeof p.x === 'number' && typeof p.y === 'number') pos[key] = { x: p.x, y: p.y, t: stamps[key] ?? 0 };
    }
    return { attempts, pos };
}

function parseMeta(raw: unknown): CoffeeMeta | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<CoffeeMeta>;
    const pos: Record<string, SavedPos> = {};
    for (const key of POSITION_KEYS) {
        const p = r.pos?.[key];
        if (p && [p.x, p.y, p.t].every(v => typeof v === 'number' && isFinite(v))) pos[key] = { x: p.x, y: p.y, t: p.t };
    }
    return { attempts: Math.max(0, Math.floor(Number(r.attempts) || 0)), pos };
}

/** Both sides merged: the higher attempt count, and per button the later saved position. */
function merge(a: CoffeeMeta, b: CoffeeMeta): CoffeeMeta {
    const pos: Record<string, SavedPos> = { ...a.pos };
    for (const [key, p] of Object.entries(b.pos)) if (!pos[key] || p.t > pos[key].t) pos[key] = p;
    return { attempts: Math.max(a.attempts, b.attempts), pos };
}

const sameMeta = (a: CoffeeMeta, b: CoffeeMeta) => JSON.stringify(a) === JSON.stringify(b);

let lastAccount: CoffeeMeta | null = null;
let pushTimer: number | null = null;

async function signedInClient() {
    const client = peekSupabaseClient();
    if (!client) return null;
    try {
        const { data } = await client.auth.getSession();
        return data.session ? client : null;
    } catch { return null; }
}

async function push() {
    pushTimer = null;
    const client = await signedInClient();
    if (!client) return;
    const local = readLocal();
    const next = lastAccount ? merge(lastAccount, local) : local;
    if (lastAccount && sameMeta(next, lastAccount)) return;
    try {
        const { error } = await client.auth.updateUser({ data: { [META_KEY]: next } });
        if (!error) lastAccount = next;
    } catch { /* offline: the next save tries again */ }
}

/** Called after this browser saved attempts or a position: mirrors them to the account soon. */
export function coffeeChanged(positionKey?: string) {
    if (positionKey) write(STAMPS_KEY, JSON.stringify({ ...readJson<Record<string, number>>(STAMPS_KEY, {}), [positionKey]: Date.now() }));
    if (pushTimer !== null) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void push(), PUSH_DELAY_MS);
}

/** On sign-in: the account's values merged into this browser, and this browser's into the account. */
async function pull() {
    const client = await signedInClient();
    if (!client) { lastAccount = null; return; }
    let account: CoffeeMeta | null = null;
    try {
        // From the server, not the token: another device may have written since it was issued.
        const { data } = await client.auth.getUser();
        account = parseMeta(data.user?.user_metadata?.[META_KEY]);
    } catch { return; }
    const local = readLocal();
    const merged = account ? merge(account, local) : local;
    lastAccount = account ?? { attempts: 0, pos: {} };
    if (!sameMeta(merged, local)) {
        write(ATTEMPTS_KEY, String(merged.attempts));
        const stamps = readJson<Record<string, number>>(STAMPS_KEY, {});
        for (const [key, p] of Object.entries(merged.pos)) {
            write(key, JSON.stringify({ x: p.x, y: p.y }));
            stamps[key] = p.t;
        }
        write(STAMPS_KEY, JSON.stringify(stamps));
        window.dispatchEvent(new Event(COFFEE_SYNC_EVENT));
    }
    if (!account || !sameMeta(merged, account)) void push();
}

let started = false;
let lastUser: string | null | undefined;

/** Starts following sign-in and sign-out (once; cheap while signed out: no client is loaded). */
export function startCoffeeSync() {
    if (started) return;
    started = true;
    const check = () => {
        // The store notifies on any change; only a different account means a new pull.
        const client = peekSupabaseClient();
        if (!client) { lastUser = null; return; }
        void client.auth.getSession().then(({ data }) => {
            const user = data.session?.user.id ?? null;
            if (user === lastUser) return;
            lastUser = user;
            if (user) void pull(); else lastAccount = null;
        }).catch(() => { /* storage blocked: stays local */ });
    };
    subscribeAuth(check);
    // The session may have settled before the first button mounted.
    check();
}
