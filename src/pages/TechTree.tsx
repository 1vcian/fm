import { useMemo, useState, useRef, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import { Hammer, Zap, Info, X, RefreshCw, Star, Plus, Minus, Download, Upload } from 'lucide-react';
import { getTechNodeName, getTechNodeDescription, getClanIconStyle } from '../utils/techUtils';
import { useTreeMode } from '../context/TreeModeContext';
import { useGameDataContext } from '../context/GameDataContext';
import { SpriteIcon } from '../components/UI/SpriteIcon';

const ICON_SIZE = 48;
const NODE_HEIGHT = 140;
const NODE_WIDTH = 200;
const LAYER_GAP = 80;
const COL_GAP = 40;

type TreeName = 'Forge' | 'Power' | 'SkillsPetTech' | 'Clan';

export default function TechTree() {
    const { profile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { treeMode } = useTreeMode();
    const { data: treeMapping, loading: l1 } = useGameData<any>('TechTreeMapping.json');
    const { data: treeEffects, loading: l2 } = useGameData<any>('TechTreeLibrary.json');
    const { data: upgradeLibrary, loading: l3 } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: clanIconsMap } = useGameData<any>('ClanTechTreeIconsMap.json');

    const [activeTab, setActiveTab] = useState<TreeName>('Forge');
    const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

    // Local simulation state - Synced to profile on load, but independent during edit
    const [localRanks, setLocalRanks] = useState<Record<string, Record<number, number>>>({});

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');

    const exportClanTech = () => {
        const ranks = activeTab === 'Clan' ? (localRanks['Clan'] || {}) : {};
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
            
            setLocalRanks(prev => ({
                ...prev,
                Clan: cleanRanks
            }));
            
            setShowImportModal(false);
            setImportText('');
            alert("Clan Tech ranks imported successfully!");
        } catch (e) {
            alert("Failed to parse JSON. Please verify the input.");
        }
    };

    const loading = l1 || l2 || l3 || (selectedVersion >= '2026_07_14_16_51' && (!guildPositionLibrary || !guildUpgradeLibrary));

    // Helper for formatting time
    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds.toFixed(0)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
        if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
        return `${(seconds / 86400).toFixed(1)}d`;
    };

    // Get tree data from mapping
    const treesData = useMemo(() => treeMapping?.trees || {}, [treeMapping]);
    
    const treeKeys = useMemo(() => {
        const keys: TreeName[] = ['Forge', 'Power', 'SkillsPetTech'];
        if (selectedVersion >= '2026_07_14_16_51') {
            keys.push('Clan');
        }
        return keys;
    }, [selectedVersion]);

    // Get all nodes for active tree
    const { nodes, nodeById, layers } = useMemo(() => {
        if (activeTab === 'Clan') {
            if (!guildPositionLibrary || !guildUpgradeLibrary) return { nodes: [], nodeById: {}, layers: {} };
            
            const all: any[] = [];
            const byId: Record<number, any> = {};
            const layerMap: Record<number, any[]> = {};
            
            let globalId = 0;
            Object.keys(guildPositionLibrary).forEach((category, catIdx) => {
                const nodesList = guildPositionLibrary[category].Nodes || [];
                nodesList.forEach((nodeType: string) => {
                    const upgradeDef = guildUpgradeLibrary[nodeType];
                    const nodeObj = {
                        id: globalId,
                        type: nodeType,
                        tier: catIdx, // map category to tier for compatibility
                        category: category,
                        requirements: [],
                        maxLevel: upgradeDef?.MaxLevel || 20
                    };
                    all.push(nodeObj);
                    byId[globalId] = nodeObj;
                    
                    if (!layerMap[catIdx]) layerMap[catIdx] = [];
                    layerMap[catIdx].push(nodeObj);
                    
                    globalId++;
                });
            });
            
            return { nodes: all, nodeById: byId, layers: layerMap };
        }

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
    }, [treesData, activeTab, guildPositionLibrary, guildUpgradeLibrary]);

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

        // Preload Clan tree if available
        if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
            const clanRanks: Record<number, number> = {};
            const profileData = profile.techTree?.Clan || {};
            let globalId = 0;
            for (const category of Object.keys(guildPositionLibrary)) {
                const nodesList = guildPositionLibrary[category].Nodes || [];
                for (const nodeType of nodesList) {
                    const upgradeDef = guildUpgradeLibrary[nodeType];
                    const maxLevel = upgradeDef?.MaxLevel || 20;

                    if (treeMode === 'max') {
                        clanRanks[globalId] = maxLevel;
                    } else if (treeMode === 'empty') {
                        clanRanks[globalId] = 0;
                    } else {
                        clanRanks[globalId] = profileData[globalId] || 0;
                    }
                    globalId++;
                }
            }
            allRanks['Clan'] = clanRanks;
        }

        setLocalRanks(allRanks);
    }, [treeMapping, profile.techTree, treeMode, treeEffects, selectedVersion, guildPositionLibrary, guildUpgradeLibrary]);

    // Calculate actual tree dimensions
    const treeDimensions = useMemo(() => {
        if (activeTab === 'Clan') return { width: 0, height: 0 };
        const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
        const height = (layerKeys.length) * (NODE_HEIGHT + LAYER_GAP) + 200; // Increased buffer
        const maxNodesInLayer = Math.max(...Object.values(layers).map(l => (l as any[]).length), 1);
        const width = maxNodesInLayer * (NODE_WIDTH + COL_GAP) + 600;
        return { width, height };
    }, [layers, activeTab]);

    // Calculate positions for graph
    const nodePositions = useMemo(() => {
        if (activeTab === 'Clan') return {};
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
    }, [layers, activeTab]);

    const getSpriteStyle = (node: any) => {
        if (activeTab === 'Clan') {
            // Look up the clan icon by node TYPE from the manual ClanTechTreeIconsMap.
            // Falls back to category-order row-major indexing when no mapping entry exists.
            const mapped = getClanIconStyle(node.type, clanIconsMap, selectedVersion, import.meta.env.BASE_URL, treeMapping);
            if (mapped) return mapped;

            if (!guildPositionLibrary) return null;
            const nodesList: string[] = [];
            for (const cat of Object.keys(guildPositionLibrary)) {
                if (guildPositionLibrary[cat]?.Nodes) {
                    nodesList.push(...guildPositionLibrary[cat].Nodes);
                }
            }
            const idx = nodesList.indexOf(node.type);
            if (idx === -1) return null;

            const col = idx % 8;
            const row = Math.floor(idx / 8);
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
        }

        if (!treeMapping || !node?.sprite_rect) return null;
        const { x, y, width, height } = node.sprite_rect;
        const sheetW = treeMapping.texture_size?.width || 1024;
        const sheetH = treeMapping.texture_size?.height || 1024;
        const scale = ICON_SIZE / width;
        const cssY = sheetH - y - height;
        const versionPath = selectedVersion ? `${selectedVersion}/` : '';

        return {
            backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: `${ICON_SIZE}px`,
            height: `${ICON_SIZE}px`,
        };
    };

    // Auto-center & Center Function
    const centerView = () => {
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const scrollX = (container.scrollWidth - container.clientWidth) / 2;
            const scrollY = 0; // Start at top
            container.scrollTo({ left: scrollX, top: scrollY, behavior: 'smooth' });
        }
    };

    useEffect(() => {
        const timeout = setTimeout(centerView, 100);
        return () => clearTimeout(timeout);
    }, [activeTab, loading, treeDimensions]);

    const handleLocalUpdate = (nodeId: number, delta: number) => {
        const node = nodeById[nodeId];
        if (!node) return;

        setLocalRanks(prev => {
            const newTreeRanks = { ...(prev[activeTab] || {}) };
            const currentRank = newTreeRanks[nodeId] || 0;

            let max = 5;
            if (activeTab === 'Clan') {
                max = node.maxLevel || 20;
            } else {
                const effect = treeEffects?.[node.type];
                max = effect?.MaxLevel || 1;
            }
            const newVal = Math.max(0, Math.min(max, currentRank + delta));

            // Auto-unlock requirements if increasing level
            if (delta > 0 && newVal > 0 && activeTab !== 'Clan') {
                const processed = new Set<number>();
                const unlockRecursive = (id: number) => {
                    if (processed.has(id)) return;
                    processed.add(id);

                    const n = nodeById[id];
                    if (!n) return;

                    if (n.requirements) {
                        n.requirements.forEach((reqId: number) => {
                            if ((newTreeRanks[reqId] || 0) === 0) {
                                newTreeRanks[reqId] = 1;
                                unlockRecursive(reqId);
                            }
                        });
                    }
                };
                unlockRecursive(nodeId);
            }

            newTreeRanks[nodeId] = newVal;

            // Validation 2: If downgraded to 0, prune all dependent nodes recursively (DFS)
            if (newVal === 0 && activeTab !== 'Clan') {
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

        // Max Clan tree if available
        if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
            const clanRanks: Record<number, number> = {};
            let globalId = 0;
            for (const category of Object.keys(guildPositionLibrary)) {
                const nodesList = guildPositionLibrary[category].Nodes || [];
                for (const nodeType of nodesList) {
                    const upgradeDef = guildUpgradeLibrary[nodeType];
                    clanRanks[globalId] = upgradeDef?.MaxLevel || 20;
                    globalId++;
                }
            }
            newGlobalState['Clan'] = clanRanks;
        }

        setLocalRanks(newGlobalState);
    };

    const maxOutCurrentTree = () => {
        if (activeTab === 'Clan') {
            setLocalRanks(prev => {
                const treeRanks: Record<number, number> = {};
                nodes.forEach(n => {
                    treeRanks[n.id] = n.maxLevel || 20;
                });
                return { ...prev, Clan: treeRanks };
            });
            return;
        }
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

        // Reset Clan tree
        if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
            const clanRanks: Record<number, number> = {};
            const profileData = profile.techTree?.Clan || {};
            let globalId = 0;
            for (const category of Object.keys(guildPositionLibrary)) {
                const nodesList = guildPositionLibrary[category].Nodes || [];
                for (const nodeType of nodesList) {
                    clanRanks[globalId] = profileData[globalId] || 0;
                    globalId++;
                }
            }
            newGlobalState['Clan'] = clanRanks;
        }

        setLocalRanks(newGlobalState);
    };

    // Dynamic Modifier Calculation logic re-implemented here to use localRanks
    const calculatedModifiers = useMemo(() => {
        if (!treeEffects || !techTreePositionLibrary || !treeMapping) return {};

        const mods: Record<string, number> = {};
        const trees: TreeName[] = ['Forge', 'Power', 'SkillsPetTech', 'Clan']; // Should match keys in localRanks/mapping

        trees.forEach(treeName => {
            const treeRanks = localRanks[treeName] || {};
            
            if (treeName === 'Clan') {
                if (!guildPositionLibrary || !guildUpgradeLibrary) return;
                
                // Flatten categories to get sequential node list mapping index -> type
                const nodesList: string[] = [];
                for (const cat of Object.keys(guildPositionLibrary)) {
                    if (guildPositionLibrary[cat]?.Nodes) {
                        nodesList.push(...guildPositionLibrary[cat].Nodes);
                    }
                }
                
                for (const [nodeIdStr, level] of Object.entries(treeRanks)) {
                    if (typeof level !== 'number' || level <= 0) continue;
                    const nodeId = parseInt(nodeIdStr);
                    const nodeType = nodesList[nodeId];
                    if (!nodeType) continue;
                    
                    const upgradeDef = guildUpgradeLibrary[nodeType];
                    if (!upgradeDef) continue;
                    
                    // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
                    const valPerLevel = upgradeDef.ValuePerLevel || 0;
                    const totalVal = valPerLevel * level;
                    
                    mods[nodeType] = (mods[nodeType] || 0) + totalVal;
                }
                return;
            }

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
    }, [localRanks, treeEffects, techTreePositionLibrary, treeMapping, guildPositionLibrary, guildUpgradeLibrary]);

    const calculateNodeStats = (node: any, currentRank: number) => {
        if (activeTab === 'Clan') {
            if (!guildUpgradeLibrary) return { totalTime: 0, remainingTime: 0, totalCost: 0, remainingCost: 0 };
            
            const upgradeDef = guildUpgradeLibrary[node.type];
            if (!upgradeDef) return { totalTime: 0, remainingTime: 0, totalCost: 0, remainingCost: 0 };
            
            const maxLevel = upgradeDef.MaxLevel || 20;
            const pointsPerLevel = upgradeDef.PointsPerLevel || 0;
            const totalCost = pointsPerLevel * maxLevel;
            const remainingCost = pointsPerLevel * Math.max(0, maxLevel - currentRank);
            
            return { totalTime: 0, remainingTime: 0, totalCost, remainingCost };
        }

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
    }, [nodes, localRanks, activeTab, upgradeLibrary, treeEffects, calculatedModifiers, guildUpgradeLibrary]);

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

        // Add Clan tree to globalStats
        if (selectedVersion >= '2026_07_14_16_51' && guildPositionLibrary && guildUpgradeLibrary) {
            const clanRanks = localRanks['Clan'] || {};
            nodes.forEach(node => {
                if (node.category) { // only Clan nodes have category here
                    const currentRank = clanRanks[node.id] || 0;
                    const stats = calculateNodeStats(node, currentRank);
                    globalTotal += stats.totalTime;
                    globalRemaining += stats.remainingTime;
                    globalTotalCost += stats.totalCost;
                    globalRemainingCost += stats.remainingCost;
                }
            });
        }

        return { globalTotal, globalRemaining, globalTotalCost, globalRemainingCost };
    }, [treeMapping, localRanks, upgradeLibrary, treeEffects, calculatedModifiers, selectedVersion, guildPositionLibrary, guildUpgradeLibrary, nodes]);

    const selectedNode = selectedNodeId !== null ? (nodeById[selectedNodeId] as any) : null;
    
    const selectedEffect = useMemo(() => {
        if (!selectedNode) return null;
        if (activeTab === 'Clan') {
            const nodeDef = treeEffects?.[selectedNode.type];
            const upgradeDef = guildUpgradeLibrary?.[selectedNode.type];
            if (!nodeDef || !upgradeDef) return null;

            // ValuePerLevel is already the effective value (x2 normalised at load, see useGameData)
            const valPerLevel = upgradeDef.ValuePerLevel || 0;

            return {
                Type: selectedNode.type,
                MaxLevel: upgradeDef.MaxLevel || 20,
                Stats: (nodeDef.Stats || []).map((stat: any) => ({
                    ...stat,
                    Value: valPerLevel,
                    ValueIncrease: valPerLevel
                }))
            };
        }
        return selectedNode ? treeEffects?.[selectedNode.type] : null;
    }, [selectedNode, activeTab, treeEffects, guildUpgradeLibrary]);

    return (
        <div className="h-[calc(100vh-120px)] flex flex-col animate-fade-in relative overflow-hidden">
            {/* Wiki Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-border pb-4 mb-4 shrink-0 px-2 sm:px-0">
                <div className="flex items-center gap-3 self-start md:self-center">
                    <div className="inline-block shrink-0 drop-shadow-md sm:w-[40px] sm:h-[40px] w-[32px] h-[32px]" role="img" aria-label="Potion" style={{
                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
                        backgroundPosition: '0px -40px',
                        backgroundSize: '320px 320px',
                        backgroundRepeat: 'no-repeat',
                        imageRendering: 'pixelated'
                    }} />
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                            Tech Wiki
                        </h1>
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-[10px] sm:text-xs text-text-muted font-bold mt-1">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                    <div className="inline-block shrink-0" role="img" aria-label="Timer" style={{
                                        width: '16px',
                                        height: '16px',
                                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                    {activeTab !== 'Clan' && (
                        <button
                            onClick={centerView}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-secondary/20 border border-accent-secondary/30 hover:bg-accent-secondary/30 text-accent-secondary text-[11px] font-bold transition-all"
                        >
                            <RefreshCw className="w-3 h-3" />
                            Center View
                        </button>
                    )}
                    <button
                        onClick={maxOutTree}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 text-accent-primary text-[11px] font-bold transition-all"
                    >
                        <Star className="w-3 h-3 fill-current" />
                        Max Everything
                    </button>
                    {activeTab === 'Clan' && (
                        <>
                            <button
                                onClick={exportClanTech}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/20 border border-accent-primary/30 hover:bg-accent-primary/30 text-accent-primary text-[11px] font-bold transition-all"
                            >
                                <Download className="w-3 h-3" />
                                Export Clan Tech
                            </button>
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-secondary/20 border border-accent-secondary/30 hover:bg-accent-secondary/30 text-accent-secondary text-[11px] font-bold transition-all"
                            >
                                <Upload className="w-3 h-3" />
                                Import Clan Tech
                            </button>
                        </>
                    )}
                </div>
            </Card>
 
            {
                loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-50">
                        <div className="w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full animate-spin mb-4" />
                        <span className="font-bold text-text-muted uppercase tracking-widest text-sm">Decoding Tech Mapping</span>
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden relative border border-border rounded-2xl bg-bg-secondary/10 backdrop-blur-sm">
                        {activeTab === 'Clan' ? (
                            <div className="flex-1 overflow-auto p-4 sm:p-6 custom-scrollbar space-y-8 select-none">
                                {Object.keys(guildPositionLibrary || {}).map((category, catIdx) => {
                                    const categoryNodes = nodes.filter(n => n.category === category);
                                    if (categoryNodes.length === 0) return null;

                                    return (
                                        <div key={category} className="space-y-4">
                                            <h3 className="text-sm font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent capitalize border-b border-white/5 pb-2">
                                                {category.replace(/([A-Z])/g, ' $1').trim()} Category
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                                {categoryNodes.map(node => {
                                                    const currentClanRanks = localRanks['Clan'] || {};
                                                    const currentRank = currentClanRanks[node.id] || 0;
                                                    const maxLevel = node.maxLevel;
                                                    const isMaxed = currentRank >= maxLevel;
                                                    const isResearched = currentRank > 0 && !isMaxed;
                                                    const isSelected = selectedNodeId === node.id;

                                                    const spriteStyle = getSpriteStyle(node);

                                                    const upgradeDef = guildUpgradeLibrary?.[node.type];
                                                    const pointsPerLevel = upgradeDef?.PointsPerLevel || 0;
                                                    const cost = pointsPerLevel * Math.max(0, maxLevel - currentRank);

                                                    return (
                                                        <button
                                                            key={node.id}
                                                            onClick={() => setSelectedNodeId(node.id)}
                                                            className={cn(
                                                                "text-left cursor-pointer transition-all duration-300 transform outline-none",
                                                                isSelected ? "scale-[1.02] z-20" : "hover:scale-[1.01]"
                                                            )}
                                                        >
                                                            <Card className={cn(
                                                                "p-4 flex gap-4 border-2 transition-colors relative group h-28 items-center",
                                                                isSelected ? "border-accent-primary bg-accent-primary/10 shadow-[0_0_20px_rgba(168,85,247,0.3)]" :
                                                                    isMaxed ? "border-green-500/50 bg-green-500/10 shadow-[0_0_10px_rgba(34,197,94,0.1)]" :
                                                                        isResearched ? "border-accent-primary/40 bg-accent-primary/5" : "border-border/50 bg-bg-primary/50"
                                                            )}>
                                                                <div className="w-12 h-12 rounded-xl bg-bg-input border border-border flex items-center justify-center relative overflow-hidden group shrink-0">
                                                                    {spriteStyle && <div style={spriteStyle} />}
                                                                    {isMaxed && (
                                                                        <div className="absolute inset-0 border-2 border-green-500/50 rounded-lg pointer-events-none" />
                                                                    )}
                                                                </div>

                                                                <div className="min-w-0 flex-1 flex flex-col justify-between h-full py-1">
                                                                    <div>
                                                                        <h4 className="text-xs font-bold text-text-primary whitespace-nowrap overflow-hidden text-clip">
                                                                            {getTechNodeName(node.type)}
                                                                        </h4>
                                                                        <p className="text-[9px] text-text-muted mt-0.5 font-bold uppercase tracking-tight">
                                                                            Rank {currentRank}/{maxLevel}
                                                                        </p>
                                                                    </div>

                                                                    <div className="flex items-center justify-between gap-2 mt-2">
                                                                        <div
                                                                            className="w-6 h-6 rounded bg-bg-secondary hover:bg-white/10 flex items-center justify-center border border-border cursor-pointer active:scale-95 shrink-0"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleLocalUpdate(node.id, -1);
                                                                            }}
                                                                        >
                                                                            <Minus className="w-3.5 h-3.5 text-white" />
                                                                        </div>

                                                                        <div className="text-[9px] font-mono text-text-muted flex items-center gap-1 font-bold">
                                                                            <SpriteIcon name="GuildPotions" size={12} />
                                                                            <span className="text-green-400">{pointsPerLevel.toLocaleString()}</span>
                                                                            <span className="opacity-60">/lvl</span>
                                                                            {cost > 0 && <span className="opacity-60">·</span>}
                                                                            {cost > 0 && <span>tot {cost.toLocaleString()}</span>}
                                                                        </div>

                                                                        <div
                                                                            className="w-6 h-6 rounded bg-bg-secondary hover:bg-white/10 flex items-center justify-center border border-border cursor-pointer active:scale-95 shrink-0"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleLocalUpdate(node.id, 1);
                                                                            }}
                                                                        >
                                                                            <Plus className="w-3.5 h-3.5 text-white" />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </Card>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div
                                ref={scrollContainerRef}
                                className="flex-1 overflow-auto relative custom-scrollbar select-none touch-pan-x touch-pan-y"
                            >
                                <div
                                    className="relative sm:[--tree-scale:1] [--tree-scale:0.8]"
                                    style={{
                                        width: `${treeDimensions.width}px`,
                                        height: `${treeDimensions.height}px`,
                                        transformOrigin: 'top center',
                                        scale: 'var(--tree-scale, 1)'
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
                                                        <div className="text-[10px] font-bold text-text-muted uppercase mb-0.5">Tier {node.tier + 1}</div>
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
                                                                    backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
                                                                    backgroundPosition: '-50px -30px',
                                                                    backgroundSize: '80px 80px',
                                                                    backgroundRepeat: 'no-repeat',
                                                                    imageRendering: 'pixelated'
                                                                }} />
                                                                {formatTime(nodeStats.remainingTime)}
                                                            </div>
                                                        </div>

                                                        <div
                                                            className={cn(
                                                                "w-6 h-6 rounded flex items-center justify-center border border-border cursor-pointer active:scale-95 transition-all",
                                                                (node.requirements || []).some((reqId: number) => (currentTreeRanks[reqId] || 0) <= 0)
                                                                    ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                                                                    : "bg-bg-secondary hover:bg-white/10 text-white"
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleLocalUpdate(node.id, 1);
                                                            }}
                                                            title={(node.requirements || []).some((reqId: number) => (currentTreeRanks[reqId] || 0) <= 0) ? "Auto-unlock requirements" : ""}
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </div>
                                                    </div>
                                                </Card>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

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
                                                            backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                                            backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                                            backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                                            backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
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
                                                            <span className="text-xs font-medium whitespace-nowrap overflow-hidden text-clip">{getTechNodeName(reqNode.type)}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'Clan' ? (
                                        <div className="pt-4 mt-4 border-t border-border">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Upgrade Costs</label>
                                            </div>
                                            <div className="bg-bg-input/50 rounded-xl border border-border p-3 flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1 text-text-muted font-bold">
                                                    <div className="inline-block shrink-0 drop-shadow-md" role="img" aria-label="Potion" style={{
                                                        width: '16px',
                                                        height: '16px',
                                                        backgroundImage: `url(${import.meta.env.BASE_URL}icons/game/Icons.png)`,
                                                        backgroundPosition: '0px -16px',
                                                        backgroundSize: '128px 128px',
                                                        backgroundRepeat: 'no-repeat',
                                                        imageRendering: 'pixelated'
                                                    }} />
                                                    <span>Cost per Level</span>
                                                </div>
                                                <span className="font-bold text-white font-mono">{guildUpgradeLibrary?.[selectedNode.type]?.PointsPerLevel?.toLocaleString()} Potions</span>
                                            </div>
                                        </div>
                                    ) : (
                                        upgradeLibrary && upgradeLibrary[selectedNode.tier] && (
                                            <div className="pt-4 mt-4 border-t border-border">
                                                <div className="flex items-center justify-between mb-2">
                                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Upgrade Costs (Tier {selectedNode.tier + 1})</label>
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
                                        )
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

            {showImportModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}>
                    <div className="bg-bg-primary w-full max-w-2xl rounded-2xl border border-border shadow-2xl p-6 space-y-4 text-left">
                        <h3 className="text-xl font-bold">Import Clan Tech Simulation JSON</h3>
                        <p className="text-sm text-text-muted">Paste your Clan Tech JSON string below.</p>
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
        </div >
    );
}
