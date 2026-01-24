import { useProfile } from '../../context/ProfileContext';
import { Card } from '../UI/Card';
import { Bike as MountIcon, Plus, Minus, X, Recycle, Bookmark } from 'lucide-react';
import { Button } from '../UI/Button';
import { MountSlot } from '../../types/Profile';
import { useState, useMemo } from 'react';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';
import { MountSelectorModal } from './MountSelectorModal';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { getStatName, getStatColor } from '../../utils/statNames';
import { InputModal } from '../UI/InputModal';

export function MountPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const activeMount = profile.mount.active;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');

    // Get tech tree modifiers
    const techModifiers = useTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;

    const handleSelectMount = (rarity: string, id: number, level: number, secondaryStats: { statId: string; value: number }[]) => {
        const newMount: MountSlot = {
            rarity,
            id,
            level,
            evolution: 0,
            skills: [],
            secondaryStats // Save manual passives
        };
        updateNestedProfile('mount', { active: newMount });
    };

    const handleLevelChange = (delta: number) => {
        if (!activeMount) return;
        const newLevel = Math.max(1, Math.min(100, activeMount.level + delta));
        updateNestedProfile('mount', { active: { ...activeMount, level: newLevel } });
    };

    const handleRemove = () => {
        updateNestedProfile('mount', { active: null });
    };

    // Get combined mount stats (Inherent + Manual Passives) with tech tree bonuses
    const getCombinedStats = () => {
        if (!activeMount) return { stats: [], damageMulti: 0, healthMulti: 0 };

        const combined: any[] = [];
        let baseDamageMulti = 0;
        let baseHealthMulti = 0;

        // 1. Inherent Stats from Library
        if (mountUpgradeLibrary) {
            const upgradeData = mountUpgradeLibrary[activeMount.rarity];
            if (upgradeData?.LevelInfo) {
                // User Level 1 = JSON Level 0
                const targetLevel = Math.max(0, activeMount.level - 1);
                const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === targetLevel) || upgradeData.LevelInfo[0];

                if (levelInfo?.MountStats?.Stats) {
                    levelInfo.MountStats.Stats.forEach((stat: any) => {
                        const statType = stat.StatNode?.UniqueStat?.StatType || 'Unknown';
                        let value = stat.Value || 0;
                        let techBonus = 0;

                        // Apply tech tree bonus for Damage/Health
                        if (statType === 'Damage') {
                            baseDamageMulti = value;
                            techBonus = mountDamageBonus;
                            value = value * (1 + techBonus);
                        } else if (statType === 'Health') {
                            baseHealthMulti = value;
                            techBonus = mountHealthBonus;
                            value = value * (1 + techBonus);
                        }

                        combined.push({
                            label: statType,
                            value: value,
                            baseValue: stat.Value,
                            techBonus: techBonus,
                            isMultiplier: stat.StatNode?.UniqueStat?.StatNature === 'Multiplier' ||
                                stat.StatNode?.UniqueStat?.StatNature === 'OneMinusMultiplier'
                        });
                    });
                }
            }
        }

        // 2. Manual Passives from Profile
        if (activeMount.secondaryStats) {
            activeMount.secondaryStats.forEach(stat => {
                combined.push({
                    label: stat.statId,
                    value: stat.value,
                    isManual: true,
                    isMultiplier: true
                });
            });
        }

        return {
            stats: combined,
            damageMulti: baseDamageMulti * (1 + mountDamageBonus),
            healthMulti: baseHealthMulti * (1 + mountHealthBonus)
        };
    };

    const { stats: combinedStats } = getCombinedStats();

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

    // Prepare sprite info for active mount
    const activeSprite = activeMount ? getSpriteInfo(activeMount.id, activeMount.rarity) : null;

    // Check if current mount matches a saved build
    const isSaved = useMemo(() => {
        if (!activeMount || !profile.mount.savedBuilds) return false;
        return profile.mount.savedBuilds.some(s =>
            s.id === activeMount.id && s.rarity === activeMount.rarity && s.level === activeMount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(activeMount.secondaryStats)
        );
    }, [activeMount, profile.mount.savedBuilds]);

    const handleSaveConfirm = (name: string) => {
        if (!activeMount) return;
        const saved = profile.mount.savedBuilds || [];

        const existingIdx = saved.findIndex(s =>
            s.id === activeMount.id && s.rarity === activeMount.rarity && s.level === activeMount.level &&
            JSON.stringify(s.secondaryStats) === JSON.stringify(activeMount.secondaryStats)
        );

        if (existingIdx >= 0) {
            // Update
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
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <MountIcon className="w-6 h-6 text-accent-primary" />
                Active Mount
            </h2>

            {activeMount ? (
                <div className="space-y-4">
                    {/* Active Mount Display */}
                    <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-3">
                            <div
                                className={cn(
                                    "w-12 h-12 rounded-full flex items-center justify-center border-2 overflow-hidden shrink-0",
                                    `border-rarity-${activeMount.rarity.toLowerCase()}`
                                )}
                                style={getRarityBgStyle(activeMount.rarity)}
                            >
                                {activeSprite ? (
                                    <SpriteSheetIcon
                                        textureSrc="./icons/game/MountIcons.png"
                                        spriteWidth={activeSprite.config.sprite_size.width}
                                        spriteHeight={activeSprite.config.sprite_size.height}
                                        sheetWidth={activeSprite.config.texture_size.width}
                                        sheetHeight={activeSprite.config.texture_size.height}
                                        iconIndex={activeSprite.spriteIndex}
                                        className="w-12 h-12"
                                    />
                                ) : (
                                    <MountIcon className="w-6 h-6 text-text-muted" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="font-bold truncate">{activeSprite?.name || `${activeMount.rarity} Mount #${activeMount.id}`}</div>
                                <div className="text-xs text-text-muted truncate">Level {activeMount.level}</div>
                            </div>
                        </div>

                        {/* Mount Stats */}
                        {combinedStats.length > 0 && (
                            <div className="mb-3">
                                <div className="flex flex-wrap gap-2">
                                    {combinedStats.map((stat, idx) => (
                                        <span key={idx} className={cn(
                                            "text-xs bg-bg-input px-2 py-1 rounded",
                                            stat.isManual && "border border-accent-primary/30",
                                            getStatColor(stat.label)
                                        )}>
                                            {getStatName(stat.label)}: <span className="font-mono font-bold">
                                                {stat.isMultiplier ? '+' : ''}
                                                {(stat.isMultiplier ? stat.value * 100 : stat.value).toFixed(2)}
                                                {stat.isMultiplier ? '%' : ''}
                                            </span>
                                            {stat.techBonus > 0 && (
                                                <span className="text-green-400 ml-1 text-[10px]">(+{(stat.techBonus * 100).toFixed(0)}%)</span>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Controls (New Line) */}
                        <div className="flex items-center justify-between pt-2 border-t border-border/30">
                            <div />
                            <div className="flex items-center gap-2">
                                {/* Level controls */}
                                <div className="flex items-center gap-1 bg-bg-input rounded-lg px-1">
                                    <button
                                        onClick={() => handleLevelChange(-1)}
                                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary"
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="text-sm font-mono font-bold w-8 text-center">{activeMount.level}</span>
                                    <button
                                        onClick={() => handleLevelChange(1)}
                                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>

                                <button onClick={() => setIsModalOpen(true)} className="text-text-muted hover:text-accent-primary p-1 bg-bg-input rounded-lg" title="Change">
                                    <Recycle className="w-4 h-4" />
                                </button>

                                <button
                                    onClick={() => setIsSaveModalOpen(true)}
                                    className={cn(
                                        "p-1 transition-colors rounded-lg bg-bg-input",
                                        isSaved ? "text-accent-primary hover:text-accent-primary" : "text-text-muted hover:text-green-400"
                                    )}
                                    title={isSaved ? "Update Saved Preset" : "Save as Preset"}
                                >
                                    <Bookmark className={cn("w-4 h-4", isSaved && "fill-accent-primary")} />
                                </button>

                                <button onClick={handleRemove} className="text-text-muted hover:text-red-400 p-1 bg-bg-input rounded-lg">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)}>
                        Change Mount
                    </Button>
                </div>
            ) : (
                <div
                    className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-border rounded-xl space-y-4 cursor-pointer hover:border-accent-primary/50 transition-colors"
                    onClick={() => setIsModalOpen(true)}
                >
                    {/* Mount icon from InventoryTextures.png (index 8 = row 3, col 1) */}
                    <div
                        style={{
                            backgroundImage: `url(/Texture2D/InventoryTextures.png)`,
                            backgroundPosition: `-0px -${128 * 2 * (48 / 128)}px`,
                            backgroundSize: `${512 * (48 / 128)}px ${512 * (48 / 128)}px`,
                            width: '48px',
                            height: '48px',
                        }}
                        className="opacity-30"
                    />
                    <p className="text-text-muted text-sm">No mount equipped</p>
                    <Button variant="primary" onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }}>
                        <Plus className="w-4 h-4 mr-2" /> Select Mount
                    </Button>
                </div>
            )
            }

            <MountSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleSelectMount}
                currentMount={activeMount}
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
        </Card >
    );
}
