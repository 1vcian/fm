import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, User, Shuffle, Play, Pause, ChevronLeft, ChevronRight, Film, X } from 'lucide-react';
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { useGameData } from '../../hooks/useGameData';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { BuildPortrait, FRAME_RATE } from '../Presets/BuildPortrait';
import { portraitBackgrounds, isRangedWeapon, type PortraitBackground } from '../Presets/portraitScene';
import { portraitGif } from '../Presets/portraitGif';
import { loadBattleVisuals } from '../Battle/gameView/visualData';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { INITIAL_PROFILE, type ItemSlot, type UserProfile } from '../../types/Profile';
import { AGES, RARITIES } from '../../utils/constants';
import { getItemImage, getItemName } from '../../utils/itemAssets';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { useSkinIcons } from '../../utils/skinIcons';
import { skinDisplayName, skinMaxLevel } from '../../utils/skinArchive';
import { getAscensionTexturePath, resolveTextureVersion } from '../../utils/ascensionUtils';
import { FAIRIES, type FairyName } from '../../utils/fairies';
import { cn } from '../../lib/utils';

/**
 * Character maker: any helmet, armour and weapon (an item of any age or a skin), a mount, pets and
 * a fairy, drawn by the battle view's own renderer (PortraitScene) on a transparent, coloured or
 * battlefield background, played, paused or stepped frame by frame, and exported as a PNG of the
 * frame on screen or a looping GIF. Every option comes from the configs and the sprite mapping,
 * so new items, skins, pets and mounts appear with a new game version on their own.
 */

type Piece = { age: number; idx: number; skin: number | null };
type Pick = { rarity: string; id: number } | null;

const SLOT_TYPE = { Helmet: 'Helmet', Body: 'Armour', Weapon: 'Weapon' } as const;
type GearSlot = keyof typeof SLOT_TYPE;
const GEAR: GearSlot[] = ['Helmet', 'Body', 'Weapon'];
const GEAR_LABEL: Record<GearSlot, string> = { Helmet: 'Helmet', Body: 'Armour', Weapon: 'Weapon' };

type PickerId = GearSlot | 'Mount' | 'Pet0' | 'Pet1' | 'Pet2' | 'Fairy' | 'Background';

const PREVIEW = 420;
const EXPORT_SIZES = [256, 512, 1024];
const GIF_FPS = 20;
const camel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

function Tile({ selected, onClick, label, children }: { selected: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
    return (
        <button onClick={onClick} title={label}
            className={cn('flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-colors min-w-0',
                selected ? 'border-accent-primary bg-accent-primary/15' : 'border-border/60 bg-bg-input/40 hover:bg-bg-input hover:border-border')}>
            <div className="w-12 h-12 flex items-center justify-center overflow-hidden">{children}</div>
            <span className="text-[10px] leading-tight text-text-secondary text-center line-clamp-2 w-full">{label}</span>
        </button>
    );
}

export function CharacterMaker() {
    const { profile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    useSkinIcons(selectedVersion);
    const { data: itemLib } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: skinsLib } = useGameData<any>('SkinsLibrary.json');
    const { data: skinUpgradeLib } = useGameData<any>('SkinUpgradeLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: ascensionLib } = useGameData<any>('AscensionConfigsLibrary.json');
    const maxAsc = (k: 'Pets' | 'Mounts') => ascensionLib?.[k]?.AscensionConfigPerLevel?.length ?? 0;
    const version = selectedVersion ?? undefined;
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${resolveTextureVersion(version) ?? version ?? ''}/`;

    const [pieces, setPieces] = useState<Record<GearSlot, Piece>>({
        Helmet: { age: 0, idx: 0, skin: null }, Body: { age: 0, idx: 0, skin: null }, Weapon: { age: 0, idx: 0, skin: null },
    });
    const [mount, setMount] = useState<Pick>(null);
    const [pets, setPets] = useState<Pick[]>([null, null, null]);
    const [fairy, setFairy] = useState<FairyName | null>(null);
    const [petAscension, setPetAscension] = useState(0);
    const [mountAscension, setMountAscension] = useState(0);
    const [aura, setAura] = useState(true);
    /** Which variant of a weapon skin to draw: GetSkinnedItemId shows the ranged one on a ranged weapon. */
    const [skinRanged, setSkinRanged] = useState(false);
    const [bgKind, setBgKind] = useState<'transparent' | 'color' | 'map'>('transparent');
    const [bgColor, setBgColor] = useState('#1b2330');
    const [mapId, setMapId] = useState<string | null>(null);
    const [maps, setMaps] = useState<{ id: string; label: string; bg: PortraitBackground }[]>([]);
    const [open, setOpen] = useState<PickerId | null>('Helmet');
    const [gearTab, setGearTab] = useState<'skins' | number>('skins');
    const [playing, setPlaying] = useState(true);
    const [frame, setFrame] = useState(0);
    const liveFrame = useRef(0);
    const [exportSize, setExportSize] = useState(512);
    const [gifLoops, setGifLoops] = useState(2);
    const [gifProgress, setGifProgress] = useState<number | null>(null);
    const canvas = useRef<HTMLCanvasElement | null>(null);
    const handle = useCallback((c: HTMLCanvasElement | null) => { canvas.current = c; }, []);

    useEffect(() => { loadBattleVisuals().then(d => setMaps(portraitBackgrounds(d))).catch(() => setMaps([])); }, []);

    // ---------------------------------------------------------------- option lists (configs)
    const itemsOf = useMemo(() => {
        const out: Record<string, { age: number; idx: number }[]> = {};
        for (const k of Object.keys(itemLib ?? {})) {
            const m = k.match(/'Age': (\d+), 'Type': '(\w+)', 'Idx': (\d+)/);
            if (!m || Number(m[1]) >= AGES.length) continue;
            (out[m[2]] ??= []).push({ age: Number(m[1]), idx: Number(m[3]) });
        }
        for (const list of Object.values(out)) list.sort((a, b) => a.age - b.age || a.idx - b.idx);
        return out;
    }, [itemLib]);
    const skinsOf = useMemo(() => {
        const out: Record<string, number[]> = {};
        for (const r of Object.values<any>(skinsLib ?? {})) (out[r.SkinId.Type] ??= []).push(r.SkinId.Idx);
        for (const list of Object.values(out)) list.sort((a, b) => a - b);
        return out;
    }, [skinsLib]);
    const spriteRows = (group: 'mounts' | 'pets') => {
        const m = sprites?.[group]?.mapping as Record<string, { name: string; rarity: string; id: number }> | undefined;
        return Object.entries(m ?? {})
            .map(([index, v]) => ({ index: Number(index), name: camel(v.name), rarity: v.rarity, id: v.id }))
            .sort((a, b) => RARITIES.indexOf(a.rarity as never) - RARITIES.indexOf(b.rarity as never) || a.id - b.id);
    };
    const mounts = useMemo(() => spriteRows('mounts'), [sprites]); // eslint-disable-line react-hooks/exhaustive-deps
    const petRows = useMemo(() => spriteRows('pets'), [sprites]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------------------------------------------------------------- icons
    const sheetIcon = (group: 'mounts' | 'pets', index: number) => {
        const cfg = sprites?.[group];
        if (!cfg) return null;
        const sheet = getAscensionTexturePath(group === 'mounts' ? 'MountIcons' : 'Pets', group === 'mounts' ? mountAscension : petAscension, version);
        return <SpriteSheetIcon textureSrc={sheet} spriteWidth={cfg.sprite_size.width} spriteHeight={cfg.sprite_size.height}
            sheetWidth={cfg.texture_size.width} sheetHeight={cfg.texture_size.height} iconIndex={index} className="w-12 h-12" smooth />;
    };
    const itemIcon = (slot: GearSlot, age: number, idx: number) => {
        const src = getItemImage(AGES[age], slot, idx, autoMapping, version);
        return src ? <img src={src} alt="" className="w-11 h-11 object-contain" /> : <span className="text-[10px] text-text-muted">{idx + 1}</span>;
    };
    const skinIcon = (slot: GearSlot, idx: number) => (
        <div className="w-11 h-11" style={getSkinSpriteStyle({ SkinId: { Idx: idx, Type: SLOT_TYPE[slot] } }, sprites?.skins?.mapping, version)} />
    );
    const pieceIcon = (slot: GearSlot) => (pieces[slot].skin !== null ? skinIcon(slot, pieces[slot].skin!) : itemIcon(slot, pieces[slot].age, pieces[slot].idx));
    const pickIcon = (group: 'mounts' | 'pets', p: Pick) => {
        if (!p) return <X className="w-6 h-6 text-text-muted" />;
        const row = (group === 'mounts' ? mounts : petRows).find(r => r.rarity === p.rarity && r.id === p.id);
        return row ? sheetIcon(group, row.index) : null;
    };
    const fairyIcon = (name: FairyName | null) => {
        const f = FAIRIES.find(x => x.name === name);
        return f ? <img src={`${textureBase}${f.texture}`} alt={f.name} className="w-11 h-11 object-contain" /> : <X className="w-6 h-6 text-text-muted" />;
    };

    // ---------------------------------------------------------------- the build drawn
    const setId = useMemo(() => {
        if (!aura || !skinsLib) return null;
        const ids = GEAR.map(s => {
            const idx = pieces[s].skin;
            if (idx === null) return null;
            return Object.values<any>(skinsLib).find(r => r.SkinId.Type === SLOT_TYPE[s] && r.SkinId.Idx === idx)?.BaseSetId ?? null;
        });
        return ids.every(id => id && id === ids[0]) ? ids[0] : null;
    }, [aura, skinsLib, pieces]);

    const companions = !!mount || pets.some(Boolean) || !!fairy;
    const look: UserProfile = useMemo(() => {
        const item = (s: GearSlot): ItemSlot => {
            const p = pieces[s];
            const type = SLOT_TYPE[s];
            return {
                age: p.age, idx: p.idx, level: 1, rarity: 'Common', secondaryStats: [],
                skin: p.skin === null ? undefined : { idx: p.skin, type, stats: {}, level: skinMaxLevel(skinUpgradeLib, type, p.skin) },
            };
        };
        const base: UserProfile = JSON.parse(JSON.stringify(INITIAL_PROFILE));
        return {
            ...base,
            items: { ...base.items, Helmet: item('Helmet'), Body: item('Body'), Weapon: item('Weapon') },
            mount: { ...base.mount, active: mount ? { ...mount, level: 1, evolution: 0, skills: [] } : null },
            pets: { ...base.pets, active: pets.filter((p): p is NonNullable<Pick> => !!p).map(p => ({ ...p, level: 1, evolution: 0 })) },
            misc: { ...base.misc, fairy: { name: fairy, level: 1 }, petAscensionLevel: petAscension, mountAscensionLevel: mountAscension, useSkinWindup: true },
        };
    }, [pieces, mount, pets, fairy, petAscension, mountAscension, skinUpgradeLib]);
    const background = bgKind === 'map' ? maps.find(m => m.id === mapId)?.bg ?? null : null;
    const weaponRanged = pieces.Weapon.skin !== null ? skinRanged : isRangedWeapon(look, weaponLibrary);
    const unitsTall = companions ? 6.4 : 3.6;

    // ---------------------------------------------------------------- actions
    const fromProfile = () => {
        const it = profile.items;
        const piece = (s: GearSlot): Piece => {
            const i = it[s];
            const hidden = s === 'Weapon' ? profile.misc.useSkinWindup === false : profile.misc.skinVisible?.[s as 'Helmet' | 'Body'] === false;
            return i ? { age: i.age, idx: i.idx, skin: i.skin && !hidden ? i.skin.idx : null } : { age: 0, idx: 0, skin: null };
        };
        setPieces({ Helmet: piece('Helmet'), Body: piece('Body'), Weapon: piece('Weapon') });
        setSkinRanged(isRangedWeapon(profile, weaponLibrary));
        const m = profile.mount.active;
        setMount(m ? { rarity: m.rarity, id: m.id } : null);
        setPets([0, 1, 2].map(i => { const p = profile.pets.active[i]; return p ? { rarity: p.rarity, id: p.id } : null; }));
        setFairy(profile.misc.fairy?.name ?? null);
        setPetAscension(profile.misc.petAscensionLevel ?? 0);
        setMountAscension(profile.misc.mountAscensionLevel ?? 0);
    };
    const randomize = () => {
        const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
        const next = {} as Record<GearSlot, Piece>;
        for (const s of GEAR) {
            const it = pick(itemsOf[SLOT_TYPE[s]] ?? [{ age: 0, idx: 0 }]);
            const skins = skinsOf[SLOT_TYPE[s]] ?? [];
            next[s] = { ...it, skin: skins.length && Math.random() < 0.6 ? pick(skins) : null };
        }
        setPieces(next);
        setMount(mounts.length ? pick(mounts) : null);
        setPets([0, 1, 2].map(() => (petRows.length && Math.random() < 0.7 ? pick(petRows) : null)));
        setFairy(pick([null, ...FAIRIES.map(f => f.name)]));
    };
    const download = (href: string, name: string) => {
        const a = document.createElement('a');
        a.download = name;
        a.href = href;
        a.click();
    };
    const exportPng = () => {
        const src = canvas.current;
        if (!src) return;
        const out = document.createElement('canvas');
        out.width = exportSize;
        out.height = exportSize;
        const ctx = out.getContext('2d')!;
        if (bgKind === 'color') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, exportSize, exportSize); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, exportSize, exportSize);
        download(out.toDataURL('image/png'), `character_${Date.now()}.png`);
    };
    const exportGif = async () => {
        setGifProgress(0);
        try {
            const blob = await portraitGif({
                profile: look, setId, pets: companions, background, weaponRanged, size: exportSize, scale: exportSize / unitsTall,
                loops: gifLoops, fps: GIF_FPS, color: bgKind === 'color' ? bgColor : null,
            }, setGifProgress);
            const url = URL.createObjectURL(blob);
            download(url, `character_${Date.now()}.gif`);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } finally {
            setGifProgress(null);
        }
    };
    const pause = () => { setFrame(liveFrame.current); setPlaying(false); };
    const stepFrame = (d: number) => { const f = Math.max(0, (playing ? liveFrame.current : frame) + d); setPlaying(false); setFrame(f); };

    // ---------------------------------------------------------------- picker panel
    const picker = (() => {
        if (!open) return null;
        if (open === 'Helmet' || open === 'Body' || open === 'Weapon') {
            const slot = open;
            const type = SLOT_TYPE[slot];
            const ages = [...new Set((itemsOf[type] ?? []).map(i => i.age))];
            return (
                <div className="space-y-2">
                    {slot === 'Weapon' && gearTab === 'skins' && (
                        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                            Skin variant
                            {([false, true] as const).map(r => (
                                <button key={String(r)} onClick={() => setSkinRanged(r)}
                                    className={cn('px-2 py-0.5 rounded-md font-bold', skinRanged === r ? 'bg-accent-primary text-white' : 'bg-bg-input hover:text-text-primary')}>
                                    {r ? 'Ranged' : 'Melee'}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                        {(['skins', ...ages] as ('skins' | number)[]).map(t => (
                            <button key={String(t)} onClick={() => setGearTab(t)}
                                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold', gearTab === t ? 'bg-accent-primary text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary')}>
                                {t === 'skins' ? 'Skins' : AGES[t]}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-1.5 max-h-72 overflow-y-auto pr-1">
                        {gearTab === 'skins'
                            ? (skinsOf[type] ?? []).map(idx => (
                                <Tile key={idx} label={skinDisplayName(skinsLib, type, idx)} selected={pieces[slot].skin === idx}
                                    onClick={() => setPieces(p => ({ ...p, [slot]: { ...p[slot], skin: idx } }))}>{skinIcon(slot, idx)}</Tile>
                            ))
                            : (itemsOf[type] ?? []).filter(i => i.age === gearTab).map(i => (
                                <Tile key={`${i.age}_${i.idx}`} label={getItemName(AGES[i.age], slot, i.idx, autoMapping) ?? `${GEAR_LABEL[slot]} ${i.idx + 1}`}
                                    selected={pieces[slot].skin === null && pieces[slot].age === i.age && pieces[slot].idx === i.idx}
                                    onClick={() => setPieces(p => ({ ...p, [slot]: { age: i.age, idx: i.idx, skin: null } }))}>{itemIcon(slot, i.age, i.idx)}</Tile>
                            ))}
                    </div>
                </div>
            );
        }
        if (open === 'Mount' || open.startsWith('Pet')) {
            const isMount = open === 'Mount';
            const rows = isMount ? mounts : petRows;
            const current = isMount ? mount : pets[Number(open.slice(3))];
            const set = (p: Pick) => (isMount ? setMount(p) : setPets(prev => prev.map((x, j) => (j === Number(open.slice(3)) ? p : x))));
            return (
                <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-1.5 max-h-72 overflow-y-auto pr-1">
                    <Tile label="None" selected={!current} onClick={() => set(null)}><X className="w-6 h-6 text-text-muted" /></Tile>
                    {rows.map(r => (
                        <Tile key={`${r.rarity}_${r.id}`} label={`${r.name} (${r.rarity})`} selected={!!current && current.rarity === r.rarity && current.id === r.id}
                            onClick={() => set({ rarity: r.rarity, id: r.id })}>{sheetIcon(isMount ? 'mounts' : 'pets', r.index)}</Tile>
                    ))}
                </div>
            );
        }
        if (open === 'Fairy') {
            return (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {[null, ...FAIRIES.map(f => f.name)].map(n => (
                        <Tile key={n ?? 'none'} label={n ?? 'None'} selected={fairy === n} onClick={() => setFairy(n)}>{fairyIcon(n)}</Tile>
                    ))}
                </div>
            );
        }
        return (
            <div className="space-y-2">
                <div className="grid grid-cols-4 sm:grid-cols-6 xl:grid-cols-8 gap-1.5 max-h-72 overflow-y-auto pr-1">
                    <Tile label="Transparent" selected={bgKind === 'transparent'} onClick={() => setBgKind('transparent')}>
                        <div className="w-11 h-11 rounded-lg" style={{ background: 'repeating-conic-gradient(#3a404c 0% 25%, #252a33 0% 50%) 50% / 10px 10px' }} />
                    </Tile>
                    <Tile label="Color" selected={bgKind === 'color'} onClick={() => setBgKind('color')}>
                        <div className="w-11 h-11 rounded-lg border border-white/20" style={{ background: bgColor }} />
                    </Tile>
                    {maps.map(m => (
                        <Tile key={m.id} label={m.label} selected={bgKind === 'map' && mapId === m.id} onClick={() => { setBgKind('map'); setMapId(m.id); }}>
                            <div className="w-11 h-11 rounded-lg border border-white/20" style={{ background: `rgb(${m.bg.ground.slice(0, 3).map(v => Math.round(v * 255)).join(',')})` }} />
                        </Tile>
                    ))}
                </div>
                {bgKind === 'color' && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">Color <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-10 h-8 rounded border border-border bg-transparent" /></label>
                )}
            </div>
        );
    })();

    const slotButton = (id: PickerId, label: string, icon: React.ReactNode) => (
        <button key={id} onClick={() => setOpen(o => (o === id ? null : id))}
            className={cn('flex flex-col items-center gap-1 p-2 rounded-xl border w-[4.75rem]', open === id ? 'border-accent-primary bg-accent-primary/15' : 'border-border bg-bg-input/40 hover:bg-bg-input')}>
            <div className="w-12 h-12 flex items-center justify-center overflow-hidden">{icon}</div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">{label}</span>
        </button>
    );
    const mapLabel = maps.find(m => m.id === mapId)?.label;

    return (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-6">
            <div className="space-y-4 order-2 xl:order-1 min-w-0">
                <div className="flex flex-wrap gap-2">
                    <button onClick={fromProfile} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20">
                        <User className="w-4 h-4" /> Load my character
                    </button>
                    <button onClick={randomize} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border border-border text-text-secondary hover:bg-bg-input">
                        <Shuffle className="w-4 h-4" /> Randomize
                    </button>
                </div>

                <div className="flex flex-wrap gap-2">
                    {GEAR.map(s => slotButton(s, GEAR_LABEL[s], pieceIcon(s)))}
                    {slotButton('Mount', 'Mount', pickIcon('mounts', mount))}
                    {[0, 1, 2].map(i => slotButton(`Pet${i}` as PickerId, `Pet ${i + 1}`, pickIcon('pets', pets[i])))}
                    {slotButton('Fairy', 'Fairy', fairyIcon(fairy))}
                    {slotButton('Background', 'Background', bgKind === 'map'
                        ? <span className="text-[10px] text-text-secondary text-center leading-tight">{mapLabel}</span>
                        : <div className="w-11 h-11 rounded-lg border border-white/20" style={{ background: bgKind === 'color' ? bgColor : 'repeating-conic-gradient(#3a404c 0% 25%, #252a33 0% 50%) 50% / 10px 10px' }} />)}
                </div>

                {picker && <div className="rounded-2xl border border-border bg-bg-secondary/30 p-3">{picker}</div>}

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={aura} onChange={e => setAura(e.target.checked)} className="accent-accent-primary" />
                        <GameAssetIcon asset={{ icon: 'Sparkle' }} size={16} /> Set aura
                        <span className="text-[11px] font-normal text-text-muted">{setId ? '' : '(three skins of one set)'}</span>
                    </label>
                    {([['Pet ascension', petAscension, setPetAscension, maxAsc('Pets')], ['Mount ascension', mountAscension, setMountAscension, maxAsc('Mounts')]] as const).map(([label, value, set, max]) => (
                        <label key={label} className="flex items-center gap-2 text-sm font-semibold">
                            {label}
                            <input type="range" min={0} max={max} value={value} onChange={e => set(Number(e.target.value))} className="w-24 accent-accent-primary" />
                            <span className="text-xs text-text-secondary">{value}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="order-1 xl:order-2 space-y-3">
                <div className="rounded-2xl border border-border overflow-hidden mx-auto"
                    style={{
                        width: PREVIEW, maxWidth: '100%', aspectRatio: '1',
                        background: bgKind === 'color' ? bgColor : 'repeating-conic-gradient(#2a2f3a 0% 25%, #1f232c 0% 50%) 50% / 24px 24px',
                    }}>
                    <BuildPortrait profile={look} setId={setId} width={PREVIEW} height={PREVIEW} scale={PREVIEW / unitsTall}
                        pets={companions} anchor="center" background={background} weaponRanged={weaponRanged} playing={playing} frame={frame}
                        onFrame={f => { liveFrame.current = f; }} canvasHandle={handle} />
                </div>
                <div className="flex items-center justify-center gap-1.5">
                    <button onClick={() => stepFrame(-1)} title="Previous frame" className="p-2 rounded-lg border border-border hover:bg-bg-input"><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={() => (playing ? pause() : setPlaying(true))} title={playing ? 'Pause' : 'Play'}
                        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:brightness-110">
                        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button onClick={() => stepFrame(1)} title="Next frame" className="p-2 rounded-lg border border-border hover:bg-bg-input"><ChevronRight className="w-4 h-4" /></button>
                    <span className="text-[11px] font-mono text-text-muted w-36 text-center whitespace-nowrap">{playing ? 'playing' : `frame ${frame} (${(frame / FRAME_RATE).toFixed(2)} s)`}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-center">
                    <select value={exportSize} onChange={e => setExportSize(Number(e.target.value))} className="px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs">
                        {EXPORT_SIZES.map(s => <option key={s} value={s}>{s} px</option>)}
                    </select>
                    <button onClick={exportPng} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-accent-primary text-white hover:brightness-110">
                        <Download className="w-4 h-4" /> PNG
                    </button>
                    <select value={gifLoops} onChange={e => setGifLoops(Number(e.target.value))} title="Loops of the animation in the GIF" className="px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs">
                        {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} {n === 1 ? 'loop' : 'loops'}</option>)}
                    </select>
                    <button onClick={exportGif} disabled={gifProgress !== null} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border border-accent-primary/50 text-accent-primary hover:bg-accent-primary/10 disabled:opacity-60">
                        <Film className="w-4 h-4" /> {gifProgress !== null ? `GIF ${Math.round(gifProgress * 100)}%` : 'GIF'}
                    </button>
                </div>
                {bgKind === 'transparent' && <p className="text-[10px] text-text-muted text-center max-w-[420px]">A transparent GIF has hard edges (GIF keeps one level of transparency); pick a colour or a battlefield for smooth ones.</p>}
            </div>
        </div>
    );
}
