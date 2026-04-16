import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { Card } from '../UI/Card';
import { Zap, Plus, X, Minus, Sword } from 'lucide-react';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { SkillSlot } from '../../types/Profile';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { useState, useMemo } from 'react';
import { MAX_ACTIVE_SKILLS, SKILL_MECHANICS } from '../../utils/constants';
import { SkillSelectorModal } from './SkillSelectorModal';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { AscensionStars } from '../UI/AscensionStars';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';

// Helper for truncation (sync with StatEngine)
const truncate = (value: number, decimals: number): number => {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor) / factor;
};

interface SkillPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    compareSkills?: SkillSlot[] | null;
    considerAnimation?: boolean;
    setConsiderAnimation?: (value: boolean) => void;
}

export function SkillPanel({ variant = 'default', title, compareSkills, considerAnimation = false, setConsiderAnimation }: SkillPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { 
        isComparing, 
        originalSkills, 
        testSkills, 
        originalSkillAscension, 
        testSkillAscension,
        updateOriginalSkill,
        updateTestSkill,
        updateOriginalSkillAscension,
        updateTestSkillAscension
    } = useComparison();
    const { optimizeSkills, isReady } = useProfileOptimizer();
    
    const equippedSkills = useMemo(() => {
        if (variant === 'original' && originalSkills) return originalSkills;
        if (variant === 'test' && testSkills) return testSkills;
        return profile.skills.equipped;
    }, [variant, originalSkills, testSkills, profile.skills.equipped]);

    const skillAscensionLevel = useMemo(() => {
        if (isComparing) {
            if (variant === 'original' && originalSkillAscension !== null) return originalSkillAscension;
            if (variant === 'test' && testSkillAscension !== null) return testSkillAscension;
        }
        return profile.misc.skillAscensionLevel || 0;
    }, [isComparing, variant, originalSkillAscension, testSkillAscension, profile.misc.skillAscensionLevel]);

    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const globalStats = useGlobalStats();
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [frequencyWindow, setFrequencyWindow] = useState(60);

    const updateSkills = (newSkills: SkillSlot[]) => {
        if (variant === 'original') updateOriginalSkill(newSkills);
        else if (variant === 'test') updateTestSkill(newSkills);
        else updateNestedProfile('skills', { equipped: newSkills });
    };

    const handleRemove = (index: number) => {
        const newSkills = [...equippedSkills];
        newSkills.splice(index, 1);
        updateSkills(newSkills);
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

        if (variant === 'default') {
            // Sync with passives only in default mode
            const currentPassives = profile.skills.passives || {};
            const updates: any = {
                equipped: newSkills,
                passives: { ...currentPassives, [skill.id]: clampedLevel }
            };
            updateNestedProfile('skills', updates);
        } else {
            updateSkills(newSkills);
        }
    };

    const handleSelectSkill = (skill: SkillSlot) => {
        const level = Math.max(1, skill.level);
        const skillToAdd = { ...skill, level };
        const updates: any = {};

        if (editingIdx !== null) {
            const newSkills = [...equippedSkills];
            newSkills[editingIdx] = skillToAdd;
            updateSkills(newSkills);
        } else {
            if (equippedSkills.length >= MAX_ACTIVE_SKILLS) return;
            updateSkills([...equippedSkills, skillToAdd]);
        }

        // Sync passives only in default mode
        if (variant === 'default') {
            const currentPassives = profile.skills.passives || {};
            const currentPassiveLevel = currentPassives[skill.id] || 0;
            if (level > currentPassiveLevel) {
                updateNestedProfile('skills', {
                    passives: { ...currentPassives, [skill.id]: level }
                });
            }
        }

        setIsModalOpen(false);
        setEditingIdx(null);
    };

    const handleAscensionChange = (val: number) => {
        if (isComparing) {
            if (variant === 'original') updateOriginalSkillAscension(val);
            else if (variant === 'test') updateTestSkillAscension(val);
        } else {
            updateNestedProfile('misc', { skillAscensionLevel: val });
        }
    };

    const handleAutoOptimize = () => {
        const best = optimizeSkills();
        if (best) updateSkills(best);
    };

    const getSkillStats = (skill: SkillSlot) => {
        if (!skillLibrary) return null;
        const skillData = skillLibrary[skill.id];
        if (!skillData) return null;

        const levelIdx = skill.level - 1;
        let damage = skillData.DamagePerLevel?.[levelIdx] || 0;
        let health = skillData.HealthPerLevel?.[levelIdx] || 0;
        const duration = skillData.ActiveDuration || 0;
        const cooldown = skillData.Cooldown || 0;

        const skillFactor = globalStats?.skillDamageMultiplier || 1;
        const globalFactor = globalStats?.damageMultiplier || 1;
        const totalDamageMulti = truncate(skillFactor + globalFactor - 1, 4);
        const totalHealthMulti = totalDamageMulti;

        damage = damage * totalDamageMulti;
        health = health * totalHealthMulti;

        const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
        const totalDamageDisplay = mechanics.damageIsPerHit ? damage * mechanics.count : damage;
        const damagePerHit = mechanics.damageIsPerHit
            ? damage
            : (mechanics.count > 1 ? damage / mechanics.count : damage);

        return {
            damage: damagePerHit,
            totalDamage: totalDamageDisplay,
            count: mechanics.count,
            health,
            duration,
            cooldown,
            multi: totalDamageMulti,
            damageBonus: totalDamageMulti - 1,
            healthBonus: totalHealthMulti - 1
        };
    };

    const getSpriteInfo = (skillId: string) => {
        if (!spriteMapping?.skills?.mapping) return null;
        const entry = Object.entries(spriteMapping.skills.mapping).find(([_, val]: [string, any]) => val.name === skillId);
        if (entry) {
            return {
                spriteIndex: parseInt(entry[0]),
                config: spriteMapping.skills
            };
        }
        return null;
    };

    const checkDiff = (index: number) => {
        if (variant !== 'test' || !compareSkills) return false;
        const current = equippedSkills[index];
        const original = compareSkills[index];
        if (!current && !original) return false;
        if (!current || !original) return true;
        return current.id !== original.id || current.level !== original.level;
    };

    const panelTitle = title || 'Active Skills';

    return (
        <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <img src={`${import.meta.env.BASE_URL}Texture2D/SkillTabIcon.png`} alt="Active Skills" className="w-8 h-8 object-contain" />
                    {panelTitle}

                    <div className="flex items-center gap-1.5 ml-4">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="h-7 px-2 text-[10px] font-bold border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 gap-1 active:scale-95 transition-all"
                            onClick={handleAutoOptimize}
                            disabled={!isReady || !skillLibrary || Object.keys(skillLibrary).length < 1}
                            title="Select best 3 active skills for Max DPS"
                        >
                            <Sword className="w-3 h-3" />
                            AUTO DPS
                        </Button>
                    </div>
                </h2>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className="scale-90 sm:scale-100 origin-right">
                        <AscensionStars
                            value={skillAscensionLevel}
                            onChange={handleAscensionChange}
                        />
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-4">
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
                        type="number"
                        step="1"
                        min="1"
                        value={frequencyWindow}
                        onChange={(e) => setFrequencyWindow(parseFloat(e.target.value) || 1)}
                        className="w-16 h-8 text-center font-mono font-bold text-xs bg-bg-secondary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {equippedSkills.map((skill, idx) => {
                    const stats = getSkillStats(skill);
                    if (!stats) return null;
                    const spriteInfo = getSpriteInfo(skill.id);
                    const hasDiff = checkDiff(idx);

                    return (
                        <ItemSelectionCard
                            key={idx}
                            item={skill}
                            slotKey="ActiveSkill"
                            slotLabel="Skill"
                            itemName={skill.id}
                            itemImage={null}
                            rarity={skill.rarity}
                            hideAgeStyles={true}
                            hasDiff={hasDiff}
                            globalAscensionLevel={skillAscensionLevel}
                            onUnequip={(e) => {
                                e.stopPropagation();
                                handleRemove(idx);
                            }}
                            onLevelChange={(delta, e) => {
                                e.stopPropagation();
                                handleUpdateLevel(idx, skill.level + delta);
                            }}
                            onAscensionChange={handleAscensionChange}
                            onClick={() => setEditingIdx(idx)}
                            renderIcon={() => (
                                spriteInfo ? (
                                    <SpriteSheetIcon
                                        textureSrc={getAscensionTexturePath('SkillIcons', skillAscensionLevel)}
                                        spriteWidth={spriteInfo.config.sprite_size.width}
                                        spriteHeight={spriteInfo.config.sprite_size.height}
                                        sheetWidth={spriteInfo.config.texture_size.width}
                                        sheetHeight={spriteInfo.config.texture_size.height}
                                        iconIndex={spriteInfo.spriteIndex}
                                        className="w-10 h-10"
                                    />
                                ) : (
                                    <Zap className={cn("w-6 h-6", `text-rarity-${skill.rarity.toLowerCase()}`)} />
                                )
                            )}
                            stats={{
                                damage: stats.damage,
                                health: stats.health,
                                isMelee: false
                            }}
                            perfection={null}
                            getStatPerfection={() => null}
                            rarity={skill.rarity}
                            customStats={
                                <div className="w-full flex flex-col gap-1.5 mt-1">
                                    <div className="flex flex-col gap-1 w-full">
                                        {stats.damage > 0 && (
                                            <div className="bg-red-400/10 rounded p-1 border border-red-400/20 flex flex-col items-center">
                                                <div className="flex items-center gap-1 text-red-400">
                                                    <span className="text-[10px] font-bold uppercase">Damage</span>
                                                    {stats.count > 1 && <span className="text-[9px] font-bold opacity-80">(x{stats.count})</span>}
                                                    {(() => {
                                                        const mech = SKILL_MECHANICS[skill.id];
                                                        if (mech?.count === 0) {
                                                            return (
                                                                <span className="text-[8px] bg-green-500/20 px-1 rounded border border-green-500/30 ml-1 text-green-400">CONTINUOUS</span>
                                                            );
                                                        }
                                                        return mech?.isAOE ? (
                                                            <span className="text-[8px] bg-red-500/20 px-1 rounded border border-red-500/30 ml-1">AOE</span>
                                                        ) : (
                                                            <span className="text-[8px] bg-blue-500/20 px-1 rounded border border-blue-500/30 ml-1 text-blue-400">SINGLE</span>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="text-sm font-mono font-bold text-red-400 leading-tight">
                                                    {Math.round(stats.totalDamage).toLocaleString()}
                                                </div>
                                                {stats.count > 1 && (
                                                    <div className="text-[8px] text-red-400/60 font-mono italic">
                                                        ({Math.round(stats.damage).toLocaleString()} / hit)
                                                    </div>
                                                )}
                                                <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center gap-1 mt-0.5">
                                                    <span>x{stats.multi.toFixed(2)}</span>
                                                    <span className="text-green-400/80">({((stats.multi - 1) * 100).toFixed(1)}%)</span>
                                                </div>
                                            </div>
                                        )}
                                        {stats.health > 0 && (
                                            <div className="bg-green-400/10 rounded p-1 border border-green-400/20 flex flex-col items-center">
                                                <div className="text-[10px] text-green-400 uppercase font-bold">Healing</div>
                                                <div className="text-sm font-mono font-bold text-green-400 leading-tight">
                                                    {Math.round(stats.health).toLocaleString()}
                                                </div>
                                                <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center gap-1">
                                                    <span>x{stats.multi.toFixed(2)}</span>
                                                    <span className="text-green-400/80">({((stats.multi - 1) * 100).toFixed(1)}%)</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-bg-input/50 rounded p-1 flex items-center justify-between text-[10px]">
                                        <div className="flex flex-col">
                                            <span className="text-text-muted text-[8px] uppercase">CD</span>
                                            <span className="font-mono font-bold">
                                                {(stats.cooldown * Math.max(0.1, 1 - (globalStats?.skillCooldownReduction ?? 0))).toFixed(1)}s
                                            </span>
                                        </div>
                                        <div className="h-4 w-px bg-border/30" />
                                        <div className="flex flex-col text-right">
                                            <span className="text-text-muted text-[8px] uppercase">DUR</span>
                                            <span className="font-mono font-bold">{stats.duration}s</span>
                                        </div>
                                    </div>

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
                                            <div className="grid grid-cols-3 gap-1 text-[9px]">
                                                <div className="bg-bg-input/30 rounded flex flex-col items-center py-0.5" title="Activations in window">
                                                    <span className="text-[7px] text-text-muted uppercase">Hits</span>
                                                    <span className="font-bold">{activations}</span>
                                                </div>
                                                <div className="bg-bg-input/30 rounded flex flex-col items-center py-0.5" title="Time of last activation">
                                                    <span className="text-[7px] text-text-muted uppercase">Last</span>
                                                    <span className="font-bold">{lastHit.toFixed(1)}s</span>
                                                </div>
                                                <div 
                                                    className={cn(
                                                        "rounded flex flex-col items-center py-0.5",
                                                        diff < 0 ? "bg-red-400/10 text-red-400" : "bg-accent-primary/10 text-accent-primary"
                                                    )} 
                                                    title={`Needed CDR change: ${((Math.abs(diff) / stats.cooldown) * 100).toFixed(2)}%`}
                                                >
                                                    <span className="text-[7px] uppercase">To+1</span>
                                                    <div className="flex flex-col items-center leading-none">
                                                        <span className="font-bold">{Math.abs(diff).toFixed(2)}s</span>
                                                        <span className="text-[7px] opacity-80">({((Math.abs(diff) / stats.cooldown) * 100).toFixed(1)}%)</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            }
                        />
                    );
                })}

                {equippedSkills.length < MAX_ACTIVE_SKILLS && (
                    <div
                        onClick={() => setIsModalOpen(true)}
                        className={cn(
                            "h-full rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 cursor-pointer transition-colors relative flex flex-col items-center justify-center p-3 gap-2 group bg-bg-input/30 min-h-[160px]",
                            variant === 'test' && compareSkills && equippedSkills.length !== compareSkills.length && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
                        )}
                    >
                        <Plus className="w-8 h-8 text-text-muted group-hover:text-accent-primary transition-colors" />
                        <span className="text-sm text-text-muted group-hover:text-accent-primary transition-colors font-bold">Add Skill</span>
                    </div>
                )}
            </div>

            <SkillSelectorModal
                isOpen={isModalOpen || editingIdx !== null}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingIdx(null);
                }}
                onSelect={handleSelectSkill}
                currentSkill={editingIdx !== null ? equippedSkills[editingIdx] : undefined}
            />
        </Card >
    );
}
