import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Zap, Plus, Minus, Search, Info, Save, Star, Grid, Settings } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useProfile } from '../../context/ProfileContext';
import { SkillSlot } from '../../types/Profile';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { RARITIES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { formatCompactNumber } from '../../utils/statsCalculator';

type MobileTab = 'rarity' | 'skills' | 'config';

interface SkillSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (skill: SkillSlot) => void;
    currentSkill?: SkillSlot;
    isPvp?: boolean;
    excludeSkillIds?: string[];
}

export function SkillSelectorModal({ isOpen, onClose, onSelect, currentSkill, isPvp = false, excludeSkillIds = [] }: SkillSelectorModalProps) {
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const globalStats = useGlobalStats();
    const { profile } = useProfile();

    const [selectedRarity, setSelectedRarity] = useState<string>('Common');
    const [mobileTab, setMobileTab] = useState<MobileTab>('rarity');
    const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
    const [skillLevel, setSkillLevel] = useState<number>(1);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (currentSkill) {
                setSelectedRarity(currentSkill.rarity);
                setSelectedSkillId(currentSkill.id);
                setSkillLevel(currentSkill.level);
            } else {
                setSelectedRarity('Common');
                setSelectedSkillId(null);
                setSkillLevel(1);
            }
            setSearchTerm('');
            setMobileTab('rarity');
        }
    }, [isOpen, currentSkill]);

    const filteredSkills = useMemo(() => {
        if (!skillLibrary || !spriteMapping?.skills?.mapping) return [];

        const skillsConfig = spriteMapping.skills;

        // Map over sprite mapping, lookup rarity in SkillLibrary
        return Object.entries(skillsConfig.mapping)
            .map(([idx, info]: [string, any]) => {
                const libData = skillLibrary[info.name];
                return {
                    spriteIndex: parseInt(idx),
                    id: info.name,
                    rarity: libData?.Rarity || 'Common', // Default if not found
                    ...info
                };
            })
            .filter((skill: any) => skill.rarity === selectedRarity)
            .filter((skill: any) => !searchTerm || skill.id.toLowerCase().includes(searchTerm.toLowerCase()))
            .filter((skill: any) => {
                // PVP Mode: Filter out explicitly excluded skills (duplicates in builder)
                if (isPvp) {
                    if (excludeSkillIds && excludeSkillIds.includes(skill.id)) return false;
                    return true;
                }

                // Profile Mode: Filter out equipped skills
                // Safely access equipped array
                const equipped = profile?.skills?.equipped || [];
                const isEquipped = equipped.some((s: any) => s.id === skill.id);
                return !isEquipped || (currentSkill && currentSkill.id === skill.id);
            });
    }, [skillLibrary, spriteMapping, selectedRarity, searchTerm, profile?.skills?.equipped, currentSkill, isPvp, excludeSkillIds]);



    const handleSkillSelect = (skillId: string) => {
        setSelectedSkillId(skillId);

        // Preload level from passives if available, otherwise default to 1
        // We check if the profile has a recorded level for this skill
        // PVP: Always default to 1, ignore profile
        if (!isPvp) {
            const passiveLevel = profile.skills?.passives?.[skillId];
            if (passiveLevel && passiveLevel > 0) {
                setSkillLevel(passiveLevel);
                return;
            }
        }

        setSkillLevel(1);
    };

    const handleSave = () => {
        if (selectedSkillId) {
            onSelect({
                id: selectedSkillId,
                rarity: selectedRarity,
                level: skillLevel,
                evolution: 0
            });
            onClose();
        }
    };

    const getSelectedSkillStats = () => {
        if (!selectedSkillId || !skillLibrary) return null;
        const skillData = skillLibrary[selectedSkillId];
        if (!skillData) return null;

        const levelIdx = Math.max(0, skillLevel - 1);
        const damage = skillData.DamagePerLevel?.[levelIdx] || 0;
        const health = skillData.HealthPerLevel?.[levelIdx] || 0;
        const duration = skillData.ActiveDuration || 0;
        const cooldown = skillData.Cooldown || 0;

        const reduction = globalStats?.skillCooldownReduction || 0;
        const effectiveCooldown = cooldown * Math.max(0.1, 1 - reduction);

        const maxLevel = Math.max(skillData.DamagePerLevel?.length || 0, skillData.HealthPerLevel?.length || 0);

        return { damage, health, duration, cooldown, effectiveCooldown, reduction, type: skillData.Type, maxLevel };
    };

    const selectedStats = getSelectedSkillStats();

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-text-primary animate-in fade-in duration-200">
            <div className="bg-bg-primary w-full max-w-5xl h-[85vh] rounded-2xl border border-border shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
                            <Zap className="w-6 h-6 text-accent-primary" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold">{currentSkill ? 'Edit Skill' : 'Select Skill'}</h3>
                            <p className="text-xs text-text-muted">Choose a skill and configure level</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Mobile Tab Navigation */}
                <div className="flex md:hidden border-b border-border bg-bg-secondary/10">
                    <button
                        onClick={() => setMobileTab('rarity')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'rarity'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Star className="w-4 h-4" />
                        Rarity
                    </button>
                    <button
                        onClick={() => setMobileTab('skills')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'skills'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Grid className="w-4 h-4" />
                        Skills
                    </button>
                    <button
                        onClick={() => setMobileTab('config')}
                        className={cn(
                            "flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors",
                            mobileTab === 'config'
                                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                : "border-transparent text-text-muted hover:text-text-primary"
                        )}
                    >
                        <Settings className="w-4 h-4" />
                        Config
                    </button>
                </div>

                {/* Mobile Content */}
                <div className="flex-1 overflow-hidden md:hidden">
                    {/* Mobile Rarity Selection */}
                    {mobileTab === 'rarity' && (
                        <div className="p-3 space-y-2 overflow-y-auto h-full">
                            <div className="text-xs font-bold text-text-muted uppercase mb-3">Select Rarity</div>
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setSelectedRarity(rarity);
                                        setSelectedSkillId(null);
                                        setMobileTab('skills');
                                    }}
                                    className={cn(
                                        "w-full text-left px-4 py-3 rounded-lg transition-all text-sm font-bold border-2",
                                        selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border-rarity-${rarity.toLowerCase()}/50`
                                            : "hover:bg-white/5 text-text-secondary border-transparent"
                                    )}
                                >
                                    {rarity}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Mobile Skills Grid */}
                    {mobileTab === 'skills' && (
                        <div className="p-3 overflow-y-auto h-full">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                                    <input
                                        placeholder="Search skills..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary"
                                    />
                                </div>
                            </div>
                            {filteredSkills.length > 0 ? (
                                <div className="grid grid-cols-3 min-[400px]:grid-cols-4 gap-3">
                                    {filteredSkills.map((skill: any) => (
                                        <button
                                            key={skill.id}
                                            onClick={() => {
                                                handleSkillSelect(skill.id);
                                                setMobileTab('config');
                                            }}
                                            className={cn(
                                                "aspect-square p-2 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all",
                                                selectedSkillId === skill.id
                                                    ? "bg-accent-primary/20 border-accent-primary shadow-lg"
                                                    : "bg-bg-secondary/40 border-border hover:border-accent-primary/50"
                                            )}
                                        >
                                            {spriteMapping?.skills && (
                                                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={getRarityBgStyle(selectedRarity)}>
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/SkillIcons.png"
                                                        spriteWidth={spriteMapping.skills.sprite_size.width}
                                                        spriteHeight={spriteMapping.skills.sprite_size.height}
                                                        sheetWidth={spriteMapping.skills.texture_size.width}
                                                        sheetHeight={spriteMapping.skills.texture_size.height}
                                                        iconIndex={skill.spriteIndex}
                                                        className="w-10 h-10"
                                                    />
                                                </div>
                                            )}
                                            <span className="text-[9px] font-bold text-center truncate w-full">{skill.id}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-text-muted py-8">No skills found</div>
                            )}
                        </div>
                    )}

                    {/* Mobile Config */}
                    {mobileTab === 'config' && (
                        <div className="p-4 overflow-y-auto h-full space-y-4">
                            {selectedSkillId && selectedStats ? (
                                <>
                                    <div className="text-center pb-4 border-b border-border">
                                        <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-3" style={getRarityBgStyle(selectedRarity)}>
                                            {spriteMapping?.skills && (
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/SkillIcons.png"
                                                    spriteWidth={spriteMapping.skills.sprite_size.width}
                                                    spriteHeight={spriteMapping.skills.sprite_size.height}
                                                    sheetWidth={spriteMapping.skills.texture_size.width}
                                                    sheetHeight={spriteMapping.skills.texture_size.height}
                                                    iconIndex={filteredSkills.find((s: any) => s.id === selectedSkillId)?.spriteIndex || 0}
                                                    className="w-16 h-16"
                                                />
                                            )}
                                        </div>
                                        <h2 className="text-lg font-bold break-words">{selectedSkillId}</h2>
                                        <p className={cn("text-xs font-bold uppercase", `text-rarity-${selectedRarity.toLowerCase()}`)}>{selectedRarity}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {selectedStats.damage > 0 && (
                                            <div className="bg-bg-input p-2 rounded border border-border/50">
                                                <div className="text-text-muted text-[10px] uppercase">Damage</div>
                                                <div className="font-mono font-bold text-accent-primary">{formatCompactNumber(selectedStats.damage)}</div>
                                            </div>
                                        )}
                                        {selectedStats.health > 0 && (
                                            <div className="bg-bg-input p-2 rounded border border-border/50">
                                                <div className="text-text-muted text-[10px] uppercase">Health</div>
                                                <div className="font-mono font-bold text-green-400">{formatCompactNumber(selectedStats.health)}</div>
                                            </div>
                                        )}
                                        <div className="bg-bg-input p-2 rounded border border-border/50">
                                            <div className="text-text-muted text-[10px] uppercase">Cooldown</div>
                                            <div className="font-mono flex items-center gap-1">
                                                <span className="text-accent-primary font-bold">{selectedStats.effectiveCooldown.toFixed(2)}s</span>
                                                {selectedStats.reduction > 0 && (
                                                    <span className="text-[10px] text-green-400">(-{(selectedStats.reduction * 100).toFixed(0)}%)</span>
                                                )}
                                            </div>
                                            <div className="text-[9px] text-text-muted">Base: {selectedStats.cooldown}s</div>
                                        </div>
                                        <div className="bg-bg-input p-2 rounded border border-border/50">
                                            <div className="text-text-muted text-[10px] uppercase">Duration</div>
                                            <div className="font-mono">{selectedStats.duration}s</div>
                                        </div>
                                    </div>
                                    {/* Level Input - Hidden in PVP */}
                                    {!isPvp && (
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold uppercase text-text-muted">Skill Level {selectedStats.maxLevel > 0 && `(Max ${selectedStats.maxLevel})`}</label>
                                            <div className="flex items-center gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => setSkillLevel(Math.max(1, skillLevel - 1))}><Minus className="w-4 h-4" /></Button>
                                                <Input
                                                    type="number"
                                                    value={skillLevel}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 1;
                                                        const max = selectedStats.maxLevel > 0 ? selectedStats.maxLevel : 9999;
                                                        setSkillLevel(Math.max(1, Math.min(max, val)));
                                                    }}
                                                    className="text-center font-mono font-bold"
                                                    onFocus={(e) => e.target.select()}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        const max = selectedStats.maxLevel > 0 ? selectedStats.maxLevel : 9999;
                                                        setSkillLevel(Math.min(max, skillLevel + 1));
                                                    }}
                                                    disabled={selectedStats.maxLevel > 0 && skillLevel >= selectedStats.maxLevel}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                    <Button variant="primary" className="w-full gap-2" onClick={handleSave}><Save className="w-4 h-4" />Confirm</Button>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50 space-y-4">
                                    <Info className="w-12 h-12" />
                                    <div className="text-sm text-center">Select a skill first</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Desktop Content */}
                <div className="flex-1 overflow-hidden hidden md:flex md:flex-row divide-x divide-border">
                    {/* Column 1: Rarity Selection - Desktop */}
                    <div className="w-40 p-3 overflow-y-auto bg-bg-secondary/10">
                        <div className="text-xs font-bold text-text-muted uppercase mb-2">Rarity</div>
                        <div className="space-y-1">
                            {RARITIES.map((rarity) => (
                                <button
                                    key={rarity}
                                    onClick={() => {
                                        setSelectedRarity(rarity);
                                        handleSkillSelect(''); // Reset selection
                                        setSelectedSkillId(null);
                                    }}
                                    className={cn(
                                        "w-full text-left px-3 py-2 rounded-lg transition-all text-sm font-medium",
                                        selectedRarity === rarity
                                            ? `bg-rarity-${rarity.toLowerCase()}/20 text-rarity-${rarity.toLowerCase()} border border-rarity-${rarity.toLowerCase()}/50`
                                            : "hover:bg-white/5 text-text-secondary"
                                    )}
                                >
                                    {rarity}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Column 2: Skill Grid - Desktop */}
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                                <input
                                    placeholder="Search skills..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-accent-primary"
                                />
                            </div>
                        </div>

                        {filteredSkills.length > 0 ? (
                            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                {filteredSkills.map((skill: any) => (
                                    <button
                                        key={skill.id}
                                        onClick={() => handleSkillSelect(skill.id)}
                                        className={cn(
                                            "aspect-square p-2 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 group relative overflow-hidden",
                                            selectedSkillId === skill.id
                                                ? `bg-accent-primary/20 border-accent-primary shadow-lg`
                                                : "bg-bg-secondary/40 border-border hover:border-accent-primary/50"
                                        )}
                                    >
                                        {spriteMapping?.skills && (
                                            <div
                                                className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                                                style={getRarityBgStyle(selectedRarity)}
                                            >
                                                <SpriteSheetIcon
                                                    textureSrc="./icons/game/SkillIcons.png"
                                                    spriteWidth={spriteMapping.skills.sprite_size.width}
                                                    spriteHeight={spriteMapping.skills.sprite_size.height}
                                                    sheetWidth={spriteMapping.skills.texture_size.width}
                                                    sheetHeight={spriteMapping.skills.texture_size.height}
                                                    iconIndex={skill.spriteIndex}
                                                    className="w-12 h-12"
                                                />
                                            </div>
                                        )}
                                        <span className="text-[10px] font-bold text-center truncate w-full px-1">{skill.id}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center text-text-muted py-8 italic">
                                No skills found for {selectedRarity}
                            </div>
                        )}
                    </div>

                    {/* Column 3: Config Panel - Desktop */}
                    <div className="w-80 bg-bg-secondary/5 p-4 overflow-y-auto flex flex-col gap-6">
                        {selectedSkillId && selectedStats ? (
                            <>
                                <div className="text-center pb-4 border-b border-border">
                                    <div
                                        className="w-24 h-24 mx-auto rounded-2xl flex items-center justify-center mb-3 shadow-inner border border-white/5 overflow-hidden shrink-0"
                                        style={getRarityBgStyle(selectedRarity)}
                                    >
                                        {(() => {
                                            const displaySkill = filteredSkills.find((s: any) => s.id === selectedSkillId);
                                            if (displaySkill && spriteMapping?.skills) {
                                                return (
                                                    <SpriteSheetIcon
                                                        textureSrc="./icons/game/SkillIcons.png"
                                                        spriteWidth={spriteMapping.skills.sprite_size.width}
                                                        spriteHeight={spriteMapping.skills.sprite_size.height}
                                                        sheetWidth={spriteMapping.skills.texture_size.width}
                                                        sheetHeight={spriteMapping.skills.texture_size.height}
                                                        iconIndex={displaySkill.spriteIndex}
                                                        className="w-20 h-20"
                                                    />
                                                );
                                            }
                                            return <Zap className="w-10 h-10 text-accent-primary" />;
                                        })()}
                                    </div>
                                    <h2 className="text-xl font-bold text-text-primary break-words">
                                        {selectedSkillId}
                                    </h2>
                                    <p className={cn("text-xs font-bold uppercase mt-1", `text-rarity-${selectedRarity.toLowerCase()}`)}>
                                        {selectedRarity}
                                    </p>
                                </div>

                                {/* Stats Display */}
                                <div className="space-y-3">
                                    <h4 className="text-xs font-bold uppercase text-text-muted">Stats (Lv{skillLevel})</h4>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        {selectedStats.damage > 0 && (
                                            <div className="bg-bg-input p-2 rounded border border-border/50">
                                                <div className="text-text-muted text-[10px] uppercase">Damage</div>
                                                <div className="font-mono font-bold text-accent-primary text-sm truncate" title={selectedStats.damage.toLocaleString()}>
                                                    {formatCompactNumber(selectedStats.damage)}
                                                </div>
                                            </div>
                                        )}
                                        {selectedStats.health > 0 && (
                                            <div className="bg-bg-input p-2 rounded border border-border/50">
                                                <div className="text-text-muted text-[10px] uppercase">Health</div>
                                                <div className="font-mono font-bold text-green-400 text-sm truncate" title={selectedStats.health.toLocaleString()}>
                                                    {formatCompactNumber(selectedStats.health)}
                                                </div>
                                            </div>
                                        )}
                                        <div className="bg-bg-input p-2 rounded border border-border/50">
                                            <div className="text-text-muted text-[10px] uppercase">Cooldown</div>
                                            <div className="font-mono flex items-center gap-1">
                                                <span className="text-accent-primary font-bold">{selectedStats.effectiveCooldown.toFixed(2)}s</span>
                                                {selectedStats.reduction > 0 && (
                                                    <span className="text-[10px] text-green-400">(-{(selectedStats.reduction * 100).toFixed(0)}%)</span>
                                                )}
                                            </div>
                                            <div className="text-[9px] text-text-muted">Base: {selectedStats.cooldown}s</div>
                                        </div>
                                        <div className="bg-bg-input p-2 rounded border border-border/50">
                                            <div className="text-text-muted text-[10px] uppercase">Duration</div>
                                            <div className="font-mono text-text-primary text-sm">{selectedStats.duration}s</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Level Input - Hidden in PVP */}
                                {!isPvp && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase text-text-muted flex items-center gap-2">
                                            Skill Level {selectedStats.maxLevel > 0 && `(Max ${selectedStats.maxLevel})`}
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => setSkillLevel(Math.max(1, skillLevel - 1))}>
                                                <Minus className="w-4 h-4" />
                                            </Button>
                                            <Input
                                                type="number"
                                                value={skillLevel}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value) || 1;
                                                    const max = selectedStats.maxLevel > 0 ? selectedStats.maxLevel : 9999;
                                                    setSkillLevel(Math.max(1, Math.min(max, val)));
                                                }}
                                                className="text-center font-mono font-bold"
                                                onFocus={(e) => e.target.select()}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const max = selectedStats.maxLevel > 0 ? selectedStats.maxLevel : 9999;
                                                    setSkillLevel(Math.min(max, skillLevel + 1));
                                                }}
                                                disabled={selectedStats.maxLevel > 0 && skillLevel >= selectedStats.maxLevel}
                                            >
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                <div className="pt-4 mt-auto">
                                    <Button variant="primary" className="w-full gap-2" onClick={handleSave}>
                                        <Save className="w-4 h-4" /> Confirm Selection
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-text-muted opacity-50 space-y-4">
                                <Info className="w-12 h-12" />
                                <div className="text-sm text-center px-4">Select a skill from the grid to view stats</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
