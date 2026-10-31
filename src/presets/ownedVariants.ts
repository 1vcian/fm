/**
 * "My best variants": the preset builds again, with only the skins the player owns.
 *
 * Nothing is searched again. The published file keeps, per stat category, the build for every
 * distinct attack animation (ProfilePresetsFile.variants; the search runs without skins and the
 * skins are put on afterwards, and that gives the very same builds as searching with them). Here:
 *   1. only the animations the player can use: every weapon's own, and the weapon skins they own
 *      (or another skin with the very same attack row, PresetAnimation.sameAs);
 *   2. the player's own pieces put on with their real rolls and levels (applyBestSkins: complete
 *      sets for the bonus, or the best single pieces);
 *   3. ranked on the 24 h tested run like the presets; Most Power, main quest, build lab and the
 *      arena tournament from those builds.
 */
import type { SavedSkin, UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import {
    CATEGORIES, PRESETS_PER_CATEGORY, battleLibsOf, presetMetrics, testedOf,
    type ConfigFiles, type PresetAnimation, type PresetCategory, type ProfilePreset, type ProfilePresetsFile, type StatCategory,
} from './buildPresets';
import { applyBestSkins, ownedPieces, wearSkins } from './skinsApply';
import type { AnimationSwap } from './equivalents';
import { QuestMeter } from './mainProgress';
import { EvalCore, localPool } from './evalPool';
import { pvpConfigFromJson } from '../pvp/simulate';
import { runTournament } from './tournament';

export interface OwnedOptions {
    /** Main quest runs per battle while ranking and for the published numbers. */
    questSearchRuns: number;
    questFinalRuns: number;
    /** Arena battles per side and opponent (build lab) and per pair (tournament). */
    labBattles: number;
    tournamentBattles: number;
    log: (msg: string) => void;
}

const STAT_CATEGORIES: { key: StatCategory; metric: 'dps' | 'hps' }[] = [
    { key: 'dpsMelee', metric: 'dps' }, { key: 'dpsRanged', metric: 'dps' }, { key: 'hpsMelee', metric: 'hps' }, { key: 'hpsRanged', metric: 'hps' },
];

export function buildOwnedPresets(site: ProfilePresetsFile, saved: SavedSkin[], libs: LibraryData, cfg: ConfigFiles, opts: OwnedOptions): ProfilePresetsFile {
    if (!site.variants) throw new Error('the preset builds of this version have no variants to start from');
    const pieces = ownedPieces(saved, libs.skinsLibrary);
    const ownedWeaponSets = new Set(pieces.filter(p => p.type === 'Weapon').map(p => p.setId));
    const formula = (metric: 'dps' | 'hps' | 'power') => (p: UserProfile) => {
        const s = calculateStats(p, libs, metric === 'power');
        return (metric === 'dps' ? s.realTotalDps : metric === 'hps' ? s.realTotalHps : s.power) || 0;
    };
    /** The attack a variant can keep with the player's skins: its own, or one with the very same row. */
    const usableSwap = (a: PresetAnimation): AnimationSwap | null => {
        if (a.source === 'weapon') return { source: 'weapon', weaponIdx: a.weaponIdx, setId: null, windup: a.windup };
        for (const id of [a.setId!, ...a.sameAs]) {
            if (/^weapon \d+$/.test(id)) return { source: 'weapon', weaponIdx: Number(id.slice(7)), setId: null, windup: a.windup };
            if (ownedWeaponSets.has(id)) return { source: 'skin', weaponIdx: a.weaponIdx, setId: id, windup: a.windup };
        }
        return null;
    };
    const animationOf = (w: AnimationSwap): PresetAnimation => ({ source: w.source, weaponIdx: w.weaponIdx, setId: w.setId, windup: w.windup, sameAs: [] });

    // ---- the four stat categories
    const tie = (x: number, y: number) => Math.abs(x - y) <= Math.abs(y) * 1e-9;
    const built = new Map<StatCategory, { p: UserProfile; w: AnimationSwap; v: number }[]>();
    for (const { key, metric } of STAT_CATEGORIES) {
        const score = formula(metric);
        const seen = new Set<string>();
        const cands = site.variants[key]!.flatMap(v => {
            const w = usableSwap(v.animation);
            const id = w ? `${w.source}:${w.setId ?? w.weaponIdx}` : '';
            if (!w || seen.has(id)) return [];
            seen.add(id);
            const p = applyBestSkins(v.profile, w, pieces, score);
            return p ? [{ p, w, v: testedOf(p, libs)[metric] }] : [];
        }).sort((a, b) => (tie(a.v, b.v) ? a.w.windup - b.w.windup : b.v - a.v));
        built.set(key, cands);
        opts.log(`${key}: ${cands.length} animations you can use, best ${cands[0]?.v.toPrecision(5) ?? 'none'}`);
    }
    const topOf = (key: StatCategory) => {
        const out: { p: UserProfile; w: AnimationSwap; v: number }[] = [];
        for (const c of built.get(key)!) if (out.length < PRESETS_PER_CATEGORY && !out.some(t => tie(t.v, c.v))) out.push(c);
        return out;
    };

    // ---- Most Power: the DPS builds re-dressed for Power (Power reads the skins, not the substats)
    const powerScore = formula('power');
    const power = (['dpsMelee', 'dpsRanged'] as const)
        .flatMap(k => built.get(k)!.slice(0, 1))
        .map(c => ({ p: applyBestSkins(c.p, c.w, pieces, powerScore) ?? c.p, w: c.w }))
        .map(c => ({ ...c, v: powerScore(c.p) }))
        .sort((a, b) => b.v - a.v)[0];

    // ---- main quest: every build above, walked from where the best DPS builds get
    const core = new EvalCore(libs, battleLibsOf(libs, cfg), pvpConfigFromJson(cfg.PvpBaseConfig));
    const pool = localPool(core);
    const questSearch = new QuestMeter(battleLibsOf(libs, cfg), opts.questSearchRuns, pool);
    const all = STAT_CATEGORIES.flatMap(({ key }) => built.get(key)!);
    for (const c of [built.get('dpsMelee')![0], built.get('dpsRanged')![0]]) if (c) questSearch.measure(c.p);
    const questFinal = new QuestMeter(battleLibsOf(libs, cfg), opts.questFinalRuns, pool);
    const dpsOf = formula('dps');
    const quest = all
        .map(c => ({ ...c, q: questSearch.measure(c.p, questSearch.hintIndex).score }))
        .sort((a, b) => b.q - a.q)
        .slice(0, 2 * PRESETS_PER_CATEGORY)
        .map(c => ({ ...c, q: questFinal.measure(c.p).score }))
        .sort((a, b) => b.q - a.q || dpsOf(b.p) - dpsOf(a.p))
        .filter((c, i, list) => list.findIndex(x => x.w.source === c.w.source && x.w.setId === c.w.setId && x.w.weaponIdx === c.w.weaponIdx) === i)
        .slice(0, PRESETS_PER_CATEGORY);
    opts.log('main quest done');

    // ---- published, then the build lab and the tournament
    const metricsOf = presetMetrics(libs, cfg, { questFinalRuns: opts.questFinalRuns, pool });
    const info = new Map(CATEGORIES.map(c => [c.key, c]));
    const presets: ProfilePreset[] = [];
    const publish = (category: PresetCategory, list: { p: UserProfile; w: AnimationSwap }[]) => {
        const c = info.get(category)!;
        list.forEach(({ p, w }, i) => {
            const name = list.length > 1 ? `${c.name} #${i + 1}` : c.name;
            const ranged = (libs.weaponLibrary as any)?.[`{'Age': ${p.items.Weapon!.age}, 'Type': 'Weapon', 'Idx': ${p.items.Weapon!.idx}}`]?.IsRanged === true;
            presets.push({
                key: `${category}${i + 1}`, category, rank: i + 1, name, goal: c.goal, weapons: category === 'quest' ? 'any' : ranged ? 'ranged' : 'melee',
                description: `${c.description} With your own skins only.`, animation: animationOf(w),
                profile: { ...p, id: '', name, isShared: undefined }, metrics: metricsOf(p),
            });
        });
    };
    if (power) publish('power', [power]);
    for (const { key } of STAT_CATEGORIES) publish(key, topOf(key));
    publish('quest', quest);
    opts.log('numbers measured');

    const arena = pvpConfigFromJson(cfg.PvpBaseConfig);
    if (arena) {
        // The published lab builds, with the player's skins on (their attack kept when the player can).
        const field = presets.filter(p => p.rank === 1).map(p => p.profile);
        const labInfo = info.get('lab')!;
        site.presets.filter(p => p.category === 'lab').forEach(lp => {
            const w = usableSwap(lp.animation) ?? { source: 'weapon' as const, weaponIdx: lp.animation.weaponIdx, setId: null, windup: lp.animation.windup };
            // Never the lab's own (maxed) skins: without a usable piece it wears none.
            const p = applyBestSkins(lp.profile, w, pieces, formula('dps')) ?? wearSkins(lp.profile, w, {});
            const rate = pool.arena(p, field, opts.labBattles);
            presets.push({
                ...lp, profile: { ...p, id: '', name: lp.name, isShared: undefined }, animation: animationOf(w), metrics: metricsOf(p), equivalents: undefined,
                description: `${labInfo.description} With your own skins it wins ${(rate * 100).toFixed(1)}% of its arena battles against your category builds.`,
                lab: { arenaWinRate: rate, unusual: lp.lab?.unusual ?? '' },
            });
        });
        opts.log('arena tournament');
        const file: ProfilePresetsFile = { version: site.version, categories: CATEGORIES, presets };
        file.tournament = runTournament(presets, libs, arena, opts.tournamentBattles, () => {});
        return file;
    }
    return { version: site.version, categories: CATEGORIES, presets };
}
