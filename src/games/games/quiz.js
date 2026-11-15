// quiz.js — `سؤال` / `quiz`: one general-knowledge question (src/games/data/knowledgeQuestions.js), answer typed.
// `سؤال` asks the Arabic questions, `quiz` the English ones; every accepted form of the answer counts.

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { QUESTIONS_AR, QUESTIONS_EN } from '../data/knowledgeQuestions.js';

const TEXT = {
    ar: { title: '❓ سؤال' },
    en: { title: '❓ Quiz' },
};

export default {
    id: 'quiz',
    kind: 'single',
    names: { ar: ['سؤال'], en: ['quiz'] },
    description: { ar: 'سؤال معلومات عامة، أول إجابة صح تكسب', en: 'a general-knowledge question, the first right answer wins' },
    async run(ctx) {
        const lang = langOf(ctx);
        const list = lang === 'en' ? QUESTIONS_EN : QUESTIONS_AR;
        const item = pickFresh(ctx.channelId, `quiz:${lang}`, list, ctx.random);
        await playAnswer(ctx, { title: TEXT[lang].title, question: `**${item.q}**`, answers: item.a, reveal: item.a[0] });
    },
};
