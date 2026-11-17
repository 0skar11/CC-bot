import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { CC } from '../src/config/cc.js';
import { DEFAULT_OPEN_GAMES_CHANNEL_ID, GAMES } from '../src/config/games.js';
import { economyScopeId } from '../src/config/runtime.js';
import { forgetAgain } from '../src/games/engine/again.js';
import { forgetBoards, openBoards } from '../src/games/engine/duel.js';
import { handleLobbyButton } from '../src/games/engine/lobby.js';
import { abortAll, isBusy } from '../src/games/engine/session.js';
import { NUMBERS, connectsFour, dropDisc, emptyGrid, gridText, openColumns } from '../src/games/games/connect.js';
import { rpsRound } from '../src/games/games/rps.js';
import { xoWinner } from '../src/games/games/xo.js';
import { HELP_CATEGORIES, helpMenuPayload } from '../src/games/helpMenu.js';
import { findGame, listGames, loadGames } from '../src/games/registry.js';
import { handleGamesMessage } from '../src/games/router.js';
import gamesButtons from '../src/interactions/buttons/store/games.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import { ALICE, BOB, CAROL, fakeChannel, fakeClient, fakeClock, flush, press, typed } from './gamesFakes.js';

let rooms = 0;
const newRoom = () => fakeChannel(`4000000000000008${String(rooms++).padStart(2, '0')}`);
const balance = async (client, userId) => (await client.db.get(getEconomyKey(economyScopeId, userId), {})).cc ?? 0;
const json = (payload) => (payload.components || []).map((row) => (typeof row.toJSON === 'function' ? row.toJSON() : row));
const customIds = (payload) => json(payload).flatMap((row) => row.components.map((part) => part.custom_id)).filter(Boolean);
const textOf = (payload) => [payload?.content, ...(payload?.embeds || []).flatMap((embed) => [embed.title, embed.description])].filter(Boolean).join('\n');

afterEach(() => {
    abortAll('test');
    forgetBoards();
    forgetAgain();
});

/** Starts `word` in a fresh room (ALICE, trusted), BOB joins; returns the room, the client, the clock and the board message. */
async function start(word, { joiner = BOB } = {}) {
    await loadGames();
    const clock = fakeClock();
    const channel = newRoom();
    const client = fakeClient();
    assert.equal(await handleGamesMessage(typed(channel, `.${word}`, ALICE, { admin: true }), client, { clock }), true);
    await flush();
    const lobby = channel.sent[0];
    const [joinId] = customIds(lobby.payload);
    if (joiner) {
        const [, action, lobbyId] = joinId.split(':');
        await handleLobbyButton(press(joinId, joiner, lobby), [action, lobbyId]);
        await flush();
    }
    return { clock, channel, client, lobby, board: channel.sent[1] ?? null };
}

/** Presses `move` on the board as `user` through the real `g:` button handler; returns the interaction. */
async function move(room, user, moveId, { select = false } = {}) {
    const ids = customIds(room.board.payload);
    const boardId = ids[0].split(':')[2];
    const interaction = press(select ? `g:duel:${boardId}:col` : `g:duel:${boardId}:${moveId}`, user, room.board);
    const [, ...args] = interaction.customId.split(':');
    if (select) {
        interaction.values = [String(moveId)];
        await gamesButtons.executeSelect(interaction, room.client, args);
    } else {
        await gamesButtons.execute(interaction, room.client, args);
    }
    await flush();
    return interaction;
}

const lastBoard = (room) => room.board.edits.at(-1) ?? null;
const winLine = (room) => room.channel.sent.slice(2).map((message) => message.payload).find((payload) => /كسب اللعبة|won the game/u.test(payload.content || ''));

// ─── Pure rules ───

test('xo: three in a row wins, any line', () => {
    const empty = Array(9).fill(null);
    assert.equal(xoWinner(empty), null);
    for (const line of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) {
        const cells = [...empty];
        for (const cell of line) cells[cell] = 1;
        assert.equal(xoWinner(cells), 1, String(line));
    }
    assert.equal(xoWinner([0, 1, 0, 0, 1, 1, 1, 0, 0]), null, 'a full board without a line');
});

test('connect four: discs fall, full columns refuse, four across, down and both diagonals win', () => {
    const grid = emptyGrid();
    assert.equal(dropDisc(grid, 0, 0), 5);
    assert.equal(dropDisc(grid, 0, 1), 4);
    assert.equal(dropDisc(grid, 7, 0), -1);
    for (let i = 0; i < 4; i += 1) dropDisc(grid, 0, i % 2);
    assert.equal(dropDisc(grid, 0, 0), -1, 'the column is full');
    assert.deepEqual(openColumns(grid), [1, 2, 3, 4, 5, 6]);
    const across = emptyGrid();
    for (const col of [1, 2, 3]) dropDisc(across, col, 0);
    assert.equal(connectsFour(across, 5, 3), false);
    dropDisc(across, 4, 0);
    assert.equal(connectsFour(across, 5, 4), true);
    const down = emptyGrid();
    for (let i = 0; i < 4; i += 1) dropDisc(down, 2, 1);
    assert.equal(connectsFour(down, 2, 2), true);
    const rising = emptyGrid();
    // A diagonal going up to the right: (5,0) (4,1) (3,2) (2,3).
    [[], [1], [1, 1], [1, 1, 1]].forEach((fill, col) => fill.forEach((p) => dropDisc(rising, col, p)));
    for (let col = 0; col < 4; col += 1) dropDisc(rising, col, 0);
    assert.equal(rising[2][3], 0);
    assert.equal(connectsFour(rising, 2, 3), true);
    const falling = emptyGrid();
    [[1, 1, 1], [1, 1], [1], []].forEach((fill, col) => fill.forEach((p) => dropDisc(falling, col, p)));
    for (let col = 0; col < 4; col += 1) dropDisc(falling, col, 0);
    assert.equal(connectsFour(falling, 5, 3), true);
    assert.equal(NUMBERS[0], `1${String.fromCharCode(0xfe0f, 0x20e3)}`);
    assert.equal(gridText(emptyGrid()), [NUMBERS.join(''), ...Array(6).fill('⚪'.repeat(7))].join('\n'));
});

test('rock paper scissors: what beats what', () => {
    assert.equal(rpsRound('rock', 'scissors'), 0);
    assert.equal(rpsRound('scissors', 'rock'), 1);
    assert.equal(rpsRound('paper', 'rock'), 0);
    assert.equal(rpsRound('scissors', 'paper'), 0);
    assert.equal(rpsRound('paper', 'paper'), null);
});

// ─── Registry and help menu ───

test('the three dual games are registered with their words, no clash, and listed in the help menu', async () => {
    await loadGames();
    for (const [word, id] of [['xo', 'xo'], ['اكس', 'xo'], ['tictactoe', 'xo'], ['حجره', 'rps'], ['حجرة', 'rps'], ['rps', 'rps'], ['توصيل', 'connect'], ['connect', 'connect'], ['connectfour', 'connect']]) {
        assert.equal(findGame(word)?.id, id, word);
        assert.equal(findGame(word).kind, 'dual');
        assert.deepEqual([findGame(word).minPlayers, findGame(word).maxPlayers], [2, 2]);
    }
    assert.ok(!findGame('شطرنج'), 'chess is not built');
    assert.deepEqual(listGames({ kind: 'dual' }).map((game) => game.id).sort(), ['connect', 'rps', 'xo']);
    assert.ok(HELP_CATEGORIES.includes('dual'));
    for (const lang of ['ar', 'en']) {
        const payload = helpMenuPayload({ token: 't', lang, category: 'dual', user: ALICE });
        const embed = payload.embeds[0];
        const all = [embed.title, embed.description, ...(embed.fields || []).flatMap((field) => [field.name, field.value])].join('\n');
        for (const word of ['.xo', '.اكس', '.حجره', '.rps', '.توصيل', '.connect']) assert.ok(all.includes(`\`${word}\``), `${lang}: ${word}`);
        assert.match(all, /\*\*500\*\* CC[\s\S]*\*\*20,000\*\* CC/u, 'a dual win pays a right answer, within the daily cap');
        assert.ok(!/`xo` ・|`حجره` ・|`توصيل` ・/u.test(all), 'no longer "coming soon"');
        assert.ok(all.includes('`شطرنج`'), 'chess stays planned');
        const options = json(payload).flatMap((row) => row.components).filter((part) => part.custom_id === 'g:help:t:play:0').flatMap((select) => select.options);
        assert.deepEqual(options.map((option) => option.value).sort(), ['connect', 'rps', 'xo']);
    }
});

// ─── xo: state machine, only the players, turns, win, reward once ───

test('xo: challenger is ❌ and starts, only the players press, only on their turn; a line wins 500 once with play-again', async () => {
    const room = await start('اكس');
    assert.ok(room.board, 'the board is posted once the opponent joins');
    assert.equal(customIds(room.board.payload).length, 9);
    assert.match(room.board.payload.content, new RegExp(`<@${ALICE.id}>[\\s\\S]*<t:\\d+:R>`, 'u'), 'turn line and live countdown');
    assert.match((await move(room, CAROL, 0)).replies[0].content, /اللاعبين الاتنين بس/u);
    assert.match((await move(room, BOB, 0)).replies[0].content, /مش دورك/u);
    const first = await move(room, ALICE, 0);
    assert.equal(json(first.updates[0])[0].components[0].emoji.name, '❌');
    assert.equal(json(first.updates[0])[0].components[0].disabled, true);
    assert.match(first.updates[0].content, new RegExp(`<@${BOB.id}>`, 'u'));
    assert.match((await move(room, BOB, 0)).replies[0].content, /متاخد/u);
    await move(room, BOB, 3);
    await move(room, ALICE, 1);
    await move(room, BOB, 4);
    const winning = await move(room, ALICE, 2);
    assert.ok(json(winning.updates[0]).flatMap((row) => row.components).every((button) => button.disabled), 'the final board is locked');
    assert.match(winning.updates[0].content, new RegExp(`🏆 <@${ALICE.id}>`, 'u'));
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer);
    assert.equal(await balance(room.client, BOB.id), 0);
    const win = winLine(room);
    assert.ok(win, 'the win is announced');
    assert.deepEqual(win.allowedMentions, { users: [ALICE.id] });
    assert.ok(customIds(win).includes('g:again:xo'), 'with play-again');
    assert.match(win.content, /كسب اللعبة! \+\*\*500\*\* 🌀 CC/u);
    assert.equal((await room.client.db.get(getEconomyKey(economyScopeId, ALICE.id))).ccGamesBot.earned, CC.gamesBot.answer, 'counted in the daily cap');
    // Late presses do nothing and pay nothing.
    assert.match((await move(room, BOB, 8)).replies[0].content, /خلصت/u);
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer, 'paid once');
    assert.equal((await room.client.db.get(getEconomyKey(economyScopeId, ALICE.id))).ccGamesBot.earned, CC.gamesBot.answer, 'counted once');
    assert.equal(isBusy(room.channel.id), false, 'the room is free');
    assert.equal(openBoards().length, 0);
});

test('a dual win at the daily cap pays no CC: the winner still gets the win line with the limit notice and play-again', async () => {
    const room = await start('اكس');
    const today = new Date().toISOString().slice(0, 10);
    await room.client.db.set(getEconomyKey(economyScopeId, ALICE.id), { cc: 0, ccGamesBot: { day: today, earned: CC.gamesBot.dailyCap - 100 } });
    for (const [user, cell] of [[ALICE, 0], [BOB, 3], [ALICE, 1], [BOB, 4], [ALICE, 2]]) await move(room, user, cell);
    assert.equal(await balance(room.client, ALICE.id), 100, 'trimmed to what is left of the cap');
    const near = winLine(room);
    assert.match(near.content, /كسب اللعبة! \+\*\*100\*\* 🌀 CC/u);

    const capped = await start('اكس');
    await capped.client.db.set(getEconomyKey(economyScopeId, ALICE.id), { cc: 0, ccGamesBot: { day: today, earned: CC.gamesBot.dailyCap } });
    for (const [user, cell] of [[ALICE, 0], [BOB, 3], [ALICE, 1], [BOB, 4], [ALICE, 2]]) await move(capped, user, cell);
    assert.equal(await balance(capped.client, ALICE.id), 0, 'no CC past the cap');
    const line = winLine(capped);
    assert.ok(line, 'the win is still announced');
    assert.match(line.content, new RegExp(`<@${ALICE.id}> كسب اللعبة![\\s\\S]*وصلت لحد الـ CC من الألعاب النهارده`, 'u'));
    assert.ok(customIds(line).includes('g:again:xo'));
    assert.equal((await capped.client.db.get(getEconomyKey(economyScopeId, ALICE.id))).ccGamesBot.earned, CC.gamesBot.dailyCap);
});

test('xo: a full board without a line is a draw: no reward, a draw line with play-again', async () => {
    const room = await start('اكس');
    // ❌ 0 2 3 7 8 ・ ⭕ 1 4 5 6: X O X / X O O / O X X.
    for (const [user, cell] of [[ALICE, 0], [BOB, 1], [ALICE, 2], [BOB, 4], [ALICE, 3], [BOB, 5], [ALICE, 7], [BOB, 6], [ALICE, 8]]) await move(room, user, cell);
    const draw = room.channel.sent.at(-1).payload;
    assert.match(draw.content, /تعادل/u);
    assert.ok(customIds(draw).includes('g:again:xo'));
    assert.equal(await balance(room.client, ALICE.id), 0);
    assert.equal(await balance(room.client, BOB.id), 0);
});

test('xo: the player whose time runs out forfeits, the other wins once', async () => {
    const room = await start('اكس');
    await move(room, ALICE, 4);
    await room.clock.advance(GAMES.duel.moveSeconds * 1000 + 10);
    const last = lastBoard(room);
    assert.match(last.content, new RegExp(`<@${BOB.id}> وقته خلص`, 'u'));
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer);
    assert.equal(await balance(room.client, BOB.id), 0);
    await room.clock.advance(GAMES.duel.moveSeconds * 1000 * 3);
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer, 'paid once');
    assert.equal(isBusy(room.channel.id), false);
});

test('a dual game nobody joins is cancelled: no board, no reward, the room is freed', async () => {
    const room = await start('اكس', { joiner: null });
    await room.clock.advance(GAMES.duel.joinSeconds * 1000 + 10);
    assert.equal(room.channel.sent.length, 1, 'only the lobby');
    assert.match(textOf(room.lobby.edits.at(-1)), /اتلغت/u);
    assert.equal(isBusy(room.channel.id), false);
});

test('a member who is not trusted starts a dual game only in the open channel', async () => {
    await loadGames();
    const clock = fakeClock();
    const closed = newRoom();
    assert.equal(await handleGamesMessage(typed(closed, '.xo', BOB), fakeClient(), { clock }), true);
    assert.equal(closed.sent.length, 0, 'no reply at all');
    const open = fakeChannel(DEFAULT_OPEN_GAMES_CHANNEL_ID);
    assert.equal(await handleGamesMessage(typed(open, '.rps', BOB), fakeClient(), { clock }), true);
    await flush();
    assert.equal(open.sent.length, 1, 'the challenge lobby');
    assert.match(textOf(open.sent[0].payload), /Rock paper scissors|حجره/u);
    // One session per room.
    await handleGamesMessage(typed(open, '.xo', CAROL), fakeClient(), { clock });
    assert.match(open.replies[0].content, /already running/u);
});

// ─── connect four ───

test('connect four: buttons and the select drop discs, a full column is refused, four in a row wins 500 once', async () => {
    const room = await start('توصيل');
    assert.equal(customIds(room.board.payload).filter((id) => /:[0-6]$/u.test(id)).length, 7);
    assert.ok(customIds(room.board.payload).some((id) => id.endsWith(':col')), 'the column select');
    assert.match(room.board.payload.embeds[0].description, /⚪{7}/u);
    assert.match((await move(room, BOB, 0)).replies[0].content, /مش دورك/u);
    assert.match((await move(room, CAROL, 0)).replies[0].content, /اللاعبين الاتنين بس/u);
    const first = await move(room, ALICE, 0, { select: true });
    assert.match(first.updates[0].embeds[0].description, /🔴⚪{6}$/u);
    // Fill column 6 to the top (3 each), then try it again.
    for (let i = 0; i < 3; i += 1) {
        await move(room, BOB, 6);
        await move(room, ALICE, 6);
    }
    // ALICE has 0, and three in 6; BOB three in 6. Now BOB's turn: column 6 is full.
    assert.match((await move(room, BOB, 6)).replies[0].content, /مليان/u);
    await move(room, BOB, 5);
    await move(room, ALICE, 1);
    await move(room, BOB, 5);
    await move(room, ALICE, 2);
    await move(room, BOB, 4);
    const winning = await move(room, ALICE, 3);
    assert.match(winning.updates[0].content, new RegExp(`🏆 <@${ALICE.id}>`, 'u'));
    assert.ok(!customIds(winning.updates[0]).some((id) => id.endsWith(':col')), 'the select goes away');
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer);
    assert.ok(customIds(winLine(room)).includes('g:again:connect'));
    await move(room, BOB, 4);
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer, 'paid once');
});

// ─── rock paper scissors ───

test('rps: picks are hidden (private replies), the round shows once both picked, best of 3 wins 500 once', async () => {
    const room = await start('حجره');
    assert.deepEqual(customIds(room.board.payload).map((id) => id.split(':')[3]), ['rock', 'paper', 'scissors']);
    assert.match((await move(room, CAROL, 'rock')).replies[0].content, /اللاعبين الاتنين بس/u);
    const pick = await move(room, BOB, 'rock');
    assert.match(pick.replies[0].content, /اخترت 🪨/u);
    assert.equal(pick.replies[0].flags, 64, 'ephemeral');
    assert.ok(!/🪨/u.test(lastBoard(room).embeds[0].description.split('\n').slice(1).join('\n')), 'the pick is not shown');
    assert.match(lastBoard(room).embeds[0].description, new RegExp(`<@${BOB.id}>: ✅`, 'u'));
    assert.match((await move(room, BOB, 'paper')).replies[0].content, /اخترت خلاص/u);
    const second = await move(room, ALICE, 'paper');
    assert.match(second.replies[0].content, /📄 ・ 🪨/u);
    assert.match(lastBoard(room).embeds[0].description, /\*\*1\*\* - \*\*0\*\*/u);
    // A tie does not count.
    await move(room, ALICE, 'rock');
    await move(room, BOB, 'rock');
    assert.match(lastBoard(room).embeds[0].description, /\*\*1\*\* - \*\*0\*\*/u);
    await move(room, ALICE, 'scissors');
    await move(room, BOB, 'paper');
    assert.match(lastBoard(room).content, new RegExp(`🏆 <@${ALICE.id}>`, 'u'));
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer);
    assert.ok(customIds(winLine(room)).includes('g:again:rps'));
    await move(room, BOB, 'rock');
    assert.equal(await balance(room.client, ALICE.id), CC.gamesBot.answer, 'paid once');
});

test('rps: the player who did not pick in time forfeits; nobody picking ends it without a reward', async () => {
    const room = await start('حجره');
    await move(room, BOB, 'rock');
    await room.clock.advance(GAMES.duel.moveSeconds * 1000 + 10);
    assert.match(lastBoard(room).content, new RegExp(`<@${ALICE.id}> وقته خلص`, 'u'));
    assert.equal(await balance(room.client, BOB.id), CC.gamesBot.answer);
    assert.equal(await balance(room.client, ALICE.id), 0);

    const idle = await start('حجره');
    await idle.clock.advance(GAMES.duel.moveSeconds * 1000 + 10);
    assert.match(lastBoard(idle).content, /محدش لعب/u);
    assert.equal(await balance(idle.client, ALICE.id), 0);
    assert.equal(await balance(idle.client, BOB.id), 0);
    assert.ok(customIds(idle.channel.sent.at(-1).payload).includes('g:again:rps'));
});

test('a stale board button answers that the game ended and loses its buttons', async () => {
    const message = { edits: [], async edit(next) { this.edits.push(next); return this; } };
    const interaction = press('g:duel:deadbeef0000:0', ALICE, message);
    await gamesButtons.execute(interaction, fakeClient(), ['duel', 'deadbeef0000', '0']);
    assert.match(interaction.replies[0].content, /خلصت|ended/u);
    assert.deepEqual(message.edits[0], { components: [] });
});
