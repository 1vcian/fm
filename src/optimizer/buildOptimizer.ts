/**
 * Build optimizer: the best skills + pets + mount + fairy + skins for a profile, in absolute terms.
 *
 * Pure (no React, no DOM) so it runs inside src/workers/optimizer.worker.ts and under tsx.
 *
 *   stage 1  every candidate is scored with the analytic formulas of the stat engine
 *            (calculateStats: real-time DPS, real-time HPS, Power). Skill sets and pets + mount
 *            loadouts are scored on their own first (each on the current other half), the best of
 *            each are then crossed and scored again. The shortlist is the union of the best by
 *            DPS, by HPS and by Power: no blended DPS x HPS score decides anything.
 *            Skins (profile.skins.saved) are a third half: every JOINT choice over Weapon, Helmet
 *            and Body (current, none or an archive skin of that type) is scored whole, so a set
 *            tier bonus is part of the score, and the best combination of every set-tier
 *            signature is kept next to the shortlist (withSetRepresentatives). The skin shortlist
 *            is then crossed with the best crossed skills/loadout/fairy builds.
 *   search   OptimizerSearch picks the halves the search may change (skills, pets, mount, fairy,
 *            skins); the others keep the current build's choice.
 *   stage 2  the shortlist (plus the current build) fights simulated arena battles
 *            (src/pvp/simulate.ts, the verified engine) against one reference fighter. Every
 *            candidate uses the same seeds and plays both sides, Player 1 and Player 2, so the
 *            turn order effect cancels. Ranked by win rate (draw = half a win), then HP margin.
 *            Against the test dummy (vsDummy) there are no battles: each finalist runs the combat
 *            engine on the unkillable dummy (testedRun) and is ranked by measured DPS, then HPS.
 */
import type { EquippedSkin, MountSlot, PetSlot, SkillSlot, UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { playerUnitSpec, skillSpecs, testedRun, type PvpHpConfig } from '../engine';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { PvpBattle } from '../pvp/simulate';
import { FAIRIES } from '../utils/fairies';
import { SKIN_TYPE_TO_SLOT, activeSetTiers, withArchivedSkins, equippedFromSaved, skinContentKey, withSkin, type ActiveSetTier } from '../utils/skinArchive';

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
export function enumerateLoadouts(p: UserProfile, petSlots: number, search: { pets: boolean; mount: boolean } = { pets: true, mount: true }): LoadoutCombo[] {
    // A half that is not searched keeps the current pets or mount.
    const petSets = search.pets ? subsets(p.pets.savedBuilds || [], petSlots) : [];
    if (petSets.length === 0) petSets.push(p.pets.active);

    const mounts: (MountSlot | null)[] = [];
    const seen = new Set<string>();
    for (const m of search.mount ? [p.mount.active, ...(p.mount.savedBuilds || [])] : []) {
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

/** What the search may change; anything left out keeps the current build's choice. */
export interface OptimizerSearch {
    skills: boolean;
    pets: boolean;
    mount: boolean;
    fairy: boolean;
    skins: boolean;
}

export const SEARCH_ALL: OptimizerSearch = { skills: true, pets: true, mount: true, fairy: true, skins: true };

export interface OptimizerOptions {
    search: OptimizerSearch;
    /** True: only owned skills at their levels. False: every SkillLibrary skill. */
    ownedSkillsOnly: boolean;
    /** Level for skills the profile does not own (clamped to each skill's max). */
    unownedSkillLevel: number;
    /** Battles per side: each candidate fights 2 * this many battles. */
    battlesPerSide: number;
    /** Against the test dummy: game seconds measured per finalist, after the warm-up. */
    dummySeconds: number;
    /** Candidates that go to stage 2 (the current build is always added). */
    shortlist: number;
    /** Power only: the In-game/Substats toggle of the profile card. */
    excludeSubstats: boolean;
}

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
    search: SEARCH_ALL,
    ownedSkillsOnly: true,
    unownedSkillLevel: 0, // 0 = each skill's max level from the config
    battlesPerSide: 100,
    dummySeconds: 600,
    shortlist: 30,
    excludeSubstats: false,
};

export interface OptimizerInput {
    /** The build to improve, tree mode already applied. */
    base: UserProfile;
    /** Opponent; null = a mirror of the base build. Ignored when vsDummy is set. */
    reference: UserProfile | null;
    /**
     * True: no arena battles. Each finalist runs the combat engine against the test dummy's
     * unkillable target (src/engine/dummyRun.ts testedRun) and is ranked by the measured DPS, then HPS.
     */
    vsDummy?: boolean;
    referenceName: string;
    libs: LibraryData;
    pvpConfig: PvpHpConfig;
    options: OptimizerOptions;
}

/** The fairy event selection (FairiesEventModel: one shared Level, one nullable SelectedFairyIndex). */
export type FairyChoice = NonNullable<UserProfile['misc']['fairy']>;

export interface Candidate {
    skills: SkillSlot[];
    petSet: PetSlot[];
    mount: MountSlot | null;
    /** undefined: the profile has no fairy event data, so the fairy is left as it is. */
    fairy?: FairyChoice;
    /** undefined: skins are not searched (empty archive or a scope without skins), items keep theirs. */
    skins?: SkinChoice;
    /** Set bonus tiers the build's skins complete (SetsLibrary), for the result rows. */
    sets?: ActiveSetTier[];
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
    /** Against the dummy: DPS and HPS measured by the combat engine (battles = 0, no win rate). */
    engine?: { dps: number; hps: number; seconds: number };
}

export interface OptimizerResult {
    ranked: RankedCandidate[];
    /** calculateStats runs in stage 1. */
    scored: number;
    battles: number;
    stage1Ms: number;
    stage2Ms: number;
    referenceName: string;
    vsDummy: boolean;
}

export type OptimizerProgress = (stage: 1 | 2, done: number, total: number) => void;

const skillsKey = (s: SkillSlot[]) => s.map(x => `${x.id}:${x.level}`).sort().join(',');
const loadoutKey = (c: LoadoutCombo) =>
    JSON.stringify([c.petSet.map(p => [p.id, p.rarity, p.level, p.secondaryStats]), c.mount ? mountKey(c.mount) : null]);
const fairyKey = (f?: FairyChoice) => (f ? `${f.name ?? 'none'}:${f.level}` : '-');
export const skinChoiceKey = (k?: SkinChoice) =>
    (k ? Object.keys(k).sort().map(slot => `${slot}:${skinContentKey(k[slot as SkinSlotKey] ?? null)}`).join(';') : '-');
const candidateKey = (c: { skills: SkillSlot[]; fairy?: FairyChoice; skins?: SkinChoice } & LoadoutCombo) =>
    `${skillsKey(c.skills)}#${loadoutKey(c)}#${fairyKey(c.fairy)}#${skinChoiceKey(c.skins)}`;

/** The skin worn on each skinnable slot (null = no skin). */
export type SkinSlotKey = 'Weapon' | 'Helmet' | 'Body';
export type SkinChoice = Partial<Record<SkinSlotKey, EquippedSkin | null>>;

/** Applies a skin choice to the items (slots without an item stay empty). */
export function applySkinChoice(items: UserProfile['items'], choice?: SkinChoice): UserProfile['items'] {
    if (!choice) return items;
    const out = { ...items };
    for (const [slot, skin] of Object.entries(choice) as [SkinSlotKey, EquippedSkin | null][]) {
        out[slot] = withSkin(out[slot], skin ?? null);
    }
    return out;
}

/**
 * Skin options per skinnable slot that holds an item: the skin it wears now, no skin, and every
 * archive skin of that slot's SkinId.Type (profile.skins.saved), deduplicated by content.
 * null when the archive is empty: then skins are not a search dimension at all.
 */
export function skinOptions(base: UserProfile): Partial<Record<SkinSlotKey, (EquippedSkin | null)[]>> | null {
    const saved = base.skins?.saved || [];
    if (saved.length === 0) return null;
    const out: Partial<Record<SkinSlotKey, (EquippedSkin | null)[]>> = {};
    for (const [type, slot] of Object.entries(SKIN_TYPE_TO_SLOT) as [string, SkinSlotKey][]) {
        const item = base.items[slot];
        if (!item) continue;
        const opts: (EquippedSkin | null)[] = [];
        const seen = new Set<string>();
        const push = (s: EquippedSkin | null) => {
            const k = s ? skinContentKey({ ...s, type: s.type || type }) : 'none';
            if (seen.has(k)) return;
            seen.add(k);
            opts.push(s);
        };
        push(item.skin ?? null);
        push(null);
        for (const s of saved) if (s.type === type) push(equippedFromSaved(s));
        out[slot] = opts;
    }
    return out;
}

/** Every joint skin choice (the product of the per-slot options), so sets are scored whole. */
export function enumerateSkinChoices(base: UserProfile): SkinChoice[] {
    const opts = skinOptions(base);
    if (!opts) return [];
    let combos: SkinChoice[] = [{}];
    for (const [slot, list] of Object.entries(opts) as [SkinSlotKey, (EquippedSkin | null)[]][]) {
        const next: SkinChoice[] = [];
        for (const c of combos) for (const s of list) next.push({ ...c, [slot]: s });
        combos = next;
    }
    return combos;
}

/** The skins the build wears now, on every skinnable slot that holds an item. */
export function currentSkinChoice(base: UserProfile): SkinChoice {
    const out: SkinChoice = {};
    for (const slot of Object.values(SKIN_TYPE_TO_SLOT) as SkinSlotKey[]) {
        const item = base.items[slot];
        if (item) out[slot] = item.skin ?? null;
    }
    return out;
}

/** The set tiers a candidate completes, as a stable key ('' = none). */
const setsKey = (sets?: ActiveSetTier[]) => (sets || []).map(t => `${t.setId}:${t.requiredPieces}`).sort().join(',');

/**
 * The shortlist plus, for every set-tier signature among the items that the shortlist misses,
 * the best item of that signature by DPS, by HPS and by Power. A combination that completes a set
 * is therefore never dropped because some other combination happened to rank above it.
 */
function withSetRepresentatives<T extends { dps: number; hps: number; power: number; sets?: ActiveSetTier[] }>(items: T[], short: T[], key: (t: T) => string): T[] {
    const out = [...short];
    const have = new Set(short.map(key));
    const covered = new Set(short.map(t => setsKey(t.sets)));
    const bySig = new Map<string, T[]>();
    for (const it of items) {
        const sig = setsKey(it.sets);
        if (covered.has(sig)) continue;
        if (!bySig.has(sig)) bySig.set(sig, []);
        bySig.get(sig)!.push(it);
    }
    for (const group of bySig.values()) {
        for (const pick of ['dps', 'hps', 'power'] as const) {
            const best = group.reduce((a, b) => (b[pick] > a[pick] ? b : a));
            const k = key(best);
            if (have.has(k)) continue;
            have.add(k);
            out.push(best);
        }
    }
    return out;
}

/**
 * Fairy candidates: no fairy and each fairy, all at the profile's fairy level, because the game
 * keeps one Level for the whole event and only the selected index changes (FairiesEventModel
 * Level 0x54, SelectedFairyIndex 0x4C). A profile without fairy data keeps its fairy untouched.
 */
export function fairyPool(base: UserProfile): (FairyChoice | undefined)[] {
    const cur = base.misc.fairy;
    if (!cur) return [undefined];
    return [{ name: null, level: cur.level }, ...FAIRIES.map(f => ({ name: f.name, level: cur.level }))];
}

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
    const { libs, pvpConfig, options: o } = input;
    // Linked skins as the archive has them now, so current and archive choices compare equal.
    const base = withArchivedSkins(input.base);
    const t0 = now();
    // Slot counts from the config (PetBaseConfig.PetSlotsCount, SkillBaseConfig.SkillSlotsCount).
    const petSlots = libs.petBaseConfig?.PetSlotsCount;
    const skillSlots = libs.skillBaseConfig?.SkillSlotsCount;
    if (typeof petSlots !== 'number' || typeof skillSlots !== 'number') {
        throw new Error('PetBaseConfig.json / SkillBaseConfig.json are not loaded');
    }

    const withBuild = (skills: SkillSlot[], c: LoadoutCombo, fairy?: FairyChoice, skins?: SkinChoice): UserProfile => ({
        ...base,
        items: applySkinChoice(base.items, skins),
        skills: { ...base.skills, equipped: skills },
        pets: { ...base.pets, active: c.petSet },
        mount: { ...base.mount, active: c.mount },
        misc: fairy ? { ...base.misc, fairy } : base.misc,
    });
    let scored = 0;
    const score = (skills: SkillSlot[], c: LoadoutCombo, fairy: FairyChoice | undefined = base.misc.fairy, skins?: SkinChoice): Candidate => {
        const p = withBuild(skills, c, fairy, skins);
        const s = calculateStats(p, libs, o.excludeSubstats);
        scored++;
        return {
            skills, petSet: c.petSet, mount: c.mount, fairy, skins,
            sets: activeSetTiers(p.items, libs.skinsLibrary, libs.setsLibrary),
            dps: s.realTotalDps || 0, hps: s.realTotalHps || 0, power: s.power || 0, isCurrent: false,
        };
    };

    const currentSkills = (base.skills.equipped || []).filter(s => s && s.id);
    const currentLoadout: LoadoutCombo = { petSet: base.pets.active, mount: base.mount.active };

    const q = o.search;
    const skillSets = q.skills ? subsets(skillPool(base, libs, o), skillSlots) : [currentSkills];
    const loadouts = q.pets || q.mount ? enumerateLoadouts(base, petSlots, q) : [currentLoadout];
    if (skillSets.length === 0) skillSets.push(currentSkills);
    const fairies = q.fairy ? fairyPool(base) : [base.misc.fairy];
    // Skins: every joint choice over the archive (current, none or a saved skin per slot), so a
    // set is scored as a whole with its tier bonus, never one piece at a time.
    const skinChoices = q.skins ? enumerateSkinChoices(base) : [];
    const currentSkins: SkinChoice | undefined = skinChoices.length > 0 ? currentSkinChoice(base) : undefined;

    // Stage 1: each half on its own, then the best of each crossed.
    const PER_HALF = 6;
    const crossTotal = Math.min(skillSets.length, PER_HALF * 3) * Math.min(loadouts.length, PER_HALF * 3) * fairies.length;
    const total1 = (skillSets.length > 1 ? skillSets.length : 0) + (loadouts.length > 1 ? loadouts.length : 0)
        + skinChoices.length + crossTotal + (skinChoices.length > 0 ? PER_HALF * 3 * PER_HALF * 4 : 0);
    let done1 = 0;
    const tick1 = () => { done1++; if (done1 % 25 === 0) onProgress(1, done1, total1); };

    let bestSkills = skillSets;
    if (skillSets.length > 1) {
        const rows = skillSets.map(sk => { const c = score(sk, currentLoadout, base.misc.fairy, currentSkins); tick1(); return c; });
        bestSkills = shortlistByViews(rows, PER_HALF * 3, r => skillsKey(r.skills)).map(r => r.skills);
    }
    let bestLoadouts = loadouts;
    if (loadouts.length > 1) {
        const rows = loadouts.map(l => { const c = score(currentSkills, l, base.misc.fairy, currentSkins); tick1(); return c; });
        bestLoadouts = shortlistByViews(rows, PER_HALF * 3, r => loadoutKey(r)).map(r => ({ petSet: r.petSet, mount: r.mount }));
    }
    let bestSkins: (SkinChoice | undefined)[] = [currentSkins];
    if (skinChoices.length > 0) {
        const rows = skinChoices.map(k => { const c = score(currentSkills, currentLoadout, base.misc.fairy, k); tick1(); return c; });
        bestSkins = withSetRepresentatives(rows, shortlistByViews(rows, PER_HALF * 3, r => skinChoiceKey(r.skins)), r => skinChoiceKey(r.skins))
            .map(r => r.skins);
    }
    let crossed: Candidate[] = [];
    for (const sk of bestSkills) for (const l of bestLoadouts) for (const f of fairies) { crossed.push(score(sk, l, f, currentSkins)); tick1(); }
    if (bestSkins.length > 1) {
        // Skins on the best builds of the other halves: the skin half's shortlist (best by each
        // view plus the best combination of every set tier it can complete) on each of them.
        const tops = shortlistByViews(crossed, PER_HALF * 3, candidateKey);
        const withSkins: Candidate[] = [];
        for (const c of tops) for (const k of bestSkins) { withSkins.push(score(c.skills, c, c.fairy, k)); tick1(); }
        crossed = withSkins;
    }
    onProgress(1, total1, total1);

    const shortlist = withSetRepresentatives(crossed, shortlistByViews(crossed, o.shortlist, candidateKey), candidateKey);
    const current = score(currentSkills, currentLoadout, base.misc.fairy, currentSkins);
    current.isCurrent = true;
    const curKey = candidateKey(current);
    const finalists = [current, ...shortlist.filter(c => candidateKey(c) !== curKey)];
    const t1 = now();

    if (input.vsDummy) {
        // Stage 2 against the test dummy: the engine's own DPS and HPS, same seed for everyone.
        const ranked: RankedCandidate[] = [];
        finalists.forEach((c, idx) => {
            const p = withBuild(c.skills, c, c.fairy, c.skins);
            const stats = calculateStats(p, libs);
            const equipped = (p.skills.equipped || []).filter(s => s && s.id && (s.level ?? 0) > 0);
            const skills = libs.skillLibrary
                ? skillSpecs(stats as never, equipped.map(s => ({ id: s.id, level: s.level })), libs.skillLibrary as never)
                : [];
            const r = testedRun(playerUnitSpec(stats as never), skills, o.dummySeconds, 1);
            ranked.push({ ...c, battles: 0, wins: 0, draws: 0, losses: 0, winRate: 0, winRateSe: 0, hpMargin: 0,
                engine: { dps: r.dps, hps: r.hps, seconds: r.seconds } });
            onProgress(2, idx + 1, finalists.length);
        });
        ranked.sort((a, b) => b.engine!.dps - a.engine!.dps || b.engine!.hps - a.engine!.hps);
        const t2 = now();
        return { ranked, scored, battles: 0, stage1Ms: t1 - t0, stage2Ms: t2 - t1, referenceName: input.referenceName, vsDummy: true };
    }

    // Stage 2: arena battles against the reference, both sides, same seeds for everyone.
    const fighter = (name: string, p: UserProfile): PvpFighter => fighterFromProfile(name, p, calculateStats(p, libs), libs);
    const refProfile = input.reference ?? base;
    const ref = fighter(input.referenceName, refProfile);
    const n = Math.max(1, o.battlesPerSide);
    const ranked: RankedCandidate[] = [];
    let battles = 0;
    finalists.forEach((c, idx) => {
        const me = fighter('Candidate', withBuild(c.skills, c, c.fairy, c.skins));
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
    return { ranked, scored, battles, stage1Ms: t1 - t0, stage2Ms: t2 - t1, referenceName: input.referenceName, vsDummy: false };
}
