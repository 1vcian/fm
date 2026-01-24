import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Plus, Minus } from 'lucide-react';

export function MiscPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const { data: petConfig } = useGameData<any>('PetBaseConfig.json');

    const updateMisc = (key: keyof typeof profile.misc, value: number) => {
        updateNestedProfile('misc', { [key]: value });
    };

    const minEggSlots = Math.max(2, petConfig?.EggHatchSlotStartCount || 2);
    const maxEggSlots = petConfig?.EggHatchSlotMaxCount || 4;

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
                                    updateMisc('forgeLevel', val);
                                }
                            }}
                            onFocus={(e) => e.target.select()}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateMisc('forgeLevel', profile.misc.forgeLevel + 1)}
                        >
                            <Plus className="w-4 h-4" />
                        </Button>
                    </div>
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
