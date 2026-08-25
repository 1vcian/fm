// AutoSync pipeline — the single entry point the modal calls per uploaded screenshot.
//
// Flow (mirrors the task brief):
//   1. rasterise the input to a canvas   (loadImage -> imageToCanvas)
//   2. classify the screen               (classifyScreen -> item|pet|mount|skills|enemy|unknown)
//   3. route to the matching template reader, passing the game dictionaries where they help:
//        item   -> readItem(canvas, dicts)
//        pet    -> readUnit(canvas, 'pet',   dicts)
//        mount  -> readUnit(canvas, 'mount', dicts)
//        skills -> readSkills(canvas)
//        enemy  -> (not yet ported; recorded as a warning)
//   4. always read the header currencies for the screen type (readCurrencies)
//   5. assemble a ScreenReadResult with per-screen confidence + any warnings
//
// dicts is the buildGameDictionaries(...) result. The subject readers accept it as an optional
// arg (item/pet/mount use it for stat/identity lookups); the skills + currency readers are purely
// geometric and take no dictionary. readScreenshots simply maps readScreenshot over a batch.

import { loadImage, imageToCanvas } from './imagePrep';
import { classifyScreen } from './templateClassifier';
import { readItem, readUnit, readForgeAscension } from './templateReaders';
import { readSkills } from './skillsReader';
import { readClanTree } from './clanTreeReader';
import { readSkin, emptySkinDict, type SkinDict } from './skinReader';
import { readForgeLevel, readSkillAscension } from './screenExtras';
import { readCurrencies } from './currencyReader';
import type { GameDictionaries } from './gameLocalization';
import type { DetectedUnit, ScreenReadResult, CurrencyCrops } from './readerTypes';

/**
 * Resolve a 'unit' SUBJECT (a detail popup on a header-less frame) into a pet or a mount.
 *
 * The classifier refuses to guess here on purpose: measured on the real fixtures, a pet popup and
 * a mount popup are pixel-for-pixel the same layout — white card, rarity-coloured tile with a
 * "Lv." pill and its ascension stars, one or two stat lines — and differ only in the NAME. So the
 * decision is made by the only closed set that can make it: the pet and mount NAME dictionaries
 * that readUnit already matches against. Read the frame both ways, keep the reading whose name
 * actually resolved to an id, and refuse when neither did (readUnit leaves `id` undefined, and
 * buildChangesFromReads skips a unit with no id — an absent row beats a coin-flip).
 */
async function readUnitEitherWay(
    canvas: HTMLCanvasElement, dicts: GameDictionaries, warnings: string[],
): Promise<DetectedUnit | undefined> {
    const asPet = await readUnit(canvas, 'pet', dicts);
    const asMount = await readUnit(canvas, 'mount', dicts);
    const petOk = asPet.id != null && asPet.id >= 0;
    const mountOk = asMount.id != null && asMount.id >= 0;
    if (petOk && mountOk) {
        // a few names exist in both lists ("Turtle" is a Common pet and a Rare mount), so the
        // higher name score wins and a dead heat is reported rather than broken arbitrarily
        if (asPet.confidence === asMount.confidence) {
            warnings.push(`"${asPet.name ?? '?'}" is both a pet and a mount name. Pick the screen type yourself.`);
            return undefined;
        }
        return asPet.confidence > asMount.confidence ? asPet : asMount;
    }
    if (petOk) return asPet;
    if (mountOk) return asMount;
    warnings.push('Read a detail popup, but its name is in neither the pet nor the mount list. '
        + 'pick the screen type yourself if this is an item or a skill popup.');
    return undefined;
}

/**
 * Read a single screenshot into a structured ScreenReadResult. `input` may be anything loadImage
 * accepts (Blob or URL/string). `dicts` is the combined game-dictionary bundle from
 * buildGameDictionaries — forwarded to the subject readers that resolve names/stats through it.
 */
export async function readScreenshot(
    input: Blob | string,
    dicts: GameDictionaries,
    skinDict?: SkinDict,
): Promise<ScreenReadResult> {
    const warnings: string[] = [];

    const canvas = imageToCanvas(await loadImage(input));
    // `type` is the SCREEN (what the currency header says) and drives the currency/forge readers;
    // `subject` is what the popup in the foreground is about and drives the subject readers. They
    // differ exactly when a detail popup sits on a frame with no header — see ScreenSubject.
    const { type, subject, authoritative } = await classifyScreen(canvas);

    const result: ScreenReadResult = { screen: type, warnings, confidence: 0 };
    if (!authoritative) result.authoritative = false;

    switch (subject) {
        case 'item': {
            result.item = await readItem(canvas, dicts);
            result.confidence = result.item.confidence;
            break;
        }
        case 'pet': {
            result.unit = await readUnit(canvas, 'pet', dicts);
            result.confidence = result.unit.confidence;
            break;
        }
        case 'mount': {
            result.unit = await readUnit(canvas, 'mount', dicts);
            result.confidence = result.unit.confidence;
            break;
        }
        case 'skills': {
            result.skills = await readSkills(canvas);
            // confidence from the share of cells that yielded a level
            const known = result.skills.filter(s => s.level !== null).length;
            result.confidence = result.skills.length ? known / result.skills.length : 0;
            break;
        }
        case 'clanTree': {
            result.clanTree = await readClanTree(canvas);
            result.confidence = result.clanTree.confidence;
            break;
        }
        case 'skin': {
            // The skin popup shares the item popup's header, so the one-shot pipeline used to read
            // it as an ITEM. It is its own subject now (templateClassifier.ScreenSubject).
            result.skin = await readSkin(canvas, skinDict ?? emptySkinDict(), dicts);
            warnings.push(...result.skin.warnings);
            result.confidence = result.skin.confidence;
            break;
        }
        case 'unit': {
            // pet-or-mount-or-item popup on a header-less frame: the name dictionaries decide
            result.unit = await readUnitEitherWay(canvas, dicts, warnings);
            result.screen = result.unit?.kind ?? 'unknown';
            result.confidence = result.unit?.confidence ?? 0;
            break;
        }
        case 'enemy': {
            warnings.push('Enemy screens are not yet supported by the reader.');
            break;
        }
        default: {
            warnings.push('Could not recognise this screen; nothing was read.');
            break;
        }
    }

    // Currencies are read for every screen type (readCurrencies no-ops for enemy/unknown), keyed
    // off the SCREEN and never the popup subject — a skin popup on the user's own equipment screen
    // still shows that screen's coin/gem/hammer header, and a header-less frame resolves to
    // 'unknown' here, for which readCurrencies asks for nothing.
    const currencyCrops: CurrencyCrops = {};
    result.currencies = await readCurrencies(canvas, type, currencyCrops);
    if (Object.keys(currencyCrops).length) result.currencyCrops = currencyCrops;

    // Extras from the fixed game UI behind the popups: forge level on ITEM screens only
    // (user request), ascension stars on the skills screen.
    if (type === 'item') {
        const fl = await readForgeLevel(canvas);
        result.forgeLevel = fl.value;
        result.forgeLevelCropUrl = fl.cropUrl;
    } else if (type === 'skills') {
        result.skillAscension = await readSkillAscension(canvas);
    }

    // FORGE ASCENSION — the stars on the ITEM TILES (never the anvil sprite). Attempted on every
    // screen that shows item tiles, because 2- and 3-star examples only ever appear on a player
    // profile card; the read carries `authoritative` (item screens only) and the caller refuses to
    // apply a non-authoritative one confidently. See templateReaders.readForgeAscension.
    const fa = readForgeAscension(canvas, type);
    if (fa) result.forgeAscension = fa;

    return result;
}

/**
 * Read a batch of screenshots, one ScreenReadResult per input, in order. `onProgress`, if
 * given, is called after each screenshot with (completed, total) so callers can drive a
 * per-file progress indicator.
 */
export async function readScreenshots(
    inputs: (Blob | string)[],
    dicts: GameDictionaries,
    onProgress?: (done: number, total: number) => void,
    skinDict?: SkinDict,
): Promise<ScreenReadResult[]> {
    const out: ScreenReadResult[] = [];
    for (let i = 0; i < inputs.length; i++) {
        out.push(await readScreenshot(inputs[i], dicts, skinDict));
        onProgress?.(i + 1, inputs.length);
    }
    return out;
}
