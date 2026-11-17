// pictureRound.js — the one-question round of the picture games (map.js, camo.js): the question is ONE picture card
// (engine/imageCard.js) posted by askRound, which adds the live countdown line (engine/countdown.js) like every
// other question; the first right typed answer (never the message that started the game) wins the `answer` reward,
// shown with ctx.announceWin() (a reply to the winner, with play-again); nobody in time → askRound shows `reveal`.
// When the picture cannot be rendered the round still runs on a plain text embed (`fallback`: written by the game).

import { cardNote } from '../../engine/card.js';
import { pictureCardPayload } from '../../engine/imageCard.js';
import { accepts, langOf } from '../../data/knowledge.js';

const TEXT = {
    ar: { time: (seconds) => `⏳ قدامكم **${seconds}** ثانية، أول إجابة صح تكسب!` },
    en: { time: (seconds) => `⏳ You have **${seconds}** seconds, the first right answer wins!` },
};

/** The "time left" line of a picture question. */
export const pictureTime = (lang, ms) => TEXT[lang === 'en' ? 'en' : 'ar'].time(Math.round(ms / 1000));

/**
 * One picture question. `picture`: Buffer / SVG string / (async) function; `heading`: the card's header; `answers`
 * (checked with accepts()) or `check(content)`; `fallback`: the text of the embed posted when the card fails.
 * Resolves { ...round, reward } with a winner, else askRound's result ({ timeout } / { cancelled }).
 */
export async function playPicture(ctx, { title, picture, heading = '', theme = 'dark', width, height, answers, check, reveal, timeMs, fallback = '' }) {
    const lang = langOf(ctx);
    const startId = ctx.message?.id ?? null;
    const time = pictureTime(lang, timeMs);
    const isRight = check || ((content) => accepts(content, answers));
    const textPrompt = ctx.embed(title, [fallback, time].filter(Boolean).join('\n\n'));
    const round = await ctx.askRound({
        prompt: () => pictureCardPayload(ctx, { title, picture, heading, hint: time, note: cardNote(lang, time), theme, width, height, fallback: textPrompt }),
        validate: (content, message) => !(startId && message?.id === startId) && isRight(content),
        timeMs,
        reveal,
    });
    if (!round?.winner) return round;
    const reward = await ctx.rewardWin(round.winner.id, 'answer');
    await ctx.announceWin(round, reward, 'answer');
    return { ...round, reward };
}
