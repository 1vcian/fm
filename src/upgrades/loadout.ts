/**
 * Loadout Search: which of your pets and mounts to wear for the battles, and which copies you no
 * longer need. Pure, so the rules are testable; the measuring is in src/pages/LoadoutSearch.tsx.
 */
import type { MountSlot, PetSlot, UserProfile } from '../types/Profile';
import { enumerateLoadouts, type LoadoutCombo } from '../optimizer/buildOptimizer';
import { RANK_MODES, type RankMode } from './ranking';

export type Kind = 'pets' | 'mounts';
export type Unit = PetSlot | MountSlot;
export type Scores = Record<RankMode, number>;

/** Pets kept for the combination stage, ranked by their own full sim. */
export const POOL_PETS = 12;
/** Mounts kept for the combination stage. */
export const POOL_MOUNTS = 3;
/** How many pre-ranked combinations get a full sim. */
export const FULL_SIMS = 12;
/** Everything in this many of the best lineups is never marked safe to merge. */
export const KEEP_LINEUPS = 5;
/** Anything worth at least this much score, in any mode, is kept. */
export const KEEP_THRESHOLD = 0.05;

const RARITY_RANK: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3, Ultimate: 4, Mythic: 5 };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Field by field, not as JSON: the same substat can be stored with its keys in either order. */
const subsKey = (subs?: { statId: string; value: number }[]) => (subs ?? []).map(s => `${s.statId}:${Number(s.value)}`).sort().join(',');
export const unitKey = (x: Unit) => `${x.rarity}|${x.id}|${x.level}|${x.evolution ?? 0}|${subsKey(x.secondaryStats)}`;
export const bareKey = (kind: Kind, x: Unit, level = x.level) => `${kind}|${x.rarity}|${x.id}|${x.evolution ?? 0}|${level}`;

export interface RosterEntry<T> { item: T; active: boolean; saved: boolean }

/** Every saved copy, each its own entry (you can own two alike), with an equipped copy linked to its saved one. */
function linkRoster<T extends Unit>(active: T[], saved: T[]): RosterEntry<T>[] {
    const entries: RosterEntry<T>[] = saved.map(item => ({ item, active: false, saved: true }));
    for (const item of active) {
        const twin = entries.find(e => !e.active && e.saved && unitKey(e.item) === unitKey(item));
        if (twin) twin.active = true;
        else entries.push({ item, active: true, saved: false });
    }
    return entries;
}

export const petRoster = (p: UserProfile) => linkRoster(p.pets.active ?? [], p.pets.savedBuilds ?? []);
export const mountRoster = (p: UserProfile) => linkRoster(p.mount.active ? [p.mount.active] : [], p.mount.savedBuilds ?? []);

/** Saved builds after equipping: whatever was only equipped gets a saved copy, so nothing is lost. */
export const savedAfterEquip = <T extends Unit>(entries: RosterEntry<T>[], saved: T[]): T[] =>
    [...saved, ...entries.filter(e => !e.saved).map(e => e.item)];

/** The profile wearing these pets and mount (null pets: keep the current ones). */
export function withLoadout(profile: UserProfile, pets: PetSlot[] | null, mount: MountSlot | null | undefined): UserProfile {
    const p = clone(profile);
    if (pets) p.pets.active = clone(pets);
    if (mount !== undefined) p.mount.active = mount ? clone(mount) : null;
    return p;
}

/** Every lineup of the pool, through AUTO BEST's own enumeration. */
export function poolLoadouts(profile: UserProfile, pets: PetSlot[], mounts: MountSlot[], slots: number): LoadoutCombo[] {
    const pool = withLoadout(profile, [], null);
    pool.pets.savedBuilds = pets;
    pool.mount.savedBuilds = mounts;
    return enumerateLoadouts(pool, slots);
}

export const sameLoadout = (a: LoadoutCombo, b: LoadoutCombo) => {
    const key = (c: LoadoutCombo) => `${c.petSet.map(unitKey).sort().join('/')}#${c.mount ? unitKey(c.mount) : ''}`;
    return key(a) === key(b);
};

/**
 * What gets the full sim: the best-priced lineups, the trio of the individually strongest pets
 * with the best mount, the best-priced lineup holding each of the top five pets (pricing is a
 * shortcut), and what is worn now. `priced` is best first, `pets` and `mounts` strongest first.
 */
export function finalists(priced: LoadoutCombo[], pets: PetSlot[], mounts: MountSlot[], current: LoadoutCombo, slots: number): LoadoutCombo[] {
    const out = priced.slice(0, FULL_SIMS);
    const add = (c: LoadoutCombo | undefined) => { if (c && !out.some(f => sameLoadout(f, c))) out.push(c); };
    add({ petSet: pets.slice(0, slots), mount: mounts[0] ?? null });
    for (const star of pets.slice(0, 5)) add(priced.find(c => c.petSet.includes(star)));
    add(current);
    return out;
}

/** Does `a` beat or tie `b` on everything that sets its stats? */
function atLeastAsGood(kind: Kind, a: Unit, b: Unit): boolean {
    if (kind === 'pets') {
        // Same species: identical base stats and type, so only level and substats differ.
        if (a.rarity !== b.rarity || a.id !== b.id) return false;
    } else if ((RARITY_RANK[a.rarity] ?? 0) < (RARITY_RANK[b.rarity] ?? 0)) {
        // Mount base stats come from rarity alone.
        return false;
    }
    if (a.level < b.level || (a.evolution ?? 0) < (b.evolution ?? 0)) return false;
    return (b.secondaryStats ?? []).every(sb => (a.secondaryStats ?? []).some(sa => sa.statId === sb.statId && Number(sa.value) >= Number(sb.value)));
}

/**
 * For each entry that can never make a lineup, the entries that beat it: a pet needs `slots`
 * better copies of its own species, a mount one better mount. Exact ties keep the earlier entry,
 * so duplicates do not cancel each other out.
 */
export function dominatedBy(kind: Kind, items: Unit[], slots: number): Map<number, number[]> {
    const out = new Map<number, number[]>();
    items.forEach((b, i) => {
        const better: number[] = [];
        items.forEach((a, j) => {
            if (i !== j && atLeastAsGood(kind, a, b) && (!atLeastAsGood(kind, b, a) || j < i)) better.push(j);
        });
        if (better.length >= slots) out.set(i, better);
    });
    return out;
}

export interface Verdict { safe: boolean; reason: string }

/** The best gain of `a` over `b` in any mode: safe-to-merge looks at every mode, not only the chosen ones. */
function bestGain(a: Scores, b: Scores): { mode: RankMode; gain: number } {
    return RANK_MODES.map(mode => ({ mode, gain: a[mode] - b[mode] })).reduce((x, y) => (y.gain > x.gain ? y : x));
}

/**
 * Safe to merge = nothing about it helps in any mode: its substat adds nothing over a bare copy,
 * its levels add nothing over level 1, and it is not in a top lineup. When in doubt, keep.
 */
export function judge(x: Unit, inTopLineup: boolean, withSub: Scores | undefined, bare: Scores | undefined, bareLv1: Scores | undefined): Verdict | undefined {
    if (inTopLineup) return { safe: false, reason: 'in a top lineup' };
    if (!withSub || !bare) return undefined;
    const sub = bestGain(withSub, bare);
    if (sub.gain >= KEEP_THRESHOLD) return { safe: false, reason: `its substat adds +${sub.gain.toFixed(2)} in ${sub.mode}` };
    if (bareLv1 && x.level > 1) {
        const lv = bestGain(bare, bareLv1);
        if (lv.gain >= KEEP_THRESHOLD) return { safe: false, reason: `its levels add +${lv.gain.toFixed(2)} in ${lv.mode}` };
    }
    return { safe: true, reason: x.secondaryStats?.length ? 'its substat does nothing for your build' : 'no substat, and its levels do nothing here' };
}
