/**
 * AccountPanel — the only place in the app that talks about accounts.
 *
 * It renders **nothing at all** when the build has no `VITE_SUPABASE_*` configured. That is not a
 * fallback, it is the requirement: with no backend the app must look and behave exactly as it did
 * before accounts existed, so there is no disabled button, no greyed-out pill, no hint of a
 * feature that cannot work.
 *
 * With a backend configured it has three faces:
 *
 *   signed out   a one-line invitation that expands into the magic-link form. Collapsed by
 *                default — profiles already work without an account, so this must not look like a
 *                gate in front of the page.
 *   signed in    the address, a sign-out, the sync indicator, and the two manual controls that
 *                matter ("Sync now", and the link to whatever is still waiting — a difference to
 *                settle, or a profile that is not in the account).
 *   deciding     the merge screen (first login, a divergence, or profiles the user chose to keep in
 *                this browser) and the conflict dialog. Both are mounted from here because both are
 *                answers to "what should happen to my data", which is this panel's whole subject.
 */

import { useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    UploadCloud,
    GitBranch,
    Info,
    LogOut,
    RefreshCw,
    UserCircle2,
} from 'lucide-react';
import { Button } from '../UI/Button';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { SignInForm } from '../Auth/SignInForm';
import { SyncIndicator, relativeTime } from '../Auth/SyncIndicator';
import { MergeDialog } from '../Auth/MergeDialog';
import { ConflictDialog } from '../Auth/ConflictDialog';
import { ClanSyncPanel } from './ClanSyncPanel';
import { PushPanel } from './PushPanel';

export function AccountPanel() {
    const auth = useAuth();
    const { sync, profile } = useProfile();
    const [expanded, setExpanded] = useState(false);

    // No backend in this build: accounts do not exist, so neither does this panel.
    if (!auth.backendConfigured) return null;

    const signedIn = auth.status === 'signed-in';
    const rows = sync.review ?? [];
    const notUploaded = sync.notUploadedCount;

    /**
     * One link, two things it can be waiting on. When every waiting row is a profile that is simply
     * not in the account, "differences" would be the wrong word: the user reading it has not made
     * any conflicting edit, they have a profile that lives in this browser and a button that offers
     * to upload it.
     *
     * The count falls back to `notUploadedCount` when no rows have been computed yet, and that is
     * only sound because `notUploadedCount` counts *deliberately* kept-local profiles — exactly the
     * ids `computeReview` always turns into rows. So the link can never advertise a screen that
     * `openReview` then fails to produce. (Counting "profiles with no ledger entry" instead would
     * break that: a push that failed two seconds ago has no entry and no row.)
     */
    const uploadOnly = rows.length === 0 ? notUploaded > 0 : rows.every(row => row.kind === 'local-only');
    const waitingCount = rows.length > 0 ? rows.length : notUploaded;

    /**
     * `syncNow()` refuses to run in three states, on purpose. An enabled button that silently
     * declines is worse than a disabled one: the user presses it, nothing visible happens, and the
     * only honest reading is that sync is broken. So the reason is computed here and shown, and it
     * doubles as the disabled condition — one source of truth for "can this be pressed".
     */
    const syncBlockedReason = sync.busy
        ? null // the spinner already says why
        : profile?.isShared
          ? 'You are looking at a shared profile. Save it as your own first. Nothing of someone else’s is ever sent to your account.'
          : sync.conflict
            ? 'Settle the conflict first.'
            : null;

    /**
     * A pending merge is deliberately NOT in `syncBlockedReason`. It used to be, and the button then
     * told the user to "finish the merge screen" while `reviewOpen` was false — a screen they had no
     * way to reopen, with nothing syncing behind it. `syncNow()` now reopens it instead, so the
     * button stays live; this only changes the label so the press is not a surprise.
     */
    const syncLabel = sync.mergePending ? 'Choose what to keep' : 'Sync now';

    return (
        <>
            <div className="rounded-2xl border border-border bg-bg-secondary/50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                    {/* The icon and the identity travel together and take the whole first row below
                        640px. The controls to their right need more width than a phone has, so a
                        plain `flex-1` child collapsed to a few characters and `break-all` then broke
                        the address one letter per line. */}
                    <div className="flex items-center gap-3 min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <UserCircle2 className={`w-5 h-5 shrink-0 ${signedIn ? 'text-accent-primary' : 'text-text-muted'}`} />

                    <div className="min-w-0 flex-1">
                        {auth.status === 'initialising' ? (
                            <span className="text-sm text-text-muted">Checking your session</span>
                        ) : signedIn ? (
                            <span className="text-sm text-text-secondary">
                                Signed in as{' '}
                                <span className="font-semibold text-text-primary break-all">{auth.email}</span>
                            </span>
                        ) : (
                            <span className="text-sm text-text-secondary">
                                <span className="font-semibold text-text-primary">Profiles are saved in this browser.</span>{' '}
                                Sign in to keep a copy in your account and use it on another device.
                            </span>
                        )}
                    </div>
                    </div>

                    <SyncIndicator
                        status={sync.status}
                        message={sync.message}
                        lastSyncedAt={sync.lastSyncedAt}
                        pendingCount={sync.pendingCount}
                    />

                    {signedIn ? (
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void sync.syncNow()}
                                disabled={sync.busy || syncBlockedReason !== null}
                                title={
                                    syncBlockedReason ??
                                    (sync.mergePending
                                        ? 'Reopen the screen that asks what to keep'
                                        : 'Upload your changes now, and ask about anything that is not in your account')
                                }
                            >
                                <UploadCloud className="w-4 h-4 mr-1.5" /> {syncLabel}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void sync.refresh()}
                                disabled={sync.busy}
                                title="Re-read your account and compare"
                            >
                                <RefreshCw className={`w-4 h-4 ${sync.busy ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void auth.signOut()} title="Sign out">
                                <LogOut className="w-4 h-4" />
                            </Button>
                        </div>
                    ) : (
                        <Button variant="secondary" size="sm" onClick={() => setExpanded(v => !v)}>
                            {expanded ? <ChevronUp className="w-4 h-4 mr-1.5" /> : <ChevronDown className="w-4 h-4 mr-1.5" />}
                            Sign in
                        </Button>
                    )}
                </div>

                {/* A sign-in attempt that came back from the mail client with a problem. */}
                {auth.notice && (
                    <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                        <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                        <p className="min-w-0 break-words">{auth.notice}</p>
                        <button
                            onClick={auth.dismissMessages}
                            className="ml-auto text-xs font-semibold text-amber-300/80 hover:text-amber-200 shrink-0"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {!signedIn && expanded && auth.status !== 'initialising' && (
                    <div className="mt-4 pt-4 border-t border-border">
                        <SignInForm />
                    </div>
                )}

                {signedIn && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                        <span>Last synced: {relativeTime(sync.lastSyncedAt)}</span>
                        {sync.message && <span className="text-text-secondary">{sync.message}</span>}
                        {/* Why "Sync now" is greyed out, in words, next to the greyed-out button. */}
                        {syncBlockedReason && <span className="text-amber-300/90">{syncBlockedReason}</span>}
                        {/* Visible without pressing anything: a profile kept out of the account is
                            a fact about the user's data, not a sync state. */}
                        {notUploaded > 0 && (
                            <span className="text-text-secondary">
                                {notUploaded === 1
                                    ? '1 profile is only in this browser.'
                                    : `${notUploaded} profiles are only in this browser.`}
                            </span>
                        )}
                        {waitingCount > 0 && !sync.reviewOpen && (
                            <button
                                onClick={sync.openReview}
                                className="inline-flex items-center gap-1.5 font-semibold text-accent-tertiary hover:underline"
                            >
                                {uploadOnly ? <UploadCloud className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
                                {uploadOnly
                                    ? `Upload ${waitingCount} profile${waitingCount === 1 ? '' : 's'}`
                                    : `Review ${waitingCount} difference${waitingCount === 1 ? '' : 's'}`}
                            </button>
                        )}
                    </div>
                )}

                {/* WHY CLAN SYNC AND NOTIFICATIONS LIVE INSIDE THE ACCOUNT BOX.
                    Both are settings about what this browser sends to, or receives from, the server,
                    and neither can do anything without an account: `ClanSyncPanel` publishes a summary
                    to a clan, `PushPanel` registers a device against a signed-in user. Standing on
                    their own further down the page they read as general app settings, which invites
                    somebody to look for them before signing in and conclude they are missing. Here
                    they appear the moment there is an account to attach them to, and vanish with it.
                    Both still keep their own internal gates, so this nesting is belt and braces. */}
                {signedIn && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {/* Side by side from 1280px up. Stacked they were two full-width strips of
                            mostly empty space, which is the whole height of this block. */}
                        <ClanSyncPanel />
                        <PushPanel />
                    </div>
                )}
            </div>

            {sync.reviewOpen && sync.review && sync.review.length > 0 && (
                <MergeDialog
                    rows={sync.review}
                    busy={sync.busy}
                    firstLogin={sync.mergePending}
                    onChoose={sync.setReviewChoice}
                    onApply={() => void sync.applyReview()}
                    onClose={sync.closeReview}
                />
            )}

            {sync.conflict && (
                <ConflictDialog
                    conflict={sync.conflict}
                    busy={sync.busy}
                    onResolve={resolution => void sync.resolveConflict(resolution)}
                />
            )}
        </>
    );
}
