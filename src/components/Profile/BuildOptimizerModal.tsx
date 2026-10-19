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
    DEFAULT_OPTIMIZER_OPTIONS, ownedSkillLevels, enumerateSkinChoices, skinChoiceKey,
    SEARCH_ALL, type Candidate, type OptimizerSearch, type RankedCandidate
} from '../../optimizer/buildOptimizer';
import { formatCompactNumber } from '../../utils/statsCalculator';
import { UserProfile } from '../../types/Profile';
import { cn } from '../../lib/utils';
import { SLOT_TO_SKIN_TYPE, setDisplayName, skinDisplayName } from '../../utils/skinArchive';

interface BuildOptimizerModalProps {
    /** The build to improve (before the header's tree mode, which is applied here). */
    base: UserProfile;
    onLoad: (c: Candidate) => void;
    onClose: () => void;
    /** Where a loaded row goes, e.g. "Test". */
    targetLabel: string;
}

const SEARCH_FIELDS: { id: keyof OptimizerSearch; label: string }[] = [
    { id: 'skills', label: 'Skills' },
    { id: 'pets', label: 'Pets' },
    { id: 'mount', label: 'Mount' },
    { id: 'fairy', label: 'Fairy' },
    { id: 'skins', label: 'Skins' },
];

const skillName = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');
const buildKey = (c: Pick<Candidate, 'skills' | 'petSet' | 'mount' | 'fairy' | 'skins'>) =>
    JSON.stringify([
        c.skills.map(s => `${s.id}:${s.level}`).sort(),
        c.petSet.map(p => [p.id, p.rarity, p.level, p.secondaryStats]),
        c.mount ? [c.mount.id, c.mount.rarity, c.mount.level, c.mount.secondaryStats] : null,
        c.fairy ? [c.fairy.name, c.fairy.level] : null,
        skinChoiceKey(c.skins),
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

    const [search, setSearch] = useState<OptimizerSearch>(SEARCH_ALL);
    const [referenceId, setReferenceId] = useState<string>('dummy');
    const [loadedKey, setLoadedKey] = useState<string | null>(null);

    const owned = useMemo(() => ownedSkillLevels(base), [base]);
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const archiveCount = base.skins?.saved?.length || 0;
    const skinCombos = useMemo(() => enumerateSkinChoices(base).length, [base]);
    /** "Helmet: Santa Helmet Lv2" for every skin slot of a row's choice. */
    const skinsLine = (c: Candidate) => c.skins
        ? Object.entries(c.skins).map(([slot, sk]) => {
            const saved = sk?.savedId ? base.skins?.saved?.find(x => x.id === sk.savedId) : undefined;
            const name = sk ? (saved?.customName || skinDisplayName(skinsLibrary, sk.type || SLOT_TO_SKIN_TYPE[slot], sk.idx)) : 'no skin';
            return `${slot}: ${name}${sk ? ` Lv${sk.level || 0}` : ''}`;
        }).join(', ')
        : null;
    const setsLine = (c: Candidate) => (c.sets || []).map(t =>
        `${setDisplayName(t.setId)} set ${t.pieces}/${t.requiredPieces} (${Object.entries(t.stats).map(([k, v]) => `${k} +${(v * 100).toFixed(0)}%`).join(', ')})`).join(', ');
    const ownedCount = Object.keys(owned).length;
    const otherProfiles = profiles.filter(p => p.id !== activeProfileId);
    const anySearch = Object.values(search).some(Boolean);
    const canRun = ready && !!pvpConfig && !!libs.skillLibrary && anySearch;
    const vsDummy = referenceId === 'dummy';

    const start = () => {
        if (!canRun || !pvpConfig) return;
        const refProfile = referenceId === 'mirror' || vsDummy ? null : profiles.find(p => p.id === referenceId) ?? null;
        opt.run({
            base: applyTreeMode(base, treeMode, libs),
            reference: refProfile,
            vsDummy,
            referenceName: vsDummy ? 'Test dummy' : refProfile ? (refProfile.name || 'Saved profile') : 'Mirror',
            pvpConfig,
            options: {
                ...DEFAULT_OPTIMIZER_OPTIONS,
                search,
                // Only the skills the player has unlocked, each at its own level.
                ownedSkillsOnly: true,
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
                            <div className="text-[10px] text-text-muted truncate">{vsDummy ? 'Ranked by DPS on the test dummy' : 'Ranked by simulated arena win rate'}. Load a row into {targetLabel}.</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 shrink-0" aria-label="Close">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 py-3 border-b border-border space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="optimizer-search">
                        <span className="text-[11px] text-text-secondary">Search</span>
                        {SEARCH_FIELDS.map(f => (
                            <label key={f.id} className="flex items-center gap-1.5 text-[11px] font-bold text-text-primary cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={search[f.id]}
                                    disabled={running}
                                    onChange={e => setSearch(prev => ({ ...prev, [f.id]: e.target.checked }))}
                                    data-testid={`optimizer-search-${f.id}`}
                                    className="accent-accent-primary w-3.5 h-3.5"
                                />
                                {f.label}
                            </label>
                        ))}
                        {!anySearch && <span className="text-[10px] text-red-400">Tick at least one</span>}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className={cn('space-y-2', !search.skills && 'opacity-40')}>
                            <p className="text-[11px] text-text-secondary leading-snug" data-testid="optimizer-owned-only">
                                Skills: only the {ownedCount} you have unlocked, each at its own level.
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
                                    <option value="dummy">Test dummy</option>
                                    <option value="mirror">Mirror of this build</option>
                                    {otherProfiles.map(p => <option key={p.id} value={p.id}>{p.name || 'Saved profile'}</option>)}
                                </select>
                            </label>
                            <p className="text-[10px] text-text-muted leading-snug">
                                {vsDummy
                                    ? <>Each finalist runs the combat engine against the test dummy for {DEFAULT_OPTIMIZER_OPTIONS.dummySeconds / 60} minutes of game time, after a 1 minute warm-up, and is ranked by the DPS it measures, then HPS.</>
                                    : <>Each finalist fights {DEFAULT_OPTIMIZER_OPTIONS.battlesPerSide * 2} battles: the same{' '}
                                        {DEFAULT_OPTIMIZER_OPTIONS.battlesPerSide} seeds as Player 1 and as Player 2, so the turn order cancels out.</>}
                                {' '}
                                Pets and mounts: your saved builds only (config pets have no rolled secondary stats to compare). Fairies: none and each fairy, at your fairy level, since the game keeps one level for the whole event.
                                {' '}Skins: on Weapon, Helmet and Body, the current one, none or any archive skin of that type ({archiveCount} in the archive, {skinCombos.toLocaleString()} combinations, each scored whole so set bonuses count).
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
                                {running && opt.stage === 2 && `Stage 2: ${vsDummy ? 'engine runs on the dummy' : 'arena battles'} (${opt.done} / ${opt.total} finalists)`}
                                {opt.status === 'cancelled' && 'Cancelled'}
                                {opt.status === 'error' && `Failed: ${opt.error}`}
                                {opt.status === 'done' && opt.result && opt.wallMs !== null &&
                                    (opt.result.vsDummy
                                        ? `${opt.result.scored.toLocaleString()} builds scored, ${ranked.length} finalists measured on the test dummy, ${(opt.wallMs / 1000).toFixed(1)} s`
                                        : `${opt.result.scored.toLocaleString()} builds scored, ${opt.result.battles.toLocaleString()} battles vs ${opt.result.referenceName}, ${(opt.wallMs / 1000).toFixed(1)} s`)}
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
                                                {c.skills.map(s => `${skillName(s.id)} Lv${s.level}`).join(', ') || 'No skills'}
                                                {c.isCurrent && <span className="ml-1.5 text-[9px] font-bold uppercase text-accent-primary">Current</span>}
                                            </div>
                                            <div className="text-[10px] text-text-muted break-words">
                                                {c.petSet.map(p => `${p.customName || petName(p.rarity, p.id)} Lv${p.level}`).join(', ') || 'No pets'}
                                                {' / '}{mountName(c.mount)}{c.mount ? ` Lv${c.mount.level}` : ''}
                                                {c.fairy && <>{' / '}{c.fairy.name ? `${c.fairy.name} Lv${c.fairy.level}` : 'No fairy'}</>}
                                            </div>
                                            {c.skins && (
                                                <div className="text-[10px] text-text-muted break-words" data-testid="optimizer-skins">
                                                    {skinsLine(c)}
                                                    {(c.sets?.length ?? 0) > 0
                                                        ? <span className="text-yellow-400" data-testid="optimizer-sets">{' / '}{setsLine(c)}</span>
                                                        : <span>{' / '}no set bonus</span>}
                                                </div>
                                            )}
                                            <div className="text-[10px] text-text-secondary font-mono">
                                                {formatCompactNumber(c.dps)} DPS, {formatCompactNumber(c.hps)} HPS, {formatCompactNumber(c.power)} PWR
                                            </div>
                                        </div>
                                        <div className="shrink-0 flex flex-col items-end gap-1">
                                            {c.engine ? (<>
                                                <span className={cn('text-[12px] font-mono font-bold', i === 0 ? 'text-green-400' : 'text-text-primary')} data-testid="optimizer-engine-dps" title="DPS measured by the combat engine on the test dummy">
                                                    {formatCompactNumber(c.engine.dps)} <span className="text-[10px] text-text-muted font-normal">DPS</span>
                                                </span>
                                                <span className="text-[9px] font-mono text-text-muted" title="HPS measured by the combat engine on the test dummy">
                                                    {formatCompactNumber(c.engine.hps)} HPS
                                                </span>
                                            </>) : (<>
                                                <span className={cn('text-[12px] font-mono font-bold', i === 0 ? 'text-green-400' : 'text-text-primary')} data-testid="optimizer-winrate">
                                                    {(c.winRate * 100).toFixed(1)}% <span className="text-[10px] text-text-muted font-normal">± {(c.winRateSe * 100).toFixed(1)}</span>
                                                </span>
                                                <span className="text-[9px] font-mono text-text-muted" title="Mean of own HP fraction minus the opponent's at the end of each battle">
                                                    HP margin {c.hpMargin >= 0 ? '+' : ''}{(c.hpMargin * 100).toFixed(1)}%
                                                </span>
                                            </>)}
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
                    Stage 1 scores every candidate with the formulas (real-time DPS, HPS, Power) and keeps the best of each view.{' '}
                    {vsDummy
                        ? 'Stage 2 runs each finalist in the combat engine against the test dummy and ranks by measured DPS, then HPS.'
                        : 'Stage 2 ranks the finalists by win rate (a draw counts half), then HP margin.'}
                </div>
            </div>
        </div>,
        document.body
    );
}
