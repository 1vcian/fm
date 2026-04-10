import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { Shield, Sword, Heart, Zap } from 'lucide-react';
import { getSkinSpriteStyle } from '../utils/skinSprites';
import { BreakpointWikiModal } from '../components/Wiki/BreakpointWikiModal';
import { useState } from 'react';

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
    SetId?: string;
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
    const { data: skinsData, loading: loadingSkins } = useGameData<Record<string, SkinEntry>>('SkinsLibrary.json');
    const { data: setsData, loading: loadingSets } = useGameData<Record<string, SetEntry>>('SetsLibrary.json');
    const { data: spriteMapping, loading: loadingMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');

    const loading = loadingSkins || loadingSets || loadingMapping;

    const groupedSkins = useMemo(() => {
        if (!skinsData) return { sets: [], misc: [] };

        const sets: Record<string, SkinEntry[]> = {};
        const misc: SkinEntry[] = [];

        Object.values(skinsData).forEach(skin => {
            if (skin.SetId && setsData && setsData[skin.SetId]) {
                if (!sets[skin.SetId]) sets[skin.SetId] = [];
                sets[skin.SetId].push(skin);
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
        if (!weaponLibrary) return {} as Record<number, { windup: number, duration: number }>;
        
        // Internal tracking to store the age along with the windup/duration
        const tracking: Record<number, { age: number, windup: number, duration: number }> = {};
        
        Object.entries(weaponLibrary).forEach(([_, data]: [string, any]) => {
            const idx = data.ItemId?.Idx;
            const age = data.ItemId?.Age;
            if (data.ItemId?.Type === 'Weapon' && idx !== undefined && age !== undefined && data.WindupTime !== undefined) {
                // Prioritize higher ages (1000, 10000, etc.) as they contain skin-specific values
                if (tracking[idx] === undefined || age > tracking[idx].age) {
                    tracking[idx] = { age, windup: data.WindupTime, duration: data.AttackDuration || 1.1 };
                }
            }
        });

        const finalLookup: Record<number, { windup: number, duration: number }> = {};
        Object.entries(tracking).forEach(([idx, val]) => {
            finalLookup[Number(idx)] = { windup: val.windup, duration: val.duration };
        });
        return finalLookup;
    }, [weaponLibrary]);

    if (loading) {
        return <div className="p-8 text-center text-text-muted">Loading Skins & Sets...</div>;
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

            {/* Sets Display */}
            <div className="space-y-6">
                {Object.entries(groupedSkins.sets).map(([setId, skins]) => {
                    const setInfo = setsData?.[setId];
                    if (!setInfo) return null;
                    const setIcon = spriteMapping?.skinSets?.[setId];

                    return (
                        <div key={setId} className="bg-bg-secondary/20 border border-border rounded-xl overflow-hidden">
                            {/* Set Header */}
                            <div className="p-4 bg-bg-secondary/50 border-b border-border flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                                <div className="flex items-center gap-4">
                                    {setIcon && (
                                        <div className="w-16 h-16 rounded-lg border-2 border-border shadow-md overflow-hidden bg-bg-secondary shrink-0 relative">
                                            <div className="absolute inset-0 bg-accent-primary/10"></div>
                                                <img
                                                    src={`${import.meta.env.BASE_URL}Texture2D/${setIcon}`}
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
                                            bgStyle={getSkinSpriteStyle(skin, spriteMapping?.skins?.mapping)}
                                            windup={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx]?.windup : undefined}
                                            duration={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx]?.duration : undefined}
                                            onShowBreakpoints={(w, d) => setBreakpointModal({ 
                                                isOpen: true, 
                                                weapon: { Name: `${skin.SetId || 'Misc'} ${skin.SkinId.Type}`, AttackDuration: d, WindupTime: w } 
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
                                bgStyle={getSkinSpriteStyle(skin, spriteMapping?.skins?.mapping)}
                                windup={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx]?.windup : undefined}
                                duration={skin.SkinId.Type === 'Weapon' ? weaponTimingLookup[skin.SkinId.Idx]?.duration : undefined}
                                onShowBreakpoints={(w, d) => setBreakpointModal({ 
                                    isOpen: true, 
                                    weapon: { Name: `${skin.SetId || 'Misc'} ${skin.SkinId.Type}`, AttackDuration: d, WindupTime: w } 
                                })}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function SkinCard({ skin, bgStyle, windup, duration, onShowBreakpoints }: { 
    skin: SkinEntry, 
    bgStyle: React.CSSProperties, 
    windup?: number,
    duration?: number,
    onShowBreakpoints?: (windup: number, duration: number) => void
}) {
    return (
        <Card className="flex flex-col gap-3 overflow-hidden group hover:border-accent-primary/50 transition-colors">
            <div className="flex items-center gap-4">
                <div
                    className="w-16 h-16 rounded-lg border-2 border-border shadow-inner shrink-0 bg-bg-secondary"
                    style={bgStyle}
                />
                <div className="flex flex-col">
                    <span className="font-bold text-lg group-hover:text-accent-primary transition-colors">
                        {skin.SkinId.Type}
                    </span>
                    <span className="text-xs text-text-muted bg-bg-input px-2 py-0.5 rounded-full w-fit mb-1">
                        ID: {skin.SkinId.Idx}
                    </span>
                    <span className="text-[10px] text-text-muted uppercase border border-border px-1.5 rounded">
                        Max Stats: {skin.MaxStatCount}
                    </span>
                    {typeof windup === 'number' && (
                        <div className="mt-1 flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-accent-secondary">
                                <Zap className="w-3 h-3" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Windup: {windup.toFixed(2)}s</span>
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (windup !== undefined && duration !== undefined) {
                                        onShowBreakpoints?.(windup, duration);
                                    }
                                }}
                                className="mt-1 w-full flex items-center justify-center gap-1 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary py-1 rounded border border-accent-primary/30 text-[8px] font-bold uppercase transition-all"
                            >
                                <Zap className="w-2.5 h-2.5" />
                                Breakpoints
                            </button>
                        </div>
                    )}
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
