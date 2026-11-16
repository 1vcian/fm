import { RARITIES } from '../utils/constants';
import { useState, useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { usePetNames } from '../hooks/usePetNames';
import { useProfile } from '../context/ProfileContext';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn, getRarityBgStyle } from '../lib/utils';
import { BookOpen, TrendingUp } from 'lucide-react';
import { formatNumber } from '../utils/format';
import { AscensionStars } from '../components/UI/AscensionStars';
import { ascensionMultiplierFor } from '../utils/ascensionUnlocks';
import { useRarityAscensionFrom } from '../hooks/useAscensionUnlocks';
import { FromAscensionBadge } from '../components/UI/FromAscensionBadge';
import { useGameDataContext } from '../context/GameDataContext';
import { useComparison } from '../context/ComparisonContext';
import { formatCompactNumber } from '../utils/statsCalculator';
import { EggIcon } from '../components/UI/EggIcon';


import { usePersistentState } from '../hooks/usePersistentState';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { unitIcon, unitIconStyle } from '../utils/unitIcons';

export default function Pets() {
    const { profile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { data: petLibrary, loading: l1 } = useGameData<any>('PetLibrary.json');
    const petName = usePetNames();
    const { data: petUpgrades, loading: l2 } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancing, loading: l3 } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petUnlockLib, loading: l3b } = useGameData<any>('SecondaryStatPetUnlockLibrary.json');
    // Enumerable.Last over the library rows, in config order (used once pets are ascended).
    const lastPetUnlockRow = useMemo(() => {
        const rows = petUnlockLib ? Object.values(petUnlockLib) : [];
        return rows.length ? (rows[rows.length - 1] as any) : undefined;
    }, [petUnlockLib]);
    const { data: spriteMapping, loading: l4 } = useGameData<any>('ManualSpriteMapping.json');
    const { data: ascensionConfigs, loading: l5 } = useGameData<any>('AscensionConfigsLibrary.json');

    const [searchTerm, setSearchTerm] = useState('');
    const [filterRarity, setFilterRarity] = usePersistentState<string | null>('wiki_pets_filter_rarity', null);
    const [globalLevel, setGlobalLevel] = usePersistentState<number>('wiki_pets_global_level', 50);
    const [ascensionLevel, setAscensionLevel] = usePersistentState<number>('wiki_pets_ascension_level', 0);

    const loading = l1 || l2 || l3 || l3b || l4 || l5;
    const petsConfig = spriteMapping?.pets;

    // Ascensions-layer multiplier of the picked pet ascension (utils/ascensionUnlocks.ts): only
    // AscensionConfigPerLevel[Level - 1], applied to every pet rarity (Target Pet, no qualifier).
    const ascensionMulti = useMemo(
        () => ascensionMultiplierFor(ascensionConfigs, 'Pets', ascensionLevel, 'PetStatTarget'),
        [ascensionLevel, ascensionConfigs]
    );
    // Rarity -> first pet ascension whose egg summon table can roll it (pets hatch from eggs).
    const rarityFrom = useRarityAscensionFrom('EggSummonConfig.json');

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
                    name: petName(rarity, id),
                    spriteIndex: spriteInfo?.spriteIndex ?? -1,
                };
            })
            .filter((pet) => {
                const matchSearch = pet.name.toLowerCase().includes(searchTerm.toLowerCase());
                const matchRarity = !filterRarity || pet.rarity === filterRarity;
                return matchSearch && matchRarity;
            })
            .sort((a, b) => {
                const rarityOrder = RARITIES;
                const rDiff = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
                return rDiff !== 0 ? rDiff : a.id - b.id;
            });
    }, [petLibrary, spriteLookup, searchTerm, filterRarity]);

    // Sprite of the unit in the mapping cell `spriteIndex`, as the game draws it at this ascension
    const getSpriteStyle = (spriteIndex: number) =>
        spriteIndex < 0 ? null : unitIconStyle(unitIcon(petsConfig, spriteIndex, ascensionLevel, selectedVersion), 64);

    // Calculate cumulative experience per rarity
    const rarityCumulativeExp = useMemo(() => {
        if (!petUpgrades) return {};
        const result: Record<string, number[]> = {};
        Object.keys(petUpgrades).forEach(rarity => {
            const levelInfo = petUpgrades[rarity]?.LevelInfo || [];
            let sum = 0;
            const sums = [0]; // sums[D] = game total XP of a display level D pet with 0 progress (includes LevelInfo[0], the pet's own base XP)
            for (let i = 0; i < levelInfo.length; i++) {
                sum += levelInfo[i].Experience || 0;
                sums.push(sum);
            }
            result[rarity] = sums;
        });
        return result;
    }, [petUpgrades]);

    const rarities = RARITIES;

    const { isCompactStats } = useComparison();

    const formatStatValue = (val: number) => {
        return isCompactStats 
            ? formatCompactNumber(val)
            : val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12 px-4 sm:px-0">
            <div className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-border pb-6">
                <div className="w-full">
                    <h1 className="text-3xl font-bold text-text-primary flex items-center gap-2">
                        <GameAssetIcon asset={{ sheet: 'Pets', index: 7 }} size={32} />
                        Pet Wiki
                    </h1>
                    <p className="text-text-secondary text-sm sm:text-base">Complete pet database with stats and type information.</p>
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
                        max={petUpgrades?.Common?.LevelInfo?.length}
                        disabled={!petUpgrades?.Common?.LevelInfo?.length}
                        value={globalLevel}
                        onChange={(e) => setGlobalLevel(parseInt(e.target.value))}
                        className="flex-1 accent-accent-primary"
                    />
                    <span className="font-mono font-bold text-accent-primary w-10 text-center">{globalLevel}</span>
                    <div className="h-6 w-px bg-border/50 hidden sm:block" />
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-secondary whitespace-nowrap">Ascension:</span>
                        <AscensionStars type="Pets" value={ascensionLevel} onChange={setAscensionLevel} />
                        {/* Ascensions-layer Multiplier: x(1 + Value) of AscensionConfigPerLevel[Level - 1] only (AscensionModel.GetLevelStats 0x7C79F80; layer math in docs/skill-verification-2026_10.md section 2). */}
                        {ascensionLevel > 0 && (
                            <span className="text-xs text-amber-400 font-mono">x{formatNumber(ascensionMulti.dmg)}</span>
                        )}
                    </div>
                </div>
                <p className="text-[11px] text-text-muted mt-2">
                    {ascensionLevel > 0
                        ? `Damage and Health at level ${globalLevel} with the pet ascension ${ascensionLevel} bonus (x${formatNumber(ascensionMulti.dmg)}), pet type multiplier included. Tech tree and other bonuses are not added.`
                        : `Base Damage and Health at level ${globalLevel}, pet type multiplier included, no ascension bonus. Pick an ascension to apply its bonus.`}
                </p>
            </Card>

            {/* Egg Ascension Preview */}
            <Card className="p-6 bg-gradient-to-br from-bg-secondary/50 to-bg-card border-accent-secondary/20">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-2 rounded-lg bg-accent-secondary/10">
                        <GameAssetIcon asset={{ icon: 'AscensionStar' }} size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-text-primary tracking-tight">Egg Ascension Preview</h2>
                        <p className="text-xs text-text-muted">Visual evolution of eggs based on ascension level</p>
                    </div>
                </div>

                <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                    {RARITIES.map((rarity) => (
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
                            <FromAscensionBadge ascension={rarityFrom[rarity]} source="pet" />
                            <div className="text-[10px] font-mono text-text-muted bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                Base Exp: {(petUpgrades?.[rarity]?.LevelInfo?.[0]?.Experience || 0).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {loading ? (
                <div className="text-center py-12 text-text-muted">Loading Pets</div>
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
                        // Not obtainable at the picked ascension: shown dimmed, not hidden, with the
                        // stats of the first ascension that can obtain it (the qualifier-less Pet
                        // target reaches every rarity, so that ascension's multiplier applies to it).
                        const fromAsc = rarityFrom[pet.rarity];
                        const lockedHere = !!fromAsc && ascensionLevel < fromAsc;
                        const shownAsc = lockedHere ? fromAsc : ascensionLevel;
                        const multi = lockedHere ? ascensionMultiplierFor(ascensionConfigs, 'Pets', fromAsc, 'PetStatTarget') : ascensionMulti;
                        const finalDmg = baseDmg * (typeMod.DamageMultiplier || 1) * multi.dmg;
                        const finalHp = baseHp * (typeMod.HealthMultiplier || 1) * multi.hp;

                        const spriteStyle = getSpriteStyle(pet.spriteIndex);

                        return (
                            <Card key={pet.key} variant="hover" className={cn(
                                "flex flex-col p-4 relative overflow-hidden transition-all",
                                isActive ? "border-accent-primary ring-2 ring-accent-primary" : "",
                                lockedHere && !isActive ? "opacity-60" : ""
                            )}>
                                {/* Glow */}
                                <div className={cn(
                                    "absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 blur-2xl translate-x-10 -translate-y-10",
                                    `bg-rarity-${pet.rarity.toLowerCase()}`
                                )} />

                                {/* Active Badge (read-only) */}
                                {isActive && (
                                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-accent-primary text-white z-20">
                                        <GameAssetIcon asset={{ icon: 'Star' }} size={16} />
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
                                            <GameAssetIcon asset={{ sheet: 'Pets', index: 7 }} size={32} />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-text-primary text-lg leading-tight whitespace-nowrap overflow-hidden text-clip">{pet.name}</h3>
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
                                                {pet.type === 'Damage' ? <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 0 }} size={12} className="align-middle mr-0.5" /> :
                                                    pet.type === 'Health' ? <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 1 }} size={12} className="align-middle mr-0.5" /> : null}
                                                {pet.type}
                                            </span>
                                            <FromAscensionBadge ascension={fromAsc} source="pet" />
                                        </div>
                                    </div>
                                </div>

                                {lockedHere && (
                                    <div className="relative z-10 mb-3 text-[10px] text-amber-300/90 bg-amber-400/5 border border-amber-400/20 rounded px-2 py-1">
                                        Not obtainable at pet ascension {ascensionLevel}. Stats shown at ascension {fromAsc}, the first one that can obtain it.
                                    </div>
                                )}
                                {/* Stats at global level */}
                                <div className="grid grid-cols-2 gap-2 mt-auto">
                                    <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[10px] text-text-muted mb-0.5 uppercase font-bold">
                                            <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 0 }} size={12} /> Damage
                                        </div>
                                        <div className="font-mono font-bold text-red-200">
                                            +{formatStatValue(finalDmg)}
                                        </div>
                                    </div>
                                    <div className="bg-bg-input/50 p-2 rounded flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[10px] text-green-400 mb-1 uppercase font-bold">
                                            <GameAssetIcon asset={{ sheet: 'TechTreeIcons', index: 1 }} size={12} /> Health
                                        </div>
                                        <div className="font-mono font-bold text-green-200">
                                            +{formatStatValue(finalHp)}
                                        </div>
                                    </div>
                                </div>

                                {/* Experience Stats */}
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                    <div className="bg-bg-primary/50 p-2 rounded border border-white/5 flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[9px] text-text-muted mb-0.5 uppercase font-bold">
                                            <TrendingUp className="w-2.5 h-2.5 text-accent-primary" /> Next Lvl
                                        </div>
                                        <div className="font-mono font-bold text-accent-primary text-xs">
                                            {/* Stored level is 0-based (display D = stored D - 1); the game needs LevelInfo[stored + 1].Experience to level up, i.e. LevelInfo[D]. LevelInfo[0] is the pet's base XP. */}
                                            {globalLevel >= upgradeData.length ? 'MAX' : (upgradeData[globalLevel]?.Experience || 0).toLocaleString()}
                                        </div>
                                    </div>
                                    <div className="bg-bg-primary/50 p-2 rounded border border-white/5 flex flex-col items-center">
                                        <div className="flex items-center gap-1 text-[9px] text-text-muted mb-0.5 uppercase font-bold">
                                            <BookOpen className="w-2.5 h-2.5 text-accent-secondary" /> Total Exp
                                        </div>
                                        <div className="font-mono font-bold text-accent-secondary text-xs">
                                            {(rarityCumulativeExp[pet.rarity]?.[globalLevel] || 0).toLocaleString()}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-4 pb-1">
                                    {/* Count of secondary stats (PetExtensions.CreatePet 0x7845D44): with pets ascended
                                        (PetsAscensionLevel >= 1) the game takes the LAST SecondaryStatPetUnlockLibrary row,
                                        otherwise the row of the pet's rarity; its NumberOfSecondStats is the count. */}
                                    <div className="text-[10px] font-bold text-text-muted uppercase">Substats</div>
                                    <div className="bg-accent-primary/10 text-accent-primary px-2 py-0.5 rounded text-xs font-mono font-bold">
                                        {(shownAsc > 0 ? lastPetUnlockRow : petUnlockLib?.[pet.rarity])?.NumberOfSecondStats || 0}
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
