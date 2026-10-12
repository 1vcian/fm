import { useMemo } from 'react';
import type { CardRead } from '../../utils/ocr/cardTypes';
import { readProfileCard, buildCardAssets } from '../../utils/ocr/cardReader';
import { buildGameDictionaries } from '../../utils/ocr/gameLocalization';
import { useGameData } from '../../hooks/useGameData';
import { useGameLimits } from '../../hooks/useGameLimits';
import { useGameDataContext } from '../../context/GameDataContext';
import { resolveTextureVersion } from '../../utils/ascensionUtils';

/**
 * The profile card reader with everything it needs loaded: dictionaries, sprite sheets and the
 * game's limits (out-of-range reads come back null). `ready` stays false until all are loaded.
 */
export function useCardReader(): { ready: boolean; read: (file: File) => Promise<CardRead> } {
    const { selectedVersion } = useGameDataContext();
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const limits = useGameLimits();

    return useMemo(() => {
        const ready = !!(autoItemMapping && skillLibrary && spriteMapping && secondaryStatLibrary && limits);
        if (!ready) {
            return { ready: false, read: async () => { throw new Error('The screenshot reader is still loading.'); } };
        }
        const dicts = {
            ...buildGameDictionaries({ autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization }),
            limits,
        };
        const assets = buildCardAssets({
            textureBase: `${import.meta.env.BASE_URL}Texture2D/${resolveTextureVersion(selectedVersion) ?? selectedVersion}/`,
            spriteMapping,
            autoItemMapping,
            skillLibrary,
        });
        return { ready: true, read: (file: File) => readProfileCard(file, dicts, assets) };
    }, [autoItemMapping, skillLibrary, spriteMapping, localization, secondaryStatLibrary, limits, selectedVersion]);
}
