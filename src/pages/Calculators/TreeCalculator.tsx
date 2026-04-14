import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTreeOptimizer, TechUpgrade } from '../../hooks/useTreeOptimizer';
import { useProfile } from '../../context/ProfileContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { useGameData } from '../../hooks/useGameData';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Cpu, RefreshCcw, Info, Trophy, Timer, CheckCircle, CheckCircle2, Calendar, Clock, Copy, ChevronUp, ChevronDown, ArrowUpDown, GripVertical } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ConfirmModal } from '../../components/UI/ConfirmModal';

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

    const { profile, updateNestedProfile } = useProfile();

    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');
    const NODE_ICON_SIZE = 40;

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
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

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
            accumulatedTimeSeconds += effectiveDuration;

            return {
                ...action,
                gemCost: recalculatedGemCost,
                effectiveDuration // handy for rendering
            };
        });
    }, [orderedActions, timeLimitHours, profile.misc.useGemsInCalculators]);

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
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
        return `${m}m`;
    };

    const getSpriteStyle = (action: TechUpgrade) => {
        if (!treeMapping || !action?.sprite_rect) return null;
        const { x, y, width, height } = action.sprite_rect;
        const sheetW = treeMapping.texture_size?.width || 1024;
        const sheetH = treeMapping.texture_size?.height || 1024;

        const scale = NODE_ICON_SIZE / width;
        const cssY = sheetH - y - height;

        return {
            backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/TechTreeIcons.png)`,
            backgroundPosition: `-${x * scale}px -${cssY * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            backgroundRepeat: 'no-repeat' as const,
            width: `${NODE_ICON_SIZE}px`,
            height: `${NODE_ICON_SIZE}px`,
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
                                            <span>Selected War Points</span>
                                            <Trophy size={14} />
                                        </div>
                                        <div className="flex items-baseline gap-2">
                                            <div className="text-3xl font-black text-white">
                                                {Math.floor(selectedPoints).toLocaleString()}
                                            </div>
                                            {selectedPoints < optimization.totalPoints && (
                                                <div className="text-[10px] text-text-muted font-bold">
                                                    / {Math.floor(optimization.totalPoints).toLocaleString()}
                                                </div>
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
                                                                                <div className="text-accent-primary font-bold">
                                                                                    +{action.points.toLocaleString()} pts
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

            <ConfirmModal
                isOpen={showConfirmModal}
                title="Apply Upgrades"
                message={`Apply ${pendingUpgrades.length} upgrades to your profile? This will spend ${Math.floor(pendingUpgrades.reduce((sum, a) => sum + a.cost, 0)).toLocaleString()} potions.`}
                onConfirm={confirmApply}
                onCancel={() => setShowConfirmModal(false)}
                confirmText="Apply"
            />
        </div>
    );
}
