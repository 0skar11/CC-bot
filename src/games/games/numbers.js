// numbers.js — `ارقام` / `digits`: the bot shows a 6-9 digit number for a few seconds (at times in Arabic-Indic
// digits), then hides it; the first member to type the same digits (either kind of digits, spaces allowed) wins.

import { cardNote, cardPayload } from '../engine/card.js';
import { roundCountdown, withCountdown } from '../engine/countdown.js';
import { toPayload } from '../engine/payload.js';
import { pickFresh } from '../engine/pick.js';
import { ROUND_MS, randomDigits, toArabicDigits, typedDigits } from './lib/wordGames.js';
import { langOf, playTypingRound, timeLine } from './lib/typingRound.js';

/** How long the number stays on screen before it is hidden. */
export const SHOW_MS = 5_000;
const ARABIC_SHARE = 0.3;
const TEXT = {
    ar: {
        title: '🔢 أرقام',
        ask: (seconds) => `احفظ الرقم ده، هيختفي بعد ${seconds} ثواني:`,
        hidden: '🙈 الرقم اختفى! اكتبه من ذاكرتك.',
    },
    en: {
        title: '🔢 Digits',
        ask: (seconds) => `Remember this number, it disappears in ${seconds} seconds:`,
        hidden: '🙈 The number is gone! Type it from memory.',
    },
};
const block = (text) => `\`\`\`\n${text}\n\`\`\``;

export default {
    id: 'numbers',
    kind: 'single',
    names: { ar: ['ارقام'], en: ['digits'] },
    description: { ar: 'احفظ الرقم واكتبه بعد ما يختفي', en: 'remember the number and type it once it is gone' },
    async run(ctx) {
        const lang = langOf(ctx);
        const text = TEXT[lang];
        // pickFresh keeps the room from seeing the same length twice in a row too often; the digits are random.
        const length = pickFresh(ctx.channelId, 'numbers', [6, 7, 8, 9], ctx.random);
        const digits = randomDigits(ctx.random, length, length);
        const shown = ctx.random() < ARABIC_SHARE ? toArabicDigits(digits) : digits;
        const seconds = Math.round(SHOW_MS / 1000);
        const masked = '? '.repeat(digits.length).trim();
        // The number is an image (src/games/engine/card.js), so it cannot be copy-pasted; the "gone" card replaces it
        // (the old image is removed with `attachments: []`). Both are rendered before the number is shown.
        const card = (heading, body, fallback) => cardPayload(ctx, {
            title: text.title, heading, text: body, hint: timeLine(lang), note: cardNote(lang, timeLine(lang)), fallback,
        });
        const [shownPayload, hiddenPayload] = await Promise.all([
            card(text.ask(seconds), shown, ctx.embed(text.title, `${text.ask(seconds)}\n${block(shown)}\n${timeLine(lang)}`)),
            card(text.hidden, masked, ctx.embed(text.title, `${text.hidden}\n${block(masked)}\n${timeLine(lang)}`)),
        ]);
        // The round starts as soon as the number is shown, so the number's message carries the round's live countdown
        // (askRound posts no question of its own here); hiding the number edits only the embed and the image.
        const question = await ctx.send(withCountdown(await toPayload(shownPayload), roundCountdown(lang, ctx.clock.now() + ROUND_MS)));
        const hidden = hiddenPayload?.files ? { ...hiddenPayload, attachments: [] } : { embeds: [hiddenPayload], files: [], attachments: [] };
        const hideTimer = ctx.session.setTimeout(() => {
            question?.edit?.(hidden)?.catch?.(() => {});
        }, SHOW_MS);
        await playTypingRound(ctx, {
            prompt: null,
            check: (content) => typedDigits(content) === digits,
            reveal: shown,
        });
        ctx.session.clearTimeout(hideTimer);
    },
};
