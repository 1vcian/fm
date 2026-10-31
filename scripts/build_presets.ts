/**
 * Builds the preset profiles of one config version and writes
 * public/parsed_configs/<version>/ProfilePresets.json, the file the Preset Builds page reads: the
 * Most Power build and the five best builds of each category (DPS and HPS, melee and ranged, main
 * quest), then an arena round robin between all of them.
 *
 *   npx tsx scripts/build_presets.ts [version]     (default: the newest in versions.json)
 *   npx tsx scripts/build_presets.ts [version] --tournament-only
 *       keeps the builds of the existing file and only reruns the arena round robin
 *
 * The libraries are the ones useStatLibraries gives the app, built from the same files with the
 * same transforms (src/utils/gameDataTransforms.ts). Run it after every config import, then
 * `npm run update-configs` so the manifests list the new file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildProfilePresets, type ProfilePresetsFile } from '../src/presets/buildPresets';
import { runTournament } from '../src/presets/tournament';
import { pvpConfigFromJson } from '../src/pvp/simulate';
import { CONFIG_ROOT as ROOT, loadPresetLibs } from './presetLibs';
import { workerPool } from './presetPool';
const versions: string[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
const args = process.argv.slice(2);
const tournamentOnly = args.includes('--tournament-only');
const version = args.find(a => !a.startsWith('--')) ?? versions[0];
const dir = path.join(ROOT, version);

const { cfg, libs } = loadPresetLibs(version);

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
// Duels, arena and quest battles run on worker threads (one per core but one); the results are
// the same as in one thread.
const pool = workerPool(version);
/** Arena battles per pair of builds and side (the noise on a build's win rate is about 1 / sqrt(all its battles)). */
const TOURNAMENT_BATTLES_PER_SIDE = 100;
log(`${pool.size} worker threads`);
const file = path.join(dir, 'ProfilePresets.json');
const out: ProfilePresetsFile = tournamentOnly
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : buildProfilePresets(version, libs, cfg, { log, pool });
// Checkpoint: the builds are saved before the tournament, so it can rerun alone (--tournament-only).
if (!tournamentOnly) fs.writeFileSync(file, JSON.stringify(out));
const arena = pvpConfigFromJson(cfg.PvpBaseConfig);
if (!arena) throw new Error('PvpBaseConfig.json is missing or incomplete');
log('tournament');
out.tournament = runTournament(out.presets, libs, arena, TOURNAMENT_BATTLES_PER_SIDE, log);
out.tournament.standings.forEach((s, i) => log(`#${i + 1} ${s.name}: ${s.wins}-${s.draws}-${s.losses}, ${(s.winRate * 100).toFixed(1)}%, HP margin ${s.hpMargin.toFixed(3)}`));
fs.writeFileSync(file, JSON.stringify(out));
for (const p of out.presets) {
    const m = p.metrics;
    console.log(`${p.name.padEnd(16)} ${p.animation.source === 'skin' ? `${p.animation.setId} skin` : `weapon ${p.animation.weaponIdx}, any skin hidden`} ${p.animation.windup.toFixed(3)}s  power ${m.power.toExponential(4)}  dps ${m.dps.toExponential(4)} (tested ${m.testedDps.toExponential(4)})  hps ${m.hps.toExponential(4)} (tested ${m.testedHps.toExponential(4)})  quest: ${m.quest.label} (${(m.quest.winRate * 100).toFixed(0)}%), next ${m.quest.nextLabel} ${(m.quest.nextWinRate * 100).toFixed(0)}%, ${m.quest.index + 1}/${m.quest.total}`);
}
console.log(`wrote ${path.relative(process.cwd(), file)} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await pool.close();
