import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { askRound } from '../src/games/engine/round.js';
import { abortAll, startSession } from '../src/games/engine/session.js';
import { matches } from '../src/games/engine/text.js';
import { ALICE, BOB, BOT, CAROL, fakeChannel, fakeClient, fakeClock, flush } from './gamesFakes.js';

let next = 1;
const answer = (author, content, extra = {}) => ({ id: `9${next++}`, author, content, member: { id: author.id }, ...extra });

function setup({ lang = 'ar' } = {}) {
    const clock = fakeClock();
    const channel = fakeChannel(`4000000000000002${String(next++).padStart(2, '0')}`);
    const client = fakeClient();
    const session = startSession({ channelId: channel.id, clock, maxLifetimeMs: 0 });
    return { clock, channel, client, session, ctx: { client, channel, session, lang } };
}

// Nothing a round adds may stay behind: its collector stopped, its timer cleared, its delete listeners removed.
function assertClean({ channel, client, clock }) {
    assert.equal(channel.live(), 0, 'the collector is stopped');
    assert.equal(clock.pending(), 0, 'the timer is cleared');
    assert.equal(client.listenerCount('messageDelete'), 0);
    assert.equal(client.listenerCount('messageDeleteBulk'), 0);
}

afterEach(() => abortAll('test'));

test('the first right answer from a member wins; bots, webhooks and wrong answers never do', async () => {
    const room = setup();
    const round = askRound(room.ctx, { prompt: 'عاصمة مصر؟', validate: (content) => matches(content, 'القاهرة'), timeMs: 10_000 });
    await flush();
    // The question, then its live countdown: a Discord timestamp of the moment the time runs out (no edits needed).
    assert.equal(room.channel.sent[0].payload.content, `عاصمة مصر؟\n⏰ الوقت بيخلص <t:${Math.floor((room.clock.now() + 10_000) / 1000)}:R>`);
    assert.deepEqual(room.channel.sent[0].payload.allowedMentions, { parse: [] });
    room.channel.emit(answer(BOT, 'القاهرة'));
    room.channel.emit(answer(CAROL, 'القاهرة', { webhookId: '1' }));
    room.channel.emit(answer(ALICE, 'الجيزة'));
    await room.clock.advance(800);
    room.channel.emit(answer(BOB, 'القاهره'));
    room.channel.emit(answer(CAROL, 'القاهرة'));
    const result = await round;
    assert.equal(result.winner.id, BOB.id);
    assert.equal(result.message.content, 'القاهره');
    assert.equal(result.elapsedMs, 800);
    assert.equal(result.prompt, room.channel.sent[0]);
    assertClean(room);
    assert.equal(room.channel.sent.length, 1, 'the game announces the winner, not the round');
});

test('a member who answers again within 700 ms is ignored (rate limit), then counts again', async () => {
    const room = setup();
    const seen = [];
    const round = askRound(room.ctx, { prompt: 'q', validate: (content, message) => { seen.push([message.author.id, content]); return content === 'yes'; }, timeMs: 10_000 });
    await flush();
    room.channel.emit(answer(ALICE, 'no'));
    await room.clock.advance(300);
    room.channel.emit(answer(ALICE, 'yes'));
    await room.clock.advance(399);
    room.channel.emit(answer(ALICE, 'yes'));
    await flush();
    assert.deepEqual(seen, [[ALICE.id, 'no']], 'both fast tries were dropped');
    await room.clock.advance(1);
    room.channel.emit(answer(ALICE, 'yes'));
    const result = await round;
    assert.equal(result.winner.id, ALICE.id);
    assert.deepEqual(seen.at(-1), [ALICE.id, 'yes']);
});

test('answers are checked in the order they arrived, even when the check is slow', async () => {
    const room = setup();
    let release;
    const slow = new Promise((resolve) => { release = resolve; });
    const round = askRound(room.ctx, {
        prompt: 'q', timeMs: 10_000,
        validate: async (content) => (content === 'slow' ? slow : content === 'fast' ? { ok: true, points: 2 } : false),
    });
    await flush();
    room.channel.emit(answer(ALICE, 'slow'));
    room.channel.emit(answer(BOB, 'fast'));
    await flush();
    release({ ok: true, points: 9 });
    const result = await round;
    assert.equal(result.winner.id, ALICE.id);
    assert.deepEqual(result.result, { ok: true, points: 9 });
});

test('a check that throws counts as a wrong answer', async () => {
    const room = setup();
    const round = askRound(room.ctx, { prompt: 'q', timeMs: 10_000, validate: (content) => { if (content === 'boom') throw new Error('x'); return content === 'ok'; } });
    await flush();
    room.channel.emit(answer(ALICE, 'boom'));
    room.channel.emit(answer(BOB, 'ok'));
    assert.equal((await round).winner.id, BOB.id);
});

test('nobody in time: the answer is shown and the round reports a timeout', async () => {
    const room = setup();
    const round = askRound(room.ctx, { prompt: { title: 'سؤال', description: 'عاصمة مصر؟' }, validate: () => false, timeMs: 5000, reveal: 'القاهرة *' });
    await flush();
    assert.equal(room.channel.sent[0].payload.embeds[0].title, 'سؤال');
    room.channel.emit(answer(ALICE, 'غلط'));
    await room.clock.advance(4999);
    await room.clock.advance(1);
    const result = await round;
    assert.equal(result.timeout, true);
    assert.match(room.channel.sent[1].payload.content, /الوقت خلص ومحدش جاوب! الإجابة كانت: \*\*القاهرة \\\*\*\*/u);
    assertClean(room);
    // English, a custom reveal, and no reveal at all.
    const en = setup({ lang: 'en' });
    const second = askRound(en.ctx, { prompt: 'q', validate: () => false, timeMs: 100, reveal: 42 });
    await flush();
    await en.clock.advance(100);
    await second;
    assert.match(en.channel.sent[1].payload.content, /Time's up, nobody got it! The answer was: \*\*42\*\*/u);
    const silent = setup();
    const third = askRound(silent.ctx, { prompt: 'q', validate: () => false, timeMs: 100, reveal: false });
    await flush();
    await silent.clock.advance(100);
    assert.equal((await third).timeout, true);
    assert.equal(silent.channel.sent.length, 1);
});

test('deleting the question, ending the session or losing the room cancels the round and cleans up', async () => {
    const deleted = setup();
    const first = askRound(deleted.ctx, { prompt: 'q', validate: () => true, timeMs: 10_000 });
    await flush();
    deleted.client.emit('messageDelete', { id: 'another message' });
    deleted.client.emit('messageDelete', { id: deleted.channel.sent[0].id });
    assert.deepEqual(await first, { cancelled: true, reason: 'deleted' });
    assertClean(deleted);

    const bulk = setup();
    const second = askRound(bulk.ctx, { prompt: 'q', validate: () => true, timeMs: 10_000 });
    await flush();
    bulk.client.emit('messageDeleteBulk', new Map([[bulk.channel.sent[0].id, {}]]));
    assert.equal((await second).reason, 'deleted');
    assertClean(bulk);

    const ended = setup();
    const third = askRound(ended.ctx, { prompt: 'q', validate: () => true, timeMs: 10_000 });
    await flush();
    ended.session.end('shutdown');
    assert.deepEqual(await third, { cancelled: true, reason: 'shutdown' });
    assertClean(ended);
    // A round asked after the end does not post anything.
    assert.deepEqual(await askRound(ended.ctx, { prompt: 'q', validate: () => true }), { cancelled: true, reason: 'shutdown' });
    assert.equal(ended.channel.sent.length, 1);

    const lost = setup();
    const fourth = askRound(lost.ctx, { prompt: 'q', validate: () => true, timeMs: 10_000 });
    await flush();
    lost.channel.collectors[0].stop('channelDelete');
    assert.deepEqual(await fourth, { cancelled: true, reason: 'channelDelete' });
    assertClean(lost);

    const mute = setup();
    mute.channel.failSend = true;
    assert.deepEqual(await askRound(mute.ctx, { prompt: 'q', validate: () => true }), { cancelled: true, reason: 'send' });
    assert.equal(mute.channel.live(), 0, 'the collector started before the post is stopped');
    await assert.rejects(askRound(mute.ctx, {}), /needs validate/u);
});

test('many rounds in a row leave no listener behind', async () => {
    const room = setup();
    for (let i = 0; i < 25; i += 1) {
        const round = askRound(room.ctx, { prompt: `q${i}`, validate: (content) => content === `a${i}`, timeMs: 1000 });
        await flush();
        if (i % 2) room.channel.emit(answer(i % 4 === 1 ? ALICE : BOB, `a${i}`));
        else await room.clock.advance(1000);
        await round;
    }
    assertClean(room);
    assert.equal(room.channel.collectors.length, 25);
});

test('an answer typed while the question is being posted still counts; one typed before the question never does', async () => {
    const room = setup();
    let release;
    const posted = new Promise((resolve) => { release = resolve; });
    const send = room.channel.send.bind(room.channel);
    room.channel.send = async (payload) => {
        await posted;
        const message = await send(payload);
        message.createdTimestamp = 2_000;
        return message;
    };
    const round = askRound(room.ctx, { prompt: 'q', validate: (content) => content === 'a', timeMs: 10_000 });
    await flush();
    assert.equal(room.channel.live(), 1, 'the collector runs before the question is posted');
    room.channel.emit(answer(ALICE, 'a', { createdTimestamp: 1_999 }));
    room.channel.emit(answer(BOB, 'a', { createdTimestamp: 2_000 }));
    release();
    const result = await round;
    assert.equal(result.winner.id, BOB.id);
    assert.equal(result.elapsedMs, 0);
    assertClean(room);
});

test('a room lost or a session ended while the question is being posted cancels the round and cleans up', async () => {
    for (const end of ['room', 'session']) {
        const room = setup();
        let release;
        const posted = new Promise((resolve) => { release = resolve; });
        const send = room.channel.send.bind(room.channel);
        room.channel.send = async (payload) => { await posted; return send(payload); };
        const round = askRound(room.ctx, { prompt: 'q', validate: () => true, timeMs: 10_000 });
        await flush();
        if (end === 'room') room.channel.collectors[0].stop('channelDelete');
        else room.session.end('shutdown');
        release();
        assert.deepEqual(await round, { cancelled: true, reason: end === 'room' ? 'channelDelete' : 'shutdown' });
        assertClean(room);
    }
});

test('a prompt payload with files (an image question, rendered while the round listens) is posted as is', async () => {
    const room = setup();
    const file = { name: 'q.png', attachment: Buffer.from('89504e470d0a1a0a', 'hex') };
    const prompt = async () => ({ embeds: [{ title: 'سؤال', image: { url: 'attachment://q.png' } }], files: [file] });
    const round = askRound(room.ctx, { prompt, validate: (content) => matches(content, 'القاهرة'), timeMs: 10_000 });
    await flush();
    const { payload } = room.channel.sent[0];
    assert.deepEqual(payload.files, [file]);
    assert.equal(payload.embeds[0].image.url, 'attachment://q.png');
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    room.channel.emit(answer(BOB, 'القاهرة'));
    assert.equal((await round).winner.id, BOB.id);
    assertClean(room);
});
