// text.js — answer matching for the chat games. normalize() makes two spellings of the same Arabic (or Latin)
// answer equal: Unicode compatibility forms (NFKC: presentation forms, ligatures, full-width letters), invisible
// marks (ZWJ, RLM...), tashkeel and Quranic marks, tatweel, the standalone hamza ء, the alef forms أ إ آ ٱ → ا,
// ى and the Persian ی → ي, the hamza seats ئ → ي and ؤ → و, ة → ه, ک → ك, Arabic-Indic and Persian digits →
// 0-9, Latin in lower case and every run of spaces as one space.
// matches() also accepts the answer without punctuation or spaces (`عبد الله` = `عبدالله`, `مصر!` = `مصر`), but
// keeps a minus sign and a decimal point between digits so `-5` ≠ `5` and `3.5` ≠ `35`.

const INVISIBLE = /[­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
// Tashkeel (fatha... sukun, shadda, madda/hamza marks), the superscript alef and the Quranic annotation marks.
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ࣓-ࣿ]/gu;
const TATWEEL = /ـ/gu;
const HAMZA = /ء/gu;
const LETTERS = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا',
    'ى': 'ي', 'ی': 'ي', 'ې': 'ي', 'ئ': 'ي',
    'ؤ': 'و',
    'ة': 'ه', 'ۀ': 'ه', 'ہ': 'ه', 'ھ': 'ه',
    'ک': 'ك', 'ڪ': 'ك',
    '٫': '.', '٬': ',',
};
const LETTER = new RegExp(`[${Object.keys(LETTERS).join('')}]`, 'gu');
const ARABIC_DIGIT = /[٠-٩]/gu;
const PERSIAN_DIGIT = /[۰-۹]/gu;

/** The comparable form of a text (see the header). Never throws: anything is read as a string. */
export function normalize(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(INVISIBLE, '')
        .replace(TASHKEEL, '')
        .replace(TATWEEL, '')
        .replace(HAMZA, '')
        .replace(LETTER, (letter) => LETTERS[letter])
        .replace(ARABIC_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(PERSIAN_DIGIT, (digit) => String(digit.charCodeAt(0) - 0x06F0))
        .toLowerCase()
        .replace(/\s+/gu, ' ')
        .trim();
}

const isDigit = (char) => char >= '0' && char <= '9';

/** normalize() without spaces and punctuation, except a minus sign and a `.` or `,` between two digits. */
export function compact(value) {
    const text = normalize(value);
    return text.replace(/[\s\p{P}]/gu, (char, offset) => {
        if (char === '-') return char;
        if ((char === '.' || char === ',') && isDigit(text[offset - 1] || '') && isDigit(text[offset + 1] || '')) return char;
        return '';
    });
}

/** True when `input` is one of the answers (a string or a list), after normalize() or compact(). */
export function matches(input, answerOrList) {
    const answers = (Array.isArray(answerOrList) ? answerOrList : [answerOrList]).filter((answer) => answer !== null && answer !== undefined);
    const strict = normalize(input);
    if (!strict || !answers.length) return false;
    const loose = compact(input);
    return answers.some((answer) => {
        const wanted = normalize(answer);
        if (!wanted) return false;
        if (wanted === strict) return true;
        const wantedLoose = compact(answer);
        return Boolean(wantedLoose) && wantedLoose === loose;
    });
}
