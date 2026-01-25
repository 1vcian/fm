import { useState } from 'react';
import { useEggsCalculator } from '../hooks/useEggsCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../components/UI/Card';
import { cn } from '../lib/utils';
import { Egg, Calculator, Percent, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { SpriteIcon } from '../components/UI/SpriteIcon';
// Updated to correct path
const EGG_SPRITE_SHEET = './Texture2D/Eggs.png';
// These constants are no longer directly used by EggIcon with % positioning, but kept for context if needed elsewhere.


function EggIcon({ rarity, size = 48, className }: { rarity: string; size?: number; className?: string }) {
    const rarityIndex: Record<string, number> = {
        'Common': 0, 'Rare': 1, 'Epic': 2,
        'Legendary': 3, 'Ultimate': 4, 'Mythic': 5
    };

    const idx = rarityIndex[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);

    // For a 4x4 grid, we use standard CSS sprite percentage positioning:
    // (index / (total_columns - 1)) * 100
    const xPos = (col / 3) * 100;
    const yPos = (row / 3) * 100;

    return (
        <div
            className={cn("inline-block shrink-0", className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${EGG_SPRITE_SHEET})`,
                backgroundPosition: `${xPos}% ${yPos}%`,
                backgroundSize: '400% 400%', // 4x4 grid means the background image is 400% of the container size
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated'
            }}
            title={rarity}
        />
    );
}

export default function Eggs() {
    const {
        ownedEggs, updateOwnedEggs,
        timeLimitHours, setTimeLimitHours,
        availableSlots, setAvailableSlots, maxSlots,
        optimization,
        hatchValues,
        selectedStage, setSelectedStage,
        dungeonKeys, setDungeonKeys,
        stageDropRates,
        todayTotalDrops,
        hatchingTimes,
        warPoints
    } = useEggsCalculator();

    // Helpers
    const getStageLabel = (lvl: number) => {
        const world = Math.floor((lvl - 1) / 10) + 1;
        const stage = ((lvl - 1) % 10) + 1;
        return `${world}-${stage}`;
    };

    const [activeTab, setActiveTab] = useState<'calculator' | 'info'>('calculator');

    // Format Helpers
    const formatTime = (seconds: number) => {
        const totalMinutes = Math.round(seconds / 60);

        if (totalMinutes >= 1440) {
            const days = Math.floor(totalMinutes / 1440);
            const hours = Math.floor((totalMinutes % 1440) / 60);
            return `${days}d ${hours}h`;
        } else if (totalMinutes >= 60) {
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            return `${hours}h ${mins.toString().padStart(2, '0')}m`;
        }
        return `${totalMinutes}m`;
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20">
            {/* Header */}
            <div className="text-center space-y-2 mb-6">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <Egg className="w-8 h-8 text-accent-primary" />
                    Egg Calculator
                </h1>
                <p className="text-text-secondary">Optimize your egg hatching for Guild Wars</p>
            </div>

            {/* Tabs */}
            <div className="flex justify-center gap-4 mb-6">
                <button
                    onClick={() => setActiveTab('calculator')}
                    className={cn(
                        "px-6 py-2 rounded-lg font-bold transition-all",
                        activeTab === 'calculator'
                            ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                            : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4" />
                        Calculator
                    </div>
                </button>
                <button
                    onClick={() => setActiveTab('info')}
                    className={cn(
                        "px-6 py-2 rounded-lg font-bold transition-all",
                        activeTab === 'info'
                            ? "bg-accent-primary text-bg-primary shadow-lg scale-105"
                            : "bg-bg-secondary text-text-secondary hover:bg-bg-tertiary"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Percent className="w-4 h-4" />
                        Drop Rates & Info
                    </div>
                </button>
            </div>

            {activeTab === 'calculator' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Input Section */}
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SpriteIcon name="Timer" size={20} className="text-accent-tertiary" />
                                    Parameters
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {/* Hours Available */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-text-secondary uppercase">Time Available</label>
                                        <div className="flex flex-col gap-4">
                                            {/* Hours */}
                                            <div className="relative group flex-1">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors pointer-events-none">
                                                    <SpriteIcon name="Timer" size={24} />
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

                                    {/* Slots Available */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-bold text-text-secondary uppercase">Slots Available</label>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                                <img src="./Texture2D/HatchBed.png" alt="Bed" className="w-6 h-6 object-contain opacity-70 group-focus-within:opacity-100 transition-opacity" />
                                            </div>
                                            <input
                                                type="number"
                                                min="1"
                                                max={maxSlots}
                                                className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                                value={availableSlots}
                                                onChange={(e) => setAvailableSlots(Math.min(maxSlots, Math.max(1, parseInt(e.target.value) || 1)))}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Egg className="w-5 h-5 text-accent-primary" />
                                    Inventory
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    {Object.entries(ownedEggs).map(([rarity, count]) => (
                                        <div key={rarity} className="relative flex flex-col items-center gap-2 p-3 bg-bg-tertiary rounded-lg border border-border/50 pt-6">
                                            {/* Points Info */}
                                            {warPoints && warPoints[rarity] && (
                                                <div className="absolute top-1 left-0 right-0 flex justify-center gap-2 text-[9px] font-mono text-text-tertiary opacity-80">
                                                    <span>H:<span className="text-text-primary ml-0.5">{warPoints[rarity].hatch}</span></span>
                                                    <span>M:<span className="text-text-primary ml-0.5">{warPoints[rarity].merge}</span></span>
                                                </div>
                                            )}
                                            <EggIcon rarity={rarity} size={48} />
                                            <span className={cn("text-xs font-bold uppercase", `text-rarity-${rarity}`)}>
                                                {rarity}
                                            </span>

                                            <div className="flex items-center gap-1 w-full">
                                                <button
                                                    onClick={() => updateOwnedEggs(rarity, Math.max(0, count - 1))}
                                                    className="p-1 bg-black/40 rounded hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors"
                                                >
                                                    -
                                                </button>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={count}
                                                    onChange={(e) => updateOwnedEggs(rarity, parseInt(e.target.value) || 0)}
                                                    className="w-full text-center bg-transparent border-none outline-none font-mono text-sm h-6 p-0"
                                                    onFocus={(e) => e.target.select()}
                                                />
                                                <button
                                                    onClick={() => updateOwnedEggs(rarity, count + 1)}
                                                    className="p-1 bg-black/40 rounded hover:bg-green-500/20 text-text-secondary hover:text-green-400 transition-colors"
                                                >
                                                    +
                                                </button>
                                            </div>

                                            {hatchValues && hatchValues[rarity] && (
                                                <div className="flex items-center gap-1 text-[10px] text-text-tertiary bg-black/20 px-2 py-0.5 rounded-full">
                                                    <SpriteIcon name="Timer" size={12} />
                                                    {formatTime(hatchValues[rarity])}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Results Section */}
                    <div className="space-y-6">
                        <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                            <CardHeader>
                                <CardTitle className="text-xl text-accent-primary">Optimization Strategy</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {optimization && optimization.totalPoints > 0 ? (
                                    <>
                                        {/* Summary Stats */}
                                        <div className="grid grid-cols-2 gap-4 p-4 bg-bg-primary rounded-xl border border-border">
                                            <div>
                                                <div className="text-sm text-text-secondary">Expected Total Points</div>
                                                <div className="text-2xl font-bold text-accent-primary">
                                                    {Math.floor(optimization.totalPoints).toLocaleString()}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm text-text-secondary">Time Required</div>
                                                <div className="text-2xl font-bold text-text-primary">
                                                    {formatTime(optimization.timeUsed * 60)} <span className="text-sm font-normal text-text-tertiary">/ {timeLimitHours}h</span>
                                                </div>
                                            </div>
                                            <div className="col-span-2 pt-2 border-t border-border/50 flex justify-between text-sm">
                                                <span>Hatch Pts: <span className="text-text-primary font-bold">{Math.floor(optimization.hatchPoints).toLocaleString()}</span></span>
                                                <span>Merge Pts: <span className="text-text-primary font-bold">{Math.floor(optimization.mergePoints).toLocaleString()}</span></span>
                                            </div>
                                        </div>

                                        {/* Open List */}
                                        <div className="space-y-2">
                                            <h3 className="font-bold text-text-primary">Action Plan</h3>
                                            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                                                {Object.entries(optimization.toOpen)
                                                    .filter(([_, count]) => count > 0)
                                                    .map(([rarity, count]) => (
                                                        <div key={rarity} className="flex items-center justify-between p-3 bg-bg-primary rounded-lg border-l-4" style={{ borderColor: `var(--color-rarity-${rarity})` }}>
                                                            <div className="flex items-center gap-3">
                                                                <EggIcon rarity={rarity} size={32} />
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold text-text-primary">Open {count}x {rarity}</span>
                                                                    <span className="text-xs text-text-secondary capitalize">
                                                                        {rarity} Eggs
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center py-12 text-text-tertiary">
                                        <p>Enter your egg inventory to calculate the best strategy.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            {activeTab === 'info' && (
                <div className="space-y-6">
                    {/* Stage Selector (Central Control) */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <SpriteIcon name="PetKey" size={20} className="text-accent-tertiary" />
                                Select Stage
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4 pt-2">
                                <div className="flex items-center justify-between bg-bg-primary/50 p-4 rounded-xl border border-white/5">
                                    <div>
                                        <div className="text-xs font-bold text-text-secondary uppercase">Exploration Area</div>
                                        <div className="text-3xl font-black text-white flex items-center gap-3">
                                            Stage {getStageLabel(selectedStage)}
                                            <span className="text-sm font-bold text-accent-primary bg-accent-primary/10 px-2 py-0.5 rounded border border-accent-primary/20">
                                                Level {selectedStage}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <button
                                            onClick={() => setSelectedStage(Math.max(1, selectedStage - 1))}
                                            disabled={selectedStage <= 1}
                                            className="p-3 bg-bg-input rounded-xl hover:bg-bg-tertiary disabled:opacity-30 border border-white/5 transition-all active:scale-95"
                                        >
                                            <ChevronLeft className="w-6 h-6" />
                                        </button>

                                        <button
                                            onClick={() => setSelectedStage(Math.min(100, selectedStage + 1))}
                                            className="p-3 bg-bg-input rounded-xl hover:bg-bg-tertiary disabled:opacity-30 border border-white/5 transition-all active:scale-95"
                                        >
                                            <ChevronRight className="w-6 h-6" />
                                        </button>
                                    </div>
                                </div>

                                <input
                                    type="range"
                                    min="1"
                                    max="100" // Adjust based on data? Usually 100 levels.
                                    value={selectedStage}
                                    onChange={(e) => setSelectedStage(parseInt(e.target.value))}
                                    className="w-full h-4 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                />
                                <div className="flex justify-between text-[10px] text-text-secondary font-mono px-1">
                                    <span>World 1</span>
                                    <span>World 5</span>
                                    <span>World 10</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Drop Rates Display */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <CardHeader>
                            <CardTitle className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <SpriteIcon name="Timer" size={20} className="text-accent-tertiary" />
                                    Drop Rates & Prediction
                                </div>
                                <div className="flex items-center gap-4 text-sm font-normal">
                                    <div className="flex items-center gap-2 bg-black/20 px-2 py-1 rounded-lg border border-white/5">
                                        <SpriteIcon name="PetKey" size={16} />

                                        <button
                                            onClick={() => setDungeonKeys(Math.max(1, dungeonKeys - 1))}
                                            className="p-1 hover:bg-white/10 rounded transition-colors text-text-secondary hover:text-white"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>

                                        <input
                                            type="number"
                                            min="1"
                                            value={dungeonKeys}
                                            onChange={(e) => setDungeonKeys(Math.max(1, parseInt(e.target.value) || 0))}
                                            className="w-10 bg-transparent text-center font-bold outline-none text-white border-b border-transparent focus:border-accent-primary transition-colors appearance-none"
                                        />

                                        <button
                                            onClick={() => setDungeonKeys(dungeonKeys + 1)}
                                            className="p-1 hover:bg-white/10 rounded transition-colors text-text-secondary hover:text-white"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2 bg-accent-primary/10 px-3 py-1.5 rounded-lg border border-accent-primary/20">
                                        <Egg className="w-4 h-4 text-accent-primary" />
                                        <span className="font-bold text-accent-primary text-base">{(todayTotalDrops || 0).toFixed(2)}</span>
                                        <span className="text-text-secondary">Expected</span>
                                    </div>
                                </div>
                            </CardTitle>
                        </CardHeader>

                        <CardContent>
                            {stageDropRates.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {stageDropRates.map((item) => (
                                        <div
                                            key={item.tier}
                                            className={cn(
                                                "relative flex items-center gap-4 p-4 rounded-xl border transition-all hover:scale-[1.02]",
                                                `bg-rarity-${item.tier}/5 border-rarity-${item.tier}/20 hover:border-rarity-${item.tier}/50`
                                            )}
                                        >
                                            {/* Icon */}
                                            <div className="shrink-0">
                                                <EggIcon rarity={item.tier} size={56} className="drop-shadow-lg" />
                                            </div>

                                            {/* Details */}
                                            <div className="flex-1 space-y-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className={cn("text-lg font-black uppercase tracking-wide", `text-rarity-${item.tier}`)}>
                                                        {item.tier}
                                                    </div>
                                                    <div className="text-xs font-bold bg-black/40 px-2 py-0.5 rounded text-white/90 border border-white/5">
                                                        ~ {(todayTotalDrops * item.probability).toFixed(2)}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] text-text-tertiary uppercase font-bold">Chance</span>
                                                        <span className="text-sm font-bold text-white">
                                                            {(item.probability * 100).toFixed(2)}%
                                                        </span>
                                                    </div>

                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[10px] text-text-tertiary uppercase font-bold">Hatch Time</span>
                                                        <div className="flex items-center gap-1.5 text-sm font-mono text-accent-secondary">
                                                            <SpriteIcon name="Timer" size={14} />
                                                            {formatTime(hatchingTimes?.[item.tier] || 0)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Background Decoration */}
                                            <div className={cn("absolute inset-0 rounded-xl opacity-5 pointer-events-none", `bg-rarity-${item.tier}`)} />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-text-muted bg-black/20 rounded-xl border border-white/5">
                                    <p>No drop data found for Stage {getStageLabel(selectedStage)}</p>
                                    <p className="text-xs mt-2 text-text-tertiary">Try selecting a different level</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
