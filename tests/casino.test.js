import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { CASINO } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import {
    choose, minesPayout, minesMultiplierHundredths, coinflipPayout, slotsResult, placeMines, isValidBet,
    startMines, pickMinesCell, cashOutMines, settleIdleMines, attachMinesMessage, playCoinflip, playSlots,
} from '../src/services/cc/casinoService.js';
import { recoverCasinoGames, scheduleIdleCashOut, resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { minesResultPayload, coinflipPayload, slotsPayload } from '../src/services/cc/casinoUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import casinoCommand from '../src/commands/Games/casino.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { applyWordAliases } from '../src/config/commands/commandAliases.js';

const GUILD = '100000000000000001';
const A = '200000000000000001';
const B = '200000000000000002';
const C = '200000000000000003';
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 6, 18);
const key = (userId) => getEconomyKey(economyScopeId, userId);
// Draws that always take the first choice: the mines go on the first cells (3 mines → cells 0, 1, 2),
// the coin lands on heads and every reel shows 🍒.
const firstDraw = () => 0;

function fakeClient(records = {}) {
    const store = new Map(Object.entries(records));
    return {
        store,
        db: {
            get: async (k, fallback = null) => (store.has(k) ? structuredClone(store.get(k)) : fallback),
            set: async (k, value) => { store.set(k, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
        },
    };
}
const fund = (client, userId, amount) => updateCCState(client, GUILD, userId, (state) => { state.cc = amount; return { ok: true }; });
const balance = async (client, userId) => (await getProfile(client, GUILD, userId)).cc;
const saved = (client, userId) => client.store.get(key(userId));
const buttonsOf = (payload) => payload.components.flatMap((row) => row.toJSON().components);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Every way to choose `k` of the cells 0…n−1. */
function combinations(n, k, start = 0) {
    if (k === 0) return [[]];
    const all = [];
    for (let cell = start; cell <= n - k; cell += 1) {
        for (const rest of combinations(n, k - 1, cell + 1)) all.push([cell, ...rest]);
    }
    return all;
}

afterEach(() => resetCasinoSessions());

describe('casino payouts and house edge', () => {
    test('mines returns exactly 97% of the bet (less under 1 CC of rounding) for every mine count and stopping point', () => {
        // The only thing a player learns while playing is "safe so far", so every way of playing is an order
        // of cells plus how many to open; by symmetry the order doesn't matter. Every layout is enumerated.
        const bet = 1000;
        for (let mines = CASINO.mines.min; mines <= CASINO.mines.max; mines += 1) {
            const layouts = combinations(9, mines);
            assert.equal(layouts.length, choose(9, mines));
            for (let picks = 1; picks <= 9 - mines; picks += 1) {
                let total = 0;
                for (const layout of layouts) {
                    if (Array.from({ length: picks }, (_, cell) => cell).every((cell) => !layout.includes(cell))) total += minesPayout(bet, mines, picks);
                }
                const average = total / layouts.length;
                assert.ok(average <= bet * 0.97 + 1e-9 && average > bet * 0.97 - 1, `${mines} mines, ${picks} picks: ${average}`);
            }
        }
    });

    test('rounding down never favours the player; from 100 CC it adds under 1 point to the edge of any game', () => {
        // Expected payout of "open `picks` cells, then cash out" is P(safe) × payout, P(safe) = C(9 − mines, picks) / C(9, picks).
        const minesAverage = (bet, mines, picks) => (choose(9 - mines, picks) / choose(9, picks)) * minesPayout(bet, mines, picks);
        for (let bet = CASINO.minBet; bet <= 2000; bet += 1) {
            for (let mines = 1; mines <= 8; mines += 1) {
                for (let picks = 1; picks <= 9 - mines; picks += 1) {
                    const edge = 1 - minesAverage(bet, mines, picks) / bet;
                    assert.ok(edge >= 0.03 - 1e-12, `${bet} ${mines} ${picks}`);
                    if (bet >= 100) assert.ok(edge < 0.04, `${bet} ${mines} ${picks}`);
                }
            }
            if (bet >= 100) assert.ok(1 - coinflipPayout(bet) / 2 / bet < 0.04);
        }
        // The worst case: 10 CC, 1 mine, one cell. ×1.09 of 10 rounds down to the bet itself (an 11% edge).
        assert.equal(minesPayout(10, 1, 1), 10);
        assert.equal(Math.round((1 - minesAverage(10, 1, 1) / 10) * 1000) / 10, 11.1);
    });

    test('mines multipliers: the bet back before the first pick, ×122.22 at most, safe integers at the bet ceiling', () => {
        assert.equal(minesPayout(1000, 3, 0), 1000);
        assert.equal(minesPayout(1000, 1, 1), 1091); // 1000 × 0.97 × 9/8 = 1091.25
        assert.equal(minesPayout(100, 3, 2), 232); // 100 × 0.97 × 36/15 = 232.8
        assert.equal(minesMultiplierHundredths(3, 0), 100);
        assert.equal(minesMultiplierHundredths(1, 1), 109);
        assert.equal(minesMultiplierHundredths(1, 8), 873);
        let highest = 0;
        for (let mines = 1; mines <= 8; mines += 1) {
            for (let picks = 0; picks <= 9 - mines; picks += 1) {
                highest = Math.max(highest, minesMultiplierHundredths(mines, picks));
                assert.ok(Number.isSafeInteger(minesPayout(1_000_000_000, mines, picks)));
                // Each pick pays more than the one before.
                if (picks) assert.ok(minesPayout(10_000, mines, picks) > minesPayout(10_000, mines, picks - 1));
            }
        }
        assert.equal(highest, 12222);
        assert.throws(() => minesPayout(100, 3, 7), /picks/u);
        assert.throws(() => minesPayout(100, 3, -1), /picks/u);
    });

    test('coinflip pays ×1.94: a 3% edge that rounding only raises, by under 1 CC per win', () => {
        assert.equal(coinflipPayout(100), 194);
        assert.equal(coinflipPayout(10), 19);
        for (let bet = CASINO.minBet; bet <= 5000; bet += 1) {
            const average = coinflipPayout(bet) / 2;
            assert.ok(average <= bet * 0.97 && average > bet * 0.97 - 0.5, String(bet));
        }
    });

    test('slots return exactly 96% over all 125 equally likely spins', () => {
        const kinds = { triple: 0, pair: 0, none: 0 };
        let total = 0;
        for (const a of CASINO.slots.symbols) for (const b of CASINO.slots.symbols) for (const c of CASINO.slots.symbols) {
            const spin = slotsResult([a, b, c], 100);
            kinds[spin.kind] += 1;
            total += spin.payout;
        }
        assert.deepEqual(kinds, { triple: 5, pair: 60, none: 60 });
        assert.equal(total, 125 * 96);
        assert.deepEqual(slotsResult(['🌀', '🌀', '🌀'], 100), { kind: 'triple', symbol: '🌀', multiplier: 25, payout: 2500 });
        assert.equal(slotsResult(['🍒', '💎', '🍒'], 100).payout, 100);
        assert.equal(slotsResult(['🍒', '💎', '🍋'], 100).payout, 0);
    });

    test('mines are different cells, drawn with the given random source, and a bad draw stops the game', () => {
        assert.deepEqual(placeMines(3, firstDraw), [0, 1, 2]);
        for (let i = 0; i < 200; i += 1) {
            const cells = placeMines(8);
            assert.equal(new Set(cells).size, 8);
            assert.ok(cells.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < 9));
        }
        for (const bad of [() => -1, () => 9, () => 0.5, () => NaN]) assert.throws(() => placeMines(3, bad), /random draw/u);
    });
});

describe('casino bets', () => {
    test('a bet is a whole number from the minimum to CASINO_MAX_BET and never more than the balance', async () => {
        for (const bad of [0, -10, 9, 10.5, NaN, Infinity, '100', null, undefined, CASINO.maxBet + 1, 2 ** 53]) assert.equal(isValidBet(bad), false, String(bad));
        assert.ok(isValidBet(CASINO.minBet));
        assert.ok(isValidBet(CASINO.maxBet));
        const client = fakeClient();
        await fund(client, A, 50);
        for (const bet of [9, -100, 10.5, NaN, '20']) {
            assert.equal((await startMines(client, GUILD, A, { bet })).reason, 'bad_bet');
            assert.equal((await playCoinflip(client, GUILD, A, { bet })).reason, 'bad_bet');
            assert.equal((await playSlots(client, GUILD, A, { bet })).reason, 'bad_bet');
        }
        for (const mines of [0, 9, 2.5, NaN]) assert.equal((await startMines(client, GUILD, A, { bet: 20, mines })).reason, 'bad_mines');
        assert.equal((await playCoinflip(client, GUILD, A, { bet: 20, side: 'edge' })).reason, 'bad_side');
        assert.deepEqual(await startMines(client, GUILD, A, { bet: 100 }), { ok: false, reason: 'no_cc', balance: 50, previous: null, skipSave: true });
        assert.equal((await playCoinflip(client, GUILD, A, { bet: 51 })).reason, 'no_cc');
        assert.equal((await playSlots(client, GUILD, A, { bet: 51 })).reason, 'no_cc');
        assert.equal(await balance(client, A), 50);
        assert.equal(saved(client, A).ccCasino, undefined);
        // Everything that fits the balance works, down to zero, never below.
        const all = await playCoinflip(client, GUILD, A, { bet: 50, side: 'tails' }, { randomInt: firstDraw });
        assert.deepEqual([all.ok, all.landed, all.payout, all.balance], [true, 'heads', 0, 0]);
    });

    test('concurrent bets can neither overdraw nor open a second game', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const starts = await Promise.all(Array.from({ length: 5 }, () => startMines(client, GUILD, A, { bet: 300 }, { now: T0 })));
        assert.equal(starts.filter((result) => result.ok).length, 1);
        assert.deepEqual(starts.filter((result) => !result.ok).map((result) => result.reason), ['active', 'active', 'active', 'active']);
        assert.equal(await balance(client, A), 700);
        // Coinflip and slots wait for the running board too.
        assert.equal((await playSlots(client, GUILD, A, { bet: 100 }, { now: T0 + 1000 })).reason, 'active');
        assert.equal((await playCoinflip(client, GUILD, A, { bet: 100 }, { now: T0 + 1000 })).reason, 'active');

        const other = fakeClient();
        await fund(other, B, 100);
        const tails = () => 1;
        const flips = await Promise.all(Array.from({ length: 5 }, () => playCoinflip(other, GUILD, B, { bet: 100, side: 'heads' }, { randomInt: tails })));
        assert.equal(flips.filter((result) => result.ok).length, 1);
        assert.equal(flips.filter((result) => result.reason === 'no_cc').length, 4);
        assert.equal(await balance(other, B), 0);
        const spins = await Promise.all(Array.from({ length: 3 }, () => playSlots(other, GUILD, B, { bet: 10 })));
        assert.ok(spins.every((result) => result.reason === 'no_cc'));
    });

    test('a failed save takes no bet and starts no game (one SQL transaction, rolled back)', async () => {
        let rows = new Map();
        let snapshot;
        let failSaves = false;
        const calls = [];
        const query = async (sql, params = []) => {
            calls.push(sql.split(' ')[0]);
            if (sql === 'BEGIN') snapshot = structuredClone(rows);
            if (sql === 'ROLLBACK') rows = snapshot;
            if (sql.startsWith('SELECT value')) return { rows: rows.has(params[0]) ? [{ value: structuredClone(rows.get(params[0])) }] : [] };
            if (sql.startsWith('INSERT')) {
                if (failSaves) throw new Error('disk failure');
                rows.set(params[0], JSON.parse(params[1]));
            }
            return { rows: [] };
        };
        const db = Object.assign(Object.create(PostgreSQLDatabase.prototype), { context: new AsyncLocalStorage(), pool: { query, connect: async () => ({ query, release: () => {} }) } });
        const client = { db };
        await fund(client, A, 1000);
        failSaves = true;
        await assert.rejects(startMines(client, GUILD, A, { bet: 100 }), /disk failure/u);
        await assert.rejects(playSlots(client, GUILD, A, { bet: 100 }), /disk failure/u);
        failSaves = false;
        assert.equal(await balance(client, A), 1000);
        assert.equal(rows.get(key(A)).ccCasino, undefined);
        assert.equal(calls.filter((call) => call === 'ROLLBACK').length, 2);
        assert.ok((await startMines(client, GUILD, A, { bet: 100 })).ok);
        assert.equal(rows.get(key(A)).cc, 900);
    });
});

describe('mines', () => {
    test('a board pays once: a double click opens nothing twice and a second cash-out is refused', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const start = await startMines(client, GUILD, A, { bet: 100, mines: 3, channelId: ROOM }, { now: T0, randomInt: firstDraw });
        assert.deepEqual([start.ok, start.before, start.balance], [true, 1000, 900]);
        const { game } = start;
        assert.deepEqual(saved(client, A).ccCasino.mines, [0, 1, 2]);
        assert.deepEqual(saved(client, A).ccStats, { earned: 0, spent: 100 });

        assert.equal((await pickMinesCell(client, GUILD, A, game.id, 4, { now: T0 + 1000 })).outcome, 'safe');
        const twice = await Promise.all([5, 5].map((cell) => pickMinesCell(client, GUILD, A, game.id, cell, { now: T0 + 2000 })));
        assert.deepEqual(twice.map((result) => result.outcome).sort(), ['duplicate', 'safe']);
        assert.deepEqual(saved(client, A).ccCasino.picks, [4, 5]);
        assert.equal(saved(client, A).ccCasino.lastActionAt, T0 + 2000);

        const cashes = await Promise.all([1, 2].map(() => cashOutMines(client, GUILD, A, game.id, { now: T0 + 3000 })));
        assert.deepEqual(cashes.map((result) => result.ok ? result.outcome : result.reason).sort(), ['cashout', 'stale']);
        const paid = cashes.find((result) => result.ok);
        assert.equal(paid.payout, minesPayout(100, 3, 2));
        assert.equal(paid.balance, 900 + 232);
        assert.equal(await balance(client, A), 1132);
        const record = saved(client, A);
        assert.equal(record.ccCasino, undefined);
        assert.deepEqual(record.ccStats, { earned: 232, spent: 100 });
        assert.deepEqual(record.ccCasinoStats, { played: 1, won: 1, lost: 0, wagered: 100, paidOut: 232 });

        // The ended game's buttons do nothing any more.
        assert.equal((await pickMinesCell(client, GUILD, A, game.id, 6, { now: T0 + 4000 })).reason, 'stale');
        assert.equal((await cashOutMines(client, GUILD, A, game.id, { now: T0 + 4000 })).reason, 'stale');
        // Neither does an older game's button on a new board, or a cell outside the board.
        const next = await startMines(client, GUILD, A, { bet: 100 }, { now: T0 + 5000, randomInt: firstDraw });
        assert.equal((await cashOutMines(client, GUILD, A, game.id, { now: T0 + 6000 })).reason, 'stale');
        for (const cell of [9, -1, 1.5, NaN]) assert.equal((await pickMinesCell(client, GUILD, A, next.game.id, cell, { now: T0 + 6000 })).reason, 'stale');
        assert.equal(await balance(client, A), 1032);
    });

    test('a mine loses the bet and shows every mine; opening every safe cell pays the top multiplier', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startMines(client, GUILD, A, { bet: 100, mines: 3 }, { now: T0, randomInt: firstDraw });
        await pickMinesCell(client, GUILD, A, game.id, 8, { now: T0 + 1000 });
        const boom = await pickMinesCell(client, GUILD, A, game.id, 1, { now: T0 + 2000 });
        assert.deepEqual([boom.outcome, boom.payout, boom.balance, boom.game.hit], ['lost', 0, 900, 1]);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 1, won: 0, lost: 1, wagered: 100, paidOut: 0 });
        const shown = buttonsOf(minesResultPayload(boom, A));
        assert.equal(shown.length, 9);
        assert.ok(shown.every((button) => button.disabled));
        assert.deepEqual(shown.map((button) => button.emoji.name), ['💣', '💥', '💣', '💎', '💎', '💎', '💎', '💎', '💎']);

        // 8 mines: one safe cell, ×8.73.
        const all = await startMines(client, GUILD, A, { bet: 100, mines: 8 }, { now: T0 + 3000, randomInt: firstDraw });
        const cleared = await pickMinesCell(client, GUILD, A, all.game.id, 8, { now: T0 + 4000 });
        assert.deepEqual([cleared.outcome, cleared.payout, cleared.balance], ['cleared', 873, 800 + 873]);
        assert.equal(saved(client, A).ccCasino, undefined);
    });

    test('a board left alone cashes out at its multiplier, and gives the bet back with nothing opened', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startMines(client, GUILD, A, { bet: 100, mines: 3 }, { now: T0, randomInt: firstDraw });
        await pickMinesCell(client, GUILD, A, game.id, 4, { now: T0 + 10_000 });
        const early = await settleIdleMines(client, GUILD, A, game.id, { now: T0 + 10_000 + CASINO.idleMs - 1 });
        assert.deepEqual([early.reason, early.remainingMs], ['active', 1]);
        assert.equal(await balance(client, A), 900);
        const settled = await settleIdleMines(client, GUILD, A, game.id, { now: T0 + 10_000 + CASINO.idleMs });
        assert.deepEqual([settled.outcome, settled.payout, settled.balance], ['timeout', 145, 1045]); // 100 × 0.97 × 9/6 = 145.5
        assert.equal((await settleIdleMines(client, GUILD, A, game.id, { now: T0 + 999_999 })).reason, 'stale');

        // A click that arrives after the timeout cashes out instead of opening the cell.
        const late = await startMines(client, GUILD, A, { bet: 100 }, { now: T0 + 100_000, randomInt: firstDraw });
        const click = await pickMinesCell(client, GUILD, A, late.game.id, 0, { now: T0 + 100_000 + CASINO.idleMs });
        assert.deepEqual([click.outcome, click.payout, click.balance], ['timeout', 100, 1045]);

        // A new game first settles a board whose timer never ran (it was idle past the timeout).
        const stuck = await startMines(client, GUILD, A, { bet: 100 }, { now: T0 + 200_000, randomInt: firstDraw });
        await pickMinesCell(client, GUILD, A, stuck.game.id, 4, { now: T0 + 201_000 });
        const fresh = await startMines(client, GUILD, A, { bet: 100 }, { now: T0 + 201_000 + CASINO.idleMs, randomInt: firstDraw });
        assert.deepEqual([fresh.ok, fresh.previous.outcome, fresh.previous.payout, fresh.balance], [true, 'timeout', 145, 1045 - 100 + 145 - 100]);
    });

    test('the inactivity timer cashes the board out by itself and updates its message, retrying a failed save', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startMines(client, GUILD, A, { bet: 100, mines: 3 }, { randomInt: firstDraw });
        const edits = [];
        const realSet = client.db.set;
        let failures = 1;
        client.db.set = async (k, value) => {
            if (failures > 0) { failures -= 1; throw new Error('database down'); }
            return realSet(k, value);
        };
        const retry = CASINO.idleRetryMs;
        CASINO.idleRetryMs = 10;
        try {
            scheduleIdleCashOut(client, game, A, { edit: async (payload) => { edits.push(payload); }, idleMs: 20 });
            await wait(250);
        } finally {
            CASINO.idleRetryMs = retry;
        }
        assert.equal(failures, 0);
        assert.equal(await balance(client, A), 1000);
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.equal(edits.length, 1);
        assert.match(edits[0].embeds[0].description, /كاش أوت لوحدها/u);
        assert.ok(buttonsOf(edits[0]).every((button) => button.disabled));
    });

    test('a restart settles the boards whose timeout passed (or that are damaged) and times the others again', async () => {
        const now = T0 + 10 * 60_000;
        const idle = { id: 'aaaaaaaaaaaa', game: 'mines', bet: 200, mines: [0, 1, 2], picks: [3, 4], guildId: GUILD, channelId: ROOM, messageId: '500000000000000001', startedAt: T0, lastActionAt: T0 };
        // Started right before the restart, before its message was even sent.
        const running = { ...idle, id: 'bbbbbbbbbbbb', picks: [], messageId: null, startedAt: now - 5_000, lastActionAt: now - 5_000 };
        const damaged = { game: 'mines', bet: 300, channelId: ROOM, mines: 'oops' };
        const client = fakeClient({
            [key(A)]: { cc: 0, ccCasino: idle },
            [key(B)]: { cc: 50, ccCasino: running },
            [key(C)]: { cc: 10, ccCasino: damaged },
        });
        const edited = [];
        const sent = [];
        client.channels = { fetch: async (id) => (id === ROOM ? { messages: { edit: async (messageId, payload) => { edited.push({ messageId, payload }); } }, send: async (payload) => { sent.push(payload); } } : null) };

        assert.deepEqual(await recoverCasinoGames(client, { now }), { settled: 2, resumed: 1, failed: 0 });
        assert.equal(await balance(client, A), 465); // 200 × 0.97 × 36/15 = 465.6
        assert.equal(saved(client, A).ccCasino, undefined);
        assert.equal(await balance(client, C), 310);
        assert.equal(saved(client, C).ccCasino, undefined);
        assert.equal(saved(client, B).ccCasino.id, 'bbbbbbbbbbbb');
        assert.equal(await balance(client, B), 50);
        assert.equal(edited.length, 1);
        assert.equal(edited[0].messageId, '500000000000000001');
        assert.ok(buttonsOf(edited[0].payload).every((button) => button.disabled));
        assert.equal(sent.length, 1);
        assert.match(sent[0].content, new RegExp(`<@${C}>.*رهانك`, 'u'));
        assert.deepEqual(sent[0].allowedMentions, { users: [C] });

        // Once its timeout passes the untouched board gives the whole bet back, also across another restart.
        assert.deepEqual(await recoverCasinoGames(client, { now: now + CASINO.idleMs }), { settled: 1, resumed: 0, failed: 0 });
        assert.equal(await balance(client, B), 250);
        assert.deepEqual(await recoverCasinoGames(client, { now: now + CASINO.idleMs }), { settled: 0, resumed: 0, failed: 0 });
    });
});

describe('casino buttons and commands', () => {
    function pressed(userId, log, channelId = ROOM) {
        return {
            inGuild: () => true, guildId: GUILD, channelId, user: { id: userId },
            deferUpdate: async () => {},
            editReply: async (payload) => { log.edits.push(payload); },
            followUp: async (payload) => { log.followUps.push(payload); },
            reply: async (payload) => { log.replies.push(payload); },
        };
    }

    test('board buttons work only for the player, and a double-clicked cash-out pays once', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { game } = await startMines(client, GUILD, A, { bet: 100, mines: 3 }, { randomInt: firstDraw });
        const other = { edits: [], followUps: [], replies: [] };
        await casinoButtons.execute(pressed(B, other), { db: { get: () => assert.fail('another member must not reach the database') } }, ['pick', game.id, '4', A]);
        await casinoButtons.execute(pressed(B, other), { db: { get: () => assert.fail('another member must not reach the database') } }, ['cashout', game.id, A]);
        assert.equal(other.replies.length, 2);
        assert.ok(other.replies.every((reply) => /مش ليك/u.test(reply.content)));
        // A button pointing at B's own (empty) record changes nothing either.
        await casinoButtons.execute(pressed(B, other), client, ['cashout', game.id, B]);
        assert.match(other.followUps[0].content, /خلصت/u);

        const log = { edits: [], followUps: [], replies: [] };
        await casinoButtons.execute(pressed(A, log), client, ['pick', game.id, '4', A]);
        const board = buttonsOf(log.edits[0]);
        assert.equal(board.length, 10);
        assert.deepEqual([board[4].disabled, board[4].emoji.name], [true, '💎']);
        assert.equal(board[9].custom_id, `casino:cashout:${game.id}:${A}`);
        await Promise.all([1, 2].map(() => casinoButtons.execute(pressed(A, log), client, ['cashout', game.id, A])));
        assert.equal(log.followUps.length, 1);
        assert.match(log.followUps[0].content, /خلصت/u);
        assert.equal(await balance(client, A), 900 + minesPayout(100, 3, 1));
        assert.ok(buttonsOf(log.edits.at(-1)).every((button) => button.disabled));
        assert.match(log.edits.at(-1).embeds[0].description, /كاش أوت/u);
        // Malformed buttons are refused before anything happens.
        for (const args of [['pick', game.id, 'x', A], ['pick', game.id, A], ['open', game.id, A], ['cashout', '', A]]) {
            await casinoButtons.execute(pressed(A, log), { db: { get: () => assert.fail('db') } }, args);
        }
        assert.ok(log.replies.slice(-4).every((reply) => /مبقاش شغال/u.test(reply.content)));
    });

    test('/casino mines shows a board that hides the mines; the start cooldown covers every game', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const replies = [];
        const slash = (options) => ({
            commandName: 'casino', guildId: GUILD, channelId: ROOM, user: { id: A, toString: () => `<@${A}>` },
            options: { getSubcommand: () => options.sub, getInteger: (name) => options[name] ?? null, getString: (name) => options[name] ?? null },
            isChatInputCommand: () => true,
            async deferReply() { this.deferred = true; },
            async editReply(payload) { replies.push(payload); return { id: '600000000000000001' }; },
            reply: async () => assert.fail('must edit the deferred reply'),
        });
        await interactionCreate.execute(slash({ sub: 'mines', bet: 100, mines: 3 }), client);
        const game = saved(client, A).ccCasino;
        assert.deepEqual([game.bet, game.mines.length, game.channelId, game.messageId], [100, 3, ROOM, '600000000000000001']);
        const buttons = buttonsOf(replies[0]);
        assert.equal(buttons.length, 10);
        // Every closed cell is the same button apart from its own id: nothing tells a mine apart.
        assert.equal(new Set(buttons.slice(0, 9).map(({ custom_id: _id, ...look }) => JSON.stringify(look))).size, 1);
        assert.ok(buttons.slice(0, 9).every((button, cell) => button.custom_id === `casino:pick:${game.id}:${cell}:${A}`));
        assert.match(replies[0].embeds[0].description, /60 ثانية/u);
        // Cashing out now gives the bet back; the next safe cell (3 mines) pays 0.97 × 9/6 = ×1.45.
        assert.match(replies[0].embeds[0].description, /×1\.00[\s\S]*×1\.45\*\* ← \*\*145\*\*/u);
        assert.match(buttons[9].label, /100 CC/u);
        assert.equal(await balance(client, A), 900);

        await interactionCreate.execute(slash({ sub: 'slots', bet: 100 }), client);
        assert.match(replies[1].content, /استنى/u);
        resetCasinoSessions();
        await interactionCreate.execute(slash({ sub: 'coinflip', bet: 100, side: 'heads' }), client);
        assert.match(replies[2].content, /لعبة ماينز شغالة/u);
        resetCasinoSessions();
        await interactionCreate.execute(slash({ sub: 'mines', bet: 5 }), client);
        assert.match(replies[3].content, /الرهان لازم يكون/u);
        assert.equal(await balance(client, A), 900);
    });

    test('coinflip and slots pay in the same save and say what happened', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const user = { id: A, toString: () => `<@${A}>` };
        const flip = await playCoinflip(client, GUILD, A, { bet: 100, side: 'heads' }, { randomInt: firstDraw });
        assert.deepEqual([flip.landed, flip.payout, flip.before, flip.balance], ['heads', 194, 1000, 1094]);
        const lost = await playCoinflip(client, GUILD, A, { bet: 100, side: 'heads' }, { randomInt: () => 1 });
        assert.deepEqual([lost.landed, lost.payout, lost.balance], ['tails', 0, 994]);
        const spin = await playSlots(client, GUILD, A, { bet: 100 }, { randomInt: firstDraw });
        assert.deepEqual([spin.reels, spin.kind, spin.payout, spin.balance], [['🍒', '🍒', '🍒'], 'triple', 400, 1294]);
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 3, won: 2, lost: 1, wagered: 300, paidOut: 594 });
        assert.deepEqual(saved(client, A).ccStats, { earned: 594, spent: 300 });
        assert.match(coinflipPayload(flip, user).embeds[0].description, /كسبت/u);
        assert.match(coinflipPayload(lost, user).embeds[0].description, /خسرت/u);
        assert.match(slotsPayload(spin, user).embeds[0].description, /🍒 \| 🍒 \| 🍒/u);
        assert.match(slotsPayload(spin, user).embeds[0].footer.text, /^🌀🌀🌀 ×25/u);
    });

    test('typed casino words play in the casino room and stay quiet in chat', async () => {
        assert.deepEqual(applyWordAliases('مينز', ['100', '3'], false), { commandName: 'casino', args: ['mines', '100', '3'] });
        assert.deepEqual(applyWordAliases('عملة', ['100', 'ملك'], false), { commandName: 'casino', args: ['coinflip', '100', 'ملك'] });
        assert.deepEqual(applyWordAliases('cf', ['كتابة', '50'], false), { commandName: 'casino', args: ['coinflip', 'كتابة', '50'] });
        assert.deepEqual(applyWordAliases('سلوت', ['100'], false), { commandName: 'casino', args: ['slots', '100'] });
        for (const [word, args] of [['عملة', ['رقمية']], ['الغام', ['كتير', 'اوي']], ['عمله', ['100', 'جنيه']], ['سلوت', ['حلو']], ['casino', ['is', 'fun']]]) {
            assert.equal(applyWordAliases(word, args, false), null, word);
        }
        const parse = (args) => {
            const parsed = casinoCommand.parsePrefixArgs(args);
            return parsed.error ? 'error' : [parsed.options.getSubcommand(), parsed.options.getInteger('bet'), parsed.options.getInteger('mines'), parsed.options.getString('side')];
        };
        assert.deepEqual(parse(['mines', '100']), ['mines', 100, null, null]);
        assert.deepEqual(parse(['mines', '100', '5']), ['mines', 100, 5, null]);
        assert.deepEqual(parse(['coinflip', 'كتابة', '70']), ['coinflip', 70, null, 'tails']);
        for (const bad of [[], ['mines'], ['slots', '1', '2'], ['coinflip', 'ملك'], ['coinflip', '1', '2'], ['poker', '100'], ['mines', 'x']]) assert.equal(parse(bad), 'error', bad.join(' '));
        assert.match(casinoCommand.parsePrefixArgs(['coinflip', '100', 'edge']).error, /ملك/u);

        const client = fakeClient();
        await fund(client, A, 1000);
        await loadCommands(client);
        const sent = [];
        const channel = {
            id: ROOM,
            send: async (payload) => {
                const message = { id: `70000000000000000${sent.length}`, ...payload, edit: async (update) => { message.edited = update; } };
                sent.push(message);
                return message;
            },
        };
        const typed = (content) => messageCreate.execute({ guildId: GUILD, content, author: { id: A, bot: false, toString: () => `<@${A}>` }, channel, channelId: ROOM }, client);
        await typed('مينز 100 2');
        const game = saved(client, A).ccCasino;
        assert.deepEqual([game.bet, game.mines.length, game.messageId], [100, 2, sent[0].id]);
        assert.equal(buttonsOf(sent[0]).length, 10);
        await typed('سلوت');
        assert.match(sent[1].content, /الكازينو/u);
        await typed('عملة رقمية جديدة');
        assert.equal(sent.length, 2);
        assert.equal(await balance(client, A), 900);
    });
});

describe('casino configuration', () => {
    const FIRST = '100000000000000001';
    const BOURSE_ROOM = '400000000000000001';
    const CASINO_ROOM = '400000000000000002';
    const url = (path) => JSON.stringify(new URL(path, import.meta.url).href);

    function run(env, code) {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; const runtime = await import(${url('../src/config/runtime.js')}); ${code}`], {
            cwd: new URL('../', import.meta.url),
            env: {
                ...process.env,
                BOURSE_GUILD_IDS: FIRST, ECONOMY_SCOPE_ID: FIRST, BOURSE_CHANNEL_IDS: '', CASINO_CHANNEL_IDS: '', CASINO_MAX_BET: '',
                INITIAL_CC: '0', TRADER_ROLE_ANCHORS: '', DATABASE_URL: 'postgresql://test:test@localhost/bourse_test', LOG_LEVEL: 'silent',
                ...env,
            },
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
    }

    test('CASINO_CHANNEL_IDS gives the casino its own rooms; empty, it follows BOURSE_CHANNEL_IDS', () => {
        run({ BOURSE_CHANNEL_IDS: BOURSE_ROOM }, `
            assert.equal(runtime.isCasinoChannel({id:'${BOURSE_ROOM}'}), true);
            assert.equal(runtime.isCasinoChannel({id:'other'}), false);
        `);
        run({ BOURSE_CHANNEL_IDS: BOURSE_ROOM, CASINO_CHANNEL_IDS: CASINO_ROOM }, `
            assert.equal(runtime.isCasinoChannel({id:'${CASINO_ROOM}'}), true);
            assert.equal(runtime.isCasinoChannel({id:'thread',parentId:'${CASINO_ROOM}'}), true);
            assert.equal(runtime.isCasinoChannel({id:'${BOURSE_ROOM}'}), false);
            assert.equal(runtime.isAllowedChannel({id:'${CASINO_ROOM}'}), false);
            const { default: interactionCreate } = await import(${url('../src/events/interactionCreate.js')});
            const { default: messageCreate } = await import(${url('../src/events/messageCreate.js')});
            const ran = [];
            const client = { commands: new Map([['casino', { execute: async (i) => ran.push(['casino', i.channelId]), parsePrefixArgs: (args) => ({ options: { args } }) }], ['bourse', { execute: async (i) => ran.push(['bourse', i.channelId]) }]]), buttons: new Map([['casino', { execute: async () => ran.push(['button']) }]]) };
            const replies = [];
            const slash = (commandName, channelId) => ({ guildId:'${FIRST}', commandName, channelId, user:{id:'1'}, isChatInputCommand:()=>true, isRepliable:()=>true, reply:async p=>replies.push(p.content), deferReply:async()=>{} });
            await interactionCreate.execute(slash('casino','${BOURSE_ROOM}'), client);
            await interactionCreate.execute(slash('bourse','${CASINO_ROOM}'), client);
            await interactionCreate.execute({ guildId:'${FIRST}', channelId:'${BOURSE_ROOM}', customId:'casino:cashout:x:1', isChatInputCommand:()=>false, isButton:()=>true, isRepliable:()=>true, reply:async p=>replies.push(p.content) }, client);
            assert.deepEqual(ran, []);
            assert.match(replies[0], /<#${CASINO_ROOM}>/u);
            assert.match(replies[1], /مش متاح/u);
            assert.match(replies[2], /<#${CASINO_ROOM}>/u);
            await interactionCreate.execute(slash('casino','${CASINO_ROOM}'), client);
            await interactionCreate.execute({ guildId:'${FIRST}', channelId:'${CASINO_ROOM}', customId:'casino:cashout:x:1', isChatInputCommand:()=>false, isButton:()=>true, isRepliable:()=>true, reply:async()=>{} }, client);
            await interactionCreate.execute(slash('bourse','${BOURSE_ROOM}'), client);
            assert.deepEqual(ran, [['casino','${CASINO_ROOM}'], ['button'], ['bourse','${BOURSE_ROOM}']]);
            const typed = (content, id) => messageCreate.execute({ guildId:'${FIRST}', content, author:{id:'1',bot:false}, channel:{ id, send: async () => assert.fail('nothing to say outside the casino') } }, client);
            await typed('سلوت 100', '${BOURSE_ROOM}');
            assert.equal(ran.length, 3);
            await typed('سلوت 100', '${CASINO_ROOM}');
            assert.equal(ran.length, 4);
        `);
    });

    test('CASINO_MAX_BET sets the cap and the slash limits; an invalid cap or room stops the bot at startup', () => {
        run({ CASINO_MAX_BET: '1000' }, `
            assert.doesNotThrow(() => runtime.validateConfig({ discord: false }));
            const { isValidBet } = await import(${url('../src/services/cc/casinoService.js')});
            assert.equal(isValidBet(1000), true);
            assert.equal(isValidBet(1001), false);
            const { default: casino } = await import(${url('../src/commands/Games/casino.js')});
            const bet = casino.data.toJSON().options[0].options[0];
            assert.deepEqual([bet.name, bet.min_value, bet.max_value, bet.required], ['bet', 10, 1000, true]);
        `);
        run({}, `assert.equal(runtime.casinoMaxBet, runtime.CASINO_BET_LIMITS.ceiling); assert.doesNotThrow(() => runtime.validateConfig({ discord: false }));`);
        for (const value of ['5', '10.5', 'abc', '-100', '20000000000000']) {
            run({ CASINO_MAX_BET: value }, `assert.throws(() => runtime.validateConfig({ discord: false }), /CASINO_MAX_BET/);`);
        }
        run({ CASINO_CHANNEL_IDS: 'not-a-room' }, `assert.throws(() => runtime.validateConfig({ discord: false }), /CASINO_CHANNEL_IDS/);`);
    });
});
