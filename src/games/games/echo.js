// echo.js — `تجربة` / `test`: the sample game that proves the engine end to end (admin only, so nobody farms it).
// One round: the bot shows a word, the first member to type it wins the answer reward (CC within the daily cap,
// plus a point); nobody in time → the word is shown. Every real game follows the same shape (src/games/registry.js).

import { GAMES } from '../../config/games.js';
import { matches } from '../engine/text.js';
import { winPayload } from '../engine/rewards.js';

const WORDS = {
    ar: ['تفاحة', 'قمر', 'نجمة', 'بحر', 'شمس', 'مدرسة', 'سماء'],
    en: ['apple', 'moon', 'star', 'river', 'sun', 'school', 'sky'],
};
const TEXT = {
    ar: { title: '🧪 تجربة الألعاب', ask: (word, seconds) => `أول واحد يكتب **${word}** يكسب!\n⏳ قدامكم ${seconds} ثانية.` },
    en: { title: '🧪 Games test', ask: (word, seconds) => `First to type **${word}** wins!\n⏳ You have ${seconds} seconds.` },
};

export default {
    id: 'test',
    kind: 'single',
    names: { ar: ['تجربة'], en: ['test'] },
    description: { ar: 'تجربة للأدمن: أول واحد يكتب الكلمة يكسب', en: 'admin test: first to type the word wins' },
    eventAdminOnly: true,
    async run(ctx) {
        const lang = ctx.lang === 'en' ? 'en' : 'ar';
        const list = WORDS[lang];
        const word = list[Math.floor(ctx.random() * list.length) % list.length];
        const timeMs = GAMES.roundMs;
        const round = await ctx.askRound({
            prompt: ctx.embed(TEXT[lang].title, TEXT[lang].ask(word, Math.round(timeMs / 1000))),
            validate: (content) => matches(content, word),
            timeMs,
            reveal: word,
        });
        if (!round.winner) return;
        const reward = await ctx.rewardWin(round.winner.id, 'answer');
        await ctx.send(winPayload(lang, round.winner.id, reward, 'answer'));
    },
};
