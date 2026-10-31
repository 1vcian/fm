import { useMemo, useState } from 'react';
import { Repeat, Layers } from 'lucide-react';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { usePersistentState } from '../hooks/usePersistentState';
import { cn } from '../lib/utils';
import { stageLabel } from '../utils/difficulty';
import achievementTitles from '../data/achievementTitles.json';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';

/**
 * Achievements wiki page, built entirely from AchievementLibrary (new in 2026_10_08_09_03).
 *
 * Every row is one tier; rows sharing a TrackerId are the tiers of one achievement, claimed in
 * Stage order. The title is rebuilt the way the client does it (AchievementState.get_Title,
 * 0x3FD4664):
 *
 *   Format(Localize("Achievement_" + Id), FormatValue(Target), FormatTime(WindowSeconds))
 *
 *   FormatValue: MainBattleReached -> the battle label of MainBattleId.FromIndex(Target),
 *                index = difficulty * 10000 + age * 100 + battle;
 *                otherwise Target + LevelDisplayOffset, where the offset is 1 for SkillLevel,
 *                PetLevel and MountLevel (levels are stored zero based) and 0 for the rest.
 *
 * The config's TitleFormat is only the designer's draft: 22 of the 154 differ from what the game
 * shows (e.g. "Upgrade a Epic Skill" vs "Upgrade an Epic Skill"). The shipped English strings
 * (Achievements string table, key "Achievement_" + Id) live in src/data/achievementTitles.json,
 * extracted from the localization bundle; TitleFormat is only the fallback for a new id.
 */

const LOCALIZED_TITLES: Record<string, string> = achievementTitles;

interface Reward {
    Amount: number;
    Type: string;
    $type: string;
}

interface Achievement {
    Id: string;
    TrackerId: string;
    Stage: number;
    IsProgressive: boolean;
    Trigger: string;
    Type: string;
    Mode: string;
    ScopeAggregation: string;
    Subject: string;
    SubjectInt: number;
    Target: number;
    WindowSeconds: number;
    GraceSeconds: number;
    TitleFormat: string;
    Rewards: Reward[] | null;
}

interface Tracker {
    id: string;
    category: string;
    type: string;
    mode: string;
    windowSeconds: number;
    tiers: Achievement[];
    gems: number;
}

const LEVEL_OFFSET_TYPES = new Set(['SkillLevel', 'PetLevel', 'MountLevel']);

const nf = new Intl.NumberFormat('en-US');

function formatValue(a: Achievement): string {
    if (a.Type === 'MainBattleReached') {
        const difficulty = Math.floor(a.Target / 10000);
        const age = Math.floor(a.Target / 100) % 100;
        const battle = a.Target % 100;
        return stageLabel(difficulty, age, battle);
    }
    return nf.format(a.Target + (LEVEL_OFFSET_TYPES.has(a.Type) ? 1 : 0));
}

function formatWindow(seconds: number): string {
    if (seconds <= 0) return '';
    if (seconds < 3600) {
        const m = Math.round(seconds / 60);
        return `${m} minute${m === 1 ? '' : 's'}`;
    }
    if (seconds <= 86400) {
        const h = Math.round(seconds / 3600);
        return `${h} hour${h === 1 ? '' : 's'}`;
    }
    const d = Math.round(seconds / 86400);
    return `${d} day${d === 1 ? '' : 's'}`;
}

function formatTitle(a: Achievement): string {
    return (LOCALIZED_TITLES[a.Id] ?? a.TitleFormat)
        .replace(/\{0\}/g, formatValue(a))
        .replace(/\{1\}/g, formatWindow(a.WindowSeconds))
        .trim();
}

/** Category from the achievement type: the trigger alone mixes areas (NextDay covers several). */
function categoryOf(type: string): string {
    if (type === 'MainBattleReached' || type === 'EnemyDefeats') return 'Battle';
    if (/^(HammersSpent|ForgeUpgrades|Ascensions)/.test(type)) return 'Forge';
    if (type === 'CurrencyBalance') return 'Savings';
    if (/Skill/.test(type) && !/Skin/.test(type)) return 'Skills';
    if (/Pet/.test(type) && !/^Arena/.test(type)) return 'Pets';
    if (/^Mount/.test(type)) return 'Mounts';
    if (/^(Dungeon|SteppingStone)/.test(type)) return 'Dungeons';
    if (/^Arena/.test(type)) return 'Arena';
    if (/Mission/.test(type)) return 'Missions';
    if (type === 'PersonalTechTreeMinimumCompletion') return 'Tech Tree';
    if (/ClanTech/.test(type)) return 'Clan Tech';
    if (/^ClanWar/.test(type)) return 'Clan War';
    if (/^Fairy/.test(type)) return 'Fairies';
    if (/Skin/.test(type)) return 'Skins';
    return 'General';
}

const CATEGORY_ORDER = [
    'Battle', 'Forge', 'Savings', 'Skills', 'Pets', 'Mounts', 'Dungeons', 'Arena', 'Missions',
    'Tech Tree', 'Clan Tech', 'Clan War', 'Fairies', 'Skins', 'General',
];

/** How progress counts, in the words a player would use. */
const MODE_INFO: Record<string, { label: string; hint: string }> = {
    Counter: { label: 'Total', hint: 'Counts up over your whole account' },
    HighestValue: { label: 'Reach', hint: 'Your best value at any moment' },
    FixedWindowCounter: { label: 'Timed', hint: 'Must be done inside the time window' },
    Streak: { label: 'Streak', hint: 'Consecutive, a break resets the count' },
    ScopedCounter: { label: 'Total', hint: 'Counts up within one scope (clan, season)' },
    ScopedHighestValue: { label: 'Reach', hint: 'Best value within one scope (clan, season)' },
};

function rewardGems(a: Achievement): number {
    return (a.Rewards ?? []).filter(r => r.Type === 'Gems').reduce((s, r) => s + r.Amount, 0);
}

export default function AchievementsWiki() {
    const { data, loading, error } = useGameData<Record<string, Achievement>>('AchievementLibrary.json');
    const [search, setSearch] = useState('');
    const [category, setCategory] = usePersistentState<string>('wiki_achievements_category', 'All');

    const trackers = useMemo<Tracker[]>(() => {
        if (!data) return [];
        const byTracker = new Map<string, Achievement[]>();
        for (const a of Object.values(data)) {
            const list = byTracker.get(a.TrackerId) ?? [];
            list.push(a);
            byTracker.set(a.TrackerId, list);
        }
        return [...byTracker.entries()].map(([id, tiers]) => {
            tiers.sort((x, y) => x.Stage - y.Stage);
            const first = tiers[0];
            return {
                id,
                category: categoryOf(first.Type),
                type: first.Type,
                mode: first.Mode,
                windowSeconds: first.WindowSeconds,
                tiers,
                gems: tiers.reduce((s, t) => s + rewardGems(t), 0),
            };
        });
    }, [data]);

    const categories = useMemo(() => {
        const present = new Set(trackers.map(t => t.category));
        return CATEGORY_ORDER.filter(c => present.has(c));
    }, [trackers]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return trackers
            .filter(t => category === 'All' || t.category === category)
            .filter(t => !q || t.tiers.some(a => formatTitle(a).toLowerCase().includes(q)));
    }, [trackers, category, search]);

    const grouped = useMemo(() => {
        const out = new Map<string, Tracker[]>();
        for (const c of CATEGORY_ORDER) {
            const list = visible.filter(t => t.category === c);
            if (list.length) out.set(c, list);
        }
        return out;
    }, [visible]);

    const totals = useMemo(() => ({
        achievements: trackers.length,
        tiers: trackers.reduce((s, t) => s + t.tiers.length, 0),
        gems: trackers.reduce((s, t) => s + t.gems, 0),
    }), [trackers]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted animate-pulse">
                <GameAssetIcon asset={{ icon: 'PotionsRace' }} size={48} className="mb-4 opacity-20" />
                <p>Loading achievements</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <Card className="p-6 flex items-start gap-3">
                    <GameAssetIcon asset={{ icon: 'WarningSign' }} size={20} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="font-bold text-text-primary">Achievements could not be loaded</p>
                        <p className="text-sm text-text-secondary mt-1">
                            The achievement table (AchievementLibrary) did not load. Reload the page to try again.
                        </p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-accent-primary flex items-center gap-2">
                <GameAssetIcon asset={{ icon: 'PotionsRace' }} size={28} /> Achievements
            </h1>

            <div className="grid grid-cols-3 gap-3">
                {[
                    { label: 'Achievements', value: nf.format(totals.achievements) },
                    { label: 'Tiers', value: nf.format(totals.tiers) },
                    { label: 'Total gems', value: nf.format(totals.gems), icon: 'GemIcon' },
                ].map(s => (
                    <Card key={s.label} className="p-3 text-center">
                        <div className="text-[10px] uppercase tracking-widest text-text-muted font-bold">{s.label}</div>
                        <div className="text-xl font-black text-text-primary flex items-center justify-center gap-1.5 mt-1 tabular-nums">
                            {s.icon && <GameIcon name={s.icon} size={18} />}
                            {s.value}
                        </div>
                    </Card>
                ))}
            </div>

            <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <div className="relative md:w-72">
                    <GameAssetIcon asset={{ icon: 'SearchIcon' }} size={16} className="absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search achievements"
                        className="w-full bg-bg-input/50 border border-border rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent-primary"
                    />
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {['All', ...categories].map(c => (
                        <button
                            key={c}
                            onClick={() => setCategory(c)}
                            className={cn(
                                'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                                category === c
                                    ? 'bg-accent-primary text-black border-accent-primary'
                                    : 'text-text-muted border-border hover:text-text-primary hover:bg-white/5'
                            )}
                        >
                            {c}
                        </button>
                    ))}
                </div>
            </div>

            {grouped.size === 0 && (
                <p className="text-sm text-text-muted py-10 text-center">No achievements match.</p>
            )}

            {[...grouped.entries()].map(([cat, list]) => (
                <section key={cat} className="space-y-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-text-muted pt-2">
                        {cat} <span className="opacity-60">({list.length})</span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {list.map(t => (
                            <TrackerCard key={t.id} tracker={t} />
                        ))}
                    </div>
                </section>
            ))}

            <p className="text-xs text-text-secondary">
                Tiers of one achievement are claimed in order, each for its own reward. Level goals
                read as in game (a stored target of 99 is shown as level 100).
            </p>
        </div>
    );
}

function TrackerCard({ tracker }: { tracker: Tracker }) {
    const mode = MODE_INFO[tracker.mode] ?? { label: tracker.mode, hint: '' };
    const single = tracker.tiers.length === 1;
    const window = formatWindow(tracker.windowSeconds);

    return (
        <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="font-bold text-text-primary text-sm leading-snug">
                        {formatTitle(tracker.tiers[single ? 0 : tracker.tiers.length - 1])}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span
                            title={mode.hint}
                            className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted"
                        >
                            {tracker.mode === 'Streak' ? <Repeat className="w-3 h-3" /> : null}
                            {mode.label}
                        </span>
                        {window && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400">
                                <GameAssetIcon asset={{ icon: 'Timer' }} size={12} /> {window}
                            </span>
                        )}
                        {!single && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-primary/30 text-accent-primary">
                                <Layers className="w-3 h-3" /> {tracker.tiers.length} tiers
                            </span>
                        )}
                    </div>
                </div>
                <span className="flex items-center gap-1 text-sm font-black text-text-primary tabular-nums shrink-0">
                    <GameIcon name="GemIcon" size={16} />
                    {nf.format(tracker.gems)}
                </span>
            </div>

            {!single && (
                <table className="w-full text-xs mt-3">
                    <tbody>
                        {tracker.tiers.map(a => (
                            <tr key={a.Id} className="border-t border-border/40">
                                <td className="py-1 pr-2 text-text-muted tabular-nums w-6">{a.Stage}</td>
                                <td className="py-1 text-text-secondary">{formatTitle(a)}</td>
                                <td className="py-1 text-right tabular-nums text-text-primary font-semibold whitespace-nowrap">
                                    <span className="inline-flex items-center gap-1">
                                        <GameIcon name="GemIcon" size={12} />
                                        {nf.format(rewardGems(a))}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );
}
