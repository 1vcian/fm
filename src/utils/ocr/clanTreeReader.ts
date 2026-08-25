// Clan Tech Tree reader — faithful TS port of the validated reverseForge/proto_clantree.py
// (merged 61/61 node levels exact over 5 overlapping scroll shots, identity 100% positional +
// icon-NCC agreement, header guild potions read, partial nodes SKIPPED never misread).
//
// PIPELINE (per screenshot, normalized to 576px width):
//   0. Scroll band: the clip is DERIVED from content, never from screen-height constants (the
//      game UI scales with WIDTH, so every horizontal param is device-independent once the shot
//      is normalized to 576px, but vertical offsets move with aspect ratio / safe areas).
//      clipBottom  = 8px above the dark separator line that caps the bottom tab strip (the
//                    full-width flat #d8d8d8 band holding Skills/Pets/Tech Tree).
//      clipTop     = 21px below the bottom of the last non-card gray run above the first card
//                    (the MVP pill) — the header is width-scaled, so that gap is a constant.
//      Fallbacks (cropped shots): the legacy 304 / H-218 offsets.
//   1. Section cards: rows y in [clipTop, clipBottom] whose fraction of card-gray
//      (|rgb-240|<10) pixels over x in [36,540) exceeds 0.15 -> contiguous runs; a run is a
//      card when it is >=CARD_MIN_H tall, its trimmed gray span is >=200px wide and that span
//      is CENTRED on the page (the MVP pill is gray and 172px wide but left-aligned).
//   2. Node circles: the proto ran cv2.HoughCircles then kept circles passing a dark-ring
//      annulus test inside a card band. Here the annulus test IS the detector (the proto's
//      col/row pitch makes full Hough unnecessary): a coarse grid scan over each card band
//      samples the ring at r~35.5, candidates are refined +-4px to the minimum of the exact
//      proto annulus mean (radii 34..37) and accepted when that mean < RING_DARK_MAX.
//      Dedup at the Hough minDist (60px).
//   3. Guards (partial nodes are SKIPPED, never misread): the ring probe only scans the part of
//      a card band where a WHOLE circle fits inside the clip (so a dark bottom-sheet overlay
//      cannot steal a real node's slot during the minDist dedup), and the level text line must
//      be fully visible (cy+TEXT_BOT <= clipBottom+2).
//   4. Level text: band [cx-58,cx+58] x [cy+34,cy+80]. White Baloo with a dark outline drawn
//      straight on the card: 4x cubic upscale, dark mask = max(R,G,B) < 120, white cores =
//      bright (min>170, retry 140) holes of the dark mask (components of the inverse not
//      touching the crop border), classified with the digitBank_v2 glyph matcher over the
//      charset '0123456789/Max'. Accepted strings: "<lvl>/<max>" or "Max".
//   5. Section titles: tesseract --psm 7 over [card_top-46, card_top-2], fuzzy-matched (>=0.7)
//      against the category display names. A band starting at the clip is untrusted.
//   6. Identity: alpha-masked per-channel NCC of each disc against every ClanTechTreeIconsMap
//      sprite at scales {46,50,54}px and +-6px offsets (step 2).
//   7. (category, row offset) per card: trusted title pins the category; geometry pins what it
//      can (top visible -> offset 0; not bottom-cut -> the visible run ends the category; a
//      partial row must be the category's final row; offsets step by the column count); icon
//      scores + "read /max == library MaxLevel" agreement vote among the rest. Reading-order
//      position -> nodeType via the FLATTENED library order = the app's global node id.
//   8. Header potions: crop x[58,150], y clipTop-208..clipTop-164 (the header is width-scaled,
//      so the pill sits at a fixed offset above the scroll clip), white digits in the dark pill,
//      digit charset; an abbreviated count ("2.69k") is detected from the trailing k/m/b glyph
//      and the widened gap where the decimal point was dropped.
//
// Deliberate deviations from the proto (documented): no 3x3 median blur before ring detection
// (the annulus decision is a ~670px mean — single-pixel noise is irrelevant), canvas-cubic in
// place of LANCZOS4 for the 3x title upscale (tesseract-input only), and LCS-based similarity
// in place of difflib.SequenceMatcher (same >=0.7 gate over the same 7 titles).
import { cropCanvas, evidenceCropUrl, type Rect } from './imagePrep';
import {
    loadGlyphBank, fitGlyph, scoreGlyphChar, connectedComponents, morphClose3, upscaleCanvas,
    type GlyphBank,
} from './numberReader';
import { ocr, PSM } from './ocrEngine';
import type { DetectedClanTree, DetectedClanNode } from './readerTypes';

// ------------------------------------------------------------------ proto PARAMS (576x1280)
const CANON_W = 576;
const CLIP_TOP_FALLBACK = 304;   // 576x1280 scroll-viewport top, used only if the header anchor
const CLIP_BOTTOM_FROM_H = 218;  // and the tab-strip anchor cannot be found (cropped shots)
const CARD_GRAY = 240, CARD_TOL = 10, CARD_X0 = 36, CARD_X1 = 540;
const CARD_ROW_FRAC = 0.15, CARD_MIN_H = 40;
const RUN_MIN_H = 10;            // shortest gray row-run considered at all (header pill parts)
const CARD_MIN_SPAN = 200;       // narrowest real card: the 2-column Special card spans ~270px
const CARD_CENTRE_TOL = 34;      // cards are centred on the page; the MVP pill is left-aligned
const SPAN_TRIM = 0.02;          // trimmed percentile for a row's gray span (kills stray pixels)
const BAR_PALE = 216, BAR_PALE_TOL = 14, BAR_PALE_FRAC = 0.9; // bottom tab strip fill
const BAR_DARK_MAX = 110, BAR_DARK_FRAC = 0.95;               // its dark cap line
const BAR_SEP_GAP = 8;           // clipBottom = (first dark cap row) - 8
const HEADER_PILL_GAP = 21;      // MVP-pill bottom -> scroll-viewport top (width-scaled header)
const ROW_TOL = 20;            // circle row clustering tolerance
const COL_PITCH = 117.7;       // circle column pitch
const MIN_DIST = 60;           // Hough minDist. Circle dedup radius
const RING_R = 38;             // nominal node circle radius
const RING_DARK_MAX = 110;     // annulus mean gray must be below this (dark navy ring)
const TEXT_BAND = [-58, 34, 58, 80] as const; // level-text crop rel. to centre (x0,y0,x1,y1)
const TEXT_BOT = 74;           // cy+TEXT_BOT must be <= CLIP_BOTTOM+2 for readable text
const DARK_THR = 120;          // outline mask: max(R,G,B) < DARK_THR
const BRIGHT_THR = 170;        // white core: min(R,G,B) > BRIGHT_THR (retry at 140)
const UPSCALE = 4;
const GLYPH_MIN_AREA = 60, GLYPH_MIN_H_FRAC = 0.45;
const ICON_SCALES = [46, 50, 54];
const ICON_OFFS = 6, ICON_OFF_STEP = 2;
const TITLE_BAND_H = 46;
const POTION_X = [58, 150] as const;          // x window of the header potion pill
const POTION_DY = [-208, -164] as const;      // y window relative to clipTop (=[96,140] @ 304)
const POTION_SUFFIX = ['k', 'm', 'b'] as const;
const POTION_SUFFIX_MARGIN = 0.03;            // suffix glyph must beat the digit fit by this
const POTION_DOT_GAP = 0.45;                  // dropped '.' -> gap > 0.45 * mean glyph width
const VOTE_MAX_BONUS = 0.25;
const VOTE_TITLE_BONUS = 0.20;
const LEVEL_CHARSET = '0123456789/Max'.split('');
const DIGITS = '0123456789'.split('');

// ------------------------------------------------------------------------- library loading
interface SpriteScale {
    relIdx: Int32Array;                              // masked px offsets, stride CANON_W
    tpl: [Float32Array, Float32Array, Float32Array]; // per-channel, mean-centred, L2-normed
    th: number; tw: number; n: number;
}
interface ClanLibs {
    cats: string[];
    catNodes: Record<string, string[]>;
    catStart: Record<string, number>;   // flattened offset per category (global node id base)
    catTitle: Record<string, string>;   // category key -> lowercase display title
    flat: string[];
    maxLvl: Record<string, number>;
    pyr: Record<string, SpriteScale[]>; // nodeType -> sprite templates at each ICON_SCALE
}
let libsP: Promise<ClanLibs> | null = null;

async function fetchJson(url: string): Promise<any> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    return r.json();
}

function loadTexture(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height);
            resolve({ data: d.data, w: c.width, h: c.height });
        };
        img.onerror = () => reject(new Error(`texture load failed: ${url}`));
        img.src = url;
    });
}

/** cv2 INTER_AREA-equivalent RGBA float downscale (fractional box filter). */
function areaResizeRGBA(src: Float32Array, w: number, h: number, dw: number, dh: number): Float32Array {
    const out = new Float32Array(dw * dh * 4);
    for (let y = 0; y < dh; y++) {
        const sy0 = y * h / dh, sy1 = (y + 1) * h / dh;
        for (let x = 0; x < dw; x++) {
            const sx0 = x * w / dw, sx1 = (x + 1) * w / dw;
            let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0, wsum = 0;
            for (let sy = Math.floor(sy0); sy < sy1; sy++) {
                const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
                if (wy <= 0) continue;
                for (let sx = Math.floor(sx0); sx < sx1; sx++) {
                    const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
                    if (wx <= 0) continue;
                    const wgt = wy * wx, p = (sy * w + sx) * 4;
                    acc0 += wgt * src[p]; acc1 += wgt * src[p + 1];
                    acc2 += wgt * src[p + 2]; acc3 += wgt * src[p + 3];
                    wsum += wgt;
                }
            }
            const q = (y * dw + x) * 4;
            if (wsum > 0) {
                out[q] = acc0 / wsum; out[q + 1] = acc1 / wsum;
                out[q + 2] = acc2 / wsum; out[q + 3] = acc3 / wsum;
            }
        }
    }
    return out;
}

/** Build the masked per-channel NCC templates for one sprite at the ICON_SCALES. */
function spriteScales(sp: Float32Array, w: number, h: number): SpriteScale[] {
    const out: SpriteScale[] = [];
    for (const size of ICON_SCALES) {
        const sc = size / Math.max(h, w);
        const tw = Math.max(1, Math.round(w * sc)), th = Math.max(1, Math.round(h * sc));
        const t = areaResizeRGBA(sp, w, h, tw, th);
        // masked pixel list + relative flat offsets at the canonical image stride
        const idx: number[] = [];
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
            if (t[(y * tw + x) * 4 + 3] > 128) idx.push(y * CANON_W + x);
        }
        const n = idx.length;
        if (n < 50) continue;
        const tpl: [Float32Array, Float32Array, Float32Array] = [
            new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (let c = 0; c < 3; c++) {
            let mean = 0;
            const vals = new Float32Array(n);
            let k = 0;
            for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
                if (t[(y * tw + x) * 4 + 3] > 128) { const v = t[(y * tw + x) * 4 + c]; vals[k++] = v; mean += v; }
            }
            mean /= n;
            let n2 = 0;
            for (let i = 0; i < n; i++) { const v = vals[i] - mean; vals[i] = v; n2 += v * v; }
            const nrm = Math.sqrt(n2);
            for (let i = 0; i < n; i++) tpl[c][i] = nrm > 1e-6 ? vals[i] / nrm : vals[i];
        }
        out.push({ relIdx: Int32Array.from(idx), tpl, th, tw, n });
    }
    return out;
}

async function loadLibs(): Promise<ClanLibs> {
    const base = import.meta.env.BASE_URL;
    const versions: string[] = await fetchJson(`${base}parsed_configs/versions.json`);
    const version = [...versions].sort((a, b) => b.localeCompare(a))[0];
    const [pos, upg, iconsMap] = await Promise.all([
        fetchJson(`${base}parsed_configs/${version}/GuildTechTreePositionLibrary.json`),
        fetchJson(`${base}parsed_configs/${version}/GuildTechTreeUpgradeLibrary.json`),
        fetchJson(`${base}parsed_configs/ClanTechTreeIconsMap.json`),
    ]);
    const cats = Object.keys(pos);                              // Object.keys order = app's order
    const catNodes: Record<string, string[]> = {};
    const catStart: Record<string, number> = {};
    const catTitle: Record<string, string> = {};
    const flat: string[] = [];
    for (const c of cats) {
        catStart[c] = flat.length;
        catNodes[c] = [...(pos[c]?.Nodes ?? [])];
        catTitle[c] = c.replace(/([A-Z])/g, ' $1').trim().toLowerCase(); // 'EggTimers' -> 'egg timers'
        flat.push(...catNodes[c]);
    }
    const maxLvl: Record<string, number> = {};
    for (const nt of flat) maxLvl[nt] = Number(upg?.[nt]?.MaxLevel ?? 0);

    // sprite pyramid: icons live on ClanTechTreeIcons.png OR are borrowed from the player
    // sheet TechTreeIcons.png — every mapping entry carries texture + sprite_rect (same data
    // techUtils.getClanIconStyle renders from).
    const sheetUrls = new Set<string>();
    for (const e of Object.values<any>(iconsMap?.mapping ?? {})) sheetUrls.add(e.texture);
    const sheets: Record<string, { data: Uint8ClampedArray; w: number; h: number }> = {};
    await Promise.all([...sheetUrls].map(async tex => {
        sheets[tex] = await loadTexture(`${base}Texture2D/${version}/${tex}`);
    }));
    const pyr: Record<string, SpriteScale[]> = {};
    for (const [, e] of Object.entries<any>(iconsMap?.mapping ?? {})) {
        const nt = e.name;
        if (!nt || !flat.includes(nt)) continue;
        const sheet = sheets[e.texture];
        const r = e.sprite_rect;
        if (!sheet || !r) continue;
        // crop sprite + alpha bbox (proto load_sprites)
        let minX = r.width, maxX = -1, minY = r.height, maxY = -1;
        for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
            const a = sheet.data[((r.y + y) * sheet.w + (r.x + x)) * 4 + 3];
            if (a > 10) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) continue;
        const sw = maxX - minX + 1, sh = maxY - minY + 1;
        const sp = new Float32Array(sw * sh * 4);
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
            const p = ((r.y + minY + y) * sheet.w + (r.x + minX + x)) * 4, q = (y * sw + x) * 4;
            sp[q] = sheet.data[p]; sp[q + 1] = sheet.data[p + 1];
            sp[q + 2] = sheet.data[p + 2]; sp[q + 3] = sheet.data[p + 3];
        }
        pyr[nt] = spriteScales(sp, sw, sh);
    }
    return { cats, catNodes, catStart, catTitle, flat, maxLvl, pyr };
}

function getLibs(): Promise<ClanLibs> {
    if (!libsP) libsP = loadLibs().catch(e => { libsP = null; throw e; });
    return libsP;
}

// ---------------------------------------------------------------------------- structure
/** Normalize the screenshot to the canonical 576px width the PARAMS are calibrated for. */
function canonCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    if (src.width === CANON_W) return src;
    const c = document.createElement('canvas');
    c.width = CANON_W;
    c.height = Math.max(1, Math.round(src.height * CANON_W / src.width));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
}

function median(v: number[]): number {
    if (!v.length) return 0;
    const s = [...v].sort((a, b) => a - b);
    return s[s.length >> 1];
}

interface Layout {
    clipTop: number;
    clipBottom: number;
    cards: [number, number][];
}

/**
 * Derive the scroll viewport and the section-card bands from CONTENT.
 *
 * Everything horizontal is device-independent once the shot is normalized to 576px width (the
 * game lays the tree out in width-scaled units), but every vertical offset moves with the aspect
 * ratio and the platform's safe areas — an iPhone 923x2000 shot normalizes to 576x1248 and its
 * scroll band sits 49px higher than the 576x1280 Android one the params were measured on. So:
 *   - clipBottom comes from the bottom tab strip: a full-width flat pale (#d8d8d8) band capped
 *     by a 2-3px dark line. The scroll content is clipped BAR_SEP_GAP above that line.
 *   - clipTop comes from the header: the MVP pill is the last gray run above the first card and
 *     the (width-scaled) header puts the viewport HEADER_PILL_GAP below its bottom.
 *   - cards are gray row-runs that are tall enough, wide enough AND centred; that last test is
 *     what separates a narrow 2-column card (centred, ~270px) from the MVP pill (left-aligned,
 *     ~172px) without needing a clip constant to hide the header.
 */
function findLayout(px: Uint8ClampedArray, W: number, H: number): Layout {
    const frac = new Float32Array(H), span = new Float32Array(H), mid = new Float32Array(H);
    const pale = new Float32Array(H), dark = new Float32Array(H);
    const gray = new Uint8Array(W);
    for (let y = 0; y < H; y++) {
        let win = 0, nGray = 0, nPale = 0, nDark = 0;
        for (let x = 0; x < W; x++) {
            const p = (y * W + x) * 4, r = px[p], g = px[p + 1], b = px[p + 2];
            const isGray = Math.abs(r - CARD_GRAY) < CARD_TOL && Math.abs(g - CARD_GRAY) < CARD_TOL
                && Math.abs(b - CARD_GRAY) < CARD_TOL;
            gray[x] = isGray ? 1 : 0;
            if (isGray) { nGray++; if (x >= CARD_X0 && x < CARD_X1) win++; }
            if (Math.abs(r - BAR_PALE) < BAR_PALE_TOL && Math.abs(g - BAR_PALE) < BAR_PALE_TOL
                && Math.abs(b - BAR_PALE) < BAR_PALE_TOL) nPale++;
            if (Math.max(r, g, b) < BAR_DARK_MAX) nDark++;
        }
        frac[y] = win / (CARD_X1 - CARD_X0);
        pale[y] = nPale / W; dark[y] = nDark / W;
        // trimmed gray span of the row (2nd..98th percentile => stray header pixels ignored)
        if (nGray >= 10) {
            const trim = Math.max(1, Math.floor(nGray * SPAN_TRIM));
            let acc = 0, x0 = 0, x1 = W - 1;
            for (let x = 0; x < W; x++) if (gray[x] && ++acc > trim) { x0 = x; break; }
            acc = 0;
            for (let x = W - 1; x >= 0; x--) if (gray[x] && ++acc > trim) { x1 = x; break; }
            span[y] = x1 - x0; mid[y] = (x0 + x1) / 2;
        }
    }
    // bottom tab strip: >=2 fully dark cap rows, then the flat pale band within 5 rows
    let barRow = -1;
    for (let y = H >> 1; y < H - 7 && barRow < 0; y++) {
        if (dark[y] < BAR_DARK_FRAC || dark[y + 1] < BAR_DARK_FRAC) continue;
        let n = 0;
        for (let k = 2; k <= 7; k++) if (pale[y + k] >= BAR_PALE_FRAC) n++;
        if (n >= 3) barRow = y;
    }
    let clipBottom = H - CLIP_BOTTOM_FROM_H;
    if (barRow - BAR_SEP_GAP > H / 4) clipBottom = barRow - BAR_SEP_GAP;
    clipBottom = Math.max(1, Math.min(H - 1, clipBottom));

    // gray row-runs, classified into cards vs header furniture
    interface Run { top: number; bot: number; wide: boolean; card: boolean }
    const runs: Run[] = [];
    for (let y = 0; y <= clipBottom;) {
        if (frac[y] > CARD_ROW_FRAC) {
            const y0 = y;
            while (y <= clipBottom && frac[y] > CARD_ROW_FRAC) y++;
            const bot = y - 1;
            if (bot - y0 + 1 >= RUN_MIN_H) {
                const sp: number[] = [], mi: number[] = [];
                for (let r = y0; r <= bot; r++) if (span[r] > 0) { sp.push(span[r]); mi.push(mid[r]); }
                // "wide" = card-shaped (a centred, wide gray slab); a wide run too short to hold
                // a node row is still card, not header furniture, so it must not anchor clipTop.
                const wide = median(sp) >= CARD_MIN_SPAN && Math.abs(median(mi) - W / 2) <= CARD_CENTRE_TOL;
                runs.push({ top: y0, bot, wide, card: wide && bot - y0 + 1 >= CARD_MIN_H });
            }
        } else y++;
    }

    const firstWide = runs.find(r => r.wide);
    let clipTop = CLIP_TOP_FALLBACK;
    if (firstWide) {
        let anchor = -1;
        for (const r of runs) if (!r.wide && r.bot < firstWide.top) anchor = Math.max(anchor, r.bot);
        clipTop = anchor >= 0 ? Math.min(anchor + HEADER_PILL_GAP, firstWide.top) : firstWide.top;
    }
    clipTop = Math.max(0, Math.min(clipTop, clipBottom - 1));

    const cards: [number, number][] = [];
    for (const r of runs) {
        if (!r.card) continue;
        const top = Math.max(r.top, clipTop), bot = Math.min(r.bot, clipBottom);
        if (bot - top + 1 >= CARD_MIN_H) cards.push([top, bot]);
    }
    return { clipTop, clipBottom, cards };
}

/** Precomputed (dy,dx) offsets of the proto's exact annulus (radii RING_R-4 .. RING_R-1). */
let annulusOffs: Int32Array | null = null;
function getAnnulus(): Int32Array {
    if (!annulusOffs) {
        const rr = RING_R, lo = (rr - 4) * (rr - 4), hi = (rr - 1) * (rr - 1);
        const offs: number[] = [];
        for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
            const d2 = dy * dy + dx * dx;
            if (d2 >= lo && d2 <= hi) { offs.push(dy); offs.push(dx); }
        }
        annulusOffs = Int32Array.from(offs);
    }
    return annulusOffs;
}

function annulusMean(gray: Float32Array, W: number, H: number, cx: number, cy: number): number {
    const offs = getAnnulus();
    let s = 0, n = 0;
    for (let i = 0; i < offs.length; i += 2) {
        const y = cy + offs[i], x = cx + offs[i + 1];
        if (y < 0 || y >= H || x < 0 || x >= W) return 255;
        s += gray[y * W + x]; n++;
    }
    return n ? s / n : 255;
}

/** Dark-ring circle centres inside the card bands (the proto's Hough+annulus, Hough-free).
 *  The annulus test alone is decisive here: inside a card band nothing but a node ring can
 *  keep a 76px-diameter, 3px-wide annulus dark (text glyphs and connector lines are far too
 *  small, overlay badges cover only a small arc), matching the proto's zero-extras result. */
function findCircles(gray: Float32Array, W: number, H: number, cards: [number, number][],
    clipTop: number, clipBottom: number): { x: number; y: number }[] {
    // coarse ring probe: 24 samples at the annulus mid-radius
    const RS = RING_R - 2.5;
    const probe: number[] = [];
    for (let k = 0; k < 24; k++) {
        const a = 2 * Math.PI * k / 24;
        probe.push(Math.round(RS * Math.sin(a))); probe.push(Math.round(RS * Math.cos(a)));
    }
    interface Cand { x: number; y: number; m: number }
    const cands: Cand[] = [];
    for (const [top, bot] of cards) {
        // only where a WHOLE ring fits inside the scroll clip: a partial node is unusable anyway,
        // and a dark bottom-sheet overlay sitting on the clip edge must not win the minDist dedup
        // against the real (fully visible) node ring it overlaps.
        const yLo = Math.max(RING_R, top - 8, clipTop + RING_R);
        const yHi = Math.min(H - 1 - RING_R, bot + 8, clipBottom - RING_R);
        for (let y = yLo; y <= yHi; y += 3) {
            for (let x = Math.max(RING_R, CARD_X0 + 24); x <= Math.min(W - 1 - RING_R, CARD_X1 - 24); x += 3) {
                let s = 0;
                for (let i = 0; i < probe.length; i += 2) s += gray[(y + probe[i]) * W + (x + probe[i + 1])];
                if (s / 24 < RING_DARK_MAX + 20) cands.push({ x, y, m: s / 24 });
            }
        }
    }
    cands.sort((a, b) => a.m - b.m);
    const accepted: { x: number; y: number }[] = [];
    for (const c of cands) {
        if (accepted.some(a => Math.abs(a.x - c.x) < MIN_DIST && Math.abs(a.y - c.y) < MIN_DIST)) continue;
        // refine to the minimum of the exact annulus mean
        let bx = c.x, by = c.y, bm = annulusMean(gray, W, H, c.x, c.y);
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            if (!dx && !dy) continue;
            const m = annulusMean(gray, W, H, c.x + dx, c.y + dy);
            if (m < bm) { bm = m; bx = c.x + dx; by = c.y + dy; }
        }
        if (bm > RING_DARK_MAX) continue;
        if (by - RING_R < clipTop || by + RING_R > clipBottom) continue;   // refine may drift out
        if (accepted.some(a => Math.abs(a.x - bx) < MIN_DIST && Math.abs(a.y - by) < MIN_DIST)) continue;
        accepted.push({ x: bx, y: by });
    }
    return accepted;
}

// --------------------------------------------------------------- outlined-text extraction
interface Core { x: number; g: Float32Array; w: number; h: number }

/** White Baloo text with a dark outline: white cores = bright holes of the dark mask.
 *  Port of proto extract_cores (4x cubic upscale, same masks/filters/band logic). */
function extractCores(crop: HTMLCanvasElement, bank: GlyphBank, brightThr: number): Core[] {
    const up = upscaleCanvas(crop, UPSCALE);
    const W = up.width, H = up.height;
    const px = up.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const mx = new Int16Array(W * H), mn = new Int16Array(W * H);
    let dark: Uint8Array = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const ma = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mi = r < g ? (r < b ? r : b) : (g < b ? g : b);
        mx[p] = ma; mn[p] = mi;
        if (ma < DARK_THR) dark[p] = 1;
    }
    dark = morphClose3(dark, W, H);
    const inv = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) inv[p] = dark[p] ? 0 : 1;
    const { labels, stats } = connectedComponents(inv, W, H);
    interface CandBox { x: number; y: number; w: number; h: number; id: number }
    const cands: CandBox[] = [];
    for (const s of stats) {
        // components containing crop-border pixels are background, not glyph cores
        if (s.x === 0 || s.y === 0 || s.x + s.w === W || s.y + s.h === H) continue;
        if (s.area < GLYPH_MIN_AREA || s.w < 4 || s.h < 8) continue;
        let bright = 0;
        for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) {
            const p = (s.y + yy) * W + (s.x + xx);
            if (labels[p] === s.id && mn[p] > brightThr) bright++;
        }
        if (bright < 0.4 * s.area) continue;
        cands.push({ x: s.x, y: s.y, w: s.w, h: s.h, id: s.id });
    }
    if (!cands.length) return [];
    // drop counters/fragments whose bbox is inside another glyph's bbox
    const keep = cands.filter((c, i) => !cands.some((o, j) =>
        j !== i && c.x >= o.x && c.y >= o.y && c.x + c.w <= o.x + o.w && c.y + c.h <= o.y + o.h));
    if (!keep.length) return [];
    const hmax = Math.max(...keep.map(k => k.h));
    const centres = keep.filter(k => k.h > 0.6 * hmax).map(k => k.y + k.h / 2).sort((a, b) => a - b);
    const band = centres.length ? centres[centres.length >> 1] : H * 0.4;
    const res: Core[] = [];
    for (const k of keep) {
        if (k.h < GLYPH_MIN_H_FRAC * hmax) continue;
        if (Math.abs((k.y + k.h / 2) - band) > 0.9 * hmax) continue;
        const sub = new Float32Array(k.w * k.h);
        for (let yy = 0; yy < k.h; yy++) for (let xx = 0; xx < k.w; xx++) {
            const p = (k.y + yy) * W + (k.x + xx);
            if (labels[p] === k.id) sub[yy * k.w + xx] = mn[p];
        }
        const g = fitGlyph(sub, k.w, k.h, bank.gw, bank.gh);
        let m = 0;
        for (let i = 0; i < g.length; i++) if (g[i] > m) m = g[i];
        if (m > 1e-3) for (let i = 0; i < g.length; i++) g[i] /= m;
        res.push({ x: k.x, g, w: k.w, h: k.h });
    }
    res.sort((a, b) => a.x - b.x);
    return res;
}

/** Every glyph scored against the FULL charset — the blended matcher separates the chars by
 *  wide margins (proto-measured: correct 0.87-0.97 vs runner-up <=0.83), no height gating. */
function classifyText(cores: Core[], bank: GlyphBank, charset: string[]): string {
    let s = '';
    for (const c of cores) {
        let best = '', bs = -Infinity;
        for (const ch of charset) {
            const sc = scoreGlyphChar(bank, c.g, ch);
            if (sc > bs) { bs = sc; best = ch; }
        }
        if (!best) return '';
        s += best;
    }
    return s;
}

type LevelKind = 'digits' | 'max' | null;
function readLevelText(band: HTMLCanvasElement, bank: GlyphBank): { kind: LevelKind; lvl: number | null; mx: number | null } {
    for (const thr of [BRIGHT_THR, 140]) {
        const s = classifyText(extractCores(band, bank, thr), bank, LEVEL_CHARSET);
        if (s === 'Max') return { kind: 'max', lvl: null, mx: null };
        const m = /^(\d{1,3})\/(\d{1,3})$/.exec(s);
        if (m) return { kind: 'digits', lvl: parseInt(m[1], 10), mx: parseInt(m[2], 10) };
    }
    return { kind: null, lvl: null, mx: null };
}

function potionRect(clipTop: number): Rect {
    return { x: POTION_X[0], y: clipTop + POTION_DY[0], w: POTION_X[1] - POTION_X[0], h: POTION_DY[1] - POTION_DY[0] };
}

/** The pill abbreviates large counts ("2.69k"). The '.' is below the glyph-height floor and is
 *  dropped by extractCores, so recover it from the gap it left behind. */
function potionValue(cores: Core[], digits: string, suffix: string): number {
    const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1e9;
    let wide = -1, bg = 0, wAvg = 0;
    for (let i = 0; i < digits.length; i++) wAvg += cores[i].w;
    wAvg /= Math.max(1, digits.length);
    for (let i = 1; i < digits.length; i++) {
        const gap = cores[i].x - (cores[i - 1].x + cores[i - 1].w);
        if (gap > bg) { bg = gap; wide = i; }
    }
    const dot = bg > POTION_DOT_GAP * wAvg && wide > 0 ? wide : digits.length;
    return Math.round(parseFloat(`${digits.slice(0, dot)}.${digits.slice(dot) || '0'}`) * mult);
}

function readPotion(canvas: HTMLCanvasElement, bank: GlyphBank, clipTop: number): number | null {
    const crop = cropCanvas(canvas, potionRect(clipTop));
    for (const thr of [BRIGHT_THR, 140]) {
        const cores = extractCores(crop, bank, thr);
        const s = classifyText(cores, bank, DIGITS);
        if (s.length < 2 || !/^\d+$/.test(s) || cores.length !== s.length) continue;
        // is the trailing glyph really a k/m/b magnitude suffix rather than a digit?
        const last = cores[cores.length - 1];
        let sfx = '', sv = -Infinity;
        for (const c of POTION_SUFFIX) { const v = scoreGlyphChar(bank, last.g, c); if (v > sv) { sv = v; sfx = c; } }
        if (!sfx || sv <= scoreGlyphChar(bank, last.g, s[s.length - 1]) + POTION_SUFFIX_MARGIN) return parseInt(s, 10);
        const digits = s.slice(0, -1);
        if (digits.length) return potionValue(cores, digits, sfx);
    }
    return null;
}

// -------------------------------------------------------------------------- section titles
/** difflib-style similarity via longest common subsequence: 2*LCS/(la+lb). */
function lcsRatio(a: string, b: string): number {
    const la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    let prev = new Int32Array(lb + 1), cur = new Int32Array(lb + 1);
    for (let i = 1; i <= la; i++) {
        for (let j = 1; j <= lb; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        [prev, cur] = [cur, prev];
    }
    return 2 * prev[lb] / (la + lb);
}

async function ocrTitle(canvas: HTMLCanvasElement, y0: number, y1: number, libs: ClanLibs): Promise<string | null> {
    if (y1 - y0 < 14) return null;
    const band = cropCanvas(canvas, { x: 60, y: y0, w: 516 - 60, h: y1 - y0 });
    const raw = await ocr(upscaleCanvas(band, 3), { psm: PSM.SINGLE_LINE }).then(r => r.text).catch(() => '');
    const txt = raw.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (!txt) return null;
    let best: string | null = null, bs = 0;
    for (const cat of libs.cats) {
        const s = lcsRatio(txt, libs.catTitle[cat]);
        if (s > bs) { bs = s; best = cat; }
    }
    return bs >= 0.7 ? best : null;
}

// ------------------------------------------------------------------------------ icon NCC
/** Best alpha-masked per-channel NCC of the disc at (cx,cy) against every sprite. */
function iconScores(px: Uint8ClampedArray, W: number, H: number, cx: number, cy: number,
    pyr: Record<string, SpriteScale[]>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [nt, scales] of Object.entries(pyr)) {
        let best = -2.0;
        for (const sc of scales) {
            const { relIdx, tpl, th, tw, n } = sc;
            for (let dy = -ICON_OFFS; dy <= ICON_OFFS; dy += ICON_OFF_STEP) {
                for (let dx = -ICON_OFFS; dx <= ICON_OFFS; dx += ICON_OFF_STEP) {
                    const y0 = Math.round(cy - th / 2 + dy), x0 = Math.round(cx - tw / 2 + dx);
                    if (y0 < 0 || x0 < 0 || y0 + th > H || x0 + tw > W) continue;
                    const base = y0 * W + x0;
                    let s = 0;
                    for (let c = 0; c < 3; c++) {
                        const t = tpl[c];
                        let s1 = 0, s2 = 0, d = 0;
                        for (let i = 0; i < n; i++) {
                            const v = px[(base + relIdx[i]) * 4 + c];
                            s1 += v; s2 += v * v; d += v * t[i];
                        }
                        const den = Math.sqrt(s2 - s1 * s1 / n);
                        // template channels are zero-mean, so dot(raw, t) == dot(centred, t)
                        if (den > 1e-6) s += d / den;
                    }
                    s /= 3;
                    if (s > best) best = s;
                }
            }
        }
        out[nt] = best;
    }
    return out;
}

// ---------------------------------------------------------------------------- main reader
interface NodeRead {
    cx: number; cy: number; vrow: number; col: number;
    kind: LevelKind; lvl: number | null; mx: number | null;
    icons: Record<string, number>;
    pos?: number; nodeType?: string;
}

/**
 * Read every fully-visible clan tech node (+ the header guild-potion count) off one Clan Tech
 * Tree screenshot. Partially scrolled-off nodes are skipped, never misread; identity comes from
 * the card's (category, offset) resolution so each node carries its global (flattened) id.
 */
export async function readClanTree(input: HTMLCanvasElement): Promise<DetectedClanTree> {
    const [bank, libs] = await Promise.all([loadGlyphBank(), getLibs()]);
    const canvas = canonCanvas(input);
    const W = canvas.width, H = canvas.height;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const gray = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) gray[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

    const { clipTop, clipBottom, cards } = findLayout(px, W, H);
    const circles = findCircles(gray, W, H, cards, clipTop, clipBottom);
    const dbg: any[] | undefined = (globalThis as any).__CLANTREE_DEBUG__;
    if (dbg) dbg.push({ W, H, clipTop, clipBottom, cards, circles: circles.map(c => ({ ...c, ann: Math.round(annulusMean(gray, W, H, c.x, c.y)) })), titles: [] as (string | null)[] });
    const guildPotions = readPotion(canvas, bank, clipTop);
    const potionCropUrl = guildPotions != null ? evidenceCropUrl(canvas, potionRect(clipTop), 140) : undefined;

    const nodes: DetectedClanNode[] = [];
    let acceptedCircles = 0, readCircles = 0;

    for (const [top, bot] of cards) {
        const cs = circles.filter(c => top - 8 <= c.y && c.y <= bot + 8)
            .sort((a, b) => a.y - b.y || a.x - b.x);
        if (!cs.length) continue;

        // rows / columns
        const allRows: { x: number; y: number }[][] = [];
        for (const c of cs) {
            const row = allRows.find(r => Math.abs(r[0].y - c.y) < ROW_TOL);
            if (row) row.push(c); else allRows.push([c]);
        }
        // Guards are applied per ROW, on its median centre (partial nodes SKIPPED, never misread).
        // Per-circle would let the +-4px ring-refine jitter split one grid row into a "partial"
        // row and then fail the final-row check, dropping the whole card.
        const rows = allRows.filter(r => {
            const cy = median(r.map(c => c.y));
            return cy - RING_R >= clipTop && cy + RING_R <= clipBottom && cy + TEXT_BOT <= clipBottom + 2;
        });
        if (!rows.length) continue;
        rows.sort((a, b) => a[0].y - b[0].y);
        for (const r of rows) r.sort((a, b) => a.x - b.x);
        const minCx = Math.min(...rows.flat().map(c => c.x));
        const ncols = Math.max(...rows.map(r => r.length));
        const cardNodes: NodeRead[] = [];
        rows.forEach((r, vrow) => {
            for (const c of r) {
                cardNodes.push({ cx: c.x, cy: c.y, vrow, col: Math.round((c.x - minCx) / COL_PITCH), kind: null, lvl: null, mx: null, icons: {} });
            }
        });
        cardNodes.sort((a, b) => a.vrow - b.vrow || a.col - b.col);

        // read level text + icon scores
        for (const nd of cardNodes) {
            const bx0 = Math.max(0, nd.cx + TEXT_BAND[0]);
            const by0 = nd.cy + TEXT_BAND[1];
            const bx1 = Math.min(W, nd.cx + TEXT_BAND[2]);
            const by1 = Math.min(nd.cy + TEXT_BAND[3], clipBottom);
            const band = cropCanvas(canvas, { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 });
            const r = readLevelText(band, bank);
            nd.kind = r.kind; nd.lvl = r.lvl; nd.mx = r.mx;
            nd.icons = iconScores(px, W, H, nd.cx, nd.cy, libs.pyr);
        }

        const topCut = top <= clipTop + 4;
        const botCut = bot >= clipBottom - 4;
        const tb0 = Math.max(clipTop, top - TITLE_BAND_H);
        const titleCat = await ocrTitle(canvas, tb0, top - 2, libs);
        const titleTrusted = titleCat !== null && (top - TITLE_BAND_H) >= clipTop;
        if (dbg) dbg[dbg.length - 1].titles.push(`${top}-${bot} ${titleCat}${titleTrusted ? '!' : '?'} tc=${topCut} bc=${botCut}`);

        // candidate (category, offset) vote
        const nVis = cardNodes.length;
        const partialRows = rows.map((r, i) => [r.length, i] as const).filter(([len]) => len < ncols).map(([, i]) => i);
        interface Cand { score: number; cat: string; pos: Record<number, number> }
        const cands: Cand[] = [];
        const catPool = titleTrusted ? [titleCat!] : libs.cats;
        for (const cat of catPool) {
            const N = libs.catNodes[cat].length;
            const offs: number[] = [];
            if (!topCut) offs.push(0);
            else for (let o = 0; o < N; o += Math.max(1, ncols)) offs.push(o);
            for (const off of offs) {
                if (off + nVis > N) continue;
                if (!botCut && off + nVis !== N) continue;
                const pos: Record<number, number> = {};
                let bad = false;
                for (let i = 0; i < cardNodes.length; i++) {
                    const p = off + cardNodes[i].vrow * ncols + cardNodes[i].col;
                    if (p >= N) { bad = true; break; }
                    pos[i] = p;
                }
                if (bad) continue;
                // a partial visible row must be the category's final row
                if (partialRows.length) {
                    if (partialRows.length > 1) continue;
                    const vr = partialRows[0];
                    const lastOfRow = off + vr * ncols + rows[vr].length - 1;
                    if (vr !== rows.length - 1 || lastOfRow !== N - 1) continue;
                }
                let iconM = 0;
                for (const [i, p] of Object.entries(pos)) iconM += cardNodes[+i].icons[libs.catNodes[cat][p]] ?? -2;
                iconM /= nVis;
                let mxAll = 0, mxOk = 0;
                for (const [i, p] of Object.entries(pos)) {
                    const nd = cardNodes[+i];
                    if (nd.kind === 'digits') {
                        mxAll++;
                        if (nd.mx === libs.maxLvl[libs.catNodes[cat][p]]) mxOk++;
                    }
                }
                const mxFrac = mxAll ? mxOk / mxAll : 0.5;
                let score = iconM + VOTE_MAX_BONUS * mxFrac;
                if (titleCat === cat && !titleTrusted) score += VOTE_TITLE_BONUS;
                cands.push({ score, cat, pos });
            }
        }
        if (!cands.length) continue;
        cands.sort((a, b) => b.score - a.score);
        const { cat, pos } = cands[0];

        for (let i = 0; i < cardNodes.length; i++) {
            const nd = cardNodes[i];
            acceptedCircles++;
            if (nd.kind === null) continue;   // level text unreadable -> skip, never guess
            readCircles++;
            const nodeType = libs.catNodes[cat][pos[i]];
            const max = libs.maxLvl[nodeType] ?? 0;
            const level = nd.kind === 'max' ? max : Math.max(0, Math.min(max || nd.lvl!, nd.lvl!));
            const ncc = nd.icons[nodeType] ?? 0;
            nodes.push({
                globalId: libs.catStart[cat] + pos[i],
                nodeType, level, max,
                confidence: Math.max(0, Math.min(1, ncc)),
                cropUrl: evidenceCropUrl(canvas, {
                    x: Math.max(0, nd.cx - 58), y: Math.max(0, nd.cy - RING_R - 4),
                    w: 116, h: Math.min(clipBottom, nd.cy + TEXT_BAND[3]) - (nd.cy - RING_R - 4),
                } as Rect, 120),
            });
        }
    }

    return {
        nodes,
        guildPotions,
        potionCropUrl,
        confidence: acceptedCircles ? readCircles / acceptedCircles : 0,
    };
}
