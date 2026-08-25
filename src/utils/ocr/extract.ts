// AutoSync extraction pipeline. Given a screenshot, classify the screen and pull out
// the structured data (item / pet / mount / skills / aggregate profile + currencies).
// Ported from the Python harness that was validated against real 576x1280 screenshots.
//
// OCR is never trusted blindly: every detection carries a confidence, and identity comes
// from fuzzy-matching against the localized game dictionaries. The diff modal shows the
// user each proposed change to accept/skip, so imperfect reads are safe.

import { loadImage, imageToCanvas, cropCanvas, countGoldStars, findColorNameBand, detectItemTile, tileArtRect, tileLevelRect, relToPx, type Rect, type RelRect } from './imagePrep';
import { ocrPageLines, ocr, PSM, type PageLine } from './ocrEngine';
import { embedIcon, matchItemIcon } from './iconMatcher';
import {
    parseCompactNumber, parsePercent, parseLevel, bestMatch,
} from './parse';
import { matchSubstat, parseMainStatKind, splitCamel, type ItemIdentity } from './gameDictionary';
import { AGES } from '../constants';
import type { UnitIdentity } from './gamePets';
import type { GameDictionaries } from './gameLocalization';

export type ScreenType = 'item' | 'unit' | 'skills' | 'aggregate' | 'unknown';

export interface DetSubstat { statId: string | null; value: number; raw: string; cropUrl?: string; }
export interface DetMain { kind: 'damage' | 'health'; ranged: boolean; value: number | null; }

export interface DetItem {
    kind: 'item'; slot: string; age: number; idx: number; name: string;
    confidence: number; level: number | null; stars: number; main: DetMain | null; substats: DetSubstat[];
    cropUrl?: string; // a picture of the region we read, for the visual diff modal
}
export interface DetUnit {
    kind: 'pet' | 'mount'; rarity: string; id: number; name: string;
    confidence: number; level: number | null; stars: number;
    damage: number | null; health: number | null; substats: DetSubstat[];
    cropUrl?: string;
}
export interface DetAggregate {
    power: number | null; totalDamage: number | null; totalHealth: number | null;
    forgeLevel: number | null; forgeStars: number; substats: DetSubstat[];
}
export interface ScreenExtraction {
    screen: ScreenType;
    item?: DetItem;
    unit?: DetUnit;
    aggregate?: DetAggregate;
    currencies: Record<string, number>;
    lines: string[];
    warnings: string[];
}

const OCR_SCALE = 2; // upscale before OCR (validated: sharper small text)

interface Line extends PageLine { cy: number; }

function toLines(page: PageLine[]): Line[] {
    return page.map(l => ({ ...l, cy: (l.y0 + l.y1) / 2 }));
}

function classify(lines: Line[]): { screen: ScreenType; hasButtons: boolean } {
    const joined = lines.map(l => l.text.toLowerCase()).join(' ');
    const hasButtons = /upgrade|remove/.test(joined);
    let screen: ScreenType;
    if (/total\s+(damage|health)/.test(joined)) screen = 'aggregate';
    else if (/\d\s*\/\s*18/.test(joined) || /base damage/.test(joined) || /summon/.test(joined)) screen = 'skills';
    else if (hasButtons) screen = 'unit';
    else screen = 'item';
    return { screen, hasButtons };
}

/**
 * If a value exceeds a stat's max roll it usually means the OCR turned the leading "+"/"-"
 * sign into a digit (e.g. "+11.2%" -> "411.2%"). Drop leading integer digits until the value
 * fits the cap. (User rule: "if the max is 12%, 46% is impossible — the 4 is a +".)
 */
function correctByBound(v: number, max: number): number {
    if (Math.abs(v) <= max * 1.2) return v;
    const neg = v < 0;
    const [ip, fp = ''] = Math.abs(v).toString().split('.');
    let ipc = ip;
    while (ipc.length > 1 && parseFloat(ipc + (fp ? '.' + fp : '')) > max * 1.2) ipc = ipc.slice(1);
    const c = parseFloat(ipc + (fp ? '.' + fp : ''));
    return isNaN(c) ? v : (neg ? -c : c);
}

function extractSubstats(lines: Line[], dict: Map<string, string>, statMax?: Map<string, number>): DetSubstat[] {
    const subs: DetSubstat[] = [];
    for (const l of lines) {
        const pct = parsePercent(l.text);
        if (pct === null) continue;
        // strip the "+X%" then match the remaining label
        const label = l.text.replace(/[+\-]?\d+(?:\.\d+)?\s*%/, '').trim();
        const m = matchSubstat(label, dict, 0.5);
        let value = pct;
        if (m && statMax && statMax.has(m.value)) value = correctByBound(value, statMax.get(m.value)!);
        subs.push({ statId: m ? m.value : null, value, raw: label });
    }
    return subs;
}

function extractMain(lines: Line[]): DetMain | null {
    for (const l of lines) {
        if (parsePercent(l.text) !== null) continue;
        if (/total/i.test(l.text)) continue;
        if (!/damage|health/i.test(l.text) || !/\d/.test(l.text)) continue;
        const kind = parseMainStatKind(l.text);
        if (kind) return { ...kind, value: parseCompactNumber(l.text) };
    }
    return null;
}

/** Detect the item AGE from the "[Age]" tag in the OCR'd lines (longest match wins). -1 if none. */
function ageFromLines(lines: Line[]): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const text = lines.map(l => norm(l.text)).join(' ');
    const cand = AGES.map((a, i) => ({ a: norm(a), i })).sort((x, y) => y.a.length - x.a.length);
    for (const { a, i } of cand) if (a && text.includes(a)) return i;
    return -1;
}

function findLevel(lines: Line[], nearCy: number): number | null {
    let best: number | null = null;
    for (const l of lines) {
        if (!/l\s*v\.?\s*\d/i.test(l.text)) continue;
        if (nearCy > 0 && Math.abs(l.cy - nearCy) > 220 * OCR_SCALE) continue;
        const lv = parseLevel(l.text);
        if (lv) { best = lv; break; }
    }
    return best;
}

function matchName<T>(lines: Line[], dict: Map<string, T>, min = 0.5): { value: T; kind: string; score: number; cy: number } | null {
    let best: { value: T; kind: string; score: number; cy: number } | null = null;
    for (const l of lines) {
        const m = bestMatch(l.text, dict, min);
        if (m && (!best || m.score > best.score)) best = { value: m.value, kind: '', score: m.score, cy: l.cy };
    }
    return best;
}

/**
 * Read the coloured bold NAME (orange=item, purple=pet/mount) via a targeted crop and RAW
 * OCR (raw beats binarization on the stylized coloured text), matched against the dict(s).
 * cy is in the OCR (2x) coordinate space to line up with the whole-image line coords.
 */
async function matchNameByColor<T>(
    base: HTMLCanvasElement, want: 'orange' | 'purple',
    dicts: { dict: Map<string, T>; kind: string }[], min = 0.4,
): Promise<{ value: T; kind: string; score: number; cy: number } | null> {
    const band = findColorNameBand(base, want, 0.26);
    if (!band) return null;
    const crop = cropCanvas(base, band, 4);
    const { text } = await ocr(crop, { psm: PSM.SINGLE_LINE });
    let best: { value: T; kind: string; score: number; cy: number } | null = null;
    for (const { dict, kind } of dicts) {
        const m = bestMatch(text, dict, min);
        if (m && (!best || m.score > best.score)) best = { value: m.value, kind, score: m.score, cy: (band.y + band.h / 2) * OCR_SCALE };
    }
    return best;
}

/** Best-effort currency read from the top status strip / modal header. */
function extractCurrencies(lines: Line[], screen: ScreenType, kind: string | null, H2: number): Record<string, number> {
    const out: Record<string, number> = {};
    const top = lines
        .filter(l => l.cy < H2 * 0.14 && /\d/.test(l.text))
        .map(l => ({ x: l.x0, v: parseCompactNumber(l.text) }))
        .filter(n => n.v != null) as { x: number; v: number }[];
    top.sort((a, b) => a.x - b.x);
    if (screen === 'item') {
        if (top[0]) out.coins = top[0].v;
        if (top[1]) out.gems = top[1].v;
    } else if (screen === 'unit' && kind === 'pet') {
        if (top[0]) out.eggshells = top[0].v;
        if (top[1]) out.gems = top[1].v;
    } else if (screen === 'unit' && kind === 'mount') {
        // clock winders sit in the modal header (~y 0.25-0.32), not the top strip
        const mid = lines
            .filter(l => l.cy > H2 * 0.22 && l.cy < H2 * 0.34 && /\d/.test(l.text))
            .map(l => parseCompactNumber(l.text)).filter(v => v != null) as number[];
        if (mid[0] != null) out.clockWinders = mid[0];
    } else if (screen === 'skills') {
        if (top[0]) out.skillTickets = top[0].v;
    }
    return out;
}

export async function extractScreenshot(src: Blob | string, dicts: GameDictionaries): Promise<ScreenExtraction> {
    const img = await loadImage(src);
    const base = imageToCanvas(img);
    const W = base.width, H = base.height;
    const big = cropCanvas(base, { x: 0, y: 0, w: W, h: H }, OCR_SCALE);
    const lines = toLines(await ocrPageLines(big));
    const H2 = H * OCR_SCALE;

    const { screen } = classify(lines);
    const warnings: string[] = [];
    // Bound-correct item/pet/mount substats (single rolls); aggregate substats are totals, leave as-is.
    const substats = extractSubstats(lines, dicts.substats, screen === 'aggregate' ? undefined : dicts.statMax);
    const res: ScreenExtraction = { screen, currencies: {}, lines: lines.map(l => l.text), warnings };

    if (screen === 'item') {
        const main = extractMain(lines);
        // secondary: OCR name match
        let nm = matchName<ItemIdentity>(lines, dicts.items, 0.5);
        const cc = await matchNameByColor<ItemIdentity>(base, 'orange', [{ dict: dicts.items, kind: 'item' }]);
        if (cc && (!nm || cc.score > nm.score)) nm = cc;
        // PRIMARY: icon embedding match (robust; narrowed by age tag + main-stat group)
        let iconIdent: { slot: string; age: number; idx: number; name: string } | null = null;
        let iconScore = 0;
        let tileLevel: number | null = null;
        try {
            const tile = detectItemTile(base); // dynamic: no fixed regions (works on tablets/any layout)
            if (tile) {
                const emb = await embedIcon(cropCanvas(base, tileArtRect(tile)));
                const group = main?.kind === 'damage' ? 'damage' : main?.kind === 'health' ? 'health' : undefined;
                // age first (from the written "[Age]" tag) -> match icons only within that age + group
                const top = await matchItemIcon(emb, { age: ageFromLines(lines), group }, 5);
                if (top[0]) {
                    const agree = nm ? top.find(t => t.row.slot === nm!.value.slot && t.row.age === nm!.value.age && t.row.idx === nm!.value.idx) : undefined;
                    const pick = agree || top[0];
                    iconIdent = { slot: pick.row.slot, age: pick.row.age, idx: pick.row.idx, name: splitCamel(pick.row.name) };
                    iconScore = Math.min(1, pick.score + (agree ? 0.2 : 0));
                }
                // level from the tile's own bottom region (dynamic, per-tile) so a prediction always shows
                try {
                    const { text: lt } = await ocr(cropCanvas(base, tileLevelRect(tile), 3), { whitelist: 'Llv.0123456789', psm: PSM.SINGLE_LINE });
                    tileLevel = parseLevel(lt);
                } catch { /* ignore */ }
            }
        } catch { /* model unavailable → fall back to OCR name */ }
        const useIcon = !!iconIdent && iconScore >= 0.45;
        const ident = useIcon ? iconIdent
            : nm ? { slot: nm.value.slot, age: nm.value.age, idx: nm.value.idx, name: nm.value.itemName } : null;
        const confidence = useIcon ? Math.min(1, iconScore) : (nm?.score ?? 0);
        const nameCy = nm ? nm.cy : 0;
        const stars = nameCy ? countGoldStars(base, starRect(W, nameCy / OCR_SCALE)) : 0;
        res.item = {
            kind: 'item',
            slot: ident?.slot ?? '', age: ident?.age ?? -1, idx: ident?.idx ?? -1,
            name: ident?.name ?? '', confidence,
            level: tileLevel ?? findLevel(lines, nameCy), stars, main, substats,
        };
        res.item.cropUrl = regionDataUrl(base, { x0: 0.02, y0: 0.575, x1: 0.98, y1: 0.85 });
        if (!ident) warnings.push('Item not recognised. Please confirm the slot/item.');
        // Cross-check: a slot implies its main-stat kind. If the OCR'd name matched a slot
        // whose expected main stat contradicts the detected one, the name read is suspect.
        if (res.item.main && res.item.slot) {
            const expectDamage = ['Weapon', 'Gloves', 'Necklace', 'Ring'].includes(res.item.slot);
            const got = res.item.main.kind;
            if ((expectDamage && got === 'health') || (!expectDamage && got === 'damage')) {
                res.item.confidence *= 0.5;
                warnings.push('Detected name and main stat disagree. Please confirm this item.');
            }
        }
        res.currencies = extractCurrencies(lines, screen, 'item', H2);
    } else if (screen === 'unit') {
        const petW = matchName<UnitIdentity>(lines, dicts.pets, 0.5);
        const mountW = matchName<UnitIdentity>(lines, dicts.mounts, 0.5);
        let nm: { value: UnitIdentity; kind: string; score: number; cy: number } | null =
            (mountW && (!petW || mountW.score > petW.score)) ? { ...mountW, kind: 'mount' } : (petW ? { ...petW, kind: 'pet' } : null);
        const cc = await matchNameByColor<UnitIdentity>(base, 'purple', [{ dict: dicts.pets, kind: 'pet' }, { dict: dicts.mounts, kind: 'mount' }]);
        if (cc && (!nm || cc.score > nm.score)) nm = cc;
        const kind: 'pet' | 'mount' = nm?.kind === 'mount' ? 'mount' : 'pet';
        const nameCy = nm ? nm.cy : 0;
        const dmg = extractMainByKind(lines, 'damage');
        const hp = extractMainByKind(lines, 'health');
        res.unit = {
            kind, rarity: nm?.value.rarity ?? '', id: nm?.value.id ?? -1, name: '',
            confidence: nm?.score ?? 0, level: findLevel(lines, nameCy),
            stars: nameCy ? countGoldStars(base, starRect(W, nameCy / OCR_SCALE)) : 0,
            damage: dmg, health: hp, substats,
        };
        res.unit.cropUrl = regionDataUrl(base, { x0: 0.02, y0: 0.40, x1: 0.98, y1: 0.80 });
        if (!nm) warnings.push('Pet/mount not recognised. Please confirm which one.');
        res.currencies = extractCurrencies(lines, screen, kind, H2);
    } else if (screen === 'aggregate') {
        res.aggregate = extractAggregate(lines, base, W);
        res.aggregate.substats = substats; // use the dict-matched substats
    } else if (screen === 'skills') {
        res.currencies = extractCurrencies(lines, screen, null, H2);
        warnings.push('Skill grid parsing is approximate. Confirm skill levels.');
    }
    return res;
}

function starRect(W: number, nameCyOrig: number): Rect {
    return { x: Math.round(W * 0.03), y: Math.round(nameCyOrig + 15), w: Math.round(W * 0.30), h: 46 };
}

/** A downscaled JPEG data-URL of a relative region, for the visual diff modal ("what we read"). */
function regionDataUrl(base: HTMLCanvasElement, r: RelRect, maxW = 340): string {
    const rect = relToPx(base.width, base.height, r);
    const scale = Math.min(1, maxW / Math.max(1, rect.w));
    try { return cropCanvas(base, rect, scale).toDataURL('image/jpeg', 0.72); } catch { return ''; }
}

/** Value of the first non-% line whose main-stat kind matches (for pets/mounts with both dmg+hp). */
function extractMainByKind(lines: Line[], want: 'damage' | 'health'): number | null {
    for (const l of lines) {
        if (parsePercent(l.text) !== null || /total|base/i.test(l.text)) continue;
        if (!/\d/.test(l.text)) continue;
        const k = parseMainStatKind(l.text);
        if (k && k.kind === want) return parseCompactNumber(l.text);
    }
    return null;
}

function extractAggregate(lines: Line[], base: HTMLCanvasElement, W: number): DetAggregate {
    let totalDamage: number | null = null, totalHealth: number | null = null;
    let forgeLevel: number | null = null, power: number | null = null;
    const substats: DetSubstat[] = [];
    for (const l of lines) {
        const low = l.text.toLowerCase();
        if (/total\s+damage/.test(low)) totalDamage = parseCompactNumber(l.text);
        else if (/total\s+health/.test(low)) totalHealth = parseCompactNumber(l.text);
        else if (/forge/.test(low)) { const lv = parseLevel(l.text); if (lv) forgeLevel = lv; }
        const pct = parsePercent(l.text);
        if (pct !== null && !/total/.test(low)) {
            const label = l.text.replace(/[+\-]?\d+(?:\.\d+)?\s*%/, '').trim();
            substats.push({ statId: null, value: pct, raw: label });
        }
    }
    // forge stars: gold stars in the top-right of the modal header (rough region)
    const forgeStars = countGoldStars(base, { x: Math.round(W * 0.80), y: Math.round(base.height * 0.20), w: Math.round(W * 0.18), h: 40 });
    return { power, totalDamage, totalHealth, forgeLevel, forgeStars, substats };
}
