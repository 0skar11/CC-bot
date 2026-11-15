// flags.js — `اعلام` / `flags`: the bot shows a country's flag emoji, the first to type the country (Arabic or English,
// usual aliases: `الامارات`, `uae`, `ksa`, `امريكا`...) wins; nobody in time → the country is shown.

import { pickFresh } from '../engine/pick.js';
import { langOf, playAnswer } from '../data/knowledge.js';
import { FLAG_ROUNDS } from '../data/knowledgeFlags.js';

const TEXT = {
    ar: { title: '🏳️ أعلام', ask: (flag) => `**علم أنهي دولة ده؟** ${flag}`, reveal: (country) => `${country.flag} ${country.ar[0]}` },
    en: { title: '🏳️ Flags', ask: (flag) => `**Which country has this flag?** ${flag}`, reveal: (country) => `${country.flag} ${country.en[0]}` },
};

const titleCase = (name) => name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

export default {
    id: 'flags',
    kind: 'single',
    names: { ar: ['اعلام'], en: ['flags'] }, // `أعلام` finds it too (normalize)
    description: { ar: 'اعرف الدولة من علمها', en: 'name the country from its flag' },
    async run(ctx) {
        const text = TEXT[langOf(ctx)];
        const country = pickFresh(ctx.channelId, 'flags', FLAG_ROUNDS, ctx.random);
        const shown = langOf(ctx) === 'en' ? { ...country, en: [titleCase(country.en[0])] } : country;
        await playAnswer(ctx, { title: text.title, question: text.ask(country.flag), answers: [...country.ar, ...country.en], reveal: text.reveal(shown), image: false });
    },
};
