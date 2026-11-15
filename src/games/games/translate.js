// translate.js — `ترجم` / `translate`: a common word in English (answer in Arabic) or in Arabic (answer in English),
// the direction at random. Every listed form of the other side is accepted (`عربية` = `سيارة`, `a car` = `car`).

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { TRANSLATIONS } from '../data/knowledgeTranslate.js';

const TEXT = {
    ar: {
        title: '🌍 ترجم',
        toArabic: (word) => `ترجم الكلمة دي للعربي: **${word}**`,
        toEnglish: (word) => `ترجم الكلمة دي للإنجليزي: **${word}**`,
    },
    en: {
        title: '🌍 Translate',
        toArabic: (word) => `Translate this word into Arabic: **${word}**`,
        toEnglish: (word) => `Translate this word into English: **${word}**`,
    },
};

export default {
    id: 'translate',
    kind: 'single',
    names: { ar: ['ترجم'], en: ['translate'] },
    description: { ar: 'ترجم الكلمة (عربي ↔ إنجليزي) قبل الوقت ما يخلص', en: 'translate the word (Arabic ↔ English) before time runs out' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const entry = pickFresh(ctx.channelId, 'translate', TRANSLATIONS, ctx.random);
        const toArabic = ctx.random() < 0.5;
        const answers = toArabic ? entry.ar : entry.en;
        const question = toArabic ? text.toArabic(entry.en[0]) : text.toEnglish(entry.ar[0]);
        await playAnswer(ctx, { title: text.title, question, answers, reveal: answers.slice(0, 3).join(' / ') });
    },
};
