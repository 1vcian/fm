/**
 * How many equipped pieces can carry a given secondary stat at the same time, from the config.
 *
 * Verified in libil2cpp.so, build 2026_10_08_09_03:
 *   - Stats.GetAllSecondaryStats (0x77B46F4) sums the SecondaryStats of every equipped item
 *     (PlayerEquipmentModel.Items, a MetaDictionary<ItemType, PlayerItemModel>: one item per
 *     ItemType), every equipped pet (PlayerPetCollectionModel.GetEquippedPets) and the mount whose
 *     IsEquipped flag is set (lambda 0x77B4C84 reads PlayerMountModel.IsEquipped).
 *   - SecondaryStats is a MetaDictionary<SecondaryStatType, F64>
 *     (AddOrReplaceStatContribution 0x785F368), so one piece holds each stat at most once.
 *   - GatherContributions (0x7860EE4) sums every contribution with no cap.
 *
 * So the most lines of one stat = item types + pet slots + one mount, and the largest total of a
 * stat is UpperRange times that. Item types are the distinct `Type` of ItemBalancingLibrary, pet
 * slots are PetBaseConfig.PetSlotsCount.
 */

/** Distinct equipment types in ItemBalancingLibrary (keys look like "{'Age': 0, 'Type': 'Helmet', 'Idx': 0}"). */
export function equipmentTypeCount(itemBalancingLibrary: Record<string, unknown> | null | undefined): number {
    if (!itemBalancingLibrary) return 0;
    const types = new Set<string>();
    for (const key of Object.keys(itemBalancingLibrary)) {
        const m = key.match(/'Type':\s*'([^']+)'/);
        if (m) types.add(m[1]);
    }
    return types.size;
}

/** The single equipped mount (GetAllSecondaryStats keeps the one with IsEquipped). */
const EQUIPPED_MOUNTS = 1;

/**
 * Pieces that can each carry one line of a secondary stat, or null while a config is missing
 * (callers must not guess a number).
 */
export function maxSubstatPieces(
    itemBalancingLibrary: Record<string, unknown> | null | undefined,
    petBaseConfig: { PetSlotsCount?: number } | null | undefined,
): number | null {
    const items = equipmentTypeCount(itemBalancingLibrary);
    const pets = petBaseConfig?.PetSlotsCount;
    if (!items || typeof pets !== 'number') return null;
    return items + pets + EQUIPPED_MOUNTS;
}

/**
 * Largest total of one secondary stat reachable with gear (every piece rolling it at its
 * SecondaryStatLibrary UpperRange), or null while a config is missing.
 */
export function maxSubstatTotal(
    secondaryStatRow: { UpperRange?: number } | null | undefined,
    itemBalancingLibrary: Record<string, unknown> | null | undefined,
    petBaseConfig: { PetSlotsCount?: number } | null | undefined,
): number | null {
    const pieces = maxSubstatPieces(itemBalancingLibrary, petBaseConfig);
    const upper = secondaryStatRow?.UpperRange;
    if (pieces === null || typeof upper !== 'number') return null;
    return upper * pieces;
}

/** One equipped piece that carries substats, as the substat optimizer and calculator see it. */
export interface ProfileSubstatBody {
    /** 'item:<Slot>', 'pet:<index>' or 'mount'. */
    key: string;
    label: string;
    slots: number;
}

/**
 * The substat slots of a profile's equipped pieces, by the same rules as the item, pet and mount
 * pickers: SecondaryStatItemUnlockLibrary[item age] / SecondaryStatPetUnlockLibrary[rarity], and
 * every piece of a kind gets the top count once that kind has an ascension (forge for items, pet
 * and mount ascension for pets and the mount).
 */
export function profileSubstatBodies(
    profile: {
        items: Record<string, { age: number } | null>;
        pets: { active: ({ rarity: string } | null)[] };
        mount: { active: { rarity: string } | null };
        misc: { forgeAscensionLevel?: number; petAscensionLevel?: number; mountAscensionLevel?: number };
    },
    itemUnlockLibrary: Record<string, { NumberOfSecondStats: number }> | null | undefined,
    petUnlockLibrary: Record<string, { NumberOfSecondStats: number }> | null | undefined,
): ProfileSubstatBody[] {
    const top = (lib: Record<string, { NumberOfSecondStats: number }> | null | undefined) =>
        Math.max(0, ...Object.values(lib ?? {}).map(r => r.NumberOfSecondStats));
    const out: ProfileSubstatBody[] = [];
    for (const [slot, item] of Object.entries(profile.items)) {
        if (!item) continue;
        const slots = (profile.misc.forgeAscensionLevel || 0) > 0 ? top(itemUnlockLibrary) : itemUnlockLibrary?.[String(item.age)]?.NumberOfSecondStats ?? 0;
        out.push({ key: `item:${slot}`, label: slot, slots });
    }
    profile.pets.active.forEach((pet, i) => {
        if (!pet) return;
        const slots = (profile.misc.petAscensionLevel || 0) > 0 ? top(petUnlockLibrary) : petUnlockLibrary?.[pet.rarity]?.NumberOfSecondStats ?? 0;
        out.push({ key: `pet:${i}`, label: `Pet ${i + 1}`, slots });
    });
    const mount = profile.mount.active;
    if (mount) {
        const slots = (profile.misc.mountAscensionLevel || 0) > 0 ? top(petUnlockLibrary) : petUnlockLibrary?.[mount.rarity]?.NumberOfSecondStats ?? 0;
        out.push({ key: 'mount', label: 'Mount', slots });
    }
    return out;
}
