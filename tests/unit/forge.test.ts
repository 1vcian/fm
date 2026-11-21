import { describe, expect, it } from 'vitest';
import {
    filterGuide, forgeVerdict, itemIdxsFor, sameItem, savedAfterSwap, substatCountForAge, substatDefs, withItem, withoutSubstats,
} from '../../src/upgrades/forge';
import type { ItemSlot, UserProfile } from '../../src/types/Profile';

const item = (over: Partial<ItemSlot> = {}): ItemSlot => ({ age: 3, idx: 1, level: 10, rarity: 'Common', secondaryStats: [], ...over });
const profile = () => ({ items: { Weapon: item({ skin: { idx: 7 } as never, secondaryStats: [{ statId: 'DamageMulti', value: 5 }] }), Helmet: null } }) as unknown as UserProfile;

describe('forgeVerdict', () => {
    it('recommends a clear gain', () => {
        expect(forgeVerdict(0.3, [0.2, 0.1])).toEqual({ verdict: 'equip', canEquip: true, recommended: true });
    });
    it('keeps the current item on a clear loss, with no button', () => {
        expect(forgeVerdict(-0.3, [-0.2, -0.1])).toEqual({ verdict: 'keep', canEquip: false, recommended: false });
    });
    it('treats changes inside the noise band as no difference', () => {
        expect(forgeVerdict(0.02, [0.01]).verdict).toBe('same');
        expect(forgeVerdict(-0.02, [-0.01]).verdict).toBe('same');
    });
    it('offers Equip on a Mixed verdict, not as a recommendation, even when the total is negative', () => {
        expect(forgeVerdict(-0.04, [0.06, -0.1])).toEqual({ verdict: 'mixed', canEquip: true, recommended: false });
    });
    it('needs a real swing both ways to call it Mixed', () => {
        expect(forgeVerdict(0.3, [0.35, -0.05]).verdict).toBe('equip');
    });
});

describe('game data lookups', () => {
    it('lists the substats that can roll, in percent', () => {
        const defs = substatDefs({ a: { Stat: 'LifeSteal', LowerRange: 0.01, UpperRange: 0.2 }, b: { Stat: 'MoveSpeed', LowerRange: 0, UpperRange: 0 } });
        expect(defs).toEqual([{ id: 'LifeSteal', min: 1, max: 20 }]);
    });
    it('reads how many substats an age rolls, none when unknown', () => {
        expect(substatCountForAge(7, { 7: { NumberOfSecondStats: 2 } })).toBe(2);
        expect(substatCountForAge(1, {})).toBe(0);
        expect(substatCountForAge(1, null)).toBe(0);
    });
    it('finds a slot\'s items in an age, in order', () => {
        const lib = { "{'Age': 3, 'Type': 'Weapon', 'Idx': 2}": {}, "{'Age': 3, 'Type': 'Weapon', 'Idx': 0}": {}, "{'Age': 4, 'Type': 'Weapon', 'Idx': 9}": {}, "{'Age': 3, 'Type': 'Armour', 'Idx': 5}": {} };
        expect(itemIdxsFor(lib, 3, 'Weapon')).toEqual([0, 2]);
    });
});

describe('item variants', () => {
    it('keeps the slot\'s skin on a swapped item, and leaves the profile alone', () => {
        const p = profile();
        const q = withItem(p, 'Weapon', item({ idx: 2 }));
        expect(q.items.Weapon).toMatchObject({ idx: 2, skin: { idx: 7 } });
        expect(p.items.Weapon!.idx).toBe(1);
    });
    it('clears a slot', () => {
        expect(withItem(profile(), 'Weapon', null).items.Weapon).toBeNull();
    });
    it('strips one slot\'s substats', () => {
        const p = profile();
        expect(withoutSubstats(p, 'Weapon').items.Weapon!.secondaryStats).toEqual([]);
        expect(p.items.Weapon!.secondaryStats).toHaveLength(1);
    });
    it('compares items by content, whatever the substat order', () => {
        const a = item({ secondaryStats: [{ statId: 'A', value: 1 }, { statId: 'B', value: 2 }] });
        const b = item({ secondaryStats: [{ statId: 'B', value: 2 }, { statId: 'A', value: 1 }] });
        expect(sameItem(a, b)).toBe(true);
        expect(sameItem(a, item())).toBe(false);
        expect(sameItem(item(), item({ level: 11 }))).toBe(false);
    });
    it('saves the replaced item once', () => {
        const old = item();
        expect(savedAfterSwap([], old)).toEqual([old]);
        expect(savedAfterSwap([old], item())).toEqual([old]);
        expect(savedAfterSwap([old], null)).toEqual([old]);
    });
});

describe('filterGuide', () => {
    const sub = (id: string, mid: number, max = mid * 2) => ({ def: { id, min: 1, max: 10 }, mid, max });

    it('ranks substats, weakest worn first, best age first', () => {
        const g = filterGuide([sub('A', 0.1), sub('B', 0.5)], [{ slot: 'Ring', worth: 0.4 }, { slot: 'Belt', worth: 0.05 }], [{ slot: 'Ring', gain: 1 }, { slot: 'Belt', gain: 2 }]);
        expect(g.subs.map(s => s.def.id)).toEqual(['B', 'A']);
        expect(g.carried[0].slot).toBe('Belt');
        expect(g.ages[0].slot).toBe('Belt');
    });
    it('keeps substats clearly above the weakest one worn', () => {
        const g = filterGuide([sub('A', 0.06), sub('B', 0.5), sub('C', 0.07)], [{ slot: 'Belt', worth: 0.05 }], []);
        expect(g.keep.map(s => s.def.id)).toEqual(['B']);
    });
    it('falls back to the top three with nothing worn', () => {
        const g = filterGuide([sub('A', 1), sub('B', 2), sub('C', 3), sub('D', 4)], [], []);
        expect(g.weakest).toBeNull();
        expect(g.keep.map(s => s.def.id)).toEqual(['D', 'C', 'B']);
    });
    it('says the age beats substats only when even the worst slot does', () => {
        expect(filterGuide([sub('A', 1, 2)], [], [{ slot: 'Ring', gain: 3 }, { slot: 'Belt', gain: 2.5 }]).ageBeatsSubs).toBe(true);
        expect(filterGuide([sub('A', 1, 2)], [], [{ slot: 'Ring', gain: 3 }, { slot: 'Belt', gain: 1 }]).ageBeatsSubs).toBe(false);
        expect(filterGuide([sub('A', 1, 2)], [], []).ageBeatsSubs).toBe(false);
    });
});
