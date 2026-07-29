import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Info, Plus, Trash2, Grid, Settings, Bookmark, Search, Unlock } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { MountSlot } from '../../types/Profile';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';

import { ModalLevelSelector } from '../UI/ModalLevelSelector';
import { SecondaryStatCard } from '../UI/SecondaryStatCard';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { RARITIES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { getStatName } from '../../utils/statNames';
import { useProfile } from '../../context/ProfileContext';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { useGameDataContext } from '../../context/GameDataContext';

type MobileTab = 'rarity' | 'mounts' | 'config';
type SortField = 'level' | 'name' | 'rarity' | 'perfection';
type SortOrder = 'asc' | 'desc';

interface MountSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (rarity: string | null, id?: number, level?: number, secondaryStats?: { statId: string; value: number }[]) => void;
    context?: 'profile' | 'pvp';
    currentMount?: MountSlot | null;
    mountAscensionLevel?: number;
}

const STAT_TYPES = [
    'CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal',
    'DoubleDamageChance', 'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti',
    'AttackSpeed', 'SkillDamageMulti', 'SkillCooldownMulti', 'HealthMulti'
];

export function MountSelectorModal({ isOpen, onClose, onSelect, currentMount, context = 'profile', mountAscensionLevel }: MountSelectorModalProps) {
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mountUpgradeLib } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { profile, updateNestedProfile } = useProfile();

    // Ref to break circular dependency in auto-sync effect
    const savedBuildsRef = useRef(profile.mount.savedBuilds);
    savedBuildsRef.current = profile.mount.savedBuilds;

    const { data: petUnlockLib } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const { selectedVersion } = useGameDataContext();

    const [activeTab, setActiveTab] = useState<'library' | 'saved'>('library');
    const [mobileTab, setMobileTab] = useState<MobileTab>('mounts');
    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [selectedMountId, setSelectedMountId] = useState<number | null>(null);
    const [mountLevel, setMountLevel] = useState<number>(1);
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

    // Reset state when opening or populate from currentMount
    useEffect(() => {
        if (isOpen) {
            if (currentMount) {
                // Try to find if it's a saved one
                const savedIdx = profile.mount.savedBuilds.findIndex(m => 
                    m.id === currentMount.id && 
                    m.rarity === currentMount.rarity && 
                    JSON.stringify(m.secondaryStats) === JSON.stringify(currentMount.secondaryStats)
                );

                if (savedIdx !== -1) {
                    setSelectedSavedIndex(savedIdx);
                    setActiveTab('saved');
                } else {
                    setSelectedSavedIndex(null);
                    setActiveTab('library');
                }

                setSelectedRarity(currentMount.rarity);
                setSelectedMountId(currentMount.id);
                setMountLevel(currentMount.level);
                setManualStats(currentMount.secondaryStats || []);
            } else {
                setSelectedSavedIndex(null);
                setSelectedRarity('Common');
                setSelectedMountId(null);
                setMountLevel(1);
                setManualStats([]);
                setActiveTab('library');
            }
            setSearchTerm('');
            if (context === 'pvp') setActiveTab('library');
            setMobileTab('mounts');
        }
    }, [isOpen]);

    const maxSlots = useMemo(() => {
        const currentAsc = mountAscensionLevel !== undefined ? mountAscensionLevel : (profile.misc.mountAscensionLevel || 0);
        if (currentAsc > 0) return 2;
        if (!petUnlockLib || !selectedRarity) return 0;
        return petUnlockLib[selectedRarity]?.NumberOfSecondStats || 0;
    }, [petUnlockLib, selectedRarity, profile.misc.mountAscensionLevel, mountAscensionLevel]);

    const maxMountLevel = useMemo(() => {
        if (!mountUpgradeLib || !selectedRarity) return 100;
        return mountUpgradeLib[selectedRarity]?.LevelInfo?.length || 100;
    }, [mountUpgradeLib, selectedRarity]);

    useEffect(() => {
        if (manualStats.length > maxSlots) {
            setManualStats(prev => prev.slice(0, maxSlots));
        }
    }, [maxSlots, manualStats.length]);

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

    const getPerfection = (item: MountSlot): number | null => {
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

    const addStat = () => {
        if (manualStats.length < maxSlots) {
            const existingTypes = new Set(manualStats.map(s => s.statId));
            const nextType = STAT_TYPES.find(t => !existingTypes.has(t)) || STAT_TYPES[0];
            const range = getStatRange(nextType);
            setManualStats([...manualStats, {
                statId: nextType,
                value: range ? parseFloat((range.min * 100).toFixed(2)) : 0
            }]);
        }
    };

    const updateStat = (index: number, field: 'statId' | 'value', value: any) => {
        const newStats = [...manualStats];
        if (field === 'statId') {
            const range = getStatRange(value);
            let currentValue = newStats[index].value;
            if (range && currentValue > (range.max * 100)) currentValue = parseFloat((range.max * 100).toFixed(2));
            newStats[index] = { ...newStats[index], statId: value, value: currentValue };
        } else {
            newStats[index] = { ...newStats[index], [field]: value };
        }
        setManualStats(newStats);
    };

    const removeStat = (index: number) => setManualStats(manualStats.filter((_, i) => i !== index));

    // Auto-sync for saved mounts (uses ref to avoid re-triggering on savedBuilds change)
    useEffect(() => {
        if (!isOpen) return;
        if (selectedSavedIndex !== null && activeTab === 'saved') {
            const currentSaved = savedBuildsRef.current;
            const savedMount = currentSaved[selectedSavedIndex];
            if (savedMount) {
                const updatedMount: MountSlot = {
                    ...savedMount,
                    level: mountLevel,
                    secondaryStats: manualStats
                };

                const hasChanged = 
                    savedMount.level !== updatedMount.level ||
                    JSON.stringify(savedMount.secondaryStats) !== JSON.stringify(updatedMount.secondaryStats);

                if (hasChanged) {
                    const newSaved = [...currentSaved];
                    newSaved[selectedSavedIndex] = updatedMount;

                    // Also propagate to active mount if this saved mount is currently equipped
                    const activeMount = profile.mount.active;
                    let updatedActive: MountSlot | null = null;
                    if (activeMount &&
                        activeMount.id === savedMount.id && activeMount.rarity === savedMount.rarity &&
                        activeMount.level === savedMount.level &&
                        JSON.stringify(activeMount.secondaryStats) === JSON.stringify(savedMount.secondaryStats)) {
                        updatedActive = updatedMount;
                    }

                    updateNestedProfile('mount', {
                        savedBuilds: newSaved,
                        ...(updatedActive ? { active: updatedActive } : {})
                    });
                }
            }
        }
    }, [mountLevel, manualStats, activeTab, selectedSavedIndex, updateNestedProfile, profile.mount.active, isOpen]);

    const mountsConfig = spriteMapping?.mounts;

    const sortedSavedBuilds = useMemo(() => {
        const base = profile.mount.savedBuilds || [];
        let filtered = base;

        // Search Filter
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            filtered = filtered.filter(m => {
                const mountInfo = mountsConfig?.mapping ? 
                    Object.values(mountsConfig.mapping).find((v: any) => v.id === m.id && v.rarity === m.rarity) as any 
                    : null;
                const name = m.customName || mountInfo?.name || `Mount #${m.id}`;
                return name.toLowerCase().includes(q);
            });
        }

        // Rarity Filter
        if (filterRarities.length > 0) {
            filtered = filtered.filter(m => filterRarities.includes(m.rarity));
        }

        // Perfection Filter
        if (minPerfection > 0) {
            filtered = filtered.filter(m => (getPerfection(m) || 0) >= minPerfection);
        }

        // Stats Filter
        if (filterStats.length > 0) {
            filtered = filtered.filter(m => 
                filterStats.some(sId => m.secondaryStats?.some(s => s.statId === sId))
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
                    const mountInfoA = mountsConfig?.mapping ? Object.values(mountsConfig.mapping).find((v: any) => v.id === a.id && v.rarity === a.rarity) as any : null;
                    const mountInfoB = mountsConfig?.mapping ? Object.values(mountsConfig.mapping).find((v: any) => v.id === b.id && v.rarity === b.rarity) as any : null;
                    valA = a.customName || mountInfoA?.name || `Mount #${a.id}`;
                    valB = b.customName || mountInfoB?.name || `Mount #${b.id}`;
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
    }, [profile.mount.savedBuilds, searchTerm, savedSortField, savedSortOrder, filterRarities, minPerfection, filterStats, mountsConfig, secondaryStatLibrary]);

    const filteredMounts = useMemo(() => {
        if (!mountsConfig?.mapping) return [];
        return Object.entries(mountsConfig.mapping)
            .map(([idx, info]: [string, any]) => ({ spriteIndex: parseInt(idx), ...info }))
            .filter((m: any) => m.rarity === selectedRarity)
            .filter((m: any) => !searchTerm || m.name?.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [mountsConfig, selectedRarity, searchTerm]);

    const handleSave = () => {
        if (selectedMountId !== null) {
            onSelect(selectedRarity, selectedMountId, mountLevel, manualStats);
            onClose();
        }
    };

    const getMountStats = () => {
        if (!mountUpgradeLib || !selectedRarity) return null;
        const rarityData = mountUpgradeLib[selectedRarity];
        if (!rarityData?.LevelInfo) return null;
        const targetLevel = Math.max(0, mountLevel - 1);
        const levelInfo = rarityData.LevelInfo.find((l: any) => l.Level === targetLevel);
        return levelInfo?.MountStats;
    };

    const mountStats = getMountStats();

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[90vh] md:h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
                            <SpriteSheetIcon
                                textureSrc={getAscensionTexturePath('MountIcons', 0, selectedVersion)}
                                spriteWidth={256}
                                spriteHeight={256}
                                sheetWidth={1024}
                                sheetHeight={1024}
                                iconIndex={9}
                                className="w-8 h-8"
                            />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">{currentMount ? 'Edit Mount' : 'Select Mount'}</h3>
                            <p className="text-xs text-text-muted">Choose a mount and configure stats</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mobile Unequip Button */}
                {currentMount && (
                    <div className="px-4 py-2 border-b border-border bg-red-500/10 md:hidden">
                        <Button
                            variant="ghost"
                            className="w-full border-red-500/30 text-red-400 hover:bg-red-500/20 py-2 h-auto"
                            onClick={() => { onSelect(null); onClose(); }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" /> Unequip Mount
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
                        onClick={() => setMobileTab('mounts')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'mounts'
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

                <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                    {/* Sidebar */}
                    <div className={cn(
                        "w-full md:w-52 border-b md:border-b-0 md:border-r border-border flex flex-col bg-bg-secondary/10 flex-shrink-0",
                        mobileTab !== 'rarity' && "hidden md:flex"
                    )}>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 md:p-0 space-y-2 md:space-y-0">
                            {/* Saved Builds */}
                            {context === 'profile' && (
                                <button
                                    onClick={() => { setActiveTab('saved'); setMobileTab('mounts'); }}
                                    className={cn(
                                        "w-full flex items-center justify-start gap-3 p-3 md:px-4 md:py-3.5 text-xs font-bold uppercase transition-all rounded-xl md:rounded-lg border-2",
                                        activeTab === 'saved' ? "bg-accent-primary/20 text-accent-primary border-accent-primary shadow-md" : "text-text-muted hover:bg-white/5 border-transparent bg-bg-input/20 md:bg-transparent"
                                    )}
                                >
                                    <div className="w-8 h-8 rounded bg-bg-secondary flex items-center justify-center shrink-0 md:hidden">
                                        <Bookmark className={cn("w-5 h-5", activeTab === 'saved' && "fill-accent-primary")} />
                                    </div>
                                    <Bookmark className={cn("hidden md:block w-4 h-4", activeTab === 'saved' && "fill-accent-primary")} />
                                    <div className="flex-1 text-left">
                                        <span className="block">Saved Builds</span>
                                        <span className="text-[10px] text-text-muted normal-case font-normal md:hidden">
                                            {profile.mount.savedBuilds?.length || 0} items
                                        </span>
                                    </div>
                                    <span className="hidden md:block ml-auto bg-black/20 px-1.5 rounded-full text-[10px]">
                                        {profile.mount.savedBuilds?.length || 0}
                                    </span>
                                </button>
                            )}

                            <div className="hidden md:block px-4 py-2 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest mt-2">
                                Mount Library
                            </div>
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setActiveTab('library');
                                        setSelectedRarity(rarity);
                                        setSelectedMountId(null);
                                        setSelectedSavedIndex(null);
                                        setManualStats([]);
                                        setMobileTab('mounts');
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-3 p-3 md:px-4 md:py-2.5 text-xs font-bold transition-all rounded-xl md:rounded-lg border-2",
                                        activeTab === 'library' && selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border-rarity-${rarity.toLowerCase()} shadow-md`
                                            : "text-text-muted hover:bg-white/5 border-transparent bg-bg-input/20 md:bg-transparent"
                                    )}
                                >
                                    <div className="shrink-0 flex items-center justify-center">
                                        <div className={cn("w-3 h-3 md:w-2 md:h-2 rounded-full", `bg-rarity-${rarity.toLowerCase()}`)} />
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



                    {/* Content Area */}
                    <div className={cn(
                        "flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden",
                        mobileTab !== 'mounts' && "hidden md:flex"
                    )}>
                        {/* Grid */}
                        <div className={cn(
                            "overflow-y-auto custom-scrollbar p-3 md:p-4 bg-bg-primary/30",
                            mobileTab === 'mounts' ? "flex-1 block" : "hidden md:block md:flex-1"
                        )}>
                            <div className="relative mb-4">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                                <input
                                    placeholder={activeTab === 'library' ? "Search mount library..." : "Search saved builds..."}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-bg-input border border-border rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary transition-all"
                                    onFocus={(e) => e.target.select()}
                                />
                            </div>

                            {activeTab === 'library' ? (
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                    {filteredMounts.map((mount: any) => (
                                        <button
                                            key={mount.id}
                                            onClick={() => {
                                                setSelectedMountId(mount.id);
                                                setSelectedSavedIndex(null);
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "relative rounded-xl border-2 transition-all p-1.5 flex flex-col items-center gap-1 group overflow-hidden",
                                                selectedMountId === mount.id && activeTab === 'library'
                                                    ? `border-rarity-${selectedRarity.toLowerCase()} shadow-lg shadow-rarity-${selectedRarity.toLowerCase()}/20 bg-rarity-${selectedRarity.toLowerCase()}/5`
                                                    : "border-border hover:border-accent-primary/50"
                                            )}
                                        >
                                            <div
                                                className="w-full aspect-square rounded-lg flex items-center justify-center pointer-events-none"
                                                style={{ ...getRarityBgStyle(selectedRarity) }}
                                            >
                                                <SpriteSheetIcon
                                                    textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0, selectedVersion)}
                                                    spriteWidth={mountsConfig!.sprite_size.width}
                                                    spriteHeight={mountsConfig!.sprite_size.height}
                                                    sheetWidth={mountsConfig!.texture_size.width}
                                                    sheetHeight={mountsConfig!.texture_size.height}
                                                    iconIndex={mount.spriteIndex}
                                                    className="w-16 h-16 drop-shadow-lg"
                                                />
                                            </div>
                                            <span className="text-[10px] text-center text-text-primary font-bold truncate w-full leading-tight select-none">
                                                {mount.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
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
                                            sortedSavedBuilds.map((savedMount, sIdx) => {
                                                const originalIdx = profile.mount.savedBuilds.indexOf(savedMount);
                                                const spriteInfo = mountsConfig?.mapping ?
                                                    Object.entries(mountsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedMount.id && v.rarity === savedMount.rarity)
                                                    : null;
                                                const isSelected = selectedSavedIndex === originalIdx;
                                                const activeMount = profile.mount.active;
                                                const isEquipped = !!activeMount &&
                                                    activeMount.id === savedMount.id && activeMount.rarity === savedMount.rarity &&
                                                    JSON.stringify(activeMount.secondaryStats) === JSON.stringify(savedMount.secondaryStats);

                                                return (
                                                    <ItemSelectionCard
                                                        key={originalIdx}
                                                        item={savedMount}
                                                        slotKey="mount-saved"
                                                        slotLabel="Saved Mount"
                                                        itemName={savedMount.customName || (spriteInfo ? (spriteInfo[1] as any).name : `Mount #${savedMount.id}`)}
                                                        itemImage={null}
                                                        isSelected={isSelected}
                                                        isEquipped={isEquipped}
                                                        rarity={savedMount.rarity}
                                                        hideAgeStyles={true}
                                                        perfection={getPerfection(savedMount)}
                                                        getStatPerfection={getStatPerfection}
                                                        onClick={() => {
                                                            setSelectedRarity(savedMount.rarity);
                                                            setSelectedMountId(savedMount.id);
                                                            setMountLevel(savedMount.level);
                                                            setManualStats(savedMount.secondaryStats || []);
                                                            setSelectedSavedIndex(originalIdx);
                                                            setMobileTab('config');
                                                        }}
                                                        onDelete={(e) => {
                                                            e.stopPropagation();
                                                            const newSaved = [...(profile.mount.savedBuilds || [])];
                                                            newSaved.splice(originalIdx, 1);
                                                            updateNestedProfile('mount', { savedBuilds: newSaved });
                                                            if (selectedSavedIndex === originalIdx) {
                                                                setSelectedSavedIndex(null);
                                                                setSelectedMountId(null);
                                                            }
                                                        }}
                                                        renderIcon={() => (
                                                            <SpriteSheetIcon
                                                                textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0, selectedVersion)}
                                                                spriteWidth={mountsConfig!.sprite_size.width}
                                                                spriteHeight={mountsConfig!.sprite_size.height}
                                                                sheetWidth={mountsConfig!.texture_size.width}
                                                                sheetHeight={mountsConfig!.texture_size.height}
                                                                iconIndex={spriteInfo ? parseInt(spriteInfo[0]) : 0}
                                                                className="w-12 h-12"
                                                            />
                                                        )}
                                                    />
                                                );
                                            })
                                        ) : (
                                            <div className="col-span-full flex flex-col items-center justify-center py-20 text-text-muted">
                                                <Bookmark className="w-12 h-12 opacity-20 mb-4" />
                                                <p className="font-bold">{searchTerm ? 'No results found' : 'No saved mounts'}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Config Panel */}
                    <div className={cn(
                        "w-full md:w-80 border-t md:border-t-0 md:border-l border-border bg-bg-secondary/20 flex flex-col min-h-0",
                        mobileTab === 'config' ? "flex-1 flex" : "hidden md:flex md:flex-initial"
                    )}>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-6">
                            {selectedMountId !== null ? (
                                <>
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-black text-text-primary flex items-center gap-2 uppercase tracking-tight">
                                            <Settings className="w-4 h-4 text-accent-primary" />
                                            Companion Config
                                        </h3>

                                        {/* Item Preview */}
                                        <div className="text-center bg-bg-primary/30 rounded-2xl p-4 border border-border/50">
                                            <div
                                                className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-xl border-2 overflow-hidden relative"
                                                style={{ ...getRarityBgStyle(selectedRarity), borderColor: `var(--rarity-${selectedRarity.toLowerCase()})` }}
                                            >
                                                {mountsConfig && (
                                                    <SpriteSheetIcon
                                                        textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0, selectedVersion)}
                                                        spriteWidth={mountsConfig.sprite_size.width}
                                                        spriteHeight={mountsConfig.sprite_size.height}
                                                        sheetWidth={mountsConfig.texture_size.width}
                                                        sheetHeight={mountsConfig.texture_size.height}
                                                        iconIndex={Object.entries(mountsConfig.mapping as Record<string, any>).find(([_, v]) => v.id === selectedMountId && v.rarity === selectedRarity)?.[0] ? parseInt(Object.entries(mountsConfig.mapping as Record<string, any>).find(([_, v]) => v.id === selectedMountId && v.rarity === selectedRarity)![0]) : 0}
                                                        className="w-20 h-20"
                                                    />
                                                )}
                                            </div>
                                            <h2 className="text-xl font-bold text-text-primary leading-tight">
                                                {(Object.values(mountsConfig?.mapping || {}) as any[]).find((p: any) => p.id === selectedMountId && p.rarity === selectedRarity)?.name || `Mount #${selectedMountId}`}
                                            </h2>
                                            <div className={cn("text-[10px] font-bold uppercase tracking-widest mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                                {selectedRarity} Companion
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            {activeTab === 'saved' && selectedSavedIndex !== null && (
                                                <div className="space-y-1.5">
                                                    <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Preset Name</label>
                                                    <div className="relative group">
                                                        <input
                                                            placeholder="Enter preset name..."
                                                            value={profile.mount.savedBuilds[selectedSavedIndex]?.customName || ''}
                                                            onChange={(e) => {
                                                                if (selectedSavedIndex !== null) {
                                                                    const newSaved = [...profile.mount.savedBuilds];
                                                                    newSaved[selectedSavedIndex] = {
                                                                        ...newSaved[selectedSavedIndex],
                                                                        customName: e.target.value
                                                                    };
                                                                    updateNestedProfile('mount', { savedBuilds: newSaved });
                                                                }
                                                            }}
                                                            className="w-full bg-bg-input border border-border focus:border-accent-primary transition-all h-10 text-sm font-bold pl-3 rounded-lg"
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest px-1">Companion Level</label>
                                                <ModalLevelSelector
                                                    level={mountLevel}
                                                    onChange={setMountLevel}
                                                    maxLevel={maxMountLevel}
                                                    label="Mount Level"
                                                    className="bg-bg-input rounded-xl p-3 border border-border"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-[10px] font-black text-text-muted uppercase tracking-widest">
                                                Passive Stats ({manualStats.length}/{maxSlots})
                                            </h3>
                                            {manualStats.length < maxSlots && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={addStat}
                                                    className="h-7 px-2 text-[10px] font-black text-accent-primary hover:bg-accent-primary/10 uppercase tracking-wider"
                                                >
                                                    <Plus className="w-3.5 h-3.5 mr-1" />
                                                    Add Stat
                                                </Button>
                                            )}
                                        </div>

                                        <div className="space-y-3">
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
                                                        onStatIdChange={(newId) => updateStat(idx, 'statId', newId)}
                                                        onValueChange={(newVal) => updateStat(idx, 'value', newVal)}
                                                        onRemove={() => removeStat(idx)}
                                                        range={range}
                                                    />
                                                );
                                            })}
                                            {manualStats.length === 0 && (
                                                <div className="bg-bg-input/10 border-2 border-dashed border-border/50 rounded-2xl p-6 text-center">
                                                    <p className="text-[11px] text-text-muted font-bold uppercase tracking-wider">No stats added</p>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={addStat}
                                                        className="mt-2 text-[10px] font-black text-accent-primary hover:bg-accent-primary/10 uppercase tracking-widest"
                                                    >
                                                        Add first stat
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-12">
                                    <div className="w-16 h-16 rounded-3xl bg-bg-primary flex items-center justify-center border border-border shadow-inner">
                                        <Grid className="w-8 h-8 text-text-muted opacity-20" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-text-primary uppercase tracking-tight">No Mount Selected</p>
                                        <p className="text-[11px] text-text-muted font-medium mt-1">Select a companion from the library to configure its stats</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {selectedMountId !== null && (
                            <div className="p-4 bg-bg-primary/50 border-t border-border mt-auto">
                                <Button
                                    onClick={() => {
                                        onSelect(selectedRarity, selectedMountId, mountLevel, manualStats);
                                        onClose();
                                    }}
                                    className="w-full bg-accent-primary hover:bg-accent-primary/90 text-white font-black py-4 rounded-2xl shadow-lg shadow-accent-primary/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] uppercase tracking-wider text-xs"
                                >
                                    Equip Companion
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>, document.body
    );
}