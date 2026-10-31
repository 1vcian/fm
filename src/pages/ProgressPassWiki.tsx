import { Fragment, useMemo, useState } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { difficultyName } from '../utils/difficulty';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';

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

/** One reward kind (its $type and Type), and how many of it the free and the premium tracks give. */
interface RewardSum { key: string; sample: Reward; free: number; premium: number }

/** Sums every reward of the tiers by kind: Rewards[0] is the free track, Rewards[1] the premium one. */
function sumRewards(tiers: PassTier[]): RewardSum[] {
    const out = new Map<string, RewardSum>();
    for (const t of tiers) {
        t.Rewards.forEach((track, i) => {
            for (const r of track.Rewards ?? []) {
                const key = `${r.$type}:${r.Type}`;
                const row = out.get(key) ?? { key, sample: r, free: 0, premium: 0 };
                if (i === 0) row.free += r.Amount; else row.premium += r.Amount;
                out.set(key, row);
            }
        });
    }
    return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The words a player reads for these resources (Profile/ResourcesEditor, as in ClanTierPanel). */
const REWARD_WORDS: Record<string, string> = {
    Hammers: 'Hammers', Coins: 'Coins', Gems: 'Gems', SkillSummonTickets: 'Skill Tickets',
    TechPotions: 'Tech Potions', ClockWinders: 'Clock Winders', Eggshells: 'Eggshells', GuildPotions: 'Guild Potions',
};
const rewardWord = (r: Reward) => (r.$type === 'DungeonKeyReward' ? `${r.Type} keys` : REWARD_WORDS[r.Type] ?? r.Type);

const fmt = (n: number) => (n ? n.toLocaleString() : '-');

/** The totals of the open difficulty and of every difficulty together, per reward kind. */
function RewardTotals({ current, all, difficultyLabel }: { current: RewardSum[]; all: RewardSum[]; difficultyLabel: string }) {
    const byKey = new Map(current.map(r => [r.key, r]));
    return (
        <Card className="overflow-x-auto border-border/30">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-text-muted">
                        <th rowSpan={2} className="text-left px-4 py-2">Totals</th>
                        <th colSpan={3} className="px-2 pt-2 text-center text-accent-primary">{difficultyLabel}</th>
                        <th colSpan={3} className="px-2 pt-2 text-center text-white">All difficulties</th>
                    </tr>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-text-muted border-b border-border/50">
                        {[0, 1].map(g => (
                            <Fragment key={g}>
                                <th className={cn('px-2 pb-2 text-right', g === 1 && 'border-l border-border/30')}>Free</th>
                                <th className="px-2 pb-2 text-right text-accent-secondary">Premium</th>
                                <th className="px-2 pb-2 text-right">Both</th>
                            </Fragment>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {all.map(r => {
                        const c = byKey.get(r.key);
                        return (
                            <tr key={r.key} className="border-b border-border/20 last:border-0 font-mono">
                                <td className="px-4 py-1.5">
                                    <span className="inline-flex items-center gap-2 font-sans font-semibold">
                                        <GameIcon name={getRewardIcon(r.sample)} className="w-5 h-5" /> {rewardWord(r.sample)}
                                    </span>
                                </td>
                                <td className="px-2 text-right">{fmt(c?.free ?? 0)}</td>
                                <td className="px-2 text-right text-accent-secondary">{fmt(c?.premium ?? 0)}</td>
                                <td className="px-2 text-right font-bold">{fmt((c?.free ?? 0) + (c?.premium ?? 0))}</td>
                                <td className="px-2 text-right border-l border-border/30">{fmt(r.free)}</td>
                                <td className="px-2 text-right text-accent-secondary">{fmt(r.premium)}</td>
                                <td className="px-2 pr-4 text-right font-bold">{fmt(r.free + r.premium)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </Card>
    );
}

export default function ProgressPassWiki() {
    const [difficulty, setDifficulty] = useState<number>(0);
    const { data: passData } = useGameData<Record<string, PassTier>>('MainGameProgressPassLibrary.json');
    
    const difficulties = useMemo(() => {
        if (!passData) return [0];
        const found = new Set(Object.values(passData).map(t => t.ProgressKey?.MainBattleId?.DifficultyIdx ?? 0));
        return [...found].sort((a, b) => a - b);
    }, [passData]);

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

    const totalsAll = useMemo(() => sumRewards(Object.values(passData ?? {})), [passData]);
    const totalsCurrent = useMemo(() => sumRewards(sortedTiers), [sortedTiers]);

    if (!passData) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted animate-pulse">
                <TrendingUp className="w-12 h-12 mb-4 opacity-20" />
                <p>Loading Progress Pass configurations</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-fade-in pb-20 px-4 sm:px-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-center gap-6 border-b border-border pb-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary p-0.5 shadow-[0_0_30px_rgba(var(--color-accent-primary),0.3)] flex-shrink-0">
                    <div className="w-full h-full bg-bg-primary rounded-[14px] flex items-center justify-center">
                        <GameAssetIcon asset={{ icon: 'MainProgressPassIcon' }} size={32} />
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

            {/* Tabs: one per difficulty the pass actually has tiers for */}
            <div className="flex bg-bg-secondary/40 p-1 rounded-xl border border-border w-fit mx-auto sm:mx-0 shadow-lg mb-4">
                {difficulties.map(d => (
                    <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={cn(
                            "px-6 sm:px-10 py-2.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                            difficulty === d
                                ? (d === 0 ? "bg-accent-primary text-black shadow-lg" : "bg-red-500 text-white shadow-lg shadow-red-500/20")
                                : "text-text-muted hover:text-text-primary hover:bg-white/5"
                        )}
                    >
                        {difficultyName(d)}
                    </button>
                ))}
            </div>

            <RewardTotals current={totalsCurrent} all={totalsAll} difficultyLabel={difficultyName(difficulty)} />

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
                    // The game names a battle by numbers only (FormatBattleNumber: difficulty, age + 1, battle + 1).
                    const difficultyLabel = difficultyName(tier.ProgressKey.MainBattleId.DifficultyIdx ?? 0);
                    
                    return (
                        <Card key={idx} className="overflow-hidden border-border/30 hover:border-accent-primary/30 transition-colors group">
                            <div className="sm:grid grid-cols-12 gap-0">
                                {/* Milestone Descriptor */}
                                <div className="col-span-4 bg-bg-secondary/40 p-4 sm:p-6 flex items-center sm:border-r border-border/50">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-accent-primary">
                                            {difficultyLabel}
                                        </span>
                                        <span className="text-xl font-bold text-white uppercase tracking-tight">
                                            {AgeIdx + 1}-{BattleIdx + 1}
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
                                        <GameAssetIcon asset={{ icon: 'Star' }} size={12} />
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
