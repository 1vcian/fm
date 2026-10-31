/**
 * Putting the best skins on a finished build. Skins add only two things a build cares about:
 *   stats   each piece's rolled stats (Damage or Health multiplier), and the set bonus when all
 *           three pieces (Weapon, Helmet, Armour) are of one set, as the engine counts it;
 *   attack  a shown weapon skin attacks with its own WeaponLibrary row (GetSkinnedItemId), so the
 *           build's attack animation decides which weapon skin may be worn shown.
 * So the search runs without skins once, and the skins are chosen here, from every set at its top
 * (the preset builds) or from the player's own archive with its real rolls and levels (my best
 * variants). A combination is scored on the caller's score; complete sets, which carry the bonus,
 * are always among the candidates.
 */
import type { SavedSkin, UserProfile } from '../types/Profile';
import { equippedFromSaved, skinMaxLevel, SKIN_TYPE_TO_SLOT } from '../utils/skinArchive';
import type { AnimationSwap } from './equivalents';

export type SkinType = 'Weapon' | 'Helmet' | 'Armour';
const TYPES: SkinType[] = ['Weapon', 'Helmet', 'Armour'];

/** One wearable skin piece with its stats and level. */
export interface SkinPiece {
    type: SkinType;
    idx: number;
    setId: string;
    stats: Record<string, number>;
    level: number;
}

/** Pieces kept per slot by their own score, besides the complete sets. */
const PER_SLOT = 3;

/** Every set's pieces at their top level, one piece per PossibleStats choice at MaxValue. */
export function topPieces(skinsLibrary: any, skinUpgradeLibrary: any, setIds: Iterable<string>): SkinPiece[] {
    const wanted = new Set(setIds);
    const out: SkinPiece[] = [];
    for (const row of Object.values<any>(skinsLibrary ?? {})) {
        if (!wanted.has(row.BaseSetId) || !TYPES.includes(row.SkinId.Type)) continue;
        for (const ps of row.PossibleStats ?? []) {
            out.push({
                type: row.SkinId.Type, idx: row.SkinId.Idx, setId: row.BaseSetId,
                stats: { [ps.StatNode.UniqueStat.StatType]: ps.MaxValue },
                level: skinMaxLevel(skinUpgradeLibrary, row.SkinId.Type, row.SkinId.Idx),
            });
        }
    }
    return out;
}

/** The player's own pieces (the profile's skin archive), with their real stats and levels. */
export function ownedPieces(saved: SavedSkin[], skinsLibrary: any): SkinPiece[] {
    const rows = Object.values<any>(skinsLibrary ?? {});
    return saved.flatMap((s): SkinPiece[] => {
        const row = rows.find(r => r.SkinId.Type === s.type && r.SkinId.Idx === s.idx);
        if (!row?.BaseSetId || !TYPES.includes(s.type as SkinType)) return [];
        return [{ type: s.type as SkinType, idx: s.idx, setId: row.BaseSetId, stats: { ...s.stats }, level: s.level }];
    });
}

/** The build wearing these pieces (null: none on that slot) with the animation's weapon and skin visibility. */
export function wearSkins(p: UserProfile, anim: AnimationSwap, pieces: Partial<Record<SkinType, SkinPiece | null>>): UserProfile {
    const q: UserProfile = JSON.parse(JSON.stringify(p));
    if (q.items.Weapon) q.items.Weapon = { ...q.items.Weapon, idx: anim.weaponIdx };
    const saved: SavedSkin[] = [];
    for (const type of TYPES) {
        const item = q.items[SKIN_TYPE_TO_SLOT[type]];
        if (!item) continue;
        delete item.skin;
        const piece = pieces[type];
        if (!piece) continue;
        const s: SavedSkin = { id: `preset_${type}`, type, idx: piece.idx, stats: { ...piece.stats }, level: piece.level };
        saved.push(s);
        item.skin = equippedFromSaved(s);
    }
    q.skins = { saved };
    q.misc = { ...q.misc, useSkinWindup: anim.source === 'skin' };
    return q;
}

/**
 * The best skins for a build and an attack animation, or null when the animation needs a weapon
 * skin that is not among the pieces. With a skin animation the weapon piece is that set's; with
 * the weapon's own animation any weapon piece may be worn, hidden, for its stats.
 */
export function applyBestSkins(p: UserProfile, anim: AnimationSwap, pieces: SkinPiece[], score: (q: UserProfile) => number): UserProfile | null {
    const of = (t: SkinType) => pieces.filter(x => x.type === t);
    const weapons = anim.source === 'skin' ? of('Weapon').filter(w => w.setId === anim.setId) : of('Weapon');
    if (anim.source === 'skin' && !weapons.length) return null;
    // Per slot: the pieces that score best alone, then every complete set (the bonus needs all three).
    const solo = (t: SkinType, list: SkinPiece[]) => list
        .map(x => ({ x, v: score(wearSkins(p, anim, { [t]: x })) }))
        .sort((a, b) => b.v - a.v)
        .slice(0, PER_SLOT)
        .map(e => e.x);
    const cand: Record<SkinType, (SkinPiece | null)[]> = {
        Weapon: anim.source === 'skin' ? solo('Weapon', weapons) : [null, ...solo('Weapon', weapons)],
        Helmet: [null, ...solo('Helmet', of('Helmet'))],
        Armour: [null, ...solo('Armour', of('Armour'))],
    };
    const combos: Partial<Record<SkinType, SkinPiece | null>>[] = [];
    for (const Weapon of cand.Weapon) for (const Helmet of cand.Helmet) for (const Armour of cand.Armour) combos.push({ Weapon, Helmet, Armour });
    // Complete sets: for each set with all three types, the best piece of each type alone.
    const sets = new Set(pieces.map(x => x.setId));
    for (const setId of sets) {
        const pick = (t: SkinType) => {
            const list = (t === 'Weapon' ? weapons : of(t)).filter(x => x.setId === setId);
            return list.length ? solo(t, list)[0] : null;
        };
        const full = { Weapon: pick('Weapon'), Helmet: pick('Helmet'), Armour: pick('Armour') };
        if (full.Weapon && full.Helmet && full.Armour) combos.push(full);
    }
    let best: UserProfile | null = null, bestV = -Infinity;
    for (const c of combos) {
        const q = wearSkins(p, anim, c);
        const v = score(q);
        if (v > bestV * (1 + 1e-9)) { best = q; bestV = v; }
    }
    return best;
}
