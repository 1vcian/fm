import { describe, expect, it } from 'vitest';
import {
    bareKey, dominatedBy, finalists, FULL_SIMS, judge, KEEP_THRESHOLD, mountRoster, petRoster, poolLoadouts, sameLoadout, savedAfterEquip,
    unitKey, withLoadout, type Scores,
} from '../../src/upgrades/loadout';
import type { MountSlot, PetSlot, UserProfile } from '../../src/types/Profile';

const pet = (id: number, level = 10, over: Partial<PetSlot> = {}): PetSlot => ({ rarity: 'Rare', id, level, evolution: 0, secondaryStats: [], ...over });
const mount = (id: number, level = 10, over: Partial<MountSlot> = {}): MountSlot => ({ rarity: 'Rare', id, level, evolution: 0, skills: [], secondaryStats: [], ...over });
const profile = (active: PetSlot[], saved: PetSlot[], m: MountSlot | null = null, mSaved: MountSlot[] = []) =>
    ({ pets: { active, savedBuilds: saved }, mount: { active: m, savedBuilds: mSaved } }) as unknown as UserProfile;
const scores = (over: Partial<Scores> = {}): Scores => ({ main: 0, hammer: 0, skill: 0, egg: 0, potion: 0, ...over });

describe('unitKey', () => {
    it('ignores the order of substat fields and of the substats', () => {
        const a = pet(1, 1, { secondaryStats: [{ statId: 'A', value: 1 }, { statId: 'B', value: 2 }] });
        const b = pet(1, 1, { secondaryStats: [{ value: 2, statId: 'B' }, { value: 1, statId: 'A' }] as never });
        expect(unitKey(a)).toBe(unitKey(b));
    });
    it('tells levels and substats apart', () => {
        expect(unitKey(pet(1, 1))).not.toBe(unitKey(pet(1, 2)));
        expect(bareKey('pets', pet(1, 5), 1)).not.toBe(bareKey('pets', pet(1, 5)));
    });
});

describe('roster', () => {
    it('links an equipped pet to its saved copy instead of listing it twice', () => {
        const r = petRoster(profile([pet(1)], [pet(1), pet(2)]));
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ active: true, saved: true });
    });
    it('keeps two identical saved copies, since you can own two', () => {
        expect(petRoster(profile([pet(1)], [pet(1), pet(1)]))).toHaveLength(2);
    });
    it('lists what is only equipped', () => {
        expect(mountRoster(profile([], [], mount(1)))).toEqual([{ item: mount(1), active: true, saved: false }]);
    });
    it('saves what was only equipped when equipping another lineup', () => {
        const p = profile([pet(9)], [pet(1)]);
        expect(savedAfterEquip(petRoster(p), p.pets.savedBuilds).map(x => x.id)).toEqual([1, 9]);
    });
});

describe('withLoadout', () => {
    it('leaves what it is not given', () => {
        const p = profile([pet(1)], [], mount(1));
        expect(withLoadout(p, null, undefined)).toEqual(p);
        expect(withLoadout(p, [pet(2)], undefined).pets.active[0].id).toBe(2);
        expect(withLoadout(p, null, null).mount.active).toBeNull();
    });
    it('does not touch the original', () => {
        const p = profile([pet(1)], []);
        withLoadout(p, [], null);
        expect(p.pets.active).toHaveLength(1);
    });
});

describe('poolLoadouts', () => {
    it('crosses every trio with every mount', () => {
        const c = poolLoadouts(profile([], []), [pet(1), pet(2), pet(3), pet(4)], [mount(1), mount(2)], 3);
        expect(c).toHaveLength(8);
        expect(c.every(x => x.petSet.length === 3)).toBe(true);
    });
    it('works with too few pets and no mount', () => {
        const c = poolLoadouts(profile([], []), [pet(1)], [], 3);
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ mount: null });
    });
});

describe('finalists', () => {
    const pets = [1, 2, 3, 4, 5, 6].map(i => pet(i));
    const m = mount(1);
    const combos = poolLoadouts(profile([], []), pets, [m], 3);

    it('always includes what is worn now', () => {
        const current = { petSet: [pet(50)], mount: null };
        expect(finalists(combos, pets, [m], current, 3).some(c => sameLoadout(c, current))).toBe(true);
    });
    it('caps the priced ones, adds each star\'s best lineup, and repeats nothing', () => {
        const priced = [...combos].sort((a, b) => a.petSet[0].id - b.petSet[0].id);
        const f = finalists(priced, pets, [m], priced[0], 3);
        expect(f.length).toBeGreaterThanOrEqual(FULL_SIMS);
        for (const star of pets.slice(0, 5)) expect(f.some(c => c.petSet.includes(star))).toBe(true);
        expect(new Set(f.map(c => c.petSet.map(unitKey).join() + c.mount)).size).toBe(f.length);
    });
});

describe('dominatedBy', () => {
    it('needs a full lineup of better copies of the same pet', () => {
        const items = [pet(1, 5), pet(1, 10), pet(1, 10), pet(1, 10)];
        expect(dominatedBy('pets', items, 3).get(0)).toEqual([1, 2, 3]);
        expect(dominatedBy('pets', items.slice(0, 3), 3).size).toBe(0);
    });
    it('never compares different pets', () => {
        expect(dominatedBy('pets', [pet(1, 1), pet(2, 99), pet(2, 99), pet(2, 99)], 3).size).toBe(0);
    });
    it('keeps a lower copy with a substat the better ones lack', () => {
        const items = [pet(1, 5, { secondaryStats: [{ statId: 'A', value: 5 }] }), pet(1, 10), pet(1, 10), pet(1, 10)];
        expect(dominatedBy('pets', items, 3).has(0)).toBe(false);
    });
    it('does not let exact duplicates cancel each other', () => {
        const d = dominatedBy('mounts', [mount(1), mount(1)], 1);
        expect(d.has(0)).toBe(false);
        expect(d.get(1)).toEqual([0]);
    });
    it('compares mounts across species by rarity', () => {
        const low = mount(1, 10), high = mount(2, 10, { rarity: 'Epic' });
        expect(dominatedBy('mounts', [low, high], 1).get(0)).toEqual([1]);
        expect(dominatedBy('mounts', [low, high], 1).has(1)).toBe(false);
    });
});

describe('judge', () => {
    const none = scores();
    it('never lets go of a top lineup piece', () => {
        expect(judge(pet(1), true, none, none, none)).toEqual({ safe: false, reason: 'in a top lineup' });
    });
    it('has no opinion before the sim', () => {
        expect(judge(pet(1), false, undefined, none, none)).toBeUndefined();
        expect(judge(pet(1), false, none, undefined, none)).toBeUndefined();
    });
    it('keeps a substat that helps in any mode, even one not ranked for', () => {
        const v = judge(pet(1), false, scores({ egg: KEEP_THRESHOLD }), none, none)!;
        expect(v.safe).toBe(false);
        expect(v.reason).toContain('egg');
    });
    it('keeps levels that help', () => {
        const v = judge(pet(1, 10), false, scores({ main: 1 }), scores({ main: 1 }), none)!;
        expect(v.safe).toBe(false);
        expect(v.reason).toContain('levels');
    });
    it('marks what does nothing anywhere', () => {
        expect(judge(pet(1, 10, { secondaryStats: [{ statId: 'A', value: 1 }] }), false, none, none, none)).toMatchObject({ safe: true });
    });
    it('skips the level check on a level 1 copy', () => {
        expect(judge(pet(1, 1), false, scores({ main: 1 }), scores({ main: 1 }), none)).toMatchObject({ safe: true });
    });
});
