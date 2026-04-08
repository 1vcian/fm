import { useState, useEffect, useMemo } from 'react';
import { useTreeOptimizer, TechUpgrade } from '../../hooks/useTreeOptimizer';
import { useProfile } from '../../context/ProfileContext';
import { useTreeMode } from '../../context/TreeModeContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { useGameData } from '../../hooks/useGameData';
import { Cpu, RefreshCcw, Info, Trophy, Timer, CheckCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ConfirmModal } from '../../components/UI/ConfirmModal';

export default function TreeCalculator() {
    const {
        timeLimitHours, setTimeLimitHours,
        potions, setPotions,
        optimization,
        applyUpgrades
    } = useTreeOptimizer();

    const { profile, updateNestedProfile } = useProfile();
    const { treeMode } = useTreeMode();

    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');
    const NODE_ICON_SIZE = 40;

    // Selection State
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingUpgrades, setPendingUpgrades] = useState<TechUpgrade[]>([]);

    // Reset selection when optimization actions change (to empty)
    useEffect(() => {
        setSelectedIndices(new Set());
    }, [optimization?.actions]);

    // Dependency Tracking
    const dependencies = useMemo(() => {
        if (!optimization?.actions || !treeMapping?.trees) return [];
        const deps: number[][] = optimization.actions.map(() => []);

        optimization.actions.forEach((action, i) => {
            // 1. Same node lower level
            if (action.fromLevel > 0) {
                const prevLevelAction = optimization.actions.findIndex((a, j) =>
                    j < i && a.tree === action.tree && a.nodeId === action.nodeId && a.toLevel === action.fromLevel
                );
                if (prevLevelAction !== -1) deps[i].push(prevLevelAction);
            }

            // 2. Parent node requirements
            const nodeMapping = treeMapping.trees[action.tree]?.nodes?.find((n: any) => n.id === action.nodeId);
            if (nodeMapping?.requirements) {
                nodeMapping.requirements.forEach((reqId: number) => {
                    const profileLevel = (treeMode === 'empty') ? 0 : ((profile.techTree as any)[action.tree]?.[reqId] || 0);
                    if (profileLevel === 0) {
                        const unlockAction = optimization.actions.findIndex((a, j) =>
                            j < i && a.tree === action.tree && a.nodeId === reqId && a.toLevel === 1
                        );
                        if (unlockAction !== -1) deps[i].push(unlockAction);
                    }
                });
            }
        });
        return deps;
    }, [optimization?.actions, treeMapping, profile.techTree, treeMode]);

    const isSelectable = (idx: number) => {
        if (!dependencies[idx]) return true;
        return (dependencies[idx] as number[]).every((depIdx: number) => selectedIndices.has(depIdx));
    };

    const toggleSelection = (idx: number) => {
        const next = new Set(selectedIndices);
        if (next.has(idx)) {
            // Uncheck cascading dependents
            const uncheckRecursive = (id: number) => {
                if (!next.has(id)) return;
                next.delete(id);
                (dependencies as number[][]).forEach((deps, otherId) => {
                    if (deps.includes(id)) uncheckRecursive(otherId);
                });
            };
            uncheckRecursive(idx);
        } else {
            // Check if selectable
            if (!isSelectable(idx)) return;
            next.add(idx);
        }
        setSelectedIndices(next);
    };

    const handleApply = () => {
        if (!optimization) return;
        const toApply = optimization.actions.filter((_, idx) => selectedIndices.has(idx));
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

    const selectedPoints = optimization?.actions
        ? optimization.actions.filter((_, idx) => selectedIndices.has(idx)).reduce((sum, a) => sum + a.points, 0)
        : 0;

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}Texture2D/SkillTabIcon.png`} alt="Tech Tree" className="w-10 h-10 object-contain" />
                    Tree Calculator
                </h1>
                <p className="text-text-secondary">Maximize your Guild War points via optimal tech upgrades.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* INPUTS */}
                <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <SpriteIcon name="Timer" size={20} className="text-text-tertiary" />
                            Optimization Constraints
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Time Input (Hours/Minutes) */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-text-secondary uppercase flex items-center gap-2">
                                <Timer size={14} />
                                Time Limit
                            </label>
                            <div className="flex gap-4">
                                {/* Hours */}
                                <div className="relative group flex-1">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                        <SpriteIcon name="Timer" size={24} className="opacity-50" />
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-16 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                        value={Math.floor(timeLimitHours)}
                                        onChange={(e) => {
                                            const h = parseInt(e.target.value) || 0;
                                            const m = Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60);
                                            setTimeLimitHours(h + (m / 60));
                                        }}
                                        placeholder="0"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted bg-bg-input px-1 pointer-events-none">HOURS</span>
                                </div>

                                {/* Minutes */}
                                <div className="relative group flex-1">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                        <SpriteIcon name="Timer" size={24} className="opacity-50" />
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        max="59"
                                        className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-16 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                        value={Math.round((timeLimitHours - Math.floor(timeLimitHours)) * 60)}
                                        onChange={(e) => {
                                            const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                            const h = Math.floor(timeLimitHours);
                                            setTimeLimitHours(h + (m / 60));
                                        }}
                                        placeholder="0"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted bg-bg-input px-1 pointer-events-none">MINS</span>
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
                                Use the checkboxes in the results to select which upgrades you've completed. Click "Apply Selected" to permanently update your profile.
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
                        {optimization && optimization.actions.length > 0 ? (
                            <>
                                {/* Stats Summary */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 bg-bg-primary rounded-xl border border-border col-span-2">
                                        <div className="text-xs text-text-secondary font-bold uppercase mb-1 flex items-center gap-2">
                                            <Trophy size={14} className="text-accent-primary" />
                                            Selected War Points
                                        </div>
                                        <div className="text-3xl font-black text-white drop-shadow-md">
                                            {Math.floor(selectedPoints).toLocaleString()}
                                            {selectedPoints < optimization.totalPoints && (
                                                <span className="text-xs text-text-muted font-normal ml-2">/ {Math.floor(optimization.totalPoints).toLocaleString()} potential</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Time Used</div>
                                        <div className="text-lg font-mono font-bold text-white">
                                            {formatTime(optimization.timeUsed * 3600)}
                                        </div>
                                    </div>
                                    <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                        <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Potions Used</div>
                                        <div className="text-lg font-mono font-bold text-accent-secondary">
                                            {Math.floor(optimization.potionsUsed).toLocaleString()}
                                        </div>
                                    </div>
                                </div>

                                {/* Action Plan */}
                                <div className="space-y-3 flex-1 flex flex-col min-h-0">
                                    <div className="flex justify-between items-center text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                        <span>Recommended Upgrade Path</span>
                                        <button
                                            onClick={() => {
                                                if (selectedIndices.size === optimization.actions.length) setSelectedIndices(new Set());
                                                else setSelectedIndices(new Set(optimization.actions.map((_, i) => i)));
                                            }}
                                            className="text-accent-primary hover:underline lowercase bg-accent-primary/5 px-2 py-0.5 rounded transition-colors"
                                        >
                                            {selectedIndices.size === optimization.actions.length ? 'Desel All' : 'Select All'}
                                        </button>
                                    </div>
                                    <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
                                        {optimization.actions.map((action, idx) => (
                                            <div
                                                key={idx}
                                                onClick={() => toggleSelection(idx)}
                                                className={cn(
                                                    "flex gap-3 p-3 rounded bg-bg-tertiary/50 border border-white/5 transition-all relative group cursor-pointer",
                                                    selectedIndices.has(idx)
                                                        ? "border-accent-primary/40 bg-accent-primary/5"
                                                        : isSelectable(idx)
                                                            ? "opacity-80 hover:bg-bg-tertiary border-white/10"
                                                            : "opacity-30 grayscale cursor-not-allowed bg-black/40"
                                                )}
                                            >
                                                {!isSelectable(idx) && (
                                                    <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded">
                                                        <span className="text-[10px] font-bold text-accent-primary uppercase tracking-widest px-2 py-1 bg-bg-primary rounded border border-accent-primary/20">
                                                            Prerequisites Required
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex flex-col items-center shrink-0 w-8">
                                                    <div className={cn(
                                                        "text-[10px] font-bold w-full text-center py-0.5 rounded border mb-2 transition-colors",
                                                        selectedIndices.has(idx)
                                                            ? "text-accent-primary bg-accent-primary/10 border-accent-primary/20"
                                                            : "text-text-muted bg-white/5 border-white/5"
                                                    )}>
                                                        #{idx + 1}
                                                    </div>
                                                    <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden border border-white/5 bg-black/20 relative">
                                                        {getSpriteStyle(action) ? (
                                                            <div style={getSpriteStyle(action)!} className="w-full h-full" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center">
                                                                <Cpu size={20} className="text-text-muted" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {idx < optimization.actions.length - 1 && (
                                                        <div className="w-0.5 h-full bg-white/5 mt-1" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className="text-sm font-bold text-white truncate pr-2">
                                                            {action.nodeName}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-mono text-accent-secondary shrink-0">
                                                                Tier {action.tier + 1}
                                                            </span>
                                                            <div className={cn(
                                                                "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                                                selectedIndices.has(idx) ? "bg-accent-primary border-accent-primary" : "border-white/20"
                                                            )}>
                                                                {selectedIndices.has(idx) && <CheckCircle2 size={12} className="text-bg-primary" />}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-text-muted mb-2">
                                                        <span className="bg-white/5 px-1.5 rounded">Lv.{action.fromLevel} → Lv.{action.toLevel}</span>
                                                        <span>•</span>
                                                        <span className="text-accent-primary/80">{action.tree}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[11px] font-mono">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-1">
                                                                <Timer size={10} className="opacity-50" />
                                                                {formatTime(action.duration)}
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <SpriteIcon name="Potion" size={10} />
                                                                {action.cost}
                                                            </div>
                                                            {action.gemCost && action.gemCost > 0 && (
                                                                <div className="flex items-center gap-1 text-accent-primary font-bold">
                                                                    <SpriteIcon name="GemSquare" size={10} />
                                                                    {Math.ceil(action.gemCost)}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-accent-primary font-bold">
                                                            +{action.points.toLocaleString()} pts
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <button
                                        onClick={handleApply}
                                        disabled={selectedIndices.size === 0}
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
