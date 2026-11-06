// casino.js — the CC casino (الكازينو): mines, coinflip and slots, played with a CC bet.
// Run by src/services/cc/casinoService.js (money and rules), casinoUi.js (embeds and buttons) and
// casinoSessions.js (the live mines boards); the command is src/commands/Games/casino.js.
//
// Every game keeps a small house edge, written into its payouts (tests/casino.test.js checks the math):
//   mines     3%: cashing out after k safe tiles pays 97% of the fair odds of opening them,
//                 bet × 0.97 × C(9, k) / C(9 − mines, k). Opening k safe tiles happens with probability
//                 C(9 − mines, k) / C(9, k), so every way of playing returns 97% of the bet on average.
//                 Cashing out before opening a tile (or an untouched board timing out) gives the bet back.
//   coinflip  3%: a win (probability 1/2) pays ×1.94 instead of the fair ×2.
//   slots     4%: three reels of 5 equally likely symbols, 125 spins in all. Three of a kind (5 spins) pays
//                 the table below, 60 in total; two of a kind (60 spins) gives the bet back, 60; the other
//                 60 spins lose. (60 + 60) / 125 = 0.96 of the bet comes back on average.
// Payouts are rounded down to whole CC, so rounding only ever adds to the edge, by under 1 CC per paid game:
// under 1 point from 100 CC bets, more on the smallest ones (a 10 CC coinflip win pays 19, a 5% edge; 10 CC
// with 1 mine cashed out after one cell pays back just the 10, an 11% edge).

import { CASINO_BET_LIMITS, casinoChannelIds, casinoMaxBet } from './runtime.js';
import { BOURSE_GUILD_NOTICE } from './bourseGuild.js';

export const CASINO_COMMAND = 'casino';
export const CASINO_BUTTON_PREFIX = 'casino';

export const CASINO = {
    minBet: CASINO_BET_LIMITS.min,
    // CASINO_MAX_BET (default 50,000); a bet is also never more than the member's balance.
    maxBet: casinoMaxBet,
    // A short pause between two games started by the same member (spam guard, not a money guard).
    cooldownMs: 3_000,
    // A mines board nobody touched for this long cashes out by itself at its current multiplier.
    idleMs: 60_000,
    // When saving that cash-out fails (database down), it is tried again after this long.
    idleRetryMs: 15_000,
    mines: { cells: 9, columns: 3, min: 1, max: 8, default: 3, edgePercent: 3 },
    coinflip: { payoutPercent: 194 },
    slots: {
        symbols: ['🍒', '🍋', '🍇', '💎', '🌀'],
        // Three of a kind pays the bet times this; two of a kind gives the bet back (`pair`).
        triple: { '🍒': 4, '🍋': 6, '🍇': 10, '💎': 15, '🌀': 25 },
        pair: 1,
    },
};

// `عملة 100 ملك`: the words for each side of the coin.
export const COIN_SIDES = {
    heads: { name: 'ملك', emoji: '👑', words: ['heads', 'head', 'h', 'ملك'] },
    tails: { name: 'كتابة', emoji: '✍️', words: ['tails', 'tail', 't', 'كتابة', 'كتابه'] },
};

/** `heads` or `tails` for a typed side (`ملك`, `كتابة`, `h`, `tails`...), else null. */
export function coinSide(word) {
    const text = String(word || '').trim().toLowerCase();
    return Object.keys(COIN_SIDES).find((side) => COIN_SIDES[side].words.includes(text)) || null;
}

/** The answer to a casino command or button outside the casino rooms. */
export function casinoChannelNotice() {
    if (!casinoChannelIds.size) return BOURSE_GUILD_NOTICE;
    return `🎰 الكازينو متاح بس في: ${[...casinoChannelIds].map((id) => `<#${id}>`).join(' ')}`;
}
