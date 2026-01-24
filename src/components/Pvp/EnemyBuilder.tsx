
import { useState } from 'react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { Sword, Shield, Heart, Zap, Plus, X } from 'lucide-react';
import { ItemSlot, SkillSlot } from '../../types/Profile';
import { ItemSelectorModal } from '../Profile/ItemSelectorModal';
import { SkillSelectorModal } from '../Profile/SkillSelectorModal';
import { cn, getRarityBgStyle } from '../../lib/utils';
import { getItemImage } from '../../utils/itemAssets';
import { AGES } from '../../utils/constants';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { useGameData } from '../../hooks/useGameData';

export interface EnemyConfig {
    weapon: ItemSlot | null;
    skills: (SkillSlot | null)[]; // Fixed 3 slots
    stats: {
        hp: number;
        damage: number;
        attackSpeed: number;
        critChance: number;
        critMulti: number;
        blockChance: number;
        lifesteal: number;
        doubleDamage: number;
    };
    name: string;
}

export function EnemyBuilder() {
    const [enemy, setEnemy] = useState<EnemyConfig>({
        weapon: null,
        skills: [null, null, null],
        stats: {
            hp: 10000,
            damage: 1000,
            attackSpeed: 1.0,
            critChance: 0.05,
            critMulti: 1.5,
            blockChance: 0,
            lifesteal: 0,
            doubleDamage: 0
        },
        name: "Enemy Player"
    });

    const [modalOpen, setModalOpen] = useState<'weapon' | 'skill_0' | 'skill_1' | 'skill_2' | null>(null);

    const handleStatChange = (stat: keyof typeof enemy.stats, value: string) => {
        setEnemy(prev => ({
            ...prev,
            stats: {
                ...prev.stats,
                [stat]: parseFloat(value) || 0
            }
        }));
    };

    const handleWeaponSelect = (item: ItemSlot | null) => {
        setEnemy(prev => ({ ...prev, weapon: item }));
    };

    const handleSkillSelect = (slotIdx: number, skill: SkillSlot) => {
        setEnemy(prev => {
            const newSkills = [...prev.skills];
            newSkills[slotIdx] = skill;
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

    // Helper for rendering skill icon
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    // We don't strictly need SkillLibrary for icons if we have ManualSpriteMapping, 
    // but we might need it for other metadata if desired.

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

        return (
            <button
                key={index}
                onClick={() => setModalOpen(`skill_${index}` as any)}
                className={cn(
                    "aspect-square rounded-xl border-2 border-dashed flex items-center justify-center relative overflow-hidden transition-all hover:border-accent-primary/50 group",
                    skill ? "border-solid border-border bg-bg-secondary/40" : "border-border/40 hover:bg-white/5"
                )}
            >
                {skill ? (
                    <>
                        <div className="absolute inset-0 flex items-center justify-center" style={{ ...getRarityBgStyle(skill.rarity), opacity: 0.2 }} />
                        {spriteMapping?.skills && (
                            <SpriteSheetIcon
                                textureSrc="/icons/game/SkillIcons.png"
                                spriteWidth={spriteMapping.skills.sprite_size.width}
                                spriteHeight={spriteMapping.skills.sprite_size.height}
                                sheetWidth={spriteMapping.skills.texture_size.width}
                                sheetHeight={spriteMapping.skills.texture_size.height}
                                iconIndex={spriteIndex}
                                className="w-12 h-12 relative z-10"
                            />
                        )}
                        {/* Fallback if no sprite */}
                        {!spriteMapping && <Zap className="w-8 h-8 text-accent-primary z-10" />}

                        <div className="absolute bottom-1 px-2 py-0.5 bg-black/60 rounded text-[10px] font-bold z-20 w-fit max-w-full text-center truncate">
                            {skill.id}
                        </div>
                        <div
                            className="absolute top-1 right-1 p-1 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-30 hover:bg-red-500/20 hover:text-red-400"
                            onClick={(e) => removeSkill(index, e)}
                        >
                            <X className="w-3 h-3" />
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center gap-2 text-text-muted/50 group-hover:text-text-muted transition-colors">
                        <Plus className="w-6 h-6" />
                        <span className="text-xs font-bold uppercase">Skill {index + 1}</span>
                    </div>
                )}
            </button>
        );
    };

    return (
        <Card className="p-6 space-y-8 bg-bg-secondary/5">
            <div className="flex items-center justify-between">
                <Input
                    value={enemy.name}
                    onChange={(e) => setEnemy(prev => ({ ...prev, name: e.target.value }))}
                    className="text-xl font-bold bg-transparent border-0 border-b border-border rounded-none px-0 w-auto focus:ring-0"
                />
                <div className="px-3 py-1 rounded bg-red-500/10 text-red-500 text-xs font-bold uppercase border border-red-500/20">
                    Opponent
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
                    <div className="grid grid-cols-3 gap-4">
                        {renderSkillSlot(0)}
                        {renderSkillSlot(1)}
                        {renderSkillSlot(2)}
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase text-text-muted flex items-center gap-2 border-t border-border pt-4">
                    <Shield className="w-4 h-4" /> Combat Stats
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatInput label="Health" value={enemy.stats.hp} onChange={(v: string) => handleStatChange('hp', v)} icon={<Heart className="w-3 h-3 text-green-500" />} />
                    <StatInput label="Damage" value={enemy.stats.damage} onChange={(v: string) => handleStatChange('damage', v)} icon={<Sword className="w-3 h-3 text-red-500" />} />
                    <StatInput label="Atk Speed" value={enemy.stats.attackSpeed} onChange={(v: string) => handleStatChange('attackSpeed', v)} step={0.1} />
                    <StatInput label="Crit %" value={enemy.stats.critChance} onChange={(v: string) => handleStatChange('critChance', v)} step={0.01} isPercent />
                    <StatInput label="Crit Dmg" value={enemy.stats.critMulti} onChange={(v: string) => handleStatChange('critMulti', v)} step={0.1} isPercent />
                    <StatInput label="Block %" value={enemy.stats.blockChance} onChange={(v: string) => handleStatChange('blockChance', v)} step={0.01} isPercent />
                    <StatInput label="Lifesteal %" value={enemy.stats.lifesteal} onChange={(v: string) => handleStatChange('lifesteal', v)} step={0.01} isPercent />
                    <StatInput label="Dbl Dmg %" value={enemy.stats.doubleDamage} onChange={(v: string) => handleStatChange('doubleDamage', v)} step={0.01} isPercent />
                </div>
            </div>

            <Button className="w-full py-4 text-lg font-bold bg-orange-600 hover:bg-orange-500 mt-6">
                START BATTLE SIMULATION
            </Button>

            {/* Modals */}
            <ItemSelectorModal
                isOpen={modalOpen === 'weapon'}
                onClose={() => setModalOpen(null)}
                slot="Weapon"
                current={enemy.weapon}
                onSelect={(item) => {
                    handleWeaponSelect(item);
                    setModalOpen(null);
                }}
            />

            <SkillSelectorModal
                isOpen={modalOpen?.startsWith('skill_') ?? false}
                onClose={() => setModalOpen(null)}
                currentSkill={modalOpen?.startsWith('skill_') ? enemy.skills[parseInt(modalOpen.split('_')[1])] || undefined : undefined}
                isPvp={true}
                excludeSkillIds={enemy.skills.map(s => s?.id).filter(Boolean) as string[]}
                onSelect={(skill) => {
                    if (modalOpen?.startsWith('skill_')) {
                        handleSkillSelect(parseInt(modalOpen.split('_')[1]), skill);
                    }
                    setModalOpen(null);
                }}
            />

        </Card>
    );
}

function StatInput({ label, value, onChange, icon, step = 1 }: any) {
    return (
        <div className="bg-bg-input p-2 rounded border border-border/50">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-text-muted uppercase font-bold flex items-center gap-1">
                    {icon} {label}
                </span>
            </div>
            <Input
                type="number"
                step={step}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="h-8 text-sm font-mono font-bold text-right"
            />
        </div>
    );
}

// Helper until we have proper asset util export
function getItemImageWithFallback(item: ItemSlot) {
    try {
        // Correct signature: ageName, slot, idx
        // Requires importing AGES from constants
        const ageName = AGES[item.age] || 'Primitive';
        return getItemImage(ageName, 'Weapon', item.idx) || '';
    } catch (e) {
        return '';
    }
}
