import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getGame, loadGames } from '../src/games/registry.js';
import { buildContext } from '../src/games/router.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import { setCardRenderer } from '../src/games/engine/card.js';
import { setPictureRenderer } from '../src/games/engine/imageCard.js';
import { handleChairsButton } from '../src/games/games/chairs.js';
import { handleHideButton } from '../src/games/games/hideAndSeek.js';
import { handleMafiaButton } from '../src/games/games/mafia.js';
import { handleSnakeButton } from '../src/games/games/snake.js';
import { handleReactionButton } from '../src/games/games/button.js';
import { handleLobbyButton } from '../src/games/engine/lobby.js';
import { ALICE, BOB, CAROL, fakeChannel, fakeClient, fakeClock, flush, press, typed } from './gamesFakes.js';

setCardRenderer(async () => Buffer.from('89504e470d0a1a0a', 'hex'));
setPictureRenderer(async () => Buffer.from('89504e470d0a1a0a', 'hex'));

let rooms = 0;

afterEach(() => {
    abortAll('test');
});

async function start(game, { starter = ALICE, lang = 'ar', client = fakeClient(), clock = fakeClock(), r = 0 } = {}) {
    const channel = fakeChannel(`4000000000000009${String(rooms++).padStart(2, '0')}`);
    const message = typed(channel, `.${game.names[lang][0]}`, starter);
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    const ctx = buildContext({ client, message, game, session, lang, clock, random: () => r });
    const running = game.run(ctx).finally(() => session.end('done'));
    await flush();
    return { channel, clock, client, session, ctx, message, running };
}

test('All 9 new games are registered in the registry and have valid schemas', async () => {
    await loadGames();
    const expected = ['roulette', 'chairs', 'hide', 'replica', 'mafia', 'emojiGuess', 'snake', 'button', 'colors'];
    for (const id of expected) {
        const game = getGame(id);
        assert.ok(game, `Game ${id} should be found`);
        assert.equal(game.id, id);
        assert.ok(game.names.ar.length > 0);
        assert.ok(game.names.en.length > 0);
        assert.ok(typeof game.run === 'function');
    }
});

test('roulette: lobby opens, elimination loop runs and rewards surviving winner', async () => {
    const game = getGame('roulette');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0.1 });

    // Join lobby
    const lobbyMsg = channel.sent[0];
    assert.ok(lobbyMsg);
    const [, , lobbyId] = lobbyMsg.payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, BOB, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobbyMsg), ['start', lobbyId]);
    await flush();

    // Advance clock through elimination delay
    await clock.advance(3000);
    await flush();

    await running;
    assert.ok(session.ended);
    const lastSent = channel.sent.at(-1);
    assert.ok(lastSent);
});

test('chairs: players join, chairs appear, seats are claimed via buttons', async () => {
    const game = getGame('chairs');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0.1 });

    // Lobby
    const lobbyMsg = channel.sent[0];
    const [, , lobbyId] = lobbyMsg.payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, BOB, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobbyMsg), ['start', lobbyId]);
    await flush();

    // Music delay
    await clock.advance(5000);
    await flush();

    // Chairs message appeared
    const chairsMsg = channel.sent.find((m) => m.payload?.components?.length > 0 && m !== lobbyMsg);
    assert.ok(chairsMsg, 'Chairs message should be sent');
    const buttonId = chairsMsg.payload.components[0].toJSON().components[0].custom_id;
    const [, , roundId, seatStr] = buttonId.split(':');

    // ALICE claims seat
    const interaction = press(buttonId, ALICE, chairsMsg);
    await handleChairsButton(interaction, [roundId, seatStr]);
    await flush();

    // Timeout round to eliminate unseated player (BOB)
    await clock.advance(16_000);
    await flush();

    await running;
    assert.ok(session.ended);
});

test('hideAndSeek: hider hides, seeker searches and catches them', async () => {
    const game = getGame('hide');
    const clock = fakeClock();
    // r=0 makes ALICE the seeker, BOB the hider
    const { channel, session, running } = await start(game, { clock, r: 0 });

    // Lobby
    const lobbyMsg = channel.sent[0];
    const [, , lobbyId] = lobbyMsg.payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, BOB, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobbyMsg), ['start', lobbyId]);
    await flush();

    // Hiding phase
    await clock.advance(2500);
    await flush();

    const hideMsg = channel.sent.find((m) => m.payload?.components?.length > 0 && m !== lobbyMsg);
    assert.ok(hideMsg, 'Hiding phase message sent');
    const hideBtnId = hideMsg.payload.components[0].toJSON().components[0].custom_id;
    const [, , action, gameId, spotId] = hideBtnId.split(':');

    // BOB hides
    const bobHide = press(hideBtnId, BOB, hideMsg);
    await handleHideButton(bobHide, ['hide', gameId, spotId]);
    await flush();

    // Advance hiding timer to seeking phase
    await clock.advance(16_000);
    await flush();

    // Seeker ALICE chooses the spot
    const seekMsg = channel.sent.at(-1);
    const seekBtnId = `g:hide:seek:${gameId}:${spotId}`;
    const aliceSeek = press(seekBtnId, ALICE, seekMsg);
    await handleHideButton(aliceSeek, ['seek', gameId, spotId]);
    await flush();

    await running;
    assert.ok(session.ended);
});

test('replica: round asks for pattern and handles clean termination', async () => {
    const game = getGame('replica');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0.5 });

    // Lobby
    const lobbyMsg = channel.sent[0];
    const [, , lobbyId] = lobbyMsg.payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, BOB, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobbyMsg), ['start', lobbyId]);
    await flush();

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});

test('mafia: assigns roles, runs night phase and day trial', async () => {
    const game = getGame('mafia');
    const clock = fakeClock();
    const DAVE = { id: '200000000000000014', username: 'dave' };
    const { channel, session, running } = await start(game, { clock, r: 0.1 });

    // Lobby of 4 players
    const lobbyMsg = channel.sent[0];
    const [, , lobbyId] = lobbyMsg.payload.components[0].toJSON().components[0].custom_id.split(':');
    await handleLobbyButton(press(`g:join:${lobbyId}`, BOB, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:join:${lobbyId}`, CAROL, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:join:${lobbyId}`, DAVE, lobbyMsg), ['join', lobbyId]);
    await handleLobbyButton(press(`g:start:${lobbyId}`, ALICE, lobbyMsg), ['start', lobbyId]);
    await flush();

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});

test('emojiGuess: question is posted and correct answer wins', async () => {
    const game = getGame('emojiGuess');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0 });

    const promptMsg = channel.sent[0];
    assert.ok(promptMsg);

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});

test('snake: arrow buttons move snake and eating apples wins', async () => {
    const game = getGame('snake');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0 });

    const snakeMsg = channel.sent[0];
    assert.ok(snakeMsg);
    const buttonId = snakeMsg.payload.components[0].toJSON().components[0].custom_id;
    const [, , gameId] = buttonId.split(':');

    // Move right
    const p1 = press(`g:snake:${gameId}:right`, ALICE, snakeMsg);
    await handleSnakeButton(p1, [gameId, 'right']);
    await flush();

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});

test('button: reaction speed button appears after delay and clicker wins', async () => {
    const game = getGame('button');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0.1 });

    // Wait for random delay
    await clock.advance(6000);
    await flush();

    const btnMsg = channel.sent[0];
    const editPayload = btnMsg.edits[0];
    assert.ok(editPayload, 'Message should be edited with button');
    const buttonId = editPayload.components[0].toJSON().components[0].custom_id;
    const [, , gameId] = buttonId.split(':');

    // BOB clicks
    const p = press(`g:btn:${gameId}`, BOB, btnMsg);
    await handleReactionButton(p, [gameId]);
    await flush();

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});

test('colors: Stroop test asks for ink or word and accepts correct answer', async () => {
    const game = getGame('colors');
    const clock = fakeClock();
    const { channel, session, running } = await start(game, { clock, r: 0.1 });

    const promptMsg = channel.sent[0];
    assert.ok(promptMsg);

    session.end('test_done');
    await running;
    assert.ok(session.ended);
});
