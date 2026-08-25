/**
 * ClanAdminPanel — running a clan: the password, the roster, the roles, the emblem, the exits.
 * ===========================================================================================
 *
 * THE CLIENT GATE IS UX. IT IS NOT SECURITY.
 * -----------------------------------------
 * Every `if (canX)` in this file decides whether a CONTROL IS DRAWN, and nothing else. The
 * enforcement lives in Postgres and cannot be reached from here: `set_member_role`,
 * `transfer_ownership`, `kick_member`, `set_join_password`, `generate_join_password` and
 * `set_clan_badge` are all `security definer` functions that re-check `has_clan_role()` themselves
 * and raise `42501` when the caller is not entitled, `clans` can only be DELETEd through the
 * `clans_delete_owner` RLS policy, and `authenticated` holds no INSERT/UPDATE privilege on
 * `clan_tree` or `clan_secrets` at all. So a hostile client that removed every check below would
 * gain exactly nothing.
 *
 * The consequence that matters for the code: **the server is allowed to disagree with us.** A role
 * can change (someone was demoted a second ago; a leader was kicked; the clan was handed over) while
 * this panel still shows the old buttons, and Realtime only covers `clan_members` and `clan_tree`.
 * So every action reports the REAL outcome, and a `not-a-leader` / `not-a-member` answer triggers a
 * `refresh()` so the panel stops lying about what this profile may do. It is never treated as
 * "impossible, therefore a bug".
 *
 * WHY CONTROLS ARE HIDDEN RATHER THAN DISABLED
 * -------------------------------------------
 * The rules the user laid down are asymmetric, and a disabled button still teaches the wrong model:
 *
 *   owner   promotes, demotes, hands the clan over, kicks anyone but themself, deletes the clan,
 *           sets the password and the emblem. Cannot be kicked. Must hand the clan over before
 *           leaving — unless they are its last member, in which case leaving takes the clan with it.
 *   admin   sees and changes the password, sets the emblem, and kicks MEMBERS ONLY. An admin gets
 *           no control at all next to the owner or next to another admin — not a greyed-out one.
 *   member  sees the clan, the roster and their own way out. Nothing else. `canSeePassword` is
 *           false, so the password section does not exist for them: `clan_secrets`' RLS returns them
 *           zero rows anyway (that is "not visible", not "an error"), so there is nothing to grey.
 *
 * THE GUILD TIER IS THE OWNER'S ALONE, AND IT IS NARROWER THAN "LEADER"
 * --------------------------------------------------------------------
 * The emblem and the password are owner+admin. The tier is not: it is a clan SETTING, and 0008's
 * rule is that the owner alone changes clan settings. 0011 kept it that way on purpose, extending
 * `set_clan_settings()` — which checks `has_clan_role(id, array['owner'])` — rather than opening a
 * second door that could drift. So the control below is gated on `role === 'owner'` and not on
 * `isLeader`: an ADMIN gets 42501 from that function, exactly like a stranger, and a greyed-out
 * button would teach them otherwise. `<ClanTierPanel/>` itself is drawn for everybody, read-only,
 * because what a war pays is not a secret from the people who have to fight it.
 *
 * Every one of those predicates is read from `ClanContext` (`canManageRoles`, `canSeePassword`,
 * `canKick(role)`, `canDeleteClan`, `canLeave`, `mustTransferBeforeLeaving`) rather than re-derived
 * here, so this file cannot drift from the rules the rest of the app enforces.
 *
 * THE PASSWORD
 * ------------
 * Reveal-on-click, never on load: `revealPassword()` is what fetches it (leaders get a row, everyone
 * else gets `null`, which is not an error), and it is rendered only while the reveal is toggled on.
 * It is never put in a `title=` attribute — hover text and screenshots both capture those — never
 * logged (there is not a single `console.*` call in this file), and the hand-edit field only exists
 * once the leader has asked for it. The length/charset rule mirrors `set_join_password()` in
 * 0003 §8 exactly: trimmed, 12–64 characters, printable only (the SQL regex is `^[[:print:]]+$`,
 * i.e. no control characters and no newlines). The mirror exists so the form can answer instantly;
 * the function is still the enforcement.
 *
 * WHAT THIS PANEL DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * Renaming a clan (`updateClan`) is not here. A rename has to re-run the game's own
 * `NameValidationRegex`/`TagValidationRegex` and length rules from `GuildBaseConfig.json`, which is
 * exactly what `CreateClanForm` already does; a second copy of that validation in this file would be
 * a second place for it to be wrong. It belongs in one shared field component, which is a different
 * change from this one.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    ArrowUpRight,
    Check,
    Copy,
    Crown,
    Eye,
    EyeOff,
    Info,
    KeyRound,
    Loader2,
    LogOut,
    Palette,
    Pencil,
    RefreshCw,
    Shield,
    ShieldCheck,
    Swords,
    Trash2,
    UserCheck,
    UserMinus,
    UserX,
    X,
} from 'lucide-react';
import { Button } from '../UI/Button';
import { ClanBadge, ClanBadgePicker } from '../UI/ClanBadge';
import { ClanTierPanel, TierOptions } from './ClanTierPanel';
import { useClan } from '../../context/ClanContext';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { badgesEqual, type ClanBadge as ClanBadgeValue } from '../../utils/clanBadge';
import {
    JOIN_PASSWORD_MAX_LENGTH,
    JOIN_PASSWORD_MIN_LENGTH,
    setClanTier,
    type ClanError,
    type ClanResult,
    type ClanRole,
    type ClanRosterDetailRow,
    type ClanTier,
} from '../../services/clanApi';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------------------------------ *
 * Password rule — mirrored from set_join_password() (0003 §8), not invented here
 * ------------------------------------------------------------------------------------------ */

/**
 * The SQL is:
 *   v_pw := btrim(p_password);
 *   char_length(v_pw) between 12 and 64        -> else 22023
 *   v_pw ~ '^[[:print:]]+$'                    -> else 22023
 *
 * `[[:print:]]` is "printable": everything except control characters. So the JS mirror rejects the
 * C0 range, DEL and the C1 range, and nothing else — it must not be stricter than the database, or
 * it would refuse a password the clan could legitimately use.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

function validateJoinPassword(raw: string): string | null {
    const value = raw.trim();
    if (value.length < JOIN_PASSWORD_MIN_LENGTH || value.length > JOIN_PASSWORD_MAX_LENGTH) {
        return `Between ${JOIN_PASSWORD_MIN_LENGTH} and ${JOIN_PASSWORD_MAX_LENGTH} characters (you have ${value.length}).`;
    }
    if (CONTROL_CHARS.test(value)) {
        return 'No line breaks or control characters.';
    }
    return null;
}

/* ------------------------------------------------------------------------------------------ *
 * Confirmation dialog
 * ------------------------------------------------------------------------------------------ */

/** Every destructive action in this panel is one of these. */
type Pending =
    | { kind: 'kick'; profileId: string; name: string; role: ClanRole }
    | { kind: 'promote'; profileId: string; name: string }
    | { kind: 'demote'; profileId: string; name: string }
    | { kind: 'handover'; profileId: string; name: string }
    | { kind: 'regenerate' }
    | { kind: 'leave' }
    | { kind: 'delete' };

interface ConfirmShape {
    title: string;
    body: ReactNode;
    confirmLabel: string;
    danger: boolean;
    /** When set, the button stays inert until the user types this string exactly. */
    typePhrase?: string;
    typeLabel?: string;
}

interface ConfirmDialogProps {
    shape: ConfirmShape;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/** Same list `JoinClanDialog` traps on. */
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Same idiom as `MergeDialog`: a portal to `document.body`, a dimmed backdrop that closes on a
 * click outside (never while busy — a half-finished kick must not lose its dialog), and the
 * consequence spelled out in the body rather than in the button.
 *
 * KEYBOARD
 * --------
 * `aria-modal="true"` is a promise to a screen reader that the rest of the page is unreachable, and
 * it has to be kept by real behaviour. Measured before this was added: the dialog opened with focus
 * still on the button behind it, Tab walked straight out into the member list underneath (so the
 * next Enter hit "Demote" on somebody while a removal confirmation was on screen), and Escape did
 * nothing. So: focus moves in on open, Tab cycles inside, Escape cancels, and focus returns to
 * whatever opened the dialog when it closes — the same contract `JoinClanDialog` already keeps.
 *
 * Escape is ignored while `busy`: a kick that is already committing must not lose the dialog that
 * will report its outcome.
 */
function ConfirmDialog({ shape, busy, onConfirm, onCancel }: ConfirmDialogProps) {
    const [typed, setTyped] = useState('');
    const matched = !shape.typePhrase || typed.trim() === shape.typePhrase;

    const panelRef = useRef<HTMLDivElement | null>(null);
    // Refs, so the trap is installed ONCE: re-installing it per render would drag focus back to the
    // top of the dialog on every keystroke in the type-to-confirm box.
    const onCancelRef = useRef(onCancel);
    const busyRef = useRef(busy);
    useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);
    useEffect(() => { busyRef.current = busy; }, [busy]);

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const node = panelRef.current;

        const focusables = (): HTMLElement[] => {
            if (!node) return [];
            return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                el => el.offsetParent !== null || el === document.activeElement,
            );
        };

        // The type-to-confirm box is focused HERE rather than with React's `autoFocus`, which is
        // applied during the commit — before this effect runs. That ordering silently broke the
        // restore: `previouslyFocused` above would already be the box inside the dialog, so closing
        // it dropped focus to <body> and a keyboard user landed back at the top of the page.
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
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={e => {
                if (e.target === e.currentTarget && !busy) onCancel();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={shape.title}
            ref={panelRef}
        >
            {/* The "delete the clan" body is the tallest of these (a warning, four bullets, what is
                kept, and a type-to-confirm box) and measured 568px: it clears a 360x640 phone by
                36px and nothing shorter. Capping the height and scrolling the BODY — title and the
                Cancel/confirm row stay put — is what stops a small viewport or a larger default
                font size from pushing the confirm button off the screen. */}
            <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5 pb-4">
                    <h3 className={cn('text-lg font-black', shape.danger ? 'text-red-300' : 'text-white')}>
                        {shape.title}
                    </h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        aria-label="Cancel"
                        className="rounded-lg p-1.5 text-text-muted transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 text-sm text-text-secondary">
                    {shape.body}
                    {shape.typePhrase && (
                        <label className="block">
                            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                                {shape.typeLabel ?? 'Type to confirm'}
                            </span>
                            <input
                                type="text"
                                value={typed}
                                onChange={e => setTyped(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                data-autofocus="true"
                                placeholder={shape.typePhrase}
                                className="h-10 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                            />
                        </label>
                    )}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-border p-5 pt-4">
                    <Button variant="secondary" onClick={onCancel} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={busy || !matched}
                        className={shape.danger ? 'bg-gradient-to-br from-red-600 to-red-700' : undefined}
                    >
                        {busy ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Working
                            </>
                        ) : (
                            shape.confirmLabel
                        )}
                    </Button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/* ------------------------------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------------------------------ */

const ROLE_LABEL: Record<ClanRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

function RoleChip({ role }: { role: ClanRole }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest',
                role === 'owner'
                    ? 'bg-amber-500/20 text-amber-300'
                    : role === 'admin'
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-white/5 text-text-muted',
            )}
        >
            {role === 'owner' ? <Crown className="h-3 w-3" /> : role === 'admin' ? <Shield className="h-3 w-3" /> : null}
            {ROLE_LABEL[role]}
        </span>
    );
}

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-bg-secondary/50 p-4">
            <div className="mb-3 flex items-start gap-2">
                <span className="mt-0.5 text-accent-primary">{icon}</span>
                <div className="min-w-0">
                    <h4 className="text-sm font-black uppercase tracking-wider text-white">{title}</h4>
                    {hint && <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>}
                </div>
            </div>
            {children}
        </section>
    );
}

/** Roster order: owner, then admins, then members; strongest profile first inside each rank. */
const RANK: Record<ClanRole, number> = { owner: 0, admin: 1, member: 2 };

/* ------------------------------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------------------------------ */

export interface ClanAdminPanelProps {
    /** Called after this profile has left the clan, so the page can go back to "no clan". */
    onLeft?: () => void;
    /** Called after the clan has been deleted. */
    onDeleted?: () => void;
    className?: string;
}

export function ClanAdminPanel({ onLeft, onDeleted, className }: ClanAdminPanelProps) {
    const clan = useClan();
    const {
        clan: clanRow,
        role,
        roster,
        requests,
        badge,
        membership,
        canManageRoles,
        canSeePassword,
        canKick,
        canDeleteClan,
        canLeave,
        mustTransferBeforeLeaving,
    } = clan;

    /**
     * Leaders are owner + admin. `canSeePassword` and `canEditTree` are the same predicate in
     * `ClanContext`, but both are named for what they gate, so the emblem — which
     * `set_clan_badge()` also restricts to owner/admin — gets its own honest derivation instead of
     * borrowing one of theirs.
     */
    const isLeader = role === 'owner' || role === 'admin';
    /**
     * Narrower than `isLeader` on purpose — see the header. `set_clan_settings()` admits the owner
     * and nobody else, so an admin gets no tier control at all rather than a disabled one.
     */
    const isOwner = role === 'owner';

    const [pending, setPending] = useState<Pending | null>(null);
    const [working, setWorking] = useState(false);
    const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);
    const [editingPassword, setEditingPassword] = useState(false);
    const [draftPassword, setDraftPassword] = useState('');

    const [badgeOpen, setBadgeOpen] = useState(false);
    const [badgeDraft, setBadgeDraft] = useState<ClanBadgeValue | null>(null);

    const [tierOpen, setTierOpen] = useState(false);
    /**
     * `undefined` means "the editor has not been touched", which is not the same as `null` — `null`
     * is a real choice ("clear the tier back to not set") and the one thing the other four clan
     * settings can never express, since they are NOT NULL columns.
     */
    const [tierDraft, setTierDraft] = useState<ClanTier | null | undefined>(undefined);

    const clanId = clanRow?.id ?? null;

    // A clan switch (or a profile switch) must not leave a revealed password, an open editor or a
    // stale emblem draft on screen for the NEXT clan.
    useEffect(() => {
        setRevealed(false);
        setCopied(false);
        setEditingPassword(false);
        setDraftPassword('');
        setBadgeOpen(false);
        setBadgeDraft(null);
        setTierOpen(false);
        setTierDraft(undefined);
        setFeedback(null);
        setPending(null);
    }, [clanId]);

    /**
     * Runs one action and reports what actually happened.
     *
     * The `not-a-leader` / `not-a-member` branch is the important one: those are the answers that
     * mean "the client gate was wrong", so the panel refetches its own membership instead of leaving
     * a button on screen that the server has already refused once.
     */
    const run = useCallback(
        async <T,>(action: () => Promise<ClanResult<T>>, success: string): Promise<boolean> => {
            setWorking(true);
            setFeedback(null);
            try {
                const result = await action();
                if (result.ok) {
                    setFeedback({ tone: 'ok', text: success });
                    return true;
                }
                const error: ClanError = result.error;
                setFeedback({ tone: 'error', text: error.message });
                if (error.kind === 'not-a-leader' || error.kind === 'not-a-member' || error.kind === 'not-your-profile') {
                    // The server and this panel disagree about the role. The server wins.
                    await clan.refresh();
                }
                return false;
            } finally {
                setWorking(false);
            }
        },
        [clan],
    );

    const sortedRoster = useMemo(
        () =>
            [...roster].sort(
                (a, b) => RANK[a.role] - RANK[b.role] || (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name),
            ),
        [roster],
    );

    const memberCount = roster.length;
    const isOnlyMember = memberCount <= 1;

    /* -------------------------------------------------------------------------------------- *
     * Password actions
     * -------------------------------------------------------------------------------------- */

    async function reveal() {
        if (revealed) {
            setRevealed(false);
            return;
        }
        const result = await clan.revealPassword();
        if (!result.ok) {
            setFeedback({ tone: 'error', text: result.error.message });
            return;
        }
        if (result.data === null) {
            // RLS filtered the row out — i.e. the server does not consider this profile a leader.
            setFeedback({ tone: 'error', text: 'The server did not give you the password. Only the owner and admins can see it.' });
            await clan.refresh();
            return;
        }
        setRevealed(true);
    }

    /**
     * Copy WITHOUT revealing. Fetching is the same leaders-only read that Show performs, so a
     * leader who only wants to paste the password into their clan chat never has to put it on
     * screen (or into a screen recording) first. That is also why this button is never disabled:
     * "not fetched yet" is not a reason to refuse, it is a reason to fetch.
     */
    async function copyPassword() {
        let value = clan.password;
        if (!value) {
            const result = await clan.revealPassword();
            if (!result.ok) {
                setFeedback({ tone: 'error', text: result.error.message });
                return;
            }
            if (result.data === null) {
                setFeedback({ tone: 'error', text: 'The server did not give you the password. Only the owner and admins can see it.' });
                await clan.refresh();
                return;
            }
            value = result.data;
        }
        try {
            await navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            setFeedback({
                tone: 'error',
                text: 'This browser would not let the page use the clipboard. Reveal the password and copy it by hand.',
            });
        }
    }

    async function savePassword() {
        const problem = validateJoinPassword(draftPassword);
        if (problem) {
            setFeedback({ tone: 'error', text: problem });
            return;
        }
        const done = await run(() => clan.setPassword(draftPassword), 'Join password changed. The old one no longer works.');
        if (done) {
            setEditingPassword(false);
            setDraftPassword('');
            setRevealed(true);
        }
    }

    /* -------------------------------------------------------------------------------------- *
     * Emblem
     * -------------------------------------------------------------------------------------- */

    const effectiveBadgeDraft = badgeDraft ?? badge;
    const badgeDirty = !!badgeDraft && !!badge && !badgesEqual(badgeDraft, badge);

    async function saveBadge() {
        if (!badgeDraft) return;
        const done = await run(() => clan.setBadge(badgeDraft), 'Emblem updated.');
        if (done) {
            setBadgeDraft(null);
            setBadgeOpen(false);
        }
    }

    /* -------------------------------------------------------------------------------------- *
     * Guild tier
     * -------------------------------------------------------------------------------------- */

    const currentTier = clanRow?.tier ?? null;
    /** `undefined` = untouched, so the editor opens showing whatever is recorded. */
    const effectiveTierDraft = tierDraft === undefined ? currentTier : tierDraft;
    const tierDirty = tierDraft !== undefined && tierDraft !== currentTier;

    /**
     * The write goes through `clanApi.setClanTier`, which is `set_clan_settings(p_tier => )` — the
     * same owner-only door as every other clan setting, and the only one there is: no client role
     * holds UPDATE on any column of `clans`, so a direct PATCH is `42501 permission denied for table
     * clans` even for the owner.
     *
     * The gate above is UX. This is the boundary, and it is allowed to disagree with us: an owner
     * who was handed the clan away a second ago still has the button on screen. `run()` reports the
     * server's own refusal and refetches the membership on `not-a-leader`, so the button stops being
     * offered rather than failing again.
     *
     * `clan.refresh()` on success because this call does NOT go through a `ClanContext` action, so
     * nothing else refetches the clan row and the panel would keep showing the old tier.
     */
    async function saveTier() {
        if (!clanRow || !tierDirty) return;
        const wanted = effectiveTierDraft;
        const done = await run(
            () => setClanTier(clanRow.id, wanted),
            wanted === null
                ? 'Guild tier cleared. Nothing is recorded for this clan now.'
                : `Guild tier recorded as ${wanted}.`,
        );
        if (done) {
            setTierDraft(undefined);
            setTierOpen(false);
            await clan.refresh();
        }
    }

    /* -------------------------------------------------------------------------------------- *
     * Confirmations
     * -------------------------------------------------------------------------------------- */

    const shape: ConfirmShape | null = useMemo(() => {
        if (!pending || !clanRow) return null;
        switch (pending.kind) {
            case 'kick':
                return {
                    title: `Remove ${pending.name}?`,
                    danger: true,
                    confirmLabel: 'Remove from clan',
                    body: (
                        <>
                            <p>
                                <span className="font-semibold text-text-primary">{pending.name}</span> loses their
                                seat in {clanRow.name} [{clanRow.tag}] and stops seeing the clan&apos;s shared tree
                                and everyone&apos;s war summaries.
                            </p>
                            <p>
                                Their own profile, their own tech trees and their own resources are untouched — this
                                only removes the membership. They can come back with the current join password
                                (regenerate it below if you do not want that).
                            </p>
                        </>
                    ),
                };
            case 'promote':
                return {
                    title: `Make ${pending.name} an admin?`,
                    danger: false,
                    confirmLabel: 'Promote to admin',
                    body: (
                        <>
                            <p>An admin can:</p>
                            <ul className="list-disc space-y-1 pl-5 text-text-secondary">
                                <li>read, change and regenerate the join password;</li>
                                <li>edit the clan&apos;s shared tech tree;</li>
                                <li>change the emblem;</li>
                                <li>remove plain members (not you, and not other admins).</li>
                            </ul>
                            <p>You can demote them again at any time.</p>
                        </>
                    ),
                };
            case 'demote':
                return {
                    title: `Demote ${pending.name} to member?`,
                    danger: false,
                    confirmLabel: 'Demote to member',
                    body: (
                        <p>
                            They keep their seat, and lose the password, the shared-tree editor, the emblem and the
                            ability to remove anybody. They can still pull the clan tree into their own profile,
                            like every member.
                        </p>
                    ),
                };
            case 'handover':
                return {
                    title: `Hand ${clanRow.name} to ${pending.name}?`,
                    danger: true,
                    confirmLabel: 'Transfer ownership',
                    typePhrase: pending.name,
                    typeLabel: `Type ${pending.name} to confirm`,
                    body: (
                        <>
                            <p>
                                <span className="font-semibold text-text-primary">{pending.name}</span> becomes the
                                owner. You become an admin.
                            </p>
                            <p className="text-red-300">
                                You cannot undo this yourself. Only the new owner can give the clan back — or promote
                                you again, or remove you. There is exactly one owner at a time.
                            </p>
                        </>
                    ),
                };
            case 'regenerate':
                return {
                    title: 'Generate a new join password?',
                    danger: true,
                    confirmLabel: 'Generate new password',
                    body: (
                        <>
                            <p>
                                The current password stops working the moment you confirm. Anyone you already gave it
                                to — and anyone who has it written down in your clan chat — can no longer join with
                                it.
                            </p>
                            <p>Members who are already in the clan are not affected.</p>
                        </>
                    ),
                };
            case 'leave':
                return {
                    title: `Leave ${clanRow.name}?`,
                    danger: true,
                    confirmLabel: 'Leave clan',
                    body: isOnlyMember ? (
                        <>
                            <p className="text-red-300">
                                You are the only member, so leaving <strong>deletes the clan</strong>: the shared
                                tech tree, the join password and the name {clanRow.name} [{clanRow.tag}] all go with
                                it, and the name becomes available to somebody else.
                            </p>
                            <p>
                                Your own profile keeps its copy of the clan tree and all of your resources. Nothing
                                on your account is deleted.
                            </p>
                        </>
                    ) : (
                        <>
                            <p>
                                You stop being a member of {clanRow.name} [{clanRow.tag}] and lose access to the
                                shared tree and to your clan mates&apos; war summaries.
                            </p>
                            <p>
                                Your profile keeps its own copy of the clan tree. To come back you need the clan
                                name, the tag and the current join password.
                            </p>
                        </>
                    ),
                };
            case 'delete':
                return {
                    title: `Delete ${clanRow.name} [${clanRow.tag}]?`,
                    danger: true,
                    confirmLabel: 'Delete this clan',
                    typePhrase: clanRow.name,
                    typeLabel: `Type the clan name (${clanRow.name}) to confirm`,
                    body: (
                        <>
                            <p className="text-red-300">This cannot be undone, and it affects everyone.</p>
                            <p>Deleted:</p>
                            <ul className="list-disc space-y-1 pl-5">
                                <li>
                                    the membership of all {memberCount} member{memberCount === 1 ? '' : 's'} — they
                                    are simply no longer in a clan;
                                </li>
                                <li>the shared clan tech tree;</li>
                                <li>the join password;</li>
                                <li>
                                    the name {clanRow.name} and the tag {clanRow.tag}, which become available to
                                    anybody.
                                </li>
                            </ul>
                            <p>
                                Kept: every member&apos;s own profile, their own tech trees and their own resources.
                                Their war summaries stop being shared because there is no clan left to share them
                                with.
                            </p>
                        </>
                    ),
                };
        }
    }, [pending, clanRow, memberCount, isOnlyMember]);

    async function confirmPending() {
        if (!pending) return;
        switch (pending.kind) {
            case 'kick': {
                const done = await run(() => clan.kick(pending.profileId), `${pending.name} was removed from the clan.`);
                if (done) setPending(null);
                break;
            }
            case 'promote': {
                const done = await run(() => clan.promote(pending.profileId), `${pending.name} is now an admin.`);
                if (done) setPending(null);
                break;
            }
            case 'demote': {
                const done = await run(() => clan.demote(pending.profileId), `${pending.name} is now a plain member.`);
                if (done) setPending(null);
                break;
            }
            case 'handover': {
                const done = await run(
                    () => clan.handOver(pending.profileId),
                    `${pending.name} owns the clan now. You are an admin.`,
                );
                if (done) setPending(null);
                break;
            }
            case 'regenerate': {
                const done = await run(() => clan.regeneratePassword(), 'New join password generated. The old one is dead.');
                if (done) {
                    setPending(null);
                    setRevealed(true);
                }
                break;
            }
            case 'leave': {
                const done = await run(() => clan.leave(), 'You left the clan.');
                if (done) {
                    setPending(null);
                    onLeft?.();
                }
                break;
            }
            case 'delete': {
                const done = await run(() => clan.remove(), 'The clan was deleted.');
                if (done) {
                    setPending(null);
                    onDeleted?.();
                }
                break;
            }
        }
    }

    /* -------------------------------------------------------------------------------------- *
     * Nothing to administer
     * -------------------------------------------------------------------------------------- */

    // No backend, signed out, a shared profile, or this profile is in no clan: there is no clan to
    // run, so this component renders nothing at all rather than an explanation of itself. The
    // surfaces that own those states (sign-in, CreateClanForm) say what to do instead.
    if (clan.status !== 'ready' || !clanRow || !role || !membership) return null;

    const password = clan.password;

    return (
        <div className={cn('space-y-4', className)}>
            {/* ---- identity ------------------------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-secondary/60 p-4">
                <ClanBadge badge={badge} size={48} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className="whitespace-nowrap overflow-hidden text-clip text-xl font-black text-white">{clanRow.name}</span>
                        <span className="font-mono text-sm text-accent-primary">[{clanRow.tag}]</span>
                        <RoleChip role={role} />
                    </div>
                    <div className="mt-0.5 text-xs text-text-secondary">
                        {memberCount} / {clanRow.member_cap} members ·{' '}
                        {clanRow.join_policy === 'request'
                            ? 'the password puts people on a waiting list'
                            : 'the password lets people in straight away'}
                        {clan.live && <span className="ml-2 text-green-400">live</span>}
                    </div>
                </div>
            </div>

            {feedback && (
                <p
                    role="status"
                    className={cn(
                        'flex items-start gap-2 rounded-xl border p-3 text-sm',
                        feedback.tone === 'ok'
                            ? 'border-green-500/40 bg-green-500/10 text-green-200'
                            : 'border-red-500/40 bg-red-500/10 text-red-200',
                    )}
                >
                    {feedback.tone === 'ok' ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{feedback.text}</span>
                </p>
            )}

            {/* ---- the join password: owner + admin only ------------------------------- */}
            {canSeePassword && (
                <Section
                    icon={<KeyRound className="h-4 w-4" />}
                    title="Join password"
                    hint="Members join with the clan name, the tag and this password. Only you and your admins can see it."
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <code
                            data-testid="join-password-slot"
                            className={cn(
                                'min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-sm',
                                revealed && password ? 'select-all break-all text-white' : 'text-text-muted',
                            )}
                        >
                            {revealed && password ? password : '••••••••••••'}
                        </code>
                        <Button variant="secondary" size="sm" onClick={() => void reveal()} disabled={clan.passwordLoading}>
                            {clan.passwordLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : revealed ? (
                                <>
                                    <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Hide
                                </>
                            ) : (
                                <>
                                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Show
                                </>
                            )}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void copyPassword()}>
                            {copied ? (
                                <>
                                    <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                                </>
                            )}
                        </Button>
                    </div>
                    {!password && (
                        <p className="mt-2 text-xs text-text-muted">
                            Nothing is fetched until you ask: the password is never loaded into the page on its own,
                            and Copy puts it on your clipboard without putting it on screen.
                        </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setEditingPassword(open => !open);
                                setDraftPassword('');
                            }}
                        >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            {editingPassword ? 'Cancel edit' : 'Set my own'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setPending({ kind: 'regenerate' })}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Generate a new one
                        </Button>
                    </div>

                    {editingPassword && (
                        <div className="mt-3 rounded-lg border border-border bg-bg-input/50 p-3">
                            <label className="block">
                                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-text-secondary">
                                    New join password
                                </span>
                                <input
                                    type="text"
                                    value={draftPassword}
                                    onChange={e => setDraftPassword(e.target.value)}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    placeholder={`${JOIN_PASSWORD_MIN_LENGTH}–${JOIN_PASSWORD_MAX_LENGTH} characters`}
                                    className="h-10 w-full rounded-lg border border-border bg-bg-input px-3 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                                />
                            </label>
                            <p className="mt-1.5 text-xs text-text-muted">
                                {JOIN_PASSWORD_MIN_LENGTH}–{JOIN_PASSWORD_MAX_LENGTH} characters, no line breaks.
                                Leading and trailing spaces are dropped. The old password stops working immediately.
                            </p>
                            <div className="mt-2 flex justify-end">
                                <Button
                                    size="sm"
                                    onClick={() => void savePassword()}
                                    disabled={working || !draftPassword.trim()}
                                >
                                    {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                    Save password
                                </Button>
                            </div>
                        </div>
                    )}
                </Section>
            )}

            {/* ---- emblem: owner + admin only ----------------------------------------- */}
            {isLeader && (
                <Section
                    icon={<Palette className="h-4 w-4" />}
                    title="Emblem"
                    hint="Shape, symbol and their colours — the same set the game offers, nothing else."
                >
                    <div className="flex flex-wrap items-center gap-3">
                        <ClanBadge badge={effectiveBadgeDraft} size={40} />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setBadgeOpen(open => !open);
                                if (!badgeOpen) setBadgeDraft(badge);
                            }}
                        >
                            {badgeOpen ? 'Close' : 'Change emblem'}
                        </Button>
                        {badgeDirty && (
                            <Button size="sm" onClick={() => void saveBadge()} disabled={working}>
                                {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                Save emblem
                            </Button>
                        )}
                    </div>
                    {badgeOpen && (
                        <ClanBadgePicker
                            className="mt-3"
                            value={effectiveBadgeDraft}
                            onChange={setBadgeDraft}
                        />
                    )}
                </Section>
            )}

            {/* ---- guild tier: the panel for everybody, the control for the owner alone --- */}
            <div className="space-y-2">
                <ClanTierPanel
                    action={
                        isOwner ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    setTierOpen(open => !open);
                                    setTierDraft(undefined);
                                }}
                            >
                                <Swords className="mr-1.5 h-3.5 w-3.5" />
                                {tierOpen ? 'Close' : currentTier ? 'Change tier' : 'Set tier'}
                            </Button>
                        ) : undefined
                    }
                />

                {/* An admin or a member never reaches this: no control, not a disabled one. The
                    server would refuse them with 42501 anyway, which is the real boundary. */}
                {isOwner && tierOpen && (
                    <div className="rounded-xl border border-border bg-bg-input/50 p-3">
                        <p className="text-xs text-text-secondary">
                            Pick the tier your guild is in right now, off the guild screen in game.
                            This is a note to yourselves: it changes nothing in game, and it does not
                            move on its own when you win or lose a war. It only decides which numbers
                            this app shows you, so a wrong one here is a wrong reward list and a wrong
                            answer to &ldquo;what does a defeat cost us&rdquo;.
                        </p>
                        <TierOptions
                            className="mt-2.5"
                            value={effectiveTierDraft}
                            onChange={setTierDraft}
                            disabled={working}
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                            {tierDirty && effectiveTierDraft === null && (
                                <span className="mr-auto text-xs text-amber-300">
                                    Clearing it puts the clan back to no recorded tier. That is a real
                                    state, not a blank: nothing will be shown for war rewards until
                                    somebody sets it again.
                                </span>
                            )}
                            <Button size="sm" onClick={() => void saveTier()} disabled={working || !tierDirty}>
                                {working ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                {effectiveTierDraft === null ? 'Clear the tier' : `Save tier ${effectiveTierDraft}`}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ---- pending join requests: leaders only -------------------------------- */}
            {isLeader && requests.length > 0 && (
                <Section
                    icon={<UserCheck className="h-4 w-4" />}
                    title={`Waiting to join (${requests.length})`}
                    hint="They typed the right password; this clan asks a leader to approve each one. A pending request carries no profile name — the name only arrives with the membership."
                >
                    <ul className="space-y-2">
                        {requests.map(request => (
                            <li
                                key={request.profile_id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg-input/40 p-2.5"
                            >
                                <span className="min-w-0 text-sm text-text-secondary">
                                    Someone asked to join{' '}
                                    <span className="text-text-muted">
                                        · {new Date(request.created_at).toLocaleString()}
                                    </span>
                                </span>
                                <span className="flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() =>
                                            void run(() => clan.approve(request.profile_id), 'Request approved.')
                                        }
                                        disabled={working}
                                    >
                                        <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Approve
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => void run(() => clan.deny(request.profile_id), 'Request denied.')}
                                        disabled={working}
                                    >
                                        <UserX className="mr-1.5 h-3.5 w-3.5" /> Deny
                                    </Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {/* ---- roster ------------------------------------------------------------- */}
            <Section
                icon={<ShieldCheck className="h-4 w-4" />}
                title={`Members (${memberCount}/${clanRow.member_cap})`}
                hint={
                    canManageRoles
                        ? 'You are the owner: you alone promote, demote, hand the clan over and remove anybody.'
                        : role === 'admin'
                            ? 'As an admin you can remove plain members. Only the owner changes roles.'
                            : undefined
                }
            >
                <ul className="space-y-2">
                    {sortedRoster.map(member => (
                        <MemberRow
                            key={member.profile_id}
                            member={member}
                            viewerRole={role}
                            isSelf={member.profile_id === membership.profile_id}
                            canManageRoles={canManageRoles}
                            canKickThem={canKick(member.role)}
                            busy={working}
                            onAct={setPending}
                        />
                    ))}
                </ul>
            </Section>

            {/* ---- the exits ---------------------------------------------------------- */}
            <Section
                icon={<LogOut className="h-4 w-4" />}
                title="Leaving"
                hint="Your seat is yours: nobody keeps you in a clan."
            >
                <div className="space-y-3">
                    {mustTransferBeforeLeaving ? (
                        // Not hidden, and not a dead button: the owner is told exactly what to do
                        // first. The server enforces the same thing (`needs-owner-transfer`).
                        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                            <Info className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                                You are the owner and this clan has other members, so you cannot just leave — a clan
                                is never ownerless. Hand it to somebody in the list above first (their row has a
                                &ldquo;Make owner&rdquo; button), then leave. Alternatively, delete the clan.
                            </span>
                        </p>
                    ) : (
                        canLeave && (
                            <div className="flex flex-wrap items-center gap-3">
                                <Button variant="secondary" size="sm" onClick={() => setPending({ kind: 'leave' })}>
                                    <LogOut className="mr-1.5 h-3.5 w-3.5" /> Leave clan
                                </Button>
                                {isOnlyMember && (
                                    <span className="text-xs text-amber-300">
                                        You are the only member — leaving deletes the clan.
                                    </span>
                                )}
                            </div>
                        )
                    )}

                    {canDeleteClan && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                            <div className="text-sm font-bold text-red-300">Delete the clan</div>
                            <p className="mt-1 text-xs text-text-secondary">
                                Removes every membership, the shared tech tree and the join password, and frees the
                                name and tag. Members keep their own profiles. It cannot be undone.
                            </p>
                            <Button
                                size="sm"
                                className="mt-2 bg-gradient-to-br from-red-600 to-red-700"
                                onClick={() => setPending({ kind: 'delete' })}
                            >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete {clanRow.name}
                            </Button>
                        </div>
                    )}
                </div>
            </Section>

            {pending && shape && (
                <ConfirmDialog
                    // Keyed on the action: a different confirmation is a different component
                    // instance, so a type-to-confirm phrase can never be inherited from the last one.
                    key={pending.kind}
                    shape={shape}
                    busy={working}
                    onConfirm={() => void confirmPending()}
                    onCancel={() => setPending(null)}
                />
            )}
        </div>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * One roster row
 * ------------------------------------------------------------------------------------------ */

interface MemberRowProps {
    member: ClanRosterDetailRow;
    viewerRole: ClanRole;
    isSelf: boolean;
    canManageRoles: boolean;
    /** Already the context's `canKick(member.role)` — the hierarchy is not re-derived here. */
    canKickThem: boolean;
    busy: boolean;
    onAct: (pending: Pending) => void;
}

/**
 * A member, plus exactly the actions the viewer's role can actually perform against them.
 *
 * The gates, spelled out because the asymmetry is the whole point:
 *   - role changes and ownership transfer need `canManageRoles` (owner only) and a non-owner target;
 *   - removal needs `canKick(theirRole)` (owner: anyone but themself; admin: members only) and, for
 *     the viewer's own row, nothing at all — leaving is a different action with a different rule, and
 *     `kick_member()` refuses a self-kick anyway;
 *   - an admin looking at the owner or at another admin gets NO buttons. Not greyed out: absent.
 */
function MemberRow({ member, viewerRole, isSelf, canManageRoles, canKickThem, busy, onAct }: MemberRowProps) {
    const isOwnerRow = member.role === 'owner';
    const showRoleActions = canManageRoles && !isOwnerRow && !isSelf;
    const showKick = canKickThem && !isSelf;
    const shares = !!member.clan_share;

    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-bg-input/40 p-2.5">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="whitespace-nowrap overflow-hidden text-clip text-sm font-bold text-text-primary">{member.name}</span>
                    <RoleChip role={member.role} />
                    {isSelf && (
                        <span className="rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-accent-primary">
                            You
                        </span>
                    )}
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted">
                    Power {member.power === null ? '—' : formatCompactNumber(member.power)} · joined{' '}
                    {new Date(member.joined_at).toLocaleDateString()}
                    {shares ? ' · sharing war data' : ' · no war data shared'}
                </div>
            </div>

            {/* Render only what this role can do. An admin sees nothing next to a leader. */}
            <div className="flex flex-wrap gap-1.5">
                {showRoleActions && member.role === 'member' && (
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => onAct({ kind: 'promote', profileId: member.profile_id, name: member.name })}
                    >
                        <Shield className="mr-1.5 h-3.5 w-3.5" /> Make admin
                    </Button>
                )}
                {showRoleActions && member.role === 'admin' && (
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => onAct({ kind: 'demote', profileId: member.profile_id, name: member.name })}
                    >
                        <UserMinus className="mr-1.5 h-3.5 w-3.5" /> Demote
                    </Button>
                )}
                {showRoleActions && (
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => onAct({ kind: 'handover', profileId: member.profile_id, name: member.name })}
                    >
                        <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" /> Make owner
                    </Button>
                )}
                {showKick && (
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        className="border-red-500/40 text-red-300 hover:border-red-500 hover:text-red-200"
                        onClick={() =>
                            onAct({ kind: 'kick', profileId: member.profile_id, name: member.name, role: member.role })
                        }
                    >
                        <UserX className="mr-1.5 h-3.5 w-3.5" /> Remove
                    </Button>
                )}
                {/* The owner's own row, seen by the owner: say why there is nothing here. */}
                {isSelf && isOwnerRow && viewerRole === 'owner' && (
                    <span className="text-[11px] text-text-muted">Owners cannot be removed</span>
                )}
            </div>
        </li>
    );
}

export default ClanAdminPanel;
