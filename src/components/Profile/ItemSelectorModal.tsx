import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SecondaryStatInput } from '../UI/SecondaryStatInput';
import { X, Sword, Heart, Plus, Trash2, Clock, Target, Unlock, Grid, Settings, Bookmark, Shield, Calendar, Pencil } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { ItemSlot } from '../../types/Profile';
import { Input } from '../UI/Input';
import { Button } from '../UI/Button';
import { ModalLevelSelector } from '../UI/ModalLevelSelector';
import { SecondaryStatCard } from '../UI/SecondaryStatCard';
import { cn, getAgeBgStyle, getAgeIconStyle, getRarityBgStyle } from '../../lib/utils';
import { AGES } from '../../utils/constants';
import { getItemImage, getItemName } from '../../utils/itemAssets';
import { getStatName } from '../../utils/statNames';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { useTreeModifiers, useClanTreeModifiers } from '../../hooks/useCalculatedStats';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { getItemStats, getPerfection, getStatPerfection } from '../../utils/itemCalculations';

interface ItemSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (item: ItemSlot | null) => void;
    slot: string;
    current: ItemSlot | null;
    isPvp?: boolean;
    forgeAscensionLevel?: number;
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
type SortField = 'level' | 'name' | 'age' | 'perfection' | 'idx';
type SortOrder = 'asc' | 'desc';

export function ItemSelectorModal({ isOpen, onClose, onSelect, slot, current, isPvp = false, forgeAscensionLevel }: ItemSelectorModalProps) {
    const { profile, updateNestedProfile } = useProfile();

    // Ref to break circular dependency in auto-sync effect
    const savedItemsRef = useRef(profile.savedItems);
    savedItemsRef.current = profile.savedItems;
    const { selectedVersion } = useGameDataContext();
    const stats = useGlobalStats();
    const { data: itemLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: secondaryData } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: ageDropChances } = useGameData<any>('ItemAgeDropChancesLibrary.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');

    const techModifiers = useTreeModifiers();
    const clanModifiers = useClanTreeModifiers();

    // Calculated forge ascension multiplier
    const forgeAscensionMulti = useMemo(() => {
        let total = 0;
        const ascLevel = forgeAscensionLevel || profile.misc.forgeAscensionLevel || 0;

        if (ascLevel > 0 && ascensionConfigs?.Forge?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Forge.AscensionConfigPerLevel;
            const config = configs[Math.min(ascLevel - 1, configs.length - 1)];
            if (config) {
                const contributions = config.StatContributions || [];
                for (const stat of contributions) {
                    const statType = stat.StatNode?.UniqueStat?.StatType;
                    if (statType === 'Damage' || statType === 'AscensionDamage') {
                        total = stat.Value + 1;
                        break;
                    }
                }
            }
        }
        return total;
    }, [forgeAscensionLevel, profile.misc.forgeAscensionLevel, ascensionConfigs]);

    const jsonType = SLOT_MAPPING[slot] || slot;
    const [unlockAll, setUnlockAll] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab | 'skin'>('age');

    // Saved Presets Filtering/Sorting
    const [savedSearchQuery, setSavedSearchQuery] = useState('');
    const [savedSortField, setSavedSortField] = useState<SortField>('level');
    const [savedSortOrder, setSavedSortOrder] = useState<SortOrder>('desc');

    // Advanced Filters
    const [filterAges, setFilterAges] = useState<number[]>([]);
    const [minPerfection, setMinPerfection] = useState<number>(0);
    const [filterStats, setFilterStats] = useState<string[]>([]);
    const [showFilters, setShowFilters] = useState(false);

    // Skin State
    const [skinIdx, setSkinIdx] = useState<number | null>(null);
    const [skinStatsList, setSkinStatsList] = useState<{ type: string; value: number }[]>([]);

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

    // Auto-sync for saved items (uses ref to avoid re-triggering on savedItems change)
    useEffect(() => {
        if (!isOpen) return;
        if (selectedSavedItemIndex !== null && ageIdx === -1) {
            const currentSaved = savedItemsRef.current?.[slot] || [];
            const savedItem = currentSaved[selectedSavedItemIndex];
            if (savedItem) {
                // Convert skinStatsList array back to Record for storage
                const skinStatsRecord: Record<string, number> = {};
                skinStatsList.forEach(s => {
                    skinStatsRecord[s.type] = s.value;
                });

                const updatedItem: ItemSlot = {
                    ...savedItem,
                    level,
                    secondaryStats: manualStats.map(s => ({ statId: s.type, value: s.value })),
                    skin: skinIdx !== null ? {
                        idx: skinIdx,
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

                // Only update if actually different to avoid loop
                const hasChanged =
                    savedItem.level !== updatedItem.level ||
                    JSON.stringify(savedItem.secondaryStats) !== JSON.stringify(updatedItem.secondaryStats) ||
                    JSON.stringify(savedItem.skin) !== JSON.stringify(updatedItem.skin);

                if (hasChanged) {
                    const newSaved = [...currentSaved];
                    newSaved[selectedSavedItemIndex] = updatedItem;
                    updateNestedProfile('savedItems', { [slot]: newSaved });

                    // Also propagate to active item if this saved item is currently equipped
                    const activeItem = profile.items[slot as keyof typeof profile.items];
                    if (activeItem &&
                        activeItem.idx === savedItem.idx &&
                        activeItem.age === savedItem.age &&
                        activeItem.level === savedItem.level &&
                        JSON.stringify(activeItem.secondaryStats) === JSON.stringify(savedItem.secondaryStats) &&
                        JSON.stringify(activeItem.skin) === JSON.stringify(savedItem.skin)) {

                        updateNestedProfile('items', { [slot]: updatedItem });
                    }
                }
            }
        }
    }, [level, manualStats, skinIdx, skinStatsList, ageIdx, selectedSavedItemIndex, slot, skinsLibrary, updateNestedProfile, profile.items, isOpen]);

    // Sync state when modal opens
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

            // Check if current is a saved item
            const savedItems = profile.savedItems?.[slot] || [];
            const savedIdx = current ? savedItems.findIndex(s =>
                s.age === current.age &&
                s.idx === current.idx &&
                JSON.stringify(s.secondaryStats) === JSON.stringify(current.secondaryStats)
            ) : -1;

            if (savedIdx !== -1) {
                setSelectedSavedItemIndex(savedIdx);
                setAgeIdx(-1);
            } else {
                setSelectedSavedItemIndex(null);
            }

            setLevel(current ? current.level : 1);
            setManualStats(current?.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []);
            setSkinIdx(current?.skin?.idx ?? null);

            if (current?.skin?.stats) {
                const stats = Object.entries(current.skin.stats).map(([type, value]) => ({ type, value }));
                setSkinStatsList(stats);
            } else {
                setSkinStatsList([]);
            }
            setMobileTab('age');
        }
    }, [isOpen]);

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
        const raw = profile.savedItems?.[slot] || [];
        let filtered = raw.map((item, idx) => ({ ...item, savedIndex: idx }));

        // Search Filter
        if (savedSearchQuery.trim()) {
            const q = savedSearchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                const name = p.customName || getItemName(AGES[p.age], jsonType, p.idx, autoMapping) || `Item #${p.idx}`;
                return name.toLowerCase().includes(q);
            });
        }

        // Age Filter
        if (filterAges.length > 0) {
            filtered = filtered.filter(p => filterAges.includes(p.age));
        }

        // Perfection Filter
        if (minPerfection > 0) {
            filtered = filtered.filter(p => (getPerfection(p, secondaryStatLibrary) || 0) >= minPerfection);
        }

        // Stats Filter
        if (filterStats.length > 0) {
            filtered = filtered.filter(p =>
                filterStats.some(sId => p.secondaryStats?.some(s => s.statId === sId))
            );
        }

        return filtered.sort((a, b) => {
            let valA: any;
            let valB: any;

            switch (savedSortField) {
                case 'level':
                    valA = a.level;
                    valB = b.level;
                    break;
                case 'name':
                    valA = a.customName || getItemName(AGES[a.age], jsonType, a.idx, autoMapping) || `Item #${a.idx}`;
                    valB = b.customName || getItemName(AGES[b.age], jsonType, b.idx, autoMapping) || `Item #${b.idx}`;
                    break;
                case 'age':
                    valA = a.age;
                    valB = b.age;
                    break;
                case 'perfection':
                    valA = getPerfection(a, secondaryStatLibrary);
                    valB = getPerfection(b, secondaryStatLibrary);
                    break;
                default:
                    valA = a.savedIndex;
                    valB = b.savedIndex;
            }

            if (typeof valA === 'string') {
                return savedSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return savedSortOrder === 'asc' ? valA - valB : valB - valA;
        });
    }, [profile.savedItems, slot, jsonType, ageIdx, savedSearchQuery, savedSortField, savedSortOrder, filterAges, minPerfection, filterStats, itemLibrary, secondaryStatLibrary]);

    const activeList = useMemo(() => {
        if (ageIdx === -1) return savedPresets;
        return availableItems;
    }, [ageIdx, savedPresets, availableItems]);

    const selectedItemData = useMemo(() => {
        if (ageIdx === -1 && selectedSavedItemIndex !== null) return savedPresets.find((p: any) => p.savedIndex === selectedSavedItemIndex);
        return availableItems.find((item: any) => item.ItemId?.Idx === selectedItemIdx) || availableItems[0];
    }, [availableItems, selectedItemIdx, ageIdx, selectedSavedItemIndex, savedPresets]);

    // Get weapon info from WeaponLibrary + Projectile info
    const weaponInfo = useMemo(() => {
        if (slot !== 'Weapon' || !weaponLibrary || !selectedItemData) return null;
        const ageToUse = ageIdx === -1 ? ((selectedItemData as any).age ?? 0) : ageIdx;
        const idxToUse = ageIdx === -1 ? ((selectedItemData as any).idx ?? 0) : selectedItemIdx;
        const key = `{'Age': ${ageToUse}, 'Type': 'Weapon', 'Idx': ${idxToUse}}`;
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
            isAiming: !!weaponData.IsAiming,
            projectileSpeed: 0,
            projectileRadius: 0,
            affectedByGravity: false,
            hasProjectile: false
        };

        // Get projectile data if exists
        if (hasProjectile && projectilesLibrary) {
            const projData = projectilesLibrary[String(projId)];
            if (projData) {
                info.hasProjectile = true;
                info.projectileSpeed = projData.Speed || 0;
                info.projectileRadius = projData.CollisionRadius || 0;
                info.affectedByGravity = !!projData.AffectedByGravity;
            }
        }

        return info;
    }, [slot, weaponLibrary, projectilesLibrary, ageIdx, selectedItemIdx, selectedItemData]);

    const skinWeaponInfo = useMemo(() => {
        if (slot !== 'Weapon' || !weaponLibrary || skinIdx === null) return null;

        // Determine if we should use 999 (Melee) or 1000 (Ranged)
        // Usually, the skin matches the base weapon's "rangedness" in terms of stats used.
        const baseIsRanged = weaponInfo?.isRanged ?? false;
        const skinAge = baseIsRanged ? 1000 : 999;

        const key = `{'Age': ${skinAge}, 'Type': 'Weapon', 'Idx': ${skinIdx}}`;
        const skinData = weaponLibrary[key];
        if (!skinData) return null;

        const projId = skinData.ProjectileId;
        const hasProjectile = typeof projId === 'number' && projId > 0;

        const info = {
            attackRange: skinData.AttackRange || 0,
            windupTime: skinData.WindupTime || 0.5,
            attackDuration: skinData.AttackDuration || 1,
            isAiming: !!skinData.IsAiming,
            projectileSpeed: 0,
            projectileRadius: 0,
            affectedByGravity: false,
            hasProjectile: false
        };

        if (hasProjectile && projectilesLibrary) {
            const projData = projectilesLibrary[String(projId)];
            if (projData) {
                info.hasProjectile = true;
                info.projectileSpeed = projData.Speed || 0;
                info.projectileRadius = projData.CollisionRadius || 0;
                info.affectedByGravity = !!projData.AffectedByGravity;
            }
        }

        return info;
    }, [slot, weaponLibrary, projectilesLibrary, skinIdx, weaponInfo?.isRanged]);

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
        // If the user has at least one forge ascension, all items get 2 secondary stats
        // Use the passed level (for comparison/pvp) or fallback to profile level
        const currentAscension = forgeAscensionLevel !== undefined ? forgeAscensionLevel : (profile.misc.forgeAscensionLevel || 0);
        if (currentAscension > 0) return 2;

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
    }, [secondaryData, ageIdx, selectedItemData, profile.misc.forgeAscensionLevel, forgeAscensionLevel]);

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

    const addSkinStat = (possibleStats: any[]) => {
        if (skinStatsList.length < (possibleStats.length || 0)) {
            const existingTypes = new Set(skinStatsList.map(s => s.type));
            // Find first available type
            const nextStat = possibleStats.find(s => !existingTypes.has(s.StatNode.UniqueStat.StatType));

            if (nextStat) {
                const type = nextStat.StatNode.UniqueStat.StatType;
                setSkinStatsList([...skinStatsList, {
                    type,
                    value: 0.01 // Default to 1%
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
            // Hardcoded 1% to 100% limits
            val = Math.max(0.01, Math.min(1.0, val));
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

                        return (
                            <button
                                key={skin.SkinId.Idx}
                                onClick={() => {
                                    setSkinIdx(skin.SkinId.Idx);
                                    if (skin.PossibleStats && skin.PossibleStats.length > 0) {
                                        const firstStat = skin.PossibleStats[0];
                                        setSkinStatsList([{
                                            type: firstStat.StatNode.UniqueStat.StatType,
                                            value: 0.01 // Default to 1%
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
                                    style={getSkinSpriteStyle(skin, spriteMapping?.skins?.mapping, selectedVersion)}
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

                                    <div className="flex flex-col gap-3">
                                        {skinStatsList.map((stat, i) => {
                                            // Get constraints for this stat type
                                            const statDef = possibleStats.find((s: any) => s.StatNode?.UniqueStat?.StatType === stat.type);
                                            const min = statDef?.MinValue || 0;
                                            const max = statDef?.MaxValue || 1;

                                            const statOptions = possibleStats
                                                .filter((s: any) => s.StatNode.UniqueStat.StatType === stat.type || !skinStatsList.some(existing => existing.type === s.StatNode.UniqueStat.StatType))
                                                .map((s: any) => ({
                                                    id: s.StatNode.UniqueStat.StatType,
                                                    name: s.StatNode.UniqueStat.StatType
                                                }));

                                            return (
                                                <SecondaryStatCard
                                                    key={i}
                                                    statId={stat.type}
                                                    value={parseFloat((stat.value * 100).toFixed(2))}
                                                    options={statOptions}
                                                    onStatIdChange={(newId) => updateSkinStat(i, 'type', newId, possibleStats)}
                                                    onValueChange={(newVal) => updateSkinStat(i, 'value', newVal / 100, possibleStats)}
                                                    onRemove={() => removeSkinStat(i)}
                                                    range={{ min: 0.01, max: 1.0 }}
                                                />
                                            );
                                        })}
                                    </div>

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
            {/* Custom Name for Presets */}
            {ageIdx === -1 && selectedSavedItemIndex !== null && (
                <div className="space-y-2">
                    <label className="text-xs font-bold text-text-muted block uppercase tracking-wider">Preset Name</label>
                    <div className="relative group">
                        <Input
                            value={(selectedItemData as any)?.customName || ''}
                            onChange={(e) => {
                                const currentSaved = profile.savedItems?.[slot] || [];
                                const newSaved = [...currentSaved];
                                if (newSaved[selectedSavedItemIndex]) {
                                    newSaved[selectedSavedItemIndex] = {
                                        ...newSaved[selectedSavedItemIndex],
                                        customName: e.target.value
                                    };
                                    updateNestedProfile('savedItems', { [slot]: newSaved });
                                }
                            }}
                            placeholder="Set a custom name..."
                            className="bg-bg-input/50 border-border focus:border-accent-primary h-9 text-sm"
                        />
                        <Pencil className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted opacity-50" />
                    </div>
                </div>
            )}

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
                        <div className="flex gap-2">
                            <span className={cn(
                                "font-bold px-2 py-0.5 rounded text-xs",
                                weaponInfo.isRanged ? "bg-sky-500/20 text-sky-400" : "bg-amber-500/20 text-amber-400"
                            )}>
                                {weaponInfo.isRanged ? '🏹 RANGED' : '⚔️ MELEE'}
                            </span>
                            {skinIdx !== null && (
                                <span className="text-[10px] text-text-muted flex items-center">
                                    (Skin Graphics)
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-xs">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-text-muted" />
                                <span className="text-text-muted">Windup:</span>
                            </div>
                            <div className="font-mono">
                                {weaponInfo.windupTime.toFixed(2)}s
                                {skinWeaponInfo && Math.abs(skinWeaponInfo.windupTime - weaponInfo.windupTime) > 0.01 && (
                                    <span className="text-amber-400 ml-1">→ {skinWeaponInfo.windupTime.toFixed(2)}s</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                <Target className="w-3 h-3 text-text-muted" />
                                <span className="text-text-muted">Range:</span>
                            </div>
                            <div className="font-mono">
                                {weaponInfo.attackRange.toFixed(1)}
                                {skinWeaponInfo && Math.abs(skinWeaponInfo.attackRange - weaponInfo.attackRange) > 0.01 && (
                                    <span className="text-amber-400 ml-1">→ {skinWeaponInfo.attackRange.toFixed(1)}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                <Target className="w-3 h-3 text-text-muted" />
                                <span className="text-text-muted">Is Aiming:</span>
                            </div>
                            <div className="font-mono">
                                {weaponInfo.isAiming ? 'Yes' : 'No'}
                                {skinWeaponInfo && skinWeaponInfo.isAiming !== weaponInfo.isAiming && (
                                    <span className="text-amber-400 ml-1">→ {skinWeaponInfo.isAiming ? 'Yes' : 'No'}</span>
                                )}
                            </div>
                        </div>
                        {weaponInfo.hasProjectile && (
                            <>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1">
                                        <Target className="w-3 h-3 text-text-muted" />
                                        <span className="text-text-muted">Proj Speed:</span>
                                    </div>
                                    <div className="font-mono">
                                        {weaponInfo.projectileSpeed.toFixed(0)}
                                        {skinWeaponInfo && skinWeaponInfo.hasProjectile && Math.abs(skinWeaponInfo.projectileSpeed - weaponInfo.projectileSpeed) > 0.01 && (
                                            <span className="text-amber-400 ml-1">→ {skinWeaponInfo.projectileSpeed.toFixed(0)}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1">
                                        <Target className="w-3 h-3 text-text-muted" />
                                        <span className="text-text-muted">Proj Radius:</span>
                                    </div>
                                    <div className="font-mono">
                                        {weaponInfo.projectileRadius.toFixed(2)}
                                        {skinWeaponInfo && skinWeaponInfo.hasProjectile && Math.abs(skinWeaponInfo.projectileRadius - weaponInfo.projectileRadius) > 0.01 && (
                                            <span className="text-amber-400 ml-1">→ {skinWeaponInfo.projectileRadius.toFixed(2)}</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1">
                                        <Target className="w-3 h-3 text-text-muted" />
                                        <span className="text-text-muted">Affected By Gravity:</span>
                                    </div>
                                    <div className="font-mono">
                                        {weaponInfo.affectedByGravity ? 'Yes' : 'No'}
                                        {skinWeaponInfo && skinWeaponInfo.hasProjectile && skinWeaponInfo.affectedByGravity !== weaponInfo.affectedByGravity && (
                                            <span className="text-amber-400 ml-1">→ {skinWeaponInfo.affectedByGravity ? 'Yes' : 'No'}</span>
                                        )}
                                    </div>
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
                                setSelectedSavedItemIndex(null);
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
                            style={getAgeIconStyle(idx, 32, selectedVersion)}
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
            {ageIdx === -1 && (
                <div className="mb-4 space-y-3 bg-bg-secondary/30 p-3 rounded-xl border border-border/50">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                            <div className="relative flex-1">
                                <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                                <Input
                                    placeholder="Search presets..."
                                    value={savedSearchQuery}
                                    onChange={(e) => setSavedSearchQuery(e.target.value)}
                                    className="pl-9 h-9 text-sm"
                                />
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 px-2 shrink-0"
                                onClick={() => setSavedSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                            >
                                {savedSortOrder === 'asc' ? '↑' : '↓'}
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 bg-bg-input rounded-lg p-1 border border-border">
                                <select
                                    value={savedSortField}
                                    onChange={(e) => setSavedSortField(e.target.value as SortField)}
                                    className="bg-transparent text-[10px] font-black uppercase tracking-wider px-2 py-1 outline-none cursor-pointer text-text-primary"
                                >
                                    {(['level', 'name', 'age', 'perfection', 'idx'] as SortField[]).map(field => (
                                        <option key={field} value={field} className="bg-bg-secondary text-text-primary">
                                            {field}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowFilters(!showFilters)}
                                className={cn("h-9 gap-2 text-[10px] font-black uppercase tracking-wider", showFilters && "text-accent-primary bg-accent-primary/10")}
                            >
                                <Settings className="w-3.5 h-3.5" />
                                Filters {(filterAges.length > 0 || minPerfection > 0 || filterStats.length > 0) && `(${(filterAges.length > 0 ? 1 : 0) + (minPerfection > 0 ? 1 : 0) + (filterStats.length > 0 ? 1 : 0)})`}
                            </Button>
                        </div>
                    </div>

                    {showFilters && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-border/30 animate-in fade-in slide-in-from-top-1">
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-text-muted uppercase tracking-widest">Ages</label>
                                <div className="flex flex-wrap gap-1">
                                    {AGES.map((name, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setFilterAges(prev => prev.includes(i) ? prev.filter(a => a !== i) : [...prev, i])}
                                            className={cn(
                                                "px-2 py-0.5 rounded text-[9px] font-bold border transition-all",
                                                filterAges.includes(i)
                                                    ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                                                    : "bg-bg-input border-border text-text-muted hover:border-border/80"
                                            )}
                                        >
                                            {name}
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
                            {(filterAges.length > 0 || minPerfection > 0 || filterStats.length > 0) && (
                                <button
                                    onClick={() => { setFilterAges([]); setMinPerfection(0); setFilterStats([]); }}
                                    className="md:col-span-2 text-[9px] font-black text-red-400 hover:text-red-300 uppercase tracking-widest text-center py-1"
                                >
                                    Clear All Filters
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {!isPvp && ageIdx === -1 && savedPresets.length === 0 && (
                <div className="text-center text-text-muted py-8 text-sm italic">
                    {savedSearchQuery ? 'No presets matching search' : 'No saved builds found'}
                </div>
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
                            imgPath = getItemImage(AGES[saved.age], fileSlot, saved.idx, autoMapping, selectedVersion) || "";
                            itemName = saved.customName || getItemName(AGES[saved.age], fileSlot, saved.idx, autoMapping) || `Item #${idx}`;
                            isSelected = selectedSavedItemIndex === (saved as any).savedIndex;
                        } else {
                            // Library Item
                            idx = item.ItemId?.Idx || 0;
                            ageForBg = ageIdx;
                            const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                            imgPath = getItemImage(AGES[ageIdx], fileSlot, idx, autoMapping, selectedVersion) || "";
                            itemName = getItemName(AGES[ageIdx], fileSlot, idx, autoMapping) || `Item #${idx}`;
                            isSelected = selectedItemIdx === idx;
                        }

                        return (
                            <div
                                key={listIdx}
                                onClick={() => {
                                    if (ageIdx === -1) {
                                        setSelectedSavedItemIndex((item as any).savedIndex);
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
                                style={
                                    ageForBg >= 0 ? { 
                                        background: getAgeBgStyle(ageForBg).background?.toString()
                                            .replace('0.5', isSelected ? '0.3' : '0.15')
                                            .replace('0.2', isSelected ? '0.15' : '0.08') 
                                    } : {}
                                }
                            >
                                {ageIdx === -1 && (
                                    <button
                                        onClick={(e) => handleDeleteSavedItem((item as any).savedIndex, e)}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[90vh] md:h-[85vh] rounded-2xl border border-border shadow-2xl relative flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
                            <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/IconDivineArmorPaladinarmor.png`} alt="Equipment" className="w-8 h-8 object-contain" />
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
                                                    setSelectedSavedItemIndex(null);
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
                                                style={getAgeIconStyle(idx, 24, selectedVersion)}
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
                            <div className={cn(
                                "grid gap-2",
                                ageIdx === -1
                                    ? "grid-cols-2 lg:grid-cols-3" // Larger cards for saved presets
                                    : "grid-cols-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4" // Compact for age list
                            )}>
                                {activeList.map((item: any, listIdx: number) => {
                                    if (ageIdx === -1) {
                                        // Saved Item - Use the detailed Card
                                        const saved = item as ItemSlot & { customName?: string };
                                        const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                        const itemName = saved.customName || getItemName(AGES[saved.age], fileSlot, saved.idx, autoMapping) || `Item #${saved.idx}`;
                                        const imgPath = getItemImage(AGES[saved.age], fileSlot, saved.idx, autoMapping, selectedVersion) || "";

                                        return (
                                            <ItemSelectionCard
                                                key={listIdx}
                                                item={saved}
                                                slotKey={slot}
                                                slotLabel={slot}
                                                isSelected={selectedSavedItemIndex === (saved as any).savedIndex}
                                                isSaved={true}
                                                itemName={itemName}
                                                itemImage={imgPath}
                                                variant="compact"
                                                stats={getItemStats(
                                                    saved,
                                                    slot,
                                                    { itemBalancingLibrary: itemLibrary, itemBalancingConfig, weaponLibrary },
                                                    { techModifiers, forgeAscensionMulti, clanModifiers }
                                                )}
                                                perfection={getPerfection(saved, secondaryStatLibrary)}
                                                getStatPerfection={(sId, val) => getStatPerfection(sId, val, secondaryStatLibrary)}
                                                spriteMapping={spriteMapping}
                                                onClick={() => {
                                                    setSelectedSavedItemIndex((saved as any).savedIndex);
                                                    setLevel(saved.level);
                                                    setManualStats(saved.secondaryStats?.map(s => ({ type: s.statId, value: s.value })) || []);
                                                    if (saved.skin) {
                                                        setSkinIdx(saved.skin.idx);
                                                        setSkinStatsList(Object.entries(saved.skin.stats).map(([k, v]) => ({ type: k, value: Number(v) })));
                                                    } else {
                                                        setSkinIdx(null);
                                                        setSkinStatsList([]);
                                                    }
                                                }}
                                                onDelete={(e) => handleDeleteSavedItem((saved as any).savedIndex, e)}
                                            />
                                        );
                                    }

                                    // Library Item - Keep original simple look
                                    const idx = item.ItemId?.Idx || 0;
                                    const ageForBg = ageIdx;
                                    const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                    const imgPath = getItemImage(AGES[ageIdx], fileSlot, idx, autoMapping, selectedVersion) || "";
                                    const itemName = getItemName(AGES[ageIdx], fileSlot, idx, autoMapping) || `Item #${idx}`;
                                    const isSelected = selectedItemIdx === idx;

                                    return (
                                        <div
                                            key={listIdx}
                                            onClick={() => {
                                                setSelectedItemIdx(idx);
                                                setManualStats([]);
                                            }}
                                            className={cn(
                                                "relative rounded-xl border-2 transition-all p-1.5 flex flex-col items-center gap-1 group overflow-hidden cursor-pointer",
                                                isSelected
                                                    ? "border-accent-primary shadow-lg shadow-accent-primary/20 bg-accent-primary/5"
                                                    : "border-border hover:border-accent-primary/50"
                                            )}
                                            style={
                                                ageForBg >= 0 ? { 
                                                    background: getAgeBgStyle(ageForBg).background?.toString()
                                                        .replace('0.5', isSelected ? '0.3' : '0.15')
                                                        .replace('0.2', isSelected ? '0.15' : '0.08') 
                                                } : {}
                                            }
                                        >
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
                                            <span className="text-[9px] sm:text-[10px] text-center text-text-primary truncate w-full leading-tight select-none">
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
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-bold text-sm text-text-muted uppercase tracking-wider">Item Details</h4>
                        </div>

                        {/* Item Preview */}
                        <div className="text-center bg-bg-primary/30 rounded-2xl p-4 border border-border/50 mb-6">
                            <div
                                className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-xl border-2 overflow-hidden relative"
                                style={{ 
                                    ...getAgeBgStyle(ageIdx === -1 ? ((selectedItemData as any)?.age || 0) : ageIdx), 
                                    borderColor: `rgb(var(--age-${AGES[ageIdx === -1 ? ((selectedItemData as any)?.age || 0) : ageIdx].toLowerCase().replace(' ', '')}))` 
                                }}
                            >
                                {(() => {
                                    const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                    const ageToUse = ageIdx === -1 ? ((selectedItemData as any)?.age || 0) : ageIdx;
                                    const idxToUse = ageIdx === -1 ? ((selectedItemData as any)?.idx || 0) : selectedItemIdx;
                                    const imgPath = getItemImage(AGES[ageToUse], fileSlot, idxToUse, autoMapping, selectedVersion);

                                    return imgPath ? (
                                        <img src={imgPath} alt="Preview" className="w-20 h-20 object-contain drop-shadow-xl" />
                                    ) : (
                                        <Shield className="w-12 h-12 text-text-muted opacity-30" />
                                    );
                                })()}
                            </div>
                            <h2 className="text-xl font-bold text-text-primary leading-tight">
                                {(() => {
                                    if (ageIdx === -1 && (selectedItemData as any)?.customName) return (selectedItemData as any).customName;
                                    const fileSlot = IMAGE_SLOT_MAP[slot] || slot;
                                    const ageToUse = ageIdx === -1 ? ((selectedItemData as any)?.age || 0) : ageIdx;
                                    const idxToUse = ageIdx === -1 ? ((selectedItemData as any)?.idx || 0) : selectedItemIdx;
                                    return getItemName(AGES[ageToUse], fileSlot, idxToUse, autoMapping) || `Item #${idxToUse}`;
                                })()}
                            </h2>
                            <div className="text-[10px] font-bold uppercase tracking-widest mt-1 text-text-muted">
                                {ageIdx === -1 ? ((selectedItemData as any)?.rarity || AGES[(selectedItemData as any)?.age || 0]) : AGES[ageIdx]} {slot}
                            </div>
                        </div>

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

                        {slot === 'Weapon' && weaponInfo && (
                            <div className="space-y-2 mb-4 p-3 bg-bg-input/30 rounded-lg border border-border">
                                <div className="text-xs font-bold text-text-muted">WEAPON INFO</div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm">Type</span>
                                    <div className="flex gap-2">
                                        <span className={cn(
                                            "font-bold px-2 py-0.5 rounded text-xs",
                                            weaponInfo.isRanged ? "bg-sky-500/20 text-sky-400" : "bg-amber-500/20 text-amber-400"
                                        )}>
                                            {weaponInfo.isRanged ? '🏹 RANGED' : '⚔️ MELEE'}
                                        </span>
                                        {skinIdx !== null && (
                                            <span className="text-[10px] text-text-muted flex items-center">
                                                (Skin Graphics)
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-2 text-xs">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <Clock className="w-3 h-3 text-text-muted" />
                                            <span className="text-text-muted">Windup:</span>
                                        </div>
                                        <div className="font-mono">
                                            {weaponInfo.windupTime.toFixed(2)}s
                                            {skinWeaponInfo && Math.abs(skinWeaponInfo.windupTime - weaponInfo.windupTime) > 0.01 && (
                                                <span className="text-amber-400 ml-1">→ {skinWeaponInfo.windupTime.toFixed(2)}s</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <Target className="w-3 h-3 text-text-muted" />
                                            <span className="text-text-muted">Range:</span>
                                        </div>
                                        <div className="font-mono">
                                            {weaponInfo.attackRange.toFixed(1)}
                                            {skinWeaponInfo && Math.abs(skinWeaponInfo.attackRange - weaponInfo.attackRange) > 0.01 && (
                                                <span className="text-amber-400 ml-1">→ {skinWeaponInfo.attackRange.toFixed(1)}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <Target className="w-3 h-3 text-text-muted" />
                                            <span className="text-text-muted">Is Aiming:</span>
                                        </div>
                                        <div className="font-mono">
                                            {weaponInfo.isAiming ? 'Yes' : 'No'}
                                            {skinWeaponInfo && skinWeaponInfo.isAiming !== weaponInfo.isAiming && (
                                                <span className="text-amber-400 ml-1">→ {skinWeaponInfo.isAiming ? 'Yes' : 'No'}</span>
                                            )}
                                        </div>
                                    </div>
                                    {weaponInfo.hasProjectile && (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1">
                                                    <Target className="w-3 h-3 text-text-muted" />
                                                    <span className="text-text-muted">Proj Speed:</span>
                                                </div>
                                                <div className="font-mono">
                                                    {weaponInfo.projectileSpeed.toFixed(0)}
                                                    {skinWeaponInfo && skinWeaponInfo.hasProjectile && Math.abs(skinWeaponInfo.projectileSpeed - weaponInfo.projectileSpeed) > 0.01 && (
                                                        <span className="text-amber-400 ml-1">→ {skinWeaponInfo.projectileSpeed.toFixed(0)}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1">
                                                    <Target className="w-3 h-3 text-text-muted" />
                                                    <span className="text-text-muted">Proj Radius:</span>
                                                </div>
                                                <div className="font-mono">
                                                    {weaponInfo.projectileRadius.toFixed(2)}
                                                    {skinWeaponInfo && skinWeaponInfo.hasProjectile && Math.abs(skinWeaponInfo.projectileRadius - weaponInfo.projectileRadius) > 0.01 && (
                                                        <span className="text-amber-400 ml-1">→ {skinWeaponInfo.projectileRadius.toFixed(2)}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1">
                                                    <Target className="w-3 h-3 text-text-muted" />
                                                    <span className="text-text-muted">Affected By Gravity:</span>
                                                </div>
                                                <div className="font-mono">
                                                    {weaponInfo.affectedByGravity ? 'Yes' : 'No'}
                                                    {skinWeaponInfo && skinWeaponInfo.hasProjectile && skinWeaponInfo.affectedByGravity !== weaponInfo.affectedByGravity && (
                                                        <span className="text-amber-400 ml-1">→ {skinWeaponInfo.affectedByGravity ? 'Yes' : 'No'}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Level - Hidden in PVP */}
                        {!isPvp && (
                            <ModalLevelSelector
                                level={level}
                                maxLevel={maxLevelCap}
                                onChange={setLevel}
                                label="Item Level"
                                className="mb-6"
                            />
                        )}

                        {/* Secondary Stats - Hidden in PVP */}
                        {!isPvp && (
                            <div className="mb-6">
                                <div className="flex items-center justify-between mb-3 px-1">
                                    <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
                                        Passive Stats ({manualStats.length}/{numSecondarySlots})
                                    </span>
                                    {manualStats.length < numSecondarySlots && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={addStat}
                                            className="h-7 text-xs text-accent-primary hover:bg-accent-primary/10"
                                        >
                                            <Plus className="w-3.5 h-3.5 mr-1" /> Add Stat
                                        </Button>
                                    )}
                                </div>

                                <div className="flex flex-col gap-3">
                                    {manualStats.map((stat, i) => {
                                        const range = getStatRange(stat.type);
                                        const statOptions = STAT_TYPES.filter(t =>
                                            t === stat.type || !manualStats.some(s => s.type === t)
                                        ).map(t => ({ id: t, name: getStatName(t) }));

                                        return (
                                            <SecondaryStatCard
                                                key={i}
                                                statId={stat.type}
                                                value={stat.value as number}
                                                options={statOptions}
                                                onStatIdChange={(newId) => updateStat(i, 'type', newId)}
                                                onValueChange={(newVal) => updateStat(i, 'value', newVal)}
                                                onRemove={() => removeStat(i)}
                                                range={range}
                                            />
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
