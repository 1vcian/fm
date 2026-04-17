import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { Card } from '../UI/Card';
import { Zap as PowerIcon, Plus, Cat, Sword } from 'lucide-react';
import { Button } from '../UI/Button';
import { PetSlot } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { MAX_ACTIVE_PETS } from '../../utils/constants';
import { PetSelectorModal } from './PetSelectorModal';
import { useGameData } from '../../hooks/useGameData';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';

import { InputModal } from '../UI/InputModal';
import { AscensionStars } from '../UI/AscensionStars';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';

interface PetPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    comparePets?: PetSlot[] | null;
}

export function PetPanel({ variant = 'default', title, comparePets }: PetPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { 
        isComparing, 
        originalPets, 
        testPets, 
        originalPetAscension, 
        testPetAscension,
        updateOriginalPet,
        updateTestPet,
        updateOriginalPetAscension,
        updateTestPetAscension
    } = useComparison();
    const { optimizePets, isReady } = useProfileOptimizer();
    
    const activePets = useMemo(() => {
        if (variant === 'original' && originalPets) return originalPets;
        if (variant === 'test' && testPets) return testPets;
        return profile.pets.active;
    }, [variant, originalPets, testPets, profile.pets.active]);

    const petAscensionLevel = useMemo(() => {
        if (isComparing) {
            if (variant === 'original' && originalPetAscension !== null) return originalPetAscension;
            if (variant === 'test' && testPetAscension !== null) return testPetAscension;
        }
        return profile.misc.petAscensionLevel || 0;
    }, [isComparing, variant, originalPetAscension, testPetAscension, profile.misc.petAscensionLevel]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPetIdx, setEditingPetIdx] = useState<number | null>(null);
    const [petToSave, setPetToSave] = useState<PetSlot | null>(null);

    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petBalancing } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUpgradeLib } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
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

    // Pet Ascension multipliers
    const { ascensionDmgMulti, ascensionHpMulti } = useMemo(() => {
        let dMulti = 0;
        let hMulti = 0;

        if (petAscensionLevel > 0 && ascensionConfigsLibrary?.Pets?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Pets.AscensionConfigPerLevel;
            for (let i = 0; i < petAscensionLevel && i < ascConfigs.length; i++) {
                const stats = ascConfigs[i].StatContributions || [];
                for (const s of stats) {
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    const sVal = s.Value;
                    if (sType === 'Damage') dMulti += sVal;
                    if (sType === 'Health') hMulti += sVal;
                }
            }
        }
        return { ascensionDmgMulti: dMulti, ascensionHpMulti: hMulti };
    }, [petAscensionLevel, ascensionConfigsLibrary]);

    const updatePets = (newPets: PetSlot[]) => {
        if (variant === 'original') updateOriginalPet(newPets);
        else if (variant === 'test') updateTestPet(newPets);
        else updateNestedProfile('pets', { active: newPets });
    };

    const handleRemove = (index: number) => {
        const newPets = [...activePets];
        newPets.splice(index, 1);
        updatePets(newPets);
    };

    const handleAdd = (pet: PetSlot | null) => {
        if (!pet) {
            setIsModalOpen(false);
            return;
        }
        if (activePets.length >= MAX_ACTIVE_PETS) return;
        updatePets([...activePets, pet]);
        setIsModalOpen(false);
    };

    const handleEditPet = (index: number, pet: PetSlot | null) => {
        if (!pet) {
            handleRemove(index);
            setEditingPetIdx(null);
            return;
        }
        const newPets = [...activePets];
        newPets[index] = pet;
        updatePets(newPets);
        setEditingPetIdx(null);
    };

    const handleLevelChange = (index: number, delta: number) => {
        const pet = activePets[index];
        const maxLevel = petUpgradeLib?.[pet.rarity]?.LevelInfo?.length || 100;
        const newLevel = Math.max(1, Math.min(maxLevel, pet.level + delta));
        const newPets = [...activePets];
        newPets[index] = { ...pet, level: newLevel };
        updatePets(newPets);
    };

    const handleAscensionChange = (val: number) => {
        if (isComparing) {
            if (variant === 'original') updateOriginalPetAscension(val);
            else if (variant === 'test') updateTestPetAscension(val);
        } else {
            updateNestedProfile('misc', { petAscensionLevel: val });
        }
    };

    const handleAutoOptimize = (metric: 'dps' | 'power') => {
        const best = optimizePets(metric);
        if (best) updatePets(best);
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

    const getModalProps = () => {
        if (!petToSave) return { title: '', label: '', initialValue: '' };

        const saved = profile.pets.savedBuilds || [];
        const existingMatch = saved.find(s =>
            s.id === petToSave.id && s.rarity === petToSave.rarity && s.level === petToSave.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(petToSave.secondaryStats)
        );

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
    const panelTitle = title || 'Active Pets';

    const checkDiff = (index: number) => {
        if (variant !== 'test' || !comparePets) return false;
        const current = activePets[index];
        const original = comparePets[index];
        if (!current && !original) return false;
        if (!current || !original) return true;
        return current.id !== original.id || current.rarity !== original.rarity || current.level !== original.level || JSON.stringify(current.secondaryStats) !== JSON.stringify(original.secondaryStats);
    };

    return (
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center">
                    <SpriteSheetIcon
                        textureSrc={`${import.meta.env.BASE_URL}Texture2D/Icons.png`}
                        spriteWidth={256}
                        spriteHeight={256}
                        sheetWidth={2048}
                        sheetHeight={2048}
                        iconIndex={14}
                        className="w-8 h-8"
                    />
                </div>
                {panelTitle}
                
                <div className="flex items-center gap-1.5 ml-4">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 px-2 text-[10px] font-bold border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 gap-1 active:scale-95 transition-all"
                        onClick={() => handleAutoOptimize('dps')}
                        disabled={!isReady || (profile.pets.savedBuilds?.length || 0) < 1}
                        title="Select best 3 saved pets for Max DPS"
                    >
                        <Sword className="w-3 h-3" />
                        AUTO DPS
                    </Button>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        className="h-7 px-2 text-[10px] font-bold border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40 text-amber-500 gap-1 active:scale-95 transition-all"
                        onClick={() => handleAutoOptimize('power')}
                        disabled={!isReady || (profile.pets.savedBuilds?.length || 0) < 1}
                        title="Select best 3 saved pets for Max Power"
                    >
                        <PowerIcon className="w-3 h-3" />
                        AUTO POWER
                    </Button>
                </div>

                <div className="ml-auto">
                    <AscensionStars 
                        value={petAscensionLevel}
                        onChange={handleAscensionChange}
                    />
                </div>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Array.from({ length: MAX_ACTIVE_PETS }).map((_, idx) => {
                    const pet = activePets[idx];
                    const hasDiff = checkDiff(idx);
                    
                    if (!pet) {
                        return (
                            <div 
                                key={`empty-${idx}`}
                                onClick={() => setIsModalOpen(true)}
                                className={cn(
                                    "h-full min-h-[180px] rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-all relative flex flex-col items-center justify-center p-3 bg-bg-input/10 group",
                                    hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
                                )}
                            >
                                <div className="p-3 bg-bg-secondary/50 rounded-full mb-2 group-hover:scale-110 transition-transform border border-white/5">
                                    <Plus className="w-6 h-6 text-text-muted opacity-50" />
                                </div>
                                <span className="text-sm text-text-muted font-bold">Empty Slot</span>
                                <span className="text-[10px] text-text-muted/40 uppercase tracking-widest mt-1">Click to equip</span>
                            </div>
                        );
                    }

                    const petType = getPetType(pet);
                    const typeMultipliers = petBalancing?.[petType] || { DamageMultiplier: 1, HealthMultiplier: 1 };
                    const spriteInfo = getSpriteInfo(pet.id, pet.rarity);
                    const isSaved = (profile.pets.savedBuilds || []).some(s =>
                        s.id === pet.id && s.rarity === pet.rarity && s.level === pet.level &&
                        JSON.stringify(s.secondaryStats) === JSON.stringify(pet.secondaryStats)
                    );

                    const upgradeData = petUpgradeLib?.[pet.rarity];
                    const targetLevel = Math.max(0, pet.level - 1);
                    const levelInfo = upgradeData?.LevelInfo?.find((l: any) => l.Level === targetLevel) || (upgradeData?.LevelInfo?.[0]);

                    let damage = 0;
                    let health = 0;

                    if (levelInfo?.PetStats?.Stats) {
                        for (const stat of levelInfo.PetStats.Stats) {
                            const val = stat.Value || 0;
                            if (stat.StatNode?.UniqueStat?.StatType === 'Damage') {
                                damage = val * typeMultipliers.DamageMultiplier * (1 + petDamageBonus + ascensionDmgMulti);
                            }
                            if (stat.StatNode?.UniqueStat?.StatType === 'Health') {
                                health = val * typeMultipliers.HealthMultiplier * (1 + petHealthBonus + ascensionHpMulti);
                            }
                        }
                    }

                    return (
                        <ItemSelectionCard
                            key={idx}
                            item={pet}
                            slotKey={`pet-${idx}`}
                            slotLabel={`Pet Slot ${idx + 1}`}
                            itemName={spriteInfo?.name || `${pet.rarity} Pet`}
                            itemImage={null}
                            rarity={pet.rarity}
                            hideAgeStyles={true}
                            hasDiff={hasDiff}
                            isSaved={isSaved}
                            globalAscensionLevel={petAscensionLevel}
                            onAscensionChange={handleAscensionChange}
                            stats={{
                                damage: damage,
                                health: health,
                                damageMulti: 1 + petDamageBonus + ascensionDmgMulti,
                                healthMulti: 1 + petHealthBonus + ascensionHpMulti,
                                isMelee: false
                            }}
                            customStats={(
                                <div className={cn(
                                    "text-[9px] font-black uppercase tracking-widest text-center w-full mt-1 px-2 py-0.5 rounded bg-black/20 border border-white/5",
                                    petType === 'Damage' ? 'text-red-400 border-red-400/20' :
                                        petType === 'Health' ? 'text-green-400 border-green-400/20' : 'text-blue-400 border-blue-400/20'
                                )}>{petType}</div>
                            )}
                            perfection={getPerfection(pet)}
                            getStatPerfection={getStatPerfection}
                            spriteMapping={spriteMapping}
                            renderIcon={() => (
                                spriteInfo ? (
                                    <SpriteSheetIcon
                                        textureSrc={getAscensionTexturePath('Pets', petAscensionLevel)}
                                        spriteWidth={spriteInfo.config.sprite_size.width}
                                        spriteHeight={spriteInfo.config.sprite_size.height}
                                        sheetWidth={spriteInfo.config.texture_size.width}
                                        sheetHeight={spriteInfo.config.texture_size.height}
                                        iconIndex={spriteInfo.spriteIndex}
                                        className="w-10 h-10"
                                    />
                                ) : (
                                    <Cat className={cn("w-8 h-8 opacity-50", `text-rarity-${pet.rarity.toLowerCase()}`)} />
                                )
                            )}
                            onClick={() => setEditingPetIdx(idx)}
                            onUnequip={(e) => { e.stopPropagation(); handleRemove(idx); }}
                            onSave={(e) => { e.stopPropagation(); setPetToSave(pet); }}
                            onLevelChange={(delta, e) => { e.stopPropagation(); handleLevelChange(idx, delta); }}
                            maxLevel={petUpgradeLib?.[pet.rarity]?.LevelInfo?.length || 100}
                        />
                    );
                })}
            </div>

            <PetSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleAdd}
            />

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
