import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, BookmarkCheck, Check, Pencil, Plus, Shirt, Trash2, X } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGameData } from '../../hooks/useGameData';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { cn } from '../../lib/utils';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { useSkinIcons } from '../../utils/skinIcons';
import type { EquippedSkin, SavedSkin, UserProfile } from '../../types/Profile';
import {
    OPEN_SKIN_ARCHIVE_EVENT, SKIN_TYPE_TO_SLOT, archivedSkin, equippedFromSaved, findSavedSkin, newSkinId,
    resolvedSkinStats, setDisplayName, skinDisplayName, skinLevelExperience, skinLevelFromTotalXp, skinMaxLevel,
    skinRow, skinStatIncreasePerLevel, skinTotalLevelXp, skinTypes, syncLinkedSkins, withSkin,
} from '../../utils/skinArchive';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const statsLine = (stats: Record<string, number>) =>
    Object.entries(stats).map(([k, v]) => `${k} +${pct(v)}`).join(', ') || 'No stats';

/**
 * The skin archive: every skin the player owns, with its rolled stats and level
 * (profile.skins.saved). Skins are created and edited only here; the item modal and AUTO BEST
 * pick from it. In Compare Build, Equip puts the skin on the Test build.
 */
export function SkinArchivePanel() {
    const { profile, updateProfile } = useProfile();
    const cmp = useComparison();
    const { selectedVersion } = useGameDataContext();
    // Re-render once the exact skin icon rects arrive.
    useSkinIcons(selectedVersion);
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: skinUpgradeLibrary } = useGameData<any>('SkinUpgradeLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');

    const saved = profile.skins?.saved || [];
    const types = useMemo(() => skinTypes(skinsLibrary), [skinsLibrary]);
    const [filter, setFilter] = useState<string>('all');
    const [editing, setEditing] = useState<SavedSkin | 'new' | null>(null);
    const [newType, setNewType] = useState<string | undefined>(undefined);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // The item modal's "Skin archive" button: scroll here, filter on its type, open the editor
    // directly when that type has no skin yet.
    useEffect(() => {
        const onOpen = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            if (d.type) setFilter(d.type);
            rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            if (d.create) { setNewType(d.type); setEditing('new'); }
        };
        window.addEventListener(OPEN_SKIN_ARCHIVE_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_SKIN_ARCHIVE_EVENT, onOpen);
    }, []);

    // Where Equip goes: the profile, or the Test side of Compare Build.
    const toTest = cmp.isComparing;
    const items: UserProfile['items'] = (toTest ? cmp.testItems : null) ?? profile.items;
    const equip = (slot: keyof UserProfile['items'], skin: EquippedSkin | null) => {
        const next = withSkin(items[slot], skin);
        if (toTest) cmp.updateTestItem(slot, next);
        else updateProfile({ items: { ...profile.items, [slot]: next } });
    };

    /** Writes the archive and refreshes every item that wears a linked skin. */
    const writeArchive = (next: SavedSkin[]) => {
        const synced = syncLinkedSkins(profile, next);
        updateProfile({ skins: { ...(profile.skins || {}), saved: next }, ...synced });
    };

    const saveSkin = (s: SavedSkin) => {
        const exists = saved.some(x => x.id === s.id);
        writeArchive(exists ? saved.map(x => (x.id === s.id ? s : x)) : [...saved, s]);
        setEditing(null);
    };

    const remove = (id: string) => {
        writeArchive(saved.filter(s => s.id !== id));
        setConfirmDelete(null);
    };

    const saveWorn = (slot: keyof UserProfile['items'], type: string) => {
        const worn = items[slot]?.skin;
        if (!worn) return;
        const entry: SavedSkin = { id: newSkinId(), type: worn.type || type, idx: worn.idx, stats: { ...(worn.stats || {}) }, level: worn.level || 0 };
        const synced = syncLinkedSkins(profile, [...saved, entry]);
        updateProfile({ skins: { ...(profile.skins || {}), saved: [...saved, entry] }, ...synced });
        equip(slot, equippedFromSaved(entry));
    };

    const sprite = (type: string, idx: number) => getSkinSpriteStyle({ SkinId: { Type: type, Idx: idx } }, spriteMapping?.skins?.mapping, selectedVersion);
    const shown = saved.filter(s => filter === 'all' || s.type === filter);

    return (
        <div ref={rootRef} className="scroll-mt-4">
            <Card className="p-4 sm:p-6" data-testid="skin-archive">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                            <Shirt className="w-6 h-6 text-accent-primary" /> Skin Archive
                            <span className="text-xs font-bold text-text-muted">{saved.length}</span>
                        </h2>
                        <p className="text-[11px] text-text-muted">
                            Your skins with their rolled stats and level. Items and Auto best pick from here{toTest ? '; Equip goes to the Test build' : ''}.
                        </p>
                    </div>
                    <Button size="sm" onClick={() => { setNewType(filter !== 'all' ? filter : undefined); setEditing('new'); }} data-testid="skin-archive-add">
                        <Plus className="w-4 h-4 mr-1" /> Add skin
                    </Button>
                </div>

                {/* What the build wears now, per skin slot */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    {types.filter(t => SKIN_TYPE_TO_SLOT[t]).map(type => {
                        const slot = SKIN_TYPE_TO_SLOT[type];
                        const item = items[slot];
                        const worn = archivedSkin(item?.skin, saved);
                        const inArchive = worn ? findSavedSkin(saved, worn, type) : undefined;
                        return (
                            <div key={type} className="flex items-center gap-2 p-2 rounded-lg bg-bg-input/40 border border-border/60 min-w-0" data-testid={`skin-worn-${type}`}>
                                {worn ? <span className="w-10 h-10 rounded shrink-0" style={sprite(worn.type || type, worn.idx)} /> : <span className="w-10 h-10 rounded shrink-0 bg-black/20" />}
                                <div className="min-w-0 flex-1">
                                    <div className="text-[10px] uppercase font-bold text-text-muted">{slot}{toTest ? ' (Test)' : ''}</div>
                                    <div className="text-xs font-bold truncate">
                                        {worn ? `${inArchive?.customName || skinDisplayName(skinsLibrary, worn.type || type, worn.idx)} Lv${worn.level || 0}` : item ? 'No skin' : 'No item'}
                                    </div>
                                    {worn && <div className="text-[10px] text-green-400 truncate">{statsLine(resolvedSkinStats(worn, skinUpgradeLibrary, type))}</div>}
                                </div>
                                {worn && (inArchive
                                    ? <span title="In the archive" className="text-accent-primary shrink-0"><BookmarkCheck className="w-4 h-4" /></span>
                                    : (
                                        <button onClick={() => saveWorn(slot, type)} title="Save to the archive" className="p-1.5 rounded-md text-text-muted hover:text-accent-primary hover:bg-white/5 shrink-0" data-testid={`skin-save-worn-${type}`}>
                                            <Bookmark className="w-4 h-4" />
                                        </button>
                                    ))}
                            </div>
                        );
                    })}
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                    {['all', ...types].map(t => (
                        <button
                            key={t}
                            onClick={() => setFilter(t)}
                            className={cn('px-2.5 py-1 rounded-md text-[11px] font-bold border', filter === t ? 'bg-accent-primary/20 border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5')}
                        >
                            {t === 'all' ? 'All' : t} <span className="opacity-60">{t === 'all' ? saved.length : saved.filter(s => s.type === t).length}</span>
                        </button>
                    ))}
                </div>

                {shown.length === 0 ? (
                    <div className="text-center text-xs text-text-muted py-6 border border-dashed border-border rounded-lg">
                        No skins here yet. Add the skins you own with their stats and level.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                        {shown.map(s => {
                            const slot = SKIN_TYPE_TO_SLOT[s.type];
                            const item = slot ? items[slot] : null;
                            const worn = item?.skin?.savedId === s.id;
                            const row = skinRow(skinsLibrary, s.type, s.idx);
                            const resolved = resolvedSkinStats(s, skinUpgradeLibrary);
                            return (
                                <div key={s.id} className={cn('p-2 rounded-lg border flex gap-2 min-w-0', worn ? 'border-accent-primary/60 bg-accent-primary/5' : 'border-border bg-bg-secondary/40')} data-testid="skin-archive-entry">
                                    <span className="w-12 h-12 rounded shrink-0" style={sprite(s.type, s.idx)} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold truncate">{s.customName || skinDisplayName(skinsLibrary, s.type, s.idx)}</div>
                                        <div className="text-[10px] text-text-muted truncate">
                                            {s.type} #{s.idx}, Lv{s.level || 0}/{skinMaxLevel(skinUpgradeLibrary, s.type, s.idx)}
                                            {row?.BaseSetId ? `, ${setDisplayName(row.BaseSetId)} set` : ''}
                                        </div>
                                        <div className="text-[10px] text-green-400 truncate" data-testid="skin-archive-stats">{statsLine(resolved)}</div>
                                        {(s.level || 0) > 0 && Object.keys(s.stats).length > 0 && <div className="text-[9px] text-text-muted truncate">rolled {statsLine(s.stats)}</div>}
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            <button
                                                onClick={() => slot && equip(slot, worn ? null : equippedFromSaved(s))}
                                                disabled={!item}
                                                title={!item ? `No ${slot} item to wear it` : undefined}
                                                data-testid="skin-archive-equip"
                                                className={cn('px-2 py-0.5 rounded text-[10px] font-bold border disabled:opacity-40', worn ? 'border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5')}
                                            >
                                                {worn ? <span className="flex items-center gap-1"><Check className="w-3 h-3" /> Worn, take off</span> : toTest ? 'Equip on Test' : 'Equip'}
                                            </button>
                                            <button onClick={() => setEditing(s)} className="px-2 py-0.5 rounded text-[10px] font-bold border border-border text-text-secondary hover:bg-white/5" data-testid="skin-archive-edit">
                                                <Pencil className="w-3 h-3 inline mr-0.5" /> Edit
                                            </button>
                                            {confirmDelete === s.id ? (
                                                <button onClick={() => remove(s.id)} className="px-2 py-0.5 rounded text-[10px] font-bold border border-red-500/60 text-red-400" data-testid="skin-archive-delete-confirm">
                                                    Delete for good
                                                </button>
                                            ) : (
                                                <button onClick={() => setConfirmDelete(s.id)} className="px-2 py-0.5 rounded text-[10px] font-bold border border-border text-text-muted hover:text-red-400" data-testid="skin-archive-delete">
                                                    <Trash2 className="w-3 h-3 inline" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {editing && (
                <SkinEditorModal
                    initial={editing === 'new' ? null : editing}
                    initialType={newType}
                    skinsLibrary={skinsLibrary}
                    skinUpgradeLibrary={skinUpgradeLibrary}
                    sprite={sprite}
                    types={types}
                    onSave={saveSkin}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}

interface SkinEditorProps {
    initial: SavedSkin | null;
    initialType?: string;
    skinsLibrary: any;
    skinUpgradeLibrary: any;
    sprite: (type: string, idx: number) => React.CSSProperties;
    types: string[];
    onSave: (s: SavedSkin) => void;
    onClose: () => void;
}

/** Add or edit one archive skin: SkinId, rolled stats (SkinsLibrary PossibleStats, up to MaxStatCount), level. */
function SkinEditorModal({ initial, initialType, skinsLibrary, skinUpgradeLibrary, sprite, types, onSave, onClose }: SkinEditorProps) {
    const [type, setType] = useState<string>(initial?.type || initialType || types[0] || 'Helmet');
    const [idx, setIdx] = useState<number | null>(initial?.idx ?? null);
    const [stats, setStats] = useState<Record<string, number>>(initial?.stats || {});
    const [level, setLevel] = useState<number>(initial?.level || 0);
    const [name, setName] = useState<string>(initial?.customName || '');
    const [xpText, setXpText] = useState('');

    const skins = useMemo(() => Object.values<any>(skinsLibrary || {})
        .filter(s => s?.SkinId?.Type === type)
        .sort((a, b) => a.SkinId.Idx - b.SkinId.Idx), [skinsLibrary, type]);
    const row = idx !== null ? skinRow(skinsLibrary, type, idx) : undefined;
    const possible: any[] = row?.PossibleStats || [];
    const maxStats: number = row?.MaxStatCount ?? possible.length;
    const maxLevel = idx !== null ? skinMaxLevel(skinUpgradeLibrary, type, idx) : 0;
    const xpArr = idx !== null ? skinLevelExperience(skinUpgradeLibrary, type, idx) : null;
    const inc = idx !== null ? skinStatIncreasePerLevel(skinUpgradeLibrary, type, idx) : null;

    const pickSkin = (s: any) => {
        setIdx(s.SkinId.Idx);
        // The first MaxStatCount possible stats at their MinValue, ready to be typed over.
        const first: Record<string, number> = {};
        for (const p of (s.PossibleStats || []).slice(0, s.MaxStatCount ?? 1)) {
            const t = p.StatNode?.UniqueStat?.StatType;
            if (t) first[t] = p.MinValue ?? 0;
        }
        setStats(first);
        setLevel(0);
    };

    const toggleStat = (t: string, min: number) => {
        const next = { ...stats };
        if (t in next) delete next[t];
        else if (Object.keys(next).length < maxStats) next[t] = min;
        setStats(next);
    };

    const applyXp = (text: string) => {
        setXpText(text);
        const xp = Number(text);
        if (!xpArr || !Number.isFinite(xp) || text.trim() === '') return;
        setLevel(Math.min(maxLevel, skinLevelFromTotalXp(xpArr, xp).level));
    };

    // A skin migrated from an old profile can have no stats yet: it still saves (the level and SkinId matter).
    const canSave = idx !== null;
    const resolved = idx !== null ? resolvedSkinStats({ type, idx, stats, level }, skinUpgradeLibrary) : {};

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-stretch sm:items-center justify-center bg-black/80 sm:p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Skin editor"
                data-testid="skin-editor"
                className="bg-bg-primary text-text-primary w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[92vh] sm:rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                    <div className="text-sm font-bold">{initial ? 'Edit skin' : 'Add skin'}</div>
                    <button onClick={onClose} className="p-1.5 rounded-md text-text-muted hover:text-text-primary" aria-label="Close"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="flex flex-wrap gap-1">
                        {types.map(t => (
                            <button
                                key={t}
                                onClick={() => { if (t !== type) { setType(t); setIdx(null); setStats({}); setLevel(0); } }}
                                className={cn('px-2.5 py-1 rounded-md text-[11px] font-bold border', type === t ? 'bg-accent-primary/20 border-accent-primary/60 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5')}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-5 sm:grid-cols-7 gap-1.5 max-h-56 overflow-y-auto" data-testid="skin-editor-grid">
                        {skins.map(s => (
                            <button
                                key={s.SkinId.Idx}
                                onClick={() => pickSkin(s)}
                                title={skinDisplayName(skinsLibrary, type, s.SkinId.Idx)}
                                data-testid="skin-editor-skin"
                                className={cn('aspect-square rounded-lg border-2 bg-bg-secondary overflow-hidden', idx === s.SkinId.Idx ? 'border-accent-primary' : 'border-border hover:border-accent-primary/50')}
                            >
                                <div className="w-full h-full" style={sprite(type, s.SkinId.Idx)} />
                            </button>
                        ))}
                    </div>

                    {idx !== null && (
                        <>
                            <div className="text-xs font-bold">
                                {skinDisplayName(skinsLibrary, type, idx)} <span className="text-text-muted font-normal">#{idx}</span>
                            </div>

                            <div className="space-y-1.5">
                                <div className="text-[10px] font-bold text-text-muted uppercase">{maxStats === 1 ? 'Rolled stat' : `Rolled stats (${Object.keys(stats).length}/${maxStats})`}</div>
                                {maxStats === 1 && possible.length > 1 ? (() => {
                                    // MaxStatCount 1 (every skin in the current config): the possible stats exclude each other.
                                    const cur = possible.find(p => p.StatNode?.UniqueStat?.StatType in stats) ?? possible[0];
                                    const t: string = cur.StatNode?.UniqueStat?.StatType;
                                    const pick = (p: any) => {
                                        const nt: string = p.StatNode?.UniqueStat?.StatType;
                                        if (!nt || nt === t) return;
                                        const v = stats[t];
                                        const keep = v !== undefined && v >= (p.MinValue ?? 0) && v <= (p.MaxValue ?? Infinity);
                                        setStats({ [nt]: keep ? v : (p.MinValue ?? 0) });
                                    };
                                    return (
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <div className="flex rounded-md border border-border overflow-hidden" role="radiogroup" data-testid="skin-editor-stat-toggle">
                                                {possible.map(p => {
                                                    const pt: string = p.StatNode?.UniqueStat?.StatType;
                                                    const on = pt === t;
                                                    return (
                                                        <button key={pt} type="button" role="radio" aria-checked={on} onClick={() => pick(p)}
                                                            data-testid={`skin-editor-stat-pick-${pt}`}
                                                            className={cn('px-3 py-1 text-[11px] font-bold', on ? 'bg-accent-primary/20 text-accent-primary' : 'text-text-secondary hover:bg-white/5')}>
                                                            {pt}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={t in stats ? Number((stats[t] * 100).toFixed(4)) : ''}
                                                onChange={e => setStats({ [t]: (Number(e.target.value) || 0) / 100 })}
                                                data-testid={`skin-editor-stat-${t}`}
                                                className="w-20 px-2 py-1 rounded bg-bg-input border border-border text-text-primary"
                                            />
                                            <span className="text-[10px] text-text-muted">% (roll {pct(cur.MinValue ?? 0)} to {pct(cur.MaxValue ?? 0)})</span>
                                        </div>
                                    );
                                })() : possible.map(p => {
                                    const t: string = p.StatNode?.UniqueStat?.StatType;
                                    const on = t in stats;
                                    return (
                                        <div key={t} className="flex items-center gap-2 text-xs">
                                            <label className="flex items-center gap-1.5 w-24 shrink-0">
                                                <input type="checkbox" checked={on} onChange={() => toggleStat(t, p.MinValue ?? 0)} disabled={!on && Object.keys(stats).length >= maxStats} />
                                                {t}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                disabled={!on}
                                                value={on ? Number((stats[t] * 100).toFixed(4)) : ''}
                                                onChange={e => setStats({ ...stats, [t]: (Number(e.target.value) || 0) / 100 })}
                                                data-testid={`skin-editor-stat-${t}`}
                                                className="w-20 px-2 py-1 rounded bg-bg-input border border-border text-text-primary disabled:opacity-40"
                                            />
                                            <span className="text-[10px] text-text-muted">% (roll {pct(p.MinValue ?? 0)} to {pct(p.MaxValue ?? 0)})</span>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="space-y-1.5">
                                <div className="text-[10px] font-bold text-text-muted uppercase">Level</div>
                                <div className="flex flex-wrap items-center gap-1">
                                    {Array.from({ length: maxLevel + 1 }, (_, lv) => (
                                        <button
                                            key={lv}
                                            onClick={() => setLevel(lv)}
                                            data-testid={`skin-editor-level-${lv}`}
                                            className={cn('w-8 h-7 rounded text-[11px] font-bold border', level === lv ? 'border-accent-primary bg-accent-primary/20 text-accent-primary' : 'border-border text-text-secondary hover:bg-white/5')}
                                        >
                                            {lv}
                                        </button>
                                    ))}
                                    {xpArr && maxLevel > 0 && (
                                        <label className="flex items-center gap-1 text-[10px] text-text-muted ml-2">
                                            or total XP
                                            <input value={xpText} onChange={e => applyXp(e.target.value)} inputMode="numeric" className="w-16 px-1.5 py-0.5 rounded bg-bg-input border border-border text-text-primary" />
                                        </label>
                                    )}
                                </div>
                                {xpArr && maxLevel > 0 && (
                                    <div className="text-[10px] text-text-muted">
                                        Total XP per level: {Array.from({ length: maxLevel }, (_, i) => `Lv${i + 1} ${skinTotalLevelXp(xpArr, i + 1).toLocaleString()}`).join(', ')}.
                                        {' '}Each level adds +{pct(inc || 0)} to every rolled stat.
                                    </div>
                                )}
                                {maxLevel === 0 && <div className="text-[10px] text-text-muted">This skin does not level up.</div>}
                            </div>

                            <label className="block text-[10px] font-bold text-text-muted uppercase">
                                Name (optional)
                                <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full px-2 py-1 rounded bg-bg-input border border-border text-xs font-normal normal-case text-text-primary" />
                            </label>

                            <div className="text-xs p-2 rounded-lg bg-green-500/5 border border-green-500/20">
                                At level {level}: <span className="text-green-400 font-bold" data-testid="skin-editor-resolved">{statsLine(resolved)}</span>
                            </div>
                        </>
                    )}
                </div>

                <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                    <Button
                        size="sm"
                        disabled={!canSave}
                        data-testid="skin-editor-save"
                        onClick={() => idx !== null && onSave({
                            id: initial?.id || newSkinId(),
                            type, idx, stats, level,
                            ...(name.trim() ? { customName: name.trim() } : {}),
                        })}
                    >
                        Save
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
