import { useState, useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useProfile } from '../context/ProfileContext';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn, getRarityBgStyle } from '../lib/utils';
import { Zap, Search, Star, Clock, Crosshair, Sword, Heart } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { AscensionStars } from '../components/UI/AscensionStars';

export default function Skills() {
    const { profile } = useProfile();
    const { data: skillLibrary, loading: l1 } = useGameData<any>('SkillLibrary.json');
    const { data: skillUpgrades, loading: l1b } = useGameData<any>('SkillUpgradeLibrary.json');
    const { data: passiveLibrary, loading: l1c } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: spriteMapping, loading: l2 } = useGameData<any>('ManualSpriteMapping.json');
    const { data: ascensionConfigs, loading: l3 } = useGameData<any>('AscensionConfigsLibrary.json');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterRarity, setFilterRarity] = useState<string | null>(null);
    const [globalLevel, setGlobalLevel] = useState(50);
    const [ascensionLevel, setAscensionLevel] = useState(0);

    const loading = l1 || l1b || l1c || l2 || l3;
    const skillsConfig = spriteMapping?.skills;

    // Compute ascension multipliers from JSON (active + passive)
    const ascensionMulti = useMemo(() => {
        let activeDmg = 0, activeHp = 0, passiveDmg = 0, passiveHp = 0;
        if (ascensionLevel > 0 && ascensionConfigs?.Skills?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Skills.AscensionConfigPerLevel;
            for (let i = 0; i < ascensionLevel && i < configs.length; i++) {
                for (const s of configs[i].StatContributions || []) {
                    const val = s.Value;
                    const target = s.StatNode?.StatTarget?.$type;
                    const statType = s.StatNode?.UniqueStat?.StatType;
                    if (target === 'ActiveSkillStatTarget') {
                        if (statType === 'Damage') activeDmg += val;
                        if (statType === 'Health') activeHp += val;
                    } else if (target === 'PassiveSkillStatTarget') {
                        if (statType === 'Damage') passiveDmg += val;
                        if (statType === 'Health') passiveHp += val;
                    }
                }
            }
        }
        return { activeDmg, activeHp, passiveDmg, passiveHp };
    }, [ascensionLevel, ascensionConfigs]);

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
                    rarity,
                    spriteIndex,
                    activeDuration: skill?.ActiveDuration || 0,
                    cooldown: skill?.Cooldown || 0,
                    damagePerLevel: skill?.DamagePerLevel || [],
                    healthPerLevel: skill?.HealthPerLevel || [],
                };
            })
            .filter((skill) => {
                const matchSearch = skill.type.toLowerCase().includes(searchTerm.toLowerCase());
                const matchRarity = !filterRarity || skill.rarity === filterRarity;
                return matchSearch && matchRarity;
            })
            .sort((a, b) => {
                const rarityOrder = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];
                const rDiff = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
                return rDiff !== 0 ? rDiff : a.type.localeCompare(b.type);
            });
    }, [skillLibrary, spriteLookup, searchTerm, filterRarity]);

    // Calculate sprite position
    const getSpriteStyle = (spriteIndex: number) => {
        if (!skillsConfig || spriteIndex < 0) return null;
        const cols = skillsConfig.grid?.columns || 8;
        const spriteW = skillsConfig.sprite_size?.width || 256;
        const spriteH = skillsConfig.sprite_size?.height || 256;
        const sheetW = skillsConfig.texture_size?.width || 2048;
        const sheetH = skillsConfig.texture_size?.height || 2048;

        const col = spriteIndex % cols;
        const row = Math.floor(spriteIndex / cols);
        const x = col * spriteW;
        const y = row * spriteH;

        const scale = 64 / spriteW;

        return {
            backgroundImage: `url(${getAscSkillSpriteUrl()})`,
            backgroundPosition: `-${x * scale}px -${y * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: '64px',
            height: '64px',
        };
    };

    const getAscSkillSpriteUrl = () => {
        const baseUrl = import.meta.env.BASE_URL;
        if (ascensionLevel === 1) return `${baseUrl}Texture2D/MegaSkillIcons.png`;
        if (ascensionLevel === 2) return `${baseUrl}Texture2D/UltraSkillIcons.png`;
        if (ascensionLevel === 3) return `${baseUrl}Texture2D/ApexSkillIcons.png`;
        return `${baseUrl}Texture2D/SkillIcons.png`;
    };

    const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

    return (
        <div className="space-y-6 animate-fade-in pb-12 px-4 sm:px-0">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-6">
                <div className="w-full">
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                        <Zap className="w-8 h-8 sm:w-10 h-10 text-accent-primary" />
                        Skill Wiki
                    </h1>
                    <p className="text-text-secondary text-sm sm:text-base">
                        Complete skill database with stats.
                    </p>
                </div>

                <div className="flex gap-2 items-center flex-wrap">
                    <div className="relative w-full md:w-40">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                        <Input
                            placeholder="Search..."
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
                        <AscensionStars value={ascensionLevel} onChange={setAscensionLevel} />
                        {ascensionLevel > 0 && (
                            <span className="text-xs text-amber-400 font-mono">+{((ascensionMulti.activeDmg) * 100).toFixed(0)}%</span>
                        )}
                    </div>
                </div>
            </Card>

            {loading ? (
                <div className="text-center py-12 text-text-muted">Loading Skills...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {skills.map(skill => {
                        const isEquipped = isEquippedInProfile(skill.type);
                        const spriteStyle = getSpriteStyle(skill.spriteIndex);

                        // Stats at global level
                        const levelIdx = Math.min(Math.max(1, globalLevel) - 1, skill.damagePerLevel.length - 1);
                        const dmgAtLevel = (skill.damagePerLevel[levelIdx] || 0) * (1 + ascensionMulti.activeDmg);
                        const hpAtLevel = (skill.healthPerLevel[levelIdx] || 0) * (1 + ascensionMulti.activeHp);

                        return (
                            <Card key={skill.type} variant="hover" className={cn(
                                "p-4 relative overflow-hidden transition-all flex flex-col",
                                isEquipped ? "border-accent-primary ring-2 ring-accent-primary" : ""
                            )}>
                                {/* Glow */}
                                <div className={cn(
                                    "absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 blur-xl translate-x-8 -translate-y-8",
                                    `bg-rarity-${skill.rarity.toLowerCase()}`
                                )} />

                                {/* Equipped Badge (read-only) */}
                                {isEquipped && (
                                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-accent-primary text-white z-20">
                                        <Star className="w-4 h-4 fill-current" />
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
                                            <Zap className="w-8 h-8 text-text-muted" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-text-primary text-lg leading-tight truncate">{skill.type}</h3>
                                        <span className={cn(
                                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/5 mt-1 inline-block",
                                            `text-rarity-${skill.rarity.toLowerCase()}`
                                        )}>
                                            {skill.rarity}
                                        </span>
                                    </div>
                                </div>

                                {/* Skill Info */}
                                <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                                    <div className="bg-bg-input/50 p-2 rounded flex items-center gap-2">
                                        <Clock className="w-3 h-3 text-accent-secondary" />
                                        <span className="text-text-muted">Duration:</span>
                                        <span className="font-mono font-bold ml-auto">{skill.activeDuration}s</span>
                                    </div>
                                    <div className="bg-bg-input/50 p-2 rounded flex items-center gap-2">
                                        <Crosshair className="w-3 h-3 text-accent-tertiary" />
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
                                                let value = stat.Value || 0;
                                                // Apply passive ascension multiplier
                                                if (statType === 'Damage') value *= (1 + ascensionMulti.passiveDmg);
                                                if (statType === 'Health') value *= (1 + ascensionMulti.passiveHp);
                                                const isPercent = false;

                                                // Only show positive values
                                                if (value <= 0) return null;

                                                let valueColor = "text-accent-secondary";
                                                if (statType === "Health") valueColor = "text-green-400";
                                                if (statType === "Damage") valueColor = "text-red-400";

                                                return (
                                                    <div key={idx} className="bg-bg-input/30 px-2 py-1.5 rounded flex items-center justify-between text-[11px] border border-white/5">
                                                        <span className="text-text-muted uppercase font-bold tracking-wider">{statType} (Passive)</span>
                                                        <span className={cn("font-mono font-bold", valueColor)}>+{formatNumber(value)}{isPercent ? '%' : ''}</span>
                                                    </div>
                                                );
                                            });
                                        })()}
                                    </div>
                                )}

                                {/* Stats at current level */}
                                <div className="grid grid-cols-2 gap-2 mt-auto">
                                    {dmgAtLevel > 0 && (
                                        <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-0.5 uppercase font-bold">
                                                <Sword className="w-3 h-3 text-red-400" /> Base Dmg
                                            </div>
                                            <div className="font-mono font-bold text-red-200 text-sm">
                                                {formatNumber(dmgAtLevel)}
                                            </div>
                                            <div className="text-[9px] text-text-muted mt-0.5">
                                                {Math.round(dmgAtLevel).toLocaleString()}
                                            </div>
                                        </div>
                                    )}
                                    {hpAtLevel > 0 && (
                                        <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                            <div className="flex items-center gap-1 text-[10px] text-text-muted mb-0.5 uppercase font-bold">
                                                <Heart className="w-3 h-3 text-green-400" /> Base HP
                                            </div>
                                            <div className="font-mono font-bold text-green-200 text-sm">
                                                {formatNumber(hpAtLevel)}
                                            </div>
                                            <div className="text-[9px] text-text-muted mt-0.5">
                                                {Math.round(hpAtLevel).toLocaleString()}
                                            </div>
                                        </div>
                                    )}
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
