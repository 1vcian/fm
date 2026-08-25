import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { Card } from '../UI/Card';
import { Flame, Plus, Sword, RotateCcw } from 'lucide-react';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { SkillSlot } from '../../types/Profile';
import { cn } from '../../lib/utils';
import { useState, useMemo } from 'react';
import { MAX_ACTIVE_SKILLS, SKILL_MECHANICS } from '../../utils/constants';

/** Artwork well for one of the three slot cards: three across on a phone leaves about 110px each. */
const SLOT_ART = 'w-12 h-12 sm:w-20 sm:h-20 xl:w-24 xl:h-24';
import { SkillSelectorModal } from './SkillSelectorModal';
import { SkillsCycle } from './SkillsCycle';
import { SectionSyncButton } from './SectionSyncButton';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { AscensionStars } from '../UI/AscensionStars';
import { getAscensionTexturePath, getNormalizedTarget } from '../../utils/ascensionUtils';
import { ItemSelectionCard, EmptyRowCard, CARD_ART_CLASS } from '../UI/ItemSelectionCard';
import { useProfileOptimizer } from '../../hooks/useProfileOptimizer';
import { formatNumber } from '../../utils/format';

import { StatBreakdownTooltip } from '../UI/StatBreakdownTooltip';
import { useTreeModifiers, useClanTreeModifiers } from '../../hooks/useCalculatedStats';

// Using global formatNumber from ../../utils/format

interface SkillPanelProps {
    variant?: 'default' | 'original' | 'test';
    title?: string;
    compareSkills?: SkillSlot[] | null;
}

export function SkillPanel({ variant = 'default', title, compareSkills }: SkillPanelProps) {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const {
        isComparing,
        originalSkills,
        testSkills,
        originalSkillAscension,
        testSkillAscension,
        updateOriginalSkill,
        updateTestSkill,
        updateOriginalSkillAscension,
        updateTestSkillAscension,
        isCompactStats
    } = useComparison();
    const { optimizeSkills, isReady } = useProfileOptimizer();
    const techModifiers = useTreeModifiers();
    const clanModifiers = useClanTreeModifiers();
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

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

    const { activeAscensionDmgMulti, activeAscensionHpMulti } = useMemo(() => {
        let d = 1, h = 1;
        if (skillAscensionLevel > 0 && ascensionConfigsLibrary?.Skills?.AscensionConfigPerLevel) {
            const ascConfigs = ascensionConfigsLibrary.Skills.AscensionConfigPerLevel;
            const config = ascConfigs[Math.min(skillAscensionLevel - 1, ascConfigs.length - 1)];
            if (config) {
                const stats = config.StatContributions || [];
                for (const s of stats) {
                    const sTarget = getNormalizedTarget(s.StatNode).$type;
                    const sType = s.StatNode?.UniqueStat?.StatType;
                    if (sTarget === 'ActiveSkillStatTarget') {
                        if (sType === 'Damage' || sType === 'AscensionDamage') d = Math.max(d, s.Value + 1);
                        if (sType === 'Health' || sType === 'AscensionHealth') h = Math.max(h, s.Value + 1);
                    }
                }
            }
        }
        return { activeAscensionDmgMulti: d, activeAscensionHpMulti: h };
    }, [skillAscensionLevel, ascensionConfigsLibrary]);

    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const globalStats = useGlobalStats();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [previousSkills, setPreviousSkills] = useState<SkillSlot[] | null>(null);

    const updateSkills = (newSkills: SkillSlot[]) => {
        if (variant === 'original') updateOriginalSkill(newSkills);
        else if (variant === 'test') updateTestSkill(newSkills);
        else updateNestedProfile('skills', { equipped: newSkills });
    };

    const handleRemove = (index: number) => {
        setPreviousSkills(null);
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
        setPreviousSkills(null);

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


        if (editingIdx !== null) {
            const newSkills = [...equippedSkills];
            newSkills[editingIdx] = skillToAdd;
            updateSkills(newSkills);
        } else {
            if (equippedSkills.length >= MAX_ACTIVE_SKILLS) return;
            updateSkills([...equippedSkills, skillToAdd]);
        }
        setPreviousSkills(null);

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
        setPreviousSkills([...equippedSkills]);
        const best = optimizeSkills();
        if (best) updateSkills(best);
    };

    const handleRevert = () => {
        if (previousSkills) {
            updateSkills(previousSkills);
            setPreviousSkills(null);
        }
    };

    const getSkillStats = (skill: SkillSlot) => {
        if (!skillLibrary) return null;
        const skillData = skillLibrary[skill.id];
        if (!skillData) return null;

        const levelIdx = skill.level - 1;
        const baseDmg = skillData.DamagePerLevel?.[levelIdx] || 0;
        const baseHp = skillData.HealthPerLevel?.[levelIdx] || 0;
        const duration = skillData.ActiveDuration || 0;
        const cooldown = skillData.Cooldown || 0;

        // Skill Layer: computed locally to respect variant-specific ascension levels
        // Tech tree bonus (SkillDamage applies to both dmg and heal for active skills)
        const techSkillBonus = techModifiers['SkillDamage'] || 0;
        const clanSkillBonus = clanModifiers['SkillDamage'] || 0;
        // Item substats from globalStats (these don't change between variants)
        const itemSkillDmgBonus = globalStats?.skillDamageBreakdown?.substats || 0;
        const itemSkillHpBonus = globalStats?.skillHealthBreakdown?.substats || 0;

        // Skill Layer = (1 + tech) * (1 + items) * ascension
        // Tree, item substats and ascension are three separate stat layers in the game
        // (TechTree, GeneralCompounding, Ascensions), so they compound instead of summing.
        const skillDmgMulti = (1 + techSkillBonus) * (1 + itemSkillDmgBonus) * (activeAscensionDmgMulti || 1);
        const skillHpMulti = (1 + techSkillBonus) * (1 + itemSkillHpBonus) * (activeAscensionHpMulti || 1);

        // Common Layer from globalStats (Tech Tree Dmg/HP + Item Dmg%/HP%)
        // Item HealthMulti carries an ActiveSkill target, so healing reads the health multiplier.
        const commonDmgMulti = globalStats?.damageMultiplier || 1;
        const commonHpMulti = globalStats?.healthMultiplier || 1;

        // Total = skillLayer * commonLayer
        const totalDamageMulti = skillDmgMulti * commonDmgMulti;
        const totalHealthMulti = skillHpMulti * commonHpMulti;

        const damage = baseDmg * totalDamageMulti;
        const health = baseHp * totalHealthMulti;

        const mechanics = SKILL_MECHANICS[skill.id] || { count: 1 };
        const totalDamageDisplay = mechanics.damageIsPerHit ? damage * mechanics.count : damage;
        const damagePerHit = mechanics.damageIsPerHit
            ? damage
            : (mechanics.count > 1 ? damage / mechanics.count : damage);

        return {
            baseDamage: baseDmg,
            baseHealth: baseHp,
            damage: damagePerHit,
            totalDamage: totalDamageDisplay,
            count: mechanics.count,
            health,
            duration,
            cooldown,
            multi: totalDamageMulti,
            damageBonus: totalDamageMulti - 1,
            healthBonus: totalHealthMulti - 1,
            details: {
                damage: {
                    base: baseDmg,
                    techMulti: techSkillBonus,
                    clanTechMulti: clanSkillBonus,
                    itemMulti: itemSkillDmgBonus,
                    ascMulti: activeAscensionDmgMulti || 1,
                    commonMulti: commonDmgMulti,
                    skillMulti: skillDmgMulti,
                    total: totalDamageMulti
                },
                health: {
                    base: baseHp,
                    techMulti: techSkillBonus,
                    clanTechMulti: clanSkillBonus,
                    itemMulti: itemSkillHpBonus,
                    ascMulti: activeAscensionHpMulti || 1,
                    commonMulti: commonHpMulti,
                    skillMulti: skillHpMulti,
                    total: totalHealthMulti
                }
            }
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
                <div className="flex flex-col gap-2">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/SkillTabIcon.png`} alt="Active Skills" className="w-8 h-8 object-contain" />
                        {panelTitle}
                    </h2>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] font-bold border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 text-red-400 gap-1 active:scale-95 transition-all w-fit"
                            onClick={handleAutoOptimize}
                            disabled={!isReady || !skillLibrary || Object.keys(skillLibrary).length < 1}
                            title="Select best 3 active skills for Max DPS"
                        >
                            <Sword className="w-3 h-3" />
                            AUTO DPS
                        </Button>
                        {previousSkills && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[10px] font-bold text-text-muted hover:text-white gap-1 active:scale-95 transition-all w-fit"
                                onClick={handleRevert}
                            >
                                <RotateCcw className="w-3 h-3" />
                                REVERT
                            </Button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    {variant === 'default' && !isComparing && <SectionSyncButton preset="skills" label="Sync" />}
                    <AscensionStars
                        value={skillAscensionLevel}
                        onChange={handleAscensionChange}
                        size="sm"
                    />
                </div>
            </div>

            {/* Container-relative columns: this panel also renders two-up inside the compare grid. */}
                            {/* Three across, always: there are exactly three slots, so one row holds them all
                    and the column count never changes with the viewport. The cards shrink to fit
                    rather than wrapping, which is what keeps the panel one shape on a phone and on
                    a desktop, and items-stretch levels their heights. */}
                <div className={cn(
                    'grid items-stretch gap-2',
                    // One per row on a phone, three on a desktop. Comparison mode is pinned to one
                    // for the same reason the equipment row is pinned to two: the panel is half as
                    // wide as the viewport breakpoint believes.
                    isComparing ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'
                )}>
                {equippedSkills.map((skill, idx) => {
                    const stats = getSkillStats(skill);
                    if (!stats) return null;
                    const spriteInfo = getSpriteInfo(skill.id);
                    const hasDiff = checkDiff(idx);

                    return (
                        <ItemSelectionCard
                            className="min-w-0" artClassName={SLOT_ART}
                            key={idx}
                            item={skill}
                            layout="row"
                            variant={isCompactStats ? 'compact' : 'default'}
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
                            onLevelSet={(newLevel) => handleUpdateLevel(idx, newLevel)}
                            /* Skill ascension is one global number: the single editor is in the
                               panel header, the card shows the star count read-only. */
                            onClick={() => setEditingIdx(idx)}
                            renderIcon={() => (
                                spriteInfo ? (
                                    <SpriteSheetIcon
                                        textureSrc={getAscensionTexturePath('SkillIcons', skillAscensionLevel, selectedVersion)}
                                        spriteWidth={spriteInfo.config.sprite_size.width}
                                        spriteHeight={spriteInfo.config.sprite_size.height}
                                        sheetWidth={spriteInfo.config.texture_size.width}
                                        sheetHeight={spriteInfo.config.texture_size.height}
                                        iconIndex={spriteInfo.spriteIndex}
                                        className={CARD_ART_CLASS}
                                        smooth
                                    />
                                ) : (
                                    <Flame className={cn("w-10 h-10", `text-rarity-${skill.rarity.toLowerCase()}`)} />
                                )
                            )}
                            stats={{
                                damage: 0,
                                health: 0,
                                isMelee: false
                            }}
                            perfection={null}
                            getStatPerfection={() => null}
                            maxLevel={skillLibrary?.[skill.id]?.DamagePerLevel?.length || 999}
                            customStats={
                                <div className="flex flex-col gap-1.5">
                                    {/* Damage: label, hit count, targeting tag, total, per hit and
                                        multiplier all on one wrapping line instead of five stacked. */}
                                    {stats.damage > 0 && (
                                        <div className="relative group/dmg flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 rounded-md border border-red-400/25 bg-red-400/10 px-1.5 py-1">
                                            <span className="text-[9px] font-black uppercase tracking-wide text-red-400">Damage</span>
                                            {stats.count > 1 && <span className="text-[9px] font-bold text-red-400/80">(x{stats.count})</span>}
                                            {(() => {
                                                const mech = SKILL_MECHANICS[skill.id];
                                                if (mech?.count === 0) {
                                                    return <span className="text-[8px] bg-green-500/20 px-1 rounded border border-green-500/30 text-green-400">CONTINUOUS</span>;
                                                }
                                                return mech?.isAOE ? (
                                                    <span className="text-[8px] bg-red-500/20 px-1 rounded border border-red-500/30 text-red-400">AOE</span>
                                                ) : (
                                                    <span className="text-[8px] bg-blue-500/20 px-1 rounded border border-blue-500/30 text-blue-400">SINGLE</span>
                                                );
                                            })()}
                                            <span className="font-mono font-bold text-[13px] text-red-400 leading-none">
                                                {formatNumber(stats.totalDamage)}
                                            </span>
                                            {stats.count > 1 && (
                                                <span className="text-[8px] font-mono italic text-red-400/70">({formatNumber(stats.damage)} / hit)</span>
                                            )}
                                            <span className="font-mono text-[9px] font-bold text-text-muted/90 ml-auto whitespace-nowrap">
                                                x{stats.multi.toFixed(2)} <span className="text-green-400/80">({((stats.multi - 1) * 100).toFixed(1)}%)</span>
                                            </span>
                                            <div className="hidden group-hover/dmg:block">
                                                <StatBreakdownTooltip damage={stats.details.damage} />
                                            </div>
                                        </div>
                                    )}
                                    {stats.health > 0 && (
                                        <div className="relative group/heal flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 rounded-md border border-green-400/25 bg-green-400/10 px-1.5 py-1">
                                            <span className="text-[9px] font-black uppercase tracking-wide text-green-400">Healing</span>
                                            <span className="font-mono font-bold text-[13px] text-green-400 leading-none">
                                                {formatNumber(stats.health)}
                                            </span>
                                            <span className="font-mono text-[9px] font-bold text-text-muted/90 ml-auto whitespace-nowrap">
                                                x{stats.multi.toFixed(2)} <span className="text-green-400/80">({((stats.multi - 1) * 100).toFixed(1)}%)</span>
                                            </span>
                                            <div className="hidden group-hover/heal:block">
                                                <StatBreakdownTooltip health={stats.details.health} />
                                            </div>
                                        </div>
                                    )}

                                    {(() => {
                                        // Hit Frequence: same cast-timing model as the Skills Cycle panel
                                        // advisor (BattleEngine): first cast at 3.2s, then every
                                        // max(0.5, CD x (1-reduction)) + active duration.
                                        const reduction = globalStats?.skillCooldownReduction || 0;
                                        const activeDuration = stats.duration || 0;
                                        const cdComponent = stats.cooldown * Math.max(0.1, 1 - reduction);
                                        const period = Math.max(0.5, cdComponent) + activeDuration;
                                        const START_TIME = 3.2;
                                        const T = typeof pvpBaseConfig?.PvpMatchTimerSeconds === 'number'
                                            ? pvpBaseConfig.PvpMatchTimerSeconds : 60;

                                        let activations = 0;
                                        let lastHit = 0;
                                        let targetCd = 0;

                                        if (T > START_TIME) {
                                            activations = Math.floor((T - START_TIME) / period) + 1;
                                            lastHit = START_TIME + (activations - 1) * period;
                                            // effective CD needed to fit one more cast inside the window
                                            const need = (T - START_TIME) / activations - activeDuration;
                                            targetCd = Math.max(0, need);
                                        }

                                        const diff = Math.max(0.5, cdComponent) - targetCd;
                                        const cell = "rounded flex flex-col items-center justify-center py-1 bg-bg-input/40 min-w-0";
                                        const cap = "text-[7px] text-text-muted uppercase font-bold tracking-wide";

                                        // Cooldown, duration and the three Hit Frequence numbers used to be
                                        // two separate boxes and a captioned 3-up grid. Same five numbers,
                                        // one strip.
                                        return (
                                            <div className="grid grid-cols-5 gap-1 text-[10px]">
                                                <div className={cell} title="Cooldown after cooldown reduction">
                                                    <span className={cap}>CD</span>
                                                    <span className="font-mono font-bold tabular-nums">{cdComponent.toFixed(1)}s</span>
                                                </div>
                                                <div className={cell} title="Active duration">
                                                    <span className={cap}>Dur</span>
                                                    <span className="font-mono font-bold tabular-nums">{stats.duration}s</span>
                                                </div>
                                                <div className={cell} title={`Hit Frequence: activations in ${T}s`}>
                                                    <span className={cap}>Hits</span>
                                                    <span className="font-mono font-bold tabular-nums">{activations}</span>
                                                </div>
                                                <div className={cell} title={`Hit Frequence: time of the last activation in ${T}s`}>
                                                    <span className={cap}>Last</span>
                                                    <span className="font-mono font-bold tabular-nums">{lastHit.toFixed(1)}s</span>
                                                </div>
                                                <div
                                                    className={cn(
                                                        "rounded flex flex-col items-center justify-center py-1 min-w-0",
                                                        diff < 0 ? "bg-red-400/15 text-red-400" : "bg-accent-primary/15 text-accent-primary"
                                                    )}
                                                    title={`Hit Frequence: needed CDR change for one more cast: ${((Math.abs(diff) / stats.cooldown) * 100).toFixed(2)}%`}
                                                >
                                                    <span className={cn(cap, "text-current opacity-90")}>To+1</span>
                                                    <span className="font-mono font-bold tabular-nums leading-none">{Math.abs(diff).toFixed(2)}s</span>
                                                    <span className="text-[7px] opacity-80 tabular-nums">({((Math.abs(diff) / stats.cooldown) * 100).toFixed(1)}%)</span>
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
                    <EmptyRowCard
                        className="min-w-0" artClassName={SLOT_ART}
                        label="Add Skill"
                        hint="Click to equip"
                        icon={<Plus className="w-10 h-10 text-text-muted" />}
                        onClick={() => setIsModalOpen(true)}
                        hasDiff={variant === 'test' && !!compareSkills && equippedSkills.length !== compareSkills.length}
                    />
                )}
            </div>

            {variant === 'default' && equippedSkills.length > 0 && (
                <div className="mt-4">
                    <SkillsCycle skills={equippedSkills} />
                </div>
            )}

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
