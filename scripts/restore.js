import 'dotenv/config';
import pg from 'pg';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BackupError, MAX_BACKUP_BYTES, parseSnapshot, restoreSnapshot, safeErrorMessage } from './lib/bourseBackup.js';

let pool;
try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[1] !== '--confirm-empty-database' || args[0].startsWith('--')) {
        throw new BackupError('Usage: npm run restore -- ./backups/cc-bot.json --confirm-empty-database');
    }
    if (!process.env.DATABASE_URL) throw new BackupError('Set DATABASE_URL to the new dedicated CC bot database');
    const source = resolve(args[0]);
    const file = await stat(source);
    if (!file.isFile() || file.size > MAX_BACKUP_BYTES) throw new BackupError('Backup must be a regular file of at most 100 MiB');
    const snapshot = parseSnapshot(await readFile(source, 'utf8'));
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
    const restored = await restoreSnapshot(pool, snapshot);
    console.log(`Restored ${restored} bourse records into the empty target database.`);
} catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
} finally { await pool?.end(); }
