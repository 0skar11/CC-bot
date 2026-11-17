// emojiGuess.js — `ايموجي` / `emoji`: guess movie, proverb, or thing from emoji clues (kind 'single').
// Pays 500 CC + 1 point to the first member to type the correct answer (within the daily cap).

import { EMOJI_CLUES } from '../data/emojis.js';
import { langOf, playTypingRound, timeLine } from './lib/typingRound.js';
import { pickFresh } from '../engine/pick.js';

const TEXT = {
    ar: {
        title: '🧩 لغز الإيموجي',
        ask: (cat) => `خمّن اسم (${cat}) من الإيموجي ده:`,
    },
    en: {
        title: '🧩 Emoji Guess',
        ask: (cat) => `Guess the (${cat}) from these emojis:`,
    },
};

export default {
    id: 'emojiGuess',
    kind: 'single',
    names: { ar: ['ايموجي'], en: ['emoji'] },
    description: {
        ar: 'خمّن اسم الفيلم أو المثل أو الشيء من الإيموجي',
        en: 'guess the movie, proverb or thing from emoji clues',
    },
    async run(ctx) {
        const lang = langOf(ctx);
        const item = pickFresh(ctx.channelId, 'emojiGuess', EMOJI_CLUES, ctx.random);
        const cat = item.category[lang] || item.category.ar;
        const ask = TEXT[lang].ask(cat);

        const promptDesc = [
            ask,
            '',
            `# ${item.emoji}`,
            '',
            timeLine(lang, 25_000),
        ].join('\n');

        const fallback = ctx.embed(TEXT[lang].title, promptDesc);

        await playTypingRound(ctx, {
            prompt: () => ({ embeds: [fallback] }),
            answers: item.answers,
            reveal: item.answers[0],
            timeMs: 25_000,
        });
    },
};
