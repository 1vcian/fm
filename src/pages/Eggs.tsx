import { useState } from 'react';
import { useEggsCalculator } from '../hooks/useEggsCalculator';
import { eggDropRates } from '../constants/eggData';
import { Card, CardHeader, CardTitle, CardContent } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { Select } from '../components/UI/Select';
import { cn } from '../lib/utils';
import { Egg, Clock, Calculator, Percent } from 'lucide-react';
import { SpriteIcon } from '../components/UI/SpriteIcon';

// Assumption: EggIcons.png exists and follows the 4x4 grid pattern (0-15)
const EGG_SPRITE_SHEET = './icons/game/EggIcons.png';
const EGG_SPRITE_SIZE = 256;
const EGG_TEXTURE_SIZE = 1024; // 4 * 256 = 1024

function EggIcon({ rarity, size = 48, className }: { rarity: string; size?: number; className?: string }) {
    const rarityIndex: Record<string, number> = {
        'Common': 0,
        'Rare': 1,
        'Epic': 2,
        'Legendary': 3,
        'Ultimate': 4,
        'Mythic': 5 // Assuming order
    };

    const idx = rarityIndex[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);

    // Calculate BG position
    const ratio = size / EGG_SPRITE_SIZE;
    const bgWidth = EGG_TEXTURE_SIZE * ratio;
    const bgHeight = EGG_TEXTURE_SIZE * ratio;
    const bgX = -(col * EGG_SPRITE_SIZE * ratio);
    const bgY = -(row * EGG_SPRITE_SIZE * ratio);

    return (
        <div
            className={cn("inline-block shrink-0", className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${EGG_SPRITE_SHEET})`,
                backgroundPosition: `${bgX}px ${bgY}px`,
                backgroundSize: `${bgWidth}px ${bgHeight}px`,
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
        availableSlots, setAvailableSlots,
        optimization,
        hatchValues,
        difficulty, setDifficulty,
        speedBonus, setSpeedBonus,
        hatchingTimes,
        probabilityData
    } = useEggsCalculator();

    const availableStages = Object.keys(eggDropRates);

    const [activeTab, setActiveTab] = useState<'calculator' | 'info'>('calculator');

    const formatTime = (seconds: number) => {
        const minutes = seconds / 60;
        if (minutes >= 1440) {
            const days = Math.floor(minutes / 1440);
            const hours = Math.floor((minutes % 1440) / 60);
            return `${days}d ${hours}h`;
        } else if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = Math.round(minutes % 60);
            return `${hours}h ${mins}m`;
        }
        return `${Math.round(minutes)}m`;
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
                                    <Clock className="w-5 h-5 text-accent-tertiary" />
                                    Parameters
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <Input
                                        label="Hours Available"
                                        type="number"
                                        value={timeLimitHours}
                                        onChange={(e) => setTimeLimitHours(Math.max(1, parseFloat(e.target.value) || 0))}
                                    />
                                    <div className="relative">
                                        <Input
                                            label="Slots Available"
                                            type="number"
                                            value={availableSlots}
                                            onChange={(e) => setAvailableSlots(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="pl-10"
                                        />
                                        <div className="absolute left-3 top-8 pointer-events-none">
                                            <SpriteIcon name="PetKey" size={20} />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Egg className="w-5 h-5 text-accent-primary" />
                                    Inventory
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    {Object.entries(ownedEggs).map(([rarity, count]) => (
                                        <div key={rarity} className="flex flex-col items-center gap-2 p-3 bg-bg-tertiary rounded-lg border border-border/50">
                                            <EggIcon rarity={rarity} size={48} />
                                            <span className={cn("text-xs font-bold uppercase", `text-rarity-${rarity}`)}>
                                                {rarity}
                                            </span>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={count}
                                                onChange={(e) => updateOwnedEggs(rarity, parseInt(e.target.value) || 0)}
                                                className="text-center h-8"
                                            />
                                            {hatchValues && hatchValues[rarity] && (
                                                <span className="text-[10px] text-text-tertiary">
                                                    {formatTime(hatchValues[rarity])}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Results Section */}
                    <div className="space-y-6">
                        <Card className="h-full border-accent-primary/20 bg-accent-primary/5">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Configuration</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <Select
                                    label="Stage Difficulty"
                                    value={difficulty}
                                    onChange={(e) => setDifficulty(e.target.value)}
                                >
                                    {availableStages.map(stage => (
                                        <option key={stage} value={stage}>Stage {stage}</option>
                                    ))}
                                </Select>

                                <Input
                                    label="Tech Tree Speed Bonus (%)"
                                    type="number"
                                    value={speedBonus || ''}
                                    onChange={(e) => setSpeedBonus(parseFloat(e.target.value) || 0)}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-accent-tertiary" />
                                    Drop Rates & Hatching Times
                                </CardTitle>
                            </CardHeader>

                            <CardContent className="space-y-3">
                                {probabilityData.map((item) => (
                                    <div
                                        key={item.tier}
                                        className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg border border-border"
                                    >
                                        <div className="flex flex-col">
                                            <span className={cn("font-bold uppercase text-xs", `text-rarity-${item.tier}`)}>
                                                {item.tier}
                                            </span>
                                            <span className="text-sm font-medium text-text-primary">
                                                {(item.probability * 100).toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-text-secondary">
                                            <Clock className="w-4 h-4" />
                                            <span className="text-sm font-mono">
                                                {formatTime(hatchingTimes[item.tier])}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
}
