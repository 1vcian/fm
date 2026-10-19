// Runtime multi-language dictionaries. Consumes public/parsed_configs/Localization.json
// (14 languages, generated from the game's Unity Localization tables) and folds every
// language's strings into ONE combined lookup per entity type. OCR'd text is then matched
// against the combined dict, so a screenshot in any of the 14 languages resolves without
// having to know the language up front. English (from the base configs) is registered
// first and never overwritten.

import type { GameLimits } from './gameLimits';
import { normalizeName, foldText } from './parse';
import { AGES } from '../constants';
import {
    buildItemDictionary, buildSkillDictionary, buildSubstatDictionary,
    type ItemIdentity,
} from './gameDictionary';
import { buildPetDictionary, buildMountDictionary, type UnitIdentity } from './gamePets';

export interface LocalizationData {
    langs: string[];
    items: Record<string, Record<string, string>>;    // LocalizationId -> {lang: text}
    substats: Record<string, Record<string, string>>; // statId -> {lang: text}
    pets: Record<string, Record<string, string>>;      // "Rarity_id" -> {lang: text}
    mounts: Record<string, Record<string, string>>;
    skills: Record<string, Record<string, string>>;    // skillId -> {lang: text}
    rarities: Record<string, Record<string, string>>;  // rarityLower -> {lang: text}
    ui: Record<string, Record<string, string>>;        // word -> {lang: text}
}

/** Languages whose strings go into the dictionaries. Null = all of them (the historical default).
 *  A screenshot is in ONE language, and every extra language is another set of short words a
 *  misread can fuzzy-match, so the AutoSync modal narrows this to the chosen game language plus
 *  English (buildGameDictionaries `langs`). */
let activeLangs: Set<string> | null = null;

function addTranslations<T>(map: Map<string, T>, translations: Record<string, string> | undefined, value: T) {
    if (!translations) return;
    for (const [lang, s] of Object.entries(translations)) {
        if (activeLangs && !activeLangs.has(lang)) continue;
        if (typeof s !== 'string') continue;
        const k = normalizeName(s);
        if (k && !map.has(k)) map.set(k, value);
    }
}

/** Folded words of one `ui` entry (Localization.json) in the active languages, English first. */
function uiWords(loc: LocalizationData | null, key: string, english: string): string[] {
    const out = new Set<string>([foldText(english)]);
    const tr = loc?.ui?.[key];
    if (tr) for (const [lang, s] of Object.entries(tr)) {
        if (activeLangs && !activeLangs.has(lang)) continue;
        const f = foldText(s);
        if (f) out.add(f);
    }
    return [...out];
}

/** Words the readers look for in OCR'd text, per language (folded with parse.foldText). */
export interface UiWords {
    damage: string[];
    health: string[];
    ranged: string[];
    totalDamage: string[];
    totalHealth: string[];
    /** level prefix ("Lv.", "Niv.", "Ур.", "等级" ...) without its dot */
    lv: string[];
    /** age index -> the age word in every active language */
    ages: string[][];
}

function buildUiWords(loc: LocalizationData | null, ageNamesEn: string[]): UiWords {
    const ages: string[][] = ageNamesEn.map((en, i) => {
        const set = new Set<string>([foldText(en)]);
        const tr = (loc as any)?.ages?.[String(i)] as Record<string, string> | undefined;
        if (tr) for (const [lang, s] of Object.entries(tr)) {
            if (lang === 'en_key' || (activeLangs && !activeLangs.has(lang))) continue;
            const f = foldText(s);
            if (f) set.add(f);
        }
        return [...set];
    });
    return {
        damage: uiWords(loc, 'damage', 'Damage'),
        health: uiWords(loc, 'health', 'Health'),
        ranged: uiWords(loc, 'ranged', 'ranged'),
        totalDamage: uiWords(loc, 'total damage', 'Total Damage'),
        totalHealth: uiWords(loc, 'total health', 'Total Health'),
        lv: uiWords(loc, 'lv', 'Lv'),
        ages,
    };
}

export function buildItemDictLocalized(autoItemMapping: any, loc?: LocalizationData | null): Map<string, ItemIdentity> {
    const map = buildItemDictionary(autoItemMapping); // English base
    if (!loc?.items) return map;
    const byLocId = new Map<string, ItemIdentity>();
    for (const ident of map.values()) if (ident.localizationId != null) byLocId.set(String(ident.localizationId), ident);
    for (const [locId, tr] of Object.entries(loc.items)) {
        const ident = byLocId.get(locId);
        if (ident) addTranslations(map, tr, ident);
    }
    return map;
}

export function buildSubstatDictLocalized(loc?: LocalizationData | null): Map<string, string> {
    const map = buildSubstatDictionary(); // English base
    for (const [statId, tr] of Object.entries(loc?.substats || {})) addTranslations(map, tr, statId);
    return map;
}

export function buildSkillDictLocalized(skillLibrary: any, loc?: LocalizationData | null): Map<string, string> {
    const map = buildSkillDictionary(skillLibrary); // English base
    for (const [skillId, tr] of Object.entries(loc?.skills || {})) addTranslations(map, tr, skillId);
    return map;
}

function parseUnitKey(key: string): UnitIdentity | null {
    const i = key.lastIndexOf('_');
    if (i < 0) return null;
    const rarity = key.slice(0, i);
    const id = Number(key.slice(i + 1));
    return isNaN(id) ? null : { rarity, id };
}

export function buildPetDictLocalized(spriteMapping: any, loc?: LocalizationData | null): Map<string, UnitIdentity> {
    const map = buildPetDictionary(spriteMapping);
    for (const [key, tr] of Object.entries(loc?.pets || {})) {
        const ident = parseUnitKey(key);
        if (ident) addTranslations(map, tr, ident);
    }
    return map;
}

export function buildMountDictLocalized(spriteMapping: any, loc?: LocalizationData | null): Map<string, UnitIdentity> {
    const map = buildMountDictionary(spriteMapping);
    for (const [key, tr] of Object.entries(loc?.mounts || {})) {
        const ident = parseUnitKey(key);
        if (ident) addTranslations(map, tr, ident);
    }
    return map;
}

/** rarity display word (any language) -> canonical lowercase rarity ("mythic", "divine", ). */
export function buildRarityDictLocalized(loc?: LocalizationData | null): Map<string, string> {
    const map = new Map<string, string>();
    for (const r of ['common', 'rare', 'epic', 'legendary', 'ultimate', 'mythic', 'divine']) map.set(r, r);
    for (const [rarity, tr] of Object.entries(loc?.rarities || {})) addTranslations(map, tr, rarity);
    return map;
}

export interface GameDictionaries {
    items: Map<string, ItemIdentity>;
    substats: Map<string, string>;
    skills: Map<string, string>;
    pets: Map<string, UnitIdentity>;
    mounts: Map<string, UnitIdentity>;
    rarities: Map<string, string>;
    /** statId -> max % for a single roll (from SecondaryStatLibrary.UpperRange*100). Used to
     *  catch OCR reading a "+"/"-" sign as a leading digit (e.g. 46% where the cap is 12%). */
    statMax: Map<string, number>;
    /** statId -> min % for a single roll (SecondaryStatLibrary.LowerRange*100). */
    statMin?: Map<string, number>;
    loc: LocalizationData | null;
    /** Localized words the readers look for (main-stat kind, age tag, level prefix). */
    words: UiWords;
    /** The languages the dictionaries were built for (null = every language in the file). */
    langs: string[] | null;
    /** The game's bounds for every value a read can write (gameLimits.ts). Null until loaded. */
    limits?: GameLimits | null;
}

function buildStatMin(secondaryStatLibrary: any): Map<string, number> {
    const map = new Map<string, number>();
    for (const [statId, def] of Object.entries<any>(secondaryStatLibrary || {})) {
        const lo = def?.LowerRange, up = def?.UpperRange;
        if (typeof lo === 'number' && typeof up === 'number' && up > 0) map.set(statId, lo * 100);
    }
    return map;
}

function buildStatMax(secondaryStatLibrary: any): Map<string, number> {
    const map = new Map<string, number>();
    for (const [statId, def] of Object.entries<any>(secondaryStatLibrary || {})) {
        const up = def?.UpperRange;
        if (typeof up === 'number' && up > 0) map.set(statId, up * 100);
    }
    return map;
}

/** Build every combined dictionary from the configs the app already loads. */
export function buildGameDictionaries(cfg: {
    autoItemMapping: any; skillLibrary: any; spriteMapping: any;
    secondaryStatLibrary?: any; localization?: LocalizationData | null;
    /** Restrict every dictionary to these languages (e.g. ['en', 'ru']); omit for all. */
    langs?: string[] | null;
}): GameDictionaries {
    const loc = cfg.localization ?? null;
    activeLangs = cfg.langs?.length ? new Set(cfg.langs) : null;
    try {
        return buildAll(cfg, loc);
    } finally {
        activeLangs = null;
    }
}

function buildAll(cfg: {
    autoItemMapping: any; skillLibrary: any; spriteMapping: any;
    secondaryStatLibrary?: any; langs?: string[] | null;
}, loc: LocalizationData | null): GameDictionaries {
    return {
        words: buildUiWords(loc, AGES),
        langs: cfg.langs?.length ? [...cfg.langs] : null,
        items: buildItemDictLocalized(cfg.autoItemMapping, loc),
        substats: buildSubstatDictLocalized(loc),
        skills: buildSkillDictLocalized(cfg.skillLibrary, loc),
        pets: buildPetDictLocalized(cfg.spriteMapping, loc),
        mounts: buildMountDictLocalized(cfg.spriteMapping, loc),
        rarities: buildRarityDictLocalized(loc),
        statMax: buildStatMax(cfg.secondaryStatLibrary),
        statMin: buildStatMin(cfg.secondaryStatLibrary),
        loc,
    };
}
