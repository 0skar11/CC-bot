# CC-bot games: plan

Goal: CC-bot runs every game itself (Arabic and English words), pays CC from its own economy, and does not depend on Clover or any other bot.

## Decisions (defaults, change any of them later)

| Topic | Decision |
|---|---|
| Rewards | First correct answer (single games) and a two-player (dual) win (`GAMES.duel.winKind = 'answer'`, so two friends cannot farm past the cap) 500 CC, at most 20,000 CC per member per UTC day from answers and points conversions together (one cap shared with Clover, in `CC.gamesBot`). Group win 2,000 CC with no limit: never trimmed by the cap and not counted in it. |
| Points (نقاط) | Every win adds points (answer 1, group win 5) kept per server and per member. `توب` = this server, `عالمي` = all servers CC-bot serves. `convert` turns points into CC. |
| Coins | Coins are CC. `transfer` is the existing `تحويل`. |
| Premium | No premium tier: the games marked premium are free for everyone. |
| Trusted members | Owners, Manage Server, a role in `EVENT_ROLE_IDS`, a user in `TRUSTED_USER_IDS` or a role in `TRUSTED_ROLE_IDS`. They may start any game in any channel of an allowed server. |
| Rooms | Anyone may start games in the open channels (`OPEN_GAMES_CHANNEL_IDS`, default `1570728118182744145`); elsewhere only trusted members, and anyone else gets no reply. The general commands (`اوامر`, `توب`, `نقاط`, `convert`) answer everyone in `GAMES_CHANNEL_IDS` and the bot's rooms. One game at a time per room. |
| Clover | Its payout reader stays. While Clover is still in the server both bots answer the same words: remove Clover (or its permissions in the room) when the native games go live. |
| Content | Words, riddles and questions are written into `src/games/data/` (no outside service at runtime, so nothing breaks when a site is down). Pictures are made by the bot (sharp) from bundled data. |

## Layout

```
src/games/
  registry.js          every game: id, Arabic and English words, kind (single/dual/group), min/max players, run()
  engine/session.js    one session per room, timers, cleanup on restart
  engine/round.js      "first correct answer" round (used by all question games)
  engine/lobby.js      join lobby with buttons (min/max players, countdown, host)
  engine/rewards.js    pays CC (shared daily cap) and points
  engine/points.js     points and wins per server and global
  engine/admin.js      event-admin check
  engine/text.js       Arabic normalisation (tashkeel, alef, hamza, ya, ta marbuta) and answer matching
  games/<id>.js        one file per game
  data/*.js            word lists, questions, riddles, countries, brands, products
```

## Phases (each one is tested, committed and deployed before the next)

0. **Foundation**: registry, session, round, lobby, rewards, points, admin, text matching, typed-command routing, help menu, tests.
1. **Text games, single**: اسرع، فكك، حروف، حرف، جمع، مفرد، ضد، رياضيات، عكس، ارقام، ترجم، رتب، عد، سؤال، لغز، كت، اعلام. **General**: اوامر، توب، عالمي، نقاط، convert.
2. **Picture games, single**: خريطة، تمويه، شعار، لاعب، نادي.
3. **Two players**: xo، حجره، توصيل، شطرنج. Built: `xo` (`.اكس` / `.xo`), `حجره` (`.rps`), `توصيل` (`.connect`) on engine/duel.js: the challenger opens a lobby of two (`GAMES.duel.joinSeconds`), the first to join plays, the challenger moves first, board buttons `g:duel:<boardId>:<move>` (and the connect-four column select) answer only the two players (only the player whose turn it is; حجره picks are hidden, answered privately), every move (every حجره round) has `GAMES.duel.moveSeconds` with the countdown line, running out forfeits, the win is paid once like a right answer (500 CC + 1 point, counted in the daily cap; at the cap the win line shows the limit notice) and shown with `announceWin` (play-again). Chess is still to come.
4. **Group core**: فعالية، تصويت، روليت، كراسي، سباق، لغم، غميضة، xo/حجره/توصيل (bracket), خداع، ريبلكا، منتجات، دول، مافيا.
5. **Group, premium list**: بومب، سلسلة، الجاسوس، بحث، كلمات، كروت، شفرة، كودنيمز.
6. **Single, premium list**: ايموجي، ثعبان، متشابهات، زر، الوان، 2048. **Store**: store/shop, gift, transfer.
7. **Live test in CHAOS Club**, fixes, final report with the extras.

## Contract (phase 0, every later game follows it)

A game is one file in `src/games/games/<id>.js` whose default export is its definition. `loadGames()` (src/games/registry.js) registers the general commands (src/games/general.js) and then every file there at startup; a word used twice, or a word that is already a bot command (`مينز`, `تحويل`, `help`, `ستريك`...), throws at load so the clash fails the boot and the tests, never a room. Words are compared after `normalize()` (`تجربه` finds `تجربة`).

```js
export default {
    id: 'fast',                                // unique, no spaces or ':'
    kind: 'single',                            // 'single' | 'dual' | 'group' ('general' = src/games/general.js)
    names: { ar: ['اسرع'], en: ['fast'] },     // one word each, typed after the PREFIX or a dot: `.اسرع`, `!fast`
    description: { ar: '...', en: '...' },     // optional: the line in `اوامر`
    minPlayers: 1, maxPlayers: 1,              // defaults: single 1/1, dual 2/2, group GAMES.lobby (2/25)
    eventAdminOnly: false,                     // true: trusted members only, even in the open channels (the sample `test`)
    acceptArgs: (args) => args.length === 0,   // optional: words allowed after the game word (default: none)
    async run(ctx) { /* the game */ },
};
```

Before `run(ctx)` the router (src/games/router.js) has checked: the message starts with the PREFIX or `.` and a game word, the words after it pass `acceptArgs` (otherwise the message goes on to the rest of the bot untouched, so `!توب cc` is still cctop), who may start it where (a trusted member, `isTrustedMember` in engine/admin.js, in any channel of an allowed server; anyone else only in an open channel, `isOpenGamesChannel` in src/config/games.js: `OPEN_GAMES_CHANNEL_IDS`, channels or categories, default `1570728118182744145`; a member who is not trusted gets no reply at all outside the open channels; `eventAdminOnly` games need a trusted member even in an open channel, where anyone else gets one short notice at most every `GAMES.noticeGapMs`), and that the room is free (a busy room answers each member once "في لعبة شغالة" in the language of the typed word). The session holds the room until `run` returns, an error is thrown (logged, one short line in the room) or 30 minutes pass (`GAMES.maxLifetimeMs`).

`ctx`:

| Field | What it is |
|---|---|
| `client`, `message`, `channel`, `guild`, `guildId`, `channelId` | The Discord objects of the typed command. |
| `starter`, `member` | The User who typed it, and their GuildMember (or null). |
| `args` | The words after the game word. |
| `lang` | `'ar'` or `'en'`, from the script of the typed word. |
| `game` | This definition (with defaults filled in). |
| `session` | The room's GameSession: `setTimeout` / `clearTimeout` (cleared at the end), `onEnd(fn)`, `ended`, `endReason`, `data` (free space), `clock`. |
| `askRound({ prompt, validate, timeMs, reveal, cooldownMs })` | First right answer wins. Resolves `{ winner, member, message, result, elapsedMs, prompt }`, `{ timeout: true, prompt }` (the answer was shown) or `{ cancelled: true, reason }`. `validate(content, message)` returns true/false or `{ ok, ... }` (may be async). Bots and webhooks never answer; one try per member per 700 ms. |
| `openLobby({ min, max, joinSeconds, title, description, hostPlays })` | Join / Leave / Start (host) buttons `g:<action>:<lobbyId>`; they work for any member in any text channel of an allowed server (src/events/interactionCreate.js), so anyone can join a game a trusted member started anywhere. Resolves `{ players, reason }` (`start`, `full`, `time`) or `{ cancelled: true, reason, players }` (`players` = fewer than min). |
| `rewardWin(userId, kind)` | `kind` `'answer'` (500 CC + 1 point, within the 20,000 CC a day shared with Clover and the points conversion) or `'group'` (2,000 CC + 5 points, no limit and not counted in the cap). Resolves `{ ok, amount, balance, points, totalPoints, wins, capped }`; show it with `ctx.announceWin(round, reward, kind)` (engine/rewards.js announceWin: the `winPayload` line as a Discord reply to the winner's message, pinging only the winner, a plain post when that message was deleted, with the `🔁 العب تاني` button `g:again:<gameId>` of engine/again.js unless `{ again: false }`). Never throws. |
| `embed(title, description, options)` | A `ccEmbed` in the games colour. |
| `send(input)` | Posts a text, an embed, a payload or a function's result in the room, without pings. |
| `random()` | A number in [0, 1) (tests replace it). |

Helpers for every game: `matches(input, answers)` and `normalize(text)` (engine/text.js), `winPayload` / `announceWin` (engine/rewards.js). Play again (engine/again.js, router handleAgainButton): a 'single' game's time's-up reveal and every announceWin carry `g:again:<gameId>`; a press starts the same game in the same room under the typed command's rule (router startRule), one round per room, a 3 s cooldown per room, one use, gone after 60 s. The one games menu is the general command `menu` (`.العاب` / `.games` / `.menu`, also `العاب` without the prefix and `/games`): the chat games by kind, the casino games and a select (`g:menu:<lang>:<n>`) that starts a chat game under the same rule. Points: `addPoints`, `getPoints`, `topServer(client, guildId, limit)`, `topGlobal(client, limit)` (engine/points.js); `convertPoints(client, guildId, userId, points)` (engine/rewards.js, 1 point = 100 CC, at least 5). Records: `guild:<guildId>:games:points:<userId>` and `guild:<scope>:games:global:<userId>` (both in backups). Every knob is `GAMES` in src/config/games.js. Tests: tests/games*.test.js with the doubles in tests/gamesFakes.js (fake clock, room with collectors, in-memory database).

## Honest limits

- `دول` (street photo) needs a street-view service with a key. Replacement: a landmark or city photo, same rules.
- `لاعب` / `نادي` need pictures of real players and clubs: they come from a curated list with Wikipedia pictures fetched once and cached; if a picture fails the round picks another.
- `مافيا`, `الجاسوس`, `كودنيمز` hide roles: roles are shown through ephemeral button replies, not DMs.
- Nothing here has been tried live yet; phase 7 is where that happens.
