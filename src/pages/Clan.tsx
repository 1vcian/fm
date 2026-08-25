import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Users, Swords, Heart, Info, Cpu, Coins, Plus, Minus, Loader2, AlertTriangle,
    ArrowDownToLine, ArrowUpFromLine, Check, X,
} from 'lucide-react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { ResourcesEditor } from '../components/Profile/ResourcesEditor';
import { SectionSyncButton } from '../components/Profile/SectionSyncButton';
import { ClanTabShell } from '../components/Clan/ClanTabShell';
import { useProfile } from '../context/ProfileContext';
import { useClan } from '../context/ClanContext';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { useGlobalStats } from '../hooks/useGlobalStats';
import { useComparison } from '../context/ComparisonContext';
import { getTechNodeName, getClanIconStyle } from '../utils/techUtils';
import { formatCompactNumber } from '../utils/statsCalculator';
import { cn } from '../lib/utils';

type Tab = 'clan' | 'tree' | 'resources';

const TAB_IDS: Tab[] = ['clan', 'tree', 'resources'];

function isTab(value: string | null): value is Tab {
    return !!value && (TAB_IDS as string[]).includes(value);
}

/* ------------------------------------------------------------------------------------------ *
 * Clan-tree levels: comparing the local copy against the clan's shared row
 * ------------------------------------------------------------------------------------------ */

/**
 * Both sides of the comparison as one sanitised map.
 *
 * `profile.techTree.Clan` is local data an old build may have written; `clan_tree.levels` is
 * server jsonb that other people wrote. Neither is trusted: non-integer ids, negative levels,
 * `NaN` and strings are dropped, and a level of 0 is treated as absence because that is what it
 * means (the RPC strips zeros server-side, and every node defaults to 0).
 */
function readLevels(source: Record<string, number> | Record<number, number> | null | undefined): Map<number, number> {
    const out = new Map<number, number>();
    if (!source) return out;
    for (const [key, raw] of Object.entries(source)) {
        const id = Number(key);
        const level = Number(raw);
        if (Number.isInteger(id) && id >= 0 && Number.isFinite(level) && level > 0) {
            out.set(id, Math.round(level));
        }
    }
    return out;
}

interface TreeDiff {
    /** Nodes whose level is not the same on both sides. */
    changed: number;
    /** Of those, how many would go UP if `mine` were replaced by `theirs`. */
    up: number;
    /** and how many would go DOWN. This is the number that makes a pull worth confirming. */
    down: number;
    mineNodes: number;
    mineLevels: number;
    theirsNodes: number;
    theirsLevels: number;
}

function sumLevels(levels: Map<number, number>): number {
    let total = 0;
    for (const value of levels.values()) total += value;
    return total;
}

/** What changes if `mine` is replaced by `theirs`. Direction matters, so the names are explicit. */
function diffLevels(mine: Map<number, number>, theirs: Map<number, number>): TreeDiff {
    let changed = 0;
    let up = 0;
    let down = 0;
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
        const a = mine.get(id) || 0;
        const b = theirs.get(id) || 0;
        if (a === b) continue;
        changed++;
        if (b > a) up++;
        else down++;
    }
    return {
        changed,
        up,
        down,
        mineNodes: mine.size,
        mineLevels: sumLevels(mine),
        theirsNodes: theirs.size,
        theirsLevels: sumLevels(theirs),
    };
}

export default function Clan() {
    const { profile, getTechLevel, updateProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { excludeSubstats } = useComparison();
    const stats = useGlobalStats(excludeSubstats);
    const clan = useClan();

    // The header's clan chip lands on `#/clan?tab=clan`, so the tab is readable from the URL. It is
    // still local state: switching tabs by hand must not push a history entry per click.
    const [searchParams] = useSearchParams();
    const urlTab = searchParams.get('tab');
    const [tab, setTab] = useState<Tab>(() => (isTab(urlTab) ? urlTab : 'tree'));
    useEffect(() => {
        if (isTab(urlTab)) setTab(urlTab);
    }, [urlTab]);

    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: clanIconsMap } = useGameData<any>('ClanTechTreeIconsMap.json');
    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');

    const hasClan = !!selectedVersion && selectedVersion >= '2026_07_14_16_51';

    /**
     * WHO MAY EDIT THE 61 BOXES BELOW: nobody who is a plain member of a clan.
     *
     * `clan.role` is the role of the ACTIVE PROFILE (membership's primary key is `profile_id`) and
     * is `null` for every state with no clan in it: no backend in this build, signed out, a shared
     * profile on screen, still loading, or simply in no clan. All of those keep the page the fully
     * editable personal editor it has always been — that is the pre-existing feature and it must
     * not regress. Once the profile IS in a clan, this tree reads as the CLAN's tree, and only its
     * leaders touch it.
     *
     * WHY THE CONTROLS ARE HIDDEN AND NOT DISABLED: a row of greyed-out steppers next to somebody
     * else's numbers invites a member to keep pressing them. Absent is clearer than inert.
     *
     * A previous revision argued the opposite — that hiding them cost a member whose leaders had
     * published nothing the ability to enter clan levels at all, leaving their war cards at base.
     * That argument was wrong because it missed where a member edits their own copy:
     * `src/components/Profile/TechTreePanel.tsx`, the "Tech Tree" spoiler on the Profile page, has a
     * **Clan tab with the same ±1/±10 steppers** and writes the same `profile.techTree.Clan`
     * through `updateProfile`. So a member has two ways to fill their own copy — by hand there, or
     * with "Copy from clan" here — and this page stays what it says it is. `MemberTreeHint` below
     * points them at it, so the door is signposted rather than merely unlocked.
     *
     * The shared row is a separate thing again: only "Publish to clan" writes it, only a leader
     * sees that button, and `set_clan_tree` answers 42501 to a member regardless — the client gate
     * is UX, the server is the boundary.
     */
    const clanRole = clan.role;

    /** Owner/admin, or no clan at all (the personal-editor case). Never a plain member. */
    const canEditClanTree = clanRole === null || clanRole === 'owner' || clanRole === 'admin';

    /**
     * The clan's SHARED tree, for comparison against the local copy below. Every node card shows
     * the clan's level next to its own when the two disagree, so "N nodes differ" in the sync bar
     * is never a number the reader has to take on trust.
     */
    const sharedLevels = useMemo(() => readLevels(clan.tree?.levels), [clan.tree]);
    const localLevels = useMemo(() => readLevels(profile.techTree?.Clan), [profile.techTree?.Clan]);

    /**
     * `MaxLevel` per flattened globalId. Same flattening as `categories` below and as
     * `ClanContext.clanNodeCaps`, with the same `?? 20` fallback, so the three cannot disagree.
     */
    const nodeCaps = useMemo(() => {
        const caps = new Map<number, number>();
        if (!guildPositionLibrary) return caps;
        let globalId = 0;
        for (const name of Object.keys(guildPositionLibrary)) {
            for (const type of guildPositionLibrary[name]?.Nodes || []) {
                const max = guildUpgradeLibrary?.[type]?.MaxLevel;
                caps.set(globalId, typeof max === 'number' && max > 0 ? Math.floor(max) : 20);
                globalId += 1;
            }
        }
        return caps;
    }, [guildPositionLibrary, guildUpgradeLibrary]);

    /**
     * WHAT A PULL WOULD ACTUALLY LEAVE BEHIND — which is not always what the clan published.
     *
     * `pullTree` clamps every level to this config's `MaxLevel`, so a shared 18 on a /10 node is
     * stored as 10. Diffing against the RAW row therefore reported "1 node differs" for ever, on a
     * profile that was already carrying everything a pull could give it — and with clan sync on that
     * became the permanent resting state, with the bar contradicting the button ("1 node differs" /
     * "nothing to copy"). The DIFF is computed on the clamped row; the per-node "clan N" chips below
     * still print the RAW published number, because "the clan published 18, your version caps it at
     * 10" is exactly the fact a reader needs at that card.
     */
    const pullableLevels = useMemo(() => {
        if (nodeCaps.size === 0) return sharedLevels;
        const out = new Map<number, number>();
        for (const [id, level] of sharedLevels) {
            const cap = nodeCaps.get(id);
            if (cap === undefined) continue; // not a node in this config
            const capped = Math.min(level, cap);
            if (capped > 0) out.set(id, capped);
        }
        return out;
    }, [sharedLevels, nodeCaps]);

    const treeDiff = useMemo(() => diffLevels(localLevels, pullableLevels), [localLevels, pullableLevels]);

    // Write a clan node level straight into profile.techTree.Clan so every calculator,
    // counter and the war stats below react to the change (same store the rest of the app reads).
    const setClanLevel = (globalId: number, level: number, max: number) => {
        const v = Math.max(0, Math.min(Math.round(level), max));
        updateProfile({
            techTree: { ...profile.techTree, Clan: { ...profile.techTree.Clan, [globalId]: v } },
        });
    };

    // Flatten clan categories -> sequential globalId (must match TechTree.tsx).
    const categories = useMemo(() => {
        if (!guildPositionLibrary) return [] as { name: string; nodes: { globalId: number; type: string }[] }[];
        let globalId = 0;
        return Object.keys(guildPositionLibrary).map(name => ({
            name,
            nodes: (guildPositionLibrary[name]?.Nodes || []).map((type: string) => ({ globalId: globalId++, type })),
        }));
    }, [guildPositionLibrary]);

    const warMult = (type: string): number => {
        const node = categories.flatMap(c => c.nodes).find((n: { type: string }) => n.type === type);
        const def = node ? guildUpgradeLibrary?.[type] : null;
        // VERIFIED IN GAME (2026-08-24): the node caps at +10000% ("10k%") at MaxLevel 100, so
        // ValuePerLevel = 1.0 is a MULTIPLIER addend of +100% per level, not "1 percent". The old
        // "/100" here assumed +1%/level and under-reported war damage and health by 100x.
        // This matches every other consumer (useCalculatedStats does ValuePerLevel * level with no
        // division), so the guild ValuePerLevel semantics are now uniform across the codebase.
        return node ? (def?.ValuePerLevel || 0) * getTechLevel('Clan', node.globalId) : 0;
    };
    const warDamageMult = warMult('ClanWarDamage');
    const warHealthMult = warMult('ClanWarHealth');

    const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
        { id: 'clan', label: 'Clan', icon: <Users className="w-4 h-4" /> },
        { id: 'tree', label: 'My Tree', icon: <Cpu className="w-4 h-4" /> },
        { id: 'resources', label: 'My Resources', icon: <Coins className="w-4 h-4" /> },
    ];

    return (
        <div className="max-w-[100rem] mx-auto space-y-6 animate-fade-in pb-12 px-4 xl:px-8">
            <div className="flex items-center gap-4 border-b border-border pb-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-primary/30 to-accent-secondary/20 flex items-center justify-center border border-accent-primary/30">
                    <Users className="w-7 h-7 text-accent-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">Clan</h1>
                    <p className="text-text-muted text-sm">
                        {clan.status === 'unconfigured'
                            ? 'Your clan tech tree, resources, and (soon) shared clan tools'
                            : 'Your clan tech tree, your resources, and your clan'}
                    </p>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-2 flex-wrap">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 border',
                            tab === t.id
                                ? 'bg-accent-primary text-white border-accent-primary shadow-lg shadow-accent-primary/20'
                                : 'bg-bg-input text-text-secondary border-border hover:border-accent-primary/40 hover:text-white'
                        )}
                    >
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {/* ---- THE CLAN ITSELF ---- */}
            {tab === 'clan' && <ClanTabShell />}

            {/* ---- MY TREE ---- */}
            {tab === 'tree' && (
                !hasClan ? (
                    <Card className="p-6 text-text-muted">Clan tech is not available for this data version.</Card>
                ) : !guildPositionLibrary || !guildUpgradeLibrary ? (
                    <Card className="p-6 text-text-muted">Loading clan tech</Card>
                ) : (
                    <div className="space-y-6">
                        {/* In a clan, the tree below is the CLAN's. So say what the clan has, and
                            offer the two directions: every member pulls, leaders also publish. */}
                        <ClanTreeSyncBar diff={treeDiff} localLevels={localLevels} />

                        {/* Read the clan tree straight off a screenshot instead of clicking 61 nodes.
                            Same preset the Tech Tree spoiler uses; the reader merges several scrolled
                            captures, so a whole page can be filled from 4-5 shots.
                            Leaders only: for a plain member this tree is read-only, so a scanner that
                            writes it is not a tool they are missing. It is a control that would do
                            nothing they are allowed to do. */}
                        {canEditClanTree && (
                            <div className="flex items-center justify-end">
                                <SectionSyncButton preset="clanTree" label="Scan clan tree" />
                            </div>
                        )}

                        {/* War stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Card className="p-4 border-2 border-red-500/30 bg-red-500/5">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-400 mb-2"><Swords className="w-4 h-4" /> Attack during War</div>
                                <div className="text-2xl font-black text-white">{formatCompactNumber((stats?.totalDamage || 0) * (1 + warDamageMult))}</div>
                                <div className="text-[11px] text-text-muted mt-1">Base {formatCompactNumber(stats?.totalDamage || 0)}{warDamageMult > 0 && <span className="text-red-400"> · +{(warDamageMult * 100).toFixed(0)}% war</span>}</div>
                            </Card>
                            <Card className="p-4 border-2 border-green-500/30 bg-green-500/5">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-400 mb-2"><Heart className="w-4 h-4" /> Health during War</div>
                                <div className="text-2xl font-black text-white">{formatCompactNumber((stats?.totalHealth || 0) * (1 + warHealthMult))}</div>
                                <div className="text-[11px] text-text-muted mt-1">Base {formatCompactNumber(stats?.totalHealth || 0)}{warHealthMult > 0 && <span className="text-green-400"> · +{(warHealthMult * 100).toFixed(0)}% war</span>}</div>
                            </Card>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-text-muted">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-primary" />
                            <span>
                                {canEditClanTree
                                    ? <>Edit any node below. It writes to this profile only, so all your calculators and counters update instantly.{' '}</>
                                    : <>This is your clan&apos;s tree and only its leaders change it. To set your own copy by hand, open <b className="text-text-secondary">Tech Tree → Clan</b> on your <Link to="/" className="text-accent-primary hover:underline font-semibold">profile</Link>. Or use <b className="text-text-secondary">Copy from clan</b> above to take your leaders&apos; version in one step.{' '}</>}
                                {canEditClanTree && clanRole !== null && 'Where your clan has published a different level, it is shown beside yours in amber; "Copy from clan" above replaces all 61 of your levels with theirs. '}
                                ClanWarDamage / ClanWarHealth apply only during Clan War/Brawl (excluded from your normal stats); they scale +100%/level, so a maxed node is +10000%. Verified against the in-game tree.
                            </span>
                        </div>

                        {categories.map(cat => (
                            <div key={cat.name} className="space-y-3">
                                <h3 className="text-sm font-bold text-accent-primary capitalize border-b border-white/5 pb-2">{cat.name.replace(/([A-Z])/g, ' $1').trim()}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {cat.nodes.map(({ globalId, type }: { globalId: number; type: string }) => {
                                        const def = guildUpgradeLibrary?.[type];
                                        const maxLevel = def?.MaxLevel ?? 20;
                                        const level = getTechLevel('Clan', globalId);
                                        // Used by the heading AND by every control's accessible name below.
                                        const nodeName = getTechNodeName(type);
                                        const valPerLevel = def?.ValuePerLevel ?? 0;
                                        const style = getClanIconStyle(type, clanIconsMap, selectedVersion, import.meta.env.BASE_URL, treeMapping);
                                        const pct = maxLevel > 0 ? (level / maxLevel) * 100 : 0;
                                        return (
                                            <Card key={globalId} className={cn('p-3 flex flex-col gap-2.5 border-2 transition-colors',
                                                level >= maxLevel ? 'border-green-500/50 bg-green-500/10' : level > 0 ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border/50 bg-bg-primary/50')}>
                                                <div className="flex gap-3 items-center">
                                                    <div className="w-11 h-11 rounded-xl bg-bg-input border border-border overflow-hidden shrink-0 flex items-center justify-center">
                                                        {style ? <div className="w-full h-full" style={style} /> : <Cpu className="w-5 h-5 text-text-muted" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="text-xs font-bold whitespace-nowrap overflow-hidden text-clip">{nodeName}</h4>
                                                        <p className="text-[9px] text-text-muted uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                                                            <span>Rank {level}/{maxLevel}</span>
                                                            {/* The clan's published level, but only when it disagrees with this
                                                                copy: printing "clan 7" next to a 7 would be noise on 61 cards. */}
                                                            {clanRole !== null && (sharedLevels.get(globalId) ?? 0) !== level && (
                                                                <span
                                                                    className="normal-case tracking-normal font-bold text-amber-400"
                                                                    title={`Your clan has published this node at ${sharedLevels.get(globalId) ?? 0}. "Copy from clan" replaces your level with theirs.`}
                                                                >
                                                                    clan {sharedLevels.get(globalId) ?? 0}
                                                                </span>
                                                            )}
                                                        </p>
                                                        <div className="text-[9px] font-mono flex items-center gap-1 mt-0.5 flex-wrap">
                                                            <SpriteIcon name="GuildPotions" size={11} />
                                                            <span className="text-green-400">{(def?.PointsPerLevel ?? 0).toLocaleString()}</span><span className="opacity-60">/lvl</span>
                                                            {valPerLevel > 0 && <span className="opacity-60">· +{(valPerLevel * 100).toFixed(valPerLevel < 0.1 ? 1 : 0)}%/lvl</span>}
                                                        </div>
                                                    </div>
                                                    {valPerLevel > 0 && level > 0 && (
                                                        <div className="text-right shrink-0">
                                                            <div className="text-[8px] text-text-muted uppercase tracking-wider">Now</div>
                                                            <div className="text-xs font-black text-accent-primary">+{(valPerLevel * level * 100).toFixed(valPerLevel < 0.1 ? 1 : 0)}%</div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* progress */}
                                                <div className="h-1 rounded-full bg-bg-input overflow-hidden">
                                                    <div className={cn('h-full rounded-full transition-all', level >= maxLevel ? 'bg-green-500' : 'bg-accent-primary')} style={{ width: `${pct}%` }} />
                                                </div>

                                                {/* stepper. ±10 on the outside: clan nodes go up to 100, so stepping
                                                    by 1 is unusable. Leaders only once this profile is in a clan;
                                                    a plain member reads the level and uses "Copy from clan", or
                                                    edits their own copy from the Profile page's Tech Tree. */}
                                                {/* Every control names its NODE. There are 61 of these on the page,
                                                    so a bare "Decrease level" is 61 identical announcements and a
                                                    bare number box is 61 unlabelled fields. */}
                                                {!canEditClanTree ? (
                                                    <div className="flex items-center justify-center bg-bg-input rounded-lg border border-border py-1.5">
                                                        <span className="font-mono font-bold text-sm text-white">
                                                            {level}
                                                            <span className="text-text-muted font-normal">/{maxLevel}</span>
                                                        </span>
                                                    </div>
                                                ) : (
                                                <div className="flex items-center justify-between gap-0.5 bg-bg-input rounded-lg border border-border">
                                                    <button
                                                        type="button"
                                                        aria-label={`${nodeName}: ten levels down`}
                                                        title="-10"
                                                        className="px-1.5 py-1.5 text-[10px] font-bold text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level <= 0}
                                                        onClick={() => setClanLevel(globalId, Math.max(0, level - 10), maxLevel)}
                                                    >
                                                        -10
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={`${nodeName}: one level down`}
                                                        className="px-2 py-1.5 text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level <= 0}
                                                        onClick={() => setClanLevel(globalId, level - 1, maxLevel)}
                                                    >
                                                        <Minus className="w-3.5 h-3.5" />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        aria-label={`${nodeName} level, 0 to ${maxLevel}`}
                                                        className="bg-transparent text-center font-mono font-bold text-sm text-white w-full min-w-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        value={level}
                                                        min={0}
                                                        max={maxLevel}
                                                        onChange={e => { const v = parseInt(e.target.value); setClanLevel(globalId, isNaN(v) ? 0 : v, maxLevel); }}
                                                        onFocus={e => e.target.select()}
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label={`${nodeName}: one level up`}
                                                        className="px-2 py-1.5 text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level >= maxLevel}
                                                        onClick={() => setClanLevel(globalId, level + 1, maxLevel)}
                                                    >
                                                        <Plus className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={`${nodeName}: ten levels up`}
                                                        title="+10"
                                                        className="px-1.5 py-1.5 text-[10px] font-bold text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level >= maxLevel}
                                                        onClick={() => setClanLevel(globalId, Math.min(maxLevel, level + 10), maxLevel)}
                                                    >
                                                        +10
                                                    </button>
                                                </div>
                                                )}
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {/* ---- MY RESOURCES ---- */}
            {tab === 'resources' && <ResourcesEditor />}
        </div>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * ClanTreeSyncBar — the two directions of the shared clan tree
 * ------------------------------------------------------------------------------------------ */

/**
 * THE DIRECTIONS, AND WHY THEY ARE NAMED THIS WAY
 * ----------------------------------------------
 * "Copy from clan" **pulls**: it copies the clan's shared tree INTO this profile
 * (`profile.techTree.Clan`), which is what every calculator on this page and in the rest of the app
 * reads. It sends nothing. Every member gets it — it needs no privilege, only a read the RLS policy
 * already allows plus a local write.
 *
 * "Publish to clan" **pushes**, and only leaders see it: `set_clan_tree()` is owner/admin-only, and
 * it replaces the row the whole clan pulls from.
 *
 * The pull used to be called "Sync to clan", which names the wrong direction: it reads as "send my
 * levels to the clan", which is what the OTHER button does. The two labels now form a pair whose
 * preposition is the whole meaning — from / to — and each still restates the direction in its
 * confirmation before anything is overwritten.
 *
 * BOTH DIRECTIONS OVERWRITE, SO BOTH ASK FIRST
 * -------------------------------------------
 * `pullTree()` replaces `techTree.Clan` wholesale rather than merging (a leftover local level for a
 * node the leaders have since zeroed would be a silent lie), and `saveTree()` replaces the shared
 * row for everyone. Neither is undoable, so each one states what changes — how many nodes, how many
 * go up, how many go DOWN, and the level totals before and after — and waits for a second click.
 * The per-node "clan N" chips on the cards below are the same numbers, node by node.
 *
 * "COPY FROM CLAN" STAYS, EVEN THOUGH CLAN SYNC USUALLY GETS THERE FIRST
 * --------------------------------------------------------------------
 * With the setting on (`ClanContext`'s auto-pull) the pull normally happens by itself the moment a
 * leader publishes, so this button's honest answer becomes "there was nothing to copy" — which it
 * now says, rather than reporting a copy it did not make. It is still the only way to pull with the
 * setting off, the only way to pull inside the leaders' quiet window, and the only way to retry
 * after a failed automatic attempt, so it is not a vestige.
 */
type PendingSync = 'pull' | 'push';

const ClanTreeSyncBar: React.FC<{ diff: TreeDiff; localLevels: Map<number, number> }> = ({ diff, localLevels }) => {
    const clan = useClan();
    const [pending, setPending] = useState<PendingSync | null>(null);
    const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
    const [working, setWorking] = useState(false);

    // Not in a clan: the tree below belongs to nobody but this profile, and there is nothing to
    // sync with. This is also the no-backend / signed-out / shared-profile path — and the moment
    // just after a profile switch, when ClanContext has dropped the previous profile's clan and not
    // yet loaded this one's, which is why neither direction can be aimed at the wrong clan.
    if (!clan.role || !clan.clan) return null;

    const isLeader = clan.role === 'owner' || clan.role === 'admin';

    /**
     * A demotion can land (over Realtime) while the push confirmation is already open, and the
     * confirmation below does not re-test the role. `pending` is therefore read through this, so a
     * member who stopped being a leader mid-decision falls back to the buttons they may still use
     * instead of keeping a leaders-only confirm button on screen — this page hides what it cannot
     * do, it does not disable it.
     */
    const activePending = pending === 'push' && !isLeader ? null : pending;
    const hasShared = !!clan.tree;
    const inSync = hasShared && diff.changed === 0;

    /**
     * `set_clan_tree()` is the authority on who may write, and it answers 42501 when this profile is
     * not a leader. Reaching that means the role this bar drew its buttons from is WRONG — the user
     * was demoted, or is looking at a snapshot that has moved on — so the honest response is to go
     * and ask the server again rather than leave a Publish button on screen that has already been
     * refused once. Same treatment for the two neighbouring answers ("not in this clan", "not your
     * profile"), which mean the same thing about the role: it is stale.
     */
    const resyncIfRoleWasWrong = async (kind: string) => {
        if (kind === 'not-a-leader' || kind === 'not-a-member' || kind === 'not-your-profile') {
            await clan.refresh();
        }
    };

    const run = async (which: PendingSync) => {
        setWorking(true);
        setFeedback(null);
        try {
            if (which === 'pull') {
                const result = await clan.pullTree();
                if (!result.ok) await resyncIfRoleWasWrong(result.error.kind);
                setFeedback(
                    result.ok
                        // A press that moved nothing must not claim to have copied something. With
                        // clan sync on this is the NORMAL answer — the automatic pull has already
                        // been here — and saying so is the difference between a button that looks
                        // broken and one that confirms the tree is already the clan's.
                        ? result.data.changed === 0
                            ? {
                                tone: 'ok',
                                text: `Nothing to copy: this profile already holds exactly the clan's published levels (${result.data.nodes} node${result.data.nodes === 1 ? '' : 's'} above 0).`
                                    + (clan.clanSyncEnabled
                                        ? ' Clan sync is on, so it had already brought the two in step.'
                                        : ''),
                            }
                            : {
                                tone: 'ok',
                                text: `Copied the clan's shared tree into this profile. ${result.data.changed} node${result.data.changed === 1 ? '' : 's'} changed (${result.data.up} up, ${result.data.down} down), ${result.data.nodes} above 0. Your stats and every calculator now use the clan's levels.`
                                    // Never silent: a reduced level is not the number the clan published,
                                    // so the card the user is about to look at disagrees with their leader.
                                    + (result.data.clamped > 0
                                        ? ` ${result.data.clamped} node${result.data.clamped === 1 ? ' was' : 's were'} published above the level cap of the game version selected here, and ${result.data.clamped === 1 ? 'was' : 'were'} reduced to that cap.`
                                        : ''),
                            }
                        : { tone: 'bad', text: result.error.message },
                );
            } else {
                const levels: Record<string, number> = {};
                for (const [id, level] of localLevels) levels[String(id)] = level;
                const result = await clan.saveTree(levels);
                // The RPC answers with the stored row, but `?.` rather than `.`: this number is a
                // nicety and a server that answered oddly must not take the page down over it.
                const stored = Object.keys(result.ok ? result.data?.levels || {} : {}).length;
                if (!result.ok) await resyncIfRoleWasWrong(result.error.kind);
                setFeedback(
                    result.ok
                        ? {
                            tone: 'ok',
                            text: `Published. Every member now pulls ${stored} node${stored === 1 ? '' : 's'} from this tree.`,
                        }
                        : { tone: 'bad', text: result.error.message },
                );
            }
        } finally {
            setWorking(false);
            setPending(null);
        }
    };

    /* ---- the confirmation, with the numbers that make it a decision ---- */

    if (activePending) {
        // Push is the mirror of pull: a node where this profile is HIGHER than the clan goes up in
        // the clan's tree, and `diff.down` is exactly that set (it is the set the pull would lower).
        const goingUp = activePending === 'pull' ? diff.up : diff.down;
        const goingDown = activePending === 'pull' ? diff.down : diff.up;
        const from = activePending === 'pull'
            ? { nodes: diff.mineNodes, levels: diff.mineLevels }
            : { nodes: diff.theirsNodes, levels: diff.theirsLevels };
        const to = activePending === 'pull'
            ? { nodes: diff.theirsNodes, levels: diff.theirsLevels }
            : { nodes: diff.mineNodes, levels: diff.mineLevels };

        return (
            <Card className="p-4 border-2 border-amber-500/50 bg-amber-500/5">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-3">
                        <div>
                            <h3 className="font-black text-white text-sm">
                                {activePending === 'pull'
                                    ? `Replace your clan tree with ${clan.clan.name}'s?`
                                    : `Replace ${clan.clan.name}'s shared tree with yours?`}
                            </h3>
                            <p className="text-xs text-text-secondary mt-1">
                                {activePending === 'pull'
                                    ? 'This overwrites the clan tree stored in this profile. Levels you typed here that the clan has not published are lost. Nothing else in your profile is touched.'
                                    : `This overwrites the tree every member of ${clan.clan.name} pulls from. Only leaders can do it, and there is no undo.`}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                            <div className="rounded-lg border border-border bg-bg-input/60 px-3 py-2">
                                <div className="text-[9px] uppercase tracking-widest text-text-muted">Nodes changing</div>
                                <div className="font-black text-white text-base">{diff.changed}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-bg-input/60 px-3 py-2">
                                <div className="text-[9px] uppercase tracking-widest text-text-muted">Direction</div>
                                <div className="font-bold">
                                    <span className="text-green-400">{goingUp} up</span>
                                    <span className="text-text-muted"> · </span>
                                    <span className={cn(goingDown > 0 ? 'text-red-400' : 'text-text-muted')}>{goingDown} down</span>
                                </div>
                            </div>
                            <div className="rounded-lg border border-border bg-bg-input/60 px-3 py-2">
                                <div className="text-[9px] uppercase tracking-widest text-text-muted">Total levels</div>
                                <div className="font-bold text-white">
                                    {from.levels.toLocaleString()} <span className="text-text-muted">→</span> {to.levels.toLocaleString()}
                                    <span className="text-text-muted font-normal"> ({from.nodes} → {to.nodes} nodes)</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void run(activePending)} disabled={working}>
                                {working ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                                {activePending === 'pull' ? 'Yes, take the clan\'s tree' : 'Yes, publish mine'}
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setPending(null)} disabled={working}>
                                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>
        );
    }

    /* ---- the resting bar ---- */

    return (
        <Card className={cn('p-4 border-2', inSync ? 'border-green-500/30 bg-green-500/5' : 'border-accent-primary/40 bg-accent-primary/5')}>
            <div className="flex flex-wrap items-center gap-3">
                {/* basis-full below 640px. The two buttons beside this text need about 300px
                    between them, which is a whole phone screen, so a plain `flex-1` child was
                    squeezed to a couple of characters wide and the description came out one word
                    per line. Taking the whole first row lets the buttons wrap underneath instead. */}
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-accent-primary">
                        <Users className="w-3.5 h-3.5" />
                        {clan.clan.name} [{clan.clan.tag}] · shared tree
                    </div>
                    <p className="text-xs text-text-secondary mt-1">
                        {!hasShared ? (
                            isLeader
                                ? 'Your clan has no shared tree yet. Set the levels below and publish them. Every member can then copy them in one click.'
                                : 'Your leaders have not published a shared tree yet, so the levels below are your own and nobody else sees them. Edit them freely; once the leaders publish, you can copy theirs over yours in one click.'
                        ) : inSync ? (
                            <>
                                This profile matches the clan&apos;s shared tree ({diff.theirsNodes} nodes,{' '}
                                {diff.theirsLevels.toLocaleString()} levels).
                            </>
                        ) : (
                            <>
                                <span className="text-amber-400 font-bold">{diff.changed} node{diff.changed === 1 ? ' differs' : 's differ'}</span>
                                {' '}from the clan&apos;s shared tree ({diff.theirsLevels.toLocaleString()} levels there,{' '}
                                {diff.mineLevels.toLocaleString()} here). The cards below mark each one.
                            </>
                        )}
                    </p>
                    {clan.treeInfo?.updated_at && (
                        <p className="text-[10px] text-text-muted mt-0.5">
                            Clan tree last written {new Date(clan.treeInfo.updated_at).toLocaleString()}
                            {clan.treeInfo.updated_by_name ? ` by ${clan.treeInfo.updated_by_name}` : ' by a member who has since left'}
                        </p>
                    )}
                    {/* Why the numbers below may not be the ones the user typed. Only shown when
                        the setting is on, because that is the only way they can have moved by
                        themselves. And only as the last line of the description, because it
                        explains the state the rest of this bar is describing. */}
                    {clan.clanSyncEnabled && !clan.autoPull && (
                        <p className="text-[10px] text-text-muted mt-0.5">
                            Clan sync is on: these levels follow the clan&apos;s published tree by themselves.
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    {/* The member-facing direction: a PULL. Every member gets it. */}
                    <Button
                        variant={inSync ? 'secondary' : 'primary'}
                        size="sm"
                        onClick={() => setPending('pull')}
                        disabled={!hasShared || clan.busy}
                        title={hasShared ? 'Copy the clan\'s shared tree into this profile' : 'The clan has not published a tree yet'}
                    >
                        <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" /> Copy from clan
                    </Button>
                    {isLeader && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPending('push')}
                            disabled={clan.busy || (hasShared && inSync)}
                            title={hasShared && inSync ? 'The clan already has exactly these levels' : 'Publish the levels below as the clan\'s shared tree'}
                        >
                            <ArrowUpFromLine className="w-3.5 h-3.5 mr-1.5" /> Publish to clan
                        </Button>
                    )}
                </div>
            </div>

            {/* THE AUTOMATIC PULL, ANNOUNCED. It replaced numbers this user may have typed, so it
                says how many moved and which way, and it stays until dismissed. A toast that
                fades before it is read would make the write silent, which is the one thing an
                overwrite of somebody's data may not be. The same notice is on the Profile page next
                to the switch, from the same state, so dismissing it here dismisses it there. */}
            {clan.autoPull && (
                <div
                    role="status"
                    className="mt-3 flex items-start gap-2 rounded-lg border border-accent-primary/50 bg-accent-primary/10 p-2.5 text-xs text-text-secondary"
                >
                    <ArrowDownToLine className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-primary" />
                    <span className="min-w-0 flex-1">
                        <b className="text-white">Your clan tree was updated from {clan.clan.name}.</b>{' '}
                        {clan.autoPull.changed} node{clan.autoPull.changed === 1 ? '' : 's'} changed —{' '}
                        <span className="text-green-400 font-bold">{clan.autoPull.up} up</span>,{' '}
                        <span className={cn('font-bold', clan.autoPull.down > 0 ? 'text-red-400' : 'text-text-secondary')}>
                            {clan.autoPull.down} down
                        </span>
                        . The cards below are the clan&apos;s levels, and every calculator uses them.
                        {clan.autoPull.clamped > 0 && (
                            <>
                                {' '}{clan.autoPull.clamped} of them {clan.autoPull.clamped === 1 ? 'was' : 'were'}{' '}
                                published above the level cap of the game version selected here and{' '}
                                {clan.autoPull.clamped === 1 ? 'was' : 'were'} reduced to that cap.
                            </>
                        )}
                    </span>
                    <button
                        type="button"
                        onClick={clan.dismissAutoPull}
                        aria-label="Dismiss the clan tree update notice"
                        title="Dismiss"
                        className="shrink-0 rounded p-0.5 text-text-muted hover:text-white"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            {feedback && (
                <p
                    role="status"
                    className={cn(
                        'mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs',
                        feedback.tone === 'ok'
                            ? 'border-green-500/40 bg-green-500/10 text-green-200'
                            : 'border-red-500/40 bg-red-500/10 text-red-200',
                    )}
                >
                    {feedback.tone === 'ok' ? <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span>{feedback.text}</span>
                </p>
            )}
        </Card>
    );
};
