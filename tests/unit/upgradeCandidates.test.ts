import { describe, expect, it } from 'vitest';
import { upgradeCandidates } from '../../src/upgrades/candidates';
import type { UserProfile } from '../../src/types/Profile';
import type { LibraryData } from '../../src/utils/statEngine';

const libs = {
    techTreePositionLibrary: {
        Power: {
            Nodes: [
                { Id: 0, Type: 'WeaponBonus', Tier: 0, Requirements: [] },
                { Id: 1, Type: 'MountDamage', Tier: 1, Requirements: [0] },
                { Id: 2, Type: 'PetBonusDamage', Tier: 1, Requirements: [1] },
            ],
        },
    },
    techTreeLibrary: { WeaponBonus: { MaxLevel: 5 }, MountDamage: { MaxLevel: 5 }, PetBonusDamage: { MaxLevel: 5 } },
    petUpgradeLibrary: { Rare: { LevelInfo: new Array(10) } },
    mountUpgradeLibrary: { Rare: { LevelInfo: new Array(10) } },
    skillLibrary: { Drone: { Rarity: 'Rare' }, Shout: { Rarity: 'Rare' } },
    skillPassiveLibrary: { Rare: { LevelStats: new Array(10) } },
} as unknown as LibraryData;

const upgradeLib = { 0: { Levels: [{ Level: 0, Cost: 5, Duration: 60 }, { Level: 1, Cost: 9, Duration: 120 }] } };
const sprites = {
    pets: { mapping: { x: { rarity: 'Rare', id: 3, name: 'SpectralTiger' } } },
    mounts: { mapping: { x: { rarity: 'Rare', id: 1, name: 'HoverDisk' } } },
};

function profile(over: Partial<UserProfile> = {}): UserProfile {
    return {
        techTree: { Forge: {}, Power: { 0: 1 }, SkillsPetTech: {}, Clan: {} },
        pets: { active: [{ rarity: 'Rare', id: 3, level: 4 }] },
        mount: { active: { rarity: 'Rare', id: 1, level: 4 } },
        skills: { equipped: [{ id: 'Drone', level: 4 }], passives: { Drone: 4, Shout: 2, Unowned: 0 } },
        ...over,
    } as unknown as UserProfile;
}

const find = (list: ReturnType<typeof upgradeCandidates>, key: string) => list.find(c => c.key === key);

describe('upgradeCandidates', () => {
    it('offers tech nodes whose prerequisites are met, not the ones behind them', () => {
        const c = upgradeCandidates(profile(), libs, upgradeLib, sprites);
        expect(find(c, 'tech:Power:0')).toBeDefined();
        expect(find(c, 'tech:Power:1')).toBeDefined();
        expect(find(c, 'tech:Power:2')).toBeUndefined();
    });

    it('prices a node at its current level and raises it by one', () => {
        const node = find(upgradeCandidates(profile(), libs, upgradeLib, sprites), 'tech:Power:0')!;
        expect(node.cost).toBe(9);
        expect(node.duration).toBe(120);
        expect(node.profile.techTree.Power[0]).toBe(2);
        expect(node.label).toBe('Weapon Bonus');
    });

    it('skips a maxed node', () => {
        const p = profile({ techTree: { Forge: {}, Power: { 0: 5 }, SkillsPetTech: {}, Clan: {} } });
        expect(find(upgradeCandidates(p, libs, upgradeLib, sprites), 'tech:Power:0')).toBeUndefined();
    });

    it('still lists tech while the price library is loading', () => {
        const node = find(upgradeCandidates(profile(), libs, null, sprites), 'tech:Power:0')!;
        expect(node.cost).toBeUndefined();
    });

    it('names pets and mounts, and falls back when the mapping has no entry', () => {
        const c = upgradeCandidates(profile(), libs, upgradeLib, sprites);
        expect(find(c, 'pet:0')!.label).toBe('Spectral Tiger');
        expect(find(c, 'mount')!.label).toBe('Hover Disk');
        const bare = upgradeCandidates(profile(), libs, upgradeLib, null);
        expect(find(bare, 'pet:0')!.label).toBe('Pet 1');
        expect(find(bare, 'mount')!.label).toBe('Mount');
    });

    it('stops at the pet and mount level cap, where the engine would fall back to level 1', () => {
        const p = profile({
            pets: { active: [{ rarity: 'Rare', id: 3, level: 10 }] },
            mount: { active: { rarity: 'Rare', id: 1, level: 10 } },
        } as Partial<UserProfile>);
        const c = upgradeCandidates(p, libs, upgradeLib, sprites);
        expect(find(c, 'pet:0')).toBeUndefined();
        expect(find(c, 'mount')).toBeUndefined();
    });

    it('raises an equipped skill and its passive together', () => {
        const drone = find(upgradeCandidates(profile(), libs, upgradeLib, sprites), 'skill:Drone')!;
        expect(drone.profile.skills.equipped[0].level).toBe(5);
        expect(drone.profile.skills.passives.Drone).toBe(5);
    });

    it('offers a passive-only skill, and not one you do not own', () => {
        const c = upgradeCandidates(profile(), libs, upgradeLib, sprites);
        expect(find(c, 'skill:Shout')!.profile.skills.passives.Shout).toBe(3);
        expect(find(c, 'skill:Unowned')).toBeUndefined();
    });

    it('never pushes a passive past its cap, even when the equipped level is lower', () => {
        const p = profile({ skills: { equipped: [{ id: 'Drone', level: 4 }], passives: { Drone: 10 } } } as Partial<UserProfile>);
        expect(find(upgradeCandidates(p, libs, upgradeLib, sprites), 'skill:Drone')).toBeUndefined();
    });

    it('leaves the player profile untouched', () => {
        const p = profile();
        const before = JSON.stringify(p);
        upgradeCandidates(p, libs, upgradeLib, sprites);
        expect(JSON.stringify(p)).toBe(before);
    });
});
