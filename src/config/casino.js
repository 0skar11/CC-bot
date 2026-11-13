// casino.js — the CC casino (الكازينو), played with a CC bet. Solo games: mines, coinflip, slots, dice and chicken.
// Group games, one shared round per room: roulette and rocket (a group crash). Crash is the rocket: the typed
// `كراش` / `crash` run the same group rocket as `صاروخ` / `rocket` (src/config/commands/commandAliases.js), and
// there is no solo crash any more (its crash point, below, is the rocket's).
// Run by src/services/cc/casinoService.js (the solo games' money and rules, and the crash point),
// casinoUi.js (their embeds and buttons), casinoSessions.js (the live mines and chicken games), casinoGroupService.js,
// casinoGroupSessions.js and casinoGroupUi.js (the group rounds) and gamesMenuUi.js (the `العاب` / `games` menu);
// the commands are src/commands/Games/casino.js and games.js. Everything a member reads is in Arabic or English,
// following the command (src/services/cc/lang.js); a round's shared message stays in its opener's language.
//
// Every game keeps a small house edge, written into its payouts (tests/casino.test.js and
// tests/casinoGames.test.js check the math):
//   mines     3%: cashing out after k safe tiles pays 97% of the fair odds of opening them,
//                 bet × 0.97 × C(9, k) / C(9 − mines, k). Opening k safe tiles happens with probability
//                 C(9 − mines, k) / C(9, k), so every way of playing returns 97% of the bet on average.
//                 Cashing out before opening a tile (or an untouched board timing out) gives the bet back.
//   coinflip  3%: a win (probability 1/2) pays ×1.94 instead of the fair ×2.
//   slots     4%: three reels of 5 equally likely symbols, 125 spins in all. Three of a kind (5 spins) pays
//                 the table below, 60 in total; two of a kind (60 spins) gives the bet back, 60; the other
//                 60 spins lose. (60 + 60) / 125 = 0.96 of the bet comes back on average.
//   crash     3%: the rocket's crash point is ×0.97 × N / (N − u) for u drawn uniformly from 0 … N − 1 (N = 2^32,
//                 crypto.randomInt), kept in hundredths rounded down. It reaches ×m (any m from ×0.97) with
//                 probability ⌊0.97 × N / m⌋ / N, just under 0.97 / m. A target ×m pays bet × m when the crash
//                 point reaches it, so every target returns 97% of the bet (less under 1 / N). About 4% of
//                 rockets crash at ×1.00 straight away. (`crash` is no game of its own: see rocket.)
//   dice      3%: the dice lands on 0.00–99.99 (10,000 equally likely rolls). `تحت 30` wins below 30.00 (a 30%
//                 chance), `فوق 70` wins from 70.00 up (also 30%). A win with a c% chance pays bet × 97 / c, so
//                 it returns c% × 97 / c = 97% whatever the number.
//   chicken   3%: the chicken crosses a road of 20 lanes, one lane per press of its button. It makes each lane with
//                 probability 4/5 (a car gets it with 1/5), and cashing out after k lanes pays 97% of the fair odds
//                 of getting that far, bet × 0.97 × (5/4)^k = ⌊bet × 97 × 5^k / (100 × 4^k)⌋, worked out in whole
//                 numbers (BigInt, exact at the bet ceiling). Getting past k lanes happens with probability (4/5)^k,
//                 so every way of playing returns 97% of the bet on average. Cashing out before the first lane (or a
//                 chicken left alone that long) gives the bet back; making the 20th lane cashes out by itself at
//                 ×84.13. How far the chicken gets is drawn once, when the game starts: u uniform in 0 … 5^20 − 1
//                 (crypto.randomInt), and it makes lane k when u < 4^k × 5^(20 − k), i.e. for (4/5)^k of the draws,
//                 so each lane is made after the one before with probability exactly 4/5. The lane it dies on (or
//                 none) is saved with the game and never shown before the game ends.
//   roulette  2.70%: a single zero, 37 equally likely pockets. Red or black (18 pockets each) pays ×2 and one
//                 number (0 is the green one) pays ×36: 18 × 2 / 37 = 36 / 37 = 97.30% back for every bet.
//   rocket    3%: the group crash (also typed `كراش` / `crash`), with crash's crash point drawn once for the whole
//                 round. An automatic cash-out at ×m (`صاروخ 100 2`, `crash 100 2`) is a crash target exactly (97%).
//                 A cash-out by button pays the multiplier at the click, rounded down to ×0.01, and only counts
//                 while the crash point is still above it, which only adds to the edge. The rocket stops at ×100
//                 at the latest and pays ×100 to everybody still on board (the same as a ×100 target, 97%).
// Payouts are rounded down to whole CC, so rounding only ever adds to the edge, by under 1 CC per paid game:
// under 1 point from 100 CC bets, more on the smallest ones (a 10 CC coinflip win pays 19, a 5% edge; 10 CC
// with 1 mine cashed out after one cell pays back just the 10, an 11% edge; 10 CC of chicken cashed out after one
// lane pays 12, a 4% edge).
//
// All-in (ALL_IN_WORDS below): a typed `كل` / `all`... where the bet goes (`صاروخ كل`, `مينز كل 3`, `نرد كل فوق 70`,
// and the amount of a group round's join form) bets the member's whole balance, up to CASINO.maxBet. The amount is
// worked out inside the save that takes the bet, on the balance that save reads, never before it; under
// CASINO.minBet the game is refused like a bet the balance can't cover. Payouts and edges don't change.

import { CASINO_BET_LIMITS, casinoChannelIds, casinoMaxBet } from './runtime.js';
import { BOURSE_GUILD_NOTICE } from './bourseGuild.js';

export const CASINO_COMMAND = 'casino';
export const CASINO_BUTTON_PREFIX = 'casino';
// `/games` and the typed `العاب`: the menu of every game (src/commands/Games/games.js).
export const GAMES_COMMAND = 'games';
// The `/casino` games played by one member against the house, and the ones played by the whole room.
export const SOLO_GAMES = ['mines', 'coinflip', 'slots', 'dice', 'chicken', 'blackjack'];
export const GROUP_GAMES = ['roulette', 'rocket'];

export const CASINO = {
    minBet: CASINO_BET_LIMITS.min,
    // Open by default: a bet is only limited by the member's balance (CASINO_MAX_BET sets a cap when you want one).
    maxBet: casinoMaxBet,
    unlimited: casinoMaxBet >= CASINO_BET_LIMITS.ceiling,
    // A short pause between two games started by the same member (spam guard, not a money guard).
    cooldownMs: 3_000,
    // A mines board (or a chicken) nobody touched for this long cashes out by itself at its current multiplier.
    idleMs: 60_000,
    // When saving that cash-out (or a group round) fails (database down), it is tried again after this long.
    idleRetryMs: 15_000,
    mines: { cells: 9, columns: 3, min: 1, max: 8, default: 3, edgePercent: 3 },
    coinflip: { payoutPercent: 194 },
    slots: {
        symbols: ['🍒', '🍋', '🍇', '💎', '🌀'],
        // Three of a kind pays the bet times this; two of a kind gives the bet back (`pair`).
        triple: { '🍒': 4, '🍋': 6, '🍇': 10, '💎': 15, '🌀': 25 },
        pair: 1,
    },
    // The rocket's crash point and its automatic cash-out targets (crash is played as the group rocket).
    crash: {
        edgePercent: 3,
        // The crash point comes from this many equally likely draws (crypto.randomInt allows up to 2^48).
        draws: 2 ** 32,
        // Targets in hundredths (×1.01 to ×100). maxTarget is also the rocket's top: it keeps every payout far
        // inside Number.MAX_SAFE_INTEGER at the bet ceiling. defaultTarget and frames only serve the crash
        // engine kept in casinoService.js (playCrash, crashFrames) for its tests; no command plays it.
        minTarget: 101,
        maxTarget: 10_000,
        defaultTarget: 200,
        frames: 5,
    },
    dice: {
        edgePercent: 3,
        // Rolls 0–9,999, shown as 0.00–99.99.
        faces: 10_000,
        // The win chance of `تحت N` is N%, of `فوق N` (100 − N)%; it must be in this range (×97 to ×1.02).
        minChance: 1,
        maxChance: 95,
        // `نرد 100` alone is `تحت 50`.
        defaultNumber: 50,
    },
    chicken: {
        edgePercent: 3,
        // The chicken makes each lane with probability survive / outOf (4/5): a car gets it with the rest (1/5).
        survive: 4,
        outOf: 5,
        // The road has this many lanes: making the last one cashes out by itself (×84.13). outOf ** maxSteps is the
        // number of equally likely draws a game starts with (5^20), and must stay under crypto.randomInt's 2^48.
        maxSteps: 20,
    },
    blackjack: {
        dealerStandsOn: 17,
        naturalPayout: 250,
        winPayout: 200,
        edgePercent: 1.5,
    },
    roulette: {
        pockets: 37,
        red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
        // A winning colour pays the bet times colorPays, a winning number (0 included) numberPays.
        colorPays: 2,
        numberPays: 36,
        // The first bet opens a round that takes bets for joinMs; then the wheel spins (spinMs) once for everybody.
        joinMs: 20_000,
        spinMs: 3_000,
        // Most bets in one round, and per member in one round.
        maxBets: 40,
        maxBetsPerMember: 5,
    },
    rocket: {
        // The first rider opens a round that boards for joinMs; then the rocket takes off for everybody.
        joinMs: 15_000,
        // The multiplier doubles every doubleMs while it climbs: ×2 at 7 s, ×10 at 23 s, ×100 at 46.5 s.
        doubleMs: 7_000,
        // The live message is edited once per tick (Discord's edit rate limit), not on every change.
        tickMs: 1_250,
        // A cash-out click that reached the bot before the crash still counts when it is handled later; the
        // riders who are still on board lose only this long after the crash.
        graceMs: 2_000,
        // A cash-out click is answered with one message as soon as it is done; only one still running after
        // ackMs is acknowledged first and answered after (Discord gives a click 3 s).
        ackMs: 1_500,
        maxPlayers: 25,
    },
    // How often a round's message is edited at most while people join it.
    groupRenderMs: 1_500,
};

// The embed colours (casinoUi.js, casinoGroupUi.js): each game has its own while it runs (a mines board, a chicken,
// the roulette table), and a result takes its outcome's: green when it paid more than the bet, red when it paid
// less, gold when it gave the bet back. The spun roulette takes the colour of its pocket. The rocket keeps the CC gold.
export const CASINO_COLORS = {
    mines: 0x1abc9c,
    coinflip: 0xf1c40f,
    slots: 0x9b59b6,
    dice: 0x3498db,
    chicken: 0xe67e22,
    blackjack: 0x1f8b4c,
    roulette: 0x0b6e4f,
    rocket: 0xc9a227,
    win: 0x2ecc71,
    loss: 0xe74c3c,
    push: 0xc9a227,
    pockets: { red: 0xe74c3c, black: 0x4e5058, green: 0x2ecc71 },
};

/** 'win', 'loss' or 'push' for a game that took `bet` and paid `payout`. */
export const outcomeOf = (bet, payout) => (payout > bet ? 'win' : (payout < bet ? 'loss' : 'push'));

/** A game's own colour, or its outcome's ('win', 'loss', 'push') when one is given. */
export function casinoColor(game, outcome = null) {
    if (outcome && Object.hasOwn(CASINO_COLORS, outcome) && typeof CASINO_COLORS[outcome] === 'number') return CASINO_COLORS[outcome];
    return typeof CASINO_COLORS[game] === 'number' ? CASINO_COLORS[game] : CASINO_COLORS.rocket;
}

// `عملة 100 ملك`: the words for each side of the coin.
export const COIN_SIDES = {
    heads: { name: 'ملك', emoji: '👑', words: ['heads', 'head', 'h', 'ملك'] },
    tails: { name: 'كتابة', emoji: '✍️', words: ['tails', 'tail', 't', 'كتابة', 'كتابه'] },
};

// `نرد 100 تحت 30`, `نرد 100 فوق 70`.
export const DICE_DIRECTIONS = {
    under: { name: 'تحت', emoji: '⬇️', words: ['under', 'u', 'تحت', 'اقل', 'أقل'] },
    over: { name: 'فوق', emoji: '⬆️', words: ['over', 'o', 'فوق', 'اكتر', 'أكتر', 'اكثر', 'أكثر'] },
};

// `روليت 100 احمر`: the colours (green is the 0), or a number 0–36.
export const ROULETTE_COLORS = {
    red: { name: 'أحمر', emoji: '🔴', words: ['red', 'r', 'احمر', 'أحمر', 'الاحمر', 'الأحمر', 'حمرا', 'حمراء'] },
    black: { name: 'أسود', emoji: '⚫', words: ['black', 'b', 'اسود', 'أسود', 'الاسود', 'الأسود', 'سودا', 'سوداء'] },
    green: { name: 'أخضر', emoji: '🟢', words: ['green', 'g', 'zero', 'اخضر', 'أخضر', 'الاخضر', 'الأخضر', 'صفر'] },
};

// `صاروخ كل`, `rocket all`, `مينز كل 3`, `عملة كل ملك`: the words that bet everything (all-in) in place of the bet,
// typed in every game and in the amount of a group round's join form. The slash commands keep their whole-number
// `bet` (no all-in there). The amount is the balance up to CASINO.maxBet, worked out by the save that takes it
// (casinoService.js betFor, casinoGroupService.js joinRound).
export const ALL_IN_WORDS = new Set(['كل', 'الكل', 'كلو', 'all', 'allin', 'all-in', 'max']);
/** The bet readGameArgs and the typed commands give for an all-in word. Never saved: a game saves the real number. */
export const ALL_IN = 'all';

const wordOf = (word) => String(word ?? '').trim().toLowerCase();
const isWhole = (word) => /^\d+$/u.test(String(word));

/** Whether `word` is an all-in word (ALL_IN_WORDS: `كل`, `الكل`, `كلو`, `all`, `allin`, `all-in`, `max`), in any case, trimmed. */
export function isAllInWord(word) {
    return ALL_IN_WORDS.has(wordOf(word));
}

/** A typed bet: a whole number, ALL_IN for an all-in word, else null. */
export function betWord(word) {
    if (isWhole(word)) return Number(word);
    return isAllInWord(word) ? ALL_IN : null;
}

/** `heads` or `tails` for a typed side (`ملك`, `كتابة`, `h`, `tails`...), else null. */
export function coinSide(word) {
    const text = wordOf(word);
    return Object.keys(COIN_SIDES).find((side) => COIN_SIDES[side].words.includes(text)) || null;
}

/** `under` or `over` for a typed direction (`تحت`, `فوق`, `under`...), else null. */
export function diceDirection(word) {
    const text = wordOf(word);
    return Object.keys(DICE_DIRECTIONS).find((side) => DICE_DIRECTIONS[side].words.includes(text)) || null;
}

/** A roulette bet: 'red', 'black' or a pocket number 0–36 (green is 0), else null. */
export function rouletteChoice(word) {
    const text = wordOf(word);
    if (isWhole(text)) {
        const pocket = Number(text);
        return pocket < CASINO.roulette.pockets ? pocket : null;
    }
    const color = Object.keys(ROULETTE_COLORS).find((name) => ROULETTE_COLORS[name].words.includes(text));
    if (!color) return null;
    return color === 'green' ? 0 : color;
}

// `2.5`, `2,5`, `x2.5`, `×2.5`, `2.5x`: a multiplier, kept in hundredths (rounded down past two decimals).
const MULTIPLIER = /^[x×]?(\d{1,6})(?:[.,](\d+))?[x×]?$/u;

/** The hundredths of a typed multiplier (`2.5` → 250), or null when the word isn't one. */
export function multiplierHundredths(word) {
    const match = MULTIPLIER.exec(wordOf(word));
    if (!match) return null;
    const [, whole, fraction = ''] = match;
    return Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
}

/** A slash `target` (2.5) in hundredths (250), rounded down; `fallback` when it wasn't given. */
export function targetHundredths(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    return Number.isFinite(value) ? Math.floor(value * 100 + 1e-9) : NaN;
}

/**
 * The typed words after a new game's name, the bet first: `صاروخ 100 [2]` / `كراش 100 2.5` (the rocket, with an
 * optional automatic cash-out multiplier), `نرد 100 [فوق|تحت] [70]` (in any order), `روليت 100 احمر` /
 * `روليت 100 17` (or the colour first) and `فرخة 100` (the bet alone); the English words read the same way
 * (`rocket 100 2`, `dice 100 over 70`, `chicken 100`). An all-in word stands where the bet does (`صاروخ كل 2`,
 * `نرد كل فوق 70`, `روليت كل احمر` or `روليت احمر كل`, `فرخة كل`) and reads as the bet ALL_IN.
 * Returns `{ values }` (the numbers are checked by the game) or `{ error: 'usage' }` when it isn't a game command.
 */
export function readGameArgs(game, words) {
    const rest = words.map(String);
    const usage = { error: 'usage' };
    if (!rest.length) return usage;
    const bet = betWord(rest[0]);
    if (game === 'chicken' || game === 'blackjack') return rest.length === 1 && bet !== null ? { values: { bet } } : usage;
    if (game === 'crash' || game === 'rocket') {
        if (rest.length > 2 || bet === null) return usage;
        const target = rest.length === 2 ? multiplierHundredths(rest[1]) : null;
        if (rest.length === 2 && target === null) return usage;
        return { values: { bet, target } };
    }
    if (game === 'dice') {
        if (rest.length > 3 || bet === null) return usage;
        let direction = null;
        let number = null;
        for (const word of rest.slice(1)) {
            if (isWhole(word) && number === null) number = Number(word);
            else if (diceDirection(word) && direction === null) direction = diceDirection(word);
            else return usage;
        }
        return { values: { bet, direction, number } };
    }
    if (game === 'roulette') {
        if (rest.length > 2) return usage;
        // The bet is the all-in word wherever it is; else the number first, or the colour first and then the number.
        const allIn = rest.findIndex(isAllInWord);
        const at = allIn >= 0 ? allIn : (isWhole(rest[0]) ? 0 : (rest.length === 2 && isWhole(rest[1]) ? 1 : -1));
        if (at < 0) return usage;
        if (rest.length === 1) return { values: { bet: betWord(rest[0]), choice: null } };
        const word = rest[1 - at];
        // A word that is neither a colour nor a number is chat, not a bet (a number above 36 is a bad bet).
        if (!isWhole(word) && rouletteChoice(word) === null) return usage;
        return { values: { bet: betWord(rest[at]), choice: word } };
    }
    return usage;
}

/** The answer to a casino command in a server the bot doesn't serve, in `lang` ('ar' or 'en'). */
export function casinoGuildNotice(lang = 'ar') {
    return lang === 'en' ? '❌ This command is not available here.' : BOURSE_GUILD_NOTICE;
}

/** The answer to a casino command or button outside the casino rooms, in `lang` ('ar' or 'en'). */
export function casinoChannelNotice(lang = 'ar') {
    if (!casinoChannelIds.size) return casinoGuildNotice(lang);
    const rooms = [...casinoChannelIds].map((id) => `<#${id}>`).join(' ');
    return lang === 'en' ? `🎰 The casino is only open in: ${rooms}` : `🎰 الكازينو متاح بس في: ${rooms}`;
}
