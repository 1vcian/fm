async function locateForges(data) {
    const input = nativeInput({ model: data.model, forgeLevel: data.forgeLevel, observations: data.observations });
    const job = {
        forgeLevel: Number(input.forgeLevel) - 1,
        observations: input.observations.map(prepareObservation),
        method: 'bonuses',
        model: modelIdentity(),
    };
    if (job.observations.every(o => o.skip)) throw Error('Enter at least one forged item.');
    const limit = integer(Number(data.limit), 1, 100000000, 'Forges to search');
    const from = uint64(data.fromSeed);
    const matches = [];
    let last = performance.now();
    let scanned = 0;
    for (; scanned < limit && matches.length < 20; scanned++) {
        const seed = BigInt.asUintN(64, from + BigInt(scanned));
        if (traceCandidate(seed, job)) matches.push({ offset: scanned, startSeed: String(seed) });
        if (scanned % 4096 === 4095 && performance.now() - last > 200) {
            postMessage({ kind: 'locate-progress', scanned: scanned + 1, limit, matches: matches.length });
            last = performance.now();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    const located = matches.length === 1 ? { ...matches[0], next: nextRoll(matches[0].startSeed, job) } : null;
    return { kind: 'located', job, matches, located, scanned, limit };
}
