import { useMemo, useState } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { TrendingUp, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { AGES } from '../utils/constants';

interface Reward {
    Amount: number;
    Type: string;
    $type: string;
}

interface PassTier {
    ProgressKey: {
        MainBattleId: {
            DifficultyIdx: number;
            AgeIdx: number;
            BattleIdx: number;
        };
        $type: string;
    };
    Rewards: { Rewards: Reward[] }[];
}

function getRewardIcon(reward: Reward): string {
    const type = reward.Type;
    const itemType = reward.$type;

    if (itemType === 'DungeonKeyReward') {
        if (type === 'Hammer') return 'HammerKey';
        if (type === 'Skill') return 'SkillKey';
        if (type === 'Pet') return 'PetKey';
        if (type === 'Potion') return 'PotionKey';
        return type + 'Key';
    }

    if (type === 'Coins') return 'Coin';
    if (type === 'SkillSummonTickets') return 'SkillTicket';
    if (type === 'TechPotions') return 'Potion';
    if (type === 'Eggshells') return 'Eggshell';
    if (type === 'Hammers') return 'Hammer';
    if (type === 'ClockWinders') return 'MountKey';
    if (type === 'Gems') return 'GemIcon';
    if (type === 'Token') return 'WarTicket';

    return type;
}

export default function ProgressPassWiki() {
    const [difficulty, setDifficulty] = useState<number>(0);
    const { data: passData } = useGameData<Record<string, PassTier>>('MainGameProgressPassLibrary.json');
    
    const sortedTiers = useMemo(() => {
        if (!passData) return [];
        const filtered = Object.values(passData).filter(t => t.ProgressKey?.MainBattleId?.DifficultyIdx === difficulty);
        
        return filtered.sort((a, b) => {
            const ageA = a.ProgressKey.MainBattleId.AgeIdx;
            const ageB = b.ProgressKey.MainBattleId.AgeIdx;
            if (ageA !== ageB) return ageA - ageB;
            
            const battleA = a.ProgressKey.MainBattleId.BattleIdx;
            const battleB = b.ProgressKey.MainBattleId.BattleIdx;
            return battleA - battleB;
        });
    }, [passData, difficulty]);

    if (!passData) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted animate-pulse">
                <TrendingUp className="w-12 h-12 mb-4 opacity-20" />
                <p>Loading Progress Pass configurations...</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-fade-in pb-20 px-4 sm:px-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-center gap-6 border-b border-border pb-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary p-0.5 shadow-[0_0_30px_rgba(var(--color-accent-primary),0.3)] flex-shrink-0">
                    <div className="w-full h-full bg-bg-primary rounded-[14px] flex items-center justify-center">
                        <TrendingUp size={32} className="text-accent-primary" />
                    </div>
                </div>
                <div className="text-center sm:text-left">
                    <h1 className="text-3xl sm:text-4xl font-black bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary bg-[length:200%_auto] animate-gradient-x bg-clip-text text-transparent uppercase tracking-tighter">
                        Progress Pass
                    </h1>
                    <p className="text-sm font-medium text-text-secondary mt-1">
                        Timeline of all milestone rewards in the Main Game.
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex bg-bg-secondary/40 p-1 rounded-xl border border-border w-fit mx-auto sm:mx-0 shadow-lg mb-4">
                <button
                    onClick={() => setDifficulty(0)}
                    className={cn(
                        "px-6 sm:px-10 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                        difficulty === 0
                            ? "bg-accent-primary text-black shadow-lg"
                            : "text-text-muted hover:text-text-primary hover:bg-white/5"
                    )}
                >
                    Normal
                </button>
                <button
                    onClick={() => setDifficulty(1)}
                    className={cn(
                        "px-6 sm:px-10 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                        difficulty === 1
                            ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                            : "text-text-muted hover:text-text-primary hover:bg-white/5"
                    )}
                >
                    Hard
                </button>
            </div>

            {/* List */}
            <div className="space-y-4">
                <div className="hidden sm:grid grid-cols-12 gap-4 px-6 text-[10px] font-black uppercase tracking-widest text-text-muted mb-2">
                    <div className="col-span-4">Milestone</div>
                    <div className="col-span-4 text-center text-white">Free Pass</div>
                    <div className="col-span-4 text-center text-accent-secondary">Premium Pass</div>
                </div>

                {sortedTiers.map((tier, idx) => {
                    // Assuming Rewards[0] is Free and Rewards[1] is Premium.
                    // This matches the typical progression JSON structure.
                    const freeRewards = tier.Rewards[0]?.Rewards || [];
                    const premiumRewards = tier.Rewards[1]?.Rewards || [];
                    const { AgeIdx, BattleIdx } = tier.ProgressKey.MainBattleId;
                    const ageName = AGES[AgeIdx] || `Age ${AgeIdx + 1}`;
                    
                    return (
                        <Card key={idx} className="overflow-hidden border-border/30 hover:border-accent-primary/30 transition-colors group">
                            <div className="sm:grid grid-cols-12 gap-0">
                                {/* Milestone Descriptor */}
                                <div className="col-span-4 bg-bg-secondary/40 p-4 sm:p-6 flex items-center sm:border-r border-border/50">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-accent-primary">
                                            {ageName}
                                        </span>
                                        <span className="text-xl font-bold text-white uppercase tracking-tight">
                                            Stage {AgeIdx + 1}-{BattleIdx + 1}
                                        </span>
                                    </div>
                                </div>
                                
                                {/* Free Track */}
                                <div className="col-span-4 p-4 sm:p-6 sm:border-r border-border/50 bg-bg-primary">
                                    <div className="sm:hidden text-[10px] font-black uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
                                        Free Pass
                                    </div>
                                    <div className="flex flex-wrap gap-2 sm:justify-center">
                                        {freeRewards.map((reward, rIdx) => (
                                            <RewardBadge key={rIdx} reward={reward} />
                                        ))}
                                        {freeRewards.length === 0 && (
                                            <span className="text-text-muted text-xs italic">-</span>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Premium Track */}
                                <div className="col-span-4 p-4 sm:p-6 bg-gradient-to-br from-accent-secondary/5 to-transparent">
                                    <div className="sm:hidden text-[10px] font-black uppercase tracking-widest text-accent-secondary mb-3 flex items-center gap-2">
                                        <Star fill="currentColor" className="w-3 h-3 text-accent-secondary" />
                                        Premium Pass
                                    </div>
                                    <div className="flex flex-wrap gap-2 sm:justify-center">
                                        {premiumRewards.map((reward, rIdx) => (
                                            <RewardBadge key={rIdx} reward={reward} premium />
                                        ))}
                                         {premiumRewards.length === 0 && (
                                            <span className="text-text-muted text-xs italic">-</span>
                                        )}
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

function RewardBadge({ reward, premium = false }: { reward: Reward, premium?: boolean }) {
    let displayText = reward.Amount.toLocaleString();
    if (reward.Amount >= 10000) {
        displayText = `${(reward.Amount / 1000).toFixed(0)}k`;
    }

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg border",
            premium 
                ? "bg-accent-secondary/10 border-accent-secondary/30 text-white shadow-inner" 
                : "bg-white/5 border-white/10 text-white"
        )}>
            <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                <GameIcon name={getRewardIcon(reward)} className="w-full h-full drop-shadow-md" />
            </div>
            <span className="font-mono text-sm font-bold tracking-tight">
                {displayText}
            </span>
        </div>
    );
}
