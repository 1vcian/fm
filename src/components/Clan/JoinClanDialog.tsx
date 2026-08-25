/**
 * JoinClanDialog — name + tag + password, because that is the join contract.
 * =========================================================================
 *
 * THE THREE FIELDS ARE NOT A DESIGN CHOICE
 * ---------------------------------------
 * `join_clan(p_name, p_tag, p_password, p_profile_id)` is the only path to a membership: 0005 §6
 * revoked `INSERT` on `clan_members` from `authenticated`, and `join_policy = 'open'` stopped
 * existing in the same migration. So a join needs the clan's name, its tag and its password, all
 * three, and there is no invite link, no clan id and no "request to join" button that skips the
 * password.
 *
 * A WRONG PASSWORD IS A RESULT, NOT AN EXCEPTION
 * ---------------------------------------------
 * The RPC **returns** `{"status":"failed"}` for a wrong name, a wrong tag and a wrong password
 * alike — one single-key object, after the same constant delay — and it commits, because a `raise`
 * would roll back its own brute-force counter (0003 §3 has the measurement). Two consequences this
 * dialog is built around:
 *
 *   * the message for `failed` is deliberately ambiguous ("name, tag or password is wrong"). The
 *     server refuses to say which, so that the RPC cannot be used as an oracle for "does this clan
 *     exist" or "is this password right", and the UI must not undo that by guessing. Do not add a
 *     "no clan with that name" branch here: the information is not in the response, on purpose.
 *   * `{"status":"rate_limited", "retry_after_seconds": N}` is a FIRST-CLASS STATE, not an error
 *     toast: twelve attempts per ten minutes per account, and the password is not even evaluated
 *     while the limiter is on, so a correct password gets this too. It gets a live countdown and a
 *     submit button that is off until the window ends. Hammering does not extend it.
 *
 * THE JOIN TARGETS ONE PROFILE, AND IT SAYS WHICH
 * ----------------------------------------------
 * Membership is the triplet (clan, profile, user) and `clan_members`' primary key is `profile_id`:
 * one clan per PROFILE, so two profiles of the same account can be in different clans. A user with
 * several profiles who joins with the wrong one has to leave (and, if they were the owner, hand the
 * clan over) to undo it. So the profile that is about to join is named in the dialog, by name,
 * above the button — and the three states where a submit could only ever fail (a shared profile, a
 * profile that is already in a clan, no session) are explained instead of being offered.
 *
 * VALIDATION IS THE GAME'S OWN, AND IT IS HERE TO SAVE RATE-LIMIT SLOTS
 * -------------------------------------------------------------------
 * The limits come from `GuildBaseConfig.json` through `useGameData` — `MaxGuildNameLength`,
 * `MaxGuildTagLength`, `NameValidationRegex`, `TagValidationRegex` — with the constants in
 * `clanApi` as the fallback for a config version that lacks them. That matters because
 * `note_join_attempt()` counts an attempt **before** the credentials are compared: a name with a
 * character the schema cannot store would spend one of twelve slots to be told "failed". The
 * password itself is NOT length-checked here — `set_join_password()` enforces 12–64 when a password
 * is SET, but a clan whose password predates that rule may hold a shorter one, and refusing to send
 * it would lock its members out of their own clan.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    Check,
    Hourglass,
    Info,
    KeyRound,
    Loader2,
    LogIn,
    Timer,
    UserPlus,
    Users,
    X,
} from 'lucide-react';
import { Button } from '../UI/Button';
import { cn } from '../../lib/utils';
import { useClan } from '../../context/ClanContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import {
    CLAN_NAME_MAX_LENGTH,
    CLAN_NAME_PATTERN,
    CLAN_TAG_MAX_LENGTH,
    CLAN_TAG_PATTERN,
    type ClanError,
    type JoinClanOutcome,
} from '../../services/clanApi';

export interface JoinClanDialogProps {
    /** Pre-filled from the row the user picked in `<ClanBrowser>`. Still editable by hand. */
    initialName?: string;
    initialTag?: string;
    onClose: () => void;
    /**
     * The join landed (`joined`) or was filed for approval (`requested`). The dialog reports and
     * stops there — refreshing whatever else is on screen is the caller's business.
     */
    onJoined?: (outcome: Extract<JoinClanOutcome, { status: 'joined' | 'requested' }>) => void;
}

/** What `GuildBaseConfig.json` gives us. Every field optional: an older version may lack any of them. */
interface GuildBaseConfig {
    MaxGuildNameLength?: number;
    MaxGuildTagLength?: number;
    NameValidationRegex?: string;
    TagValidationRegex?: string;
}

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The game's regexes arrive as strings. A version with a pattern JS cannot compile falls back. */
function compilePattern(source: string | undefined, fallback: RegExp): RegExp {
    if (!source) return fallback;
    try {
        return new RegExp(source);
    } catch {
        return fallback;
    }
}

function mmss(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------------------------------ *
 * The dialog
 * ------------------------------------------------------------------------------------------ */

export const JoinClanDialog: React.FC<JoinClanDialogProps> = ({
    initialName = '',
    initialTag = '',
    onClose,
    onJoined,
}) => {
    const { status, isSharedProfile, membership, clan, join, busy, refresh } = useClan();
    const { profile } = useProfile();
    const { data: baseConfig } = useGameData<GuildBaseConfig>('GuildBaseConfig.json');

    const nameMax = Math.max(1, Math.round(baseConfig?.MaxGuildNameLength ?? CLAN_NAME_MAX_LENGTH));
    const tagMax = Math.max(1, Math.round(baseConfig?.MaxGuildTagLength ?? CLAN_TAG_MAX_LENGTH));
    const namePattern = useMemo(
        () => compilePattern(baseConfig?.NameValidationRegex, CLAN_NAME_PATTERN),
        [baseConfig?.NameValidationRegex],
    );
    const tagPattern = useMemo(
        () => compilePattern(baseConfig?.TagValidationRegex, CLAN_TAG_PATTERN),
        [baseConfig?.TagValidationRegex],
    );

    const [name, setName] = useState(initialName.slice(0, CLAN_NAME_MAX_LENGTH));
    const [tag, setTag] = useState(initialTag.toUpperCase().slice(0, CLAN_TAG_MAX_LENGTH));
    const [password, setPassword] = useState('');
    const [showErrors, setShowErrors] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    /** The neutral "that did not match" line, or a real server error. Never both. */
    const [rejected, setRejected] = useState(false);
    const [error, setError] = useState<ClanError | null>(null);
    /** Epoch ms the join limiter's window ends, or `null`. */
    const [retryAt, setRetryAt] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [done, setDone] = useState<Extract<JoinClanOutcome, { status: 'joined' | 'requested' }> | null>(null);

    /* ---------------------------------- the countdown ---------------------------------- */
    // A wall-clock deadline plus a ticker, rather than a decrementing counter: a background tab
    // throttles timers, and a counter would then still be showing "8:12" a quarter of an hour later.
    useEffect(() => {
        if (retryAt === null) return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [retryAt]);
    const waitSeconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
    const rateLimited = waitSeconds > 0;
    // The window closed: drop the deadline so the ticker stops and the panel goes away on its own.
    useEffect(() => {
        if (retryAt !== null && waitSeconds === 0) setRetryAt(null);
    }, [retryAt, waitSeconds]);

    /* ------------------------------- focus trap and Escape ------------------------------- */
    const panelRef = useRef<HTMLDivElement | null>(null);
    // Keeping the callbacks in refs is what lets the trap be installed ONCE. Re-installing it on
    // every render would move focus back into the dialog on each keystroke.
    const onCloseRef = useRef(onClose);
    const blockedRef = useRef(false);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const node = panelRef.current;

        const focusables = (): HTMLElement[] => {
            if (!node) return [];
            return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                el => el.offsetParent !== null || el === document.activeElement,
            );
        };

        (node?.querySelector<HTMLElement>('[data-autofocus="true"]') ?? focusables()[0])?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (!node) return;
            if (event.key === 'Escape') {
                // Closing mid-request would hide the outcome of a join that is already committing.
                if (blockedRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
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

    /* --------------------------------- what is possible --------------------------------- */

    /**
     * The states where a submit could only ever fail. Each one is EXPLAINED rather than offered:
     * the form is not rendered at all, because a filled-in form that cannot be sent is worse than
     * no form.
     */
    const blocker: 'no-backend' | 'signed-out' | 'shared-profile' | 'in-a-clan' | null =
        status === 'unconfigured' ? 'no-backend'
            : isSharedProfile ? 'shared-profile'
                : status === 'signed-out' ? 'signed-out'
                    : membership ? 'in-a-clan'
                        : null;

    // Membership is still being resolved: the fields are usable, the button waits. Without this a
    // profile that IS in a clan could be shown a joinable form for a moment.
    const checking = status === 'loading';
    const inFlight = submitting || busy;
    // Read by the Escape handler, which is installed once and therefore cannot close over this.
    useEffect(() => { blockedRef.current = inFlight; }, [inFlight]);

    const trimmedName = name.trim();
    const trimmedTag = tag.trim();

    const nameError = !trimmedName
        ? 'Enter the clan name, exactly as it is in game.'
        : trimmedName.length > nameMax
            ? `At most ${nameMax} characters.`
            : !namePattern.test(trimmedName)
                ? "Letters, digits, spaces and ' & - _ only."
                : null;

    const tagError = !trimmedTag
        ? 'Enter the clan tag.'
        : trimmedTag.length > tagMax
            ? `At most ${tagMax} characters.`
            : !tagPattern.test(trimmedTag)
                ? 'A–Z, 0–9, - and _ only.'
                : null;

    // No length rule: an old clan's password may be shorter than today's 12-character minimum.
    const passwordError = password.length === 0 ? "Enter the clan's join password." : null;

    const formValid = !nameError && !tagError && !passwordError;
    /** May the request actually be sent? */
    const sendable = !blocker && !checking && formValid && !inFlight && !rateLimited && !done;
    /**
     * The button is NOT disabled for an invalid form. A dead button with no explanation is the
     * worst of the three options: pressing it reveals which field is wrong, and `submit()` refuses
     * to send, so an obviously invalid attempt still cannot spend one of the twelve rate-limit
     * slots. It IS disabled while a request is in flight and while the limiter's window is open,
     * because in those two cases pressing it again cannot help and the reason is on screen.
     */
    const submitDisabled = inFlight || rateLimited || checking || !!done;

    const submit = useCallback(async () => {
        setShowErrors(true);
        if (!sendable) return;

        setRejected(false);
        setError(null);
        setSubmitting(true);
        try {
            const result = await join({ name: trimmedName, tag: trimmedTag, password });
            if (!result.ok) {
                // The genuine impossibilities that still raise: no session, not your profile,
                // already in a clan, clan full.
                setError(result.error);
                if (result.error.kind === 'rate-limited' && result.error.retryAfterSeconds) {
                    setRetryAt(Date.now() + result.error.retryAfterSeconds * 1000);
                }
                // "already in a clan" / "not your profile" are the server telling us our own
                // membership state is stale — this dialog only exists for a profile we believe is
                // clanless. Go and re-read it, so the surface moves on instead of leaving the user
                // at a dead end they cannot act on. The server wins.
                if (result.error.kind === 'already-in-a-clan' || result.error.kind === 'not-your-profile') {
                    await refresh();
                }
                return;
            }
            const outcome = result.data;
            switch (outcome.status) {
                case 'joined':
                case 'requested':
                    setDone(outcome);
                    setPassword('');
                    onJoined?.(outcome);
                    break;
                case 'rate_limited': {
                    // Clamped: the server sends <= 600, and a nonsense value must not produce a
                    // dialog that can never be used again.
                    const seconds = Math.min(3600, Math.max(1, Math.round(outcome.retry_after_seconds || 1)));
                    setRetryAt(Date.now() + seconds * 1000);
                    break;
                }
                case 'failed':
                default:
                    setRejected(true);
                    // Wipe the password so a typo is retyped rather than resubmitted — and stop
                    // showing field errors, so the empty field does not shout on top of the
                    // rejection panel.
                    setPassword('');
                    setShowErrors(false);
                    break;
            }
        } finally {
            setSubmitting(false);
        }
    }, [sendable, join, refresh, trimmedName, trimmedTag, password, onJoined]);

    /* -------------------------------------- render -------------------------------------- */

    const profileName = profile?.name || 'this profile';

    const field = (
        id: string,
        label: string,
        value: string,
        onChange: (v: string) => void,
        options: {
            error: string | null;
            hint?: string;
            max?: number;
            type?: string;
            autoFocus?: boolean;
            autoComplete?: string;
            mono?: boolean;
            placeholder?: string;
        },
    ) => {
        const showError = showErrors && !!options.error;
        return (
            <div>
                <label htmlFor={id} className="block text-xs font-bold text-text-secondary mb-1.5">
                    {label}
                </label>
                <input
                    id={id}
                    type={options.type ?? 'text'}
                    value={value}
                    maxLength={options.max}
                    autoComplete={options.autoComplete ?? 'off'}
                    spellCheck={false}
                    placeholder={options.placeholder}
                    disabled={inFlight || !!done}
                    data-autofocus={options.autoFocus ? 'true' : undefined}
                    onChange={e => onChange(e.target.value)}
                    aria-invalid={showError || undefined}
                    aria-describedby={showError ? `${id}-error` : options.hint ? `${id}-hint` : undefined}
                    /* Explicit text colour on every input: this project has shipped
                       black-text-on-black-background more than once. */
                    className={cn(
                        'w-full h-10 rounded-lg border bg-bg-input px-3 text-sm text-white placeholder:text-text-muted',
                        'focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary',
                        'disabled:opacity-50',
                        options.mono && 'font-mono tracking-wide',
                        showError ? 'border-accent-secondary' : 'border-border',
                    )}
                />
                {showError ? (
                    <p id={`${id}-error`} className="mt-1 text-[11px] text-accent-secondary">{options.error}</p>
                ) : options.hint ? (
                    <p id={`${id}-hint`} className="mt-1 text-[11px] text-text-muted">{options.hint}</p>
                ) : null}
            </div>
        );
    };

    const blockerPanel = () => {
        switch (blocker) {
            case 'no-backend':
                return {
                    icon: <Users className="w-5 h-5" />,
                    title: 'Clans are not available in this build',
                    body: 'This copy of the app has no server configured, so there are no accounts and no clans to join. Everything else keeps working locally.',
                };
            case 'signed-out':
                return {
                    icon: <LogIn className="w-5 h-5" />,
                    title: 'Sign in first',
                    body: 'Joining a clan needs an account: the clan is stored on the server and the membership belongs to one of your profiles.',
                };
            case 'shared-profile':
                return {
                    icon: <Info className="w-5 h-5" />,
                    title: 'This is a shared profile',
                    body: 'A profile opened from a share link is not yours and is never in a clan — membership never travels inside a profile. Save it as your own profile first, then join with that one.',
                };
            case 'in-a-clan':
                return {
                    icon: <Users className="w-5 h-5" />,
                    title: `${profileName} is already in a clan`,
                    body: clan
                        ? `This profile belongs to ${clan.name} [${clan.tag}]. One clan per profile: leave that one first, or switch to another profile and join with it.`
                        : 'One clan per profile: leave that one first, or switch to another profile and join with it.',
                };
            default:
                return null;
        }
    };

    const panel = blockerPanel();

    return createPortal(
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
            onClick={e => { if (e.target === e.currentTarget && !inFlight) onClose(); }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="join-clan-title"
                className="bg-bg-primary w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-5 pb-4 border-b border-border">
                    <div className="min-w-0">
                        <h3 id="join-clan-title" className="text-lg font-black text-white flex items-center gap-2">
                            <UserPlus className="w-5 h-5 text-accent-primary shrink-0" />
                            Join a clan
                        </h3>
                        <p className="text-xs text-text-secondary mt-1">
                            Name, tag and the clan&apos;s join password — the same three the game asks for.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={inFlight}
                        /* Explicit focus ring: the trap focuses something on mount, and the
                           browser's default outline is a blue that belongs to no other control
                           in this app. */
                        className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-white/10 transition disabled:opacity-40 shrink-0 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {done ? (
                        /* ------------------------------ success ------------------------------ */
                        <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-center">
                            <div className="w-10 h-10 mx-auto rounded-xl bg-green-500/20 text-green-400 flex items-center justify-center mb-3">
                                {done.status === 'joined' ? <Check className="w-5 h-5" /> : <Hourglass className="w-5 h-5" />}
                            </div>
                            <p className="font-bold text-white text-sm">
                                {done.status === 'joined'
                                    ? `${profileName} joined ${done.name} [${done.tag}]`
                                    : `Request sent to ${done.name} [${done.tag}]`}
                            </p>
                            <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
                                {done.status === 'joined'
                                    ? 'You can pull the clan’s shared tech tree into this profile from the clan screen.'
                                    : 'This clan approves new members by hand. A leader has to accept the request before the membership exists.'}
                            </p>
                        </div>
                    ) : panel ? (
                        /* --------------------------- cannot be done -------------------------- */
                        <div className="rounded-xl border border-border bg-bg-secondary/50 p-4 text-center">
                            <div className="w-10 h-10 mx-auto rounded-xl bg-white/5 text-text-secondary flex items-center justify-center mb-3">
                                {panel.icon}
                            </div>
                            <p className="font-bold text-white text-sm">{panel.title}</p>
                            <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{panel.body}</p>
                        </div>
                    ) : (
                        /* ------------------------------- the form ---------------------------- */
                        <form
                            onSubmit={e => { e.preventDefault(); void submit(); }}
                            className="space-y-4"
                            noValidate
                        >
                            {/* Which profile is joining. The triplet is per profile, and a user with
                                several of them would otherwise have no way of knowing. */}
                            <div className="flex items-start gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-3 py-2">
                                <Users className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-primary" />
                                <p className="text-[11px] text-text-secondary leading-relaxed">
                                    Joining as <span className="font-bold text-white">{profileName}</span>. A clan
                                    belongs to one profile, not to your whole account — switch profile first if this is
                                    not the right one.
                                </p>
                            </div>

                            {/* The tag is at most five characters: a fixed narrow column, so the
                                field's width says something true about what goes in it. */}
                            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_10rem] gap-3">
                                {field('join-clan-name', 'Clan name', name, v => setName(v), {
                                    error: nameError,
                                    max: nameMax,
                                    autoFocus: !initialName,
                                    hint: `Up to ${nameMax} characters`,
                                    placeholder: 'Anvil',
                                })}
                                {field('join-clan-tag', 'Tag', tag, v => setTag(v.toUpperCase()), {
                                    error: tagError,
                                    max: tagMax,
                                    mono: true,
                                    // The database upper-cases the tag with a trigger and the game's
                                    // own regex only allows A-Z, so typing lower case here would
                                    // otherwise read as invalid while being perfectly correct.
                                    hint: `Up to ${tagMax}, upper case`,
                                    placeholder: 'ANVL',
                                })}
                            </div>

                            {field('join-clan-password', 'Join password', password, v => setPassword(v), {
                                error: passwordError,
                                type: 'password',
                                autoComplete: 'off',
                                mono: true,
                                autoFocus: !!initialName,
                                hint: 'Ask a clan leader — they are the only ones who can see it.',
                            })}

                            {/* ---- the limiter: a state, not a toast ---- */}
                            {rateLimited && (
                                <div className="flex items-start gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 px-3 py-2.5">
                                    <Timer className="w-4 h-4 mt-0.5 shrink-0 text-accent-primary" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white">
                                            Too many attempts — try again in{' '}
                                            <span className="font-mono tabular-nums">{mmss(waitSeconds)}</span>
                                        </p>
                                        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">
                                            The server allows twelve join attempts every ten minutes per account, and it
                                            stops checking the password while the limit is on — so even the right one
                                            would be refused. Waiting is the only thing that helps; retrying does not
                                            make it longer.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* ---- the deliberately ambiguous rejection ---- */}
                            {rejected && !rateLimited && (
                                <div className="flex items-start gap-2 rounded-lg border border-accent-secondary/40 bg-accent-secondary/10 px-3 py-2.5">
                                    <KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-accent-secondary" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white">
                                            That name, tag or password is not right
                                        </p>
                                        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">
                                            The server answers the same way for all three, on purpose, so that nobody can
                                            use this box to find out which clans exist. Check all three with a clan
                                            leader — the tag has to match exactly.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* ---- a real failure ---- */}
                            {error && error.kind !== 'rate-limited' && (
                                <div className="flex items-start gap-2 rounded-lg border border-accent-secondary/40 bg-accent-secondary/10 px-3 py-2.5">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-accent-secondary" />
                                    <p className="text-xs text-text-secondary leading-relaxed">{error.message}</p>
                                </div>
                            )}

                            {checking && (
                                <p className="flex items-center gap-2 text-[11px] text-text-muted">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Checking whether this profile is already in a clan
                                </p>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <Button type="button" variant="outline" onClick={onClose} disabled={inFlight}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={submitDisabled}>
                                    {inFlight
                                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Joining</>
                                        : rateLimited
                                            ? <>Wait {mmss(waitSeconds)}</>
                                            : 'Join clan'}
                                </Button>
                            </div>
                        </form>
                    )}

                    {(done || panel) && (
                        <div className="flex justify-end">
                            {/* The only action left, so it takes the initial focus instead of the
                                header's close cross. */}
                            <Button onClick={onClose} data-autofocus="true">
                                {done ? 'Done' : 'Close'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default JoinClanDialog;
