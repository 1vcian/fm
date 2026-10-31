/// <reference lib="webworker" />
/**
 * Runs "Fight against" (src/presets/challenge.ts) in a browser worker: loads the version's configs
 * and its published preset builds, then plays the player's profile against every build.
 */
import type { ConfigFiles, ProfilePresetsFile } from './buildPresets';
import { presetLibsFrom, PRESET_CONFIG_FILES } from './presetLibs';
import { runChallenge, type ChallengeResult } from './challenge';
import { pvpConfigFromJson } from '../pvp/simulate';
import type { UserProfile } from '../types/Profile';

export type ChallengeRequest = { version: string; name: string; profile: UserProfile };

export type ChallengeReply =
    | { type: 'progress'; done: number; total: number }
    | { type: 'done'; result: ChallengeResult }
    | { type: 'error'; message: string };

const post = (m: ChallengeReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ChallengeRequest>) => {
    const { version, name, profile } = e.data;
    try {
        const base = `${import.meta.env.BASE_URL}parsed_configs/${version}/`;
        const cfg: ConfigFiles = {};
        await Promise.all(PRESET_CONFIG_FILES.map(async f => {
            const r = await fetch(`${base}${f}.json`);
            if (r.ok) cfg[f] = await r.json();
        }));
        const site = await fetch(`${base}ProfilePresets.json`).then(r => {
            if (!r.ok) throw new Error('no preset builds for this game version');
            return r.json() as Promise<ProfilePresetsFile>;
        });
        const arena = pvpConfigFromJson(cfg.PvpBaseConfig);
        if (!arena) throw new Error('PvpBaseConfig.json is missing or incomplete');
        const result = runChallenge({ name, profile }, site, presetLibsFrom(version, cfg), arena, (done, total) => post({ type: 'progress', done, total }));
        post({ type: 'done', result });
    } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
