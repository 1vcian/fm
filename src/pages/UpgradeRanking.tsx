import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useBattleSimulation } from '../hooks/useBattleSimulation';
import { useGameData } from '../hooks/useGameData';
import { useTreeModeProfile } from '../hooks/useGlobalStats';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { BattlePool } from '../progress/battlePool';
import { readHint, saveHint, searchFrontier } from '../progress/frontierSearch';
import type { LevelOutcome } from '../progress/adaptive';
import type { BattleTarget } from '../progress/battleWorker';
import { questBattleLabel } from '../presets/mainProgress';
import { calculateStats, type LibraryData } from '../utils/statEngine';
import { cn } from '../lib/utils';
import { upgradeCandidates, type UpgradeCandidate, type UpgradeKind } from '../upgrades/candidates';
import {
    bound, estimate, measureRates, modeLine, MODE_NAMES, pricedStats, RANK_MODES, WINDOW,
    type Estimate, type RankMode, type RateKey, type Rates,
} from '../upgrades/ranking';

/** Where the build gets in a mode: the last battle cleared in order, and the one after it (null: the line is finished). */
interface Reached { cleared: number; next: LevelOutcome | null }

const FOCUS_KEY = 'fm.upgradeFocus';
const KIND_LABEL: Record<UpgradeKind, string> = { tech: 'Tech', pet: 'Pet', mount: 'Mount', skill: 'Skill' };
const SHOWN = 15;

function readFocus(): RankMode[] {
    try {
        const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null');
        const modes = Array.isArray(saved) ? RANK_MODES.filter(m => saved.includes(m)) : [];
        if (modes.length) return modes;
    } catch { /* storage blocked or a bad value: the default */ }
    return RANK_MODES;
}

const battleName = (t: BattleTarget | undefined) => !t ? 'none' : t.mode === 'main' ? questBattleLabel(t) : `Level ${t.level + 1}`;

const formatCost = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

function formatDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const Gain = ({ value, className }: { value: number; className?: string }) => (
    <span className={cn('font-mono tabular-nums', value > 0.0005 ? 'text-green-400' : 'text-text-muted', className)}>
        {value > 0.0005 ? `+${value.toFixed(value < 0.1 ? 3 : 2)}` : '±0'}
    </span>
);

const Waiting = ({ label }: { label: string }) => (
    <span className="inline-flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" />{label}</span>
);

/** Where the build gets, then what each stat is worth there, then every upgrade priced. */
function useRanking() {
    const { libs: battleLibs, isLoading, maxDungeonLevel } = useBattleSimulation();
    const { profile, libs, ready } = useTreeModeProfile();
    const { data: upgradeLib } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const [reached, setReached] = useState<Partial<Record<RankMode, Reached>>>({});
    const [rates, setRates] = useState<Rates | null>(null);
    const [priced, setPriced] = useState<{ c: UpgradeCandidate; est: Estimate }[] | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    const lines = useMemo(() => {
        if (isLoading || !battleLibs.mainBattleLibrary || maxDungeonLevel === null) return null;
        return Object.fromEntries(RANK_MODES.map(m => [m, modeLine(m, battleLibs, maxDungeonLevel)])) as Record<RankMode, BattleTarget[]>;
    }, [battleLibs, isLoading, maxDungeonLevel]);

    useEffect(() => {
        if (!ready || !lines || !upgradeLib || !sprites) return;
        const stats = calculateStats(profile, libs as LibraryData);
        const base = { stats, profile };
        const pool = new BattlePool({ type: 'init', stats, profile, libs: battleLibs });
        let cancelled = false;
        setReached({}); setRates(null); setPriced(null); setFailed(null);

        (async () => {
            const entries = await Promise.all(RANK_MODES.map(async m => {
                const hintMode = m === 'main' ? 'main' : `dungeon-${m}`;
                const line = lines[m];
                const seen = new Map<number, LevelOutcome | null>();
                const frontier = await searchFrontier(line.length, readHint(profile, hintMode), pool.size, i => pool.run(line[i]), {
                    cancelled: () => cancelled, onResult: (i, o) => seen.set(i, o), onEstimate: () => { },
                });
                if (cancelled) return [m, frontier] as const;
                saveHint(profile, hintMode, frontier);
                setReached(s => ({ ...s, [m]: { cleared: frontier, next: seen.get(frontier + 1) ?? null } }));
                return [m, frontier] as const;
            }));
            if (cancelled) return;
            const r = await measureRates(pool, lines, base, Object.fromEntries(entries) as Record<RankMode, number>, libs as LibraryData);
            if (cancelled) return;
            if (!r) { setFailed('Add at least one item to your profile first.'); return; }
            setRates(r);
            setPriced(upgradeCandidates(profile, libs as LibraryData, upgradeLib, sprites)
                .map(c => ({ c, est: estimate(r, pricedStats(calculateStats(c.profile, libs as LibraryData))) })));
        })().catch(e => {
            if (!cancelled && !(e instanceof Error && e.message === 'stopped')) setFailed(String(e?.message ?? e));
        }).finally(() => pool.dispose());
        return () => { cancelled = true; pool.dispose(); };
    }, [profile, libs, ready, lines, battleLibs, upgradeLib, sprites]);

    return { lines, reached, rates, priced, failed };
}

function ModeCard({ mode, score, line }: { mode: RankMode; score: Reached | undefined; line: BattleTarget[] | undefined }) {
    return (
        <div className="bg-bg-input/40 rounded-xl p-3 border border-border min-w-0">
            <div className="text-xs text-text-muted">{MODE_NAMES[mode]}</div>
            {score ? (
                <>
                    <div className="text-lg font-bold text-text-primary tabular-nums">{battleName(line?.[score.cleared])}</div>
                    <div className="text-xs text-text-secondary">
                        {score.next
                            ? <>Next: {Math.round(score.next.winRate * 100)}% wins{score.next.lossProgress !== null && `, ${Math.round(score.next.lossProgress * 100)}% enemy HP on losses`}</>
                            : 'Everything cleared'}
                    </div>
                </>
            ) : <div className="pt-1"><Loader2 className="w-4 h-4 animate-spin text-text-muted" /></div>}
        </div>
    );
}

const BOUND_TEXT: Record<RateKey, { title: string; tip: string }> = {
    dmg: { title: 'damage-bound', tip: 'Damage, Attack Speed, Double Chance and Crit move you the most.' },
    hp: { title: 'survival-bound', tip: 'Health moves you the most; Lifesteal and Regen help too.' },
    heal: { title: 'sustain-bound', tip: 'Lifesteal, Health Regen and healing skills move you the most.' },
};
const RATE_LABEL: Record<RateKey, string> = { dmg: '1% DPS', hp: '1% effective health', heal: '1% healing' };

function Diagnosis({ rates, focus }: { rates: Rates; focus: RankMode[] }) {
    const { sums, top } = bound(rates, focus);
    return (
        <section className="bg-bg-input/40 rounded-xl p-4 border border-border space-y-3">
            <div className="grid grid-cols-3 gap-2">
                {(Object.keys(RATE_LABEL) as RateKey[]).map(k => (
                    <div key={k} className={cn('rounded-lg p-2 border', k === top ? 'border-accent-primary/50 bg-accent-primary/10' : 'border-border')}>
                        <div className="text-[11px] text-text-secondary">{RATE_LABEL[k]}</div>
                        <Gain value={sums[k]} className="font-semibold" />
                    </div>
                ))}
            </div>
            {top
                ? <p className="text-sm text-text-secondary">You are <b className="text-text-primary">{BOUND_TEXT[top].title}</b>. {BOUND_TEXT[top].tip}</p>
                : <p className="text-sm text-text-secondary">Small stat changes do not move these battles right now.</p>}
        </section>
    );
}

export default function UpgradeRanking() {
    const { lines, reached, rates, priced, failed } = useRanking();
    const [focus, setFocusState] = useState<RankMode[]>(readFocus);
    const [kind, setKind] = useState<'all' | UpgradeKind>('all');
    const [perPotion, setPerPotion] = useState(false);

    const toggle = (m: RankMode) => {
        const next = focus.includes(m) ? focus.filter(x => x !== m) : [...focus, m];
        const value = next.length ? RANK_MODES.filter(x => next.includes(x)) : RANK_MODES;
        setFocusState(value);
        try { localStorage.setItem(FOCUS_KEY, JSON.stringify(value)); } catch { /* per-device preference */ }
    };

    const rows = useMemo(() => (priced ?? [])
        .map(p => ({ ...p, gain: focus.reduce((a, m) => a + (p.est.perMode[m] ?? 0), 0) }))
        .filter(p => p.gain > 0 && (kind === 'all' || p.c.kind === kind) && (!perPotion || p.c.cost))
        .sort((a, b) => perPotion ? b.gain / b.c.cost! - a.gain / a.c.cost! : b.gain - a.gain), [priced, focus, kind, perPotion]);

    return (
        <div className="space-y-4 max-w-5xl mx-auto">
            <header>
                <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ icon: 'UpgradeArrow' }} size={28} /> Upgrade Ranking</h1>
                <p className="text-sm text-text-secondary mt-1">
                    One more level of everything you can upgrade, ranked by what it is worth for your build right now. The score adds up how close you get to winning each of the {WINDOW * 2 + 1} battles around where you are, so +1 means one battle's worth of progress. The sim measures what 1% of each stat adds to it, and each upgrade is priced from its exact stat change.
                </p>
            </header>

            <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
                {RANK_MODES.map(m => <ModeCard key={m} mode={m} score={reached[m]} line={lines?.[m]} />)}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-text-muted mr-1">Rank for</span>
                {RANK_MODES.map(m => (
                    <button key={m} onClick={() => toggle(m)} aria-pressed={focus.includes(m)}
                        className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors', focus.includes(m) ? 'border-accent-primary/50 bg-accent-primary/10 text-text-primary' : 'border-border text-text-muted')}>
                        {MODE_NAMES[m]}
                    </button>
                ))}
            </div>

            {failed && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">{failed}</div>}
            {!failed && !rates && <Waiting label="Measuring what each stat is worth…" />}
            {rates && <Diagnosis rates={rates} focus={focus} />}

            {priced && (
                <section className="bg-bg-input/40 rounded-xl p-4 border border-border">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h2 className="font-bold text-text-primary">Best next upgrades</h2>
                        <div className="flex gap-1.5">
                            <select value={perPotion ? 'potion' : 'score'} onChange={e => setPerPotion(e.target.value === 'potion')} className="bg-bg-input border border-border rounded-lg px-2 py-1 text-xs text-text-secondary">
                                <option value="score">Highest score</option>
                                <option value="potion">Per potion (tech)</option>
                            </select>
                            <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="bg-bg-input border border-border rounded-lg px-2 py-1 text-xs text-text-secondary">
                                <option value="all">All</option>
                                <option value="tech">Tech tree</option>
                                <option value="skill">Skills</option>
                                <option value="pet">Pets</option>
                                <option value="mount">Mount</option>
                            </select>
                        </div>
                    </div>
                    {rows.length === 0 ? <div className="text-sm text-text-muted">Nothing here moves these battles.</div> : (
                        <ol className="divide-y divide-border">
                            {rows.slice(0, SHOWN).map(({ c, est, gain }, i) => (
                                <li key={c.key} className="py-2 flex items-start gap-3">
                                    <span className="w-5 text-right text-xs text-text-muted pt-0.5 tabular-nums">{i + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted uppercase tracking-wider">{KIND_LABEL[c.kind]}</span>
                                            <span className="text-sm font-medium text-text-primary">{c.label}</span>
                                        </div>
                                        <div className="text-xs text-text-muted mt-0.5">
                                            {c.detail}
                                            {c.cost !== undefined && `, ${formatCost(c.cost)} potions`}
                                            {c.duration !== undefined && `, ${formatDuration(c.duration)}`}
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 text-[11px] text-text-muted mt-0.5">
                                            {est.dmgPct > 0.001 && <span>+{est.dmgPct.toFixed(2)}% DPS</span>}
                                            {est.hpPct > 0.001 && <span>+{est.hpPct.toFixed(2)}% effective health</span>}
                                            {est.healPct > 0.001 && <span>+{est.healPct.toFixed(2)}% healing</span>}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <Gain value={gain} className="font-semibold" />
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            )}
        </div>
    );
}
