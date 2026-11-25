import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const read = file => readFileSync(path.join(directory, file), 'utf8');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
let html = read('template.html').replace('@@LAYOUT_CSS@@', () => read('layout.css'));
for (const [key, name] of Object.entries({ ANVIL: 'Anvil.png', AUTO: 'AutoForge.png', UNDERWORLD: 'UnderworldBackground.png' })) {
    html = html.replaceAll(`@@${key}@@`, `data:image/png;base64,${readFileSync(path.join(directory, 'assets', name)).toString('base64')}`);
}
for (const [key, name] of Object.entries({ ENGINE: 'engine.js', CORE: 'lab-core.js', WORKER: 'worker.js', LEVELS: 'levels.js', SOLVER: 'vendor/solver-runtime.js', TARGET: 'target-core.js', SCANNER: 'scan-worker.js', HAMMER: 'hammer-model.js', APP: 'app.js' })) {
    let content = read(name);
    if (key === 'ENGINE') content = content.split('\nconst MODEL_CONFIGS=')[0] + '\n' + read('model-runtime.js').replace('@@MODEL_DATA@@', () => read('model-data.json')) + '\napplyModel({version:"legacy211",ascension:0});\n';
    if (key === 'APP') content = content.replace('/* FUTURE_UI */', () => read('future-ui.js')).replace('/* INPUT_UI */', () => read('input-ui.js')).replace('/* AUTO_UI */', () => read('auto-ui.js')).replace('/* HAMMER_UI */', () => read('hammer-ui.js')).replace('/* LAYOUT_UI */', () => read('layout-ui.js'));
    if (content.toLowerCase().includes('</script')) throw Error(`Unsafe embedded script: ${name}`);
    html = html.replaceAll(`@@${key}@@`, () => content);
}
html = html.replaceAll('@@LICENSE@@', () => escape(readFileSync(path.join(root, 'LICENSE'), 'utf8')));
html = html.replaceAll('@@SOLVER_LICENSE@@', () => escape(read('vendor/solver-LICENSE.txt')));
if (html.includes('@@')) throw Error('Unresolved template placeholder');
const output = path.join(root, 'public/forge-seed-lab');
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'index.html'), html);
console.log('Built public/forge-seed-lab/index.html');
