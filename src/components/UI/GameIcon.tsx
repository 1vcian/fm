import React, { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';

interface GameIconProps extends React.HTMLAttributes<HTMLElement> {
    name: string; // The icon name
    size?: number | string;
    alt?: string; // For accessibility
}

export function GameIcon({ name, size = 24, className, alt, ...props }: GameIconProps) {
    const { data: iconsMap } = useGameData<any>('IconsMap.json');

    // Case insensitive lookup
    const spriteInfo = useMemo(() => {
        if (!iconsMap?.mapping) return null;
        return Object.values(iconsMap.mapping).find((v: any) => v.name.toLowerCase() === name.toLowerCase());
    }, [iconsMap, name]);

    const style = {
        width: size,
        height: size,
    } as React.CSSProperties;

    // If we found a sprite mapping, render a div with background image
    if (spriteInfo) {
        const info = spriteInfo as any;
        const texW = iconsMap.texture_size?.width || 2048;
        const texH = iconsMap.texture_size?.height || 2048;
        const rect = info.sprite_rect;

        // Calculate percentages specifically for background-position
        // Formula: pos% = coordinate / (texture_dim - sprite_dim) * 100
        // This ensures the sprite works responsively with any container size
        const bgSizeX = (texW / rect.width) * 100;
        const bgSizeY = (texH / rect.height) * 100;

        const posX = rect.x === 0 ? 0 : rect.x / (texW - rect.width) * 100;
        const posY = rect.y === 0 ? 0 : rect.y / (texH - rect.height) * 100;

        const spriteStyle: React.CSSProperties = {
            ...style,
            backgroundImage: `url(/Texture2D/${iconsMap.texture || 'Icons.png'})`,
            backgroundPosition: `${posX}% ${posY}%`,
            backgroundSize: `${bgSizeX}% ${bgSizeY}%`,
            backgroundRepeat: 'no-repeat',
        };

        return (
            <div
                role="img"
                aria-label={alt || name}
                className={cn("inline-block shrink-0", className)}
                style={spriteStyle}
                {...props}
            />
        );
    }

    // Fallback logic for legacy/static icons
    let src = '';
    if (name === 'hammer') src = './Texture2D/Hammer.png';
    else if (name === 'gem') src = './Texture2D/GemIcon.png';
    else if (name === 'coin') src = './icons/coin.png';
    else if (name.includes('/') || name.includes('.')) src = name; // Direct path
    else src = `./Texture2D/${name}.png`; // Fallback

    return (
        <img
            src={src}
            alt={alt || name}
            style={style}
            className={cn("object-contain inline-block", className)}
            onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
            }}
            {...props as React.ImgHTMLAttributes<HTMLImageElement>}
        />
    );
}
