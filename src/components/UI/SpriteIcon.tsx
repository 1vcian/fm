
import { cn } from '../../lib/utils';

// Sprite Sheet Configuration
const SPRITE_SHEET_URL = './icons/game/Icons.png'; // Assuming it's here as per user
const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 2048;
const SPRITE_SIZE = 256; // Standard size of one sprite in the sheet

// Mapping from Name to Position (x, y)
// Based on public/parsed_configs/2026_01_10/IconsMap.json
const SPRITE_MAPPING: Record<string, { x: number; y: number }> = {
    'Coin': { x: 0, y: 0 },
    'Hammer': { x: 256, y: 0 },
    'ArrowDown': { x: 512, y: 0 },
    'ArrowUp': { x: 768, y: 0 },
    'Battle': { x: 1024, y: 0 },
    'VideoAd': { x: 1280, y: 0 },
    'GemSquare': { x: 1536, y: 0 },
    'SkillTicket': { x: 1792, y: 0 },
    'Potion': { x: 0, y: 256 },
    'HammerKey': { x: 256, y: 256 },
    'SkillKey': { x: 512, y: 256 },
    'PetKey': { x: 768, y: 256 },
    'PotionKey': { x: 1024, y: 256 },
    'UnknownKey': { x: 1280, y: 256 },
    'Egg': { x: 1536, y: 256 },
    'PVPTicket': { x: 1792, y: 256 },
    'Male': { x: 0, y: 512 },
    'Female': { x: 256, y: 512 },
    'Star': { x: 512, y: 512 },
    'CommonChest': { x: 0, y: 768 },
    'RareChest': { x: 256, y: 768 },
    'EpicChest': { x: 512, y: 768 },
    'LegendaryChest': { x: 768, y: 768 },
    // Fallback/Generic Icons
    'Sword': { x: 1024, y: 0 }, // Using Battle icon as placeholder
    'Bow': { x: 512, y: 0 },    // Using ArrowDown icon as placeholder
};

interface SpriteIconProps {
    name: keyof typeof SPRITE_MAPPING | string; // Allow string for flexibility
    size?: number; // Checkbox, Button icons usually span 16-32px
    className?: string;
}

export function SpriteIcon({ name, size = 24, className }: SpriteIconProps) {
    const mapping = SPRITE_MAPPING[name as keyof typeof SPRITE_MAPPING];

    if (!mapping) {
        // Fallback or explicit unknown
        console.warn(`Sprite icon "${name}" not found.`);
        return <div className={cn("bg-gray-400 rounded-full", className)} style={{ width: size, height: size }} />;
    }

    // Calculate background position
    // object-position or background-position for sprites?
    // Using background-image approach is common for sprites.
    // background-position: -xpx -ypx;
    // background-size: (sheetWidth / spriteWidth * 100)% ?
    // Actually, background-size needs to scale the entire sheet relative to the element size.
    // Scale Factor = size / SPRITE_SIZE
    // Sheet CSS Width = TEXTURE_WIDTH * Scale Factor

    // Simpler math:
    // background-size: (TEXTURE_WIDTH / SPRITE_SIZE) * 100% ? No.
    // If element is 'size' px wide.
    // We want 'SPRITE_SIZE' px of the image to map to 'size' px.
    // Ratio = size / SPRITE_SIZE.
    // Total BG Size = TEXTURE_WIDTH * Ratio.

    const ratio = size / SPRITE_SIZE;
    const bgWidth = TEXTURE_WIDTH * ratio;
    const bgHeight = TEXTURE_HEIGHT * ratio;
    const bgX = -(mapping.x * ratio);
    const bgY = -(mapping.y * ratio);

    return (
        <div
            className={cn("inline-block shrink-0", className)}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${SPRITE_SHEET_URL})`,
                backgroundPosition: `${bgX}px ${bgY}px`,
                backgroundSize: `${bgWidth}px ${bgHeight}px`,
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated' // Optional, for crisp edges
            }}
            role="img"
            aria-label={String(name)}
        />
    );
}
