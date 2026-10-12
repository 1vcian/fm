// Sprite assets + template matching for the profile-card reader.
//
// Identity on the card (item, pet, mount, skill, fairy) is read by matching the icon against the
// game's OWN textures, composited over the tile's fill colour at the size the card draws them:
//   items   Texture2D/<v>/<SpriteName>.png         (AutoItemMapping SpriteName, 256x256 each)
//   pets    Texture2D/<v>/{,Mega,Ultra,Apex}Pets.png        8x8 grid of 256 px cells
//   mounts  Texture2D/<v>/{,Mega,Ultra,Apex}MountIcons.png  4x4 grid of 256 px cells
//   skills  Texture2D/<v>/{,Mega,Ultra,Apex}SkillIcons.png  8x8 grid of 256 px cells
//   fairies Texture2D/<v>/FairyIcon{Lora,Mira,Tira}.png     512x512 each
// The sheet prefix follows the unit's ascension stars (0 none, 1 Mega, 2 Ultra, 3 Apex: the same
// rule as getAscensionTexturePath), because the art changes with ascension (Ultra pets all wear a
// knight helmet, Ultra Worm is a white spiked ring). Cell index -> identity comes from
// ManualSpriteMapping.json.
//
// Matching is normalised cross-correlation over the RGB channels inside a mask that avoids the
// "Lv. N" text and the star row, searched over a small set of sizes and offsets around the
// measured placement. Measured on the fixtures (reverseForge/scratch/card): a correct skill scores
// ~0.78-0.90, a correct pet ~0.47-0.64, the runner-up of another identity 0.30-0.45.

import { loadImage, type Rect } from './imagePrep';
import type { RGB } from './templateParams';

export type UnitSheet = 'pets' | 'mounts' | 'skills';

/** What the card reader needs besides the screenshot. Build it with buildCardAssets(). */
export interface CardAssets {
    /** ManualSpriteMapping.json (pets / mounts / skills cell -> identity). */
    spriteMapping: any;
    /** AutoItemMapping.json ("age_type_idx" -> { Age, Idx, TypeName, SpriteName, ... }). */
    autoItemMapping: any;
    /** SkillLibrary.json of the selected version (skill id -> { Rarity }), optional. */
    skillLibrary?: any;
    /** Loads a texture by file name (e.g. "UltraPets.png"); cached by buildCardAssets. */
    texture(name: string): Promise<CanvasImageSource>;
}

/**
 * Standard CardAssets. `textureBase` is the Texture2D folder of the selected version, with a
 * trailing slash, e.g. `${import.meta.env.BASE_URL}Texture2D/${resolveTextureVersion(version)}/`.
 * Textures are fetched lazily (only the sheets a card actually needs) and kept for the session.
 */
export function buildCardAssets(cfg: {
    textureBase: string; spriteMapping: any; autoItemMapping: any; skillLibrary?: any;
}): CardAssets {
    const cache = new Map<string, Promise<CanvasImageSource>>();
    return {
        spriteMapping: cfg.spriteMapping,
        autoItemMapping: cfg.autoItemMapping,
        skillLibrary: cfg.skillLibrary,
        texture(name: string) {
            let p = cache.get(name);
            if (!p) {
                p = loadImage(cfg.textureBase + name);
                p.catch(() => cache.delete(name));
                cache.set(name, p);
            }
            return p;
        },
    };
}

const SHEET_FILE: Record<UnitSheet, string> = { pets: 'Pets.png', mounts: 'MountIcons.png', skills: 'SkillIcons.png' };
const ASC_PREFIX = ['', 'Mega', 'Ultra', 'Apex'];
export function sheetFile(kind: UnitSheet, asc: number): string {
    return (ASC_PREFIX[asc] ?? '') + SHEET_FILE[kind];
}

/** One template: a sub-rect of a texture plus the identity it stands for. */
export interface Template<T> { file: string; sx: number; sy: number; sw: number; sh: number; value: T; key: string }

/** Every cell of a unit sheet as templates (identity from ManualSpriteMapping). */
export function unitTemplates(assets: CardAssets, kind: UnitSheet, asc: number): Template<any>[] {
    const m = assets.spriteMapping?.[kind];
    if (!m?.mapping) return [];
    const cols = m.grid?.columns ?? 8;
    const cw = m.sprite_size?.width ?? 256, ch = m.sprite_size?.height ?? 256;
    const file = sheetFile(kind, asc);
    return Object.entries<any>(m.mapping).map(([idx, v]) => {
        const i = Number(idx);
        return { file, sx: (i % cols) * cw, sy: Math.floor(i / cols) * ch, sw: cw, sh: ch, value: v, key: `${kind}:${v.name}` };
    });
}

// ---------------------------------------------------------------- pixel helpers

export interface Patch { W: number; H: number; px: Float32Array /* RGB */ }

/** RGB pixels of a rect. `maxW` downsamples a large capture to about the reference size first:
 *  matching cost grows with the square of the patch size and gains nothing past it. */
export function readPatch(src: HTMLCanvasElement, r: Rect, maxW = Infinity): Patch {
    const k = Math.min(1, maxW / Math.max(1, r.w));
    const W = Math.max(1, Math.round(r.w * k)), H = Math.max(1, Math.round(r.h * k));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const px = new Float32Array(W * H * 3);
    for (let i = 0, p = 0; i < d.length; i += 4, p += 3) { px[p] = d[i]; px[p + 1] = d[i + 1]; px[p + 2] = d[i + 2]; }
    return { W, H, px };
}

/** Median colour of the saturated pixels under a mask (the tile fill), else of all of them. */
export function fillColor(p: Patch, mask: Uint8Array, minSat = 50): RGB {
    const sat: number[][] = [], all: number[][] = [];
    for (let i = 0; i < p.W * p.H; i++) {
        if (!mask[i]) continue;
        const r = p.px[i * 3], g = p.px[i * 3 + 1], b = p.px[i * 3 + 2];
        all.push([r, g, b]);
        if (Math.max(r, g, b) - Math.min(r, g, b) > minSat) sat.push([r, g, b]);
    }
    const use = sat.length > 5 ? sat : all;
    if (!use.length) return [255, 255, 255];
    const med = (k: number) => { const v = use.map(q => q[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    return [med(0), med(1), med(2)];
}

const scaled = new Map<string, Uint8ClampedArray>();

async function scaledTemplate(assets: CardAssets, t: Template<any>, S: number): Promise<Uint8ClampedArray | null> {
    const k = `${t.file}|${t.sx},${t.sy},${t.sw},${t.sh}|${S}`;
    const hit = scaled.get(k);
    if (hit) return hit;
    let img: CanvasImageSource;
    try { img = await assets.texture(t.file); } catch { return null; }
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, t.sx, t.sy, t.sw, t.sh, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    scaled.set(k, d);
    return d;
}

export interface MatchHit<T> { value: T; key: string; score: number; S: number; cx: number; cy: number }

/**
 * Best NCC of each template composited over `bg`, centred at (cx+dx, cy+dy) with side S, over the
 * masked pixels of the patch. `sizes`/`dxs`/`dys` are in patch pixels.
 */
export async function matchTemplates<T>(
    assets: CardAssets, patch: Patch, mask: Uint8Array, bg: RGB, templates: Template<T>[],
    place: { cx: number; cy: number; sizes: number[]; dxs: number[]; dys: number[] },
): Promise<MatchHit<T>[]> {
    const { W, H, px } = patch;
    const idx: number[] = [];
    for (let i = 0; i < W * H; i++) if (mask[i]) idx.push(i);
    const n = idx.length;
    if (n < 10) return [];
    // patch stats per channel
    const am = [0, 0, 0];
    for (const i of idx) for (let c = 0; c < 3; c++) am[c] += px[i * 3 + c];
    for (let c = 0; c < 3; c++) am[c] /= n;
    let aa = 0;
    const a0 = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) { const v = px[idx[k] * 3 + c] - am[c]; a0[k * 3 + c] = v; aa += v * v; }
    if (aa < 1e-6) return [];

    const out: MatchHit<T>[] = [];
    const b = new Float32Array(n * 3);
    for (const t of templates) {
        let best: MatchHit<T> | null = null;
        for (const S0 of place.sizes) {
            const S = Math.max(4, Math.round(S0));
            const spr = await scaledTemplate(assets, t, S);
            if (!spr) break;
            for (const dx of place.dxs) for (const dy of place.dys) {
                const ox = Math.round(place.cx + dx - S / 2), oy = Math.round(place.cy + dy - S / 2);
                const bm = [0, 0, 0];
                for (let k = 0; k < n; k++) {
                    const i = idx[k], x = i % W, y = (i / W) | 0;
                    const u = x - ox, v = y - oy;
                    let r = bg[0], g = bg[1], bl = bg[2];
                    if (u >= 0 && v >= 0 && u < S && v < S) {
                        const j = (v * S + u) * 4, al = spr[j + 3] / 255;
                        r = spr[j] * al + r * (1 - al); g = spr[j + 1] * al + g * (1 - al); bl = spr[j + 2] * al + bl * (1 - al);
                    }
                    b[k * 3] = r; b[k * 3 + 1] = g; b[k * 3 + 2] = bl;
                    bm[0] += r; bm[1] += g; bm[2] += bl;
                }
                bm[0] /= n; bm[1] /= n; bm[2] /= n;
                let ab = 0, bb = 0;
                for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) {
                    const v = b[k * 3 + c] - bm[c];
                    ab += a0[k * 3 + c] * v; bb += v * v;
                }
                const score = bb > 1e-6 ? ab / Math.sqrt(aa * bb) : -1;
                if (!best || score > best.score) best = { value: t.value, key: t.key, score, S, cx: place.cx + dx, cy: place.cy + dy };
            }
        }
        if (best) out.push(best);
    }
    out.sort((p, q) => q.score - p.score);
    return out;
}

export function range(lo: number, hi: number, step: number): number[] {
    const out: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
    return out;
}
