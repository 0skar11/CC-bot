// singular.js — `مفرد` / `singular`: the reverse of `جمع` (same data, src/games/data/knowledgeWords.js): the bot shows
// an Arabic plural, the first to type its singular wins. Plurals that are also an everyday singular word
// (NO_REVERSE) are never asked.

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { NO_REVERSE, PLURALS } from '../data/knowledgeWords.js';

const ROUNDS = PLURALS.filter((entry) => !NO_REVERSE.has(entry.singular));
const TEXT = {
    ar: { title: '📗 مفرد', ask: (word) => `إيه مفرد كلمة **${word}**؟` },
    en: { title: '📗 Singular', ask: (word) => `What is the Arabic singular of **${word}**?` },
};

export default {
    id: 'singular',
    kind: 'single',
    names: { ar: ['مفرد'], en: ['singular'] },
    description: { ar: 'اكتب مفرد الكلمة قبل الوقت ما يخلص', en: 'type the Arabic singular of the word before time runs out' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const entry = pickFresh(ctx.channelId, 'singular', ROUNDS, ctx.random);
        await playAnswer(ctx, { title: text.title, question: text.ask(entry.plurals[0]), answers: [entry.singular], reveal: entry.singular });
    },
};
