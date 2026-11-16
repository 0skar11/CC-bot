import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_OPEN_GAMES_CHANNEL_ID, GAMES, gamesChannelIds, openGamesChannelIds, trustedRoleIds, trustedUserIds } from '../src/config/games.js';
import { economyScopeId, prefix } from '../src/config/runtime.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { default as bourse } from '../src/commands/Games/bourse.js';
import { handleLobbyButton } from '../src/games/engine/lobby.js';
import { addPoints, getPoints } from '../src/games/engine/points.js';
import { abortAll, getSession, isBusy } from '../src/games/engine/session.js';
import { loadGames, registerGame } from '../src/games/registry.js';
import { handleGamesMessage, parseGamesCommand } from '../src/games/router.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { ALICE, BOB, BOT, CAROL, GUILD, fakeChannel, fakeClient, fakeClock, flush, press, typed } from './gamesFakes.js';

let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000004${String(rooms++).padStart(2, '0')}`);

// A client with the bot's commands replaced by stubs that only record that they ran (like tests/guide.test.js).
function setup() {
    const client = fakeClient();
    const ran = [];
    client.commands = new Map();
    for (const name of ['addcc', 'bourse', 'casino', 'cc', 'cctop', 'daily', 'games', 'give', 'help', 'removecc']) {
        client.commands.set(name, {
            data: bourse.data, normalizePrefixArgs: bourse.normalizePrefixArgs, parsePrefixArgs: () => ({ options: {} }),
            execute: async () => ran.push(name),
        });
    }
    return { client, ran };
}
const say = (client, channel, content, author = ALICE, options = {}) => messageCreate.execute(typed(channel, content, author, options), client);
const textOf = (message) => [message.payload?.content, ...(message.payload?.embeds || []).flatMap((embed) => [embed.title, embed.description, ...(embed.fields || []).flatMap((field) => [field.name, field.value]), embed.footer?.text])].filter(Boolean).join('\n');
const replyText = (payload) => [payload.content, ...(payload.embeds || []).map((embed) => embed.description)].filter(Boolean).join('\n');

// Games registered only in this file (each test file runs in its own process).
await loadGames();
const gate = { release: null };
registerGame({
    id: 'grouptest', kind: 'group', names: { ar: ['جماعي'], en: ['grouptest'] }, minPlayers: 2, maxPlayers: 4,
    async run(ctx) {
        const lobby = await ctx.openLobby({ joinSeconds: 5 });
        ctx.session.data.lobby = lobby;
        if (lobby.cancelled) return;
        const reward = await ctx.rewardWin(lobby.players[1], 'group');
        ctx.session.data.reward = reward;
    },
});
registerGame({ id: 'boom', kind: 'single', names: { ar: ['انفجار'], en: ['boom'] }, run: async () => { throw new Error('bug'); } });
registerGame({ id: 'stuck', kind: 'single', names: { ar: ['معلق'], en: ['stuck'] }, run: () => new Promise((resolve) => { gate.release = resolve; }) });

afterEach(() => {
    abortAll('test');
    gamesChannelIds.clear();
    trustedUserIds.clear();
    trustedRoleIds.clear();
    openGamesChannelIds.clear();
    openGamesChannelIds.add(DEFAULT_OPEN_GAMES_CHANNEL_ID);
});

test('a games command needs the PREFIX or a dot and then a game word; plain chat never starts a game', async () => {
    assert.deepEqual(parseGamesCommand('.تجربة'), { word: 'تجربة', args: [] });
    assert.deepEqual(parseGamesCommand(`${prefix}نقاط <@1>`), { word: 'نقاط', args: ['<@1>'] });
    // A space after the PREFIX or the dot is not a command (`. top`, `! test`).
    for (const content of [`${prefix} test`, '. top', '.  توب', `${prefix}\ttest`]) assert.equal(parseGamesCommand(content), null, content);
    assert.deepEqual(parseGamesCommand(`  .top  `), { word: 'top', args: [] });
    for (const content of ['تجربة', 'test', '', '.', 'hello .test']) assert.equal(parseGamesCommand(content)?.word === 'test' || parseGamesCommand(content)?.word === 'تجربة', false, content);
    const { client, ran } = setup();
    const room = newRoom();
    for (const content of ['تجربة', 'test', 'توب', 'top', 'نقاط', 'اوامر', 'commands', 'convert 10', 'تجربة يا جماعة', '..تجربة', `${prefix}تجربة يا جماعة`, '. hello', '.hello', '.تجربةة', '. تجربة', `${prefix} تجربة`, '. top', `${prefix} test`]) {
        await say(client, room, content, ALICE, { admin: true });
    }
    assert.equal(room.sent.length, 0);
    assert.equal(room.replies.length, 0);
    assert.equal(isBusy(room.id), false);
    assert.deepEqual(ran, []);
});

test('the sample game end to end: an admin starts it, the first right answer is paid with points, the room is free again', async () => {
    const { client } = setup();
    const room = newRoom();
    await say(client, room, '.تجربة', ALICE, { admin: true });
    await flush();
    const session = getSession(room.id);
    assert.ok(session, 'the room is held');
    assert.equal(session.gameId, 'test');
    const prompt = room.sent[0].payload.embeds[0];
    assert.equal(prompt.title, '🧪 تجربة الألعاب');
    const word = /\*\*(.+?)\*\*/u.exec(prompt.description)[1];
    // A game word typed while it runs: one short notice per member, no second game.
    await say(client, room, '.تجربة', BOB, { admin: true });
    await say(client, room, `${prefix}test`, BOB, { admin: true });
    await say(client, room, '.تجربه', BOB, { admin: true });
    assert.equal(room.replies.length, 1);
    assert.match(replyText(room.replies[0]), /في لعبة شغالة/u);
    // The notice is in the language of the typed word, like every typed command (src/services/cc/lang.js).
    await say(client, room, '.test', CAROL, { admin: true });
    assert.equal(room.replies.length, 2);
    assert.match(replyText(room.replies[1]), /A game is already running/u);
    assert.equal(getSession(room.id), session);
    // A bot typing the word never wins; a wrong answer neither; the first right one does (any spelling).
    room.emit(typed(room, word, BOT));
    room.emit(typed(room, 'غلط', CAROL));
    room.emit(typed(room, `  ${word}  `, BOB));
    await session.running;
    assert.equal(isBusy(room.id), false);
    const win = textOf({ payload: room.replies.at(-1) });
    assert.match(win, new RegExp(`<@${BOB.id}> جاوب صح! \\+\\*\\*500\\*\\* 🌀 CC ・ \\+\\*\\*1\\*\\* نقطة`, 'u'));
    assert.equal((await client.db.get(getEconomyKey(economyScopeId, BOB.id))).cc, 500);
    const points = await getPoints(client, GUILD, BOB.id);
    assert.deepEqual([points.server.points, points.server.byGame.test], [1, 1]);
    assert.equal(room.live(), 0, 'no collector is left');
});

test('an English word answers in English, and abortAll ends a running game without a winner', async () => {
    const { client } = setup();
    const room = newRoom();
    await say(client, room, `${prefix}test`, ALICE, { admin: true });
    await flush();
    const session = getSession(room.id);
    assert.equal(room.sent[0].payload.embeds[0].title, '🧪 Games test');
    assert.equal(abortAll('shutdown'), 1);
    await session.running;
    assert.equal(room.sent.length, 1, 'no winner line');
    assert.equal(room.live(), 0);
    assert.equal(isBusy(room.id), false);
});

test('a member who is not trusted gets no reply at all for a game word in a normal channel', async () => {
    const { client, ran } = setup();
    const room = newRoom();
    for (const content of ['.تجربة', `${prefix}test`, `${prefix}جماعي`, '.grouptest', '.انفجار', '.boom']) {
        assert.equal(await handleGamesMessage(typed(room, content, BOB), client), true, `${content} is consumed`);
        await say(client, room, content, BOB);
    }
    await flush();
    assert.deepEqual([room.sent.length, room.replies.length, isBusy(room.id)], [0, 0, false]);
    assert.deepEqual(ran, [], 'and nothing else in the bot answers it');
});

test('a trusted member starts any game in a normal channel: Manage Server, TRUSTED_USER_IDS or TRUSTED_ROLE_IDS', async () => {
    const { client } = setup();
    const room = newRoom();
    await say(client, room, '.انفجار', ALICE, { admin: true });
    await getSession(room.id)?.running;
    assert.match(textOf(room.sent.at(-1)), /حصل خطأ في اللعبة واتقفلت/u, 'the game ran');
    trustedUserIds.add(BOB.id);
    await say(client, room, '.تجربة', BOB);
    assert.equal(getSession(room.id)?.gameId, 'test', 'a trusted user starts even the sample game');
    abortAll('test');
    trustedUserIds.clear();
    const TRUSTED_ROLE = '300000000000000088';
    trustedRoleIds.add(TRUSTED_ROLE);
    const member = { id: CAROL.id, user: CAROL, permissions: { has: () => false }, roles: { cache: new Map([[TRUSTED_ROLE, { id: TRUSTED_ROLE }]]) } };
    const other = newRoom();
    await say(client, other, '.جماعي', CAROL, { extra: { member } });
    assert.equal(getSession(other.id)?.gameId, 'grouptest');
    assert.equal(other.replies.length, 0);
});

test('in the open channel anyone may start a game (default ID, or OPEN_GAMES_CHANNEL_IDS); the sample game stays trusted-only', async () => {
    const { client } = setup();
    assert.ok(openGamesChannelIds.has(DEFAULT_OPEN_GAMES_CHANNEL_ID), 'the default when OPEN_GAMES_CHANNEL_IDS is empty');
    const open = fakeChannel(DEFAULT_OPEN_GAMES_CHANNEL_ID);
    await say(client, open, '.انفجار', BOB);
    await getSession(open.id)?.running;
    assert.match(textOf(open.sent.at(-1)), /حصل خطأ في اللعبة واتقفلت/u, 'a member started a game');
    // A channel in an open category is open too.
    const inCategory = fakeChannel('400000000000000901', { parentId: DEFAULT_OPEN_GAMES_CHANNEL_ID });
    await say(client, inCategory, '.boom', BOB);
    await getSession(inCategory.id)?.running;
    assert.match(textOf(inCategory.sent.at(-1)), /Something went wrong, the game was closed/u);
    // The sample game: one short notice per few seconds, even here.
    const before = open.sent.length;
    for (const content of ['.تجربة', '.تجربة', `${prefix}test`]) await say(client, open, content, BOB);
    assert.equal(open.replies.length, 1, 'the same notice is not repeated at once');
    assert.match(replyText(open.replies[0]), /للأدمن ومنظمين الفعاليات بس/u);
    const clock = fakeClock(Date.now() + GAMES.noticeGapMs + 1);
    await handleGamesMessage(typed(open, '.test', BOB), client, { clock });
    assert.match(replyText(open.replies[1]), /for admins and event hosts only/u);
    assert.deepEqual([open.sent.length, isBusy(open.id)], [before, false]);
    // OPEN_GAMES_CHANNEL_IDS replaces the default.
    const custom = newRoom();
    openGamesChannelIds.clear();
    openGamesChannelIds.add(custom.id);
    await say(client, open, '.انفجار', BOB);
    assert.equal(open.sent.length, before, 'the default channel is no longer open');
    await say(client, custom, '.انفجار', BOB);
    await getSession(custom.id)?.running;
    assert.match(textOf(custom.sent.at(-1)), /حصل خطأ في اللعبة واتقفلت/u);
});

test('a group game in the open channel follows the lobby minimum, and any member there can join', async () => {
    const { client } = setup();
    const open = fakeChannel(DEFAULT_OPEN_GAMES_CHANNEL_ID);
    const clock = fakeClock();
    await handleGamesMessage(typed(open, '.جماعي', BOB), client, { clock });
    await flush();
    const session = getSession(open.id);
    await clock.advance(5000);
    await session.running;
    assert.deepEqual(session.data.lobby, { cancelled: true, reason: 'players', players: [BOB.id] });
    await handleGamesMessage(typed(open, '.جماعي', BOB), client, { clock });
    await flush();
    const second = getSession(open.id);
    const [, , lobbyId] = open.sent.at(-1).payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, CAROL), ['join', lobbyId]);
    await clock.advance(5000);
    await second.running;
    assert.deepEqual(second.data.lobby, { players: [BOB.id, CAROL.id], reason: 'time' });
    assert.equal(second.data.reward.amount, 2000);
});

test('the general commands answer every member in a normal channel, trusted or not', async () => {
    const { client } = setup();
    const room = newRoom();
    for (const content of ['.توب', '.نقاط', '.اوامر', '.convert 10']) await say(client, room, content, BOB);
    assert.equal(room.sent.length, 4);
});

test('a lobby button works through interactionCreate in a channel outside GAMES_CHANNEL_IDS, for a member who is not trusted', async () => {
    const { client } = setup();
    await loadInteractions(client);
    const room = newRoom();
    gamesChannelIds.add('400000000000000999');
    const clock = fakeClock();
    await handleGamesMessage(typed(room, '.جماعي', ALICE, { admin: true }), client, { clock });
    await flush();
    const session = getSession(room.id);
    const lobbyMessage = room.sent.at(-1);
    const [, , lobbyId] = lobbyMessage.payload.components[0].toJSON().components[0].custom_id.split(':');
    const interaction = {
        ...press(`g:join:${lobbyId}`, BOB, lobbyMessage), guildId: GUILD, channelId: room.id, channel: { id: room.id, isTextBased: () => true },
        isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false, isRepliable: () => true,
    };
    interaction.reply = async (payload) => { interaction.replies.push(payload); };
    interaction.update = async (payload) => { interaction.updates.push(payload); };
    await interactionCreate.execute(interaction, client);
    await clock.advance(5000);
    await session.running;
    assert.deepEqual(session.data.lobby, { players: [ALICE.id, BOB.id], reason: 'time' });
});

test('a group game opens a lobby: too few players cancels it, enough players get a group win', async () => {
    const { client } = setup();
    const room = newRoom();
    const clock = fakeClock();
    assert.equal(await handleGamesMessage(typed(room, '.جماعي', ALICE, { admin: true }), client, { clock }), true);
    await flush();
    const session = getSession(room.id);
    const lobbyMessage = room.sent[0];
    assert.ok(lobbyMessage.payload.components[0].toJSON().components.every((button) => button.custom_id.startsWith('g:')));
    await clock.advance(5000);
    await session.running;
    assert.deepEqual(session.data.lobby, { cancelled: true, reason: 'players', players: [ALICE.id] });
    assert.match(lobbyMessage.edits.at(-1).embeds[0].description, /محتاجين 2 لاعبين/u);
    assert.equal(isBusy(room.id), false);

    await handleGamesMessage(typed(room, '.جماعي', ALICE, { admin: true }), client, { clock });
    await flush();
    const second = getSession(room.id);
    const [, , lobbyId] = room.sent.at(-1).payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, CAROL), ['join', lobbyId]);
    await clock.advance(5000);
    await second.running;
    assert.deepEqual(second.data.lobby, { players: [ALICE.id, CAROL.id], reason: 'time' });
    assert.deepEqual([second.data.reward.amount, second.data.reward.points], [2000, 5]);
    assert.equal((await getPoints(client, '100000000000000002', CAROL.id)).server.byGame.grouptest, 1);
});

test('a game that throws gets a short error line and frees the room; a stuck game is closed by the lifetime', async () => {
    const { client } = setup();
    const room = newRoom();
    await say(client, room, '.انفجار', ALICE, { admin: true });
    await getSession(room.id)?.running;
    await flush();
    assert.match(textOf(room.sent.at(-1)), /حصل خطأ في اللعبة واتقفلت/u);
    assert.equal(isBusy(room.id), false);
    await say(client, room, '.boom', ALICE, { admin: true });
    await flush();
    assert.match(textOf(room.sent.at(-1)), /Something went wrong, the game was closed/u);
    assert.equal(isBusy(room.id), false);
    const clock = fakeClock();
    await handleGamesMessage(typed(room, '.معلق', ALICE, { admin: true }), client, { clock });
    assert.equal(isBusy(room.id), true);
    await clock.advance(GAMES.maxLifetimeMs);
    assert.equal(isBusy(room.id), false);
    assert.match(textOf(room.sent.at(-1)), /اللعبة طولت أوي واتقفلت/u);
    gate.release();
});

test('the general commands: commands list, server and global tops, points and convert, even while a game runs', async () => {
    const { client } = setup();
    const room = newRoom();
    await say(client, room, '.اوامر');
    const list = room.sent.at(-1).payload.embeds[0];
    assert.equal(list.title, '🎮 ألعاب الشات');
    const all = textOf(room.sent.at(-1));
    assert.match(all, /`\.تجربة` `\.test` — تجربة للأدمن/u);
    assert.match(all, /`\.توب` `\.top`/u);
    assert.match(all, /`\.تحويل_نقاط` `\.convert`/u);
    assert.match(all, /👥 `\.جماعي` `\.grouptest` ・ 👥 2-4(?! ・ 🛡️)/u, 'group games are no longer admin-only');
    assert.match(all, /`\.تجربة` `\.test` — [^\n]* ・ 🛡️ للأدمن/u, 'the sample game still is');
    assert.match(list.footer.text, /إجابة صح: \*\*500\*\* CC/u);
    assert.ok(list.fields.every((field) => field.value.length <= 1024));
    await say(client, room, `${prefix}commands`);
    assert.equal(room.sent.at(-1).payload.embeds[0].title, '🎮 Chat games');

    await say(client, room, '.توب');
    assert.match(textOf(room.sent.at(-1)), /توب نقاط السيرفر[\s\S]*لسه محدش معاه نقاط/u);
    await addPoints(client, '100000000000000002', BOB.id, 12, { gameId: 'test' });
    await addPoints(client, '100000000000000001', CAROL.id, 20, { gameId: 'test' });
    // A game is running in the room: the general commands still answer.
    await say(client, room, '.تجربة', ALICE, { admin: true });
    await say(client, room, '!top', ALICE);
    assert.match(textOf(room.sent.at(-1)), new RegExp(`Server points top[\\s\\S]*🥇 <@${BOB.id}> — \\*\\*12\\*\\* points`, 'u'));
    await say(client, room, '.عالمي', BOB);
    assert.match(textOf(room.sent.at(-1)), new RegExp(`🥇 <@${CAROL.id}>[\\s\\S]*🥈 <@${BOB.id}>[\\s\\S]*ترتيبك: \\*\\*#2\\*\\*`, 'u'));
    await say(client, room, '.نقاط', BOB);
    assert.match(textOf(room.sent.at(-1)), /\*\*12\*\* في السيرفر ده \(1 فوز\)/u);
    await say(client, room, `.نقاط <@${CAROL.id}>`, BOB);
    assert.match(textOf(room.sent.at(-1)), /\*\*0\*\* في السيرفر ده .* \*\*20\*\* في كل السيرفرات/u);
    await say(client, room, `.نقاط <@${BOT.id}>`, BOB, { extra: { mentions: { users: new Map([[BOT.id, BOT]]) } } });
    assert.match(textOf(room.sent.at(-1)), /البوتات مالهاش نقاط/u);
    await say(client, room, '.تحويل_نقاط 4', BOB);
    assert.match(textOf(room.sent.at(-1)), /أقل تحويل \*\*5\*\* نقاط/u);
    await say(client, room, '.تحويل_نقاط ٢٠', BOB);
    assert.match(textOf(room.sent.at(-1)), /معاك \*\*12\*\* نقطة بس/u);
    await say(client, room, '.تحويل_نقاط ١٠', BOB);
    assert.match(textOf(room.sent.at(-1)), /حوّلت \*\*10\*\* نقطة لـ \*\*1,000\*\* 🌀 CC .* باقيلك \*\*2\*\* نقطة/u);
    await say(client, room, '.convert abc', BOB);
    assert.match(textOf(room.sent.at(-1)), /convert 10/u);
    await addPoints(client, '100000000000000002', BOB.id, 4);
    await say(client, room, '.convert all', BOB);
    assert.match(textOf(room.sent.at(-1)), /Converted \*\*6\*\* points/u);
    assert.equal((await client.db.get(getEconomyKey(economyScopeId, BOB.id))).cc, 1600);
    for (const message of room.sent) assert.deepEqual(message.payload.allowedMentions, { parse: [] });
});

test('every casino, bourse, CC and streak word still routes exactly as before', async () => {
    const { client, ran } = setup();
    const room = newRoom();
    const cases = [
        [`${prefix}مينز 100 3`, 'casino'], ['مينز 100 3', 'casino'], [`${prefix}صاروخ 100`, 'casino'], ['روليت 100 احمر', 'casino'],
        [`${prefix}توب cc`, 'cctop'], ['توب cc', 'cctop'], [`${prefix}top cc`, 'cctop'], ['توب كريدت', 'cctop'],
        ['اسعار', 'bourse'], [`${prefix}بيع كلو`, 'bourse'], [`${prefix}cc`, 'cc'], ['رصيد', 'cc'],
        [`تحويل <@${BOB.id}> 100`, 'give'], [`${prefix}transfer <@${BOB.id}> 100`, 'give'], ['العاب', 'games'], ['games', 'games'], ['daily', 'daily'],
    ];
    for (const [content, command] of cases) {
        ran.length = 0;
        await say(client, room, content, ALICE, { admin: true });
        assert.deepEqual(ran, [command], content);
    }
    // Words that did nothing before still do nothing (a dot is not the prefix of the other commands).
    ran.length = 0;
    for (const content of ['.توب cc', '.مينز 100 3', '.cc', '.توب ستريك', '!توب اخبار']) await say(client, room, content, ALICE, { admin: true });
    assert.deepEqual(ran, []);
    assert.equal(room.sent.length, 0);
    assert.equal(room.replies.length, 0);
});

test('a picture captioned with a game word is not a games command', async () => {
    const { client } = setup();
    const room = newRoom();
    const picture = new Map([['1', { name: 'a.png', contentType: 'image/png' }]]);
    await say(client, room, '.توب', ALICE, { extra: { attachments: picture } });
    await say(client, room, '.تجربة', ALICE, { admin: true, extra: { attachments: picture } });
    assert.equal(room.sent.length, 0);
    assert.equal(isBusy(room.id), false);
});

test('GAMES_CHANNEL_IDS no longer limits a trusted member; the general commands answer there and in the bot channels', async () => {
    const { client } = setup();
    const lobby = newRoom();
    const games = newRoom();
    gamesChannelIds.add(games.id);
    await say(client, lobby, '.تجربة', ALICE, { admin: true });
    assert.equal(isBusy(lobby.id), true, 'a trusted member starts a game outside GAMES_CHANNEL_IDS');
    abortAll('test');
    await say(client, lobby, '.توب', BOB);
    assert.equal(lobby.sent.at(-1).payload.embeds[0].title.includes('توب'), true);
    await say(client, games, '.توب', BOB);
    assert.equal(games.sent.length, 1);
    // A member who is not trusted cannot start a game in a GAMES_CHANNEL_IDS room that is not open.
    await say(client, games, '.انفجار', BOB);
    assert.deepEqual([games.sent.length, games.replies.length, isBusy(games.id)], [1, 0, false]);
});
