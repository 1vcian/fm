import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UploadCloud, Loader2, Swords, Trophy, RefreshCw, Info } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { useComparison } from '../../context/ComparisonContext';
import { buildGameDictionaries } from '../../utils/ocr/gameLocalization';
import { preloadOcr, terminateOcr } from '../../utils/ocr/ocrEngine';
import { extractScreenshot } from '../../utils/ocr/extract';
import {
    simulateDuel, playerToDuel, BASE_ATTACK_DURATION, effectiveDps,
    type DuelStats, type DuelResult,
} from '../../utils/ocr/pvp';
import { cn } from '../../lib/utils';

type Stage = 'upload' | 'processing' | 'ready' | 'result';

interface OppForm { name: string; damage: number; health: number; crit: number; critDmg: number; double: number; attackSpeed: number; lifesteal: number; block: number; }

const EMPTY_OPP: OppForm = { name: 'Opponent', damage: 0, health: 0, crit: 0, critDmg: 0, double: 0, attackSpeed: 0, lifesteal: 0, block: 0 };

function fmt(n: number): string {
    const abs = Math.abs(n), units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [u, s] of units) if (abs >= u) return `${parseFloat((n / u).toFixed(2))}${s}`;
    return String(Math.round(n));
}

function oppToDuel(o: OppForm): DuelStats {
    return {
        name: o.name, damage: o.damage, health: o.health,
        critChance: o.crit / 100, critMultiplier: 1 + o.critDmg / 100, doubleChance: o.double / 100,
        aps: (1 + o.attackSpeed / 100) / BASE_ATTACK_DURATION, lifesteal: o.lifesteal / 100, block: o.block / 100,
    };
}

function NumField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
    return (
        <label className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-muted">{label}</span>
            <span className="flex items-center gap-1">
                <input type="number" value={value}
                    onChange={e => onChange(parseFloat(e.target.value) || 0)}
                    onFocus={e => e.target.select()}
                    className="w-24 bg-bg-input border border-border rounded px-2 py-1 text-right font-mono text-white outline-none focus:border-accent-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                {suffix && <span className="text-text-muted w-3">{suffix}</span>}
            </span>
        </label>
    );
}

function StatList({ d }: { d: DuelStats }) {
    return (
        <div className="text-[10px] font-mono text-text-secondary grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span>DMG {fmt(d.damage)}</span><span>HP {fmt(d.health)}</span>
            <span>Crit {(d.critChance * 100).toFixed(0)}%</span><span>CritDmg {((d.critMultiplier - 1) * 100).toFixed(0)}%</span>
            <span>Double {(d.doubleChance * 100).toFixed(0)}%</span><span>APS {d.aps.toFixed(2)}</span>
            <span>Lifesteal {(d.lifesteal * 100).toFixed(0)}%</span><span>Block {(d.block * 100).toFixed(0)}%</span>
            <span className="col-span-2 text-accent-primary">Eff. DPS {fmt(effectiveDps(d))}</span>
        </div>
    );
}

export function PvpModal({ onClose }: { onClose: () => void }) {
    const { profile } = useProfile();
    const { excludeSubstats } = useComparison();
    const computed = useGlobalStats(excludeSubstats);

    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const dicts = useMemo(() => buildGameDictionaries({ autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization }),
        [autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization]);

    const [stage, setStage] = useState<Stage>('upload');
    const [opp, setOpp] = useState<OppForm>(EMPTY_OPP);
    const [result, setResult] = useState<DuelResult | null>(null);
    const [anim, setAnim] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { preloadOcr().catch(() => {}); return () => { terminateOcr().catch(() => {}); }; }, []);

    const player = useMemo(() => playerToDuel(computed, profile.name || 'You'), [computed, profile.name]);

    const scan = async (file: File) => {
        setStage('processing'); setError(null);
        try {
            const ex = await extractScreenshot(file, dicts);
            const agg = ex.aggregate;
            if (!agg) { setError('That screenshot is not an opponent profile overview (needs Total Damage / Total Health).'); setStage('upload'); return; }
            const s = (id: string) => agg.substats.find(x => x.statId === id)?.value ?? 0;
            setOpp({
                name: 'Opponent', damage: agg.totalDamage ?? 0, health: agg.totalHealth ?? 0,
                crit: s('CriticalChance'), critDmg: s('CriticalMulti'), double: s('DoubleDamageChance'),
                attackSpeed: s('AttackSpeed'), lifesteal: s('LifeSteal'), block: s('BlockChance'),
            });
            setStage('ready');
        } catch (e: any) {
            setError(e?.message || 'OCR failed.'); setStage('upload');
        }
    };

    const fight = () => {
        const r = simulateDuel(player, oppToDuel(opp));
        setResult(r); setStage('result');
        setAnim(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setAnim(true)));
    };

    const oppD = oppToDuel(opp);
    const youWin = result?.winner === 'a';
    const draw = result?.winner === 'draw';

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4" onClick={onClose}>
            <div className="bg-bg-primary w-full max-w-2xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-red-500/15 to-accent-primary/10">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center"><Swords className="w-5 h-5 text-red-400" /></div>
                        <div><h3 className="font-black text-white">Simplified PvP</h3><p className="text-[11px] text-text-muted">Duel your build against an opponent screenshot</p></div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {stage === 'upload' && (
                        <div className="space-y-3">
                            <div onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) scan(f); }}
                                className="border-2 border-dashed border-red-400/40 rounded-2xl p-8 text-center cursor-pointer hover:bg-red-400/5 transition">
                                <UploadCloud className="w-10 h-10 mx-auto text-red-400 mb-3" />
                                <p className="font-bold text-white">Drop the opponent's profile overview</p>
                                <p className="text-[11px] text-text-muted mt-1">The screen showing their Total Damage / Total Health & % stats.</p>
                                <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) scan(f); }} />
                            </div>
                            <button onClick={() => setStage('ready')} className="w-full py-2 rounded-lg text-[12px] text-text-muted hover:text-white border border-border">or enter opponent stats manually →</button>
                            {error && <p className="text-red-400 text-sm">{error}</p>}
                        </div>
                    )}

                    {stage === 'processing' && (
                        <div className="py-12 text-center space-y-3"><Loader2 className="w-10 h-10 mx-auto text-red-400 animate-spin" /><p className="text-text-muted text-sm">Reading opponent…</p></div>
                    )}

                    {(stage === 'ready' || stage === 'result') && (
                        <div className="space-y-4">
                            {stage === 'result' && result && (
                                <div className={cn('rounded-xl p-4 text-center border-2', draw ? 'border-white/30 bg-white/5' : youWin ? 'border-green-500/50 bg-green-500/10' : 'border-red-500/50 bg-red-500/10')}>
                                    <Trophy className={cn('w-8 h-8 mx-auto mb-1', draw ? 'text-white/60' : youWin ? 'text-green-400' : 'text-red-400')} />
                                    <div className="text-xl font-black text-white">{draw ? 'Draw' : youWin ? 'You win!' : 'You lose'}</div>
                                    <div className="text-[11px] text-text-muted">
                                        {result.aTTK != null && `You kill in ${result.aTTK.toFixed(1)}s`}{result.aTTK != null && result.bTTK != null ? ' · ' : ''}
                                        {result.bTTK != null && `Opponent kills in ${result.bTTK.toFixed(1)}s`}
                                    </div>
                                    {result.note && <p className="text-[10px] text-text-muted mt-1">{result.note}</p>}
                                </div>
                            )}

                            {/* HP bars */}
                            {stage === 'result' && result && (
                                <div className="space-y-2">
                                    {([['You', player, result.aRemainingPct, 'bg-green-500'], ['Opponent', oppD, result.bRemainingPct, 'bg-red-500']] as const).map(([lbl, d, pct, col], i) => (
                                        <div key={i}>
                                            <div className="flex justify-between text-[10px] text-text-muted"><span>{lbl}</span><span>{pct.toFixed(0)}% HP · {fmt(effectiveDps(d))} DPS</span></div>
                                            <div className="h-3 rounded-full bg-bg-input overflow-hidden"><div className={cn('h-full rounded-full transition-all duration-[1500ms] ease-out', col)} style={{ width: `${anim ? pct : 100}%` }} /></div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* You */}
                                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
                                    <div className="font-bold text-green-400 text-sm mb-2">{player.name} (your build)</div>
                                    <StatList d={player} />
                                </div>
                                {/* Opponent (editable) */}
                                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-1">
                                    <div className="font-bold text-red-400 text-sm mb-1">Opponent {stage === 'ready' && <span className="text-[9px] text-text-muted">(edit if OCR missed something)</span>}</div>
                                    <NumField label="Total Damage" value={opp.damage} onChange={v => setOpp({ ...opp, damage: v })} />
                                    <NumField label="Total Health" value={opp.health} onChange={v => setOpp({ ...opp, health: v })} />
                                    <NumField label="Crit Chance" value={opp.crit} onChange={v => setOpp({ ...opp, crit: v })} suffix="%" />
                                    <NumField label="Crit Damage" value={opp.critDmg} onChange={v => setOpp({ ...opp, critDmg: v })} suffix="%" />
                                    <NumField label="Double" value={opp.double} onChange={v => setOpp({ ...opp, double: v })} suffix="%" />
                                    <NumField label="Attack Speed" value={opp.attackSpeed} onChange={v => setOpp({ ...opp, attackSpeed: v })} suffix="%" />
                                    <NumField label="Lifesteal" value={opp.lifesteal} onChange={v => setOpp({ ...opp, lifesteal: v })} suffix="%" />
                                    <NumField label="Block" value={opp.block} onChange={v => setOpp({ ...opp, block: v })} suffix="%" />
                                </div>
                            </div>

                            <p className="text-[10px] text-text-muted flex items-start gap-1.5"><Info className="w-3 h-3 mt-0.5 shrink-0" /> Both fighters use their full totals — which already include tree &amp; passives — so this is the real matchup. The opponent's tree is baked into their Total Damage/Health, so nothing needs to be stripped.</p>
                        </div>
                    )}
                </div>

                {(stage === 'ready' || stage === 'result') && (
                    <div className="p-3 border-t border-border flex gap-2">
                        <button onClick={() => { setStage('upload'); setResult(null); }} className="px-4 py-2.5 rounded-xl bg-bg-input text-text-secondary hover:text-white text-sm font-bold flex items-center gap-2"><UploadCloud className="w-4 h-4" /> New</button>
                        <button onClick={fight} className="flex-1 py-2.5 rounded-xl font-black bg-red-500 text-white hover:brightness-110 flex items-center justify-center gap-2">
                            {stage === 'result' ? <><RefreshCw className="w-4 h-4" /> Rematch</> : <><Swords className="w-4 h-4" /> Fight!</>}
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
