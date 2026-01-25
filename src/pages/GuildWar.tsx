import { useState, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { Shield, Swords, Calendar, Trophy, Zap, ChevronRight, Info } from 'lucide-react';
import { cn } from '../lib/utils';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function GuildWar() {
    const { data: dayConfig, loading: l1 } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: passConfig, loading: l2 } = useGameData<any>('GuildWarProgressPassLibrary.json');
    const { data: warConfig, loading: l3 } = useGameData<any>('GuildWarConfig.json');

    const [activeDay, setActiveDay] = useState(0);

    const loading = l1 || l2 || l3;

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
                        <Shield className="w-10 h-10 text-accent-primary" />
                    </div>
                    <div>
                        <h1 className="text-4xl font-black bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent uppercase tracking-tighter italic">
                            Guild War Wiki
                        </h1>
                        <p className="text-text-muted font-medium">Preparation, Combat & Milestone Guide</p>
                    </div>
                </div>

                {/* Day Selector */}
                <div className="flex gap-1 bg-bg-secondary/30 p-1 rounded-xl border border-border w-full md:w-auto overflow-x-auto no-scrollbar">
                    {DAYS.map((name, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActiveDay(idx)}
                            className={cn(
                                "px-4 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap uppercase tracking-widest",
                                activeDay === idx
                                    ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/20"
                                    : "text-text-muted hover:text-text-primary hover:bg-white/5"
                            )}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex flex-col items-center justify-center opacity-50">
                    <div className="w-10 h-10 border-4 border-accent-primary border-t-transparent rounded-full animate-spin mb-4" />
                    <span className="text-sm font-bold uppercase tracking-widest">Loading War Logs...</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Daily Tasks */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-accent-primary" />
                                {DAYS[activeDay]} Preparation Tasks
                            </h2>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 bg-blue-500/10 text-blue-400 px-4 py-1.5 rounded-xl font-bold text-xs border border-blue-500/20 shadow-lg shadow-blue-500/5">
                                    <Trophy className="w-4 h-4" />
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
                                        <Zap className="w-12 h-12 text-accent-primary" />
                                    </div>

                                    <div className="flex items-start gap-3 relative z-10">
                                        <div className="p-2 bg-bg-secondary/50 rounded-lg border border-border shrink-0">
                                            <GameIcon name={getTaskIcon(task.Task)} size={32} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-sm font-bold text-text-primary mb-1 line-clamp-1">
                                                {formatTaskName(task.Task)}
                                            </h3>
                                            <div className="flex items-center gap-1.5 mt-2">
                                                <div className="flex items-center gap-1 bg-accent-primary/20 px-2 py-0.5 rounded text-[10px] font-bold text-accent-primary border border-accent-primary/30 uppercase tracking-tighter">
                                                    <Zap className="w-3 h-3" />
                                                    +{task.Rewards?.[0]?.Amount} Points
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                            {dayTasks.length === 0 && (
                                <div className="sm:col-span-2 flex flex-col items-center justify-center p-12 bg-bg-secondary/20 rounded-2xl border-2 border-dashed border-border text-text-muted">
                                    <Info className="w-8 h-8 mb-2 opacity-20" />
                                    <span className="font-bold uppercase tracking-widest text-xs">No preparation tasks for this day</span>
                                </div>
                            )}
                        </div>

                        {/* Schedule & Rules Breakdown */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                            <Card className="p-5 border-l-4 border-l-blue-500">
                                <h3 className="font-black text-xs uppercase tracking-widest text-blue-500 mb-4 flex items-center gap-2">
                                    <Calendar className="w-4 h-4" /> Weekly Schedule
                                </h3>
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="text-xs font-mono font-bold bg-bg-secondary px-2 py-1 rounded border border-border min-w-[100px] text-center">MON - SAT</div>
                                        <div className="text-sm text-text-secondary">Preparation Phase (Tasks)</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-xs font-mono font-bold bg-blue-500/20 text-blue-400 px-2 py-1 rounded border border-blue-500/30 min-w-[100px] text-center">SUNDAY</div>
                                        <div className="text-sm text-text-primary font-bold">Main Guild Battle</div>
                                    </div>
                                </div>
                            </Card>

                            <Card className="p-5 border-l-4 border-l-red-500">
                                <h3 className="font-black text-xs uppercase tracking-widest text-red-500 mb-4 flex items-center gap-2">
                                    <Swords className="w-4 h-4" /> Attack Rules
                                </h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                        <span className="text-text-muted">Max Tickets / Member</span>
                                        <span className="font-bold text-text-primary">{warConfig?.MaxWarTicketsPerMember || 5}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm border-b border-border/50 pb-2">
                                        <span className="text-text-muted">Max Atk Points</span>
                                        <span className="font-bold text-text-primary">{warConfig?.MaxPointsForAttackingOpponentGuildMember || 50}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <span className="text-text-muted">Brawl Win Bonus</span>
                                        <span className="font-bold text-accent-primary">+{warConfig?.BrawlWinPointsReward || 1000}</span>
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </div>

                    {/* Right Column: Progress Pass */}
                    <div className="space-y-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Trophy className="w-5 h-5 text-yellow-500" />
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
                                                {/* Medal or Number? */}
                                                <Trophy className={cn("w-5 h-5", idx === 0 ? "text-bronze" : idx === 1 ? "text-silver" : "text-yellow-500")} />
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
            )}
        </div>
    );
}

// Helpers
function getTaskIcon(taskType: string): string {
    const t = taskType.toLowerCase();
    if (t.includes('forge')) return 'Hammer';
    if (t.includes('summon') && t.includes('skill')) return 'SkillTicket';
    if (t.includes('summon') && t.includes('mount')) return 'MountKey';
    if (t.includes('upgrade') && t.includes('skill')) return 'SkillTicket';
    if (t.includes('hatch')) return 'Egg';
    if (t.includes('merge') && t.includes('pet')) return 'PetKey';
    if (t.includes('merge') && t.includes('mount')) return 'MountKey';
    if (t.includes('spendcoins')) return 'Coin';
    if (t.includes('dungeon')) return 'HammerKey'; // Generic dungeon key
    if (t.includes('techtree')) return 'Potion';
    return 'Star';
}

function formatTaskName(task: string): string {
    // Convert CamelCase to spaced words
    const spaced = task.replace(/([A-Z])/g, ' $1').trim();
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
        'ClockWinders': 'MountKey'
    };
    return map[type] || 'Star';
}
