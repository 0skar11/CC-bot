// flags.js — `اعلام` / `flags`: the bot posts a country's flag as a picture it draws itself (src/games/data/
// pictureFlags.js: no emoji or name in the message, so the question cannot be copied into a search); the first to
// type the country (Arabic or English, usual aliases: `الامارات`, `uae`, `ksa`, `امريكا`...) wins; nobody in time →
// the country is shown. If the picture cannot be made the round goes on with the flag emoji as text.

import { pickFresh } from '../engine/pick.js';
import { langOf, ROUND_MS } from '../data/knowledge.js';
import { FLAG_ROUNDS } from '../data/knowledgeFlags.js';
import { flagSvg } from '../data/pictureFlags.js';
import { playPicture } from './lib/pictureRound.js';

const TEXT = {
    ar: {
        title: '🏳️ أعلام',
        heading: 'علم أنهي دولة ده؟',
        fallback: (country) => `**علم أنهي دولة ده؟** ${country.flag}`,
        reveal: (country) => `${country.flag} ${country.ar[0]}`,
    },
    en: {
        title: '🏳️ Flags',
        heading: 'Which country has this flag?',
        fallback: (country) => `**Which country has this flag?** ${country.flag}`,
        reveal: (country) => `${country.flag} ${titleCase(country.en[0])}`,
    },
};

function titleCase(name) {
    return name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export default {
    id: 'flags',
    kind: 'single',
    names: { ar: ['اعلام'], en: ['flags'] }, // `أعلام` finds it too (normalize)
    description: { ar: 'اعرف الدولة من علمها', en: 'name the country from its flag' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const country = pickFresh(ctx.channelId, 'flags', FLAG_ROUNDS, ctx.random);
        await playPicture(ctx, {
            title: text.title,
            heading: text.heading,
            picture: () => flagSvg(country.code),
            answers: [...country.ar, ...country.en],
            reveal: text.reveal(country),
            fallback: text.fallback(country),
            timeMs: ROUND_MS,
        });
    },
};
