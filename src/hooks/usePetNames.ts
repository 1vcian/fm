import { useCallback, useMemo } from 'react';
import { useGameData } from './useGameData';

interface PetLibraryRow {
    PetId: { Rarity: string; Id: number };
    Name?: string;
}

interface SpriteMappingPets {
    pets?: { mapping?: Record<string, { name: string; rarity: string; id: number }> };
}

interface LocalizationPets {
    pets?: Record<string, Record<string, string>>;
}

/**
 * Pet display names.
 *
 * Source order: the game's English string (Localization.json pets["<Rarity>_<Id>"].en, generated
 * from the game's Pets string table, e.g. "Saber Tooth", "Hedgehog"), then PetLibrary.Name (a
 * string-table key, e.g. "SaberTooth", "Hedghehog" in 2026_10_08_09_03), then the hand-made
 * ManualSpriteMapping.json names. Returns a lookup by (rarity, id) that never fails: an unknown
 * pet reads "<Rarity> Pet #<id>".
 */
export function usePetNames() {
    const { data: petLibrary } = useGameData<Record<string, PetLibraryRow>>('PetLibrary.json');
    const { data: spriteMapping } = useGameData<SpriteMappingPets>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<LocalizationPets>('Localization.json');

    const names = useMemo(() => {
        const out = new Map<string, string>();
        for (const v of Object.values(spriteMapping?.pets?.mapping ?? {})) {
            out.set(`${v.rarity}-${v.id}`, v.name);
        }
        for (const row of Object.values(petLibrary ?? {})) {
            if (row?.PetId && row.Name) {
                out.set(`${row.PetId.Rarity}-${row.PetId.Id}`, row.Name);
            }
        }
        for (const [key, langs] of Object.entries(localization?.pets ?? {})) {
            const m = key.match(/^(.+)_(\d+)$/);
            if (m && langs?.en) out.set(`${m[1]}-${m[2]}`, langs.en);
        }
        return out;
    }, [petLibrary, spriteMapping, localization]);

    return useCallback(
        (rarity: string, id: number): string => names.get(`${rarity}-${id}`) ?? `${rarity} Pet #${id}`,
        [names]
    );
}
