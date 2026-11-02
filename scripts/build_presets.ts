/**
 * Builds the preset profiles of one config version and writes
 * public/parsed_configs/<version>/ProfilePresets.json, the file the Preset Builds page reads: the
 * Most Power build and the five best builds of each category (DPS and HPS, melee and ranged, main
 * quest), then an arena round robin between all of them.
 *
 *   npx tsx scripts/build_presets.ts [version]     (default: the newest in versions.json)
 *   npx tsx scripts/build_presets.ts [version] --tournament-only
 *       keeps the builds of the existing file and only reruns the arena round robin
 *   npx tsx scripts/build_presets.ts [version] --perfection 90
 *       every substat rolled at 90% of its top roll; written next to the 100% file as
 *       ProfilePresets[.fairies_2026_11].p90.json (src/utils/fairies.ts presetsFileBase)
 *
 * The fairy season is the one live now; VITE_NEW_FAIRIES_NOW=1 in the environment builds on the
 * new one (and writes the .fairies_2026_11 files).
 *
 * The libraries are the ones useStatLibraries gives the app, built from the same files with the
 * same transforms (src/utils/gameDataTransforms.ts). Run it after every config import, then
 * `npm run update-configs` so the manifests list the new file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildProfilePresets, type ProfilePresetsFile } from '../src/presets/buildPresets';
import { decodePair, fighterIdOf, tournamentFromPairs, type PairResults } from '../src/presets/tournament';
import type { UserProfile } from '../src/types/Profile';
import { pvpConfigFromJson } from '../src/pvp/simulate';
import { CONFIG_ROOT as ROOT, loadPresetLibs } from './presetLibs';
import { workerPool } from './presetPool';
import { isNewSeason, presetsFileBase } from '../src/utils/fairies';
const versions: string[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
const args = process.argv.slice(2);
const tournamentOnly = args.includes('--tournament-only');
const pIdx = args.indexOf('--perfection');
const perfection = pIdx >= 0 ? Number(args[pIdx + 1]) : 100;
if (!(perfection > 0 && perfection <= 100)) throw new Error(`bad --perfection ${args[pIdx + 1]}`);
const version = args.find((a, i) => !a.startsWith('--') && i !== pIdx + 1) ?? versions[0];
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
const file = path.join(dir, presetsFileBase(isNewSeason(), perfection));
log(`${path.basename(file)}: substats at ${perfection}%, ${isNewSeason() ? 'new' : 'current'} fairy season`);
const out: ProfilePresetsFile = tournamentOnly
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : buildProfilePresets(version, libs, cfg, { log, pool, perfection });
out.perfection = perfection;
// Checkpoint: the builds are saved before the tournament, so it can rerun alone (--tournament-only).
if (!tournamentOnly) fs.writeFileSync(file, JSON.stringify(out));
const arena = pvpConfigFromJson(cfg.PvpBaseConfig);
if (!arena) throw new Error('PvpBaseConfig.json is missing or incomplete');
// Every pairing between the published builds and every variant of them (each attack animation of
// the stat categories, Most Power and the lab builds), played once: the tournament of the
// published builds, and of any attack skins the page leaves out, is read from these.
log('pairings');
const everyBuild: UserProfile[] = [
    ...out.presets.map(p => p.profile),
    ...out.presets.flatMap(p => (p.alternatives ?? []).map(v => v.profile)),
    ...Object.values(out.variants ?? {}).flatMap(vs => (vs ?? []).map(v => v.profile)),
];
const byId = new Map<string, UserProfile>();
for (const p of everyBuild) { const id = fighterIdOf(p, libs); if (!byId.has(id)) byId.set(id, p); }
// Each build's id in the pairings, so the page does not rebuild every fighter to find it.
for (const p of out.presets) {
    p.fighterId = fighterIdOf(p.profile, libs);
    for (const v of p.alternatives ?? []) v.fighterId = fighterIdOf(v.profile, libs);
}
for (const vs of Object.values(out.variants ?? {})) for (const v of vs ?? []) v.fighterId = fighterIdOf(v.profile, libs);
const ids = [...byId.keys()].sort();
const tasks: { a: string; b: string }[] = [];
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) tasks.push({ a: ids[i], b: ids[j] });
log(`pairings: ${ids.length} distinct fighters, ${tasks.length} pairs, ${TOURNAMENT_BATTLES_PER_SIDE} battles a side`);
const codes = pool.many(tasks.map(t => ({ kind: 'pair', a: byId.get(t.a)!, b: byId.get(t.b)!, perSide: TOURNAMENT_BATTLES_PER_SIDE })));
const pairs: PairResults = { battlesPerSide: TOURNAMENT_BATTLES_PER_SIDE, results: Object.fromEntries(tasks.map((t, i) => [`${t.a}|${t.b}`, decodePair(codes[i])])) };
out.pairs = pairs;
log('tournament');
const tournament = tournamentFromPairs(out.presets.map(p => ({ key: p.key, name: p.name, id: fighterIdOf(p.profile, libs) })), pairs);
if (!tournament) throw new Error('a published build has no pairings');
out.tournament = tournament;
out.tournament.standings.forEach((s, i) => log(`#${i + 1} ${s.name}: ${s.wins}-${s.draws}-${s.losses}, ${(s.winRate * 100).toFixed(1)}%, HP margin ${s.hpMargin.toFixed(3)}`));
fs.writeFileSync(file, JSON.stringify(out));
for (const p of out.presets) {
    const m = p.metrics;
    console.log(`${p.name.padEnd(16)} ${p.animation.source === 'skin' ? `${p.animation.setId} skin` : `weapon ${p.animation.weaponIdx}, any skin hidden`} ${p.animation.windup.toFixed(3)}s  power ${m.power.toExponential(4)}  dps ${m.dps.toExponential(4)} (tested ${m.testedDps.toExponential(4)})  hps ${m.hps.toExponential(4)} (tested ${m.testedHps.toExponential(4)})  quest: ${m.quest.label} (${(m.quest.winRate * 100).toFixed(0)}%), next ${m.quest.nextLabel} ${(m.quest.nextWinRate * 100).toFixed(0)}%, ${m.quest.index + 1}/${m.quest.total}`);
}
console.log(`wrote ${path.relative(process.cwd(), file)} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await pool.close();
