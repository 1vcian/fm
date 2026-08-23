// Builds fuzzy-matchable dictionaries from the shipped config JSONs so OCR'd names
// (items / skills / substats) can be resolved to the app's data model.
//
// Item names come from AutoItemMapping.json (each entry has ItemName, TypeName, Age,
// Idx, LocalizationId). Skill ids ARE the SkillLibrary keys. Substat statIds come from
// SecondaryStatLibrary. Pet/mount name lookups are added separately (see gamePets.ts).

import { normalizeName, bestMatch, type MatchResult } from './parse';

/** AutoItemMapping TypeName -> the profile item slot key in Profile.items. */
export const TYPE_NAME_TO_SLOT: Record<string, string> = {
    Weapon: 'Weapon',
    Helmet: 'Helmet',
    Armour: 'Body',
    Gloves: 'Gloves',
    Belt: 'Belt',
    Necklace: 'Necklace',
    Ring: 'Ring',
    Shoes: 'Shoe',
};

/** Split a camelCase/PascalCase config name into words: "StaffOfWisdom" -> "Staff Of Wisdom". */
export function splitCamel(s: string): string {
    return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/&/g, ' & ');
}

export interface ItemIdentity {
    slot: string;   // Profile.items key
    age: number;    // 0..9
    idx: number;
    itemName: string;
    localizationId?: number;
}

/** Build normalizedName -> ItemIdentity from AutoItemMapping.json. */
export function buildItemDictionary(autoItemMapping: Record<string, any> | null | undefined): Map<string, ItemIdentity> {
    const map = new Map<string, ItemIdentity>();
    if (!autoItemMapping) return map;
    for (const entry of Object.values(autoItemMapping)) {
        const slot = TYPE_NAME_TO_SLOT[entry?.TypeName];
        if (!slot || entry?.ItemName == null) continue;
        const spaced = splitCamel(String(entry.ItemName));
        const key = normalizeName(spaced);
        if (!key) continue;
        map.set(key, {
            slot,
            age: entry.Age ?? 0,
            idx: entry.Idx ?? 0,
            itemName: spaced,
            localizationId: entry.LocalizationId,
        });
    }
    return map;
}

/** Build normalizedName -> skillId from SkillLibrary.json (keys are the skill ids). */
export function buildSkillDictionary(skillLibrary: Record<string, any> | null | undefined): Map<string, string> {
    const map = new Map<string, string>();
    if (!skillLibrary) return map;
    for (const id of Object.keys(skillLibrary)) {
        const key = normalizeName(splitCamel(id));
        if (key) map.set(key, id);
    }
    return map;
}

export function matchItem(name: string, dict: Map<string, ItemIdentity>, minScore = 0.6): MatchResult<ItemIdentity> | null {
    return bestMatch(name, dict, minScore);
}

export function matchSkill(name: string, dict: Map<string, string>, minScore = 0.6): MatchResult<string> | null {
    return bestMatch(name, dict, minScore);
}

// --- Substats -------------------------------------------------------------------
// statIds from SecondaryStatLibrary. Every secondary stat is shown as "+X%" in-game.
// The `en` labels are the exact strings the (English) game prints in the item popup.

export interface SubstatDef { statId: string; en: string; }

export const SUBSTAT_DEFS: SubstatDef[] = [
    { statId: 'CriticalChance', en: 'Critical Chance' },
    { statId: 'CriticalMulti', en: 'Critical Damage' },
    { statId: 'BlockChance', en: 'Block Chance' },
    { statId: 'HealthRegen', en: 'Health Regen' },
    { statId: 'LifeSteal', en: 'Lifesteal' },
    { statId: 'DoubleDamageChance', en: 'Double Chance' },
    { statId: 'RangedDamageMulti', en: 'Ranged Damage' },
    { statId: 'MeleeDamageMulti', en: 'Melee Damage' },
    { statId: 'SkillDamageMulti', en: 'Skill Damage' },
    { statId: 'AttackSpeed', en: 'Attack Speed' },
    { statId: 'SkillCooldownMulti', en: 'Skill Cooldown' },
    { statId: 'MoveSpeed', en: 'Move Speed' },
    { statId: 'AttackRange', en: 'Attack Range' },
    { statId: 'HealthMulti', en: 'Health' },
    { statId: 'DamageMulti', en: 'Damage' },
];

/** Build the English substat matcher. (Non-English labels are merged in once localization is available.) */
export function buildSubstatDictionary(extraLabels?: { label: string; statId: string }[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const d of SUBSTAT_DEFS) map.set(normalizeName(d.en), d.statId);
    for (const e of extraLabels || []) {
        const k = normalizeName(e.label);
        if (k) map.set(k, e.statId);
    }
    return map;
}

/**
 * Match a substat label (already stripped of its "+X%"), e.g. "Critical Damage" ->
 * "CriticalMulti". Uses fuzzy matching so OCR slips are tolerated. Note "Damage" is a
 * proper subset of "Ranged/Skill/Melee/Critical Damage", but whole-string similarity
 * still ranks the correct full label highest.
 */
export function matchSubstat(label: string, dict: Map<string, string>, minScore = 0.62): MatchResult<string> | null {
    return bestMatch(label, dict, minScore);
}

/** Main-stat label on item/pet/mount popups: "236m Damage", "1.87b Health", "241m Damage (ranged)". */
export function parseMainStatKind(line: string): { kind: 'damage' | 'health'; ranged: boolean } | null {
    const l = line.toLowerCase();
    const ranged = /\(?\s*ranged\s*\)?/.test(l);
    if (/health/.test(l)) return { kind: 'health', ranged: false };
    if (/damage/.test(l)) return { kind: 'damage', ranged };
    return null;
}
