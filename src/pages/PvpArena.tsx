import { useMemo, useState } from 'react';
import { Swords, Play, Eye, Info } from 'lucide-react';
import { Card } from '../components/UI/Card';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { useStatLibraries } from '../hooks/useGlobalStats';
import { calculateStats } from '../utils/statEngine';
import { formatNumber } from '../utils/format';
import { fighterFromProfile, type PvpFighter } from '../pvp/fighter';
import { pvpConfigFromJson, simulatePvpBatch, timerSteps, type PvpBatchResult } from '../pvp/simulate';
import { pvpHpMultiplier, type PvpHpConfig } from '../engine';
import { BattleVisualizerModal } from '../components/Battle/BattleVisualizerModal';
import { CardFighterInput, type CardFighterState } from '../components/Pvp/CardFighterInput';
import type { UserProfile } from '../types/Profile';

type Source =
    | { kind: 'active' }
    | { kind: 'saved'; id: string }
    | { kind: 'card'; mode: 'screenshot' | 'manual' };

interface SlotState {
    source: Source;
    card: CardFighterState | null;
}

const RUN_OPTIONS = [100, 1000, 5000];

/**
 * Arena simulator. Each side is a profile: the active one, a saved one, or one rebuilt from
 * profile card screenshots. The battle is the real engine with the arena rules of PvpBaseConfig.
 */
export default function PvpArena() {
    const { profile: activeProfile, profiles } = useProfile();
    const { libs, ready } = useStatLibraries();
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const cfg = useMemo(() => pvpConfigFromJson(pvpBaseConfig), [pvpBaseConfig]);

    const [slots, setSlots] = useState<[SlotState, SlotState]>([
        { source: { kind: 'active' }, card: null },
        { source: { kind: 'card', mode: 'screenshot' }, card: null },
    ]);
    const [runs, setRuns] = useState(1000);
    const [result, setResult] = useState<PvpBatchResult | null>(null);
    const [running, setRunning] = useState(false);
    const [replaySeed, setReplaySeed] = useState(1);
    const [showReplay, setShowReplay] = useState(false);

    const setSlot = (i: 0 | 1, next: Partial<SlotState>) => {
        setResult(null);
        setSlots(prev => {
            const copy: [SlotState, SlotState] = [prev[0], prev[1]];
            copy[i] = { ...copy[i], ...next };
            return copy;
        });
    };

    const fighters = useMemo((): [PvpFighter | null, PvpFighter | null] => {
        if (!ready) return [null, null];
        const make = (slot: SlotState, fallbackName: string): PvpFighter | null => {
            const fromProfile = (p: UserProfile, name: string) =>
                fighterFromProfile(name, p, calculateStats(p, libs), libs);
            if (slot.source.kind === 'active') return fromProfile(activeProfile, activeProfile.name || fallbackName);
            if (slot.source.kind === 'saved') {
                const id = slot.source.id;
                const p = profiles.find(x => x.id === id);
                return p ? fromProfile(p, p.name || fallbackName) : null;
            }
            const c = slot.card;
            if (!c?.profile) return null;
            // Card totals are exactly what the game fights with; the rebuilt profile supplies the rest.
            return fighterFromProfile(c.name || fallbackName, c.profile, calculateStats(c.profile, libs), libs,
                { totalDamage: c.totalDamage, totalHealth: c.totalHealth }, 'card');
        };
        return [make(slots[0], 'Player 1'), make(slots[1], 'Player 2')];
    }, [ready, libs, slots, activeProfile, profiles]);

    const [f1, f2] = fighters;
    const canRun = !!(f1 && f2 && cfg);
    // Stable object: the visualizer restarts whenever this identity changes.
    const pvpProp = useMemo(() => (f1 && f2 && cfg ? { p1: f1, p2: f2, cfg, seed: replaySeed } : null), [f1, f2, cfg, replaySeed]);

    const runBatch = () => {
        if (!f1 || !f2 || !cfg) return;
        setRunning(true);
        // Yield one frame so the button state paints before the batch blocks the thread.
        setTimeout(() => {
            setResult(simulatePvpBatch(f1, f2, cfg, runs));
            setRunning(false);
        }, 30);
    };

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
            <h1 className="text-2xl md:text-3xl font-bold text-accent-primary flex items-center gap-2">
                <Swords className="w-7 h-7" /> Arena Simulator
                <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">Beta</span>
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {([0, 1] as const).map(i => (
                    <FighterSlot
                        key={i}
                        index={i}
                        slot={slots[i]}
                        fighter={fighters[i]}
                        profiles={profiles}
                        activeName={activeProfile.name}
                        onChange={next => setSlot(i, next)}
                        solverReady={ready}
                    />
                ))}
            </div>

            {cfg && <FormulaCard cfg={cfg} f1={f1} f2={f2} />}

            <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-1">
                        {RUN_OPTIONS.map(n => (
                            <button key={n} onClick={() => { setRuns(n); setResult(null); }}
                                className={'px-3 py-1.5 rounded-lg text-sm border ' + (runs === n ? 'border-accent-primary text-accent-primary' : 'border-border text-text-muted')}>
                                {n.toLocaleString('en-US')} runs
                            </button>
                        ))}
                    </div>
                    <button disabled={!canRun || running} onClick={runBatch}
                        className="px-4 py-2 rounded-lg bg-accent-primary text-black font-bold flex items-center gap-2 disabled:opacity-40">
                        <Play className="w-4 h-4" /> {running ? 'Simulating' : 'Run batch'}
                    </button>
                    <div className="flex items-center gap-2 ml-auto">
                        <label className="text-sm text-text-secondary flex items-center gap-1">
                            Seed
                            <input type="number" min={1} value={replaySeed} onChange={e => setReplaySeed(Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-20 bg-bg-input border border-border rounded px-2 py-1 font-mono" />
                        </label>
                        <button disabled={!canRun} onClick={() => setShowReplay(true)}
                            className="px-4 py-2 rounded-lg border border-accent-primary text-accent-primary font-bold flex items-center gap-2 disabled:opacity-40">
                            <Eye className="w-4 h-4" /> Watch battle
                        </button>
                    </div>
                </div>
                {!cfg && <p className="text-sm text-text-muted">Loading the arena rules (PvpBaseConfig).</p>}
                {result && f1 && f2 && <BatchResult result={result} f1={f1} f2={f2} />}
            </Card>

            {showReplay && f1 && pvpProp && (
                <BattleVisualizerModal
                    isOpen
                    onClose={() => setShowReplay(false)}
                    playerStats={f1.stats}
                    profile={f1.profile}
                    libs={libs as never}
                    ageIdx={0}
                    battleIdx={0}
                    difficultyMode={0}
                    pvp={pvpProp}
                />
            )}
        </div>
    );
}

function FighterSlot({ index, slot, fighter, profiles, activeName, onChange, solverReady }: {
    index: 0 | 1;
    slot: SlotState;
    fighter: PvpFighter | null;
    profiles: UserProfile[];
    activeName: string;
    onChange: (next: Partial<SlotState>) => void;
    solverReady: boolean;
}) {
    const value = slot.source.kind === 'saved' ? `saved:${slot.source.id}`
        : slot.source.kind === 'card' ? `card:${slot.source.mode}` : slot.source.kind;
    return (
        <Card className={'p-4 space-y-3 border-2 ' + (index === 0 ? 'border-blue-500/30' : 'border-red-500/30')}>
            <div className="flex items-center gap-2">
                <span className={'text-xs font-black px-2 py-0.5 rounded ' + (index === 0 ? 'bg-blue-500/20 text-blue-300' : 'bg-red-500/20 text-red-300')}>
                    Player {index + 1}
                </span>
                <select value={value}
                    onChange={e => {
                        const v = e.target.value;
                        if (v === 'active') onChange({ source: { kind: 'active' } });
                        else if (v === 'card:screenshot') onChange({ source: { kind: 'card', mode: 'screenshot' }, card: null });
                        else if (v === 'card:manual') onChange({ source: { kind: 'card', mode: 'manual' }, card: null });
                        else onChange({ source: { kind: 'saved', id: v.slice(6) } });
                    }}
                    className="flex-1 bg-bg-input border border-border rounded-lg px-2 py-1.5 text-sm">
                    <option value="active">Active profile ({activeName})</option>
                    {profiles.map(p => <option key={p.id} value={`saved:${p.id}`}>Profile: {p.name}</option>)}
                    <option value="card:screenshot">From profile card screenshots</option>
                    <option value="card:manual">Build manually</option>
                </select>
            </div>

            {slot.source.kind === 'card' && (
                <CardFighterInput key={slot.source.mode} mode={slot.source.mode} value={slot.card}
                    onChange={card => onChange({ card })} solverReady={solverReady} />
            )}

            {fighter ? <FighterSummary f={fighter} /> : (
                <p className="text-sm text-text-muted">{slot.source.kind !== 'card' ? 'Loading game data.'
                    : slot.source.mode === 'manual' ? 'Fill in the totals and the equipment.' : 'Add a profile card screenshot.'}</p>
            )}
        </Card>
    );
}

function FighterSummary({ f }: { f: PvpFighter }) {
    const st = f.loadout.stats;
    const pct = (v: number | undefined) => `${((v ?? 0) * 100).toFixed(1)}%`;
    const rows: [string, string][] = [
        ['Total Damage', formatNumber(st.dmg ?? 0)],
        ['Total Health', formatNumber(f.loadout.health)],
        ['Crit chance', pct(st.criticalChance)],
        ['Crit damage', `x${(st.criticalMulti ?? 1).toFixed(2)}`],
        ['Double chance', pct(st.doubleDamageChance)],
        ['Attack speed', `x${(st.attackSpeedMulti ?? 1).toFixed(2)}`],
        ['Lifesteal', pct(st.lifeSteal)],
        ['Block', pct(st.blockChance)],
        ['Regen', pct(st.healthRegen)],
        ['Weapon', `${f.stats.isRangedWeapon ? (f.loadout.projectile ? 'Ranged' : 'Ranged, no projectile') : 'Melee'}, range ${f.loadout.attackRange.toFixed(1)}`],
        ['Windup', `${f.loadout.windupTime.toFixed(2)}s from the ${f.profile.items?.Weapon?.skin ? 'skin' : 'weapon'}`],
        ['Pets / skills / mount', `${f.loadout.petCount} / ${f.loadout.skillCount} / ${f.loadout.hasMount ? 'yes' : 'no'}`],
    ];
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-border/40 py-0.5">
                    <span className="text-text-muted">{k}</span>
                    <span className="font-mono">{v}</span>
                </div>
            ))}
            {f.source === 'card' && (
                <p className="col-span-2 text-xs text-text-muted pt-1">
                    Damage and health are the card totals, as the game uses them. Rebuilt profile:{' '}
                    {formatNumber(f.computed.damage)} / {formatNumber(f.computed.health)}.
                </p>
            )}
        </div>
    );
}

function FormulaCard({ cfg, f1, f2 }: { cfg: PvpHpConfig; f1: PvpFighter | null; f2: PvpFighter | null }) {
    const m1 = f1 ? pvpHpMultiplier(f1.loadout, cfg) : null;
    const m2 = f2 ? pvpHpMultiplier(f2.loadout, cfg) : null;
    const shared = m1 !== null && m2 !== null ? Math.max(m1, m2) : null;
    const n = (v: number) => Number(v.toFixed(4)).toString();
    return (
        <Card className="p-4 space-y-2 text-sm">
            <h2 className="font-bold flex items-center gap-2"><Info className="w-4 h-4 text-accent-primary" /> How the arena works</h2>
            <p className="text-text-secondary">Values from PvpBaseConfig of the selected game data, read from the game binary (PvpCombatScene).</p>
            <div className="font-mono text-xs bg-bg-input/60 border border-border rounded-lg p-3 space-y-1">
                <div>m = {n(cfg.PvpHpBaseMultiplier)} + {n(cfg.PvpHpPetMultiplier)} x equipped pets + {n(cfg.PvpHpSkillMultiplier)} x equipped skills + {n(cfg.PvpHpMountMultiplier)} x (mount equipped ? 1 : 0)</div>
                <div>shared multiplier = max(m(Player 1), m(Player 2)), applied to BOTH players</div>
                <div>Max HP = Total Health x shared multiplier;  damage is not multiplied</div>
                <div>regen heals on Total Health (not multiplied); regen and lifesteal stop at Max HP</div>
                <div>each step Player 1 (you, in the game) acts before Player 2: heals Player 1 gets at full HP are lost, an edge for Player 2 when lifesteal is high</div>
                <div>timer {cfg.PvpMatchTimerSeconds}s ({timerSteps(cfg.PvpMatchTimerSeconds) - 1} steps of 0.1s); at the end the higher HP % wins, equal is a draw</div>
            </div>
            {shared !== null && (
                <p>
                    Player 1 m = <b>{n(m1!)}</b>, Player 2 m = <b>{n(m2!)}</b>, shared = <b>{n(shared)}</b>:
                    Max HP {formatNumber(f1!.loadout.health * shared)} vs {formatNumber(f2!.loadout.health * shared)}.
                </p>
            )}
            <p className="text-text-muted text-xs">
                Players spawn 18 units apart and every equipped skill fires as soon as it is off cooldown.
                Total Damage and Total Health are exactly the numbers on the player&apos;s profile card.
            </p>
        </Card>
    );
}

function BatchResult({ result, f1, f2 }: { result: PvpBatchResult; f1: PvpFighter; f2: PvpFighter }) {
    const pct = (v: number) => `${((v / result.runs) * 100).toFixed(1)}%`;
    const bar = (v: number, color: string) => <div className={`h-full ${color}`} style={{ width: `${(v / result.runs) * 100}%` }} />;
    // Sides are always named by slot, so a profile fought against itself stays readable.
    const side1 = `Player 1 (${f1.name || 'unnamed'})`;
    const side2 = `Player 2 (${f2.name || 'unnamed'})`;
    return (
        <div className="space-y-2">
            <div className="flex h-4 rounded-full overflow-hidden bg-bg-input">
                {bar(result.p1Wins, 'bg-blue-500')}
                {bar(result.draws, 'bg-gray-500')}
                {bar(result.p2Wins, 'bg-red-500')}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label={`${side1} wins`} value={pct(result.p1Wins)} cls="text-blue-300" />
                <Stat label={`${side2} wins`} value={pct(result.p2Wins)} cls="text-red-300" />
                <Stat label="Draws" value={pct(result.draws)} />
                <Stat label="Decided on time" value={pct(result.timeouts)} />
                <Stat label="Average length" value={`${result.avgSeconds.toFixed(1)}s`} />
                <Stat label={`${side1} HP left`} value={`${(result.avgP1HpFrac * 100).toFixed(1)}%`} />
                <Stat label={`${side2} HP left`} value={`${(result.avgP2HpFrac * 100).toFixed(1)}%`} />
                <Stat label="Shared HP multiplier" value={`x${Number(result.hpMultiplier.toFixed(4))}`} />
            </div>
            {/* StartLocalPvpBattle (0x3EB4A10) passes the local player's own profile as player1. */}
            <p className="text-xs text-text-muted">
                In the game you are Player 1, the side that acts first in each step. Lifesteal you gain at full HP is lost, so even against an identical copy Player 2 wins a little more often.
            </p>
        </div>
    );
}

function Stat({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
    return (
        <div className="bg-bg-input/50 border border-border rounded-lg p-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted truncate" title={label}>{label}</div>
            <div className={`text-lg font-black font-mono ${cls}`}>{value}</div>
        </div>
    );
}
