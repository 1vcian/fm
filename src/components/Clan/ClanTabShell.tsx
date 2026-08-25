/**
 * ClanTabShell — the whole "Clan" tab of `src/pages/Clan.tsx`, as one state machine.
 * =================================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The clan tab has seven mutually exclusive states and mounts four large components written by
 * other authors. Inlining that in `Clan.tsx` (which already owns the 61-node tree editor, the war
 * stats and the resources editor) would bury the tree page under the clan page. So the page keeps
 * the tabs and the tree, and this file keeps the answer to one question: *given the active
 * profile's clan state, what belongs on screen?*
 *
 * NEVER TWO CONTRADICTORY AFFORDANCES
 * -----------------------------------
 * Exactly one branch renders. "Create a clan" and "you are in a clan" can never both be visible,
 * and no branch shows a control that cannot work:
 *
 *   unconfigured    the build has no `VITE_SUPABASE_*`. Clans do not exist here, so this renders
 *                   the page's pre-existing "coming soon" card, byte for byte — the no-backend
 *                   build must look exactly like it did before any of this was written.
 *   loading         auth is restoring a session, or the membership is being resolved.
 *   signed-out      the sign-in invitation, with the real `<SignInForm/>`. No teaser buttons.
 *   shared-profile  a `#p=` share link is on screen. Membership lives on a profile row that
 *                   exists in no database, so this explains it instead of offering anything.
 *   error           what went wrong, and a retry.
 *   no-clan         `<CreateClanForm/>` + `<ClanBrowser/>` — the two ways in, side by side.
 *   ready           the clan itself: a roster view, an attacks-planner view and a manage view.
 *
 * WHY THE IN-CLAN VIEW IS THREE VIEWS AND NOT ONE SCROLL
 * -----------------------------------------------------
 * `<ClanRoster/>`, `<AttacksPlanner/>` and `<ClanAdminPanel/>` each render a member list. The
 * roster's is the war-points one (points per member, per war day, expandable trees); the planner's
 * is your war squad with each player's attack budget; the panel's is the administrative one
 * (promote, demote, remove, plus the join password and the emblem). Stacking them would put three
 * different member lists on one page, which is exactly the kind of thing that makes a reader
 * distrust all three. So they are three views behind one switch, and only the active one is
 * mounted — which also means the planner fetches nothing until somebody opens it.
 *
 * `<ClanAdminPanel/>` renders its own clan identity block; this file therefore shows the
 * badge/name/tag strip on every view EXCEPT manage, so that view has one identity header and not
 * two.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It owns no clan state and performs no writes. Everything comes from `useClan()`, and the five
 * components below are composed, never reimplemented — a second copy of the create-clan validation
 * or of the roster's war maths is a second place for them to be wrong.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Crown,
    Link2,
    ListOrdered,
    Loader2,
    Lock,
    LogIn,
    RefreshCw,
    Settings2,
    Shield,
    Sparkles,
    Swords,
    User as UserIcon,
    Users,
} from 'lucide-react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { ClanBadge } from '../UI/ClanBadge';
import { SignInForm } from '../Auth/SignInForm';
import { useClan } from '../../context/ClanContext';
import type { ClanRole } from '../../services/clanApi';
import { CreateClanForm } from './CreateClanForm';
import { ClanBrowser } from './ClanBrowser';
import { ClanRoster } from './ClanRoster';
import { ClanAdminPanel } from './ClanAdminPanel';
import { ClanTierPanel } from './ClanTierPanel';
import { AttacksPlanner } from './AttacksPlanner';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------------------------------ */

/** The dashed panel every "nothing to do here" state uses, so they read as one family. */
const Notice: React.FC<{
    icon: React.ReactNode;
    title: string;
    tone?: 'neutral' | 'bad';
    children: React.ReactNode;
}> = ({ icon, title, tone = 'neutral', children }) => (
    <Card
        className={cn(
            'p-6 sm:p-8 border-2 border-dashed',
            tone === 'bad'
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-accent-primary/30 bg-gradient-to-b from-accent-primary/5 to-transparent',
        )}
    >
        <div className="flex flex-col items-center text-center gap-3">
            <div
                className={cn(
                    'w-14 h-14 rounded-2xl flex items-center justify-center',
                    tone === 'bad' ? 'bg-red-500/15 text-red-400' : 'bg-accent-primary/15 text-accent-primary',
                )}
            >
                {icon}
            </div>
            <h2 className="text-xl font-black text-white">{title}</h2>
            <div className="text-sm text-text-secondary max-w-xl leading-relaxed space-y-2">{children}</div>
        </div>
    </Card>
);

const ROLE_ICON: Record<ClanRole, React.ReactNode> = {
    owner: <Crown className="w-3.5 h-3.5 text-amber-400" />,
    admin: <Shield className="w-3.5 h-3.5 text-sky-400" />,
    member: <UserIcon className="w-3.5 h-3.5 text-text-muted" />,
};

const ROLE_LABEL: Record<ClanRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/* ------------------------------------------------------------------------------------------ *
 * The shell
 * ------------------------------------------------------------------------------------------ */

type ClanView = 'roster' | 'attacks' | 'manage';

export interface ClanTabShellProps {
    className?: string;
}

export const ClanTabShell: React.FC<ClanTabShellProps> = ({ className }) => {
    const clan = useClan();
    const [view, setView] = useState<ClanView>('roster');

    // Leaving a clan (or being removed from one) must not leave the manage view selected: the next
    // clan this profile joins would open on somebody else's settings screen.
    const clanId = clan.clan?.id ?? null;
    useEffect(() => {
        setView('roster');
    }, [clanId]);

    const isLeader = clan.role === 'owner' || clan.role === 'admin';

    const views = useMemo(
        () => [
            { id: 'roster' as ClanView, label: 'Members', icon: <ListOrdered className="w-4 h-4" /> },
            // The attacks planner is a THIRD view and not a section of the roster, for the same
            // reason the roster and the manage panel are two views: it renders its own member list
            // (your squad, with attack budgets) and stacking two member lists on one page makes a
            // reader distrust both. Every role sees the tab — a member's plan is read-only and
            // carries their own notification switch, which is the one control on it that is theirs.
            { id: 'attacks' as ClanView, label: 'Attacks', icon: <Swords className="w-4 h-4" /> },
            {
                id: 'manage' as ClanView,
                // A plain member's "manage" view holds their own membership and nothing else, so it
                // is named after what they will find there rather than after a power they lack.
                label: isLeader ? 'Manage clan' : 'My membership',
                icon: <Settings2 className="w-4 h-4" />,
            },
        ],
        [isLeader],
    );

    /* ---- the states with nothing to offer ---- */

    if (clan.status === 'unconfigured') {
        // The pre-existing card, unchanged: a build with no backend must be indistinguishable from
        // the app before clans were written.
        return (
            <Card className={cn('p-10 text-center border-2 border-dashed border-accent-primary/30 bg-gradient-to-b from-accent-primary/5 to-transparent', className)}>
                <div className="w-16 h-16 mx-auto rounded-2xl bg-accent-primary/15 flex items-center justify-center mb-4">
                    <Sparkles className="w-8 h-8 text-accent-primary" />
                </div>
                <h2 className="text-2xl font-black text-white mb-2">Clan hub — coming soon</h2>
                <p className="text-text-secondary max-w-xl mx-auto text-sm leading-relaxed">
                    Create or join a clan with a shared password, then see every member&apos;s resources and builds in one place.
                    Profiles will sync to the cloud so your clan can plan Guild War together.
                </p>
                <div className="flex items-center justify-center gap-2 mt-5 text-[11px] uppercase tracking-widest text-text-muted">
                    <Lock className="w-3.5 h-3.5" /> Password-protected clan spaces
                </div>
            </Card>
        );
    }

    if (clan.status === 'loading') {
        return (
            <Card className={cn('p-10', className)}>
                <div className="flex items-center justify-center gap-3 text-text-muted">
                    <Loader2 className="w-5 h-5 animate-spin text-accent-primary" />
                    <span className="text-sm">Checking whether this profile is in a clan</span>
                </div>
            </Card>
        );
    }

    if (clan.status === 'signed-out') {
        return (
            <div className={cn('space-y-4', className)}>
                <Notice icon={<LogIn className="w-7 h-7" />} title="Sign in to use clans">
                    <p>
                        A clan is shared between people, so it needs an account to hang on to. Everything else in
                        this app keeps working without one — your profiles, the calculators and the tech trees all
                        live in this browser.
                    </p>
                    <p className="text-text-muted text-xs">
                        No password: you get a one-time link by email. Clan membership then belongs to the
                        <span className="text-text-secondary font-semibold"> profile </span>
                        you are looking at, not to your whole account, so two of your profiles can sit in two
                        different clans.
                    </p>
                </Notice>
                <Card className="p-5 sm:p-6">
                    <SignInForm />
                </Card>
            </div>
        );
    }

    if (clan.status === 'shared-profile') {
        return (
            <div className={className}>
                <Notice icon={<Link2 className="w-7 h-7" />} title="This is somebody else's profile">
                    <p>
                        You opened a share link, so what is on screen is a copy that exists only in this tab. Clan
                        membership never travels inside a shared profile — it belongs to a profile of your own.
                    </p>
                    <p className="text-text-muted text-xs">
                        Use <span className="text-text-secondary font-semibold">Save to My Profiles</span> in the
                        header first, then come back: the saved copy is yours and can join a clan.
                    </p>
                </Notice>
            </div>
        );
    }

    if (clan.status === 'error') {
        return (
            <div className={className}>
                <Notice icon={<AlertTriangle className="w-7 h-7" />} title="Could not load your clan" tone="bad">
                    <p>{clan.error?.message || 'Something went wrong.'}</p>
                    <div className="pt-2">
                        <Button variant="secondary" size="sm" onClick={() => void clan.refresh()} disabled={clan.busy}>
                            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', clan.busy && 'animate-spin')} /> Try again
                        </Button>
                    </div>
                </Notice>
            </div>
        );
    }

    /* ---- signed in, no clan: the two ways in ---- */

    if (clan.status === 'no-clan' || !clan.clan || !clan.role) {
        return (
            <div className={cn('space-y-6', className)}>
                <CreateClanForm />
                <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-text-muted">or join one</span>
                    <div className="h-px flex-1 bg-border" />
                </div>
                <ClanBrowser />
            </div>
        );
    }

    /* ---- in a clan ---- */

    return (
        <div className={cn('space-y-5', className)}>
            <div className="flex flex-wrap items-center gap-3">
                {/* Identity lives here on every view EXCEPT manage: <ClanAdminPanel/> draws its
                    own, and two identity headers on one screen is one too many. The attacks
                    planner draws a week picker, not an identity, so it needs this one. */}
                {view !== 'manage' && (
                    <div className="flex items-center gap-3 min-w-0">
                        <ClanBadge badge={clan.badge} size={44} />
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-2 min-w-0">
                                <span className="whitespace-nowrap overflow-hidden text-clip text-lg font-black text-white">{clan.clan.name}</span>
                                <span className="font-mono text-xs text-accent-primary shrink-0">[{clan.clan.tag}]</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                                {ROLE_ICON[clan.role]}
                                {/* Role and liveness only: the member count is stated by whichever
                                    view is below, and saying it twice invites the reader to check
                                    whether the two agree. */}
                                <span>{ROLE_LABEL[clan.role]}</span>
                                {clan.live && (
                                    <>
                                        <span>·</span>
                                        <span className="text-green-400" title="Joins, leaves and shared-tree edits arrive live">
                                            live
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Pushed right only when there is an identity strip to sit beside; on the manage
                    view (which brings its own header) it starts at the left edge instead of floating
                    against nothing. */}
                <div className={cn('flex flex-wrap gap-2', view !== 'manage' && 'ml-auto')}>
                    {views.map(v => (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => setView(v.id)}
                            aria-pressed={view === v.id}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95',
                                view === v.id
                                    ? 'bg-accent-primary/15 text-white border-accent-primary/60'
                                    : 'bg-bg-input text-text-secondary border-border hover:border-accent-primary/40 hover:text-white',
                            )}
                        >
                            {v.icon}
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* WHAT THE TIER IS WORTH, ABOVE THE ROSTER, FOR EVERYBODY.
                It used to sit inside <ClanAdminPanel/>, which only leaders open, and it is the wrong
                audience: the rewards and the tier-point swing are what a member weighs when deciding
                whether a war is worth turning up for. At the bottom tiers a defeat still pays; at SSS
                it costs rank. Somebody who never sees that is deciding without the one number that
                matters. The control that CHANGES the tier stays in manage, owner-only. This is the
                read-only face of the same data. */}
            {view === 'roster' && <ClanTierPanel />}
            {view === 'roster' && <ClanRoster />}
            {view === 'attacks' && <AttacksPlanner />}
            {view === 'manage' && <ClanAdminPanel />}
        </div>
    );
};

export default ClanTabShell;

/* ------------------------------------------------------------------------------------------ *
 * The clan chip, for the app header
 * ------------------------------------------------------------------------------------------ */

export interface ClanHeaderChipState {
    /** `true` when the header should render nothing at all. */
    silent: boolean;
    inClan: boolean;
}

/**
 * What the app header should show for the ACTIVE PROFILE, decided here so the header does not grow
 * a second copy of the status rules.
 *
 * Two states, and a third that is nothing at all:
 *   in a clan   the badge, the name and the tag.
 *   not yet     the "Create clan" way in. A signed-out visitor gets this too: the clan tab it
 *               lands on holds a working sign-in form, so it is discovery and not a dead control.
 *   silent      no backend in this build (clans do not exist — the header must look exactly as it
 *               did before any of this was written), a shared profile (clanless by definition, and
 *               it is not the reader's profile to enrol), a load still in flight (a chip that
 *               changes its mind half a second after paint is worse than one that arrives late),
 *               and a failed load (we do not know the membership, so we claim nothing).
 */
export function useClanHeaderChip(): ClanHeaderChipState {
    const clan = useClan();
    const silent =
        clan.status === 'unconfigured' ||
        clan.status === 'shared-profile' ||
        clan.status === 'loading' ||
        clan.status === 'error';
    return { silent, inClan: clan.status === 'ready' && !!clan.clan };
}

/** The header's tiny clan indicator. Also used as the "no clan yet" call to action. */
export const ClanHeaderChip: React.FC<{ className?: string }> = ({ className }) => {
    const clan = useClan();
    const { silent, inClan } = useClanHeaderChip();

    if (silent) return null;

    if (!inClan || !clan.clan) {
        return (
            <span
                className={cn(
                    'flex items-center gap-1.5 h-9 px-2 sm:px-2.5 rounded-xl border border-dashed border-border text-text-muted hover:text-white hover:border-accent-primary/40 transition-colors',
                    className,
                )}
            >
                <Users className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline text-xs font-bold whitespace-nowrap">Create clan</span>
            </span>
        );
    }

    return (
        <span
            className={cn(
                'flex items-center gap-1.5 h-9 pl-1 pr-2 sm:pr-2.5 rounded-xl border border-border hover:border-accent-primary/40 transition-colors',
                className,
            )}
        >
            <ClanBadge badge={clan.badge} size={26} className="shrink-0" />
            <span className="hidden sm:flex items-baseline gap-1 min-w-0">
                <span className="whitespace-nowrap overflow-hidden text-clip max-w-[80px] text-xs font-bold text-text-secondary">{clan.clan.name}</span>
                <span className="font-mono text-[10px] text-accent-primary shrink-0">[{clan.clan.tag}]</span>
            </span>
        </span>
    );
};
