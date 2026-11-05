import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { useGameDataContext } from '../context/GameDataContext';
import { cn } from '../lib/utils';
import type { BattleTarget } from '../progress/battleWorker';
import { calculateStats } from '../utils/statEngine';
import {
    defaultTarget, deleteSnapshot, eta, exportHistory, importHistory, makeSnapshot, parseBattle, saveSnapshot, trendFor,
    useActualProgress, useSnapshots, type Snapshot,
} from '../upgrades/history';
import { battleName, MODE_NAMES, RANK_MODES, type RankMode } from '../upgrades/ranking';
import { Waiting } from '../upgrades/ui';
import { useBuildLab, type BuildLab } from '../upgrades/useBuildLab';

const SIM = '#3987e5';
const GAME = '#d95926';
const DAY = 86_400_000;
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const formatPower = (n: number) => n >= 1e12 ? `${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);

const Card = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
    <section className="bg-bg-input/40 rounded-xl p-4 border border-border min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 className="font-bold text-text-primary">{title}</h2>{right}</div>
        {children}
    </section>
);

export default function ProgressHistory() {
    const lab = useBuildLab();
    const { selectedVersion } = useGameDataContext();
    const snaps = useSnapshots(lab.profile.id);
    const [actual, setActual] = useActualProgress(lab.profile.id);
    const [note, setNote] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const { lines, frontiers } = lab;

    const save = () => {
        if (!frontiers) return;
        // In-game Power leaves substats out.
        const power = calculateStats(lab.profile, lab.libs, true).power;
        if (saveSnapshot(makeSnapshot(lab.profile, selectedVersion, power, frontiers, actual, note))) {
            setNote('');
            toast.success('Snapshot saved');
        } else toast.error('Browser storage is full');
    };
    const doExport = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([exportHistory(lab.profile.id)], { type: 'application/json' }));
        a.download = `${lab.profile.name}-history-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };
    const doImport = async (f: File) => {
        try {
            const n = importHistory(await f.text(), lab.profile.id);
            toast.success(`Imported ${n} snapshot${n === 1 ? '' : 's'}`);
        } catch (e) { toast.error((e as Error).message); }
    };

    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            <header>
                <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ icon: 'Savegame' }} size={28} /> Progress History</h1>
                <p className="text-sm text-text-secondary mt-1">Snapshots of where your build gets over time, and where your pace puts you next. Snapshots stay in this browser; Export and Import move them.</p>
            </header>
            <div className="flex flex-wrap items-center gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Snapshot note" className="flex-1 min-w-[140px] bg-bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary" />
                <button onClick={save} disabled={!frontiers} className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm font-semibold disabled:opacity-40">Save snapshot</button>
                <button onClick={doExport} disabled={!snaps.length} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary disabled:opacity-40"><Download className="w-3.5 h-3.5" /> Export</button>
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary"><Upload className="w-3.5 h-3.5" /> Import</button>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
            </div>
            {lab.failed && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{lab.failed}</div>}
            {!lines || !frontiers ? <Waiting label="Simulating your current build…" /> : (
                <>
                    <Forecast lab={lab} snaps={snaps} actual={actual} setActual={setActual} />
                    {snaps.length === 0
                        ? <div className="text-center py-10 rounded-xl border border-dashed border-border text-text-muted text-sm px-6">No snapshots yet. Save one after a play session; with two a few hours apart this page charts your progress and forecasts your pace.</div>
                        : <>
                            <Card title="Progress over time" right={<div className="flex gap-3 text-xs text-text-secondary"><span style={{ color: SIM }}>● Sim clears</span><span style={{ color: GAME }}>● In game</span></div>}>
                                {snaps.length < 2 ? <div className="text-sm text-text-muted">Save another snapshot after your next session to see a line.</div> : (
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{RANK_MODES.map(m => <ModeChart key={m} mode={m} snaps={snaps} line={lines[m]} />)}</div>
                                )}
                            </Card>
                            <SnapshotTable snaps={[...snaps].reverse()} lines={lines} />
                        </>}
                </>
            )}
        </div>
    );
}

function Forecast({ lab, snaps, actual, setActual }: { lab: BuildLab; snaps: Snapshot[]; actual: Partial<Record<RankMode, number>>; setActual: (m: RankMode, l: number | null) => void }) {
    const [targets, setTargets] = useState<Partial<Record<RankMode, string>>>({});
    const [drafts, setDrafts] = useState<Partial<Record<RankMode, string>>>({});
    const lines = lab.lines!;
    return (
        <Card title="Forecast">
            <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[640px]">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wider text-text-muted">
                        {['Mode', 'Sim clears', 'In game', 'Pace', 'In 7 days', 'In 30 days', 'Target', 'ETA'].map(h => <th key={h} className="font-medium px-1 pb-2">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                        {RANK_MODES.map(m => {
                            const line = lines[m];
                            const t = trendFor(snaps, m);
                            const done = t?.latest ?? (actual[m] ?? lab.frontiers![m]) + 1;
                            const ahead = (days: number) => t ? battleName(line[Math.min(line.length, Math.round(done + t.perDay * days)) - 1]) : '-';
                            const targetText = targets[m] ?? defaultTarget(done, line);
                            const target = parseBattle(targetText, line);
                            const draft = drafts[m] ?? (actual[m] !== undefined ? battleName(line[actual[m]!]) : '');
                            const badDraft = draft.trim() !== '' && parseBattle(draft, line) < 0;
                            return (
                                <tr key={m}>
                                    <td className="px-1 py-2 text-text-secondary whitespace-nowrap">{MODE_NAMES[m]}</td>
                                    <td className="px-1 py-2 font-semibold text-text-primary whitespace-nowrap">{battleName(line[lab.frontiers![m]])}</td>
                                    <td className="px-1 py-2">
                                        <input aria-label={`${MODE_NAMES[m]} in game`} value={draft} placeholder={m === 'main' ? 'Hard 6-14' : 'level'}
                                            onChange={e => setDrafts(d => ({ ...d, [m]: e.target.value }))}
                                            onBlur={() => { const i = parseBattle(draft, line); if (!draft.trim()) setActual(m, null); else if (i >= 0) setActual(m, i); }}
                                            className={cn('w-24 bg-bg-input border rounded-md px-2 py-1 text-sm text-text-primary', badDraft ? 'border-red-500/60' : 'border-border')} />
                                    </td>
                                    <td className="px-1 py-2 text-text-secondary whitespace-nowrap">{t ? `${t.perDay >= 0 ? '+' : ''}${t.perDay.toFixed(2)}/day` : <span className="text-text-muted">need more data</span>}</td>
                                    <td className="px-1 py-2 text-text-secondary whitespace-nowrap">{ahead(7)}</td>
                                    <td className="px-1 py-2 text-text-secondary whitespace-nowrap">{ahead(30)}</td>
                                    <td className="px-1 py-2">
                                        <input aria-label={`${MODE_NAMES[m]} target`} value={targetText} onChange={e => setTargets(p => ({ ...p, [m]: e.target.value }))} className={cn('w-24 bg-bg-input border rounded-md px-2 py-1 text-sm text-text-primary', target < 0 ? 'border-red-500/60' : 'border-border')} />
                                    </td>
                                    <td className="px-1 py-2 text-text-primary whitespace-nowrap">{t && target >= 0 ? eta(t, target + 1) : '-'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="text-[11px] text-text-muted mt-3">Pace is a straight-line fit over the last 3 weeks of snapshots, from the in-game battles you entered where you have them and the sim's where you don't. Progress slows at each new age, so treat long ETAs as optimistic.</p>
        </Card>
    );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
    const ref = useRef<T>(null);
    const [w, setW] = useState(300);
    useEffect(() => {
        if (!ref.current) return;
        const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
        ro.observe(ref.current);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

function ModeChart({ mode, snaps, line }: { mode: RankMode; snaps: Snapshot[]; line: BattleTarget[] }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);
    const H = 150, pad = { l: 8, r: 8, t: 10, b: 22 };
    const pts = useMemo(() => snaps
        .map(s => ({ s, sim: s.cleared[mode] ?? null, game: s.actual?.[mode] ?? null }))
        .filter(p => p.sim !== null || p.game !== null), [snaps, mode]);
    if (pts.length === 0) return null;

    const t0 = pts[0].s.at, t1 = Math.max(pts[pts.length - 1].s.at, t0 + DAY);
    const vals = pts.flatMap(p => [p.sim, p.game]).filter((v): v is number => v !== null);
    const spread = Math.max(2, Math.max(...vals) - Math.min(...vals));
    const lo = Math.max(0, Math.floor(Math.min(...vals) - spread * 0.15)), hi = Math.ceil(Math.max(...vals) + spread * 0.15);
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (width - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const sim = pts.filter(p => p.sim !== null);
    const hp = hover !== null ? pts[hover] : null;
    const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
        const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
        let best = 0;
        pts.forEach((p, i) => { if (Math.abs(x(p.s.at) - px) < Math.abs(x(pts[best].s.at) - px)) best = i; });
        setHover(best);
    };
    return (
        <div ref={ref} className="relative min-w-0">
            <div className="flex justify-between text-xs mb-1">
                <span className="text-text-secondary">{MODE_NAMES[mode]}</span>
                {sim.length > 0 && <span className="font-semibold text-text-primary">{battleName(line[sim[sim.length - 1].sim!])}</span>}
            </div>
            <svg width={width} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-none" role="img" aria-label={`${MODE_NAMES[mode]} progress over time`}>
                <text x={pad.l} y={H - 6} fontSize={10} fill="#71717a">{new Date(t0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
                <text x={width - pad.r} y={H - 6} fontSize={10} fill="#71717a" textAnchor="end">{new Date(t1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
                {hp && <line x1={x(hp.s.at)} x2={x(hp.s.at)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.25)" />}
                <path d={sim.map((p, i) => `${i ? 'L' : 'M'}${x(p.s.at).toFixed(1)},${y(p.sim!).toFixed(1)}`).join('')} fill="none" stroke={SIM} strokeWidth={2} strokeLinejoin="round" />
                {sim.map((p, i) => <circle key={`s${i}`} cx={x(p.s.at)} cy={y(p.sim!)} r={hp === p ? 5 : 4} fill={SIM} />)}
                {pts.filter(p => p.game !== null).map((p, i) => <circle key={`g${i}`} cx={x(p.s.at)} cy={y(p.game!)} r={hp === p ? 5 : 4} fill={GAME} />)}
            </svg>
            {hp && (
                <div className="absolute z-10 pointer-events-none rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-[11px] shadow-xl" style={{ left: Math.min(Math.max(0, x(hp.s.at) - 60), width - 130), top: 18 }}>
                    <div className="text-text-muted">{when(hp.s.at)}</div>
                    {hp.sim !== null && <div className="text-text-primary">{battleName(line[hp.sim])} sim</div>}
                    {hp.game !== null && <div className="text-text-primary">{battleName(line[hp.game])} in game</div>}
                    {hp.s.note && <div className="text-text-secondary max-w-[160px] truncate">{hp.s.note}</div>}
                </div>
            )}
        </div>
    );
}

function SnapshotTable({ snaps, lines }: { snaps: Snapshot[]; lines: Record<RankMode, BattleTarget[]> }) {
    return (
        <Card title={`Snapshots (${snaps.length})`}>
            <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm min-w-[720px]">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wider text-text-muted">
                        <th className="font-medium px-1 pb-2">When</th>
                        <th className="font-medium px-1 pb-2">Power</th>
                        {RANK_MODES.map(m => <th key={m} className="font-medium px-1 pb-2">{m}</th>)}
                        <th className="font-medium px-1 pb-2">Note</th>
                        <th />
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                        {snaps.map(s => (
                            <tr key={s.id} className="align-top">
                                <td className="px-1 py-2 text-text-secondary whitespace-nowrap">{when(s.at)}</td>
                                <td className="px-1 py-2 text-text-secondary tabular-nums">{formatPower(s.power)}</td>
                                {RANK_MODES.map(m => (
                                    <td key={m} className="px-1 py-2 whitespace-nowrap">
                                        <div className="text-text-primary">{s.cleared[m] !== undefined ? battleName(lines[m][s.cleared[m]!]) : '-'}</div>
                                        {s.actual?.[m] !== undefined && <div className="text-[11px] text-text-muted">game {battleName(lines[m][s.actual[m]!])}</div>}
                                    </td>
                                ))}
                                <td className="px-1 py-2 text-text-muted max-w-[200px] truncate">{s.note ?? ''}</td>
                                <td className="px-1 py-2 text-right"><button onClick={() => deleteSnapshot(s.id)} aria-label="Delete snapshot" className="p-1 rounded text-text-muted hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
