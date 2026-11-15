// riddle.js — `لغز` / `riddle`: one classic Arabic riddle (src/games/data/knowledgeRiddles.js), the first to type
// the answer (any of its usual forms) wins; nobody in time → the answer is shown.

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { RIDDLES } from '../data/knowledgeRiddles.js';

const TEXT = {
    ar: { title: '🧩 لغز' },
    en: { title: '🧩 Riddle (in Arabic)' },
};

export default {
    id: 'riddle',
    kind: 'single',
    names: { ar: ['لغز'], en: ['riddle'] },
    description: { ar: 'فزورة، أول واحد يحلها يكسب', en: 'an Arabic riddle, the first to solve it wins' },
    async run(ctx) {
        const lang = langOf(ctx);
        const item = pickFresh(ctx.channelId, 'riddle', RIDDLES, ctx.random);
        await playAnswer(ctx, { title: TEXT[lang].title, question: `**${item.q}**`, answers: item.a, reveal: item.a[0] });
    },
};
