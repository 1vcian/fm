import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appModel } from './app-model.mts';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const version of Object.keys(data).filter(v => v !== 'legacy211')) {
    const model = appModel(version);
    if (!model) throw Error(`Cannot build ${version} from public/parsed_configs`);
    data[version] = model;
}
fs.writeFileSync(file, JSON.stringify(data));
console.log('Updated model-data.json from public/parsed_configs');
