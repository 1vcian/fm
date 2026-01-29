import { useMemo, useState, useRef, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import { Hammer, Zap, Info, X, RefreshCw, Star, Plus, Minus } from 'lucide-react';
import { getTechNodeName, getTechNodeDescription } from '../utils/techUtils';
import { useTreeMode } from '../context/TreeModeContext';

const ICON_SIZE = 48;
const NODE_HEIGHT = 140;
const NODE_WIDTH = 200;
const LAYER_GAP = 80;
const COL_GAP = 40;

type TreeName = 'Forge' | 'Power' | 'SkillsPetTech';

export default function TechTree() {
    const { profile } = useProfile();
    const { treeMode } = useTreeMode();
    const { data: treeMapping, loading: l1 } = useGameData<any>('TechTreeMapping.json');
    const { data: treeEffects, loading: l2 } = useGameData<any>('TechTreeLibrary.json');
    const { data: upgradeLibrary, loading: l3 } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');

    const [activeTab, setActiveTab] = useState<TreeName>('Forge');
    const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

    // Local simulation state - Synced to profile on load, but independent during edit
    const [localRanks, setLocalRanks] = useState<Record<string, Record<number, number>>>({});

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const loading = l1 || l2 || l3;

    // Helper for formatting time
    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds.toFixed(0)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
    };

    // Get tree data from mapping
    const treesData = useMemo(() => treeMapping?.trees || {}, [treeMapping]);
    const treeKeys = Object.keys(treesData);

    // Get all nodes for active tree
    const { nodes, nodeById, layers } = useMemo(() => {
        const tree = treesData[activeTab];
        const all = (tree?.nodes as any[]) || [];
        const byId: Record<number, any> = {};
        const layerMap: Record<number, any[]> = {};

        all.forEach(n => {
            byId[n.id] = n;
            if (!layerMap[n.layer]) layerMap[n.layer] = [];
            layerMap[n.layer].push(n);
        });

        return { nodes: all, nodeById: byId, layers: layerMap };
    }, [treesData, activeTab]);

    // Preload local simulation based on global Tree Mode (Header selection)
    useEffect(() => {
        if (!treeMapping || !treeEffects) return;

        const allRanks: Record<string, Record<number, number>> = {};
        const allTrees = treeMapping.trees || {};

        Object.keys(allTrees).forEach(key => {
            const treeNodes = allTrees[key].nodes || [];
            const profileData = profile.techTree[key as TreeName] || {};
            const treeRanks: Record<number, number> = {};

            treeNodes.forEach((n: any) => {
                if (treeMode === 'max') {
                    const effect = treeEffects?.[n.type];
                    treeRanks[n.id] = effect?.MaxLevel || 5;
                } else if (treeMode === 'empty') {
                    treeRanks[n.id] = 0;
                } else {
                    treeRanks[n.id] = profileData[n.id] || 0;
                }
            });
            allRanks[key] = treeRanks;
        });

        setLocalRanks(allRanks);
    }, [treeMapping, profile.techTree, treeMode, treeEffects]); // Removed activeTab dependency

    // Calculate actual tree dimensions
    const treeDimensions = useMemo(() => {
        const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
        const height = (layerKeys.length) * (NODE_HEIGHT + LAYER_GAP) + 200; // Increased buffer
        const maxNodesInLayer = Math.max(...Object.values(layers).map(l => (l as any[]).length), 1);
        const width = maxNodesInLayer * (NODE_WIDTH + COL_GAP) + 600;
        return { width, height };
    }, [layers]);

    // Calculate positions for graph
    const nodePositions = useMemo(() => {
        const positions: Record<number, { x: number; y: number }> = {};
        const sortedLayers = Object.keys(layers).map(Number).sort((a, b) => a - b);

        sortedLayers.forEach((layer, layerIdx) => {
            const nodesInLayer = layers[layer] as any[];
            const totalWidth = nodesInLayer.length * (NODE_WIDTH + COL_GAP) - COL_GAP;
            const startX = -totalWidth / 2;

            nodesInLayer.forEach((node: any, nodeIdx: number) => {
                positions[node.id] = {
                    x: startX + nodeIdx * (NODE_WIDTH + COL_GAP) + NODE_WIDTH / 2,
                    y: layerIdx * (NODE_HEIGHT + LAYER_GAP) + 120 // Increased top margin
                };
            });
        });

        return positions;
    }, [layers]);

    const getSpriteStyle = (node: any) => {
        if (!treeMapping || !node?.sprite_rect) return null;
        const { x, y, width, height } = node.sprite_rect;
        const sheetW = treeMapping.texture_size?.width || 1024;
        const sheetH = treeMapping.texture_size?.height || 1024;
        const scale = ICON_SIZE / width;
        const cssY = sheetH - y - height;

        return {
            backgroundImage: `url(./Texture2D/TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
        };
    };

    // Auto-center
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current;
                const scrollX = (container.scrollWidth - container.clientWidth) / 2;
                container.scrollTo({ left: scrollX, behavior: 'auto' });
            }
        }, 50);
        return () => clearTimeout(timeout);
    }, [activeTab, loading, treeDimensions]);

    const handleLocalUpdate = (nodeId: number, delta: number) => {
        const node = nodeById[nodeId];
        if (!node) return;

        const currentTreeRanks = localRanks[activeTab] || {};
        const currentRank = currentTreeRanks[nodeId] || 0;

        const effect = treeEffects?.[node.type];
        const max = effect?.MaxLevel || 1;
        const newVal = Math.max(0, Math.min(max, currentRank + delta));

        // Validation 1: Upgrading requires all requirements to be >= 1
        if (delta > 0 && newVal > 0) {
            const missingReqs = (node.requirements || []).filter((reqId: number) => (currentTreeRanks[reqId] || 0) <= 0);
            if (missingReqs.length > 0) {
                // Potential toast or feedback could go here
                return;
            }
        }

        setLocalRanks(prev => {
            const newTreeRanks = { ...(prev[activeTab] || {}) };
            newTreeRanks[nodeId] = newVal;

            // Validation 2: If downgraded to 0, prune all dependent nodes recursively (DFS)
            if (newVal === 0) {
                const pruneDescendants = (parentId: number) => {
                    nodes.forEach(n => {
                        if (n.requirements?.includes(parentId) && newTreeRanks[n.id] > 0) {
                            newTreeRanks[n.id] = 0;
                            pruneDescendants(n.id);
                        }
                    });
                };
                pruneDescendants(nodeId);
            }

            return { ...prev, [activeTab]: newTreeRanks };
        });
    };

    const maxOutTree = () => {
        if (!treeMapping) return;
        const newGlobalState: Record<string, Record<number, number>> = {};
        const allTrees = treeMapping.trees || {};

        Object.keys(allTrees).forEach(key => {
            const tree = allTrees[key];
            const treeRanks: Record<number, number> = {};
            (tree.nodes || []).forEach((n: any) => {
                const max = treeEffects?.[n.type]?.MaxLevel || 1;
                treeRanks[n.id] = max;
            });
            newGlobalState[key] = treeRanks;
        });

        setLocalRanks(newGlobalState);
    };

    const maxOutCurrentTree = () => {
        if (!treeMapping) return;
        setLocalRanks(prev => {
            const tree = treeMapping.trees[activeTab];
            const treeRanks: Record<number, number> = {};
            (tree.nodes || []).forEach((n: any) => {
                const max = treeEffects?.[n.type]?.MaxLevel || 1;
                treeRanks[n.id] = max;
            });
            return { ...prev, [activeTab]: treeRanks };
        });
    };

    const resetToProfile = () => {
        const newGlobalState: Record<string, Record<number, number>> = {};
        const allTrees = treeMapping?.trees || {};

        Object.keys(allTrees).forEach(key => {
            const profileData = profile.techTree[key as TreeName] || {};
            const treeRanks: Record<number, number> = {};
            (allTrees[key].nodes || []).forEach((n: any) => {
                treeRanks[n.id] = profileData[n.id] || 0;
            });
            newGlobalState[key] = treeRanks;
        });

        setLocalRanks(newGlobalState);
    };

    // Dynamic Modifier Calculation logic re-implemented here to use localRanks
    const calculatedModifiers = useMemo(() => {
        if (!treeEffects || !techTreePositionLibrary || !treeMapping) return {};

        const mods: Record<string, number> = {};
        const trees: TreeName[] = ['Forge', 'Power', 'SkillsPetTech']; // Should match keys in localRanks/mapping

        trees.forEach(treeName => {
            const treeRanks = localRanks[treeName] || {};
            const treeData = techTreePositionLibrary[treeName];
            if (!treeData?.Nodes) return;

            // Simple validity check: ensure requirements are met based on LOCAL ranks
            // Logic copied/adapted from useTreeModifiers but using localRanks
            const validityCache = new Map<number, boolean>();
            const checkValidity = (nodeId: number, visited = new Set<number>()): boolean => {
                if (validityCache.has(nodeId)) return validityCache.get(nodeId)!;
                if (visited.has(nodeId)) return false;

                const level = treeRanks[nodeId] || 0;
                if (level <= 0) {
                    validityCache.set(nodeId, false);
                    return false;
                }

                const nodeDef = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!nodeDef) {
                    validityCache.set(nodeId, false);
                    return false;
                }

                visited.add(nodeId);
                if (nodeDef.Requirements) {
                    for (const reqId of nodeDef.Requirements) {
                        if (!checkValidity(reqId, visited)) {
                            visited.delete(nodeId);
                            validityCache.set(nodeId, false);
                            return false;
                        }
                    }
                }

                visited.delete(nodeId);
                validityCache.set(nodeId, true);
                return true;
            };

            // Calculate stats for all valid nodes
            Object.keys(treeRanks).forEach(idStr => {
                const nodeId = parseInt(idStr);
                const level = treeRanks[nodeId];
                if (level > 0 && checkValidity(nodeId)) {
                    // Find type
                    const nodeDef = treeData.Nodes.find((n: any) => n.Id === nodeId);
                    if (nodeDef) {
                        const ef = treeEffects[nodeDef.Type];
                        if (ef?.Stats?.[0]) {
                            const base = ef.Stats[0].Value;
                            const inc = ef.Stats[0].ValueIncrease;
                            const val = base + (Math.max(0, level - 1) * inc);
                            mods[nodeDef.Type] = (mods[nodeDef.Type] || 0) + val;
                        }
                    }
                }
            });
        });
        return mods;
    }, [localRanks, treeEffects, techTreePositionLibrary, treeMapping]);

    const calculateNodeStats = (node: any, currentRank: number) => {
        if (!upgradeLibrary || !treeEffects) return { totalTime: 0, remainingTime: 0, totalCost: 0, remainingCost: 0 };

        const tier = node.tier;
        const effect = treeEffects[node.type];
        const maxLevel = effect?.MaxLevel || 1;
        const tierData = upgradeLibrary[tier];

        let totalTime = 0;
        let remainingTime = 0;
        let totalCost = 0;
        let remainingCost = 0;

        if (tierData?.Levels) {
            for (let l = 0; l < maxLevel; l++) {
                const levelData = tierData.Levels.find((L: any) => L.Level === l);
                if (!levelData) continue;

                const baseCost = levelData.Cost;
                const baseDuration = levelData.Duration;

                const costBonus = calculatedModifiers['TechNodeUpgradeCost'] || 0;
                const timeBonus = calculatedModifiers['TechResearchTimer'] || 0;

                const finalCost = Math.floor(baseCost * (1 - costBonus));
                const finalDuration = baseDuration / (1 + timeBonus);

                totalTime += finalDuration;
                totalCost += finalCost;

                if (l >= currentRank) {
                    remainingTime += finalDuration;
                    remainingCost += finalCost;
                }
            }
        }

        return { totalTime, remainingTime, totalCost, remainingCost };
    };

    const activeTreeStats = useMemo(() => {
        let treeTotalTime = 0;
        let treeRemainingTime = 0;
        let treeTotalCost = 0;
        let treeRemainingCost = 0;
        const currentTreeRanks = localRanks[activeTab] || {};

        nodes.forEach(node => {
            const currentRank = currentTreeRanks[node.id] || 0;
            const stats = calculateNodeStats(node, currentRank);
            treeTotalTime += stats.totalTime;
            treeRemainingTime += stats.remainingTime;
            treeTotalCost += stats.totalCost;
            treeRemainingCost += stats.remainingCost;
        });

        return { treeTotalTime, treeRemainingTime, treeTotalCost, treeRemainingCost };
    }, [nodes, localRanks, activeTab, upgradeLibrary, treeEffects, calculatedModifiers]);

    const globalStats = useMemo(() => {
        let globalTotal = 0;
        let globalRemaining = 0;
        let globalTotalCost = 0;
        let globalRemainingCost = 0;

        if (!treeMapping) return { globalTotal, globalRemaining, globalTotalCost, globalRemainingCost };

        const allTrees = treeMapping.trees || {};

        Object.keys(allTrees).forEach(key => {
            const treeNodes = allTrees[key].nodes || [];
            const treeRanks = localRanks[key] || {};

            treeNodes.forEach((node: any) => {
                const currentRank = treeRanks[node.id] || 0;
                const stats = calculateNodeStats(node, currentRank);
                globalTotal += stats.totalTime;
                globalRemaining += stats.remainingTime;
                globalTotalCost += stats.totalCost;
                globalRemainingCost += stats.remainingCost;
            });
        });

        return { globalTotal, globalRemaining, globalTotalCost, globalRemainingCost };
    }, [treeMapping, localRanks, upgradeLibrary, treeEffects, calculatedModifiers]);


    const selectedNode = selectedNodeId !== null ? (nodeById[selectedNodeId] as any) : null;
    const selectedEffect = selectedNode ? treeEffects?.[selectedNode.type] : null;

    return (
        <div className="h-[calc(100vh-120px)] flex flex-col animate-fade-in relative overflow-hidden">
            {/* Wiki Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-border pb-4 mb-4 shrink-0 px-2 sm:px-0">
                <div className="flex items-center gap-3 self-start md:self-center">
                    <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                        width: '40px',
                        height: '40px',
                        backgroundImage: 'url("./icons/game/Icons.png")',
                        backgroundPosition: '0px -40px',
                        backgroundSize: '320px 320px',
                        backgroundRepeat: 'no-repeat',
                        imageRendering: 'pixelated'
                    }} />
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                            Tech Wiki
                        </h1>
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-[10px] sm:text-xs text-text-muted font-bold">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                    <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                        width: '16px',
                                        height: '16px',
                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                        backgroundPosition: '-100px -60px',
                                        backgroundSize: '160px 160px',
                                        backgroundRepeat: 'no-repeat',
                                        imageRendering: 'pixelated'
                                    }} />
                                    <span>Selected Tree: {formatTime(activeTreeStats.treeTotalTime)} (Rem: {formatTime(activeTreeStats.treeRemainingTime)})</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                        width: '16px',
                                        height: '16px',
                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                        backgroundPosition: '0px -16px',
                                        backgroundSize: '128px 128px',
                                        backgroundRepeat: 'no-repeat',
                                        imageRendering: 'pixelated'
                                    }} />
                                    <span>Costs: {activeTreeStats.treeTotalCost.toLocaleString()} (Rem: {activeTreeStats.treeRemainingCost.toLocaleString()})</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-1 border-l border-white/10 pl-4">
                                <div className="flex items-center gap-1">
                                    <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                        width: '16px',
                                        height: '16px',
                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                        backgroundPosition: '-100px -60px',
                                        backgroundSize: '160px 160px',
                                        backgroundRepeat: 'no-repeat',
                                        imageRendering: 'pixelated'
                                    }} />
                                    <span>Global: {formatTime(globalStats.globalTotal)} (Rem: {formatTime(globalStats.globalRemaining)})</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                        width: '16px',
                                        height: '16px',
                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                        backgroundPosition: '0px -16px',
                                        backgroundSize: '128px 128px',
                                        backgroundRepeat: 'no-repeat',
                                        imageRendering: 'pixelated'
                                    }} />
                                    <span>Costs: {globalStats.globalTotalCost.toLocaleString()} (Rem: {globalStats.globalRemainingCost.toLocaleString()})</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-1 bg-bg-secondary/30 p-1 rounded-xl border border-border overflow-x-auto max-w-full no-scrollbar">
                        {treeKeys.map((treeKey) => (
                            <button
                                key={treeKey}
                                onClick={() => {
                                    setActiveTab(treeKey as TreeName);
                                    setSelectedNodeId(null);
                                    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg font-bold text-xs transition-all whitespace-nowrap",
                                    activeTab === treeKey
                                        ? "bg-accent-primary text-white shadow-lg"
                                        : "text-text-muted hover:text-text-primary hover:bg-white/5"
                                )}
                            >
                                {treeKey}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Simulation Controls */}
            <Card className="p-2 mb-4 flex flex-wrap items-center justify-between gap-3 border-accent-primary/20 shrink-0 bg-accent-primary/5">
                <div className="flex items-center gap-2 px-2 py-1">
                    <Info className="w-4 h-4 text-accent-primary" />
                    <span className="text-[11px] font-bold text-text-secondary uppercase">Simulation Mode</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={resetToProfile}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-input border border-border hover:bg-white/5 text-[11px] font-bold transition-all"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Reload My Profile
                    </button>
                    <button
                        onClick={maxOutCurrentTree}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 hover:bg-accent-primary/20 text-accent-primary text-[11px] font-bold transition-all"
                    >
                        <Zap className="w-3 h-3 fill-current" />
                        Max Tree
                    </button>
                    <button
                        onClick={maxOutTree}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 text-accent-primary text-[11px] font-bold transition-all"
                    >
                        <Star className="w-3 h-3 fill-current" />
                        Max Everything
                    </button>
                </div>
            </Card>

            {
                loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                        <div className="w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full animate-spin mb-4" />
                        <span className="font-bold text-text-muted uppercase tracking-widest text-sm">Decoding Tech Mapping...</span>
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden relative border border-border rounded-2xl bg-bg-secondary/10 backdrop-blur-sm">
                        {/* Tree Viewport */}
                        <div
                            ref={scrollContainerRef}
                            className="flex-1 overflow-auto relative custom-scrollbar select-none touch-pan-x touch-pan-y"
                        >
                            <div
                                className="relative"
                                style={{
                                    width: `${treeDimensions.width}px`,
                                    height: `${treeDimensions.height}px`
                                }}
                            >
                                {/* SVG Connections Layer */}
                                <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                                    <defs>
                                        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                            <stop offset="0%" stopColor="rgba(168, 85, 247, 0.4)" />
                                            <stop offset="100%" stopColor="rgba(168, 85, 247, 0.1)" />
                                        </linearGradient>
                                    </defs>
                                    {nodes.map(node => {
                                        const toPos = nodePositions[node.id];
                                        return (node.requirements || []).map((reqId: number) => {
                                            const fromPos = nodePositions[reqId];
                                            if (!fromPos || !toPos) return null;

                                            const startX = fromPos.x + (treeDimensions.width / 2);
                                            const startY = fromPos.y + NODE_HEIGHT / 2;
                                            const endX = toPos.x + (treeDimensions.width / 2);
                                            const endY = toPos.y - 10;
                                            const cpY = startY + (endY - startY) / 2;

                                            return (
                                                <path
                                                    key={`${reqId}-${node.id}`}
                                                    d={`M ${startX} ${startY} C ${startX} ${cpY}, ${endX} ${cpY}, ${endX} ${endY}`}
                                                    stroke="url(#lineGrad)"
                                                    strokeWidth="2"
                                                    fill="none"
                                                />
                                            );
                                        });
                                    })}
                                </svg>

                                {/* Nodes Layer */}
                                {nodes.map(node => {
                                    const pos = nodePositions[node.id];
                                    const currentTreeRanks = localRanks[activeTab] || {};
                                    const currentRank = currentTreeRanks[node.id] || 0;
                                    const effect = treeEffects?.[node.type];
                                    const maxLevel = effect?.MaxLevel || 1;
                                    const spriteStyle = getSpriteStyle(node);
                                    const isSelected = selectedNodeId === node.id;
                                    const isMaxed = currentRank >= maxLevel;
                                    const isResearched = currentRank > 0 && !isMaxed;

                                    const nodeStats = calculateNodeStats(node, currentRank);

                                    return (
                                        <button
                                            key={node.id}
                                            onClick={() => setSelectedNodeId(node.id)}
                                            className={cn(
                                                "absolute cursor-pointer transition-all duration-300 transform outline-none",
                                                isSelected ? "z-30 scale-110" : "z-10 hover:scale-105"
                                            )}
                                            style={{
                                                left: `${pos.x + (treeDimensions.width / 2) - NODE_WIDTH / 2}px`,
                                                top: `${pos.y - NODE_HEIGHT / 2}px`,
                                                width: `${NODE_WIDTH}px`
                                            }}
                                        >
                                            <Card className={cn(
                                                "p-3 h-full flex flex-col items-center text-center gap-2 border-2 transition-colors relative group",
                                                isSelected ? "border-accent-primary bg-accent-primary/10 shadow-[0_0_20px_rgba(168,85,247,0.3)]" :
                                                    isMaxed ? "border-green-500/50 bg-green-500/10 shadow-[0_0_10px_rgba(34,197,94,0.1)]" :
                                                        isResearched ? "border-accent-primary/40 bg-accent-primary/5" : "border-border/50 bg-bg-primary/50"
                                            )}>
                                                <div className="w-16 h-16 rounded-xl bg-bg-input border border-border flex items-center justify-center relative overflow-hidden group">
                                                    {spriteStyle ? (
                                                        <div style={spriteStyle} />
                                                    ) : (
                                                        activeTab === 'Power' ? <Zap className="w-8 h-8 text-yellow-500" /> : <Hammer className="w-8 h-8 text-blue-500" />
                                                    )}
                                                    {isMaxed && (
                                                        <div className="absolute inset-0 border-2 border-green-500/50 rounded-lg pointer-events-none" />
                                                    )}
                                                </div>

                                                <div className="min-w-0 w-full mb-6">
                                                    <div className="text-[10px] font-bold text-text-muted uppercase mb-0.5">Tier {node.tier}</div>
                                                    <h4 className="text-xs font-bold text-text-primary leading-tight line-clamp-2 min-h-[2.5em]">
                                                        {getTechNodeName(node.type)}
                                                    </h4>
                                                </div>

                                                {/* Node Controls */}
                                                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                                                    <div
                                                        className="w-6 h-6 rounded bg-bg-secondary hover:bg-white/10 flex items-center justify-center border border-border cursor-pointer active:scale-95"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleLocalUpdate(node.id, -1);
                                                        }}
                                                    >
                                                        <Minus className="w-3 h-3 text-white" />
                                                    </div>

                                                    <div className="flex flex-col items-center">
                                                        <div className={cn("font-mono font-bold text-xs",
                                                            isMaxed ? "text-green-500" :
                                                                isResearched ? "text-accent-primary" : "text-text-muted"
                                                        )}>
                                                            {currentRank}/{maxLevel}
                                                        </div>
                                                        {/* Time remaining for this specific node */}
                                                        <div className="text-[8px] text-text-muted flex items-center gap-1">
                                                            <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                                                width: '8px',
                                                                height: '8px',
                                                                backgroundImage: 'url("./icons/game/Icons.png")',
                                                                backgroundPosition: '-50px -30px',
                                                                backgroundSize: '80px 80px',
                                                                backgroundRepeat: 'no-repeat',
                                                                imageRendering: 'pixelated'
                                                            }} />
                                                            {formatTime(nodeStats.remainingTime)}
                                                        </div>
                                                    </div>

                                                    <div
                                                        className="w-6 h-6 rounded bg-bg-secondary hover:bg-white/10 flex items-center justify-center border border-border cursor-pointer active:scale-95"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleLocalUpdate(node.id, 1);
                                                        }}
                                                    >
                                                        <Plus className="w-3 h-3 text-white" />
                                                    </div>
                                                </div>
                                            </Card>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Detail Panel (Slide-in) */}
                        <div className={cn(
                            "absolute right-0 top-0 bottom-0 w-full sm:w-80 bg-bg-primary border-l border-border shadow-2xl z-40 transition-transform duration-300 overflow-y-auto",
                            selectedNode ? "translate-x-0" : "translate-x-full"
                        )}>
                            {selectedNode && (
                                <div className="p-6 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xl font-bold">Node Simulation</h3>
                                        <button onClick={() => setSelectedNodeId(null)} className="p-1 hover:bg-white/10 rounded-full">
                                            <X className="w-6 h-6" />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-4 bg-bg-secondary/50 p-4 rounded-2xl border border-border">
                                        <div className="w-16 h-16 rounded-xl bg-bg-input border border-border flex items-center justify-center shrink-0">
                                            {(() => {
                                                const spriteStyle = getSpriteStyle(selectedNode);
                                                return spriteStyle ? (
                                                    <div style={spriteStyle} />
                                                ) : (
                                                    activeTab === 'Power' ? <Zap className="w-8 h-8 text-yellow-500" /> : <Hammer className="w-8 h-8 text-blue-500" />
                                                );
                                            })()}
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-accent-primary uppercase">{activeTab} Tech</div>
                                            <h2 className="text-lg font-bold leading-tight">{getTechNodeName(selectedNode.type)}</h2>
                                        </div>
                                    </div>

                                    {/* Node Stats Summary */}
                                    {(() => {
                                        const currentTreeRanks = localRanks[activeTab] || {};
                                        const stats = calculateNodeStats(selectedNode, currentTreeRanks[selectedNode.id] || 0);
                                        return (
                                            <div className="grid grid-cols-2 gap-2 p-3 bg-accent-primary/5 rounded-xl border border-accent-primary/20">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                                            width: '20px',
                                                            height: '20px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '-100px -60px',
                                                            backgroundSize: '160px 160px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        <span className="text-[10px] uppercase font-bold text-text-muted">Total Time</span>
                                                    </div>
                                                    <span className="text-xs font-bold font-mono text-text-primary ml-4">{formatTime(stats.totalTime)}</span>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                                            width: '20px',
                                                            height: '20px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '-100px -60px',
                                                            backgroundSize: '160px 160px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        <span className="text-[10px] uppercase font-bold text-text-muted">Remaining Time</span>
                                                    </div>
                                                    <span className="text-xs font-bold font-mono text-accent-primary ml-4">{formatTime(stats.remainingTime)}</span>
                                                </div>
                                                <div className="flex flex-col gap-1 mt-2">
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                                            width: '24px',
                                                            height: '24px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '0px -24px',
                                                            backgroundSize: '192px 192px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        <span className="text-[10px] uppercase font-bold text-text-muted">Total Costs</span>
                                                    </div>
                                                    <span className="text-xs font-bold font-mono text-text-primary ml-4">{stats.totalCost.toLocaleString()}</span>
                                                </div>
                                                <div className="flex flex-col gap-1 mt-2">
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                                            width: '24px',
                                                            height: '24px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '0px -24px',
                                                            backgroundSize: '192px 192px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        <span className="text-[10px] uppercase font-bold text-text-muted">Remaining Costs</span>
                                                    </div>
                                                    <span className="text-xs font-bold font-mono text-accent-primary ml-4">{stats.remainingCost.toLocaleString()}</span>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 block">Function</label>
                                            <p className="text-sm text-text-secondary leading-relaxed bg-accent-primary/5 p-3 rounded-lg border border-accent-primary/20 italic">
                                                "{getTechNodeDescription(selectedNode.type, selectedEffect)}"
                                            </p>
                                        </div>

                                        {/* SIMULATION RANK CONTROL */}
                                        <div>
                                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3 block">Simulate Rank</label>
                                            <div className="flex items-center gap-4 bg-bg-input rounded-2xl p-2 border border-border">
                                                <button
                                                    onClick={() => handleLocalUpdate(selectedNode.id, -1)}
                                                    className="w-10 h-10 rounded-xl bg-bg-secondary hover:bg-white/5 flex items-center justify-center font-bold text-xl transition-colors"
                                                >-</button>
                                                <div className="flex-1 text-center">
                                                    <div className="text-2xl font-mono font-bold text-accent-primary">
                                                        {(localRanks[activeTab] || {})[selectedNode.id] || 0}
                                                    </div>
                                                    <div className="text-[9px] text-text-muted uppercase font-bold tracking-tighter">Level Rank</div>
                                                </div>
                                                <button
                                                    onClick={() => handleLocalUpdate(selectedNode.id, 1)}
                                                    className="w-10 h-10 rounded-xl bg-bg-secondary hover:bg-white/5 flex items-center justify-center font-bold text-xl transition-colors"
                                                >+</button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 block">Bonus Analytics</label>
                                            {selectedEffect?.Stats?.map((stat: any, i: number) => {
                                                const currentVal = (localRanks[activeTab] || {})[selectedNode.id] || 0;
                                                const maxLevel = selectedEffect.MaxLevel || 1;

                                                return (
                                                    <div key={i} className="bg-bg-input/50 rounded-xl border border-border p-4 space-y-3">
                                                        <div className="flex justify-between items-center text-xs">
                                                            <span className="text-text-muted font-bold">{stat.StatNode?.UniqueStat?.StatType}</span>
                                                            <span className="font-mono bg-accent-secondary/20 text-accent-secondary px-2 py-0.5 rounded text-[10px]">
                                                                {stat.StatNode?.UniqueStat?.StatNature}
                                                            </span>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div>
                                                                <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Simulated Rank</div>
                                                                <div className="text-base font-mono font-bold text-accent-primary">
                                                                    {stat.StatNode?.UniqueStat?.StatNature === 'Additive'
                                                                        ? `+${(stat.Value * currentVal).toFixed(1)}`
                                                                        : `+${(stat.Value * currentVal * 100).toFixed(2)}%`
                                                                    }
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div className="text-[10px] text-text-muted uppercase font-bold mb-1">Node Max</div>
                                                                <div className="text-base font-mono font-bold text-text-muted opacity-50">
                                                                    {stat.StatNode?.UniqueStat?.StatNature === 'Additive'
                                                                        ? `+${(stat.Value * maxLevel).toFixed(1)}`
                                                                        : `+${(stat.Value * maxLevel * 100).toFixed(2)}%`
                                                                    }
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {selectedNode.requirements?.length > 0 && (
                                        <div className="pt-2">
                                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2 block">Unlocks after:</label>
                                            <div className="space-y-1.5">
                                                {selectedNode.requirements.map((reqId: number) => {
                                                    const reqNode = nodeById[reqId] as any;
                                                    if (!reqNode) return null;
                                                    return (
                                                        <button
                                                            key={reqId}
                                                            onClick={() => setSelectedNodeId(reqId)}
                                                            className="w-full flex items-center gap-3 p-2 bg-bg-secondary/40 rounded-lg border border-border hover:border-accent-primary transition-colors text-left"
                                                        >
                                                            <Info className="w-4 h-4 text-accent-primary shrink-0" />
                                                            <span className="text-xs font-medium truncate">{getTechNodeName(reqNode.type)}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {upgradeLibrary && upgradeLibrary[selectedNode.tier] && (
                                        <div className="pt-4 mt-4 border-t border-border">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Upgrade Costs (Tier {selectedNode.tier})</label>
                                                <div className="flex gap-2 text-[9px] font-bold uppercase">
                                                    <span className="text-text-muted">Base</span>
                                                    <span className="text-accent-primary">My Cost</span>
                                                </div>
                                            </div>
                                            <div className="bg-bg-input/50 rounded-xl border border-border overflow-hidden">
                                                <div className="grid grid-cols-3 gap-2 p-2 bg-white/5 text-[10px] font-bold text-text-muted uppercase">
                                                    <div>Rank</div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                                            width: '16px',
                                                            height: '16px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '0px -16px',
                                                            backgroundSize: '128px 128px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        Cost (P)
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                                            width: '12px',
                                                            height: '12px',
                                                            backgroundImage: 'url("./icons/game/Icons.png")',
                                                            backgroundPosition: '-75px -45px',
                                                            backgroundSize: '120px 120px',
                                                            backgroundRepeat: 'no-repeat',
                                                            imageRendering: 'pixelated'
                                                        }} />
                                                        Time
                                                    </div>
                                                </div>
                                                {upgradeLibrary[selectedNode.tier].Levels.map((lvl: any, idx: number) => {
                                                    const rank = lvl.Level + 1;
                                                    const currentRank = (localRanks[activeTab] || {})[selectedNode.id] || 0;
                                                    const isUnlocked = currentRank >= rank;
                                                    const isNext = currentRank + 1 === rank;

                                                    const costBonus = calculatedModifiers['TechNodeUpgradeCost'] || 0;
                                                    const timeBonus = calculatedModifiers['TechResearchTimer'] || 0;

                                                    const myCost = Math.floor(lvl.Cost * (1 - costBonus));
                                                    const myDuration = lvl.Duration / (1 + timeBonus);

                                                    return (
                                                        <div key={idx} className={cn(
                                                            "grid grid-cols-3 gap-2 p-2 text-xs border-t border-border/50 font-mono",
                                                            isUnlocked ? "bg-accent-primary/10" :
                                                                isNext ? "bg-white/5" : ""
                                                        )}>
                                                            <div className={cn("font-bold", isUnlocked ? "text-accent-primary" : "text-text-muted")}>{rank}</div>
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-1 text-text-muted text-[10px] line-through decoration-white/30 opacity-70">
                                                                    {lvl.Cost}
                                                                </div>
                                                                <div className={cn("flex items-center gap-1 font-bold", isUnlocked ? "text-accent-secondary" : "text-white")}>
                                                                    <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                                                        width: '16px',
                                                                        height: '16px',
                                                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                                                        backgroundPosition: '0px -16px',
                                                                        backgroundSize: '128px 128px',
                                                                        backgroundRepeat: 'no-repeat',
                                                                        imageRendering: 'pixelated'
                                                                    }} />
                                                                    {myCost}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <div className="text-[10px] text-text-muted line-through decoration-white/30 opacity-70">
                                                                    {formatTime(lvl.Duration)}
                                                                </div>
                                                                <div className={cn("flex items-center gap-1 font-bold", isUnlocked ? "text-accent-secondary" : "text-white")}>
                                                                    <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                                                        width: '16px',
                                                                        height: '16px',
                                                                        backgroundImage: 'url("./icons/game/Icons.png")',
                                                                        backgroundPosition: '-100px -60px',
                                                                        backgroundSize: '160px 160px',
                                                                        backgroundRepeat: 'no-repeat',
                                                                        imageRendering: 'pixelated'
                                                                    }} />
                                                                    {formatTime(myDuration)}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-6 border-t border-border mt-4">
                                        <div className="text-[10px] text-text-muted text-center italic leading-tight">
                                            <b>READ ONLY:</b> Individual changes are for simulation only. To update your profile, use the Research panel.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {!selectedNode && (
                                <div className="h-full flex flex-col items-center justify-center p-12 text-center opacity-30">
                                    <Info className="w-16 h-16 mb-4" />
                                    <p className="text-sm font-bold uppercase tracking-widest leading-relaxed">Select a tech node to view function & simulate stats</p>
                                </div>
                            )}
                        </div>
                    </div >
                )
            }
        </div >
    );
}
