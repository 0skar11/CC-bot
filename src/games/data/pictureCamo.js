// pictureCamo.js — what `تمويه` / `camo` hides in its picture: an Arabic word of 3-6 letters from the word lists of
// the typing games (src/games/data/words.js, already checked: nothing offensive, nothing religious) or a number of
// 5-7 digits (never starting with 0).

import { AR_WORDS } from './words.js';

export const CAMO_WORDS = Object.freeze([...new Set(AR_WORDS)].filter((word) => {
    const letters = [...word].length;
    return letters >= 3 && letters <= 6 && !word.includes(' ');
}));

/** A number of 5-7 digits as a string, made from `random`. */
export function camoNumber(random = Math.random) {
    const length = 5 + Math.min(2, Math.floor(random() * 3));
    let digits = String(1 + Math.min(8, Math.floor(random() * 9)));
    while (digits.length < length) digits += String(Math.min(9, Math.floor(random() * 10)));
    return digits;
}
