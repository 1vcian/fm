// Shared contract for the template-driven AutoSync readers. Each reader consumes a screenshot
// canvas + the game dictionaries and returns one of these structured results; the pipeline maps
// them to the profile store and the modal renders an editable image-diff.
import type { ScreenTemplate } from './templateClassifier';

export interface Substat {
    statId: string | null;   // canonical id (from the localized substats dict), null if unmatched
    name: string;            // display name as read/matched
    value: number;           // numeric magnitude (already sign/bound-corrected)
    percent: boolean;        // true if a "%" stat
    raw: string;             // raw OCR text of the line
    cropUrl?: string;        // evidence: JPEG data-URL of the substat line on the source screenshot
}

export interface MainStat {
    kind: 'damage' | 'health';
    value: number;           // parsed magnitude
    valueRaw: string;        // e.g. "1.89b"
    ranged?: boolean;
    cropUrl?: string;        // evidence: JPEG data-URL of the main-stat line on the source screenshot
}

export interface DetectedItem {
    ageIdx: number;          // 0..9 (AutoItemMapping.Age)
    age: string;             // age display word
    slot?: string;           // item type/slot (Helmet, Weapon, ...)
    itemKey?: string;        // AutoItemMapping key "age_type_idx"
    name?: string;           // resolved item name
    level: number | null;
    stars: number;           // 0..3 ascension
    mainStat?: MainStat;
    substats: Substat[];
    cropUrl?: string;        // data-URL of the detected tile (for the modal)
    levelCropUrl?: string;   // evidence: JPEG data-URL of the "Lv." band the level was read from
    confidence: number;      // 0..1
}

export interface DetectedUnit {
    kind: 'pet' | 'mount';
    rarityIdx: number;       // 0..5
    rarity: string;
    id?: number;
    name?: string;
    level: number | null;
    stars: number;
    mainStat?: MainStat;
    substats: Substat[];
    cropUrl?: string;
    levelCropUrl?: string;   // evidence: JPEG data-URL of the "Lv." band the level was read from
    confidence: number;
}

export interface DetectedSkill {
    idx: number;             // 0..17 grid position -> skillId via SKILLS_ORDER
    skillId: string;
    level: number | null;
    ascension?: number;      // 0..3 gold stars under the cell's "Lv." text (countStars topology)
    equipped: boolean;       // dimmed cell
    maxed: boolean;
    cropUrl?: string;        // evidence: JPEG data-URL of the grid cell (icon + "Lv." band)
}

export interface DetectedCurrencies {
    coin?: number; gem?: number; egg?: number; ticket?: number; clock?: number; hammer?: number;
}

/** One fully-visible clan tech node read off a Clan Tech Tree screenshot: identity is resolved
 *  positionally (section card -> category + reading-order offset, icon-NCC cross-checked), the
 *  level from the "<lvl>/<max>" | "Max" text under the circle ('Max' resolved to MaxLevel). */
export interface DetectedClanNode {
    globalId: number;           // flattened GuildTechTreePositionLibrary index (profile.techTree.Clan key)
    nodeType: string;           // library node type (e.g. 'WeaponBonus')
    level: number;              // read level; 'Max' resolved to the library MaxLevel
    max: number;                // library MaxLevel for the node type
    confidence: number;         // icon NCC of the assigned identity, clamped to 0..1
    cropUrl?: string;           // evidence: circle + level text
}

export interface DetectedClanTree {
    nodes: DetectedClanNode[];
    guildPotions?: number | null;  // header potion counter (null/undefined = unreadable)
    potionCropUrl?: string;        // evidence crop of the header potion pill
    confidence: number;            // share of accepted circles whose level text parsed
}

/** Evidence crops (icon + number strip, JPEG data-URLs) keyed like DetectedCurrencies. */
export interface CurrencyCrops {
    coin?: string; gem?: string; egg?: string; ticket?: string; clock?: string; hammer?: string;
}

/** Result of reading a skin popup (see skinReader.ts). Skin display names are not in the
 *  configs, so identification resolves the SET name (set-bonus line) + popup title (Type)
 *  to a SkinsLibrary {Type, Idx}; unresolved reads carry only the raw name. */
export interface DetectedSkinEquip {
    slot?: string;                                 // profile items key hint (Helmet, Body, Weapon)
    skinType?: string;                             // SkinId.Type ('Helmet' | 'Armour' | 'Weapon')
    skinIdx?: number;                              // SkinId.Idx — set only when resolved
    setId?: string;                                // BaseSetId (e.g. 'FishbowlSet')
    name?: string;                                 // raw OCR'd skin name (e.g. 'Goldfish')
    stats: { statType: string; value: number }[];  // fraction values (0.0678 = +6.78%)
    equipped: boolean;
    cropUrl?: string;                              // data-URL of the detail card (for the modal)
    confidence: number;                            // 0..1
    warnings: string[];
}

export interface ScreenReadResult {
    screen: ScreenTemplate | 'skin';
    item?: DetectedItem;
    unit?: DetectedUnit;
    skills?: DetectedSkill[];
    clanTree?: DetectedClanTree;
    skin?: DetectedSkinEquip;
    currencies?: DetectedCurrencies;
    currencyCrops?: CurrencyCrops;   // evidence crops for the currencies above (observability only)
    forgeLevel?: number | null;      // "Forge Level NN" button on the forge row (item screens only)
    forgeLevelCropUrl?: string;      // evidence crop of the forge-button band
    skillAscension?: number | null;  // gold star count (0..3) on the skills screen widget
    warnings: string[];
    confidence: number;
}
