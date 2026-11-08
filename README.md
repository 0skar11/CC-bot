# CC bot

Standalone stock market, balance and leaderboard from [0skar11/DISbot](https://github.com/0skar11/DISbot) (MIT), plus a CC casino with solo and group games. **CC bot** uses a separate Discord application. Its slash commands are `/bourse`, `/casino`, `/games`, `/cc`, `/cctop`, `/give`, `/addcc` and `/help`.

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

`npm run register` registers `/bourse`, `/casino`, `/games`, `/cc`, `/cctop`, `/daily`, `/give`, `/addcc`, `/removecc` and `/help` in the configured application. It replaces the global command list in public mode or each configured guild's list in finite-allowlist mode. [PUBLIC-MODE.md](PUBLIC-MODE.md) describes the two modes.

## Environment

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | New bot token and application ID. |
| `DATABASE_URL` | Dedicated PostgreSQL connection URL; use your provider's required SSL URL options. |
| `BOURSE_GUILD_IDS` | Required comma-separated allowed guild IDs, or exactly `*` for every installed guild. Empty allows none; mixed wildcard/ID lists are rejected. |
| `ECONOMY_SCOPE_ID` | Stable shared economy namespace. Public mode requires an explicit Discord snowflake such as the application ID. Finite mode defaults to the first allowed guild and requires an allowed guild ID. Never change it when moving hosts. |
| `BOURSE_CHANNEL_IDS` | Optional comma-separated channel/category IDs; empty permits all channels inside allowed guilds. |
| `PREFIX` | Typed command prefix, default `!`. Command aliases also work without it. |
| `INITIAL_CC` | Starting CC for new member records; default `0`. Set a desired nonnegative whole amount **before members start** (for example `10000`) to fund a fresh stock-only economy. Existing records receive no grant/reset. Besides the streak, CC comes from the [casino](#casino), `give` transfers and the owner-only `addcc`. |
| `TRADER_ROLE_ENABLED` | `true` enables trader role setup and its purchase button; default `false`. |
| `STREAK_ENABLED` | `true` enables daily streaks in the existing CHAOS streak room. Defaults to `false`. |
| `CASINO_CHANNEL_IDS` | Optional comma-separated channel/category IDs where `/casino` and its typed words work (threads inside them too), including the group rounds. Empty uses the same channels as everything else (`BOURSE_CHANNEL_IDS`, or every channel when that is empty too). Elsewhere the slash form answers privately with the casino rooms and typed words are ignored. The games menu (`/games`, `العاب`) answers in these rooms and in the bot's channels. |
| `CASINO_MAX_BET` | Optional cap on one casino bet (a whole number from `10` to `10000000000000`). Empty (default) = no cap: a bet is only limited by the balance. The slash option limit is set at registration, so run `npm run register` after changing it. |
| `CASINO_EMOJIS` | Optional JSON object that swaps the casino's emojis for the server's custom ones, keyed by meaning: `{"slots.cherry":"<:cherry:123456789012345678>","mines.safe":"<a:gem:123456789012345678>"}` (every key and its Unicode default is in `src/config/emojis.js`). A value is a Unicode emoji or a custom emoji tag `<:name:id>` / `<a:name:id>`; a custom emoji only shows when it lives in a server the bot is in. Invalid entries and unknown keys are skipped with a warning in the log. Empty (default) uses the Unicode emojis. Titles, footers, button labels and the join form keep the Unicode emoji, since Discord prints a custom emoji tag there as text; the rocket's messages keep their own emojis. |
| `TRADER_ROLE_ANCHORS` | Optional `guildId:roleId,guildId:roleId` pairs. New trader roles are placed above these roles. Without an anchor, Discord's normal below-bot position is used. No leveling system is required. |
| `OWNER_IDS` | Comma-separated Discord user IDs allowed to use `addcc` (default: the original owner). Owner list lives in `src/config/owners.js`. |
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
| `/casino mines bet:<integer> mines:<optional 1–8, default 3>` | Start a 3×3 mines board: open safe cells, cash out whenever you like, lose the bet on a mine. |
| `/casino coinflip bet:<integer> side:<optional heads or tails, default heads>` | Heads (`ملك`) or tails (`كتابة`); a win pays ×1.94. |
| `/casino slots bet:<integer>` | Three reels; three of a kind pays up to ×25, two of a kind gives the bet back. |
| `/casino dice bet:<integer> number:<optional 1–99, default 50> direction:<optional under or over, default under>` | Dice 0.00–99.99: under N wins below N.00 (N% chance), over N from N.00 up; a c% chance pays ×(97 / c). |
| `/casino chicken bet:<integer>` | Chicken road: each press of 🐔 Step moves the chicken one lane (it makes it 4 times in 5); every lane raises the multiplier (×0.97 × 1.25 per lane, up to ×84.13 after 20 lanes), 💰 Cash out takes it, a car loses the bet. |
| `/casino roulette bet:<integer> choice:<red, black, green or 0–36>` | Group roulette: the first bet opens a 20-second round for the room, then one spin for everybody. Colours pay ×2, a number (0 = green) ×36. |
| `/casino rocket bet:<integer> target:<optional automatic cash-out 1.01–100>` | Group crash: the room boards for 15 seconds, the rocket takes off for everybody, and each rider cashes out with the button (or automatically at the target) before it crashes. Crash is this rocket: there is no separate `/casino crash`, and the typed `كراش` / `crash` join the same round. |
| `/games language:<optional ar or en>` | The games menu: every solo and group game, with what it is, a typed example, the smallest bet and the house edge. Without `language` it follows your Discord language. |
| `/cc user:<optional member>` | Show your CC balance or the selected member's. |
| `/cctop` | Show the top 15 and your rank in the shared economy, ordered by CC balance plus holdings' sale value after fees. |
| `/help topic:<optional cc, bourse, casino or streak>` | The guide to the whole bot in Egyptian Arabic (CC, balance and leaderboard, the bourse, the casino and the streak); a topic shows only that part. |

Typed examples: `!bourse invest car 2`, `شراء سبيكة دهب 2`, `بيع عربية كلو`, `بيع كلو`, `ممتلكات @member`, `اسعار`. `bourse` alone shows prices. Names containing spaces stay together; assets also accept their English IDs or displayed list numbers.

Stock aliases: `اسعار`, `أسعار`, `الاسعار`, `الأسعار`, `prices`, `بورصة`, `بورصه`, `البورصة`, `البورصه`; `شراء`, `اشتري`, `استثمار`, `استثمر`, `invest`; `بيع`, `sell`; `ممتلكاتي`, `ممتلكاتى`, `ممتلكات`, `holdings`. They work with or without `PREFIX`. The all-quantity words are `كلو`, `كله`, `كلهم`, `الكل`, `all`.

For balances, use `cc`, `bal`, `balance`, `money`, `cash`, `credits`, `رصيد`, `رصيدي`, `رصيدى`, `فلوس` or `كريدت`, optionally followed by a mention or a user ID. For the leaderboard, use `cctop`, `top cc`, `توب cc` or `توب كريدت`. These work with or without `PREFIX` in allowed channels.

Casino words (with or without `PREFIX`, in the casino rooms): `مينز 100 3` (also `ماينز`, `الغام`, `ألغام`, `mines`; the mine count is optional), `عملة 100 ملك` (also `عمله`, `coinflip`, `cf`; the side is `ملك`/`heads`/`h` or `كتابة`/`كتابه`/`tails`/`t`, in either order, default heads) and `سلوت 100` (also `سلوتس`, `slots`, `slot`). `كازينو` or `casino` alone shows how to play. Without the prefix a word only counts when followed by just the bet (and the mine count or side), so chat like `عملة رقمية` is ignored.

Newer casino words (the bet first): `نرد 100 فوق 70` or `نرد 100 تحت 30` (also `زهر`, `دايس`, `dice`; `فوق`/`اكتر`/`over` or `تحت`/`اقل`/`under`, default `تحت 50`), `روليت 100 احمر` or `روليت 100 17` (also `الروليت`, `roulette`; `احمر`/`red`, `اسود`/`black`, `اخضر`/`صفر`/`green` or a number 0–36; the colour may come first) and `صاروخ 100` or `صاروخ 100 2` (also `الصاروخ`, `rocket`, `كراش`, `crash`; the optional number is the automatic cash-out, written `2.5`, `2,5`, `x2.5` or `2.5x`) and `فرخة 100` (also `فرخه`, `دجاجة`, `دجاجه`, `chicken`; the bet alone). `كراش 100 2.5` / `crash 100 2.5` is the group rocket with an automatic cash-out at ×2.5, in the same round as `صاروخ` / `rocket`. These words are everyday chat too, so without the prefix they need a bet and only words of the game after it (`كراش` alone, `عندي كراش`, `فرخة` alone or `عندي فرخة` stay chat); with the prefix a wrong form is answered with the right one.

All-in (every game, typed only): an all-in word where the bet goes bets the whole balance, up to `CASINO_MAX_BET` when one is set: `صاروخ كل`, `rocket all`, `crash all 2` / `صاروخ كل 2` (all-in with an automatic cash-out at ×2), `مينز كل 3`, `نرد كل فوق 70`, `dice all under 30`, `روليت كل احمر`, `roulette all 17`, `عملة كل ملك`, `coinflip all heads`, `سلوت كل`, `slots all`, `فرخة كل`, `chicken all`, with or without `PREFIX`. The amount field of a group round's join form takes the same words. The words (any case) are `كل`, `الكل`, `كله`, `كلو`, `all`, `allin`, `all-in` and `max` (`ALL_IN_WORDS` in `src/config/casino.js`). They follow the same rule as a number: the game word first, the all-in word where the bet goes, then only that game's words, so chat such as `عندي صاروخ كل شيء`, `الكل صاروخ`, `all rocket` or `سلوت كل يوم` stays chat. The amount is worked out inside the same save that takes the bet (the balance that save reads, after the member's other open group stakes are already out of it), so it is never stale and never more than the balance; under the 10 CC minimum the game is refused like any bet the balance can't cover, and nothing is taken. Everything else (the cooldown, one solo game at a time, the roulette's 5 bets each, one rocket seat, payouts and edges) is the same as for a number. Games and stakes save the real number; an all-in one also carries `allIn: true` (text only), and its messages show the amount with a `🔥 كل فلوسه` / `🔥 all-in` tag. `/casino` keeps its whole-number `bet` option.

Languages (`src/services/cc/lang.js`): the casino and the games menu answer in the language of the command. A typed English word (`mines 100 3`, `coinflip 100 heads`, `cf`, `slots 100`, `dice 100 over 70`, `chicken 100`, `roulette 100 red`, `rocket 100 2`, `crash 100 2.5`, `casino`, `games`) answers in English, an Arabic word in Arabic. A slash command answers in Arabic when the member's Discord language (`interaction.locale`) is Arabic and in English otherwise (Discord currently offers no Arabic client language, so slash commands answer in English; `/games` also takes `language`). A mines board or a chicken keeps the language it was opened in (its clicks, its timeout and the restart check too). A group round is one round per game per room whatever the language (`rocket 100` and `صاروخ 50` bet on the same rocket): its one shared message is written in the language of the member who opened it (saved with the round as `lang`; rounds saved before read as Arabic), so a room that mixes languages sees the opener's language there. Private answers follow each member: a typed bet's refusals use its own word's language; a button or form answers a rider in the language they bet with, and anyone else in Arabic when their Discord is Arabic, otherwise in the language of the message they clicked. The guide (`/help`, `شرح`) and the other commands stay Arabic.

Games menu words (with or without `PREFIX`, in the casino rooms and the bot's channels): `العاب`, `ألعاب`, `الالعاب`, `الألعاب` (Arabic menu) or `games` (English menu), alone, show the same menu as `/games` (`src/services/cc/gamesMenuUi.js`): one embed on betting, one with the solo games (فردية) and one with the group games (جماعية). The rocket's entry also shows `كراش` / `crash`. Its numbers come from `CASINO` and the computed house edges, so it never drifts from the games.

Guide words (with or without `PREFIX`, in allowed channels, no `STREAK_ENABLED` needed): `شرح`, `شرح cc`, `شرح البوت`, `مساعدة`, `help` or `الشرح` send the same guide as `/help`. Its amounts come from `CC`, `bourseSettings`, `CASINO`, `STREAK` and `perkPrices`, and its typed words from `commandArgAliases` (`src/services/cc/guideUi.js`). The streak part appears only where the streak works (`STREAK_ENABLED=true`, in the streak server). Only the whole message counts, and the streak guide's own words below keep answering with the streak guide.

Streak words (with `STREAK_ENABLED=true`, in the streak server, with or without `PREFIX`): `ستريك` or `streak` shows your streak (optionally followed by a mention or a user ID), `توب ستريك` or `top streak` shows the leaderboard, and `شرح ستريك`, `ستريك شرح`, `شرح الستريك`, `الستريك` or `streak help` explains how the streak works, with the amounts taken from `STREAK` in `src/services/cc/streakService.js`. Only the whole message counts, so a longer sentence containing these words is ignored.

In the streak room, a picture, a GIF (Tenor, Giphy or `.gif` link, or its embed) or a sticker counts for the day: the bot reacts 🔥 and replies with the new streak, or replies that today was already counted. Text-only messages are ignored silently (no reply, no reaction), so members can chat in the room normally; they just don't count.

## Casino

Every game takes the bet in the same save that starts it and pays in the same save that ends it, through the shared `updateCCState` (per-member lock plus the database transaction). Randomness comes from `crypto.randomInt`. Bets are whole CC from 10 to `CASINO_MAX_BET` and never above the balance. A member plays one solo game at a time (a running mines board or chicken makes every other solo game wait, the other of the two included), with a 3-second pause between starts (group bets included), and every new command runs under the member's casino lock. Statistics: `ccStats.spent`/`earned` and `ccCasinoStats` (`played`, `won`, `lost`, `wagered`, `paidOut`) in the member's record. The rules and settings are `CASINO` in `src/config/casino.js`, whose header explains every edge.

Solo games (فردية): mines and **chicken** (played with their buttons), and coinflip, slots and **dice**, each over in one save. There is no solo crash: crash is the group rocket below (the crash engine `playCrash` stays in `src/services/cc/casinoService.js` only as the tested reference of the crash math).

Group games (جماعية) are one shared round per game per room. **Roulette**: the first bet opens a 20-second round; anyone in the room adds bets (up to 5 each, 40 per round), then the wheel spins once and the message lists every win and loss. **Rocket** (group crash, also typed `كراش` / `crash`): the first rider opens 15 seconds of boarding (25 riders); the rocket then takes off for everybody with one crash point, the message is edited once per tick (1.25 s) with a 💰 cash-out button, and the multiplier doubles every 7 seconds up to ×100. A click pays the multiplier at the moment it reached the bot; a rider can also set an automatic cash-out. Clicks from people who aren't riding, or who already cashed out, are answered privately and change nothing; riders still on board lose 2 seconds after the crash (so clicks sent just before it still count).

House edge, built into the payouts (proved by enumeration in `tests/casino.test.js`, `tests/casinoGames.test.js` and `tests/casinoGroup.test.js`):

| Game | Rule | Edge |
| --- | --- | --- |
| Mines | Cashing out after *k* safe cells with *m* mines pays bet × 0.97 × C(9, *k*) / C(9 − *m*, *k*). Reaching *k* safe cells has probability C(9 − *m*, *k*) / C(9, *k*), so every way of playing returns 97%. Cashing out before the first cell gives the bet back. | 3% |
| Coinflip | A win (1 in 2) pays ×1.94. | 3% |
| Slots | 5 equally likely symbols per reel (125 spins). Three of a kind: 🌀 ×25, 💎 ×15, 🍇 ×10, 🍋 ×6, 🍒 ×4 (5 spins, 60 in total). Two of a kind: the bet back (60 spins). Otherwise lost (60 spins). (60 + 60) / 125 = 96%. | 4% |
| Crash point (the rocket's) | Crash point (hundredths) = ⌊97 × N / (N − *u*)⌋ for *u* uniform in 0…N − 1 (N = 2³²), so it reaches a target *t* for ⌊97N / *t*⌋ of the N draws (just under 0.97 / ×*t*). A target pays bet × *t*: every target from ×1.01 to ×100 returns 97% (less under 1/N). About 4% of rockets crash at ×1.00. | 3% |
| Dice | 10,000 equally likely rolls 0.00–99.99. Under N wins N% of rolls, over N wins (100 − N)%; a c% chance (1–95) pays bet × 97 / c, so every bet returns 97%. | 3% |
| Chicken | Each lane is made with probability 4/5. Cashing out after *k* lanes pays ⌊bet × 97 × 5^*k* / (100 × 4^*k*)⌋ (bet × 0.97 × 1.25^*k*, exact whole-number math); getting *k* lanes far has probability (4/5)^*k*, so every way of playing returns 97%. Cashing out before the first lane gives the bet back; the 20th lane cashes out by itself at ×84.13. One draw *u* of 0…5²⁰ − 1 at the start decides it: lane *k* is made when *u* < 4^*k* × 5^(20 − *k*). | 3% |
| Roulette | Single zero, 37 pockets. Red or black (18 pockets) pays ×2, one number (0 = green) pays ×36: 36/37 back for every bet. | 2.70% |
| Rocket | The crash point above, drawn once per round (capped at ×100, where everyone still riding is paid ×100). An automatic cash-out at ×*t* is exactly a crash target ×*t* (97%). A button cash-out at ×*m* only counts while the crash point is above ×*m*, which returns at most 97%. | 3% |

Payouts round down to whole CC, which only adds to the edge (under 1 CC per paid game): under one point from 100 CC bets, more on the smallest ones (10 CC with 1 mine cashed out after one cell pays back exactly 10; 10 CC of chicken after one lane pays 12). Mines multipliers shown on the board (also rounded down):

| Mines | 1 cell | 2 cells | 3 cells | 4 cells | 5 cells | 6 cells | 7 cells | 8 cells |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ×1.09 | ×1.24 | ×1.45 | ×1.74 | ×2.18 | ×2.91 | ×4.36 | ×8.73 |
| 2 | ×1.24 | ×1.66 | ×2.32 | ×3.49 | ×5.82 | ×11.64 | ×34.92 | — |
| 3 | ×1.45 | ×2.32 | ×4.07 | ×8.14 | ×20.37 | ×81.48 | — | — |
| 4 | ×1.74 | ×3.49 | ×8.14 | ×24.44 | ×122.22 | — | — | — |
| 5 | ×2.18 | ×5.82 | ×20.37 | ×122.22 | — | — | — | — |
| 6 | ×2.91 | ×11.64 | ×81.48 | — | — | — | — | — |
| 7 | ×4.36 | ×34.92 | — | — | — | — | — | — |
| 8 | ×8.73 | — | — | — | — | — | — | — |

Chicken multipliers (also rounded down) and the chance of getting that far:

| Lanes | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multiplier | ×1.00 | ×1.21 | ×1.51 | ×1.89 | ×2.36 | ×2.96 | ×3.70 | ×4.62 | ×5.78 | ×7.22 | ×9.03 |
| Chance | 100% | 80% | 64% | 51.2% | 41.0% | 32.8% | 26.2% | 21.0% | 16.8% | 13.4% | 10.7% |

| Lanes | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multiplier | ×11.29 | ×14.11 | ×17.64 | ×22.05 | ×27.56 | ×34.46 | ×43.07 | ×53.84 | ×67.30 | ×84.13 |
| Chance | 8.6% | 6.9% | 5.5% | 4.4% | 3.5% | 2.8% | 2.3% | 1.8% | 1.4% | 1.2% |

Every casino message has the same shape (`src/services/cc/casinoUi.js`, the roulette in `casinoGroupUi.js`): the game in the title, a first line with the player and the bet, the game's picture (the board, the coin, a framed slot machine, the roll on its 0–100 bar, the road, the wheel), the result in big letters, the money in a quote block (bet and payout, profit or loss, balance) and the odds or a hint in the footer. Each game has its own embed colour while it runs and a result turns green (paid more than the bet), red (less) or gold (the bet back); the spun roulette takes its pocket's colour and the rocket keeps the CC gold. Every emoji comes from the registry in `src/config/emojis.js`, so `CASINO_EMOJIS` can swap in the server's custom emojis without code changes.

The mines board shows the cash-out amount now, what the next safe cell would pay and the multipliers after it. Its buttons work only for the player and only for that game: a double click, a second cash-out or a click on an older board changes nothing and is answered privately. Opening every safe cell cashes out by itself. **60 seconds without a move cash the board out by itself at its current multiplier** (the whole bet back when nothing was opened); the board's footer says so. The running game is saved in the member's record (`ccCasino`), so a restart or crash never eats a bet: on startup boards whose 60 seconds already passed are settled the same way and their message is updated (or a short notice is posted), and newer boards get their timer back and stay playable.

The chicken works the same way: one message with the road (🐔 the chicken, 🟩 the lanes crossed, ⚠️ the next lane), what cashing out pays now, what the next lane would pay and the multipliers after it, and two buttons, 🐔 Step (`casino:chick:<gameId>:<steps>:<userId>`) and 💰 Cash out (`casino:chickout:<gameId>:<userId>`), only for the player. The step button carries the lanes its board showed, so one board moves the chicken one lane at most: a double press, or a press on an older message of the same game, is acknowledged silently and changes nothing. The lane the car waits on is drawn once at the start (`crypto.randomInt`) and saved with the game in the same `ccCasino` slot (`game: 'chicken'`, `steps`, `deathStep`), never shown before the end; at the end the road shows 💀 where it was hit, or 🚗 where the car was waiting. 60 seconds without a press cash it out at its current multiplier (the bet back with no lane crossed), also after a restart. A member has one saved game at a time: a running chicken makes mines (and every other solo game) wait and the other way round, and a new game first settles an idle one, whichever it is.

Group rounds never lose a bet either. The round is saved at `guild:<scope>:casino:<roulette|rocket>:<roomId>` and each member's stake in their own record (`ccCasinoBets`); joining takes the bet, adds the stake and writes the round in one database transaction. Paying a stake removes it in the same save, so it is paid exactly once whoever gets there (the round's timer, a double click, the restart check). On startup (and before a new round opens in that room) a round the bot couldn't finish is settled from what was saved: a round still taking bets gives every bet back, a spun wheel pays with its saved pocket, a rocket cut mid-flight pays the automatic cash-outs by its saved crash point and gives back the bets of riders who cash out by hand (they couldn't click), and a rocket whose crash was already announced settles the riders still on board. Any stake whose round is gone is given back. The round's message is updated (or a notice is posted in the room).

Prices change lazily on the first read after each UTC hour boundary, replaying up to 168 missed hours. There is no background price timer or automatic board/channel creation. The nine assets, demand effects, limits and sell fee are preserved; the palace limit is five, other assets twenty-five.

The prices panel sells the extracted **forecast (7,800 CC)** and optional **trader role (3,000 CC)** via an owner-only confirmation. Forecast prices are locked for the next hour; delivery uses DM with a private interaction fallback. Trader setup runs once on ready for allowed guilds, remembers its role, and does not recreate a deleted role. These stock perks replace the original general-store entry point; no `/store` command exists.

## Hosting

Deploy this private repository as a Node.js worker on your chosen host (Node 20.10 or newer). Install with `npm ci` and start with `npm start`; no HTTP server or public port is needed. Set the environment variables from `.env.example` in the host's secret settings, including this bot's token and a dedicated PostgreSQL URL. Never upload `.env`.

Run `npm run migrate` against the dedicated database, then `npm run register`. On Railway these can be the pre-deploy command `npm run migrate && npm run register`, with `npm start` as the start command. Enable Message Content Intent for typed commands. Registering commands and starting the process are separate operations.

## Player data and moving hosts

Wallets, holdings, running casino boards and group rounds, prices, forecast locks and trader-role records live in PostgreSQL, not the bot container (backups include the casino round records). A container restart does not reset them. Keep `ECONOMY_SCOPE_ID`, the bot token and the database connection stable when moving only the worker.

If the database will move too, stop the old worker, export a current private snapshot with `npm run backup -- ./backups/move.json`, and restore to an empty migrated database with `npm run restore -- ./backups/move.json --confirm-empty-database`. The restore refuses existing data. Keep backups outside Railway and take a fresh one before removing the database or letting its hosting expire. Never run two workers during the move. Full steps and verification limits are in [DATA-MIGRATION.md](DATA-MIGRATION.md).

## Offline checks

```powershell
npm run check
npm test
npm run registry:dry
```

These checks require no token, login or database. [EXTRACTION.md](EXTRACTION.md) records the exact command/interaction inventory, extraction decisions and verification limits. Run migrations, registration and live Discord validation yourself after supplying the new credentials.
