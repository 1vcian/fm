
import { useState } from 'react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { Sword, Shield, Heart, Zap, Plus, X, Crown, Sparkles, Play, Award, Loader2, Eye } from 'lucide-react';
import { ItemSlot, SkillSlot, PetSlot, MountSlot } from '../../types/Profile';
import { ItemSelectorModal } from '../Profile/ItemSelectorModal';
import { SkillSelectorModal } from '../Profile/SkillSelectorModal';
import { PetSelectorModal } from '../Profile/PetSelectorModal';
import { MountSelectorModal } from '../Profile/MountSelectorModal';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { getItemImage } from '../../utils/itemAssets';
import { AGES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useGameData } from '../../hooks/useGameData';
import { getStatName, getStatColor } from '../../utils/statNames';
import { PvpBattleVisualizer } from './PvpBattleVisualizer';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useProfile } from '../../context/ProfileContext';
import {
    simulatePvpBattleMulti,
    aggregatedStatsToPvpStats,
    profileToEnemyConfig,
    enemyConfigToPvpStats,
    PvpBattleResult,
    PvpPlayerStats,
    EnemyConfig,
    EnemySkillConfig,
    PassiveStatType,
    initPassiveStats
} from '../../utils/PvpBattleEngine';
import { useRef, useEffect, useMemo } from 'react';
import { Upload, Save, User } from 'lucide-react';
import { formatCompactNumber } from '../../utils/statsCalculator';

export function EnemyBuilder() {
    // Game Data & Profile
    const globalStats = useGlobalStats();
    const { profile, profiles } = useProfile();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');

    // ... (other hooks)

    // Derived stat types from JSON
    const availableStatTypes = useMemo(() => {
        if (!secondaryStatLibrary) return [];
        // Filter keys if necessary, or use all
        return Object.keys(secondaryStatLibrary);
    }, [secondaryStatLibrary]);

    // ... (rest of component)



    // Additional libraries for StatEngine conversion
    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');

    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');

    // Consolidated libraries object for helper
    const allLibs = {
        petUpgradeLibrary,
        petBalancingLibrary,
        petLibrary,
        skillLibrary,
        skillPassiveLibrary,
        mountUpgradeLibrary,
        techTreeLibrary,
        techTreePositionLibrary,
        itemBalancingLibrary,
        itemBalancingConfig,
        weaponLibrary,
        projectilesLibrary
    };

    // UI State
    const [modalOpen, setModalOpen] = useState<'weapon' | 'skill_0' | 'skill_1' | 'skill_2' | 'pet' | 'mount' | null>(null);
    const [visualizerOpen, setVisualizerOpen] = useState(false);
    const [simCount, setSimCount] = useState<number>(1000);
    const [isSimulating, setIsSimulating] = useState(false);
    const [simResults, setSimResults] = useState<{
        player1WinRate: number;
        player2WinRate: number;
        tieRate: number;
        avgTime: number;
        timeoutRate: number;
        lastResult?: PvpBattleResult;
    } | null>(null);

    // Enemy Config State
    const [enemy, setEnemy] = useState<EnemyConfig>({
        weapon: null,
        skills: [null, null, null],
        stats: {
            power: undefined,
            hp: 10000,
            damage: 1000,
        },
        passiveStats: initPassiveStats(),
        name: "Enemy Player",
        pets: [null, null, null],
        mount: null
    });

    // Save/Load Logic
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [savedEnemies, setSavedEnemies] = useState<EnemyConfig[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem('forgeMaster_savedEnemies');
        if (saved) {
            try {
                setSavedEnemies(JSON.parse(saved));
            } catch (e) { console.error(e); }
        }
    }, []);

    const saveToLocalStorage = (list: EnemyConfig[]) => {
        localStorage.setItem('forgeMaster_savedEnemies', JSON.stringify(list));
        setSavedEnemies(list);
    };

    const handleSaveEnemy = () => {
        if (!enemy.name) return;
        const existingIdx = savedEnemies.findIndex(e => e.name === enemy.name);
        let newList;
        if (existingIdx >= 0) {
            if (!confirm(`Overwrite existing enemy "${enemy.name}"?`)) return;
            newList = [...savedEnemies];
            newList[existingIdx] = enemy;
        } else {
            newList = [...savedEnemies, enemy];
        }
        saveToLocalStorage(newList);
    };

    const handleImportProfile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const json = JSON.parse(ev.target?.result as string);
                if (!json.items && !json.techTree) throw new Error("Invalid profile format");
                const config = profileToEnemyConfig(json, allLibs);
                setEnemy(config);
            } catch (err) { alert("Failed to import profile: " + err); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleSelectProfile = (profileId: string) => {
        if (!profileId) return;
        const p = profiles.find(pr => pr.id === profileId);
        if (!p) return;
        try {
            const config = profileToEnemyConfig(p, allLibs);
            setEnemy(config);
        } catch (e) { alert("Error converting profile: " + e); }
    };

    const handleWeaponSelect = (item: ItemSlot | null) => {
        setEnemy(prev => ({ ...prev, weapon: item }));
    };

    const handlePetSelect = (index: number, pet: PetSlot | null) => {
        setEnemy(prev => {
            const newPets = [...(prev.pets || [null, null, null])];
            newPets[index] = pet;
            return { ...prev, pets: newPets };
        });
    };



    const updatePetHp = (index: number, hp: number) => {
        setEnemy(prev => {
            const newPets = [...(prev.pets || [null, null, null])];
            if (newPets[index]) {
                newPets[index] = { ...newPets[index]!, hp };
            }
            return { ...prev, pets: newPets };
        });
    };

    const handleMountSelect = (mount: MountSlot | null) => {
        setEnemy(prev => ({ ...prev, mount: mount }));
    };

    const handleSkillSelect = (slotIdx: number, skill: SkillSlot) => {
        const skillData = skillLibrary?.[skill.id];
        if (!skillData) return;

        const hasDamage = (skillData.DamagePerLevel?.length || 0) > 0;
        const hasHealth = (skillData.HealthPerLevel?.length || 0) > 0;

        const enemySkill: EnemySkillConfig = {
            id: skill.id,
            rarity: skill.rarity,
            damage: hasDamage ? 0 : undefined,
            health: hasHealth ? 0 : undefined,
            cooldown: skillData.Cooldown || 0,
            duration: skillData.ActiveDuration || 0,
            hasDamage,
            hasHealth
        };

        setEnemy(prev => {
            const newSkills = [...prev.skills];
            newSkills[slotIdx] = enemySkill;
            return { ...prev, skills: newSkills };
        });
    };

    const handleSkillValueChange = (slotIdx: number, field: 'damage' | 'health', value: string) => {
        const numValue = Math.max(0, parseFloat(value) || 0);
        setEnemy(prev => {
            const newSkills = [...prev.skills];
            if (newSkills[slotIdx]) {
                newSkills[slotIdx] = { ...newSkills[slotIdx]!, [field]: numValue };
            }
            return { ...prev, skills: newSkills };
        });
    };

    const removeSkill = (slotIdx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setEnemy(prev => {
            const newSkills = [...prev.skills];
            newSkills[slotIdx] = null;
            return { ...prev, skills: newSkills };
        });
    };

    const togglePassiveStat = (statId: PassiveStatType) => {
        setEnemy(prev => {
            const currentStat = prev.passiveStats[statId] || { enabled: false, value: 0 };
            return {
                ...prev,
                passiveStats: {
                    ...prev.passiveStats,
                    [statId]: {
                        ...currentStat,
                        enabled: !currentStat.enabled
                    }
                }
            };
        });
    };

    const updatePassiveStatValue = (statId: PassiveStatType, value: string) => {
        const numValue = parseFloat(value) || 0;
        setEnemy(prev => {
            const currentStat = prev.passiveStats[statId] || { enabled: false, value: 0 };
            return {
                ...prev,
                passiveStats: {
                    ...prev.passiveStats,
                    [statId]: {
                        ...currentStat,
                        value: numValue
                    }
                }
            };
        });
    };

    const runSimulation = async () => {
        if (!globalStats || !skillLibrary || !weaponLibrary || !pvpBaseConfig || !mountUpgradeLibrary) return;

        setIsSimulating(true);
        setSimResults(null);

        // Allow UI to update before heavy calc
        setTimeout(() => {
            try {
                // 1. Convert Player 1 (User) Stats
                const p1Stats = aggregatedStatsToPvpStats(
                    globalStats,
                    profile.skills.equipped,
                    skillLibrary
                );

                // 2. Convert Player 2 (Enemy) Stats
                const p2Stats = enemyConfigToPvpStats(
                    enemy,
                    weaponLibrary,
                    pvpBaseConfig,
                    mountUpgradeLibrary,
                    petLibrary,
                    petBalancingLibrary
                );

                // 3. Run Simulation
                const results = simulatePvpBattleMulti(p1Stats, p2Stats, simCount);

                setSimResults({
                    player1WinRate: results.player1WinRate,
                    player2WinRate: results.player2WinRate,
                    tieRate: results.tieRate,
                    avgTime: results.avgTime,
                    timeoutRate: results.timeoutRate,
                    lastResult: results.results[results.results.length - 1]
                });
            } catch (err) {
                console.error("Simulation failed:", err);
            } finally {
                setIsSimulating(false);
            }
        }, 100);
    };

    const handleViewBattle = () => {
        setVisualizerOpen(true);
    };

    // Helper to get current stats for visualizer
    const getBattleStats = (): { p1: PvpPlayerStats, p2: PvpPlayerStats } | null => {
        if (!globalStats || !skillLibrary || !weaponLibrary || !pvpBaseConfig || !mountUpgradeLibrary) return null;
        try {
            const p1 = aggregatedStatsToPvpStats(globalStats, profile.skills.equipped, skillLibrary, pvpBaseConfig);
            const p2 = enemyConfigToPvpStats(
                enemy,
                weaponLibrary,
                pvpBaseConfig,
                mountUpgradeLibrary,
                petLibrary,
                petBalancingLibrary
            );
            return { p1, p2 };
        } catch (e) {
            console.error(e);
            return null;
        }
    };
    const currentStats = visualizerOpen ? getBattleStats() : null;

    // --- Rendering Helpers ---

    const getSkillSpriteIndex = (skillId: string) => {
        if (!spriteMapping?.skills?.mapping) return 0;
        const entry = Object.entries(spriteMapping.skills.mapping).find(
            ([_, val]: [string, any]) => val.name === skillId
        );
        return entry ? parseInt(entry[0]) : 0;
    };

    const renderSkillSlot = (index: number) => {
        const skill = enemy.skills[index];
        const spriteIndex = skill ? getSkillSpriteIndex(skill.id) : 0;

        if (!skill) {
            return (
                <button
                    key={index}
                    onClick={() => setModalOpen(`skill_${index}` as any)}
                    className={cn(
                        "aspect-square rounded-xl border-2 border-dashed flex items-center justify-center transition-all hover:border-accent-primary/50 group",
                        "border-border/40 hover:bg-white/5"
                    )}
                >
                    <div className="flex flex-col items-center gap-2 text-text-muted/50 group-hover:text-text-muted transition-colors">
                        <Plus className="w-6 h-6" />
                        <span className="text-xs font-bold uppercase">Skill {index + 1}</span>
                    </div>
                </button>
            );
        }

        return (
            <div
                key={index}
                className="rounded-xl border border-border bg-bg-secondary/40 p-3 space-y-2 relative"
            >
                <div className="flex items-center gap-2">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
                        style={{ ...getRarityBgStyle(skill.rarity), opacity: 0.8 }}
                    >
                        {spriteMapping?.skills && (
                            <SpriteSheetIcon
                                textureSrc="./icons/game/SkillIcons.png"
                                spriteWidth={spriteMapping.skills.sprite_size.width}
                                spriteHeight={spriteMapping.skills.sprite_size.height}
                                sheetWidth={spriteMapping.skills.texture_size.width}
                                sheetHeight={spriteMapping.skills.texture_size.height}
                                iconIndex={spriteIndex}
                                className="w-8 h-8"
                            />
                        )}
                        {!spriteMapping && <Zap className="w-5 h-5 text-accent-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{skill.id}</div>
                        <div className={cn("text-[10px] uppercase font-bold", `text-rarity-${skill.rarity.toLowerCase()}`)}>
                            {skill.rarity}
                        </div>
                    </div>
                    <button
                        className="p-1 bg-black/40 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        onClick={(e) => removeSkill(index, e)}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>

                <div className="space-y-1.5">
                    {skill.hasDamage && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 bg-bg-input/50 rounded p-1.5 relative">
                                <Sword className="w-3 h-3 text-red-400 shrink-0" />
                                <span className="text-[10px] text-text-muted uppercase w-10">DMG</span>
                                {renderPreview(skill.damage)}
                                <Input
                                    type="number"
                                    value={skill.damage || ''}
                                    onChange={(e) => handleSkillValueChange(index, 'damage', e.target.value)}
                                    placeholder="Required"
                                    className={cn(
                                        "h-6 text-xs font-mono text-right flex-1 bg-transparent border-0 p-0",
                                        !skill.damage && "text-red-400 placeholder:text-red-400/50"
                                    )}
                                />
                            </div>
                            <div className="text-[9px] text-text-muted/70 italic px-1">
                                → Value <span className="text-accent-primary font-bold">X</span> from skill description
                            </div>
                        </div>
                    )}
                    {skill.hasHealth && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 bg-bg-input/50 rounded p-1.5 relative">
                                <Heart className="w-3 h-3 text-green-400 shrink-0" />
                                <span className="text-[10px] text-text-muted uppercase w-10">HP</span>
                                {renderPreview(skill.health)}
                                <Input
                                    type="number"
                                    value={skill.health || ''}
                                    onChange={(e) => handleSkillValueChange(index, 'health', e.target.value)}
                                    placeholder="Required"
                                    className={cn(
                                        "h-6 text-xs font-mono text-right flex-1 bg-transparent border-0 p-0",
                                        !skill.health && "text-green-400 placeholder:text-green-400/50"
                                    )}
                                />
                            </div>
                            <div className="text-[9px] text-text-muted/70 italic px-1">
                                → Value <span className="text-green-400 font-bold">{skill.hasDamage ? 'Y' : 'X'}</span> from skill description
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-around text-[9px] text-text-muted pt-1 border-t border-border/30">
                    <span>CD: {skill.cooldown}s</span>
                    {skill.duration > 0 && <span>Dur: {skill.duration}s</span>}
                </div>
            </div>
        );
    };

    const enabledPassiveCount = Object.values(enemy.passiveStats).filter(s => s.enabled).length;

    const renderPreview = (val: number | undefined) => {
        if (!val || val < 1000) return null;
        return (
            <span className="absolute -top-2.5 right-0 text-[10px] text-accent-primary font-mono bg-black/80 px-1 rounded pointer-events-none z-10 border border-accent-primary/20">
                {formatCompactNumber(val)}
            </span>
        );
    };

    return (
        <Card className="p-6 bg-bg-secondary/5">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-border/50">
                <div className="flex items-center gap-2 mr-auto">
                    <User className="w-4 h-4 text-text-muted" />
                    <select
                        className="bg-bg-input text-xs rounded border border-border p-1.5 h-8 min-w-[120px]"
                        onChange={(e) => handleSelectProfile(e.target.value)}
                        value=""
                    >
                        <option value="" disabled>Select Profile...</option>
                        {profiles.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>

                <div className="h-6 w-px bg-border mx-2" />

                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".json"
                    onChange={handleImportProfile}
                />

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 text-xs gap-1"
                >
                    <Upload className="w-3 h-3" /> Import JSON
                </Button>

                <div className="flex items-center gap-2">
                    <select
                        className="bg-bg-input text-xs rounded border border-border p-1.5 h-8 w-32"
                        onChange={(e) => {
                            const selected = savedEnemies.find(en => en.name === e.target.value);
                            if (selected) setEnemy(selected);
                        }}
                        value=""
                    >
                        <option value="" disabled>Load Saved...</option>
                        {savedEnemies.map((en, i) => (
                            <option key={i} value={en.name}>{en.name}</option>
                        ))}
                    </select>

                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSaveEnemy}
                        disabled={!enemy.name}
                        className="h-8 text-xs gap-1"
                    >
                        <Save className="w-3 h-3" /> Save
                    </Button>
                </div>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <Input
                    value={enemy.name}
                    onChange={(e) => setEnemy(prev => ({ ...prev, name: e.target.value }))}
                    className="text-xl font-bold bg-transparent border-0 border-b border-border rounded-none px-0 w-auto focus:ring-0"
                />
                <div className="px-3 py-1 rounded bg-red-500/10 text-red-500 text-xs font-bold uppercase border border-red-500/20">
                    Opponent
                </div>
            </div>

            {/* Power (Optional) */}
            <div className="flex items-center gap-4 bg-bg-input/30 p-3 rounded-lg border border-border/30">
                <Crown className="w-5 h-5 text-yellow-500" />
                <div className="flex-1">
                    <span className="text-xs text-text-muted uppercase font-bold">Power (Optional)</span>
                </div>
                <div className="relative">
                    {renderPreview(enemy.stats.power)}
                    <Input
                        type="number"
                        value={enemy.stats.power ?? ''}
                        onChange={(e) => setEnemy(prev => ({
                            ...prev,
                            stats: { ...prev.stats, power: e.target.value ? parseFloat(e.target.value) : undefined }
                        }))}
                        placeholder="—"
                        className="w-32 h-8 text-sm font-mono font-bold text-right"
                    />
                </div>
            </div>

            {/* Weapon & Skills Row */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-6">

                {/* Weapon Selection */}
                <div className="space-y-3">
                    <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2">
                        <Sword className="w-4 h-4" /> Weapon
                    </h3>
                    <button
                        onClick={() => setModalOpen('weapon')}
                        className={cn(
                            "w-full aspect-[4/3] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-all hover:border-accent-primary/50 group relative overflow-hidden",
                            enemy.weapon ? "border-solid border-border bg-bg-secondary/40" : "border-border/40 hover:bg-white/5"
                        )}
                    >
                        {enemy.weapon ? (
                            <>
                                <div className="absolute inset-0 pointer-events-none" style={{ ...getRarityBgStyle(enemy.weapon.rarity), opacity: 0.1 }} />
                                <div
                                    className="w-16 h-16 bg-contain bg-center bg-no-repeat relative z-10"
                                    style={{ backgroundImage: `url(${getItemImageWithFallback(enemy.weapon)})` }}
                                />
                                <div className="z-10 text-center">
                                    <div className={cn("text-sm font-bold", `text-rarity-${enemy.weapon.rarity.toLowerCase()}`)}>
                                        Weapon
                                    </div>
                                    <div className="text-xs text-text-muted">Rank {enemy.weapon.idx + 1}</div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="p-3 rounded-full bg-bg-input group-hover:bg-accent-primary/10 transition-colors">
                                    <Sword className="w-6 h-6 text-text-muted group-hover:text-accent-primary" />
                                </div>
                                <span className="text-sm font-bold text-text-muted group-hover:text-text-primary">Select Weapon</span>
                            </>
                        )}
                    </button>
                    {enemy.weapon && (
                        <div className="text-xs text-center text-text-muted">
                            Attack Speed: {((1 / (enemy.weapon as any).attackDuration || 1)).toFixed(2)}/s (Est)
                        </div>
                    )}
                </div>

                {/* Skills Selection */}
                <div className="space-y-3">
                    <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2">
                        <Zap className="w-4 h-4" /> Active Skills (3 max)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {renderSkillSlot(0)}
                        {renderSkillSlot(1)}
                        {renderSkillSlot(2)}
                    </div>
                </div>
            </div>

            {/* Base Stats */}
            <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2 border-t border-border pt-4">
                    <Shield className="w-4 h-4" /> Base Stats
                </h3>
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-bg-input p-3 rounded border border-border/50 relative">
                        <div className="flex items-center gap-2 mb-2">
                            <Heart className="w-4 h-4 text-green-500" />
                            <span className="text-xs text-text-muted uppercase font-bold">Total Health</span>
                        </div>
                        {renderPreview(enemy.stats.hp)}
                        <Input
                            type="number"
                            value={enemy.stats.hp}
                            onChange={(e) => setEnemy(prev => ({
                                ...prev,
                                stats: { ...prev.stats, hp: Math.max(0, parseFloat(e.target.value) || 0) }
                            }))}
                            className="h-10 text-lg font-mono font-bold text-right"
                        />
                    </div>
                    <div className="bg-bg-input p-3 rounded border border-border/50 relative">
                        <div className="flex items-center gap-2 mb-2">
                            <Sword className="w-4 h-4 text-red-500" />
                            <span className="text-xs text-text-muted uppercase font-bold">Total Damage</span>
                        </div>
                        {renderPreview(enemy.stats.damage)}
                        <Input
                            type="number"
                            value={enemy.stats.damage}
                            onChange={(e) => setEnemy(prev => ({
                                ...prev,
                                stats: { ...prev.stats, damage: Math.max(0, parseFloat(e.target.value) || 0) }
                            }))}
                            className="h-10 text-lg font-mono font-bold text-right"
                        />
                    </div>
                </div>
            </div>

            {/* Pet & Mount Stats for PvP */}
            <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2 border-t border-border pt-4">
                    <Heart className="w-4 h-4" /> Pet & Mount (PvP)
                </h3>
                <p className="text-xs text-text-muted/70 -mt-2">
                    Select up to 3 active Pets and a Mount to apply their stats.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Pet Selection (3 Slots) */}
                    <div className="space-y-2">
                        <span className="text-xs font-bold uppercase text-text-muted">Active Pets</span>
                        <div className="grid grid-cols-3 gap-2">
                            {[0, 1, 2].map(idx => {
                                const pet = enemy.pets?.[idx];
                                return (
                                    <div key={idx} className="space-y-1">
                                        <button
                                            onClick={() => setModalOpen(`pet_${idx}` as any)}
                                            className={cn(
                                                "w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-all hover:border-accent-primary/50 group relative overflow-hidden",
                                                pet ? "border-solid border-border bg-bg-secondary/40" : "border-border/40 hover:bg-white/5"
                                            )}
                                        >
                                            {pet ? (
                                                <>
                                                    <div className="absolute inset-0 pointer-events-none" style={{ ...getRarityBgStyle(pet.rarity), opacity: 0.1 }} />
                                                    <div className="relative z-10 w-10 h-10 flex items-center justify-center">
                                                        {spriteMapping?.pets ? (
                                                            <SpriteSheetIcon
                                                                textureSrc="./icons/game/Pets.png"
                                                                spriteWidth={spriteMapping.pets.sprite_size.width}
                                                                spriteHeight={spriteMapping.pets.sprite_size.height}
                                                                sheetWidth={spriteMapping.pets.texture_size.width}
                                                                sheetHeight={spriteMapping.pets.texture_size.height}
                                                                iconIndex={(() => {
                                                                    const entry = Object.entries(spriteMapping.pets.mapping).find(([_, val]: [string, any]) => val.id === pet.id && val.rarity === pet.rarity);
                                                                    return entry ? parseInt(entry[0]) : 0;
                                                                })()}
                                                                className="w-10 h-10 object-contain"
                                                            />
                                                        ) : (
                                                            <Heart className="w-6 h-6 text-pink-400" />
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <Heart className="w-5 h-5 text-text-muted group-hover:text-accent-primary" />
                                            )}
                                        </button>

                                        {/* HP Input */}
                                        {pet && (
                                            <div className="flex items-center gap-1 relative pt-2">
                                                <span className="text-[10px] text-text-muted font-bold">HP</span>
                                                {renderPreview(pet.hp)}
                                                <Input
                                                    type="number"
                                                    value={pet.hp || ''}
                                                    onChange={(e) => updatePetHp(idx, Math.max(0, parseFloat(e.target.value) || 0))}
                                                    className="h-6 w-20 bg-transparent border-0 border-b border-border rounded-none px-0 text-center font-mono font-bold focus:ring-0 text-[10px]"
                                                    placeholder="HP"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Mount Selection */}
                    <div className="space-y-2">
                        <span className="text-xs font-bold uppercase text-text-muted">Mount</span>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setModalOpen('mount')}
                                className={cn(
                                    "w-32 aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-3 transition-all hover:border-accent-primary/50 group relative overflow-hidden",
                                    enemy.mount ? "border-solid border-border bg-bg-secondary/40" : "border-border/40 hover:bg-white/5"
                                )}
                            >
                                {enemy.mount ? (
                                    <>
                                        <div className="absolute inset-0 pointer-events-none" style={{ ...getRarityBgStyle(enemy.mount.rarity), opacity: 0.1 }} />
                                        <div className="relative z-10 w-12 h-12 flex items-center justify-center">
                                            {spriteMapping?.mounts ? (
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/MountIcons.png"
                                                    spriteWidth={spriteMapping.mounts.sprite_size.width}
                                                    spriteHeight={spriteMapping.mounts.sprite_size.height}
                                                    sheetWidth={spriteMapping.mounts.texture_size.width}
                                                    sheetHeight={spriteMapping.mounts.texture_size.height}
                                                    iconIndex={(() => {
                                                        const entry = Object.entries(spriteMapping.mounts.mapping).find(([_, val]: [string, any]) => val.id === enemy.mount!.id && val.rarity === enemy.mount!.rarity);
                                                        return entry ? parseInt(entry[0]) : 0;
                                                    })()}
                                                    className="w-12 h-12 object-contain"
                                                />
                                            ) : (
                                                <Crown className="w-8 h-8 text-yellow-400" />
                                            )}
                                        </div>
                                        <div className="z-10 text-center">
                                            <div className={cn("text-[10px] font-bold", `text-rarity-${enemy.mount.rarity.toLowerCase()}`)}>
                                                {enemy.mount.rarity}
                                            </div>
                                            <div className="flex items-center gap-1 justify-center mt-1">
                                                <span className="text-[10px] text-text-muted font-bold">HP%</span>
                                                <Input
                                                    type="number"
                                                    value={enemy.mount.hp || ''}
                                                    onChange={(e) => {
                                                        const val = Math.max(0, parseFloat(e.target.value) || 0);
                                                        setEnemy(prev => prev.mount ? { ...prev, mount: { ...prev.mount, hp: val } } : prev);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="h-5 w-12 bg-transparent border-0 border-b border-border rounded-none px-0 text-center font-mono font-bold focus:ring-0 text-[10px]"
                                                    placeholder="%"
                                                />
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="p-2 rounded-full bg-bg-input group-hover:bg-accent-primary/10 transition-colors">
                                            <Crown className="w-5 h-5 text-text-muted group-hover:text-accent-primary" />
                                        </div>
                                        <span className="text-xs font-bold text-text-muted group-hover:text-text-primary">Select Mount</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Passive Stats - Toggleable */}
            <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2 border-t border-border pt-4">
                    <Sparkles className="w-4 h-4" /> Passive Stats
                    <span className="text-[10px] bg-bg-input px-2 py-0.5 rounded border border-border/50">
                        {enabledPassiveCount} enabled
                    </span>
                </h3>
                <p className="text-xs text-text-muted/70 -mt-2">
                    Enable stats and enter the <span className="font-bold text-accent-primary">total cumulative value</span> from the enemy profile.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {availableStatTypes.map(statId => {
                        const stat = enemy.passiveStats[statId] || { enabled: false, value: 0 };
                        const colorClass = getStatColor(statId);

                        return (
                            <div
                                key={statId}
                                className={cn(
                                    "flex items-center gap-2 p-2 rounded border transition-all",
                                    stat.enabled
                                        ? "bg-bg-input border-border"
                                        : "bg-bg-input/30 border-border/30 opacity-60"
                                )}
                            >
                                <button
                                    onClick={() => togglePassiveStat(statId)}
                                    className={cn(
                                        "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                                        stat.enabled
                                            ? "bg-accent-primary border-accent-primary text-black"
                                            : "border-border/50 hover:border-accent-primary/50"
                                    )}
                                >
                                    {stat.enabled && <span className="text-xs font-bold">✓</span>}
                                </button>
                                <span className={cn("text-xs font-medium flex-1 min-w-0 truncate", stat.enabled ? colorClass : "text-text-muted")}>
                                    {getStatName(statId) || statId}
                                </span>
                                {stat.enabled && (
                                    <div className="flex items-center gap-1">
                                        <Input
                                            type="number"
                                            step="0.1"
                                            value={stat.value || ''}
                                            onChange={(e) => updatePassiveStatValue(statId, e.target.value)}
                                            placeholder="0"
                                            className="w-16 h-6 text-xs font-mono text-right bg-bg-secondary/50 border-0 p-1"
                                        />
                                        <span className="text-[10px] text-text-muted">%</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Simulation Controls */}
            <div className="mt-8 space-y-4">
                <div className="flex items-center gap-4 bg-bg-secondary/30 p-4 rounded-xl border border-border">
                    <div className="flex flex-col gap-1 flex-1">
                        <span className="text-xs font-bold uppercase text-text-muted">Simulation Count</span>
                        <Input
                            type="number"
                            value={simCount}
                            onChange={(e) => setSimCount(Math.max(1, Math.min(10000, parseInt(e.target.value) || 1000)))}
                            className="w-full text-lg font-mono font-bold"
                            max={10000}
                            min={1}
                        />
                    </div>
                    <Button
                        size="lg"
                        className="flex-[2] py-8 text-xl font-bold bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-900/20"
                        onClick={runSimulation}
                        disabled={isSimulating}
                    >
                        {isSimulating ? (
                            <>
                                <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                                SIMULATING...
                            </>
                        ) : (
                            <>
                                <Play className="w-6 h-6 mr-2 fill-current" />
                                START BATTLE
                            </>
                        )}
                    </Button>
                </div>

                {simResults && (
                    <div className="bg-bg-input/50 rounded-xl border border-border p-4 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <Award className="w-5 h-5 text-accent-primary" />
                                Simulation Results
                            </h3>
                            <Button variant="outline" size="sm" onClick={handleViewBattle}>
                                <Eye className="w-4 h-4 mr-1" /> View Battle
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-green-500/10 p-3 rounded-lg border border-green-500/20 text-center">
                                <div className="text-[10px] text-green-400/80 uppercase mb-1">Win Rate</div>
                                <div className="text-2xl font-bold text-green-400">{simResults.player1WinRate.toFixed(1)}%</div>
                            </div>
                            <div className="bg-red-500/10 p-3 rounded-lg border border-red-500/20 text-center">
                                <div className="text-[10px] text-red-400/80 uppercase mb-1">Loss Rate</div>
                                <div className="text-2xl font-bold text-red-400">{simResults.player2WinRate.toFixed(1)}%</div>
                            </div>
                            <div className="bg-bg-primary/50 p-3 rounded-lg border border-border/50 text-center">
                                <div className="text-[10px] text-text-muted uppercase mb-1">Tie / Timeout</div>
                                <div className="text-xl font-bold">{simResults.tieRate.toFixed(1)}%</div>
                            </div>
                            <div className="bg-bg-primary/50 p-3 rounded-lg border border-border/50 text-center">
                                <div className="text-[10px] text-text-muted uppercase mb-1">Avg Duration</div>
                                <div className="text-xl font-bold">{simResults.avgTime.toFixed(1)}s</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            {visualizerOpen && currentStats && (
                <PvpBattleVisualizer
                    isOpen={visualizerOpen}
                    onClose={() => setVisualizerOpen(false)}
                    player1Stats={currentStats.p1}
                    player2Stats={currentStats.p2}
                    player1Name={profile?.name || "Player"}
                    player2Name={enemy.name}
                />
            )}

            <ItemSelectorModal
                isOpen={modalOpen === 'weapon'}
                onClose={() => setModalOpen(null)}
                slot="Weapon"
                current={enemy.weapon}
                isPvp={true}
                onSelect={(item) => {
                    handleWeaponSelect(item);
                    setModalOpen(null);
                }}
            />

            <SkillSelectorModal
                isOpen={modalOpen?.startsWith('skill_') ?? false}
                onClose={() => setModalOpen(null)}
                currentSkill={undefined}
                isPvp={true}
                excludeSkillIds={enemy.skills.map(s => s?.id).filter(Boolean) as string[]}
                onSelect={(skill) => {
                    if (modalOpen?.startsWith('skill_')) {
                        handleSkillSelect(parseInt(modalOpen.split('_')[1]), skill);
                    }
                    setModalOpen(null);
                }}
            />

            <PetSelectorModal
                isOpen={modalOpen?.startsWith('pet_') ?? false}
                onClose={() => setModalOpen(null)}
                currentPet={(() => {
                    const idx = modalOpen?.startsWith('pet_') ? parseInt(modalOpen.split('_')[1]) : 0;
                    return enemy.pets?.[idx] || undefined;
                })()}
                context="pvp"
                onSelect={(pet) => {
                    if (modalOpen?.startsWith('pet_')) {
                        handlePetSelect(parseInt(modalOpen.split('_')[1]), pet);
                    }
                    setModalOpen(null);
                }}
            />

            <MountSelectorModal
                isOpen={modalOpen === 'mount'}
                onClose={() => setModalOpen(null)}
                currentMount={enemy.mount || undefined}
                context="pvp"
                onSelect={(rarity, id, level, secondaryStats) => {
                    handleMountSelect({
                        rarity,
                        id,
                        level,
                        secondaryStats,
                        evolution: 0,
                        skills: [],
                        hp: 0
                    });
                    setModalOpen(null);
                }}
            />

        </Card>
    );
}

// Helper until we have proper asset util export
function getItemImageWithFallback(item: ItemSlot) {
    try {
        const ageName = AGES[item.age] || 'Primitive';
        return getItemImage(ageName, 'Weapon', item.idx) || '';
    } catch (e) {
        return '';
    }
}
