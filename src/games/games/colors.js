// colors.js — `الوان` / `colors`: Stroop effect color quiz (kind 'single').
// Displays a color word written in a contrasting ink color.
// The bot asks either for the ink color or the written word.
// First to answer correctly wins 500 CC + 1 point.

import { pictureCardPayload } from '../engine/imageCard.js';
import { langOf, playTypingRound, timeLine } from './lib/typingRound.js';

const COLORS = [
    { id: 'red', hex: '#e74c3c', ar: ['احمر', 'أحمر'], en: ['red'] },
    { id: 'blue', hex: '#3498db', ar: ['ازرق', 'أزرق'], en: ['blue'] },
    { id: 'green', hex: '#2ecc71', ar: ['اخضر', 'أخضر'], en: ['green'] },
    { id: 'yellow', hex: '#f1c40f', ar: ['اصفر', 'أصفر'], en: ['yellow'] },
    { id: 'orange', hex: '#e67e22', ar: ['برتقالي'], en: ['orange'] },
    { id: 'purple', hex: '#9b59b6', ar: ['بنفسجي', 'موف'], en: ['purple', 'violet'] },
    { id: 'pink', hex: '#fd79a8', ar: ['وردي', 'بمبي', 'بينك'], en: ['pink'] },
    { id: 'white', hex: '#ffffff', ar: ['ابيض', 'أبيض'], en: ['white'] },
];

const TEXT = {
    ar: {
        title: '🎨 تحدي تأثير ستروب للألوان',
        askInk: 'ما هو **لون الخط** المكتوب به؟ (مش الكلمة!)',
        askWord: 'ما هي **الكلمة** المكتوبة؟ (مش لون الخط!)',
        noteInk: '🎨 المطلوب: لون الخط (الحبر)',
        noteWord: '🎨 المطلوب: الكلمة المكتوبة',
    },
    en: {
        title: '🎨 Stroop Color Challenge',
        askInk: 'What is the **ink color** of the text? (Not the word!)',
        askWord: 'What is the **written word**? (Not the ink color!)',
        noteInk: '🎨 Goal: Ink color',
        noteWord: '🎨 Goal: Written word',
    },
};
const textOf = (lang) => TEXT[lang === 'en' ? 'en' : 'ar'];

function buildSvgCard(text, hexColor) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300">
  <rect width="100%" height="100%" fill="#1a102f" rx="20"/>
  <text x="50%" y="55%" font-size="64" font-weight="bold" font-family="sans-serif"
        fill="${hexColor}" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
}

export default {
    id: 'colors',
    kind: 'single',
    names: { ar: ['الوان'], en: ['colors'] },
    description: {
        ar: 'تحدي الألوان (تأثير ستروب): ركز في المطلوب وجاوب بلون الخط أو الكلمة',
        en: 'Stroop effect color test: answer with the ink color or the written word',
    },
    async run(ctx) {
        const lang = langOf(ctx);
        const text = textOf(lang);

        // Pick two distinct colors
        const wordIdx = Math.floor(ctx.random() * COLORS.length);
        let inkIdx = Math.floor(ctx.random() * (COLORS.length - 1));
        if (inkIdx >= wordIdx) inkIdx += 1;

        const wordColor = COLORS[wordIdx];
        const inkColor = COLORS[inkIdx];

        // 50% ask for ink color, 50% ask for written word
        const askForInk = ctx.random() < 0.5;
        const ask = askForInk ? text.askInk : text.askWord;
        const note = askForInk ? text.noteInk : text.noteWord;
        const expectedAnswers = askForInk ? [...inkColor.ar, ...inkColor.en] : [...wordColor.ar, ...wordColor.en];
        const reveal = askForInk ? inkColor.ar[0] : wordColor.ar[0];

        const displayWord = lang === 'en' ? wordColor.en[0].toUpperCase() : wordColor.ar[0];
        const svg = buildSvgCard(displayWord, inkColor.hex);

        const fallback = ctx.embed(text.title, `${ask}\n\n**[ ${displayWord} ]**\n\n${timeLine(lang, 20_000)}`);

        const prompt = () => pictureCardPayload(ctx, {
            title: text.title,
            picture: svg,
            heading: ask,
            note: `${note} ・ ${timeLine(lang, 20_000)}`,
            hint: timeLine(lang, 20_000),
            fallback,
        });

        await playTypingRound(ctx, {
            prompt,
            answers: expectedAnswers,
            reveal,
            timeMs: 20_000,
        });
    },
};
