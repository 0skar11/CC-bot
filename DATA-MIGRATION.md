# Keeping player data when changing hosts

All persistent CC balances, holdings, inventory, market prices/forecasts and trader-role setup markers live in PostgreSQL's dedicated `bourse_records` table. They are not stored in the bot process or its local disk.

## Move only the bot process

The easiest move is to keep the same independent PostgreSQL database and change only the host running the bot. Stop the old process, configure the new host with the same `DATABASE_URL`, the same bot token and the same stable `ECONOMY_SCOPE_ID`, then start the new process. Keep all other relevant environment settings as well. Do not run two copies during the move, and do not delete the database when removing the old compute service.

A database outside the compute provider remains independent of that provider's trial or service deletion. PostgreSQL on the old host also works, but it must remain running and reachable; deleting that database or allowing its storage to expire loses the live data. Keep a separate downloaded backup before retiring any database or account.

## Make a portable backup

Run locally with the source database URL configured in `.env` (or in the process environment):

```powershell
npm run backup -- ./backups/cc-bot-2026-11-05.json
```

The command exports one consistent read-only PostgreSQL snapshot and never changes player records. Choose a new filename for every backup: existing files are not overwritten. Download/store copies outside the host before it expires. The ignored `backups/` folder must never be committed or exposed through a web server.

The JSON contains player IDs and balances/holdings, so treat it as private. It contains no token, password, connection URL or other environment settings. Its SHA-256 checksum detects accidental changes; it is not a signature or encryption, so restore only a backup you trust. Restrict access to the folder on Windows as well as to any cloud backup location. The CLI supports backups up to 100 MiB and 100,000 records; use standard PostgreSQL `pg_dump`/`pg_restore` for larger databases.

## Move the database too

1. Stop the old bot so no trades occur after the final backup, and take/download that backup.
2. Create a new dedicated PostgreSQL database and point the local `DATABASE_URL` to it. Do not use the original DISbot database.
3. Run `npm run migrate` to create the empty CC bot table.
4. Restore into that empty table:

```powershell
npm run restore -- ./backups/cc-bot-2026-11-05.json --confirm-empty-database
```

The restore validates the format, schema, keys, timestamps, duplicate keys and checksum before connecting to PostgreSQL. It locks the target table, refuses any nonempty target, and inserts all records in one transaction. An insert failure rolls back every restored record; it does not overwrite, merge, reset or delete existing player data.

After restoration, point the new bot host at the new database, retain the original stable `ECONOMY_SCOPE_ID`, and start the bot. Check a known member's balance and holdings before retiring the old database. Reusing the same Discord application preserves existing role IDs; saved roles cannot be copied into different Discord servers.

These commands do not register slash commands, log in to Discord, or change any data in the main DISbot database. Backups are manual exports, not an automatic offsite backup schedule.
