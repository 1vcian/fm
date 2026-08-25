/**
 * ClanRoster — the whole clan on one screen: every member's trees, and every member's war points
 * projected onto the war days.
 * =============================================================================================
 *
 * This is the reason the clan tab exists. A war planner opens it to answer three questions in
 * order: how much can this clan still score, on which day, and who is missing. So the page is laid
 * out in exactly that order — clan total, per-day totals, then the roster — and the roster is a
 * card list rather than a table because fifty rows of eight columns cannot be read on a phone and
 * a horizontally scrolling table hides the numbers that matter behind a swipe.
 *
 * ONE READ, FIFTY MEMBERS
 * -----------------------
 * Everything on screen comes from `clan_roster_detail` (`ClanContext` fetches it once as
 * `useClan().roster`): `clan_id, profile_id, role, joined_at, name, power, updated_at, is_mine,
 * clan_share`. Those nine columns are the whole budget. There is deliberately no per-member second
 * query — fifty round trips to decorate a list is not a feature — so anything the view does not
 * carry is simply not shown. In particular: no email, no `profiles.body`, no last-login, and no
 * per-member badge, because a badge belongs to the clan and not to a member (the clan's own badge
 * is drawn once, in the header, by whichever surface owns the clan identity).
 *
 * A MISSING SHARE IS NOT A ZERO — AND IT IS NOT IN THE TOTALS EITHER
 * -----------------------------------------------------------------
 * `clan_share` is `null` until a member opts in. Those members are listed (they are in the clan and
 * a planner needs to know they are), marked "no data shared yet", and **excluded** from the clan
 * total and from every day total. Adding them as zero would understate the clan by however many
 * people have not published, and a planner cannot tell an understated total from an accurate one.
 * The header therefore always says how many members the totals are actually built from.
 *
 * NUMBERS ARE DISPLAYED, NEVER RECOMPUTED
 * ---------------------------------------
 * Each member's eight category totals, their war-day assignments and their six-day projection are
 * read verbatim from their own published summary — `src/utils/warPoints.ts` computed them on that
 * member's machine, from that member's game config version, resources and clan tree. Recomputing
 * here would silently produce a different answer for a member whose `cfg` differs from ours, which
 * is the very thing `MemberSummaryCard`'s "older config" chip warns about. All this file does is
 * add them up, and it adds up shares regardless of `cfg` — with the count of mismatched configs
 * stated next to the total, because a planner needs to know the sum is mixed.
 *
 * A TOTAL MADE OF MIXED CONFIDENCE IS NOT ONE NUMBER
 * -------------------------------------------------
 * A `v2` share says, per category, whether its figure is exact, a floor, or a blind spot (`prov`,
 * see `clanApi.ts`). Those states do not cancel out when fifty of them are added together: a clan
 * total built from anything other than eight-times-exact is a FLOOR, and presenting it as a single
 * confident figure is the over-claim this whole surface exists to avoid. So the headline carries
 * the same "≥" the member rows do, the ceiling every publisher named is summed into an "at most",
 * and the closing note is DERIVED from the shares on screen — it names the categories that really
 * are exact across this clan and the ones that really are not, instead of a blanket caveat that
 * would keep saying "tech reads n/a" long after it stopped being true.
 *
 * ONE EXCEPTION, AND IT IS NOT A FLOOR AT ALL: a share with no `prov` (an older version of the
 * tool). Nothing in it records which direction its figures err in, and the version that wrote them
 * priced the WHOLE coin bank as forge spend — an over-count. So a total mixing those rows with
 * newer ones is a floor over one part of itself and a guess over the other, and it names both
 * amounts instead of claiming a bound it does not have. Only when every row is unverified does the
 * whole total read "~".
 *
 * WITHOUT A BACKEND THIS RENDERS NOTHING
 * --------------------------------------
 * `useClan()` settles on `unconfigured` / `signed-out` / `shared-profile` / `no-clan` in a build
 * with no `VITE_SUPABASE_*`, with nobody signed in, while a share link is open, or for a profile
 * that is in no clan. In all four cases this component returns `null`: a roster of nobody is not a
 * thing to show, and the hard rule is that no surface teases a dead feature.
 *
 * `rows` (plus `configVersion`) may be passed to drive the component from fixtures instead of the
 * context. That is what the headless harness uses, and it is the only way to look at fifty hostile
 * rows without a database.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Info, Swords, Users } from 'lucide-react';
import { useClan } from '../../context/ClanContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { computeWarDaysMap, getWarDayIndex, getWarDayName } from '../../utils/guildWarUtils';
import { useGameData } from '../../hooks/useGameData';
import { WAR_CATEGORIES } from '../../utils/warPoints';
import type { WarCategory } from '../../utils/guildWarUtils';
import { getTechNodeName } from '../../utils/techUtils';
import { formatCompactNumber } from '../../utils/statsCalculator';
import type { ClanError, ClanRosterDetailRow } from '../../services/clanApi';
import { cn } from '../../lib/utils';
import {
    CONFIDENCE_META,
    MemberSummaryCard,
    WAR_CATEGORY_LABELS,
    WAR_CATEGORY_ORDER,
    WAR_DAY_COUNT,
    readMemberSummary,
    shortWarDayName,
    useTreeIndex,
    type MemberBreakdownFn,
    type MemberConfidence,
    type MemberSummary,
} from './MemberSummaryCard';

/* ------------------------------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------------------------------ */

type SortKey = 'points' | 'name' | 'activity';

const SORT_LABELS: Record<SortKey, string> = {
    points: 'War points',
    name: 'Name',
    activity: 'Last activity',
};

/** Which direction each key opens in — the one a planner wants first. */
const SORT_DEFAULT_DESC: Record<SortKey, boolean> = {
    points: true,     // biggest contributor first
    name: false,      // A → Z
    activity: true,   // most recently synced first
};

/**
 * Orders the roster.
 *
 * Members with nothing published are pinned to the BOTTOM in every mode, including ascending war
 * points. They have no value on that axis, and floating "unknown" to the top of a war plan would
 * push the people who actually reported below the fold. Ties fall back to the name so the order is
 * stable across renders (Array.prototype.sort is stable in every engine this app targets, but a
 * deterministic comparator also keeps two sorts of the same data identical).
 */
function sortMembers(members: MemberSummary[], key: SortKey, desc: boolean): MemberSummary[] {
    const byName = (a: MemberSummary, b: MemberSummary) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

    return [...members].sort((a, b) => {
        const aMissing = a.points === null;
        const bMissing = b.points === null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;

        if (key === 'name') return desc ? -byName(a, b) : byName(a, b);

        const delta = key === 'points'
            ? (a.points ?? 0) - (b.points ?? 0)
            : a.syncedAt - b.syncedAt;
        if (delta !== 0) return desc ? -delta : delta;
        // Ties read A → Z whichever way the primary axis points.
        return byName(a, b);
    });
}

/* ------------------------------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------------------------------ */

export interface ClanRosterProps {
    /**
     * Roster rows. Omit to read `useClan().roster`, which is the normal path. Passing rows also
     * bypasses the status gate, so a fixture renders without a session.
     */
    rows?: ClanRosterDetailRow[];
    /** Overrides the loading state (only meaningful together with `rows`). */
    loading?: boolean;
    /** Overrides the error (only meaningful together with `rows`). */
    error?: ClanError | null;
    /** The game config version to compare each share's `cfg` against. */
    configVersion?: string;
    /** `clans.member_cap` — shown as "42 / 50". */
    memberCap?: number | null;
    /** Fixed clock, so a fixture's "stale" badges do not change with the calendar. */
    now?: number;
    /**
     * Itemises one member's published summary. Omit to use `useClan().memberBreakdown`, which is
     * the normal path; a fixture passes its own because `useClan()` is inert without a provider.
     *
     * Handed to each card rather than called here: fifty passes cost 495 ms median
     * (`reverseForge/scratch/breakdown_timing.mjs`), and a roster that freezes for half a second
     * before it paints is worse than one with no breakdown at all. A card calls this when it opens.
     */
    memberBreakdown?: MemberBreakdownFn;
    className?: string;
}

/* ------------------------------------------------------------------------------------------ *
 * The component
 * ------------------------------------------------------------------------------------------ */

export const ClanRoster: React.FC<ClanRosterProps> = ({
    rows,
    loading,
    error,
    configVersion,
    memberCap,
    now,
    memberBreakdown,
    className,
}) => {
    const clan = useClan();
    const { selectedVersion } = useGameDataContext();

    /**
     * WHAT_A_DAY_TILE_SAYS — what you actually DO on each war day, and with what.
     *
     * Two halves, both derived and neither tabulated:
     *
     *  - which categories pay on a day comes from `computeWarDaysMap(GuildWarDayConfigLibrary.json)`,
     *    inverted here. Day assignments genuinely move between config versions (three of the 23
     *    shipped ones carry different layouts, and day 5's `DayPoints` went 2 -> 4 in February), so a
     *    hard-coded list would go quietly wrong — the same trap that was just removed from
     *    `isWarPointDay`'s fallback.
     *  - which RESOURCE a category spends is read off the engine, `src/utils/warPoints.ts`: it emits
     *    `dungeons` from keys, `forge` from hammers, `forgeSpend` from coins, `skills` from skill
     *    tickets, `mounts` from clock winders, `tech` from potions, and `eggs`/`pets` from held eggs
     *    plus eggshells. Verified against the emit sites rather than recalled, because a label that
     *    sends somebody to spend the wrong resource is worse than no label.
     *
     * `idle` is the day the game awards nothing for at all — day 5 ships `Tasks: []` in every version,
     * because it is the battle day. That is a different fact from "this clan scored zero".
     */
    const { data: warDayConfig } = useGameData<unknown>('GuildWarDayConfigLibrary.json');
    const dayWork = useMemo(() => {
        const SPENDS: Record<WarCategory, string> = {
            tech: 'potions', forge: 'hammers', forgeSpend: 'coins', dungeons: 'keys',
            skills: 'tickets', mounts: 'winders', eggs: 'eggs', pets: 'eggs',
        };
        const LABEL: Record<WarCategory, string> = {
            tech: 'tech tree', forge: 'forging', forgeSpend: 'forge spend', dungeons: 'dungeons',
            skills: 'skills', mounts: 'mounts', eggs: 'eggs', pets: 'pets',
        };
        const map = warDayConfig ? computeWarDaysMap(warDayConfig as never) : null;
        return Array.from({ length: 6 }, (_, day) => {
            if (!map) return { short: '', long: 'Waiting for the war day config.', idle: false };
            const here = WAR_CATEGORIES.filter(c => (map[c] || []).includes(day));
            if (here.length === 0) {
                return {
                    short: 'battle day',
                    long: 'The game sets no scoring tasks for this day — it is the battle day, so points come from attacking, not from spending resources.',
                    idle: true,
                };
            }
            return {
                short: here.map(c => LABEL[c]).join(' · '),
                long: `Scores on this day: ${here.map(c => `${LABEL[c]} (${SPENDS[c]})`).join(', ')}.`,
                idle: false,
            };
        });
    }, [warDayConfig]);

    const controlled = rows !== undefined;
    const status = clan.status;
    // Four resting states, none of them an error, all of them "there is no roster here".
    const silent = !controlled && (status === 'unconfigured' || status === 'signed-out' || status === 'shared-profile' || status === 'no-clan');

    const effectiveRows = controlled ? rows! : clan.roster;
    const isLoading = controlled ? !!loading : status === 'loading';
    const effectiveError = controlled ? (error ?? null) : status === 'error' ? clan.error : null;
    const version = configVersion ?? selectedVersion ?? '';
    const cap = memberCap ?? clan.clan?.member_cap ?? null;

    const treeIndex = useTreeIndex(!silent);
    // A fixture's function wins; otherwise the context's, which is `() => null` until the thirteen
    // war configs have loaded — so a card opened during that window shows the published totals with
    // no breakdown, rather than a breakdown built from half a config set.
    const itemise: MemberBreakdownFn = memberBreakdown ?? clan.memberBreakdown;

    const [sortKey, setSortKey] = useState<SortKey>('points');
    const [desc, setDesc] = useState<boolean>(SORT_DEFAULT_DESC.points);
    const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

    const members = useMemo(
        () => effectiveRows.map(row => readMemberSummary(row, { configVersion: version, treeIndex, now })),
        [effectiveRows, version, treeIndex, now],
    );

    const sorted = useMemo(() => sortMembers(members, sortKey, desc), [members, sortKey, desc]);

    /**
     * Clan totals. `dayCount` is the widest day strip any member published rather than a constant:
     * a config with a seventh war day must not be silently cropped to six, and every row then draws
     * the same number of cells so the columns line up down the page.
     */
    const totals = useMemo(() => {
        const dayCount = members.reduce(
            (widest, m) => Math.max(widest, m.byDay?.length ?? 0),
            WAR_DAY_COUNT,
        );
        const byDay = new Array<number>(dayCount).fill(0);
        const byDayBoosted = new Array<number>(dayCount).fill(0);
        let points = 0;
        /** Σ of every publisher's own "not counted, at most" figures. Turns the total into a range. */
        let ceiling = 0;
        let sharing = 0;
        let mismatchedConfig = 0;
        let stale = 0;
        /** Shares whose eight categories were ALL unavailable: sharing, but contributing nothing. */
        let blind = 0;
        /** Shares with no provenance at all — an older version of the tool (see `hasProvenance`). */
        let unverified = 0;
        /**
         * How many of `points` came out of those unverified shares.
         *
         * This exists because the headline used to say "nothing anywhere is over-counted" whenever
         * ANY member published a floor, and that is false the moment one row has no provenance: a
         * v1 document's `forgeSpend` was an UPPER bound wearing a plain number (floor(coins/1000)×27
         * over the whole coin bank), so an unverified figure can be far too BIG. Naming the amount
         * lets the sentence say which part of the total is bounded and which part is only a claim.
         */
        let unverifiedPoints = 0;
        /** Rows whose own `byDay` does not add up to their own categories — see `daySplitMismatch`. */
        let daySplitMismatches = 0;
        /** Per member: how many published a floor, and how many published an all-exact document. */
        let exactMembers = 0;
        let boundedMembers = 0;

        /**
         * Per CATEGORY, how many of the sharing members published each confidence.
         *
         * This is what replaces the old blanket "tech, forging and pet merges read n/a, so every
         * total here is a lower bound". Counts rather than a single worst-case verdict, because
         * worst-case degenerates: ONE member with an empty profile makes all eight categories read
         * "not modelled" and the note goes back to saying nothing. "Dungeons — exact for 46 of 48"
         * is both true and actionable, and it names the two who need to fill their keys in.
         */
        const perCategory = {} as Record<string, Record<MemberConfidence, number>>;
        for (const category of WAR_CATEGORY_ORDER) {
            perCategory[category] = { exact: 0, 'lower-bound': 0, unavailable: 0, unknown: 0 };
        }

        for (const member of members) {
            if (member.points === null) continue;
            sharing += 1;
            points += member.points;
            ceiling += member.ceiling;
            if (member.configState === 'older' || member.configState === 'newer') mismatchedConfig += 1;
            if (member.ageDays !== null && member.ageDays >= 2) stale += 1;
            if (member.allBlind) blind += 1;
            if (!member.hasProvenance) { unverified += 1; unverifiedPoints += member.points; }
            if (member.daySplitMismatch) daySplitMismatches += 1;
            if (member.confidence === 'exact') exactMembers += 1;
            else boundedMembers += 1;
            for (let day = 0; day < dayCount; day += 1) {
                // A day the reader refused (an impossible published figure) is `undefined`, and
                // contributes nothing to the clan strip — the same as it contributes nothing to
                // the member's own headline.
                const base = member.byDay?.[day] ?? 0;
                byDay[day] += base;
                byDayBoosted[day] += member.dayPts?.[day] ?? base ?? 0;
            }
            for (const entry of member.war) {
                const bucket = perCategory[entry.category];
                if (bucket) bucket[entry.confidence] += 1;
            }
        }

        /**
         * Each category's headline state: the one most of the sharing members published, with a tie
         * going to the WORSE of the two so a 50/50 split never reads better than it is.
         */
        const rank: Record<MemberConfidence, number> = { exact: 0, unknown: 1, 'lower-bound': 2, unavailable: 3 };
        const dominant = {} as Record<string, { state: MemberConfidence; count: number }>;
        for (const category of WAR_CATEGORY_ORDER) {
            const bucket = perCategory[category];
            let best: MemberConfidence = 'unknown';
            for (const state of Object.keys(bucket) as MemberConfidence[]) {
                if (bucket[state] > bucket[best] || (bucket[state] === bucket[best] && rank[state] > rank[best])) {
                    best = state;
                }
            }
            dominant[category] = { state: best, count: bucket[best] };
        }

        /** Confidence in the SUM. Anything other than "everybody exact" makes it a floor. */
        const confidence: MemberConfidence =
            sharing === 0 ? 'unknown'
                : blind === sharing ? 'unavailable'
                    : exactMembers === sharing ? 'exact'
                        : unverified === sharing ? 'unknown'
                            : 'lower-bound';

        return {
            dayCount,
            byDay,
            byDayBoosted,
            dayBoostWorth: byDayBoosted.reduce((a, b) => a + b, 0) - byDay.reduce((a, b) => a + b, 0),
            points,
            ceiling,
            confidence,
            sharing,
            missing: members.length - sharing,
            mismatchedConfig,
            stale,
            blind,
            unverified,
            unverifiedPoints,
            daySplitMismatches,
            exactMembers,
            boundedMembers,
            /**
             * The four buckets are disjoint and add up to `sharing`: a share either has no
             * provenance at all (`unverified`), or has provenance and is all-exact, all-blind, or
             * something in between (a genuine floor). Stated separately because "the other N
             * knowingly leave something out" was being said about rows that knowingly said nothing.
             */
            floorMembers: boundedMembers - unverified - blind,
            perCategory,
            dominant,
        };
    }, [members]);

    const todayIndex = useMemo(() => getWarDayIndex(now === undefined ? new Date() : new Date(now)), [now]);

    if (silent) return null;

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) {
            setDesc(d => !d);
        } else {
            setSortKey(key);
            setDesc(SORT_DEFAULT_DESC[key]);
        }
    };

    const toggleMember = (profileId: string) => {
        setOpenIds(prev => {
            const next = new Set(prev);
            if (next.has(profileId)) next.delete(profileId);
            else next.add(profileId);
            return next;
        });
    };

    return (
        <div
            className={cn('space-y-4', className)}
            data-testid="clan-roster"
            data-members={members.length}
            data-sharing={totals.sharing}
            data-day-count={totals.dayCount}
        >
            {/* ---- heading ---- */}
            <div className="flex items-center gap-2 flex-wrap">
                <Users className="w-4 h-4 text-accent-primary shrink-0" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-text-primary">Roster</h2>
                <span className="text-[11px] text-text-muted">
                    {members.length}
                    {cap ? ` / ${cap}` : ''} member{members.length === 1 ? '' : 's'}
                </span>
                {totals.missing > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border shrink-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                        {totals.missing} not sharing
                    </span>
                )}
            </div>

            {effectiveError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    {/* `error.message` only — `error.raw` carries uuids and byte counts and stays in the console. */}
                    <p className="text-xs text-red-200">{effectiveError.message}</p>
                </div>
            )}

            {isLoading && members.length === 0 ? (
                <div className="rounded-xl border border-border/50 bg-bg-secondary/30 p-6 text-center text-xs text-text-muted">
                    Loading the roster
                </div>
            ) : members.length === 0 ? (
                <div className="rounded-xl border border-border/50 bg-bg-secondary/30 p-6 text-center text-xs text-text-muted">
                    Nobody to show yet.
                </div>
            ) : (
                <>
                    {/* ---- what a planner reads first ---- */}
                    <div className="rounded-xl border border-accent-primary/25 bg-accent-primary/5 p-3 space-y-3">
                        <div className="flex items-end gap-3 flex-wrap">
                            <div>
                                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent-primary">
                                    <Swords className="w-3.5 h-3.5" /> Obtainable war points
                                </div>
                                {/* The "≥" is not decoration: unless every member published an
                                    all-exact document, this figure is a floor, and a bare number
                                    here would be the clan reading a floor as the answer. */}
                                <div
                                    className="flex items-baseline gap-1.5"
                                    data-clan-confidence={totals.confidence}
                                >
                                    <span
                                        className={cn(
                                            'text-2xl font-black tabular-nums',
                                            totals.confidence === 'exact' ? 'text-text-primary' : CONFIDENCE_META[totals.confidence].text,
                                        )}
                                        title={
                                            `${CONFIDENCE_META[totals.confidence].prefix}${totals.points.toLocaleString('en-US')} points\n` +
                                            CONFIDENCE_META[totals.confidence].fallback +
                                            // The "≥" only covers the rows that recorded how they
                                            // were computed. Without this line the tooltip claims a
                                            // bound over figures that have none.
                                            (totals.unverified > 0 && totals.confidence === 'lower-bound'
                                                ? `\nThat holds for ${(totals.points - totals.unverifiedPoints).toLocaleString('en-US')} of it. The other ${totals.unverifiedPoints.toLocaleString('en-US')} came from an older version of the tool and is bounded in neither direction.`
                                                : '')
                                        }
                                        data-clan-total={totals.points}
                                    >
                                        {CONFIDENCE_META[totals.confidence].prefix}
                                        {formatCompactNumber(totals.points)}
                                    </span>
                                    {totals.ceiling > 0 && (
                                        <span
                                            className="text-sm font-bold text-text-muted tabular-nums"
                                            title={
                                                `Every publisher's own "not counted, at most" figures add up to ${totals.ceiling.toLocaleString('en-US')} more points — mount merges, pet merges and coins past the forge sink.` +
                                                (totals.unverified > 0
                                                    ? ` It is a range over the rows that named a ceiling; the ${totals.unverified} from an older version of the tool named none, so the clan is not guaranteed to be inside it.`
                                                    : ' The clan is somewhere in this range.')
                                            }
                                            data-clan-ceiling={totals.points + totals.ceiling}
                                        >
                                             {formatCompactNumber(totals.points + totals.ceiling)}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-[11px] text-text-muted leading-snug">
                                from {totals.sharing} of {members.length} member{members.length === 1 ? '' : 's'}
                                {totals.missing > 0 && (
                                    <>
                                        <br />
                                        <span className="text-amber-400">
                                            {totals.missing} shared nothing — not counted as zero
                                        </span>
                                    </>
                                )}
                                {totals.blind > 0 && (
                                    <>
                                        <br />
                                        <span className="text-amber-400">
                                            {totals.blind} shared a summary in which nothing could be computed
                                        </span>
                                    </>
                                )}
                                {totals.unverified > 0 && (
                                    <>
                                        <br />
                                        <span className="text-sky-300">
                                            {totals.unverified} published from an older version of the tool
                                        </span>
                                    </>
                                )}
                                {totals.mismatchedConfig > 0 && (
                                    <>
                                        <br />
                                        <span className="text-amber-400">
                                            {totals.mismatchedConfig} used a different game config
                                        </span>
                                    </>
                                )}
                                {totals.stale > 0 && (
                                    <>
                                        <br />
                                        <span className="text-red-400">{totals.stale} at least two days old</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* One sentence about the SUM, before any day total is read. */}
                        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-text-secondary">
                            {(() => {
                                const Icon = CONFIDENCE_META[totals.confidence].icon;
                                return <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', CONFIDENCE_META[totals.confidence].text)} aria-hidden="true" />;
                            })()}
                            <span data-clan-caveat="1">
                                {totals.sharing === 0 ? (
                                    'Nobody in this clan has published a summary yet, so there is nothing to add up.'
                                ) : totals.confidence === 'exact' ? (
                                    <>
                                        Every one of the {totals.sharing} published summaries is exact in all eight
                                        categories, so this total is the answer and not a floor.
                                    </>
                                ) : totals.confidence === 'unavailable' ? (
                                    <>
                                        All {totals.sharing} published summaries came back with nothing computable, so
                                        this clan&apos;s obtainable points are unknown — not zero.
                                    </>
                                ) : totals.confidence === 'unknown' ? (
                                    <>
                                        All {totals.sharing} published summaries come from an older version of the tool
                                        and carry no record of how their numbers were reached. Treat the total as
                                        unverified.
                                    </>
                                ) : (
                                    /* MIXED. The four buckets are named separately rather than
                                       rolled into "the other N", and the "nothing is over-counted"
                                       claim is only made when it is actually true: an unverified row
                                       carries no bound in EITHER direction (a v1 document priced the
                                       whole coin bank as forge spend, which over-counts), so with one
                                       of those in the sum the total is a floor over part of itself
                                       and a guess over the rest. Saying otherwise made the headline
                                       contradict the very row it was summing. */
                                    <>
                                        <span className="text-amber-300 font-bold">
                                            {totals.unverified > 0 ? 'This total is part floor, part guess.' : 'This total is a floor.'}
                                        </span>{' '}
                                        {[
                                            totals.exactMembers > 0 && `${totals.exactMembers} of the ${totals.sharing} published summaries ${totals.exactMembers === 1 ? 'is' : 'are'} exact throughout`,
                                            totals.floorMembers > 0 && `${totals.floorMembers} ${totals.floorMembers === 1 ? 'knowingly leaves' : 'knowingly leave'} something obtainable out`,
                                            totals.blind > 0 && `${totals.blind} could compute nothing at all`,
                                            totals.unverified > 0 && `${totals.unverified} came from an older version of the tool`,
                                        ].filter(Boolean).join('; ')}.
                                        {totals.unverified > 0 ? (
                                            <>
                                                {' '}The{' '}
                                                {(totals.points - totals.unverifiedPoints).toLocaleString('en-US')}{' '}
                                                from the newer summaries is never over-counted, so that part can only
                                                be too small. The{' '}
                                                <span className="text-sky-300">
                                                    {totals.unverifiedPoints.toLocaleString('en-US')}
                                                </span>{' '}
                                                from the older ones records nothing about how it was reached and could
                                                be too big as easily as too small — open those rows to see which.
                                            </>
                                        ) : (
                                            <>
                                                {' '}Nothing anywhere is over-counted, so the real figure is at or above it
                                                {totals.ceiling > 0 && `, and below ${(totals.points + totals.ceiling).toLocaleString('en-US')} if every ceiling the publishers named were reached`}.
                                            </>
                                        )}
                                    </>
                                )}
                            </span>
                        </p>

                        {/* per-war-day clan totals — see WHAT_A_DAY_TILE_SAYS above the component */}
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                            {totals.byDay.map((value, day) => (
                                <div
                                    key={day}
                                    title={`${getWarDayName(day)}: ${value.toLocaleString('en-US')} points across the clan`}
                                    data-day={day}
                                    data-day-total={value}
                                    className={cn(
                                        'rounded-lg border px-1 py-1.5 text-center',
                                        day === todayIndex
                                            ? 'border-accent-primary/60 bg-accent-primary/15'
                                            : 'border-border bg-bg-input',
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'text-[9px] uppercase tracking-wide whitespace-nowrap overflow-hidden text-clip',
                                            day === todayIndex ? 'text-accent-primary' : 'text-text-muted',
                                        )}
                                    >
                                        {shortWarDayName(day)}
                                        {day === todayIndex && ' · now'}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-mono text-sm font-bold tabular-nums',
                                            day === todayIndex ? 'text-accent-primary' : 'text-text-primary',
                                        )}
                                    >
                                        {formatCompactNumber(value)}
                                    </div>
                                    {/* WHAT SCORING ON THIS DAY MEANS — the answer to "what do I do
                                        today", which a bare number never gave. Derived from the
                                        config's own day map, so it follows a reshuffle. */}
                                    <div className="mt-0.5 text-[8px] leading-tight text-text-muted whitespace-nowrap overflow-hidden text-clip" title={dayWork[day].long}>
                                        {dayWork[day].short}
                                    </div>

                                    {/* The same day WITH each member's own WarPointsOnDay node applied.
                                        This used to read `+node 263K`, and the `+` was a lie: 263K is
                                        not an addition, it is what the 188K above BECOMES. An arrow
                                        says that; a plus sign says the opposite. */}
                                    {totals.byDayBoosted[day] > value && (
                                        <div
                                            className="font-mono text-[9px] tabular-nums text-emerald-300"
                                            title={
                                                `${value.toLocaleString('en-US')} becomes ${totals.byDayBoosted[day].toLocaleString('en-US')} once each member's own ` +
                                                `"${getTechNodeName(`WarPointsOnDay${day + 1}`)}" clan node is applied — that node multiplies what you score on ` +
                                                `this day and nothing else. It is a multiplier, not extra points you already hold.`
                                            }
                                            data-day-boosted={totals.byDayBoosted[day]}
                                        >
                                            → {formatCompactNumber(totals.byDayBoosted[day])}
                                        </div>
                                    )}
                                    {/* A day the game awards nothing for is not a zero score, it is a
                                        day with no scoring tasks. Saying "0" invites the reader to
                                        wonder who let the clan down. */}
                                    {value === 0 && dayWork[day].idle && (
                                        <div className="text-[8px] leading-tight text-text-muted">no task points</div>
                                    )}
                                </div>
                            ))}
                        </div>
                        {totals.dayBoostWorth > 0 && (
                            <p className="text-[10px] text-text-muted">
                                <span className="text-emerald-300">The green number is the same day after each
                                member&apos;s own <span className="text-text-secondary">War Points On Day</span> clan
                                node is applied</span> — not points on top of the white one, the white one
                                multiplied. Each of those six nodes gives <span className="text-text-secondary">+4%
                                per level</span> and only on its own day, which is why the arrow moves by a
                                different amount on each tile. Across the whole week the nodes are worth{' '}
                                <span className="text-emerald-300 font-mono">
                                    +{formatCompactNumber(totals.dayBoostWorth)}
                                </span>.{' '}
                                The headline above stays on the white figures on purpose: those are the ones that
                                add up to the categories, so you can check them. And note the other half of a clan
                                node, which this row does not show — <em>raising</em> one scores war points too,
                                but only on a day that pays for the tech tree.
                            </p>
                        )}
                        {/* The day strip is a sum of member-written `byDay` arrays, and a row whose
                            own split does not add up to its own categories gets a chip saying so.
                            Silence here meant the SUM could sit visibly below the headline with no
                            explanation anywhere — the member row was labelled and the clan was not. */}
                        {totals.daySplitMismatches > 0 && (
                            <p className="flex items-start gap-1.5 text-[10px] text-amber-400 leading-relaxed">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                                <span>
                                    These day figures add up to{' '}
                                    <span className="font-mono">{formatCompactNumber(totals.byDay.reduce((a, b) => a + b, 0))}</span>,
                                    not the <span className="font-mono">{formatCompactNumber(totals.points)}</span> above.{' '}
                                    {totals.daySplitMismatches === 1
                                        ? 'One member published a day-by-day split that does not add up to their own category totals; their row'
                                        : `${totals.daySplitMismatches} members published a day-by-day split that does not add up to their own category totals; their rows`}
                                    {' '}carr{totals.daySplitMismatches === 1 ? 'ies' : 'y'} a &quot;split mismatch&quot; chip. Points in a
                                    category this game config gives no war day are in the headline and on no day either.
                                </span>
                            </p>
                        )}
                    </div>

                    {/* ---- sort ---- */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wider text-text-muted mr-0.5">Sort</span>
                        {(Object.keys(SORT_LABELS) as SortKey[]).map(key => {
                            const active = key === sortKey;
                            const Arrow = desc ? ArrowDown : ArrowUp;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => toggleSort(key)}
                                    aria-pressed={active}
                                    className={cn(
                                        'flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors',
                                        active
                                            ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                                            : 'border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent-primary/30',
                                    )}
                                >
                                    {SORT_LABELS[key]}
                                    {active && <Arrow className="w-3 h-3" />}
                                </button>
                            );
                        })}
                        <span className="flex-1" />
                        {openIds.size > 0 && (
                            <button
                                type="button"
                                onClick={() => setOpenIds(new Set())}
                                className="rounded-lg border border-border bg-bg-input px-2 py-1 text-[11px] font-bold text-text-secondary hover:text-text-primary"
                            >
                                Collapse all
                            </button>
                        )}
                    </div>

                    {/* ---- the members ---- */}
                    <div className="space-y-1.5">
                        {sorted.map((member, index) => (
                            <MemberSummaryCard
                                key={member.profileId}
                                summary={member}
                                treeIndex={treeIndex}
                                memberBreakdown={itemise}
                                dayCount={totals.dayCount}
                                todayIndex={todayIndex}
                                now={now}
                                rank={index + 1}
                                open={openIds.has(member.profileId)}
                                onToggle={() => toggleMember(member.profileId)}
                            />
                        ))}
                    </div>

                    {/* ---- what the numbers mean ----
                        DERIVED, not written down. The blanket "tech, forging and pet merges read n/a
                        so every total is a lower bound" that used to live here stopped being true
                        the moment the publisher started computing all eight categories — and a
                        stale honesty note is its own kind of lie. So each category is listed under
                        the WORST state anybody on screen published for it, which means the sentence
                        keeps telling the truth as the engine improves and as members update. */}
                    <div className="space-y-1.5 text-[10px] text-text-muted leading-relaxed" data-testid="clan-caveats">
                        <div className="flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-primary" />
                            <span>
                                Every figure is the member&apos;s own published estimate of the war points still{' '}
                                <span className="text-text-secondary">obtainable</span> from the resources they
                                hold — not points already scored — split evenly across the war days the game
                                config gives each category, with their own clan multipliers applied. It is
                                computed on their machine, with their game config version, and it is not
                                verified by anything: read it as a claim.
                            </span>
                        </div>
                        {(['exact', 'lower-bound', 'unavailable', 'unknown'] as MemberConfidence[]).map(state => {
                            const listed = WAR_CATEGORY_ORDER.filter(c => totals.dominant[c]?.state === state);
                            if (!listed.length) return null;
                            const meta = CONFIDENCE_META[state];
                            const Icon = meta.icon;
                            return (
                                <div key={state} className="flex items-start gap-2" data-caveat={state}>
                                    <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', meta.text)} aria-hidden="true" />
                                    <span>
                                        <span className={cn('font-bold', meta.text)}>
                                            {listed.map(c => {
                                                const { count } = totals.dominant[c];
                                                // The count is stated only when the clan disagrees
                                                // about this category — otherwise it is noise.
                                                return count < totals.sharing
                                                    ? `${WAR_CATEGORY_LABELS[c]} (${count}/${totals.sharing})`
                                                    : WAR_CATEGORY_LABELS[c];
                                            }).join(', ')}
                                        </span>
                                        {' — '}
                                        {state === 'exact' && 'exact: the game config pays this for the resources those members hold.'}
                                        {state === 'lower-bound' && 'a floor: something obtainable is knowingly not counted. Open a row to read why, in that member\'s own words.'}
                                        {state === 'unavailable' && 'not modelled: those figures read n/a rather than 0 and are missing from this clan total entirely.'}
                                        {state === 'unknown' && 'published by an older version of the tool, with no record of how the figure was reached.'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

export default ClanRoster;
