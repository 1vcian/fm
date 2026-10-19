/**
 * Prefab instances drawn the way Unity draws them: a transform hierarchy (local TRS, optionally
 * driven by an AnimationClip), SpriteRenderers with their tint, flip, sorting layer and order, and
 * SortingGroups that sort a subtree as one item. Several prefabs can be merged into one instance
 * (the unit rig plus its helmet, armour and weapon prefabs, parented where the game parents them).
 */
import type { BattleVisualData, Clip, PrefabNode, SpriteDef, TextureCache } from './visualData';

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(p: Mat, q: Mat): Mat {
    return [
        p[0] * q[0] + p[2] * q[1],
        p[1] * q[0] + p[3] * q[1],
        p[0] * q[2] + p[2] * q[3],
        p[1] * q[2] + p[3] * q[3],
        p[0] * q[4] + p[2] * q[5] + p[4],
        p[1] * q[4] + p[3] * q[5] + p[5],
    ];
}

export function trs(x: number, y: number, rotDeg: number, sx: number, sy: number): Mat {
    const r = (rotDeg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [c * sx, s * sx, -s * sy, c * sy, x, y];
}

interface Trs { x: number; y: number; rot: number; sx: number; sy: number }

function decompose(m: number[]): Trs {
    const sx = Math.hypot(m[0], m[1]);
    const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const det = m[0] * m[3] - m[1] * m[2];
    return { x: m[4], y: m[5], rot, sx, sy: sx > 1e-9 ? det / sx : 0 };
}

export interface RigNode extends PrefabNode {
    base: Trs;
    /** Index in the merged instance; parent index is remapped too. */
    hidden?: boolean;
    /** Extra tint multiplied on top of the renderer colour (sprite highlight / fades). */
    alpha?: number;
}

/** Layer index of a sorting layer id (TagManager order: Background, Default, Overlay, DmgNumbers). */
export function layerIndex(data: BattleVisualData, id: number | undefined): number {
    const i = data.sortingLayers.findIndex(l => l.id === (id ?? 0));
    return i < 0 ? 1 : i;
}

export class RigInstance {
    nodes: RigNode[] = [];
    world: Mat[] = [];
    /** Local overrides from animation, keyed by node index. */
    private animated = new Map<number, Partial<Trs>>();
    private animRoot = 0;
    private pathIndex = new Map<string, number>();

    constructor(readonly data: BattleVisualData, prefab: string) {
        this.append(prefab, -1);
    }

    /** Append a prefab under `parent` (node index). Returns the index of its root node, or -1. */
    append(prefab: string | null | undefined, parent: number, localOverride?: Mat): number {
        const p = prefab ? this.data.prefabs[prefab] : undefined;
        if (!p) return -1;
        const offset = this.nodes.length;
        p.nodes.forEach((n, i) => {
            const m = i === 0 && localOverride ? localOverride : n.m;
            this.nodes.push({ ...n, p: n.p < 0 ? parent : n.p + offset, base: decompose(m), m });
        });
        return offset;
    }

    find(name: string, from = 0): number {
        for (let i = from; i < this.nodes.length; i++) if (this.nodes[i].n === name) return i;
        return -1;
    }

    /** Use `node` (an Animator holder) as the root that clip paths are relative to. */
    setAnimRoot(node: number): void {
        this.animRoot = node;
        this.pathIndex.clear();
        const rootPath = this.nodes[node]?.path ?? '';
        // Paths of merged prefabs restart at their own root: rebuild full relative paths by walking.
        const rel = (i: number): string | null => {
            const parts: string[] = [];
            let k = i;
            while (k >= 0 && k !== node) {
                parts.unshift(this.nodes[k].n);
                k = this.nodes[k].p;
            }
            return k === node ? parts.join('/') : null;
        };
        for (let i = 0; i < this.nodes.length; i++) {
            const r = rel(i);
            if (r !== null && !this.pathIndex.has(r)) this.pathIndex.set(r, i);
        }
        void rootPath;
    }

    clearAnimation(): void {
        this.animated.clear();
    }

    /** Sample `clip` at `time` seconds (clamped or wrapped) onto the rig. */
    applyClip(clip: Clip | undefined, time: number, loop: boolean): void {
        if (!clip) return;
        const len = clip.length;
        let t = time;
        if (len > 0) t = loop ? ((t % len) + len) % len : Math.max(0, Math.min(len, t));
        const f = t * clip.rate;
        for (const cv of clip.curves) {
            const idx = this.pathIndex.get(cv.path);
            if (idx === undefined) continue;
            const v = cv.v;
            let val: number;
            if (v.length === 1) val = v[0];
            else {
                const i0 = Math.min(v.length - 1, Math.floor(f));
                const i1 = Math.min(v.length - 1, i0 + 1);
                const a = f - Math.floor(f);
                val = v[i0] + (v[i1] - v[i0]) * a;
            }
            const o = this.animated.get(idx) ?? {};
            if (cv.prop === 'pos') {
                if (cv.c === 'x') o.x = val;
                else if (cv.c === 'y') o.y = val;
            } else if (cv.prop === 'euler') {
                if (cv.c === 'z') o.rot = val;
                else if (cv.c === 'y' && Math.abs(Math.abs(val) - 180) < 1) o.sx = -(o.sx ?? Math.abs(this.nodes[idx].base.sx));
            } else if (cv.prop === 'scale') {
                if (cv.c === 'x') o.sx = val;
                else if (cv.c === 'y') o.sy = val;
            }
            this.animated.set(idx, o);
        }
    }

    /** Add an angle on top of whatever drives a node this frame (aiming). */
    addRotation(node: number, deg: number): void {
        if (node < 0) return;
        const o = this.animated.get(node) ?? {};
        o.rot = (o.rot ?? this.nodes[node].base.rot) + deg;
        this.animated.set(node, o);
    }

    setLocalPosition(node: number, x: number, y: number): void {
        if (node < 0) return;
        const o = this.animated.get(node) ?? {};
        o.x = x;
        o.y = y;
        this.animated.set(node, o);
    }

    /** World matrices for this frame. */
    update(rootWorld: Mat): void {
        const n = this.nodes.length;
        if (this.world.length !== n) this.world = new Array(n);
        for (let i = 0; i < n; i++) {
            const nd = this.nodes[i];
            const a = this.animated.get(i);
            const b = nd.base;
            const local = a
                ? trs(a.x ?? b.x, a.y ?? b.y, a.rot ?? b.rot, a.sx ?? b.sx, a.sy ?? b.sy)
                : (nd.m as Mat);
            const parent = nd.p >= 0 ? this.world[nd.p] : rootWorld;
            this.world[i] = mul(parent ?? rootWorld, local);
        }
    }

    isVisible(i: number): boolean {
        let k = i;
        while (k >= 0) {
            const nd = this.nodes[k];
            if (nd.off || nd.hidden) return false;
            k = nd.p;
        }
        return true;
    }
}

// ---------------------------------------------------------------- drawing

/** Multiply-tinted copies of sprites (Unity multiplies the sprite by the renderer colour). */
const tintCache = new Map<string, HTMLCanvasElement>();

function tinted(img: HTMLImageElement, key: string, def: SpriteDef, rgb: number[]): CanvasImageSource {
    const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 63);
    const ck = `${key}|${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
    let c = tintCache.get(ck);
    if (!c) {
        c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(def.w));
        c.height = Math.max(1, Math.round(def.h));
        const g = c.getContext('2d')!;
        g.drawImage(img, def.x, def.y, def.w, def.h, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(img, def.x, def.y, def.w, def.h, 0, 0, c.width, c.height);
        if (tintCache.size > 1500) tintCache.clear();
        tintCache.set(ck, c);
    }
    return c;
}

const isWhite = (c: number[]) => c[0] > 0.995 && c[1] > 0.995 && c[2] > 0.995;

/**
 * Draw one sprite with world matrix `m` (y up). The context must already hold the camera
 * transform. Returns false when the texture is not loaded yet.
 */
export function drawSprite(
    ctx: CanvasRenderingContext2D, data: BattleVisualData, tex: TextureCache, key: string, m: Mat,
    color: number[] = [1, 1, 1, 1], flipX = false, flipY = false,
): boolean {
    const def = data.sprites[key];
    if (!def) return false;
    const img = tex.get(def.tex);
    if (!img) return false;
    const a = color[3] ?? 1;
    if (a <= 0.003) return true;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const inv = 1 / def.ppu;
    ctx.scale(flipX ? -inv : inv, flipY ? inv : -inv);
    // Sprite rect in pixels, origin at the pivot, y down after the flip above.
    const left = -def.px * def.ow + def.ox;
    const top = -(1 - def.py) * def.oh + (def.oh - def.oy - def.h);
    ctx.globalAlpha *= a;
    if (isWhite(color)) ctx.drawImage(img, def.x, def.y, def.w, def.h, left, top, def.w, def.h);
    else ctx.drawImage(tinted(img, key, def, color), 0, 0, def.w, def.h, left, top, def.w, def.h);
    ctx.restore();
    return true;
}

export interface DrawItem {
    layer: number;
    order: number;
    /** World y of the item's pivot: Unity's transparency sort draws higher y first. */
    y: number;
    seq: number;
    draw: (ctx: CanvasRenderingContext2D) => void;
}

export function sortItems(items: DrawItem[]): void {
    items.sort((p, q) => p.layer - q.layer || p.order - q.order || q.y - p.y || p.seq - q.seq);
}

/**
 * The sortable items of an instance. A node with a SortingGroup becomes one item whose children
 * are sorted inside it; renderers outside any group are items of their own.
 */
export function rigItems(
    rig: RigInstance, tex: TextureCache, tintAll?: number[], skip?: (i: number) => boolean,
    customDraw?: Map<number, (ctx: CanvasRenderingContext2D, m: Mat) => void>,
): DrawItem[] {
    const { nodes, world, data } = rig;
    const groupOf = new Array<number>(nodes.length);
    const isGroup = (i: number) => !!nodes[i].sg;
    for (let i = 0; i < nodes.length; i++) {
        let k = nodes[i].p;
        while (k >= 0 && !isGroup(k)) k = nodes[k].p;
        groupOf[i] = k; // nearest ancestor group (-1 = top level)
    }
    // children lists per group (renderers and subgroups)
    const members = new Map<number, number[]>();
    for (let i = 0; i < nodes.length; i++) {
        if (skip?.(i)) continue;
        const nd = nodes[i];
        const renders = (nd.s && !nd.srOff) || customDraw?.has(i);
        // A group node's own sprite sorts inside its own group.
        if (isGroup(i)) {
            const parentGroup = groupOf[i];
            const list = members.get(parentGroup) ?? [];
            list.push(-(i + 1)); // subgroup marker
            members.set(parentGroup, list);
            if (renders) {
                const own = members.get(i) ?? [];
                own.push(i);
                members.set(i, own);
            }
        } else if (renders) {
            const list = members.get(groupOf[i]) ?? [];
            list.push(i);
            members.set(groupOf[i], list);
        }
    }
    const tint = (c: number[] | undefined): number[] => {
        const base = c ?? [1, 1, 1, 1];
        if (!tintAll) return base;
        return [base[0] * tintAll[0], base[1] * tintAll[1], base[2] * tintAll[2], base[3] * tintAll[3]];
    };
    const drawNode = (ctx: CanvasRenderingContext2D, i: number) => {
        if (!rig.isVisible(i)) return;
        const nd = nodes[i];
        const cd = customDraw?.get(i);
        if (cd) { cd(ctx, world[i]); return; }
        if (nd.s) {
            let c = tint(nd.c);
            if (nd.alpha !== undefined) c = [c[0], c[1], c[2], c[3] * nd.alpha];
            drawSprite(ctx, data, tex, nd.s, world[i], c, !!nd.fx, !!nd.fy);
        }
    };
    const keyOf = (entry: number) => {
        const i = entry < 0 ? -entry - 1 : entry;
        const nd = nodes[i];
        if (entry < 0) return { layer: layerIndex(data, nd.sg![0]), order: nd.sg![1], i };
        return { layer: layerIndex(data, nd.l), order: nd.o ?? 0, i };
    };
    const drawGroup = (ctx: CanvasRenderingContext2D, g: number) => {
        if (!rig.isVisible(g)) return;
        const list = (members.get(g) ?? []).map(keyOf);
        list.sort((p, q) => p.layer - q.layer || p.order - q.order || p.i - q.i);
        for (const e of list) {
            if (nodes[e.i].sg && e.i !== g) drawGroup(ctx, e.i);
            else drawNode(ctx, e.i);
        }
    };
    const out: DrawItem[] = [];
    for (const entry of members.get(-1) ?? []) {
        const k = keyOf(entry);
        const i = k.i;
        out.push({
            layer: k.layer, order: k.order, y: world[i]?.[5] ?? 0, seq: i,
            draw: entry < 0 ? (ctx) => drawGroup(ctx, i) : (ctx) => drawNode(ctx, i),
        });
    }
    return out;
}
