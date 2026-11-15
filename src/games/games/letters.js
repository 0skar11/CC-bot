// letters.js — `حروف` / `letters`: the bot shows the letters of a word in another order, the first member to type a
// word made of exactly those letters that is the word or one of its known anagrams (data/words.js) wins.

import { pickFresh } from '../engine/pick.js';
import { AR_WORDS, EN_WORDS, anagramsOf } from '../data/words.js';
import { shuffleLetters } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const TEXT = {
    ar: { title: '🔀 حروف', ask: 'رتّب الحروف دي واكتب الكلمة:' },
    en: { title: '🔀 Letters', ask: 'Unscramble these letters and type the word:' },
};

/** A word of the list with its answers and a shuffle that is none of them (a word with no such shuffle is skipped). */
export function pickScramble(ctx, list) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const word = pickFresh(ctx.channelId, 'letters', list, ctx.random);
        const answers = anagramsOf(word);
        const shuffled = shuffleLetters(word, ctx.random, { avoid: answers, joiner: ' ' });
        if (shuffled) return { word, answers, shuffled };
    }
    throw new Error('letters: no word could be shuffled');
}

export default {
    id: 'letters',
    kind: 'single',
    names: { ar: ['حروف'], en: ['letters'] },
    description: { ar: 'رتّب الحروف المخلوطة في كلمة', en: 'unscramble the letters into a word' },
    async run(ctx) {
        const lang = langOf(ctx);
        const { word, answers, shuffled } = pickScramble(ctx, lang === 'en' ? EN_WORDS : AR_WORDS);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: shuffled,
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\n**${shuffled}**\n\n${timeLine(lang)}`),
            }),
            answers,
            reveal: answers.length > 1 ? answers.join(' / ') : word,
        });
    },
};
