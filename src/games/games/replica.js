// replica.js — `ريبلكا` / `replica`: pattern replication group game (kind 'group', engine/lobby.js).
// Players join lobby (min 2, max 20). 3 rounds: each shows a pattern card.
// First player to reproduce the exact pattern in chat wins the round.
// The player with the most round wins takes the match and earns 2,000 CC + 5 points.

import { questionCard, timeLine } from './lib/typingRound.js';
import { matches } from '../engine/text.js';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePattern(length = 5) {
    let result = '';
    for (let i = 0; i < length; i += 1) {
        result += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return result;
}

const TEXT = {
    ar: {
        title: '📋 ريبلكا',
        rules: '👀 احفظ أو انقل الكود الموجود في الصورة بأسرع ما يمكن وبدقة في الشات!',
        round: (n) => `🎯 **الجولة ${n} من 3**`,
        ask: 'اكتب الكود ده بالضبط في الشات:',
        roundWon: (id, score) => `⚡ <@${id}> نقل الكود صح أول واحد! (مجموع نقاطه: ${score})`,
        roundNobody: (code) => `⌛ الوقت خلص ومحدش كتب الكود صح! الكود كان: **${code}**`,
        standings: (list) => `🏆 الترتيب الحالي:\n${list.map(([id, s]) => `• <@${id}>: ${s} جولة`).join('\n')}`,
        winner: (id) => `👑 <@${id}> فاز بلعبة ريبلكا!`,
    },
    en: {
        title: '📋 Replica',
        rules: '👀 Copy the code shown in the image card as fast and accurately as you can in chat!',
        round: (n) => `🎯 **Round ${n} of 3**`,
        ask: 'Type this exact code in chat:',
        roundWon: (id, score) => `⚡ <@${id}> got it right first! (Score: ${score})`,
        roundNobody: (code) => `⌛ Time ran out! The code was: **${code}**`,
        standings: (list) => `🏆 Standings:\n${list.map(([id, s]) => `• <@${id}>: ${s} win(s)`).join('\n')}`,
        winner: (id) => `👑 <@${id}> won the Replica game!`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

export default {
    id: 'replica',
    kind: 'group',
    names: { ar: ['ريبلكا'], en: ['replica'] },
    description: {
        ar: 'ريبلكا: حفظ ونقل النمط بدقة وسرعة من الصورة',
        en: 'replicate the pattern shown in the card as fast as you can',
    },
    minPlayers: 2,
    maxPlayers: 20,
    async run(ctx) {
        const text = textOf(ctx.lang);
        const lobby = await ctx.openLobby({
            title: text.title,
            description: text.rules,
            min: 2,
            max: 20,
        });
        if (lobby.cancelled || ctx.session.ended) return;

        const scores = new Map();
        const MAX_ROUNDS = 3;

        for (let round = 1; round <= MAX_ROUNDS && !ctx.session.ended; round += 1) {
            const pattern = generatePattern(4 + round); // gets slightly longer each round

            const prompt = questionCard(ctx, {
                title: `${text.title} - ${text.round(round)}`,
                ask: text.ask,
                text: pattern,
                fallback: ctx.embed(`${text.title} - ${text.round(round)}`, `${text.ask}\n\n**${pattern}**\n\n${timeLine(ctx.lang, 20_000)}`),
            });

            const startId = ctx.message?.id ?? null;
            const res = await ctx.askRound({
                prompt,
                validate: (content, message) => (startId === null || message?.id !== startId) && matches(content, pattern),
                timeMs: 20_000,
                reveal: pattern,
            });

            if (res.winner) {
                const current = (scores.get(res.winner.id) || 0) + 1;
                scores.set(res.winner.id, current);

                const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
                await ctx.send({
                    embeds: [ctx.embed(text.title, `${text.roundWon(res.winner.id, current)}\n\n${text.standings(sorted)}`)],
                });
            } else {
                await ctx.send({
                    embeds: [ctx.embed(text.title, text.roundNobody(pattern))],
                });
            }

            if (round < MAX_ROUNDS && !ctx.session.ended) {
                await delay(ctx, 3000);
            }
        }

        if (scores.size > 0 && !ctx.session.ended) {
            const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
            const winnerId = sorted[0][0];

            const reward = await ctx.rewardWin(winnerId, 'group');
            await ctx.announceWin({ winner: { id: winnerId }, message: null }, reward, 'group');
        }
    },
};
