/**
 * Build optimizer: the best skills + pets + mount for a profile, in absolute terms.
 *
 * Pure (no React, no DOM) so it runs inside src/workers/optimizer.worker.ts and under tsx.
 *
 *   stage 1  every candidate is scored with the analytic formulas of the stat engine
 *            (calculateStats: real-time DPS, real-time HPS, Power). Skill sets and pets + mount
 *            loadouts are scored on their own first (each on the current other half), the best of
 *            each are then crossed and scored again. The shortlist is the union of the best by
 *            DPS, by HPS and by Power: no blended DPS x HPS score decides anything.
 *   stage 2  the shortlist (plus the current build) fights simulated arena battles
 *            (src/pvp/simulate.ts, the verified engine) against one reference fighter. Every
 *            candidate uses the same seeds and plays both sides, Player 1 and Player 2, so the
 *            turn order effect cancels. Ranked by win rate (draw = half a win), then HP margin.
 */
import type { MountSlot, PetSlot, SkillSlot, UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import type { PvpHpConfig } from '../engine';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { PvpBattle } from '../pvp/simulate';

export interface LoadoutCombo {
    petSet: PetSlot[];
    mount: MountSlot | null;
}

const mountKey = (m: MountSlot) => `${m.id}|${m.rarity}|${m.level}|${JSON.stringify(m.secondaryStats)}`;

/** All k-subsets (k = min(n, size)) of items, in index order. */
function subsets<T>(items: T[], size: number): T[][] {
    const k = Math.min(items.length, size);
    const out: T[][] = [];
    if (k === 0) return out;
    const pick: T[] = [];
    const rec = (start: number) => {
        if (pick.length === k) { out.push([...pick]); return; }
        for (let i = start; i < items.length; i++) {
            pick.push(items[i]);
            rec(i + 1);
            pick.pop();
        }
    };
    rec(0);
    return out;
}

/**
 * Every pets + mount combination over the saved builds: up to `petSlots` (PetBaseConfig.PetSlotsCount)
 * of the saved pets (the active pets when none are saved) times the active + saved mounts, deduplicated.
 */
export function enumerateLoadouts(p: UserProfile, petSlots: number): LoadoutCombo[] {
    const savedPets = p.pets.savedBuilds || [];
    const petSets = subsets(savedPets, petSlots);
    if (petSets.length === 0) petSets.push(p.pets.active);

    const mounts: (MountSlot | null)[] = [];
    const seen = new Set<string>();
    for (const m of [p.mount.active, ...(p.mount.savedBuilds || [])]) {
        if (!m) continue;
        const key = mountKey(m);
        if (seen.has(key)) continue;
        seen.add(key);
        mounts.push(m);
    }
    if (mounts.length === 0) mounts.push(p.mount.active);

    const out: LoadoutCombo[] = [];
    for (const petSet of petSets) for (const mount of mounts) out.push({ petSet, mount });
    return out;
}

/** The highest level a skill has data for: the longer of its per-level arrays. */
export function skillMaxLevel(entry: any): number {
    return Math.max(entry?.DamagePerLevel?.length || 0, entry?.HealthPerLevel?.length || 0, 1);
}

/** Owned skills: the profile's skill levels > 0 (passives), plus equipped ones with a level. */
export function ownedSkillLevels(p: UserProfile): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, lv] of Object.entries(p.skills.passives || {})) if (lv > 0) out[id] = lv;
    for (const s of p.skills.equipped || []) if (s?.id && s.level > 0 && !out[s.id]) out[s.id] = s.level;
    return out;
}

export type OptimizerScope = 'all' | 'skills' | 'loadout';

export interface OptimizerOptions {
    scope: OptimizerScope;
    /** True: only owned skills at their levels. False: every SkillLibrary skill. */
    ownedSkillsOnly: boolean;
    /** Level for skills the profile does not own (clamped to each skill's max). */
    unownedSkillLevel: number;
    /** Battles per side: each candidate fights 2 * this many battles. */
    battlesPerSide: number;
    /** Candidates that go to stage 2 (the current build is always added). */
    shortlist: number;
    /** Power only: the In-game/Substats toggle of the profile card. */
    excludeSubstats: boolean;
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
    scope: 'all',
    ownedSkillsOnly: false,
    unownedSkillLevel: 0, // 0 = each skill's max level from the config
    battlesPerSide: 100,
    shortlist: 30,
    excludeSubstats: false,
};

export interface OptimizerInput {
    /** The build to improve, tree mode already applied. */
    base: UserProfile;
    /** Opponent; null = a mirror of the base build. */
    reference: UserProfile | null;
    referenceName: string;
    libs: LibraryData;
    pvpConfig: PvpHpConfig;
    options: OptimizerOptions;
}

export interface Candidate {
    skills: SkillSlot[];
    petSet: PetSlot[];
    mount: MountSlot | null;
    dps: number;
    hps: number;
    power: number;
    isCurrent: boolean;
}

export interface RankedCandidate extends Candidate {
    battles: number;
    wins: number;
    draws: number;
    losses: number;
    /** (wins + draws / 2) / battles. */
    winRate: number;
    /** Standard error of winRate, sqrt(p (1 - p) / n). */
    winRateSe: number;
    /** Mean of (own HP fraction - opponent HP fraction) at the end of each battle. */
    hpMargin: number;
}

export interface OptimizerResult {
    ranked: RankedCandidate[];
    /** calculateStats runs in stage 1. */
    scored: number;
    battles: number;
    stage1Ms: number;
    stage2Ms: number;
    referenceName: string;
}

export type OptimizerProgress = (stage: 1 | 2, done: number, total: number) => void;

const skillsKey = (s: SkillSlot[]) => s.map(x => `${x.id}:${x.level}`).sort().join(',');
const loadoutKey = (c: LoadoutCombo) =>
    JSON.stringify([c.petSet.map(p => [p.id, p.rarity, p.level, p.secondaryStats]), c.mount ? mountKey(c.mount) : null]);
const candidateKey = (c: { skills: SkillSlot[] } & LoadoutCombo) => `${skillsKey(c.skills)}#${loadoutKey(c)}`;

/** Skill candidates per the options: SkillSlots ready to equip. */
export function skillPool(base: UserProfile, libs: LibraryData, o: OptimizerOptions): SkillSlot[] {
    const lib = (libs.skillLibrary || {}) as Record<string, any>;
    const owned = ownedSkillLevels(base);
    const asc = base.misc.skillAscensionLevel || 0;
    const equippedAsc = (id: string) => base.skills.equipped?.find(s => s?.id === id)?.ascensionLevel;
    const out: SkillSlot[] = [];
    for (const id of Object.keys(lib)) {
        const max = skillMaxLevel(lib[id]);
        let level = owned[id];
        if (!level) {
            if (o.ownedSkillsOnly) continue;
            level = o.unownedSkillLevel > 0 ? Math.min(o.unownedSkillLevel, max) : max;
        }
        out.push({ id, rarity: lib[id].Rarity || 'Common', level, evolution: 0, ascensionLevel: equippedAsc(id) ?? asc });
    }
    return out;
}

/** Union of the top `n` by each view, in round-robin order (best DPS, best HPS, best Power, ...). */
function shortlistByViews<T extends { dps: number; hps: number; power: number }>(items: T[], n: number, key: (t: T) => string): T[] {
    const views = [
        [...items].sort((a, b) => b.dps - a.dps),
        [...items].sort((a, b) => b.hps - a.hps),
        [...items].sort((a, b) => b.power - a.power),
    ];
    const out: T[] = [];
    const seen = new Set<string>();
    for (let i = 0; out.length < n && i < items.length; i++) {
        for (const v of views) {
            if (out.length >= n) break;
            const it = v[i];
            if (!it) continue;
            const k = key(it);
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(it);
        }
    }
    return out;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function runOptimizer(input: OptimizerInput, onProgress: OptimizerProgress = () => {}): OptimizerResult {
    const { base, libs, pvpConfig, options: o } = input;
    const t0 = now();
    // Slot counts from the config (PetBaseConfig.PetSlotsCount, SkillBaseConfig.SkillSlotsCount).
    const petSlots = libs.petBaseConfig?.PetSlotsCount;
    const skillSlots = libs.skillBaseConfig?.SkillSlotsCount;
    if (typeof petSlots !== 'number' || typeof skillSlots !== 'number') {
        throw new Error('PetBaseConfig.json / SkillBaseConfig.json are not loaded');
    }

    const withBuild = (skills: SkillSlot[], c: LoadoutCombo): UserProfile => ({
        ...base,
        skills: { ...base.skills, equipped: skills },
        pets: { ...base.pets, active: c.petSet },
        mount: { ...base.mount, active: c.mount },
    });
    let scored = 0;
    const score = (skills: SkillSlot[], c: LoadoutCombo): Candidate => {
        const s = calculateStats(withBuild(skills, c), libs, o.excludeSubstats);
        scored++;
        return { skills, petSet: c.petSet, mount: c.mount, dps: s.realTotalDps || 0, hps: s.realTotalHps || 0, power: s.power || 0, isCurrent: false };
    };

    const currentSkills = (base.skills.equipped || []).filter(s => s && s.id);
    const currentLoadout: LoadoutCombo = { petSet: base.pets.active, mount: base.mount.active };

    const skillSets = o.scope === 'loadout' ? [currentSkills] : subsets(skillPool(base, libs, o), skillSlots);
    const loadouts = o.scope === 'skills' ? [currentLoadout] : enumerateLoadouts(base, petSlots);
    if (skillSets.length === 0) skillSets.push(currentSkills);

    // Stage 1: each half on its own, then the best of each crossed.
    const PER_HALF = 6;
    const crossTotal = Math.min(skillSets.length, PER_HALF * 3) * Math.min(loadouts.length, PER_HALF * 3);
    const total1 = (skillSets.length > 1 ? skillSets.length : 0) + (loadouts.length > 1 ? loadouts.length : 0) + crossTotal;
    let done1 = 0;
    const tick1 = () => { done1++; if (done1 % 25 === 0) onProgress(1, done1, total1); };

    let bestSkills = skillSets;
    if (skillSets.length > 1) {
        const rows = skillSets.map(sk => { const c = score(sk, currentLoadout); tick1(); return c; });
        bestSkills = shortlistByViews(rows, PER_HALF * 3, r => skillsKey(r.skills)).map(r => r.skills);
    }
    let bestLoadouts = loadouts;
    if (loadouts.length > 1) {
        const rows = loadouts.map(l => { const c = score(currentSkills, l); tick1(); return c; });
        bestLoadouts = shortlistByViews(rows, PER_HALF * 3, r => loadoutKey(r)).map(r => ({ petSet: r.petSet, mount: r.mount }));
    }
    const crossed: Candidate[] = [];
    for (const sk of bestSkills) for (const l of bestLoadouts) { crossed.push(score(sk, l)); tick1(); }
    onProgress(1, total1, total1);

    const shortlist = shortlistByViews(crossed, o.shortlist, candidateKey);
    const current = score(currentSkills, currentLoadout);
    current.isCurrent = true;
    const curKey = candidateKey(current);
    const finalists = [current, ...shortlist.filter(c => candidateKey(c) !== curKey)];
    const t1 = now();

    // Stage 2: arena battles against the reference, both sides, same seeds for everyone.
    const fighter = (name: string, p: UserProfile): PvpFighter => fighterFromProfile(name, p, calculateStats(p, libs), libs);
    const refProfile = input.reference ?? base;
    const ref = fighter(input.referenceName, refProfile);
    const n = Math.max(1, o.battlesPerSide);
    const ranked: RankedCandidate[] = [];
    let battles = 0;
    finalists.forEach((c, idx) => {
        const me = fighter('Candidate', withBuild(c.skills, c));
        let wins = 0, draws = 0, losses = 0, margin = 0;
        for (let seed = 1; seed <= n; seed++) {
            const a = new PvpBattle(me, ref, pvpConfig, seed).run();
            if (a.outcome === 'p1') wins++; else if (a.outcome === 'p2') losses++; else draws++;
            margin += a.p1HpFrac - a.p2HpFrac;
            const b = new PvpBattle(ref, me, pvpConfig, seed).run();
            if (b.outcome === 'p2') wins++; else if (b.outcome === 'p1') losses++; else draws++;
            margin += b.p2HpFrac - b.p1HpFrac;
        }
        const total = 2 * n;
        battles += total;
        const p = (wins + draws / 2) / total;
        ranked.push({ ...c, battles: total, wins, draws, losses, winRate: p, winRateSe: Math.sqrt((p * (1 - p)) / total), hpMargin: margin / total });
        onProgress(2, idx + 1, finalists.length);
    });
    ranked.sort((a, b) => b.winRate - a.winRate || b.hpMargin - a.hpMargin);
    const t2 = now();
    return { ranked, scored, battles, stage1Ms: t1 - t0, stage2Ms: t2 - t1, referenceName: input.referenceName };
}
