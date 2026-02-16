import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { cn } from '../lib/utils';
import { Shield, Sword, Heart, Zap } from 'lucide-react';

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

// 4x4 Grid -> 16 slots.
// 4x4 Grid -> 16 slots.
const SPRITE_COLS = 4;
const SPRITE_ROWS = 4;

const SET_ICONS: Record<string, string> = {
    'SantaSet': 'SteppingStoneCharIcon0.png',
    'SnowmanSet': 'SteppingStoneCharIcon1.png',
    'SkiSet': 'SteppingStoneCharIcon2.png'
};

export default function Skins() {
    const { data: skinsData, loading: loadingSkins } = useGameData<Record<string, SkinEntry>>('SkinsLibrary.json');
    const { data: setsData, loading: loadingSets } = useGameData<Record<string, SetEntry>>('SetsLibrary.json');

    const loading = loadingSkins || loadingSets;

    // Helper for visual order (same as before)
    const getVisualOrder = (idx: number) => {
        if (idx === 0) return 0;
        if (idx === 2) return 1;
        if (idx === 1) return 2;
        return 10 + idx;
    };

    // Helper to get sprite background position
    const getSpriteStyle = (skin: SkinEntry, allSkins: SkinEntry[]) => {
        // We need to sort ALL skins globally to determine the sprite index, 
        // regardless of how we display them in groups.
        // The sprite sheet layout is fixed.

        // Sort all skins to match sprite layout
        const sortedGlobal = [...allSkins].sort((a, b) => {
            const orderA = getVisualOrder(a.SkinId.Idx);
            const orderB = getVisualOrder(b.SkinId.Idx);
            if (orderA !== orderB) return orderA - orderB;

            const isHelmetA = a.SkinId.Type === 'Helmet';
            const isHelmetB = b.SkinId.Type === 'Helmet';
            if (isHelmetA && !isHelmetB) return -1;
            if (!isHelmetA && isHelmetB) return 1;
            return 0;
        });

        const index = sortedGlobal.findIndex(s => s.SkinId.Type === skin.SkinId.Type && s.SkinId.Idx === skin.SkinId.Idx);
        if (index === -1) return {};

        const col = index % SPRITE_COLS;
        const row = Math.floor(index / SPRITE_COLS);
        const bgX = (col * 100) / (SPRITE_COLS - 1);
        const bgY = (row * 100) / (SPRITE_ROWS - 1);

        return {
            backgroundImage: 'url(./Texture2D/SkinsUiIcons.png)',
            backgroundSize: '400% 400%',
            backgroundPosition: `${Number.isNaN(bgX) ? 0 : bgX}% ${Number.isNaN(bgY) ? 0 : bgY}%`,
            imageRendering: 'pixelated' as const
        };
    };

    const allSkinsList = useMemo(() => skinsData ? Object.values(skinsData) : [], [skinsData]);

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
                    const setIcon = SET_ICONS[setId];

                    return (
                        <div key={setId} className="bg-bg-secondary/20 border border-border rounded-xl overflow-hidden">
                            {/* Set Header */}
                            <div className="p-4 bg-bg-secondary/50 border-b border-border flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                                <div className="flex items-center gap-4">
                                    {setIcon && (
                                        <div className="w-16 h-16 rounded-lg border-2 border-border shadow-md overflow-hidden bg-bg-secondary shrink-0 relative">
                                            <div className="absolute inset-0 bg-accent-primary/10"></div>
                                            <img
                                                src={`./Texture2D/${setIcon}`}
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
                                        bgStyle={getSpriteStyle(skin, allSkinsList)}
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
                                bgStyle={getSpriteStyle(skin, allSkinsList)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function SkinCard({ skin, bgStyle }: { skin: SkinEntry, bgStyle: React.CSSProperties }) {
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
                    {/* Max Stats Badge */}
                    <span className="text-[10px] text-text-muted uppercase border border-border px-1.5 rounded">
                        Max Stats: {skin.MaxStatCount}
                    </span>
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
