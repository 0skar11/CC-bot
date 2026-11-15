// reverse.js — `عكس` / `reverse`: the bot shows a word written backwards, the first member to type it the right way
// round wins. Words that read the same backwards are never asked.

import { pickFresh } from '../engine/pick.js';
import { AR_WORDS, EN_WORDS } from '../data/words.js';
import { isPalindrome, reverseWord } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '🔁 عكس', ask: 'الكلمة دي مكتوبة بالمقلوب، اكتبها صح:' },
    en: { title: '🔁 Reverse', ask: 'This word is written backwards, type it the right way:' },
};
const POOLS = {
    ar: AR_WORDS.filter((word) => !isPalindrome(word)),
    en: EN_WORDS.filter((word) => !isPalindrome(word)),
};

export default {
    id: 'reverse',
    kind: 'single',
    names: { ar: ['عكس'], en: ['reverse'] },
    description: { ar: 'اكتب الكلمة المقلوبة صح', en: 'type the backwards word the right way' },
    async run(ctx) {
        const lang = langOf(ctx);
        const word = pickFresh(ctx.channelId, 'reverse', POOLS[lang], ctx.random);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: reverseWord(word),
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n**${reverseWord(word)}**\n\n${timeLine(lang)}`),
            }),
            answers: word,
            reveal: word,
        });
    },
};
