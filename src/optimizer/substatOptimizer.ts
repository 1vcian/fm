/**
 * Substat optimizer: the best gear substat allocation (and fairy) for a profile.
 *
 * Pure (no React, no DOM) so it runs inside src/workers/optimizer.worker.ts and under tsx.
 *
 * What can be allocated comes from the config: SecondaryStatLibrary rows with UpperRange > 0
 * (the caller passes them), one roll = UpperRange x perfection. The slot budget is the caller's
 * bodies (items by age, pets and mount by rarity); a body holds each stat at most once.
 *
 * Every score is a number the stat engine shows on the profile, which matches the combat engine
 * within 1% (realTotalDps / realTotalHps / totalDamage / totalHealth). No blended score has a
 * game meaning, so none is used to pick a winner:
 *
 *   dps | hps | damage | health
 *            greedy ascent with lookahead (finds breakpoint jumps: fairy steps, the attack
 *            interval table) + 1-2 point swap refinement from shared seeded restarts, under no
 *            fairy and each fairy at max level. Returns the single best allocation.
 *   simulated
 *            stage 1  a diverse shortlist: the DPS, HPS, Damage and Health optimum plus points
 *                     along the DPS/HPS frontier (w x DPS/DPS* + (1 - w) x HPS/HPS*, several w;
 *                     the blend only GENERATES candidates), per fairy, plus the current build.
 *            stage 2  every candidate fights the reference in simulated arena battles
 *                     (src/pvp/simulate.ts) on both sides with the same seeds. Ranked by win
 *                     rate (a draw counts half), then HP margin. Same method as buildOptimizer.
 *
 * Crit and double chance: no clamp exists in the game (the stat is a plain sum); the combat
 * engine rolls them (FD6 roll < chance, BattleSystem.ApplyDmg 0x77405E4 / AttacksSystem
 * 0x77F3D34), so anything past 100% is simply wasted. The stat engine's expected-value formulas
 * already use min(chance, 1) for exactly that reason, and the optimizer scores with them.
 *
 * Power is not an objective: PlayerPowerExtensions.CalculatePower (0x785E258) first calls
 * Stats.WithoutSecondaryStats (0x785E500, which removes every secondary stat contribution via
 * RemoveSecondaryStatContributions 0x78641A0) and only then reads PlayerDamage / PlayerHealth.
 * In-game Power is the same for every substat allocation.
 */
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { SEASON_STATS, fairyPerStep, type FairyName } from '../utils/fairies';
import type { PvpHpConfig } from '../engine';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { PvpBattle } from '../pvp/simulate';

export type Alloc = Record<string, number>;

export interface SubstatBody {
    /** 'item:<Slot>', 'pet:<index>' or 'mount'. */
    key: string;
    label: string;
    slots: number;
}

export interface RollableStat {
    id: string;
    /** SecondaryStatLibrary UpperRange (a fraction, 0.12 = 12%). */
    upper: number;
}

export type SubstatObjective = 'dps' | 'hps' | 'damage' | 'health' | 'simulated';

export interface SubstatOptimizerInput {
    /** The build, scenario (tree mode, weapon type) applied. Its substats are replaced. */
    base: UserProfile;
    /** The build as it is today (its own rolls and fairy): the baseline row of 'simulated'. */
    current: UserProfile;
    /** Opponent for 'simulated': a mirror of `current`, or a saved profile. */
    reference: UserProfile;
    referenceName: string;
    objective: SubstatObjective;
    /** True: equipped skills count in the formulas and fight. False: weapon only, on both sides. */
    withSkills: boolean;
    stats: RollableStat[];
    bodies: SubstatBody[];
    /** Roll quality, 1..100 (% of UpperRange). */
    perfection: number;
    /** Fairy choices to try (null = no fairy), each at fairyLevel. */
    fairies: (FairyName | null)[];
    fairyLevel: number;
    /** An extra allocation to include in 'simulated' (the page's sliders), or null. */
    extra: { alloc: Alloc; fairy: FairyName | null } | null;
    pvpConfig: PvpHpConfig | null;
    battlesPerSide: number;
    /** Rows returned by 'simulated'. */
    keep: number;
}

export interface SubstatMetrics {
    dps: number;
    hps: number;
    damage: number;
    health: number;
}

export interface SubstatCandidate extends SubstatMetrics {
    alloc: Alloc;
    fairy: FairyName | null;
    /** Why it is in the shortlist ("Best DPS", "60% DPS, 40% HPS", "Current build"...). */
    tags: string[];
    isCurrent: boolean;
}

export interface RankedSubstatCandidate extends SubstatCandidate {
    battles: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    winRateSe: number;
    hpMargin: number;
}

export interface SubstatOptimizerResult {
    objective: SubstatObjective;
    best: SubstatCandidate;
    /** 'simulated' only: the finalists, best first. */
    ranked: RankedSubstatCandidate[];
    /** calculateStats runs. */
    scored: number;
    battles: number;
    stage1Ms: number;
    stage2Ms: number;
    referenceName: string;
}

export type SubstatProgress = (stage: 1 | 2, done: number, total: number) => void;

/** statEngine pool a fairy reads -> the SecondaryStatLibrary id that rolls into it. */
const REQUIRED_SUBSTAT: Record<string, string> = {
    skillDamageMulti: 'SkillDamageMulti',
    skillCooldownMulti: 'SkillCooldownMulti',
    healthMulti: 'HealthMulti',
};

const ITEM_SLOTS: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];

export const allocKey = (a: Alloc) =>
    Object.keys(a).filter(k => a[k] > 0).sort().map(k => `${k}:${a[k]}`).join(',');

const allocTotal = (a: Alloc) => Object.values(a).reduce((s, v) => s + v, 0);

/**
 * Spread the allocation over the bodies, one instance of a stat per body: highest count first,
 * all copies of one stat at once onto the bodies with the most free slots. Copies that no body
 * can take are dropped (repairAlloc refills those slots).
 */
export function distribute(allocs: Alloc, bodies: SubstatBody[]): Map<string, string[]> {
    const free = new Map(bodies.map(b => [b.key, b.slots]));
    const out = new Map(bodies.map(b => [b.key, [] as string[]]));
    const stats = Object.entries(allocs)
        .filter(([, c]) => c > 0)
        .map(([s, c]) => ({ s, c }))
        .sort((a, b) => b.c - a.c || (a.s < b.s ? -1 : 1));
    for (const { s, c } of stats) {
        const targets = bodies
            .filter(b => (free.get(b.key) || 0) > 0)
            .sort((a, b) => free.get(b.key)! - free.get(a.key)!)
            .slice(0, c);
        for (const b of targets) {
            free.set(b.key, free.get(b.key)! - 1);
            out.get(b.key)!.push(s);
        }
    }
    return out;
}

/** Counts that distribute() actually places. */
export function placedCounts(allocs: Alloc, bodies: SubstatBody[]): Alloc {
    const counts: Alloc = {};
    for (const assigned of distribute(allocs, bodies).values()) for (const st of assigned) counts[st] = (counts[st] || 0) + 1;
    return counts;
}

/** Clone of the profile with no substats anywhere (every body, including ones with no slot). */
function stripSubstats(p: UserProfile): UserProfile {
    const out: UserProfile = JSON.parse(JSON.stringify(p));
    for (const slot of ITEM_SLOTS) if (out.items[slot]) out.items[slot]!.secondaryStats = [];
    out.pets.active.forEach(pet => { if (pet) pet.secondaryStats = []; });
    if (out.mount.active) out.mount.active.secondaryStats = [];
    return out;
}

/** The profile with the allocation rolled onto its real bodies (distribute layout) and the fairy. */
export function buildWithAlloc(
    stripped: UserProfile, alloc: Alloc, fairy: FairyName | null, fairyLevel: number,
    stats: RollableStat[], bodies: SubstatBody[], perfection: number,
): UserProfile {
    const p: UserProfile = JSON.parse(JSON.stringify(stripped));
    const upper = new Map(stats.map(s => [s.id, s.upper]));
    const roll = (id: string) => ({ statId: id, value: (upper.get(id) || 0) * perfection });
    for (const [key, ids] of distribute(alloc, bodies)) {
        const list = ids.map(roll);
        if (key.startsWith('item:')) {
            const it = p.items[key.slice(5) as keyof UserProfile['items']];
            if (it) it.secondaryStats = list;
        } else if (key.startsWith('pet:')) {
            const pet = p.pets.active[Number(key.slice(4))];
            if (pet) pet.secondaryStats = list;
        } else if (key === 'mount' && p.mount.active) {
            p.mount.active.secondaryStats = list;
        }
    }
    p.misc = { ...p.misc, fairy: { name: fairy, level: fairyLevel } };
    return p;
}

const withoutSkills = (p: UserProfile): UserProfile => ({ ...p, skills: { ...p.skills, equipped: [] } });

/** Deterministic PRNG (mulberry32): restarts are reproducible run to run. */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function runSubstatOptimizer(input: SubstatOptimizerInput, libs: LibraryData, onProgress: SubstatProgress = () => {}): SubstatOptimizerResult {
    const t0 = now();
    const { stats, bodies, perfection, fairyLevel } = input;
    const statIds = stats.map(s => s.id);
    const pool = bodies.reduce((s, b) => s + b.slots, 0);
    const perStatCap = bodies.filter(b => b.slots > 0).length;
    const skillsOff = (p: UserProfile) => (input.withSkills ? p : withoutSkills(p));

    // ------------------------------------------------------------------ scoring
    // Scoring stacks every roll on the first body with a slot: totals do not depend on where a
    // roll sits (statEngine sums every item, pet and mount roll into the same pools), and each
    // roll stays its own entry so the engine's per-roll rounding is the same as on real bodies.
    const stripped = skillsOff(stripSubstats(input.base));
    const firstBody = bodies.find(b => b.slots > 0);
    const upper = new Map(stats.map(s => [s.id, s.upper]));
    let scored = 0;
    const metricCache = new Map<string, SubstatMetrics & { granted: number }>();
    const scenario = new Map<FairyName | null, UserProfile>();
    const scenarioFor = (fairy: FairyName | null) => {
        let p = scenario.get(fairy);
        if (!p) {
            p = JSON.parse(JSON.stringify(stripped)) as UserProfile;
            p.misc = { ...p.misc, fairy: { name: fairy, level: fairyLevel } };
            scenario.set(fairy, p);
        }
        return p;
    };
    const metrics = (alloc: Alloc, fairy: FairyName | null) => {
        const key = `${fairy}|${allocKey(alloc)}`;
        const hit = metricCache.get(key);
        if (hit) return hit;
        const p = scenarioFor(fairy);
        const list: { statId: string; value: number }[] = [];
        for (const id of statIds) for (let i = 0; i < (alloc[id] || 0); i++) list.push({ statId: id, value: (upper.get(id) || 0) * perfection });
        if (firstBody) {
            const k = firstBody.key;
            if (k.startsWith('item:')) p.items[k.slice(5) as keyof UserProfile['items']]!.secondaryStats = list;
            else if (k.startsWith('pet:')) p.pets.active[Number(k.slice(4))].secondaryStats = list;
            else if (p.mount.active) p.mount.active.secondaryStats = list;
        }
        const s = calculateStats(p, libs);
        scored++;
        const m = {
            dps: s.realTotalDps || 0,
            hps: s.realTotalHps || 0,
            damage: s.totalDamage || 0,
            health: s.totalHealth || 0,
            granted: s.fairyBonus?.granted || 0,
        };
        metricCache.set(key, m);
        return m;
    };

    // ------------------------------------------------------------------ search
    type Score = (a: Alloc) => number;

    // Lookahead greedy: per stat, every add-count (finds jumps such as fairy steps and attack
    // interval breakpoints), then the best return per point.
    const greedy = (score: Score, start: Alloc = {}): Alloc => {
        const allocs: Alloc = { ...start };
        let left = pool - allocTotal(allocs);
        while (left > 0) {
            const baseScore = score(allocs);
            let bestStat = '', bestAdd = 0, bestGain = -Infinity;
            for (const st of statIds) {
                const cur = allocs[st] || 0;
                const maxAdd = Math.min(left, perStatCap - cur);
                for (let k = 1; k <= maxAdd; k++) {
                    const gain = (score({ ...allocs, [st]: cur + k }) - baseScore) / k;
                    if (gain > bestGain) { bestGain = gain; bestStat = st; bestAdd = k; }
                }
            }
            if (!bestStat) break;
            allocs[bestStat] = (allocs[bestStat] || 0) + bestAdd;
            left -= bestAdd;
        }
        return allocs;
    };

    // Shared seeded restarts: every fairy and objective climbs from the SAME starts, so equal
    // candidates score equally instead of one winning on restart luck.
    const rand = rng(20261013);
    const seeds: Alloc[] = [];
    for (let i = 0; i < 4; i++) {
        const a: Alloc = {};
        let left = pool;
        const avail = [...statIds];
        while (left > 0 && avail.length > 0) {
            const idx = Math.floor(rand() * avail.length);
            const st = avail[idx];
            const room = Math.min(left, perStatCap - (a[st] || 0));
            if (room <= 0) { avail.splice(idx, 1); continue; }
            const add = Math.floor(rand() * room) + 1;
            a[st] = (a[st] || 0) + add;
            left -= add;
            if (a[st] === perStatCap) avail.splice(idx, 1);
        }
        seeds.push(a);
    }

    // Steepest-ascent swaps of 1-2 points from each start; deterministic given the starts.
    const refine = (score: Score, starts: Alloc[], restarts: number) => {
        let best = { ...starts[0] };
        let bestVal = score(best);
        for (const s0 of [...starts, ...seeds.slice(0, restarts)]) {
            const cur = { ...s0 };
            let curVal = score(cur);
            for (;;) {
                let move: { r: string; a: string; k: number; v: number } | null = null;
                for (const r of Object.keys(cur)) {
                    if (!(cur[r] > 0)) continue;
                    for (const a of statIds) {
                        if (a === r) continue;
                        const room = perStatCap - (cur[a] || 0);
                        const maxK = Math.min(cur[r], room, 2);
                        for (let k = 1; k <= maxK; k++) {
                            const v = score({ ...cur, [r]: cur[r] - k, [a]: (cur[a] || 0) + k });
                            if (v > (move ? move.v : curVal)) move = { r, a, k, v };
                        }
                    }
                }
                if (!move) break;
                cur[move.r] -= move.k;
                cur[move.a] = (cur[move.a] || 0) + move.k;
                curVal = move.v;
            }
            if (curVal > bestVal) { bestVal = curVal; best = { ...cur }; }
        }
        return { alloc: best, value: bestVal };
    };

    // Feasibility repair against the real per-body layout: drop copies distribute() cannot place,
    // then refill the freed slots with the best placeable stat.
    const repair = (alloc: Alloc, score: Score): Alloc => {
        const out = placedCounts(alloc, bodies);
        let placed = allocTotal(out);
        for (let guard = 0; placed < pool && guard < pool * 2; guard++) {
            let pick: string | null = null, pickVal = -Infinity;
            for (const st of statIds) {
                if ((out[st] || 0) >= perStatCap) continue;
                const t = { ...out, [st]: (out[st] || 0) + 1 };
                if (allocTotal(placedCounts(t, bodies)) <= placed) continue;
                const v = score(t);
                if (v > pickVal) { pickVal = v; pick = st; }
            }
            if (!pick) break;
            out[pick] = (out[pick] || 0) + 1;
            placed++;
        }
        return out;
    };

    // The fairy conversion is a known breakpoint that greedy steps can walk past (a roll of the
    // required stat pays off only once the target is worth it), so each fairy also starts from
    // its required stat at 1 .. the rolls that fill the target pool to its cap with no other
    // roll: steps = ceil(cap / perStep), rolls = ceil(steps x divider / roll value).
    const fairySeeds = (fairy: FairyName | null): Alloc[] => {
        if (!fairy) return [];
        const cfg = SEASON_STATS[fairy];
        // A flat fairy reads nothing and an uncapped one has no fill point: no breakpoint to seed.
        if (!cfg.requiredStat || cfg.targetStatTotalCap === null) return [];
        const id = REQUIRED_SUBSTAT[cfg.requiredStat];
        const roll = (upper.get(id) || 0) * perfection / 100;
        if (!id || roll <= 0 || !statIds.includes(id)) return [];
        const steps = Math.ceil(cfg.targetStatTotalCap / fairyPerStep(cfg, fairyLevel) - 1e-9);
        const full = Math.min(perStatCap, pool, Math.ceil((steps * Math.abs(cfg.requiredStatValueDivider)) / roll - 1e-9));
        const out: Alloc[] = [];
        for (let n = 1; n <= full; n++) out.push({ [id]: n });
        return out;
    };
    /** Greedy from scratch and from each fairy seed. */
    const greedyStarts = (score: Score, fairy: FairyName | null) =>
        [greedy(score), ...fairySeeds(fairy).map(seed => greedy(score, seed))];

    type Metric = keyof SubstatMetrics;
    const scorer = (fairy: FairyName | null, f: (m: SubstatMetrics) => number): Score => a => f(metrics(a, fairy));
    const single = (k: Metric) => (m: SubstatMetrics) => m[k];

    /**
     * Best allocation for one score over the fairy choices: greedy under each, refine no fairy
     * plus the two most promising. A fairy wins only by STRICTLY beating no fairy.
     */
    const optimizeOver = (f: (m: SubstatMetrics) => number, fairies: (FairyName | null)[], restarts: number) => {
        const phaseA = fairies.map(fairy => {
            const score = scorer(fairy, f);
            const starts = greedyStarts(score, fairy).sort((a, b) => score(b) - score(a));
            return { fairy, score, starts, value: score(starts[0]) };
        });
        const noFairy = phaseA.find(c => c.fairy === null);
        const others = phaseA.filter(c => c.fairy !== null).sort((a, b) => b.value - a.value).slice(0, noFairy ? 2 : 3);
        let best: { fairy: FairyName | null; alloc: Alloc; value: number; score: Score } | null = null;
        for (const c of noFairy ? [noFairy, ...others] : others) {
            const r = refine(c.score, c.starts, restarts);
            if (!best || r.value > best.value * (1 + 1e-6)) best = { fairy: c.fairy, alloc: r.alloc, value: r.value, score: c.score };
        }
        const b = best!;
        return { fairy: b.fairy, alloc: repair(b.alloc, b.score) };
    };

    /** A fairy that grants nothing for this allocation is the same build as no fairy. */
    const effectiveFairy = (alloc: Alloc, fairy: FairyName | null) =>
        fairy !== null && metrics(alloc, fairy).granted <= 0 ? null : fairy;

    const candidateOf = (alloc: Alloc, fairy: FairyName | null, tag: string): SubstatCandidate => {
        const eff = effectiveFairy(alloc, fairy);
        const m = metrics(alloc, eff);
        return { alloc, fairy: eff, dps: m.dps, hps: m.hps, damage: m.damage, health: m.health, tags: [tag], isCurrent: false };
    };

    const noResult = (best: SubstatCandidate): SubstatOptimizerResult => ({
        objective: input.objective, best, ranked: [], scored, battles: 0,
        stage1Ms: now() - t0, stage2Ms: 0, referenceName: input.referenceName,
    });

    if (pool === 0 || !firstBody) return noResult(candidateOf({}, null, 'No substat slots'));

    const LABEL: Record<Metric, string> = { dps: 'Best DPS', hps: 'Best HPS', damage: 'Best Damage', health: 'Best Health' };

    if (input.objective !== 'simulated') {
        const k = input.objective;
        const fairies = input.fairies;
        onProgress(1, 0, 1);
        const r = optimizeOver(single(k), fairies, seeds.length);
        onProgress(1, 1, 1);
        return noResult(candidateOf(r.alloc, r.fairy, LABEL[k]));
    }

    // ------------------------------------------------------------------ simulated, stage 1
    const WEIGHTS = [0.8, 0.6, 0.4, 0.2];
    const fairies = input.fairies;
    const steps = 2 + fairies.length * (2 + WEIGHTS.length);
    let step = 0;
    const tick = () => onProgress(1, ++step, steps);
    const shortlist: SubstatCandidate[] = [];
    const seen = new Map<string, SubstatCandidate>();
    const add = (c: SubstatCandidate) => {
        const key = `${c.fairy}|${allocKey(c.alloc)}`;
        const prev = seen.get(key);
        if (prev) { for (const t of c.tags) if (!prev.tags.includes(t)) prev.tags.push(t); return; }
        seen.set(key, c);
        shortlist.push(c);
    };

    // Damage and Health do not depend on the fairy (fairies grant crit, block or reflect), so
    // their optima are searched once; each fairy then rides on them for the battles.
    const flat = (k: Metric) => {
        const s = scorer(null, single(k));
        const r = refine(s, [greedy(s)], 0);
        tick();
        return repair(r.alloc, s);
    };
    const aDmg = flat('damage');
    const aHp = flat('health');
    for (const fairy of fairies) {
        // Per fairy: the DPS and HPS optimum (greedy + swaps; the shortlist only needs good
        // points, stage 2 decides), then the frontier between them, each seeded from its
        // closer end.
        const opt = (k: Metric) => {
            const s = scorer(fairy, single(k));
            const r = refine(s, greedyStarts(s, fairy), 0);
            tick();
            return repair(r.alloc, s);
        };
        const aDps = opt('dps');
        const aHps = opt('hps');
        const dStar = Math.max(metrics(aDps, fairy).dps, 1e-9);
        const hStar = Math.max(metrics(aHps, fairy).hps, 1e-9);
        add(candidateOf(aDps, fairy, 'Best DPS'));
        add(candidateOf(aHps, fairy, 'Best HPS'));
        add(candidateOf(aDmg, fairy, 'Best Damage'));
        add(candidateOf(aHp, fairy, 'Best Health'));
        for (const w of WEIGHTS) {
            const s = scorer(fairy, m => w * (m.dps / dStar) + (1 - w) * (m.hps / hStar));
            const r = refine(s, [w >= 0.5 ? aDps : aHps], 0);
            add(candidateOf(repair(r.alloc, s), fairy, `${Math.round(w * 100)}% DPS, ${Math.round((1 - w) * 100)}% HPS`));
            tick();
        }
    }
    if (input.extra) add(candidateOf(input.extra.alloc, input.extra.fairy, 'Your sliders'));
    onProgress(1, steps, steps);
    const t1 = now();

    // ------------------------------------------------------------------ simulated, stage 2
    const fighter = (name: string, p: UserProfile): PvpFighter => fighterFromProfile(name, p, calculateStats(p, libs), libs);
    if (!input.pvpConfig) throw new Error('PvP config not loaded');
    const pvpConfig = input.pvpConfig;
    const currentBuild = skillsOff(input.current);
    const ref = fighter(input.referenceName, skillsOff(input.reference));

    // The current build as it is (its own rolls and fairy) always fights too: the baseline.
    const cs = calculateStats(currentBuild, libs);
    const current: SubstatCandidate & { profile: UserProfile } = {
        alloc: currentAlloc(input.current), fairy: input.current.misc.fairy?.name ?? null,
        dps: cs.realTotalDps || 0, hps: cs.realTotalHps || 0, damage: cs.totalDamage || 0, health: cs.totalHealth || 0,
        tags: ['Current build'], isCurrent: true, profile: currentBuild,
    };
    const finalists: (SubstatCandidate & { profile?: UserProfile })[] = [current, ...shortlist];

    const n = Math.max(1, input.battlesPerSide);
    const ranked: RankedSubstatCandidate[] = [];
    let battles = 0;
    finalists.forEach((c, idx) => {
        const p = c.profile ?? buildWithAlloc(stripped, c.alloc, c.fairy, fairyLevel, stats, bodies, perfection);
        const me = fighter('Candidate', p);
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
        const pr = (wins + draws / 2) / total;
        const { profile: _drop, ...plain } = c as SubstatCandidate & { profile?: UserProfile };
        void _drop;
        ranked.push({ ...plain, battles: total, wins, draws, losses, winRate: pr, winRateSe: Math.sqrt((pr * (1 - pr)) / total), hpMargin: margin / total });
        onProgress(2, idx + 1, finalists.length);
    });
    ranked.sort((a, b) => b.winRate - a.winRate || b.hpMargin - a.hpMargin);
    const t2 = now();
    return {
        objective: 'simulated',
        best: ranked[0],
        ranked: ranked.slice(0, Math.max(1, input.keep)),
        scored, battles, stage1Ms: t1 - t0, stage2Ms: t2 - t1, referenceName: input.referenceName,
    };
}

/** Roll counts of the profile's own substats (items, active pets, mount). */
export function currentAlloc(p: UserProfile): Alloc {
    const out: Alloc = {};
    const addAll = (list?: { statId: string }[]) => list?.forEach(s => { out[s.statId] = (out[s.statId] || 0) + 1; });
    for (const slot of ITEM_SLOTS) addAll(p.items[slot]?.secondaryStats);
    p.pets.active.forEach(pet => addAll(pet?.secondaryStats));
    addAll(p.mount.active?.secondaryStats);
    return out;
}
