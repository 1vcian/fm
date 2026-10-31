import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { loadBattleVisuals, TextureCache } from '../Battle/gameView/visualData';
import { PortraitScene, type PortraitOptions } from './portraitScene';

/**
 * A looping GIF of a PortraitScene: `loops` loops of the character's animation at `fps`, rendered off screen at
 * size x size. Without a battlefield or a colour the background stays transparent (one-bit alpha,
 * the GIF limit: soft particle edges come out hard).
 */
export async function portraitGif(
    opts: PortraitOptions & { size: number; scale: number; loops: number; fps: number; color: string | null },
    onProgress?: (f: number) => void,
): Promise<Blob> {
    const data = await loadBattleVisuals();
    const tex = new TextureCache();
    const scene = new PortraitScene(data, tex, opts);
    const canvas = document.createElement('canvas');
    canvas.width = opts.size;
    canvas.height = opts.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // Whole loops of the character's animation, so the GIF repeats without a jump.
    const frames = Math.max(1, Math.round(opts.loops * scene.loopSeconds * opts.fps));
    const dt = 1 / opts.fps;
    // Textures load lazily: draw once and give them a moment before the first real frame.
    scene.draw(ctx, opts.size, opts.size, opts.scale, 'center', 1);
    await new Promise(r => setTimeout(r, 400));
    const gif = GIFEncoder();
    const transparent = !opts.color && !opts.background;
    for (let i = 0; i < frames; i++) {
        scene.draw(ctx, opts.size, opts.size, opts.scale, 'center', 1);
        if (opts.color && !opts.background) {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = opts.color;
            ctx.fillRect(0, 0, opts.size, opts.size);
            ctx.globalCompositeOperation = 'source-over';
        }
        const { data: rgba } = ctx.getImageData(0, 0, opts.size, opts.size);
        const format = transparent ? 'rgba4444' : 'rgb565';
        const palette = quantize(rgba, 256, { format, oneBitAlpha: transparent });
        const index = applyPalette(rgba, palette, format);
        const transparentIndex = transparent ? Math.max(0, palette.findIndex(c => c[3] === 0)) : 0;
        gif.writeFrame(index, opts.size, opts.size, { palette, delay: Math.round(1000 / opts.fps), transparent, transparentIndex, dispose: transparent ? 2 : -1 });
        scene.step(dt);
        onProgress?.((i + 1) / frames);
        if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    gif.finish();
    return new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" });
}
