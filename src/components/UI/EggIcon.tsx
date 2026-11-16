import { cn } from '../../lib/utils';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { useGameDataContext } from '../../context/GameDataContext';
import { RARITY_TIERS, rarityIndexOf } from '../../utils/gameTiers';
import { forAscension } from '../../utils/unitIcons';

// Per-rarity egg icon: PetCollectionVisualConfig.EggRarityIcons[rarity][ascension], a sprite of
// the Eggs / MegaEggs / UltraEggs / ApexEggs sheet, from GameTiers.json. Shared by the Egg
// calculator, the Pets page and the resource/clan panels so every egg icon matches the game art.
// A rarity may have a sprite only at some ascension slots (null elsewhere): the nearest slot that
// has one is used, the same pick as the game's AscensionExtensions.ForAscension.
export function EggIcon({ rarity, size = 48, className, ascensionLevel = 0 }: {
    rarity: string; size?: number; className?: string; ascensionLevel?: number;
}) {
    const { selectedVersion } = useGameDataContext();
    const icons = RARITY_TIERS[rarityIndexOf(rarity)]?.eggIcons ?? [];
    const icon = forAscension(icons, ascensionLevel);
    const textureVersion = resolveTextureVersion(selectedVersion);
    const sx = icon ? size / icon.w : 1;
    const sy = icon ? size / icon.h : 1;

    return (
        <div
            className={cn('inline-block shrink-0', className)}
            style={{
                width: size,
                height: size,
                ...(icon ? {
                    backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${textureVersion ? `${textureVersion}/` : ''}${icon.tex}.png)`,
                    backgroundPosition: `-${icon.x * sx}px -${icon.y * sy}px`,
                    backgroundSize: `${icon.texW * sx}px ${icon.texH * sy}px`,
                    backgroundRepeat: 'no-repeat',
                } : {}),
                imageRendering: 'pixelated',
            }}
            title={rarity}
        />
    );
}
