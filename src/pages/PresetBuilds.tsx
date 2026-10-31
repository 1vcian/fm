import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Crown, Plus, ChevronDown, Table2 } from 'lucide-react';
import { useGameData } from '../hooks/useGameData';
import { useStatLibraries } from '../hooks/useGlobalStats';
import { useProfile } from '../context/ProfileContext';
import { useGameDataContext } from '../context/GameDataContext';
import { calculateStats, type AggregatedStats } from '../utils/statEngine';
import { formatCompactNumber } from '../utils/statsCalculator';
import { getStatName } from '../utils/statNames';
import { resolvedSkinStats, setDisplayName, skinRow } from '../utils/skinArchive';
import { getAscensionTexturePath, resolveTextureVersion } from '../utils/ascensionUtils';
import { FAIRIES } from '../utils/fairies';
import { currentAlloc } from '../optimizer/substatOptimizer';
import { SpriteSheetIcon } from '../components/UI/SpriteSheetIcon';
import { BuildPortrait } from '../components/Presets/BuildPortrait';
import { applyAnimation, type AnimationSwap } from '../presets/equivalents';
import { runFightAgainst, runMyVariants } from '../presets/myVariants';
import { CHALLENGER_KEY, type ChallengeResult } from '../presets/challenge';
import type { UserProfile } from '../types/Profile';
import type { PresetCategory, PresetCategoryInfo, ProfilePreset, ProfilePresetsFile } from '../presets/buildPresets';
import type { TournamentStanding } from '../presets/tournament';
import { cn } from '../lib/utils';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { getSkinSpriteStyle } from '../utils/skinSprites';
import { useSkinIcons } from '../utils/skinIcons';
import { getItemImage } from '../utils/itemAssets';
import { AGES } from '../utils/constants';

/**
 * Preset Builds: the strongest builds the game allows (parsed_configs/<version>/ProfilePresets.json,
 * scripts/build_presets.ts). The arena tournament between them on a podium, then one card per
 * category (Most Power, DPS and HPS melee and ranged, main quest) and per build lab find, with the
 * character as it looks in battle and its headline number; the category's runners-up and every
 * other number are one click away (Runners-up, Details, Compare all).
 */

const pct = (v: number) => `${(v * 100).toFixed(v * 100 >= 100 ? 0 : 1)}%`;
const camel = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
/** How far into the main quest: battles cleared, then how close to the next (win rate, losses by enemy HP removed). */
const questRank = (q: ProfilePreset['metrics']['quest']) => q.index + q.nextWinRate + (1 - q.nextWinRate) * (q.nextLossProgress ?? 0);

/** The number a build's category is about. */
function headline(p: ProfilePreset): { label: string; value: string; raw: number } {
    const m = p.metrics;
    switch (p.category) {
        case 'power': return { label: 'Power', value: formatCompactNumber(m.power), raw: m.power };
        case 'dpsMelee': case 'dpsRanged': return { label: 'DPS (24 h test)', value: formatCompactNumber(m.testedDps), raw: m.testedDps };
        case 'hpsMelee': case 'hpsRanged': return { label: 'HPS (24 h test)', value: formatCompactNumber(m.testedHps), raw: m.testedHps };
        case 'quest': return { label: 'Main quest', value: m.quest.label, raw: questRank(m.quest) };
        case 'lab': return { label: 'Arena vs the builds', value: pct(p.lab?.arenaWinRate ?? 0), raw: p.lab?.arenaWinRate ?? 0 };
    }
}

/**
 * The same four numbers on every build, always in this order; the one its category is about is
 * highlighted in place (a build lab find shows its arena rate in its header instead).
 */
function figures(p: ProfilePreset): { label: string; value: string; main: boolean }[] {
    const m = p.metrics;
    return [
        { label: 'Power', value: formatCompactNumber(m.power), main: p.category === 'power' },
        { label: 'DPS', value: formatCompactNumber(m.testedDps), main: p.category === 'dpsMelee' || p.category === 'dpsRanged' },
        { label: 'HPS', value: formatCompactNumber(m.testedHps), main: p.category === 'hpsMelee' || p.category === 'hpsRanged' },
        { label: 'Main quest', value: m.quest.label, main: p.category === 'quest' },
    ];
}

/** A swap's name: "Cat skin" or the weapon's own animation. */
const swapLabel = (w: AnimationSwap, age: number, mapping: any) => {
    if (w.source === 'skin') return `${setDisplayName(w.setId)} skin`;
    const name = mapping?.[`${age}_5_${w.weaponIdx}`]?.ItemName;
    return `${name ? camel(name) : `Weapon ${w.weaponIdx}`}, skin animation off`;
};

/** A swap's short name for its row: the set's or the weapon's. */
const swapName = (w: AnimationSwap, age: number, mapping: any) => {
    if (w.source === 'skin') return setDisplayName(w.setId);
    const name = mapping?.[`${age}_5_${w.weaponIdx}`]?.ItemName;
    return name ? camel(name) : `Weapon ${w.weaponIdx}`;
};

/** The weapon's name from AutoItemMapping ("age_type_idx", type 5 = Weapon). */
const weaponName = (p: ProfilePreset, mapping: any) => {
    const w = p.profile.items.Weapon;
    const name = w ? mapping?.[`${w.age}_5_${w.idx}`]?.ItemName : null;
    return name ? camel(name) : `Weapon ${p.animation.weaponIdx}`;
};

/** How the build attacks: its set's weapon skin, or its weapon's own animation under any hidden skin. */
function animationText(p: ProfilePreset, mapping: any): string {
    const a = p.animation;
    const windup = `${a.windup.toFixed(2)} s windup`;
    if (a.source === 'skin') return `${setDisplayName(a.setId)} skin animation, ${windup}`;
    return `${weaponName(p, mapping)} animation, any skin with the animation off, ${windup}`;
}

/** Melee or ranged, with the game's own icon for each. */
function KindTag({ ranged, className }: { ranged: boolean; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0', ranged ? 'bg-sky-500/25 text-sky-100' : 'bg-red-500/25 text-red-100', className)}>
            <GameAssetIcon asset={{ icon: ranged ? 'IconMedievalWeaponBow' : 'Battle' }} size={12} /> {ranged ? 'Ranged' : 'Melee'}
        </span>
    );
}

/** The weapon skin piece of a set (one per set in SkinsLibrary). */
const setWeaponIdx = (skinsLibrary: any, setId: string | null): number | null => {
    const row = Object.values<any>(skinsLibrary ?? {}).find(r => r.BaseSetId === setId && r.SkinId?.Type === 'Weapon');
    return row ? row.SkinId.Idx : null;
};

/** A skin piece's icon, as the game shows it. */
function SkinThumb({ type, idx, sprites, version, title }: { type: string; idx: number | null; sprites: any; version: string | null; title: string }) {
    useSkinIcons(version);
    return (
        <div title={title} className="w-9 h-9 shrink-0 rounded-lg bg-bg-input/70 border border-border/60 overflow-hidden">
            {idx !== null && <div className="w-full h-full" style={getSkinSpriteStyle({ SkinId: { Type: type, Idx: idx } } as any, sprites?.skins?.mapping, version ?? undefined)} />}
        </div>
    );
}

/** An item's icon (AutoItemMapping), with its name under it when asked. */
function ItemThumb({ age, slot, idx, mapping, version, title }: { age: number; slot: string; idx: number; mapping: any; version: string | null; title: string }) {
    const src = getItemImage(AGES[age], slot, idx, mapping, version ?? undefined);
    return (
        <div title={title} className="w-9 h-9 shrink-0 rounded-lg bg-bg-input/70 border border-border/60 flex items-center justify-center overflow-hidden">
            {src ? <img src={src} alt={title} className="w-8 h-8 object-contain" style={{ imageRendering: 'pixelated' }} /> : <span className="text-[8px] text-text-muted">{title}</span>}
        </div>
    );
}

/** What a swap is: a skin, a weapon, or another item. */
const SOURCE_TAG = {
    skin: { label: 'Skin', tone: 'bg-purple-500/25 text-purple-200' },
    weapon: { label: 'Weapon', tone: 'bg-amber-500/25 text-amber-200' },
    item: { label: 'Item', tone: 'bg-slate-500/25 text-slate-200' },
};
const SourceTag = ({ source }: { source: keyof typeof SOURCE_TAG }) => (
    <span className={cn('text-[9px] font-black uppercase px-1.5 py-0.5 rounded shrink-0', SOURCE_TAG[source].tone)}>{SOURCE_TAG[source].label}</span>
);

/** BaseSetId of the set the build wears (every build wears a complete, maxed one). */
const setOf = (p: ProfilePreset): string | null => p.animation.setId;

function Icons({ preset, sprites, version }: { preset: ProfilePreset; sprites: any; version: string | null }) {
    const p = preset.profile;
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${resolveTextureVersion(version ?? undefined) ?? version ?? ''}/`;
    const skillSprite = (id: string) => {
        const e = sprites?.skills?.mapping ? Object.entries<any>(sprites.skills.mapping).find(([, v]) => v.name === id) : null;
        return e ? { index: parseInt(e[0]), cfg: sprites.skills } : null;
    };
    const petSprite = (rarity: string, id: number) => {
        const e = sprites?.pets?.mapping ? Object.entries<any>(sprites.pets.mapping).find(([, v]) => v.id === id && v.rarity === rarity) : null;
        return e ? { index: parseInt(e[0]), cfg: sprites.pets } : null;
    };
    const fairy = FAIRIES.find(f => f.name === p.misc.fairy?.name);
    const icon = (key: string, s: { index: number; cfg: any } | null, sheet: string, title: string) => (
        <div key={key} title={title} className="w-8 h-8 rounded-lg bg-bg-input/70 border border-border/60 flex items-center justify-center overflow-hidden">
            {s ? (
                <SpriteSheetIcon textureSrc={sheet} spriteWidth={s.cfg.sprite_size.width} spriteHeight={s.cfg.sprite_size.height}
                    sheetWidth={s.cfg.texture_size.width} sheetHeight={s.cfg.texture_size.height} iconIndex={s.index} className="w-7 h-7" smooth />
            ) : <span className="text-[9px] text-text-muted text-center leading-tight px-0.5">{title}</span>}
        </div>
    );
    return (
        <div className="flex flex-wrap items-center gap-1">
            {p.skills.equipped.map(s => icon(`s-${s.id}`, skillSprite(s.id), getAscensionTexturePath('SkillIcons', p.misc.skillAscensionLevel ?? 0, version ?? undefined), camel(s.id)))}
            <span className="w-px h-5 bg-border mx-0.5" />
            {p.pets.active.map((pt, i) => icon(`p-${i}`, petSprite(pt.rarity, pt.id), getAscensionTexturePath('Pets', p.misc.petAscensionLevel ?? 0, version ?? undefined), `${pt.rarity} pet`))}
            {fairy && (
                <>
                    <span className="w-px h-5 bg-border mx-0.5" />
                    <div title={`${fairy.name} (level ${p.misc.fairy?.level})`} className="w-8 h-8 rounded-lg bg-bg-input/70 border border-border/60 flex items-center justify-center overflow-hidden">
                        <img src={`${textureBase}${fairy.texture}`} alt={fairy.name} className="w-7 h-7 object-contain" />
                    </div>
                </>
            )}
        </div>
    );
}

/** The whole build as plain text, for the Copy button (everything Details shows). */
function buildAsText(preset: ProfilePreset, stats: AggregatedStats, mapping: any, libs: any, sprites: any): string {
    const p = preset.profile, m = preset.metrics, a = preset.animation;
    const lines: string[] = [];
    lines.push(`${preset.name} (${stats.isRangedWeapon ? 'ranged' : 'melee'}), Forge Master Calculator preset build`);
    lines.push(`Power ${formatCompactNumber(m.power)}, damage ${formatCompactNumber(m.totalDamage)}, health ${formatCompactNumber(m.totalHealth)}`);
    lines.push(`DPS ${formatCompactNumber(m.testedDps)}, HPS ${formatCompactNumber(m.testedHps)} (24 h test)`);
    lines.push(`Main quest: clears ${m.quest.label}, next ${m.quest.nextLabel} ${pct(m.quest.nextWinRate)}`);
    if (preset.lab) lines.push(`Arena: wins ${pct(preset.lab.arenaWinRate)} against the category builds`);
    lines.push('');
    lines.push(a.source === 'skin'
        ? `Attack: ${setDisplayName(a.setId)} weapon skin, skin animation ON (${secs(a.windup)} windup)`
        : `Attack: ${weaponName(preset, mapping)}'s own attack, skin animation OFF (${secs(a.windup)} windup): any skin at its top works`);
    lines.push('');
    lines.push('Gear:');
    for (const slot of GEAR_SLOTS) {
        const it = p.items[slot];
        if (!it) continue;
        const sub = substatText((it as any).secondaryStats);
        let line = `- ${SLOT_LABEL[slot] ?? slot}: ${itemNameOf(mapping, it.age, slot, it.idx)}, level ${it.level}${sub ? `, ${sub}` : ''}`;
        if (it.skin) {
            const type = SKIN_TYPE_OF[slot];
            const setId = skinRow(libs?.skinsLibrary, it.skin.type ?? type, it.skin.idx)?.BaseSetId;
            const st = Object.entries(resolvedSkinStats(it.skin, libs?.skinUpgradeLibrary, type)).map(([k, v]) => `+${(v * 100).toFixed(1)}% ${getStatName(k)}`).join(', ');
            line += ` | skin ${setDisplayName(setId)}, level ${it.skin.level ?? 0}${st ? `, ${st}` : ''}`;
        }
        lines.push(line);
    }
    lines.push('Pets:');
    for (const pet of p.pets?.active ?? []) {
        const sub = substatText(pet.secondaryStats);
        lines.push(`- ${companionName(sprites, 'pet', pet.rarity, pet.id)} (${pet.rarity}), level ${pet.level}${sub ? `, ${sub}` : ''}`);
    }
    const mt = p.mount?.active;
    if (mt) {
        const sub = substatText(mt.secondaryStats);
        lines.push(`Mount: ${companionName(sprites, 'mount', mt.rarity, mt.id)} (${mt.rarity}), level ${mt.level}${sub ? `, ${sub}` : ''}`);
    }
    lines.push(`Skills: ${p.skills.equipped.map(sk => `${camel(sk.id)} ${sk.level}`).join(', ')}`);
    lines.push(`Fairy: ${p.misc.fairy?.name ? `${p.misc.fairy.name} level ${p.misc.fairy.level}` : 'none'}`);
    const alloc = Object.entries(currentAlloc(p)).sort((x, y) => y[1] - x[1]);
    lines.push(`Substat lines: ${alloc.map(([id, n]) => `${getStatName(id)} x${n}`).join(', ')}`);
    lines.push('');
    lines.push('https://1vcian.me/fm/#/presets');
    return lines.join('\n');
}

/** Every number of a build, for its details. */
function Details({ preset, stats, mapping }: { preset: ProfilePreset; stats: AggregatedStats; mapping: any }) {
    const m = preset.metrics;
    const alloc = Object.entries(currentAlloc(preset.profile)).sort((a, b) => b[1] - a[1]);
    return (
        <div className="text-[11px] text-text-secondary space-y-1">
            <div>Power {formatCompactNumber(m.power)}, damage {formatCompactNumber(m.totalDamage)}, health {formatCompactNumber(m.totalHealth)}</div>
            <div>DPS {formatCompactNumber(m.testedDps)}, HPS {formatCompactNumber(m.testedHps)} (24 h test), block {pct(stats.blockChance || 0)}</div>
            <div>
                Main quest: clears {m.quest.label} ({pct(m.quest.winRate)}), next {m.quest.nextLabel} {pct(m.quest.nextWinRate)}
                {m.quest.nextLossProgress !== undefined && m.quest.nextWinRate < 1 && `, its lost runs still remove ${pct(m.quest.nextLossProgress)} of the enemy HP`}
            </div>
            <div>Attack: {stats.isRangedWeapon ? 'ranged' : 'melee'}, {animationText(preset, mapping)}</div>
            <div>Skills: {preset.profile.skills.equipped.map(s => camel(s.id)).join(', ')}</div>
            <div>Fairy: {preset.profile.misc.fairy?.name ?? 'none'}</div>
            <div>Substats: {alloc.map(([id, n]) => `${getStatName(id)} x${n}`).join(', ')}</div>
        </div>
    );
}

/** The build the podium or the ranking asked to show (n makes a repeated click count again). */
const FocusedBuild = createContext<{ key: string; n: number } | null>(null);
/** Scrolls to a build's card, opening its row when it is one of the next best. */
const GoToBuild = createContext<(key: string) => void>(() => {});

/** Scrolls an element into view and lights its frame for a moment. */
function useFocusFlash(block: ScrollLogicalPosition): [React.RefObject<HTMLDivElement>, boolean, () => void] {
    const ref = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState(false);
    const go = () => {
        // After the row or the list has opened.
        setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block }), 60);
        setFlash(true);
        setTimeout(() => setFlash(false), 1600);
    };
    return [ref, flash, go];
}

/** An element's width, kept up to date. */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [w, setW] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setW(el.clientWidth));
        ro.observe(el);
        setW(el.clientWidth);
        return () => ro.disconnect();
    }, []);
    return [ref, w];
}

interface CardProps {
    preset: ProfilePreset;
    stats: AggregatedStats;
    sprites: any;
    mapping: any;
    version: string | null;
    /** The stat libraries (skins, skin levels, weapon attacks). */
    libs: any;
    onAdd: () => void;
    /** Adds the build with another animation (an equivalent build). */
    onAddEquivalent: (w: AnimationSwap) => void;
}

/** AutoItemMapping type ids ("age_type_idx"). */
const ITEM_TYPE_ID: Record<string, number> = { Helmet: 0, Body: 1, Gloves: 2, Necklace: 3, Ring: 4, Weapon: 5, Shoe: 6, Belt: 7 };
const SLOT_LABEL: Record<string, string> = { Body: 'Armour', Shoe: 'Shoes' };
const GEAR_SLOTS = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Necklace', 'Ring', 'Belt', 'Shoe'] as const;
const SKIN_TYPE_OF: Record<string, string> = { Weapon: 'Weapon', Helmet: 'Helmet', Body: 'Armour' };

const itemNameOf = (mapping: any, age: number, slot: string, idx: number) => {
    const n = mapping?.[`${age}_${ITEM_TYPE_ID[slot]}_${idx}`]?.ItemName;
    return n ? camel(n) : `${SLOT_LABEL[slot] ?? slot} #${idx}`;
};
/** A weapon's own WindupTime (WeaponLibrary), the attack it has with the skin animation off. */
const weaponWindup = (libs: any, age: number, idx: number): number | undefined =>
    libs?.weaponLibrary?.[`{'Age': ${age}, 'Type': 'Weapon', 'Idx': ${idx}}`]?.WindupTime;
const secs = (v: number | undefined) => (v === undefined ? '?' : `${v.toFixed(2)} s`);
const thumbSlot = (slot: string) => (slot === 'Shoe' ? 'Shoes' : slot);

/** Whether the build attacks with its weapon skin (skin animation on) or with its weapon's own attack. */
function AnimationNote({ preset, mapping, libs }: { preset: ProfilePreset; mapping: any; libs: any }) {
    const a = preset.animation;
    const w = preset.profile.items.Weapon;
    const own = w ? weaponWindup(libs, w.age, w.idx) : undefined;
    const on = a.source === 'skin';
    return (
        <div className={cn('rounded-xl px-3 py-2 text-[11px] border', on ? 'border-purple-400/40 bg-purple-500/10' : 'border-amber-400/40 bg-amber-500/10')}>
            <div className="font-black">{on ? 'Skin animation: ON' : 'Skin animation: OFF'}</div>
            <div className="text-text-secondary">
                {on
                    ? `Attacks with the ${setDisplayName(a.setId)} weapon skin's attack (${secs(a.windup)} windup), not with the ${weaponName(preset, mapping)}'s own (${secs(own)}).`
                    : `Attacks with the ${weaponName(preset, mapping)}'s own attack (${secs(a.windup)} windup). The skins add only their stats.`}
            </div>
        </div>
    );
}

/** The build's gear: every item, the skin on it with its level and stats, and the attack. */
/** A pet's or a mount's icon from its sprite sheet (at the profile's ascension). */
function CompanionThumb({ kind, rarity, id, sprites, version, ascension, title }: {
    kind: 'pet' | 'mount'; rarity: string; id: number; sprites: any; version: string | null; ascension: number; title: string;
}) {
    const sheet = kind === 'pet' ? sprites?.pets : sprites?.mounts;
    const e = sheet?.mapping ? Object.entries<any>(sheet.mapping).find(([, v]) => v.id === id && v.rarity === rarity) : null;
    return (
        <div title={title} className="w-9 h-9 shrink-0 rounded-lg bg-bg-input/70 border border-border/60 flex items-center justify-center overflow-hidden">
            {e ? (
                <SpriteSheetIcon textureSrc={getAscensionTexturePath(kind === 'pet' ? 'Pets' : 'MountIcons', ascension, version ?? undefined)}
                    spriteWidth={sheet.sprite_size.width} spriteHeight={sheet.sprite_size.height} sheetWidth={sheet.texture_size.width} sheetHeight={sheet.texture_size.height}
                    iconIndex={parseInt(e[0])} className="w-8 h-8" smooth />
            ) : <span className="text-[8px] text-text-muted">{title}</span>}
        </div>
    );
}
const companionName = (sprites: any, kind: 'pet' | 'mount', rarity: string, id: number) => {
    const sheet = kind === 'pet' ? sprites?.pets : sprites?.mounts;
    const v = sheet?.mapping ? Object.values<any>(sheet.mapping).find(x => x.id === id && x.rarity === rarity) : null;
    return v?.name ? camel(v.name) : `${rarity} ${kind} ${id + 1}`;
};
/** Substats as the game lists them: "+80% Crit Damage". */
const substatText = (stats: { statId: string; value: number }[] | undefined) =>
    (stats ?? []).map(s => `+${+s.value.toFixed(2)}% ${getStatName(s.statId)}`).join(', ');

/**
 * Pets and mounts that change no number of the build (config): a pet's stats come from its
 * rarity and type (PetLibrary.Type), a mount's from its rarity, and in battle its body too
 * (MountLibrary ColliderRadius, CenterOfMass, UnitOffset).
 */
function companionEquivalents(p: UserProfile, libs: any) {
    const pets = (p.pets?.active ?? []).map((pet, slot) => {
        const row = Object.values<any>(libs?.petLibrary ?? {}).find(r => r.PetId?.Rarity === pet.rarity && r.PetId?.Id === pet.id);
        const alts = row ? Object.values<any>(libs.petLibrary).filter(r => r.PetId.Rarity === pet.rarity && r.Type === row.Type && r.PetId.Id !== pet.id).map(r => r.PetId.Id as number) : [];
        return { slot, rarity: pet.rarity, id: pet.id, type: row?.Type as string | undefined, alts };
    }).filter(x => x.alts.length);
    const m = p.mount?.active;
    const body = (r: any) => JSON.stringify([r.ColliderRadius, r.CenterOfMass, r.UnitOffset]);
    const mrow = m ? Object.values<any>(libs?.mountLibrary ?? {}).find(r => r.MountId?.Rarity === m.rarity && r.MountId?.Id === m.id) : null;
    const mountAlts = m && mrow ? Object.values<any>(libs.mountLibrary).filter(r => r.MountId.Rarity === m.rarity && r.MountId.Id !== m.id && body(r) === body(mrow)).map(r => r.MountId.Id as number) : [];
    return { pets, mount: m && mountAlts.length ? { rarity: m.rarity, id: m.id, alts: mountAlts } : null };
}

function Gear({ preset, mapping, sprites, version, libs }: { preset: ProfilePreset; mapping: any; sprites: any; version: string | null; libs: any }) {
    const p = preset.profile;
    // With the weapon's own attack the weapon skin is hidden: only its stats count, and every set's
    // pieces carry the same stats, so any skin at its top does the same. A complete set's bonus
    // still needs all three pieces of one set: then any complete set does.
    const animOff = preset.animation.source === 'weapon';
    const setOf3 = (['Weapon', 'Helmet', 'Body'] as const).map(sl => {
        const sk = p.items[sl]?.skin;
        return sk ? skinRow(libs?.skinsLibrary, sk.type ?? SKIN_TYPE_OF[sl], sk.idx)?.BaseSetId ?? null : null;
    });
    const fullSet = !!setOf3[0] && setOf3.every(x => x === setOf3[0]);
    const anyNote = (slot: string) => {
        if (!animOff) return null;
        if (fullSet && (slot === 'Weapon' || slot === 'Helmet' || slot === 'Body')) return 'Any complete set at its top (all three pieces of one set): the weapon skin is hidden, only the stats and the set bonus count.';
        if (slot === 'Weapon') return 'Any weapon skin at its top with the same stat: it is hidden, only its stats count.';
        return null;
    };
    return (
        <div className="space-y-1.5">
            <AnimationNote preset={preset} mapping={mapping} libs={libs} />
            <div className="grid grid-cols-1 gap-1">
                {GEAR_SLOTS.map(slot => {
                    const it = p.items[slot];
                    if (!it) return null;
                    const skin = it.skin;
                    const type = SKIN_TYPE_OF[slot];
                    const setId = skin ? skinRow(libs?.skinsLibrary, skin.type ?? type, skin.idx)?.BaseSetId : null;
                    const skinStats = skin ? Object.entries(resolvedSkinStats(skin, libs?.skinUpgradeLibrary, type)) : [];
                    return (
                        <div key={slot} className="flex items-center gap-2 rounded-lg bg-bg-input/40 p-1 pr-2 text-[11px]">
                            <ItemThumb age={it.age} slot={thumbSlot(slot)} idx={it.idx} mapping={mapping} version={version} title={itemNameOf(mapping, it.age, slot, it.idx)} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <SourceTag source={slot === 'Weapon' ? 'weapon' : 'item'} />
                                    <span className="font-semibold">{itemNameOf(mapping, it.age, slot, it.idx)}</span>
                                    {slot === 'Weapon' && <span className="text-text-muted">own attack {secs(weaponWindup(libs, it.age, it.idx))}</span>}
                                </div>
                                {(it as any).secondaryStats?.length > 0 && <div className="text-[10px] text-text-muted">{substatText((it as any).secondaryStats)}</div>}
                                {skin && (
                                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                        <SourceTag source="skin" />
                                        <span>{setDisplayName(setId)} {SLOT_LABEL[slot] ?? slot}, level {skin.level ?? 0}</span>
                                        <span className="text-text-muted">{skinStats.map(([k, v]) => `+${(v * 100).toFixed(1)}% ${getStatName(k)}`).join(', ')}</span>
                                    </div>
                                )}
                                {skin && anyNote(slot) && <div className="text-[10px] font-semibold text-lime-200/90 mt-0.5">{anyNote(slot)}</div>}
                            </div>
                            {skin && <SkinThumb type={type} idx={skin.idx} sprites={sprites} version={version} title={`${setDisplayName(setId)} skin`} />}
                        </div>
                    );
                })}
                {(p.pets?.active ?? []).map((pet, i) => (
                    <div key={`pet-${i}`} className="flex items-center gap-2 rounded-lg bg-bg-input/40 p-1 pr-2 text-[11px]">
                        <CompanionThumb kind="pet" rarity={pet.rarity} id={pet.id} sprites={sprites} version={version} ascension={p.misc.petAscensionLevel ?? 0} title={companionName(sprites, 'pet', pet.rarity, pet.id)} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">Pet</span>
                                <span className="font-semibold">{companionName(sprites, 'pet', pet.rarity, pet.id)}</span>
                                <span className="text-text-muted">{pet.rarity}, level {pet.level}</span>
                            </div>
                            {pet.secondaryStats?.length ? <div className="text-[10px] text-text-muted">{substatText(pet.secondaryStats)}</div> : null}
                        </div>
                    </div>
                ))}
                {p.mount?.active && (
                    <div className="flex items-center gap-2 rounded-lg bg-bg-input/40 p-1 pr-2 text-[11px]">
                        <CompanionThumb kind="mount" rarity={p.mount.active.rarity} id={p.mount.active.id} sprites={sprites} version={version} ascension={p.misc.mountAscensionLevel ?? 0} title={companionName(sprites, 'mount', p.mount.active.rarity, p.mount.active.id)} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200">Mount</span>
                                <span className="font-semibold">{companionName(sprites, 'mount', p.mount.active.rarity, p.mount.active.id)}</span>
                                <span className="text-text-muted">{p.mount.active.rarity}, level {p.mount.active.level}</span>
                            </div>
                            {p.mount.active.secondaryStats?.length ? <div className="text-[10px] text-text-muted">{substatText(p.mount.active.secondaryStats)}</div> : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Swaps the Equivalents list shows. */
const equivalentCount = (p: ProfilePreset, libs?: any) => {
    const c = libs ? companionEquivalents(p.profile, libs) : { pets: [], mount: null };
    const eq = p.equivalents;
    const own = eq ? eq.animations.length + Object.values(eq.items).filter(x => x.length).length + (eq.sets.length ? 1 : 0) : 0;
    return own + c.pets.length + (c.mount ? 1 : 0);
};

/**
 * What can be swapped without changing a single number of the build (from the configs): the same
 * attack from another skin or weapon, items with the same stats, sets with the same bonus. Each
 * swap says what it replaces and why it changes nothing.
 */
function Equivalents({ preset, mapping, sprites, version, libs, ranged, onAddEquivalent }: {
    preset: ProfilePreset; mapping: any; sprites: any; version: string | null; libs: any; ranged: boolean; onAddEquivalent: (w: AnimationSwap) => void;
}) {
    const eq = preset.equivalents ?? { animations: [], items: {}, sets: [] };
    const comp = companionEquivalents(preset.profile, libs);
    // The set the build wears (with the weapon's own attack the animation names no set).
    const wornHelmet = preset.profile.items.Helmet?.skin;
    const wornSet = preset.animation.setId ?? (wornHelmet ? skinRow(libs?.skinsLibrary, wornHelmet.type ?? 'Helmet', wornHelmet.idx)?.BaseSetId ?? null : null);
    if (!equivalentCount(preset, libs)) return <p className="text-[11px] text-text-muted">No exact equivalent: every other choice changes a number of this build.</p>;
    const a = preset.animation;
    const on = a.source === 'skin';
    const kind = ranged ? 'ranged' : 'melee';
    const weapon = preset.profile.items.Weapon;
    const age = weapon?.age ?? 0;
    const items = Object.entries(eq.items).filter(([, idxs]) => idxs.length);
    const current = on ? `the ${setDisplayName(a.setId)} skin animation` : `the ${weaponName(preset, mapping)}'s own attack`;
    return (
        <div className="space-y-3 text-[11px]">
            <p className="text-text-muted">Swaps that change no number of this build, read from the game files: use them if you lack a piece.</p>
            {eq.animations.length > 0 && (
                <div className="space-y-1">
                    <div className="font-bold text-text-secondary">Same attack as {current} ({secs(a.windup)} windup, same range, projectile and timing)</div>
                    {eq.animations.map(w => (
                        <div key={`${w.source}-${w.setId}-${w.weaponIdx}`} className="flex items-center gap-2 rounded-lg bg-bg-input/40 px-2 py-1.5">
                            {w.source === 'skin'
                                ? <SkinThumb type="Weapon" idx={setWeaponIdx(libs?.skinsLibrary, w.setId)} sprites={sprites} version={version} title={`${setDisplayName(w.setId)} weapon skin`} />
                                : <ItemThumb age={age} slot="Weapon" idx={w.weaponIdx} mapping={mapping} version={version} title={swapName(w, age, mapping)} />}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <SourceTag source={w.source} />
                                    <span className="font-semibold">{swapName(w, age, mapping)}</span>
                                    <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded', w.source === 'skin' ? 'bg-purple-500/25 text-purple-200' : 'bg-amber-500/25 text-amber-200')}>
                                        skin animation {w.source === 'skin' ? 'ON' : 'OFF'}
                                    </span>
                                </div>
                                <div className="text-[10px] text-text-muted">
                                    {w.source === 'skin'
                                        ? `Wear the ${setDisplayName(w.setId)} weapon skin with the skin animation ON instead of ${current}: its ${kind} attack row is the same.`
                                        : `Use the ${swapName(w, age, mapping)} with the skin animation OFF instead of ${current}: its own attack row is the same.`}
                                </div>
                            </div>
                            <button onClick={() => onAddEquivalent(w)} title="Add this build to my profiles" className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-accent-primary/80 text-white hover:brightness-110 shrink-0">
                                <Plus className="w-3 h-3" /> Add
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {items.length > 0 && (
                <div className="space-y-1.5">
                    <div className="font-bold text-text-secondary">Items with the same stats</div>
                    {items.map(([slot, idxs]) => {
                        const it = preset.profile.items[slot as keyof typeof preset.profile.items];
                        if (!it) return null;
                        const mine = itemNameOf(mapping, it.age, slot, it.idx);
                        const why = slot !== 'Weapon'
                            ? 'Same stats in the game files; only the look changes.'
                            : on
                                ? `Same stats, and equivalent only with the skin animation ON: the attack is the ${setDisplayName(a.setId)} skin's, whatever ${kind} weapon is under it. With the animation off each weapon attacks with its own windup (shown).`
                                : 'Same stats and the same own attack, with the skin animation OFF.';
                        return (
                            <div key={slot} className="rounded-lg bg-bg-input/30 p-1.5 space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-text-muted">Instead of</span>
                                    <ItemThumb age={it.age} slot={thumbSlot(slot)} idx={it.idx} mapping={mapping} version={version} title={mine} />
                                    <span className="font-semibold">{mine}</span>
                                    {slot === 'Weapon' && <span className="text-text-muted">({secs(weaponWindup(libs, it.age, it.idx))})</span>}
                                    <span className="text-text-muted">use</span>
                                    {idxs.map(i => (
                                        <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-bg-input/50 pr-2">
                                            <ItemThumb age={it.age} slot={thumbSlot(slot)} idx={i} mapping={mapping} version={version} title={itemNameOf(mapping, it.age, slot, i)} />
                                            <SourceTag source={slot === 'Weapon' ? 'weapon' : 'item'} />
                                            <span className="font-semibold">{itemNameOf(mapping, it.age, slot, i)}</span>
                                            {slot === 'Weapon' && <span className="text-text-muted">({secs(weaponWindup(libs, it.age, i))})</span>}
                                        </span>
                                    ))}
                                </div>
                                <div className="text-[10px] text-text-muted">{why}</div>
                            </div>
                        );
                    })}
                </div>
            )}
            {eq.sets.length > 0 && (
                <div className="space-y-1">
                    <div className="font-bold text-text-secondary">Instead of the {setDisplayName(wornSet)} set (all three pieces)</div>
                    <div className="flex flex-wrap gap-1.5">
                        {eq.sets.map(id => (
                            <div key={id} className="flex items-center gap-1.5 rounded-lg bg-bg-input/40 pr-2">
                                <SkinThumb type="Weapon" idx={setWeaponIdx(libs?.skinsLibrary, id)} sprites={sprites} version={version} title={`${setDisplayName(id)} set`} />
                                <SourceTag source="skin" />
                                <span>{setDisplayName(id)} set</span>
                            </div>
                        ))}
                    </div>
                    <div className="text-[10px] text-text-muted">
                        {on
                            ? 'Same piece stats and set bonus, and its weapon skin has the same attack: keep the skin animation ON.'
                            : 'Same piece stats and set bonus. The skin animation stays OFF, so the skin attack does not matter.'}
                    </div>
                </div>
            )}
            {(comp.pets.length > 0 || comp.mount) && (
                <div className="space-y-1.5">
                    <div className="font-bold text-text-secondary">Pets and mount with the same stats</div>
                    {comp.pets.map(c => (
                        <div key={`pet-${c.slot}`} className="rounded-lg bg-bg-input/30 p-1.5 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-text-muted">Instead of</span>
                                <CompanionThumb kind="pet" rarity={c.rarity} id={c.id} sprites={sprites} version={version} ascension={preset.profile.misc.petAscensionLevel ?? 0} title={companionName(sprites, 'pet', c.rarity, c.id)} />
                                <span className="font-semibold">{companionName(sprites, 'pet', c.rarity, c.id)}</span>
                                <span className="text-text-muted">use</span>
                                {c.alts.map(id => (
                                    <span key={id} className="inline-flex items-center gap-1.5 rounded-lg bg-bg-input/50 pr-2">
                                        <CompanionThumb kind="pet" rarity={c.rarity} id={id} sprites={sprites} version={version} ascension={preset.profile.misc.petAscensionLevel ?? 0} title={companionName(sprites, 'pet', c.rarity, id)} />
                                        <span className="font-semibold">{companionName(sprites, 'pet', c.rarity, id)}</span>
                                    </span>
                                ))}
                            </div>
                            <div className="text-[10px] text-text-muted">Same rarity ({c.rarity}) and type ({c.type}): the same stats. Keep its substats.</div>
                        </div>
                    ))}
                    {comp.mount && (
                        <div className="rounded-lg bg-bg-input/30 p-1.5 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-text-muted">Instead of</span>
                                <CompanionThumb kind="mount" rarity={comp.mount.rarity} id={comp.mount.id} sprites={sprites} version={version} ascension={preset.profile.misc.mountAscensionLevel ?? 0} title={companionName(sprites, 'mount', comp.mount.rarity, comp.mount.id)} />
                                <span className="font-semibold">{companionName(sprites, 'mount', comp.mount.rarity, comp.mount.id)}</span>
                                <span className="text-text-muted">use</span>
                                {comp.mount.alts.map(id => (
                                    <span key={id} className="inline-flex items-center gap-1.5 rounded-lg bg-bg-input/50 pr-2">
                                        <CompanionThumb kind="mount" rarity={comp.mount!.rarity} id={id} sprites={sprites} version={version} ascension={preset.profile.misc.mountAscensionLevel ?? 0} title={companionName(sprites, 'mount', comp.mount!.rarity, id)} />
                                        <span className="font-semibold">{companionName(sprites, 'mount', comp.mount!.rarity, id)}</span>
                                    </span>
                                ))}
                            </div>
                            <div className="text-[10px] text-text-muted">Same rarity ({comp.mount.rarity}) and the same body in battle (collider and center of mass): the same stats and reach. Keep its substats.</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const AddButton = ({ onAdd }: { onAdd: () => void }) => (
    <button onClick={onAdd} className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-accent-primary text-white hover:brightness-110">
        <Plus className="w-3.5 h-3.5" /> Add to my profiles
    </button>
);

/** Card frames of the tournament's top three. */
const MEDALS = [
    { label: 'Gold', frame: 'border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.25)]', glow: 'from-amber-400/25', badge: 'bg-gradient-to-b from-amber-200 to-amber-500 text-black' },
    { label: 'Silver', frame: 'border-slate-300 shadow-[0_0_20px_rgba(203,213,225,0.18)]', glow: 'from-slate-300/20', badge: 'bg-gradient-to-b from-white to-slate-400 text-black' },
    { label: 'Bronze', frame: 'border-orange-500 shadow-[0_0_20px_rgba(234,88,12,0.2)]', glow: 'from-orange-500/20', badge: 'bg-gradient-to-b from-orange-300 to-orange-700 text-black' },
];

const FlipButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl border border-border text-text-secondary hover:bg-bg-input">
        {children} <GameAssetIcon asset={{ icon: 'RefreshArrows' }} size={14} />
    </button>
);

/** Every card has this height, front and back; what does not fit scrolls inside. */
const CARD_HEIGHT = 'h-[660px]';

/**
 * The best build of a category (or a build lab find): the character, its number, how it attacks.
 * Details and Equivalents are two tabs of the card's back: the card turns over instead of growing.
 */
function BuildCard({ preset, stats, sprites, mapping, version, libs, onAdd, onAddEquivalent, rank, runnersUp, cardFor, categoryName }: CardProps & {
    rank: number | null; runnersUp: ProfilePreset[]; cardFor: (p: ProfilePreset) => CardProps; categoryName: string;
}) {
    const [back, setBack] = useState<'details' | 'equivalents' | null>(null);
    // The back keeps its content while it turns away.
    const [shownBack, setShownBack] = useState<'details' | 'equivalents'>('details');
    const [others, setOthers] = useState(false);
    const focus = useContext(FocusedBuild);
    const [cardRef, flash, flashCard] = useFocusFlash('center');
    useEffect(() => {
        if (!focus) return;
        if (focus.key === preset.key) { setBack(null); flashCard(); }
        else if (runnersUp.some(p => p.key === focus.key)) { setBack(null); setOthers(true); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus]);
    const medal = rank !== null ? MEDALS[rank - 1] : undefined;
    const isLab = preset.category === 'lab';
    const frame = medal ? medal.frame : isLab ? 'border-purple-500/30' : 'border-border';
    const glow = medal ? medal.glow : isLab ? 'from-purple-500/15' : 'from-accent-primary/10';
    const flip = (to: 'details' | 'equivalents') => { setShownBack(to); setBack(to); };
    const ranged = !!stats.isRangedWeapon;
    const eqCount = equivalentCount(preset, libs);
    return (
        <div ref={cardRef} className={cn('[perspective:1600px] rounded-2xl transition-shadow duration-500 scroll-mt-24', CARD_HEIGHT, flash && 'ring-4 ring-amber-300 shadow-[0_0_40px_rgba(251,191,36,0.5)]')}>
            <div className={cn('grid h-full transition-transform duration-700 ease-in-out [transform-style:preserve-3d]', back && '[transform:rotateY(180deg)]')}>
                <div aria-hidden={!!back} className={cn('col-start-1 row-start-1 min-h-0 [backface-visibility:hidden] rounded-2xl border-2 bg-bg-secondary/40 overflow-hidden flex flex-col', frame, back && 'pointer-events-none')}>
                    <div className={cn('relative flex justify-center pt-2 bg-gradient-to-b to-transparent shrink-0', glow)}>
                        {rank !== null && (
                            <span className={cn('absolute top-2 left-2 text-[11px] font-black px-2 py-0.5 rounded-full', medal ? medal.badge : 'bg-black/40 text-text-secondary')}>
                                {medal ? `${medal.label} #${rank}` : `#${rank}`}
                            </span>
                        )}
                        <span className={cn('absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full', isLab ? 'bg-purple-500/25 text-purple-200' : 'bg-black/40 text-text-secondary')}>{categoryName}</span>
                        <BuildPortrait profile={preset.profile} setId={setOf(preset)} width={260} height={200} scale={58} />
                        <KindTag ranged={ranged} className="absolute bottom-2 left-2 text-[11px] px-2.5 py-1" />
                    </div>
                    <div className="p-4 pt-2 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                        <div>
                            <div className="font-black text-lg leading-tight">{preset.name}</div>
                            <div className="text-xs text-text-muted">{preset.goal}</div>
                            <div className="text-[11px] text-text-muted">{animationText(preset, mapping)}</div>
                        </div>
                        {isLab && preset.lab && (
                            <div className="text-xs font-bold text-purple-200">Wins {pct(preset.lab.arenaWinRate)} of its arena battles against the category builds</div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            {figures(preset).map(f => (
                                <div key={f.label} className={cn('rounded-xl px-3 py-2 border', f.main ? 'bg-amber-400/10 border-amber-400/50' : 'bg-bg-input/40 border-transparent')}>
                                    <div className={cn('text-[10px] uppercase font-bold', f.main ? 'text-amber-300' : 'text-text-muted')}>{f.label}</div>
                                    <div className={cn('font-black font-mono leading-tight break-words text-sm', f.main ? 'text-text-primary' : 'text-text-secondary')}>{f.value}</div>
                                </div>
                            ))}
                        </div>
                        <Icons preset={preset} sprites={sprites} version={version} />
                        <div className="flex flex-wrap gap-2 mt-auto">
                            <AddButton onAdd={onAdd} />
                            <FlipButton onClick={() => flip('details')}>Details</FlipButton>
                            {eqCount > 0 && <FlipButton onClick={() => flip('equivalents')}>Equivalents ({eqCount})</FlipButton>}
                        </div>
                        {runnersUp.length > 0 && (
                            <div className="border-t border-border pt-2">
                                <button onClick={() => setOthers(o => !o)} className="w-full flex items-center justify-between text-xs font-bold text-text-secondary hover:text-text-primary">
                                    Next {runnersUp.length} best (#2 to #{runnersUp.length + 1}) <ChevronDown className={cn('w-4 h-4 transition-transform', others && 'rotate-180')} />
                                </button>
                                {others && <div className="mt-2 space-y-1.5">{runnersUp.map(p => <CompactRow key={p.key} {...cardFor(p)} best={preset} />)}</div>}
                            </div>
                        )}
                    </div>
                </div>
                <div aria-hidden={!back} className={cn('col-start-1 row-start-1 min-h-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl border-2 bg-bg-secondary overflow-hidden flex flex-col', frame, !back && 'pointer-events-none')}>
                    <div className={cn('p-4 pb-0 flex flex-col gap-3 shrink-0 bg-gradient-to-b to-transparent', glow)}>
                        <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0 font-black text-lg leading-tight">{preset.name}</div>
                            <KindTag ranged={ranged} className="text-[11px] px-2.5 py-1" />
                        </div>
                        <div className="flex border-b border-border">
                            {([['details', 'Details'], ['equivalents', `Equivalents (${eqCount})`]] as const).map(([key, label]) => (
                                <button key={key} onClick={() => setShownBack(key)}
                                    className={cn('flex-1 text-xs font-bold px-3 py-2 border-b-2 -mb-px transition-colors', shownBack === key ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                        {shownBack === 'details' ? (
                            <>
                                <p className="text-[11px] text-text-muted">{preset.description}</p>
                                <Gear preset={preset} mapping={mapping} sprites={sprites} version={version} libs={libs} />
                                <Details preset={preset} stats={stats} mapping={mapping} />
                            </>
                        ) : (
                            <Equivalents preset={preset} mapping={mapping} sprites={sprites} version={version} libs={libs} ranged={ranged} onAddEquivalent={onAddEquivalent} />
                        )}
                    </div>
                    <div className="flex gap-2 p-4 pt-3 border-t border-border shrink-0">
                        <AddButton onAdd={onAdd} />
                        <button onClick={() => {
                            navigator.clipboard.writeText(buildAsText(preset, stats, mapping, libs, sprites))
                                .then(() => toast.success('Build copied as text'), () => toast.error('Could not copy: the browser blocked the clipboard'));
                        }} title="Copy the whole build as text" className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl border border-border text-text-secondary hover:bg-bg-input">
                            <GameAssetIcon asset={{ icon: 'Pen' }} size={14} /> Copy
                        </button>
                        <FlipButton onClick={() => setBack(null)}>Back</FlipButton>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Ranks 2 to 5: one line with the number and the gap to the best, the rest on opening. */
function CompactRow({ preset, stats, sprites, mapping, version, libs, onAdd, onAddEquivalent, best }: CardProps & { best: ProfilePreset }) {
    const [open, setOpen] = useState(false);
    const [eqOpen, setEqOpen] = useState(false);
    const focus = useContext(FocusedBuild);
    const [rowRef, flash, flashRow] = useFocusFlash('start');
    useEffect(() => {
        if (focus?.key === preset.key) { setOpen(true); flashRow(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus]);
    const h = headline(preset);
    const b = headline(best);
    const gap = preset.category !== 'quest' && b.raw > 0 ? (h.raw / b.raw - 1) * 100 : null;
    const ranged = !!stats.isRangedWeapon;
    const eqCount = equivalentCount(preset, libs);
    return (
        <div ref={rowRef} className={cn('rounded-xl border border-border bg-bg-secondary/30 overflow-hidden transition-shadow duration-500', flash && 'ring-2 ring-amber-300')}>
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-input/40">
                <span className="text-xs font-black text-text-muted w-6">#{preset.rank}</span>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold font-mono">{h.label} {h.value}{gap !== null && <span className="text-text-muted font-normal"> ({gap >= 0 ? '+' : ''}{gap.toFixed(2)}%)</span>}</div>
                    <div className="text-[10px] text-text-muted">{figures(preset).filter(f => !f.main).map(f => `${f.label} ${f.value}`).join(', ')}</div>
                    <div className="text-[10px] text-text-muted flex items-center gap-1.5 flex-wrap">
                        <KindTag ranged={ranged} />
                        <span>{preset.animation.source === 'skin' ? `${setDisplayName(preset.animation.setId)} skin` : weaponName(preset, mapping)}, {preset.animation.windup.toFixed(2)} s</span>
                    </div>
                </div>
                <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform shrink-0', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                    <div className="flex justify-center"><BuildPortrait profile={preset.profile} setId={setOf(preset)} width={200} height={150} scale={44} /></div>
                    <Icons preset={preset} sprites={sprites} version={version} />
                    <Gear preset={preset} mapping={mapping} sprites={sprites} version={version} libs={libs} />
                    <Details preset={preset} stats={stats} mapping={mapping} />
                    <div className="flex"><AddButton onAdd={onAdd} /></div>
                    {eqCount > 0 && (
                        <div className="border-t border-border pt-2">
                            <button onClick={() => setEqOpen(o => !o)} className="w-full flex items-center justify-between text-xs font-bold text-text-secondary hover:text-text-primary">
                                Equivalent builds ({eqCount}) <ChevronDown className={cn('w-4 h-4 transition-transform', eqOpen && 'rotate-180')} />
                            </button>
                            {eqOpen && <div className="mt-2"><Equivalents preset={preset} mapping={mapping} sprites={sprites} version={version} libs={libs} ranged={ranged} onAddEquivalent={onAddEquivalent} /></div>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const STEPS = [
    { place: 2, block: 'h-20', tone: 'from-slate-300/40 to-slate-500/10 border-slate-300/60 text-slate-100', size: 170 },
    { place: 1, block: 'h-28', tone: 'from-amber-300/50 to-amber-600/10 border-amber-300/70 text-amber-200', size: 210 },
    { place: 3, block: 'h-14', tone: 'from-orange-400/40 to-orange-800/10 border-orange-400/60 text-orange-200', size: 160 },
];

/** Noise on one build's win rate: one standard error over all its battles (p = 0.5 is the widest). */
const noiseOf = (standings: TournamentStanding[]) => (standings.length ? 0.5 / Math.sqrt(standings[0].battles) : 0);

/**
 * Places with ties: a build within the noise of the first build of its group shares that group's
 * place, and the next group takes the next place (1st, 2nd, 3rd...), so builds the tournament
 * cannot tell apart stand together.
 */
function sharedRanks(standings: TournamentStanding[]): { rank: number; tied: boolean }[] {
    const noise = noiseOf(standings);
    const ranks: number[] = [];
    let lead = 0, rank = 0;
    standings.forEach((s, i) => {
        if (i === 0 || standings[lead].winRate - s.winRate > noise) { lead = i; rank++; }
        ranks.push(rank);
    });
    return ranks.map(r => ({ rank: r, tied: ranks.filter(x => x === r).length > 1 }));
}
const placeText = (r: { rank: number; tied: boolean }) => `${r.tied ? '=' : ''}${r.rank}`;

/** The builds that are this one in battle (same fighter), by name. */
const sameNames = (st: TournamentStanding, byKey: Map<string, ProfilePreset>) => (st.same ?? []).map(k => byKey.get(k)?.name ?? k);

/** The full ranking: place (=N for a tie), build, wins-draws-losses, win rate. */
function RankingList({ standings, byKey, highlight, className }: { standings: TournamentStanding[]; byKey: Map<string, ProfilePreset>; highlight?: string; className?: string }) {
    const places = sharedRanks(standings);
    const goTo = useContext(GoToBuild);
    return (
        <div className={className}>
            <div className="flex items-center gap-3 px-3 pb-1 text-[10px] uppercase font-bold text-text-muted">
                <span className="w-7">Place</span>
                <span className="flex-1">Build</span>
                <span title="Wins, draws, losses">W-D-L</span>
                <span className="w-14 text-right" title="(wins + draws / 2) / battles">Win rate</span>
            </div>
            <ol className="space-y-1">
                {standings.map((st, i) => {
                    const same = sameNames(st, byKey);
                    return (
                        <li key={st.key} onClick={st.key === highlight ? undefined : () => goTo(st.key)} title={st.key === highlight ? undefined : 'Show this build'}
                            className={cn('flex items-center gap-3 rounded-xl px-3 py-1.5 text-xs', st.key === highlight ? 'bg-red-500/20 border border-red-400/50' : 'bg-white/[0.03] cursor-pointer hover:bg-white/[0.08]', byKey.get(st.key)?.animation.source === 'weapon' && 'border border-lime-400/40')}>
                            <span className="w-7 font-black text-text-muted">{placeText(places[i])}</span>
                            <span className="flex-1 min-w-0">
                                <span className="font-semibold">{st.key === highlight ? `${st.name} (you)` : st.name}</span>
                                {same.length > 0 && <span className="block text-[10px] text-text-muted">same build as {same.join(', ')}</span>}
                                {byKey.get(st.key)?.animation.source === 'weapon' && (
                                    <span className="inline-block mt-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-lime-400/15 text-lime-200" title="It attacks with the weapon's own animation: any skin at its top gives the same result, so every player can build it">
                                        No skin needed
                                    </span>
                                )}
                            </span>
                            <span className="font-mono text-text-muted">{st.wins}-{st.draws}-{st.losses}</span>
                            <span className="font-mono font-bold w-14 text-right">{pct(st.winRate)}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

/**
 * One step of the podium with every build of its place, in a grid as square as it can be
 * (5 builds: 3 then 2), each portrait with its name; a click shows the build's card.
 */
function PodiumStep({ place, group, byKey, block, tone, size }: {
    place: number; group: TournamentStanding[]; byKey: Map<string, ProfilePreset>; block: string; tone: string; size: number;
}) {
    const goTo = useContext(GoToBuild);
    const [ref, width] = useWidth();
    const n = group.length;
    const cols = Math.ceil(Math.sqrt(n));
    const each = Math.max(48, Math.min(size, (width || size) / cols - 4));
    return (
        <div ref={ref} className={cn('flex flex-col items-center min-w-0', place === 1 ? 'flex-[1.5] max-w-[480px]' : 'flex-1 max-w-[300px]')}>
            <div className="w-full flex flex-wrap items-end justify-center mb-1.5">
                {group.map(st => {
                    const preset = byKey.get(st.key);
                    const same = sameNames(st, byKey);
                    return (
                        <button key={st.key} onClick={() => goTo(st.key)} title="Show this build" style={{ width: `${100 / cols}%` }}
                            className="flex flex-col items-center rounded-xl hover:bg-white/[0.06] transition-colors pb-1">
                            {preset && <BuildPortrait profile={preset.profile} setId={setOf(preset)} width={each} height={each} scale={each / 3.4} />}
                            <span className={cn('font-bold text-center leading-tight break-words px-0.5', n === 1 ? 'text-xs sm:text-sm' : 'text-[10px] sm:text-xs')}>{st.name}</span>
                            <span className="text-[10px] text-text-secondary">{pct(st.winRate)}</span>
                            {same.length > 0 && <span className="text-[9px] text-text-muted text-center leading-tight">= {same.join(', ')}</span>}
                        </button>
                    );
                })}
            </div>
            <div className={cn('w-full rounded-t-2xl border border-b-0 bg-gradient-to-b flex items-start justify-center gap-1 pt-2 font-black text-3xl shadow-[inset_0_2px_0_rgba(255,255,255,0.15)]', block, tone)}>
                {place === 1 ? <Crown className="w-8 h-8" /> : place}
                {n > 1 && <span className="text-xs font-bold self-center opacity-80">x{n} tied</span>}
            </div>
        </div>
    );
}

/** The arena round robin between every build: podium, then the full table on demand. */
function Podium({ standings, byKey, battlesPerSide, skins }: {
    standings: TournamentStanding[]; byKey: Map<string, ProfilePreset>; battlesPerSide: number;
    /** With and without skins, when both are published: the toggle in the header. */
    skins?: { f2p: boolean; set: (f2p: boolean) => void };
}) {
    const [open, setOpen] = useState(false);
    const noise = noiseOf(standings);
    const places = sharedRanks(standings);
    return (
        <section className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#2a2112] via-[#17150f] to-bg-primary px-3 sm:px-6 pt-6 pb-4">
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.25),transparent_70%)] pointer-events-none" />
            <div className="relative text-center">
                <div className="inline-flex items-center gap-2 text-amber-300 font-black tracking-widest uppercase text-sm"><GameAssetIcon asset={{ icon: 'PotionsRace' }} size={16} /> Arena tournament</div>
                {skins && (
                    <div className="mt-3 flex justify-center">
                        <div className="inline-flex rounded-xl border border-amber-500/40 overflow-hidden text-xs font-bold">
                            <button onClick={() => skins.set(false)} className={cn('px-4 py-1.5', !skins.f2p ? 'bg-amber-400 text-black' : 'text-amber-200 hover:bg-amber-400/10')}>With skins</button>
                            <button onClick={() => skins.set(true)} className={cn('px-4 py-1.5', skins.f2p ? 'bg-amber-400 text-black' : 'text-amber-200 hover:bg-amber-400/10')}>No skins (F2P)</button>
                        </div>
                    </div>
                )}
                {skins?.f2p && <div className="text-[11px] text-lime-200 mt-2">Builds without any skin: every weapon's own attack, no skin stats. Every player can build them.</div>}
                <div className="text-[11px] text-text-muted mt-1">
                    Every build above against every other, game PvP rules, {battlesPerSide * 2} battles per pair (half with each build as Player 1, on the same seeds); builds that are the same fighter play once.
                    Win rate is (wins + draws / 2) over all battles, good to about ±{pct(noise)}: closer than that is a tie, shown as the same place (=1).
                </div>
            </div>
            <div className="relative flex items-end justify-center gap-1 sm:gap-3 mt-4">
                {STEPS.map(({ place, block, tone, size }) => {
                    // Every build of this place stands on its step.
                    const group = standings.filter((_, i) => places[i].rank === place);
                    return group.length ? <PodiumStep key={place} place={place} group={group} byKey={byKey} block={block} tone={tone} size={size} /> : null;
                })}
            </div>
            <div className="relative border-t border-amber-500/20 pt-3">
                <button onClick={() => setOpen(o => !o)} className="mx-auto flex items-center gap-1 text-xs font-bold text-text-secondary hover:text-text-primary">
                    Full ranking <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                </button>
                {open && <RankingList standings={standings} byKey={byKey} className="mt-2 max-w-xl mx-auto" />}
            </div>
        </section>
    );
}

/**
 * "Fight against": the active profile plays every build of the tournament, on the same seeds and
 * sides (src/presets/challenge.ts), and lands where that round robin puts it.
 */
function FightAgainst({ version, profile, total, battlesPerSide, byKey }: { version: string; profile: UserProfile; total: number; battlesPerSide: number; byKey: Map<string, ProfilePreset> }) {
    const [run, setRun] = useState<{ cancel: () => void; done: number } | null>(null);
    const [result, setResult] = useState<{ name: string; r: ChallengeResult } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [shown, setShown] = useState(false);
    useEffect(() => { setResult(null); }, [version]);
    const start = () => {
        if (run) return;
        setErr(null);
        setShown(true);
        const name = profile.name || 'Your profile';
        const r = runFightAgainst(version, name, profile, done => setRun(cur => (cur ? { ...cur, done } : cur)));
        setRun({ cancel: r.cancel, done: 0 });
        r.promise.then(res => { setResult({ name, r: res }); setOpen(true); })
            .catch(e => setErr(e instanceof Error && e.message === 'stopped' ? null : String(e)))
            .finally(() => setRun(null));
    };
    const r = result?.r;
    const me = r?.standings.find(s => s.key === CHALLENGER_KEY);
    const field = r ? r.standings.length : total + 1;
    const place = r ? sharedRanks(r.standings)[r.standings.findIndex(s => s.key === CHALLENGER_KEY)] : null;
    return (
        <section className="rounded-2xl border border-red-500/30 bg-gradient-to-b from-red-500/10 to-transparent p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <GameAssetIcon asset={{ icon: 'Battle' }} size={28} />
                <div className="flex-1 min-w-[220px]">
                    <div className="font-black text-lg leading-tight">Fight against the preset builds</div>
                    <div className="text-xs text-text-secondary">
                        Your active profile ({profile.name || 'unnamed'}) enters the tournament as it is: the same game PvP rules, {2 * battlesPerSide} battles against each of the {total} builds, on the same seeds and sides. See if it makes the ranking.
                    </div>
                </div>
                <button onClick={() => setShown(v => !v)} title={shown ? 'Close' : 'Open'} className="p-2 rounded-xl border border-border text-text-secondary hover:bg-bg-input">
                    <ChevronDown className={cn('w-4 h-4 transition-transform', shown && 'rotate-180')} />
                </button>
                {run ? (
                    <button onClick={() => run.cancel()} className="text-xs font-bold px-4 py-2 rounded-xl border border-border text-text-secondary hover:bg-bg-input">
                        Stop ({run.done}/{total})
                    </button>
                ) : (
                    <button onClick={start} className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-red-600 text-white hover:brightness-110">
                        <GameAssetIcon asset={{ icon: 'Battle' }} size={14} /> {result ? 'Fight again' : 'Fight against all'}
                    </button>
                )}
            </div>
            {shown && err && <div className="text-xs text-red-300">{err}</div>}
            {shown && r && me && result && (
                <div className="space-y-2">
                    <div className={cn('rounded-xl px-4 py-3 border', place!.rank <= 3 ? 'border-amber-400/60 bg-amber-400/10' : 'border-border bg-bg-input/40')}>
                        <div className="text-sm font-black">
                            {result.name}: place {placeText(place!)} of {field}{place!.tied ? ' (tied)' : ''}{place!.rank === 1 ? ', first place!' : place!.rank <= 3 ? ', on the podium!' : ''}
                        </div>
                        <div className="text-xs text-text-secondary font-mono">{me.wins}-{me.draws}-{me.losses}, {pct(me.winRate)} wins, HP margin {me.hpMargin >= 0 ? '+' : ''}{me.hpMargin.toFixed(3)}</div>
                    </div>
                    <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs font-bold text-text-secondary hover:text-text-primary">
                        Ranking with you and every pairing <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                    </button>
                    {open && (
                        <div className="grid md:grid-cols-2 gap-3">
                            <RankingList standings={r.standings} byKey={byKey} highlight={CHALLENGER_KEY} className="max-h-[420px] overflow-y-auto pr-1" />
                            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
                                <div className="text-[11px] font-bold text-text-secondary">Your pairings ({2 * r.battlesPerSide} battles each)</div>
                                {r.matches.map(m => (
                                    <div key={m.key} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-1.5 text-xs">
                                        <span className="flex-1">vs {m.name}</span>
                                        <span className="font-mono text-text-muted">{m.wins}-{m.draws}-{m.losses}</span>
                                        <span className={cn('font-mono font-bold w-14 text-right', m.winRate > 0.5 ? 'text-green-400' : m.winRate < 0.5 ? 'text-red-400' : '')}>{pct(m.winRate)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {shown && <div className="text-xs text-text-secondary rounded-xl bg-bg-input/40 px-3 py-2">
                Think you have a better build? If it does well here, send it to me in a DM on{' '}
                <a href="https://discord.gg/forgemaster" target="_blank" rel="noopener noreferrer" className="font-bold text-indigo-300 hover:underline">Discord</a>
                {' '}or by <a href="mailto:medrihanlucian@gmail.com" className="font-bold text-accent-primary hover:underline">email</a> and I will add it.
            </div>}
        </section>
    );
}

/** Order of the cards without a tournament (and between builds it did not rank). */
const CATEGORY_ORDER: PresetCategory[] = ['power', 'dpsMelee', 'dpsRanged', 'hpsMelee', 'hpsRanged', 'quest', 'lab'];

interface Column { label: string; value: (p: ProfilePreset, s: AggregatedStats) => number; show: (p: ProfilePreset, s: AggregatedStats) => string }
const COLUMNS: Column[] = [
    { label: 'Power', value: p => p.metrics.power, show: p => formatCompactNumber(p.metrics.power) },
    { label: 'Damage', value: p => p.metrics.totalDamage, show: p => formatCompactNumber(p.metrics.totalDamage) },
    { label: 'Health', value: p => p.metrics.totalHealth, show: p => formatCompactNumber(p.metrics.totalHealth) },
    { label: 'DPS', value: p => p.metrics.testedDps, show: p => formatCompactNumber(p.metrics.testedDps) },
    { label: 'HPS', value: p => p.metrics.testedHps, show: p => formatCompactNumber(p.metrics.testedHps) },
    { label: 'Windup', value: p => -p.animation.windup, show: p => `${p.animation.windup.toFixed(2)} s` },
    { label: 'Block', value: (_, s) => s.blockChance || 0, show: (_, s) => pct(s.blockChance || 0) },
    { label: 'Main quest', value: p => questRank(p.metrics.quest), show: p => `${p.metrics.quest.index + 1}/${p.metrics.quest.total}` },
];

/** The last "my best variants" result, per game version, in this browser. */
const MINE_KEY = (version: string) => `fm.myVariants.${version}`;
interface MineSaved { ownedKey: string; profileName: string; file: ProfilePresetsFile }

function loadMine(version: string | null): MineSaved | null {
    if (!version) return null;
    try {
        const raw = localStorage.getItem(MINE_KEY(version));
        return raw ? (JSON.parse(raw) as MineSaved) : null;
    } catch { return null; }
}
/** Weapon skins left out of the attack animations, and the last result without them, per game version. */
const LEFT_OUT_KEY = 'fm.presetLeftOutAttackSkins';
const WITHOUT_KEY = (version: string) => `fm.presetsWithout.${version}`;
interface WithoutSaved { key: string; file: ProfilePresetsFile }
function loadJson<T>(key: string): T | null {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function saveJson(key: string, v: unknown) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: kept on screen only */ }
}

/**
 * One toggle per weapon skin: a skin turned off is left out as an attack animation (and as a
 * weapon piece). The builds without them are calculated on the device from the published
 * variants, like "my best variants" with every other skin at its top.
 */
function AttackSkinToggles({ sets, leftOut, onToggle, sprites, version, skinsLibrary }: {
    sets: string[]; leftOut: Set<string>; onToggle: (setId: string) => void; sprites: any; version: string | null; skinsLibrary: any;
}) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {sets.map(id => {
                const off = leftOut.has(id);
                return (
                    <button key={id} onClick={() => onToggle(id)} title={off ? `${setDisplayName(id)}: left out, click to use it again` : `${setDisplayName(id)}: click to leave it out`}
                        className={cn('flex items-center gap-1.5 rounded-lg border pr-2 text-[11px] font-bold transition-all', off ? 'border-red-500/40 bg-red-500/10 text-red-300 opacity-60 grayscale' : 'border-border bg-bg-input/40 text-text-secondary hover:border-accent-primary/50')}>
                        <SkinThumb type="Weapon" idx={setWeaponIdx(skinsLibrary, id)} sprites={sprites} version={version} title={setDisplayName(id)} />
                        <span className={cn(off && 'line-through')}>{setDisplayName(id)}</span>
                    </button>
                );
            })}
        </div>
    );
}

function saveMine(version: string, m: MineSaved) {
    try { localStorage.setItem(MINE_KEY(version), JSON.stringify(m)); } catch { /* storage full or blocked: the result stays on screen only */ }
}

export default function PresetBuilds() {
    const { data: siteFile, error } = useGameData<ProfilePresetsFile>('ProfilePresets.json');
    const { profile } = useProfile();
    const { selectedVersion: version } = useGameDataContext();
    // The skins the active profile owns (its archive), as the search keys them.
    const owned = useMemo(() => [...new Set((profile.skins?.saved ?? []).map(s => `${s.type}:${s.idx}`))].sort(), [profile.skins]);
    // Results depend on the real rolls and levels too.
    const ownedKey = useMemo(() => (profile.skins?.saved ?? []).map(s => `${s.type}:${s.idx}:${s.level}:${JSON.stringify(s.stats)}`).sort().join(','), [profile.skins]);
    const [mine, setMine] = useState<MineSaved | null>(() => loadMine(version));
    const [view, setView] = useState<'site' | 'f2p' | 'mine' | 'without'>('site');
    const [leftOut, setLeftOut] = useState<Set<string>>(() => new Set(loadJson<string[]>(LEFT_OUT_KEY) ?? []));
    const toggleLeftOut = (id: string) => setLeftOut(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        saveJson(LEFT_OUT_KEY, [...next]);
        return next;
    });
    const leftOutKey = [...leftOut].sort().join(',');
    const [without, setWithout] = useState<WithoutSaved | null>(() => (version ? loadJson<WithoutSaved>(WITHOUT_KEY(version)) : null));
    const [run, setRun] = useState<{ cancel: () => void; log: string; started: number } | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    useEffect(() => { setMine(loadMine(version)); setWithout(version ? loadJson<WithoutSaved>(WITHOUT_KEY(version)) : null); }, [version]);
    const calculateWithout = () => {
        if (!version || run || !leftOut.size) return;
        setRunError(null);
        setView('without');
        const key = leftOutKey;
        const r = runMyVariants(version, [], msg => setRun(cur => (cur ? { ...cur, log: msg } : cur)), [...leftOut]);
        setRun({ cancel: r.cancel, log: 'starting', started: Date.now() });
        r.promise.then(result => {
            const w = { key, file: result };
            setWithout(w);
            saveJson(WITHOUT_KEY(version), w);
        }).catch(e => setRunError(e instanceof Error && e.message === 'stopped' ? null : String(e))).finally(() => setRun(null));
    };
    const calculate = () => {
        if (!version || run) return;
        setRunError(null);
        setView('mine');
        const r = runMyVariants(version, profile.skins?.saved ?? [], msg => setRun(cur => (cur ? { ...cur, log: msg } : cur)));
        setRun({ cancel: r.cancel, log: 'starting', started: Date.now() });
        r.promise.then(result => {
            const m = { ownedKey, profileName: profile.name, file: result };
            setMine(m);
            saveMine(version, m);
        }).catch(e => setRunError(e instanceof Error && e.message === 'stopped' ? null : String(e))).finally(() => setRun(null));
    };
    const file = view === 'mine' ? (mine?.file ?? null) : view === 'without' ? (without?.file ?? null) : view === 'f2p' ? (siteFile?.noSkins ?? null) : siteFile;
    const { data: sprites } = useGameData<any>('ManualSpriteMapping.json');
    const { data: mapping } = useGameData<any>('AutoItemMapping.json');
    const { libs, ready } = useStatLibraries();
    const { data: mountLibrary } = useGameData<any>('MountLibrary.json');
    // The cards also read MountLibrary (mount equivalents: same rarity and the same body).
    const cardLibs = useMemo(() => ({ ...libs, mountLibrary }), [libs, mountLibrary]);
    const { addPresetProfile } = useProfile();
    const selectedVersion = version;
    const navigate = useNavigate();
    const [tableOpen, setTableOpen] = useState(false);
    // Every set with a weapon skin: the attack animations that can be left out.
    const attackSkinSets = useMemo(() => [...new Set(Object.values<any>(libs.skinsLibrary ?? {})
        .filter(r => r.SkinId?.Type === 'Weapon' && r.BaseSetId).map(r => r.BaseSetId as string))]
        .sort((a, b) => setDisplayName(a).localeCompare(setDisplayName(b))), [libs.skinsLibrary]);

    // A file from before the categories (no `categories`) is shown as missing, not half drawn.
    const valid = !!file?.categories && file.presets.every(p => p.category && p.animation);
    const presets = useMemo(() => (valid ? file!.presets : []), [file, valid]);
    const stats = useMemo(() => {
        if (!ready) return new Map<string, AggregatedStats>();
        return new Map(presets.map(p => [p.key, calculateStats(p.profile, libs)]));
    }, [presets, libs, ready]);
    const info = useMemo(() => new Map<PresetCategory, PresetCategoryInfo>((file?.categories ?? []).map(c => [c.key, c])), [file]);
    const byKey = useMemo(() => new Map(presets.map(p => [p.key, p])), [presets]);
    // One card per category winner and per lab find; the category's other ranks go inside its card.
    const cards = useMemo(() => presets.filter(p => p.rank === 1 || p.category === 'lab'), [presets]);
    const runnersUp = (p: ProfilePreset) => (p.category === 'lab' ? [] : presets.filter(q => q.category === p.category && q.rank > 1).sort((a, b) => a.rank - b.rank));
    // Shared places (ties within the noise), and builds that are the same fighter take their twin's.
    const rankOf = useMemo(() => {
        const st = file?.tournament?.standings ?? [];
        const places = sharedRanks(st);
        return new Map(st.flatMap((s, i) => [s.key, ...(s.same ?? [])].map(k => [k, places[i].rank] as const)));
    }, [file]);
    // Cards follow the tournament when there is one.
    const ordered = useMemo(() => [...cards].sort((a, b) =>
        (rankOf.get(a.key) ?? 999) - (rankOf.get(b.key) ?? 999) || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.rank - b.rank), [cards, rankOf]);
    const tableRows = useMemo(() => [...presets].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.rank - b.rank), [presets]);
    const best = useMemo(() => COLUMNS.map(c => (presets.length && stats.size ? Math.max(...presets.map(p => c.value(p, stats.get(p.key)!))) : 0)), [presets, stats]);

    const add = (p: ProfilePreset) => {
        if (!file) return;
        addPresetProfile(p, file.version);
        toast.success(`${p.name} added to your profiles: it is yours to edit`);
        navigate('/');
    };
    const addEquivalent = (p: ProfilePreset, w: AnimationSwap) => {
        const age = p.profile.items.Weapon?.age ?? 0;
        add({ ...p, name: `${p.name} (${swapLabel(w, age, mapping)})`, profile: applyAnimation(p.profile, w, libs.skinsLibrary, libs.skinUpgradeLibrary) });
    };
    const cardFor = (p: ProfilePreset): CardProps => ({
        preset: p, stats: stats.get(p.key)!, sprites, mapping, version: selectedVersion, libs: cardLibs, onAdd: () => add(p), onAddEquivalent: w => addEquivalent(p, w),
    });

    const [focus, setFocus] = useState<{ key: string; n: number } | null>(null);
    const goTo = useMemo(() => (key: string) => setFocus({ key, n: Date.now() }), []);

    return (
        <GoToBuild.Provider value={goTo}>
        <FocusedBuild.Provider value={focus}>
        <div className="w-full space-y-6 animate-fade-in pb-12">
            <div>
                <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ sheet: 'ArenaRankIcons', index: 0 }} size={28} /> Preset Builds</h1>
                <p className="text-sm text-text-secondary mt-1 max-w-3xl">
                    The strongest builds the game allows, everything at its maximum level. Each one picks the attack animation
                    (a weapon's own or a skin's), skins, pets, skills, substats and fairy for its goal, with the next best four
                    one click away. Add any of them to your profiles to explore it.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-border overflow-hidden text-xs font-bold">
                    <button onClick={() => setView('site')} className={cn('px-3 py-2', view === 'site' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>Best builds (every skin)</button>
                    {siteFile?.noSkins && (
                        <button onClick={() => setView('f2p')} className={cn('px-3 py-2', view === 'f2p' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>No skins (F2P)</button>
                    )}
                    <button onClick={() => setView('without')} className={cn('px-3 py-2', view === 'without' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>Without some attack skins</button>
                    <button onClick={() => setView('mine')} className={cn('px-3 py-2', view === 'mine' ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>My best variants</button>
                </div>
                {run ? (
                    <button onClick={() => run.cancel()} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl border border-red-500/50 text-red-300 hover:bg-red-500/10">Stop</button>
                ) : view === 'without' ? (
                    <button onClick={calculateWithout} disabled={!version || !leftOut.size} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-amber-500 text-black hover:brightness-110 disabled:opacity-50">
                        <GameAssetIcon asset={{ icon: 'Lightning' }} size={14} /> {without ? 'Recalculate without them' : 'Calculate without them'}
                    </button>
                ) : (
                    <button onClick={calculate} disabled={!version} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-amber-500 text-black hover:brightness-110 disabled:opacity-50">
                        <GameAssetIcon asset={{ icon: 'Lightning' }} size={14} /> {mine ? 'Recalculate my best variants' : 'Calculate my best variants'}
                    </button>
                )}
            </div>

            {view === 'mine' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary space-y-1">
                    <div>
                        Only the <b>{owned.length} skins</b> in the skin archive of your profile <b>{profile.name}</b> are considered (at their top level with the top roll),
                        plus every weapon with its own animation. Everything else is at its maximum, like the preset builds: it is the most you can reach with the skins you have.
                        A set bonus counts only with all three pieces of one set.
                    </div>
                    {owned.length === 0 && (
                        <div className="text-amber-300">This profile has no skins in its archive yet: add the skins you own to it first, or the results are the builds without any skin.</div>
                    )}
                    {mine && mine.ownedKey !== ownedKey && !run && (
                        <div className="text-amber-300">These results were calculated for other skins ({mine.profileName}): recalculate to use this profile's.</div>
                    )}
                    {run && (
                        <div className="text-amber-300">Calculating on your device ({Math.round((Date.now() - run.started) / 1000)} s): {run.log}</div>
                    )}
                    {runError && <div className="text-red-300">Something went wrong: {runError}</div>}
                    {!mine && !run && <div>Press Calculate my best variants to start.</div>}
                </div>
            )}

            {view === 'without' && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-text-secondary space-y-2">
                    <div>
                        Turn off the weapon skins whose attack you do not want: the builds are calculated again without them (their attack animation and their weapon piece),
                        with every other skin at its top and every weapon's own animation. Useful when one skin would win almost everything.
                    </div>
                    <AttackSkinToggles sets={attackSkinSets} leftOut={leftOut} onToggle={toggleLeftOut} sprites={sprites} version={selectedVersion} skinsLibrary={libs.skinsLibrary} />
                    {!leftOut.size && <div className="text-amber-300">Turn off at least one skin.</div>}
                    {without && without.key !== leftOutKey && !run && leftOut.size > 0 && (
                        <div className="text-amber-300">These results were calculated without {without.key.split(',').map(setDisplayName).join(', ')}: recalculate for the skins turned off now.</div>
                    )}
                    {run && <div className="text-amber-300">Calculating on your device ({Math.round((Date.now() - run.started) / 1000)} s): {run.log}</div>}
                    {runError && <div className="text-red-300">Something went wrong: {runError}</div>}
                </div>
            )}

            {view === 'site' && !valid && (error || file) && <div className="text-sm text-text-muted">No preset builds for this game version yet.</div>}

            {valid && ready && file!.tournament && file!.tournament.standings.length >= 3 && (
                <Podium standings={file!.tournament.standings} byKey={byKey} battlesPerSide={file!.tournament.battlesPerSide}
                    skins={siteFile?.noSkins && (view === 'site' || view === 'f2p') ? { f2p: view === 'f2p', set: f2p => setView(f2p ? 'f2p' : 'site') } : undefined} />
            )}
            {view === 'site' && valid && version && file!.tournament && (
                <FightAgainst version={version} profile={profile} total={file!.tournament.standings.length} battlesPerSide={file!.tournament.battlesPerSide} byKey={byKey} />
            )}

            {valid && ready && (
                // items-start: opening one card's details grows that card only.
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
                    {ordered.map(p => (
                        <BuildCard key={p.key} {...cardFor(p)} rank={rankOf.get(p.key) ?? null} runnersUp={runnersUp(p)} cardFor={cardFor}
                            categoryName={info.get(p.category)?.name ?? p.category} />
                    ))}
                </div>
            )}

            {valid && ready && presets.length > 0 && (
                <div>
                    <button onClick={() => setTableOpen(o => !o)} className="inline-flex items-center gap-2 text-sm font-bold text-text-secondary hover:text-text-primary">
                        <Table2 className="w-4 h-4" /> Compare all <ChevronDown className={cn('w-4 h-4 transition-transform', tableOpen && 'rotate-180')} />
                    </button>
                    {tableOpen && (
                        <div className="overflow-x-auto rounded-xl border border-border mt-2">
                            <table className="w-full text-xs">
                                <thead className="bg-bg-secondary/60 text-text-muted">
                                    <tr>
                                        <th className="text-left px-3 py-2 sticky left-0 bg-bg-secondary">Build</th>
                                        {COLUMNS.map(c => <th key={c.label} className="text-right px-3 py-2 whitespace-nowrap">{c.label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableRows.map(p => (
                                        <tr key={p.key} className="border-t border-border">
                                            <td className="px-3 py-1.5 font-semibold whitespace-nowrap sticky left-0 bg-bg-primary">{p.name}</td>
                                            {COLUMNS.map((c, i) => (
                                                <td key={c.label} className={cn('px-3 py-1.5 text-right font-mono whitespace-nowrap', best[i] !== 0 && c.value(p, stats.get(p.key)!) >= best[i] - Math.abs(best[i]) * 1e-9 ? 'text-amber-300 font-bold' : 'text-text-secondary')}>
                                                    {c.show(p, stats.get(p.key)!)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
        </FocusedBuild.Provider>
        </GoToBuild.Provider>
    );
}
