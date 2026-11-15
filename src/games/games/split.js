// split.js — `فكك` / `split`: the bot shows a word split into letters (`ك ت ا ب`), the first member to type the
// joined word wins.

import { pickFresh } from '../engine/pick.js';
import { AR_WORDS, EN_WORDS } from '../data/words.js';
import { splitLetters } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '🧩 فكك', ask: 'جمّع الحروف دي واكتب الكلمة:' },
    en: { title: '🧩 Join the letters', ask: 'Join these letters and type the word:' },
};

export default {
    id: 'split',
    kind: 'single',
    names: { ar: ['فكك'], en: ['split'] },
    description: { ar: 'جمّع الحروف المفكوكة في كلمة', en: 'join the split letters into the word' },
    async run(ctx) {
        const lang = langOf(ctx);
        const word = pickFresh(ctx.channelId, 'split', lang === 'en' ? EN_WORDS : AR_WORDS, ctx.random);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: splitLetters(word),
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n**${splitLetters(word)}**\n\n${timeLine(lang)}`),
            }),
            answers: word,
            reveal: word,
        });
    },
};
