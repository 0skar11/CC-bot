# CC bot

Private standalone stock-market extraction from [0skar11/DISbot](https://github.com/0skar11/DISbot), source commit `af35e8fd01995b59d0013ecc2a254ce0c477a97c` (MIT). Create the separate Discord application and bot with the name **CC bot**. One slash command, `bourse`, with its stock-only typed aliases and confirmation buttons. No general economy, games, store, moderation or utility commands.

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

For private setup, turn **Public Bot off** in the new application's Bot settings and keep installation limited to your own selected guilds. Use your own bot token only in the local `.env`. `BOURSE_GUILD_IDS` is a separate runtime allowlist: an unlisted guild cannot run stock commands or buttons. The code never installs itself or automatically registers commands into unrelated guilds.

`npm run register` replaces guild commands only in the configured guilds of the supplied application. Use the new application; the script is intentionally not run as part of install, tests or dry loading.

## Environment

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | New bot token and application ID. |
| `DATABASE_URL` | Dedicated PostgreSQL connection URL; use your provider's required SSL URL options. |
| `BOURSE_GUILD_IDS` | Required comma-separated allowed guild IDs. Empty allows none. All allowed guilds get the complete stock feature set. |
| `ECONOMY_SCOPE_ID` | Stable shared economy namespace; use one of the allowed guild IDs. Defaults to the first ID in `BOURSE_GUILD_IDS`. Keep it stable to retain the same wallets, holdings and prices. |
| `BOURSE_CHANNEL_IDS` | Optional comma-separated channel/category IDs; empty permits all channels inside allowed guilds. |
| `PREFIX` | Typed command prefix; default `!`. Stock aliases also work without it. |
| `INITIAL_CC` | Starting CC for new member records; default `0`. Set a desired nonnegative whole amount **before members start** (for example `10000`) to fund a fresh stock-only economy. Existing records receive no grant/reset. No games, transfers or admin grant command exist. |
| `TRADER_ROLE_ENABLED` | `true` enables trader role setup and its purchase button; default `false`. |
| `TRADER_ROLE_ANCHORS` | Optional `guildId:roleId,guildId:roleId` pairs. New trader roles are placed above these roles. Without an anchor, Discord's normal below-bot position is used. No leveling system is required. |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` or `silent`; default `info`. Logs go to the console. |

The migration creates only `bourse_records` and its prefix index; rerunning it is safe. Its rows contain the shared market, per-user CC/holdings, and per-guild trader role setup markers. Back up this dedicated database before changing the shared scope. No original server, database or hosting configuration is used.

## Commands

| Slash form (typed form uses the same names) | Description |
| --- | --- |
| `/bourse prices` | Hourly prices and your balance; also opens the stock perks buttons. |
| `/bourse invest asset:<name-or-number> quantity:<optional integer 1–25>` | Confirm buying an asset; quantity defaults to 1. |
| `/bourse sell asset:<name-or-number> quantity:<optional integer 1–25>` | Confirm selling, with the 1.5% rounded-up fee. |
| `/bourse buymax asset:<name-or-number>` | Confirm as many units as balance and ownership cap permit. |
| `/bourse sellall asset:<optional name-or-number>` | Confirm all holdings, or every unit of one asset. |
| `/bourse holdings user:<optional member>` | Show your or another member's holdings, cost, value, profit and balance. |

Typed examples: `!bourse invest car 2`, `شراء سبيكة دهب 2`, `بيع عربية كلو`, `بيع كلو`, `ممتلكات @member`, `اسعار`. `bourse` alone shows prices. Names containing spaces stay together; assets also accept their English IDs or displayed list numbers.

Stock aliases: `اسعار`, `أسعار`, `الاسعار`, `الأسعار`, `prices`, `بورصة`, `بورصه`, `البورصة`, `البورصه`; `شراء`, `اشتري`, `استثمار`, `استثمر`, `invest`; `بيع`, `sell`; `ممتلكاتي`, `ممتلكاتى`, `ممتلكات`, `holdings`. They work with or without `PREFIX`. The all-quantity words are `كلو`, `كله`, `كلهم`, `الكل`, `all`.

Prices change lazily on the first read after each UTC hour boundary, replaying up to 168 missed hours. There is no background price timer or automatic board/channel creation. The nine assets, demand effects, limits and sell fee are preserved; the palace limit is five, other assets twenty-five.

The prices panel sells the extracted **forecast (7,800 CC)** and optional **trader role (3,000 CC)** via an owner-only confirmation. Forecast prices are locked for the next hour; delivery uses DM with a private interaction fallback. Trader setup runs once on ready for allowed guilds, remembers its role, and does not recreate a deleted role. These stock perks replace the original general-store entry point; no `/store` command exists.

## Hosting

Deploy this private repository as a Node.js worker on your chosen host (Node 20.10 or newer). Install with `npm ci` and start with `npm start`; no HTTP server or public port is needed. Set the environment variables from `.env.example` in the host's secret settings, including this bot's token and a dedicated PostgreSQL URL. Never upload `.env`.

Run `npm run migrate` against the dedicated database, then `npm run register` once for the configured guilds. Enable Message Content Intent for typed commands and keep Public Bot off for an owner-only installation. Registering commands and starting the process are separate operations.

## Offline checks

```powershell
npm run check
npm test
npm run registry:dry
```

These checks require no token, login or database. [EXTRACTION.md](EXTRACTION.md) records the exact command/interaction inventory, extraction decisions and verification limits. Run migrations, registration and live Discord validation yourself after supplying the new credentials.
