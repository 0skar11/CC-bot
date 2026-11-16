import { createHash } from 'node:crypto';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const FORMAT = 'cc-bot-bourse-backup';
const VERSION = 1;
// The market, a guild's configuration, a member's record, a casino group round of a room, a member's chat
// games points (in one server, and across all servers), and who invited a member into a server (the invite gift).
const RECORD_KEY = /^guild:\d{17,20}:(?:bourse|config|economy:\d{17,20}|casino:(?:roulette|rocket):\d{17,20}|games:(?:points|global):\d{17,20}|invites:\d{17,20})$/u;

export class BackupError extends Error {
    constructor(message) { super(message); this.name = 'BackupError'; }
}

function requireFields(value, fields, label) {
    if (!value || Array.isArray(value) || typeof value !== 'object'
        || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
        throw new BackupError(`Invalid ${label} fields`);
    }
}

function isoDate(value, label) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value) throw new BackupError(`Invalid ${label}`);
}

// Canonical JSON hashes nested objects independently of their property order.
// Concatenating serialized keys avoids assigning untrusted keys such as __proto__.
function canonical(value, depth = 0, ancestors = new Set()) {
    if (depth > 100) throw new BackupError('Backup JSON nesting exceeds 100 levels');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== 'object' || ancestors.has(value)) throw new BackupError('Backup contains invalid JSON data');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${Array.from(value, (entry) => canonical(entry, depth + 1, ancestors)).join(',')}]`;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
            throw new BackupError('Backup contains invalid JSON data');
        }
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1, ancestors)}`).join(',')}}`;
    } finally { ancestors.delete(value); }
}

function checksum(payload) {
    return `sha256:${createHash('sha256').update(canonical(payload)).digest('hex')}`;
}

function validatePayload(payload) {
    if (payload.format !== FORMAT || payload.version !== VERSION) throw new BackupError('Unsupported backup format or version');
    isoDate(payload.createdAt, 'backup creation date');
    if (!Array.isArray(payload.records) || payload.records.length > 100_000) throw new BackupError('Invalid backup record count');
    const keys = new Set();
    for (const record of payload.records) {
        requireFields(record, ['key', 'value', 'updatedAt'], 'record');
        if (typeof record.key !== 'string' || !RECORD_KEY.test(record.key)) throw new BackupError('Invalid bourse record key');
        if (keys.has(record.key)) throw new BackupError('Duplicate bourse record key');
        keys.add(record.key);
        isoDate(record.updatedAt, 'record update date');
        canonical(record.value);
    }
}

export function createSnapshot(records, createdAt = new Date().toISOString()) {
    const payload = { format: FORMAT, version: VERSION, createdAt, records };
    validatePayload(payload);
    return { ...payload, checksum: checksum(payload) };
}

export function validateSnapshot(snapshot) {
    requireFields(snapshot, ['format', 'version', 'createdAt', 'records', 'checksum'], 'backup');
    const { checksum: savedChecksum, ...payload } = snapshot;
    validatePayload(payload);
    if (typeof savedChecksum !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(savedChecksum)
        || savedChecksum !== checksum(payload)) throw new BackupError('Backup checksum mismatch');
    return snapshot;
}

export function parseSnapshot(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) {
        throw new BackupError('Backup file exceeds 100 MiB');
    }
    let snapshot;
    try { snapshot = JSON.parse(text); }
    catch { throw new BackupError('Backup file is not valid JSON'); }
    return validateSnapshot(snapshot);
}

export async function exportSnapshot(pool) {
    const connection = await pool.connect();
    try {
        await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows } = await connection.query('SELECT key, value, updated_at FROM bourse_records ORDER BY key');
        const snapshot = createSnapshot(rows.map((row) => ({
            key: row.key, value: row.value,
            updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        })));
        await connection.query('COMMIT');
        return snapshot;
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { connection.release(); }
}

export async function restoreSnapshot(pool, snapshot) {
    // Validate all input before opening a database connection or inserting anything.
    validateSnapshot(snapshot);
    const records = structuredClone(snapshot.records);
    const connection = await pool.connect();
    try {
        await connection.query('BEGIN');
        await connection.query('LOCK TABLE bourse_records IN ACCESS EXCLUSIVE MODE');
        const { rows } = await connection.query('SELECT EXISTS (SELECT 1 FROM bourse_records) AS occupied');
        if (rows[0]?.occupied !== false) throw new BackupError('Restore refused: target bourse_records must be empty');
        for (const record of records) {
            await connection.query('INSERT INTO bourse_records(key, value, updated_at) VALUES($1, $2::jsonb, $3::timestamptz)',
                [record.key, JSON.stringify(record.value), record.updatedAt]);
        }
        await connection.query('COMMIT');
        return records.length;
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { connection.release(); }
}

export function safeErrorMessage(error) {
    if (error instanceof BackupError) return error.message;
    const code = /^[A-Z0-9_]{1,32}$/u.test(error?.code || '') ? error.code : 'DATABASE_OR_FILE_ERROR';
    return `Operation failed (${code}); credentials are not logged`;
}
