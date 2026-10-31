/**
 * The config files and stat-engine libraries of one game data version, as the preset script and
 * its worker threads (presetPool.ts) load them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryData } from '../src/utils/statEngine';
import { presetLibsFrom } from '../src/presets/presetLibs';
import type { ConfigFiles } from '../src/presets/buildPresets';

export const CONFIG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'parsed_configs');

export function loadPresetLibs(version: string): { dir: string; cfg: ConfigFiles; libs: LibraryData } {
    const dir = path.join(CONFIG_ROOT, version);
    if (!fs.existsSync(dir)) throw new Error(`no config folder ${dir}`);
    const cfg: ConfigFiles = {};
    for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.json') && f !== 'ProfilePresets.json') cfg[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }

    const libs = presetLibsFrom(version, cfg);
    return { dir, cfg, libs };
}
