import { useMemo, useState } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useTreeModifiers, useClanNodeMax } from '../hooks/useCalculatedStats';
import { SandboxPanel } from '../components/UI/SandboxPanel';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { Target, Trophy, Sword, Swords, Settings, Clock, Users, Shield, Zap, Info, Gift, Hammer as HammerIcon, ChevronRight, Search, Activity, Heart, TrendingUp, Star, Check, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGameDataContext } from '../context/GameDataContext';
import { AGES } from '../utils/constants';
import { getItemImage, getItemName } from '../utils/itemAssets';
import { formatNumber } from '../utils/format';
import { useBattleSimulation } from '../hooks/useBattleSimulation';
import { BattleVisualizerModal } from '../components/Battle/BattleVisualizerModal';
import { BattleResult } from '../utils/BattleSimulator';

interface Reward {
    Amount: number;
    Type: string;
    $type: string;
}

interface MissionBattle {
    MissionId: number;
    MissionTitleId: string;
    MinLevel: number;
    BaseDamage: number;
    BaseHealth: number;
    UnitCount: number;
    MapAge: number;
    ChanceToHaveWeapon: number;
    ChanceToHaveHelmet: number;
    ChanceToHaveArmour: number;
    PossibleWeapons: { Item1: number; Item2: number }[] | null;
    PossibleHelmets: { Item1: number; Item2: number }[] | null;
    PossibleArmours: { Item1: number; Item2: number }[] | null;
}

interface MissionLevel {
    Index: number;
    MinHammerThiefLevel: number;
    MinLevel: number;
    MaxLevel: number;
}

interface MissionReward {
    Level: number;
    Rewards: Reward[];
}

interface MissionAllMemberReward {
    Level: number;
    Hammers?: number;
    Reward?: { Amount: number; Type: string; $type: string };
}

interface MissionBaseConfig {
    DailyEnergy: number;
    MaxSupportMembers: number;
    RefreshGemCost: number;
    RefreshMissionCount: number;
    MissionBattleMatchTimerSeconds: number;
    HealthAndDamageLevelMultiplier: number;
    MissionOwnerRewardsCount: number;
}

interface MissionRallyTime {
    Id: number;
    TimeInSeconds: number;
}

function getRewardIcon(type: string): string {
    const map: Record<string, string> = {
        'Coins': 'Coin',
        'SkillSummonTickets': 'SkillTicket',
        'TechPotions': 'Potion',
        'Eggshells': 'Eggshell',
        'Hammers': 'Hammer',
        'ClockWinders': 'MountKey',
        'Gems': 'GemIcon',
        'GuildPotions': 'GuildPotions'
    };
    return map[type] || type;
}

function formatStage(lvl: number): string {
    if (lvl <= 0) return 'None';
    const world = Math.floor((lvl - 1) / 10) + 1;
    const stage = ((lvl - 1) % 10) + 1;
    return `${world}-${stage}`;
}

export default function MissionSolo() {
    const { selectedVersion } = useGameDataContext();
    const [clanPoints, setClanPoints] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');

    const { simulateMission, playerStats, profile, libs } = useBattleSimulation();
    const [selectedBattleResult, setSelectedBattleResult] = useState<BattleResult | null>(null);
    const [simCount, setSimCount] = useState(100);
    const [isSimulatingAll, setIsSimulatingAll] = useState(false);
    const [missionResults, setMissionResults] = useState<Record<number, BattleResult>>({});
    const [simulatingMissions, setSimulatingMissions] = useState<Record<number, boolean>>({});

    const { data: battleLibrary } = useGameData<Record<string, MissionBattle>>('MissionBattleLibrary.json');
    const { data: levelLibrary } = useGameData<Record<string, MissionLevel>>('MissionLevelLibrary.json');
    const { data: rewardLibrary } = useGameData<Record<string, MissionReward>>('MissionRewardLibrary.json');
    const { data: allMemberRewardLibrary } = useGameData<Record<string, MissionAllMemberReward>>('MissionAllMemberRewardLibrary.json');
    const { data: baseConfig } = useGameData<MissionBaseConfig>('MissionBaseConfig.json');
    const { data: rallyTimeLibrary } = useGameData<Record<string, MissionRallyTime>>('MissionRallyTimeLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');

    const loading = !battleLibrary || !levelLibrary || !rewardLibrary || !baseConfig || !allMemberRewardLibrary;

    const handleSimulate = async (battle: MissionBattle) => {
        if (!playerStats) return;
        setSimulatingMissions(prev => ({ ...prev, [battle.MissionId]: true }));

        // Use a timeout to avoid freezing the UI
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                const result = simulateMission(battle, clanPoints, simCount);
                if (result) {
                    setMissionResults(prev => ({ ...prev, [battle.MissionId]: result }));
                }
                setSimulatingMissions(prev => ({ ...prev, [battle.MissionId]: false }));
                resolve();
            }, 10);
        });
    };

    const handleSimulateAll = async () => {
        if (!playerStats || isSimulatingAll) return;
        setIsSimulatingAll(true);
        
        // Process one by one to avoid heavy UI freeze
        for (const battle of filteredMissions) {
            await handleSimulate(battle);
        }
        
        setIsSimulatingAll(false);
    };

    const currentClanLevelInfo = useMemo(() => {
        if (!levelLibrary) return null;
        return levelLibrary[clanPoints.toString()] || levelLibrary["1"];
    }, [levelLibrary, clanPoints]);

    const currentAllMemberReward = useMemo(() => {
        if (!allMemberRewardLibrary) return null;
        return allMemberRewardLibrary[clanPoints.toString()];
    }, [allMemberRewardLibrary, clanPoints]);

    const currentRewards = useMemo(() => {
        if (!rewardLibrary) return null;
        return rewardLibrary[clanPoints.toString()];
    }, [rewardLibrary, clanPoints]);

    const filteredMissions = useMemo(() => {
        if (!battleLibrary) return [];
        return Object.values(battleLibrary)
            .filter(m => m.MissionTitleId.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => a.MinLevel - b.MinLevel);
    }, [battleLibrary, searchTerm]);

    // Clan tech tree boost to mission rewards + sandbox override.
    const treeModifiers = useTreeModifiers();
    const clanMax = useClanNodeMax();
    const profileMissionRewardBonus = treeModifiers['MissionRewards'] || 0;
    const defaultAscension =
        (profile?.misc?.mountAscensionLevel || 0) +
        (profile?.misc?.skillAscensionLevel || 0) +
        (profile?.misc?.forgeAscensionLevel || 0) +
        (profile?.misc?.petAscensionLevel || 0);

    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const missionRewardBonus = sandbox.missionRewards ?? profileMissionRewardBonus;
    const ascensionStars = sandbox.ascensionStars ?? defaultAscension;

    const isSandboxModified = useMemo(() => {
        return (
            Math.abs(missionRewardBonus - profileMissionRewardBonus) > 1e-9 ||
            ascensionStars !== defaultAscension
        );
    }, [missionRewardBonus, profileMissionRewardBonus, ascensionStars, defaultAscension]);

    const missionSandbox = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'missionRewards', label: 'Mission rewards', value: missionRewardBonus, profileValue: profileMissionRewardBonus, min: 0, max: clanMax['MissionRewards'] || 0.1, step: 0.005, onChange: (v: number) => setSandbox(p => ({ ...p, missionRewards: v })) },
        ],
    };

    const displayRewards = useMemo(() => {
        if (!currentRewards?.Rewards) return [];
        return currentRewards.Rewards.map((r: Reward) => {
            let mult = 1 + missionRewardBonus;
            if (r.Type === 'GuildPotions') {
                mult *= (1 + ascensionStars * 0.1);
            }
            return { ...r, Amount: r.Amount * mult };
        });
    }, [currentRewards, missionRewardBonus, ascensionStars]);

    const displayAllMemberReward = useMemo(() => {
        if (!currentAllMemberReward) return null;
        let hammers = currentAllMemberReward.Hammers;
        let reward = currentAllMemberReward.Reward;
        
        if (reward && reward.Type === 'GuildPotions') {
            reward = { ...reward, Amount: reward.Amount * (1 + ascensionStars * 0.1) };
        }
        
        return { hammers, reward };
    }, [currentAllMemberReward, ascensionStars]);

    const getScaledValue = (base: number) => {
        if (!baseConfig) return base;
        const multiplier = baseConfig.HealthAndDamageLevelMultiplier;
        return Math.floor(base * Math.pow(multiplier, clanPoints - 1));
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted animate-pulse">
                <Target className="w-12 h-12 mb-4 opacity-20" />
                <p>Forging Mission Data</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-fade-in pb-20 px-4 sm:px-0">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-6 border-b border-border pb-8">
                <div className="space-y-2 text-center md:text-left">
                    <h1 className="text-4xl font-black text-text-primary flex items-center justify-center md:justify-start gap-4">
                        <Target className="w-10 h-10 text-accent-primary" />
                        Mission Calculator
                    </h1>
                    <p className="text-text-secondary text-lg font-medium">Test your strength and see if you can defeat missions alone, without your clan's help.</p>
                </div>

                {/* Base Config Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-6 gap-3 w-full md:w-auto">
                    <ConfigStat label="Daily Energy" value={baseConfig.DailyEnergy} icon={Zap} />
                    <ConfigStat label="Max Support" value={baseConfig.MaxSupportMembers} icon={Users} />
                    <ConfigStat label="Refresh Cost" value={baseConfig.RefreshGemCost} suffix=" Gems" icon={Star} />
                    <ConfigStat label="Refresh Count" value={baseConfig.RefreshMissionCount} icon={Settings} />
                    <ConfigStat label="Match Timer" value={`${baseConfig.MissionBattleMatchTimerSeconds}s`} icon={Clock} />
                    <ConfigStat label="Owner Rewards" value={`${baseConfig.MissionOwnerRewardsCount}x`} icon={Trophy} />
                </div>
            </div>

            <SandboxPanel
                fields={missionSandbox.fields}
                onReset={missionSandbox.reset}
                isModified={isSandboxModified}
            >
                <div className="pt-4 border-t border-purple-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Ascension Stars</span>
                        <div className="relative">
                            <select
                                value={ascensionStars}
                                onChange={(e) => setSandbox(p => ({ ...p, ascensionStars: parseInt(e.target.value) }))}
                                className="bg-bg-input border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500/80 rounded-lg px-3 py-1.5 text-xs text-white outline-none transition-all font-mono cursor-pointer appearance-none pr-8"
                            >
                                {Array.from({ length: 13 }).map((_, idx) => (
                                    <option key={idx} value={idx}>
                                        {idx} {idx === 1 ? 'Star' : 'Stars'} (+{idx * 10}%)
                                    </option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-purple-400">
                                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                    {/* Visual stars preview */}
                    <div className="flex items-center gap-1 min-h-[24px] flex-wrap bg-purple-500/10 rounded-lg px-3 py-1.5 border border-purple-500/20">
                        {ascensionStars > 0 ? (
                            <div className="flex items-center gap-0.5">
                                {Array.from({ length: ascensionStars }).map((_, idx) => (
                                    <img
                                        key={idx}
                                        src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/AscensionStar.png`}
                                        alt="Star"
                                        className="w-4 h-4 object-contain drop-shadow-[0_0_3px_rgba(251,191,36,0.6)] animate-fade-in"
                                        style={{ animationDelay: `${idx * 20}ms` }}
                                    />
                                ))}
                            </div>
                        ) : (
                            <span className="text-[10px] text-purple-300/60 italic font-medium">No ascension stars active</span>
                        )}
                    </div>
                </div>
            </SandboxPanel>

            {/* Level Slider Section */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <Card className="lg:col-span-1 p-6 bg-bg-secondary/40 border-accent-primary/20 flex flex-col justify-center gap-6 relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <TrendingUp size={100} />
                    </div>

                    <div className="space-y-1 relative z-10">
                        <div className="flex items-center gap-2 text-accent-primary">
                            <Activity size={16} />
                            <span className="text-[10px] font-black uppercase tracking-widest">Target Mission Level</span>
                        </div>
                        <h2 className="text-4xl font-black text-white">Lvl {clanPoints}</h2>
                    </div>

                    <div className="space-y-4 relative z-10">
                        <input
                            type="range"
                            min={1}
                            max={60}
                            value={clanPoints}
                            onChange={(e) => setClanPoints(parseInt(e.target.value))}
                            className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="flex justify-between text-[10px] font-black text-text-muted uppercase tracking-tighter">
                            <span>Level 1</span>
                            <span>Level 60</span>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-border/50 space-y-3 relative z-10">
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-text-muted uppercase leading-none">Hammer Thief Level to find it</span>
                            <span className="text-sm font-bold text-accent-secondary">{formatStage(currentClanLevelInfo?.MinHammerThiefLevel || 0)}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-text-muted uppercase leading-none">Available Rally Wait Times</span>
                            <div className="flex gap-2">
                                {Object.values(rallyTimeLibrary || {}).map(r => (
                                    <span key={r.Id} className="text-[10px] bg-accent-primary/10 text-accent-primary px-2 py-0.5 rounded font-black border border-accent-primary/20">{r.TimeInSeconds}s</span>
                                ))}
                            </div>
                        </div>
                    </div>
                </Card>

                {/* Rewards Summary */}
                <Card className="lg:col-span-3 p-6 bg-gradient-to-br from-bg-card to-bg-secondary border-accent-primary/20 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <Gift size={120} />
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                        <div className="p-3 bg-accent-primary/10 rounded-2xl">
                            <Gift className="w-8 h-8 text-accent-primary" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Mission Reward Pool</h2>
                            <p className="text-xs text-text-secondary">Exactly <span className="text-accent-primary font-bold">4 items are picked</span> per battle. If fewer than 4 items exist, some are repeated.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                        {displayRewards.map((r, idx) => {
                            const isGuildPotions = r.Type === 'GuildPotions';
                            return (
                                <div key={idx} className="bg-bg-primary/50 p-4 rounded-xl border border-border/50 flex flex-col items-center text-center group hover:border-accent-primary/50 transition-all relative">
                                    <GameIcon name={getRewardIcon(r.Type)} className="w-12 h-12 mb-2 group-hover:scale-110 transition-transform" />
                                    <div className="text-[9px] font-black text-text-muted uppercase mb-1">{r.Type.replace(/([A-Z])/g, ' $1').trim()}</div>
                                    <div className="text-lg font-black text-white flex items-center justify-center gap-1.5">
                                        {formatNumber(Math.round(r.Amount))}
                                        {isGuildPotions && ascensionStars > 0 && (
                                            <div className="flex items-center gap-0.5 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20 text-[9px] text-amber-400 font-mono font-bold">
                                                <img
                                                    src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/AscensionStar.png`}
                                                    alt="Ascension"
                                                    className="w-2.5 h-2.5 object-contain"
                                                />
                                                x{ascensionStars}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="bg-accent-primary/5 p-4 rounded-xl border border-accent-primary/30 flex flex-col items-center text-center group hover:border-accent-primary/50 transition-all relative">
                            <GameIcon name={displayAllMemberReward?.reward ? getRewardIcon(displayAllMemberReward.reward.Type) : "Hammer"} className="w-12 h-12 mb-2 group-hover:rotate-12 transition-transform" />
                            <div className="text-[9px] font-black text-accent-primary uppercase mb-1">
                                {displayAllMemberReward?.reward ? displayAllMemberReward.reward.Type.replace(/([A-Z])/g, ' $1').trim() : "Shared Hammers"}
                            </div>
                            <div className="text-lg font-black text-white flex items-center justify-center gap-1.5">
                                {formatNumber(Math.round(displayAllMemberReward?.hammers ?? displayAllMemberReward?.reward?.Amount ?? 0))}
                                {displayAllMemberReward?.reward?.Type === 'GuildPotions' && ascensionStars > 0 && (
                                    <div className="flex items-center gap-0.5 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20 text-[9px] text-amber-400 font-mono font-bold">
                                        <img
                                            src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/AscensionStar.png`}
                                            alt="Ascension"
                                            className="w-2.5 h-2.5 object-contain"
                                        />
                                        x{ascensionStars}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Missions List */}
            <div className="space-y-6 pt-4">
                <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-4">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                            Available Missions
                        </h2>
                        <p className="text-xs text-text-muted uppercase font-black">Stats scaled to Level {clanPoints}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                        <div className="flex items-center gap-2 bg-bg-secondary/40 border border-border/50 rounded-xl px-3 py-1.5 shadow-sm">
                            <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">Global Iterations</span>
                            <input
                                type="number"
                                min={1}
                                max={10000}
                                value={simCount}
                                onChange={(e) => setSimCount(Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-16 bg-bg-input/50 border border-accent-primary/20 rounded-lg px-2 py-0.5 text-[10px] font-black text-accent-primary text-center focus:border-accent-primary outline-none"
                            />
                        </div>

                        <button
                            onClick={handleSimulateAll}
                            disabled={isSimulatingAll}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-300",
                                "bg-accent-primary text-white shadow-lg shadow-accent-primary/20 hover:scale-105 active:scale-95",
                                isSimulatingAll && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {isSimulatingAll ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                            ) : (
                                <Zap className="w-4 h-4 fill-current" />
                            )}
                            {isSimulatingAll ? 'Simulating' : 'Simulate All'}
                        </button>

                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                            <input
                                placeholder="Filter missions"
                                className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-1 focus:ring-accent-primary outline-none transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filteredMissions.map((battle) => {
                        const scaledDmg = getScaledValue(battle.BaseDamage);
                        const scaledHp = getScaledValue(battle.BaseHealth);
                        // Suggested power is mission-SPECIFIC: 0.8 × UnitCount × (8·Damage + Health),
                        // on the per-level-scaled enemy stats (scaling already applied by getScaledValue).
                        // Calibrated to in-game values: Law L33 82.5B, Alien L33 49.5B, Black Sails L34 89.5B,
                        // Star Blades L34 125B. (The old fixed 144000 was just Star Blades' 9×16000, hardcoded.)
                        const suggestedPower = 0.8 * (battle.UnitCount || 1) * (8 * scaledDmg + scaledHp);

                        const result = missionResults[battle.MissionId];
                        const winRate = result?.winProbability || 0;
                        const hasSimulated = !!result;

                        return (
                            <Card key={battle.MissionId} className={cn(
                                "flex flex-col relative overflow-hidden transition-all duration-500 group",
                                "hover:translate-y-[-4px] hover:shadow-2xl border-border/40 hover:border-accent-primary/60",
                                hasSimulated && winRate > 50 && "bg-green-500/5 border-green-500/30 hover:border-green-500/60 shadow-green-500/5",
                                hasSimulated && winRate <= 50 && "bg-red-500/5 border-red-500/30 hover:border-red-500/60 shadow-red-500/5"
                            )}>
                                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
                                    <Target size={120} />
                                </div>

                                <div className="p-5 border-b border-border/50 flex justify-between items-start bg-gradient-to-r from-bg-secondary/40 to-transparent">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded-md uppercase border border-accent-primary/20">ID {battle.MissionId}</span>
                                            <div className="flex items-center gap-1 text-[9px] font-bold text-text-muted uppercase">
                                                <Target size={10} />
                                                Min Stage {formatStage(battle.MinLevel)}
                                            </div>
                                        </div>
                                        <h3 className="text-xl font-black text-white uppercase tracking-tight group-hover:text-accent-primary transition-colors leading-tight">
                                            {battle.MissionTitleId.replace(/([A-Z])/g, ' $1').trim()}
                                        </h3>
                                    </div>
                                </div>

                                <div className="p-5 space-y-6 flex-1">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 text-[9px] font-black text-red-400 uppercase opacity-80">
                                                Enemy ATK
                                            </div>
                                            <div className="text-xl font-black text-white tracking-tighter">
                                                {formatNumber(scaledDmg)}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 text-[9px] font-black text-green-400 uppercase opacity-80">
                                                <Heart size={10} /> Enemy HP
                                            </div>
                                            <div className="text-xl font-black text-white tracking-tighter">
                                                {formatNumber(scaledHp)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-bg-input/50 border border-border/50 rounded-xl p-3 flex flex-col items-center justify-center text-center group/power relative overflow-hidden">
                                        <div className="absolute inset-0 bg-accent-primary/5 opacity-0 group-hover/power:opacity-100 transition-opacity" />
                                        <div className="flex items-center gap-2 text-[9px] font-black text-accent-primary uppercase tracking-widest relative z-10">
                                            <Activity size={12} /> Suggested Power
                                        </div>
                                        <div className="text-xl font-black text-white tracking-tighter relative z-10">
                                            {formatNumber(suggestedPower)}
                                        </div>
                                        <div className="text-[8px] font-bold text-text-muted mt-0.5 opacity-0 group-hover/power:opacity-100 transition-all translate-y-2 group-hover/power:translate-y-0 relative z-10 text-center px-2">
                                            Formula: 0.8 × {battle.UnitCount} units × (8×Dmg + HP)
                                        </div>
                                    </div>

                                    <div className="space-y-4 pt-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-accent-secondary" />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">Enemy Loadout</span>
                                            </div>
                                            <span className="text-[10px] font-bold text-text-muted uppercase">Units: {battle.UnitCount}</span>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3">
                                            <ElegantDropSection
                                                label="Weaponry"
                                                chance={battle.ChanceToHaveWeapon}
                                                items={battle.PossibleWeapons}
                                                autoMapping={autoMapping}
                                                version={selectedVersion}
                                            />
                                            <ElegantDropSection
                                                label="Headgear"
                                                chance={battle.ChanceToHaveHelmet}
                                                items={battle.PossibleHelmets}
                                                autoMapping={autoMapping}
                                                version={selectedVersion}
                                            />
                                            <ElegantDropSection
                                                label="Armor Set"
                                                chance={battle.ChanceToHaveArmour}
                                                items={battle.PossibleArmours}
                                                autoMapping={autoMapping}
                                                version={selectedVersion}
                                            />
                                        </div>
                                    </div>
                                    <div className="pt-4 mt-auto border-t border-border/30 space-y-2">
                                        {missionResults[battle.MissionId] && (
                                            <div className={cn(
                                                "flex items-center justify-between p-2 rounded-lg text-[10px] font-black uppercase tracking-widest border",
                                                missionResults[battle.MissionId].winProbability > 50 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
                                            )}>
                                                <span>Win Rate: {missionResults[battle.MissionId].winProbability.toFixed(1)}%</span>
                                                <span>{missionResults[battle.MissionId].winProbability > 50 ? 'Likely Victory' : 'Likely Defeat'}</span>
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-1.5 mb-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest">Iterations</span>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={10000}
                                                    value={simCount}
                                                    onChange={(e) => setSimCount(Math.max(1, parseInt(e.target.value) || 1))}
                                                    className="w-16 bg-bg-input/50 border border-border/30 rounded-lg px-2 py-0.5 text-[10px] font-black text-accent-primary text-center focus:border-accent-primary outline-none"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleSimulate(battle)}
                                                disabled={simulatingMissions[battle.MissionId]}
                                                className={cn(
                                                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-300",
                                                    "bg-accent-primary/10 text-accent-primary border border-accent-primary/20 hover:bg-accent-primary hover:text-white hover:border-accent-primary shadow-lg shadow-accent-primary/5",
                                                    simulatingMissions[battle.MissionId] && "opacity-50 cursor-not-allowed"
                                                )}
                                            >
                                                {simulatingMissions[battle.MissionId] ? (
                                                    <div className="w-4 h-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
                                                ) : (
                                                    <Swords className="w-4 h-4" />
                                                )}
                                                {missionResults[battle.MissionId] ? 'Re-Simulate' : 'Simulate'}
                                            </button>

                                            {missionResults[battle.MissionId] && (
                                                <button
                                                    onClick={() => setSelectedBattleResult(missionResults[battle.MissionId])}
                                                    className="px-3 bg-accent-secondary/10 text-accent-secondary border border-accent-secondary/20 hover:bg-accent-secondary hover:text-white rounded-xl transition-all duration-300"
                                                    title="View Battle"
                                                >
                                                    <Play className="w-4 h-4 fill-current" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {selectedBattleResult && (
                <BattleVisualizerModal
                    isOpen={!!selectedBattleResult}
                    onClose={() => setSelectedBattleResult(null)}
                    playerStats={playerStats!}
                    profile={profile || null}
                    libs={libs}
                    ageIdx={-2} // Mission Flag
                    battleIdx={selectedBattleResult.battleIdx ?? 0} // Mission ID
                    difficultyMode={selectedBattleResult.difficultyIdx} // Level
                />
            )}
        </div>
    );
}

function ElegantDropSection({ label, chance, items, autoMapping, version }: { label: string, chance: number, items: { Item1: number, Item2: number }[] | null, autoMapping: any, version: string | null }) {
    if (!items || items.length === 0) return null;

    return (
        <div className="space-y-2 group/section">
            <div className="flex justify-between items-center">
                <span className="text-[9px] font-black text-text-muted uppercase tracking-widest group-hover/section:text-text-secondary transition-colors">{label}</span>
                <span className={cn(
                    "text-[8px] font-black px-1.5 py-0.5 rounded-sm border",
                    chance >= 1 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                )}>
                    {(chance * 100).toFixed(0)}% CHANCE
                </span>
            </div>
            <div className="flex flex-wrap gap-2">
                {items.slice(0, 5).map((item, i) => {
                    const ageName = AGES[item.Item1] || AGES[0];
                    const labelForImage = label === 'Weaponry' ? 'Weapon' : label === 'Headgear' ? 'Helmet' : 'Armour';
                    const iconPath = getItemImage(ageName, labelForImage, item.Item2, autoMapping, version || undefined);
                    const itemName = getItemName(ageName, labelForImage, item.Item2, autoMapping);

                    return (
                        <div key={i} className="group/drop relative w-10 h-10 rounded-xl bg-bg-primary/40 border border-border/40 flex items-center justify-center hover:border-accent-primary hover:bg-accent-primary/5 transition-all duration-300 shadow-sm" title={itemName || ''}>
                            {iconPath ? (
                                <img
                                    src={iconPath}
                                    alt={itemName || ''}
                                    className="w-8 h-8 object-contain pixelated group-hover:scale-110 transition-transform duration-300"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        if (version && target.src.includes(version)) {
                                            target.src = target.src.replace(`${version}/`, '');
                                        }
                                    }}
                                />
                            ) : (
                                <div className="text-[10px] text-text-muted font-black opacity-30">?</div>
                            )}

                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1.5 bg-bg-secondary text-[9px] font-black text-white rounded-lg opacity-0 group-hover/drop:opacity-100 transition-all duration-300 pointer-events-none whitespace-nowrap z-50 border border-accent-primary/30 shadow-xl translate-y-1 group-hover/drop:translate-y-0">
                                {itemName || 'Unknown Item'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ConfigStat({ label, value, suffix = '', icon: Icon }: { label: string, value: any, suffix?: string, icon: any }) {
    return (
        <div className="bg-bg-secondary/40 border border-border/40 rounded-2xl p-3 flex flex-col items-center justify-center text-center hover:border-accent-primary/30 hover:bg-bg-secondary/60 transition-all group">
            <Icon size={18} className="text-text-muted group-hover:text-accent-primary transition-all group-hover:scale-110 mb-1" />
            <div className="text-[9px] font-black text-text-muted uppercase mb-0.5 whitespace-nowrap tracking-tighter">{label}</div>
            <div className="text-xs font-black text-white">{value}{suffix}</div>
        </div>
    );
}
