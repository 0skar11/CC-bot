// lang.js — which language ('ar' or 'en') the casino and the games menu answer in. One resolver, used by the
// casino command (src/commands/Games/casino.js), its buttons and forms (src/interactions/buttons/store/casino.js),
// the games menu (src/commands/Games/games.js) and the typed commands (src/events/messageCreate.js):
// - A typed command answers in the script of the command word: a Latin word (`rocket`, `crash`, `mines`, `cf`,
//   `games`, `casino`...) in English, an Arabic word (`صاروخ`, `كراش`, `مينز`, `العاب`...) in Arabic.
// - A slash command (`/casino rocket`, typed with English words) answers in the member's Discord language:
//   Arabic when interaction.locale starts with `ar`, otherwise English. Discord has no Arabic client language
//   today, so in practice a slash command answers in English (`/games` also has its own `language` option).
// - A button or a form answers in the language of the game the member plays (the command they played with,
//   saved with their board or their bet); for anyone else, in Arabic when their Discord language is Arabic,
//   else in the language of the message they clicked (the board's or the round's), else in their Discord
//   language. A non-Arabic locale doesn't outrank the message: Discord offers no Arabic client language, so an
//   Arabic speaker's locale is usually `en-US`. Without any of these (tests, old records) it is Arabic.
// The group rounds are shared by the whole room whatever the language: the round's message is written in the
// language of the member who opened it (see casinoGroupService.js), only the private answers follow each member.

import { prefix } from '../../config/runtime.js';

export const LANGS = ['ar', 'en'];
export const DEFAULT_LANG = 'ar';

export const isLang = (value) => value === 'ar' || value === 'en';
/** A saved or given language, 'ar' when it is missing or isn't one. */
export const readLang = (value) => (isLang(value) ? value : DEFAULT_LANG);
/** `table[lang]`, the Arabic one for anything else. */
export const inLang = (lang, table) => table[readLang(lang)];

/** 'en' for a command word written in Latin letters (`rocket`, `Games`, `cf`), 'ar' for anything else. */
export function wordLanguage(word) {
    return /^[a-z]+$/iu.test(String(word ?? '')) ? 'en' : 'ar';
}

/** The language of a typed message: its first word after the optional PREFIX (like messageCreate reads it). */
export function typedLanguage(content) {
    const text = String(content ?? '').trim();
    const body = text.startsWith(prefix) ? text.slice(prefix.length) : text;
    return wordLanguage(body.trim().split(/\s+/u)[0] || '');
}

/** A Discord locale (`ar`, `en-US`, `fr`...) as 'ar' or 'en'; null when there is none. */
export function localeLanguage(locale) {
    if (typeof locale !== 'string' || !locale) return null;
    return locale.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** 'ar' for a text with Arabic letters, 'en' for one with only Latin letters, else null. */
export function textLanguage(text) {
    const value = String(text ?? '');
    if (/\p{Script=Arabic}/u.test(value)) return 'ar';
    return /[A-Za-z]/u.test(value) ? 'en' : null;
}

/** The language of a message the bot sent (its first embed's title, else its text), or null. */
export function messageLanguage(message) {
    const embed = message?.embeds?.[0];
    const title = embed?.title ?? embed?.data?.title;
    return textLanguage(title) ?? textLanguage(message?.content);
}

/** A typed command or a slash command: the typed command word, else the member's Discord language. */
export function commandLanguage(interaction) {
    const typed = interaction?._sourceMessage?.content;
    if (typeof typed === 'string') return typedLanguage(typed);
    return localeLanguage(interaction?.locale) ?? DEFAULT_LANG;
}

/**
 * A button or a form: `member` is the language the member plays this game in (their board, their bet), `message`
 * the language of the message they clicked (read from the interaction's message when not given).
 */
export function buttonLanguage(interaction, { member = null, message = null } = {}) {
    if (isLang(member)) return member;
    const locale = localeLanguage(interaction?.locale);
    if (locale === 'ar') return 'ar';
    const shown = isLang(message) ? message : messageLanguage(interaction?.message);
    return shown ?? locale ?? DEFAULT_LANG;
}

/** Any interaction, when nothing more is known about the game: commands as commandLanguage, the rest as buttons. */
export function interactionLanguage(interaction) {
    if (typeof interaction?._sourceMessage?.content === 'string' || interaction?.isChatInputCommand?.()) return commandLanguage(interaction);
    return buttonLanguage(interaction);
}
