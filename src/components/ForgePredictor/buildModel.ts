import { ageChanceRows, maxDisplayedForgeLevel, parseForgeUpgrades } from '../../utils/forgeConfig';
import { ageAscensionFromForge } from '../../utils/ascensionUnlocks';

export const MODEL_FILES = [
    'GameTiers.json',
    'ItemAgeDropChancesLibrary.json',
    'ItemBalancingLibrary.json',
    'ItemBalancingConfig.json',
    'ItemLevelBracketsLibrary.json',
    'SecondaryStatLibrary.json',
    'SecondaryStatItemUnlockLibrary.json',
    'WeaponLibrary.json',
    'ForgeUpgradeLibrary.json',
    'AscensionConfigsLibrary.json',
    'PlayerTechTreePositionLibrary.json',
    'PlayerTechTreeNodeValuesLibrary.json',
    'AutoItemMapping.json',
    'Localization.json',
] as const;

export type ModelFiles = Partial<Record<(typeof MODEL_FILES)[number], any>>;

const SLOT_TYPES = ['Helmet', 'Armour', 'Gloves', 'Necklace', 'Ring', 'Weapon', 'Shoes', 'Belt'];
const STAT_IDS = ['CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal', 'DoubleDamageChance', 'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti', 'AttackSpeed', 'SkillDamageMulti', 'SkillCooldownMulti', 'HealthMulti'];

function itemName(files: ModelFiles, age: number, type: number, idx: number): string {
    const mapping = files['AutoItemMapping.json']?.[`${age}_${type}_${idx}`];
    const official = mapping?.LocalizationId != null ? files['Localization.json']?.items?.[String(mapping.LocalizationId)]?.en : undefined;
    if (official) return official;
    if (mapping?.ItemName) return mapping.ItemName.replace(/([a-z])([A-Z])/g, '$1 $2').replace('&', ' & ');
    return `${SLOT_TYPES[type]} ${idx + 1}`;
}

/**
 * The Forge Predictor's game tables, built from the same parsed configs the rest of the app reads
 * for the selected version. Returns null while a file is missing or the version predates the
 * formats the predictor understands.
 */
export function buildForgeModel(version: string, files: ModelFiles): any | null {
    if (MODEL_FILES.some(f => !files[f])) return null;
    const tiers = files['GameTiers.json'].ages as { label: string; color: string }[];
    const ageNames = tiers.map(t => t.label);
    const ageCount = ageNames.length;

    const probabilities: Record<string, any> = {};
    for (const [level, chances] of ageChanceRows(files['ItemAgeDropChancesLibrary.json'])) {
        const row: Record<string, number> = { Level: level };
        for (let age = 0; age < ageCount; age++) row['Age' + age] = chances[age] ?? 0;
        probabilities[String(level)] = row;
    }

    const groups: Record<number, Record<number, number[]>> = {};
    const names: Record<string, string> = {};
    const baseStats: Record<string, { damage: number; health: number }> = {};
    for (const entry of Object.values<any>(files['ItemBalancingLibrary.json'])) {
        const { Age: age, Type: typeName, Idx: idx } = entry?.ItemId ?? {};
        const type = SLOT_TYPES.indexOf(typeName);
        if (!Number.isInteger(age) || age < 0 || age >= ageCount || type < 0) continue;
        ((groups[age] ??= {})[type] ??= []).push(idx);
        const key = `${age}:${type}:${idx}`;
        const stat = (name: string) => entry.EquipmentStats?.find((s: any) => s.StatNode?.UniqueStat?.StatType === name)?.Value ?? 0;
        names[key] = itemName(files, age, type, idx);
        baseStats[key] = { damage: stat('Damage'), health: stat('Health') };
    }
    const items: Record<string, { type: number; indices: number[] }[]> = {};
    for (let age = 0; age < ageCount; age++) {
        const byType = groups[age];
        if (!byType) return null;
        items[String(age)] = Object.keys(byType).map(Number).sort((a, b) => a - b).map(type => ({ type, indices: byType[type].sort((a, b) => a - b) }));
    }

    const weapons: Record<string, boolean> = {};
    for (const entry of Object.values<any>(files['WeaponLibrary.json'])) {
        const { Age: age, Type: typeName, Idx: idx } = entry?.ItemId ?? {};
        if (typeName === 'Weapon' && Number.isInteger(age) && age >= 0 && age < ageCount) weapons[`${age}:${idx}`] = !!entry.IsRanged;
    }

    const unlocks = files['SecondaryStatItemUnlockLibrary.json'];
    const statCounts: Record<string, number> = {};
    for (let age = 0; age < ageCount; age++) statCounts[String(age)] = unlocks[String(age)]?.NumberOfSecondStats ?? 0;

    const secondary = files['SecondaryStatLibrary.json'];
    const statRanges = Object.values<any>(secondary).map(s => ({ lower: s.LowerRange, upper: s.UpperRange }));
    const rollable = STAT_IDS.map((id, k) => (secondary[id] ? k : -1)).filter(k => k >= 0);

    const forge = parseForgeUpgrades(files['ForgeUpgradeLibrary.json']);
    if (!forge) return null;
    const ascensionRows = files['AscensionConfigsLibrary.json']?.Forge?.AscensionConfigPerLevel ?? [];
    const primaryMultipliers = [1, ...ascensionRows.map((row: any) => 1 + (row.StatContributions?.find((c: any) => c.StatNode?.UniqueStat?.StatType === 'Damage')?.Value ?? 0))];
    const maxDisplayedByAscension = primaryMultipliers.map((_: number, a: number) => maxDisplayedForgeLevel(forge, a));
    const unlockByAge = ageAscensionFromForge(files['ForgeUpgradeLibrary.json'], files['ItemAgeDropChancesLibrary.json']);

    const balancing = files['ItemBalancingConfig.json'];
    const nodeTypes = new Set(Object.values<any>(files['PlayerTechTreePositionLibrary.json']).flatMap(tree => (tree?.Nodes ?? []).map((n: any) => n.Type)));
    const techValues = Object.fromEntries(Object.entries<any>(files['PlayerTechTreeNodeValuesLibrary.json']).filter(([type]) => nodeTypes.has(type)));

    return {
        version,
        probabilities,
        items,
        brackets: files['ItemLevelBracketsLibrary.json'],
        statCounts,
        rollable,
        weapons,
        names,
        baseStats,
        statRanges,
        levelScaling: balancing.LevelScalingBase,
        baseCap: balancing.ItemBaseMaxLevel,
        meleeMultiplier: balancing.PlayerMeleeDamageMultiplier,
        techPositions: files['PlayerTechTreePositionLibrary.json'],
        techValues,
        modelId: version,
        ageNames,
        maxDisplayedByAscension,
        primaryMultipliers,
        sellBasePrice: balancing.SellBasePrice,
        ageColors: tiers.map(t => t.color),
        ascendedStatCount: Math.max(...Object.values<any>(unlocks).map(r => r.NumberOfSecondStats ?? 0)),
        ageUnlockAscension: ageNames.map((_, age) => unlockByAge[age] ?? 0),
    };
}
