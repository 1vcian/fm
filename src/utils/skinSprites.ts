/**
 * Utility for calculating skin sprite positions and sorting skins based on the grid layout.
 * 
 * --- HOW TO COMPLETE MANUAL SPRITE MAPPINGS FOR NEW RELEASES ---
 * For each new release of sets, the sprites in SkinsUiIcons.png are ordered as:
 * 1. Helmet and Body of the first new set, followed by Helmet and Body of the next new set
 *    (in sequential order by Set numerical ID).
 * 2. Standalone/single Helmets released in that group (some may come before the weapons
 *    and others after, following the asset sheet sequence).
 * 3. Weapons for the sets (in numerical set ID order, if present).
 * 
 * Example Layout (SkinsUiIcons.png):
 * Row 1: Santa(H,A), Snowman(H,A), Ski(H,A), Unnamed(H 100), Unnamed(H 101)
 * Row 2: Druid(H,A), Leprechaun(H,A), Flower(H,A), Unnamed(H 102), Unnamed(H 103)
 * Row 3: Druid(W), Leprechaun(W), Flower(W)
 */

export const SKIN_SPRITE_COLS = 8;
export const SKIN_SPRITE_ROWS = 8;

import { resolveTextureVersion } from './ascensionUtils';

interface SkinId {
    Type: string;
    Idx: number;
}

/**
 * Returns the sort value for a skin based on the 8x8 sprite sheet layout.
 * Optionally uses a dynamic mapping from ManualSpriteMapping.json
 */
export const getSkinSortValue = (skin: { SkinId: SkinId }, mapping?: Record<string, number>): number => {
    const { Type, Idx } = skin.SkinId;

    // Use dynamic mapping if available
    if (mapping) {
        const key = `${Type}_${Idx}`;
        if (mapping[key] !== undefined) {
            return mapping[key];
        }
    }

    // Fallback to legacy hardcoded logic
    // Row 3 logic: Weapons always come after Row 1/2 (starts at index 16)
    if (Type === 'Weapon') {
        switch (Idx) {
            case 5: return 16; // Druid Weapon
            case 3: return 17; // Leprechaun Weapon
            case 4: return 18; // Flower Weapon
            default: return 64 - Idx; // Fallback to end of sheet
        }
    }

    // Rows 1/2 logic: Pairs of (H,A) or single H
    // Indices 0-15
    let baseIndex = 0;
    switch (Idx) {
        case 0: baseIndex = 0; break;  // Santa (0, 1)
        case 2: baseIndex = 2; break;  // Snowman (2, 3)
        case 1: baseIndex = 4; break;  // Ski (4, 5)
        case 100: return 6;            // Unnamed 100 (Row 1, Col 6)
        case 101: return 7;            // Unnamed 101 (Row 1, Col 7)
        case 5: baseIndex = 8; break;  // Druid (8, 9)
        case 3: baseIndex = 10; break; // Leprechaun (10, 11)
        case 4: baseIndex = 12; break; // Flower (12, 13)
        case 102: return 14;           // Unnamed 102 (Row 2, Col 6)
        case 103: return 15;           // Unnamed 103 (Row 2, Col 7)
        default: baseIndex = 32 + (Idx % 16) * 2; // Adjusted to stay within reasonable range
    }

    const typeOffset = Type === 'Helmet' ? 0 : 1;
    return baseIndex + typeOffset;
};

/**
 * Calculates the sprite position in percentages for CSS background-position.
 */
export const getSkinSpritePosition = (
    skin: { SkinId: SkinId }, 
    mapping?: Record<string, number>,
    version?: string
): string | null => {
    const index = getSkinSortValue(skin, mapping);

    const col = index % SKIN_SPRITE_COLS;
    const row = Math.floor(index / SKIN_SPRITE_COLS);

    const isDoubleWidth = version && version >= '2026_07_03_12_39';
    const bgX = (col * 100) / (isDoubleWidth ? 15 : (SKIN_SPRITE_COLS - 1));
    const bgY = (row * 100) / (isDoubleWidth ? 15 : (SKIN_SPRITE_ROWS - 1));

    if (Number.isNaN(bgX) || Number.isNaN(bgY)) return "0% 0%";

    return `${bgX}% ${bgY}%`;
};

/**
 * Returns the CSS style object for a skin sprite.
 */
export const getSkinSpriteStyle = (
    skin: { SkinId: SkinId }, 
    mapping?: Record<string, number>,
    version?: string
): React.CSSProperties => {
    const position = getSkinSpritePosition(skin, mapping, version);
    // Grid width is a property of the atlas actually loaded, so both the URL and the
    // width check use the resolved texture folder (config-only versions ship no art).
    const texVersion = resolveTextureVersion(version) ?? version;
    const isDoubleWidth = texVersion && texVersion >= '2026_07_03_12_39';
    return {
        backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${texVersion || ''}/SkinsUiIcons.png)`,
        backgroundSize: isDoubleWidth ? '1600% 1600%' : '800% 800%',
        backgroundPosition: position || 'center',
        imageRendering: 'pixelated' as const
    };
};

