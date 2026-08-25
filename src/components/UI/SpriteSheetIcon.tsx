import React from 'react';
import { cn } from '../../lib/utils';

export interface SpriteSheetConfig {
    texture: string;
    texture_size: { width: number; height: number };
    sprite_size: { width: number; height: number };
    grid: { columns: number; rows: number };
}

interface SpriteSheetIconProps {
    textureSrc: string;
    spriteWidth: number;
    spriteHeight: number;
    sheetWidth: number;
    sheetHeight: number;
    iconIndex: number;
    className?: string; // For overriding width/height of the container
    /**
     * Nearest-neighbour is right for a sprite drawn at (or above) its native cell size, and wrong
     * for one drawn below it: every atlas cell in this game is 256px, so a 40px icon throws away
     * 39 of every 40 source pixels and keeps the aliasing. Opt into a smooth downscale wherever the
     * drawn size is under the native cell.
     */
    smooth?: boolean;
}

export const SpriteSheetIcon: React.FC<SpriteSheetIconProps> = ({
    textureSrc,
    spriteWidth,
    spriteHeight,
    sheetWidth,
    sheetHeight,
    iconIndex,
    className,
    smooth = false
}) => {
    // Calculate row and column from index
    const columns = Math.floor(sheetWidth / spriteWidth);
    const col = iconIndex % columns;
    const row = Math.floor(iconIndex / columns);

    // Calculate background size
    // The background-size must be the size of the ENTIRE sheet relative to the displayed element??
    // No, standard CSS sprites:
    // width/height of container = desired display size
    // background-image = url
    // background-position = -x px -y px
    // background-size = sheetWidth px sheetHeight px
    // But we want to SCALE the icon.

    // To scale a sprite:
    // We render a generic container (e.g. div)
    // We set its aspect ratio to match the sprite.
    // background-size: (sheetWidth / spriteWidth) * 100% (of the container)
    // No, that's not quite right if we want to change the storage size vs display size.

    // Let's assume we want to fill the container `className`.
    // We can use a trick:
    // background-size: (sheetWidth / spriteWidth) * 100%   Auto ? 
    // If the container is 50px wide, and the sprite is 1/4th of the sheet width.
    // The sheet needs to be 4 * 50px = 200px wide.
    // So background-size = (sheetWidth / spriteWidth) * 100%

    const scaleX = sheetWidth / spriteWidth;
    const scaleY = sheetHeight / spriteHeight;

    const bgSizeX = `${scaleX * 100}%`;
    const bgSizeY = `${scaleY * 100}%`;

    // Position percentage:
    // 0% yields 0 (left edge)
    // 100% yields (sheetWidth - containerWidth) = right edge
    // We want to align the top-left of the sprite cell to the top-left of the container.
    // So using pixels is safer if we know the scale, or percentages if we are careful.

    // Let's stick to percentage based position for responsiveness?
    // Position x% = (x / (sheetWidth - spriteWidth)) * 100%
    // Only works if sheetWidth > spriteWidth.

    let bgPosX = '0%';
    let bgPosY = '0%';

    if (columns > 1) {
        bgPosX = `${(col / (columns - 1)) * 100}%`;
    }

    // For rows...
    const rows = Math.floor(sheetHeight / spriteHeight);
    if (rows > 1) {
        bgPosY = `${(row / (rows - 1)) * 100}%`;
    }

    return (
        <div
            className={cn("inline-block bg-no-repeat overflow-hidden shrink-0", className)}
            style={{
                backgroundImage: `url(${textureSrc})`,
                backgroundPosition: `${bgPosX} ${bgPosY}`,
                backgroundSize: `${bgSizeX} ${bgSizeY}`,
                aspectRatio: `${spriteWidth} / ${spriteHeight}`,
                imageRendering: smooth ? 'auto' : 'pixelated'
            }}
            role="img"
            aria-label={`Icon ${iconIndex}`}
        />
    );
};
