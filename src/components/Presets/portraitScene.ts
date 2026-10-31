import { type BattleVisualData, type ParticleDef, type TextureCache } from '../Battle/gameView/visualData';
import { RigInstance, rigItems, sortItems, layerIndex, IDENTITY, type DrawItem, type Mat } from '../Battle/gameView/rig';
import { Emitter, tintTexture } from '../Battle/gameView/particles';
import { buildUnit, lookFromProfile, type UnitView } from '../Battle/gameView/scene';
import type { UserProfile } from '../../types/Profile';

/**
 * One character drawn the way the battle view draws it (scene.ts): the character with its skins
 * and weapon on its mount, the pets at their PetVisual.PetOffsets slots behind it, the fairy
 * hovering, the set's IdleEffect when it wears a complete maxed set (UnitSetEffectsView), and
 * optionally a battlefield behind it (a map tile of an age, a dungeon or an arena, on its ground
 * colour, the character on the road).
 *
 * Time moves only through step(dt), so the same scene plays live on a canvas, pauses, steps frame
 * by frame, or renders a GIF at a fixed frame rate. Particles are random, as in the game.
 */

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
}

/** Height (world units) of the middle of a character standing on a mount, from its feet. */
const FIGURE_MID = 0.85;
/** The same with pets around it: flying pets and the fairy reach higher. */
const GROUP_MID = 1.3;
/** Where on a map tile the character stands (world units from the tile origin). */
const MAP_X = 8;

function emittersOf(rig: RigInstance, data: BattleVisualData): Emitter[] {
    const out: Emitter[] = [];
    rig.nodes.forEach((nd, i) => {
        if (!nd.ps || !rig.isVisible(i)) return;
        const ps = nd.ps as ParticleDef;
        out.push(new Emitter(ps, rig.world[i] ?? IDENTITY, ps.renderer?.order ?? 0, layerIndex(data, ps.renderer?.layer), false));
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
    }

    /** Length of one loop of the character's own animation (the Walk clip), seconds. */
    get loopSeconds(): number {
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
        if (this.map) {
            this.map.update([1, 0, 0, 1, -MAP_X, -this.laneY]);
            items.push(...rigItems(this.map, tex));
        }
        const root = this.root;
        const rig = unit.rig;
        rig.clearAnimation();
        rig.applyClip(this.walkClip ? data.clips[this.walkClip] : undefined, t, true);
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
            const all = [...rigItems(unit.mount, tex), ...unitItems];
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
