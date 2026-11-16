import type { CSSProperties } from 'react';
import { getAscensionTexturePath, resolveTextureVersion } from './ascensionUtils';

/**
 * Pet, mount and skill icons, from the pets / mounts / skills sections of ManualSpriteMapping.json
 * (written by reverseForge/gen_sprite_mapping.py).
 *
 * Most units are a cell of the section's base sheet (Pets.png, MountIcons.png, SkillIcons.png),
 * and the per-ascension sheets reuse the same cell, so the mapping key is that cell. A unit whose
 * icons do not follow that rule carries `icons`, one entry per ascension slot (null where the game
 * has no sprite), each a cell of a sheet listed under the section's `sheets` (or the base sheet).
 * Its key is then only an identity and is not drawable on the base sheet.
 */

interface SheetInfo {
    texture_size: { width: number; height: number };
    sprite_size: { width: number; height: number };
    grid?: { columns: number; rows: number };
}

export interface UnitIconRef {
    texture: string;
    cell: number;
}

export interface UnitSection extends SheetInfo {
    texture: string;
    mapping: Record<string, any>;
    sheets?: Record<string, SheetInfo>;
}

/** Props for SpriteSheetIcon. */
export interface UnitIcon {
    textureSrc: string;
    spriteWidth: number;
    spriteHeight: number;
    sheetWidth: number;
    sheetHeight: number;
    iconIndex: number;
}

/**
 * The game's AscensionExtensions.ForAscension (RVA 0x48088C4): the slot min(ascension, count - 1),
 * else the nearest non-null slot below it, else the nearest one above it.
 */
export function forAscension<T>(list: readonly (T | null | undefined)[] | null | undefined, ascensionLevel: number): T | null {
    if (!list || list.length === 0) return null;
    const start = Math.max(0, Math.min(ascensionLevel | 0, list.length - 1));
    for (let i = start; i >= 0; i--) if (list[i]) return list[i] as T;
    for (let i = start + 1; i < list.length; i++) if (list[i]) return list[i] as T;
    return null;
}

/** The mapping key of the first entry matching `match`, or null. */
export function findUnitKey(section: UnitSection | null | undefined, match: (entry: any) => boolean): string | null {
    if (!section?.mapping) return null;
    for (const [key, entry] of Object.entries(section.mapping)) if (match(entry)) return key;
    return null;
}

/** Key of a pet or mount by its (rarity, id). */
export function findUnitKeyById(section: UnitSection | null | undefined, rarity: string | null | undefined, id: number | null | undefined): string | null {
    if (rarity == null || id == null) return null;
    return findUnitKey(section, e => e?.rarity === rarity && e?.id === id);
}

/** Key of a skill by its CombatSkill name. */
export function findSkillKey(section: UnitSection | null | undefined, name: string | null | undefined): string | null {
    if (!name) return null;
    return findUnitKey(section, e => e?.name === name);
}

/** The icon the game shows for the unit under `key` at `ascensionLevel`, as SpriteSheetIcon props. */
export function unitIcon(
    section: UnitSection | null | undefined,
    key: string | number | null | undefined,
    ascensionLevel: number,
    version?: string | null,
): UnitIcon | null {
    if (!section?.mapping || key == null || key === '' || (typeof key === 'number' && key < 0)) return null;
    const entry = section.mapping[String(key)];
    if (!entry) return null;
    const icons: (UnitIconRef | null)[] | undefined = entry.icons;
    if (icons) {
        const ref = forAscension(icons, ascensionLevel);
        if (!ref) return null;
        const sheet = section.sheets?.[ref.texture] ?? (ref.texture === section.texture ? section : null);
        if (!sheet) return null;
        const textureVersion = resolveTextureVersion(version);
        return {
            textureSrc: `${import.meta.env.BASE_URL}Texture2D/${textureVersion ? `${textureVersion}/` : ''}${ref.texture}`,
            spriteWidth: sheet.sprite_size.width,
            spriteHeight: sheet.sprite_size.height,
            sheetWidth: sheet.texture_size.width,
            sheetHeight: sheet.texture_size.height,
            iconIndex: ref.cell,
        };
    }
    const base = section.texture.replace(/\.png$/i, '') as Parameters<typeof getAscensionTexturePath>[0];
    return {
        textureSrc: getAscensionTexturePath(base, ascensionLevel, version ?? undefined),
        spriteWidth: section.sprite_size.width,
        spriteHeight: section.sprite_size.height,
        sheetWidth: section.texture_size.width,
        sheetHeight: section.texture_size.height,
        iconIndex: parseInt(String(key), 10),
    };
}

/** Pixel position of an icon's cell on its sheet. */
export function unitIconRect(icon: UnitIcon): { x: number; y: number } {
    const columns = Math.max(1, Math.floor(icon.sheetWidth / icon.spriteWidth));
    return {
        x: (icon.iconIndex % columns) * icon.spriteWidth,
        y: Math.floor(icon.iconIndex / columns) * icon.spriteHeight,
    };
}

/** Background style that draws `icon` into a box of `size` CSS pixels. */
export function unitIconStyle(icon: UnitIcon | null, size: number): CSSProperties | null {
    if (!icon) return null;
    const { x, y } = unitIconRect(icon);
    const sx = size / icon.spriteWidth;
    const sy = size / icon.spriteHeight;
    return {
        backgroundImage: `url(${icon.textureSrc})`,
        backgroundPosition: `-${x * sx}px -${y * sy}px`,
        backgroundSize: `${icon.sheetWidth * sx}px ${icon.sheetHeight * sy}px`,
        backgroundRepeat: 'no-repeat',
        width: `${size}px`,
        height: `${size}px`,
    };
}
