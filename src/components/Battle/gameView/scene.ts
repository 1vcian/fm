/**
 * The battle drawn like the game: the mode's map tiles on its ground colour, every unit as the
 * composed UnitView rig (helmet, armour and weapon prefabs, skin overrides, mount underneath,
 * pets and fairy following), the weapon / skill projectile prefabs, the skill view prefabs with
 * their particle systems, the game's damage labels and HP bars, and the game camera.
 *
 * Driven only by the engine snapshot (SceneVisuals): positions, facing, the attack timer, areas,
 * shots and hit events. Nothing here feeds back into the combat.
 */
import type { SceneVisuals, VisualUnit, VisualHit, VisualEffect, VisualShot } from '../../../engine/visualSnapshot';
import { HIT_VISIBLE_SECONDS } from '../../../engine/visualSnapshot';
import type { UserProfile } from '../../../types/Profile';
import { formatNumber } from '../../../utils/format';
import type { BattleVisualData, ItemVisual, TextureCache, ParticleDef } from './visualData';
import { RigInstance, rigItems, sortItems, trs, mul, layerIndex, type DrawItem, type Mat, IDENTITY } from './rig';
import { Emitter, tintTexture } from './particles';

export type SceneMode =
    | { kind: 'main'; ageIdx: number }
    | { kind: 'dungeon'; dungeon: 'hammer' | 'skill' | 'egg' | 'potion' }
    | { kind: 'mission'; mapAge: number }
    | { kind: 'pvp' };

/** What one side wears: resolved visual config names and prefabs. */
export interface Look {
    helmet?: ItemVisual | null;
    armour?: ItemVisual | null;
    weapon?: ItemVisual | null;
    /** Skin prefabs replacing the item prefab (same attach points). */
    helmetPrefab?: string | null;
    armourPrefab?: string | null;
    weaponPrefab?: string | null;
    weaponSecondaryPrefab?: string | null;
    mount?: string | null;
    pets?: string[];
    fairy?: string | null;
    /** BodyParts the shown helmet, armour and weapon turn off (ItemVisual.turnOff, merged). */
    turnOff?: number[];
}

const ITEM_TYPE = { Helmet: 0, Armour: 1, Weapon: 5 } as const;

function visualFor(data: BattleVisualData, age: number, type: number, idx: number): ItemVisual | null {
    if (age === 10000) return data.visuals[data.defaultWeapon] ?? null;
    const name = data.ages[age]?.items[String(type)]?.[idx];
    return name ? data.visuals[name] ?? null : null;
}

function skinVisual(data: BattleVisualData, type: number, skinIdx: number | undefined, ranged: boolean): ItemVisual | null {
    if (skinIdx === undefined || skinIdx === null) return null;
    const s = data.skins.find(k => k.itemType === type && k.skinVisualId === skinIdx);
    if (!s) return null;
    const name = ranged && s.secondary ? s.secondary : s.main;
    return name ? data.visuals[name] ?? null : null;
}

function skinPrefab(data: BattleVisualData, type: number, skinIdx: number | undefined, ranged: boolean): string | null {
    return skinVisual(data, type, skinIdx, ranged)?.prefab ?? null;
}

/** The body parts the shown visuals turn off: each slot's skin when one is shown, else its item. */
function turnOffOf(shown: (ItemVisual | null | undefined)[]): number[] {
    return [...new Set(shown.flatMap(v => v?.turnOff ?? []))];
}

/** The look of a bare character wearing the given skins (Skin Idx per slot), default weapon below. */
export function lookFromSkins(data: BattleVisualData, skins: { helmet?: number; armour?: number; weapon?: number }): Look {
    const h = skinVisual(data, ITEM_TYPE.Helmet, skins.helmet, false);
    const a = skinVisual(data, ITEM_TYPE.Armour, skins.armour, false);
    const w = skinVisual(data, ITEM_TYPE.Weapon, skins.weapon, false);
    return {
        // A weapon skin is a whole weapon visual (its secondary part, controller and projectile too).
        weapon: w ?? data.visuals[data.defaultWeapon],
        helmetPrefab: h?.prefab ?? null,
        armourPrefab: a?.prefab ?? null,
        turnOff: turnOffOf([h, a, w]),
    };
}

/** A profile's look: equipped helmet / armour / weapon with skins, mount, pets and fairy. */
export function lookFromProfile(data: BattleVisualData, profile: UserProfile | null | undefined, opts?: { weaponRanged?: boolean; noCompanions?: boolean }): Look {
    if (!profile) return { weapon: data.visuals[data.defaultWeapon] };
    const it = profile.items;
    const look: Look = {};
    // A hidden skin (the game's per-type SkinVisibility) shows the item underneath.
    const shown = (visible: boolean | undefined, idx: number | undefined) => (visible === false ? undefined : idx);
    if (it.Helmet) {
        look.helmet = visualFor(data, it.Helmet.age, ITEM_TYPE.Helmet, it.Helmet.idx);
        look.helmetPrefab = skinPrefab(data, ITEM_TYPE.Helmet, shown(profile.misc?.skinVisible?.Helmet, it.Helmet.skin?.idx), false);
    }
    if (it.Body) {
        look.armour = visualFor(data, it.Body.age, ITEM_TYPE.Armour, it.Body.idx);
        look.armourPrefab = skinPrefab(data, ITEM_TYPE.Armour, shown(profile.misc?.skinVisible?.Body, it.Body.skin?.idx), false);
    }
    if (it.Weapon) {
        // A shown weapon skin replaces the whole weapon visual, not only its main prefab: its
        // secondary part, animation controller and projectile come with it (the Santa sack is the
        // skin's secondary part over an empty main prefab; the Cat paw runs CatPaw_controller).
        // Which variant shows follows the weapon underneath: -1001 for a ranged one (GetSkinnedItemId).
        look.weapon = skinVisual(data, ITEM_TYPE.Weapon, shown(profile.misc?.useSkinWindup, it.Weapon.skin?.idx), !!opts?.weaponRanged)
            ?? visualFor(data, it.Weapon.age, ITEM_TYPE.Weapon, it.Weapon.idx);
    } else {
        look.weapon = data.visuals[data.defaultWeapon];
    }
    look.turnOff = turnOffOf([
        it.Helmet ? skinVisual(data, ITEM_TYPE.Helmet, shown(profile.misc?.skinVisible?.Helmet, it.Helmet.skin?.idx), false) ?? look.helmet : null,
        it.Body ? skinVisual(data, ITEM_TYPE.Armour, shown(profile.misc?.skinVisible?.Body, it.Body.skin?.idx), false) ?? look.armour : null,
        it.Weapon ? skinVisual(data, ITEM_TYPE.Weapon, shown(profile.misc?.useSkinWindup, it.Weapon.skin?.idx), !!opts?.weaponRanged) ?? look.weapon : null,
    ]);
    if (opts?.noCompanions) return look;
    const asc = (n?: number) => Math.max(0, Math.min(3, n ?? 0));
    const m = profile.mount?.active;
    if (m) look.mount = data.mounts[m.rarity]?.[m.id]?.prefabs[asc(m.ascensionLevel ?? profile.misc?.mountAscensionLevel)] ?? null;
    look.pets = (profile.pets?.active ?? [])
        .map(p => data.pets[p.rarity]?.[p.id]?.prefabs[asc(p.ascensionLevel ?? profile.misc?.petAscensionLevel)])
        .filter((p): p is string => !!p);
    const fairy = profile.misc?.fairy?.name;
    if (fairy && data.prefabs[`${fairy}Fairy`]) look.fairy = `${fairy}Fairy`;
    return look;
}

/** Enemy look from its tag / weapon key (EnemyLibrary row, mission rolls). */
export function lookFromEnemy(data: BattleVisualData, u: VisualUnit, enemyLibrary: Record<string, any> | undefined): Look {
    const look: Look = {};
    const parseKey = (k?: string) => {
        const p = k?.split('_').map(Number);
        return p && p.length === 3 && p.every(Number.isFinite) ? p : null;
    };
    const w = parseKey(u.weaponSpriteKey);
    look.weapon = w ? visualFor(data, w[0], ITEM_TYPE.Weapon, w[2]) : data.visuals[data.defaultWeapon];
    const id = u.tag?.startsWith('enemy:') ? u.tag.slice(6) : null;
    const row = id ? enemyLibrary?.[id] : undefined;
    if (row?.HelmetId) look.helmet = visualFor(data, row.HelmetId.Age, ITEM_TYPE.Helmet, row.HelmetId.Idx);
    if (row?.ArmourId) look.armour = visualFor(data, row.ArmourId.Age, ITEM_TYPE.Armour, row.ArmourId.Idx);
    const h = parseKey(u.cosmeticKeys?.helmet);
    const a = parseKey(u.cosmeticKeys?.armour);
    if (h) look.helmet = visualFor(data, h[0], ITEM_TYPE.Helmet, h[2]);
    if (a) look.armour = visualFor(data, a[0], ITEM_TYPE.Armour, a[2]);
    return look;
}

// ---------------------------------------------------------------- units

export interface UnitView {
    rig: RigInstance;
    kind: 'unit' | 'thief' | 'drone';
    controller: Record<string, string> | null;
    charRig: number;
    hpBar: number;
    unitShadow: number;
    handPrimary: number;
    aiming: boolean;
    projectile: string | null;
    /** The shown weapon prefab's WeaponEquipmentItem.WeaponData (windup, range, hand and muzzle offsets). */
    weaponData: any;
    mount: RigInstance | null;
    mountOffset: [number, number];
    mountClip: string | null;
    pets: { rig: RigInstance; slot: number; x: number; y: number; clip: string | null }[];
    fairy: { rig: RigInstance; clip: string | null; x: number; y: number; hover: number; speed: number; emitters?: Emitter[] } | null;
    prevX: number; prevY: number; x: number; y: number;
    /** Facing of the last frame drawn. */
    sign: number;
    tick: number;
    fill: number; prefill: number; prefillFrom: number; prefillT: number;
    seen: number;
    deathDone: boolean;
}

/** A buff skill's view on its owner: from `start`, until `end` plus the view's own tail. */
interface BuffView { rig: RigInstance | null; skillId: string; ownerId: number; emitters: { em: Emitter; node: number }[]; start: number; end: number | null }

/** Seconds a buff view outlives its buff: the closing tween or the wait before Destroy (see drawBuff). */
const BUFF_TAIL: Record<string, number> = { Meat: 0.4, Morale: 0, Berserk: 1.2, Buff: 0.4, HigherMorale: 2.4 };

const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

/** The opening (0.2 s) and closing (0.4 s) scale tweens the buff views share, 0..1. */
function buffOpen(bv: BuffView, now: number): number {
    if (bv.end !== null) return 1 - outQuad(Math.max(0, Math.min(1, (now - bv.end) / 0.4)));
    return outQuad(Math.max(0, Math.min(1, (now - bv.start) / 0.2)));
}

/** DOTween InBack (overshoot 1.70158). */
const inBack = (k: number) => 2.70158 * k * k * k - 1.70158 * k * k;

/**
 * How long a skill view plays from its spawn when it outlives the engine's area: Thorns runs its
 * spike sequence (3.2 pulses + 0.4 s + up to 0.35 s), Worm its DestroyTime, StrafeRun its flight.
 * 0: the view goes with the area.
 */
function areaViewSeconds(av: AreaView): number {
    if (av.skillId === 'Worm') return av.rig.nodes[0].mb?.WormSkillView?.DestroyTime ?? 4;
    if (av.skillId === 'Thorns') { const p = av.last.pulseDuration > 0 ? av.last.pulseDuration : 0.5; return 3.2 * p + 0.4 + 0.35; }
    if (av.skillId === 'StrafeRun') {
        const sr = strafePaths(av.rig, av.last.isAllied);
        return (sr.l0 + sr.l1 + sr.l2) / (15 / (av.last.duration > 0 ? av.last.duration : 1));
    }
    return 0;
}

/** StrafeRunView's three paths (see animateStrafeRun): point and tangent at a distance flown. */
function strafePaths(rig: RigInstance, ally: boolean) {
    const dir = rig.nodes[0].mb?.StrafeRunView?.Dir ?? { x: -1, y: 1 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const n = { x: dir.x / len, y: dir.y / len };
    const d = { x: ally ? n.x : -n.x, y: n.y };
    const a0 = { x: 30 * d.x, y: 30 * d.y }, a1 = { x: 15 * d.x, y: 15 * d.y };
    const c = { x: 0, y: 0 }, b2 = { x: -20 * d.x, y: 10 * n.y }, e2 = { x: -40 * d.x, y: 20 * n.y };
    const bez = (u: number) => ({
        x: (1 - u) * (1 - u) * a1.x + 2 * (1 - u) * u * c.x + u * u * b2.x,
        y: (1 - u) * (1 - u) * a1.y + 2 * (1 - u) * u * c.y + u * u * b2.y,
    });
    let l1 = 0;
    for (let k = 0, prev = bez(0); k < 64; k++) { const q = bez((k + 1) / 64); l1 += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
    const l0 = Math.hypot(a1.x - a0.x, a1.y - a0.y), l2 = Math.hypot(e2.x - b2.x, e2.y - b2.y);
    const at = (dist: number) => {
        if (dist < l0) { const u = dist / l0; return { x: a0.x + (a1.x - a0.x) * u, y: a0.y + (a1.y - a0.y) * u, tx: a1.x - a0.x, ty: a1.y - a0.y }; }
        if (dist < l0 + l1) {
            const u = (dist - l0) / l1;
            const p = bez(u);
            return { ...p, tx: 2 * (1 - u) * (c.x - a1.x) + 2 * u * (b2.x - c.x), ty: 2 * (1 - u) * (c.y - a1.y) + 2 * u * (b2.y - c.y) };
        }
        const u = Math.min(1, (dist - l0 - l1) / l2);
        return { x: b2.x + (e2.x - b2.x) * u, y: b2.y + (e2.y - b2.y) * u, tx: e2.x - b2.x, ty: e2.y - b2.y };
    };
    return { l0, l1, l2, at };
}

/** 2D gradient noise in 0..1, standing in for Mathf.PerlinNoise (same kind of noise, not its exact values). */
function perlin(x: number, y: number): number {
    const grad = (ix: number, iy: number, fx: number, fy: number) => {
        const h = hash01(ix * 374761 + iy * 668265) * Math.PI * 2;
        return Math.cos(h) * fx + Math.sin(h) * fy;
    };
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const s = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const n00 = grad(x0, y0, fx, fy), n10 = grad(x0 + 1, y0, fx - 1, fy);
    const n01 = grad(x0, y0 + 1, fx, fy - 1), n11 = grad(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const u = s(fx), v = s(fy);
    const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
    return Math.max(0, Math.min(1, 0.5 + (nx0 + (nx1 - nx0) * v) * 0.7071));
}

/**
 * A mount with its rider inside: the rider's items (the CharacterRig group) sort in the mount's
 * group at Default / 0, where UnitAnchor puts them, after the mount's own nodes on a tie.
 */
export function mountedItems(mount: RigInstance, tex: TextureCache, riderItems: DrawItem[]): DrawItem[] {
    const sorted = [...riderItems];
    sortItems(sorted);
    const anchor = mount.find('UnitOffset');
    return rigItems(mount, tex, undefined, undefined, undefined, {
        parent: anchor >= 0 ? anchor : 0, layer: 0, order: 0,
        draw: c => { for (const it of sorted) it.draw(c); },
    });
}

/** DroneView's closing flight: DOVirtual.Float over 2 seconds. */
const DRONE_EXIT_SECONDS = 2;

/** UnitConstants.CenterOfMass, the engine's default unit centre (engine/scene.ts): where a death effect plays. */
export const DEATH_EFFECT_OFFSET = { x: 0, y: 0.45 };

function controllerClips(data: BattleVisualData, name: string | null | undefined): Record<string, string> | null {
    if (!name) return null;
    return data.controllers[name]?.clips ?? null;
}

/** The single looping clip of a prefab's own Animator (pets, mounts, fairies). */
function ownClip(data: BattleVisualData, rig: RigInstance): string | null {
    const n = rig.nodes.findIndex(nd => nd.anim);
    if (n < 0) return null;
    rig.setAnimRoot(n);
    const clips = controllerClips(data, rig.nodes[n].anim);
    const first = clips ? Object.values(clips)[0] : null;
    return first ?? null;
}

export function buildUnit(data: BattleVisualData, look: Look, kind: UnitView['kind']): UnitView {
    const prefab = kind === 'thief' ? 'ThiefView' : kind === 'drone' ? 'DroneView' : 'UnitView';
    const rig = new RigInstance(data, prefab);
    let charRig = rig.find(kind === 'drone' ? 'Drone' : 'CharacterRig');
    let controller: Record<string, string> | null = null;
    let aiming = false;
    let projectile: string | null = null;
    let weaponData: any = null;
    if (kind === 'unit') {
        const head = rig.find('Head');
        const body = rig.find('Body');
        const wp = rig.find('[SCALE] Weapon-Primary');
        const ws = rig.find('[SCALE] Weapon-Secondary');
        const helmet = look.helmetPrefab ?? look.helmet?.prefab;
        if (helmet) {
            rig.append(helmet, head);
            if (look.helmet?.hideBodyPart && !look.helmetPrefab) rig.nodes[head].srOff = 1;
        }
        const armour = look.armourPrefab ?? look.armour?.prefab;
        if (armour) {
            rig.append(armour, body);
            if (look.armour?.hideBodyPart && !look.armourPrefab) rig.nodes[body].srOff = 1;
        }
        const w = look.weapon ?? data.visuals[data.defaultWeapon];
        const main = look.weaponPrefab ?? w?.prefab;
        if (main) {
            const root = rig.append(main, wp);
            aiming = !!rig.nodes[root]?.mb?.WeaponEquipmentItem?.IsAiming;
            weaponData = rig.nodes[root]?.mb?.WeaponEquipmentItem?.WeaponData ?? null;
            if (w?.dualWield) rig.append(main, ws);
        }
        if (w?.hasSecondary && w.secondary) rig.append(w.secondary, ws);
        projectile = w?.hasProjectile ? w.projectile ?? null : null;
        controller = controllerClips(data, w?.controller);
    } else {
        controller = controllerClips(data, rig.nodes[charRig]?.anim ?? null);
    }
    // BodyPartsToTurnOff: CharacterRig.GetBodyPartRenderers (0x4042598) maps Head to
    // SpriteRenderers[0], Body to [1], Hand to [2] and [3]; the extractor stores those as node
    // indices (bodyPartNodes) on the CharacterRig node.
    if (kind === 'unit' && look.turnOff?.length && charRig >= 0) {
        const parts: number[] = (rig.nodes[charRig] as any).bodyPartNodes ?? [];
        const byPart: Record<number, number[]> = { 0: [parts[0]], 1: [parts[1]], 2: [parts[2], parts[3]] };
        for (const bp of look.turnOff) for (const n of byPart[bp] ?? []) if (n !== undefined && n >= 0 && rig.nodes[n]) rig.nodes[n].srOff = 1;
    }
    if (charRig < 0) charRig = 0;
    rig.setAnimRoot(charRig);
    const mount = look.mount && data.prefabs[look.mount] ? new RigInstance(data, look.mount) : null;
    let mountOffset: [number, number] = [0, 0];
    let mountClip: string | null = null;
    if (mount) {
        const uo = mount.find('UnitOffset');
        if (uo >= 0) mountOffset = [mount.nodes[uo].m[4], mount.nodes[uo].m[5]];
        mountClip = ownClip(data, mount);
    }
    const pets = (look.pets ?? []).map((p, slot) => {
        const r = new RigInstance(data, p);
        return { rig: r, slot, x: NaN, y: NaN, clip: ownClip(data, r) };
    });
    let fairy: UnitView['fairy'] = null;
    if (look.fairy) {
        const r = new RigInstance(data, look.fairy);
        const fm = r.nodes[0].mb?.FairyMovementBehaviour;
        const sc = Math.hypot(r.nodes[0].m[0], r.nodes[0].m[1]);
        fairy = {
            rig: r, clip: ownClip(data, r), x: NaN, y: NaN,
            // _minHoverY / _maxHoverY are in the fairy's own (scaled) space.
            hover: fm ? ((fm._minHoverY + fm._maxHoverY) / 2) * sc : 3,
            speed: fm?._hoverSpeed ?? 1,
        };
    }
    return {
        rig, kind, controller, charRig, aiming, projectile, weaponData,
        hpBar: rig.find('HpBar'),
        ...(kind === 'thief' ? (() => { const dc = rig.find('Destroyed Cart'); if (dc >= 0) rig.nodes[dc].hidden = true; return {}; })() : {}),
        unitShadow: kind === 'unit' ? rig.find('Shadow') : -1,
        handPrimary: rig.find('[ROT] Hand-Primary'),
        mount, mountOffset, mountClip, pets, fairy,
        prevX: NaN, prevY: NaN, x: NaN, y: NaN, sign: 1, tick: -1,
        fill: 1, prefill: 1, prefillFrom: 1, prefillT: 1, seen: 0, deathDone: false,
    };
}

// ---------------------------------------------------------------- damage labels

/** NumberFormat.FormatDamage as shown in the game: 3 significant digits, lowercase suffix. */
export function formatDamage(n: number): string {
    const s = formatNumber(n);
    return s.replace(/(K|M|B|T)$/, c => c.toLowerCase());
}

function hash01(n: number): number {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- the scene

export interface SceneInputs {
    data: BattleVisualData;
    tex: TextureCache;
    mode: SceneMode;
    allyLook: Look;
    /** PvP: Player 2's look; PvE enemies are resolved from their tags. */
    enemyLook?: Look;
    enemyLibrary?: Record<string, any>;
    skillAscension: { ally: number; enemy: number };
    seed: number;
}

interface AreaView {
    rig: RigInstance;
    skillId: string;
    born: number;
    emitters: Emitter[];
    /** The node each emitter belongs to, so it follows the node when the view moves. */
    nodeOf: Map<ParticleDef, number>;
    exploded: boolean;
    lastPulse: number | null;
    clip: string | null;
    /** The effect as last seen; a view outliving it keeps running on its own clock. */
    last: VisualEffect;
    /** Battle time the engine's effect ended, while the view still plays. */
    goneAt: number | null;
}

export class BattleSceneRenderer {
    private units = new Map<number, UnitView>();
    private areas = new Map<number, AreaView>();
    private shots = new Map<number, RigInstance | null>();
    private buffViews = new Map<string, BuffView>();
    /** Where each side's player is drawn this frame (interpolated), for views that follow it. */
    private playerAt: { ally?: { x: number; y: number }; enemy?: { x: number; y: number } } = {};
    private afterglows: { rig: RigInstance; node: number; t: number; dur: number }[] = [];
    /** Drones whose duration ran out, flying off (DroneView's closing tween). */
    /** How far between the last two engine ticks this frame is (0..1). */
    private tickAlpha = 1;
    private leaving: { uv: UnitView; x: number; y: number; sign: number; t: number }[] = [];
    private emitters: Emitter[] = [];
    private maps: { rig: RigInstance; x: number }[] = [];
    private ground: number[] = [0, 0, 0, 1];
    private laneY = 0;
    private camX = NaN;
    private camFrom = 0;
    private camTo = 0;
    private camT = 1;
    private lastWaveKey = '';
    private lastTick = -1;
    private tickWall = 0;
    /** Battle seconds rendered (interpolated between engine ticks). */
    private battleTime = 0;
    private wall = 0;

    constructor(private readonly inp: SceneInputs) {
        const { data, mode } = inp;
        let cfg = data.pvpMaps.ArenaPvpMap;
        // MainBattleMapSystem.Execute 0x401CB1C: AgeConfigs[age - (age > 0 ? 1 : 0)] for the battle's age
        // (so stage 7-x, AgeIdx 6, is drawn on the Interstellar map, as in the game).
        if (mode.kind === 'main') cfg = data.ages[Math.max(0, Math.min(data.ages.length - 1, mode.ageIdx - (mode.ageIdx > 0 ? 1 : 0)))] ?? cfg;
        else if (mode.kind === 'dungeon') cfg = data.dungeons[{ hammer: '0', skill: '1', egg: '2', potion: '3' }[mode.dungeon]] ?? cfg;
        // MissionBattleMapSystem.Execute 0x401D11C: the mission row's MapAge picks the age config.
        else if (mode.kind === 'mission') cfg = data.ages[Math.max(0, Math.min(data.ages.length - 1, mode.mapAge))] ?? cfg;
        this.ground = cfg.ground;
        // MainBattleMapSystem.Execute 0x401CB1C: tiles at x = -24, 0, 24, 48, 72, each a random
        // MapElementView of the list. PvP arenas use the same builder with their own list.
        let s = inp.seed >>> 0 || 1;
        const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
        if (mode.kind === 'mission') {
            // Missions place MapElementViews[0] once, at (0, 0).
            const name = cfg.maps[0];
            if (name && data.prefabs[name]) this.maps.push({ rig: new RigInstance(data, name), x: 0 });
        } else for (let x = -24; x < 96; x += 24) {
            const name = cfg.maps[next() % Math.max(1, cfg.maps.length)];
            if (name && data.prefabs[name]) this.maps.push({ rig: new RigInstance(data, name), x });
        }
        const road = this.maps[0]?.rig.nodes.find(n => n.n.startsWith('RoadPiece'));
        if (road) this.laneY = road.m[5];
    }

    get groundColor(): string {
        const g = this.ground;
        return `rgb(${Math.round(g[0] * 255)},${Math.round(g[1] * 255)},${Math.round(g[2] * 255)})`;
    }

    private unitView(u: VisualUnit): UnitView {
        let v = this.units.get(u.id);
        if (!v) {
            const { data } = this.inp;
            let look: Look;
            let kind: UnitView['kind'] = 'unit';
            if (u.isSummon && (u.skillId === 'Drone' || u.tag === 'Drone')) { kind = 'drone'; look = {}; }
            else if (u.tag === 'enemy:hammerThief') { kind = 'thief'; look = {}; }
            else if (u.isAlly) look = u.isPlayer || this.inp.mode.kind !== 'mission' ? this.inp.allyLook : this.inp.allyLook;
            else look = this.inp.enemyLook && this.inp.mode.kind === 'pvp' ? this.inp.enemyLook : lookFromEnemy(data, u, this.inp.enemyLibrary);
            if (kind === 'unit' && !u.isPlayer && this.inp.mode.kind !== 'pvp') look = { ...look, mount: null, pets: [], fairy: null };
            v = buildUnit(data, look, kind);
            // UnitSkinColorView.Setup 0x4024BD4: enemies of Ghost Town take DefaultColors.Ghost on
            // skin and body, Zombie Rush enemies ZombieSkin / ZombieBody.
            const dc = this.inp.mode.kind === 'dungeon' && !u.isAlly && kind === 'unit'
                ? data.constants.dungeonEnemyColors?.[{ hammer: '0', skill: '1', egg: '2', potion: '3' }[this.inp.mode.dungeon]] : undefined;
            if (dc) {
                for (const nd of v.rig.nodes) {
                    if (nd.n === 'Body' && nd.s === 'Body') nd.c = dc.body;
                    else if ((nd.n === 'Head' && nd.s === 'Head') || nd.s === 'Hand') nd.c = dc.skin;
                }
            }
            this.units.set(u.id, v);
        }
        return v;
    }

    private skillPrefab(kind: 'projectiles' | 'animations', skillId: string, ally: boolean): string | null {
        const { data } = this.inp;
        const id = data.skillIds[skillId];
        const list = id === undefined ? undefined : data.skills[String(id)]?.[kind];
        if (!list || list.length === 0) return null;
        const asc = ally ? this.inp.skillAscension.ally : this.inp.skillAscension.enemy;
        return list[Math.max(0, Math.min(list.length - 1, asc))] ?? list[0];
    }

    private spawnEmitters(rig: RigInstance, filter: (path: string) => boolean, once: boolean): Emitter[] {
        const out: Emitter[] = [];
        rig.nodes.forEach((nd, i) => {
            if (!nd.ps || !filter(nd.path) || !rig.isVisible(i)) return;
            const ps = nd.ps as ParticleDef;
            out.push(new Emitter(ps, rig.world[i] ?? IDENTITY, ps.renderer?.order ?? 0, layerIndex(this.inp.data, ps.renderer?.layer), once));
        });
        return out;
    }

    /**
     * Draw one frame. `speed` is the playback speed (engine seconds per wall second), used to
     * interpolate between the 0.1 s engine ticks.
     */
    render(ctx: CanvasRenderingContext2D, w: number, h: number, v: SceneVisuals, nowMs: number, speed: number, playing: boolean): void {
        const { data, tex } = this.inp;
        const dtWall = this.wall ? Math.min(0.1, (nowMs - this.wall) / 1000) : 0;
        this.wall = nowMs;
        const dt = playing ? dtWall * speed : 0;
        if (v.tick !== this.lastTick) {
            // Seeking back: drones flying off belong to a moment that has not happened yet.
            if (v.tick < this.lastTick) this.leaving = [];
            this.lastTick = v.tick;
            this.tickWall = nowMs;
        }
        const alpha = playing ? Math.max(0, Math.min(1, ((nowMs - this.tickWall) / 1000) * speed / 0.1)) : 1;
        this.tickAlpha = alpha;
        this.battleTime = (v.tick + (playing ? alpha : 0)) * 0.1;

        // ---------- camera (MainBattleSystem.UpdateCam / ForceCam; PvP CombatCenter (9, 0))
        const C = data.constants;
        const viewW = 2 * C.cameraOrthoSize * (C.referenceResolution[0] / C.referenceResolution[1]);
        const S = w / viewW;
        const player = v.units.find(u => u.isAlly && u.isPlayer) ?? v.units.find(u => u.isAlly && !u.isSummon);
        let target = this.camTo;
        // Missions: MissionCombatScene.SetupEnemies 0x780E7D0 sets CombatCenter = (Ratio10(75), 0) =
        // (7.5, 0) and MissionBattleSyncSystem.UpdateCam 0x3EC6698 forces the camera there.
        const center = (px: number) => this.inp.mode.kind === 'mission' ? C.missionCombatCenterX : px + C.combatCenterOffsetX;
        if (this.inp.mode.kind === 'pvp') target = 9;
        else if (Number.isNaN(this.camX)) {
            // ForceCam (MainBattleSystem 0x401A8A4 / DungeonBattleSystem 0x40311A8): Vector2.right * 5.
            target = this.inp.mode.kind === 'mission' ? center(player?.x ?? 0) : C.forceCamX;
        }
        if (player && this.inp.mode.kind !== 'pvp') {
            const enemies = v.units.filter(u => !u.isAlly && !u.isSummon);
            const waveKey = String(enemies.map(e => e.id).sort((a, b) => a - b)[0] ?? '');
            if (waveKey !== this.lastWaveKey && enemies.length) {
                this.lastWaveKey = waveKey;
                // UpdateCam on the wave's BattleState: AnimatePosition(CombatCenter), where
                // SetupEnemies set CombatCenter = player X + 15 / 2 (missions: midway to X = 15).
                target = center(player.x);
            }
        }
        if (Number.isNaN(this.camX)) { this.camX = target; this.camFrom = target; this.camTo = target; this.camT = 1; }
        if (target !== this.camTo) { this.camFrom = this.camX; this.camTo = target; this.camT = 0; }
        if (this.camT < 1) {
            this.camT = Math.min(1, this.camT + dt / C.cameraTweenSeconds);
            const e = -(Math.cos(Math.PI * this.camT) - 1) / 2; // InOutSine
            this.camX = this.camFrom + (this.camTo - this.camFrom) * e;
        }
        const camX = this.camX;
        // CombatCenter.y is 0; the view is centred on the lane (the map's road row) so the units sit
        // mid-canvas, as they sit mid-battlefield above the game's bottom panel.
        const camY = this.laneY;
        const viewH = h / S;

        // ---------- background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.groundColor;
        ctx.fillRect(0, 0, w, h);
        ctx.setTransform(S, 0, 0, -S, w / 2 - S * camX, h / 2 + S * camY);

        const items: DrawItem[] = [];
        let seq = 0;
        const push = (list: DrawItem[]) => { for (const it of list) { it.seq = seq++; items.push(it); } };

        for (const m of this.maps) {
            m.rig.update([1, 0, 0, 1, m.x, 0]);
            if (m.x - 4 > camX + viewW / 2 + 30 || m.x + 30 < camX - viewW / 2 - 4) continue;
            push(rigItems(m.rig, tex));
        }

        // ---------- units
        const alive = new Set<number>();
        for (const u of v.units) {
            const uv = this.unitView(u);
            alive.add(u.id);
            if (uv.tick !== v.tick) {
                uv.prevX = Number.isNaN(uv.x) ? u.x : uv.x;
                uv.prevY = Number.isNaN(uv.y) ? u.y : uv.y;
                uv.x = u.x;
                uv.y = u.y;
                uv.tick = v.tick;
            }
            const x = uv.prevX + (uv.x - uv.prevX) * alpha;
            const y = uv.prevY + (uv.y - uv.prevY) * alpha;
            if (u.killed) {
                if (!uv.deathDone) {
                    uv.deathDone = true;
                    if (uv.kind === 'thief') {
                        // ThiefView: the cart breaks, spilling coins and hammers.
                        const dc = uv.rig.find('Destroyed Cart');
                        if (dc >= 0) uv.rig.nodes[dc].hidden = false;
                        uv.rig.update([1, 0, 0, 1, x, y]);
                        this.emitters.push(...this.spawnEmitters(uv.rig, p => p.startsWith('Destroyed Cart'), true));
                    }
                    // UnitDeathEffectsView.PlayDeathEffect 0x4043FE4: both systems (DeathEffect, the
                    // pop, and GroundSplatter) move to the unit's position plus _offset, which Setup
                    // 0x4043E64 reads from UnitConstants.CenterOfMass, and Emit(1) each.
                    const fx = new RigInstance(data, 'UnitDeathEffectsView');
                    fx.update([1, 0, 0, 1, x + DEATH_EFFECT_OFFSET.x, y + DEATH_EFFECT_OFFSET.y]);
                    const pop = this.spawnEmitters(fx, () => true, true);
                    for (const em of pop) em.burst(1);
                    this.emitters.push(...pop);
                }
                continue;
            }
            const sign = uv.kind === 'thief' ? 1 : u.sign;
            uv.sign = sign;
            // BuffSkillView scales the whole UnitView (mount included) while it lasts.
            const grow = u.isPlayer ? this.buffScale(u.isAlly) : 1;
            const root: Mat = [sign * grow, 0, 0, grow, x, y];
            if (u.isPlayer) this.playerAt[u.isAlly ? 'ally' : 'enemy'] = { x, y };
            const rig = uv.rig;
            rig.clearAnimation();
            // UnitAnimationView: idle loops the "Walk" state's clip; an attack plays "Attack" on the
            // single attack timer (windup then cooldown), whose clip lasts AttackDuration.
            if (uv.controller) {
                const attacking = u.state !== 'idle';
                const clipName = attacking ? uv.controller.Attack : uv.controller.Walk;
                const clip = clipName ? data.clips[clipName] : undefined;
                const t = attacking ? u.attackTime + (playing ? alpha * u.attackStep : 0) : this.battleTime;
                rig.applyClip(clip, t, !attacking);
            }
            if (uv.aiming && uv.handPrimary >= 0 && (u.lookX || u.lookY)) {
                rig.addRotation(uv.handPrimary, (Math.atan2(u.lookY, Math.abs(u.lookX) || 1e-6) * 180) / Math.PI);
            }
            if (uv.mount) {
                rig.setLocalPosition(uv.charRig, uv.mountOffset[0], uv.mountOffset[1]);
                if (uv.unitShadow >= 0) rig.nodes[uv.unitShadow].hidden = true;
            }
            rig.update(root);
            // HP bar: HpBarView, shown once damaged (SetHp 0x4018A44: hp < hpMax or AlwaysDisplayed,
            // with no mode check, so PvP fighters show it too); the white prefill follows in 0.3 s.
            const fill = u.hpMax > 0 ? Math.max(0, Math.min(1, u.hp / u.hpMax)) : 0;
            if (fill !== uv.fill) {
                uv.prefillFrom = uv.prefill;
                uv.prefillT = fill < uv.fill ? 0 : 1;
                uv.fill = fill;
                if (uv.prefillT === 1) uv.prefill = fill;
            }
            if (uv.prefillT < 1) {
                uv.prefillT = Math.min(1, uv.prefillT + dt / 0.3);
                uv.prefill = uv.prefillFrom + (uv.fill - uv.prefillFrom) * uv.prefillT;
            }
            const custom = new Map<number, (c: CanvasRenderingContext2D, m: Mat) => void>();
            const showBar = uv.kind !== 'drone' && fill < 1 && uv.hpBar >= 0;
            const skip = (i: number) => i === uv.hpBar;
            const unitItems = rigItems(rig, tex, undefined, skip, custom);
            if (uv.mount) {
                uv.mount.clearAnimation();
                if (uv.mountClip) uv.mount.applyClip(data.clips[uv.mountClip], this.battleTime, true);
                uv.mount.update(root);
                // UnitRotationView.Update 0x3F1DDF8 parents the CharacterRig under the mount's
                // UnitAnchor: the rider (its SortingGroup, order 0) sorts among the mount's own
                // renderers, so parts with a higher order (a bee's near wing, the crab) cover it.
                const all = mountedItems(uv.mount, tex, unitItems);
                push([{ layer: 1, order: 0, y, seq: 0, draw: c => { for (const it of all) it.draw(c); } }]);
            } else push(unitItems);
            if (showBar) {
                const hb = rig.nodes[uv.hpBar];
                const m = rig.world[uv.hpBar];
                const mat = hb.mat;
                push([{ layer: 3, order: hb.o ?? 100, y: -1e9, seq: 0, draw: c => drawHpBar(c, m, uv.fill, uv.prefill, mat) }]);
            }
            // pets: PetVisual.PetOffsets per slot, behind the owner; they catch up at MaxSpeed.
            for (const p of uv.pets) {
                const offs = p.rig.nodes[0].mb?.PetVisual?.PetOffsets?.[p.slot] ?? { x: -1.5, y: 0 };
                const tx = x + offs.x * sign, ty = y + offs.y;
                if (Number.isNaN(p.x)) { p.x = tx; p.y = ty; }
                const mv = p.rig.nodes[0].mb?.PetMovementBehaviour;
                const sp = (mv?.MaxSpeed ?? 1.5) * Math.max(1, Math.hypot(tx - p.x, ty - p.y));
                const d = Math.hypot(tx - p.x, ty - p.y);
                if (d > 1e-3) { const k = Math.min(1, (sp * dt) / d); p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; }
                p.rig.clearAnimation();
                if (p.clip) p.rig.applyClip(data.clips[p.clip], this.battleTime, true);
                p.rig.update([sign, 0, 0, 1, p.x, p.y]);
                push(rigItems(p.rig, tex));
            }
            if (uv.fairy) {
                const f = uv.fairy;
                const tx = x - 1.0 * sign, ty = y;
                if (Number.isNaN(f.x)) { f.x = tx; f.y = ty; }
                f.x += (tx - f.x) * Math.min(1, dt * 2);
                f.y += (ty - f.y) * Math.min(1, dt * 2);
                f.rig.clearAnimation();
                if (f.clip) f.rig.applyClip(data.clips[f.clip], this.battleTime, true);
                const body = f.rig.find('Body');
                const sc = Math.hypot(f.rig.nodes[0].m[0], f.rig.nodes[0].m[1]) || 1;
                // FairyMovementBehaviour hovers the body between _minHoverY and _maxHoverY (own space).
                if (body >= 0) f.rig.setLocalPosition(body, 0, (f.hover + Math.sin(this.battleTime * f.speed * Math.PI) * 0.5 * sc) / sc);
                f.rig.update([sign, 0, 0, 1, f.x, f.y]);
                push(rigItems(f.rig, tex));
                if (!f.emitters) f.emitters = this.spawnEmitters(f.rig, () => true, false);
                f.rig.nodes.forEach((nd, i) => { if (nd.ps) { const em = f.emitters!.find(e => e.def === nd.ps); if (em) em.origin = f.rig.world[i]; } });
                for (const em of f.emitters) {
                    em.update(dt);
                    const img = em.texture ? tex.get(em.texture) : null;
                    push([{ layer: em.layer, order: em.order, y: f.y, seq: 0, draw: c => em.draw(c, img, tintTexture) }]);
                }
            }
        }
        for (const [id, uv] of [...this.units]) {
            if (alive.has(id)) continue;
            // A drone is not killed: its duration ends and DroneView flies it away.
            if (uv.kind === 'drone' && !uv.deathDone && !Number.isNaN(uv.x)) this.leaving.push({ uv, x: uv.x, y: uv.y, sign: uv.sign, t: 0 });
            this.units.delete(id);
        }
        this.drawLeavingDrones(dt, push);

        // ---------- active buffs: SkillsBattleManager.OnMessage(SkillActivatedMessage) 0x403F154
        // spawns the skill's view on the player's UnitView; each view then places and times itself.
        const liveBuffs = new Set<string>();
        for (const side of ['ally', 'enemy'] as const) {
            const owner = v.units.find(u => u.isPlayer && u.isAlly === (side === 'ally') && !u.killed);
            if (!owner || !this.units.get(owner.id)) continue;
            for (const b of v.buffs[side]) {
                const key = `${side}:${b.skillId}`;
                liveBuffs.add(key);
                const cur = this.buffViews.get(key);
                if (cur && cur.end === null) continue;
                const prefab = this.skillPrefab('animations', b.skillId, side === 'ally');
                const rig = prefab && data.prefabs[prefab] ? new RigInstance(data, prefab) : null;
                this.buffViews.set(key, { rig, skillId: b.skillId, ownerId: owner.id, emitters: [], start: this.battleTime, end: null });
            }
        }
        for (const [key, bv] of [...this.buffViews]) {
            if (!liveBuffs.has(key) && bv.end === null) {
                bv.end = this.battleTime;
                // Berserk and HigherMorale call ParticleSystem.Stop(): live particles finish.
                for (const e of bv.emitters) e.em.stopped = true;
            }
            const ov = this.units.get(bv.ownerId);
            if (!ov || (bv.end !== null && this.battleTime - bv.end >= (BUFF_TAIL[bv.skillId] ?? 0))) { this.buffViews.delete(key); continue; }
            this.drawBuff(bv, ov, dt, push);
        }

        // ---------- skill areas
        const liveAreas = new Set<number>();
        for (const e of v.effects) {
            liveAreas.add(e.id);
            let av = this.areas.get(e.id);
            if (!av) {
                const prefab = this.skillPrefab('animations', e.skillId, e.isAllied);
                if (!prefab || !data.prefabs[prefab]) continue;
                const rig = new RigInstance(data, prefab);
                av = { rig, skillId: e.skillId, born: this.battleTime, emitters: [], nodeOf: new Map(), exploded: false, lastPulse: null, clip: ownClip(data, rig), last: e, goneAt: null };
                this.areas.set(e.id, av);
                rig.update([e.isAllied ? 1 : -1, 0, 0, 1, e.x, e.y]);
                // Every system but the impact (the Explosion and its sub-emitters) plays from the
                // start: rings, rain, smoke, the strafe's impacts, the worm's rocks.
                av.emitters = this.spawnEmitters(rig, p => !/(^|\/)Explosion(\/|$)/.test(p), false);
                rig.nodes.forEach((nd, i) => { if (nd.ps) av!.nodeOf.set(nd.ps as ParticleDef, i); });
            }
            av.last = e;
            this.drawArea(av, e, push, viewH, camY);
        }
        for (const [id, av] of [...this.areas]) {
            if (liveAreas.has(id)) continue;
            // ProjectileBattleManager spawns the view and lets it run its own timers: some outlive
            // the engine's area (areaViewSeconds).
            const life = areaViewSeconds(av);
            if (this.battleTime - av.born < life) {
                if (av.goneAt === null) av.goneAt = this.battleTime;
                this.drawArea(av, { ...av.last, timer: av.last.timer + (this.battleTime - av.goneAt) }, push, viewH, camY);
                continue;
            }
            this.retire(av);
            for (const em of av.emitters) em.stopped = true;
            this.emitters.push(...av.emitters);
            this.areas.delete(id);
        }

        this.afterglows = this.afterglows.filter(a => a.t < a.dur);
        for (const a of this.afterglows) {
            a.t += dt;
            a.rig.nodes[a.node].alpha = Math.max(0, 1 - a.t / a.dur);
            push(rigItems(a.rig, tex));
        }

        // ---------- projectiles
        const liveShots = new Set<number>();
        for (const s of v.shots) {
            liveShots.add(s.id);
            let rig = this.shots.get(s.id);
            if (rig === undefined) {
                let prefab: string | null = null;
                if (s.skillId) prefab = this.skillPrefab('projectiles', s.skillId, s.isAllied);
                else prefab = this.units.get(s.ownerId)?.projectile ?? null;
                rig = prefab && data.prefabs[prefab] ? new RigInstance(data, prefab) : null;
                this.shots.set(s.id, rig);
            }
            push([this.shotItem(rig, s)]);
        }
        for (const id of [...this.shots.keys()]) if (!liveShots.has(id)) this.shots.delete(id);

        // ---------- particles
        for (const em of this.emitters) em.update(dt);
        this.emitters = this.emitters.filter(em => !em.done);
        for (const av of this.areas.values()) for (const em of av.emitters) em.update(dt);
        const allEmitters = [...this.emitters, ...[...this.areas.values()].flatMap(a => a.emitters)];
        for (const em of allEmitters) {
            const img = em.texture ? tex.get(em.texture) : null;
            push([{ layer: em.layer, order: em.order, y: em.origin[5], seq: 0, draw: c => em.draw(c, img, tintTexture) }]);
        }

        // ---------- damage labels (DmgNumbersView)
        for (const hit of v.hits) {
            // DmgNumbersView.OnAnyDmg 0x40186A0: heals spawn no label; a reflected hit spawns the
            // "Reflected" text 0.35 above and its number 0.35 below; anything else one label.
            if (hit.kind === 'heal') continue;
            if (hit.kind === 'reflect') {
                const a = this.labelItem(hit, v, 'reflectText', 0.35);
                const b = this.labelItem(hit, v, 'number', -0.35);
                if (a) push([a]);
                if (b) push([b]);
                continue;
            }
            const it = this.labelItem(hit, v, 'auto', 0);
            if (it) push([it]);
        }

        sortItems(items);
        for (const it of items) it.draw(ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * How a buff view sits and moves (2026_10_27_09_45):
     *  - Morale (Setup 0x3F5EB58), Berserk (0x3F5C6A4): on the CharacterRig, so a mount lifts them.
     *  - Meat (Setup 0x3F5E380, Update 0x3F5E568): on HpBarParent at (0, HeadOffset); IconParent
     *    scales 0 -> 1 in 0.2 s and back to 0 in 0.4 s at the end; the icon pulses from pulseMax to
     *    pulseMin over 0.5 s, again and again.
     *  - HigherMorale (Setup 0x3F5DA34, Update 0x3F5DE50): on the unit root; the Ring moves to
     *    HpBarParent at (0, 0.4 + 0.05 sin(4 t)) (RingHeadOffset, the constructor's 0.4: the prefab
     *    data does not carry it), the ground circle turns 100 degrees a second; Ring and circle scale
     *    to 2 and 3 in 0.2 s and back to 0 in 0.4 s at the end.
     *  - Buff (Setup 0x3F5CCC0): no picture, it scales the unit (buffScale).
     * Tweens with no SetEase take DOTween's default, OutQuad.
     */
    private drawBuff(bv: BuffView, ov: UnitView, dt: number, push: (l: DrawItem[]) => void): void {
        const { data, tex } = this.inp;
        const rig = bv.rig;
        if (!rig) return;
        const k = buffOpen(bv, this.battleTime);
        const urig = ov.rig;
        const hp = urig.find('HpBarParent');
        const sign = urig.world[0]?.[0] && urig.world[0][0] < 0 ? -1 : 1;
        rig.clearAnimation();
        let at: Mat;
        if (bv.skillId === 'Meat') {
            const mb = rig.nodes[0].mb?.MeatSkillView;
            at = mul(hp >= 0 ? urig.world[hp] : urig.world[0], trs(0, mb?.HeadOffset ?? 1, 0, 1, 1));
            const icon = rig.find('IconParent');
            if (icon >= 0) rig.setLocalScale(icon, k, k);
            const sq = rig.find('Square');
            const max = mb?.pulseMax ?? 2.5, min = mb?.pulseMin ?? 2;
            const ph = Math.min(1, (((this.battleTime - bv.start) % 0.5) * 2));
            if (sq >= 0) rig.setLocalScale(sq, max + (min - max) * ph, max + (min - max) * ph);
        } else if (bv.skillId === 'HigherMorale') {
            at = urig.world[0];
            const ring = rig.find('Ring');
            if (ring >= 0) {
                const hpY = hp >= 0 ? (urig.world[hp][5] - at[5]) / (at[3] || 1) : 1.55;
                rig.setLocalPosition(ring, 0, hpY + 0.4 + 0.05 * Math.sin(4 * this.battleTime));
                rig.setLocalScale(ring, 2 * k, 2 * k);
            }
            const circle = rig.find('GroundCircle');
            if (circle >= 0) {
                rig.addRotation(circle, 100 * (this.battleTime - bv.start));
                rig.setLocalScale(circle, 3 * k, 3 * k);
            }
        } else {
            at = ov.charRig >= 0 ? urig.world[ov.charRig] : urig.world[0];
        }
        rig.update(at ?? [sign, 0, 0, 1, 0, 0]);
        if (!bv.emitters.length && bv.end === null) {
            rig.nodes.forEach((nd, i) => {
                if (!nd.ps || !rig.isVisible(i)) return;
                const ps = nd.ps as ParticleDef;
                bv.emitters.push({ node: i, em: new Emitter(ps, rig.world[i] ?? IDENTITY, ps.renderer?.order ?? 0, layerIndex(data, ps.renderer?.layer), false) });
            });
        }
        push(rigItems(rig, tex));
        for (const { em, node } of bv.emitters) {
            em.origin = rig.world[node] ?? em.origin;
            em.update(dt);
            const img = em.texture ? tex.get(em.texture) : null;
            push([{ layer: em.layer, order: em.order, y: em.origin[5], seq: 0, draw: c => em.draw(c, img, tintTexture) }]);
        }
    }

    /** BuffSkillView.Setup 0x3F5CCC0: the UnitView scales to 1.2 in 0.2 s, and back to 1 in 0.4 s at the end. */
    private buffScale(isAlly: boolean): number {
        const bv = this.buffViews.get(`${isAlly ? 'ally' : 'enemy'}:Buff`);
        return bv ? 1 + 0.2 * buffOpen(bv, this.battleTime) : 1;
    }

    /**
     * DroneView.Setup 0x3F5D3F4: a sequence of AppendInterval(the skill's Duration), a callback
     * that stops it following the unit (_blockMove), then DOVirtual.Float(0, 1, 2 s, Linear) moving
     * the Drone transform to its start + Bezier((0,0), (5,0), (20,10), t) (0x4030BF8, quadratic)
     * and the Shadow to (Bezier.x, 0), then the view is removed.
     */
    private drawLeavingDrones(dt: number, push: (l: DrawItem[]) => void): void {
        const { data, tex } = this.inp;
        this.leaving = this.leaving.filter(lv => lv.t < DRONE_EXIT_SECONDS);
        for (const lv of this.leaving) {
            lv.t = Math.min(DRONE_EXIT_SECONDS, lv.t + dt);
            const k = lv.t / DRONE_EXIT_SECONDS;
            const bx = 2 * (1 - k) * k * 5 + k * k * 20;
            const by = k * k * 10;
            const rig = lv.uv.rig;
            rig.clearAnimation();
            const clip = lv.uv.controller?.Walk ? data.clips[lv.uv.controller.Walk] : undefined;
            rig.applyClip(clip, this.battleTime, true);
            const drone = lv.uv.charRig;
            const base = rig.nodes[drone].base;
            rig.setLocalPosition(drone, base.x + bx, base.y + by);
            const shadow = rig.find('Shadow (1)');
            if (shadow >= 0) rig.setLocalPosition(shadow, bx, 0);
            rig.update([lv.sign, 0, 0, 1, lv.x, lv.y]);
            push(rigItems(rig, tex));
        }
    }

    private drawArea(av: AreaView, e: VisualEffect, push: (l: DrawItem[]) => void, viewH: number, camY: number) {
        const { data, tex } = this.inp;
        const rig = av.rig;
        const sign = e.isAllied ? 1 : -1;
        rig.clearAnimation();
        const D = e.duration;
        const progress = D > 0 ? Math.max(0, Math.min(1, e.timer / D)) : 1;
        const pulsed = e.sincePulse !== null && e.sincePulse !== undefined;
        const landed = pulsed || progress >= 1;
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        // ProjectileBattleManager.OnMessage(AreaProjectileCreatedMessage) 0x403E3DC places the view at
        // the area's Position; only the views below turn or flip it themselves.
        let root: Mat = [sign, 0, 0, 1, e.x, e.y];
        if (e.skillId === 'Meteorite') {
            // MeteoriteSkillView.Init 0x3F5E6D8: the rock starts at (IsAlly ? -5 : 5, 20), scale 0,
            // turned by r1 = Random.Range(0, 360); over f = min(D, 2) (after D - f), Linear, it moves
            // to (0, 0), turns clockwise by r2 = Random.Range(360, 720) and scales to 2 in f / 2.
            // At the impact it scales to 0 and the Explosion emits (0x3F5EA64).
            root = [1, 0, 0, 1, e.x, e.y];
            const rock = rig.find('Meteorite');
            if (rock >= 0) {
                const f = Math.min(D, 2);
                const k = f > 0 ? clamp01((e.timer - (D - f)) / f) : 1;
                const r1 = Math.floor(360 * hash01(e.id * 31 + 7));
                const r2 = 360 + Math.floor(360 * hash01(e.id * 17 + 3));
                const sx = e.isAllied ? -5 : 5;
                rig.setLocalPosition(rock, sx * (1 - k), 20 * (1 - k));
                rig.addRotation(rock, r1 - r2 * k - rig.nodes[rock].base.rot);
                const sc = 2 * Math.min(1, k * 2);
                rig.setLocalScale(rock, sc, sc);
                rig.nodes[rock].hidden = landed;
            }
        } else if (e.skillId === 'CannonBarrage') {
            // CannonBarrageSkillView.Init 0x3F5CEBC: the ball waits at (IsAlly ? -20 : 20, 0) until
            // D - 1, then flies a straight line to (0, 0) from 6 up over 1 s, Linear, with no turn.
            root = [1, 0, 0, 1, e.x, e.y];
            const ball = rig.find('Meteorite');
            if (ball >= 0) {
                const x0 = e.isAllied ? -20 : 20;
                const t = clamp01(e.timer - (D - 1));
                rig.setLocalPosition(ball, x0 * (1 - t), 6 * (1 - t));
                rig.nodes[ball].hidden = landed;
            }
        } else if (e.skillId === 'Bomb') {
            // BombSkillView.Init 0x3F5C92C: from (0, 10), scale 0: DOLocalMove to (0, 0) over D with
            // InQuad, joined with DOScale(2) over 0.1 D (DOTween's default ease, OutQuad).
            root = [1, 0, 0, 1, e.x, e.y];
            const bomb = rig.find('Bomb');
            if (bomb >= 0) {
                rig.setLocalPosition(bomb, 0, 10 * (1 - progress * progress));
                const q = clamp01(D > 0 ? e.timer / (0.1 * D) : 1);
                const sc = 2 * (1 - (1 - q) * (1 - q));
                rig.setLocalScale(bomb, sc, sc);
                rig.nodes[bomb].hidden = landed;
            }
        } else if (e.skillId === 'Lightning') {
            // LightningView.Init 0x3F5E014: the root takes a random scale, x = +-Random.Range(0.8,
            // 1.2) (the sign from Random.value > 0.5), y = Random.Range(1, 1.1); no side mirroring.
            const sx = (0.8 + 0.4 * hash01(e.id * 13 + 1)) * (hash01(e.id * 7 + 5) > 0.5 ? -1 : 1);
            const sy = 1 + 0.1 * hash01(e.id * 11 + 9);
            root = [sx, 0, 0, sy, e.x, e.y];
            const bolt = rig.find('Square');
            if (bolt >= 0) rig.nodes[bolt].hidden = !landed;
        } else if (e.skillId === 'Shout') {
            // ShoutSkillView.Init 0x3F5F5D4: re-parented next to the caster's CharacterRig (local
            // zero), so the rings sit on the player and follow them, not on the damage area.
            const pa = this.playerAt[e.isAllied ? 'ally' : 'enemy'];
            if (pa) root = [sign, 0, 0, 1, pa.x, pa.y];
        } else if (e.skillId === 'Thorns') {
            this.animateThorns(av, e);
        } else if (e.skillId === 'Worm') {
            // WormSkillView: the prefab's Animator plays the "Worm" clip once from the spawn.
            if (av.clip) rig.applyClip(data.clips[av.clip], this.battleTime - av.born, false);
        } else if (e.skillId === 'StrafeRun') {
            root = [1, 0, 0, 1, e.x, e.y];
            this.animateStrafeRun(av, e);
        } else if (e.skillId === 'Stampede') {
            // StampedeView.Update 0x3F5F52C moves the herd by Velocity every frame; only each bull
            // turns to its side (BullView.Setup 0x3F5F2C8), not the formation.
            const x = av.goneAt === null ? e.x - e.vx * 0.1 * (1 - this.tickAlpha) : e.x;
            root = [1, 0, 0, 1, x, e.y];
            this.animateBulls(av, e);
        } else if (e.skillId === 'RainOfArrows') {
            // RainOfArrowsSkillView: ArrowParticles play for its Duration (3 s), then Stop().
            const mb = rig.nodes[0].mb?.RainOfArrowsSkillView;
            if (this.battleTime - av.born >= (mb?.Duration ?? 3)) for (const em of av.emitters) em.stopped = true;
        }
        if (av.clip && e.skillId !== 'Worm') rig.applyClip(data.clips[av.clip], e.timer, false);
        rig.update(root);
        // Systems are children of the view: they move with their node (Shout, Stampede, StrafeRun).
        for (const em of av.emitters) {
            const i = av.nodeOf.get(em.def);
            if (i !== undefined) em.origin = rig.world[i];
        }
        const pulseKey = e.sincePulse === null ? null : Math.round((this.battleTime - e.sincePulse) * 10);
        if (pulseKey !== null && pulseKey !== av.lastPulse) {
            av.lastPulse = pulseKey;
            if (!av.exploded || e.hasPulse) {
                av.exploded = true;
                this.explode(rig);
            }
        }
        push(rigItems(rig, tex));
    }

    /**
     * ThronsSkillView.Init 0x3F60BFC runs SpikeVisual.Animate(PulseDuration) (0x3F609A4) on every
     * spike at once. With p the pulse: the hole (the SpikeVisual, which is also the SpriteMask)
     * scales 0 -> 2 over p (InBack) while the spike waits retracted; the spike rises (0.2 p),
     * sinks (0.6 p), waits (0.3 p), rises (0.2 p), waits Random.Range(0, 0.35), sinks (0.6 p),
     * waits (0.3 p), all Linear; then the hole scales 2 -> 0 over 0.4 s (InBack).
     */
    private animateThorns(av: AreaView, e: VisualEffect): void {
        const rig = av.rig;
        const p = e.pulseDuration > 0 ? e.pulseDuration : 0.5;
        const t = this.battleTime - av.born;
        rig.nodes.forEach((nd, i) => {
            const sv = nd.mb?.SpikeVisual;
            if (!sv) return;
            const R = sv.RetractedHeight ?? -0.425, E = sv.ExtendedHeight ?? 0.191;
            const wait = 0.35 * hash01(av.born * 997 + i * 31);
            let hole = 2, y = R;
            const steps: [number, number, number][] = [[0.2 * p, R, E], [0.6 * p, E, R], [0.3 * p, R, R], [0.2 * p, R, E], [wait, E, E], [0.6 * p, E, R], [0.3 * p, R, R]];
            if (t < p) hole = 2 * inBack(t / p);
            else {
                let at = t - p, done = true;
                for (const [d, a, b] of steps) {
                    if (at < d) { y = a + (b - a) * (d > 0 ? at / d : 1); done = false; break; }
                    at -= d;
                }
                if (done) hole = 2 - 2 * inBack(Math.min(1, at / 0.4));
            }
            rig.setLocalScale(i, hole, hole);
            const spike = rig.nodes.findIndex(n => n.p === i);
            if (spike >= 0) rig.setLocalPosition(spike, rig.nodes[spike].base.x, y);
        });
    }

    /**
     * StrafeRunView.Init 0x3F5FA44: with n = normalize(Dir) and d = (IsAlly ? n.x : -n.x, n.y), the
     * plane flies 30 d -> 15 d in a line, a quadratic Bezier 15 d -> (0, 0) -> (-20 d.x, 10 n.y),
     * and a line to (-40 d.x, 20 n.y), at 15 / Duration units a second (EvaluateDistance is
     * Evaluate01(distance / Length), so the curve is walked by its parameter). Its up axis follows
     * the flight; the shadow sits under it on the ground, scale S = 3 clamp01(1 - y^2 / 400) by S/2.
     * The impacts, smoke and bullet holes play from the start and stop a quarter into the curve.
     * The bullet stream (a MeshRenderer) is not drawn: its material is not exported.
     */
    private animateStrafeRun(av: AreaView, e: VisualEffect): void {
        const rig = av.rig;
        const sr = strafePaths(rig, e.isAllied);
        const speed = 15 / (e.duration > 0 ? e.duration : 1);
        const dist = (this.battleTime - av.born) * speed;
        const at = sr.at(dist);
        const plane = rig.find('Plane Parent');
        if (plane >= 0) {
            rig.setLocalPosition(plane, at.x, at.y);
            rig.addRotation(plane, (Math.atan2(at.ty, at.tx) * 180) / Math.PI - 90 - rig.nodes[plane].base.rot);
        }
        const look = rig.find('Plane (1)');
        if (look >= 0 && !e.isAllied) rig.setLocalScale(look, -rig.nodes[look].base.sx, rig.nodes[look].base.sy);
        const shadow = rig.find('Shadow');
        if (shadow >= 0) {
            const S = 3 * Math.max(0, Math.min(1, 1 - (at.y * at.y) / 400));
            rig.setLocalPosition(shadow, at.x, 0);
            rig.setLocalScale(shadow, S, S / 2);
        }
        if (dist >= sr.l0 + 0.25 * sr.l1) for (const em of av.emitters) if (!/Plane Parent/.test(rig.nodes[av.nodeOf.get(em.def) ?? 0]?.path ?? '')) em.stopped = true;
    }

    /**
     * BullView (Awake 0x3F5F0E8, Update 0x3F5F174): each bull circles its rest place, speed
     * Random.Range(30, 100) degrees a second (either way), radius Random.Range(0.2, 0.3), plus
     * PerlinNoise(t 5 + rest.x, 0) 0.2 up; Setup turns it to its side.
     */
    private animateBulls(av: AreaView, e: VisualEffect): void {
        const rig = av.rig;
        const t = this.battleTime - av.born;
        rig.nodes.forEach((nd, i) => {
            if (!nd.scripts?.includes('BullView')) return;
            const b = nd.base;
            const h = av.born * 1000 + i * 17;
            const speed = (30 + Math.floor(70 * hash01(h + 1))) * (hash01(h + 2) < 0.5 ? -1 : 1);
            const r = 0.2 + 0.1 * hash01(h + 3);
            const a = (speed * t * Math.PI) / 180;
            rig.setLocalPosition(i, b.x - Math.sin(a) * r, b.y + Math.cos(a) * r + perlin(t * 5 + b.x, 0) * 0.2);
            if (!e.isAllied) rig.setLocalScale(i, -b.sx, b.sy);
        });
    }

    /**
     * The impact: the "Explosion" system Emit(1) (Meteorite 0x3F5EA64, Bomb 0x3F5CBCC, Cannon),
     * its own particle being the shock wave; the smoke, impact and rock systems are its sub-emitters
     * and play their bursts.
     */
    private explode(rig: RigInstance): void {
        if (rig.find('Explosion') < 0) return;
        const ems = this.spawnEmitters(rig, p => /(^|\/)Explosion(\/|$)/.test(p), true);
        const wave = rig.nodes.find(n => n.n === 'Explosion' && n.ps)?.ps;
        for (const em of ems) if (em.def === wave) em.burst(1);
        this.emitters.push(...ems);
    }

    /** A skill view outliving its area: the impact (final pulse) and, for Lightning, the fading bolt. */
    private retire(av: AreaView): void {
        const { data } = this.inp;
        if (!av.exploded) {
            av.exploded = true;
            this.explode(av.rig);
        }
        if (av.skillId === 'Lightning') {
            const sq = av.rig.find('Square');
            if (sq >= 0) {
                av.rig.nodes[sq].hidden = false;
                // LightningView.Init 0x3F3E694: shown at the strike, DOFade over Random(0.2, 0.5) s.
                this.afterglows.push({ rig: av.rig, node: sq, t: 0, dur: 0.2 + 0.3 * hash01(av.born * 1000 + sq) });
            }
        }
        void data;
    }

    private shotItem(rig: RigInstance | null, s: VisualShot): DrawItem {
        const ang = Math.atan2(s.vy, s.vx) * 180 / Math.PI;
        // ProjectileBattleManager.OnMessage(ProjectileCreatedMessage) 0x403DF9C reads the shot's
        // ProjectilePrefab (the weapon's visual config, the skin's when its animation is on) and
        // spawns no view when it is null: a ranged skin variant has none, so the game draws nothing.
        if (!rig) return { layer: 1, order: 3, y: s.y, seq: 0, draw: () => { } };
        const pi = rig.nodes[0].mb?.ProjectileItem;
        let rot = 0;
        // ProjectileView.Update 0x403ED00: aligned shots take LookRotation(Vector3.forward, velocity),
        // which points the sprite's up axis along the flight (the arrows are drawn pointing up);
        // spinning ones turn by RotationSpeed a second, the other way round when flying left.
        if (pi?.AlignToVelocity !== false) rot = ang - 90;
        else if (pi?.Rotates) rot = this.battleTime * (pi.RotationSpeed ?? 0) * (s.vx < 0 ? -1 : 1);
        rig.update(mul([1, 0, 0, 1, s.x, s.y], trs(0, 0, rot, 1, 1)));
        const list = rigItems(rig, this.inp.tex);
        return { layer: 1, order: 3, y: s.y, seq: 0, draw: c => { for (const it of list) it.draw(c); } };
    }

    private labelItem(hit: VisualHit, v: SceneVisuals, part: 'auto' | 'reflectText' | 'number', verticalOffset: number): DrawItem | null {
        const { data, tex } = this.inp;
        const font = data.font;
        if (!font) return null;
        if (hit.kind === 'dodge') return null; // DmgInfo has no dodge: the game shows nothing
        const L = data.constants.dmgLabel;
        const lbl = font.label;
        const dm = data.prefabs.DmgLabel?.nodes[0]?.mb?.DmgNumberLabel;
        const c3 = (c: any, d: number[]) => c ? [c.r, c.g, c.b, c.a] : d;
        let text: string;
        let color = lbl.color;
        let sizeMulti = 1;
        let dur = L.durationMin + (L.durationMax - L.durationMin) * hash01(hit.key);
        let staticAnim = false;
        // Each label rolls its own Random.Range(0.6, 0.8): duration and arc size, so labels from
        // consecutive hits on one target separate as they fly.
        if (part !== 'auto') dur = L.durationMin + (L.durationMax - L.durationMin) * hash01(hit.key * 2 + (part === 'number' ? 1 : 0));
        // DmgNumberLabel.Setup: GetTranslation("Block") / GetTranslation("Reflect").
        if (hit.kind === 'block') { text = 'Block'; color = c3(dm?.BlockColor, color); staticAnim = true; }
        else if (part === 'reflectText') { text = 'Reflect'; color = c3(dm?.ReflectColor, color); staticAnim = true; }
        else {
            text = formatDamage(hit.amount);
            if (hit.kind === 'crit') { color = c3(dm?.CritColor, color); sizeMulti = L.critSizeMulti; dur *= L.critDurationMulti; }
        }
        const t = hit.age / dur;
        if (t >= 1 || hit.age > HIT_VISIBLE_SECONDS + 1) return null;
        // Label at the target: x, y + riseY (DmgNumberLabel.Setup), text box anchored lower.
        const target = v.units.find(u => Math.abs(u.x - hit.x) < 1e-6 && Math.abs(u.y - hit.y) < 1e-6);
        const bx = hit.x;
        const by = hit.y + verticalOffset + L.riseY + lbl.anchoredY;
        // sign: -1 for a label on the ally side, +1 on the enemy side (it drifts away from the middle).
        const sign = hit.onAlly ? -1 : 1;
        void target;
        let px: number, py: number, scale: number, rot = 0;
        if (staticAnim) {
            px = bx;
            py = by + (1 - 4 * (t - 0.5) * (t - 0.5)) * L.staticArc + L.staticOffsetY;
            scale = (L.scaleStart + L.scalePerT * t) * sizeMulti;
        } else {
            const amp = dur / (hit.kind === 'crit' ? L.critDurationMulti : 1);
            px = bx + amp * sign * t;
            py = by + (1 - 4 * (t - 0.5) * (t - 0.5)) * amp;
            scale = (L.scaleStart + L.scalePerT * t) * sizeMulti;
            rot = sign * L.rotationDegPerT * t;
        }
        const alphaFade = 1 - t * t; // DOFade to 0, Ease InQuad
        // TextMeshPro auto-size inside the label rect (3 x 1 units), 0.1 world units per point.
        let adv = 0;
        for (const ch of text) adv += font.glyphs[ch]?.adv ?? font.glyphs['0'].adv;
        // TMP's auto-size fits the line's ascent-to-descent height in the rect.
        const emFromHeight = lbl.rect[1] / ((font.ascent - font.descent) / font.pointSize);
        const emFromWidth = lbl.rect[0] / (adv / font.pointSize);
        const em = Math.min(emFromHeight, emFromWidth, lbl.fontSizeMax * 0.1);
        const img = tex.get(font.texture);
        if (!img) return null;
        return {
            layer: 3, order: 1000, y: -1e9, seq: 0,
            draw: (ctx) => {
                ctx.save();
                ctx.translate(px, py);
                ctx.rotate((rot * Math.PI) / 180);
                ctx.scale(scale, scale);
                const k = em / font.pointSize; // world units per font unit
                let cx = -(adv * k) / 2;
                // vertical centre of the line
                const baseY = -((font.ascent + font.descent) / 2) * k;
                ctx.globalAlpha *= alphaFade * (color[3] ?? 1);
                for (const ch of text) {
                    const g = font.glyphs[ch] ?? font.glyphs['0'];
                    const gx = cx + g.bx * k;
                    const gy = baseY + g.by * k; // top of the glyph cell, y up
                    ctx.save();
                    ctx.translate(gx, gy);
                    ctx.scale((g.w * k) / g.sw, -(g.h * k) / g.sh);
                    const src = tintGlyph(img, g, color);
                    ctx.drawImage(src.img, src.x, src.y, g.sw, g.sh, 0, 0, g.sw, g.sh);
                    ctx.restore();
                    cx += g.adv * k;
                }
                ctx.restore();
            },
        };
    }
}

/** Glyph cells multiplied by the label colour: white face takes the colour, outline stays black. */
const glyphTint = new Map<string, HTMLCanvasElement>();
function tintGlyph(img: HTMLImageElement, g: { sx: number; sy: number; sw: number; sh: number }, color: number[]): { img: CanvasImageSource; x: number; y: number } {
    if (color[0] > 0.99 && color[1] > 0.99 && color[2] > 0.99) return { img, x: g.sx, y: g.sy };
    const key = `${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')}`;
    let c = glyphTint.get(key);
    if (!c) {
        c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${key})`;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(img, 0, 0);
        glyphTint.set(key, c);
    }
    return { img: c, x: g.sx, y: g.sy };
}

/**
 * Custom/HPBar: a billboard quad of _Scale world units. The outline is a rounded box of half size
 * (0.5, LineThickness + 0.09) and radius CornerRadius; fill and prefill are left-aligned boxes of
 * half height 0.09 and radius 0.6 x CornerRadius, inset by LineThickness (UV units).
 */
function drawHpBar(ctx: CanvasRenderingContext2D, m: Mat, fill: number, prefill: number, mat: any) {
    const f = mat?.floats ?? {};
    const col = mat?.colors ?? {};
    const scale = f._Scale ?? 0.77;
    const lt = f._LineThickness ?? 0.065;
    const cr = f._CornerRadius ?? 0.15;
    const rgba = (c: number[] | undefined, d: string) => c ? `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${c[3]})` : d;
    const cx = m[4], cy = m[5];
    const round = (x0: number, y0: number, x1: number, y1: number, r: number, style: string) => {
        if (x1 - x0 <= 0) return;
        ctx.fillStyle = style;
        ctx.beginPath();
        const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
        ctx.roundRect(cx + (x0 - 0.5) * scale, cy + (y0 - 0.5) * scale, (x1 - x0) * scale, (y1 - y0) * scale, rr * scale);
        ctx.fill();
    };
    const oh = lt + 0.09;
    round(0, 0.5 - oh, 1, 0.5 + oh, cr, rgba(col._OutlineColor, '#000'));
    const inner = 0.5 - lt;
    round(lt, 0.5 - 0.09, lt + 2 * inner * prefill, 0.5 + 0.09, cr * 0.6, rgba(col._PrefillColor, '#fff'));
    round(lt, 0.5 - 0.09, lt + 2 * inner * fill, 0.5 + 0.09, cr * 0.6, rgba(col._FillColor, '#f00'));
}

