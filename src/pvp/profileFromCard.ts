/**
 * A UserProfile from what a profile card shows (before the tree solver fills the trees).
 *
 * What the card's stat lines are, read from the binary (PvpProfileSecondaryEffectsUiView,
 * 0x3F21FB4): NOT combat stats but the display ledger of the secondary stat pool, i.e. the sum of
 *   - substats of the equipped items, pets and mount,
 *   - clan tech nodes that map to a secondary stat (PlayerMoveSpeed, PlayerAttackRange),
 *   - the fairy's RAW (uncapped) grant into its target stat,
 *   - and, for Critical Damage, the 0.2 base, which the card subtracts again before printing.
 * Player tech, skins, sets, passives and ascensions are not in any percentage. Each line is
 * floored to 3 significant digits; Skill Cooldown prints with a "-" but is stored positive.
 *
 * So the profile's substat pool is the card's lines, minus the fairy grant, minus what the clan
 * speed/range nodes account for (those become clan node levels instead). The whole pool is put on
 * the weapon: the stat engine only ever sums the pool, so where a roll sits does not matter.
 */
import { INITIAL_PROFILE, type ItemSlot, type UserProfile } from '../types/Profile';
import type { CardRead } from '../utils/ocr/cardTypes';
import { SEASON_STATS, fairyRawBonus, type FairyName } from '../utils/fairies';

/** statEngine pool name -> SecondaryStatLibrary id, for the fairy target / required stats. */
const POOL_TO_ID: Record<string, string> = {
    criticalChance: 'CriticalChance', blockChance: 'BlockChance', reflectChance: 'ReflectChance',
    skillDamageMulti: 'SkillDamageMulti', skillCooldownMulti: 'SkillCooldownMulti', healthMulti: 'HealthMulti',
};

export interface CardProfileLibs {
    skillLibrary: any;
    guildPositionLibrary: any;
    guildUpgradeLibrary: any;
}

function clanNodeId(guildPositionLibrary: any, type: string): number | null {
    let id = 0;
    for (const cat of Object.keys(guildPositionLibrary || {})) {
        for (const t of guildPositionLibrary[cat]?.Nodes || []) {
            if (t === type) return id;
            id += 1;
        }
    }
    return null;
}

export function profileFromCard(card: CardRead, libs: CardProfileLibs): { profile: UserProfile; notes: string[] } {
    const notes: string[] = [];
    const p: UserProfile = JSON.parse(JSON.stringify(INITIAL_PROFILE));
    p.name = card.name || 'Card opponent';

    // ---- substat pool ----
    const pool: Record<string, number> = {};
    for (const [id, v] of Object.entries(card.stats)) pool[id] = id === 'SkillCooldownMulti' ? Math.abs(v) : v;

    // The fairy's raw grant is in its target line; the conversion reads the displayed pool.
    const fairyName = card.fairy?.name as FairyName | null | undefined;
    const fairyLevel = card.fairy?.level ?? 0;
    if (fairyName && SEASON_STATS[fairyName] && fairyLevel > 0) {
        const cfg = SEASON_STATS[fairyName];
        const requiredId = POOL_TO_ID[cfg.requiredStat];
        const targetId = POOL_TO_ID[cfg.targetStat];
        const raw = fairyRawBonus(cfg, fairyLevel, (pool[requiredId] ?? 0) / 100) * 100;
        if (raw > 0 && pool[targetId] != null) {
            pool[targetId] = Math.max(0, pool[targetId] - raw);
            notes.push(`${fairyName} Lv.${fairyLevel} grants ${raw.toFixed(2)}% ${cfg.targetLabel}; it was taken out of the substat pool and re-applied by the fairy.`);
        }
        p.misc.fairy = { name: fairyName, level: fairyLevel };
    } else if (card.fairy) {
        notes.push('A fairy is on the card but it could not be identified: its grant stays inside the substat pool.');
    }

    // Clan nodes that feed a secondary stat line: move speed (% per level) and attack range.
    const clan: Record<number, number> = {};
    for (const [statId, nodeType] of [['MoveSpeed', 'PlayerMoveSpeed'], ['AttackRange', 'PlayerAttackRange']] as const) {
        const v = pool[statId];
        if (v == null) continue;
        const def = libs.guildUpgradeLibrary?.[nodeType];
        const id = clanNodeId(libs.guildPositionLibrary, nodeType);
        const perLevel = Number(def?.ValuePerLevel) * 100;
        if (id != null && perLevel > 0) {
            const level = Math.min(Number(def.MaxLevel) || 0, Math.round(v / perLevel));
            if (level > 0) clan[id] = level;
            delete pool[statId];
        }
    }

    // ---- items ----
    const secondary = Object.entries(pool).filter(([, v]) => v > 0).map(([statId, value]) => ({ statId, value }));
    let weaponHasPool = false;
    for (const it of card.items) {
        if (it.level == null || it.age == null) {
            notes.push(`${it.slot}: level or age not read, the slot is left empty.`);
            continue;
        }
        if (it.idx == null) notes.push(`${it.slot}: item not identified, the first item of its age is used.`);
        const item: ItemSlot = { age: it.age, idx: it.idx ?? 0, level: it.level, rarity: 'Common', secondaryStats: [] };
        if (it.slot === 'Weapon') {
            item.secondaryStats = secondary;
            weaponHasPool = true;
            // The skin's animation replaces the weapon's windup (statEngine SKIN OVERRIDE). Its bonus
            // is unknown from the card, so stats stay empty and the tree solver absorbs it.
            const anim = card.weaponAnimation ?? (it.hasSkin ? { source: 'skin' as const, idx: null } : { source: 'weapon' as const });
            if (anim.source === 'skin') {
                if (anim.idx != null) item.skin = { idx: anim.idx, type: 'Weapon', stats: {} };
                else notes.push('The weapon wears a skin but it is not chosen: the weapon windup is used until you pick the skin.');
            }
        }
        (p.items as Record<string, ItemSlot | null>)[it.slot] = item;
    }
    if (!weaponHasPool && secondary.length) {
        // No weapon read: park the pool on any present item so it still counts.
        const host = Object.values(p.items).find(Boolean) as ItemSlot | undefined;
        if (host) host.secondaryStats = secondary;
        else notes.push('No item was read, so the stat lines could not be placed.');
    }
    if (card.items.some(i => i.hasSkin)) notes.push('Skins are on the card but not identified: their bonus is left to the tree solver.');

    // ---- pets / mount / skills ----
    // An identified pet or skill whose level was not read still counts as EQUIPPED: the arena HP
    // multiplier counts equipped pets and skills, so dropping it would understate both players' HP.
    const stars: number[] = [];
    p.pets.active = card.pets
        .filter(u => u.rarity && u.id != null)
        .map((u, k) => {
            if (u.stars != null) stars.push(u.stars);
            if (u.level == null) notes.push(`Pet ${k + 1}: level not read, Lv.1 assumed. Enter it to refine the rebuild.`);
            return { rarity: u.rarity!, id: u.id!, level: u.level ?? 1, evolution: 0, ascensionLevel: u.stars ?? 0, secondaryStats: [] };
        });
    if (stars.length) p.misc.petAscensionLevel = Math.max(...stars);
    if (card.pets.length > p.pets.active.length) notes.push(`${card.pets.length - p.pets.active.length} pet(s) not identified.`);

    const m = card.mount;
    if (m && m.rarity && m.id != null) {
        if (m.level == null) notes.push('Mount: level not read, Lv.1 assumed. Enter it to refine the rebuild.');
        p.mount.active = { rarity: m.rarity, id: m.id, level: m.level ?? 1, evolution: 0, ascensionLevel: m.stars ?? 0, skills: [], secondaryStats: [] };
        p.misc.mountAscensionLevel = m.stars ?? 0;
    } else if (m) notes.push('Mount not identified.');

    const skillStars: number[] = [];
    p.skills.equipped = card.skills
        .filter(s => s.skillId)
        .map(s => {
            if (s.stars != null) skillStars.push(s.stars);
            if (s.level == null) notes.push(`${s.skillId}: level not read, Lv.1 assumed. Enter it to refine the rebuild.`);
            return { id: s.skillId!, rarity: libs.skillLibrary?.[s.skillId!]?.Rarity ?? 'Common', level: s.level ?? 1, evolution: 0, ascensionLevel: s.stars ?? 0 };
        });
    p.skills.passives = Object.fromEntries(p.skills.equipped.map(s => [s.id, s.level]));
    if (skillStars.length) p.misc.skillAscensionLevel = Math.max(...skillStars);
    if (card.skills.length > p.skills.equipped.length) notes.push(`${card.skills.length - p.skills.equipped.length} skill(s) not identified.`);

    // ---- forge ----
    if (card.forgeLevel != null) p.misc.forgeLevel = card.forgeLevel;
    if (card.forgeStars != null) p.misc.forgeAscensionLevel = card.forgeStars;

    p.techTree = { ...p.techTree, Clan: clan };
    return { profile: p, notes };
}
