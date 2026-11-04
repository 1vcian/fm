import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, Play, Square } from 'lucide-react';
import { BattleVisualizerModal } from '../Battle/BattleVisualizerModal';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useStatLibraries } from '../../hooks/useGlobalStats';
import { calculateStats } from '../../utils/statEngine';
import { fighterFromProfile, type PvpFighter } from '../../pvp/fighter';
import { PvpBattle, pvpConfigFromJson } from '../../pvp/simulate';
import { runSeed } from '../../engine/rng';
import { getStatName } from '../../utils/statNames';
import { substatCounts } from '../../presets/presetList';
import type { UserProfile } from '../../types/Profile';
import { cn } from '../../lib/utils';

/** A build that can enter the duel. */
export interface DuelEntry {
    key: string;
    name: string;
    /** Shown under the name in the picker: where it comes from. */
    group: string;
    /** Place in the tournament, when it has one. */
    rank?: number;
    profile: UserProfile;
    /** The same build with each attack animation it can have, the published one first. */
    variants?: { key: string; name: string; profile: UserProfile }[];
}

/** The fighting profile of an entry with one of its variants (the published one by default). */
const variantOf = (e: DuelEntry, v: string | undefined) => e.variants?.find(x => x.key === v) ?? e.variants?.[0] ?? { key: '', name: '', profile: e.profile };

const PER_SIDE = [50, 100, 250];
/** Battles run between two paints, so the page stays responsive. */
const CHUNK = 10;

interface Fight {
    /** The seed index: runSeed(k), the same seeds the preset tournament uses. */
    k: number;
    aIsP1: boolean;
    winner: 'a' | 'b' | 'draw';
    seconds: number;
    timedOut: boolean;
    aHp: number;
    bHp: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const substatLine = (p: UserProfile) => substatCounts(p).map(([id, n]) => `${n} ${getStatName(id)}`).join(', ') || 'no substats';

/**
 * Two builds against each other with the game's arena rules: your active profile or any preset
 * build of the page. Each fights the same number of battles on each side (Player 1 acts first in
 * a step), on the same seeds as the tournament, and any battle can be watched in the viewer.
 */
export function BuildDuel({ presets, extra = [], request }: {
    presets: DuelEntry[];
    /** More builds for the pickers, listed first (e.g. the profile as it fought in Fight against). */
    extra?: DuelEntry[];
    /** Set both sides and fight at once; a new `id` repeats it. */
    request?: { a: string; b: string; id: number } | null;
}) {
    const { profile } = useProfile();
    const { libs, ready } = useStatLibraries();
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const cfg = useMemo(() => pvpConfigFromJson(pvpBaseConfig), [pvpBaseConfig]);

    const entries: DuelEntry[] = useMemo(() => [
        { key: 'profile', name: profile.name || 'Your profile', group: 'Your profile', profile },
        ...extra,
        ...presets,
    ], [profile, extra, presets]);

    const [aKey, setAKey] = useState('profile');
    const [bKey, setBKey] = useState(presets[0]?.key ?? 'profile');
    const [aVar, setAVar] = useState<string | undefined>(undefined);
    const [bVar, setBVar] = useState<string | undefined>(undefined);
    const [perSide, setPerSide] = useState(100);

    /** The entry as it fights: its chosen variant's profile, named with the variant when there are several. */
    const fighting = (e: DuelEntry, v: string | undefined): DuelEntry => {
        const x = variantOf(e, v);
        const name = `${e.rank ? `#${e.rank} ` : ''}${e.name}`;
        return { ...e, name: e.variants && e.variants.length > 1 ? `${name} (${x.name.replace(' (published)', '')})` : name, profile: x.profile };
    };
    const fighter = (e: DuelEntry): PvpFighter => fighterFromProfile(e.name, e.profile, calculateStats(e.profile, libs), libs);

    const [fights, setFights] = useState<Fight[] | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const [ran, setRan] = useState<{ a: DuelEntry; b: DuelEntry; fa: PvpFighter; fb: PvpFighter } | null>(null);
    const stop = useRef(false);
    useEffect(() => () => { stop.current = true; }, []);

    const run = (ea: DuelEntry | undefined = entries.find(e => e.key === aKey), eb: DuelEntry | undefined = entries.find(e => e.key === bKey),
        va: string | undefined = aVar, vb: string | undefined = bVar) => {
        if (!cfg || !ready || !ea || !eb) return;
        const a = fighting(ea, va), b = fighting(eb, vb);
        const fa = fighter(a), fb = fighter(b);
        setRan({ a, b, fa, fb });
        const out: Fight[] = [];
        stop.current = false;
        setFights(null);
        setProgress(0);
        let k = 1;
        const step = () => {
            if (stop.current) { setProgress(null); setFights(out.length ? [...out] : null); return; }
            for (let i = 0; i < CHUNK && k <= perSide; i++, k++) {
                for (const aIsP1 of [true, false]) {
                    const r = new PvpBattle(aIsP1 ? fa : fb, aIsP1 ? fb : fa, cfg, runSeed(k)).run();
                    const aWon = aIsP1 ? r.outcome === 'p1' : r.outcome === 'p2';
                    const bWon = aIsP1 ? r.outcome === 'p2' : r.outcome === 'p1';
                    out.push({
                        k, aIsP1, winner: aWon ? 'a' : bWon ? 'b' : 'draw', seconds: r.seconds, timedOut: r.timedOut,
                        aHp: aIsP1 ? r.p1HpFrac : r.p2HpFrac, bHp: aIsP1 ? r.p2HpFrac : r.p1HpFrac,
                    });
                }
            }
            setProgress((k - 1) / perSide);
            if (k <= perSide) setTimeout(step, 0);
            else { setProgress(null); setFights(out); }
        };
        setTimeout(step, 0);
    };

    const sum = useMemo(() => {
        if (!fights?.length) return null;
        const n = fights.length;
        const count = (f: (x: Fight) => boolean) => fights.filter(f).length;
        const sideRate = (aIsP1: boolean) => {
            const s = fights.filter(x => x.aIsP1 === aIsP1);
            return s.length ? (s.filter(x => x.winner === 'a').length + s.filter(x => x.winner === 'draw').length / 2) / s.length : 0;
        };
        return {
            n, aWins: count(x => x.winner === 'a'), bWins: count(x => x.winner === 'b'), draws: count(x => x.winner === 'draw'),
            timeouts: count(x => x.timedOut), avgSec: fights.reduce((t, x) => t + x.seconds, 0) / n,
            aHp: fights.reduce((t, x) => t + x.aHp, 0) / n, bHp: fights.reduce((t, x) => t + x.bHp, 0) / n,
            asP1: sideRate(true), asP2: sideRate(false),
        };
    }, [fights]);

    const [filter, setFilter] = useState<'all' | 'a' | 'b' | 'draw' | 'close'>('all');
    const listed = useMemo(() => {
        if (!fights) return [];
        const f = filter === 'all' ? fights
            : filter === 'close' ? [...fights].sort((x, y) => Math.abs(x.aHp - x.bHp) - Math.abs(y.aHp - y.bHp))
                : fights.filter(x => x.winner === filter);
        return f.slice(0, 12);
    }, [fights, filter]);

    // A request from Fight against: both sides set, then the fight starts.
    const lastRequest = useRef<number | null>(null);
    useEffect(() => {
        if (!request || request.id === lastRequest.current || !cfg || !ready) return;
        const ra = entries.find(e => e.key === request.a), rb = entries.find(e => e.key === request.b);
        if (!ra || !rb) return;
        lastRequest.current = request.id;
        setAKey(ra.key); setBKey(rb.key); setAVar(undefined); setBVar(undefined); setFilter('all');
        run(ra, rb, undefined, undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [request, entries, cfg, ready]);

    const [watching, setWatching] = useState<Fight | null>(null);
    const watchProp = useMemo(() => {
        if (!watching || !ran || !cfg) return null;
        const p1 = watching.aIsP1 ? ran.fa : ran.fb, p2 = watching.aIsP1 ? ran.fb : ran.fa;
        return { p1, p2, cfg, seed: watching.k, battleSeed: runSeed(watching.k) };
    }, [watching, ran, cfg]);

    const picker = (value: string, set: (k: string) => void, variant: string | undefined, setVariant: (v: string | undefined) => void, label: string, side: 'a' | 'b') => (
        <BuildPicker entries={entries} value={value} variant={variant} label={label} side={side}
            onPick={k => { set(k); setVariant(undefined); setFights(null); }}
            onVariant={v => { setVariant(v); setFights(null); }} />
    );

    return (
        <div className="space-y-3" data-testid="presets-duel">
            <div className="text-xs text-text-secondary">Two builds against each other: arena battles with the game's PvP rules, on the same seeds and sides as the tournament. Pick any battle to watch it.</div>

            <div className="flex flex-wrap gap-3 items-start">
                {picker(aKey, setAKey, aVar, setAVar, 'Build A', 'a')}
                <span className="self-center text-xs font-black text-text-muted">vs</span>
                {picker(bKey, setBKey, bVar, setBVar, 'Build B', 'b')}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {PER_SIDE.map(n => (
                    <button key={n} onClick={() => { setPerSide(n); setFights(null); }}
                        className={cn('px-2.5 py-1.5 rounded-lg text-xs border', perSide === n ? 'border-accent-primary text-accent-primary' : 'border-border text-text-muted')}>
                        {2 * n} battles
                    </button>
                ))}
                {progress === null ? (
                    <button onClick={() => run()} disabled={!cfg || !ready}
                        className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-primary text-white font-bold text-xs disabled:opacity-40">
                        <Play className="w-3.5 h-3.5" /> Fight
                    </button>
                ) : (
                    <button onClick={() => { stop.current = true; }} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-text-secondary text-xs font-bold">
                        <Square className="w-3.5 h-3.5" /> Stop ({Math.round(progress * 100)}%)
                    </button>
                )}
            </div>

            {sum && ran && (
                <div className="space-y-2">
                    <div className="flex h-3 rounded-full overflow-hidden bg-bg-input">
                        <div className="bg-blue-500" style={{ width: `${(sum.aWins / sum.n) * 100}%` }} />
                        <div className="bg-gray-500" style={{ width: `${(sum.draws / sum.n) * 100}%` }} />
                        <div className="bg-red-500" style={{ width: `${(sum.bWins / sum.n) * 100}%` }} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {[
                            [`${ran.a.name} wins`, pct(sum.aWins / sum.n), 'text-blue-300'],
                            [`${ran.b.name} wins`, pct(sum.bWins / sum.n), 'text-red-300'],
                            ['Draws', pct(sum.draws / sum.n), ''],
                            ['Decided on time', pct(sum.timeouts / sum.n), ''],
                            [`A as Player 1 / 2`, `${pct(sum.asP1)} / ${pct(sum.asP2)}`, 'text-blue-300'],
                            ['Average length', `${sum.avgSec.toFixed(1)} s`, ''],
                            ['A HP left', pct(sum.aHp), 'text-blue-300'],
                            ['B HP left', pct(sum.bHp), 'text-red-300'],
                        ].map(([l, v, c]) => (
                            <div key={l} className="rounded-lg bg-bg-input/50 border border-border p-2 min-w-0">
                                <div className="text-[10px] uppercase text-text-muted truncate" title={l}>{l}</div>
                                <div className={cn('font-black font-mono text-sm', c)}>{v}</div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-text-muted mr-1">Battles to watch:</span>
                        {([['all', 'All'], ['a', 'A won'], ['b', 'B won'], ['draw', 'Draws'], ['close', 'Closest']] as const).map(([k, l]) => (
                            <button key={k} onClick={() => setFilter(k)}
                                className={cn('px-2 py-1 rounded-lg border', filter === k ? 'border-accent-primary text-accent-primary' : 'border-border text-text-muted')}>{l}</button>
                        ))}
                    </div>
                    <div className="divide-y divide-white/5 border border-white/5 rounded-lg text-[11px] font-mono">
                        {listed.length === 0 && <div className="p-2 text-text-muted font-sans">No battle of this kind.</div>}
                        {listed.map(f => (
                            <div key={`${f.k}-${f.aIsP1}`} className="flex items-center gap-2 px-2 py-1.5">
                                <span className="w-16 text-text-muted">#{f.k} {f.aIsP1 ? 'A P1' : 'B P1'}</span>
                                <span className={cn('w-16 font-sans font-bold', f.winner === 'a' ? 'text-blue-300' : f.winner === 'b' ? 'text-red-300' : 'text-text-muted')}>
                                    {f.winner === 'a' ? 'A won' : f.winner === 'b' ? 'B won' : 'draw'}
                                </span>
                                <span className="flex-1 min-w-0 truncate text-text-secondary">{f.seconds.toFixed(1)} s{f.timedOut ? ' (time)' : ''}, HP A {pct(f.aHp)} B {pct(f.bHp)}</span>
                                <button onClick={() => setWatching(f)} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-accent-primary/60 text-accent-primary font-sans font-bold hover:bg-accent-primary/15">
                                    <Eye className="w-3 h-3" /> Watch
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}


            {watching && watchProp && ran && (
                <BattleVisualizerModal
                    isOpen
                    onClose={() => setWatching(null)}
                    playerStats={(watching.aIsP1 ? ran.fa : ran.fb).stats}
                    profile={(watching.aIsP1 ? ran.a : ran.b).profile}
                    libs={libs as never}
                    ageIdx={0}
                    battleIdx={0}
                    difficultyMode={0}
                    pvp={watchProp}
                />
            )}
        </div>
    );
}

const SIDE = {
    a: { text: 'text-blue-300', ring: 'border-blue-400/50 hover:border-blue-400', soft: 'bg-blue-500/10', chip: 'border-blue-400 bg-blue-500/20 text-blue-100' },
    b: { text: 'text-red-300', ring: 'border-red-400/50 hover:border-red-400', soft: 'bg-red-500/10', chip: 'border-red-400 bg-red-500/20 text-red-100' },
};
const RANK_BADGE = ['bg-gradient-to-b from-amber-200 to-amber-500 text-black', 'bg-gradient-to-b from-white to-slate-400 text-black', 'bg-gradient-to-b from-orange-300 to-orange-700 text-black'];

function RankBadge({ rank }: { rank?: number }) {
    return (
        <span className={cn('shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded-full text-[10px] font-black',
            rank ? RANK_BADGE[rank - 1] ?? 'bg-black/40 text-text-secondary' : 'bg-accent-primary/20 text-accent-primary')}>
            {rank ? `#${rank}` : 'You'}
        </span>
    );
}

/**
 * One side's build: a button with the build's place, name and substats that opens the list (the
 * player's builds first, then the tournament in order), and below it the attack skins the build
 * can fight with, as chips.
 */
function BuildPicker({ entries, value, variant, label, side, onPick, onVariant }: {
    entries: DuelEntry[]; value: string; variant: string | undefined; label: string; side: 'a' | 'b';
    onPick: (key: string) => void; onVariant: (v: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', down);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
    }, [open]);
    const cur = entries.find(e => e.key === value) ?? entries[0];
    const shown = cur ? variantOf(cur, variant) : null;
    const tone = SIDE[side];
    const groups = [...new Set(entries.map(e => e.group))];
    return (
        <div ref={box} className="relative flex-1 min-w-[240px] space-y-1.5">
            <span className={cn('text-[10px] font-black uppercase', tone.text)}>{label}</span>
            <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
                className={cn('w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors', tone.ring, tone.soft)}>
                {cur && <RankBadge rank={cur.rank} />}
                <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-text-primary truncate">{cur?.name}</span>
                    {shown && <span className="block text-[10px] text-text-muted truncate">{substatLine(shown.profile)}{shown.profile.misc.fairy?.name ? `, ${shown.profile.misc.fairy.name}` : ''}</span>}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-text-muted shrink-0 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div role="listbox" aria-label={label} className="absolute z-40 left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-bg-secondary shadow-2xl p-1">
                    {groups.map(g => (
                        <div key={g}>
                            <div className="px-2 pt-2 pb-1 text-[10px] font-black uppercase text-text-muted">{g}</div>
                            {entries.filter(e => e.group === g).map(e => {
                                const sel = e.key === cur?.key;
                                return (
                                    <button key={e.key} type="button" role="option" aria-selected={sel} onClick={() => { onPick(e.key); setOpen(false); }}
                                        className={cn('w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]', sel && tone.soft)}>
                                        <RankBadge rank={e.rank} />
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-xs font-semibold text-text-primary truncate">{e.name}</span>
                                            <span className="block text-[10px] text-text-muted truncate">{substatLine(e.profile)}{e.variants && e.variants.length > 1 ? ` · ${e.variants.length} skins` : ''}</span>
                                        </span>
                                        {sel && <Check className={cn('w-4 h-4 shrink-0', tone.text)} />}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
            {cur?.variants && cur.variants.length > 1 && (
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${label} attack skin`}>
                    {cur.variants.map(v => {
                        const on = v.key === shown?.key;
                        return (
                            <button key={v.key} type="button" role="radio" aria-checked={on} onClick={() => onVariant(v.key)} title={v.name}
                                className={cn('max-w-full truncate rounded-full border px-2.5 py-1 text-[10px] font-bold transition-colors',
                                    on ? tone.chip : 'border-border text-text-muted hover:text-text-primary hover:border-white/30')}>
                                {v.name.replace(' (published)', '')}{v.key === 'published' ? ' ★' : ''}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
