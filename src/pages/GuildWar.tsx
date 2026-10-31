import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { getWarDayIndex, getWarDayName, computeWarDaysMap, type WarCategory } from '../utils/guildWarUtils';
import { ChevronRight } from 'lucide-react';
import { EggIcon } from '../components/UI/EggIcon';
import { cn } from '../lib/utils';
import { GameAssetIcon, type GameAsset } from '../components/UI/GameAssetIcon';

const DAYS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Calculators worth opening on a war day. Which days they show on is never written here: it comes
 * from the task categories each day carries in GuildWarDayConfigLibrary.json (computeWarDaysMap).
 */
const RECOMMENDED_TOOLS: { to: string; label: string; icon: GameAsset; categories: WarCategory[] }[] = [
    { to: '/calculators/forge', label: 'Forge Calculator', icon: { icon: 'Anvil' }, categories: ['forge', 'forgeSpend'] },
    { to: '/calculators/summons?tab=skills', label: 'Skill Summons', icon: { icon: 'SkillTicket' }, categories: ['skills'] },
    { to: '/calculators/summons?tab=mounts', label: 'Mount Trainer', icon: { sheet: 'MountIcons', index: 1 }, categories: ['mounts'] },
    { to: '/calculators/summons?tab=eggs', label: 'Eggs and Pets', icon: { icon: 'Egg' }, categories: ['eggs', 'pets'] },
    { to: '/calculators/tree', label: 'Tree Optimizer', icon: { sheet: 'ClanTechTreeIcons', index: 3 }, categories: ['tech'] },
    { to: '/dungeons', label: 'Dungeon Analyzer', icon: { icon: 'DungeonTabIcon' }, categories: ['dungeons'] },
];

const getTodayIdx = () => {
    return getWarDayIndex();
};

const getInitialDay = () => {
    return getTodayIdx();
};

export default function GuildWar() {
    const { data: dayConfig, loading: l1 } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: passConfig, loading: l2 } = useGameData<any>('GuildWarProgressPassLibrary.json');
    const { data: warConfig, loading: l3 } = useGameData<any>('GuildWarConfig.json');
    const { data: baseConfig, loading: l5 } = useGameData<any>('GuildBaseConfig.json');
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');

    const [activeDay, setActiveDay] = useState(getInitialDay());

    const loading = l1 || l2 || l3 || l5;
    const warDays = useMemo(() => computeWarDaysMap(dayConfig), [dayConfig]);

    // Process tasks for the active day
    const dayTasks = useMemo(() => {
        if (!dayConfig) return [];
        const dayData = dayConfig[activeDay] || dayConfig[String(activeDay)];
        return dayData?.Tasks || [];
    }, [dayConfig, activeDay]);

    // Process Guild Victory Points for the day
    const dayVictoryPoints = useMemo(() => {
        if (!dayConfig) return 1;
        const dayData = dayConfig[activeDay] || dayConfig[String(activeDay)];
        return dayData?.DayPoints || 0;
    }, [dayConfig, activeDay]);

    // Process milestones
    const milestones = useMemo(() => {
        if (!passConfig) return [];
        return Object.entries(passConfig)
            .map(([_, value]: [string, any]) => ({
                points: value.ProgressKey?.Amount || 0,
                rewards: value.Rewards?.[0]?.Rewards || []
            }))
            .sort((a, b) => a.points - b.points);
    }, [passConfig]);


    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-accent-primary/10 rounded-2xl border border-accent-primary/20">
                        <GameAssetIcon asset={{ icon: 'WarTicket' }} size={40} />
                    </div>
                    <div>
                        <h1 className="text-4xl font-black bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent uppercase tracking-tighter italic">
                            Guild War Wiki
                        </h1>
                        <p className="text-text-muted font-medium">Preparation, Combat & Milestone Guide</p>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 text-[10px] font-black text-text-muted uppercase tracking-[0.2em] bg-bg-secondary/50 px-3 py-1 rounded-full border border-white/5">
                        <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 10 }} size={12} />
                        Today: {getWarDayName(getWarDayIndex())} (UTC Reset)
                    </div>
                    {/* Day Selector */}
                    <div className="flex gap-1 bg-bg-secondary/30 p-1 rounded-xl border border-border w-full md:w-auto overflow-x-auto no-scrollbar">
                        {DAYS.map((name, idx) => {
                            const isToday = idx === getTodayIdx();
                            return (
                                <button
                                    key={idx}
                                    onClick={() => setActiveDay(idx)}
                                    className={cn(
                                        "px-4 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap uppercase tracking-widest relative",
                                        activeDay === idx
                                            ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/20"
                                            : "text-text-muted hover:text-text-primary hover:bg-white/5",
                                        isToday && activeDay !== idx && "border border-accent-primary/30"
                                    )}
                                >
                                    {name}
                                    {isToday && (
                                        <div className="absolute -top-1 -right-1 w-2 h-2 bg-accent-primary rounded-full shadow-[0_0_8px_rgba(var(--accent-primary-rgb),0.8)] animate-pulse" />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex flex-col items-center justify-center opacity-50">
                    <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin mb-4" />
                    <span className="text-sm font-bold uppercase tracking-widest">Loading War Logs</span>
                </div>
            ) : (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left Column: Daily Tasks & Tools */}
                        <div className="lg:col-span-2 space-y-8">
                            {/* Recommended Tools */}
                            <div className="space-y-4">
                                <h2 className="text-sm font-black text-text-muted uppercase tracking-[0.2em] flex items-center gap-2">
                                    <GameAssetIcon asset={{ icon: 'Lightning' }} size={16} />
                                    Recommended Calculators
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {!RECOMMENDED_TOOLS.some(tool => tool.categories.some(c => warDays[c]?.includes(activeDay))) && (
                                        <div className="sm:col-span-3 text-xs text-text-muted p-3">No preparation tasks on this day in the current game data.</div>
                                    )}
                                    {RECOMMENDED_TOOLS.filter(tool => tool.categories.some(c => warDays[c]?.includes(activeDay))).map(tool => {
                                        const days = Array.from(new Set(tool.categories.flatMap(c => warDays[c] || []))).sort((a, b) => a - b);
                                        return (
                                            <Link key={tool.to} to={tool.to} className="flex items-center gap-3 p-3 bg-bg-secondary/40 border border-white/5 rounded-xl hover:border-accent-primary/40 hover:bg-accent-primary/5 transition-all group shadow-sm hover:shadow-accent-primary/5">
                                                <div className="p-2 bg-bg-tertiary rounded-lg group-hover:scale-110 transition-transform">
                                                    <GameAssetIcon asset={tool.icon} size={20} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[11px] font-bold text-white whitespace-nowrap overflow-hidden text-clip">{tool.label}</div>
                                                    <div className="text-[10px] text-text-muted">{days.map(d => DAYS[d].slice(0, 3)).join(', ')}</div>
                                                </div>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
                                    <h2 className="text-xl font-bold flex items-center gap-2">
                                        <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 10 + activeDay }} size={20} />
                                        {DAYS[activeDay]} Preparation Tasks
                                    </h2>
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-2 bg-blue-500/10 text-blue-400 px-4 py-1.5 rounded-xl font-bold text-xs border border-blue-500/20 shadow-lg shadow-blue-500/5">
                                            <GameAssetIcon asset={{ sheet: 'ArenaRankIcons', index: 0 }} size={16} />
                                            Guild Win: <span className="text-blue-200">{dayVictoryPoints} Victory Points</span>
                                        </div>
                                        <div className="text-[10px] bg-accent-primary/10 text-accent-primary px-3 py-1 rounded-full font-bold uppercase tracking-widest border border-accent-primary/20">
                                            Day {activeDay + 1}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {dayTasks.map((task: any, idx: number) => (
                                        <Card key={idx} className="p-4 hover:border-accent-primary/50 transition-all group relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
                                                <GameAssetIcon asset={{ icon: 'Lightning' }} size={48} />
                                            </div>

                                            <div className="flex items-start gap-3 relative z-10">
                                                <div className="p-2 bg-bg-secondary/50 rounded-lg border border-border shrink-0">
                                                    <TaskIcon task={task.Task} size={32} sprites={sprites} skillLibrary={skillLibrary} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h3 className="text-sm font-bold text-text-primary mb-1 line-clamp-1">
                                                        {formatTaskName(task.Task)}
                                                    </h3>
                                                    <div className="flex items-center gap-1.5 mt-2">
                                                        <div className="flex items-center gap-1 bg-accent-primary/20 px-2 py-0.5 rounded text-[10px] font-bold text-accent-primary border border-accent-primary/30 uppercase tracking-tighter">
                                                            <GameAssetIcon asset={{ icon: 'Lightning' }} size={12} />
                                                            +{task.Rewards?.[0]?.Amount} Points
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                    {dayTasks.length === 0 && (
                                        <div className="sm:col-span-2 flex flex-col items-center justify-center p-12 bg-bg-secondary/20 rounded-2xl border-2 border-dashed border-border text-text-muted">
                                            <GameAssetIcon asset={{ icon: 'InfoIcon' }} size={32} className="mb-2 opacity-20" />
                                            <span className="font-bold uppercase tracking-widest text-xs">No preparation tasks for this day</span>
                                        </div>
                                    )}
                                </div>

                                {/* Schedule & Rules Breakdown */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                    <Card className="p-5 border-l-4 border-l-blue-500">
                                        <h3 className="font-black text-xs uppercase tracking-widest text-blue-500 mb-4 flex items-center gap-2">
                                            <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 10 }} size={16} /> Weekly Schedule
                                        </h3>
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-3">
                                                <div className="text-xs font-mono font-bold bg-bg-secondary px-2 py-1 rounded border border-border min-w-[100px] text-center uppercase">TUE - SUN</div>
                                                <div className="text-sm text-text-secondary">Preparation Phase (Tasks)</div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="text-xs font-mono font-bold bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/30 min-w-[100px] text-center uppercase">MONDAY</div>
                                                <div className="text-sm text-text-primary font-bold">Main Guild Battle</div>
                                            </div>
                                        </div>
                                    </Card>

                                    <Card className="p-5 border-l-4 border-l-red-500">
                                        <h3 className="font-black text-xs uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2">
                                            <GameAssetIcon asset={{ icon: 'Battle' }} size={16} /> Attack Rules
                                        </h3>
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                                <span className="text-text-muted">Max Tickets / Member</span>
                                                <span className="font-bold text-text-primary">{warConfig?.MaxWarTicketsPerMember ?? '...'}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                                <span className="text-text-muted">Max Atk Points</span>
                                                <span className="font-bold text-text-primary">{warConfig?.MaxPointsForAttackingOpponentGuildMember ?? '...'}</span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-text-muted">Brawl Win Bonus</span>
                                                <span className="font-bold text-accent-primary">+{warConfig?.BrawlWinPointsReward ?? '...'}</span>
                                            </div>
                                        </div>
                                    </Card>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Progress Pass */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-2 mb-4">
                                <GameAssetIcon asset={{ icon: 'WarTicket' }} size={22} />
                                <h2 className="text-xl font-bold italic tracking-tight">Progress Pass</h2>
                            </div>

                            <div className="space-y-3">
                                {milestones.map((m, idx) => (
                                    <div key={idx} className="group relative">
                                        {/* Progress Line */}
                                        {idx < milestones.length - 1 && (
                                            <div className="absolute left-6 top-10 bottom-0 w-1 bg-bg-secondary group-hover:bg-accent-primary/20 transition-colors z-0" />
                                        )}

                                        <div className="relative z-10 flex gap-4">
                                            <div className="shrink-0">
                                                <div className="w-12 h-12 rounded-2xl bg-bg-input border-2 border-border flex items-center justify-center font-bold text-sm shadow-lg group-hover:border-accent-primary/50 transition-colors">
                                                    <GameAssetIcon asset={{ icon: idx === 0 ? 'BronzeShield' : idx === 1 ? 'SilverShield' : 'GoldShield' }} size={28} />
                                                </div>
                                            </div>

                                            <Card className="flex-1 p-3 bg-bg-secondary/40 hover:bg-bg-secondary/60 transition-colors border-accent-primary/10">
                                                <div className="flex justify-between items-center mb-3">
                                                    <div className="text-xs font-bold text-accent-primary uppercase tracking-tighter">
                                                        {m.points.toLocaleString()} Points
                                                    </div>
                                                    <ChevronRight className="w-4 h-4 text-text-muted opacity-30" />
                                                </div>

                                                <div className="flex flex-wrap gap-2">
                                                    {m.rewards.map((rew: any, rIdx: number) => (
                                                        <div key={rIdx} className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-lg border border-white/5">
                                                            <GameIcon
                                                                name={mapRewardType(rew.Type)}
                                                                size={16}
                                                            />
                                                            <span className="text-[11px] font-mono font-black">
                                                                {rew.Amount.toLocaleString()}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </Card>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Clan tiers and war rewards: worked out in the War Prizes calculator */}
                    <div className="col-span-1 lg:col-span-3">
                        <Link to="/calculators/war-prizes" className="group flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-400/10 to-transparent p-5 hover:border-amber-400/60 transition-colors">
                            <GameAssetIcon asset={{ icon: 'GoldShield' }} size={40} />
                            <div className="flex-1">
                                <h2 className="text-xl font-black italic uppercase tracking-tighter">Clan Tiers & War Rewards</h2>
                                <p className="text-sm text-text-secondary">Every tier's required points, the points a won or lost war gives, and what each member gets: open the War Prizes calculator.</p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl bg-amber-400 text-black group-hover:brightness-110">
                                Open the calculator <GameAssetIcon asset={{ icon: 'crown0' }} size={16} />
                            </span>
                        </Link>
                    </div>

                    {/* Guild Base Rules Summary */}
                    {baseConfig && (
                        <div className="col-span-1 lg:col-span-3">
                            <Card className="p-6 bg-gradient-to-br from-bg-secondary/40 to-bg-secondary/10 border-accent-primary/10">
                                <div className="flex flex-col md:flex-row gap-8 items-center md:items-start text-center md:text-left">
                                    <div className="p-4 bg-accent-primary/10 rounded-3xl border border-accent-primary/20 shrink-0">
                                        <GameAssetIcon asset={{ icon: 'RallyIcon' }} size={48} />
                                    </div>
                                    <div className="space-y-6 flex-1">
                                        <div>
                                            <h2 className="text-2xl font-black italic uppercase tracking-tighter mb-1">General Guild Rules</h2>
                                            <p className="text-text-muted text-sm">Basic configuration and membership limits from dynamic logs.</p>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-6">
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Member Limit</div>
                                                <div className="text-xl font-black">{baseConfig.MaxGuildMemberCount} / Clan</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Creation Cost</div>
                                                <div className="text-xl font-black text-yellow-500 flex items-center justify-center md:justify-start gap-1">
                                                    <GameIcon name="GemSquare" size={24} />
                                                    {baseConfig.GuildCreateCost}
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Name Length</div>
                                                <div className="text-xl font-black">{baseConfig.MaxGuildNameLength} Chars</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Leave Cooldown</div>
                                                <div className="text-xl font-black text-red-400">{baseConfig.GuildLeaveCooldownDurationMinutes / 60} Hours</div>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Role Limits</div>
                                                <div className="text-[11px] font-bold text-text-secondary leading-tight mt-1">
                                                    Captain: {baseConfig.MaxCaptainRoleMemberCount} • R1: {baseConfig.MaxR1RoleMemberCount} • R2: {baseConfig.MaxR2RoleMemberCount}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Helpers
/** The dungeon whose key a UseXDungeonKey task spends, and that key's icon (as on the Battle Predictor tabs). */
const DUNGEON_KEY_ICON: Record<string, string> = {
    HammerThief: 'HammerKey', GhostTown: 'SkillKey', Invasion: 'PetKey', ZombieInvasion: 'PotionKey',
};

/** The sprite index of the first pet or mount (id 0) of a rarity, from ManualSpriteMapping. */
function rarityIndex(sheet: any, rarity: string): number | null {
    const rows = Object.entries<any>(sheet?.mapping ?? {}).filter(([, v]) => v.rarity === rarity).sort((a, b) => a[1].id - b[1].id || Number(a[0]) - Number(b[0]));
    return rows.length ? Number(rows[0][0]) : null;
}

/** A war task's icon, from the game's own assets: what the task makes the player spend or get. */
function TaskIcon({ task, size, sprites, skillLibrary }: { task: string; size: number; sprites: any; skillLibrary: any }) {
    const hatch = task.match(/^Hatch(\w+)Egg$/);
    if (hatch) return <EggIcon rarity={hatch[1]} size={size} />;
    const key = task.match(/^Use(\w+)DungeonKey$/);
    if (key) return <GameIcon name={DUNGEON_KEY_ICON[key[1]] ?? 'UnknownKey'} size={size} />;
    if (task.startsWith('Forge')) return <GameAssetIcon asset={{ icon: 'Anvil' }} size={size} />;
    // Pets and mounts of the task's rarity.
    const pet = task.match(/^Merge(\w+)Pet$/);
    if (pet) {
        const i = rarityIndex(sprites?.pets, pet[1]);
        if (i !== null) return <GameAssetIcon asset={{ sheet: 'Pets', index: i }} size={size} />;
    }
    const mount = task.match(/^(?:Merge|Summon)(\w+)Mount$/);
    if (mount) {
        const i = rarityIndex(sprites?.mounts, mount[1]);
        if (i !== null) return <GameAssetIcon asset={{ sheet: 'MountIcons', index: i }} size={size} />;
        return <GameIcon name="MountKey" size={size} />;
    }
    // A skill of the task's rarity (SkillLibrary order), drawn from the skill icon sheet.
    const skill = task.match(/^(?:Summon|Upgrade)(\w+)Skill$/);
    if (skill) {
        const row = Object.values<any>(skillLibrary ?? {}).find(r => r.Rarity === skill[1]);
        const e = row ? Object.entries<any>(sprites?.skills?.mapping ?? {}).find(([, v]) => v.name === row.Type) : null;
        if (e) return <GameAssetIcon asset={{ sheet: 'SkillIcons', index: Number(e[0]) }} size={size} />;
        return <GameIcon name="SkillTicket" size={size} />;
    }
    if (/TechTreeUpgrade$/.test(task)) return <GameIcon name="Potion" size={size} />;
    if (task === 'SpendCoinsOnForge') return <GameIcon name="Coin" size={size} />;
    if (task === 'SpendGemOnForge') return <GameIcon name="GemSquare" size={size} />;
    return <GameIcon name="Star" size={size} />;
}

function formatTaskName(task: string): string {
    // Convert CamelCase to spaced words
    // Words split at a lower-to-upper change, and an upper-case run (a Roman numeral) kept whole:
    // FinishIITechTreeUpgrade -> Finish II Tech Tree Upgrade.
    const spaced = task.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
    // Specialized rewrites
    return spaced
        .replace('Summon', 'Summon x1')
        .replace('Hatch', 'Hatch x1')
        .replace('Finish I', 'Phase I')
        .replace('Finish II', 'Phase II')
        .replace('Finish III', 'Phase III')
        .replace('Finish IV', 'Phase IV')
        .replace('Finish V', 'Phase V');
}

function mapRewardType(type: string): string {
    const map: Record<string, string> = {
        'Hammers': 'Hammer',
        'Coins': 'Coin',
        'SkillSummonTickets': 'SkillTicket',
        'TechPotions': 'Potion',
        'Pet': 'PetKey',
        'ClockWinders': 'MountKey',
        'Eggshells': 'Eggshell',
        'GuildPotions': 'GuildPotions'
    };
    return map[type] || 'Star';
}
