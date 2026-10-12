/**
 * What a player profile card ("enemy panel") screenshot yields, the contract between the card
 * reader (cardReader.ts) and its consumers (the PvP opponent builder and the tree solver).
 *
 * Every field is nullable: null means NOT READ, never "zero". A consumer must treat a null as
 * unknown and let the user fill it, not as a reading.
 *
 * Layout of the card (576x1280 reference): header (name, clan, power on the left; "Lv. N Forge"
 * with forge stars, "X Total Damage", "Y Total Health" on the right), a battle preview, the item
 * lattice (row 1: Helmet, Body, Gloves, Necklace, Ring; row 2: Weapon, Shoe, Belt, then the wide
 * mount tile), a row of 3 pets and 3 skills (each with level + ascension stars), the fairy with its
 * level on the right when one is equipped, and a scrolling list of stat totals.
 */

export type CardItemSlot = 'Helmet' | 'Body' | 'Gloves' | 'Necklace' | 'Ring' | 'Weapon' | 'Shoe' | 'Belt';

export const CARD_ITEM_SLOTS: CardItemSlot[] = ['Helmet', 'Body', 'Gloves', 'Necklace', 'Ring', 'Weapon', 'Shoe', 'Belt'];

export interface CardItem {
    slot: CardItemSlot;
    /** Item age 0..9 (Primitive..Divine), from the tile colour. */
    age: number | null;
    /** Item index within (age, type), from the icon. */
    idx: number | null;
    level: number | null;
    /** Forge ascension stars shown on the tile (0..3). */
    stars: number | null;
    /** A skin badge sits on the tile corner (which skin is not resolved); null when unread. */
    hasSkin: boolean | null;
    confidence: number;
    cropUrl?: string;
}

export interface CardUnit {
    rarity: string | null;
    id: number | null;
    level: number | null;
    stars: number | null;
    confidence: number;
    cropUrl?: string;
}

export interface CardSkill {
    skillId: string | null;
    level: number | null;
    stars: number | null;
    confidence: number;
    cropUrl?: string;
}

export interface CardRead {
    name: string | null;
    totalDamage: number | null;
    totalHealth: number | null;
    forgeLevel: number | null;
    forgeStars: number | null;
    items: CardItem[];
    pets: CardUnit[];
    mount: CardUnit | null;
    skills: CardSkill[];
    fairy: { name: string | null; level: number | null } | null;
    /**
     * Stat totals as printed, in percent, keyed by the app's substat ids (SUBSTAT_DEFS):
     * "+80% Critical Chance" -> { CriticalChance: 80 }. Only lines actually read are present.
     */
    stats: Record<string, number>;
    warnings: string[];
    /**
     * Where the weapon's attack animation (windup) comes from: the weapon itself, or a weapon skin,
     * whose animation replaces the weapon's. The card shows THAT a skin is on (badge) but not which,
     * so the user chooses; idx null = skin present but not chosen yet. Set by the editor, not the reader.
     */
    weaponAnimation?: { source: 'weapon' } | { source: 'skin'; idx: number | null };
}

/**
 * Several screenshots of the SAME card (the stat list scrolls): later reads fill what earlier
 * ones left null, and stat lines are unioned. Conflicting non-null values keep the first read
 * and add a warning.
 */
export function mergeCardReads(reads: CardRead[]): CardRead | null {
    if (!reads.length) return null;
    const out: CardRead = JSON.parse(JSON.stringify(reads[0]));
    /** Fill every null field of `a` from `b`; keep `a`'s non-null values. */
    const fill = <T extends object>(a: T, b: T): T => {
        const r: any = { ...a };
        for (const [k, v] of Object.entries(b)) if (r[k] == null && v != null) r[k] = v;
        return r;
    };
    /** Entry by entry, so a second shot fills the slots a popup covered in the first. */
    const fillList = <T extends object>(a: T[], b: T[]): T[] => {
        const n = Math.max(a.length, b.length);
        return Array.from({ length: n }, (_, i) => (a[i] && b[i] ? fill(a[i], b[i]) : (a[i] ?? b[i])));
    };
    for (const r of reads.slice(1)) {
        for (const k of ['name', 'totalDamage', 'totalHealth', 'forgeLevel', 'forgeStars'] as const) {
            if (out[k] == null && r[k] != null) (out as any)[k] = r[k];
        }
        // Items are keyed by slot, not by position.
        for (const it of r.items) {
            const i = out.items.findIndex(x => x.slot === it.slot);
            if (i < 0) out.items.push(it); else out.items[i] = fill(out.items[i], it);
        }
        out.pets = fillList(out.pets, r.pets);
        out.skills = fillList(out.skills, r.skills);
        out.mount = out.mount && r.mount ? fill(out.mount, r.mount) : (out.mount ?? r.mount);
        out.fairy = out.fairy && r.fairy ? fill(out.fairy, r.fairy) : (out.fairy ?? r.fairy);
        for (const [id, v] of Object.entries(r.stats)) {
            if (out.stats[id] == null) out.stats[id] = v;
            else if (Math.abs(out.stats[id] - v) > 1e-9) {
                out.warnings.push(`Two screenshots disagree on ${id}: ${out.stats[id]}% vs ${v}%. Kept the first.`);
            }
        }
        out.warnings.push(...r.warnings);
    }
    return out;
}
