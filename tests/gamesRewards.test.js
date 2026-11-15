import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { CC } from '../src/config/cc.js';
import { GAMES } from '../src/config/games.js';
import { economyScopeId } from '../src/config/runtime.js';
import { getEconomyKey, getGamesGlobalKey, getGamesPointsKey } from '../src/utils/database/keys.js';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';
import { payGamesBotWin } from '../src/services/cc/gamesBotService.js';
import { addPoints, getPoints, readScore, topGlobal, topServer } from '../src/games/engine/points.js';
import { convertPoints, rewardWin, winPayload } from '../src/games/engine/rewards.js';
import { createSnapshot } from '../scripts/lib/bourseBackup.js';
import { ALICE, BOB, CAROL, GUILD, OTHER_GUILD, fakeClient, fakeDb } from './gamesFakes.js';

const NOW = Date.parse('2026-11-15T10:00:00Z');
const balance = async (client, userId) => (await client.db.get(getEconomyKey(economyScopeId, userId), {})).cc ?? 0;

test('a win pays the Clover amounts (500 answer, 2500 group) and adds points (1, 5) and a win for the game', async () => {
    const client = fakeClient();
    const answer = await rewardWin(client, GUILD, ALICE.id, 'answer', 'test', { now: NOW });
    assert.deepEqual(answer, { ok: true, amount: 500, balance: 500, points: 1, totalPoints: 1, wins: 1, capped: false });
    const group = await rewardWin(client, GUILD, ALICE.id, 'group', 'race', { now: NOW });
    assert.deepEqual(group, { ok: true, amount: 2500, balance: 3000, points: 5, totalPoints: 6, wins: 2, capped: false });
    const { server, global } = await getPoints(client, GUILD, ALICE.id);
    assert.deepEqual(server, { points: 6, wins: 2, byGame: { test: 1, race: 1 }, converted: 0 });
    assert.deepEqual(global, server);
    assert.equal(await balance(client, ALICE.id), 3000);
    await assert.rejects(rewardWin(client, GUILD, ALICE.id, 'jackpot'), /Unknown win kind/u);
});

test('the daily cap is shared with the Clover payout, and points still come once the CC cap is reached', async () => {
    const client = fakeClient();
    // Clover already paid 49,800 CC today.
    for (let i = 0; i < 19; i += 1) await payGamesBotWin(client, GUILD, BOB.id, 'group', NOW);
    for (let i = 0; i < 3; i += 1) await payGamesBotWin(client, GUILD, BOB.id, 'answer', NOW);
    assert.equal(await balance(client, BOB.id), 49_000);
    assert.equal((await rewardWin(client, GUILD, BOB.id, 'answer', 'test', { now: NOW })).amount, 500);
    const last = await rewardWin(client, GUILD, BOB.id, 'answer', 'test', { now: NOW });
    assert.equal(last.amount, 500);
    const capped = await rewardWin(client, GUILD, BOB.id, 'group', 'race', { now: NOW });
    assert.deepEqual([capped.amount, capped.capped, capped.points, capped.totalPoints], [0, true, 5, 7]);
    assert.equal(await balance(client, BOB.id), CC.gamesBot.dailyCap);
    // ...and Clover is capped too, since the native wins counted.
    assert.equal((await payGamesBotWin(client, GUILD, BOB.id, 'answer', NOW)).amount, 0);
    // The next UTC day pays again.
    assert.equal((await rewardWin(client, GUILD, BOB.id, 'answer', 'test', { now: NOW + 86_400_000 })).amount, 500);
    assert.match(winPayload('ar', BOB.id, capped, 'group').content, /كسب اللعبة.*وصلت لحد الـ CC من الألعاب النهارده \(50,000 CC\)/u);
    assert.match(winPayload('ar', BOB.id, last).content, /جاوب صح! \+\*\*500\*\* 🌀 CC ・ \+\*\*1\*\* نقطة ・ رصيدك/u);
    assert.match(winPayload('en', BOB.id, last).content, /got it right!/u);
    assert.deepEqual(winPayload('ar', BOB.id, last).allowedMentions, { parse: [] });
});

test('a payout that fails is reported, never thrown; a points save that fails still pays', async () => {
    const broken = fakeClient(fakeDb());
    broken.db.set = async () => false;
    const failed = await rewardWin(broken, GUILD, ALICE.id, 'answer', 'test', { now: NOW });
    assert.equal(failed.ok, false);
    assert.match(winPayload('ar', ALICE.id, failed).content, /مشكلة في الجايزة/u);
    const half = fakeClient(fakeDb());
    const set = half.db.set;
    half.db.set = async (key, value) => (key.includes(':games:') ? false : set(key, value));
    const paid = await rewardWin(half, GUILD, ALICE.id, 'answer', 'test', { now: NOW });
    assert.deepEqual([paid.ok, paid.amount, paid.points, paid.totalPoints], [true, 500, 0, null]);
});

test('points are kept per server and globally; the boards rank by points, then wins', async () => {
    const client = fakeClient();
    await addPoints(client, GUILD, ALICE.id, 5, { gameId: 'race' });
    await addPoints(client, GUILD, BOB.id, 5, { gameId: 'race' });
    await addPoints(client, GUILD, BOB.id, 0, { gameId: 'test' });
    await addPoints(client, GUILD, CAROL.id, 1, { gameId: 'test' });
    await addPoints(client, OTHER_GUILD, CAROL.id, 10, { gameId: 'race' });
    assert.deepEqual(await topServer(client, GUILD), [
        { userId: BOB.id, points: 5, wins: 2 }, { userId: ALICE.id, points: 5, wins: 1 }, { userId: CAROL.id, points: 1, wins: 1 },
    ]);
    assert.deepEqual(await topServer(client, OTHER_GUILD), [{ userId: CAROL.id, points: 10, wins: 1 }]);
    assert.deepEqual(await topGlobal(client), [
        { userId: CAROL.id, points: 11, wins: 2 }, { userId: BOB.id, points: 5, wins: 2 }, { userId: ALICE.id, points: 5, wins: 1 },
    ]);
    assert.deepEqual((await topGlobal(client, 1)).map((row) => row.userId), [CAROL.id]);
    assert.ok(client.db.records.has(getGamesPointsKey(GUILD, ALICE.id)));
    assert.ok(client.db.records.has(getGamesGlobalKey(economyScopeId, ALICE.id)));
    await assert.rejects(addPoints(client, GUILD, ALICE.id, -1), /Invalid game points/u);
    assert.deepEqual(readScore({ points: -3, wins: 'x', byGame: { a: 2, b: -1 } }), { points: 0, wins: 0, byGame: { a: 2 }, converted: 0 });
});

test('the boards read every record in one db.entries() query when the database has it', async () => {
    const client = fakeClient();
    await addPoints(client, GUILD, ALICE.id, 3);
    await addPoints(client, GUILD, BOB.id, 4);
    const records = client.db.records;
    client.db.entries = async (prefix) => [...records].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) }));
    client.db.calls.get = 0;
    client.db.calls.list = 0;
    assert.deepEqual((await topServer(client, GUILD)).map((row) => row.points), [4, 3]);
    assert.deepEqual([client.db.calls.get, client.db.calls.list], [0, 0]);
});

test('PostgreSQLDatabase.entries reads keys and values under a prefix with one indexed LIKE query', async () => {
    const queries = [];
    const pool = { query: async (sql, params) => { queries.push([sql, params]); return { rows: [{ key: 'guild:1:games:points:2', value: { points: 3 } }] }; } };
    const db = Object.assign(Object.create(PostgreSQLDatabase.prototype), { context: new AsyncLocalStorage(), pool });
    assert.deepEqual(await db.entries('guild:1:games:points:'), [{ key: 'guild:1:games:points:2', value: { points: 3 } }]);
    assert.equal(queries[0][0], 'SELECT key, value FROM bourse_records WHERE key LIKE $1 ORDER BY key');
    assert.deepEqual(queries[0][1], ['guild:1:games:points:%']);
    await db.entries('a_b%c\\');
    assert.deepEqual(queries[1][1], ['a\\_b\\%c\\\\%']);
});

test('convert turns the server points into CC (100 each, at least 5) and takes them from the global points too', async () => {
    const client = fakeClient();
    await addPoints(client, GUILD, ALICE.id, 12, { gameId: 'race' });
    await addPoints(client, OTHER_GUILD, ALICE.id, 4, { gameId: 'race' });
    assert.deepEqual(await convertPoints(client, GUILD, ALICE.id, 4), { ok: false, reason: 'min', min: 5 });
    assert.deepEqual(await convertPoints(client, GUILD, ALICE.id, 13), { ok: false, reason: 'not_enough', have: 12, min: 5 });
    assert.deepEqual(await convertPoints(client, OTHER_GUILD, ALICE.id, 5), { ok: false, reason: 'not_enough', have: 4, min: 5 });
    const done = await convertPoints(client, GUILD, ALICE.id, 10);
    assert.deepEqual(done, { ok: true, points: 10, amount: 10 * GAMES.convert.ccPerPoint, balance: 1000, left: 2 });
    const { server, global } = await getPoints(client, GUILD, ALICE.id);
    assert.deepEqual([server.points, server.wins, server.converted], [2, 1, 10]);
    assert.deepEqual([global.points, global.wins, global.converted], [6, 2, 10]);
    assert.equal(await balance(client, ALICE.id), 1000);
    // A conversion does not count toward the games' daily cap.
    assert.equal((await rewardWin(client, GUILD, ALICE.id, 'answer', 'test', { now: NOW })).amount, 500);
});

test('a conversion whose CC cannot be saved takes no points', async () => {
    const client = fakeClient();
    await addPoints(client, GUILD, ALICE.id, 8);
    const set = client.db.set;
    client.db.set = async (key, value) => (key.includes(':economy:') ? false : set(key, value));
    await assert.rejects(convertPoints(client, GUILD, ALICE.id, 5), /Failed to save CC/u);
    assert.equal((await getPoints(client, GUILD, ALICE.id)).server.points, 8);
});

test('two wins at the same time never overwrite each other', async () => {
    const client = fakeClient();
    await Promise.all(Array.from({ length: 20 }, () => rewardWin(client, GUILD, CAROL.id, 'answer', 'test', { now: NOW })));
    const { server, global } = await getPoints(client, GUILD, CAROL.id);
    assert.deepEqual([server.points, server.wins, global.points], [20, 20, 20]);
    assert.equal(await balance(client, CAROL.id), 10_000);
});

test('backups accept the games points records', () => {
    const date = '2026-11-15T10:00:00.000Z';
    const records = [
        { key: getGamesPointsKey(GUILD, ALICE.id), value: { points: 3, wins: 2, byGame: { test: 2 }, converted: 0 }, updatedAt: date },
        { key: getGamesGlobalKey(economyScopeId, ALICE.id), value: { points: 3, wins: 2, byGame: { test: 2 }, converted: 0 }, updatedAt: date },
    ];
    assert.equal(createSnapshot(records, date).records.length, 2);
    assert.throws(() => createSnapshot([{ ...records[0], key: `guild:${GUILD}:games:other:${ALICE.id}` }], date), /Invalid bourse record key/u);
});
