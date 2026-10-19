/**
 * A small particle player for the game's ParticleSystem data (exported by
 * extract_battle_visuals.py): start lifetime / speed / size / colour / rotation, gravity, bursts and
 * rate over time, circle / cone / box emitters, size, colour and rotation over lifetime. Each
 * particle is drawn with the material's texture. It covers what the combat VFX use; modules the
 * exporter does not read (noise, collision, sub-emitters, trails) are not simulated.
 */
import type { ParticleColor, ParticleCurve, ParticleDef, ParticleGradient } from './visualData';
import type { Mat } from './rig';

interface Particle {
    x: number; y: number; vx: number; vy: number;
    age: number; life: number; size: number; rot: number;
    color: number[];
    seed: number;
}

const rand = (c: ParticleCurve, r: number) => c.min + (c.max - c.min) * r;

function evalCurve(keys: [number, number][] | undefined, t: number): number {
    if (!keys || keys.length === 0) return 1;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i][0]) {
            const [t0, v0] = keys[i - 1];
            const [t1, v1] = keys[i];
            return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0);
        }
    }
    return keys[keys.length - 1][1];
}

function evalGradient(g: ParticleGradient | undefined, t: number): number[] {
    if (!g) return [1, 1, 1, 1];
    const pick = <T extends number[]>(keys: T[], n: number): number[] => {
        if (keys.length === 0) return new Array(n).fill(1);
        if (t <= keys[0][0]) return keys[0].slice(1);
        for (let i = 1; i < keys.length; i++) {
            if (t <= keys[i][0]) {
                const a = keys[i - 1], b = keys[i];
                const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
                return a.slice(1).map((v, k) => v + (b[k + 1] - v) * f);
            }
        }
        return keys[keys.length - 1].slice(1);
    };
    const rgb = pick(g.c, 3);
    const a = pick(g.a, 1);
    return [rgb[0], rgb[1], rgb[2], a[0]];
}

function colorAt(c: ParticleColor | undefined, t: number, r: number): number[] {
    if (!c) return [1, 1, 1, 1];
    if (c.mode === 'color') return c.max ?? [1, 1, 1, 1];
    if (c.mode === 'twoColors') {
        const a = c.min ?? [1, 1, 1, 1], b = c.max ?? [1, 1, 1, 1];
        return a.map((v, i) => v + (b[i] - v) * r);
    }
    if (c.mode === 'gradient') return evalGradient(c.g, t);
    const a = evalGradient(c.g2, t), b = evalGradient(c.g, t);
    return a.map((v, i) => v + (b[i] - v) * r);
}

let seedCounter = 1;
function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class Emitter {
    particles: Particle[] = [];
    time = 0;
    private emitAcc = 0;
    private burstDone = new Set<number>();
    private r: () => number;
    stopped = false;
    readonly texture: string | null;

    constructor(readonly def: ParticleDef, public origin: Mat, readonly order: number, readonly layer: number, private emitOnce = false) {
        this.r = rng(seedCounter++ * 7919);
        const mat = def.renderer?.material;
        this.texture = mat ? (mat.tex._BaseMap ?? mat.tex._MainTex ?? null) : null;
        if (emitOnce && def.bursts.length === 0 && def.rate.max <= 0) this.emit(1);
    }

    get done(): boolean {
        return (this.stopped || (!this.def.loop && this.time > this.def.duration) || this.emitOnce) && this.particles.length === 0 && this.time > 0;
    }

    private emit(n: number) {
        const d = this.def;
        const sh = d.shape;
        const m = this.origin;
        for (let k = 0; k < n && this.particles.length < d.maxParticles; k++) {
            const r = this.r;
            let lx = 0, ly = 0, dx = 0, dy = 1;
            if (sh.on) {
                if (sh.type === 10 || sh.type === 11 || sh.type === 0 || sh.type === 1 || sh.type === 2) {
                    // circle / sphere family: radial direction (2D view of it)
                    const ang = ((r() * (sh.arc || 360)) * Math.PI) / 180;
                    const rad = sh.type === 11 || sh.type === 1 ? sh.radius : sh.radius * Math.sqrt(r());
                    dx = Math.cos(ang); dy = Math.sin(ang);
                    lx = dx * rad; ly = dy * rad;
                } else if (sh.type === 4 || sh.type === 7 || sh.type === 8) {
                    // cone along +y in the emitter's local space
                    const ang = ((90 + (r() * 2 - 1) * sh.angle) * Math.PI) / 180;
                    dx = Math.cos(ang); dy = Math.sin(ang);
                    lx = (r() * 2 - 1) * sh.radius;
                } else if (sh.type === 5 || sh.type === 15 || sh.type === 16 || sh.type === 18) {
                    lx = (r() - 0.5) * sh.scale[0];
                    ly = (r() - 0.5) * sh.scale[1];
                    dx = 0; dy = 1;
                }
                // shape rotation around z
                const rz = (sh.rot[2] * Math.PI) / 180;
                if (rz) {
                    const c = Math.cos(rz), s = Math.sin(rz);
                    [lx, ly] = [lx * c - ly * s, lx * s + ly * c];
                    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
                }
                lx += sh.pos[0]; ly += sh.pos[1];
            }
            const speed = rand(d.speed, r());
            const wx = m[0] * lx + m[2] * ly + m[4];
            const wy = m[1] * lx + m[3] * ly + m[5];
            const sc = Math.hypot(m[0], m[1]);
            const vdx = m[0] * dx + m[2] * dy, vdy = m[1] * dx + m[3] * dy;
            const vl = Math.hypot(vdx, vdy) || 1;
            this.particles.push({
                x: wx, y: wy,
                vx: (vdx / vl) * speed * sc, vy: (vdy / vl) * speed * sc,
                age: 0, life: Math.max(0.01, rand(d.lifetime, r())),
                size: rand(d.size, r()) * sc,
                rot: rand(d.rotation, r()),
                color: colorAt(d.color, 0, r()),
                seed: r(),
            });
        }
    }

    update(dt: number): void {
        const d = this.def;
        const sdt = dt * (d.simSpeed || 1);
        const t0 = this.time;
        this.time += sdt;
        if (!this.stopped && !this.emitOnce) {
            const local = d.loop ? this.time % Math.max(0.01, d.duration) : this.time;
            if (d.loop || this.time <= d.duration) {
                this.emitAcc += sdt * d.rate.max;
                const n = Math.floor(this.emitAcc);
                if (n > 0) { this.emit(n); this.emitAcc -= n; }
            }
            d.bursts.forEach((b, i) => {
                if (!this.burstDone.has(i) && b.t <= Math.max(local, t0 === 0 ? 0 : local)) {
                    this.emit(Math.round(b.n));
                    this.burstDone.add(i);
                }
            });
        } else if (this.emitOnce) {
            d.bursts.forEach((b, i) => {
                if (!this.burstDone.has(i) && b.t <= this.time) {
                    this.emit(Math.round(b.n));
                    this.burstDone.add(i);
                }
            });
        }
        const g = rand(d.gravity, 0.5) * 9.81;
        for (const p of this.particles) {
            p.age += sdt;
            p.vy -= g * sdt;
            if (d.velocity) {
                p.x += rand(d.velocity.x, p.seed) * sdt;
                p.y += rand(d.velocity.y, p.seed) * sdt;
            }
            p.x += p.vx * sdt;
            p.y += p.vy * sdt;
            if (d.rotOverLife) p.rot += rand(d.rotOverLife, p.seed) * sdt;
        }
        this.particles = this.particles.filter(p => p.age < p.life);
    }

    /** Draw with the camera transform already applied (world units, y up). */
    draw(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, tintFn: (img: CanvasImageSource, rgb: number[]) => CanvasImageSource): void {
        const d = this.def;
        for (const p of this.particles) {
            const t = p.age / p.life;
            const sizeMul = d.sizeOverLife ? (d.sizeOverLife.curve?.length ? evalCurve(d.sizeOverLife.curve, t) : rand(d.sizeOverLife, p.seed)) : 1;
            const col = d.colorOverLife ? colorAt(d.colorOverLife, t, p.seed) : [1, 1, 1, 1];
            const c = [p.color[0] * col[0], p.color[1] * col[1], p.color[2] * col[2], p.color[3] * col[3]];
            if (c[3] <= 0.01) continue;
            const s = p.size * sizeMul;
            if (s <= 0) continue;
            ctx.save();
            ctx.translate(p.x, p.y);
            if (p.rot) ctx.rotate(-p.rot);
            ctx.globalAlpha *= c[3];
            if (img) {
                ctx.scale(1, -1);
                ctx.drawImage(tintFn(img, c), -s / 2, -s / 2, s, s);
            } else {
                ctx.fillStyle = `rgb(${c[0] * 255},${c[1] * 255},${c[2] * 255})`;
                ctx.beginPath();
                ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}

/** Multiply-tint whole particle textures (quantised so the cache stays small). */
const texTint = new Map<string, HTMLCanvasElement>();
let texIds = new WeakMap<object, number>();
let nextTexId = 1;
export function tintTexture(img: CanvasImageSource, rgb: number[]): CanvasImageSource {
    if (rgb[0] > 0.98 && rgb[1] > 0.98 && rgb[2] > 0.98) return img;
    let id = texIds.get(img as object);
    if (!id) { id = nextTexId++; texIds.set(img as object, id); }
    const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 15);
    const key = `${id}|${q(rgb[0])}${q(rgb[1])}${q(rgb[2])}`;
    let c = texTint.get(key);
    if (!c) {
        const w = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
        const h = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
        c = document.createElement('canvas');
        c.width = Math.min(256, w); c.height = Math.min(256, h);
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = `rgb(${(q(rgb[0]) / 15) * 255},${(q(rgb[1]) / 15) * 255},${(q(rgb[2]) / 15) * 255})`;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(img, 0, 0, c.width, c.height);
        if (texTint.size > 400) { texTint.clear(); texIds = new WeakMap(); }
        texTint.set(key, c);
    }
    return c;
}
