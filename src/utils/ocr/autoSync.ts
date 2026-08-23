// AutoSync orchestration: run OCR over uploaded screenshots, diff the results against the
// current profile, and produce reviewable change rows. Nothing is applied until the user
// accepts rows in the diff modal (applyChanges builds the updateProfile payload).

import type { UserProfile, ItemSlot, PetSlot, MountSlot } from '../../types/Profile';
import { extractScreenshot, type ScreenExtraction, type DetItem, type DetUnit, type DetSubstat } from './extract';
import { readScreenshots } from './autoSyncPipeline';
import type { ScreenReadResult, Substat, CurrencyCrops } from './readerTypes';
import { setOcrProgress, type OcrProgress } from './ocrEngine';
import type { GameDictionaries } from './gameLocalization';
import { RARITY_NAMES } from './templateParams';
import { splitCamel, TYPE_NAME_TO_SLOT } from './gameDictionary';
import { MAX_ACTIVE_PETS } from '../constants';
import { getStatName } from '../statNames';
import { getTechNodeName } from '../techUtils';

// OCR currency key -> profile.misc key (same keys the calculators read).
const CURRENCY_TO_MISC: Record<string, string> = {
    coins: 'coins',
    gems: 'gemCount',
    eggshells: 'eggshellCount',
    skillTickets: 'skillCalculatorTickets',
    clockWinders: 'mountCalculatorWinders',
};
const CURRENCY_LABEL: Record<string, string> = {
    coins: 'Coins', gems: 'Gems', eggshells: 'Eggshells',
    skillTickets: 'Skill Tickets', clockWinders: 'Clock Winders',
};

export type Patch =
    | { t: 'item'; slot: string; item: ItemSlot }
    // pets are SLOT-addressed (pets.active[slotIndex], 0..MAX_ACTIVE_PETS-1); `key` keeps the
    // collection bookkeeping (`${rarity}_${id}`). The same identity may sit in several slots.
    | { t: 'pet'; key: string; slotIndex: number; pet: PetSlot }
    | { t: 'mount'; mount: MountSlot }
    | { t: 'currency'; miscKey: string; value: number }
    // hammers live in misc.forgeCalculator.hammers and are stored AS A STRING there
    | { t: 'forgeHammers'; value: number }
    | { t: 'skill'; skillId: string; level: number; ascension?: number | null }
    | { t: 'skinEquip'; slot: string; skin: NonNullable<ItemSlot['skin']> }
    // clan tech tree node level: globalId is the FLATTENED GuildTechTreePositionLibrary index
    // (the profile.techTree.Clan key); max = library MaxLevel (clamps the editable level)
    | { t: 'clanTree'; globalId: number; nodeType: string; level: number; max: number };

/** Detected fields kept on the row so the modal can render visuals + rebuild the patch on slot change. */
export interface Detected {
    age?: number; idx?: number; level?: number | null; stars?: number;
    rarity?: string; id?: number; name?: string; substats?: DetSubstat[];
    mainKind?: 'damage' | 'health' | null; ranged?: boolean;
    // evidence crops (JPEG data-URLs of the source-screenshot bands each value was read from)
    levelCropUrl?: string; mainCropUrl?: string;
    // skinEquip rows: what was read from the skin popup (setId lets the modal re-resolve on slot change)
    setId?: string; skinType?: string; skinStats?: { statType: string; value: number }[];
}

export interface ChangeRow {
    id: string;
    category: 'item' | 'pet' | 'mount' | 'currency' | 'skill' | 'skinEquip' | 'clanTree';
    label: string;
    detail: string;
    action: 'replace' | 'add' | 'update';
    confidence: number;
    before: string | null;
    after: string;
    accepted: boolean;
    warnings: string[];
    patch: Patch;
    cropUrl?: string;   // picture of what we read (for the visual modal)
    slot?: string;      // items: the chosen target slot (editable)
    detected?: Detected;
}

export const ITEM_SLOTS = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

/**
 * Build an item patch for a chosen slot. Keeps the slot's CURRENT item model unless the
 * detection is confident (or the slot is empty), so changing the slot just re-applies the
 * detected level + substats to that slot's existing item.
 */
export function buildItemPatch(profile: UserProfile, slot: string, det: Detected, confident: boolean): Patch {
    const cur = (profile.items as any)[slot] as ItemSlot | null;
    const useDetected = confident || !cur;
    const item: ItemSlot = {
        age: useDetected && det.age != null && det.age >= 0 ? det.age : (cur?.age ?? det.age ?? 0),
        idx: useDetected && det.idx != null && det.idx >= 0 ? det.idx : (cur?.idx ?? det.idx ?? 0),
        level: det.level ?? cur?.level ?? 1,
        rarity: cur?.rarity ?? 'Common',
        secondaryStats: (det.substats || []).filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value })),
        skin: cur?.skin,
    };
    return { t: 'item', slot, item };
}

function fmt(n: number | null | undefined): string {
    if (n == null) return '—';
    const abs = Math.abs(n);
    const units: [number, string][] = [[1e15, 'q'], [1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']];
    for (const [u, s] of units) if (abs >= u) return `${parseFloat((n / u).toFixed(2))}${s}`;
    return String(n);
}

export function substatSummary(subs: { statId: string | null; value: number }[] | undefined | null): string {
    return (subs || []).filter(s => s.statId).map(s => `+${s.value}% ${getStatName(s.statId!)}`).join(', ') || '—';
}

/** One-line summary of an item's skin ({idx, type, stats: fraction values}). */
export function skinSummary(skin: ItemSlot['skin'] | null | undefined): string {
    if (!skin) return 'no skin';
    const stats = Object.entries(skin.stats || {})
        .map(([k, v]) => `+${parseFloat((v * 100).toFixed(2))}% ${splitCamel(k)}`).join(', ');
    return `${skin.type ?? ''} skin #${skin.idx}${stats ? ` · ${stats}` : ''}`.trim();
}

function toItemSlot(d: DetItem, existing: ItemSlot | null): ItemSlot {
    return {
        age: d.age,
        idx: d.idx,
        level: d.level ?? existing?.level ?? 1,
        rarity: existing?.rarity ?? 'Common',
        secondaryStats: d.substats.filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value })),
        skin: existing?.skin, // OCR doesn't read skins here — keep whatever is already set
    };
}

function toPetSlot(d: DetUnit, existing: PetSlot | null): PetSlot {
    return {
        rarity: d.rarity,
        id: d.id,
        level: d.level ?? existing?.level ?? 1,
        evolution: existing?.evolution ?? 0,
        ascensionLevel: d.stars || existing?.ascensionLevel || 0,
        secondaryStats: d.substats.filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value })),
        customName: existing?.customName,
        hp: existing?.hp,
    };
}

function toMountSlot(d: DetUnit, existing: MountSlot | null): MountSlot {
    return {
        rarity: d.rarity,
        id: d.id,
        level: d.level ?? existing?.level ?? 1,
        evolution: existing?.evolution ?? 0,
        ascensionLevel: d.stars || existing?.ascensionLevel || 0,
        skills: existing?.skills ?? [],
        secondaryStats: d.substats.filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value })),
        customName: existing?.customName,
        hp: existing?.hp,
    };
}

const ACCEPT_THRESHOLD = 0.62; // rows below this start unchecked for the user to review

/**
 * Default active-pet slot for a detected pet, one per builder run (`taken` carries the state):
 * a slot whose CURRENT active pet has the same identity wins; otherwise the first slot not yet
 * defaulted to. Duplicate identities in different slots are legal — each detected pet consumes
 * one slot. With more detections than MAX_ACTIVE_PETS the overflow defaults to slot 0 and the
 * modal's conflict rule (two accepted rows on one slot) blocks Apply until the user resolves it.
 */
export function defaultPetSlot(
    active: (PetSlot | null | undefined)[],
    pet: { rarity: string; id: number },
    taken: Set<number>,
): number {
    for (let i = 0; i < MAX_ACTIVE_PETS; i++) {
        const s = active[i];
        if (!taken.has(i) && s && s.rarity === pet.rarity && s.id === pet.id) { taken.add(i); return i; }
    }
    for (let i = 0; i < MAX_ACTIVE_PETS; i++) {
        if (!taken.has(i)) { taken.add(i); return i; }
    }
    return 0;
}

/** Diff the OCR extractions against the current profile into reviewable change rows. */
export function buildChanges(extractions: ScreenExtraction[], profile: UserProfile): ChangeRow[] {
    const rows: ChangeRow[] = [];
    let n = 0;
    const seenCurrency = new Set<string>();
    const petSlotsTaken = new Set<number>();

    for (const ex of extractions) {
        // --- items --- (always shown so the user can confirm the slot visually)
        if (ex.item && (ex.item.substats.length || ex.item.main)) {
            const d = ex.item;
            const slot = d.slot || (d.main?.kind === 'health' ? 'Helmet' : 'Weapon');
            const detected: Detected = {
                age: d.age, idx: d.idx, level: d.level, stars: d.stars, name: d.name,
                substats: d.substats, mainKind: d.main?.kind ?? null, ranged: d.main?.ranged,
            };
            const confident = d.confidence >= 0.7;
            const patch = buildItemPatch(profile, slot, detected, confident);
            const newItem = (patch as { item: ItemSlot }).item;
            const cur = (profile.items as any)[slot] as ItemSlot | null;
            rows.push({
                id: `item-${n++}`, category: 'item',
                label: d.name || 'Item — confirm slot',
                detail: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                action: cur ? 'replace' : 'add', confidence: d.confidence,
                before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
                after: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                accepted: d.confidence >= ACCEPT_THRESHOLD,
                warnings: ex.warnings, patch, cropUrl: d.cropUrl, slot, detected,
            });
        }
        // --- pets / mounts ---
        if (ex.unit && ex.unit.id >= 0) {
            const d = ex.unit;
            if (d.kind === 'pet') {
                const key = `${d.rarity}_${d.id}`;
                const cur = (profile.pets.collection as any)[key] as PetSlot | null;
                const pet = toPetSlot(d, cur);
                const slotIndex = defaultPetSlot(profile.pets.active ?? [], pet, petSlotsTaken);
                const curSlot = (profile.pets.active ?? [])[slotIndex] ?? null;
                rows.push({
                    id: `pet-${n++}`, category: 'pet',
                    label: `Pet: ${d.name || key} (${d.rarity})`,
                    detail: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats)}`,
                    action: curSlot ? 'update' : 'add',
                    confidence: d.confidence,
                    before: curSlot ? `Lv.${curSlot.level} · ${substatSummary(curSlot.secondaryStats || [])}` : null,
                    after: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats || [])}`,
                    accepted: d.confidence >= ACCEPT_THRESHOLD,
                    warnings: ex.warnings,
                    patch: { t: 'pet', key, slotIndex, pet },
                    cropUrl: d.cropUrl,
                    detected: { rarity: d.rarity, id: d.id, level: d.level, stars: d.stars, substats: d.substats },
                });
            } else {
                const cur = profile.mount.active;
                const mount = toMountSlot(d, cur);
                rows.push({
                    id: `mount-${n++}`, category: 'mount',
                    label: `Mount: ${d.name || `${d.rarity} #${d.id}`}`,
                    detail: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats || [])}`,
                    action: cur ? 'replace' : 'add',
                    confidence: d.confidence,
                    before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats || [])}` : null,
                    after: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats || [])}`,
                    accepted: d.confidence >= ACCEPT_THRESHOLD,
                    warnings: ex.warnings,
                    patch: { t: 'mount', mount },
                    cropUrl: d.cropUrl,
                    detected: { rarity: d.rarity, id: d.id, level: d.level, stars: d.stars, substats: d.substats },
                });
            }
        }
        // --- currencies ---
        for (const [ck, val] of Object.entries(ex.currencies)) {
            const miscKey = CURRENCY_TO_MISC[ck];
            if (!miscKey || seenCurrency.has(miscKey)) continue;
            seenCurrency.add(miscKey);
            const cur = Number((profile.misc as any)[miscKey] ?? 0);
            if (cur === val) continue;
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: CURRENCY_LABEL[ck] || ck,
                detail: `${fmt(cur)} → ${fmt(val)}`,
                action: 'update',
                confidence: 0.9,
                before: fmt(cur),
                after: fmt(val),
                accepted: true,
                warnings: [],
                patch: { t: 'currency', miscKey, value: val },
            });
        }
    }
    // sort: highest-confidence, items first
    const order: Record<ChangeRow['category'], number> = { item: 0, skinEquip: 1, pet: 2, mount: 3, skill: 4, clanTree: 5, currency: 6 };
    rows.sort((a, b) => order[a.category] - order[b.category] || b.confidence - a.confidence);
    return rows;
}

// ---------------------------------------------------------------------------------------------
// New template-pipeline path: consume ScreenReadResult[] (from autoSyncPipeline.readScreenshots)
// and produce the SAME reviewable ChangeRow[] the modal renders. Mirrors buildChanges exactly for
// items / pets / mounts / currencies, and additionally supports the skills grid.
// ---------------------------------------------------------------------------------------------

// ScreenReadResult currency key -> profile.misc key (same keys the calculators read).
// HAMMERS are not in this map: they live in misc.forgeCalculator.hammers as a STRING and get
// their own dedicated {t:'forgeHammers'} row (built alongside the Forge Level row below).
const READ_CURRENCY_TO_MISC: Record<string, string> = {
    coin: 'coins', gem: 'gemCount', egg: 'eggshellCount',
    ticket: 'skillCalculatorTickets', clock: 'mountCalculatorWinders',
};
// Labels line up with the modal's CURRENCY_ICON map so the right sprite renders.
const READ_CURRENCY_LABEL: Record<string, string> = {
    coin: 'Coins', gem: 'Gems', egg: 'Eggshells',
    ticket: 'Skill Tickets', clock: 'Clock Winders',
};

/** Map reader Substats -> the DetSubstat shape the modal edits (statId / value / raw + evidence crop). */
function toDetSubstats(subs: Substat[]): DetSubstat[] {
    return subs.map(s => ({ statId: s.statId, value: s.value, raw: s.raw, cropUrl: s.cropUrl }));
}

/** Parse the item idx from a DetectedItem.itemKey ("age_slot_idx"); undefined if absent/unparsable. */
function idxFromItemKey(itemKey?: string): number | undefined {
    if (!itemKey) return undefined;
    const parts = itemKey.split('_');
    const n = parseInt(parts[parts.length - 1], 10);
    return Number.isNaN(n) ? undefined : n;
}

/** Dot-path read for nested misc keys ("forgeCalculator.hammers"). */
function getMiscPath(misc: UserProfile['misc'], path: string): unknown {
    return path.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), misc);
}

/** Diff ScreenReadResult[] (new template pipeline) against the profile into reviewable rows. */
export function buildChangesFromReads(results: ScreenReadResult[], profile: UserProfile): ChangeRow[] {
    const rows: ChangeRow[] = [];
    let n = 0;
    const seenCurrency = new Set<string>();
    const petSlotsTaken = new Set<number>();
    let seenForgeLevel = false, seenHammers = false;

    for (const res of results) {
        // --- items --- (always shown so the user can confirm the slot visually)
        if (res.item && (res.item.substats.length || res.item.mainStat)) {
            const d = res.item;
            const slot = d.slot || (d.mainStat?.kind === 'health' ? 'Helmet' : 'Weapon');
            const detected: Detected = {
                age: d.ageIdx, idx: idxFromItemKey(d.itemKey), level: d.level, stars: d.stars, name: d.name,
                substats: toDetSubstats(d.substats), mainKind: d.mainStat?.kind ?? null, ranged: d.mainStat?.ranged,
                levelCropUrl: d.levelCropUrl, mainCropUrl: d.mainStat?.cropUrl,
            };
            const confident = d.confidence >= 0.6;
            const patch = buildItemPatch(profile, slot, detected, confident);
            const newItem = (patch as { item: ItemSlot }).item;
            const cur = (profile.items as any)[slot] as ItemSlot | null;
            rows.push({
                id: `item-${n++}`, category: 'item',
                label: d.name || 'Item — confirm slot',
                detail: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                action: cur ? 'replace' : 'add', confidence: d.confidence,
                before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
                after: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                accepted: d.confidence >= ACCEPT_THRESHOLD,
                warnings: res.warnings, patch, cropUrl: d.cropUrl, slot, detected,
            });
        }
        // --- pets / mounts ---
        if (res.unit && res.unit.id != null && res.unit.id >= 0) {
            const d = res.unit;
            // Profile uses capitalized rarity everywhere (sprite mapping, pet/mount upgrade libs,
            // collection keys), so keep RARITY_NAMES capitalization — lowercasing breaks those lookups.
            const rarity = RARITY_NAMES[d.rarityIdx] ?? d.rarity ?? RARITY_NAMES[0];
            const id = d.id!; // guarded above (id != null && id >= 0)
            const secondaryStats = d.substats.filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value }));
            const detSubs = toDetSubstats(d.substats);
            if (d.kind === 'pet') {
                const key = `${rarity}_${id}`;
                const cur = (profile.pets.collection as any)[key] as PetSlot | null;
                const pet: PetSlot = {
                    rarity, id,
                    level: d.level ?? cur?.level ?? 1,
                    evolution: cur?.evolution ?? 0,
                    ascensionLevel: d.stars || cur?.ascensionLevel || 0,
                    secondaryStats,
                    customName: cur?.customName,
                    hp: cur?.hp,
                };
                const slotIndex = defaultPetSlot(profile.pets.active ?? [], pet, petSlotsTaken);
                const curSlot = (profile.pets.active ?? [])[slotIndex] ?? null;
                rows.push({
                    id: `pet-${n++}`, category: 'pet',
                    label: `Pet: ${d.name || key} (${rarity})`,
                    detail: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats)}`,
                    action: curSlot ? 'update' : 'add',
                    confidence: d.confidence,
                    before: curSlot ? `Lv.${curSlot.level} · ${substatSummary(curSlot.secondaryStats || [])}` : null,
                    after: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats || [])}`,
                    accepted: d.confidence >= ACCEPT_THRESHOLD,
                    warnings: res.warnings,
                    patch: { t: 'pet', key, slotIndex, pet },
                    cropUrl: d.cropUrl,
                    detected: {
                        rarity, id, level: d.level, stars: d.stars, substats: detSubs,
                        levelCropUrl: d.levelCropUrl, mainCropUrl: d.mainStat?.cropUrl,
                    },
                });
            } else {
                const cur = profile.mount.active;
                const mount: MountSlot = {
                    rarity, id,
                    level: d.level ?? cur?.level ?? 1,
                    evolution: cur?.evolution ?? 0,
                    ascensionLevel: d.stars || cur?.ascensionLevel || 0,
                    skills: cur?.skills ?? [],
                    secondaryStats,
                    customName: cur?.customName,
                    hp: cur?.hp,
                };
                rows.push({
                    id: `mount-${n++}`, category: 'mount',
                    label: `Mount: ${d.name || `${rarity} #${id}`}`,
                    detail: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats || [])}`,
                    action: cur ? 'replace' : 'add',
                    confidence: d.confidence,
                    before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats || [])}` : null,
                    after: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats || [])}`,
                    accepted: d.confidence >= ACCEPT_THRESHOLD,
                    warnings: res.warnings,
                    patch: { t: 'mount', mount },
                    cropUrl: d.cropUrl,
                    detected: {
                        rarity, id, level: d.level, stars: d.stars, substats: detSubs,
                        levelCropUrl: d.levelCropUrl, mainCropUrl: d.mainStat?.cropUrl,
                    },
                });
            }
        }
        // --- skills grid --- (skillId -> level + ascension stars; only rows that differ)
        if (res.skills && res.skills.length) {
            for (const sk of res.skills) {
                if (sk.level == null) continue;
                const cur = Number(profile.skills?.passives?.[sk.skillId] ?? 0);
                // per-skill ascension is stored on the SkillSlot (equipped / collection)
                const curAsc = profile.skills?.equipped?.find(s => s.id === sk.skillId)?.ascensionLevel
                    ?? profile.skills?.collection?.[sk.skillId]?.ascensionLevel ?? 0;
                const asc = sk.ascension ?? null;
                if (cur === sk.level && (asc === null || asc === curAsc)) continue;
                const star = (v: number) => v > 0 ? ` ★${v}` : '';
                rows.push({
                    id: `skill-${n++}`, category: 'skill',
                    label: splitCamel(sk.skillId),
                    detail: `Lv.${cur}${star(curAsc)} → Lv.${sk.level}${star(asc ?? curAsc)}`,
                    action: cur ? 'update' : 'add',
                    confidence: res.confidence || 0.5,
                    before: `Lv.${cur}${star(curAsc)}`,
                    after: `Lv.${sk.level}${star(asc ?? curAsc)}`,
                    accepted: (res.confidence ?? 0) >= ACCEPT_THRESHOLD,
                    warnings: [],
                    patch: { t: 'skill', skillId: sk.skillId, level: sk.level, ascension: asc },
                    cropUrl: sk.cropUrl,
                    detected: { level: sk.level, stars: asc ?? 0 },
                });
            }
        }
        // --- skin popup --- (only resolved skins become rows: idx is required to build a patch)
        if (res.skin && res.skin.skinIdx != null) {
            const d = res.skin;
            const skinIdx = res.skin.skinIdx;
            const slot = d.slot || TYPE_NAME_TO_SLOT[d.skinType ?? ''] || 'Helmet';
            const cur = (profile.items as any)[slot] as ItemSlot | null;
            const statsRec: Record<string, number> = {};
            for (const s of d.stats) statsRec[s.statType] = s.value;
            const skin = { idx: skinIdx, type: d.skinType, stats: statsRec };
            const warnings = [...res.warnings];
            if (!cur) warnings.push(`No ${slot} item in the profile — the skin is applied to the slot's item, sync the item first.`);
            rows.push({
                id: `skinEquip-${n++}`, category: 'skinEquip',
                label: `Skin: ${d.name || `${d.setId ?? ''} ${d.skinType ?? ''}`.trim() || `#${d.skinIdx}`}`,
                detail: skinSummary(skin),
                action: cur?.skin ? 'replace' : 'add',
                confidence: d.confidence,
                before: cur ? skinSummary(cur.skin) : null,
                after: skinSummary(skin),
                accepted: !!cur && d.confidence >= ACCEPT_THRESHOLD,
                warnings,
                patch: { t: 'skinEquip', slot, skin },
                cropUrl: d.cropUrl, slot,
                detected: { idx: d.skinIdx, name: d.name, setId: d.setId, skinType: d.skinType, skinStats: d.stats },
            });
        }
        // --- forge level / hammers / skill ascension --- (fixed-UI extras; only when read with
        // confidence AND changed; forge level + hammers come from ITEM screens only — the
        // readers never attempt them on pet/mount/skills screens)
        if (res.forgeLevel != null && !seenForgeLevel && res.forgeLevel !== profile.misc.forgeLevel) {
            seenForgeLevel = true;
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: 'Forge Level',
                detail: `${profile.misc.forgeLevel ?? 0} → ${res.forgeLevel}`,
                action: 'update',
                confidence: 0.9,
                before: String(profile.misc.forgeLevel ?? 0),
                after: String(res.forgeLevel),
                accepted: true,
                warnings: [],
                patch: { t: 'currency', miscKey: 'forgeLevel', value: res.forgeLevel },
                cropUrl: res.forgeLevelCropUrl,
            });
        }
        {
            const hammers = res.currencies?.hammer;
            const curHammers = Number(profile.misc.forgeCalculator?.hammers ?? 0);
            if (hammers != null && hammers >= 0 && !seenHammers && hammers !== curHammers) {
                seenHammers = true;
                rows.push({
                    id: `cur-${n++}`, category: 'currency',
                    label: 'Hammers',
                    detail: `${fmt(curHammers)} → ${fmt(hammers)}`,
                    action: 'update',
                    confidence: 0.9,
                    before: fmt(curHammers),
                    after: fmt(hammers),
                    accepted: true,
                    warnings: [],
                    patch: { t: 'forgeHammers', value: hammers },
                    cropUrl: res.currencyCrops?.hammer,
                });
            }
        }
        if (res.skillAscension != null && res.skillAscension !== (profile.misc.skillAscensionLevel ?? 0)) {
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: 'Skill Ascension',
                detail: `${profile.misc.skillAscensionLevel ?? 0} → ${res.skillAscension}`,
                action: 'update',
                confidence: 0.85,
                before: String(profile.misc.skillAscensionLevel ?? 0),
                after: String(res.skillAscension),
                accepted: true,
                warnings: [],
                patch: { t: 'currency', miscKey: 'skillAscensionLevel', value: res.skillAscension },
            });
        }
        // --- currencies ---
        for (const [ck, val] of Object.entries(res.currencies ?? {})) {
            if (val == null) continue;
            const miscKey = READ_CURRENCY_TO_MISC[ck];
            if (!miscKey || seenCurrency.has(miscKey)) continue;
            seenCurrency.add(miscKey);
            const cur = Number(getMiscPath(profile.misc, miscKey) ?? 0);
            if (cur === val) continue;
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: READ_CURRENCY_LABEL[ck] || ck,
                detail: `${fmt(cur)} → ${fmt(val)}`,
                action: 'update',
                confidence: 0.9,
                before: fmt(cur),
                after: fmt(val),
                accepted: true,
                warnings: [],
                patch: { t: 'currency', miscKey, value: val },
                cropUrl: res.currencyCrops?.[ck as keyof CurrencyCrops],
            });
        }
    }

    // --- clan tech tree --- (merged ACROSS screenshots: overlapping scroll shots re-read the
    // same nodes, so per-node reads are combined by majority level, ties broken by the best
    // icon-NCC confidence — the proto_clantree merge rules. One row per CHANGED node.)
    {
        interface TreeRead { level: number; conf: number; cropUrl?: string; max: number; globalId: number }
        const perNode: Record<string, TreeRead[]> = {};
        const potionReads: { value: number; cropUrl?: string }[] = [];
        for (const res of results) {
            if (!res.clanTree) continue;
            for (const nd of res.clanTree.nodes) {
                (perNode[nd.nodeType] ||= []).push({
                    level: nd.level, conf: nd.confidence, cropUrl: nd.cropUrl, max: nd.max, globalId: nd.globalId,
                });
            }
            if (res.clanTree.guildPotions != null) {
                potionReads.push({ value: res.clanTree.guildPotions, cropUrl: res.clanTree.potionCropUrl });
            }
        }
        const clanLevels = (profile.techTree?.Clan ?? {}) as Record<number, number>;
        for (const [nodeType, reads] of Object.entries(perNode)) {
            // majority level; tie -> the read with the best confidence wins
            const count: Record<number, number> = {};
            for (const r of reads) count[r.level] = (count[r.level] ?? 0) + 1;
            const tally = Object.entries(count).map(([l, c]) => [parseInt(l), c] as const)
                .sort((a, b) => b[1] - a[1]);
            let level = tally[0][0];
            if (tally.length > 1 && tally[0][1] === tally[1][1]) {
                level = reads.reduce((b, r) => (r.conf > b.conf ? r : b)).level;
            }
            const best = reads.filter(r => r.level === level).reduce((b, r) => (r.conf > b.conf ? r : b));
            const cur = Number(clanLevels[best.globalId] ?? 0);
            if (cur === level) continue;
            rows.push({
                id: `clanTree-${n++}`, category: 'clanTree',
                label: getTechNodeName(nodeType),
                detail: `Lv ${cur} → ${level}`,
                action: cur > 0 ? 'update' : 'add',
                confidence: best.conf,
                before: `Lv ${cur}`,
                after: `Lv ${level}`,
                accepted: best.conf >= ACCEPT_THRESHOLD,
                warnings: [],
                patch: { t: 'clanTree', globalId: best.globalId, nodeType, level, max: best.max },
                cropUrl: best.cropUrl,
                detected: { level },
            });
        }
        // guild potions -> Resources row (misc.guildPotions), merged by majority across shots
        if (potionReads.length && !seenCurrency.has('guildPotions')) {
            const count: Record<number, number> = {};
            for (const r of potionReads) count[r.value] = (count[r.value] ?? 0) + 1;
            const value = Object.entries(count).map(([v, c]) => [parseInt(v), c] as const)
                .sort((a, b) => b[1] - a[1])[0][0];
            const cur = Number((profile.misc as any).guildPotions ?? 0);
            if (cur !== value) {
                seenCurrency.add('guildPotions');
                rows.push({
                    id: `cur-${n++}`, category: 'currency',
                    label: 'Guild Potions',
                    detail: `${fmt(cur)} → ${fmt(value)}`,
                    action: 'update',
                    confidence: 0.9,
                    before: fmt(cur),
                    after: fmt(value),
                    accepted: true,
                    warnings: [],
                    patch: { t: 'currency', miscKey: 'guildPotions', value },
                    cropUrl: potionReads.find(r => r.value === value)?.cropUrl,
                });
            }
        }
    }

    // sort: items, skins, pets, mounts, skills, clan tree, currencies; highest-confidence first
    // within a group (clan-tree rows in tree order so the list mirrors the in-game layout)
    const order = { item: 0, skinEquip: 1, pet: 2, mount: 3, skill: 4, clanTree: 5, currency: 6 };
    rows.sort((a, b) => order[a.category] - order[b.category]
        || (a.category === 'clanTree' && b.category === 'clanTree' && a.patch.t === 'clanTree' && b.patch.t === 'clanTree'
            ? a.patch.globalId - b.patch.globalId
            : b.confidence - a.confidence));
    return rows;
}

/** Build the updateProfile payload from the accepted rows. */
export function applyChanges(profile: UserProfile, rows: ChangeRow[]): Partial<UserProfile> {
    const accepted = rows.filter(r => r.accepted);
    const items = { ...profile.items };
    const collection = { ...profile.pets.collection };
    const activePets: (PetSlot | null)[] = [...(profile.pets.active ?? [])];
    let mount = profile.mount.active;
    const misc: any = { ...profile.misc };
    const passives: Record<string, number> = { ...(profile.skills?.passives || {}) };
    let equipped = [...(profile.skills?.equipped || [])];
    const skillCollection = { ...(profile.skills?.collection || {}) };
    const clanLevels: Record<number, number> = {};
    let touchedItems = false, touchedPets = false, touchedMount = false, touchedMisc = false, touchedSkills = false, touchedTree = false;

    for (const r of accepted) {
        const p = r.patch;
        if (p.t === 'item') { (items as any)[p.slot] = p.item; touchedItems = true; }
        else if (p.t === 'pet') {
            // SLOT-addressed: the row's slotIndex (user-editable in the modal) says which of the
            // MAX_ACTIVE_PETS active slots this pet occupies; duplicates of the same identity in
            // different slots are legal. The collection keeps the per-identity bookkeeping.
            collection[p.key] = p.pet;
            const slot = Math.max(0, Math.min(MAX_ACTIVE_PETS - 1, p.slotIndex ?? 0));
            while (activePets.length <= slot) activePets.push(null);
            activePets[slot] = p.pet;
            touchedPets = true;
        }
        else if (p.t === 'mount') { mount = p.mount; touchedMount = true; }
        else if (p.t === 'currency') {
            // dot-path keys address nested misc fields (stored as STRINGS there)
            if (p.miscKey.includes('.')) {
                const [a, b] = p.miscKey.split('.');
                misc[a] = { ...(misc[a] ?? {}), [b]: String(p.value) };
            } else {
                misc[p.miscKey] = p.value;
            }
            touchedMisc = true;
        }
        else if (p.t === 'forgeHammers') {
            // hammers live in misc.forgeCalculator.hammers AS A STRING (ResourcesEditor contract)
            misc.forgeCalculator = { ...(misc.forgeCalculator ?? {}), hammers: String(p.value) };
            touchedMisc = true;
        }
        else if (p.t === 'skill') {
            passives[p.skillId] = p.level;
            if (p.ascension != null) {
                // per-skill ascension lives on the SkillSlot: mirror it into the equipped slot
                // (what SkillPanel/SkillSelectorModal read) and the collection entry if present.
                equipped = equipped.map(s => s.id === p.skillId
                    ? { ...s, level: Math.max(1, p.level), ascensionLevel: p.ascension! } : s);
                if (skillCollection[p.skillId]) {
                    skillCollection[p.skillId] = { ...skillCollection[p.skillId], ascensionLevel: p.ascension! };
                }
            }
            touchedSkills = true;
        }
        else if (p.t === 'clanTree') {
            // clamp to the library MaxLevel (the modal input is clamped too — belt & braces)
            clanLevels[p.globalId] = Math.max(0, Math.min(p.max || p.level, p.level));
            touchedTree = true;
        }
        else if (p.t === 'skinEquip') {
            // Skins live ON the slot's item — apply only when the slot has one (an 'item' patch
            // accepted in the same run counts, since `items` is updated in row order above).
            const cur = (items as any)[p.slot] as ItemSlot | null;
            if (cur) { (items as any)[p.slot] = { ...cur, skin: p.skin }; touchedItems = true; }
        }
    }

    const out: Partial<UserProfile> = {};
    if (touchedItems) out.items = items;
    if (touchedPets) out.pets = { ...profile.pets, collection, active: activePets.filter((s): s is PetSlot => !!s).slice(0, MAX_ACTIVE_PETS) };
    if (touchedMount) out.mount = { ...profile.mount, active: mount };
    if (touchedMisc) out.misc = misc;
    // skills store per-skill levels in `passives` ({ skillId -> level }); same key the Skills panel
    // edits. equipped/collection carry the per-skill ascensionLevel the selector modal reads.
    if (touchedSkills) out.skills = { ...profile.skills, passives, equipped, collection: skillCollection };
    // clan tree levels: a NEW techTree object so ProfileContext.updateProfile stamps techTreeUpdatedAt
    if (touchedTree) {
        out.techTree = {
            ...profile.techTree,
            Clan: { ...(profile.techTree?.Clan ?? {}), ...clanLevels },
        };
    }
    return out;
}

export interface AutoSyncProgress { fileIndex: number; total: number; status?: string; ocrProgress?: number; }

/** Run OCR over the uploaded files, reporting progress, and return per-file extractions. */
export async function runAutoSync(
    files: (Blob | string)[],
    dicts: GameDictionaries,
    onProgress?: (p: AutoSyncProgress) => void,
): Promise<ScreenExtraction[]> {
    const out: ScreenExtraction[] = [];
    setOcrProgress(pr => onProgress?.({ fileIndex: out.length, total: files.length, status: pr.status, ocrProgress: pr.progress }));
    try {
        for (let i = 0; i < files.length; i++) {
            out.push(await extractScreenshot(files[i], dicts));
            onProgress?.({ fileIndex: i + 1, total: files.length });
        }
    } finally {
        setOcrProgress(null);
    }
    return out;
}

/**
 * New template-pipeline entry point. Reads the uploaded files with autoSyncPipeline.readScreenshots
 * (reporting per-file + per-OCR progress), then diffs them into reviewable ChangeRow[].
 */
export async function runAutoSyncV2(
    files: File[],
    dicts: GameDictionaries,
    profile: UserProfile,
    onProgress?: (p: AutoSyncProgress) => void,
): Promise<{ rows: ChangeRow[]; results: ScreenReadResult[] }> {
    let done = 0;
    // Sub-file OCR progress (worker load / recognise) flows through the global hook, tagged with
    // the count of files already finished so the modal's progress bar advances smoothly.
    setOcrProgress(pr => onProgress?.({ fileIndex: done, total: files.length, status: pr.status, ocrProgress: pr.progress }));
    try {
        const results = await readScreenshots(files, dicts, (d, total) => {
            done = d;
            onProgress?.({ fileIndex: d, total });
        });
        const rows = buildChangesFromReads(results, profile);
        return { rows, results };
    } finally {
        setOcrProgress(null);
    }
}
