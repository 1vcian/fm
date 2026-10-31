/// <reference lib="webworker" />
/**
 * Runs "my best variants" (src/presets/ownedVariants.ts) in a browser worker: loads the version's
 * configs and its published preset builds, then puts the player's own skins on them.
 */
import type { ConfigFiles, ProfilePresetsFile } from './buildPresets';
import { presetLibsFrom, PRESET_CONFIG_FILES } from './presetLibs';
import { buildOwnedPresets } from './ownedVariants';
import type { SavedSkin } from '../types/Profile';

export type VariantsRequest = { version: string; saved: SavedSkin[] };

export type VariantsReply =
    | { type: 'log'; msg: string }
    | { type: 'done'; result: ProfilePresetsFile }
    | { type: 'error'; message: string };

/** Fewer quest runs and arena battles than the published builds: the player waits for these. */
const BROWSER_OPTIONS = { questSearchRuns: 4, questFinalRuns: 24, labBattles: 4, tournamentBattles: 20 };

const post = (m: VariantsReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<VariantsRequest>) => {
    const { version, saved } = e.data;
    try {
        const base = `${import.meta.env.BASE_URL}parsed_configs/${version}/`;
        const cfg: ConfigFiles = {};
        await Promise.all(PRESET_CONFIG_FILES.map(async name => {
            const r = await fetch(`${base}${name}.json`);
            if (r.ok) cfg[name] = await r.json();
        }));
        const site = await fetch(`${base}ProfilePresets.json`).then(r => {
            if (!r.ok) throw new Error('no preset builds for this game version');
            return r.json() as Promise<ProfilePresetsFile>;
        });
        const libs = presetLibsFrom(version, cfg);
        const result = buildOwnedPresets(site, saved, libs, cfg, { ...BROWSER_OPTIONS, log: msg => post({ type: 'log', msg }) });
        post({ type: 'done', result });
    } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
