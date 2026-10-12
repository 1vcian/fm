/**
 * Rebuild the tech trees of a player we only know from a profile card.
 *
 * The card prints Total Damage and Total Health. Everything else that feeds them is on the card
 * too (items, pets, mount, equipped skills, forge stars, stat totals) except the trees, so the trees
 * are the unknowns. In the trees only per-slot / pet / mount / skill Damage and Health nodes move
 * those two totals (no node grants crit, attack speed or lifesteal), and they split cleanly:
 *
 *   damage ladder   WeaponBonus, GloveBonus, NecklaceBonus, RingBonus, PetBonusDamage, MountDamage,
 *                   SkillPassiveDamage (+ SkillDamage, which moves skills only and rides along)
 *   health ladder   HelmetBonus, BodyBonus, ShoeBonus, BeltBonus, PetBonusHealth, MountHealth,
 *                   SkillPassiveHealth
 *
 * Each ladder is the sequence of single level-ups a player would buy: personal tree nodes in tier
 * order, then the clan tree. Total Damage grows with the damage ladder and Total Health with the
 * health ladder (WeaponBonus touches both, hence the alternation), so an alternating binary search
 * on the two ladder positions lands on the integer levels closest to the card. Every evaluation is
 * the real stat engine on the candidate profile. When even the top of both ladders falls short,
 * the passives of owned-but-not-equipped skills (which the card cannot show) are raised too.
 *
 * Non-combat nodes are set to their maximum: they do not touch combat stats and keep every
 * requirement satisfied. Requirements of combat nodes are repaired to level 1 before evaluating.
 */
import type { UserProfile } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';

const DAMAGE_TYPES = ['WeaponBonus', 'GloveBonus', 'NecklaceBonus', 'RingBonus', 'PetBonusDamage', 'MountDamage', 'SkillPassiveDamage', 'SkillDamage'];
const HEALTH_TYPES = ['HelmetBonus', 'BodyBonus', 'ShoeBonus', 'BeltBonus', 'PetBonusHealth', 'MountHealth', 'SkillPassiveHealth'];
const PERSONAL_TREES = ['Forge', 'Power', 'SkillsPetTech'] as const;

interface Step { tree: string; id: number }

export interface SolverLibs {
    libs: LibraryData;
    /** PlayerTechTreePositionLibrary (TechTreePositionLibrary.json): { [tree]: { Nodes: [...] } }. */
    techTreePositionLibrary: any;
    guildPositionLibrary: any;
    guildUpgradeLibrary: any;
    skillLibrary: any;
}

export interface SolveTargets {
    totalDamage: number;
    totalHealth: number;
}

export interface SolveResult {
    profile: UserProfile;
    achieved: { damage: number; health: number };
    /** Relative error, (achieved - target) / target. */
    error: { damage: number; health: number };
    /** Where each ladder ended, as a fraction of its length. */
    progress: { damage: number; health: number; otherSkillPassiveLevel: number };
    evaluations: number;
    notes: string[];
}

function nodeMax(libs: LibraryData, type: string): number {
    return Number((libs.techTreeLibrary as any)?.[type]?.MaxLevel) || 5;
}

function buildLadder(types: string[], s: SolverLibs): Step[] {
    const order = new Map(types.map((t, i) => [t, i]));
    const steps: Step[] = [];
    // Personal trees: level by level across the tier, so a ladder position is a believable tree.
    for (const tree of PERSONAL_TREES) {
        const nodes = (s.techTreePositionLibrary?.[tree]?.Nodes || []).filter((n: any) => order.has(n.Type));
        nodes.sort((a: any, b: any) => (a.Tier ?? 0) - (b.Tier ?? 0) || order.get(a.Type)! - order.get(b.Type)! || a.Id - b.Id);
        const maxLevel = Math.max(1, ...nodes.map((n: any) => nodeMax(s.libs, n.Type)));
        // Tier by tier: inside one tier raise every node one level at a time.
        const tiers = new Map<number, any[]>();
        for (const n of nodes) {
            const t = n.Tier ?? 0;
            if (!tiers.has(t)) tiers.set(t, []);
            tiers.get(t)!.push(n);
        }
        for (const [, tierNodes] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
            for (let lvl = 1; lvl <= maxLevel; lvl++) {
                for (const n of tierNodes) if (lvl <= nodeMax(s.libs, n.Type)) steps.push({ tree, id: n.Id });
            }
        }
    }
    // Clan tree last: one level at a time, round-robin across the matching nodes.
    let globalId = 0;
    const clanNodes: { id: number; max: number }[] = [];
    for (const cat of Object.keys(s.guildPositionLibrary || {})) {
        for (const type of s.guildPositionLibrary[cat]?.Nodes || []) {
            if (order.has(type)) clanNodes.push({ id: globalId, max: Number(s.guildUpgradeLibrary?.[type]?.MaxLevel) || 20 });
            globalId += 1;
        }
    }
    const clanMax = Math.max(0, ...clanNodes.map(n => n.max));
    for (let lvl = 1; lvl <= clanMax; lvl++) {
        for (const n of clanNodes) if (lvl <= n.max) steps.push({ tree: 'Clan', id: n.id });
    }
    return steps;
}

/** Personal non-combat nodes at max; combat nodes start at 0 (the ladders fill them). */
function baseTrees(s: SolverLibs): Record<string, Record<number, number>> {
    const combat = new Set([...DAMAGE_TYPES, ...HEALTH_TYPES]);
    const out: Record<string, Record<number, number>> = { Clan: {} };
    for (const tree of PERSONAL_TREES) {
        out[tree] = {};
        for (const n of s.techTreePositionLibrary?.[tree]?.Nodes || []) {
            out[tree][n.Id] = combat.has(n.Type) ? 0 : nodeMax(s.libs, n.Type);
        }
    }
    return out;
}

function applyLadder(trees: Record<string, Record<number, number>>, ladder: Step[], upTo: number): void {
    for (let i = 0; i < upTo && i < ladder.length; i++) {
        const { tree, id } = ladder[i];
        trees[tree][id] = (trees[tree][id] || 0) + 1;
    }
}

/** Any node with a level whose requirement sits at 0 lifts that requirement to 1. */
function repairRequirements(trees: Record<string, Record<number, number>>, s: SolverLibs): void {
    for (const tree of PERSONAL_TREES) {
        const nodes = s.techTreePositionLibrary?.[tree]?.Nodes || [];
        const byId = new Map<number, any>(nodes.map((n: any) => [n.Id, n]));
        let changed = true;
        while (changed) {
            changed = false;
            for (const n of nodes) {
                if (!(trees[tree][n.Id] > 0)) continue;
                for (const req of n.Requirements || []) {
                    if (byId.has(req) && !(trees[tree][req] > 0)) { trees[tree][req] = 1; changed = true; }
                }
            }
        }
    }
}

export function solveTrees(base: UserProfile, targets: SolveTargets, s: SolverLibs): SolveResult {
    const notes: string[] = [];
    const dmgLadder = buildLadder(DAMAGE_TYPES, s);
    const hpLadder = buildLadder(HEALTH_TYPES, s);
    const equippedIds = new Set((base.skills?.equipped ?? []).map(sk => sk.id));
    const otherSkills = Object.keys(s.skillLibrary || {}).filter(id => !equippedIds.has(id));
    const maxSkillLevel = 99;
    let evaluations = 0;

    const build = (a: number, b: number, otherLevel: number): UserProfile => {
        const trees = baseTrees(s);
        // Clan nodes the card already fixed (speed / range) stay; the ladders add on top.
        trees.Clan = { ...(base.techTree?.Clan || {}) } as Record<number, number>;
        applyLadder(trees, dmgLadder, a);
        applyLadder(trees, hpLadder, b);
        repairRequirements(trees, s);
        const passives: Record<string, number> = { ...(base.skills?.passives ?? {}) };
        for (const sk of base.skills?.equipped ?? []) passives[sk.id] = Math.max(passives[sk.id] ?? 0, sk.level);
        for (const id of otherSkills) passives[id] = otherLevel;
        return {
            ...base,
            techTree: { ...base.techTree, ...trees } as UserProfile['techTree'],
            skills: { ...base.skills, passives },
        };
    };
    const evaluate = (p: UserProfile) => {
        evaluations += 1;
        const st = calculateStats(p, s.libs);
        return { damage: Number(st.totalDamage) || 0, health: Number(st.totalHealth) || 0 };
    };
    // Smallest position whose value reaches the target (values grow with the position).
    const search = (len: number, value: (pos: number) => number, target: number): number => {
        let lo = 0, hi = len;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (value(mid) < target) lo = mid + 1; else hi = mid;
        }
        // The step just below may be closer.
        if (lo > 0 && Math.abs(Math.log(value(lo - 1) / target)) < Math.abs(Math.log(value(lo) / target))) return lo - 1;
        return lo;
    };

    const solveLadders = (otherLevel: number) => {
        let a = Math.floor(dmgLadder.length / 2), b = Math.floor(hpLadder.length / 2);
        for (let round = 0; round < 4; round++) {
            a = search(dmgLadder.length, pos => evaluate(build(pos, b, otherLevel)).damage, targets.totalDamage);
            b = search(hpLadder.length, pos => evaluate(build(a, pos, otherLevel)).health, targets.totalHealth);
        }
        return { a, b };
    };

    let otherLevel = 0;
    let { a, b } = solveLadders(otherLevel);
    let got = evaluate(build(a, b, otherLevel));
    const short = (g: { damage: number; health: number }) =>
        g.damage < targets.totalDamage * 0.995 || g.health < targets.totalHealth * 0.995;

    if (short(got) && otherSkills.length) {
        // The card only shows the 3 equipped skills; every other owned skill adds its passive.
        let lo = 0, hi = maxSkillLevel;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            const g = evaluate(build(dmgLadder.length, hpLadder.length, mid));
            if (short(g)) lo = mid + 1; else hi = mid;
        }
        otherLevel = lo;
        ({ a, b } = solveLadders(otherLevel));
        got = evaluate(build(a, b, otherLevel));
        notes.push(`Owned skills not on the card were assumed at level ${otherLevel} to reach the card totals.`);
    }

    const profile = build(a, b, otherLevel);
    const error = {
        damage: (got.damage - targets.totalDamage) / targets.totalDamage,
        health: (got.health - targets.totalHealth) / targets.totalHealth,
    };
    if (a >= dmgLadder.length && error.damage < -0.005) notes.push('Total Damage stays below the card even with every damage node maxed: some input (items, substats, skins) is probably misread.');
    if (b >= hpLadder.length && error.health < -0.005) notes.push('Total Health stays below the card even with every health node maxed: some input (items, substats, skins) is probably misread.');
    if (a === 0 && error.damage > 0.005) notes.push('Total Damage is above the card with no damage node at all: some input is probably misread.');
    if (b === 0 && error.health > 0.005) notes.push('Total Health is above the card with no health node at all: some input is probably misread.');
    return {
        profile,
        achieved: got,
        error,
        progress: { damage: a / Math.max(1, dmgLadder.length), health: b / Math.max(1, hpLadder.length), otherSkillPassiveLevel: otherLevel },
        evaluations,
        notes,
    };
}
