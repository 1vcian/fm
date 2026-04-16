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
import { AscensionStars } from '../UI/AscensionStars';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';

export function MountPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const activeMount = profile.mount.active;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    // Get tech tree modifiers
    const techModifiers = useTreeModifiers();
    const mountDamageBonus = techModifiers['MountDamage'] || 0;
    const mountHealthBonus = techModifiers['MountHealth'] || 0;

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
    };

    const handleLevelChange = (delta: number) => {
        if (!activeMount) return;
        const maxLevel = mountUpgradeLibrary?.[activeMount.rarity]?.LevelInfo?.length || 100;
        const newLevel = Math.max(1, Math.min(maxLevel, activeMount.level + delta));
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

                // Calculate Ascension Multiplier
                let ascensionDmgMulti = 0;
                let ascensionHpMulti = 0;
                const mountAscensionLevel = profile.misc.mountAscensionLevel || 0;
                if (mountAscensionLevel > 0 && ascensionConfigsLibrary?.Mounts?.AscensionConfigPerLevel) {
                    const ascConfigs = ascensionConfigsLibrary.Mounts.AscensionConfigPerLevel;
                    for (let i = 0; i < mountAscensionLevel && i < ascConfigs.length; i++) {
                        const stats = ascConfigs[i].StatContributions || [];
                        for (const s of stats) {
                            const sType = s.StatNode?.UniqueStat?.StatType;
                            const sVal = s.Value;
                            if (sType === 'Damage') ascensionDmgMulti += sVal;
                            if (sType === 'Health') ascensionHpMulti += sVal;
                        }
                    }
                }

                if (levelInfo?.MountStats?.Stats) {
                    levelInfo.MountStats.Stats.forEach((stat: any) => {
                        const statType = stat.StatNode?.UniqueStat?.StatType || 'Unknown';
                        let value = stat.Value || 0;
                        let techBonus = 0;
                        let ascensionBonus = 0;

                        // Apply tech tree bonus for Damage/Health
                        if (statType === 'Damage') {
                            baseDamageMulti = value;
                            techBonus = mountDamageBonus;
                            ascensionBonus = ascensionDmgMulti;
                            value = value * (1 + techBonus + ascensionBonus);
                        } else if (statType === 'Health') {
                            baseHealthMulti = value;
                            techBonus = mountHealthBonus;
                            ascensionBonus = ascensionHpMulti;
                            value = value * (1 + techBonus + ascensionBonus);
                        }

                        combined.push({
                            label: statType,
                            value: value,
                            baseValue: stat.Value,
                            techBonus: techBonus,
                            ascensionBonus: ascensionBonus,
                            // DMG and HP of mounts are now flat additives
                            isMultiplier: statType !== 'Damage' && statType !== 'Health' && (
                                stat.StatNode?.UniqueStat?.StatNature === 'Multiplier' ||
                                stat.StatNode?.UniqueStat?.StatNature === 'OneMinusMultiplier'
                            )
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Active Mount Slot */}
                    <div 
                        onClick={() => setIsModalOpen(true)}
                        className={cn(
                            "h-full min-h-[180px] rounded-xl border-2 bg-bg-secondary/50 relative flex flex-col items-center p-2 gap-1 group transition-all cursor-pointer",
                            `border-rarity-${activeMount.rarity.toLowerCase()}/50 hover:border-rarity-${activeMount.rarity.toLowerCase()} hover:bg-bg-secondary/50 hover:scale-[1.02]`
                        )}
                        style={getRarityBgStyle(activeMount.rarity)}
                    >
                        {/* Top Badges */}
                        <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
                            <span className="bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10 shadow-sm">
                                Lv {activeMount.level}
                            </span>
                        </div>

                        {/* Actions */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsSaveModalOpen(true); }}
                                className={cn(
                                    "p-1.5 rounded-lg transition-all shadow-sm border border-white/5",
                                    isSaved ? "bg-accent-primary text-white" : "bg-black/40 text-text-muted hover:text-white"
                                )}
                            >
                                <Bookmark className={cn("w-3 h-3", isSaved && "fill-white")} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsModalOpen(true); }}
                                className="p-1.5 bg-black/40 hover:bg-black/60 text-text-muted hover:text-white rounded-lg transition-all border border-white/5"
                            >
                                <Recycle className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRemove(); }}
                                className="p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-lg transition-all shadow-sm"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>

                        {/* Icon Container */}
                        <div className="mt-6 mb-1 shrink-0">
                            <div
                                className={cn(
                                    "w-16 h-16 rounded-xl flex items-center justify-center border-2 shrink-0 bg-bg-primary/40 shadow-inner group-hover:scale-110 transition-transform",
                                    `border-rarity-${activeMount.rarity.toLowerCase()}`
                                )}
                                style={getRarityBgStyle(activeMount.rarity)}
                            >
                                {activeSprite ? (
                                    <SpriteSheetIcon
                                        textureSrc={getAscensionTexturePath('MountIcons', profile.misc.mountAscensionLevel || 0)}
                                        spriteWidth={activeSprite.config.sprite_size.width}
                                        spriteHeight={activeSprite.config.sprite_size.height}
                                        sheetWidth={activeSprite.config.texture_size.width}
                                        sheetHeight={activeSprite.config.texture_size.height}
                                        iconIndex={activeSprite.spriteIndex}
                                        className="w-12 h-12"
                                    />
                                ) : (
                                    <MountIcon className={cn("w-8 h-8 opacity-50", `text-rarity-${activeMount.rarity.toLowerCase()}`)} />
                                )}
                            </div>
                        </div>

                        {/* Name & Evolution */}
                        <div className="w-full text-center mb-1">
                            <div className="font-bold text-xs leading-tight px-2 text-text-primary">
                                {activeSprite?.name || `${activeMount.rarity} Mount`}
                            </div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-accent-primary opacity-80">
                                {activeMount.rarity} Mount
                            </div>
                        </div>

                        {/* Core Stats */}
                        <div className="w-full bg-black/30 rounded-lg p-2 flex flex-col gap-1.5 border border-white/5">
                            {combinedStats.slice(0, 2).map((stat, idx) => {
                                const label = stat.label.toLowerCase();
                                const isFlat = label === 'damage' || label === 'health' || label === 'dmg' || label === 'hp';
                                const formatValue = (val: number) => {
                                    if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
                                    if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
                                    return val.toFixed(0);
                                };

                                return (
                                    <div key={idx} className={cn("flex justify-between items-center text-[10px] font-mono", getStatColor(stat.label))}>
                                        <span className="opacity-70">{getStatName(stat.label)}</span>
                                        <span className="font-bold">
                                            {stat.isMultiplier || isFlat ? '+' : ''}
                                            {isFlat ? formatValue(stat.value) : (stat.isMultiplier ? stat.value * 100 : stat.value).toFixed(1)}
                                            {stat.isMultiplier ? '%' : ''}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Secondary/Inherent Combo */}
                        <div className="w-full mt-auto pt-2 border-t border-white/10 flex flex-col gap-1">
                            {combinedStats.slice(2, 5).map((stat, idx) => (
                                <div key={idx} className={cn("flex justify-between items-center text-[9px] leading-none", stat.isManual ? "text-accent-primary" : "text-text-muted/80")}>
                                    <span className="truncate mr-1">{getStatName(stat.label)}</span>
                                    <span className="font-bold shrink-0">
                                        +{ (stat.isMultiplier ? stat.value * 100 : stat.value).toFixed(1) }%
                                    </span>
                                </div>
                            ))}
                            
                            {/* Ascension & Level Controls */}
                            <div className="mt-1 flex items-center justify-between gap-1">
                                <div className="flex bg-black/40 rounded-md p-0.5 border border-white/5 scale-90 origin-left">
                                    <button onClick={() => handleLevelChange(-1)} className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded">-</button>
                                    <span className="px-1.5 text-[10px] font-bold self-center">{activeMount.level}</span>
                                    <button onClick={() => handleLevelChange(1)} className="w-5 h-5 flex items-center justify-center hover:bg-white/10 rounded">+</button>
                                </div>
                                <div className="scale-75 origin-right">
                                    <AscensionStars 
                                        value={profile.misc.mountAscensionLevel || 0}
                                        onChange={(val: number) => updateNestedProfile('misc', { mountAscensionLevel: val })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Change Button Placeholder for empty space */}
                    <div 
                        onClick={() => setIsModalOpen(true)}
                        className="h-full min-h-[180px] rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-all flex flex-col items-center justify-center p-4 bg-bg-input/10 group opacity-50 hover:opacity-100"
                    >
                        <div className="p-3 bg-bg-secondary/50 rounded-full mb-2 group-hover:scale-110 transition-transform">
                            <Recycle className="w-6 h-6 text-text-muted" />
                        </div>
                        <span className="text-xs font-bold text-text-muted">Change Mount</span>
                    </div>
                </div>
            ) : (
                <div
                    className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-border rounded-xl space-y-4 cursor-pointer hover:border-accent-primary/50 transition-all bg-bg-input/10 group"
                    onClick={() => setIsModalOpen(true)}
                >
                    <div className="p-4 bg-bg-secondary/50 rounded-full mb-2 group-hover:scale-110 transition-transform border border-white/5">
                        <Plus className="w-8 h-8 text-text-muted opacity-50" />
                    </div>
                    <div className="text-center">
                        <p className="text-text-primary font-bold">No Mount Equipped</p>
                        <p className="text-text-muted text-xs uppercase tracking-widest mt-1">Click to select</p>
                    </div>
                </div>
            )}

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
