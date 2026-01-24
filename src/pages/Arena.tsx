import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { Swords, Trophy, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../lib/utils';

// Constants
const LEAGUE_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'];
const LEAGUE_COLORS = [
    'border-[#cd7f32] text-[#cd7f32]', // Bronze
    'border-[#c0c0c0] text-[#c0c0c0]', // Silver
    'border-[#ffd700] text-[#ffd700]', // Gold
    'border-[#e5e4e2] text-[#e5e4e2]', // Platinum
    'border-[#b9f2ff] text-[#b9f2ff]', // Diamond
    'border-[#ff6b6b] text-[#ff6b6b]', // Master
];
const LEAGUE_BG_GRADIENTS = [
    'from-[#cd7f32]/10 to-transparent',
    'from-[#c0c0c0]/10 to-transparent',
    'from-[#ffd700]/10 to-transparent',
    'from-[#e5e4e2]/10 to-transparent',
    'from-[#b9f2ff]/10 to-transparent',
    'from-[#ff6b6b]/10 to-transparent',
];



interface RankReward {
    FromRank: number;
    ToRank: number;
    Rewards: { Type: string; Amount: number }[];
}

interface LeagueReward {
    Rank: RankReward[];
}

export default function Arena() {
    // Config hardcoded in legacy, but maybe in JSON too? 
    // Legacy used hardcoded `leagueData` for thresholds. Let's replicate or try fetch.
    // 'ArenaRewardLibrary.json' for rewards.
    const { data: rewardsData, loading } = useGameData<Record<string, LeagueReward>>('ArenaRewardLibrary.json');

    // Hardcoded thresholds from legacy if not found in JSON (ArenaLeagueLibrary might exist?)
    const leagueThresholds: Record<number, { p: number; d: number }> = {
        0: { p: 90, d: 0 },  // Bronze
        1: { p: 80, d: 0 },  // Silver
        2: { p: 50, d: 90 }, // Gold (Promote 1-50, Demote 91-100)
        3: { p: 20, d: 80 }, // Platinum
        4: { p: 10, d: 70 }, // Diamond
        5: { p: 0, d: 60 }   // Master
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Swords className="w-10 h-10 text-accent-primary" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Arena Leagues
                    </h1>
                    <p className="text-text-muted">Rankings, rewards, and promotion rules</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {LEAGUE_NAMES.map((name, idx) => {
                    const thresholds = leagueThresholds[idx];
                    const rewardData = rewardsData ? (rewardsData[String(idx)] || rewardsData[idx]) : null;
                    const colorClass = LEAGUE_COLORS[idx];
                    const bgClass = LEAGUE_BG_GRADIENTS[idx];

                    return (
                        <Card key={idx} className={cn("relative overflow-hidden border-2", colorClass.split(' ')[0])}>
                            {/* Background Gradient */}
                            <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none", bgClass)} />

                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={cn("w-16 h-16 flex items-center justify-center")}>
                                        <img
                                            src={`./icons/single/LeagueIcons_${5 - idx}.png`}
                                            alt={name}
                                            className="w-full h-full object-contain drop-shadow-glow"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.parentElement?.classList.add('bg-bg-primary', 'rounded-full', 'border-2', colorClass);
                                                e.currentTarget.parentElement!.innerText = name[0];
                                            }}
                                        />
                                    </div>
                                    <h2 className={cn("text-2xl font-bold", colorClass.split(' ')[1])}>{name}</h2>
                                </div>

                                {/* Stats */}
                                <div className="space-y-2 mb-6">
                                    <div className="flex justify-between items-center bg-bg-primary/40 p-2 rounded">
                                        <span className="text-sm text-text-muted flex items-center gap-1">
                                            <ArrowUp className="w-4 h-4 text-green-400" /> Promotion
                                        </span>
                                        <span className="font-bold text-sm">
                                            {thresholds.p > 0 ? `Top ${thresholds.p}` : 'None'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center bg-bg-primary/40 p-2 rounded">
                                        <span className="text-sm text-text-muted flex items-center gap-1">
                                            <ArrowDown className="w-4 h-4 text-red-400" /> Demotion
                                        </span>
                                        <span className="font-bold text-sm">
                                            {thresholds.d > 0 ? `Below ${thresholds.d}` : 'Safe'}
                                        </span>
                                    </div>
                                </div>

                                {/* Rewards */}
                                <div className="border-t border-border/50 pt-4">
                                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1">
                                        <Trophy className="w-3 h-3" /> Rewards
                                    </h3>

                                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                        {loading && <div className="text-xs text-text-muted">Loading...</div>}
                                        {rewardData && rewardData.Rank?.map((r, rIdx) => (
                                            <div key={rIdx} className="text-sm flex flex-col gap-1 bg-bg-primary/20 p-2 rounded">
                                                <div className="font-bold text-xs text-accent-secondary">
                                                    {r.FromRank === r.ToRank
                                                        ? `Rank ${r.FromRank + 1}`
                                                        : `Rank ${r.FromRank + 1}-${r.ToRank + 1}`}
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {r.Rewards.map((rew, rwIdx) => (
                                                        <div key={rwIdx} className="flex items-center gap-1 bg-black/20 px-2 py-0.5 rounded text-xs">
                                                            {/* Try to map Type to GameIcon */}
                                                            <GameIcon name={mapRewardType(rew.Type)} className="w-3 h-3" />
                                                            <span>{rew.Amount.toLocaleString()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

// Helper to map reward strings to icon names
function mapRewardType(type: string): string {
    const map: Record<string, string> = {
        'Hammers': 'hammer',
        'Coins': 'coin',
        'SkillSummonTickets': 'ticket',
        'TechPotions': 'potion',
        'Pet': 'egg', // or key
        'ClockWinders': 'timer'
    };
    return map[type] || 'star';
}
