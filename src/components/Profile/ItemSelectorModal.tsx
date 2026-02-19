import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SecondaryStatInput } from '../UI/SecondaryStatInput';
import { X, Sword, Heart, Shield, Plus, Trash2, Clock, Target, Unlock, Calendar, Grid, Settings, Bookmark } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { useProfile } from '../../context/ProfileContext';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { ItemSlot } from '../../types/Profile';
import { Input } from '../UI/Input';
import { Button } from '../UI/Button';
import { cn, getAgeBgStyle, getAgeIconStyle } from '../../lib/utils';
import { AGES } from '../../utils/constants';
import { getItemImage, getItemName } from '../../utils/itemAssets';
import { getStatName } from '../../utils/statNames';

interface ItemSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: ItemSlot | null) => void;
    slot: string;
    current: ItemSlot | null;
    isPvp?: boolean;
}

const SLOT_MAPPING: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Helmet',
    'Body': 'Armour',
    'Gloves': 'Gloves',
    'Belt': 'Belt',
    'Necklace': 'Necklace',
    'Ring': 'Ring',
    'Shoe': 'Shoes'
};

const STAT_TYPES = [
    'CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal',
    'DoubleDamageChance', 'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti',
    'AttackSpeed', 'SkillDamageMulti', 'SkillCooldownMulti', 'HealthMulti'
];

const IMAGE_SLOT_MAP: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Headgear',
    'Body': 'Armor',
    'Gloves': 'Glove',
    'Belt': 'Belt',
    'Necklace': 'Neck',
    'Ring': 'Ring',
    'Shoe': 'Foot'
};

// Age-specific colors for selected state
const AGE_COLORS: Record<number, { bg: string; text: string; border: string }> = {
    0: { bg: 'bg-amber-800', text: 'text-amber-100', border: 'border-amber-600' },      // Primitive - Brown
    1: { bg: 'bg-slate-600', text: 'text-slate-100', border: 'border-slate-400' },      // Medieval - Silver
    2: { bg: 'bg-orange-700', text: 'text-orange-100', border: 'border-orange-500' },   // Early-Modern - Bronze
    3: { bg: 'bg-blue-600', text: 'text-blue-100', border: 'border-blue-400' },         // Modern - Blue
    4: { bg: 'bg-purple-600', text: 'text-purple-100', border: 'border-purple-400' },   // Space - Purple
    5: { bg: 'bg-cyan-600', text: 'text-cyan-100', border: 'border-cyan-400' },         // Interstellar - Cyan
    6: { bg: 'bg-pink-600', text: 'text-pink-100', border: 'border-pink-400' },         // Multiverse - Pink
    7: { bg: 'bg-emerald-600', text: 'text-emerald-100', border: 'border-emerald-400' },// Quantum - Emerald
    8: { bg: 'bg-red-700', text: 'text-red-100', border: 'border-red-500' },            // Underworld - Red
    9: { bg: 'bg-yellow-500', text: 'text-yellow-900', border: 'border-yellow-300' },   // Divine - Gold
};

const ITEM_TYPE_MAP: Record<string, number> = {
    'Helmet': 0, 'Headgear': 0, 'Head': 0,
    'Armour': 1, 'Armor': 1, 'Body': 1,
    'Gloves': 2, 'Glove': 2, 'Hand': 2,
    'Necklace': 3, 'Neck': 3,
    'Ring': 4,
    'Weapon': 5,
    'Shoes': 6, 'Foot': 6, 'Boots': 6,
    'Belt': 7
};

const SLOT_TO_JSON_TYPE: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Helmet',
    'Body': 'Armour',
    'Gloves': 'Gloves',
    'Belt': 'Belt',
    'Necklace': 'Necklace',
    'Ring': 'Ring',
    'Shoe': 'Shoes'
};


type MobileTab = 'age' | 'items' | 'config';

export function ItemSelectorModal({ isOpen, onClose, onSelect, slot, current, isPvp = false }: ItemSelectorModalProps) {
    const { profile, updateNestedProfile } = useProfile();
    const stats = useGlobalStats();
    const { data: itemLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: secondaryData } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: ageDropChances } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json'); // New

    const jsonType = SLOT_MAPPING[slot] || slot;
    const [unlockAll, setUnlockAll] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab | 'skin'>('age'); // Added 'skin' to tab type implicitly by usage, but let's update type if strict.

    // Skin State
    const [skinIdx, setSkinIdx] = useState<number | null>(null);

    // Get unlocked ages based on drop chances (age is unlocked if drop chance > 0 OR unlockAll is true)
    const unlockedAges = useMemo(() => {
        if (unlockAll) return AGES.map((_, i) => i);
        if (!ageDropChances) return AGES.map((_, i) => i);
        const forgeLevel = Math.max(1, profile.misc.forgeLevel || 1);
        // JSON uses 0-based index where Key "0" = Level 1 stats
        const dropData = ageDropChances[String(forgeLevel - 1)];
        if (!dropData) return [0];

        const unlocked: number[] = [];
        for (let i = 0; i < 10; i++) {
            const chance = dropData[`Age${i}`] || 0;
            if (chance > 0) {
                unlocked.push(i);
            }
        }
        return unlocked.length > 0 ? unlocked : [0];
    }, [ageDropChances, profile.misc.forgeLevel, unlockAll]);

    // Initialize state
    // If opening with an existing item, use its age. Otherwise use the HIGHEST unlocked age.
    const initialAgeIdx = useMemo(() => {
        if (current) return current.age;
        if (unlockedAges.length > 0) return Math.max(...unlockedAges);
        return 0;
    }, [current, unlockedAges]);

    const [ageIdx, setAgeIdx] = useState(initialAgeIdx);
    const [selectedItemIdx, setSelectedItemIdx] = useState<number>(current?.idx || 0);
    // For saved items, we need to track if we are editing a saved instance
    const [selectedSavedItemIndex, setSelectedSavedItemIndex] = useState<number | null>(null);

    const [level, setLevel] = useState(current?.level || 1);
    const [manualStats, setManualStats] = useState<{ type: string; value: number }[]>(
        current?.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []
    );

    // Sync state when modal opens or current item changes
    useEffect(() => {
        if (isOpen) {
            // Recalculate best default age only if no current item
            let targetAge = 0;
            if (current) {
                targetAge = current.age;
            } else {
                // If no item, default to highest unlocked
                if (unlockedAges.length > 0) targetAge = Math.max(...unlockedAges);
            }

            setAgeIdx(targetAge);
            setSelectedItemIdx(current ? current.idx : 0);
            setSelectedSavedItemIndex(null);
            setLevel(current ? current.level : 1);
            setManualStats(current?.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []);
            // Initialize Skin State
            if (current?.skin) {
                setSkinIdx(current.skin.idx);
                // Convert record to array for UI
                setSkinStatsList(Object.entries(current.skin.stats).map(([key, val]) => ({ type: key, value: val })));
            } else {
                setSkinIdx(null);
                setSkinStatsList([]);
            }
            setMobileTab('age');
        }
    }, [isOpen, current, unlockedAges]);

    // Get drop chance for display
    const getDropChance = (ageIndex: number): number => {
        if (!ageDropChances) return 0;
        const forgeLevel = Math.max(1, profile.misc.forgeLevel || 1);
        // JSON uses 0-based index where Key "0" = Level 1 stats
        const dropData = ageDropChances[String(forgeLevel - 1)];
        return dropData?.[`Age${ageIndex}`] || 0;
    };

    const availableItems = useMemo(() => {
        if (!itemLibrary) return [];
        const items = Object.values(itemLibrary).filter((item: any) => {
            const iId = item.ItemId;
            if (!iId) return false;

            // Filter by Age and Slot
            if (iId.Age !== ageIdx || iId.Type !== jsonType) return false;

            // Strict Filter: Must exist in AutoItemMapping with a valid Entry
            const typeId = ITEM_TYPE_MAP[slot] ?? ITEM_TYPE_MAP[IMAGE_SLOT_MAP[slot] || slot];

            // Should not happen if mapping is correct, but safety check
            if (!autoMapping || typeId === undefined) return false;

            const key = `${ageIdx}_${typeId}_${iId.Idx}`;
            const mapping = autoMapping[key];

            // Must exist and have a name to be valid
            return !!mapping && !!mapping.ItemName;
        });
        return items.sort((a: any, b: any) => (a.ItemId?.Idx || 0) - (b.ItemId?.Idx || 0));
    }, [itemLibrary, ageIdx, jsonType, slot, autoMapping]);

    const savedPresets = useMemo(() => {
        return profile.savedItems?.[slot] || [];
    }, [profile.savedItems, slot]);

    const activeList = useMemo(() => {
        if (ageIdx === -1) return savedPresets;
        return availableItems;
    }, [ageIdx, savedPresets, availableItems]);

    const selectedItemData = useMemo(() => {
        if (ageIdx === -1 && selectedSavedItemIndex !== null) return savedPresets[selectedSavedItemIndex];
        return availableItems.find((item: any) => item.ItemId?.Idx === selectedItemIdx) || availableItems[0];
    }, [availableItems, selectedItemIdx, ageIdx, selectedSavedItemIndex, savedPresets]);

    // Get weapon info from WeaponLibrary + Projectile info
    const weaponInfo = useMemo(() => {
        if (slot !== 'Weapon' || !weaponLibrary || !selectedItemData) return null;
        const key = `{'Age': ${ageIdx}, 'Type': 'Weapon', 'Idx': ${selectedItemIdx}}`;
        const weaponData = weaponLibrary[key];
        if (!weaponData) return null;

        const projId = weaponData.ProjectileId;
        const hasProjectile = typeof projId === 'number' && projId > 0;
        const attackRange = weaponData.AttackRange || 1;

        const info = {
            // Ranged = AttackRange >= 1, Melee = AttackRange < 1
            isRanged: attackRange >= 1,
            // For saved items, use the saved item's data if available, or fallback to library
            // Logic handled by using selectedItemData in base stats, but weapon info comes from library
            attackRange,
            windupTime: weaponData.WindupTime || 0.5,
            attackDuration: weaponData.AttackDuration || 1,
            projectileSpeed: 0,
            projectileRadius: 0,
            hasProjectile: false
        };

        // Get projectile data if exists
        if (hasProjectile && projectilesLibrary) {
            const projData = projectilesLibrary[String(projId)];
            if (projData) {
                info.hasProjectile = true;
                info.projectileSpeed = projData.Speed || 0;
                info.projectileRadius = projData.CollisionRadius || 0;
            }
        }

        return info;
    }, [slot, weaponLibrary, projectilesLibrary, ageIdx, selectedItemIdx, selectedItemData]);

    const baseStats = useMemo(() => {
        if (!selectedItemData) return { damage: 0, health: 0 };
        const s = (selectedItemData as any).EquipmentStats || [];
        // If it's a saved item (ItemSlot), it doesn't have EquipmentStats directly.
        // We need to fetch base stats from library using its age/idx.
        if (ageIdx === -1) {
            const saved = selectedItemData as ItemSlot;
            if (!itemLibrary) return { damage: 0, health: 0 };
            const key = `{'Age': ${saved.age}, 'Type': '${jsonType}', 'Idx': ${saved.idx}}`;
            const libItem = itemLibrary[key];
            const stats = libItem?.EquipmentStats || [];
            const d = stats.find((x: any) => x.StatNode?.UniqueStat?.StatType === 'Damage')?.Value || 0;
            const h = stats.find((x: any) => x.StatNode?.UniqueStat?.StatType === 'Health')?.Value || 0;
            return { damage: d, health: h };
        }

        const damage = s.find((x: any) => x.StatNode?.UniqueStat?.StatType === 'Damage')?.Value || 0;
        const health = s.find((x: any) => x.StatNode?.UniqueStat?.StatType === 'Health')?.Value || 0;
        return { damage, health };
    }, [selectedItemData, ageIdx, itemLibrary, jsonType]);

    const numSecondarySlots = useMemo(() => {
        if (!secondaryData) return 0;
        let targetAge = ageIdx;
        if (ageIdx === -1) {
            if (selectedItemData && (selectedItemData as any).age !== undefined) {
                targetAge = (selectedItemData as any).age;
            } else {
                return 0;
            }
        }
        return secondaryData[String(targetAge)]?.NumberOfSecondStats || 0;
    }, [secondaryData, ageIdx, selectedItemData]);

    // Trim manual stats if they exceed the new slot limit
    useEffect(() => {
        if (manualStats.length > numSecondarySlots) {
            setManualStats(prev => prev.slice(0, numSecondarySlots));
        }
    }, [numSecondarySlots, manualStats.length]);

    const maxLevelCap = useMemo(() => {
        return stats?.maxItemLevels?.[slot] || 99;
    }, [stats, slot]);

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

    // availableSkins
    const availableSkins = useMemo(() => {
        if (!skinsLibrary) return [];
        return Object.values(skinsLibrary).filter((s: any) =>
            s.SkinId?.Type === jsonType
        ).sort((a: any, b: any) => a.SkinId.Idx - b.SkinId.Idx); // Sort by ID local for list order
    }, [skinsLibrary, jsonType]);

    // Helper for visual order (same as Skins.tsx)
    const getVisualOrder = (idx: number) => {
        if (idx === 0) return 0;
        if (idx === 2) return 1;
        if (idx === 1) return 2;
        return 10 + idx;
    };

    // Memoize sorted global skins to determine sprite index
    const sortedGlobalSkins = useMemo(() => {
        if (!skinsLibrary) return [];
        return Object.values(skinsLibrary).sort((a: any, b: any) => {
            const orderA = getVisualOrder(a.SkinId.Idx);
            const orderB = getVisualOrder(b.SkinId.Idx);
            if (orderA !== orderB) return orderA - orderB;

            const isHelmetA = a.SkinId.Type === 'Helmet';
            const isHelmetB = b.SkinId.Type === 'Helmet';
            if (isHelmetA && !isHelmetB) return -1;
            if (!isHelmetA && isHelmetB) return 1;

            return 0;
        });
    }, [skinsLibrary]);

    const handleDeleteSavedItem = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();

        const currentSaved = profile.savedItems?.[slot] || [];
        const newSaved = currentSaved.filter((_, i) => i !== index);
        updateNestedProfile('savedItems', { [slot]: newSaved });

        // If the deleted item was selected, deselect it
        if (ageIdx === -1 && selectedSavedItemIndex === index) {
            setSelectedSavedItemIndex(null);
            if (newSaved.length > 0) {
                // Select the first one or previous one? Let's just deselect for safety
            } else {
                // No items left
            }
        } else if (ageIdx === -1 && selectedSavedItemIndex !== null && selectedSavedItemIndex > index) {
            // Shift selection index if we deleted a preceding item
            setSelectedSavedItemIndex(selectedSavedItemIndex - 1);
        }
    };

    const handleSave = () => {
        if (selectedItemData) {
            // Convert skinStatsList array back to Record for storage
            const skinStatsRecord: Record<string, number> = {};
            skinStatsList.forEach(s => {
                skinStatsRecord[s.type] = s.value;
            });

            const newItem: ItemSlot = {
                age: ageIdx === -1 ? (selectedItemData as ItemSlot).age : ageIdx,
                idx: ageIdx === -1 ? (selectedItemData as ItemSlot).idx : (selectedItemData as any).ItemId?.Idx || 0,
                level: level,
                rarity: 'Common',
                secondaryStats: manualStats.map(s => ({
                    statId: s.type,
                    value: s.value
                })),
                skin: skinIdx !== null ? {
                    idx: skinIdx,
                    // Look up Type from library if possible to ensure we have the correct casing (e.g. Armour vs Body)
                    type: skinsLibrary ? (() => {
                        const skinEntry = Object.values(skinsLibrary).find((s: any) =>
                            s.SkinId.Idx === skinIdx &&
                            (s.SkinId.Type === (SLOT_TO_JSON_TYPE[slot] || slot) ||
                                s.SkinId.Type === 'Helmet' && slot === 'Helmet')
                        );
                        return skinEntry ? (skinEntry as any).SkinId.Type : undefined;
                    })() : undefined,
                    stats: skinStatsRecord
                } : undefined
            };
            onSelect(newItem);
            onClose();
        }
    };

    const addStat = () => {
        if (manualStats.length < numSecondarySlots) {
            const existingTypes = new Set(manualStats.map(s => s.type));
            const nextType = STAT_TYPES.find(t => !existingTypes.has(t)) || STAT_TYPES[0];
            const range = getStatRange(nextType);

            setManualStats([...manualStats, {
                type: nextType,
                value: range ? parseFloat((range.min * 100).toFixed(2)) : 0
            }]);
        }
    };

    const updateStat = (index: number, field: 'type' | 'value', value: any) => {
        const newStats = [...manualStats];

        if (field === 'type') {
            const range = getStatRange(value);
            let currentValue = newStats[index].value;
            if (range && currentValue > (range.max * 100)) {
                currentValue = parseFloat((range.max * 100).toFixed(2));
            }
            newStats[index] = { ...newStats[index], type: value, value: currentValue };
        } else {
            // value comes from SecondaryStatInput as a number
            newStats[index] = { ...newStats[index], [field]: value };
        }

        setManualStats(newStats);
    };

    const removeStat = (index: number) => {
        setManualStats(manualStats.filter((_, i) => i !== index));
    };

    // Skin Stats Management
    const [skinStatsList, setSkinStatsList] = useState<{ type: string; value: number }[]>([]);

    const addSkinStat = (possibleStats: any[]) => {
        if (skinStatsList.length < (possibleStats.length || 0)) {
            const existingTypes = new Set(skinStatsList.map(s => s.type));
            // Find first available type
            const nextStat = possibleStats.find(s => !existingTypes.has(s.StatNode.UniqueStat.StatType));

            if (nextStat) {
                const type = nextStat.StatNode.UniqueStat.StatType;
                setSkinStatsList([...skinStatsList, {
                    type,
                    value: nextStat.MinValue // Default to min value
                }]);
            }
        }
    };

    const updateSkinStat = (index: number, field: 'type' | 'value', value: any, possibleStats: any[]) => {
        const newStats = [...skinStatsList];

        if (field === 'type') {
            // Find limits for new type and clamp value
            const statDef = possibleStats.find(s => s.StatNode.UniqueStat.StatType === value);
            let val = newStats[index].value;
            if (statDef) {
                val = Math.max(statDef.MinValue, Math.min(statDef.MaxValue, val));
            }
            newStats[index] = { ...newStats[index], type: value, value: val };
        } else {
            newStats[index] = { ...newStats[index], [field]: value };
        }
        setSkinStatsList(newStats);
    };

    const removeSkinStat = (index: number) => {
        setSkinStatsList(skinStatsList.filter((_, i) => i !== index));
    };


    const renderSkinSelection = () => {
        if (availableSkins.length === 0) return null;

        return (
            <div className="pt-4 border-t border-border mt-4">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-sm text-text-muted uppercase tracking-wider">Skin</h4>
                    {skinIdx !== null && (
                        <Button variant="ghost" size="sm" onClick={() => { setSkinIdx(null); setSkinStatsList([]); }} className="h-6 text-xs text-red-400">
                            <Trash2 className="w-3 h-3 mr-1" /> Remove
                        </Button>
                    )}
                </div>

                {/* Skin List */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                    {availableSkins.map((skin: any) => {
                        const isSelected = skinIdx === skin.SkinId.Idx;

                        // Find global index for sprite position
                        const globalIndex = sortedGlobalSkins.findIndex((s: any) =>
                            s.SkinId.Type === skin.SkinId.Type && s.SkinId.Idx === skin.SkinId.Idx
                        );

                        let bgX = 0, bgY = 0;
                        if (globalIndex !== -1) {
                            const SPRITE_COLS = 4;
                            const SPRITE_ROWS = 4;
                            const col = globalIndex % SPRITE_COLS;
                            const row = Math.floor(globalIndex / SPRITE_COLS);
                            bgX = (col * 100) / (SPRITE_COLS - 1);
                            bgX = Number.isNaN(bgX) ? 0 : bgX;
                            bgY = (row * 100) / (SPRITE_ROWS - 1);
                            bgY = Number.isNaN(bgY) ? 0 : bgY;
                        }

                        return (
                            <button
                                key={skin.SkinId.Idx}
                                onClick={() => {
                                    setSkinIdx(skin.SkinId.Idx);
                                    // Reset stats if not already set, or load defaults? 
                                    // If switching skins, probably want to reset to defaults of new skin.
                                    // Default to 1 stat if available? Or none?
                                    // Let's add the first available stat by default for better UX
                                    if (skin.PossibleStats && skin.PossibleStats.length > 0) {
                                        const firstStat = skin.PossibleStats[0];
                                        setSkinStatsList([{
                                            type: firstStat.StatNode.UniqueStat.StatType,
                                            value: firstStat.MinValue
                                        }]);
                                    } else {
                                        setSkinStatsList([]);
                                    }
                                }}
                                className={cn(
                                    "aspect-square rounded-lg border-2 flex items-center justify-center relative overflow-hidden bg-bg-secondary",
                                    isSelected ? "border-accent-primary" : "border-border hover:border-accent-primary/50"
                                )}
                                title={`Skin ${skin.SkinId.Idx}`}
                            >
                                <div
                                    className="w-full h-full"
                                    style={{
                                        backgroundImage: 'url(./Texture2D/SkinsUiIcons.png)',
                                        backgroundSize: '400% 400%',
                                        backgroundPosition: `${bgX}% ${bgY}%`,
                                        imageRendering: 'pixelated'
                                    }}
                                />
                            </button>
                        );
                    })}
                </div>

                {/* Skin Stats Inputs */}
                {skinIdx !== null && (
                    <div className="space-y-2 bg-bg-input/30 p-2 rounded">
                        {(() => {
                            const selectedSkin = availableSkins.find((s: any) => s.SkinId.Idx === skinIdx) as any;
                            const possibleStats = selectedSkin?.PossibleStats || [];
                            const maxStats = selectedSkin?.MaxStatCount || 0;

                            return (
                                <>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-text-muted">
                                            SKIN STATS ({skinStatsList.length}/{maxStats})
                                        </span>
                                        {skinStatsList.length < maxStats && (
                                            <Button variant="ghost" size="sm" onClick={() => addSkinStat(possibleStats)} className="h-6 text-xs">
                                                <Plus className="w-3 h-3 mr-1" /> Add
                                            </Button>
                                        )}
                                    </div>

                                    {skinStatsList.map((stat, i) => {
                                        // Get constraints for this stat type
                                        const statDef = possibleStats.find((s: any) => s.StatNode?.UniqueStat?.StatType === stat.type);
                                        const min = statDef?.MinValue || 0;
                                        const max = statDef?.MaxValue || 1;

                                        return (
                                            <div key={i} className="flex flex-col gap-1 bg-bg-secondary/50 p-1.5 rounded border border-border/50">
                                                <div className="flex gap-2 items-center">
                                                    <select
                                                        value={stat.type}
                                                        onChange={(e) => updateSkinStat(i, 'type', e.target.value, possibleStats)}
                                                        className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                    >
                                                        {possibleStats
                                                            // Filter options: show current value OR options not already selected
                                                            .filter((s: any) => s.StatNode.UniqueStat.StatType === stat.type || !skinStatsList.some(existing => existing.type === s.StatNode.UniqueStat.StatType))
                                                            .map((s: any) => (
                                                                <option key={s.StatNode.UniqueStat.StatType} value={s.StatNode.UniqueStat.StatType}>
                                                                    {s.StatNode.UniqueStat.StatType}
                                                                </option>
                                                            ))}
                                                    </select>
                                                    <Button variant="ghost" size="sm" onClick={() => removeSkinStat(i)} className="h-6 w-6 text-text-muted hover:text-red-400 p-0">
                                                        <X className="w-3 h-3" />
                                                    </Button>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <DecimalInput
                                                        value={parseFloat((stat.value * 100).toFixed(2))}
                                                        onChange={(val) => updateSkinStat(i, 'value', val / 100, possibleStats)}
                                                        min={min * 100}
                                                        max={max * 100}
                                                        className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                    />
                                                    <span className="text-[10px] text-text-muted w-6 text-right shrink-0">
                                                        %
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-[10px] text-text-muted px-1">
                                                    <span>Min: {(min * 100).toFixed(0)}%</span>
                                                    <span>Max: {(max * 100).toFixed(0)}%</span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {skinStatsList.length === 0 && (
                                        <div className="text-center text-xs text-text-muted py-2 italic opacity-50">
                                            No skin stats active. Click "Add" to configure.
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        );
    };

    const renderConfig = () => (
        <div className="p-4 overflow-y-auto custom-scrollbar h-full space-y-4">
            <h4 className="font-bold text-sm text-text-muted uppercase tracking-wider">Item Details</h4>

            {/* Base Stats */}
            <div className="space-y-2">
                <div className="text-xs font-bold text-text-muted">BASE STATS</div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 p-2 bg-bg-input/50 rounded">
                        <Sword className="w-4 h-4 text-red-400" />
                        <span className="font-mono text-sm">{baseStats.damage.toFixed(0)}</span>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-bg-input/50 rounded">
                        <Heart className="w-4 h-4 text-green-400" />
                        <span className="font-mono text-sm">{baseStats.health.toFixed(0)}</span>
                    </div>
                </div>
            </div>

            {/* Weapon Info */}
            {slot === 'Weapon' && weaponInfo && (
                <div className="space-y-2 p-3 bg-bg-input/30 rounded-lg border border-border">
                    <div className="text-xs font-bold text-text-muted">WEAPON INFO</div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm">Type</span>
                        <span className={cn(
                            "font-bold px-2 py-0.5 rounded text-xs",
                            weaponInfo.isRanged ? "bg-sky-500/20 text-sky-400" : "bg-amber-500/20 text-amber-400"
                        )}>
                            {weaponInfo.isRanged ? '🏹 RANGED' : '⚔️ MELEE'}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1">
                            <Target className="w-3 h-3 text-text-muted" />
                            <span className="text-text-muted">Range:</span>
                            <span className="font-mono">{weaponInfo.attackRange.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-text-muted" />
                            <span className="text-text-muted">Windup:</span>
                            <span className="font-mono">{weaponInfo.windupTime.toFixed(2)}s</span>
                        </div>
                        {weaponInfo.hasProjectile && (
                            <>
                                <div className="flex items-center gap-1">
                                    <Target className="w-3 h-3 text-text-muted" />
                                    <span className="text-text-muted">Proj Speed:</span>
                                    <span className="font-mono">{weaponInfo.projectileSpeed.toFixed(0)}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Target className="w-3 h-3 text-text-muted" />
                                    <span className="text-text-muted">Proj Radius:</span>
                                    <span className="font-mono">{weaponInfo.projectileRadius.toFixed(2)}</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Level - Hidden in PVP */}
            {!isPvp && (
                <div>
                    <label className="text-xs font-bold text-text-muted block mb-2">ITEM LEVEL (MAX {maxLevelCap})</label>
                    <Input
                        type="number"
                        min={1}
                        max={maxLevelCap}
                        value={level}
                        onChange={(e) => setLevel(Math.max(1, Math.min(maxLevelCap, parseInt(e.target.value) || 1)))}
                        className="w-full"
                    />
                </div>
            )}

            {/* Secondary Stats - Hidden in PVP */}
            {!isPvp && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-text-muted">
                            PASSIVE STATS ({manualStats.length}/{numSecondarySlots})
                        </span>
                        {manualStats.length < numSecondarySlots && (
                            <Button variant="ghost" size="sm" onClick={addStat}>
                                <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                        )}
                    </div>

                    <div className="space-y-2">
                        {manualStats.map((stat, i) => {
                            const range = getStatRange(stat.type);
                            return (
                                <div key={i} className="flex flex-col gap-1">
                                    <div className="flex gap-2 items-center">
                                        <select
                                            value={stat.type}
                                            onChange={(e) => updateStat(i, 'type', e.target.value)}
                                            className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                        >
                                            {STAT_TYPES.filter(t =>
                                                // Allow if it's the current value of this row OR if it's not selected in any other row
                                                t === stat.type || !manualStats.some(s => s.type === t)
                                            ).map(t => (
                                                <option key={t} value={t}>{getStatName(t)}</option>
                                            ))}
                                        </select>
                                        <SecondaryStatInput
                                            value={stat.value as number}
                                            onChange={(val) => updateStat(i, 'value', val)}
                                            min={(range?.min || 0) * 100}
                                            max={(range?.max || 1) * 100}
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
            )}

            {/* Skins Selection */}
            {renderSkinSelection()}

            {/* Actions */}
            <div className="flex gap-2 pt-4">
                <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
                <Button variant="primary" onClick={handleSave} className="flex-1">Equip</Button>
            </div>
        </div>
    );

    const renderAgeSelection = () => (
        <div className="p-3 space-y-2 overflow-y-auto custom-scrollbar h-full">
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-text-muted uppercase">Select Age</span>
                <button
                    onClick={() => setUnlockAll(!unlockAll)}
                    className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                        unlockAll
                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                            : "bg-bg-input text-text-muted border border-border hover:bg-bg-input/80"
                    )}
                >
                    <Unlock className="w-3 h-3" />
                    {unlockAll ? 'All' : 'Unlock All'}
                </button>
            </div>

            {/* Saved Presets Button */}
            <button
                onClick={() => {
                    setAgeIdx(-1);
                    setSelectedItemIdx(0);
                    setMobileTab('items');
                }}
                className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left border-2 mb-2",
                    ageIdx === -1
                        ? "bg-accent-primary/20 text-accent-primary border-accent-primary shadow-md"
                        : "hover:bg-white/5 text-text-secondary border-transparent bg-bg-input/20"
                )}
            >
                <div className="w-8 h-8 rounded bg-bg-secondary flex items-center justify-center shrink-0">
                    <Bookmark className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium block">Saved Presets</span>
                    <span className="text-[10px] text-text-muted">{savedPresets.length} items</span>
                </div>
            </button>

            {AGES.map((ageName, idx) => {
                const isUnlocked = unlockedAges.includes(idx);
                const dropChance = getDropChance(idx);
                const ageColor = AGE_COLORS[idx] || AGE_COLORS[0];
                return (
                    <button
                        key={idx}
                        onClick={() => {
                            if (isUnlocked) {
                                setAgeIdx(idx);
                                setSelectedItemIdx(0);
                                setMobileTab('items');
                            }
                        }}
                        disabled={!isUnlocked}
                        className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left border-2",
                            !isUnlocked
                                ? "opacity-30 cursor-not-allowed border-transparent"
                                : ageIdx === idx
                                    ? `${ageColor.bg} ${ageColor.text} ${ageColor.border} shadow-md`
                                    : "hover:bg-white/5 text-text-secondary border-transparent"
                        )}
                    >
                        <div
                            style={getAgeIconStyle(idx, 32)}
                            className={cn(
                                "shrink-0 rounded bg-white/90",
                                !isUnlocked && "grayscale opacity-50"
                            )}
                        />
                        <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium block">{ageName}</span>
                            {isUnlocked && (
                                <span className="text-[10px] text-text-muted">
                                    {(dropChance * 100).toFixed(3)}% drop
                                </span>
                            )}
                        </div>
                    </button>
                );
            })}
        </div>
    );

    const renderItemGrid = () => (
        <div className="p-3 overflow-y-auto custom-scrollbar h-full">
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-bg-primary z-10 py-2">
                <h4 className="font-bold text-sm text-text-muted uppercase tracking-wider">
                    {ageIdx === -1 ? 'Saved Presets' : `${AGES[ageIdx]} Items`}
                </h4>
            </div>

            {/* Saved Items - Hidden in Pvp */}
            {!isPvp && ageIdx === -1 && savedPresets.length === 0 && (
                <div className="text-center text-text-muted py-8 text-sm">No saved builds found</div>
            )}

            {activeList.length > 0 ? (
                <div className="grid grid-cols-3 min-[400px]:grid-cols-4 gap-2">
                    {activeList.map((item: any, listIdx: number) => {
                        // Determine properties based on list type
                        let idx = 0;
                        let itemName = "";
                        let imgPath = "";
                        let ageForBg = 0;
                        let isSelected = false;

                        if (ageIdx === -1) {
                            // Saved Item
                            const saved = item as ItemSlot & { customName?: string };
                            idx = saved.idx;
                            ageForBg = saved.age;
                            const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                            imgPath = getItemImage(AGES[saved.age], fileSlot, saved.idx, autoMapping) || "";
                            itemName = saved.customName || getItemName(AGES[saved.age], fileSlot, saved.idx, autoMapping) || `Item #${idx}`;
                            isSelected = selectedSavedItemIndex === listIdx;
                        } else {
                            // Library Item
                            idx = item.ItemId?.Idx || 0;
                            ageForBg = ageIdx;
                            const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                            imgPath = getItemImage(AGES[ageIdx], fileSlot, idx, autoMapping) || "";
                            itemName = getItemName(AGES[ageIdx], fileSlot, idx, autoMapping) || `Item #${idx}`;
                            isSelected = selectedItemIdx === idx;
                        }

                        return (
                            <div
                                key={listIdx}
                                onClick={() => {
                                    if (ageIdx === -1) {
                                        setSelectedSavedItemIndex(listIdx);
                                        const saved = item as ItemSlot;
                                        setLevel(saved.level);
                                        setManualStats(saved.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []);
                                    } else {
                                        setSelectedItemIdx(idx);
                                        setManualStats([]); // Reset manual stats for new item from library
                                    }
                                    setMobileTab('config');
                                }}
                                className={cn(
                                    "relative rounded-xl border-2 transition-all p-1.5 flex flex-col items-center gap-1 group overflow-hidden cursor-pointer",
                                    isSelected
                                        ? "border-accent-primary shadow-lg shadow-accent-primary/20 bg-accent-primary/5"
                                        : "border-border hover:border-accent-primary/50"
                                )}
                            >
                                {ageIdx === -1 && (
                                    <button
                                        onClick={(e) => handleDeleteSavedItem(listIdx, e)}
                                        className="absolute top-1 right-1 z-20 p-1.5 bg-red-500 hover:bg-red-600 rounded-md text-white shadow-sm transition-opacity"
                                        title="Delete Preset"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <div
                                    className="w-12 h-12 rounded-lg flex items-center justify-center pointer-events-none"
                                    style={getAgeBgStyle(ageForBg)}
                                >
                                    {imgPath ? (
                                        <img src={imgPath} alt={itemName} className="w-10 h-10 object-contain" />
                                    ) : (
                                        <Shield className="w-6 h-6 text-text-muted" />
                                    )}
                                </div>
                                <span className="text-[9px] text-center text-text-secondary truncate w-full leading-tight select-none">
                                    {itemName}
                                </span>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center text-text-muted py-8 text-sm">No items available</div>
            )}
        </div>
    );

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[90vh] md:h-[85vh] rounded-2xl border border-border shadow-2xl relative flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
                            <img src="./Texture2D/IconDivineArmorPaladinarmor.png" alt="Equipment" className="w-8 h-8 object-contain" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">Select {slot}</h3>
                            <p className="text-xs text-text-muted">Forge Level {profile.misc.forgeLevel || 1}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Unequip button if item is equipped */}
                {current && (
                    <div className="px-4 py-2 border-b border-border bg-red-500/10">
                        <Button
                            variant="ghost"
                            className="w-full border-red-500/30 text-red-400 hover:bg-red-500/20"
                            onClick={() => { onSelect(null); onClose(); }}
                        >
                            <Trash2 className="w-4 h-4 mr-2" /> Unequip {slot}
                        </Button>
                    </div>
                )}

                {/* Mobile Tab Navigation */}
                <div className="flex md:hidden border-b border-border bg-bg-secondary/10">
                    <button
                        onClick={() => setMobileTab('age')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'age'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Calendar className="w-4 h-4" />
                        Age
                    </button>
                    <button
                        onClick={() => setMobileTab('items')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'items'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Grid className="w-4 h-4" />
                        Items
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
                    {mobileTab === 'age' && renderAgeSelection()}
                    {mobileTab === 'items' && renderItemGrid()}
                    {mobileTab === 'config' && renderConfig()}
                </div>

                {/* Desktop Layout */}
                <div className="flex-1 overflow-hidden hidden md:flex md:flex-row">
                    {/* Left: Age Selection */}
                    <div className="w-48 lg:w-52 shrink-0 border-r border-border bg-bg-secondary/10 flex flex-col">
                        <div className="overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-text-muted uppercase">Age</span>
                                <button
                                    onClick={() => setUnlockAll(!unlockAll)}
                                    className={cn(
                                        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                                        unlockAll
                                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                            : "bg-bg-input text-text-muted border border-border hover:bg-bg-input/80"
                                    )}
                                >
                                    <Unlock className="w-3 h-3" />
                                    {unlockAll ? 'All' : 'Unlock'}
                                </button>
                            </div>
                            <div className="space-y-1">
                                <button
                                    onClick={() => {
                                        setAgeIdx(-1);
                                        setSelectedItemIdx(0);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left border-2 mb-2",
                                        isPvp ? "hidden" : "", /* Hidden in PVP */
                                        ageIdx === -1
                                            ? "bg-accent-primary/20 text-accent-primary border-accent-primary shadow-md"
                                            : "hover:bg-white/5 text-text-secondary border-transparent bg-bg-input/20"
                                    )}
                                >
                                    <div className="w-6 h-6 rounded bg-bg-secondary flex items-center justify-center shrink-0">
                                        <Bookmark className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm font-medium truncate block">Saved Presets</span>
                                        <span className="text-[10px] text-text-muted">{savedPresets.length} items</span>
                                    </div>
                                </button>
                                {AGES.map((ageName, idx) => {
                                    const isUnlocked = unlockedAges.includes(idx);
                                    const dropChance = getDropChance(idx);
                                    const ageColor = AGE_COLORS[idx] || AGE_COLORS[0];
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => {
                                                if (isUnlocked) {
                                                    setAgeIdx(idx);
                                                    setSelectedItemIdx(0);
                                                }
                                            }}
                                            disabled={!isUnlocked}
                                            className={cn(
                                                "w-full flex items-center gap-2 p-2 rounded-lg transition-all text-left border-2",
                                                !isUnlocked
                                                    ? "opacity-30 cursor-not-allowed border-transparent"
                                                    : ageIdx === idx
                                                        ? `${ageColor.bg} ${ageColor.text} ${ageColor.border} shadow-md`
                                                        : "hover:bg-white/5 text-text-secondary border-transparent"
                                            )}
                                        >
                                            <div
                                                style={getAgeIconStyle(idx, 24)}
                                                className={cn(
                                                    "shrink-0 rounded bg-white/90",
                                                    !isUnlocked && "grayscale opacity-50"
                                                )}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-medium truncate block">{ageName}</span>
                                                {isUnlocked && (
                                                    <span className="text-[10px] text-text-muted">
                                                        {(dropChance * 100).toFixed(3)}% drop
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Middle: Item Grid */}
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar bg-bg-primary min-h-[300px]">
                        <div className="flex items-center justify-between mb-4 sticky top-0 bg-bg-primary z-10 py-2 border-b border-border/50">
                            <h4 className="font-bold text-sm text-text-muted uppercase tracking-wider">Available Items</h4>
                        </div>

                        {activeList.length > 0 ? (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {activeList.map((item: any, listIdx: number) => {
                                    // Determine properties based on list type
                                    let idx = 0;
                                    let itemName = "";
                                    let imgPath = "";
                                    let ageForBg = 0;
                                    let isSelected = false;

                                    if (ageIdx === -1) {
                                        // Saved Item
                                        const saved = item as ItemSlot & { customName?: string };
                                        idx = saved.idx;
                                        ageForBg = saved.age;
                                        const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                        imgPath = getItemImage(AGES[saved.age], fileSlot, saved.idx, autoMapping) || "";
                                        itemName = saved.customName || getItemName(AGES[saved.age], fileSlot, saved.idx, autoMapping) || `Item #${idx}`;
                                        isSelected = selectedSavedItemIndex === listIdx;
                                    } else {
                                        // Library Item
                                        idx = item.ItemId?.Idx || 0;
                                        ageForBg = ageIdx;
                                        const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                        imgPath = getItemImage(AGES[ageIdx], fileSlot, idx, autoMapping) || "";
                                        itemName = getItemName(AGES[ageIdx], fileSlot, idx, autoMapping) || `Item #${idx}`;
                                        isSelected = selectedItemIdx === idx;
                                    }

                                    return (
                                        <div
                                            key={listIdx}
                                            onClick={() => {
                                                if (ageIdx === -1) {
                                                    setSelectedSavedItemIndex(listIdx);
                                                    const saved = item as ItemSlot;
                                                    setLevel(saved.level);
                                                    setManualStats(saved.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []);
                                                } else {
                                                    setSelectedItemIdx(idx);
                                                    setManualStats([]);
                                                }
                                            }}
                                            className={cn(
                                                "relative rounded-xl border-2 transition-all p-1.5 flex flex-col items-center gap-1 group overflow-hidden cursor-pointer",
                                                isSelected
                                                    ? "border-accent-primary shadow-lg shadow-accent-primary/20 bg-accent-primary/5"
                                                    : "border-border hover:border-accent-primary/50"
                                            )}
                                        >
                                            {ageIdx === -1 && (
                                                <button
                                                    onClick={(e) => handleDeleteSavedItem(listIdx, e)}
                                                    className="absolute top-1 right-1 z-20 p-1.5 bg-red-500 hover:bg-red-600 rounded-md text-white shadow-sm transition-opacity"
                                                    title="Delete Preset"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                            <div
                                                className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center pointer-events-none"
                                                style={getAgeBgStyle(ageForBg)}
                                            >
                                                {imgPath ? (
                                                    <img src={imgPath} alt={itemName} className="w-8 h-8 sm:w-10 sm:h-10 object-contain" />
                                                ) : (
                                                    <Shield className="w-6 h-6 text-text-muted" />
                                                )}
                                            </div>
                                            <span className="text-[9px] sm:text-[10px] text-center text-text-secondary truncate w-full leading-tight select-none">
                                                {itemName}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-center text-text-muted py-8 text-sm">No items available</div>
                        )}
                    </div>

                    {/* Right: Item Details */}
                    <div className="w-72 p-4 border-l border-border overflow-y-auto custom-scrollbar bg-bg-secondary/10 shrink-0">
                        <h4 className="font-bold mb-4 text-sm text-text-muted uppercase tracking-wider">Item Details</h4>

                        {/* Base Stats */}
                        <div className="space-y-2 mb-4">
                            <div className="text-xs font-bold text-text-muted">BASE STATS</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-2 p-2 bg-bg-input/50 rounded">
                                    <Sword className="w-4 h-4 text-red-400" />
                                    <span className="font-mono text-sm">{baseStats.damage.toFixed(0)}</span>
                                </div>
                                <div className="flex items-center gap-2 p-2 bg-bg-input/50 rounded">
                                    <Heart className="w-4 h-4 text-green-400" />
                                    <span className="font-mono text-sm">{baseStats.health.toFixed(0)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Weapon Info */}
                        {slot === 'Weapon' && weaponInfo && (
                            <div className="space-y-2 mb-4 p-3 bg-bg-input/30 rounded-lg border border-border">
                                <div className="text-xs font-bold text-text-muted">WEAPON INFO</div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm">Type</span>
                                    <span className={cn(
                                        "font-bold px-2 py-0.5 rounded text-xs",
                                        weaponInfo.isRanged ? "bg-sky-500/20 text-sky-400" : "bg-amber-500/20 text-amber-400"
                                    )}>
                                        {weaponInfo.isRanged ? '🏹 RANGED' : '⚔️ MELEE'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex items-center gap-1">
                                        <Target className="w-3 h-3 text-text-muted" />
                                        <span className="text-text-muted">Range:</span>
                                        <span className="font-mono">{weaponInfo.attackRange.toFixed(1)}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-text-muted" />
                                        <span className="text-text-muted">Windup:</span>
                                        <span className="font-mono">{weaponInfo.windupTime.toFixed(2)}s</span>
                                    </div>
                                    {weaponInfo.hasProjectile && (
                                        <>
                                            <div className="flex items-center gap-1">
                                                <Target className="w-3 h-3 text-text-muted" />
                                                <span className="text-text-muted">Proj Speed:</span>
                                                <span className="font-mono">{weaponInfo.projectileSpeed.toFixed(0)}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Target className="w-3 h-3 text-text-muted" />
                                                <span className="text-text-muted">Proj Radius:</span>
                                                <span className="font-mono">{weaponInfo.projectileRadius.toFixed(2)}</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Level - Hidden in PVP */}
                        {!isPvp && (
                            <div className="mb-4">
                                <label className="text-xs font-bold text-text-muted block mb-2">
                                    ITEM LEVEL (MAX {maxLevelCap})
                                </label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={maxLevelCap}
                                    value={level}
                                    onChange={(e) => setLevel(Math.max(1, Math.min(maxLevelCap, parseInt(e.target.value) || 1)))}
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* Secondary Stats - Hidden in PVP */}
                        {!isPvp && (
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-text-muted">
                                        PASSIVE STATS ({manualStats.length}/{numSecondarySlots})
                                    </span>
                                    {manualStats.length < numSecondarySlots && (
                                        <Button variant="ghost" size="sm" onClick={addStat}>
                                            <Plus className="w-3 h-3 mr-1" /> Add
                                        </Button>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    {manualStats.map((stat, i) => {
                                        const range = getStatRange(stat.type);
                                        return (
                                            <div key={i} className="flex flex-col gap-1">
                                                <div className="flex gap-2 items-center">
                                                    <select
                                                        value={stat.type}
                                                        onChange={(e) => updateStat(i, 'type', e.target.value)}
                                                        className="flex-1 bg-bg-input border border-border rounded px-2 py-1 text-xs"
                                                    >
                                                        {STAT_TYPES.filter(t =>
                                                            // Allow if it's the current value of this row OR if it's not selected in any other row
                                                            t === stat.type || !manualStats.some(s => s.type === t)
                                                        ).map(t => (
                                                            <option key={t} value={t}>{getStatName(t)}</option>
                                                        ))}
                                                    </select>
                                                    <SecondaryStatInput
                                                        value={stat.value as number}
                                                        onChange={(val) => updateStat(i, 'value', val)}
                                                        min={(range?.min || 0) * 100}
                                                        max={(range?.max || 1) * 100}
                                                    />
                                                    <button onClick={() => removeStat(i)} className="text-red-400 hover:text-red-300">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                                {range && (
                                                    <div className="text-[10px] text-text-muted px-1">
                                                        Range: {(range.min * 100).toFixed(3).replace(/\.?0+$/, '')}% - {(range.max * 100).toFixed(3).replace(/\.?0+$/, '')}%
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Skins Selection */}
                        {renderSkinSelection()}

                        {/* Actions */}
                        <div className="flex gap-2 mt-6">
                            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
                            <Button variant="primary" onClick={handleSave} className="flex-1">Equip</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
// Helper component for decimal input
function DecimalInput({ value, onChange, min, max, className }: { value: number, onChange: (val: number) => void, min: number, max: number, className?: string }) {
    const [localValue, setLocalValue] = useState<string>(value.toString());

    // Sync from parent only if value differs significantly (external update)
    // and we are not currently typing a compatible string
    useEffect(() => {
        const currentNum = parseFloat(localValue.replace(',', '.'));
        // If the prop value matches our current parsed value, don't touch strict string
        // This allows "0.50" to remain "0.50" even if prop is 0.5
        // But if prop changes to 0.6, we must update.
        if (Math.abs(currentNum - value) > 0.0001) {
            setLocalValue(value.toString());
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setLocalValue(raw);

        if (raw === '') return;

        const normalized = raw.replace(',', '.');
        const num = parseFloat(normalized);

        if (!isNaN(num)) {
            // Propagate change immediately without clamping string
            // We clamp for data integrity but keep string free
            // Actually parent expects clamped value usually?
            // Let's pass raw num to parent, parent logic updates state.
            // If we want strict clamping, do it on blur or let parent clamp.
            // Existing logic clamped immediately. Ideally we clamp result passed to parent.
            const clamped = Math.max(min, Math.min(max, num));
            onChange(clamped);
        }
    };

    const handleBlur = () => {
        const normalized = localValue.replace(',', '.');
        let num = parseFloat(normalized);
        if (isNaN(num)) {
            num = min;
        }
        const clamped = Math.max(min, Math.min(max, num));
        // On blur, format nicely
        setLocalValue(clamped.toString());
        onChange(clamped);
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={(e) => e.target.select()}
            className={className}
        />
    );
}
