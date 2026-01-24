import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Bike as MountIcon, Save, Info, Plus, Minus, Trash2, Star, Grid, Settings } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { MountSlot } from '../../types/Profile';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { RARITIES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { getStatName } from '../../utils/statNames';
import { useProfile } from '../../context/ProfileContext';

type MobileTab = 'rarity' | 'mounts' | 'config';

const STAT_TYPES = [
    'CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal',
    'DoubleDamageChance', 'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti',
    'AttackSpeed', 'SkillDamageMulti', 'SkillCooldownMulti', 'HealthMulti',
    'MovementSpeed', 'BossDamageMulti'
];

interface MountSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (rarity: string, id: number, level: number, secondaryStats: { statId: string; value: number }[]) => void;
    currentMount?: MountSlot | null;
}

export function MountSelectorModal({ isOpen, onClose, onSelect, currentMount }: MountSelectorModalProps) {
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mountUpgradeLib } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { profile, updateNestedProfile } = useProfile();

    const { data: petUnlockLib } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');

    const [activeTab, setActiveTab] = useState<'library' | 'saved'>('library');
    const [mobileTab, setMobileTab] = useState<MobileTab>('rarity');
    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [selectedMountId, setSelectedMountId] = useState<number | null>(null);
    const [mountLevel, setMountLevel] = useState<number>(1);
    const [manualStats, setManualStats] = useState<{ statId: string; value: number }[]>([]);

    // Reset state when opening or populate from currentMount
    useEffect(() => {
        if (isOpen) {
            if (currentMount) {
                setSelectedRarity(currentMount.rarity);
                setSelectedMountId(currentMount.id);
                setMountLevel(currentMount.level);
                // Convert decimal stats to percentage for editing (0.197 -> 19.7)
                setManualStats(currentMount.secondaryStats?.map(s => ({
                    ...s,
                    value: s.value * 100
                })) || []);
            } else {
                setSelectedRarity('Common');
                setSelectedMountId(null);
                setMountLevel(1);
                setManualStats([]);
            }
        }
        // Default to library tab unless editing
        if (!currentMount) setActiveTab('library');
        setMobileTab('rarity');
    }
        , [isOpen, currentMount]);

    // Calculate max slots based on rarity (using Pet logic as requested)
    const maxSlots = useMemo(() => {
        if (!petUnlockLib || !selectedRarity) return 0;
        return petUnlockLib[selectedRarity]?.NumberOfSecondStats || 0;
    }, [petUnlockLib, selectedRarity]);

    // Trim manual stats if they exceed the new slot limit
    useEffect(() => {
        if (manualStats.length > maxSlots) {
            setManualStats(prev => prev.slice(0, maxSlots));
        }
    }, [maxSlots, manualStats.length]);

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

            // Value is already in percentage here
            if (range && currentValue > (range.max * 100)) {
                currentValue = parseFloat((range.max * 100).toFixed(2));
            }

            newStats[index] = { ...newStats[index], statId: value, value: currentValue };
        } else {
            // Apply max value check for manual entry
            if (field === 'value') {
                const range = getStatRange(newStats[index].statId);
                // Clamp to max
                if (range && value > (range.max * 100)) {
                    value = parseFloat((range.max * 100).toFixed(2));
                }
            }
            newStats[index] = { ...newStats[index], [field]: value };
        }

        setManualStats(newStats);
    };

    const removeStat = (index: number) => {
        setManualStats(manualStats.filter((_, i) => i !== index));
    };

    const mountsConfig = spriteMapping?.mounts;

    const filteredMounts = useMemo(() => {
        if (!mountsConfig?.mapping) return [];
        return Object.entries(mountsConfig.mapping)
            .map(([idx, info]: [string, any]) => ({
                spriteIndex: parseInt(idx),
                ...info
            }))
            .filter((m: any) => m.rarity === selectedRarity);
    }, [mountsConfig, selectedRarity]);

    const handleSave = () => {
        if (selectedMountId !== null) {
            // Convert percentage back to decimal for storage (19.7 -> 0.197)
            const statsToSave = manualStats.map(s => ({
                ...s,
                value: s.value / 100
            }));
            onSelect(selectedRarity, selectedMountId, mountLevel, statsToSave);
            onClose();
        }
    };

    // Helper to get stats for selected mount
    const getMountStats = () => {
        if (!mountUpgradeLib || !selectedRarity) return null;
        const rarityData = mountUpgradeLib[selectedRarity];
        if (!rarityData?.LevelInfo) return null;

        // Find stats for current level
        // Find stats for current level (User Level 1 -> JSON Level 0)
        const targetLevel = Math.max(0, mountLevel - 1);
        const levelInfo = rarityData.LevelInfo.find((l: any) => l.Level === targetLevel);
        return levelInfo?.MountStats;
    };

    const mountStats = getMountStats();

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
                                iconIndex={28}
                                className="w-8 h-8"
                            />
                        </div>
                        <h3 className="text-xl font-bold">Select Mount</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors"><X className="w-6 h-6" /></button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border">
                    <button
                        onClick={() => setActiveTab('library')}
                        className={cn(
                            "flex-1 py-3 text-sm font-bold border-b-2 transition-colors",
                            activeTab === 'library' ? "border-accent-primary text-accent-primary bg-accent-primary/5" : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        Mount Library
                    </button>
                    <button
                        onClick={() => setActiveTab('saved')}
                        className={cn(
                            "flex-1 py-3 text-sm font-bold border-b-2 transition-colors",
                            activeTab === 'saved' ? "border-accent-primary text-accent-primary bg-accent-primary/5" : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        Saved Builds ({profile.mount.savedBuilds?.length || 0})
                    </button>
                </div>

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
                        onClick={() => setMobileTab('mounts')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'mounts'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Grid className="w-4 h-4" />
                        Mounts
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
                                        setSelectedMountId(null);
                                        setManualStats([]);
                                        setMobileTab('mounts');
                                    }}
                                    className={cn(
                                        "w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-all border-2",
                                        selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 border-rarity-${rarity.toLowerCase()} text-white`
                                            : "border-transparent text-text-muted hover:bg-white/5"
                                    )}
                                >
                                    {rarity}
                                </button>
                            ))}
                        </div>
                    )}
                    {mobileTab === 'rarity' && activeTab === 'saved' && (
                        <div className="p-4 text-center text-text-muted">
                            <p className="text-sm">Switch to Mounts tab to view saved builds.</p>
                        </div>
                    )}

                    {/* Mobile Mounts Grid */}
                    {mobileTab === 'mounts' && (
                        <div className="p-3 overflow-y-auto h-full">
                            {activeTab === 'library' ? (
                                <div className="grid grid-cols-3 min-[400px]:grid-cols-4 gap-3">
                                    {filteredMounts.length > 0 ? filteredMounts.map((mount: any) => (
                                        <button
                                            key={mount.id}
                                            onClick={() => {
                                                setSelectedMountId(mount.id);
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "rounded-xl border p-2 flex flex-col items-center gap-2 transition-all",
                                                selectedMountId === mount.id
                                                    ? "bg-accent-primary/20 border-accent-primary"
                                                    : "bg-bg-secondary/40 border-border hover:border-accent-primary/50"
                                            )}
                                        >
                                            {mountsConfig && (
                                                <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={getRarityBgStyle(selectedRarity)}>
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/MountIcons.png"
                                                        spriteWidth={mountsConfig.sprite_size.width}
                                                        spriteHeight={mountsConfig.sprite_size.height}
                                                        sheetWidth={mountsConfig.texture_size.width}
                                                        sheetHeight={mountsConfig.texture_size.height}
                                                        iconIndex={mount.spriteIndex}
                                                        className="w-12 h-12"
                                                    />
                                                </div>
                                            )}
                                            <span className="text-[10px] font-medium text-center truncate w-full">{mount.name}</span>
                                        </button>
                                    )) : (
                                        <div className="col-span-full text-center text-text-muted py-8">No mounts found</div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center text-text-muted py-8">View saved builds</div>
                            )}
                        </div>
                    )}

                    {/* Mobile Config */}
                    {mobileTab === 'config' && (
                        <div className="p-4 overflow-y-auto h-full space-y-4">
                            {selectedMountId !== null ? (
                                <>
                                    <div className="text-center pb-4 border-b border-border">
                                        <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-3" style={getRarityBgStyle(selectedRarity)}>
                                            {mountsConfig && (
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/MountIcons.png"
                                                    spriteWidth={mountsConfig.sprite_size.width}
                                                    spriteHeight={mountsConfig.sprite_size.height}
                                                    sheetWidth={mountsConfig.texture_size.width}
                                                    sheetHeight={mountsConfig.texture_size.height}
                                                    iconIndex={filteredMounts.find((m: any) => m.id === selectedMountId)?.spriteIndex || 0}
                                                    className="w-16 h-16"
                                                />
                                            )}
                                        </div>
                                        <h2 className="text-lg font-bold">{filteredMounts.find((m: any) => m.id === selectedMountId)?.name || `Mount #${selectedMountId}`}</h2>
                                        <p className={cn("text-xs font-bold uppercase", `text-rarity-${selectedRarity.toLowerCase()}`)}>{selectedRarity}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase text-text-muted">Level</label>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setMountLevel(Math.max(1, mountLevel - 1))}><Minus className="w-4 h-4" /></Button>
                                            <Input type="number" value={mountLevel} onChange={(e) => setMountLevel(Math.max(1, parseInt(e.target.value) || 1))} className="text-center font-mono font-bold" />
                                            <Button variant="ghost" size="sm" onClick={() => setMountLevel(mountLevel + 1)}><Plus className="w-4 h-4" /></Button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold uppercase text-text-muted">Passive Stats ({manualStats.length}/{maxSlots})</label>
                                            <Button variant="ghost" size="sm" onClick={addStat} disabled={manualStats.length >= maxSlots}><Plus className="w-3 h-3 mr-1" />Add</Button>
                                        </div>
                                        {manualStats.map((stat, i) => {
                                            const range = getStatRange(stat.statId);
                                            return (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex gap-2 items-center">
                                                        <select
                                                            value={stat.statId}
                                                            onChange={(e) => updateStat(i, 'statId', e.target.value)}
                                                            className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                        >
                                                            {STAT_TYPES.filter(t =>
                                                                t === stat.statId || !manualStats.some(s => s.statId === t)
                                                            ).map(t => (
                                                                <option key={t} value={t}>{getStatName(t)}</option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min={(range?.min || 0) * 100}
                                                            max={(range?.max || 1) * 100}
                                                            value={stat.value}
                                                            onChange={(e) => updateStat(i, 'value', parseFloat(e.target.value) || 0)}
                                                            className="w-16 bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono"
                                                            onFocus={(e) => e.target.select()}
                                                        />
                                                        <button onClick={() => removeStat(i)} className="text-red-400 hover:text-red-300">
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
                                    <div className="text-sm text-center">Select a mount first</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Desktop Content */}
                <div className="flex-1 overflow-hidden hidden md:flex md:flex-row divide-x divide-border">
                    {/* Column 1: Rarity (Left) - Library Only */}
                    {activeTab === 'library' && (
                        <div className="w-48 bg-bg-secondary/10 overflow-y-auto p-2 space-y-1">
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setSelectedRarity(rarity);
                                        setSelectedMountId(null);
                                        setManualStats([]);
                                    }}
                                    className={cn(
                                        "w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-all border",
                                        selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 border-rarity-${rarity.toLowerCase()} text-white shadow-lg`
                                            : "bg-transparent border-transparent text-text-muted hover:bg-white/5 hover:text-text-secondary"
                                    )}
                                >
                                    {rarity}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Column 2: Mount Grid (Middle) */}
                    <div className="flex-1 overflow-y-auto p-4 bg-bg-primary/50 relative">
                        {activeTab === 'library' ? (
                            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                                {filteredMounts.length > 0 ? filteredMounts.map((mount: any) => (
                                    <button
                                        key={mount.id}
                                        onClick={() => setSelectedMountId(mount.id)}
                                        className={cn(
                                            "rounded-xl border p-2 flex flex-col items-center gap-2 transition-all hover:scale-105 group relative overflow-hidden",
                                            selectedMountId === mount.id
                                                ? "bg-accent-primary/20 border-accent-primary shadow-[0_0_15px_rgba(255,166,0,0.3)]"
                                                : "bg-bg-secondary/40 border-border hover:border-accent-primary/50"
                                        )}
                                    >
                                        {mountsConfig && (
                                            <div
                                                className="w-14 h-14 rounded-lg flex items-center justify-center shrink-0"
                                                style={getRarityBgStyle(selectedRarity)}
                                            >
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/MountIcons.png"
                                                    spriteWidth={mountsConfig.sprite_size.width}
                                                    spriteHeight={mountsConfig.sprite_size.height}
                                                    sheetWidth={mountsConfig.texture_size.width}
                                                    sheetHeight={mountsConfig.texture_size.height}
                                                    iconIndex={mount.spriteIndex}
                                                    className="w-14 h-14"
                                                />
                                            </div>
                                        )}
                                        <span className="text-[10px] font-medium text-center truncate w-full">{mount.name}</span>
                                    </button>
                                )) : (
                                    <div className="col-span-full flex flex-col items-center justify-center py-12 text-text-muted opacity-50">
                                        <MountIcon className="w-16 h-16 mb-4" />
                                        <span>No mounts found using this filter</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            // SAVE TAB
                            <div className="w-full">
                                {profile.mount.savedBuilds && profile.mount.savedBuilds.length > 0 ? (
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                        {profile.mount.savedBuilds.map((savedMount, idx) => {
                                            // Find sprite info
                                            const spriteInfo = mountsConfig?.mapping ?
                                                Object.entries(mountsConfig.mapping).find(([_, v]: [any, any]) => v.id === savedMount.id && v.rarity === savedMount.rarity)
                                                : null;

                                            // Note: Mount IDs might override rarity in filtering, but usually ID is unique.
                                            const spriteIndex = spriteInfo ? parseInt(spriteInfo[0]) : 0;
                                            const mountName = (spriteInfo?.[1] as any)?.name || `Mount #${savedMount.id}`;

                                            return (
                                                <div
                                                    key={idx}
                                                    className="relative rounded-xl border border-border bg-bg-secondary p-3 hover:border-accent-primary transition-colors cursor-pointer group"
                                                    onClick={() => {
                                                        setSelectedRarity(savedMount.rarity);
                                                        setSelectedMountId(savedMount.id);
                                                        setMountLevel(savedMount.level);
                                                        // Convert decimal to percentage
                                                        setManualStats(savedMount.secondaryStats?.map(s => ({
                                                            ...s,
                                                            value: s.value * 100
                                                        })) || []);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border"
                                                            style={getRarityBgStyle(savedMount.rarity)}
                                                        >
                                                            {mountsConfig && (
                                                                <SpriteSheetIcon
                                                                    textureSrc="./icons/game/MountIcons.png"
                                                                    spriteWidth={mountsConfig.sprite_size.width}
                                                                    spriteHeight={mountsConfig.sprite_size.height}
                                                                    sheetWidth={mountsConfig.texture_size.width}
                                                                    sheetHeight={mountsConfig.texture_size.height}
                                                                    iconIndex={spriteIndex}
                                                                    className="w-12 h-12"
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-bold text-sm truncate">{savedMount.customName || mountName}</div>
                                                            <div className="text-xs text-text-muted">Lv {savedMount.level} • {savedMount.rarity}</div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const newSaved = [...(profile.mount.savedBuilds || [])];
                                                                newSaved.splice(idx, 1);
                                                                updateNestedProfile('mount', { savedBuilds: newSaved });
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
                                        <p>No saved mount builds found.</p>
                                        <p className="text-xs opacity-70 mt-2">Configure a mount in the main panel and save it to see it here.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Column 3: Config (Right) - Desktop */}
                    <div className="w-80 bg-bg-secondary/5 p-4 overflow-y-auto flex flex-col gap-6">
                        {selectedMountId !== null ? (
                            <>
                                <div className="text-center pb-4 border-b border-border">
                                    <div
                                        className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-3 shadow-inner border border-white/10 overflow-hidden"
                                        style={getRarityBgStyle(selectedRarity)}
                                    >
                                        {(() => {
                                            const displayMount = filteredMounts.find((m: any) => m.id === selectedMountId);
                                            if (displayMount && mountsConfig) {
                                                return (
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/MountIcons.png"
                                                        spriteWidth={mountsConfig.sprite_size.width}
                                                        spriteHeight={mountsConfig.sprite_size.height}
                                                        sheetWidth={mountsConfig.texture_size.width}
                                                        sheetHeight={mountsConfig.texture_size.height}
                                                        iconIndex={displayMount.spriteIndex}
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
                                                    iconIndex={28}
                                                    className="w-10 h-10"
                                                />
                                            );
                                        })()}
                                    </div>
                                    <h2 className="text-xl font-bold text-text-primary">
                                        {filteredMounts.find((m: any) => m.id === selectedMountId)?.name || `Mount #${selectedMountId}`}
                                    </h2>
                                    <p className={cn("text-xs font-bold uppercase mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                        {selectedRarity}
                                    </p>

                                    {/* Stats Display */}
                                    {mountStats && mountStats.Stats && (
                                        <div className="mt-3 w-full p-3 bg-bg-input/50 rounded-lg border border-border/50 text-xs space-y-2">
                                            {mountStats.Stats.map((stat: any, idx: number) => (
                                                <div key={idx} className="flex justify-between items-center">
                                                    <span className="text-text-muted">
                                                        {getStatName(stat.StatNode?.UniqueStat?.StatType || '')}
                                                    </span>
                                                    <span className="font-mono text-accent-primary font-bold">
                                                        {stat.StatNode?.UniqueStat?.StatNature === 'Multiplier'
                                                            ? `+${(stat.Value * 100).toFixed(2)}%`
                                                            : stat.Value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Level Input */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase text-text-muted flex items-center gap-2">
                                        Level
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Button variant="ghost" size="sm" onClick={() => setMountLevel(Math.max(1, mountLevel - 1))}>
                                            <Minus className="w-4 h-4" />
                                        </Button>
                                        <Input
                                            type="number"
                                            value={mountLevel}
                                            onChange={(e) => setMountLevel(Math.max(1, parseInt(e.target.value) || 1))}
                                            className="text-center font-mono font-bold"
                                        />
                                        <Button variant="ghost" size="sm" onClick={() => setMountLevel(mountLevel + 1)}>
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Manual Passives */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold uppercase text-text-muted">
                                            Passive Stats ({manualStats.length}/{maxSlots})
                                        </label>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={addStat}
                                            disabled={manualStats.length >= maxSlots}
                                            className={manualStats.length >= maxSlots ? "opacity-50 cursor-not-allowed" : ""}
                                        >
                                            <Plus className="w-3 h-3 mr-1" /> Add
                                        </Button>
                                    </div>

                                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                        {manualStats.map((stat, i) => {
                                            const range = getStatRange(stat.statId);
                                            return (
                                                <div key={i} className="flex flex-col gap-1">
                                                    <div className="flex gap-2 items-center">
                                                        <select
                                                            value={stat.statId}
                                                            onChange={(e) => updateStat(i, 'statId', e.target.value)}
                                                            className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                        >
                                                            {STAT_TYPES.filter(t =>
                                                                t === stat.statId || !manualStats.some(s => s.statId === t)
                                                            ).map(t => (
                                                                <option key={t} value={t}>{getStatName(t)}</option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min={(range?.min || 0) * 100}
                                                            max={(range?.max || 1) * 100}
                                                            value={stat.value}
                                                            onChange={(e) => updateStat(i, 'value', parseFloat(e.target.value) || 0)}
                                                            className="w-16 bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono"
                                                            onFocus={(e) => e.target.select()}
                                                        />
                                                        <button onClick={() => removeStat(i)} className="text-red-400 hover:text-red-300">
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

                                <div className="pt-4 mt-auto">
                                    <Button variant="primary" className="w-full gap-2" onClick={handleSave}>
                                        <Save className="w-4 h-4" /> Confirm Selection
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50 space-y-4">
                                <Info className="w-12 h-12" />
                                <div className="text-sm text-center px-4">Select a mount from the grid</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
