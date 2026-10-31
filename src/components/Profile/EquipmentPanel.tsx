import { useProfile } from '../../context/ProfileContext';
import { DummyTestButton } from './DummyTestButton';
import { AutoBestButton } from './AutoBestButton';
import { useGameDataContext } from '../../context/GameDataContext';
import { useComparison } from '../../context/ComparisonContext';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { GitCompare, Eye, EyeOff } from 'lucide-react';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ItemSlot, MountSlot, UserProfile } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { ItemSelectorModal } from './ItemSelectorModal';
import { MountSelectorModal } from './MountSelectorModal';
import { PetSelectorModal } from './PetSelectorModal';
import { InputModal } from '../UI/InputModal';
import { SectionSyncButton } from './SectionSyncButton';
import { AscensionStars } from '../UI/AscensionStars';
import { ItemSelectionCard, EmptyRowCard, CARD_ART_CLASS } from '../UI/ItemSelectionCard';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { cn, getInventoryIconStyle } from '../../lib/utils';
import { getItemImage } from '../../utils/itemAssets';
import { useGameData } from '../../hooks/useGameData';
import { AGES } from '../../utils/constants';
import { useTreeModifiers, useClanTreeModifiers } from '../../hooks/useCalculatedStats';
import { personalTechShare } from '../../utils/clanTechStacking';

import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';

import { getItemStats, getPerfection, getStatPerfection } from '../../utils/itemCalculations';
import { FitBuildPortrait, fullMaxedSet } from '../Presets/BuildPortrait';

/** Artwork well for a card in the five-across row: five cards share the width three would get. */
const ITEM_ART = 'w-12 h-12 sm:w-16 sm:h-16 xl:w-20 xl:h-20';

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
        originalPetAscension,
        testPetAscension,
        originalMountAscension,
        testMountAscension,
        originalUseSkinWindup,
        testUseSkinWindup,
        originalMount,
        testMount,
        updateOriginalForgeAscension,
        updateTestForgeAscension,
        updateOriginalUseSkinWindup,
        updateTestUseSkinWindup,
        updateOriginalItem, updateTestItem, enterCompareMode,
        isCompactStats } = useComparison();
    const { selectedVersion } = useGameDataContext();
    const [selectedSlot, setSelectedSlot] = useState<keyof UserProfile['items'] | null>(null);
    // The character preview column: shown until the viewer turns it off, then remembered.
    const [showPortrait, setShowPortrait] = usePersistentState('fm.equipment.showPortrait', true);
    const [itemToSave, setItemToSave] = useState<{ slot: keyof UserProfile['items']; item: ItemSlot } | null>(null);

    const items = useMemo(() => {
        if (variant === 'original' && originalItems) return originalItems;
        if (variant === 'test' && testItems) return testItems;
        return profile.items;
    }, [variant, originalItems, testItems, profile.items]);

    const handleEnterCompare = () => {
        enterCompareMode();
        // Trigger the donation toast
        if (typeof (window as any).__triggerTestToast === 'function') {
            (window as any).__triggerTestToast();
        }
    };

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
    const { data: skinUpgradeLibrary } = useGameData<any>('SkinUpgradeLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');

    const techModifiers = useTreeModifiers();
    const clanModifiers = useClanTreeModifiers();

    const forgeAscensionMulti = useMemo(() => {
        let total = 0;
        let ascLevel = profile.misc.forgeAscensionLevel || 0;
        if (isComparing) {
            if (variant === 'original' && originalForgeAscension !== null) ascLevel = originalForgeAscension;
            else if (variant === 'test' && testForgeAscension !== null) ascLevel = testForgeAscension;
        }
        if (ascLevel > 0 && ascensionConfigs?.Forge?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Forge.AscensionConfigPerLevel;
            const config = configs[Math.min(ascLevel - 1, configs.length - 1)];
            if (config) {
                const contributions = config.StatContributions || [];
                for (const stat of contributions) {
                    if (stat.StatNode?.UniqueStat?.StatType === 'AscensionDamage' || stat.StatNode?.UniqueStat?.StatType === 'Damage') {
                        total = stat.Value + 1;
                        break; 
                    }
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
        return getItemImage(ageName, fileSlot, item.idx, autoMapping, selectedVersion);
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

    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');

    const currentUseSkinWindup = useMemo(() => {
        if (isComparing) {
            if (variant === 'original') return originalUseSkinWindup !== false;
            if (variant === 'test') return testUseSkinWindup !== false;
        }
        return profile.misc.useSkinWindup !== false;
    }, [isComparing, variant, originalUseSkinWindup, testUseSkinWindup, profile.misc.useSkinWindup]);

    /** Slots whose skin visibility only changes the look. */
    const lookSlot = (k: string): 'Helmet' | 'Body' | null => (k === 'Helmet' || k === 'Body' ? k : null);

    // The look of this panel's build: its items, mount and skin animation.
    const shownProfile = useMemo<UserProfile>(() => {
        const mount = isComparing ? (variant === 'original' ? originalMount : variant === 'test' ? testMount : profile.mount.active) : profile.mount.active;
        return {
            ...profile,
            items,
            mount: { ...profile.mount, active: mount ?? null },
            misc: { ...profile.misc, useSkinWindup: currentUseSkinWindup },
        };
    }, [profile, items, isComparing, variant, originalMount, testMount, currentUseSkinWindup]);
    const shownSet = useMemo(() => fullMaxedSet(items, skinsLibrary, skinUpgradeLibrary), [items, skinsLibrary, skinUpgradeLibrary]);

    const handleToggleSkinWindup = (val: boolean) => {
        if (isComparing) {
            if (variant === 'original') updateOriginalUseSkinWindup(val);
            else if (variant === 'test') updateTestUseSkinWindup(val);
        } else {
            updateNestedProfile('misc', { useSkinWindup: val });
        }
    };

    return (
        <>
            <Card className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}IconDivineArmorPaladinarmor.png`} alt="Equipment" className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
                        {panelTitle}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        {variant === 'default' && !isComparing && (
                            <div className="flex items-center gap-1.5">
                                <SectionSyncButton preset="item" label="Sync" />
                                <SectionSyncButton preset="mount" label="Mount" />
                                <SectionSyncButton preset="skin" label="Skins" />
                            </div>
                        )}
                        <div className="flex items-center gap-2 bg-bg-input/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50">
                            <AscensionStars
                                type="Forge"
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
                            {/* `xs:` is not a breakpoint in tailwind.config.js, so this chip used to be
                                hidden at every width. It is the panel-level forge ascension
                                multiplier: the same fact the cards used to restate one per card. */}
                            {forgeAscensionMulti > 0 && (
                                <div className="text-[9px] sm:text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 px-1 sm:px-1.5 py-0.5 rounded border border-amber-400/20">
                                    x{(forgeAscensionMulti).toFixed(1)}
                                </div>
                            )}
                        </div>
                        {!isPvp && <DummyTestButton variant={variant} />}
                        {!isPvp && variant !== 'original' && <AutoBestButton variant={variant === 'test' ? 'test' : 'default'} />}
                        {showCompareButton && !isComparing && variant === 'default' && (
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleEnterCompare}
                                className="shadow-lg shadow-accent-primary/20 animate-pulse-subtle flex-1 sm:flex-none py-1.5"
                            >
                                <GitCompare className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                                <span className="text-xs sm:text-sm">Compare Build</span>
                            </Button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowPortrait(v => !v)}
                            title={showPortrait ? 'Hide the character preview' : 'Show the character preview'}
                            aria-label={showPortrait ? 'Hide the character preview' : 'Show the character preview'}
                            className={cn('p-1.5 sm:p-2 rounded-lg border transition-colors', showPortrait ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary' : 'border-border text-text-muted hover:text-text-primary')}
                        >
                            {showPortrait ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {/* Wrapped flex, not a fixed column count: this same panel renders full width on the
                    Profile page and two-up inside the compare grid, so the cards have to reflow to
                    the container. basis-[330px] is the width the row card needs to keep the name,
                    the stat line and a pair of substats on one line each; grow lets a short last
                    row spread out, and max-w caps a lone card so it cannot stretch into a strip. */}
                <div className={cn(
                    'grid items-stretch gap-2',
                    // Two per row on a phone, five on a desktop, like the game's own equipment
                    // screen. Comparison mode is pinned to two whatever the window is doing: it
                    // renders two of these panels side by side, so the panel gets half the width
                    // while a viewport breakpoint still thinks it has all of it, which is what
                    // squeezed five cards into 150px each and broke every name onto its own letter.
                    // A sixth column on a desktop holds the character, two rows tall.
                    isComparing ? 'grid-cols-2' : showPortrait ? 'grid-cols-2 lg:grid-cols-6' : 'grid-cols-2 lg:grid-cols-5'
                )}>
                    {SLOTS.map((slot) => {
                        const equipped = items[slot.key];
                        const itemImage = getEquippedImage(slot.key, equipped);
                        // InventoryTextures.png is a 4x4 sheet of 128px cells, so 64px is the
                        // largest honest size for the silhouette on a 2x screen.
                        const inventoryStyle = getInventoryIconStyle(slot.key, 64, selectedVersion);
                        const hasDiff = itemsDiffer(slot.key);

                        if (!equipped) {
                            return (
                                <EmptyRowCard
                                    className="min-w-0" artClassName={ITEM_ART}
                                    key={slot.key}
                                    label={slot.label}
                                    hint="Empty Slot"
                                    hasDiff={hasDiff}
                                    onClick={() => setSelectedSlot(slot.key)}
                                    icon={inventoryStyle ? <div style={inventoryStyle} /> : undefined}
                                />
                            );
                        }

                        return (
                            <ItemSelectionCard
                                className="min-w-0" artClassName={ITEM_ART}
                                key={slot.key}
                                item={equipped}
                                layout="row"
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
                                    { itemBalancingLibrary, itemBalancingConfig, weaponLibrary, skinUpgradeLibrary },
                                    { techModifiers, forgeAscensionMulti, clanModifiers }
                                )}
                                // The game's per-type SkinVisibility: the weapon's also picks the attack
                                // animation (useSkinWindup, per comparison side); helmet and armour only
                                // change the look.
                                skinVisible={slot.key === 'Weapon' ? currentUseSkinWindup : lookSlot(slot.key) ? profile.misc.skinVisible?.[lookSlot(slot.key)!] !== false : undefined}
                                onToggleSkinVisible={slot.key === 'Weapon'
                                    ? () => handleToggleSkinWindup(!currentUseSkinWindup)
                                    : lookSlot(slot.key)
                                        ? () => { const k = lookSlot(slot.key)!; updateNestedProfile('misc', { skinVisible: { ...profile.misc.skinVisible, [k]: profile.misc.skinVisible?.[k] === false } }); }
                                        : undefined}
                                perfection={getPerfection(equipped, secondaryStatLibrary)}
                                getStatPerfection={(sId, val) => getStatPerfection(sId, val, secondaryStatLibrary)}
                                spriteMapping={spriteMapping}
                                onClick={() => setSelectedSlot(slot.key)}
                                onUnequip={(e) => handleUnequip(slot.key, e)}
                                /* No onAscensionChange: forge ascension is one global number, so the
                                   old card rendered the same 4-button control 8 times over. The card
                                   now shows the star count read-only and the single editor lives in
                                   the panel header above. */
                                onSave={(e) => {
                                    e.stopPropagation();
                                    setItemToSave({ slot: slot.key, item: equipped });
                                }}
                            />
                        );
                    })}

                    <MountSlotWidget variant={variant} isCompact={isCompactStats} />

                    {/* The character as these items make it look in battle: a column two rows tall on
                        the right on a desktop; two wide and two tall at the end of the narrow grid
                        (phone, comparison), so it lines up with the cards either way. */}
                    {showPortrait && <div className={cn(
                        'relative min-w-0 rounded-xl border border-border/60 overflow-hidden bg-gradient-to-b from-accent-primary/10 via-bg-secondary/40 to-bg-secondary/20',
                        isComparing ? 'col-span-2 row-span-2 min-h-[16rem]' : 'col-span-2 h-64 lg:h-auto lg:col-span-1 lg:col-start-6 lg:row-start-1 lg:row-span-2'
                    )}>
                        <FitBuildPortrait profile={shownProfile} setId={shownSet} className="absolute inset-0" />
                    </div>}
                </div>
            </Card>

            <ItemSelectorModal
                key={selectedSlot || 'modal'}
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
    const { selectedVersion } = useGameDataContext();
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
    const clanModifiers = useClanTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;
    const clanMountDamageBonus = clanModifiers['MountDamage'] || 0;
    const clanMountHealthBonus = clanModifiers['MountHealth'] || 0;

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
        const maxLevel = mountUpgradeLibrary?.[mount.rarity]?.LevelInfo?.length; // MountUpgradeLibrary
        if (typeof maxLevel !== 'number') return;
        const newLevel = Math.max(1, Math.min(maxLevel, mount.level + delta));
        if (newLevel === mount.level) return;
        const updatedMount = { ...mount, level: newLevel };
        
        if (variant === 'original') {
            updateOriginalMount(updatedMount);
        } else if (variant === 'test') {
            updateTestMount(updatedMount);
        } else {
            // Bidirectional sync: find if this mount was a saved build
            const saved = profile.mount.savedBuilds || [];
            const savedIdx = saved.findIndex(s => 
                s.id === mount.id && 
                s.rarity === mount.rarity && 
                JSON.stringify(s.secondaryStats) === JSON.stringify(mount.secondaryStats)
            );

            if (savedIdx !== -1) {
                const newSaved = [...saved];
                newSaved[savedIdx] = { ...newSaved[savedIdx], level: newLevel };
                updateNestedProfile('mount', { 
                    active: updatedMount,
                    savedBuilds: newSaved
                });
            } else {
                updateNestedProfile('mount', { active: updatedMount });
            }
        }
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
            const config = ascConfigs[Math.min(ascLevel - 1, ascConfigs.length - 1)];
            if (config) {
                (config.StatContributions || []).forEach((s: any) => {
                    const type = s.StatNode?.UniqueStat?.StatType;
                    if (type === 'Damage' || type === 'AscensionDamage') ascDmg = s.Value + 1;
                    if (type === 'Health' || type === 'AscensionHealth') ascHp = s.Value + 1;
                });
            }
        }
        const techDmgMulti = 1 + mountDamageBonus;
        const techHpMulti = 1 + mountHealthBonus;
        const ascDmgMulti = ascDmg || 1;
        const ascHpMulti = ascHp || 1;

        return { 
            damage: damage * techDmgMulti * ascDmgMulti, 
            health: health * techHpMulti * ascHpMulti,
            damageMulti: techDmgMulti * ascDmgMulti,
            healthMulti: techHpMulti * ascHpMulti,
            details: {
                damage: { base: damage, techMulti: personalTechShare(mountDamageBonus, clanMountDamageBonus), clanTechMulti: clanMountDamageBonus, ascMulti: ascDmgMulti },
                health: { base: health, techMulti: personalTechShare(mountHealthBonus, clanMountHealthBonus), clanTechMulti: clanMountHealthBonus, ascMulti: ascHpMulti }
            },
            ascLevel 
        };
    };

    const spriteInfo = mount ? getSpriteInfo(mount.id, mount.rarity) : null;
    const mountData = mount ? getMountStats() : null;
    const mountStats = mountData ? { damage: mountData.damage, health: mountData.health } : null;
    const currentAscension = mountData?.ascLevel || 0;
    // Full-content diff (matches the pet cards), so an auto-optimized swap to a
    // different level/stat variant of the same mount id also flags as changed.
    const isDifferent = variant === 'test' && (() => {
        const cur = testMount;
        const orig = originalMount;
        if (!cur && !orig) return false;
        if (!cur || !orig) return true;
        return cur.id !== orig.id || cur.rarity !== orig.rarity || cur.level !== orig.level ||
            JSON.stringify(cur.secondaryStats) !== JSON.stringify(orig.secondaryStats);
    })();

    const perfection = useMemo(() => {
        if (!mount || !secondaryStatLibrary) return null;
        return getPerfection(mount as any, secondaryStatLibrary);
    }, [mount, secondaryStatLibrary]);

    return (
        <>
            {/* This widget is the ninth child of the equipment row, so the flex sizing has to sit
                here rather than on the card inside it. */}
            <div className="col-span-2 min-w-0">
                {mount ? (
                    <ItemSelectionCard
                        artClassName={ITEM_ART}
                        item={mount as any}
                        slotKey="Mount"
                        slotLabel="Mount"
                        layout="row"
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
                            isMelee: false,
                            details: (mountData as any)?.details
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
                                    textureSrc={getAscensionTexturePath('MountIcons', currentAscension, selectedVersion)}
                                    spriteWidth={spriteInfo.config.sprite_size.width}
                                    spriteHeight={spriteInfo.config.sprite_size.height}
                                    sheetWidth={spriteInfo.config.texture_size.width}
                                    sheetHeight={spriteInfo.config.texture_size.height}
                                    iconIndex={spriteInfo.spriteIndex}
                                    className={CARD_ART_CLASS}
                                    smooth
                                />
                        )}
                    />
                ) : (
                    <EmptyRowCard
                        artClassName={ITEM_ART}
                        label="Mount"
                        hint="Click to select"
                        onClick={() => setIsModalOpen(true)}
                        icon={<div style={getInventoryIconStyle('Mount', 64, selectedVersion) || {}} />}
                    />
                )}
            </div>
            <MountSelectorModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                onSelect={handleSelectMount} 
                currentMount={mount} 
                mountAscensionLevel={(isComparing ? (variant === 'original' ? originalMountAscension : testMountAscension) : profile.misc.mountAscensionLevel) ?? undefined}
            />
            <InputModal isOpen={isSaveModalOpen} title="Save Mount Preset" label="Name" placeholder="Preset Name" initialValue={spriteInfo?.name || ''} onConfirm={handleSavePreset} onCancel={() => setIsSaveModalOpen(false)} />
        </>
    );
}
