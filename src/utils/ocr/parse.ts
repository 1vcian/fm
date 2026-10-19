// Text parsing + fuzzy matching for OCR output.

const MAGNITUDE: Record<string, number> = {
    k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15,
};

/**
 * Parse a compact game number: "4.89m" -> 4_890_000, "12.3k" -> 12_300, "1.87b" ->
 * 1_870_000_000, "670" -> 670, "97,932" -> 97932. Returns null if no number is found.
 */
/**
 * A comma followed by one or two digits is a DECIMAL comma: the game formats numbers with
 * Double.ToString(format) and no culture (Numbers.Format, RVA 0x3F796D8), so a device in a
 * comma-decimal locale may print "76,3m". The game never groups thousands in these compact
 * numbers, so a three-digit group ("97,932") is the only case read as a separator.
 */
function decimalComma(s: string): string {
    return s.replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
}

export function parseCompactNumber(raw: string): number | null {
    if (!raw) return null;
    const s = decimalComma(raw.toLowerCase().replace(/\s+/g, '')).replace(/,/g, '');
    const m = s.match(/(-?\d+(?:\.\d+)?)([kmbtq])?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    const suffix = m[2];
    return suffix ? Math.round(n * MAGNITUDE[suffix]) : n;
}

/** Parse a percentage like "+73.8%" -> 73.8, "16.9 %" -> 16.9. Null if none. */
export function parsePercent(raw: string): number | null {
    if (!raw) return null;
    const m = decimalComma(raw.replace(/\s+/g, '')).match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
}

/** Parse a level like "Lv. 102" / "LV.102" / "Lvl 62" -> 102 / 62. Null if none. */
export function parseLevel(raw: string): number | null {
    if (!raw) return null;
    const m = raw.match(/l\s*v\s*l?\.?\s*(\d{1,4})/i);
    if (m) return parseInt(m[1], 10);
    const digits = raw.match(/\d{1,4}/);
    return digits ? parseInt(digits[0], 10) : null;
}

/** "80/110" -> {current:80, max:110}; also handles "4/8". Null if not a fraction. */
export function parseFraction(raw: string): { current: number; max: number } | null {
    const m = raw.replace(/\s+/g, '').match(/(\d+)\/(\d+)/);
    return m ? { current: parseInt(m[1], 10), max: parseInt(m[2], 10) } : null;
}

const RARITY_WORDS = ['common', 'rare', 'epic', 'legendary', 'ultimate', 'mythic', 'divine'];

/** Extract a leading [Rarity] tag if present, returning the lowercase rarity or null. */
export function extractRarity(raw: string): string | null {
    const m = raw.toLowerCase().match(/\[?\s*(common|rare|epic|legendary|ultimate|mythic|divine)\s*\]?/);
    return m ? m[1] : null;
}

/** Fold a string for matching in ANY of the game's 14 languages: lowercase, accents dropped
 *  (Latin and Cyrillic marks removed, so "Probabilità" == "probabilita"; the Turkish dotless i is
 *  folded to i), every run of anything that is not a letter or a digit of any script collapsed to
 *  one space. The old ASCII-only rule deleted Cyrillic, CJK and Hangul text outright, which left
 *  the Russian / Japanese / Korean / Chinese dictionaries EMPTY (every key normalised to ""). */
export function foldText(raw: string): string {
    // marks are dropped only after Latin / Cyrillic letters: on kana (dakuten) and Hangul they are
    // part of the letter, and NFC puts those back together
    return raw.normalize('NFKD')
        .replace(/([\p{Script=Latin}\p{Script=Cyrillic}])\p{M}+/gu, '$1')
        .normalize('NFC').toLowerCase().replace(/ı/g, 'i')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        // tesseract's CJK and Korean models put spaces between characters ("生 命 值"); the
        // dictionary does not, so spaces between two CJK / Hangul characters are dropped on both
        .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー])/gu, '$1');
}

/** Normalise a name for matching: strip [rarity] tags, punctuation, lowercase, collapse spaces. */
export function normalizeName(raw: string): string {
    let s = raw.toLowerCase();
    for (const r of RARITY_WORDS) s = s.replace(new RegExp(`\\[?\\s*${r}\\s*\\]?`, 'g'), ' ');
    return foldText(s).replace(/\s+/g, ' ');
}

/** Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
            diag = tmp;
        }
    }
    return prev[b.length];
}

/** Similarity 0..1 based on normalised edit distance. */
export function similarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

export interface MatchResult<T> { value: T; key: string; score: number; }

/**
 * Fuzzy-match an OCR'd name against a set of candidates. `candidates` maps a
 * canonical/normalised key -> payload. Returns the best match and its score (0..1),
 * or null if nothing clears `minScore`.
 */
export function bestMatch<T>(query: string, candidates: Map<string, T>, minScore = 0.55): MatchResult<T> | null {
    const q = normalizeName(query);
    if (!q) return null;
    let best: MatchResult<T> | null = null;
    for (const [key, value] of candidates) {
        const s = similarity(q, key);
        if (!best || s > best.score) best = { value, key, score: s };
    }
    return best && best.score >= minScore ? best : null;
}
