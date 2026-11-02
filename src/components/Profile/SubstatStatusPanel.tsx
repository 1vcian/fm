import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useStatLibraries } from '../../hooks/useGlobalStats';
import { formatStatValue, getStatName } from '../../utils/statNames';
import { presetPerfections } from '../../utils/fairies';
import { compareToAim, loadAimTarget, saveAimTarget, substatStatus, suggestedPerfection, type AimRow, type AimVerdict } from '../../utils/substatStatus';
import { PerfectionMeter } from '../UI/PerfectionMeter';
import { cn } from '../../lib/utils';

/** How each verdict reads, most urgent first. */
const VERDICTS: Record<AimVerdict, { label: string; tone: string; order: number }> = {
    missing: { label: 'Missing', tone: 'bg-red-500/20 text-red-300 border-red-500/40', order: 0 },
    fewer: { label: 'Needs more rolls', tone: 'bg-orange-500/20 text-orange-300 border-orange-500/40', order: 1 },
    improve: { label: 'Improve', tone: 'bg-amber-400/20 text-amber-200 border-amber-400/40', order: 2 },
    notNeeded: { label: 'Not needed', tone: 'bg-white/10 text-text-muted border-white/20', order: 3 },
    extra: { label: 'Slot to spare', tone: 'bg-white/10 text-text-muted border-white/20', order: 4 },
    done: { label: 'Done', tone: 'bg-green-500/20 text-green-300 border-green-500/40', order: 5 },
};

/** What to do about one row, in a few words. */
function advice(r: AimRow): string {
    const t = r.target, y = r.yours;
    const short = y?.total != null ? `your total is ${y.total.toFixed(0)}% of the build's` : '';
    switch (r.verdict) {
        case 'missing': return `The build has ${t!.rolls} rolls of it, you have none.`;
        case 'fewer': return `${t!.rolls - y!.rolls} more ${t!.rolls - y!.rolls === 1 ? 'roll' : 'rolls'} or better ones: ${short}.`;
        case 'improve': return `Enough rolls, but ${short}: reroll the weakest.`;
        case 'extra': return `Total reached with ${y!.rolls - t!.rolls} more ${y!.rolls - t!.rolls === 1 ? 'roll' : 'rolls'} than the build: ${short}.`;
        case 'notNeeded': return `The build has none: these slots can roll something it needs.`;
        case 'done': return `Total reached: ${short}.`;
    }
}

/**
 * How close the active profile's substat rolls are to their top roll, per substat and overall,
 * the preset builds level that fits them, and, with a build aimed for (Preset Builds ranking,
 * "Aim for"), what is missing, what to improve and what is not needed.
 */
export function SubstatStatusPanel({ className }: { className?: string }) {
    const { profile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { libs } = useStatLibraries();
    const status = useMemo(() => substatStatus(profile, libs.secondaryStatLibrary), [profile, libs.secondaryStatLibrary]);
    const levels = presetPerfections(selectedVersion);
    const suggested = levels.length > 1 ? suggestedPerfection(status.overall, levels) : null;
    const [aim, setAim] = useState(loadAimTarget);
    const rows = useMemo(() => (aim ? compareToAim(profile, aim, libs.secondaryStatLibrary) : [])
        .sort((a, b) => VERDICTS[a.verdict].order - VERDICTS[b.verdict].order), [aim, profile, libs.secondaryStatLibrary]);
    const done = rows.filter(r => r.verdict === 'done').length;
    const needed = rows.filter(r => r.target).length;

    const openPresets = (level: number) => {
        try { localStorage.setItem('presets_perfection', JSON.stringify(level)); } catch { /* blocked storage: the page opens at its last level */ }
    };
    const clearAim = () => { saveAimTarget(null); setAim(null); };
    /** The value of one roll at a perfection, in the stat's own units (UpperRange x perfection, as the builds roll it). */
    const roll = (statId: string, perfection: number) => ((libs.secondaryStatLibrary as any)?.[statId]?.UpperRange ?? 0) * perfection;

    return (
        <div className={cn('rounded-xl border border-border bg-bg-input/20 px-4 py-3 space-y-3', className)}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0">
                    <div className="text-sm font-black text-text-primary">Your substats</div>
                    <div className="text-xs text-text-secondary">
                        {status.rolls
                            ? `${status.rolls} rolls on ${profile.name}'s equipped items, pets and mount, each as a % of its top roll.`
                            : `${profile.name} has no substat rolls on the equipped items, pets or mount yet.`}
                    </div>
                </div>
                {status.overall !== null && (
                    <div className="flex items-center gap-2 text-xs font-bold">
                        <span className="text-text-secondary">Overall</span>
                        <PerfectionMeter value={status.overall} className="w-40" />
                    </div>
                )}
                {suggested !== null && (
                    <div className="flex items-center gap-2 text-xs ml-auto" title={`Each preset build rolls every substat at one level (${levels.join(', ')}%): this is the highest your overall average reaches`}>
                        <span className="text-text-secondary">Builds that fit your rolls:</span>
                        <Link to="/presets" onClick={() => openPresets(suggested)}
                            className="font-bold px-3 py-1.5 rounded-lg border border-accent-primary bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25">
                            {suggested}% preset builds
                        </Link>
                    </div>
                )}
            </div>

            {!aim && status.rows.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1.5">
                    {status.rows.map(r => (
                        <div key={r.statId} className="flex items-center gap-2 text-xs" title={`${r.rolls} rolls, lowest ${r.lowest.toFixed(1)}%`}>
                            <span className="w-36 shrink-0 truncate text-text-secondary">{getStatName(r.statId)} <span className="text-text-muted">x{r.rolls}</span></span>
                            <PerfectionMeter value={r.perfection} className="flex-1 min-w-0" />
                        </div>
                    ))}
                </div>
            )}

            {aim && (
                <div className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-text-primary">Aiming for {aim.name}</span>
                        <span className="text-text-muted">{done} of {needed} substats done</span>
                        {aim.version && selectedVersion && aim.version !== selectedVersion && (
                            <span className="text-amber-300">picked on game version {aim.version}</span>
                        )}
                        <Link to="/presets" className="ml-auto font-bold text-accent-primary hover:underline">Pick another build</Link>
                        <button onClick={clearAim} title="Stop aiming for this build" className="p-1 rounded hover:bg-white/10 text-text-muted"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-[10px] uppercase text-text-muted text-left">
                                    <th className="font-bold py-1 pr-3">Substat</th>
                                    <th className="font-bold py-1 pr-3">Build</th>
                                    <th className="font-bold py-1 pr-3 min-w-[160px]">Yours</th>
                                    <th className="font-bold py-1 pr-3">Status</th>
                                    <th className="font-bold py-1">What to do</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.statId} className="border-t border-white/5">
                                        <td className="py-1.5 pr-3 whitespace-nowrap text-text-secondary">{getStatName(r.statId)}</td>
                                        <td className="py-1.5 pr-3 whitespace-nowrap">
                                            {r.target ? (<>
                                                <div className="font-mono">x{r.target.rolls} at {r.target.perfection.toFixed(0)}%</div>
                                                <div className="text-[10px] text-text-muted">{formatStatValue(roll(r.statId, r.target.perfection))} each, {formatStatValue(roll(r.statId, r.target.perfection) * r.target.rolls)} total</div>
                                            </>) : <span className="text-text-muted">none</span>}
                                        </td>
                                        <td className="py-1.5 pr-3">
                                            {r.yours ? (
                                                <>
                                                    <div className="flex items-center gap-2"><span className="font-mono text-text-muted w-7">x{r.yours.rolls}</span><PerfectionMeter value={r.yours.perfection} className="flex-1 min-w-0" /></div>
                                                    <div className="text-[10px] text-text-muted">{formatStatValue(roll(r.statId, r.yours.perfection) * r.yours.rolls)} total</div>
                                                </>
                                            ) : <span className="text-text-muted">none</span>}
                                        </td>
                                        <td className="py-1.5 pr-3 whitespace-nowrap">
                                            <span className={cn('inline-block text-[10px] font-black uppercase px-1.5 py-0.5 rounded border', VERDICTS[r.verdict].tone)}>{VERDICTS[r.verdict].label}</span>
                                        </td>
                                        <td className="py-1.5 text-text-secondary">{advice(r)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="text-[11px] text-text-muted">
                        Rolls counted on the equipped items, pets and mount together. The rolls of one substat add up, so each substat is compared by its total: 88% + 92% counts as 90% + 90%.
                    </div>
                </div>
            )}
        </div>
    );
}
