// antonym.js — `ضد` / `مضاد` / `opposite`: the bot shows an Arabic word (either side of a pair, at random), the first
// to type its opposite wins. Every opposite listed for it is accepted (`حزين` / `زعلان`).

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { ANTONYMS } from '../data/knowledgeWords.js';

const TEXT = {
    ar: { title: '🔄 ضد', ask: (word) => `إيه عكس كلمة **${word}**؟` },
    en: { title: '🔄 Opposite', ask: (word) => `What is the Arabic opposite of **${word}**?` },
};

export default {
    id: 'antonym',
    kind: 'single',
    names: { ar: ['ضد', 'مضاد'], en: ['opposite'] },
    description: { ar: 'اكتب عكس الكلمة قبل الوقت ما يخلص', en: 'type the Arabic opposite of the word before time runs out' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const pair = pickFresh(ctx.channelId, 'antonym', ANTONYMS, ctx.random);
        const [shown, answers] = ctx.random() < 0.5 ? [pair.a, pair.b] : [pair.b, pair.a];
        await playAnswer(ctx, { title: text.title, question: text.ask(shown[0]), answers, reveal: answers.join(' / ') });
    },
};
