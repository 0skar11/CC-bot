import { findAsset, isSellAllWord } from '../store/bourse.js';

// Only the stock aliases from DISbot; no economy, store or utility aliases.
export const commandArgAliases = {
    شراء: 'bourse invest', اشتري: 'bourse invest',
    اسعار: 'bourse prices', أسعار: 'bourse prices', الاسعار: 'bourse prices', الأسعار: 'bourse prices', prices: 'bourse prices',
    بورصة: 'bourse prices', بورصه: 'bourse prices', البورصة: 'bourse prices', البورصه: 'bourse prices',
    استثمار: 'bourse invest', استثمر: 'bourse invest', invest: 'bourse invest',
    بيع: 'bourse sell', sell: 'bourse sell',
    ممتلكاتي: 'bourse holdings', ممتلكاتى: 'bourse holdings', ممتلكات: 'bourse holdings', holdings: 'bourse holdings',
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
export function applyWordAliases(typedCommand, args, prefixed) {
    const alias = commandArgAliases[typedCommand];
    if (!alias) return { commandName: typedCommand, args };
    if (!prefixed && !args.every((arg) => /^(?:\d+|<@!?\d{17,20}>)$/u.test(arg)) && !isBourseNameInvocation(typedCommand, args)) return null;
    const [commandName, ...leading] = alias.split(' ');
    return { commandName, args: [...leading, ...args] };
}
