import { type BattleVisualData, type ParticleDef, type TextureCache } from '../Battle/gameView/visualData';
import { RigInstance, rigItems, sortItems, layerIndex, mul, trs, IDENTITY, type DrawItem, type Mat } from '../Battle/gameView/rig';
import { Emitter, tintTexture } from '../Battle/gameView/particles';
import { buildUnit, lookFromProfile, mountedItems, DEATH_EFFECT_OFFSET, type UnitView } from '../Battle/gameView/scene';
import type { UserProfile } from '../../types/Profile';
import { ballisticDirection, GRAVITY_Y } from '../../engine/scene';

/**
 * One character drawn the way the battle view draws it (scene.ts): the character with its skins
 * and weapon on its mount, the pets at their PetVisual.PetOffsets slots behind it, the fairy
 * hovering, the set's IdleEffect when it wears a complete maxed set (UnitSetEffectsView), and
 * optionally a battlefield behind it (a map tile of an age, a dungeon or an arena, on its ground
 * colour, the character on the road).
 *
 * Time moves only through step(dt), so the same scene plays live on a canvas, pauses, steps frame
 * by frame, or renders a GIF at a fixed frame rate. Particles are random, as in the game.
 *
 * Without a timeline the character loops its "Walk" state. A timeline plays states in order and
 * repeats: Walk (the controller's Walk clip while the battlefield scrolls at the default move
 * speed), Attack (the Attack clip once, and for a weapon with a projectile the shot leaves the
 * muzzle at the windup and flies the weapon's range) and Death (the unit, its mount, pets and
 * fairy vanish and UnitDeathEffectsView plays, as the battle view does: the game has no death clip).
 */

/** One state of a timeline. */
export type TimelineStep = { kind: 'walk'; seconds: number } | { kind: 'attack' } | { kind: 'death' };

/** UnitConstants.DefaultMovespeed (engine/types.ts): world units a second, before MoveSpeed stats. */
const DEFAULT_MOVE_SPEED = 2.0;
/** Width of one battlefield tile: MainBattleMapSystem places them 24 units apart. */
const TILE_WIDTH = 24;
/** Longest a death effect is allowed to run before the timeline moves on, seconds. */
const DEATH_MAX = 4;

/** A battlefield: one MapElementView prefab and the ground colour around it. */
export interface PortraitBackground {
    prefab: string;
    ground: number[];
}

export interface PortraitOptions {
    profile: UserProfile;
    /** BaseSetId of the complete, maxed set the build wears (its idle aura), if any. */
    setId?: string | null;
    /** Draw the pets and the fairy too. */
    pets?: boolean;
    background?: PortraitBackground | null;
    /**
     * The equipped weapon is ranged (WeaponLibrary.IsRanged): a weapon skin then shows its ranged
     * variant, as GetSkinnedItemId (0x77FB0B0) picks the -1001 row for a ranged weapon.
     */
    weaponRanged?: boolean;
    /** States to play in order, repeating; empty or missing: the Walk state loops. */
    timeline?: TimelineStep[];
}

interface Segment { step: TimelineStep; start: number; length: number }

/** A weapon shot of the Attack state: from the muzzle at the windup, along the engine's aim. */
interface Shot { rig: RigInstance; at: number; x0: number; y0: number; vx: number; vy: number; gravity: boolean; flight: number; align: boolean; spin: number }

/** Height (world units) of the middle of a character standing on a mount, from its feet. */
const FIGURE_MID = 0.85;
/** The same with pets around it: flying pets and the fairy reach higher. */
const GROUP_MID = 1.3;
/** Where on a map tile the character stands (world units from the tile origin). */
const MAP_X = 8;

function emittersOf(rig: RigInstance, data: BattleVisualData, once = false): Emitter[] {
    const out: Emitter[] = [];
    rig.nodes.forEach((nd, i) => {
        if (!nd.ps || !rig.isVisible(i)) return;
        const ps = nd.ps as ParticleDef;
        out.push(new Emitter(ps, rig.world[i] ?? IDENTITY, ps.renderer?.order ?? 0, layerIndex(data, ps.renderer?.layer), once));
    });
    return out;
}

export class PortraitScene {
    /** Seconds of animation played so far. */
    t = 0;
    private readonly unit: UnitView;
    private readonly walkClip: string | undefined;
    private readonly aura: RigInstance | null;
    private readonly auraEmitters: Emitter[] = [];
    private fairyEmitters: Emitter[] | null = null;
    private readonly map: RigInstance | null;
    private readonly laneY: number;
    private readonly ux: number;
    private readonly segments: Segment[] = [];
    private readonly total: number = 0;
    private readonly shot: Shot | null = null;
    private deathEmitters: Emitter[] = [];
    /** The segment the last step ended in (loop * segments + index), to spot a new Death. */
    private lastSegment = -1;

    constructor(private readonly data: BattleVisualData, private readonly tex: TextureCache, private readonly opts: PortraitOptions) {
        // lookFromProfile shows the item under a hidden skin (useSkinWindup, misc.skinVisible).
        const look = lookFromProfile(data, opts.profile, { weaponRanged: !!opts.weaponRanged });
        // A small frame shows pets and fairy as icons; drawn there they would bury the character.
        if (!opts.pets) { look.pets = []; look.fairy = undefined; }
        this.unit = buildUnit(data, look, 'unit');
        this.walkClip = this.unit.controller?.Walk;
        // The unit stands right of centre when pets trail behind it on the left; alone, a hair
        // left of centre, since the weapon reaches further right than the back.
        this.ux = this.unit.pets.length ? 1.0 : -0.25;
        const fx = opts.setId ? data.setEffects?.[opts.setId] : undefined;
        this.aura = fx?.idle && data.prefabs[fx.idle] ? new RigInstance(data, fx.idle) : null;
        if (this.aura) {
            this.aura.update(this.root);
            this.auraEmitters = emittersOf(this.aura, data);
        }
        const bg = opts.background;
        this.map = bg && data.prefabs[bg.prefab] ? new RigInstance(data, bg.prefab) : null;
        const road = this.map?.nodes.find(n => n.n.startsWith('RoadPiece'));
        this.laneY = road ? road.m[5] : 0;

        this.shot = this.makeShot();
        const attackClip = this.unit.controller?.Attack ? data.clips[this.unit.controller.Attack] : undefined;
        const attackLength = Math.max(attackClip?.length ?? 1, this.shot ? this.shot.at + this.shot.flight : 0);
        let start = 0;
        for (const step of opts.timeline ?? []) {
            const length = step.kind === 'walk' ? Math.max(0.1, step.seconds) : step.kind === 'attack' ? attackLength : this.deathSeconds();
            this.segments.push({ step, start, length });
            start += length;
        }
        this.total = start;
        this.preload();
        this.step(0);
    }

    /**
     * Textures load on first use: the shot and the death effect appear for a fraction of a second,
     * so their sheets (and the battlefield's) are requested now, not on the frame that needs them.
     */
    private preload(): void {
        const { data, tex } = this;
        const dying = this.segments.some(s => s.step.kind === 'death');
        const rigs = [this.map, this.shot?.rig, ...(dying ? this.deathPrefabs().map(p => new RigInstance(data, p)) : [])];
        for (const rig of rigs) {
            if (!rig) continue;
            for (const nd of rig.nodes) {
                const sp = nd.s ? data.sprites[nd.s] : undefined;
                if (sp?.tex) tex.get(sp.tex);
                const mat = (nd.ps as ParticleDef | undefined)?.renderer?.material;
                const t = mat ? mat.tex._BaseMap ?? mat.tex._MainTex : null;
                if (t) tex.get(t);
            }
        }
    }

    /** The shot of an Attack: the shown weapon's projectile prefab, windup, range and offsets. */
    private makeShot(): Shot | null {
        const { data, unit } = this;
        const wd = unit.weaponData;
        if (!unit.projectile || !data.prefabs[unit.projectile] || !wd) return null;
        const rig = new RigInstance(data, unit.projectile);
        const pi = rig.nodes[0].mb?.ProjectileItem ?? {};
        const speed = pi.ProjectileSpeed ?? 0;
        if (speed <= 0) return null;
        // ExecuteAttack, not aiming: start = Position + HandOffset + UnitOffSet + WeaponOffset.
        const x0 = (wd.HandOffset?.x ?? 0) + (wd.WeaponOffset?.x ?? 0) + (unit.mount ? unit.mountOffset[0] : 0);
        const y0 = (wd.HandOffset?.y ?? 0) + (wd.WeaponOffset?.y ?? 0) + (unit.mount ? unit.mountOffset[1] : 0);
        // No enemy here: the shot aims at a point its weapon's range ahead, at the muzzle's height.
        const range = Math.max(1, wd.AttackRange ?? 7);
        const gravity = !!pi.IsAffectedByGravity;
        const dir = gravity ? ballisticDirection(range, 0, speed) : { x: 1, y: 0 };
        const vx = dir.x * speed, vy = dir.y * speed;
        return {
            rig, at: wd.WindUpTime ?? 0, x0, y0, vx, vy, gravity, flight: vx > 0 ? range / vx : 0,
            align: pi.AlignToVelocity !== false, spin: pi.Rotates ? pi.RotationSpeed ?? 0 : 0,
        };
    }

    /** The death effects: UnitDeathEffectsView, and the worn maxed set's DeathEffect (UnitSetEffectsView.OnDeath 0x4045894). */
    private deathPrefabs(): string[] {
        const set = this.opts.setId ? this.data.setEffects?.[this.opts.setId]?.death : undefined;
        return ['UnitDeathEffectsView', set].filter((p): p is string => !!p && !!this.data.prefabs[p]);
    }

    /**
     * How long the death effects play: their particles' lifetime over the system's speed, after
     * their burst. A system outliving DEATH_MAX (the ground splatter stays a minute) is left out.
     */
    private deathSeconds(): number {
        let longest = 0.5;
        for (const prefab of this.deathPrefabs()) {
            for (const nd of this.data.prefabs[prefab].nodes) {
                const ps = nd.ps as ParticleDef | undefined;
                if (!ps) continue;
                const life = (ps.lifetime?.max ?? 0) / (ps.simSpeed || 1);
                const at = Math.max(0, ...(ps.bursts ?? []).map(b => b.t)) / (ps.simSpeed || 1);
                if (life <= DEATH_MAX) longest = Math.max(longest, at + life);
            }
        }
        return longest + 0.1;
    }

    /** The timeline state at time `t`: its segment, the time into it and the loop it is in. */
    private at(t: number): { seg: Segment; local: number; key: number } | null {
        if (!this.segments.length || this.total <= 0) return null;
        const loop = Math.floor(t / this.total);
        const tt = t - loop * this.total;
        const i = Math.max(0, this.segments.findIndex(s => tt < s.start + s.length));
        const seg = this.segments[i];
        return { seg, local: tt - seg.start, key: loop * this.segments.length + i };
    }

    /** World units walked by time `t` in the current loop (the battlefield scrolls by it). */
    private walked(t: number): number {
        const now = this.at(t);
        if (!now) return 0;
        let d = 0;
        for (const s of this.segments) {
            if (s === now.seg) { if (s.step.kind === 'walk') d += now.local; break; }
            if (s.step.kind === 'walk') d += s.length;
        }
        return d * DEFAULT_MOVE_SPEED;
    }

    /** Length of one loop: the whole timeline, or the character's own Walk clip without one, seconds. */
    get loopSeconds(): number {
        if (this.total > 0) return this.total;
        const clip = this.walkClip ? this.data.clips[this.walkClip] : undefined;
        return clip?.length && clip.length > 0 ? clip.length : 1;
    }

    private get root(): Mat {
        return [1, 0, 0, 1, this.ux, 0];
    }

    step(dt: number): void {
        this.t += dt;
        for (const em of this.auraEmitters) em.update(dt);
        for (const em of this.fairyEmitters ?? []) em.update(dt);
        const now = this.at(this.t);
        if (now && now.key !== this.lastSegment) {
            this.lastSegment = now.key;
            if (now.seg.step.kind === 'death') {
                // PlayDeathEffect 0x4043FE4: the pop and the ground splatter Emit(1) at the unit's
                // centre (UnitConstants.CenterOfMass); a set's DeathEffect prefab plays on its own.
                const at: Mat = [1, 0, 0, 1, this.ux + DEATH_EFFECT_OFFSET.x, DEATH_EFFECT_OFFSET.y];
                this.deathEmitters = this.deathPrefabs().flatMap(prefab => {
                    const fx = new RigInstance(this.data, prefab);
                    fx.update(at);
                    const pool = prefab === 'UnitDeathEffectsView';
                    const ems = emittersOf(fx, this.data, pool);
                    if (pool) for (const em of ems) em.burst(1);
                    return ems;
                });
            }
        }
        for (const em of this.deathEmitters) em.update(dt);
        this.deathEmitters = this.deathEmitters.filter(em => !em.done);
    }

    /**
     * Draws the current frame. `width`/`height` in CSS pixels, `dpr` the backing store ratio,
     * `scale` pixels per world unit; 'center' centres the figure, 'bottom' stands it near the bottom.
     */
    draw(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, anchor: 'bottom' | 'center', dpr: number): void {
        const { data, tex, unit } = this;
        const t = this.t;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (this.map && this.opts.background) {
            const g = this.opts.background.ground;
            ctx.fillStyle = `rgb(${Math.round(g[0] * 255)},${Math.round(g[1] * 255)},${Math.round(g[2] * 255)})`;
            ctx.fillRect(0, 0, width, height);
        }
        const mid = this.unit.pets.length ? GROUP_MID : FIGURE_MID;
        const originY = anchor === 'center' ? height / 2 + mid * scale : height * 0.88;
        ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, (width / 2) * dpr, originY * dpr);

        const items: DrawItem[] = [];
        const now = this.at(t);
        if (this.map) {
            // Walking, the camera follows the character: the battlefield slides back, tile after tile.
            const off = this.walked(t) % TILE_WIDTH;
            for (const k of [-1, 0, 1]) {
                this.map.update([1, 0, 0, 1, -MAP_X - off + k * TILE_WIDTH, -this.laneY]);
                items.push(...rigItems(this.map, tex));
            }
        }
        for (const em of this.deathEmitters) {
            const img = em.texture ? tex.get(em.texture) : null;
            items.push({ layer: em.layer, order: em.order, y: em.origin[5], seq: 0, draw: c => em.draw(c, img, tintTexture) });
        }
        // Dead: UnitView and everything that follows it are gone, only the death effect plays.
        if (now?.seg.step.kind === 'death') {
            sortItems(items);
            for (const it of items) it.draw(ctx);
            return;
        }
        const root = this.root;
        const rig = unit.rig;
        rig.clearAnimation();
        const attacking = now?.seg.step.kind === 'attack';
        const attackClip = unit.controller?.Attack ? data.clips[unit.controller.Attack] : undefined;
        if (attacking && attackClip) rig.applyClip(attackClip, now!.local, false);
        else rig.applyClip(this.walkClip ? data.clips[this.walkClip] : undefined, t, true);
        if (attacking && this.shot && now!.local >= this.shot.at && now!.local < this.shot.at + this.shot.flight) {
            const sh = this.shot;
            const tau = now!.local - sh.at;
            const g = sh.gravity ? GRAVITY_Y : 0;
            const x = this.ux + sh.x0 + sh.vx * tau;
            const y = sh.y0 + sh.vy * tau + 0.5 * g * tau * tau;
            const vy = sh.vy + g * tau;
            // As ProjectileView.Update: the sprite's up axis along the flight, or a steady spin.
            const rot = sh.align ? (Math.atan2(vy, sh.vx) * 180) / Math.PI - 90 : sh.spin * tau;
            sh.rig.update(mul([1, 0, 0, 1, x, y], trs(0, 0, rot, 1, 1)));
            const list = rigItems(sh.rig, tex);
            items.push({ layer: 1, order: 3, y, seq: 0, draw: c => { for (const it of list) it.draw(c); } });
        }
        if (unit.mount) {
            rig.setLocalPosition(unit.charRig, unit.mountOffset[0], unit.mountOffset[1]);
            if (unit.unitShadow >= 0) rig.nodes[unit.unitShadow].hidden = true;
        }
        rig.update(root);
        const unitItems = rigItems(rig, tex, undefined, (i) => i === unit.hpBar);
        if (unit.mount) {
            unit.mount.clearAnimation();
            if (unit.mountClip) unit.mount.applyClip(data.clips[unit.mountClip], t, true);
            unit.mount.update(root);
            const all = mountedItems(unit.mount, tex, unitItems);
            items.push({ layer: 1, order: 0, y: 0, seq: 0, draw: c => { for (const it of all) it.draw(c); } });
        } else items.push(...unitItems);
        for (const p of unit.pets) {
            const offs = p.rig.nodes[0].mb?.PetVisual?.PetOffsets?.[p.slot] ?? { x: -1.5, y: 0 };
            p.rig.clearAnimation();
            if (p.clip) p.rig.applyClip(data.clips[p.clip], t, true);
            p.rig.update([1, 0, 0, 1, this.ux + offs.x, offs.y]);
            items.push(...rigItems(p.rig, tex));
        }
        if (unit.fairy) {
            const f = unit.fairy;
            f.rig.clearAnimation();
            if (f.clip) f.rig.applyClip(data.clips[f.clip], t, true);
            const body = f.rig.find('Body');
            const sc = Math.hypot(f.rig.nodes[0].m[0], f.rig.nodes[0].m[1]) || 1;
            if (body >= 0) f.rig.setLocalPosition(body, 0, (f.hover + Math.sin(t * f.speed * Math.PI) * 0.5 * sc) / sc);
            f.rig.update([1, 0, 0, 1, this.ux - 1.0, 0]);
            items.push(...rigItems(f.rig, tex));
            if (!this.fairyEmitters) this.fairyEmitters = emittersOf(f.rig, data);
            const fe = this.fairyEmitters;
            f.rig.nodes.forEach((nd, i) => { if (nd.ps) { const em = fe.find(e => e.def === nd.ps); if (em) em.origin = f.rig.world[i]; } });
        }
        if (this.aura) items.push(...rigItems(this.aura, tex));
        for (const em of [...this.auraEmitters, ...(this.fairyEmitters ?? [])]) {
            const img = em.texture ? tex.get(em.texture) : null;
            items.push({ layer: em.layer, order: em.order, y: em.origin[5], seq: 0, draw: c => em.draw(c, img, tintTexture) });
        }
        sortItems(items);
        for (const it of items) it.draw(ctx);
    }
}

/** Every battlefield the character maker offers: one per age, dungeon and arena, by label. */
export function portraitBackgrounds(data: BattleVisualData): { id: string; label: string; bg: PortraitBackground }[] {
    const out: { id: string; label: string; bg: PortraitBackground }[] = [];
    data.ages.forEach((a, i) => { if (a.maps[0]) out.push({ id: `age:${i}`, label: a.name.replace(/([a-z])([A-Z])/g, '$1 $2'), bg: { prefab: a.maps[0], ground: a.ground } }); });
    // Dungeon titles are localization keys ("HammerDungeonTitle"): shown as "Hammer dungeon".
    const dungeonLabel = (t: string) => `${t.replace(/DungeonTitle$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')} dungeon`;
    for (const [k, d] of Object.entries(data.dungeons)) if (d.maps[0]) out.push({ id: `dungeon:${k}`, label: dungeonLabel(d.title), bg: { prefab: d.maps[0], ground: d.ground } });
    const pvp: Record<string, string> = { ArenaPvpMap: 'Arena', GuildWarMap: 'Guild War', ChatPvpMap: 'Chat duel' };
    for (const [k, m] of Object.entries(data.pvpMaps)) if (m.maps[0]) out.push({ id: `pvp:${k}`, label: pvp[k] ?? k, bg: { prefab: m.maps[0], ground: m.ground } });
    return out;
}

/** WeaponLibrary.IsRanged of the profile's equipped weapon. */
export function isRangedWeapon(profile: UserProfile, weaponLibrary: Record<string, any> | null | undefined): boolean {
    const w = profile.items.Weapon;
    return !!w && weaponLibrary?.[`{'Age': ${w.age}, 'Type': 'Weapon', 'Idx': ${w.idx}}`]?.IsRanged === true;
}
