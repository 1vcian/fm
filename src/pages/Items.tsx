import { useState, useMemo } from 'react';
import { getItemImage } from '../utils/itemAssets';
import { useGameData } from '../hooks/useGameData';
import { useProfile } from '../context/ProfileContext';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { Sword, Zap, Activity } from 'lucide-react';
import { BreakpointWikiModal } from '../components/Wiki/BreakpointWikiModal';
import { cn, getAgeBgStyle, getAgeIconStyle, getInventoryIconStyle } from '../lib/utils';
import { AGES } from '../utils/constants';
import { useTreeModifiers } from '../hooks/useCalculatedStats';
import { formatNumber } from '../utils/format';
import { AscensionStars } from '../components/UI/AscensionStars';

const SLOTS = ['Weapon', 'Helmet', 'Armour', 'Gloves', 'Shoes', 'Necklace', 'Ring', 'Belt'];

export default function Items() {
    const { profile } = useProfile();
    const { data: itemLibrary, loading: loadingItemLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: secondaryParams, loading: loadingSecondaryParams } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { data: autoMapping, loading: loadingAutoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: balancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const techModifiers = useTreeModifiers();

    // Default to first age (Primitive)
    const [selectedAgeIdx, setSelectedAgeIdx] = useState<number>(0);
    const [selectedSlot, setSelectedSlot] = useState<string>('Weapon');
    const [selectedLevel, setSelectedLevel] = useState<number>(1);
    const [ascensionLevel, setAscensionLevel] = useState<number>(profile.misc.forgeAscensionLevel || 0);
    const [breakpointModal, setBreakpointModal] = useState<{ isOpen: boolean; weapon?: any }>({ isOpen: false });

    // Dynamic Max Level calculation
    const currentMaxLevel = useMemo(() => {
        const base = balancingConfig?.ItemBaseMaxLevel || 98;
        const slotBonusKey = {
            'Weapon': 'WeaponLevelUp',
            'Helmet': 'HelmetLevelUp',
            'Armour': 'BodyLevelUp',
            'Gloves': 'GloveLevelUp',
            'Belt': 'BeltLevelUp',
            'Necklace': 'NecklaceLevelUp',
            'Ring': 'RingLevelUp',
            'Shoes': 'ShoeLevelUp'
        }[selectedSlot] || '';

        const bonus = techModifiers[slotBonusKey] || 0;
        return base + bonus;
    }, [balancingConfig, selectedSlot, techModifiers]);

    // Ascension Multiplier calculation
    const forgeAscensionMulti = useMemo(() => {
        let total = 0;
        if (ascensionLevel > 0 && ascensionConfigs?.Forge?.AscensionConfigPerLevel) {
            const configs = ascensionConfigs.Forge.AscensionConfigPerLevel;
            // The config values are per level, we sum them up to get the cumulative multiplier increment
            for (let i = 0; i < ascensionLevel && i < configs.length; i++) {
                // We pick the first stat contribution (they are usually the same for HP/Dmg in Forge)
                // (Value + 1) / 100 converts game value (e.g. 49) to multiplier increment (e.g. 0.5)
                const contrib = configs[i].StatContributions?.[0];
                if (contrib) {
                    total += (contrib.Value + 1) / 100;
                }
            }
        }
        return total;
    }, [ascensionLevel, ascensionConfigs]);

    // Scaling factor from config
    const levelScaling = balancingConfig?.LevelScalingBase || 1.01;
    const meleeBaseMulti = balancingConfig?.PlayerMeleeDamageMultiplier || 1.6;

    // Tech stat bonus key for the current slot
    const statBonusKey = useMemo(() => ({
        'Weapon': 'WeaponBonus',
        'Helmet': 'HelmetBonus',
        'Armour': 'BodyBonus',
        'Gloves': 'GloveBonus',
        'Belt': 'BeltBonus',
        'Necklace': 'NecklaceBonus',
        'Ring': 'RingBonus',
        'Shoes': 'ShoeBonus'
    }[selectedSlot] || ''), [selectedSlot]);

    const statMultiplier = useMemo(() => 1 + (techModifiers[statBonusKey] || 0), [techModifiers, statBonusKey]);

    const loading = loadingItemLibrary || loadingSecondaryParams || loadingAutoMapping;

    const items = useMemo(() => {
        if (!itemLibrary) return [];
        return Object.values(itemLibrary).filter((item: any) => {
            const iId = item.ItemId;
            // Filter by Age Index (0-9) and Slot
            return iId?.Age === selectedAgeIdx && iId?.Type === selectedSlot;
        }).sort((a: any, b: any) => (a.ItemId?.Idx || 0) - (b.ItemId?.Idx || 0));
    }, [itemLibrary, selectedAgeIdx, selectedSlot]);

    const getIconForSlot = (slot: string) => {
        const style = getInventoryIconStyle(slot, 24);
        if (style) {
            return <div style={style} className="shrink-0" />;
        }
        return <GameIcon name="star" className="w-6 h-6" />;
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
            <BreakpointWikiModal 
                isOpen={breakpointModal.isOpen}
                onClose={() => setBreakpointModal({ isOpen: false })}
                weaponName={breakpointModal.weapon?.Name || 'Weapon'}
                weaponAttackDuration={breakpointModal.weapon?.AttackDuration || 1.1}
                weaponWindupTime={breakpointModal.weapon?.WindupTime || 0.4}
            />

            {/* Header / Age Selector */}
            <div className="flex flex-col gap-6">
                <div className="px-4 sm:px-0">
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                        <Sword className="w-8 h-8 sm:w-10 h-10 text-accent-primary" />
                        Item Wiki
                    </h1>
                    <p className="text-text-muted mt-1 text-sm sm:text-base">Browse equipment stats across all ages.</p>
                </div>

                {/* Age Filter Bar */}
                <div className="flex gap-2 overflow-x-auto pb-4 custom-scrollbar">
                    {AGES.map((ageName, idx) => (
                        <button
                            key={idx}
                            onClick={() => setSelectedAgeIdx(idx)}
                            className={cn(
                                "flex flex-col items-center gap-2 p-3 min-w-[100px] rounded-xl border-2 transition-all duration-200",
                                selectedAgeIdx === idx
                                    ? "border-accent-primary bg-accent-primary/10 shadow-[0_0_15px_rgba(var(--accent-primary-rgb),0.3)]"
                                    : "border-border bg-bg-secondary hover:border-accent-primary/50 hover:bg-bg-input"
                            )}
                        >
                            {/* Placeholder for Age Image */}
                            {/* Age Sprite Icon */}
                            <div
                                style={getAgeIconStyle(idx, 48)}
                                className={cn(
                                    "shrink-0 rounded bg-white/10",
                                    selectedAgeIdx === idx ? "opacity-100" : "opacity-40 grayscale"
                                )}
                            />
                            <span className={cn(
                                "text-xs font-bold whitespace-nowrap",
                                selectedAgeIdx === idx ? "text-accent-primary" : "text-text-secondary"
                            )}>
                                {ageName}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Slot Filter Bar */}
                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar border-b border-border/50">
                    {SLOTS.map(slot => (
                        <button
                            key={slot}
                            onClick={() => setSelectedSlot(slot)}
                            className={cn(
                                "px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap flex items-center gap-2",
                                selectedSlot === slot
                                    ? "bg-accent-primary text-white shadow-lg"
                                    : "bg-transparent text-text-muted hover:text-text-primary hover:bg-bg-input"
                            )}
                        >
                            {getIconForSlot(slot)}
                            {slot}
                        </button>
                    ))}
                </div>

                {/* Level Slider */}
                <Card className="p-4 bg-bg-secondary/50 border-accent-primary/20">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-accent-primary/10 rounded-lg">
                                <GameIcon name="hammer" className="w-8 h-8" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Item Level</h3>
                                <p className="text-xs text-text-muted">Simulate stats at different levels</p>
                            </div>
                        </div>

                        <div className="flex-1 flex items-center gap-6">
                            <input
                                type="range"
                                min="1"
                                max={currentMaxLevel}
                                value={selectedLevel}
                                onChange={(e) => setSelectedLevel(parseInt(e.target.value))}
                                className="flex-1 h-3 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                            />
                            <div className="min-w-[80px] bg-accent-primary/20 text-accent-primary px-3 py-1.5 rounded-lg font-mono font-bold text-center border border-accent-primary/30">
                                Lv {selectedLevel}
                            </div>
                        </div>

                        <div className="h-10 w-px bg-border/50 hidden md:block" />

                        <div className="flex items-center gap-4">
                            <AscensionStars value={ascensionLevel} onChange={setAscensionLevel} />
                            {forgeAscensionMulti > 0 && (
                                <div className="bg-amber-400/10 text-amber-400 px-2 py-1 rounded text-xs font-mono font-bold border border-amber-400/20">
                                    +{(forgeAscensionMulti * 100).toLocaleString()}%
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            </div>

            {loading ? (
                <div className="text-center py-24">
                    <div className="text-accent-primary animate-spin mb-4 text-4xl">⟳</div>
                    <div className="text-text-muted text-lg animate-pulse">Forging Items...</div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 px-4 sm:px-0">
                    {items.length > 0 ? items.map((item: any, i: number) => {
                        const stats = item.EquipmentStats || [];
                        // We can also extract secondary stat info from SecondaryStatItemUnlockLibrary based on age
                        const secondaryData = secondaryParams?.[String(selectedAgeIdx)];
                        const numSecondary = (ascensionLevel > 0) ? 2 : (secondaryData?.NumberOfSecondStats || 0);

                        return (
                            <Card key={i} className="flex flex-col h-full hover:border-accent-primary/50 transition-all duration-300 group overflow-hidden">
                                <div className="p-5 flex-1 space-y-5">
                                    <div className="flex items-center gap-4">
                                        <div
                                            className="w-16 h-16 rounded-lg border border-border flex items-center justify-center mb-3 group-hover:border-accent-primary transition-colors shrink-0"
                                            style={getAgeBgStyle(selectedAgeIdx)}
                                        >
                                            {getItemImage(AGES[selectedAgeIdx], selectedSlot, item.ItemId?.Idx, autoMapping) ? (
                                                <img
                                                    src={getItemImage(AGES[selectedAgeIdx], selectedSlot, item.ItemId?.Idx, autoMapping)!}
                                                    alt={item.Name}
                                                    className="w-12 h-12 object-contain"
                                                />
                                            ) : (
                                                <span className="text-2xl text-text-muted">?</span>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-xl text-text-primary group-hover:text-accent-primary transition-colors">
                                                {selectedSlot} {item.ItemId?.Idx + 1}
                                            </h3>
                                            <div className="text-xs text-text-muted flex gap-2 mt-1">
                                                <span className="bg-bg-input px-2 py-0.5 rounded border border-border/50">Idx: {item.ItemId?.Idx}</span>
                                                <span className="bg-bg-input px-2 py-0.5 rounded border border-border/50">{AGES[selectedAgeIdx]}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="space-y-2">
                                        {stats.map((stat: any, idx: number) => {
                                            const statType = stat.StatNode?.UniqueStat?.StatType;
                                            let baseValue = stat.Value || 0;

                                            // Apply scaling based on selected level
                                            let scaledValue = baseValue * Math.pow(levelScaling, Math.max(0, selectedLevel - 1));

                                            // Apply Tech Tree stat multiplier
                                            scaledValue *= statMultiplier;

                                            // Apply Forge Ascension multiplier
                                            scaledValue *= (1 + forgeAscensionMulti);

                                            // Apply Melee multiplier for weapons if applicable
                                            if (selectedSlot === 'Weapon' && (statType === 'Damage' || statType === 'Attack')) {
                                                const weaponKey = `{'Age': ${selectedAgeIdx}, 'Type': 'Weapon', 'Idx': ${item.ItemId?.Idx}}`;
                                                const weaponData = weaponLibrary?.[weaponKey];
                                                // AttackRange < 1 means Melee
                                                if (weaponData && (weaponData.AttackRange ?? 0) < 1) {
                                                    scaledValue *= meleeBaseMulti;
                                                }
                                            }

                                            return (
                                                <div key={idx} className="flex flex-col bg-bg-input/50 p-2 rounded border border-border/30">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs text-text-secondary">Base {statType}</span>
                                                        <span className="font-mono font-bold text-text-primary">
                                                            {formatNumber(Math.floor(scaledValue))}
                                                        </span>
                                                    </div>
                                                    <div className="text-[9px] text-text-muted text-right mt-0.5">
                                                        {Math.floor(scaledValue).toLocaleString()}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* Weapon Specific Info (Range/Speed) */}
                                        {selectedSlot === 'Weapon' && (() => {
                                            const weaponKey = `{'Age': ${selectedAgeIdx}, 'Type': 'Weapon', 'Idx': ${item.ItemId?.Idx}}`;
                                            const weaponData = weaponLibrary?.[weaponKey];
                                            if (!weaponData) return null;

                                            const projectileId = weaponData.ProjectileId;
                                            const projectileData = (projectileId !== undefined && projectileId >= 0)
                                                ? projectilesLibrary?.[String(projectileId)]
                                                : null;

                                            return (
                                                <div className="mt-4 pt-4 border-t border-border/30 grid grid-cols-2 gap-2">
                                                    <div className="bg-bg-input/50 p-2 rounded border border-border/30 flex flex-col">
                                                        <span className="text-[10px] text-text-muted uppercase font-bold">Range</span>
                                                        <span className="font-mono font-bold text-text-primary">{weaponData.AttackRange?.toFixed(1) || '0.0'}</span>
                                                    </div>
                                                    <div className="bg-bg-input/50 p-2 rounded border border-border/30 flex flex-col">
                                                        <span className="text-[10px] text-text-muted uppercase font-bold">Windup</span>
                                                        <div className="flex items-center gap-1.5 text-accent-secondary font-mono font-bold">
                                                            <Activity className="w-3 h-3" />
                                                            {weaponData.WindupTime ? weaponData.WindupTime.toFixed(2) + 's' : 'N/A'}
                                                        </div>
                                                    </div>
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setBreakpointModal({ 
                                                                isOpen: true, 
                                                                weapon: { 
                                                                    Name: `${selectedSlot} ${item.ItemId?.Idx + 1}`,
                                                                    AttackDuration: item.EquipmentStats?.[0]?.Value ? 1.1 : 1.1, // Fallback, but we should try to find real duration
                                                                    WindupTime: weaponData.WindupTime 
                                                                } 
                                                            });
                                                        }}
                                                        className="mt-2 w-full flex items-center justify-center gap-2 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary py-2 rounded-lg text-[9px] font-bold uppercase transition-all ring-1 ring-accent-primary/30 col-span-2"
                                                    >
                                                        <Zap className="w-3 h-3" />
                                                        Show Breakpoints Table
                                                    </button>
                                                    {projectileData && (weaponData.AttackRange ?? 0) > 1 && (
                                                        <div className="bg-bg-input/50 p-2 rounded border border-border/30 flex flex-col col-span-2">
                                                            <span className="text-[10px] text-text-muted uppercase font-bold">Proj Speed</span>
                                                            <span className="font-mono font-bold text-text-primary">{projectileData.Speed || 'N/A'}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                        {/* Secondary Stats Placeholder */}
                                        {numSecondary > 0 && (
                                            <div className="mt-4 pt-4 border-t border-border/30">
                                                <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                                                    Secondary Stats ({numSecondary})
                                                </div>
                                                {Array.from({ length: numSecondary }).map((_, idx) => (
                                                    <div key={idx} className="flex justify-between items-center py-1 text-sm text-text-muted/70">
                                                        <span>Random Stat {idx + 1}</span>
                                                        <span>???</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {stats.length === 0 && numSecondary === 0 && (
                                            <div className="text-center text-xs text-text-muted italic py-8">
                                                No stats available
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        );
                    }) : (
                        <div className="col-span-full text-center py-12 bg-bg-secondary/30 rounded-2xl border border-dashed border-border">
                            <div className="text-4xl mb-4 grayscale opacity-50">🛡️</div>
                            <div className="text-text-muted font-medium">No items found for this Age/Slot.</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
