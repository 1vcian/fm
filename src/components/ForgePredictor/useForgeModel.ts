import { useMemo } from 'react';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import { buildForgeModel, MODEL_FILES, type ModelFiles } from './buildModel';

export function useForgeModel(): { model: any | null; failed: boolean } {
    const { selectedVersion } = useGameDataContext();
    const results = MODEL_FILES.map(file => useGameData<any>(file));
    const failed = results.some(r => r.error);
    const datas = results.map(r => r.data);
    const model = useMemo(() => {
        const files = Object.fromEntries(MODEL_FILES.map((file, i) => [file, datas[i]])) as ModelFiles;
        return selectedVersion ? buildForgeModel(selectedVersion, files) : null;
    }, [selectedVersion, ...datas]);
    const loaded = results.every(r => r.data || r.error);
    return { model, failed: failed || (loaded && !model) };
}
