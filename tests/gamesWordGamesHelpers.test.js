import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANAGRAMS, AR_WORDS, EN_WORDS, PHRASES, anagramsOf, letterKey } from '../src/games/data/words.js';
import { normalize } from '../src/games/engine/text.js';
import { fillsOf } from '../src/games/games/missing.js';
import { playTypingRound } from '../src/games/games/lib/typingRound.js';
import {
    ROUND_MS, countLetters, distinctNumbers, evaluate, hideLetter, isPalindrome, isSortedAnswer, letters, makeEquation,
    parseNumberList, randomDigits, reverseWord, shuffleLetters, splitLetters, toArabicDigits, typedDigits,
} from '../src/games/games/lib/wordGames.js';

/** A seeded random in [0, 1) (mulberry32), so every run checks the same cases. */
function seeded(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('the word lists: enough words, the right lengths, no duplicate (after normalize) and no shared word', () => {
    assert.ok(AR_WORDS.length >= 400, `${AR_WORDS.length} Arabic words`);
    assert.ok(EN_WORDS.length >= 150, `${EN_WORDS.length} English words`);
    assert.ok(PHRASES.ar.length + PHRASES.en.length >= 40);
    for (const [list, min, max] of [[AR_WORDS, 3, 7], [EN_WORDS, 4, 8]]) {
        const seen = new Set();
        for (const word of list) {
            const key = normalize(word);
            assert.equal(seen.has(key), false, `duplicate ${word}`);
            seen.add(key);
            assert.ok(countLetters(word) >= min && countLetters(word) <= max, `${word}: ${countLetters(word)} letters`);
        }
    }
    for (const word of AR_WORDS) assert.match(word, /^[ء-ي]+$/u, word);
    for (const word of EN_WORDS) assert.match(word, /^[a-z]+$/u, word);
    assert.ok(PHRASES.ar.some((phrase) => phrase.split(' ').length === 3) && PHRASES.en.some((phrase) => phrase.split(' ').length === 3));
});

test('anagrams: every stored one has the same letters, and anagramsOf finds the word first then the others', () => {
    for (const [word, others] of Object.entries(ANAGRAMS)) for (const other of others) assert.equal(letterKey(other), letterKey(word), `${word} / ${other}`);
    assert.deepEqual(anagramsOf('listen'), ['listen', 'silent', 'enlist', 'tinsel']);
    const salt = anagramsOf('ملح');
    assert.equal(salt[0], 'ملح');
    for (const word of ['حلم', 'لحم', 'محل']) assert.ok(salt.includes(word), word);
    assert.deepEqual(anagramsOf('كتاب'), ['كتاب', 'كاتب'], 'words of the lists count too');
    assert.deepEqual(anagramsOf('سيارة'), ['سيارة']);
});

test('letters, split, count and reverse', () => {
    assert.deepEqual(letters('كتاب'), ['ك', 'ت', 'ا', 'ب']);
    assert.equal(splitLetters('كتاب'), 'ك ت ا ب');
    assert.equal(reverseWord('كتاب'), 'باتك');
    assert.equal(reverseWord('apple'), 'elppa');
    assert.equal(isPalindrome('level'), true);
    assert.equal(isPalindrome('كتاب'), false);
    // Count: spaces never count, a hamza on its seat is one letter (precomposed or written as alef + hamza above).
    assert.equal(countLetters('أسد'), 3);
    assert.equal(countLetters('أسد'), 3);
    assert.equal(countLetters('صباح الفل'), 8);
    assert.equal(countLetters('ببغاء'), 5);
    assert.equal(countLetters('apple'), 5);
});

test('shuffleLetters never gives back the word or an avoided anagram, and keeps the same letters', () => {
    const random = seeded(7);
    for (const word of [...AR_WORDS.slice(0, 120), ...EN_WORDS.slice(0, 60), 'قصر', 'listen']) {
        const avoid = anagramsOf(word);
        const shuffled = shuffleLetters(word, random, { avoid });
        assert.ok(shuffled, word);
        assert.equal(letterKey(shuffled), letterKey(word), word);
        for (const answer of avoid) assert.notEqual(normalize(shuffled), normalize(answer), word);
    }
    // A random that always says 0 still gets a different order (the fallbacks), and an impossible word gives null.
    assert.notEqual(shuffleLetters('كتاب', () => 0), 'كتاب');
    assert.equal(shuffleLetters('ببب', seeded(2)), null);
    assert.equal(shuffleLetters('كتاب', seeded(3), { joiner: ' ' }).split(' ').length, 4);
});

test('hideLetter hides one letter, and fillsOf accepts every word of the list that fits the blank', () => {
    const { shown, letter, index } = hideLetter('كتاب', seeded(4));
    assert.equal(shown.split('').filter((char) => char === '_').length, 1);
    assert.equal(letters('كتاب')[index], letter);
    assert.deepEqual(fillsOf('ك_ب', ['كتب', 'كلب', 'قلب', 'كتاب'], 'كتب'), ['كتب', 'كلب']);
});

test('digits: random numbers of 6-9 digits, Arabic-Indic form, and what a member typed', () => {
    const random = seeded(5);
    for (let i = 0; i < 200; i += 1) {
        const digits = randomDigits(random);
        assert.match(digits, /^[1-9]\d{5,8}$/u);
    }
    assert.equal(toArabicDigits('2024'), '٢٠٢٤');
    assert.equal(typedDigits('٢٠٢٤'), '2024');
    assert.equal(typedDigits(' 123 456 '), '123456');
    assert.equal(typedDigits('123,456'), '123456');
    assert.equal(typedDigits('123a'), '');
});

test('sort: different numbers, and any separators (or Arabic-Indic digits) are accepted, letters are not', () => {
    const numbers = distinctNumbers(seeded(6), 5, 9);
    assert.equal(new Set(numbers).size, 5);
    const list = [42, 7, 19, 88, 3];
    for (const typed of ['3 7 19 42 88', '3,7,19,42,88', '3، 7، 19، 42، 88', '٣ ٧ ١٩ ٤٢ ٨٨', '3-7-19-42-88', ' 3  7 19 42 88 ']) {
        assert.equal(isSortedAnswer(typed, list), true, typed);
    }
    for (const typed of ['88 42 19 7 3', '3 7 19 42', '3 7 19 42 88 90', 'answer 3 7 19 42 88', '']) assert.equal(isSortedAnswer(typed, list), false, typed);
    assert.equal(parseNumberList('hello'), null);
});

test('equations: always a whole answer from 0 up that matches the shown text, every ÷ exact, all levels', () => {
    const random = seeded(8);
    const seen = new Set();
    for (let i = 0; i < 3000; i += 1) {
        const equation = makeEquation(random);
        seen.add(equation.level);
        for (const op of equation.ops) seen.add(op);
        assert.ok(Number.isSafeInteger(equation.answer) && equation.answer >= 0, equation.text);
        assert.ok(equation.numbers.length >= 2 && equation.numbers.length <= 3, equation.text);
        // Re-read the shown text, so what members see is what is checked.
        const tokens = equation.text.split(' ');
        const numbers = tokens.filter((_, j) => j % 2 === 0).map(Number);
        const ops = tokens.filter((_, j) => j % 2 === 1);
        assert.equal(evaluate(numbers, ops), equation.answer, equation.text);
    }
    for (const item of ['easy', 'medium', 'hard', '+', '-', '×', '÷']) assert.ok(seen.has(item), item);
    assert.equal(evaluate([7, 2], ['÷']), null, 'an inexact ÷');
    assert.equal(evaluate([2, 3, 4], ['+', '×']), 14, '× before +');
    assert.equal(evaluate([12, 3, 2], ['÷', '×']), 8, 'left to right');
});

test('playTypingRound never accepts the message that started the game, and waits ROUND_MS', async () => {
    assert.equal(ROUND_MS, 20_000);
    let options = null;
    const ctx = {
        lang: 'ar', message: { id: 'start' },
        askRound: async (given) => { options = given; return { timeout: true }; },
    };
    await playTypingRound(ctx, { prompt: 'q', answers: 'كتاب', reveal: 'كتاب' });
    assert.equal(options.timeMs, 20_000);
    assert.equal(options.validate('كتاب', { id: 'start' }), false);
    assert.equal(options.validate('كتاب', { id: 'other' }), true);
    assert.equal(options.validate('قلم', { id: 'other' }), false);
});
