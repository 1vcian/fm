import { useEffect, useMemo, useRef } from 'react';
import { X, Layers, Check, Loader2 } from 'lucide-react';
import { useLoadoutSweep, SweepMetric, SweepResult, LoadoutCombo } from '../../hooks/useLoadoutSweep';
import { usePetNames } from '../../hooks/usePetNames';
import { useGameData } from '../../hooks/useGameData';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { PetSlot, MountSlot, UserProfile } from '../../types/Profile';
import { cn } from '../../lib/utils';

/** The metrics the AUTO buttons offer. */
export type AutoLoadoutMetric = Extract<SweepMetric, 'dps' | 'power' | 'lifesteal' | 'balanced'>;

const TOP_N = 5;

const METRIC_INFO: Record<AutoLoadoutMetric, { title: string; note: string }> = {
    dps: {
        title: 'Best DPS',
        note: 'Real-time total DPS: weapon, skills and skill buffs on the stepped attack timing.'
    },
    power: {
        title: 'Best Power',
        note: 'Power as shown on the profile.'
    },
    lifesteal: {
        title: 'Best Lifesteal/sec',
        note: 'Real-time weapon DPS x lifesteal. An upper bound: in game each heal is capped at max HP.'
    },
    balanced: {
        title: 'Best Balanced',
        note: 'Geometric mean of DPS and HPS, each relative to the best combination found. A heuristic for ranking builds, not a game number.'
    }
};

const comboKey = (pets: PetSlot[] | null | undefined, mount: MountSlot | null | undefined) =>
    JSON.stringify([
        (pets || []).map(p => [p.id, p.rarity, p.level, p.secondaryStats]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        mount ? [mount.id, mount.rarity, mount.level, mount.secondaryStats] : null
    ]);

interface LoadoutSweepPopoverProps {
    metric: AutoLoadoutMetric;
    /** Snapshot of the build to search over (a new identity restarts the search). */
    base: UserProfile;
    respectSavedLevels: boolean;
    onToggleRespectSavedLevels: () => void;
    /** Pets/mount currently in the target build, to mark the loaded row. */
    currentPets: PetSlot[];
    currentMount: MountSlot | null;
    onLoad: (combo: LoadoutCombo) => void;
    onClose: () => void;
    /** Where a clicked row goes, e.g. "Test". */
    targetLabel: string;
}

/**
 * Top pets + mount combinations for one metric, from the time-sliced loadout sweep.
 * Desktop: a dropdown under the AUTO buttons. Phone: an inline panel under them.
 */
export function LoadoutSweepPopover({
    metric, base, respectSavedLevels, onToggleRespectSavedLevels,
    currentPets, currentMount, onLoad, onClose, targetLabel
}: LoadoutSweepPopoverProps) {
    const { status, progress, totalCombos, rank, isReady } = useLoadoutSweep({ base, respectSavedLevels });
    const petName = usePetNames();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const rootRef = useRef<HTMLDivElement>(null);

    const top = useMemo(() => (status === 'done' ? rank(metric).slice(0, TOP_N) : []), [status, rank, metric]);
    const bestScore = top[0]?.score || 0;
    const currentKey = comboKey(currentPets, currentMount);

    // Close on Escape and on a press outside the popover.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        const onDown = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Element | null;
            if (!rootRef.current || !target || rootRef.current.contains(target)) return;
            // The AUTO buttons switch the metric themselves; let their click through.
            if (target.closest?.('[data-auto-loadout-trigger]')) return;
            onClose();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
        };
    }, [onClose]);

    const mountName = (m: MountSlot | null): string => {
        if (!m) return 'No mount';
        if (m.customName) return m.customName;
        // The game's English name first (as usePetNames does for pets), then the sprite mapping.
        const localized = localization?.mounts?.[`${m.rarity}_${m.id}`]?.en;
        if (localized) return localized;
        const entry = Object.values(spriteMapping?.mounts?.mapping || {}).find(
            (v: any) => v?.id === m.id && v?.rarity === m.rarity
        ) as any;
        return entry?.name || `${m.rarity} Mount`;
    };

    const valueOf = (r: SweepResult): string => {
        switch (metric) {
            case 'dps': return `${formatCompactNumber(r.dps)} DPS`;
            case 'power': return `${formatCompactNumber(r.power)} PWR`;
            case 'lifesteal': return `${formatCompactNumber(r.lifestealPerSec)}/s`;
            case 'balanced': return `${formatCompactNumber(r.dps)} DPS, ${formatCompactNumber(r.healPerSec)} HPS`;
        }
    };

    const info = METRIC_INFO[metric];

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label={info.title}
            data-testid="loadout-sweep-popover"
            className={cn(
                "z-50 flex flex-col rounded-xl border border-border bg-bg-primary shadow-2xl shadow-black/50 text-left",
                // Phone: an inline panel under the buttons (full row width, in the page flow).
                // Desktop: a dropdown under the buttons.
                "relative w-full col-span-full max-h-[70vh]",
                "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:left-1/2 sm:-translate-x-1/2 sm:w-[440px] sm:max-h-[60vh]"
            )}
        >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                <div className="min-w-0">
                    <div className="text-xs font-bold text-text-primary">{info.title}</div>
                    <div className="text-[10px] text-text-muted">Click a row to load it into {targetLabel}</div>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 shrink-0"
                    aria-label="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {(!isReady || status !== 'done') && (
                    <div className="px-3 py-4 space-y-2">
                        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {isReady ? `Scoring ${totalCombos.toLocaleString()} combinations` : 'Loading game data'}
                        </div>
                        <div className="h-1.5 rounded-full bg-bg-input overflow-hidden">
                            <div className="h-full bg-accent-primary transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                )}

                {status === 'done' && top.length === 0 && (
                    <div className="px-3 py-4 text-[11px] text-text-muted">No saved pets or mounts to compare.</div>
                )}

                {top.length > 0 && (
                    <ol className="divide-y divide-border/60">
                        {top.map(({ result, score }, i) => {
                            const pct = bestScore > 0 ? (score / bestScore) * 100 : 0;
                            const loaded = comboKey(result.petSet, result.mount) === currentKey;
                            return (
                                <li key={i}>
                                    <button
                                        onClick={() => onLoad({ petSet: result.petSet, mount: result.mount })}
                                        data-testid="loadout-sweep-row"
                                        className={cn(
                                            "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors",
                                            loaded ? "bg-accent-primary/10" : "hover:bg-white/5"
                                        )}
                                    >
                                        <span className="w-4 shrink-0 text-[11px] font-bold text-text-muted pt-0.5">{i + 1}</span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[11px] text-text-primary truncate">
                                                {result.petSet.map(p => `${p.customName || petName(p.rarity, p.id)} Lv${p.level}`).join(', ') || 'No pets'}
                                            </span>
                                            <span className="block text-[10px] text-text-muted truncate">
                                                {mountName(result.mount)}{result.mount ? ` Lv${result.mount.level}` : ''}
                                            </span>
                                            <span className="block text-[10px] text-text-secondary font-mono">{valueOf(result)}</span>
                                        </span>
                                        <span className="shrink-0 flex flex-col items-end gap-0.5">
                                            <span className={cn(
                                                "text-[11px] font-mono font-bold",
                                                i === 0 ? "text-green-400" : "text-text-secondary"
                                            )}>
                                                {pct.toFixed(1)}%
                                            </span>
                                            {loaded && (
                                                <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase text-accent-primary">
                                                    <Check className="w-3 h-3" /> Loaded
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>

            <div className="px-3 py-2 border-t border-border space-y-2">
                <button
                    onClick={onToggleRespectSavedLevels}
                    role="switch"
                    aria-checked={respectSavedLevels}
                    className="w-full flex items-center justify-between gap-2 text-[11px] text-text-secondary hover:text-text-primary"
                    title="On: score saved builds at their own level. Off: score everything at level 1, so only secondary stats decide. Loading always keeps the saved level."
                >
                    <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5" />
                        Respect saved levels
                    </span>
                    <span className={cn(
                        "relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors",
                        respectSavedLevels ? "bg-accent-primary" : "bg-bg-input border border-border"
                    )}>
                        <span className={cn(
                            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all",
                            respectSavedLevels ? "left-3.5" : "left-0.5"
                        )} />
                    </span>
                </button>
                <p className="text-[10px] leading-snug text-text-muted">
                    {info.note} % is relative to the best combination.
                </p>
            </div>
        </div>
    );
}
