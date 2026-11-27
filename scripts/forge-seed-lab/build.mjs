import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const read = file => readFileSync(path.join(directory, file), 'utf8');
const engine = read('engine.js').split('\nconst MODEL_CONFIGS=')[0] + '\n' + read('model-runtime.js').replace('@@MODEL_DATA@@', () => read('model-data.json')) + '\napplyModel({version:"legacy211",ascension:0});\n';
const output = path.join(root, 'public/forge-seed-lab');
mkdirSync(output, { recursive: true });
const hammer = read('hammer-value.js');
writeFileSync(path.join(output, 'predictor-worker.js'), [engine, ...['lab-core.js','worker.js','target-core.js','scan-worker.js','levels.js','hammer-model.js'].map(read), hammer, read('native-worker.js'), read('locate.js')].join('\n'));
writeFileSync(path.join(output, 'predictor-solver.js'), read('vendor/solver-runtime.js'));

writeFileSync(path.join(output, 'solver-license.txt'), read('vendor/solver-LICENSE.txt'));
