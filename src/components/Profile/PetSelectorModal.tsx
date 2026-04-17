import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Save, Info, X, Search, Grid, Settings, Bookmark, Unlock } from 'lucide-react';

import { useGameData } from '../../hooks/useGameData';
import { PetSlot } from '../../types/Profile';
import { Button } from '../UI/Button';

import { ModalLevelSelector } from '../UI/ModalLevelSelector';
import { SecondaryStatCard } from '../UI/SecondaryStatCard';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useProfile } from '../../context/ProfileContext';
import { RARITIES } from '../../utils/constants';
import { getStatName } from '../../utils/statNames';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';

type MobileTab = 'rarity' | 'pets' | 'config';

interface PetSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (pet: PetSlot | null) => void;
    currentPet?: PetSlot; // Optional: for editing existing pet
    context?: 'profile' | 'pvp';
}

const STAT_TYPES = [
    "CriticalChance",
    "CriticalMulti",
    "BlockChance",
    "HealthRegen",
    "LifeSteal",
    "DoubleDamageChance",
    "DamageMulti",
    "MeleeDamageMulti",
    "RangedDamageMulti",
    "AttackSpeed",
    "SkillDamageMulti",
    "SkillCooldownMulti",
    "HealthMulti"
];

export function PetSelectorModal({ isOpen, onClose, onSelect, currentPet, context = 'profile' }: PetSelectorModalProps) {
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petBalancing } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: secondaryUnlockLib } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { profile, updateNestedProfile } = useProfile();

    const [activeTab, setActiveTab] = useState<'library' | 'saved'>('library');
    const [mobileTab, setMobileTab] = useState<MobileTab>('rarity');
    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [selectedPetId, setSelectedPetId] = useState<number | null>(null);
    const [petLevel, setPetLevel] = useState<number>(1);
    const [manualStats, setManualStats] = useState<{ statId: string; value: number }[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Reset state when opening or populate from currentPet
    useEffect(() => {
        if (isOpen) {
            if (currentPet) {
                setSelectedRarity(currentPet.rarity);
                setSelectedPetId(currentPet.id);
                setPetLevel(currentPet.level);
                setManualStats(currentPet.secondaryStats || []);
            } else {
                setSelectedRarity('Common');
                setSelectedPetId(null);
                setPetLevel(1);
                setManualStats([]);
            }
            setSearchTerm('');
            setMobileTab('rarity');
            // Default to library tab unless editing
            if (!currentPet) setActiveTab('library');
            if (context === 'pvp') setActiveTab('library');
        }
    }, [isOpen, currentPet, context]);

    const petsConfig = spriteMapping?.pets;

    const filteredPets = useMemo(() => {
        if (!petsConfig?.mapping) return [];
        return Object.entries(petsConfig.mapping)
            .map(([idx, info]: [string, any]) => ({
                spriteIndex: parseInt(idx),
                ...info
            }))
            .filter((p: any) => p.rarity === selectedRarity)
            .filter((p: any) => !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a: any, b: any) => a.id - b.id);
    }, [petsConfig, selectedRarity, searchTerm]);

    // Calculate max secondary stats
    const maxSecondaryStats = useMemo(() => {
        if (!secondaryUnlockLib || !selectedRarity) return 0;
        return secondaryUnlockLib[selectedRarity]?.NumberOfSecondStats || 0;
    }, [secondaryUnlockLib, selectedRarity]);

    const maxPetLevel = useMemo(() => {
        if (!petUpgradeLibrary || !selectedRarity) return 100;
        return (petUpgradeLibrary[selectedRarity]?.LevelInfo?.length || 100);
    }, [petUpgradeLibrary, selectedRarity]);

    // Trim manual stats if they exceed the new slot limit
    useEffect(() => {
        if (manualStats.length > maxSecondaryStats) {
            setManualStats(prev => prev.slice(0, maxSecondaryStats));
        }
    }, [maxSecondaryStats, manualStats.length]);

    // Get stat range for display
    const getStatRange = (statType: string): { min: number; max: number } | null => {
        if (!secondaryStatLibrary) return null;
        const statData = secondaryStatLibrary[statType];
        if (!statData) return null;
        return {
            min: statData.LowerRange || 0,
            max: statData.UpperRange || 0
        };
    };

    const getStatPerfection = (statIdx: string, value: number): number | null => {
        if (!secondaryStatLibrary) return null;
        const libStat = secondaryStatLibrary[statIdx];
        if (libStat && libStat.UpperRange > 0) {
            return Math.min(100, (value / (libStat.UpperRange * 100)) * 100);
        }
        return null;
    };

    const getPerfection = (item: PetSlot): number | null => {
        if (!item.secondaryStats || item.secondaryStats.length === 0 || !secondaryStatLibrary) return null;
        let totalPercent = 0;
        let count = 0;
        for (const stat of item.secondaryStats) {
            const perf = getStatPerfection(stat.statId, stat.value);
            if (perf !== null) {
                totalPercent += perf;
                count++;
            }
        }
        return count > 0 ? totalPercent / count : null;
    };

    const handleAddStat = () => {
        if (manualStats.length < maxSecondaryStats) {
            const existingTypes = new Set(manualStats.map(s => s.statId));
            const nextType = STAT_TYPES.find(t => !existingTypes.has(t)) || STAT_TYPES[0];
            const range = getStatRange(nextType);

            setManualStats([...manualStats, {
                statId: nextType,
                value: range ? parseFloat((range.min * 100).toFixed(2)) : 0
            }]);
        }
    };

    const handleUpdateStat = (index: number, field: 'statId' | 'value', value: any) => {
        const newStats = [...manualStats];

        if (field === 'statId') {
            const range = getStatRange(value);
            let currentValue = newStats[index].value;

            // Value is already in percentage here
            if (range && currentValue > (range.max * 100)) {
                currentValue = parseFloat((range.max * 100).toFixed(2));
            }

            newStats[index] = { ...newStats[index], statId: value, value: currentValue };
        } else {
            newStats[index] = { ...newStats[index], [field]: value };
        }

        setManualStats(newStats);
    };



    const handleRemoveStat = (index: number) => {
        setManualStats(manualStats.filter((_, i) => i !== index));
    };

    const handleSave = () => {
        if (selectedPetId !== null) {
            onSelect({
                id: selectedPetId,
                rarity: selectedRarity,
                level: petLevel,
                evolution: 0,
                secondaryStats: manualStats.map(s => ({
                    statId: s.statId,
                    value: s.value
                }))
            });
            onClose();
        }
    };

    // Helper to get stats for selected pet
    const getPetStats = () => {
        if (selectedPetId === null) return null;
        if (!petLibrary || !petBalancing) return null;
        const key = `{'Rarity': '${selectedRarity}', 'Id': ${selectedPetId}}`;
        const petData = petLibrary[key];
        if (!petData) return null;

        const type = petData.Type || 'Balanced';
        const balancing = petBalancing[type] || {};

        return { type, ...balancing };
    };

    const petStats = getPetStats();

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
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
                        <div>
                            <h3 className="text-xl font-bold">{currentPet ? 'Edit Pet' : 'Select Pet'}</h3>
                            <p className="text-xs text-text-muted">Choose a pet and configure stats</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mobile Unequip Button */}
                {currentPet && (
                    <div className="px-4 py-2 border-b border-border bg-red-500/10 md:hidden">
                        <Button
                            variant="ghost"
                            className="w-full border-red-500/30 text-red-400 hover:bg-red-500/20 py-2 h-auto"
                            onClick={() => { onSelect(null); onClose(); }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" /> Unequip Pet
                        </Button>
                    </div>
                )}

                {/* Mobile Tab Navigation */}
                <div className="flex md:hidden border-b border-border bg-bg-secondary/10">
                    <button
                        onClick={() => setMobileTab('rarity')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'rarity'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Unlock className="w-4 h-4" />
                        Rarity
                    </button>
                    <button
                        onClick={() => setMobileTab('pets')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'pets'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Grid className="w-4 h-4" />
                        Library
                    </button>
                    <button
                        onClick={() => setMobileTab('config')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'config'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Settings className="w-4 h-4" />
                        Config
                    </button>
                </div>

                {/* Modal Layout - Desktop/Mobile Flex */}
                <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
                    {/* Sidebar: Rarity Selection & Saved Tab */}
                    <div className={cn(
                        "w-full md:w-52 border-b md:border-b-0 md:border-r border-border flex flex-col bg-bg-secondary/10 flex-shrink-0",
                        mobileTab !== 'rarity' && "hidden md:flex"
                    )}>
                        <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar md:no-scrollbar p-3 md:p-0 space-y-2 md:space-y-0">
                            {/* Saved Tab Button */}
                            <button
                                onClick={() => {
                                    setActiveTab('saved');
                                    setMobileTab('pets');
                                }}
                                className={cn(
                                    "flex items-center justify-start gap-3 p-3 md:px-4 md:py-3.5 text-xs font-bold uppercase transition-all rounded-xl md:rounded-lg border-2",
                                    activeTab === 'saved'
                                        ? "bg-accent-primary/20 text-accent-primary border-accent-primary shadow-md"
                                        : "text-text-muted hover:bg-white/5 border-transparent bg-bg-input/20 md:bg-transparent"
                                )}
                            >
                                <div className="w-8 h-8 rounded bg-bg-secondary flex items-center justify-center shrink-0 md:hidden">
                                    <Bookmark className={cn("w-5 h-5", activeTab === 'saved' && "fill-accent-primary")} />
                                </div>
                                <Bookmark className={cn("hidden md:block w-4 h-4", activeTab === 'saved' && "fill-accent-primary")} />
                                <div className="flex-1 text-left">
                                    <span className="block">Saved Builds</span>
                                    <span className="text-[10px] text-text-muted normal-case font-normal md:hidden">
                                        {profile.pets.savedBuilds?.length || 0} items
                                    </span>
                                </div>
                                <span className="hidden md:block ml-auto bg-black/20 px-1.5 rounded-full text-[10px]">
                                    {profile.pets.savedBuilds?.length || 0}
                                </span>
                            </button>

                            <div className="hidden md:block px-4 py-2 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest mt-2">
                                Pet Library
                            </div>
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setActiveTab('library');
                                        setSelectedRarity(rarity);
                                        setSelectedPetId(null);
                                        setManualStats([]);
                                        setMobileTab('pets');
                                    }}
                                    className={cn(
                                        "flex items-center gap-3 p-3 md:px-4 md:py-2.5 text-xs font-bold transition-all rounded-xl md:rounded-lg border-2",
                                        activeTab === 'library' && selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border-rarity-${rarity.toLowerCase()} shadow-md`
                                            : "text-text-muted hover:bg-white/5 border-transparent bg-bg-input/20 md:bg-transparent"
                                    )}
                                >
                                    <div className="shrink-0 md:bg-black/20 md:p-1 md:rounded">
                                        <SpriteSheetIcon
                                            textureSrc={getAscensionTexturePath('Eggs', profile.misc.petAscensionLevel || 0)}
                                            spriteWidth={256}
                                            spriteHeight={256}
                                            sheetWidth={1024}
                                            sheetHeight={1024}
                                            iconIndex={RARITIES.indexOf(rarity)}
                                            className="w-8 h-8 md:w-5 md:h-5"
                                        />
                                    </div>
                                    <div className="flex-1 text-left">
                                        <span className="block">{rarity}</span>
                                        <span className="text-[10px] text-text-muted font-normal md:hidden">
                                            Library Selection
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>



                    {/* Column 2: Pet Grid / Saved List */}
                    <div className={cn(
                        "flex-1 overflow-y-auto custom-scrollbar p-3 md:p-4 bg-bg-primary/30",
                        mobileTab !== 'pets' && "hidden md:block" 
                    )}>
                        {/* Search Bar */}
                        <div className="relative mb-4">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                            <input
                                placeholder={activeTab === 'library' ? "Search pet library..." : "Search saved builds..."}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-bg-input border border-border rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary transition-all"
                                onFocus={(e) => e.target.select()}
                            />
                        </div>

                        {activeTab === 'library' ? (
                            filteredPets.length > 0 ? (
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                    {filteredPets.map((pet: any) => (
                                        <button
                                            key={pet.id}
                                            onClick={() => {
                                                setSelectedPetId(pet.id);
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "relative aspect-square rounded-xl border-2 transition-all p-2 flex flex-col items-center justify-center gap-1 group overflow-hidden bg-bg-secondary/40",
                                                selectedPetId === pet.id
                                                    ? `border-rarity-${selectedRarity.toLowerCase()} shadow-lg shadow-rarity-${selectedRarity.toLowerCase()}/20`
                                                    : "border-border hover:border-white/20"
                                            )}
                                        >
                                            <div
                                                className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center transition-transform group-hover:scale-110"
                                                style={getRarityBgStyle(selectedRarity)}
                                            >
                                                {petsConfig && (
                                                    <SpriteSheetIcon
                                                        textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0)}
                                                        spriteWidth={petsConfig.sprite_size.width}
                                                        spriteHeight={petsConfig.sprite_size.height}
                                                        sheetWidth={petsConfig.texture_size.width}
                                                        sheetHeight={petsConfig.texture_size.height}
                                                        iconIndex={pet.spriteIndex}
                                                        className="w-full h-full p-1"
                                                    />
                                                )}
                                            </div>
                                            <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm py-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-[9px] text-white truncate block text-center font-bold">
                                                    {pet.name || `Pet #${pet.id}`}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-text-muted">
                                    <Search className="w-12 h-12 opacity-20 mb-4" />
                                    <p className="font-bold">No pets found</p>
                                    <p className="text-xs opacity-60">Try a different name or rarity</p>
                                </div>
                            )
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {profile.pets.savedBuilds && profile.pets.savedBuilds.length > 0 ? (
                                    profile.pets.savedBuilds
                                        .filter(saved => !searchTerm || (saved.customName || `Pet #${saved.id}`).toLowerCase().includes(searchTerm.toLowerCase()))
                                        .map((savedPet, idx) => {
                                            const spriteInfo = petsConfig?.mapping ?
                                                Object.entries(petsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedPet.id && v.rarity === savedPet.rarity)
                                                : null;

                                            const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;
                                            const isSelected = selectedPetId === savedPet.id && selectedRarity === savedPet.rarity && JSON.stringify(manualStats) === JSON.stringify(savedPet.secondaryStats);

                                            return (
                                                <ItemSelectionCard
                                                    key={idx}
                                                    item={savedPet}
                                                    slotKey="pet-saved"
                                                    slotLabel="Saved Pet"
                                                    itemName={savedPet.customName || `Pet #${savedPet.id}`}
                                                    itemImage={null}
                                                    rarity={savedPet.rarity}
                                                    isSaved={true}
                                                    isSelected={isSelected}
                                                    hideAgeStyles={true}
                                                    perfection={getPerfection(savedPet)}
                                                    getStatPerfection={getStatPerfection}
                                                    onClick={() => {
                                                        setSelectedRarity(savedPet.rarity);
                                                        setSelectedPetId(savedPet.id);
                                                        setPetLevel(savedPet.level);
                                                        setManualStats(savedPet.secondaryStats || []);
                                                        setMobileTab('config');
                                                    }}
                                                    onDelete={(e) => {
                                                        e.stopPropagation();
                                                        const newSaved = [...(profile.pets.savedBuilds || [])];
                                                        newSaved.splice(idx, 1);
                                                        updateNestedProfile('pets', { savedBuilds: newSaved });
                                                    }}
                                                    renderIcon={() => (
                                                        <SpriteSheetIcon
                                                            textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0)}
                                                            spriteWidth={petsConfig!.sprite_size.width}
                                                            spriteHeight={petsConfig!.sprite_size.height}
                                                            sheetWidth={petsConfig!.texture_size.width}
                                                            sheetHeight={petsConfig!.texture_size.height}
                                                            iconIndex={spriteIndex}
                                                            className="w-10 h-10"
                                                        />
                                                    )}
                                                />
                                            );
                                        })
                                ) : (
                                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-text-muted">
                                        <Bookmark className="w-12 h-12 opacity-20 mb-4" />
                                        <p className="font-bold">No saved pets</p>
                                        <p className="text-xs opacity-60">Presets will appear here after you save them in the main panel</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Column 3: Configuration Panel */}
                    <div className={cn(
                        "w-full md:w-80 bg-bg-secondary/20 p-4 border-t md:border-t-0 md:border-l border-border overflow-y-auto custom-scrollbar flex flex-col gap-6",
                        mobileTab !== 'config' && "hidden md:flex"
                    )}>
                        {selectedPetId !== null ? (
                            <>
                                {/* Item Preview */}
                                <div className="text-center">
                                    <div
                                        className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-xl border-2 overflow-hidden relative"
                                        style={{ ...getRarityBgStyle(selectedRarity), borderColor: `var(--rarity-${selectedRarity.toLowerCase()})` }}
                                    >
                                        {petsConfig && (
                                            <SpriteSheetIcon
                                                textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0)}
                                                spriteWidth={petsConfig.sprite_size.width}
                                                spriteHeight={petsConfig.sprite_size.height}
                                                sheetWidth={petsConfig.texture_size.width}
                                                sheetHeight={petsConfig.texture_size.height}
                                                iconIndex={Object.entries(petsConfig.mapping as Record<string, any>).find(([_, v]) => v.id === selectedPetId && v.rarity === selectedRarity)?.[0] ? parseInt(Object.entries(petsConfig.mapping as Record<string, any>).find(([_, v]) => v.id === selectedPetId && v.rarity === selectedRarity)![0]) : 0}
                                                className="w-20 h-20"
                                            />
                                        )}
                                    </div>
                                    <h2 className="text-xl font-bold text-text-primary leading-tight">
                                        {(Object.values(petsConfig?.mapping || {}) as any[]).find((p: any) => p.id === selectedPetId && p.rarity === selectedRarity)?.name || `Pet #${selectedPetId}`}
                                    </h2>
                                    <div className={cn("text-[10px] font-bold uppercase tracking-widest mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                        {selectedRarity} Pet
                                    </div>
                                </div>

                                {/* Base Stats Section */}
                                <div className="space-y-3">
                                    <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Base Attributes</h4>
                                    <div className="grid grid-cols-1 gap-2">
                                        {petStats && (
                                            <div className="bg-black/20 rounded-xl p-3 border border-white/5 space-y-2">
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-text-muted">Type</span>
                                                    <span className={cn(
                                                        "font-bold uppercase",
                                                        petStats.type === 'Damage' ? 'text-red-400' :
                                                            petStats.type === 'Health' ? 'text-green-400' : 'text-blue-400'
                                                    )}>{petStats.type}</span>
                                                </div>
                                                <div className="h-px bg-white/5 w-full" />
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-text-muted">Damage Multi</span>
                                                    <span className="text-red-400 font-mono font-bold">x{petStats.DamageMultiplier || 1}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <span className="text-text-muted">Health Multi</span>
                                                    <span className="text-green-400 font-mono font-bold">x{petStats.HealthMultiplier || 1}</span>
                                                </div>
                                            </div>
                                        )}

                                        <ModalLevelSelector
                                            level={petLevel}
                                            maxLevel={maxPetLevel}
                                            onChange={setPetLevel}
                                            label="Pet Level"
                                            className="bg-black/20 rounded-xl p-3 border border-white/5"
                                        />
                                    </div>
                                </div>

                                {/* Secondary Stats Section */}
                                <div className="space-y-3 flex-1">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Secondary Stats</h4>
                                        <div className="bg-bg-input px-2 py-0.5 rounded text-[10px] border border-white/10 font-bold text-accent-primary">
                                            {manualStats.length} / {maxSecondaryStats}
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-2">
                                        {manualStats.map((stat, idx) => {
                                            const range = getStatRange(stat.statId);
                                            const statOptions = STAT_TYPES.filter(t =>
                                                t === stat.statId || !manualStats.some(s => s.statId === t)
                                            ).map(t => ({ id: t, name: getStatName(t) }));

                                            return (
                                                <SecondaryStatCard
                                                    key={idx}
                                                    statId={stat.statId}
                                                    value={stat.value as number}
                                                    options={statOptions}
                                                    onStatIdChange={(newId) => handleUpdateStat(idx, 'statId', newId)}
                                                    onValueChange={(newVal) => handleUpdateStat(idx, 'value', newVal)}
                                                    onRemove={() => handleRemoveStat(idx)}
                                                    range={range}
                                                />
                                            );
                                        })}

                                        {manualStats.length < maxSecondaryStats && (
                                            <button
                                                onClick={handleAddStat}
                                                className="w-full py-4 border-2 border-dashed border-white/5 hover:border-accent-primary/30 rounded-xl flex items-center justify-center gap-2 text-xs text-text-muted hover:text-accent-primary transition-all group"
                                            >
                                                <Plus className="w-4 h-4 group-hover:scale-125 transition-transform" />
                                                <span className="font-bold">ADD STAT SLOT</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Footer Action */}
                                <div className="pt-4 border-t border-white/10 mt-auto">
                                    <Button 
                                        variant="primary" 
                                        className="w-full py-4 rounded-xl font-bold text-sm gap-2 shadow-lg shadow-accent-primary/20"
                                        onClick={handleSave}
                                    >
                                        <Save className="w-5 h-5" />
                                        Equip Pet
                                    </Button>
                                    <p className="text-[9px] text-center text-text-muted mt-2 px-4 leading-tight">
                                        Stats are applied immediately after equipping.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-text-muted opacity-30 text-center px-6">
                                <div className="p-4 bg-white/5 rounded-full mb-4">
                                    <Info className="w-12 h-12" />
                                </div>
                                <p className="font-bold uppercase tracking-widest text-xs">Configuration</p>
                                <p className="text-[10px] mt-2 leading-relaxed">Select a pet from the library to configure its level and secondary statistics.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>, document.body
    );
}
