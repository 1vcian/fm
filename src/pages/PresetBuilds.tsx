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
import { FAIRIES, presetPerfections, presetsFileName } from '../utils/fairies';
import { usePersistentState } from '../hooks/usePersistentState';
import { currentAlloc } from '../optimizer/substatOptimizer';
import { SpriteSheetIcon } from '../components/UI/SpriteSheetIcon';
import { BuildPortrait } from '../components/Presets/BuildPortrait';
import { applyAnimation, type AnimationSwap } from '../presets/equivalents';
import { runFightAgainst, runMyVariants } from '../presets/myVariants';
import { filterAnimations } from '../presets/filterAnimations';
import { BuildDuel, type DuelEntry } from '../components/Presets/BuildDuel';
import { listBuilds, otherSkinRows, type BuildTag, type BuildTagKind, type OtherSkinRow } from '../presets/presetList';
import { CHALLENGER_KEY, type ChallengeResult } from '../presets/challenge';
import type { UserProfile } from '../types/Profile';
import type { ProfilePreset, ProfilePresetsFile } from '../presets/buildPresets';
import type { TournamentStanding } from '../presets/tournament';
import { cn } from '../lib/utils';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { getSkinSpriteStyle } from '../utils/skinSprites';
import { useSkinIcons } from '../utils/skinIcons';
import { getItemImage } from '../utils/itemAssets';
import { AGES } from '../utils/constants';
import { aimTargetOf, saveAimTarget } from '../utils/substatStatus';

/**
 * Preset Builds: the strongest builds the game allows (parsed_configs/<version>/ProfilePresets.json,
 * scripts/build_presets.ts). The arena tournament between them on a podium, then one card per
 * category (Most Power, DPS and HPS melee and ranged, main quest) and per build lab find, with the
 * character as it looks in battle and its headline number; the category's runners-up and every
 * other number are one click away (Runners-up, Details, Compare all).
 */

const pct = (v: number) => `${(v * 100).toFixed(v * 100 >= 100 ? 0 : 1)}%`;

/** Win rates of the same lab build with every attack animation of its kind within this many points: any skin works. */
const ANY_ANIMATION_POINTS = 0.01;
const labAnimationText = (a: { best: number; worst: number; bestLabel: string; worstLabel: string }) =>
    a.best - a.worst <= ANY_ANIMATION_POINTS
        ? `Any skin works: every attack animation wins ${pct(a.worst)} to ${pct(a.best)}`
        : `Attack animation matters: best ${a.bestLabel} (${pct(a.best)}), worst ${a.worstLabel} (${pct(a.worst)})`;
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

/**
 * How the build attacks, with its exact equivalents: a weapon's own attack (its own, or one that
 * hits on the same ticks) means any skin works, so only the weapon is named; otherwise every skin
 * that attacks the same.
 */
function attackOf(p: ProfilePreset, mapping: any): { weapon: string | null; skins: string[]; windup: number } {
    const eq = p.equivalents?.animations ?? [];
    if (p.animation.source === 'weapon') return { weapon: weaponName(p, mapping), skins: [], windup: p.animation.windup };
    const w = eq.find(x => x.source === 'weapon');
    if (w) return { weapon: swapName(w, p.profile.items.Weapon?.age ?? 0, mapping), skins: [], windup: w.windup };
    return { weapon: null, skins: [p.animation.setId, ...eq.filter(x => x.source === 'skin').map(x => x.setId)].map(setDisplayName), windup: p.animation.windup };
}

/** How the build attacks: the skins that attack the same, or a weapon's own animation under any skin. */
function animationText(p: ProfilePreset, mapping: any): string {
    const a = attackOf(p, mapping);
    const windup = `${a.windup.toFixed(2)} s windup`;
    if (a.weapon) return `${a.weapon} animation, any skin with the animation off, ${windup}`;
    return `${a.skins.join(' / ')} skin animation, ${windup}`;
}

/**
 * Any skin works: the build attacks with a weapon's own animation, or one of its equivalents does
 * (the same attack row, or the same ticks at its attack speed and double chance).
 */
const noSkinNeeded = (p: ProfilePreset | undefined) => !!p && (p.animation.source === 'weapon' || !!p.equivalents?.animations.some(w => w.source === 'weapon'));

/** The attack a build runs, short: the weapon skin shown, or the weapon's own attack. */
const attackLabel = (p: ProfilePreset | undefined, mapping: any) => {
    if (!p) return '';
    const a = attackOf(p, mapping);
    return a.weapon ? `${a.weapon}, any skin` : `${a.skins.join(' / ')} skin`;
};

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

/** Equivalent skins drawn side by side, at most this many (the rest are named). */
const MAX_LOOKS = 4;

/**
 * The build drawn once per skin that attacks the same (attackOf): with a weapon's own attack any
 * skin works, so it is drawn once.
 */
function LookPortraits({ preset, width, height, scale }: { preset: ProfilePreset; width: number; height: number; scale: number }) {
    const { libs } = useStatLibraries();
    const looks = useMemo(() => {
        const eq = preset.equivalents?.animations ?? [];
        if (preset.animation.source === 'weapon' || eq.some(w => w.source === 'weapon')) return [{ profile: preset.profile, setId: setOf(preset) }];
        return [{ profile: preset.profile, setId: setOf(preset) }, ...eq.filter(w => w.source === 'skin').map(w => ({
            profile: applyAnimation(preset.profile, w, libs.skinsLibrary, libs.skinUpgradeLibrary), setId: w.setId,
        }))].slice(0, MAX_LOOKS);
    }, [preset, libs.skinsLibrary, libs.skinUpgradeLibrary]);
    if (looks.length === 1) return <BuildPortrait profile={looks[0].profile} setId={looks[0].setId} width={width} height={height} scale={scale} />;
    // Side by side: every portrait keeps the whole box (its effects are not cut), shifted so the
    // characters stand at even spacing across it, a little smaller.
    const n = looks.length;
    return (
        <div className="relative" style={{ width, height }}>
            {looks.map((l, i) => (
                <div key={l.setId ?? i} className="absolute top-0" style={{ left: (width * (i + 1)) / (n + 1) - width / 2, width, height }}>
                    <BuildPortrait profile={l.profile} setId={l.setId} width={width} height={height} scale={scale * (n === 2 ? 0.85 : 0.72)} />
                </div>
            ))}
        </div>
    );
}

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
    if (preset.lab) lines.push(`Arena: wins ${pct(preset.lab.arenaWinRate)} against the other builds`);
    if (preset.lab?.animations) lines.push(labAnimationText(preset.lab.animations));
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
    const animOff = noSkinNeeded(preset);
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
    /** An equivalent with another windup: the same ticks at this build's speed, not the same row. */
    const sameTicks = (w: AnimationSwap) => Math.abs(w.windup - a.windup) > 1e-9;
    return (
        <div className="space-y-3 text-[11px]">
            <p className="text-text-muted">Swaps that change no number of this build, read from the game files: use them if you lack a piece.</p>
            {eq.animations.length > 0 && (
                <div className="space-y-1">
                    <div className="font-bold text-text-secondary">Same attack as {current} ({secs(a.windup)} windup): the same range and projectile, and at this build's attack speed and double chance the hits land on the same ticks, so every battle is the same</div>
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
                                        ? `Wear the ${setDisplayName(w.setId)} weapon skin with the skin animation ON instead of ${current}: ${sameTicks(w) ? `its ${secs(w.windup)} windup lands on the same ticks at this build's attack speed.` : `its ${kind} attack row is the same.`}`
                                        : `Use the ${swapName(w, age, mapping)} with the skin animation OFF instead of ${current}: ${sameTicks(w) ? `its ${secs(w.windup)} windup lands on the same ticks at this build's attack speed, so any skin works.` : 'its own attack row is the same, so any skin works.'}`}
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

/** "Aim for": the build's substats become the profile page's target, then the profile page opens. */
function useAimFor() {
    const navigate = useNavigate();
    const { libs } = useStatLibraries();
    const { selectedVersion } = useGameDataContext();
    return (p: { name: string; profile: UserProfile }) => {
        saveAimTarget(aimTargetOf(p.name, selectedVersion, p.profile, libs.secondaryStatLibrary));
        navigate('/');
    };
}
const AIM_TITLE = "Compare your substats with this build's on your profile: what is missing, what to improve, what is not needed";
/** The "Aim for" button of a build card or row. */
const AimButton = ({ onAim, small }: { onAim: () => void; small?: boolean }) => (
    <button onClick={e => { e.stopPropagation(); onAim(); }} title={AIM_TITLE}
        className={cn('shrink-0 whitespace-nowrap font-black uppercase border border-accent-primary/60 text-accent-primary hover:bg-accent-primary/15',
            small ? 'text-[10px] px-2 py-1 rounded-lg' : 'text-xs px-3 py-2 rounded-xl')}>
        Aim for
    </button>
);

const AddButton = ({ onAdd }: { onAdd: () => void }) => (
    <button onClick={onAdd} className="flex-1 whitespace-nowrap inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-accent-primary text-white hover:brightness-110">
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
function BuildCard({ preset, stats, sprites, mapping, version, libs, onAdd, onAddEquivalent, rank, runnersUp, cardFor, tags }: CardProps & {
    rank: number | null; runnersUp: ProfilePreset[]; cardFor: (p: ProfilePreset) => CardProps; tags: BuildTag[];
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
    const aimFor = useAimFor();
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
                        <div className="absolute top-2 right-2 flex flex-wrap justify-end gap-1 max-w-[70%]">
                            {tags.map(t => (
                                <span key={t.label} className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', t.kind === 'lab' ? 'bg-purple-500/25 text-purple-200' : t.rank === 1 ? 'bg-amber-400/20 text-amber-200' : 'bg-black/40 text-text-secondary')}>{t.label}</span>
                            ))}
                        </div>
                        <LookPortraits preset={preset} width={260} height={200} scale={58} />
                        <KindTag ranged={ranged} className="absolute bottom-2 left-2 text-[11px] px-2.5 py-1" />
                    </div>
                    <div className="p-4 pt-2 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
                        <div>
                            <div className="font-black text-lg leading-tight">{preset.name}</div>
                            <div className="text-xs text-text-muted">{preset.goal}</div>
                            <div className="text-[11px] text-text-muted">{animationText(preset, mapping)}</div>
                        </div>
                        {isLab && preset.lab && (
                            <div className="text-xs font-bold text-purple-200">Wins {pct(preset.lab.arenaWinRate)} of its arena battles against the other builds</div>
                        )}
                        {isLab && preset.lab?.animations && (
                            <div className="text-[11px] text-purple-200/80">{labAnimationText(preset.lab.animations)}</div>
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
                            <AimButton onAim={() => aimFor(preset)} />
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
    const aimFor = useAimFor();
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
                    <div className="flex gap-2"><AddButton onAdd={onAdd} /><AimButton onAim={() => aimFor(preset)} /></div>
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

/** The other builds that fight as this one, by name (the same build in another category has the same name: left out). */
const sameNames = (st: TournamentStanding, byKey: Map<string, ProfilePreset>) => {
    const own = byKey.get(st.key)?.name ?? st.name;
    return [...new Set((st.same ?? []).map(k => byKey.get(k)?.name ?? k))].filter(n => n !== own);
};

/** The full ranking: place (=N for a tie), build, wins-draws-losses, win rate. */
function RankingList({ standings, byKey, highlight, className, others, owned, aim }: {
    standings: TournamentStanding[]; byKey: Map<string, ProfilePreset>; highlight?: string; className?: string;
    /** An "Aim for" button on every build: its substats become the profile page's target. */
    aim?: boolean;
    /** Sets whose weapon skin the active profile owns: rows it can build are highlighted. */
    owned?: ReadonlySet<string>;
    /** "Every skin": the builds with their other skins, placed by their win rate among the builds. */
    others?: OtherSkinRow[];
}) {
    const { data: mapping } = useGameData<any>('AutoItemMapping.json');
    const places = sharedRanks(standings);
    const goTo = useContext(GoToBuild);
    const aimFor = useAimFor();
    // Published builds and other skins in one order: win rate, then the HP margin.
    const rows: ({ kind: 'st'; i: number; rate: number; margin: number } | { kind: 'other'; o: OtherSkinRow; rate: number; margin: number })[] = [
        ...standings.map((st, i) => ({ kind: 'st' as const, i, rate: st.winRate, margin: st.hpMargin })),
        ...(others ?? []).map(o => ({ kind: 'other' as const, o, rate: o.winRate, margin: o.hpMargin })),
    ];
    if (others?.length) rows.sort((a, b) => b.rate - a.rate || b.margin - a.margin);
    /** The place of the published build an other-skin row is another look of. */
    const placeOf = new Map(standings.flatMap((st, i) => [st.key, ...(st.same ?? [])].map(k => [k, placeText(places[i])] as const)));
    /** The profile can attack this way: a weapon's own attack (any skin), or a weapon skin it owns that attacks the same. */
    const canBuild = (p: ProfilePreset | undefined) => {
        if (!p || !owned?.size) return false;
        if (noSkinNeeded(p)) return true;
        return [p.animation.setId, ...(p.equivalents?.animations ?? []).filter(w => w.source === 'skin').map(w => w.setId)].some(id => !!id && owned.has(id));
    };
    const ownTag = <span className="inline-block ml-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400/25 text-amber-200" title="You own this weapon skin (or any skin works)">yours</span>;
    return (
        <div className={className}>
            <div className="flex items-center gap-3 px-3 pb-1 text-[10px] uppercase font-bold text-text-muted">
                <span className="w-7">Place</span>
                <span className="flex-1">Build</span>
                <span title="Wins, draws, losses">W-D-L</span>
                <span className="w-14 text-right" title="(wins + draws / 2) / battles">Win rate</span>
            </div>
            <ol className="space-y-1">
                {rows.map(row => {
                    if (row.kind === 'other') {
                        const o = row.o;
                        const base = o.baseKey ? byKey.get(o.baseKey) : undefined;
                        const look = { ...(base ?? {}), animation: o.variant.animation, equivalents: o.variant.equivalents, profile: o.variant.profile } as ProfilePreset;
                        return (
                            <li key={`other-${o.variant.fightKey ?? o.name}-${o.variant.animation.setId}-${o.variant.animation.weaponIdx}`}
                                onClick={base ? () => goTo(base.key) : undefined} title={base ? 'Show the build (with its best skin)' : undefined}
                                className={cn('flex items-center gap-3 rounded-xl px-3 py-1.5 text-xs bg-white/[0.015] border border-dashed', canBuild(look) ? 'border-amber-400/70 bg-amber-400/10' : 'border-white/10', base && 'cursor-pointer hover:bg-white/[0.06]')}>
                                <span className="w-7 text-text-muted text-[10px]">&middot;</span>
                                <span className="flex-1 min-w-0 text-text-secondary">
                                    <span className="font-semibold">{base?.name ?? o.name}</span>
                                    <span className="text-text-muted">, {attackLabel(look, mapping)}</span>
                                    <span className="inline-block ml-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-white/10 text-text-muted">
                                        {base && placeOf.get(base.key) ? `other skin of #${placeOf.get(base.key)}` : 'other skin'}
                                    </span>
                                    {canBuild(look) && ownTag}
                                </span>
                                <span className="font-mono text-text-muted">{o.wins}-{o.draws}-{o.losses}</span>
                                <span className="font-mono font-bold w-14 text-right text-text-secondary">{pct(o.winRate)}</span>
                                {aim && <AimButton small onAim={() => aimFor({ name: `${base?.name ?? o.name}, ${attackLabel(look, mapping)}`, profile: o.variant.profile })} />}
                            </li>
                        );
                    }
                    const i = row.i, st = standings[i];
                    const same = sameNames(st, byKey);
                    return (
                        <li key={st.key} onClick={st.key === highlight ? undefined : () => goTo(st.key)} title={st.key === highlight ? undefined : 'Show this build'}
                            className={cn('flex items-center gap-3 rounded-xl px-3 py-1.5 text-xs', st.key === highlight ? 'bg-red-500/20 border border-red-400/50' : 'bg-white/[0.03] cursor-pointer hover:bg-white/[0.08]', noSkinNeeded(byKey.get(st.key)) && 'border border-lime-400/40', st.key !== highlight && canBuild(byKey.get(st.key)) && 'border border-amber-400/70 bg-amber-400/10')}>
                            <span className="w-7 font-black text-text-muted">{placeText(places[i])}</span>
                            <span className="flex-1 min-w-0">
                                <span className="font-semibold">{st.key === highlight ? `${st.name} (you)` : byKey.get(st.key)?.name ?? st.name}</span>
                                {st.key !== highlight && byKey.get(st.key) && <span className="text-text-muted">, {attackLabel(byKey.get(st.key), mapping)}</span>}
                                {st.key !== highlight && canBuild(byKey.get(st.key)) && ownTag}
                                {same.length > 0 && <span className="block text-[10px] text-text-muted">same build as {same.join(', ')}</span>}
                                {noSkinNeeded(byKey.get(st.key)) && (
                                    <span className="inline-block mt-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-lime-400/15 text-lime-200" title="It attacks with the weapon's own animation: any skin at its top gives the same result, so every player can build it">
                                        No skin needed
                                    </span>
                                )}
                            </span>
                            <span className="font-mono text-text-muted">{st.wins}-{st.draws}-{st.losses}</span>
                            <span className="font-mono font-bold w-14 text-right">{pct(st.winRate)}</span>
                            {aim && st.key !== highlight && byKey.get(st.key) && <AimButton small onAim={() => aimFor(byKey.get(st.key)!)} />}
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
    const { data: mapping } = useGameData<any>('AutoItemMapping.json');
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
                            {preset && <LookPortraits preset={preset} width={each} height={each} scale={each / 3.4} />}
                            <span className={cn('font-bold text-center leading-tight break-words px-0.5', n === 1 ? 'text-xs sm:text-sm' : 'text-[10px] sm:text-xs')}>{st.name}</span>
                            {preset && <span className="text-[10px] text-text-muted">{attackLabel(preset, mapping)}</span>}
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
function Podium({ standings, byKey, battlesPerSide, skins, others, owned }: {
    standings: TournamentStanding[]; byKey: Map<string, ProfilePreset>; battlesPerSide: number;
    /** With and without skins, when both are published: the toggle in the header. */
    skins?: { f2p: boolean; set: (f2p: boolean) => void };
    /** Every build with each of its other skins, against the published builds (otherSkinRows). */
    others?: OtherSkinRow[];
    /** Sets whose weapon skin the active profile owns: their rows are highlighted. */
    owned?: ReadonlySet<string>;
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
                <button onClick={() => setOpen(o => !o)} className="mx-auto flex items-center gap-1.5 text-sm font-black px-5 py-2 rounded-xl border border-amber-400/70 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 shadow-[0_0_16px_rgba(251,191,36,0.2)]">
                    {open ? 'Hide the full ranking' : 'View the full ranking, every build and skin'} <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                </button>
                {open && others && others.length > 0 && (
                    <div className="mt-2 max-w-xl mx-auto text-[11px] text-text-muted">
                        The dashed rows are the builds with their other attack skins, each entered against the builds above as Fight against does (the same battles, played ahead):
                        a build with another skin can beat the next build with its best one. Skins that attack on the same ticks are one row.
                        {owned && owned.size > 0 && <> The rows you can build with the weapon skins of your profile are highlighted.</>}
                    </div>
                )}
                {open && <RankingList standings={standings} byKey={byKey} others={others} owned={owned} aim className="mt-2 max-w-xl mx-auto" />}
            </div>
        </section>
    );
}

/** Discord profile of the site's author: the copied results are sent there in a DM. */
const AUTHOR_DISCORD = 'https://discord.com/users/267031081591504900';

/**
 * Substat sliders of the "maxed" fight: one per rollable stat (SecondaryStatLibrary UpperRange >
 * 0), each at most once per body (items at the top age, pets and mount by their rarity,
 * SecondaryStatPetUnlockLibrary), all of them together at most every slot.
 */
function SubstatSliders({ alloc, onChange, statIds, perStatCap, slots }: {
    alloc: Record<string, number>; onChange: (next: Record<string, number>) => void; statIds: string[]; perStatCap: number; slots: number;
}) {
    const used = Object.values(alloc).reduce((n, v) => n + v, 0);
    return (
        <div className="space-y-1.5">
            <div className={cn('text-[11px] font-bold', used > slots ? 'text-red-300' : 'text-text-secondary')}>{used}/{slots} substat lines</div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                {statIds.map(id => {
                    const v = alloc[id] ?? 0;
                    const max = Math.min(perStatCap, v + Math.max(0, slots - used));
                    return (
                        <label key={id} className="flex items-center gap-2 text-xs">
                            <span className="w-36 shrink-0 text-text-secondary truncate">{getStatName(id)}</span>
                            <input type="range" min={0} max={perStatCap} value={v} className="flex-1 accent-red-500"
                                onChange={e => onChange({ ...alloc, [id]: Math.min(Number(e.target.value), max) })} />
                            <span className="w-6 text-right font-mono font-bold">{v}</span>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * "Fight against": the active profile plays every build of the tournament, on the same seeds and
 * sides (src/presets/challenge.ts), and lands where that round robin puts it. As it is, or with
 * everything it has maxed (maxedFromProfile) and the substats of the sliders at the top roll.
 */
function FightAgainst({ version, perfection, profile, total, battlesPerSide, byKey, onBattles }: {
    version: string; perfection: number; profile: UserProfile; total: number; battlesPerSide: number; byKey: Map<string, ProfilePreset>;
    /** Opens the duel on one pairing: the profile as it fought (maxed when asked) against that build. */
    onBattles?: (opponentKey: string, fighter: UserProfile, maxed: boolean) => void;
}) {
    const { data: mapping } = useGameData<any>('AutoItemMapping.json');
    const [run, setRun] = useState<{ cancel: () => void; done: number } | null>(null);
    const [result, setResult] = useState<{ name: string; maxed: Record<string, number> | null; r: ChallengeResult } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [shown, setShown] = useState(false);
    const [maxed, setMaxed] = useState(false);
    const { libs } = useStatLibraries();
    const { data: itemUnlock } = useGameData<Record<string, { NumberOfSecondStats: number }>>('SecondaryStatItemUnlockLibrary.json');
    const { data: petUnlock } = useGameData<Record<string, { NumberOfSecondStats: number }>>('SecondaryStatPetUnlockLibrary.json');
    const statIds = useMemo(() => Object.keys(libs.secondaryStatLibrary ?? {}).filter(id => (libs.secondaryStatLibrary as any)[id]?.UpperRange > 0)
        .sort((a, b) => getStatName(a).localeCompare(getStatName(b))), [libs.secondaryStatLibrary]);
    const bodies = useMemo(() => {
        const item = Math.max(0, ...Object.values(itemUnlock ?? {}).map(r => r.NumberOfSecondStats));
        const pet = (rarity?: string) => (rarity ? petUnlock?.[rarity]?.NumberOfSecondStats ?? 0 : 0);
        return [...Array(8).fill(item), ...profile.pets.active.map(x => pet(x?.rarity)), pet(profile.mount.active?.rarity)] as number[];
    }, [itemUnlock, petUnlock, profile.pets.active, profile.mount.active]);
    const slots = bodies.reduce((n, b) => n + b, 0);
    const perStatCap = bodies.filter(b => b > 0).length;
    const [alloc, setAlloc] = useState<Record<string, number>>(() => currentAlloc(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setAlloc(currentAlloc(profile)); }, [profile.id]);
    const used = Object.values(alloc).reduce((n, v) => n + v, 0);
    useEffect(() => { setResult(null); }, [version, perfection]);
    const start = () => {
        if (run || (maxed && used > slots)) return;
        setErr(null);
        setShown(true);
        const name = profile.name || 'Your profile';
        const fightAlloc = maxed ? { ...alloc } : null;
        const r = runFightAgainst(version, name, profile, done => setRun(cur => (cur ? { ...cur, done } : cur)), fightAlloc ?? undefined, perfection);
        setRun({ cancel: r.cancel, done: 0 });
        r.promise.then(res => { setResult({ name, maxed: fightAlloc, r: res }); setOpen(true); })
            .catch(e => setErr(e instanceof Error && e.message === 'stopped' ? null : String(e)))
            .finally(() => setRun(null));
    };
    const copy = () => {
        if (!result) return;
        const res = result.r;
        const meRow = res.standings.find(s => s.key === CHALLENGER_KEY);
        const at = sharedRanks(res.standings)[res.standings.findIndex(s => s.key === CHALLENGER_KEY)];
        const subs = Object.entries(result.maxed ?? currentAlloc(profile)).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${n} ${getStatName(id)}`).join(', ');
        const lines = [
            `Forge Master Calculator, Fight against the preset builds (${version})`,
            `${result.name}: ${result.maxed ? `assuming everything maxed, substats at ${perfection === 100 ? 'the top roll' : `${perfection}% of the top roll`}` : 'the profile as it is'}`,
            meRow && at ? `Place ${placeText(at)} of ${res.standings.length}${at.tied ? ' (tied)' : ''}: ${meRow.wins}-${meRow.draws}-${meRow.losses}, ${pct(meRow.winRate)} wins, HP margin ${meRow.hpMargin.toFixed(3)}` : '',
            `Substats: ${subs || 'none'}`,
            `Fairy: ${profile.misc.fairy?.name ?? 'none'}, skills: ${profile.skills.equipped.map(x => x.id).join(', ') || 'none'}, pets: ${profile.pets.active.map(x => `${x.rarity} ${x.id}`).join(', ') || 'none'}, mount: ${profile.mount.active ? `${profile.mount.active.rarity} ${profile.mount.active.id}` : 'none'}`,
            '',
            ...res.matches.map(m => `vs ${byKey.get(m.key)?.name ?? m.name}${byKey.get(m.key) ? ` (${attackLabel(byKey.get(m.key), mapping)})` : ''}: ${m.wins}-${m.draws}-${m.losses} (${pct(m.winRate)})`),
        ].filter((l, i) => l !== '' || i === 5);
        navigator.clipboard.writeText(lines.join('\n')).then(() => toast.success('Results copied: paste them in a DM'), () => toast.error('Could not copy'));
    };
    const r = result?.r;
    const me = r?.standings.find(s => s.key === CHALLENGER_KEY);
    const field = r ? r.standings.length : total + 1;
    const place = r ? sharedRanks(r.standings)[r.standings.findIndex(s => s.key === CHALLENGER_KEY)] : null;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                    <div className="text-xs text-text-secondary">
                        Your active profile ({profile.name || 'unnamed'}) enters the tournament {maxed ? 'assuming everything you have maxed, with the substats below' : 'as it is'}: the same game PvP rules, {2 * battlesPerSide} battles against each of the {total} builds, on the same seeds and sides. See if it makes the ranking.
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
            {shown && (
                <div className="rounded-xl border border-border bg-bg-input/30 px-3 py-2 space-y-2">
                    <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input type="checkbox" checked={maxed} onChange={e => setMaxed(e.target.checked)} className="accent-red-500" />
                        Assuming everything you have maxed
                    </label>
                    {maxed && (
                        <>
                            <div className="text-[11px] text-text-muted">
                                Your weapon kind and attack animation, skins, pets and mount (their rarity), equipped skills and fairy, everything at its top level like the preset builds,
                                with these substats at {perfection === 100 ? 'the top roll' : `${perfection}% of the top roll, like the builds shown`}. They start from your build's.
                            </div>
                            <SubstatSliders alloc={alloc} onChange={setAlloc} statIds={statIds} perStatCap={perStatCap} slots={slots} />
                            <button onClick={() => setAlloc(currentAlloc(profile))} className="text-[11px] font-bold text-accent-primary hover:underline">Back to my build's substats</button>
                        </>
                    )}
                </div>
            )}
            {shown && err && <div className="text-xs text-red-300">{err}</div>}
            {shown && r && me && result && (
                <div className="space-y-2">
                    <div className={cn('rounded-xl px-4 py-3 border', place!.rank <= 3 ? 'border-amber-400/60 bg-amber-400/10' : 'border-border bg-bg-input/40')}>
                        <div className="text-sm font-black">
                            {result.name}: place {placeText(place!)} of {field}{place!.tied ? ' (tied)' : ''}{place!.rank === 1 ? ', first place!' : place!.rank <= 3 ? ', on the podium!' : ''}
                        </div>
                        <div className="text-xs text-text-secondary font-mono">{me.wins}-{me.draws}-{me.losses}, {pct(me.winRate)} wins, HP margin {me.hpMargin >= 0 ? '+' : ''}{me.hpMargin.toFixed(3)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs font-bold text-text-secondary hover:text-text-primary">
                            Ranking with you and every pairing <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                        </button>
                        <button onClick={copy} className="text-xs font-bold px-3 py-1.5 rounded-xl border border-border text-text-secondary hover:bg-bg-input">Copy results</button>
                    </div>
                    {open && (
                        <div className="grid md:grid-cols-2 gap-3">
                            <RankingList standings={r.standings} byKey={byKey} highlight={CHALLENGER_KEY} aim className="max-h-[420px] overflow-y-auto pr-1" />
                            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
                                <div className="text-[11px] font-bold text-text-secondary">Your pairings ({2 * r.battlesPerSide} battles each)</div>
                                {r.matches.map(m => (
                                    <div key={m.key} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-1.5 text-xs">
                                        <span className="flex-1">vs {byKey.get(m.key)?.name ?? m.name}{byKey.get(m.key) && <span className="text-text-muted">, {attackLabel(byKey.get(m.key), mapping)}</span>}</span>
                                        <span className="font-mono text-text-muted">{m.wins}-{m.draws}-{m.losses}</span>
                                        <span className={cn('font-mono font-bold w-14 text-right', m.winRate > 0.5 ? 'text-green-400' : m.winRate < 0.5 ? 'text-red-400' : '')}>{pct(m.winRate)}</span>
                                        {onBattles && r.fighter && byKey.get(m.key) && (
                                            <button onClick={() => onBattles(m.key, r.fighter!, !!result.maxed)} title="See these battles one by one and watch them"
                                                className="shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-lg border border-accent-primary/60 text-accent-primary hover:bg-accent-primary/15">Battles</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {shown && <div className="text-xs text-text-secondary rounded-xl bg-bg-input/40 px-3 py-2">
                Think you have a better build? If it does well here, press Copy results and send them to me in a DM on{' '}
                <a href={AUTHOR_DISCORD} target="_blank" rel="noopener noreferrer" className="font-bold text-indigo-300 hover:underline">Discord</a>
                {' '}or by <a href="mailto:medrihanlucian@gmail.com" className="font-bold text-accent-primary hover:underline">email</a> and I will add it.
            </div>}
        </div>
    );
}

/**
 * Fight against the preset builds and Duel two builds, as two tabs of one box. Both stay mounted, so
 * switching keeps each one's results; "Battles" on a Fight against pairing opens that pairing in the
 * duel, with the profile exactly as it fought (maxed, when that was asked).
 */
function BattleTabs({ duelEntries, fight }: {
    duelEntries: DuelEntry[];
    fight: ((onBattles: (key: string, fighter: UserProfile, maxed: boolean) => void) => React.ReactNode) | null;
}) {
    const [tab, setTab] = useState<'fight' | 'duel'>(fight ? 'fight' : 'duel');
    const [fought, setFought] = useState<DuelEntry | null>(null);
    const [request, setRequest] = useState<{ a: string; b: string; id: number } | null>(null);
    const onBattles = (key: string, fighter: UserProfile, maxed: boolean) => {
        setFought({ key: 'fought', name: `${fighter.name || 'You'}${maxed ? ', maxed' : ''} (as in Fight against)`, group: 'Your profile', profile: fighter });
        setRequest({ a: 'fought', b: key, id: Date.now() });
        setTab('duel');
    };
    const tabs = [...(fight ? [['fight', 'Fight against all'] as const] : []), ['duel', 'Duel two builds'] as const];
    return (
        <section className="rounded-2xl border border-red-500/30 bg-gradient-to-b from-red-500/10 to-transparent p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <GameAssetIcon asset={{ icon: 'Battle' }} size={28} />
                <div className="flex rounded-xl border border-border overflow-hidden text-xs font-bold" role="tablist">
                    {tabs.map(([k, label]) => (
                        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                            className={cn('px-3 py-2', tab === k ? 'bg-red-600 text-white' : 'text-text-secondary hover:bg-bg-input')}>{label}</button>
                    ))}
                </div>
            </div>
            {fight && <div className={cn(tab !== 'fight' && 'hidden')}>{fight(onBattles)}</div>}
            <div className={cn(tab !== 'duel' && 'hidden')}>
                <BuildDuel presets={duelEntries} extra={fought ? [fought] : []} request={request} />
            </div>
        </section>
    );
}

type SortKey = 'arena' | 'power' | 'dps' | 'hps' | 'quest';
/** What the cards can be sorted on: the arena tournament place, or one of the published numbers. */
const SORTS: { key: SortKey; label: string; value: (p: ProfilePreset) => number }[] = [
    { key: 'arena', label: 'Strongest in PvP', value: () => 0 },
    { key: 'power', label: 'Power', value: p => p.metrics.power },
    { key: 'dps', label: 'DPS', value: p => p.metrics.testedDps },
    { key: 'hps', label: 'HPS', value: p => p.metrics.testedHps },
    { key: 'quest', label: 'Main quest', value: p => p.metrics.quest.score ?? questRank(p.metrics.quest) },
];
/** The categories as filters: the builds that are among the best five of one. */
const TAG_FILTERS: { key: BuildTagKind; label: string }[] = [
    { key: 'power', label: 'Most Power' }, { key: 'dps', label: 'Most DPS' }, { key: 'hps', label: 'Most HPS' },
    { key: 'quest', label: 'Furthest main quest' }, { key: 'lab', label: 'PvP lab' },
];

/** One multiselect filter: nothing selected shows everything. */
function FilterGroup<T extends string>({ label, options, selected, onChange }: {
    label: string; options: { key: T; label: string }[]; selected: Set<T>; onChange: (next: Set<T>) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-text-muted w-20 shrink-0">{label}</span>
            {options.map(o => {
                const on = selected.has(o.key);
                return (
                    <button key={o.key} onClick={() => { const next = new Set(selected); if (on) next.delete(o.key); else next.add(o.key); onChange(next); }}
                        className={cn('px-3 py-1.5 rounded-xl border', on ? 'border-accent-primary bg-accent-primary/15 text-text-primary' : 'border-border text-text-secondary hover:bg-bg-input')}>
                        {o.label}
                    </button>
                );
            })}
            {selected.size > 0 && <button onClick={() => onChange(new Set())} className="text-accent-primary hover:underline px-1">Any</button>}
        </div>
    );
}


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

/** The last "use my skins" result, per game version, in this browser. */
const MINE_KEY = (version: string) => `fm.myVariants.${version}`;
/** leftOutKey: the attack skins left out when it was calculated (missing: none). */
interface MineSaved { ownedKey: string; leftOutKey?: string; profileName: string; file: ProfilePresetsFile }

function loadMine(version: string | null): MineSaved | null {
    if (!version) return null;
    try {
        const raw = localStorage.getItem(MINE_KEY(version));
        return raw ? (JSON.parse(raw) as MineSaved) : null;
    } catch { return null; }
}
/**
 * Weapon skins left out of the attack animations. A new key: the old tab's choice
 * ('fm.presetLeftOutAttackSkins') now filters the main view, so everyone starts with every skin on.
 */
const LEFT_OUT_KEY = 'fm.presetAttackSkinsOff';
function loadJson<T>(key: string): T | null {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function saveJson(key: string, v: unknown) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: kept on screen only */ }
}

/**
 * One toggle per weapon skin: a skin turned off is left out as an attack animation. The builds
 * pick again among the published ones with the animations left (src/presets/filterAnimations.ts).
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
    const { selectedVersion: version } = useGameDataContext();
    // Substat perfection the builds were searched at: one published file per level (PRESET_PERFECTIONS).
    const perfections = presetPerfections(version);
    const [perfectionWanted, setPerfection] = usePersistentState<number>('presets_perfection', 100);
    const perfection = perfections.includes(perfectionWanted) ? perfectionWanted : 100;
    const { data: siteFile, error } = useGameData<ProfilePresetsFile>(presetsFileName(version, perfection));
    const { profile } = useProfile();
    // The skins the active profile owns (its archive), as the search keys them.
    const owned = useMemo(() => [...new Set((profile.skins?.saved ?? []).map(s => `${s.type}:${s.idx}`))].sort(), [profile.skins]);
    // Results depend on the real rolls and levels too.
    const ownedKey = useMemo(() => (profile.skins?.saved ?? []).map(s => `${s.type}:${s.idx}:${s.level}:${JSON.stringify(s.stats)}`).sort().join(','), [profile.skins]);
    const [mine, setMine] = useState<MineSaved | null>(() => loadMine(version));
    const [f2p, setF2p] = useState(false);
    const [mySkins, setMySkins] = useState(false);
    const [leftOut, setLeftOut] = useState<Set<string>>(() => new Set(loadJson<string[]>(LEFT_OUT_KEY) ?? []));
    const setLeftOutSaved = (next: Set<string>) => { setLeftOut(next); saveJson(LEFT_OUT_KEY, [...next]); };
    const toggleLeftOut = (id: string) => {
        const next = new Set(leftOut);
        if (next.has(id)) next.delete(id); else next.add(id);
        setLeftOutSaved(next);
    };
    const leftOutKey = [...leftOut].sort().join(',');
    const [run, setRun] = useState<{ cancel: () => void; log: string; started: number } | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    useEffect(() => { setMine(loadMine(version)); }, [version]);
    // "Use my skins": the player's pieces with their real rolls and levels change the numbers, so
    // these builds are calculated on the device (the attack skins left out stay out).
    const calculate = () => {
        if (!version || run) return;
        setRunError(null);
        const key = leftOutKey;
        const r = runMyVariants(version, profile.skins?.saved ?? [], msg => setRun(cur => (cur ? { ...cur, log: msg } : cur)), [...leftOut], perfection);
        setRun({ cancel: r.cancel, log: 'starting', started: Date.now() });
        r.promise.then(result => {
            const m = { ownedKey, leftOutKey: key, profileName: profile.name, file: result };
            setMine(m);
            saveMine(version, m);
        }).catch(e => setRunError(e instanceof Error && e.message === 'stopped' ? null : String(e))).finally(() => setRun(null));
    };
    const mineFresh = !!mine && mine.ownedKey === ownedKey && (mine.leftOutKey ?? '') === leftOutKey && (mine.file.perfection ?? 100) === perfection;
    const { libs: fileLibs, ready: fileReady } = useStatLibraries();
    // Every skin, or some attack skins left out: picked from the published results at once.
    const filtered = useMemo(() => (siteFile && fileReady ? filterAnimations(siteFile, leftOut, fileLibs) : siteFile),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [siteFile, leftOutKey, fileLibs, fileReady]);
    const file = f2p ? (siteFile?.noSkins ?? null) : mySkins ? (mine?.file ?? null) : filtered;
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
    // Every distinct build once, named by its substats and fairy, with its categories as tags.
    const listed = useMemo(() => (valid ? listBuilds(file!) : null), [file, valid]);
    const presets = useMemo(() => listed?.renamed.presets ?? [], [listed]);
    const tournament = listed?.renamed.tournament;
    // Sets whose weapon skin the active profile's archive has.
    const ownedWeaponSets = useMemo(() => new Set((profile.skins?.saved ?? []).filter(s => s.type === 'Weapon')
        .map(s => skinRow(fileLibs.skinsLibrary, 'Weapon', s.idx)?.BaseSetId).filter((x): x is string => !!x)), [profile.skins, fileLibs.skinsLibrary]);
    // Every build with its other attack skins (not the ones turned off), from the pairings played ahead.
    const otherRows = useMemo(() => (listed && fileReady
        ? otherSkinRows(listed.renamed, fileLibs, v => v.animation.source === 'skin' && !!v.animation.setId && leftOut.has(v.animation.setId))
        : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [listed, fileReady, fileLibs, leftOutKey]);
    const [tagFilter, setTagFilter] = useState<Set<BuildTagKind>>(new Set());
    const [kindFilter, setKindFilter] = useState<Set<'melee' | 'ranged'>>(new Set());
    const [fairyFilter, setFairyFilter] = useState<Set<string>>(new Set());
    const [sortBy, setSortBy] = useState<SortKey>('arena');
    const stats = useMemo(() => {
        if (!ready) return new Map<string, AggregatedStats>();
        return new Map(presets.map(p => [p.key, calculateStats(p.profile, libs)]));
    }, [presets, libs, ready]);
    const byKey = useMemo(() => new Map(presets.map(p => [p.key, p])), [presets]);
    // The duel's preset side: every build of the tournament once, in its order.
    const duelEntries = useMemo<DuelEntry[]>(() => (tournament?.standings ?? []).flatMap((st, i) => {
        const p = byKey.get(st.key);
        if (!p) return [];
        // Its other attack skins, from the pairings played ahead (the skins turned off are left out).
        const keys = new Set([st.key, ...(st.same ?? [])]);
        const others = otherRows.filter(o => o.baseKey && keys.has(o.baseKey)).map(o => {
            const look = { ...p, animation: o.variant.animation, equivalents: o.variant.equivalents, profile: o.variant.profile } as ProfilePreset;
            return { key: `${o.variant.animation.source}:${o.variant.animation.setId ?? o.variant.animation.weaponIdx}`, name: attackLabel(look, mapping), profile: o.variant.profile };
        });
        return [{
            key: st.key, name: p.name, rank: i + 1, group: 'Preset builds', profile: p.profile,
            variants: [{ key: 'published', name: `${attackLabel(p, mapping)} (published)`, profile: p.profile }, ...others],
        }];
    }), [tournament, byKey, otherRows, mapping]);
    const noRunnersUp: ProfilePreset[] = [];
    // Shared places (ties within the noise), and builds that are the same fighter take their twin's.
    const rankOf = useMemo(() => {
        const st = tournament?.standings ?? [];
        const places = sharedRanks(st);
        return new Map(st.flatMap((s, i) => [s.key, ...(s.same ?? [])].map(k => [k, places[i].rank] as const)));
    }, [tournament]);
    // One card per distinct build: the tag filter, then the chosen sort (ties: the arena place).
    const ordered = useMemo(() => {
        const arena = (b: { keys: string[] }) => Math.min(...b.keys.map(k => rankOf.get(k) ?? 999));
        const value = (p: ProfilePreset) => SORTS.find(x => x.key === sortBy)!.value(p);
        return (listed?.builds ?? [])
            .filter(b => !tagFilter.size || b.tags.some(t => tagFilter.has(t.kind)))
            .filter(b => !kindFilter.size || kindFilter.has(stats.get(b.preset.key)?.isRangedWeapon ? 'ranged' : 'melee'))
            .filter(b => !fairyFilter.size || fairyFilter.has(b.preset.profile.misc.fairy?.name ?? 'none'))
            .sort((a, b) => (sortBy === 'arena' ? 0 : value(b.preset) - value(a.preset)) || arena(a) - arena(b));
    }, [listed, rankOf, sortBy, tagFilter, kindFilter, fairyFilter, stats]);
    const fairyOptions = useMemo(() => [...new Set((listed?.builds ?? []).map(b => b.preset.profile.misc.fairy?.name ?? 'none'))].sort()
        .map(f => ({ key: f, label: f === 'none' ? 'No fairy' : f })), [listed]);
    // The table: every distinct build once, in the cards' order.
    const tableRows = useMemo(() => ordered.map(b => b.preset), [ordered]);
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
                    The strongest builds found so far, everything at its maximum level. Each one picks the attack animation
                    (a weapon's own or a skin's), skins, pets, skills, substats and fairy for its goal, with the next best four
                    one click away. Add any of them to your profiles to explore it.
                    {perfections.length > 1 && ` Substats: every roll at ${perfection}% of its top value (the slider), the builds searched again at each level.`}
                </p>
                <p className="text-xs text-text-muted mt-1 max-w-3xl">
                    Items, skins, pets, skills, substats and fairies combine into far more builds than any computer can try one by one,
                    so not every build can be calculated. These are the best the search has found for now, with the new fairies,
                    and they may be beaten as the search goes on.
                </p>
            </div>

            <div data-preset-controls className="sticky -top-4 md:-top-6 z-30 -mx-2 px-2 py-2 rounded-b-xl bg-bg-primary/95 backdrop-blur shadow-lg shadow-black/40 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-border overflow-hidden text-xs font-bold">
                    <button onClick={() => setF2p(false)} className={cn('px-3 py-2', !f2p ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>With skins</button>
                    {siteFile?.noSkins && (
                        <button onClick={() => setF2p(true)} className={cn('px-3 py-2', f2p ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>No skins (F2P)</button>
                    )}
                </div>
                {perfections.length > 1 && (
                    <label className="order-last sm:order-none inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-xl border border-border" title="Every substat of every build rolled at this % of its top roll">
                        <span className="text-text-secondary">Substats</span>
                        <input type="range" min={0} max={perfections.length - 1} step={1} value={perfections.indexOf(perfection)}
                            onChange={e => setPerfection(perfections[Number(e.target.value)])}
                            className="w-28 h-2 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary" />
                        <span className="font-mono text-accent-primary w-10 text-right">{perfection}%</span>
                    </label>
                )}
                {!f2p && (
                    <button onClick={() => setMySkins(v => !v)} className={cn('inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border', mySkins ? 'border-amber-400 bg-amber-400/15 text-amber-200' : 'border-border text-text-secondary hover:bg-bg-input')}>
                        <span className={cn('w-3 h-3 rounded-full border', mySkins ? 'bg-amber-400 border-amber-400' : 'border-text-muted')} /> Use my skins
                    </button>
                )}
                {!f2p && mySkins && (run ? (
                    <button onClick={() => run.cancel()} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl border border-red-500/50 text-red-300 hover:bg-red-500/10">Stop</button>
                ) : (
                    <button onClick={calculate} disabled={!version} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl bg-amber-500 text-black hover:brightness-110 disabled:opacity-50">
                        <GameAssetIcon asset={{ icon: 'Lightning' }} size={14} /> {mine ? 'Recalculate with my skins' : 'Calculate with my skins'}
                    </button>
                ))}
            </div>

            {!f2p && (
                <div className="rounded-xl border border-border bg-bg-input/20 px-4 py-3 text-xs text-text-secondary space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-text-primary">Attack skins</span>
                        <span className="flex-1 min-w-[200px]">Turn off the weapon skins whose attack animation you do not want: the builds pick again among the rest.{!mySkins && ' Nothing is calculated, every result is already published.'}</span>
                        {leftOut.size > 0 && <button onClick={() => setLeftOutSaved(new Set())} className="font-bold text-accent-primary hover:underline">Turn all on</button>}
                    </div>
                    <AttackSkinToggles sets={attackSkinSets} leftOut={leftOut} onToggle={toggleLeftOut} sprites={sprites} version={selectedVersion} skinsLibrary={libs.skinsLibrary} />
                    {!mySkins && file && !file.tournament && siteFile?.tournament && (
                        <div className="text-amber-300">This game version's file has no pairings played ahead: the arena tournament is shown with every attack skin on only.</div>
                    )}
                </div>
            )}

            {!f2p && mySkins && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary space-y-1">
                    <div>
                        Your own skins from the skin archive of <b>{profile.name}</b> ({owned.length}), with their real levels and rolls, plus every weapon with its own animation.
                        They change the numbers, so these builds are calculated on your device. Everything else is at its maximum, like the preset builds.
                        A set bonus counts only with all three pieces of one set.
                    </div>
                    {owned.length === 0 && (
                        <div className="text-amber-300">This profile has no skins in its archive yet: add the skins you own to it first, or the results are the builds without any skin.</div>
                    )}
                    {mine && !mineFresh && !run && (
                        <div className="text-amber-300">These results were calculated for other skins, other attack skins left out or another substat perfection ({mine.profileName}): recalculate.</div>
                    )}
                    {run && (
                        <div className="text-amber-300">Calculating on your device ({Math.round((Date.now() - run.started) / 1000)} s): {run.log}</div>
                    )}
                    {runError && <div className="text-red-300">Something went wrong: {runError}</div>}
                    {!mine && !run && <div>Press Calculate with my skins to start.</div>}
                </div>
            )}

            {!mySkins && !valid && (error || file) && <div className="text-sm text-text-muted">No preset builds for this game version yet.</div>}

            {valid && ready && tournament && tournament.standings.length >= 3 && (
                <Podium standings={tournament.standings} byKey={byKey} battlesPerSide={tournament.battlesPerSide} others={otherRows} owned={ownedWeaponSets}
                    skins={siteFile?.noSkins && !mySkins ? { f2p, set: setF2p } : undefined} />
            )}
            {valid && ready && version && duelEntries.length > 0 && (
                <BattleTabs key={`${version}-${perfection}-${f2p}-${mySkins}`} duelEntries={duelEntries}
                    fight={file === siteFile && file!.tournament ? (onBattles => (
                        <FightAgainst version={version} perfection={perfection} profile={profile} total={file!.tournament!.standings.length} battlesPerSide={file!.tournament!.battlesPerSide} byKey={byKey} onBattles={onBattles} />
                    )) : null} />
            )}

            {valid && ready && (
                <div className="rounded-xl border border-border bg-bg-input/20 px-4 py-3 space-y-2 text-xs font-bold">
                    <FilterGroup label="Weapon" options={[{ key: 'melee', label: 'Melee' }, { key: 'ranged', label: 'Ranged' }]} selected={kindFilter} onChange={setKindFilter} />
                    <FilterGroup label="Best at" options={TAG_FILTERS} selected={tagFilter} onChange={setTagFilter} />
                    <FilterGroup label="Fairy" options={fairyOptions} selected={fairyFilter} onChange={setFairyFilter} />
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-text-muted w-20 shrink-0">Sort by</span>
                        {SORTS.filter(x => x.key !== 'arena' || tournament).map(x => (
                            <button key={x.key} onClick={() => setSortBy(x.key)} className={cn('px-3 py-1.5 rounded-xl border', sortBy === x.key ? 'border-amber-400 bg-amber-400/15 text-amber-200' : 'border-border text-text-secondary hover:bg-bg-input')}>{x.label}</button>
                        ))}
                        <span className="text-text-muted font-normal ml-2">{ordered.length} of {listed?.builds.length ?? 0} builds</span>
                    </div>
                </div>
            )}
            {valid && ready && (
                // items-start: opening one card's details grows that card only.
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 items-start">
                    {ordered.map(b => (
                        <BuildCard key={b.preset.key} {...cardFor(b.preset)} rank={rankOf.get(b.preset.key) ?? null} runnersUp={noRunnersUp} cardFor={cardFor} tags={b.tags} />
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
