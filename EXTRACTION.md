# CC bot — extraction and verification record

Source: [0skar11/DISbot](https://github.com/0skar11/DISbot), shallow clone at `af35e8fd01995b59d0013ecc2a254ce0c477a97c`, obtained with `git -c core.longpaths=true clone --depth 1`. The sibling `DISbot-src` checkout is read-only after cloning. Its MIT license is retained in `LICENSE`.

## Exact command inventory

The registry loads **one top-level slash command: `bourse`**, guild-only. It has exactly these six subcommands, read from `src/commands/Games/bourse.js`:

| Subcommand | Options | Behavior |
| --- | --- | --- |
| `prices` | None | Displays hourly asset prices, changes, next update and caller's CC balance. |
| `invest` | `asset`: required string; `quantity`: optional integer, minimum 1, maximum 25, default 1 | Previews a purchase and requests confirmation. |
| `sell` | `asset`: required string; `quantity`: optional integer, minimum 1, maximum 25, default 1 | Previews a sale and its fee, requesting confirmation. |
| `buymax` | `asset`: required string | Computes maximum affordable units within ownership caps and requests confirmation. |
| `sellall` | `asset`: optional string, default all assets | Previews sale of all holdings, or all units of one asset. |
| `holdings` | `user`: optional Discord user, default caller | Shows that member's holdings and balance; bot accounts are rejected. |

Asset strings accept displayed 1-based asset numbers, English IDs, and normalized Arabic names. The palace has a service-level ownership cap of five despite the shared slash quantity upper bound of twenty-five.

The canonical typed command is `[PREFIX]bourse`, with the same subcommands/options as positional arguments. The default prefix is `!`; it is optional for canonical stock commands and the aliases below. An empty invocation, or `invest`/`sell` without an asset, displays prices.

| Target | All exact typed aliases |
| --- | --- |
| `bourse prices` | `اسعار`, `أسعار`, `الاسعار`, `الأسعار`, `prices`, `بورصة`, `بورصه`, `البورصة`, `البورصه` |
| `bourse invest <asset> [quantity]` | `شراء`, `اشتري`, `استثمار`, `استثمر`, `invest` |
| `bourse sell <asset> [quantity]` | `بيع`, `sell` |
| `bourse holdings [@member or user ID]` | `ممتلكاتي`, `ممتلكاتى`, `ممتلكات`, `holdings` |

There are **20 alias spellings**, all targeting `bourse`. Without a prefix, everyday aliases only run for standalone invocations, valid asset names/numbers, supported all-quantity forms, or member mentions. Ordinary chat such as `بيع العربية دي` is ignored.

`بيع <asset> <all-word>` maps to `sellall <asset>`; `بيع <all-word>` maps to `sellall`; `شراء/اشتري/استثمار/استثمر/invest <asset> <all-word>` maps to `buymax`. All-words are exactly `كلو`, `كله`, `كلهم`, `الكل`, `all` (case-insensitive English). Multiword asset names are kept together. The general-store English alias `buy` is deliberately absent because it was not a bourse alias in the source.

No slash or prefix `cc`, `cctop`, `store`, `give`, credit administration, games, help, music or other commands are registered. Balances remain available inside prices/holdings, without separate economy commands.

## Components and automatic behavior

| Component | IDs / effect |
| --- | --- |
| Trade confirmation | `bourse:buy:<assetId>:<quantity>:<price>:<userId>` and `bourse:sell:...`; only the initiating member can confirm. |
| Sell-all confirmation | `bourse:sellall:<hour>:<userId>`; uses that hour's prices and reconfirms if the hour changed. |
| Cancel trade | `bourse:cancel:<userId>`; clears the confirmation without trading. |
| Forecast/trader preview | `bourseperk:preview:forecast:<userId>` / `bourseperk:preview:trader:<userId>` on the prices panel. Trader button appears only when enabled. |
| Perk confirmation/cancellation | `bourseperk:buy:<forecast-or-trader>:<userId>` and `bourseperk:cancel:...`; private preview and owner binding. |
| Select menus / modals | None. Unsupported components are refused before handler lookup. |

Trade buttons retain the two-second per-member cooldown, stale-price reconfirmation, receipts, ownership limits and no-mention replies. Sell-all retains partial-completion receipts if an hour boundary changes the remaining quotes.

Hourly prices have **no interval timer**: a market read advances missing UTC hours, with a 168-hour replay cap. Demand moves, guaranteed rise at 20 net purchased units, demand ceiling lift/decay, random palace pricing and 1.5% rounded-up sell fee are retained. All configured guilds share the same market, CC and holdings in a stable configured namespace.

Forecast purchases retain the source price of **7,800 CC**, lock each exact next-hour price against later demand changes, and deliver to the buyer by DM, falling back to the private confirmation response. Trader role purchase costs **3,000 CC**, rejects duplicate ownership, and refunds failed delivery. Role purchase refuses managed, uneditable or permission-bearing roles.

On `clientReady`, optional trader setup visits allowed guilds only. It finds the saved role/name or creates a permissionless `💼 تاجر` role once; a persisted created marker prevents recreation after deletion. The original Level 100 dependency is replaced by configurable per-guild anchors (or default placement). No leveling code, replacement channels, live boards, channel scans, economy reward timer or other event listeners remain.

The only event handlers are `clientReady`, `interactionCreate` and `messageCreate`. Disallowed guilds are blocked at ingress, commands and stock button handlers; optional channel/category restrictions apply to interactions and typed messages. `INITIAL_CC`, default zero, supplies an explicit opt-in starting wallet for new records. There are no reward, transfer or grant commands.

## Dependency tracing and changes

`rg -il bourse` was run across source `src/` and `scripts/` (no script matches). Every discovered source reference was reviewed as core stock behavior, necessary balance/storage/runtime support, stock-adjacent store functionality, or an unrelated host-bot exclusion rule.

Retained/adapted: `commands/Games/bourse.js`; `services/cc/bourseService.js`, `bourseUi.js`; `config/store/bourse.js`; stock confirmation buttons; mutex; minimal CC record helpers and key constructors. The source `tests/bourse.test.js` is ported; its removed `cctop` presentation assertion is replaced by the underlying stock valuation assertion. `bourseGuild.test.js` is adapted to configurable allowed guilds and the actual reduced event/command registry. Additional tests cover stock perks, configuration boundaries, concurrent purchases and SQL transaction rollback.

Replaced: hard-coded home/bourse server/channel IDs with env configuration; broad app/bootstrap/loaders with stock-only loaders; large general PostgreSQL schema with **one dedicated `bourse_records` table plus its prefix index**. Records preserve stock-compatible key shapes and JSON CC/holdings/market state. No migration against the original database or automatic data import is provided. Balance and market writes now share a PostgreSQL transaction/advisory lock, with process-local mutexes retained; failed market writes fail the trade instead of logging success after a balance save.

Stock forecast/trader purchases were extracted from the general store and exposed as prices-panel buttons; no general store command or store inventory is copied. Initial CC is a documented standalone funding option. Empty allowed guild configuration fails closed. Guild command registration is an explicit separate script, never an install/startup side effect.

Omitted entirely: moderation/security/audit systems, music/Riffy/Lavalink, leveling, games/rewards, economy transfers and administrative grants, companies, tickets, welcome, giveaways, fun, verification, general utility/logging commands, birthday/media/reaction roles, boards, reset jobs, watcher/deployment/hosting integrations, unrelated assets/emojis/promo/kemet-perfume, agent/Claude folders, skill locks and unrelated docs. Only `discord.js`, `dotenv` and `pg` are runtime dependencies; no Express, Axios, cron, Riffy, Winston or Zod is needed. Console logging is minimal runtime infrastructure.

## Verification and limits

Verified locally on Windows with **Node v22.23.2 / npm 10.9.8**:

- `npm install`: completed; 40 packages installed, 41 audited, zero reported vulnerabilities at install time.
- `npm test`: 46 tests passed, 11 suites, zero failed/skipped after the independent-review fix.
- `npm run check`: all 38 project JavaScript files pass `node --check`; static relative imports resolve inside the output folder.
- `npm run registry:dry`: exactly `bourse`, six subcommands, twenty stock aliases; two stock button namespaces; zero menus/modals. No Discord login or DB connection occurs.
- Source `git status --porcelain`: empty after extraction.

Independent review found that a configured economy scope outside the guild allowlist could discard paid forecast locks. The fix rejects that configuration, preserves the default first allowed guild, and adds three configuration regression tests. The invalid-scope regression failed before the fix and passed afterward. Routing: deep implementation → independent verifier finding → escalate fix.

Final independent review: **PASS**, with no remaining material findings. The reviewer reran all 46 tests, checked all 38 JavaScript files and the dry registry, and independently verified that selecting a second allowed guild as the economy scope preserves all nine next-hour forecast prices. README and command inventory were checked against the code.

The PostgreSQL transaction test uses a SQL adapter double and verifies one transaction/rollback restores the member debit on market-save failure. This is **not a live PostgreSQL migration or durability test**. No token or real database was supplied/read, no Discord login or command registration occurred, and no server, existing bot, balances, Neon data or hosting instance was changed. Live Discord rendering, permission/role hierarchy behavior, DM delivery, restart persistence and real PostgreSQL migrations remain unverified. Node 20.10 compatibility is specified and the test runner avoids Windows shell globs; that exact Node version was not run in this session.
