import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { Swords, Trophy, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../lib/utils';

// Constants
const LEAGUE_NAMES = ['Unranked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const LEAGUE_COLORS = [
    'border-slate-500 text-slate-500', // Unranked
    'border-[#cd7f32] text-[#cd7f32]', // Bronze
    'border-[#c0c0c0] text-[#c0c0c0]', // Silver
    'border-[#ffd700] text-[#ffd700]', // Gold
    'border-[#26c6da] text-[#26c6da]', // Platinum (Cyan)
    'border-[#9c27b0] text-[#9c27b0]', // Diamond (Purple)
];
const LEAGUE_BG_GRADIENTS = [
    'from-slate-500/10 to-transparent',
    'from-[#cd7f32]/10 to-transparent',
    'from-[#c0c0c0]/10 to-transparent',
    'from-[#ffd700]/10 to-transparent',
    'from-[#26c6da]/10 to-transparent',
    'from-[#9c27b0]/10 to-transparent',
];

/*
- **Arena Wiki Icon Refactor**:
    - **Official Shield Sprites**: Replaced broken individual image files with the high-quality shield sprites from the shared `Icons.png` sheet.
    - **Reward Icon Standardization**: All ranking rewards now use the corresponding official game icons.
    - **Visual Polish**: Improved the league card layout with better typography and shadow effects.
*/

interface RankReward {
    FromRank: number;
    ToRank: number;
    Rewards: { Type: string; Amount: number }[];
}

interface LeagueReward {
    Rank: RankReward[];
}

export default function Arena() {
    // 'ArenaRewardLibrary.json' for rewards.
    const { data: rewardsData, loading } = useGameData<Record<string, LeagueReward>>('ArenaRewardLibrary.json');

    // Thresholds match the progression: Unranked -> Diamond
    const leagueThresholds: Record<number, { p: number; d: number }> = {
        0: { p: 90, d: 0 },  // Unranked (Top 90 Promote)
        1: { p: 80, d: 0 },  // Bronze (Top 80 Promote)
        2: { p: 50, d: 90 }, // Silver (Top 50 Promote, Bottom 10 Demote)
        3: { p: 20, d: 80 }, // Gold (Top 20 Promote, Bottom 20 Demote)
        4: { p: 10, d: 70 }, // Platinum (Top 10 Promote, Bottom 30 Demote)
        5: { p: 0, d: 60 }   // Diamond (None Promote, Bottom 40 Demote)
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-12">
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

                            <div className="relative z-10 p-6 flex flex-col h-full">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className={cn(
                                        "w-20 h-20 flex items-center justify-center relative bg-bg-input/20 rounded-full border-2 shadow-xl group",
                                        colorClass.split(' ')[0]
                                    )}>
                                        <GameIcon
                                            name={getLeagueIconName(idx)}
                                            size={64}
                                            className="drop-shadow-glow transition-transform duration-300 group-hover:scale-110"
                                        />
                                    </div>
                                    <div>
                                        <h2 className={cn("text-3xl font-black uppercase italic tracking-tighter", colorClass.split(' ')[1])}>{name}</h2>
                                        <div className="text-[10px] font-bold text-text-muted opacity-50 uppercase tracking-widest">League {idx + 1}</div>
                                    </div>
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
                                        {!loading && !rewardData && <div className="text-xs text-text-muted opacity-50">No reward data found</div>}
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
        'Hammers': 'Hammer',
        'Coins': 'Coin',
        'SkillSummonTickets': 'SkillTicket',
        'TechPotions': 'Potion',
        'Pet': 'PetKey',
        'ClockWinders': 'MountKey'
    };
    return map[type] || 'Star';
}

function getLeagueIconName(idx: number): string {
    // Shifted to match Unranked -> Diamond
    const shields = [
        'Battle',         // Unranked (Generic Battle Icon)
        'BronzeShield',   // Bronze
        'SilverShield',   // Silver
        'GoldShield',     // Gold
        'PlatinumShield', // Platinum
        'MasterShield'    // Diamond (using MasterShield asset which is usually purple/top tier)
    ];
    return shields[idx] || 'Battle';
}
