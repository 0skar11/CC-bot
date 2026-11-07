// casinoService.js — the CC casino's solo games, rules and money: mines, coinflip, slots, crash and dice.
// The payouts and the house edge are explained in src/config/casino.js; the embeds are casinoUi.js and the
// live mines boards (timeout, restart) casinoSessions.js. The group games are casinoGroupService.js.
//
// Every balance change goes through updateCCState (ccService.js), one save per step under the member's
// lock: the bet is taken in the same save that starts a game and the payout added in the same save that
// ends it, so a bet can't be spent twice, a game can't be paid twice and nothing is left half done.
// Coinflip, slots, crash and dice are over in that one save (crash only animates the result afterwards).
// A mines game is kept in the member's economy record
// until it ends, so a restart or a crash never loses the bet:
//   ccCasino: { id, game: 'mines', bet, mines: [cells], picks: [cells], guildId, channelId, messageId,
//               startedAt, lastActionAt }
// `mines` are the cells (0–8, row by row) hiding a mine, drawn with crypto.randomInt when the game starts
// and never shown before it ends; `picks` are the safe cells opened, in order. A button carries its game
// `id`, so a button of an ended or older game changes nothing. A member plays one game at a time.
// Totals: ccStats.spent += bet and ccStats.earned += payout, plus per member
//   ccCasinoStats: { played, won, lost, wagered, paidOut } (a payout equal to the bet is neither won nor lost).

import { randomBytes, randomInt as cryptoRandomInt } from 'node:crypto';
import { CASINO, COIN_SIDES } from '../../config/casino.js';
import { CASINO_BET_LIMITS } from '../../config/runtime.js';
import { updateCCState } from './ccService.js';

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
 * Ends the record's mines game as `outcome` ('lost', 'cashout', 'cleared' or 'timeout') and pays it:
 * nothing after a mine (`hit` is its cell), else the multiplier of the cells opened (the bet back with
 * none). A damaged game ('broken') gives back its bet when that can still be read.
 * Returns `{ outcome, game, bet, payout }`.
 */
function endMines(state, record, outcome, hit = null) {
    const raw = record.ccCasino;
    const game = readMinesGame(raw);
    delete record.ccCasino;
    if (!game) {
        const bet = Number.isSafeInteger(raw?.bet) && raw.bet > 0 && raw.bet <= CASINO_BET_LIMITS.ceiling ? raw.bet : 0;
        if (bet) payOut(state, record, bet, bet);
        return { outcome: 'broken', game: null, bet, payout: bet, channelId: typeof raw?.channelId === 'string' ? raw.channelId : null };
    }
    const payout = outcome === 'lost' ? 0 : minesPayout(game.bet, game.mines.length, game.picks.length);
    payOut(state, record, game.bet, payout);
    return { outcome, game: hit === null ? game : { ...game, hit }, bet: game.bet, payout };
}

/** Before a new game: a board left alone past the timeout (a missed timer) or a damaged one is settled first. */
function endIdleMines(state, record, now, idleMs) {
    if (!record.ccCasino) return null;
    const game = readMinesGame(record.ccCasino);
    if (game && now - game.lastActionAt < idleMs) return null;
    return endMines(state, record, 'timeout');
}

/** Why a new game can't start (another game running, or the balance under the bet), else null. */
function refuseStart(state, record, bet) {
    if (record.ccCasino) return { ok: false, reason: 'active', game: readMinesGame(record.ccCasino) };
    if (state.cc < bet) return { ok: false, reason: 'no_cc', balance: state.cc };
    return null;
}

/**
 * Starts a mines board: takes the bet and hides `mines` mines in the same save. Returns
 * `{ ok: true, game, before, balance, previous }` (`previous` is an idle board settled first, or null) or
 * `{ ok: false, reason }` with reason one of: bad_bet, bad_mines, active (with `game`), no_cc (with `balance`).
 */
export async function startMines(client, guildId, userId, { bet, mines = CASINO.mines.default, channelId = null } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    if (!isValidMineCount(mines)) return { ok: false, reason: 'bad_mines' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleMines(state, record, now, idleMs);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const game = {
            id: randomBytes(6).toString('hex'), game: 'mines', bet, mines: placeMines(mines, randomInt), picks: [],
            guildId: guildId ? String(guildId) : null, channelId: channelId ? String(channelId) : null, messageId: null,
            startedAt: now, lastActionAt: now,
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
        if (now - game.lastActionAt >= idleMs) return { ok: true, ...endMines(state, record, 'timeout') };
        if (game.picks.includes(cell)) return { ok: true, outcome: 'duplicate', game, skipSave: true };
        if (game.mines.includes(cell)) return { ok: true, ...endMines(state, record, 'lost', cell) };
        game.picks.push(cell);
        game.lastActionAt = now;
        if (game.picks.length === safeCells(game.mines.length)) return { ok: true, ...endMines(state, record, 'cleared') };
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
        return { ok: true, ...endMines(state, record, now - game.lastActionAt >= idleMs ? 'timeout' : 'cashout') };
    });
}

/**
 * The inactivity timeout and the startup check: ends the member's board when nobody touched it for
 * `idleMs`, cashing out at its multiplier (the bet back with nothing opened); a damaged one gives its
 * bet back. With `gameId` only that game. Returns an ended game like cashOutMines (outcome 'timeout' or
 * 'broken'), `{ ok: false, reason: 'active', remainingMs, game }` while it still runs, or
 * `{ ok: false, reason: 'stale' }` when there is none.
 */
export async function settleIdleMines(client, guildId, userId, gameId = null, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    return updateCCState(client, guildId, userId, (state, record) => {
        if (!record.ccCasino) return { ok: false, reason: 'stale', skipSave: true };
        const game = readMinesGame(record.ccCasino);
        if (gameId !== null && game?.id !== gameId) return { ok: false, reason: 'stale', skipSave: true };
        const remainingMs = game ? game.lastActionAt + idleMs - now : 0;
        if (remainingMs > 0) return { ok: false, reason: 'active', remainingMs, game, skipSave: true };
        return { ok: true, ...endMines(state, record, 'timeout') };
    });
}

/** Remembers the message of board `gameId`, so the board can still be updated after a restart. */
export async function attachMinesMessage(client, guildId, userId, gameId, messageId) {
    if (!messageId) return { ok: false };
    return updateCCState(client, guildId, userId, (state, record) => {
        const game = readMinesGame(record.ccCasino);
        if (!game || game.id !== gameId) return { ok: false, skipSave: true };
        game.messageId = String(messageId);
        return { ok: true };
    });
}

/**
 * Coinflip on `side` ('heads' or 'tails'), bet and payout in one save. Returns
 * `{ ok: true, bet, side, landed, payout, before, balance, previous }` or `{ ok: false, reason }`
 * (bad_bet, bad_side, active, no_cc) like startMines.
 */
export async function playCoinflip(client, guildId, userId, { bet, side = 'heads' } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    if (!Object.hasOwn(COIN_SIDES, side)) return { ok: false, reason: 'bad_side' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleMines(state, record, now, idleMs);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const landed = draw(randomInt, 2) === 0 ? 'heads' : 'tails';
        const payout = landed === side ? coinflipPayout(bet) : 0;
        payOut(state, record, bet, payout);
        return { ok: true, bet, side, landed, payout, before, previous };
    });
}

/**
 * One spin of the slots, bet and payout in one save. Returns
 * `{ ok: true, bet, reels, kind, symbol, multiplier, payout, before, balance, previous }` or
 * `{ ok: false, reason }` (bad_bet, active, no_cc) like startMines.
 */
export async function playSlots(client, guildId, userId, { bet } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleMines(state, record, now, idleMs);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const reels = spinReels(randomInt);
        const spin = slotsResult(reels, bet);
        payOut(state, record, bet, spin.payout);
        return { ok: true, bet, reels, ...spin, before, previous };
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
        roulette: percent(1 - rouletteReturn),
        rocket: CASINO.crash.edgePercent,
    };
}

// ---- Crash (also the rocket's crash point) and dice ----

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
 * (bad_bet, bad_target, active, no_cc) like startMines.
 */
export async function playCrash(client, guildId, userId, { bet, target = CASINO.crash.defaultTarget } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    if (!isValidCrashTarget(target)) return { ok: false, reason: 'bad_target' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleMines(state, record, now, idleMs);
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
 * `{ ok: true, bet, direction, number, chance, roll, payout, before, balance, previous }` or
 * `{ ok: false, reason }` (bad_bet, bad_dice, active, no_cc) like startMines.
 */
export async function playDice(client, guildId, userId, { bet, direction = 'under', number = CASINO.dice.defaultNumber } = {}, { now = Date.now(), randomInt = secureRandomInt, idleMs = CASINO.idleMs } = {}) {
    if (!isValidBet(bet)) return { ok: false, reason: 'bad_bet' };
    const chance = diceChance(direction, number);
    if (chance === null) return { ok: false, reason: 'bad_dice' };
    return updateCCState(client, guildId, userId, (state, record) => {
        const previous = endIdleMines(state, record, now, idleMs);
        const refused = refuseStart(state, record, bet);
        if (refused) return { ...refused, previous, skipSave: !previous };
        const before = state.cc;
        takeBet(state, bet);
        const roll = draw(randomInt, CASINO.dice.faces);
        const payout = diceWins(roll, direction, number) ? dicePayout(bet, chance) : 0;
        payOut(state, record, bet, payout);
        return { ok: true, bet, direction, number, chance, roll, payout, before, previous };
    });
}
