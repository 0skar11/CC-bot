import { findAsset, isSellAllWord } from '../store/bourse.js';
import { coinSide, diceDirection, isAllInWord, multiplierHundredths, readGameArgs, rouletteChoice } from '../casino.js';
import { looksLikeAmount, parseAmount } from '../amount.js';

// Stock market and read-only CC aliases from DISbot, the casino's games (`مينز 100 3`, `عملة 100 ملك`,
// `سلوت 100`, `نرد 100 فوق 70`, `فرخة 100`, `روليت 100 احمر`, `صاروخ 100`) and the games menu (`العاب`). `كراش` / `crash`
// are the group rocket itself (the same round as `صاروخ` / `rocket`). An English word answers in English, an
// Arabic one in Arabic (src/services/cc/lang.js); both reach the same command and the same group round.
// Every game also takes an all-in word where the bet goes (`صاروخ كل`, `مينز كل 3`, `rocket all`: ALL_IN_WORDS in
// src/config/casino.js), under the same rule as a number: the game word first, then only that game's words.
export const commandArgAliases = {
    casino: 'casino', كازينو: 'casino', الكازينو: 'casino',
    mines: 'casino mines', ماينز: 'casino mines', مينز: 'casino mines', الغام: 'casino mines', ألغام: 'casino mines',
    coinflip: 'casino coinflip', cf: 'casino coinflip', عملة: 'casino coinflip', عمله: 'casino coinflip',
    slots: 'casino slots', slot: 'casino slots', سلوت: 'casino slots', سلوتس: 'casino slots',
    crash: 'casino rocket', كراش: 'casino rocket',
    dice: 'casino dice', نرد: 'casino dice', زهر: 'casino dice', دايس: 'casino dice',
    chicken: 'casino chicken', فرخة: 'casino chicken', فرخه: 'casino chicken', دجاجة: 'casino chicken', دجاجه: 'casino chicken',
    blackjack: 'casino blackjack', bj: 'casino blackjack', بلاك: 'casino blackjack', بلاكجاك: 'casino blackjack', 'بلاك جاك': 'casino blackjack',
    roulette: 'casino roulette', روليت: 'casino roulette', الروليت: 'casino roulette',
    rocket: 'casino rocket', صاروخ: 'casino rocket', الصاروخ: 'casino rocket',
    horses: 'casino horses', احصنة: 'casino horses', أحصنة: 'casino horses', احصنه: 'casino horses', أحصنه: 'casino horses', خيول: 'casino horses',
    حصان: 'casino horses', الاحصنة: 'casino horses', الاحصنه: 'casino horses', خيل: 'casino horses',
    games: 'games', العاب: 'games', ألعاب: 'games', الالعاب: 'games', الألعاب: 'games',
    شراء: 'bourse invest', اشتري: 'bourse invest',
    اسعار: 'bourse prices', أسعار: 'bourse prices', الاسعار: 'bourse prices', الأسعار: 'bourse prices', prices: 'bourse prices',
    بورصة: 'bourse prices', بورصه: 'bourse prices', البورصة: 'bourse prices', البورصه: 'bourse prices',
    استثمار: 'bourse invest', استثمر: 'bourse invest', invest: 'bourse invest',
    بيع: 'bourse sell', sell: 'bourse sell',
    ممتلكاتي: 'bourse holdings', ممتلكاتى: 'bourse holdings', ممتلكات: 'bourse holdings', holdings: 'bourse holdings',
    تحويل: 'give', حول: 'give', حوّل: 'give', transfer: 'give', 'cc give': 'give',
    ديلي: 'daily', يومية: 'daily',
    bal: 'cc', balance: 'cc', money: 'cc', cash: 'cc', credits: 'cc',
    رصيد: 'cc', رصيدي: 'cc', رصيدى: 'cc', فلوس: 'cc', كريدت: 'cc',
    'top cc': 'cctop', 'توب cc': 'cctop', 'توب كريدت': 'cctop',
};
/** The words that open the horse race typed with a dot (`.احصنه 100 2`, `.حصان 200 4`): every spelling in the aliases. */
export const HORSES_DOT_WORDS = Object.keys(commandArgAliases).filter((word) => commandArgAliases[word] === 'casino horses').map((word) => `.${word}`);
// A typed amount: plain digits, or what parseAmount (src/config/amount.js) reads (`5k`, `5,000`, `1.5m`, `٥٠٠`).
const isAmountWord = (arg) => /^\d+$/u.test(String(arg)) || parseAmount(arg) !== null;
const isMentionOrId = (arg) => /^(?:<@!?\d{17,20}>|\d{17,20})$/u.test(String(arg));
// The newer games whose words are also everyday chat (`كراش`, `صاروخ`, `فرخة`...): typed without the prefix they need a bet.
const NEW_CASINO_GAMES = new Set(['casino dice', 'casino chicken', 'casino roulette', 'casino rocket', 'casino blackjack', 'casino horses']);
export function isBourseNameInvocation(typedCommand, args) {
    const target = commandArgAliases[typedCommand];
    if (target !== 'bourse invest' && target !== 'bourse sell') return false;
    if (isSellAllWord(args[args.length - 1])) {
        const words = args.slice(0, -1);
        if (target === 'bourse sell' && !words.length) return true;
        return words.length > 0 && Boolean(findAsset(words.join(' ')));
    }
    const words = /^\d+$/u.test(args[args.length - 1] || '') ? args.slice(0, -1) : args;
    return words.length > 0 && Boolean(findAsset(words.join(' ')));
}
// `عملة 100 ملك` without the prefix: a bet and a side of the coin, in any order.
export function isCoinflipInvocation(typedCommand, args) {
    if (commandArgAliases[typedCommand] !== 'casino coinflip' || args.length !== 2) return false;
    return args.some(isAmountWord) && args.some((arg) => coinSide(arg) !== null);
}
// `صاروخ 100 2` / `كراش 100 2.5`, `نرد 100 فوق 70`, `روليت 100 احمر`, `فرخة 100` without the prefix: a bet and the game's
// words. The bet may be an all-in word (`صاروخ كل`, `نرد كل فوق 70`): readGameArgs reads it.
export function isGameInvocation(typedCommand, args) {
    const target = commandArgAliases[typedCommand];
    if (!NEW_CASINO_GAMES.has(target)) return false;
    return !readGameArgs(target.split(' ')[1], args).error;
}
const isWholeArg = (arg) => /^\d+$/u.test(arg);
// `مينز كل 3`, `سلوت كل`, `عملة كل ملك` (or `مينز 5k 3`, `سلوت 1.5k`, `عملة 5k ملك`) without the prefix: an all-in word or
// an amount where the number of the bet goes, and after it only what that game takes with a bet (the mine count; the
// side of the coin, before or after it).
const isBetArg = (arg) => isAllInWord(arg) || isAmountWord(arg);
export function isAllInInvocation(typedCommand, args) {
    const target = commandArgAliases[typedCommand];
    if (target === 'casino mines') return args.length <= 2 && isBetArg(args[0]) && args.slice(1).every(isWholeArg);
    if (target === 'casino slots') return args.length === 1 && isBetArg(args[0]);
    if (target !== 'casino coinflip') return false;
    if (args.length === 1) return isBetArg(args[0]);
    return args.length === 2 && args.some(isBetArg) && args.some((arg) => coinSide(arg) !== null);
}
// The transfer words (`تحويل`, `give`...): without the prefix also a mistyped amount (`تحويل @x 5q`), answered with
// the amount error instead of staying chat.
const MONEY_ALIASES = new Set(['give']);
export function applyWordAliases(typedCommand, args, prefixed) {
    const twoWord = `${typedCommand} ${(args[0] || '').toLowerCase()}`;
    if (Object.hasOwn(commandArgAliases, twoWord)) {
        const alias = commandArgAliases[twoWord];
        if (!prefixed && !args.slice(1).length && NEW_CASINO_GAMES.has(alias)) return null;
        if (!prefixed && NEW_CASINO_GAMES.has(alias) && !isGameInvocation(twoWord, args.slice(1))) return null;
        const [commandName, ...leading] = alias.split(' ');
        return { commandName, args: [...leading, ...args.slice(1)] };
    }
    if (!Object.hasOwn(commandArgAliases, typedCommand)) return { commandName: typedCommand, args };
    if (!prefixed && !args.length && NEW_CASINO_GAMES.has(commandArgAliases[typedCommand])) return null;
    const moneyWords = MONEY_ALIASES.has(commandArgAliases[typedCommand]) && args.every((arg) => isMentionOrId(arg) || looksLikeAmount(arg));
    if (!prefixed && !moneyWords && !args.every((arg) => isMentionOrId(arg) || isAmountWord(arg) || /^\d+$/u.test(arg)) && !isBourseNameInvocation(typedCommand, args) && !isCoinflipInvocation(typedCommand, args) && !isGameInvocation(typedCommand, args) && !isAllInInvocation(typedCommand, args)) return null;
    const alias = commandArgAliases[typedCommand];
    const [commandName, ...leading] = alias.split(' ');
    return { commandName, args: [...leading, ...args] };
}

// The commands typed by their own name (no alias): `addcc`, `give`, `cc`... (`help` is only the guide's words).
export const DIRECT_COMMANDS = new Set(['addcc', 'removecc', 'give', 'cc', 'cctop', 'daily', 'casino', 'bourse', 'games']);
// Without the prefix only the bare `كل` moves a game word first (`كل صاروخ`): `الكل صاروخ` (everybody's a rocket),
// `all rocket` and the like stay chat, since an all-in stakes the whole balance.
const ROTATING_ALL_IN = new Set(['كل']);
// The option words of a game that may stand around its word when it isn't typed first (`500 روليت احمر`).
const OPTION_WORDS = {
    'casino coinflip': (word) => coinSide(word) !== null,
    'casino dice': (word) => diceDirection(word) !== null,
    'casino roulette': (word) => rouletteChoice(word) !== null,
    'casino rocket': (word) => multiplierHundredths(word) !== null,
    'casino horses': (word) => /^[1-6]$/u.test(word),
    // A mistyped amount (`5q @member تحويل`) still reaches the transfer, which answers `❌ المبلغ مش مفهوم`.
    give: looksLikeAmount,
    addcc: looksLikeAmount,
    removecc: looksLikeAmount,
};
/** How many words (1 or 2) the command at `tokens[index]` takes (`top cc`, `بلاك جاك`), 0 when there is none. */
function commandLength(tokens, index) {
    const word = String(tokens[index] ?? '').toLowerCase();
    if (index + 1 < tokens.length && Object.hasOwn(commandArgAliases, `${word} ${String(tokens[index + 1]).toLowerCase()}`)) return 2;
    return Object.hasOwn(commandArgAliases, word) || DIRECT_COMMANDS.has(word) ? 1 : 0;
}
/**
 * The typed words with the command word first, in any order: `5k @member تحويل` → `تحويل 5k @member`, `100 مينز` →
 * `مينز 100`, `500 روليت احمر` → `روليت 500 احمر`, `كل صاروخ` → `صاروخ كل`. A message whose first word is already a
 * command (or that has none) is returned as it is. With the prefix (or a dot) the first command word found always
 * moves to the front; without it only when every other word is an amount, the all-in `كل`, a mention or ID, or one of
 * that game's own option words (a side, a direction, a colour, a multiplier; an asset name for the bourse), so
 * ordinary chat never becomes a command. Returns `{ typed, words }`; the other words keep their order.
 */
export function commandFirst(typed, words, prefixed) {
    const tokens = [typed, ...words];
    if (!typed || commandLength(tokens, 0)) return { typed, words };
    const index = tokens.findIndex((_, at) => at > 0 && commandLength(tokens, at) > 0);
    if (index < 0) return { typed, words };
    const size = commandLength(tokens, index);
    const command = tokens.slice(index, index + size);
    const others = [...tokens.slice(0, index), ...tokens.slice(index + size)];
    if (!prefixed) {
        const name = command.join(' ').toLowerCase();
        const target = commandArgAliases[name] ?? name;
        if (target === 'bourse invest' || target === 'bourse sell') {
            if (!isBourseNameInvocation(name, others)) return { typed, words };
        } else {
            const option = OPTION_WORDS[target] ?? (() => false);
            if (!others.every((word) => isAmountWord(word) || ROTATING_ALL_IN.has(String(word).toLowerCase()) || isMentionOrId(word) || option(word))) return { typed, words };
        }
    }
    return { typed: command[0], words: [...command.slice(1), ...others] };
}
