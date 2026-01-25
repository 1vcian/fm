import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useForgeUpgradeStats } from '../../hooks/useForgeCalculator';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Plus, Minus } from 'lucide-react';

export function MiscPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: petConfig } = useGameData<any>('PetBaseConfig.json');
    const { data: forgeData } = useGameData<any>('ForgeUpgradeLibrary.json');

    // Determine max forge level from config
    const maxForgeLevel = forgeData ? Math.max(...Object.keys(forgeData).map(Number)) : 99;

    // Fix for "off by one" error reported by user.
    // Updated usage: Hook now expects the Level Key directly.
    // If we are Level 22, we want to see upgrade 22->23? Or 21->22?
    // Profile Level 21 means I have completed 21?
    // Usually "Level 21" means I am at 21, next upgrade is 21 -> 22.
    // Excel 21->22 is Key 21.
    // So if Level=21, pass 21.
    const upgradeStats = useForgeUpgradeStats(profile.misc.forgeLevel);

    const updateMisc = (key: keyof typeof profile.misc, value: number) => {
        updateNestedProfile('misc', { [key]: value });
    };

    const minEggSlots = Math.max(2, petConfig?.EggHatchSlotStartCount || 2);
    const maxEggSlots = petConfig?.EggHatchSlotMaxCount || 4;

    // Format seconds to H:M:S or similar
    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${Math.ceil(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m ${Math.ceil(seconds % 60)}s`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ${Math.ceil(mins % 60)}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h ${Math.ceil(mins % 60)}m`;
    };

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
                <img src="./Texture2D/SettingsIcon.png" alt="Settings" className="w-8 h-8 object-contain" />
                Global Settings
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Forge Level */}
                <Card className="p-4 bg-bg-secondary/40 border-border/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-bg-input flex items-center justify-center p-1">
                            <img src="./Texture2D/Anvil.png" alt="Forge" className="w-full h-full object-contain" />
                        </div>
                        <div>
                            <div className="font-bold">Forge Level</div>
                            <div className="text-xs text-text-muted">Affects enhancement costs</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-between bg-bg-input p-2 rounded-lg border border-border">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateMisc('forgeLevel', Math.max(1, profile.misc.forgeLevel - 1))}
                        >
                            <Minus className="w-4 h-4" />
                        </Button>
                        <input
                            type="number"
                            className="bg-transparent text-center font-mono font-bold text-lg w-20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={profile.misc.forgeLevel}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val >= 1) {
                                    updateMisc('forgeLevel', Math.min(maxForgeLevel, val));
                                }
                            }}
                            onFocus={(e) => e.target.select()}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateMisc('forgeLevel', Math.min(maxForgeLevel, profile.misc.forgeLevel + 1))}
                            disabled={profile.misc.forgeLevel >= maxForgeLevel}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
                    {/* Upgrade Cost Display */}
                    {upgradeStats ? (
                        <div className="mt-3 space-y-2 text-[10px] font-mono">
                            {/* Costs */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col items-center bg-yellow-500/10 py-2 rounded border border-yellow-500/20">
                                    <span className="text-yellow-500/80 font-bold mb-1">Total Cost</span>
                                    <span className="font-bold text-yellow-400 text-sm">
                                        {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(upgradeStats.cost)}
                                    </span>
                                    {upgradeStats.reduction > 0 && (
                                        <span className="text-text-muted line-through text-[9px]">
                                            {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(upgradeStats.baseCost)}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-col items-center bg-yellow-500/5 py-2 rounded border border-yellow-500/10">
                                    <span className="text-yellow-500/70 font-bold mb-1">Cost / Step</span>
                                    <span className="font-bold text-yellow-400">
                                        {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(upgradeStats.costPerTier)}
                                    </span>
                                    <span className="text-[9px] text-text-muted">
                                        {upgradeStats.tiers} Steps
                                    </span>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex flex-col items-center bg-bg-input py-2 rounded border border-border">
                                    <span className="text-text-muted font-bold mb-1">Hammers (Total)</span>
                                    <span className="font-bold text-text-primary">
                                        {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(upgradeStats.hammersToUpgrade)}
                                    </span>
                                    {upgradeStats.freeForgeChance > 0 && (
                                        <span className="text-[9px] text-text-muted line-through">
                                            {new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(upgradeStats.rawHammersNeeded)}
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-col items-center bg-bg-input py-2 rounded border border-border">
                                    <span className="text-text-muted font-bold mb-1">Time</span>
                                    <span className="font-bold text-text-primary">
                                        {formatTime(upgradeStats.totalTimeSeconds)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2 text-center text-xs text-text-muted">Max Level Reached</div>
                    )}
                </Card>

                {/* Egg Slots */}
                <Card className="p-4 bg-bg-secondary/40 border-border/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-bg-input flex items-center justify-center p-1">
                            <img src="./Texture2D/HatchBed.png" alt="Egg Slots" className="w-full h-full object-contain" />
                        </div>
                        <div>
                            <div className="font-bold">Egg Slots</div>
                            <div className="text-xs text-text-muted">Max hatching capacity ({minEggSlots}-{maxEggSlots})</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-between bg-bg-input p-2 rounded-lg border border-border">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateMisc('eggSlots', Math.max(minEggSlots, profile.misc.eggSlots - 1))}
                            disabled={profile.misc.eggSlots <= minEggSlots}
                        >
                            <Minus className="w-4 h-4" />
                        </Button>
                        <span className="font-mono font-bold text-lg">{profile.misc.eggSlots}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateMisc('eggSlots', Math.min(maxEggSlots, profile.misc.eggSlots + 1))}
                            disabled={profile.misc.eggSlots >= maxEggSlots}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
