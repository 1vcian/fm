import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { loadBattleVisuals, TextureCache } from '../Battle/gameView/visualData';
import type { Emitter } from '../Battle/gameView/particles';
import { PortraitScene, type PortraitOptions } from './portraitScene';

/** Pixels sampled from all the frames to build the GIF's one palette. */
const PALETTE_SAMPLES = 1 << 21;

type Particles = Emitter['particles'];

/**
 * The particles of one period, wrapped: every particle born during the period, drawn at the frames
 * of its life taken modulo the period, so the ones born near the end carry on over the first
 * frames. The emitters run a whole period first, to reach their steady state.
 */
function recordParticles(scene: PortraitScene, frames: number, dt: number): { em: Emitter; particles: Particles }[][] {
    for (let i = 0; i < frames; i++) scene.step(dt);
    // By ParticleDef: a death effect's emitters are new objects every loop, their defs are not.
    const reps = new Map<object, Emitter>();
    const buckets = Array.from({ length: frames }, () => new Map<object, Particles>());
    const seen = new WeakSet<object>();
    for (const em of scene.emitters) for (const p of em.particles) seen.add(p);
    const born = new WeakSet<object>();
    let alive = 0;
    // A particle outliving several periods (none in the game data) is cut after a few.
    const limit = frames * 4;
    for (let s = 0; s < limit && (s < frames || alive > 0); s++) {
        alive = 0;
        for (const em of scene.emitters) {
            if (!reps.has(em.def)) reps.set(em.def, em);
            for (const p of em.particles) {
                if (!seen.has(p)) { seen.add(p); if (s < frames) born.add(p); }
                if (!born.has(p)) continue;
                alive++;
                const b = buckets[s % frames];
                const list = b.get(em.def) ?? [];
                list.push({ ...p });
                b.set(em.def, list);
            }
        }
        scene.step(dt);
    }
    return buckets.map(b => [...b].map(([def, particles]) => ({ em: reps.get(def)!, particles })));
}

/**
 * A looping GIF of a PortraitScene: `loops` loops of the character's animation at `fps`, rendered
 * off screen at size x size. The last frame runs into the first: every other cycle is fitted to the
 * period (PortraitOptions.loopPeriod) and the particles are wrapped (recordParticles). One palette
 * serves every frame, so colours do not shimmer from frame to frame. Without a battlefield or a
 * colour the background stays transparent (one-bit alpha, the GIF limit: soft edges come out hard).
 */
export async function portraitGif(
    opts: PortraitOptions & { size: number; scale: number; loops: number; fps: number; color: string | null },
    onProgress?: (f: number) => void,
): Promise<Blob> {
    const data = await loadBattleVisuals();
    const tex = new TextureCache();
    const probe = new PortraitScene(data, tex, opts);
    // Whole frames, each 1/fps long, close to `loops` loops of the character's animation.
    const frames = Math.max(1, Math.round(opts.loops * probe.loopSeconds * opts.fps));
    const dt = 1 / opts.fps;
    const period = frames * dt;
    const scene = new PortraitScene(data, tex, { ...opts, loopPeriod: period });
    const canvas = document.createElement('canvas');
    canvas.width = opts.size;
    canvas.height = opts.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Textures load lazily: draw once and give them a moment before the first real frame.
    scene.draw(ctx, opts.size, opts.size, opts.scale, 'center', 1);
    await new Promise(r => setTimeout(r, 400));
    const particles = recordParticles(scene, frames, dt);
    // Frames are drawn at period + i * dt: the timeline's state then matches the recording's.
    const render = (i: number) => {
        scene.t = period + i * dt;
        scene.particleOverride = particles[i];
        scene.draw(ctx, opts.size, opts.size, opts.scale, 'center', 1);
        if (opts.color && !opts.background) {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = opts.color;
            ctx.fillRect(0, 0, opts.size, opts.size);
            ctx.globalCompositeOperation = 'source-over';
        }
        return ctx.getImageData(0, 0, opts.size, opts.size).data;
    };
    // Textures first needed by a later frame (an effect, a shot) get their moment too.
    for (let i = 0; i < frames; i++) render(i);
    await new Promise(r => setTimeout(r, 400));

    // Pass 1: one palette from pixels sampled across every frame.
    const transparent = !opts.color && !opts.background;
    const format = transparent ? 'rgba4444' : 'rgb565';
    const px = opts.size * opts.size;
    const stride = Math.max(1, Math.ceil((px * frames) / PALETTE_SAMPLES));
    const sample = new Uint8Array(Math.ceil((px * frames) / stride) * 4 + 4);
    let n = 0;
    let offset = 0;
    for (let i = 0; i < frames; i++) {
        const rgba = render(i);
        for (let k = offset; k < px; k += stride) {
            sample.set(rgba.subarray(k * 4, k * 4 + 4), n * 4);
            n++;
        }
        offset = (offset + stride - (px % stride)) % stride;
        onProgress?.((i + 1) / (2 * frames));
        if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    const palette = quantize(sample.subarray(0, n * 4), 256, { format, oneBitAlpha: transparent });
    let transparentIndex = 0;
    if (transparent) {
        transparentIndex = palette.findIndex(c => c[3] === 0);
        // The transparent entry must exist, or the frames' empty pixels take a real colour.
        if (transparentIndex < 0) {
            if (palette.length >= 256) palette.pop();
            palette.push([0, 0, 0, 0]);
            transparentIndex = palette.length - 1;
        }
    }

    // Pass 2: every frame against that palette.
    const gif = GIFEncoder();
    for (let i = 0; i < frames; i++) {
        const index = applyPalette(render(i), palette, format);
        gif.writeFrame(index, opts.size, opts.size, {
            palette: i === 0 ? palette : undefined, delay: Math.round(1000 / opts.fps), transparent, transparentIndex,
            // Each frame replaces the last whole: with transparency, clear to the background first.
            dispose: transparent ? 2 : 1,
        });
        onProgress?.(0.5 + (i + 1) / (2 * frames));
        if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    gif.finish();
    return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' });
}
