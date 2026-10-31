/**
 * The preset page's browser workers, so the page stays responsive: "Calculate my best variants"
 * (the preset builds with only the player's own skins, src/presets/ownedVariants.ts) and
 * "Fight against" (the player's profile in the tournament, src/presets/challenge.ts).
 */
import type { ProfilePresetsFile } from './buildPresets';
import type { SavedSkin, UserProfile } from '../types/Profile';
import type { VariantsReply, VariantsRequest } from './presetsWorker';
import type { ChallengeReply, ChallengeRequest } from './challengeWorker';
import type { ChallengeResult } from './challenge';

export interface VariantsRun {
    promise: Promise<ProfilePresetsFile>;
    cancel: () => void;
}

export function runMyVariants(version: string, saved: SavedSkin[], onLog: (msg: string) => void, excludeWeaponSets?: string[]): VariantsRun {
    const worker = new Worker(new URL('./presetsWorker.ts', import.meta.url), { type: 'module' });
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<ProfilePresetsFile>((resolve, rej) => {
        reject = rej;
        worker.onmessage = (e: MessageEvent<VariantsReply>) => {
            const d = e.data;
            if (d.type === 'log') onLog(d.msg);
            else if (d.type === 'error') rej(new Error(d.message));
            else resolve(d.result);
        };
        worker.onerror = ev => rej(new Error(ev.message || 'worker failed'));
        worker.postMessage({ version, saved: JSON.parse(JSON.stringify(saved)), excludeWeaponSets } satisfies VariantsRequest);
    }).finally(() => worker.terminate());
    return { promise, cancel: () => { worker.terminate(); reject(new Error('stopped')); } };
}

export interface ChallengeRun {
    promise: Promise<ChallengeResult>;
    cancel: () => void;
}

/** "Fight against": the profile against every preset build, on a browser worker. */
export function runFightAgainst(version: string, name: string, profile: UserProfile, onProgress: (done: number, total: number) => void): ChallengeRun {
    const worker = new Worker(new URL('./challengeWorker.ts', import.meta.url), { type: 'module' });
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<ChallengeResult>((resolve, rej) => {
        reject = rej;
        worker.onmessage = (e: MessageEvent<ChallengeReply>) => {
            const d = e.data;
            if (d.type === 'progress') onProgress(d.done, d.total);
            else if (d.type === 'error') rej(new Error(d.message));
            else resolve(d.result);
        };
        worker.onerror = ev => rej(new Error(ev.message || 'worker failed'));
        worker.postMessage({ version, name, profile: JSON.parse(JSON.stringify(profile)) } satisfies ChallengeRequest);
    }).finally(() => worker.terminate());
    return { promise, cancel: () => { worker.terminate(); reject(new Error('stopped')); } };
}
