import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForgeModel, MODEL_FILES } from '../../src/components/ForgePredictor/buildModel.ts';

const configs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/parsed_configs');

export function appModel(version: string) {
    const read = (file: string) => {
        const own = path.join(configs, version, file);
        const global = path.join(configs, file);
        const found = fs.existsSync(own) ? own : fs.existsSync(global) ? global : null;
        return found ? JSON.parse(fs.readFileSync(found, 'utf8')) : undefined;
    };
    return buildForgeModel(version, Object.fromEntries(MODEL_FILES.map(file => [file, read(file)])));
}
