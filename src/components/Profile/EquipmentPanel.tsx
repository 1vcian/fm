import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { GitCompare } from 'lucide-react';
import { ItemSlot, MountSlot, UserProfile } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { ItemSelectorModal } from './ItemSelectorModal';
import { MountSelectorModal } from './MountSelectorModal';
import { InputModal } from '../UI/InputModal';
import { AscensionStars } from '../UI/AscensionStars';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { cn, getInventoryIconStyle } from '../../lib/utils';
import { getItemImage } from '../../utils/itemAssets';
import { useGameData } from '../../hooks/useGameData';
import { AGES } from '../../utils/constants';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';

import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';

import { getItemStats, getPerfection, getStatPerfection } from '../../utils/itemCalculations';

const SLOTS: { key: keyof UserProfile['items']; label: string }[] = [
    { key: 'Helmet', label: 'Helmet' },
    { key: 'Body', label: 'Armor' },
    { key: 'Gloves', label: 'Gloves' },
    { key: 'Necklace', label: 'Necklace' },
    { key: 'Ring', label: 'Ring' },
    { key: 'Weapon', label: 'Weapon' },
    { key: 'Shoe', label: 'Shoe' },
    { key: 'Belt', label: 'Belt' },
];

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

interface EquipmentPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    showCompareButton?: boolean;
    compareItems?: UserProfile['items'] | null;
    isPvp?: boolean;
}

export function EquipmentPanel({ variant = 'default', title, showCompareButton = true, compareItems, isPvp = false }: EquipmentPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { isComparing, originalItems, testItems,
        originalForgeAscension,
        testForgeAscension,
        updateOriginalForgeAscension,
        updateTestForgeAscension,
        updateOriginalItem, updateTestItem, enterCompareMode,
        isCompactStats } = useComparison();
    const [selectedSlot, setSelectedSlot] = useState<keyof UserProfile['items'] | null>(null);
    const [itemToSave, setItemToSave] = useState<{ slot: keyof UserProfile['items']; item: ItemSlot } | null>(null);

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

    const itemsDiffer = (slotKey: keyof UserProfile['items']): boolean => {
        if (variant !== 'test' || !compareItems) return false;
        const testItem = items[slotKey];
        const originalItem = compareItems[slotKey];
        if (!testItem && !originalItem) return false;
        if (!testItem || !originalItem) return true;
        if (testItem.age !== originalItem.age) return true;
        if (testItem.idx !== originalItem.idx) return true;
        if (testItem.level !== originalItem.level) return true;
        if (testItem.rarity !== originalItem.rarity) return true;
        if (JSON.stringify(testItem.secondaryStats) !== JSON.stringify(originalItem.secondaryStats)) return true;
        return false;
    };

    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');

    const techModifiers = useTreeModifiers();

    const forgeAscensionMulti = useMemo(() => {
        let total = 0;
        let ascLevel = profile.misc.forgeAscensionLevel || 0;
        if (isComparing) {
            if (variant === 'original' && originalForgeAscension !== null) ascLevel = originalForgeAscension;
            else if (variant === 'test' && testForgeAscension !== null) ascLevel = testForgeAscension;
        }
        if (ascLevel > 0 && ascensionConfigs?.Forge?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Forge.AscensionConfigPerLevel;
            for (let i = 0; i < ascLevel && i < configs.length; i++) {
                const contributions = configs[i].StatContributions || [];
                for (const stat of contributions) {
                    total += stat.Value;
                    break; 
                }
            }
        }
        return total;
    }, [profile.misc.forgeAscensionLevel, ascensionConfigs, isComparing, variant, originalForgeAscension, testForgeAscension]);

    const globalAscensionLevel = useMemo(() => {
        if (isComparing) {
            if (variant === 'original' && originalForgeAscension !== null) return originalForgeAscension;
            if (variant === 'test' && testForgeAscension !== null) return testForgeAscension;
        }
        return profile.misc.forgeAscensionLevel || 0;
    }, [isComparing, variant, originalForgeAscension, testForgeAscension, profile.misc.forgeAscensionLevel]);

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
        const key = `${item.age}_${typeId}_${item.idx}`;
        return autoMapping[key]?.ItemName || slotKey;
    };

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
            const newSaved = [...savedList];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('savedItems', { [slot]: newSaved });
        } else {
            updateNestedProfile('savedItems', { [slot]: [...savedList, { ...item, customName: name || undefined }] });
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
        <>
            <Card className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/IconDivineArmorPaladinarmor.png`} alt="Equipment" className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
                        {panelTitle}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-2 bg-bg-input/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50">
                            <AscensionStars
                                value={globalAscensionLevel}
                                onChange={(val) => {
                                    if (isComparing) {
                                        if (variant === 'original') updateOriginalForgeAscension(val);
                                        else if (variant === 'test') updateTestForgeAscension(val);
                                    } else {
                                        updateNestedProfile('misc', { forgeAscensionLevel: val });
                                    }
                                }}
                                size="sm"
                            />
                            {forgeAscensionMulti > 0 && (
                                <div className="hidden xs:block text-[9px] sm:text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 px-1 sm:px-1.5 py-0.5 rounded border border-amber-400/20">
                                    x{(forgeAscensionMulti + 1).toFixed(1)}
                                </div>
                            )}
                        </div>
                        {showCompareButton && !isComparing && variant === 'default' && (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={enterCompareMode}
                                className="shadow-lg shadow-accent-primary/20 animate-pulse-subtle flex-1 sm:flex-none py-1.5"
                            >
                                <GitCompare className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                                <span className="text-xs sm:text-sm">Compare Build</span>
                            </Button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {SLOTS.map((slot) => {
                        const equipped = items[slot.key];
                        const itemImage = getEquippedImage(slot.key, equipped);
                        const inventoryStyle = getInventoryIconStyle(slot.key, 48);
                        const hasDiff = itemsDiffer(slot.key);

                        if (!equipped) {
                            return (
                                <div
                                    key={slot.key}
                                    onClick={() => setSelectedSlot(slot.key)}
                                    className={cn(
                                        "h-full min-h-[160px] rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-colors relative flex flex-col items-center justify-center p-1.5 gap-1 group bg-bg-input/30",
                                        hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
                                    )}
                                >
                                    {inventoryStyle ? (
                                        <div style={inventoryStyle} className="opacity-30 group-hover:opacity-50 transition-opacity mb-2" />
                                    ) : (
                                        <div className="w-12 h-12 bg-bg-input rounded-lg mb-2" />
                                    )}
                                    <span className="text-sm text-text-muted font-bold text-center">{slot.label}</span>
                                    <span className="text-xs text-text-muted/50 text-center">Empty Slot</span>
                                </div>
                            );
                        }

                        return (
                            <ItemSelectionCard
                                key={slot.key}
                                item={equipped}
                                variant={isCompactStats ? 'compact' : 'default'}
                                slotKey={slot.key}
                                slotLabel={slot.label}
                                hasDiff={hasDiff}
                                globalAscensionLevel={globalAscensionLevel}
                                isSaved={isItemSaved(slot.key, equipped)}
                                itemName={getItemName(slot.key, equipped)}
                                itemImage={itemImage}
                                stats={getItemStats(
                                    equipped, 
                                    slot.key, 
                                    { itemBalancingLibrary, itemBalancingConfig, weaponLibrary }, 
                                    { techModifiers, forgeAscensionMulti }
                                )}
                                perfection={getPerfection(equipped, secondaryStatLibrary)}
                                getStatPerfection={(sId, val) => getStatPerfection(sId, val, secondaryStatLibrary)}
                                spriteMapping={spriteMapping}
                                onClick={() => setSelectedSlot(slot.key)}
                                onUnequip={(e) => handleUnequip(slot.key, e)}
                                onAscensionChange={(val) => {
                                    if (isComparing) {
                                        if (variant === 'original') updateOriginalForgeAscension(val);
                                        else if (variant === 'test') updateTestForgeAscension(val);
                                    } else {
                                        updateNestedProfile('misc', { forgeAscensionLevel: val });
                                    }
                                }}
                                onSave={(e) => {
                                    e.stopPropagation();
                                    setItemToSave({ slot: slot.key, item: equipped });
                                }}
                            />
                        );
                    })}

                    <MountSlotWidget variant={variant} isCompact={isCompactStats} />
                </div>
            </Card>

            <ItemSelectorModal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                onSelect={handleEquip}
                slot={selectedSlot || 'Weapon'}
                current={selectedSlot ? items[selectedSlot] : null}
                isPvp={isPvp}
                forgeAscensionLevel={globalAscensionLevel}
            />

            <InputModal
                isOpen={itemToSave !== null}
                title={saveModalProps.title}
                label={saveModalProps.label}
                placeholder="Preset Name"
                initialValue={saveModalProps.initialValue}
                onConfirm={handleSaveItemPreset}
                onCancel={() => setItemToSave(null)}
            />
        </>
    );
}

function MountSlotWidget({ variant, isCompact }: { variant: string; isCompact: boolean }) {
    const { profile, updateNestedProfile } = useProfile();
    const { 
        originalMount, 
        testMount, 
        isComparing,
        originalMountAscension,
        testMountAscension,
        updateOriginalMount, 
        updateTestMount,
        updateOriginalMountAscension,
        updateTestMountAscension
    } = useComparison();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    const mount = useMemo(() => {
        if (variant === 'original' && originalMount !== null) return originalMount;
        if (variant === 'test' && testMount !== null) return testMount;
        return profile.mount.active;
    }, [variant, originalMount, testMount, profile.mount.active]);

    const techModifiers = useTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;

    const isSaved = useMemo(() => {
        if (!mount || !profile.mount.savedBuilds) return false;
        return profile.mount.savedBuilds.some(saved =>
            saved.id === mount.id &&
            saved.rarity === mount.rarity &&
            saved.level === mount.level &&
            JSON.stringify(saved.secondaryStats) === JSON.stringify(mount.secondaryStats)
        );
    }, [mount, profile.mount.savedBuilds]);

    const handleSelectMount = (rarity: string | null, id?: number, level?: number, secondaryStats?: { statId: string; value: number }[]) => {
        if (!rarity || id === undefined) return;
        const newMount: MountSlot = { rarity, id, level: level ?? 1, evolution: 0, skills: [], secondaryStats: secondaryStats ?? [] };
        if (variant === 'original') updateOriginalMount(newMount);
        else if (variant === 'test') updateTestMount(newMount);
        else updateNestedProfile('mount', { active: newMount });
        setIsModalOpen(false);
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (variant === 'original') updateOriginalMount(null);
        else if (variant === 'test') updateTestMount(null);
        else updateNestedProfile('mount', { active: null });
    };

    const handleLevelChange = (delta: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!mount) return;
        const newLevel = Math.max(1, Math.min(100, mount.level + delta));
        if (newLevel === mount.level) return;
        const newMount = { ...mount, level: newLevel };
        if (variant === 'original') updateOriginalMount(newMount);
        else if (variant === 'test') updateTestMount(newMount);
        else updateNestedProfile('mount', { active: newMount });
    };

    const handleAscensionChange = (newLevel: number) => {
        if (variant === 'original') updateOriginalMountAscension(newLevel);
        else if (variant === 'test') updateTestMountAscension(newLevel);
        else updateNestedProfile('misc', { mountAscensionLevel: newLevel });
    };

    const handleSavePreset = (name: string) => {
        if (!mount) return;
        const saved = profile.mount.savedBuilds || [];
        const existingIdx = saved.findIndex(s => s.id === mount.id && s.rarity === mount.rarity && s.level === mount.level && JSON.stringify(s.secondaryStats) === JSON.stringify(mount.secondaryStats));
        if (existingIdx >= 0) {
            const newSaved = [...saved];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('mount', { savedBuilds: newSaved });
        } else {
            updateNestedProfile('mount', { savedBuilds: [...saved, { ...mount, customName: name || undefined }] });
        }
        setIsSaveModalOpen(false);
    };

    const getSpriteInfo = (mountId: number, rarity: string) => {
        if (!spriteMapping?.mounts?.mapping) return null;
        const entry = Object.entries(spriteMapping.mounts.mapping).find(([_, val]: [string, any]) => val.id === mountId && val.rarity === rarity);
        return entry ? { spriteIndex: parseInt(entry[0]), config: spriteMapping.mounts, name: (entry[1] as any).name } : null;
    };

    const getMountStats = () => {
        if (!mount || !mountUpgradeLibrary) return { damage: 0, health: 0 };
        const upgradeData = mountUpgradeLibrary[mount.rarity];
        if (!upgradeData?.LevelInfo) return { damage: 0, health: 0 };
        const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === Math.max(0, mount.level - 1)) || upgradeData.LevelInfo[0];
        let damage = 0, health = 0;
        if (levelInfo?.MountStats?.Stats) {
            levelInfo.MountStats.Stats.forEach((stat: any) => {
                if (stat.StatNode?.UniqueStat?.StatType === 'Damage') damage = stat.Value;
                if (stat.StatNode?.UniqueStat?.StatType === 'Health') health = stat.Value;
            });
        }
        let ascDmg = 0, ascHp = 0;
        let ascLevel = profile.misc.mountAscensionLevel || 0;
        if (isComparing) {
            if (variant === 'original' && originalMountAscension !== null) ascLevel = originalMountAscension;
            else if (variant === 'test' && testMountAscension !== null) ascLevel = testMountAscension;
        }
        if (ascLevel > 0 && ascensionConfigsLibrary?.Mounts?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Mounts.AscensionConfigPerLevel;
            for (let i = 0; i < ascLevel && i < ascConfigs.length; i++) {
                (ascConfigs[i].StatContributions || []).forEach((s: any) => {
                    if (s.StatNode?.UniqueStat?.StatType === 'Damage') ascDmg += s.Value;
                    if (s.StatNode?.UniqueStat?.StatType === 'Health') ascHp += s.Value;
                });
            }
        }
        return { 
            damage: damage * (1 + mountDamageBonus) * (1 + ascDmg), 
            health: health * (1 + mountHealthBonus) * (1 + ascHp),
            damageMulti: (1 + mountDamageBonus) * (1 + ascDmg),
            healthMulti: (1 + mountHealthBonus) * (1 + ascHp),
            ascLevel 
        };
    };

    const spriteInfo = mount ? getSpriteInfo(mount.id, mount.rarity) : null;
    const mountData = mount ? getMountStats() : null;
    const mountStats = mountData ? { damage: mountData.damage, health: mountData.health } : null;
    const currentAscension = mountData?.ascLevel || 0;
    const isDifferent = variant === 'test' && testMount?.id !== originalMount?.id;

    const perfection = useMemo(() => {
        if (!mount || !secondaryStatLibrary) return null;
        return getPerfection(mount as any, secondaryStatLibrary);
    }, [mount, secondaryStatLibrary]);

    return (
        <>
            <div className="col-span-2 sm:col-span-2 md:col-span-2 h-full">
                {mount ? (
                    <ItemSelectionCard
                        item={mount as any}
                        slotKey="Mount"
                        slotLabel="Mount"
                        variant={isCompact ? 'compact' : 'default'}
                        isSelected={false}
                        hasDiff={isDifferent}
                        globalAscensionLevel={currentAscension}
                        isSaved={isSaved}
                        itemName={spriteInfo?.name || `Mount ${mount.id}`}
                        itemImage={null}
                        stats={{
                            damage: mountStats?.damage || 0,
                            health: mountStats?.health || 0,
                            damageMulti: mountData?.damageMulti || 1,
                            healthMulti: mountData?.healthMulti || 1,
                            bonus: 0,
                            isMelee: false
                        }}
                        perfection={perfection}
                        getStatPerfection={(statId, value) => getStatPerfection(statId, value, secondaryStatLibrary)}
                        spriteMapping={spriteMapping}
                        onClick={() => setIsModalOpen(true)}
                        onUnequip={handleRemove}
                        onSave={(e) => { e.stopPropagation(); setIsSaveModalOpen(true); }}
                        onLevelChange={handleLevelChange}
                        onAscensionChange={handleAscensionChange}
                        hideAgeStyles={true}
                        rarity={mount.rarity}
                        renderIcon={() => spriteInfo && (
                            <SpriteSheetIcon
                                textureSrc={getAscensionTexturePath('MountIcons', currentAscension)}
                                spriteWidth={spriteInfo.config.sprite_size.width}
                                spriteHeight={spriteInfo.config.sprite_size.height}
                                sheetWidth={spriteInfo.config.texture_size.width}
                                sheetHeight={spriteInfo.config.texture_size.height}
                                iconIndex={spriteInfo.spriteIndex}
                                className="w-14 h-14"
                            />
                        )}
                    />
                ) : (
                    <div
                        onClick={() => setIsModalOpen(true)}
                        className="h-full rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-colors relative flex flex-col items-center justify-center gap-3 p-3 bg-bg-input/30 min-h-[160px]"
                    >
                        <div style={getInventoryIconStyle('Mount', 48) || {}} className="opacity-30" />
                        <span className="text-sm text-text-muted">Click to select Mount</span>
                    </div>
                )}
            </div>
            <MountSelectorModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSelect={handleSelectMount} currentMount={mount} />
            <InputModal isOpen={isSaveModalOpen} title="Save Mount Preset" label="Name" placeholder="Preset Name" initialValue={spriteInfo?.name || ''} onConfirm={handleSavePreset} onCancel={() => setIsSaveModalOpen(false)} />
        </>
    );
}
