import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTreeOptimizer, TechUpgrade } from '../../hooks/useTreeOptimizer';
import { useTreePlanner } from '../../hooks/useTreePlanner';
import { useProfile } from '../../context/ProfileContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { useGameData } from '../../hooks/useGameData';
import { DndContext, closestCenter, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Cpu, RefreshCcw, Info, Trophy, Timer, CheckCircle, CheckCircle2, Calendar, Clock, Copy, ChevronUp, ChevronDown, ArrowUpDown, GripVertical, Plus, Trash2, Search, Play, Pause, List, Zap, Swords, Gauge, Hammer, Shield, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ConfirmModal } from '../../components/UI/ConfirmModal';
import { getWarDayIndex, isWarPointDay } from '../../utils/guildWarUtils';

function SortableItem({ id, children }: { id: string; children: (props: { listeners: any; isDragging: boolean }) => React.ReactNode }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.8 : undefined,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            {children({ listeners, isDragging })}
        </div>
    );
}

export default function TreeCalculator() {
    const {
        timeLimitHours, setTimeLimitHours,
        potions, setPotions,
        optimization,
        applyUpgrades,
        gemSkipCostPerSecond
    } = useTreeOptimizer();

    const planner = useTreePlanner();

    const { profile, updateNestedProfile } = useProfile();

    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');
    const NODE_ICON_SIZE = 40;

    // Tab state
    const [activeTab, setActiveTab] = useState<'optimizer' | 'planner'>('optimizer');

    // Planner UI state
    const [plannerTreeFilter, setPlannerTreeFilter] = useState<string>('all');
    const [plannerSearch, setPlannerSearch] = useState('');
    const [plannerConfirmDone, setPlannerConfirmDone] = useState<number | null>(null);

    // Auto-planner state
    const [autoPriorities, setAutoPriorities] = useState<Set<string>>(new Set(['war_points']));
    const [autoMaxSteps, setAutoMaxSteps] = useState(100);
    const [autoPotionBudget, setAutoPotionBudget] = useState(profile.misc.techPotions || 0);
    const [autoSleepStart, setAutoSleepStart] = useState(profile.misc.plannerSleepStart || '23:00');
    const [autoSleepEnd, setAutoSleepEnd] = useState(profile.misc.plannerSleepEnd || '07:00');
    const [autoMaxWait, setAutoMaxWait] = useState(profile.misc.plannerMaxWait || 120);
    const [autoMinWait, setAutoMinWait] = useState(profile.misc.plannerMinWaitBetweenNodes || 1);
    const [autoAllowedTrees, setAutoAllowedTrees] = useState<string[]>(['Forge', 'Power', 'SkillsPetTech']);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(interval);
    }, []);

    const toLocalDateTimeString = (date: Date) => {
        const tzOffset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
    };

    // Start Time for Schedule
    const [startTime, setStartTime] = useState(() => {
        const now = new Date();
        now.setSeconds(0, 0);
        return toLocalDateTimeString(now);
    });

    // End Time derived from Start Time + Time Limit
    const endTime = useMemo(() => {
        const start = new Date(startTime);
        const end = new Date(start.getTime() + timeLimitHours * 3600 * 1000);
        return toLocalDateTimeString(end);
    }, [startTime, timeLimitHours]);

    const handleEndTimeChange = (newEndStr: string) => {
        const start = new Date(startTime);
        const end = new Date(newEndStr);
        const diffHours = (end.getTime() - start.getTime()) / (3600 * 1000);
        setTimeLimitHours(Math.max(0, diffHours));
    };

    const formatScheduleTime = (date: Date) => {
        return new Intl.DateTimeFormat('it-IT', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    // Persist auto-planner settings to profile
    useEffect(() => {
        updateNestedProfile('misc', {
            techPotions: autoPotionBudget,
            plannerMaxSteps: autoMaxSteps,
            plannerSleepStart: autoSleepStart,
            plannerSleepEnd: autoSleepEnd,
            plannerMaxWait: autoMaxWait,
            plannerMinWaitBetweenNodes: autoMinWait
        });
    }, [autoPotionBudget, autoMaxSteps, autoSleepStart, autoSleepEnd, autoMaxWait, autoMinWait]);

    // --- REORDERING STATE ---
    const [orderedActions, setOrderedActions] = useState<TechUpgrade[]>([]);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        if (optimization?.actions) {
            const initial = [...optimization.actions];
            // Apply default Longest Sort (stable bubble sort)
            let changed = true;
            while(changed) {
                changed = false;
                for(let i=0; i < initial.length - 1; i++) {
                    if (initial[i].duration < initial[i+1].duration && !isPrerequisite(initial[i], initial[i+1])) {
                        [initial[i], initial[i+1]] = [initial[i+1], initial[i]];
                        changed = true;
                    }
                }
            }
            setOrderedActions(initial);
            setSortDirection('desc');
        }
    }, [optimization?.actions]);

    // Recalculate Gem Costs based on current order and Time Limit
    const actionsWithGemCosts = useMemo(() => {
        if (!orderedActions.length) return [];
        let accumulatedTimeSeconds = 0;
        const baseTimeLimitSeconds = timeLimitHours * 3600;
        const startTimestamp = new Date(startTime).getTime();

        return orderedActions.map(action => {
            const currentStartTime = accumulatedTimeSeconds;
            const currentEndTime = currentStartTime + action.duration;
            
            let recalculatedGemCost = 0;
            if (currentEndTime > baseTimeLimitSeconds && profile.misc.useGemsInCalculators) {
                const overlap = Math.min(action.duration, currentEndTime - Math.max(currentStartTime, baseTimeLimitSeconds));
                recalculatedGemCost = Math.ceil(overlap * gemSkipCostPerSecond);
            }

            const skipSeconds = recalculatedGemCost ? recalculatedGemCost / gemSkipCostPerSecond : 0;
            const effectiveDuration = Math.max(0, action.duration - skipSeconds);
            
            // Recalculate if it lands on a war day based on NEW completion time after reordering/gems
            const endObj = new Date(startTimestamp + (accumulatedTimeSeconds + effectiveDuration) * 1000);
            const isWarDayCurrent = isWarPointDay(endObj, 'tech');

            const result = {
                ...action,
                gemCost: recalculatedGemCost,
                effectiveDuration,
                isWarDay: isWarDayCurrent,
                warPoints: isWarDayCurrent ? action.points : 0
            };

            accumulatedTimeSeconds += effectiveDuration;
            return result;
        });
    }, [orderedActions, timeLimitHours, profile.misc.useGemsInCalculators, startTime, gemSkipCostPerSecond]);

    // Dependency Logic
    const isPrerequisite = (potentialReq: TechUpgrade, target: TechUpgrade) => {
        // 1. Same node lower level
        if (target.tree === potentialReq.tree && target.nodeId === potentialReq.nodeId) {
            return target.fromLevel === potentialReq.toLevel;
        }
        // 2. Parent node requirements
        if (target.fromLevel === 0 || target.fromLevel === 1) { // Only level 1 can have external requirements
             const nodeMapping = treeMapping?.trees?.[target.tree]?.nodes?.find((n: any) => n.id === target.nodeId);
             if (nodeMapping?.requirements?.includes(potentialReq.nodeId) && target.tree === potentialReq.tree && potentialReq.toLevel === 1) {
                 return true;
             }
        }
        return false;
    };

    const canMoveUp = (idx: number) => {
        if (idx <= 0) return false;
        return !isPrerequisite(actionsWithGemCosts[idx - 1], actionsWithGemCosts[idx]);
    };

    const canMoveDown = (idx: number) => {
        if (idx >= actionsWithGemCosts.length - 1) return false;
        return !isPrerequisite(actionsWithGemCosts[idx], actionsWithGemCosts[idx+1]);
    };

    const moveUp = (idx: number) => {
        if (!canMoveUp(idx)) return;
        const next = [...orderedActions];
        [next[idx], next[idx-1]] = [next[idx-1], next[idx]];
        setOrderedActions(next);
    };

    const moveDown = (idx: number) => {
        if (!canMoveDown(idx)) return;
        const next = [...orderedActions];
        [next[idx], next[idx+1]] = [next[idx+1], next[idx]];
        setOrderedActions(next);
    };

    const sortByDuration = () => {
        const nextDir = sortDirection === 'desc' ? 'asc' : 'desc';
        const next = [...orderedActions];
        
        // Stable prerequisite-aware bubble sort
        let changed = true;
        while(changed) {
            changed = false;
            for(let i=0; i < next.length - 1; i++) {
                const currentVal = next[i].duration;
                const nextVal = next[i+1].duration;
                
                const factor = nextDir === 'desc' ? -1 : 1;
                const shouldSwap = (currentVal - nextVal) * factor > 0;

                // Swap if order is wrong AND next is NOT a prerequisite of current
                if (shouldSwap && !isPrerequisite(next[i], next[i+1])) {
                    [next[i], next[i+1]] = [next[i+1], next[i]];
                    changed = true;
                }
            }
        }
        setOrderedActions(next);
        setSortDirection(nextDir);
    };

    // Selection State (now tracks IDs or similar since indices change)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingUpgrades, setPendingUpgrades] = useState<TechUpgrade[]>([]);

    const getActionId = (a: TechUpgrade) => `${a.tree}-${a.nodeId}-${a.toLevel}`;

    useEffect(() => {
        setSelectedIds(new Set());
    }, [optimization?.actions]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor)
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = orderedActions.findIndex(a => getActionId(a) === active.id);
        const newIndex = orderedActions.findIndex(a => getActionId(a) === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const newOrder = arrayMove(orderedActions, oldIndex, newIndex);

        // Validate dependencies
        for (let i = 0; i < newOrder.length; i++) {
            for (let j = i + 1; j < newOrder.length; j++) {
                if (isPrerequisite(newOrder[j], newOrder[i])) {
                    return; // Reject invalid order
                }
            }
        }
        setOrderedActions(newOrder);
    }, [orderedActions]);

    const isSelectable = (idx: number) => {
        const action = actionsWithGemCosts[idx];
        // Check all items BEFORE it in current order that might be prerequisites
        for(let i=0; i < idx; i++) {
            if (isPrerequisite(actionsWithGemCosts[i], action) && !selectedIds.has(getActionId(actionsWithGemCosts[i]))) {
                return false;
            }
        }
        return true;
    };

    const toggleSelection = (idx: number) => {
        const action = actionsWithGemCosts[idx];
        const id = getActionId(action);
        const next = new Set(selectedIds);
        
        if (next.has(id)) {
            // Uncheck cascading dependents
            const uncheckRecursive = (currentIdx: number) => {
                const currentAction = actionsWithGemCosts[currentIdx];
                const currentId = getActionId(currentAction);
                if (!next.has(currentId)) return;
                next.delete(currentId);
                
                // Find things after it that depend on it
                for(let i = currentIdx + 1; i < actionsWithGemCosts.length; i++) {
                    if (isPrerequisite(currentAction, actionsWithGemCosts[i])) {
                        uncheckRecursive(i);
                    }
                }
            };
            uncheckRecursive(idx);
        } else {
            if (!isSelectable(idx)) return;
            next.add(id);
        }
        setSelectedIds(next);
    };

    const handleApply = () => {
        const toApply = actionsWithGemCosts.filter(a => selectedIds.has(getActionId(a)));
        if (toApply.length === 0) return;

        setPendingUpgrades(toApply);
        setShowConfirmModal(true);
    };

    const confirmApply = () => {
        applyUpgrades(pendingUpgrades);
        setShowConfirmModal(false);
        setPendingUpgrades([]);
    };

    const formatTime = (totalSeconds: number) => {
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = Math.floor(totalSeconds % 60);
        
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0 || d > 0) parts.push(`${h}h`);
        if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
        parts.push(`${s}s`);
        
        return parts.join(' ');
    };

    const getSpriteStyle = (action: TechUpgrade | { sprite_rect: any }, size?: number) => {
        const rect = (action as any)?.sprite_rect;
        if (!treeMapping || !rect) return null;
        const { x, y, width, height } = rect;
        const sheetW = treeMapping.texture_size?.width || 1024;
        const sheetH = treeMapping.texture_size?.height || 1024;

        const targetSize = size || NODE_ICON_SIZE;
        const scale = targetSize / width;
        const cssY = sheetH - y - height;

        return {
            backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            backgroundRepeat: 'no-repeat' as const,
            width: `${targetSize}px`,
            height: `${targetSize}px`,
        };
    };

    const copyToClipboard = () => {
        if (!optimization?.actions) return;
        let text = "🚀 Tech Tree Upgrade Schedule\n\n";
        let currentAccumulated = 0;
        optimization.actions.forEach((action, idx) => {
            const skipSeconds = action.gemCost ? action.gemCost / gemSkipCostPerSecond : 0;
            const startObj = new Date(new Date(startTime).getTime() + currentAccumulated * 1000);
            text += `#${idx + 1} ${action.nodeName} (Lv.${action.fromLevel} -> ${action.toLevel})\n`;
            text += `   🔔 TRIGGER AT: ${formatScheduleTime(startObj)}\n\n`;
            currentAccumulated += Math.max(0, action.duration - skipSeconds);
        });
        navigator.clipboard.writeText(text);
    };

    const selectedPoints = useMemo(() => {
        return actionsWithGemCosts
            .filter(a => selectedIds.has(getActionId(a)))
            .reduce((sum, a) => sum + a.points, 0);
    }, [actionsWithGemCosts, selectedIds]);

    const selectedWarPoints = useMemo(() => {
        return actionsWithGemCosts
            .filter(a => selectedIds.has(getActionId(a)))
            .reduce((sum, a) => sum + (a.warPoints || 0), 0);
    }, [actionsWithGemCosts, selectedIds]);

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-[1400px] mx-auto px-4 lg:px-8">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}Texture2D/SkillTabIcon.png`} alt="Tech Tree" className="w-10 h-10 object-contain" />
                    Tree Calculator
                </h1>
                <p className="text-text-secondary">Maximize your Guild War points via optimal tech upgrades.</p>
            </div>

            {/* Tab Toggle */}
            <div className="flex justify-center mb-6">
                <div className="flex bg-bg-input rounded-xl p-1 border border-border gap-1">
                    <button
                        onClick={() => setActiveTab('optimizer')}
                        className={cn(
                            "px-6 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                            activeTab === 'optimizer' ? "bg-accent-primary text-black shadow-glow" : "text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Zap size={16} />
                        Optimizer
                    </button>
                    <button
                        onClick={() => setActiveTab('planner')}
                        className={cn(
                            "px-6 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center gap-2",
                            activeTab === 'planner' ? "bg-accent-primary text-black shadow-glow" : "text-text-muted hover:text-text-primary"
                        )}
                    >
                        <List size={16} />
                        Planner
                    </button>
                </div>
            </div>

            {activeTab === 'optimizer' && (
            <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-6 items-start">
                {/* INPUTS */}
                <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SpriteIcon name="Timer" size={20} className="text-text-tertiary" />
                            Optimization Constraints
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* SCHEDULE GROUP */}
                        <div className="space-y-4 p-4 bg-bg-primary/30 rounded-xl border border-white/5">
                            <h3 className="text-[10px] font-bold text-accent-primary uppercase tracking-widest flex items-center gap-2 mb-2">
                                <Calendar size={14} />
                                Race Schedule
                            </h3>
                            
                            <div className="grid grid-cols-1 gap-4">
                                {/* Start Time */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-bold text-text-secondary uppercase">Start Time</label>
                                        <div className="flex items-center gap-3">
                                            <button 
                                                onClick={() => {
                                                    const now = new Date();
                                                    now.setSeconds(0, 0);
                                                    setStartTime(toLocalDateTimeString(now));
                                                }}
                                                className="text-[9px] font-bold text-accent-primary hover:underline uppercase"
                                            >
                                                Now
                                            </button>
                                            <button 
                                                onClick={() => {
                                                    const target = new Date();
                                                    target.setHours(0, 0, 0, 0);
                                                    if (target < new Date()) {
                                                        target.setDate(target.getDate() + 1);
                                                    }
                                                    setStartTime(toLocalDateTimeString(target));
                                                }}
                                                className="text-[9px] font-bold text-accent-secondary hover:underline uppercase"
                                            >
                                                0.00
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 bg-bg-input border border-border rounded-lg px-3 py-2.5 group focus-within:border-accent-primary transition-colors min-h-[48px]">
                                        <Clock size={18} className="text-text-tertiary group-focus-within:text-accent-primary opacity-50 shrink-0" />
                                        <input
                                            type="datetime-local"
                                            value={startTime}
                                            onChange={(e) => setStartTime(e.target.value)}
                                            onFocus={(e) => (e.target as HTMLInputElement).showPicker()}
                                            onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                                            step="60"
                                            className="w-full bg-transparent border-none text-white text-[15px] outline-none"
                                            style={{ colorScheme: 'dark' }}
                                        />
                                    </div>
                                </div>

                                {/* End Time */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-bold text-text-secondary uppercase">End Time</label>
                                        <button 
                                            onClick={() => {
                                                const start = new Date(startTime);
                                                const target = new Date(start);
                                                target.setHours(23, 59, 0, 0);
                                                
                                                // If start is already past 23:59 of that day, go to the next day
                                                if (start.getTime() >= target.getTime()) {
                                                    target.setDate(target.getDate() + 1);
                                                }
                                                
                                                handleEndTimeChange(toLocalDateTimeString(target));
                                            }}
                                            className="text-[9px] font-bold text-accent-primary hover:underline uppercase"
                                        >
                                            Set 23:59
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-3 bg-bg-input border border-border rounded-lg px-3 py-2.5 group focus-within:border-accent-primary transition-colors min-h-[48px]">
                                        <CheckCircle2 size={18} className="text-text-tertiary group-focus-within:text-accent-primary opacity-50 shrink-0" />
                                        <input
                                            type="datetime-local"
                                            value={endTime}
                                            onChange={(e) => handleEndTimeChange(e.target.value)}
                                            onFocus={(e) => (e.target as HTMLInputElement).showPicker()}
                                            onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                                            step="60"
                                            className="w-full bg-transparent border-none text-white text-[15px] outline-none"
                                            style={{ colorScheme: 'dark' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Duration Display/Input */}
                            <div className="space-y-2 pt-2 border-t border-white/5">
                                <label className="text-[10px] font-bold text-text-secondary uppercase flex items-center gap-2">
                                    <Timer size={12} />
                                    Duration (Time Limit)
                                </label>
                                <div className="flex gap-3">
                                    {/* Hours */}
                                    <div className="relative group flex-1">
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full bg-bg-input border border-border rounded-lg py-2 px-3 text-white font-mono text-sm font-bold focus:border-accent-primary outline-none transition-colors"
                                            value={Math.floor(timeLimitHours)}
                                            onChange={(e) => {
                                                const h = parseInt(e.target.value) || 0;
                                                const m = Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60);
                                                setTimeLimitHours(h + (m / 60));
                                            }}
                                            placeholder="0"
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-muted pointer-events-none">h</span>
                                    </div>

                                    {/* Minutes */}
                                    <div className="relative group flex-1">
                                        <input
                                            type="number"
                                            min="0"
                                            max="59"
                                            className="w-full bg-bg-input border border-border rounded-lg py-2 px-3 text-white font-mono text-sm font-bold focus:border-accent-primary outline-none transition-colors"
                                            value={Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60)}
                                            onChange={(e) => {
                                                const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                                const h = Math.floor(timeLimitHours);
                                                setTimeLimitHours(h + (m / 60));
                                            }}
                                            placeholder="0"
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-muted pointer-events-none">m</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Potion Input */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
                                <SpriteIcon name="Potion" size={16} />
                                Available Potions
                            </label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                    <SpriteIcon name="Potion" size={24} className="opacity-50" />
                                </div>
                                <input
                                    type="number"
                                    value={potions}
                                    onChange={(e) => setPotions(Number(e.target.value))}
                                    className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                    placeholder="0"
                                    min="0"
                                />
                            </div>
                        </div>

                        {/* Gem Speedup */}
                        <div className="space-y-3 pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <SpriteIcon name="GemSquare" size={16} />
                                    <span className="text-xs font-bold text-text-secondary uppercase">Gem Time Skips</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={profile.misc.useGemsInCalculators}
                                        onChange={(e) => updateNestedProfile('misc', { useGemsInCalculators: e.target.checked })}
                                    />
                                    <div className="w-9 h-5 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-primary"></div>
                                </label>
                            </div>

                            {profile.misc.useGemsInCalculators && (
                                <div className="relative group animate-in fade-in slide-in-from-top-2">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                        <SpriteIcon name="GemSquare" size={20} className="opacity-50" />
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        className="w-full bg-bg-input border border-border rounded-xl py-3 pl-12 pr-4 text-white font-mono text-lg font-bold focus:border-accent-primary outline-none transition-colors"
                                        value={profile.misc.gemCount}
                                        onChange={(e) => updateNestedProfile('misc', { gemCount: Math.max(0, parseInt(e.target.value) || 0) })}
                                        placeholder=" Gems"
                                    />
                                    {optimization && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-text-secondary">
                                            <span className={(optimization.totalGemsUsed || 0) > profile.misc.gemCount ? "text-error" : "text-accent-primary"}>
                                                {optimization.totalGemsUsed}
                                            </span>
                                            <span className="mx-1">/</span>
                                            <span>{profile.misc.gemCount}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-accent-primary/5 rounded-lg border border-accent-primary/20 flex gap-3 items-start">
                            <Info size={16} className="text-accent-primary shrink-0 mt-0.5" />
                            <p className="text-[11px] text-text-secondary leading-relaxed">
                                Use the arrows on the right to reorder upgrades based on your schedule. Reordering is blocked if it violates game prerequisites.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* RESULTS */}
                <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 relative overflow-hidden flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-accent-primary">
                            <RefreshCcw className="w-5 h-5" />
                            Optimization Results
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-6 relative z-10 flex-1 flex flex-col min-h-0">
                        {optimization && actionsWithGemCosts.length > 0 ? (
                            <>
                                {/* Stats Summary */}
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 lg:gap-4">
                                    <div className="p-4 bg-bg-primary rounded-xl border border-accent-primary/20 md:col-span-2 shadow-lg shadow-accent-primary/5">
                                        <div className="text-[10px] text-accent-primary font-black uppercase tracking-widest mb-1 flex items-center justify-between">
                                            <span>War Points (Completion)</span>
                                            <Trophy size={14} />
                                        </div>
                                        <div className="flex items-baseline gap-2">
                                            <div className="text-3xl font-black text-white">
                                                {Math.floor(selectedWarPoints).toLocaleString()}
                                            </div>
                                            {selectedWarPoints < (optimization.totalWarPoints || 0) && (
                                                <div className="text-[10px] text-text-muted font-bold">
                                                    / {Math.floor(optimization.totalWarPoints || 0).toLocaleString()}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-[9px] text-text-muted mt-1">
                                            Tree Points: {Math.floor(selectedPoints).toLocaleString()}
                                            {selectedPoints < optimization.totalPoints && (
                                                <span> / {Math.floor(optimization.totalPoints).toLocaleString()}</span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="bg-bg-tertiary/50 p-4 rounded-xl border border-white/5 flex flex-col justify-center">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-1 flex items-center gap-1">
                                            <Timer size={10} />
                                            Time Used
                                        </div>
                                        <div className="text-lg font-mono font-bold text-white leading-none">
                                            {formatTime(optimization.timeUsed * 3600)}
                                        </div>
                                    </div>

                                    <div className="bg-bg-tertiary/50 p-4 rounded-xl border border-white/5 flex flex-col justify-center">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-1 flex items-center gap-1">
                                            <SpriteIcon name="Potion" size={12} />
                                            Potions
                                        </div>
                                        <div className="text-lg font-mono font-bold text-accent-secondary leading-none">
                                            {Math.floor(optimization.potionsUsed).toLocaleString()}
                                        </div>
                                    </div>
                                </div>

                                {/* Action Plan */}
                                <div className="space-y-3 flex-1 flex flex-col min-h-0">
                                    <div className="flex justify-between items-center text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                        <div className="flex items-center gap-3">
                                            <span>Recommended Upgrade Path</span>
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={copyToClipboard}
                                                    className="flex items-center gap-1.5 px-2 py-0.5 bg-accent-primary/5 hover:bg-accent-primary/10 text-accent-primary rounded transition-colors"
                                                    title="Copy schedule to clipboard"
                                                >
                                                    <Copy size={12} />
                                                    Copy
                                                </button>
                                                <button 
                                                    onClick={sortByDuration}
                                                    className="flex items-center gap-1.5 px-2 py-0.5 bg-accent-secondary/10 hover:bg-accent-secondary/20 text-accent-secondary rounded transition-colors"
                                                    title={`Sort by Duration (${sortDirection === 'desc' ? 'Next: Ascending' : 'Next: Descending'})`}
                                                >
                                                    <ArrowUpDown size={12} className={cn(sortDirection === 'asc' ? "rotate-180" : "", "transition-transform duration-300")} />
                                                    {sortDirection === 'desc' ? 'Duration (Longest)' : 'Duration (Shortest)'}
                                                </button>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const allIds = actionsWithGemCosts.map(getActionId);
                                                if (selectedIds.size === actionsWithGemCosts.length) setSelectedIds(new Set());
                                                else setSelectedIds(new Set(allIds));
                                            }}
                                            className="text-accent-primary hover:underline lowercase bg-accent-primary/5 px-2 py-0.5 rounded transition-colors"
                                        >
                                            {selectedIds.size === actionsWithGemCosts.length ? 'Desel All' : 'Select All'}
                                        </button>
                                    </div>
                                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                        <SortableContext items={orderedActions.map(getActionId)} strategy={verticalListSortingStrategy}>
                                            <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
                                                {(() => {
                                                    let currentAccumulated = 0;
                                                    const baseTimeLimitSeconds = timeLimitHours * 3600;

                                                    return orderedActions.map((action, idx) => {
                                                        let recalculatedGemCost = 0;
                                                        const currentStartTimeSec = currentAccumulated;
                                                        const currentEndTime = currentStartTimeSec + action.duration;
                                                        
                                                        if (currentEndTime > baseTimeLimitSeconds && profile.misc.useGemsInCalculators) {
                                                            const overlap = Math.min(action.duration, currentEndTime - Math.max(currentStartTimeSec, baseTimeLimitSeconds));
                                                            recalculatedGemCost = Math.ceil(overlap * gemSkipCostPerSecond);
                                                        }

                                                        const skipSeconds = recalculatedGemCost ? recalculatedGemCost / gemSkipCostPerSecond : 0;
                                                        const effectiveDuration = Math.max(0, action.duration - skipSeconds);
                                                        
                                                        const startObj = new Date(new Date(startTime).getTime() + currentAccumulated * 1000);
                                                        const endObj = new Date(startObj.getTime() + effectiveDuration * 1000);
                                                        
                                                        currentAccumulated += effectiveDuration;

                                                        const isDifferentDay = startObj.getDate() !== endObj.getDate();
                                                        const id = getActionId(action);
                                                        // Recalculate war day based on actual completion time (after reordering)
                                                        const isWarDayNow = isWarPointDay(endObj, 'tech');

                                                        return (
                                                            <SortableItem key={id} id={id}>
                                                                {({ listeners, isDragging }) => (
                                                                    <div
                                                                        className={cn(
                                                                            "flex gap-3 p-3 rounded bg-bg-tertiary/50 border border-white/5 transition-all relative group",
                                                                            isDragging && "shadow-2xl shadow-accent-primary/20 ring-2 ring-accent-primary/30",
                                                                            selectedIds.has(id)
                                                                                ? "border-accent-primary/40 bg-accent-primary/5"
                                                                                : isSelectable(idx)
                                                                                    ? "opacity-80 border-white/10"
                                                                                    : "opacity-30 grayscale bg-black/40"
                                                                        )}
                                                                    >
                                                                        {/* Drag Handle */}
                                                                        <div 
                                                                            {...listeners} 
                                                                            className="flex items-center cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-accent-primary/50 transition-colors touch-none"
                                                                        >
                                                                            <GripVertical size={20} />
                                                                        </div>

                                                                        <div className="flex flex-col items-center shrink-0 w-8">
                                                                            <div className={cn(
                                                                                "text-[10px] font-bold w-full text-center py-0.5 rounded border mb-2 transition-colors",
                                                                                selectedIds.has(id)
                                                                                    ? "text-accent-primary bg-accent-primary/10 border-accent-primary/20"
                                                                                    : "text-text-muted bg-white/5 border-white/5"
                                                                            )}>
                                                                                #{idx + 1}
                                                                            </div>
                                                                            <div 
                                                                                onClick={() => toggleSelection(idx)}
                                                                                className="w-10 h-10 shrink-0 rounded-lg overflow-hidden border border-white/5 bg-black/20 relative cursor-pointer"
                                                                            >
                                                                                {getSpriteStyle(action) ? (
                                                                                    <div style={getSpriteStyle(action)!} className="w-full h-full" />
                                                                                ) : (
                                                                                    <div className="w-full h-full flex items-center justify-center">
                                                                                        <Cpu size={20} className="text-text-muted" />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        
                                                                        <div className="flex-1 min-w-0" onClick={() => toggleSelection(idx)}>
                                                                            <div className="flex justify-between items-start mb-1 cursor-pointer">
                                                                                <span className="text-sm font-bold text-white truncate pr-2">
                                                                                    {action.nodeName}
                                                                                </span>
                                                                                <div className="flex items-center gap-2 text-right">
                                                                                    <div className="flex flex-col items-end">
                                                                                        <div className="flex items-center gap-1 text-[9px] font-bold text-accent-primary uppercase">
                                                                                            <Clock size={8} /> {formatScheduleTime(startObj)}
                                                                                        </div>
                                                                                        <div className="flex items-center gap-1 text-[9px] font-bold text-text-muted uppercase">
                                                                                            <CheckCircle2 size={8} /> {formatScheduleTime(endObj)}
                                                                                            {isDifferentDay && <span className="text-[8px] text-accent-secondary ml-0.5">+{endObj.getDate() - startObj.getDate()}d</span>}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className={cn(
                                                                                        "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                                                                                        selectedIds.has(id) ? "bg-accent-primary border-accent-primary" : "border-white/20"
                                                                                    )}>
                                                                                        {selectedIds.has(id) && <CheckCircle2 size={12} className="text-bg-primary" />}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                            <div className="flex items-center gap-2 text-[10px] text-text-muted mb-2 cursor-pointer">
                                                                                <span className="bg-white/5 px-1.5 rounded">Lv.{action.fromLevel} → Lv.{action.toLevel}</span>
                                                                                <span>•</span>
                                                                                <span className="text-accent-primary/80">{action.tree}</span>
                                                                                <span className="ml-auto font-mono text-accent-secondary">Tier {action.tier + 1}</span>
                                                                            </div>
                                                                            <div className="flex justify-between items-center text-[11px] font-mono border-t border-white/5 pt-2">
                                                                                <div className="flex items-center gap-3">
                                                                                    <div className={cn("flex items-center gap-1", recalculatedGemCost > 0 ? "text-accent-primary" : "")}>
                                                                                        <Timer size={10} className="opacity-50" />
                                                                                        {formatTime(effectiveDuration)}
                                                                                        {recalculatedGemCost > 0 && <span className="text-[8px] opacity-70 underline">Gems used</span>}
                                                                                    </div>
                                                                                    <div className="flex items-center gap-1">
                                                                                        <SpriteIcon name="Potion" size={10} />
                                                                                        {action.cost}
                                                                                    </div>
                                                                                </div>
                                                                                <div className={cn("font-bold flex items-center gap-1", isWarDayNow ? "text-accent-primary" : "text-text-muted")}>
                                                                                    +{action.points.toLocaleString()} pts
                                                                                    {isWarDayNow && <span className="text-[7px] bg-accent-primary/20 text-accent-primary px-1 py-0.5 rounded font-black uppercase">WAR</span>}
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Manual Controls */}
                                                                        <div className="flex flex-col gap-1 shrink-0 justify-center">
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); moveUp(idx); }}
                                                                                disabled={!canMoveUp(idx)}
                                                                                className="p-1 hover:bg-white/10 rounded disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                                                                            >
                                                                                <ChevronUp size={16} className="text-accent-primary" />
                                                                            </button>
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); moveDown(idx); }}
                                                                                disabled={!canMoveDown(idx)}
                                                                                className="p-1 hover:bg-white/10 rounded disabled:opacity-20 disabled:hover:bg-transparent transition-colors"
                                                                            >
                                                                                <ChevronDown size={16} className="text-accent-primary" />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </SortableItem>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </SortableContext>
                                    </DndContext>

                                    <button
                                        onClick={handleApply}
                                        disabled={selectedIds.size === 0}
                                        className="w-full py-4 bg-accent-primary text-bg-primary font-black uppercase tracking-tighter rounded-xl hover:bg-accent-primary/90 disabled:opacity-50 disabled:grayscale transition-all shadow-xl shadow-accent-primary/10 mt-2 flex items-center justify-center gap-2 group"
                                    >
                                        <CheckCircle size={20} className="group-hover:scale-110 transition-transform" />
                                        Apply Selected Upgrades
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-text-muted gap-3 text-center px-6">
                                <Info className="w-10 h-10 opacity-20" />
                                <div>
                                    <p className="font-bold">No upgrades found</p>
                                    <p className="text-sm opacity-60 mt-1">Increase your time limit or potions budget to see the optimal upgrade path.</p>
                                </div>
                            </div>
                        )}
                    </CardContent>

                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/SkillTabIcon.png`} alt="" className="w-64 h-64 object-contain grayscale" />
                    </div>
                </Card>
            </div>
            )}

            {/* ========== PLANNER TAB ========== */}
            {activeTab === 'planner' && (
            <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-6 items-start">
                {/* LEFT: Planner Controls */}
                <div className="space-y-6">
                    {/* Start Date */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar size={20} className="text-text-tertiary" />
                                Plan Settings
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-text-secondary uppercase">Start Date</label>
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            now.setSeconds(0, 0);
                                            planner.setPlanStartDate(toLocalDateTimeString(now));
                                        }}
                                        className="text-[9px] font-bold text-accent-primary hover:underline uppercase"
                                    >Now</button>
                                </div>
                                <div className="flex items-center gap-3 bg-bg-input border border-border rounded-lg px-3 py-2.5 group focus-within:border-accent-primary transition-colors min-h-[48px]">
                                    <Clock size={18} className="text-text-tertiary group-focus-within:text-accent-primary opacity-50 shrink-0" />
                                    <input
                                        type="datetime-local"
                                        value={planner.planStartDate}
                                        onChange={(e) => planner.setPlanStartDate(e.target.value)}
                                        onFocus={(e) => (e.target as HTMLInputElement).showPicker()}
                                        onClick={(e) => (e.target as HTMLInputElement).showPicker()}
                                        step="60"
                                        className="w-full bg-transparent border-none text-white text-[15px] outline-none"
                                        style={{ colorScheme: 'dark' }}
                                    />
                                </div>
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-3 gap-2 pt-2">
                                <div className="bg-bg-primary/50 rounded-xl p-3 text-center border border-white/5 shadow-inner flex flex-col justify-center">
                                    <div className="text-[10px] text-text-muted uppercase font-black mb-1 flex items-center justify-center gap-1 tracking-widest">Points</div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-xl font-black text-white leading-none mb-0.5">{planner.summary.totalPoints.toLocaleString()}</div>
                                        <div className="text-[10px] font-black text-accent-primary flex items-center gap-1 bg-accent-primary/10 px-1.5 py-0.5 rounded-full border border-accent-primary/20" title="Points earned during Guild War days">
                                            <Trophy size={10} /> {planner.summary.totalWarPoints.toLocaleString()} War
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-bg-primary/50 rounded-xl p-3 text-center border border-accent-primary/10 shadow-glow-sm shadow-accent-primary/5">
                                    <div className="text-[10px] text-accent-primary uppercase font-black mb-1 flex items-center justify-center gap-1 tracking-widest"><Timer size={10} />Time</div>
                                    <div className="text-xl font-black text-white drop-shadow-sm leading-none">
                                        {(() => {
                                            const totalSecs = planner.summary.totalTime;
                                            const d = Math.floor(totalSecs / 86400);
                                            const h = Math.floor((totalSecs % 86400) / 3600);
                                            const m = Math.floor((totalSecs % 3600) / 60);
                                            return (
                                                <div className="flex flex-col items-center">
                                                    <span>{d > 0 ? `${d}d ${h}h` : `${h}h`}</span>
                                                    <span className="text-[10px] opacity-60 font-bold">{m}m</span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="bg-bg-primary/50 rounded-xl p-3 text-center border border-white/5 shadow-inner">
                                    <div className="text-[10px] text-text-muted uppercase font-black mb-1 flex items-center justify-center gap-1 tracking-widest"><SpriteIcon name="Potion" size={10} className="text-accent-secondary" />Potions</div>
                                    <div className="text-xl font-black text-accent-secondary drop-shadow-sm">{planner.summary.totalPotions.toLocaleString()}</div>
                                </div>
                            </div>

                            {planner.schedule.length > 0 && (
                                <div className="text-[10px] text-text-muted text-center pt-1 border-t border-white/5">
                                    Completion: <span className="text-white font-bold ml-1">{planner.summary.completionDate.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })} {planner.summary.completionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            )}

                            {planner.planQueue.length > 0 && (
                                <button
                                    onClick={() => planner.clearQueue()}
                                    className="w-full py-2 text-xs font-bold text-red-400 border border-red-400/20 bg-red-400/5 rounded-lg hover:bg-red-400/10 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Trash2 size={12} />
                                    Clear All Steps
                                </button>
                            )}
                        </CardContent>
                    </Card>

                    {/* Auto-Planner */}
                    <Card className="p-6 bg-gradient-to-br from-accent-primary/5 via-bg-secondary to-accent-secondary/5 border-accent-primary/30 shadow-lg shadow-accent-primary/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Zap size={20} className="text-accent-primary" />
                                Auto-Planner
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-[10px] text-text-muted leading-relaxed">
                                Select one or more priorities and generate an optimized upgrade plan automatically.
                            </p>

                            {/* Target Trees */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-text-secondary uppercase">Target Trees</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { key: 'Forge', label: 'Forge', icon: <Hammer size={12} /> },
                                        { key: 'Power', label: 'Power', icon: <Shield size={12} /> },
                                        { key: 'SkillsPetTech', label: 'SPT', icon: <Sparkles size={12} /> }
                                    ].map(t => {
                                        const isActive = autoAllowedTrees.includes(t.key);
                                        return (
                                            <button
                                                key={t.key}
                                                onClick={() => {
                                                    setAutoAllowedTrees(prev => {
                                                        if (prev.includes(t.key)) {
                                                            if (prev.length <= 1) return prev; // Keep at least one
                                                            return prev.filter(x => x !== t.key);
                                                        }
                                                        return [...prev, t.key];
                                                    });
                                                }}
                                                className={cn(
                                                    "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-[10px] font-bold transition-all",
                                                    isActive 
                                                        ? "border-accent-secondary bg-accent-secondary/10 text-accent-secondary" 
                                                        : "border-white/5 bg-bg-primary/30 text-text-muted hover:border-white/20"
                                                )}
                                            >
                                                <span>{t.icon}</span>
                                                {t.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Priority Toggles */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-text-secondary uppercase">Priorities</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { key: 'war_points', label: 'War Points', icon: <Trophy size={18} />, desc: 'Max points/time' },
                                        { key: 'dps', label: 'DPS / Stats', icon: <Swords size={18} />, desc: 'Combat power' },
                                        { key: 'speed', label: 'Research Speed', icon: <Gauge size={18} />, desc: 'Faster upgrades' },
                                        { key: 'time', label: 'Min Time', icon: <Timer size={18} />, desc: 'Short first' },
                                    ].map(p => {
                                        const isActive = autoPriorities.has(p.key);
                                        return (
                                            <button
                                                key={p.key}
                                                onClick={() => {
                                                    setAutoPriorities(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(p.key)) next.delete(p.key);
                                                        else next.add(p.key);
                                                        return next;
                                                    });
                                                }}
                                                className={cn(
                                                    "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center",
                                                    isActive
                                                        ? "border-accent-primary bg-accent-primary/10 shadow-glow"
                                                        : "border-white/10 bg-bg-primary/30 hover:border-white/20"
                                                )}
                                            >
                                                <span className={cn("", isActive ? "text-accent-primary" : "text-text-muted")}>{p.icon}</span>
                                                <span className={cn("text-[10px] font-bold", isActive ? "text-accent-primary" : "text-text-secondary")}>{p.label}</span>
                                                <span className="text-[8px] text-text-muted">{p.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Max Steps */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-bold text-text-secondary uppercase">Max Steps</label>
                                    <span className="text-xs font-mono text-accent-primary font-bold">{autoMaxSteps} / {planner.totalRemainingNodes}</span>
                                </div>
                                <input
                                    type="range"
                                    min="10"
                                    max={Math.max(10, planner.totalRemainingNodes)}
                                    step="10"
                                    value={autoMaxSteps}
                                    onChange={(e) => setAutoMaxSteps(Number(e.target.value))}
                                    className="w-full accent-accent-primary h-2 rounded-lg appearance-none cursor-pointer bg-bg-input"
                                />
                            </div>

                            {/* Potion Budget */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-text-secondary uppercase flex items-center gap-2">
                                    <SpriteIcon name="Potion" size={12} />
                                    Potion Budget
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={autoPotionBudget || ''}
                                        onChange={(e) => setAutoPotionBudget(Math.max(0, Number(e.target.value)))}
                                        placeholder="∞ Unlimited"
                                        min="0"
                                        className="w-full bg-bg-input border border-border rounded-lg py-2 px-3 text-sm text-white placeholder:text-text-muted font-mono focus:border-accent-primary outline-none transition-colors"
                                    />
                                    {autoPotionBudget > 0 && (
                                        <button
                                            onClick={() => setAutoPotionBudget(0)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-text-muted hover:text-accent-primary"
                                        >∞</button>
                                    )}
                                </div>
                            </div>

                            {/* Schedule Optimization */}
                            <div className="pt-2 border-t border-white/5 space-y-3">
                                <label className="text-[10px] font-bold text-text-secondary uppercase flex items-center gap-2">
                                    <Clock size={12} className="text-accent-secondary" />
                                    Schedule Optimization
                                </label>
                                
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-text-muted uppercase">Sleep Start</label>
                                        <input
                                            type="time"
                                            value={autoSleepStart}
                                            onChange={(e) => setAutoSleepStart(e.target.value)}
                                            className="w-full bg-bg-input border border-border rounded-md px-2 py-1 text-xs text-white outline-none focus:border-accent-secondary transition-colors"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-text-muted uppercase">Sleep End</label>
                                        <input
                                            type="time"
                                            value={autoSleepEnd}
                                            onChange={(e) => setAutoSleepEnd(e.target.value)}
                                            className="w-full bg-bg-input border border-border rounded-md px-2 py-1 text-xs text-white outline-none focus:border-accent-secondary transition-colors"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] text-text-muted uppercase">Max Wait Buffer</label>
                                        <span className="text-[10px] font-mono text-accent-secondary">{autoMaxWait}m</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1440"
                                        step="15"
                                        value={autoMaxWait}
                                        onChange={(e) => setAutoMaxWait(Number(e.target.value))}
                                        className="w-full h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-secondary"
                                    />
                                    <p className="text-[8px] text-text-muted leading-tight">Max delay to wait for a War Day or align with wake-up time.</p>
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[9px] text-text-muted uppercase">Min Wait Between Nodes</label>
                                        <span className="text-[10px] font-mono text-accent-secondary">{autoMinWait}m</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="60"
                                        step="1"
                                        value={autoMinWait}
                                        onChange={(e) => setAutoMinWait(Number(e.target.value))}
                                        className="w-full h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-secondary"
                                    />
                                    <p className="text-[8px] text-text-muted leading-tight">Safety buffer added between all upgrades.</p>
                                </div>
                            </div>

                            {/* Generate Button */}
                            <button
                                onClick={() => {
                                    planner.autoPlan(
                                        autoPriorities.size > 0 ? autoPriorities : new Set(['war_points']),
                                        autoMaxSteps,
                                        autoPotionBudget > 0 ? autoPotionBudget : undefined,
                                        autoSleepStart,
                                        autoSleepEnd,
                                        autoMaxWait,
                                        autoMinWait,
                                        autoAllowedTrees
                                    );
                                    // Persist settings
                                    updateNestedProfile('misc', { 
                                        plannerSleepStart: autoSleepStart, 
                                        plannerSleepEnd: autoSleepEnd, 
                                        plannerMaxWait: autoMaxWait,
                                        plannerMinWaitBetweenNodes: autoMinWait
                                    });
                                }}
                                disabled={autoPriorities.size === 0 || autoAllowedTrees.length === 0}
                                className="w-full py-3.5 bg-gradient-to-r from-accent-primary to-accent-secondary text-black font-black uppercase tracking-tighter rounded-xl hover:opacity-90 disabled:opacity-30 disabled:grayscale transition-all shadow-xl shadow-accent-primary/20 flex items-center justify-center gap-2 group"
                            >
                                <Zap size={18} className="group-hover:scale-110 transition-transform" />
                                Generate Plan
                            </button>

                            {autoPriorities.size === 0 && (
                                <p className="text-[9px] text-red-400 text-center">Select at least one priority</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Node Picker */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Plus size={20} className="text-text-tertiary" />
                                Add Upgrade
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {/* Search */}
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    placeholder="Search nodes..."
                                    value={plannerSearch}
                                    onChange={(e) => setPlannerSearch(e.target.value)}
                                    className="w-full bg-bg-input border border-border rounded-lg py-2 pl-9 pr-3 text-sm text-white placeholder:text-text-muted focus:border-accent-primary outline-none transition-colors"
                                />
                            </div>

                            {/* Tree Filter */}
                            <div className="flex bg-bg-input rounded-lg p-1 border border-border gap-0.5">
                                {['all', 'Forge', 'Power', 'SkillsPetTech'].map(t => (
                                    <button key={t} onClick={() => setPlannerTreeFilter(t)}
                                        className={cn("flex-1 py-1 text-[10px] font-bold rounded transition-all",
                                            plannerTreeFilter === t ? "bg-accent-primary text-black" : "text-text-muted hover:text-text-primary"
                                        )}
                                    >{t === 'all' ? 'All' : t === 'SkillsPetTech' ? 'SPT' : t}</button>
                                ))}
                            </div>

                            {/* Node List */}
                            <div className="max-h-[400px] overflow-y-auto pr-1 custom-scrollbar space-y-1">
                                {planner.availableNodes
                                    .filter(n => plannerTreeFilter === 'all' || n.tree === plannerTreeFilter)
                                    .filter(n => !plannerSearch || n.nodeType.toLowerCase().includes(plannerSearch.toLowerCase()))
                                    .sort((a, b) => a.tier - b.tier || a.nodeType.localeCompare(b.nodeType))
                                    .map(node => (
                                        <button
                                            key={`${node.tree}-${node.nodeId}-${node.nextLevel}`}
                                            onClick={() => planner.addStep(node)}
                                            className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-bg-tertiary/30 border border-white/5 hover:border-accent-primary/30 hover:bg-accent-primary/5 transition-all text-left group"
                                        >
                                            <div className="w-8 h-8 shrink-0 rounded overflow-hidden border border-white/5 bg-black/20">
                                                {node.sprite_rect && treeMapping ? (
                                                    <div style={getSpriteStyle({ sprite_rect: node.sprite_rect }, 32) || undefined} className="w-full h-full" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center"><Cpu size={16} className="text-text-muted" /></div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-white truncate">{node.nodeType}</div>
                                                <div className="flex items-center gap-2 text-[9px] text-text-muted">
                                                    <span className="text-accent-primary/70">{node.tree === 'SkillsPetTech' ? 'SPT' : node.tree}</span>
                                                    <span>T{node.tier + 1}</span>
                                                    <span>Lv.{node.currentLevel}→{node.nextLevel}/{node.maxLevel}</span>
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <div className="text-[10px] font-mono text-accent-secondary">+{node.points.toLocaleString()}</div>
                                                <div className="text-[9px] text-text-muted">{formatTime(node.duration)}</div>
                                            </div>
                                            <Plus size={14} className="text-text-muted group-hover:text-accent-primary transition-colors shrink-0" />
                                        </button>
                                    ))
                                }
                                {planner.availableNodes.filter(n => plannerTreeFilter === 'all' || n.tree === plannerTreeFilter).filter(n => !plannerSearch || n.nodeType.toLowerCase().includes(plannerSearch.toLowerCase())).length === 0 && (
                                    <div className="text-center text-text-muted text-xs py-8 opacity-60">No available upgrades</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT: Schedule Queue */}
                <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 relative overflow-hidden flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-accent-primary">
                            <Calendar className="w-5 h-5" />
                            Upgrade Schedule ({planner.schedule.length} steps)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 relative z-10 flex-1 flex flex-col min-h-0">
                        {planner.schedule.length > 0 ? (
                            <DndContext 
                                sensors={sensors} 
                                collisionDetection={closestCorners} 
                                onDragStart={(event) => {
                                    const { active } = event;
                                    setActiveId(active.id as string);
                                }}
                                onDragEnd={(event) => {
                                    const { active, over } = event;
                                    setActiveId(null);
                                    if (!over || active.id === over.id) return;
                                    const oldIdx = planner.planQueue.findIndex((s) => s.id === active.id);
                                    const newIdx = planner.planQueue.findIndex((s) => s.id === over.id);
                                    if (oldIdx !== -1 && newIdx !== -1) planner.moveStep(oldIdx, newIdx);
                                }}
                                onDragCancel={() => setActiveId(null)}
                            >
                                <SortableContext items={planner.planQueue.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
                                        {planner.schedule.map((entry, idx) => {
                                            const isFirstInWarBlock = entry.isWarDay && (idx === 0 || !planner.schedule[idx - 1].isWarDay);
                                            const isLastInWarBlock = entry.isWarDay && (idx === planner.schedule.length - 1 || !planner.schedule[idx + 1].isWarDay);
                                            
                                            return (
                                                <div key={`plan-container-${idx}`} className="relative">
                                                    {/* NOW Marker */}
                                                    {(() => {
                                                        const isFirstFuture = now < entry.startDate && (idx === 0 || now >= (planner.schedule[idx-1]?.endDate || new Date(0)));
                                                        const isOverdue = now > entry.endDate && idx === planner.schedule.length - 1;
                                                        
                                                        if (isFirstFuture || isOverdue) {
                                                            return (
                                                                <div className="absolute -top-1 left-0 right-0 z-20 flex items-center gap-2 pointer-events-none">
                                                                    <div className="h-0.5 flex-1 bg-accent-primary shadow-glow shadow-accent-primary/50" />
                                                                    <span className="text-[9px] font-black bg-accent-primary text-black px-1.5 py-0.5 rounded shadow-glow shrink-0 animate-pulse">NOW</span>
                                                                    <div className="h-0.5 w-4 bg-accent-primary shadow-glow shadow-accent-primary/50" />
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}

                                                    {isFirstInWarBlock && (
                                                        <div className="flex items-center gap-2 py-2 px-1 mt-2 first:mt-0">
                                                            <Trophy size={14} className="text-accent-primary animate-pulse" />
                                                            <span className="text-[10px] font-black text-accent-primary uppercase tracking-widest">Guild War Event Period</span>
                                                            <div className="h-px flex-1 bg-gradient-to-r from-accent-primary/50 to-transparent" />
                                                        </div>
                                                    )}
                                                    
                                                    <SortableItem key={entry.step.id} id={entry.step.id}>
                                                        {({ listeners, isDragging }) => {
                                                            const isRunning = now >= entry.startDate && now <= entry.endDate;
                                                            const isStartWar = isWarPointDay(entry.startDate, 'tech');
                                                            const isStopWar = isWarPointDay(entry.endDate, 'tech');

                                                            return (
                                                                <div className={cn(
                                                                    "group relative flex flex-col sm:flex-row rounded-xl border transition-all overflow-hidden",
                                                                    isDragging && "shadow-2xl shadow-accent-primary/20 ring-2 ring-accent-primary/30 z-50",
                                                                    isRunning ? "ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-primary" : "border-white/5",
                                                                    entry.isInvalid && "opacity-50 grayscale"
                                                                )}>
                                                                    {/* LEFT HALF: START */}
                                                                    <div className={cn(
                                                                        "flex-1 flex gap-3 p-3 transition-colors relative",
                                                                        isStartWar ? "bg-accent-primary/10 border-r border-accent-primary/20" : "bg-bg-tertiary/40 border-r border-white/5"
                                                                    )}>
                                                                        {/* Drag Handle */}
                                                                        <div {...listeners} className="flex items-center cursor-grab active:cursor-grabbing text-text-muted/30 hover:text-accent-primary/50 transition-colors touch-none">
                                                                            <GripVertical size={20} />
                                                                        </div>

                                                                        <div className="flex flex-col items-center shrink-0 w-8">
                                                                            <div className={cn(
                                                                                "text-[10px] font-bold w-full text-center py-0.5 rounded border mb-2",
                                                                                entry.isInvalid ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-text-muted bg-white/5 border-white/5"
                                                                            )}>#{idx + 1}</div>
                                                                            <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden border border-white/5 bg-black/20">
                                                                                {entry.step.type === 'delay' ? (
                                                                                    <div className="w-full h-full flex items-center justify-center"><Pause size={18} className="text-yellow-400" /></div>
                                                                                ) : entry.sprite_rect && treeMapping ? (
                                                                                    <div style={getSpriteStyle({ sprite_rect: entry.sprite_rect }, 40) || undefined} className="w-full h-full" />
                                                                                ) : (
                                                                                    <div className="w-full h-full flex items-center justify-center"><Cpu size={18} className="text-text-muted" /></div>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex justify-between items-start mb-0.5">
                                                                                <span className={cn("text-xs font-black uppercase tracking-tight", isStartWar ? "text-accent-primary" : "text-text-muted")}>START</span>
                                                                                <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-white bg-black/30 px-1.5 rounded">
                                                                                    <Clock size={10} className="text-accent-primary" />
                                                                                    {formatScheduleTime(entry.startDate)}
                                                                                </div>
                                                                            </div>
                                                                            <div className={cn("text-sm font-bold truncate", entry.isInvalid ? "text-red-400 line-through" : "text-white")}>
                                                                                {entry.step.type === 'delay' ? `Delay (+${formatTime(entry.step.delayMinutes! * 60)})` : entry.nodeName}
                                                                            </div>
                                                                            {entry.step.type === 'node' && (
                                                                                <div className="text-[9px] text-text-muted flex items-center gap-1 mt-1">
                                                                                    <span className="bg-white/5 px-1 rounded">Lv.{entry.fromLevel} → {entry.toLevel}</span>
                                                                                    <span>•</span>
                                                                                    <span className="truncate">{entry.step.tree === 'SkillsPetTech' ? 'SPT' : entry.step.tree}</span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* RIGHT HALF: STOP / PROGRESS */}
                                                                    <div className={cn(
                                                                        "flex-1 flex flex-col p-3 transition-colors relative",
                                                                        isStopWar ? "bg-accent-primary/20" : "bg-bg-secondary/60"
                                                                    )}>
                                                                        <div className="flex justify-between items-start mb-2">
                                                                            <div className="flex flex-col">
                                                                                <span className={cn("text-[10px] font-black uppercase tracking-tight", isStopWar ? "text-accent-primary" : "text-text-muted")}>FINISH</span>
                                                                                <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-white bg-black/30 px-1.5 rounded w-fit">
                                                                                    <CheckCircle2 size={10} className="text-accent-secondary" />
                                                                                    {formatScheduleTime(entry.endDate)}
                                                                                    {entry.startDate.getDate() !== entry.endDate.getDate() && (
                                                                                        <span className="text-[8px] text-accent-secondary ml-0.5">+{Math.ceil((entry.endDate.getTime() - entry.startDate.getTime()) / 86400000)}d</span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            <div className="flex flex-col items-end">
                                                                                <div className={cn("text-xs font-black flex items-center gap-1", isStopWar ? "text-accent-primary shadow-glow-sm" : "text-white/60")}>
                                                                                    +{entry.points.toLocaleString()} pts
                                                                                    {isStopWar && <Trophy size={12} className="animate-bounce" />}
                                                                                </div>
                                                                                {isStopWar && <span className="text-[7px] font-black bg-accent-primary text-black px-1 rounded uppercase tracking-tighter">WAR BONUS</span>}
                                                                            </div>
                                                                        </div>

                                                                        <div className="mt-auto flex justify-between items-center gap-4">
                                                                            <div className="flex items-center gap-2 text-[10px] font-mono text-text-muted">
                                                                                <div className="flex items-center gap-1"><Timer size={10} />{formatTime(entry.duration || entry.delaySeconds)}</div>
                                                                                {entry.potionCost > 0 && <div className="flex items-center gap-1"><SpriteIcon name="Potion" size={10} />{entry.potionCost}</div>}
                                                                            </div>

                                                                            <div className="flex gap-1">
                                                                                <button onClick={() => setPlannerConfirmDone(idx)} className="p-1 hover:bg-green-500/20 rounded-md transition-colors" title="Mark done up to here">
                                                                                    <Play size={14} className="text-green-400" />
                                                                                </button>
                                                                                <button onClick={() => {
                                                                                    const mins = prompt('Delay in minutes:');
                                                                                    if (mins && !isNaN(Number(mins))) planner.addDelay(idx, Number(mins));
                                                                                }} className="p-1 hover:bg-yellow-500/20 rounded-md transition-colors" title="Add delay after">
                                                                                    <Pause size={14} className="text-yellow-400" />
                                                                                </button>
                                                                                <button onClick={() => planner.removeStep(idx)} className="p-1 hover:bg-red-500/20 rounded-md transition-colors" title="Remove">
                                                                                    <Trash2 size={14} className="text-red-400" />
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        {/* Running Progress Bar Overlay */}
                                                                        {isRunning && (
                                                                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 overflow-hidden">
                                                                                <div 
                                                                                    className="h-full bg-accent-primary shadow-glow transition-all duration-1000"
                                                                                    style={{ width: `${Math.min(100, Math.max(0, ((now.getTime() - entry.startDate.getTime()) / (entry.endDate.getTime() - entry.startDate.getTime())) * 100))}%` }}
                                                                                />
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Running Badge */}
                                                                    {isRunning && (
                                                                        <div className="absolute top-0 right-0 z-10 px-2 py-0.5 bg-accent-primary text-black text-[8px] font-black uppercase rounded-bl-lg shadow-glow">
                                                                            RUNNING
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        }}
                                                    </SortableItem>
                                                    {isLastInWarBlock && (
                                                        <div className="flex justify-end pr-1 pb-2">
                                                            <div className="h-px w-24 bg-gradient-to-l from-accent-primary/30 to-transparent" />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </SortableContext>
                                
                                <DragOverlay dropAnimation={{
                                    sideEffects: defaultDropAnimationSideEffects({
                                        styles: {
                                            active: {
                                                opacity: '0.5',
                                            },
                                        },
                                    }),
                                }}>
                                    {activeId ? (() => {
                                        const activeEntry = planner.schedule.find(e => e.step.id === activeId);
                                        if (!activeEntry) return null;
                                        return (
                                            <div className="flex gap-3 p-3 rounded-lg border border-accent-primary/50 bg-bg-secondary shadow-2xl ring-2 ring-accent-primary/50 opacity-90 scale-105 transition-transform">
                                                <div className="flex items-center text-accent-primary">
                                                    <GripVertical size={20} />
                                                </div>
                                                <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden border border-white/5 bg-black/20">
                                                    {activeEntry.step.type === 'delay' ? (
                                                        <div className="w-full h-full flex items-center justify-center"><Pause size={18} className="text-yellow-400" /></div>
                                                    ) : activeEntry.sprite_rect ? (
                                                        <div style={getSpriteStyle({ sprite_rect: activeEntry.sprite_rect }, 40) || undefined} className="w-full h-full" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center"><Cpu size={18} className="text-text-muted" /></div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-bold text-white truncate">
                                                        {activeEntry.step.type === 'delay' ? `Delay (+${formatTime(activeEntry.step.delayMinutes! * 60)})` : activeEntry.nodeName}
                                                    </div>
                                                    <div className="text-[10px] text-text-muted">
                                                        {activeEntry.isWarDay ? "War Point Day" : "Standard Day"}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })() : null}
                                </DragOverlay>
                            </DndContext>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-text-muted gap-3 text-center px-6">
                                <Info className="w-10 h-10 opacity-20" />
                                <div>
                                    <p className="font-bold">No upgrades queued</p>
                                    <p className="text-sm opacity-60 mt-1">Use the node picker on the left to add upgrades to your plan.</p>
                                </div>
                            </div>
                        )}
                    </CardContent>

                    <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/SkillTabIcon.png`} alt="" className="w-64 h-64 object-contain grayscale" />
                    </div>
                </Card>
            </div>
            )}

            <ConfirmModal
                isOpen={showConfirmModal}
                title="Apply Upgrades"
                message={`Apply ${pendingUpgrades.length} upgrades to your profile? This will spend ${Math.floor(pendingUpgrades.reduce((sum, a) => sum + a.cost, 0)).toLocaleString()} potions.`}
                onConfirm={confirmApply}
                onCancel={() => setShowConfirmModal(false)}
                confirmText="Apply"
            />

            <ConfirmModal
                isOpen={plannerConfirmDone !== null}
                title="Mark Done"
                message={`Mark steps 1-${(plannerConfirmDone ?? 0) + 1} as completed? This will apply the upgrades to your profile and remove them from the queue.`}
                onConfirm={() => {
                    if (plannerConfirmDone !== null) {
                        planner.markDone(plannerConfirmDone);
                        setPlannerConfirmDone(null);
                    }
                }}
                onCancel={() => setPlannerConfirmDone(null)}
                confirmText="Complete"
            />
        </div>
    );
}
