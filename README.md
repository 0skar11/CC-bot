# CC bot

Standalone stock market, balance and leaderboard from [0skar11/DISbot](https://github.com/0skar11/DISbot) (MIT). **CC bot** uses a separate Discord application. Its slash commands are `/bourse`, `/cc` and `/cctop`.

## Setup on Windows

Use Node.js **20.10+** and a **new Discord application/token plus a dedicated PostgreSQL database**. This package uses its own `bourse_records` table and does not import or migrate the original bot's balances.

```powershell
cd bourse-bot
npm install
Copy-Item .env.example .env
# Edit .env with your NEW application's configuration.
npm run migrate
npm run register
npm start
```

Enable **Message Content Intent** in the Discord developer portal for typed commands. Invite with `bot` and `applications.commands`, and grant View Channels, Send Messages, Embed Links and Read Message History. Trader roles additionally require Manage Roles, with the bot's role above the trader role and any configured anchor.

For public installation, turn **Public Bot on**, enable Guild Install and configure the Discord-provided install link with `bot` and `applications.commands`. Set `BOURSE_GUILD_IDS=*` with an explicit stable `ECONOMY_SCOPE_ID`; use the application ID as the namespace before any players start. The runtime then accepts every guild where the bot is installed. For an owner-only deployment, turn Public Bot off and configure a finite guild allowlist instead. Keep the token in local `.env` or host secrets only.

`npm run register` registers `/bourse`, `/cc` and `/cctop` in the configured application. It replaces the global command list in public mode or each configured guild's list in finite-allowlist mode. [PUBLIC-MODE.md](PUBLIC-MODE.md) describes the two modes.

## Environment

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | New bot token and application ID. |
| `DATABASE_URL` | Dedicated PostgreSQL connection URL; use your provider's required SSL URL options. |
| `BOURSE_GUILD_IDS` | Required comma-separated allowed guild IDs, or exactly `*` for every installed guild. Empty allows none; mixed wildcard/ID lists are rejected. |
| `ECONOMY_SCOPE_ID` | Stable shared economy namespace. Public mode requires an explicit Discord snowflake such as the application ID. Finite mode defaults to the first allowed guild and requires an allowed guild ID. Never change it when moving hosts. |
| `BOURSE_CHANNEL_IDS` | Optional comma-separated channel/category IDs; empty permits all channels inside allowed guilds. |
| `PREFIX` | Typed command prefix, default `!`. Command aliases also work without it. |
| `INITIAL_CC` | Starting CC for new member records; default `0`. Set a desired nonnegative whole amount **before members start** (for example `10000`) to fund a fresh stock-only economy. Existing records receive no grant/reset. No games, transfers or admin grant command exist. |
| `TRADER_ROLE_ENABLED` | `true` enables trader role setup and its purchase button; default `false`. |
| `STREAK_ENABLED` | `true` enables daily streaks in the existing CHAOS streak room. Defaults to `false`. |
| `TRADER_ROLE_ANCHORS` | Optional `guildId:roleId,guildId:roleId` pairs. New trader roles are placed above these roles. Without an anchor, Discord's normal below-bot position is used. No leveling system is required. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `silent`; default `info`. Logs go to the console. |

The migration creates only `bourse_records` and its prefix index; rerunning it is safe. Its rows contain the shared market, per-user CC, holdings and streaks, and per-guild configuration. Back up this dedicated database before changing the shared scope.

## Commands

| Slash form (typed form uses the same names) | Description |
| --- | --- |
| `/bourse prices` | Hourly prices and your balance; also opens the stock perks buttons. |
| `/bourse invest asset:<name-or-number> quantity:<optional integer 1–25>` | Confirm buying an asset; quantity defaults to 1. |
| `/bourse sell asset:<name-or-number> quantity:<optional integer 1–25>` | Confirm selling, with the 1.5% rounded-up fee. |
| `/bourse buymax asset:<name-or-number>` | Confirm as many units as balance and ownership cap permit. |
| `/bourse sellall asset:<optional name-or-number>` | Confirm all holdings, or every unit of one asset. |
| `/bourse holdings user:<optional member>` | Show your or another member's holdings, cost, value, profit and balance. |
| `/cc user:<optional member>` | Show your CC balance or the selected member's. |
| `/cctop` | Show the top 15 and your rank in the shared economy, ordered by CC balance plus holdings' sale value after fees. |

Typed examples: `!bourse invest car 2`, `شراء سبيكة دهب 2`, `بيع عربية كلو`, `بيع كلو`, `ممتلكات @member`, `اسعار`. `bourse` alone shows prices. Names containing spaces stay together; assets also accept their English IDs or displayed list numbers.

Stock aliases: `اسعار`, `أسعار`, `الاسعار`, `الأسعار`, `prices`, `بورصة`, `بورصه`, `البورصة`, `البورصه`; `شراء`, `اشتري`, `استثمار`, `استثمر`, `invest`; `بيع`, `sell`; `ممتلكاتي`, `ممتلكاتى`, `ممتلكات`, `holdings`. They work with or without `PREFIX`. The all-quantity words are `كلو`, `كله`, `كلهم`, `الكل`, `all`.

For balances, use `cc`, `bal`, `balance`, `money`, `cash`, `credits`, `رصيد`, `رصيدي`, `رصيدى`, `فلوس` or `كريدت`, optionally followed by a mention or a user ID. For the leaderboard, use `cctop`, `top cc`, `توب cc` or `توب كريدت`. These work with or without `PREFIX` in allowed channels.

Prices change lazily on the first read after each UTC hour boundary, replaying up to 168 missed hours. There is no background price timer or automatic board/channel creation. The nine assets, demand effects, limits and sell fee are preserved; the palace limit is five, other assets twenty-five.

The prices panel sells the extracted **forecast (7,800 CC)** and optional **trader role (3,000 CC)** via an owner-only confirmation. Forecast prices are locked for the next hour; delivery uses DM with a private interaction fallback. Trader setup runs once on ready for allowed guilds, remembers its role, and does not recreate a deleted role. These stock perks replace the original general-store entry point; no `/store` command exists.

## Hosting

Deploy this private repository as a Node.js worker on your chosen host (Node 20.10 or newer). Install with `npm ci` and start with `npm start`; no HTTP server or public port is needed. Set the environment variables from `.env.example` in the host's secret settings, including this bot's token and a dedicated PostgreSQL URL. Never upload `.env`.

Run `npm run migrate` against the dedicated database, then `npm run register`. On Railway these can be the pre-deploy command `npm run migrate && npm run register`, with `npm start` as the start command. Enable Message Content Intent for typed commands. Registering commands and starting the process are separate operations.

## Player data and moving hosts

Wallets, holdings, prices, forecast locks and trader-role records live in PostgreSQL, not the bot container. A container restart does not reset them. Keep `ECONOMY_SCOPE_ID`, the bot token and the database connection stable when moving only the worker.

If the database will move too, stop the old worker, export a current private snapshot with `npm run backup -- ./backups/move.json`, and restore to an empty migrated database with `npm run restore -- ./backups/move.json --confirm-empty-database`. The restore refuses existing data. Keep backups outside Railway and take a fresh one before removing the database or letting its hosting expire. Never run two workers during the move. Full steps and verification limits are in [DATA-MIGRATION.md](DATA-MIGRATION.md).

## Offline checks

```powershell
npm run check
npm test
npm run registry:dry
```

These checks require no token, login or database. [EXTRACTION.md](EXTRACTION.md) records the exact command/interaction inventory, extraction decisions and verification limits. Run migrations, registration and live Discord validation yourself after supplying the new credentials.
