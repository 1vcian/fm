/**
 * The preset profiles: the strongest builds the game allows, computed from the configs of one
 * version. Pure (no React, no DOM): scripts/build_presets.ts runs it under Node and publishes the
 * result as parsed_configs/<version>/ProfilePresets.json, which the app offers read-only.
 *
 * Every preset starts from the same maxed base, read from the configs:
 *   items     every slot at the highest age, at its highest level (ItemBaseMaxLevel + 1 + every
 *             *LevelUp tech node, buildGameLimits). Items of one age and type share their stats,
 *             only the weapon's index changes the attack (WeaponLibrary windup, range, IsRanged).
 *   trees     every Forge/Power/SkillsPetTech/Clan node at MaxLevel (applyTreeMode 'max'). The
 *             clan nodes that level past MaxLevel (WarPoints, race score) touch no combat stat.
 *   pets      PetSlotsCount pets of the top rarity at its highest level. PetEquipAction (0x7883078)
 *             only checks the pet instance (Guid) and the unlocked slot count, never the PetId, so
 *             one pet type can fill every slot.
 *   mount     the top rarity at its highest level (MountUpgradeLibrary: stats by rarity only).
 *   skills    every skill owned: passives at SkillPassiveLibrary[rarity].LevelStats.length (they
 *             count for every owned skill), equipped ones at their highest level.
 *   misc      forge level, every ascension, the fairy and the egg hatch slots at their highest.
 *   skins     Weapon, Helmet and Armour skins of one set (every set gives the same bonus) at the
 *             top level with the top roll (MaxStatCount stats from PossibleStats at MaxValue).
 *   substats  every item, pet and mount slot rolled at UpperRange (perfection 100%).
 *
 * The attack animation is one choice among the distinct combat rows the game can run
 * (animationsFor): a top-age weapon with the skin hidden runs its own WeaponLibrary row; a visible
 * weapon skin runs the skin's row instead, -1000 with a melee weapon and -1001 with a ranged one
 * (GetSkinnedItemId 0x7835710 -> SkinConfig.GetMainItemId 0x78965EC / GetSecondaryItemId
 * 0x7896660, then SetUnitWeapon 0x7822F00 applies the whole row). Rows with the same numbers are
 * one option. When a weapon's own row wins, any set can be worn (they all give the same stats)
 * with the animation turned off.
 *
 * Categories, each with its five best distinct builds (animation, pets, skills or fairy differ):
 *   power      in-game Power (PlayerPowerExtensions.CalculatePower 0x785E258, no secondary stat,
 *              no fairy), one build, on top of the page.
 *   dpsMelee / dpsRanged   damage per second, searched on the stat engine's realTotalDps and
 *              ranked on the 24 h tested run, where the attack timing shows.
 *   hpsMelee / hpsRanged   healing per second (regen, lifesteal, skill heals), the same way.
 *   quest      the furthest main quest battle cleared (QuestMeter), searched from where the
 *              strongest builds already get, ranked on the final measurement.
 * The search is coordinate ascent: each choice in turn takes its best value with the others
 * fixed, round after round, until a round changes nothing.
 */
import type { ItemSlot, PetSlot, SavedSkin, SkillSlot, UserProfile } from '../types/Profile';
import { INITIAL_PROFILE } from '../types/Profile';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { applyTreeMode } from '../utils/treeMode';
import { buildGameLimits } from '../utils/ocr/gameLimits';
import { RARITIES } from '../utils/constants';
import { FAIRIES, type FairyName } from '../utils/fairies';
import { skinMaxLevel, equippedFromSaved, isGoodSkin, SKIN_TYPE_TO_SLOT } from '../utils/skinArchive';
import { skillMaxLevel } from '../optimizer/buildOptimizer';
import { runSubstatOptimizer, buildWithAlloc, currentAlloc, type RollableStat, type SubstatBody, type SubstatObjective } from '../optimizer/substatOptimizer';
import { playerUnitSpec, skillSpecs, testedRun, TESTED_SECONDS } from '../engine';
import { QuestMeter, questBattleLabel } from './mainProgress';
import { pvpConfigFromJson } from '../pvp/simulate';
import { EvalCore, localPool, type EvalPool } from './evalPool';
import type { AnimationSwap } from './equivalents';
import { applyBestSkins, topPieces } from './skinsApply';

export type PresetCategory = 'power' | 'dpsMelee' | 'dpsRanged' | 'hpsMelee' | 'hpsRanged' | 'quest' | 'lab';

export type WeaponKind = 'melee' | 'ranged' | 'any';

export interface PresetMetrics {
    /** In-game Power (secondary stats excluded, as the game computes it). */
    power: number;
    totalDamage: number;
    totalHealth: number;
    /** Stat engine DPS and HPS (the profile page's figures). */
    dps: number;
    hps: number;
    /** 24 h tested run on the combat engine. */
    testedDps: number;
    testedHps: number;
    /** Main quest: the furthest battle cleared (win rate >= 50%) and the next one's win rate. */
    quest: {
        index: number;
        total: number;
        label: string;
        winRate: number;
        nextLabel: string;
        nextWinRate: number;
        /** Mean share of the next battle's enemy HP removed in its lost runs (missing in older files). */
        nextLossProgress?: number;
        runs: number;
    };
}

/** The attack animation a build runs (see animationsFor). */
export interface PresetAnimation {
    /** 'skin': the set's weapon skin row, shown. 'weapon': the weapon's own row, any skin hidden. */
    source: 'skin' | 'weapon';
    /** Top-age weapon index (with a skin, any weapon of the same kind runs the same row). */
    weaponIdx: number;
    /** The set whose weapon skin runs, for 'skin'. */
    setId: string | null;
    windup: number;
    /** Other sets whose skin row has the same numbers (the same animation option). */
    sameAs: string[];
}

export interface ProfilePreset {
    /** `${category}${rank}`, e.g. "dpsMelee1". */
    key: string;
    category: PresetCategory;
    /** 1 = the best of its category. */
    rank: number;
    name: string;
    /** What the search maximised, in a few words. */
    goal: string;
    description: string;
    /** The weapons the search could pick from. */
    weapons: WeaponKind;
    animation: PresetAnimation;
    profile: UserProfile;
    metrics: PresetMetrics;
    /** What can be swapped without changing a single number of the build, read from the configs. */
    equivalents?: PresetEquivalents;
    /** Build lab only: arena score against the best build of every category, and what no other build does. */
    lab?: { arenaWinRate: number; unusual: string };
}

/**
 * The build's exact equivalents, from the configs (no simulation): every swap below changes no
 * number of the build.
 *   animations  the same attack row (WindupTime, AttackDuration, AttackRange, IsRanged, IsAiming,
 *               ProjectileId, Hand, Offset): another set's skin shown, or a weapon's own with the
 *               skin animation off (applyAnimation, src/presets/equivalents.ts);
 *   items       per slot, the other items of the same age with the same ItemBalancingLibrary
 *               EquipmentStats (the weapon also with the same attack when the skin is off);
 *   sets        the other sets with the same bonus tiers and piece stats; with the skin animation
 *               on, only those whose weapon skin has the same attack row.
 */
export interface PresetEquivalents {
    animations: AnimationSwap[];
    items: Record<string, number[]>;
    sets: string[];
}

export interface PresetCategoryInfo {
    key: PresetCategory;
    name: string;
    goal: string;
    description: string;
}

/** A category's build with one attack animation and its best skins (all of them, not only the top five). */
export interface PresetVariant {
    animation: PresetAnimation;
    profile: UserProfile;
}

export type StatCategory = 'dpsMelee' | 'dpsRanged' | 'hpsMelee' | 'hpsRanged';

export interface ProfilePresetsFile {
    version: string;
    categories: PresetCategoryInfo[];
    presets: ProfilePreset[];
    /** Per stat category: the search's build without skins (skins are put on afterwards, skinsApply.ts). */
    bare?: Partial<Record<StatCategory, UserProfile>>;
    /** Per stat category: the build with every distinct attack animation and its best skins, for "my best variants". */
    variants?: Partial<Record<StatCategory, PresetVariant[]>>;
    /** Arena round robin between every published build (scripts/build_presets.ts, src/presets/tournament.ts). */
    tournament?: import('./tournament').TournamentResult;
}

/** Raw parsed configs of one version, by file name without ".json". */
export type ConfigFiles = Record<string, any>;

export interface PresetOptions {
    /** Seeded runs per main quest battle, in the search and for the published numbers. */
    questSearchRuns?: number;
    questFinalRuns?: number;
    maxRounds?: number;
    log?: (msg: string) => void;
    /** Where the duels, arena and quest battles run (default: this thread). */
    pool?: EvalPool;
    /** Build lab arena seeds per side and opponent, while ranking and for the published rate. */
    labBattles?: number;
    labFinalBattles?: number;
}

/** Build lab: arena seeds per side and opponent while ranking and for the published rate, extra builds. */
const LAB_BATTLES = 4;
const LAB_FINAL_BATTLES = 10;
const LAB_UNEXPECTED = 4;

/** Builds shown per category. */
export const PRESETS_PER_CATEGORY = 5;
/** Candidates per category re-measured on the 24 h tested run (DPS, HPS) before the final ranking. */
const TESTED_SHORTLIST = 24;

const ITEM_SLOTS: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
const SKIN_SLOTS = ['Weapon', 'Helmet', 'Armour'] as const;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const libKey = (age: number, type: string, idx: number) => `{'Age': ${age}, 'Type': '${type}', 'Idx': ${idx}}`;
const itemType = (slot: string) => (slot === 'Body' ? 'Armour' : slot === 'Shoe' ? 'Shoes' : slot);

function combinations<T>(pool: T[], k: number, from = 0, acc: T[] = [], out: T[][] = []): T[][] {
    if (acc.length === k) { out.push([...acc]); return out; }
    for (let i = from; i < pool.length; i++) { acc.push(pool[i]); combinations(pool, k, i + 1, acc, out); acc.pop(); }
    return out;
}

function multisets<T>(pool: T[], k: number, from = 0, acc: T[] = [], out: T[][] = []): T[][] {
    if (acc.length === k) { out.push([...acc]); return out; }
    for (let i = from; i < pool.length; i++) { acc.push(pool[i]); multisets(pool, k, i, acc, out); acc.pop(); }
    return out;
}

/** What the configs leave open: everything a preset chooses. */
interface Choice {
    weaponIdx: number;
    /** Set whose Weapon/Helmet/Armour skins are worn, or null for no skins. */
    setId: string | null;
    /** Rolled stat per skin type (one of its PossibleStats). */
    skinStats: Record<string, string>;
    /**
     * Weapon skin visible: the attack runs on the skin's weapon row (GetSkinnedItemId 0x77FB0B0),
     * hidden: on the equipped weapon's own row. Stats and set bonus are the same either way.
     */
    skinVisible: boolean;
    /** Pet ids of the top rarity, one per slot. */
    petIds: number[];
    skills: string[];
}

interface Space {
    maxAge: number;
    topRarity: string;
    weaponIdxs: number[];
    /** WeaponLibrary IsRanged of each weapon of the top age. */
    rangedIdxs: Set<number>;
    /** Set id -> skin row per type. */
    sets: Map<string, Record<string, any>>;
    /** PossibleStats types per skin type (same for every good skin). */
    skinStatTypes: Record<string, string[]>;
    petIds: number[];
    skillIds: string[];
    skillSlots: number;
    fairies: (FairyName | null)[];
    fairyLevel: number;
    stats: RollableStat[];
    bodies: SubstatBody[];
}

function readSpace(libs: LibraryData, cfg: ConfigFiles): Space {
    const ib = libs.itemBalancingLibrary as Record<string, any>;
    const ages = Object.keys(ib).map(k => Number(k.match(/'Age': (-?\d+)/)?.[1])).filter(a => Number.isFinite(a));
    // Age 10000 is the default/skin row, not an age a player forges.
    const unlock = cfg.SecondaryStatItemUnlockLibrary as Record<string, any>;
    const forgeAges = new Set(Object.values<any>(unlock).map(r => r.ItemAge));
    const maxAge = Math.max(...ages.filter(a => forgeAges.has(a)));
    const weaponIdxs = Object.keys(ib)
        .filter(k => k.startsWith(`{'Age': ${maxAge}, 'Type': 'Weapon'`))
        .map(k => Number(k.match(/'Idx': (\d+)/)![1]))
        .sort((a, b) => a - b);

    const petLib = libs.petLibrary as Record<string, any>;
    const upgrade = libs.petUpgradeLibrary as Record<string, any>;
    const topRarity = [...RARITIES].reverse().find(r => upgrade?.[r] && Object.values<any>(petLib).some(p => p.PetId.Rarity === r))!;
    const petIds = Object.values<any>(petLib).filter(p => p.PetId.Rarity === topRarity).map(p => p.PetId.Id).sort((a, b) => a - b);

    const skins = libs.skinsLibrary as Record<string, any>;
    const sets = new Map<string, Record<string, any>>();
    const skinStatTypes: Record<string, string[]> = {};
    for (const row of Object.values<any>(skins)) {
        const type = row.SkinId.Type;
        if (!isGoodSkin(row.SkinId.Idx) || !row.BaseSetId) continue;
        const set = sets.get(row.BaseSetId) ?? {};
        set[type] ??= row;
        sets.set(row.BaseSetId, set);
        skinStatTypes[type] ??= row.PossibleStats.map((s: any) => s.StatNode.UniqueStat.StatType);
    }
    for (const [id, set] of sets) if (!SKIN_SLOTS.every(t => set[t])) sets.delete(id);

    const skillLib = libs.skillLibrary as Record<string, any>;
    const fairyLevels = Object.keys(cfg.FairyUpgradesLibrary || {}).map(Number).filter(Number.isFinite);
    const secondary = libs.secondaryStatLibrary as Record<string, any>;
    const stats: RollableStat[] = Object.keys(secondary)
        .filter(id => (secondary[id]?.UpperRange || 0) > 0)
        .sort()
        .map(id => ({ id, upper: secondary[id].UpperRange }));
    const itemSlots = Math.max(...Object.values<any>(unlock).map(r => r.NumberOfSecondStats));
    const petSlotsPerBody = Math.max(...Object.values<any>(cfg.SecondaryStatPetUnlockLibrary).map(r => r.NumberOfSecondStats));
    const petSlots = (libs.petBaseConfig as any).PetSlotsCount as number;
    const bodies: SubstatBody[] = [
        ...ITEM_SLOTS.map(s => ({ key: `item:${s}`, label: s, slots: itemSlots })),
        ...Array.from({ length: petSlots }, (_, i) => ({ key: `pet:${i}`, label: `Pet ${i + 1}`, slots: petSlotsPerBody })),
        { key: 'mount', label: 'Mount', slots: petSlotsPerBody },
    ];
    const rangedIdxs = new Set(weaponIdxs.filter(i => (libs.weaponLibrary as any)[libKey(maxAge, 'Weapon', i)]?.IsRanged === true));
    return {
        maxAge, topRarity, weaponIdxs, rangedIdxs, sets, skinStatTypes, petIds,
        skillIds: Object.keys(skillLib),
        skillSlots: (libs.skillBaseConfig as any).SkillSlotsCount,
        fairies: [null, ...FAIRIES.map(f => f.name)],
        fairyLevel: fairyLevels.length ? Math.max(...fairyLevels) : 0,
        stats, bodies,
    };
}

/** The maxed base every preset shares (no substats, no skins, choices still open). */
function maxedBase(libs: LibraryData, cfg: ConfigFiles, space: Space): UserProfile {
    const limits = buildGameLimits({
        itemBalancingConfig: libs.itemBalancingConfig,
        techTreePositionLibrary: cfg.PlayerTechTreePositionLibrary,
        techNodeValuesLibrary: cfg.PlayerTechTreeNodeValuesLibrary,
        petUpgradeLibrary: libs.petUpgradeLibrary,
        mountUpgradeLibrary: libs.mountUpgradeLibrary,
        skillUpgradeLibrary: cfg.SkillUpgradeLibrary,
        ascensionConfigsLibrary: libs.ascensionConfigsLibrary,
        forgeUpgradeLibrary: cfg.ForgeUpgradeLibrary,
        secondaryStatLibrary: libs.secondaryStatLibrary,
        guildPositionLibrary: libs.guildTechTreePositionLibrary,
        guildUpgradeLibrary: libs.guildTechTreeUpgradeLibrary,
    });
    const p: UserProfile = clone(INITIAL_PROFILE);
    for (const slot of ITEM_SLOTS) {
        const item: ItemSlot = { age: space.maxAge, idx: 0, level: limits.itemLevel(slot), rarity: 'Common', secondaryStats: [] };
        if (!(libs.itemBalancingLibrary as any)[libKey(space.maxAge, itemType(slot), 0)]) throw new Error(`no ${slot} at age ${space.maxAge}`);
        p.items[slot] = item;
    }
    const mounts = Object.values<any>(cfg.MountLibrary).filter(m => m.MountId.Rarity === space.topRarity).map(m => m.MountId.Id).sort((a, b) => a - b);
    p.mount.active = { rarity: space.topRarity, id: mounts[0], level: limits.mountLevel(space.topRarity), evolution: 0, skills: [], secondaryStats: [] };
    p.mount.collection = { [`${space.topRarity}_${mounts[0]}`]: clone(p.mount.active) };

    const skillLib = libs.skillLibrary as Record<string, any>;
    const passiveLib = libs.skillPassiveLibrary as Record<string, any>;
    for (const id of space.skillIds) {
        const rarity = skillLib[id].Rarity;
        p.skills.passives[id] = passiveLib[rarity]?.LevelStats?.length ?? 0;
        p.skills.collection[id] = { id, rarity, level: skillMaxLevel(skillLib[id]), evolution: 0 };
    }
    p.misc = {
        ...p.misc,
        forgeLevel: limits.forgeLevel,
        forgeAscensionLevel: limits.ascension.forge,
        petAscensionLevel: limits.ascension.pets,
        skillAscensionLevel: limits.ascension.skills,
        mountAscensionLevel: limits.ascension.mounts,
        fairy: { name: null, level: space.fairyLevel },
        useSkinWindup: true,
        eggSlots: (libs.petBaseConfig as any).EggHatchSlotMaxCount ?? p.misc.eggSlots,
    };
    return applyTreeMode(p, 'max', libs);
}

/** The base with a choice applied (substats untouched). */
function applyChoice(base: UserProfile, c: Choice, libs: LibraryData, space: Space, petLevel: number): UserProfile {
    const p = clone(base);
    p.items.Weapon = { ...p.items.Weapon!, idx: c.weaponIdx };
    const saved: SavedSkin[] = [];
    for (const type of SKIN_SLOTS) {
        const slot = SKIN_TYPE_TO_SLOT[type];
        const item = p.items[slot]!;
        delete item.skin;
        if (!c.setId) continue;
        const row = space.sets.get(c.setId)?.[type];
        if (!row) continue;
        const stat = c.skinStats[type];
        const def = row.PossibleStats.find((s: any) => s.StatNode.UniqueStat.StatType === stat);
        const s: SavedSkin = {
            id: `preset_${type}`, type, idx: row.SkinId.Idx,
            stats: { [stat]: def.MaxValue },
            level: skinMaxLevel(libs.skinUpgradeLibrary, type, row.SkinId.Idx),
        };
        saved.push(s);
        item.skin = equippedFromSaved(s);
    }
    p.skins = { saved };
    p.misc = { ...p.misc, useSkinWindup: c.skinVisible };
    const keep = p.pets.active.map(x => x?.secondaryStats ?? []);
    p.pets.active = c.petIds.map((id, i): PetSlot => ({ rarity: space.topRarity, id, level: petLevel, evolution: 0, secondaryStats: keep[i] ?? [] }));
    p.pets.collection = Object.fromEntries(c.petIds.map(id => [`${space.topRarity}_${id}`, { rarity: space.topRarity, id, level: petLevel, evolution: 0 }]));
    p.skills.equipped = c.skills.map((id): SkillSlot => clone(p.skills.collection[id]));
    return p;
}

/** A score of a build; `many` scores a whole step's candidates at once (on the pool's threads). */
type Score = ((p: UserProfile) => number) & { many?: (ps: UserProfile[]) => number[] };
const batched = (one: (p: UserProfile) => number, many: (ps: UserProfile[]) => number[]): Score => Object.assign(one, { many });

/** One attack animation option: the combat row it runs and how a choice gets it. */
interface Animation {
    weaponIdx: number;
    /** The set whose weapon skin runs (visible), or null to keep any set with the skin hidden. */
    setId: string | null;
    visible: boolean;
    windup: number;
    /** The row's numbers: options with the same signature are the same animation. */
    sig: string;
    sameAs: string[];
}

const rowSig = (row: any) => JSON.stringify([row?.WindupTime, row?.AttackDuration, row?.AttackRange, row?.IsRanged, row?.IsAiming, row?.ProjectileId, row?.Hand, row?.Offset]);

/** The WeaponLibrary row a choice attacks with (see the header: skin row by weapon kind, else the weapon's own). */
function combatRow(c: Choice, libs: LibraryData, space: Space): any {
    const lib = libs.weaponLibrary as Record<string, any>;
    const weaponSkin = c.skinVisible && c.setId ? space.sets.get(c.setId)?.Weapon : undefined;
    if (weaponSkin) {
        const age = space.rangedIdxs.has(c.weaponIdx) ? -1001 : -1000;
        const row = lib[libKey(age, 'Weapon', weaponSkin.SkinId.Idx)];
        if (row) return row;
    }
    return lib[libKey(space.maxAge, 'Weapon', c.weaponIdx)];
}

/** Every distinct attack animation for one weapon kind: each weapon's own row, each set's skin row. */
function animationsFor(kind: 'melee' | 'ranged', libs: LibraryData, space: Space): Animation[] {
    const weapons = space.weaponIdxs.filter(i => (kind === 'ranged') === space.rangedIdxs.has(i));
    const out = new Map<string, Animation>();
    const add = (a: Omit<Animation, 'sig' | 'sameAs' | 'windup'>, label: string) => {
        const row = combatRow({ weaponIdx: a.weaponIdx, setId: a.setId, skinVisible: a.visible } as Choice, libs, space);
        if (!row) return;
        const sig = rowSig(row);
        const prev = out.get(sig);
        if (prev) prev.sameAs.push(label);
        else out.set(sig, { ...a, windup: row.WindupTime, sig, sameAs: [] });
    };
    for (const w of weapons) add({ weaponIdx: w, setId: null, visible: false }, `weapon ${w}`);
    for (const [setId, set] of space.sets) if (set.Weapon) add({ weaponIdx: weapons[0], setId, visible: true }, setId);
    return [...out.values()];
}

/** The best builds a search met, one per signature (animation, pets, skills, fairy), at most `size`. */
class TopBuilds {
    private readonly items = new Map<string, { value: number; profile: UserProfile }>();
    constructor(private readonly size: number) {}
    add(sig: string, value: number, profile: () => UserProfile) {
        const prev = this.items.get(sig);
        if (prev && prev.value >= value) return;
        if (!prev && this.items.size >= this.size) {
            let worst: string | null = null, worstV = Infinity;
            for (const [k, v] of this.items) if (v.value < worstV) { worstV = v.value; worst = k; }
            if (worstV >= value) return;
            this.items.delete(worst!);
        }
        this.items.set(sig, { value, profile: profile() });
    }
    merge(other: TopBuilds) {
        for (const [k, v] of other.items) this.add(k, v.value, () => v.profile);
    }
    list(): { value: number; profile: UserProfile }[] {
        return [...this.items.values()].sort((a, b) => b.value - a.value);
    }
}

/** One run of the coordinate ascent for a score: the best build, and the best distinct builds it met. */
function search(
    label: string, start: Choice, base: UserProfile, score: Score, objective: SubstatObjective,
    libs: LibraryData, space: Space, petLevel: number, o: Required<PresetOptions>,
    choose: { animations: Animation[]; skills: boolean; substats: boolean; skins?: boolean },
): { best: UserProfile; met: TopBuilds } {
    let choice: Choice = clone(start);
    let substats = base;
    let fairy: FairyName | null = (base.misc.fairy?.name ?? null) as FairyName | null;
    const met = new TopBuilds(TESTED_SHORTLIST * 2);
    const sigOf = (c: Choice) => JSON.stringify([rowSig(combatRow(c, libs, space)), [...c.petIds].sort(), [...c.skills].sort(), fairy]);
    // The current build: the choice on top of the substat-bearing base, plus the fairy.
    const build = (c: Choice) => {
        const p = applyChoice(substats, c, libs, space, petLevel);
        p.misc = { ...p.misc, fairy: { name: fairy, level: space.fairyLevel } };
        return p;
    };
    // Ties on the score are broken by the build's real DPS. Many scores cannot see some choices
    // (Power cannot see the skills, the quest moves in whole battles): without this, those
    // choices kept the search's starting point instead of the strongest equal build.
    const tieOf = (p: UserProfile) => calculateStats(p, libs).realTotalDps || 0;
    let best = score(build(choice));
    let bestTie = tieOf(build(choice));
    met.add(sigOf(choice), best, () => build(choice));
    const tryAll = (name: string, options: Choice[]) => {
        let changed = false;
        const profiles = options.map(build);
        const values = score.many ? score.many(profiles) : profiles.map(p => score(p));
        for (let i = 0; i < options.length; i++) {
            const c = options[i], p = profiles[i], v = values[i];
            met.add(sigOf(c), v, () => p);
            if (v < best * (1 - 1e-9)) continue;
            const t = tieOf(p);
            if (v > best * (1 + 1e-9) || t > bestTie * (1 + 1e-9)) { best = v; bestTie = t; choice = c; changed = true; }
        }
        o.log(`  ${label} ${name}: ${best.toPrecision(6)}`);
        return changed;
    };
    for (let round = 1; round <= o.maxRounds; round++) {
        let changed = false;
        if (choose.substats) {
            const current = build(choice);
            const r = runSubstatOptimizer({
                base: current, current, reference: current, referenceName: '', objective,
                withSkills: true, stats: space.stats, bodies: space.bodies, perfection: 100,
                // Round 1 searches every fairy from scratch; later rounds only refine the current
                // allocation and fairy, since only the other choices moved since then.
                fairies: round === 1 ? space.fairies : [fairy], fairyLevel: space.fairyLevel, extra: null, pvpConfig: null,
                battlesPerSide: 0, keep: 1, customScore: objective === 'custom' ? score : undefined,
                customScoreBatch: objective === 'custom' ? score.many : undefined,
                startAllocs: [currentAlloc(current)], localOnly: round > 1,
            }, libs);
            const withAlloc = buildWithAlloc(current, r.best.alloc, r.best.fairy, space.fairyLevel, space.stats, space.bodies, 100);
            const v = score(withAlloc);
            if (v > best * (1 + 1e-9)) {
                best = v; bestTie = tieOf(withAlloc); changed = true;
                fairy = r.best.fairy;
                substats = clone(base);
                // Keep the rolls on the base bodies: items carry over, pets/mount are read back below.
                for (const slot of ITEM_SLOTS) substats.items[slot]!.secondaryStats = withAlloc.items[slot]!.secondaryStats;
                substats.pets.active = withAlloc.pets.active.map(pt => ({ ...pt }));
                substats.mount.active = clone(withAlloc.mount.active);
                met.add(sigOf(choice), v, () => build(choice));
            }
            o.log(`  ${label} substats (${r.best.fairy ?? 'no fairy'}): ${best.toPrecision(6)}`);
        }
        if (choose.animations.length > 1) {
            changed = tryAll('animation', choose.animations.map(a => ({ ...choice, weaponIdx: a.weaponIdx, setId: a.setId ?? choice.setId, skinVisible: a.visible }))) || changed;
        }
        if (choose.skins !== false) changed = tryAll('skin stats', multisetsPerType(space.skinStatTypes).map(skinStats => ({ ...choice, skinStats }))) || changed;
        changed = tryAll('pets', multisets(space.petIds, choice.petIds.length).map(petIds => ({ ...choice, petIds }))) || changed;
        if (choose.skills) changed = tryAll('skills', combinations(space.skillIds, space.skillSlots).map(skills => ({ ...choice, skills }))) || changed;
        o.log(`${label} round ${round}: ${best.toPrecision(6)}${changed ? '' : ' (stable)'}`);
        if (!changed) break;
    }
    return { best: build(choice), met };
}

/** Every assignment of one PossibleStats type per skin type. */
function multisetsPerType(types: Record<string, string[]>): Record<string, string>[] {
    let out: Record<string, string>[] = [{}];
    for (const t of SKIN_SLOTS) out = out.flatMap(acc => (types[t] ?? []).map(s => ({ ...acc, [t]: s })));
    return out;
}

/** The set a worn skin belongs to (by its Idx for that type), or null. */
function setOfSkin(space: Space, type: string, idx: number | undefined): string | null {
    if (idx === undefined) return null;
    for (const [id, set] of space.sets) if (set[type]?.SkinId.Idx === idx) return id;
    return null;
}

function choiceOf(p: UserProfile, space: Space): Choice {
    return {
        weaponIdx: p.items.Weapon!.idx,
        setId: setOfSkin(space, 'Weapon', p.items.Weapon!.skin?.idx),
        skinStats: Object.fromEntries(SKIN_SLOTS.map(t => [t, Object.keys(p.items[SKIN_TYPE_TO_SLOT[t]]!.skin?.stats ?? {})[0] ?? space.skinStatTypes[t][0]])),
        skinVisible: p.misc.useSkinWindup !== false,
        petIds: p.pets.active.map(x => x.id),
        skills: p.skills.equipped.map(s => s.id),
    };
}

function withDefaults(opts: PresetOptions, libs: LibraryData, cfg: ConfigFiles): Required<PresetOptions> {
    return {
        pool: opts.pool ?? localPool(presetEvalCore(libs, cfg)),
        questSearchRuns: opts.questSearchRuns ?? 8,
        questFinalRuns: opts.questFinalRuns ?? 200,
        maxRounds: opts.maxRounds ?? 6,
        labBattles: opts.labBattles ?? LAB_BATTLES,
        labFinalBattles: opts.labFinalBattles ?? LAB_FINAL_BATTLES,
        log: opts.log ?? (() => {}),
    };
}

export const battleLibsOf = (libs: LibraryData, cfg: ConfigFiles) => ({
    ...libs,
    mainBattleLibrary: cfg.MainBattleLibrary, mainBattleConfig: cfg.MainBattleConfig,
    enemyAgeScalingLibrary: cfg.EnemyAgeScalingLibrary, enemyLibrary: cfg.EnemyLibrary, mountLibrary: cfg.MountLibrary,
});

/** The measurements of the preset search for one version (a worker builds its own). */
export function presetEvalCore(libs: LibraryData, cfg: ConfigFiles): EvalCore {
    return new EvalCore(libs, battleLibsOf(libs, cfg) as LibraryData, pvpConfigFromJson(cfg.PvpBaseConfig));
}

const MAXED = 'Everything at its maximum level (items, trees, clan, pets, mount, skills, skins, ascensions, fairy, substats at their top roll)';

/** The published numbers of a build (24 h tested run, main quest). */
function metricsMaker(libs: LibraryData, cfg: ConfigFiles, o: Required<PresetOptions>) {
    const questFinal = new QuestMeter(battleLibsOf(libs, cfg), o.questFinalRuns, o.pool);
    return (p: UserProfile): PresetMetrics => {
        const s = calculateStats(p, libs);
        const inGame = calculateStats(p, libs, true);
        const tested = testedOf(p, libs);
        const q = questFinal.measure(p);
        return {
            power: inGame.power || 0, totalDamage: s.totalDamage || 0, totalHealth: s.totalHealth || 0,
            dps: s.realTotalDps || 0, hps: s.realTotalHps || 0,
            testedDps: tested.dps, testedHps: tested.hps,
            quest: {
                index: q.index, total: q.total, label: questBattleLabel(q.battle), winRate: q.winRate,
                nextLabel: q.index + 1 < q.total ? questBattleLabel(questFinal.line[q.index + 1]) : 'end of the quest',
                nextWinRate: q.nextWinRate, nextLossProgress: q.nextLossProgress, runs: o.questFinalRuns,
            },
        };
    };
}

/** The published numbers of a build, with the given options (quest runs, pool). */
export function presetMetrics(libs: LibraryData, cfg: ConfigFiles, opts: PresetOptions = {}) {
    return metricsMaker(libs, cfg, withDefaults(opts, libs, cfg));
}

/** 24 h tested run on the combat engine (dummy that cannot die). */
export function testedOf(p: UserProfile, libs: LibraryData): { dps: number; hps: number } {
    const s = calculateStats(p, libs);
    const equipped = p.skills.equipped.map(k => ({ id: k.id, level: k.level }));
    const r = testedRun(playerUnitSpec(s as never), skillSpecs(s as never, equipped, libs.skillLibrary as never), TESTED_SECONDS, 1);
    return { dps: r.dps, hps: r.hps };
}

export const CATEGORIES: PresetCategoryInfo[] = [
    { key: 'power', name: 'Most Power', goal: 'Highest in-game Power',
        description: 'The current Power limit of the game. Power ignores substats and the fairy, so those are the ones of the best DPS build with the same weapon kind.' },
    { key: 'dpsMelee', name: 'DPS Melee', goal: 'Most damage per second, melee',
        description: 'The most damage per second with a melee weapon, ranked on the 24 h test against a dummy that cannot die, where the attack animation shows.' },
    { key: 'dpsRanged', name: 'DPS Ranged', goal: 'Most damage per second, ranged',
        description: 'The most damage per second with a ranged weapon, ranked on the 24 h test against a dummy that cannot die, where the attack animation shows.' },
    { key: 'hpsMelee', name: 'HPS Melee', goal: 'Most healing per second, melee',
        description: 'The most healing per second (regen, lifesteal, skill heals) with a melee weapon, ranked on the 24 h test.' },
    { key: 'hpsRanged', name: 'HPS Ranged', goal: 'Most healing per second, ranged',
        description: 'The most healing per second (regen, lifesteal, skill heals) with a ranged weapon, ranked on the 24 h test.' },
    { key: 'lab', name: 'Build Lab', goal: 'Wins the arena against the other builds',
        description: 'Found by the build lab: arena battles (game PvP rules) against the best build of every category, searching animation, pets, fairy and substats. The active skills barely matter there: the battles end before most of them come into play.' },
    { key: 'quest', name: 'Main Quest', goal: 'Furthest main quest battle',
        description: 'The builds that go furthest in the main quest: the furthest battle cleared (at least 50% wins in the battle simulator, every difficulty in order), searched from where the strongest builds already get.' },
];

/** Everything the stages share, built the same way in every thread (deterministic from the configs). */
export function presetContext(version: string, libs: LibraryData, cfg: ConfigFiles, opts: PresetOptions = {}) {
    const o = withDefaults(opts, libs, cfg);
    const space = readSpace(libs, cfg);
    const base = maxedBase(libs, cfg, space);
    const petLevel = Math.max(1, (libs.petUpgradeLibrary as any)[space.topRarity].LevelInfo.length);
    const anims = { melee: animationsFor('melee', libs, space), ranged: animationsFor('ranged', libs, space) };
    const defaultSet = space.sets.keys().next().value ?? null;
    for (const kind of ['melee', 'ranged'] as const) {
        o.log(`${kind} animations (${anims[kind].length} distinct): ${anims[kind].map(a => `${a.visible ? a.setId : `weapon ${a.weaponIdx}`} ${a.windup.toFixed(3)}s`).join(', ')}`);
    }
    const startFor = (kind: 'melee' | 'ranged'): Choice => ({
        weaponIdx: space.weaponIdxs.find(i => (kind === 'ranged') === space.rangedIdxs.has(i))!,
        setId: defaultSet,
        skinStats: Object.fromEntries(SKIN_SLOTS.map(t => [t, space.skinStatTypes[t][0]])),
        skinVisible: false,
        petIds: Array.from({ length: space.bodies.filter(b => b.key.startsWith('pet:')).length }, () => space.petIds[0]),
        skills: space.skillIds.slice(0, space.skillSlots),
    });
    const all = { skills: true, substats: true };
    o.log(`base: age ${space.maxAge}, ${space.topRarity} pets/mount, ${space.weaponIdxs.length} weapons (${space.rangedIdxs.size} ranged), ${space.sets.size} sets, ${space.skillIds.length} skills, fairy level ${space.fairyLevel}`);

    // ---------------------------------------------------------------- DPS and HPS, melee and ranged
    // Targeted, in two steps:
    //   1. the full search (formula: fast) finds the category's build: pets, skills, skin stats,
    //      fairy, substats and an animation, from one start per weapon of the kind (the search
    //      changes one choice at a time, and a single start once stopped at 1.812q DPS ranged
    //      where another reached 1.825q);
    //   2. that build with every distinct attack animation, the substats refined for each one (the
    //      windup moves the attack speed breakpoints; nothing else depends on the animation), all
    //      measured on the 24 h tested run, where the timing shows. The five best animations are
    //      the category's five builds.
    const dpsOf: Score = p => calculateStats(p, libs).realTotalDps || 0;
    const hpsOf: Score = p => calculateStats(p, libs).realTotalHps || 0;
    /** The substats again, from the build's own allocation and fairy. */
    const refineSubstats = (p: UserProfile, objective: SubstatObjective): UserProfile => {
        const fairy = (p.misc.fairy?.name ?? null) as FairyName | null;
        const r = runSubstatOptimizer({
            base: p, current: p, reference: p, referenceName: '', objective, withSkills: true,
            stats: space.stats, bodies: space.bodies, perfection: 100, fairies: [fairy], fairyLevel: space.fairyLevel,
            extra: null, pvpConfig: null, battlesPerSide: 0, keep: 1, startAllocs: [currentAlloc(p)], localOnly: true,
        }, libs);
        return buildWithAlloc(p, r.best.alloc, r.best.fairy, space.fairyLevel, space.stats, space.bodies, 100);
    };
    const withAnimation = (p: UserProfile, a: Animation) => {
        const c = choiceOf(p, space);
        return applyChoice(p, { ...c, weaponIdx: a.weaponIdx, setId: a.setId ?? c.setId ?? defaultSet, skinVisible: a.visible }, libs, space, petLevel);
    };
    const animLabel = (a: Animation) => (a.visible ? `${a.setId} skin` : `weapon ${a.weaponIdx}`);
    const weaponStarts = (kind: 'melee' | 'ranged') => space.weaponIdxs
        .filter(i => (kind === 'ranged') === space.rangedIdxs.has(i))
        .map(weaponIdx => ({ ...startFor(kind), weaponIdx }));
    // Every set's pieces at their top: what the preset builds wear (applyBestSkins picks among them).
    const sitePieces = topPieces(libs.skinsLibrary, libs.skinUpgradeLibrary, space.sets.keys());
    const swapOf = (a: Animation): AnimationSwap => ({ source: a.visible ? 'skin' : 'weapon', weaponIdx: a.weaponIdx, setId: a.visible ? a.setId : null, windup: a.windup });
    const statCategory = (label: string, kind: 'melee' | 'ranged', score: Score, objective: SubstatObjective, metric: 'dps' | 'hps', starts: Choice[]) => {
        // 1. The search without any skin (each weapon with its own attack): the category's bare build.
        let best: UserProfile | null = null, bestV = -Infinity;
        starts.forEach((st, i) => {
            const r = search(`${label} start ${i + 1}`, { ...st, setId: null, skinVisible: false }, base, score, objective, libs, space, petLevel, o,
                { animations: anims[kind].filter(a => !a.visible), ...all, skins: false });
            const v = score(r.best);
            if (v > bestV * (1 + 1e-9)) { best = r.best; bestV = v; }
        });
        // 2. The bare build with every attack animation: the best skins on top (applyBestSkins),
        //    then the substats refined for that windup, measured on the 24 h tested run.
        // Equal results (the windup lands on the same step) rank by the lower windup.
        const tie = (x: number, y: number) => Math.abs(x - y) <= Math.abs(y) * 1e-9;
        const variants = anims[kind].flatMap(a => {
            const dressed = applyBestSkins(best!, swapOf(a), sitePieces, score);
            if (!dressed) return [];
            const p = refineSubstats(dressed, objective);
            return [{ a, p, tested: testedOf(p, libs)[metric] }];
        }).sort((x, y) => (tie(x.tested, y.tested) ? x.a.windup - y.a.windup : y.tested - x.tested));
        o.log(`${label} by animation (24 h ${metric}): ${variants.map(v => `${animLabel(v.a)} ${v.a.windup.toFixed(3)}s ${v.tested.toPrecision(5)}`).join(', ')}`);
        // Animations with the very same result are one outcome: the next ranks are different results.
        const top: typeof variants = [];
        for (const v of variants) {
            if (top.length >= PRESETS_PER_CATEGORY) break;
            if (!top.some(t => tie(v.tested, t.tested))) top.push(v);
        }
        return { bare: best!, top: top.map(t => t.p), variants: variants.map(v => v.p) };
    };
    return { version, libs, cfg, o, space, base, petLevel, anims, defaultSet, startFor, all, dpsOf, hpsOf, refineSubstats, withAnimation, animLabel, weaponStarts, statCategory };
}
export type PresetContext = ReturnType<typeof presetContext>;

/** One weapon kind's categories: DPS, then HPS (which also starts from the DPS build). */
export interface KindPresets {
    /** bare: the search's build without skins; variants: it with every animation and its best skins; top: the best five. */
    dps: { bare: UserProfile; top: UserProfile[]; variants: UserProfile[] };
    hps: { bare: UserProfile; top: UserProfile[]; variants: UserProfile[] };
}

export function buildKindPresets(ctx: PresetContext, kind: 'melee' | 'ranged'): KindPresets {
    const label = kind === 'melee' ? 'Melee' : 'Ranged';
    const dps = ctx.statCategory(`dps${label}`, kind, ctx.dpsOf, 'dps', 'dps', ctx.weaponStarts(kind));
    // HPS also starts from the DPS build: lifesteal heals a share of the damage dealt.
    const hps = ctx.statCategory(`hps${label}`, kind, ctx.hpsOf, 'hps', 'hps', [...ctx.weaponStarts(kind), choiceOf(dps.bare, ctx.space)]);
    return { dps, hps };
}

/** Most Power, main quest, the published builds and the build lab, from both kinds' categories. */
export function finishPresets(ctx: PresetContext, melee: KindPresets, ranged: KindPresets): ProfilePresetsFile {
    const { version, libs, cfg, o, space, base, petLevel, anims } = ctx;
    const dpsMelee = melee.dps, hpsMelee = melee.hps, dpsRanged = ranged.dps, hpsRanged = ranged.hps;

    // ---------------------------------------------------------------- Most Power
    // Power reads no secondary stat and no fairy (PlayerPowerExtensions.CalculatePower), so the
    // substats, skills, animation and fairy stay those of the best DPS build of the same kind.
    const powerOf: Score = p => calculateStats(p, libs, true).power || 0;
    const powerFrom = (from: UserProfile) => {
        const r = search('power', choiceOf(from, space), from, powerOf, 'dps', libs, space, petLevel, o, { animations: [], skills: false, substats: false });
        return { ...r.best, misc: { ...r.best.misc, fairy: clone(from.misc.fairy), useSkinWindup: from.misc.useSkinWindup } };
    };
    const powerCandidates = [powerFrom(dpsMelee.top[0]), powerFrom(dpsRanged.top[0])];
    const power = powerCandidates.reduce((a, b) => (powerOf(b) > powerOf(a) ? b : a));

    // ---------------------------------------------------------------- Main quest
    // No search over battles: every build the categories made (each one with every animation) is
    // played on the main quest, starting where the best DPS builds already get (the meter walks from
    // its last result, so only the battles around that frontier are played), and the best ones are
    // measured again with the published number of runs.
    const questSearch = new QuestMeter(battleLibsOf(libs, cfg), o.questSearchRuns, o.pool);
    for (const p of [dpsMelee.top[0], dpsRanged.top[0]]) questSearch.measure(p);
    const questCandidates = [...dpsMelee.variants, ...dpsRanged.variants, ...hpsMelee.variants, ...hpsRanged.variants, power];
    const questScores = o.pool.many(questCandidates.map(p => ({ kind: 'quest', p, runs: o.questSearchRuns, hint: questSearch.hintIndex })));
    const questFinal = new QuestMeter(battleLibsOf(libs, cfg), o.questFinalRuns, o.pool);
    const questRanked = questCandidates.map((p, i) => ({ p, v: questScores[i] }))
        .sort((x, y) => y.v - x.v)
        .slice(0, 2 * PRESETS_PER_CATEGORY)
        .map(c => ({ profile: c.p, score: questFinal.measure(c.p).score }));
    // The quest score is coarse (many builds clear the same battle with the same rate): ties go to
    // the higher DPS instead of dropping the builds, and only the very same build counts once.
    const dpsOfBuild = (p: UserProfile) => calculateStats(p, libs).realTotalDps || 0;
    questRanked.sort((x, y) => y.score - x.score || dpsOfBuild(y.profile) - dpsOfBuild(x.profile));
    const questTop: typeof questRanked = [];
    for (const r of questRanked) {
        if (questTop.length >= PRESETS_PER_CATEGORY) break;
        if (!questTop.some(t => JSON.stringify(t.profile) === JSON.stringify(r.profile))) questTop.push(r);
    }
    const quest = questTop.map(r => r.profile);
    o.log(`quest: ${questCandidates.length} builds from ${questSearch.hintIndex + 1}, final ${questTop.map(r => r.score.toFixed(2)).join(', ')}`);

    // ---------------------------------------------------------------- published
    const metricsOf = metricsMaker(libs, cfg, o);
    const animationOf = (p: UserProfile): PresetAnimation => {
        const c = choiceOf(p, space);
        const row = combatRow(c, libs, space);
        const kind = space.rangedIdxs.has(c.weaponIdx) ? 'ranged' : 'melee';
        const same = anims[kind].find(a => a.sig === rowSig(row));
        const skin = c.skinVisible && !!c.setId;
        return { source: skin ? 'skin' : 'weapon', weaponIdx: c.weaponIdx, setId: skin ? c.setId : null, windup: row?.WindupTime ?? 0, sameAs: same?.sameAs ?? [] };
    };
    // ---- exact equivalents, from the configs
    const ib = libs.itemBalancingLibrary as Record<string, any>;
    const statsSig = (type: string, idx: number) => JSON.stringify(ib[libKey(space.maxAge, type, idx)]?.EquipmentStats ?? null);
    const idxsOf = (type: string) => Object.keys(ib).filter(k => k.startsWith(`{'Age': ${space.maxAge}, 'Type': '${type}'`)).map(k => Number(k.match(/'Idx': (\d+)/)![1]));
    const setSig = (setId: string) => {
        const set = space.sets.get(setId)!;
        const pieces = SKIN_SLOTS.map(t => JSON.stringify(set[t]?.PossibleStats ?? null)).join('|');
        return `${JSON.stringify((cfg.SetsLibrary as any)?.[setId]?.BonusTiers ?? null)}|${pieces}`;
    };
    const equivalentsOf = (p: UserProfile): PresetEquivalents => {
        const c = choiceOf(p, space);
        const skinOn = c.skinVisible && !!c.setId;
        const kind = space.rangedIdxs.has(c.weaponIdx) ? 'ranged' : 'melee';
        const sig = rowSig(combatRow(c, libs, space));
        const anim = anims[kind].find(a => a.sig === sig);
        const animations: AnimationSwap[] = anim ? [anim, ...anim.sameAs.map(x => (/^weapon \d+$/.test(x)
            ? { weaponIdx: Number(x.slice(7)), setId: null, visible: false }
            : { weaponIdx: anim.weaponIdx, setId: x, visible: true }))]
            .map(a => ({ source: a.visible ? 'skin' as const : 'weapon' as const, weaponIdx: a.weaponIdx, setId: a.visible ? a.setId : null, windup: anim.windup }))
            .filter(w => (w.source === 'skin' ? !(skinOn && w.setId === c.setId) : !(!skinOn && w.weaponIdx === c.weaponIdx))) : [];
        const items: Record<string, number[]> = {};
        for (const slot of ITEM_SLOTS) {
            const it = p.items[slot];
            if (!it) continue;
            const type = itemType(slot);
            items[slot] = idxsOf(type).filter(i => {
                if (i === it.idx || statsSig(type, i) !== statsSig(type, it.idx)) return false;
                if (slot !== 'Weapon') return true;
                // The weapon also keeps its kind, and with the skin off its own attack.
                if (space.rangedIdxs.has(i) !== space.rangedIdxs.has(it.idx)) return false;
                return skinOn || rowSig(combatRow({ ...c, weaponIdx: i }, libs, space)) === sig;
            });
        }
        const own = c.setId;
        const sets = own ? [...space.sets.keys()].filter(id => id !== own && setSig(id) === setSig(own)
            && (!skinOn || rowSig(combatRow({ ...c, setId: id }, libs, space)) === sig)) : [];
        return { animations, items, sets };
    };
    const info = new Map(CATEGORIES.map(c => [c.key, c]));
    const presets: ProfilePreset[] = [];
    const publish = (category: PresetCategory, weapons: WeaponKind, builds: UserProfile[]) => {
        const c = info.get(category)!;
        builds.forEach((p, i) => {
            const name = builds.length > 1 ? `${c.name} #${i + 1}` : c.name;
            presets.push({
                key: `${category}${i + 1}`, category, rank: i + 1, name, goal: c.goal, weapons,
                description: `${c.description} ${MAXED}.`, animation: animationOf(p), equivalents: equivalentsOf(p),
                profile: { ...p, id: '', name, isShared: undefined }, metrics: metricsOf(p),
            });
        });
    };
    publish('power', space.rangedIdxs.has(power.items.Weapon!.idx) ? 'ranged' : 'melee', [power]);
    publish('dpsMelee', 'melee', dpsMelee.top);
    publish('dpsRanged', 'ranged', dpsRanged.top);
    publish('hpsMelee', 'melee', hpsMelee.top);
    publish('hpsRanged', 'ranged', hpsRanged.top);
    publish('quest', 'any', quest);

    // ---------------------------------------------------------------- Build lab
    // Arena score against the best build of every category: a win 1, a draw 0.5, LAB_BATTLES seeds
    // on each side. The candidates: every build the categories made with every animation, the best
    // DPS builds with every fairy (substats searched again for it), and the best build of every
    // category with every pet combination. The Arena Champion is the best of them; the other lab
    // builds are the best ones with an attack animation, a fairy or pets no published build uses.
    // The active skills stay the categories' ones: in battles this short they barely change a result.
    if (pvpConfigFromJson(cfg.PvpBaseConfig)) {
        const field = presets.filter(p => p.rank === 1).map(p => p.profile);
        const arenaWith = (perSide: number): Score => batched(
            p => o.pool.arena(p, field, perSide),
            ps => o.pool.many(ps.map(p => ({ kind: 'arena', p, field, perSide }))));
        const arenaOf = arenaWith(o.labBattles);
        const arenaFinal = arenaWith(o.labFinalBattles);
        const withFairy = (p: UserProfile, fairy: FairyName | null) => {
            const r = runSubstatOptimizer({
                base: p, current: p, reference: p, referenceName: '', objective: 'dps', withSkills: true,
                stats: space.stats, bodies: space.bodies, perfection: 100, fairies: [fairy], fairyLevel: space.fairyLevel,
                extra: null, pvpConfig: null, battlesPerSide: 0, keep: 1, startAllocs: [currentAlloc(p)],
            }, libs);
            return buildWithAlloc(p, r.best.alloc, r.best.fairy, space.fairyLevel, space.stats, space.bodies, 100);
        };
        const withPets = (p: UserProfile, petIds: number[]) => applyChoice(p, { ...choiceOf(p, space), petIds }, libs, space, petLevel);
        const labCandidates = [
            ...dpsMelee.variants, ...dpsRanged.variants, ...hpsMelee.variants, ...hpsRanged.variants,
            ...[dpsMelee.top[0], dpsRanged.top[0]].flatMap(p => space.fairies.map(f => withFairy(p, f))),
            ...field.flatMap(p => multisets(space.petIds, p.pets.active.length).map(ids => withPets(p, ids))),
        ];
        const labScores = arenaOf.many!(labCandidates);
        const labRanked = labCandidates.map((p, i) => ({ profile: p, value: labScores[i] })).sort((x, y) => y.value - x.value);
        o.log(`lab: ${labCandidates.length} candidates, best ${(labRanked[0].value * 100).toFixed(1)}%`);
        const lab = { best: labRanked[0].profile, met: { list: () => labRanked } };
        const traitOf = (p: UserProfile) => ({
            anim: rowSig(combatRow(choiceOf(p, space), libs, space)),
            fairy: p.misc.fairy?.name ?? null,
            pets: p.pets.active.map(x => x.id).sort((a, b) => a - b).join(','),
        });
        const used = presets.map(p => traitOf(p.profile));
        const petName = (id: number) => {
            const row = Object.values<any>(cfg.PetLibrary ?? {}).find(r => r.PetId.Rarity === space.topRarity && r.PetId.Id === id);
            return row?.Name ? String(row.Name).replace(/([a-z])([A-Z])/g, '$1 $2') : `pet ${id}`;
        };
        /** What a build does that no published build does, by kind. */
        const novelties = (p: UserProfile) => {
            const t = traitOf(p);
            const a = animationOf(p);
            const out: { kind: 'animation' | 'fairy' | 'pets'; text: string }[] = [];
            if (!used.some(u => u.anim === t.anim)) out.push({ kind: 'animation', text: a.source === 'skin' ? `${a.setId!.replace(/Set$/, '')} skin animation` : `weapon ${a.weaponIdx} animation` });
            if (!used.some(u => u.fairy === t.fairy)) out.push({ kind: 'fairy', text: t.fairy ? `fairy ${t.fairy}` : 'no fairy' });
            if (!used.some(u => u.pets === t.pets)) {
                const counts = new Map<string, number>();
                for (const x of p.pets.active) counts.set(petName(x.id), (counts.get(petName(x.id)) ?? 0) + 1);
                out.push({ kind: 'pets', text: [...counts].map(([n, c]) => (c > 1 ? `${c}x ${n}` : n)).join(' + ') });
            }
            return out;
        };
        const describe = (p: UserProfile) => novelties(p).map(n => n.text).join(', ');
        // One build per kind of novelty first (the best with a new animation, with a new fairy,
        // with new pets), then the next best of any kind.
        const picked: UserProfile[] = [];
        const same = (x: UserProfile, y: UserProfile) => { const a = traitOf(x), b = traitOf(y); return a.anim === b.anim && a.fairy === b.fairy && a.pets === b.pets; };
        const ranked = lab.met.list().filter(m => novelties(m.profile).length > 0 && !same(m.profile, lab.best));
        for (const kind of ['animation', 'fairy', 'pets'] as const) {
            const m = ranked.find(r => novelties(r.profile).some(n => n.kind === kind) && !picked.some(q => same(q, r.profile)));
            if (m && picked.length < LAB_UNEXPECTED) picked.push(m.profile);
        }
        for (const m of ranked) {
            if (picked.length >= LAB_UNEXPECTED) break;
            if (!picked.some(q => same(q, m.profile))) picked.push(m.profile);
        }
        const info = CATEGORIES.find(c => c.key === 'lab')!;
        const addLab = (p: UserProfile, rank: number, name: string, unusual: string) => {
            const score = arenaFinal(p);
            o.log(`${name}: ${(score * 100).toFixed(1)}% vs the category builds${unusual ? `, ${unusual}` : ''}`);
            presets.push({
                key: `lab${rank}`, category: 'lab', rank, name, goal: info.goal, weapons: space.rangedIdxs.has(p.items.Weapon!.idx) ? 'ranged' : 'melee',
                description: `${info.description} It wins ${(score * 100).toFixed(1)}% of its arena battles against them. ${MAXED}.`,
                animation: animationOf(p), equivalents: equivalentsOf(p), profile: { ...p, id: '', name, isShared: undefined }, metrics: metricsOf(p),
                lab: { arenaWinRate: score, unusual },
            });
        };
        addLab(lab.best, 1, 'Arena Champion', '');
        picked.forEach((p, i) => addLab(p, i + 2, `Lab: ${describe(p)}`, describe(p)));
    }
    const bare = { dpsMelee: dpsMelee.bare, dpsRanged: dpsRanged.bare, hpsMelee: hpsMelee.bare, hpsRanged: hpsRanged.bare };
    const variants = Object.fromEntries(([['dpsMelee', dpsMelee], ['dpsRanged', dpsRanged], ['hpsMelee', hpsMelee], ['hpsRanged', hpsRanged]] as const)
        .map(([k, c]) => [k, c.variants.map(p => ({ animation: animationOf(p), profile: p }))]));
    return { version, categories: CATEGORIES, presets, bare, variants };
}

export function buildProfilePresets(version: string, libs: LibraryData, cfg: ConfigFiles, opts: PresetOptions = {}): ProfilePresetsFile {
    const ctx = presetContext(version, libs, cfg, opts);
    return finishPresets(ctx, buildKindPresets(ctx, 'melee'), buildKindPresets(ctx, 'ranged'));
}
