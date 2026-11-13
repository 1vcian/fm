import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { AGE_TIERS, RARITY_TIERS, ageColor, hexRgb, rarityColor } from "../utils/gameTiers";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** "r, g, b" of a rarity (any case) or an age, from the build's GameTiers.json. */
function rarityRgb(rarity: string): string {
    const hex = rarityColor(rarity) ?? RARITY_TIERS[0]?.color;
    return hex ? hexRgb(hex).join(', ') : '255, 255, 255';
}
function ageRgb(ageIndex: number): string {
    const hex = ageColor(ageIndex) ?? AGE_TIERS[0]?.color;
    return hex ? hexRgb(hex).join(', ') : '255, 255, 255';
}

/**
 * Returns inline style object for rarity-colored gradient background
 */
export function getRarityBgStyle(rarity: string): React.CSSProperties {
    const color = rarityRgb(rarity);
    return {
        background: `linear-gradient(135deg, rgba(${color}, 0.5) 0%, rgba(${color}, 0.2) 100%)`,
    };
}

/**
 * Returns inline style object for rarity-colored border
 */
export function getRarityBorderStyle(rarity: string): React.CSSProperties {
    return {
        borderColor: `rgb(${rarityRgb(rarity)})`,
    };
}

/**
 * Returns inline style object for age-colored gradient background
 */
export function getAgeBgStyle(ageIndex: number): React.CSSProperties {
    const color = ageRgb(ageIndex);
    return {
        background: `linear-gradient(135deg, rgba(${color}, 0.5) 0%, rgba(${color}, 0.2) 100%)`,
    };
}

/**
 * Returns inline style object for age-colored border
 */
export function getAgeBorderStyle(ageIndex: number): React.CSSProperties {
    return {
        borderColor: `rgb(${ageRgb(ageIndex)})`,
    };
}

/**
 * Returns inline style object for an age's icon: AgeVisualConfig.Icon, a rect of its texture
 * (AgeIcons.png), from GameTiers.json. The game's own order, so no index juggling here.
 */
export function getAgeIconStyle(ageIndex: number, size: number = 32, version?: string): React.CSSProperties {
    const icon = AGE_TIERS[ageIndex]?.icon ?? AGE_TIERS[0]?.icon;
    const versionPath = version ? `${version}/` : '';
    const base: React.CSSProperties = {
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
    };
    if (!icon) return base;
    const sx = size / icon.w;
    const sy = size / icon.h;
    return {
        ...base,
        backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}${icon.tex}.png)`,
        backgroundPosition: `-${icon.x * sx}px -${icon.y * sy}px`,
        backgroundSize: `${icon.texW * sx}px ${icon.texH * sy}px`,
    };
}

/**
 * InventoryTextures.png mapping (4x4 sprite sheet, 128x128 per icon)
 */
export const INVENTORY_ICON_INDICES: Record<string, number> = {
    'Helmet': 0,
    'Armour': 1,
    'Body': 1, // Alias
    'Gloves': 2,
    'Necklace': 3,
    'Ring': 4,
    'Weapon': 5,
    'Shoes': 6,
    'Shoe': 6, // Alias
    'Belt': 7,
    'Mount': 8,
};

/**
 * Returns inline style object for Inventory Icons (InventoryTextures.png sprite sheet)
 */
export function getInventoryIconStyle(slotKey: string, size: number = 32, version?: string): React.CSSProperties | null {
    const iconIndex = INVENTORY_ICON_INDICES[slotKey];
    if (iconIndex === undefined) return null;

    const col = iconIndex % 4;
    const row = Math.floor(iconIndex / 4);
    const spriteSize = 128;
    const sheetWidth = 512;
    const sheetHeight = 512;
    const scale = size / spriteSize;

    const versionPath = version ? `${version}/` : '';
    return {
        backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${versionPath}InventoryTextures.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetWidth * scale}px ${sheetHeight * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
    };
}
