import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Bike as MountIcon, Save, Info, Plus, Trash2, Grid, Settings, Bookmark, Search, Unlock } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { MountSlot } from '../../types/Profile';
import { Button } from '../UI/Button';

import { ModalLevelSelector } from '../UI/ModalLevelSelector';
import { SecondaryStatCard } from '../UI/SecondaryStatCard';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { RARITIES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { getStatName } from '../../utils/statNames';
import { useProfile } from '../../context/ProfileContext';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';

type MobileTab = 'rarity' | 'mounts' | 'config';

interface MountSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (rarity: string | null, id?: number, level?: number, secondaryStats?: { statId: string; value: number }[]) => void;
    context?: 'profile' | 'pvp';
    currentMount?: MountSlot | null;
}

const STAT_TYPES = [
    'CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal',
    'DoubleDamageChance', 'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti',
    'AttackSpeed', 'SkillDamageMulti', 'SkillCooldownMulti', 'HealthMulti'
];

export function MountSelectorModal({ isOpen, onClose, onSelect, currentMount, context = 'profile' }: MountSelectorModalProps) {
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mountUpgradeLib } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { profile, updateNestedProfile } = useProfile();
    const { data: petUnlockLib } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');

    const [activeTab, setActiveTab] = useState<'library' | 'saved'>('library');
    const [mobileTab, setMobileTab] = useState<MobileTab>('mounts');
    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [selectedMountId, setSelectedMountId] = useState<number | null>(null);
    const [mountLevel, setMountLevel] = useState<number>(1);
    const [manualStats, setManualStats] = useState<{ statId: string; value: number }[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Reset state when opening or populate from currentMount
    useEffect(() => {
        if (isOpen) {
            if (currentMount) {
                setSelectedRarity(currentMount.rarity);
                setSelectedMountId(currentMount.id);
                setMountLevel(currentMount.level);
                setManualStats(currentMount.secondaryStats || []);
            } else {
                setSelectedRarity('Common');
                setSelectedMountId(null);
                setMountLevel(1);
                setManualStats([]);
            }
            setSearchTerm('');
            if (!currentMount) setActiveTab('library');
            if (context === 'pvp') setActiveTab('library');
            setMobileTab('mounts');
        }
    }, [isOpen, currentMount, context]);

    const maxSlots = useMemo(() => {
        if (!petUnlockLib || !selectedRarity) return 0;
        return petUnlockLib[selectedRarity]?.NumberOfSecondStats || 0;
    }, [petUnlockLib, selectedRarity]);

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

    const mountsConfig = spriteMapping?.mounts;
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg text-accent-primary">
                            <MountIcon className="w-8 h-8" />
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

                <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
                    {/* Sidebar */}
                    <div className={cn(
                        "w-full md:w-52 border-b md:border-b-0 md:border-r border-border flex flex-col bg-bg-secondary/10 flex-shrink-0",
                        mobileTab !== 'rarity' && "hidden md:flex"
                    )}>
                        <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar md:no-scrollbar p-3 md:p-0 space-y-2 md:space-y-0">
                            {/* Saved Builds */}
                            {context === 'profile' && (
                                <button
                                    onClick={() => { setActiveTab('saved'); setMobileTab('mounts'); }}
                                    className={cn(
                                        "flex items-center justify-start gap-3 p-3 md:px-4 md:py-3.5 text-xs font-bold uppercase transition-all rounded-xl md:rounded-lg border-2",
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
                                        setManualStats([]);
                                        setMobileTab('mounts');
                                    }}
                                    className={cn(
                                        "flex items-center gap-3 p-3 md:px-4 md:py-2.5 text-xs font-bold transition-all rounded-xl md:rounded-lg border-2",
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
                    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
                        {/* Grid */}
                        <div className={cn(
                            "flex-1 overflow-y-auto custom-scrollbar p-3 md:p-4 bg-bg-primary/30",
                            mobileTab !== 'mounts' && "hidden md:block"
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
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "relative aspect-square rounded-xl border-2 transition-all p-2 flex flex-col items-center justify-center gap-1 group overflow-hidden bg-bg-secondary/40",
                                                selectedMountId === mount.id
                                                    ? `border-rarity-${selectedRarity.toLowerCase()} shadow-lg shadow-rarity-${selectedRarity.toLowerCase()}/20`
                                                    : "border-border hover:border-white/20"
                                            )}
                                        >
                                            <div className="w-full h-full rounded-lg overflow-hidden flex items-center justify-center transition-transform group-hover:scale-110" style={getRarityBgStyle(selectedRarity)}>
                                                {mountsConfig && (
                                                    <SpriteSheetIcon
                                                        textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0)}
                                                        spriteWidth={mountsConfig.sprite_size.width}
                                                        spriteHeight={mountsConfig.sprite_size.height}
                                                        sheetWidth={mountsConfig.texture_size.width}
                                                        sheetHeight={mountsConfig.texture_size.height}
                                                        iconIndex={mount.spriteIndex}
                                                        className="w-full h-full p-2"
                                                    />
                                                )}
                                            </div>
                                            <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm py-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-[9px] text-white truncate block text-center font-bold">{mount.name}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {profile.mount.savedBuilds && profile.mount.savedBuilds.length > 0 ? (
                                        profile.mount.savedBuilds
                                            .filter(saved => !searchTerm || (saved.customName || `Mount #${saved.id}`).toLowerCase().includes(searchTerm.toLowerCase()))
                                            .map((savedMount, idx) => {
                                                const spriteInfo = mountsConfig?.mapping ?
                                                    Object.entries(mountsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedMount.id && v.rarity === savedMount.rarity)
                                                    : null;
                                                const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;
                                                const isSelected = selectedMountId === savedMount.id && selectedRarity === savedMount.rarity && JSON.stringify(manualStats) === JSON.stringify(savedMount.secondaryStats);

                                                return (
                                                    <ItemSelectionCard
                                                        key={idx}
                                                        item={savedMount}
                                                        slotKey="mount-saved"
                                                        slotLabel="Saved Mount"
                                                        itemName={savedMount.customName || (spriteInfo?.[1] as any)?.name || `Mount #${savedMount.id}`}
                                                        itemImage={null}
                                                        rarity={savedMount.rarity}
                                                        isSaved={true}
                                                        isSelected={isSelected}
                                                        hideAgeStyles={true}
                                                        perfection={getPerfection(savedMount)}
                                                        getStatPerfection={getStatPerfection}
                                                        onClick={() => {
                                                            setSelectedRarity(savedMount.rarity);
                                                            setSelectedMountId(savedMount.id);
                                                            setMountLevel(savedMount.level);
                                                            setManualStats(savedMount.secondaryStats || []);
                                                            setMobileTab('config');
                                                        }}
                                                        onDelete={(e) => {
                                                            e.stopPropagation();
                                                            const newSaved = [...(profile.mount.savedBuilds || [])];
                                                            newSaved.splice(idx, 1);
                                                            updateNestedProfile('mount', { savedBuilds: newSaved });
                                                        }}
                                                        renderIcon={() => (
                                                            <SpriteSheetIcon
                                                                textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0)}
                                                                spriteWidth={mountsConfig!.sprite_size.width}
                                                                spriteHeight={mountsConfig!.sprite_size.height}
                                                                sheetWidth={mountsConfig!.texture_size.width}
                                                                sheetHeight={mountsConfig!.texture_size.height}
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
                                            <p className="font-bold">No saved mounts</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Config Panel */}
                        <div className={cn(
                            "w-full md:w-80 bg-bg-secondary/20 p-4 border-t md:border-t-0 md:border-l border-border overflow-y-auto custom-scrollbar flex flex-col gap-6",
                            mobileTab !== 'config' && "hidden md:flex"
                        )}>
                            {selectedMountId !== null ? (
                                <>
                                    <div className="text-center">
                                        <div
                                            className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-xl border-2 overflow-hidden relative"
                                            style={{ ...getRarityBgStyle(selectedRarity), borderColor: `var(--rarity-${selectedRarity.toLowerCase()})` }}
                                        >
                                            {mountsConfig && (
                                                <SpriteSheetIcon
                                                    textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0)}
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
                                            {(Object.values(mountsConfig?.mapping || {}) as any[]).find((m: any) => m.id === selectedMountId && m.rarity === selectedRarity)?.name || `Mount #${selectedMountId}`}
                                        </h2>
                                        <div className={cn("text-[10px] font-bold uppercase tracking-widest mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                            {selectedRarity} Mount
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Base Attributes</h4>
                                        <div className="grid grid-cols-1 gap-2">
                                            {mountStats && mountStats.Stats && (
                                                <div className="bg-black/20 rounded-xl p-3 border border-white/5 space-y-2">
                                                    {mountStats.Stats.map((stat: any, idx: number) => (
                                                        <div key={idx} className="flex justify-between items-center text-xs">
                                                            <span className="text-text-muted">{getStatName(stat.StatNode?.UniqueStat?.StatType || '')}</span>
                                                            <span className="text-accent-primary font-mono font-bold">
                                                                {(() => {
                                                                    const val = stat.Value;
                                                                    const type = stat.StatNode?.UniqueStat?.StatType;
                                                                    if (type === 'Damage' || type === 'Health') {
                                                                        if (val >= 1000000) return `+${(val / 1000000).toFixed(2)}M`;
                                                                        if (val >= 1000) return `+${(val / 1000).toFixed(2)}K`;
                                                                        return `+${val.toFixed(0)}`;
                                                                    }
                                                                    return `+${(val * 100).toFixed(2)}%`;
                                                                })()}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <ModalLevelSelector
                                                level={mountLevel}
                                                maxLevel={maxMountLevel}
                                                onChange={setMountLevel}
                                                label="Mount Level"
                                                className="bg-black/20 rounded-xl p-3 border border-white/5"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-3 flex-1">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Secondary Stats</h4>
                                            <div className="bg-bg-input px-2 py-0.5 rounded text-[10px] border border-white/10 font-bold text-accent-primary">
                                                {manualStats.length} / {maxSlots}
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
                                                        onStatIdChange={(newId) => updateStat(idx, 'statId', newId)}
                                                        onValueChange={(newVal) => updateStat(idx, 'value', newVal)}
                                                        onRemove={() => removeStat(idx)}
                                                        range={range}
                                                    />
                                                );
                                            })}
                                            {manualStats.length < maxSlots && (
                                                <button onClick={addStat} className="w-full py-4 border-2 border-dashed border-white/5 hover:border-accent-primary/30 rounded-xl flex items-center justify-center gap-2 text-xs text-text-muted hover:text-accent-primary transition-all group">
                                                    <Plus className="w-4 h-4 group-hover:scale-125 transition-transform" />
                                                    <span className="font-bold">ADD STAT SLOT</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-white/10 mt-auto">
                                        <Button variant="primary" className="w-full py-4 rounded-xl font-bold text-sm gap-2 shadow-lg shadow-accent-primary/20" onClick={handleSave}>
                                            <Save className="w-5 h-5" /> Equip Mount
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-text-muted opacity-30 text-center px-6">
                                    <div className="p-4 bg-white/5 rounded-full mb-4">
                                        <Info className="w-12 h-12" />
                                    </div>
                                    <p className="font-bold uppercase tracking-widest text-xs">Configuration</p>
                                    <p className="text-[10px] mt-2 leading-relaxed">Select a mount from the library to configure stats.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>, document.body
    );
}
