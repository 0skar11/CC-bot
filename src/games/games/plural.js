// plural.js — `جمع` / `plural`: the bot shows an Arabic singular, the first to type its plural wins the answer reward.
// Every usual plural is accepted (broken and sound: `معلمون` / `معلمين`); nobody in time → the plurals are shown.

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { PLURALS } from '../data/knowledgeWords.js';

const TEXT = {
    ar: { title: '📚 جمع', ask: (word) => `إيه جمع كلمة **${word}**؟` },
    en: { title: '📚 Plural', ask: (word) => `What is the Arabic plural of **${word}**?` },
};

export default {
    id: 'plural',
    kind: 'single',
    names: { ar: ['جمع'], en: ['plural'] },
    description: { ar: 'اكتب جمع الكلمة قبل الوقت ما يخلص', en: 'type the Arabic plural of the word before time runs out' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const entry = pickFresh(ctx.channelId, 'plural', PLURALS, ctx.random);
        await playAnswer(ctx, { title: text.title, question: text.ask(entry.singular), answers: entry.plurals, reveal: entry.plurals.join(' / ') });
    },
};
