import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import type { LoadoutCombo } from '../optimizer/buildOptimizer';
import type { MountSlot, PetSlot, UserProfile } from '../types/Profile';
import { MAX_ACTIVE_PETS } from '../utils/constants';
import { calculateStats } from '../utils/statEngine';
import { STAT_NAMES } from '../utils/statNames';
import {
    bareKey, dominatedBy, finalists, judge, KEEP_LINEUPS, mountRoster, petRoster, POOL_MOUNTS, POOL_PETS, poolLoadouts,
    sameLoadout, savedAfterEquip, unitKey, withLoadout, type Kind, type Scores, type Unit, type Verdict,
} from '../upgrades/loadout';
import { estimate, pricedStats, RANK_MODES, type RankMode } from '../upgrades/ranking';
import { FocusChips, focusSum, Gain, useFocus, Waiting } from '../upgrades/ui';
import { scoreProfile, useBuildLab, useRates, wasStopped } from '../upgrades/useBuildLab';

interface Solo {
    pets: Map<string, Scores>;
    mounts: Map<string, Scores>;
    nonePets: Scores;
    noneMount: Scores;
    bare: Map<string, Scores>;
    /** `kind:unitKey` of everything in the top lineups. */
    keep: Set<string>;
}
interface Ranked { combo: LoadoutCombo; scores: Scores; gain: number; current: boolean }

const minus = (a: Scores, b: Scores) => Object.fromEntries(RANK_MODES.map(m => [m, a[m] - b[m]])) as Scores;
const subsText = (x: Unit) => (x.secondaryStats ?? []).map(s => `${STAT_NAMES[s.statId] ?? s.statId} ${+Number(s.value).toFixed(2)}%`).join(', ');

export default function LoadoutSearch() {
    const lab = useBuildLab();
    const { rates, failed } = useRates(lab);
    const { profile: real, updateNestedProfile } = useProfile();
    const [focus, setFocus] = useFocus();
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const [phase, setPhase] = useState<'idle' | 'solo' | 'rank' | 'sim' | 'done'>('idle');
    const [prog, setProg] = useState([0, 0]);
    const [solo, setSolo] = useState<Solo | null>(null);
    const [ranked, setRanked] = useState<Ranked[] | null>(null);
    const [onlySafe, setOnlySafe] = useState(false);
    const live = useRef(0);

    const { profile, pool } = lab;
    useEffect(() => { live.current++; setPhase('idle'); setSolo(null); setRanked(null); }, [pool]);

    const pets = useMemo(() => petRoster(profile), [profile]);
    const mounts = useMemo(() => mountRoster(profile), [profile]);
    const name = (kind: Kind, x: Unit) => {
        for (const v of Object.values<any>(sprites?.[kind]?.mapping ?? {})) if (v.rarity === x.rarity && v.id === x.id) return String(v.name).replace(/([a-z])([A-Z])/g, '$1 $2');
        return `${x.rarity} #${x.id}`;
    };
    const choices = pets.length > MAX_ACTIVE_PETS || mounts.length > 1;

    const run = async () => {
        if (!rates || !pool) return;
        const token = ++live.current;
        const on = () => token === live.current;
        const score = async (items: { key: string; profile: UserProfile }[]) => {
            setProg([0, items.length]);
            const out = new Map<string, Scores>();
            await Promise.all(items.map(async it => { out.set(it.key, await scoreProfile(lab, it.profile)); if (on()) setProg([out.size, items.length]); }));
            return out;
        };
        setRanked(null); setSolo(null);
        try {
            // 1. Every pet and mount through the full sim on its own, next to a bare copy at its
            //    level and at level 1: that tells what the substat and the levels are each worth.
            setPhase('solo');
            const uniq = <T extends Unit>(xs: T[]) => [...new Map(xs.map(x => [unitKey(x), x])).values()];
            const uPets = uniq(pets.map(e => e.item)), uMounts = uniq(mounts.map(e => e.item));
            const bare = new Map<string, UserProfile>();
            const addBare = (kind: Kind, x: Unit, level: number) => {
                const copy = { ...x, level, secondaryStats: [] };
                bare.set(bareKey(kind, x, level), kind === 'pets' ? withLoadout(profile, [copy as PetSlot], profile.mount.active) : withLoadout(profile, null, copy as MountSlot));
            };
            for (const x of uPets) { addBare('pets', x, x.level); addBare('pets', x, 1); }
            for (const x of uMounts) { addBare('mounts', x, x.level); addBare('mounts', x, 1); }
            const s = await score([
                { key: 'none:pets', profile: withLoadout(profile, [], profile.mount.active) },
                { key: 'none:mount', profile: withLoadout(profile, null, null) },
                ...uPets.map(x => ({ key: `pet:${unitKey(x)}`, profile: withLoadout(profile, [x], profile.mount.active) })),
                ...uMounts.map(x => ({ key: `mount:${unitKey(x)}`, profile: withLoadout(profile, null, x) })),
                ...[...bare].map(([key, p]) => ({ key: `bare:${key}`, profile: p })),
            ]);
            if (!on()) return;
            const soloResult: Solo = {
                pets: new Map(uPets.map(x => [unitKey(x), s.get(`pet:${unitKey(x)}`)!])),
                mounts: new Map(uMounts.map(x => [unitKey(x), s.get(`mount:${unitKey(x)}`)!])),
                nonePets: s.get('none:pets')!,
                noneMount: s.get('none:mount')!,
                bare: new Map([...bare.keys()].map(k => [k, s.get(`bare:${k}`)!])),
                keep: new Set(),
            };
            setSolo(soloResult);

            // 2. Every lineup of the strongest ones, priced from its stats.
            setPhase('rank');
            const petVal = (x: PetSlot) => focusSum(minus(soloResult.pets.get(unitKey(x))!, soloResult.nonePets), focus);
            const mountVal = (x: MountSlot) => focusSum(minus(soloResult.mounts.get(unitKey(x))!, soloResult.noneMount), focus);
            const poolPets = [...uPets].sort((a, b) => petVal(b) - petVal(a)).slice(0, POOL_PETS);
            const poolMounts = [...uMounts].sort((a, b) => mountVal(b) - mountVal(a)).slice(0, POOL_MOUNTS);
            const combos = poolLoadouts(profile, poolPets, poolMounts, MAX_ACTIVE_PETS);
            const priced = combos
                .map(combo => ({ combo, est: focusSum(estimate(rates, pricedStats(calculateStats(withLoadout(profile, combo.petSet, combo.mount), lab.libs))).perMode, focus) }))
                .sort((a, b) => b.est - a.est)
                .map(x => x.combo);

            // 3. The full sim for the front-runners and what is worn now.
            setPhase('sim');
            const current: LoadoutCombo = { petSet: profile.pets.active ?? [], mount: profile.mount.active };
            const finals = finalists(priced, poolPets, poolMounts, current, MAX_ACTIVE_PETS);
            const sims = await score(finals.map((c, i) => ({ key: String(i), profile: withLoadout(profile, c.petSet, c.mount) })));
            if (!on()) return;
            const worn = sims.get(String(finals.findIndex(c => sameLoadout(c, current))))!;
            const result = finals
                .map((combo, i) => ({ combo, scores: sims.get(String(i))!, gain: focusSum(minus(sims.get(String(i))!, worn), focus), current: sameLoadout(combo, current) }))
                .sort((a, b) => b.gain - a.gain);
            setRanked(result);
            const keep = new Set<string>();
            for (const r of result.slice(0, KEEP_LINEUPS)) {
                r.combo.petSet.forEach(x => keep.add(`pets:${unitKey(x)}`));
                if (r.combo.mount) keep.add(`mounts:${unitKey(r.combo.mount)}`);
            }
            setSolo({ ...soloResult, keep });
            setPhase('done');
        } catch (e) {
            if (!wasStopped(e)) toast.error(`Search failed: ${(e as Error).message}`);
            if (on()) setPhase('idle');
        }
    };

    const equip = (c: LoadoutCombo) => {
        // Equipping never drops anything: pieces that were only equipped get a saved copy.
        updateNestedProfile('pets', { active: c.petSet.map(x => ({ ...x })), savedBuilds: savedAfterEquip(petRoster(real), real.pets.savedBuilds ?? []) });
        updateNestedProfile('mount', { active: c.mount ? { ...c.mount } : null, savedBuilds: savedAfterEquip(mountRoster(real), real.mount.savedBuilds ?? []) });
        toast.success('Loadout equipped');
    };

    const busy = phase === 'solo' || phase === 'rank' || phase === 'sim';
    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            <header>
                <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ sheet: 'Pets', index: 7 }} size={28} /> Loadout Search</h1>
                <p className="text-sm text-text-secondary mt-1">The pets and mount that get you furthest in the main quest and dungeons, from the ones saved on <Link to="/" className="underline">your profile</Link>. Auto best ranks for the arena and the test dummy; this ranks for the battles you pick below, and marks copies you no longer need.</p>
            </header>
            <FocusChips focus={focus} onChange={setFocus} />
            {failed && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{failed}</div>}
            <div className="grid gap-4 lg:grid-cols-5">
                <section className="lg:col-span-3 bg-bg-input/40 rounded-xl p-4 border border-border min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h2 className="font-bold text-text-primary">Best loadouts</h2>
                        <button onClick={run} disabled={!rates || !choices || busy} className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm font-semibold disabled:opacity-40">{phase === 'done' ? 'Run again' : 'Find best'}</button>
                    </div>
                    {!rates && !failed && <Waiting label="Measuring your build…" />}
                    {rates && !choices && <p className="text-sm text-text-muted">Save more than {MAX_ACTIVE_PETS} pets or more than one mount on your profile to give this something to choose between.</p>}
                    {rates && choices && !ranked && !busy && <p className="text-xs text-text-muted">Each of your {pets.length} pets and {mounts.length} mounts is simulated on its own. Every trio of the best {POOL_PETS} pets with each of the best {POOL_MOUNTS} mounts is then priced from its stats, and the front-runners get the full sim.</p>}
                    {busy && <Waiting label={phase === 'solo' ? `Simulating each pet and mount ${prog[0]}/${prog[1]}…` : phase === 'rank' ? 'Pricing lineups…' : `Simulating finalists ${prog[0]}/${prog[1]}…`} />}
                    {ranked && (
                        <ol className="space-y-2">
                            {ranked.map((r, i) => (
                                <li key={i} className={cn('rounded-lg border p-3', r.current ? 'border-sky-400/30' : i === 0 ? 'border-accent-primary/40' : 'border-border')}>
                                    <div className="flex gap-3">
                                        <span className="w-5 text-xs text-text-muted tabular-nums">{i + 1}</span>
                                        <div className="flex-1 min-w-0 text-xs text-text-secondary space-y-0.5">
                                            {r.combo.petSet.map((x, j) => <div key={j} className="truncate">{name('pets', x)} Lv {x.level} <span className="text-text-muted">{subsText(x)}</span></div>)}
                                            {r.combo.mount && <div className="truncate text-text-muted">Mount: {name('mounts', r.combo.mount)} Lv {r.combo.mount.level} {subsText(r.combo.mount)}</div>}
                                        </div>
                                        {r.current ? <span className="text-xs text-sky-300">current</span> : <Gain value={r.gain} noise={0.02} className="font-semibold" />}
                                    </div>
                                    {!r.current && <div className="flex justify-end mt-1"><button onClick={() => equip(r.combo)} className="px-2 py-1 rounded-md border border-accent-primary/40 text-accent-primary text-xs">Equip</button></div>}
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
                <div className="lg:col-span-2 space-y-4">
                    <RosterPanel kind="pets" entries={pets} slots={MAX_ACTIVE_PETS} solo={solo} name={name} onlySafe={onlySafe} setOnlySafe={setOnlySafe} focus={focus} />
                    <RosterPanel kind="mounts" entries={mounts} slots={1} solo={solo} name={name} onlySafe={onlySafe} setOnlySafe={setOnlySafe} focus={focus} />
                </div>
            </div>
        </div>
    );
}

function RosterPanel({ kind, entries, slots, solo, name, onlySafe, setOnlySafe, focus }: {
    kind: Kind; entries: { item: Unit; active: boolean }[]; slots: number; solo: Solo | null; name: (k: Kind, x: Unit) => string;
    onlySafe: boolean; setOnlySafe: (v: boolean) => void; focus: RankMode[];
}) {
    const list = entries.map(e => e.item);
    const dominated = useMemo(() => dominatedBy(kind, list, slots), [kind, list, slots]);
    const verdictOf = (i: number): Verdict | undefined => {
        if (entries[i].active) return undefined;
        const x = list[i];
        const sim = solo ? judge(x, solo.keep.has(`${kind}:${unitKey(x)}`), (kind === 'pets' ? solo.pets : solo.mounts).get(unitKey(x)), solo.bare.get(bareKey(kind, x)), solo.bare.get(bareKey(kind, x, 1))) : undefined;
        if (sim && !sim.safe && sim.reason === 'in a top lineup') return sim;
        const better = dominated.get(i);
        if (better) return { safe: true, reason: kind === 'pets' ? `${better.length} copies at least as good, and only ${slots} fit` : `${name(kind, list[better[0]])} Lv ${list[better[0]].level} is at least as good` };
        return sim;
    };
    const value = (x: Unit) => {
        if (!solo) return undefined;
        const s = (kind === 'pets' ? solo.pets : solo.mounts).get(unitKey(x));
        return s ? focusSum(minus(s, kind === 'pets' ? solo.nonePets : solo.noneMount), focus) : undefined;
    };
    const order = list.map((_, i) => i);
    if (solo) order.sort((a, b) => (value(list[b]) ?? -Infinity) - (value(list[a]) ?? -Infinity));
    const safe = list.filter((_, i) => verdictOf(i)?.safe).length;
    const shown = onlySafe ? order.filter(i => verdictOf(i)?.safe) : order;
    return (
        <section className="bg-bg-input/40 rounded-xl p-4 border border-border min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="font-bold text-text-primary">{kind === 'pets' ? 'Pets' : 'Mounts'} ({list.length})</h2>
                {safe > 0 && <button onClick={() => setOnlySafe(!onlySafe)} className="text-xs text-amber-300">{safe} safe to merge{onlySafe ? ' (showing)' : ''}</button>}
            </div>
            {list.length === 0 ? <div className="text-sm text-text-muted">None saved yet.</div> : (
                <ul className="space-y-1.5">
                    {shown.map(i => {
                        const x = list[i], v = verdictOf(i), worth = value(x);
                        return (
                            <li key={i} className="rounded-lg border border-border px-2.5 py-1.5">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className={cn('font-medium truncate', `text-rarity-${x.rarity.toLowerCase()}`)}>{name(kind, x)}</span>
                                    <span className="text-xs text-text-muted">Lv {x.level}</span>
                                    {entries[i].active && <span className="text-[10px] px-1.5 rounded bg-green-500/15 text-green-400">equipped</span>}
                                    {v?.safe && <span className="text-[10px] px-1.5 rounded bg-amber-500/15 text-amber-300 whitespace-nowrap">safe to merge</span>}
                                    {worth !== undefined && <Gain value={worth} noise={0.02} className="ml-auto text-xs" />}
                                </div>
                                <div className="text-[11px] text-text-muted truncate">{x.rarity}{subsText(x) && `, ${subsText(x)}`}</div>
                                {v && <div className={cn('text-[10px] truncate', v.safe ? 'text-amber-300/70' : 'text-green-400/70')}>{v.safe ? v.reason : `keep: ${v.reason}`}</div>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

