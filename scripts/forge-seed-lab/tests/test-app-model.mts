import fs from 'node:fs';
import assert from 'node:assert/strict';
import { appModel } from '../app-model.mts';

const bundled = JSON.parse(fs.readFileSync(new URL('../model-data.json', import.meta.url), 'utf8'));
const versions = Object.keys(bundled).filter(v => v !== 'legacy211');
for (const version of versions) assert.deepStrictEqual(appModel(version), bundled[version], `${version}: model-data.json differs from public/parsed_configs; run npm run update:forge-seed-lab-data`);
console.log('PASS: bundled tables match the app configs for', versions.join(', '));
