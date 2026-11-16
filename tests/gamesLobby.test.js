import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Collection } from 'discord.js';
import interactionCreate from '../src/events/interactionCreate.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { handleLobbyButton, openLobbies, openLobby } from '../src/games/engine/lobby.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import { ALICE, BOB, BOT, CAROL, GUILD, fakeChannel, fakeClient, fakeClock, flush, press } from './gamesFakes.js';

const DAVE = { id: '200000000000000014' };
let rooms = 0;

function setup({ lang = 'ar', game = { id: 'race', minPlayers: 2, maxPlayers: 3, names: { ar: ['سباق'], en: ['race'] } } } = {}) {
    const clock = fakeClock();
    const channel = fakeChannel(`4000000000000003${String(rooms++).padStart(2, '0')}`);
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    return { clock, channel, session, ctx: { client: fakeClient(), channel, session, lang, starter: ALICE, game } };
}
const ids = (payload) => payload.components[0].toJSON().components.map((button) => button.custom_id);
const description = (payload) => payload.embeds[0].description;
const click = async (lobbyMessage, action, user) => {
    const [, , lobbyId] = ids(lobbyMessage.payload)[0].split(':');
    const interaction = press(`g:${action}:${lobbyId}`, user, lobbyMessage);
    await handleLobbyButton(interaction, [action, lobbyId]);
    return interaction;
};

afterEach(() => abortAll('test'));

test('the host is in, members join until the lobby is full, and it starts with them', async () => {
    const room = setup();
    const lobby = openLobby(room.ctx, {});
    await flush();
    const message = room.channel.sent[0];
    assert.deepEqual(ids(message.payload).map((id) => id.split(':').slice(0, 2).join(':')), ['g:join', 'g:leave', 'g:start']);
    assert.match(description(message.payload), new RegExp(`صاحب اللعبة: <@${ALICE.id}>`, 'u'));
    assert.match(description(message.payload), /اللاعبين: \*\*1\/3\*\* \(أقل عدد 2\)/u);
    assert.equal(message.payload.components[0].toJSON().components[2].disabled, true, 'start waits for the minimum');
    const bob = await click(message, 'join', BOB);
    assert.match(description(bob.updates[0]), /\*\*2\/3\*\*/u);
    assert.equal(bob.updates[0].components[0].toJSON().components[2].disabled, false);
    const again = await click(message, 'join', BOB);
    assert.match(again.replies[0].content, /داخل أصلاً/u);
    const carol = await click(message, 'join', CAROL);
    const result = await lobby;
    assert.deepEqual(result, { players: [ALICE.id, BOB.id, CAROL.id], reason: 'full' });
    assert.deepEqual(carol.updates[0].components, [], 'the buttons go away');
    assert.match(description(carol.updates[0]), /اللعبة بدأت/u);
    assert.equal(openLobbies().length, 0);
    assert.equal(room.clock.pending(), 0, 'the countdown and the deadline are cleared');
    const late = await click(message, 'join', DAVE);
    assert.match(late.replies[0].content, /اللعبة دي خلصت/u);
});

test('only the host starts, once there are enough players; members may leave, the host may not', async () => {
    const room = setup();
    const lobby = openLobby(room.ctx, { max: 10 });
    await flush();
    const message = room.channel.sent[0];
    assert.match((await click(message, 'start', ALICE)).replies[0].content, /محتاجين \*\*1\*\* لاعب كمان/u);
    await click(message, 'join', BOB);
    assert.match((await click(message, 'start', BOB)).replies[0].content, /صاحب اللعبة بس/u);
    assert.match((await click(message, 'leave', ALICE)).replies[0].content, /صاحب اللعبة، مينفعش تخرج/u);
    assert.match((await click(message, 'leave', CAROL)).replies[0].content, /مش داخل/u);
    const left = await click(message, 'leave', BOB);
    assert.match(description(left.updates[0]), /\*\*1\/10\*\*/u);
    await click(message, 'join', CAROL);
    await click(message, 'join', BOT);
    const start = await click(message, 'start', ALICE);
    assert.deepEqual(await lobby, { players: [ALICE.id, CAROL.id], reason: 'start' });
    assert.deepEqual(start.updates[0].components, []);
});

test('the countdown is a live Discord timestamp (never edited); at the end it starts with enough players or is cancelled', async () => {
    const room = setup();
    const closesAt = Math.floor((room.clock.now() + 30_000) / 1000);
    const lobby = openLobby(room.ctx, { joinSeconds: 30, title: 'سباق العربيات' });
    await flush();
    const message = room.channel.sent[0];
    assert.equal(message.payload.embeds[0].title, 'سباق العربيات');
    assert.match(description(message.payload), new RegExp(`⏳ اللوبي بيقفل <t:${closesAt}:R>، دوس ✅ عشان تدخل\\.`, 'u'));
    // Nothing to edit while it waits: every member's app counts the timestamp down by itself.
    await room.clock.advance(29_000);
    assert.equal(message.edits.length, 0);
    await room.clock.advance(1_000);
    assert.deepEqual(await lobby, { cancelled: true, reason: 'players', players: [ALICE.id] });
    assert.equal(message.edits.length, 1, 'one edit: the close');
    assert.match(description(message.edits.at(-1)), /اتلغت: محتاجين 2 لاعبين/u);
    assert.doesNotMatch(description(message.edits.at(-1)), /<t:/u, 'a closed lobby has no countdown');
    assert.deepEqual(message.edits.at(-1).components, []);
    assert.equal(room.clock.pending(), 0);

    const full = setup({ lang: 'en' });
    const second = openLobby(full.ctx, { joinSeconds: 5 });
    await flush();
    await click(full.channel.sent[0], 'join', BOB);
    await full.clock.advance(5000);
    assert.deepEqual(await second, { players: [ALICE.id, BOB.id], reason: 'time' });
    assert.match(description(full.channel.sent[0].edits.at(-1)), /The game started/u);
});

test('the session ending cancels the lobby; a host who does not play is not a player', async () => {
    const room = setup();
    const lobby = openLobby(room.ctx, { hostPlays: false, min: 1 });
    await flush();
    const message = room.channel.sent[0];
    assert.match(description(message.payload), /\*\*0\/3\*\*/u);
    room.session.end('shutdown');
    assert.deepEqual(await lobby, { cancelled: true, reason: 'shutdown', players: [] });
    assert.deepEqual(message.edits.at(-1).components, []);
    assert.deepEqual(await openLobby(room.ctx, {}), { cancelled: true, reason: 'shutdown', players: [] });
    const mute = setup();
    mute.channel.failSend = true;
    assert.deepEqual(await openLobby(mute.ctx, {}), { cancelled: true, reason: 'send', players: [] });
});

test('a lobby button from before a restart answers that the game ended, through interactionCreate, and loses its buttons', async () => {
    const client = {};
    await loadInteractions(client);
    assert.ok(client.buttons.get('g'));
    const edits = [];
    const replies = [];
    const interaction = {
        guildId: GUILD, channelId: '400000000000000399', channel: { id: '400000000000000399' }, customId: 'g:join:0123456789ab',
        user: BOB, isChatInputCommand: () => false, isButton: () => true, isModalSubmit: () => false, isRepliable: () => true,
        message: { embeds: [{ title: '🏁 سباق' }], edit: async (payload) => { edits.push(payload); } },
        reply: async (payload) => { replies.push(payload); },
    };
    await interactionCreate.execute(interaction, client);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /اللعبة دي خلصت/u);
    assert.ok(replies[0].flags, 'private');
    assert.deepEqual(edits, [{ components: [] }]);
    // Garbage after the prefix is the same: no crash.
    await handleLobbyButton({ ...interaction, customId: 'g:', reply: async (payload) => replies.push(payload) }, []);
    assert.equal(replies.length, 2);
    assert.ok(client.buttons instanceof Collection);
});
