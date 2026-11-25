import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { RandomPCG } from '../../../src/engine/rng.ts';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../engine.js', import.meta.url), 'utf8') + '\nglobalThis.PCG = NativePCG;', context);
const seeds = [0n, 1n, (1n << 64n) - 1n, ...Array.from({ length: 100 }, () => randomBytes(8).readBigUInt64LE())];
for (const seed of seeds) {
    const lab = new context.PCG(seed);
    const helper = new RandomPCG(seed);
    for (let draw = 0; draw < 100; draw++) assert.equal(lab.uint(), helper.nextUInt32());
}
console.log('PASS: 10,300 draws match the Helper combat RNG, including uint64 boundary seeds');
