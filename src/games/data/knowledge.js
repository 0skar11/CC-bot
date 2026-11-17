// knowledge.js — what the single-player "answer before the time" knowledge games share (src/games/games/plural.js,
// singular.js, antonym.js, translate.js, quiz.js, riddle.js, flags.js): the answer check and the one-question round.
// The content itself is in the knowledge*.js files next to this one.
//
// accepts(input, answers): matches() from engine/text.js, plus the forms people really type: an Arabic answer with
// or without the article (`الكتب` = `كتب`), an English one with or without `the`, `a`, `an` or `to`.
// playAnswer(ctx, { title, question, answers, reveal, image }): posts the question as an image card (engine/card.js;
// `image: false` or a render error: bold, in a text embed), waits
// ROUND_MS for the first right answer (never the message that started the game), pays the winner the `answer`
// reward and shows it with ctx.announceWin() (a reply to the winner); on a timeout the round itself shows `reveal`.

import { cardNote, cardPayload } from '../engine/card.js';
import { matches, normalize } from '../engine/text.js';

export const ROUND_MS = 25_000;

/** '|'-separated alternatives as a list (`'كتب|أكتاب'` → ['كتب', 'أكتاب']). */
export const split = (text) => String(text).split('|').map((part) => part.trim()).filter(Boolean);

export const langOf = (ctx) => (ctx?.lang === 'en' ? 'en' : 'ar');

const ARTICLE_EN = /^(?:the|a|an|to) /u;

/** The spellings of one text that count as the same answer (normalized). */
export function forms(text) {
    const base = normalize(text);
    const out = new Set([base]);
    const english = base.replace(ARTICLE_EN, '');
    if (english) out.add(english);
    // `ال` + at least three letters: the word without the article too (`الكتب` → `كتب`), and the other way round.
    if (/^ال\S{3,}/u.test(base)) out.add(base.slice(2));
    else if (/^[ء-ي]\S*$/u.test(base) && !base.includes(' ')) out.add(`ال${base}`);
    return [...out];
}

/** True when `input` is one of `answers` (a string or a list), in any of its forms(). */
export function accepts(input, answers) {
    const list = (Array.isArray(answers) ? answers : [answers]).filter((answer) => answer !== null && answer !== undefined && String(answer).trim());
    if (!list.length) return false;
    const wanted = list.flatMap(forms);
    return forms(input).some((form) => matches(form, wanted)) || matches(input, list);
}

const TEXT = {
    ar: { time: (seconds) => `⏳ قدامكم **${seconds}** ثانية، أول إجابة صح تكسب!` },
    en: { time: (seconds) => `⏳ You have **${seconds}** seconds, the first right answer wins!` },
};

/** One question: { winner, reward, ... } when someone got it, else the askRound() result ({ timeout } / { cancelled }). */
export async function playAnswer(ctx, { title, question, answers, reveal, footer = '', timeMs = ROUND_MS, image = true }) {
    const lang = langOf(ctx);
    const startId = ctx.message?.id ?? null;
    const time = TEXT[lang].time(Math.round(timeMs / 1000));
    const textPrompt = ctx.embed(title, `${question}\n\n${time}`, footer ? { footer } : {});
    // The question as an image (src/games/engine/card.js) so it cannot be copy-pasted; the text embed when the
    // card cannot be rendered, or when the game keeps text (`image: false`).
    const prompt = image
        ? () => cardPayload(ctx, { title, text: question, hint: time, note: cardNote(lang, time), footer, fallback: textPrompt })
        : textPrompt;
    const round = await ctx.askRound({
        prompt,
        validate: (content, message) => !(startId && message?.id === startId) && accepts(content, answers),
        timeMs,
        reveal,
    });
    if (!round?.winner) return round;
    const reward = await ctx.rewardWin(round.winner.id, 'answer');
    await ctx.announceWin(round, reward, 'answer');
    return { ...round, reward };
}
