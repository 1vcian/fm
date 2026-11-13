/**
 * Item ages and rarities, in game order, from the newest build's GameTiers.json
 * (reverseForge/game_tiers.py: WorldVisualConfig.AgeConfigs, the Rarity enum, DefaultColors via
 * RarityExtensions.GetColor, English names from the game's localization tables).
 *
 * No list here is written by hand: `loadGameTiers` fills the arrays in place before the app
 * renders (main.tsx), so module code can import them like constants. They are empty until then.
 */

export interface GameTier {
    /** Value in the game (ItemId.Age, Rarity enum). */
    index: number;
    /** Name in the game: AgeVisualConfig.Name ("EarlyModern"), Rarity enum name ("Mythic"). */
    key: string;
    /** English name shown in the game ("Early-Modern"). */
    label: string;
    /** '#RRGGBB', the colour the game draws the tier with. */
    color: string;
    /** Ages: AgeVisualConfig.Icon, a rect (top-left origin) of a texture in Texture2D/<version>/. */
    icon?: TierSprite | null;
    /** Rarities: PetCollectionVisualConfig.EggRarityIcons, the egg icon per ascension level (0 = base). */
    eggIcons?: (TierSprite | null)[];
}

/** A sprite as a rect (top-left origin) of a texture in Texture2D/<version>/, and that texture's size. */
export interface TierSprite { tex: string; x: number; y: number; w: number; h: number; texW: number; texH: number }

export const AGE_TIERS: GameTier[] = [];
export const RARITY_TIERS: GameTier[] = [];
/** English age names by ItemId.Age ("Primitive" .. "Divine" in 2026_10). */
export const AGES: string[] = [];
/** Rarity names by Rarity enum value ("Common" .. "Mythic" in 2026_10). */
export const RARITIES: string[] = [];

/** [r, g, b] per age and per rarity, same order (the screenshot reader matches tile colours). */
export const AGE_RGB: [number, number, number][] = [];
export const RARITY_RGB: [number, number, number][] = [];

/** CSS name of a tier: its game key in lower case ("earlymodern", "mythic"). */
export const tierSlug = (name: string) => name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** Index of an age given its English name or game key, in any case, hyphens ignored. -1 if unknown. */
export function ageIndexOf(name: string | null | undefined): number {
    if (!name) return -1;
    const s = tierSlug(name);
    return AGE_TIERS.findIndex(t => tierSlug(t.key) === s || tierSlug(t.label) === s);
}

/** Game key of an age ("EarlyModern"): the sprite and asset prefix. */
export const ageKey = (age: number) => AGE_TIERS[age]?.key;

/** Index of a rarity by name, any case. -1 if unknown. */
export function rarityIndexOf(name: string | null | undefined): number {
    if (!name) return -1;
    const s = tierSlug(name);
    return RARITY_TIERS.findIndex(t => tierSlug(t.key) === s);
}

/** '#RRGGBB' of an age or rarity, or undefined when the build has no such tier. */
export const ageColor = (age: number) => AGE_TIERS[age]?.color;
export const rarityColor = (name: string) => RARITY_TIERS[rarityIndexOf(name)]?.color;

/** [r, g, b] of '#RRGGBB'. */
export function hexRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ALPHAS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90];

/**
 * CSS for every tier: variables (`--age-<slug>` hex, `--age-<slug>-rgb`, `--rarity-<slug>`
 * "r, g, b", `--rarity-<slug>-hex`) and the utility classes the app uses with them
 * (text-, bg-, border-, ring-, from-, shadow-, each also with a /N opacity).
 */
function tierCss(): string {
    const vars: string[] = [];
    const rules: string[] = [];
    const add = (group: 'age' | 'rarity', t: GameTier) => {
        const slug = tierSlug(t.key);
        const [r, g, b] = hexRgb(t.color);
        const rgb = `${r}, ${g}, ${b}`;
        if (group === 'age') {
            vars.push(`--age-${slug}: ${t.color};`, `--age-${slug}-rgb: ${rgb};`);
        } else {
            vars.push(`--rarity-${slug}: ${rgb};`, `--rarity-${slug}-hex: ${t.color};`);
        }
        const c = `${group}-${slug}`;
        const rgba = (a: number) => `rgba(${rgb}, ${a})`;
        rules.push(
            `.text-${c}{color:${t.color}}`,
            `.border-${c}{border-color:${t.color}}`,
            `.ring-${c}{--tw-ring-color:${t.color}}`,
            `.from-${c}{--tw-gradient-from:${t.color} var(--tw-gradient-from-position);--tw-gradient-to:${rgba(0)} var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)}`,
            `.shadow-${c}{--tw-shadow-color:${t.color};--tw-shadow:var(--tw-shadow-colored)}`,
            group === 'rarity'
                ? `.bg-${c}{background-color:${t.color};background-image:linear-gradient(135deg, ${rgba(0.4)} 0%, ${rgba(0.15)} 100%)}`
                : `.bg-${c}{background-color:${t.color}}`,
        );
        for (const a of ALPHAS) {
            const v = rgba(a / 100);
            rules.push(
                `.text-${c}\\/${a}{color:${v}}`,
                `.bg-${c}\\/${a}{background-color:${v}}`,
                `.border-${c}\\/${a}{border-color:${v}}`,
                `.ring-${c}\\/${a}{--tw-ring-color:${v}}`,
                `.shadow-${c}\\/${a}{--tw-shadow-color:${v};--tw-shadow:var(--tw-shadow-colored)}`,
            );
        }
    };
    AGE_TIERS.forEach(t => add('age', t));
    RARITY_TIERS.forEach(t => add('rarity', t));
    return `:root{${vars.join('')}}\n${rules.join('\n')}`;
}

function apply(data: { ages: GameTier[]; rarities: GameTier[] }) {
    const ages = [...data.ages].sort((a, b) => a.index - b.index);
    const rarities = [...data.rarities].sort((a, b) => a.index - b.index);
    AGE_TIERS.splice(0, AGE_TIERS.length, ...ages);
    RARITY_TIERS.splice(0, RARITY_TIERS.length, ...rarities);
    AGES.splice(0, AGES.length, ...ages.map(t => t.label));
    RARITIES.splice(0, RARITIES.length, ...rarities.map(t => t.key));
    AGE_RGB.splice(0, AGE_RGB.length, ...ages.map(t => hexRgb(t.color)));
    RARITY_RGB.splice(0, RARITY_RGB.length, ...rarities.map(t => hexRgb(t.color)));
    if (typeof document !== 'undefined') {
        let el = document.getElementById('game-tiers') as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = 'game-tiers';
            document.head.appendChild(el);
        }
        el.textContent = tierCss();
    }
}

/** Fill the tier lists from data already in hand (tests, scripts). */
export function setGameTiers(data: { ages: GameTier[]; rarities: GameTier[] }) {
    apply(data);
}

/**
 * Load GameTiers.json from the newest config version that has one (versions.json order, newest
 * first, as GameDataContext picks it).
 */
export async function loadGameTiers(baseUrl: string): Promise<string> {
    const res = await fetch(`${baseUrl}parsed_configs/versions.json`);
    const versions: string[] = res.ok ? await res.json() : [];
    versions.sort((a, b) => b.localeCompare(a));
    for (const v of versions) {
        const r = await fetch(`${baseUrl}parsed_configs/${v}/GameTiers.json`);
        if (!r.ok || (r.headers.get('content-type') || '').includes('html')) continue;
        apply(await r.json());
        return v;
    }
    throw new Error('No config version has a GameTiers.json');
}
