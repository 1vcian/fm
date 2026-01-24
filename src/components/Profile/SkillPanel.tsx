import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { Card } from '../UI/Card';
import { Zap, Plus, X, Minus } from 'lucide-react';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { SkillSlot } from '../../types/Profile';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { useState } from 'react';
import { MAX_ACTIVE_SKILLS, SKILL_MECHANICS } from '../../utils/constants';
import { SkillSelectorModal } from './SkillSelectorModal';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';

interface SkillPanelProps {
    considerAnimation?: boolean;
    setConsiderAnimation?: (value: boolean) => void;
}

export function SkillPanel({ considerAnimation = false, setConsiderAnimation }: SkillPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const globalStats = useGlobalStats();
    const equippedSkills = profile.skills.equipped;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [frequencyWindow, setFrequencyWindow] = useState(60);

    // Tech tree bonuses for skills (Now handled via globalStats)
    // SkillDamage affects active skill damage/health
    // SkillPassiveDamage/SkillPassiveHealth affects passive skill damage/health

    const handleRemove = (index: number) => {
        const newSkills = [...equippedSkills];
        newSkills.splice(index, 1);
        updateNestedProfile('skills', { equipped: newSkills });
    };

    const handleUpdateLevel = (index: number, newLevel: number) => {
        const skill = equippedSkills[index];
        let maxLevel = 9999;

        if (skillLibrary && skillLibrary[skill.id]) {
            const data = skillLibrary[skill.id];
            maxLevel = Math.max(data.DamagePerLevel?.length || 0, data.HealthPerLevel?.length || 0);
        }

        const clampedLevel = Math.max(1, Math.min(newLevel, maxLevel));
        const newSkills = [...equippedSkills];
        newSkills[index] = { ...skill, level: clampedLevel };

        // Sync with passives
        const currentPassives = profile.skills.passives || {};
        const updates: any = {
            equipped: newSkills,
            passives: { ...currentPassives, [skill.id]: clampedLevel }
        };
        updateNestedProfile('skills', updates);
    };

    const handleAdd = (skill: SkillSlot) => {
        if (equippedSkills.length >= MAX_ACTIVE_SKILLS) return;

        // Ensure level is at least 1
        const level = Math.max(1, skill.level);
        const skillToAdd = { ...skill, level };

        // Update equipped AND ensure passive level is updated if it was lower
        const currentPassives = profile.skills.passives || {};
        const currentPassiveLevel = currentPassives[skill.id] || 0;

        const updates: any = {
            equipped: [...equippedSkills, skillToAdd]
        };

        // Only update passive if the new active level is higher (or it was 0)
        if (level > currentPassiveLevel) {
            updates.passives = { ...currentPassives, [skill.id]: level };
        }

        updateNestedProfile('skills', updates);
        setIsModalOpen(false);
    };

    // --- Skill Configuration Overrides (Manual from C# Analysis) ---
    // Make sure this matches BattleSimulator!
    // SKILL_MECHANICS now imported from constants


    const getSkillStats = (skill: SkillSlot) => {
        if (!skillLibrary) return null;
        const skillData = skillLibrary[skill.id];
        if (!skillData) return null;

        const levelIdx = skill.level - 1;
        let damage = skillData.DamagePerLevel?.[levelIdx] || 0;
        let health = skillData.HealthPerLevel?.[levelIdx] || 0;
        const duration = skillData.ActiveDuration || 0;
        const cooldown = skillData.Cooldown || 0;

        // Apply Global Multipliers (Aggregated from Items, Pets, Tech Tree)
        const skillFactor = globalStats?.skillDamageMultiplier || 1;
        const globalFactor = globalStats?.damageMultiplier || 1;
        const mountFactor = globalStats?.mountDamageMulti || 0;

        // Remove Mount Damage from global factor for Active Skills
        const totalDamageMulti = skillFactor + (globalFactor - mountFactor) - 1;

        // Health Formula (Skill Healing):
        // User Request: Healing should match Damage Logic (include Generic Damage from Pets/Items, exclude Innate Mount).
        const totalHealthMulti = totalDamageMulti;

        damage = damage * totalDamageMulti;
        health = health * totalHealthMulti;

        // Apply Multi-Hit Logic for Display
        const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };

        // User Request: Multi-hit skills in library ALREADY contain TOTAL damage.
        // So 'damage' variable here is the Total Damage.
        // UNLESS specific exception (e.g. StrafeRun defined as per-hit in SKILL_MECHANICS)
        const totalDamageDisplay = mechanics.damageIsPerHit ? damage * mechanics.count : damage;

        const damagePerHit = mechanics.damageIsPerHit
            ? damage
            : (mechanics.count > 1 ? damage / mechanics.count : damage);

        return {
            damage: damagePerHit, // Returning per-hit as 'damage' to maintain prop semantic if used elsewhere as "base"
            totalDamage: totalDamageDisplay,
            count: mechanics.count,
            health,
            duration,
            cooldown,
            damageBonus: totalDamageMulti - 1,
            healthBonus: totalHealthMulti - 1
        };
    };

    const getSpriteInfo = (skillId: string) => {
        if (!spriteMapping?.skills?.mapping) return null;
        // Mapping is index -> { name: "Meat" ... }
        // Find entry with name === skillId
        const entry = Object.entries(spriteMapping.skills.mapping).find(([_, val]: [string, any]) => val.name === skillId);
        if (entry) {
            return {
                spriteIndex: parseInt(entry[0]),
                config: spriteMapping.skills
            };
        }
        return null;
    };



    return (
        <Card className="p-6">
            <div className="flex flex-col gap-3 mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <img src="./Texture2D/SkillTabIcon.png" alt="Active Skills" className="w-8 h-8 object-contain" />
                    Active Skills
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                    {setConsiderAnimation && (
                        <button
                            onClick={() => setConsiderAnimation(!considerAnimation)}
                            className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${considerAnimation
                                ? 'bg-accent-primary text-black border-accent-primary'
                                : 'bg-transparent text-text-muted border-text-muted/30 hover:border-text-muted'
                                }`}
                            title="Toggle Animation Duration (+0.5s)"
                        >
                            ANIM {considerAnimation ? 'ON' : 'OFF'}
                        </button>
                    )}
                    <div className="flex items-center gap-2 bg-bg-input/50 p-1.5 rounded border border-border/30">
                        <span className="text-xs text-text-muted whitespace-nowrap px-1">Window:</span>
                        <Input
                            type="text"
                            step="0.1"
                            value={frequencyWindow}
                            onChange={(e) => setFrequencyWindow(parseFloat(e.target.value.replace(',', '.')) || 60)}
                            className="w-24 text-center h-8 font-mono font-bold text-xs bg-bg-secondary/50"
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                {equippedSkills.map((skill, idx) => {
                    const stats = getSkillStats(skill);
                    const spriteInfo = getSpriteInfo(skill.id);

                    return (
                        <div key={idx} className="bg-bg-secondary/40 rounded-xl border border-border p-3 flex flex-col gap-3">
                            {/* Header: Icon & Info */}
                            <div className="flex items-start gap-3">
                                <div
                                    className={cn(
                                        "w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center border-2 shadow-sm overflow-hidden shrink-0 bg-bg-primary/50",
                                        `border-rarity-${skill.rarity.toLowerCase()}`
                                    )}
                                    style={getRarityBgStyle(skill.rarity)}
                                >
                                    {spriteInfo ? (
                                        <SpriteSheetIcon
                                            textureSrc="./icons/game/SkillIcons.png"
                                            spriteWidth={spriteInfo.config.sprite_size.width}
                                            spriteHeight={spriteInfo.config.sprite_size.height}
                                            sheetWidth={spriteInfo.config.texture_size.width}
                                            sheetHeight={spriteInfo.config.texture_size.height}
                                            iconIndex={spriteInfo.spriteIndex}
                                            className="w-10 h-10 sm:w-12 sm:h-12"
                                        />
                                    ) : (
                                        <Zap className={cn("w-6 h-6", `text-rarity-${skill.rarity.toLowerCase()}`)} />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1 flex flex-col justify-center min-h-[3rem]">
                                    <div className="font-bold text-sm sm:text-base leading-tight break-words">{skill.id}</div>
                                    <div className={cn("text-[10px] sm:text-xs font-bold uppercase", `text-rarity-${skill.rarity.toLowerCase()}`)}>
                                        {skill.rarity}
                                    </div>
                                </div>
                            </div>

                            {/* Level Controls */}
                            <div className="flex items-center justify-between bg-bg-input/50 p-1.5 rounded-lg border border-border/50">
                                <span className="text-[10px] mobile-s:text-xs font-bold uppercase text-text-muted pl-1">Level</span>
                                <div className="flex items-center gap-1 sm:gap-2">
                                    <Button variant="ghost" size="sm" className="h-6 w-6 sm:h-7 sm:w-7 p-0" onClick={() => handleUpdateLevel(idx, skill.level - 1)}>
                                        <Minus className="w-3 h-3 sm:w-4 sm:h-4" />
                                    </Button>
                                    <Input
                                        type="number"
                                        value={skill.level}
                                        onChange={(e) => handleUpdateLevel(idx, parseInt(e.target.value) || 1)}
                                        className="w-12 sm:w-16 text-center h-6 sm:h-7 font-mono font-bold text-xs sm:text-sm bg-bg-secondary p-0"
                                        onFocus={(e) => e.target.select()}
                                    />
                                    <Button variant="ghost" size="sm" className="h-6 w-6 sm:h-7 sm:w-7 p-0" onClick={() => handleUpdateLevel(idx, skill.level + 1)}>
                                        <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Stats & Metrics */}
                            {stats && (
                                <div className="space-y-2 text-xs">
                                    {/* Primary Stats */}
                                    <div className={cn("grid grid-cols-1 gap-2", stats.damage > 0 && stats.health > 0 ? "sm:grid-cols-2" : "")}>
                                        {stats.damage > 0 && (
                                            <div className="bg-bg-input rounded p-2 border border-border/30 flex flex-col gap-0.5">
                                                <span className="text-text-muted text-[10px] uppercase">Damage {stats.count > 1 && <span className="text-accent-primary">(x{stats.count})</span>}</span>
                                                <div className="flex flex-wrap items-baseline gap-1">
                                                    <span className="font-mono font-bold text-accent-primary break-all leading-tight">
                                                        {Math.round(stats.totalDamage).toLocaleString()}
                                                    </span>
                                                    {stats.damageBonus > 0 && <span className="text-green-400 text-[10px] whitespace-nowrap">(+{(stats.damageBonus * 100).toFixed(0)}%)</span>}
                                                </div>
                                                {stats.count > 1 && (
                                                    <div className="text-[10px] text-text-muted mt-0.5">
                                                        ({Math.round(stats.damage).toLocaleString()} / hit)
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {stats.health > 0 && (
                                            <div className="bg-bg-input rounded p-2 border border-border/30 flex flex-col gap-0.5">
                                                <span className="text-text-muted text-[10px] uppercase">Health</span>
                                                <div className="flex flex-wrap items-baseline gap-1">
                                                    <span className="font-mono font-bold text-green-400 break-all leading-tight">
                                                        {Math.round(stats.health).toLocaleString()}
                                                    </span>
                                                    {stats.healthBonus > 0 && <span className="text-green-400 text-[10px] whitespace-nowrap">(+{(stats.healthBonus * 100).toFixed(0)}%)</span>}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Secondary Stats */}
                                    <div className="bg-bg-input rounded p-2 border border-border/30 flex items-center justify-between gap-2">
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-text-muted text-[10px] uppercase truncate">Cooldown</span>
                                            <div className="flex flex-wrap items-baseline gap-1">
                                                <span className="font-mono font-bold leading-tight">
                                                    {(stats.cooldown * Math.max(0.1, 1 - (globalStats?.skillCooldownReduction ?? 0))).toFixed(2)}s
                                                </span>
                                                {(globalStats?.skillCooldownReduction ?? 0) > 0 && (
                                                    <span className="text-green-400 text-[10px] whitespace-nowrap">
                                                        (-{(globalStats!.skillCooldownReduction * 100).toFixed(0)}%)
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="h-6 w-px bg-border/50 shrink-0" />
                                        <div className="flex flex-col text-right min-w-0">
                                            <span className="text-text-muted text-[10px] uppercase truncate">Duration</span>
                                            <span className="font-mono font-bold leading-tight">{stats.duration}s</span>
                                        </div>
                                    </div>

                                    {/* Advanced CD Metrics (Full Width) */}
                                    {(() => {
                                        const reduction = globalStats?.skillCooldownReduction || 0;
                                        const activeDuration = stats.duration || 0;
                                        const cdComponent = stats.cooldown * Math.max(0.1, 1 - reduction);
                                        const effCd = cdComponent + activeDuration;
                                        const ANIM_DURATION = considerAnimation ? 0.5 : 0;
                                        const START_TIME = 5.0;
                                        const WINDOW = frequencyWindow;

                                        let activations = 0;
                                        let lastHit = 0;
                                        let targetCd = 0;

                                        if (WINDOW >= START_TIME) {
                                            const firstHitTime = START_TIME + ANIM_DURATION;

                                            if (firstHitTime <= WINDOW) {
                                                const availableTime = WINDOW - firstHitTime;
                                                const additionalActivations = Math.floor(availableTime / effCd);
                                                activations = 1 + additionalActivations;
                                                lastHit = firstHitTime + (additionalActivations * effCd);

                                                const numerator = WINDOW - START_TIME - ANIM_DURATION;
                                                if (numerator > 0 && activations > 0) {
                                                    targetCd = Math.max(0, (numerator / activations) - activeDuration);
                                                }
                                            }
                                        }

                                        const diff = cdComponent - targetCd;

                                        return (
                                            <div className="bg-bg-secondary/30 rounded p-2 border border-border/30 space-y-2">
                                                <div className="flex justify-between items-center text-[10px] text-text-muted uppercase tracking-wider">
                                                    <span>Metrics ({WINDOW}s Window)</span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-center">
                                                    <div className="bg-bg-input/50 rounded p-1 flex flex-col justify-center min-h-[3rem]">
                                                        <div className="text-[9px] text-text-muted uppercase mb-1">Hits</div>
                                                        <div className="font-mono font-bold text-sm text-text-primary leading-none">{activations}</div>
                                                    </div>
                                                    <div className="bg-bg-input/50 rounded p-1 flex flex-col justify-center min-h-[3rem]">
                                                        <div className="text-[9px] text-text-muted uppercase mb-1">Last Hit</div>
                                                        <div className="font-mono font-bold text-sm text-text-primary leading-none break-all">{lastHit.toFixed(1)}s</div>
                                                    </div>
                                                    <div className="bg-bg-input/50 rounded p-1 flex flex-col justify-center min-h-[3rem] outline outline-1 outline-accent-primary/20 bg-accent-primary/5">
                                                        <div className="text-[9px] text-accent-primary uppercase mb-1">To +1 Hit</div>
                                                        <div className="font-mono font-bold text-xs text-accent-primary leading-none">{diff < 0 ? "-" : "+"}{Math.abs(diff).toFixed(2)}s</div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Footer: Actions */}
                            <div className="pt-2 mt-1 border-t border-border/30 flex justify-end">
                                <button
                                    onClick={() => handleRemove(idx)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-lg border border-red-400/20 transition-colors w-full sm:w-auto justify-center"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    <span>Remove</span>
                                </button>
                            </div>
                        </div>
                    );
                })}

                {equippedSkills.length < MAX_ACTIVE_SKILLS && (
                    <Button variant="outline" className="w-full border-dashed py-8 hover:bg-bg-secondary/50 group" onClick={() => setIsModalOpen(true)}>
                        <div className="flex flex-col items-center gap-2 text-text-muted group-hover:text-accent-primary transition-colors">
                            <Plus className="w-8 h-8" />
                            <span>Add Active Skill</span>
                        </div>
                    </Button>
                )}
            </div>

            <SkillSelectorModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSelect={handleAdd}
            />
        </Card >
    );
}
