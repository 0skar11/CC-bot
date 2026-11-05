import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { BackupError, MAX_BACKUP_BYTES, exportSnapshot, safeErrorMessage } from './lib/bourseBackup.js';

let pool;
try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0].startsWith('--')) throw new BackupError('Usage: npm run backup -- ./backups/cc-bot.json');
    if (!process.env.DATABASE_URL) throw new BackupError('Set DATABASE_URL to the dedicated CC bot database');
    const destination = resolve(args[0]);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
    const snapshot = await exportSnapshot(pool);
    const text = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new BackupError('Backup exceeds 100 MiB; use PostgreSQL pg_dump instead');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, text, { flag: 'wx', mode: 0o600 });
    console.log(`Saved ${snapshot.records.length} bourse records to ${destination}. Existing files are never overwritten.`);
} catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
} finally { await pool?.end(); }
