/**
 * The preset builds without some attack skins, with nothing calculated: the published file keeps
 * every build with every attack animation and its numbers (ProfilePresetsFile.variants for the stat
 * categories, ProfilePreset.alternatives for Most Power and the lab builds), so leaving a weapon
 * skin out only picks again among what is left:
 *   DPS / HPS   the category's builds with the animations left, ranked on the 24 h tested run
 *               like the published ones (equal results count once, the lower windup first);
 *   main quest  every one of those builds and Most Power's, ranked on the quest score;
 *   Most Power  Power reads no animation: the same build with the best animation left;
 *   lab         each lab build with its best animation left (arena rate against the other
 *               published builds), ordered again; the first is the Arena Champion.
 * An animation left out still counts when another set (or a weapon's own attack) runs the very same
 * attack row (PresetAnimation.sameAs): the build then shows that one, with the same numbers.
 * The arena tournament is read again from the pairings played ahead (ProfilePresetsFile.pairs,
 * every published build against every variant), with no battle; without them it is dropped once a
 * build changes.
 */
import type { PresetAnimation, PresetCategory, PresetVariant, ProfilePreset, ProfilePresetsFile, StatCategory } from './buildPresets';
import { applyAnimation, type AnimationSwap } from './equivalents';
import { fighterIdOf, tournamentFromPairs } from './tournament';
import type { LibraryData } from '../utils/statEngine';

const STAT_CATEGORIES: { key: StatCategory; metric: 'testedDps' | 'testedHps' }[] = [
    { key: 'dpsMelee', metric: 'testedDps' }, { key: 'dpsRanged', metric: 'testedDps' },
    { key: 'hpsMelee', metric: 'testedHps' }, { key: 'hpsRanged', metric: 'testedHps' },
];

const tie = (x: number, y: number) => Math.abs(x - y) <= Math.abs(y) * 1e-9;

/**
 * Lab build names, best first: each build's dominant substats (lab.unusual), "Variant N" when more
 * lab builds have the same ones with the same fairy, and the fairy. The page names every build this
 * way (src/presets/presetList.ts).
 */
export function labNames(builds: { unusual: string; fairy: string | null }[]): string[] {
    const group = (b: { unusual: string; fairy: string | null }) => `${b.unusual}|${b.fairy}`;
    const seen = new Map<string, number>();
    return builds.map(b => {
        const k = (seen.get(group(b)) ?? 0) + 1;
        seen.set(group(b), k);
        const many = builds.filter(x => group(x) === group(b)).length > 1;
        return `${b.unusual}${many ? `, Variant ${k}` : ''}, ${b.fairy ?? 'no fairy'}`;
    });
}

export function filterAnimations(file: ProfilePresetsFile, leftOut: ReadonlySet<string>, libs: LibraryData): ProfilePresetsFile {
    const { skinsLibrary, skinUpgradeLibrary } = libs as any;
    if (!leftOut.size) return file;

    /** The animation as it can still be shown: itself, an equivalent one, or null when every one is left out. */
    const usable = (a: PresetAnimation): AnimationSwap | 'same' | null => {
        if (a.source === 'weapon' || !a.setId || !leftOut.has(a.setId)) return 'same';
        for (const x of a.sameAs) {
            const w = /^weapon (\d+)$/.exec(x);
            if (w) return { source: 'weapon', weaponIdx: Number(w[1]), setId: null, windup: a.windup };
            if (!leftOut.has(x)) return { source: 'skin', weaponIdx: a.weaponIdx, setId: x, windup: a.windup };
        }
        return null;
    };
    /** The variant with an animation left, or null: itself, the same attack row, or one on the same ticks. */
    const allowed = (v: PresetVariant): PresetVariant | null => {
        let u = usable(v.animation);
        if (u === null) {
            const w = v.equivalents?.animations.find(x => x.source === 'weapon' || (x.setId && !leftOut.has(x.setId)));
            if (w) u = w;
        }
        if (u === null) return null;
        const eq = v.equivalents && {
            ...v.equivalents,
            animations: v.equivalents.animations.filter(w => !(w.source === 'skin' && w.setId && leftOut.has(w.setId))),
            sets: v.equivalents.sets.filter(id => !leftOut.has(id)),
        };
        if (u === 'same') return { ...v, equivalents: eq };
        // The look it takes is no longer one of its equivalents (it is the build's own now).
        const took = u;
        if (eq) eq.animations = eq.animations.filter(w => (took.source === 'skin' ? !(w.source === 'skin' && w.setId === took.setId) : !(w.source === 'weapon' && w.weaponIdx === took.weaponIdx)));
        const names = [v.animation.source === 'skin' ? v.animation.setId! : `weapon ${v.animation.weaponIdx}`, ...v.animation.sameAs];
        const self = u.source === 'skin' ? u.setId! : `weapon ${u.weaponIdx}`;
        return {
            ...v,
            profile: applyAnimation(v.profile, u, skinsLibrary, skinUpgradeLibrary),
            animation: { ...v.animation, source: u.source, weaponIdx: u.weaponIdx, setId: u.setId, windup: u.windup, sameAs: names.filter(n => n !== self && !leftOut.has(n)) },
            equivalents: eq,
        };
    };
    const asVariant = (p: ProfilePreset): PresetVariant => ({ animation: p.animation, profile: p.profile, metrics: p.metrics, equivalents: p.equivalents, arenaWinRate: p.lab?.arenaWinRate, fightKey: p.fightKey });
    const first = (category: PresetCategory) => file.presets.find(p => p.category === category);
    const make = (from: ProfilePreset, v: PresetVariant, rank: number, name: string): ProfilePreset => ({
        ...from, key: `${from.category}${rank}`, rank, name, animation: v.animation, equivalents: v.equivalents,
        profile: { ...v.profile, name }, metrics: v.metrics ?? from.metrics, fightKey: v.fightKey,
    });

    const out: ProfilePreset[] = [];
    let changed = false;
    const keep = (ps: ProfilePreset[]) => out.push(...ps);

    // Most Power: the same build, the best animation left by the 24 h tested DPS.
    const power = first('power');
    if (power) {
        const options = [asVariant(power), ...(power.alternatives ?? [])].map(allowed).filter((v): v is PresetVariant => !!v);
        const pick = options.sort((x, y) => (y.metrics?.testedDps ?? 0) - (x.metrics?.testedDps ?? 0) || x.animation.windup - y.animation.windup)[0];
        if (!pick) changed = true;
        else {
            if (pick.profile !== power.profile) changed = true;
            out.push(pick.profile === power.profile ? power : make(power, pick, 1, power.name));
        }
    }

    // DPS / HPS: the category's builds with the animations left, as statCategory ranks them.
    const pools: PresetVariant[] = [];
    for (const { key, metric } of STAT_CATEGORIES) {
        const published = file.presets.filter(p => p.category === key).sort((a, b) => a.rank - b.rank);
        const all = file.variants?.[key];
        if (!published.length) continue;
        if (!all?.length || all.some(v => !v.metrics)) { keep(published); continue; }
        const left = all.map(allowed).filter((v): v is PresetVariant => !!v);
        pools.push(...left);
        left.sort((x, y) => (tie(x.metrics![metric], y.metrics![metric]) ? x.animation.windup - y.animation.windup : y.metrics![metric] - x.metrics![metric]));
        const top: PresetVariant[] = [];
        for (const v of left) {
            if (top.length >= published.length) break;
            if (!top.some(t => tie(v.metrics![metric], t.metrics![metric]))) top.push(v);
        }
        const base = published[0];
        const catName = base.name.replace(/ #\d+$/, '');
        top.forEach((v, i) => out.push(make(base, v, i + 1, top.length > 1 ? `${catName} #${i + 1}` : catName)));
        if (top.length !== published.length || top.some((v, i) => JSON.stringify(v.profile) !== JSON.stringify(published[i].profile))) changed = true;
    }

    // Main quest: every build above and Most Power's, on the quest score (ties: the higher DPS).
    const quest = file.presets.filter(p => p.category === 'quest').sort((a, b) => a.rank - b.rank);
    if (quest.length) {
        const candidates = [...pools, ...(power ? [asVariant(power), ...(power.alternatives ?? [])].map(allowed).filter((v): v is PresetVariant => !!v) : [])];
        if (candidates.some(v => v.metrics?.quest.score === undefined)) keep(quest);
        else {
            candidates.sort((x, y) => y.metrics!.quest.score! - x.metrics!.quest.score! || y.metrics!.dps - x.metrics!.dps);
            const top: PresetVariant[] = [];
            for (const v of candidates) {
                if (top.length >= quest.length) break;
                // The same fight (fightKey: another look of one build) counts once.
                if (!top.some(t => (t.fightKey && t.fightKey === v.fightKey) || JSON.stringify(t.profile) === JSON.stringify(v.profile))) top.push(v);
            }
            const catName = quest[0].name.replace(/ #\d+$/, '');
            top.forEach((v, i) => out.push(make(quest[0], v, i + 1, top.length > 1 ? `${catName} #${i + 1}` : catName)));
            if (top.some((v, i) => JSON.stringify(v.profile) !== JSON.stringify(quest[i]?.profile))) changed = true;
        }
    }

    // Lab: each build with its best animation left, ordered again on the arena rate (equal rates:
    // the lower windup, as in the published file).
    const lab = file.presets.filter(p => p.category === 'lab');
    const labLeft = lab.flatMap(p => {
        const options = [asVariant(p), ...(p.alternatives ?? [])].map(allowed).filter((v): v is PresetVariant => !!v)
            .sort((x, y) => (y.arenaWinRate ?? 0) - (x.arenaWinRate ?? 0) || x.animation.windup - y.animation.windup);
        if (!options.length) return [];
        if (options[0].profile !== p.profile) changed = true;
        return [{ p, v: options[0] }];
    }).sort((x, y) => (y.v.arenaWinRate ?? 0) - (x.v.arenaWinRate ?? 0));
    if (labLeft.length !== lab.length) changed = true;
    const names = labNames(labLeft.map(({ p }) => ({ unusual: p.lab?.unusual ?? p.name, fairy: p.profile.misc.fairy?.name ?? null })));
    labLeft.forEach(({ p, v }, i) => {
        const name = names[i];
        if (name !== p.name) changed = true;
        out.push({ ...make(p, v, i + 1, name), lab: p.lab && { ...p.lab, arenaWinRate: v.arenaWinRate ?? p.lab.arenaWinRate } });
    });

    if (!changed) return { ...file, presets: out };
    const tournament = file.pairs
        ? tournamentFromPairs(out.map(p => ({ key: p.key, name: p.name, id: fighterIdOf(p.profile, libs) })), file.pairs) ?? undefined
        : undefined;
    return { ...file, presets: out, tournament };
}
