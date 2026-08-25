/**
 * ClanBrowser — the list of clans a player can look through, and the door to joining one.
 * =====================================================================================
 *
 * WHAT THE SERVER ALLOWS, AND THEREFORE WHAT THIS RENDERS
 * -------------------------------------------------------
 * There are exactly two ways to obtain a clan row you are not a member of, and both are capped
 * server-side (migration 0005 §3):
 *
 *   recent_clans(p_limit default 10)   the front page: most recently ACTIVE clans, <= 25 rows,
 *                                      and it takes no offset/cursor **on purpose** — "every clan
 *                                      is discoverable" must not decay into "every clan is
 *                                      enumerable".
 *   search_clans(p_query, p_limit)     server-ranked search over name and tag, also <= 25 rows,
 *                                      and an empty needle returns ZERO rows rather than
 *                                      everything.
 *
 * So there is no "load all", no pagination and no infinite scroll here, and there cannot be: the
 * database has no endpoint for it. Clearing the search box goes back to the cached recent list
 * instead of fetching anything.
 *
 * Both RPCs return rows of the composite type `public.clan_public`, and that type is the whole
 * contract for what a row may display: id, name, tag, join_policy, the four badge columns,
 * member_count, member_cap, activity_at, created_at. There is deliberately no member name, no
 * owner, no roster and no join password in it — a clan's occupancy and liveness are public, its
 * people are not. Nothing below renders a field that is not on that list.
 *
 * WHY THIS FETCHES INSTEAD OF READING `useClan().discovery`
 * -------------------------------------------------------
 * `ClanContext` already exposes a debounced `discovery` slice, and it is the right thing for a
 * surface that only needs the numbers. This component owns its own fetch for one reason: a
 * debounce cancels the *timer*, not the *request*. Once a search has been sent, a faster response
 * to an older needle can still land after a newer one and repaint the list with stale rows. Here
 * every request carries a monotone token and a response whose token is no longer current is
 * dropped, so what is on screen always corresponds to what is in the box. The API module is the
 * shared thing; a second small piece of fetch bookkeeping is cheaper than an ordering bug.
 *
 * SIGNED OUT IS A SENTENCE, NOT AN ERROR
 * --------------------------------------
 * `recent_clans()` and `search_clans()` are granted to `authenticated` only, and both raise
 * `42501 authentication required` when `auth.uid()` is null (0005 §3c/§3d, and §6 revokes EXECUTE
 * from `anon` on top of that). Verified against the migration, not assumed. So a signed-out
 * visitor cannot be shown clans at all, and this renders one honest line inviting them to sign in
 * — not a spinner, not an empty panel, and not a red error.
 *
 * FOUR STATES THAT MUST NEVER LOOK ALIKE
 * -------------------------------------
 * loading / empty / "no results for that query" / failed. A blank panel that might be any of them
 * is the failure mode this component exists to avoid, so each one has its own icon, its own
 * sentence and (where it makes sense) its own action.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    Loader2,
    LogIn,
    RefreshCw,
    Search,
    SearchX,
    Users,
    X,
} from 'lucide-react';
import { ClanBadge } from '../UI/ClanBadge';
import { Button } from '../UI/Button';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useClan } from '../../context/ClanContext';
import {
    CLAN_DISCOVERY_MAX_ROWS,
    badgeOf,
    recentClans,
    searchClans,
    type ClanError,
    type ClanPublic,
    type JoinClanOutcome,
} from '../../services/clanApi';
import { JoinClanDialog } from './JoinClanDialog';

/** Under the "feels instant" bar, and one round trip per word instead of one per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

export interface ClanBrowserProps {
    /**
     * How many rows to ask both RPCs for. The server clamps to 25 whatever this says, so it is a
     * request and not a promise; the default is the migration's own default.
     */
    limit?: number;
    /**
     * Called when the user picks a clan to join. **When it is provided this component does not open
     * a dialog** — the host is taking over the join flow and gets the row. When it is absent the
     * built-in `<JoinClanDialog>` is used, which is what makes the browser usable on its own.
     */
    onPick?: (clan: ClanPublic) => void;
    /**
     * A join through the built-in dialog succeeded (`joined`) or was filed (`requested`). The
     * caller refreshes whatever it owns; this component does not reach into anybody's state.
     */
    onJoined?: (outcome: Extract<JoinClanOutcome, { status: 'joined' | 'requested' }>) => void;
    className?: string;
}

/* ------------------------------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------------------------------ */

/**
 * "active 3 h ago" from `clan_public.activity_at`.
 *
 * `clans.activity_at` is maintained by a trigger with a **five-minute debounce** (0005 §2), so it
 * is an ORDERING and not a clock: anything under ten minutes is reported as "just now" rather than
 * as a precise number the column cannot actually carry. The exact stamp goes in `title` for anyone
 * who wants it.
 */
function activityLabel(iso: string | null | undefined): string {
    const at = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(at)) return 'activity unknown';
    const minutes = Math.floor((Date.now() - at) / 60000);
    if (minutes < 10) return 'active just now';
    if (minutes < 60) return `active ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `active ${hours} h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `active ${days} d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `active ${weeks} wk ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `active ${months} mo ago`;
    return 'active over a year ago';
}

function exactStamp(iso: string | null | undefined): string {
    const at = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(at) ? new Date(at).toLocaleString() : 'unknown';
}

/* ------------------------------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------------------------------ */

interface ClanRowProps {
    clan: ClanPublic;
    /** This is the clan the active profile is already in. */
    mine: boolean;
    onPick: (clan: ClanPublic) => void;
}

const ClanRow: React.FC<ClanRowProps> = ({ clan, mine, onPick }) => {
    // member_cap is per clan and comes down the wire — never the constant 50, because a clan may
    // have been created with a smaller cap.
    const full = clan.member_count >= clan.member_cap;
    // A row is only an action when acting on it can work: your own clan and a full clan are shown
    // as facts, with the reason on the right, instead of as a button that would fail.
    const actionable = !mine && !full;

    const body = (
        <>
            <ClanBadge badge={badgeOf(clan)} size={40} className="shrink-0" />
            <div className="min-w-0 flex-1 text-left">
                <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-bold text-white whitespace-nowrap overflow-hidden text-clip">{clan.name}</span>
                    <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-wider text-accent-primary bg-accent-primary/15 rounded px-1.5 py-0.5">
                        {clan.tag}
                    </span>
                </div>
                {/* Each fact keeps its own separator INSIDE its nowrap span. A separate "·" element
                    ends up orphaned at the end of a line as soon as the row wraps, which is exactly
                    what a 360px viewport does to it. */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <Users className="w-3 h-3" />
                        {clan.member_count}/{clan.member_cap} members
                    </span>
                    <span
                        className="whitespace-nowrap"
                        title={`Last activity: ${exactStamp(clan.activity_at)}`}
                    >
                        <span aria-hidden="true">· </span>
                        {activityLabel(clan.activity_at)}
                    </span>
                    {/* join_policy IS part of clan_public, and it changes what pressing Join does:
                        a `request` clan files a request for a leader to approve instead of seating
                        you. Saying so before the password is typed is the honest order. */}
                    {clan.join_policy === 'request' && (
                        <span className="whitespace-nowrap text-text-secondary">
                            <span aria-hidden="true">· </span>
                            approval needed
                        </span>
                    )}
                </div>
            </div>
            <span
                className={cn(
                    'shrink-0 text-[11px] font-bold uppercase tracking-wider rounded-lg px-2 py-1 border',
                    actionable
                        ? 'text-accent-primary border-accent-primary/40 bg-accent-primary/10'
                        : 'text-text-muted border-border bg-white/5',
                )}
            >
                {mine ? 'your clan' : full ? 'full' : 'join'}
            </span>
        </>
    );

    if (!actionable) {
        return (
            <li className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary/40 p-3">
                {body}
            </li>
        );
    }

    return (
        <li>
            <button
                type="button"
                onClick={() => onPick(clan)}
                className="w-full flex items-center gap-3 rounded-xl border border-border bg-bg-secondary/60 p-3 text-left transition hover:border-accent-primary/50 hover:bg-bg-secondary focus:outline-none focus:ring-2 focus:ring-accent-primary/50 active:scale-[0.995]"
            >
                {body}
            </button>
        </li>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * Shared panels for the non-list states
 * ------------------------------------------------------------------------------------------ */

const Panel: React.FC<{
    icon: React.ReactNode;
    title: string;
    children?: React.ReactNode;
    tone?: 'neutral' | 'warn';
}> = ({ icon, title, children, tone = 'neutral' }) => (
    <div
        className={cn(
            'rounded-xl border border-dashed p-6 text-center',
            tone === 'warn' ? 'border-accent-secondary/40 bg-accent-secondary/5' : 'border-border bg-bg-secondary/30',
        )}
    >
        <div
            className={cn(
                'w-10 h-10 mx-auto rounded-xl flex items-center justify-center mb-3',
                tone === 'warn' ? 'bg-accent-secondary/15 text-accent-secondary' : 'bg-white/5 text-text-secondary',
            )}
        >
            {icon}
        </div>
        <p className="font-bold text-white text-sm">{title}</p>
        {children && <div className="text-xs text-text-secondary mt-1.5 max-w-md mx-auto leading-relaxed">{children}</div>}
    </div>
);

/** Three grey rows. Distinguishable from "empty" at a glance, which is the whole point. */
const Skeleton: React.FC<{ label: string }> = ({ label }) => (
    <div className="space-y-2" aria-live="polite" aria-busy="true">
        <p className="flex items-center gap-2 text-xs text-text-secondary">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-primary" />
            {label}
        </p>
        {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary/30 p-3">
                <div className="w-10 h-10 rounded-lg bg-white/5 animate-pulse shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3 w-28 max-w-[60%] rounded bg-white/10 animate-pulse" />
                    <div className="h-2.5 w-40 max-w-[80%] rounded bg-white/5 animate-pulse" />
                </div>
            </div>
        ))}
    </div>
);

/* ------------------------------------------------------------------------------------------ *
 * The browser
 * ------------------------------------------------------------------------------------------ */

export const ClanBrowser: React.FC<ClanBrowserProps> = ({
    limit = 10,
    onPick,
    onJoined,
    className,
}) => {
    const { status: authStatus, backendConfigured } = useAuth();
    // Only for "is this row my clan?" — everything the browser fetches, it fetches itself.
    const { membership } = useClan();

    const rows = Math.min(Math.max(1, Math.round(limit)), CLAN_DISCOVERY_MAX_ROWS);
    const canBrowse = backendConfigured && authStatus === 'signed-in';

    const [input, setInput] = useState('');
    const [recent, setRecent] = useState<ClanPublic[] | null>(null);
    const [recentLoading, setRecentLoading] = useState(false);
    const [recentError, setRecentError] = useState<ClanError | null>(null);

    /** `null` = no search is being shown (the box is empty). `[]` = searched, nothing matched. */
    const [results, setResults] = useState<ClanPublic[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<ClanError | null>(null);

    const [picked, setPicked] = useState<ClanPublic | null>(null);
    /** Bumped by "Try again" so the search effect re-runs on an unchanged needle. */
    const [retryTick, setRetryTick] = useState(0);

    /**
     * One monotone token for every search request. A response whose token is no longer current is
     * dropped, which is what makes out-of-order results impossible: the token is bumped on every
     * keystroke — including the one that empties the box — so an older, slower response can never
     * repaint the list.
     */
    const searchToken = useRef(0);
    /** Same idea for the recent list, plus an unmount guard. */
    const recentToken = useRef(0);
    /**
     * Unmount guard. It is re-armed in the effect body and not only initialised at declaration,
     * because the app runs in `React.StrictMode`: in development every effect is mounted, cleaned
     * up and mounted again, so a ref that is only ever set to `false` by a cleanup would leave the
     * remounted component permanently convinced it was dead — and no list would ever appear.
     * Declared before the fetching effects so it is armed before they run.
     */
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    const loadRecent = useCallback(() => {
        if (!canBrowse) return;
        const mine = ++recentToken.current;
        setRecentLoading(true);
        void recentClans(rows).then(result => {
            if (!alive.current || mine !== recentToken.current) return;
            setRecentLoading(false);
            if (result.ok) {
                setRecent(result.data);
                setRecentError(null);
            } else {
                setRecentError(result.error);
            }
        });
    }, [canBrowse, rows]);

    // The front page loads once when browsing becomes possible (signing in mid-session counts) and
    // on demand from the refresh button. `ClanContext` deliberately does not auto-load it, so that
    // every page in the app does not cost a `recent_clans` round trip — this is the screen that
    // actually wants it.
    useEffect(() => {
        if (!canBrowse) {
            setRecent(null);
            setRecentError(null);
            setResults(null);
            setSearchError(null);
            return;
        }
        loadRecent();
    }, [canBrowse, loadRecent]);

    // The debounced search. The token is bumped synchronously here, before the timer is even set,
    // so an in-flight request is already stale by the time the next keystroke is processed.
    useEffect(() => {
        const needle = input.trim();
        const mine = ++searchToken.current;

        if (!canBrowse || !needle) {
            // Clearing the box falls back to the cached recent list — no request at all, and no
            // `search_clans('')`, which would return zero rows and read as "nothing matched".
            setSearching(false);
            setResults(null);
            setSearchError(null);
            return;
        }

        setSearching(true);
        const timer = setTimeout(() => {
            void searchClans(needle, rows).then(result => {
                if (!alive.current || mine !== searchToken.current) return;
                setSearching(false);
                if (result.ok) {
                    // Server-ranked (exact tag, tag prefix, name prefix, tag contains, name
                    // contains, then most recently active). Rendered in the order received —
                    // re-sorting here would throw the ranking away.
                    setResults(result.data);
                    setSearchError(null);
                } else {
                    setResults([]);
                    setSearchError(result.error);
                }
            });
        }, SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [input, canBrowse, rows, retryTick]);

    const handlePick = useCallback(
        (clan: ClanPublic) => {
            if (onPick) onPick(clan);
            else setPicked(clan);
        },
        [onPick],
    );

    const searchMode = input.trim().length > 0;
    const list = searchMode ? results : recent;
    const listError = searchMode ? searchError : recentError;
    const loading = searchMode ? searching : recentLoading && recent === null;

    const myClanId = membership?.clan_id ?? null;

    const body = useMemo(() => {
        if (!backendConfigured) {
            return (
                <Panel icon={<Users className="w-5 h-5" />} title="Clans are not available in this build">
                    This copy of the app has no server configured, so there are no accounts and no clans. Everything
                    else keeps working locally.
                </Panel>
            );
        }
        if (authStatus === 'initialising') {
            return <Skeleton label="Checking your account" />;
        }
        if (authStatus !== 'signed-in') {
            return (
                <Panel icon={<LogIn className="w-5 h-5" />} title="Sign in to browse clans">
                    The clan list is only readable by a signed-in account — the server refuses it outright to
                    anonymous callers, so there is nothing to show here yet.
                </Panel>
            );
        }
        if (loading) {
            return <Skeleton label={searchMode ? `Searching for “${input.trim()}”` : 'Loading the most active clans'} />;
        }
        if (listError) {
            return (
                <Panel icon={<AlertTriangle className="w-5 h-5" />} title="Could not load clans" tone="warn">
                    <p>{listError.message}</p>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        onClick={() => (searchMode ? setRetryTick(t => t + 1) : loadRecent())}
                    >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
                    </Button>
                </Panel>
            );
        }
        if (list && list.length > 0) {
            return (
                <ul className="space-y-2">
                    {list.map(clan => (
                        <ClanRow
                            key={clan.id}
                            clan={clan}
                            mine={clan.id === myClanId}
                            onPick={handlePick}
                        />
                    ))}
                </ul>
            );
        }
        // Two different nothings, and they must not look alike.
        if (searchMode) {
            return (
                <Panel icon={<SearchX className="w-5 h-5" />} title={`No clan matches “${input.trim()}”`}>
                    The search looks at clan names and tags only, and it does not guess: check the spelling, or ask
                    for the exact tag. Clans are not listed by member name.
                </Panel>
            );
        }
        return (
            <Panel icon={<Users className="w-5 h-5" />} title="No clans yet">
                Nobody has created a clan on this server yet. Create one and it will show up here for everybody
                else.
            </Panel>
        );
    }, [
        backendConfigured, authStatus, loading, searchMode, input, listError, list, myClanId,
        handlePick, loadRecent,
    ]);

    return (
        <div className={cn('space-y-4', className)}>
            {/* No search box while browsing is impossible: a disabled field that can never run a
                search is exactly the kind of dead control the project's rules forbid. The gate
                panel below says what is missing instead. */}
            {canBrowse && (
                <>
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-0 basis-full sm:basis-auto">
                            <label
                                htmlFor="clan-browser-search"
                                className="block text-xs font-bold text-text-secondary mb-1.5"
                            >
                                Find a clan by name or tag
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                                <input
                                    id="clan-browser-search"
                                    type="search"
                                    inputMode="search"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    placeholder="e.g. Anvil or ANVL"
                                    /* Explicit text colour: this project has shipped black-on-black inputs. */
                                    className="w-full h-10 rounded-lg border border-border bg-bg-input pl-9 pr-9 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary [&::-webkit-search-cancel-button]:appearance-none"
                                />
                                {input && (
                                    <button
                                        type="button"
                                        onClick={() => setInput('')}
                                        aria-label="Clear the search"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-white hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        {!searchMode && (
                            <Button
                                variant="secondary"
                                size="md"
                                onClick={loadRecent}
                                disabled={recentLoading}
                                className="shrink-0"
                            >
                                {recentLoading
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <RefreshCw className="w-4 h-4" />}
                                <span className="ml-1.5">Refresh</span>
                            </Button>
                        )}
                    </div>

                    {/* Says which list is on screen, so "10 rows" is never read as "all the clans". */}
                    <p className="text-[11px] text-text-muted">
                        {searchMode
                            ? 'Best matches, ranked by the server. Exact tags first.'
                            : `The ${rows} most recently active clans. Search to find any other one — the full list is never downloaded.`}
                    </p>
                </>
            )}

            {body}

            {/* Only mounted when this component owns the join flow (no `onPick` given). */}
            {picked && !onPick && (
                <JoinClanDialog
                    key={picked.id}
                    initialName={picked.name}
                    initialTag={picked.tag}
                    onClose={() => setPicked(null)}
                    onJoined={outcome => {
                        onJoined?.(outcome);
                        // The recent list carries a member count that just changed.
                        loadRecent();
                    }}
                />
            )}
        </div>
    );
};

export default ClanBrowser;
