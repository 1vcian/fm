import React, { useMemo } from 'react';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { cn } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';

interface GameIconProps extends React.HTMLAttributes<HTMLElement> {
    name: string; // The icon name
    size?: number | string;
    alt?: string; // For accessibility
}

export function GameIcon({ name, size, className, alt, ...props }: GameIconProps) {
    const { data: iconsMap } = useGameData<any>('IconsMap.json');
    const { selectedVersion, versions, isLoadingVersions } = useGameDataContext();

    // Use current selected version or default to the latest available one
    const activeVersion = resolveTextureVersion(selectedVersion || versions[0]) ?? (selectedVersion || versions[0]);

    // Case insensitive lookup
    const spriteInfo = useMemo(() => {
        if (!iconsMap?.mapping) return null;
        return Object.values(iconsMap.mapping).find((v: any) => v.name.toLowerCase() === name.toLowerCase());
    }, [iconsMap, name]);

    const style = size ? {
        width: size,
        height: size,
    } : {};

    // If we don't have an active version yet, we shouldn't render to avoid broken requests
    if (!activeVersion) {
        return <div className={cn("inline-block shrink-0 bg-white/5 animate-pulse rounded", className)} style={style} />;
    }

    // Base path for Texture2D
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${activeVersion}/`;

    // If we found a sprite mapping, render a div with background image
    if (spriteInfo) {
        const info = spriteInfo as any;
        const texW = iconsMap.texture_size?.width || 2048;
        const texH = iconsMap.texture_size?.height || 2048;
        const rect = info.sprite_rect;

        const bgSizeX = (texW / rect.width) * 100;
        const bgSizeY = (texH / rect.height) * 100;

        const posX = rect.x === 0 ? 0 : rect.x / (texW - rect.width) * 100;
        const posY = rect.y === 0 ? 0 : rect.y / (texH - rect.height) * 100;

        const spriteStyle: React.CSSProperties = {
            ...style,
            backgroundImage: `url(${textureBase}${encodeURIComponent(iconsMap.texture || 'Icons.png')})`,
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
    const cleanName = name.toLowerCase();
    const encodedName = encodeURIComponent(name);
    
    if (cleanName === 'hammer') src = `${textureBase}Hammer.png`;
    else if (cleanName === 'gem') src = `${textureBase}GemIcon.png`;
    else if (cleanName === 'coin') src = `${import.meta.env.BASE_URL}icons/coin.png`;
    else if (name.includes('/') || name.includes('.')) src = name; // Direct path
    else src = `${textureBase}${encodedName}.png`; // Fallback

    return (
        <img
            src={src}
            alt={alt || name}
            style={style}
            className={cn("object-contain inline-block", className)}
            onError={(e) => {
                const img = e.target as HTMLImageElement;
                // If it fails, try without the version if we were using one
                if (activeVersion && img.src.includes(`/${activeVersion}/`)) {
                    img.src = `${import.meta.env.BASE_URL}Texture2D/${encodedName}.png`;
                } else {
                    img.style.display = 'none';
                }
            }}
            {...props as React.ImgHTMLAttributes<HTMLImageElement>}
        />
    );
}
