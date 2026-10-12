/**
 * The game's own bounds for every number AutoSync can write into a profile.
 *
 * A misread glyph turns a level into anything (a mount at Lv.999999), so no value leaves the
 * readers unchecked. Bounds come from the configs of the selected version, never from constants:
 *
 *   item level          ItemBalancingConfig.ItemBaseMaxLevel + 1, plus every *LevelUp node of the
 *                       player tech trees at its last level (the most any player can unlock)
 *   pet / mount level   PetUpgradeLibrary / MountUpgradeLibrary[rarity].LevelInfo.length
 *   skill level         highest key of SkillUpgradeLibrary
 *   ascension stars     AscensionConfigsLibrary[Forge|Pets|Mounts|Skills].AscensionConfigPerLevel.length
 *   forge level         highest Level of ForgeUpgradeLibrary
 *   substat %           SecondaryStatLibrary.UpperRange * 100 (one roll)
 *   clan node level     MaxLevel, past it only for an infinite node of a fully maxed tree
 *                       (GuildTechHelpers.IsInfinite, see clanTechStacking.ts)
 *
 * A value outside its bound is NOT clamped into range: a misread 999 is not "really" 100. The row
 * keeps the profile's current value for that field, is never pre-accepted, and says what was read.
 */
import type { ChangeRow, Patch } from './autoSync';
import type { UserProfile } from '../../types/Profile';
import { clanNodeCaps } from '../clanTechStacking';

export interface GameLimits {
    itemLevel(slot: string): number;
    petLevel(rarity: string): number;
    mountLevel(rarity: string): number;
    skillLevel: number;
    ascension: { forge: number; pets: number; mounts: number; skills: number };
    forgeLevel: number;
    statMax: Map<string, number>;
    /** Per-node caps for a clan tree in a given state (globalId -> cap). */
    clanCaps(levels: Record<string | number, number>): Map<number, number>;
}

export interface GameLimitConfigs {
    itemBalancingConfig?: any;
    techTreePositionLibrary?: any;
    techNodeValuesLibrary?: any;
    petUpgradeLibrary?: any;
    mountUpgradeLibrary?: any;
    skillUpgradeLibrary?: any;
    ascensionConfigsLibrary?: any;
    forgeUpgradeLibrary?: any;
    secondaryStatLibrary?: any;
    guildPositionLibrary?: any;
    guildUpgradeLibrary?: any;
}

/** *LevelUp node type -> profile item slot. */
const LEVEL_UP_SLOT: Record<string, string> = {
    WeaponLevelUp: 'Weapon', HelmetLevelUp: 'Helmet', BodyLevelUp: 'Body', GloveLevelUp: 'Gloves',
    BeltLevelUp: 'Belt', NecklaceLevelUp: 'Necklace', RingLevelUp: 'Ring', ShoeLevelUp: 'Shoe',
};

/** True when every library a bound needs has loaded; until then rows are not pre-accepted. */
export function limitsReady(cfg: GameLimitConfigs): boolean {
    return !!(cfg.itemBalancingConfig && cfg.petUpgradeLibrary && cfg.mountUpgradeLibrary &&
        cfg.skillUpgradeLibrary && cfg.ascensionConfigsLibrary && cfg.forgeUpgradeLibrary &&
        cfg.secondaryStatLibrary);
}

export function buildGameLimits(cfg: GameLimitConfigs): GameLimits {
    const baseItemMax = (Number(cfg.itemBalancingConfig?.ItemBaseMaxLevel) || 98) + 1;
    const itemBonus: Record<string, number> = {};
    for (const tree of Object.values<any>(cfg.techTreePositionLibrary || {})) {
        for (const node of tree?.Nodes || []) {
            const slot = LEVEL_UP_SLOT[node?.Type];
            if (!slot) continue;
            const tier = cfg.techNodeValuesLibrary?.[node.Type]?.Tiers?.[node.Tier ?? 0];
            const perLevel: number[] = tier?.StatValuePerLevel || [];
            const last = Number(perLevel[perLevel.length - 1]) || 0;
            itemBonus[slot] = (itemBonus[slot] || 0) + last;
        }
    }
    const levelCount = (lib: any, rarity: string) => {
        const n = lib?.[rarity]?.LevelInfo?.length;
        return typeof n === 'number' && n > 0 ? n : 100;
    };
    const keys = (lib: any) => Object.keys(lib || {}).map(Number).filter(Number.isFinite);
    const skillLevel = Math.max(0, ...keys(cfg.skillUpgradeLibrary)) || 99;
    const forgeLevel = Math.max(0, ...Object.values<any>(cfg.forgeUpgradeLibrary || {}).map(v => Number(v?.Level) || 0)) || 34;
    const asc = (k: string) => cfg.ascensionConfigsLibrary?.[k]?.AscensionConfigPerLevel?.length ?? 3;
    const statMax = new Map<string, number>();
    for (const [statId, def] of Object.entries<any>(cfg.secondaryStatLibrary || {})) {
        const up = def?.UpperRange;
        if (typeof up === 'number' && up > 0) statMax.set(statId, up * 100);
    }
    return {
        itemLevel: slot => baseItemMax + (itemBonus[slot] || 0),
        petLevel: rarity => levelCount(cfg.petUpgradeLibrary, rarity),
        mountLevel: rarity => levelCount(cfg.mountUpgradeLibrary, rarity),
        skillLevel,
        ascension: { forge: asc('Forge'), pets: asc('Pets'), mounts: asc('Mounts'), skills: asc('Skills') },
        forgeLevel,
        statMax,
        clanCaps: levels => clanNodeCaps(cfg.guildPositionLibrary, cfg.guildUpgradeLibrary, levels).caps,
    };
}

const inRange = (v: number | null | undefined, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Substats above their single-roll cap are dropped (the rest of the row stays usable). */
function checkSubstats(
    subs: { statId: string; value: number }[] | undefined,
    limits: GameLimits,
    warn: (m: string) => void
): { statId: string; value: number }[] | undefined {
    if (!subs) return subs;
    return subs.filter(s => {
        const max = limits.statMax.get(s.statId);
        if (max === undefined || inRange(s.value, 0, max + 1e-6)) return true;
        warn(`Read ${s.statId} ${s.value}%, above the game's maximum of ${Number(max.toFixed(2))}% for one roll. It was left out.`);
        return false;
    });
}

/**
 * Checks every row against the game's bounds. Out-of-bound fields fall back to the profile's
 * current value, the row loses pre-acceptance and carries a warning naming what was read.
 */
export function enforceGameLimits(rows: ChangeRow[], limits: GameLimits, profile: UserProfile): ChangeRow[] {
    // Clan tree after the read: the profile's levels overlaid with every in-range clan row, so the
    // "whole tree maxed" test sees the screenshot's tree rather than a stale profile.
    const clanState: Record<number, number> = { ...(profile.techTree?.Clan || {}) } as Record<number, number>;
    for (const r of rows) if (r.patch.t === 'clanTree') clanState[r.patch.globalId] = r.patch.level;
    const clanCaps = limits.clanCaps(clanState);

    return rows.map(row => {
        const warnings: string[] = [];
        const warn = (m: string) => warnings.push(m);
        let patch: Patch = row.patch;
        let detected = row.detected;

        switch (patch.t) {
            case 'item': {
                const slot = patch.slot;
                const max = limits.itemLevel(slot);
                let item = patch.item;
                if (!inRange(item.level, 1, max)) {
                    warn(`Read Lv.${item.level}, outside the game's range for ${slot} (1 to ${max}). Enter the level by hand.`);
                    const cur = (profile.items as any)?.[slot]?.level;
                    item = { ...item, level: inRange(cur, 1, max) ? cur : 1 };
                    detected = { ...detected, level: null };
                }
                const subs = checkSubstats(item.secondaryStats, limits, warn);
                if (subs !== item.secondaryStats) item = { ...item, secondaryStats: subs as typeof item.secondaryStats };
                patch = { ...patch, item };
                break;
            }
            case 'pet':
            case 'mount': {
                const isPet = patch.t === 'pet';
                const unit = isPet ? (patch as Extract<Patch, { t: 'pet' }>).pet : (patch as Extract<Patch, { t: 'mount' }>).mount;
                const max = isPet ? limits.petLevel(unit.rarity) : limits.mountLevel(unit.rarity);
                const ascMax = isPet ? limits.ascension.pets : limits.ascension.mounts;
                const cur = isPet
                    ? (profile.pets.collection as any)?.[`${unit.rarity}_${unit.id}`]
                    : profile.mount.active;
                let next = { ...unit };
                const kind = isPet ? 'pets' : 'mounts';
                if (!inRange(next.level, 1, max)) {
                    warn(`Read Lv.${next.level}, outside the game's range for ${unit.rarity} ${kind} (1 to ${max}). Enter the level by hand.`);
                    next.level = inRange(cur?.level, 1, max) ? cur.level : 1;
                    detected = { ...detected, level: null };
                }
                if (!inRange(next.ascensionLevel ?? 0, 0, ascMax)) {
                    warn(`Read ${next.ascensionLevel} ascension stars, the game has at most ${ascMax}.`);
                    next.ascensionLevel = inRange(cur?.ascensionLevel, 0, ascMax) ? cur.ascensionLevel : 0;
                }
                const subs = checkSubstats(next.secondaryStats, limits, warn);
                if (subs) next.secondaryStats = subs;
                patch = isPet
                    ? { ...(patch as Extract<Patch, { t: 'pet' }>), pet: next as never }
                    : { ...(patch as Extract<Patch, { t: 'mount' }>), mount: next as never };
                break;
            }
            case 'skill': {
                let { level, ascension } = patch;
                if (!inRange(level, 1, limits.skillLevel)) {
                    warn(`Read Lv.${level}, outside the game's skill range (1 to ${limits.skillLevel}). Enter the level by hand.`);
                    const cur = Number(profile.skills?.passives?.[patch.skillId] ?? 0);
                    level = inRange(cur, 1, limits.skillLevel) ? cur : 1;
                    detected = { ...detected, level: null };
                }
                if (ascension != null && !inRange(ascension, 0, limits.ascension.skills)) {
                    warn(`Read ${ascension} ascension stars, the game has at most ${limits.ascension.skills}.`);
                    ascension = null;
                }
                patch = { ...patch, level, ascension };
                break;
            }
            case 'currency': {
                const bound: Record<string, [number, number]> = {
                    forgeLevel: [1, limits.forgeLevel],
                    skillAscensionLevel: [0, limits.ascension.skills],
                    forgeAscensionLevel: [0, limits.ascension.forge],
                };
                const b = bound[patch.miscKey];
                if (b && !inRange(patch.value, b[0], b[1])) {
                    warn(`Read ${patch.value}, outside the game's range (${b[0]} to ${b[1]}).`);
                    return { ...row, accepted: false, warnings: [...row.warnings, ...warnings],
                        patch: { ...patch, value: Number((profile.misc as any)?.[patch.miscKey]) || b[0] } };
                }
                if (!inRange(patch.value, 0, Number.MAX_SAFE_INTEGER)) {
                    warn(`Read ${patch.value}, which is not a valid amount.`);
                }
                break;
            }
            case 'forgeHammers': {
                if (!inRange(patch.value, 0, Number.MAX_SAFE_INTEGER)) warn(`Read ${patch.value}, which is not a valid amount.`);
                break;
            }
            case 'clanTree': {
                const cap = clanCaps.get(patch.globalId) ?? patch.max;
                if (!inRange(patch.level, 0, cap)) {
                    warn(cap > patch.max
                        ? `Read Lv.${patch.level}, which is not a valid level.`
                        : `Read Lv.${patch.level}, above the node's maximum of ${patch.max}. Past the maximum is only possible once the whole clan tree is maxed.`);
                    const cur = Number(profile.techTree?.Clan?.[patch.globalId] ?? 0);
                    patch = { ...patch, level: inRange(cur, 0, cap) ? cur : Math.min(cap, patch.max) };
                    detected = { ...detected, level: null };
                }
                break;
            }
        }

        if (!warnings.length) return row;
        return { ...row, patch, detected, accepted: false, warnings: [...row.warnings, ...warnings] };
    });
}

/** Upper bound for the modal's editable level of a row, or undefined when the row has none. */
export function rowLevelMax(row: ChangeRow, limits: GameLimits | null | undefined, profile: UserProfile): number | undefined {
    if (!limits) return undefined;
    const p = row.patch;
    if (p.t === 'item') return limits.itemLevel(row.slot || p.slot);
    if (p.t === 'pet') return limits.petLevel(p.pet.rarity);
    if (p.t === 'mount') return limits.mountLevel(p.mount.rarity);
    if (p.t === 'skill') return limits.skillLevel;
    if (p.t === 'clanTree') {
        const state = { ...(profile.techTree?.Clan || {}), [p.globalId]: p.level } as Record<number, number>;
        return limits.clanCaps(state).get(p.globalId) ?? p.max;
    }
    return undefined;
}
