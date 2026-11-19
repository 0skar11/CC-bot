# AGENTS.md — CC-bot

Node 22, ESM, discord.js v14, PostgreSQL key-value store (`client.db`). Deployed from `main` to Railway: a push to `main` is a production deploy.

## Commands
- Install: `npm ci`
- Tests: `node scripts/test.js` (loads `tests/env.js`; run a single file with `node --import ./tests/env.js --test tests/<file>.test.js`)
- Static check (all relative imports resolve): `node scripts/check.js`
- Slash-command registry dry run: `npm run registry:dry`

There is no lint or build step. Run tests and the static check before every PR. A couple of timing tests can be flaky under load: re-run once.

## Layout
- `src/games/**`: native chat games (registry.js, router.js, engine/*, games/*, data/*, helpMenu.js). Contract: docs/GAMES_PLAN.md.
- `src/services/cc/**`: CC economy, casino, bourse, guide, invite tracking and gifts, welcome helpers.
- `src/config/**`: configuration (CC amounts in `cc.js`, games rules in `games.js`, amounts parser in `amount.js`).
- `src/utils/database/keys.js`: every DB key; backups only accept whitelisted key patterns in `scripts/lib/bourseBackup.js`.
- `scripts/**`: migrate, register (slash commands), backup/restore, database merge helper (incomplete, see the owner before using it).

## Rules
- CC balance changes only through `updateCCState` (mutex + transaction); payouts are idempotent; never pay from member-controlled text.
- Everything applies to all servers (owner's rule of 2026-11-17). Owner-only features use the owner ids, not a guild id.
- Keep each file's existing line endings (many files are CRLF). No invisible characters in source (use String.fromCharCode escapes).
- Tests for every change. Game rewards: single answer 500 CC + 1 point (20,000/day cap); group and two-player win 2,000 CC + 5 points (no cap).
- Question cards that reveal the answer are images. Typed shortcuts stay silent in ordinary chat. Bot replies: short Egyptian Arabic.
- No secrets in code, commits, PRs or logs. If a task needs a token, a Discord portal switch or a Railway variable, stop and list it for the owner.
- Work on a feature branch and open a PR into `main`; do not push to `main` directly.
