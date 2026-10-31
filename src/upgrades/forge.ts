/**
 * Forge Check: does a drop beat the equipped item, and what is worth keeping an eye out for.
 * The pure half: item variants, the verdict and the filter guide. Kept free of React so the
 * thresholds are testable.
 */
import type { ItemSlot, UserProfile } from '../types/Profile';
import { SLOT_TO_JSON_TYPE } from '../utils/itemCalculations';

export type ItemSlotKey = keyof UserProfile['items'];
export const ITEM_SLOTS: ItemSlotKey[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

/** A substat that can roll on gear, with its roll range in percent. */
export interface SubstatDef { id: string; min: number; max: number }

const round2 = (x: number) => Math.round(x * 100) / 100;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function substatDefs(secondaryStatLibrary: any): SubstatDef[] {
    return Object.values<any>(secondaryStatLibrary ?? {})
        .filter(s => (s?.UpperRange ?? 0) > 0)
        .map(s => ({ id: s.Stat as string, min: round2(s.LowerRange * 100), max: round2(s.UpperRange * 100) }));
}

/** How many substats an item of this age rolls (SecondaryStatItemUnlockLibrary). */
export function substatCountForAge(age: number, unlockLibrary: any): number {
    return unlockLibrary?.[String(age)]?.NumberOfSecondStats ?? 0;
}

/** The item indices of a slot in an age. */
export function itemIdxsFor(itemBalancingLibrary: any, age: number, slot: ItemSlotKey): number[] {
    const type = SLOT_TO_JSON_TYPE[slot];
    const idxs: number[] = [];
    for (const key of Object.keys(itemBalancingLibrary ?? {})) {
        const m = key.match(/'Age':\s*(\d+),\s*'Type':\s*'([A-Za-z]+)',\s*'Idx':\s*(\d+)/);
        if (m && +m[1] === age && m[2] === type) idxs.push(+m[3]);
    }
    return idxs.sort((a, b) => a - b);
}

/** Equip `item` in `slot`. Skins belong to the slot in game, so the current skin carries over. */
export function withItem(profile: UserProfile, slot: ItemSlotKey, item: ItemSlot | null): UserProfile {
    const p = clone(profile);
    p.items[slot] = item ? { ...clone(item), skin: item.skin ?? profile.items[slot]?.skin } : null;
    return p;
}

export function withoutSubstats(profile: UserProfile, slot: ItemSlotKey): UserProfile {
    const p = clone(profile);
    const item = p.items[slot];
    if (item) item.secondaryStats = [];
    return p;
}

const subsKey = (it: ItemSlot) => (it.secondaryStats ?? []).map(x => `${x.statId}:${x.value}`).sort().join('|');

export function sameItem(a: ItemSlot, b: ItemSlot): boolean {
    return a.age === b.age && a.idx === b.idx && a.level === b.level && subsKey(a) === subsKey(b);
}

/** Saved items after replacing `current`: nothing is lost, and nothing is saved twice. */
export function savedAfterSwap(saved: ItemSlot[], current: ItemSlot | null): ItemSlot[] {
    return current && !saved.some(s => sameItem(s, current)) ? [...saved, { ...current }] : saved;
}

// ---- verdict ---------------------------------------------------------------------------------

/** An overall change below this either way is noise. */
export const NOISE = 0.02;
/** A mode moving this much either way counts towards a "Mixed" verdict. */
export const MODE_SWING = 0.05;

export type Verdict = 'equip' | 'keep' | 'same' | 'mixed';

export const VERDICT_LABEL: Record<Verdict, string> = {
    equip: 'Equip it',
    keep: 'Keep your current one',
    same: 'No real difference',
    mixed: 'Mixed: depends what you push',
};

/** `gain` is the total over the focus modes, `modeDeltas` the change in each of them. */
export function forgeVerdict(gain: number, modeDeltas: number[]): { verdict: Verdict; canEquip: boolean; recommended: boolean } {
    const mixed = modeDeltas.some(d => d > MODE_SWING) && modeDeltas.some(d => d < -MODE_SWING);
    const verdict: Verdict = mixed ? 'mixed' : gain > NOISE ? 'equip' : gain < -NOISE ? 'keep' : 'same';
    return { verdict, canEquip: verdict === 'equip' || verdict === 'mixed', recommended: verdict === 'equip' };
}

// ---- filter guide ----------------------------------------------------------------------------

export interface SubstatValue { def: SubstatDef; mid: number; max: number }
export interface CarriedValue { slot: ItemSlotKey; worth: number }
export interface AgeValue { slot: ItemSlotKey; gain: number }

export interface FilterGuide {
    /** Best first. */
    subs: SubstatValue[];
    /** The substats worn now, weakest first. */
    carried: CarriedValue[];
    /** One age higher, best first. */
    ages: AgeValue[];
    /** Substats worth keeping a drop for: above the weakest one worn, or the top 3 with none worn. */
    keep: SubstatValue[];
    weakest: CarriedValue | null;
    /** Whether even the worst slot's age step beats the best possible substat roll. */
    ageBeatsSubs: boolean;
}

export function filterGuide(subs: SubstatValue[], carried: CarriedValue[], ages: AgeValue[]): FilterGuide {
    const bySub = [...subs].sort((a, b) => b.mid - a.mid);
    const byWorth = [...carried].sort((a, b) => a.worth - b.worth);
    const byAge = [...ages].sort((a, b) => b.gain - a.gain);
    const weakest = byWorth[0] ?? null;
    const bestRoll = Math.max(0, ...subs.map(s => s.max));
    return {
        subs: bySub,
        carried: byWorth,
        ages: byAge,
        weakest,
        keep: weakest ? bySub.filter(s => s.mid > weakest.worth + NOISE) : bySub.slice(0, 3),
        ageBeatsSubs: byAge.length > 0 && byAge[byAge.length - 1].gain > bestRoll,
    };
}
