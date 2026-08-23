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
import { readItem, readUnit } from './templateReaders';
import { readSkills } from './skillsReader';
import { readClanTree } from './clanTreeReader';
import { readForgeLevel, readSkillAscension } from './screenExtras';
import { readCurrencies } from './currencyReader';
import type { GameDictionaries } from './gameLocalization';
import type { ScreenReadResult, CurrencyCrops } from './readerTypes';

/**
 * Read a single screenshot into a structured ScreenReadResult. `input` may be anything loadImage
 * accepts (Blob or URL/string). `dicts` is the combined game-dictionary bundle from
 * buildGameDictionaries — forwarded to the subject readers that resolve names/stats through it.
 */
export async function readScreenshot(
    input: Blob | string,
    dicts: GameDictionaries,
): Promise<ScreenReadResult> {
    const warnings: string[] = [];

    const canvas = imageToCanvas(await loadImage(input));
    const { type } = await classifyScreen(canvas);

    const result: ScreenReadResult = { screen: type, warnings, confidence: 0 };

    switch (type) {
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
        case 'enemy': {
            warnings.push('Enemy screens are not yet supported by the reader.');
            break;
        }
        default: {
            warnings.push('Could not recognise this screen; nothing was read.');
            break;
        }
    }

    // Currencies are read for every screen type (readCurrencies no-ops for enemy/unknown).
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
): Promise<ScreenReadResult[]> {
    const out: ScreenReadResult[] = [];
    for (let i = 0; i < inputs.length; i++) {
        out.push(await readScreenshot(inputs[i], dicts));
        onProgress?.(i + 1, inputs.length);
    }
    return out;
}
