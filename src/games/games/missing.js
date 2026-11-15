// missing.js — `حرف` / `missing`: the bot shows a word with one letter replaced by `_`, the first member to type the
// whole word wins.

import { pickFresh } from '../engine/pick.js';
import { AR_WORDS, EN_WORDS } from '../data/words.js';
import { normalize } from '../engine/text.js';
import { hideLetter, letters } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '🔤 الحرف الناقص', ask: 'كمّل الكلمة واكتبها كاملة:' },
    en: { title: '🔤 Missing letter', ask: 'Fill in the letter and type the whole word:' },
};

/** The word, plus every other word of the list that also fits the blank (`ك_ب` → كلب and كتب). */
export function fillsOf(shown, list, word) {
    const pattern = letters(shown).map((letter) => (letter === '_' ? null : normalize(letter)));
    const fits = (other) => {
        const own = letters(other);
        return own.length === pattern.length && own.every((letter, i) => pattern[i] === null || normalize(letter) === pattern[i]);
    };
    return [word, ...list.filter((other) => other !== word && fits(other))];
}

export default {
    id: 'missing',
    kind: 'single',
    names: { ar: ['حرف'], en: ['missing'] },
    description: { ar: 'كمّل الحرف الناقص في الكلمة', en: 'fill in the missing letter' },
    async run(ctx) {
        const lang = langOf(ctx);
        const list = lang === 'en' ? EN_WORDS : AR_WORDS;
        const word = pickFresh(ctx.channelId, 'missing', list, ctx.random);
        const { shown } = hideLetter(word, ctx.random);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: shown,
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n\`${shown}\`\n\n${timeLine(lang)}`),
            }),
            answers: fillsOf(shown, list, word),
            reveal: word,
        });
    },
};
