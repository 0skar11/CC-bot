import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CASINO } from '../src/config/casino.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { casinoEdges } from '../src/services/cc/casinoService.js';
import {
    pocketColor, roulettePayout, rocketMultiplierAt, rocketTimeTo, rocketExit, rocketEndPayout, roundKey, joinRound, spinRoulette,
    settleRound, endDecision, finishRound, launchRocket, cashOutRocket, crashRocket,
} from '../src/services/cc/casinoGroupService.js';
import { placeGroupBet, rocketCashOut, recoverGroupGames, resetGroupSessions, liveRound } from '../src/services/cc/casinoGroupSessions.js';
import { resetCasinoSessions } from '../src/services/cc/casinoSessions.js';
import { rouletteResultPayload, rocketClickText, rocketFlightPayload } from '../src/services/cc/casinoGroupUi.js';
import casinoButtons from '../src/interactions/buttons/store/casino.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { createSnapshot, validateSnapshot } from '../scripts/lib/bourseBackup.js';

const GUILD = '100000000000000001';
const [A, B, C, D, E] = ['200000000000000001', '200000000000000002', '200000000000000003', '200000000000000004', '200000000000000005'];
const ROOM = '400000000000000001';
const T0 = Date.UTC(2026, 10, 7, 18);
const N = CASINO.crash.draws;
const economyKey = (userId) => getEconomyKey(economyScopeId, userId);
/** The draw that makes the crash point land on (just over) `hundredths`. */
const drawFor = (hundredths) => () => N - Math.floor((97 * N) / hundredths);
const timings = structuredClone({ roulette: CASINO.roulette, rocket: CASINO.rocket, groupRenderMs: CASINO.groupRenderMs, idleRetryMs: CASINO.idleRetryMs });

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
const saved = (client, userId) => client.store.get(economyKey(userId));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(check, timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('timed out');
        await wait(5);
    }
}

afterEach(() => {
    resetGroupSessions();
    resetCasinoSessions();
    Object.assign(CASINO.roulette, timings.roulette);
    Object.assign(CASINO.rocket, timings.rocket);
    CASINO.groupRenderMs = timings.groupRenderMs;
    CASINO.idleRetryMs = timings.idleRetryMs;
});

describe('group games: payouts and house edge', () => {
    test('roulette pays back exactly 36/37 of every bet over the 37 pockets (2.70%)', () => {
        const colors = { red: 0, black: 0, green: 0 };
        for (let pocket = 0; pocket < 37; pocket += 1) colors[pocketColor(pocket)] += 1;
        assert.deepEqual(colors, { red: 18, black: 18, green: 1 });
        for (const choice of ['red', 'black', ...Array.from({ length: 37 }, (_, pocket) => pocket)]) {
            let total = 0;
            for (let pocket = 0; pocket < 37; pocket += 1) total += roulettePayout(100, choice, pocket);
            assert.equal(total, 3_600, String(choice));
        }
        assert.deepEqual([pocketColor(32), pocketColor(15), pocketColor(0)], ['red', 'black', 'green']);
        assert.equal(roulettePayout(100, 0, 0), 3_600);
        assert.equal(casinoEdges().roulette, 2.7);
    });

    test('the rocket doubles every doubleMs; a rider leaves at their automatic cash-out, or by hand below the crash point', () => {
        const { doubleMs } = CASINO.rocket;
        assert.deepEqual([rocketMultiplierAt(-5), rocketMultiplierAt(0), rocketMultiplierAt(doubleMs), rocketMultiplierAt(2 * doubleMs)], [100, 100, 200, 400]);
        assert.ok(rocketMultiplierAt(rocketTimeTo(250)) >= 250);
        assert.ok(rocketMultiplierAt(rocketTimeTo(250) - 2) < 250);
        assert.equal(rocketTimeTo(100), 0);
        assert.equal(rocketExit({}, 180, 250), 180);
        assert.equal(rocketExit({}, 250, 250), null);
        assert.equal(rocketExit({ target: 200 }, 180, 250), 180);
        assert.equal(rocketExit({ target: 200 }, 260, 250), 200);
        assert.equal(rocketExit({ target: 250 }, 300, 250), 250); // a tie wins, like crash
        assert.equal(rocketExit({ target: 300 }, 300, 250), null);
    });

    test('a rocket cash-out returns at most 97% at any multiplier, and exactly 97% at an automatic cash-out or the top', () => {
        for (let multiplier = 100; multiplier < CASINO.crash.maxTarget; multiplier += 1) {
            // By hand at m: paid only while the crash point is above m, i.e. at m + 1 or more.
            const above = Math.floor((97 * N) / (multiplier + 1));
            assert.ok(multiplier * above < 97 * N, String(multiplier));
        }
        const top = CASINO.crash.maxTarget;
        const reach = Math.floor((97 * N) / top);
        assert.ok(top * reach <= 97 * N && 97 * N - top * reach < top);
        assert.equal(rocketEndPayout({ crash: top, capped: true }, { bet: 100 }), 10_000);
        assert.equal(rocketEndPayout({ crash: 250, capped: false }, { bet: 100, target: 200 }), 200);
        assert.equal(rocketEndPayout({ crash: 250, capped: false }, { bet: 100, target: 300 }), 0);
        assert.equal(rocketEndPayout({ crash: 250, capped: false }, { bet: 100 }), 0);
    });
});

describe('group rounds: bets and payouts', () => {
    test('a bet is taken and written into the round together; one rocket seat per member, five roulette bets', async () => {
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        const key = roundKey('roulette', ROOM);
        assert.equal(key, `guild:${economyScopeId}:casino:roulette:${ROOM}`);
        const opened = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' }, { now: T0 });
        assert.deepEqual([opened.ok, opened.created, opened.before, opened.balance], [true, true, 1000, 900]);
        assert.deepEqual([opened.round.status, opened.round.closesAt], ['open', T0 + CASINO.roulette.joinMs]);
        assert.deepEqual(client.store.get(key).bets, [{ userId: A, bet: 100, choice: 'red' }]);
        assert.deepEqual(saved(client, A).ccCasinoBets, [{ round: opened.round.id, game: 'roulette', channelId: ROOM, bet: 100, choice: 'red', at: T0 }]);
        assert.deepEqual(saved(client, A).ccStats, { earned: 0, spent: 100 });
        const joined = await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: 50, pick: 17 }, { now: T0 + 1000 });
        assert.deepEqual([joined.ok, joined.created, joined.round.id], [true, false, opened.round.id]);
        for (let pocket = 0; pocket < 4; pocket += 1) assert.ok((await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 10, pick: pocket }, { now: T0 + 2000 })).ok);
        const refused = async (userId, settings, now = T0 + 2000) => (await joinRound(client, GUILD, userId, 'roulette', { channelId: ROOM, ...settings }, { now })).reason;
        assert.equal(await refused(A, { bet: 10, pick: 5 }), 'too_many');
        assert.equal(await refused(B, { bet: 5000, pick: 5 }), 'no_cc');
        assert.equal(await refused(B, { bet: 10, pick: 37 }), 'bad_choice');
        assert.equal(await refused(B, { bet: 10, pick: 'blue' }), 'bad_choice');
        assert.equal(await refused(B, { bet: 9, pick: 'red' }), 'bad_bet');
        // The bets close when the round's time is up.
        assert.equal(await refused(B, { bet: 10, pick: 'red' }, opened.round.closesAt), 'busy');
        assert.equal(client.store.get(key).bets.length, 6);
        assert.deepEqual([await balance(client, A), await balance(client, B)], [860, 950]);

        // A member without the CC opens nothing; one seat per rider.
        await fund(client, C, 0);
        const empty = await joinRound(client, GUILD, C, 'rocket', { channelId: ROOM, bet: 100 }, { now: T0 });
        assert.deepEqual([empty.reason, empty.balance], ['no_cc', 0]);
        assert.equal(client.store.has(roundKey('rocket', ROOM)), false);
        assert.ok((await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: 100, pick: 200 }, { now: T0 })).created);
        assert.equal((await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: 100 }, { now: T0 })).reason, 'joined');
        assert.equal((await joinRound(client, GUILD, B, 'rocket', { channelId: ROOM, bet: 100, pick: 10_001 }, { now: T0 })).reason, 'bad_target');
        assert.equal(saved(client, A).ccCasinoBets.length, 6);
        assert.equal(await balance(client, A), 760);
    });

    test('the wheel is spun once and every roulette stake is paid exactly once, even when settled twice at the same time', async () => {
        const client = fakeClient();
        for (const id of [A, B, C]) await fund(client, id, 1000);
        const key = roundKey('roulette', ROOM);
        const { round } = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' }, { now: T0 });
        await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: 100, pick: 7 }, { now: T0 });
        await joinRound(client, GUILD, C, 'roulette', { channelId: ROOM, bet: 10, pick: 32 }, { now: T0 });
        await joinRound(client, GUILD, C, 'roulette', { channelId: ROOM, bet: 20, pick: 'black' }, { now: T0 });
        const spun = await spinRoulette(client, key, round.id, { now: T0 + 20_000, randomInt: () => 32 });
        assert.deepEqual([spun.status, spun.pocket], ['spun', 32]);
        // A retried spin keeps the pocket.
        assert.equal((await spinRoulette(client, key, round.id, { randomInt: () => 7 })).pocket, 32);
        const both = await Promise.all([settleRound(client, spun, endDecision(spun)), settleRound(client, spun, endDecision(spun))]);
        const results = both.flatMap((outcome) => outcome.results);
        assert.deepEqual(results.map((result) => result.userId).sort(), [A, B, C]);
        assert.deepEqual(both.flatMap((outcome) => outcome.failed), []);
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C)], [1100, 900, 970 + 360]);
        for (const id of [A, B, C]) assert.equal(saved(client, id).ccCasinoBets, undefined);
        assert.deepEqual(saved(client, C).ccCasinoStats, { played: 2, won: 1, lost: 1, wagered: 30, paidOut: 360 });
        assert.ok(await finishRound(client, key, spun));
        assert.deepEqual(client.store.get(key), { id: round.id, game: 'roulette', status: 'done', endedAt: client.store.get(key).endedAt });
        assert.deepEqual((await settleRound(client, spun, endDecision(spun))).results, []);
        assert.equal(await balance(client, A), 1100);
        const shown = rouletteResultPayload(spun, results).embeds[0].description;
        assert.match(shown, /وقفت على 🔴 \*\*32\*\*/u);
        assert.match(shown, new RegExp(`🏆 <@${A}> على 🔴 أحمر`, 'u'));
        assert.match(shown, new RegExp(`💸 <@${B}> على 🔢 7`, 'u'));
    });

    test('a rocket cash-out pays once; a double click, a stranger and a late click change nothing', async () => {
        const client = fakeClient();
        for (const id of [A, B, C, E]) await fund(client, id, 1000);
        const key = roundKey('rocket', ROOM);
        const { round } = await joinRound(client, GUILD, A, 'rocket', { channelId: ROOM, bet: 100 }, { now: T0 });
        await joinRound(client, GUILD, B, 'rocket', { channelId: ROOM, bet: 100, pick: 200 }, { now: T0 });
        await joinRound(client, GUILD, C, 'rocket', { channelId: ROOM, bet: 100 }, { now: T0 });
        await joinRound(client, GUILD, E, 'rocket', { channelId: ROOM, bet: 100 }, { now: T0 });
        assert.equal((await cashOutRocket(client, key, round.id, A, { now: T0 })).reason, 'not_started');
        const takeoff = T0 + CASINO.rocket.joinMs;
        const flying = await launchRocket(client, key, round.id, { now: takeoff, randomInt: drawFor(300) });
        assert.deepEqual([flying.status, flying.crash, flying.capped, flying.flightAt], ['flying', 300, false, takeoff]);
        assert.equal((await launchRocket(client, key, round.id, { randomInt: () => 0 })).crash, 300);
        const at = (multiplier) => takeoff + rocketTimeTo(multiplier);
        const press = (userId, multiplier) => rocketCashOut(client, { channelId: ROOM, userId, roundId: round.id, receivedAt: at(multiplier) });

        const twice = await Promise.all([press(A, 150), press(A, 150)]);
        assert.deepEqual(twice.map((result) => (result.ok ? 'paid' : result.reason)).sort(), ['already', 'paid']);
        const paid = twice.find((result) => result.ok);
        assert.deepEqual([paid.multiplier, paid.payout, paid.balance], [150, 150, 1050]);
        assert.match(rocketClickText(paid), /عملت كاش أوت عند \*\*×1\.50\*\*/u);
        assert.match(rocketClickText(twice.find((result) => !result.ok)), /خرجت خلاص عند \*\*×1\.50\*\*/u);
        const stranger = await press(D, 160);
        assert.equal(stranger.reason, 'not_in');
        assert.match(rocketClickText(stranger), /مش راكب الصاروخ ده/u);
        assert.equal(client.store.has(economyKey(D)), false);
        // B's automatic cash-out at ×2 pays ×2, even when clicked once the rocket is higher.
        assert.deepEqual(await press(B, 250).then((result) => [result.multiplier, result.payout]), [200, 200]);
        // C clicks after the crash point: too late.
        const late = await press(C, 300);
        assert.equal(late.reason, 'crashed');
        assert.match(rocketClickText(late), /اتأخرت/u);
        // The crash is announced; E's click that reached the bot just before it still counts.
        const crashed = await crashRocket(client, key, round.id, { now: at(300) });
        assert.equal(crashed.status, 'crashed');
        const justInTime = await press(E, 290);
        assert.ok(justInTime.ok && justInTime.multiplier >= 290 && justInTime.multiplier < 300);
        const { results } = await settleRound(client, crashed, endDecision(crashed));
        assert.deepEqual(results.map((result) => [result.userId, result.payout]), [[C, 0]]);
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C), await balance(client, E)], [1050, 1100, 900, 900 + justInTime.payout]);
        assert.ok(await finishRound(client, key, crashed));
        assert.equal((await press(E, 290)).reason, 'stale');
        assert.match(rocketClickText({ ok: false, reason: 'stale' }), /خلصت/u);
    });

    test('a failed member save leaves neither a stake nor a round behind (one SQL transaction, rolled back)', async () => {
        let rows = new Map();
        let snapshot;
        let failMember = false;
        const calls = [];
        const query = async (sql, params = []) => {
            calls.push(sql.split(' ')[0]);
            if (sql === 'BEGIN') snapshot = structuredClone(rows);
            if (sql === 'ROLLBACK') rows = snapshot;
            if (sql.startsWith('SELECT value')) return { rows: rows.has(params[0]) ? [{ value: structuredClone(rows.get(params[0])) }] : [] };
            if (sql.startsWith('INSERT')) {
                if (failMember && params[0].includes(':economy:')) throw new Error('disk failure');
                rows.set(params[0], JSON.parse(params[1]));
            }
            return { rows: [] };
        };
        const db = Object.assign(Object.create(PostgreSQLDatabase.prototype), { context: new AsyncLocalStorage(), pool: { query, connect: async () => ({ query, release: () => {} }) } });
        const client = { db };
        await fund(client, A, 1000);
        failMember = true;
        await assert.rejects(joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' }), /disk failure/u);
        failMember = false;
        assert.equal(rows.has(roundKey('roulette', ROOM)), false);
        assert.equal(rows.get(economyKey(A)).cc, 1000);
        assert.equal(rows.get(economyKey(A)).ccCasinoBets, undefined);
        assert.deepEqual([calls.filter((call) => call === 'BEGIN').length, calls.filter((call) => call === 'ROLLBACK').length], [2, 1]);
        assert.ok((await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' })).ok);
        assert.equal(rows.get(roundKey('roulette', ROOM)).bets.length, 1);
        assert.equal(rows.get(economyKey(A)).cc, 900);
    });
});

describe('group rounds after a restart', () => {
    test('a restart gives back the bets of a round still open, pays a spun wheel and the automatic cash-outs, and refunds orphans', async () => {
        const [R1, R2, R3, R4, R5] = ['400000000000000011', '400000000000000012', '400000000000000013', '400000000000000014', '400000000000000015'];
        const stake = (round, game, channelId, bet, detail) => ({ round, game, channelId, bet, ...detail, at: T0 });
        const base = { guildId: GUILD, openedAt: T0, closesAt: T0 + 20_000 };
        const client = fakeClient({
            [roundKey('roulette', R1)]: { ...base, id: 'aaaaaaaaaaa1', game: 'roulette', status: 'open', channelId: R1, messageId: '500000000000000001', bets: [{ userId: A, bet: 100, choice: 'red' }, { userId: B, bet: 50, choice: 7 }] },
            [roundKey('roulette', R2)]: { ...base, id: 'aaaaaaaaaaa2', game: 'roulette', status: 'spun', pocket: 7, channelId: R2, messageId: null, bets: [{ userId: A, bet: 10, choice: 7 }, { userId: C, bet: 20, choice: 'black' }] },
            [roundKey('rocket', R3)]: {
                ...base, id: 'aaaaaaaaaaa3', game: 'rocket', status: 'flying', crash: 250, capped: false, flightAt: T0, channelId: R3, messageId: null,
                bets: [{ userId: A, bet: 100, target: null }, { userId: B, bet: 100, target: 200 }, { userId: C, bet: 100, target: 300 }, { userId: D, bet: 100, target: null, cashedOut: 150, payout: 150 }],
            },
            [roundKey('rocket', R4)]: { ...base, id: 'aaaaaaaaaaa4', game: 'rocket', status: 'crashed', crash: 150, capped: false, flightAt: T0, channelId: R4, messageId: null, bets: [{ userId: B, bet: 100, target: null }, { userId: C, bet: 100, target: 120 }] },
            [economyKey(A)]: { cc: 0, ccStats: { earned: 0, spent: 210 }, ccCasinoBets: [stake('aaaaaaaaaaa1', 'roulette', R1, 100, { choice: 'red' }), stake('aaaaaaaaaaa2', 'roulette', R2, 10, { choice: 7 }), stake('aaaaaaaaaaa3', 'rocket', R3, 100, { target: null })] },
            [economyKey(B)]: { cc: 0, ccStats: { earned: 0, spent: 250 }, ccCasinoBets: [stake('aaaaaaaaaaa1', 'roulette', R1, 50, { choice: 7 }), stake('aaaaaaaaaaa3', 'rocket', R3, 100, { target: 200 }), stake('aaaaaaaaaaa4', 'rocket', R4, 100, { target: null })] },
            [economyKey(C)]: { cc: 0, ccStats: { earned: 0, spent: 220 }, ccCasinoBets: [stake('aaaaaaaaaaa2', 'roulette', R2, 20, { choice: 'black' }), stake('aaaaaaaaaaa3', 'rocket', R3, 100, { target: 300 }), stake('aaaaaaaaaaa4', 'rocket', R4, 100, { target: 120 })] },
            // D was already paid by the rocket; D's other stake belongs to a round that is gone, one entry lost its
            // round (its bet is given back) and one has no bet left to read (dropped).
            [economyKey(D)]: { cc: 150, ccStats: { earned: 150, spent: 165 }, ccCasinoBets: [stake('deadbeef0000', 'roulette', R5, 40, { choice: 'red' }), { game: 'roulette', bet: 25 }, { round: 'zzzzzzzzzzzz' }] },
        });
        const edited = [];
        const posted = [];
        client.channels = { fetch: async (id) => ({ id, messages: { edit: async (messageId, payload) => { edited.push({ id, messageId, payload }); } }, send: async (payload) => { posted.push({ id, payload }); } }) };

        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 60_000 }), { settled: 4, refunded: 2, failed: 0 });
        // A: R1 given back 100, R2 the 7 pays ×36 (360), R3 by hand on a rocket cut mid-flight: given back 100.
        // B: R1 given back 50, R3 automatic ×2 under the ×2.50 crash (200), R4 crashed by hand: lost.
        // C: R2 black lost, R3 automatic ×3 above the crash: lost, R4 automatic ×1.20 under the ×1.50 crash (120).
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C), await balance(client, D)], [560, 250, 120, 215]);
        for (const id of [A, B, C, D]) assert.equal(saved(client, id).ccCasinoBets, undefined, id);
        assert.deepEqual(saved(client, A).ccStats, { earned: 360, spent: 10 });
        assert.deepEqual(saved(client, A).ccCasinoStats, { played: 1, won: 1, lost: 0, wagered: 10, paidOut: 360 });
        assert.deepEqual(saved(client, D).ccStats, { earned: 150, spent: 100 });
        for (const [game, room] of [['roulette', R1], ['roulette', R2], ['rocket', R3], ['rocket', R4]]) assert.equal(client.store.get(roundKey(game, room)).status, 'done');
        // The round with a message is updated in place; the others get a notice in their room.
        assert.deepEqual(edited.map(({ id, messageId }) => [id, messageId]), [[R1, '500000000000000001']]);
        assert.match(edited[0].payload.embeds[0].description, /اتقطعت[\s\S]*↩️[\s\S]*رجعله رهانه/u);
        assert.deepEqual(posted.map(({ id }) => id).sort(), [R2, R3, R4]);
        const r2 = posted.find(({ id }) => id === R2).payload.embeds[0].description;
        assert.match(r2, /كانت وقفت على 🔴 \*\*7\*\*/u);
        assert.match(posted.find(({ id }) => id === R3).payload.embeds[0].description, new RegExp(`🏆 <@${B}>[\\s\\S]*كسب`, 'u'));

        // Running it again changes nothing.
        assert.deepEqual(await recoverGroupGames(client, { now: T0 + 120_000 }), { settled: 0, refunded: 0, failed: 0 });
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C), await balance(client, D)], [560, 250, 120, 215]);
    });

    test('settling a round keeps the member’s unreadable entries for the restart check', async () => {
        const client = fakeClient();
        await fund(client, A, 1000);
        const { round } = await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' }, { now: T0 });
        const record = saved(client, A);
        record.ccCasinoBets.push({ game: 'roulette', bet: 25 });
        client.store.set(economyKey(A), record);
        await joinRound(client, GUILD, A, 'roulette', { channelId: ROOM, bet: 10, pick: 'black' }, { now: T0 });
        const spun = await spinRoulette(client, roundKey('roulette', ROOM), round.id, { randomInt: () => 1 });
        await settleRound(client, spun, endDecision(spun));
        assert.deepEqual(saved(client, A).ccCasinoBets, [{ game: 'roulette', bet: 25 }]);
        assert.equal(await balance(client, A), 890 + 200);
    });

    test('a round left by an earlier run is settled before the next one opens in that room', async () => {
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        // B's bet in a round that no timer of this run plays (the bot restarted while it was open).
        await joinRound(client, GUILD, B, 'roulette', { channelId: ROOM, bet: 100, pick: 'red' }, { now: Date.now() });
        const notices = [];
        client.channels = { fetch: async () => ({ send: async (payload) => { notices.push(payload); } }) };
        const result = await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROOM, game: 'roulette', bet: 100, pick: 'black',
            reply: async () => ({ id: '700000000000000001', edit: async () => {} }), editFor: (sent) => (payload) => sent.edit(payload),
        });
        assert.ok(result.ok && result.created);
        assert.equal(await balance(client, B), 1000);
        assert.equal(saved(client, B).ccCasinoBets, undefined);
        assert.deepEqual(client.store.get(roundKey('roulette', ROOM)).bets, [{ userId: A, bet: 100, choice: 'black' }]);
        assert.equal(liveRound('roulette', ROOM).roundId, result.round.id);
        await until(() => notices.length === 1);
        assert.match(notices[0].embeds[0].description, /اتقطعت/u);
    });
});

describe('live group rounds', () => {
    test('a typed roulette round: the room bets, the wheel spins once, every bet is paid once and shown', async () => {
        Object.assign(CASINO.roulette, { joinMs: 120, spinMs: 5 });
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        for (const id of [A, B, C]) await fund(client, id, 1000);
        await loadCommands(client);
        const sent = [];
        const channel = {
            id: ROOM,
            send: async (payload) => {
                const message = { id: `7000000000000000${10 + sent.length}`, payload, edits: [], edit: async (update) => { message.edits.push(update); return message; } };
                sent.push(message);
                return message;
            },
        };
        const typed = (userId, content) => messageCreate.execute({ guildId: GUILD, content, author: { id: userId, bot: false, toString: () => `<@${userId}>` }, channel, channelId: ROOM }, client);
        await typed(A, 'روليت 100 احمر');
        await typed(B, 'روليت 50 17');
        await typed(C, 'روليت اسود 200');
        await typed(C, 'روليت 100 بنفسجي');
        // Only the round's own message is posted: a bet that joins it sends no "joined" message.
        assert.equal(sent.length, 1);
        assert.equal(sent[0].payload.embeds[0].title, '🎡 روليت');
        assert.equal(sent[0].payload.components[0].components[0].data.custom_id.startsWith('casino:join:roulette:'), true, 'the join button');
        const key = roundKey('roulette', ROOM);
        assert.equal(client.store.get(key).messageId, sent[0].id);
        assert.equal(client.store.get(key).bets.length, 3);
        await until(() => liveRound('roulette', ROOM) === null && sent[0].edits.length && /وقفت على/u.test(sent[0].edits.at(-1).embeds[0].description));
        const final = sent[0].edits.at(-1).embeds[0].description;
        const pocket = Number(/وقفت على .+? \*\*(\d+)\*\*/u.exec(final)[1]);
        const expected = (bet, choice) => 1000 - bet + roulettePayout(bet, choice, pocket);
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C)], [expected(100, 'red'), expected(50, 17), expected(200, 'black')]);
        assert.equal(client.store.get(key).status, 'done');
        for (const id of [A, B, C]) assert.equal(saved(client, id).ccCasinoBets, undefined);
        assert.ok(sent[0].edits.some((payload) => /العجلة بتلف\.\.\./u.test(payload.embeds[0].description)));
        assert.ok(sent[0].edits.some((payload) => /\(3\/40\)/u.test(payload.embeds[0].description)), 'the table showed every bet before the spin');
        assert.equal((final.match(/<@/gu) || []).length, 3);
    });

    test('a live rocket: riders cash out by button once, a stranger is told politely, the crash settles the rest', async () => {
        Object.assign(CASINO.rocket, { joinMs: 60, doubleMs: 200, tickMs: 15, graceMs: 40 });
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        for (const id of [A, B, C, D]) await fund(client, id, 1000);
        const shown = [];
        const table = { id: '700000000000000099', edit: async (payload) => { shown.push(payload); } };
        const replies = [];
        const ride = (userId, bet, pick = null) => placeGroupBet(client, {
            guildId: GUILD, userId, channelId: ROOM, game: 'rocket', bet, pick,
            reply: async (payload) => { replies.push(payload); return table; }, editFor: (sent) => (payload) => sent.edit(payload),
        }, { randomInt: drawFor(400) });
        assert.ok((await ride(A, 100)).created);
        assert.equal((await ride(B, 100, 150)).created, false);
        await ride(C, 100);
        assert.equal(replies.length, 1, 'a rider who joins gets no extra message');
        assert.equal(replies[0].embeds[0].title, '🚀 صاروخ');
        assert.equal(replies[0].components[0].components[0].data.custom_id.startsWith('casino:join:rocket:'), true, 'the join button');
        await until(() => liveRound('rocket', ROOM)?.phase === 'flying');
        const { roundId } = liveRound('rocket', ROOM);
        assert.equal((await ride(D, 100)).reason, 'busy');
        const said = [];
        const press = (userId, args = ['rocket', roundId]) => casinoButtons.execute({
            inGuild: () => true, guildId: GUILD, channelId: ROOM, user: { id: userId },
            deferUpdate: async () => {}, followUp: async (payload) => { said.push([userId, payload.content]); }, reply: async (payload) => { said.push([userId, payload.content]); },
        }, client, args);
        await Promise.all([press(A), press(A), press(D)]);
        await press(D, ['rocket', 'not-a-round']);
        assert.equal(said.filter(([userId, text]) => userId === A && /عملت كاش أوت/u.test(text)).length, 1);
        assert.equal(said.filter(([userId, text]) => userId === A && /خرجت خلاص/u.test(text)).length, 1);
        assert.deepEqual(said.filter(([userId]) => userId === D).map(([, text]) => /مش راكب|مبقاش شغال/u.test(text)), [true, true]);
        await until(() => liveRound('rocket', ROOM) === null && /💀/u.test(shown.at(-1)?.embeds[0].description || ''));
        const paidA = saved(client, A).ccCasinoStats.paidOut;
        assert.ok(paidA >= 100 && paidA < 400, String(paidA));
        assert.deepEqual([await balance(client, A), await balance(client, B), await balance(client, C), await balance(client, D)], [900 + paidA, 1050, 900, 1000]);
        for (const id of [A, B, C]) assert.equal(saved(client, id).ccCasinoBets, undefined);
        assert.equal(client.store.get(roundKey('rocket', ROOM)).status, 'done');
        const final = shown.at(-1);
        assert.match(final.embeds[0].description, /# 💥 ×4\.00/u);
        assert.match(final.embeds[0].description, new RegExp(`💀 <@${C}> فضل راكب وخسر`, 'u'));
        assert.match(final.embeds[0].description, new RegExp(`🎯 <@${B}> خرج لوحده عند \\*\\*×1\\.50\\*\\*`, 'u'));
        assert.match(final.embeds[0].description, new RegExp(`✅ <@${A}> خرج عند`, 'u'));
        const buttons = final.components.flatMap((row) => row.toJSON().components);
        assert.deepEqual(buttons.map((button) => [button.custom_id, button.disabled]), [[`casino:rocket:${roundId}`, true]]);
        // One edit per tick at most while it flew (×1 to ×4 in 400 ms, a tick every 15 ms), never one per change.
        const frames = shown.filter((payload) => /# 🚀/u.test(payload.embeds[0].description));
        assert.ok(frames.length >= 3 && frames.length <= 40, String(frames.length));
        const climbing = frames.map((payload) => Number(/# 🚀 ×([\d.]+)/u.exec(payload.embeds[0].description)[1]));
        assert.ok(climbing.every((value, i) => i === 0 || value >= climbing[i - 1]) && climbing.at(-1) < 4, climbing.join(' '));
        assert.equal((await rocketCashOut(client, { channelId: ROOM, userId: C, roundId })).reason, 'stale');
    });

    test('a cash-out click is answered with one message; only a slow one is acknowledged first', async () => {
        Object.assign(CASINO.rocket, { joinMs: 30, doubleMs: 600, tickMs: 15, graceMs: 20, ackMs: 300 });
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        for (const id of [A, B]) await fund(client, id, 1000);
        const table = { id: '700000000000000098', edit: async () => {} };
        for (const id of [A, B]) {
            await placeGroupBet(client, {
                guildId: GUILD, userId: id, channelId: ROOM, game: 'rocket', bet: 100,
                reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
            }, { randomInt: drawFor(400) });
        }
        await until(() => liveRound('rocket', ROOM)?.phase === 'flying');
        const { roundId } = liveRound('rocket', ROOM);
        const press = async (userId) => {
            const calls = [];
            await casinoButtons.execute({
                inGuild: () => true, guildId: GUILD, channelId: ROOM, user: { id: userId },
                deferUpdate: async () => { calls.push('deferUpdate'); },
                followUp: async (payload) => { calls.push(['followUp', payload.content]); },
                reply: async (payload) => { calls.push(['reply', payload.content]); },
            }, client, ['rocket', roundId]);
            return calls;
        };
        const fast = await press(A);
        assert.equal(fast.length, 1, 'one trip to Discord');
        assert.equal(fast[0][0], 'reply');
        assert.match(fast[0][1], /عملت كاش أوت/u);
        // The database is slow for B: the click is acknowledged before Discord's 3 s run out, then answered.
        CASINO.rocket.ackMs = 20;
        const { get } = client.db;
        client.db.get = async (...args) => { await wait(60); return get(...args); };
        const slow = await press(B);
        client.db.get = get;
        assert.equal(slow[0], 'deferUpdate');
        assert.equal(slow[1][0], 'followUp');
        assert.match(slow[1][1], /عملت كاش أوت/u);
        assert.equal(slow.length, 2);
        await until(() => liveRound('rocket', ROOM) === null);
    });

    test('a slow message edit does not hold the rocket back: the crash comes on time', async () => {
        Object.assign(CASINO.rocket, { joinMs: 30, doubleMs: 200, tickMs: 15, graceMs: 20 });
        CASINO.groupRenderMs = 5;
        const client = fakeClient();
        await fund(client, A, 1000);
        const shown = [];
        // Every edit takes longer than the whole flight (×1 to ×4 in 400 ms).
        const table = { id: '700000000000000097', edit: async (payload) => { await wait(600); shown.push(payload); } };
        await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROOM, game: 'rocket', bet: 100,
            reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
        }, { randomInt: drawFor(400) });
        await until(() => liveRound('rocket', ROOM)?.phase === 'flying');
        const { flightAt } = liveRound('rocket', ROOM).round;
        await wait(flightAt + 520 - Date.now());
        assert.notEqual(liveRound('rocket', ROOM)?.phase, 'flying', 'the crash did not wait for the edit');
        assert.equal(client.store.get(roundKey('rocket', ROOM)).status === 'open', false);
        await until(() => liveRound('rocket', ROOM) === null && /💀/u.test(shown.at(-1)?.embeds[0].description || ''), 5000);
        // Frames were skipped while one was on its way, never queued one behind another.
        assert.ok(shown.filter((payload) => /# 🚀/u.test(payload.embeds[0].description)).length <= 2, String(shown.length));
        assert.equal(await balance(client, A), 900);
    });

    test('the join button opens a form for the amount, and its submit puts the bet on the open round only', async () => {
        Object.assign(CASINO.roulette, { joinMs: 400, spinMs: 5 });
        const client = fakeClient();
        for (const id of [A, B, C]) await fund(client, id, 1000);
        const sentRoom = [];
        const table = { id: '700000000000000077', edit: async (payload) => { sentRoom.push(payload); } };
        await placeGroupBet(client, {
            guildId: GUILD, userId: A, channelId: ROOM, game: 'roulette', bet: 100, pick: 'red',
            reply: async () => table, editFor: (sent) => (payload) => sent.edit(payload),
        });
        const { roundId } = liveRound('roulette', ROOM);
        const said = [];
        const base = (userId) => ({
            inGuild: () => true, guildId: GUILD, channelId: ROOM, channel: { id: ROOM, send: async () => table }, user: { id: userId },
            deferReply: async () => {}, followUp: async (payload) => { said.push([userId, payload.content]); }, reply: async (payload) => { said.push([userId, payload.content]); },
        });
        // The button opens the form of that round (amount + pick for roulette).
        let modal = null;
        await casinoButtons.execute({ ...base(B), showModal: async (form) => { modal = form.toJSON(); } }, client, ['join', 'roulette', roundId]);
        assert.equal(modal.custom_id, `casino:joinm:roulette:${roundId}`);
        assert.deepEqual(modal.components.map((row) => row.components[0].custom_id), ['amount', 'choice']);
        // A button of an old round, or with a made-up game, only gets a private answer.
        await casinoButtons.execute({ ...base(B), showModal: async () => assert.fail('no form') }, client, ['join', 'roulette', 'abcabcabcabc']);
        assert.match(said.at(-1)[1], /قفلت/u);
        const submit = (userId, amount, choice, id = roundId) => casinoButtons.executeModal({
            ...base(userId), fields: { getTextInputValue: (name) => (name === 'amount' ? amount : choice) },
        }, client, ['joinm', 'roulette', id]);
        await submit(B, '٢٥٠', 'اسود');
        assert.match(said.at(-1)[1], /دخلت بـ \*\*250\*\*/u);
        assert.equal(await balance(client, B), 750);
        await submit(C, 'abc', 'احمر');
        assert.match(said.at(-1)[1], /الرهان لازم/u);
        await submit(C, '100', 'بنفسجي');
        assert.match(said.at(-1)[1], /اختار/u);
        await submit(C, '5000', 'احمر');
        assert.match(said.at(-1)[1], /مش كفاية|رصيدك/u);
        await submit(C, '100', 'احمر', 'abcabcabcabc');
        assert.match(said.at(-1)[1], /قفلت/u);
        assert.equal(await balance(client, C), 1000);
        assert.equal(client.store.get(roundKey('roulette', ROOM)).bets.length, 2);
        await until(() => liveRound('roulette', ROOM) === null);
        // After the spin the old form is refused.
        await submit(C, '100', 'احمر');
        assert.match(said.at(-1)[1], /قفلت/u);
        assert.equal(saved(client, C).ccCasinoBets, undefined);
    });

    test('the flight frame carries the cash-out button of its round', () => {
        const round = { id: 'abcabcabcabc', bets: [{ userId: A, bet: 100, target: 200 }, { userId: B, bet: 50, cashedOut: 150, payout: 75 }] };
        const payload = rocketFlightPayload(round, 173);
        const [button] = payload.components[0].toJSON().components;
        assert.deepEqual([button.custom_id, button.disabled ?? false, button.label], ['casino:rocket:abcabcabcabc', false, 'كاش أوت · ×1.73']);
        assert.match(payload.embeds[0].description, /# 🚀 ×1\.73/u);
        assert.match(payload.embeds[0].description, new RegExp(`✅ <@${B}> خرج عند \\*\\*×1\\.50\\*\\*`, 'u'));
        assert.deepEqual(payload.allowedMentions, { parse: [] });
    });
});

test('backups keep the casino rounds of each room', () => {
    const DATE = '2026-11-07T00:00:00.000Z';
    const snapshot = createSnapshot([
        { key: `guild:${GUILD}:casino:roulette:${ROOM}`, value: { id: 'aaaaaaaaaaa1', game: 'roulette', status: 'done', endedAt: T0 }, updatedAt: DATE },
        { key: `guild:${GUILD}:casino:rocket:${ROOM}`, value: { id: 'aaaaaaaaaaa2', game: 'rocket', status: 'open', bets: [] }, updatedAt: DATE },
    ]);
    assert.equal(validateSnapshot(snapshot), snapshot);
    assert.throws(() => createSnapshot([{ key: `guild:${GUILD}:casino:poker:${ROOM}`, value: {}, updatedAt: DATE }]), /record key/u);
});
