import type { UserProfile } from '../types/Profile';
import { getStatPerfection } from './itemCalculations';
import { setDisplayName } from './skinArchive';

/** One substat across the equipped gear: how many rolls it has and how close they are to the top roll. */
export interface SubstatStatusRow {
    statId: string;
    rolls: number;
    /** Mean of the rolls' perfection, 0..100. */
    perfection: number;
    lowest: number;
}

export interface SubstatStatus {
    /** Mean perfection of every roll on the equipped items, active pets and mount; null without rolls. */
    overall: number | null;
    rolls: number;
    rows: SubstatStatusRow[];
}

/** Perfection (% of the SecondaryStatLibrary UpperRange) of every substat roll the profile wears. */
export function substatStatus(profile: UserProfile, secondaryStatLibrary: any): SubstatStatus {
    const pieces = [...Object.values(profile.items ?? {}), ...(profile.pets?.active ?? []), profile.mount?.active];
    const byStat = new Map<string, number[]>();
    for (const piece of pieces) {
        for (const s of piece?.secondaryStats ?? []) {
            const p = getStatPerfection(s.statId, s.value, secondaryStatLibrary);
            if (p === null) continue;
            const list = byStat.get(s.statId) ?? [];
            list.push(p);
            byStat.set(s.statId, list);
        }
    }
    const all = [...byStat.values()].flat();
    const rows = [...byStat].map(([statId, list]) => ({
        statId, rolls: list.length,
        perfection: list.reduce((a, b) => a + b, 0) / list.length,
        lowest: Math.min(...list),
    })).sort((a, b) => b.rolls - a.rolls || b.perfection - a.perfection);
    return { overall: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null, rolls: all.length, rows };
}

/**
 * The preset builds level to suggest: the highest one the player's rolls reach (an 84% player
 * gets the 80% builds, which assume no better rolls than theirs), the lowest one below them all.
 */
export function suggestedPerfection(overall: number | null, levels: number[]): number | null {
    if (overall === null || !levels.length) return null;
    const sorted = [...levels].sort((a, b) => a - b);
    return [...sorted].reverse().find(l => overall + 1e-9 >= l) ?? sorted[0];
}

/** A preset build the player aims for (Preset Builds ranking, "Aim for"): its substats, counted. */
export interface AimTarget {
    name: string;
    version: string | null;
    /** The substats of the build: rolls of each, and their perfection (every roll at the same level). */
    stats: { statId: string; rolls: number; perfection: number }[];
}

const AIM_KEY = 'substat_aim_target';

export function aimTargetOf(name: string, version: string | null, profile: UserProfile, secondaryStatLibrary: any): AimTarget {
    const s = substatStatus(profile, secondaryStatLibrary);
    return { name, version, stats: s.rows.map(r => ({ statId: r.statId, rolls: r.rolls, perfection: r.perfection })) };
}

export function saveAimTarget(t: AimTarget | null) {
    try {
        if (t) localStorage.setItem(AIM_KEY, JSON.stringify(t)); else localStorage.removeItem(AIM_KEY);
    } catch { /* blocked storage: the target is not kept */ }
}

export function loadAimTarget(): AimTarget | null {
    try {
        const raw = localStorage.getItem(AIM_KEY);
        return raw ? JSON.parse(raw) as AimTarget : null;
    } catch { return null; }
}

export type AimVerdict = 'done' | 'improve' | 'fewer' | 'missing' | 'notNeeded' | 'extra';

/** One substat of the comparison: the target's rolls and level against the player's. */
export interface AimRow {
    statId: string;
    target: { rolls: number; perfection: number } | null;
    /** total: the player's stat total as a share of the build's (100 = the same stat). */
    yours: { rolls: number; perfection: number; total: number | null } | null;
    verdict: AimVerdict;
}

/**
 * The player's substats against the target. The rolls of one substat add up (statEngine sums
 * every roll's value), so a stat is compared by its total: 88% + 92% is 90% + 90%.
 * missing: none of a stat the build has; fewer / improve: total short, with fewer rolls than the
 * build or not; done: total reached; extra: total reached with more rolls than the build (a slot
 * to spare); notNeeded: a stat the build does not have.
 */
export function compareToAim(profile: UserProfile, target: AimTarget, secondaryStatLibrary: any): AimRow[] {
    const pieces = [...Object.values(profile.items ?? {}), ...(profile.pets?.active ?? []), profile.mount?.active];
    const mine = new Map<string, number[]>();
    for (const piece of pieces) {
        for (const s of piece?.secondaryStats ?? []) {
            const p = getStatPerfection(s.statId, s.value, secondaryStatLibrary);
            if (p === null) continue;
            mine.set(s.statId, [...(mine.get(s.statId) ?? []), p]);
        }
    }
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const rows: AimRow[] = target.stats.map(t => {
        const list = mine.get(t.statId);
        const target = { rolls: t.rolls, perfection: t.perfection };
        if (!list?.length) return { statId: t.statId, target, yours: null, verdict: 'missing' };
        const total = sum(list) / (t.rolls * t.perfection) * 100;
        const yours = { rolls: list.length, perfection: sum(list) / list.length, total };
        const reached = total + 1e-6 >= 100;
        const verdict: AimVerdict = reached ? (list.length > t.rolls ? 'extra' : 'done') : list.length < t.rolls ? 'fewer' : 'improve';
        return { statId: t.statId, target, yours, verdict };
    });
    for (const [statId, list] of mine) {
        if (target.stats.some(t => t.statId === statId)) continue;
        rows.push({ statId, target: null, yours: { rolls: list.length, perfection: sum(list) / list.length, total: null }, verdict: 'notNeeded' });
    }
    return rows;
}

/** A preset build ranked by how far the player's substats are from it. */
export interface SimilarBuild {
    name: string;
    /** The category's name in the presets file. */
    category: string;
    rank: number;
    /** The build's substats (as "Aim for" takes them). */
    profile: UserProfile;
    /** Rolls at the build's level the player is short of, over every substat of the build (0 = all reached). */
    rollsShort: number;
    /** Substats of the build the player has no roll of. */
    missing: number;
    /** The skins the build wears ("Weapon:12"), all owned by the player; empty for a build without skins. */
    skins: string[];
    f2p: boolean;
}

/** The skins a profile wears, as "Type:idx". */
function wornSkins(p: UserProfile, slotToSkinType: Record<string, string>): string[] {
    return Object.entries(p.items ?? {}).flatMap(([slot, it]: [string, any]) => {
        const s = it?.skin;
        const type = s?.type ?? slotToSkinType[slot];
        return s && type != null ? [`${type}:${s.idx}`] : [];
    });
}

/**
 * The preset builds closest to the player's substats, easiest first. The distance is counted in
 * rolls at the build's level: for every substat of the build, how far the player's total is
 * under the build's total (the rolls of one substat add up, as compareToAim counts them), divided
 * by one roll; a substat the player lacks counts all its rolls. Builds with skins are candidates
 * only when the player owns every skin they wear (in the archive or worn now); when none is, the
 * builds without skins (F2P) are. Ties go to the better ranked build.
 */
export function mostSimilarBuilds(
    profile: UserProfile,
    file: { categories: { key: string; name: string }[]; presets: any[]; noSkins?: { categories: { key: string; name: string }[]; presets: any[] } },
    secondaryStatLibrary: any,
    slotToSkinType: Record<string, string>,
): SimilarBuild[] {
    const owned = new Set([
        ...(profile.skins?.saved ?? []).map(s => `${s.type}:${s.idx}`),
        ...wornSkins(profile, slotToSkinType),
    ]);
    const pieces = [...Object.values(profile.items ?? {}), ...(profile.pets?.active ?? []), profile.mount?.active];
    const mine = new Map<string, number>();
    for (const piece of pieces) {
        for (const s of (piece as any)?.secondaryStats ?? []) {
            const p = getStatPerfection(s.statId, s.value, secondaryStatLibrary);
            if (p !== null) mine.set(s.statId, (mine.get(s.statId) ?? 0) + p);
        }
    }
    const score = (p: any, f2p: boolean, categories: { key: string; name: string }[], name: string): SimilarBuild => {
        const target = substatStatus(p.profile, secondaryStatLibrary);
        let rollsShort = 0, missing = 0;
        for (const t of target.rows) {
            const have = mine.get(t.statId) ?? 0;
            if (!have) missing++;
            rollsShort += Math.max(0, t.rolls * t.perfection - have) / t.perfection;
        }
        return {
            name, category: categories.find(c => c.key === p.category)?.name ?? p.category, rank: p.rank ?? 0, profile: p.profile,
            rollsShort, missing, skins: f2p ? [] : [...new Set(wornSkins(p.profile, slotToSkinType))], f2p,
        };
    };
    const withSkins: SimilarBuild[] = [];
    for (const p of file.presets ?? []) {
        // The build and the same build with every other attack animation.
        const looks = [{ ...p, name: p.name }, ...(p.alternatives ?? []).map((a: any) => ({ ...p, profile: a.profile, name: `${p.name}, ${a.animation?.source === 'skin' && a.animation.setId ? `${setDisplayName(a.animation.setId)} skin` : 'weapon attack'}` }))];
        for (const l of looks) {
            if (!wornSkins(l.profile, slotToSkinType).every(k => owned.has(k))) continue;
            withSkins.push(score(l, false, file.categories ?? [], l.name));
        }
    }
    const pool = withSkins.length ? withSkins : (file.noSkins?.presets ?? []).map(p => score(p, true, file.noSkins!.categories ?? [], p.name));
    // The same substats under several names (a build and its looks): keep the first.
    const seen = new Set<string>();
    return pool
        .sort((a, b) => a.rollsShort - b.rollsShort || a.rank - b.rank)
        .filter(b => {
            const k = JSON.stringify(substatStatus(b.profile, secondaryStatLibrary).rows.map(r => [r.statId, r.rolls, Math.round(r.perfection)]));
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
}
