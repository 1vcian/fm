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
}

const ITEM_TYPE = { Helmet: 0, Armour: 1, Weapon: 5 } as const;

function visualFor(data: BattleVisualData, age: number, type: number, idx: number): ItemVisual | null {
    if (age === 10000) return data.visuals[data.defaultWeapon] ?? null;
    const name = data.ages[age]?.items[String(type)]?.[idx];
    return name ? data.visuals[name] ?? null : null;
}

function skinPrefab(data: BattleVisualData, type: number, skinIdx: number | undefined, ranged: boolean): string | null {
    if (skinIdx === undefined || skinIdx === null) return null;
    const s = data.skins.find(k => k.itemType === type && k.skinVisualId === skinIdx);
    if (!s) return null;
    const name = ranged && s.secondary ? s.secondary : s.main;
    return name ? data.visuals[name]?.prefab ?? null : null;
}

/** A profile's look: equipped helmet / armour / weapon with skins, mount, pets and fairy. */
export function lookFromProfile(data: BattleVisualData, profile: UserProfile | null | undefined, opts?: { weaponRanged?: boolean; noCompanions?: boolean }): Look {
    if (!profile) return { weapon: data.visuals[data.defaultWeapon] };
    const it = profile.items;
    const look: Look = {};
    if (it.Helmet) {
        look.helmet = visualFor(data, it.Helmet.age, ITEM_TYPE.Helmet, it.Helmet.idx);
        look.helmetPrefab = skinPrefab(data, ITEM_TYPE.Helmet, it.Helmet.skin?.idx, false);
    }
    if (it.Body) {
        look.armour = visualFor(data, it.Body.age, ITEM_TYPE.Armour, it.Body.idx);
        look.armourPrefab = skinPrefab(data, ITEM_TYPE.Armour, it.Body.skin?.idx, false);
    }
    if (it.Weapon) {
        look.weapon = visualFor(data, it.Weapon.age, ITEM_TYPE.Weapon, it.Weapon.idx);
        look.weaponPrefab = skinPrefab(data, ITEM_TYPE.Weapon, it.Weapon.skin?.idx, !!opts?.weaponRanged);
    } else {
        look.weapon = data.visuals[data.defaultWeapon];
    }
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

interface UnitView {
    rig: RigInstance;
    kind: 'unit' | 'thief' | 'drone';
    controller: Record<string, string> | null;
    charRig: number;
    hpBar: number;
    unitShadow: number;
    handPrimary: number;
    aiming: boolean;
    projectile: string | null;
    mount: RigInstance | null;
    mountOffset: [number, number];
    mountClip: string | null;
    pets: { rig: RigInstance; slot: number; x: number; y: number; clip: string | null }[];
    fairy: { rig: RigInstance; clip: string | null; x: number; y: number; hover: number; speed: number; emitters?: Emitter[] } | null;
    prevX: number; prevY: number; x: number; y: number;
    tick: number;
    fill: number; prefill: number; prefillFrom: number; prefillT: number;
    seen: number;
    deathDone: boolean;
}

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

function buildUnit(data: BattleVisualData, look: Look, kind: UnitView['kind']): UnitView {
    const prefab = kind === 'thief' ? 'ThiefView' : kind === 'drone' ? 'DroneView' : 'UnitView';
    const rig = new RigInstance(data, prefab);
    let charRig = rig.find(kind === 'drone' ? 'Drone' : 'CharacterRig');
    let controller: Record<string, string> | null = null;
    let aiming = false;
    let projectile: string | null = null;
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
            if (w?.dualWield) rig.append(main, ws);
        }
        if (w?.hasSecondary && w.secondary) rig.append(w.secondary, ws);
        projectile = w?.hasProjectile ? w.projectile ?? null : null;
        controller = controllerClips(data, w?.controller);
    } else {
        controller = controllerClips(data, rig.nodes[charRig]?.anim ?? null);
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
        rig, kind, controller, charRig, aiming, projectile,
        hpBar: rig.find('HpBar'),
        ...(kind === 'thief' ? (() => { const dc = rig.find('Destroyed Cart'); if (dc >= 0) rig.nodes[dc].hidden = true; return {}; })() : {}),
        unitShadow: kind === 'unit' ? rig.find('Shadow') : -1,
        handPrimary: rig.find('[ROT] Hand-Primary'),
        mount, mountOffset, mountClip, pets, fairy,
        prevX: NaN, prevY: NaN, x: NaN, y: NaN, tick: -1,
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
    exploded: boolean;
    lastPulse: number | null;
    clip: string | null;
}

export class BattleSceneRenderer {
    private units = new Map<number, UnitView>();
    private areas = new Map<number, AreaView>();
    private shots = new Map<number, RigInstance | null>();
    private buffs = new Map<string, RigInstance | null>();
    private afterglows: { rig: RigInstance; node: number; t: number; dur: number }[] = [];
    private buffEmitters = new Map<string, Emitter[]>();
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
            this.lastTick = v.tick;
            this.tickWall = nowMs;
        }
        const alpha = playing ? Math.max(0, Math.min(1, ((nowMs - this.tickWall) / 1000) * speed / 0.1)) : 1;
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
                    const fx = new RigInstance(data, 'UnitDeathEffectsView');
                    fx.update([1, 0, 0, 1, x, y]);
                    this.emitters.push(...this.spawnEmitters(fx, () => true, true));
                }
                continue;
            }
            const sign = uv.kind === 'thief' ? 1 : u.sign;
            const root: Mat = [sign, 0, 0, 1, x, y];
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
                const mountItems = rigItems(uv.mount, tex);
                // Rider and mount sort as one: mount first, the rider on top.
                const all = [...mountItems, ...unitItems];
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
        for (const id of [...this.units.keys()]) if (!alive.has(id)) this.units.delete(id);

        // ---------- active buffs: the skill's effect prefab on its owner while it lasts
        const liveBuffs = new Set<string>();
        for (const side of ['ally', 'enemy'] as const) {
            const owner = v.units.find(u => u.isPlayer && u.isAlly === (side === 'ally') && !u.killed);
            const ov = owner ? this.units.get(owner.id) : undefined;
            if (!owner || !ov) continue;
            for (const b of v.buffs[side]) {
                const key = `${side}:${b.skillId}`;
                liveBuffs.add(key);
                let rig = this.buffs.get(key);
                if (rig === undefined) {
                    const prefab = this.skillPrefab('animations', b.skillId, side === 'ally');
                    rig = prefab && data.prefabs[prefab] ? new RigInstance(data, prefab) : null;
                    this.buffs.set(key, rig);
                    if (rig) {
                        rig.update([owner.sign, 0, 0, 1, owner.x, owner.y]);
                        this.buffEmitters.set(key, this.spawnEmitters(rig, () => true, false));
                    }
                }
                if (!rig) continue;
                const bx = ov.prevX + (ov.x - ov.prevX) * alpha, by = ov.prevY + (ov.y - ov.prevY) * alpha;
                rig.update([owner.sign, 0, 0, 1, bx, by]);
                for (const em of this.buffEmitters.get(key) ?? []) { em.origin = rig.world[0]; em.update(dt); }
                push(rigItems(rig, tex));
                for (const em of this.buffEmitters.get(key) ?? []) {
                    const img = em.texture ? tex.get(em.texture) : null;
                    push([{ layer: em.layer, order: em.order, y: by, seq: 0, draw: c => em.draw(c, img, tintTexture) }]);
                }
            }
        }
        for (const key of [...this.buffs.keys()]) if (!liveBuffs.has(key)) { this.buffs.delete(key); this.buffEmitters.delete(key); }

        // ---------- skill areas
        const liveAreas = new Set<number>();
        for (const e of v.effects) {
            liveAreas.add(e.id);
            let av = this.areas.get(e.id);
            if (!av) {
                const prefab = this.skillPrefab('animations', e.skillId, e.isAllied);
                if (!prefab || !data.prefabs[prefab]) continue;
                const rig = new RigInstance(data, prefab);
                av = { rig, skillId: e.skillId, born: this.battleTime, emitters: [], exploded: false, lastPulse: null, clip: ownClip(data, rig) };
                this.areas.set(e.id, av);
                rig.update([e.isAllied ? 1 : -1, 0, 0, 1, e.x, e.y]);
                // Looping systems that are not the impact play from the start (rings, rain, smoke).
                av.emitters = this.spawnEmitters(rig, p => !/Explosion|Impact/i.test(p), false);
            }
            this.drawArea(av, e, push, viewH, camY);
        }
        for (const [id, av] of [...this.areas]) {
            if (!liveAreas.has(id)) {
                this.retire(av);
                for (const em of av.emitters) em.stopped = true;
                this.emitters.push(...av.emitters);
                this.areas.delete(id);
            }
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

    private drawArea(av: AreaView, e: VisualEffect, push: (l: DrawItem[]) => void, viewH: number, camY: number) {
        const { data, tex } = this.inp;
        const rig = av.rig;
        const sign = e.isAllied ? 1 : -1;
        rig.clearAnimation();
        const progress = e.duration > 0 ? Math.max(0, Math.min(1, e.timer / e.duration)) : 1;
        const pulsed = e.sincePulse !== null && e.sincePulse !== undefined;
        // Final-pulse skills land when Timer reaches Duration: the falling object travels from
        // above the view to the area while the timer runs, then the impact systems play.
        const falling = rig.find('Meteorite');
        if (falling >= 0) {
            // MeteoriteSkillView.Init 0x3F3EDF4: starts at (Random(-5, 5), 20) and moves to the area
            // while the timer runs, spinning by a random 360..720 degrees.
            const nd = rig.nodes[falling];
            const sx = -5 + 10 * hash01(e.id * 31 + 7);
            const spin = 360 + 360 * hash01(e.id * 17 + 3);
            const k = 1 - progress;
            rig.setLocalPosition(falling, nd.base.x + sx * k, nd.base.y + 20 * k);
            rig.addRotation(falling, spin * progress);
            nd.hidden = pulsed || progress >= 1;
        }
        const bomb = rig.find('Bomb');
        if (bomb >= 0) rig.nodes[bomb].hidden = pulsed || progress >= 1;
        const lightning = rig.find('Square');
        if (e.skillId === 'Lightning' && lightning >= 0) rig.nodes[lightning].hidden = !(pulsed || progress >= 1);
        if (av.clip) rig.applyClip(data.clips[av.clip], e.timer, false);
        rig.update([sign, 0, 0, 1, e.x, e.y]);
        const pulseKey = e.sincePulse === null ? null : Math.round((this.battleTime - e.sincePulse) * 10);
        if (pulseKey !== null && pulseKey !== av.lastPulse) {
            av.lastPulse = pulseKey;
            if (!av.exploded || e.hasPulse) {
                av.exploded = true;
                this.emitters.push(...this.spawnEmitters(rig, p => /Explosion|Impact|Rocks/i.test(p), true));
            }
        }
        push(rigItems(rig, tex));
    }

    /** A skill view outliving its area: the impact (final pulse) and, for Lightning, the fading bolt. */
    private retire(av: AreaView): void {
        const { data } = this.inp;
        if (!av.exploded) {
            av.exploded = true;
            this.emitters.push(...this.spawnEmitters(av.rig, p => /Explosion|Impact|Rocks/i.test(p), true));
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
        if (!rig) {
            return {
                layer: 1, order: 3, y: s.y, seq: 0,
                draw: c => { c.fillStyle = s.isAllied ? '#facc15' : '#ef4444'; c.beginPath(); c.arc(s.x, s.y, 0.12, 0, Math.PI * 2); c.fill(); },
            };
        }
        const pi = rig.nodes[0].mb?.ProjectileItem;
        let rot = 0, flipY = 1;
        if (pi?.AlignToVelocity !== false) {
            rot = ang;
            // ProjectileView flips shots that fly left so the sprite is not upside down.
            if (s.vx < 0) flipY = -1;
        }
        if (pi?.Rotates) rot += this.battleTime * (pi.RotationSpeed ?? 0);
        rig.update(mul([1, 0, 0, 1, s.x, s.y], trs(0, 0, rot, 1, flipY)));
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

