const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/../../../public/forge-seed-lab/predictor-worker.js', 'utf8');
const context = vm.createContext({ structuredClone, performance, setTimeout, postMessage() {} });
vm.runInContext(source + '\nglobalThis.api={locateForges,futureSequence,makeJob};', context);
const api = context.api;
const fixture = JSON.parse(fs.readFileSync(__dirname + '/../example.json'));
const model = { version: 'legacy211', ascension: 0 };

function observationsFrom(rows) {
    return rows.map(r => ({ age: r.age, type: r.type, idx: '', stats: r.variants[0].stats.map(s => ({ k: s.k, percent: s.percent.toFixed(2) })) }));
}

(async () => {
    const recent = await api.locateForges({ model, forgeLevel: fixture.forgeLevel, observations: fixture.observations.slice(7), fromSeed: '30', limit: 100 });
    assert.equal(recent.matches.length, 1);
    assert.equal(recent.located.offset, 19);
    assert.equal(recent.located.startSeed, '49');
    assert.equal(recent.located.next.seed, '52');

    const job = api.makeJob({ model, level: fixture.forgeLevel, observations: fixture.observations });
    const future = api.futureSequence('42', job, 2600);
    const rows = Array.from({ length: 2600 }, () => future.next());
    const later = observationsFrom(rows.slice(2500, 2503)).filter(o => o.stats.length);
    assert.ok(later.length === 3, 'fixture future rolls need substats');
    const started = performance.now();
    const found = await api.locateForges({ model, forgeLevel: fixture.forgeLevel, observations: later, fromSeed: '52', limit: 1000000 });
    assert.equal(found.matches.length, 1);
    assert.equal(found.located.offset, 2500);
    assert.equal(found.located.next.seed, String(52 + 2503));

    const none = await api.locateForges({ model, forgeLevel: fixture.forgeLevel, observations: later, fromSeed: '52', limit: 100 });
    assert.equal(none.matches.length, 0);
    console.log('PASS: locate recent forges after a saved seed, 2,500 forges later in 1M-forge window', Math.round(performance.now() - started), 'ms');
})().catch(e => { console.error(e); process.exitCode = 1; });
