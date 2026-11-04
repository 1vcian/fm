/**
 * The profile exchange format: what another app sends through a profile link and reads back
 * (supabase/migrations/0012_profile_links.sql, public/profile-exchange/).
 *
 * The site's own UserProfile changes with the app; this format is versioned and stays put, so an
 * app written against version 1 keeps working when the site moves on. A new game feature means a
 * new version next to the old ones, never a change to a published one.
 *
 * Version 1 carries what a scanner reads off the game: equipped items (with their skins), active
 * pets, the mount, skill levels, forge, ascensions and currencies. Every section is optional:
 * what is missing stays as it is on the site. Ids are the game's own, as in the configs the site
 * publishes (parsed_configs/<version>/): items by age (AutoItemMapping.Age), slot and Idx, pets
 * and mounts by rarity and Id, skills by id, substats by SecondaryStatLibrary key.
 *
 * Incoming data becomes the same reviewable rows as a screenshot scan (utils/ocr/autoSync.ts), so
 * the review, the game-limit checks (utils/ocr/gameLimits.ts) and the apply are shared.
 */
import type { ItemSlot, MountSlot, PetSlot, UserProfile } from '../types/Profile';
import { AGES, MAX_ACTIVE_PETS } from './constants';
import { FAIRIES } from './fairies';
import { getItemName } from './itemAssets';
import { substatSummary, skinSummary, type ChangeRow, type Patch } from './ocr/autoSync';
import { enforceGameLimits, type GameLimits } from './ocr/gameLimits';

export const EXCHANGE_FORMAT = 'fm-profile';
/** The versions this site reads, newest last. */
export const EXCHANGE_VERSIONS = [1] as const;
export const EXCHANGE_CURRENT = 1;

export const EXCHANGE_SLOTS = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'] as const;
export type ExchangeSlot = typeof EXCHANGE_SLOTS[number];
export const EXCHANGE_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'] as const;

export interface ExchangeSubstatV1 {
    /** SecondaryStatLibrary key, e.g. "CriticalChance". */
    stat: string;
    /** As the game shows it, in percent: 12.5 for +12.5%. */
    value: number;
}

export interface ExchangeItemV1 {
    /** 0 to 9 (Primitive .. Divine), AutoItemMapping.Age. */
    age: number;
    /** AutoItemMapping.Idx within its age and slot. */
    idx: number;
    level: number;
    substats?: ExchangeSubstatV1[];
    /** The skin worn on this item, if any. */
    skin?: {
        /** SkinsLibrary SkinId.Idx. */
        idx: number;
        /** SkinsLibrary SkinId.Type: "Weapon", "Helmet" or "Armour". */
        type?: string;
        level?: number;
        /** Rolled stats by SkinsLibrary stat type, as fractions: 0.0678 for +6.78%. */
        stats: Record<string, number>;
    };
}

export interface ExchangeUnitV1 {
    rarity: typeof EXCHANGE_RARITIES[number];
    /** PetLibrary / MountLibrary Id within its rarity. */
    id: number;
    level: number;
    /** Ascension stars, 0 to the config's maximum. */
    ascension?: number;
    substats?: ExchangeSubstatV1[];
}

export interface ExchangeV1 {
    format: typeof EXCHANGE_FORMAT;
    version: 1;
    /** Who made it: shown to the owner when they review an update. */
    source?: { app?: string; appVersion?: string; gameConfig?: string };
    /** Equipped items by slot. A missing slot (or null) stays as it is. */
    items?: Partial<Record<ExchangeSlot, ExchangeItemV1 | null>>;
    /** Active pets in slot order, at most 3. A null entry leaves that slot as it is. */
    pets?: (ExchangeUnitV1 | null)[];
    mount?: ExchangeUnitV1 | null;
    /** Skill levels by skill id ("Meat", "Arrows", ...). */
    skills?: Record<string, { level: number; ascension?: number }>;
    forge?: { level?: number; hammers?: number };
    /**
     * Ascension stars of each whole category, as the game keeps them (AscensionConfigsLibrary: Forge,
     * Pets, Mounts, Skills). These are what the stats use; every item, pet, mount or skill tile of a
     * category shows the same stars.
     */
    ascension?: { forge?: number; pets?: number; mounts?: number; skills?: number };
    currencies?: { coins?: number; gems?: number; eggshells?: number; skillTickets?: number; clockWinders?: number; guildPotions?: number };
    /**
     * Node levels by tree. Forge, Power and SkillsPetTech: keyed by the node's `Id` in
     * PlayerTechTreePositionLibrary[tree].Nodes. Clan: keyed by the node's position when the
     * categories of GuildTechTreePositionLibrary are read in order and their Nodes lists joined
     * (0 = the first node of the first category). A node left out keeps its level.
     */
    techTree?: Partial<Record<ExchangeTree, Record<string, number>>>;
    /** The fairy in use (null = none) and its level. */
    fairy?: { name: string | null; level: number };
}

export const EXCHANGE_TREES = ['Forge', 'Power', 'SkillsPetTech', 'Clan'] as const;
export type ExchangeTree = typeof EXCHANGE_TREES[number];
const TREE_LABEL: Record<ExchangeTree, string> = { Forge: 'Forge tree', Power: 'Power tree', SkillsPetTech: 'Skills & pets tree', Clan: 'Clan tree' };

/** currencies key -> profile.misc key (the keys the calculators read). */
const CURRENCY_MISC: Record<string, string> = {
    coins: 'coins', gems: 'gemCount', eggshells: 'eggshellCount',
    skillTickets: 'skillCalculatorTickets', clockWinders: 'mountCalculatorWinders', guildPotions: 'guildPotions',
};
const CURRENCY_LABEL: Record<string, string> = {
    coins: 'Coins', gems: 'Gems', eggshells: 'Eggshells', skillTickets: 'Skill Tickets', clockWinders: 'Clock Winders', guildPotions: 'Guild Potions',
};

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);

/** Shape errors of a version 1 document ([] = readable). Value ranges are the game limits' job. */
export function validateV1(d: unknown): string[] {
    const e: string[] = [];
    if (!isObj(d)) return ['the data is not a JSON object'];
    if (d.format !== EXCHANGE_FORMAT) e.push(`format must be "${EXCHANGE_FORMAT}"`);
    if (d.version !== 1) e.push('version must be 1');
    const subs = (where: string, s: unknown) => {
        if (s === undefined) return;
        if (!Array.isArray(s)) { e.push(`${where}.substats must be a list`); return; }
        s.forEach((x, i) => { if (!isObj(x) || typeof x.stat !== 'string' || !isNum(x.value)) e.push(`${where}.substats[${i}] needs stat (text) and value (number)`); });
    };
    const unit = (where: string, u: unknown) => {
        if (u === null || u === undefined) return;
        if (!isObj(u)) { e.push(`${where} must be an object`); return; }
        if (!EXCHANGE_RARITIES.includes(u.rarity)) e.push(`${where}.rarity must be one of ${EXCHANGE_RARITIES.join(', ')}`);
        if (!isInt(u.id) || u.id < 0) e.push(`${where}.id must be a whole number`);
        if (!isInt(u.level)) e.push(`${where}.level must be a whole number`);
        if (u.ascension !== undefined && !isInt(u.ascension)) e.push(`${where}.ascension must be a whole number`);
        subs(where, u.substats);
    };
    if (d.items !== undefined) {
        if (!isObj(d.items)) e.push('items must be an object by slot');
        else for (const [slot, it] of Object.entries(d.items)) {
            if (!(EXCHANGE_SLOTS as readonly string[]).includes(slot)) { e.push(`items.${slot} is not a slot (${EXCHANGE_SLOTS.join(', ')})`); continue; }
            if (it === null) continue;
            if (!isObj(it)) { e.push(`items.${slot} must be an object`); continue; }
            if (!isInt(it.age) || it.age < 0 || it.age >= AGES.length) e.push(`items.${slot}.age must be 0 to ${AGES.length - 1}`);
            if (!isInt(it.idx) || it.idx < 0) e.push(`items.${slot}.idx must be a whole number`);
            if (!isInt(it.level)) e.push(`items.${slot}.level must be a whole number`);
            subs(`items.${slot}`, it.substats);
            if (it.skin !== undefined && it.skin !== null) {
                if (!isObj(it.skin) || !isInt(it.skin.idx) || !isObj(it.skin.stats) || !Object.values(it.skin.stats).every(isNum)) e.push(`items.${slot}.skin needs idx (whole number) and stats (numbers by stat type)`);
            }
        }
    }
    if (d.pets !== undefined) {
        if (!Array.isArray(d.pets)) e.push('pets must be a list');
        else {
            if (d.pets.length > MAX_ACTIVE_PETS) e.push(`pets has at most ${MAX_ACTIVE_PETS} entries`);
            d.pets.forEach((p: unknown, i: number) => unit(`pets[${i}]`, p));
        }
    }
    unit('mount', d.mount);
    if (d.skills !== undefined) {
        if (!isObj(d.skills)) e.push('skills must be an object by skill id');
        else for (const [id, s] of Object.entries(d.skills)) {
            if (!isObj(s) || !isInt(s.level) || (s.ascension !== undefined && !isInt(s.ascension))) e.push(`skills.${id} needs level (whole number)`);
        }
    }
    for (const [k, sec] of [['forge', d.forge], ['ascension', d.ascension], ['currencies', d.currencies]] as const) {
        if (sec === undefined) continue;
        if (!isObj(sec) || !Object.values(sec).every(v => isNum(v) && v >= 0)) e.push(`${k} must hold numbers of 0 or more`);
    }
    if (isObj(d.currencies)) for (const k of Object.keys(d.currencies)) if (!CURRENCY_MISC[k]) e.push(`currencies.${k} is not known (${Object.keys(CURRENCY_MISC).join(', ')})`);
    if (d.techTree !== undefined) {
        if (!isObj(d.techTree)) e.push('techTree must be an object by tree');
        else for (const [tree, nodes] of Object.entries(d.techTree)) {
            if (!(EXCHANGE_TREES as readonly string[]).includes(tree)) { e.push(`techTree.${tree} is not a tree (${EXCHANGE_TREES.join(', ')})`); continue; }
            if (!isObj(nodes)) { e.push(`techTree.${tree} must be an object of node -> level`); continue; }
            for (const [id, lv] of Object.entries(nodes)) {
                if (!/^\d+$/.test(id) || !isInt(lv) || (lv as number) < 0) { e.push(`techTree.${tree}: node "${id}" needs a whole-number id and a level of 0 or more`); break; }
            }
        }
    }
    if (d.fairy !== undefined) {
        const names = FAIRIES.map(f => f.name) as string[];
        if (!isObj(d.fairy) || (d.fairy.name !== null && !names.includes(d.fairy.name)) || !isInt(d.fairy.level)) {
            e.push(`fairy needs name (${names.join(', ')} or null) and level (whole number)`);
        }
    }
    return e;
}

export interface ExchangeContext {
    autoItemMapping?: any;
    localization?: any;
    limits?: GameLimits | null;
}

const toSubstats = (s?: ExchangeSubstatV1[]) => (s ?? []).map(x => ({ statId: x.stat, value: x.value }));
const sameSubs = (a?: { statId: string; value: number }[], b?: { statId: string; value: number }[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const itemNameOf = (slot: string, age: number, idx: number, ctx: ExchangeContext) =>
    getItemName(AGES[age] ?? '', slot === 'Shoe' ? 'Shoes' : slot, idx, ctx.autoItemMapping, ctx.localization) ?? `${slot} ${AGES[age] ?? age} #${idx}`;

/**
 * The changes a version 1 document makes to a profile, as reviewable rows (only what differs).
 * Every row is accepted unless the game limits refuse a value, which then keeps the profile's.
 */
export function exchangeRowsV1(d: ExchangeV1, profile: UserProfile, ctx: ExchangeContext = {}): ChangeRow[] {
    const rows: ChangeRow[] = [];
    let n = 0;
    const push = (r: Omit<ChangeRow, 'id' | 'confidence' | 'accepted' | 'warnings'>) =>
        rows.push({ ...r, id: `link-${r.category}-${n++}`, confidence: 1, accepted: true, warnings: [] });

    for (const slot of EXCHANGE_SLOTS) {
        const it = d.items?.[slot];
        if (!it) continue;
        const cur = profile.items[slot];
        const item: ItemSlot = {
            age: it.age, idx: it.idx, level: it.level,
            rarity: cur && cur.age === it.age && cur.idx === it.idx ? cur.rarity : (cur?.rarity ?? 'Common'),
            secondaryStats: toSubstats(it.substats),
            skin: cur?.skin,
        };
        const same = cur && cur.age === item.age && cur.idx === item.idx && cur.level === item.level && sameSubs(cur.secondaryStats, item.secondaryStats);
        const name = itemNameOf(slot, it.age, it.idx, ctx);
        if (!same) {
            push({
                category: 'item', label: `${slot}: ${name}`, detail: `Lv.${item.level} · ${substatSummary(item.secondaryStats)}`,
                action: cur ? 'replace' : 'add',
                before: cur ? `${itemNameOf(slot, cur.age, cur.idx, ctx)} Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
                after: `${name} Lv.${item.level} · ${substatSummary(item.secondaryStats)}`,
                patch: { t: 'item', slot, item }, slot,
                detected: { age: it.age, idx: it.idx, level: it.level, name, substats: item.secondaryStats.map(s => ({ statId: s.statId, value: s.value, raw: '' })) as any },
                presetName: name,
            });
        }
        if (it.skin) {
            const skin = { idx: it.skin.idx, type: it.skin.type, stats: { ...it.skin.stats }, ...(it.skin.level !== undefined ? { level: it.skin.level } : {}) };
            const sameSkin = cur?.skin && cur.skin.idx === skin.idx && JSON.stringify(cur.skin.stats) === JSON.stringify(skin.stats) && (cur.skin.level ?? 0) === (skin.level ?? 0);
            if (!sameSkin) {
                push({
                    category: 'skinEquip', label: `${slot} skin #${skin.idx}`, detail: skinSummary(skin),
                    action: cur?.skin ? 'replace' : 'add', before: cur ? skinSummary(cur.skin) : null, after: skinSummary(skin),
                    patch: { t: 'skinEquip', slot, skin }, slot,
                });
            }
        }
    }

    (d.pets ?? []).slice(0, MAX_ACTIVE_PETS).forEach((p, slotIndex) => {
        if (!p) return;
        const key = `${p.rarity}_${p.id}`;
        const known = profile.pets.collection?.[key];
        const pet: PetSlot = {
            rarity: p.rarity, id: p.id, level: p.level,
            evolution: known?.evolution ?? 0,
            ascensionLevel: p.ascension ?? known?.ascensionLevel ?? 0,
            secondaryStats: toSubstats(p.substats),
            customName: known?.customName, hp: known?.hp,
        };
        const cur = profile.pets.active?.[slotIndex] ?? null;
        const same = cur && cur.rarity === pet.rarity && cur.id === pet.id && cur.level === pet.level && (cur.ascensionLevel ?? 0) === pet.ascensionLevel && sameSubs(cur.secondaryStats, pet.secondaryStats);
        if (same) return;
        push({
            category: 'pet', label: `Pet slot ${slotIndex + 1}: ${p.rarity} #${p.id}`, detail: `Lv.${pet.level} · ${substatSummary(pet.secondaryStats)}`,
            action: cur ? 'update' : 'add',
            before: cur ? `${cur.rarity} #${cur.id} Lv.${cur.level} · ${substatSummary(cur.secondaryStats ?? [])}` : null,
            after: `${p.rarity} #${p.id} Lv.${pet.level} · ${substatSummary(pet.secondaryStats ?? [])}`,
            patch: { t: 'pet', key, slotIndex, pet },
            detected: { rarity: p.rarity, id: p.id, level: p.level, stars: pet.ascensionLevel },
            presetName: `${p.rarity} Pet #${p.id}`,
        });
    });

    if (d.mount) {
        const m = d.mount;
        const cur = profile.mount.active;
        const mount: MountSlot = {
            rarity: m.rarity, id: m.id, level: m.level,
            evolution: cur?.evolution ?? 0,
            ascensionLevel: m.ascension ?? cur?.ascensionLevel ?? 0,
            skills: cur?.skills ?? [],
            secondaryStats: toSubstats(m.substats),
            customName: cur?.customName, hp: cur?.hp,
        };
        const same = cur && cur.rarity === mount.rarity && cur.id === mount.id && cur.level === mount.level && (cur.ascensionLevel ?? 0) === mount.ascensionLevel && sameSubs(cur.secondaryStats, mount.secondaryStats);
        if (!same) {
            push({
                category: 'mount', label: `Mount: ${m.rarity} #${m.id}`, detail: `Lv.${mount.level} · ${substatSummary(mount.secondaryStats ?? [])}`,
                action: cur ? 'replace' : 'add',
                before: cur ? `${cur.rarity} #${cur.id} Lv.${cur.level} · ${substatSummary(cur.secondaryStats ?? [])}` : null,
                after: `${m.rarity} #${m.id} Lv.${mount.level} · ${substatSummary(mount.secondaryStats ?? [])}`,
                patch: { t: 'mount', mount },
                detected: { rarity: m.rarity, id: m.id, level: m.level, stars: mount.ascensionLevel },
                presetName: `${m.rarity} Mount #${m.id}`,
            });
        }
    }

    for (const [skillId, s] of Object.entries(d.skills ?? {})) {
        const cur = Number(profile.skills?.passives?.[skillId] ?? 0);
        const curAsc = profile.skills?.equipped?.find(x => x.id === skillId)?.ascensionLevel ?? profile.skills?.collection?.[skillId]?.ascensionLevel ?? 0;
        const asc = s.ascension ?? null;
        if (cur === s.level && (asc === null || asc === curAsc)) continue;
        const star = (v: number) => (v > 0 ? ` ★${v}` : '');
        push({
            category: 'skill', label: skillId.replace(/([a-z])([A-Z])/g, '$1 $2'), detail: `Lv.${cur}${star(curAsc)} → Lv.${s.level}${star(asc ?? curAsc)}`,
            action: cur ? 'update' : 'add', before: `Lv.${cur}${star(curAsc)}`, after: `Lv.${s.level}${star(asc ?? curAsc)}`,
            patch: { t: 'skill', skillId, level: s.level, ascension: asc },
            detected: { level: s.level, stars: asc ?? 0 },
        });
    }

    const misc = (key: string, label: string, value: number | undefined) => {
        if (value === undefined) return;
        const cur = Number((profile.misc as any)[key] ?? 0);
        if (cur === value) return;
        push({ category: 'currency', label, detail: `${cur} → ${value}`, action: 'update', before: String(cur), after: String(value), patch: { t: 'currency', miscKey: key, value } });
    };
    misc('forgeLevel', 'Forge Level', d.forge?.level);
    misc('forgeAscensionLevel', 'Forge Ascension', d.ascension?.forge);
    misc('petAscensionLevel', 'Pet Ascension', d.ascension?.pets);
    misc('mountAscensionLevel', 'Mount Ascension', d.ascension?.mounts);
    misc('skillAscensionLevel', 'Skill Ascension', d.ascension?.skills);
    for (const [k, v] of Object.entries(d.currencies ?? {})) misc(CURRENCY_MISC[k], CURRENCY_LABEL[k], v);
    if (d.forge?.hammers !== undefined) {
        const cur = Number(profile.misc.forgeCalculator?.hammers ?? 0);
        if (cur !== d.forge.hammers) {
            push({ category: 'currency', label: 'Hammers', detail: `${cur} → ${d.forge.hammers}`, action: 'update', before: String(cur), after: String(d.forge.hammers), patch: { t: 'forgeHammers', value: d.forge.hammers } as Patch });
        }
    }

    for (const tree of EXCHANGE_TREES) {
        const nodes = d.techTree?.[tree];
        if (!nodes) continue;
        const cur = (profile.techTree?.[tree] ?? {}) as Record<number, number>;
        const levels: Record<number, number> = {};
        for (const [id, lv] of Object.entries(nodes)) if (Number(cur[Number(id)] ?? 0) !== lv) levels[Number(id)] = lv;
        const n = Object.keys(levels).length;
        if (!n) continue;
        const sum = (o: Record<number, number>) => Object.values(o).reduce((t, v) => t + (Number(v) || 0), 0);
        const after = { ...cur, ...levels };
        push({
            category: 'tree', label: TREE_LABEL[tree], detail: `${n} node${n === 1 ? '' : 's'} change`,
            action: 'update', before: `${sum(cur)} levels`, after: `${sum(after)} levels (${n} node${n === 1 ? '' : 's'})`,
            patch: { t: 'treeLevels', tree, levels },
        });
    }
    if (d.fairy) {
        const cur = profile.misc.fairy;
        if ((cur?.name ?? null) !== d.fairy.name || (cur?.level ?? 0) !== d.fairy.level) {
            const txt = (f?: { name: string | null; level: number } | null) => (f?.name ? `${f.name} Lv.${f.level}` : 'none');
            push({
                category: 'fairy', label: 'Fairy', detail: `${txt(cur)} → ${txt(d.fairy)}`, action: 'update',
                before: txt(cur), after: txt(d.fairy), patch: { t: 'fairy', name: d.fairy.name, level: d.fairy.level },
            });
        }
    }

    const checked = ctx.limits ? enforceGameLimits(rows, ctx.limits, profile) : rows;
    // A tree row says what is left after the limits took out the nodes they refused.
    return checked.map(r => {
        if (r.patch.t !== 'treeLevels') return r;
        const cur = (profile.techTree?.[r.patch.tree] ?? {}) as Record<number, number>;
        const n = Object.keys(r.patch.levels).length;
        const sum = Object.values({ ...cur, ...r.patch.levels }).reduce((t, v) => t + (Number(v) || 0), 0);
        return { ...r, after: n ? `${sum} levels (${n} node${n === 1 ? '' : 's'})` : 'no change left', detail: `${n} node${n === 1 ? '' : 's'} change` };
    });
}

/** The rows of any supported document, or why it cannot be read. */
export function exchangeRows(version: number, data: unknown, profile: UserProfile, ctx: ExchangeContext = {}): { rows: ChangeRow[]; errors: string[] } {
    if (version !== 1) return { rows: [], errors: [`format version ${version} is newer than this site reads (${EXCHANGE_VERSIONS.join(', ')}): reload the site`] };
    const errors = validateV1(data);
    if (errors.length) return { rows: [], errors };
    return { rows: exchangeRowsV1(data as ExchangeV1, profile, ctx), errors: [] };
}

/** The profile in the current exchange format, for the apps that read it (profile_export_set). */
export function profileToExchange(profile: UserProfile): ExchangeV1 {
    const subs = (s?: { statId: string; value: number }[]) => (s ?? []).map(x => ({ stat: x.statId, value: x.value }));
    const unit = (u: PetSlot | MountSlot): ExchangeUnitV1 => ({
        rarity: u.rarity as ExchangeUnitV1['rarity'], id: u.id, level: u.level, ascension: u.ascensionLevel ?? 0, substats: subs(u.secondaryStats),
    });
    const items: ExchangeV1['items'] = {};
    for (const slot of EXCHANGE_SLOTS) {
        const it = profile.items[slot];
        items[slot] = it ? {
            age: it.age, idx: it.idx, level: it.level, substats: subs(it.secondaryStats),
            ...(it.skin ? { skin: { idx: it.skin.idx, type: it.skin.type, level: it.skin.level ?? 0, stats: { ...it.skin.stats } } } : {}),
        } : null;
    }
    const skills: NonNullable<ExchangeV1['skills']> = {};
    for (const [id, level] of Object.entries(profile.skills?.passives ?? {})) {
        if (!level) continue;
        const asc = profile.skills?.equipped?.find(x => x.id === id)?.ascensionLevel ?? profile.skills?.collection?.[id]?.ascensionLevel;
        skills[id] = { level: Number(level), ...(asc !== undefined ? { ascension: asc } : {}) };
    }
    const m = profile.misc;
    const num = (v: unknown) => (isNum(Number(v)) ? Number(v) : undefined);
    const currencies: NonNullable<ExchangeV1['currencies']> = {};
    for (const [k, key] of Object.entries(CURRENCY_MISC)) {
        const v = num((m as any)[key]);
        if (v !== undefined) (currencies as any)[k] = v;
    }
    return {
        format: EXCHANGE_FORMAT, version: 1,
        source: { app: 'fm' },
        items,
        pets: (profile.pets.active ?? []).slice(0, MAX_ACTIVE_PETS).map(unit),
        mount: profile.mount.active ? unit(profile.mount.active) : null,
        skills,
        forge: { level: m.forgeLevel, ...(num(m.forgeCalculator?.hammers) !== undefined ? { hammers: num(m.forgeCalculator?.hammers) } : {}) },
        ascension: { forge: m.forgeAscensionLevel ?? 0, pets: m.petAscensionLevel ?? 0, mounts: m.mountAscensionLevel ?? 0, skills: m.skillAscensionLevel ?? 0 },
        currencies,
        techTree: Object.fromEntries(EXCHANGE_TREES.map(t => [t, Object.fromEntries(
            Object.entries(profile.techTree?.[t] ?? {}).filter(([, lv]) => Number(lv) > 0).map(([id, lv]) => [id, Number(lv)]))])),
        fairy: { name: m.fairy?.name ?? null, level: m.fairy?.level ?? 0 },
    };
}
