/**
 * AttacksPlanner — the "Attacks" tab: who on your squad hits whom, and how many tickets are left.
 * ================================================================================================
 *
 * The owner's request, verbatim: *"create the attacks planner, a new Attacks Planner tab where users
 * can receive the notification — only those who have notifications enabled THERE will get it. You
 * can add dummy members to your squad and create an enemy with dummy members (create them in batch
 * by choosing the number of users). Push notification to whoever enabled it, and the ability to
 * export the plan as copy-paste to send on Discord."* Plus, since: the enemy stand-ins must be
 * renameable, so the export says who to hit rather than "enemy 7".
 *
 *
 * THE LAYOUT, AND THE ONE DECISION BEHIND IT
 * ------------------------------------------
 * Two columns on a wide screen — YOUR SQUAD on the left, THE ENEMY on the right — and one column
 * below 1024px, squad first. The squad is first in the DOM, not just visually first, because that
 * is the order a member reads: they are looking for their own name and their own targets, and on a
 * phone the enemy roster is reference material they scroll to afterwards.
 *
 * The columns are not decorative. Assigning is "aim at one of your players, then click enemies":
 * the crosshair on a squad row ARMS it, and every enemy card becomes a one-click "add to that
 * player" while it is armed. That gesture only makes sense when both lists are on screen together,
 * which is why the wide layout exists at all. It is an accelerator and never the only way in: every
 * squad row also carries a `+ target` dropdown, which is what works at 360px, with a keyboard, and
 * with a screen reader.
 *
 * `AttackAssignmentRow` owns a squad row. It is a separate file because the board is fifty of them
 * and because the budget arithmetic it renders is the point of the screen.
 *
 *
 * THE TICKET BUDGET, WHICH IS WHY THIS SCREEN EXISTS
 * -------------------------------------------------
 * `GuildWarConfig.MaxWarTicketsPerMember` is read through `useGameData`, never written here as a
 * literal — the config is versioned and the app lets the reader switch versions, so a hard-coded 5
 * would be a number that silently stops matching the game. `clan_war_plans.attacks_per_player` is
 * the leader's own editable copy of it (0009 says at length why the config value is probably not
 * the whole story: `ShopResourcesLibrary.TokenPack0` grants free tokens daily), and this tab says
 * out loud when the two disagree instead of picking a winner.
 *
 * Surfaced at three altitudes, because "who is unused and who is over-committed" has to be visible
 * without counting:
 *   1. THE CLAN TOTAL: one bar, `assigned / capacity`, with the two counts that matter beside it —
 *      how many players have nothing, how many are over budget.
 *   2. PER PLAYER: pips, a fraction and a word (`AttackAssignmentRow`).
 *   3. PER ENEMY: how many attacks point at them, so a leader can see the one everybody piled onto.
 * All three come from `summarizeBudget()` in `utils/warPlanExport.ts`, which the exported text also
 * calls — the screen and the paste cannot disagree about who is short.
 *
 *
 * WHO MAY DO WHAT
 * ---------------
 * `war.canEdit` is owner-or-admin with a real profile on screen. It hides controls and nothing
 * else: the database refuses a member's write with 42501 and grants no client role INSERT, UPDATE
 * or DELETE on any war table, and `ClanContext.warWrite()` refuses locally before a request is even
 * built. A member sees the same board as text, with their own row highlighted, and can export it.
 *
 *
 * THE NOTIFICATION OPT-IN, WHICH IS THE PART THAT NEEDED A MIGRATION
 * -----------------------------------------------------------------
 * "Only those who have notifications enabled THERE will get it" is not something client code can
 * honour: the broadcast is enqueued BY A LEADER FOR EVERYBODY, so the server has to know who wants
 * it. Migration 0010 adds `clan_war_notify_prefs (clan_id, user_id) -> enabled`, defaulting to
 * OFF, written only by `set_war_notify_opt_in()` (which takes no user parameter, so a leader cannot
 * switch a clan-mate on), and read inside `broadcast_clan_notification()`'s fan-out.
 *
 * This tab therefore PROBES rather than assumes. `warPlanApi.WAR_PUSH_OPT_OUT_IS_SERVER_SIDE` is
 * still exported as `false` — it was written before 0010 existed and nobody has flipped it — so
 * trusting it would draw the "this switch does nothing" warning over a switch that now works. One
 * `select` on the preferences table answers the question for the build actually being talked to:
 * rows come back, the opt-in is real; the relation is missing, it is not, and the tab says so
 * plainly instead of drawing a dead control. See `readNotifySettings()` below.
 *
 *
 * THE BROADCAST IS AN OUTWARD-FACING ACTION AND IS TREATED AS ONE
 * --------------------------------------------------------------
 * It reaches up to fifty people's phones and cannot be recalled. So: it is behind a confirmation
 * that states the audience as a NUMBER OF ACCOUNTS (from `war_notify_audience()`, which counts and
 * never names — who silenced you is not a roster column), it says which text will be sent, and it
 * is disabled outright while nothing has changed since the last send. That last rule is the one
 * that stops a leader pressing it four times: the board carries `stamp`, an FNV-1a fingerprint of
 * every participant and every order, and a send records the stamp it went out with.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    Bell,
    BellOff,
    Check,
    ChevronLeft,
    ChevronRight,
    ClipboardCopy,
    Crosshair,
    Eye,
    Loader2,
    Megaphone,
    Pencil,
    Plus,
    RefreshCw,
    Settings2,
    Shield,
    Swords,
    Trash2,
    X,
} from 'lucide-react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { useClan } from '../../context/ClanContext';
import { useGameData } from '../../hooks/useGameData';
import { getSupabaseClient } from '../../services/supabaseClient';
import { classifyError } from '../../services/clanApi';
import {
    WAR_ENEMY_BATCH_MAX,
    WAR_NAME_MAX_LENGTH,
    WAR_OPPONENT_NAME_MAX_LENGTH,
    WAR_OPPONENT_TAG_MAX_LENGTH,
    WAR_ROSTER_MAX_PER_SIDE,
    type WarParticipantRow,
    type WarPlanResult,
} from '../../services/warPlanApi';
import {
    buildWarPlanExportParts,
    summarizeBudget,
    type AttackerLoad,
} from '../../utils/warPlanExport';
import { AttackAssignmentRow } from './AttackAssignmentRow';
import { cn } from '../../lib/utils';

/* ============================================================================================== *
 * THE OPT-IN, TALKING TO 0010 DIRECTLY
 *
 * WHERE THIS BELONGS, AND WHY IT IS HERE INSTEAD. `services/warPlanApi.ts` is meant to be the only
 * module that names a `clan_war_*` object, and these three calls are `clan_war_*` objects. They are
 * not in it because that file is owned by another workstream this cycle and was written before
 * migration 0010 existed — its header still states, correctly for the schema it was measured
 * against, that a per-kind push preference is impossible. Moving these three functions into it (and
 * flipping `WAR_PUSH_OPT_OUT_IS_SERVER_SIDE`) is a mechanical follow-up and is reported as such.
 *
 * Kept deliberately small and self-contained so that move is a cut and a paste: no state, no React,
 * no throwing, and the same `{ ok } | { error }` shape the rest of the feature uses.
 * ============================================================================================== */

/** What the tab knows about this build's war-notification support, after one probe. */
interface NotifySettings {
    /**
     * Three-valued on purpose. `'unsupported'` means this deployment has no 0010, which is a
     * different sentence from `'error'` (the network is down, try again) and both are different
     * from knowing the answer.
     */
    state: 'ready' | 'unsupported' | 'error';
    /** The caller's own preference. Meaningless unless `state === 'ready'`. */
    enabled: boolean;
    /** Why there is no switch. Shown verbatim; never a raw Postgres string. */
    reason: string | null;
    /** Leader-only, and counts only: `war_notify_audience()` returns no names by design. */
    audience: { seats: number; accounts: number; optedIn: number } | null;
}

const NOTIFY_UNKNOWN: NotifySettings = { state: 'error', enabled: false, reason: null, audience: null };

/** PostgREST / Postgres answers that mean "this deployment does not have 0010". */
function isMissingObject(error: unknown): boolean {
    const e = (error ?? {}) as { code?: string; message?: string };
    const code = String(e.code ?? '');
    if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true;
    const message = String(e.message ?? '').toLowerCase();
    return (
        message.includes('could not find the table') ||
        message.includes('could not find the function') ||
        message.includes('does not exist')
    );
}

/**
 * One read of the caller's own preference, plus (for a leader) the audience count.
 *
 * The preference is read with a plain `select`, not an RPC: the table's single RLS policy is
 * `for select using (user_id = auth.uid())`, so this returns exactly the caller's own row or none
 * at all. No row means OFF, which is also the column default and also what 0010's reaper leaves
 * behind when somebody leaves and rejoins — three places that all say no, deliberately.
 */
async function readNotifySettings(clanId: string, isLeader: boolean): Promise<NotifySettings> {
    const client = await getSupabaseClient();
    if (!client) {
        return { state: 'unsupported', enabled: false, reason: 'This build has no server, so there is nothing to notify.', audience: null };
    }

    const db = client as unknown as {
        from: (t: string) => {
            select: (c: string) => {
                eq: (c: string, v: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
            };
        };
        rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
    };

    let enabled = false;
    try {
        const { data, error } = await db
            .from('clan_war_notify_prefs')
            .select('enabled')
            .eq('clan_id', clanId)
            .maybeSingle();
        if (error) {
            if (isMissingObject(error)) {
                return {
                    state: 'unsupported',
                    enabled: false,
                    reason:
                        'This server does not carry the war-notification opt-in yet. Until it does, publishing the plan notifies every account in the clan.',
                    audience: null,
                };
            }
            const classified = classifyError(error);
            if (classified.kind === 'not-a-leader' || classified.kind === 'not-a-member') {
                // A missing table GRANT reads as a refusal, not as an absent relation. Same
                // consequence for the reader: there is no switch to draw.
                return { state: 'unsupported', enabled: false, reason: 'This server will not let you read your notification setting.', audience: null };
            }
            return { state: 'error', enabled: false, reason: classified.message, audience: null };
        }
        enabled = (data as { enabled?: boolean } | null)?.enabled === true;
    } catch (e) {
        return { state: 'error', enabled: false, reason: classifyError(e).message, audience: null };
    }

    let audience: NotifySettings['audience'] = null;
    if (isLeader) {
        try {
            const { data, error } = await db.rpc('war_notify_audience', { p_clan_id: clanId });
            if (!error && data && typeof data === 'object') {
                const raw = data as { seats?: number; accounts?: number; opted_in?: number };
                audience = {
                    seats: Number(raw.seats) || 0,
                    accounts: Number(raw.accounts) || 0,
                    optedIn: Number(raw.opted_in) || 0,
                };
            }
        } catch {
            // A missing count is not a reason to hide a working switch. The confirmation below
            // states the audience as unknown rather than inventing one.
            audience = null;
        }
    }

    return { state: 'ready', enabled, reason: null, audience };
}

/** `set_war_notify_opt_in(p_clan_id, p_enabled)`. No user parameter exists: you set your own. */
async function writeNotifyOptIn(clanId: string, enabled: boolean): Promise<WarPlanResult<boolean>> {
    const client = await getSupabaseClient();
    if (!client) {
        return { ok: false, error: { kind: 'no-backend', message: 'This build has no server configured.' } };
    }
    const db = client as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
    };
    try {
        const { data, error } = await db.rpc('set_war_notify_opt_in', {
            p_clan_id: clanId,
            p_enabled: enabled,
        });
        if (error) {
            if (isMissingObject(error)) {
                return {
                    ok: false,
                    error: { kind: 'unknown', message: 'This server does not carry the war-notification opt-in yet.' },
                };
            }
            return { ok: false, error: classifyError(error) };
        }
        return { ok: true, data: data === true };
    } catch (e) {
        return { ok: false, error: classifyError(e) };
    }
}

/* ============================================================================================== *
 * Small shared pieces
 * ============================================================================================== */

/** A labelled number. Always paints its own background AND its own text colour. */
const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad'; hint?: string }> = ({
    label,
    value,
    tone = 'neutral',
    hint,
}) => (
    <div
        className={cn(
            'rounded-xl border px-3 py-2',
            tone === 'good' && 'border-emerald-500/40 bg-emerald-500/10',
            tone === 'warn' && 'border-amber-500/40 bg-amber-500/10',
            tone === 'bad' && 'border-red-500/40 bg-red-500/10',
            tone === 'neutral' && 'border-border bg-bg-input/50',
        )}
        title={hint}
    >
        <div
            className={cn(
                'font-mono text-lg font-black leading-none tabular-nums',
                tone === 'good' && 'text-emerald-300',
                tone === 'warn' && 'text-amber-300',
                tone === 'bad' && 'text-red-300',
                tone === 'neutral' && 'text-white',
            )}
        >
            {value}
        </div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">{label}</div>
    </div>
);

/** The dashed "nothing to do here" panel, matching `ClanTabShell`'s so they read as one family. */
const Notice: React.FC<{ icon: React.ReactNode; title: string; tone?: 'neutral' | 'bad'; children: React.ReactNode }> = ({
    icon,
    title,
    tone = 'neutral',
    children,
}) => (
    <Card
        className={cn(
            'border-2 border-dashed p-6 sm:p-8',
            tone === 'bad' ? 'border-red-500/40 bg-red-500/5' : 'border-accent-primary/30 bg-gradient-to-b from-accent-primary/5 to-transparent',
        )}
    >
        <div className="flex flex-col items-center gap-3 text-center">
            <div
                className={cn(
                    'flex h-14 w-14 items-center justify-center rounded-2xl',
                    tone === 'bad' ? 'bg-red-500/15 text-red-400' : 'bg-accent-primary/15 text-accent-primary',
                )}
            >
                {icon}
            </div>
            <h2 className="text-xl font-black text-white">{title}</h2>
            <div className="max-w-xl space-y-2 text-sm leading-relaxed text-text-secondary">{children}</div>
        </div>
    </Card>
);

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The confirmation, same contract as `ClanAdminPanel`'s: portal, dimmed backdrop, focus moves in,
 * Tab cycles inside, Escape cancels unless a send is already in flight, focus returns on close.
 */
const ConfirmDialog: React.FC<{
    title: string;
    confirmLabel: string;
    danger?: boolean;
    busy: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ title, confirmLabel, danger, busy, disabled, children, onConfirm, onCancel }) => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const onCancelRef = useRef(onCancel);
    const busyRef = useRef(busy);
    useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
    useEffect(() => { busyRef.current = busy; }, [busy]);

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const node = panelRef.current;
        const focusables = () =>
            node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null) : [];
        (node?.querySelector<HTMLElement>('[data-autofocus="true"]') ?? focusables()[0])?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (!node) return;
            if (event.key === 'Escape') {
                if (busyRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                onCancelRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusables();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (!node.contains(active)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
                return;
            }
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            previouslyFocused?.focus?.();
        };
    }, []);

    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={e => {
                if (e.target === e.currentTarget && !busy) onCancel();
            }}
        >
            <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5 pb-4">
                    <h3 className={cn('text-lg font-black', danger ? 'text-red-300' : 'text-white')}>{title}</h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        aria-label="Cancel"
                        className="rounded-lg p-1.5 text-text-secondary transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 text-sm text-text-secondary">
                    {children}
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-border p-5 pt-4">
                    <Button variant="secondary" onClick={onCancel} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        data-autofocus="true"
                        onClick={onConfirm}
                        disabled={busy || disabled}
                        className={danger ? 'bg-gradient-to-br from-red-600 to-red-700' : undefined}
                    >
                        {busy ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working
                            </>
                        ) : (
                            confirmLabel
                        )}
                    </Button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

/* ============================================================================================== *
 * The tab
 * ============================================================================================== */

/** Which confirmation is on screen. `null` is none. */
type Pending =
    | { kind: 'publish'; notify: boolean }
    | { kind: 'remind' }
    | { kind: 'retract' }
    | { kind: 'clear-orders' }
    | { kind: 'remove'; participant: WarParticipantRow };

/** A one-line result banner. Not a toast: it stays until the next action replaces it. */
interface PlannerNotice {
    tone: 'good' | 'bad';
    text: string;
}

/** `localStorage` key for "the board fingerprint the last push went out with", per plan. */
const sentKey = (planId: string) => `fm.war.pushedStamp.${planId}`;

function readSentStamp(planId: string): string | null {
    try {
        return window.localStorage.getItem(sentKey(planId));
    } catch {
        return null;
    }
}
function writeSentStamp(planId: string, stamp: string): void {
    try {
        window.localStorage.setItem(sentKey(planId), stamp);
    } catch {
        /* private mode, a full quota: the button simply stays enabled. */
    }
}

export interface AttacksPlannerProps {
    className?: string;
}

export const AttacksPlanner: React.FC<AttacksPlannerProps> = ({ className }) => {
    const clan = useClan();
    const war = clan.war;
    const board = war.board;

    /* ---- the game's own ticket allowance, read from the config and never hard-coded ---- */
    const warConfig = useGameData<{ MaxWarTicketsPerMember?: number } | null>('GuildWarConfig.json');
    const configTickets =
        typeof warConfig.data?.MaxWarTicketsPerMember === 'number' ? warConfig.data.MaxWarTicketsPerMember : null;

    const [notice, setNotice] = useState<PlannerNotice | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    const [armedId, setArmedId] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    /* ---- the notification opt-in ---- */
    const [notify, setNotify] = useState<NotifySettings>(NOTIFY_UNKNOWN);
    const [notifyLoading, setNotifyLoading] = useState(true);
    const [notifyBusy, setNotifyBusy] = useState(false);

    /* ---- the export ---- */
    const [exportParts, setExportParts] = useState<string[] | null>(null);
    const [exportBusy, setExportBusy] = useState(false);
    const [exportFenced, setExportFenced] = useState(false);
    const [copied, setCopied] = useState<number | null>(null);

    /* ---- "has anything changed since the last push" ---- */
    const [sentStamp, setSentStamp] = useState<string | null>(null);
    const [captureStamp, setCaptureStamp] = useState(false);

    const clanId = clan.clan?.id ?? null;
    const clanName = clan.clan?.name ?? null;
    const planId = board?.plan.id ?? null;
    const canEdit = war.canEdit;

    /* ---------------------------------------------------------------------------------------- *
     * Effects
     * ---------------------------------------------------------------------------------------- */

    // The provider fetches nothing until something asks. This is the ask, and it is idempotent.
    useEffect(() => {
        war.openWarPlan();
    }, [war.openWarPlan]);

    // The opt-in, once per clan and per role. A member never calls `war_notify_audience()` — it is
    // leader-only and would answer 42501, which is not an error worth showing anybody.
    const refreshNotify = useCallback(async () => {
        if (!clanId) return;
        setNotifyLoading(true);
        const next = await readNotifySettings(clanId, canEdit);
        setNotify(next);
        setNotifyLoading(false);
    }, [clanId, canEdit]);

    useEffect(() => {
        let cancelled = false;
        if (!clanId) {
            setNotify(NOTIFY_UNKNOWN);
            setNotifyLoading(false);
            return;
        }
        setNotifyLoading(true);
        void readNotifySettings(clanId, canEdit).then(next => {
            if (cancelled) return;
            setNotify(next);
            setNotifyLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [clanId, canEdit]);

    // The stamp a push went out with, per plan, restored from storage so the button stays disabled
    // across a reload rather than re-arming itself because the tab was refreshed.
    useEffect(() => {
        setSentStamp(planId ? readSentStamp(planId) : null);
    }, [planId]);

    // Recorded AFTER the write's own reload has landed: `publish()` bumps `revision`, so capturing
    // the stamp we had before the send would arm the button again the moment the board came back.
    useEffect(() => {
        if (!captureStamp || !board) return;
        writeSentStamp(board.plan.id, board.stamp);
        setSentStamp(board.stamp);
        setCaptureStamp(false);
    }, [captureStamp, board]);

    // A plan that is not on screen cannot have an armed row, and a removed participant must not
    // stay armed either: the next enemy click would go to a row that no longer exists.
    useEffect(() => {
        if (!armedId) return;
        if (!board || !board.allies.some(a => a.id === armedId)) setArmedId(null);
    }, [armedId, board]);

    // The export is a snapshot of the sheet. Any edit makes it stale, so it is dropped rather than
    // left on screen looking current.
    useEffect(() => {
        setExportParts(null);
        setCopied(null);
    }, [board?.stamp]);

    /* ---------------------------------------------------------------------------------------- *
     * One place a war write reports itself
     * ---------------------------------------------------------------------------------------- */

    const run = useCallback(
        async <T,>(action: () => Promise<WarPlanResult<T>>, success: (data: T) => string): Promise<T | null> => {
            const result = await action();
            if (!result.ok) {
                setNotice({ tone: 'bad', text: result.error.message });
                if (result.error.raw) console.debug('[attacks planner]', result.error.code, result.error.raw);
                return null;
            }
            setNotice({ tone: 'good', text: success(result.data) });
            return result.data;
        },
        [],
    );

    /* ---------------------------------------------------------------------------------------- *
     * Derived board maths
     * ---------------------------------------------------------------------------------------- */

    const planBudget = board?.plan.attacks_per_player ?? configTickets ?? 0;

    const budgetOf = useCallback(
        (ally: WarParticipantRow) => (ally.attacks_budget === null ? planBudget : ally.attacks_budget),
        [planBudget],
    );

    const loads: AttackerLoad[] = useMemo(() => {
        if (!board) return [];
        return board.allies.map(ally => ({
            id: ally.id,
            name: ally.display_name,
            budget: budgetOf(ally),
            assigned: board.ordersByAttacker.get(ally.id)?.length ?? 0,
        }));
    }, [board, budgetOf]);

    const totals = useMemo(() => summarizeBudget(loads), [loads]);

    /** `enemyId -> how many attacks are pointed at them`, for the enemy column's own load meter. */
    const incoming = useMemo(() => {
        const map = new Map<string, number>();
        if (!board) return map;
        for (const order of board.assignments) map.set(order.target_id, (map.get(order.target_id) ?? 0) + 1);
        return map;
    }, [board]);

    const enemyById = useMemo(() => {
        const map = new Map<string, WarParticipantRow>();
        if (board) for (const enemy of board.enemies) map.set(enemy.id, enemy);
        return map;
    }, [board]);

    const nothingChangedSincePush = !!board && !!sentStamp && sentStamp === board.stamp;

    /* ---------------------------------------------------------------------------------------- *
     * Actions
     * ---------------------------------------------------------------------------------------- */

    /**
     * One ally's whole order list, with the board this click was made on as the precondition.
     *
     * `set_war_assignments()` deletes that attacker's rows and re-inserts the list it is given, so
     * without a precondition two leaders on the same player is a silent last-one-wins: measured on
     * a real cluster, leader B added a third target, leader A then saved the two targets its screen
     * still showed, and B's third target vanished with no error and no revision bump (`revision`
     * versions the plan HEADER, not the board, so nothing moved to notice). The ids the board
     * already holds are exactly what the service reads back, in the same slot order, so this costs
     * one narrow read and turns that case into a refusal that saves nothing and says so.
     */
    const setOrders = useCallback(
        (attackerId: string, targetIds: string[]) => {
            const expectedAssignmentIds = (board?.ordersByAttacker.get(attackerId) ?? []).map(o => o.id);
            void run(
                () =>
                    war.setOrders(attackerId, targetIds.map(targetId => ({ targetId })), {
                        expectedAssignmentIds,
                    }),
                n => (n === 0 ? 'Attack orders cleared for that player.' : `${n} attack${n === 1 ? '' : 's'} saved.`),
            );
        },
        [run, war, board],
    );

    const onEnemyClick = useCallback(
        (enemy: WarParticipantRow) => {
            if (!canEdit || !armedId || !board) return;
            const current = board.ordersByAttacker.get(armedId) ?? [];
            setOrders(armedId, [...current.map(o => o.target_id), enemy.id]);
        },
        [canEdit, armedId, board, setOrders],
    );

    const doPublish = useCallback(
        async (withPush: boolean) => {
            const result = await run(
                () => war.publish({ notify: withPush }),
                data =>
                    withPush
                        // `notified` counts ACCOUNTS the alert was queued for; `allies` counts the
                        // war roster. Two different populations, and the old wording -
                        // "3 notifications queued for 50 players" - read as though 50 people were
                        // being reached by 3 messages. They are now two sentences so neither number
                        // can be mistaken for the other.
                        ? `Published for ${data.allies} player${data.allies === 1 ? '' : 's'}. ${data.notified === 0 ? 'Nobody has war alerts on, so no notification went out.' : `The alert went to ${data.notified} account${data.notified === 1 ? '' : 's'} with war alerts on, on their registered devices.`}`
                        : `Published quietly. ${data.orders} attack order${data.orders === 1 ? '' : 's'} are now visible to the clan.`,
            );
            if (result && withPush) setCaptureStamp(true);
            setPending(null);
            if (result) void refreshNotify();
        },
        [run, war, refreshNotify],
    );

    const doRemind = useCallback(async () => {
        const opponent = board?.plan.opponent_name ? ` vs ${board.plan.opponent_name}` : '';
        const result = await run(
            () =>
                war.notify(
                    'War attack plan updated',
                    `${clanName ?? 'Your clan'} has a new attack plan for the war${opponent}. Open the Attacks tab to see your targets.`,
                ),
            n => `${n} notification${n === 1 ? '' : 's'} queued.`,
        );
        if (result !== null) setCaptureStamp(true);
        setPending(null);
    }, [run, war, board, clanName]);

    const doExport = useCallback(async () => {
        setExportBusy(true);
        setCopied(null);
        const sheet = await war.loadSheet();
        setExportBusy(false);
        if (!sheet.ok) {
            setNotice({ tone: 'bad', text: sheet.error.message });
            return;
        }
        setExportParts(
            buildWarPlanExportParts(sheet.data, {
                clanName: clanName ?? undefined,
                enemies: (board?.enemies ?? []).map(e => ({ name: e.display_name, power_estimate: e.power_estimate })),
                plan: board
                    ? {
                        week_start: board.plan.week_start,
                        battle_day: board.plan.battle_day,
                        status: board.plan.status,
                        opponent_name: board.plan.opponent_name,
                        opponent_tag: board.plan.opponent_tag,
                    }
                    : undefined,
                codeBlock: exportFenced,
            }),
        );
    }, [war, clanName, board, exportFenced]);

    const copyPart = useCallback(async (text: string, index: number) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(index);
            window.setTimeout(() => setCopied(c => (c === index ? null : c)), 2000);
        } catch {
            // Clipboard access can be refused outright (an insecure origin, a locked-down browser).
            // The text is on screen in a selectable box, so say that rather than failing silently.
            setNotice({ tone: 'bad', text: 'This browser would not let the page copy. Select the text and copy it by hand.' });
        }
    }, []);

    const toggleOptIn = useCallback(async () => {
        if (!clanId || notify.state !== 'ready') return;
        setNotifyBusy(true);
        const next = !notify.enabled;
        const result = await writeNotifyOptIn(clanId, next);
        setNotifyBusy(false);
        if (!result.ok) {
            setNotice({ tone: 'bad', text: result.error.message });
            return;
        }
        setNotify(prev => ({ ...prev, enabled: next }));
        setNotice({
            tone: 'good',
            text: next
                ? 'War alerts on. Your clan leaders can now ping you when the plan changes.'
                : 'War alerts off. You will not be sent war notifications for this clan.',
        });
        void refreshNotify();
    }, [clanId, notify, refreshNotify]);

    /* ---------------------------------------------------------------------------------------- *
     * The states with nothing to show
     * ---------------------------------------------------------------------------------------- */

    // No backend, signed out, a shared profile, or a profile in no clan. The tab renders NOTHING:
    // `ClanTabShell` has already explained each of those with a screen of its own, and a second
    // explanation inside a tab that should not exist is noise.
    if (clan.status !== 'ready' || !clan.clan || !clan.role || war.status === 'unavailable') return null;

    /* ---------------------------------------------------------------------------------------- *
     * Header pieces used by every remaining state
     * ---------------------------------------------------------------------------------------- */

    const weekStrip = (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-bg-input/60 p-1">
                <button
                    type="button"
                    onClick={() => war.stepWeek(-1)}
                    aria-label="Previous war week"
                    className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-white/10 hover:text-white"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 font-mono text-xs font-bold text-white tabular-nums">{war.weekStart}</span>
                <button
                    type="button"
                    onClick={() => war.stepWeek(1)}
                    aria-label="Next war week"
                    className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-white/10 hover:text-white"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>
            {!war.isCurrentWeek && (
                <Button variant="secondary" size="sm" onClick={() => war.setWeekStart(new Date().toISOString().slice(0, 10))}>
                    This week
                </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void war.refreshWar()} disabled={war.busy}>
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', war.busy && 'animate-spin')} /> Refresh
            </Button>
        </div>
    );

    const noticeBanner = notice && (
        <div
            role="status"
            className={cn(
                'flex items-start gap-2 rounded-xl border px-3 py-2 text-sm',
                notice.tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200',
            )}
        >
            {notice.tone === 'good' ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-white/10">
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );

    /* ---- THE OPT-IN CARD. Every member sees it, whatever the plan's state. ---- */

    const optInCard = (
        <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-4">
                <div
                    className={cn(
                        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                        notify.state === 'ready' && notify.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-text-secondary',
                    )}
                >
                    {notify.state === 'ready' && notify.enabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black uppercase tracking-wider text-white">War alerts</h3>
                        {notifyLoading ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
                                <Loader2 className="h-3 w-3 animate-spin" /> checking
                            </span>
                        ) : notify.state === 'ready' ? (
                            <span
                                className={cn(
                                    'rounded px-1.5 py-px text-[10px] font-black uppercase tracking-wider',
                                    notify.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-text-secondary',
                                )}
                            >
                                {notify.enabled ? 'On for you' : 'Off for you'}
                            </span>
                        ) : (
                            <span className="rounded bg-amber-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wider text-amber-300">
                                Unavailable
                            </span>
                        )}
                    </div>

                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {notify.state === 'ready' ? (
                            <>
                                Turning this on lets your clan leaders send a push notification to this account when the
                                attack plan is published or changed. It is off unless you turn it on, it covers this clan
                                only, and turning it off stops the notifications immediately. Leaving the clan clears it.
                                {' '}
                                {/*
                                  * This switch records CONSENT, not a delivery route. The alert is
                                  * queued for the account and then sent to whatever rows that account
                                  * has in push_subscriptions; with none, the queue row is claimed with
                                  * an empty device list and nothing is ever delivered — measured on a
                                  * real cluster. Somebody who flips this and never allows browser
                                  * notifications would otherwise wait for a ping that cannot arrive,
                                  * and blame the clan for not sending it.
                                  */}
                                It only reaches you on devices where you have allowed notifications for this app, which
                                you do once per device on the Profile tab.
                            </>
                        ) : (
                            notify.reason ?? 'The notification setting could not be read.'
                        )}
                    </p>

                    {notify.state === 'ready' && notify.audience && (
                        <p className="mt-1.5 text-[11px] text-text-secondary">
                            {notify.audience.optedIn} of {notify.audience.accounts} account
                            {notify.audience.accounts === 1 ? '' : 's'} in this clan have war alerts on
                            {notify.audience.seats !== notify.audience.accounts && (
                                <> ({notify.audience.seats} profiles, some belonging to the same person)</>
                            )}
                            .
                        </p>
                    )}
                </div>

                <div className="shrink-0">
                    {notify.state === 'ready' ? (
                        <button
                            type="button"
                            role="switch"
                            aria-checked={notify.enabled}
                            aria-label="Receive war alerts for this clan"
                            disabled={notifyBusy}
                            onClick={() => void toggleOptIn()}
                            className={cn(
                                'relative h-8 w-14 rounded-full border transition-colors disabled:opacity-50',
                                notify.enabled ? 'border-emerald-400/60 bg-emerald-500/70' : 'border-border bg-bg-input',
                            )}
                        >
                            <span
                                className={cn(
                                    'absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white shadow transition-all',
                                    notify.enabled ? 'left-[26px]' : 'left-1',
                                )}
                            />
                        </button>
                    ) : notify.state === 'error' ? (
                        <Button variant="secondary" size="sm" onClick={() => void refreshNotify()} disabled={notifyLoading}>
                            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', notifyLoading && 'animate-spin')} /> Retry
                        </Button>
                    ) : null}
                </div>
            </div>
        </Card>
    );

    /* ---------------------------------------------------------------------------------------- *
     * Loading / error / no plan
     * ---------------------------------------------------------------------------------------- */

    if (war.status === 'idle' || war.status === 'loading') {
        return (
            <div className={cn('space-y-4', className)}>
                {weekStrip}
                <Card className="p-10">
                    <div className="flex items-center justify-center gap-3 text-text-secondary">
                        <Loader2 className="h-5 w-5 animate-spin text-accent-primary" />
                        <span className="text-sm">Loading the attack plan for the week of {war.weekStart}</span>
                    </div>
                </Card>
            </div>
        );
    }

    if (war.status === 'error') {
        return (
            <div className={cn('space-y-4', className)}>
                {weekStrip}
                <Notice icon={<AlertTriangle className="h-7 w-7" />} title="Could not load the attack plan" tone="bad">
                    <p>{war.error?.message || 'Something went wrong.'}</p>
                    <div className="pt-2">
                        <Button variant="secondary" size="sm" onClick={() => void war.refreshWar()} disabled={war.busy}>
                            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', war.busy && 'animate-spin')} /> Try again
                        </Button>
                    </div>
                </Notice>
            </div>
        );
    }

    if (war.status === 'none' || !board) {
        return (
            <div className={cn('space-y-4', className)}>
                {weekStrip}
                {noticeBanner}
                <Notice icon={<Swords className="h-7 w-7" />} title="No attack plan for this week">
                    {canEdit ? (
                        <>
                            <p>
                                Start one and you get two rosters: your squad, built from your clan mates plus any
                                stand-ins you need, and the other guild, which is always names you type in.
                            </p>
                            <p className="text-xs text-text-secondary">
                                A plan stays a draft until you publish it. Drafts are invisible to your members, so you
                                can build the whole thing before anyone sees a half-finished sheet.
                            </p>
                            <div className="pt-2">
                                <Button
                                    onClick={() =>
                                        void run(() => war.createPlan(), () => 'Plan started. Add your squad and the enemy.')
                                    }
                                    disabled={war.busy}
                                >
                                    {war.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                    Start this week&apos;s plan
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p>Your clan leaders have not published an attack plan for the week of {war.weekStart} yet.</p>
                            <p className="text-xs text-text-secondary">
                                When they do, your targets appear here and your own line is highlighted.
                            </p>
                        </>
                    )}
                </Notice>
                {optInCard}
            </div>
        );
    }

    /* ---------------------------------------------------------------------------------------- *
     * The board
     * ---------------------------------------------------------------------------------------- */

    const plan = board.plan;
    const published = plan.status === 'published';
    const myAllyIds = new Set(board.allies.filter(a => a.profile_id && a.profile_id === clan.profileId).map(a => a.id));
    const rosterFull = board.allies.length >= WAR_ROSTER_MAX_PER_SIDE;
    const enemyFull = board.enemies.length >= WAR_ROSTER_MAX_PER_SIDE;
    const capacityLabel =
        board.allies.every(a => a.attacks_budget === null)
            ? `${board.allies.length} players x ${planBudget} attacks`
            : 'sum of each player\'s own allowance';

    return (
        <div className={cn('space-y-4', className)}>
            {/* ---- week, status, leader actions ---- */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {weekStrip}
                <span
                    className={cn(
                        'rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider',
                        published ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300',
                    )}
                    title={
                        published
                            ? 'Every member of the clan can see this plan.'
                            : 'Only the owner and admins can see this plan. Members see nothing until you publish.'
                    }
                >
                    {published ? 'Published' : 'Draft'}
                </span>
                <span className="text-[11px] text-text-secondary">
                    Battle day: Day {plan.battle_day + 1}
                    {war.battleDay !== null && war.battleDay !== plan.battle_day && (
                        <span className="text-amber-300"> (the config says Day {war.battleDay + 1})</span>
                    )}
                </span>

                {canEdit && (
                    <div className="ml-auto flex flex-wrap gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setShowSettings(s => !s)}>
                            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Plan settings
                        </Button>
                        {published && (
                            <Button variant="secondary" size="sm" onClick={() => setPending({ kind: 'retract' })} disabled={war.busy}>
                                <Eye className="mr-1.5 h-3.5 w-3.5" /> Hide from members
                            </Button>
                        )}
                        <Button
                            size="sm"
                            onClick={() => setPending({ kind: 'publish', notify: true })}
                            disabled={war.busy || board.allies.length === 0}
                            title={board.allies.length === 0 ? 'Add at least one player first.' : undefined}
                        >
                            <Megaphone className="mr-1.5 h-3.5 w-3.5" />
                            {published ? 'Republish' : 'Publish'}
                        </Button>
                        {published && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setPending({ kind: 'remind' })}
                                disabled={war.busy || nothingChangedSincePush}
                                title={
                                    nothingChangedSincePush
                                        ? 'Nothing has changed since the last alert went out.'
                                        : 'Send a reminder without republishing.'
                                }
                            >
                                <Bell className="mr-1.5 h-3.5 w-3.5" /> Remind clan
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {noticeBanner}

            {/* ---- the clan-wide budget: the headline of the whole screen ---- */}
            <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                            <span className="text-sm font-black uppercase tracking-wider text-white">Attacks assigned</span>
                            <span className="font-mono text-2xl font-black tabular-nums text-white">
                                {totals.assigned}
                                <span className="text-text-secondary"> / {totals.capacity}</span>
                            </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                            {capacityLabel}
                            {configTickets !== null && (
                                <>
                                    {' '}· the game gives {configTickets} war ticket{configTickets === 1 ? '' : 's'} per member
                                    {planBudget !== configTickets && (
                                        <span className="text-amber-300">, this plan says {planBudget}</span>
                                    )}
                                </>
                            )}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="Players" value={totals.attackers} hint="Everybody on your side of this plan." />
                        <Stat
                            label="No target"
                            value={totals.idle}
                            tone={totals.idle > 0 ? 'bad' : 'good'}
                            hint="Players who have not been given a single attack."
                        />
                        <Stat
                            label="Spare"
                            value={totals.spare}
                            tone={totals.spare > 0 ? 'warn' : 'good'}
                            hint="Attacks that exist and are not pointed at anybody."
                        />
                        <Stat
                            label="Over"
                            value={totals.over}
                            tone={totals.over > 0 ? 'bad' : 'good'}
                            hint="Players told to do more attacks than they have tickets for."
                        />
                    </div>
                </div>

                {/* The bar. Green up to capacity, red for the overflow, and the track is always
                    visible so an empty plan reads as "0 of 60" and not as a missing element. */}
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-bg-input">
                    <div className="flex h-full w-full">
                        <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${totals.capacity > 0 ? Math.min(100, (Math.min(totals.assigned, totals.capacity) / totals.capacity) * 100) : 0}%` }}
                        />
                        {totals.overflow > 0 && (
                            <div
                                className="h-full bg-red-500"
                                style={{ width: `${totals.capacity > 0 ? Math.min(100, (totals.overflow / totals.capacity) * 100) : 100}%` }}
                            />
                        )}
                    </div>
                </div>
            </Card>

            {/* ---- leader-only plan settings ---- */}
            {canEdit && showSettings && (
                <PlanSettings
                    opponentName={plan.opponent_name}
                    opponentTag={plan.opponent_tag}
                    attacksPerPlayer={plan.attacks_per_player}
                    notes={plan.notes}
                    configTickets={configTickets}
                    busy={war.busy}
                    onSave={patch =>
                        void run(
                            () => war.savePlan(patch, { expectedRevision: plan.revision }),
                            () => 'Plan settings saved.',
                        )
                    }
                />
            )}

            {armedId && canEdit && (
                <div className="flex items-center gap-2 rounded-xl border border-accent-primary/50 bg-accent-primary/10 px-3 py-2 text-xs text-white">
                    <Crosshair className="h-4 w-4 shrink-0 text-accent-primary" />
                    <span className="min-w-0 flex-1">
                        Aiming at <strong>{board.allies.find(a => a.id === armedId)?.display_name}</strong>. Click an enemy
                        to add them as the next target.
                    </span>
                    <button type="button" onClick={() => setArmedId(null)} className="rounded px-2 py-1 font-bold hover:bg-white/10">
                        Done
                    </button>
                </div>
            )}

            {/* ---- the two columns ---- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                {/* --- YOUR SQUAD --- */}
                <Card className="p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Shield className="h-4 w-4 text-sky-400" />
                        <h3 className="text-sm font-black uppercase tracking-wider text-white">Your squad</h3>
                        <span className="rounded bg-white/5 px-1.5 py-px font-mono text-[11px] text-text-secondary">
                            {board.allies.length}/{WAR_ROSTER_MAX_PER_SIDE}
                        </span>
                        {canEdit && (
                            <div className="ml-auto flex flex-wrap items-center gap-2">
                                <AddAllyPicker
                                    members={war.addableMembers}
                                    disabled={war.busy || rosterFull}
                                    onAdd={profileId =>
                                        void run(() => war.addAlly({ profileId }), () => 'Added to your squad.')
                                    }
                                />
                                <AddNameButton
                                    label="Stand-in"
                                    title="Add a name that is not a clan account (a friend's alt, somebody who has not signed up)."
                                    disabled={war.busy || rosterFull}
                                    onAdd={name => void run(() => war.addAlly({ displayName: name }), () => 'Stand-in added.')}
                                />
                            </div>
                        )}
                    </div>

                    {rosterFull && (
                        <p className="mb-2 text-[11px] text-amber-300">
                            This side is full at {WAR_ROSTER_MAX_PER_SIDE}, which is the most a guild can hold.
                        </p>
                    )}

                    {board.allies.length === 0 ? (
                        <p className="py-6 text-center text-sm text-text-secondary">
                            {canEdit
                                ? 'Nobody on your side yet. Add your clan mates, then point them at the enemy.'
                                : 'The leaders have not put anybody on this plan yet.'}
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {board.allies.map(ally => (
                                <AttackAssignmentRow
                                    key={ally.id}
                                    attacker={ally}
                                    orders={board.ordersByAttacker.get(ally.id) ?? []}
                                    enemies={board.enemies}
                                    enemyById={enemyById}
                                    budget={budgetOf(ally)}
                                    planBudget={planBudget}
                                    canEdit={canEdit}
                                    isMine={myAllyIds.has(ally.id)}
                                    armed={armedId === ally.id}
                                    busy={war.busy}
                                    onArm={() => setArmedId(id => (id === ally.id ? null : ally.id))}
                                    onSetOrders={ids => setOrders(ally.id, ids)}
                                    onRename={name =>
                                        void run(() => war.rename(ally.id, 'ally', name), () => 'Renamed.')
                                    }
                                    onRemove={() => setPending({ kind: 'remove', participant: ally })}
                                    onSetBudget={attacks =>
                                        void run(
                                            () => war.updateParticipant(ally.id, 'ally', { attacksBudget: attacks }),
                                            () => `${ally.display_name} now has ${attacks} attack${attacks === 1 ? '' : 's'}.`,
                                        )
                                    }
                                />
                            ))}
                        </ul>
                    )}

                    {canEdit && board.assignments.length > 0 && (
                        <div className="mt-3 border-t border-border pt-3">
                            <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'clear-orders' })} disabled={war.busy}>
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear every attack order
                            </Button>
                        </div>
                    )}
                </Card>

                {/* --- THE ENEMY --- */}
                <Card className="p-3 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Swords className="h-4 w-4 text-red-400" />
                        <h3 className="text-sm font-black uppercase tracking-wider text-white">
                            {plan.opponent_name || 'The enemy'}
                        </h3>
                        {plan.opponent_tag && <span className="font-mono text-xs text-accent-primary">[{plan.opponent_tag}]</span>}
                        <span className="rounded bg-white/5 px-1.5 py-px font-mono text-[11px] text-text-secondary">
                            {board.enemies.length}/{WAR_ROSTER_MAX_PER_SIDE}
                        </span>
                    </div>

                    {canEdit && (
                        <EnemyBatchForm
                            existing={board.enemies.length}
                            disabled={war.busy || enemyFull}
                            onCreate={(count, prefix) =>
                                void run(
                                    () => war.addEnemies(count, prefix ? { prefix } : undefined),
                                    data =>
                                        data.stoppedBy
                                            ? `${data.created.length} of ${data.requested} added, then it stopped: ${data.stoppedBy.message}`
                                            : `${data.created.length} enemy slot${data.created.length === 1 ? '' : 's'} added. Rename them as you read the other guild.`,
                                )
                            }
                            onAddOne={name => void run(() => war.addEnemy(name), () => 'Enemy added.')}
                        />
                    )}

                    {board.enemies.length === 0 ? (
                        <p className="py-6 text-center text-sm text-text-secondary">
                            {canEdit
                                ? 'No enemies yet. Add as many slots as the other guild has, then rename each one as you read their roster.'
                                : 'The leaders have not listed the other guild yet.'}
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {board.enemies.map(enemy => {
                                const hits = incoming.get(enemy.id) ?? 0;
                                return (
                                    <li key={enemy.id}>
                                        <div
                                            className={cn(
                                                'flex items-center gap-2 rounded-lg border px-2 py-1.5',
                                                hits === 0 ? 'border-border bg-bg-input/40' : 'border-red-500/30 bg-red-500/5',
                                            )}
                                        >
                                            {canEdit && armedId && (
                                                <button
                                                    type="button"
                                                    onClick={() => onEnemyClick(enemy)}
                                                    disabled={war.busy}
                                                    title={`Add ${enemy.display_name} as the next target`}
                                                    aria-label={`Add ${enemy.display_name} as the next target`}
                                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent-primary/60 bg-accent-primary/20 text-accent-primary transition-colors hover:bg-accent-primary hover:text-black"
                                                >
                                                    <Plus className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <EnemyName
                                                    enemy={enemy}
                                                    canEdit={canEdit}
                                                    busy={war.busy}
                                                    onRename={name =>
                                                        void run(() => war.rename(enemy.id, 'enemy', name), () => 'Enemy renamed.')
                                                    }
                                                />
                                                {enemy.power_estimate !== null && enemy.power_estimate > 0 && (
                                                    <div className="text-[10px] text-text-secondary">
                                                        power {enemy.power_estimate.toLocaleString('en-US')}
                                                    </div>
                                                )}
                                            </div>
                                            <span
                                                className={cn(
                                                    'shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums',
                                                    hits === 0 ? 'text-text-secondary' : 'text-red-300',
                                                )}
                                                title={hits === 0 ? 'Nobody has been sent at this one.' : `${hits} of your attacks land here.`}
                                            >
                                                {hits === 0 ? 'unhit' : `${hits} in`}
                                            </span>
                                            {canEdit && (
                                                <button
                                                    type="button"
                                                    onClick={() => setPending({ kind: 'remove', participant: enemy })}
                                                    disabled={war.busy}
                                                    aria-label={`Remove ${enemy.display_name}`}
                                                    title={`Remove ${enemy.display_name} from the plan`}
                                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-text-secondary transition-colors hover:border-red-500/60 hover:text-red-300"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>
            </div>

            {/* ---- the export ---- */}
            <Card className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <ClipboardCopy className="h-4 w-4 text-accent-primary" />
                    <h3 className="text-sm font-black uppercase tracking-wider text-white">Send it to Discord</h3>
                    <label className="ml-auto flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <input
                            type="checkbox"
                            checked={exportFenced}
                            onChange={e => {
                                setExportFenced(e.target.checked);
                                setExportParts(null);
                            }}
                            className="h-3.5 w-3.5 accent-amber-500"
                        />
                        Wrap in a code block
                    </label>
                    <Button size="sm" onClick={() => void doExport()} disabled={exportBusy || war.busy}>
                        {exportBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />}
                        Build the message
                    </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-text-secondary">
                    One block per player, so everybody can find their own name. Players with no target are listed by name
                    at the end. Long plans are split into messages Discord will accept.
                </p>

                {exportParts && (
                    <div className="mt-3 space-y-3">
                        {exportParts.map((part, i) => (
                            <div key={i} className="rounded-xl border border-border bg-bg-input/60 p-2">
                                <div className="mb-1.5 flex items-center gap-2">
                                    <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                                        {exportParts.length > 1 ? `Message ${i + 1} of ${exportParts.length}` : 'One message'} ·{' '}
                                        {part.length} characters
                                    </span>
                                    <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void copyPart(part, i)}>
                                        {copied === i ? (
                                            <>
                                                <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> Copied
                                            </>
                                        ) : (
                                            <>
                                                <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Copy
                                            </>
                                        )}
                                    </Button>
                                </div>
                                <textarea
                                    readOnly
                                    value={part}
                                    rows={Math.min(16, part.split('\n').length + 1)}
                                    onFocus={e => e.currentTarget.select()}
                                    className="w-full resize-y rounded-lg border border-border bg-bg-primary p-2 font-mono text-[11px] leading-relaxed text-text-primary outline-none focus:border-accent-primary/60"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {optInCard}

            {/* ---- confirmations ---- */}
            {pending?.kind === 'publish' && (
                <PublishDialog
                    published={published}
                    notify={notify}
                    notifyLoading={notifyLoading}
                    totals={totals}
                    busy={war.busy}
                    nothingChanged={nothingChangedSincePush}
                    onCancel={() => setPending(null)}
                    onConfirm={withPush => void doPublish(withPush)}
                />
            )}

            {pending?.kind === 'remind' && (
                <ConfirmDialog
                    title="Send a reminder to the clan?"
                    confirmLabel={audienceLabel(notify, 'Send it')}
                    busy={war.busy}
                    onCancel={() => setPending(null)}
                    onConfirm={() => void doRemind()}
                >
                    <AudienceLine notify={notify} loading={notifyLoading} />
                    <p>
                        It goes out as a push notification titled <strong>&ldquo;War attack plan updated&rdquo;</strong> and
                        opens the clan tab when it is tapped. It cannot be recalled.
                    </p>
                    <p className="text-xs text-text-secondary">One notification a minute, per clan. The plan itself is not changed.</p>
                </ConfirmDialog>
            )}

            {pending?.kind === 'retract' && (
                <ConfirmDialog
                    title="Hide this plan from your members?"
                    confirmLabel="Hide it"
                    danger
                    busy={war.busy}
                    onCancel={() => setPending(null)}
                    onConfirm={() =>
                        void run(() => war.retract(), () => 'The plan is a draft again. Members cannot see it.').then(() =>
                            setPending(null),
                        )
                    }
                >
                    <p>
                        It goes back to being a draft. Every attack order is kept, but nobody except the owner and the
                        admins can see the plan until you publish it again.
                    </p>
                </ConfirmDialog>
            )}

            {pending?.kind === 'clear-orders' && (
                <ConfirmDialog
                    title="Clear every attack order?"
                    confirmLabel={`Clear ${board.assignments.length} order${board.assignments.length === 1 ? '' : 's'}`}
                    danger
                    busy={war.busy}
                    onCancel={() => setPending(null)}
                    onConfirm={() =>
                        void run(() => war.clearOrders(), n => `${n} attack order${n === 1 ? '' : 's'} removed.`).then(() =>
                            setPending(null),
                        )
                    }
                >
                    <p>
                        Both rosters stay exactly as they are. Every attack order in the plan is deleted, for all{' '}
                        {board.allies.length} player{board.allies.length === 1 ? '' : 's'}. <strong>There is no undo.</strong>
                    </p>
                </ConfirmDialog>
            )}

            {pending?.kind === 'remove' && (
                <ConfirmDialog
                    title={`Remove ${pending.participant.display_name}?`}
                    confirmLabel="Remove"
                    danger
                    busy={war.busy}
                    onCancel={() => setPending(null)}
                    onConfirm={() =>
                        void run(
                            () => war.removeParticipant(pending.participant.id),
                            n =>
                                n > 0
                                    ? `${pending.participant.display_name} removed, along with ${n} attack order${n === 1 ? '' : 's'}.`
                                    : `${pending.participant.display_name} removed.`,
                        ).then(() => setPending(null))
                    }
                >
                    <p>
                        {pending.participant.side === 'enemy'
                            ? 'Every attack any of your players was given against this enemy is deleted with them.'
                            : 'Every attack order this player was given is deleted with them.'}{' '}
                        <strong>There is no undo.</strong>
                    </p>
                    {pending.participant.member_kind === 'profile' && (
                        <p className="text-xs text-text-secondary">
                            This only takes them off the war plan. They stay in the clan.
                        </p>
                    )}
                </ConfirmDialog>
            )}
        </div>
    );
};

/* ============================================================================================== *
 * The audience sentence, in one place so the dialogs cannot describe it two different ways
 * ============================================================================================== */

function audienceLabel(notify: NotifySettings, fallback: string): string {
    if (notify.state === 'ready' && notify.audience) {
        const n = notify.audience.optedIn;
        return n === 0 ? 'Send anyway (0 people)' : `Notify ${n} ${n === 1 ? 'person' : 'people'}`;
    }
    return fallback;
}

/**
 * WHO ACTUALLY RECEIVES THIS, stated as a number before the button is pressed.
 *
 * Three genuinely different answers, and conflating any two of them would be a lie to somebody:
 *   * the opt-in exists and the count is known -> the exact number of ACCOUNTS, and a warning when
 *     it is zero, because "published" and "everybody knows" are not the same thing;
 *   * the opt-in exists but the count could not be read -> say so, promise nothing;
 *   * this server has no opt-in -> EVERY account in the clan is notified, which is the older
 *     behaviour and has to be said out loud rather than quietly assumed.
 *
 * WHAT THE NUMBER IS NOT: a delivery count. `war_notify_audience()` counts opt-in ROWS through
 * `clan_members`; it does not look at `push_subscriptions`, and nothing on the client can, because
 * that table's RLS is `user_id = auth.uid()` — a leader can see their own devices and nobody
 * else's. Measured end to end on a PG 14.16 cluster with 0001..0011: two accounts opted in, one of
 * them with no registered device, `war_notify_audience()` answered `opted_in: 2`,
 * `broadcast_clan_notification()` enqueued 2 rows, and `claim_due_notifications()` handed the
 * sender `devices: []` for one of them. So this line used to end "and will get a push
 * notification" for somebody the pipeline could not reach. It now states the count that is known
 * and names the condition on the rest — the same condition the no-opt-in branch below has always
 * stated out loud.
 */
const AudienceLine: React.FC<{ notify: NotifySettings; loading: boolean }> = ({ notify, loading }) => {
    if (loading) {
        return (
            <p className="inline-flex items-center gap-2 text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Counting who will receive it
            </p>
        );
    }

    if (notify.state !== 'ready') {
        return (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                This server has no per-member opt-in, so <strong>every account in the clan</strong> with a registered
                device receives this. Nobody can silence it from here.
            </p>
        );
    }

    if (!notify.audience) {
        return (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                Only clan mates who turned <strong>War alerts</strong> on in this tab receive it. The count could not be
                read just now, so this may reach nobody at all.
            </p>
        );
    }

    const { optedIn, accounts, seats } = notify.audience;
    if (optedIn === 0) {
        return (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                <strong>Nobody has turned war alerts on yet</strong>, so this notification reaches zero people. The plan
                itself will still be visible in the app. Ask your clan to switch it on at the bottom of this tab.
            </p>
        );
    }

    return (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-200">
            <strong>
                {optedIn} of {accounts} account{accounts === 1 ? '' : 's'}
            </strong>{' '}
            in this clan turned war alerts on. Each of them is sent this on whatever devices they have allowed
            notifications on, so anybody who has not done that yet gets nothing.
            {seats !== accounts && (
                <span className="text-emerald-300/80">
                    {' '}
                    (The roster shows {seats} profiles; some belong to the same person, who is notified once.)
                </span>
            )}
        </p>
    );
};

/* ============================================================================================== *
 * The publish confirmation — the one outward-facing button on the tab
 * ============================================================================================== */

const PublishDialog: React.FC<{
    published: boolean;
    notify: NotifySettings;
    notifyLoading: boolean;
    totals: ReturnType<typeof summarizeBudget>;
    busy: boolean;
    nothingChanged: boolean;
    onCancel: () => void;
    onConfirm: (withPush: boolean) => void;
}> = ({ published, notify, notifyLoading, totals, busy, nothingChanged, onCancel, onConfirm }) => {
    // Default OFF when a push would be pointless or repetitive: nothing has moved since the last
    // one, or nobody is listening. A leader can still turn it on; it just is not the default.
    const pushPossible = !(notify.state === 'ready' && notify.audience?.optedIn === 0);
    const [withPush, setWithPush] = useState(!nothingChanged && pushPossible);

    return (
        <ConfirmDialog
            title={published ? 'Republish the attack plan?' : 'Publish the attack plan?'}
            confirmLabel={withPush ? audienceLabel(notify, 'Publish and notify') : 'Publish quietly'}
            busy={busy}
            onCancel={onCancel}
            onConfirm={() => onConfirm(withPush)}
        >
            <p>
                Publishing makes the plan visible to every member of the clan. They see their own targets and their own
                line highlighted.
            </p>

            {(totals.idle > 0 || totals.over > 0) && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                    Before you do:{' '}
                    {totals.idle > 0 && (
                        <>
                            <strong>
                                {totals.idle} player{totals.idle === 1 ? ' has' : 's have'} no target at all
                            </strong>
                            {totals.over > 0 ? ', and ' : '. '}
                        </>
                    )}
                    {totals.over > 0 && (
                        <>
                            <strong>
                                {totals.over} {totals.over === 1 ? 'is' : 'are'} over budget
                            </strong>{' '}
                            by {totals.overflow} attack{totals.overflow === 1 ? '' : 's'}.
                        </>
                    )}
                </p>
            )}

            <label className="flex items-start gap-2 rounded-lg border border-border bg-bg-input/60 p-2">
                <input
                    type="checkbox"
                    checked={withPush}
                    onChange={e => setWithPush(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                />
                <span className="min-w-0 flex-1 text-sm text-text-primary">
                    Also send a push notification
                    {nothingChanged && (
                        <span className="block text-[11px] text-amber-300">
                            Nothing has changed since the last alert went out, so this would be a second buzz about the
                            same plan.
                        </span>
                    )}
                </span>
            </label>

            {withPush ? (
                <AudienceLine notify={notify} loading={notifyLoading} />
            ) : (
                <p className="text-xs text-text-secondary">
                    Nobody is notified. The plan still becomes visible in the app, which is what you want when you are
                    fixing a typo.
                </p>
            )}

            <p className="text-xs text-text-secondary">
                A notification cannot be recalled, and the clan can only be notified once a minute. If the notification
                is refused, the publish is rolled back with it, so the clan is never told to look at a draft.
            </p>
        </ConfirmDialog>
    );
};

/* ============================================================================================== *
 * Leader-only forms
 * ============================================================================================== */

/** The plan header a leader types in, because the game config says nothing about any of it. */
const PlanSettings: React.FC<{
    opponentName: string | null;
    opponentTag: string | null;
    attacksPerPlayer: number;
    notes: string | null;
    configTickets: number | null;
    busy: boolean;
    onSave: (patch: { opponentName?: string; opponentTag?: string; attacksPerPlayer?: number; notes?: string }) => void;
}> = ({ opponentName, opponentTag, attacksPerPlayer, notes, configTickets, busy, onSave }) => {
    const [name, setName] = useState(opponentName ?? '');
    const [tag, setTag] = useState(opponentTag ?? '');
    const [attacks, setAttacks] = useState(String(attacksPerPlayer));
    const [note, setNote] = useState(notes ?? '');

    return (
        <Card className="p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <Pencil className="h-4 w-4 text-accent-primary" />
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Plan settings</h3>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                        Other guild
                    </span>
                    <input
                        value={name}
                        maxLength={WAR_OPPONENT_NAME_MAX_LENGTH}
                        onChange={e => setName(e.target.value)}
                        placeholder="Iron Vultures"
                        className="h-9 w-full rounded-lg border border-border bg-bg-input px-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">Tag</span>
                    <input
                        value={tag}
                        maxLength={WAR_OPPONENT_TAG_MAX_LENGTH}
                        onChange={e => setTag(e.target.value)}
                        placeholder="IV"
                        className="h-9 w-full rounded-lg border border-border bg-bg-input px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                        Attacks per player
                    </span>
                    <input
                        type="number"
                        min={0}
                        max={20}
                        value={attacks}
                        onChange={e => setAttacks(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border bg-bg-input px-2.5 font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                    {configTickets !== null && (
                        <span className="mt-1 block text-[10px] text-text-secondary">
                            The game config says {configTickets}. It is editable because free tokens can add more.
                        </span>
                    )}
                </label>
            </div>
            <label className="mt-3 block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                    Note for the clan (appears nowhere else yet)
                </span>
                <textarea
                    value={note}
                    rows={2}
                    maxLength={2000}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Hit the top three first, save tickets for the reset."
                    className="w-full resize-y rounded-lg border border-border bg-bg-input p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                        const patch: { opponentName?: string; opponentTag?: string; attacksPerPlayer?: number; notes?: string } = {};
                        if (name.trim() && name.trim() !== (opponentName ?? '')) patch.opponentName = name.trim();
                        if (tag.trim() && tag.trim() !== (opponentTag ?? '')) patch.opponentTag = tag.trim();
                        const n = Math.round(Number(attacks));
                        if (Number.isFinite(n) && n >= 0 && n !== attacksPerPlayer) patch.attacksPerPlayer = n;
                        if (note.trim() && note.trim() !== (notes ?? '')) patch.notes = note.trim();
                        onSave(patch);
                    }}
                >
                    Save settings
                </Button>
                <span className="text-[11px] text-text-secondary">
                    Emptying a box leaves the old value: the server treats a blank as &ldquo;unchanged&rdquo;, not as
                    &ldquo;delete&rdquo;.
                </span>
            </div>
        </Card>
    );
};

/** The clan-mate picker. Never offers somebody already on the roster. */
const AddAllyPicker: React.FC<{
    members: { profileId: string; name: string }[];
    disabled?: boolean;
    onAdd: (profileId: string) => void;
}> = ({ members, disabled, onAdd }) => (
    <label className="inline-flex items-center">
        <span className="sr-only">Add a clan mate to the squad</span>
        <select
            value=""
            disabled={disabled || members.length === 0}
            onChange={e => {
                const id = e.target.value;
                e.currentTarget.value = '';
                if (id) onAdd(id);
            }}
            title={members.length === 0 ? 'Every clan mate is already on this plan.' : 'Add a clan mate'}
            className="h-8 rounded-lg border border-border bg-bg-input px-2 text-xs text-text-secondary outline-none transition-colors hover:border-accent-primary/50 hover:text-white focus:border-accent-primary disabled:opacity-40"
        >
            <option value="" style={{ backgroundColor: '#13131a', color: '#f5f5f5' }}>+ clan mate</option>
            {members.map(m => (
                <option key={m.profileId} value={m.profileId} style={{ backgroundColor: '#13131a', color: '#f5f5f5' }}>
                    {m.name}
                </option>
            ))}
        </select>
    </label>
);

/** A one-field "type a name and add it" popover, used for stand-ins and single enemies. */
const AddNameButton: React.FC<{
    label: string;
    title: string;
    disabled?: boolean;
    onAdd: (name: string) => void;
}> = ({ label, title, disabled, onAdd }) => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');

    if (!open) {
        return (
            <Button variant="secondary" size="sm" disabled={disabled} title={title} onClick={() => setOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> {label}
            </Button>
        );
    }

    const commit = () => {
        const next = name.replace(/\s+/g, ' ').trim();
        setOpen(false);
        setName('');
        if (next) onAdd(next);
    };

    return (
        <span className="inline-flex items-center gap-1">
            <input
                autoFocus
                value={name}
                maxLength={WAR_NAME_MAX_LENGTH}
                placeholder={`${label} name`}
                aria-label={`${label} name`}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                    }
                    if (e.key === 'Escape') {
                        setOpen(false);
                        setName('');
                    }
                }}
                className="h-8 w-32 rounded-lg border border-accent-primary/60 bg-bg-input px-2 text-xs text-white outline-none"
            />
            <Button size="sm" onClick={commit} disabled={!name.trim()}>
                <Check className="h-3.5 w-3.5" />
            </Button>
        </span>
    );
};

/**
 * "Create them in batch by choosing the number of users" — the owner's words.
 *
 * It says out loud that this is N separate requests, because it is: 0009 has no batch RPC, so
 * `createEnemyDummies()` is a client loop and a partial failure leaves the enemies it already made.
 */
const EnemyBatchForm: React.FC<{
    existing: number;
    disabled?: boolean;
    onCreate: (count: number, prefix: string) => void;
    onAddOne: (name: string) => void;
}> = ({ existing, disabled, onCreate, onAddOne }) => {
    const room = Math.max(0, WAR_ROSTER_MAX_PER_SIDE - existing);
    const [count, setCount] = useState('10');
    const [prefix, setPrefix] = useState('');
    const n = Math.min(Math.max(Math.round(Number(count) || 0), 0), Math.min(WAR_ENEMY_BATCH_MAX, room));

    return (
        <div className="mb-3 rounded-xl border border-dashed border-border p-2.5">
            <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                        How many
                    </span>
                    <input
                        type="number"
                        min={1}
                        max={Math.min(WAR_ENEMY_BATCH_MAX, room) || 1}
                        value={count}
                        onChange={e => setCount(e.target.value)}
                        className="h-8 w-20 rounded-lg border border-border bg-bg-input px-2 text-center font-mono text-sm text-text-primary focus:border-accent-primary focus:outline-none"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                        Name them
                    </span>
                    <input
                        value={prefix}
                        maxLength={WAR_NAME_MAX_LENGTH - 4}
                        placeholder="Enemy"
                        onChange={e => setPrefix(e.target.value)}
                        className="h-8 w-28 rounded-lg border border-border bg-bg-input px-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                    />
                </label>
                <Button size="sm" disabled={disabled || n < 1} onClick={() => onCreate(n, prefix.trim())}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add {n || ''} slot{n === 1 ? '' : 's'}
                </Button>
                <AddNameButton
                    label="One by name"
                    title="Add a single enemy whose name you already know."
                    disabled={disabled}
                    onAdd={onAddOne}
                />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">
                They arrive as &ldquo;{prefix.trim() || 'Enemy'} 1&rdquo;, &ldquo;{prefix.trim() || 'Enemy'} 2&rdquo; and so
                on. <strong>Click a name to rename it</strong> as you read the other guild&apos;s roster, so the exported
                sheet says who to hit. Room for {room} more. Each one is a separate request, so a big batch takes a
                moment.
            </p>
        </div>
    );
};

/** An enemy's name: always renameable by a leader, because every enemy is a stand-in by design. */
const EnemyName: React.FC<{
    enemy: WarParticipantRow;
    canEdit: boolean;
    busy: boolean;
    onRename: (name: string) => void;
}> = ({ enemy, canEdit, busy, onRename }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(enemy.display_name);
    useEffect(() => {
        if (!editing) setDraft(enemy.display_name);
    }, [enemy.display_name, editing]);

    if (!canEdit) return <span className="block whitespace-nowrap overflow-hidden text-clip text-sm text-white">{enemy.display_name}</span>;

    if (!editing) {
        return (
            <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                title={`Rename ${enemy.display_name}`}
                aria-label={`Rename ${enemy.display_name}`}
                className="group/en flex w-full min-w-0 items-center gap-1 text-left"
            >
                <span className="whitespace-nowrap overflow-hidden text-clip text-sm text-white">{enemy.display_name}</span>
                <Pencil className="h-3 w-3 shrink-0 text-text-secondary opacity-0 transition-opacity group-hover/en:opacity-100" />
            </button>
        );
    }

    const commit = () => {
        setEditing(false);
        const next = draft.replace(/\s+/g, ' ').trim();
        if (next && next !== enemy.display_name) onRename(next);
        else setDraft(enemy.display_name);
    };

    return (
        <input
            autoFocus
            value={draft}
            maxLength={WAR_NAME_MAX_LENGTH}
            aria-label={`Rename ${enemy.display_name}`}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                }
                if (e.key === 'Escape') {
                    setDraft(enemy.display_name);
                    setEditing(false);
                }
            }}
            className="h-7 w-full rounded border border-accent-primary/60 bg-bg-input px-2 text-sm text-white outline-none"
        />
    );
};

export default AttacksPlanner;
