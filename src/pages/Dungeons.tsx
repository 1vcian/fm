
import { useState, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import { Sword, Heart, Trophy, Play, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { BattleVisualizerModal } from '../components/Battle/BattleVisualizerModal';
import { useProfile } from '../context/ProfileContext';
import { useBattleSimulation } from '../hooks/useBattleSimulation';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { useTreeMode } from '../context/TreeModeContext';
import { getItemImage } from '../utils/itemAssets';
import { AGES } from '../utils/constants';

// --- Types ---
type DungeonType = 'Hammer' | 'Skill' | 'Egg' | 'Potion';

interface TabConfig {
    id: DungeonType;
    label: string;
    icon: string;
    type: 'sprite';
    name: string;
}

const DUNGEON_TABS: TabConfig[] = [
    { id: 'Hammer', label: 'Hammer', name: 'Hammer Thief', icon: 'HammerKey', type: 'sprite' },
    { id: 'Skill', label: 'Skill', name: 'Skill Dungeon', icon: 'SkillKey', type: 'sprite' },
    { id: 'Egg', label: 'Egg', name: 'Egg Dungeon', icon: 'PetKey', type: 'sprite' },
    { id: 'Potion', label: 'Potion', name: 'Potion Dungeon', icon: 'PotionKey', type: 'sprite' },
];

// --- Egg Sprite Component ---
const EGG_RARITY_MAP: Record<string, number> = {
    'Common': 0,
    'Rare': 1,
    'Epic': 2,
    'Legendary': 3,
    'Ultimate': 4,
    'Mythic': 5,
};

function EggSprite({ rarity, size = 32 }: { rarity: string; size?: number }) {
    const idx = EGG_RARITY_MAP[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);

    // 4x4 Grid -> 400% size
    const xPos = (col / 3) * 100;
    const yPos = (row / 3) * 100;

    return (
        <div
            className="shrink-0 relative pixelated drop-shadow-md"
            style={{
                width: size,
                height: size,
                backgroundImage: 'url(./Texture2D/Eggs.png)',
                backgroundSize: '400% 400%',
                backgroundPosition: `${xPos}% ${yPos}%`,
                imageRendering: 'pixelated'
            }}
            title={rarity}
        />
    );
}

export default function Dungeons() {
    const [selectedTab, setSelectedTab] = useState<DungeonType>('Hammer');

    // Initialize levels for ALL tabs from LocalStorage
    const [levels, setLevels] = useState<Record<DungeonType, number>>(() => {
        const getVal = (key: string) => {
            const saved = localStorage.getItem(`dungeon_simulator_level_${key}`);
            return saved ? parseInt(saved, 10) : 1;
        };
        return {
            'Hammer': getVal('Hammer'),
            'Skill': getVal('Skill'),
            'Egg': getVal('Egg'),
            'Potion': getVal('Potion'),
        };
    });

    // Helper to update level for current tab
    const setLevel = (newLevel: number | ((prev: number) => number)) => {
        setLevels(prev => {
            const currentVal = prev[selectedTab];
            const val = typeof newLevel === 'function' ? newLevel(currentVal) : newLevel;
            // Persist immediately
            localStorage.setItem(`dungeon_simulator_level_${selectedTab}`, val.toString());
            return { ...prev, [selectedTab]: val };
        });
    };

    const level = levels[selectedTab];

    const [showDebug, setShowDebug] = useState(false);

    const { profile, updateNestedProfile } = useProfile();
    const { playerStats, libs } = useBattleSimulation();
    const { treeMode } = useTreeMode();

    const updateKeys = (type: string, count: number) => {
        const currentCounts = profile?.misc?.dungeonKeyCounts || { Hammer: 0, Skill: 0, Egg: 0, Potion: 0 };
        updateNestedProfile('misc', {
            dungeonKeyCounts: {
                ...currentCounts,
                [type]: count
            }
        });
    };

    // Reward Data
    const { data: rewardData } = useGameData<any>('DungeonRewardLibrary.json');
    const { data: eggRewardData } = useGameData<any>('DungeonRewardEggLibrary.json');
    const { data: techTreeMapping } = useGameData<any>('TechTreeMapping.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');

    // Get specific library based on type
    const dungeonLevelData = useMemo(() => {
        if (!libs) return null;
        const key = String(level - 1);
        switch (selectedTab) {
            case 'Hammer': return libs.hammerThiefDungeonBattleLibrary?.[key];
            case 'Skill': return libs.skillDungeonBattleLibrary?.[key];
            case 'Egg': return libs.eggDungeonBattleLibrary?.[key];
            case 'Potion': return libs.potionDungeonBattleLibrary?.[key];
        }
        return null;
    }, [selectedTab, level, libs]);

    // Construct Wave Details derived from Config
    const waveDetails = useMemo(() => {
        if (!dungeonLevelData || !libs?.enemyLibrary || !libs?.weaponLibrary) return [];

        const waves = [];

        // Hammer Dungeon implicit wave: 1 Wave, 1 Enemy if missing from config
        const isHammerImplicit = (selectedTab === 'Hammer' && dungeonLevelData.Wave1 === undefined);

        const levels = isHammerImplicit
            ? [1] // Default to 1 wave of 1 enemy
            : [dungeonLevelData.Wave1, dungeonLevelData.Wave2, dungeonLevelData.Wave3];

        const enemy1Id = dungeonLevelData.EnemyId1 ?? 0;
        const enemy2Id = dungeonLevelData.EnemyId2 ?? 0;

        for (let i = 0; i < levels.length; i++) {
            const count = levels[i];
            if (!count || count <= 0) continue;

            const waveEnemies: { id: number, count: number, config: any, weapon: any, weaponSpriteSrc: string | null }[] = [];

            if (isHammerImplicit) {
                // Hammer Dungeon Special Case
                // Weapon: {'Age': 10000, 'Type': 'Weapon', 'Idx': 0}
                const weaponKey = `{'Age': 10000, 'Type': 'Weapon', 'Idx': 0}`;
                const weaponInfo = libs.weaponLibrary[weaponKey];

                // Mock Enemy Config if missing
                const mockConfig = {
                    Name: "Hammer Thief",
                    SpriteName: "Battle", // Safe default
                    WeaponId: { Age: 10000, Type: 'Weapon', Idx: 0 }
                };

                const weaponSpriteSrc = "./Texture2D/IconMedievalWeaponWarhammer.png"; // Hardcoded guess for Hammer Thief

                waveEnemies.push({
                    id: 9999,
                    count: 1,
                    config: mockConfig,
                    weapon: weaponInfo,
                    weaponSpriteSrc
                });
            } else {
                const enemyCounts: Record<number, number> = {};
                for (let k = 0; k < count; k++) {
                    const id = (k % 2 === 0 || enemy2Id === 0) ? enemy1Id : enemy2Id;
                    enemyCounts[id] = (enemyCounts[id] || 0) + 1;
                }

                Object.entries(enemyCounts).forEach(([idStr, num]) => {
                    const id = parseInt(idStr);
                    const enemyConfig = libs.enemyLibrary[String(id)];
                    const weaponKey = enemyConfig?.WeaponId ? `{'Age': ${enemyConfig.WeaponId.Age}, 'Type': 'Weapon', 'Idx': ${enemyConfig.WeaponId.Idx}}` : null;
                    const weaponInfo = (weaponKey && libs.weaponLibrary) ? libs.weaponLibrary[weaponKey] : null;

                    // Resolve Weapon Sprite
                    let weaponSpriteSrc = null;

                    // FORCE Hammer for Hammer Dungeon
                    if (selectedTab === 'Hammer') {
                        weaponSpriteSrc = "./Texture2D/IconMedievalWeaponWarhammer.png";
                    }
                    else if (enemyConfig?.WeaponId) {
                        const ageName = AGES[enemyConfig.WeaponId.Age];
                        if (ageName) {
                            weaponSpriteSrc = getItemImage(ageName, 'Weapon', enemyConfig.WeaponId.Idx, null);
                        }
                    }

                    // Smart Fallback for Ranged to avoid "Inverted" look
                    if (!weaponSpriteSrc && weaponInfo) {
                        const isRanged = (weaponInfo.AttackRange || 0) > 1.0;
                        if (isRanged) {
                            weaponSpriteSrc = "./Texture2D/IconMedievalWeaponBow.png";
                        }
                    }

                    waveEnemies.push({
                        id,
                        count: num,
                        config: enemyConfig,
                        weapon: weaponInfo,
                        weaponSpriteSrc
                    });
                });
            }

            waves.push({
                index: i + 1,
                totalCount: count,
                enemies: waveEnemies
            });
        }
        return waves;
    }, [dungeonLevelData, libs, selectedTab]);

    // Tech Tree Multipliers
    const techTreeMultipliers = useMemo(() => {
        if (!profile || !techTreeMapping || !techTreeLibrary) return { Hammer: 1, Coin: 1, Ticket: 1, Potion: 1 };

        // Mode Handling: 'empty' -> no multipliers. 'max' -> assume Level Max
        if (treeMode === 'empty') return { Hammer: 1, Coin: 1, Ticket: 1, Potion: 1 };

        let multipliers = { Hammer: 1, Coin: 1, Ticket: 1, Potion: 1 };

        // Helper to check a tree
        const checkTree = (treeName: 'Forge' | 'Power' | 'SkillsPetTech') => {
            const userTree = profile.techTree[treeName];
            const mappingTree = techTreeMapping.trees?.[treeName]?.nodes;

            if (!mappingTree) return;

            mappingTree.forEach((nodeMap: any) => {
                const nodeId = nodeMap.id;
                let level = 0;

                if (treeMode === 'my') {
                    level = userTree?.[nodeId] || 0;
                } else if (treeMode === 'max') {
                    // Get MaxLevel from Library
                    const nodeDef = techTreeLibrary[nodeMap.type];
                    level = nodeDef?.MaxLevel || 0;
                }

                if (level <= 0) return;

                const nodeType = nodeMap.type;
                const nodeDef = techTreeLibrary[nodeType];

                if (!nodeDef?.Stats) return;

                // Identify if this node boosts any rewards
                let target: keyof typeof multipliers | null = null;
                if (nodeType.includes('HammerReward')) target = 'Hammer';
                else if (nodeType.includes('CoinReward')) target = 'Coin';
                else if (nodeType.includes('GhostTownSkillBonus')) target = 'Ticket'; // Explicit mapping
                else if (nodeType.includes('ZombieRushTechPotions')) target = 'Potion'; // Explicit mapping
                else if (nodeType.includes('TicketReward')) target = 'Ticket'; // Fallback
                else if (nodeType.includes('PotionReward')) target = 'Potion'; // Fallback

                if (target) {
                    const stat = nodeDef.Stats[0];
                    if (stat) {
                        const bonus = (stat.Value || 0) + ((level - 1) * (stat.ValueIncrease || 0));
                        multipliers[target] += bonus;
                    }
                }
            });
        };

        checkTree('Forge');
        checkTree('Power');
        checkTree('SkillsPetTech');

        return multipliers;

    }, [profile, techTreeMapping, techTreeLibrary, treeMode]);

    // Calculate Reward info (Array support for Hammer)
    const rewardInfo = useMemo(() => {
        const levelIndex = level - 1;

        if (selectedTab === 'Egg') {
            if (!eggRewardData) return null;
            return { type: 'Egg' as const, data: eggRewardData[String(levelIndex)] };
        } else {
            if (!rewardData) return null;
            const rew = rewardData[selectedTab];
            if (!rew) return null;

            // Map all currencies
            const rewards = (rew.CurrencyType || []).map((curr: string, idx: number) => {
                const base = rew.RewardBase?.[idx] || 0;
                const inc = rew.RewardIncrease?.[idx] || 0;
                let amount = base + (inc * levelIndex);

                // Apply Multipliers
                if (curr === 'Hammers') amount *= techTreeMultipliers.Hammer;
                if (curr === 'Coins') amount *= techTreeMultipliers.Coin;
                if (curr.includes('Ticket')) amount *= techTreeMultipliers.Ticket;
                if (curr.includes('Potion')) amount *= techTreeMultipliers.Potion;

                return { currency: curr, amount };
            });

            return { type: 'Currency' as const, rewards };
        }
    }, [selectedTab, level, rewardData, eggRewardData, techTreeMultipliers]);

    const navigate = (delta: number) => {
        setLevel(prev => Math.max(1, Math.min(100, prev + delta)));
    };

    const getStageLabel = (lvl: number) => {
        const world = Math.floor((lvl - 1) / 10) + 1;
        const stage = ((lvl - 1) % 10) + 1;
        return `${world}-${stage}`;
    };

    const getRewardIcon = (currency: string) => {
        if (currency === 'Hammers') return 'Hammer';
        if (currency === 'Coins') return 'Coin';
        if (currency === 'SkillSummonTickets') return 'SkillTicket';
        if (currency === 'TechPotions') return 'Potion';
        if (currency === 'HeroSummonTickets') return 'PVPTicket';
        return 'GemSquare'; // Fallback
    };


    // War Config
    const { data: warDayConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');

    // Dynamic War Points Mapping
    const warPointsPerKey = useMemo(() => {
        if (!warDayConfig) return { Hammer: 1000, Skill: 1000, Egg: 1000, Potion: 1000 };

        const day1 = warDayConfig['1'] || warDayConfig[1]; // Verify key is string or number in JSON
        if (!day1 || !day1.Tasks) return { Hammer: 1000, Skill: 1000, Egg: 1000, Potion: 1000 };

        const getPoints = (taskName: string) => {
            const task = day1.Tasks.find((t: any) => t.Task === taskName);
            // Reward is usually a list, get first WarPointsReward
            const reward = task?.Rewards?.find((r: any) => r.$type === 'WarPointsReward');
            return reward?.Amount || 0;
        };

        return {
            Hammer: getPoints('UseHammerThiefDungeonKey') || 1000,
            Skill: getPoints('UseGhostTownDungeonKey') || 1000, // Check mapping: GhostTown usually gives Skill Tickets
            Egg: getPoints('UseInvasionDungeonKey') || 1000,
            Potion: getPoints('UseZombieInvasionDungeonKey') || 1000
        };
    }, [warDayConfig]);

    // ... (rest of code) ...

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-20 animate-in fade-in">
            {/* Header / Tabs */}
            <div className="flex flex-col xl:flex-row items-center justify-between gap-6 border-b border-white/10 pb-6">
                <div className="flex-1">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent mb-2 flex items-center gap-3">
                        <SpriteIcon name="UnknownKey" size={40} className="drop-shadow-glow" />
                        Dungeon Analyzer
                    </h1>
                    <p className="text-text-secondary">Analyze enemy compositions and rewards for every stage.</p>
                </div>

                {/* Key Calculator */}
                <Card className="bg-bg-secondary/40 border-white/10 p-4 min-w-[340px] shrink-0">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-2">
                            <SpriteIcon name="GemSquare" size={16} />
                            Guild War Points (Day 1)
                        </h3>
                        <div className="bg-accent-primary/20 text-accent-primary px-2 py-1 rounded text-xs font-bold border border-accent-primary/20">
                            {Object.entries(profile?.misc?.dungeonKeyCounts || {}).reduce((sum, [type, count]) => {
                                const pts = warPointsPerKey[type as DungeonType] || 0;
                                return sum + (count * pts);
                            }, 0)} Points
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        {DUNGEON_TABS.map(tab => {
                            const keyCount = (profile?.misc?.dungeonKeyCounts as any)?.[tab.id] || 0;
                            const pts = warPointsPerKey[tab.id];
                            const totalPts = keyCount * pts;
                            return (
                                <div key={tab.id} className="flex flex-col items-center gap-2">
                                    <div className="relative group">
                                        <SpriteIcon name={tab.icon} size={32} className="drop-shadow-md" />
                                        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-black/90 px-1.5 py-0.5 rounded text-[9px] border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none text-white">
                                            {totalPts} pts ({pts}/key)
                                        </span>
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        className="w-14 bg-black/40 border border-white/10 rounded-lg text-center text-sm font-bold p-1 focus:border-accent-primary outline-none transition-colors"
                                        value={keyCount}
                                        onChange={(e) => updateKeys(tab.id, Math.max(0, parseInt(e.target.value) || 0))}
                                        onFocus={(e) => e.target.select()}
                                    />
                                </div>
                            )
                        })}
                    </div>
                </Card>

                <div className="flex bg-black/20 p-1 rounded-xl border border-white/5 shrink-0">
                    {DUNGEON_TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => { setSelectedTab(tab.id); }}
                            className={cn(
                                "flex items-center gap-2 px-4 py-3 rounded-lg font-bold transition-all",
                                selectedTab === tab.id
                                    ? "bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 text-white border border-accent-primary/50 shadow-lg"
                                    : "text-text-muted hover:text-white hover:bg-white/5"
                            )}
                        >
                            <SpriteIcon name={tab.icon} size={24} className="drop-shadow-md" />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                {/* Stage Selector & Stats (Left - 8 cols) */}
                <div className="lg:col-span-8 space-y-6">
                    {/* Stage Control */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                    Stage {getStageLabel(level)}
                                </h2>
                                <div className="text-sm text-text-muted font-mono mt-1">
                                    Global Level: {level}
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <button onClick={() => navigate(-1)} disabled={level <= 1} className="p-3 bg-black/40 rounded-lg hover:bg-black/60 disabled:opacity-30 border border-white/5">
                                    <ChevronLeft className="w-6 h-6" />
                                </button>
                                <div className="text-center w-24">
                                    <div className="text-xs uppercase text-text-muted font-bold tracking-wider mb-1">Stage</div>
                                    <div className="text-3xl font-black text-accent-primary">{getStageLabel(level)}</div>
                                </div>
                                <button onClick={() => navigate(1)} disabled={level >= 100} className="p-3 bg-black/40 rounded-lg hover:bg-black/60 disabled:opacity-30 border border-white/5">
                                    <ChevronRight className="w-6 h-6" />
                                </button>
                            </div>
                        </div>

                        <input
                            type="range"
                            min="1"
                            max="100"
                            value={level}
                            onChange={(e) => setLevel(parseInt(e.target.value))}
                            className="w-full h-4 bg-black/40 rounded-lg appearance-none cursor-pointer accent-accent-primary mb-2"
                        />
                        <div className="flex justify-between text-xs text-text-secondary font-mono">
                            <span>Stage 1-1</span>
                            <span>Stage 5-10</span>
                            <span>Stage 10-10</span>
                        </div>
                    </Card>

                    {/* Wave Details */}
                    <div className="grid grid-cols-1 gap-4">
                        {waveDetails.map((wave, idx) => (
                            <Card key={idx} className="p-0 overflow-hidden border-white/5 bg-bg-secondary/50">
                                <div className="bg-black/20 p-3 border-b border-white/5 flex justify-between items-center">
                                    <span className="font-bold text-sm uppercase tracking-wider text-text-secondary">Wave {wave.index}</span>
                                    <span className="text-xs font-mono bg-white/5 px-2 py-1 rounded text-text-muted">{wave.totalCount} Enemies</span>
                                </div>
                                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {wave.enemies.map((enemy, eIdx) => (
                                        <div key={eIdx} className="flex items-center gap-4 bg-black/20 p-3 rounded-lg border border-white/5 relative">
                                            {/* Enemy Icon */}
                                            <div className="absolute -bottom-2 -right-2 bg-black/80 px-1.5 rounded text-[10px] font-bold border border-white/10">
                                                x{enemy.count}
                                            </div>

                                            <div className="flex-1 space-y-1">
                                                <div className="flex justify-between items-start">
                                                    <span className="font-bold text-sm text-white truncate w-32">{enemy.config?.Name || `Enemy ${enemy.id}`}</span>
                                                    {enemy.config?.IsBoss && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded border border-red-500/30">BOSS</span>}
                                                </div>

                                                {/* Stats */}
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    <div className="flex items-center gap-1.5 text-xs text-red-300 bg-red-500/5 px-2 py-1 rounded grow-0 shrink-1">
                                                        <Sword className="w-3 h-3 shrink-0" />
                                                        <span className="font-mono truncate">{Math.round(dungeonLevelData?.Damage || 0).toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-xs text-green-300 bg-green-500/5 px-2 py-1 rounded grow-0 shrink-1">
                                                        <Heart className="w-3 h-3 shrink-0" />
                                                        <span className="font-mono truncate">{Math.round(dungeonLevelData?.Health || 0).toLocaleString()}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Weapon info */}
                                            {enemy.weapon && (
                                                <div className="flex flex-col items-center gap-2 pl-3 border-l border-white/5 min-w-[60px]">
                                                    {/* Specific Weapon Image */}
                                                    <div className="w-8 h-8 flex items-center justify-center">
                                                        {enemy.weaponSpriteSrc ? (
                                                            <img
                                                                src={enemy.weaponSpriteSrc}
                                                                alt="Weapon"
                                                                className="w-full h-full object-contain drop-shadow-md filter brightness-110"
                                                            />
                                                        ) : (
                                                            <SpriteIcon name="Sword" size={24} className="opacity-50" />
                                                        )}
                                                    </div>

                                                    {/* Range Type Indicator */}
                                                    <div className={cn(
                                                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border",
                                                        (enemy.weapon.AttackRange || 0) > 1.0
                                                            ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                                                            : "bg-red-500/10 text-red-400 border-red-500/30"
                                                    )}>
                                                        {(enemy.weapon.AttackRange || 0) > 1.0 ? (
                                                            <img src="./Texture2D/IconMedievalWeaponBow.png" className="w-3 h-3" alt="Ranged" />
                                                        ) : (
                                                            <SpriteIcon name="Sword" size={12} />
                                                        )}
                                                        <span>{(enemy.weapon.AttackRange || 0) > 1.0 ? "Ranged" : "Melee"}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        ))}

                        {!waveDetails.length && (
                            <Card className="p-8 text-center border-dashed border-white/10 bg-transparent">
                                <AlertTriangle className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-50" />
                                <div className="text-text-muted">No wave data available for this stage.</div>
                            </Card>
                        )}
                    </div>
                </div>

                {/* Rewards Panel (Right - 4 cols) */}
                <div className="lg:col-span-4 space-y-6">
                    <Card className="p-6 relative overflow-hidden flex flex-col bg-gradient-to-b from-bg-secondary to-black/40 border-accent-primary/30">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                        <div className="relative z-10 flex-1">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                                <Trophy className="w-6 h-6 text-yellow-500" />
                                Stage Rewards
                                <span className={cn("text-xs px-2 py-0.5 rounded font-mono ml-auto", treeMode === 'max' ? "bg-green-500/20 text-green-400" : treeMode === 'empty' ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400")}>
                                    {treeMode === 'max' ? 'MAX TREE' : treeMode === 'empty' ? 'NO TREE' : 'MY TREE'}
                                </span>
                            </h3>

                            {rewardInfo?.type === 'Egg' && rewardInfo.data ? (
                                <div className="space-y-4">
                                    {['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].map((rarity) => {
                                        const chance = rewardInfo.data[rarity] || 0;
                                        if (chance <= 0) return null;
                                        return (
                                            <div key={rarity} className="flex justify-between items-center p-3 bg-white/5 rounded-lg border border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <EggSprite rarity={rarity} size={32} />
                                                    <span className={cn("text-sm font-bold", `text-rarity-${rarity.toLowerCase()}`)}>{rarity}</span>
                                                </div>
                                                <span className="font-mono text-white font-bold">{(chance * 100).toFixed(2)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : rewardInfo?.type === 'Currency' && rewardInfo?.rewards ? (
                                <div className="space-y-6 text-center py-6">
                                    <div className="w-24 h-24 mx-auto bg-gradient-to-br from-white/10 to-transparent rounded-full flex items-center justify-center border border-white/10 mb-6 relative group">
                                        <div className="absolute inset-0 bg-accent-primary/20 rounded-full blur-xl opacity-50 group-hover:opacity-100 transition-opacity" />
                                        <SpriteIcon name={DUNGEON_TABS.find(t => t.id === selectedTab)?.icon || ""} size={48} className="relative z-10 drop-shadow-lg scale-125" />
                                    </div>

                                    <div className="space-y-4">
                                        {rewardInfo.rewards.map((rew: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between gap-4 p-3 bg-white/5 rounded-lg border border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <SpriteIcon name={getRewardIcon(rew.currency)} size={32} className="drop-shadow-md" />

                                                </div>
                                                <div className="text-xl font-black text-white tracking-tight">
                                                    {Math.round(rew.amount).toLocaleString()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-10 opacity-50">No Data</div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="mt-8 pt-6 border-t border-white/10">
                            <button
                                onClick={() => setShowDebug(true)}
                                className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-bold border border-red-500/30 transition-all flex items-center justify-center gap-2 group"
                            >
                                <Play className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                Simulate Battle
                            </button>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Simulator Modal */}
            {showDebug && dungeonLevelData && (
                <BattleVisualizerModal
                    isOpen={showDebug}
                    onClose={() => setShowDebug(false)}
                    libs={{ ...libs!, enemyLibrary: libs?.enemyLibrary! }}
                    playerStats={playerStats!}
                    profile={profile || null}
                    ageIdx={-1}
                    battleIdx={-1}
                    difficultyMode={0}
                    dungeonType={selectedTab === 'Hammer' ? 'hammer' : selectedTab === 'Skill' ? 'skill' : selectedTab === 'Egg' ? 'egg' : 'potion'}
                    dungeonLevel={level - 1} // 0-99
                    customWaves={undefined}
                />
            )}
            {/* Background Decoration */}
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <SpriteIcon name="UnknownKey" size={256} className="grayscale" />
            </div>
        </div>
    );
}
