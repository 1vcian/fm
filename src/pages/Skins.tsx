import { useMemo, useState } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { Shield, Sword, Heart, Zap } from 'lucide-react';
import { getSkinSpriteStyle } from '../utils/skinSprites';
import { BreakpointWikiModal } from '../components/Wiki/BreakpointWikiModal';
import { useGameDataContext } from '../context/GameDataContext';

interface SkinStat {
    StatNode: {
        UniqueStat: {
            StatType: string;
            StatNature: string;
        };
    };
    MinValue: number;
    MaxValue: number;
}

interface SkinEntry {
    SkinId: {
        Type: string;
        Idx: number;
    };
    PossibleStats: SkinStat[];
    BaseSetId?: string;
    MaxStatCount: number;
}

interface SetBonus {
    RequiredPieces: number;
    BonusStats: {
        Stats: Array<{
            StatNode: {
                UniqueStat: {
                    StatType: string;
                    StatNature: string;
                };
            };
            Value: number;
        }>;
    };
}

interface SetEntry {
    Id: string;
    BonusTiers: SetBonus[];
}

export default function Skins() {
    const { selectedVersion } = useGameDataContext();
    const { data: skinsData, loading: loadingSkins } = useGameData<Record<string, SkinEntry>>('SkinsLibrary.json');
    const { data: setsData, loading: loadingSets } = useGameData<Record<string, SetEntry>>('SetsLibrary.json');
    const { data: spriteMapping, loading: loadingMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: upgradeData } = useGameData<Record<string, any>>('SkinUpgradeLibrary.json');

    const loading = loadingSkins || loadingSets || loadingMapping;

    const groupedSkins = useMemo(() => {
        if (!skinsData) return { sets: [], misc: [] };

        const sets: Record<string, SkinEntry[]> = {};
        const misc: SkinEntry[] = [];

        Object.values(skinsData).forEach(skin => {
            if (skin.BaseSetId && setsData && setsData[skin.BaseSetId]) {
                if (!sets[skin.BaseSetId]) sets[skin.BaseSetId] = [];
                sets[skin.BaseSetId].push(skin);
            } else {
                misc.push(skin);
            }
        });

        // Sort skins within sets
        Object.keys(sets).forEach(setId => {
            sets[setId].sort((a, b) => {
                // Sort by Type (Helmet first)
                if (a.SkinId.Type === 'Helmet' && b.SkinId.Type !== 'Helmet') return -1;
                if (a.SkinId.Type !== 'Helmet' && b.SkinId.Type === 'Helmet') return 1;
                return 0;
            });
        });

        return { sets, misc };
    }, [skinsData, setsData]);

    const [breakpointModal, setBreakpointModal] = useState<{ isOpen: boolean; weapon?: any }>({ isOpen: false });

    const weaponTimingLookup = useMemo(() => {
        if (!weaponLibrary) return {} as Record<number, { melee?: { windup: number, duration: number }, ranged?: { windup: number, duration: number } }>;

        const lookup: Record<number, { melee?: { windup: number, duration: number }, ranged?: { windup: number, duration: number } }> = {};

        Object.entries(weaponLibrary).forEach(([_, data]: [string, any]) => {
            const idx = data.ItemId?.Idx;
            const age = data.ItemId?.Age;
            
            if (data.ItemId?.Type === 'Weapon' && idx !== undefined) {
                if (!lookup[idx]) lookup[idx] = {};
                
                if (age === -1000) {
                    lookup[idx].melee = { 
                        windup: data.WindupTime ?? 0.5, 
                        duration: data.AttackDuration || 1.1 
                    };
                } else if (age === -1001) {
                    lookup[idx].ranged = { 
                        windup: data.WindupTime ?? 0.5, 
                        duration: data.AttackDuration || 1.1 
                    };
                }
            }
        });

        return lookup;
    }, [weaponLibrary]);

    if (loading) {
        return <div className="p-8 text-center text-text-muted">Loading Skins & Sets</div>;
    }

    if (!skinsData || Object.keys(skinsData).length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center space-y-4 animate-fade-in">
                <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center">
                    <GameIcon name="swords" className="w-8 h-8 text-text-muted opacity-50" />
                </div>
                <h2 className="text-xl font-bold text-text-primary">Skins Not Available</h2>
                <p className="text-text-secondary max-w-md">
                    Skins data is not available in this version.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <BreakpointWikiModal
                isOpen={breakpointModal.isOpen}
                onClose={() => setBreakpointModal({ isOpen: false })}
                weaponName={breakpointModal.weapon?.Name || 'Skin'}
                weaponAttackDuration={breakpointModal.weapon?.AttackDuration || 1.1}
                weaponWindupTime={breakpointModal.weapon?.WindupTime || 0.4}
            />
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                    Skins & Sets
                </h1>
                <p className="text-text-secondary">
                    Collect skins to complete Sets and unlock powerful bonuses.
                </p>
            </div>

            {/* Skin Upgrade Stats Display */}
            {upgradeData && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {Object.entries(upgradeData).map(([type, data]: [string, any]) => (
                        <Card key={type} className="bg-bg-secondary/40 border-border/50 p-4 space-y-4">
                            <div className="flex items-center gap-3 border-b border-border/30 pb-3">
                                <div className="p-2 bg-accent-primary/10 rounded-lg">
                                    {type === 'Weapon' ? <Sword className="w-5 h-5 text-accent-primary" /> :
                                        type === 'Helmet' ? <Shield className="w-5 h-5 text-accent-primary" /> :
                                            <Shield className="w-5 h-5 text-accent-primary opacity-70" />}
                                </div>
                                <h3 className="text-lg font-bold text-text-primary uppercase tracking-wider">{type} Upgrades</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-text-muted">Stat Increase / Level</span>
                                    <span className="text-green-400 font-mono font-bold">
                                        +{(data.GoodSkinStatIncreasePerLevel * 100).toFixed(1)}%
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-tighter block mb-1">XP Required per Level</span>
                                    <div className="grid grid-cols-2 gap-2">
                                        {data.GoodSkinsLevelExperience.map((exp: number, i: number) => (
                                            <div key={i} className="bg-bg-input/50 rounded p-2 border border-border/20 flex justify-between items-center">
                                                <span className="text-[10px] text-text-muted font-bold">Lv.{i + 1} → {i + 2}</span>
                                                <span className="text-xs font-mono font-bold text-accent-secondary">{exp}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Sets Display */}
            <div className="space-y-6">
                {Object.entries(groupedSkins.sets).map(([setId, skins]) => {
                    const setInfo = setsData?.[setId];
                    if (!setInfo) return null;
                    const setKeys = setsData ? Object.keys(setsData) : [];
                    const setIdx = setKeys.indexOf(setId);
                    const setIcon = spriteMapping?.skinSets?.[setId] || (setIdx >= 0 ? `SteppingStoneCharIcon${setIdx}.png` : undefined);

                    return (
                        <div key={setId} className="bg-bg-secondary/20 border border-border rounded-xl overflow-hidden">
                            {/* Set Header */}
                            <div className="p-4 bg-bg-secondary/50 border-b border-border flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                                <div className="flex items-center gap-4">
                                    {setIcon && (
                                        <div className="w-16 h-16 rounded-lg border-2 border-border shadow-md overflow-hidden bg-bg-secondary shrink-0 relative">
                                            <div className="absolute inset-0 bg-accent-primary/10"></div>
                                            <img
                                                src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${setIcon}`}
                                                alt={setId}
                                                className="w-full h-full object-contain pixelated relative z-10"
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <h2 className="text-2xl font-bold text-accent-primary flex items-center gap-2">
                                            {!setIcon && <Shield className="w-6 h-6" />}
                                            {setId}
                                        </h2>
                                        <p className="text-xs text-text-muted mt-1">
                                            Collect {setInfo.BonusTiers[0]?.RequiredPieces || 2} pieces to activate bonuses.
                                        </p>
                                    </div>
                                </div>

                                {/* Set Bonuses */}
                                <div className="flex flex-col gap-2 bg-bg-input/50 p-3 rounded-lg border border-border/30 min-w-[200px]">
                                    <span className="text-xs font-bold text-text-muted uppercase mb-1 flex items-center gap-1">
                                        <Zap className="w-3 h-3 text-yellow-400" /> Set Bonuses
                                    </span>
                                    {setInfo.BonusTiers.map((tier, i) => (
                                        <div key={i} className="space-y-1">
                                            {tier.BonusStats.Stats.map((stat, j) => (
                                                <div key={j} className="flex justify-between items-center text-sm gap-4">
                                                    <span className="text-text-secondary">{stat.StatNode.UniqueStat.StatType}</span>
                                                    <span className="font-mono text-green-400 font-bold">
                                                        +{(stat.Value * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Skins Grid for this Set */}
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {skins.map((skin) => (
                                    <SkinCard
                                        key={`${skin.SkinId.Type}-${skin.SkinId.Idx}`}
                                        skin={skin}
                                        bgStyle={getSkinSpriteStyle(skin, spriteMapping?.skins?.mapping, selectedVersion)}
                                        timing={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx] : undefined}
                                        onShowBreakpoints={(w, d) => setBreakpointModal({
                                            isOpen: true,
                                            weapon: { Name: `${skin.BaseSetId || 'Misc'} ${skin.SkinId.Type}`, AttackDuration: d, WindupTime: w }
                                        })}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Misc Skins */}
            {groupedSkins.misc.length > 0 && (
                <div className="space-y-4 pt-8 border-t border-border">
                    <h2 className="text-xl font-bold text-text-muted flex items-center gap-2">
                        <GameIcon name="star" className="w-5 h-5" />
                        Other Skins
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {groupedSkins.misc.map((skin) => (
                            <SkinCard
                                key={`${skin.SkinId.Type}-${skin.SkinId.Idx}`}
                                skin={skin}
                                bgStyle={getSkinSpriteStyle(skin, spriteMapping?.skins?.mapping, selectedVersion)}
                                timing={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx] : undefined}
                                onShowBreakpoints={(w, d) => setBreakpointModal({
                                    isOpen: true,
                                    weapon: { Name: `${skin.BaseSetId || 'Misc'} ${skin.SkinId.Type}`, AttackDuration: d, WindupTime: w }
                                })}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function SkinCard({ skin, bgStyle, timing, onShowBreakpoints }: {
    skin: SkinEntry,
    bgStyle: React.CSSProperties,
    timing?: { melee?: { windup: number, duration: number }, ranged?: { windup: number, duration: number } },
    onShowBreakpoints?: (windup: number, duration: number) => void
}) {
    return (
        <Card className="flex flex-col gap-3 overflow-hidden group hover:border-accent-primary/50 transition-colors">
            <div className="flex items-center gap-4">
                <div
                    className="w-16 h-16 rounded-lg border-2 border-border shadow-inner shrink-0 bg-bg-secondary"
                    style={bgStyle}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-col">
                        <span className="font-bold text-lg group-hover:text-accent-primary transition-colors whitespace-nowrap overflow-hidden text-clip">
                            {skin.SkinId.Type}
                        </span>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] text-text-muted bg-bg-input px-1.5 py-0.5 rounded border border-border/30">
                                ID: {skin.SkinId.Idx}
                            </span>
                            <span className="text-[9px] text-text-muted uppercase border border-border/20 px-1 rounded">
                                Stats: {skin.MaxStatCount}
                            </span>
                        </div>

                        {timing && (
                            <div className="mt-1 space-y-1.5">
                                {timing.melee && (
                                    <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1 text-orange-400">
                                            <Sword className="w-2.5 h-2.5" />
                                            <span className="text-[9px] font-bold uppercase">Melee: {timing.melee.windup.toFixed(2)}s</span>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onShowBreakpoints?.(timing.melee!.windup, timing.melee!.duration);
                                            }}
                                            className="px-1.5 py-0.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-[8px] font-bold rounded border border-orange-500/30 transition-all"
                                        >
                                            Breakpoints
                                        </button>
                                    </div>
                                )}
                                {timing.ranged && (
                                    <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1 text-cyan-400">
                                            <Zap className="w-2.5 h-2.5" />
                                            <span className="text-[9px] font-bold uppercase">Ranged: {timing.ranged.windup.toFixed(2)}s</span>
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onShowBreakpoints?.(timing.ranged!.windup, timing.ranged!.duration);
                                            }}
                                            className="px-1.5 py-0.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-[8px] font-bold rounded border border-cyan-500/30 transition-all"
                                        >
                                            Breakpoints
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-2 bg-bg-secondary/30 p-2.5 rounded-md text-xs">
                {skin.PossibleStats.map((stat, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                            {stat.StatNode.UniqueStat.StatType === 'Damage' ? (
                                <Sword className="w-3 h-3 text-red-400" />
                            ) : stat.StatNode.UniqueStat.StatType === 'Health' ? (
                                <Heart className="w-3 h-3 text-green-400" />
                            ) : (
                                <GameIcon name="star" className="w-3 h-3 text-accent-primary" />
                            )}
                            <span>{stat.StatNode.UniqueStat.StatType}</span>
                        </div>
                        <span className="text-text-primary font-mono">
                            {(stat.MinValue * 100).toFixed(0)}% - {(stat.MaxValue * 100).toFixed(0)}%
                        </span>
                    </div>
                ))}
            </div>
        </Card>
    );
}
