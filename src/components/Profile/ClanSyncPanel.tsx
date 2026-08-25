/**
 * ClanSyncPanel — the one control over what this profile sends to its clan, and what it takes back.
 *
 * WHY IT IS NOT CALLED "AUTOSYNC". In this codebase "AutoSync" already means the SCREENSHOT SCANNER
 * (`src/utils/ocr/`, `AutoSyncModal.tsx`, the "Scan clan tree" button two rows below this panel):
 * a camera-to-profile reader that has nothing to do with the network. Reusing the word for a server
 * setting would leave the Tech Tree header carrying two unrelated "AutoSync"s side by side. "Clan
 * sync" says who the other party is, which is the only thing that distinguishes this from the
 * account sync in `AccountPanel` and from the scanner.
 *
 * IT RENDERS NOTHING WITHOUT A BACKEND. Not a disabled switch, not a greyed-out row: with no
 * `VITE_SUPABASE_*` there are no clans, so a setting about clans is not a feature that is off — it
 * is a feature that does not exist. Same rule, and the same reason, as `AccountPanel`.
 *
 * THE LABEL NAMES BOTH DIRECTIONS, because the switch governs both and a user who reads only the
 * title must not be surprised by the half they did not think they were agreeing to:
 *   out   this profile's summary (trees, resources, war points) is published to its clan;
 *   in    this profile's clan tech tree follows the row the clan's leaders publish.
 *
 * OFF is a statement about the user's data, so it is written as one: what stops being sent, what
 * clan mates see instead, and what stops arriving. Turning it off goes through `stopSharing()` and
 * not through the plain setter, because a summary already on the server has to be CLEARED — left
 * behind it would keep being read, and keep looking current while going stale.
 */

import { useState } from 'react';
import { Loader2, Users, X, ArrowDownToLine, AlertTriangle } from 'lucide-react';
import { Card } from '../UI/Card';
import { useAuth } from '../../context/AuthContext';
import { useClan } from '../../context/ClanContext';
import { relativeTime } from '../Auth/SyncIndicator';
import { cn } from '../../lib/utils';

export function ClanSyncPanel() {
    const { backendConfigured } = useAuth();
    const clan = useClan();
    const [working, setWorking] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    // No backend in this build (or no ClanProvider above us, which behaves identically on purpose):
    // clans do not exist here, so neither does this panel.
    if (!backendConfigured || clan.status === 'unconfigured') return null;

    const on = clan.clanSyncEnabled;
    const clanName = clan.clan ? `${clan.clan.name} [${clan.clan.tag}]` : null;

    const toggle = async () => {
        setFailure(null);
        if (!on) {
            clan.setClanSyncEnabled(true);
            return;
        }
        setWorking(true);
        try {
            const result = await clan.stopSharing();
            // THE PREFERENCE IS OFF EITHER WAY; THE SUMMARY ON THE SERVER MAY NOT BE.
            //
            // An earlier version only reported this when `status === 'ready'`, on the reasoning that
            // "not signed in" is not news to somebody who is not signed in. But the two statuses it
            // silenced are exactly the two where the clear cannot happen — over a shared profile, and
            // signed out — so the panel went on to state that clan mates now see "nothing shared"
            // while the last summary was still sitting there, readable. Measured: one click over a
            // `#p=` link, zero clear calls, and that sentence on screen.
            if (!result.ok) setFailure(result.error.message);
        } finally {
            setWorking(false);
        }
    };

    /**
     * MAY THIS PANEL STATE WHAT CLAN MATES SEE?
     *
     * Only when it knows. It knows in two cases: the profile is in a clan and signed in, where the
     * convergence effect in `ClanContext` has cleared the summary (or is about to, and reports a
     * failure through `share.status`); and the profile is in no clan, where there is nothing to see
     * either way. Signed out and over a shared profile it does NOT know — there is no session to ask
     * with and no own-profile id to ask about — and a failed clear says outright that it does not.
     * Those are exactly the moments when the claim was measured to be false.
     */
    const canVouchForServer =
        (clan.status === 'ready' || clan.status === 'no-clan') && clan.share.status !== 'error';

    const notice = clan.autoPull;

    return (
        <Card
            className="p-3 h-full bg-bg-secondary/40 border-border/50"
            // The state, readable from outside React: `reverseForge/scratch/alwayson_shots.mjs`
            // asserts on it, and it is one attribute rather than a class name that layout may move.
            data-clan-sync={on ? 'on' : 'off'}
        >
            <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center shrink-0">
                    <Users className={cn('w-4 h-4', on ? 'text-accent-primary' : 'text-text-muted')} />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="font-bold">Clan sync</div>
                            {/* `text-text-secondary`, not the `text-text-muted` the neighbouring
                                cards use for their subtitles: measured at 3.94:1 on this background,
                                muted is below AA, and this line is the only place the switch says
                                which TWO things it governs. Legibility wins over matching a
                                subtitle colour. */}
                            <div className="text-xs text-text-secondary">
                                Publishes this profile to its clan and follows the clan tech tree
                            </div>
                        </div>

                        {/* A switch, not a checkbox: it takes effect the moment it is pressed and
                            there is no form to submit. */}
                        <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label="Clan sync"
                            onClick={() => void toggle()}
                            disabled={working}
                            title={
                                on
                                    ? 'Turn clan sync off: stop publishing this profile and clear what your clan can already see'
                                    : 'Turn clan sync on: publish this profile to its clan and follow the clan tree'
                            }
                            className={cn(
                                'relative shrink-0 h-6 w-11 rounded-full border transition-colors',
                                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60',
                                on
                                    ? 'bg-accent-primary border-accent-primary'
                                    : 'bg-bg-input border-border',
                                working && 'opacity-60',
                            )}
                        >
                            <span
                                className={cn(
                                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                                    on ? 'left-[1.5rem]' : 'left-0.5',
                                )}
                            />
                        </button>
                    </div>

                    {/* ---- what is true right now, in words ---- */}
                    <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                        {!on ? (
                            <>
                                <span className="font-bold text-amber-400">Off.</span>{' '}
                                {/* WHAT CLAN MATES SEE IS A FACT ABOUT THE SERVER, so it is only
                                    stated where this panel can vouch for it. See
                                    `canVouchForServer`. The alternative clause is not a hedge, it
                                    is what happens next, and `ClanContext`'s convergence effect is
                                    what makes it true. */}
                                {canVouchForServer ? (
                                    <>
                                        Nothing about this profile is published, and your clan mates see it as
                                        &ldquo;nothing shared&rdquo;: its trees, resources and war points are
                                        unknown to them, not zero, and it is left out of every clan total.
                                    </>
                                ) : (
                                    <>
                                        Nothing more about this profile is published. The summary your clan can
                                        already read is removed the moment you are signed in with this profile on
                                        screen. Until then it is still there.
                                    </>
                                )}{' '}
                                Its clan tech tree also stops following the clan&apos;s. The levels stay exactly
                                as you typed them, even after your leaders publish new ones.
                            </>
                        ) : clan.status === 'shared-profile' ? (
                            <>
                                <span className="font-bold text-accent-primary">On.</span>{' '}
                                You are looking at a shared profile, which belongs to no clan and publishes
                                nothing. Save it as your own and this applies to it too.
                            </>
                        ) : clan.status === 'signed-out' ? (
                            <>
                                <span className="font-bold text-accent-primary">On.</span>{' '}
                                Clans need an account, so nothing is sent while you are signed out. Sign in and
                                this profile&apos;s summary goes to its clan after every change, and its clan tech
                                tree follows the clan&apos;s.
                            </>
                        ) : clan.status === 'no-clan' ? (
                            <>
                                <span className="font-bold text-accent-primary">On.</span>{' '}
                                This profile is in no clan, so there is nothing to publish and no clan tree to
                                follow. Both start the moment it joins one.
                            </>
                        ) : clanName ? (
                            <>
                                <span className="font-bold text-accent-primary">On.</span>{' '}
                                Trees, resources and war points go to{' '}
                                <span className="font-semibold text-text-primary">{clanName}</span> after every
                                change, and the clan tech tree comes back.
                            </>
                        ) : (
                            <>
                                <span className="font-bold text-accent-primary">On.</span>{' '}
                                Published to its clan after every change, and the clan tech tree comes back.
                            </>
                        )}
                    </p>

                    {/* Verifiable rather than promised: the clock the publisher actually ran on. */}
                    {on && clan.status === 'ready' && (
                        <p className="mt-1 text-[11px] text-text-secondary/80">
                            Published {relativeTime(clan.share.publishedAt)}
                            {clan.share.status === 'pending' && ' · a change is waiting to be sent'}
                            {clan.share.status === 'publishing' && ' · sending now'}
                        </p>
                    )}

                    {/* The row could not be cleared. The setting is off regardless. Say both. */}
                    {failure && (
                        <p
                            role="status"
                            className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200"
                        >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                                Clan sync is off in this browser, but the summary already on the server could not
                                be cleared, so your clan can still read the last one. It is cleared automatically
                                the next time this profile is on screen with an account signed in. {failure}
                            </span>
                        </p>
                    )}

                    {/* ---- the clan tree changed under the user's feet: say so, with numbers ---- */}
                    {notice && (
                        // `role="status"`: numbers a calculator depends on changed without the user
                        // asking, so a screen reader has to hear about it too, politely.
                        <div role="status" className="mt-3 rounded-lg border border-accent-primary/40 bg-accent-primary/5 p-2.5">
                            <div className="flex items-start gap-2">
                                <ArrowDownToLine className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-primary" />
                                <p className="min-w-0 flex-1 text-[11px] text-text-secondary leading-relaxed">
                                    <span className="font-bold text-text-primary">
                                        Your clan tech tree was updated from {clanName ?? 'your clan'}.
                                    </span>{' '}
                                    {notice.changed} node{notice.changed === 1 ? '' : 's'} changed:{' '}
                                    <span className="text-green-400 font-semibold">{notice.up} up</span>,{' '}
                                    {/* "0 down" is still a number the reader has to be able to read:
                                        muted measures 3.7:1 here, so zero is only DE-emphasised, not
                                        dimmed out of legibility. */}
                                    <span className={cn('font-semibold', notice.down > 0 ? 'text-red-400' : 'text-text-secondary')}>
                                        {notice.down} down
                                    </span>
                                    . This profile now holds {notice.nodes} clan node
                                    {notice.nodes === 1 ? '' : 's'} above 0, and every calculator uses them.
                                    {notice.clamped > 0 && (
                                        <>
                                            {' '}
                                            {notice.clamped} of them {notice.clamped === 1 ? 'was' : 'were'} published
                                            above the level cap of the game version selected here and{' '}
                                            {notice.clamped === 1 ? 'was' : 'were'} reduced to that cap.
                                        </>
                                    )}
                                </p>
                                <button
                                    type="button"
                                    onClick={clan.dismissAutoPull}
                                    aria-label="Dismiss the clan tree update notice"
                                    title="Dismiss"
                                    className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {working && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-text-muted" />}
            </div>
        </Card>
    );
}
