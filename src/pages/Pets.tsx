import { useState, useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useProfile } from '../context/ProfileContext';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn, getRarityBgStyle } from '../lib/utils';
import { Search, Cat, Sword, Heart, Zap, Shield, Star } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { AscensionStars } from '../components/UI/AscensionStars';
import { getAscensionTexturePath } from '../utils/ascensionUtils';

function EggIcon({ rarity, size = 48, className, ascensionLevel = 0 }: { rarity: string; size?: number; className?: string; ascensionLevel?: number }) {
    const rarityIndex: Record<string, number> = {
        'Common': 0, 'Rare': 1, 'Epic': 2,
        'Legendary': 3, 'Ultimate': 4, 'Mythic': 5
    };

    const idx = rarityIndex[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);

    const xPos = (col / 3) * 100;
    const yPos = (row / 3) * 100;

    const texturePath = getAscensionTexturePath('Eggs', ascensionLevel);

    return (
        <div
            className={cn("inline-block shrink-0", className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${texturePath})`,
                backgroundPosition: `${xPos}% ${yPos}%`,
                backgroundSize: '400% 400%',
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated'
            }}
            title={rarity}
        />
    );
}

export default function Pets() {
    const { profile } = useProfile();
    const { data: petLibrary, loading: l1 } = useGameData<any>('PetLibrary.json');
    const { data: petUpgrades, loading: l2 } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancing, loading: l3 } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUnlockLib, loading: l3b } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    const { data: spriteMapping, loading: l4 } = useGameData<any>('ManualSpriteMapping.json');
    const { data: ascensionConfigs, loading: l5 } = useGameData<any>('AscensionConfigsLibrary.json');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterRarity, setFilterRarity] = useState<string | null>(null);
    const [globalLevel, setGlobalLevel] = useState(50);
    const [ascensionLevel, setAscensionLevel] = useState(0);

    const loading = l1 || l2 || l3 || l3b || l4 || l5;
    const petsConfig = spriteMapping?.pets;

    // Compute ascension multiplier from JSON
    const ascensionMulti = useMemo(() => {
        let dmg = 0, hp = 0;
        if (ascensionLevel > 0 && ascensionConfigs?.Pets?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Pets.AscensionConfigPerLevel;
            for (let i = 0; i < ascensionLevel && i < configs.length; i++) {
                for (const s of configs[i].StatContributions || []) {
                    const val = s.Value;
                    if (s.StatNode?.UniqueStat?.StatType === 'Damage') dmg += val;
                    if (s.StatNode?.UniqueStat?.StatType === 'Health') hp += val;
                }
            }
        }
        return { dmg, hp };
    }, [ascensionLevel, ascensionConfigs]);

    // Build lookup from ManualSpriteMapping
    const spriteLookup = useMemo(() => {
        if (!petsConfig?.mapping) return {};
        const lookup: Record<string, { spriteIndex: number; name: string }> = {};
        Object.entries(petsConfig.mapping).forEach(([idx, info]: [string, any]) => {
            const key = `${info.rarity}_${info.id}`;
            lookup[key] = { spriteIndex: parseInt(idx), name: info.name };
        });
        return lookup;
    }, [petsConfig]);

    // Check if pet is active in profile
    const isActiveInProfile = (rarity: string, id: number) => {
        return profile.pets.active.some(p => p.rarity === rarity && p.id === id);
    };

    // Process Pets
    const pets = useMemo(() => {
        if (!petLibrary) return [];
        return Object.values(petLibrary)
            .map((pet: any) => {
                const rarity = pet?.PetId?.Rarity || 'Common';
                const id = pet?.PetId?.Id ?? 0;
                const type = pet?.Type || 'Balanced';
                const key = `${rarity}_${id}`;
                const spriteInfo = spriteLookup[key];

                return {
                    id,
                    rarity,
                    type,
                    key,
                    name: spriteInfo?.name || `Pet #${id}`,
                    spriteIndex: spriteInfo?.spriteIndex ?? -1,
                };
            })
            .filter((pet) => {
                const matchSearch = pet.name.toLowerCase().includes(searchTerm.toLowerCase());
                const matchRarity = !filterRarity || pet.rarity === filterRarity;
                return matchSearch && matchRarity;
            })
            .sort((a, b) => {
                const rarityOrder = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];
                const rDiff = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
                return rDiff !== 0 ? rDiff : a.id - b.id;
            });
    }, [petLibrary, spriteLookup, searchTerm, filterRarity]);

    // Calculate sprite position
    const getSpriteStyle = (spriteIndex: number) => {
        if (!petsConfig || spriteIndex < 0) return null;
        const cols = petsConfig.grid?.columns || 8;
        const spriteW = petsConfig.sprite_size?.width || 256;
        const spriteH = petsConfig.sprite_size?.height || 256;
        const sheetW = petsConfig.texture_size?.width || 2048;
        const sheetH = petsConfig.texture_size?.height || 2048;

        const col = spriteIndex % cols;
        const row = Math.floor(spriteIndex / cols);
        const x = col * spriteW;
        const y = row * spriteH;

        const scale = 64 / spriteW;

        return {
            backgroundImage: `url(${getAscSpriteUrl()})`,
            backgroundPosition: `-${x * scale}px -${y * scale}px`,
            backgroundSize: `${sheetW * scale}px ${sheetH * scale}px`,
            width: '64px',
            height: '64px',
        };
    };

    const getAscSpriteUrl = () => {
        const baseUrl = import.meta.env.BASE_URL;
        if (ascensionLevel === 1) return `${baseUrl}Texture2D/MegaPets.png`;
        if (ascensionLevel === 2) return `${baseUrl}Texture2D/UltraPets.png`;
        if (ascensionLevel === 3) return `${baseUrl}Texture2D/ApexPets.png`;
        return `${baseUrl}Texture2D/Pets.png`;
    };

    const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary flex items-center gap-2">
                        <Cat className="w-8 h-8 text-accent-secondary" />
                        Pet Wiki
                    </h1>
                    <p className="text-text-secondary">Complete pet database with stats and type information.</p>
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
                        max={petUpgrades?.Common?.LevelInfo?.length || 100}
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
                            <span className="text-xs text-amber-400 font-mono">+{((ascensionMulti.dmg) * 100).toFixed(0)}%</span>
                        )}
                    </div>
                </div>
            </Card>

            {/* Egg Ascension Preview */}
            <Card className="p-6 bg-gradient-to-br from-bg-secondary/50 to-bg-card border-accent-secondary/20">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-2 rounded-lg bg-accent-secondary/10">
                        <Star className="w-5 h-5 text-accent-secondary" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-text-primary tracking-tight">Egg Ascension Preview</h2>
                        <p className="text-xs text-text-muted">Visual evolution of eggs based on ascension level</p>
                    </div>
                </div>
                
                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                    {['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'].map((rarity) => (
                        <div key={rarity} className="flex flex-col items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors group">
                            <div className="relative">
                                <div className={cn(
                                    "absolute inset-0 blur-xl opacity-20 group-hover:opacity-40 transition-opacity",
                                    `bg-rarity-${rarity.toLowerCase()}`
                                )} />
                                <EggIcon 
                                    rarity={rarity} 
                                    size={64} 
                                    ascensionLevel={ascensionLevel} 
                                    className="relative z-10 drop-shadow-xl scale-110 group-hover:scale-125 transition-transform duration-300" 
                                />
                            </div>
                            <span className={cn(
                                "text-[10px] font-black uppercase tracking-widest",
                                `text-rarity-${rarity.toLowerCase()}`
                            )}>
                                {rarity}
                            </span>
                        </div>
                    ))}
                </div>
            </Card>

            {loading ? (
                <div className="text-center py-12 text-text-muted">Loading Pets...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {pets.map((pet) => {
                        const isActive = isActiveInProfile(pet.rarity, pet.id);

                        // Stats at global level
                        const upgradeData = petUpgrades?.[pet.rarity]?.LevelInfo || [];
                        const levelIdx = Math.min(Math.max(1, globalLevel) - 1, upgradeData.length - 1);
                        const baseStats = upgradeData[Math.max(0, levelIdx)]?.PetStats?.Stats || [];

                        const baseDmg = baseStats.find((s: any) => s.StatNode?.UniqueStat?.StatType === 'Damage')?.Value || 0;
                        const baseHp = baseStats.find((s: any) => s.StatNode?.UniqueStat?.StatType === 'Health')?.Value || 0;

                        const typeMod = petBalancing?.[pet.type] || { DamageMultiplier: 1, HealthMultiplier: 1 };
                        const finalDmg = baseDmg * (typeMod.DamageMultiplier || 1) * (1 + ascensionMulti.dmg);
                        const finalHp = baseHp * (typeMod.HealthMultiplier || 1) * (1 + ascensionMulti.hp);

                        const spriteStyle = getSpriteStyle(pet.spriteIndex);

                        return (
                            <Card key={pet.key} variant="hover" className={cn(
                                "flex flex-col p-4 relative overflow-hidden transition-all",
                                isActive ? "border-accent-primary ring-2 ring-accent-primary" : ""
                            )}>
                                {/* Glow */}
                                <div className={cn(
                                    "absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 blur-2xl translate-x-10 -translate-y-10",
                                    `bg-rarity-${pet.rarity.toLowerCase()}`
                                )} />

                                {/* Active Badge (read-only) */}
                                {isActive && (
                                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-accent-primary text-white z-20">
                                        <Star className="w-4 h-4 fill-current" />
                                    </div>
                                )}

                                {/* Header */}
                                <div className="flex items-center gap-4 mb-4 relative z-10">
                                    <div
                                        className="w-16 h-16 rounded-xl flex items-center justify-center border-2 border-border overflow-hidden shrink-0"
                                        style={getRarityBgStyle(pet.rarity)}
                                    >
                                        {spriteStyle ? (
                                            <div style={spriteStyle} />
                                        ) : (
                                            <Cat className="w-8 h-8 text-text-muted" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-text-primary text-lg leading-tight truncate">{pet.name}</h3>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <span className={cn(
                                                "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/5",
                                                `text-rarity-${pet.rarity.toLowerCase()}`
                                            )}>
                                                {pet.rarity}
                                            </span>
                                            <span className={cn(
                                                "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                                                pet.type === 'Damage' ? "bg-red-500/20 text-red-400" :
                                                    pet.type === 'Health' ? "bg-green-500/20 text-green-400" :
                                                        "bg-blue-500/20 text-blue-400"
                                            )}>
                                                {pet.type === 'Damage' ? <Zap className="w-3 h-3 inline mr-0.5" /> :
                                                    pet.type === 'Health' ? <Shield className="w-3 h-3 inline mr-0.5" /> : null}
                                                {pet.type}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Stats at global level */}
                                <div className="grid grid-cols-2 gap-2 mt-auto">
                                    <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[10px] text-text-muted mb-0.5 uppercase font-bold">
                                            <Sword className="w-3 h-3 text-red-400" /> Base Dmg
                                        </div>
                                        <div className="font-mono font-bold text-red-200 text-sm">
                                            {formatNumber(finalDmg)}
                                        </div>
                                        <div className="text-[9px] text-text-muted mt-0.5">
                                            {Math.round(finalDmg).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[10px] text-text-muted mb-0.5 uppercase font-bold">
                                            <Heart className="w-3 h-3 text-green-400" /> Base HP
                                        </div>
                                        <div className="font-mono font-bold text-green-200 text-sm">
                                            {formatNumber(finalHp)}
                                        </div>
                                        <div className="text-[9px] text-text-muted mt-0.5">
                                            {Math.round(finalHp).toLocaleString()}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-4 pb-1">
                                    <div className="text-[10px] font-bold text-text-muted uppercase">Skills</div>
                                    <div className="bg-accent-primary/10 text-accent-primary px-2 py-0.5 rounded text-xs font-mono font-bold">
                                        {petUnlockLib?.[pet.rarity]?.NumberOfSecondStats || 0}
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {!loading && pets.length === 0 && (
                <div className="text-center py-12 text-text-muted">No pets found matching your search.</div>
            )}
        </div>
    );
}
