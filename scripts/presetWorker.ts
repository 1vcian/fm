/**
 * One worker of presetPool.ts (started through presetWorkerBoot.mjs): loads the version's libraries once, then runs seed ranges with
 * EvalCore and writes each range's two sums into the shared result slots.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type { UserProfile } from '../src/types/Profile';
import { presetEvalCore } from '../src/presets/buildPresets';
import { loadPresetLibs } from './presetLibs';
import type { PoolMessage } from './presetPool';

const { version, ctl: ctlBuf, res: resBuf } = workerData as { version: string; ctl: SharedArrayBuffer; res: SharedArrayBuffer };
const ctl = new Int32Array(ctlBuf);
const res = new Float64Array(resBuf);
const { cfg, libs } = loadPresetLibs(version);
const core = presetEvalCore(libs, cfg);
const profiles = new Map<number, UserProfile>();
Atomics.add(ctl, 1, 1);
Atomics.notify(ctl, 1);

parentPort!.on('message', (m: PoolMessage) => {
    if (m.type === 'register') {
        profiles.set(m.id, m.profile);
        return;
    }
    if (m.type === 'many') {
        const out = new Float64Array(m.out);
        m.tasks.forEach((t, i) => {
            try {
                out[m.index[i]] = core.score(t.kind === 'survival' ? { ...t, attacker: profiles.get(t.attacker)! }
                    : t.kind === 'arena' ? { ...t, field: t.field.map(id => profiles.get(id)!) } : t);
            } catch (e) {
                console.error(e);
                out[m.index[i]] = NaN;
            }
        });
        Atomics.add(ctl, 0, 1);
        Atomics.notify(ctl, 0);
        return;
    }
    const t = m.task;
    let out: [number, number];
    try {
        if (t.kind === 'survival') out = core.survival(t.defender, profiles.get(t.attacker)!, t.seconds, t.from, t.to);
        else if (t.kind === 'arena') out = core.arena(t.me, t.field.map(id => profiles.get(id)!), t.perSide, t.from, t.to);
        else {
            const w = core.quest(t.p, t.battle, t.from, t.to);
            out = w < 0 ? [0, 1] : [w, 0];
        }
    } catch (e) {
        console.error(e);
        out = [NaN, NaN];
    }
    res[2 * m.slot] = out[0];
    res[2 * m.slot + 1] = out[1];
    Atomics.add(ctl, 0, 1);
    Atomics.notify(ctl, 0);
});
