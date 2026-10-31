/** Typings for gifenc (https://github.com/mattdesl/gifenc), the parts the Images Maker uses. */
declare module 'gifenc' {
    type Palette = number[][];
    export function GIFEncoder(opt?: { initialCapacity?: number; auto?: boolean }): {
        writeFrame(index: Uint8Array, width: number, height: number, opts?: {
            palette?: Palette; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number; dispose?: number;
        }): void;
        finish(): void;
        bytes(): Uint8Array;
    };
    export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: {
        format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number;
    }): Palette;
    export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
