import { useProfile } from '../../context/ProfileContext';
import { Card } from '../UI/Card';
import { Cat, Plus, X, Minus, Pencil, Bookmark } from 'lucide-react';
import { Button } from '../UI/Button';
import { PetSlot } from '../../types/Profile';
import { useState } from 'react';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { MAX_ACTIVE_PETS } from '../../utils/constants';
import { PetSelectorModal } from './PetSelectorModal';
import { useGameData } from '../../hooks/useGameData';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { formatSecondaryStat } from '../../utils/statNames';
import { InputModal } from '../UI/InputModal';

export function PetPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const activePets = profile.pets.active;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPetIdx, setEditingPetIdx] = useState<number | null>(null);
    const [petToSave, setPetToSave] = useState<PetSlot | null>(null);

    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petBalancing } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUpgradeLib } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');

    // Helper to calculate item perfection (avg of secondary stats vs max)
    const getPerfection = (item: PetSlot): number | null => {
        if (!item.secondaryStats || item.secondaryStats.length === 0 || !secondaryStatLibrary) return null;

        let totalPercent = 0;
        let count = 0;

        for (const stat of item.secondaryStats) {
            const libStat = secondaryStatLibrary[stat.statId];
            if (libStat && libStat.UpperRange > 0) {
                const maxVal = libStat.UpperRange * 100;
                if (maxVal > 0) {
                    const percent = (stat.value / maxVal) * 100;
                    totalPercent += Math.min(100, percent);
                    count++;
                }
            }
        }

        return count > 0 ? totalPercent / count : null;
    };

    const getStatPerfection = (statIdx: string, value: number): number | null => {
        if (!secondaryStatLibrary) return null;
        const libStat = secondaryStatLibrary[statIdx];
        if (libStat && libStat.UpperRange > 0) {
            return Math.min(100, (value / (libStat.UpperRange * 100)) * 100);
        }
        return null;
    };

    // Get tech tree modifiers for current tree mode
    const techModifiers = useTreeModifiers();
    const petDamageBonus = techModifiers['PetBonusDamage'] || 0;
    const petHealthBonus = techModifiers['PetBonusHealth'] || 0;

    const handleRemove = (index: number) => {
        const newPets = [...activePets];
        newPets.splice(index, 1);
        updateNestedProfile('pets', { active: newPets });
    };

    const handleAdd = (pet: PetSlot) => {
        if (activePets.length >= MAX_ACTIVE_PETS) return;
        updateNestedProfile('pets', { active: [...activePets, pet] });
        setIsModalOpen(false);
    };

    const handleEditPet = (index: number, pet: PetSlot) => {
        const newPets = [...activePets];
        newPets[index] = pet;
        updateNestedProfile('pets', { active: newPets });
        setEditingPetIdx(null);
    };

    const handleLevelChange = (index: number, delta: number) => {
        const pet = activePets[index];
        const newLevel = Math.max(1, Math.min(200, pet.level + delta)); // Assuming max 200
        const newPets = [...activePets];
        newPets[index] = { ...pet, level: newLevel };
        updateNestedProfile('pets', { active: newPets });
    };

    const handleConfirmSave = (name: string) => {
        if (!petToSave) return;
        const saved = profile.pets.savedBuilds || [];

        // Find if already saved (fuzzy match by content, ignoring name)
        const existingIdx = saved.findIndex(s =>
            s.id === petToSave.id && s.rarity === petToSave.rarity && s.level === petToSave.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(petToSave.secondaryStats)
        );

        if (existingIdx >= 0) {
            // Update existing preset name
            const newSaved = [...saved];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('pets', {
                savedBuilds: newSaved
            });
        } else {
            // Create New
            const newPreset: PetSlot = { ...petToSave, customName: name || undefined };
            updateNestedProfile('pets', {
                savedBuilds: [...saved, newPreset]
            });
        }
        setPetToSave(null);
    };

    // Get pet type from library
    const getPetType = (pet: PetSlot) => {
        const key = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
        return petLibrary?.[key]?.Type || 'Balanced';
    };

    const getSpriteInfo = (petId: number, rarity: string) => {
        if (!spriteMapping?.pets?.mapping) return null;
        // Mapping is index (string) -> { id: number, ... }
        // Find entry with id === petId AND rarity === rarity
        const entry = Object.entries(spriteMapping.pets.mapping).find(([_, val]: [string, any]) => val.id === petId && val.rarity === rarity);
        if (entry) {
            return {
                spriteIndex: parseInt(entry[0]),
                config: spriteMapping.pets,
                name: (entry[1] as any).name
            };
        }
        return null;
    };

    // Determine modal props based on whether we are updating or creating
    const getModalProps = () => {
        if (!petToSave) return { title: '', label: '', initialValue: '' };

        const saved = profile.pets.savedBuilds || [];
        const existingMatch = saved.find(s =>
            s.id === petToSave.id && s.rarity === petToSave.rarity && s.level === petToSave.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(petToSave.secondaryStats)
        );

        // Use getSpriteInfo to get the pet name
        const petSpriteInfo = getSpriteInfo(petToSave.id, petToSave.rarity);
        const baseName = petSpriteInfo?.name || `${petToSave.rarity} Pet #${petToSave.id}`;

        if (existingMatch) {
            return {
                title: 'Update Saved Preset',
                label: 'Preset Name (Already Saved)',
                initialValue: existingMatch.customName || baseName
            };
        }
        return {
            title: 'Save Pet Preset',
            label: 'Preset Name',
            initialValue: baseName
        };
    };

    const modalProps = getModalProps();

    return (
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center">
                    <SpriteSheetIcon
                        textureSrc="./Texture2D/Icons.png"
                        spriteWidth={256}
                        spriteHeight={256}
                        sheetWidth={2048}
                        sheetHeight={2048}
                        iconIndex={14}
                        className="w-8 h-8"
                    />
                </div>
                Active Pets
            </h2>

            <div className="space-y-3">
                {activePets.map((pet, idx) => {
                    const petType = getPetType(pet);
                    const typeMultipliers = petBalancing?.[petType] || { DamageMultiplier: 1, HealthMultiplier: 1 };
                    const spriteInfo = getSpriteInfo(pet.id, pet.rarity);

                    const isSaved = (profile.pets.savedBuilds || []).some(s =>
                        s.id === pet.id && s.rarity === pet.rarity && s.level === pet.level &&
                        JSON.stringify(s.secondaryStats) === JSON.stringify(pet.secondaryStats)
                    );

                    return (
                        <div key={idx} className="p-3 bg-bg-secondary rounded-lg border border-border">
                            {/* Header: Icon, Name, Type */}
                            <div className="flex items-center gap-3 mb-2">
                                <div
                                    className={cn(
                                        "w-12 h-12 rounded-xl flex items-center justify-center border-2 overflow-hidden shrink-0",
                                        `border-rarity-${pet.rarity.toLowerCase()}`
                                    )}
                                    style={getRarityBgStyle(pet.rarity)}
                                >
                                    {spriteInfo ? (
                                        <SpriteSheetIcon
                                            textureSrc="./icons/game/Pets.png"
                                            spriteWidth={spriteInfo.config.sprite_size.width}
                                            spriteHeight={spriteInfo.config.sprite_size.height}
                                            sheetWidth={spriteInfo.config.texture_size.width}
                                            sheetHeight={spriteInfo.config.texture_size.height}
                                            iconIndex={spriteInfo.spriteIndex}
                                            className="w-12 h-12"
                                        />
                                    ) : (
                                        <Cat className={cn("w-6 h-6", `text-rarity-${pet.rarity.toLowerCase()}`)} />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-sm truncate">{spriteInfo?.name || `${pet.rarity} Pet #${pet.id}`}</div>
                                    <div className="text-xs text-text-muted truncate">
                                        Type: <span className={cn(
                                            petType === 'Damage' ? 'text-red-400' :
                                                petType === 'Health' ? 'text-green-400' : 'text-blue-400'
                                        )}>{petType}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="mb-3">
                                <div className="text-xs text-text-muted">
                                    {(() => {
                                        const upgradeData = petUpgradeLib?.[pet.rarity];
                                        if (upgradeData?.LevelInfo) {
                                            const targetLevel = Math.max(0, pet.level - 1);
                                            const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === targetLevel) || upgradeData.LevelInfo[0];

                                            let damage = 0;
                                            let health = 0;

                                            if (levelInfo?.PetStats?.Stats) {
                                                for (const stat of levelInfo.PetStats.Stats) {
                                                    const val = stat.Value || 0;
                                                    if (stat.StatNode?.UniqueStat?.StatType === 'Damage') {
                                                        damage = val * typeMultipliers.DamageMultiplier * (1 + petDamageBonus);
                                                    }
                                                    if (stat.StatNode?.UniqueStat?.StatType === 'Health') {
                                                        health = val * typeMultipliers.HealthMultiplier * (1 + petHealthBonus);
                                                    }
                                                }
                                            }

                                            return (
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                                                    <span className="text-red-400 font-mono whitespace-nowrap">
                                                        DMG: {Math.round(damage).toLocaleString()}
                                                        {petDamageBonus > 0 && <span className="text-green-400 ml-1">(+{(petDamageBonus * 100).toFixed(0)}%)</span>}
                                                    </span>
                                                    <span className="text-green-400 font-mono">
                                                        HP: {Math.round(health).toLocaleString()}
                                                        {petHealthBonus > 0 && <span className="text-green-400 ml-1">(+{(petHealthBonus * 100).toFixed(0)}%)</span>}
                                                    </span>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>

                            {/* Controls Columns */}
                            <div className="flex flex-col gap-2 pt-2 border-t border-border/30">
                                {/* Level Controls - Centered */}
                                <div className="flex items-center justify-center w-full">
                                    <div className="flex items-center gap-4 bg-bg-input/50 rounded-lg px-2 py-1 border border-border/30 w-full justify-between">
                                        <span className="text-xs font-mono font-bold text-text-muted">Level</span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleLevelChange(idx, -1)}
                                                className="w-6 h-6 flex items-center justify-center bg-bg-input hover:bg-bg-secondary rounded text-text-muted hover:text-text-primary transition-colors border border-border/20"
                                            >
                                                <Minus className="w-3 h-3" />
                                            </button>
                                            <span className="text-xs font-mono font-bold w-8 text-center bg-transparent">
                                                {pet.level}
                                            </span>
                                            <button
                                                onClick={() => handleLevelChange(idx, 1)}
                                                className="w-6 h-6 flex items-center justify-center bg-bg-input hover:bg-bg-secondary rounded text-text-muted hover:text-text-primary transition-colors border border-border/20"
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons - Full Width Row */}
                                <div className="flex items-center gap-1 w-full">
                                    <button
                                        onClick={() => setEditingPetIdx(idx)}
                                        className="flex-1 min-w-0 flex items-center justify-center gap-1 text-xs font-bold text-text-muted hover:text-accent-primary py-1.5 px-1 bg-bg-input hover:bg-bg-input/80 rounded-lg transition-colors border border-border/20"
                                        title="Edit passives"
                                    >
                                        <Pencil className="w-3.5 h-3.5 shrink-0" />
                                        <span className="hidden xl:inline whitespace-nowrap">Edit</span>
                                    </button>

                                    <button
                                        onClick={() => setPetToSave(pet)}
                                        className={cn(
                                            "flex-1 min-w-0 flex items-center justify-center gap-1 text-xs font-bold py-1.5 px-1 rounded-lg transition-colors border border-border/20 bg-bg-input hover:bg-bg-input/80",
                                            isSaved ? "text-accent-primary" : "text-text-muted hover:text-green-400"
                                        )}
                                        title={isSaved ? "Update Preset Name" : "Save as Preset"}
                                    >
                                        <Bookmark className={cn("w-3.5 h-3.5 shrink-0", isSaved && "fill-accent-primary")} />
                                        <span className="hidden xl:inline whitespace-nowrap">{isSaved ? "Saved" : "Save"}</span>
                                    </button>

                                    <button
                                        onClick={() => handleRemove(idx)}
                                        className="flex-1 min-w-0 flex items-center justify-center gap-1 text-xs font-bold text-text-muted hover:text-red-400 py-1.5 px-1 bg-bg-input hover:bg-bg-input/80 rounded-lg transition-colors border border-border/20"
                                    >
                                        <X className="w-3.5 h-3.5 shrink-0" />
                                        <span className="hidden xl:inline whitespace-nowrap">Remove</span>
                                    </button>
                                </div>
                            </div>

                            {/* Show passives if any */}
                            {pet.secondaryStats && pet.secondaryStats.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1">
                                    <div className="flex flex-wrap gap-1">
                                        {pet.secondaryStats.map((stat, sIdx) => {
                                            const formatted = formatSecondaryStat(stat.statId, stat.value);
                                            const statPerf = getStatPerfection(stat.statId, stat.value);
                                            return (
                                                <span key={sIdx} className={cn("text-xs bg-bg-input px-2 py-0.5 rounded flex items-center gap-1", formatted.color)}>
                                                    <span>{formatted.name}:</span>
                                                    <span className="font-mono font-bold">{formatted.formattedValue}</span>
                                                    {statPerf !== null && (
                                                        <span className={cn(
                                                            "text-[9px] opacity-80",
                                                            statPerf >= 100 ? "text-yellow-400" :
                                                                statPerf >= 80 ? "text-green-500" :
                                                                    statPerf >= 50 ? "text-blue-400" : "text-gray-500"
                                                        )}>
                                                            ({statPerf.toFixed(0)}%)
                                                        </span>
                                                    )}
                                                </span>
                                            );
                                        })}
                                    </div>

                                    {/* Perfection Bar */}
                                    {(() => {
                                        const perfection = getPerfection(pet);
                                        if (perfection !== null) {
                                            const colorClass = perfection >= 100 ? 'bg-yellow-400' :
                                                perfection >= 80 ? 'bg-green-500' :
                                                    perfection >= 50 ? 'bg-blue-500' : 'bg-gray-500';

                                            return (
                                                <div className="w-full mt-1 flex flex-col gap-0.5" title={`Perfection: ${perfection.toFixed(1)}%`}>
                                                    <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${colorClass}`}
                                                            style={{ width: `${Math.min(100, perfection)}%` }}
                                                        />
                                                    </div>
                                                    <div className="text-[7px] text-right text-text-muted leading-none">
                                                        {perfection.toFixed(0)}% Perfect
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                        </div>
                    );
                })}

                {activePets.length < MAX_ACTIVE_PETS && (
                    <Button variant="outline" className="w-full border-dashed py-8 hover:bg-bg-secondary/50 group" onClick={() => setIsModalOpen(true)}>
                        <div className="flex flex-col items-center gap-2 text-text-muted group-hover:text-accent-primary transition-colors">
                            <Plus className="w-8 h-8" />
                            <span>Add Active Pet</span>
                        </div>
                    </Button>
                )}
            </div>

            {/* Add new pet modal */}
            <PetSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleAdd}
            />

            {/* Edit existing pet modal */}
            {
                editingPetIdx !== null && (
                    <PetSelectorModal
                        isOpen={true}
                        onClose={() => setEditingPetIdx(null)}
                        onSelect={(pet) => handleEditPet(editingPetIdx, pet)}
                        currentPet={activePets[editingPetIdx]}
                    />
                )
            }

            <InputModal
                isOpen={!!petToSave}
                title={modalProps.title}
                label={modalProps.label}
                placeholder="Preset Name"
                initialValue={modalProps.initialValue}
                onConfirm={handleConfirmSave}
                onCancel={() => setPetToSave(null)}
            />
        </Card>
    );
}
