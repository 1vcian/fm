import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    X, UploadCloud, Check, Loader2, Image as ImageIcon, Sparkles,
    AlertTriangle, Trash2, ScanSearch, CheckCircle2, ArrowRight, GitBranch, Bookmark,
} from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import { buildGameDictionaries } from '../../utils/ocr/gameLocalization';
import { preloadOcr, terminateOcr } from '../../utils/ocr/ocrEngine';
import {
    applyChanges, buildItemPatch, substatSummary, skinSummary, planPresetSaves,
    ITEM_SLOTS, type ChangeRow, type AutoSyncProgress,
} from '../../utils/ocr/autoSync';
import { classifyBatch, runGuidedSync, type ForcedTemplate, type GuidedEntry, type HintedTemplate } from '../../utils/ocr/guidedSync';
import { buildSkinDict, resolveSkinForSlot, SKIN_SLOTS } from '../../utils/ocr/skinReader';
import type { ItemSlot } from '../../types/Profile';
import { getItemImage } from '../../utils/itemAssets';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { AGES } from '../../utils/constants';
import { SUBSTAT_DEFS } from '../../utils/ocr/gameDictionary';
import { getStatName } from '../../utils/statNames';
import { SpriteIcon } from '../UI/SpriteIcon';
import { cn } from '../../lib/utils';

// upload -> review (confirm the detected template per screenshot) -> processing -> diff -> done
type Stage = 'upload' | 'review' | 'processing' | 'diff' | 'done';

type TemplateChoice = ForcedTemplate | 'skip';
interface ReviewItem {
    choice: TemplateChoice | null;      // null while auto-detection is still pending (no preset)
    detected: HintedTemplate | null;    // classifier hint incl. 'skin' (null = still detecting)
    detConfidence: number;
    touched: boolean;                   // user changed the dropdown -> never auto-override
}
const TEMPLATE_OPTIONS: { value: TemplateChoice; label: string }[] = [
    { value: 'item', label: 'Item' },
    { value: 'mount', label: 'Mount' },
    { value: 'pet', label: 'Pet' },
    { value: 'skills', label: 'Skills' },
    { value: 'clanTree', label: 'Clan Tree' },
    { value: 'skin', label: 'Skin' },
    { value: 'skip', label: 'Skip' },
];
const PRESET_LABEL: Record<ForcedTemplate, string> = { item: 'Item', mount: 'Mount', pet: 'Pet', skills: 'Skills', clanTree: 'Clan Tree', skin: 'Skin' };
const PRESET_SUBTITLE: Record<ForcedTemplate, string> = {
    item: 'Sync your equipment from screenshots',
    mount: 'Sync your mount from screenshots',
    pet: 'Sync your pets from screenshots',
    skills: 'Sync your skills from screenshots',
    clanTree: 'Scan the clan tech tree levels from screenshots',
    skin: 'Sync your equipped skins from the skin popups',
};

const CATEGORY_LABEL: Record<ChangeRow['category'], string> = {
    item: 'Equipment', pet: 'Pets', mount: 'Mount', skill: 'Skills', currency: 'Resources', skinEquip: 'Skins',
    clanTree: 'Clan Tree',
};
const CURRENCY_ICON: Record<string, string> = {
    Coins: 'Coin', Gems: 'GemSquare', Eggshells: 'Eggshell', 'Skill Tickets': 'SkillTicket', 'Clock Winders': 'MountKey',
    Hammers: 'Hammer', 'Forge Level': 'Hammer', 'Guild Potions': 'GuildPotions',
};
const PET_SLOTS = [0, 1, 2] as const; // pets.active indices (MAX_ACTIVE_PETS = 3)

// Every control in this modal states its OWN colours. Two ways this modal has shipped
// unreadable text before:
//   1. it renders in a portal on document.body, so anything without a text-* class inherits the
//      UA default (BLACK) and lands on the near-black panel;
//   2. an unstyled <option> list is painted by the OS in LIGHT mode (no color-scheme is declared
//      anywhere in the app), so `text-white` options came out white-on-white in the dropdown.
// Hence: explicit token on every input/select/label, `color-scheme:dark` for the native bits,
// and explicit option colours. Never rely on inheritance here.
const INPUT_CLS = 'bg-bg-input border border-border rounded text-text-primary outline-none focus:border-accent-primary [color-scheme:dark]';
const NUM_CLS = `${INPUT_CLS} font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;
const SELECT_CLS = `${INPUT_CLS} [&>option]:bg-bg-secondary [&>option]:text-text-primary`;
/** An overridden value must never look like something the scanner read. */
const EDITED_RING = 'border-amber-400 text-amber-200 ring-1 ring-amber-400/40';

/** One-line summary of a pet/mount patch — stars included, so an ascension edit shows up in it. */
const unitSummary = (u: { level: number; ascensionLevel?: number; secondaryStats?: { statId: string; value: number }[] }) =>
    `Lv.${u.level}${u.ascensionLevel ? ` ★${u.ascensionLevel}` : ''} · ${substatSummary(u.secondaryStats || [])}`;

/** Ascension a row carries, wherever that patch kind keeps it (0 for rows that carry none). */
const rowAscension = (r: ChangeRow): number =>
    r.patch.t === 'pet' ? (r.patch.pet.ascensionLevel ?? 0)
        : r.patch.t === 'mount' ? (r.patch.mount.ascensionLevel ?? 0)
            : r.patch.t === 'skill' ? (r.patch.ascension ?? 0)
                : (r.detected?.stars ?? 0);
const starText = (n: number) => (n > 0 ? '★'.repeat(n) : 'none');
/** Evidence crop for an ascension picker. Only a reader-published star crop goes INSIDE the picker
 *  (readers may add `starsCropUrl` to Detected): the level band is already rendered on the same
 *  line, so echoing it inside the picker would show one crop twice. */
const starCrop = (r: ChangeRow): string | undefined =>
    (r.detected as { starsCropUrl?: string } | undefined)?.starsCropUrl;

function ConfidenceChip({ c }: { c: number }) {
    const [label, cls] = c >= 0.75 ? ['high', 'text-green-400 bg-green-500/10 border-green-500/30']
        : c >= 0.6 ? ['medium', 'text-amber-400 bg-amber-500/10 border-amber-500/30']
            : ['low', 'text-red-400 bg-red-500/10 border-red-500/30'];
    return <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border', cls)}>{label}</span>;
}

export function AutoSyncModal({ onClose, preset }: { onClose: () => void; preset?: ForcedTemplate }) {
    const { profile, updateProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();

    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const dicts = useMemo(
        () => buildGameDictionaries({ autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization }),
        [autoItemMapping, skillLibrary, spriteMapping, secondaryStatLibrary, localization]
    );
    const skinDict = useMemo(() => buildSkinDict(skinsLibrary, setsLibrary), [skinsLibrary, setsLibrary]);

    // reverse (rarity_id -> spriteIndex) for pet/mount sprite rendering
    const unitIndex = useMemo(() => {
        const build = (sec: any) => {
            const m: Record<string, number> = {};
            for (const [k, v] of Object.entries<any>(sec?.mapping || {})) m[`${v.rarity}_${v.id}`] = parseInt(k);
            return m;
        };
        return { pet: build(spriteMapping?.pets), mount: build(spriteMapping?.mounts), petCfg: spriteMapping?.pets, mountCfg: spriteMapping?.mounts };
    }, [spriteMapping]);

    const [files, setFiles] = useState<File[]>([]);
    const [urls, setUrls] = useState<string[]>([]);
    const [stage, setStage] = useState<Stage>('upload');
    const [review, setReview] = useState<ReviewItem[]>([]);
    const [progress, setProgress] = useState<AutoSyncProgress | null>(null);
    const [rows, setRows] = useState<ChangeRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const classifyGen = useRef(0); // ignores stale classifyBatch callbacks after a re-entry
    // Which fields the USER changed after the read, as `${rowId}:${field}`. Star detection is the
    // one reading that is plausibly wrong, so the override needs a control — but an overridden
    // value must never be mistaken for what the scanner saw, hence this set drives a distinct
    // style + an "edited" chip that can put the scanned value back.
    const [edits, setEdits] = useState<Record<string, boolean>>({});
    const isEdited = (id: string, field: string) => !!edits[`${id}:${field}`];
    const markEdited = (id: string, field: string) => setEdits(e => ({ ...e, [`${id}:${field}`]: true }));
    const clearEdited = (id: string, field: string) => setEdits(e => {
        const next = { ...e }; delete next[`${id}:${field}`]; return next;
    });
    /** Ascension exactly as READ, per row — what the "edited" chip reports and reverts to. */
    const scanRef = useRef<Record<string, { stars: number; skillAsc: number | null; after: string }>>({});
    const backdropDown = useRef(false); // pointer went down on the backdrop, not inside the panel

    useEffect(() => { preloadOcr().catch(() => {}); return () => { terminateOcr().catch(() => {}); }; }, []);
    useEffect(() => {
        const u = files.map(f => URL.createObjectURL(f));
        setUrls(u);
        return () => u.forEach(URL.revokeObjectURL);
    }, [files]);

    const addFiles = (list: FileList | null) => {
        if (!list) return;
        setFiles(prev => [...prev, ...Array.from(list).filter(f => f.type.startsWith('image/'))]);
    };

    // Phase 1 — enter the review stage: every file gets a template dropdown. With a preset the
    // dropdown defaults to it immediately; the classifier still runs in the background and its
    // guess is shown as a hint. Without a preset the detected type becomes the default
    // (unknown/enemy default to Skip).
    const startReview = () => {
        if (!files.length) return;
        setError(null);
        setReview(files.map(() => ({ choice: preset ?? null, detected: null, detConfidence: 0, touched: false })));
        setStage('review');
        const gen = ++classifyGen.current;
        classifyBatch(files, (i, res) => {
            if (classifyGen.current !== gen) return;
            setReview(rs => rs.map((r, j) => {
                if (j !== i) return r;
                const readable = res.type === 'item' || res.type === 'pet' || res.type === 'mount' || res.type === 'skills' || res.type === 'clanTree' || res.type === 'skin';
                const choice = (preset || r.touched)
                    ? r.choice
                    : (readable ? res.type as ForcedTemplate : 'skip');
                return { ...r, detected: res.type, detConfidence: res.confidence, choice };
            }));
        }).catch(() => { /* per-file failures already surface as 'unknown' */ });
    };

    const setChoice = (i: number, v: TemplateChoice) =>
        setReview(rs => rs.map((r, j) => j === i ? { ...r, choice: v, touched: true } : r));

    const pendingCount = review.filter(r => r.choice === null).length;
    const processCount = review.filter(r => r.choice && r.choice !== 'skip').length;

    // Phase 2 — read each non-skipped file with its confirmed template, then diff.
    const process = async () => {
        const entries: GuidedEntry[] = [];
        files.forEach((file, i) => {
            const c = review[i]?.choice;
            if (c && c !== 'skip') entries.push({ file, template: c });
        });
        if (!entries.length) return;
        setStage('processing'); setError(null); setProgress(null);
        try {
            const { rows } = await runGuidedSync(entries, dicts, profile, setProgress, skinDict);
            setRows(rows);
            // snapshot the AS-READ ascension per row before the user can touch anything
            scanRef.current = Object.fromEntries(rows.map(r => [r.id, {
                stars: rowAscension(r),
                skillAsc: r.patch.t === 'skill' ? (r.patch.ascension ?? null) : null,
                after: r.after,
            }]));
            setEdits({});
            setStage('diff');
        } catch (e: any) {
            setError(e?.message || 'OCR failed. Try clearer screenshots.'); setStage('review');
        }
    };

    const toggle = (id: string) => setRows(rs => rs.map(r => r.id === id ? { ...r, accepted: !r.accepted } : r));
    const setAll = (v: boolean) => setRows(rs => rs.map(r => ({ ...r, accepted: v })));
    const changeSlot = (id: string, slot: string) => setRows(rs => rs.map(r => {
        if (r.id !== id || r.category !== 'item' || !r.detected) return r;
        const patch = buildItemPatch(profile, slot, r.detected, r.confidence >= 0.7);
        const newItem = (patch as { item: ItemSlot }).item;
        const cur = (profile.items as any)[slot] as ItemSlot | null;
        return {
            ...r, slot, patch, action: cur ? 'replace' : 'add',
            before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats)}` : null,
            after: `Lv.${newItem.level} · ${substatSummary(newItem.secondaryStats)}`,
        };
    }));
    // skinEquip rows: moving the slot re-resolves the skin piece inside the SAME set (Helmet
    // popup misread as Body etc.). If the set has no piece for the new slot, keep the skin as-is.
    const changeSkinSlot = (id: string, slot: string) => setRows(rs => rs.map(r => {
        if (r.id !== id || r.patch.t !== 'skinEquip') return r;
        const entry = resolveSkinForSlot(skinDict, r.detected?.setId, slot);
        const skin = entry ? { ...r.patch.skin, idx: entry.idx, type: entry.type } : r.patch.skin;
        const patch = { ...r.patch, slot, skin };
        const cur = (profile.items as any)[slot] as ItemSlot | null;
        return {
            ...r, slot, patch,
            action: cur?.skin ? 'replace' as const : 'add' as const,
            before: cur ? skinSummary(cur.skin) : null,
            after: skinSummary(skin),
            detail: skinSummary(skin),
        };
    }));
    const changeLevel = (id: string, lvl: number) => {
        markEdited(id, 'level');
        setRows(rs => rs.map(r => {
            if (r.id !== id || !r.detected) return r;
            const detected = { ...r.detected, level: lvl };
            if (r.category === 'item' && r.slot) {
                const patch = buildItemPatch(profile, r.slot, detected, r.confidence >= 0.7);
                const it = (patch as { item: ItemSlot }).item;
                return { ...r, detected, patch, after: `Lv.${it.level} · ${substatSummary(it.secondaryStats)}` };
            }
            if (r.patch.t === 'pet') {
                const pet = { ...r.patch.pet, level: lvl };
                return { ...r, detected, patch: { ...r.patch, pet }, after: unitSummary(pet), detail: unitSummary(pet) };
            }
            if (r.patch.t === 'mount') {
                const mount = { ...r.patch.mount, level: lvl };
                return { ...r, detected, patch: { ...r.patch, mount }, after: unitSummary(mount), detail: unitSummary(mount) };
            }
            return { ...r, detected };
        }));
    };
    const changeSubstat = (id: string, i: number, patchObj: { statId?: string | null; value?: number }) => {
        markEdited(id, `substat${i}`);
        setRows(rs => rs.map(r => {
            if (r.id !== id || !r.detected?.substats) return r;
            const subs = r.detected.substats.map((s, j) => j === i ? { ...s, ...patchObj } : s);
            const detected = { ...r.detected, substats: subs };
            const ss = subs.filter(s => s.statId).map(s => ({ statId: s.statId!, value: s.value }));
            if (r.category === 'item' && r.slot) {
                const patch = buildItemPatch(profile, r.slot, detected, r.confidence >= 0.7);
                const it = (patch as { item: ItemSlot }).item;
                return { ...r, detected, patch, after: `Lv.${it.level} · ${substatSummary(it.secondaryStats)}` };
            }
            if (r.patch.t === 'pet') {
                const pet = { ...r.patch.pet, secondaryStats: ss };
                return { ...r, detected, patch: { ...r.patch, pet }, after: unitSummary(pet), detail: unitSummary(pet) };
            }
            if (r.patch.t === 'mount') {
                const mount = { ...r.patch.mount, secondaryStats: ss };
                return { ...r, detected, patch: { ...r.patch, mount }, after: unitSummary(mount), detail: unitSummary(mount) };
            }
            return { ...r, detected };
        }));
    };
    const changeAge = (id: string, age: number) => setRows(rs => rs.map(r => {
        if (r.id !== id || r.category !== 'item' || !r.detected || !r.slot) return r;
        const detected = { ...r.detected, age };
        return { ...r, detected, patch: buildItemPatch(profile, r.slot, detected, true) };
    }));
    // pets are SLOT-addressed: moving the slot re-targets pets.active[slotIndex]. The owner keeps
    // two pets of the SAME species with different stats, so "which slot" is the user's call — an
    // apply that matched by species would overwrite the wrong twin.
    const changePetSlot = (id: string, slotIndex: number) => {
        markEdited(id, 'petSlot');
        setRows(rs => rs.map(r => {
            if (r.id !== id || r.patch.t !== 'pet') return r;
            const cur = (profile.pets.active ?? [])[slotIndex] ?? null;
            return {
                ...r, patch: { ...r.patch, slotIndex },
                action: cur ? 'update' as const : 'add' as const,
                before: cur ? `Lv.${cur.level} · ${substatSummary(cur.secondaryStats || [])}` : null,
            };
        }));
    };
    /** "Slot 2 — Lv.40 (occupied)" so it is clear WHICH pet a row is about to replace. */
    const petSlotLabel = (i: number) => {
        const cur = (profile.pets.active ?? [])[i] ?? null;
        return `Slot ${i + 1}. ${cur ? `${cur.customName || `${cur.rarity} #${cur.id}`} Lv.${cur.level}` : 'empty'}`;
    };
    // ---- ascension stars (0-3), editable for everything that carries them -------------------
    // Pets and mounts keep ascension on the unit itself (PetSlot/MountSlot.ascensionLevel), skills
    // on the SkillSlot. ITEM stars are the FORGE's ascension (a single misc value, not a per-item
    // field), so an item row has no ascension to write — its stars stay read-only evidence here.
    const changeAscension = (id: string, asc: number) => { applyAscension(id, asc); markEdited(id, 'ascension'); };
    const revertAscension = (id: string) => {
        const base = scanRef.current[id];
        applyAscension(id, base ? (base.skillAsc ?? base.stars) : 0, { restoreAfter: base?.after, asNull: !!base && base.skillAsc === null });
        clearEdited(id, 'ascension');
    };
    function applyAscension(id: string, asc: number, opts?: { restoreAfter?: string; asNull?: boolean }) {
        const a = Math.max(0, Math.min(3, Math.round(asc) || 0));
        setRows(rs => rs.map(r => {
            if (r.id !== id) return r;
            const detected = { ...r.detected, stars: a };
            if (r.patch.t === 'pet') {
                const pet = { ...r.patch.pet, ascensionLevel: a };
                return { ...r, detected, patch: { ...r.patch, pet }, after: unitSummary(pet), detail: unitSummary(pet) };
            }
            if (r.patch.t === 'mount') {
                const mount = { ...r.patch.mount, ascensionLevel: a };
                return { ...r, detected, patch: { ...r.patch, mount }, after: unitSummary(mount), detail: unitSummary(mount) };
            }
            if (r.patch.t === 'skill') {
                // reverting a row whose ascension was UNREAD restores null ("leave it alone"),
                // never a hard 0 that would wipe an ascension the profile already has
                const ascension = opts?.asNull ? null : a;
                return {
                    ...r, detected: { ...r.detected, stars: opts?.asNull ? 0 : a },
                    patch: { ...r.patch, ascension },
                    after: opts?.restoreAfter ?? `Lv.${r.patch.level}${a > 0 ? ` ★${a}` : ''}`,
                };
            }
            return r;
        }));
    }
    // Forge Level / Hammers rows: editable value
    const changeCurrencyValue = (id: string, value: number) => {
        markEdited(id, 'value');
        setRows(rs => rs.map(r => {
            if (r.id !== id) return r;
            const v = Math.max(0, value || 0);
            if (r.patch.t === 'forgeHammers') return { ...r, patch: { ...r.patch, value: v }, after: String(v) };
            if (r.patch.t === 'currency') return { ...r, patch: { ...r.patch, value: v }, after: String(v) };
            return r;
        }));
    };
    // clan-tree rows: editable node level, clamped to the library MaxLevel
    const changeClanLevel = (id: string, lvl: number) => {
        markEdited(id, 'level');
        setRows(rs => rs.map(r => {
            if (r.id !== id || r.patch.t !== 'clanTree') return r;
            const v = Math.max(0, Math.min(r.patch.max || lvl, lvl || 0));
            return {
                ...r, patch: { ...r.patch, level: v },
                after: `Lv ${v}`,
                detail: `${r.before} → Lv ${v}`,
                detected: { ...r.detected, level: v },
            };
        }));
    };
    const [savePresets, setSavePresets] = useState(true);

    const acceptedCount = rows.filter(r => r.accepted).length;
    // Bookmarks the apply would ALSO write (append-only, skips anything already saved). Shown
    // per-row and in the footer so auto-saving is never a surprise.
    const presetPlan = useMemo(() => (savePresets ? planPresetSaves(profile, rows) : []), [profile, rows, savePresets]);
    const presetRowIds = useMemo(() => new Set(presetPlan.flatMap(p => p.rowIds)), [presetPlan]);
    // Counted BEFORE applying: once the profile holds them, the plan is empty by design.
    const [presetsWritten, setPresetsWritten] = useState(0);
    const apply = () => {
        setPresetsWritten(presetPlan.length);
        updateProfile(applyChanges(profile, rows, { savePresets }));
        setStage('done');
    };
    const grouped = useMemo(() => {
        const g: Record<string, ChangeRow[]> = {};
        for (const r of rows) (g[r.category] ||= []).push(r);
        return g;
    }, [rows]);
    // CONFLICT RULE: two ACCEPTED pet rows targeting the same active slot block Apply (and >3
    // accepted pet rows always clash — there are only 3 slots).
    const petSlotConflicts = useMemo(() => {
        const count: Record<number, number> = {};
        for (const r of rows) if (r.accepted && r.patch.t === 'pet') count[r.patch.slotIndex] = (count[r.patch.slotIndex] ?? 0) + 1;
        return new Set(Object.entries(count).filter(([, c]) => c > 1).map(([s]) => parseInt(s)));
    }, [rows]);
    const hasPetConflict = petSlotConflicts.size > 0;

    // proposed-icon renderer
    const ProposedIcon = ({ row, size = 52 }: { row: ChangeRow; size?: number }) => {
        if (row.patch.t === 'item') {
            const it = row.patch.item;
            const src = getItemImage(AGES[it.age], row.slot === 'Shoe' ? 'Shoes' : (row.slot || ''), it.idx, autoItemMapping, selectedVersion || undefined);
            return src
                ? <img src={src} alt="" style={{ width: size, height: size }} className="object-contain" />
                : <div style={{ width: size, height: size }} className="rounded bg-bg-input flex items-center justify-center"><ImageIcon className="w-5 h-5 text-text-muted" /></div>;
        }
        if (row.patch.t === 'pet' || row.patch.t === 'mount') {
            const kind = row.patch.t;
            const ident = kind === 'pet' ? row.patch.pet : row.patch.mount;
            const idx = unitIndex[kind][`${ident.rarity}_${ident.id}`];
            const cfg = kind === 'pet' ? unitIndex.petCfg : unitIndex.mountCfg;
            if (idx != null && cfg && selectedVersion) {
                const sw = cfg.sprite_size?.width || 256, sh = cfg.sprite_size?.height || 256;
                const tw = cfg.texture_size?.width || 2048, th = cfg.texture_size?.height || 2048;
                const cols = Math.floor(tw / sw), rowsN = Math.floor(th / sh);
                const col = idx % cols, r = Math.floor(idx / cols);
                const tex = `${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/${cfg.texture}`;
                return <div style={{
                    width: size, height: size, backgroundImage: `url(${tex})`,
                    backgroundSize: `${cols * 100}% ${rowsN * 100}%`,
                    backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rowsN > 1 ? (r / (rowsN - 1)) * 100 : 0}%`,
                    imageRendering: 'pixelated',
                }} />;
            }
        }
        if (row.patch.t === 'skinEquip') {
            const sk = row.patch.skin;
            return <div
                style={{
                    width: size, height: size,
                    ...getSkinSpriteStyle({ SkinId: { Type: sk.type || 'Helmet', Idx: sk.idx } }, spriteMapping?.skins?.mapping, selectedVersion || undefined),
                }}
                className="rounded border border-border/50" />;
        }
        if (row.patch.t === 'currency' || row.patch.t === 'forgeHammers') return <SpriteIcon name={CURRENCY_ICON[row.label] || 'Coin'} size={size - 20} />;
        return <div style={{ width: size, height: size }} className="rounded bg-bg-input" />;
    };

    // small evidence crop: the exact screenshot pixels a value was read from
    const EvidenceCrop = ({ src, h = 20, maxW = 220, title = 'Read from this part of the screenshot' }:
        { src?: string; h?: number; maxW?: number; title?: string }) => {
        if (!src) return null;
        return <img src={src} alt="" title={title} style={{ height: h, maxWidth: maxW }}
            className="rounded border border-border object-contain bg-black/40 shrink-0" />;
    };

    /**
     * Ascension stars, 0-3, as a segmented picker — the ONE reading that is plausibly wrong, so it
     * gets a control rather than more accuracy. Four explicit choices (none / ★ / ★★ / ★★★) instead
     * of a number field: 2 and 3 stars are drawn superimposed in game, so the user is comparing the
     * picker against the crop pixel-by-pixel and must be able to say "none" as deliberately as "3".
     *
     * The evidence crop always stays beside the control: in `compact` rows (skills) the cell crop
     * sits immediately to the left, in the cards the level band shares the picker's line — and a
     * reader that publishes a dedicated star crop gets it rendered in `cropSrc` here.
     * An edited value is amber + labelled, and the chip puts back what was actually read.
     */
    const AscensionPicker = ({ row, cropSrc, compact = false }: { row: ChangeRow; cropSrc?: string; compact?: boolean }) => {
        const value = rowAscension(row);
        const edited = isEdited(row.id, 'ascension');
        const scanned = scanRef.current[row.id]?.stars ?? 0;
        // A skill row can carry ascension = null: the grid reader saw the cell but not its stars.
        // That is NOT "zero stars", and neither chip may claim it was read.
        const scanWasNull = row.patch.t === 'skill' && (scanRef.current[row.id]?.skillAsc ?? null) === null;
        const scannedLabel = scanWasNull ? 'not read' : starText(scanned);
        const unread = !edited && scanWasNull;
        return (
            // stopPropagation: these rows can be wrapped in a <label> whose click toggles the
            // row's checkbox — a star press must not also flip the accept state.
            // min-w-0 and no shrink-0: inside an overflow-hidden card, a group that refuses to
            // shrink pushes its own tail ("scanned"/"edited") past the panel edge, where it is
            // CLIPPED rather than scrollable. Shrinking lets it wrap instead.
            <span className="flex items-center gap-1.5 flex-wrap min-w-0"
                onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                {!compact && <span className="text-[9px] uppercase tracking-widest text-text-muted">Ascension</span>}
                <span role="radiogroup" aria-label={`Ascension stars for ${row.label}`}
                    className={cn('flex items-center rounded-lg border overflow-hidden', edited ? 'border-amber-400' : 'border-border')}>
                    {[0, 1, 2, 3].map(n => (
                        <button key={n} type="button" role="radio" aria-checked={value === n}
                            data-testid={`asc-${row.id}-${n}`}
                            title={n === 0 ? 'No ascension stars' : `${n} ascension star${n === 1 ? '' : 's'}`}
                            aria-label={n === 0 ? 'No ascension stars' : `${n} ascension star${n === 1 ? '' : 's'}`}
                            onClick={e => { e.preventDefault(); e.stopPropagation(); changeAscension(row.id, n); }}
                            // AMBER IS RESERVED FOR "the user changed this": a scanned pick is a
                            // neutral fill, so scanned and overridden can never be confused.
                            className={cn('px-1.5 py-1 text-[11px] leading-none font-bold border-r border-border last:border-r-0 transition-colors',
                                value === n
                                    ? (edited ? 'bg-amber-400/30 text-amber-100' : 'bg-white/15 text-text-primary')
                                    : 'bg-bg-input text-text-muted hover:text-text-primary')}>
                            {n === 0 ? '—' : '★'.repeat(n)}
                        </button>
                    ))}
                </span>
                <EvidenceCrop src={cropSrc} h={22} maxW={90} title="Compare the stars you picked with these screenshot pixels" />
                {edited ? (
                    <button type="button" data-testid={`asc-revert-${row.id}`}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); revertAscension(row.id); }}
                        title={`Edited by you. The scan ${scanWasNull ? 'could not read the stars' : `read ${starText(scanned)}`}. Click to put the scanned value back.`}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
                        edited · scan {scannedLabel} ↺
                    </button>
                ) : unread ? (
                    <span className="text-[9px] uppercase tracking-widest text-text-muted"
                        title="The scan did not read stars for this skill. Leave it and the profile keeps its current ascension, or pick a value to set one.">
                        not read
                    </span>
                ) : (
                    <span className="text-[9px] uppercase tracking-widest text-text-muted">scanned</span>
                )}
            </span>
        );
    };

    // editable substats (value + type) — user can fix any misread; each row shows the source
    // screenshot line it was read from so the value can be verified against the pixels
    const SubstatList = ({ row }: { row: ChangeRow }) => {
        const subs = row.detected?.substats || [];
        if (!subs.length) return null;
        return <div className="space-y-1 mt-0.5">
            {subs.map((s, i) => (
                <div key={i} className="space-y-0.5">
                    <EvidenceCrop src={s.cropUrl} h={19} />
                    <div className="flex items-center gap-1 text-[10px] text-text-secondary">
                        <input type="number" step="0.1" value={s.value}
                            onChange={e => changeSubstat(row.id, i, { value: parseFloat(e.target.value) || 0 })}
                            onFocus={e => e.target.select()}
                            className={cn('w-11 px-1 text-right', NUM_CLS, isEdited(row.id, `substat${i}`) && EDITED_RING)} />
                        <span className="text-text-muted">%</span>
                        <select value={s.statId ?? ''} onChange={e => changeSubstat(row.id, i, { statId: e.target.value || null })}
                            className={cn('px-1 py-0.5 max-w-[128px]', SELECT_CLS, isEdited(row.id, `substat${i}`) && EDITED_RING)}>
                            <option value="">—</option>
                            {SUBSTAT_DEFS.map(d => <option key={d.statId} value={d.statId}>{d.en}</option>)}
                        </select>
                    </div>
                </div>
            ))}
        </div>;
    };

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-[2px] p-2 md:p-4"
            // A drag that STARTS inside the panel (dragging a number field, selecting text in a
            // substat) used to close the modal on release and throw the whole diff away, so the
            // backdrop only closes when the pointer went down AND up on the backdrop itself.
            onPointerDown={e => { backdropDown.current = e.target === e.currentTarget; }}
            onClick={e => { if (e.target === e.currentTarget && backdropDown.current) onClose(); }}>
            {/* text-text-primary: this panel is portalled onto document.body, so anything without
                its own colour would inherit the UA default (black) on a near-black panel. */}
            <div className="bg-bg-primary text-text-primary w-full max-w-3xl max-h-[95vh] rounded-2xl border border-border/60 shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-accent-primary/15 to-accent-secondary/10">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-accent-primary/20 flex items-center justify-center shrink-0"><ScanSearch className="w-5 h-5 text-accent-primary" /></div>
                        <div className="min-w-0">
                            <h3 className="font-black text-white tracking-tight">AutoSync</h3>
                            <p className="text-[11px] text-text-muted whitespace-nowrap overflow-hidden text-clip">{preset ? PRESET_SUBTITLE[preset] : 'Read your gear, pets, mount & resources from screenshots'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {stage === 'upload' && (
                        <div className="space-y-4">
                            <div onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                                className="border-2 border-dashed border-accent-primary/40 rounded-2xl p-8 text-center cursor-pointer hover:bg-accent-primary/5 transition">
                                <UploadCloud className="w-10 h-10 mx-auto text-accent-primary mb-3" />
                                <p className="font-bold text-white">Drop screenshots here or tap to choose</p>
                                <p className="text-[11px] text-text-muted mt-1">Item, pet, mount, skill & skin screens. Any language. Everything runs on your device.</p>
                                <p className="text-[11px] text-amber-400/80 mt-1 font-bold">Use whole-screen captures. Don't crop them. The reader locates panels from the screen edges.</p>
                                <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
                            </div>
                            {!!files.length && (
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                    {urls.map((u, i) => (
                                        <div key={i} className="relative group aspect-[9/16] rounded-lg overflow-hidden border border-border">
                                            <img src={u} alt="" className="w-full h-full object-cover" />
                                            <button onClick={() => setFiles(f => f.filter((_, j) => j !== i))} className="absolute top-1 right-1 p-1 rounded bg-black/70 text-white opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {error && <p className="text-red-400 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</p>}
                            <button disabled={!files.length} onClick={startReview}
                                className="w-full py-3 rounded-xl font-bold bg-accent-primary text-white disabled:opacity-40 hover:brightness-110 transition flex items-center justify-center gap-2">
                                Review {files.length || ''} screenshot{files.length === 1 ? '' : 's'} <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {stage === 'review' && (
                        <div className="space-y-4">
                            <p className="text-[11px] text-text-muted">
                                Confirm what each screenshot shows before reading.{' '}
                                {preset
                                    ? <>This section presets everything to <span className="text-white font-bold">{PRESET_LABEL[preset]}</span>. Change any that differ, or skip them.</>
                                    : 'Wrong guess? Pick the right template, or skip the file.'}
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {files.map((_, i) => {
                                    const r = review[i];
                                    if (!r) return null;
                                    const skipped = r.choice === 'skip';
                                    return (
                                        <div key={i} className={cn('rounded-xl border overflow-hidden bg-bg-secondary/30 transition', skipped ? 'border-border/40 opacity-60' : 'border-accent-primary/30')}>
                                            <div className="aspect-[9/14] bg-black/40">
                                                <img src={urls[i]} alt="" className="w-full h-full object-contain" />
                                            </div>
                                            <div className="p-2 space-y-1">
                                                <select value={r.choice ?? ''} onChange={e => setChoice(i, e.target.value as TemplateChoice)}
                                                    className={cn('w-full rounded-lg px-1.5 py-1 text-xs font-bold', SELECT_CLS)}>
                                                    {r.choice === null && <option value="" disabled>Detecting</option>}
                                                    {TEMPLATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                                <div className="flex items-center gap-1.5 text-[10px] text-text-muted min-h-[16px]">
                                                    {r.detected === null
                                                        ? <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> detecting</span>
                                                        : <>
                                                            <span>detected: {r.detected}</span>
                                                            <ConfidenceChip c={r.detConfidence} />
                                                        </>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {error && <p className="text-red-400 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</p>}
                        </div>
                    )}

                    {stage === 'processing' && (
                        <div className="py-12 text-center space-y-4">
                            <Loader2 className="w-10 h-10 mx-auto text-accent-primary animate-spin" />
                            <div>
                                <p className="font-bold text-white">Reading screenshot {Math.min((progress?.fileIndex ?? 0) + 1, progress?.total || 1)} / {progress?.total || 1}</p>
                                <p className="text-[11px] text-text-muted capitalize">{progress?.status || 'recognising'}</p>
                            </div>
                            <div className="h-2 max-w-xs mx-auto rounded-full bg-bg-input overflow-hidden">
                                <div className="h-full bg-accent-primary transition-all" style={{ width: `${Math.round(((progress?.fileIndex ?? 0) + (progress?.ocrProgress ?? 0)) / Math.max(1, progress?.total || 1) * 100)}%` }} />
                            </div>
                            <p className="text-[10px] text-text-muted">First run downloads the OCR engine (~few MB), then it's cached.</p>
                        </div>
                    )}

                    {stage === 'diff' && (
                        <div className="space-y-4">
                            {rows.length === 0 ? (
                                <div className="py-10 text-center text-text-muted">
                                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />Nothing detected. Try clearer, full-screen captures of the item / pet / mount detail popups.
                                    <div className="mt-4"><button onClick={() => setStage('review')} className="px-4 py-2 rounded-xl bg-bg-input text-text-secondary hover:text-white text-sm font-bold">Back to review</button></div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-text-muted">{acceptedCount}/{rows.length} selected · check the picture matches before applying</span>
                                        <div className="flex gap-2">
                                            <button onClick={() => setAll(true)} className="px-2 py-1 rounded bg-bg-input text-text-secondary hover:text-text-primary hover:bg-white/10">All</button>
                                            <button onClick={() => setAll(false)} className="px-2 py-1 rounded bg-bg-input text-text-secondary hover:text-text-primary hover:bg-white/10">None</button>
                                        </div>
                                    </div>
                                    {Object.entries(grouped).map(([cat, list]) => (
                                        <section key={cat} className="rounded-xl border border-border/70 bg-bg-secondary/20 overflow-hidden">
                                            <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary/60 border-b border-border/60">
                                                <h4 className="text-[10px] font-black uppercase tracking-widest text-accent-primary/90">{CATEGORY_LABEL[cat as ChangeRow['category']]}</h4>
                                                <span className="px-1.5 py-0.5 rounded-full bg-bg-input text-[9px] font-bold text-text-muted">{list.length}</span>
                                            </div>
                                            <div className="p-2 space-y-2">
                                            {list.map(r => (r.category === 'currency' || r.category === 'skill' || r.category === 'clanTree') ? (
                                                <label key={r.id} className={cn('flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer flex-wrap', r.accepted ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border/50 bg-bg-secondary/30 opacity-70')}>
                                                    <input type="checkbox" checked={r.accepted} onChange={() => toggle(r.id)} className="w-4 h-4 accent-accent-primary" />
                                                    {r.category === 'currency'
                                                        ? <SpriteIcon name={CURRENCY_ICON[r.label] || 'Coin'} size={22} />
                                                        : r.category === 'clanTree'
                                                            ? <GitBranch className="w-5 h-5 text-accent-primary shrink-0" />
                                                            : <Sparkles className="w-5 h-5 text-accent-secondary shrink-0" />}
                                                    {/* NAME. Must never be squeezed out. On narrow viewports it claims the
                                                        rest of line 1 (checkbox + icon ≈ 4rem) and pushes the crop/level/star
                                                        controls onto line 2; from sm up it flexes but never below 6rem. */}
                                                    <span title={r.label} className="font-bold text-sm text-white whitespace-nowrap overflow-hidden text-clip basis-[calc(100%-4rem)] sm:basis-auto sm:flex-1 min-w-[6rem]">{r.label}</span>
                                                    <EvidenceCrop src={r.cropUrl} h={r.category === 'skill' ? 56 : r.category === 'clanTree' ? 56 : 34} maxW={r.category === 'skill' ? 76 : r.category === 'clanTree' ? 64 : 120} />
                                                    {r.patch.t === 'clanTree' && (
                                                        <span className="font-mono text-xs text-text-secondary shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                            {r.before} <span className="text-accent-primary">→</span> Lv
                                                            <input type="number" min={0} max={r.patch.max} value={r.patch.level}
                                                                onChange={e => changeClanLevel(r.id, parseInt(e.target.value))}
                                                                onFocus={e => e.target.select()}
                                                                className={cn('w-12 px-1 py-0.5 text-center', NUM_CLS, isEdited(r.id, 'level') && EDITED_RING)} />
                                                            <span className="text-text-muted">/ {r.patch.max}</span>
                                                        </span>
                                                    )}
                                                    {r.patch.t === 'skill' && <AscensionPicker row={r} compact />}
                                                    {(r.patch.t === 'forgeHammers' || (r.patch.t === 'currency' && r.patch.miscKey === 'forgeLevel')) ? (
                                                        <span className="font-mono text-xs text-text-secondary shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                            {r.before} <span className="text-accent-primary">→</span>
                                                            <input type="number" min={0} value={r.patch.value}
                                                                onChange={e => changeCurrencyValue(r.id, parseInt(e.target.value))}
                                                                onFocus={e => e.target.select()}
                                                                className={cn('w-20 px-1 py-0.5 text-right', NUM_CLS, isEdited(r.id, 'value') && EDITED_RING)} />
                                                        </span>
                                                    ) : r.patch.t === 'clanTree' ? null : (
                                                        <span className="font-mono text-xs text-text-secondary shrink-0">{r.before} <span className="text-accent-primary">→</span> <span className={cn('font-bold', isEdited(r.id, 'ascension') ? 'text-amber-200' : 'text-white')}>{r.after}</span></span>
                                                    )}
                                                </label>
                                            ) : (
                                                <div key={r.id} className={cn('rounded-xl border p-3', r.accepted ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border/50 bg-bg-secondary/30 opacity-80')}>
                                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                        <input type="checkbox" checked={r.accepted} onChange={() => toggle(r.id)} className="w-4 h-4 accent-accent-primary shrink-0" />
                                                        {/* text-white is load-bearing: without it this inherits the UA default
                                                            (black) through the portal and vanishes on the dark card. */}
                                                        <span title={r.label} className="font-bold text-sm text-white min-w-[6rem] break-words">{r.label}</span>
                                                        <ConfidenceChip c={r.confidence} />
                                                        <span className="text-[9px] uppercase font-bold text-text-muted">{r.action}</span>
                                                        {presetRowIds.has(r.id) && (
                                                            <span title="Will also be saved to your presets" className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border text-sky-300 bg-sky-500/10 border-sky-500/30 flex items-center gap-1">
                                                                <Bookmark className="w-3 h-3" /> preset
                                                            </span>
                                                        )}
                                                        {r.category === 'item' && (
                                                            <div className="ml-auto flex items-center gap-1">
                                                                <select value={r.detected?.age ?? 0} onChange={e => changeAge(r.id, parseInt(e.target.value))} title="Age"
                                                                    className={cn('px-1 py-1 text-[11px]', SELECT_CLS)}>
                                                                    {AGES.map((a, i) => <option key={i} value={i}>{a}</option>)}
                                                                </select>
                                                                <select value={r.slot} onChange={e => changeSlot(r.id, e.target.value)} title="Slot"
                                                                    className={cn('px-1 py-1 text-[11px]', SELECT_CLS)}>
                                                                    {ITEM_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                        {r.category === 'skinEquip' && (
                                                            <div className="ml-auto">
                                                                <select value={r.slot} onChange={e => changeSkinSlot(r.id, e.target.value)} title="Slot"
                                                                    className={cn('px-1 py-1 text-[11px]', SELECT_CLS)}>
                                                                    {SKIN_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                        {r.patch.t === 'pet' && (
                                                            <div className="ml-auto flex items-center gap-1.5">
                                                                {r.accepted && petSlotConflicts.has(r.patch.slotIndex) && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border text-amber-400 bg-amber-500/10 border-amber-500/30 flex items-center gap-1">
                                                                        <AlertTriangle className="w-3 h-3" /> slot clash
                                                                    </span>
                                                                )}
                                                                {/* WHICH slot this detected pet replaces is the user's choice: two pets of
                                                                    the same species with different stats are legal, so the option text
                                                                    names the pet each slot currently holds. */}
                                                                <select value={r.patch.slotIndex} onChange={e => changePetSlot(r.id, parseInt(e.target.value))}
                                                                    title="Which active pet slot this pet goes into" aria-label={`Active pet slot for ${r.label}`}
                                                                    data-testid={`pet-slot-${r.id}`}
                                                                    className={cn('px-1 py-1 text-[11px] max-w-[11rem] whitespace-nowrap overflow-hidden text-clip', SELECT_CLS, isEdited(r.id, 'petSlot') && EDITED_RING)}>
                                                                    {PET_SLOTS.map(i => <option key={i} value={i}>{petSlotLabel(i)}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* PHONE LAYOUT: three columns only from sm up. At 360px the side-by-side
                                                        grid pushed the whole "Will set" column past the panel edge, where
                                                        `overflow-hidden` cut it off. The level crop, the substat pickers and the
                                                        ascension control were unreachable on a phone. Stacked below sm, and every
                                                        cell is min-w-0 so long content wraps instead of overflowing its track. */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
                                                        <div className="text-center min-w-0">
                                                            <div className="text-[9px] uppercase tracking-widest text-text-muted mb-1">Found in screenshot</div>
                                                            {r.cropUrl ? <img src={r.cropUrl} alt="" className="max-h-28 max-w-full mx-auto rounded-lg border border-border object-contain" /> : <div className="text-text-muted text-xs">—</div>}
                                                        </div>
                                                        <ArrowRight className="w-5 h-5 text-accent-primary shrink-0 mx-auto rotate-90 sm:rotate-0" />
                                                        <div className="flex items-center gap-2 justify-center min-w-0">
                                                            <ProposedIcon row={r} />
                                                            {r.category === 'skinEquip' ? (
                                                                <div className="min-w-0 break-words">
                                                                    <div className="text-[9px] uppercase tracking-widest text-text-muted">Will set on {r.slot}</div>
                                                                    <div className="text-xs font-bold text-white">{r.after}</div>
                                                                    {r.before && <div className="text-[10px] text-text-muted">was: {r.before}</div>}
                                                                </div>
                                                            ) : (
                                                                <div className="min-w-0">
                                                                    <div className="text-[9px] uppercase tracking-widest text-text-muted">Will set</div>
                                                                    <div className="flex items-center gap-1 text-sm font-bold text-white flex-wrap">
                                                                        Lv.
                                                                        <input type="number" value={r.detected?.level ?? ''} min={1}
                                                                            onChange={e => changeLevel(r.id, parseInt(e.target.value) || 0)}
                                                                            onFocus={e => e.target.select()}
                                                                            className={cn('w-14 px-1 py-0.5 text-center', NUM_CLS, isEdited(r.id, 'level') && EDITED_RING)} />
                                                                        <EvidenceCrop src={r.detected?.levelCropUrl} h={26} maxW={110} title="Level read from this part of the screenshot" />
                                                                        {/* ITEM stars are the FORGE's ascension. A single misc value, not a
                                                                            field on the item. So this row has nothing to write them to and
                                                                            they stay read-only evidence (see task #39). */}
                                                                        {r.category === 'item' && r.detected?.stars
                                                                            ? <span className="text-amber-400" title="Forge ascension read from the item tile. Not applied by this row">{'★'.repeat(r.detected.stars)}</span>
                                                                            : null}
                                                                        {/* The picker shares this wrapping line with the level crop, so the
                                                                            screenshot pixels the stars came from sit right next to it (and the
                                                                            whole tile crop is in the left-hand cell of the same row) without
                                                                            showing the same crop twice. A reader that publishes its own star
                                                                            crop gets it rendered inside the picker instead. */}
                                                                        {(r.patch.t === 'pet' || r.patch.t === 'mount') && (
                                                                            <AscensionPicker row={r} cropSrc={starCrop(r)} />
                                                                        )}
                                                                    </div>
                                                                    {r.detected?.mainCropUrl && (
                                                                        <div className="flex items-center gap-1 mt-1">
                                                                            <span className="text-[9px] uppercase tracking-widest text-text-muted shrink-0">main</span>
                                                                            <EvidenceCrop src={r.detected.mainCropUrl} h={19} title="Main stat read from this part of the screenshot" />
                                                                        </div>
                                                                    )}
                                                                    <SubstatList row={r} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {r.category === 'skinEquip' && r.warnings.length > 0 && (
                                                        <p className="text-[10px] text-amber-400/80 flex items-center gap-1 mt-1"><AlertTriangle className="w-3 h-3" /> {r.warnings[r.warnings.length - 1]}</p>
                                                    )}
                                                    {r.confidence < 0.6 && <p className="text-[10px] text-amber-400/80 flex items-center gap-1 mt-1"><AlertTriangle className="w-3 h-3" /> Low confidence. Check the picture{r.category === 'item' ? ' and slot' : ''} before accepting.</p>}
                                                </div>
                                            ))}
                                            </div>
                                        </section>
                                    ))}
                                </>
                            )}
                        </div>
                    )}

                    {stage === 'done' && (
                        <div className="py-12 text-center space-y-3">
                            <CheckCircle2 className="w-12 h-12 mx-auto text-green-400" />
                            <p className="font-bold text-white text-lg">Profile updated</p>
                            <p className="text-[12px] text-text-muted">{acceptedCount} change{acceptedCount === 1 ? '' : 's'} applied.</p>
                            {presetsWritten > 0 && (
                                <p className="text-[12px] text-sky-300 flex items-center justify-center gap-1.5">
                                    <Bookmark className="w-3.5 h-3.5" /> {presetsWritten} preset{presetsWritten === 1 ? '' : 's'} saved. Find them in the “Saved” tab of the gear / pet / mount pickers.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {stage === 'review' && (
                    <div className="p-3 border-t border-border flex gap-2">
                        <button onClick={() => setStage('upload')} className="px-4 py-2.5 rounded-xl bg-bg-input text-text-secondary hover:text-white text-sm font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Back</button>
                        <button onClick={process} disabled={!processCount || pendingCount > 0}
                            className="flex-1 py-2.5 rounded-xl font-bold bg-accent-primary text-white disabled:opacity-40 hover:brightness-110 flex items-center justify-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            {pendingCount > 0 ? 'Detecting' : `Process ${processCount} screenshot${processCount === 1 ? '' : 's'}`}
                        </button>
                    </div>
                )}
                {stage === 'diff' && rows.length > 0 && (
                    <div className="p-3 border-t border-border space-y-2">
                        {/* Auto-bookmark: opt-out, and always says exactly what it will add. */}
                        <label className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
                            <input type="checkbox" checked={savePresets} onChange={e => setSavePresets(e.target.checked)}
                                className="w-3.5 h-3.5 mt-0.5 accent-accent-primary shrink-0" />
                            <span className="min-w-0">
                                <span className="font-bold text-white">Also save to presets</span>
                                {presetPlan.length > 0
                                    ? <>. Will also save to presets: <span className="text-sky-300">{presetPlan.map(p => `${p.name}${p.kind === 'item' ? ` (${p.slot})` : ''}`).join(', ')}</span></>
                                    : savePresets
                                        ? <>. Nothing new to bookmark (already saved, or no gear/pet/mount in this batch).</>
                                        : <>. Off: applied gear, pets & mounts will not be bookmarked.</>}
                            </span>
                        </label>
                        {hasPetConflict && (
                            <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                Two accepted pets target the same slot (only 3 active slots). Change a slot or untick one to apply.
                            </p>
                        )}
                        <div className="flex gap-2">
                            <button onClick={() => setStage('upload')} className="px-4 py-2.5 rounded-xl bg-bg-input text-text-secondary hover:text-white text-sm font-bold flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Add more</button>
                            <button onClick={apply} disabled={!acceptedCount || hasPetConflict} className="flex-1 py-2.5 rounded-xl font-bold bg-accent-primary text-white disabled:opacity-40 hover:brightness-110 flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Apply {acceptedCount} change{acceptedCount === 1 ? '' : 's'}</button>
                        </div>
                    </div>
                )}
                {stage === 'done' && (
                    <div className="p-3 border-t border-border">
                        <button onClick={onClose} className="w-full py-2.5 rounded-xl font-bold bg-accent-primary text-white hover:brightness-110">Done</button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
