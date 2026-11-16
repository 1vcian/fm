/**
 * Forge upgrade and age-drop configs, read in both wire formats the app can load.
 *
 * ForgeUpgradeLibrary.json
 * - Up to 2026_10: one row per level, `{ Level, Cost, Duration, Tiers }`, keyed by Level (1..N).
 *   SharedGameConfigExtensions.MaxForgeLevel(config) (2026_10_27 RVA 0x77E535C) is the highest Level,
 *   whatever the forge ascension.
 * - From 2026_11: one row per forge ascension, `{ AscensionLevel, ForgeLevelConfigs: [{ Cost, Duration, Tiers }] }`.
 *   SharedGameConfig.OnLoaded (RVA 0x7C94898) walks the rows ordered by AscensionLevel and appends every
 *   ForgeLevelConfigs entry to ForgeUpgradesByLevel under key Count + 1, so the levels keep one global
 *   numbering (1..N across all rows). MaxForgeLevelByAscension[a] is ForgeUpgradesByLevel.Count after the
 *   row of ascension a; an ascension with no row of its own (between two rows) gets the count reached so
 *   far. SharedGameConfigExtensions.MaxForgeLevel(config, ascensionLevel) (RVA 0x7C3DE08) reads that map
 *   with the forge's AscensionModel.CurrentLevel (PlayerModelExtensions.ForgeAscensionLevel, RVA 0x7C915DC).
 *
 * In both, ForgeUpgradeStartAction.Execute (RVA 0x7CD4DEC) prices the upgrade with
 * ForgeUpgradesByLevel[ForgeLevel + 1], and ForgeLevelsMaxed (RVA 0x7CD5254) is ForgeLevel >= MaxForgeLevel.
 * PlayerForgeModel.ForgeLevel is 0-based (the game shows ForgeLevel + 1), so key N prices leaving
 * displayed level N and the top displayed level is MaxForgeLevel + 1. PlayerForgeModel.Ascend
 * (RVA 0x7CD7570) sets ForgeLevel back to 0.
 *
 * ItemAgeDropChancesLibrary.json
 * - Up to 2026_10: `{ Level, Age0 .. AgeN }`; from 2026_11: `{ Level, Ages: [..] }` (ItemAgeDropChanceInfo.Ages).
 *   ForgeAction.RollAge (RVA 0x7CD3328) still reads the row keyed by ForgeLevel (0-based), one cumulative
 *   pick over the list. SharedGameConfigExtensions.MaxAge(config) (RVA 0x7C3D724) is the last row's
 *   Ages.Count - 1 (BaseConfig.MaxAge before 2026_11).
 */

export interface ForgeLevelDef { Cost: number; Duration: number; Tiers: number }

export interface ForgeUpgrades {
    /** ForgeUpgradesByLevel: key N prices leaving displayed level N (0-based ForgeLevel N - 1 + 1). */
    byLevel: Record<number, ForgeLevelDef>;
    /** Highest key of byLevel. */
    lastKey: number;
    /** MaxForgeLevelByAscension by ascension (new format), or null when the cap ignores the ascension (old format). */
    maxByAscension: number[] | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** ForgeUpgradeLibrary.json, either format, as the game's ForgeUpgradesByLevel. Null while not loaded. */
export function parseForgeUpgrades(lib: unknown): ForgeUpgrades | null {
    if (!lib || typeof lib !== 'object') return null;
    const rows = Object.values(lib as Record<string, any>).filter(r => r && typeof r === 'object');
    if (!rows.length) return null;
    const byLevel: Record<number, ForgeLevelDef> = {};
    const isNew = rows.some(r => Array.isArray(r.ForgeLevelConfigs));
    if (!isNew) {
        let lastKey = 0;
        for (const r of rows) {
            const lv = num(r.Level);
            if (lv <= 0) continue;
            byLevel[lv] = { Cost: num(r.Cost), Duration: num(r.Duration), Tiers: num(r.Tiers) };
            lastKey = Math.max(lastKey, lv);
        }
        return { byLevel, lastKey, maxByAscension: null };
    }
    // SharedGameConfig.OnLoaded (RVA 0x7C94898).
    const ordered = rows.filter(r => Array.isArray(r.ForgeLevelConfigs)).sort((a, b) => num(a.AscensionLevel) - num(b.AscensionLevel));
    const maxByAscension: number[] = [];
    let count = 0;
    let asc = 0;
    for (const r of ordered) {
        const a = num(r.AscensionLevel);
        for (; asc < a; asc++) maxByAscension[asc] = count;
        for (const c of r.ForgeLevelConfigs) {
            count += 1;
            byLevel[count] = { Cost: num(c?.Cost), Duration: num(c?.Duration), Tiers: num(c?.Tiers) };
        }
        maxByAscension[asc] = count;
        asc += 1;
    }
    return { byLevel, lastKey: count, maxByAscension };
}

/**
 * MaxForgeLevel (0-based ForgeLevel cap) at a forge ascension. An ascension past the last listed one
 * is not in the game's map; the last entry is used (the game never reaches it: AscensionConfigsLibrary
 * caps the ascension).
 */
export function maxForgeLevel(fu: ForgeUpgrades, ascension: number): number {
    if (!fu.maxByAscension) return fu.lastKey;
    const m = fu.maxByAscension;
    if (!m.length) return 0;
    return m[Math.max(0, Math.min(Math.floor(ascension || 0), m.length - 1))];
}

/** Top displayed forge level at a forge ascension (MaxForgeLevel + 1). */
export const maxDisplayedForgeLevel = (fu: ForgeUpgrades, ascension: number) => maxForgeLevel(fu, ascension) + 1;

/** Top displayed forge level over every ascension. */
export function topDisplayedForgeLevel(fu: ForgeUpgrades): number {
    return (fu.maxByAscension?.length ? Math.max(...fu.maxByAscension) : fu.lastKey) + 1;
}

/** The forge ascension that first allows a displayed level, or null if none. */
export function ascensionForDisplayedLevel(fu: ForgeUpgrades, displayedLevel: number): number | null {
    if (!fu.maxByAscension) return displayedLevel <= fu.lastKey + 1 ? 0 : null;
    const i = fu.maxByAscension.findIndex(m => displayedLevel <= m + 1);
    return i < 0 ? null : i;
}

/** The upgrade that leaves displayed level N (ForgeUpgradesByLevel[N]). */
export const forgeLevelDef = (fu: ForgeUpgrades | null | undefined, displayedLevel: number): ForgeLevelDef | null =>
    fu?.byLevel[displayedLevel] ?? null;

/** Drop chances by age index of one ItemAgeDropChancesLibrary row, either format. */
export function ageChances(row: any): number[] {
    if (!row || typeof row !== 'object') return [];
    if (Array.isArray(row.Ages)) return row.Ages.map(num);
    const out: number[] = [];
    for (const k of Object.keys(row)) {
        const m = /^Age(\d+)$/.exec(k);
        if (m) out[Number(m[1])] = num(row[k]);
    }
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = 0;
    return out;
}

/** The ItemAgeDropChancesLibrary row of a 0-based ForgeLevel, as chances by age index. */
export function ageChancesAtForgeLevel(lib: any, forgeLevel: number): number[] {
    return ageChances(lib?.[String(forgeLevel)]);
}

/** Every row of ItemAgeDropChancesLibrary as [ForgeLevel, chances], ordered by level. */
export function ageChanceRows(lib: any): [number, number[]][] {
    if (!lib || typeof lib !== 'object') return [];
    return Object.entries(lib as Record<string, any>)
        .map(([k, r]) => [Number(r?.Level ?? k), ageChances(r)] as [number, number[]])
        .filter(([lv]) => Number.isFinite(lv))
        .sort((a, b) => a[0] - b[0]);
}

/**
 * Highest age index: SharedGameConfigExtensions.MaxAge (RVA 0x7C3D724) is the last
 * ItemAgeDropChancesLibrary row's Ages.Count - 1; before 2026_11 it was BaseConfig.MaxAge.
 * Returns null when neither is loaded.
 */
export function maxAgeIndex(ageDropLib: any, baseConfig?: any): number | null {
    const rows = ageChanceRows(ageDropLib);
    const last = rows[rows.length - 1];
    if (last && Array.isArray(ageDropLib?.[String(last[0])]?.Ages)) return last[1].length - 1;
    if (typeof baseConfig?.MaxAge === 'number') return baseConfig.MaxAge;
    if (last) return last[1].length - 1;
    return null;
}
