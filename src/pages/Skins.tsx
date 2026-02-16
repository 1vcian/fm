import { useMemo } from 'react';
import { useGameData } from '../hooks/useGameData';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';

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
    SetId: string;
    MaxStatCount: number;
}

// 4x4 Grid -> 16 slots.
// Rows 1-2 are used = 8 icons.
// Assuming sequential mapping based on the list order.
const SPRITE_COLS = 4;
const SPRITE_ROWS = 4;

export default function Skins() {
    const { data: skinsData, loading } = useGameData<Record<string, SkinEntry>>('SkinsLibrary.json');

    const skins = useMemo(() => {
        if (!skinsData) return [];
        // Parse the weird keys like "{'Type': 'Helmet', 'Idx': 0}" to get structured data if needed,
        // but the value already contains SkinId.
        // We just need to sort them to ensure consistent mapping to the sprite.
        // Let's sort by Type then Idx, or just trusting the order? 
        // Better to sort by Idx/Type to match logical groupings.
        // However, the sprite sheet order determines the mapping.
        // Based on common sprite generation, it's usually sequential.

        // Let's try to parse the key order or just use the values.
        // The values have Type/Idx.
        // Let's sort by SetId (if valid) then Type/Idx? 
        // Actually, looking at the JSON:
        // Helmet 0, Armour 0 (Santa)
        // Helmet 1, Armour 1 (Ski)
        // ...
        // It looks like pairs.

        return Object.values(skinsData).sort((a, b) => {
            // Helper to get visual order for IDs based on user feedback (Sprite layout)
            // Sprite appears to be: Santa(0) -> Snowman(2) -> Ski(1) -> Others
            const getVisualOrder = (idx: number) => {
                if (idx === 0) return 0;
                if (idx === 2) return 1;
                if (idx === 1) return 2;
                return 10 + idx; // Others come after
            };

            const orderA = getVisualOrder(a.SkinId.Idx);
            const orderB = getVisualOrder(b.SkinId.Idx);

            if (orderA !== orderB) return orderA - orderB;

            // Helper for Type order: Helmet before Armour (to match sprite Helmet -> Armour)
            // Helmet starts with 'H', Armour with 'A'. 
            // We want Helmet first.
            const isHelmetA = a.SkinId.Type === 'Helmet';
            const isHelmetB = b.SkinId.Type === 'Helmet';

            if (isHelmetA && !isHelmetB) return -1;
            if (!isHelmetA && isHelmetB) return 1;

            return 0;
        });
    }, [skinsData]);

    if (loading) {
        return <div className="p-8 text-center text-text-muted">Loading Skins...</div>;
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                    Skins Wiki
                </h1>
                <p className="text-text-secondary">
                    Discover all available character skins and their potential stats.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {skins.map((skin, index) => {
                    // Calculate sprite position
                    const col = index % SPRITE_COLS;
                    const row = Math.floor(index / SPRITE_COLS);
                    const bgX = (col * 100) / (SPRITE_COLS - 1); // Percentage for CSS
                    const bgY = (row * 100) / (SPRITE_ROWS - 1);

                    return (
                        <Card key={`${skin.SkinId.Type}-${skin.SkinId.Idx}`} className="flex flex-col gap-4 overflow-hidden group">
                            <div className="flex items-center gap-4">
                                {/* Icon Container with Sprite */}
                                <div
                                    className="w-16 h-16 rounded-lg border-2 border-border shadow-inner shrink-0 bg-bg-secondary"
                                    style={{
                                        backgroundImage: 'url(./Texture2D/SkinsUiIcons.png)',
                                        backgroundSize: '400% 400%', // 4 columns = 400%
                                        backgroundPosition: `${bgX}% ${bgY}%`,
                                        imageRendering: 'pixelated'
                                    }}
                                />
                                <div className="flex flex-col">
                                    <span className="font-bold text-lg group-hover:text-accent-primary transition-colors">
                                        {skin.SkinId.Type}
                                    </span>
                                    <span className="text-xs text-text-muted bg-bg-input px-2 py-0.5 rounded-full w-fit">
                                        ID: {skin.SkinId.Idx}
                                    </span>
                                    {skin.SetId && (
                                        <span className="text-xs text-accent-tertiary mt-1">
                                            {skin.SetId}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2 bg-bg-secondary/30 p-3 rounded-md">
                                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                                    Possible Stats (Max {skin.MaxStatCount})
                                </div>
                                {skin.PossibleStats.map((stat, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-1.5 text-text-secondary">
                                            <GameIcon name="swords" className="w-3 h-3 text-accent-primary" />
                                            <span>
                                                {stat.StatNode.UniqueStat.StatType}
                                                <span className="opacity-50 ml-1 text-xs">
                                                    ({stat.StatNode.UniqueStat.StatNature})
                                                </span>
                                            </span>
                                        </div>
                                        <span className="text-green-400 font-mono text-xs">
                                            {(stat.MinValue * 100).toFixed(0)}% - {(stat.MaxValue * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
