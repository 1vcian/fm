import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useTreeModifiers } from '../../hooks/useCalculatedStats';
import { Card } from '../UI/Card';
import { Sparkles, ChevronDown, ChevronUp, Plus, Minus } from 'lucide-react';
import { Input } from '../UI/Input';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { useState, useMemo } from 'react';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { formatCompactNumber } from '../../utils/statsCalculator';

interface SkillInfo {
    id: string;
    rarity: string;
}

const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;
const SKILL_MAX_LEVEL = 299; // From SkillBaseConfig.json

interface SkillsPassivesPanelProps {
    considerAnimation?: boolean;
}

export function SkillsPassivesPanel({ considerAnimation = false }: SkillsPassivesPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const globalStats = useGlobalStats();
    const techModifiers = useTreeModifiers();
    const [expandedRarities, setExpandedRarities] = useState<Set<string>>(new Set(['Common']));
    const [frequencyWindow, setFrequencyWindow] = useState<number>(60.00);

    // Tech tree bonuses for skill passives
    const skillPassiveDamageBonus = techModifiers['SkillPassiveDamage'] || 0;
    const skillPassiveHealthBonus = techModifiers['SkillPassiveHealth'] || 0;
    const skillCooldownReduction = globalStats?.skillCooldownReduction || 0;

    // Get all skills organized by rarity
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
        const clampedLevel = Math.max(0, Math.min(newLevel, SKILL_MAX_LEVEL));
        const updatedPassives = { ...passives, [skillId]: clampedLevel };

        // Sync with equipped
        const equipped = profile.skills.equipped || [];
        const updatedEquipped = equipped.map(s =>
            s.id === skillId ? { ...s, level: Math.max(1, clampedLevel) } : s
        );

        updateNestedProfile('skills', { passives: updatedPassives, equipped: updatedEquipped });
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

    // Get individual skill stats (base and with bonus)
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

        // Apply tech tree bonuses and round to integer (as the game does)
        // Game shows: Arrows Lv20 = DMG +75, HP +600 (not 75.04, 600.32)
        // Apply tech tree bonuses and round to integer (as the game does)
        // Game shows: Arrows Lv20 = DMG +75, HP +600 (not 75.04, 600.32)
        const damage = Math.floor(baseDamage * (1 + skillPassiveDamageBonus));
        const health = Math.floor(baseHealth * (1 + skillPassiveHealthBonus));

        const baseCooldown = skillData.Cooldown || 0;
        const cooldown = baseCooldown * Math.max(0.1, 1 - skillCooldownReduction);

        return {
            baseDamage,
            baseHealth,
            damage,
            health,
            damageBonus: skillPassiveDamageBonus,
            healthBonus: skillPassiveHealthBonus,
            baseCooldown,
            cooldown,
            cooldownReduction: skillCooldownReduction
        };
    };

    // Calculate totals from passives (with tech tree bonuses)
    const totals = useMemo(() => {
        let totalBaseDmg = 0, totalBaseHp = 0;
        let totalDmg = 0, totalHp = 0;
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
            healthBonus: skillPassiveHealthBonus
        };
    }, [passives, skillPassiveLibrary, skillLibrary, skillPassiveDamageBonus, skillPassiveHealthBonus]);

    const toggleRarity = (rarity: string) => {
        setExpandedRarities(prev => {
            const newSet = new Set(prev);
            if (newSet.has(rarity)) newSet.delete(rarity);
            else newSet.add(rarity);
            return newSet;
        });
    };

    const ownedCount = Object.values(passives).filter(l => l > 0).length;
    const totalSkills = Object.keys(skillLibrary || {}).length;

    return (
        <Card className="p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <img src="./Texture2D/TechTreePower.png" alt="Skill Passives" className="w-8 h-8 object-contain" />
                Skill Passives
                <span className="text-sm font-normal text-text-muted ml-auto">
                    {ownedCount}/{totalSkills}
                </span>
            </h2>

            {/* Frequency Window Input */}
            <div className="flex items-center gap-2 mb-4 bg-bg-input/50 p-2 rounded-lg border border-border/30">
                <span className="text-xs text-text-muted">Window:</span>
                <Input
                    type="text"
                    inputMode="decimal"
                    value={frequencyWindow}
                    onChange={(e) => {
                        const val = e.target.value.replace(',', '.');
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0) {
                            setFrequencyWindow(num);
                        }
                    }}
                    className="w-16 h-7 text-xs text-right bg-bg-primary border-border/50"
                />
                <span className="text-xs text-text-muted">sec</span>
            </div>

            {/* Totals Display */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30 text-center">
                    <div className="text-xs text-text-muted uppercase">Passive DMG</div>
                    <div className="font-mono font-bold text-red-400 text-lg">
                        +{formatCompactNumber(totals.damage)}
                        {totals.damageBonus > 0 && (
                            <span className="text-green-400 text-xs ml-1">(+{(totals.damageBonus * 100).toFixed(0)}%)</span>
                        )}
                    </div>
                </div>
                <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/30 text-center">
                    <div className="text-xs text-text-muted uppercase">Passive HP</div>
                    <div className="font-mono font-bold text-green-400 text-lg">
                        +{formatCompactNumber(totals.health)}
                        {totals.healthBonus > 0 && (
                            <span className="text-green-400 text-xs ml-1">(+{(totals.healthBonus * 100).toFixed(0)}%)</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Skills by rarity */}
            <div className="space-y-3">
                {RARITIES.map(rarity => {
                    const skills = skillsByRarity[rarity] || [];
                    if (skills.length === 0) return null;
                    const isExpanded = expandedRarities.has(rarity);
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
                                    <span className={cn("font-bold", `text-rarity-${rarity.toLowerCase()}`)}>
                                        {rarity}
                                    </span>
                                    <span className="text-xs text-text-muted">
                                        ({rarityOwned}/{skills.length})
                                    </span>
                                </div>
                                {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-text-muted" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-text-muted" />
                                )}
                            </button>

                            {isExpanded && (
                                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-border/50">
                                    {skills.map(skill => {
                                        const spriteInfo = getSpriteInfo(skill.id);
                                        const level = passives[skill.id] || 0;
                                        const stats = getSkillStats(skill.id, level);

                                        return (
                                            <div
                                                key={skill.id}
                                                className={cn(
                                                    "p-2 rounded-lg border transition-colors overflow-hidden",
                                                    level > 0
                                                        ? "bg-bg-input/50 border-border"
                                                        : "bg-bg-input/20 border-border/30 opacity-60"
                                                )}
                                            >
                                                <div className="flex items-center gap-2 mb-2">
                                                    <div
                                                        className={cn(
                                                            "w-8 h-8 rounded flex items-center justify-center overflow-hidden shrink-0",
                                                            `border border-rarity-${rarity.toLowerCase()}`
                                                        )}
                                                        style={getRarityBgStyle(rarity)}
                                                    >
                                                        {spriteInfo ? (
                                                            <SpriteSheetIcon
                                                                textureSrc="./icons/game/SkillIcons.png"
                                                                spriteWidth={spriteInfo.config.sprite_size.width}
                                                                spriteHeight={spriteInfo.config.sprite_size.height}
                                                                sheetWidth={spriteInfo.config.texture_size.width}
                                                                sheetHeight={spriteInfo.config.texture_size.height}
                                                                iconIndex={spriteInfo.spriteIndex}
                                                                className="w-8 h-8"
                                                            />
                                                        ) : (
                                                            <Sparkles className="w-4 h-4 text-text-muted" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-medium truncate" title={skill.id}>
                                                            {skill.id}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Level Input */}
                                                <div className="flex items-center gap-1 mb-2 bg-bg-input rounded-lg p-1">
                                                    <button
                                                        onClick={() => handleLevelChange(skill.id, level - 1)}
                                                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary shrink-0"
                                                    >
                                                        <Minus className="w-3 h-3" />
                                                    </button>
                                                    <Input
                                                        type="number"
                                                        value={level}
                                                        onChange={(e) => handleLevelChange(skill.id, parseInt(e.target.value) || 0)}
                                                        className="flex-1 h-6 text-xs text-center min-w-[40px] bg-transparent border-0 focus-visible:ring-0 p-0"
                                                        placeholder="0"
                                                        min={0}
                                                        max={SKILL_MAX_LEVEL}
                                                    />
                                                    <button
                                                        onClick={() => handleLevelChange(skill.id, level + 1)}
                                                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary shrink-0"
                                                    >
                                                        <Plus className="w-3 h-3" />
                                                    </button>
                                                </div>

                                                {/* Individual Skill Stats with bonus display */}
                                                {stats && level > 0 && (
                                                    <div className="space-y-1 text-[9px]">
                                                        <div className="bg-red-500/10 rounded px-1 py-0.5 flex flex-col min-[400px]:flex-row items-end min-[400px]:items-center justify-between gap-1">
                                                            <span className="text-text-muted self-start min-[400px]:self-auto">DMG</span>
                                                            <span className="text-red-400 font-mono text-right break-words leading-tight">
                                                                +{Math.round(stats.damage).toLocaleString()}
                                                                {stats.damageBonus > 0 && (
                                                                    <span className="text-green-400 ml-0.5 text-[8px] inline-block">(+{(stats.damageBonus * 100).toFixed(0)}%)</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="bg-green-500/10 rounded px-1 py-0.5 flex flex-col min-[400px]:flex-row items-end min-[400px]:items-center justify-between gap-1">
                                                            <span className="text-text-muted self-start min-[400px]:self-auto">HP</span>
                                                            <span className="text-green-400 font-mono text-right break-words leading-tight">
                                                                +{Math.round(stats.health).toLocaleString()}
                                                                {stats.healthBonus > 0 && (
                                                                    <span className="text-green-400 ml-0.5 text-[8px] inline-block">(+{(stats.healthBonus * 100).toFixed(0)}%)</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="bg-blue-500/10 rounded px-1 py-0.5 flex flex-col min-[400px]:flex-row items-end min-[400px]:items-center justify-between gap-1">
                                                            <span className="text-text-muted self-start min-[400px]:self-auto">CD</span>
                                                            <span className="text-blue-400 font-mono text-right break-words leading-tight">
                                                                {stats.cooldown.toFixed(2)}s
                                                                {stats.cooldownReduction > 0 && (
                                                                    <span className="text-green-400 ml-0.5 text-[8px] inline-block">(-{(stats.cooldownReduction * 100).toFixed(0)}%)</span>
                                                                )}
                                                            </span>
                                                        </div>

                                                        {/* Advanced Metrics */}
                                                        {(() => {
                                                            // 1. Get ActiveDuration from SkillLibrary
                                                            const skillInfo = skillLibrary[skill.id];
                                                            const activeDuration = skillInfo?.ActiveDuration || 0;

                                                            const rawCd = stats.cooldown;
                                                            const reduction = globalStats?.skillCooldownReduction || 0;
                                                            // New Formula: Cycle = (Base * (1 - Red)) + Duration
                                                            const cdComponent = rawCd * Math.max(0.1, 1 - reduction);
                                                            const effCd = cdComponent + activeDuration;
                                                            // Sync Logic with SkillPanel
                                                            const START_TIME = 5.0;
                                                            const WINDOW = frequencyWindow;
                                                            const ANIM_DURATION = considerAnimation ? 0.5 : 0;

                                                            let activations = 0;
                                                            let lastHit = 0;

                                                            if (WINDOW >= START_TIME) {
                                                                const firstHitTime = START_TIME + ANIM_DURATION;

                                                                if (firstHitTime <= WINDOW) {
                                                                    const availableTime = WINDOW - firstHitTime;
                                                                    const additionalActivations = Math.floor(availableTime / effCd);
                                                                    activations = 1 + additionalActivations;
                                                                    lastHit = firstHitTime + (additionalActivations * effCd);
                                                                }
                                                            }

                                                            return (
                                                                <div className="flex gap-4 mt-1 pt-1 border-t border-border/20 justify-center">
                                                                    <div className="flex flex-col items-center">
                                                                        <span className="text-[9px] text-text-muted uppercase">Hits</span>
                                                                        <span className="font-mono font-bold text-white">
                                                                            {activations}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex flex-col items-center">
                                                                        <span className="text-[9px] text-text-muted uppercase">
                                                                            Last Hit {considerAnimation ? '(incl. 0.5s)' : ''}
                                                                        </span>
                                                                        <span className="font-mono font-bold text-white">
                                                                            {lastHit.toFixed(1)}s
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
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
