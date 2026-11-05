import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGameData } from '../hooks/useGameData';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import type { BattleTarget } from '../progress/battleWorker';
import { calculateStats } from '../utils/statEngine';
import { cn } from '../lib/utils';
import { upgradeCandidates, type UpgradeCandidate, type UpgradeKind } from '../upgrades/candidates';
import {
    battleName, bound, estimate, MODE_NAMES, pricedStats, RANK_MODES, WINDOW,
    type Estimate, type RankMode, type RateKey, type Rates,
} from '../upgrades/ranking';
import { useBuildLab, useRates, type BuildLab, type Reached } from '../upgrades/useBuildLab';
import { FocusChips, Gain, useFocus, Waiting } from '../upgrades/ui';

const KIND_LABEL: Record<UpgradeKind, string> = { tech: 'Tech', pet: 'Pet', mount: 'Mount', skill: 'Skill' };
const SHOWN = 15;

const formatCost = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

function formatDuration(seconds: number): string {
    const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Every upgrade priced at the build's rates. */
function usePriced(lab: BuildLab, rates: Rates | null) {
    const { data: upgradeLib } = useGameData<any>('TechTreeUpgradeLibrary.json');
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    return useMemo(() => {
        if (!rates || !upgradeLib || !sprites) return null;
        return upgradeCandidates(lab.profile, lab.libs, upgradeLib, sprites)
            .map(c => ({ c, est: estimate(rates, pricedStats(calculateStats(c.profile, lab.libs))) }));
    }, [rates, upgradeLib, sprites, lab.profile, lab.libs]);
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
    const lab = useBuildLab();
    const { lines, reached } = lab;
    const { rates, failed } = useRates(lab);
    const priced = usePriced(lab, rates);
    const [focus, setFocus] = useFocus();
    const [kind, setKind] = useState<'all' | UpgradeKind>('all');
    const [perPotion, setPerPotion] = useState(false);

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

            <FocusChips focus={focus} onChange={setFocus} />

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
