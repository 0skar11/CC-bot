import 'dotenv/config';
import pg from 'pg';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';
import { getEconomyKey, getGuildConfigKey } from '../src/utils/database/keys.js';
import { economyScopeId, initialCC } from '../src/config/runtime.js';

const homeGuildId = '1155236281706627173';
const snowflake = /^\d{17,20}$/u;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
const validStreak = value => value && validDay(value.day) && Number.isSafeInteger(value.count)
    && value.count > 0 && Number.isSafeInteger(value.best) && value.best >= value.count;

async function readSnapshot(source) {
    const connection = await source.connect();
    try {
        await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows } = await connection.query(
            "SELECT user_id, data->'ccStreak' AS streak FROM economy WHERE guild_id = $1 AND data->'ccStreak' IS NOT NULL",
            [homeGuildId],
        );
        const config = await connection.query(
            "SELECT config->>'streakReminderDay' AS day FROM guilds WHERE id = $1",
            [homeGuildId],
        );
        if (!config.rows.length) throw new Error('CHAOS home guild missing');
        if (rows.some(row => !snowflake.test(String(row.user_id)) || !validStreak(row.streak))) {
            throw new Error('Invalid source streak records');
        }
        await connection.query('COMMIT');
        return { rows, reminder: config.rows[0].day };
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

async function importSnapshot(target, { rows, reminder }) {
    return target.transaction(async () => {
        let imported = 0;
        for (const { user_id: userId, streak } of rows) {
            const key = getEconomyKey(economyScopeId, userId);
            const record = await target.get(key, { cc: initialCC, ccBourse: {} });
            if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid CC record');
            const existing = record.ccStreak;
            const newest = existing?.day >= streak.day ? existing : streak;
            const merged = { ...newest, best: Math.max(existing?.best || 0, streak.best) };
            if (existing?.day === merged.day && existing.count === merged.count && existing.best === merged.best) continue;
            await target.set(key, { ...record, ccStreak: merged });
            imported += 1;
        }
        if (validDay(reminder)) {
            const key = getGuildConfigKey(homeGuildId);
            const config = await target.get(key, {});
            if (!(config.streakReminderDay >= reminder)) await target.set(key, { ...config, streakReminderDay: reminder });
        }
        return imported;
    });
}

async function main() {
    const sourceUrl = process.env.STREAK_SOURCE_DATABASE_URL;
    const targetUrl = process.env.DATABASE_URL;
    if (!sourceUrl || !targetUrl || sourceUrl === targetUrl || !snowflake.test(economyScopeId)) {
        throw new Error('Set distinct source and CC bot database connections and ECONOMY_SCOPE_ID');
    }
    if (process.env.STREAK_ENABLED === 'true') throw new Error('Keep the new streak handler off during import');
    const source = new pg.Pool({ connectionString: sourceUrl, max: 1, connectionTimeoutMillis: 10000 });
    const target = new PostgreSQLDatabase();
    try {
        const snapshot = await readSnapshot(source);
        const imported = await importSnapshot(target, snapshot);
        console.log(`Streak import complete: ${snapshot.rows.length} source records, ${imported} updated. Balances were preserved.`);
    } finally {
        await Promise.all([source.end(), target.close()]);
    }
}

main().catch(error => {
    console.error('Streak import failed:', error.code || error.name);
    process.exitCode = 1;
});
