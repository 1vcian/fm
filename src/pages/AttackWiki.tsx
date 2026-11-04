import { useMemo, useState } from 'react';
import { Card } from '../components/UI/Card';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { getItemImage } from '../utils/itemAssets';
import { getSkinSpriteStyle } from '../utils/skinSprites';
import { useSkinIcons } from '../utils/skinIcons';
import { usePersistentState } from '../hooks/usePersistentState';
import { AGES, attackCycleTicks, attackTimingTicks, doubleCycleSeconds, doubleSecondStrikeSeconds, weaponHitsPerSecond } from '../utils/constants';
import { maxSubstatTotal } from '../utils/substatBodies';
import { setDisplayName } from '../utils/skinArchive';
import { WeaponBreakpointsModal } from '../components/Wiki/WeaponBreakpointsModal';
import { cn, getAgeBgStyle, getAgeBorderStyle, getAgeIconStyle } from '../lib/utils';

/**
 * Attack wiki page: the attack cycle, the attack-speed breakpoints and what a weapon's windup
 * changes, with every weapon and weapon skin ranked by windup for melee and ranged.
 *
 * Everything is computed with the timing helpers in src/utils/constants.ts, the state machine read
 * from the binary (docs/attack-timing.md): 10 ticks per second, one AttackTimer per unit that runs
 * 0 -> WindUpDuration (the hit) -> AttackDuration (reset), and a double attack that re-seeds the
 * timer to floor(0.75 x windup). The single interval does not depend on the windup; the double
 * cycle and the time to the first hit do.
 *
 * The rows come from WeaponLibrary: ages 0..9 are the weapons, and a weapon skin fights on the row
 * (-1000 for a melee weapon, -1001 for a ranged one, skin idx) when its animation is on
 * (statEngine applyCombatWeapon). Other ages are left out.
 */

interface WeaponRow {
    ItemId: { Age: number; Type: string; Idx: number };
    WindupTime: number;
    AttackDuration: number;
    IsRanged: boolean;
    ProjectileId: number;
}

interface Entry {
    key: string;
    /** Item age 0..9, or -1 for a weapon skin. */
    age: number;
    idx: number;
    name: string;
    /** "Divine" or "Skin". */
    source: string;
    ranged: boolean;
    windup: number;
    duration: number;
    /** The skin's attack row has no projectile and is not ranged: the hit lands at once. */
    instant: boolean;
}

const camel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const SPEED_MAX = 500;
const DOUBLE_STEPS = [0, 0.25, 0.5, 0.75, 1];

/** The windups with the most and the fewest hits per second at one attack-speed bonus (%) and double chance. */
function bestWorst(bonus: number, windups: number[], dc: number) {
    const hits = windups.map(w => ({ w, h: weaponHitsPerSecond(1 + bonus / 100, w, 1.5, dc) }));
    const top = Math.max(...hits.map(x => x.h)), low = Math.min(...hits.map(x => x.h));
    return { top, low, best: hits.filter(x => x.h === top).map(x => x.w), worst: hits.filter(x => x.h === low).map(x => x.w) };
}
/** Hit-rate gap of the best windup over the worst: because of the ticks they are not always the shortest and the longest. */
const gapAt = (bonus: number, windups: number[], dc: number) => { const bw = bestWorst(bonus, windups, dc); return bw.top / bw.low - 1; };

/** The weapon's icon (AutoItemMapping) or the weapon skin's, as the game draws them. */
function Thumb({ e, mapping, sprites, version, size = 28 }: { e: Entry; mapping: any; sprites: any; version: string | null; size?: number }) {
    useSkinIcons(version);
    const box = { width: size, height: size };
    if (e.age < 0) {
        return <div title={e.name} style={{ ...box, ...getSkinSpriteStyle({ SkinId: { Type: 'Weapon', Idx: e.idx } } as any, sprites?.skins?.mapping, version ?? undefined) }} className="shrink-0 rounded-md bg-bg-input/70" />;
    }
    const src = getItemImage(AGES[e.age], 'Weapon', e.idx, mapping, version ?? undefined);
    return (
        <div style={box} className="shrink-0 rounded-md bg-bg-input/70 flex items-center justify-center overflow-hidden">
            {src && <img src={src} alt={e.name} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />}
        </div>
    );
}

function Slider({ label, value, max, onChange, hint }: { label: string; value: number; max: number; onChange: (v: number) => void; hint?: string }) {
    return (
        <label className="flex-1 min-w-[220px] space-y-1">
            <div className="flex justify-between text-xs">
                <span className="font-bold text-text-primary">{label}</span>
                <span className="font-mono text-accent-primary">+{value}%</span>
            </div>
            <input type="range" min={0} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
                className="w-full h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary" />
            {hint && <div className="hidden md:block text-[10px] text-text-muted">{hint}</div>}
        </label>
    );
}

/** One attack as ticks: the idle tick, the windup to the hit, the rest of the attack. */
function TickStrip({ bonus, windup, doubleChance }: { bonus: number; windup: number; doubleChance: number }) {
    const t = attackTimingTicks(1 + bonus / 100, windup, 1.5, doubleChance > 0 ? 1 : 0);
    const cells: { kind: 'idle' | 'wind' | 'hit' | 'rest' }[] = [{ kind: 'idle' }];
    const phase = (n: number, kind: 'wind' | 'rest') => { for (let i = 0; i < n; i++) cells.push({ kind: i === n - 1 && kind === 'wind' ? 'hit' : kind }); };
    phase(t[0], 'wind');
    if (t.length > 2) { phase(t[2], 'wind'); phase(t[3], 'rest'); } else phase(t[1], 'rest');
    const color = { idle: 'bg-white/15', wind: 'bg-amber-500/50', hit: 'bg-red-500', rest: 'bg-sky-500/40' };
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap gap-0.5">
                {cells.map((c, i) => <div key={i} className={cn('w-4 h-5 rounded-sm', color[c.kind])} title={`tick ${i + 1}`} />)}
            </div>
            <div className="text-[10px] text-text-muted font-mono">{cells.length} ticks = {(cells.length / 10).toFixed(1)} s</div>
        </div>
    );
}

const ICONS_SHOWN = 12, NAMES_SHOWN = 4;
const windupList = (ws: number[]) => (ws.length <= 3 ? ws.map(w => `${w.toFixed(2)} s`).join(', ') : `${ws.length} windups, ${ws[0].toFixed(2)} s to ${ws[ws.length - 1].toFixed(2)} s`);

function ExtremeIcons({ ex, mapping, sprites, version }: { ex: { fast: Entry[]; slow: Entry[] } | null; mapping: any; sprites: any; version: string | null }) {
    if (!ex) return null;
    if (!ex.slow.length) return <div className="text-[11px] text-text-secondary my-2">Every weapon and skin lands the same hits per second at this attack speed and double chance.</div>;
    const row = (label: string, list: Entry[]) => (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase text-text-muted w-14">{label}</span>
            {list.slice(0, ICONS_SHOWN).map(e => <Thumb key={e.key} e={e} mapping={mapping} sprites={sprites} version={version} size={24} />)}
            <span className="text-[11px] text-text-secondary">
                {list.length <= NAMES_SHOWN ? list.map(e => e.name).join(', ') : `${list.length} weapons and skins${list.length > ICONS_SHOWN ? `, ${list.length - ICONS_SHOWN} more not drawn` : ''}`}
            </span>
        </div>
    );
    return <div className="space-y-1 my-2">{row('Best', ex.fast)}{row('Worst', ex.slow)}</div>;
}

function GapChart({ melee, ranged, doubleChance, bonus }: { melee: number[] | null; ranged: number[] | null; doubleChance: number; bonus: number }) {
    const W = 600, H = 160, P = 28;
    const series = [
        { name: 'Melee', windups: melee, color: '#f87171' },
        { name: 'Ranged', windups: ranged, color: '#38bdf8' },
    ].filter(s => s.windups).map(s => ({ ...s, pts: Array.from({ length: SPEED_MAX + 1 }, (_, b) => gapAt(b, s.windups!, doubleChance)) }));
    const top = Math.max(0.05, ...series.flatMap(s => s.pts));
    const x = (b: number) => P + (b / SPEED_MAX) * (W - P - 8);
    const y = (v: number) => H - 18 - (v / top) * (H - 30);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {[0, top / 2, top].map(v => (
                <g key={v}>
                    <line x1={P} x2={W - 8} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-white/10" />
                    <text x={2} y={y(v) + 3} fontSize="9" fill="currentColor" className="text-text-muted">{Math.round(v * 100)}%</text>
                </g>
            ))}
            {[0, 100, 200, 300, 400, 500].map(b => <text key={b} x={x(b)} y={H - 4} textAnchor={b ? (b === SPEED_MAX ? 'end' : 'middle') : 'start'} fontSize="9" fill="currentColor" className="text-text-muted">+{b}%</text>)}
            <line x1={x(bonus)} x2={x(bonus)} y1={8} y2={H - 18} stroke="currentColor" strokeDasharray="3 3" className="text-accent-primary" />
            {series.map(s => (
                <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="1.5" points={s.pts.map((v, b) => `${x(b)},${y(v)}`).join(' ')} />
            ))}
        </svg>
    );
}

export default function AttackWiki() {
    const { data: weaponLibrary, loading, error } = useGameData<Record<string, WeaponRow>>('WeaponLibrary.json');
    const { data: skinsLibrary } = useGameData<Record<string, any>>('SkinsLibrary.json');
    const { data: mapping } = useGameData<Record<string, { ItemName?: string }>>('AutoItemMapping.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: petBaseConfig } = useGameData<any>('PetBaseConfig.json');
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const { selectedVersion: version } = useGameDataContext();
    const [bonus, setBonus] = usePersistentState<number>('wiki_attack_speed_bonus', 100);
    const [doublePct, setDoublePct] = usePersistentState<number>('wiki_attack_double_chance', 50);
    const [kind, setKind] = usePersistentState<'ranged' | 'melee'>('wiki_attack_kind', 'ranged');
    const isRanged = kind === 'ranged';
    /** Ranking filter: 'Skin' and the age names; only the skins at first. */
    const [shownSources, setShownSources] = usePersistentState<string[]>('wiki_attack_sources', ['Skin']);
    const toggleSource = (src: string) => setShownSources(cur => (cur.includes(src) ? cur.filter(x => x !== src) : [...cur, src]));
    const kindName = isRanged ? 'Ranged' : 'Melee';
    const dc = doublePct / 100;
    /** The weapon or skin whose breakpoints are open. */
    const [shownBreakpoints, setShownBreakpoints] = useState<Entry | null>(null);
    const mult = 1 + bonus / 100;

    const speedCap = maxSubstatTotal(secondaryStatLibrary?.AttackSpeed, itemBalancingLibrary, petBaseConfig);
    const doubleCap = maxSubstatTotal(secondaryStatLibrary?.DoubleDamageChance, itemBalancingLibrary, petBaseConfig);

    const entries = useMemo<Entry[]>(() => {
        if (!weaponLibrary) return [];
        const skinName = (idx: number) => {
            const row = Object.values<any>(skinsLibrary ?? {}).find(r => r?.SkinId?.Type === 'Weapon' && r.SkinId.Idx === idx);
            return row?.BaseSetId ? setDisplayName(row.BaseSetId) : `Weapon skin #${idx}`;
        };
        const out: Entry[] = [];
        for (const r of Object.values(weaponLibrary)) {
            const { Age: age, Idx: idx } = r.ItemId;
            if (age >= 0 && age < AGES.length) {
                const n = mapping?.[`${age}_5_${idx}`]?.ItemName;
                out.push({ key: `${age}_${idx}`, age, idx, name: n ? camel(n) : `Weapon ${idx}`, source: AGES[age], ranged: r.IsRanged, windup: r.WindupTime, duration: r.AttackDuration, instant: false });
            } else if (age === -1000 || age === -1001) {
                out.push({ key: `${age}_${idx}`, age: -1, idx, name: skinName(idx), source: 'Skin', ranged: age === -1001, windup: r.WindupTime, duration: r.AttackDuration, instant: age === -1001 && !r.IsRanged });
            }
        }
        return out;
    }, [weaponLibrary, skinsLibrary, mapping]);

    /** The weapons and skins the ranking filter shows (skins and ages): every comparison on the page is among them. */
    const shown = useMemo(() => entries.filter(e => shownSources.includes(e.source)), [entries, shownSources]);
    const lohi = (ranged: boolean): [number, number] | null => {
        const ws = shown.filter(e => e.ranged === ranged).map(e => e.windup);
        return ws.length ? [Math.min(...ws), Math.max(...ws)] : null;
    };
    /** Every distinct windup of a kind. */
    const windupsOf = (ranged: boolean): number[] | null => {
        const ws = [...new Set(shown.filter(e => e.ranged === ranged).map(e => e.windup))].sort((a, b) => a - b);
        return ws.length ? ws : null;
    };
    const melee = useMemo(() => windupsOf(false), [shown]);
    const ranged = useMemo(() => windupsOf(true), [shown]);
    const ws = isRanged ? ranged : melee;
    /** At the sliders' attack speed and double chance: the best and the worst windups, and the weapons and skins with them (no worst when all tie). */
    const bw = ws ? bestWorst(bonus, ws, dc) : null;
    const extremes = (ranged: boolean) => {
        if (!bw) return null;
        const of = shown.filter(e => e.ranged === ranged);
        const tie = bw.top === bw.low;
        return { fast: tie ? [] : of.filter(e => bw.best.includes(e.windup)), slow: tie ? [] : of.filter(e => bw.worst.includes(e.windup)) };
    };

    // Every attack-speed bonus where the single interval drops a tick, from +0% to +SPEED_MAX%.
    const breakpoints = useMemo(() => {
        const out: { bonus: number; ticks: number }[] = [{ bonus: 0, ticks: attackCycleTicks(1) }];
        for (let b = 0.1; b <= SPEED_MAX + 1e-9; b = Math.round((b + 0.1) * 10) / 10) {
            const t = attackCycleTicks(1 + b / 100);
            if (t < out[out.length - 1].ticks) out.push({ bonus: b, ticks: t });
        }
        return out;
    }, []);

    // Over the whole attack-speed range: the largest and the average gap, per double chance.
    const summary = useMemo(() => DOUBLE_STEPS.map(d => {
        const one = (ws: number[] | null) => {
            if (!ws) return null;
            let max = 0, at = 0, sum = 0;
            for (let b = 0; b <= SPEED_MAX; b++) { const g = gapAt(b, ws, d); sum += g; if (g > max) { max = g; at = b; } }
            return { max, at, avg: sum / (SPEED_MAX + 1) };
        };
        return { d, melee: one(melee), ranged: one(ranged) };
    }), [melee, ranged]);

    const ranking = (isRanged: boolean) => {
        const rows = entries.filter(e => e.ranged === isRanged && shownSources.includes(e.source)).map(e => ({
            ...e,
            hits: weaponHitsPerSecond(mult, e.windup, e.duration, dc),
            gap: doubleSecondStrikeSeconds(mult, e.windup),
            cycle: doubleCycleSeconds(mult, e.windup, e.duration),
            firstHit: (attackTimingTicks(mult, e.windup, e.duration, 0)[0] + 1) / 10,
        })).sort((a, b) => b.hits - a.hits || a.windup - b.windup || a.name.localeCompare(b.name));
        const best = rows[0]?.hits ?? 0;
        let rank = 0;
        return rows.map((r, i) => {
            if (i === 0 || Math.abs(r.hits - rows[i - 1].hits) > 1e-12) rank = i + 1;
            return { ...r, rank, vsBest: best ? r.hits / best - 1 : 0 };
        });
    };

    const single = attackCycleTicks(mult) / 10;
    const lh = lohi(isRanged);

    if (loading) return <div className="p-6 text-text-muted">Loading weapons...</div>;
    if (error || !weaponLibrary) return <div className="p-6 text-red-400">{error ?? 'WeaponLibrary.json is missing for this version'}</div>;

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-accent-primary flex items-center gap-2">
                <GameAssetIcon asset={{ icon: 'Battle' }} size={28} /> Attack
            </h1>

            <Card className="sticky -top-4 md:-top-6 z-30 p-3 md:p-4 bg-bg-secondary/95 backdrop-blur border-accent-primary/30 shadow-lg shadow-black/40 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div className="flex rounded-lg bg-bg-input p-1 gap-1" role="tablist">
                    {(['ranged', 'melee'] as const).map(k => (
                        <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                                kind === k ? 'bg-accent-primary text-black' : 'text-text-secondary hover:text-text-primary')}>
                            <GameAssetIcon asset={{ icon: k === 'ranged' ? 'IconMedievalWeaponBow' : 'Battle' }} size={14} />
                            {k === 'ranged' ? 'Ranged' : 'Melee'}
                        </button>
                    ))}
                </div>
                <Slider label="Attack speed bonus" value={bonus} max={SPEED_MAX} onChange={setBonus}
                    hint={speedCap !== null ? `Substats alone reach +${Math.round(speedCap * 100)}% (every piece at its top roll).` : undefined} />
                <Slider label="Double chance" value={doublePct} max={100} onChange={setDoublePct}
                    hint={doubleCap !== null ? `Substats alone reach ${Math.round(doubleCap * 100)}%.` : undefined} />
                <div className="w-full flex gap-1.5 overflow-x-auto md:flex-wrap pb-0.5" aria-label="Weapons and skins shown">
                    {['Skin', ...AGES].filter(src => entries.some(e => e.ranged === isRanged && e.source === src)).map(src => {
                        const on = shownSources.includes(src);
                        const age = AGES.indexOf(src);
                        return (
                            <button key={src} onClick={() => toggleSource(src)} aria-pressed={on}
                                style={on && age >= 0 ? { ...getAgeBgStyle(age), ...getAgeBorderStyle(age) } : undefined}
                                className={cn('shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold pl-1 pr-2.5 py-1 rounded-full border transition-colors',
                                    on ? (age < 0 ? 'bg-purple-500/25 border-purple-400/60 text-purple-100' : 'text-white')
                                        : 'border-border text-text-muted hover:text-text-primary opacity-70')}>
                                {age >= 0
                                    ? <span style={getAgeIconStyle(age, 18, version ?? undefined)} className={cn('shrink-0 rounded bg-white/90', !on && 'grayscale')} />
                                    : <GameAssetIcon asset={{ icon: 'SteppingStoneCharIcon0' }} size={18} className={cn(!on && 'grayscale')} />}
                                {age < 0 ? 'Skins' : src}
                            </button>
                        );
                    })}
                </div>
            </Card>

            <Card className="p-4 space-y-3">
                <h2 className="text-lg font-bold text-text-primary">The attack cycle</h2>
                <ul className="text-sm text-text-secondary space-y-1.5 list-disc pl-5">
                    <li>Battles run in <strong>ticks of 0.1 s</strong> (10 per second). Nothing happens between two ticks, so every time in a fight is a whole number of ticks.</li>
                    <li>Each fighter has <strong>one attack timer</strong>. Every tick it grows by 0.1 s times your attack speed (+100% attack speed: 0.2 s per tick).</li>
                    <li>An attack has three steps: <strong>1 idle tick</strong> to pick the target, the <strong>windup</strong> until the timer reaches the weapon's windup (the hit lands there), then the <strong>rest of the attack</strong> until the timer reaches 1.5 s, the same <strong>Attack Duration</strong> for every weapon. Then the timer goes back to 0.</li>
                    <li>The timer is <strong>not reset at the hit</strong>: windup and rest are one climb from 0 to 1.5 s. So the time between two normal attacks <strong>does not depend on the windup</strong>: every weapon and skin attacks at the same pace at the same attack speed.</li>
                    <li>A <strong>double attack</strong> sets the timer back to 75% of the windup right after the first hit; the second hit lands when it reaches the windup again, then the attack goes on to 1.5 s. This is where the windup counts.</li>
                </ul>
                {lh && (
                    <div className="space-y-2 pt-1">
                        <div className="text-xs font-bold text-text-primary">{kindName} at +{bonus}%: fastest windup {lh[0].toFixed(2)} s vs slowest {lh[1].toFixed(2)} s{dc > 0 ? ', with a double' : ''}</div>
                        <TickStrip bonus={bonus} windup={lh[0]} doubleChance={dc} />
                        <TickStrip bonus={bonus} windup={lh[1]} doubleChance={dc} />
                    </div>
                )}
                <div className="flex flex-wrap gap-3 text-[10px] text-text-muted">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white/15" /> idle tick</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500/50" /> windup</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500" /> hit</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-500/40" /> rest of the attack</span>
                </div>
            </Card>

            <Card className="p-4 space-y-3">
                <h2 className="text-lg font-bold text-text-primary">Breakpoints</h2>
                <p className="text-sm text-text-secondary">
                    Because time moves in whole ticks, attack speed only helps when it removes a tick from the attack. Between two
                    breakpoints extra attack speed changes nothing. 0% attack speed gives 1.7 s, not 1.5 s: the tick is a hair under 0.1 s,
                    so 1.5 s takes 16 ticks, plus the idle tick. These breakpoints are the same for every weapon.
                </p>
                <div className="overflow-x-auto border border-white/5 rounded-lg">
                    <table className="w-full text-xs font-mono">
                        <thead><tr className="text-text-muted text-[10px] uppercase border-b border-white/5">
                            <th className="p-2 text-left">From attack speed</th><th className="p-2 text-left">Time between attacks</th><th className="p-2 text-left">Attacks per second</th>
                        </tr></thead>
                        <tbody className="divide-y divide-white/5">
                            {breakpoints.map(b => {
                                const now = Math.abs(b.ticks / 10 - single) < 1e-9;
                                return (
                                    <tr key={b.bonus} className={cn(now && 'bg-accent-primary/15 text-accent-primary')}>
                                        <td className="p-2 font-bold">+{b.bonus.toFixed(1)}%</td>
                                        <td className="p-2">{(b.ticks / 10).toFixed(1)} s ({b.ticks} ticks)</td>
                                        <td className="p-2">{(10 / b.ticks).toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="text-[11px] text-text-muted">
                    With a double chance the double attack has its own breakpoints, which depend on the windup. The profile's DPS breakdown
                    lists them for your weapon.
                </p>
            </Card>

            <Card className="p-4 space-y-3">
                <h2 className="text-lg font-bold text-text-primary">What the windup changes</h2>
                <ul className="text-sm text-text-secondary space-y-1.5 list-disc pl-5">
                    <li><strong>Without double chance: nothing</strong> in the attack rate. Every windup gives the same attacks per second.</li>
                    <li><strong>With double chance:</strong> the second hit comes after 25% of the windup, and the double attack takes longer the slower the windup. A shorter windup means more hits per second, in steps: because of the ticks, a longer windup can land in the same number of ticks as a shorter one, or even fewer at some attack speeds (see the ranking).</li>
                    <li><strong>The first hit</strong> lands after the idle tick and the windup, counted from when a target is in range. A shorter windup hits first, which can decide a close fight, but the pace afterwards is the same.</li>
                </ul>
            </Card>

            <Card className="p-4 space-y-3">
                <h2 className="text-lg font-bold text-text-primary">Best vs worst windup</h2>
                {bw && (
                        <div className="bg-black/25 border border-white/5 rounded-lg p-3">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">{kindName}, +{bonus}% attack speed, {doublePct}% double</div>
                            <div className="text-[11px] text-text-muted">Among the weapons and skins picked at the top: {['Skin', ...AGES].filter(src => shownSources.includes(src)).map(src => (src === 'Skin' ? 'Skins' : src)).join(', ') || 'none'}.</div>
                            <div className="text-2xl font-black text-text-primary">+{pct(bw.top / bw.low - 1)}</div>
                            <ExtremeIcons ex={extremes(isRanged)} mapping={mapping} sprites={sprites} version={version} />
                            <div className="text-[11px] text-text-muted">
                                {bw.top === bw.low
                                    ? `hits per second of every windup: ${bw.top.toFixed(3)}`
                                    : `hits per second of the best windup (${windupList(bw.best)}) over the worst (${windupList(bw.worst)}): ${bw.top.toFixed(3)} vs ${bw.low.toFixed(3)}`}
                            </div>
                        </div>
                )}
                <div>
                    <div className="text-xs text-text-muted mb-1">The same gap over every attack speed at {doublePct}% double chance (dashed line: your attack speed)</div>
                    <GapChart melee={isRanged ? null : melee} ranged={isRanged ? ranged : null} doubleChance={dc} bonus={bonus} />
                </div>
                <div className="overflow-x-auto border border-white/5 rounded-lg">
                    <table className="w-full text-xs font-mono">
                        <thead><tr className="text-text-muted text-[10px] uppercase border-b border-white/5">
                            <th className="p-2 text-left">Double chance</th>
                            <th className="p-2 text-left">Largest gap</th><th className="p-2 text-left">Average gap</th>
                        </tr></thead>
                        <tbody className="divide-y divide-white/5">
                            {summary.map(s => {
                                const v = isRanged ? s.ranged : s.melee;
                                return (
                                    <tr key={s.d} className={cn(Math.abs(s.d - dc) < 1e-9 && 'bg-accent-primary/15 text-accent-primary')}>
                                        <td className="p-2 font-bold">{s.d * 100}%</td>
                                        <td className="p-2">{v ? `+${pct(v.max)}${v.max > 0 ? ` at +${v.at}%` : ''}` : '-'}</td>
                                        <td className="p-2">{v ? `+${pct(v.avg)}` : '-'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="text-[11px] text-text-muted">
                    Largest and average over attack speed +0% to +{SPEED_MAX}% in steps of 1%. Weapon damage scales with hits per second, so
                    the gap is the gap in weapon DPS (and lifesteal); skill damage is not affected. In short: the windup does not matter without
                    double chance, and matters a few percent at a typical double chance, up to about a third at 100%.
                </p>
            </Card>

            {(() => {
                const rows = ranking(isRanged);
                return (
                    <Card className="p-4 space-y-2">
                        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                            <GameAssetIcon asset={{ icon: isRanged ? 'IconMedievalWeaponBow' : 'Battle' }} size={20} />
                            {isRanged ? 'Ranged' : 'Melee'} ranking
                        </h2>
                        <p className="text-[11px] text-text-muted">
                            At +{bonus}% attack speed and {doublePct}% double chance. Weapons by age; a skin counts when its animation is on
                            (a {isRanged ? 'ranged' : 'melee'} weapon then attacks with the skin's windup). Ranks and "vs best" are among the rows shown. Equal hits per second share a rank: those
                            windups fight the same at this attack speed.
                        </p>
                        {!rows.length && <div className="text-xs text-text-muted">Turn on skins or an age to see the ranking.</div>}
                        <div className="overflow-x-auto border border-white/5 rounded-lg">
                            <table className="w-full text-xs">
                                <thead><tr className="text-text-muted text-[10px] uppercase border-b border-white/5">
                                    <th className="p-2 text-left">#</th><th className="p-2 text-left">Weapon / skin</th><th className="p-2 text-left">Windup</th>
                                    <th className="p-2 text-left">First hit</th><th className="p-2 text-left">2nd hit after</th><th className="p-2 text-left">Double attack</th>
                                    <th className="p-2 text-left">Hits / s</th><th className="p-2 text-left">vs best</th><th className="p-2" />
                                </tr></thead>
                                <tbody className="divide-y divide-white/5 font-mono">
                                    {rows.map(r => (
                                        <tr key={r.key} className="hover:bg-white/[0.03]">
                                            <td className="p-2 font-bold text-text-muted">{r.rank}</td>
                                            <td className="p-2 font-sans">
                                                <span className="flex items-center gap-2">
                                                <Thumb e={r} mapping={mapping} sprites={sprites} version={version} />
                                                <span className="font-semibold text-text-primary">{r.name}</span>
                                                <span style={r.age >= 0 ? getAgeBgStyle(r.age) : undefined} className={cn('ml-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded', r.age < 0 ? 'bg-purple-500/20 text-purple-200' : 'text-white')}>{r.source}</span>
                                                {r.instant && <span className="text-[9px] text-text-muted">no projectile</span>}
                                                </span>
                                            </td>
                                            <td className="p-2">{r.windup.toFixed(2)} s</td>
                                            <td className="p-2">{r.firstHit.toFixed(1)} s</td>
                                            <td className="p-2">{r.gap.toFixed(1)} s</td>
                                            <td className="p-2">{r.cycle.toFixed(1)} s</td>
                                            <td className="p-2">{r.hits.toFixed(3)}</td>
                                            <td className={cn('p-2', r.vsBest < -1e-9 ? 'text-red-300' : 'text-green-400')}>{r.vsBest < -1e-9 ? pct(r.vsBest) : 'best'}</td>
                                            <td className="p-2 text-right">
                                                <button onClick={() => setShownBreakpoints(r)} title={`Every attack-speed breakpoint of ${r.name}, normal and double attack`}
                                                    className="whitespace-nowrap font-sans font-bold text-[10px] uppercase px-2 py-1 rounded-lg border border-accent-primary/60 text-accent-primary hover:bg-accent-primary/15">
                                                    Breakpoints
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                );
            })()}
            {shownBreakpoints && (
                <WeaponBreakpointsModal
                    weapon={{ name: shownBreakpoints.name, windup: shownBreakpoints.windup, duration: shownBreakpoints.duration, ranged: shownBreakpoints.ranged }}
                    bonus={bonus}
                    onClose={() => setShownBreakpoints(null)}
                    icon={<Thumb e={shownBreakpoints} mapping={mapping} sprites={sprites} version={version} size={36} />}
                />
            )}
        </div>
    );
}
