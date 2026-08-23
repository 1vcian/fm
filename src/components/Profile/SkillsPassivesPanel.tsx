import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { Card } from '../UI/Card';
import { Sparkles, ChevronDown, ChevronUp, Trash2, RotateCcw } from 'lucide-react';
import { Input } from '../UI/Input';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { useState, useMemo } from 'react';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { formatCompactNumber } from '../../utils/statsCalculator';

import { getAscensionTexturePath, getNormalizedTarget } from '../../utils/ascensionUtils';
import { AscensionStars } from '../UI/AscensionStars';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';

interface SkillInfo {
    id: string;
    rarity: string;
}

const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

export function SkillsPassivesPanel() {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { isCompactStats } = useComparison();
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const globalStats = useGlobalStats();
    const techModifiers = useTreeModifiers();
    const [activeRarity, setActiveRarity] = useState<string | null>('Common');
    const [previousPassives, setPreviousPassives] = useState<Record<string, number> | null>(null);
    const [isUndoVisible, setIsUndoVisible] = useState(false);

    const skillPassiveDamageBonus = techModifiers['SkillPassiveDamage'] || 0;
    const skillPassiveHealthBonus = techModifiers['SkillPassiveHealth'] || 0;
    const skillCooldownReduction = globalStats?.skillCooldownReduction || 0;

    const { ascensionDmgMulti, ascensionHpMulti } = useMemo(() => {
        const skillAscensionLevel = profile.misc.skillAscensionLevel || 0;
        let dMulti = 0;
        let hMulti = 0;

        if (skillAscensionLevel > 0 && ascensionConfigsLibrary?.Skills?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Skills.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(skillAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const sTarget = getNormalizedTarget(s.StatNode).$type;
                    if (sTarget === 'PassiveSkillStatTarget') {
                        const sType = s.StatNode?.UniqueStat?.StatType;
                        const sVal = s.Value + 1;
                        if (sType === 'Damage' || sType === 'AscensionDamage') dMulti = sVal;
                        if (sType === 'Health' || sType === 'AscensionHealth') hMulti = sVal;
                    }
                }
            }
        }
        return { ascensionDmgMulti: dMulti, ascensionHpMulti: hMulti };
    }, [profile.misc.skillAscensionLevel, ascensionConfigsLibrary]);

    const skillsByRarity = useMemo(() => {
        if (!skillLibrary) return {};
        const byRarity: Record<string, SkillInfo[]> = {};
        for (const [id, data] of Object.entries(skillLibrary) as [string, any][]) {
            const rarity = data.Rarity || 'Common';
            if (!byRarity[rarity]) byRarity[rarity] = [];
            byRarity[rarity].push({ id, rarity });
        }
        return byRarity;
    }, [skillLibrary]);

    const passives = profile.skills?.passives || {};

    const handleLevelChange = (skillId: string, newLevel: number) => {
        setIsUndoVisible(false);
        const skillData = skillLibrary?.[skillId];
        const rarity = skillData?.Rarity || 'Common';
        const maxLevel = skillPassiveLibrary?.[rarity]?.LevelStats?.length || 299;
        const clampedLevel = Math.max(0, Math.min(newLevel, maxLevel));
        const updatedPassives = { ...passives, [skillId]: clampedLevel };

        const equipped = profile.skills.equipped || [];
        const updatedEquipped = equipped.map(s =>
            s.id === skillId ? { ...s, level: Math.max(1, clampedLevel) } : s
        );

        updateNestedProfile('skills', { passives: updatedPassives, equipped: updatedEquipped });
    };

    const handleResetAll = () => {
        setPreviousPassives({ ...passives });
        setIsUndoVisible(true);
        const resetPassives = { ...passives };
        Object.keys(resetPassives).forEach(key => resetPassives[key] = 0);
        updateNestedProfile('skills', { passives: resetPassives });
    };

    const handleUndo = () => {
        if (previousPassives) {
            updateNestedProfile('skills', { passives: previousPassives });
            setIsUndoVisible(false);
        }
    };

    const getSpriteInfo = (skillId: string) => {
        if (!spriteMapping?.skills?.mapping) return null;
        const entry = Object.entries(spriteMapping.skills.mapping).find(
            ([_, val]: [string, any]) => val.name === skillId
        );
        if (entry) {
            return {
                spriteIndex: parseInt(entry[0]),
                config: spriteMapping.skills
            };
        }
        return null;
    };

    const getSkillStats = (skillId: string, level: number) => {
        if (!skillPassiveLibrary || !skillLibrary || level <= 0) return null;
        const skillData = skillLibrary[skillId];
        if (!skillData) return null;
        const rarity = skillData.Rarity || 'Common';
        const passiveData = skillPassiveLibrary[rarity];
        if (!passiveData?.LevelStats) return null;
        const levelIdx = Math.max(0, Math.min(level - 1, passiveData.LevelStats.length - 1));
        const levelInfo = passiveData.LevelStats[levelIdx];
        if (!levelInfo?.Stats) return null;

        let baseDamage = 0, baseHealth = 0;
        for (const stat of levelInfo.Stats) {
            const statType = stat.StatNode?.UniqueStat?.StatType;
            if (statType === 'Damage') baseDamage += stat.Value || 0;
            if (statType === 'Health') baseHealth += stat.Value || 0;
        }

        const damage = Math.floor(baseDamage * (1 + skillPassiveDamageBonus) * (ascensionDmgMulti || 1));
        const health = Math.floor(baseHealth * (1 + skillPassiveHealthBonus) * (ascensionHpMulti || 1));
        const baseCooldown = skillData.Cooldown || 0;
        const cooldown = baseCooldown * Math.max(0.1, 1 - skillCooldownReduction);

        return {
            baseDamage,
            baseHealth,
            damage,
            health,
            damageBonus: skillPassiveDamageBonus,
            healthBonus: skillPassiveHealthBonus,
            cooldown: cooldown,
            cooldownReduction: skillCooldownReduction,
            ascensionDmgMulti,
            ascensionHpMulti
        };
    };

    const totals = useMemo(() => {
        let totalBaseDmg = 0, totalBaseHp = 0;
        let totalDmg = 0, totalHp = 0;
        let ascActiveDmgMulti = 1;
        let ascActiveHpMulti = 1;

        const skillAscensionLevel = profile.misc.skillAscensionLevel || 0;
        if (skillAscensionLevel > 0 && ascensionConfigsLibrary?.Skills?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Skills.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(skillAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const sTarget = getNormalizedTarget(s.StatNode).$type;
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    if (sTarget === 'ActiveSkillStatTarget') {
                        if (sType === 'Damage' || sType === 'AscensionDamage') ascActiveDmgMulti = s.Value + 1;
                        if (sType === 'Health' || sType === 'AscensionHealth') ascActiveHpMulti = s.Value + 1;
                    }
                }
            }
        }

        for (const [skillId, level] of Object.entries(passives)) {
            if ((level as number) <= 0) continue;
            const stats = getSkillStats(skillId, level as number);
            if (stats) {
                totalBaseDmg += stats.baseDamage;
                totalBaseHp += stats.baseHealth;
                totalDmg += stats.damage;
                totalHp += stats.health;
            }
        }
        return {
            baseDamage: totalBaseDmg,
            baseHealth: totalBaseHp,
            damage: totalDmg,
            health: totalHp,
            damageBonus: skillPassiveDamageBonus,
            healthBonus: skillPassiveHealthBonus,
            ascensionDmgMulti,
            ascensionHpMulti,
            activeDamageMulti: (1 + (techModifiers['SkillDamage'] || 0)) * (ascActiveDmgMulti || 1),
            activeHealthMulti: (1 + (techModifiers['SkillDamage'] || 0)) * (ascActiveHpMulti || 1)
        };
    }, [passives, skillPassiveLibrary, skillLibrary, skillPassiveDamageBonus, skillPassiveHealthBonus, ascensionDmgMulti, ascensionHpMulti, profile.misc.skillAscensionLevel, techModifiers]);

    const toggleRarity = (rarity: string) => {
        setActiveRarity(prev => prev === rarity ? null : rarity);
    };

    const ownedCount = Object.values(passives).filter(l => l > 0).length;
    const totalSkills = Object.keys(skillLibrary || {}).length;

    return (
        <Card className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-6 h-6 sm:w-8 h-8 text-yellow-400" />
                    <h2 className="text-lg sm:text-xl font-bold">Skill Passives</h2>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="text-[10px] sm:text-xs font-normal text-text-muted mr-auto sm:mr-2">
                        {ownedCount}/{totalSkills}
                    </span>
                    <button
                        onClick={isUndoVisible ? handleUndo : handleResetAll}
                        className={cn(
                            "flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold transition-all border",
                            isUndoVisible 
                                ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20" 
                                : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                        )}
                        title={isUndoVisible ? "Undo Reset" : "Reset All to 0"}
                    >
                        {isUndoVisible ? (
                            <><RotateCcw className="w-3 h-3" />Undo</>
                        ) : (
                            <><Trash2 className="w-3 h-3" />Reset</>
                        )}
                    </button>
                    <div className="scale-90 sm:scale-100 origin-right">
                        <AscensionStars
                            value={profile.misc.skillAscensionLevel || 0}
                            onChange={(val) => updateNestedProfile('misc', { skillAscensionLevel: val })}
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30 text-center">
                    <div className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Passive DMG</div>
                    <div className="font-mono font-bold text-red-400 text-lg">
                        +{formatCompactNumber(totals.damage)}
                        {(totals.damageBonus > 0 || totals.ascensionDmgMulti > 0) && (
                            <span className="text-green-400 text-xs ml-1">(+{( ((1 + skillPassiveDamageBonus) * (ascensionDmgMulti || 1) - 1) * 100).toFixed(0)}%)</span>
                        )}
                    </div>
                </div>
                <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/30 text-center">
                    <div className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Passive HP</div>
                    <div className="font-mono font-bold text-green-400 text-lg">
                        +{formatCompactNumber(totals.health)}
                        {(totals.healthBonus > 0 || totals.ascensionHpMulti > 0) && (
                            <span className="text-green-400 text-xs ml-1">(+{( (totals.healthBonus + totals.ascensionHpMulti) * 100).toFixed(0)}%)</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                {RARITIES.map(rarity => {
                    const skills = skillsByRarity[rarity] || [];
                    if (skills.length === 0) return null;
                    const isExpanded = activeRarity === rarity;
                    const rarityOwned = skills.filter(s => (passives[s.id] || 0) > 0).length;

                    return (
                        <div key={rarity} className="bg-bg-secondary/40 rounded-xl border border-border overflow-hidden">
                            <button
                                onClick={() => toggleRarity(rarity)}
                                className={cn(
                                    "w-full flex items-center justify-between p-3 hover:bg-bg-input/30 transition-colors",
                                    `border-l-4 border-rarity-${rarity.toLowerCase()}`
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={cn("font-bold", `text-rarity-${rarity.toLowerCase()}`)}>{rarity}</span>
                                    <span className="text-xs text-text-muted">({rarityOwned}/{skills.length})</span>
                                </div>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                            </button>

                            {isExpanded && (
                                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-border/50">
                                    {skills.map(skill => {
                                        const spriteInfo = getSpriteInfo(skill.id);
                                        const level = passives[skill.id] || 0;
                                        const stats = getSkillStats(skill.id, level);

                                        return (
                                            <ItemSelectionCard
                                                key={skill.id}
                                                item={{ id: skill.id, rarity: skill.rarity, level } as any}
                                                slotKey="Skill"
                                                slotLabel="Skill"
                                                itemName={skill.id}
                                                itemImage={null}
                                                variant={isCompactStats ? 'compact' : 'default'}
                                                rarity={rarity}
                                                hideAgeStyles={true}
                                                renderIcon={() => (
                                                    <div
                                                        className={cn(
                                                            "w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden shrink-0 border border-white/10 shadow-inner",
                                                            `border-rarity-${rarity.toLowerCase()}`
                                                        )}
                                                        style={getRarityBgStyle(rarity)}
                                                    >
                                                        {spriteInfo ? (
                                                            <SpriteSheetIcon
                                                                textureSrc={getAscensionTexturePath('SkillIcons', profile.misc.skillAscensionLevel || 0, selectedVersion)}
                                                                spriteWidth={spriteInfo.config.sprite_size.width}
                                                                spriteHeight={spriteInfo.config.sprite_size.height}
                                                                sheetWidth={spriteInfo.config.texture_size.width}
                                                                sheetHeight={spriteInfo.config.texture_size.height}
                                                                iconIndex={spriteInfo.spriteIndex}
                                                                className="w-10 h-10"
                                                            />
                                                        ) : (
                                                            <Sparkles className="w-5 h-5 text-text-muted" />
                                                        )}
                                                    </div>
                                                )}
                                                stats={stats && level > 0 ? {
                                                    damage: stats.damage,
                                                    health: stats.health,
                                                    damageLabel: "P. DMG",
                                                    healthLabel: "P. HP",
                                                    damageMulti: (1 + stats.damageBonus) * (stats.ascensionDmgMulti || 1),
                                                    healthMulti: (1 + stats.healthBonus) * (stats.ascensionHpMulti || 1),
                                                    details: {
                                                        damage: { 
                                                            base: stats.baseDamage,
                                                            techMulti: 1 + stats.damageBonus,
                                                            ascMulti: stats.ascensionDmgMulti || 1
                                                        },
                                                        health: { 
                                                            base: stats.baseHealth,
                                                            techMulti: 1 + stats.healthBonus,
                                                            ascMulti: stats.ascensionHpMulti || 1
                                                        }
                                                    }
                                                } : {
                                                    damage: 0,
                                                    health: 0,
                                                    damageLabel: "P. DMG",
                                                    healthLabel: "P. HP"
                                                }}
                                                currentLevel={level}
                                                maxLevel={skillPassiveLibrary?.[skill.rarity]?.LevelStats?.length || 299}
                                                onLevelChange={(delta) => handleLevelChange(skill.id, level + delta)}
                                                onLevelSet={(newLevel) => handleLevelChange(skill.id, newLevel)}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}
