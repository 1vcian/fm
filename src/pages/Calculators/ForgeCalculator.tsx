import { useState, useMemo, useEffect, useRef } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useTreeMode } from '../../context/TreeModeContext';
import { useGameData } from '../../hooks/useGameData';
import { GameIcon } from '../../components/UI/GameIcon';
import { ArrowRightLeft } from 'lucide-react';
import { cn, getAgeIconStyle } from '../../lib/utils';
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
        backgroundImage: `url(./Texture2D/TechTreeIcons.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetSize * scale}px ${sheetSize * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
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

    // New Toggle State
    const [usePlayerItems, setUsePlayerItems] = useState<boolean>(() => {
        return profile.misc.forgeCalculator?.usePlayerItems ?? true;
    });

    // Manual Bonuses State (overrides user tech tree)
    const [manualBonuses, setManualBonuses] = useState<Record<string, number>>({});

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
                    mode: mode,
                    usePlayerItems: usePlayerItems
                }
            });
        }, 1000); // 1s debounce

        return () => {
            if (saveTimeout.current) clearTimeout(saveTimeout.current);
        };
    }, [hammersInput, goldInput, mode, usePlayerItems, updateNestedProfile]);

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
                    const ageIdx = AGES.findIndex(a => a.replace('-', '') === ageName || a === ageName);

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

    // 1b. Calculate Global Maximums from Library (The theoretical limits of the game)
    const { globalMaxBonuses, nodeIcons, nodeSteps } = useMemo(() => {
        const limits: Record<string, number> = {};
        const icons: Record<string, any> = {};
        const steps: Record<string, number> = {};
        if (!techTreeLib || !techTreeMap) return { globalMaxBonuses: limits, nodeIcons: icons, nodeSteps: steps };

        // Iterate through all trees in Mapping to find ALL instances of nodes
        ['Forge', 'Power', 'SkillsPetTech'].forEach((treeName) => {
            const treeRoot = techTreeMap?.trees?.[treeName];
            if (!treeRoot || !Array.isArray(treeRoot.nodes)) return;

            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            treeRoot.nodes.forEach((nodeMap: any) => {
                const nodeDef = techTreeLib[nodeMap.type];
                if (!nodeDef) return;

                if (!nodeDef.Stats || !nodeDef.Stats[0]) return;
                const stat = nodeDef.Stats[0];

                // Max possible value for this node instance
                const maxVal = stat.Value + ((nodeDef.MaxLevel || 1) - 1) * stat.ValueIncrease;

                let key = '';
                if (nodeDef.Type === 'EquipmentSellPrice') key = 'SellPrice';
                else if (nodeDef.Type === 'FreeForgeChance') key = 'FreeForgeChance';
                else if (nodeDef.Type.endsWith('LevelUp')) key = nodeDef.Type.replace('LevelUp', '');

                if (key) {
                    limits[key] = (limits[key] || 0) + maxVal;

                    // Capture icon and step from the first node mapping found for this type
                    if (!icons[key] && nodeMap.sprite_rect) {
                        icons[key] = nodeMap.sprite_rect;
                    }
                    if (!steps[key]) {
                        // Increment for the value of a single node (ValueIncrease if multi-level, otherwise base Value)
                        steps[key] = stat.ValueIncrease || stat.Value || 1;
                    }
                }
            });
        });
        return { globalMaxBonuses: limits, nodeIcons: icons, nodeSteps: steps };
    }, [techTreeLib, techTreeMap]);

    // Icon Style Helper
    const getVirtualNodeIconStyle = (key: string, size: number = 32) => {
        const rect = nodeIcons[key];
        if (!rect || !techTreeMap?.texture_size) {
            // Fallback if no rect found (shouldn't happen if map is good)
            return getTechTreeIconStyle(0, size);
        }

        const { x, y, width, height } = rect;
        const sheetW = techTreeMap.texture_size.width;
        const sheetH = techTreeMap.texture_size.height;

        const scale = size / width;
        // Unity Y is bottom-left, CSS is top-left
        const cssY = sheetH - y - height;

        return {
            backgroundImage: `url(./Texture2D/TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: `${size}px`,
            height: `${size}px`,
            display: 'inline-block',
            imageRendering: 'pixelated' as const
        };
    };

    // 1. Calculate Player Bonuses from Tree (Actual Profile)
    const bonuses = useMemo(() => {
        let sellPriceBonus = 0;
        let freeForgeChance = 0;

        // Track per-slot bonuses 
        const slotLevelBonuses: Record<string, number> = {};

        if (!techTreeLib || !techTreeMap) return { sellPriceBonus, freeForgeChance, averageLevelBonus: 0, latentLevelBonus: 0, actualMaxItemLevel: 0, slotLimits: {}, slotBonuses: {} };

        // Iterate through all trees in Mapping to find relevant nodes
        ['Forge', 'Power', 'SkillsPetTech'].forEach((treeName) => {
            const treeRoot = techTreeMap.trees?.[treeName];
            if (!treeRoot || !Array.isArray(treeRoot.nodes)) return;

            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            treeRoot.nodes.forEach((nodeMap: any) => {
                const nodeDef = techTreeLib[nodeMap.type];
                if (!nodeDef) return;

                let level = 0;
                if (treeMode === 'empty') {
                    level = 0;
                } else if (treeMode === 'max') {
                    level = nodeDef.MaxLevel || 0;
                } else {
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
                    default:
                        if (nodeDef.Type.endsWith('LevelUp')) {
                            // "WeaponLevelUp" -> "Weapon"
                            const slot = nodeDef.Type.replace('LevelUp', '');
                            slotLevelBonuses[slot] = (slotLevelBonuses[slot] || 0) + nodeVal;
                        }
                        break;
                }
            });
        });

        // Sum all slot bonuses and divide by 8 (Total Slots)
        const totalBonus = Object.values(slotLevelBonuses).reduce((sum, val) => sum + val, 0);
        const averageLevelBonus = totalBonus / 8;

        // Calculate Limits per slot (for display purposes)
        const base = (balancingConfig?.ItemBaseMaxLevel || 98) + 1;
        const slotLimits: Record<string, number> = {};
        const allSlots = ['Weapon', 'Helmet', 'Body', 'Glove', 'Ring', 'Necklace', 'Belt', 'Shoe'];

        allSlots.forEach(slot => {
            const bonus = slotLevelBonuses[slot] || 0;
            slotLimits[slot] = base + bonus;
        });

        // Capture actual inventory strength to find "latent" Forge/Research levels
        let actualMaxItemLevel = 0;
        Object.values(profile.items).forEach(item => {
            if (item && item.level > actualMaxItemLevel) {
                actualMaxItemLevel = item.level;
            }
        });

        // The "Latent Bonus" is the difference between your equipment levels and your tech tree potential.
        // This accounts for Forge Level, Research, and other hidden scaling factors.
        const techPotential = base + averageLevelBonus;
        const latentLevelBonus = actualMaxItemLevel > 0 ? Math.max(0, actualMaxItemLevel - techPotential) : 0;

        return {
            sellPriceBonus,
            freeForgeChance,
            averageLevelBonus,
            latentLevelBonus,
            actualMaxItemLevel,
            slotLimits,
            slotBonuses: slotLevelBonuses
        };
    }, [profile, treeMode, techTreeLib, techTreeMap, balancingConfig]);

    // Sync manual bonuses when toggling off Player Items
    useEffect(() => {
        if (!usePlayerItems && bonuses && Object.keys(manualBonuses).length === 0) {
            // Initialize with current user bonuses
            const init: Record<string, number> = {
                SellPrice: bonuses.sellPriceBonus,
                FreeForgeChance: bonuses.freeForgeChance,
                ...bonuses.slotBonuses
            };
            setManualBonuses(init);
        }
    }, [usePlayerItems, bonuses, manualBonuses]);

    // 2. Calculate Effective Forge Stats
    const forgeStats = useMemo(() => {
        if (!brackets || !dropChances || !profile || !balancingConfig) return null;

        const currentForgeLevel = profile.misc.forgeLevel || 1;
        let referenceLevel = 0;
        let referenceSource = "Unknown";

        // Effective Bonuses (Manual or Actual)
        const isManual = !usePlayerItems && Object.keys(manualBonuses).length > 0;
        const effectiveSellPriceBonus = isManual ? (manualBonuses['SellPrice'] ?? bonuses.sellPriceBonus) : bonuses.sellPriceBonus;

        // Calculate Effective Max Level (Avg)
        // This is the "Reference level" used to determine which Forge Age isDropped and its base price.
        const base = (balancingConfig.ItemBaseMaxLevel || 98) + 1;

        if (usePlayerItems) {
            // Priority 1: Actual items in inventory (captures enhancement + tech + latent)
            Object.values(profile.items).forEach(item => {
                if (item && item.level > referenceLevel) {
                    referenceLevel = item.level;
                    referenceSource = "Inventory Items";
                }
            });
            // Fallback if no items: Use Tech + Latent
            if (referenceLevel === 0) {
                referenceLevel = base + bonuses.averageLevelBonus + (bonuses.latentLevelBonus || 0);
                referenceSource = "Tech Tree + Latent";
            }
        } else {
            // Simulation Mode: Base + Simulated Tech + Latent Forge contribution
            let totalSimulatedStats = 0;
            const slots = ['Weapon', 'Helmet', 'Body', 'Glove', 'Ring', 'Necklace', 'Belt', 'Shoe'];
            const profileSlotBonuses = (bonuses.slotBonuses || {}) as Record<string, number>;

            slots.forEach(slot => {
                const val = manualBonuses[slot] ?? profileSlotBonuses[slot] ?? 0;
                totalSimulatedStats += val;
            });

            const avgSimulatedBonus = totalSimulatedStats / 8;
            referenceLevel = base + avgSimulatedBonus + (bonuses.latentLevelBonus || 0);
            referenceSource = "Simulated Tech Tree";
        }

        // Find brackets
        // 1. Current Age Bracket (based on Reference Level)
        const sortedKeys = Object.keys(brackets).sort((a, b) => Number(a) - Number(b));
        let currentBracket = brackets[sortedKeys[0]];

        // Find the bracket that contains the reference level
        // Use loop to find:
        for (const key of sortedKeys) {
            const b = brackets[key];
            if (referenceLevel >= b.LowerRange && referenceLevel <= b.UpperRange) {
                currentBracket = b;
                break;
            }
        }
        // If Ref Level > Highest Bracket Max, use highest bracket (or extrapolate?)
        // Currently we clamp to the highest known bracket for "Bracket" display info, 
        // but Price Calculation uses exponential formula so it scales indefinitely.

        const dropChanceData = dropChances[currentForgeLevel.toString()];

        return {
            dropChanceData,
            forgeLevel: currentForgeLevel,
            referenceLevel,
            referenceSource,
            effectiveSellPriceBonus,
            currentBracket
        };

    }, [profile, brackets, balancingConfig, dropChances, bonuses, usePlayerItems, manualBonuses]);


    // 3. Perform Final Calculation (Bidirectional)
    const results = useMemo(() => {
        if (!forgeStats || !forgeStats.dropChanceData || !balancingConfig) return null;

        const inputVal = parseFloat(inputValue) || 0;
        if (inputVal <= 0) return null;

        const bracketMin = forgeStats.currentBracket?.LowerRange || 0;
        const bracketMax = forgeStats.currentBracket?.UpperRange || 0;
        const refLevel = forgeStats.referenceLevel;

        const diffMin = bracketMin - refLevel;
        const diffMax = bracketMax - refLevel;

        const freeForgeBase = (!usePlayerItems && manualBonuses['FreeForgeChance'] !== undefined)
            ? manualBonuses['FreeForgeChance']
            : bonuses.freeForgeChance;
        const chance = Math.min(freeForgeBase || 0, 0.999);
        const forgesPerHammer = 1 / (1 - chance);

        let avgCoinsPerForge = 0;
        let avgItemsPerForge = 0;

        // Identify the highest age index dropped at this forge level
        let maxAgeIdx = -1;
        Object.entries(forgeStats.dropChanceData).forEach(([key, val]) => {
            if (key.startsWith('Age') && typeof val === 'number' && val > 0) {
                const idx = parseInt(key.replace('Age', ''));
                if (idx > maxAgeIdx) maxAgeIdx = idx;
            }
        });

        // Calculate Average Stats per Forge
        Object.entries(forgeStats.dropChanceData).forEach(([key, val]) => {
            const chanceVal = val as number;
            if (!key.startsWith('Age') || typeof chanceVal !== 'number' || chanceVal <= 0) return;
            // const ageIdx = parseInt(key.replace('Age', '')); // Removed

            // Granular Price Calculation for this specific age
            // Formula: The highest age corresponds to referenceLevel. 
            // We removed the 'Age Offset' logic (-5 levels per tier) as per user request/verification.
            // Items from previous ages now drop at full Slot Level.
            // const ageOffset = maxAgeIdx - ageIdx;

            let ageTotalCoins = 0;
            const slots = ['Weapon', 'Helmet', 'Body', 'Glove', 'Ring', 'Necklace', 'Belt', 'Shoe'];
            const profileSlotBonuses = (bonuses.slotBonuses || {}) as Record<string, number>;

            slots.forEach(slot => {
                // Determine level for this specific slot
                let slotTechBonus = 0;
                if (!usePlayerItems && manualBonuses[slot] !== undefined) {
                    slotTechBonus = manualBonuses[slot];
                } else {
                    slotTechBonus = profileSlotBonuses[slot] || 0;
                }

                // Base Level + Slot Tech + Latent Bonus
                // Note: Latent Bonus is global (Forge Level), Slot Tech is specific.
                const slotLevel = balancingConfig.ItemBaseMaxLevel + slotTechBonus + (bonuses.latentLevelBonus || 0);

                const baseScaling = 1.0100000000093132;
                const basePrice = balancingConfig.SellBasePrice * Math.pow(baseScaling, slotLevel);
                ageTotalCoins += basePrice;
            });

            const avgPriceForAge = ageTotalCoins / 8;
            const finalPrice = avgPriceForAge * (1 + forgeStats.effectiveSellPriceBonus);

            avgItemsPerForge += chanceVal;
            avgCoinsPerForge += (chanceVal * finalPrice);
        });

        let finalHammers = 0;
        let totalForges = 0;

        if (mode === 'hammers') {
            finalHammers = inputVal;
            totalForges = finalHammers * forgesPerHammer;
        } else {
            if (avgCoinsPerForge > 0) {
                totalForges = inputVal / avgCoinsPerForge;
                finalHammers = totalForges / forgesPerHammer;
            }
        }

        const freeForges = totalForges - finalHammers;
        const totalCoins = totalForges * avgCoinsPerForge;

        // Accurate Total Min/Max
        // We need to sum up (TotalForges * Chance * PriceMin) for all ages.
        // Re-iterating is safer or we can accumulate above.
        // Let's accumulate above.
        // Actually, let's just do it here properly to avoid mess.
        let totalCoinsMin = 0;
        let totalCoinsMax = 0;

        Object.entries(forgeStats.dropChanceData).forEach(([key, val]) => {
            const chanceVal = val as number;
            if (!key.startsWith('Age') || typeof chanceVal !== 'number' || chanceVal <= 0) return;
            const ageIdx = parseInt(key.replace('Age', ''));
            // const ageOffset = maxAgeIdx - ageIdx; // Removed

            let ageTotalCoinsMin = 0;
            let ageTotalCoinsMax = 0;

            const slots = ['Weapon', 'Helmet', 'Body', 'Glove', 'Ring', 'Necklace', 'Belt', 'Shoe'];
            const profileSlotBonuses = (bonuses.slotBonuses || {}) as Record<string, number>;

            slots.forEach(slot => {
                let slotTechBonus = 0;
                if (!usePlayerItems && manualBonuses[slot] !== undefined) {
                    slotTechBonus = manualBonuses[slot];
                } else {
                    slotTechBonus = profileSlotBonuses[slot] || 0;
                }
                const baseLevel = balancingConfig.ItemBaseMaxLevel + slotTechBonus + (bonuses.latentLevelBonus || 0);
                const baseScaling = 1.0100000000093132;

                ageTotalCoinsMin += balancingConfig.SellBasePrice * Math.pow(baseScaling, baseLevel + diffMin);
                ageTotalCoinsMax += balancingConfig.SellBasePrice * Math.pow(baseScaling, baseLevel + diffMax);
            });

            const priceMin = (ageTotalCoinsMin / 8) * (1 + forgeStats.effectiveSellPriceBonus);
            const priceMax = (ageTotalCoinsMax / 8) * (1 + forgeStats.effectiveSellPriceBonus);

            totalCoinsMin += (totalForges * chanceVal * priceMin);
            totalCoinsMax += (totalForges * chanceVal * priceMax);
        });

        const totalItems = totalForges * avgItemsPerForge;
        let totalWarPoints = 0;

        const ages: { name: string, chance: number, items: number, coins: number, warPoints: number, isMax: boolean, idx: number }[] = [];
        const sortedAges = Object.entries(forgeStats.dropChanceData)
            .sort((a, b) => parseInt(a[0].replace('Age', '')) - parseInt(b[0].replace('Age', '')));

        sortedAges.forEach(([key, val]) => {
            const chanceVal = val as number;
            if (!key.startsWith('Age') || typeof chanceVal !== 'number' || chanceVal <= 0) return;

            const ageIdx = parseInt(key.replace('Age', ''));
            const itemsFound = totalForges * chanceVal;

            // Use the same slot-specific logic for per-age breakdown
            // const ageOffset = maxAgeIdx - ageIdx; // Removed offset logic

            let ageTotalCoins = 0;
            const slots = ['Weapon', 'Helmet', 'Body', 'Glove', 'Ring', 'Necklace', 'Belt', 'Shoe'];
            const profileSlotBonuses = (bonuses.slotBonuses || {}) as Record<string, number>;

            slots.forEach(slot => {
                let slotTechBonus = 0;
                if (!usePlayerItems && manualBonuses[slot] !== undefined) {
                    slotTechBonus = manualBonuses[slot];
                } else {
                    slotTechBonus = profileSlotBonuses[slot] || 0;
                }

                const slotLevel = (balancingConfig.ItemBaseMaxLevel + 1) + slotTechBonus + (bonuses.latentLevelBonus || 0);
                const baseScaling = 1.0100000000093132;
                const basePrice = balancingConfig.SellBasePrice * Math.pow(baseScaling, slotLevel);
                ageTotalCoins += basePrice;
            });

            const avgPriceForAge = ageTotalCoins / 8;
            const pricePerItem = avgPriceForAge * (1 + forgeStats.effectiveSellPriceBonus);

            const coinsFound = itemsFound * pricePerItem;
            const warPointsFound = itemsFound * (warPointsPerAge[ageIdx] || 0);

            totalWarPoints += warPointsFound;

            // Map index to Name from Constants
            const ageName = AGES[ageIdx] || `Age ${ageIdx + 1}`;

            ages.push({
                idx: ageIdx,
                name: ageName,
                chance: chanceVal * 100,
                items: itemsFound,
                coins: coinsFound,
                warPoints: warPointsFound,
                isMax: ageIdx === maxAgeIdx
            });
        });
        ages.reverse();

        return { finalHammers, totalForges, freeForges, totalCoins, totalCoinsMin, totalCoinsMax, totalItems, totalWarPoints, ages };
    }, [inputValue, mode, forgeStats, bonuses, warPointsPerAge, brackets, balancingConfig, usePlayerItems, manualBonuses]);

    /* getSlotIconIndex removed */

    // Render Virtual Node Grid
    const renderVirtualNodes = () => {
        if (usePlayerItems) return null;

        const nodes = [
            { key: 'SellPrice', label: 'Sell Price', format: (v: number) => `+${(v * 100).toFixed(0)}%` },
            { key: 'FreeForgeChance', label: 'Free Forge', format: (v: number) => `${(v * 100).toFixed(1)}%` },
            { key: 'Weapon', label: 'Weapon Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Helmet', label: 'Helmet Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Body', label: 'Body Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Glove', label: 'Gloves Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Belt', label: 'Belt Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Necklace', label: 'Necklace Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Ring', label: 'Ring Lv.', format: (v: number) => `+${v.toFixed(0)}` },
            { key: 'Shoe', label: 'Shoes Lv.', format: (v: number) => `+${v.toFixed(0)}` },
        ];

        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="col-span-full flex items-center justify-between text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                    <span>Simulated Tech Tree Bonuses</span>
                    <button
                        onClick={() => {
                            const init: Record<string, number> = {
                                SellPrice: bonuses.sellPriceBonus,
                                FreeForgeChance: bonuses.freeForgeChance,
                                ...((bonuses.slotBonuses || {}) as Record<string, number>)
                            };
                            setManualBonuses(init);
                        }}
                        className="text-xs text-text-muted hover:text-white underline"
                    >
                        Reset to My Tree
                    </button>
                </div>
                {nodes.map(n => {
                    const currentVal = manualBonuses[n.key] ?? (
                        n.key === 'SellPrice' ? bonuses.sellPriceBonus :
                            n.key === 'FreeForgeChance' ? bonuses.freeForgeChance :
                                ((bonuses.slotBonuses || {}) as Record<string, number>)[n.key]
                    ) ?? 0;

                    const maxVal = globalMaxBonuses[n.key] || 100;
                    const step = nodeSteps[n.key] || 1;

                    const updateVal = (direction: 1 | -1) => {
                        const newVal = currentVal + (step * direction);
                        // Clamp logic
                        let clamped = Math.max(0, Math.min(newVal, maxVal));
                        // Round for floating point errors
                        if (step % 1 === 0) clamped = Math.round(clamped);
                        else clamped = parseFloat(clamped.toFixed(4));

                        setManualBonuses(prev => ({ ...prev, [n.key]: clamped }));
                    };

                    return (
                        <div key={n.key} className="bg-black/40 border border-white/10 rounded-xl p-3 flex flex-col items-center gap-3 group hover:border-accent-primary/50 transition-colors relative overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center gap-2 w-full">
                                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center shrink-0 border border-white/5 overflow-hidden">
                                    <div style={getVirtualNodeIconStyle(n.key, 24)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-text-muted uppercase leading-tight">{n.label}</div>
                                    <div className="text-sm font-bold text-white">{n.format(currentVal)}</div>
                                </div>
                            </div>

                            {/* Controls: [-] Value [+] */}
                            <div className="flex items-center justify-between w-full bg-white/5 rounded-lg p-1 border border-white/5">
                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/20 rounded text-white disabled:opacity-30 transition-colors"
                                    onClick={() => updateVal(-1)}
                                    disabled={currentVal <= 0}
                                >
                                    <span className="text-xs font-bold">-</span>
                                </button>

                                <div className="text-xs font-mono font-bold text-text-secondary text-center">
                                    {(n.key === 'SellPrice' || n.key === 'FreeForgeChance') ? (currentVal * 100).toFixed(0) : currentVal.toFixed(0)} <span className="opacity-50 text-[9px]">/ {(n.key === 'SellPrice' || n.key === 'FreeForgeChance') ? (maxVal * 100).toFixed(0) : maxVal.toFixed(0)}</span>
                                </div>

                                <button
                                    className="w-6 h-6 flex items-center justify-center bg-white/5 hover:bg-white/20 rounded text-white disabled:opacity-30 transition-colors"
                                    onClick={() => updateVal(1)}
                                    disabled={currentVal >= maxVal}
                                >
                                    <span className="text-xs font-bold">+</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const formatNumber = (num: number) => {
        if (num > 1000000000) return (num / 1000000000).toFixed(2) + 'B';
        if (num > 1000000) return (num / 1000000).toFixed(2) + 'M';
        if (num > 1000) return (num / 1000).toFixed(2) + 'k';
        return Math.floor(num).toLocaleString();
    };

    const renderPriceWithPrecision = (val: number) => (
        <div className="flex flex-col">
            <div className="text-2xl lg:text-3xl font-black text-white">{formatNumber(val)}</div>
            <div className="text-xs text-white/50 font-mono">({val.toLocaleString(undefined, { maximumFractionDigits: 0 })})</div>
        </div>
    );

    // Helper for Range Display
    const renderPriceRange = (min: number, max: number) => (
        <div className="flex flex-col">
            <div className="text-xl lg:text-2xl font-black text-white flex items-center gap-1">
                <span>{formatNumber(min)}</span>
                <span className="text-white/50">-</span>
                <span>{formatNumber(max)}</span>
            </div>
            <div className="text-[10px] text-white/50 font-mono">
                {formatNumber((min + max) / 2)} (Avg)
            </div>
        </div>
    );

    if (!dropChances || !techTreeLib || !techTreeMap || !balancingConfig || !brackets) return <div className="p-10 text-center text-text-muted">Loading Configuration...</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent mb-2 flex items-center gap-3">
                        <img src="./Texture2D/Anvil.png" alt="Forge" className="w-10 h-10 object-contain" />
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
                        <img src="./Texture2D/Hammer.png" alt="Hammer" className="w-5 h-5 object-contain" />
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
                        <img src="./Texture2D/CoinIcon.png" alt="Gold" className="w-5 h-5 object-contain" />
                        I want Gold
                    </button>
                </div>

                <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                    {/* Input Side */}
                    <div className="space-y-6">
                        <div className="space-y-4">
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
                                        <img src="./Texture2D/Hammer.png" alt="Hammer" className="w-8 h-8 object-contain" /> :
                                        <img src="./Texture2D/CoinIcon.png" alt="Gold" className="w-8 h-8 object-contain" />
                                    }
                                </div>
                            </div>

                            {/* Calculation Toggle */}
                            <div className="flex flex-col gap-3">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={usePlayerItems}
                                            onChange={(e) => setUsePlayerItems(e.target.checked)}
                                        />
                                        <div className="w-10 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-primary"></div>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm text-text-muted group-hover:text-white transition-colors select-none">
                                            Use Player Items
                                        </span>
                                        {!usePlayerItems && <span className="text-[10px] text-accent-primary">Simulating Custom Tech Tree</span>}
                                    </div>
                                </label>

                                {/* Info Box about Level */}
                                {forgeStats && (
                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-text-secondary space-y-1">
                                        <div className="flex justify-between items-center">
                                            <span>Reference Level Used:</span>
                                            <span className="font-bold text-white">{Math.floor(forgeStats.referenceLevel)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-text-muted">
                                            <span>Source:</span>
                                            <span className="italic">{forgeStats.referenceSource}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-text-muted">
                                            <span>Values Bracket:</span>
                                            <span className="italic">{forgeStats.currentBracket ? `Level ${forgeStats.currentBracket.LowerRange}-${forgeStats.currentBracket.UpperRange}` : 'Unknown'}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Render Virtual Nodes (if !usePlayerItems) */}
                            {renderVirtualNodes()}

                        </div>

                        {/* Calculated Reverse Result (if Gold Mode) */}
                        {mode === 'gold' && results && (
                            <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-4 flex items-center justify-between">
                                <span className="text-sm font-bold text-accent-primary uppercase">Required Hammers</span>
                                <div className="text-right">
                                    <span className="text-2xl font-black text-white block">{formatNumber(results.finalHammers)}</span>
                                    <span className="text-xs text-white/50 block">({Math.floor(results.finalHammers).toLocaleString()})</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Stats Side */}
                    <div className="space-y-4">
                        {/* Forge Stats */}
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-orange-500/20">
                                    <img src="./Texture2D/Anvil.png" alt="Forge" className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                                </div>
                                <span className="font-medium text-text-secondary">Forge Level</span>
                            </div>
                            <span className="text-xl font-bold text-white">{profile.misc.forgeLevel}</span>
                        </div>
                        {/* Sell Price */}
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-green-500/20">
                                    <div style={getTechTreeIconStyle(3, 32)} />
                                </div>
                                <span className="font-medium text-text-secondary">Sell Bonus</span>
                            </div>
                            <span className="text-xl font-bold text-green-400">+{((forgeStats?.effectiveSellPriceBonus || 0) * 100).toFixed(1)}%</span>
                        </div>
                        {/* Free Forges */}
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-blue-500/20">
                                    <div style={getTechTreeIconStyle(32, 32)} />
                                </div>
                                <span className="font-medium text-text-secondary">Free Forges</span>
                            </div>
                            <span className="text-xl font-bold text-blue-400">
                                +{((!usePlayerItems && manualBonuses['FreeForgeChance'] !== undefined) ? (manualBonuses['FreeForgeChance'] * 100) : (bonuses.freeForgeChance * 100)).toFixed(1)}%
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Results Grid */}
            {results && (
                <div className="space-y-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="card p-6 bg-gradient-to-br from-yellow-500/10 to-transparent border-yellow-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-yellow-500/5 rounded-full blur-2xl group-hover:bg-yellow-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-yellow-500 uppercase tracking-wider mb-1">Total Gold Value</div>
                                {/* Show Range instead of Single Value */}
                                {renderPriceRange(results.totalCoinsMin, results.totalCoinsMax)}
                            </div>
                            <img src="./Texture2D/CoinIcon.png" alt="Gold" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-purple-500/10 to-transparent border-purple-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-purple-500 uppercase tracking-wider mb-1">Total Items Found</div>
                                {renderPriceWithPrecision(results.totalItems)}
                            </div>
                            <GameIcon name="chest" className="text-purple-500/20 w-10 h-10 absolute right-4 bottom-4" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-red-500 uppercase tracking-wider mb-1">Total War Points</div>
                                {renderPriceWithPrecision(results.totalWarPoints)}
                            </div>
                            <img src="./Texture2D/TechTreePower.png" alt="War Points" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-blue-500 uppercase tracking-wider mb-1">Total Actions</div>
                                {renderPriceWithPrecision(results.totalForges)}
                                <div className="text-xs text-blue-300/60 mt-1 flex gap-1">
                                    <span>From {formatNumber(results.finalHammers)}</span>
                                    <span className="opacity-50">({Math.floor(results.finalHammers).toLocaleString()})</span>
                                    <span>Hammers</span>
                                </div>
                                <div className="text-xs text-blue-300 mb-1">
                                    <span className="font-bold">+{formatNumber(results.freeForges)}</span>
                                    <span className="opacity-70"> Free Forges ({Math.floor(results.freeForges).toLocaleString()})</span>
                                </div>
                            </div>
                            <img src="./Texture2D/Hammer.png" alt="Hammer" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
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
                                            <div className="text-xs text-text-muted">
                                                {age.chance > 100
                                                    ? `Yield: x${(age.chance / 100).toFixed(2)}`
                                                    : `Chance: ${age.chance.toFixed(2)}%`
                                                }
                                            </div>
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

            {/* Background Decoration */}
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <img src="./Texture2D/Anvil.png" alt="" className="w-64 h-64 object-contain grayscale" />
            </div>
        </div>
    );
}
