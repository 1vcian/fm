import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Rarity color RGB values (matching CSS variables in index.css)
const RARITY_COLORS: Record<string, string> = {
    common: '241, 241, 241',
    rare: '93, 216, 255',
    epic: '92, 254, 137',
    legendary: '253, 255, 93',
    ultimate: '255, 93, 93',
    mythic: '213, 93, 255',
};

/**
 * Returns inline style object for rarity-colored gradient background
 */
export function getRarityBgStyle(rarity: string): React.CSSProperties {
    const color = RARITY_COLORS[rarity.toLowerCase()] || RARITY_COLORS.common;
    return {
        background: `linear-gradient(135deg, rgba(${color}, 0.3) 0%, rgba(${color}, 0.1) 100%)`,
    };
}

/**
 * Returns inline style object for rarity-colored border
 */
export function getRarityBorderStyle(rarity: string): React.CSSProperties {
    const color = RARITY_COLORS[rarity.toLowerCase()] || RARITY_COLORS.common;
    return {
        borderColor: `rgb(${color})`,
    };
}

// Age color RGB values (matching CSS variables in index.css)
const AGE_COLORS: Record<string, string> = {
    primitive: '241, 241, 241',
    medieval: '93, 216, 255',
    earlymodern: '92, 254, 137',
    modern: '253, 255, 93',
    space: '255, 93, 93',
    interstellar: '213, 93, 255',
    multiverse: '117, 255, 238',
    quantum: '136, 109, 255',
    underworld: '167, 115, 115',
    divine: '255, 158, 13',
};

// Age name to index mapping
const AGE_NAMES = ['primitive', 'medieval', 'earlymodern', 'modern', 'space', 'interstellar', 'multiverse', 'quantum', 'underworld', 'divine'];

/**
 * Returns inline style object for age-colored gradient background
 */
export function getAgeBgStyle(ageIndex: number): React.CSSProperties {
    const ageName = AGE_NAMES[ageIndex] || 'primitive';
    const color = AGE_COLORS[ageName] || AGE_COLORS.primitive;
    return {
        background: `linear-gradient(135deg, rgba(${color}, 0.3) 0%, rgba(${color}, 0.1) 100%)`,
    };
}

/**
 * Returns inline style object for age-colored border
 */
export function getAgeBorderStyle(ageIndex: number): React.CSSProperties {
    const ageName = AGE_NAMES[ageIndex] || 'primitive';
    const color = AGE_COLORS[ageName] || AGE_COLORS.primitive;
    return {
        borderColor: `rgb(${color})`,
    };
}

/**
 * Returns inline style object for Age Icons (AgeIcons.png sprite sheet)
 * Uses 4x4 grid (512x512 total, 128x128 per icon)
 */
export function getAgeIconStyle(ageIndex: number, size: number = 32): React.CSSProperties {
    // Fix: Swap Multiverse (6) and Quantum (7) as they are inverted in the sprite sheet
    let spriteIndex = ageIndex;
    if (ageIndex === 6) spriteIndex = 7;
    else if (ageIndex === 7) spriteIndex = 6;

    const col = spriteIndex % 4;
    const row = Math.floor(spriteIndex / 4);
    const spriteSize = 128;
    const sheetWidth = 512;
    const sheetHeight = 512;
    const scale = size / spriteSize;

    return {
        backgroundImage: `url(./Texture2D/AgeIcons.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetWidth * scale}px ${sheetHeight * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
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
export function getInventoryIconStyle(slotKey: string, size: number = 32): React.CSSProperties | null {
    const iconIndex = INVENTORY_ICON_INDICES[slotKey];
    if (iconIndex === undefined) return null;

    const col = iconIndex % 4;
    const row = Math.floor(iconIndex / 4);
    const spriteSize = 128;
    const sheetWidth = 512;
    const sheetHeight = 512;
    const scale = size / spriteSize;

    return {
        backgroundImage: `url(./Texture2D/InventoryTextures.png)`,
        backgroundPosition: `-${col * spriteSize * scale}px -${row * spriteSize * scale}px`,
        backgroundSize: `${sheetWidth * scale}px ${sheetHeight * scale}px`,
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-block',
        verticalAlign: 'middle',
        imageRendering: 'pixelated'
    };
}
