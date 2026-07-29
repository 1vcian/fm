import { useState, useMemo, useEffect, useRef } from 'react';
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
import { useGameDataContext } from '../../context/GameDataContext';
import { RARITIES } from '../../utils/constants';
import { getStatName } from '../../utils/statNames';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';

type MobileTab = 'rarity' | 'pets' | 'config';
type SortField = 'level' | 'name' | 'rarity' | 'perfection';
type SortOrder = 'asc' | 'desc';

interface PetSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (pet: PetSlot | null) => void;
    currentPet?: PetSlot; // Optional: for editing existing pet
    context?: 'profile' | 'pvp';
    petAscensionLevel?: number;
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

export function PetSelectorModal({ isOpen, onClose, onSelect, currentPet, context = 'profile', petAscensionLevel }: PetSelectorModalProps) {
    const { selectedVersion } = useGameDataContext();
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: petBalancing } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: secondaryUnlockLib } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { profile, updateNestedProfile } = useProfile();

    // Ref to break circular dependency in auto-sync effect
    const savedBuildsRef = useRef(profile.pets.savedBuilds);
    savedBuildsRef.current = profile.pets.savedBuilds;

    const [activeTab, setActiveTab] = useState<'library' | 'saved'>('library');
    const [mobileTab, setMobileTab] = useState<MobileTab>('rarity');
    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [selectedPetId, setSelectedPetId] = useState<number | null>(null);
    const [petLevel, setPetLevel] = useState<number>(1);
    const [manualStats, setManualStats] = useState<{ statId: string; value: number }[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSavedIndex, setSelectedSavedIndex] = useState<number | null>(null);

    // Saved Builds Sorting
    const [savedSortField, setSavedSortField] = useState<SortField>('level');
    const [savedSortOrder, setSavedSortOrder] = useState<SortOrder>('desc');

    // Advanced Filters
    const [filterRarities, setFilterRarities] = useState<string[]>([]);
    const [minPerfection, setMinPerfection] = useState<number>(0);
    const [filterStats, setFilterStats] = useState<string[]>([]);
    const [showFilters, setShowFilters] = useState(false);

    const petsConfig = spriteMapping?.pets;

    // Reset state when opening or populate from currentPet
    useEffect(() => {
        if (isOpen) {
            if (currentPet) {
                // Try to find if it's a saved one
                const savedIdx = profile.pets.savedBuilds.findIndex(p => 
                    p.id === currentPet.id && 
                    p.rarity === currentPet.rarity && 
                    JSON.stringify(p.secondaryStats) === JSON.stringify(currentPet.secondaryStats)
                );
                
                if (savedIdx !== -1) {
                    setSelectedSavedIndex(savedIdx);
                    setActiveTab('saved');
                } else {
                    setSelectedSavedIndex(null);
                    setActiveTab('library');
                }

                setSelectedRarity(currentPet.rarity);
                setSelectedPetId(currentPet.id);
                setPetLevel(currentPet.level);
                setManualStats(currentPet.secondaryStats || []);
            } else {
                setSelectedSavedIndex(null);
                setSelectedRarity('Common');
                setSelectedPetId(null);
                setPetLevel(1);
                setManualStats([]);
                setActiveTab('library');
            }
            setSearchTerm('');
            setMobileTab('rarity');
            if (context === 'pvp') setActiveTab('library');
        }
    }, [isOpen]);

    // Auto-sync for saved pets (uses ref to avoid re-triggering on savedBuilds change)
    useEffect(() => {
        if (!isOpen) return;
        if (selectedSavedIndex !== null && activeTab === 'saved') {
            const currentSaved = savedBuildsRef.current;
            const savedPet = currentSaved[selectedSavedIndex];
            if (savedPet) {
                const updatedPet: PetSlot = {
                    ...savedPet,
                    level: petLevel,
                    secondaryStats: manualStats
                };

                const hasChanged = 
                    savedPet.level !== updatedPet.level ||
                    JSON.stringify(savedPet.secondaryStats) !== JSON.stringify(updatedPet.secondaryStats);

                if (hasChanged) {
                    const newSaved = [...currentSaved];
                    newSaved[selectedSavedIndex] = updatedPet;

                    // Also propagate to active pets if this saved pet is currently equipped
                    const activePets = profile.pets.active;
                    let updatedActive: PetSlot[] | null = null;
                    activePets.forEach((ap, i) => {
                        if (ap.id === savedPet.id && ap.rarity === savedPet.rarity &&
                            ap.level === savedPet.level &&
                            JSON.stringify(ap.secondaryStats) === JSON.stringify(savedPet.secondaryStats)) {
                            if (!updatedActive) updatedActive = [...activePets];
                            updatedActive![i] = updatedPet;
                        }
                    });

                    updateNestedProfile('pets', {
                        savedBuilds: newSaved,
                        ...(updatedActive ? { active: updatedActive } : {})
                    });
                }
            }
        }
    }, [petLevel, manualStats, activeTab, selectedSavedIndex, updateNestedProfile, profile.pets.active, isOpen]);


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
        const currentAsc = petAscensionLevel !== undefined ? petAscensionLevel : (profile.misc.petAscensionLevel || 0);
        if (currentAsc > 0) return 2;
        if (!secondaryUnlockLib || !selectedRarity) return 0;
        return secondaryUnlockLib[selectedRarity]?.NumberOfSecondStats || 0;
    }, [secondaryUnlockLib, selectedRarity, profile.misc.petAscensionLevel, petAscensionLevel]);

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

    const sortedSavedBuilds = useMemo(() => {
        const base = profile.pets.savedBuilds || [];
        let filtered = base;
        
        // Search Filter
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            filtered = filtered.filter(p => {
                const petInfo = petsConfig?.mapping ? 
                    Object.values(petsConfig.mapping).find((v: any) => v.id === p.id && v.rarity === p.rarity) as any 
                    : null;
                const name = p.customName || petInfo?.name || `Pet #${p.id}`;
                return name.toLowerCase().includes(q);
            });
        }

        // Rarity Filter
        if (filterRarities.length > 0) {
            filtered = filtered.filter(p => filterRarities.includes(p.rarity));
        }

        // Perfection Filter
        if (minPerfection > 0) {
            filtered = filtered.filter(p => (getPerfection(p) || 0) >= minPerfection);
        }

        // Stats Filter
        if (filterStats.length > 0) {
            filtered = filtered.filter(p => 
                filterStats.some(sId => p.secondaryStats?.some(s => s.statId === sId))
            );
        }

        return [...filtered].sort((a, b) => {
            let valA: any;
            let valB: any;

            switch (savedSortField) {
                case 'level':
                    valA = a.level;
                    valB = b.level;
                    break;
                case 'name':
                    const petInfoA = petsConfig?.mapping ? Object.values(petsConfig.mapping).find((v: any) => v.id === a.id && v.rarity === a.rarity) as any : null;
                    const petInfoB = petsConfig?.mapping ? Object.values(petsConfig.mapping).find((v: any) => v.id === b.id && v.rarity === b.rarity) as any : null;
                    valA = a.customName || petInfoA?.name || `Pet #${a.id}`;
                    valB = b.customName || petInfoB?.name || `Pet #${b.id}`;
                    break;
                case 'rarity':
                    valA = RARITIES.indexOf(a.rarity);
                    valB = RARITIES.indexOf(b.rarity);
                    break;
                case 'perfection':
                    valA = getPerfection(a);
                    valB = getPerfection(b);
                    break;
                default:
                    valA = a.id;
                    valB = b.id;
            }

            if (typeof valA === 'string') {
                return savedSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return savedSortOrder === 'asc' ? valA - valB : valB - valA;
        });
    }, [profile.pets.savedBuilds, searchTerm, savedSortField, savedSortOrder, filterRarities, minPerfection, filterStats, petsConfig, secondaryStatLibrary]);

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
                                textureSrc={getAscensionTexturePath('Eggs', profile.misc.petAscensionLevel || 0, selectedVersion)}
                                spriteWidth={256}
                                spriteHeight={256}
                                sheetWidth={1024}
                                sheetHeight={1024}
                                iconIndex={0}
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
                                        setSelectedSavedIndex(null);
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
                                            textureSrc={getAscensionTexturePath('Eggs', profile.misc.petAscensionLevel || 0, selectedVersion)}
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
                                                setSelectedSavedIndex(null);
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "relative aspect-square rounded-xl border-2 transition-all p-2 flex flex-col items-center justify-center gap-1 group overflow-hidden bg-bg-secondary/40",
                                                selectedPetId === pet.id && activeTab === 'library'
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
                                                        textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0, selectedVersion)}
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
                            <div className="space-y-4">
                                <div className="flex flex-col gap-3 mb-4 bg-bg-secondary/40 p-3 rounded-xl border border-border/50">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="flex items-center gap-1 bg-bg-input rounded-lg p-1 border border-border">
                                                <select
                                                    value={savedSortField}
                                                    onChange={(e) => setSavedSortField(e.target.value as SortField)}
                                                    className="bg-transparent text-[10px] font-black uppercase tracking-wider px-2 py-1 outline-none cursor-pointer text-text-primary"
                                                >
                                                    {(['level', 'name', 'rarity', 'perfection'] as SortField[]).map(field => (
                                                        <option key={field} value={field} className="bg-bg-secondary text-text-primary">
                                                            {field}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-8 w-8 p-0"
                                                onClick={() => setSavedSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                                            >
                                                {savedSortOrder === 'asc' ? '↑' : '↓'}
                                            </Button>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowFilters(!showFilters)}
                                            className={cn("h-8 gap-2 text-[10px] font-black uppercase tracking-wider ml-auto md:ml-0", showFilters && "text-accent-primary bg-accent-primary/10")}
                                        >
                                            <Settings className="w-3.5 h-3.5" />
                                            Filters {(filterRarities.length > 0 || minPerfection > 0 || filterStats.length > 0) && `(${(filterRarities.length > 0 ? 1 : 0) + (minPerfection > 0 ? 1 : 0) + (filterStats.length > 0 ? 1 : 0)})`}
                                        </Button>
                                    </div>

                                    {showFilters && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/30 animate-in fade-in slide-in-from-top-1">
                                            <div className="space-y-2">
                                                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">Rarity</label>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {RARITIES.map(rarity => (
                                                        <button
                                                            key={rarity}
                                                            onClick={() => setFilterRarities(prev => prev.includes(rarity) ? prev.filter(r => r !== rarity) : [...prev, rarity])}
                                                            className={cn(
                                                                "px-2 py-0.5 rounded text-[9px] font-bold border transition-all",
                                                                filterRarities.includes(rarity)
                                                                    ? `bg-rarity-${rarity.toLowerCase()}/20 border-rarity-${rarity.toLowerCase()} text-rarity-${rarity.toLowerCase()}`
                                                                    : "bg-bg-input border-border text-text-muted hover:border-border/80"
                                                            )}
                                                        >
                                                            {rarity}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">Min Perfection: {minPerfection}%</label>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="100"
                                                    value={minPerfection}
                                                    onChange={(e) => setMinPerfection(parseInt(e.target.value))}
                                                    className="w-full h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                                />
                                            </div>
                                            <div className="space-y-2 md:col-span-2">
                                                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">Required Stats (Multiselect)</label>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {STAT_TYPES.map(statId => (
                                                        <button
                                                            key={statId}
                                                            onClick={() => setFilterStats(prev => prev.includes(statId) ? prev.filter(s => s !== statId) : [...prev, statId])}
                                                            className={cn(
                                                                "px-2 py-1 rounded-md text-[9px] font-bold border transition-all",
                                                                filterStats.includes(statId)
                                                                    ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                                                                    : "bg-bg-input border-border text-text-muted hover:border-border/80"
                                                            )}
                                                        >
                                                            {getStatName(statId)}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            {(filterRarities.length > 0 || minPerfection > 0 || filterStats.length > 0) && (
                                                <button
                                                    onClick={() => { setFilterRarities([]); setMinPerfection(0); setFilterStats([]); }}
                                                    className="md:col-span-2 text-[9px] font-black text-red-400 hover:text-red-300 uppercase tracking-widest text-center py-1"
                                                >
                                                    Clear All Filters
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {sortedSavedBuilds.length > 0 ? (
                                        sortedSavedBuilds.map((savedPet, sIdx) => {
                                            // Find real index in profile for deletion
                                            const originalIdx = profile.pets.savedBuilds.indexOf(savedPet);
                                            
                                            const spriteInfo = petsConfig?.mapping ?
                                                Object.entries(petsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedPet.id && v.rarity === savedPet.rarity)
                                                : null;

                                            const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;
                                            const isSelected = selectedSavedIndex === originalIdx;
                                            const isEquipped = profile.pets.active.some(ap =>
                                                ap.id === savedPet.id && ap.rarity === savedPet.rarity &&
                                                JSON.stringify(ap.secondaryStats) === JSON.stringify(savedPet.secondaryStats)
                                            );

                                            return (
                                                <ItemSelectionCard
                                                    key={originalIdx}
                                                    item={savedPet}
                                                    slotKey="pet-saved"
                                                    slotLabel="Saved Pet"
                                                    itemName={savedPet.customName || `Pet #${savedPet.id}`}
                                                    itemImage={null}
                                                    rarity={savedPet.rarity}
                                                    isSaved={true}
                                                    isSelected={isSelected}
                                                    isEquipped={isEquipped}
                                                    hideAgeStyles={true}
                                                    perfection={getPerfection(savedPet)}
                                                    getStatPerfection={getStatPerfection}
                                                    onClick={() => {
                                                        setSelectedRarity(savedPet.rarity);
                                                        setSelectedPetId(savedPet.id);
                                                        setPetLevel(savedPet.level);
                                                        setManualStats(savedPet.secondaryStats || []);
                                                        setSelectedSavedIndex(originalIdx);
                                                        setMobileTab('config');
                                                    }}
                                                    onDelete={(e) => {
                                                        e.stopPropagation();
                                                        const newSaved = [...(profile.pets.savedBuilds || [])];
                                                        newSaved.splice(originalIdx, 1);
                                                        updateNestedProfile('pets', { savedBuilds: newSaved });
                                                        if (selectedSavedIndex === originalIdx) {
                                                            setSelectedSavedIndex(null);
                                                            setSelectedPetId(null);
                                                        }
                                                    }}
                                                    renderIcon={() => (
                                                        <SpriteSheetIcon
                                                            textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0, selectedVersion)}
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
                                            <p className="font-bold">{searchTerm ? 'No results found' : 'No saved pets'}</p>
                                            <p className="text-xs opacity-60">Presets will appear here after you save them in the main panel</p>
                                        </div>
                                    )}
                                </div>
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
                                {/* Custom Name for Presets */}
                                {activeTab === 'saved' && selectedSavedIndex !== null && (
                                    <div className="space-y-2 mb-2">
                                        <label className="text-[10px] font-bold text-text-muted block uppercase tracking-widest">Preset Name</label>
                                        <div className="relative group">
                                            <input
                                                value={profile.pets.savedBuilds[selectedSavedIndex]?.customName || ''}
                                                onChange={(e) => {
                                                    const newSaved = [...profile.pets.savedBuilds];
                                                    if (newSaved[selectedSavedIndex]) {
                                                        newSaved[selectedSavedIndex] = {
                                                            ...newSaved[selectedSavedIndex],
                                                            customName: e.target.value
                                                        };
                                                        updateNestedProfile('pets', { savedBuilds: newSaved });
                                                    }
                                                }}
                                                placeholder="Set a custom name..."
                                                className="w-full bg-bg-input/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-accent-primary transition-all pr-10"
                                            />
                                            <Settings className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted opacity-30 group-hover:opacity-60 transition-opacity" />
                                        </div>
                                    </div>
                                )}

                                {/* Item Preview */}
                                <div className="text-center">
                                    <div
                                        className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-xl border-2 overflow-hidden relative"
                                        style={{ ...getRarityBgStyle(selectedRarity), borderColor: `var(--rarity-${selectedRarity.toLowerCase()})` }}
                                    >
                                        {petsConfig && (
                                            <SpriteSheetIcon
                                                textureSrc={getAscensionTexturePath('Pets', profile.misc.petAscensionLevel || 0, selectedVersion)}
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
