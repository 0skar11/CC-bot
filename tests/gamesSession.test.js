import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAMES } from '../src/config/games.js';
import { abortAll, activeSessions, endSession, getSession, isBusy, startSession } from '../src/games/engine/session.js';
import { fakeClock, flush } from './gamesFakes.js';

const ROOM_A = '400000000000000101';
const ROOM_B = '400000000000000102';

test('one session per room: a second start is refused until the first ends', () => {
    const clock = fakeClock();
    const first = startSession({ channelId: ROOM_A, gameId: 'test', clock });
    assert.ok(first);
    assert.equal(isBusy(ROOM_A), true);
    assert.equal(startSession({ channelId: ROOM_A, gameId: 'other', clock }), null);
    const other = startSession({ channelId: ROOM_B, gameId: 'other', clock });
    assert.ok(other, 'another room is free');
    assert.equal(getSession(ROOM_A), first);
    assert.equal(first.end('done'), true);
    assert.equal(first.end('again'), false, 'ends once');
    assert.equal(first.endReason, 'done');
    assert.equal(isBusy(ROOM_A), false);
    const next = startSession({ channelId: ROOM_A, clock });
    assert.ok(next && next !== first);
    // An old session ending again never frees the room of a newer one.
    first.end('late');
    assert.equal(getSession(ROOM_A), next);
    assert.equal(abortAll('test'), 2);
    assert.throws(() => startSession({}), /needs a channel/u);
});

test('the timers of a session are cleared when it ends, and end hooks run once, newest first', async () => {
    const clock = fakeClock();
    const session = startSession({ channelId: ROOM_A, clock, maxLifetimeMs: 0 });
    const fired = [];
    session.setTimeout(() => fired.push('a'), 1000);
    const cancelled = session.setTimeout(() => fired.push('b'), 2000);
    session.setTimeout(() => fired.push('c'), 5000);
    session.clearTimeout(cancelled);
    await clock.advance(1500);
    assert.deepEqual(fired, ['a']);
    const order = [];
    session.onEnd((reason) => order.push(`first:${reason}`));
    const remove = session.onEnd(() => order.push('removed'));
    session.onEnd(() => { throw new Error('a broken hook does not stop the others'); });
    session.onEnd(async () => { order.push('last'); });
    remove();
    session.end('done');
    assert.equal(clock.pending(), 0, 'no timer is left');
    await clock.advance(10_000);
    assert.deepEqual(fired, ['a'], 'c never fires after the end');
    assert.deepEqual(order, ['last', 'first:done']);
    assert.equal(await session.finished, 'done');
    assert.equal(session.setTimeout(() => fired.push('late'), 1), null);
    // A hook added after the end runs at once.
    session.onEnd((reason) => order.push(`after:${reason}`));
    assert.deepEqual(order.at(-1), 'after:done');
});

test('abortAll ends every running session (SIGINT/SIGTERM) and frees every room', async () => {
    const clock = fakeClock();
    const sessions = [ROOM_A, ROOM_B].map((channelId) => startSession({ channelId, clock }));
    const reasons = [];
    for (const session of sessions) session.onEnd((reason) => reasons.push(reason));
    assert.equal(activeSessions().length, 2);
    assert.equal(abortAll(), 2);
    assert.deepEqual(reasons, ['shutdown', 'shutdown']);
    assert.equal(activeSessions().length, 0);
    assert.equal(isBusy(ROOM_A) || isBusy(ROOM_B), false);
    assert.equal(clock.pending(), 0);
    assert.equal(endSession(ROOM_A), false);
    await flush();
});

test('a session ends by itself after the safety lifetime so a room never stays stuck', async () => {
    const clock = fakeClock();
    const session = startSession({ channelId: ROOM_A, clock });
    await clock.advance(GAMES.maxLifetimeMs - 1);
    assert.equal(session.ended, false);
    await clock.advance(1);
    assert.equal(session.ended, true);
    assert.equal(session.endReason, 'expired');
    assert.equal(isBusy(ROOM_A), false);
});
