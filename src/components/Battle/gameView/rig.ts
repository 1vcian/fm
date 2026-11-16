/**
 * Prefab instances drawn the way Unity draws them: a transform hierarchy (local TRS, optionally
 * driven by an AnimationClip), SpriteRenderers with their tint, flip, sorting layer and order, and
 * SortingGroups that sort a subtree as one item. Several prefabs can be merged into one instance
 * (the unit rig plus its helmet, armour and weapon prefabs, parented where the game parents them).
 */
import type { BattleVisualData, Clip, PrefabNode, SkinnedMesh, SpriteDef, TextureCache } from './visualData';

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

/** A float curve on SpriteRenderer m_Color.a (class 212, attribute hash 304273561): the sprite's alpha. */
const SPRITE_ALPHA = 'float:212:304273561';

/*
 * Float curves a full clip (applyClip with full = true) also honours, keyed by class id and the
 * CRC32 of the property path, as the extractor writes them ("float:<class>:<crc>:<custom type>"):
 * SpriteRenderer (212) m_Color.r/g/b/a, m_Enabled, m_SortingOrder, m_FlipX, m_FlipY, m_Size.x/y,
 * and GameObject (1) m_IsActive. The skill views of build 2026_11_16_09_55 animate these.
 */
const FULL_FLOATS: Record<string, keyof Animated> = {
    'float:212:2526845255': 'cr',
    'float:212:4215373228': 'cg',
    'float:212:2334886179': 'cb',
    'float:212:304273561': 'ca',
    'float:212:3305885265': 'en',
    'float:212:3762991556': 'ord',
    'float:212:555744692': 'fx',
    'float:212:1444465954': 'fy',
    'float:212:4197328169': 'w',
    'float:212:2368279999': 'h',
    'float:1:2086281974': 'act',
};

/** What a frame's animation drives on a node: transform parts, and with a full clip the renderer and active state. */
interface Animated extends Partial<Trs> {
    a?: number;
    /** Local rotation as a quaternion (a full clip's m_LocalRotation curves). */
    qx?: number; qy?: number; qz?: number; qw?: number;
    cr?: number; cg?: number; cb?: number; ca?: number;
    en?: number; ord?: number; fx?: number; fy?: number; w?: number; h?: number; act?: number;
}

/** A node's renderer and active state as animated this frame (absent fields keep the prefab's). */
export interface LiveState { c?: number[]; srOff?: boolean; o?: number; fx?: boolean; fy?: boolean; size?: [number, number]; active?: boolean }

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
    /** Set by update() from a full clip: renderer colour, enabled, order, flip, size and active state. */
    live?: LiveState;
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
    private animated = new Map<number, Animated>();
    /**
     * Draw renderers with a draw mode (sliced / tiled) at their size (SpriteRenderer.size), the
     * sprite stretched to it: the skill views of build 2026_11_16_09_55 size their beams this way.
     */
    sized = false;
    private animRoot = 0;
    private pathIndex = new Map<string, number>();
    /**
     * Nodes parented outside this instance: their parent's world matrix. A rider's CharacterRig
     * hangs under its mount's UnitAnchor this way (UnitRotationView.Update 0x418B344).
     */
    parentWorld = new Map<number, Mat>();

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
            const node: RigNode = { ...n, p: n.p < 0 ? parent : n.p + offset, base: decompose(m), m };
            // Node references inside the prefab move with it.
            if (n.skinned) node.skinned = { ...n.skinned, bones: n.skinned.bones.map(b => (b >= 0 ? b + offset : b)) };
            if (n.anchorNode !== undefined && n.anchorNode >= 0) node.anchorNode = n.anchorNode + offset;
            this.nodes.push(node);
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
    applyClip(clip: Clip | undefined, time: number, loop: boolean, full = false): void {
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
            if (full) {
                const key = cv.prop === 'rot' ? (`q${cv.c}` as keyof Animated) : FULL_FLOATS[cv.prop.split(':').slice(0, 3).join(':')];
                if (key) {
                    (o as Record<string, number>)[key] = val;
                    this.animated.set(idx, o);
                    continue;
                }
            }
            if (cv.prop === 'pos') {
                if (cv.c === 'x') o.x = val;
                else if (cv.c === 'y') o.y = val;
            } else if (cv.prop === 'euler') {
                if (cv.c === 'z') o.rot = val;
                else if (cv.c === 'y' && Math.abs(Math.abs(val) - 180) < 1) o.sx = -(o.sx ?? Math.abs(this.nodes[idx].base.sx));
            } else if (cv.prop === 'scale') {
                if (cv.c === 'x') o.sx = val;
                else if (cv.c === 'y') o.sy = val;
            } else if (cv.prop.startsWith(SPRITE_ALPHA)) {
                o.a = val;
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

    setLocalScale(node: number, sx: number, sy: number): void {
        if (node < 0) return;
        const o = this.animated.get(node) ?? {};
        o.sx = sx;
        o.sy = sy;
        this.animated.set(node, o);
    }

    /** GameObject.SetActive on top of the prefab (and of any clip this frame). */
    setActive(node: number, on: boolean): void {
        if (node < 0) return;
        const o = this.animated.get(node) ?? {};
        o.act = on ? 1 : 0;
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
            let local: Mat;
            if (a && a.qw !== undefined) {
                // Quaternion curves: the 2D part of the rotation matrix, times the local scale.
                const qx = a.qx ?? 0, qy = a.qy ?? 0, qz = a.qz ?? 0, qw = a.qw;
                const sx = a.sx ?? b.sx, sy = a.sy ?? b.sy;
                local = [
                    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx,
                    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy,
                    a.x ?? b.x, a.y ?? b.y,
                ];
            } else local = a ? trs(a.x ?? b.x, a.y ?? b.y, a.rot ?? b.rot, a.sx ?? b.sx, a.sy ?? b.sy) : (nd.m as Mat);
            const parent = this.parentWorld.get(i) ?? (nd.p >= 0 ? this.world[nd.p] : rootWorld);
            this.world[i] = mul(parent ?? rootWorld, local);
            if (a?.a !== undefined) nd.alpha = a.a;
            nd.live = a ? liveOf(nd, a) : undefined;
        }
    }

    isVisible(i: number): boolean {
        let k = i;
        while (k >= 0) {
            const nd = this.nodes[k];
            const inactive = nd.live?.active !== undefined ? !nd.live.active : !!nd.off;
            if (inactive || nd.hidden) return false;
            k = nd.p;
        }
        return true;
    }
}

/** The renderer and active state a full clip (or setActive) drives this frame, or undefined. */
function liveOf(nd: PrefabNode, a: Animated): LiveState | undefined {
    if (a.cr === undefined && a.cg === undefined && a.cb === undefined && a.ca === undefined && a.en === undefined && a.ord === undefined
        && a.fx === undefined && a.fy === undefined && a.w === undefined && a.h === undefined && a.act === undefined) return undefined;
    const live: LiveState = {};
    if (a.cr !== undefined || a.cg !== undefined || a.cb !== undefined || a.ca !== undefined) {
        const c = nd.c ?? [1, 1, 1, 1];
        live.c = [a.cr ?? c[0], a.cg ?? c[1], a.cb ?? c[2], a.ca ?? c[3]];
    }
    if (a.en !== undefined) live.srOff = a.en < 0.5;
    if (a.ord !== undefined) live.o = Math.round(a.ord);
    if (a.fx !== undefined) live.fx = a.fx >= 0.5;
    if (a.fy !== undefined) live.fy = a.fy >= 0.5;
    if (a.w !== undefined || a.h !== undefined) {
        const d = (nd as PrefabNode & { draw?: { w: number; h: number } }).draw;
        live.size = [a.w ?? d?.w ?? 1, a.h ?? d?.h ?? 1];
    }
    if (a.act !== undefined) live.active = a.act >= 0.5;
    return live;
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
    color: number[] = [1, 1, 1, 1], flipX = false, flipY = false, size?: [number, number],
): boolean {
    const def = data.sprites[key];
    if (!def) return false;
    const img = tex.get(def.tex);
    if (!img) return false;
    const a = color[3] ?? 1;
    if (a <= 0.003) return true;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    // A sliced / tiled renderer at its size: the full sprite rect stretched to it (the slicing
    // borders are not exported, so the 9-slice is drawn as a plain stretch).
    if (size) ctx.scale(size[0] / (def.ow / def.ppu || 1), size[1] / (def.oh / def.ppu || 1));
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

/**
 * A SkinnedMeshRenderer drawn the way Unity skins it: every vertex at
 * sum(weight * boneWorld * bindPose * vertex), then each triangle of the texture mapped onto its
 * skinned triangle (an affine map per triangle, clipped to the triangle grown by a hair so the
 * seams between neighbours do not show).
 */
export function drawSkinned(ctx: CanvasRenderingContext2D, rig: RigInstance, mesh: SkinnedMesh, tex: TextureCache, color: number[]): boolean {
    const img = mesh.tex ? tex.get(mesh.tex) : undefined;
    if (!img) return false;
    const bone = mesh.bones.map((b, k) => mul(rig.world[b] ?? IDENTITY, (mesh.bind[k] ?? IDENTITY) as Mat));
    const n = mesh.v.length / 2;
    const pos = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
        const x = mesh.v[2 * i], y = mesh.v[2 * i + 1];
        let px = 0, py = 0;
        for (const [b, w] of mesh.w[i] ?? []) {
            const m = bone[b];
            if (!m) continue;
            px += w * (m[0] * x + m[2] * y + m[4]);
            py += w * (m[1] * x + m[3] * y + m[5]);
        }
        pos[2 * i] = px;
        pos[2 * i + 1] = py;
    }
    const W = img.width, H = img.height;
    ctx.save();
    ctx.globalAlpha *= color[3] ?? 1;
    const base = ctx.getTransform();
    const t = mesh.tris;
    for (let k = 0; k + 2 < t.length; k += 3) {
        const a = t[k], b = t[k + 1], c = t[k + 2];
        const x0 = pos[2 * a], y0 = pos[2 * a + 1], x1 = pos[2 * b], y1 = pos[2 * b + 1], x2 = pos[2 * c], y2 = pos[2 * c + 1];
        // Texture pixels: UV v runs up, image rows run down.
        const u0 = mesh.uv[2 * a] * W, v0 = (1 - mesh.uv[2 * a + 1]) * H;
        const u1 = mesh.uv[2 * b] * W, v1 = (1 - mesh.uv[2 * b + 1]) * H;
        const u2 = mesh.uv[2 * c] * W, v2 = (1 - mesh.uv[2 * c + 1]) * H;
        const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
        if (Math.abs(den) < 1e-9) continue;
        // The affine map taking (u, v) to (x, y) for this triangle.
        const ma = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den;
        const mb = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den;
        const mc = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
        const md = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
        const me = x0 - ma * u0 - mc * v0;
        const mf = y0 - mb * u0 - md * v0;
        const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
        const grow = 1.04;
        ctx.setTransform(base);
        ctx.beginPath();
        ctx.moveTo(cx + (x0 - cx) * grow, cy + (y0 - cy) * grow);
        ctx.lineTo(cx + (x1 - cx) * grow, cy + (y1 - cy) * grow);
        ctx.lineTo(cx + (x2 - cx) * grow, cy + (y2 - cy) * grow);
        ctx.closePath();
        ctx.save();
        ctx.clip();
        ctx.transform(ma, mb, mc, md, me, mf);
        // Only the triangle's own patch of the texture (plus a pixel), not the whole sheet.
        const sx = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1), sy = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1);
        const sw = Math.min(W, Math.ceil(Math.max(u0, u1, u2)) + 1) - sx, sh = Math.min(H, Math.ceil(Math.max(v0, v1, v2)) + 1) - sy;
        if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.restore();
    }
    ctx.restore();
    return true;
}

/** Scratch canvases for masked sprites (the sprite, and the union of the masks). */
let maskScratch: [HTMLCanvasElement, HTMLCanvasElement] | null = null;

/**
 * A sprite clipped by SpriteMasks: drawn on a scratch canvas with the same transform, then kept
 * inside (or outside) the masks' shapes. With no mask drawn, inside means nothing shows.
 */
function drawMasked(ctx: CanvasRenderingContext2D, inside: boolean, sprite: (g: CanvasRenderingContext2D) => void, shapes: (g: CanvasRenderingContext2D) => void): void {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (!maskScratch) maskScratch = [document.createElement('canvas'), document.createElement('canvas')];
    const [a, b] = maskScratch;
    for (const c of [a, b]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ga = a.getContext('2d')!, gb = b.getContext('2d')!;
    const m = ctx.getTransform();
    for (const g of [ga, gb]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h); g.setTransform(m); }
    ga.globalAlpha = ctx.globalAlpha;
    sprite(ga);
    shapes(gb);
    ga.setTransform(1, 0, 0, 1, 0, 0);
    ga.globalAlpha = 1;
    ga.globalCompositeOperation = inside ? 'destination-in' : 'destination-out';
    ga.drawImage(b, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(a, 0, 0);
    ctx.restore();
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
    nested?: { parent: number; layer: number; order: number; draw: (ctx: CanvasRenderingContext2D) => void },
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
        const renders = (nd.s && !(nd.live?.srOff ?? nd.srOff)) || nd.skinned || customDraw?.has(i);
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
    // The instance's SpriteMasks: renderers with a mask interaction are clipped to their union.
    const masks = nodes.map((n, i) => (n.isMask && n.maskSprite ? i : -1)).filter(i => i >= 0);
    const drawNode = (ctx: CanvasRenderingContext2D, i: number) => {
        if (!rig.isVisible(i)) return;
        const nd = nodes[i];
        const cd = customDraw?.get(i);
        if (cd) { cd(ctx, world[i]); return; }
        if (nd.skinned) { drawSkinned(ctx, rig, nd.skinned, tex, tint(undefined)); return; }
        if (nd.s) {
            let c = tint(nd.live?.c ?? nd.c);
            if (nd.alpha !== undefined && !nd.live?.c) c = [c[0], c[1], c[2], c[3] * nd.alpha];
            const fx = nd.live?.fx ?? !!nd.fx, fy = nd.live?.fy ?? !!nd.fy;
            const dm = (nd as PrefabNode & { draw?: { w: number; h: number } }).draw;
            const size = rig.sized && dm ? nd.live?.size ?? [dm.w, dm.h] as [number, number] : undefined;
            const live = nd.mask ? masks.filter(m => rig.isVisible(m)) : [];
            if (nd.mask === 1 || nd.mask === 2) {
                drawMasked(ctx, nd.mask === 1, g => drawSprite(g, data, tex, nd.s!, world[i], c, fx, fy, size),
                    g => { for (const m of live) drawSprite(g, data, tex, nodes[m].maskSprite!, world[m]); });
            } else drawSprite(ctx, data, tex, nd.s, world[i], c, fx, fy, size);
        }
    };
    const keyOf = (entry: number) => {
        const i = entry < 0 ? -entry - 1 : entry;
        const nd = nodes[i];
        if (entry < 0) return { layer: layerIndex(data, nd.sg![0]), order: nd.sg![1], i };
        if (nd.skinned && !nd.s) return { layer: layerIndex(data, nd.skinned.l), order: nd.skinned.o, i };
        return { layer: layerIndex(data, nd.l), order: nd.live?.o ?? nd.o ?? 0, i };
    };
    // Another sortable parented inside this instance (a rider under its mount's UnitAnchor): it
    // sorts in the group holding `parent`, after the instance's own nodes on a tie (hierarchy order).
    let nestedGroup = -2;
    if (nested) { let k = nested.parent; while (k >= 0 && !isGroup(k)) k = nodes[k].p; nestedGroup = k; }
    const drawGroup = (ctx: CanvasRenderingContext2D, g: number) => {
        if (!rig.isVisible(g)) return;
        const list = (members.get(g) ?? []).map(keyOf);
        if (nested && g === nestedGroup) list.push({ layer: layerIndex(data, nested.layer), order: nested.order, i: nodes.length });
        list.sort((p, q) => p.layer - q.layer || p.order - q.order || p.i - q.i);
        for (const e of list) {
            if (e.i === nodes.length) nested!.draw(ctx);
            else if (nodes[e.i].sg && e.i !== g) drawGroup(ctx, e.i);
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
