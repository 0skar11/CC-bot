// casinoService.js — the CC casino's solo games, rules and money: mines, coinflip, slots, dice and chicken, and the
// crash point the group rocket flies with (casinoGroupService.js). The payouts and the house edge are explained in
// src/config/casino.js; the embeds are casinoUi.js and the live mines and chicken games (timeout, restart)
// casinoSessions.js. The group games are casinoGroupService.js. playCrash (a crash bet against the house) is
// kept as the tested reference of the crash math only: no command plays it (`كراش` / `crash` are the rocket).
//
// Every balance change goes through updateCCState (ccService.js), one save per step under the member's
// lock: the bet is taken in the same save that starts a game and the payout added in the same save that
// ends it, so a bet can't be spent twice, a game can't be paid twice and nothing is left half done.
// Coinflip, slots and dice are over in that one save. A mines or chicken game is kept in the member's economy
// record until it ends, so a restart or a crash never loses the bet. The two share one slot (a member plays one
// game at a time), told apart by `game`:
//   ccCasino: { id, game: 'mines', bet, mines: [cells], picks: [cells], guildId, channelId, messageId, lang,
//               startedAt, lastActionAt }
//   ccCasino: { id, game: 'chicken', bet, steps, deathStep, guildId, channelId, messageId, lang, startedAt,
//               lastActionAt }
// `lang` ('ar' | 'en', text only) is the language of the command that opened the game: every later edit of
// it (clicks, the timeout, the restart check) stays in that language. `allIn: true` (text only, only on a game bet
// all-in) puts the all-in tag on its board; `bet` is always the real number taken.
// All-in: a game asked with the bet ALL_IN (a typed `كل` / `all`, src/config/casino.js) bets the balance up to
// CASINO.maxBet, worked out by betFor inside the same updateCCState save that takes it (after an idle game settled
// in that save is paid), so it is the balance of that very save: never stale, never more than the member has.
// Under CASINO.minBet it is refused as no_cc and nothing is taken.
// `mines` are the cells (0–8, row by row) hiding a mine, drawn with crypto.randomInt when the game starts
// and never shown before it ends; `picks` are the safe cells opened, in order. `steps` are the lanes the chicken
// crossed; `deathStep` is the lane a car gets it on (1–20), or null when it would cross the whole road, drawn
// with crypto.randomInt when the game starts and never shown before it ends. A button carries its game `id`,
// so a button of an ended or older game changes nothing. Every helper that reads or ends the saved game goes
// through SAVED_GAMES (readSavedGame, endGame), so a chicken is never mistaken for a damaged mines board.
// Totals: ccStats.spent += bet and ccStats.earned += payout, plus per member
//   ccCasinoStats: { played, won, lost, wagered, paidOut } (a payout equal to the bet is neither won nor lost).

import { randomBytes, randomInt as cryptoRandomInt } from 'node:crypto';
import { ALL_IN, CASINO, COIN_SIDES, isPercentAsk } from '../../config/casino.js';
import { CASINO_BET_LIMITS } from '../../config/runtime.js';
import { updateCCState } from './ccService.js';
import { readLang } from './lang.js';

/** A uniformly random whole number in [0, max), from crypto.randomInt. Tests pass their own `randomInt`. */
export const secureRandomInt = (max) => cryptoRandomInt(max);

/** One draw from 0 … max − 1, checked: a bad random source stops the game instead of paying from it. */
export function draw(randomInt, max) {
    const value = randomInt(max);
    if (!Number.isSafeInteger(value) || value < 0 || value >= max) throw new Error('Invalid casino random draw');
    return value;
}

/** Whether `bet` is a whole number of CC from CASINO.minBet to CASINO.maxBet (not NaN, a fraction or negative). */
export function isValidBet(bet, settings = CASINO) {
    return Number.isSafeInteger(bet) && bet >= settings.minBet && bet <= settings.maxBet;
}

/** Whether a game may be asked for `bet`: a valid bet, or ALL_IN (whose amount only the save that takes it knows). */
export function isBetRequest(bet, settings = CASINO) {
    return bet === ALL_IN || isPercentAsk(bet) || isValidBet(bet, settings);
}

/**
 * What an all-in bets from a balance of `cc`: all of it, up to CASINO.maxBet (the bet ceiling when the casino has
 * no cap), or null when that is under CASINO.minBet (or isn't a whole number of CC).
 */
export function allInBet(cc, settings = CASINO) {
    const bet = Math.min(cc, settings.maxBet);
    return isValidBet(bet, settings) ? bet : null;
}

/**
 * The bet a save takes when `asked` was asked for: `asked` itself, or for ALL_IN allInBet of the balance this save
 * holds (`state`, read under the member's lock). Only ever called inside that save. null: an all-in that can't play.
 */
/** A share of the balance as a bet: that percent of `cc` (rounded down), up to CASINO.maxBet, or null when under CASINO.minBet. */
export function shareBet(cc, percent) {
    const bet = Math.min(Math.floor((Number(cc) * percent) / 100), CASINO.maxBet || Infinity);
    return Number.isSafeInteger(bet) && bet >= CASINO.minBet ? bet : null;
}

export function betFor(state, asked) {
    if (isPercentAsk(asked)) return shareBet(state.cc, Number(asked.slice(4)));
    return asked === ALL_IN ? allInBet(state.cc) : asked;
}

/** `{ allIn: true }` for what was asked all-in (the saved game, the stake, the result), else nothing. */
export const allInMark = (asked) => (asked === ALL_IN ? { allIn: true } : {});

export function isValidMineCount(count) {
    return Number.isSafeInteger(count) && count >= CASINO.mines.min && count <= CASINO.mines.max;
}

/** n choose k, exact for the 9 cells of the board. */
export function choose(n, k) {
    if (!Number.isSafeInteger(k) || k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
    return result;
}

// Whole numbers divided and rounded down, exactly (every number here stays far below 2^53).
export const divideDown = (top, bottom) => (top - (top % bottom)) / bottom;
const safeCells = (mines) => CASINO.mines.cells - mines;

/**
 * What cashing out a mines board pays after `picks` safe cells with `mines` mines: the bet when nothing
 * was opened, else bet × (100 − edge)% × C(9, picks) / C(9 − mines, picks), rounded down.
 */
export function minesPayout(bet, mines, picks) {
    if (!Number.isSafeInteger(picks) || picks < 0 || picks > safeCells(mines)) throw new Error('Invalid mines picks');
    if (picks === 0) return bet;
    const { cells, edgePercent } = CASINO.mines;
    return divideDown(bet * (100 - edgePercent) * choose(cells, picks), 100 * choose(cells - mines, picks));
}

/** The same multiplier in hundredths, rounded down, for the board (`×1.09` is 109; 100 before the first pick). */
export function minesMultiplierHundredths(mines, picks) {
    if (picks === 0) return 100;
    const { cells, edgePercent } = CASINO.mines;
    return divideDown((100 - edgePercent) * choose(cells, picks), choose(cells - mines, picks));
}

/** A coinflip win: the bet × payoutPercent%, rounded down. */
export function coinflipPayout(bet) {
    return divideDown(bet * CASINO.coinflip.payoutPercent, 100);
}

/** Three reels and a bet: `{ kind: 'triple' | 'pair' | 'none', symbol, multiplier, payout }`. */
export function slotsResult(reels, bet) {
    const { triple, pair } = CASINO.slots;
    const [a, b, c] = reels;
    if (a === b && b === c) return { kind: 'triple', symbol: a, multiplier: triple[a], payout: bet * triple[a] };
    if (a === b || a === c) return { kind: 'pair', symbol: a, multiplier: pair, payout: bet * pair };
    if (b === c) return { kind: 'pair', symbol: b, multiplier: pair, payout: bet * pair };
    return { kind: 'none', symbol: null, multiplier: 0, payout: 0 };
}

export function spinReels(randomInt = secureRandomInt) {
    const { symbols } = CASINO.slots;
    return Array.from({ length: 3 }, () => symbols[draw(randomInt, symbols.length)]);
}

/** `count` different cells of the board (a partial Fisher–Yates shuffle), sorted. */
export function placeMines(count, randomInt = secureRandomInt) {
    const cells = Array.from({ length: CASINO.mines.cells }, (_, cell) => cell);
    for (let i = 0; i < count; i += 1) {
        const j = i + draw(randomInt, cells.length - i);
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells.slice(0, count).sort((x, y) => x - y);
}

const isCellList = (list) => Array.isArray(list)
    && new Set(list).size === list.length
    && list.every((cell) => Number.isSafeInteger(cell) && cell >= 0 && cell < CASINO.mines.cells);

/** The saved mines game (`ccCasino`), or null when there is none or it is damaged. */
export function readMinesGame(raw) {
    if (!raw || typeof raw !== 'object' || raw.game !== 'mines' || typeof raw.id !== 'string' || !raw.id) return null;
    if (!Number.isSafeInteger(raw.bet) || raw.bet < 1 || raw.bet > CASINO_BET_LIMITS.ceiling) return null;
    if (!isCellList(raw.mines) || raw.mines.length < CASINO.mines.min || raw.mines.length > CASINO.mines.max) return null;
    if (!isCellList(raw.picks) || raw.picks.some((cell) => raw.mines.includes(cell))) return null;
    if (!Number.isFinite(raw.lastActionAt)) return null;
    return raw;
}

/**
 * The saved chicken game (`ccCasino`), or null when there is none or it is damaged: `steps` lanes crossed (0 up to
 * the last lane) and a `deathStep` still ahead of the chicken (or null: it crosses the whole road).
 */
export function readChickenGame(raw) {
    if (!raw || typeof raw !== 'object' || raw.game !== 'chicken' || typeof raw.id !== 'string' || !raw.id) return null;
    if (!Number.isSafeInteger(raw.bet) || raw.bet < 1 || raw.bet > CASINO_BET_LIMITS.ceiling) return null;
    const { maxSteps } = CASINO.chicken;
    if (!Number.isSafeInteger(raw.steps) || raw.steps < 0 || raw.steps > maxSteps) return null;
    if (raw.deathStep !== null && !(Number.isSafeInteger(raw.deathStep) && raw.deathStep > raw.steps && raw.deathStep <= maxSteps)) return null;
    if (!Number.isFinite(raw.lastActionAt)) return null;
    return raw;
}

// The games saved in `ccCasino` while they run, by their `game`: how to read one and what ending it (cashing out,
// the timeout, the restart check) pays. A loss pays nothing whatever the game.
const SAVED_GAMES = {
    mines: { read: readMinesGame, payout: (game) => minesPayout(game.bet, game.mines.length, game.picks.length) },
    chicken: { read: readChickenGame, payout: (game) => chickenPayout(game.bet, game.steps) },
    blackjack: { read: readBlackjackGame, payout: (game, outcome) => blackjackPayout(game.bet, outcome) },
};

/** The kind of a saved game ('mines' or 'chicken'), from its `game`; 'mines' when it can't be told (old or damaged). */
export function savedGameKind(raw) {
    const kind = raw && typeof raw === 'object' ? raw.game : null;
    return typeof kind === 'string' && Object.hasOwn(SAVED_GAMES, kind) ? kind : 'mines';
}

/** The saved game (`ccCasino`) whatever it is (mines or chicken), or null when there is none or it is damaged. */
export function readSavedGame(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.game !== 'string' || !Object.hasOwn(SAVED_GAMES, raw.game)) return null;
    return SAVED_GAMES[raw.game].read(raw);
}

const add = (stats, key, amount) => { stats[key] = (Number.isSafeInteger(stats[key]) ? stats[key] : 0) + amount; };

/** Takes `bet` from the balance (ccStats.spent), in the save that starts the game. */
export function takeBet(state, bet) {
    state.cc -= bet;
    add(state.stats, 'spent', bet);
}

/** Gives back a bet whose game never happened (a group round cut by a restart): as if it was never taken. */
export function returnBet(state, bet) {
    const next = state.cc + bet;
    if (!Number.isSafeInteger(next)) throw new Error('CC balance overflow');
    state.cc = next;
    add(state.stats, 'spent', -bet);
}

/** Pays `payout` for a finished `bet`: the balance, ccStats and ccCasinoStats, all in the same save. */
export function payOut(state, record, bet, payout) {
    if (!Number.isSafeInteger(payout) || payout < 0) throw new Error('Invalid casino payout');
    const next = state.cc + payout;
    if (!Number.isSafeInteger(next)) throw new Error('CC balance overflow');
    state.cc = next;
    if (payout) add(state.stats, 'earned', payout);
    const saved = record.ccCasinoStats && typeof record.ccCasinoStats === 'object' && !Array.isArray(record.ccCasinoStats) ? record.ccCasinoStats : {};
    const stats = { played: 0, won: 0, lost: 0, wagered: 0, paidOut: 0, ...saved };
    add(stats, 'played', 1);
    if (payout > bet) add(stats, 'won', 1);
    if (payout < bet) add(stats, 'lost', 1);
    add(stats, 'wagered', bet);
    add(stats, 'paidOut', payout);
    record.ccCasinoStats = stats;
}

/**
 * Ends the record's saved game (mines or chicken) as `outcome` and pays it: nothing for 'lost' (a mine, `hit` is
 * its cell; or a car), else what cashing it out pays now ('cashout', 'cleared', 'crossed' or 'timeout': the
 * multiplier of the cells opened or the lanes crossed, the bet back with none). A damaged game ('broken') gives
 * back its bet when that can still be read; `kind` says which game it was, as far as it can be told.
 * Returns `{ outcome, game, bet, payout }`.
 */
function endGame(state, record, outcome, hit = null) {
    const raw = record.ccCasino;
    const game = readSavedGame(raw);
    delete record.ccCasino;
    if (!game) {
        const bet = Number.isSafeInteger(raw?.bet) && raw.bet > 0 && raw.bet <= CASINO_BET_LIMITS.ceiling ? raw.bet : 0;
        if (bet) payOut(state, record, bet, bet);
        return { outcome: 'broken', game: null, bet, payout: bet, channelId: typeof raw?.channelId === 'string' ? raw.channelId : null, kind: savedGameKind(raw) };
    }
    // An idle (or restart-settled) blackjack hand stands: the dealer plays it out and it wins, pushes or loses like
    // any other hand. Walking away is never a free refund (the player has seen the cards).
    if (game.game === 'blackjack' && outcome === 'timeout') outcome = standOutcome(game);
    const payout = outcome === 'lost' ? 0 : SAVED_GAMES[game.game].payout(game, outcome);
    payOut(state, record, game.bet, payout);
    return { outcome, game: hit === null ? game : { ...game, hit }, bet: game.bet, payout };
}

/** Before a new game: a saved game left alone past the timeout (a missed timer) or a damaged one is settled first. */
function endIdleGame(state, record, now, idleMs) {
    if (!record.ccCasino) return null;
    const game = readSavedGame(record.ccCasino);
    if (game && now - game.lastActionAt < idleMs) return null;
    return endGame(state, record, 'timeout');
}

/**
 * Why a new game can't start (another game running, mines or chicken, or the balance under the bet, or an all-in
 * under the smallest bet: `bet` null), else null.
 */
function refuseStart(state, record, bet) {
    if (record.ccCasino) return { ok: false, reason: 'active', game: readSavedGame(record.ccCasino) };
    if (bet === null || state.cc < bet) return { ok: false, reason: 'no_cc', balance: state.cc };
    return null;
}

/**
 * Starts a mines board: takes the bet and hides `mines` mines in the same save (`lang` is the board's language).
 * `bet` may be ALL_IN (the balance up to the max bet, read in that save). Returns `{ ok: true, game, before,
 * balance, previous }` (`previous` is an idle board settled first, or null; an all-in game has `allIn`) or
 * `{ ok: false, reason }` with reason one of: bad_bet, bad_mines, active (with `game`), no_cc (with `balance`).
 */
export async function startMines(client, guildId, userId, { bet: asked, mines = CASINO.mines.default, channelId = null, lang = null } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    if (!isValidMineCount(mines)) return { ok: false, reason: 'bad_mines' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const game = {
            id: randomBytes(6).toString('hex'), game: 'mines', bet, mines: placeMines(mines, randomInt), picks: [],
            guildId: guildId ? String(guildId) : null, channelId: channelId ? String(channelId) : null, messageId: null,
            lang: readLang(lang), startedAt: now, lastActionAt: now, ...allInMark(asked),
        };
        record.ccCasino = game;
        return { ok: true, game, before, previous };
    });
}

/**
 * Opens `cell` of the member's board `gameId`. Returns `{ ok: true, outcome, game }` with outcome
 * 'safe' (the board goes on), 'duplicate' (already open, nothing changed), 'lost' (a mine: the bet is
 * gone), 'cleared' (every safe cell open: paid) or 'timeout' (it was idle past the timeout: paid at its
 * multiplier, the cell stays closed); ended games also have `bet`, `payout` and `balance`.
 * `{ ok: false, reason: 'stale' }` when that game isn't running any more.
 */
export async function pickMinesCell(client, guildId, userId, gameId, cell, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    if (!Number.isSafeInteger(cell) || cell < 0 || cell >= CASINO.mines.cells) return { ok: false, reason: 'stale' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readMinesGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endGame(state, record, 'timeout') };
        if (game.picks.includes(cell)) return { ok: true, outcome: 'duplicate', game, skipSave: true };
        if (game.mines.includes(cell)) return { ok: true, ...endGame(state, record, 'lost', cell) };
        game.picks.push(cell);
        game.lastActionAt = now;
        if (game.picks.length === safeCells(game.mines.length)) return { ok: true, ...endGame(state, record, 'cleared') };
        return { ok: true, outcome: 'safe', game };
    });
}

/**
 * Cash out: ends the board `gameId` at its multiplier, once. A second click finds no game:
 * `{ ok: false, reason: 'stale' }`. Otherwise like an ended pickMinesCell (outcome 'cashout' or 'timeout').
 */
export async function cashOutMines(client, guildId, userId, gameId, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readMinesGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        return { ok: true, ...endGame(state, record, now - game.lastActionAt >= idleMs ? 'timeout' : 'cashout') };
    });
}

/**
 * The inactivity timeout and the startup check, for any saved game (mines or chicken): ends the member's game
 * when nobody touched it for `idleMs`, cashing out at its multiplier (the bet back with no cell opened or no lane
 * crossed); a damaged one gives its bet back. With `gameId` only that game. Returns an ended game like
 * cashOutMines (outcome 'timeout' or 'broken'), `{ ok: false, reason: 'active', remainingMs, game }` while it
 * still runs, or `{ ok: false, reason: 'stale' }` when there is none.
 */
export async function settleIdleGame(client, guildId, userId, gameId = null, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        if (!record.ccCasino) return { ok: false, reason: 'stale', skipSave: true };
        const game = readSavedGame(record.ccCasino);
        if (gameId !== null && game?.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        const remainingMs = game ? game.lastActionAt + idleMs - now : 0;
        if (remainingMs > 0) return { ok: false, reason: 'active', remainingMs, game, skipSave: true };
        return { ok: true, ...endGame(state, record, 'timeout') };
    });
}

/** The name settleIdleGame had when mines was the only saved game (it settles a chicken the same way). */
export const settleIdleMines = settleIdleGame;

/** Remembers the message of the saved game `gameId` (a mines board or a chicken), so it can still be updated after a restart. */
export async function attachGameMessage(client, guildId, userId, gameId, messageId) {
    if (!messageId) return { ok: false };
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readSavedGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, skipSave: true };
        game.messageId = String(messageId);
        return { ok: true };
    });
}

/** The name attachGameMessage had when mines was the only saved game. */
export const attachMinesMessage = attachGameMessage;

// ---- Chicken ----

/** `base` to the power `exponent`, multiplied out in whole numbers (exact while it stays under 2^53). */
function power(base, exponent) {
    let value = 1;
    for (let i = 0; i < exponent; i += 1) value *= base;
    return value;
}

/** How many equally likely draws a chicken game starts with: outOf ^ maxSteps (5^20). */
export const chickenDraws = () => power(CASINO.chicken.outOf, CASINO.chicken.maxSteps);

/**
 * The lane the chicken of draw `u` (0 … outOf^maxSteps − 1) dies on, 1 … maxSteps, or null when it crosses every
 * lane. It makes lane k when u < survive^k × outOf^(maxSteps − k): that is (survive / outOf)^k of the draws, and
 * those of lane k are a part of those of lane k − 1, so each lane is made after the one before with probability
 * exactly survive / outOf (4/5), whatever happened before.
 */
export function chickenDeathStep(u, maxSteps = CASINO.chicken.maxSteps) {
    const { survive, outOf } = CASINO.chicken;
    if (!Number.isSafeInteger(u) || u < 0 || u >= power(outOf, maxSteps)) throw new Error('Invalid casino random draw');
    for (let lane = 1; lane <= maxSteps; lane += 1) {
        if (u >= power(survive, lane) * power(outOf, maxSteps - lane)) return lane;
    }
    return null;
}

/** The lane a new chicken dies on (or null), from one crypto.randomInt draw unless a test passes `randomInt`. */
export function drawChickenDeath(randomInt = secureRandomInt) {
    return chickenDeathStep(draw(randomInt, chickenDraws()));
}

/**
 * What cashing out a chicken pays after `steps` lanes: the bet with none, else
 * bet × (100 − edge)% × (outOf / survive)^steps rounded down, i.e. ⌊bet × 97 × 5^steps / (100 × 4^steps)⌋. The
 * product is a BigInt, so it is exact even at the bet ceiling (the result, at most ×84.13, stays a safe Number).
 */
export function chickenPayout(bet, steps) {
    const { survive, outOf, maxSteps, edgePercent } = CASINO.chicken;
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > maxSteps) throw new Error('Invalid chicken steps');
    if (!Number.isSafeInteger(bet) || bet < 0) throw new Error('Invalid casino bet');
    if (steps === 0) return bet;
    const lanes = BigInt(steps);
    return Number((BigInt(bet) * BigInt(100 - edgePercent) * BigInt(outOf) ** lanes) / (100n * BigInt(survive) ** lanes));
}

/** The same multiplier in hundredths, rounded down, for the board (`×1.89` is 189 after 3 lanes; 100 before the first). */
export function chickenMultiplierHundredths(steps) {
    return chickenPayout(100, steps);
}

/** The chance in % that the chicken makes the next lane (80). */
export const chickenSurvivePercent = () => Math.round((CASINO.chicken.survive * 100) / CASINO.chicken.outOf);

/**
 * Starts a chicken: takes the bet and draws, once, the lane a car gets it on (or none), in the same save (`lang`
 * is the game's language). `bet` may be ALL_IN, like startMines. Returns `{ ok: true, game, before, balance,
 * previous }` (`previous` is an idle game settled first, or null) or `{ ok: false, reason }` with reason one of:
 * bad_bet, active (with `game`), no_cc (with `balance`).
 */
export async function startChicken(client, guildId, userId, { bet: asked, channelId = null, lang = null } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const game = {
            id: randomBytes(6).toString('hex'), game: 'chicken', bet, steps: 0, deathStep: drawChickenDeath(randomInt),
            guildId: guildId ? String(guildId) : null, channelId: channelId ? String(channelId) : null, messageId: null,
            lang: readLang(lang), startedAt: now, lastActionAt: now, ...allInMark(asked),
        };
        record.ccCasino = game;
        return { ok: true, game, before, previous };
    });
}

/**
 * One lane on for the chicken of game `gameId`, pressed on the board that showed `steps` lanes crossed (the step
 * button carries it). Returns `{ ok: true, outcome, game }` with outcome 'safe' (it made the lane, the game goes
 * on), 'outdated' (the game is no longer at `steps`: a double press or an old board message; nothing changed),
 * 'lost' (a car got it on that lane: the bet is gone), 'crossed' (it made the last lane: paid at the top
 * multiplier) or 'timeout' (it was idle past the timeout: paid at its multiplier, the lane isn't tried); ended
 * games also have `bet`, `payout` and `balance`. `{ ok: false, reason: 'stale' }` when that game isn't running any
 * more. So one board moves the chicken one lane at most, however often it is pressed.
 */
export async function stepChicken(client, guildId, userId, gameId, steps, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    if (!Number.isSafeInteger(steps) || steps < 0) return { ok: false, reason: 'stale' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readChickenGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endGame(state, record, 'timeout') };
        if (game.steps !== steps) return { ok: true, outcome: 'outdated', game, skipSave: true };
        if (game.steps + 1 === game.deathStep) return { ok: true, ...endGame(state, record, 'lost') };
        game.steps += 1;
        game.lastActionAt = now;
        if (game.steps === CASINO.chicken.maxSteps) return { ok: true, ...endGame(state, record, 'crossed') };
        return { ok: true, outcome: 'safe', game };
    });
}

/**
 * Cash out: ends the chicken `gameId` at its multiplier, once. A second click finds no game:
 * `{ ok: false, reason: 'stale' }`. Otherwise like an ended stepChicken (outcome 'cashout' or 'timeout').
 */
export async function cashOutChicken(client, guildId, userId, gameId, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readChickenGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        return { ok: true, ...endGame(state, record, now - game.lastActionAt >= idleMs ? 'timeout' : 'cashout') };
    });
}

// ---- Blackjack ----

export const CARD_SUITS = ['♠', '♥', '♦', '♣'];
export const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const isCard = (c) => Boolean(
    c && typeof c === 'object'
    && typeof c.rank === 'string' && CARD_RANKS.includes(c.rank)
    && typeof c.suit === 'string' && CARD_SUITS.includes(c.suit),
);

export function cardValue(card) {
    if (!card || typeof card.rank !== 'string') return 0;
    if (card.rank === 'A') return 11;
    if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
    return Number(card.rank) || 0;
}

export function handScore(hand) {
    if (!Array.isArray(hand)) return 0;
    let score = 0;
    let aces = 0;
    for (const card of hand) {
        if (!card) continue;
        if (card.rank === 'A') {
            aces += 1;
            score += 11;
        } else if (['K', 'Q', 'J', '10'].includes(card.rank)) {
            score += 10;
        } else {
            score += Number(card.rank) || 0;
        }
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
    }
    return score;
}

export function isSoftHand(hand) {
    if (!Array.isArray(hand)) return false;
    let score = 0;
    let aces = 0;
    for (const card of hand) {
        if (!card) continue;
        if (card.rank === 'A') {
            aces += 1;
            score += 11;
        } else if (['K', 'Q', 'J', '10'].includes(card.rank)) {
            score += 10;
        } else {
            score += Number(card.rank) || 0;
        }
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces -= 1;
    }
    return aces > 0 && score <= 21;
}

export function isNaturalBlackjack(hand) {
    return Array.isArray(hand) && hand.length === 2 && handScore(hand) === 21;
}

export function createShuffledDeck(randomInt = secureRandomInt) {
    const deck = [];
    for (const suit of CARD_SUITS) {
        for (const rank of CARD_RANKS) {
            deck.push({ rank, suit });
        }
    }
    for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = draw(randomInt, i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function playDealerHand(dealerHand, deck) {
    const standsOn = CASINO.blackjack?.dealerStandsOn ?? 17;
    while (handScore(dealerHand) < standsOn && deck.length > 0) {
        dealerHand.push(deck.pop());
    }
    return dealerHand;
}

/** Plays the dealer's hand out (it stands on `dealerStandsOn`) and says how the player's hand ends: win, push or lost. */
export function standOutcome(game) {
    playDealerHand(game.dealerHand, game.deck);
    const player = handScore(game.playerHand);
    const dealer = handScore(game.dealerHand);
    if (player > 21) return 'lost';
    return dealer > 21 || player > dealer ? 'win' : (player === dealer ? 'push' : 'lost');
}

export function blackjackPayout(bet, outcome = 'win') {
    if (outcome === 'natural') return divideDown(bet * (CASINO.blackjack?.naturalPayout ?? 250), 100);
    if (outcome === 'win') return divideDown(bet * (CASINO.blackjack?.winPayout ?? 200), 100);
    // 'refund' only gives back a hand whose board was never shown (cancelBlackjack); an idle hand is never refunded:
    // endGame stands it first, so 'timeout' reaches here only as a loss.
    if (outcome === 'push' || outcome === 'refund') return bet;
    return 0;
}

export function readBlackjackGame(raw) {
    if (!raw || typeof raw !== 'object' || raw.game !== 'blackjack' || typeof raw.id !== 'string' || !raw.id) return null;
    if (!Number.isSafeInteger(raw.bet) || raw.bet < 1 || raw.bet > CASINO_BET_LIMITS.ceiling) return null;
    if (!Array.isArray(raw.playerHand) || raw.playerHand.length < 2 || !raw.playerHand.every(isCard)) return null;
    if (!Array.isArray(raw.dealerHand) || raw.dealerHand.length < 2 || !raw.dealerHand.every(isCard)) return null;
    if (!Array.isArray(raw.deck) || !raw.deck.every(isCard)) return null;
    if (typeof raw.doubled !== 'boolean') return null;
    if (!Number.isFinite(raw.lastActionAt)) return null;
    return raw;
}

export async function startBlackjack(client, guildId, userId, { bet: asked, channelId = null, lang = null } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const deck = createShuffledDeck(randomInt);
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        const game = {
            id: randomBytes(6).toString('hex'), game: 'blackjack', bet, playerHand, dealerHand, deck, doubled: false,
            guildId: guildId ? String(guildId) : null, channelId: channelId ? String(channelId) : null, messageId: null,
            lang: readLang(lang), startedAt: now, lastActionAt: now, ...allInMark(asked),
        };
        const pNatural = isNaturalBlackjack(playerHand);
        const dNatural = isNaturalBlackjack(dealerHand);
        if (pNatural || dNatural) {
            const outcome = (pNatural && dNatural) ? 'push' : (pNatural ? 'natural' : 'lost');
            const payout = blackjackPayout(bet, outcome);
            payOut(state, record, bet, payout);
            return { ok: true, ended: true, outcome, game, before, bet, payout, balance: state.cc, previous };
        }
        record.ccCasino = game;
        return { ok: true, ended: false, game, before, previous };
    });
}

/**
 * Hit: one more card. `cards` is how many cards the player's board showed when the button was made: a press whose
 * count differs (a double press, an old board) changes nothing (`outcome: 'outdated'`).
 */
export async function hitBlackjack(client, guildId, userId, gameId, cards = null, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readBlackjackGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endGame(state, record, 'timeout') };
        if (cards !== null && cards !== game.playerHand.length) return { ok: true, outcome: 'outdated', game, skipSave: true };
        if (!game.deck.length) game.deck = createShuffledDeck();
        game.playerHand.push(game.deck.pop());
        game.lastActionAt = now;
        const score = handScore(game.playerHand);
        if (score > 21) return { ok: true, ...endGame(state, record, 'lost') };
        if (score === 21) {
            playDealerHand(game.dealerHand, game.deck);
            const dScore = handScore(game.dealerHand);
            const outcome = dScore > 21 || score > dScore ? 'win' : (score === dScore ? 'push' : 'lost');
            return { ok: true, ...endGame(state, record, outcome) };
        }
        return { ok: true, outcome: 'continue', game };
    });
}

export async function standBlackjack(client, guildId, userId, gameId, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readBlackjackGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endGame(state, record, 'timeout') };
        playDealerHand(game.dealerHand, game.deck);
        const pScore = handScore(game.playerHand);
        const dScore = handScore(game.dealerHand);
        const outcome = dScore > 21 || pScore > dScore ? 'win' : (pScore === dScore ? 'push' : 'lost');
        return { ok: true, ...endGame(state, record, outcome) };
    });
}

export async function doubleBlackjack(client, guildId, userId, gameId, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readBlackjackGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endGame(state, record, 'timeout') };
        if (game.doubled || game.playerHand.length !== 2) return { ok: false, reason: 'bad_double', skipSave: true };
        if (state.cc < game.bet) return { ok: false, reason: 'no_cc', balance: state.cc, game, skipSave: true };
        takeBet(state, game.bet);
        game.bet *= 2;
        game.doubled = true;
        if (!game.deck.length) game.deck = createShuffledDeck();
        game.playerHand.push(game.deck.pop());
        game.lastActionAt = now;
        const pScore = handScore(game.playerHand);
        if (pScore > 21) return { ok: true, ...endGame(state, record, 'lost') };
        playDealerHand(game.dealerHand, game.deck);
        const dScore = handScore(game.dealerHand);
        const outcome = dScore > 21 || pScore > dScore ? 'win' : (pScore === dScore ? 'push' : 'lost');
        return { ok: true, ...endGame(state, record, outcome) };
    });
}

export async function cancelBlackjack(client, guildId, userId, gameId) {
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readBlackjackGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        // The board never showed up (nothing was seen): the whole bet goes back.
        return { ok: true, ...endGame(state, record, 'refund') };
    });
}

/**
 * Coinflip on `side` ('heads' or 'tails'), bet and payout in one save. Returns
 * `{ ok: true, bet, side, landed, payout, before, balance, previous }` (with `allIn` for an ALL_IN bet, whose
 * `bet` is the real amount) or `{ ok: false, reason }` (bad_bet, bad_side, active, no_cc) like startMines.
 */
export async function playCoinflip(client, guildId, userId, { bet: asked, side = 'heads' } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    if (!Object.hasOwn(COIN_SIDES, side)) return { ok: false, reason: 'bad_side' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const landed = draw(randomInt, 2) === 0 ? 'heads' : 'tails';
        const payout = landed === side ? coinflipPayout(bet) : 0;
        payOut(state, record, bet, payout);
        return { ok: true, bet, side, landed, payout, before, previous, ...allInMark(asked) };
    });
}

/**
 * One spin of the slots, bet and payout in one save. Returns
 * `{ ok: true, bet, reels, kind, symbol, multiplier, payout, before, balance, previous }` (with `allIn` for an
 * ALL_IN bet) or `{ ok: false, reason }` (bad_bet, active, no_cc) like startMines.
 */
export async function playSlots(client, guildId, userId, { bet: asked } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const reels = spinReels(randomInt);
        const spin = slotsResult(reels, bet);
        payOut(state, record, bet, spin.payout);
        return { ok: true, bet, reels, ...spin, before, previous, ...allInMark(asked) };
    });
}

/**
 * The house edge of each game in percent, worked out from the payouts (the same math as the tests), for the
 * guide and the games menu: they never show a number the games don't really have.
 */
export function casinoEdges() {
    const { symbols, triple, pair } = CASINO.slots;
    const reels = symbols.length;
    const pairs = 3 * reels * (reels - 1);
    const slotsReturn = (Object.values(triple).reduce((sum, multiplier) => sum + multiplier, 0) + pairs * pair) / reels ** 3;
    const { pockets, red, colorPays, numberPays } = CASINO.roulette;
    const rouletteReturn = Math.max((red.length * colorPays) / pockets, numberPays / pockets);
    const percent = (lost) => Math.round(lost * 10_000) / 100;
    return {
        mines: CASINO.mines.edgePercent,
        coinflip: Math.round((100 - CASINO.coinflip.payoutPercent / 2) * 100) / 100,
        slots: percent(1 - slotsReturn),
        crash: CASINO.crash.edgePercent,
        dice: CASINO.dice.edgePercent,
        // (survive / outOf)^k of the chickens get k lanes far and are paid (100 − edge)% × (outOf / survive)^k.
        chicken: CASINO.chicken.edgePercent,
        // An approximation for a typical player (dealer stands on 17, 3:2 naturals, double on any two cards, no split,
        // insurance or surrender, a fresh deck each hand): perfect basic strategy is nearer 1%.
        blackjack: CASINO.blackjack.edgePercent,
        roulette: percent(1 - rouletteReturn),
        rocket: CASINO.crash.edgePercent,
    };
}

// ---- Crash (the rocket's crash point; playCrash and crashFrames are the tested crash engine) and dice ----

/** `bet` × hundredths / 100 rounded down, exactly: no product above 2^53 even at the bet ceiling × 100. */
export function multiplyHundredths(bet, hundredths) {
    return divideDown(bet, 100) * hundredths + divideDown((bet % 100) * hundredths, 100);
}

/**
 * The crash point (hundredths) of draw `u` out of `draws`: ⌊(100 − edge) × draws / (draws − u)⌋. As draws − u
 * is uniform over 1 … draws, the point reaches t (t ≥ 100 − edge) for ⌊(100 − edge) × draws / t⌋ of the draws.
 */
export function crashPointFromDraw(u, draws = CASINO.crash.draws) {
    if (!Number.isSafeInteger(u) || u < 0 || u >= draws) throw new Error('Invalid casino random draw');
    return divideDown((100 - CASINO.crash.edgePercent) * draws, draws - u);
}

/** A new crash point (hundredths), from crypto.randomInt unless a test passes `randomInt`. */
export function drawCrashPoint(randomInt = secureRandomInt) {
    const { draws } = CASINO.crash;
    return crashPointFromDraw(draw(randomInt, draws), draws);
}

/** Whether `target` (hundredths) is a crash target: a whole number from ×1.01 to ×100. */
export function isValidCrashTarget(target) {
    return Number.isSafeInteger(target) && target >= CASINO.crash.minTarget && target <= CASINO.crash.maxTarget;
}

/** A crash bet aiming for `target`: bet × target when the crash point reaches it (a tie wins), else nothing. */
export function crashPayout(bet, target, crashPoint) {
    return crashPoint >= target ? multiplyHundredths(bet, target) : 0;
}

/** The chance (in hundredths of a percent, rounded down) that the crash point reaches `target`: 3880 = 38.80%. */
export function crashChanceBasisPoints(target) {
    return divideDown((100 - CASINO.crash.edgePercent) * 10_000, target);
}

/**
 * The steps the crash animation shows before its end value `end` (hundredths): at most CASINO.crash.frames − 1
 * values climbing from ×1.00 like the rocket does (evenly on a log scale), all below `end`. None when it ends at ×1.00.
 */
export function crashFrames(end, frames = CASINO.crash.frames) {
    if (!(end > 100)) return [];
    const steps = Math.min(frames, Math.max(1, Math.ceil(Math.log(end / 100) / Math.log(1.5))));
    const values = [];
    for (let step = 1; step < steps; step += 1) {
        const value = Math.floor(100 * (end / 100) ** (step / steps));
        if (value > (values.at(-1) ?? 100) && value < end) values.push(value);
    }
    return values;
}

/**
 * Crash, bet and payout in one save: the crash point is drawn, and the bet pays ×target when it reaches the
 * target. Returns `{ ok: true, bet, target, crash, payout, before, balance, previous }` or `{ ok: false, reason }`
 * (bad_bet, bad_target, active, no_cc) like startMines. Not reachable from any command (crash is the group
 * rocket): it stays as the reference of the crash math the rocket's automatic cash-outs follow.
 */
export async function playCrash(client, guildId, userId, { bet, target = CASINO.crash.defaultTarget } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    if (!isValidCrashTarget(target)) return { ok: false, reason: 'bad_target' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const crash = drawCrashPoint(randomInt);
        const payout = crashPayout(bet, target, crash);
        payOut(state, record, bet, payout);
        return { ok: true, bet, target, crash, payout, before, previous };
    });
}

/** The win chance in % of a dice bet (`under` N: N%, `over` N: 100 − N%), or null when it is out of range. */
export function diceChance(direction, number) {
    if (!Number.isSafeInteger(number)) return null;
    const chance = { under: number, over: 100 - number }[direction];
    const { minChance, maxChance } = CASINO.dice;
    return Number.isSafeInteger(chance) && chance >= minChance && chance <= maxChance ? chance : null;
}

/** Whether `roll` (0–9,999, i.e. 0.00–99.99) wins: `under` N below N.00, `over` N from N.00 up. */
export function diceWins(roll, direction, number) {
    const line = number * (CASINO.dice.faces / 100);
    return direction === 'under' ? roll < line : roll >= line;
}

/** A dice win with a `chance`% chance: bet × (100 − edge) / chance, rounded down. */
export function dicePayout(bet, chance) {
    return divideDown(bet * (100 - CASINO.dice.edgePercent), chance);
}

/** The same multiplier in hundredths, rounded down (`×1.94` is 194 at 50%). */
export function diceMultiplierHundredths(chance) {
    return divideDown((100 - CASINO.dice.edgePercent) * 100, chance);
}

/**
 * One roll of the dice, bet and payout in one save. Returns
 * `{ ok: true, bet, direction, number, chance, roll, payout, before, balance, previous }` (with `allIn` for an
 * ALL_IN bet) or `{ ok: false, reason }` (bad_bet, bad_dice, active, no_cc) like startMines.
 */
export async function playDice(client, guildId, userId, { bet: asked, direction = 'under', number = CASINO.dice.defaultNumber } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    const chance = diceChance(direction, number);
    if (chance === null) return { ok: false, reason: 'bad_dice' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleGame(state, record, now, idleMs);
        const bet = betFor(state, asked);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const roll = draw(randomInt, CASINO.dice.faces);
        const payout = diceWins(roll, direction, number) ? dicePayout(bet, chance) : 0;
        payOut(state, record, bet, payout);
        return { ok: true, bet, direction, number, chance, roll, payout, before, previous, ...allInMark(asked) };
    });
}
