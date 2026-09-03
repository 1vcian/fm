import { useMemo, useState } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { Target, Trophy, Sword, Settings, Clock, Users, Shield, Zap, Info, Gift, Hammer as HammerIcon, ChevronRight, Search, Activity, Heart, TrendingUp, Star, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGameDataContext } from '../context/GameDataContext';
import { AGES } from '../utils/constants';
import { getItemImage, getItemName } from '../utils/itemAssets';
import { formatNumber } from '../utils/format';

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

/**
 * The band of MissionLevelLibrary that first makes a given mission level reachable.
 *
 * Mission levels (1..60) and Hammer Thief levels (0..399) are two different scales, and
 * MissionLevelLibrary is the bridge: each row allows a band of mission levels
 * (MinLevel..MaxLevel) once you pass a minimum hammer level. A band spans several mission
 * levels, so a level becomes available well before the row whose Index equals it: mission
 * level 41 sits in band 37, at hammer 25-10, not band 41 at 28-9.
 *
 * Indexing the library by the mission level, as this page used to, therefore overstated every
 * requirement by roughly three worlds.
 */
function earliestBandFor(
    missionLevel: number,
    levelLibrary: Record<string, MissionLevel> | null
): MissionLevel | null {
    if (!levelLibrary) return null;
    const holding = Object.values(levelLibrary).filter(
        (b) => b.MinLevel <= missionLevel && missionLevel <= b.MaxLevel
    );
    if (!holding.length) return null;
    return holding.reduce((a, b) => (b.MinHammerThiefLevel < a.MinHammerThiefLevel ? b : a));
}

/** The hammer stage a mission level first becomes reachable at, or null when it always is. */
function hammerStageForMissionLevel(
    missionLevel: number,
    levelLibrary: Record<string, MissionLevel> | null
): string | null {
    const band = earliestBandFor(missionLevel, levelLibrary);
    if (!band || band.MinHammerThiefLevel <= 0) return null;
    return formatStage(band.MinHammerThiefLevel);
}

/**
 * The band you are in at a given Hammer Thief level: the highest row whose threshold you have
 * passed. Its MinLevel..MaxLevel is the range of mission levels that can appear for you.
 */
const HAMMER_MAX_LEVEL = 399;

function bandForHammerLevel(
    hammerLevel: number,
    levelLibrary: Record<string, MissionLevel> | null
): MissionLevel | null {
    if (!levelLibrary) return null;
    const passed = Object.values(levelLibrary).filter((b) => b.MinHammerThiefLevel <= hammerLevel);
    if (!passed.length) return null;
    return passed.reduce((a, b) => (b.MinHammerThiefLevel > a.MinHammerThiefLevel ? b : a));
}

export default function MissionsWiki() {
    const { selectedVersion } = useGameDataContext();
    const [missionLevel, setMissionLevel] = useState(1);
    // Drive the slider by Hammer Thief level instead, and let the mission levels follow.
    const [byHammer, setByHammer] = useState(false);
    const [hammerLevel, setHammerLevel] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');

    const { data: battleLibrary } = useGameData<Record<string, MissionBattle>>('MissionBattleLibrary.json');
    const { data: levelLibrary } = useGameData<Record<string, MissionLevel>>('MissionLevelLibrary.json');
    const { data: rewardLibrary } = useGameData<Record<string, MissionReward>>('MissionRewardLibrary.json');
    const { data: allMemberRewardLibrary } = useGameData<Record<string, MissionAllMemberReward>>('MissionAllMemberRewardLibrary.json');
    const { data: baseConfig } = useGameData<MissionBaseConfig>('MissionBaseConfig.json');
    const { data: rallyTimeLibrary } = useGameData<Record<string, MissionRallyTime>>('MissionRallyTimeLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');

    const loading = !battleLibrary || !levelLibrary || !rewardLibrary || !baseConfig || !allMemberRewardLibrary;

    const hammerBand = useMemo(
        () => bandForHammerLevel(hammerLevel, levelLibrary),
        [levelLibrary, hammerLevel]
    );

    // In mission mode: the band that unlocks the chosen level, not the row whose Index equals
    // it. In hammer mode: the band the chosen hammer level puts you in.
    const unlockBand = useMemo(
        () => (byHammer ? hammerBand : earliestBandFor(missionLevel, levelLibrary)),
        [byHammer, hammerBand, levelLibrary, missionLevel]
    );

    /**
     * The mission level every reward and stat below is computed at.
     *
     * Both modes share `missionLevel`, so in hammer mode the in-band slider just clamps it to
     * the band: move the hammer slider and the pick follows into the new range instead of
     * going out of bounds.
     */
    const effectiveLevel = useMemo(() => {
        if (!byHammer) return missionLevel;
        if (!hammerBand) return 1;
        return Math.min(Math.max(missionLevel, hammerBand.MinLevel), hammerBand.MaxLevel);
    }, [byHammer, hammerBand, missionLevel]);

    const currentAllMemberReward = useMemo(() => {
        if (!allMemberRewardLibrary) return null;
        return allMemberRewardLibrary[effectiveLevel.toString()];
    }, [allMemberRewardLibrary, effectiveLevel]);

    const currentRewards = useMemo(() => {
        if (!rewardLibrary) return null;
        return rewardLibrary[effectiveLevel.toString()];
    }, [rewardLibrary, effectiveLevel]);

    const filteredMissions = useMemo(() => {
        if (!battleLibrary) return [];
        return Object.values(battleLibrary)
            .filter(m => m.MissionTitleId.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => a.MinLevel - b.MinLevel);
    }, [battleLibrary, searchTerm]);

    const displayRewards = useMemo(() => {
        if (!currentRewards?.Rewards) return [];
        // Show all unique rewards from the pool
        return currentRewards.Rewards;
    }, [currentRewards]);

    const getScaledValue = (base: number) => {
        if (!baseConfig) return base;
        // Formula: base * (1 + (level - 1) * (multiplier - 1))
        const multiplier = baseConfig.HealthAndDamageLevelMultiplier;
        return Math.floor(base * Math.pow(multiplier, effectiveLevel - 1));
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
                        Mission Wiki
                    </h1>
                    <p className="text-text-secondary text-lg font-medium">Complete guide to Guild Missions, drops and scaling rewards.</p>
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

            {/* Level Slider Section */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <Card className="lg:col-span-1 p-6 bg-bg-secondary/40 border-accent-primary/20 flex flex-col justify-center gap-6 relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <TrendingUp size={100} />
                    </div>

                    <div className="space-y-1 relative z-10">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-accent-primary">
                                <Activity size={16} />
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                    {byHammer ? 'Hammer Thief Level' : 'Target Mission Level'}
                                </span>
                            </div>
                            {/* Two states, both visible: a lone button here read as a badge. */}
                            <div
                                role="group"
                                aria-label="Drive the slider by"
                                className="flex items-center gap-0.5 p-0.5 bg-bg-input rounded-lg border border-border shrink-0"
                            >
                                {([
                                    { label: 'Mission', on: false },
                                    { label: 'Hammer', on: true },
                                ] as const).map((opt) => (
                                    <button
                                        key={opt.label}
                                        type="button"
                                        aria-pressed={byHammer === opt.on}
                                        onClick={() => setByHammer(opt.on)}
                                        className={cn(
                                            'text-[9px] font-black uppercase tracking-wide px-2.5 py-1 rounded-md transition-colors',
                                            byHammer === opt.on
                                                ? 'bg-accent-primary text-white shadow-sm'
                                                : 'text-text-muted hover:text-text-primary'
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {byHammer ? (
                            <>
                                <h2 className="text-4xl font-black text-white">{formatStage(hammerLevel)}</h2>
                                <p className="text-xs font-black uppercase text-accent-secondary">
                                    {hammerBand
                                        ? `Mission Lv ${hammerBand.MinLevel} to ${hammerBand.MaxLevel}`
                                        : 'No missions yet'}
                                </p>
                            </>
                        ) : (
                            <h2 className="text-4xl font-black text-white">Lvl {missionLevel}</h2>
                        )}
                    </div>

                    <div className="space-y-4 relative z-10">
                        <input
                            type="range"
                            min={byHammer ? 0 : 1}
                            max={byHammer ? HAMMER_MAX_LEVEL : 60}
                            value={byHammer ? hammerLevel : missionLevel}
                            onChange={(e) =>
                                byHammer
                                    ? setHammerLevel(parseInt(e.target.value))
                                    : setMissionLevel(parseInt(e.target.value))
                            }
                            className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="flex justify-between text-[10px] font-black text-text-muted uppercase tracking-tighter">
                            <span>{byHammer ? formatStage(0) : 'Level 1'}</span>
                            <span>{byHammer ? formatStage(HAMMER_MAX_LEVEL) : 'Level 60'}</span>
                        </div>

                        {byHammer && hammerBand && (
                            <div className="space-y-1 pt-3 border-t border-border/50">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-tighter">
                                    <span className="text-text-muted">Mission Level</span>
                                    <span className="text-accent-secondary">Lv {effectiveLevel}</span>
                                </div>
                                <input
                                    type="range"
                                    min={hammerBand.MinLevel}
                                    max={hammerBand.MaxLevel}
                                    value={effectiveLevel}
                                    onChange={(e) => setMissionLevel(parseInt(e.target.value))}
                                    className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-secondary"
                                />
                                <div className="flex justify-between text-[10px] font-black text-text-muted uppercase tracking-tighter">
                                    <span>Lv {hammerBand.MinLevel}</span>
                                    <span>Lv {hammerBand.MaxLevel}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t border-border/50 space-y-3 relative z-10">
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-text-muted uppercase leading-none">
                                {byHammer ? 'Mission Levels You Can Find' : 'Hammer Thief Level to find it'}
                            </span>
                            <span className="text-sm font-bold text-accent-secondary">
                                {byHammer
                                    ? unlockBand
                                        ? `${unlockBand.MinLevel} to ${unlockBand.MaxLevel}`
                                        : 'None'
                                    : formatStage(unlockBand?.MinHammerThiefLevel || 0)}
                            </span>
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
                        {displayRewards.map((r, idx) => (
                            <div key={idx} className="bg-bg-primary/50 p-4 rounded-xl border border-border/50 flex flex-col items-center text-center group hover:border-accent-primary/50 transition-all">
                                <GameIcon name={getRewardIcon(r.Type)} className="w-12 h-12 mb-2 group-hover:scale-110 transition-transform" />
                                <div className="text-[9px] font-black text-text-muted uppercase mb-1">{r.Type.replace(/([A-Z])/g, ' $1').trim()}</div>
                                <div className="text-lg font-black text-white">{formatNumber(r.Amount)}</div>
                            </div>
                        ))}
                        <div className="bg-accent-primary/5 p-4 rounded-xl border border-accent-primary/30 flex flex-col items-center text-center group">
                            <GameIcon name="Hammer" className="w-12 h-12 mb-2 group-hover:rotate-12 transition-transform" />
                            <div className="text-[9px] font-black text-accent-primary uppercase mb-1">Shared Hammers</div>
                            <div className="text-lg font-black text-white">{currentAllMemberReward?.Hammers ?? currentAllMemberReward?.Reward?.Amount ?? 0}</div>
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
                        <p className="text-xs text-text-muted uppercase font-black">Stats scaled to Level {effectiveLevel}</p>
                    </div>
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                        <input
                            placeholder="Filter missions by name"
                            className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-1 focus:ring-accent-primary outline-none transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filteredMissions.map((battle) => {
                        // 1. Stats scale LINEARLY (Confirmed by user "K" values)
                        const scaledDmg = getScaledValue(battle.BaseDamage);
                        const scaledHp = getScaledValue(battle.BaseHealth);
                        
                        // Suggested power is mission-SPECIFIC: 0.8 × UnitCount × (8·Damage + Health),
                        // on the per-level-scaled enemy stats (scaling already applied by getScaledValue).
                        // Calibrated to in-game values: Law L33 82.5B, Alien L33 49.5B, Black Sails L34 89.5B,
                        // Star Blades L34 125B. (The old fixed 144000 was just Star Blades' 9×16000, hardcoded.)
                        const suggestedPower = 0.8 * (battle.UnitCount || 1) * (8 * scaledDmg + scaledHp);

                        return (
                            <Card key={battle.MissionId} className={cn(
                                "flex flex-col relative overflow-hidden transition-all duration-500 group",
                                "hover:translate-y-[-4px] hover:shadow-2xl hover:shadow-accent-primary/10 border-border/40 hover:border-accent-primary/60"
                            )}>
                                {/* Background Decorative Elements */}
                                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
                                    <Target size={120} />
                                </div>

                                {/* Header Card */}
                                <div className="p-5 border-b border-border/50 flex justify-between items-start bg-gradient-to-r from-bg-secondary/40 to-transparent">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded-md uppercase border border-accent-primary/20">ID {battle.MissionId}</span>
                                            <div className="flex items-center gap-1 text-[9px] font-bold text-text-muted uppercase">
                                                <Target size={10} />
                                                Min Lv {battle.MinLevel}
                                                {hammerStageForMissionLevel(battle.MinLevel, levelLibrary) && (
                                                    <span className="text-text-muted/70 normal-case">
                                                        (hammer {hammerStageForMissionLevel(battle.MinLevel, levelLibrary)})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <h3 className="text-xl font-black text-white uppercase tracking-tight group-hover:text-accent-primary transition-colors leading-tight">
                                            {battle.MissionTitleId.replace(/([A-Z])/g, ' $1').trim()}
                                        </h3>
                                    </div>
                                </div>

                                {/* Stats Body */}
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

                                    {/* Suggested Power Badge */}
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

                                    {/* Enemy Gear Section */}
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
                                </div>


                            </Card>
                        );
                    })}
                </div>
            </div>

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
