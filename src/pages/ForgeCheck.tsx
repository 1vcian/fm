import { useEffect, useMemo, useState } from 'react';
import { Check, Filter, Minus, Plus, Scale, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import type { ItemSlot, UserProfile } from '../types/Profile';
import { AGES } from '../utils/constants';
import { getItemImage, getItemName } from '../utils/itemAssets';
import { SLOT_TO_JSON_TYPE } from '../utils/itemCalculations';
import { STAT_NAMES } from '../utils/statNames';
import { calculateStats } from '../utils/statEngine';
import { useGameDataContext } from '../context/GameDataContext';
import {
    filterGuide, forgeVerdict, itemIdxsFor, ITEM_SLOTS, NOISE, sameItem, savedAfterSwap, substatCountForAge, substatDefs,
    VERDICT_LABEL, withItem, withoutSubstats, type ItemSlotKey,
} from '../upgrades/forge';
import { MODE_NAMES, pricedStats, withSubstat, type RankMode } from '../upgrades/ranking';
import { FocusChips, focusSum, Gain, useFocus, Waiting } from '../upgrades/ui';
import { scoreProfile, useBuildLab, wasStopped, type BuildLab } from '../upgrades/useBuildLab';

type Scores = Record<RankMode, number>;

const SLOT_LABEL: Record<ItemSlotKey, string> = {
    Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Body', Gloves: 'Gloves', Belt: 'Belt', Necklace: 'Necklace', Ring: 'Ring', Shoe: 'Shoes',
};
const statLabel = (id: string) => STAT_NAMES[id] ?? id.replace(/([a-z])([A-Z])/g, '$1 $2');
const subsText = (subs: { statId: string; value: number }[] | undefined) => (subs ?? []).map(s => `${statLabel(s.statId)} ${+s.value.toFixed(2)}%`).join(', ');
const minus = (a: Scores, b: Scores) => Object.fromEntries(Object.keys(a).map(m => [m, a[m as RankMode] - b[m as RankMode]])) as Scores;

const Card = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <section className="bg-bg-input/40 rounded-xl p-4 border border-border min-w-0">
        <h2 className="flex items-center gap-2 font-bold text-text-primary mb-3">{icon}{title}</h2>
        {children}
    </section>
);

export default function ForgeCheck() {
    const lab = useBuildLab();
    const [focus, setFocus] = useFocus();
    const [zero, setZero] = useState<Scores | null>(null);
    // The form trims an item to its age's substats, so it must not open before this is here.
    const { data: unlockLib } = useGameData<any>('SecondaryStatItemUnlockLibrary.json');
    const { pool, profile } = lab;
    useEffect(() => {
        setZero(null);
        if (!pool) return;
        let live = true;
        scoreProfile(lab, profile).then(s => { if (live) setZero(s); }).catch(e => { if (!wasStopped(e)) toast.error(e.message); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pool, profile]);

    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            <header>
                <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ icon: 'Anvil' }} size={28} /> Forge Check</h1>
                <p className="text-sm text-text-secondary mt-1">Should you equip what the forge just gave you, and what to keep an eye out for. Values are the score from Upgrade Ranking: +1 means one battle's worth of progress.</p>
            </header>
            <FocusChips focus={focus} onChange={setFocus} />
            {lab.failed && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{lab.failed}</div>}
            {!zero || !unlockLib ? <Waiting label="Simulating your current build…" /> : (
                <div className="grid gap-4 lg:grid-cols-2">
                    <DropChecker lab={lab} zero={zero} focus={focus} unlockLib={unlockLib} />
                    <Guide lab={lab} zero={zero} focus={focus} />
                </div>
            )}
        </div>
    );
}

function DropChecker({ lab, zero, focus, unlockLib }: { lab: BuildLab; zero: Scores; focus: RankMode[]; unlockLib: any }) {
    const { profile: realProfile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const stat = lab.libs as any;
    const defs = useMemo(() => substatDefs(stat.secondaryStatLibrary), [stat.secondaryStatLibrary]);

    const [slot, setSlot] = useState<ItemSlotKey>('Weapon');
    const current = lab.profile.items[slot];
    const [age, setAge] = useState(current?.age ?? 0);
    const [idx, setIdx] = useState(current?.idx ?? 0);
    const [level, setLevel] = useState(current?.level ?? 1);
    const [subs, setSubs] = useState<{ statId: string; value: number }[]>(current?.secondaryStats?.map(s => ({ ...s })) ?? []);
    const [res, setRes] = useState<Scores | null>(null);
    const [stats, setStats] = useState<ReturnType<typeof pricedStats> | null>(null);
    const [busy, setBusy] = useState(false);

    const pickSlot = (s: ItemSlotKey) => {
        const cur = lab.profile.items[s];
        setSlot(s); setAge(cur?.age ?? 0); setIdx(cur?.idx ?? 0); setLevel(cur?.level ?? 1);
        setSubs(cur?.secondaryStats?.map(x => ({ ...x })) ?? []); setRes(null);
    };

    const idxs = useMemo(() => itemIdxsFor(stat.itemBalancingLibrary, age, slot), [stat.itemBalancingLibrary, age, slot]);
    useEffect(() => { if (idxs.length && !idxs.includes(idx)) setIdx(idxs[0]); }, [idxs, idx]);

    const nSubs = substatCountForAge(age, unlockLib);
    useEffect(() => {
        setSubs(s => {
            if (s.length > nSubs) return s.slice(0, nSubs);
            if (s.length === nSubs) return s;
            const fill = defs.filter(d => !s.some(x => x.statId === d.id)).slice(0, nSubs - s.length);
            return [...s, ...fill.map(d => ({ statId: d.id, value: +((d.min + d.max) / 2).toFixed(1) }))];
        });
    }, [nSubs, defs, subs.length]);

    const candidate: ItemSlot = useMemo(
        () => ({ age, idx, level: Math.max(1, level || 1), rarity: current?.rarity ?? 'Common', secondaryStats: subs.slice(0, nSubs) }),
        [age, idx, level, subs, nSubs, current?.rarity],
    );
    const same = !!current && sameItem(current, candidate);

    useEffect(() => {
        setRes(null);
        if (same) { setBusy(false); return; }
        let live = true;
        setBusy(true);
        const t = setTimeout(() => {
            const p = withItem(lab.profile, slot, candidate);
            setStats(pricedStats(calculateStats(p, lab.libs)));
            scoreProfile(lab, p).then(s => { if (live) { setRes(s); setBusy(false); } }).catch(e => { if (!wasStopped(e)) toast.error(e.message); });
        }, 350);
        return () => { live = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidate, slot, same, lab.pool]);

    const deltas = res ? minus(res, zero) : null;
    const gain = deltas ? focusSum(deltas, focus) : 0;
    const { verdict, canEquip, recommended } = forgeVerdict(gain, deltas ? focus.map(m => deltas[m]) : []);
    const base = pricedStats(lab.base!.stats);

    const equip = () => {
        const worn = realProfile.items[slot];
        updateNestedProfile('items', { [slot]: { ...candidate, skin: worn?.skin } });
        updateNestedProfile('savedItems', { [slot]: savedAfterSwap(realProfile.savedItems?.[slot] ?? [], worn) });
        toast.success(`Equipped. The old ${SLOT_LABEL[slot].toLowerCase()} was kept in saved items.`);
    };

    const name = (a: number, i: number) => getItemName(AGES[a], SLOT_TO_JSON_TYPE[slot], i, autoMapping) ?? `Item #${i}`;
    return (
        <Card title="Check a drop" icon={<Scale className="w-5 h-5 text-accent-primary" />}>
            <div className="space-y-3">
                <div className="grid grid-cols-4 gap-1.5">
                    {ITEM_SLOTS.map(s => (
                        <button key={s} onClick={() => pickSlot(s)} aria-pressed={s === slot}
                            className={cn('px-2 py-1.5 rounded-lg text-xs border', s === slot ? 'border-accent-primary/60 bg-accent-primary/10 text-text-primary' : 'border-border text-text-secondary')}>
                            {SLOT_LABEL[s]}
                        </button>
                    ))}
                </div>
                <div className="text-xs text-text-muted">
                    Equipped: <span className="text-text-secondary">{current ? `${name(current.age, current.idx)}, ${AGES[current.age]}, level ${current.level}${current.secondaryStats?.length ? `, ${subsText(current.secondaryStats)}` : ''}` : 'nothing'}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-text-muted space-y-1">
                        <span>Age</span>
                        <select value={age} onChange={e => setAge(+e.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary">
                            {AGES.map((a, i) => <option key={a} value={i}>{a}</option>)}
                        </select>
                    </label>
                    <label className="text-xs text-text-muted space-y-1">
                        <span>Level</span>
                        <div className="flex items-center gap-1">
                            <button aria-label="One level less" onClick={() => setLevel(l => Math.max(1, l - 1))} className="p-2 rounded-lg bg-bg-input border border-border text-text-secondary"><Minus className="w-3.5 h-3.5" /></button>
                            <input aria-label="Level" type="number" inputMode="numeric" min={1} value={level} onChange={e => setLevel(parseInt(e.target.value, 10) || 1)} className="w-full min-w-0 bg-bg-input border border-border rounded-lg px-2 py-1.5 text-sm text-center text-text-primary" />
                            <button aria-label="One level more" onClick={() => setLevel(l => l + 1)} className="p-2 rounded-lg bg-bg-input border border-border text-text-secondary"><Plus className="w-3.5 h-3.5" /></button>
                        </div>
                    </label>
                </div>
                {idxs.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                        {idxs.map(i => {
                            const img = getItemImage(AGES[age], SLOT_TO_JSON_TYPE[slot], i, autoMapping, selectedVersion);
                            return (
                                <button key={i} title={name(age, i)} aria-pressed={i === idx} onClick={() => setIdx(i)} className={cn('w-12 h-12 rounded-lg border p-1 bg-bg-input', i === idx ? 'border-accent-primary' : 'border-border opacity-70')}>
                                    {img ? <img src={img} alt={name(age, i)} className="w-full h-full object-contain" /> : <span className="text-[10px] text-text-muted">#{i}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
                {subs.slice(0, nSubs).map((s, i) => {
                    const def = defs.find(d => d.id === s.statId);
                    return (
                        <div key={i} className="flex items-center gap-2">
                            <select aria-label={`Substat ${i + 1}`} value={s.statId} onChange={e => setSubs(prev => prev.map((x, j) => (j === i ? { ...x, statId: e.target.value } : x)))} className="flex-1 min-w-0 bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary">
                                {defs.map(d => <option key={d.id} value={d.id}>{statLabel(d.id)}</option>)}
                            </select>
                            <input aria-label={`Substat ${i + 1} value`} type="number" inputMode="decimal" step="0.1" value={s.value} onChange={e => setSubs(prev => prev.map((x, j) => (j === i ? { ...x, value: parseFloat(e.target.value) || 0 } : x)))} className="w-20 bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-right text-text-primary" />
                            <span className="text-[10px] text-text-muted w-16">{def ? `${def.min}-${def.max}%` : ''}</span>
                        </div>
                    );
                })}
                {nSubs === 0 && <div className="text-xs text-text-muted">{AGES[age]} items have no substats.</div>}

                <div className="rounded-xl border border-border p-3 min-h-[92px]">
                    {same ? <div className="text-sm text-text-muted">This is the item you have equipped. Change the fields to describe the new drop.</div>
                        : busy || !deltas ? <Waiting label="Simulating…" /> : (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className={cn('flex items-center gap-2 font-semibold', { mixed: 'text-amber-300', equip: 'text-green-400', keep: 'text-red-400', same: 'text-text-secondary' }[verdict])}>
                                        {verdict === 'mixed' ? <Scale className="w-5 h-5" /> : verdict === 'equip' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                                        {VERDICT_LABEL[verdict]}
                                    </div>
                                    <Gain value={gain} noise={NOISE} className="text-lg font-bold" />
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                                    {focus.map(m => <span key={m}>{MODE_NAMES[m]} <Gain value={deltas[m]} noise={NOISE} /></span>)}
                                </div>
                                {stats && (
                                    <div className="flex flex-wrap gap-x-4 text-[11px] text-text-muted">
                                        <span>DPS {pct(base.dps, stats.dps)}</span>
                                        <span>Effective health {pct(base.health, stats.health)}</span>
                                    </div>
                                )}
                                {canEquip && (
                                    <button onClick={equip} className={cn('w-full py-2 rounded-lg text-sm font-semibold', recommended ? 'bg-accent-primary/90 text-white' : 'border border-amber-400/40 bg-amber-400/10 text-amber-200')}>
                                        Equip in my profile
                                    </button>
                                )}
                            </div>
                        )}
                </div>
            </div>
        </Card>
    );
}

const pct = (a: number, b: number) => `${b >= a ? '+' : ''}${(a ? ((b - a) / a) * 100 : 0).toFixed(1)}%`;

/** What every substat, every worn substat and every age step is worth, as builds to measure. */
function guideProbes(profile: UserProfile, defs: ReturnType<typeof substatDefs>) {
    const probes: { key: string; profile: UserProfile }[] = [];
    for (const d of defs) {
        for (const [tag, value] of [['mid', (d.min + d.max) / 2], ['max', d.max]] as const) {
            const p = withSubstat(profile, d.id, value);
            if (p) probes.push({ key: `sub:${d.id}:${tag}`, profile: p });
        }
    }
    for (const s of ITEM_SLOTS) {
        const it = profile.items[s];
        if (it?.secondaryStats?.length) probes.push({ key: `cur:${s}`, profile: withoutSubstats(profile, s) });
        if (it && it.age < AGES.length - 1) probes.push({ key: `age:${s}`, profile: withItem(profile, s, { ...it, age: it.age + 1, idx: 0 }) });
    }
    return probes;
}

function Guide({ lab, zero, focus }: { lab: BuildLab; zero: Scores; focus: RankMode[] }) {
    const defs = useMemo(() => substatDefs((lab.libs as any).secondaryStatLibrary), [lab.libs]);
    const [results, setResults] = useState<Map<string, Scores> | null>(null);
    const [done, setDone] = useState([0, 0]);
    const { profile, pool } = lab;

    useEffect(() => {
        setResults(null);
        if (!pool) return;
        let live = true;
        const probes = guideProbes(profile, defs);
        setDone([0, probes.length]);
        const out = new Map<string, Scores>();
        Promise.all(probes.map(async ({ key, profile: p }) => {
            out.set(key, await scoreProfile(lab, p));
            if (live) setDone([out.size, probes.length]);
        })).then(() => { if (live) setResults(out); }).catch(e => { if (!wasStopped(e)) toast.error(e.message); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pool, profile, defs]);

    const guide = useMemo(() => {
        if (!results) return null;
        const val = (k: string) => { const r = results.get(k); return r ? focusSum(minus(r, zero), focus) : 0; };
        return filterGuide(
            defs.map(def => ({ def, mid: val(`sub:${def.id}:mid`), max: val(`sub:${def.id}:max`) })),
            ITEM_SLOTS.filter(s => results.has(`cur:${s}`)).map(slot => ({ slot, worth: -val(`cur:${slot}`) })),
            ITEM_SLOTS.filter(s => results.has(`age:${s}`)).map(slot => ({ slot, gain: val(`age:${slot}`) })),
        );
    }, [results, defs, zero, focus]);

    const icon = <Filter className="w-5 h-5 text-accent-primary" />;
    if (!guide) return <Card title="What to keep" icon={icon}><Waiting label={`Testing every substat… ${done[0]}/${done[1]}`} /></Card>;

    const keepIds = new Set(guide.keep.map(s => s.def.id));
    const best = guide.subs[0]?.mid || 1;
    return (
        <Card title="What to keep" icon={icon}>
            <div className="space-y-4">
                <ol className="list-decimal list-inside text-sm text-text-secondary space-y-1.5">
                    {guide.ages.length > 0 && (
                        <li><b className="text-text-primary">Age first.</b> The same item one age higher is worth <Gain value={guide.ages[guide.ages.length - 1].gain} noise={NOISE} /> to <Gain value={guide.ages[0].gain} noise={NOISE} /> depending on the slot{guide.ageBeatsSubs ? ', which beats any substat roll' : ''}.</li>
                    )}
                    <li><b className="text-text-primary">Then substats.</b> {guide.keep.length
                        ? <>Within the same age, keep drops with {guide.keep.slice(0, 4).map(s => statLabel(s.def.id)).join(', ')}.</>
                        : <>None beats what you already carry, so go by age and level.</>}</li>
                    {guide.weakest && (
                        <li><b className="text-text-primary">Replace your weakest first.</b> {subsText(profile.items[guide.weakest.slot]?.secondaryStats)} on your {SLOT_LABEL[guide.weakest.slot].toLowerCase()} is worth <Gain value={guide.weakest.worth} noise={NOISE} />.</li>
                    )}
                </ol>
                <div>
                    <div className="flex justify-between text-xs text-text-muted mb-1"><span>A new substat on your build</span><span>average roll, best roll</span></div>
                    <ul className="space-y-1">
                        {guide.subs.map(({ def, mid, max }) => (
                            <li key={def.id} className="flex items-center gap-2 text-sm">
                                <span className={cn('w-28 shrink-0 truncate', keepIds.has(def.id) ? 'text-text-primary' : 'text-text-muted')}>{statLabel(def.id)}</span>
                                <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden"><div className="h-full rounded-full bg-accent-primary/70" style={{ width: `${Math.max(0, Math.min(100, (mid / best) * 100))}%` }} /></div>
                                <Gain value={mid} noise={NOISE} className="w-12 text-right text-xs" />
                                <Gain value={max} noise={NOISE} className="w-12 text-right text-xs" />
                            </li>
                        ))}
                    </ul>
                </div>
                {guide.carried.length > 0 && (
                    <div>
                        <div className="text-xs text-text-muted mb-1">What your current substats are worth</div>
                        <ul className="space-y-1 text-sm">
                            {guide.carried.map(({ slot, worth }) => (
                                <li key={slot} className="flex justify-between gap-2"><span className="text-text-secondary truncate">{SLOT_LABEL[slot]}: {subsText(profile.items[slot]?.secondaryStats)}</span><Gain value={worth} noise={NOISE} className="text-xs" /></li>
                            ))}
                        </ul>
                    </div>
                )}
                <p className="text-[11px] text-text-muted">Under ±{NOISE} is noise.</p>
            </div>
        </Card>
    );
}

