import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a dedicated bourse database');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
const connection = await pool.connect();
try {
    await connection.query('BEGIN');
    await connection.query(await readFile(new URL('../migrations/001_bourse.sql', import.meta.url), 'utf8'));
    await connection.query('COMMIT');
    console.log('Bourse-only migration applied (idempotent).');
} catch (error) { await connection.query('ROLLBACK'); throw error; }
finally { connection.release(); await pool.end(); }
