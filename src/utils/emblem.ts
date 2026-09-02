/**
 * Guild emblem art — the ONE renderer.
 * ===========================================================================
 *
 * The game ships everything an emblem is made of, so nothing here is invented:
 *
 *   public/parsed_configs/<version>/GuildEmblemColors.json
 *       9 entries. ColorId 0..6 are ColorType "Background" (they tint the
 *       SHAPE), ColorId 7..8 are ColorType "Foreground" (they tint the SYMBOL
 *       and the holder). Nothing else exists. The split is read from ColorType,
 *       never from index arithmetic, so a colour drop that reorders or extends
 *       the list keeps working.
 *
 *   public/Texture2D/<version>/EmblemShapes.png   1024x1024, 4x4 -> 16 shapes
 *   public/Texture2D/<version>/EmblemIcons.png    2048x2048, 8x8 -> 64 symbols
 *   public/Texture2D/<version>/EmblemHolder.png   256x256, the banner/frame
 *
 * All three sheets are greyscale + alpha line art (black outline, white fill,
 * one grey inner shadow), which is why tinting is a MULTIPLY and not a flat
 * mask: white * tint = tint, grey * tint = a shade darker, black * tint =
 * black, so a tinted cell still reads as line art. `destination-in` then clips
 * the tinted box back to the sprite's own alpha so the flat colour cannot leak
 * out as a coloured square.
 *
 * Everything that composes an emblem lives in drawEmblem() below. src/pages/
 * Emblems.tsx (the designer + PNG export) and <ClanBadge> (rosters, clan
 * cards) both go through it — there is no second implementation of the tint or
 * of the layer geometry to drift out of sync.
 *
 * React-free on purpose: the hooks and the component live in
 * src/components/UI/Emblem.tsx, so this module can be exercised from node
 * (reverseForge/scratch/clan_badge_roundtrip.ts).
 */

/* -------------------------------------------------------------------------- */
/* Colours — straight out of GuildEmblemColors.json                           */
/* -------------------------------------------------------------------------- */

export type EmblemColorType = 'Background' | 'Foreground';

/** One row of GuildEmblemColors.json. */
export interface GuildEmblemColor {
    ColorId: number;
    ColorType: EmblemColorType;
    HexCode: string;
}

/**
 * GuildEmblemColors.json, split by ColorType and indexed by ColorId.
 *
 * `background` and `foreground` are sorted by ColorId and are the ONLY lists a
 * picker may offer. `loaded` is false until the config resolves, which is the
 * signal to draw nothing rather than to guess a colour.
 */
export interface EmblemColors {
    loaded: boolean;
    byId: ReadonlyMap<number, GuildEmblemColor>;
    /** ColorType 'Background' — tints the shape. */
    background: readonly GuildEmblemColor[];
    /** ColorType 'Foreground' — tints the symbol and the holder. */
    foreground: readonly GuildEmblemColor[];
}

export const EMPTY_EMBLEM_COLORS: EmblemColors = {
    loaded: false,
    byId: new Map(),
    background: [],
    foreground: [],
};

/**
 * Index the raw config (the parser emits an object keyed by ColorId as a
 * string). Tolerates a missing/half-written file: anything without a numeric
 * ColorId, a known ColorType and a `#rrggbb` HexCode is dropped rather than
 * poisoning the picker with a colour that cannot be drawn.
 */
export function indexEmblemColors(raw: unknown): EmblemColors {
    if (!raw || typeof raw !== 'object') return EMPTY_EMBLEM_COLORS;

    const byId = new Map<number, GuildEmblemColor>();
    for (const value of Object.values(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object') continue;
        const { ColorId, ColorType, HexCode } = value as Partial<GuildEmblemColor>;
        if (typeof ColorId !== 'number' || !Number.isInteger(ColorId) || ColorId < 0) continue;
        if (ColorType !== 'Background' && ColorType !== 'Foreground') continue;
        if (typeof HexCode !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(HexCode)) continue;
        byId.set(ColorId, { ColorId, ColorType, HexCode });
    }
    if (byId.size === 0) return EMPTY_EMBLEM_COLORS;

    const all = [...byId.values()].sort((a, b) => a.ColorId - b.ColorId);
    return {
        loaded: true,
        byId,
        background: all.filter(c => c.ColorType === 'Background'),
        foreground: all.filter(c => c.ColorType === 'Foreground'),
    };
}

/**
 * Fold any stored colour id into a list of real colours, deterministically.
 *
 * A valid id is returned untouched. Anything else (a legacy row from before
 * the ranges were tightened, a hand-edited API response, NaN) maps to
 * `list[id % list.length]`. That is EXACTLY the rule
 * supabase/migrations/0006_badge_colors.sql uses to remap live rows —
 * `old % 7` for the Background ids and `7 + (old % 2)` for the Foreground ids
 * are the same arithmetic on today's contiguous id lists — so the client and
 * the database agree on what an out-of-range badge looks like instead of each
 * inventing its own fallback.
 */
export function coerceEmblemColorId(list: readonly GuildEmblemColor[], id: unknown): number | null {
    if (list.length === 0) return null;
    const n = typeof id === 'number' ? id : Number(id);
    if (Number.isFinite(n)) {
        const i = Math.trunc(n);
        if (list.some(c => c.ColorId === i)) return i;
        return list[((i % list.length) + list.length) % list.length].ColorId;
    }
    return list[0].ColorId;
}

/** Hex of a colour id, or null when the config has not resolved yet. */
export function emblemColorHex(colors: EmblemColors, id: number): string | null {
    return colors.byId.get(id)?.HexCode ?? null;
}

/**
 * A cosmetic, human-readable name for a hex — DERIVED, never a lookup table.
 *
 * The config gives colours an id and a hex and no name, and the app's existing
 * emblem UI labels them by hex (Emblems.tsx puts the hex in the swatch title).
 * A screen reader saying "hash eff cee six seven two ay" is useless though, so
 * the hue is computed instead. Today's nine colours come out as: orange, red,
 * rose, violet, blue, light blue, dark grey, gold, white — nine distinct
 * labels. This is a label generator, not a palette: a future colour drop gets
 * a sensible name for free, and the hex is always shown alongside it so two
 * colours that happen to share a name are still distinguishable.
 */
export function emblemColorLabel(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 'colour';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;

    if (d < 0.08) {
        if (l > 0.92) return 'white';
        if (l > 0.65) return 'light grey';
        if (l > 0.4) return 'grey';
        if (l > 0.12) return 'dark grey';
        return 'black';
    }

    let h: number;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;

    const hue =
        h < 15 ? 'red' :
            h < 41 ? 'orange' :
                h < 71 ? 'gold' :
                    h < 161 ? 'green' :
                        h < 201 ? 'cyan' :
                            h < 251 ? 'blue' :
                                h < 291 ? 'violet' :
                                    h < 331 ? 'magenta' : 'rose';

    // Two colours of the same hue are told apart by lightness, which is what
    // separates #327DF3 ("blue") from #469EFF ("light blue").
    if (l > 0.62 && hue !== 'gold') return `light ${hue}`;
    if (l < 0.3) return `dark ${hue}`;
    return hue;
}

/* -------------------------------------------------------------------------- */
/* Sheets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A sprite atlas under public/Texture2D/<version>/.
 *
 * The cell size is NOT stored: it is derived from the decoded image at draw
 * time (`img.width / columns`), the way Emblems.tsx has always done it, so a
 * re-exported atlas at a different resolution keeps working.
 */
export interface EmblemSheet {
    file: string;
    columns: number;
    rows: number;
}

export const EMBLEM_SHAPE_SHEET: EmblemSheet = { file: 'EmblemShapes.png', columns: 4, rows: 4 };
export const EMBLEM_ICON_SHEET: EmblemSheet = { file: 'EmblemIcons.png', columns: 8, rows: 8 };
/** The banner the shape hangs from. One cell — the whole image. */
export const EMBLEM_HOLDER_SHEET: EmblemSheet = { file: 'EmblemHolder.png', columns: 1, rows: 1 };

export const EMBLEM_SHAPE_COUNT = EMBLEM_SHAPE_SHEET.columns * EMBLEM_SHAPE_SHEET.rows; // 16
export const EMBLEM_ICON_COUNT = EMBLEM_ICON_SHEET.columns * EMBLEM_ICON_SHEET.rows;    // 64

/**
 * The Texture2D/ folders that actually ship the three emblem sheets, newest
 * first.
 *
 * This is NOT versions.json: that lists 23 config versions and only these 13
 * have a Texture2D/ folder at all. An <img> or a CSS background that 404s
 * cannot report the failure, so on the other 10 versions every emblem in the
 * app would silently stay blank with nothing to retry — which is exactly what
 * Emblems.tsx did before this list existed.
 *
 * reverseForge/scratch/clan_badge_roundtrip.ts checks it against the real
 * contents of public/Texture2D/, so a new texture drop fails a check instead
 * of letting the list rot.
 */
export const EMBLEM_ART_VERSIONS: readonly string[] = [
    '2026_09_02_09_08', '2026_08_26_08_49',
    '2026_08_21_00_29', '2026_07_15_12_09', '2026_07_14_17_28', '2026_07_03_12_39',
    '2026_05_23_14_08', '2026_05_21_16_30', '2026_05_21_13_52', '2026_05_15_20_01',
    '2026_05_12_12_51', '2026_05_08_11_30', '2026_05_08_11_17', '2026_05_06_11_12',
    '2026_04_02',
];

/**
 * Fallback art version: the newest one that carries the sheets.
 *
 * Falling back is free — EmblemShapes.png (md5 3f8ec895), EmblemIcons.png
 * (8f4fbf3f) and EmblemHolder.png (4517f9c2) are byte-identical in all 13
 * folders that have them, so which version an emblem is drawn from cannot
 * change how it looks.
 */
export const EMBLEM_FALLBACK_VERSION = EMBLEM_ART_VERSIONS[0];

/** True when `version` ships the emblem sheets. */
export function hasEmblemArt(version: string | null | undefined): boolean {
    return !!version && EMBLEM_ART_VERSIONS.includes(version);
}

/** The version an emblem should be drawn from, given the app's selection. */
export function resolveEmblemArtVersion(version: string | null | undefined): string {
    return hasEmblemArt(version) ? (version as string) : EMBLEM_FALLBACK_VERSION;
}

/** Vite base path; safe outside a bundler (returns '/'). */
function baseUrl(): string {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    return env?.BASE_URL ?? '/';
}

/** e.g. `/Texture2D/2026_08_21_00_29/EmblemShapes.png`. */
export function emblemSheetUrl(sheet: EmblemSheet, version?: string | null): string {
    return `${baseUrl()}Texture2D/${resolveEmblemArtVersion(version)}/${sheet.file}`;
}

/** Row-major cell index -> {col,row}, folded into the sheet. */
export function emblemCell(sheet: EmblemSheet, index: unknown): { col: number; row: number } {
    const count = sheet.columns * sheet.rows;
    const n = typeof index === 'number' ? index : Number(index);
    const i = Number.isFinite(n) ? ((Math.trunc(n) % count) + count) % count : 0;
    return { col: i % sheet.columns, row: Math.floor(i / sheet.columns) };
}

/**
 * CSS for showing ONE raw (untinted) atlas cell as a background image — the
 * picker tiles in both Emblems.tsx and <ClanBadgePicker>. Percentages, not
 * pixels, so a tile can be any size; the sheets are light-grey line art, which
 * reads fine on the app's dark cards.
 */
export function emblemCellBackground(
    sheet: EmblemSheet,
    index: number,
    version?: string | null,
): { backgroundImage: string; backgroundPosition: string; backgroundSize: string } {
    const { col, row } = emblemCell(sheet, index);
    return {
        backgroundImage: `url(${emblemSheetUrl(sheet, version)})`,
        backgroundPosition: `${(col * 100) / (sheet.columns - 1 || 1)}% ${(row * 100) / (sheet.rows - 1 || 1)}%`,
        backgroundSize: `${sheet.columns * 100}% ${sheet.rows * 100}%`,
    };
}

/* -------------------------------------------------------------------------- */
/* Loading the three sheets                                                   */
/* -------------------------------------------------------------------------- */

export interface EmblemSheets {
    holder: HTMLImageElement;
    shapes: HTMLImageElement;
    icons: HTMLImageElement;
}

const sheetPromises = new Map<string, Promise<EmblemSheets>>();

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`failed to load ${url}`));
        img.src = url;
    });
}

/**
 * Decode the three sheets for a version, once per version per session. Every
 * emblem on the page shares the same three HTMLImageElements; the browser cache
 * makes the second version free anyway (the files are byte-identical).
 */
export function loadEmblemSheets(version?: string | null): Promise<EmblemSheets> {
    const v = resolveEmblemArtVersion(version);
    let pending = sheetPromises.get(v);
    if (!pending) {
        pending = Promise.all([
            loadImage(emblemSheetUrl(EMBLEM_HOLDER_SHEET, v)),
            loadImage(emblemSheetUrl(EMBLEM_SHAPE_SHEET, v)),
            loadImage(emblemSheetUrl(EMBLEM_ICON_SHEET, v)),
        ]).then(([holder, shapes, icons]) => ({ holder, shapes, icons }));
        // a failed decode must be retryable, not cached forever
        pending.catch(() => sheetPromises.delete(v));
        sheetPromises.set(v, pending);
    }
    return pending;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

/** One layer's box, as fractions of the emblem's edge. */
export interface EmblemLayerBox {
    /** Layer edge / emblem edge. */
    scale: number;
    /** Extra offset from centred, as a fraction of the emblem edge. */
    offsetY: number;
}

/**
 * The game's composition, expressed as fractions so it holds at any size.
 *
 * The numbers are exactly src/pages/Emblems.tsx's original hard-coded pixels
 * over its 128px canvas, which is what makes this refactor a no-op for that
 * page:
 *
 *   shape   0.75 * 128 = 96 px, centred (x 16) and pushed down 0.0625 * 128 = 8
 *           px, so it hangs BELOW the banner instead of behind it.
 *   symbol  0.50 * 128 = 64 px, dead centre (32, 32).
 *   holder  1.00 * 128 = 128 px at y -0.375 * 128 = -48 px. The banner art
 *           occupies y 97..158 of the 256px source, i.e. 37.9%..61.7%, so
 *           shifting it up 37.5% lands it at the very top of the emblem — the
 *           shape then reads as a pennant hanging off it. Nothing is clipped.
 *
 * Draw order is shape, symbol, holder: the banner is a frame and goes on top.
 */
export const EMBLEM_LAYOUT: {
    shape: EmblemLayerBox;
    icon: EmblemLayerBox;
    holder: EmblemLayerBox;
} = {
    shape: { scale: 0.75, offsetY: 0.0625 },
    icon: { scale: 0.5, offsetY: 0 },
    holder: { scale: 1, offsetY: -0.375 },
};

/** What to draw: two cells and the two hexes the game says tint them. */
export interface EmblemComposition {
    /** EmblemShapes.png cell, 0..15. */
    shape: number;
    /** EmblemIcons.png cell, 0..63. */
    icon: number;
    /** Hex of a ColorType 'Background' colour — tints the shape. */
    shapeHex: string;
    /** Hex of a ColorType 'Foreground' colour — tints the symbol AND the holder. */
    iconHex: string;
}

/** What the UI holds: two cells and two colour IDS. */
export interface EmblemSelection {
    shape: number;
    icon: number;
    /** A ColorType 'Background' ColorId. */
    shapeColorId: number;
    /** A ColorType 'Foreground' ColorId. */
    iconColorId: number;
}

/**
 * Selection (ids) -> composition (hexes), or null while the config is still
 * loading. Colour ids are folded into the config's own Background/Foreground
 * lists first, so a stored id the game no longer defines still draws something
 * — and draws the same thing the database would remap it to.
 */
export function emblemComposition(
    selection: EmblemSelection,
    colors: EmblemColors,
): EmblemComposition | null {
    if (!colors.loaded) return null;
    const shapeId = coerceEmblemColorId(colors.background, selection.shapeColorId);
    const iconId = coerceEmblemColorId(colors.foreground, selection.iconColorId);
    const shapeHex = shapeId === null ? null : emblemColorHex(colors, shapeId);
    const iconHex = iconId === null ? null : emblemColorHex(colors, iconId);
    if (!shapeHex || !iconHex) return null;
    return {
        shape: emblemCellIndex(EMBLEM_SHAPE_SHEET, selection.shape),
        icon: emblemCellIndex(EMBLEM_ICON_SHEET, selection.icon),
        shapeHex,
        iconHex,
    };
}

/** Cell index folded into a sheet's range (row-major). */
export function emblemCellIndex(sheet: EmblemSheet, index: unknown): number {
    const { col, row } = emblemCell(sheet, index);
    return row * sheet.columns + col;
}

/**
 * Tint one atlas cell and stamp it onto `ctx`.
 *
 * multiply then destination-in, on a scratch canvas exactly the size of the
 * destination box: the multiply keeps the art's black outline and grey shading,
 * the destination-in clips the flat fill back to the sprite's alpha. Drawing
 * into a box-sized scratch canvas (rather than tinting the whole atlas) is also
 * what keeps neighbouring cells from bleeding in.
 */
function drawTintedCell(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    sheet: EmblemSheet,
    index: number,
    hex: string,
    box: EmblemLayerBox,
    size: number,
): void {
    const cw = img.width / sheet.columns;
    const ch = img.height / sheet.rows;
    const { col, row } = emblemCell(sheet, index);

    const edge = Math.round(size * box.scale);
    if (edge < 1 || cw < 1 || ch < 1) return;
    const dx = Math.round((size - edge) / 2);
    const dy = Math.round((size - edge) / 2 + size * box.offsetY);

    const scratch = document.createElement('canvas');
    scratch.width = edge;
    scratch.height = edge;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;

    sctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, edge, edge);
    sctx.globalCompositeOperation = 'multiply';
    sctx.fillStyle = hex;
    sctx.fillRect(0, 0, edge, edge);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, edge, edge);

    ctx.drawImage(scratch, dx, dy);
}

/**
 * THE renderer. Clears `ctx` and composes one emblem at `size` x `size`
 * device pixels: tinted shape, tinted symbol, tinted holder on top.
 *
 * Both callers use this and nothing else, so the tint technique and the layer
 * geometry exist once. `size` is in device pixels — a caller wanting a crisp
 * 24px badge on a 2x screen passes 48 and CSS-sizes the result to 24.
 */
export function drawEmblem(
    ctx: CanvasRenderingContext2D,
    sheets: EmblemSheets,
    composition: EmblemComposition,
    size: number,
): void {
    ctx.clearRect(0, 0, size, size);
    drawTintedCell(ctx, sheets.shapes, EMBLEM_SHAPE_SHEET, composition.shape,
        composition.shapeHex, EMBLEM_LAYOUT.shape, size);
    drawTintedCell(ctx, sheets.icons, EMBLEM_ICON_SHEET, composition.icon,
        composition.iconHex, EMBLEM_LAYOUT.icon, size);
    drawTintedCell(ctx, sheets.holder, EMBLEM_HOLDER_SHEET, 0,
        composition.iconHex, EMBLEM_LAYOUT.holder, size);
}

/* -------------------------------------------------------------------------- */
/* Rasterised cache                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Composing an emblem costs three scratch canvases, so a roster of 40 clans
 * would pay 120 of them on mount — and a list usually repeats the same handful
 * of badges. The composed PNG is therefore memoised on everything that can
 * change it (cells, hexes, pixel size), and the components render a plain
 * <img>. Identical badges at the same size cost one composition between them.
 *
 * The cap is a plain insertion-order eviction: 512 rasters of a 24..128px
 * emblem is a few hundred KB of data URL, and a session cannot grow it without
 * bound by scrubbing a picker.
 */
const RASTER_CACHE_LIMIT = 512;
const rasterCache = new Map<string, string>();

/** Compose an emblem and return it as a PNG data URL (memoised). */
export function emblemDataUrl(
    sheets: EmblemSheets,
    composition: EmblemComposition,
    size: number,
): string | null {
    const px = Math.max(1, Math.round(size));
    // The sheet URL is part of the key, not just the cells and hexes: the atlases
    // are byte-identical across every version that ships them TODAY, but a future
    // texture drop that changes the art must not be served a raster composed from
    // the old one.
    const key = `${sheets.shapes.src}|${px}|${composition.shape}|${composition.shapeHex}`
        + `|${composition.icon}|${composition.iconHex}`;
    const hit = rasterCache.get(key);
    if (hit) return hit;

    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    drawEmblem(ctx, sheets, composition, px);
    const url = canvas.toDataURL('image/png');

    if (rasterCache.size >= RASTER_CACHE_LIMIT) {
        const oldest = rasterCache.keys().next().value;
        if (oldest !== undefined) rasterCache.delete(oldest);
    }
    rasterCache.set(key, url);
    return url;
}
