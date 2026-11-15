// math.js — `رياضيات` / `ريض` / `math`: the bot shows an equation (+ - × ÷, 2-3 numbers, easy to hard, the answer is
// always a whole number), the first member to type the answer wins (Arabic-Indic digits are fine).

import { pickFresh } from '../engine/pick.js';
import { matches } from '../engine/text.js';
import { makeEquation } from './lib/wordGames.js';
import { langOf, playTypingRound, questionCard, timeLine } from './lib/typingRound.js';

const LEVELS = ['easy', 'medium', 'hard'];
const TEXT = {
    ar: { title: '🧮 رياضيات', ask: 'حل المسألة دي:' },
    en: { title: '🧮 Math', ask: 'Solve this:' },
};

export default {
    id: 'math',
    kind: 'single',
    names: { ar: ['رياضيات', 'ريض'], en: ['math'] },
    description: { ar: 'حل المسألة بسرعة', en: 'solve the equation fast' },
    async run(ctx) {
        const lang = langOf(ctx);
        const level = pickFresh(ctx.channelId, 'math', LEVELS, ctx.random, 1);
        const equation = makeEquation(ctx.random, level);
        await playTypingRound(ctx, {
            prompt: questionCard(ctx, {
                title: TEXT[lang].title, ask: TEXT[lang].ask, text: `${equation.text} = ?`,
                fallback: ctx.embed(TEXT[lang].title, `${TEXT[lang].ask}\n\`\`\`\n${equation.text} = ?\n\`\`\`\n${timeLine(lang)}`),
            }),
            check: (content) => matches(content, String(equation.answer)),
            reveal: equation.answer,
        });
    },
};
