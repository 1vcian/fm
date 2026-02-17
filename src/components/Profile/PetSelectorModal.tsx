import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SecondaryStatInput } from '../UI/SecondaryStatInput';
import { Plus, Trash2, Save, Info, Minus, X, Search, Star, Grid, Settings } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { PetSlot } from '../../types/Profile';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useProfile } from '../../context/ProfileContext';
import { RARITIES } from '../../utils/constants';
import { getStatName } from '../../utils/statNames';

type MobileTab = 'rarity' | 'pets' | 'config';

interface PetSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (pet: PetSlot) => void;
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
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
                        <div>
                            <h3 className="text-xl font-bold">{currentPet ? 'Edit Pet' : 'Select Pet'}</h3>
                            <p className="text-xs text-text-muted">Choose a pet and configure stats</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                {context === 'profile' && (
                    <div className="flex border-b border-border">
                        <button
                            onClick={() => setActiveTab('library')}
                            className={cn(
                                "flex-1 py-3 text-sm font-bold border-b-2 transition-colors",
                                activeTab === 'library' ? "border-accent-primary text-accent-primary bg-accent-primary/5" : "border-transparent text-text-muted hover:text-text-primary"
                            )}
                        >
                            Pet Library
                        </button>
                        <button
                            onClick={() => setActiveTab('saved')}
                            className={cn(
                                "flex-1 py-3 text-sm font-bold border-b-2 transition-colors",
                                activeTab === 'saved' ? "border-accent-primary text-accent-primary bg-accent-primary/5" : "border-transparent text-text-muted hover:text-text-primary"
                            )}
                        >
                            Saved Builds ({profile.pets.savedBuilds?.length || 0})
                        </button>
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
                        <Star className="w-4 h-4" />
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
                        Pets
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

                {/* Mobile Content */}
                <div className="flex-1 overflow-hidden md:hidden">
                    {/* Mobile Rarity Selection */}
                    {mobileTab === 'rarity' && activeTab === 'library' && (
                        <div className="p-3 space-y-2 overflow-y-auto h-full">
                            <div className="text-xs font-bold text-text-muted uppercase mb-3">Select Rarity</div>
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setSelectedRarity(rarity);
                                        setSelectedPetId(null);
                                        setManualStats([]);
                                        setMobileTab('pets');
                                    }}
                                    className={cn(
                                        "w-full text-left px-4 py-3 rounded-lg transition-all text-sm font-bold border-2",
                                        selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border-rarity-${rarity.toLowerCase()}/50`
                                            : "hover:bg-white/5 text-text-secondary border-transparent"
                                    )}
                                >
                                    {rarity}
                                </button>
                            ))}
                        </div>
                    )}
                    {mobileTab === 'rarity' && activeTab === 'saved' && (
                        <div className="p-4 text-center text-text-muted">
                            <p className="text-sm">Switch to the Pets tab to view saved builds.</p>
                        </div>
                    )}

                    {/* Mobile Pets Grid */}
                    {mobileTab === 'pets' && (
                        <div className="p-3 overflow-y-auto h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                                    <input
                                        placeholder="Search pets..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary"
                                        onFocus={(e) => e.target.select()}
                                    />
                                </div>
                            </div>
                            {activeTab === 'library' ? (
                                filteredPets.length > 0 ? (
                                    <div className="grid grid-cols-3 min-[400px]:grid-cols-4 gap-3">
                                        {filteredPets.map((pet: any) => (
                                            <button
                                                key={pet.id}
                                                onClick={() => {
                                                    setSelectedPetId(pet.id);
                                                    setMobileTab('config');
                                                }}
                                                className={cn(
                                                    "relative rounded-xl border-2 transition-all p-2 flex flex-col items-center gap-1",
                                                    selectedPetId === pet.id
                                                        ? `border-rarity-${selectedRarity.toLowerCase()} shadow-lg`
                                                        : "border-border hover:border-accent-primary/50 bg-bg-input/30"
                                                )}
                                            >
                                                <div
                                                    className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center"
                                                    style={getRarityBgStyle(selectedRarity)}
                                                >
                                                    {petsConfig && (
                                                        <SpriteSheetIcon
                                                            textureSrc="./icons/game/Pets.png"
                                                            spriteWidth={petsConfig.sprite_size.width}
                                                            spriteHeight={petsConfig.sprite_size.height}
                                                            sheetWidth={petsConfig.texture_size.width}
                                                            sheetHeight={petsConfig.texture_size.height}
                                                            iconIndex={pet.spriteIndex}
                                                            className="w-12 h-12"
                                                        />
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-center text-text-secondary truncate w-full">
                                                    {pet.name || `Pet #${pet.id}`}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center text-text-muted py-8">No pets found</div>
                                )
                            ) : (
                                <div className="w-full">
                                    {profile.pets.savedBuilds && profile.pets.savedBuilds.length > 0 ? (
                                        <div className="grid grid-cols-2 gap-3">
                                            {profile.pets.savedBuilds.map((savedPet, idx) => {
                                                const spriteInfo = petsConfig?.mapping ?
                                                    Object.entries(petsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedPet.id && v.rarity === savedPet.rarity)
                                                    : null;

                                                const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;

                                                return (
                                                    <div
                                                        key={idx}
                                                        className="relative rounded-xl border border-border bg-bg-secondary p-2 hover:border-accent-primary transition-colors cursor-pointer group"
                                                        onClick={() => {
                                                            setSelectedRarity(savedPet.rarity);
                                                            setSelectedPetId(savedPet.id);
                                                            setPetLevel(savedPet.level);
                                                            setManualStats(savedPet.secondaryStats || []);
                                                            setMobileTab('config');
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className="w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 overflow-hidden"
                                                                style={getRarityBgStyle(savedPet.rarity)}
                                                            >
                                                                {petsConfig && (
                                                                    <SpriteSheetIcon
                                                                        textureSrc="./icons/game/Pets.png"
                                                                        spriteWidth={petsConfig.sprite_size.width}
                                                                        spriteHeight={petsConfig.sprite_size.height}
                                                                        sheetWidth={petsConfig.texture_size.width}
                                                                        sheetHeight={petsConfig.texture_size.height}
                                                                        iconIndex={spriteIndex}
                                                                        className="w-8 h-8"
                                                                    />
                                                                )}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-bold text-xs truncate">{savedPet.customName || `Pet #${savedPet.id}`}</div>
                                                                <div className="text-[10px] text-text-muted">Lv {savedPet.level}</div>
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const newSaved = [...(profile.pets.savedBuilds || [])];
                                                                    newSaved.splice(idx, 1);
                                                                    updateNestedProfile('pets', { savedBuilds: newSaved });
                                                                }}
                                                                className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded transition-colors"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                                            <Save className="w-12 h-12 opacity-20 mb-4" />
                                            <p>No saved pet builds found.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Mobile Config */}
                    {mobileTab === 'config' && (
                        <div className="p-4 overflow-y-auto h-full space-y-4">
                            {selectedPetId !== null ? (
                                <>
                                    <div className="text-center pb-4 border-b border-border">
                                        <div
                                            className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                            style={getRarityBgStyle(selectedRarity)}
                                        >
                                            {petsConfig && (
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/Pets.png"
                                                    spriteWidth={petsConfig.sprite_size.width}
                                                    spriteHeight={petsConfig.sprite_size.height}
                                                    sheetWidth={petsConfig.texture_size.width}
                                                    sheetHeight={petsConfig.texture_size.height}
                                                    iconIndex={filteredPets.find((p: any) => p.id === selectedPetId)?.spriteIndex || 0}
                                                    className="w-16 h-16"
                                                />
                                            )}
                                        </div>
                                        <h2 className="text-lg font-bold">{filteredPets.find((p: any) => p.id === selectedPetId)?.name || `Pet #${selectedPetId}`}</h2>
                                        <p className={cn("text-xs font-bold uppercase", `text-rarity-${selectedRarity.toLowerCase()}`)}>{selectedRarity}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase text-text-muted">Level</label>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setPetLevel(Math.max(1, petLevel - 1))}><Minus className="w-4 h-4" /></Button>
                                            <Input type="number" value={petLevel} onChange={(e) => setPetLevel(Math.max(1, parseInt(e.target.value) || 1))} className="text-center font-mono font-bold" />
                                            <Button variant="ghost" size="sm" onClick={() => setPetLevel(petLevel + 1)}><Plus className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold uppercase text-text-muted">Passive Stats ({manualStats.length}/{maxSecondaryStats})</label>
                                            <Button variant="ghost" size="sm" onClick={handleAddStat} disabled={manualStats.length >= maxSecondaryStats}><Plus className="w-3 h-3 mr-1" />Add</Button>
                                        </div>
                                        {manualStats.map((stat, idx) => {
                                            const range = getStatRange(stat.statId);
                                            return (
                                                <div key={idx} className="flex flex-col gap-1">
                                                    <div className="flex gap-2 items-center">
                                                        <select
                                                            className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                            value={stat.statId}
                                                            onChange={(e) => handleUpdateStat(idx, 'statId', e.target.value)}
                                                        >
                                                            {STAT_TYPES.filter(t =>
                                                                t === stat.statId || !manualStats.some(s => s.statId === t)
                                                            ).map(t => (
                                                                <option key={t} value={t}>{getStatName(t)}</option>
                                                            ))}
                                                        </select>
                                                        <SecondaryStatInput
                                                            value={stat.value as number}
                                                            onChange={(val) => handleUpdateStat(idx, 'value', val)}
                                                            min={(range?.min || 0) * 100}
                                                            max={(range?.max || 1) * 100}
                                                        />
                                                        <button
                                                            onClick={() => handleRemoveStat(idx)}
                                                            className="text-red-400 hover:text-red-300 transition-colors"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    {range && (
                                                        <div className="text-[10px] text-text-muted px-1">
                                                            Range: {(range.min * 100).toFixed(1)}% - {(range.max * 100).toFixed(1)}%
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <Button variant="primary" className="w-full gap-2" onClick={handleSave}><Save className="w-4 h-4" />Confirm</Button>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50 space-y-4">
                                    <Info className="w-12 h-12" />
                                    <div className="text-sm text-center">Select a pet first</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Desktop Content */}
                <div className="flex-1 overflow-hidden hidden md:flex md:flex-row divide-x divide-border">
                    {/* Column 1: Rarity Selection (Only for Library) - Desktop only */}
                    {activeTab === 'library' && (
                        <div className="hidden md:block md:w-40 p-3 overflow-y-auto bg-bg-secondary/10">
                            <div className="text-xs font-bold text-text-muted uppercase mb-2">Rarity</div>
                            <div className="space-y-1">
                                {RARITIES.map((rarity) => (
                                    <button
                                        key={rarity}
                                        onClick={() => {
                                            setSelectedRarity(rarity);
                                            setSelectedPetId(null);
                                            setManualStats([]);
                                        }}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-lg transition-all text-sm font-medium",
                                            selectedRarity === rarity
                                                ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border border-rarity-${rarity.toLowerCase()}/50`
                                                : "hover:bg-white/5 text-text-secondary"
                                        )}
                                    >
                                        {rarity}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Column 2: Pet Grid - Desktop */}
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                                <input
                                    placeholder="Search pets..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary"
                                    onFocus={(e) => e.target.select()}
                                />
                            </div>
                        </div>

                        {activeTab === 'library' ? (
                            filteredPets.length > 0 ? (
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {filteredPets.map((pet: any) => (
                                        <button
                                            key={pet.id}
                                            onClick={() => setSelectedPetId(pet.id)}
                                            className={cn(
                                                "relative rounded-xl border-2 transition-all p-2 flex flex-col items-center gap-1 group overflow-hidden",
                                                selectedPetId === pet.id
                                                    ? `border-rarity-${selectedRarity.toLowerCase()} shadow-lg`
                                                    : "border-border hover:border-accent-primary/50 bg-bg-input/30"
                                            )}
                                        >
                                            <div
                                                className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
                                                style={getRarityBgStyle(selectedRarity)}
                                            >
                                                {petsConfig && (
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/Pets.png"
                                                        spriteWidth={petsConfig.sprite_size.width}
                                                        spriteHeight={petsConfig.sprite_size.height}
                                                        sheetWidth={petsConfig.texture_size.width}
                                                        sheetHeight={petsConfig.texture_size.height}
                                                        iconIndex={pet.spriteIndex}
                                                        className="w-12 h-12"
                                                    />
                                                )}
                                            </div>
                                            <span className="text-[10px] text-center text-text-secondary truncate w-full">
                                                {pet.name || `Pet #${pet.id}`}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-text-muted py-8">
                                    No pets found for {selectedRarity}
                                </div>
                            )
                        ) : (
                            // SAVE TAB CONTENT
                            <div className="w-full">
                                {profile.pets.savedBuilds && profile.pets.savedBuilds.length > 0 ? (
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                        {profile.pets.savedBuilds.map((savedPet, idx) => {
                                            // Find sprite info for saved pet
                                            const spriteInfo = petsConfig?.mapping ?
                                                Object.entries(petsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedPet.id && v.rarity === savedPet.rarity)
                                                : null;

                                            const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;

                                            return (
                                                <div
                                                    key={idx}
                                                    className="relative rounded-xl border border-border bg-bg-secondary p-3 hover:border-accent-primary transition-colors cursor-pointer group"
                                                    onClick={() => {
                                                        setSelectedRarity(savedPet.rarity);
                                                        setSelectedPetId(savedPet.id);
                                                        setPetLevel(savedPet.level);
                                                        setManualStats(savedPet.secondaryStats || []);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 overflow-hidden"
                                                            style={getRarityBgStyle(savedPet.rarity)}
                                                        >
                                                            {petsConfig && spriteInfo && (
                                                                <SpriteSheetIcon
                                                                    textureSrc="./icons/game/Pets.png"
                                                                    spriteWidth={petsConfig.sprite_size.width}
                                                                    spriteHeight={petsConfig.sprite_size.height}
                                                                    sheetWidth={petsConfig.texture_size.width}
                                                                    sheetHeight={petsConfig.texture_size.height}
                                                                    iconIndex={spriteIndex}
                                                                    className="w-10 h-10"
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-bold text-sm truncate">{savedPet.customName || `Pet #${savedPet.id}`}</div>
                                                            <div className="text-xs text-text-muted">Lv {savedPet.level} • {savedPet.rarity}</div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newSaved = [...(profile.pets.savedBuilds || [])];
                                                                newSaved.splice(idx, 1);
                                                                updateNestedProfile('pets', { savedBuilds: newSaved });
                                                            }}
                                                            className="p-1 hover:bg-red-500/20 text-text-muted hover:text-red-500 rounded transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                                        <Save className="w-12 h-12 opacity-20 mb-4" />
                                        <p>No saved pet builds found.</p>
                                        <p className="text-xs opacity-70 mt-2">Configure a pet in the main panel and save it to see it here.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Column 3: Config & Stats (Right) - Desktop */}
                    <div className="w-80 bg-bg-secondary/5 p-4 overflow-y-auto flex flex-col gap-6">
                        {selectedPetId !== null ? (
                            <>
                                <div className="text-center pb-4 border-b border-border">
                                    <div
                                        className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-3 shadow-inner border border-white/5 overflow-hidden"
                                        style={getRarityBgStyle(selectedRarity)}
                                    >
                                        {(() => {
                                            const displayPet = filteredPets.find((p: any) => p.id === selectedPetId);
                                            if (displayPet && petsConfig) {
                                                return (
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/Pets.png"
                                                        spriteWidth={petsConfig.sprite_size.width}
                                                        spriteHeight={petsConfig.sprite_size.height}
                                                        sheetWidth={petsConfig.texture_size.width}
                                                        sheetHeight={petsConfig.texture_size.height}
                                                        iconIndex={displayPet.spriteIndex}
                                                        className="w-20 h-20"
                                                    />
                                                );
                                            }
                                            return (
                                                <SpriteSheetIcon
                                                    textureSrc="./Texture2D/Icons.png"
                                                    spriteWidth={256}
                                                    spriteHeight={256}
                                                    sheetWidth={2048}
                                                    sheetHeight={2048}
                                                    iconIndex={14}
                                                    className="w-10 h-10"
                                                />
                                            );
                                        })()}
                                    </div>
                                    <h2 className="text-xl font-bold text-text-primary">
                                        {filteredPets.find((p: any) => p.id === selectedPetId)?.name || `Pet #${selectedPetId}`}
                                    </h2>
                                    <p className={cn("text-xs font-bold uppercase mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                        {selectedRarity}
                                    </p>

                                    {/* Stats Display */}
                                    {petStats && (
                                        <div className="mt-3 p-2 bg-bg-input/50 rounded-lg border border-border/50 text-xs">
                                            <div className="flex justify-between mb-1">
                                                <span className="text-text-muted">Type</span>
                                                <span className={cn(
                                                    "font-bold",
                                                    petStats.type === 'Damage' ? 'text-red-400' :
                                                        petStats.type === 'Health' ? 'text-green-400' : 'text-blue-400'
                                                )}>{petStats.type}</span>
                                            </div>
                                            {petStats.DamageMultiplier && (
                                                <div className="flex justify-between">
                                                    <span className="text-text-muted">Damage Multi</span>
                                                    <span className="text-accent-primary font-mono">{petStats.DamageMultiplier}x</span>
                                                </div>
                                            )}
                                            {petStats.HealthMultiplier && (
                                                <div className="flex justify-between">
                                                    <span className="text-text-muted">Health Multi</span>
                                                    <span className="text-green-400 font-mono">{petStats.HealthMultiplier}x</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {context !== 'pvp' && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase text-text-muted flex items-center gap-2">
                                            Level
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setPetLevel(Math.max(1, petLevel - 1))}>
                                                <Minus className="w-4 h-4" />
                                            </Button>
                                            <Input
                                                type="number"
                                                value={petLevel}
                                                onChange={(e) => setPetLevel(Math.max(1, parseInt(e.target.value) || 1))}
                                                className="text-center font-mono font-bold"
                                            />
                                            <Button variant="ghost" size="sm" onClick={() => setPetLevel(petLevel + 1)}>
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {context !== 'pvp' && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold uppercase text-text-muted flex items-center gap-2">
                                                Passive Stats
                                                <span className="bg-bg-input px-1.5 rounded text-[10px] border border-white/10">
                                                    {manualStats.length}/{maxSecondaryStats}
                                                </span>
                                            </label>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 text-[10px]"
                                                onClick={handleAddStat}
                                                disabled={manualStats.length >= maxSecondaryStats}
                                            >
                                                <Plus className="w-3 h-3 mr-1" /> Add
                                            </Button>
                                        </div>

                                        {manualStats.length === 0 && (
                                            <div className="text-xs text-text-muted italic text-center py-4 border border-dashed border-border rounded-lg bg-white/5">
                                                No passive stats configured
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            {manualStats.map((stat, idx) => {
                                                const range = getStatRange(stat.statId);
                                                return (
                                                    <div key={idx} className="flex flex-col gap-1">
                                                        <div className="flex gap-2 items-center">
                                                            <select
                                                                className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                                value={stat.statId}
                                                                onChange={(e) => handleUpdateStat(idx, 'statId', e.target.value)}
                                                            >
                                                                {STAT_TYPES.filter(t =>
                                                                    t === stat.statId || !manualStats.some(s => s.statId === t)
                                                                ).map(t => (
                                                                    <option key={t} value={t}>{getStatName(t)}</option>
                                                                ))}
                                                            </select>
                                                            <SecondaryStatInput
                                                                value={stat.value as number}
                                                                onChange={(val) => handleUpdateStat(idx, 'value', val)}
                                                                min={(range?.min || 0) * 100}
                                                                max={(range?.max || 1) * 100}
                                                            />
                                                            <button
                                                                onClick={() => handleRemoveStat(idx)}
                                                                className="text-red-400 hover:text-red-300 transition-colors"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                        {range && (
                                                            <div className="text-[10px] text-text-muted px-1">
                                                                Range: {(range.min * 100).toFixed(1)}% - {(range.max * 100).toFixed(1)}%
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="pt-4 mt-auto">
                                    <Button variant="primary" className="w-full gap-2" onClick={handleSave}>
                                        <Save className="w-4 h-4" /> Confirm Selection
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50 space-y-4">
                                <Info className="w-12 h-12" />
                                <div className="text-sm text-center px-4">Select a pet from the grid to configure stats</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
