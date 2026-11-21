// casinoGroupService.js — the casino's group games, rules and money: roulette, rocket (a group crash) and the
// horse race (casinoHorses.js: the horses and the draw), one shared round per game per room. The payouts and the house edge are explained in src/config/casino.js; the
// live side (timers, the round message, the restart check) is casinoGroupSessions.js, the embeds casinoGroupUi.js.
// The callers hold the round's lock (withRoundLock) around every function that writes the round.
//
// Money moves only through updateCCState (ccService.js), like the solo games, and a bet is never lost on a
// restart or a crash:
// - The round is saved at `guild:<scope>:casino:<game>:<roomId>` (getCasinoRoundKey): one round per game per
//   room, whatever the language the members type in (`rocket`, `crash`, `صاروخ` and `كراش` all join it):
//     { id, game, status, guildId, channelId, messageId, lang, openedAt, closesAt,
//       bets: [{ userId, bet, choice | target | horse, lang? }],
//       pocket, spunAt (roulette) | crash, capped, flightAt, crashedAt (rocket) | winner, order, racedAt (horses) }
//   `lang` ('ar' | 'en') is the language of the round's one shared message: the language of the member who
//   opened it, kept for every later edit (rounds saved before it existed read as 'ar'). So a room that mixes
//   languages sees the opener's language on the shared message; a bet's own `lang` is only saved when it differs
//   from the round's, and makes that member's private answers (their cash-out clicks) follow their own command.
//   status 'open' (taking bets) → roulette 'spun' (the pocket is drawn) / horses 'raced' (the whole finishing order
//   is drawn and saved before the race is shown: `order`, 1st first, and `winner` = order[0]; a round raced before
//   the order existed has `winner` only and pays its 1st place alone) / rocket 'flying' (the crash point is drawn, never shown before the crash) →
//   rocket 'crashed' → `{ id, game, status: 'done', endedAt }`.
// - Each member's stake stays in their own economy record until it is settled:
//     ccCasinoBets: [{ round, game, channelId, bet, choice | target | horse, at }]
//   Joining takes the bet and adds the stake in the member's save, and the round gets the bet in the same
//   database transaction (written first, so a failed member save never leaves a stake without its round).
//   An all-in bet (`روليت كل احمر`, `صاروخ كل`, `كل` in the join form: the bet ALL_IN) is the balance that member
//   save reads, up to CASINO.maxBet: their other stakes are already out of it, so it is what is left. Its stake and
//   its entry in the round carry `allIn: true` (text only: the all-in tag on the messages); `bet` is the real number.
//   Settling removes the stake in the same save that pays it, so a stake is paid exactly once whoever settles
//   it (the round's timer, a double click, the restart check).
// - A round the bot couldn't finish (restart, crash) is settled from what was saved: a spun roulette pays with
//   its pocket, a raced horse round with its finishing order; a flying rocket pays its automatic cash-outs from its crash point and gives the riders who
//   cash out by hand their bet back (they couldn't click), unless the crash had been announced ('crashed');
//   a round still taking bets gives every bet back. A stake whose round is gone is given back too.

import { randomBytes } from 'node:crypto';
import { CASINO, GROUP_GAMES } from '../../config/casino.js';
import { CASINO_BET_LIMITS, economyScopeId } from '../../config/runtime.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { getCasinoRoundKey } from '../../utils/database/keys.js';
import { Mutex } from '../../utils/mutex.js';
import { updateCCState } from './ccService.js';
import {
    allInMark, betFor, draw, drawCrashPoint, isBetRequest, isValidCrashTarget, multiplyHundredths, payOut, returnBet, secureRandomInt, takeBet,
} from './casinoService.js';
import { HORSES, drawFinishOrder, horsesPayout } from './casinoHorses.js';
import { DEFAULT_LANG, isLang, readLang } from './lang.js';

const ACTIVE = new Set(['open', 'spun', 'raced', 'flying', 'crashed']);

/** The database key of the room's round of `game`. */
export const roundKey = (game, channelId) => getCasinoRoundKey(economyScope(), game, String(channelId));

/** Runs `task` alone for the round at `key`: joins, the spin or take-off, cash-outs and the settlement. */
export function withRoundLock(key, task) {
    return Mutex.runExclusive(`casino-round:${key}`, task);
}

/** Runs `task` in one database transaction when the database has them (PostgreSQL), so its saves land together. */
const atomically = (client, task) => (client.db.transaction ? client.db.transaction(task) : task());

async function saveRound(client, key, round) {
    if (await client.db.set(key, round) === false) throw new Error('Failed to save the casino round');
}

// ---- Roulette ----

/** 'green' (0), 'red' or 'black'. */
export function pocketColor(pocket) {
    if (pocket === 0) return 'green';
    return CASINO.roulette.red.includes(pocket) ? 'red' : 'black';
}

/** What a roulette bet on `choice` ('red', 'black' or a number 0–36) pays when the ball lands on `pocket`. */
export function roulettePayout(bet, choice, pocket) {
    const { colorPays, numberPays } = CASINO.roulette;
    if (typeof choice === 'number') return choice === pocket ? bet * numberPays : 0;
    return choice === pocketColor(pocket) ? bet * colorPays : 0;
}

const isRouletteChoice = (choice) => choice === 'red' || choice === 'black'
    || (Number.isSafeInteger(choice) && choice >= 0 && choice < CASINO.roulette.pockets);

// ---- Horses ----

/** A horse number of the race (1 … HORSES_COUNT). */
export const isHorseNumber = (horse) => Number.isSafeInteger(horse) && HORSES.some((entry) => entry.number === horse);

/** A saved finishing order: every horse of the race once, 1st first. */
export const isFinishOrder = (order) => Array.isArray(order) && order.length === HORSES.length
    && order.every(isHorseNumber) && new Set(order).size === order.length;

/** The finishing order a raced round pays by: its saved order, or its winner alone (a round saved before the order). */
export const roundFinish = (round) => (isFinishOrder(round?.order) ? round.order : [round?.winner]);

/** The horse `userId` already bet on in `round` (a member bets on one horse per race), or null. */
export const memberHorse = (round, userId) => round.bets.find((entry) => entry.userId === userId)?.horse ?? null;

// ---- Rocket ----

/** The rocket's multiplier (hundredths, rounded down) `elapsedMs` after take-off: it doubles every doubleMs. */
export function rocketMultiplierAt(elapsedMs) {
    if (!(elapsedMs > 0)) return 100;
    return Math.floor(100 * 2 ** (elapsedMs / CASINO.rocket.doubleMs) + 1e-9);
}

/** When (ms after take-off) the multiplier reaches `hundredths`. */
export function rocketTimeTo(hundredths) {
    return hundredths > 100 ? Math.ceil(CASINO.rocket.doubleMs * Math.log2(hundredths / 100)) : 0;
}

/**
 * Where a rider leaves a rocket that reached `multiplier` (hundredths) by now: at their automatic cash-out when
 * the rocket got there (a tie with the crash point wins, like crash), else at `multiplier` while the rocket still
 * flies below its crash point. null when it crashed first.
 */
export function rocketExit(entry, multiplier, crash) {
    if (entry.target && entry.target <= multiplier) return entry.target <= crash ? entry.target : null;
    return multiplier < crash ? multiplier : null;
}

// ---- Saved rounds and stakes ----

const isBetEntry = (entry) => entry && typeof entry === 'object' && typeof entry.userId === 'string'
    && Number.isSafeInteger(entry.bet) && entry.bet > 0 && entry.bet <= CASINO_BET_LIMITS.ceiling;

/**
 * A saved round that is still being played, or null (none, finished or damaged). Its `lang` is checked too, but
 * only text depends on it: a round saved before it existed, or with a value that isn't 'ar' or 'en', reads as
 * 'ar' (it never makes the round unreadable, which would refund or skip its bets).
 */
export function readRound(raw) {
    if (!raw || typeof raw !== 'object' || !GROUP_GAMES.includes(raw.game) || !ACTIVE.has(raw.status)) return null;
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.channelId !== 'string') return null;
    if (!Array.isArray(raw.bets) || !raw.bets.every(isBetEntry) || !Number.isFinite(raw.closesAt)) return null;
    if (raw.status === 'spun' && !(Number.isSafeInteger(raw.pocket) && raw.pocket >= 0 && raw.pocket < CASINO.roulette.pockets)) return null;
    if (raw.status === 'raced' && !isHorseNumber(raw.winner)) return null;
    if (raw.status === 'raced' && raw.order !== undefined && !(isFinishOrder(raw.order) && raw.order[0] === raw.winner)) return null;
    if ((raw.status === 'flying' || raw.status === 'crashed') && !(Number.isSafeInteger(raw.crash) && raw.crash > 0 && Number.isFinite(raw.flightAt))) return null;
    if (!isLang(raw.lang)) raw.lang = DEFAULT_LANG;
    return raw;
}

/** The language of the round's shared message (its opener's): 'ar' or 'en'. */
export const roundLanguage = (round) => readLang(round?.lang);

/**
 * The language `userId` plays `round` in: their latest bet's own language, else the round's. null when they have
 * no bet in it (a stranger: their answers follow the message they clicked).
 */
export function playerLanguage(round, userId) {
    const mine = Array.isArray(round?.bets) ? round.bets.filter((entry) => entry.userId === userId) : [];
    if (!mine.length) return null;
    const own = mine.at(-1).lang;
    return isLang(own) ? own : roundLanguage(round);
}

const isStake = (stake) => stake && typeof stake === 'object' && typeof stake.round === 'string'
    && Number.isSafeInteger(stake.bet) && stake.bet > 0 && stake.bet <= CASINO_BET_LIMITS.ceiling;

/** Every saved entry of ccCasinoBets, damaged ones too (kept for the restart check, never dropped on the way). */
const savedStakes = (record) => (Array.isArray(record?.ccCasinoBets) ? record.ccCasinoBets : []);

/** The member's group stakes (ccCasinoBets) that can be read. */
export function readStakes(record) {
    return savedStakes(record).filter(isStake);
}

function setStakes(record, stakes) {
    if (stakes.length) record.ccCasinoBets = stakes;
    else delete record.ccCasinoBets;
}

/** A new round; `lang` is the language of the member who opens it, kept for the round's shared message. */
function newRound(game, guildId, channelId, now, lang) {
    const { joinMs } = CASINO[game];
    return {
        id: randomBytes(6).toString('hex'), game, status: 'open',
        guildId: guildId ? String(guildId) : null, channelId: String(channelId), messageId: null, lang: readLang(lang),
        openedAt: now, closesAt: now + joinMs, bets: [],
    };
}

/** Why `pick` can't be bet in `game` (roulette: 'red', 'black' or 0–36; horses: 1 … HORSES_COUNT; rocket: null or a target ×1.01–×100). */
function badPick(game, pick) {
    if (game === 'roulette') return isRouletteChoice(pick) ? null : 'bad_choice';
    if (game === 'horses') return isHorseNumber(pick) ? null : 'bad_horse';
    return pick === null || isValidCrashTarget(pick) ? null : 'bad_target';
}

/**
 * Puts `bet` on the room's round of `game` (a new round when none is open): the bet is taken from the member and
 * written into the round in one transaction. `bet` may be ALL_IN: what is left of the balance, up to the max
 * bet, read in that same save. `pick` is roulette's choice or the rocket's automatic cash-out (hundredths, or
 * null); `lang` the language the member bets in (a new round takes it for its message). Returns
 * `{ ok: true, round, created, stake, before, balance }` (`stake.bet` the real amount, `stake.allIn` for an all-in)
 * or `{ ok: false, reason }`: bad_bet, bad_choice, bad_target, busy (a round is being played, with `round`), full,
 * too_many (the member's roulette or horse bets in the round, with `max`), other_horse (the member already bet on
 * another horse of this race, with `horse`: one horse per member per race, more bets only add to it), joined
 * (already on this rocket), no_cc (with `balance`; an all-in under the smallest bet too).
 */
export async function joinRound(client, guildId, userId, game, { channelId, bet: asked, pick = null, lang = null } = {}, { now = Date.now() } = {}) {
    if (!GROUP_GAMES.includes(game) || !channelId) return { ok: false, reason: 'busy' };
    if (!isBetRequest(asked)) return { ok: false, reason: 'bad_bet' };
    const bad = badPick(game, pick);
    if (bad) return { ok: false, reason: bad };
    const key = roundKey(game, channelId);
    return atomically(client, () => updateCCState(client, guildId, userId, async (state, record) => {
        const saved = readRound(await client.db.get(key, null));
        if (saved && (saved.status !== 'open' || now >= saved.closesAt)) return { ok: false, reason: 'busy', round: saved, skipSave: true };
        const round = saved || newRound(game, guildId, channelId, now, lang);
        const mine = round.bets.filter((entry) => entry.userId === userId).length;
        if (game === 'horses') {
            const horse = memberHorse(round, userId);
            if (horse !== null && horse !== pick) return { ok: false, reason: 'other_horse', horse, skipSave: true };
        }
        if (game === 'roulette' || game === 'horses') {
            if (round.bets.length >= CASINO[game].maxBets) return { ok: false, reason: 'full', skipSave: true };
            if (mine >= CASINO[game].maxBetsPerMember) return { ok: false, reason: 'too_many', max: CASINO[game].maxBetsPerMember, skipSave: true };
        } else {
            if (mine) return { ok: false, reason: 'joined', round, skipSave: true };
            if (round.bets.length >= CASINO.rocket.maxPlayers) return { ok: false, reason: 'full', skipSave: true };
        }
        // An all-in bets the balance as this save reads it (null: under the smallest bet).
        const bet = betFor(state, asked);
        if (bet === null || state.cc < bet) return { ok: false, reason: 'no_cc', balance: state.cc, skipSave: true };
        const before = state.cc;
        takeBet(state, bet);
        const detail = game === 'roulette' ? { choice: pick } : (game === 'horses' ? { horse: pick } : { target: pick });
        const mark = allInMark(asked);
        const stake = { round: round.id, game, channelId: String(channelId), bet, ...detail, ...mark, at: now };
        setStakes(record, [...savedStakes(record), stake]);
        // The member's own language only when it differs from the round's (see the header).
        const own = isLang(lang) && lang !== round.lang ? { lang } : {};
        round.bets.push({ userId, bet, ...detail, ...own, ...mark });
        await saveRound(client, key, round);
        return { ok: true, round, created: !saved, stake, before };
    }));
}

/** Remembers the round's message, so it can still be updated after a restart. */
export async function attachRoundMessage(client, key, roundId, messageId) {
    if (!messageId) return false;
    return atomically(client, async () => {
        const round = readRound(await client.db.get(key, null));
        if (!round || round.id !== roundId) return false;
        round.messageId = String(messageId);
        await saveRound(client, key, round);
        return true;
    });
}

/** The round at `key` when it is still `roundId` and being played, else null. */
export async function loadRound(client, key, roundId = null) {
    const round = readRound(await client.db.get(key, null));
    return round && (roundId === null || round.id === roundId) ? round : null;
}

/**
 * Settles the member's stakes in `round` with `decide(stake)` → `{ payout }` or `{ refund: true }`, in one save:
 * the stakes go and the payout comes in the same save, so a second call finds nothing (`settled: []`).
 * Returns `{ ok: true, userId, settled: [{ ...stake, payout, refunded }], payout, balance }`.
 */
export async function settleStakes(client, round, userId, decide) {
    return updateCCState(client, round.guildId || economyScopeId, userId, (state, record) => {
        const mine = readStakes(record).filter((stake) => stake.round === round.id);
        if (!mine.length) return { ok: true, userId, settled: [], payout: 0, skipSave: true };
        setStakes(record, savedStakes(record).filter((stake) => !mine.includes(stake)));
        let total = 0;
        const settled = mine.map((stake) => {
            const outcome = decide(stake);
            if (outcome.refund) {
                returnBet(state, stake.bet);
                total += stake.bet;
                return { ...stake, payout: stake.bet, refunded: true };
            }
            payOut(state, record, stake.bet, outcome.payout);
            total += outcome.payout;
            return { ...stake, payout: outcome.payout, refunded: false };
        });
        return { ok: true, userId, settled, payout: total };
    });
}

/**
 * Settles every member of `round` with `decide`, one member per save. Returns `{ results, failed }`: one result per
 * member that had stakes left, and the members whose save failed (to be tried again; nothing was paid to them).
 */
export async function settleRound(client, round, decide) {
    const results = [];
    const failed = [];
    for (const userId of [...new Set(round.bets.map((entry) => entry.userId))]) {
        try {
            const result = await settleStakes(client, round, userId, decide);
            if (result.settled.length) results.push(result);
        } catch (error) {
            failed.push({ userId, error });
        }
    }
    return { results, failed };
}

/** Marks the round finished (only when nothing of it is left to pay). */
export async function finishRound(client, key, round, { now = Date.now() } = {}) {
    return atomically(client, async () => {
        const saved = readRound(await client.db.get(key, null));
        if (!saved || saved.id !== round.id) return false;
        await saveRound(client, key, { id: round.id, game: round.game, status: 'done', endedAt: now });
        return true;
    });
}

/** Roulette: the wheel spins once for the round (the pocket is saved before anybody is paid). Idempotent. */
export async function spinRoulette(client, key, roundId, { now = Date.now(), randomInt = secureRandomInt } = {}) {
    return atomically(client, async () => {
        const round = await loadRound(client, key, roundId);
        if (!round || round.game !== 'roulette') return null;
        if (round.status === 'spun') return round;
        round.status = 'spun';
        round.pocket = draw(randomInt, CASINO.roulette.pockets);
        round.spunAt = now;
        await saveRound(client, key, round);
        return round;
    });
}

/**
 * Horses: the whole finishing order is drawn once for the round (crypto, a uniform random order: every horse
 * equally likely at every place) and saved with its winner before the race is shown or anybody is paid. Idempotent.
 */
export async function raceHorses(client, key, roundId, { now = Date.now(), randomInt = secureRandomInt } = {}) {
    return atomically(client, async () => {
        const round = await loadRound(client, key, roundId);
        if (!round || round.game !== 'horses') return null;
        if (round.status === 'raced') return round;
        round.status = 'raced';
        round.order = drawFinishOrder((max) => draw(randomInt, max));
        [round.winner] = round.order;
        round.racedAt = now;
        await saveRound(client, key, round);
        return round;
    });
}

/** Rocket: take-off, with the crash point drawn now and saved (capped at the rocket's top, ×100). Idempotent. */
export async function launchRocket(client, key, roundId, { now = Date.now(), randomInt = secureRandomInt } = {}) {
    return atomically(client, async () => {
        const round = await loadRound(client, key, roundId);
        if (!round || round.game !== 'rocket') return null;
        if (round.status !== 'open') return round;
        const drawn = drawCrashPoint(randomInt);
        const top = CASINO.crash.maxTarget;
        Object.assign(round, { status: 'flying', crash: Math.min(drawn, top), capped: drawn >= top, flightAt: now });
        await saveRound(client, key, round);
        return round;
    });
}

/** Rocket: the crash (or the top) is announced and saved; the riders still on board are settled after graceMs. */
export async function crashRocket(client, key, roundId, { now = Date.now() } = {}) {
    return atomically(client, async () => {
        const round = await loadRound(client, key, roundId);
        if (!round || round.game !== 'rocket' || round.status === 'open') return null;
        if (round.status === 'crashed') return round;
        Object.assign(round, { status: 'crashed', crashedAt: now });
        await saveRound(client, key, round);
        return round;
    });
}

/**
 * Rocket: the member leaves the rocket `roundId`, by button (`now` is when the click reached the bot) or by their
 * automatic cash-out, and is paid in the same save. Returns `{ ok: true, multiplier, payout, bet, round, balance }`
 * or `{ ok: false, reason }`: stale (no such round), not_started, not_in (not a rider), already (with
 * `multiplier`, `payout`), crashed (with `round`).
 */
export async function cashOutRocket(client, key, roundId, userId, { now = Date.now() } = {}) {
    return atomically(client, async () => {
        const round = await loadRound(client, key, roundId);
        if (!round || round.game !== 'rocket') return { ok: false, reason: 'stale' };
        if (round.status === 'open') return { ok: false, reason: 'not_started' };
        const entry = round.bets.find((bet) => bet.userId === userId);
        if (!entry) return { ok: false, reason: 'not_in' };
        if (entry.cashedOut) return { ok: false, reason: 'already', multiplier: entry.cashedOut, payout: entry.payout };
        const exit = rocketExit(entry, rocketMultiplierAt(now - round.flightAt), round.crash);
        if (exit === null) return { ok: false, reason: 'crashed', round };
        const paid = await settleStakes(client, round, userId, (stake) => ({ payout: multiplyHundredths(stake.bet, exit) }));
        // Its stake was already settled (the round's end got there first): nothing more is paid.
        if (!paid.settled.length) return { ok: false, reason: 'crashed', round };
        Object.assign(entry, { cashedOut: exit, payout: paid.payout });
        await saveRound(client, key, round);
        return { ok: true, multiplier: exit, payout: paid.payout, bet: entry.bet, round, balance: paid.balance };
    });
}

/** What a rider still on an ended rocket gets: the automatic cash-out under the crash point, ×100 at the top, else 0. */
export function rocketEndPayout(round, stake) {
    if (stake.target && stake.target <= round.crash) return multiplyHundredths(stake.bet, stake.target);
    return round.capped ? multiplyHundredths(stake.bet, round.crash) : 0;
}

/** The settlement of every stake of a finished round: the spun pocket, the race's places, or the crashed rocket. */
export function endDecision(round) {
    if (round.game === 'roulette') return (stake) => ({ payout: roulettePayout(stake.bet, stake.choice, round.pocket) });
    if (round.game === 'horses') {
        const finish = roundFinish(round);
        return (stake) => ({ payout: horsesPayout(stake.bet, stake.horse, finish) });
    }
    return (stake) => ({ payout: rocketEndPayout(round, stake) });
}

/**
 * The settlement of a round the bot couldn't finish (restart, crash): see the header. A round still taking bets
 * gives every bet back; a flying rocket gives back the bets that cash out by hand.
 */
export function recoveryDecision(round) {
    if (round.status === 'open') return () => ({ refund: true });
    if (round.status === 'flying') {
        return (stake) => (stake.target ? { payout: rocketEndPayout({ ...round, capped: false }, stake) } : { refund: true });
    }
    return endDecision(round);
}

/**
 * Settles a round left by an earlier run (or a timer that died): not when `isLive(round)` says this process
 * still plays it. Returns null when there is nothing to do, else `{ round, results, failed, done }`.
 */
export async function settleStaleRound(client, key, { now = Date.now(), isLive = () => false } = {}) {
    const round = await loadRound(client, key);
    if (!round || isLive(round)) return null;
    const { results, failed } = await settleRound(client, round, recoveryDecision(round));
    const done = !failed.length && await finishRound(client, key, round, { now });
    return { round, results, failed, done };
}

/**
 * Gives back the member's stakes whose round is gone (finished without them, replaced or damaged), in one save.
 * A stake whose round is still saved is left to that round. Returns `{ ok, refunded: [stakes], balance }`.
 */
export async function refundOrphanStakes(client, guildId, userId) {
    return updateCCState(client, guildId || economyScopeId, userId, async (state, record) => {
        const saved = savedStakes(record);
        const keep = [];
        const refunded = [];
        let dropped = 0;
        for (const stake of saved) {
            const readable = stake && typeof stake === 'object' && Number.isSafeInteger(stake.bet) && stake.bet > 0 && stake.bet <= CASINO_BET_LIMITS.ceiling;
            // An entry without a bet that can be read can't be paid or given back: it is dropped.
            if (!readable) { dropped += 1; continue; }
            const round = isStake(stake) && GROUP_GAMES.includes(stake.game) && typeof stake.channelId === 'string'
                ? await loadRound(client, roundKey(stake.game, stake.channelId), stake.round)
                : null;
            (round ? keep : refunded).push(stake);
        }
        if (!refunded.length && !dropped) return { ok: true, refunded: [], skipSave: true };
        for (const stake of refunded) returnBet(state, stake.bet);
        setStakes(record, keep);
        return { ok: true, refunded };
    });
}
