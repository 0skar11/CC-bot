// mergeDatabases.js — merges DISbot CC-related data into CC-bot's PostgreSQL database.
// Usage:
//   node scripts/mergeDatabases.js --dry-run
//   node scripts/mergeDatabases.js --execute
//
// Requires:
//   SRC_DATABASE_URL: connection string of DISbot database (e.g. Postgres-ElGu)
//   TARGET_DATABASE_URL: connection string of CC-bot database (or fallback to process.env.DATABASE_URL)

import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const SRC_URL = process.env.SRC_DATABASE_URL;
const TARGET_URL = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;

async function run() {
    const isExecute = process.argv.includes('--execute');
    console.log(`[MERGE] Mode: ${isExecute ? 'EXECUTE' : 'DRY-RUN'}`);

    if (!SRC_URL || !TARGET_URL) {
        console.error('[MERGE] Missing SRC_DATABASE_URL or TARGET_DATABASE_URL environment variables.');
        console.error('[MERGE] Usage: SRC_DATABASE_URL="..." TARGET_DATABASE_URL="..." node scripts/mergeDatabases.js [--dry-run|--execute]');
        process.exitCode = 1;
        return;
    }

    const srcPool = new pg.Pool({ connectionString: SRC_URL, max: 2, connectionTimeoutMillis: 10_000 });
    const targetPool = new pg.Pool({ connectionString: TARGET_URL, max: 2, connectionTimeoutMillis: 10_000 });

    try {
        console.log('[MERGE] Testing connections...');
        await srcPool.query('SELECT 1');
        await targetPool.query('SELECT 1');
        console.log('[MERGE] Both database connections successful.');

        // Backup Target
        const targetBackupPath = resolve('./backups/pre-merge-target.json');
        await mkdir(dirname(targetBackupPath), { recursive: true });
        const targetRecordsRes = await targetPool.query('SELECT key, value, updated_at FROM bourse_records');
        const targetRecords = targetRecordsRes.rows;
        await writeFile(targetBackupPath, JSON.stringify(targetRecords, null, 2), 'utf8');
        console.log(`[MERGE] Backed up ${targetRecords.length} target records to ${targetBackupPath}`);

        // Read source tables / keys
        console.log('[MERGE] Reading source database...');
        const tableCheck = await srcPool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = new Set(tableCheck.rows.map((r) => r.table_name));
        console.log('[MERGE] Source tables found:', [...tables].join(', '));

        const targetMap = new Map(targetRecords.map((r) => [r.key, r.value]));
        const newRecords = [];
        const mergedRecords = [];
        let skippedCount = 0;

        // 1. If source has bourse_records
        if (tables.has('bourse_records')) {
            const srcBourse = await srcPool.query('SELECT key, value FROM bourse_records');
            for (const row of srcBourse.rows) {
                const { key, value } = row;
                if (!targetMap.has(key)) {
                    newRecords.push({ key, value });
                } else {
                    // Collision resolution
                    if (key.includes(':economy:')) {
                        const targetVal = targetMap.get(key) || {};
                        const mergedVal = {
                            ...value,
                            ...targetVal,
                            balance: Math.max(Number(value?.balance) || 0, Number(targetVal?.balance) || 0),
                        };
                        mergedRecords.push({ key, value: mergedVal });
                    } else if (key.includes(':chat:')) {
                        const targetVal = targetMap.get(key) || {};
                        const mergedVal = {
                            ...value,
                            ...targetVal,
                            count: Math.max(Number(value?.count) || 0, Number(targetVal?.count) || 0),
                        };
                        mergedRecords.push({ key, value: mergedVal });
                    } else {
                        skippedCount += 1;
                    }
                }
            }
        }

        // 2. If source has temp_data / kv_store
        for (const kvTable of ['temp_data', 'cache_data', 'key_value']) {
            if (tables.has(kvTable)) {
                const rows = await srcPool.query(`SELECT key, value FROM ${kvTable} WHERE key LIKE 'guild:%'`);
                for (const row of rows.rows) {
                    const { key, value } = row;
                    const parsedVal = typeof value === 'string' ? JSON.parse(value) : value;

                    // Transform invite rewards
                    if (key.includes(':invite_rewards:')) {
                        const memberId = key.split(':').pop();
                        const guildId = key.split(':')[1];
                        const targetKey = `guild:${guildId}:invites:${memberId}`;
                        if (!targetMap.has(targetKey)) {
                            newRecords.push({
                                key: targetKey,
                                value: {
                                    inviterId: parsedVal.inviterId,
                                    code: null,
                                    source: 'invite',
                                    status: parsedVal.status || 'pending',
                                    reason: null,
                                    joinedAt: parsedVal.joinedAt || Date.now(),
                                },
                            });
                        }
                    }

                    // Transform chat counts map
                    if (key.includes(':chatcounts')) {
                        const guildId = key.split(':')[1];
                        if (parsedVal && typeof parsedVal === 'object') {
                            for (const [memberId, count] of Object.entries(parsedVal)) {
                                const targetKey = `guild:${guildId}:chat:${memberId}`;
                                if (!targetMap.has(targetKey)) {
                                    newRecords.push({
                                        key: targetKey,
                                        value: { count: Number(count) || 0, lastId: '0' },
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log('[MERGE] --- Collision Analysis & Plan ---');
        console.log(`[MERGE] Target existing records: ${targetMap.size}`);
        console.log(`[MERGE] New records to insert:    ${newRecords.length}`);
        console.log(`[MERGE] Records to update/merge:  ${mergedRecords.length}`);
        console.log(`[MERGE] Identical/skipped keys:   ${skippedCount}`);

        if (isExecute) {
            console.log('[MERGE] Executing database merge in a single transaction...');
            const client = await targetPool.connect();
            try {
                await client.query('BEGIN');
                for (const rec of newRecords) {
                    await client.query(
                        `INSERT INTO bourse_records (key, value, updated_at) 
                         VALUES ($1, $2, CURRENT_TIMESTAMP)
                         ON CONFLICT (key) DO NOTHING`,
                        [rec.key, JSON.stringify(rec.value)],
                    );
                }
                for (const rec of mergedRecords) {
                    await client.query(
                        `UPDATE bourse_records 
                         SET value = $2, updated_at = CURRENT_TIMESTAMP 
                         WHERE key = $1`,
                        [rec.key, JSON.stringify(rec.value)],
                    );
                }
                await client.query('COMMIT');
                console.log('[MERGE] Transaction COMMITTED successfully!');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } else {
            console.log('[MERGE] Dry-run complete. Run with --execute to perform migration.');
        }
    } finally {
        await srcPool.end();
        await targetPool.end();
    }
}

run().catch((err) => {
    console.error('[MERGE] Error:', err.message);
    process.exitCode = 1;
});
