import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { Card } from '../UI/Card';
import { Zap as PowerIcon, Cat, Sword, RotateCcw, Heart, Scale } from 'lucide-react';
import { Button } from '../UI/Button';
import { PetSlot, MountSlot } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { MAX_ACTIVE_PETS } from '../../utils/constants';

/** Artwork well for one of the three slot cards: three across on a phone leaves about 110px each. */
const SLOT_ART = 'w-12 h-12 sm:w-20 sm:h-20 xl:w-24 xl:h-24';
import { PetSelectorModal } from './PetSelectorModal';
import { useGameData } from '../../hooks/useGameData';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useTreeModifiers, useClanTreeModifiers } from '../../hooks/useCalculatedStats';

import { InputModal } from '../UI/InputModal';
import { SectionSyncButton } from './SectionSyncButton';
import { AscensionStars } from '../UI/AscensionStars';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard, EmptyRowCard, CARD_ART_CLASS } from '../UI/ItemSelectionCard';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';

interface PetPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    comparePets?: PetSlot[] | null;
}

export function PetPanel({ variant = 'default', title, comparePets }: PetPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { 
        isComparing, 
        originalPets, 
        testPets, 
        originalPetAscension, 
        testPetAscension,
        updateOriginalPet,
        updateTestPet,
        updateOriginalPetAscension,
        updateTestPetAscension,
        isCompactStats
    } = useComparison();
    const { optimizeLoadout, isReady } = useProfileOptimizer();
    
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
    const [previousPets, setPreviousPets] = useState<PetSlot[] | null>(null);
    // undefined = nothing to revert; null = revert to "no mount equipped"
    const [previousMount, setPreviousMount] = useState<MountSlot | null | undefined>(undefined);

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
    const clanModifiers = useClanTreeModifiers();
    const petDamageBonus = techModifiers['PetBonusDamage'] || 0;
    const petHealthBonus = techModifiers['PetBonusHealth'] || 0;
    const clanPetDamageBonus = clanModifiers['PetBonusDamage'] || 0;
    const clanPetHealthBonus = clanModifiers['PetBonusHealth'] || 0;

    // Pet Ascension multipliers
    const { ascensionDmgMulti, ascensionHpMulti } = useMemo(() => {
        let dMulti = 0;
        let hMulti = 0;

        if (petAscensionLevel > 0 && ascensionConfigsLibrary?.Pets?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Pets.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(petAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    const sVal = s.Value + 1;
                    if (sType === 'Damage' || sType === 'AscensionDamage') dMulti = sVal;
                    if (sType === 'Health' || sType === 'AscensionHealth') hMulti = sVal;
                }
            }
        }
        return { ascensionDmgMulti: dMulti || 1, ascensionHpMulti: hMulti || 1 };
    }, [petAscensionLevel, ascensionConfigsLibrary]);

    const updatePets = (newPets: PetSlot[]) => {
        if (variant === 'original') updateOriginalPet(newPets);
        else if (variant === 'test') updateTestPet(newPets);
        else updateNestedProfile('pets', { active: newPets });
    };

    const handleRemove = (index: number) => {
        setPreviousPets(null);
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
        setPreviousPets(null);
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
        setPreviousPets(null);
        setEditingPetIdx(null);
    };

    const handleLevelChange = (index: number, delta: number) => {
        const pet = activePets[index];
        const maxLevel = petUpgradeLib?.[pet.rarity]?.LevelInfo?.length || 100;
        const newLevel = Math.max(1, Math.min(maxLevel, pet.level + delta));
        if (newLevel === pet.level) return;

        const newPets = [...activePets];
        const updatedPet = { ...pet, level: newLevel };
        newPets[index] = updatedPet;
        
        if (variant === 'default') {
            // Bidirectional sync: find if this pet was a saved build
            const saved = profile.pets.savedBuilds || [];
            const savedIdx = saved.findIndex(s => 
                s.id === pet.id && 
                s.rarity === pet.rarity && 
                JSON.stringify(s.secondaryStats) === JSON.stringify(pet.secondaryStats)
            );

            if (savedIdx !== -1) {
                const newSaved = [...saved];
                newSaved[savedIdx] = { ...newSaved[savedIdx], level: newLevel };
                updateNestedProfile('pets', { 
                    active: newPets,
                    savedBuilds: newSaved
                });
            } else {
                updatePets(newPets);
            }
        } else {
            updatePets(newPets);
        }
        
        setPreviousPets(null);
    };

    const handleAscensionChange = (val: number) => {
        if (isComparing) {
            if (variant === 'original') updateOriginalPetAscension(val);
            else if (variant === 'test') updateTestPetAscension(val);
        } else {
            updateNestedProfile('misc', { petAscensionLevel: val });
        }
    };

    // Optimizer searches saved pets AND saved mounts, so enable when either pool has entries.
    const autoDisabled = (profile.pets.savedBuilds?.length || 0) < 1 && (profile.mount.savedBuilds?.length || 0) < 1;

    // Only rendered for the default (non-compare) panel. Compare mode drives its
    // own optimizer from the comparison strip (see StatsSummaryPanel).
    const handleAutoOptimize = (metric: 'dps' | 'power' | 'lifesteal' | 'balanced') => {
        setPreviousPets([...activePets]);
        setPreviousMount(profile.mount.active);

        const best = optimizeLoadout(metric);
        if (!best) return;

        updatePets(best.pets);
        updateNestedProfile('mount', { active: best.mount });
    };

    const handleRevert = () => {
        if (previousPets) {
            updatePets(previousPets);
            setPreviousPets(null);
        }
        if (previousMount !== undefined) {
            updateNestedProfile('mount', { active: previousMount });
            setPreviousMount(undefined);
        }
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex flex-col gap-2">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <div className="w-8 h-8 flex items-center justify-center">
                            <SpriteSheetIcon
                                textureSrc={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}Icons.png`}
                                spriteWidth={256}
                                spriteHeight={256}
                                sheetWidth={2048}
                                sheetHeight={2048}
                                iconIndex={14}
                                className="w-8 h-8"
                            />
                        </div>
                        {panelTitle}
                    </h2>
                    
                    {variant === 'default' && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 gap-1 active:scale-95 transition-all w-fit"
                            onClick={() => handleAutoOptimize('dps')}
                            disabled={!isReady || autoDisabled}
                            title="Select best 3 pets + mount for Max DPS"
                        >
                            <Sword className="w-3 h-3" />
                            AUTO DPS
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold border-amber-500/20 hover:bg-amber-500/10 hover:border-amber-500/40 text-amber-500 gap-1 active:scale-95 transition-all w-fit"
                            onClick={() => handleAutoOptimize('power')}
                            disabled={!isReady || autoDisabled}
                            title="Select best 3 pets + mount for Max Power"
                        >
                            <PowerIcon className="w-3 h-3" />
                            AUTO POWER
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold border-purple-500/20 hover:bg-purple-500/10 hover:border-purple-500/40 text-purple-400 gap-1 active:scale-95 transition-all w-fit"
                            onClick={() => handleAutoOptimize('lifesteal')}
                            disabled={!isReady || autoDisabled}
                            title="Select best 3 pets + mount for Max Lifesteal/sec"
                        >
                            <Heart className="w-3 h-3" />
                            AUTO LIFESTEAL/SEC
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold border-violet-500/20 hover:bg-violet-500/10 hover:border-violet-500/40 text-violet-400 gap-1 active:scale-95 transition-all w-fit"
                            onClick={() => handleAutoOptimize('balanced')}
                            disabled={!isReady || autoDisabled}
                            title="Select best 3 pets + mount for a balance of DPS and HPS (same scoring as the Loadout Optimizer)"
                        >
                            <Scale className="w-3 h-3" />
                            AUTO BALANCED
                        </Button>
                        {(previousPets || previousMount !== undefined) && (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-7 px-2 text-[10px] font-bold text-text-muted hover:text-white gap-1 active:scale-95 transition-all w-fit"
                                onClick={handleRevert}
                            >
                                <RotateCcw className="w-3 h-3" />
                                REVERT
                            </Button>
                        )}
                    </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2">
                    {variant === 'default' && !isComparing && <SectionSyncButton preset="pet" label="Sync" />}
                    <AscensionStars
                        value={petAscensionLevel}
                        onChange={handleAscensionChange}
                        size="sm"
                    />
                </div>
            </div>

            {/* Container-relative columns: this panel also renders two-up inside the compare grid. */}
                            {/* Three across, always: there are exactly three slots, so one row holds them all
                    and the column count never changes with the viewport. The cards shrink to fit
                    rather than wrapping, which is what keeps the panel one shape on a phone and on
                    a desktop, and items-stretch levels their heights. */}
                <div className={cn(
                    'grid items-stretch gap-2',
                    // One per row on a phone, three on a desktop. Comparison mode is pinned to one
                    // for the same reason the equipment row is pinned to two: the panel is half as
                    // wide as the viewport breakpoint believes.
                    isComparing ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'
                )}>
                {Array.from({ length: MAX_ACTIVE_PETS }).map((_, idx) => {
                    const pet = activePets[idx];
                    const hasDiff = checkDiff(idx);

                    if (!pet) {
                        return (
                            <EmptyRowCard
                                className="min-w-0" artClassName={SLOT_ART}
                                key={`empty-${idx}`}
                                label="Empty Slot"
                                hint="Click to equip"
                                hasDiff={hasDiff}
                                onClick={() => setIsModalOpen(true)}
                                icon={<Cat className="w-10 h-10 text-text-muted" />}
                            />
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
                    let baseDamage = 0;
                    let baseHealth = 0;

                    if (levelInfo?.PetStats?.Stats) {
                        for (const stat of levelInfo.PetStats.Stats) {
                            const val = stat.Value || 0;
                            const techDmgFactor = 1 + petDamageBonus;
                            const techHpFactor = 1 + petHealthBonus;
                            const ascDmgFactor = ascensionDmgMulti || 1;
                            const ascHpFactor = ascensionHpMulti || 1;

                            if (stat.StatNode?.UniqueStat?.StatType === 'Damage') {
                                baseDamage = val * typeMultipliers.DamageMultiplier;
                                damage = baseDamage * techDmgFactor * ascDmgFactor;
                            }
                            if (stat.StatNode?.UniqueStat?.StatType === 'Health') {
                                baseHealth = val * typeMultipliers.HealthMultiplier;
                                health = baseHealth * techHpFactor * ascHpFactor;
                            }
                        }
                    }

                    return (
                        <ItemSelectionCard
                            className="min-w-0" artClassName={SLOT_ART}
                            key={idx}
                            item={pet}
                            layout="row"
                            variant={isCompactStats ? 'compact' : 'default'}
                            slotKey={`pet-${idx}`}
                            slotLabel={`Pet Slot ${idx + 1}`}
                            itemName={spriteInfo?.name || `${pet.rarity} Pet`}
                            itemImage={null}
                            rarity={pet.rarity}
                            hideAgeStyles={true}
                            hasDiff={hasDiff}
                            isSaved={isSaved}
                            globalAscensionLevel={petAscensionLevel}
                            /* Pet ascension is one global number: the single editor is in the panel
                               header, the card shows the star count read-only. */
                            stats={{
                                damage: damage,
                                health: health,
                                damageMulti: (1 + petDamageBonus) * (ascensionDmgMulti || 1),
                                healthMulti: (1 + petHealthBonus) * (ascensionHpMulti || 1),
                                details: {
                                    damage: { base: baseDamage, techMulti: (1 + petDamageBonus), clanTechMulti: clanPetDamageBonus, ascMulti: (ascensionDmgMulti || 1) },
                                    health: { base: baseHealth, techMulti: (1 + petHealthBonus), clanTechMulti: clanPetHealthBonus, ascMulti: (ascensionHpMulti || 1) }
                                },
                                isMelee: false
                            }}
                            /* The pet's role used to be a full-width bar of its own. It is one word,
                               so it rides beside the name with the rarity. */
                            tags={(
                                <span className={cn(
                                    "text-[8px] font-black uppercase tracking-wider px-1 rounded border",
                                    petType === 'Damage' ? 'text-red-400 border-red-400/30 bg-red-400/10' :
                                        petType === 'Health' ? 'text-green-400 border-green-400/30 bg-green-400/10'
                                            : 'text-blue-400 border-blue-400/30 bg-blue-400/10'
                                )} title="Pet type">{petType}</span>
                            )}
                            perfection={getPerfection(pet)}
                            getStatPerfection={getStatPerfection}
                            spriteMapping={spriteMapping}
                            renderIcon={() => (
                                spriteInfo ? (
                                    <SpriteSheetIcon
                                        textureSrc={getAscensionTexturePath('Pets', petAscensionLevel, selectedVersion)}
                                        spriteWidth={spriteInfo.config.sprite_size.width}
                                        spriteHeight={spriteInfo.config.sprite_size.height}
                                        sheetWidth={spriteInfo.config.texture_size.width}
                                        sheetHeight={spriteInfo.config.texture_size.height}
                                        iconIndex={spriteInfo.spriteIndex}
                                        className={CARD_ART_CLASS}
                                        smooth
                                    />
                                ) : (
                                    <Cat className={cn("w-10 h-10 opacity-50", `text-rarity-${pet.rarity.toLowerCase()}`)} />
                                )
                            )}
                            onClick={() => setEditingPetIdx(idx)}
                            onUnequip={(e) => { e.stopPropagation(); handleRemove(idx); }}
                            onSave={(e) => { e.stopPropagation(); setPetToSave(pet); }}
                            onLevelChange={(delta, e) => { e.stopPropagation(); handleLevelChange(idx, delta); }}
                            onLevelSet={(newLevel) => {
                                const newPets = [...activePets];
                                newPets[idx] = { ...pet, level: newLevel };
                                updatePets(newPets);
                                setPreviousPets(null);
                            }}
                            maxLevel={petUpgradeLib?.[pet.rarity]?.LevelInfo?.length || 100}
                        />
                    );
                })}
            </div>

            <PetSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleAdd}
                petAscensionLevel={petAscensionLevel}
            />

            {
                editingPetIdx !== null && (
                    <PetSelectorModal
                        isOpen={true}
                        onClose={() => setEditingPetIdx(null)}
                        onSelect={(pet) => handleEditPet(editingPetIdx, pet)}
                        currentPet={activePets[editingPetIdx]}
                        petAscensionLevel={petAscensionLevel}
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
