// camo.js — `تمويه` / `camo`: the bot posts a picture hiding an Arabic word (3-6 letters) or a 5-7 digit number
// under colour clash, noise and wavy lines (lib/camoImage.js: hard for bots and copy-paste, readable by people);
// the first to type it wins 500 CC (digits in Arabic-Indic count too: `١٢٣٤٥` = `12345`); nobody in 25 s → it is
// shown. If the picture cannot be made the round goes on with the text in a plain embed.

import { pickFresh } from '../engine/pick.js';
import { matches } from '../engine/text.js';
import { langOf } from '../data/knowledge.js';
import { CAMO_WORDS, camoNumber } from '../data/pictureCamo.js';
import { renderCamo } from './lib/camoImage.js';
import { playPicture } from './lib/pictureRound.js';

export const CAMO_MS = 25_000;
/** The share of rounds that hide a word (the others a number). */
export const WORD_SHARE = 0.6;

const TEXT = {
    ar: {
        title: '🫥 تمويه',
        heading: { word: 'اكتب الكلمة المستخبية', number: 'اكتب الرقم المستخبي' },
        fallback: (secret) => `**الصورة مفتحتش، اكتبوا:** ${secret}`,
    },
    en: {
        title: '🫥 Camo',
        heading: { word: 'Type the hidden Arabic word', number: 'Type the hidden number' },
        fallback: (secret) => `**The picture did not load, type:** ${secret}`,
    },
};

export default {
    id: 'camo',
    kind: 'single',
    names: { ar: ['تمويه'], en: ['camo'] },
    description: { ar: 'اكتب الكلمة أو الرقم المستخبي في الصورة', en: 'type the word or number hidden in the picture' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const word = ctx.random() < WORD_SHARE;
        const secret = word ? pickFresh(ctx.channelId, 'camo', CAMO_WORDS, ctx.random) : camoNumber(ctx.random);
        await playPicture(ctx, {
            title: text.title,
            heading: text.heading[word ? 'word' : 'number'],
            picture: () => renderCamo({ text: secret, random: ctx.random }),
            width: 760,
            height: 440,
            // The exact word (matches(): spelling variants of the same letters, no article games) or the number.
            check: (content) => matches(content, secret),
            reveal: secret,
            fallback: text.fallback(secret),
            timeMs: CAMO_MS,
        });
    },
};
