// fast.js — `اسرع` / `fast`: the bot shows a word or a short phrase (Arabic or English, at times three words), the
// first member to type it wins.

import { pickFresh } from '../engine/pick.js';
import { AR_WORDS, EN_WORDS, PHRASES } from '../data/words.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '⚡ أسرع واحد', ask: 'أول واحد يكتب ده بالظبط يكسب:' },
    en: { title: '⚡ Fastest typer', ask: 'First to type this exactly wins:' },
};

/** The text to type: a phrase a quarter of the time, else a word (in the other language a third of those times). */
export function pickFastText(ctx, lang) {
    const other = lang === 'en' ? 'ar' : 'en';
    const roll = ctx.random();
    if (roll < 0.25) return pickFresh(ctx.channelId, `fast:phrase:${lang}`, PHRASES[lang], ctx.random);
    const wordLang = roll < 0.5 ? other : lang;
    return pickFresh(ctx.channelId, `fast:${wordLang}`, wordLang === 'en' ? EN_WORDS : AR_WORDS, ctx.random);
}

export default {
    id: 'fast',
    kind: 'single',
    names: { ar: ['اسرع'], en: ['fast'] },
    description: { ar: 'أول واحد يكتب الكلمة يكسب', en: 'first to type the word wins' },
    async run(ctx) {
        const lang = langOf(ctx);
        const text = pickFastText(ctx, lang);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text,
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n**${text}**\n\n${timeLine(lang)}`),
            }),
            answers: text,
            reveal: text,
        });
    },
};
