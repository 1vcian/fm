// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    defaultTarget, deleteSnapshot, eta, exportHistory, importHistory, makeSnapshot, parseBattle, saveSnapshot, snapshotProfile,
    snapshotsFor, trendFor, type Snapshot,
} from '../../src/upgrades/history';
import type { BattleTarget } from '../../src/progress/battleWorker';
import type { UserProfile } from '../../src/types/Profile';

const DAY = 86_400_000;
const profile = { id: 'a', name: 'A' } as UserProfile;
const snap = (over: Partial<Snapshot>): Snapshot => ({ id: Math.random().toString(36), profileId: 'a', at: 0, version: 'v', power: 1, cleared: {}, actual: {}, ...over });

const main: BattleTarget[] = [0, 1].flatMap(difficulty => [0, 1].flatMap(ageIdx => [0, 1, 2].map(battleIdx => ({ mode: 'main' as const, difficulty, ageIdx, battleIdx }))));
const dungeon: BattleTarget[] = Array.from({ length: 100 }, (_, level) => ({ mode: 'dungeon', dungeon: 'egg', level }));

describe('snapshots', () => {
    beforeEach(() => localStorage.clear());

    it('saves per profile, oldest first', () => {
        saveSnapshot(snap({ at: 2 }));
        saveSnapshot(snap({ at: 1 }));
        saveSnapshot(snap({ at: 3, profileId: 'b' }));
        expect(snapshotsFor('a').map(s => s.at)).toEqual([1, 2]);
    });

    it('keeps the build it was taken from', () => {
        const s = makeSnapshot({ ...profile, items: { Weapon: null } } as unknown as UserProfile, 'v', 5, { main: 3 }, {}, '  after the egg  ');
        expect(s.note).toBe('after the egg');
        expect(s.cleared).toEqual({ main: 3 });
        expect(snapshotProfile(s)).toMatchObject({ id: 'a', items: { Weapon: null } });
    });

    it('drops an empty note, and survives a snapshot with no build', () => {
        expect(makeSnapshot(profile, 'v', 5, {}, {}, '   ').note).toBeUndefined();
        expect(snapshotProfile(snap({}))).toBeNull();
        expect(snapshotProfile(snap({ profile: 'not lz' }))).toBeNull();
    });

    it('deletes one snapshot', () => {
        saveSnapshot(snap({ id: 'x' }));
        saveSnapshot(snap({ id: 'y' }));
        deleteSnapshot('x');
        expect(snapshotsFor('a').map(s => s.id)).toEqual(['y']);
    });

    it('reports full storage instead of throwing', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
        expect(saveSnapshot(snap({}))).toBe(false);
        spy.mockRestore();
    });

    it('moves snapshots to another profile, once', () => {
        saveSnapshot(snap({ id: 'x' }));
        const file = exportHistory('a');
        expect(importHistory(file, 'b')).toBe(0); // the same id is already here
        localStorage.clear();
        expect(importHistory(file, 'b')).toBe(1);
        expect(importHistory(file, 'b')).toBe(0);
        expect(snapshotsFor('b')).toHaveLength(1);
    });

    it('refuses a file that is not an export', () => {
        expect(() => importHistory('{"kind":"other"}', 'a')).toThrow('Not a progress history');
        expect(() => importHistory('not json', 'a')).toThrow();
    });
});

describe('parseBattle', () => {
    it('reads main battles as the game writes them', () => {
        expect(parseBattle('Hard 2-3', main)).toBe(11);
        expect(parseBattle('hard 2 3', main)).toBe(11);
        expect(parseBattle('Normal 1-2', main)).toBe(1);
    });
    it('takes the first difficulty when none is given', () => {
        expect(parseBattle('2-1', main)).toBe(3);
    });
    it('reads dungeon levels', () => {
        expect(parseBattle('12', dungeon)).toBe(11);
        expect(parseBattle('Level 12', dungeon)).toBe(11);
        expect(parseBattle('lv 12', dungeon)).toBe(11);
    });
    it('turns down what does not exist', () => {
        expect(parseBattle('9-9', main)).toBe(-1);
        expect(parseBattle('Nope 1-1', main)).toBe(-1);
        expect(parseBattle('', main)).toBe(-1);
        expect(parseBattle('0', dungeon)).toBe(-1);
        expect(parseBattle('101', dungeon)).toBe(-1);
    });
});

describe('defaultTarget', () => {
    it('aims for the next age, then the next difficulty', () => {
        expect(defaultTarget(1, main)).toBe('Normal 2-1');
        expect(defaultTarget(4, main)).toBe('Hard 1-1');
    });
    it('stays on the last battle at the end', () => {
        expect(defaultTarget(main.length, main)).toBe('Hard 2-3');
    });
    it('aims for the next ten dungeon levels, and stops at the last', () => {
        expect(defaultTarget(13, dungeon)).toBe('Level 20');
        expect(defaultTarget(20, dungeon)).toBe('Level 30');
        expect(defaultTarget(99, dungeon)).toBe('Level 100');
    });
});

describe('trendFor', () => {
    const at = (day: number, cleared: number, actual?: number) => snap({ at: day * DAY, cleared: { main: cleared }, actual: actual === undefined ? {} : { main: actual } });

    it('fits the pace in battles per day', () => {
        const t = trendFor([at(0, 9), at(1, 11), at(2, 13)], 'main')!;
        expect(t.perDay).toBeCloseTo(2);
        expect(t.latest).toBe(14);
        expect(t.points).toBe(3);
    });
    it('prefers what the player reported', () => {
        expect(trendFor([at(0, 9, 0), at(1, 9, 5)], 'main')!.perDay).toBeCloseTo(5);
    });
    it('needs two snapshots at least six hours apart', () => {
        expect(trendFor([at(0, 1)], 'main')).toBeNull();
        expect(trendFor([at(0, 1), at(0.1, 2)], 'main')).toBeNull();
    });
    it('uses only the recent window', () => {
        expect(trendFor([at(0, 0), at(30, 100), at(31, 101)], 'main')!.perDay).toBeCloseTo(1);
    });
    it('skips modes a snapshot has no reading for', () => {
        expect(trendFor([at(0, 1), at(1, 2)], 'egg')).toBeNull();
    });
});

describe('eta', () => {
    const t = (perDay: number, latest = 10) => ({ perDay, latest, points: 2, spanDays: 1 });
    it('words the wait', () => {
        expect(eta(t(1), 5)).toBe('reached');
        expect(eta(t(0), 20)).toBe('not at this pace');
        expect(eta(t(-1), 20)).toBe('not at this pace');
        expect(eta(t(100), 20)).toBe('~2h');
        expect(eta(t(2), 20)).toBe('~5.0 days');
        expect(eta(t(0.5), 20)).toBe('~20 days');
        expect(eta(t(0.02), 20)).toBe('over a year');
    });
});
