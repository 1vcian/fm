/**
 * Equivalent builds: a preset build with only its attack animation swapped, for a player who lacks
 * the preset's skin. The generator (buildPresets.ts) keeps a swap only when the 24 h tested run
 * gives the very same result, and the Preset Builds page builds the profile with this same
 * function when the player adds it, so what is added is exactly what was measured.
 */
import type { UserProfile } from '../types/Profile';
import { skinMaxLevel } from '../utils/skinArchive';

/** An attack animation to put on a build: a set's weapon skin shown, or a weapon's own with any skin hidden. */
export interface AnimationSwap {
    source: 'skin' | 'weapon';
    /** Top-age weapon index: the equipped weapon (with a skin, one of the same kind). */
    weaponIdx: number;
    /** The set to wear, for 'skin'. */
    setId: string | null;
    windup: number;
}

const SLOT_OF: Record<string, 'Weapon' | 'Helmet' | 'Body'> = { Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body' };

/**
 * The build wearing the set's Weapon, Helmet and Armour skins (same rolled stats and levels as
 * the build's own set) with the skin animation on, or its own pieces with the weapon's own
 * animation (skin animation off). Everything else is untouched.
 */
export function applyAnimation(p: UserProfile, a: AnimationSwap, skinsLibrary: any, skinUpgradeLibrary: any): UserProfile {
    const q: UserProfile = JSON.parse(JSON.stringify(p));
    if (q.items.Weapon) q.items.Weapon = { ...q.items.Weapon, idx: a.weaponIdx };
    if (a.source === 'skin' && a.setId) {
        const rows = Object.values<any>(skinsLibrary ?? {}).filter(r => r.BaseSetId === a.setId);
        for (const saved of q.skins?.saved ?? []) {
            const row = rows.find(r => r.SkinId.Type === saved.type);
            if (!row) continue;
            saved.idx = row.SkinId.Idx;
            saved.level = skinMaxLevel(skinUpgradeLibrary, saved.type, row.SkinId.Idx);
            const slot = SLOT_OF[saved.type];
            const item = slot ? q.items[slot] : undefined;
            if (item?.skin) item.skin = { ...item.skin, idx: saved.idx, level: saved.level };
        }
    }
    q.misc = { ...q.misc, useSkinWindup: a.source === 'skin' };
    return q;
}
