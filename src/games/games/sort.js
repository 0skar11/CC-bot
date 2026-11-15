// sort.js — `رتب` / `ترتيب` / `sort`: the bot shows 5 different numbers, the first member to type them from the
// smallest to the largest wins (any separators: spaces, commas, dashes; Arabic-Indic digits too).

import { pickFresh } from '../engine/pick.js';
import { distinctNumbers, isSortedAnswer } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const COUNT = 5;
const TEXT = {
    ar: { title: '📶 رتّب', ask: 'رتّب الأرقام دي من الصغير للكبير:' },
    en: { title: '📶 Sort', ask: 'Sort these numbers from smallest to largest:' },
};

export default {
    id: 'sort',
    kind: 'single',
    names: { ar: ['رتب', 'ترتيب'], en: ['sort'] },
    description: { ar: 'رتّب الأرقام من الصغير للكبير', en: 'sort the numbers from smallest to largest' },
    async run(ctx) {
        const lang = langOf(ctx);
        const max = pickFresh(ctx.channelId, 'sort', [50, 99, 200, 999], ctx.random);
        const numbers = distinctNumbers(ctx.random, COUNT, max);
        const sorted = [...numbers].sort((a, b) => a - b);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: numbers.join('   '),
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\`\`\`\n${numbers.join('   ')}\n\`\`\`\n${timeLine(lang)}`),
            }),
            check: (content) => isSortedAnswer(content, numbers),
            reveal: sorted.join(' '),
        });
    },
};
