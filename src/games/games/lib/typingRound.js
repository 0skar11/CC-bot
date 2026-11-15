// typingRound.js — the shared round of the typing games: one question, the first right answer in ROUND_MS wins
// the answer reward (shown with winPayload), nobody in time → the answer is shown. The message that started the
// game never counts as an answer.

import { cardNote, cardPayload } from '../../engine/card.js';
import { matches } from '../../engine/text.js';
import { winPayload } from '../../engine/rewards.js';
import { ROUND_MS } from './wordGames.js';

export const langOf = (ctx) => (ctx.lang === 'en' ? 'en' : 'ar');

/** The "time left" line of a question. */
export const timeLine = (lang, ms = ROUND_MS) => (lang === 'en'
    ? `⏳ You have ${Math.round(ms / 1000)} seconds.`
    : `⏳ قدامكم ${Math.round(ms / 1000)} ثانية.`);

/**
 * A question posted as an image (src/games/engine/card.js): `ask` is the card's header, `text` its big line, the
 * time left its footer; the embed only says the question is in the image (and the time). The text never appears
 * in the message, so it cannot be copy-pasted. `fallback`: the text embed posted when the card cannot be rendered.
 * Returns a prompt function for askRound (the card renders while the round already listens).
 */
export const questionCard = (ctx, { title, ask, text, fallback }) => {
    const lang = langOf(ctx);
    return () => cardPayload(ctx, { title, heading: ask, text, hint: timeLine(lang), note: cardNote(lang, timeLine(lang)), fallback });
};

/**
 * Asks one question. `prompt`: what to post (null when the game posted it itself); `answers`: the right answers
 * (compared with matches()), or `check(content)` for a custom rule; `reveal`: what the time's-up line shows.
 * Resolves to askRound's result.
 */
export async function playTypingRound(ctx, { prompt, answers, check, reveal, timeMs = ROUND_MS }) {
    const lang = langOf(ctx);
    const startId = ctx.message?.id ?? null;
    const isRight = check || ((content) => matches(content, answers));
    const round = await ctx.askRound({
        prompt,
        validate: (content, message) => (startId === null || message?.id !== startId) && isRight(content),
        timeMs,
        reveal,
    });
    if (!round.winner) return round;
    const reward = await ctx.rewardWin(round.winner.id, 'answer');
    await ctx.send(winPayload(lang, round.winner.id, reward, 'answer'));
    return round;
}
