import { useState, useMemo, useEffect, useRef } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { useTreeLimits } from '../../hooks/useTreeLimits';
import { forgeLevelCost } from '../../hooks/useForgeCalculator';
import { SandboxPanel } from '../../components/UI/SandboxPanel';
import { ArrowRightLeft } from 'lucide-react';
import { GameAssetIcon } from '../../components/UI/GameAssetIcon';
import { isWarPointDay, getDayBoostNodeType, getWarPointsForTask } from '../../utils/guildWarUtils';
import { AgeBackground } from '../../components/AgeBackground/AgeBackground';
import { cn, getAgeIconStyle } from '../../lib/utils';
import { AGES } from '../../utils/constants';
import { useGameDataContext } from '../../context/GameDataContext';
import { ITEM_TYPE_NAMES, computeForgeModel, hammersForCoins, sortBrackets, type ForgeModelInput, type ForgeSlot } from '../../utils/forgeItemLevels';

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

interface ItemBalancingEntry {
    ItemId: { Age: number; Type: string; Idx: number };
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
            Target?: {
                Kind?: string;
                Qualifiers?: { Type: string; Value: number }[];
            };
            StatTarget?: {
                ItemType?: number;
                $type?: string;
            };
        };
        Value: number;
        ValueIncrease: number;
    }[];
}

/**
 * Which forge input a tech node feeds, from its stat node (config driven):
 * SellPrice on Equipment (GetSellValue), FreebieChance on Forge (free forge roll) and
 * MaxLevel on Equipment with an ItemType qualifier (RollItemLevel). Older builds carry a
 * StatTarget object instead of Target, handled as a fallback.
 */
function classifyForgeNode(def: TechTreeNode | undefined): { key: string; itemType?: number } | null {
    const node = def?.Stats?.[0]?.StatNode;
    if (!def || !node) return null;
    const statType = node.UniqueStat?.StatType;
    const kind = node.Target?.Kind
        ?? (node.StatTarget?.$type ? node.StatTarget.$type.replace('StatTarget', '') : undefined);
    if (statType === 'SellPrice' && kind === 'Equipment') return { key: 'SellPrice' };
    if (statType === 'FreebieChance' && kind === 'Forge') return { key: 'FreeForgeChance' };
    if (statType === 'MaxLevel' && (kind === 'Equipment' || kind === 'Weapon')) {
        const q = node.Target?.Qualifiers?.find(x => x.Type === 'ItemType');
        const itemType = q?.Value ?? node.StatTarget?.ItemType
            ?? (kind === 'Weapon' ? ITEM_TYPE_NAMES.indexOf('Weapon') : undefined);
        if (itemType === undefined) return null;
        return { key: def.Type.replace(/LevelUp$/, ''), itemType };
    }
    return null;
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
function getTechTreeIconStyle(spriteIndex: number, size: number = 32, version?: string): React.CSSProperties {
    // 8x8 grid based on TechTreeIcons.png size 1024x1024 and sprite size 128
    const cols = 8;
    const col = spriteIndex % cols;
    const row = Math.floor(spriteIndex / cols);
    const spriteSize = 128;
    const sheetSize = 1024;
    const scale = size / spriteSize;
    // Plain helper, not a hook: the caller passes the version (calling useGameDataContext here broke
    // the Rules of Hooks, since the call count changed once the configs finished loading).
    const versionPath = version || '';
    return {
        backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}/TechTreeIcons.png)`,
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
    const { selectedVersion } = useGameDataContext();
    const { profile, updateNestedProfile } = useProfile();

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

    // Simulation Forge Level (Defaults to Profile Level, not persisted)
    const [simulatedForgeLevel, setSimulatedForgeLevel] = useState(profile.misc.forgeLevel || 1);

    const [hammersInput, setHammersInput] = useState<string>(() => profile.misc.forgeCalculator?.hammers || '0');
    const [goldInput, setGoldInput] = useState<string>(() => profile.misc.forgeCalculator?.targetGold || '0');

    const [autoForgeSummons, setAutoForgeSummons] = useState<number>(() => {
        return profile.misc.forgeCalculator?.autoForgeSummons || 5;
    });

    const [autoForgeInterval, setAutoForgeInterval] = useState<string>(() => {
        return (profile.misc.forgeCalculator?.autoForgeInterval || 2.43).toString();
    });

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
                    usePlayerItems: usePlayerItems,
                    autoForgeSummons: autoForgeSummons,
                    autoForgeInterval: parseFloat(autoForgeInterval) || 2.43
                }
            });
        }, 1000); // 1s debounce

        return () => {
            if (saveTimeout.current) clearTimeout(saveTimeout.current);
        };
    }, [hammersInput, goldInput, mode, usePlayerItems, autoForgeSummons, autoForgeInterval, updateNestedProfile]);

    // Load Configs
    const { data: dropChances } = useGameData<ItemAgeDropChances>('ItemAgeDropChancesLibrary.json');
    const { data: brackets } = useGameData<ItemLevelBrackets>('ItemLevelBracketsLibrary.json');
    const { data: balancingConfig } = useGameData<ItemBalancingConfig>('ItemBalancingConfig.json');
    const { data: techTreeLib } = useGameData<TechTreeLibrary>('TechTreeLibrary.json');
    const { data: techTreeMap } = useGameData<any>('TechTreeMapping.json');
    const { data: guildWarConfig } = useGameData<GuildWarDayConfig>('GuildWarDayConfigLibrary.json');
    const { data: guildWarBaseConfig } = useGameData<any>('GuildWarConfig.json');
    const { data: forgeUpgradeData } = useGameData<any>('ForgeUpgradeLibrary.json');
    const { data: itemsLibrary } = useGameData<Record<string, ItemBalancingEntry>>('ItemBalancingLibrary.json');

    const maxForgeLevel = useMemo(() => {
        if (!forgeUpgradeData) return 100;
        const levels = Object.keys(forgeUpgradeData).map(Number);
        return Math.max(...levels, 1) + 1;
    }, [forgeUpgradeData]);

    // Clan tech tree boost to war points earned from forging (effective value, see useGameData).
    const treeModifiers = useTreeModifiers();
    const treeLimits = useTreeLimits();
    const profileForgeWarBonus = treeModifiers['WarPointsFromForging'] || 0;

    // Sandbox: local override of the result-altering tree bonus (see SandboxPanel).
    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const forgeWarBonus = sandbox.warForging ?? profileForgeWarBonus;
    const profileForgeSpendBonus = treeModifiers['WarPointsFromForgeSpend'] || 0;
    const forgeSpendBonus = sandbox.warForgeSpend ?? profileForgeSpendBonus;
    // Day boost: WarPointsOnDayN multiplier, only when forging is active today.
    const forgeDayActive = isWarPointDay(new Date(), 'forge', guildWarConfig);
    const profileDayBoost = forgeDayActive ? (treeModifiers[getDayBoostNodeType()] || 0) : 0;
    const dayBoost = sandbox.dayBoost ?? profileDayBoost;
    // Forge-spend day boost applies on the forge-SPEND days (SpendCoins/GemOnForge).
    const spendDayActive = isWarPointDay(new Date(), 'forgeSpend', guildWarConfig);
    const profileSpendDayBoost = spendDayActive ? (treeModifiers[getDayBoostNodeType()] || 0) : 0;
    const spendDayBoost = sandbox.spendDayBoost ?? profileSpendDayBoost;
    const sandboxControls = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'warForging', label: 'War points: forging', value: forgeWarBonus, profileValue: profileForgeWarBonus, min: 0, ...treeLimits.clan('WarPointsFromForging'), onChange: (v: number) => setSandbox(p => ({ ...p, warForging: v })) },
            { key: 'warForgeSpend', label: 'War points: forge spend', value: forgeSpendBonus, profileValue: profileForgeSpendBonus, min: 0, ...treeLimits.clan('WarPointsFromForgeSpend'), onChange: (v: number) => setSandbox(p => ({ ...p, warForgeSpend: v })) },
            { key: 'dayBoost', label: 'Day boost. Crafting (today)', value: dayBoost, profileValue: profileDayBoost, min: 0, ...treeLimits.clan('WarPointsOnDay1'), onChange: (v: number) => setSandbox(p => ({ ...p, dayBoost: v })) },
            { key: 'spendDayBoost', label: 'Day boost. Forge spend (today)', value: spendDayBoost, profileValue: profileSpendDayBoost, min: 0, ...treeLimits.clan('WarPointsOnDay1'), onChange: (v: number) => setSandbox(p => ({ ...p, spendDayBoost: v })) },
        ],
    };

    // --- Forge Upgrade War Points (from spending coins/gems on forge upgrades) ---
    // Coins are derived from the real upgrade costs (ForgeUpgradeLibrary) across the
    // chosen steps, reduced by the ForgeUpgradeCost tech node.
    const forgeUpgradeCostReduction = treeModifiers['ForgeUpgradeCost'] || 0;
    // Starting level follows the simulated-forge slider below; steps are capped at the
    // number of upgrades remaining from that level to max.
    const maxForgeSpendSteps = Math.max(1, maxForgeLevel - simulatedForgeLevel);
    const [forgeSteps, setForgeSteps] = useState<number>(10);
    const [gemsSpent, setGemsSpent] = useState<number>(0);
    const effectiveForgeSteps = Math.min(forgeSteps, maxForgeSpendSteps);
    const forgeSpendWarPoints = useMemo(() => {
        // GuildWarConfig.CoinsSpentOnForgeNeededToGrantOneActionReward: no figure until it loads.
        const coinsPerReward = guildWarBaseConfig?.CoinsSpentOnForgeNeededToGrantOneActionReward;
        if (!guildWarConfig || typeof coinsPerReward !== 'number' || coinsPerReward <= 0) return null;
        const coinReward = getWarPointsForTask(guildWarConfig, 'SpendCoinsOnForge');
        const gemReward = getWarPointsForTask(guildWarConfig, 'SpendGemOnForge');
        // Sum real upgrade coin cost across the steps (simulated level → +steps), node-reduced.
        let coins = 0;
        if (forgeUpgradeData) {
            for (let i = 0; i < effectiveForgeSteps; i++) {
                const def = forgeUpgradeData[String(simulatedForgeLevel + i)];
                coins += forgeLevelCost(def, forgeUpgradeCostReduction);
            }
        }
        const mult = (1 + forgeSpendBonus + spendDayBoost);
        const coinPts = Math.floor(coins / coinsPerReward) * coinReward * mult;
        const gemPts = (gemsSpent || 0) * gemReward * mult;
        return { coinsPerReward, coinReward, gemReward, coins, coinPts, gemPts, total: coinPts + gemPts };
    }, [guildWarConfig, guildWarBaseConfig, forgeUpgradeData, simulatedForgeLevel, effectiveForgeSteps, forgeUpgradeCostReduction, gemsSpent, forgeSpendBonus, spendDayBoost]);

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
                            pointsMap[finalIdx] = reward.Amount * (1 + forgeWarBonus + dayBoost);
                        }
                    }
                }
            });
        });
        return pointsMap;
    }, [guildWarConfig, forgeWarBonus, dayBoost]);

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

                if (!nodeDef.Stats || !nodeDef.Stats[0] || typeof nodeDef.MaxLevel !== 'number') return;
                const stat = nodeDef.Stats[0];

                // Max possible value for this node instance
                const maxVal = stat.Value + (nodeDef.MaxLevel - 1) * stat.ValueIncrease;

                const key = classifyForgeNode(nodeDef)?.key || '';

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
            return getTechTreeIconStyle(0, size, selectedVersion);
        }

        const { x, y, width, height } = rect;
        const sheetW = techTreeMap.texture_size.width;
        const sheetH = techTreeMap.texture_size.height;

        const scale = size / width;
        // Unity Y is bottom-left, CSS is top-left
        const cssY = sheetH - y - height;

        const versionPath = selectedVersion ? `${selectedVersion}/` : '';
        return {
            backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: `${size}px`,
            height: `${size}px`,
            display: 'inline-block',
            imageRendering: 'pixelated' as const
        };
    };

    // 1. Forge-related tree bonuses. Values come from useTreeModifiers (tier aware, requirement
    // checked, follows the tree mode); the nodes are picked by what they target in the config.
    const forgeNodes = useMemo(() => {
        const out: { type: string; key: string; itemType?: number }[] = [];
        if (!techTreeLib) return out;
        Object.values(techTreeLib).forEach(def => {
            const c = classifyForgeNode(def);
            if (c) out.push({ type: def.Type, ...c });
        });
        return out;
    }, [techTreeLib]);

    const bonuses = useMemo(() => {
        let sellPriceBonus = 0;
        let freeForgeChance = 0;
        const slotBonuses: Record<string, number> = {};
        const slotTypes: Record<string, number> = {};
        forgeNodes.forEach(n => {
            const v = treeModifiers[n.type] || 0;
            if (n.key === 'SellPrice') sellPriceBonus += v;
            else if (n.key === 'FreeForgeChance') freeForgeChance += v;
            else if (n.itemType !== undefined) {
                slotBonuses[n.key] = (slotBonuses[n.key] || 0) + v;
                slotTypes[n.key] = n.itemType;
            }
        });
        return { sellPriceBonus, freeForgeChance, slotBonuses, slotTypes };
    }, [forgeNodes, treeModifiers]);

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

    // Effective bonus: the simulated value when the custom tree is on, the profile value otherwise.
    const effBonus = (key: string, profileValue: number) =>
        (!usePlayerItems && manualBonuses[key] !== undefined) ? manualBonuses[key] : profileValue;
    const effectiveSellPriceBonus = effBonus('SellPrice', bonuses.sellPriceBonus);
    const effectiveFreeChance = effBonus('FreeForgeChance', bonuses.freeForgeChance);

    // 2. Model input: everything the game reads when it forges (see utils/forgeItemLevels.ts).
    const modelInput = useMemo((): ForgeModelInput | null => {
        if (!brackets || !dropChances || !balancingConfig || !itemsLibrary) return null;
        const row = dropChances[(simulatedForgeLevel - 1).toString()];
        if (!row) return null;
        const ageChances: Record<number, number> = {};
        Object.entries(row).forEach(([k, v]) => {
            if (k.startsWith('Age') && typeof v === 'number') ageChances[parseInt(k.slice(3))] = v;
        });
        const typesByAge: Record<number, number[]> = {};
        Object.values(itemsLibrary).forEach(it => {
            const t = (ITEM_TYPE_NAMES as readonly string[]).indexOf(it?.ItemId?.Type);
            const age = it?.ItemId?.Age;
            if (t < 0 || typeof age !== 'number') return;
            const list = (typesByAge[age] ||= []);
            if (!list.includes(t)) list.push(t);
        });
        const slots: Record<number, ForgeSlot> = {};
        Object.entries(bonuses.slotTypes).forEach(([key, itemType]) => {
            slots[itemType] = {
                itemType,
                key,
                maxLevel: balancingConfig.ItemBaseMaxLevel + effBonus(key, bonuses.slotBonuses[key] || 0),
                sellBonus: effectiveSellPriceBonus,
            };
        });
        return {
            brackets: sortBrackets(brackets),
            ageChances,
            typesByAge,
            slots,
            sell: { sellBasePrice: balancingConfig.SellBasePrice, levelScalingBase: balancingConfig.LevelScalingBase },
            freeChance: effectiveFreeChance,
            // Players cannot see their hidden counters, so the page bounds them instead: the fresh
            // case (right after a forge ascension) is overridden per run below.
            state: { kind: 'atCap' },
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brackets, dropChances, balancingConfig, itemsLibrary, simulatedForgeLevel, bonuses, usePlayerItems, manualBonuses, effectiveSellPriceBonus, effectiveFreeChance]);

    // 3. Perform Final Calculation (Bidirectional)
    const results = useMemo(() => {
        if (!modelInput) return null;

        const inputVal = parseFloat(inputValue) || 0;
        if (inputVal <= 0) return null;

        // Hidden counters are unknowable, so two bounding cases:
        // fresh = every counter at 0 (right after a forge ascension), advancing per forged item;
        // cap = every counter already at its cap. MIN uses fresh with every roll at the window's
        // LowerRange, MAX uses cap with every roll at Min(UpperRange, maxLevel).
        const freshInput: ForgeModelInput = { ...modelInput, state: { kind: 'sinceAscension', forges: 0 } };
        const capInput: ForgeModelInput = { ...modelInput, state: { kind: 'atCap' } };

        // Gold mode: hammers needed range (fewest = cap + high rolls, most = fresh + low rolls).
        const hammersLow = mode === 'gold' ? hammersForCoins(capInput, inputVal, r => r.coinsMax) : Math.floor(inputVal);
        const hammersHigh = mode === 'gold' ? hammersForCoins(freshInput, inputVal, r => r.coinsMin) : Math.floor(inputVal);
        // The rest of the page (forges, items, war points) uses the hammer count that reaches the
        // target in every case.
        const finalHammers = hammersHigh;
        const fresh = computeForgeModel(freshInput, finalHammers);
        const cap = computeForgeModel(capInput, finalHammers);
        const model = cap;
        const capByAge = new Map(cap.ages.map(a => [a.age, a]));

        let maxAgeIdx = -1;
        model.ages.forEach(a => { if (a.age > maxAgeIdx) maxAgeIdx = a.age; });

        let totalWarPoints = 0;
        const ages = fresh.ages
            .slice()
            .sort((a, b) => b.age - a.age)
            .map(f => {
                const a = capByAge.get(f.age)!;
                const warPoints = a.items * (warPointsPerAge[a.age] || 0);
                totalWarPoints += warPoints;
                return {
                    idx: a.age,
                    name: AGES[a.age] || `Age ${a.age + 1}`,
                    chance: a.chance * 100,
                    items: a.items,
                    coinsMin: f.coinsMin,
                    coinsMax: a.coinsMax,
                    levelMin: f.avgLevelLow + 1,
                    levelMax: a.avgLevelHigh + 1,
                    warPoints,
                    windows: a.windows,
                    isMax: a.age === maxAgeIdx
                };
            });

        // AutoForge Time Estimation
        const interval = parseFloat(autoForgeInterval) || 2.43;
        const cycles = model.forges / autoForgeSummons;
        const autoForgeSeconds = cycles * interval;

        return {
            finalHammers,
            hammersLow,
            hammersHigh,
            totalForges: model.forges,
            freeForges: model.freeForges,
            totalCoinsMin: fresh.coinsMin,
            totalCoinsMax: cap.coinsMax,
            expectedFresh: fresh.coins,
            expectedCap: cap.coins,
            totalItems: model.items,
            totalWarPoints,
            ages,
            autoForgeSeconds
        };
    }, [inputValue, mode, modelInput, warPointsPerAge, autoForgeSummons, autoForgeInterval]);

    // Age whose per-slot windows are listed (defaults to the most likely age).
    const [windowAge, setWindowAge] = useState<number | null>(null);
    const windowAges = results?.ages ?? [];
    const shownWindowAge = windowAges.find(a => a.idx === windowAge)
        ?? windowAges.slice().sort((a, b) => b.chance - a.chance)[0];

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
        <div className="flex flex-col text-stroke-sm">
            <div className="text-2xl lg:text-3xl font-black text-white text-stroke-sm">{formatNumber(val)}</div>
            <div className="text-xs text-white/50 font-mono text-stroke-sm">({val.toLocaleString(undefined, { maximumFractionDigits: 0 })})</div>
        </div>
    );

    // Helper for Range Display
    const renderPriceRange = (min: number, max: number, expFresh: number, expCap: number) => (
        <div className="flex flex-col text-stroke-sm">
            <div className="text-xl lg:text-2xl font-black text-white flex items-center gap-1 text-stroke-sm">
                <span className="text-stroke-sm">{formatNumber(min)}</span>
                <span className="text-white/50 text-stroke-sm">-</span>
                <span className="text-stroke-sm">{formatNumber(max)}</span>
            </div>
            <div className="text-[10px] text-white/50 font-mono text-stroke-sm">
                Expected: {formatNumber(expFresh)} if fresh, {formatNumber(expCap)} at cap
            </div>
        </div>
    );

    if (!dropChances || !techTreeLib || !techTreeMap || !balancingConfig || !brackets || !itemsLibrary) return <div className="p-10 text-center text-text-muted">Loading Configuration</div>;

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent mb-2 flex items-center gap-3">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Anvil.png`} alt="Forge" className="w-10 h-10 object-contain" />
                        Forge Calculator
                    </h1>
                    <p className="text-text-secondary">
                        Plan your forging strategy. Switch modes to calculate costs or rewards.
                    </p>
                    <div className="flex items-center gap-2 pt-3 scale-75 origin-left">
                        {isWarPointDay(new Date(), 'forge', guildWarConfig) && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-primary/20 text-accent-primary border border-accent-primary/30 text-[10px] font-black uppercase tracking-wider animate-pulse">
                                <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 10 }} size={14} />
                                War Points Active: High Value Day
                            </div>
                        )}
                        {forgeWarBonus > 0 && (
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">
                                <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 0 }} size={14} />
                                Clan Boost: +{(forgeWarBonus * 100).toFixed(0)}% War Points
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <SandboxPanel fields={sandboxControls.fields} onReset={sandboxControls.reset} />

            {/* Forge Upgrade War Points. Hidden for now (WIP: forge N→M with auto coins/steps/gems + completed toggle) */}
            {false && (
            <div className="card p-4 border-accent-primary/20 bg-bg-secondary/30 backdrop-blur-md">
                <div className="flex items-center gap-2 mb-3">
                    <GameAssetIcon asset={{ sheet: 'ClanTechTreeIcons', index: 4 }} size={16} />
                    <h3 className="text-sm font-bold text-white">Forge Upgrade War Points</h3>
                    <span className="text-[10px] text-text-muted">(spending coins/gems on upgrades)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-text-muted uppercase font-bold ml-1">Starting forge level</label>
                        <div className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-xs font-bold text-text-secondary">
                            Lvl {simulatedForgeLevel} <span className="text-text-muted font-normal">(from slider below)</span>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-text-muted uppercase font-bold ml-1">Upgrade steps (max {maxForgeSpendSteps})</label>
                        <input
                            type="number" min="1" max={maxForgeSpendSteps} value={effectiveForgeSteps}
                            onChange={(e) => setForgeSteps(Math.max(1, Math.min(maxForgeSpendSteps, parseInt(e.target.value) || 1)))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-accent-primary"
                        />
                        <div className="text-[10px] text-text-muted ml-1">
                            {forgeSpendWarPoints && `≈ ${Math.round(forgeSpendWarPoints?.coins ?? 0).toLocaleString()} coins → `}
                            <span className="text-emerald-300 font-bold">{forgeSpendWarPoints ? Math.round(forgeSpendWarPoints?.coinPts ?? 0).toLocaleString() : 0} pts</span>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-text-muted uppercase font-bold ml-1">Gems spent on forge</label>
                        <input
                            type="number" min="0" value={gemsSpent}
                            onChange={(e) => setGemsSpent(Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-accent-primary"
                        />
                        <div className="text-[10px] text-text-muted ml-1">
                            {forgeSpendWarPoints && `${forgeSpendWarPoints?.gemReward ?? 0} pts / gem → `}
                            <span className="text-emerald-300 font-bold">{forgeSpendWarPoints ? Math.round(forgeSpendWarPoints?.gemPts ?? 0).toLocaleString() : 0} pts</span>
                        </div>
                    </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                    <span className="text-xs text-text-secondary uppercase font-bold">Total War Points</span>
                    <span className="text-lg font-black text-accent-primary font-mono">{forgeSpendWarPoints ? Math.round(forgeSpendWarPoints?.total ?? 0).toLocaleString() : 0}</span>
                </div>
            </div>
            )}

            {/* Simulation Level Slider */}
            <div className="card p-4 border-accent-primary/20 bg-bg-secondary/30 backdrop-blur-md">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-white">Simulated Forge Level</span>
                        {simulatedForgeLevel !== profile.misc.forgeLevel && (
                            <span className="text-xs text-text-muted">(My Level: {profile.misc.forgeLevel})</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="1"
                            max={maxForgeLevel}
                            value={simulatedForgeLevel}
                            onChange={(e) => setSimulatedForgeLevel(Math.max(1, Math.min(maxForgeLevel, parseInt(e.target.value) || 1)))}
                            className="w-16 bg-bg-input border border-border rounded px-2 py-1 text-center font-mono font-bold text-white outline-none focus:border-accent-primary"
                        />
                        {simulatedForgeLevel !== profile.misc.forgeLevel && (
                            <button
                                onClick={() => setSimulatedForgeLevel(profile.misc.forgeLevel || 1)}
                                className="text-xs text-accent-primary hover:text-white underline ml-2"
                            >
                                Reset
                            </button>
                        )}
                    </div>
                </div>
                <div className="relative pt-1">
                    <input
                        type="range"
                        min="1"
                        max={maxForgeLevel}
                        value={simulatedForgeLevel}
                        onChange={(e) => setSimulatedForgeLevel(parseInt(e.target.value))}
                        className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary hover:accent-accent-secondary"
                    />
                    <div className="flex justify-between text-[10px] text-text-muted font-mono mt-1">
                        <span>1</span>
                        <span>{Math.floor(maxForgeLevel * 0.25)}</span>
                        <span>{Math.floor(maxForgeLevel * 0.5)}</span>
                        <span>{Math.floor(maxForgeLevel * 0.75)}</span>
                        <span>{maxForgeLevel}</span>
                    </div>
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
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Hammer.png`} alt="Hammer" className="w-5 h-5 object-contain" />
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
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}CoinIcon.png`} alt="Gold" className="w-5 h-5 object-contain" />
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
                                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Hammer.png`} alt="Hammer" className="w-8 h-8 object-contain" /> :
                                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}CoinIcon.png`} alt="Gold" className="w-8 h-8 object-contain" />
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

                                {/* AutoForge Settings */}
                                <div className="bg-bg-primary/40 border border-white/5 rounded-xl p-4 space-y-4">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                        <span>AutoForge Estimates</span>
                                        <GameAssetIcon asset={{ icon: 'InfoIcon' }} size={12} className="opacity-50" />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-text-muted uppercase font-bold ml-1">Summons / Cycle</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="100"
                                                value={autoForgeSummons}
                                                onChange={(e) => setAutoForgeSummons(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-accent-primary"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-text-muted uppercase font-bold ml-1">Cycle Time (s)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={autoForgeInterval}
                                                onChange={(e) => setAutoForgeInterval(e.target.value)}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none focus:border-accent-primary"
                                                placeholder="2.43"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[9px] text-text-muted leading-tight opacity-70">
                                        * Duration is empirical and may vary.
                                    </p>
                                </div>

                                {/* Hidden item level counters */}
                                <div className="bg-bg-primary/40 border border-white/5 rounded-xl p-4 space-y-2">
                                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Item Level Range</div>
                                    <p className="text-[10px] text-text-muted leading-snug">
                                        Each item type and age keeps a hidden counter that picks the level bracket. A forge ascension resets it, every forged item of that type and age raises it up to a cap. Since it cannot be seen, gold is shown as a range: minimum = counters fresh from an ascension and every roll at the bottom of its window; maximum = counters at cap and every roll at the top.
                                    </p>
                                    <p className="text-[9px] text-text-muted leading-tight opacity-70">
                                        Sell value = round({balancingConfig.SellBasePrice} x {balancingConfig.LevelScalingBase.toFixed(4)}^(level - 1) x (1 + sell bonus)).
                                    </p>
                                </div>
                            </div>

                            {/* Render Virtual Nodes (if !usePlayerItems) */}
                            {renderVirtualNodes()}

                        </div>

                        {/* Calculated Reverse Result (if Gold Mode) */}
                        {mode === 'gold' && results && (
                            <div className="bg-accent-primary/10 border border-accent-primary/20 rounded-xl p-4 flex items-center justify-between">
                                <span className="text-sm font-bold text-accent-primary uppercase text-stroke-sm">Required Hammers</span>
                                <div className="text-right text-stroke-sm">
                                    <span className="text-2xl font-black text-white block">{formatNumber(results.hammersLow)} to {formatNumber(results.hammersHigh)}</span>
                                    <span className="text-xs text-white/50 block">({results.hammersLow.toLocaleString()} to {results.hammersHigh.toLocaleString()}; results below use {results.hammersHigh.toLocaleString()})</span>
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
                                    <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Anvil.png`} alt="Forge" className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                                </div>
                                <span className="font-medium text-text-secondary">Forge Level</span>
                            </div>
                            <span className="text-xl font-bold text-white text-stroke-sm">{profile.misc.forgeLevel}</span>
                        </div>
                        {/* Sell Price */}
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-green-500/20">
                                    <div style={getTechTreeIconStyle(3, 32, selectedVersion)} />
                                </div>
                                <span className="font-medium text-text-secondary">Sell Bonus</span>
                            </div>
                            <span className="text-xl font-bold text-green-400 text-stroke-sm">+{(effectiveSellPriceBonus * 100).toFixed(1)}%</span>
                        </div>
                        {/* Free Forges */}
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="p-1 rounded bg-blue-500/20">
                                    <div style={getTechTreeIconStyle(32, 32, selectedVersion)} />
                                </div>
                                <span className="font-medium text-text-secondary">Free Forges</span>
                            </div>
                            <span className="text-xl font-bold text-blue-400 text-stroke-sm">
                                +{(effectiveFreeChance * 100).toFixed(1)}%
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
                                <div className="text-sm font-bold text-yellow-500 uppercase tracking-wider mb-1 text-stroke-sm">Total Gold Value</div>
                                {/* Show Range instead of Single Value */}
                                <div className="text-stroke-sm">
                                    {renderPriceRange(results.totalCoinsMin, results.totalCoinsMax, results.expectedFresh, results.expectedCap)}
                                </div>
                            </div>
                            <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}CoinIcon.png`} alt="Gold" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-red-500 uppercase tracking-wider mb-1 text-stroke-sm">Total War Points</div>
                                <div className="text-stroke-sm">
                                    {renderPriceWithPrecision(results.totalWarPoints)}
                                </div>
                            </div>
                            <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}TechTreePower.png`} alt="War Points" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        <div className="card p-6 bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-blue-500 uppercase tracking-wider mb-1 text-stroke-sm">Total Actions</div>
                                <div className="text-stroke-sm">
                                    {renderPriceWithPrecision(results.totalForges)}
                                </div>
                                <div className="text-xs text-blue-300/60 mt-1 flex gap-1 text-stroke-sm">
                                    <span>From {formatNumber(results.finalHammers)}</span>
                                    <span className="opacity-50">({Math.floor(results.finalHammers).toLocaleString()})</span>
                                    <span>Hammers</span>
                                </div>
                                <div className="text-xs text-blue-300 mb-1 text-stroke-sm">
                                    <span className="font-bold">+{formatNumber(results.freeForges)}</span>
                                    <span className="opacity-70"> Free Forges ({Math.floor(results.freeForges).toLocaleString()})</span>
                                </div>
                            </div>
                            <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Hammer.png`} alt="Hammer" className="w-10 h-10 object-contain absolute right-4 bottom-4 opacity-50" />
                        </div>

                        {/* Estimated AutoForge Time */}
                        <div className="card p-6 bg-gradient-to-br from-green-500/10 to-transparent border-green-500/20 flex flex-col justify-between relative overflow-hidden group">
                            <div className="absolute right-0 top-0 p-10 bg-green-500/5 rounded-full blur-2xl group-hover:bg-green-500/10 transition-colors" />
                            <div className="relative z-10">
                                <div className="text-sm font-bold text-green-500 uppercase tracking-wider mb-1 text-stroke-sm">Est. AutoForge Time</div>
                                <div className="text-2xl lg:text-3xl font-black text-white text-stroke-sm">
                                    {(() => {
                                        const s = results.autoForgeSeconds;
                                        if (s === Infinity || isNaN(s)) return '-';
                                        const h = Math.floor(s / 3600);
                                        const m = Math.floor((s % 3600) / 60);
                                        const sec = Math.floor(s % 60);
                                        if (h > 0) return `${h}h ${m}m ${sec}s`;
                                        if (m > 0) return `${m}m ${sec}s`;
                                        return `${sec}s`;
                                    })()}
                                </div>
                                <div className="text-xs text-green-300/60 mt-1 text-stroke-sm">
                                    Using {autoForgeSummons} items every {autoForgeInterval}s
                                </div>
                            </div>
                            <GameAssetIcon asset={{ icon: 'AutoForge' }} size={40} className="absolute right-4 bottom-4 opacity-20 animate-[spin_5s_linear_infinite]" />
                        </div>
                    </div>

                    {/* Detailed Breakdown */}
                    <div className="card overflow-hidden">
                        <div className="p-4 bg-black/40 border-b border-white/5 font-bold flex items-center gap-2 text-stroke-sm">
                            <div className="w-1 h-4 bg-accent-primary rounded-full" />
                            Age Breakdown
                        </div>
                        <div className="divide-y divide-white/5">
                            {results.ages.map((age) => (
                                <div key={age.name} className={cn(
                                    "p-4 flex flex-col md:flex-row items-center gap-4 transition-all relative overflow-hidden group",
                                    age.isMax ? "ring-2 ring-accent-primary/30 z-10" : "",
                                    "shadow-[inset_0_0_30px_rgba(0,0,0,0.1)]"
                                )}>
                                    {/* The age's item background as the game draws it (forge upgrade popup). */}
                                    <AgeBackground ageIdx={age.idx} />

                                    <div className="flex-1 w-full flex items-center gap-4 relative z-10">
                                        <div className="shrink-0 p-1 bg-white/10 rounded-lg border border-white/20 shadow-md backdrop-blur-sm" style={getAgeIconStyle(age.idx, 48, selectedVersion)} />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 text-stroke-sm">
                                                <span className={cn(
                                                    "font-black text-lg uppercase tracking-tight text-stroke-sm",
                                                    age.idx === 9 ? "text-white" :
                                                        age.idx === 8 ? "text-age-underworld" :
                                                            age.idx === 7 ? "text-age-quantum" :
                                                                age.idx === 6 ? "text-age-multiverse" :
                                                                    age.idx === 5 ? "text-age-interstellar" :
                                                                        age.idx === 4 ? "text-age-space" :
                                                                            age.idx === 3 ? "text-age-modern" :
                                                                                age.idx === 2 ? "text-age-earlymodern" :
                                                                                    age.idx === 1 ? "text-age-medieval" :
                                                                                        "text-white",
                                                    "text-stroke-sm"
                                                )}>{age.name}</span>
                                                {age.isMax && <span className="text-[10px] bg-accent-primary text-white px-1.5 py-0.5 rounded font-bold uppercase shadow-glow-sm text-stroke-sm">Max Unlocked</span>}
                                            </div>
                                            <div className={cn(
                                                "text-xs font-bold text-stroke-sm",
                                                age.idx === 9 ? "text-white/90" : "text-text-muted",
                                                "text-stroke-sm"
                                            )}>
                                                {age.chance > 100
                                                    ? `Yield: x${(age.chance / 100).toFixed(2)}`
                                                    : `Chance: ${age.chance.toFixed(2)}%`
                                                }
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-1 w-full grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 relative z-10 text-stroke-sm">
                                        <div className={cn(
                                            "p-2 rounded-lg text-center md:text-right border text-stroke-sm",
                                            age.idx === 9 ? "bg-black/40 border-white/20" : "bg-black/20 border-white/5"
                                        )}>
                                            <div className={cn("text-[10px] uppercase font-bold mb-1 text-stroke-sm", age.idx === 9 ? "text-white/70" : "text-text-muted text-stroke-sm")}>Items</div>
                                            <div className="text-white font-mono font-bold text-stroke-sm">{formatNumber(age.items)}</div>
                                        </div>
                                        <div className={cn(
                                            "p-2 rounded-lg text-center md:text-right border text-stroke-sm",
                                            age.idx === 9 ? "bg-black/40 border-white/20" : "bg-black/20 border-white/5"
                                        )}>
                                            <div className={cn("text-[10px] uppercase font-bold mb-1 text-stroke-sm", age.idx === 9 ? "text-white/70" : "text-text-muted text-stroke-sm")}>Avg Level</div>
                                            <div className="text-white font-mono font-bold text-stroke-sm">{age.levelMin.toFixed(1)} to {age.levelMax.toFixed(1)}</div>
                                        </div>
                                        <div className={cn(
                                            "p-2 rounded-lg text-center md:text-right border text-stroke-sm",
                                            age.idx === 9 ? "bg-black/40 border-white/20" : "bg-black/20 border-white/5"
                                        )}>
                                            <div className={cn("text-[10px] uppercase font-bold mb-1 text-stroke-sm", age.idx === 9 ? "text-white/70" : "text-text-muted text-stroke-sm")}>Gold Value</div>
                                            <div className={cn("font-mono font-bold text-stroke-sm", age.idx === 9 ? "text-white" : "text-yellow-400 text-stroke-sm")}>{formatNumber(age.coinsMin)} to {formatNumber(age.coinsMax)}</div>
                                        </div>
                                        <div className={cn(
                                            "p-2 rounded-lg text-center md:text-right border text-stroke-sm",
                                            age.idx === 9 ? "bg-black/40 border-white/20" : "bg-black/20 border-white/5"
                                        )}>
                                            <div className={cn("text-[10px] uppercase font-bold mb-1 text-stroke-sm", age.idx === 9 ? "text-white/70" : "text-text-muted text-stroke-sm")}>War Points</div>
                                            <div className={cn("font-mono font-bold text-stroke-sm", age.idx === 9 ? "text-white" : "text-red-400 text-stroke-sm")}>{formatNumber(age.warPoints)}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Per-slot level windows */}
                    {shownWindowAge && (
                        <div className="card overflow-hidden">
                            <div className="p-4 bg-black/40 border-b border-white/5 font-bold flex flex-wrap items-center gap-2 text-stroke-sm">
                                <div className="w-1 h-4 bg-accent-primary rounded-full" />
                                <span>Item Level Windows</span>
                                <div className="flex flex-wrap gap-1 ml-auto">
                                    {results.ages.map(a => (
                                        <button
                                            key={a.idx}
                                            onClick={() => setWindowAge(a.idx)}
                                            className={cn(
                                                "px-2 py-1 rounded text-[10px] font-bold uppercase border transition-colors",
                                                a.idx === shownWindowAge.idx
                                                    ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                                                    : "bg-white/5 border-white/10 text-text-muted hover:text-white"
                                            )}
                                        >
                                            {a.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-[10px] uppercase text-text-muted">
                                            <th className="text-left p-2 md:p-3">Slot</th>
                                            <th className="text-right p-2 md:p-3">Max Lv</th>
                                            <th className="text-right p-2 md:p-3">Fresh</th>
                                            <th className="text-right p-2 md:p-3">At Cap</th>
                                            <th className="text-right p-2 md:p-3">Items To Cap</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {shownWindowAge.windows.map(w => (
                                            <tr key={w.itemType}>
                                                <td className="p-2 md:p-3 font-bold text-white">{w.key}</td>
                                                <td className="p-2 md:p-3 text-right font-mono text-text-secondary">{Math.floor(w.maxLevel) + 1}</td>
                                                <td className="p-2 md:p-3 text-right font-mono text-text-secondary">{w.freshWindow[0] + 1} to {w.freshWindow[1] + 1}</td>
                                                <td className="p-2 md:p-3 text-right font-mono text-white">{w.capWindow[0] + 1} to {w.capWindow[1] + 1}</td>
                                                <td className="p-2 md:p-3 text-right font-mono text-text-secondary">{w.cap}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="px-4 py-3 text-[10px] text-text-muted border-t border-white/5">
                                {shownWindowAge.name} items roll uniformly inside the window. Fresh is the window right after a forge ascension; each item of that slot and age moves it up one bracket until the cap.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Background Decoration */}
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Anvil.png`} alt="" className="w-64 h-64 object-contain grayscale" />
            </div>
        </div>
    );
}
