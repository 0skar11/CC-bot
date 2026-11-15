import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { economyScope } from '../config/sharedEconomy.js';

// Only stock market, holdings/CC, and trader role setup records use this dedicated table.
export class PostgreSQLDatabase {
    constructor(options = {}) {
        // Idle connections are kept for 10 minutes with TCP keep-alive. node-postgres closes them after 10 s by
        // default, so the first command after a quiet moment waited for a new connection (TCP, TLS, login)
        // before it could answer.
        this.pool = new pg.Pool({
            connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 10_000,
            idleTimeoutMillis: 600_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000, ...options,
        });
        this.context = new AsyncLocalStorage();
        this.pool.on('error', (error) => console.error('PostgreSQL connection error:', error.code || 'unknown'));
    }
    query(text, values) { return (this.context.getStore() || this.pool).query(text, values); }
    async connect() { await this.query('SELECT 1'); await this.query('SELECT key FROM bourse_records LIMIT 0'); }
    async get(key, fallback = null) {
        const { rows } = await this.query('SELECT value FROM bourse_records WHERE key = $1', [key]);
        return rows.length ? rows[0].value : fallback;
    }
    async set(key, value) {
        await this.query('INSERT INTO bourse_records(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP', [key, JSON.stringify(value)]);
        return true;
    }
    async list(prefix) {
        const { rows } = await this.query('SELECT key FROM bourse_records WHERE starts_with(key, $1) ORDER BY key', [prefix]);
        return rows.map((row) => row.key);
    }
    // Every record under `prefix` with its value in one query (leaderboards), instead of list() and one get() per key.
    // `LIKE 'prefix%'` (wildcards in the prefix escaped) uses the bourse_records_prefix text_pattern_ops index.
    async entries(prefix) {
        const pattern = `${String(prefix).replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;
        const { rows } = await this.query('SELECT key, value FROM bourse_records WHERE key LIKE $1 ORDER BY key', [pattern]);
        return rows.map((row) => ({ key: row.key, value: row.value }));
    }
    async transaction(task) {
        if (this.context.getStore()) return task();
        const connection = await this.pool.connect();
        try {
            await connection.query('BEGIN');
            // Serializes balance + market persistence, including two bot processes sharing this DB.
            await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`bourse:${economyScope()}`]);
            const result = await this.context.run(connection, task);
            await connection.query('COMMIT');
            return result;
        } catch (error) {
            await connection.query('ROLLBACK').catch(() => {});
            throw error;
        } finally { connection.release(); }
    }
    close() { return this.pool.end(); }
}
