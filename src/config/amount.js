// amount.js — the one reader of a typed CC amount (transfers, addcc / removecc, every casino bet).
// Accepts plain digits (`5000`), Arabic-Indic digits (`٥٠٠٠`, `۵۰۰۰`), thousands separators (`5,000`, `5٬000`),
// a suffix (`k` / `ك` / `ألف` / `الف` ×1,000, `m` / `مليون` ×1,000,000, `b` / `مليار` ×1,000,000,000, any case,
// with or without a space: `5k`, `5 مليون`) and a decimal before a suffix (`1.5k`, `1٫5k`, the older `1,5k`).
// The result is a positive safe whole number up to `max`, else null (`1.0005k` is 1000.5 CC: refused). A decimal
// without a suffix (`2.5`) is not an amount (it is a rocket multiplier). The all-in words (`كل`, `all`...) and the
// shares (`نص`, `50%`) stay with src/config/casino.js; counts and options (mines, dice number, bourse quantity)
// stay plain whole numbers and never come here.

export const AMOUNT_ERROR = '❌ المبلغ مش مفهوم';
export const AMOUNT_ERROR_EN = '❌ Amount not understood';
/** The invalid-amount answer in `lang` ('ar' or 'en'). */
export const amountErrorText = (lang = 'ar') => (lang === 'en' ? AMOUNT_ERROR_EN : AMOUNT_ERROR);

const MULTIPLIERS = { k: 1_000n, ك: 1_000n, الف: 1_000n, ألف: 1_000n, m: 1_000_000n, مليون: 1_000_000n, b: 1_000_000_000n, مليار: 1_000_000_000n };
// The Arabic suffix words a member may type as their own word (`5 الف`): joinAmountWords glues them to the number.
const SUFFIX_WORDS = new Set(['الف', 'ألف', 'مليون', 'مليار']);
const AMOUNT = /^(\d+(?:[,٬]\d+)*)(?:[.٫](\d+))?\s*(k|m|b|ك|الف|ألف|مليون|مليار)?$/iu;

/** `text` with its Arabic-Indic (٠-٩) and Persian (۰-۹) digits as ASCII digits. */
export function toAsciiDigits(text) {
    return String(text ?? '')
        .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x660))
        .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x6f0));
}

/**
 * The whole CC amount `text` stands for (`5k` → 5000, `1.5m` → 1500000, `5,000` → 5000, `٥٠٠` → 500), or null when it
 * isn't one, isn't whole, isn't positive or is above `max` (default Number.MAX_SAFE_INTEGER).
 */
export function parseAmount(text, { max = Number.MAX_SAFE_INTEGER } = {}) {
    const match = AMOUNT.exec(toAsciiDigits(text).trim());
    if (!match) return null;
    let [, whole, fraction = ''] = match;
    const suffix = match[3]?.toLowerCase();
    const groups = whole.split(/[,٬]/u);
    if (groups.length > 1) {
        const thousands = /^\d{1,3}$/u.test(groups[0]) && groups.slice(1).every((group) => /^\d{3}$/u.test(group));
        // `1,5k` (a comma as the decimal point, before a suffix) reads as it always did: 1.5k.
        if (!thousands && groups.length === 2 && suffix && !fraction && whole.includes(',')) [whole, fraction] = groups;
        else if (!thousands) return null;
        else whole = groups.join('');
    }
    if (fraction && !suffix) return null;
    const scale = 10n ** BigInt(fraction.length);
    const scaled = (BigInt(whole) * scale + BigInt(fraction || '0')) * (suffix ? MULTIPLIERS[suffix] : 1n);
    if (scaled % scale !== 0n) return null;
    const value = scaled / scale;
    if (value <= 0n || value > BigInt(Math.min(max, Number.MAX_SAFE_INTEGER))) return null;
    return Number(value);
}

/** Whether `text` was meant as an amount (it starts with a digit), whether or not parseAmount can read it. */
export function looksLikeAmount(text) {
    return /^\d[\d.,٬٫]*\s*[a-zء-ي]*$/iu.test(toAsciiDigits(text).trim());
}

/** The typed words with an Arabic suffix word glued to the number before it (`5 الف` → `5الف`). */
export function joinAmountWords(words) {
    const out = [];
    for (const word of words) {
        const previous = out[out.length - 1];
        if (SUFFIX_WORDS.has(word) && previous !== undefined && /^\d[\d.,٬٫]*$/u.test(toAsciiDigits(previous))) out[out.length - 1] = `${previous}${word}`;
        else out.push(word);
    }
    return out;
}
