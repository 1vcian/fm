import { memo, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useGameData } from '../../hooks/useGameData';
import { attackIntervalSeconds, doubleDelaySeconds } from '../../utils/constants';
import { cn } from '../../lib/utils';

interface BreakpointTablesProps {
    weaponAttackDuration: number;
    weaponWindupTime: number;
    currentAttackSpeedMultiplier: number; // e.g. 1.5
    realCycleTime?: number;
    realWindup?: number;
    doubleDamageChance?: number; // e.g. 0.25 (25%)
}

interface Gain {
    reqBonus: number;      // attack-speed bonus % that unlocks this improvement
    single: number;        // single-attack interval (s)
    delay: number;         // double 2nd-hit delay (s)
    effective: number;     // effective time-per-hit (s), weighted by double chance
    cause: 'single' | 'double' | 'both';
}

// Effective time PER HIT accounting for the double-attack chance:
//   a double turns one cycle into two hits, so time/hit = (single + dc*delay) / (1 + dc).
// Lower = faster = more DPS. This is the number the player should actually optimise.
const timePerHit = (single: number, delay: number, dc: number) => (single + dc * delay) / (1 + dc);

// Attack timing is reverse-engineered from the game binary (see docs/attack-timing.md):
// 10 sim-ticks/s. The SINGLE interval is weapon/skin-INDEPENDENT; only the DOUBLE second-strike
// delay depends on this weapon's windup.
export const BreakpointTables = memo(({
    weaponAttackDuration,
    weaponWindupTime,
    currentAttackSpeedMultiplier,
    doubleDamageChance,
}: BreakpointTablesProps) => {
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');

    const maxAttackSpeedSubstat = secondaryStatLibrary?.AttackSpeed?.UpperRange || 0.4;
    const maxPossibleSpeedBonus = (maxAttackSpeedSubstat * 12 * 100) + 0.1;
    const currentBonus = (currentAttackSpeedMultiplier - 1) * 100;
    const dc = Math.min(Math.max(doubleDamageChance ?? 0, 0), 1);

    const cur = useMemo(() => {
        const single = attackIntervalSeconds(currentAttackSpeedMultiplier, weaponAttackDuration);
        const delay = doubleDelaySeconds(currentAttackSpeedMultiplier, weaponWindupTime);
        return { single, delay, effective: timePerHit(single, delay, dc) };
    }, [currentAttackSpeedMultiplier, weaponAttackDuration, weaponWindupTime, dc]);

    // Scan attack speed; record every point where the EFFECTIVE time-per-hit actually drops.
    // Those are the only attack-speed values that give a real DPS gain.
    const gains = useMemo(() => {
        const out: Gain[] = [];
        let prevSingle = attackIntervalSeconds(1, weaponAttackDuration);
        let prevDelay = doubleDelaySeconds(1, weaponWindupTime);
        let prevEff = timePerHit(prevSingle, prevDelay, dc);
        for (let b = 0.1; b <= maxPossibleSpeedBonus; b = Math.round((b + 0.1) * 10) / 10) {
            const mult = 1 + b / 100;
            const single = attackIntervalSeconds(mult, weaponAttackDuration);
            const delay = doubleDelaySeconds(mult, weaponWindupTime);
            const eff = timePerHit(single, delay, dc);
            if (eff < prevEff - 1e-9) {
                const singleDropped = single < prevSingle - 1e-9;
                const delayDropped = delay < prevDelay - 1e-9;
                out.push({
                    reqBonus: b,
                    single,
                    delay,
                    effective: eff,
                    cause: singleDropped && delayDropped ? 'both' : delayDropped ? 'double' : 'single',
                });
            }
            prevSingle = single; prevDelay = delay; prevEff = eff;
        }
        return out;
    }, [weaponAttackDuration, weaponWindupTime, maxPossibleSpeedBonus, dc]);

    // Next worthwhile target = first gain above the current attack speed.
    const nextGain = gains.find(g => g.reqBonus > currentBonus + 0.01);
    // Best reachable time/hit within gear limits.
    const bestEff = gains.length ? gains[gains.length - 1].effective : cur.effective;
    const dps = (t: number) => (t > 0 ? 1 / t : 0);

    return (
        <div className="space-y-6">
            {/* Explanation */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-orange-400 uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                    Attack-speed value (10-tick engine)
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">
                    Combat advances in <strong>0.1s ticks</strong>. Attack speed only helps when it crosses a tick
                    threshold, so speed between breakpoints is wasted. The list below shows only the attack-speed values
                    that <strong>actually lower your time&nbsp;per&nbsp;hit</strong> (weighted by your{' '}
                    <strong>{Math.round(dc * 100)}% double chance</strong>). The single-attack interval is the same for
                    every weapon/skin; the double 2nd-hit delay depends on this weapon&apos;s windup ({weaponWindupTime.toFixed(2)}s),
                    so with double chance a faster-windup weapon reaches better time/hit sooner.
                </p>
            </div>

            {/* Current + next + best summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-black/25 border border-white/5 rounded-lg p-3">
                    <div className="text-[9px] uppercase tracking-wider text-white/40">Now (+{currentBonus.toFixed(0)}%)</div>
                    <div className="text-lg font-black text-white">{cur.effective.toFixed(2)}s<span className="text-[10px] text-white/40 font-normal"> /hit</span></div>
                    <div className="text-[9px] text-white/40 font-mono">single {cur.single.toFixed(1)}s · double {(cur.single + cur.delay).toFixed(1)}s</div>
                </div>
                <div className={cn('rounded-lg p-3 border', nextGain ? 'bg-purple-500/10 border-purple-500/30' : 'bg-black/25 border-white/5')}>
                    <div className="text-[9px] uppercase tracking-wider text-purple-300/70">Next worthwhile target</div>
                    {nextGain ? (
                        <>
                            <div className="text-lg font-black text-purple-300">+{nextGain.reqBonus.toFixed(1)}%</div>
                            <div className="text-[9px] text-white/50 font-mono">
                                → {nextGain.effective.toFixed(2)}s/hit ({((dps(nextGain.effective) / dps(cur.effective) - 1) * 100).toFixed(1)}% DPS)
                            </div>
                        </>
                    ) : (
                        <div className="text-sm font-bold text-white/50 mt-1">You&apos;ve hit the last breakpoint 🎯</div>
                    )}
                </div>
                <div className="bg-black/25 border border-white/5 rounded-lg p-3">
                    <div className="text-[9px] uppercase tracking-wider text-white/40">Best reachable</div>
                    <div className="text-lg font-black text-green-400">{bestEff.toFixed(2)}s<span className="text-[10px] text-white/40 font-normal"> /hit</span></div>
                    <div className="text-[9px] text-white/40 font-mono">at gear cap +{(maxPossibleSpeedBonus - 0.1).toFixed(0)}%</div>
                </div>
            </div>

            {/* The gains table — every attack speed that truly saves time */}
            <div className="space-y-2">
                <h3 className="text-sm font-bold text-white tracking-wide">Worthwhile attack-speed breakpoints</h3>
                <div className="overflow-x-auto custom-scrollbar border border-white/5 rounded-lg bg-black/25">
                    <table className="w-full text-left font-mono text-[10px] md:text-xs">
                        <thead>
                            <tr className="text-white/30 uppercase text-[9px] border-b border-white/5">
                                <th className="p-2.5 font-sans font-bold w-[84px]">Req. Speed</th>
                                <th className="p-2.5 font-sans font-bold w-[80px]">Time / hit</th>
                                <th className="p-2.5 font-sans font-bold w-[72px]">Interval</th>
                                <th className="p-2.5 font-sans font-bold w-[80px]">Double</th>
                                <th className="p-2.5 font-sans font-bold w-[72px]">DPS gain</th>
                                <th className="p-2.5 font-sans font-bold text-right w-[78px]">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {gains.map((g, i) => {
                                const prevEff = i === 0 ? timePerHit(attackIntervalSeconds(1, weaponAttackDuration), doubleDelaySeconds(1, weaponWindupTime), dc) : gains[i - 1].effective;
                                const dpsGain = (dps(g.effective) / dps(prevEff) - 1) * 100;
                                const isReached = currentBonus >= g.reqBonus - 0.01;
                                const isNext = nextGain && g.reqBonus === nextGain.reqBonus;
                                return (
                                    <tr
                                        key={g.reqBonus}
                                        className={cn(
                                            'transition-colors',
                                            // Every listed row is a real DPS gain -> highlight them all as targets.
                                            isReached
                                                ? 'text-green-400/90 bg-green-500/[0.07]'
                                                : isNext
                                                    ? 'text-purple-100 bg-purple-500/20 ring-1 ring-inset ring-purple-400/40'
                                                    : 'text-white/85 bg-accent-primary/[0.07] hover:bg-accent-primary/[0.12]',
                                            g.cause !== 'single' && 'border-l-2 border-dashed border-l-purple-500/50'
                                        )}
                                    >
                                        <td className="p-2.5 font-bold whitespace-nowrap">+{g.reqBonus.toFixed(1)}%</td>
                                        <td className="p-2.5 font-bold">{g.effective.toFixed(2)}s</td>
                                        <td className={cn('p-2.5 font-bold', (g.cause === 'single' || g.cause === 'both') ? 'text-orange-400' : 'text-white/45')}>{g.single.toFixed(1)}s</td>
                                        <td className={cn('p-2.5 font-bold', (g.cause === 'double' || g.cause === 'both') ? 'text-purple-300' : 'text-white/45')}>{(g.single + g.delay).toFixed(1)}s</td>
                                        <td className="p-2.5 text-green-400/90">+{dpsGain.toFixed(1)}%</td>
                                        <td className="p-2.5 text-right font-sans font-bold text-[9px] uppercase">
                                            {isReached ? <span className="text-green-400">Reached</span>
                                                : isNext ? <span className="text-purple-200">Next</span>
                                                    : <span className="text-accent-primary/80">Target</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="text-[10px] text-white/40">
                    <strong>Interval</strong> = time between normal attacks; <strong>Double</strong> = full time for a double sequence
                    (both absolute — lower is better). The coloured column is the one that improves at that breakpoint
                    (orange = single, purple = double). Double breakpoints only matter while your double chance &gt; 0.
                </p>
                <p className="text-[10px] text-emerald-400/70 flex items-start gap-1.5">
                    <Heart className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>
                        These same breakpoints also raise your <strong>lifesteal HPS</strong> — it scales 1:1 with the real attack
                        rate. Only the lifesteal share of your healing follows them though; flat health-regen and skill healing don&apos;t
                        change with attack speed, so your total HPS gain is smaller than the DPS % shown here unless you heal purely from lifesteal.
                    </span>
                </p>
            </div>
        </div>
    );
});

// Formula reference — reverse-engineered from the game binary (libil2cpp.so, 2.8.2).
export const BreakpointExplanation = memo(() => (
    <div className="mt-8 space-y-4 text-[11px] text-white/50 leading-relaxed border-t border-white/10 pt-6 font-sans">
        <h4 className="text-xs font-bold text-white uppercase tracking-wider">How attack timing works (from the game binary)</h4>
        <p className="text-white/50">
            Combat runs at <strong>10 sim-ticks per second</strong> (0.1s per tick). Each unit has one continuous
            AttackTimer that advances by <code className="text-white/70">dt × attackSpeed</code> each tick
            (<code className="text-white/70">dt = ⌊2³²/10⌋/2³² ≈ 0.09999999976s</code>): it fires at the windup
            threshold and resets at the full <strong>AttackDuration (1.5s for every weapon)</strong>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
                <div>
                    <span className="text-orange-400 font-bold uppercase block mb-0.5 text-[10px]">Single-attack interval</span>
                    <span className="font-mono text-[9px] bg-white/5 px-1 py-0.5 rounded text-orange-300 block w-fit mb-1 font-bold">
                        interval = (ceil(AttackDuration / inc) + 1) × 0.1s
                    </span>
                    Time between normal attacks. <strong>Identical for every weapon and skin</strong> — it depends only on
                    attack speed, not on windup (windup and recovery share one timer). The <code>+1</code> is the idle
                    re-acquire tick.
                </div>
                <div>
                    <span className="text-purple-400 font-bold uppercase block mb-0.5 text-[10px]">Double 2nd-hit delay</span>
                    <span className="font-mono text-[9px] bg-white/5 px-1 py-0.5 rounded text-purple-300 block w-fit mb-1 font-bold">
                        delay = ceil(0.25 × Windup / inc) × 0.1s  (min 0.1s)
                    </span>
                    The gap before the second strike when Double Damage procs. When a double triggers, the timer is
                    re-seeded to <code>Windup × 0.75</code>, so it must climb the remaining <code>0.25 × Windup</code>.
                    This is the <strong>only</strong> place the weapon&apos;s windup changes attack timing.
                </div>
            </div>
            <div className="space-y-4">
                <div>
                    <span className="text-fuchsia-400 font-bold uppercase block mb-0.5 text-[10px]">Effective time / hit</span>
                    <span className="font-mono text-[9px] bg-white/5 px-1 py-0.5 rounded text-fuchsia-300 block w-fit mb-1 font-bold">
                        timePerHit = (interval + doubleChance × delay) / (1 + doubleChance)
                    </span>
                    What the breakpoint table optimises. A double turns one cycle into two hits, so higher double chance
                    makes the windup-driven double breakpoints matter more.
                </div>
                <div>
                    <span className="text-white/70 font-bold uppercase block mb-0.5 text-[10px]">inc (per-tick advance)</span>
                    <span className="font-mono text-[9px] bg-white/5 px-1 py-0.5 rounded text-white/70 block w-fit mb-1 font-bold">
                        inc = floor(dt_raw × round(attackSpeed × 1e6) / 2³²)
                    </span>
                    Fixed-point (FD6) increment per tick. Truncation of both <code>dt</code> and this product is what makes
                    the breakpoints land exactly where measured in-game.
                </div>
            </div>
        </div>
    </div>
));
