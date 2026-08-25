import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { Card } from '../UI/Card';
import { Bike as MountIcon } from 'lucide-react';
import { MountSlot } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { useGameData } from '../../hooks/useGameData';
import { MountSelectorModal } from './MountSelectorModal';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useTreeModifiers, useClanTreeModifiers } from '../../hooks/useCalculatedStats';
import { InputModal } from '../UI/InputModal';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard, EmptyRowCard, CARD_ART_CLASS } from '../UI/ItemSelectionCard';
import { getPerfection, getStatPerfection } from '../../utils/itemCalculations';

/**
 * Standalone mount panel.
 *
 * It used to be a second, hand-rolled copy of the loadout card, and it had drifted away from the
 * shared one in three ways that were visible on screen: every manual passive was multiplied by 100
 * (12.6% rendered as 1260.0%), the rarity gradient was painted at full opacity instead of the
 * reduced opacity the shared card uses, and combinedStats.slice(2, 5) silently dropped a fourth
 * substat. All three are gone because the card is now the shared one.
 *
 * The mount ascension editor stays ON the card here: unlike forge/pet/skill ascension, this panel
 * has no other control for that track, so removing it would remove the only way to set it.
 */
export function MountPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const activeMount = profile.mount.active;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');

    const techModifiers = useTreeModifiers();
    const clanModifiers = useClanTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;
    const clanMountDamageBonus = clanModifiers['MountDamage'] || 0;
    const clanMountHealthBonus = clanModifiers['MountHealth'] || 0;

    const mountAscensionLevel = profile.misc.mountAscensionLevel || 0;

    const handleSelectMount = (rarity: string | null, id?: number, level?: number, secondaryStats?: { statId: string; value: number }[]) => {
        if (!rarity) {
            updateNestedProfile('mount', { active: null });
            return;
        }
        const newMount: MountSlot = {
            rarity,
            id: id || 0,
            level: level || 1,
            evolution: 0,
            skills: [],
            secondaryStats: secondaryStats || []
        };
        updateNestedProfile('mount', { active: newMount });
        setIsModalOpen(false);
    };

    const handleLevelChange = (delta: number) => {
        if (!activeMount) return;
        const maxLevel = mountUpgradeLibrary?.[activeMount.rarity]?.LevelInfo?.length || 100;
        const newLevel = Math.max(1, Math.min(maxLevel, activeMount.level + delta));
        if (newLevel === activeMount.level) return;
        updateNestedProfile('mount', { active: { ...activeMount, level: newLevel } });
    };

    const handleRemove = () => {
        updateNestedProfile('mount', { active: null });
    };

    /** Damage and health with the tech tree and ascension layers, plus the breakdown the tooltip wants. */
    const mountStats = useMemo(() => {
        if (!activeMount || !mountUpgradeLibrary) return null;
        const upgradeData = mountUpgradeLibrary[activeMount.rarity];
        if (!upgradeData?.LevelInfo) return null;

        // User level 1 = JSON level 0.
        const targetLevel = Math.max(0, activeMount.level - 1);
        const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === targetLevel) || upgradeData.LevelInfo[0];

        let baseDamage = 0;
        let baseHealth = 0;
        (levelInfo?.MountStats?.Stats || []).forEach((stat: any) => {
            const type = stat.StatNode?.UniqueStat?.StatType;
            if (type === 'Damage') baseDamage = stat.Value || 0;
            if (type === 'Health') baseHealth = stat.Value || 0;
        });

        let ascDmg = 0;
        let ascHp = 0;
        if (mountAscensionLevel > 0 && ascensionConfigsLibrary?.Mounts?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Mounts.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(mountAscensionLevel - 1, ascConfigs.length - 1)];
            (config?.StatContributions || []).forEach((s: any) => {
                const type = s.StatNode?.UniqueStat?.StatType;
                if (type === 'Damage' || type === 'AscensionDamage') ascDmg = s.Value + 1;
                if (type === 'Health' || type === 'AscensionHealth') ascHp = s.Value + 1;
            });
        }

        const techDmgMulti = 1 + mountDamageBonus;
        const techHpMulti = 1 + mountHealthBonus;
        const ascDmgMulti = ascDmg || 1;
        const ascHpMulti = ascHp || 1;

        return {
            damage: baseDamage * techDmgMulti * ascDmgMulti,
            health: baseHealth * techHpMulti * ascHpMulti,
            damageMulti: techDmgMulti * ascDmgMulti,
            healthMulti: techHpMulti * ascHpMulti,
            details: {
                damage: { base: baseDamage, techMulti: techDmgMulti, clanTechMulti: clanMountDamageBonus, ascMulti: ascDmgMulti },
                health: { base: baseHealth, techMulti: techHpMulti, clanTechMulti: clanMountHealthBonus, ascMulti: ascHpMulti }
            }
        };
    }, [activeMount, mountUpgradeLibrary, ascensionConfigsLibrary, mountAscensionLevel,
        mountDamageBonus, mountHealthBonus, clanMountDamageBonus, clanMountHealthBonus]);

    const getSpriteInfo = (mountId: number, rarity: string) => {
        if (!spriteMapping?.mounts?.mapping) return null;
        const entry = Object.entries(spriteMapping.mounts.mapping).find(([_, val]: [string, any]) => val.id === mountId && val.rarity === rarity);
        if (!entry) return null;
        return {
            spriteIndex: parseInt(entry[0]),
            config: spriteMapping.mounts,
            name: (entry[1] as any).name
        };
    };

    const activeSprite = activeMount ? getSpriteInfo(activeMount.id, activeMount.rarity) : null;

    const isSaved = useMemo(() => {
        if (!activeMount || !profile.mount.savedBuilds) return false;
        return profile.mount.savedBuilds.some(s =>
            s.id === activeMount.id && s.rarity === activeMount.rarity && s.level === activeMount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(activeMount.secondaryStats)
        );
    }, [activeMount, profile.mount.savedBuilds]);

    const perfection = useMemo(() => {
        if (!activeMount || !secondaryStatLibrary) return null;
        return getPerfection(activeMount as any, secondaryStatLibrary);
    }, [activeMount, secondaryStatLibrary]);

    const handleSaveConfirm = (name: string) => {
        if (!activeMount) return;
        const saved = profile.mount.savedBuilds || [];

        const existingIdx = saved.findIndex(s =>
            s.id === activeMount.id && s.rarity === activeMount.rarity && s.level === activeMount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(activeMount.secondaryStats)
        );

        if (existingIdx >= 0) {
            const newSaved = [...saved];
            newSaved[existingIdx] = { ...newSaved[existingIdx], customName: name };
            updateNestedProfile('mount', { savedBuilds: newSaved });
        } else {
            const newPreset: MountSlot = { ...activeMount, customName: name || undefined };
            updateNestedProfile('mount', { savedBuilds: [...saved, newPreset] });
        }
        setIsSaveModalOpen(false);
    };

    const getModalProps = () => {
        if (!activeMount) return { title: '', label: '', initialValue: '' };

        const saved = profile.mount.savedBuilds || [];
        const match = saved.find(s =>
            s.id === activeMount.id && s.rarity === activeMount.rarity && s.level === activeMount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(activeMount.secondaryStats)
        );

        const baseName = activeSprite?.name || `Mount ${activeMount.id}`;

        if (match) {
            return { title: 'Update Saved Preset', label: 'Preset Name (Already Saved)', initialValue: match.customName || baseName };
        }
        return { title: 'Save Mount Preset', label: 'Preset Name', initialValue: baseName };
    };

    const modalProps = getModalProps();

    return (
        <Card className="p-4 sm:p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <MountIcon className="w-6 h-6 text-accent-primary" />
                Active Mount
            </h2>

                            {/* flex-wrap, not a grid: a grid keeps its column count on the last row too, so
                    eight items plus the mount left the mount alone in a 4-wide row with three
                    empty tracks beside it. Wrapped flex lets whatever lands on the last row grow
                    into the full width instead, and items-stretch levels the heights within a row
                    so two cards side by side never end at different depths. */}
                <div className="flex flex-wrap items-stretch gap-3">
                {activeMount ? (
                    <ItemSelectionCard
                        className="basis-[330px] grow min-w-0 max-w-[min(100%,560px)]"
                        item={activeMount as any}
                        layout="row"
                        slotKey="Mount"
                        slotLabel="Mount"
                        rarity={activeMount.rarity}
                        hideAgeStyles={true}
                        itemName={activeSprite?.name || `${activeMount.rarity} Mount`}
                        itemImage={null}
                        isSaved={isSaved}
                        globalAscensionLevel={mountAscensionLevel}
                        stats={{
                            damage: mountStats?.damage || 0,
                            health: mountStats?.health || 0,
                            damageMulti: mountStats?.damageMulti ?? 1,
                            healthMulti: mountStats?.healthMulti ?? 1,
                            isMelee: false,
                            details: mountStats?.details
                        }}
                        perfection={perfection}
                        getStatPerfection={(statId, value) => getStatPerfection(statId, value, secondaryStatLibrary)}
                        spriteMapping={spriteMapping}
                        onClick={() => setIsModalOpen(true)}
                        onUnequip={(e) => { e.stopPropagation(); handleRemove(); }}
                        onSave={(e) => { e.stopPropagation(); setIsSaveModalOpen(true); }}
                        onLevelChange={(delta, e) => { e.stopPropagation(); handleLevelChange(delta); }}
                        onAscensionChange={(val) => updateNestedProfile('misc', { mountAscensionLevel: val })}
                        renderIcon={() => activeSprite ? (
                            <SpriteSheetIcon
                                textureSrc={getAscensionTexturePath('MountIcons', mountAscensionLevel, selectedVersion)}
                                spriteWidth={activeSprite.config.sprite_size.width}
                                spriteHeight={activeSprite.config.sprite_size.height}
                                sheetWidth={activeSprite.config.texture_size.width}
                                sheetHeight={activeSprite.config.texture_size.height}
                                iconIndex={activeSprite.spriteIndex}
                                className={CARD_ART_CLASS}
                                smooth
                            />
                        ) : (
                            <MountIcon className="w-10 h-10 opacity-50 text-text-muted" />
                        )}
                    />
                ) : (
                    <EmptyRowCard
                        className="basis-[330px] grow min-w-0 max-w-[min(100%,560px)]"
                        label="No Mount Equipped"
                        hint="Click to select"
                        icon={<MountIcon className="w-10 h-10 text-text-muted" />}
                        onClick={() => setIsModalOpen(true)}
                    />
                )}
            </div>

            <MountSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleSelectMount}
                currentMount={activeMount}
                mountAscensionLevel={profile.misc.mountAscensionLevel}
            />

            <InputModal
                isOpen={isSaveModalOpen}
                title={modalProps.title}
                label={modalProps.label}
                placeholder="Preset Name"
                initialValue={modalProps.initialValue}
                onConfirm={handleSaveConfirm}
                onCancel={() => setIsSaveModalOpen(false)}
            />
        </Card>
    );
}
