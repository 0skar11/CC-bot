// replica.js — `ريبلكا` / `replica`: the category game (kind 'group', engine/lobby.js). Players join a lobby (min 2,
// max 20). 3 rounds: each shows a category (a human name, an animal, an object, a plant, a country) and a letter; the
// first player to write a word of that category that starts with the letter wins the round (the words are listed in
// src/games/data/categories.js). The player with the most round wins takes the match and earns 2,000 CC + 5 points.

import { questionCard, timeLine } from './lib/typingRound.js';
import { askablePairs, CATEGORIES, wordsFor } from '../data/categories.js';
import { matches, normalize } from '../engine/text.js';

const ROUND_MS = 20_000;
const MAX_ROUNDS = 3;

/** `count` different { category, letter } pairs, drawn with `random` (never the same category twice in a row). */
export function pickRounds(random, count = MAX_ROUNDS) {
    const pool = askablePairs();
    const out = [];
    while (out.length < count && pool.length) {
        const last = out[out.length - 1]?.category;
        const options = pool.filter((pair) => pair.category !== last);
        const choice = (options.length ? options : pool)[Math.floor(random() * (options.length || pool.length))];
        out.push(choice);
        pool.splice(pool.indexOf(choice), 1);
    }
    return out;
}

/** The words of a round, written the plain way (the answers matches() compares with). */
export const answersFor = ({ category, letter }) => wordsFor(category, letter).map((word) => normalize(word));

/** Whether `content` is a word of the round: on the list, with or without the `ال` of the definite article. */
export function isRoundWord(content, round) {
    const plain = normalize(content);
    const bare = plain.startsWith('ال') ? plain.slice(2) : plain;
    return matches(plain, answersFor(round)) || matches(bare, answersFor(round));
}

const TEXT = {
    ar: {
        title: '📋 ريبلكا',
        rules: '👀 هتتسأل 3 مرات عن إنسان أو حيوان أو جماد أو نبات أو دولة بيبدأ بحرف معين، وأسرع واحد يكتب كلمة صح في الشات يكسب الجولة!',
        round: (n) => `🎯 **الجولة ${n} من ${MAX_ROUNDS}**`,
        ask: (category, letter) => `اكتب **${category}** بيبدأ بحرف **${letter}**:`,
        roundWon: (id, score) => `⚡ <@${id}> كتب كلمة صح أول واحد! (مجموع نقاطه: ${score})`,
        roundNobody: (list) => `⌛ الوقت خلص ومحدش كتب كلمة صح! مثلًا: **${list}**`,
        standings: (list) => `🏆 الترتيب الحالي:
${list.map(([id, s]) => `• <@${id}>: ${s} جولة`).join('\n')}`,
    },
    en: {
        title: '📋 Replica',
        rules: '👀 3 rounds: a human name, an animal, an object, a plant or a country that starts with a given letter. The first to write a right word in chat wins the round!',
        round: (n) => `🎯 **Round ${n} of ${MAX_ROUNDS}**`,
        ask: (category, letter) => `Write **${category}** that starts with **${letter}**:`,
        roundWon: (id, score) => `⚡ <@${id}> got it right first! (Score: ${score})`,
        roundNobody: (list) => `⌛ Time ran out! For example: **${list}**`,
        standings: (list) => `🏆 Standings:
${list.map(([id, s]) => `• <@${id}>: ${s} win(s)`).join('\n')}`,
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];
const categoryName = (category, lang) => (lang === 'en' ? CATEGORIES[category].en : CATEGORIES[category].ar);

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

export default {
    id: 'replica',
    kind: 'group',
    names: { ar: ['ريبلكا', 'ريبليكا'], en: ['replica'] },
    description: {
        ar: 'ريبلكا: إنسان حيوان جماد نبات دولة بحرف معين، أسرع واحد يكتب كلمة صح',
        en: 'a human, animal, object, plant or country with a given letter: the fastest right word wins',
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
        const rounds = pickRounds(ctx.random ?? Math.random);

        for (let index = 0; index < rounds.length && !ctx.session.ended; index += 1) {
            const round = rounds[index];
            const letter = round.letter;
            const ask = text.ask(categoryName(round.category, ctx.lang), letter);
            const heading = `${text.title} - ${text.round(index + 1)}`;

            const prompt = questionCard(ctx, {
                title: heading,
                ask,
                text: letter,
                fallback: ctx.embed(heading, `${ask}

${timeLine(ctx.lang, ROUND_MS)}`),
            });

            const startId = ctx.message?.id ?? null;
            const res = await ctx.askRound({
                prompt,
                validate: (content, message) => (startId === null || message?.id !== startId) && isRoundWord(content, round),
                timeMs: ROUND_MS,
                reveal: wordsFor(round.category, letter).slice(0, 3).join('، '),
            });

            if (res.winner) {
                const current = (scores.get(res.winner.id) || 0) + 1;
                scores.set(res.winner.id, current);

                const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
                await ctx.send({
                    embeds: [ctx.embed(text.title, `${text.roundWon(res.winner.id, current)}

${text.standings(sorted)}`)],
                });
            } else {
                await ctx.send({
                    embeds: [ctx.embed(text.title, text.roundNobody(wordsFor(round.category, letter).slice(0, 3).join('، ')))],
                });
            }

            if (index < rounds.length - 1 && !ctx.session.ended) {
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
