import { useState, useMemo, useEffect, useRef } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useTreeMode } from '../../context/TreeModeContext';
import { useGameData } from '../../hooks/useGameData';
import { GameIcon } from '../../components/UI/GameIcon';
import { Calculator, ArrowRightLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { AGES } from '../../utils/constants';

// Helper types matching JSON structure
interface ItemAgeDropChances {
    [level: string]: {
        Level: number;
        [age: string]: number; // Age0, Age1, etc.
    };
}

interface ItemLevelBrackets {
    [id: string]: {
        Level: number;
        LowerRange: number;
        UpperRange: number;
    };
}

interface ItemBalancingConfig {
    LevelScalingBase: number;
    SellBasePrice: number;
    ItemBaseMaxLevel: number;
    // ... other fields
}

interface TechTreeNode {
    Type: string;
    MaxLevel?: number;
    Stats: {
        StatNode: {
            UniqueStat: {
                StatType: string;
                StatNature: string;
            };
            StatTarget?: {
                ItemType?: number;
            };
        };
        Value: number;
        ValueIncrease: number;
    }[];
}

interface TechTreeLibrary {
    [key: string]: TechTreeNode;
}

interface GuildWarDayConfig {
    [day: string]: {
        Tasks: {
            Task: string;
            Rewards: {
                Amount: number;
                $type: string;
            }[];
        }[];
    };
}

// Inline helper until shared util is created/verified
function getAgeIconStyle(ageIndex: number, size: number = 32): React.CSSProperties {
    const col = ageIndex % 4;
    const row = Math.floor(ageIndex / 4);
    const spriteSize = 128;
    const sheetWidth = 512;
    const sheetHeight = 512;
    const scale = size / spriteSize;

    return {
        backgroundImage: `url(/Texture2D/AgeIcons.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetWidth * scale}px ${sheetHeight * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
    };
}

// Helper for Tech Tree Icons
function getTechTreeIconStyle(spriteIndex: number, size: number = 32): React.CSSProperties {
    // 8x8 grid based on TechTreeIcons.png size 1024x1024 and sprite size 128
    const cols = 8;
    const col = spriteIndex % cols;
    const row = Math.floor(spriteIndex / cols);
    const spriteSize = 128;
    const sheetSize = 1024;
    const scale = size / spriteSize;

    return {
        backgroundImage: `url(/Texture2D/TechTreeIcons.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetSize * scale}px ${sheetSize * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
    };
}

type CalculationMode = 'hammers' | 'gold';

export default function ForgeCalculator() {
    const { profile, updateNestedProfile } = useProfile();
    const { treeMode } = useTreeMode();

    // Refs for persistence debounce
    const saveTimeout = useRef<NodeJS.Timeout>();

    // Initial State loading from Profile
    const [mode, setMode] = useState<CalculationMode>(() => {
        return profile.misc.forgeCalculator?.mode || 'hammers';
    });

    // We use separate states if we want to preserve input when switching? 
    // Or just one input reused. Let's use separate inputs as they have different magnitudes probably.
    const [hammersInput, setHammersInput] = useState<string>(() => profile.misc.forgeCalculator?.hammers || '0');
    const [goldInput, setGoldInput] = useState<string>(() => profile.misc.forgeCalculator?.targetGold || '0');

    // Derived input for calculation
    const inputValue = mode === 'hammers' ? hammersInput : goldInput;

    const handleInputChange = (val: string) => {
        if (mode === 'hammers') {
            setHammersInput(val);
        } else {
            setGoldInput(val);
        }
    };

    // Persistence Effect
    useEffect(() => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);

        saveTimeout.current = setTimeout(() => {
            updateNestedProfile('misc', {
                forgeCalculator: {
                    hammers: hammersInput,
                    targetGold: goldInput,
                    mode: mode
                }
            });
        }, 1000); // 1s debounce

        return () => {
            if (saveTimeout.current) clearTimeout(saveTimeout.current);
        };
    }, [hammersInput, goldInput, mode, updateNestedProfile]);

    // Load Configs
    const { data: dropChances } = useGameData<ItemAgeDropChances>('ItemAgeDropChancesLibrary.json');
    const { data: brackets } = useGameData<ItemLevelBrackets>('ItemLevelBracketsLibrary.json');
    const { data: balancingConfig } = useGameData<ItemBalancingConfig>('ItemBalancingConfig.json');
    const { data: techTreeLib } = useGameData<TechTreeLibrary>('TechTreeLibrary.json');
    const { data: techTreeMap } = useGameData<any>('TechTreeMapping.json');
    const { data: guildWarConfig } = useGameData<GuildWarDayConfig>('GuildWarDayConfigLibrary.json');

    // Parse War Points from Config
    const warPointsPerAge = useMemo(() => {
        const pointsMap: Record<number, number> = {};
        if (!guildWarConfig) return pointsMap;

        // Iterate through all days to find forge tasks
        Object.values(guildWarConfig).forEach(day => {
            day.Tasks?.forEach(task => {
                const match = task.Task.match(/^Forge(.+)Equipment$/);
                if (match) {
                    const ageName = match[1];
                    // Find index in AGES array (handling potentially different casing if needed, though usually exact)
                    const ageIdx = AGES.findIndex(a => a.replace('-', '') === ageName || a === ageName);

                    // Specific mapping fix for "EarlyModern" vs "Early-Modern" if needed
                    // AGES has "Early-Modern", Task has "EarlyModern" based on previous file view
                    let finalIdx = ageIdx;
                    if (finalIdx === -1 && ageName === "EarlyModern") finalIdx = 2;

                    if (finalIdx !== -1) {
                        const reward = task.Rewards.find(r => r.$type === "WarPointsReward");
                        if (reward) {
                            pointsMap[finalIdx] = reward.Amount;
                        }
                    }
                }
            });
        });
        return pointsMap;
    }, [guildWarConfig]);

    // 1. Calculate Bonuses from Tree
    const bonuses = useMemo(() => {
        let sellPriceBonus = 0;
        let freeForgeChance = 0;
        let maxLevelBonus = 0;

        if (!techTreeLib || !techTreeMap) return { sellPriceBonus, freeForgeChance, maxLevelBonus };

        // Iterate through all trees in Mapping to find relevant nodes
        ['Forge', 'Power', 'SkillsPetTech'].forEach((treeName) => {
            const treeRoot = techTreeMap.trees?.[treeName];
            if (!treeRoot || !Array.isArray(treeRoot.nodes)) return;

            treeRoot.nodes.forEach((nodeMap: any) => {
                const nodeDef = techTreeLib[nodeMap.type];
                if (!nodeDef) return;

                let level = 0;
                if (treeMode === 'max') {
                    level = nodeDef.MaxLevel || 0;
                } else if (treeMode === 'my') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const tree = profile.techTree[treeName as keyof typeof profile.techTree] as Record<number, number>;
                    level = tree?.[nodeMap.id] || 0;
                }

                if (level === 0) return;

                const stat = nodeDef.Stats?.[0];
                if (!stat) return;

                // Value is usually for Level 1, then +ValueIncrease per level
                const nodeVal = stat.Value + (level - 1) * stat.ValueIncrease;

                switch (nodeDef.Type) {
                    case 'EquipmentSellPrice':
                        sellPriceBonus += nodeVal;
                        break;
                    case 'FreeForgeChance':
                        freeForgeChance += nodeVal;
                        break;
                    case 'WeaponLevelUp':
                    case 'HelmetLevelUp':
                    case 'BodyLevelUp':
                    case 'GlovesLevelUp':
                    case 'GloveLevelUp':
                    case 'BeltLevelUp':
                    case 'NecklaceLevelUp':
                    case 'RingLevelUp':
                    case 'ShoesLevelUp':
                    case 'ShoeLevelUp':
                        // Cap increase applies globally to the "Max Cap" logic
                        // We average them or sum them?
                        // If I have +2 Weapon Level, my Max Weapon is 100.
                        // Since we are estimating "Average Item" value from previous ages, 
                        // and previous ages drop ALL types, we should probably take the AVERAGE level increase.
                        maxLevelBonus += nodeVal / 8;
                        break;
                }
            });
        });

        return { sellPriceBonus, freeForgeChance, maxLevelBonus };
    }, [profile, treeMode, techTreeLib, techTreeMap]);


    // 2. Identify Forge Level and Max/Current Item Levels
    const forgeStats = useMemo(() => {
        if (!brackets || !balancingConfig || !dropChances) return null;

        const currentForgeLevel = profile.misc.forgeLevel;

        // Find highest level item currently owned
        let maxOwnedLevel = 0;
        Object.values(profile.items).forEach(item => {
            if (item && item.level > maxOwnedLevel) maxOwnedLevel = item.level;
        });

        // Find brackets
        // 1. Current Age Bracket
        let currentBracket = null;
        Object.values(brackets).forEach(b => {
            if (maxOwnedLevel >= b.LowerRange && maxOwnedLevel <= b.UpperRange) {
                currentBracket = b;
            }
        });
        if (!currentBracket && maxOwnedLevel > 0) {
            const lastKey = Object.keys(brackets).sort((a, b) => Number(b) - Number(a))[0];
            currentBracket = brackets[lastKey];
        } else if (!currentBracket) {
            currentBracket = brackets["0"];
        }

        // 2. Max Cap Bracket
        const absoluteMaxLevel = balancingConfig.ItemBaseMaxLevel + bonuses.maxLevelBonus;
        let maxCapBracket = null;
        Object.values(brackets).forEach(b => {
            if (absoluteMaxLevel >= b.LowerRange && absoluteMaxLevel <= b.UpperRange) {
                maxCapBracket = b;
            }
        });
        if (!maxCapBracket) {
            const lastKey = Object.keys(brackets).sort((a, b) => Number(b) - Number(a))[0];
            maxCapBracket = brackets[lastKey];
        }

        const currentAvgLevel = (currentBracket.LowerRange + currentBracket.UpperRange) / 2;
        const maxCapAvgLevel = (maxCapBracket.LowerRange + maxCapBracket.UpperRange) / 2;

        const currentBasePrice = balancingConfig.SellBasePrice * Math.pow(balancingConfig.LevelScalingBase, currentAvgLevel);
        const maxCapBasePrice = balancingConfig.SellBasePrice * Math.pow(balancingConfig.LevelScalingBase, maxCapAvgLevel);

        const currentFinalPrice = currentBasePrice * (1 + bonuses.sellPriceBonus);
        const maxCapFinalPrice = maxCapBasePrice * (1 + bonuses.sellPriceBonus);

        // Get Drop Chances for this forge level
        const dropChanceData = dropChances[currentForgeLevel.toString()];

        return {
            currentFinalPrice,
            maxCapFinalPrice,
            dropChanceData,
            forgeLevel: currentForgeLevel
        };

    }, [profile, brackets, balancingConfig, dropChances, bonuses]);

    // 3. Perform Final Calculation (Bidirectional)
    const results = useMemo(() => {
        if (!forgeStats || !forgeStats.dropChanceData) return null;

        const inputVal = parseFloat(inputValue) || 0;
        if (inputVal <= 0) return null;

        const chance = Math.min(bonuses.freeForgeChance, 0.999);

        // We first need the "Average Value per Hammer" to handle reverse calc
        // Let's simulate for 1 Hammer to get the rates
        let avgCoinsPerForge = 0;
        let avgItemsPerForge = 0; // chance * 1 = 1 if using direct multiplier? 
        // No, DropChanceData is "Items per Forge". Sum of values is usually 1.0 (100%), or close.
        // Let's verify sum.
        let maxAgeIdx = -1;

        Object.entries(forgeStats.dropChanceData).forEach(([key, val]) => {
            if (key.startsWith('Age') && typeof val === 'number' && val > 0) {
                const idx = parseInt(key.replace('Age', ''));
                if (idx > maxAgeIdx) maxAgeIdx = idx;
            }
        });

        // Calculate Average Yield per REAL Forge action
        Object.entries(forgeStats.dropChanceData).forEach(([key, val]) => {
            if (!key.startsWith('Age') || typeof val !== 'number' || val <= 0) return;
            const ageIdx = parseInt(key.replace('Age', ''));
            const isMaxAge = ageIdx === maxAgeIdx;
            const price = isMaxAge ? forgeStats.currentFinalPrice : forgeStats.maxCapFinalPrice;

            avgItemsPerForge += val;
            avgCoinsPerForge += (val * price);
        });

        // Effect of Free Forges on Cost
        // 1 Hammer = 1 / (1 - chance) Forges
        // Total Forges = Hammers * (1 / (1-chance))
        const forgesPerHammer = 1 / (1 - chance);

        let finalHammers = 0;
        let totalForges = 0;

        if (mode === 'hammers') {
            finalHammers = inputVal;
            totalForges = finalHammers * forgesPerHammer;
        } else {
            // Target Gold
            // TotalCoins = TotalForges * avgCoinsPerForge
            // TotalForges = TargetGold / avgCoinsPerForge
            // Hammers = TotalForges / forgesPerHammer
            if (avgCoinsPerForge > 0) {
                totalForges = inputVal / avgCoinsPerForge;
                finalHammers = totalForges / forgesPerHammer;
            }
        }

        const freeForges = totalForges - finalHammers;
        const totalCoins = totalForges * avgCoinsPerForge;
        const totalItems = totalForges * avgItemsPerForge;
        let totalWarPoints = 0;

        // Breakdown Construction
        const ages: { name: string, chance: number, items: number, coins: number, warPoints: number, isMax: boolean, idx: number }[] = [];

        const sortedAges = Object.entries(forgeStats.dropChanceData)
            .sort((a, b) => parseInt(a[0].replace('Age', '')) - parseInt(b[0].replace('Age', '')));

        sortedAges.forEach(([key, val]) => {
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            const chanceVal = val as number;
            if (!key.startsWith('Age') || typeof chanceVal !== 'number' || chanceVal <= 0) return;

            const ageIdx = parseInt(key.replace('Age', ''));
            const isMaxAge = ageIdx === maxAgeIdx;

            const itemsFound = totalForges * chanceVal;
            const pricePerItem = isMaxAge ? forgeStats.currentFinalPrice : forgeStats.maxCapFinalPrice;
            const coinsFound = itemsFound * pricePerItem;
            const warPointsFound = itemsFound * (warPointsPerAge[ageIdx] || 0);

            totalWarPoints += warPointsFound;

            // Map index to Name from Constants
            const ageName = AGES[ageIdx] || `Age ${ageIdx + 1}`;

            ages.push({
                name: ageName,
                chance: chanceVal,
                items: itemsFound,
                coins: coinsFound,
                warPoints: warPointsFound,
                isMax: isMaxAge,
                idx: ageIdx
            });
        });

        ages.reverse();

        return {
            finalHammers,
            totalForges,
            freeForges,
            totalCoins,
            totalItems,
            totalWarPoints,
            ages
        };
    }, [inputValue, mode, forgeStats, bonuses, warPointsPerAge]);

    const formatNumber = (num: number) => {
        if (num > 1000000000) return (num / 1000000000).toFixed(2) + 'B';
        if (num > 1000000) return (num / 1000000).toFixed(2) + 'M';
        if (num > 1000) return (num / 1000).toFixed(2) + 'k';
        return Math.floor(num).toLocaleString();
    };

    if (!dropChances) return <div className="p-10 text-center text-text-muted">Loading Configuration...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent mb-2 flex items-center gap-3">
                        <Calculator className="w-8 h-8 text-accent-primary" />
                        Forge Calculator
                    </h1>
                    <p className="text-text-secondary">
                        Plan your forging strategy. Switch modes to calculate costs or rewards.
                    </p>
                </div>
            </div>

            {/* Main Input Card */}
            <div className="card p-1 border-accent-primary/20 bg-gradient-to-b from-bg-secondary/50 to-bg-secondary/30 backdrop-blur-md overflow-hidden">
                {/* Mode Tabs */}
                <div className="flex border-b border-white/5 bg-black/20">
                    <button
                        onClick={() => setMode('hammers')}
                        className={cn(
                            "flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                            mode === 'hammers'
                                ? "bg-accent-primary/10 text-accent-primary border-b-2 border-accent-primary"
                                : "text-text-muted hover:text-white hover:bg-white/5"
                        )}
                    >
                        <img src="/Texture2D/Hammer.png" alt="Hammer" className="w-5 h-5 object-contain" />
                        I have Hammers
                    </button>
                    <button onClick={() => setMode((prev) => (prev === 'hammers' ? 'gold' : 'hammers'))} className="px-4 text-text-muted hover:text-white">
                        <ArrowRightLeft className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setMode('gold')}
                        className={cn(
                            "flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                            mode === 'gold'
                                ? "bg-yellow-500/10 text-yellow-500 border-b-2 border-yellow-500"
                                : "text-text-muted hover:text-white hover:bg-white/5"
                        )}
                    >
                        <img src="/Texture2D/CoinIcon.png" alt="Gold" className="w-5 h-5 object-contain" />
                        I want Gold
                    </button>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                    {/* Input Side */}
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-text-secondary flex items-center gap-2 uppercase tracking-wider">
                                {mode === 'hammers' ? 'Enter Hammer Count' : 'Enter Target Gold'}
                            </label>
                            <div className="relative group">
                                <input
                                    type="number"
                                    value={inputValue}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    className={cn(
                                        "w-full bg-black/40 border rounded-xl px-5 py-6 text-3xl font-black text-white focus:outline-none transition-all placeholder:text-white/10",
                                        mode === 'hammers' ? "border-accent-primary/30 focus:border-accent-primary" : "border-yellow-500/30 focus:border-yellow-500"
                                    )}
                                    placeholder="0"
                                    min="0"
                                />
                                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                                    {mode === 'hammers' ?
                                        <img src="/Texture2D/Hammer.png" alt="Hammer" className="w-8 h-8 object-contain" /> :
                                        <img src="/Texture2D/CoinIcon.png" alt="Gold" className="w-8 h-8 object-contain" />
                                    }
                                </div>
                            </div>
                        </div>

                        {/* Calculated Reverse Result (if Gold Mode) */}
                        {mode === 'gold' && results && (
                            <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-4 flex items-center justify-between">
                                <span className="text-sm font-bold text-accent-primary uppercase">Required Hammers</span>
                                <span className="text-2xl font-black text-white">{formatNumber(results.finalHammers)}</span>
                            </div>
                        )}
                    </div>

                    {/* Stats Side */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-orange-500/20">
                                    <img src="/Texture2D/Anvil.png" alt="Forge" className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                                </div>
                                <span className="font-medium text-text-secondary">Forge Level</span>
                            </div>
                            <span className="text-xl font-bold text-white">{profile.misc.forgeLevel}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-green-500/20">
                                    {/* ID: 2 is Sell Price. Sprite Index 3. */}
                                    <div style={getTechTreeIconStyle(3, 32)} />
                                </div>
                                <span className="font-medium text-text-secondary">Sell Bonus</span>
                            </div>
                            <span className="text-xl font-bold text-green-400">+{(bonuses.sellPriceBonus * 100).toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-blue-500/20">
                                    {/* ID: 6 is Free Forge. Sprite Index 32. */}
                                    <div style={getTechTreeIconStyle(32, 32)} />
                                </div>
                                <span className="font-medium text-text-secondary">Free Forges</span>
                            </div>
                            <span className="text-xl font-bold text-blue-400">+{(bonuses.freeForgeChance * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Results Grid */}
            {results && (
                <div className="space-y-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="card p-6 bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20 flex flex-col justify-between h-32 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-yellow-500/5 rounded-full blur-2xl group-hover:bg-yellow-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-yellow-500 uppercase tracking-wider mb-1">Total Gold Value</div>
                                <div className="text-2xl lg:text-3xl font-black text-white">{formatNumber(results.totalCoins)}</div>
                            </div>
                            <img src="/Texture2D/CoinIcon.png" alt="Gold" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-purple-500/10 to-transparent border-purple-500/20 flex flex-col justify-between h-32 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-purple-500 uppercase tracking-wider mb-1">Total Items Found</div>
                                <div className="text-2xl lg:text-3xl font-black text-white">{formatNumber(results.totalItems)}</div>
                            </div>
                            <GameIcon name="chest" className="text-purple-500/20 w-10 h-10 absolute right-4 bottom-4" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20 flex flex-col justify-between h-32 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-red-500 uppercase tracking-wider mb-1">Total War Points</div>
                                <div className="text-2xl lg:text-3xl font-black text-white">{formatNumber(results.totalWarPoints)}</div>
                            </div>
                            <img src="/Texture2D/TechTreePower.png" alt="War Points" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20 flex flex-col justify-between h-32 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-blue-500 uppercase tracking-wider mb-1">Total Actions</div>
                                <div className="text-2xl lg:text-3xl font-black text-white">{formatNumber(results.totalForges)}</div>
                                <div className="text-xs text-blue-300/60 mt-1">From {formatNumber(results.finalHammers)} Hammers</div>
                            </div>
                            <img src="/Texture2D/Hammer.png" alt="Hammer" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>
                    </div>

                    {/* Detailed Breakdown */}
                    <div className="card overflow-hidden">
                        <div className="p-4 bg-black/40 border-b border-white/5 font-bold flex items-center gap-2">
                            <div className="w-1 h-4 bg-accent-primary rounded-full" />
                            Age Breakdown
                        </div>
                        <div className="divide-y divide-white/5">
                            {results.ages.map((age) => (
                                <div key={age.name} className={cn(
                                    "p-4 flex flex-col md:flex-row items-center gap-4 transition-colors",
                                    age.isMax ? "bg-accent-primary/5 hover:bg-accent-primary/10" : "hover:bg-white/5"
                                )}>
                                    <div className="flex-1 w-full flex items-center gap-4">
                                        <div className="shrink-0 p-1 bg-white/5 rounded-lg border border-white/10" style={getAgeIconStyle(age.idx, 48)} />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-lg text-white">{age.name}</span>
                                                {age.isMax && <span className="text-[10px] bg-accent-primary text-black px-1.5 py-0.5 rounded font-bold uppercase">Max Unlocked</span>}
                                            </div>
                                            <div className="text-xs text-text-muted">Chance: {(age.chance * 100).toFixed(2)}%</div>
                                        </div>
                                    </div>

                                    <div className="flex-1 w-full grid grid-cols-3 gap-4">
                                        <div className="bg-bg-primary/30 p-2 rounded-lg text-center md:text-right">
                                            <div className="text-[10px] uppercase text-text-muted font-bold mb-1">Items</div>
                                            <div className="text-white font-mono font-bold">{formatNumber(age.items)}</div>
                                        </div>
                                        <div className="bg-bg-primary/30 p-2 rounded-lg text-center md:text-right">
                                            <div className="text-[10px] uppercase text-text-muted font-bold mb-1">Gold Value</div>
                                            <div className="text-yellow-400 font-mono font-bold">{formatNumber(age.coins)}</div>
                                        </div>
                                        <div className="bg-bg-primary/30 p-2 rounded-lg text-center md:text-right">
                                            <div className="text-[10px] uppercase text-text-muted font-bold mb-1">War Points</div>
                                            <div className="text-red-400 font-mono font-bold">{formatNumber(age.warPoints)}</div>
                                        </div>
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
