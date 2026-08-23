import { cn } from '../../lib/utils';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { useGameDataContext } from '../../context/GameDataContext';

const RARITY_INDEX: Record<string, number> = {
    Common: 0, Rare: 1, Epic: 2, Legendary: 3, Ultimate: 4, Mythic: 5,
};

// Per-rarity egg icon. The `Eggs` texture is a 4x4 sprite grid; we crop the cell
// for the given rarity (Common..Mythic). Shared by the Egg calculator and the
// resource/clan panels so every egg icon matches the game art.
export function EggIcon({ rarity, size = 48, className, ascensionLevel = 0 }: {
    rarity: string; size?: number; className?: string; ascensionLevel?: number;
}) {
    const { selectedVersion } = useGameDataContext();
    const idx = RARITY_INDEX[rarity] ?? 0;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const xPos = (col / 3) * 100;
    const yPos = (row / 3) * 100;
    const texturePath = getAscensionTexturePath('Eggs', ascensionLevel, selectedVersion);

    return (
        <div
            className={cn('inline-block shrink-0', className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${texturePath})`,
                backgroundPosition: `${xPos}% ${yPos}%`,
                backgroundSize: '400% 400%', // 4x4 grid -> each cell is 1/4 of the sheet
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated',
            }}
            title={rarity}
        />
    );
}
