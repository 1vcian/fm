// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readHint, saveHint } from '../../src/progress/frontierSearch';
import type { UserProfile } from '../../src/types/Profile';

const profile = (id: string) => ({ id }) as UserProfile;

describe('frontier hints', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips per profile and per mode', () => {
        saveHint(profile('a'), 'main', 42);
        expect(readHint(profile('a'), 'main')).toBe(42);
        expect(readHint(profile('a'), 'dungeon-egg')).toBe(0);
        expect(readHint(profile('b'), 'main')).toBe(0);
    });

    it('keeps the key the Battle Predictor already wrote', () => {
        localStorage.setItem('fm.progressHint.a.main', '7');
        expect(readHint(profile('a'), 'main')).toBe(7);
    });

    it('stores "nothing cleared" as 0 and ignores junk', () => {
        saveHint(profile('a'), 'main', -1);
        expect(readHint(profile('a'), 'main')).toBe(0);
        localStorage.setItem('fm.progressHint.a.main', 'junk');
        expect(readHint(profile('a'), 'main')).toBe(0);
    });

    it('survives blocked storage', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(readHint(profile('a'), 'main')).toBe(0);
        spy.mockRestore();
    });
});
