import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { X, Bookmark, GitCompare, Shield, Zap } from 'lucide-react';
import { ItemSlot, MountSlot, UserProfile } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { ItemSelectorModal } from './ItemSelectorModal';
import { MountSelectorModal } from './MountSelectorModal';
import { InputModal } from '../UI/InputModal';
import { cn, getAgeBgStyle, getAgeBorderStyle, getInventoryIconStyle } from '../../lib/utils';
import { getItemImage } from '../../utils/itemAssets';
import { useGameData } from '../../hooks/useGameData';
import { AGES } from '../../utils/constants';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { useSetBonuses } from '../../hooks/useSetBonuses';
import { formatSecondaryStat } from '../../utils/statNames';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';


// InventoryTextures.png is a 4x4 sprite sheet (512x512, each icon 128x128)
// Row 1: Helmet(0), Armor(1), Gloves(2), Necklace(3)
// Row 2: Ring(4), Weapon(5), Shoes(6), Belt(7)
// Row 3: Mount(8), ...

const SLOTS: { key: keyof UserProfile['items']; label: string }[] = [
    // Row 1
    { key: 'Helmet', label: 'Helmet' },
    { key: 'Body', label: 'Armor' },
    { key: 'Gloves', label: 'Gloves' },
    { key: 'Necklace', label: 'Necklace' },
    { key: 'Ring', label: 'Ring' },
    // Row 2
    { key: 'Weapon', label: 'Weapon' },
    { key: 'Shoe', label: 'Shoe' },
    { key: 'Belt', label: 'Belt' },
];

// Map profile slot keys to item file slot names
const SLOT_TO_FILE_MAP: Record<string, string> = {
    'Weapon': 'Weapon',
    'Helmet': 'Headgear',
    'Body': 'Armor',
    'Gloves': 'Glove',
    'Belt': 'Belt',
    'Necklace': 'Neck',
    'Ring': 'Ring',
    'Shoe': 'Foot',
};


// Slot to tech bonus mapping
const SLOT_TO_TECH_BONUS: Record<string, string> = {
    'Weapon': 'WeaponBonus',
    'Helmet': 'HelmetBonus',
    'Body': 'BodyBonus',
    'Gloves': 'GloveBonus',
    'Belt': 'BeltBonus',
    'Necklace': 'NecklaceBonus',
    'Ring': 'RingBonus',
    'Shoe': 'ShoeBonus'
};

// Slot to JSON type for ItemBalancingLibrary
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

const SLOT_TYPE_ID_MAP: Record<string, number> = {
    'Helmet': 0,
    'Body': 1,
    'Gloves': 2,
    'Necklace': 3,
    'Ring': 4,
    'Weapon': 5,
    'Shoe': 6,
    'Belt': 7
};

// Map Set IDs to Icon filenames (same as Skins.tsx)
const SET_ICONS: Record<string, string> = {
    'SantaSet': 'SteppingStoneCharIcon0.png',
    'SnowmanSet': 'SteppingStoneCharIcon1.png',
    'SkiSet': 'SteppingStoneCharIcon2.png'
};

interface EquipmentPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    showCompareButton?: boolean;
    compareItems?: UserProfile['items'] | null;
    compareMount?: MountSlot | null;
}

export function EquipmentPanel({ variant = 'default', title, showCompareButton = true, compareItems, compareMount }: EquipmentPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { isComparing, originalItems, testItems, updateOriginalItem, updateTestItem, enterCompareMode } = useComparison();
    const [selectedSlot, setSelectedSlot] = useState<keyof UserProfile['items'] | null>(null);
    const [itemToSave, setItemToSave] = useState<{ slot: keyof UserProfile['items']; item: ItemSlot } | null>(null);

    // Determine which items to use based on variant
    const items = useMemo(() => {
        if (variant === 'original' && originalItems) return originalItems;
        if (variant === 'test' && testItems) return testItems;
        return profile.items;
    }, [variant, originalItems, testItems, profile.items]);

    const handleEquip = (item: ItemSlot | null) => {
        if (selectedSlot) {
            if (variant === 'original') {
                updateOriginalItem(selectedSlot, item);
            } else if (variant === 'test') {
                updateTestItem(selectedSlot, item);
            } else {
                updateNestedProfile('items', { [selectedSlot]: item });
            }
        }
        setSelectedSlot(null);
    };

    const handleUnequip = (slotKey: keyof UserProfile['items'], e: React.MouseEvent) => {
        e.stopPropagation();
        if (variant === 'original') {
            updateOriginalItem(slotKey, null);
        } else if (variant === 'test') {
            updateTestItem(slotKey, null);
        } else {
            updateNestedProfile('items', { [slotKey]: null });
        }
    };

    // Check if items differ for golden border (only in test panel)
    const itemsDiffer = (slotKey: keyof UserProfile['items']): boolean => {
        if (variant !== 'test' || !compareItems) return false;
        const testItem = items[slotKey];
        const originalItem = compareItems[slotKey];

        // Both null = same
        if (!testItem && !originalItem) return false;
        // One null, other not = different
        if (!testItem || !originalItem) return true;
        // Compare key fields
        if (testItem.age !== originalItem.age) return true;
        if (testItem.idx !== originalItem.idx) return true;
        if (testItem.level !== originalItem.level) return true;
        if (testItem.rarity !== originalItem.rarity) return true;
        // Deep compare secondary stats
        if (JSON.stringify(testItem.secondaryStats) !== JSON.stringify(originalItem.secondaryStats)) return true;
        return false;
    };

    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');

    // Helper to calculate item perfection (avg of secondary stats vs max)
    const getPerfection = (item: ItemSlot): number | null => {
        if (!item.secondaryStats || item.secondaryStats.length === 0 || !secondaryStatLibrary) return null;

        let totalPercent = 0;
        let count = 0;

        for (const stat of item.secondaryStats) {
            const libStat = secondaryStatLibrary[stat.statId];
            if (libStat && libStat.UpperRange > 0) {
                // Determine scale: simple check
                // If library UpperRange is small (e.g. 0.25) and stored value is large (e.g. 25), assume stored is %.
                // Based on ItemSelectorModal logic, stored values are % (0-100).
                const maxVal = libStat.UpperRange * 100;

                // Avoid division by zero
                if (maxVal > 0) {
                    const percent = (stat.value / maxVal) * 100;
                    totalPercent += Math.min(100, percent); // Cap at 100% just in case
                    count++;
                }
            }
        }

        return count > 0 ? totalPercent / count : null;
    };

    // Helper for individual stat perfection
    const getStatPerfection = (statIdx: string, value: number): number | null => {
        if (!secondaryStatLibrary) return null;
        const libStat = secondaryStatLibrary[statIdx];
        if (libStat && libStat.UpperRange > 0) {
            return Math.min(100, (value / (libStat.UpperRange * 100)) * 100);
        }
        return null;
    };

    // Get tech tree modifiers
    const techModifiers = useTreeModifiers();
    const levelScaling = itemBalancingConfig?.LevelScalingBase || 1.01;
    const meleeBaseMulti = itemBalancingConfig?.PlayerMeleeDamageMultiplier || 1.6;

    // Calculate item stats with tech tree bonus
    // For weapons: includes melee base multiplier (1.6x) to match in-game display
    const getItemStats = (item: ItemSlot | null, slotKey: string) => {
        if (!item || !itemBalancingLibrary) return { damage: 0, health: 0, bonus: 0, isMelee: true };

        const jsonType = SLOT_TO_JSON_TYPE[slotKey] || slotKey;
        const key = `{'Age': ${item.age}, 'Type': '${jsonType}', 'Idx': ${item.idx}}`;
        const itemData = itemBalancingLibrary[key];

        if (!itemData?.EquipmentStats) return { damage: 0, health: 0, bonus: 0, isMelee: true };

        // Check if weapon is melee (for applying melee base multiplier)
        // Melee = AttackRange < 1, Ranged = AttackRange >= 1
        let isMelee = false; // Default to false until confirmed
        if (slotKey === 'Weapon' && weaponLibrary) {
            const weaponKey = `{'Age': ${item.age}, 'Type': 'Weapon', 'Idx': ${item.idx}}`;
            const weaponData = weaponLibrary[weaponKey];
            // Melee if AttackRange < 1
            if (weaponData && (weaponData.AttackRange ?? 0) < 1) {
                isMelee = true;
            }
        }

        const bonusKey = SLOT_TO_TECH_BONUS[slotKey];
        const bonus = techModifiers[bonusKey] || 0;

        let damage = 0;
        let health = 0;

        for (const stat of itemData.EquipmentStats) {
            const statType = stat.StatNode?.UniqueStat?.StatType;
            let value = stat.Value || 0;

            // Level scaling
            const levelExp = Math.max(0, item.level - 1);
            value = value * Math.pow(levelScaling, levelExp);

            // Tech tree bonus
            value = value * (1 + bonus);

            if (statType === 'Damage') damage += value;
            if (statType === 'Health') health += value;
        }

        if (slotKey === 'Weapon' && isMelee && damage > 0) {
            damage = damage * meleeBaseMulti;
        }

        // Apply Skin Multipliers
        let skinBonuses = { damage: 0, health: 0 };
        if (item.skin && item.skin.stats) {
            const skinDamage = item.skin.stats['Damage'] || 0;
            const skinHealth = item.skin.stats['Health'] || 0;

            if (skinDamage) {
                damage *= (1 + skinDamage);
            }
            if (skinHealth) {
                health *= (1 + skinHealth);
            }
            skinBonuses = { damage: skinDamage, health: skinHealth };
        }

        return { damage, health, bonus, skinBonuses, isMelee };
    };

    const getEquippedImage = (slotKey: string, item: ItemSlot | null): string | null => {
        if (!item) return null;
        const ageName = AGES[item.age] || 'Primitive';
        const fileSlot = SLOT_TO_FILE_MAP[slotKey] || slotKey;
        return getItemImage(ageName, fileSlot, item.idx, autoMapping);
    };

    const getItemName = (slotKey: string, item: ItemSlot | null) => {
        if (!item || !autoMapping) return slotKey;
        const typeId = SLOT_TYPE_ID_MAP[slotKey];
        if (typeId === undefined) return slotKey;

        // Key format: Age_Type_Idx e.g. "0_0_0"
        const key = `${item.age}_${typeId}_${item.idx}`;
        return autoMapping[key]?.ItemName || slotKey;
    };

    // Check if item is saved
    const isItemSaved = (slot: string, item: ItemSlot | null) => {
        if (!item || !profile.savedItems || !profile.savedItems[slot]) return false;
        return profile.savedItems[slot].some(s =>
            s.age === item.age &&
            s.idx === item.idx &&
            s.level === item.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(item.secondaryStats)
        );
    };

    const handleSaveItemPreset = (name: string) => {
        if (!itemToSave) return;
        const { slot, item } = itemToSave;
        const savedList = profile.savedItems?.[slot] || [];

        const existingIdx = savedList.findIndex(s =>
            s.age === item.age &&
            s.idx === item.idx &&
            s.level === item.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(item.secondaryStats)
        );

        if (existingIdx >= 0) {
            // Update
            const newSaved = [...savedList];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('savedItems', { [slot]: newSaved });
        } else {
            // Add new
            const newItem = { ...item, customName: name || undefined };
            updateNestedProfile('savedItems', { [slot]: [...savedList, newItem] });
        }
        setItemToSave(null);
    };

    const getSaveModalProps = () => {
        if (!itemToSave) return { title: '', label: '', initialValue: '' };
        const { slot, item } = itemToSave;
        const savedList = profile.savedItems?.[slot] || [];

        const existingMatch = savedList.find(s =>
            s.age === item.age &&
            s.idx === item.idx &&
            s.level === item.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(item.secondaryStats)
        );

        const baseName = getItemName(slot, item);

        if (existingMatch) {
            return { title: 'Update Saved Preset', label: 'Preset Name (Already Saved)', initialValue: existingMatch.customName || baseName };
        }
        return { title: 'Save Item Preset', label: 'Preset Name', initialValue: baseName };
    };

    const saveModalProps = getSaveModalProps();

    const panelTitle = title || 'Equipment';

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <img src="./Texture2D/IconDivineArmorPaladinarmor.png" alt="Equipment" className="w-8 h-8 object-contain" />
                    {panelTitle}
                </h2>
                {showCompareButton && !isComparing && variant === 'default' && (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={enterCompareMode}
                        className="shadow-lg shadow-accent-primary/20 animate-pulse-subtle"
                    >
                        <GitCompare className="w-4 h-4 mr-2" />
                        Compare Build
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {SLOTS.map((slot) => {
                    const equipped = items[slot.key];
                    const itemImage = getEquippedImage(slot.key, equipped);
                    const inventoryStyle = getInventoryIconStyle(slot.key, 48);
                    const hasDiff = itemsDiffer(slot.key);

                    return (
                        <div
                            key={slot.key}
                            onClick={() => setSelectedSlot(slot.key)}
                            className={cn(
                                "h-full min-h-[160px] rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-colors relative flex flex-col items-center p-1.5 gap-1 group",
                                equipped ? "border-solid bg-bg-secondary" : "bg-bg-input/30 justify-center",
                                hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
                            )}
                        >
                            {equipped ? (
                                <>
                                    {/* Top Row: Level (Left) and Unequip (Right) */}
                                    <div className="absolute top-1 left-1 z-10">
                                        <span className="bg-black/60 text-white text-[11px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10">
                                            Lv{equipped.level}
                                        </span>
                                    </div>

                                    <button
                                        onClick={(e) => handleUnequip(slot.key, e)}
                                        className="absolute top-1 right-1 z-20 p-1 bg-red-500/80 hover:bg-red-500 rounded-lg transition-opacity shadow-sm"
                                        title="Unequip"
                                    >
                                        <X className="w-3 h-3 text-white" />
                                    </button>

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setItemToSave({ slot: slot.key, item: equipped });
                                        }}
                                        className={cn(
                                            "absolute top-1 right-6 z-20 p-1 rounded-lg transition-opacity shadow-sm border border-transparent hover:border-border",
                                            isItemSaved(slot.key, equipped) ? "bg-accent-primary text-white" : "bg-bg-input text-text-muted hover:text-text-primary"
                                        )}
                                        title={isItemSaved(slot.key, equipped) ? "Update Saved Preset" : "Save as Preset"}
                                    >
                                        <Bookmark className={cn("w-3 h-3", isItemSaved(slot.key, equipped) && "fill-white")} />
                                    </button>

                                    {/* Icon - Centered with top margin for badges */}
                                    <div className="mt-4 shrink-0 relative">
                                        <div
                                            className="w-12 h-12 rounded-lg flex items-center justify-center border-2 shrink-0 bg-bg-primary/50"
                                            style={{ ...getAgeBgStyle(equipped.age), ...getAgeBorderStyle(equipped.age) }}
                                        >
                                            {itemImage ? (
                                                <img
                                                    src={itemImage}
                                                    alt={slot.label}
                                                    className="w-10 h-10 object-contain drop-shadow"
                                                    onError={(e) => {
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                inventoryStyle && (
                                                    <div style={inventoryStyle} className="opacity-70 scale-90" />
                                                )
                                            )}
                                        </div>
                                        {equipped.skin ? (
                                            <div className="absolute -bottom-2 -right-2 z-20 w-8 h-8 rounded-md bg-bg-secondary border border-accent-primary shadow-sm overflow-hidden" title={`Skin ID: ${equipped.skin.idx}`}>
                                                {(() => {
                                                    // Calculate sprite position for skin icon
                                                    // This logic mimics ItemSelectorModal and Skins.tsx
                                                    const skinId = equipped.skin.idx;
                                                    // We need a helper or context to get global sorted index for precise sprite pos,
                                                    // but for now, let's try to map it if possible or just use the generic icon.
                                                    // Actually, without the full sorted list context, accurate sprite mapping is hard locally.
                                                    // Let's use a simplified approach or generic skin icon if specific mapping is complex.
                                                    // Ideally we should export getVisualOrder/sortedGlobalSkins logic.

                                                    // For now, let's display a styled indicator that looks better than "S"
                                                    // Or better: Show the Skin Icon if we can calculate the background position.
                                                    // Since we don't have the SkinsLibrary here easily without extra fetch, 
                                                    // let's stick to a robust visual indicator or fetch it.
                                                    // Wait, we can use the same logic if we pass the mapping or use a helper.

                                                    return (
                                                        <div className="w-full h-full flex items-center justify-center bg-accent-primary/20">
                                                            <div
                                                                className="w-full h-full opacity-80"
                                                                style={{
                                                                    backgroundImage: 'url(./Texture2D/SkinsUiIcons.png)',
                                                                    backgroundSize: '400% 400%',
                                                                    backgroundPosition: (() => {
                                                                        if (!skinsLibrary) return 'center';

                                                                        const allSkins = Object.values(skinsLibrary);
                                                                        // Sort using same getVisualOrder logic as Skins.tsx
                                                                        const getVisualOrder = (idx: number) => {
                                                                            if (idx === 0) return 0;
                                                                            if (idx === 2) return 1;
                                                                            if (idx === 1) return 2;
                                                                            return 10 + idx;
                                                                        };
                                                                        const sortedSkins = [...allSkins].sort((a: any, b: any) => {
                                                                            const orderA = getVisualOrder(a.SkinId.Idx);
                                                                            const orderB = getVisualOrder(b.SkinId.Idx);
                                                                            if (orderA !== orderB) return orderA - orderB;

                                                                            const isHelmetA = a.SkinId.Type === 'Helmet';
                                                                            const isHelmetB = b.SkinId.Type === 'Helmet';
                                                                            if (isHelmetA && !isHelmetB) return -1;
                                                                            if (!isHelmetA && isHelmetB) return 1;
                                                                            return 0;
                                                                        });

                                                                        const globalIndex = sortedSkins.findIndex((s: any) =>
                                                                            s.SkinId.Idx === equipped.skin!.idx &&
                                                                            s.SkinId.Type === (equipped.skin!.type || SLOT_TO_JSON_TYPE[slot.key] || slot.key)
                                                                        );

                                                                        if (globalIndex === -1) return 'center';

                                                                        const SPRITE_COLS = 4;
                                                                        const SPRITE_ROWS = 4;
                                                                        const col = globalIndex % SPRITE_COLS;
                                                                        const row = Math.floor(globalIndex / SPRITE_COLS);

                                                                        const bgX = (col * 100) / (SPRITE_COLS - 1);
                                                                        const bgY = (row * 100) / (SPRITE_ROWS - 1);

                                                                        return `${Number.isNaN(bgX) ? 0 : bgX}% ${Number.isNaN(bgY) ? 0 : bgY}%`;
                                                                    })(),
                                                                    imageRendering: 'pixelated'
                                                                }}
                                                            />
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        ) : null}
                                    </div>

                                    {/* Name - Below Icon */}
                                    <div className="w-full px-0.5 min-h-[1.5em] flex items-center justify-center">
                                        {(() => {
                                            const name = getItemName(slot.key, equipped);
                                            const fontSizeClass = name.length > 20 ? "text-[10px]" : name.length > 15 ? "text-[11px]" : "text-xs";
                                            return (
                                                <span className={cn("font-bold text-center leading-tight line-clamp-2", fontSizeClass)}>
                                                    {name}
                                                </span>
                                            );
                                        })()}
                                    </div>

                                    {/* Main Stats - Compact & Wrapping */}
                                    <div className="w-full bg-bg-input/30 rounded p-1 flex flex-col items-center justify-center gap-0.5">
                                        {(() => {
                                            const stats = getItemStats(equipped, slot.key);
                                            return (
                                                <div className="text-[11px] font-mono text-center leading-normal w-full">
                                                    {stats.damage > 0 && (
                                                        <div className="text-red-400 break-words flex flex-col items-center">
                                                            <span>⚔️{Math.round(stats.damage).toLocaleString()}</span>
                                                            <div className="flex gap-1 flex-wrap justify-center font-bold">
                                                                {stats.bonus > 0 && <span className="text-green-400 text-[10px]">(+{Math.round(stats.bonus * 100)}%)</span>}
                                                                {stats.skinBonuses?.damage > 0 && <span className="text-accent-primary text-[10px]">(+{Math.round(stats.skinBonuses.damage * 100)}% S)</span>}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {stats.health > 0 && (
                                                        <div className="text-green-400 break-words flex flex-col items-center mt-0.5">
                                                            <span>♥{Math.round(stats.health).toLocaleString()}</span>
                                                            <div className="flex gap-1 flex-wrap justify-center font-bold">
                                                                {stats.bonus > 0 && <span className="text-green-400 text-[10px]">(+{Math.round(stats.bonus * 100)}%)</span>}
                                                                {stats.skinBonuses?.health > 0 && <span className="text-accent-primary text-[10px]">(+{Math.round(stats.skinBonuses.health * 100)}% S)</span>}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* Secondary Stats - Bottom list */}
                                    {equipped.secondaryStats && equipped.secondaryStats.length > 0 && (
                                        <div className="w-full mt-auto pt-1 border-t border-border/30 flex flex-col gap-0.5">
                                            {equipped.secondaryStats.map((stat, idx) => {
                                                const formatted = formatSecondaryStat(stat.statId, stat.value);
                                                const statPerf = getStatPerfection(stat.statId, stat.value);
                                                return (
                                                    <div key={idx} className={cn("flex justify-between items-start text-[10px] leading-tight gap-1", formatted.color)}>
                                                        <span className="whitespace-normal break-words text-left opacity-80 flex-1">{formatted.name}</span>
                                                        <span className="font-bold shrink-0 flex items-center gap-0.5">
                                                            {formatted.formattedValue}
                                                            {statPerf !== null && (
                                                                <span className={cn(
                                                                    "text-[9px]",
                                                                    statPerf >= 100 ? "text-yellow-400" :
                                                                        statPerf >= 80 ? "text-green-500" :
                                                                            statPerf >= 50 ? "text-blue-400" : "text-gray-500"
                                                                )}>
                                                                    ({statPerf.toFixed(0)}%)
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                );
                                            })}

                                            {/* Perfection Bar */}
                                            {(() => {
                                                const perfection = getPerfection(equipped);
                                                if (perfection !== null) {
                                                    const colorClass = perfection >= 100 ? 'bg-yellow-400' :
                                                        perfection >= 80 ? 'bg-green-500' :
                                                            perfection >= 50 ? 'bg-blue-500' : 'bg-gray-500';

                                                    return (
                                                        <div className="w-full mt-1 flex flex-col gap-0.5" title={`Perfection: ${perfection.toFixed(1)}%`}>
                                                            <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full ${colorClass}`}
                                                                    style={{ width: `${Math.min(100, perfection)}%` }}
                                                                />
                                                            </div>
                                                            <div className="text-[9px] text-right text-text-muted leading-none">
                                                                {perfection.toFixed(0)}% Perfect
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    {inventoryStyle ? (
                                        <div style={inventoryStyle} className="opacity-30 group-hover:opacity-50 transition-opacity mb-2" />
                                    ) : (
                                        <div className="w-12 h-12 bg-bg-input rounded-lg mb-2" />
                                    )}
                                    <span className="text-sm text-text-muted font-bold text-center">{slot.label}</span>
                                    <span className="text-xs text-text-muted/50 text-center">Empty Slot</span>
                                </>
                            )}
                        </div>
                    );
                })}

                {/* Mount Slot - spans 2 columns */}
                <MountSlotWidget variant={variant} compareMount={compareMount} />
            </div>

            {
                selectedSlot && (
                    <ItemSelectorModal
                        isOpen={!!selectedSlot}
                        onClose={() => setSelectedSlot(null)}
                        onSelect={handleEquip}
                        slot={selectedSlot}
                        current={items[selectedSlot]}
                    />
                )
            }

            <InputModal
                isOpen={!!itemToSave}
                title={saveModalProps.title}
                label={saveModalProps.label}
                placeholder="Preset Name"
                initialValue={saveModalProps.initialValue}
                onConfirm={handleSaveItemPreset}
                onCancel={() => setItemToSave(null)}
            />
        </Card>
    );
}

// Inline Mount Slot Widget with all mount data
interface MountSlotWidgetProps {
    variant?: 'default' | 'original' | 'test';
    compareMount?: MountSlot | null;
}

function MountSlotWidget({ variant = 'default', compareMount }: MountSlotWidgetProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { originalMount, testMount, updateOriginalMount, updateTestMount } = useComparison();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    // Get the correct mount based on variant
    const mount = useMemo(() => {
        if (variant === 'original' && originalMount !== null) return originalMount;
        if (variant === 'test' && testMount !== null) return testMount;
        if (variant === 'original' || variant === 'test') return variant === 'original' ? originalMount : testMount;
        return profile.mount.active;
    }, [variant, originalMount, testMount, profile.mount.active]);

    // Tech tree bonuses
    const techModifiers = useTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;

    // Helper to calculate item perfection (avg of secondary stats vs max)
    const getPerfection = (item: any): number | null => {
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

        return count > 0 ? (totalPercent * 100) / count : null;
    };

    const getStatPerfection = (statIdx: string, value: number): number | null => {
        if (!secondaryStatLibrary) return null;
        const libStat = secondaryStatLibrary[statIdx];
        if (libStat && libStat.UpperRange > 0) {
            return Math.min(100, (value / (libStat.UpperRange * 100)) * 100);
        }
        return null;
    };

    // Check if current mount matches a saved build
    const isSaved = useMemo(() => {
        if (!mount || !profile.mount.savedBuilds) return false;
        return profile.mount.savedBuilds.some(saved =>
            saved.id === mount.id &&
            saved.rarity === mount.rarity &&
            saved.level === mount.level &&
            JSON.stringify(saved.secondaryStats) === JSON.stringify(mount.secondaryStats)
        );
    }, [mount, profile.mount.savedBuilds]);

    const handleSelectMount = (rarity: string, id: number, level: number, secondaryStats: { statId: string; value: number }[]) => {
        const newMount: MountSlot = {
            rarity,
            id,
            level,
            evolution: 0,
            skills: [],
            secondaryStats
        };
        if (variant === 'original') {
            updateOriginalMount(newMount);
        } else if (variant === 'test') {
            updateTestMount(newMount);
        } else {
            updateNestedProfile('mount', { active: newMount });
        }
        setIsModalOpen(false);
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (variant === 'original') {
            updateOriginalMount(null);
        } else if (variant === 'test') {
            updateTestMount(null);
        } else {
            updateNestedProfile('mount', { active: null });
        }
    };

    const handleSavePreset = (name: string) => {
        if (!mount) return;
        const saved = profile.mount.savedBuilds || [];

        const existingIdx = saved.findIndex(s =>
            s.id === mount.id && s.rarity === mount.rarity && s.level === mount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(mount.secondaryStats)
        );

        if (existingIdx >= 0) {
            // Update
            const newSaved = [...saved];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('mount', { savedBuilds: newSaved });
        } else {
            const newPreset = { ...mount, customName: name || undefined };
            updateNestedProfile('mount', { savedBuilds: [...saved, newPreset] });
        }
        setIsSaveModalOpen(false);
    };

    const handleLevelChange = (delta: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!mount) return;
        const newLevel = Math.max(1, Math.min(100, mount.level + delta));
        const updatedMount = { ...mount, level: newLevel };
        if (variant === 'original') {
            updateOriginalMount(updatedMount);
        } else if (variant === 'test') {
            updateTestMount(updatedMount);
        } else {
            updateNestedProfile('mount', { active: updatedMount });
        }
    };

    // Corrected sprite lookup - matching MountPanel.tsx
    const getSpriteInfo = (mountId: number, rarity: string) => {
        if (!spriteMapping?.mounts?.mapping) return null;
        const entry = Object.entries(spriteMapping.mounts.mapping).find(([_, val]: [string, any]) => val.id === mountId && val.rarity === rarity);
        if (entry) {
            return {
                spriteIndex: parseInt(entry[0]),
                config: spriteMapping.mounts,
                name: (entry[1] as any).name
            };
        }
        return null;
    };

    // Get mount stats from library
    const getMountStats = () => {
        if (!mount || !mountUpgradeLibrary) return { damage: 0, health: 0, damageBonus: 0, healthBonus: 0 };
        const upgradeData = mountUpgradeLibrary[mount.rarity];
        if (!upgradeData?.LevelInfo) return { damage: 0, health: 0, damageBonus: 0, healthBonus: 0 };

        const targetLevel = Math.max(0, mount.level - 1);
        const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === targetLevel) || upgradeData.LevelInfo[0];

        let damage = 0, health = 0;
        if (levelInfo?.MountStats?.Stats) {
            levelInfo.MountStats.Stats.forEach((stat: any) => {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                const value = stat.Value || 0;
                if (statType === 'Damage') damage = value;
                if (statType === 'Health') health = value;
            });
        }

        // Apply tech tree bonuses
        const finalDamage = damage * (1 + mountDamageBonus);
        const finalHealth = health * (1 + mountHealthBonus);

        return {
            damage: finalDamage,
            health: finalHealth,
            damageBonus: mountDamageBonus,
            healthBonus: mountHealthBonus
        };
    };


    const spriteInfo = mount ? getSpriteInfo(mount.id, mount.rarity) : null;
    const mountStats = mount ? getMountStats() : null;

    const getModalProps = () => {
        if (!mount) return { title: '', label: '', initialValue: '' };

        const saved = profile.mount.savedBuilds || [];
        const match = saved.find(s =>
            s.id === mount.id && s.rarity === mount.rarity && s.level === mount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(mount.secondaryStats)
        );

        const baseName = spriteInfo?.name || `Mount ${mount.id}`;

        if (match) {
            return { title: 'Update Saved Preset', label: 'Preset Name (Already Saved)', initialValue: match.customName || baseName };
        }
        return { title: 'Save Mount Preset', label: 'Preset Name', initialValue: baseName };

    };

    const modalProps = getModalProps();

    // Check if mount differs from compareMount (for golden border in test panel)
    const mountDiffers = (): boolean => {
        if (variant !== 'test' || compareMount === undefined) return false;
        // Both null = same
        if (!mount && !compareMount) return false;
        // One null, other not = different
        if (!mount || !compareMount) return true;
        // Compare key fields
        if (mount.id !== compareMount.id) return true;
        if (mount.rarity !== compareMount.rarity) return true;
        if (mount.level !== compareMount.level) return true;
        // Deep compare secondary stats
        if (JSON.stringify(mount.secondaryStats) !== JSON.stringify(compareMount.secondaryStats)) return true;
        return false;
    };

    const isDifferent = mountDiffers();

    return (
        <>
            <div
                onClick={() => setIsModalOpen(true)}
                className={cn(
                    "col-span-2 sm:col-span-2 md:col-span-2 rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-colors relative flex flex-col gap-2 p-3 group min-h-[160px]",
                    mount ? "border-solid bg-bg-secondary" : "bg-bg-input/30",
                    isDifferent && "border-yellow-400 border-solid shadow-[0_0_12px_rgba(250,204,21,0.4)]"
                )}
            >
                {mount ? (
                    <div className="flex flex-col items-center gap-2 w-full pt-2 relative">
                        {/* Buttons - Top Right */}
                        <div className="absolute top-0 right-0 z-10 flex gap-1">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsSaveModalOpen(true); }}
                                className={cn(
                                    "p-1.5 rounded-lg transition-opacity border border-transparent hover:border-border",
                                    isSaved ? "bg-accent-primary text-white" : "bg-bg-input text-text-muted hover:text-text-primary"
                                )}
                                title={isSaved ? "Update Saved Preset" : "Save as Preset"}
                            >
                                <Bookmark className={cn("w-3.5 h-3.5", isSaved && "fill-white")} />
                            </button>
                            <button
                                onClick={handleRemove}
                                className="p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white transition-opacity shadow-sm"
                                title="Remove Mount"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* Icon - Centered */}
                        <div className="mt-2 shrink-0 relative">
                            <div
                                className={cn(
                                    "w-16 h-16 rounded-xl flex items-center justify-center shrink-0 border-2 bg-bg-primary/50",
                                    `border-rarity-${mount.rarity.toLowerCase()}`
                                )}
                            >
                                {spriteInfo ? (
                                    <SpriteSheetIcon
                                        textureSrc="./icons/game/MountIcons.png"
                                        spriteWidth={spriteInfo.config.sprite_size.width}
                                        spriteHeight={spriteInfo.config.sprite_size.height}
                                        sheetWidth={spriteInfo.config.texture_size.width}
                                        sheetHeight={spriteInfo.config.texture_size.height}
                                        iconIndex={spriteInfo.spriteIndex}
                                        className="w-14 h-14"
                                    />
                                ) : (
                                    <div style={getInventoryIconStyle('Mount', 48) || {}} className="opacity-70 scale-110" />
                                )}
                            </div>
                        </div>

                        {/* Level Controls - Centered below icon */}
                        <div className="flex items-center justify-center gap-1 bg-bg-input/50 rounded-lg p-1 border border-border/30">
                            <button
                                onClick={(e) => handleLevelChange(-1, e)}
                                className="w-8 h-6 flex items-center justify-center bg-bg-input hover:bg-bg-secondary rounded text-text-muted hover:text-text-primary transition-colors font-bold"
                            >-</button>
                            <span className="text-sm font-mono font-bold w-12 text-center">Lv{mount.level}</span>
                            <button
                                onClick={(e) => handleLevelChange(1, e)}
                                className="w-8 h-6 flex items-center justify-center bg-bg-input hover:bg-bg-secondary rounded text-text-muted hover:text-text-primary transition-colors font-bold"
                            >+</button>
                        </div>

                        {/* Name - Centered */}
                        {/* Name - Centered */}
                        <div className={cn(
                            "font-bold leading-tight text-center break-words whitespace-normal w-full px-2 transition-[font-size]",
                            `text-rarity-${mount.rarity.toLowerCase()}`,
                            (spriteInfo?.name || "").length > 20 ? "text-xs" : "text-sm"
                        )}>
                            {spriteInfo?.name || `${mount.rarity} Mount #${mount.id}`}
                        </div>

                        {/* Base Stats (DMG/HP) - Side by side on larger screens */}
                        {mountStats && (mountStats.damage > 0 || mountStats.health > 0) && (
                            <div className="w-full bg-bg-input/30 rounded p-2 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 max-w-[95%] font-mono text-xs">
                                {mountStats.damage > 0 && (
                                    <div className="text-red-400 flex flex-col items-center">
                                        <span>DMG +{(mountStats.damage * 100).toFixed(2)}%</span>
                                        {mountStats.damageBonus > 0 && (
                                            <span className="text-green-400 text-[11px]">(+{(mountStats.damageBonus * 100).toFixed(0)}%)</span>
                                        )}
                                    </div>
                                )}
                                {mountStats.health > 0 && (
                                    <div className="text-green-400 flex flex-col items-center">
                                        <span>HP +{(mountStats.health * 100).toFixed(2)}%</span>
                                        {mountStats.healthBonus > 0 && (
                                            <span className="text-green-400 text-[11px]">(+{(mountStats.healthBonus * 100).toFixed(0)}%)</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Secondary Stats (Passives) - Full Width List */}
                        {mount.secondaryStats && mount.secondaryStats.length > 0 && (
                            <div className="w-full mt-1 pt-2 border-t border-border/30 flex flex-col gap-1.5 px-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                                    {mount.secondaryStats.map((stat: any, idx: number) => {
                                        const formatted = formatSecondaryStat(stat.statId, stat.value);
                                        return (
                                            <div key={idx} className="text-xs flex items-start justify-between gap-2 border-b border-border/10 pb-0.5 last:border-0">
                                                <span className="text-text-muted text-left whitespace-normal break-words flex-1 leading-tight">{formatted.name}</span>
                                                <span className={cn("font-mono font-bold shrink-0 flex items-center gap-1", formatted.color)}>
                                                    {formatted.formattedValue}
                                                    {(() => {
                                                        const statPerf = getStatPerfection(stat.statId, stat.value * 100);
                                                        if (statPerf !== null) {
                                                            return (
                                                                <span className={cn(
                                                                    "text-[10px] opacity-80",
                                                                    statPerf >= 100 ? "text-yellow-400" :
                                                                        statPerf >= 80 ? "text-green-500" :
                                                                            statPerf >= 50 ? "text-blue-400" : "text-gray-500"
                                                                )}>
                                                                    ({statPerf.toFixed(0)}%)
                                                                </span>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Perfection Bar */}
                                {(() => {
                                    const perfection = getPerfection(mount);
                                    if (perfection !== null) {
                                        const colorClass = perfection >= 100 ? 'bg-yellow-400' :
                                            perfection >= 80 ? 'bg-green-500' :
                                                perfection >= 50 ? 'bg-blue-500' : 'bg-gray-500';

                                        return (
                                            <div className="w-full mt-1 flex flex-col gap-0.5" title={`Perfection: ${perfection.toFixed(1)}%`}>
                                                <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full ${colorClass}`}
                                                        style={{ width: `${Math.min(100, perfection)}%` }}
                                                    />
                                                </div>
                                                <div className="text-[9px] text-right text-text-muted leading-none">
                                                    {perfection.toFixed(0)}% Perfect
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center w-full gap-3">
                        <div style={getInventoryIconStyle('Mount', 48) || {}} className="opacity-30 group-hover:opacity-50 transition-opacity" />
                        <span className="text-sm text-text-muted">Click to select Mount</span>
                    </div>
                )}
            </div >

            <MountSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleSelectMount}
                currentMount={mount}
            />

            <InputModal
                isOpen={isSaveModalOpen}
                title={modalProps.title}
                label={modalProps.label}
                placeholder="Preset Name"
                initialValue={modalProps.initialValue}
                onConfirm={handleSavePreset}
                onCancel={() => setIsSaveModalOpen(false)}
            />
        </>
    );
}
