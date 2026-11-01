/**
 * The preset page's list: every distinct build once, named by what it is, with what it is best at
 * as tags. The categories (Most Power, DPS, HPS, main quest, the build lab) only pick builds; a
 * build that tops several is one card with several tags, and the page filters on the tags and sorts
 * on the numbers (Power, DPS, HPS, main quest, arena).
 *
 * Names: the build's three most rolled substats, "Variant N" when more builds have the same ones
 * with the same fairy (numbered by the arena tournament, the strongest first), and the fairy.
 */
import type { PresetCategory, PresetVariant, ProfilePreset, ProfilePresetsFile } from './buildPresets';
import { fighterIdOf } from './tournament';
import type { LibraryData } from '../utils/statEngine';
import { STAT_NAMES } from '../utils/statNames';
import type { UserProfile } from '../types/Profile';

export type BuildTagKind = 'power' | 'dps' | 'hps' | 'quest' | 'lab';

export interface BuildTag {
    kind: BuildTagKind;
    /** e.g. "Most Power", "DPS Melee #2", "PvP lab". */
    label: string;
    /** The rank in its category (1 = the best). */
    rank: number;
}

export interface ListedBuild {
    preset: ProfilePreset;
    tags: BuildTag[];
    /** Keys of the published builds this card stands for (the same build in several categories). */
    keys: string[];
}

const KIND: Record<PresetCategory, BuildTagKind> = {
    power: 'power', dpsMelee: 'dps', dpsRanged: 'dps', hpsMelee: 'hps', hpsRanged: 'hps', quest: 'quest', lab: 'lab',
};
const LABEL: Record<PresetCategory, string> = {
    power: 'Most Power', dpsMelee: 'DPS Melee', dpsRanged: 'DPS Ranged', hpsMelee: 'HPS Melee', hpsRanged: 'HPS Ranged', quest: 'Main Quest', lab: 'PvP lab',
};

/** Rolls per substat over every body, most rolled first (ties by name). */
export function substatCounts(p: UserProfile): [string, number][] {
    const counts = new Map<string, number>();
    for (const body of [...Object.values(p.items), ...p.pets.active, p.mount.active]) {
        for (const st of body?.secondaryStats ?? []) counts.set(st.statId, (counts.get(st.statId) ?? 0) + 1);
    }
    return [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}

/** "Health + Attack Speed + Double Chance": the three most rolled substats. */
export const dominantStats = (p: UserProfile) => substatCounts(p).slice(0, 3).map(([id]) => STAT_NAMES[id] ?? id).join(' + ') || 'No substats';

/** Everything that makes the build, without its name and id. */
const buildSig = (p: UserProfile) => JSON.stringify({ ...p, id: '', name: '', isShared: undefined });
/** Builds that fight the same (ProfilePreset.fightKey: another look of one build) are one card. */
const cardSig = (p: ProfilePreset) => p.fightKey ?? buildSig(p.profile);

export function listBuilds(file: ProfilePresetsFile): { builds: ListedBuild[]; renamed: ProfilePresetsFile } {
    const standings = file.tournament?.standings ?? [];
    const arenaIndex = new Map(standings.flatMap((s, i) => [s.key, ...(s.same ?? [])].map(k => [k, i] as const)));
    const groups = new Map<string, ListedBuild>();
    for (const p of file.presets) {
        const sig = cardSig(p);
        const tag: BuildTag = { kind: KIND[p.category], label: p.category === 'power' || p.category === 'lab' ? LABEL[p.category] : `${LABEL[p.category]} #${p.rank}`, rank: p.rank };
        const g = groups.get(sig);
        if (g) { g.tags.push(tag); g.keys.push(p.key); }
        else groups.set(sig, { preset: p, tags: [tag], keys: [p.key] });
    }
    const builds = [...groups.values()];
    // Names, numbered by the arena tournament (strongest first).
    const order = [...builds].sort((a, b) => (arenaIndex.get(a.preset.key) ?? 1e9) - (arenaIndex.get(b.preset.key) ?? 1e9));
    const groupOf = (b: ListedBuild) => `${dominantStats(b.preset.profile)}|${b.preset.profile.misc.fairy?.name ?? null}`;
    const total = new Map<string, number>();
    for (const b of order) total.set(groupOf(b), (total.get(groupOf(b)) ?? 0) + 1);
    const seen = new Map<string, number>();
    const nameOf = new Map<string, string>();
    for (const b of order) {
        const k = (seen.get(groupOf(b)) ?? 0) + 1;
        seen.set(groupOf(b), k);
        const fairy = b.preset.profile.misc.fairy?.name ?? 'no fairy';
        const name = `${dominantStats(b.preset.profile)}${total.get(groupOf(b))! > 1 ? `, Variant ${k}` : ''}, ${fairy}`;
        for (const key of b.keys) nameOf.set(key, name);
        b.preset = { ...b.preset, name, profile: { ...b.preset.profile, name } };
    }
    const renamed: ProfilePresetsFile = {
        ...file,
        presets: file.presets.map(p => ({ ...p, name: nameOf.get(p.key) ?? p.name, profile: { ...p.profile, name: nameOf.get(p.key) ?? p.name } })),
        tournament: file.tournament && { ...file.tournament, standings: file.tournament.standings.map(s => ({ ...s, name: nameOf.get(s.key) ?? s.name })) },
    };
    return { builds, renamed };
}

/** One build with one of its other attack skins, entered against the published builds. */
export interface OtherSkinRow {
    /** The card it is another look of (its name), or the build's own description. */
    baseKey: string | null;
    name: string;
    /** The variant (its animation and equivalents name the skins). */
    variant: PresetVariant;
    wins: number;
    draws: number;
    losses: number;
    battles: number;
    winRate: number;
    hpMargin: number;
}

/** A build without its look: the weapon kind but not which weapon, skin stats but not which set. */
function baseOf(p: UserProfile): string {
    const q: UserProfile = JSON.parse(JSON.stringify(p));
    q.id = ''; q.name = '';
    for (const it of Object.values(q.items)) {
        if (!it) continue;
        if (it.skin) it.skin = { stats: it.skin.stats } as any;
    }
    if (q.items.Weapon) q.items.Weapon.idx = -1;
    q.skins = { saved: [] };
    q.misc = { ...q.misc, useSkinWindup: undefined };
    return JSON.stringify(q);
}

/**
 * Every other attack skin of every build (the published variants and alternatives), each entered
 * against the published builds on the pairings played ahead, as "Fight against" enters a profile:
 * a build with another skin can beat the next build with its best one. Looks that fight the same
 * (fightKey) are one row; the published looks themselves are left out (they are the ranking).
 */
export function otherSkinRows(file: ProfilePresetsFile, libs: LibraryData, skip: (v: PresetVariant) => boolean): OtherSkinRow[] {
    const pairs = file.pairs;
    if (!pairs) return [];
    const field = file.presets.map(p => ({ id: p.fighterId ?? fighterIdOf(p.profile, libs), key: p.key }));
    const fieldIds = [...new Set(field.map(f => f.id))];
    const published = new Set(file.presets.map(p => p.fightKey).filter(Boolean));
    const baseName = new Map(file.presets.map(p => [baseOf(p.profile), p.key]));
    const all: PresetVariant[] = [
        ...file.presets.flatMap(p => p.alternatives ?? []),
        ...Object.values(file.variants ?? {}).flatMap(vs => vs ?? []),
    ];
    const seen = new Set<string>();
    const rows: OtherSkinRow[] = [];
    const n = 2 * pairs.battlesPerSide;
    for (const v of all) {
        const fk = v.fightKey ?? JSON.stringify(v.profile);
        if (published.has(fk) || seen.has(fk) || skip(v)) continue;
        seen.add(fk);
        const id = v.fighterId ?? fighterIdOf(v.profile, libs);
        let w = 0, d = 0, l = 0, m = 0, battles = 0, missing = false;
        for (const o of fieldIds) {
            if (o === id) continue;
            const flip = id > o;
            const r = pairs.results[flip ? `${o}|${id}` : `${id}|${o}`];
            if (!r) { missing = true; break; }
            const [aw, dr, bw, mg] = r;
            w += flip ? bw : aw; l += flip ? aw : bw; d += dr; m += flip ? -mg : mg; battles += n;
        }
        if (missing || !battles) continue;
        const baseKey = baseName.get(baseOf(v.profile)) ?? null;
        rows.push({ baseKey, name: `${dominantStats(v.profile)}, ${v.profile.misc.fairy?.name ?? 'no fairy'}`, variant: v,
            wins: w, draws: d, losses: l, battles, winRate: (w + d / 2) / battles, hpMargin: m / battles });
    }
    return rows;
}
