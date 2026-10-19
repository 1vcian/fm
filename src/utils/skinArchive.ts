/**
 * Skin archive helpers: config lookups for skins (SkinsLibrary, SkinUpgradeLibrary, SetsLibrary)
 * and the level scaling of a skin's stats. Pure (no React) so the stat engine, the optimizer
 * worker and the selftest share one implementation.
 */
import type { EquippedSkin, ItemSlot, SavedSkin, UserProfile } from '../types/Profile';

/** Profile item slot -> SkinsLibrary SkinId.Type. Only these slots carry skins in the game. */
export const SLOT_TO_SKIN_TYPE: Record<string, string> = { Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Armour' };
/** SkinsLibrary SkinId.Type -> profile item slot. */
export const SKIN_TYPE_TO_SLOT: Record<string, keyof UserProfile['items']> = { Weapon: 'Weapon', Helmet: 'Helmet', Armour: 'Body' };

/** The SkinsLibrary row of a skin, or undefined. */
export function skinRow(skinsLibrary: any, type: string | undefined, idx: number): any | undefined {
    if (!skinsLibrary || !type) return undefined;
    const direct = skinsLibrary[`{'Type': '${type}', 'Idx': ${idx}}`];
    if (direct) return direct;
    return Object.values<any>(skinsLibrary).find(s => s?.SkinId?.Type === type && s?.SkinId?.Idx === idx);
}

/** Skin types in the config (SkinsLibrary SkinId.Type): the slot-mapped ones first, in slot order. */
export function skinTypes(skinsLibrary: any): string[] {
    const found = new Set<string>();
    for (const s of Object.values<any>(skinsLibrary || {})) if (s?.SkinId?.Type) found.add(s.SkinId.Type);
    const known = Object.keys(SKIN_TYPE_TO_SLOT).filter(t => found.has(t));
    return [...known, ...[...found].filter(t => !known.includes(t))];
}

// ---------------------------------------------------------------------------------------------
// Levels (build 2026_10_08_09_03, SkinUpgradeLibrary)
// ---------------------------------------------------------------------------------------------

/**
 * IsGoodSkin (0x77B5D0C) is `SkinId.Idx < 100`: a good skin reads the Good* arrays and increment
 * of SkinUpgradeLibrary, every other skin the Bad* ones. This threshold is code, not config.
 */
export const isGoodSkin = (idx: number) => idx < 100;

/** The SkinUpgradeLibrary row of a skin type ("Weapon" / "Helmet" / "Armour"). */
const upgradeRow = (skinUpgradeLibrary: any, type: string | undefined) => (type ? skinUpgradeLibrary?.[type] : undefined);

/** Good/BadSkinsLevelExperience of the skin, or null when the config is not loaded. */
export function skinLevelExperience(skinUpgradeLibrary: any, type: string | undefined, idx: number): number[] | null {
    const row = upgradeRow(skinUpgradeLibrary, type);
    const arr = row?.[isGoodSkin(idx) ? 'GoodSkinsLevelExperience' : 'BadSkinsLevelExperience'];
    return Array.isArray(arr) ? arr : null;
}

/** Stat increase per level (Good/BadSkinStatIncreasePerLevel), or null when the config is not loaded. */
export function skinStatIncreasePerLevel(skinUpgradeLibrary: any, type: string | undefined, idx: number): number | null {
    const row = upgradeRow(skinUpgradeLibrary, type);
    const v = row?.[isGoodSkin(idx) ? 'GoodSkinStatIncreasePerLevel' : 'BadSkinStatIncreasePerLevel'];
    return typeof v === 'number' ? v : null;
}

/** GetMaxLevel (0x77B6460): the experience array length - 1 (levels start at 0, CreateSkin 0x77B57B4). */
export function skinMaxLevel(skinUpgradeLibrary: any, type: string | undefined, idx: number): number {
    const arr = skinLevelExperience(skinUpgradeLibrary, type, idx);
    return arr ? Math.max(0, arr.length - 1) : 0;
}

/** GetSkinTotalLevelXp (0x77B5C28): sum(arr[0..level]), both ends included. */
export function skinTotalLevelXp(arr: number[], level: number): number {
    let t = 0;
    for (let i = 0; i <= level && i < arr.length; i++) t += arr[i];
    return t;
}

/**
 * CalculateLevelAndXp (0x77B5D28): walk the array while the remaining xp covers arr[i]; level = the
 * last i covered, the rest stays as experience (not clamped at the max level).
 */
export function skinLevelFromTotalXp(arr: number[], totalXp: number): { level: number; xp: number } {
    let level = 0, xp = totalXp;
    for (let i = 0; i < arr.length; i++) {
        if (xp - arr[i] < 0) break;
        level = i;
        xp -= arr[i];
    }
    return { level, xp };
}

/**
 * GetResolvedStatContributionsForLevel (0x77B5FF4): every rolled stat + increase * Level
 * (mul 0x77B61C8, add 0x77B61D8), additive and unrounded, with the skin's own Level (not Level - 1).
 * Without SkinUpgradeLibrary the rolled values are returned unchanged.
 */
export function resolvedSkinStats(
    skin: { type?: string; idx: number; stats: Record<string, number>; level?: number },
    skinUpgradeLibrary: any,
    fallbackType?: string,
): Record<string, number> {
    const level = skin.level || 0;
    const inc = level > 0 ? skinStatIncreasePerLevel(skinUpgradeLibrary, skin.type || fallbackType, skin.idx) : 0;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(skin.stats || {})) out[k] = (Number(v) || 0) + (inc || 0) * level;
    return out;
}

// ---------------------------------------------------------------------------------------------
// Sets (SetsLibrary)
// ---------------------------------------------------------------------------------------------

export interface ActiveSetTier {
    setId: string;
    /** Equipped skins of the set. */
    pieces: number;
    /** The tier's RequiredPieces. */
    requiredPieces: number;
    /** BonusStats of the tier: StatType -> value (set skins carry SetId Level 0, so no StatsLevelIncrement). */
    stats: Record<string, number>;
}

/** Profile item slot -> SkinsLibrary type for the lookups of worn skins (the slot fallback). */
const SLOT_FALLBACK_TYPE: Record<string, string> = { Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Armour' };

/**
 * The set bonus tiers the equipped skins complete. Only EQUIPPED skins count (set pieces change
 * only in SkinEquipAction 0x78595A0, SkinUnequipAction 0x785A8A8, SkinMergeAction; visibility never
 * touches them), one piece per equipped skin with a BaseSetId. Every tier with RequiredPieces <=
 * pieces adds (GetResolvedActiveSetBonusTiers 0x7853CB8 skips only the tiers it does not reach).
 * StatsLevelIncrement multiplies SetId.Level, which PlayerSkinModel.GetSetId (0x78548EC) always
 * builds as 0 for a skin, so the bonus never depends on skin levels.
 */
export function activeSetTiers(items: UserProfile['items'], skinsLibrary: any, setsLibrary: any): ActiveSetTier[] {
    if (!skinsLibrary || !setsLibrary) return [];
    const counts: Record<string, number> = {};
    for (const [slot, item] of Object.entries(items || {})) {
        if (!item?.skin) continue;
        const row = skinRow(skinsLibrary, item.skin.type || SLOT_FALLBACK_TYPE[slot] || slot, item.skin.idx);
        const setId = row?.BaseSetId;
        if (setId) counts[setId] = (counts[setId] || 0) + 1;
    }
    const out: ActiveSetTier[] = [];
    for (const [setId, pieces] of Object.entries(counts)) {
        for (const tier of setsLibrary[setId]?.BonusTiers || []) {
            if (pieces < tier.RequiredPieces) continue;
            const stats: Record<string, number> = {};
            for (const st of tier.BonusStats?.Stats || []) {
                const t = st.StatNode?.UniqueStat?.StatType;
                if (t) stats[t] = (stats[t] || 0) + (st.Value || 0);
            }
            out.push({ setId, pieces, requiredPieces: tier.RequiredPieces, stats });
        }
    }
    return out;
}

/** Pieces of a set in SkinsLibrary (for "2/3"-style labels). */
export function setPieceCount(skinsLibrary: any, setId: string): number {
    return Object.values<any>(skinsLibrary || {}).filter(s => s?.BaseSetId === setId).length;
}

/** "DarkPlanetWarriorSet" -> "Dark Planet Warrior". */
export function setDisplayName(setId: string | null | undefined): string {
    if (!setId) return '';
    return setId.replace(/Set$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

/** A display name for a skin: its set name + type, else "Type #idx". */
export function skinDisplayName(skinsLibrary: any, type: string, idx: number): string {
    const row = skinRow(skinsLibrary, type, idx);
    const set = setDisplayName(row?.BaseSetId);
    return set ? `${set} ${type}` : `${type} #${idx}`;
}

export const newSkinId = () => `skin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Content key of a worn/saved skin (type, idx, stats, level): what "the same skin" means. */
export function skinContentKey(s: { type?: string; idx: number; stats: Record<string, number>; level?: number } | null | undefined): string {
    if (!s) return 'none';
    const stats = Object.keys(s.stats || {}).sort().map(k => `${k}=${s.stats[k]}`).join(',');
    return `${s.type ?? '?'}|${s.idx}|${stats}|${s.level ?? 0}`;
}

/** The equipped form of an archive skin. */
export function equippedFromSaved(s: SavedSkin): EquippedSkin {
    return { idx: s.idx, type: s.type, stats: { ...s.stats }, level: s.level, savedId: s.id };
}

/** The archive entry matching an equipped skin: by savedId, else by content. */
export function findSavedSkin(saved: SavedSkin[] | undefined, skin: EquippedSkin | undefined, slotType?: string): SavedSkin | undefined {
    if (!saved || !skin) return undefined;
    const type = skin.type || slotType;
    if (skin.savedId) {
        const byId = saved.find(s => s.id === skin.savedId);
        if (byId) return byId;
    }
    const key = skinContentKey({ ...skin, type });
    return saved.find(s => skinContentKey(s) === key);
}

/** Puts a skin on an item (or removes it with null), keeping everything else of the item. */
export function withSkin(item: ItemSlot | null, skin: EquippedSkin | null): ItemSlot | null {
    if (!item) return item;
    const next: ItemSlot = { ...item };
    if (skin) next.skin = skin; else delete next.skin;
    return next;
}

/**
 * The skin as the archive has it now: an item skin linked by savedId takes the archive entry's
 * idx, stats and level, so archive edits and level-ups reach every build that wears it (the
 * profile, saved item presets, both Compare Build sides). Unlinked skins are returned unchanged.
 */
export function archivedSkin(skin: EquippedSkin | undefined, saved: SavedSkin[] | undefined): EquippedSkin | undefined {
    if (!skin?.savedId || !saved) return skin;
    const s = saved.find(x => x.id === skin.savedId);
    return s ? equippedFromSaved(s) : skin;
}

/** The profile with every linked item skin read from the archive (no copy when nothing changes). */
export function withArchivedSkins(p: UserProfile): UserProfile {
    const saved = p.skins?.saved;
    if (!saved?.length || !p.items) return p;
    let changed = false;
    const items = { ...p.items };
    for (const slot of Object.keys(items) as (keyof UserProfile['items'])[]) {
        const item = items[slot];
        if (!item?.skin?.savedId) continue;
        const skin = archivedSkin(item.skin, saved);
        if (skin === item.skin || skinContentKey(skin) === skinContentKey(item.skin)) continue;
        items[slot] = { ...item, skin };
        changed = true;
    }
    return changed ? { ...p, items } : p;
}

/**
 * Migration: every item skin that is not linked to the archive (profiles from before the archive,
 * AutoSync reads) gets an archive entry (an existing one with the same type, idx, stats and level,
 * else a new one) and a savedId pointing at it. Covers the equipped items and the item presets.
 * Returns null when nothing had to change.
 */
export function linkInlineSkins(p: UserProfile): UserProfile | null {
    const saved: SavedSkin[] = [...(p.skins?.saved || [])];
    const ids = new Set(saved.map(s => s.id));
    let changed = false;
    const link = (slot: string, item: ItemSlot | null): ItemSlot | null => {
        if (!item?.skin) return item;
        const type = item.skin.type || SLOT_TO_SKIN_TYPE[slot];
        if (!type || SKIN_TYPE_TO_SLOT[type] !== slot) return item;
        if (item.skin.savedId && ids.has(item.skin.savedId)) return item;
        const key = skinContentKey({ ...item.skin, type });
        let match = saved.find(s => skinContentKey(s) === key);
        if (!match) {
            match = { id: newSkinId(), type, idx: item.skin.idx, stats: { ...(item.skin.stats || {}) }, level: item.skin.level || 0 };
            saved.push(match);
            ids.add(match.id);
        }
        changed = true;
        return { ...item, skin: { ...item.skin, type, savedId: match.id } };
    };
    const items = { ...p.items };
    for (const slot of Object.keys(items) as (keyof UserProfile['items'])[]) items[slot] = link(slot, items[slot]);
    let savedItems = p.savedItems;
    if (savedItems) {
        savedItems = { ...savedItems };
        for (const slot of Object.keys(savedItems)) {
            savedItems[slot] = (savedItems[slot] || []).map(it => link(slot, it) as typeof it);
        }
    }
    if (!changed) return null;
    return { ...p, items, savedItems, skins: { ...(p.skins || {}), saved } };
}

/**
 * After an archive edit: refresh the copy on every linked item (equipped and presets) so the
 * item cards, the battle view and old readers see the new idx, stats and level; a deleted entry
 * (absent from `saved`) leaves the skin on the item, unlinked.
 */
export function syncLinkedSkins(p: UserProfile, saved: SavedSkin[]): Pick<UserProfile, 'items' | 'savedItems'> {
    const byId = new Map(saved.map(s => [s.id, s]));
    const refresh = (item: ItemSlot | null): ItemSlot | null => {
        const id = item?.skin?.savedId;
        if (!item || !id) return item;
        const s = byId.get(id);
        if (!s) {
            const { savedId: _drop, ...rest } = item.skin!;
            return { ...item, skin: rest };
        }
        return { ...item, skin: equippedFromSaved(s) };
    };
    const items = { ...p.items };
    for (const slot of Object.keys(items) as (keyof UserProfile['items'])[]) items[slot] = refresh(items[slot]);
    const savedItems: UserProfile['savedItems'] = {};
    for (const [slot, list] of Object.entries(p.savedItems || {})) savedItems[slot] = (list || []).map(it => refresh(it) as typeof it);
    return { items, savedItems };
}

/** Window event that scrolls to the skin archive panel (detail: { type?: string; create?: boolean }). */
export const OPEN_SKIN_ARCHIVE_EVENT = 'fm:open-skin-archive';
