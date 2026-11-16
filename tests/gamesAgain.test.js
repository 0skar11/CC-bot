// The play-again button (src/games/engine/again.js, src/games/router.js handleAgainButton), the win as a reply to
// the winner (engine/rewards.js announceWin, engine/payload.js replyWin) and the one games menu (`العاب` / `games`,
// src/games/general.js gamesMenu, router handleMenuSelect), with the doubles of tests/gamesFakes.js.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { DEFAULT_OPEN_GAMES_CHANNEL_ID, openGamesChannelIds, trustedUserIds } from '../src/config/games.js';
import interactionCreate from '../src/events/interactionCreate.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { AGAIN_COOLDOWN_MS, AGAIN_LIFETIME_MS, againRow, armedAgain, forgetAgain } from '../src/games/engine/again.js';
import { replyWin } from '../src/games/engine/payload.js';
import { abortAll, getSession, isBusy, startSession } from '../src/games/engine/session.js';
import { gamesMenu, menuGames } from '../src/games/general.js';
import { loadGames, registerGame } from '../src/games/registry.js';
import { handleAgainButton, handleGamesMessage, handleMenuSelect } from '../src/games/router.js';
import { ALICE, BOB, CAROL, GUILD, fakeChannel, fakeClient, fakeClock, flush, press, typed } from './gamesFakes.js';

let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000007${String(rooms++).padStart(2, '0')}`);
const openRoom = () => fakeChannel(DEFAULT_OPEN_GAMES_CHANNEL_ID);
const member = (user, admin = false) => ({ id: user.id, user, permissions: { has: () => admin }, roles: { cache: new Map() } });
const buttonIds = (payload) => (payload?.components || []).flatMap((row) => row.toJSON().components.map((component) => component.custom_id));

// A one-round game: the first member to type `ok` wins.
await loadGames();
registerGame({
    id: 'again1', kind: 'single', names: { ar: ['تاني'], en: ['again1'] },
    async run(ctx) {
        const round = await ctx.askRound({ prompt: 'type ok', validate: (content) => content === 'ok', timeMs: 10_000, reveal: 'ok' });
        if (!round.winner) return;
        await ctx.announceWin(round, await ctx.rewardWin(round.winner.id, 'answer'), 'answer');
    },
});

/** A press on the button of `message` in `room`, by `user` (a GuildMember with Manage Server when `admin`). */
function pressOn(message, room, user, { admin = false, guildId = GUILD, customId = buttonIds(message.payload).at(-1) } = {}) {
    const interaction = press(customId, user, message);
    Object.assign(interaction, { guildId, channelId: room.id, channel: room, member: member(user, admin), locale: 'ar' });
    return interaction;
}

/** Starts `again1` in `room` and lets BOB win it: { win (the reply), clock }. */
async function playAndWin(room, client, clock, starter = ALICE, admin = true) {
    await handleGamesMessage(typed(room, '.تاني', starter, { admin }), client, { clock });
    await flush();
    const session = getSession(room.id);
    const answer = typed(room, 'ok', BOB);
    room.emit(answer);
    await session.running;
    return answer;
}

afterEach(() => {
    abortAll('test');
    forgetAgain();
    trustedUserIds.clear();
    openGamesChannelIds.clear();
    openGamesChannelIds.add(DEFAULT_OPEN_GAMES_CHANNEL_ID);
});

test('the win is a reply to the winning message that pings only the winner, with the play-again button', async () => {
    const client = fakeClient();
    const room = newRoom();
    const clock = fakeClock();
    await playAndWin(room, client, clock);
    const win = room.replies.at(-1);
    assert.match(win.content, new RegExp(`<@${BOB.id}> جاوب صح! \\+\\*\\*500\\*\\*`, 'u'));
    assert.deepEqual(win.allowedMentions, { users: [BOB.id] });
    assert.deepEqual(buttonIds(win), ['g:again:again1']);
    const button = win.components[0].toJSON().components[0];
    assert.deepEqual([button.label, button.emoji.name], ['العب تاني', '🔁']);
    assert.equal(room.sent.length, 1, 'only the question went out as a plain post');
});

test('the win falls back to a plain post in the room when the winning message was deleted', async () => {
    const room = newRoom();
    const deleted = typed(room, 'ok', BOB, { extra: { failReply: true } });
    const sent = await replyWin(deleted, room, { content: 'win' }, BOB.id);
    assert.equal(room.sent.at(-1), sent);
    assert.deepEqual(sent.payload, { content: 'win', allowedMentions: { users: [BOB.id] } });
    assert.equal(room.replies.length, 0);
    // Through a game, too: the winner's message is gone, the win (and its button) is posted in the room.
    const client = fakeClient();
    const other = newRoom();
    const clock = fakeClock();
    await handleGamesMessage(typed(other, '.تاني', ALICE, { admin: true }), client, { clock });
    await flush();
    const session = getSession(other.id);
    other.emit(typed(other, 'ok', BOB, { extra: { failReply: true } }));
    await session.running;
    assert.match(other.sent.at(-1).payload.content, /جاوب صح/u);
    assert.deepEqual(buttonIds(other.sent.at(-1).payload), ['g:again:again1']);
    assert.ok(armedAgain(other.sent.at(-1).id), 'the posted win carries a live button');
});

test('the time-up reveal stays a normal post and carries the button; the sample game replies to its winner too', async () => {
    const client = fakeClient();
    const room = newRoom();
    const clock = fakeClock();
    await handleGamesMessage(typed(room, '.تاني', ALICE, { admin: true }), client, { clock });
    await flush();
    const session = getSession(room.id);
    await clock.advance(10_000);
    await session.running;
    const reveal = room.sent.at(-1);
    assert.match(reveal.payload.content, /الوقت خلص ومحدش جاوب! الإجابة كانت: \*\*ok\*\*/u);
    assert.deepEqual(reveal.payload.allowedMentions, { parse: [] });
    const [button] = reveal.payload.components[0].toJSON().components;
    assert.deepEqual([button.custom_id, button.label], ['g:again:again1', 'العب تاني']);
    assert.equal(againRow('again1', 'en').toJSON().components[0].label, 'Play again', 'an English round says it in English');
    assert.equal(room.replies.length, 0);

    await handleGamesMessage(typed(room, '.تجربة', ALICE, { admin: true }), client, { clock });
    await flush();
    const word = /\*\*(.+?)\*\*/u.exec(room.sent.at(-1).payload.embeds[0].description)[1];
    const sample = getSession(room.id);
    room.emit(typed(room, word, CAROL));
    await sample.running;
    assert.deepEqual(room.replies.at(-1).allowedMentions, { users: [CAROL.id] });
    assert.deepEqual(buttonIds(room.replies.at(-1)), ['g:again:test']);
});

test('play again starts a new round of the same game in the same room, once; the button goes away', async () => {
    const client = fakeClient();
    const room = newRoom();
    const clock = fakeClock();
    await playAndWin(room, client, clock);
    // The button lives on the win reply.
    const message = room.replyMessages.at(-1);
    assert.ok(armedAgain(message.id));
    const interaction = pressOn(message, room, CAROL, { admin: true });
    await handleAgainButton(interaction, client, ['again1'], { clock });
    const session = getSession(room.id);
    assert.equal(session?.gameId, 'again1', 'a new round of the same game');
    assert.equal(session.starterId, CAROL.id);
    assert.deepEqual(interaction.updates, [{ components: [] }], 'the button is removed with the press');
    assert.equal(interaction.replies.length, 0);
    await flush();
    assert.equal(room.sent.at(-1).payload.content, 'type ok', 'the new question is posted');
    // The same button again: stale, answered privately.
    const again = pressOn(message, room, BOB, { admin: true });
    await handleAgainButton(again, client, ['again1'], { clock });
    assert.match(again.replies[0].content, /الزرار ده خلص/u);
    assert.equal(again.replies[0].flags, 64);
    assert.equal(getSession(room.id), session, 'no second round');
});

test('who may press: trusted anywhere, anyone in an open channel, admin-only games stay admin-only', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    const message = await winAndGetMessage(room, client, clock);
    // A member who is not trusted, in a normal channel: a short private reply, the button stays.
    const denied = pressOn(message, room, CAROL);
    await handleAgainButton(denied, client, ['again1'], { clock });
    assert.match(denied.replies[0].content, /مينفعش تبدأ ألعاب في الروم ده/u);
    assert.equal(denied.replies[0].flags, 64);
    assert.equal(isBusy(room.id), false);
    assert.ok(armedAgain(message.id), 'still live');
    // TRUSTED_USER_IDS: the same press works.
    trustedUserIds.add(CAROL.id);
    const trusted = pressOn(message, room, CAROL);
    await handleAgainButton(trusted, client, ['again1'], { clock });
    assert.equal(getSession(room.id)?.gameId, 'again1');
    abortAll('test');
    trustedUserIds.clear();

    // The open channel: anyone; but the sample game needs a trusted member even there.
    const open = openRoom();
    const openWin = await winAndGetMessage(open, client, clock, BOB, false);
    await clock.advance(AGAIN_COOLDOWN_MS);
    const anyone = pressOn(openWin, open, CAROL);
    await handleAgainButton(anyone, client, ['again1'], { clock });
    assert.equal(getSession(open.id)?.starterId, CAROL.id);
    abortAll('test');
    await clock.advance(AGAIN_COOLDOWN_MS);
    const sample = pressOn(openWin, open, BOB);
    // A forged id for another game on this button is stale, and the sample game is admin-only anyway.
    await handleAgainButton(sample, client, ['test'], { clock });
    assert.match(sample.replies[0].content, /الزرار ده خلص/u);
});

/** Plays `again1` in `room` to a win and returns the live message carrying the button. */
async function winAndGetMessage(room, client, clock, starter = ALICE, admin = true) {
    const before = room.replies.length;
    await handleGamesMessage(typed(room, '.تاني', starter, { admin }), client, { clock });
    await flush();
    const session = getSession(room.id);
    const answer = typed(room, 'ok', BOB, { extra: { failReply: true } });
    room.emit(answer);
    await session.running;
    assert.equal(room.replies.length, before);
    return room.sent.at(-1);
}

test('one round at a time per room, a short cooldown, and the button expires after a minute', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    const first = await winAndGetMessage(room, client, clock);
    // Busy: a game is already running.
    const held = startSession({ channelId: room.id, guildId: GUILD, gameId: 'other', clock, maxLifetimeMs: 0 });
    const busy = pressOn(first, room, ALICE, { admin: true });
    await handleAgainButton(busy, client, ['again1'], { clock });
    assert.match(busy.replies[0].content, /في لعبة شغالة/u);
    held.end('test');
    // Started from the button, then ended at once: a second button of the room waits AGAIN_COOLDOWN_MS.
    const second = await winAndGetMessage(room, client, clock);
    await handleAgainButton(pressOn(first, room, ALICE, { admin: true }), client, ['again1'], { clock });
    assert.equal(getSession(room.id)?.gameId, 'again1');
    abortAll('test');
    const tooSoon = pressOn(second, room, ALICE, { admin: true });
    await handleAgainButton(tooSoon, client, ['again1'], { clock });
    assert.match(tooSoon.replies[0].content, /استنى \*\*3\*\* ثانية/u);
    assert.equal(isBusy(room.id), false);
    await clock.advance(AGAIN_COOLDOWN_MS);
    const later = pressOn(second, room, ALICE, { admin: true });
    await handleAgainButton(later, client, ['again1'], { clock });
    assert.equal(getSession(room.id)?.gameId, 'again1');
    abortAll('test');
    // After AGAIN_LIFETIME_MS the button is removed from its message and a press is stale.
    const third = await winAndGetMessage(room, client, clock);
    assert.ok(armedAgain(third.id));
    await clock.advance(AGAIN_LIFETIME_MS);
    assert.equal(armedAgain(third.id), null);
    assert.deepEqual(third.edits.at(-1), { components: [] });
    const expired = pressOn(third, room, ALICE, { admin: true });
    await handleAgainButton(expired, client, ['again1'], { clock });
    assert.match(expired.replies[0].content, /الزرار ده خلص/u);
    assert.equal(isBusy(room.id), false);
});

test('stale ids, unknown games and foreign rooms get a short private reply', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const room = newRoom();
    // A button from before a restart: stale, and its message loses the button.
    const old = { id: '599999999999999999', payload: {}, edits: [], async edit(next) { this.edits.push(next); return this; } };
    const stale = pressOn(old, room, ALICE, { admin: true, customId: 'g:again:again1' });
    await handleAgainButton(stale, client, ['again1'], { clock });
    assert.match(stale.replies[0].content, /الزرار ده خلص/u);
    assert.deepEqual(old.edits, [{ components: [] }]);
    const unknown = pressOn(old, room, ALICE, { admin: true, customId: 'g:again:nope' });
    await handleAgainButton(unknown, client, ['nope'], { clock });
    assert.match(unknown.replies[0].content, /اللعبة دي مش موجودة/u);
    const general = pressOn(old, room, ALICE, { admin: true, customId: 'g:again:top' });
    await handleAgainButton(general, client, ['top'], { clock });
    assert.match(general.replies[0].content, /اللعبة دي مش موجودة/u);
    // A live button pressed from another room, or in a guild that is not allowed.
    const message = await winAndGetMessage(room, client, clock);
    const elsewhere = newRoom();
    const foreign = pressOn(message, elsewhere, ALICE, { admin: true });
    await handleAgainButton(foreign, client, ['again1'], { clock });
    assert.match(foreign.replies[0].content, /الزرار ده مش للروم ده/u);
    const outside = pressOn(message, room, ALICE, { admin: true, guildId: '900000000000000009' });
    await handleAgainButton(outside, client, ['again1'], { clock });
    assert.match(outside.replies[0].content, /الزرار ده مش للروم ده/u);
    assert.equal(isBusy(room.id), false);
});

test('interactionCreate routes `g:again:<gameId>` and the menu select to the games, in any text channel', async () => {
    const client = fakeClient();
    await loadInteractions(client);
    const room = newRoom();
    const message = await winAndGetMessage(room, client, fakeClock());
    const button = Object.assign(pressOn(message, room, ALICE, { admin: true }), {
        isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, isRepliable: () => true,
    });
    room.isTextBased = () => true;
    await interactionCreate.execute(button, client);
    assert.equal(getSession(room.id)?.gameId, 'again1');
    assert.deepEqual(button.updates, [{ components: [] }]);
    abortAll('test');
    forgetAgain();
    const other = newRoom();
    other.isTextBased = () => true;
    const select = {
        customId: 'g:menu:ar:0', values: ['again1'], user: ALICE, member: member(ALICE, true), guildId: GUILD, channelId: other.id, channel: other, replies: [], deferred: 0,
        isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false, isRepliable: () => true,
        async reply(payload) { this.replies.push(payload); }, async deferUpdate() { this.deferred += 1; },
    };
    await interactionCreate.execute(select, client);
    assert.equal(getSession(other.id)?.gameId, 'again1');
    assert.deepEqual([select.deferred, select.replies.length], [1, 0]);
});

test('`العاب` / `games` / `menu` with the prefix or a dot: one menu of the chat and casino games', async () => {
    const client = fakeClient();
    const room = newRoom();
    for (const content of ['.العاب', '.ألعاب', '.الألعاب', '!العاب']) {
        assert.equal(await handleGamesMessage(typed(room, content, BOB), client), true, content);
        const { payload } = room.sent.at(-1);
        assert.deepEqual(payload.embeds.map((embed) => embed.title), ['🎮 كل الألعاب', '🎮 ألعاب CC bot'], content);
    }
    for (const content of ['.games', '.menu', '!GAMES']) {
        await handleGamesMessage(typed(room, content, BOB), client);
        assert.deepEqual(room.sent.at(-1).payload.embeds.map((embed) => embed.title), ['🎮 All games', '🎮 CC bot games'], content);
    }
    // Extra words are not the menu (they stay chat or go to the rest of the bot).
    assert.equal(await handleGamesMessage(typed(room, '.العاب حلوة', BOB), client), false);

    const menu = gamesMenu('ar');
    const [chat, casino] = menu.embeds;
    const all = [chat.description, ...chat.fields.flatMap((field) => [field.name, field.value])].join('\n');
    assert.match(chat.description, /كل إجابة صح: \*\*500\*\* CC ・ الفوز في لعبة جماعية: \*\*2,000\*\* CC ・ أقصى \*\*20,000\*\* CC في اليوم من الألعاب الفردية/u);
    assert.match(all, /🎯 فردية — 500 CC لكل إجابة صح/u);
    assert.match(all, /`\.سؤال` `\.quiz`/u, 'each game with its Arabic and English words');
    assert.match(all, /`\.تجربة` `\.test` — [^\n]* ・ 🛡️ للأدمن/u);
    assert.match(all, /📋 أوامر[\s\S]*`\.توب`/u, 'the general commands too');
    assert.ok(casino.fields.some((field) => field.value.includes('`مينز 100')), 'the casino games');
    const size = menu.embeds.reduce((sum, embed) => sum + [embed.title, embed.description, embed.footer?.text, ...(embed.fields || []).flatMap((field) => [field.name, field.value])].join('').length, 0);
    assert.ok(size <= 6000, `${size} characters`);
    assert.ok(chat.fields.length <= 25 && chat.fields.every((field) => field.value.length <= 1024));
    // The select: every game a member may start (not the general commands, not the admin-only sample game).
    const options = menu.components.flatMap((row) => row.toJSON().components).flatMap((select) => select.options);
    assert.ok(menu.components.every((row) => row.toJSON().components[0].custom_id.startsWith('g:menu:ar:')));
    assert.deepEqual(options.map((option) => option.value), menuGames().map((game) => game.id));
    assert.ok(options.some((option) => option.value === 'quiz' && option.label === 'سؤال · quiz'));
    assert.ok(!options.some((option) => ['test', 'top', 'menu'].includes(option.value)));
    assert.ok(options.every((option) => option.label.length <= 100 && (option.description ?? '').length <= 100));
});

test('the menu answers in the open channel and for trusted members; starting from it follows the same rule', async () => {
    const client = fakeClient();
    const clock = fakeClock();
    const open = openRoom();
    await handleGamesMessage(typed(open, '.العاب', CAROL), client);
    assert.equal(open.sent.at(-1).payload.embeds.length, 2);
    const pick = (room, user, gameId, { admin = false, lang = 'ar' } = {}) => {
        const interaction = { customId: `g:menu:${lang}:0`, values: [gameId], user, member: member(user, admin), guildId: GUILD, channelId: room.id, channel: room, replies: [], deferred: 0,
            async reply(payload) { this.replies.push(payload); }, async deferUpdate() { this.deferred += 1; } };
        return handleMenuSelect(interaction, client, [lang], { clock }).then(() => interaction);
    };
    // Anyone in the open channel.
    const started = await pick(open, CAROL, 'again1');
    assert.equal(getSession(open.id)?.starterId, CAROL.id);
    assert.equal(started.deferred, 1);
    // Busy room: private.
    const busy = await pick(open, BOB, 'quiz');
    assert.match(busy.replies[0].content, /في لعبة شغالة/u);
    abortAll('test');
    // A normal channel: not for a member who is not trusted; a trusted member starts it.
    const room = newRoom();
    const denied = await pick(room, CAROL, 'again1');
    assert.match(denied.replies[0].content, /مينفعش تبدأ ألعاب في الروم ده/u);
    assert.equal(isBusy(room.id), false);
    const admin = await pick(room, ALICE, 'again1', { admin: true, lang: 'en' });
    assert.equal(admin.replies.length, 0);
    assert.equal(getSession(room.id)?.gameId, 'again1');
    await flush();
    assert.equal(room.sent.at(-1).payload.content, 'type ok');
    abortAll('test');
    // The admin-only sample game, and an unknown value.
    await clock.advance(AGAIN_COOLDOWN_MS);
    const sample = await pick(open, CAROL, 'test');
    assert.match(sample.replies[0].content, /للأدمن ومنظمين الفعاليات بس/u);
    const unknown = await pick(open, CAROL, 'nope');
    assert.match(unknown.replies[0].content, /اللعبة دي مش موجودة/u);
});
