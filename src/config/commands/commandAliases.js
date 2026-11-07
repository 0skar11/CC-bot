import { findAsset, isSellAllWord } from '../store/bourse.js';
import { coinSide } from '../casino.js';

// Stock market and read-only CC aliases from DISbot, and the casino's games (`مينز 100 3`, `عملة 100 ملك`, `سلوت 100`).
export const commandArgAliases = {
    casino: 'casino', كازينو: 'casino', الكازينو: 'casino',
    mines: 'casino mines', ماينز: 'casino mines', مينز: 'casino mines', الغام: 'casino mines', ألغام: 'casino mines',
    coinflip: 'casino coinflip', cf: 'casino coinflip', عملة: 'casino coinflip', عمله: 'casino coinflip',
    slots: 'casino slots', slot: 'casino slots', سلوت: 'casino slots', سلوتس: 'casino slots',
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
export function applyWordAliases(typedCommand, args, prefixed) {
    const twoWord = `${typedCommand} ${(args[0] || '').toLowerCase()}`;
    if (Object.hasOwn(commandArgAliases, twoWord)) {
        return { commandName: commandArgAliases[twoWord], args: args.slice(1) };
    }
    if (!Object.hasOwn(commandArgAliases, typedCommand)) return { commandName: typedCommand, args };
    if (!prefixed && !args.every((arg) => /^(?:\d+|<@!?\d{17,20}>)$/u.test(arg)) && !isBourseNameInvocation(typedCommand, args) && !isCoinflipInvocation(typedCommand, args)) return null;
    const alias = commandArgAliases[typedCommand];
    const [commandName, ...leading] = alias.split(' ');
    return { commandName, args: [...leading, ...args] };
}
