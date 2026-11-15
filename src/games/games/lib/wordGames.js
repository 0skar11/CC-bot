// wordGames.js — the pure helpers of the typing games (src/games/games/: اسرع, فكك, حروف, حرف, عكس, ارقام, رتب,
// عد, رياضيات): letters, split, reverse, a shuffle that never gives back the word, a hidden letter, digits, sorted
// numbers and the equation generator. No Discord, no clock: everything takes `random` (ctx.random) so tests are
// deterministic. This folder is not a game: the registry only loads the .js files directly in src/games/games/.

import { normalize } from '../../engine/text.js';

/** How long every typing question waits for the first right answer. */
export const ROUND_MS = 20_000;

/** A whole number in [min, max] from `random`. */
export function randomInt(random, min, max) {
    return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

/** One item of `items` from `random`. */
export const pickOne = (random, items) => items[randomInt(random, 0, items.length - 1)];

/**
 * The letters of a word, spaces, tatweel and combining marks left out (NFC first, so `أ` written as `ا` + hamza
 * above is one letter, like the precomposed `أ`).
 */
export function letters(word) {
    return [...String(word ?? '').normalize('NFC').replace(/[\p{M}ـ\s]/gu, '')];
}

/** How many letters `word` has (spaces left out, a hamza on its seat is one letter). */
export const countLetters = (word) => letters(word).length;

/** `كتاب` → `ك ت ا ب`. */
export const splitLetters = (word) => letters(word).join(' ');

/** `كتاب` → `باتك` (the letters backwards). */
export const reverseWord = (word) => letters(word).reverse().join('');

/** True when the word reads the same backwards (useless for `عكس`). */
export const isPalindrome = (word) => normalize(reverseWord(word)) === normalize(letters(word).join(''));

/**
 * The letters of `word` in another order, never the word itself nor any text of `avoid` (after normalize), joined
 * with `joiner`. Null when every order is avoided (a word like `ببب`).
 */
export function shuffleLetters(word, random, { avoid = [], joiner = '' } = {}) {
    const source = letters(word);
    const banned = new Set([word, ...avoid].map((text) => normalize(letters(text).join(''))));
    const ok = (order) => !banned.has(normalize(order.join('')));
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const order = [...source];
        for (let i = order.length - 1; i > 0; i -= 1) {
            const j = randomInt(random, 0, i);
            [order[i], order[j]] = [order[j], order[i]];
        }
        if (ok(order)) return order.join(joiner);
    }
    // An unlucky `random`: the rotations, then the reverse, then give up.
    for (let shift = 1; shift < source.length; shift += 1) {
        const order = [...source.slice(shift), ...source.slice(0, shift)];
        if (ok(order)) return order.join(joiner);
    }
    const reversed = [...source].reverse();
    return ok(reversed) ? reversed.join(joiner) : null;
}

/** `word` with one letter shown as `_`: { shown, index, letter }. */
export function hideLetter(word, random) {
    const source = letters(word);
    const index = randomInt(random, 0, source.length - 1);
    const letter = source[index];
    source[index] = '_';
    return { shown: source.join(''), index, letter };
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** `2024` → `٢٠٢٤`. */
export const toArabicDigits = (text) => String(text).replace(/[0-9]/gu, (digit) => ARABIC_INDIC[Number(digit)]);

/** A number of `min`-`max` digits as a string, never starting with 0. */
export function randomDigits(random, min = 6, max = 9) {
    const length = randomInt(random, min, max);
    let digits = String(randomInt(random, 1, 9));
    while (digits.length < length) digits += String(randomInt(random, 0, 9));
    return digits;
}

/** The digits a member typed (`١٢٣ ٤٥٦`, `123,456` → `123456`), or '' when the text has anything but digits and separators. */
export function typedDigits(text) {
    const value = normalize(text).replace(/[\s,.\-_،]/gu, '');
    return /^\d+$/u.test(value) ? value : '';
}

/** `count` different whole numbers in [1, max], in random order. */
export function distinctNumbers(random, count = 5, max = 99) {
    const numbers = new Set();
    while (numbers.size < count) numbers.add(randomInt(random, 1, max));
    return [...numbers];
}

/**
 * The numbers of a typed list with any separators (`3 7 19`, `3,7,19`, `٣، ٧، ١٩`, `3-7-19`), or null when it has
 * letters (a sentence is not an answer).
 */
export function parseNumberList(text) {
    const value = normalize(text);
    if (!value || /\p{L}/u.test(value)) return null;
    const found = value.match(/\d+/gu);
    return found ? found.map(Number) : null;
}

/** True when `text` lists exactly `numbers` from the smallest to the largest. */
export function isSortedAnswer(text, numbers) {
    const typed = parseNumberList(text);
    const wanted = [...numbers].sort((a, b) => a - b);
    return Boolean(typed) && typed.length === wanted.length && typed.every((number, i) => number === wanted[i]);
}

// ─── Equations ───
const OPERATORS = ['+', '-', '×', '÷'];
const LEVELS = {
    easy: { add: 20, mul: 9, operands: [2] },
    medium: { add: 100, mul: 12, operands: [2, 3] },
    hard: { add: 500, mul: 25, operands: [3] },
};

/**
 * The value of `numbers[0] ops[0] numbers[1] ...` with × and ÷ before + and -, left to right; null when a ÷ is
 * not exact (or by zero).
 */
export function evaluate(numbers, ops) {
    const terms = [numbers[0]];
    const signs = [];
    for (let i = 0; i < ops.length; i += 1) {
        const op = ops[i];
        const next = numbers[i + 1];
        if (op === '×') terms[terms.length - 1] *= next;
        else if (op === '÷') {
            const left = terms[terms.length - 1];
            if (next === 0 || left % next !== 0) return null;
            terms[terms.length - 1] = left / next;
        } else {
            signs.push(op);
            terms.push(next);
        }
    }
    return terms.slice(1).reduce((sum, term, i) => (signs[i] === '+' ? sum + term : sum - term), terms[0]);
}

/**
 * A random equation of 2-3 operands (+ - × ÷) whose answer is a whole number from 0 up (every ÷ exact):
 * { text: '12 × 3 + 4', answer: 40, level, numbers, ops }.
 */
export function makeEquation(random, level = pickOne(random, Object.keys(LEVELS))) {
    const range = LEVELS[level] || LEVELS.medium;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const count = pickOne(random, range.operands);
        const ops = Array.from({ length: count - 1 }, () => pickOne(random, OPERATORS));
        if (ops.some((op, i) => op === '÷' && ops[i - 1] === '÷')) continue;
        const numbers = Array.from({ length: count }, (_, i) => {
            const near = ['×', '÷'].includes(ops[i - 1]) || ['×', '÷'].includes(ops[i]);
            return near ? randomInt(random, 2, range.mul) : randomInt(random, 1, range.add);
        });
        // Exact divisions: the number before each ÷ is a multiple of the one after it.
        for (let i = 0; i < ops.length; i += 1) if (ops[i] === '÷') numbers[i] = numbers[i + 1] * randomInt(random, 1, range.mul);
        const answer = evaluate(numbers, ops);
        if (answer === null || !Number.isSafeInteger(answer) || answer < 0 || answer > 100_000) continue;
        const text = numbers.map((number, i) => (i ? `${ops[i - 1]} ${number}` : String(number))).join(' ');
        return { text, answer, level, numbers, ops };
    }
    const a = randomInt(random, 1, 50);
    const b = randomInt(random, 1, 50);
    return { text: `${a} + ${b}`, answer: a + b, level, numbers: [a, b], ops: ['+'] };
}
