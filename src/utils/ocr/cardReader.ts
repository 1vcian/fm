// Player profile card reader: one screenshot of the card -> CardRead (cardTypes.ts).
//
// Geometry comes from cardLayout.ts (one anchor, the battle-preview box, maps every reference rect
// onto the screenshot). Per field:
//   header         tesseract on the 3 right-aligned rows ("Lv. N Forge", "X Total Damage",
//                  "Y Total Health"); forge stars = consensus of the item-tile stars (every equipped
//                  item carries the forge ascension), cross-checked with the gold stars in the header
//   items          age from the tile fill (validated AGE palette), level from the white "Lv. N"
//                  glyphs (digit bank), stars via readItemTileStars, skin = the badge on the corner,
//                  idx = the item's own texture matched inside the tile (narrowed to age + slot)
//   mount          the wide tile: rarity from the fill, identity from the MountIcons sheet of its
//                  ascension, level + stars as above
//   pets, skills   the 6 icons under the lattice; each is matched against BOTH the skill and the
//                  pet sheet of its own ascension, so the kind is read, not assumed
//   fairy          FairyIcon{Lora,Mira,Tira}.png matched in the slot at the right, "Lv. N" under it
//   stats          the scrolling "+X% Name" list; a line clipped by the viewport is never read
//
// Null means NOT READ. Every field that cannot be read with confidence stays null and says why in
// `warnings`; nothing is filled in from defaults.

import { loadImage, imageToCanvas, screenshotCanvas, cropCanvas, evidenceCropUrl, tileLevelRect, binarize, type Rect } from './imagePrep';
import { readNumber, upscaleCanvas } from './numberReader';
import { countStars } from './starCounter';
import { readItemTileStars, classifyColor } from './templateReaders';
import { ocr, PSM } from './ocrEngine';
import { normalizeName, parseCompactNumber } from './parse';
import { matchSubstat, TYPE_NAME_TO_SLOT } from './gameDictionary';
import { AGE_COLORS, RARITY_COLORS, RARITY_NAMES, LEVEL_MAX, STAR, type RGB } from './templateParams';
import { locateCard, prepareSurface, occludedFrac, refRect, REF, type CardAnchor, type CardSurface } from './cardLayout';
import {
    readPatch, fillColor, matchTemplates, unitTemplates, range,
    type CardAssets, type Template, type Patch, type MatchHit,
} from './cardSprites';
import { CARD_ITEM_SLOTS, type CardRead, type CardItem, type CardUnit, type CardSkill } from './cardTypes';
import type { GameDictionaries } from './gameLocalization';
import { FAIRY_MAX_LEVEL } from '../fairies';

export { buildCardAssets, type CardAssets } from './cardSprites';

// ---------------------------------------------------------------- acceptance thresholds
// Measured on the labelled cards (reverseForge/scratch/card/ground_truth.json, 23 shots): the
// lowest CORRECT top score was items 0.69, pets/skills 0.61, mounts 0.75, fairy 0.66; the
// tightest correct margins items 0.07 (Riot vs Kevlar helmet), pets 0.08 (the Ultra pets all wear
// the same knight helmet), mounts 0.19, fairy 0.13. The floors sit below those with some room;
// they were tuned on the same shots they are scored on, so treat them as provisional.
const UNIT_MIN_SCORE = 0.50;   // pet / skill sprite NCC
const UNIT_MIN_MARGIN = 0.06;  // over the best template of another identity
const ITEM_MIN_SCORE = 0.50;
const ITEM_MIN_MARGIN = 0.04;
const MOUNT_MIN_SCORE = 0.50;
const MOUNT_MIN_MARGIN = 0.08;
const FAIRY_MIN_SCORE = 0.50;
const OCCLUDED_MAX = 0.02;    // a rect with more popup pixels than this is not read
const LEVEL_MIN_CONF = 0.75;
const STRONG_SCORE = 0.6;     // a sprite match this good with this margin outranks the fill colour
const STRONG_MARGIN = 0.15;
const SKIN_BADGE_MIN = 0.20;  // ink fraction above the tile's top-right corner (measured: no badge <= 0.06, badge >= 0.35)

type Dbg = Record<string, unknown>;

function emptyRead(warnings: string[]): CardRead {
    return {
        name: null, totalDamage: null, totalHealth: null, forgeLevel: null, forgeStars: null,
        items: [], pets: [], mount: null, skills: [], fairy: null, stats: {}, warnings,
    };
}

async function toCanvas(src: Blob | File | HTMLCanvasElement): Promise<HTMLCanvasElement> {
    return screenshotCanvas(src instanceof HTMLCanvasElement ? src : await loadImage(src));
}

const clampRect = (r: Rect, W: number, H: number): Rect => {
    const x = Math.max(0, Math.min(W - 1, Math.round(r.x))), y = Math.max(0, Math.min(H - 1, Math.round(r.y)));
    return { x, y, w: Math.max(1, Math.min(W - x, Math.round(r.w))), h: Math.max(1, Math.min(H - y, Math.round(r.h))) };
};

// ---------------------------------------------------------------- "Lv. N" glyphs

interface WComp { x0: number; y0: number; x1: number; y1: number; top: boolean; bottom: boolean; side: boolean; n: number }

/** 4-connected components of a mask (labels + boxes + which crop borders each touches). */
function whiteComponents(mask: Uint8Array, W: number, H: number): { label: Int32Array; comps: WComp[] } {
    const label = new Int32Array(W * H).fill(-1);
    const comps: WComp[] = [];
    const stack: number[] = [];
    for (let s = 0; s < W * H; s++) {
        if (!mask[s] || label[s] >= 0) continue;
        const id = comps.length;
        const c: WComp = { x0: W, y0: H, x1: -1, y1: -1, top: false, bottom: false, side: false, n: 0 };
        label[s] = id; stack.push(s);
        while (stack.length) {
            const p = stack.pop()!, x = p % W, y = (p / W) | 0;
            c.n++;
            if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
            if (y === 0) c.top = true; if (y === H - 1) c.bottom = true; if (x === 0 || x === W - 1) c.side = true;
            if (x > 0 && mask[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack.push(p - 1); }
            if (x < W - 1 && mask[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack.push(p + 1); }
            if (y > 0 && mask[p - W] && label[p - W] < 0) { label[p - W] = id; stack.push(p - W); }
            if (y < H - 1 && mask[p + W] && label[p + W] < 0) { label[p + W] = id; stack.push(p + W); }
        }
        comps.push(c);
    }
    return { label, comps };
}

/** Drop components nested inside another kept component's box (a "0" hole showing white card). */
function dropNested(comps: WComp[], keep: boolean[]) {
    for (let i = 0; i < comps.length; i++) {
        if (!keep[i]) continue;
        const a = comps[i];
        for (let j = 0; j < comps.length; j++) {
            if (i === j || !keep[j]) continue;
            const b = comps[j];
            if (b.x0 < a.x0 && b.x1 > a.x1 && b.y0 < a.y0 && b.y1 > a.y1) { keep[i] = false; break; }
        }
    }
}

/** Glyph cores are near 255; light item art (a silver belt) sits around 180..215 and must not
 *  bridge into a glyph. */
const WHITE_MIN = 215;

/**
 * Keep only the white "Lv. N" glyphs of a crop and paint everything else dark: the white-on-colour
 * picture the digit bank reader was built for, whatever the label sits on (a coloured tile, an
 * icon, or the white card under an icon with no stars).
 *
 * Pass 1 finds the text row: white components that touch no crop border and are not nested in
 * another (a hole of a "6" shows the white card) are grouped by baseline, and the largest group of
 * tall ones is the "L" + digits. Pass 2 keeps only white pixels inside that row's band and labels
 * again: a glyph whose outline is broken where it meets light item art (the "1" of "Lv. 104" under
 * a silver belt) is cut free of the art by the band, while the white card left and right of the
 * label still touches the crop's sides and is dropped.
 */
function levelGlyphCanvas(crop: HTMLCanvasElement): HTMLCanvasElement {
    const up = upscaleCanvas(crop, 3);
    const W = up.width, H = up.height;
    const ctx = up.getContext('2d', { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const white = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
        if (mn > WHITE_MIN && mx - mn < 40) white[p] = 1;
    }
    const blank = () => { for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 30; ctx.putImageData(img, 0, 0); return up; };

    // pass 1: the text row
    const p1 = whiteComponents(white, W, H);
    const keep1 = p1.comps.map(c => !c.top && !c.bottom && !c.side && c.n >= 6 && c.y1 - c.y0 < 0.9 * H);
    dropNested(p1.comps, keep1);
    const kept = p1.comps.filter((_, i) => keep1[i]);
    const maxh = Math.max(0, ...kept.map(c => c.y1 - c.y0 + 1));
    const tall = kept.filter(c => c.y1 - c.y0 + 1 >= 0.6 * maxh);
    let group: WComp[] = [];
    for (const seed of tall) {
        const g = tall.filter(o => Math.abs(o.y1 - seed.y1) <= 0.15 * maxh);
        if (g.length > group.length) group = g;
    }
    if (!group.length) return blank();
    const ys1 = group.map(o => o.y1).sort((p, q) => p - q), ys0 = group.map(o => o.y0).sort((p, q) => p - q);
    const base = ys1[ys1.length >> 1], top = ys0[ys0.length >> 1], capH = Math.max(1, base - top);
    // the band starts a little BELOW the cap line: light art touching the glyph tops stays outside
    const b0 = Math.max(0, Math.round(top + 0.12 * capH)), b1 = Math.min(H - 1, Math.round(base + 0.12 * capH));

    // pass 2: white inside the band only, minus the white card (pass-1 components reaching the
    // crop's left/right side surround the label; between two glyphs the card would otherwise
    // become an isolated white blob once the band cuts it off)
    const band = new Uint8Array(W * H);
    for (let y = b0; y <= b1; y++) for (let x = 0; x < W; x++) {
        const q = y * W + x, l = p1.label[q];
        band[q] = white[q] && !(l >= 0 && p1.comps[l].side) ? 1 : 0;
    }
    const p2 = whiteComponents(band, W, H);
    const keep2 = p2.comps.map(c => !c.side && c.n >= 6 && c.y1 - c.y0 < 0.95 * (b1 - b0 + 1) + 2 &&
        // never wider than a glyph run: the card strip under a label spans the band edge to edge
        c.x1 - c.x0 < 1.6 * capH);
    dropNested(p2.comps, keep2);
    // a component that only grazes the top of the band (an art piece poking in from above) is not
    // on the text row. Glyphs reach at least the lower half: the star row overlapping the label
    // can hide the foot of a "1" (measured: it ends 0.3 cap heights above the baseline)
    for (let i = 0; i < p2.comps.length; i++) {
        const c = p2.comps[i];
        if (keep2[i] && c.y1 < base - 0.5 * capH) keep2[i] = false;
        // a sliver thinner than any stroke (an art edge between two glyphs) is not a glyph
        if (keep2[i] && c.x1 - c.x0 + 1 < 0.15 * capH && c.y1 - c.y0 + 1 < 0.85 * capH) keep2[i] = false;
        // ... nor is a narrow DIAGONAL piece (a wing tip beside a "1"): a narrow glyph ("1") is a
        // solid bar that fills its box, a diagonal stroke fills well under half of it
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        if (keep2[i] && bw < 0.35 * capH && bh > 0.4 * capH && c.n < 0.5 * bw * bh) keep2[i] = false;
    }
    // ends of the run: a small blob after the last digit, or anything detached from the run by
    // more than a glyph's width, is residue (a tile corner highlight), not part of the label
    const order = p2.comps.map((c, i) => ({ c, i })).filter(o => keep2[o.i]).sort((p, q) => p.c.x0 - q.c.x0);
    while (order.length > 1) {
        const last = order[order.length - 1], prev = order[order.length - 2];
        const small = last.c.y1 - last.c.y0 + 1 < 0.5 * capH;
        if (small || last.c.x0 - prev.c.x1 > 1.0 * capH) { keep2[last.i] = false; order.pop(); } else break;
    }
    while (order.length > 1) {
        const first = order[0], next = order[1];
        if (next.c.x0 - first.c.x1 > 1.0 * capH || first.c.y1 - first.c.y0 + 1 < 0.5 * capH) { keep2[first.i] = false; order.shift(); } else break;
    }
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        const l = p2.label[p];
        if (l >= 0 && keep2[l]) continue;
        d[i] = d[i + 1] = d[i + 2] = 30;
    }
    ctx.putImageData(img, 0, 0);
    return up;
}

/** Level from one glyph read: "Lv. N" with its "v", 1..3 digits, no leading zero. The read must
 *  contain the "v": without it a broken glyph was taken for a digit ("Lv. 4" -> "L174"). */
function levelFromRaw(raw: string): number | null {
    const m = raw.match(/v\.?(\d{1,4})$/);
    if (!m || m[1].length > 3 || m[1][0] === '0') return null;
    return parseInt(m[1], 10);
}

/**
 * The label is read the calibrated way at every device scale. Measured on the forge cards
 * rescaled to 720..1440 px: the glyph bank scores correct labels lower off 576 px ("Lv13" 0.856 ->
 * 0.766), but neither resampling the label to the calibrated size nor accepting two agreeing reads
 * under LEVEL_MIN_CONF is safe: the agreeing reads included "Lv33" -> 30 and "Lv33" -> 3. A level
 * under the gate stays unread (null), never guessed.
 */
async function readLevelAt(c: HTMLCanvasElement, r: Rect, dbg?: Dbg, tag?: string): Promise<number | null> {
    try {
        const rr = clampRect(r, c.width, c.height);
        const g = levelGlyphCanvas(cropCanvas(c, rr));
        dbgImg(tag && dbg ? `${String(dbg.__id ?? '')}_${tag}` : undefined, g);
        const res = await readNumber(g);
        if (dbg && tag) {
            const plain = await readNumber(cropCanvas(c, rr, 3));
            dbg[tag] = { raw: res.raw, conf: +res.confidence.toFixed(3), plain: plain.raw };
        }
        // below this mean glyph score the read is not trusted (measured: the one sub-0.76 read of
        // 193 level reads on the fixtures was the one wrong one, a JPEG q60 "33" read as "30")
        if (res.confidence < LEVEL_MIN_CONF) return null;
        return levelFromRaw(res.raw);
    } catch { return null; }
}

// ---------------------------------------------------------------- masks

function rectMask(W: number, H: number, x0: number, x1: number, y0: number, y1: number, cut?: (x: number, y: number) => boolean): Uint8Array {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = (x + 0.5) / W, fy = (y + 0.5) / H;
        if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1 && !(cut && cut(fx, fy))) m[y * W + x] = 1;
    }
    return m;
}

function circleMask(W: number, H: number, rFrac: number, yMax: number): Uint8Array {
    const m = new Uint8Array(W * H);
    const cx = W / 2, cy = H / 2, r = rFrac * W;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < r * r && (y + 0.5) / H < yMax) m[y * W + x] = 1;
    }
    return m;
}

/** Ring just inside the icon outline: the fill colour of the icon (its rarity). */
function ringMask(W: number, H: number, round: boolean): Uint8Array {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = (x + 0.5) / W, fy = (y + 0.5) / H;
        if (fy > 0.5) continue;
        if (round) {
            const d = Math.hypot(fx - 0.5, fy - 0.5);
            if (d > 0.36 && d < 0.43) m[y * W + x] = 1;
        } else if ((fx > 0.08 && fx < 0.16) || (fx > 0.84 && fx < 0.92) || (fy > 0.08 && fy < 0.16 && fx > 0.08 && fx < 0.92)) {
            m[y * W + x] = 1;
        }
    }
    return m;
}

function rarityOf(rgb: RGB): { idx: number; dist: number } {
    let best = 0, bd = Infinity;
    const mx = Math.max(...rgb), mn = Math.min(...rgb);
    if (mx - mn < 30 && mn > 150) return { idx: 0, dist: 0 };
    for (let i = 0; i < RARITY_COLORS.length; i++) {
        const p = RARITY_COLORS[i];
        const d = Math.hypot(rgb[0] - p[0], rgb[1] - p[1], rgb[2] - p[2]);
        if (d < bd) { bd = d; best = i; }
    }
    return { idx: best, dist: bd };
}

/** Best hit, and the best hit of a DIFFERENT identity (the margin is measured against it). */
function topTwo<T>(hits: MatchHit<T>[]): { top: MatchHit<T> | null; second: MatchHit<T> | null } {
    const top = hits[0] ?? null;
    const second = hits.find(h => top && h.key !== top.key) ?? null;
    return { top, second };
}

/**
 * Ascension stars of an icon, counted by countStars inside a window given as fractions of the
 * icon box (the same back-solve readItemTileStars uses for item tiles). The window must start
 * above the star outline (cutting it lets the flood fill reach the pocket) and below the counters
 * of the "Lv. N" digits (a gold fill seen through a "0" looks like a star pocket).
 */
function starsInWindow(c: HTMLCanvasElement, box: Rect, win: { x0: number; x1: number; y0: number; y1: number }): number {
    const w = (win.x1 - win.x0) * box.w / (STAR.bandX1 - STAR.bandX0);
    const h = (win.y1 - win.y0) * box.h / (STAR.bandY1 - STAR.bandY0);
    try {
        return countStars(c, {
            x: Math.round(box.x + win.x0 * box.w - STAR.bandX0 * w),
            y: Math.round(box.y + win.y0 * box.h - STAR.bandY0 * h),
            w: Math.round(w), h: Math.round(h),
        });
    } catch { return 0; }
}

/** Debug images (harness only): globalThis.__CARD_IMG__ = {} collects data URLs by tag. */
function dbgImg(tag: string | undefined, c: HTMLCanvasElement) {
    const g = globalThis as { __CARD_IMG__?: Record<string, string> };
    if (tag && g.__CARD_IMG__) g.__CARD_IMG__[tag] = c.toDataURL('image/png');
}

// ---------------------------------------------------------------- header

interface HeaderRead { forgeLevel: number | null; totalDamage: number | null; totalHealth: number | null; goldStars: number | null }

const COMPACT = /(\d{1,4}(?:[.,]\d{1,3})?)\s*([kmbtq])\b/i;

/** "42.1b" -> { token: "42.1b", value }. The game prints these with at most 3 significant
 *  digits (42.1b, 384b, 9.6b, 1.99b on every fixture), so a 4-digit read is a misread. */
function parseHeaderNumber(line: string): { token: string; value: number } | null {
    const t = line.replace(/\s+/g, ' ');
    const m = t.match(COMPACT) ?? t.match(/(\d{1,4}(?:[.,]\d{1,3})?)(?=\s*total)/i);
    if (!m) return null;
    const num = m[1].replace(',', '.');
    if (num.replace(/[^0-9]/g, '').replace(/^0+/, '').length > 3) return null;
    const token = num + (m[2] ?? '').toLowerCase();
    const value = parseCompactNumber(token);
    return value == null ? null : { token, value };
}

/** Gold star count right of "Forge": the stars overlap, so count from the gold run's width. */
function headerGoldStars(c: HTMLCanvasElement, a: CardAnchor, dbg: Dbg): number | null {
    const row = refRect(a, { x: 300, y: REF.headerRows[0].y, w: 215, h: REF.headerRows[0].h });
    const r = clampRect(row, c.width, c.height);
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    const cols = new Int32Array(r.w);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        if (R > 180 && G > 120 && B < 120 && R - B > 90) cols[x]++;
    }
    let x0 = -1, x1 = -1, total = 0;
    for (let x = 0; x < r.w; x++) if (cols[x] >= 2) { if (x0 < 0) x0 = x; x1 = x; total += cols[x]; }
    const ref = a.s; // reference px -> source px
    dbg.headerGold = { x0, x1, w: x0 < 0 ? 0 : (x1 - x0 + 1) / ref, total: total / (ref * ref) };
    if (x0 < 0) return 0;
    const w = (x1 - x0 + 1) / ref;
    // measured at 576: one star's gold spans 9 px, two overlapping stars 16 px (+7 per star)
    const n = Math.round((w - 9) / 7) + 1;
    return n >= 1 && n <= 3 ? n : null;
}

async function readHeader(c: HTMLCanvasElement, a: CardAnchor, warnings: string[], dbg: Dbg): Promise<HeaderRead> {
    const out: HeaderRead = { forgeLevel: null, totalDamage: null, totalHealth: null, goldStars: null };
    const texts: string[] = [];
    for (let i = 0; i < 3; i++) {
        const rr = REF.headerRows[i];
        const r = clampRect(refRect(a, { x: REF.header.x, y: rr.y - 1, w: REF.header.w, h: rr.h + 2 }), c.width, c.height);
        let text = '';
        try { text = (await ocr(cropCanvas(c, r, 3), { psm: PSM.SINGLE_LINE })).text; } catch { text = ''; }
        texts.push(text);
    }
    dbg.headerText = texts;
    const lv = texts[0].match(/l\s*v\s*\.?\s*(\d{1,3})/i) ?? texts[0].match(/(\d{1,3})\s*f\s*o\s*r/i);
    if (lv) out.forgeLevel = parseInt(lv[1], 10);
    else warnings.push('Could not read the forge level in the card header.');
    // each number is confirmed by a second pass over its token alone (binarised, 4x, digits and
    // magnitude letters only); the two must give the same token
    const confirm = async (row: number, pr: { token: string; value: number } | null, what: string): Promise<number | null> => {
        if (!pr) { warnings.push(`Could not read ${what} in the card header.`); return null; }
        const rr = REF.headerRows[row];
        const r = clampRect(refRect(a, { x: REF.header.x, y: rr.y - 1, w: REF.header.w, h: rr.h + 2 }), c.width, c.height);
        const tok = firstToken(c, r, a.s);
        let t2 = '';
        if (tok) {
            try {
                const tr = clampRect({ x: tok.rect.x - 2, y: tok.rect.y, w: tok.rect.w + 4, h: tok.rect.h }, c.width, c.height);
                t2 = (await ocr(binarize(cropCanvas(c, tr, 4)), { psm: PSM.SINGLE_LINE, whitelist: '0123456789.kmbtq' })).text.trim().toLowerCase();
            } catch { t2 = ''; }
        }
        (dbg.headerTok ??= [] as string[]) && (dbg.headerTok as string[]).push(t2);
        // the token crop can run on into "Total" (the word gap is narrow): compare the leading number
        const lead = t2.replace(',', '.').match(/^(\d{1,4}(?:\.\d{1,3})?[kmbtq]?)/)?.[1] ?? '';
        if (lead !== pr.token) {
            warnings.push(`${what}: two reads disagree (${pr.token} vs ${t2 || 'nothing'}). Left empty.`);
            return null;
        }
        return pr.value;
    };
    out.totalDamage = await confirm(1, /dam/i.test(texts[1]) ? parseHeaderNumber(texts[1]) : null, 'Total Damage');
    out.totalHealth = await confirm(2, /heal|hea|alth/i.test(texts[2]) ? parseHeaderNumber(texts[2]) : null, 'Total Health');
    out.goldStars = headerGoldStars(c, a, dbg);
    return out;
}

/** Player name: white glyphs with a black outline on the white card. Best effort. */
async function readName(c: HTMLCanvasElement, a: CardAnchor, dbg: Dbg): Promise<string | null> {
    const r = clampRect(refRect(a, REF.name), c.width, c.height);
    try {
        const g = levelGlyphCanvas(cropCanvas(c, r));
        // dark glyph-on-white for tesseract: invert the kept white glyphs
        const ctx = g.getContext('2d', { willReadFrequently: true })!;
        const img = ctx.getImageData(0, 0, g.width, g.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const v = d[i] === 30 && d[i + 1] === 30 && d[i + 2] === 30 ? 255 : 0;
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(img, 0, 0);
        const res = await ocr(g, { psm: PSM.SINGLE_LINE });
        dbg.nameText = res.text; dbg.nameConf = res.confidence;
        const t = res.text.replace(/[^A-Za-z0-9_.\- ]/g, '').trim().split(/\s+/)[0] ?? '';
        if (t.length >= 2 && res.confidence >= 90) return t;
    } catch { /* best effort */ }
    return null;
}

// ---------------------------------------------------------------- items + mount

const ITEM_SLOT_TYPENAME: Record<string, string> = Object.fromEntries(
    Object.entries(TYPE_NAME_TO_SLOT).map(([type, slot]) => [slot, type]));

function itemTemplates(assets: CardAssets, slot: string, age: number): Template<number>[] {
    const type = ITEM_SLOT_TYPENAME[slot];
    const out: Template<number>[] = [];
    for (const v of Object.values<any>(assets.autoItemMapping || {})) {
        if (v?.TypeName !== type || v?.Age !== age || !v?.SpriteName) continue;
        out.push({ file: `${v.SpriteName}.png`, sx: 0, sy: 0, sw: 256, sh: 256, value: Number(v.Idx), key: `item:${v.Idx}` });
    }
    return out;
}

/** Fraction of dark outline pixels just above the tile's top-right corner: the skin badge. */
function skinBadgeScore(c: HTMLCanvasElement, tile: Rect): number {
    // The badge (a white rounded square with a dark outline, the skin's icon inside) overhangs the
    // tile's top-right corner by ~0.12 of the tile height and spans x 0.66..1.15 of its width.
    // Above a tile without one is plain card. x starts at 0.74 so the star cluster of the tile
    // above (x <= 0.71) never enters the window.
    const r = clampRect({
        x: tile.x + 0.74 * tile.w, y: tile.y - 0.16 * tile.h,
        w: 0.40 * tile.w, h: 0.12 * tile.h,
    }, c.width, c.height);
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    let ink = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
        n++;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx < 200 || mx - mn > 40) ink++;
    }
    return n ? ink / n : 0;
}

async function readItems(
    sf: CardSurface, a: CardAnchor, assets: CardAssets, dicts: GameDictionaries, warnings: string[], dbg: Dbg,
): Promise<CardItem[]> {
    const c = sf.canvas;
    const items: CardItem[] = [];
    const idbg: Dbg[] = [];
    dbg.items = idbg;
    for (let k = 0; k < CARD_ITEM_SLOTS.length; k++) {
        const slot = CARD_ITEM_SLOTS[k];
        const row = k < 5 ? 0 : 1, col = k < 5 ? k : k - 5;
        const tile = refRect(a, { x: REF.itemCols[col], y: REF.itemRows[row], w: REF.itemW, h: REF.itemH });
        const d: Dbg = { slot, __id: slot };
        idbg.push(d);
        const item: CardItem = { slot, age: null, idx: null, level: null, stars: null, hasSkin: false, confidence: 0 };
        items.push(item);
        const cover = occludedFrac(sf, { x: tile.x, y: tile.y - Math.round(0.1 * tile.h), w: tile.w, h: Math.round(1.3 * tile.h) });
        d.cover = +cover.toFixed(3);
        if (cover > OCCLUDED_MAX) { warnings.push(`${slot}: covered by a popup, not read.`); continue; }
        const badge = skinBadgeScore(c, tile);
        d.badge = +badge.toFixed(3);
        item.hasSkin = badge > SKIN_BADGE_MIN;
        if (badge > 0.12 && badge < 0.28) warnings.push(`${slot}: unsure whether a skin badge is on the tile.`);
        // age = the tile fill, sampled on the left/right edge strips where the art rarely reaches
        // (the centre sample of sampleTileColor picks up a green alien head as "the fill")
        const art = clampRect({ x: tile.x, y: tile.y, w: tile.w, h: tile.h }, c.width, c.height);
        const patch = readPatch(c, art, 72);
        const edge = rectMask(patch.W, patch.H, 0.05, 0.95, 0.10, 0.60,
            (fx, fy) => (fx > 0.15 && fx < 0.85) || (!!item.hasSkin && fx > 0.6 && fy < 0.42));
        const rgb = fillColor(patch, edge, 40);
        d.rgb = rgb;
        item.age = classifyColor(rgb, AGE_COLORS);
        item.cropUrl = evidenceCropUrl(c, { x: tile.x, y: tile.y - Math.round(0.1 * tile.h), w: tile.w + Math.round(0.1 * tile.w), h: Math.round(1.2 * tile.h) });
        const lr = tileLevelRect(tile);
        item.level = await readLevelAt(c, { x: lr.x - Math.round(0.08 * tile.w), y: lr.y - Math.round(0.04 * tile.h), w: lr.w + Math.round(0.16 * tile.w), h: lr.h + Math.round(0.04 * tile.h) }, d, 'lv');
        item.stars = readItemTileStars(c, tile);
        // identity: the item's own texture inside the tile, narrowed to (age, slot)
        const tpl = itemTemplates(assets, slot, item.age);
        const cut = item.hasSkin ? (fx: number, fy: number) => fx > 0.55 && fy < 0.40 : undefined;
        const mask = rectMask(patch.W, patch.H, 0.08, 0.92, 0.06, 0.58, cut);
        const bg = fillColor(patch, mask);
        const hits = tpl.length ? await matchTemplates(assets, patch, mask, bg, tpl, {
            cx: patch.W / 2, cy: 0.44 * patch.H,
            sizes: range(0.80 * patch.W, 1.05 * patch.W, 0.05 * patch.W),
            dxs: range(-0.03 * patch.W, 0.03 * patch.W, 0.03 * patch.W),
            dys: range(-0.06 * patch.H, 0.06 * patch.H, 0.03 * patch.H),
        }) : [];
        const { top, second } = topTwo(hits);
        d.hits = hits.slice(0, 3).map(h => [h.value, +h.score.toFixed(3)]);
        const margin = top ? top.score - (second?.score ?? 0) : 0;
        if (top && top.score >= ITEM_MIN_SCORE && (margin >= ITEM_MIN_MARGIN || (!second && top.score >= ITEM_MIN_SCORE + 0.1))) {
            item.idx = top.value;
            item.confidence = Math.min(1, top.score);
        } else {
            item.confidence = 0.3;
            warnings.push(`${slot}: item not identified from its icon${top ? ` (best ${top.score.toFixed(2)}, margin ${margin.toFixed(2)})` : ''}.`);
        }
        // A tile with neither a recognised icon nor a readable level is not evidence of an item at
        // all (an empty slot is a plain grey tile, which the palette would call Primitive).
        if (item.idx == null && item.level == null) {
            item.age = null; item.stars = null; item.hasSkin = null;
            warnings.push(`${slot}: nothing readable on this tile.`);
        } else if (item.idx == null && item.age === 0) {
            item.age = null; // a grey fill without a matching Primitive icon proves nothing
        }
        if (item.level == null) warnings.push(`${slot}: level not read.`);
    }
    return items;
}

async function readMount(sf: CardSurface, a: CardAnchor, assets: CardAssets, warnings: string[], dbg: Dbg): Promise<CardUnit | null> {
    const c = sf.canvas;
    const tile = refRect(a, REF.mount);
    const d: Dbg = {};
    dbg.mount = d;
    if (occludedFrac(sf, { x: tile.x, y: tile.y, w: tile.w, h: Math.round(1.25 * tile.h) }) > OCCLUDED_MAX) {
        warnings.push('Mount: covered by a popup, not read.');
        return null;
    }
    const patch = readPatch(c, clampRect(tile, c.width, c.height), 160);
    // fill colour from the tile body away from the centred art
    const fill = fillColor(patch, rectMask(patch.W, patch.H, 0.04, 0.22, 0.10, 0.55));
    const rar = rarityOf(fill);
    d.fill = fill; d.rarity = rar;
    const sat = Math.max(...fill) - Math.min(...fill);
    if (sat < 40 && Math.min(...fill) < 200) { warnings.push('Mount: no mount tile found.'); return null; }
    const rarity = RARITY_NAMES[rar.idx];
    const unit: CardUnit = { rarity, id: null, level: null, stars: null, confidence: 0 };
    unit.cropUrl = evidenceCropUrl(c, { x: tile.x, y: tile.y, w: tile.w, h: Math.round(1.2 * tile.h) });
    const sq: Rect = { x: Math.round(tile.x + tile.w / 2 - tile.h / 2), y: tile.y, w: tile.h, h: tile.h };
    unit.stars = readItemTileStars(c, sq);
    unit.level = await readLevelAt(c, { x: Math.round(tile.x + 0.22 * tile.w), y: Math.round(tile.y + 0.52 * tile.h), w: Math.round(0.56 * tile.w), h: Math.round(0.40 * tile.h) }, d, 'lv');
    const all = unitTemplates(assets, 'mounts', unit.stars ?? 0);
    const tpl = all.filter(t => t.value?.rarity === rarity);
    const mask = rectMask(patch.W, patch.H, 0.30, 0.70, 0.06, 0.55);
    const hits = await matchTemplates(assets, patch, mask, fill, tpl.length ? tpl : all, {
        cx: patch.W / 2, cy: 0.42 * patch.H,
        sizes: range(0.7 * patch.H, 1.4 * patch.H, 0.1 * patch.H),
        dxs: range(-0.02 * patch.W, 0.02 * patch.W, 0.02 * patch.W),
        dys: range(-0.08 * patch.H, 0.08 * patch.H, 0.04 * patch.H),
    });
    const { top, second } = topTwo(hits);
    d.hits = hits.slice(0, 3).map(h => [h.value?.name, +h.score.toFixed(3)]);
    const margin = top ? top.score - (second?.score ?? 0) : 0;
    if (top && top.score >= MOUNT_MIN_SCORE && (margin >= MOUNT_MIN_MARGIN || (!second && top.score >= MOUNT_MIN_SCORE + 0.1))) {
        unit.id = top.value.id;
        unit.rarity = top.value.rarity;
        unit.confidence = Math.min(1, top.score);
    } else {
        unit.confidence = 0.3;
        warnings.push(`Mount: not identified from its icon${top ? ` (best ${top.score.toFixed(2)})` : ''}.`);
    }
    if (unit.level == null) warnings.push('Mount: level not read.');
    return unit;
}

// ---------------------------------------------------------------- pets + skills

interface IconRead { kind: 'pets' | 'skills' | null; value: any; level: number | null; stars: number | null; confidence: number; margin: number; cropUrl?: string; ringRarity: string | null }

async function readIcon(
    sf: CardSurface, assets: CardAssets, box: Rect, round: boolean, label: string, warnings: string[], d: Dbg,
): Promise<IconRead | null> {
    const c = sf.canvas;
    if (occludedFrac(sf, { x: box.x, y: box.y, w: box.w, h: Math.round(1.35 * box.h) }) > OCCLUDED_MAX) {
        warnings.push(`${label}: covered by a popup, not read.`);
        return null;
    }
    const patch: Patch = readPatch(c, clampRect(box, c.width, c.height), 50);
    // empty slot: nothing saturated inside the icon
    const ring = fillColor(patch, ringMask(patch.W, patch.H, round), 40);
    const rsat = Math.max(...ring) - Math.min(...ring);
    const rr = rarityOf(ring);
    const ringRarity = rsat > 60 && rr.dist < 90 ? RARITY_NAMES[rr.idx] : null;
    d.ring = ring; d.ringRarity = ringRarity;
    const out: IconRead = { kind: null, value: null, level: null, stars: null, confidence: 0, margin: 0, ringRarity };
    out.cropUrl = evidenceCropUrl(c, { x: box.x, y: box.y, w: box.w, h: Math.round(1.35 * box.h) });
    // star row: measured fy 0.80..1.10 under a circle, 0.71..1.04 under a square (the square's
    // "Lv. N" sits higher, fy 0.38..0.60, so its window can start higher too)
    // (circle stars measured at fy 0.87..1.15: the window starts at 0.80, under the bottom of the
    // round art, whose own enclosed gold bits produced a phantom star at 0.72)
    out.stars = starsInWindow(c, box, round ? { x0: 0.10, x1: 0.90, y0: 0.80, y1: 1.22 } : { x0: 0.10, x1: 0.90, y0: 0.64, y1: 1.16 });
    // "Lv. N": on the icon when it has stars (circle fy 0.45..0.75, square 0.38..0.60), under it
    // when it has none (fy 1.0..1.3); one band covers both, the glyph filter keeps the text row
    out.level = await readLevelAt(c, {
        x: box.x - Math.round(0.10 * box.w), y: box.y + Math.round((round ? 0.40 : 0.28) * box.h),
        w: Math.round(1.20 * box.w), h: Math.round((round ? 0.95 : 1.07) * box.h),
    }, d, 'lv');
    const mask = round ? circleMask(patch.W, patch.H, 0.40, 0.52) : rectMask(patch.W, patch.H, 0.12, 0.88, 0.08, 0.36);
    const bg = fillColor(patch, mask, 60);
    // match against every ascension's sheet: the art changes with ascension for most units, so
    // the sheet that fits best also checks the star count
    const place = {
        cx: patch.W / 2, cy: patch.H / 2,
        sizes: range(0.80 * patch.W, 1.10 * patch.W, 0.05 * patch.W),
        dxs: range(-0.04 * patch.W, 0.04 * patch.W, 0.02 * patch.W),
        dys: range(-0.04 * patch.H, 0.04 * patch.H, 0.02 * patch.H),
    };
    const perAsc: MatchHit<any>[][] = [];
    for (let asc = 0; asc <= 3; asc++) {
        const tpl = [...unitTemplates(assets, 'skills', asc), ...unitTemplates(assets, 'pets', asc)];
        perAsc.push((await matchTemplates(assets, patch, mask, bg, tpl, place)).map(h => ({ ...h, asc } as MatchHit<any> & { asc: number })));
    }
    const hits = perAsc.flat().sort((p, q) => q.score - p.score);
    const { top, second } = topTwo(hits);
    d.hits = hits.slice(0, 3).map(h => [h.key, (h as any).asc, +h.score.toFixed(3)]);
    const margin = top ? top.score - (second?.score ?? 0) : 0;
    out.margin = margin;
    if (top && out.stars != null) {
        const sameAtRead = perAsc[out.stars]?.find(h => h.key === top.key);
        const topAsc = (top as any).asc as number;
        d.ascCheck = { topAsc, atRead: sameAtRead ? +sameAtRead.score.toFixed(3) : null };
        if (topAsc !== out.stars && sameAtRead && top.score - sameAtRead.score > 0.08) {
            warnings.push(`${label}: ${out.stars} star(s) read, but the icon art is the ${topAsc}-star version. Stars left empty.`);
            out.stars = null;
        }
    }
    if (top && top.score >= UNIT_MIN_SCORE && margin >= UNIT_MIN_MARGIN) {
        out.kind = top.key.startsWith('skills:') ? 'skills' : 'pets';
        out.value = top.value;
        out.confidence = Math.min(1, top.score);
    } else {
        warnings.push(`${label}: not identified from its icon${top ? ` (best ${top.key.split(':')[1]} ${top.score.toFixed(2)}, margin ${margin.toFixed(2)})` : ''}.`);
    }
    return out;
}

// ---------------------------------------------------------------- fairy

async function readFairy(sf: CardSurface, a: CardAnchor, assets: CardAssets, warnings: string[], dbg: Dbg): Promise<CardRead['fairy']> {
    const c = sf.canvas;
    const box = clampRect(refRect(a, REF.fairy), c.width, c.height);
    const d: Dbg = {};
    dbg.fairy = d;
    if (occludedFrac(sf, { x: box.x, y: box.y, w: box.w, h: Math.round(1.5 * box.h) }) > OCCLUDED_MAX) {
        warnings.push('Fairy: covered by a popup, not read.');
        return null;
    }
    const patch = readPatch(c, box, 76);
    let ink = 0;
    for (let i = 0; i < patch.W * patch.H; i++) if (Math.max(patch.px[i * 3], patch.px[i * 3 + 1], patch.px[i * 3 + 2]) < 110) ink++;
    d.ink = +(ink / (patch.W * patch.H)).toFixed(3);
    if (ink < 0.02 * patch.W * patch.H) return null; // no fairy equipped
    const names = ['Lora', 'Mira', 'Tira'];
    const tpl: Template<string>[] = names.map(n => ({ file: `FairyIcon${n}.png`, sx: 0, sy: 0, sw: 512, sh: 512, value: n, key: `fairy:${n}` }));
    const mask = rectMask(patch.W, patch.H, 0, 1, 0, 1);
    const hits = await matchTemplates(assets, patch, mask, [255, 255, 255], tpl, {
        cx: patch.W / 2, cy: patch.H / 2,
        sizes: range(0.8 * patch.H, 1.6 * patch.H, 0.1 * patch.H),
        dxs: range(-0.08 * patch.W, 0.08 * patch.W, 0.04 * patch.W),
        dys: range(-0.12 * patch.H, 0.12 * patch.H, 0.06 * patch.H),
    });
    d.hits = hits.map(h => [h.value, +h.score.toFixed(3)]);
    const { top, second } = topTwo(hits);
    let name: string | null = null;
    if (top && top.score >= FAIRY_MIN_SCORE && top.score - (second?.score ?? 0) >= 0.05) name = top.value;
    else warnings.push(`Fairy: present but not identified${top ? ` (best ${top.value} ${top.score.toFixed(2)})` : ''}.`);
    let level = await readLevelAt(c, refRect(a, REF.fairyLevel), d, 'lv');
    if (level != null && (level < 1 || level > FAIRY_MAX_LEVEL)) {
        warnings.push(`Fairy: read Lv.${level}, outside 1 to ${FAIRY_MAX_LEVEL}. Left empty.`);
        level = null;
    }
    if (level == null) warnings.push('Fairy: level not read.');
    return { name, level };
}

// ---------------------------------------------------------------- stat list

interface InkRun { y0: number; y1: number }

function statInk(R: number, G: number, B: number): boolean {
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    return mx - mn < 45 && (R + G + B) / 3 < 205;
}

async function readStats(sf: CardSurface, a: CardAnchor, dicts: GameDictionaries, warnings: string[], dbg: Dbg): Promise<Record<string, number>> {
    const c = sf.canvas;
    const vp = clampRect(refRect(a, REF.stats), c.width, c.height);
    const stats: Record<string, number> = {};
    const lines: Dbg[] = [];
    dbg.stats = lines;
    if (occludedFrac(sf, vp) > OCCLUDED_MAX) {
        warnings.push('Stat list: partly covered by a popup, not read.');
        return stats;
    }
    const data = c.getContext('2d', { willReadFrequently: true })!.getImageData(vp.x, vp.y, vp.w, vp.h).data;
    const rows = new Int32Array(vp.h);
    for (let y = 0; y < vp.h; y++) for (let x = 0; x < vp.w; x++) {
        const i = (y * vp.w + x) * 4;
        if (statInk(data[i], data[i + 1], data[i + 2])) rows[y]++;
    }
    const runs: InkRun[] = [];
    let s = -1, gap = 0;
    for (let y = 0; y <= vp.h; y++) {
        const on = y < vp.h && rows[y] > 0;
        if (on) { if (s < 0) s = y; gap = 0; }
        else if (s >= 0) {
            gap++;
            if (gap > Math.max(1, Math.round(1.5 * a.s)) || y === vp.h) { runs.push({ y0: s, y1: y - gap }); s = -1; gap = 0; }
        }
    }
    const tall = runs.map(r => r.y1 - r.y0 + 1).filter(h => h >= 8 * a.s).sort((p, q) => p - q);
    const medH = tall.length ? tall[tall.length >> 1] : 16 * a.s;
    const edge = Math.max(1, Math.round(0.75 * a.s)); // a cut line runs into the last rows of the viewport
    let clipped = 0;
    const first = runs.findIndex(r => r.y1 - r.y0 + 1 >= 0.45 * medH);
    let last = -1;
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].y1 - runs[i].y0 + 1 >= 0.45 * medH) { last = i; break; }
    for (let ri = 0; ri < runs.length; ri++) {
        const r = runs[ri];
        const h = r.y1 - r.y0 + 1;
        const d: Dbg = { y0: vp.y + r.y0, y1: vp.y + r.y1, h };
        lines.push(d);
        if (h < 0.45 * medH) { d.skip = 'small'; continue; }
        if (r.y0 <= edge || r.y1 >= vp.h - 1 - edge) { d.skip = 'clipped'; clipped++; continue; }
        // the viewport's exact edge is only known from the bottom clip seen on the fixtures: a
        // first/last line clearly shorter than the others is treated as cut off as well (full lines
        // measured 15..20 px at 576, a clipped one 10..12)
        if ((ri === first || ri === last) && h < 0.75 * medH) { d.skip = 'short-edge'; clipped++; continue; }
        const lineRect: Rect = { x: vp.x, y: vp.y + r.y0 - Math.round(3 * a.s), w: vp.w, h: h + Math.round(6 * a.s) };
        const lr = clampRect(lineRect, c.width, c.height);
        let text = '';
        try { text = (await ocr(cropCanvas(c, lr, 3), { psm: PSM.SINGLE_LINE })).text; } catch { text = ''; }
        d.text = text;
        const norm = text.replace(/[\u2212\u2013\u2014~]/g, '-').replace(/\s+/g, ' ').trim();
        const m = norm.match(/([+\-]?)\s*(\d{1,4}(?:[.,]\d{1,3})?)\s*%\s*([A-Za-z][A-Za-z .'-]*)/);
        if (!m) { d.skip = 'unparsed'; warnings.push(`Stat line not understood: "${text}".`); continue; }
        const label = m[3].replace(/\(.*$/, '').trim();
        let statId: string | null = dicts.substats.get(normalizeName(label)) ?? null;
        if (!statId) { const fm = matchSubstat(label, dicts.substats, 0.7); statId = fm ? fm.value : null; }
        d.statId = statId;
        if (!statId) { warnings.push(`Stat name not recognised: "${label}".`); continue; }
        // sign from the ink (the first glyph's shape decides + or -); the value is confirmed by a
        // second, independent tesseract pass over the value token alone (binarised, 4x, digits
        // only). The digit-bank ink reader was tried here first and measured worse on this small
        // grey text (it dropped digits: "+480%" -> "+40%"), so it is not used.
        const tok = firstToken(c, lr, a.s);
        d.tok = tok;
        const sign = tok?.sign ?? null;
        let tokText = '';
        if (tok) {
            try {
                const tr = clampRect({ x: tok.rect.x - 2, y: tok.rect.y, w: tok.rect.w + 4, h: tok.rect.h }, c.width, c.height);
                tokText = (await ocr(binarize(cropCanvas(c, tr, 4)), { psm: PSM.SINGLE_LINE, whitelist: '0123456789.%+-' })).text;
            } catch { tokText = ''; }
        }
        d.tokText = tokText;
        const tessVal = parseFloat(m[2].replace(',', '.'));
        const tm = tokText.match(/(\d+(?:\.\d+)?)/);
        d.tessVal = tessVal; d.sign = sign;
        let value: number | null = tessVal;
        const digitsA = m[2].replace(/[^0-9]/g, ''), digitsB = tm ? tm[1].replace(/[^0-9]/g, '') : '';
        if (!tm) {
            value = null;
            warnings.push(`${statId}: value could not be confirmed. Left out.`);
        } else if (parseFloat(tm[1]) !== tessVal && !(digitsA === digitsB && (!tm[1].includes('.') || !m[2].includes('.')))) {
            // equal digits with the point missing on one side is the same reading (a point is
            // the glyph a low-resolution pass loses first); anything else is a real disagreement
            value = null;
            warnings.push(`${statId}: two reads disagree (${m[2]}% vs ${tm[1]}%). Left out.`);
        }
        const sgn = sign ?? (m[1] === '-' ? -1 : m[1] === '+' ? 1 : null);
        if (value != null && sgn == null) { warnings.push(`${statId}: sign not read. Left out.`); value = null; }
        if (value == null) continue;
        const v = sgn! * value;
        if (stats[statId] != null && stats[statId] !== v) warnings.push(`${statId} appears twice (${stats[statId]}% and ${v}%). Kept the first.`);
        else stats[statId] = v;
    }
    if (clipped) warnings.push(`${clipped} stat line(s) cut off at the edge of the list were skipped. Scroll the list and add another screenshot to read them.`);
    return stats;
}

/** The value token of a stat line ("+80%"), and its sign from the first glyph's shape. */
function firstToken(c: HTMLCanvasElement, r: Rect, s: number): { rect: Rect; sign: 1 | -1 | null } | null {
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(r.x, r.y, r.w, r.h).data;
    const cols = new Int32Array(r.w);
    const colY0 = new Int32Array(r.w).fill(r.h), colY1 = new Int32Array(r.w).fill(-1);
    let y0 = r.h, y1 = -1;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4;
        if (!statInk(d[i], d[i + 1], d[i + 2])) continue;
        cols[x]++;
        if (y < colY0[x]) colY0[x] = y; if (y > colY1[x]) colY1[x] = y;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    let x0 = -1;
    for (let x = 0; x < r.w; x++) if (cols[x]) { x0 = x; break; }
    if (x0 < 0) return null;
    const lineH = y1 - y0 + 1;
    // first glyph: columns until the first empty column
    let g1 = x0;
    while (g1 < r.w && cols[g1]) g1++;
    let gy0 = r.h, gy1 = -1;
    for (let x = x0; x < g1; x++) { gy0 = Math.min(gy0, colY0[x]); gy1 = Math.max(gy1, colY1[x]); }
    const gh = gy1 - gy0 + 1, gw = g1 - x0;
    let sign: 1 | -1 | null = null;
    if (gh <= 0.30 * lineH && gw >= 1.5 * gh) sign = -1;
    else if (gh >= 0.40 * lineH && gh <= 0.85 * lineH && gw >= 0.6 * gh && gw <= 1.5 * gh) {
        // a "+" has a vertical bar through the middle of a horizontal one
        const mid = x0 + Math.floor(gw / 2);
        if (colY1[mid] - colY0[mid] + 1 >= 0.8 * gh && cols[x0] <= Math.max(2, 0.4 * gh)) sign = 1;
    }
    // token end: first gap of >= 5 reference px
    const gapPx = Math.max(3, Math.round(5 * s));
    let run = 0, end = r.w;
    for (let x = x0; x < r.w; x++) {
        if (cols[x] === 0) { run++; if (run >= gapPx) { end = x - run + 1; break; } }
        else run = 0;
    }
    return { rect: { x: r.x + x0, y: r.y, w: end - x0, h: r.h }, sign };
}

// ---------------------------------------------------------------- limits

function gate(v: number | null, lo: number, hi: number, what: string, warnings: string[]): number | null {
    if (v == null) return null;
    if (v < lo || v > hi) { warnings.push(`${what}: read ${v}, outside the game's range (${lo} to ${hi}). Left empty.`); return null; }
    return v;
}

// ---------------------------------------------------------------- public

/**
 * Read one screenshot of a player profile card. See cardTypes.ts for the contract and
 * cardSprites.ts / buildCardAssets for how to build `assets`.
 */
export async function readProfileCard(src: Blob | File | HTMLCanvasElement, dicts: GameDictionaries, assets: CardAssets): Promise<CardRead> {
    const dbg: Dbg = {};
    const g = globalThis as { __CARD_DEBUG__?: Dbg[] };
    if (Array.isArray(g.__CARD_DEBUG__)) g.__CARD_DEBUG__.push(dbg);
    const raw = await toCanvas(src);
    const a = locateCard(raw);
    if (!a) return emptyRead(['This does not look like a player profile card (the battle preview was not found).']);
    dbg.anchor = a;
    const sf = prepareSurface(raw, a);
    dbg.dimmed = sf.dimmed; dbg.bgLevel = sf.bgLevel;
    const warnings: string[] = [];
    if (sf.dimmed) warnings.push('Another popup is open over the card. Only the parts it does not cover were read.');
    const out = emptyRead(warnings);
    const c = sf.canvas;
    const limits = dicts.limits ?? null;

    // header (the header is never under a popup in practice, but check anyway)
    const hdrRect = refRect(a, REF.header);
    if (occludedFrac(sf, hdrRect) <= OCCLUDED_MAX) {
        const h = await readHeader(c, a, warnings, dbg);
        out.forgeLevel = gate(h.forgeLevel, 1, limits?.forgeLevel ?? 99, 'Forge level', warnings);
        out.totalDamage = h.totalDamage;
        out.totalHealth = h.totalHealth;
        dbg.goldStars = h.goldStars;
        out.name = await readName(c, a, dbg);
    } else warnings.push('Header covered by a popup, not read.');

    out.items = await readItems(sf, a, assets, dicts, warnings, dbg);
    const itemMaxStars = limits?.ascension.forge ?? 3;
    for (const it of out.items) {
        it.level = gate(it.level, 1, limits?.itemLevel(it.slot) ?? LEVEL_MAX, `${it.slot} level`, warnings);
        it.stars = gate(it.stars, 0, itemMaxStars, `${it.slot} stars`, warnings);
    }
    // forge stars: every equipped item shows the forge ascension; a 6-of-8 majority (or all of
    // fewer tiles) is required, and the header's gold stars must not contradict it
    const votes = out.items.map(i => i.stars).filter((v): v is number => v != null);
    const tally = new Map<number, number>();
    for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
    const ranked = [...tally.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    const itemStars = ranked.length && ranked[0][1] >= Math.max(3, Math.ceil(0.75 * votes.length)) ? ranked[0][0] : null;
    const goldStars = dbg.goldStars as number | null | undefined;
    dbg.itemStarVotes = votes;
    if (itemStars != null && goldStars != null && itemStars !== goldStars) {
        warnings.push(`Forge stars: the item tiles show ${itemStars}, the header shows ${goldStars}. Left empty.`);
    } else out.forgeStars = itemStars ?? goldStars ?? null;
    // every equipped item shows the forge ascension, so a tile that disagrees with a strong
    // majority misread (measured: a glyph counter on a dark Underworld tile faked a star)
    if (itemStars != null && out.forgeStars === itemStars) {
        for (const it of out.items) {
            if (it.stars != null && it.stars !== itemStars) {
                warnings.push(`${it.slot}: read ${it.stars} star(s) where every other item shows ${itemStars}. Using ${itemStars}.`);
                it.stars = itemStars;
            }
        }
    }
    if (out.forgeStars == null && itemStars == null && goldStars == null) warnings.push('Forge stars not read.');

    out.mount = await readMount(sf, a, assets, warnings, dbg);
    if (out.mount) {
        out.mount.level = gate(out.mount.level, 1, limits && out.mount.rarity ? limits.mountLevel(out.mount.rarity) : LEVEL_MAX, 'Mount level', warnings);
        out.mount.stars = gate(out.mount.stars, 0, limits?.ascension.mounts ?? 3, 'Mount stars', warnings);
    }

    // the 6 icons: 3 round (skills), 3 square (pets) in every card seen; the kind is still read
    const icons: Dbg[] = [];
    dbg.icons = icons;
    const coveredSkills: number[] = [], coveredPets: number[] = [];
    const boxes = [...REF.circles.map(r => ({ r, round: true })), ...REF.squares.map(r => ({ r, round: false }))];
    for (let i = 0; i < boxes.length; i++) {
        const d: Dbg = { i, __id: `icon${i}` };
        icons.push(d);
        const expected = boxes[i].round ? 'skills' : 'pets';
        const label = boxes[i].round ? `Skill ${i + 1}` : `Pet ${i - 2}`;
        const ic = await readIcon(sf, assets, refRect(a, boxes[i].r), boxes[i].round, label, warnings, d);
        if (!ic) { (expected === 'skills' ? coveredSkills : coveredPets).push(i); continue; }
        const kind = ic.kind ?? expected;
        if (ic.kind && ic.kind !== expected) warnings.push(`${label}: the icon matched a ${ic.kind === 'pets' ? 'pet' : 'skill'}, not the usual ${expected === 'pets' ? 'pet' : 'skill'} slot.`);
        if (kind === 'skills') {
            const sk: CardSkill = {
                skillId: ic.value?.name ?? null,
                level: gate(ic.level, 1, limits?.skillLevel ?? LEVEL_MAX, `${label} level`, warnings),
                stars: gate(ic.stars, 0, limits?.ascension.skills ?? 3, `${label} stars`, warnings),
                confidence: ic.confidence, cropUrl: ic.cropUrl,
            };
            // the fill colour only vetoes a weak match: a strong one is better evidence than a ring
            // sample, which picks up art of the unit's own colours (Ultra Cerberus is red on yellow)
            const weak = ic.confidence < STRONG_SCORE || ic.margin < STRONG_MARGIN;
            if (weak && sk.skillId && assets.skillLibrary?.[sk.skillId]?.Rarity && ic.ringRarity && assets.skillLibrary[sk.skillId].Rarity !== ic.ringRarity) {
                warnings.push(`${label}: ${sk.skillId} is ${assets.skillLibrary[sk.skillId].Rarity} but the icon colour reads ${ic.ringRarity}. Left unidentified.`);
                sk.skillId = null; sk.confidence = 0.3;
            }
            if (sk.level == null) warnings.push(`${label}: level not read.`);
            out.skills.push(sk);
        } else {
            const rarity: string | null = ic.value?.rarity ?? ic.ringRarity ?? null;
            const pet: CardUnit = {
                rarity, id: ic.value?.id ?? null,
                level: gate(ic.level, 1, limits && rarity ? limits.petLevel(rarity) : LEVEL_MAX, `${label} level`, warnings),
                stars: gate(ic.stars, 0, limits?.ascension.pets ?? 3, `${label} stars`, warnings),
                confidence: ic.confidence, cropUrl: ic.cropUrl,
            };
            const weak = ic.confidence < STRONG_SCORE || ic.margin < STRONG_MARGIN;
            if (weak && ic.value && ic.ringRarity && ic.value.rarity !== ic.ringRarity) {
                warnings.push(`${label}: ${ic.value.name} is ${ic.value.rarity} but the icon colour reads ${ic.ringRarity}. Left unidentified.`);
                pet.id = null; pet.rarity = ic.ringRarity; pet.confidence = 0.3;
            }
            if (pet.level == null) warnings.push(`${label}: level not read.`);
            out.pets.push(pet);
        }
    }
    // Keep slot positions when only some icons were covered by a popup: an all-null entry stands
    // in for each covered slot. When none of a kind was read the list stays empty, so
    // mergeCardReads fills it from another screenshot.
    if (out.skills.length && coveredSkills.length) {
        for (const i of coveredSkills) out.skills.splice(i, 0, { skillId: null, level: null, stars: null, confidence: 0 });
    }
    if (out.pets.length && coveredPets.length) {
        for (const i of coveredPets) out.pets.splice(i - 3, 0, { rarity: null, id: null, level: null, stars: null, confidence: 0 });
    }

    out.fairy = await readFairy(sf, a, assets, warnings, dbg);
    out.stats = await readStats(sf, a, dicts, warnings, dbg);
    return out;
}
