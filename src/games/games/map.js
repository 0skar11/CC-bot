// map.js — `خريطة` / `map`: the bot posts the outline of a country (a picture: no name, no flag, src/games/data/
// pictureMap.js); the first to type the country (Arabic or English, the aliases of `اعلام`) wins 500 CC; nobody in
// 30 s → the country is shown. If the picture cannot be made the round goes on with the country's flag as text.

import { pickFresh } from '../engine/pick.js';
import { langOf } from '../data/knowledge.js';
import { MAP_ROUNDS, shapeSvg } from '../data/pictureMap.js';
import { playPicture } from './lib/pictureRound.js';

export const MAP_MS = 30_000;

const titleCase = (name) => name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

const TEXT = {
    ar: {
        title: '🗺️ خريطة',
        heading: 'خريطة أنهي دولة دي؟',
        fallback: (country) => `**الصورة مفتحتش، خمّنوا من العلم:** ${country.flag}`,
        reveal: (country) => `${country.flag} ${country.ar[0]}`,
    },
    en: {
        title: '🗺️ Map',
        heading: 'Which country is this?',
        fallback: (country) => `**The picture did not load, guess from the flag:** ${country.flag}`,
        reveal: (country) => `${country.flag} ${titleCase(country.en[0])}`,
    },
};

export default {
    id: 'map',
    kind: 'single',
    names: { ar: ['خريطة'], en: ['map'] }, // `خريطه` finds it too (normalize)
    description: { ar: 'اعرف الدولة من شكل خريطتها', en: 'name the country from its outline' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const country = pickFresh(ctx.channelId, 'map', MAP_ROUNDS, ctx.random);
        await playPicture(ctx, {
            title: text.title,
            heading: text.heading,
            picture: () => shapeSvg(country.code),
            answers: [...country.ar, ...country.en],
            reveal: text.reveal(country),
            fallback: text.fallback(country),
            timeMs: MAP_MS,
        });
    },
};
