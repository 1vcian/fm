/**
 * Utility for calculating skin sprite positions and sorting skins based on the 8x8 grid layout.
 * Grid Layout (SkinsUiIcons.png):
 * Row 1: Santa(H,A), Snowman(H,A), Ski(H,A), Unnamed(H 100), Unnamed(H 101)
 * Row 2: Druid(H,A), Leprechaun(H,A), Flower(H,A), Unnamed(H 102), Unnamed(H 103)
 * Row 3: Druid(W), Leprechaun(W), Flower(W)
 */

export const SKIN_SPRITE_COLS = 8;
export const SKIN_SPRITE_ROWS = 8;

interface SkinId {
    Type: string;
    Idx: number;
}

/**
 * Maps a skin to a set-based visual group to ensure consistent ordering.
 */
export const getSkinGroupOrder = (idx: number): number => {
    switch (idx) {
        case 0: return 0;   // Santa
        case 2: return 1;   // Snowman
        case 1: return 2;   // Ski
        case 100:
        case 101: return 3; // Unnamed Row 1
        case 5: return 4;   // Druid
        case 3: return 5;   // Leprechaun
        case 4: return 6;   // Flower
        case 102:
        case 103: return 7; // Unnamed Row 2
        default: return 100 + idx;
    }
};

/**
 * Returns the sort value for a skin based on the 8x8 sprite sheet layout.
 */
export const getSkinSortValue = (skin: { SkinId: SkinId }): number => {
    const { Type, Idx } = skin.SkinId;
    const group = getSkinGroupOrder(Idx);

    // Type priority: Helmet(0) -> Armour(1) -> Weapon(2)
    const typePriority = Type === 'Helmet' ? 0 : (Type === 'Armour' ? 1 : 2);

    // Row 3 logic: Weapons always come after Row 1/2
    if (typePriority === 2) {
        // Weapons start at index 16 (start of Row 3)
        // Group 4 (Druid) weapon -> 16
        // Group 5 (Leprechaun) weapon -> 17
        // Group 6 (Flower) weapon -> 18
        return 16 + (group - 4);
    }

    // Row 1/2 logic: Pairs of (H,A) or single H
    // Indices 0-15
    // group 0 (Santa): 0,1
    // group 1 (Snowman): 2,3
    // group 2 (Ski): 4,5
    // group 3 (Unnamed): 6,7
    // group 4 (Druid): 8,9
    // group 5 (Leprechaun): 10,11
    // group 6 (Flower): 12,13
    // group 7 (Unnamed): 14,15

    return group * 2 + typePriority;
};

/**
 * Calculates the sprite position in percentages for CSS background-position.
 */
export const getSkinSpritePosition = (skin: { SkinId: SkinId }): string | null => {
    const index = getSkinSortValue(skin);

    const col = index % SKIN_SPRITE_COLS;
    const row = Math.floor(index / SKIN_SPRITE_COLS);

    const bgX = (col * 100) / (SKIN_SPRITE_COLS - 1);
    const bgY = (row * 100) / (SKIN_SPRITE_ROWS - 1);

    if (Number.isNaN(bgX) || Number.isNaN(bgY)) return "0% 0%";

    return `${bgX}% ${bgY}%`;
};

/**
 * Returns the CSS style object for a skin sprite.
 */
export const getSkinSpriteStyle = (skin: { SkinId: SkinId }): React.CSSProperties => {
    const position = getSkinSpritePosition(skin);
    return {
        backgroundImage: 'url(./Texture2D/SkinsUiIcons.png)',
        backgroundSize: '800% 800%',
        backgroundPosition: position || 'center',
        imageRendering: 'pixelated' as const
    };
};
