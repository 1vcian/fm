/**
 * supabaseClient — lazily-created, optional backend client.
 * ========================================================
 *
 * The app is a static site on GitHub Pages and must keep working with **no backend configured at
 * all** (`docs/BACKEND_PLAN.md` §7: "app still works logged out"). So this module's contract is
 * deliberately blunt:
 *
 *   getSupabaseClient()  ->  null   when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing
 *                        ->  null   when client creation throws for any reason
 *                        ->  client otherwise
 *
 * Every caller must treat `null` as "run local-only", never as an error. Nothing here runs at
 * import time: no client is created until someone actually asks for one, so a page load with no
 * configuration does exactly zero extra work — no network, no storage access, no timers.
 *
 * WHY PKCE (and not the implicit flow)
 * ------------------------------------
 * With the implicit flow Supabase returns the session in the URL **fragment**
 * (`#access_token=`). This app already uses the fragment for two things: the HashRouter route
 * and the share-link payload (`#/?p=`, see `src/utils/shareCodec.ts`). Putting auth tokens there
 * makes the fragment ambiguous — and `ProfileContext` snapshots it at module load, before
 * supabase-js exists. PKCE instead returns `?code=` in the **query**, which collides with
 * nothing. `src/services/authUrl.ts` lifts that code out of the URL at the earliest possible
 * moment and `AuthContext` redeems it explicitly.
 *
 * CODE SPLITTING
 * --------------
 * `@supabase/supabase-js` is ~220 KB raw / ~57 KB gzip. A build with no backend configured must
 * not pay for it, so the package is reached through a dynamic `import()` that is only executed
 * *after* the env check passes. Vite emits it as a separate chunk, which means:
 *
 *   no `VITE_SUPABASE_*`  ->  the chunk is never requested. Zero extra bytes over the previous
 *                             build, which is the literal requirement for the local-only mode.
 *   configured            ->  one extra request, the first time anything asks for a client.
 *
 * The consequence for callers is that obtaining a client is asynchronous. Everything that needs
 * one (auth actions, the remote store) is already async, so this costs nothing.
 *
 * SECRETS
 * -------
 * Only the **anon / publishable** key ever appears here. It is public by design: it identifies
 * the project and carries no privileges of its own — every permission decision is a Row Level
 * Security policy in Postgres. The `service_role` key must never be added to `.env`, the bundle
 * or CI.
 */

// TYPE-ONLY import: erased at compile time, so it adds nothing to the bundle. The package
// itself is pulled in by the dynamic `import()` in `loadClient()` below — see "CODE SPLITTING".
import type { SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------------------------------ *
 * Env
 * ------------------------------------------------------------------------------------------ */

declare global {
    interface ImportMetaEnv {
        /** e.g. `https://xxxxxxxxxxxx.supabase.co` — absent means "no backend". */
        readonly VITE_SUPABASE_URL?: string;
        /** Public anon key. RLS, not this key, is the security boundary. */
        readonly VITE_SUPABASE_ANON_KEY?: string;
    }
}

export interface SupabaseConfig {
    url: string;
    anonKey: string;
}

/** Trim and treat empty strings / literal `undefined` as absent (CI often injects those). */
function readEnv(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;
    return trimmed;
}

/**
 * The configured project, or `null`. Pure, cheap, and safe to call on every render.
 * Exposed separately from the client so the UI can say "sign in" vs. "local only" without
 * creating a client.
 */
export function getSupabaseConfig(): SupabaseConfig | null {
    // `import.meta.env` is statically replaced by Vite at build time; the optional chain keeps
    // this callable from a plain node/test context where it is undefined.
    const env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) as
        | Partial<ImportMetaEnv>
        | undefined;

    const url = readEnv(env?.VITE_SUPABASE_URL);
    const anonKey = readEnv(env?.VITE_SUPABASE_ANON_KEY);
    if (!url || !anonKey) return null;
    return { url, anonKey };
}

/** True when both env vars are present. Does not imply the backend is reachable. */
export function isBackendConfigured(): boolean {
    return getSupabaseConfig() !== null;
}

/* ------------------------------------------------------------------------------------------ *
 * Types re-exported for callers that must not import the package directly
 * ------------------------------------------------------------------------------------------ */

/** The real client type. `profileStore` imports it as a *type only* — no runtime coupling. */
export type { SupabaseClient };

/** What the app needs to know about a signed-in user. */
export interface AuthUserLike {
    id: string;
    email: string | null;
}

/* ------------------------------------------------------------------------------------------ *
 * "Is anybody signed in?" without loading the client
 * ------------------------------------------------------------------------------------------ */

/**
 * True when this browser holds a persisted supabase-js session.
 *
 * WHY GUESS INSTEAD OF ASKING THE CLIENT
 * -------------------------------------
 * `auth.getSession()` is the authoritative answer, but getting it means loading the 58 KB (gzip)
 * client chunk. The overwhelming majority of visitors to the public site are signed out and will
 * never sign in, and they must not pay for a feature they are not using — so the boot path first
 * asks this cheap question and only loads the client when the answer is "yes" (or when there is a
 * sign-in callback in the URL, or the user actually presses the button).
 *
 * The key is matched by *shape* (`sb-<projectRef>-auth-token`) rather than by deriving the project
 * ref from the URL, so a change in how supabase-js names its storage key cannot make a signed-in
 * user look signed out. A false positive costs one unnecessary chunk load; a false negative would
 * be a bug, which is why the check errs toward `true` whenever storage cannot be read.
 */
export function hasPersistedSession(): boolean {
    try {
        if (typeof localStorage === 'undefined') return false;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && /^sb-.+-auth-token$/.test(key)) return true;
        }
        return false;
    } catch {
        // Storage blocked: we cannot know, so do not claim "signed out".
        return true;
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Lazy singleton
 * ------------------------------------------------------------------------------------------ */

let client: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;

async function loadClient(): Promise<SupabaseClient | null> {
    const config = getSupabaseConfig();
    // The env check comes FIRST so an unconfigured build never even requests the chunk.
    if (!config) return null;

    try {
        const { createClient } = await import('@supabase/supabase-js');
        client = createClient(config.url, config.anonKey, {
            auth: {
                // PKCE: the callback carries `?code=` in the query, never a token in the
                // fragment where the share payload lives. See the file header.
                flowType: 'pkce',
                // Magic-link sessions must survive a reload, and the client refreshes the
                // access token on its own while the tab is open.
                persistSession: true,
                autoRefreshToken: true,
                // Belt and braces. `authUrl.ts` has already lifted the parameters out of the URL
                // by the time any client exists, so in practice `AuthContext` does the redeeming;
                // leaving this on only matters if a client is ever created before that strip.
                detectSessionInUrl: true,
            },
            global: {
                headers: { 'x-application-name': 'forgemaster' },
            },
        });
        return client;
    } catch {
        // Chunk failed to load, or creation threw. Memoised as `null` so a broken configuration
        // degrades to local-only instead of retrying on every call.
        return null;
    }
}

/**
 * The Supabase client, or `null` when there is nothing to talk to.
 *
 * Resolved at most once per page (repeat calls share one promise), so calling it from a render
 * path is safe. Never throws — `null` always means "run local-only".
 */
export function getSupabaseClient(): Promise<SupabaseClient | null> {
    if (!clientPromise) clientPromise = loadClient();
    return clientPromise;
}

/**
 * The client *if it has already been created*, without triggering the chunk load. For code that
 * wants to use a client opportunistically but must not force the dependency to load.
 */
export function peekSupabaseClient(): SupabaseClient | null {
    return client;
}

/** Drop the memoised client (tests, switching projects). */
export function resetSupabaseClient(): void {
    client = null;
    clientPromise = null;
}

/** Provider shape `RemoteProfileStore` expects. */
export const supabaseClientProvider: () => Promise<SupabaseClient | null> = getSupabaseClient;
