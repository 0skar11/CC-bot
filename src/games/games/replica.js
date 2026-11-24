// replica.js — `ريبلكا` / `replica`: the category game (kind 'group', engine/lobby.js). Players join a lobby (min 2,
// max 20). 3 rounds: each shows a category (a human name, an animal, an object, a plant, a country) and a letter; the
// first player of the lobby to write a right word wins the round. The player with the most round wins takes the
// match and earns 2,000 CC + 5 points. Only the lobby's players' answers count.
//
// A right word (judgeWord):
// - starts with the letter once the answer is read the plain way: normalize() of engine/text.js (أ إ آ → ا, ة → ه,
//   ى → ي, the hamza ء, tashkeel and tatweel dropped), punctuation and emoji ignored, a letter typed 3 times or more
//   in a row read once (نوووور = نور), and the article ال taken off (الأسد = أسد, البرازيل is a ب word) unless the
//   whole answer is a listed word (إلهام, ألمانيا);
// - a word on the category's list (src/games/data/categories.js) wins at once; a word listed only in another
//   category never counts (نمر is not a human name);
// - any other answer that looks like one Arabic word (3 to 15 letters, or عبد / ابو / ام and a word; not a chat
//   word such as ماشي or مين, not a repeated syllable) stops the round and the other players vote ✅ / ❌ on it
//   (VOTE_MS, or until they all voted). It counts unless ❌ outnumber ✅ (nobody voting keeps it). A word voted
//   down never counts again in that round, its writer can then only win the round with a listed word, and the
//   round goes on (with at least RESUME_MS left). After MAX_VOTES votes in a round only listed words count.
// When the time runs out, a few listed words are shown as examples (they are not the only right answers).
// Vote buttons: `g:replica:<yes|no>:<voteId>` (src/interactions/buttons/store/games.js); votes live in memory.

import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, MessageFlags } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';
import { buttonLanguage } from '../../services/cc/lang.js';
import { logger } from '../../utils/logger.js';
import { questionCard, timeLine } from './lib/typingRound.js';
import { askablePairs, CATEGORIES, CATEGORY_IDS, STOP_WORDS, wordsFor } from '../data/categories.js';
import { relativeTime } from '../engine/countdown.js';
import { compact, normalize } from '../engine/text.js';

const ROUND_MS = 20_000;
const MAX_ROUNDS = 3;
export const VOTE_MS = 10_000;
export const RESUME_MS = 8_000;
export const MAX_VOTES = 3;

const ARTICLE = 'ال';
// The first word of a two-word name that may go to a vote (عبد المنعم, ابو تريكة, ام كلثوم), written the plain way.
const COMPOUND_FIRST = new Set(['عبد', 'ابو', 'ام']);
// 3 to 15 Arabic letters (ء to ي) once spaces are taken out.
const ARABIC_WORD = /^[ء-ي]{3,15}$/u;
// One or two letters said again and again (هاها, لولو).
const REPEATED = /^(.{1,2})\1+$/u;

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

// compact() of every listed word → the categories that list it (built once, on first use).
let listed = null;
function wordIndex() {
    if (listed) return listed;
    listed = new Map();
    for (const category of CATEGORY_IDS) {
        for (const words of Object.values(CATEGORIES[category].words)) {
            for (const word of words) {
                const key = compact(word);
                if (!listed.has(key)) listed.set(key, new Set());
                listed.get(key).add(category);
            }
        }
    }
    return listed;
}

/** An answer the plain way: normalize(), punctuation, emoji and symbols out, a letter typed 3+ times in a row once. */
function cleanText(content) {
    return normalize(content)
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/(\p{L})\1{2,}/gu, '$1')
        .replace(/\s+/gu, ' ')
        .trim();
}

/** The word an answer gives: cleanText() without the article ال, unless the whole answer is listed (إلهام). */
export function readWord(content) {
    const text = cleanText(content);
    if (!text.startsWith(ARTICLE) || wordIndex().has(compact(text))) return text;
    const rest = text.slice(ARTICLE.length).trim();
    return compact(rest).length >= 2 ? rest : text;
}

let stops = null;
const stopKeys = () => (stops ??= new Set(STOP_WORDS.map((word) => compact(readWord(word)))));

/** Whether an unlisted answer looks like a word worth a vote (see the header). */
function looksLikeWord(word, key) {
    const parts = word.split(' ');
    if (parts.length > 2 || (parts.length === 2 && !COMPOUND_FIRST.has(parts[0]))) return false;
    return ARABIC_WORD.test(key) && !REPEATED.test(key) && !stopKeys().has(key);
}

/**
 * The verdict on `content` for a round { category, letter }:
 *   { ok: true, known: true, word, key }    a listed word of the category: it wins
 *   { ok: true, known: false, word, key }   not listed but plausible: the players vote on it
 *   { ok: false, reason, ... }              'empty', 'letter' (another first letter), 'category' (listed only in
 *                                           another category), 'refused' (voted down this round), 'unknown' (not
 *                                           listed and `unknown` is false), 'shape' (does not look like a word)
 * `refused`: the keys voted down in this round; `unknown: false` lets only listed words through.
 */
export function judgeWord(content, { category, letter }, { refused = null, unknown = true } = {}) {
    const word = readWord(content);
    const key = compact(word);
    if (!key) return { ok: false, reason: 'empty' };
    if (key[0] !== normalize(letter)) return { ok: false, reason: 'letter', word, key };
    const lists = wordIndex().get(key);
    if (lists?.has(category)) return { ok: true, known: true, word, key };
    if (lists) return { ok: false, reason: 'category', word, key };
    if (refused?.has(key)) return { ok: false, reason: 'refused', word, key };
    if (!unknown) return { ok: false, reason: 'unknown', word, key };
    if (!looksLikeWord(word, key)) return { ok: false, reason: 'shape', word, key };
    return { ok: true, known: false, word, key };
}

/** Whether `content` is a listed word of the round (wins without a vote). */
export const isRoundWord = (content, round) => judgeWord(content, round, { unknown: false }).known === true;

/** Up to `count` different listed words of the round, drawn with `random`: the examples shown when time runs out. */
export function examplesFor({ category, letter }, random = Math.random, count = 3) {
    const pool = [...wordsFor(category, letter)];
    const picked = [];
    while (picked.length < count && pool.length) {
        const at = Math.min(pool.length - 1, Math.floor(Math.max(0, Number(random()) || 0) * pool.length));
        picked.push(pool.splice(at, 1)[0]);
    }
    return picked;
}

/** An answer as it was typed, for the vote message: letters, marks and spaces only, at most 40 characters. */
const shownWord = (content) => String(content ?? '').normalize('NFKC').replace(/[^\p{L}\p{M}\s]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 40);

const TEXT = {
    ar: {
        title: '📋 ريبلكا',
        rules: '👀 هتتسأل 3 مرات عن إنسان أو حيوان أو جماد أو نبات أو دولة بيبدأ بحرف معين، وأسرع واحد يكتب كلمة صح في الشات يكسب الجولة! لو الكلمة مش في قايمتي، باقي اللاعبين بيصوّتوا عليها.',
        round: (n) => `🎯 **الجولة ${n} من ${MAX_ROUNDS}**`,
        ask: (category, letter) => `اكتب **${category}** بيبدأ بحرف **${letter}**:`,
        resume: (category, letter) => `🔁 كمّلوا! لسه محتاجين **${category}** بيبدأ بحرف **${letter}**:`,
        roundWon: (id, score) => `⚡ <@${id}> كتب كلمة صح أول واحد! (مجموع نقاطه: ${score})`,
        roundNobody: (list) => `⌛ الوقت خلص ومحدش كتب كلمة صح! أمثلة: **${list}**`,
        standings: (list) => `🏆 الترتيب الحالي:
${list.map(([id, s]) => `• <@${id}>: ${s} جولة`).join('\n')}`,
        vote: (id, word) => `🤔 <@${id}> كتب **${word}** ودي مش في قايمتي.\nصح ولا غلط؟ صوّتوا يا باقي اللاعبين.`,
        voteEnds: (at) => `⏳ التصويت بيخلص ${at}`,
        kept: (word, yes, no) => `✅ **${word}** اتحسبت (صح ${yes} / غلط ${no})`,
        dropped: (word, yes, no) => `❌ **${word}** متحسبتش (صح ${yes} / غلط ${no})`,
        yes: 'صح',
        no: 'غلط',
        votedYes: '✅ صوتك اتسجل: صح.',
        votedNo: '✅ صوتك اتسجل: غلط.',
        ownWord: '❌ مينفعش تصوّت على كلمتك.',
        notPlayer: '❌ انت مش في اللعبة دي.',
        voteOver: '⌛ التصويت ده خلص.',
    },
    en: {
        title: '📋 Replica',
        rules: '👀 3 rounds: a human name, an animal, an object, a plant or a country that starts with a given letter. The first to write a right word in chat wins the round! If a word is not on my list, the other players vote on it.',
        round: (n) => `🎯 **Round ${n} of ${MAX_ROUNDS}**`,
        ask: (category, letter) => `Write **${category}** that starts with **${letter}**:`,
        resume: (category, letter) => `🔁 Keep going! Still need **${category}** that starts with **${letter}**:`,
        roundWon: (id, score) => `⚡ <@${id}> got it right first! (Score: ${score})`,
        roundNobody: (list) => `⌛ Time's up, nobody got one! Examples: **${list}**`,
        standings: (list) => `🏆 Standings:
${list.map(([id, s]) => `• <@${id}>: ${s} win(s)`).join('\n')}`,
        vote: (id, word) => `🤔 <@${id}> wrote **${word}**, which is not on my list.\nRight or wrong? The other players vote.`,
        voteEnds: (at) => `⏳ The vote ends ${at}`,
        kept: (word, yes, no) => `✅ **${word}** counts (right ${yes} / wrong ${no})`,
        dropped: (word, yes, no) => `❌ **${word}** doesn't count (right ${yes} / wrong ${no})`,
        yes: 'Right',
        no: 'Wrong',
        votedYes: '✅ Vote saved: right.',
        votedNo: '✅ Vote saved: wrong.',
        ownWord: "❌ You can't vote on your own word.",
        notPlayer: "❌ You're not in this game.",
        voteOver: '⌛ This vote is over.',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];
const categoryName = (category, lang) => (lang === 'en' ? CATEGORIES[category].en : CATEGORIES[category].ar);

const privately = (interaction, content) => Promise.resolve()
    .then(() => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }))
    .catch(() => {});

const editVote = (message, payload) => Promise.resolve()
    .then(() => message?.edit?.({ allowedMentions: { parse: [] }, ...payload }))
    .catch((error) => logger.warn(`[GAMES] Could not edit a replica vote: ${error?.code || error?.message}`));

// voteId → an open vote on a word.
const votes = new Map();
export const openVotes = () => [...votes.values()];

function voteButtons(vote) {
    const text = textOf(vote.lang);
    const id = (choice) => `${GAMES_BUTTON_PREFIX}:replica:${choice}:${vote.id}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('yes')).setLabel(text.yes).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(id('no')).setLabel(text.no).setEmoji('❌').setStyle(ButtonStyle.Danger),
    );
}

/**
 * Asks the players of `players` other than `by` whether `word` counts, for VOTE_MS or until all of them voted.
 * Resolves to { accepted, yes, no } (accepted unless ❌ outnumber ✅), or { cancelled: true } when the session ended
 * or the vote could not be posted.
 */
export async function voteOnWord(ctx, { word, by, players }) {
    const { session } = ctx;
    if (!session || session.ended) return { cancelled: true };
    const voters = new Set(players.filter((id) => id !== by));
    if (!voters.size) return { accepted: true, yes: 0, no: 0 };
    const vote = { id: randomBytes(6).toString('hex'), lang: ctx.lang === 'en' ? 'en' : 'ar', by, voters, ballots: new Map(), done: false, finish: () => {} };
    const text = textOf(vote.lang);
    const shown = escapeMarkdown(word);
    const body = (status) => ctx.embed(text.title, `${text.vote(by, shown)}\n\n${status}`);
    let message;
    try {
        message = await ctx.send({ embeds: [body(text.voteEnds(relativeTime(session.clock.now() + VOTE_MS)))], components: [voteButtons(vote)] });
    } catch (error) {
        logger.warn(`[GAMES] Could not post a replica vote: ${error?.code || error?.message}`);
        return { cancelled: true };
    }
    if (session.ended) {
        await editVote(message, { components: [] });
        return { cancelled: true };
    }
    return new Promise((resolve) => {
        let timer = null;
        let offEnd = () => {};
        vote.finish = (reason) => {
            if (vote.done) return;
            vote.done = true;
            votes.delete(vote.id);
            session.clearTimeout(timer);
            offEnd();
            if (reason === 'ended') {
                editVote(message, { components: [] });
                resolve({ cancelled: true });
                return;
            }
            const ballots = [...vote.ballots.values()];
            const yes = ballots.filter((choice) => choice === 'yes').length;
            const no = ballots.length - yes;
            const accepted = no <= yes;
            editVote(message, { embeds: [body((accepted ? text.kept : text.dropped)(shown, yes, no))], components: [] });
            resolve({ accepted, yes, no });
        };
        votes.set(vote.id, vote);
        offEnd = session.onEnd(() => vote.finish('ended'));
        timer = session.setTimeout(() => vote.finish('time'), VOTE_MS);
    });
}

/** A press on a `g:replica:<yes|no>:<voteId>` button. Never throws. */
export async function handleReplicaButton(interaction, [choice, voteId] = []) {
    try {
        const vote = votes.get(String(voteId || ''));
        if (!vote || vote.done) {
            await privately(interaction, textOf(vote?.lang ?? buttonLanguage(interaction)).voteOver);
            // A vote from before a restart: its buttons go away so nobody else presses them.
            if (!vote) await Promise.resolve().then(() => interaction.message?.edit?.({ components: [] })).catch(() => {});
            return;
        }
        const text = textOf(vote.lang);
        const userId = interaction.user?.id;
        if (!userId || interaction.user.bot) return;
        if (userId === vote.by) return privately(interaction, text.ownWord);
        if (!vote.voters.has(userId)) return privately(interaction, text.notPlayer);
        if (choice !== 'yes' && choice !== 'no') return privately(interaction, text.voteOver);
        vote.ballots.set(userId, choice);
        await privately(interaction, choice === 'yes' ? text.votedYes : text.votedNo);
        if (vote.ballots.size >= vote.voters.size) vote.finish('all');
    } catch (error) {
        logger.warn(`[GAMES] A replica vote button failed: ${error?.message || error}`);
        await privately(interaction, textOf(buttonLanguage(interaction)).voteOver);
    }
}

const delay = (ctx, ms) => new Promise((resolve) => {
    if (ctx.session?.ended) return resolve();
    const off = ctx.session.onEnd(resolve);
    const h = ctx.session.setTimeout(() => { off(); resolve(); }, ms);
    if (!h) { off(); resolve(); }
});

/** Plays one round (with its votes); resolves to the winner's id, or null (nobody in time, or cancelled). */
async function playRound(ctx, { round, index, players, text }) {
    const { letter } = round;
    const name = categoryName(round.category, ctx.lang);
    const ask = text.ask(name, letter);
    const heading = `${text.title} - ${text.round(index + 1)}`;
    const startId = ctx.message?.id ?? null;
    const inGame = new Set(players);
    const refused = new Set();
    const barred = new Set();
    const reveal = ctx.embed(text.title, text.roundNobody(examplesFor(round, ctx.random ?? Math.random).join('، ')));
    let votesLeft = MAX_VOTES;
    let timeMs = ROUND_MS;
    let prompt = questionCard(ctx, {
        title: heading,
        ask,
        text: letter,
        fallback: ctx.embed(heading, `${ask}

${timeLine(ctx.lang, ROUND_MS)}`),
    });

    while (!ctx.session.ended) {
        const res = await ctx.askRound({
            prompt,
            timeMs,
            reveal,
            validate: (content, message) => {
                if (startId !== null && message?.id === startId) return false;
                const userId = message?.author?.id;
                if (!inGame.has(userId)) return false;
                return judgeWord(content, round, { refused, unknown: votesLeft > 0 && !barred.has(userId) });
            },
        });
        if (!res.winner) return null;
        if (res.result?.known) return res.winner.id;

        votesLeft -= 1;
        const word = shownWord(res.message?.content) || res.result.word;
        const vote = await voteOnWord(ctx, { word, by: res.winner.id, players });
        if (vote.cancelled) return null;
        if (vote.accepted) return res.winner.id;
        refused.add(res.result.key);
        barred.add(res.winner.id);
        timeMs = Math.max(RESUME_MS, timeMs - res.elapsedMs);
        prompt = ctx.embed(heading, text.resume(name, letter));
    }
    return null;
}

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

        const players = [...lobby.players];
        const scores = new Map();
        const rounds = pickRounds(ctx.random ?? Math.random);

        for (let index = 0; index < rounds.length && !ctx.session.ended; index += 1) {
            const winnerId = await playRound(ctx, { round: rounds[index], index, players, text });
            if (ctx.session.ended) break;

            if (winnerId) {
                const current = (scores.get(winnerId) || 0) + 1;
                scores.set(winnerId, current);

                const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
                await ctx.send({
                    embeds: [ctx.embed(text.title, `${text.roundWon(winnerId, current)}

${text.standings(sorted)}`)],
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
