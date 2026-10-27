import { useEffect, useSyncExternalStore } from 'react';
import assetVersions from '../data/assetVersions.json';

/**
 * Exact skin icon rects, read from the game's own assets.
 *
 * In the game a skin's icon is not a grid position: SkinsVisualConfig.GetConfig(SkinId) (predicate
 * 0x3F69088) picks the SkinVisualConfig whose ItemType and SkinVisualId equal the SkinId's Type and
 * Idx, and the icon is that config's MainEquipmentVisualConfig.Icon sprite, a rect inside
 * SkinsUiIcons.png. reverseForge/extract_battle_visuals.py writes those rects to
 * Texture2D/<version>/SkinIcons.json. Folders without the file keep the grid guess in
 * skinSprites.ts.
 */

export interface SkinIconRect {
    sprite: string;
    tex: string;
    x: number;
    y: number;
    w: number;
    h: number;
    texW: number;
    texH: number;
}

const SKIN_ICON_VERSIONS: readonly string[] = (assetVersions as { skinIcons?: string[] }).skinIcons ?? [];

/** The newest folder at or below `version` that ships SkinIcons.json, or undefined. */
export function resolveSkinIconsVersion(version?: string | null): string | undefined {
    if (!version) return SKIN_ICON_VERSIONS[SKIN_ICON_VERSIONS.length - 1];
    let best: string | undefined;
    for (const candidate of SKIN_ICON_VERSIONS) {
        if (candidate <= version) best = candidate;
    }
    return best;
}

const cache = new Map<string, Record<string, SkinIconRect> | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;

function notify() {
    revision++;
    listeners.forEach(l => l());
}

function load(folder: string) {
    if (cache.has(folder) || pending.has(folder)) return;
    pending.add(folder);
    fetch(`${import.meta.env.BASE_URL}Texture2D/${folder}/SkinIcons.json`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => cache.set(folder, j?.icons ?? null))
        .catch(() => cache.set(folder, null))
        .finally(() => {
            pending.delete(folder);
            notify();
        });
}

/** The icon rect of one skin for a config version, or null when it is not known (yet). */
export function getSkinIconRect(type: string, idx: number, version?: string | null): SkinIconRect | null {
    const folder = resolveSkinIconsVersion(version);
    if (!folder) return null;
    const icons = cache.get(folder);
    if (icons === undefined) load(folder);
    return icons?.[`${type}_${idx}`] ?? null;
}

/**
 * Subscribes a component to the icon store and starts the fetch for `version`, so the component
 * re-renders with the exact rects once they arrive.
 */
export function useSkinIcons(version?: string | null): number {
    const folder = resolveSkinIconsVersion(version);
    useEffect(() => {
        if (folder) load(folder);
    }, [folder]);
    return useSyncExternalStore(
        cb => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        () => revision
    );
}
