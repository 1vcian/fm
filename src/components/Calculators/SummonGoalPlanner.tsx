import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AscensionStars, type AscensionType } from '../UI/AscensionStars';
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { RARITIES } from '../../utils/constants';
import { summonLevelsAt } from '../../utils/summonEngine';


/** The best rarity a summon level can drop and its chance, from the summon config's Levels row. */
function topRarity(row: any): string {
    if (!row) return '';
    const r = [...RARITIES].reverse().find(x => row[x] > 0);
    if (!r) return '';
    const pct = row[r] * 100;
    return `${r} ${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

/**
 * Summon levels and ascensions, laid out as the Forge calculator's planner: start (the sandbox's
 * ascension and the level above) to an end ascension and level, with the currency it takes.
 */
export function SummonGoalPlanner({
    title, type, levelsByAscension, level, progress, startAscension, profileAscension, onStartAscension, maxAscension,
    needed, costPerSummon, currencyIcon, currencyLabel, available, onSetAvailable,
}: {
    title: string;
    type: AscensionType;
    /** The level table of each ascension (`summonLevelsByAscension`; row n - 1 is level n). */
    levelsByAscension: any[][];
    level: number;
    progress: number;
    startAscension: number;
    profileAscension: number;
    onStartAscension: (v: number) => void;
    maxAscension: number;
    /** Currency to go from the start to (level, ascension). */
    needed: (targetLevel: number, targetAscension: number) => number;
    costPerSummon: number;
    currencyIcon: string;
    currencyLabel: string;
    available: number;
    onSetAvailable: (v: number) => void;
}) {
    const [endAscInput, setEndAsc] = useState<number | null>(null);
    const endAsc = Math.min(maxAscension, Math.max(startAscension, endAscInput ?? maxAscension));
    // Each ascension levels through its own table (SummonConfig.GetLevels, RVA 0x7D03870).
    const levels = summonLevelsAt(levelsByAscension, endAsc);
    const maxLevel = levels.length;
    const [endLevelInput, setEndLevel] = useState<number | null>(null);
    const minEnd = endAsc === startAscension ? Math.min(maxLevel, Math.max(1, level)) : 1;
    const endLevel = Math.min(maxLevel, Math.max(minEnd, endLevelInput ?? maxLevel));
    const cost = needed(endLevel, endAsc);
    const summons = costPerSummon > 0 ? Math.round(cost / costPerSummon) : 0;
    const missing = Math.max(0, cost - available);
    const num = (v: number) => new Intl.NumberFormat('en-US').format(Math.round(v));

    return (
        <div className="card p-4 border-amber-500/30 bg-bg-secondary/30 backdrop-blur-md space-y-4">
            <div className="flex items-center gap-2">
                <GameAssetIcon asset={{ icon: currencyIcon }} size={18} />
                <h3 className="text-sm font-bold text-white">{title}</h3>
            </div>
            <p className="text-[11px] text-text-muted">
                {currencyLabel} from start to end. Reaching the top level ascends and starts again from level 1.
                Costs and drops use your profile's tech or the sandbox above.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
                <div className="rounded-xl border border-white/10 bg-black/10 p-3 space-y-3 min-w-0">
                    <div className="text-[10px] text-text-muted uppercase font-black tracking-wider">Start</div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <AscensionStars value={startAscension} onChange={onStartAscension} type={type} max={maxAscension} size="sm" className="items-start" />
                        {startAscension !== profileAscension && (
                            <button onClick={() => onStartAscension(profileAscension)} className="text-[10px] text-accent-primary hover:underline">Reset to my profile ({profileAscension})</button>
                        )}
                    </div>
                    <div className="space-y-1">
                        <div className="text-[10px] text-text-muted uppercase font-bold">Summon level</div>
                        <div className="text-xs">
                            <span className="font-mono font-black text-base">{level}</span>
                            {progress > 0 && <span className="text-text-muted"> + {num(progress)} progress</span>}
                            <span className="text-text-muted"> (the Current Level below)</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-center text-text-muted">
                    <ArrowRight className="w-5 h-5 rotate-90 sm:rotate-0" />
                </div>
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 space-y-3 min-w-0">
                    <div className="text-[10px] text-amber-300 uppercase font-black tracking-wider">End</div>
                    <AscensionStars value={endAsc} onChange={v => setEndAsc(Math.max(startAscension, v))} type={type} max={maxAscension} size="sm" className="items-start" />
                    <div className="space-y-1">
                        <div className="text-[10px] text-text-muted uppercase font-bold">Summon level</div>
                        <div className="flex items-center gap-2">
                            <input type="range" min={minEnd} max={maxLevel} value={endLevel} onChange={e => setEndLevel(Number(e.target.value))} className="flex-1 min-w-0 accent-amber-400" />
                            <span className="font-mono font-black text-base w-8 text-right">{endLevel}</span>
                        </div>
                        <div className="text-[10px] text-text-muted text-right">{topRarity(levels[endLevel - 1])}</div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl px-3 py-2 border bg-amber-400/10 border-amber-400/50">
                    <div className="text-[10px] uppercase font-bold text-amber-300 flex items-center gap-1"><GameAssetIcon asset={{ icon: currencyIcon }} size={14} /> {currencyLabel} needed</div>
                    <div className="font-black font-mono text-lg">{num(cost)}</div>
                    <button
                        onClick={() => onSetAvailable(cost)}
                        className="mt-1 text-[10px] text-accent-primary hover:underline font-bold uppercase"
                    >
                        Set as available
                    </button>
                </div>
                <div className="rounded-xl px-3 py-2 border border-white/10 bg-bg-input/40">
                    <div className="text-[10px] uppercase font-bold text-text-muted">Summons</div>
                    <div className="font-black font-mono text-lg">{num(summons)}</div>
                    <div className="text-[10px] text-text-muted">{num(costPerSummon)} each</div>
                </div>
                <div className="rounded-xl px-3 py-2 border border-white/10 bg-bg-input/40">
                    <div className="text-[10px] uppercase font-bold text-text-muted flex items-center gap-1"><GameAssetIcon asset={{ icon: currencyIcon }} size={14} /> Still missing</div>
                    <div className={`font-black font-mono text-lg ${missing === 0 ? 'text-green-400' : ''}`}>{missing === 0 ? 'None' : num(missing)}</div>
                    <div className="text-[10px] text-text-muted">{num(available)} available</div>
                </div>
                <div className="rounded-xl px-3 py-2 border border-white/10 bg-bg-input/40">
                    <div className="text-[10px] uppercase font-bold text-text-muted flex items-center gap-1"><GameAssetIcon asset={{ icon: 'AscensionStar' }} size={14} /> Ascensions</div>
                    <div className="font-black font-mono text-lg">{startAscension} to {endAsc}</div>
                </div>
            </div>
        </div>
    );
}
