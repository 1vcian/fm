import type { ComponentType } from 'react';
import { GameIcon } from './GameIcon';
import { SpriteSheetIcon } from './SpriteSheetIcon';
import { useGameDataContext } from '../../context/GameDataContext';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { cn } from '../../lib/utils';

/**
 * A real game asset used as a UI icon, in place of a generic glyph:
 *   icon    an Icons.png sprite by its IconsMap.json name ("Battle", "Egg", "WarTicket"), or a
 *           standalone Texture2D PNG by file name ("ShopTabIcon"), both through GameIcon;
 *   sheet   a cell of one of the game's icon sheets, counted top-down, row by row.
 */
export type GameAsset =
    | { icon: string }
    | { sheet: keyof typeof SHEETS; index: number };

/** Sheet sizes (px): the whole texture and one cell. */
const SHEETS = {
    TechTreeIcons: { tex: 1024, cell: 128 },
    ClanTechTreeIcons: { tex: 1024, cell: 128 },
    Pets: { tex: 2048, cell: 256 },
    MountIcons: { tex: 1024, cell: 256 },
    SkillIcons: { tex: 2048, cell: 256 },
    ArenaRankIcons: { tex: 512, cell: 256 },
} as const;

export function GameAssetIcon({ asset, size = 18, className }: { asset: GameAsset; size?: number; className?: string }) {
    const { selectedVersion, versions } = useGameDataContext();
    if ('icon' in asset) return <GameIcon name={asset.icon} size={size} className={cn('shrink-0 object-contain', className)} />;
    const s = SHEETS[asset.sheet];
    const version = resolveTextureVersion(selectedVersion || versions[0]) ?? (selectedVersion || versions[0]);
    return (
        <span className={cn('inline-block shrink-0', className)} style={{ width: size, height: size }}>
            <SpriteSheetIcon
                textureSrc={`${import.meta.env.BASE_URL}Texture2D/${version}/${asset.sheet}.png`}
                spriteWidth={s.cell} spriteHeight={s.cell} sheetWidth={s.tex} sheetHeight={s.tex}
                iconIndex={asset.index} className="w-full h-full" smooth
            />
        </span>
    );
}

/** A component with lucide's props (size, className) that draws a game asset: drop-in for icon slots. */
export function gameIcon(asset: GameAsset): ComponentType<{ size?: number; className?: string }> {
    const C = ({ size, className }: { size?: number; className?: string }) => <GameAssetIcon asset={asset} size={size} className={className} />;
    C.displayName = 'icon' in asset ? `GameIcon(${asset.icon})` : `GameIcon(${asset.sheet}#${asset.index})`;
    return C;
}
