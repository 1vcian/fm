import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trophy, Loader2, Play, Square, Check } from 'lucide-react';
import { useBuildOptimizer } from '../../hooks/useBuildOptimizer';
import { applyTreeMode, useStatLibraries } from '../../hooks/useGlobalStats';
import { useGameData } from '../../hooks/useGameData';
import { useProfile } from '../../context/ProfileContext';
import { useTreeMode } from '../../context/TreeModeContext';
import { useComparison } from '../../context/ComparisonContext';
import { usePetNames } from '../../hooks/usePetNames';
import { useMountName } from './LoadoutSweepPopover';
import { pvpConfigFromJson } from '../../pvp/simulate';
import {
    DEFAULT_OPTIMIZER_OPTIONS, ownedSkillLevels, skillMaxLevel,
    type Candidate, type OptimizerScope, type RankedCandidate
} from '../../optimizer/buildOptimizer';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { UserProfile } from '../../types/Profile';
import { cn } from '../../lib/utils';

interface BuildOptimizerModalProps {
    /** The build to improve (before the header's tree mode, which is applied here). */
    base: UserProfile;
    onLoad: (c: Candidate) => void;
    onClose: () => void;
    /** Where a loaded row goes, e.g. "Test". */
    targetLabel: string;
}

const SCOPES: { id: OptimizerScope; label: string }[] = [
    { id: 'all', label: 'Skills + pets + mount' },
    { id: 'skills', label: 'Skills' },
    { id: 'loadout', label: 'Pets + mount' },
];

const skillName = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');
const buildKey = (c: Pick<Candidate, 'skills' | 'petSet' | 'mount'>) =>
    JSON.stringify([
        c.skills.map(s => `${s.id}:${s.level}`).sort(),
        c.petSet.map(p => [p.id, p.rarity, p.level, p.secondaryStats]),
        c.mount ? [c.mount.id, c.mount.rarity, c.mount.level, c.mount.secondaryStats] : null,
    ]);

/**
 * The build optimizer: stage 1 scores every candidate with the analytic formulas, stage 2 fights
 * the best of them in simulated arena battles against a reference (useBuildOptimizer, in a worker).
 */
export function BuildOptimizerModal({ base, onLoad, onClose, targetLabel }: BuildOptimizerModalProps) {
    const { libs, ready } = useStatLibraries();
    const { treeMode } = useTreeMode();
    const { excludeSubstats } = useComparison();
    const { profiles, activeProfileId } = useProfile();
    const { data: pvpBaseConfig } = useGameData<any>('PvpBaseConfig.json');
    const pvpConfig = useMemo(() => pvpConfigFromJson(pvpBaseConfig), [pvpBaseConfig]);
    const petName = usePetNames();
    const mountName = useMountName();
    const opt = useBuildOptimizer();

    const [scope, setScope] = useState<OptimizerScope>('all');
    const [ownedOnly, setOwnedOnly] = useState(false);
    const configMaxLevel = useMemo(() => {
        const lib = (libs.skillLibrary || {}) as Record<string, any>;
        return Object.values(lib).reduce((m: number, e: any) => Math.max(m, skillMaxLevel(e)), 1);
    }, [libs.skillLibrary]);
    const [unownedLevel, setUnownedLevel] = useState<number | null>(null);
    const level = unownedLevel ?? configMaxLevel;
    const [referenceId, setReferenceId] = useState<string>('mirror');
    const [loadedKey, setLoadedKey] = useState<string | null>(null);

    const owned = useMemo(() => ownedSkillLevels(base), [base]);
    const ownedCount = Object.keys(owned).length;
    const otherProfiles = profiles.filter(p => p.id !== activeProfileId);
    const canRun = ready && !!pvpConfig && !!libs.skillLibrary;

    const start = () => {
        if (!canRun || !pvpConfig) return;
        const refProfile = referenceId === 'mirror' ? null : profiles.find(p => p.id === referenceId) ?? null;
        opt.run({
            base: applyTreeMode(base, treeMode, libs),
            reference: refProfile,
            referenceName: refProfile ? (refProfile.name || 'Saved profile') : 'Mirror',
            pvpConfig,
            options: {
                ...DEFAULT_OPTIMIZER_OPTIONS,
                scope,
                ownedSkillsOnly: ownedOnly,
                unownedSkillLevel: level,
                excludeSubstats,
            },
        }, libs);
        setLoadedKey(null);
    };

    const running = opt.status === 'running';
    const pct = running && opt.total > 0
        ? (opt.stage === 1 ? 0 : 30) + (opt.done / opt.total) * (opt.stage === 1 ? 30 : 70)
        : opt.status === 'done' ? 100 : 0;
    const ranked = opt.result?.ranked ?? [];

    const load = (c: RankedCandidate) => {
        onLoad(c);
        setLoadedKey(buildKey(c));
    };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-black/80 sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Build optimizer"
                data-testid="build-optimizer"
                className="bg-bg-primary w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[92vh] sm:rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-bg-secondary/40">
                    <div className="flex items-center gap-2 min-w-0">
                        <Trophy className="w-5 h-5 text-yellow-400 shrink-0" />
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-text-primary">Best build</div>
                            <div className="text-[10px] text-text-muted truncate">Ranked by simulated arena win rate. Load a row into {targetLabel}.</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 shrink-0" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-border space-y-3">
                    <div className="flex flex-wrap gap-1">
                        {SCOPES.map(s => (
                            <button
                                key={s.id}
                                onClick={() => setScope(s.id)}
                                disabled={running}
                                className={cn(
                                    'px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors',
                                    scope === s.id ? 'bg-accent-primary/20 border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5'
                                )}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className={cn('space-y-2', scope === 'loadout' && 'opacity-40 pointer-events-none')}>
                            <button
                                role="switch"
                                aria-checked={ownedOnly}
                                data-testid="optimizer-owned-only"
                                onClick={() => setOwnedOnly(v => !v)}
                                disabled={running}
                                className="w-full flex items-center justify-between gap-2 text-[11px] text-text-secondary hover:text-text-primary"
                            >
                                <span>Only skills I own ({ownedCount})</span>
                                <span className={cn('relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors', ownedOnly ? 'bg-accent-primary' : 'bg-bg-input border border-border')}>
                                    <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all', ownedOnly ? 'left-3.5' : 'left-0.5')} />
                                </span>
                            </button>
                            <label className={cn('flex items-center justify-between gap-2 text-[11px] text-text-secondary', ownedOnly && 'opacity-40')}>
                                <span>Level for skills I don't own</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={configMaxLevel}
                                    value={level}
                                    disabled={ownedOnly || running}
                                    onChange={e => {
                                        const v = Math.round(Number(e.target.value));
                                        if (Number.isFinite(v)) setUnownedLevel(Math.max(1, Math.min(configMaxLevel, v)));
                                    }}
                                    className="w-16 px-2 py-0.5 rounded bg-bg-input border border-border text-text-primary text-right font-mono"
                                />
                            </label>
                            <p className="text-[10px] text-text-muted leading-snug">
                                Owned skills use their own level. Max in the config: {configMaxLevel}.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                                <span>Opponent</span>
                                <select
                                    value={referenceId}
                                    onChange={e => setReferenceId(e.target.value)}
                                    disabled={running}
                                    data-testid="optimizer-opponent"
                                    className="max-w-[60%] px-2 py-0.5 rounded bg-bg-input border border-border text-text-primary"
                                >
                                    <option value="mirror">Mirror of this build</option>
                                    {otherProfiles.map(p => <option key={p.id} value={p.id}>{p.name || 'Saved profile'}</option>)}
                                </select>
                            </label>
                            <p className="text-[10px] text-text-muted leading-snug">
                                Each finalist fights {DEFAULT_OPTIMIZER_OPTIONS.battlesPerSide * 2} battles: the same{' '}
                                {DEFAULT_OPTIMIZER_OPTIONS.battlesPerSide} seeds as Player 1 and as Player 2, so the turn order cancels out.
                                Pets and mounts: your saved builds only (config pets have no rolled secondary stats to compare).
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!running ? (
                            <button
                                onClick={start}
                                disabled={!canRun}
                                data-testid="optimizer-run"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-primary text-white text-[11px] font-bold disabled:opacity-40"
                            >
                                <Play className="w-3.5 h-3.5" /> {opt.status === 'done' ? 'Run again' : 'Find the best build'}
                            </button>
                        ) : (
                            <button
                                onClick={opt.cancel}
                                data-testid="optimizer-cancel"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-500/50 text-red-400 text-[11px] font-bold hover:bg-red-500/10"
                            >
                                <Square className="w-3.5 h-3.5" /> Cancel
                            </button>
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="h-1.5 rounded-full bg-bg-input overflow-hidden">
                                <div className="h-full bg-accent-primary transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="text-[10px] text-text-muted mt-0.5 truncate" data-testid="optimizer-status">
                                {!canRun && 'Loading game data'}
                                {canRun && opt.status === 'idle' && 'Ready'}
                                {running && opt.stage === 1 && `Stage 1: scoring builds with the formulas${opt.total ? ` (${opt.done.toLocaleString()} / ${opt.total.toLocaleString()})` : ''}`}
                                {running && opt.stage === 2 && `Stage 2: arena battles (${opt.done} / ${opt.total} finalists)`}
                                {opt.status === 'cancelled' && 'Cancelled'}
                                {opt.status === 'error' && `Failed: ${opt.error}`}
                                {opt.status === 'done' && opt.result && opt.wallMs !== null &&
                                    `${opt.result.scored.toLocaleString()} builds scored, ${opt.result.battles.toLocaleString()} battles vs ${opt.result.referenceName}, ${(opt.wallMs / 1000).toFixed(1)} s`}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {running && ranked.length === 0 && (
                        <div className="flex items-center gap-2 px-4 py-6 text-[11px] text-text-secondary">
                            <Loader2 className="w-4 h-4 animate-spin" /> Searching, the page stays usable meanwhile
                        </div>
                    )}
                    {ranked.length > 0 && (
                        <ol className="divide-y divide-border/60">
                            {ranked.map((c, i) => {
                                const isLoaded = loadedKey === buildKey(c);
                                return (
                                    <li key={i} className={cn('px-4 py-2.5 flex items-start gap-2', isLoaded && 'bg-accent-primary/10')} data-testid="optimizer-row">
                                        <span className="w-5 shrink-0 text-[11px] font-bold text-text-muted pt-0.5">{i + 1}</span>
                                        <div className="flex-1 min-w-0 space-y-0.5">
                                            <div className="text-[11px] text-text-primary break-words">
                                                {c.skills.map(s => `${skillName(s.id)} Lv${s.level}${owned[s.id] ? '' : '*'}`).join(', ') || 'No skills'}
                                                {c.isCurrent && <span className="ml-1.5 text-[9px] font-bold uppercase text-accent-primary">Current</span>}
                                            </div>
                                            <div className="text-[10px] text-text-muted break-words">
                                                {c.petSet.map(p => `${p.customName || petName(p.rarity, p.id)} Lv${p.level}`).join(', ') || 'No pets'}
                                                {' / '}{mountName(c.mount)}{c.mount ? ` Lv${c.mount.level}` : ''}
                                            </div>
                                            <div className="text-[10px] text-text-secondary font-mono">
                                                {formatCompactNumber(c.dps)} DPS, {formatCompactNumber(c.hps)} HPS, {formatCompactNumber(c.power)} PWR
                                            </div>
                                        </div>
                                        <div className="shrink-0 flex flex-col items-end gap-1">
                                            <span className={cn('text-[12px] font-mono font-bold', i === 0 ? 'text-green-400' : 'text-text-primary')} data-testid="optimizer-winrate">
                                                {(c.winRate * 100).toFixed(1)}% <span className="text-[10px] text-text-muted font-normal">± {(c.winRateSe * 100).toFixed(1)}</span>
                                            </span>
                                            <span className="text-[9px] font-mono text-text-muted" title="Mean of own HP fraction minus the opponent's at the end of each battle">
                                                HP margin {c.hpMargin >= 0 ? '+' : ''}{(c.hpMargin * 100).toFixed(1)}%
                                            </span>
                                            <button
                                                onClick={() => load(c)}
                                                data-testid="optimizer-load"
                                                className={cn(
                                                    'px-2 py-0.5 rounded text-[10px] font-bold border',
                                                    isLoaded ? 'border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5'
                                                )}
                                            >
                                                {isLoaded ? <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Loaded</span> : `Load into ${targetLabel}`}
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>

                <div className="px-4 py-2 border-t border-border text-[10px] text-text-muted leading-snug">
                    Stage 1 scores every candidate with the formulas (real-time DPS, HPS, Power) and keeps the best of each view.
                    Stage 2 ranks the finalists by win rate (a draw counts half), then HP margin. * = a skill you don't own, at the chosen level.
                </div>
            </div>
        </div>,
        document.body
    );
}
