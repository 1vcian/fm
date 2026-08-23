// Pet & mount name dictionaries. Names live in ManualSpriteMapping.json (root, version-
// independent) under `pets.mapping` and `mounts.mapping`, each entry {name, rarity, id}.
// Kept separate on purpose: "Turtle" is both a pet (Common,5) and a mount (Rare,3).

import { normalizeName, bestMatch, type MatchResult } from './parse';
import { splitCamel } from './gameDictionary';

export interface UnitIdentity { rarity: string; id: number; }

function buildLookup(section: any): Map<string, UnitIdentity> {
    const map = new Map<string, UnitIdentity>();
    const mapping = section?.mapping;
    if (!mapping) return map;
    for (const info of Object.values<any>(mapping)) {
        if (info?.name == null || info.rarity == null || info.id == null) continue;
        const key = normalizeName(splitCamel(String(info.name)));
        if (key) map.set(key, { rarity: String(info.rarity), id: Number(info.id) });
    }
    return map;
}

export function buildPetDictionary(spriteMapping: any): Map<string, UnitIdentity> {
    return buildLookup(spriteMapping?.pets);
}

export function buildMountDictionary(spriteMapping: any): Map<string, UnitIdentity> {
    return buildLookup(spriteMapping?.mounts);
}

export function matchPet(name: string, dict: Map<string, UnitIdentity>, minScore = 0.6): MatchResult<UnitIdentity> | null {
    return bestMatch(name, dict, minScore);
}

export function matchMount(name: string, dict: Map<string, UnitIdentity>, minScore = 0.6): MatchResult<UnitIdentity> | null {
    return bestMatch(name, dict, minScore);
}
