// Which language the game screenshots are in, and which tesseract models read it.
//
// The game ships 14 languages (public/parsed_configs/Localization.json `langs`, generated from the
// build's Unity Localization string tables). Its text is drawn with one TMP main font for every
// language: LocaleFontSetup (assets/bin/Data) keeps `_mainFont` = "Baloo-Regular SDF Main" and only
// inserts locale fallbacks behind it (zh-CN / zh-TW fonts, then the JP/KR/RU/TR/SC/TC Noto
// fallbacks), and Baloo-Regular has every digit plus the Latin extensions (Turkish, Polish, the
// accented letters) but no Cyrillic and no CJK. So:
//   * digits, '.', '%', '+' and the k/m/b/t suffixes (string literals in the binary, not localized)
//     are the same Baloo glyphs in every language: the glyph bank readers need no language at all;
//   * words are Baloo for the Latin languages, Noto Sans for Russian and the CJK languages, and the
//     word reader (tesseract) needs the matching model.
// The user's choice is remembered per browser. 'auto' follows the browser's language, which is the
// best prior there is: the game itself starts in the device's system language.

export const GAME_LANGS = ['en', 'it', 'de', 'es', 'fr', 'nl', 'pl', 'pt-BR', 'tr', 'ru', 'ja', 'ko', 'zh-CN', 'zh-TW'] as const;
export type GameLang = (typeof GAME_LANGS)[number];
export type LangChoice = GameLang | 'auto';

/** tesseract.js traineddata name per game language (all present on the tesseract.js-data CDN). */
export const TESS_LANG: Record<GameLang, string> = {
    'en': 'eng', 'it': 'ita', 'de': 'deu', 'es': 'spa', 'fr': 'fra', 'nl': 'nld', 'pl': 'pol',
    'pt-BR': 'por', 'tr': 'tur', 'ru': 'rus', 'ja': 'jpn', 'ko': 'kor', 'zh-CN': 'chi_sim', 'zh-TW': 'chi_tra',
};

/** Display names, each in its own language (the game's language picker does the same). */
export const LANG_LABEL: Record<GameLang, string> = {
    'en': 'English', 'it': 'Italiano', 'de': 'Deutsch', 'es': 'Español', 'fr': 'Français', 'nl': 'Nederlands',
    'pl': 'Polski', 'pt-BR': 'Português (Brasil)', 'tr': 'Türkçe', 'ru': 'Русский', 'ja': '日本語', 'ko': '한국어',
    'zh-CN': '简体中文', 'zh-TW': '繁體中文',
};

const STORE_KEY = 'fm.autosync.gameLang';

/** Map a BCP-47 tag (navigator.language) to a game language, or null. */
export function gameLangFromTag(tag: string | null | undefined): GameLang | null {
    if (!tag) return null;
    const t = tag.toLowerCase();
    if (t.startsWith('zh')) return /(tw|hk|mo|hant)/.test(t) ? 'zh-TW' : 'zh-CN';
    if (t.startsWith('pt')) return 'pt-BR';
    const base = t.split(/[-_]/)[0];
    return (GAME_LANGS as readonly string[]).includes(base) ? base as GameLang : null;
}

/** The language 'auto' resolves to: the first browser language the game ships, else English. */
export function autoGameLang(): GameLang {
    try {
        const tags = (typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : []) as string[];
        for (const t of tags) { const g = gameLangFromTag(t); if (g) return g; }
    } catch { /* no navigator: English */ }
    return 'en';
}

export function loadLangChoice(): LangChoice {
    try {
        const v = localStorage.getItem(STORE_KEY);
        if (v === 'auto' || (GAME_LANGS as readonly string[]).includes(v ?? '')) return v as LangChoice;
    } catch { /* storage blocked: default */ }
    return 'auto';
}

export function saveLangChoice(v: LangChoice): void {
    try { localStorage.setItem(STORE_KEY, v); } catch { /* storage blocked: choice lasts this session */ }
}

export function resolveLang(choice: LangChoice): GameLang {
    return choice === 'auto' ? autoGameLang() : choice;
}

/** tesseract language string for word reading: the game language plus English (item names such
 *  as "M4" and every Latin-script fallback stay readable). */
export function tessLangsFor(lang: GameLang): string {
    return lang === 'en' ? 'eng' : `${TESS_LANG[lang]}+eng`;
}
