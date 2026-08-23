import { useMemo, useState, useEffect } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { Card } from '../UI/Card';
import { ConfirmModal } from '../UI/ConfirmModal';
import { Search, Lock, Check, Download, Upload, Calendar } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGameDataContext } from '../../context/GameDataContext';

import { getNormalizedTarget } from '../../utils/ascensionUtils';
import { getTechNodeName, getClanIconStyle } from '../../utils/techUtils';
import { SpriteIcon } from '../UI/SpriteIcon';

const ICON_SIZE = 40;

type TreeName = 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan';

interface TechNode {
    id: number;
    tier: number;
    layer: number;
    type: string;
    sprite_rect?: { x: number; y: number; width: number; height: number };
    requirements: number[];
    uniqueKey: string;
}

// Helper to generate a unique key for a stat (Type + Target)
function getStatSignature(stat: any): string {
    const type = stat.StatNode?.UniqueStat?.StatType || 'Unknown';
    const nature = stat.StatNode?.UniqueStat?.StatNature || 'Multiplier';
    const target = getNormalizedTarget(stat.StatNode);
    const cleanTarget = Object.entries(target).reduce((acc, [k, v]) => {
        if (v !== null && v !== undefined) acc[k] = v;
        return acc;
    }, {} as any);
    return `${type}|${nature}|${JSON.stringify(cleanTarget, Object.keys(cleanTarget).sort())}`;
}

// Check if a node is unlocked: requirement nodes just need level >= 1 (not max)
function isNodeUnlocked(node: TechNode, treeLevels: Record<number, number>): boolean {
    if (!node.requirements || node.requirements.length === 0) return true;
    return node.requirements.every(reqId => {
        const reqLevel = treeLevels[reqId] || 0;
        return reqLevel >= 1; // Just need to be started, not maxed
    });
}

// Check if a node is completed (at max level)
function isNodeCompleted(nodeId: number, treeLevels: Record<number, number>, maxLevel: number): boolean {
    const level = treeLevels[nodeId] || 0;
    return level >= maxLevel;
}

export function TechTreePanel() {
    const { profile, updateProfile } = useProfile();
    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');
    const { data: treeEffects } = useGameData<any>('TechTreeLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: clanIconsMap } = useGameData<any>('ClanTechTreeIconsMap.json');
    const { selectedVersion } = useGameDataContext();
    const [activeTab, setActiveTab] = useState<TreeName>('Forge');
    const [searchTerm, setSearchTerm] = useState('');
    const [pendingReset, setPendingReset] = useState<{ nodeId: number; count: number } | null>(null);

    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');

    const exportClanTech = () => {
        const ranks = profile.techTree?.Clan || {};
        const jsonStr = JSON.stringify({ ClanTech: ranks });
        navigator.clipboard.writeText(jsonStr);
        alert("Clan Tech ranks copied to clipboard!");
    };

    const importClanTech = () => {
        try {
            const parsed = JSON.parse(importText.trim());
            if (!parsed || typeof parsed !== 'object' || !parsed.ClanTech) {
                alert("Invalid format! Must contain a 'ClanTech' object.");
                return;
            }
            const importedRanks = parsed.ClanTech;
            
            const cleanRanks: Record<number, number> = {};
            Object.entries(importedRanks).forEach(([k, v]) => {
                const nodeId = parseInt(k);
                const rank = Number(v);
                if (!isNaN(nodeId) && !isNaN(rank)) {
                    cleanRanks[nodeId] = rank;
                }
            });
            
            updateProfile({
                techTree: {
                    ...profile.techTree,
                    Clan: cleanRanks
                }
            });
            
            setShowImportModal(false);
            setImportText('');
            alert("Clan Tech ranks imported successfully!");
        } catch (e) {
            alert("Failed to parse JSON. Please verify the input.");
        }
    };

    // Pre-calculate GLOBAL stats across all active trees
    const globalStats = useMemo(() => {
        if (!profile || !treeEffects || !treeMapping) return {};
        const stats: Record<string, number> = {};

        const allTrees: TreeName[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan'];

        allTrees.forEach(treeName => {
            const userLevels = profile.techTree?.[treeName] || {};
            
            if (treeName === 'Clan') {
                if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
                    const nodesList: string[] = [];
                    for (const cat of Object.keys(guildPositionLibrary)) {
                        if (guildPositionLibrary[cat]?.Nodes) {
                            nodesList.push(...guildPositionLibrary[cat].Nodes);
                        }
                    }

                    Object.entries(userLevels).forEach(([nodeIdStr, lvl]) => {
                        const level = Number(lvl);
                        if (level <= 0) return;

                        const nodeId = parseInt(nodeIdStr);
                        const nodeType = nodesList[nodeId];
                        if (!nodeType) return;

                        const effect = treeEffects[nodeType];
                        const upgradeDef = guildUpgradeLibrary[nodeType];
                        if (!effect?.Stats || !upgradeDef) return;

                        // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                        const valPerLevel = upgradeDef.ValuePerLevel || 0;

                        effect.Stats.forEach((stat: any) => {
                            const sig = getStatSignature(stat);
                            const total = valPerLevel * level;
                            stats[sig] = (stats[sig] || 0) + total;
                        });
                    });
                }
                return;
            }

            // We need to look up node definitions to check Type
            const treeMap = treeMapping.trees?.[treeName];
            if (!treeMap?.nodes) return;

            // Create a map for fast lookup? Or just iterate active nodes.
            // Iterating active user nodes is better if efficient.
            Object.entries(userLevels).forEach(([nodeId, lvl]) => {
                const level = Number(lvl);
                if (level <= 0) return;

                const nodeDef = treeMap.nodes.find((n: any) => n.id === parseInt(nodeId));
                if (!nodeDef) return;

                const effect = treeEffects[nodeDef.type];
                if (!effect?.Stats) return;

                const tier = nodeDef.tier ?? 0;
                effect.Stats.forEach((stat: any, si: number) => {
                    const sig = getStatSignature(stat);
                    const tierStats = effect.StatsByTier?.[tier];
                    const tierStat = tierStats?.[si];
                    const base = tierStat?.Value ?? stat.Value ?? 0;
                    const inc = tierStat?.ValueIncrease ?? stat.ValueIncrease ?? 0;
                    const total = base + ((level - 1) * inc);

                    stats[sig] = (stats[sig] || 0) + total;
                });
            });
        });

        return stats;
    }, [profile.techTree, treeEffects, treeMapping, selectedVersion, guildPositionLibrary, guildUpgradeLibrary]);

    // Helper function to format stat description with Global info
    const formatStatDescription = (effect: any, currentLevel: number) => {
        if (!effect?.Stats || effect.Stats.length === 0) return '';

        return effect.Stats.map((stat: any) => {
            const statType = stat.StatNode?.UniqueStat?.StatType || 'Unknown';
            const statNature = stat.StatNode?.UniqueStat?.StatNature || 'Multiplier';
            const baseValue = stat.Value || 0;
            const increase = stat.ValueIncrease || 0;

            const totalValue = currentLevel > 0 ? baseValue + (currentLevel - 1) * increase : 0;

            // Global Total
            const sig = getStatSignature(stat);
            const globalTotal = globalStats[sig] || 0;

            const formatVal = (val: number) => {
                if (statNature === 'Multiplier' || statNature === 'OneMinusMultiplier' || statNature === 'Divisor') {
                    return `${(val * 100).toFixed(1)}%`;
                } else if (statNature === 'Additive') {
                    return `+${val.toFixed(0)}`;
                }
                return val.toFixed(2);
            };

            const formatInc = (val: number) => {
                if (statNature === 'Multiplier' || statNature === 'OneMinusMultiplier' || statNature === 'Divisor') {
                    // Show 2 decimal places for small increments (e.g. 0.25%)
                    return `${(val * 100).toFixed(2)}%`;
                }
                return val.toFixed(1);
            }

            return (
                <div key={sig} className="flex flex-col gap-0.5 border-t border-white/5 pt-1 mt-1 first:border-0 first:pt-0 first:mt-0">
                    <span className="font-bold text-accent-primary leading-tight">
                        {statType}: {formatVal(totalValue)}
                        <span className="text-text-muted text-[9px] font-normal ml-1 opacity-75">
                            (+{formatInc(increase)}/lvl)
                        </span>
                    </span>
                    <span className="text-[9px] text-text-secondary">
                        Global Pool: <span className="text-white/80">{formatVal(globalTotal)}</span>
                    </span>
                </div>
            );
        });
    };

    // Get trees from new mapping
    const treesData = useMemo(() => {
        if (!treeMapping?.trees) return {};
        return treeMapping.trees;
    }, [treeMapping]);



    // Get current tree levels
    const currentTreeLevels = useMemo(() => {
        return profile.techTree[activeTab] || {};
    }, [profile.techTree, activeTab]);

    // Get nodes for active tab grouped by layer
    const nodesByLayer = useMemo(() => {
        const tree = treesData[activeTab];
        if (!tree?.nodes) return {};

        let nodes: TechNode[] = tree.nodes.map((n: any) => ({
            ...n,
            uniqueKey: `${activeTab}_${n.id}`
        }));

        if (searchTerm) {
            nodes = nodes.filter((n: TechNode) =>
                n.type.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Group by layer
        const layers: Record<number, TechNode[]> = {};
        nodes.forEach(node => {
            if (!layers[node.layer]) layers[node.layer] = [];
            layers[node.layer].push(node);
        });

        // Sort nodes within each layer by id
        Object.values(layers).forEach(layerNodes => {
            layerNodes.sort((a, b) => a.id - b.id);
        });

        return layers;
    }, [treesData, activeTab, searchTerm]);

    // Get sorted layer keys
    const sortedLayers = useMemo(() => {
        return Object.keys(nodesByLayer).map(Number).sort((a, b) => a - b);
    }, [nodesByLayer]);

    // Get sprite style from TechTreeMapping
    const getSpriteStyle = (node: TechNode) => {
        if (!treeMapping || !node?.sprite_rect) return null;
        const { x, y, width, height } = node.sprite_rect;
        const sheetW = treeMapping.texture_size?.width || 1024;
        const sheetH = treeMapping.texture_size?.height || 1024;

        const scale = ICON_SIZE / width;
        // Unity Y coordinate (0 at bottom) -> CSS (0 at top)
        const cssY = sheetH - y - height;

        return {
            backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
        };
    };

    const getCascadeCount = (nodeId: number): number => {
        const tree = treesData[activeTab];
        if (!tree?.nodes) return 1;

        let count = 1; // Start with the node itself



        // We need to simulate the traversal on the CURRENT levels
        // Set visited to avoid potential (though unlikely in current DAG) circular infinite loops
        // if user data is messed up
        const visited = new Set<number>();
        visited.add(nodeId);

        // This is a bit simpler: we just need to count how many ACTIVE nodes *would* be turned off.
        // A node is turned off if it depends on a node being turned off.
        // Removing any single requirement breaks the node.

        const countRecursive = (pid: number) => {
            const dependents = tree.nodes.filter((n: any) => n.requirements && n.requirements.includes(pid));
            dependents.forEach((dep: any) => {
                // If it's active AND not already visited
                if (currentTreeLevels[dep.id] > 0 && !visited.has(dep.id)) {
                    visited.add(dep.id);
                    count++;
                    countRecursive(dep.id);
                }
            });
        };

        countRecursive(nodeId);
        return count;
    };

    const autoUnlockRequirements = (nodeId: number, levels: Record<number, number>) => {
        const tree = treesData[activeTab];
        if (!tree?.nodes) return levels;

        const updatedLevels = { ...levels };
        const processed = new Set<number>();
        
        const unlockRecursive = (id: number) => {
            if (processed.has(id)) return;
            processed.add(id);

            const node = tree.nodes.find((n: any) => n.id === id);
            if (!node) return;

            if (node.requirements) {
                node.requirements.forEach((reqId: number) => {
                    if ((updatedLevels[reqId] || 0) === 0) {
                        updatedLevels[reqId] = 1;
                        unlockRecursive(reqId);
                    }
                });
            }
        };

        unlockRecursive(nodeId);
        return updatedLevels;
    };

    const executeLevelChange = (nodeId: number, level: number) => {
        const newTreeLevels = { ...profile.techTree[activeTab], [nodeId]: level };

        // Cascade Reset logic applied to the new levels object
        if (level === 0) {
            const tree = treesData[activeTab];
            if (tree && tree.nodes) {
                const resetDependents = (parentId: number, levels: Record<number, number>) => {
                    const dependents = tree.nodes.filter((n: any) => n.requirements && n.requirements.includes(parentId));
                    dependents.forEach((dep: any) => {
                        if (levels[dep.id] > 0) {
                            levels[dep.id] = 0;
                            resetDependents(dep.id, levels);
                        }
                    });
                };
                resetDependents(nodeId, newTreeLevels);
            }
        }

        updateProfile({
            techTree: {
                ...profile.techTree,
                [activeTab]: newTreeLevels
            }
        });
    };

    const handleLevelChange = (nodeId: number, level: number, max: number) => {
        const val = Math.max(0, Math.min(level, max));

        // If resetting to 0, check for cascade
        if (val === 0) {
            const count = getCascadeCount(nodeId);
            if (count > 1) {
                setPendingReset({ nodeId, count });
                return;
            }
        }

        // Auto unlock if trying to increase level on a locked node
        const treeMap = treesData[activeTab];
        const nodeDef = treeMap?.nodes?.find((n: any) => n.id === nodeId);
        const unlocked = nodeDef ? isNodeUnlocked(nodeDef, currentTreeLevels) : true;

        if (level > 0 && !unlocked) {
            const unlockedLevels = autoUnlockRequirements(nodeId, currentTreeLevels);
            unlockedLevels[nodeId] = Math.max(unlockedLevels[nodeId] || 0, level);
            
            updateProfile({
                techTree: {
                    ...profile.techTree,
                    [activeTab]: unlockedLevels
                }
            });
            return;
        }

        executeLevelChange(nodeId, val);
    };

    const treeCategories = useMemo(() => {
        const categories: TreeName[] = ['Forge', 'Power', 'SkillsPetTech'];
        if (selectedVersion >= '2026_07_14_16_51') {
            categories.push('Clan');
        }
        return categories;
    }, [selectedVersion]);

    // Calculate completion percentages
    const completionData = useMemo(() => {
        if (!treeMapping?.trees || !treeEffects) return {};
        const data: Record<string, { current: number; max: number; percent: number }> = {};

        (['Forge', 'Power', 'SkillsPetTech', 'Clan'] as TreeName[]).forEach((treeName) => {
            if (treeName === 'Clan') {
                if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
                    let currentTotal = 0;
                    let maxTotal = 0;
                    const userTree = profile.techTree?.Clan || {};
                    let globalId = 0;
                    for (const category of Object.keys(guildPositionLibrary)) {
                        const nodesList = guildPositionLibrary[category].Nodes || [];
                        for (const nodeType of nodesList) {
                            const upgradeDef = guildUpgradeLibrary[nodeType];
                            const max = upgradeDef?.MaxLevel || 20;
                            const current = userTree[globalId] || 0;
                            maxTotal += max;
                            currentTotal += current;
                            globalId++;
                        }
                    }
                    data['Clan'] = {
                        current: currentTotal,
                        max: maxTotal,
                        percent: maxTotal > 0 ? (currentTotal / maxTotal) * 100 : 0
                    };
                }
                return;
            }

            const tree = treeMapping.trees[treeName];
            const nodes = tree?.nodes || [];
            let currentTotal = 0;
            let maxTotal = 0;

            const userTree = profile.techTree?.[treeName as TreeName] || {};

            nodes.forEach((node: any) => {
                const effect = treeEffects[node.type];
                const max = effect?.MaxLevel || 5;
                const current = userTree[node.id] || 0;

                maxTotal += max;
                currentTotal += current;
            });

            data[treeName] = {
                current: currentTotal,
                max: maxTotal,
                percent: maxTotal > 0 ? (currentTotal / maxTotal) * 100 : 0
            };
        });

        return data;
    }, [treeMapping, treeEffects, profile.techTree, selectedVersion, guildPositionLibrary, guildUpgradeLibrary]);

    if (!treeMapping || !treeEffects || (selectedVersion >= '2026_07_14_16_51' && (!guildPositionLibrary || !guildUpgradeLibrary))) {
        return <Card className="p-6">Loading Tech Tree...</Card>;
    }

    return (
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex flex-wrap justify-between items-center gap-4 border-b border-white/5 pb-4">
                <div className="flex items-center gap-2">
                    <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/TechTreeForge.png`} alt="Tech Tree" className="w-8 h-8 object-contain" />
                    Tech Tree
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {activeTab === 'Clan' && (
                        <>
                            <button
                                onClick={exportClanTech}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 text-accent-primary text-xs font-bold transition-all"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Export Clan Tech
                            </button>
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-secondary/20 border border-accent-secondary/30 hover:bg-accent-secondary/30 text-accent-secondary text-xs font-bold transition-all"
                            >
                                <Upload className="w-3.5 h-3.5" />
                                Import Clan Tech
                            </button>
                        </>
                    )}
                </div>
            </h2>

            {/* Tab Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {treeCategories.map((treeKey) => {
                        const completion = completionData[treeKey];
                        return (
                            <button
                                key={treeKey}
                                onClick={() => {
                                    setActiveTab(treeKey);
                                    setSearchTerm('');
                                }}
                                className={cn(
                                    "px-4 py-2 rounded-lg font-bold text-sm transition-colors whitespace-nowrap flex items-center gap-2",
                                    activeTab === treeKey
                                        ? "bg-accent-primary text-white"
                                        : "bg-bg-input text-text-secondary hover:bg-bg-input/80"
                                )}
                            >
                                <span>{treeKey === 'SkillsPetTech' ? 'Skills & Pets' : treeKey}</span>
                                {completion && (
                                    <span className={cn(
                                        "text-xs px-1.5 py-0.5 rounded",
                                        activeTab === treeKey ? "bg-black/20 text-white/90" : "bg-black/10 text-text-muted"
                                    )}>
                                        {completion.percent.toFixed(2)}%
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                    <input
                        placeholder="Search nodes..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary"
                        onFocus={(e) => e.target.select()}
                    />
                </div>
            </div>

            {/* Tree Structure - By Category for Clan, By Layer for Player */}
            <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                {activeTab === 'Clan' ? (
                    Object.keys(guildPositionLibrary || {}).map((category, catIdx) => {
                        const nodesList = guildPositionLibrary[category].Nodes || [];
                        
                        let filteredNodes = nodesList.map((nodeType: string, localId: number) => {
                            let globalId = 0;
                            for (const c of Object.keys(guildPositionLibrary)) {
                                if (c === category) break;
                                globalId += guildPositionLibrary[c].Nodes?.length || 0;
                            }
                            globalId += localId;
                            
                            return {
                                globalId,
                                type: nodeType,
                                category
                            };
                        });

                        if (searchTerm) {
                            filteredNodes = filteredNodes.filter((n: any) =>
                                n.type.toLowerCase().includes(searchTerm.toLowerCase())
                            );
                        }

                        if (filteredNodes.length === 0) return null;

                        return (
                            <div key={category} className="space-y-2 border-b border-white/5 pb-4 last:border-0 last:pb-0">
                                <h3 className="text-sm font-bold text-accent-primary capitalize">
                                    {category.replace(/([A-Z])/g, ' $1').trim()} Category
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {filteredNodes.map((nObj: any) => {
                                        const globalId = nObj.globalId;
                                        const nodeType = nObj.type;
                                        const upgradeDef = guildUpgradeLibrary?.[nodeType];
const maxLevel = upgradeDef?.MaxLevel || 20;
                                        const currentLevel = currentTreeLevels[globalId] || 0;
                                        const completed = currentLevel >= maxLevel;
                                        const name = getTechNodeName(nodeType);

                                        const spriteStyle = getClanIconStyle(nodeType, clanIconsMap, selectedVersion, import.meta.env.BASE_URL, treeMapping) ||
                                            (() => {
                                                const col = globalId % 8;
                                                const row = Math.floor(globalId / 8);
                                                const versionPath = selectedVersion ? `${selectedVersion}/` : '';
                                                return {
                                                    backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}ClanTechTreeIcons.png)`,
                                                    backgroundPositionX: `${col * (100 / 7)}%`,
                                                    backgroundPositionY: `${row * (100 / 7)}%`,
                                                    backgroundSize: '800% 800%',
                                                    width: '100%',
                                                    height: '100%',
                                                    imageRendering: 'pixelated' as const
                                                };
                                            })();

                                        const effectDef = treeEffects?.[nodeType];
                                        // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                                        const valPerLevel = upgradeDef?.ValuePerLevel || 0;
                                        
                                        const clanEffect = effectDef ? {
                                            ...effectDef,
                                            MaxLevel: maxLevel,
                                            Stats: (effectDef.Stats || []).map((stat: any) => ({
                                                ...stat,
                                                Value: valPerLevel,
                                                ValueIncrease: valPerLevel
                                            }))
                                        } : null;

                                        return (
                                            <div
                                                key={globalId}
                                                className={cn(
                                                    "p-3 rounded-lg border transition-all bg-bg-secondary",
                                                    completed
                                                        ? "border-green-500/50 bg-green-500/10"
                                                        : currentLevel > 0
                                                            ? "border-accent-primary/50 bg-accent-primary/5"
                                                            : "border-border bg-bg-secondary"
                                                )}
                                            >
                                                <div className="flex gap-2 items-start">
                                                    <div className={cn(
                                                        "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center overflow-hidden border relative bg-black/20 border-white/5",
                                                        completed && "bg-green-500/20 border-green-500/30"
                                                    )}>
                                                        <div style={spriteStyle} />
                                                        {completed && (
                                                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                                                                <Check className="w-3 h-3 text-white" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-bold truncate">
                                                            {name}
                                                        </div>
                                                        <div className="text-[9px] text-text-muted flex items-center gap-1">
                                                            <span>ID: {globalId} •</span>
                                                            <SpriteIcon name="GuildPotions" size={11} />
                                                            <span className="font-bold text-green-400">{(upgradeDef?.PointsPerLevel || 0).toLocaleString()}</span>
                                                            <span>/lvl</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-0.5 mt-2 bg-bg-input rounded p-1 border border-border/50">
                                                    <button
                                                        onClick={() => handleLevelChange(globalId, Math.max(0, currentLevel - 10), maxLevel)}
                                                        disabled={currentLevel === 0}
                                                        title="-10"
                                                        className={cn(
                                                            "w-7 h-6 rounded flex items-center justify-center font-bold text-[10px] transition-colors",
                                                            currentLevel > 0
                                                                ? "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                    >-10</button>
                                                    <button
                                                        onClick={() => handleLevelChange(globalId, currentLevel - 1, maxLevel)}
                                                        disabled={currentLevel === 0}
                                                        className={cn(
                                                            "w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition-colors",
                                                            currentLevel > 0
                                                                ? "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                    >-</button>
                                                    <div className="text-center">
                                                        <span className={cn(
                                                            "font-mono font-bold text-sm",
                                                            completed ? "text-green-400" : currentLevel > 0 ? "text-accent-primary" : "text-text-muted"
                                                        )}>{currentLevel}</span>
                                                        <span className="text-text-muted text-xs">/{maxLevel}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleLevelChange(globalId, currentLevel + 1, maxLevel)}
                                                        disabled={currentLevel >= maxLevel}
                                                        className={cn(
                                                            "w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition-colors",
                                                            currentLevel < maxLevel
                                                                ? "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                    >+</button>
                                                    <button
                                                        onClick={() => handleLevelChange(globalId, Math.min(maxLevel, currentLevel + 10), maxLevel)}
                                                        disabled={currentLevel >= maxLevel}
                                                        title="+10"
                                                        className={cn(
                                                            "w-7 h-6 rounded flex items-center justify-center font-bold text-[10px] transition-colors",
                                                            currentLevel < maxLevel
                                                                ? "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                    >+10</button>
                                                </div>

                                                {currentLevel > 0 && clanEffect && (
                                                    <div className="text-[10px] mt-1 text-accent-secondary truncate">
                                                        {formatStatDescription(clanEffect, currentLevel)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    sortedLayers.map((layer) => {
                        const layerNodes = nodesByLayer[layer] || [];

                        return (
                            <div key={layer} className="flex flex-col items-center">
                                {layer > 0 && (
                                    <div className="h-4 flex items-center justify-center">
                                        <div className="w-px h-full bg-accent-primary/30" />
                                    </div>
                                )}

                                <div className="flex flex-nowrap gap-2 sm:gap-3 justify-center w-full overflow-x-auto px-1">
                                    {layerNodes.map((node) => {
                                        const effect = treeEffects?.[node.type];
                                        const maxLevel = effect?.MaxLevel || 5;
                                        const currentLevel = currentTreeLevels[node.id] || 0;
                                        const unlocked = isNodeUnlocked(node, currentTreeLevels);
                                        const completed = isNodeCompleted(node.id, currentTreeLevels, maxLevel);
                                        const name = node.type.replace(/([A-Z])/g, ' $1').trim();
                                        const spriteStyle = getSpriteStyle(node);

                                        return (
                                            <div
                                                key={node.uniqueKey}
                                                className={cn(
                                                    "min-w-[140px] max-w-[180px] flex-1 p-2 sm:p-3 rounded-lg border transition-all",
                                                    !unlocked
                                                        ? "border-border/50 bg-bg-secondary/50 opacity-50"
                                                        : completed
                                                            ? "border-green-500/50 bg-green-500/10"
                                                            : currentLevel > 0
                                                                ? "border-accent-primary/50 bg-accent-primary/5"
                                                                : "border-border bg-bg-secondary"
                                                )}
                                            >
                                                <div className="flex gap-2 items-start">
                                                    <div className={cn(
                                                        "w-10 h-10 shrink-0 rounded-lg flex items-center justify-center overflow-hidden border relative",
                                                        !unlocked
                                                            ? "bg-black/40 border-white/5"
                                                            : completed
                                                                ? "bg-green-500/20 border-green-500/30"
                                                                : "bg-black/20 border-white/5"
                                                    )}>
                                                        {spriteStyle && (
                                                            <div style={spriteStyle} className={cn(!unlocked && "grayscale")} />
                                                        )}
                                                        {!unlocked && (
                                                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                                <Lock className="w-3 h-3 text-text-muted" />
                                                            </div>
                                                        )}
                                                        {completed && (
                                                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                                                                <Check className="w-3 h-3 text-white" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className={cn(
                                                            "text-xs font-bold truncate",
                                                            !unlocked && "text-text-muted"
                                                        )}>
                                                            {name}
                                                        </div>
                                                        <div className="text-[10px] text-text-muted">
                                                            T{node.tier + 1} • ID: {node.id}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between mt-2 bg-bg-input rounded p-1 border border-border/50">
                                                    <button
                                                        onClick={() => handleLevelChange(node.id, currentLevel - 1, maxLevel)}
                                                        disabled={!unlocked || currentLevel === 0}
                                                        className={cn(
                                                            "w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition-colors",
                                                            unlocked && currentLevel > 0
                                                                ? "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                    >-</button>
                                                    <div className="text-center">
                                                        <span className={cn(
                                                            "font-mono font-bold text-sm",
                                                            completed ? "text-green-400" : currentLevel > 0 ? "text-accent-primary" : "text-text-muted"
                                                        )}>{currentLevel}</span>
                                                        <span className="text-text-muted text-xs">/{maxLevel}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleLevelChange(node.id, currentLevel + 1, maxLevel)}
                                                        disabled={currentLevel >= maxLevel}
                                                        className={cn(
                                                            "w-6 h-6 rounded flex items-center justify-center font-bold text-xs transition-colors",
                                                            currentLevel < maxLevel
                                                                ? !unlocked
                                                                    ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                                                                    : "bg-bg-secondary hover:bg-white/10"
                                                                : "text-text-muted cursor-not-allowed"
                                                        )}
                                                        title={!unlocked ? "Auto-unlock requirements" : ""}
                                                    >+</button>
                                                </div>

                                                {unlocked && currentLevel > 0 && (
                                                    <div className="text-[10px] mt-1 text-accent-secondary truncate animate-fade-in">
                                                        {formatStatDescription(effect, currentLevel)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {((activeTab === 'Clan' && Object.keys(guildPositionLibrary || {}).length === 0) || (activeTab !== 'Clan' && sortedLayers.length === 0)) && (
                <div className="text-center py-8 text-text-muted">
                    No nodes found for "{activeTab}"
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingReset}
                title="Reset Node?"
                message={`Are you sure? This will also reset ${pendingReset ? pendingReset.count - 1 : 0} dependent nodes.`}
                confirmText="Reset"
                cancelText="Cancel"
                variant="danger"
                onConfirm={() => {
                    if (pendingReset) {
                        executeLevelChange(pendingReset.nodeId, 0);
                        setPendingReset(null);
                    }
                }}
                onCancel={() => setPendingReset(null)}
            />

            {showImportModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}>
                    <div className="bg-bg-primary w-full max-w-2xl rounded-2xl border border-border shadow-2xl p-6 space-y-4 text-left">
                        <h3 className="text-xl font-bold text-text-primary">Import Clan Tech JSON</h3>
                        <p className="text-sm text-text-muted">Paste your Clan Tech JSON string below. This will overwrite your profile's Clan tech levels.</p>
                        <textarea
                            className="w-full h-64 bg-bg-input border border-border rounded-lg p-3 text-xs font-mono focus:border-accent-primary outline-none resize-none text-text-primary"
                            placeholder='{"ClanTech":{"0":5,"1":10}}'
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                        />
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="px-4 py-2 rounded-lg bg-bg-input border border-border hover:bg-white/5 text-xs font-bold transition-all text-text-primary"
                            >Cancel</button>
                            <button
                                onClick={importClanTech}
                                className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/80 text-white text-xs font-bold transition-all"
                            >Import</button>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
