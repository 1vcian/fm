/**
 * WAR POINTS — what a member can still SCORE with what they are holding right now.
 * ==============================================================================
 *
 * WHAT THIS ANSWERS, AND WHAT IT REFUSES TO ANSWER
 * -----------------------------------------------
 * One question, the owner's: *of the eight Guild War task categories, how many points can this
 * member still OBTAIN from the resources in their profile?* Not points already scored, not points
 * per day of a schedule, not a plan — the spendable value of a bank of keys, eggs, tickets,
 * winders, hammers, coins, gems and potions, projected onto the war days that award each category.
 *
 * And one thing it refuses: publishing a number without saying how much it can be trusted. Every
 * category carries a `confidence` and a `reason`, because the failure mode is not a slightly wrong
 * total — it is a clan leader benching a player over a zero that meant "this app cannot see your
 * pet collection". So:
 *
 *   'exact'        the number is what the game config pays for those resources. Where the game
 *                  rolls dice (forge age drops, summon rarities) it is the EXPECTED value over the
 *                  configured distribution — the same thing every calculator page in this app
 *                  shows, and the only sense in which "exact" is available at all.
 *   'lower-bound'  something obtainable is knowingly NOT counted, and `reason` names it. The true
 *                  figure is at or above `points`.
 *   'unavailable'  the input does not exist in the profile, or the game mechanic is not modelled
 *                  anywhere in this app. `points` is 0 and that 0 MUST NOT be rendered as a value.
 *                  Where a ceiling can be derived it is in `parts['excluded:']`, so a UI can show
 *                  "n/a (at most N)" instead of a bare dash.
 *
 * THREE THINGS 'exact' IS NOT ALLOWED TO SURVIVE — all three enforced in `emit`, all three found by
 * an adversarial re-derivation rather than by reasoning:
 *   * A ZERO. `INITIAL_PROFILE` stores coins/gems/potions/tickets/winders/keys/hammers as literal
 *     0, and `createProfile()` spreads it, so `recorded()` cannot tell an empty bank from a profile
 *     nobody filled in. Five categories used to publish `exact 0` for every brand-new member.
 *   * A MISSING CLAN TREE. 21 of the 23 selectable config versions ship no
 *     `GuildTechTreePositionLibrary.json`; `useGameData` reports the 404 as `loading:false,
 *     data:null`, so the publish gate lets it through and every `WarPointsFrom` multiplier reads
 *     0. A member with the ClanWar nodes maxed published figures 28.6 % low, marked exact.
 *   * AN UNPRICED INPUT. Eggshells with no `EggSummonConfig`, or a `Hatch<Rarity>Egg` task the
 *     config version does not have — measured at 86 % understatement, wearing a tick.
 *
 * NOTHING IS HARD-CODED THAT THE CONFIG KNOWS
 * -------------------------------------------
 * Day assignments come from `computeWarDaysMap(GuildWarDayConfigLibrary.json)` and point values
 * from `getWarPointsForTask()`, which searches every day — so a config version that moves `eggs`
 * from Thursday to Friday, or reprices a Mythic hatch, needs no edit here. Clan multipliers come
 * from `GuildTechTreeUpgradeLibrary.json` via the flattened `GuildTechTreePositionLibrary.json`
 * order, which is the same globalId flattening `ClanContext.pullTree`, `Clan.tsx` and `TechTree.tsx`
 * use. Today's layout (`2026_08_21_00_29`) happens to be forge 0/2/4, dungeons+skills 0/2 , and
 * day 5 has NO tasks at all — none of which appears as a literal below.
 *
 * WHY IT IS A PLAIN FUNCTION AND NOT A HOOK
 * -----------------------------------------
 * `ClanContext` publishes this into `profiles.clan_share`, and a verification script has to be able
 * to run it head-less. React-free is therefore a requirement, not a preference. It also rules out
 * reading `useTreeModifiers()`: that hook resolves the header's My/Max/Empty toggle, and a member
 * with the toggle on "Max" would publish fiction to fifty people. Clan and player tree levels are
 * read STRAIGHT from `profile.techTree` here, always.
 *
 * WHAT IT REUSES RATHER THAN REIMPLEMENTS
 * ---------------------------------------
 *   `guildWarUtils.ts`    day map, task→category classification, per-task point values.
 *   `techOptimizer.ts`    the real greedy tech-tree optimiser, extracted out of `useTreeOptimizer`
 *                         precisely so this file can call it (that hook writes the profile on
 *                         mount, which would fight the sync ledger).
 * The forge, dungeon, skill, mount and egg arithmetic is small enough that the calculators' own
 * `useMemo` bodies were re-derived here from the same config keys rather than extracted — every one
 * of them is verified against the number its page renders by
 * `reverseForge/scratch/war_points_oracle.mjs`, which is the only reason that duplication is
 * tolerable. If those pages change, that script fails.
 *
 * THE THREE PLACES THIS DELIBERATELY DISAGREES WITH THE CALCULATOR PAGES
 * ---------------------------------------------------------------------
 *  1. THE DAY BOOST IS NOT IN THE CATEGORY TOTAL. Every page multiplies by
 *     `(1 + categoryNode + WarPointsOnDay<today>)` when its category happens to be active today.
 *     For a whole-week "still obtainable" figure that is wrong in both directions: it boosts points
 *     that will be scored on a different day, and drops the boost entirely when run on a Monday.
 *     Here the per-day node is applied in `byDay[]`, where the day is known, and
 *     `categories[c].points` carries only `(1 + categoryNode)`. To reproduce a page's number:
 *         page = points + basePoints * dayBoostOfToday   (when today is one of `days`)
 *  2. COINS ARE CAPPED BY A KNOWN SINK. See `forgeSpend` below.
 *  3. GEMS ARE SPENT ONCE. `useTreeOptimizer`, `useEggsCalculator` and the old clan-share estimate
 *     each spent the whole gem pile, so the same gem bought three different things. Here one
 *     allocation is made, reported in `gemAllocation`, and every category that did not get the gems
 *     says so in its reason.
 *
 * NOT IN SCOPE: `statEngine.ts` and the New/Old stats toggle. No war category reads `power`, and
 * nothing here calls `calculateStats`. `power` is untouched.
 */

import { AGES } from './constants';
import {
    computeWarDaysMap,
    getWarDayIndex,
    getWarDayName,
    getWarPointsForTask,
    type WarCategory,
} from './guildWarUtils';
import { getTechNodeName } from './techUtils';
import { optimizeTechTree, type TechTreeLevels } from './techOptimizer';

/* ------------------------------------------------------------------------------------------ *
 * Public shape
 * ------------------------------------------------------------------------------------------ */

export type WarConfidence = 'exact' | 'lower-bound' | 'unavailable';

/** The eight categories, in the order a report should list them. Mirrors `WarCategory`. */
export const WAR_CATEGORIES: WarCategory[] = [
    'tech', 'forge', 'forgeSpend', 'dungeons', 'skills', 'mounts', 'eggs', 'pets',
];

/** The game's six rarities in ascending order — the suffix of every per-rarity task name. */
const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

/**
 * Which war task each dungeon key spends. Key names are the app's
 * (`profile.misc.dungeonKeyCounts`), task names are the config's. Taken from `src/pages/Dungeons.tsx`
 * rather than invented, so the page and the roster cannot disagree about what a Skill key does.
 */
const DUNGEON_KEY_TASKS: Record<string, string> = {
    Hammer: 'UseHammerThiefDungeonKey',
    Skill: 'UseGhostTownDungeonKey',
    Egg: 'UseInvasionDungeonKey',
    Potion: 'UseZombieInvasionDungeonKey',
};

export interface WarCategoryPoints {
    category: WarCategory;
    /**
     * Points still obtainable, with the category's clan node applied and NO per-day node.
     * Rounded to a whole point — war points are integers in game.
     */
    points: number;
    /** `points` before the clan node, i.e. straight from the config's reward amounts. */
    basePoints: number;
    confidence: WarConfidence;
    /** One sentence a tooltip can show verbatim. Always populated, including when `exact`. */
    reason: string;
    /** War day indices this category scores on, from `computeWarDaysMap()`. Never hard-coded. */
    days: number[];
    /** The clan `WarPointsFrom` multiplier applied, as a fraction (0.4 = +40%). */
    categoryBonus: number;
    /**
     * Named sub-totals, all in FINAL war points — every value already carries the clan node that
     * applies to it, so they are directly comparable to `points` and to each other.
     *
     * Two kinds of key, and the difference matters:
     *   plain           a slice OF `points`. Σ of these == `points` (to within one point per key,
     *                   since each is rounded on its own).
     *   `excluded:`    NOT in `points`. The ceiling or the remainder the confidence marker is
     *                   about — a mount-merge half, coins past the known forge sink — carrying its
     *                   OWN clan node, which is why it cannot simply be added to `basePoints`.
     */
    parts: Record<string, number>;
    /**
     * Numbers that are not war points: potions spent, upgrades planned, forges performed. Separate
     * from `parts` so that summing `parts` is always meaningful.
     */
    diagnostics: Record<string, number>;
}

export interface WarPointsResult {
    categories: Record<WarCategory, WarCategoryPoints>;
    /** Σ `categories[*].points`. No per-day node applied. */
    total: number;
    /** The same points spread over the six war days, WITH each day's `WarPointsOnDayN` node. */
    byDay: number[];
    /** The same split without the per-day node, so a UI can show what the boost is worth. */
    byDayBase: number[];
    /** Σ `byDay`. Larger than `total` for a member holding day nodes. */
    totalWithDayBoost: number;
    /**
     * How much `total` can be trusted.
     *
     * `exact` only when all eight categories are. Otherwise `lower-bound`, which is the truthful
     * label for the SUM even when a category is `unavailable`: nothing anywhere in this engine is
     * over-counted, so a blind category contributes 0 and the total stays a floor. `unavailable`
     * is reserved for "no category could be computed at all", i.e. the config never loaded.
     */
    confidence: WarConfidence;
    /** Which categories are blind. Name these in a UI instead of showing their zeros. */
    unavailableCategories: WarCategory[];
    /** Global caveats: gem allocation, tech horizon, missing configs, hatch-time feasibility. */
    notes: string[];
    /** Every clan node this engine resolved, by node type, as fractions. For debugging a total. */
    clanBonuses: Record<string, number>;
    /** `WarPointsOnDay16` resolved into a six-element array, index = war day index. */
    dayBoosts: number[];
    /** Hours the tech projection was allowed to plan over. */
    techTimeLimitHours: number;
    /** Where the single gem pile went. `unallocated` is what no category was allowed to spend. */
    gemAllocation: { total: number; forgeSpend: number; tech: number; unallocated: number };
    /** `false` when a config this engine needs was absent; several categories then read `unavailable`. */
    configComplete: boolean;
}

/**
 * The parsed game configs this engine reads. All nullable: a missing config downgrades the
 * categories that need it to `unavailable`, and never throws.
 *
 * These are the file names `useGameData()` serves, including the two it RECONSTRUCTS
 * (`TechTreeLibrary.json` from TechNodes+PlayerTechTreeNodeValues, `TechTreeUpgradeLibrary.json`
 * from PlayerTechTreeTierLibrary) and the one it NORMALISES (`GuildTechTreeUpgradeLibrary.json`,
 * whose `ValuePerLevel` is doubled for pre-`2026_08_21_00_29` versions). Pass what that hook
 * returns — do not read the raw files, or the clan multipliers will be half or double.
 */
export interface WarPointsConfigs {
    /** GuildWarDayConfigLibrary.json — every point value and every day assignment. Required. */
    dayConfig: any;
    /** GuildWarConfig.json — `CoinsSpentOnForgeNeededToGrantOneActionReward`. */
    warConfig?: any;
    /** GuildTechTreePositionLibrary.json — the node order that defines the clan globalIds. */
    guildPositionLibrary?: any;
    /** GuildTechTreeUpgradeLibrary.json — `ValuePerLevel`, `MaxLevel`, `ValuePerInfiniteLevel`. */
    guildUpgradeLibrary?: any;
    /** TechTreeMapping.json — the player tree graph (id, type, tier, requirements). */
    techTreeMapping?: any;
    /** TechTreeLibrary.json (reconstructed) — per node type `Stats[0]` and `MaxLevel`. */
    techTreeLibrary?: any;
    /** TechTreeUpgradeLibrary.json (reconstructed) — per tier `Levels[].{Cost,Duration}`. */
    techTreeUpgradeLibrary?: any;
    /** ForgeConfig.json — the gem-per-second skip rates. */
    forgeConfig?: any;
    /** ItemAgeDropChancesLibrary.json — which ages a forge at level N can produce. */
    itemAgeDropChances?: any;
    /** ForgeUpgradeLibrary.json — the coin cost of every remaining forge level. */
    forgeUpgradeLibrary?: any;
    skillSummonConfig?: any;
    mountSummonConfig?: any;
    eggSummonConfig?: any;
    /** EggLibrary.json — hatch times. OPTIONAL: only used for the feasibility note. */
    eggLibrary?: any;
}

/** The slice of a profile this engine touches. A whole `UserProfile` satisfies it. */
export interface WarPointsProfile {
    misc: Record<string, any>;
    techTree: {
        Forge: Record<number, number>;
        Power: Record<number, number>;
        SkillsPetTech: Record<number, number>;
        Clan: Record<number, number>;
    };
}

export interface WarPointsOptions {
    /** Wall clock. Injectable so a test can pin the war day and the tech plan's start. */
    now?: Date;
    /**
     * Hours the tech optimiser may plan research over. Default: the hours left in the CURRENT war
     * week (to next Tuesday 00:00 UTC), because "still obtainable" means "before this war ends".
     */
    techTimeLimitHours?: number;
    /**
     * Who gets the gem pile. Gems can skip research timers (`tech`) or be dumped straight into the
     * forge for `SpendGemOnForge` (`forgeSpend`) — never both, and the app's own calculators each
     * assumed they got all of them.
     *
     * Default `'forgeSpend'`: it is the only use whose yield is a fixed number in the config
     * (`SpendGemOnForge`, one reward per gem) rather than the outcome of a schedule, so it is the
     * one figure that cannot be argued with. `'tech'` hands the same gems to the optimiser to buy
     * research seconds instead; `'none'` spends them nowhere.
     */
    gemPolicy?: 'forgeSpend' | 'tech' | 'none';
    /**
     * Honour `profile.misc.useGemsInCalculators`. Default `true`: that flag is the app's single
     * "may a calculator assume I will spend my gems?" switch, and it defaults to OFF, so most
     * members' gems are counted nowhere until they opt in. Projecting a 200 000-gem forge dump for
     * somebody who told the app not to touch their gems is exactly the fiction this file exists to
     * prevent.
     */
    respectGemSwitch?: boolean;
    /** Safety break forwarded to the tech optimiser. */
    techMaxIterations?: number;
}

/* ------------------------------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------------------------------ */

/**
 * "Is there a number here at all?"
 *
 * Catches the field that is absent or non-numeric — `misc.ownedEggs`, `misc.eggshellCount` and
 * `misc.forgeLevel` really can be missing, and `?? 0` (the reflex everywhere else in the app) would
 * turn "never entered" into "has none".
 *
 * IT IS NOT ENOUGH ON ITS OWN, and the reason is `INITIAL_PROFILE`: `createProfile()` spreads it,
 * and it pre-populates `coins: 0`, `gemCount: 0`, `techPotions: 0`, `skillCalculatorTickets: 0`,
 * `mountCalculatorWinders: 0`, `dungeonKeyCounts: {0,0,0,0}` and `forgeCalculator.hammers: '0'`. For
 * those six resources every profile the app has ever made reports `recorded() === true` with a
 * value of 0, so this predicate can never fire for them. The zero-is-not-exact rule in `emit` is
 * what actually protects the roster; this only widens the net.
 */
function recorded(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    const n = Number(value);
    return Number.isFinite(n);
}

/** A recorded count, floored at 0. Only call after `recorded()`. */
function count(value: unknown): number {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function round(n: number): number {
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * Hours left in the current war week, i.e. until the next Tuesday 00:00 UTC.
 *
 * The war week is Tuesday→Monday (`getWarDayIndex` maps Tue=0  Sun and Mon both to 5), and the
 * reset is 00:00 UTC — see `guildWarUtils.ts`. This is the honest horizon for "still obtainable":
 * research that finishes next Wednesday scores in next week's war, not this one.
 */
export function warWeekHoursRemaining(now: Date = new Date()): number {
    const daysSinceTuesday = (now.getUTCDay() - 2 + 7) % 7;
    const hoursIntoDay =
        now.getUTCHours() +
        now.getUTCMinutes() / 60 +
        now.getUTCSeconds() / 3600 +
        now.getUTCMilliseconds() / 3600000;
    return (7 - daysSinceTuesday) * 24 - hoursIntoDay;
}

/**
 * Clan node value for a level, INCLUDING levels past `MaxLevel`.
 *
 * Guild nodes carry `PointsPerInfiniteLevel` / `ValuePerInfiniteLevel`: past the cap a level still
 * costs points but grants a smaller value (today: +4 %/level up to 10, then +1 %/level forever). A
 * war node at level 15 is therefore +45 %, not +60 %.
 *
 * `useTreeModifiers()` and `useClanNodeMax()` both do a flat `ValuePerLevel × level` and `grep -rn
 * "Infinite" src` finds nothing — so for a member above the cap this engine and the calculator
 * pages will legitimately differ, and this is the side that matches the game. Those hooks are not
 * this module's to change; the divergence is asserted and printed by the verification script.
 */
function clanNodeValue(def: any, level: number): number {
    if (!def || level <= 0) return 0;
    const perLevel = Number(def.ValuePerLevel) || 0;
    const maxLevel = Number(def.MaxLevel) || 0;
    if (maxLevel <= 0 || level <= maxLevel) return perLevel * level;

    const perInfinite = Number(def.ValuePerInfiniteLevel) || 0;
    return perLevel * maxLevel + perInfinite * (level - maxLevel);
}

/**
 * Every clan node the member owns, keyed by node type.
 *
 * `profile.techTree.Clan` is keyed by GLOBAL ID — the running index over
 * `Object.keys(GuildTechTreePositionLibrary)` × `Nodes[]`, which is how `TechTree.tsx`, `Clan.tsx`
 * and `ClanContext.pullTree` all number it. Flattening here rather than trusting a stored type name
 * keeps the four in step when the game inserts a node.
 */
function readClanBonuses(configs: WarPointsConfigs, clanLevels: Record<number, number>): Record<string, number> {
    const out: Record<string, number> = {};
    const { guildPositionLibrary, guildUpgradeLibrary } = configs;
    if (!guildPositionLibrary || !guildUpgradeLibrary) return out;

    let globalId = 0;
    for (const category of Object.keys(guildPositionLibrary)) {
        for (const nodeType of guildPositionLibrary[category]?.Nodes || []) {
            const level = Number(clanLevels?.[globalId]) || 0;
            globalId += 1;
            if (level <= 0) continue;
            const value = clanNodeValue(guildUpgradeLibrary[nodeType], level);
            if (value !== 0) out[nodeType] = (out[nodeType] || 0) + value;
        }
    }
    return out;
}

/**
 * Sum of a PLAYER tree node type over the three player trees.
 *
 * Deliberately the same summation every calculator does: walk `TechTreeMapping.trees[*].nodes`,
 * take the levels straight out of the profile, and value a level as
 * `Stats[0].Value + (level - 1) * ValueIncrease`. In particular it does NOT validate a node's
 * requirements — `useSkillsCalculator`, `useMountsCalculator`, `useEggSummonCalculator` and
 * `ForgeCalculator` all skip that check, so validating here would make this engine disagree with
 * every number on screen for a profile whose tree was typed in out of order.
 *
 * The Clan tree is not in this mapping at all; its values come from `readClanBonuses`.
 */
function sumPlayerNode(configs: WarPointsConfigs, profile: WarPointsProfile, nodeType: string): number {
    const { techTreeMapping, techTreeLibrary } = configs;
    if (!techTreeMapping || !techTreeLibrary) return 0;

    const def = techTreeLibrary[nodeType];
    const stat = def?.Stats?.[0];
    if (!stat) return 0;

    let total = 0;
    for (const treeName of ['Forge', 'Power', 'SkillsPetTech'] as const) {
        const nodes = techTreeMapping.trees?.[treeName]?.nodes;
        if (!Array.isArray(nodes)) continue;
        const levels = profile.techTree?.[treeName] || {};
        for (const node of nodes) {
            if (node.type !== nodeType) continue;
            const level = Number(levels[node.id]) || 0;
            if (level > 0) total += (stat.Value || 0) + ((level - 1) * (stat.ValueIncrease || 0));
        }
    }
    return total;
}

/** `SingleSummonCost.Amount` for a summon config, or 0 when the config is missing. */
function singleSummonCost(config: any): number {
    const amount = Number(config?.SingleSummonCost?.Amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * How many units one paid summon yields, from the config's own `PossibleSummonCount`.
 *
 * The first entry is the single-summon size: 5 for skills, 1 for mounts and eggs (the later entries
 * are the bulk buttons, which cost proportionally more and so cannot change points per currency).
 * `useSkillsCalculator` reads `SkillBaseConfig.SummonCount` instead, a key that does NOT exist in
 * `2026_08_21_00_29`, so it falls through to a literal 5 — the same number this derives from config.
 */
function unitsPerSummon(config: any, fallback: number): number {
    const first = Number(config?.PossibleSummonCount?.[0]);
    return Number.isFinite(first) && first > 0 ? first : fallback;
}

/* ------------------------------------------------------------------------------------------ *
 * The rarity distribution of a pile of summons
 * ------------------------------------------------------------------------------------------ */

interface SummonPool {
    /** Expected units obtained, per rarity. */
    byRarity: Record<string, number>;
    /** Σ `byRarity` — the unit count, which is all that matters when rewards are rarity-flat. */
    units: number;
    summons: number;
    /** End state, so a caller can explain a big number ("this takes you to level 61"). */
    endLevel: number;
    endAscension: number;
    /** True when the loop hit its iteration ceiling and the tail was extrapolated. */
    extrapolated: boolean;
}

/**
 * Spend a currency on summons and report the expected rarity mix.
 *
 * This is `useSkillsCalculator` / `useMountsCalculator` / `useEggSummonCalculator`'s shared inner
 * loop: each summon rolls against the CURRENT level's probability row, then adds to a progress
 * counter that levels the summoner up (and, at max level, ascends it and resets to 1). The mix
 * matters only where the reward differs by rarity — that is eggs, where a Mythic hatch pays 64× a
 * Common one. For skills (125 flat) and mounts (600 flat) the caller short-circuits this entirely,
 * because the mix cancels out and a player with a million tickets would otherwise cost a five-digit
 * loop for a number that is `units × 125`.
 *
 * STEADY STATE IS CLOSED-FORM ON PURPOSE. Once the summoner can no longer level (max level with
 * ascension exhausted or disabled) every remaining summon draws the same row, so the tail is
 * multiplied out instead of iterated. That is exact, not an approximation, and it is what keeps this
 * synchronous for an endgame bank.
 *
 * One known deviation: `useEggSummonCalculator`'s copy of this loop tests `currentLevel >
 * maxPossibleLevel` where the skill/mount copies test `>=`, so at the very top of the level range
 * the two can sit one row apart. The skill/mount form is used here (two consumers to one) and the
 * verification script prints the resulting egg-page delta rather than hiding it.
 */
function simulateSummonPool(params: {
    levels: any[];
    startLevel: number;
    startProgress: number;
    startAscension: number;
    simulateAscension: boolean;
    maxAscension: number;
    summons: number;
    unitsPerSummon: number;
    maxIterations?: number;
}): SummonPool {
    const {
        levels, startProgress, startAscension, simulateAscension, maxAscension,
        summons, unitsPerSummon: perSummon,
    } = params;

    const byRarity: Record<string, number> = {};
    for (const rarity of RARITIES) byRarity[rarity] = 0;

    const maxLevel = levels.length || 100;
    const maxIterations = params.maxIterations ?? 1_000_000;

    let level = Math.max(1, Math.min(params.startLevel || 1, maxLevel));
    let progress = Math.max(0, startProgress || 0);
    let ascension = Math.max(0, startAscension || 0);
    let extrapolated = false;

    const rowAt = (lvl: number) => levels[Math.min(Math.max(0, lvl - 1), levels.length - 1)];
    const addRow = (row: any, times: number) => {
        if (!row || times <= 0) return;
        for (const rarity of RARITIES) {
            const chance = Number(row[rarity]) || 0;
            if (chance > 0) byRarity[rarity] += chance * perSummon * times;
        }
    };

    let done = 0;
    while (done < summons) {
        // Frozen? Then the rest of the pile draws this exact row — multiply and stop.
        const frozen = level >= maxLevel && (!simulateAscension || ascension >= maxAscension);
        if (frozen) {
            addRow(rowAt(level), summons - done);
            done = summons;
            break;
        }
        if (done >= maxIterations) {
            addRow(rowAt(level), summons - done);
            extrapolated = true;
            break;
        }

        // Free ascension: at max level the summoner resets to 1 without consuming a summon.
        if (simulateAscension && ascension < maxAscension && level >= maxLevel) {
            level = 1;
            ascension += 1;
        }

        addRow(rowAt(level), 1);
        done += 1;

        progress += perSummon;
        let threshold = rowAt(level)?.SummonsRequired;
        while (threshold && progress >= threshold) {
            progress -= threshold;
            level += 1;
            if (simulateAscension && ascension < maxAscension && level >= maxLevel) {
                level = 1;
                ascension += 1;
                threshold = levels[0]?.SummonsRequired;
            } else if (level > maxLevel) {
                level = maxLevel;
                break;
            } else {
                threshold = rowAt(level)?.SummonsRequired;
            }
        }
    }

    let units = 0;
    for (const rarity of RARITIES) units += byRarity[rarity];

    return { byRarity, units, summons, endLevel: level, endAscension: ascension, extrapolated };
}

/* ------------------------------------------------------------------------------------------ *
 * Per-age forge rewards
 * ------------------------------------------------------------------------------------------ */

/**
 * `Forge<Age>Equipment` reward per age index, straight from the day config.
 *
 * The task names drop the hyphen `AGES` uses ("EarlyModern" vs "Early-Modern"), which is why the
 * match strips it; the explicit `EarlyModern` fallback is carried over from `ForgeCalculator` so a
 * future rename of that one age cannot silently zero a third of the forge total.
 */
function forgePointsPerAge(dayConfig: any): Record<number, number> {
    const out: Record<number, number> = {};
    if (!dayConfig) return out;

    for (const dayData of Object.values<any>(dayConfig)) {
        for (const task of dayData?.Tasks || []) {
            const match = /^Forge(.+)Equipment$/.exec(task?.Task || '');
            if (!match) continue;
            const ageName = match[1];
            let idx = AGES.findIndex(a => a.replace('-', '') === ageName || a === ageName);
            if (idx === -1 && ageName === 'EarlyModern') idx = 2;
            if (idx === -1) continue;
            const reward = (task.Rewards || []).find((r: any) => r?.$type === 'WarPointsReward');
            if (reward?.Amount !== undefined) out[idx] = Number(reward.Amount) || 0;
        }
    }
    return out;
}

/* ------------------------------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------------------------------ */

/**
 * Per-category obtainable war points for one profile.
 *
 * Synchronous, allocation-light and safe to call on every profile edit: the only loop that can grow
 * with the member's bank is the summon simulation, which closes to a multiplication as soon as the
 * summoner stops levelling, and the tech optimiser, which is capped at 500 iterations.
 */
export function computeWarPoints(
    profile: WarPointsProfile,
    configs: WarPointsConfigs,
    options: WarPointsOptions = {},
): WarPointsResult {
    const now = options.now ?? new Date();
    const misc = profile?.misc || {};
    const clanLevels = profile?.techTree?.Clan || {};
    const { dayConfig } = configs;

    const notes: string[] = [];
    const clanBonuses = readClanBonuses(configs, clanLevels);
    const daysMap = computeWarDaysMap(dayConfig);

    /** `WarPointsOnDay16` → index 05. Day N in the node name is war day index N-1. */
    const dayBoosts = [0, 1, 2, 3, 4, 5].map(i => clanBonuses[`WarPointsOnDay${i + 1}`] || 0);

    const configComplete = !!(
        dayConfig && configs.guildPositionLibrary && configs.guildUpgradeLibrary &&
        configs.techTreeMapping && configs.techTreeLibrary && configs.techTreeUpgradeLibrary &&
        configs.forgeConfig && configs.itemAgeDropChances && configs.forgeUpgradeLibrary &&
        configs.warConfig && configs.skillSummonConfig && configs.mountSummonConfig &&
        configs.eggSummonConfig
    );
    if (!dayConfig) notes.push('The war day schedule for this game version did not load, so no category could be computed.');
    else if (!configComplete) notes.push('Some game data for this version was not available, so the categories that needed them read "unavailable" or dropped to a floor. See each one\'s reason.');
    if (dayConfig && !(configs.guildPositionLibrary && configs.guildUpgradeLibrary)) {
        // Named separately from `configComplete` because it is the one missing config that changes
        // EVERY category at once: without it no clan `WarPointsFrom` or `WarPointsOnDayN` level can
        // be read, so every figure below is the unboosted base and no figure can be exact.
        notes.push('This game config version ships no clan tech tree library, so no clan war-point multiplier could be applied. Every figure here is the unboosted base.');
    }

    // ---- the single gem decision, made once, before any category spends one ---------------------
    const gemsHeld = recorded(misc.gemCount) ? count(misc.gemCount) : 0;
    const gemSwitchOn = misc.useGemsInCalculators === true;
    const respectSwitch = options.respectGemSwitch !== false;
    const gemsSpendable = (respectSwitch && !gemSwitchOn) ? 0 : gemsHeld;
    const gemPolicy = options.gemPolicy ?? 'forgeSpend';
    const gemAllocation = {
        total: gemsHeld,
        forgeSpend: gemPolicy === 'forgeSpend' ? gemsSpendable : 0,
        tech: gemPolicy === 'tech' ? gemsSpendable : 0,
        unallocated: 0,
    };
    gemAllocation.unallocated = gemsHeld - gemAllocation.forgeSpend - gemAllocation.tech;
    if (gemsHeld > 0 && gemsSpendable === 0) {
        notes.push(`"Use gems in calculators" is off, so none of the ${gemsHeld.toLocaleString()} gems held are counted anywhere.`);
    } else if (gemsHeld > 0) {
        notes.push(`All ${gemsHeld.toLocaleString()} gems are assigned to ${gemPolicy === 'tech' ? 'skipping research timers (tech tree)' : 'buying forge upgrades with gems (forge spend)'}. A gem cannot be spent twice.`);
    }

    const categories = {} as Record<WarCategory, WarCategoryPoints>;

    /**
     * Could the member's clan `WarPointsFrom` / `WarPointsOnDayN` levels be read at all?
     *
     * `readClanBonuses` needs BOTH guild libraries and returns `{}` without them, which is
     * indistinguishable from "this member has no clan nodes". It is not the same thing: 21 of the
     * 23 selectable config versions ship no `GuildTechTreePositionLibrary.json` at all, and
     * `useGameData` reports a 404 as `loading: false, data: null` — so `ClanContext`'s
     * `configsLoading` gate lets the publish through and every category comes out unboosted. A
     * member with the ClanWar nodes maxed then publishes figures 28.6 % below the truth. Nothing
     * can be `exact` in that state, so `emit` downgrades and says which multiplier is missing.
     */
    const clanTreeReadable = !!(configs.guildPositionLibrary && configs.guildUpgradeLibrary);

    /**
     * Assemble one category: apply its clan node once, round once, and stamp the day list.
     *
     * `parts` is passed with the PLAIN keys as base points — `emit` scales them by the same category
     * node it applies to the total, so a call site never repeats the multiplier and the sum of the
     * plain parts can never drift from `points`. `excluded:` keys are passed already final, because
     * they belong to a different node (a merge node, or a figure the category's node does not touch).
     *
     * TWO CONFIDENCE DOWNGRADES ARE APPLIED HERE RATHER THAN AT EIGHT CALL SITES, because a rule
     * that has to be remembered eight times is a rule that will be forgotten once:
     *
     *  1. NO CLAN TREE, NO `exact`. See `clanTreeReadable` above.
     *  2. AN `exact` ZERO IS NOT PUBLISHABLE. `recorded()` exists to tell "never entered" from
     *     "has none" — and it cannot, because `INITIAL_PROFILE` pre-populates `coins: 0`,
     *     `gemCount: 0`, `techPotions: 0`, `skillCalculatorTickets: 0`, `mountCalculatorWinders: 0`,
     *     `dungeonKeyCounts: {0,0,0,0}` and `forgeCalculator.hammers: '0'`, and `createProfile()`
     *     spreads it. So EVERY profile the app makes reports those fields as recorded zeros, and a
     *     member who joins a clan and never opens the Resources panel used to publish
     *     `dungeons/forge/forgeSpend/mounts/tech = exact 0` — five green ticks on five numbers that
     *     mean "we never asked". A planner benches that member. The points stay 0 either way; what
     *     changes is that the UI now renders `n/a` (its rule 1) instead of a certified 0. The cost
     *     is that a genuinely empty bank also reads `n/a`, which is the honest answer: this engine
     *     cannot tell the two apart, and saying so beats guessing.
     */
    const emit = (
        category: WarCategory,
        basePoints: number,
        bonusNode: string | null,
        confidence: WarConfidence,
        reason: string,
        parts: Record<string, number> = {},
        diagnostics: Record<string, number> = {},
    ): void => {
        const categoryBonus = bonusNode ? (clanBonuses[bonusNode] || 0) : 0;

        let conf = confidence;
        let why = reason;
        if (conf !== 'unavailable' && bonusNode && !clanTreeReadable) {
            if (conf === 'exact') conf = 'lower-bound';
            // Named the way the clan tree page titles the node, not by its config key: a player who
            // reads this has to be able to go and find the node.
            why += ` The clan tree data for this game version did not load, so any "${getTechNodeName(bonusNode)}"`
                + ' levels this member holds are NOT in this number.';
        }
        if (conf === 'exact' && !(basePoints > 0)) {
            conf = 'unavailable';
            why += ' Every input this category reads is zero. And a profile whose Resources panel'
                + ' was never opened stores zeros too, so "none held" cannot be told apart from'
                + ' "never recorded". Published as unavailable rather than as an exact 0.';
        }

        const points = conf === 'unavailable' ? 0 : basePoints * (1 + categoryBonus);
        categories[category] = {
            category,
            points: round(points),
            basePoints: round(conf === 'unavailable' ? 0 : basePoints),
            confidence: conf,
            reason: why,
            days: daysMap[category] ? [...daysMap[category]!] : [],
            categoryBonus,
            parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [
                k, round(k.startsWith('excluded:') ? v : v * (1 + categoryBonus)),
            ])),
            diagnostics: Object.fromEntries(Object.entries(diagnostics).map(([k, v]) => [k, Math.round(v)])),
        };
    };

    /* ---- dungeons: one key, one run, one task completion ---------------------------------- */
    //
    // The only category with no modelling gap at all: a key is consumed, a dungeon is run, the task
    // ticks once, and the reward is flat across all four dungeons. Verified against the total the
    // Dungeon Analyzer prints for the same profile.
    {
        const keys = misc.dungeonKeyCounts;
        if (!dayConfig) {
            emit('dungeons', 0, 'WarPointsFromDungeonKey', 'unavailable', 'No war day config loaded.');
        } else if (!keys || typeof keys !== 'object') {
            emit('dungeons', 0, 'WarPointsFromDungeonKey', 'unavailable',
                'No dungeon key counts recorded. Fill them in under Resources.');
        } else {
            let base = 0;
            const parts: Record<string, number> = {};
            let missingReward = false;
            for (const [key, task] of Object.entries(DUNGEON_KEY_TASKS)) {
                const held = recorded(keys[key]) ? count(keys[key]) : 0;
                const per = getWarPointsForTask(dayConfig, task);
                if (per <= 0) missingReward = true;
                if (held > 0) {
                    base += held * per;
                    parts[key] = held * per;
                }
            }
            emit('dungeons', base, 'WarPointsFromDungeonKey',
                missingReward ? 'lower-bound' : 'exact',
                missingReward
                    ? 'One or more of the dungeon-key tasks pays nothing in this game data version, so those keys were counted at zero.'
                    : 'Exact: one key is one run is one task completion, and the reward is the same for all four dungeons.',
                parts);
        }
    }

    /* ---- forge: hammers through the age drop table ---------------------------------------- */
    //
    // NOT a simulation. One forge yields exactly one item (the AgeN chances of a row sum to 1), the
    // item's age decides the reward, and `FreeForgeChance` turns one hammer into 1/(1-p) forges. So
    // the whole thing is ten multiply-adds over `ItemAgeDropChancesLibrary[forgeLevel-1]`. The
    // expensive machinery on the Forge Calculator page — the `profile.items` scan, the level
    // brackets, `SellBasePrice` over 8 slots × 10 ages — exists only for the COIN columns and has
    // no bearing on points; copying it in would have bought nothing but drift.
    {
        const hammersRaw = misc.forgeCalculator?.hammers;
        const hammers = parseInt(String(hammersRaw ?? ''), 10);
        const forgeLevel = Number(misc.forgeLevel);
        const dropRow = configs.itemAgeDropChances
            ? (configs.itemAgeDropChances[String(forgeLevel - 1)] ?? configs.itemAgeDropChances[String(forgeLevel)])
            : null;

        if (!dayConfig || !configs.itemAgeDropChances) {
            emit('forge', 0, 'WarPointsFromForging', 'unavailable', 'The forge age drop table for this game version has not loaded.');
        } else if (!Number.isFinite(hammers)) {
            emit('forge', 0, 'WarPointsFromForging', 'unavailable',
                'No hammer count recorded. Fill it in under Resources or in the Forge calculator.');
        } else if (!Number.isFinite(forgeLevel) || forgeLevel <= 0 || !dropRow) {
            emit('forge', 0, 'WarPointsFromForging', 'unavailable',
                `No age drop table for forge level ${misc.forgeLevel}. Set your forge level on the profile.`);
        } else {
            const freeForge = Math.min(sumPlayerNode(configs, profile, 'FreeForgeChance'), 0.999);
            const forgesPerHammer = 1 / (1 - freeForge);
            const totalForges = Math.max(0, hammers) * forgesPerHammer;

            const perAge = forgePointsPerAge(dayConfig);
            let pointsPerForge = 0;
            const parts: Record<string, number> = {};
            for (const [key, value] of Object.entries(dropRow)) {
                if (!key.startsWith('Age')) continue;
                const chance = Number(value) || 0;
                if (chance <= 0) continue;
                const ageIdx = parseInt(key.slice(3), 10);
                const reward = perAge[ageIdx] || 0;
                pointsPerForge += chance * reward;
                if (reward > 0) parts[AGES[ageIdx] || key] = totalForges * chance * reward;
            }

            emit('forge', totalForges * pointsPerForge, 'WarPointsFromForging', 'exact',
                `Exact: ${Math.round(totalForges).toLocaleString()} forges from ${hammers.toLocaleString()} hammers `
                + `(free-forge chance ${(freeForge * 100).toFixed(1)}%), priced by the age drop table at forge level ${forgeLevel}. `
                + 'One forge is one item, so this is the expected value of the whole hammer stack.',
                parts,
                { hammers, forges: totalForges, freeForgePercent: freeForge * 100 });
        }
    }

    /* ---- forgeSpend: coins into the forge, plus gems if they were allocated here ---------- */
    //
    // THE BUG THIS FIXES. The formula that shipped was `floor(coins / 1000) * 27` over the WHOLE
    // coin bank, which is not a lower bound — it is an upper bound that can be absurd. Every forge
    // upgrade in the game costs 41.9 M coins in total, i.e. ~1.13 M points for a player starting
    // from level 1; a bank of 500 M coins scored 13.5 M under the old formula, twelve times more
    // points than the forge can ever pay.
    //
    // So coins are capped by the coin sink that is actually KNOWN to exist: the upgrades this member
    // still has ahead of them, `Σ ForgeUpgradeLibrary[level].Cost` from `misc.forgeLevel` up, less
    // the `ForgeUpgradeCost` tech node. That makes the coin half a LOWER bound rather than a wrong
    // number: if the game also charges coins for item enhancement inside the forge (nothing in the
    // parsed configs prices that, so it cannot be checked here), the true figure is higher, and the
    // uncapped ceiling is exposed as `excluded:coinsBeyondKnownForgeSink` so a UI can show a range.
    {
        const coinsRecorded = recorded(misc.coins);
        const coins = coinsRecorded ? count(misc.coins) : 0;
        const coinsPerReward = Number(configs.warConfig?.CoinsSpentOnForgeNeededToGrantOneActionReward) || 0;
        const coinReward = dayConfig ? getWarPointsForTask(dayConfig, 'SpendCoinsOnForge') : 0;
        const gemReward = dayConfig ? getWarPointsForTask(dayConfig, 'SpendGemOnForge') : 0;

        if (!dayConfig || !configs.warConfig || !configs.forgeUpgradeLibrary) {
            emit('forgeSpend', 0, 'WarPointsFromForgeSpend', 'unavailable',
                'The war config and forge upgrade costs for this game version have not loaded.');
        } else if (!coinsRecorded) {
            emit('forgeSpend', 0, 'WarPointsFromForgeSpend', 'unavailable',
                'No coin balance recorded. Fill it in under Resources.');
        } else {
            const forgeLevel = Number(misc.forgeLevel) || 1;
            const costReduction = Math.min(0.95, sumPlayerNode(configs, profile, 'ForgeUpgradeCost'));
            let sink = 0;
            for (const [levelKey, def] of Object.entries<any>(configs.forgeUpgradeLibrary)) {
                if (Number(levelKey) < forgeLevel) continue;
                sink += (Number(def?.Cost) || 0) * (1 - costReduction);
            }

            const spendableCoins = Math.min(coins, sink);
            const coinPts = coinsPerReward > 0 ? Math.floor(spendableCoins / coinsPerReward) * coinReward : 0;
            const uncappedPts = coinsPerReward > 0 ? Math.floor(coins / coinsPerReward) * coinReward : 0;
            const gemPts = gemAllocation.forgeSpend * gemReward;

            const capped = coins > sink;
            const spendBonus = 1 + (clanBonuses['WarPointsFromForgeSpend'] || 0);
            const parts: Record<string, number> = { coins: coinPts, gems: gemPts };
            // `excluded:` keys are final by contract, so the node is applied here rather than by
            // `emit` — even though for once it is the SAME node as the category's.
            if (capped) parts['excluded:coinsBeyondKnownForgeSink'] = (uncappedPts - coinPts) * spendBonus;
            if (gemAllocation.forgeSpend === 0 && gemsHeld > 0) {
                parts['excluded:gemsNotAllocatedHere'] = gemsHeld * gemReward * spendBonus;
            }

            const bounded = capped || (gemsHeld > 0 && gemAllocation.forgeSpend === 0);
            const why = [
                capped
                    ? `Of ${coins.toLocaleString()} coins only ${Math.round(sink).toLocaleString()} are counted. That is every forge upgrade left above level ${forgeLevel}, the one coin sink in the forge this app can price. Spending the whole bank would pay ${Math.round(uncappedPts).toLocaleString()} if a sink that big existed.`
                    : `All ${coins.toLocaleString()} coins fit inside the ${Math.round(sink).toLocaleString()} of forge upgrades still ahead, so the coin half is exact.`,
                gemAllocation.forgeSpend > 0
                    ? `${gemAllocation.forgeSpend.toLocaleString()} gems at ${gemReward} points each.`
                    : (gemsHeld > 0 ? 'Gems are not counted here (see the gem allocation note).' : 'No gems held.'),
            ].join(' ');

            emit('forgeSpend', coinPts + gemPts, 'WarPointsFromForgeSpend',
                bounded ? 'lower-bound' : 'exact', why, parts,
                { coinsHeld: coins, coinsSpendable: spendableCoins, knownForgeSink: sink, gemsSpent: gemAllocation.forgeSpend });
        }
    }

    /* ---- skills: tickets into summons. The upgrade half is unmodellable. ----------------- */
    //
    // `Summon<Rarity>Skill` pays the same 125 for every rarity, so the rarity distribution cancels
    // and the total is `units × 125`: no level simulation is needed, and none is run. What IS missing
    // is the other half of the category — `Upgrade<Rarity>Skill`, also 125 each, boosted by its own
    // clan node (`WarPointsFromSkillUpgrade`, globalId 25). A skill upgrade consumes duplicate
    // skills, which is collection state this app does not model at all: `grep` finds exactly one
    // mention of that node in the codebase, a tooltip string. So `skills` is a lower bound by
    // construction and says so, with the missing half named.
    {
        const ticketsRecorded = recorded(misc.skillCalculatorTickets);
        const tickets = ticketsRecorded ? count(misc.skillCalculatorTickets) : 0;
        const unitCost = singleSummonCost(configs.skillSummonConfig);

        if (!dayConfig || !configs.skillSummonConfig) {
            emit('skills', 0, 'WarPointsFromSkillSummon', 'unavailable', 'The skill summon data for this game version has not loaded.');
        } else if (!ticketsRecorded) {
            emit('skills', 0, 'WarPointsFromSkillSummon', 'unavailable',
                'No skill ticket count recorded. Fill it in under Resources.');
        } else if (unitCost <= 0) {
            emit('skills', 0, 'WarPointsFromSkillSummon', 'unavailable',
                'This game data version does not say what one skill summon costs, so tickets cannot be converted.');
        } else {
            const perSummon = unitsPerSummon(configs.skillSummonConfig, 5);
            const costReduction = Math.min(0.9, sumPlayerNode(configs, profile, 'SkillSummonCost'));
            // The two `ExtraSkillChance` / `ExtraSummonChance` node types do not appear in
            // TechTreeMapping for this config, so this term is 0 today — it is read anyway, because
            // the day it reappears every skill total should move without a code change.
            const extraChance = sumPlayerNode(configs, profile, 'ExtraSkillChance')
                + sumPlayerNode(configs, profile, 'ExtraSummonChance');
            const costPerSummon = Math.max(1, Math.ceil(unitCost * perSummon * (1 - costReduction)));
            const summons = Math.floor(tickets / costPerSummon);
            const units = summons * perSummon * (1 + extraChance);

            // Rarity-flat: read the reward once and assert it by taking the lowest, so a config that
            // ever prices rarities differently degrades to a lower bound instead of guessing high.
            let flat = 0;
            let varies = false;
            for (const rarity of RARITIES) {
                const per = getWarPointsForTask(dayConfig, `Summon${rarity}Skill`);
                if (per <= 0) continue;
                if (flat === 0) flat = per;
                else if (per !== flat) { varies = true; flat = Math.min(flat, per); }
            }

            const upgradeReward = getWarPointsForTask(dayConfig, 'UpgradeCommonSkill');
            emit('skills', units * flat, 'WarPointsFromSkillSummon', 'lower-bound',
                `${summons.toLocaleString()} summons from ${tickets.toLocaleString()} tickets at ${costPerSummon} each `
                + `(${(costReduction * 100).toFixed(0)}% cost reduction) = ${Math.round(units).toLocaleString()} skills at ${flat} points. `
                + `Summons only: Upgrade<Rarity>Skill pays another ${upgradeReward} per upgrade and consumes duplicate skills, `
                + 'which this app does not model, so the real ceiling is higher.'
                + (varies ? ' Rarities are priced differently in this config, so the cheapest was used.' : ''),
                { summons: units * flat },
                { tickets, summons, skills: units, costPerSummon, upgradeRewardPerSkill: upgradeReward });
        }
    }

    /* ---- mounts: winders into summons. Merges need duplicates, so they are excluded. ------ */
    //
    // `Summon<Rarity>Mount` and `Merge<Rarity>Mount` both pay 600 flat, and `useMountsCalculator`
    // counts BOTH for every mount summoned — which is why the Mount Calculator's on-screen total is
    // roughly twice what appears here. That assumption ("every mount obtained is also merged", and
    // the page says so in a footnote) is an upper bound: a merge consumes duplicates, and how many
    // duplicates a summon run produces depends on a collection this app does not store. Counting it
    // would make the roster an over-estimate; excluding it makes the roster a lower bound with the
    // ceiling attached. A leader can then read "1.2 M – 2.4 M" instead of one confident wrong number.
    {
        const windersRecorded = recorded(misc.mountCalculatorWinders);
        const winders = windersRecorded ? count(misc.mountCalculatorWinders) : 0;
        const unitCost = singleSummonCost(configs.mountSummonConfig);

        if (!dayConfig || !configs.mountSummonConfig) {
            emit('mounts', 0, 'WarPointsFromMountSummon', 'unavailable', 'The mount summon data for this game version has not loaded.');
        } else if (!windersRecorded) {
            emit('mounts', 0, 'WarPointsFromMountSummon', 'unavailable',
                'No clock winder count recorded. Fill it in under Resources.');
        } else if (unitCost <= 0) {
            emit('mounts', 0, 'WarPointsFromMountSummon', 'unavailable',
                'This game data version does not say what one mount summon costs, so winders cannot be converted.');
        } else {
            const perSummon = unitsPerSummon(configs.mountSummonConfig, 1);
            const costReduction = Math.min(0.9, sumPlayerNode(configs, profile, 'MountSummonCost'));
            const extraChance = sumPlayerNode(configs, profile, 'ExtraMountChance');
            const costPerSummon = Math.max(1, Math.ceil(unitCost * perSummon * (1 - costReduction)));
            const summons = Math.floor(winders / costPerSummon);
            const units = summons * perSummon * (1 + extraChance);

            let summonFlat = 0;
            let mergeFlat = 0;
            for (const rarity of RARITIES) {
                const s = getWarPointsForTask(dayConfig, `Summon${rarity}Mount`);
                const m = getWarPointsForTask(dayConfig, `Merge${rarity}Mount`);
                if (s > 0) summonFlat = summonFlat === 0 ? s : Math.min(summonFlat, s);
                if (m > 0) mergeFlat = mergeFlat === 0 ? m : Math.min(mergeFlat, m);
            }

            const mergeCeiling = units * mergeFlat * (1 + (clanBonuses['WarPointsFromMountMerge'] || 0));
            emit('mounts', units * summonFlat, 'WarPointsFromMountSummon',
                units > 0 ? 'lower-bound' : 'exact',
                units > 0
                    ? `${Math.round(units).toLocaleString()} mounts from ${winders.toLocaleString()} winders at ${costPerSummon} each, `
                      + `summon task only (${summonFlat} points each). Merge<Rarity>Mount would add up to `
                      + `${Math.round(mergeCeiling).toLocaleString()} more, but a merge consumes duplicate mounts and this app `
                      + 'does not model the collection. That ceiling is what the Mount calculator shows.'
                    : `No winders held, and ${winders.toLocaleString()} is below the ${costPerSummon} one summon costs.`,
                { summons: units * summonFlat, 'excluded:mergeCeiling': mergeCeiling },
                { winders, summons, mounts: units, costPerSummon });
        }
    }

    /* ---- eggs: held eggs exactly, eggshells through the real rarity distribution ---------- */
    //
    // The one category where rarity genuinely matters — a Mythic hatch pays 25 600 against a
    // Common's 400 — so held eggs are counted at their own rarity, and eggshells are run through the
    // egg-summon level simulation instead of being floored at Common the way the previous estimate
    // did. There is no hatch-time or slot constraint here on purpose: "obtainable from what I hold"
    // is a resource question, not a schedule one. That makes this number legitimately LARGER than
    // the Eggs page's, which is boxed by `timeLimitHours` and `EggHatchSlotMaxCount`; the hours the
    // stack actually needs are reported as a note so the gap is visible rather than papered over.
    let hatchableEggs = 0;
    {
        const owned = misc.ownedEggs;
        const shellsRecorded = recorded(misc.eggshellCount);
        const shells = shellsRecorded ? count(misc.eggshellCount) : 0;

        if (!dayConfig) {
            emit('eggs', 0, 'WarPointsFromEggHatch', 'unavailable', 'No war day config loaded.');
        } else if ((!owned || typeof owned !== 'object') && !shellsRecorded) {
            emit('eggs', 0, 'WarPointsFromEggHatch', 'unavailable',
                'No egg counts and no eggshell balance recorded. Fill them in under Resources.');
        } else {
            const hatchPoints: Record<string, number> = {};
            for (const rarity of RARITIES) hatchPoints[rarity] = getWarPointsForTask(dayConfig, `Hatch${rarity}Egg`);

            let heldBase = 0;
            /**
             * Rarities the member holds that this config version prices at nothing.
             *
             * The same guard `dungeons` has, and eggs needs it more: rewards here are NOT flat, so a
             * single renamed task silently deletes a whole rarity. Measured — drop `HatchMythicEgg`
             * from the day config and ten Mythic eggs worth 256 000 collapse to `held:Mythic: 0`
             * while the category still published `exact 40,000`, an 86 % understatement wearing a
             * tick. Anything unpriced makes this a floor, and the rarity is named.
             */
            const unpricedRarities: string[] = [];
            const parts: Record<string, number> = {};
            if (owned && typeof owned === 'object') {
                for (const rarity of RARITIES) {
                    const held = recorded(owned[rarity]) ? count(owned[rarity]) : 0;
                    if (held <= 0) continue;
                    if (hatchPoints[rarity] <= 0) unpricedRarities.push(rarity);
                    heldBase += held * hatchPoints[rarity];
                    hatchableEggs += held;
                    parts[`held:${rarity}`] = held * hatchPoints[rarity];
                }
            }

            let shellBase = 0;
            let shellSummons = 0;
            let extrapolated = false;
            /** Eggs the eggshells convert into, per rarity — the feasibility note needs them too. */
            const shellEggs: Record<string, number> = {};
            const shellCost = singleSummonCost(configs.eggSummonConfig);
            if (shells > 0 && shellCost > 0 && Array.isArray(configs.eggSummonConfig?.Levels)) {
                // `EggsSummonCost` is absent from TechTreeMapping in this config version, so the
                // reduction is 0 today; read anyway, for the same reason as the skill one.
                const costReduction = Math.min(0.9, sumPlayerNode(configs, profile, 'EggsSummonCost'));
                const extraChance = sumPlayerNode(configs, profile, 'ExtraEggChance');
                const perSummon = unitsPerSummon(configs.eggSummonConfig, 1);
                const costPerSummon = Math.max(1, Math.ceil(shellCost * perSummon * (1 - costReduction)));
                shellSummons = Math.floor(shells / costPerSummon);

                const pool = simulateSummonPool({
                    levels: configs.eggSummonConfig.Levels,
                    startLevel: Number(misc.eggSummonLevel) || 1,
                    startProgress: Number(misc.eggSummonProgress) || 0,
                    startAscension: Number(misc.petAscensionLevel) || 0,
                    simulateAscension: misc.simulateAscensionInCalculators !== false,
                    maxAscension: 3,
                    summons: shellSummons,
                    unitsPerSummon: perSummon * (1 + extraChance),
                });
                extrapolated = pool.extrapolated;
                for (const rarity of RARITIES) {
                    const n = pool.byRarity[rarity] || 0;
                    if (n <= 0) continue;
                    if (hatchPoints[rarity] <= 0 && !unpricedRarities.includes(rarity)) unpricedRarities.push(rarity);
                    shellBase += n * hatchPoints[rarity];
                    hatchableEggs += n;
                    shellEggs[rarity] = n;
                    parts[`shells:${rarity}`] = n * hatchPoints[rarity];
                }
            }

            // Feasibility note, when EggLibrary is available: how many slot-hours the stack needs.
            //
            // EVERY egg behind the published figure, held AND eggshell-converted. Counting only the
            // held ones made this note actively misleading: 192 held eggs plus 300 000 eggshells
            // priced 4 692 hatches, of which the note described 192 — it said "118.5 h needed,
            // 156.0 h left" and therefore printed the reassuring full stop, when the real
            // requirement was 7 177 h and 2.2 % of an `exact` figure was reachable before the
            // reset. A note that only ever describes a fraction of the number it sits next to is
            // worse than no note.
            if (configs.eggLibrary) {
                let seconds = 0;
                for (const rarity of RARITIES) {
                    const held = owned && typeof owned === 'object' && recorded(owned[rarity]) ? count(owned[rarity]) : 0;
                    const eggs = held + (shellEggs[rarity] || 0);
                    if (eggs <= 0) continue;
                    const base = Number(configs.eggLibrary[rarity]?.HatchTime) || 0;
                    const speed = 1 + sumPlayerNode(configs, profile, `${rarity}EggTimer`);
                    seconds += eggs * (speed > 0 ? base / speed : base);
                }
                if (seconds > 0) {
                    const slots = Math.max(1, count(misc.eggSlots) || 2);
                    const hoursNeeded = seconds / 3600 / slots;
                    const hoursLeft = warWeekHoursRemaining(now);
                    const share = hoursNeeded > 0 ? Math.min(100, (hoursLeft / hoursNeeded) * 100) : 100;
                    // Verdict FIRST, arithmetic second: `ClanContext` trims a published note to 200
                    // characters, and a caveat whose point is in the last clause is a caveat that
                    // gets cut off exactly when the numbers are big enough to matter.
                    const stack = `${Math.round(hatchableEggs).toLocaleString()} eggs`
                        + `${shellSummons > 0 ? ' (held + eggshell conversions)' : ''} need `
                        + `${hoursNeeded.toFixed(0)} h across ${slots} hatch slots; ${hoursLeft.toFixed(0)} h are left this war week.`;
                    notes.push(
                        hoursNeeded > hoursLeft
                            ? `Only ~${share < 1 ? '<1' : share.toFixed(0)}% of the egg figure can be hatched before the reset: ${stack}`
                            : `The whole egg figure is hatchable before the reset: ${stack}`,
                    );
                }
            }

            if (extrapolated) notes.push('The eggshell simulation hit its iteration ceiling; the tail was extrapolated at the final summon level.');

            // Eggshells that could NOT be priced (no `EggSummonConfig.json` in this config version —
            // four of the selectable ones ship without it) are a knowingly uncounted resource, so
            // the category is a floor, not `exact`. It used to publish `exact` with the ignored
            // eggshell count sitting in `diagnostics` and no mention of it in the reason.
            const shellsUnpriced = shells > 0 && shellSummons === 0;
            const bounded = shellsUnpriced || unpricedRarities.length > 0;
            emit('eggs', heldBase + shellBase, 'WarPointsFromEggHatch',
                bounded ? 'lower-bound' : 'exact',
                `${bounded ? 'Held eggs' : 'Exact: held eggs'} at their own rarity reward`
                + (shellSummons > 0
                    ? `, plus ${shellSummons.toLocaleString()} egg summons from ${shells.toLocaleString()} eggshells priced by the real rarity distribution at summon level ${Number(misc.eggSummonLevel) || 1}.`
                    : '.')
                + (shellsUnpriced
                    ? ` The ${shells.toLocaleString()} eggshells held are NOT counted: this game config version has no`
                      + ' egg summon data, so what they summon cannot be priced. The real figure is higher.'
                    : '')
                + (unpricedRarities.length
                    ? ` Hatching a ${unpricedRarities[0]} egg pays nothing in this game data version`
                      + `${unpricedRarities.length > 1 ? ` (nor for ${unpricedRarities.slice(1).join(', ')})` : ''}, so those eggs were counted at zero.`
                    : '')
                + ' No hatch-time or slot limit is applied: this is what the eggs are worth, not what fits in a day.',
                parts,
                { eggshells: shells, eggSummons: shellSummons, hatchableEggs });
        }
    }

    /* ---- pets: merges, and nothing but merges ---------------------------------------------- */
    //
    // `Merge<Rarity>Pet` is 1250 flat and it is the WHOLE category — there is no pet currency and no
    // pet summon task. A merge consumes a duplicate pet, pets come from hatching eggs, and this app
    // stores no pet collection, so the number of merges a member can still perform is not derivable
    // from anything in the profile. `useEggsCalculator` prices one merge per hatched egg, which is a
    // ceiling, and that ceiling is what the Eggs page's "Merge Pts" shows.
    //
    // This is a deliberate departure from the phase-3 map, which proposed adopting that one-hatch-⇒-
    // one-merge model as the value. Publishing a ceiling as a fact makes every roster total an
    // over-estimate, and there is no config in the parsed set that prices a merge's duplicate cost,
    // so the model cannot be checked. `unavailable` PLUS the ceiling lets a UI render "n/a (≤ N)",
    // which is strictly more information than either a fake number or a fake zero. Flipping this to
    // count the ceiling is a one-line change here if the owner decides the model is right.
    {
        if (!dayConfig) {
            emit('pets', 0, 'WarPointsFromPetMerge', 'unavailable', 'No war day config loaded.');
        } else {
            let mergeFlat = 0;
            for (const rarity of RARITIES) {
                const m = getWarPointsForTask(dayConfig, `Merge${rarity}Pet`);
                if (m > 0) mergeFlat = mergeFlat === 0 ? m : Math.min(mergeFlat, m);
            }
            const ceiling = hatchableEggs * mergeFlat * (1 + (clanBonuses['WarPointsFromPetMerge'] || 0));
            emit('pets', 0, 'WarPointsFromPetMerge', 'unavailable',
                `Every pet-merge task needs a duplicate pet, and this app stores no pet collection, so the number of `
                + `merges still available cannot be derived. Ceiling if all ${Math.round(hatchableEggs).toLocaleString()} `
                + `hatchable eggs each yielded one merge: ${Math.round(ceiling).toLocaleString()}. That is the figure the `
                + `Eggs page shows as "Merge Pts".`,
                { 'excluded:mergeCeiling': ceiling },
                { hatchableEggs, pointsPerMerge: mergeFlat });
        }
    }

    /* ---- tech: the real optimiser, over the rest of the war week -------------------------- */
    //
    // The single largest number on the board (a tier-V node is 90 700 points) and the one the roster
    // most needs. It runs `optimizeTechTree()` — the actual greedy simulation the Tree Calculator
    // uses, extracted so it can be called without mounting a hook — with the tree pinned to the
    // profile's own levels, never the header's My/Max/Empty toggle.
    //
    // The horizon is the rest of the WAR WEEK, not the hook's "until 23:59 tonight": research that
    // finishes after the reset scores in the next war. Only upgrades that COMPLETE on a tech day
    // count, which the optimiser already decides per action from `planStartMs`.
    //
    // WHY THIS RUNS THE OPTIMISER TWICE
    // ---------------------------------
    // The Tree Calculator's plan starts research now and never idles, so an upgrade scores only if
    // the queue happens to drift onto a tech day. That makes the total a function of the CLOCK, not
    // of the resources: measured on one profile with 3,000 potions and a full week left, the tech
    // figure was 0 at 01:00, 56,120 at 22:00 the same day and 77,280 the next — a 77,280-point swing
    // with nothing changed but the hour. The roster sums these and ranks members by them, so two
    // identical members would sort apart and one would read `Tech tree >= 0` beside a 3K potion chip.
    //
    // A player chooses when to START research, so a completion can be walked onto a tech day at
    // will; the only cost is idle time, charged against the same horizon. `alignCompletionsToWarDays`
    // does exactly that, and is the honest answer to "what can these potions still be turned into".
    //
    //   floor   = max(aligned, unaligned) war points. `max` because idling spends horizon and so can
    //             fit fewer upgrades; taking the better of the two cannot regress either question.
    //   ceiling = the unaligned run's TREE points, i.e. every upgrade that fits scores. That is the
    //             answer if completions can be banked and claimed on a war day, which this repo has
    //             no config for — hence a ceiling and not the published figure.
    //
    // It stays a lower bound regardless: the greedy sort by points-per-second is a heuristic, and
    // gems that could buy research seconds went to `forgeSpend` under the default policy.
    const techTimeLimitHours = options.techTimeLimitHours ?? Math.max(0, warWeekHoursRemaining(now));
    {
        const potionsRecorded = recorded(misc.techPotions);
        const potions = potionsRecorded ? count(misc.techPotions) : 0;
        const warBonus = clanBonuses['WarPointsFromTechUpgrade'] || 0;

        const techInput = {
            mapping: configs.techTreeMapping,
            library: configs.techTreeLibrary,
            upgradeLibrary: configs.techTreeUpgradeLibrary,
            dayConfig,
            forgeConfig: configs.forgeConfig,
            techTree: {
                Forge: { ...(profile.techTree?.Forge || {}) },
                Power: { ...(profile.techTree?.Power || {}) },
                SkillsPetTech: { ...(profile.techTree?.SkillsPetTech || {}) },
                Clan: { ...(profile.techTree?.Clan || {}) },
            } as TechTreeLevels,
            potions,
            timeLimitHours: techTimeLimitHours,
            gemBudget: gemAllocation.tech,
            warBonus,
            // Zero on purpose: the per-day node belongs in `byDay`, where the day is known.
            dayBoost: 0,
            planStartMs: now.getTime(),
            maxIterations: options.techMaxIterations,
        };

        const unaligned = potionsRecorded ? optimizeTechTree(techInput) : null;
        const aligned = potionsRecorded
            ? optimizeTechTree({ ...techInput, alignCompletionsToWarDays: true })
            : null;
        // Both runs read the same configs, so either being null means the same thing.
        const result = (unaligned && aligned)
            ? (aligned.totalWarPoints >= unaligned.totalWarPoints ? aligned : unaligned)
            : null;

        if (!potionsRecorded) {
            emit('tech', 0, 'WarPointsFromTechUpgrade', 'unavailable',
                'No tech potion count recorded. Fill it in under Resources.');
        } else if (!result) {
            emit('tech', 0, 'WarPointsFromTechUpgrade', 'unavailable',
                'The tech tree data for this game version has not loaded.');
        } else {
            // The optimiser bakes `warBonus` into its tier values, so undo it once to recover the
            // config-level base. Scaling every tier by the same constant cannot change which
            // upgrades the greedy loop picks (it sorts on points/duration and budgets on potions,
            // seconds and gems), so passing the real bonus and dividing back is equivalent to
            // running it twice — and it keeps this identical to the Tree Calculator's own number.
            const base = warBonus === -1 ? 0 : result.totalWarPoints / (1 + warBonus);
            const scored = result.actions.filter(a => a.isWarDay).length;

            // Already boosted on both sides, so this is final and goes out as an `excluded:` part.
            const untimed = Math.max(0, (unaligned ? unaligned.totalPoints : 0) - result.totalWarPoints);

            const parts: Record<string, number> = {};
            if (untimed > 0) parts['excluded:completionsNotTimedToAWarDay'] = untimed;

            emit('tech', base, 'WarPointsFromTechUpgrade',
                potions === 0 ? 'exact' : 'lower-bound',
                potions === 0
                    ? 'No tech potions held, so no research can be finished. A real zero, not a missing number.'
                    : `${scored} of ${result.actions.length} planned upgrades can be timed to finish on a tech war day `
                      + `inside the ${techTimeLimitHours.toFixed(0)} h left this war week, spending `
                      + `${Math.round(result.potionsUsed).toLocaleString()} of ${potions.toLocaleString()} potions. A floor: `
                      + 'the planner is greedy (points per second), and waiting for a war day costs upgrades.',
                parts,
                {
                    treePoints: result.totalPoints,
                    potionsHeld: potions,
                    potionsUsed: result.potionsUsed,
                    plannedUpgrades: result.actions.length,
                    upgradesOnWarDays: scored,
                    gemsUsed: result.totalGemsUsed,
                    hoursPlanned: result.timeUsed,
                    hoursIdleWaitingForAWarDay: result.idleTimeUsed,
                    // What the same potions score with no timing at all — the number the Tree
                    // Calculator shows, kept so the two screens can be reconciled.
                    untimedWarPoints: unaligned ? unaligned.totalWarPoints : 0,
                });
        }
    }

    /* ---- totals and the day projection ---------------------------------------------------- */
    //
    // A category worth N points across two days is N in TOTAL, not N per day — the resources can
    // only be spent once. The honest split is even, with the remainder on the earliest day so the
    // six numbers add back up exactly. Then, and only then, each day's own `WarPointsOnDayN` node
    // applies, because that node is what a member earns for scoring ON that day. A member who
    // concentrates everything on their single boosted day beats `totalWithDayBoost`; this is a
    // projection of availability, not a plan.
    const byDayBase = [0, 0, 0, 0, 0, 0];
    let total = 0;
    for (const category of WAR_CATEGORIES) {
        const entry = categories[category];
        if (!entry) continue;
        total += entry.points;
        const days = entry.days.filter(d => d >= 0 && d < byDayBase.length);
        if (!days.length || entry.points <= 0) continue;
        const share = Math.floor(entry.points / days.length);
        const remainder = entry.points - share * days.length;
        for (const day of days) byDayBase[day] += share;
        byDayBase[days[0]] += remainder;
    }
    const byDay = byDayBase.map((v, i) => round(v * (1 + dayBoosts[i])));
    const totalWithDayBoost = byDay.reduce((a, b) => a + b, 0);

    // The headline marker is about the SUM, and a sum of things that are each exact-or-under is a
    // lower bound — including the blind ones, which contribute 0 and so cannot push it too high.
    // Calling the whole total `unavailable` because one of eight categories is blind would make this
    // field a constant (pets is always blind) and tell a leader nothing; naming the blind categories
    // separately tells them exactly what to distrust.
    const unavailableCategories = WAR_CATEGORIES.filter(c => categories[c]?.confidence === 'unavailable');
    let confidence: WarConfidence;
    if (unavailableCategories.length === WAR_CATEGORIES.length) confidence = 'unavailable';
    else if (WAR_CATEGORIES.every(c => categories[c]?.confidence === 'exact')) confidence = 'exact';
    else confidence = 'lower-bound';

    // A category the current config gives no day cannot be scored this week at all, however many
    // points the resources are nominally worth — worth saying out loud, since `byDay` silently drops
    // it while `total` keeps it.
    const dayless = WAR_CATEGORIES.filter(c => categories[c]?.points > 0 && !categories[c].days.length);
    if (dayless.length) {
        notes.push(`This game data version gives ${dayless.join(', ')} no war day, so those points are in the total but on no day.`);
    }
    const emptyDays = [0, 1, 2, 3, 4, 5].filter(d => !Object.values(daysMap).some(list => list?.includes(d)));
    if (emptyDays.length) {
        notes.push(`${emptyDays.map(getWarDayName).join(', ')} carries no tasks in this game data version, so nothing can be scored then (today is ${getWarDayName(getWarDayIndex(now))}).`);
    }

    return {
        categories,
        total,
        byDay,
        byDayBase,
        totalWithDayBoost,
        confidence,
        unavailableCategories,
        notes,
        clanBonuses,
        dayBoosts,
        techTimeLimitHours,
        gemAllocation,
        configComplete,
    };
}
