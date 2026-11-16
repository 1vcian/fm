import { RARITIES } from '../utils/constants';
import { useState, useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useProfile } from '../context/ProfileContext';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn, getRarityBgStyle } from '../lib/utils';
import { Package, TrendingUp } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { AscensionStars } from '../components/UI/AscensionStars';
import { ascensionMultipliers } from '../utils/ascensionUnlocks';
import { useRarityAscensionFrom } from '../hooks/useAscensionUnlocks';
import { FromAscensionBadge } from '../components/UI/FromAscensionBadge';
import { usePersistentState } from '../hooks/usePersistentState';
import { useGameDataContext } from '../context/GameDataContext';
import { useComparison } from '../context/ComparisonContext';
import { formatCompactNumber } from '../utils/statsCalculator';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { unitIcon, unitIconStyle } from '../utils/unitIcons';

export default function Skills() {
    const { profile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { data: skillLibrary, loading: l1 } = useGameData<any>('SkillLibrary.json');
    const { data: skillUpgrades, loading: l1b } = useGameData<any>('SkillUpgradeLibrary.json');
    const { data: passiveLibrary, loading: l1c } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: spriteMapping, loading: l2 } = useGameData<any>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const { data: ascensionConfigs, loading: l3 } = useGameData<any>('AscensionConfigsLibrary.json');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterRarity, setFilterRarity] = usePersistentState<string | null>('wiki_skills_filter_rarity', null);
    const [globalLevel, setGlobalLevel] = usePersistentState<number>('wiki_skills_global_level', 50);
    const [ascensionLevel, setAscensionLevel] = usePersistentState<number>('wiki_skills_ascension_level', 0);

    const loading = l1 || l1b || l1c || l2 || l3;
    const skillsConfig = spriteMapping?.skills;

    // Ascensions-layer multipliers of the picked skill ascension (utils/ascensionUnlocks.ts): only
    // AscensionConfigPerLevel[Level - 1], one for active skills (Target ActiveSkill) and one for
    // passives (Target PassiveSkill), every rarity alike (no qualifier).
    const skillMultiAt = (level: number) => {
        const m = ascensionMultipliers(ascensionConfigs, 'Skills', level);
        return {
            activeDmg: m.damage.ActiveSkillStatTarget ?? 1,
            activeHp: m.health.ActiveSkillStatTarget ?? 1,
            passiveDmg: m.damage.PassiveSkillStatTarget ?? 1,
            passiveHp: m.health.PassiveSkillStatTarget ?? 1,
        };
    };
    const ascensionMulti = skillMultiAt(ascensionLevel);
    // Rarity -> first skill ascension whose summon table can roll it.
    const rarityFrom = useRarityAscensionFrom('SkillSummonConfig.json');

    // Calculate total shards (copies) needed for the selected globalLevel
    // Logic: 1 (Discovery) + sum(Shards for upgrades 1 to L-1)
    // Example: Lvl 2 = 1 (Lvl 1) + Shards["1"] (upgrade to Lvl 2)
    const totalCardsRequired = useMemo(() => {
        if (!skillUpgrades) return 1;
        let sum = 1; // Discovery cost (Level 1)
        for (let i = 1; i < globalLevel; i++) {
            const upgrade = skillUpgrades[i.toString()];
            if (upgrade) {
                sum += upgrade.Shards;
            }
        }
        return sum;
    }, [skillUpgrades, globalLevel]);

    const nextLevelCost = useMemo(() => {
        if (!skillUpgrades) return 0;
        return skillUpgrades[globalLevel.toString()]?.Shards || 0;
    }, [skillUpgrades, globalLevel]);

    // Build sprite lookup
    const spriteLookup = useMemo(() => {
        if (!skillsConfig?.mapping) return {};
        const lookup: Record<string, number> = {};
        Object.entries(skillsConfig.mapping).forEach(([idx, info]: [string, any]) => {
            lookup[info.name] = parseInt(idx);
        });
        return lookup;
    }, [skillsConfig]);

    // Check if skill is equipped in profile
    const isEquippedInProfile = (skillType: string) => {
        return profile.skills.equipped.some(s => s.id === skillType);
    };

    // Process Skills
    const skills = useMemo(() => {
        if (!skillLibrary) return [];
        return Object.entries(skillLibrary)
            .map(([type, skill]: [string, any]) => {
                const rarity = skill?.Rarity || 'Common';
                const spriteIndex = spriteLookup[type] ?? -1;

                return {
                    type,
                    // The game's English name (Localization.json), else the skill id.
                    name: (localization?.skills?.[type]?.en as string | undefined) || type,
                    rarity,
                    spriteIndex,
                    activeDuration: skill?.ActiveDuration || 0,
                    cooldown: skill?.Cooldown || 0,
                    damagePerLevel: skill?.DamagePerLevel || [],
                    healthPerLevel: skill?.HealthPerLevel || [],
                };
            })
            .filter((skill) => {
                const matchSearch = skill.name.toLowerCase().includes(searchTerm.toLowerCase()) || skill.type.toLowerCase().includes(searchTerm.toLowerCase());
                const matchRarity = !filterRarity || skill.rarity === filterRarity;
                return matchSearch && matchRarity;
            })
            .sort((a, b) => {
                const rarityOrder = RARITIES;
                const rDiff = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
                return rDiff !== 0 ? rDiff : a.type.localeCompare(b.type);
            });
    }, [skillLibrary, spriteLookup, localization, searchTerm, filterRarity]);

    // Sprite of the unit in the mapping cell `spriteIndex`, as the game draws it at this ascension
    const getSpriteStyle = (spriteIndex: number) =>
        spriteIndex < 0 ? null : unitIconStyle(unitIcon(skillsConfig, spriteIndex, ascensionLevel, selectedVersion), 64);

    const rarities = RARITIES;

    const { isCompactStats } = useComparison();

    const formatStatValue = (val: number) => {
        return isCompactStats 
            ? formatCompactNumber(val)
            : val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12 px-4 sm:px-0">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-6">
                <div className="w-full">
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                        <GameAssetIcon asset={{ sheet: 'SkillIcons', index: 14 }} size={40} />
                        Skill Wiki
                    </h1>
                    <p className="text-text-secondary text-sm sm:text-base">
                        Complete skill database with stats.
                    </p>
                </div>

                <div className="flex gap-2 items-center flex-wrap">
                    <div className="relative w-full md:w-40">
                        <GameAssetIcon asset={{ icon: 'SearchIcon' }} size={16} className="absolute left-3 top-2.5" />
                        <Input
                            placeholder="Search"
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <select
                        className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm"
                        value={filterRarity || ''}
                        onChange={(e) => setFilterRarity(e.target.value || null)}
                    >
                        <option value="">All Rarities</option>
                        {rarities.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
            </div>

            {/* Global Level Slider */}
            <Card className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-sm font-bold text-text-secondary whitespace-nowrap">Display Level:</span>
                    <input
                        type="range"
                        min={1}
                        max={skillUpgrades ? Object.keys(skillUpgrades).length + 1 : 300}
                        value={globalLevel}
                        onChange={(e) => setGlobalLevel(parseInt(e.target.value))}
                        className="flex-1 accent-accent-primary"
                    />
                    <span className="font-mono font-bold text-accent-primary w-10 text-center">{globalLevel}</span>
                    <div className="h-6 w-px bg-border/50 hidden sm:block" />
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-secondary whitespace-nowrap">Ascension:</span>
                        <AscensionStars type="Skills" value={ascensionLevel} onChange={setAscensionLevel} />
                        {ascensionLevel > 0 && (
                            <span className="text-xs text-amber-400 font-mono">x{formatNumber(ascensionMulti.activeDmg)}</span>
                        )}
                    </div>
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                    {ascensionLevel > 0
                        ? `Active and passive values at level ${globalLevel} with the skill ascension ${ascensionLevel} bonus (active x${formatNumber(ascensionMulti.activeDmg)}, passive x${formatNumber(ascensionMulti.passiveDmg)}). Tech tree and other bonuses are not added.`
                        : `Base active and passive values at level ${globalLevel}, no ascension bonus. Pick an ascension to apply its bonus.`}
                </p>
            </Card>

            {loading ? (
                <div className="text-center py-12 text-text-muted">Loading Skills</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {skills.map(skill => {
                        const isEquipped = isEquippedInProfile(skill.type);
                        const spriteStyle = getSpriteStyle(skill.spriteIndex);
                        // Not obtainable at the picked ascension: shown dimmed, not hidden.
                        const fromAsc = rarityFrom[skill.rarity];
                        const lockedHere = !!fromAsc && ascensionLevel < fromAsc;
                        // A locked skill shows the stats of the first ascension that can obtain it.
                        const am = lockedHere ? skillMultiAt(fromAsc) : ascensionMulti;

                        // Stats at global level
                        const dmgIdx = Math.min(Math.max(1, globalLevel) - 1, skill.damagePerLevel.length - 1);
                        const hpIdx = Math.min(Math.max(1, globalLevel) - 1, skill.healthPerLevel.length - 1);

                        const dmgAtLevel = dmgIdx >= 0
                            ? (skill.damagePerLevel[dmgIdx] || 0) * am.activeDmg
                            : 0;

                        const hpAtLevel = hpIdx >= 0
                            ? (skill.healthPerLevel[hpIdx] || 0) * am.activeHp
                            : 0;

                        return (
                            <Card key={skill.type} variant="hover" className={cn(
                                "p-4 relative overflow-hidden transition-all flex flex-col",
                                isEquipped ? "border-accent-primary ring-2 ring-accent-primary" : "",
                                lockedHere && !isEquipped ? "opacity-60" : ""
                            )}>
                                {/* Glow */}
                                <div className={cn(
                                    "absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 blur-xl translate-x-8 -translate-y-8",
                                    `bg-rarity-${skill.rarity.toLowerCase()}`
                                )} />

                                {/* Equipped Badge (read-only) */}
                                {isEquipped && (
                                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-accent-primary text-white z-20">
                                        <GameAssetIcon asset={{ icon: 'Star' }} size={16} />
                                    </div>
                                )}

                                {/* Header */}
                                <div className="flex items-center gap-4 mb-4 relative z-10">
                                    <div
                                        className="w-16 h-16 rounded-xl flex items-center justify-center border-2 border-border overflow-hidden shrink-0"
                                        style={getRarityBgStyle(skill.rarity)}
                                    >
                                        {spriteStyle ? (
                                            <div style={spriteStyle} />
                                        ) : (
                                            <GameAssetIcon asset={{ sheet: 'SkillIcons', index: 14 }} size={32} />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-text-primary text-lg leading-tight whitespace-nowrap overflow-hidden text-clip">{skill.name}</h3>
                                        <span className={cn(
                                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/5 mt-1 inline-block",
                                            `text-rarity-${skill.rarity.toLowerCase()}`
                                        )}>
                                            {skill.rarity}
                                        </span>
                                        <FromAscensionBadge ascension={fromAsc} source="skill" className="ml-1 align-middle" />
                                    </div>
                                </div>

                                {lockedHere && (
                                    <div className="relative z-10 mb-3 text-[10px] text-amber-300/90 bg-amber-400/5 border border-amber-400/20 rounded px-2 py-1">
                                        Not obtainable at skill ascension {ascensionLevel}. Stats shown at ascension {fromAsc}, the first one that can obtain it.
                                    </div>
                                )}
                                {/* Skill Info */}
                                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                                    <div className="bg-bg-input/50 p-2 rounded flex items-center gap-2">
                                        <GameAssetIcon asset={{ icon: 'Timer' }} size={12} />
                                        <span className="text-text-muted">Duration:</span>
                                        <span className="font-mono font-bold ml-auto">{skill.activeDuration}s</span>
                                    </div>
                                    <div className="bg-bg-input/50 p-2 rounded flex items-center gap-2">
                                        <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 9 }} size={12} />
                                        <span className="text-text-muted">Cooldown:</span>
                                        <span className="font-mono font-bold ml-auto">{skill.cooldown}s</span>
                                    </div>
                                </div>

                                {/* Passive Stats */}
                                {passiveLibrary && passiveLibrary[skill.rarity] && (
                                    <div className="grid grid-cols-1 gap-1 mb-3">
                                        {(() => {
                                            const passiveData = passiveLibrary[skill.rarity];
                                            if (!passiveData?.LevelStats) return null;

                                            const pLevelIdx = Math.min(Math.max(1, globalLevel) - 1, passiveData.LevelStats.length - 1);
                                            const currentStats = passiveData.LevelStats[pLevelIdx]?.Stats || [];

                                            return currentStats.map((stat: any, idx: number) => {
                                                const statType = stat.StatNode?.UniqueStat?.StatType || "Unknown";
                                                let statVal = stat.Value || 0;
                                                // Passive ascension multiplier, already x(1 + Value)
                                                if (statType === 'Damage') statVal *= am.passiveDmg;
                                                if (statType === 'Health') statVal *= am.passiveHp;

                                                // Only show positive values
                                                if (statVal <= 0) return null;

                                                return (
                                                    <div key={idx} className="flex justify-between items-center text-xs py-0.5 border-b border-white/5 last:border-0">
                                                        <span className="text-text-muted">Passive {statType}</span>
                                                        <span className="font-mono font-bold text-accent-primary">
                                                            +{formatStatValue(statVal)}
                                                        </span>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                )}

                                {/* Stats at current level */}
                                <div className="flex gap-2 mt-auto">
                                    {dmgAtLevel > 0 && (
                                        <div className="flex flex-col bg-bg-input/50 p-2 rounded border border-white/5 flex-1 items-center">
                                            <div className="flex items-center gap-1 text-[10px] text-red-400 mb-1 uppercase font-bold">
                                                <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 0 }} size={12} /> Damage
                                            </div>
                                            <div className="font-mono font-bold text-red-200">
                                                +{formatStatValue(dmgAtLevel)}
                                            </div>
                                        </div>
                                    )}
                                    {hpAtLevel > 0 && (
                                        <div className="bg-bg-input/50 p-2 rounded border border-white/5 flex-1 items-center">
                                            <div className="flex items-center gap-1 text-[10px] text-green-400 mb-1 uppercase font-bold">
                                                <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 1 }} size={12} /> Health
                                            </div>
                                            <div className="font-mono font-bold text-green-200">
                                                +{formatStatValue(hpAtLevel)}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Progression Stats matching Pet/Mount Wiki style */}
                                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-white/5">
                                    <div className="bg-bg-primary/50 p-2 rounded border border-white/5 flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[9px] text-text-muted mb-0.5 uppercase font-bold text-center">
                                            <TrendingUp className="w-2.5 h-2.5 text-accent-primary" /> Next Level
                                        </div>
                                        <div className="font-mono font-bold text-accent-primary text-xs">
                                            {nextLevelCost > 0 ? formatNumber(nextLevelCost) : 'MAX'}
                                        </div>
                                    </div>
                                    <div className="bg-bg-primary/50 p-2 rounded border border-white/5 flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[9px] text-text-muted mb-0.5 uppercase font-bold text-center">
                                            <Package className="w-2.5 h-2.5 text-accent-secondary" /> Total Copies
                                        </div>
                                        <div className="font-mono font-bold text-accent-secondary text-xs">
                                            {formatNumber(totalCardsRequired)}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {!loading && skills.length === 0 && (
                <div className="text-center py-12 text-text-muted">No skills found matching your search.</div>
            )}
        </div>
    );
}
