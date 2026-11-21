// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { focusSum, useFocus } from '../../src/upgrades/ui';
import { RANK_MODES, type RankMode } from '../../src/upgrades/ranking';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(element: ReactElement) {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(element));
}

function useFocusHarness() {
    let api: ReturnType<typeof useFocus>;
    const Probe = () => { api = useFocus(); return null; };
    mount(createElement(Probe));
    return { get focus() { return api[0]; }, set: (m: RankMode[]) => act(() => api[1](m)) };
}

describe('focus modes', () => {
    beforeEach(() => localStorage.clear());

    it('starts with every mode', () => {
        expect(useFocusHarness().focus).toEqual(RANK_MODES);
    });

    it('remembers a choice, in play order', () => {
        useFocusHarness().set(['egg', 'main']);
        expect(useFocusHarness().focus).toEqual(['main', 'egg']);
    });

    it('never ends up empty', () => {
        const h = useFocusHarness();
        h.set([]);
        expect(h.focus).toEqual(RANK_MODES);
    });

    it('ignores a broken saved value', () => {
        localStorage.setItem('fm.upgradeFocus', '{oops');
        expect(useFocusHarness().focus).toEqual(RANK_MODES);
    });
});

describe('focusSum', () => {
    it('adds up the chosen modes only', () => {
        expect(focusSum({ main: 1, egg: 2, skill: 4 }, ['main', 'egg'])).toBe(3);
        expect(focusSum({ main: 1 }, ['egg'])).toBe(0);
    });
});
