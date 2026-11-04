import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';
import { invest, getMarket } from '../src/services/cc/bourseService.js';
import { updateCCState, getProfile } from '../src/services/cc/ccService.js';
import { HOME_GUILD_ID as GUILD } from '../src/config/homeGuild.js';

// SQL adapter double verifies transaction routing/rollback without contacting PostgreSQL.
function database() {
    let rows = new Map(); let snapshot; let rejectMarketSave = false;
    const calls = [];
    const query = async (sql, params = []) => {
        calls.push(sql.split(' ')[0]);
        if (sql === 'BEGIN') snapshot = structuredClone(rows);
        if (sql === 'ROLLBACK') rows = snapshot;
        if (sql.startsWith('SELECT value')) return { rows: rows.has(params[0]) ? [{ value: structuredClone(rows.get(params[0])) }] : [] };
        if (sql.startsWith('INSERT')) {
            if (rejectMarketSave && params[0].endsWith(':bourse')) throw new Error('disk failure');
            rows.set(params[0], JSON.parse(params[1]));
        }
        return { rows: [] };
    };
    const connection = { query, release: () => calls.push('release') };
    const db = Object.assign(Object.create(PostgreSQLDatabase.prototype), { context: new AsyncLocalStorage(), pool: { query, connect: async () => connection } });
    return { db, calls, failMarket: () => { rejectMarketSave = true; } };
}

test('nested stock balance saves use one SQL transaction and rollback on market write failure', async () => {
    const fixture = database(); const client = { db: fixture.db }; const user = '200000000000000001';
    await updateCCState(client, GUILD, user, (state) => { state.cc = 10_000; return { ok: true }; });
    await getMarket(client, GUILD);
    fixture.calls.length = 0; fixture.failMarket();
    await assert.rejects(invest(client, GUILD, user, 'car', 1), /disk failure/u);
    assert.equal((await getProfile(client, GUILD, user)).cc, 10_000);
    assert.equal(fixture.calls.filter((call) => call === 'BEGIN').length, 1);
    assert.equal(fixture.calls.filter((call) => call === 'ROLLBACK').length, 1);
    assert.equal(fixture.calls.filter((call) => call === 'COMMIT').length, 0);
    assert.equal(fixture.calls.filter((call) => call === 'release').length, 1);
});

test('concurrent buys cannot overdraw the same member', async () => {
    const store = new Map(); const db = { get: async (key, fallback) => store.has(key) ? structuredClone(store.get(key)) : fallback, set: async (key, value) => { store.set(key, structuredClone(value)); return true; } };
    const client = { db }; const user = '200000000000000002';
    await updateCCState(client, GUILD, user, (state) => { state.cc = 1300; return { ok: true }; });
    const results = await Promise.all(Array.from({ length: 5 }, () => invest(client, GUILD, user, 'car', 1, { rng: () => 0.5 })));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await getProfile(client, GUILD, user)).cc, 0);
});
