import { findAsset, isSellAllWord } from '../store/bourse.js';
import { coinSide, isAllInWord, readGameArgs } from '../casino.js';

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
// The newer games whose words are also everyday chat (`كراش`, `صاروخ`, `فرخة`...): typed without the prefix they need a bet.
const NEW_CASINO_GAMES = new Set(['casino dice', 'casino chicken', 'casino roulette', 'casino rocket', 'casino blackjack']);
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
    return args.some((arg) => /^\d+$/u.test(arg)) && args.some((arg) => coinSide(arg) !== null);
}
// `صاروخ 100 2` / `كراش 100 2.5`, `نرد 100 فوق 70`, `روليت 100 احمر`, `فرخة 100` without the prefix: a bet and the game's
// words. The bet may be an all-in word (`صاروخ كل`, `نرد كل فوق 70`): readGameArgs reads it.
export function isGameInvocation(typedCommand, args) {
    const target = commandArgAliases[typedCommand];
    if (!NEW_CASINO_GAMES.has(target)) return false;
    return !readGameArgs(target.split(' ')[1], args).error;
}
const isWholeArg = (arg) => /^\d+$/u.test(arg);
// `مينز كل 3`, `سلوت كل`, `عملة كل ملك` without the prefix: an all-in word where the number of the bet goes, and
// after it only what that game takes with a bet (the mine count; the side of the coin, before or after it).
export function isAllInInvocation(typedCommand, args) {
    const target = commandArgAliases[typedCommand];
    if (target === 'casino mines') return args.length <= 2 && isAllInWord(args[0]) && args.slice(1).every(isWholeArg);
    if (target === 'casino slots') return args.length === 1 && isAllInWord(args[0]);
    if (target !== 'casino coinflip') return false;
    if (args.length === 1) return isAllInWord(args[0]);
    return args.length === 2 && args.some(isAllInWord) && args.some((arg) => coinSide(arg) !== null);
}
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
    if (!prefixed && !args.every((arg) => /^(?:\d+|<@!?\d{17,20}>)$/u.test(arg)) && !isBourseNameInvocation(typedCommand, args) && !isCoinflipInvocation(typedCommand, args) && !isGameInvocation(typedCommand, args) && !isAllInInvocation(typedCommand, args)) return null;
    const alias = commandArgAliases[typedCommand];
    const [commandName, ...leading] = alias.split(' ');
    return { commandName, args: [...leading, ...args] };
}
