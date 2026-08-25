import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Copy, Check, Share2, Save, TrendingUp, ArrowLeftRight, ChevronDown } from 'lucide-react';
import { Button } from '../UI/Button';
import { buildShareUrl } from '../../utils/shareCodec';
import { useTreeMode } from '../../context/TreeModeContext';
import { useProfile } from '../../context/ProfileContext';
import { ClanHeaderChip, useClanHeaderChip } from '../Clan/ClanTabShell';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { cn } from '../../lib/utils';
import { AnimatedClock } from '../UI/AnimatedClock';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { useComparison } from '../../context/ComparisonContext';

interface HeaderProps {
    onMenuToggle: () => void;
    onStatsToggle: () => void;
}

export function Header({ onMenuToggle, onStatsToggle }: HeaderProps) {
    const { treeMode } = useTreeMode();
    const { profile, saveSharedProfile } = useProfile();
    // Whether the ACTIVE PROFILE is in a clan. `silent` covers every state with nothing to say (no
    // backend in this build, signed out, a shared profile on screen, still loading) — the header
    // then renders exactly what it always did, with no extra element and no layout shift.
    const clanChip = useClanHeaderChip();
    const { excludeSubstats, setExcludeSubstats } = useComparison();
    const stats = useGlobalStats(excludeSubstats);
    const [justCopied, setJustCopied] = useState(false);
    const [sharing, setSharing] = useState(false);

    /**
     * Mobile only: the header shows Pwr alone and the other two live behind a tap.
     *
     * Three numbers plus two separators plus the mode toggle do not fit a phone header next to the
     * menu, the profile chip and the share button — the row used to scroll sideways, which hides
     * data behind a gesture nobody discovers. Power is the one figure that answers "am I getting
     * stronger?", so it stays visible and the full breakdown is one tap away.
     *
     * `sm:` and up is untouched: same three columns as always, no popover, no behaviour change.
     */
    const [statsOpen, setStatsOpen] = useState(false);
    const statsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!statsOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!statsRef.current?.contains(event.target as Node)) setStatsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setStatsOpen(false);
        };
        // `pointerdown` rather than `click`: on iOS a tap that starts outside and ends inside must
        // still dismiss, and this fires before the popover can swallow the event.
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [statsOpen]);

    /** Exact figure for the popover. The header itself stays compact ("8.18M"). */
    const exact = (value: number | undefined) =>
        typeof value === 'number' ? Math.round(value).toLocaleString() : '—';

    const handleShare = () => {
        if (sharing) return;
        setSharing(true);

        // gzip + base64url in the URL fragment (see src/utils/shareCodec.ts): the payload never
        // reaches the server and the link is ~65% shorter than the old ?b62c= one.
        const urlPromise = buildShareUrl(profile);

        const copy = async () => {
            // Safari invalidates the user gesture across an `await`, so prefer the promise-based
            // ClipboardItem form: the write is issued synchronously inside the click and resolves
            // once the payload is compressed.
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'text/plain': urlPromise.then(url => new Blob([url], { type: 'text/plain' }))
                        })
                    ]);
                    return;
                } catch {
                    // Fall through to writeText (some browsers reject promise-backed items).
                }
            }
            await navigator.clipboard.writeText(await urlPromise);
        };

        copy()
            .then(() => {
                setJustCopied(true);
                setTimeout(() => setJustCopied(false), 2000);
            })
            .catch(err => console.error('Failed to share profile', err))
            .finally(() => setSharing(false));
    };

    return (
        <header className="h-16 sticky top-0 bg-bg-secondary/80 backdrop-blur-md border-b border-border z-50 flex items-center justify-between px-2 sm:px-4 lg:px-8">
            <div className="flex items-center gap-2 sm:gap-4">
                {/* Combined Menu / Profile Button */}
                <button
                    onClick={onMenuToggle}
                    className="flex items-center gap-2 p-1.5 pr-2.5 sm:pr-3 rounded-xl hover:bg-bg-input border border-border hover:border-accent-primary/30 transition-all active:scale-95 group shadow-sm shrink-0"
                    title="Open Navigation Menu & Profiles"
                >
                    <div className="relative shrink-0">
                        <ProfileIcon iconIndex={profile.iconIndex} size={28} className="border-0 group-hover:scale-105 transition-transform" />
                        <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-accent-primary border border-bg-secondary rounded-full flex items-center justify-center shadow-sm">
                            <Menu className="w-2.5 h-2.5 text-white" />
                        </span>
                    </div>
                    <span className="font-semibold text-xs text-text-secondary group-hover:text-text-primary whitespace-nowrap overflow-hidden text-clip max-w-[80px] hidden sm:inline leading-none animate-pulse-subtle">
                        {profile.name}
                    </span>
                </button>

                {/* The active profile's clan, right next to the profile it belongs to. Membership is
                    per PROFILE, not per account, so this is the only honest place for it. It links to
                    the Clan page's clan tab; when this profile is in no clan the same slot is the
                    "Create clan" way in. Renders nothing at all in every other state. */}
                {!clanChip.silent && (
                    <Link
                        to="/clan?tab=clan"
                        className="shrink-0"
                        title={clanChip.inClan ? 'Your clan' : 'Create or join a clan'}
                    >
                        <ClanHeaderChip />
                    </Link>
                )}
            </div>

            {/* Global Stats - Visible on all screens, adjusting size/layout */}
            <div className="flex-1 px-1 sm:px-4 flex justify-center items-center min-w-0">
                <div className="relative" ref={statsRef}>
                    {/* Clickable Mode Indicator Tag - Overlay floating button */}
                    <button
                        onClick={() => setExcludeSubstats(!excludeSubstats)}
                        className={cn(
                            "absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center shadow-lg active:scale-95 transition-all z-20 hover:scale-110",
                            excludeSubstats
                                ? "bg-purple-600 text-white border-purple-400 hover:bg-purple-500 shadow-purple-500/20"
                                : "bg-orange-600 text-white border-orange-400 hover:bg-orange-500 shadow-orange-500/20"
                        )}
                        title={excludeSubstats ? "New Stats (Substats excluded). Click to switch to Old Stats." : "Old Stats (Substats included). Click to switch to New Stats."}
                    >
                        <ArrowLeftRight className="w-3 h-3" />
                    </button>

                    {/* MOBILE (< sm): Power only. The whole pill is the button that reveals the rest. */}
                    <button
                        type="button"
                        onClick={() => setStatsOpen(open => !open)}
                        aria-expanded={statsOpen}
                        aria-haspopup="dialog"
                        aria-label="Show damage and health"
                        className={cn(
                            "sm:hidden flex items-center gap-1.5 pl-5 pr-2 py-1 rounded-lg border backdrop-blur-sm max-w-full active:scale-[0.98] transition-all duration-300",
                            excludeSubstats
                                ? "bg-purple-950/20 border-purple-500/30 shadow-[0_0_15px_rgba(147,51,234,0.05)]"
                                : "bg-orange-950/20 border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.05)]"
                        )}
                    >
                        <div className="flex flex-col items-center shrink-0">
                            <span className={cn(
                                "text-[9px] font-bold uppercase tracking-wider transition-colors",
                                excludeSubstats ? "text-purple-400" : "text-orange-400"
                            )}>Pwr</span>
                            <span className="text-xs font-bold text-text-primary leading-none">
                                {stats ? formatCompactNumber(stats.power) : '-'}
                            </span>
                        </div>
                        <ChevronDown className={cn(
                            "w-3 h-3 shrink-0 transition-transform",
                            excludeSubstats ? "text-purple-400" : "text-orange-400",
                            statsOpen && "rotate-180"
                        )} />
                    </button>

                    {/* MOBILE: the full breakdown, with exact figures. The compact "8.18M" in the
                        header is a glance, this is the number you actually compare against a build. */}
                    {statsOpen && (
                        <div
                            role="dialog"
                            aria-label="Full stats"
                            className={cn(
                                // Centred on the pill, not anchored to its left edge: the pill sits in
                                // the middle of the header, so `left-0` made the panel hang off to the
                                // right of it. w-56 under a centred pill still clears both screen
                                // edges at 360px.
                                "sm:hidden absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 w-56 rounded-xl border bg-bg-primary p-3 shadow-2xl",
                                excludeSubstats ? "border-purple-500/40" : "border-orange-500/40"
                            )}
                        >
                            <dl className="space-y-2">
                                {([
                                    ['Pwr', stats?.power, excludeSubstats ? 'text-purple-400' : 'text-orange-400'],
                                    ['Dmg', stats?.totalDamage, 'text-red-400'],
                                    ['HP', stats?.totalHealth, 'text-green-400'],
                                ] as const).map(([label, value, tone]) => (
                                    <div key={label} className="flex items-baseline justify-between gap-3">
                                        <dt className={cn("text-[10px] font-bold uppercase tracking-wider shrink-0", tone)}>
                                            {label}
                                        </dt>
                                        <dd className="min-w-0 text-right">
                                            <span className="block text-sm font-bold text-text-primary leading-tight">
                                                {typeof value === 'number' ? formatCompactNumber(value) : '-'}
                                            </span>
                                            {/* Only when it adds something. Below 1000 the compact form
                                                IS the exact figure, and printing "80" under "80" is noise. */}
                                            {typeof value === 'number' && exact(value) !== formatCompactNumber(value) && (
                                                <span className="block text-[10px] font-mono text-text-muted leading-tight break-all">
                                                    {exact(value)}
                                                </span>
                                            )}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                            {/* Which reading these numbers are, because the toggle changes what they mean. */}
                            <p className="mt-2.5 pt-2.5 border-t border-border text-[10px] text-text-secondary leading-snug">
                                {excludeSubstats
                                    ? 'New Stats. Item substats excluded from Power.'
                                    : 'Old Stats. Item substats included in Power.'}
                            </p>
                        </div>
                    )}

                    {/* sm and up: unchanged. All three fit, so nothing is hidden behind a tap. */}
                    <div className={cn(
                        "hidden sm:flex items-center gap-1.5 sm:gap-6 pl-5 pr-1.5 sm:pr-3 py-1 sm:py-1.5 rounded-lg border backdrop-blur-sm overflow-x-auto no-scrollbar max-w-full transition-all duration-300",
                        excludeSubstats
                            ? "bg-purple-950/20 border-purple-500/30 text-purple-200 shadow-[0_0_15px_rgba(147,51,234,0.05)]"
                            : "bg-orange-950/20 border-orange-500/30 text-orange-200 shadow-[0_0_15px_rgba(249,115,22,0.05)]"
                    )}>
                        {/* Power */}
                        <div className="flex flex-col items-center shrink-0">
                            <span className={cn(
                                "text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-colors",
                                excludeSubstats ? "text-purple-400" : "text-orange-400"
                            )}>Pwr</span>
                            <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                                {stats ? formatCompactNumber(stats.power) : '-'}
                            </span>
                        </div>

                        {/* Separator */}
                        <div className="w-px h-6 bg-border/50 shrink-0" />

                        {/* Damage */}
                        <div className="flex flex-col items-center shrink-0">
                            <span className="text-[9px] sm:text-[10px] text-red-400 font-bold uppercase tracking-wider">Dmg</span>
                            <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                                {stats ? formatCompactNumber(stats.totalDamage) : '-'}
                            </span>
                        </div>

                        {/* Separator */}
                        <div className="w-px h-6 bg-border/50 shrink-0" />

                        {/* Health */}
                        <div className="flex flex-col items-center shrink-0">
                            <span className="text-[9px] sm:text-[10px] text-green-400 font-bold uppercase tracking-wider">HP</span>
                            <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                                {stats ? formatCompactNumber(stats.totalHealth) : '-'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
                {/* Share / Save Shared Logic */}
                {profile.isShared ? (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={saveSharedProfile}
                        className="gap-2"
                    >
                        <Save className="w-4 h-4" />
                        <span className="hidden sm:inline">Save to My Profiles</span>
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleShare}
                        disabled={sharing}
                        // Below `sm` the label is hidden and the icon is the whole control, so the
                        // name has to come from somewhere: without this the button announces as
                        // nothing at all on a phone.
                        aria-label={justCopied ? 'Share link copied' : 'Copy a share link to this profile'}
                        className={cn("gap-2", justCopied && "text-green-400")}
                    >
                        {justCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                        <span className="hidden sm:inline">{justCopied ? 'Copied!' : 'Share'}</span>
                    </Button>
                )}

                {/* Stats Drawer Toggle */}
                <Button
                    variant="primary"
                    size="sm"
                    onClick={onStatsToggle}
                    className={cn(
                        "gap-2 shadow-lg transition-all duration-300",
                        treeMode === 'my'
                            ? "from-emerald-600 to-green-700 shadow-emerald-500/20"
                            : "from-red-600 to-rose-700 shadow-red-500/20"
                    )}
                >
                    <AnimatedClock className="w-5 h-5" />
                    <span className="hidden sm:inline">Character Stats</span>
                </Button>

            </div>

            {/* ConfirmModal removed - using native window.confirm inside Sidebar */}
        </header>
    );
}
