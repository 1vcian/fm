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
// The game's own cell order for the skills grid. It lives with the screenshot readers because
// that is what reads the grid by position, and it is the only place this order is recorded.
import { SKILLS_ORDER } from '../../utils/ocr/templateParams';

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

    /**
     * The 18 skills in the order the game's own Skills screen lays them out.
     *
     * SKILLS_ORDER is the reader's cell map: the grid is read by position, so that array IS the
     * game's order (rarity rank, then CombatSkill enumId, three per rarity). The key order of
     * SkillLibrary.json is NOT the same, so sorting has to go through SKILLS_ORDER: it has
     * Shuriken before Berserk and Meteorite before Bomb, the game has them the other way round.
     * Anything the library defines that the order does not name is appended rather than dropped.
     */
    const orderedSkills = useMemo<SkillInfo[]>(() => {
        if (!skillLibrary) return [];
        const rarityOf = (id: string) => (skillLibrary[id]?.Rarity as string) || 'Common';
        const known = SKILLS_ORDER.filter(id => skillLibrary[id]).map(id => ({ id, rarity: rarityOf(id) }));
        const extra = Object.keys(skillLibrary)
            .filter(id => !(SKILLS_ORDER as readonly string[]).includes(id))
            .map(id => ({ id, rarity: rarityOf(id) }));
        return [...known, ...extra];
    }, [skillLibrary]);

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

            {/* All 18 at once, in the game's own order, in rounded icons like the Skills screen.
                The order is SKILLS_ORDER, not the key order of SkillLibrary.json, which differs
                (Shuriken/Berserk and Bomb/Meteorite are both swapped there).

                Every column count here divides 18 exactly (3, 6, 9, 18), so the last row is always
                as full as the first and nothing is left hanging at the left edge. The tracks are
                1fr, so the tiles share the whole width instead of leaving a gap on the right. */}
            <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-9 2xl:grid-cols-[repeat(18,minmax(0,1fr))] gap-1.5">
                {orderedSkills.map(({ id, rarity }) => {
                    const level = passives[id] || 0;
                    const stats = getSkillStats(id, level);
                    const spriteInfo = getSpriteInfo(id);
                    const maxLevel = skillPassiveLibrary?.[rarity]?.LevelStats?.length || 299;
                    const owned = level > 0;
                    // The full name and both stats live in the tooltip: the tile itself has room
                    // for the artwork and the level, which is what the game shows too.
                    const title = stats
                        ? `${id} (${rarity}) Lv.${level} | DMG +${formatCompactNumber(stats.damage)} | HP +${formatCompactNumber(stats.health)}`
                        : `${id} (${rarity}) not owned`;

                    return (
                        <div
                            key={id}
                            title={title}
                            className={cn(
                                'min-w-0 rounded-lg border p-1 flex flex-col gap-1 transition-colors',
                                owned ? 'border-border bg-bg-secondary/40' : 'border-border/40 bg-bg-input/20'
                            )}
                        >
                            <div
                                className={cn(
                                    'relative w-full aspect-square rounded-full border-2 overflow-hidden flex items-center justify-center',
                                    `border-rarity-${rarity.toLowerCase()}`,
                                    !owned && 'opacity-40 grayscale'
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
                                        className="w-full h-full"
                                    />
                                ) : (
                                    <Sparkles className="w-1/2 h-1/2 text-text-muted" />
                                )}
                                <span className="absolute inset-x-1 bottom-[8%] rounded-full bg-black/75 text-center font-black tabular-nums text-white text-[10px] leading-tight">
                                    {owned ? `Lv${level}` : '0'}
                                </span>
                            </div>

                            <div className="flex items-center gap-0.5 min-w-0">
                                <button
                                    onClick={() => handleLevelChange(id, level - 1)}
                                    className="flex-1 min-w-0 rounded bg-bg-input/60 hover:bg-bg-input text-text-muted hover:text-white text-[13px] font-black leading-none py-1 pointer-coarse:py-2 shrink-0 basis-5"
                                    title="Level down"
                                >
                                    -
                                </button>
                                <Input
                                    type="number"
                                    value={level}
                                    onChange={(e) => handleLevelChange(id, parseInt(e.target.value) || 0)}
                                    className="w-full min-w-0 flex-[3] bg-black/40 border-white/10 text-center font-bold tabular-nums px-0 py-1 h-auto text-[13px]"
                                    max={maxLevel}
                                    min={0}
                                />
                                <button
                                    onClick={() => handleLevelChange(id, level + 1)}
                                    className="flex-1 min-w-0 rounded bg-bg-input/60 hover:bg-bg-input text-text-muted hover:text-white text-[13px] font-black leading-none py-1 pointer-coarse:py-2 shrink-0 basis-5"
                                    title="Level up"
                                >
                                    +
                                </button>
                            </div>

                            {/* What this one passive is actually contributing at its current level.
                                The two panel totals above are a sum: without this line there is no
                                way to see which skill is carrying them, which is the question a
                                player asks before spending on a level. A skill at 0 shows a dash
                                rather than a zero, because it is not contributing at all. */}
                            <div className="flex items-center justify-between gap-1 tabular-nums leading-tight">
                                <span className="min-w-0 text-[9px] font-bold text-red-400" title={stats ? `Passive damage: ${Math.round(stats.damage).toLocaleString()}` : 'No passive damage at level 0'}>
                                    {stats ? formatCompactNumber(stats.damage) : '-'}
                                </span>
                                <span className="min-w-0 text-[9px] font-bold text-green-400" title={stats ? `Passive health: ${Math.round(stats.health).toLocaleString()}` : 'No passive health at level 0'}>
                                    {stats ? formatCompactNumber(stats.health) : '-'}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}
