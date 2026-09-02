import { useState, useMemo, useEffect } from 'react';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Input } from '../components/UI/Input';
import { Download, Copy, Check, RotateCcw, Wand2 } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Sprite mapping editor, driven by the set portraits.
 *
 * ManualSpriteMapping.json is hand maintained and every build that adds skins leaves gaps:
 * the game ships the skins but nothing says which cell of SkinsUiIcons.png each one uses, nor
 * which SteppingStoneCharIcon portrait belongs to which set. Both of those are the bindings
 * this page exists to make, and it arrives pre-filled with whatever we already ship.
 *
 * Two facts from the game data shape the layout:
 *
 *  - Every skin carries a `BaseSetId`, so set membership is known and never needs typing.
 *    A set's pieces are simply the Helmet/Armour/Weapon sharing its BaseSetId.
 *  - The skins with no `BaseSetId` are exactly Helmet_100 and up, which is the game's own
 *    notion of a standalone helmet. Anything an actual set does not claim belongs there.
 *
 * Only `skins.mapping` and `skinSets` are written, because they are the only parts of the
 * file anything reads (skinSprites.ts and pages/Skins.tsx). The skins section's declared
 * `texture_size` / `sprite_size` / `grid` metadata is stale (it claims 800x800 with 100px
 * cells while the sheet is 2048x2048 with 128px cells) but no code consults it, so it is
 * reported here and carried through untouched rather than silently rewritten.
 */

const SKINS_ATLAS = 'SkinsUiIcons.png';
const PORTRAIT_PREFIX = 'SteppingStoneCharIcon';
const PIECE_ORDER = ['Helmet', 'Armour', 'Weapon'] as const;
type Piece = (typeof PIECE_ORDER)[number];

/**
 * The sheet is cut into DIVISIONS cells per axis but only the leftmost COLUMNS hold skin art:
 * the right half of SkinsUiIcons.png carries an unrelated QR-code asset. A mapping index is
 * therefore `row * COLUMNS + col`, which is what skinSprites.ts reproduces. Both are
 * adjustable below, because a build has already changed atlas packing once.
 */
const DEFAULT_DIVISIONS = 16;
const DEFAULT_COLUMNS = 8;

interface AtlasCellProps {
    index: number;
    divisions: number;
    columns: number;
    version?: string | null;
    /** Fixed pixel box. Omit to fill the parent. */
    size?: number;
    className?: string;
}

/**
 * One cell of the skin atlas, addressed by mapping index. Positioned in percentages so a cell
 * renders correctly at any box size, which is the same convention skinSprites.ts uses.
 */
function AtlasCell({ index, divisions, columns, version, size, className }: AtlasCellProps) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const step = divisions > 1 ? 100 / (divisions - 1) : 0;
    return (
        <div
            className={cn('bg-bg-secondary', className)}
            style={{
                ...(size !== undefined ? { width: size, height: size } : {}),
                backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${version ? `${version}/` : ''}${SKINS_ATLAS})`,
                backgroundSize: `${divisions * 100}% ${divisions * 100}%`,
                backgroundPosition: `${col * step}% ${row * step}%`,
                imageRendering: 'pixelated',
            }}
        />
    );
}

/** What an atlas click will fill: one piece of a set, or one standalone helmet. */
type Target = { kind: 'piece'; skinKey: string } | null;

export default function Settings() {
    const { selectedVersion } = useGameDataContext();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');

    const [divisions, setDivisions] = useState(DEFAULT_DIVISIONS);
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [mapping, setMapping] = useState<Record<string, number>>({});
    /** set id -> portrait filename, the shape skinSets already uses. */
    const [sets, setSets] = useState<Record<string, string>>({});
    const [target, setTarget] = useState<Target>(null);
    const [onlyIncomplete, setOnlyIncomplete] = useState(true);
    const [copied, setCopied] = useState(false);
    const [portraits, setPortraits] = useState<string[]>([]);

    // Seed from the shipped file: everything already bound stays put, so only gaps need work.
    useEffect(() => {
        if (!spriteMapping) return;
        setMapping({ ...(spriteMapping.skins?.mapping ?? {}) });
        setSets({ ...(spriteMapping.skinSets ?? {}) });
    }, [spriteMapping]);

    useEffect(() => {
        let cancelled = false;
        fetch(`${import.meta.env.BASE_URL}parsed_configs/TextureManifest.json`)
            .then((r) => (r.ok ? r.json() : []))
            .then((all: string[]) => {
                if (cancelled || !Array.isArray(all)) return;
                const num = (s: string) => parseInt(s.slice(PORTRAIT_PREFIX.length), 10) || 0;
                setPortraits(
                    all.filter((f) => f.startsWith(PORTRAIT_PREFIX) && f.endsWith('.png')).sort((a, b) => num(a) - num(b))
                );
            })
            .catch(() => { /* the picker just stays empty */ });
        return () => { cancelled = true; };
    }, []);

    /** Every skin in this version, with the set it belongs to (null for standalone helmets). */
    const skins = useMemo(() => {
        if (!skinsLibrary) return [];
        return Object.values<any>(skinsLibrary)
            .filter((s) => s?.SkinId?.Type !== undefined && s?.SkinId?.Idx !== undefined)
            .map((s) => ({
                key: `${s.SkinId.Type}_${s.SkinId.Idx}`,
                type: s.SkinId.Type as string,
                idx: s.SkinId.Idx as number,
                setId: (s.BaseSetId as string) || null,
            }));
    }, [skinsLibrary]);

    /** set id -> its pieces, keyed by Helmet / Armour / Weapon. */
    const setPieces = useMemo(() => {
        const out: Record<string, Partial<Record<Piece, string>>> = {};
        for (const s of skins) {
            if (!s.setId) continue;
            (out[s.setId] ??= {})[s.type as Piece] = s.key;
        }
        return out;
    }, [skins]);

    /** The standalone helmets: the game gives these no BaseSetId. */
    const standalone = useMemo(
        () => skins.filter((s) => !s.setId).sort((a, b) => a.idx - b.idx),
        [skins]
    );

    const setIds = useMemo(
        () => (setsLibrary ? Object.keys(setsLibrary).sort() : Object.keys(setPieces).sort()),
        [setsLibrary, setPieces]
    );

    /** portrait file -> the set holding it, so a portrait cannot be used twice by accident. */
    const portraitOwner = useMemo(() => {
        const out: Record<string, string> = {};
        for (const [setId, file] of Object.entries(sets)) if (file) out[file] = setId;
        return out;
    }, [sets]);

    /** atlas index -> skin keys pointing at it, so collisions are visible. */
    const usedBy = useMemo(() => {
        const out: Record<number, string[]> = {};
        for (const [key, index] of Object.entries(mapping)) {
            if (typeof index === 'number') (out[index] ??= []).push(key);
        }
        return out;
    }, [mapping]);

    const isSetComplete = (setId: string) =>
        !!sets[setId] && Object.values(setPieces[setId] ?? {}).every((k) => k && mapping[k] !== undefined);

    const incompleteSets = useMemo(() => setIds.filter((id) => !isSetComplete(id)), [setIds, sets, setPieces, mapping]);
    /**
     * Sets still missing a sprite, tracked separately from a missing portrait: the standalone
     * fill below is only safe once no set is waiting for a cell, otherwise the leftovers rule
     * would hand the sets' own sprites to the generic helmets.
     */
    const setsMissingSprites = useMemo(
        () => setIds.filter((id) => Object.values(setPieces[id] ?? {}).some((k) => k && mapping[k] === undefined)),
        [setIds, setPieces, mapping]
    );
    const visibleSets = onlyIncomplete ? incompleteSets : setIds;
    const unmappedStandalone = useMemo(
        () => standalone.filter((s) => mapping[s.key] === undefined),
        [standalone, mapping]
    );

    /** Atlas cells with art that no skin claims. This is the pool the sets draw from. */
    const claimed = useMemo(() => new Set(Object.values(mapping)), [mapping]);

    const changedSkins = useMemo(() => {
        const original: Record<string, number> = spriteMapping?.skins?.mapping ?? {};
        return Object.keys({ ...original, ...mapping }).filter((k) => original[k] !== mapping[k]).length;
    }, [spriteMapping, mapping]);

    const changedSets = useMemo(() => {
        const original: Record<string, string> = spriteMapping?.skinSets ?? {};
        return Object.keys({ ...original, ...sets }).filter((k) => original[k] !== sets[k]).length;
    }, [spriteMapping, sets]);

    const exported = useMemo(() => {
        if (!spriteMapping) return '';
        return JSON.stringify(
            { ...spriteMapping, skins: { ...(spriteMapping.skins ?? {}), mapping }, skinSets: sets },
            null,
            2
        );
    }, [spriteMapping, mapping, sets]);

    /** Fill the active slot, then step to the next empty piece so a set is three clicks. */
    const assign = (index: number) => {
        if (!target) return;
        const next = { ...mapping, [target.skinKey]: index };
        setMapping(next);

        const owningSet = skins.find((s) => s.key === target.skinKey)?.setId;
        const sameSet = owningSet
            ? PIECE_ORDER.map((p) => setPieces[owningSet]?.[p]).filter((k): k is string => !!k && next[k] === undefined)
            : [];
        if (sameSet.length) { setTarget({ kind: 'piece', skinKey: sameSet[0] }); return; }
        const nextStandalone = standalone.find((s) => next[s.key] === undefined);
        setTarget(nextStandalone && !owningSet ? { kind: 'piece', skinKey: nextStandalone.key } : null);
    };

    const clear = (skinKey: string) =>
        setMapping((prev) => { const n = { ...prev }; delete n[skinKey]; return n; });

    /**
     * Everything a set has not claimed becomes a standalone helmet, which is the rule the game
     * already follows. Fills the unmapped Helmet_1xx keys in atlas order.
     */
    const fillStandalone = () => {
        const free = Array.from({ length: divisions * columns }, (_, i) => i).filter((i) => !claimed.has(i));
        const next = { ...mapping };
        unmappedStandalone.forEach((s, i) => { if (free[i] !== undefined) next[s.key] = free[i]; });
        setMapping(next);
        setTarget(null);
    };

    const download = () => {
        const url = URL.createObjectURL(new Blob([exported], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ManualSpriteMapping.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const copy = async () => {
        await navigator.clipboard.writeText(exported);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const reset = () => {
        setMapping({ ...(spriteMapping?.skins?.mapping ?? {}) });
        setSets({ ...(spriteMapping?.skinSets ?? {}) });
        setTarget(null);
    };

    const portraitUrl = (file: string) =>
        `${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${file}`;

    /** One fillable piece slot. */
    const Slot = ({ skinKey, label }: { skinKey?: string; label: Piece }) => {
        if (!skinKey) {
            return (
                <div className="flex-1 rounded-lg border border-dashed border-border/50 p-1 text-center">
                    <span className="text-[10px] text-text-secondary">no {label.toLowerCase()}</span>
                </div>
            );
        }
        const index = mapping[skinKey];
        const active = target?.skinKey === skinKey;
        return (
            <button
                onClick={() => setTarget(active ? null : { kind: 'piece', skinKey })}
                title={skinKey}
                className={cn(
                    'flex-1 rounded-lg border p-1 transition-colors',
                    active ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:border-accent-primary/50'
                )}
            >
                {index === undefined ? (
                    <div className="w-full aspect-square rounded bg-bg-secondary border border-dashed border-border" />
                ) : (
                    <AtlasCell
                        index={index}
                        divisions={divisions}
                        columns={columns}
                        version={selectedVersion}
                        className="w-full aspect-square rounded"
                    />
                )}
                <span className="block text-[10px] text-text-secondary mt-0.5">
                    {label}
                    {index !== undefined && <span className="text-text-primary"> {index}</span>}
                </span>
            </button>
        );
    };

    const declared = spriteMapping?.skins;
    const totalCells = divisions * columns;
    const freeWithArt = totalCells - claimed.size;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Sprite Mapping</h1>
                    <p className="text-sm text-text-secondary">
                        {incompleteSets.length} set{incompleteSets.length === 1 ? '' : 's'} and{' '}
                        {unmappedStandalone.length} standalone helmet
                        {unmappedStandalone.length === 1 ? '' : 's'} still incomplete in{' '}
                        {selectedVersion ?? 'this version'}.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={reset} disabled={!changedSkins && !changedSets}>
                        <RotateCcw className="w-4 h-4 mr-1.5" /> Reset
                    </Button>
                    <Button variant="secondary" onClick={copy} disabled={!exported}>
                        {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                        Copy JSON
                    </Button>
                    <Button onClick={download} disabled={!exported}>
                        <Download className="w-4 h-4 mr-1.5" />
                        Export ({changedSkins + changedSets} changed)
                    </Button>
                </div>
            </div>

            {declared && (
                <Card>
                    <CardContent className="py-3 text-xs text-text-secondary flex flex-wrap gap-x-6 gap-y-1">
                        <span>
                            Set membership comes from <span className="text-text-primary">BaseSetId</span>, so only the
                            portrait and the sprites need choosing.
                        </span>
                        <span>
                            Atlas: <span className="text-text-primary">{columns} columns</span> of {divisions} sheet
                            divisions, index = row x {columns} + column, {freeWithArt} of {totalCells} cells unclaimed.
                        </span>
                        <span>
                            File declares {declared.texture_size?.width}x{declared.texture_size?.height},{' '}
                            {declared.sprite_size?.width}px sprites, {declared.grid?.columns}x{declared.grid?.rows}.
                            {declared.texture_size?.width !== 2048 && (
                                <span className="text-yellow-500"> Stale, but nothing reads it.</span>
                            )}
                        </span>
                    </CardContent>
                </Card>
            )}

            {/* ---------------- sets, as portraits ---------------- */}
            <Card>
                <CardHeader className="flex-row items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">
                        Sets
                        {target && (
                            <span className="ml-2 text-sm font-normal text-accent-primary">
                                pick a sprite below for {target.skinKey}
                            </span>
                        )}
                    </CardTitle>
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                        <input
                            type="checkbox"
                            checked={onlyIncomplete}
                            onChange={(e) => setOnlyIncomplete(e.target.checked)}
                            className="accent-accent-primary"
                        />
                        only incomplete
                    </label>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                    {visibleSets.length === 0 && (
                        <p className="text-sm text-text-secondary">Every set is bound and mapped.</p>
                    )}
                    {visibleSets.map((setId) => {
                        const portrait = sets[setId];
                        const pieces = setPieces[setId] ?? {};
                        const complete = isSetComplete(setId);
                        return (
                            <div
                                key={setId}
                                className={cn(
                                    'rounded-xl border p-2.5 space-y-2',
                                    complete ? 'border-border' : 'border-yellow-500/40 bg-yellow-500/5'
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    {portrait ? (
                                        <img
                                            src={portraitUrl(portrait)}
                                            alt={setId}
                                            className="w-12 h-12 rounded-lg bg-bg-secondary object-contain shrink-0"
                                        />
                                    ) : (
                                        <div className="w-12 h-12 rounded-lg bg-bg-secondary border border-dashed border-border shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-text-primary truncate">
                                            {setId}
                                        </span>
                                        <span className="block text-[11px] text-text-secondary truncate">
                                            {portrait ?? 'no portrait'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-1.5">
                                    {PIECE_ORDER.map((p) => (
                                        <Slot key={p} skinKey={pieces[p]} label={p} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {/* ---------------- portrait picker ---------------- */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        Portraits
                        <span className="ml-2 text-sm font-normal text-text-secondary">
                            name each one, {portraits.length - Object.keys(portraitOwner).length} still unnamed
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8 gap-2">
                    {portraits.map((file) => {
                        const owner = portraitOwner[file];
                        return (
                            <div
                                key={file}
                                className={cn(
                                    'rounded-lg border p-1.5 space-y-1',
                                    owner ? 'border-border' : 'border-yellow-500/40 bg-yellow-500/5'
                                )}
                            >
                                <img
                                    src={portraitUrl(file)}
                                    alt={file}
                                    title={file}
                                    className="w-full aspect-square rounded bg-bg-secondary object-contain"
                                />
                                <select
                                    value={owner ?? ''}
                                    onChange={(e) => {
                                        const chosen = e.target.value;
                                        setSets((prev) => {
                                            const next = { ...prev };
                                            // a portrait belongs to one set, so drop the old holder
                                            for (const [id, f] of Object.entries(next)) if (f === file) delete next[id];
                                            if (chosen) next[chosen] = file;
                                            return next;
                                        });
                                    }}
                                    className="w-full bg-bg-input border border-border rounded px-1 py-1 text-[11px] text-text-primary"
                                >
                                    <option value="">unnamed</option>
                                    {setIds.map((id) => (
                                        <option key={id} value={id} disabled={!!sets[id] && sets[id] !== file}>
                                            {id}
                                            {sets[id] && sets[id] !== file ? ' (taken)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {/* ---------------- the atlas ---------------- */}
            <Card>
                <CardHeader className="flex-row items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base">{SKINS_ATLAS}</CardTitle>
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                        <label className="flex items-center gap-1.5">
                            columns
                            <Input
                                type="number" min={1} max={32} value={columns}
                                onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))}
                                className="w-16 h-8"
                            />
                        </label>
                        <label className="flex items-center gap-1.5">
                            divisions
                            <Input
                                type="number" min={1} max={32} value={divisions}
                                onChange={(e) => setDivisions(Math.max(1, Number(e.target.value) || 1))}
                                className="w-16 h-8"
                            />
                        </label>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {Array.from({ length: totalCells }, (_, index) => {
                            const owners = usedBy[index] ?? [];
                            const taken = owners.length > 0;
                            return (
                                <button
                                    key={index}
                                    onClick={() => assign(index)}
                                    disabled={!target}
                                    title={taken ? owners.join(', ') : `index ${index}`}
                                    className={cn(
                                        'relative rounded border transition-colors',
                                        target ? 'cursor-pointer hover:border-accent-primary' : 'cursor-default',
                                        taken ? 'border-green-500/40' : 'border-border'
                                    )}
                                >
                                    <AtlasCell
                                        index={index}
                                        divisions={divisions}
                                        columns={columns}
                                        version={selectedVersion}
                                        className="w-full aspect-square rounded"
                                    />
                                    <span className="absolute top-0 left-0.5 text-[10px] leading-tight text-accent-primary/90 pointer-events-none">
                                        {index}
                                    </span>
                                    {taken && (
                                        <span className="absolute bottom-0 right-0.5 text-[9px] leading-tight text-green-400 pointer-events-none">
                                            {owners.length > 1 ? `x${owners.length}` : 'ok'}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* ---------------- standalone helmets ---------------- */}
            <Card>
                <CardHeader className="flex-row items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">
                        Standalone helmets
                        <span className="ml-2 text-sm font-normal text-text-secondary">
                            the skins the game gives no BaseSetId, {unmappedStandalone.length} unmapped
                            {setsMissingSprites.length > 0 && (
                                <span className="text-yellow-500">
                                    {' '}but map the sets first: the leftovers rule needs them settled
                                </span>
                            )}
                        </span>
                    </CardTitle>
                    <Button
                        variant="secondary"
                        onClick={fillStandalone}
                        disabled={unmappedStandalone.length === 0 || setsMissingSprites.length > 0}
                        title={
                            setsMissingSprites.length > 0
                                ? `Map the sets first: ${setsMissingSprites.join(', ')} still need sprites, and the leftovers rule would take theirs.`
                                : 'Give every unclaimed atlas cell to the remaining standalone helmets, in atlas order'
                        }
                    >
                        <Wand2 className="w-4 h-4 mr-1.5" /> Fill from what sets did not claim
                    </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-12 gap-2">
                    {standalone.map((s) => {
                        const index = mapping[s.key];
                        const active = target?.skinKey === s.key;
                        return (
                            <button
                                key={s.key}
                                onClick={() => setTarget(active ? null : { kind: 'piece', skinKey: s.key })}
                                className={cn(
                                    'rounded-lg border p-1 transition-colors',
                                    active
                                        ? 'border-accent-primary bg-accent-primary/10'
                                        : index === undefined
                                            ? 'border-yellow-500/40 bg-yellow-500/5'
                                            : 'border-border hover:border-accent-primary/50'
                                )}
                            >
                                {index === undefined ? (
                                    <div className="w-full aspect-square rounded bg-bg-secondary border border-dashed border-border" />
                                ) : (
                                    <AtlasCell
                                        index={index}
                                        divisions={divisions}
                                        columns={columns}
                                        version={selectedVersion}
                                        className="w-full aspect-square rounded"
                                    />
                                )}
                                <span className="block text-[10px] text-text-secondary mt-0.5 truncate">
                                    {s.idx}
                                    {index !== undefined && <span className="text-text-primary"> ({index})</span>}
                                </span>
                                {index !== undefined && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); clear(s.key); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clear(s.key); } }}
                                        className="block text-[9px] text-text-secondary hover:text-red-400"
                                    >
                                        clear
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
}
