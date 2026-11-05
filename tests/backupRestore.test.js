import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, validateSnapshot, parseSnapshot, exportSnapshot, restoreSnapshot, safeErrorMessage } from '../scripts/lib/bourseBackup.js';

const GUILD = '100000000000000001';
const USER = '200000000000000001';
const DATE = '2026-11-05T00:00:00.000Z';
const records = [
    { key: `guild:${GUILD}:economy:${USER}`, value: { cc: 12345, ccBourse: { car: { quantity: 2, cost: 2600 } }, ccInventory: { forecast: 1 } }, updatedAt: DATE },
    { key: `guild:${GUILD}:bourse`, value: { hour: 489000, prices: { car: 1450 }, preRolls: { car: 0.7 } }, updatedAt: DATE },
    { key: `guild:${GUILD}:config`, value: { traderRoleId: '300000000000000001', traderRoleCreated: true }, updatedAt: DATE },
];

function sqlAdapter(initial = [], { failInsertAt = 0, failRead = false, occupancy } = {}) {
    let store = new Map(initial.map((row) => [row.key, structuredClone(row)]));
    let transactionSnapshot;
    let insertCount = 0;
    let connections = 0;
    const calls = [];
    const connection = {
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (sql.startsWith('BEGIN')) transactionSnapshot = structuredClone(store);
            else if (sql.startsWith('SELECT key,')) {
                if (failRead) throw new Error('read failed');
                return { rows: [...store.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({
                    key: row.key, value: structuredClone(row.value), updated_at: new Date(row.updatedAt),
                })) };
            } else if (sql.startsWith('SELECT EXISTS')) return { rows: [{ occupied: occupancy ?? Boolean(store.size) }] };
            else if (sql.startsWith('INSERT')) {
                insertCount += 1;
                if (insertCount === failInsertAt) throw new Error('insert failed');
                if (store.has(params[0])) throw new Error('duplicate database key');
                store.set(params[0], { key: params[0], value: JSON.parse(params[1]), updatedAt: params[2] });
            } else if (sql === 'ROLLBACK') store = transactionSnapshot;
            return { rows: [] };
        },
        release() { calls.push({ sql: 'release' }); },
    };
    return {
        pool: { connect: async () => { connections += 1; return connection; } },
        calls,
        rows: () => [...store.values()].sort((a, b) => a.key.localeCompare(b.key)),
        connections: () => connections,
    };
}

test('portable snapshot round trip preserves balances, holdings, market locks and role markers', async () => {
    const source = sqlAdapter(records);
    const snapshot = await exportSnapshot(source.pool);
    assert.deepEqual(source.calls.map((call) => call.sql), [
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        'SELECT key, value, updated_at FROM bourse_records ORDER BY key', 'COMMIT', 'release',
    ]);
    assert.deepEqual(source.rows(), [...records].sort((a, b) => a.key.localeCompare(b.key)));
    const parsed = parseSnapshot(JSON.stringify(snapshot));
    const target = sqlAdapter();
    assert.equal(await restoreSnapshot(target.pool, parsed), 3);
    assert.deepEqual(target.rows(), source.rows());
    assert.equal(target.calls[0].sql, 'BEGIN');
    assert.equal(target.calls[1].sql, 'LOCK TABLE bourse_records IN ACCESS EXCLUSIVE MODE');
    assert.equal(target.calls[2].sql, 'SELECT EXISTS (SELECT 1 FROM bourse_records) AS occupied');
    assert.equal(target.calls.at(-2).sql, 'COMMIT');
    assert.equal(target.calls.at(-1).sql, 'release');
});

test('restore refuses a nonempty target without modifying its records', async () => {
    const target = sqlAdapter([records[0]]);
    await assert.rejects(restoreSnapshot(target.pool, createSnapshot(records, DATE)), /target bourse_records must be empty/u);
    assert.deepEqual(target.rows(), [records[0]]);
    assert.equal(target.calls.filter((call) => call.sql.startsWith('INSERT')).length, 0);
    assert.equal(target.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(target.calls.at(-1).sql, 'release');
});

test('restore rolls back all earlier inserts if a later row fails', async () => {
    const target = sqlAdapter([], { failInsertAt: 2 });
    await assert.rejects(restoreSnapshot(target.pool, createSnapshot(records, DATE)), /insert failed/u);
    assert.deepEqual(target.rows(), []);
    assert.equal(target.calls.some((call) => call.sql === 'COMMIT'), false);
    assert.equal(target.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(target.calls.at(-1).sql, 'release');
});

test('failed export releases its connection and rolls back the read-only transaction', async () => {
    const source = sqlAdapter(records, { failRead: true });
    await assert.rejects(exportSnapshot(source.pool), /read failed/u);
    assert.deepEqual(source.rows(), [...records].sort((a, b) => a.key.localeCompare(b.key)));
    assert.equal(source.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(source.calls.at(-1).sql, 'release');
});

test('checksum detects a changed balance before restore connects', async () => {
    const damaged = createSnapshot(structuredClone(records), DATE);
    damaged.records[0].value.cc += 1;
    const target = sqlAdapter();
    await assert.rejects(restoreSnapshot(target.pool, damaged), /checksum mismatch/u);
    assert.equal(target.connections(), 0);
    assert.deepEqual(target.rows(), []);
});

test('restore uses the validated snapshot even if the caller changes its input during connection', async () => {
    const backup = createSnapshot(structuredClone(records), DATE);
    const target = sqlAdapter();
    const pool = { connect: async () => {
        backup.records[0].value.cc = 0;
        backup.records.pop();
        return target.pool.connect();
    } };
    assert.equal(await restoreSnapshot(pool, backup), 3);
    assert.deepEqual(target.rows(), [...records].sort((a, b) => a.key.localeCompare(b.key)));
});

test('invalid versions, schema, keys, dates and duplicate keys fail closed', async () => {
    const valid = createSnapshot(structuredClone(records), DATE);
    const mutations = [
        (backup) => { backup.version = 2; },
        (backup) => { backup.format = 'another-bot'; },
        (backup) => { backup.databaseUrl = 'not-allowed'; },
        (backup) => { backup.records = {}; },
        (backup) => { backup.createdAt = 'not-a-date'; },
        (backup) => { backup.records.push(structuredClone(backup.records[0])); },
        (backup) => { backup.records[0].key = 'guild:123:everything'; },
        (backup) => { backup.records[0].key = "'; DROP TABLE bourse_records; --"; },
        (backup) => { backup.records[0].updatedAt = '2026-02-30T00:00:00.000Z'; },
        (backup) => { backup.records[0].extra = true; },
        (backup) => { backup.records[0].value = undefined; },
    ];
    for (const change of mutations) {
        const backup = structuredClone(valid);
        change(backup);
        const target = sqlAdapter();
        await assert.rejects(restoreSnapshot(target.pool, backup));
        assert.equal(target.connections(), 0);
    }
    assert.throws(() => parseSnapshot('{broken json'), /not valid JSON/u);
});

test('canonical checksum accepts JSON object reordering without changing its meaning', () => {
    const snapshot = createSnapshot([{ key: records[0].key, value: { cc: 55, nested: { a: 1, b: [true, null] } }, updatedAt: DATE }], DATE);
    snapshot.records[0].value = { nested: { b: [true, null], a: 1 }, cc: 55 };
    assert.equal(validateSnapshot(snapshot), snapshot);
});

test('JSON keys stay data rather than polluting prototypes', async () => {
    const value = JSON.parse('{"cc":50,"__proto__":{"polluted":true},"nested":[1,"hello"]}');
    const snapshot = parseSnapshot(JSON.stringify(createSnapshot([{ key: records[0].key, value, updatedAt: DATE }], DATE)));
    const target = sqlAdapter();
    await restoreSnapshot(target.pool, snapshot);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.hasOwn(target.rows()[0].value, '__proto__'), true);
    assert.deepEqual(target.rows()[0].value.nested, [1, 'hello']);
});

test('empty valid snapshots work and ambiguous target occupancy is refused', async () => {
    const snapshot = createSnapshot([], DATE);
    assert.equal(await restoreSnapshot(sqlAdapter().pool, snapshot), 0);
    const unsafe = sqlAdapter([], { occupancy: 'false' });
    await assert.rejects(restoreSnapshot(unsafe.pool, snapshot), /must be empty/u);
    assert.equal(unsafe.calls.some((call) => call.sql.startsWith('INSERT')), false);
});

test('invalid JSON types, cycles and excessive nesting are rejected', () => {
    const invalid = [Infinity, NaN, 1n, new Date(DATE), () => true];
    const cycle = {}; cycle.self = cycle; invalid.push(cycle);
    let nested = {}; for (let i = 0; i < 101; i += 1) nested = { nested }; invalid.push(nested);
    for (const value of invalid) assert.throws(() => createSnapshot([{ ...records[0], value }], DATE));
});

test('oversized record counts are refused before opening a database connection', async () => {
    const backup = { ...createSnapshot([], DATE), records: new Array(100_001) };
    const target = sqlAdapter();
    await assert.rejects(restoreSnapshot(target.pool, backup), /record count/u);
    assert.equal(target.connections(), 0);
});

test('unexpected database errors never expose a connection string or token in CLI error text', () => {
    const error = Object.assign(new Error('postgresql://user:private-password@host/db and private-token'), { code: 'ECONNREFUSED' });
    assert.equal(safeErrorMessage(error), 'Operation failed (ECONNREFUSED); credentials are not logged');
    assert.equal(safeErrorMessage(new Error('secret')), 'Operation failed (DATABASE_OR_FILE_ERROR); credentials are not logged');
});
