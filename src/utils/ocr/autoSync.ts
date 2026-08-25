// AutoSync orchestration: run OCR over uploaded screenshots, diff the results against the
// current profile, and produce reviewable change rows. Nothing is applied until the user
// accepts rows in the diff modal (applyChanges builds the updateProfile payload).

import type { UserProfile, ItemSlot, PetSlot, MountSlot } from '../../types/Profile';
import { extractScreenshot, type ScreenExtraction, type DetItem, type DetUnit, type DetSubstat } from './extract';
import { readScreenshots } from './autoSyncPipeline';
import type { ScreenReadResult, Substat, CurrencyCrops, ForgeAscensionRead } from './readerTypes';
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
    /** Name to give the auto-saved preset/bookmark (see planPresetSaves). Undefined = no preset. */
    presetName?: string;
}

/**
 * A preset/bookmark that applying the accepted rows would ADD (never a duplicate, never an
 * overwrite). Used by the diff UI to warn "will also save to presets" BEFORE applying, and by
 * applyChanges to actually write them. Only the three collections the app already has a
 * "saved preset" concept for: savedItems[slot], pets.savedBuilds, mount.savedBuilds.
 * Skins live ON an item, so a skin change saves the item (skin included) to savedItems.
 */
export interface PresetSave {
    kind: 'item' | 'pet' | 'mount';
    slot?: string;      // items only: the target equipment slot
    key?: string;       // pets only: the `${rarity}_${id}` collection key
    name: string;       // customName written on the preset
    rowIds: string[];   // rows that produced it (so the UI can badge them)
}

/** Preset identity checks — the SAME fuzzy match the panels use, so we never duplicate their rows. */
const sameSavedItem = (a: ItemSlot, b: ItemSlot) =>
    a.age === b.age && a.idx === b.idx && a.level === b.level &&
    JSON.stringify(a.secondaryStats) === JSON.stringify(b.secondaryStats);
const sameSavedUnit = (a: { id: number; rarity: string; level: number; secondaryStats?: any }, b: { id: number; rarity: string; level: number; secondaryStats?: any }) =>
    a.id === b.id && a.rarity === b.rarity && a.level === b.level &&
    JSON.stringify(a.secondaryStats) === JSON.stringify(b.secondaryStats);

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
        skin: existing?.skin, // OCR doesn't read skins here. Keep whatever is already set
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
                label: d.name || 'Item. Confirm slot',
                detail: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                action: cur ? 'replace' : 'add', confidence: d.confidence,
                before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
                after: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                accepted: d.confidence >= ACCEPT_THRESHOLD,
                warnings: ex.warnings, patch, cropUrl: d.cropUrl, slot, detected,
                presetName: d.name || undefined,
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
                    presetName: d.name || `${d.rarity} Pet #${d.id}`,
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
                    presetName: d.name || `${d.rarity} Mount #${d.id}`,
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

/** One numeric read of the same field from one screenshot, with the crop it came from. */
interface NumRead { value: number; cropUrl?: string }

/**
 * Consensus over repeated reads of ONE field across a batch of screenshots: the modal value, with
 * the agreement and the crop of a screenshot that voted for it. Ties go to the LAST reader in the
 * list — for a counter like hammers the later screenshot is the more recent state, and for a level
 * the two candidates are adjacent anyway. Returns null for an empty list.
 */
function mergeByMajority(reads: NumRead[]): { value: number; agree: number; votes: number; cropUrl?: string } | null {
    if (!reads.length) return null;
    const tally = new Map<number, number>();
    for (const r of reads) tally.set(r.value, (tally.get(r.value) ?? 0) + 1);
    let value = reads[reads.length - 1].value, agree = 0;
    for (const [v, c] of tally) if (c > agree || (c === agree && v === reads[reads.length - 1].value)) { value = v; agree = c; }
    const src = reads.filter(r => r.value === value).find(r => r.cropUrl) ?? reads.find(r => r.value === value);
    return { value, agree, votes: reads.length, cropUrl: src?.cropUrl };
}

/** "★★" / "none" — how an ascension count reads in a diff row. */
function starText(n: number): string { return n > 0 ? '★'.repeat(n) : 'none'; }

/** Agreement below this means the item tiles disagreed badly: present the value as one to check,
 *  never as a confident reading. A single tile (one item popup) has agreement 1 by construction —
 *  the vote COUNT is what discounts it, through VOTE_WEIGHT. */
const FORGE_AGREE_OK = 0.7;
/** Confidence multiplier by how many item tiles voted (1 tile = one item popup; 3+ = a full card). */
const VOTE_WEIGHT: Record<number, number> = { 1: 0.7, 2: 0.85 };
/** A reading taken off a player profile card can never exceed this: the classifier cannot tell the
 *  user's own card from an opponent's, so the value is a suggestion to confirm, not a reading. */
const FORGE_SOFT_MAX_CONF = 0.35;

/** A read taken from a popup on a player profile card cannot say whose card it is (the frame has
 *  no currency header — see ClassifyResult.authoritative). Such a row is offered with this warning
 *  and never pre-accepted, exactly like the forge-ascension lattice read. */
const CARD_READ_WARNING = 'Read from a detail popup on a player profile card. The reader cannot tell '
    + 'your own card from an opponent\'s. Confirm this is yours before accepting.';
/** Whether one screenshot's subject may be pre-accepted at all. */
const mayAccept = (res: ScreenReadResult): boolean => res.authoritative !== false;
/** A profile-card read can never exceed this confidence — the same ceiling the forge-ascension
 *  lattice read uses. Without it the row renders as a certainty the reader cannot back: the name
 *  and stats may be read perfectly and still belong to somebody else's account. */
const CARD_MAX_CONF = 0.35;
const cardConf = (res: ScreenReadResult, conf: number): number =>
    res.authoritative === false ? Math.min(conf, CARD_MAX_CONF) : conf;
/** `res.warnings` plus the profile-card caveat when the read was not authoritative. */
const withCardWarning = (res: ScreenReadResult, extra: string[] = []): string[] =>
    res.authoritative === false ? [...res.warnings, ...extra, CARD_READ_WARNING] : [...res.warnings, ...extra];

/** Diff ScreenReadResult[] (new template pipeline) against the profile into reviewable rows. */
export function buildChangesFromReads(results: ScreenReadResult[], profile: UserProfile): ChangeRow[] {
    const rows: ChangeRow[] = [];
    let n = 0;
    const seenCurrency = new Set<string>();
    const petSlotsTaken = new Set<number>();
    // Cross-screenshot reads, merged by consensus after the loop (see mergeByMajority / the forge
    // ascension block). Never first-wins: a batch of item popups re-reads the same forge row on
    // every shot, and one bad OCR pass must not be able to outvote the rest.
    const forgeLevelReads: NumRead[] = [];
    const hammerReads: NumRead[] = [];
    const forgeAscReads: ForgeAscensionRead[] = [];

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
                label: d.name || 'Item. Confirm slot',
                detail: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                action: cur ? 'replace' : 'add', confidence: cardConf(res, d.confidence),
                before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
                after: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
                accepted: mayAccept(res) && d.confidence >= ACCEPT_THRESHOLD,
                warnings: withCardWarning(res), patch, cropUrl: d.cropUrl, slot, detected,
                presetName: d.name || undefined,
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
                    confidence: cardConf(res, d.confidence),
                    before: curSlot ? `Lv.${curSlot.level} · ${substatSummary(curSlot.secondaryStats || [])}` : null,
                    after: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats || [])}`,
                    accepted: mayAccept(res) && d.confidence >= ACCEPT_THRESHOLD,
                    warnings: withCardWarning(res),
                    patch: { t: 'pet', key, slotIndex, pet },
                    cropUrl: d.cropUrl,
                    detected: {
                        rarity, id, level: d.level, stars: d.stars, substats: detSubs,
                        levelCropUrl: d.levelCropUrl, mainCropUrl: d.mainStat?.cropUrl,
                    },
                    presetName: d.name || `${rarity} Pet #${id}`,
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
                    confidence: cardConf(res, d.confidence),
                    before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats || [])}` : null,
                    after: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats || [])}`,
                    accepted: mayAccept(res) && d.confidence >= ACCEPT_THRESHOLD,
                    warnings: withCardWarning(res),
                    patch: { t: 'mount', mount },
                    cropUrl: d.cropUrl,
                    detected: {
                        rarity, id, level: d.level, stars: d.stars, substats: detSubs,
                        levelCropUrl: d.levelCropUrl, mainCropUrl: d.mainStat?.cropUrl,
                    },
                    presetName: d.name || `${rarity} Mount #${id}`,
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
                    // NEVER empty: a nameless diff row is unreviewable. splitCamel can return ''
                    // for an odd/blank skillId, so fall back to the raw id and then to 'Skill'.
                    label: splitCamel(sk.skillId) || sk.skillId || 'Skill',
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
            const extra: string[] = [];
            if (!cur) extra.push(`No ${slot} item in the profile. The skin is applied to the slot's item, sync the item first.`);
            rows.push({
                id: `skinEquip-${n++}`, category: 'skinEquip',
                label: `Skin: ${d.name || `${d.setId ?? ''} ${d.skinType ?? ''}`.trim() || `#${d.skinIdx}`}`,
                detail: skinSummary(skin),
                action: cur?.skin ? 'replace' : 'add',
                confidence: cardConf(res, d.confidence),
                before: cur ? skinSummary(cur.skin) : null,
                after: skinSummary(skin),
                accepted: mayAccept(res) && !!cur && d.confidence >= ACCEPT_THRESHOLD,
                warnings: withCardWarning(res, extra),
                patch: { t: 'skinEquip', slot, skin },
                cropUrl: d.cropUrl, slot,
                // `stars` is the FORGE ascension read off the skin tile — read-only evidence on this
                // row (a skin has no ascension field of its own, exactly like an item), and a vote in
                // the Forge Ascension row below. It is SET ONLY WHEN READ: null/undefined means the
                // tile was not found, and an absent `stars` is how the modal knows not to claim a
                // reading. Never `?? 0` — that would turn "unread" into "this forge has no stars".
                detected: {
                    idx: d.skinIdx, name: d.name, setId: d.setId, skinType: d.skinType, skinStats: d.stats,
                    ...(d.stars != null ? { stars: d.stars } : {}),
                },
                // skins have no preset collection of their own — they live ON the slot's item, so
                // the bookmark is the item WITH the skin, named after the skin that was applied.
                presetName: `${d.name || d.setId || `Skin #${skinIdx}`} skin`,
            });
        }
        // --- forge level / hammers --- collected here, decided AFTER the loop by majority: a batch
        // of item popups shows the same forge button and the same hammer pill on every shot, so
        // "the first screenshot that read something wins" threw seven confirmations away. Both
        // still come from ITEM screens ONLY — readForgeLevel is called for type==='item' and
        // SCREEN_CURR.item is the only entry listing 'hammer' (owner's explicit requirement).
        if (res.forgeLevel != null) forgeLevelReads.push({ value: res.forgeLevel, cropUrl: res.forgeLevelCropUrl });
        if (res.currencies?.hammer != null && res.currencies.hammer >= 0) {
            hammerReads.push({ value: res.currencies.hammer, cropUrl: res.currencyCrops?.hammer });
        }
        if (res.forgeAscension) forgeAscReads.push(res.forgeAscension);
        // A SKIN popup's tile carries the same 0..3 forge pips every item/pet/mount tile does, and
        // the skin tile is the one place a 3-star example is legible, so it votes in the same
        // consensus. Three guards, each closing a way to fabricate a value:
        //  - `stars != null`: a tile that was never found must not vote 0 ("no ascension" is a
        //    reading, and claiming it from nothing is the failure this feature refuses to ship);
        //  - `skinIdx != null`: only a read that RESOLVED to a real skin is evidence about the
        //    forge. A pet popup mistaken for a skin popup would otherwise feed the PET's own
        //    ascension into the forge's — the exact confusion readForgeAscension refuses screens
        //    for — and an unresolved read is precisely the one we cannot vouch for;
        //  - authority follows the screenshot: a skin popup on the user's own equipment screen is
        //    authoritative, one on somebody's profile card is not.
        if (res.skin?.stars != null && res.skin.tile && res.skin.skinIdx != null) {
            const s = res.skin.stars, tile = res.skin.tile;
            forgeAscReads.push({
                value: s, votes: 1, agree: 1, agreement: 1, tally: { [s]: 1 },
                authoritative: res.authoritative !== false,
                source: 'popup', tiles: [{ rect: tile, stars: s, row: 0, col: 0 }],
                tileW: tile.w, rows: 1, cols: 1, cropUrl: res.skin.cropUrl,
            });
        }
        // --- skill ascension ---
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

    // --- forge level + hammers --- one row each, decided by majority across the ITEM screenshots.
    {
        const fl = mergeByMajority(forgeLevelReads);
        if (fl && fl.value !== profile.misc.forgeLevel) {
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: 'Forge Level',
                detail: `${profile.misc.forgeLevel ?? 0} → ${fl.value}`,
                action: 'update',
                confidence: fl.votes > 1 ? Math.max(0.5, fl.agree / fl.votes) * 0.95 : 0.9,
                before: String(profile.misc.forgeLevel ?? 0),
                after: fl.votes > 1 ? `${fl.value} (${fl.agree}/${fl.votes})` : String(fl.value),
                accepted: true,
                warnings: fl.agree < fl.votes
                    ? [`The ${fl.votes} item screenshots did not agree on the forge level; ${fl.agree} of them read ${fl.value}.`]
                    : [],
                patch: { t: 'currency', miscKey: 'forgeLevel', value: fl.value },
                cropUrl: fl.cropUrl,
            });
        }
        const hm = mergeByMajority(hammerReads);
        const curHammers = Number(profile.misc.forgeCalculator?.hammers ?? 0);
        if (hm && hm.value !== curHammers) {
            rows.push({
                id: `cur-${n++}`, category: 'currency',
                label: 'Hammers',
                detail: `${fmt(curHammers)} → ${fmt(hm.value)}`,
                action: 'update',
                confidence: hm.votes > 1 ? Math.max(0.5, hm.agree / hm.votes) * 0.95 : 0.9,
                before: fmt(curHammers),
                after: hm.votes > 1 ? `${fmt(hm.value)} (${hm.agree}/${hm.votes})` : fmt(hm.value),
                accepted: true,
                warnings: hm.agree < hm.votes
                    ? [`The ${hm.votes} item screenshots did not agree on the hammer count; ${hm.agree} of them read ${fmt(hm.value)}.`]
                    : [],
                patch: { t: 'forgeHammers', value: hm.value },
                cropUrl: hm.cropUrl,
            });
        }
    }

    // --- forge ascension --- ONE row, from the stars on the ITEM TILES across every screenshot.
    //
    // The ascension shared between items IS the forge's ascension (owner's rule) and it is read
    // from the item tiles, never from the anvil sprite. Every equipped item carries the same stars,
    // so this is a CONSENSUS: pool every item tile every screenshot exposed, take the modal star
    // count, and report the agreement. One misread tile cannot move the answer, and a badly split
    // vote is surfaced as a value to check instead of a reading to trust.
    //
    // AUTHORITY, not just confidence: only 'item' screens (the user's own item popup) are
    // authoritative. A player profile card shows all 8 item tiles at once and is the only place
    // 2- and 3-star examples appear, but the classifier cannot tell the user's own card from an
    // opponent's — so those votes are used ONLY when no item screenshot contributed, and then
    // never above FORGE_SOFT_MAX_CONF and never pre-accepted.
    {
        const hard = forgeAscReads.filter(r => r.authoritative);
        const use = hard.length ? hard : forgeAscReads;
        const stars: number[] = [];
        for (const r of use) for (const t of r.tiles) stars.push(t.stars);
        if (stars.length) {
            const authoritative = hard.length > 0;
            const tally: Record<number, number> = {};
            for (const s of stars) tally[s] = (tally[s] ?? 0) + 1;
            // modal value; a tie goes to the LOWER count — the one failure mode measured on real
            // screenshots is a phantom star (the hole in a "0" of "Lv.102" on a gold Divine tile),
            // which can only ever add one. A tie also puts agreement at <= 0.5, so the row is
            // marked "check" regardless of which way it broke.
            const ranked = Object.entries(tally).map(([v, c]) => [Number(v), c] as const)
                .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
            const value = ranked[0][0], agree = ranked[0][1];
            const agreement = agree / stars.length;
            const solid = agreement >= FORGE_AGREE_OK;
            let confidence = agreement * (VOTE_WEIGHT[stars.length] ?? 1) * 0.95;
            if (!authoritative) confidence = Math.min(confidence, FORGE_SOFT_MAX_CONF);
            const cur = profile.misc.forgeAscensionLevel ?? 0;

            if (value !== cur) {
                const warnings: string[] = [];
                if (!authoritative) {
                    warnings.push('Read from the item tiles of a player profile card. The reader cannot tell '
                        + 'your own card from an opponent\'s. Confirm this is your forge before accepting.');
                }
                if (!solid) {
                    warnings.push(`The item tiles disagreed: ${ranked.map(([v, c]) => `${c}x${starText(v)}`).join(', ')}. `
                        + 'Check the crop before accepting.');
                }
                // The compact resource row renders label / crop / "before -> after" and nothing
                // else, so the reason to check has to live in `after` to be seen at all.
                const note = !authoritative ? 'card. Check' : solid ? `${agree}/${stars.length} tiles` : `${agree}/${stars.length}. Check`;
                rows.push({
                    id: `cur-${n++}`, category: 'currency',
                    label: 'Forge Ascension',
                    detail: `${starText(cur)} → ${starText(value)} (${note})`,
                    action: 'update',
                    confidence,
                    before: starText(cur),
                    after: `${starText(value)} (${note})`,
                    accepted: authoritative && solid && confidence >= ACCEPT_THRESHOLD,
                    warnings,
                    patch: { t: 'currency', miscKey: 'forgeAscensionLevel', value },
                    // `detected.stars` is what makes this row EDITABLE as a 0-3 picker in the modal
                    // (AutoSyncModal.rowAscension already falls back to it), which is where an
                    // ascension read off an item / skin tile belongs: the forge has one ascension,
                    // the tiles only show it. Set even when it equals 0 — this is a real reading.
                    detected: { stars: value },
                    // show a screenshot whose OWN reading was the consensus, so the crop can never
                    // contradict the number next to it
                    cropUrl: (use.find(r => r.value === value)
                        ?? use.find(r => r.tiles.some(t => t.stars === value)))?.cropUrl,
                });
            }
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
                label: getTechNodeName(nodeType) || splitCamel(nodeType) || `Node #${best.globalId}`,
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

/**
 * End state the accepted rows resolve to, BEFORE presets are considered. Split out of
 * applyChanges so planPresetSaves can predict the exact same objects the apply will write
 * (item + skinEquip rows on one slot merge into a single final item, etc.).
 */
interface Resolved {
    items: UserProfile['items'];
    collection: Record<string, PetSlot>;
    activePets: (PetSlot | null)[];
    mount: MountSlot | null;
    misc: any;
    passives: Record<string, number>;
    equipped: UserProfile['skills']['equipped'];
    skillCollection: UserProfile['skills']['collection'];
    clanLevels: Record<number, number>;
    touched: { items: boolean; pets: boolean; mount: boolean; misc: boolean; skills: boolean; tree: boolean };
    /** Which slots/identities the accepted rows produced, with the rows that produced them. */
    itemTargets: Map<string, { name?: string; rowIds: string[] }>;
    petTargets: Map<string, { name?: string; rowIds: string[] }>;
    mountTarget: { name?: string; rowIds: string[] } | null;
}

function noteTarget(m: Map<string, { name?: string; rowIds: string[] }>, key: string, r: ChangeRow) {
    const e = m.get(key) ?? { name: undefined, rowIds: [] };
    e.rowIds.push(r.id);
    e.name = e.name ?? r.presetName;
    m.set(key, e);
}

function resolveChanges(profile: UserProfile, rows: ChangeRow[]): Resolved {
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
    const itemTargets = new Map<string, { name?: string; rowIds: string[] }>();
    const petTargets = new Map<string, { name?: string; rowIds: string[] }>();
    const mountTargets = new Map<string, { name?: string; rowIds: string[] }>(); // single 'mount' key

    for (const r of accepted) {
        const p = r.patch;
        if (p.t === 'item') { (items as any)[p.slot] = p.item; touchedItems = true; noteTarget(itemTargets, p.slot, r); }
        else if (p.t === 'pet') {
            // SLOT-addressed: the row's slotIndex (user-editable in the modal) says which of the
            // MAX_ACTIVE_PETS active slots this pet occupies; duplicates of the same identity in
            // different slots are legal. The collection keeps the per-identity bookkeeping.
            collection[p.key] = p.pet;
            const slot = Math.max(0, Math.min(MAX_ACTIVE_PETS - 1, p.slotIndex ?? 0));
            while (activePets.length <= slot) activePets.push(null);
            activePets[slot] = p.pet;
            touchedPets = true;
            noteTarget(petTargets, p.key, r);
        }
        else if (p.t === 'mount') {
            mount = p.mount; touchedMount = true;
            noteTarget(mountTargets, 'mount', r);
        }
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
            if (cur) {
                (items as any)[p.slot] = { ...cur, skin: p.skin };
                touchedItems = true;
                noteTarget(itemTargets, p.slot, r);
            }
        }
    }

    return {
        items, collection, activePets, mount, misc, passives, equipped, skillCollection, clanLevels,
        touched: { items: touchedItems, pets: touchedPets, mount: touchedMount, misc: touchedMisc, skills: touchedSkills, tree: touchedTree },
        itemTargets, petTargets, mountTarget: mountTargets.get('mount') ?? null,
    };
}

/**
 * Presets the accepted rows would ADD. Never overwrites and never duplicates: an identity that
 * already sits in the collection (same fuzzy match the panels use) is skipped, so re-syncing the
 * same screenshot twice adds nothing the second time.
 */
function planFromResolved(profile: UserProfile, res: Resolved): PresetSave[] {
    const out: PresetSave[] = [];

    for (const [slot, meta] of res.itemTargets) {
        const item = (res.items as any)[slot] as ItemSlot | null;
        if (!item) continue;
        const existing = profile.savedItems?.[slot] ?? [];
        if (existing.some(s => sameSavedItem(s, item))) continue;
        out.push({ kind: 'item', slot, name: meta.name || `${slot} Lv.${item.level}`, rowIds: meta.rowIds });
    }

    const petBuilds = profile.pets?.savedBuilds ?? [];
    for (const [key, meta] of res.petTargets) {
        const pet = res.collection[key];
        if (!pet) continue;
        if (petBuilds.some(s => sameSavedUnit(s, pet))) continue;
        out.push({ kind: 'pet', key, name: meta.name || `Pet #${pet.id}`, rowIds: meta.rowIds });
    }

    if (res.mountTarget && res.mount) {
        const mountBuilds = profile.mount?.savedBuilds ?? [];
        if (!mountBuilds.some(s => sameSavedUnit(s, res.mount!))) {
            out.push({ kind: 'mount', name: res.mountTarget.name || `Mount #${res.mount.id}`, rowIds: res.mountTarget.rowIds });
        }
    }
    return out;
}

/**
 * What applying the accepted rows would ALSO bookmark. Pure — the diff UI calls it to show the
 * "will also save to presets" note before the user commits.
 */
export function planPresetSaves(profile: UserProfile, rows: ChangeRow[]): PresetSave[] {
    return planFromResolved(profile, resolveChanges(profile, rows));
}

/**
 * Build the updateProfile payload from the accepted rows.
 * With `savePresets` (default on) the applied objects are ALSO appended to the collections the
 * app already treats as bookmarks — savedItems[slot], pets.savedBuilds, mount.savedBuilds —
 * skipping anything already saved. planPresetSaves() previews exactly these writes.
 */
export function applyChanges(
    profile: UserProfile,
    rows: ChangeRow[],
    opts: { savePresets?: boolean } = {},
): Partial<UserProfile> {
    const savePresets = opts.savePresets !== false;
    const res = resolveChanges(profile, rows);
    const { touched } = res;
    const presets = savePresets ? planFromResolved(profile, res) : [];

    const out: Partial<UserProfile> = {};
    if (touched.items) out.items = res.items;
    if (touched.pets) out.pets = { ...profile.pets, collection: res.collection, active: res.activePets.filter((s): s is PetSlot => !!s).slice(0, MAX_ACTIVE_PETS) };
    if (touched.mount) out.mount = { ...profile.mount, active: res.mount };
    if (touched.misc) out.misc = res.misc;
    // skills store per-skill levels in `passives` ({ skillId -> level }); same key the Skills panel
    // edits. equipped/collection carry the per-skill ascensionLevel the selector modal reads.
    if (touched.skills) out.skills = { ...profile.skills, passives: res.passives, equipped: res.equipped, collection: res.skillCollection };
    // clan tree levels: a NEW techTree object so ProfileContext.updateProfile stamps techTreeUpdatedAt
    if (touched.tree) {
        out.techTree = {
            ...profile.techTree,
            Clan: { ...(profile.techTree?.Clan ?? {}), ...res.clanLevels },
        };
    }

    // --- presets / bookmarks --- (append-only; same shapes EquipmentPanel / PetPanel / MountPanel write)
    const itemPresets = presets.filter(p => p.kind === 'item');
    if (itemPresets.length) {
        const savedItems: UserProfile['savedItems'] = { ...(profile.savedItems ?? {}) };
        for (const p of itemPresets) {
            const item = (res.items as any)[p.slot!] as ItemSlot;
            savedItems[p.slot!] = [...(savedItems[p.slot!] ?? []), { ...item, customName: p.name }];
        }
        out.savedItems = savedItems;
    }
    const petPresets = presets.filter(p => p.kind === 'pet');
    if (petPresets.length) {
        const added: PetSlot[] = [];
        for (const p of petPresets) {
            const pet = p.key ? res.collection[p.key] : undefined;
            if (pet) added.push({ ...pet, customName: p.name });
        }
        out.pets = { ...(out.pets ?? profile.pets), savedBuilds: [...(profile.pets?.savedBuilds ?? []), ...added] };
    }
    const mountPreset = presets.find(p => p.kind === 'mount');
    if (mountPreset && res.mount) {
        out.mount = {
            ...(out.mount ?? profile.mount),
            savedBuilds: [...(profile.mount?.savedBuilds ?? []), { ...res.mount, customName: mountPreset.name }],
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
