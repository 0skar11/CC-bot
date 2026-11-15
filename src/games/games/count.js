// count.js — `عد` / `عدد` / `count`: the bot shows a word, the first member to type how many letters it has wins
// (spaces never count, a hamza on its seat is one letter; Arabic-Indic digits are fine).

import { pickFresh } from '../engine/pick.js';
import { matches } from '../engine/text.js';
import { AR_WORDS, EN_WORDS } from '../data/words.js';
import { countLetters } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '🔡 عد الحروف', ask: 'الكلمة دي فيها كام حرف؟' },
    en: { title: '🔡 Count the letters', ask: 'How many letters does this word have?' },
};

export default {
    id: 'count',
    kind: 'single',
    names: { ar: ['عد', 'عدد'], en: ['count'] },
    description: { ar: 'قول الكلمة فيها كام حرف', en: 'say how many letters the word has' },
    async run(ctx) {
        const lang = langOf(ctx);
        const word = pickFresh(ctx.channelId, 'count', lang === 'en' ? EN_WORDS : AR_WORDS, ctx.random);
        const answer = countLetters(word);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: word,
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n**${word}**\n\n${timeLine(lang)}`),
            }),
            check: (content) => matches(content, String(answer)),
            reveal: answer,
        });
    },
};
