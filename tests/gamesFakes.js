// Test doubles for the chat games engine (src/games/): a fake clock, a room with message collectors, a client
// with an in-memory database, and typed messages. Never touches Discord or PostgreSQL.
import { EventEmitter } from 'node:events';

export const GUILD = '100000000000000002';
export const OTHER_GUILD = '100000000000000001';
export const ROOM = '400000000000000009';
export const ALICE = { id: '200000000000000011', username: 'alice' };
export const BOB = { id: '200000000000000012', username: 'bob' };
export const CAROL = { id: '200000000000000013', username: 'carol' };
export const BOT = { id: '200000000000000019', username: 'bot', bot: true };

/** Lets every queued promise and immediate run. */
export async function flush(rounds = 20) {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** A clock whose time only moves with advance(); timers fire in order as it passes them. */
export function fakeClock(start = 1_700_000_000_000) {
    let now = start;
    let nextId = 1;
    const timers = new Map();
    return {
        now: () => now,
        setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
        clearTimeout(id) { timers.delete(id); },
        pending: () => timers.size,
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].fn();
                await flush();
            }
            now = target;
            await flush();
        },
    };
}

let messageIds = 500_000_000_000_000_000n;
const nextMessageId = () => String(messageIds += 1n);

/** A message the bot sent: records its payload and every edit. */
function sentMessage(channel, payload) {
    return {
        id: nextMessageId(), channel, channelId: channel.id, payload, edits: [],
        async edit(next) { this.edits.push(next); return this; },
        async reply(next) { return channel.send(next); },
    };
}

/** A room: send() records, createMessageCollector() returns collectors fed by emit(message) like discord.js. */
export function fakeChannel(id = ROOM, extra = {}) {
    const sent = [];
    const replies = [];
    const collectors = [];
    const channel = {
        id, sent, replies, collectors, ...extra,
        async send(payload) {
            if (channel.failSend) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
            const message = sentMessage(channel, payload);
            sent.push(message);
            return message;
        },
        createMessageCollector({ filter } = {}) {
            const collector = new EventEmitter();
            collector.ended = false;
            collector.endReason = null;
            collector.filter = filter;
            collector.stop = (reason = 'user') => {
                if (collector.ended) return;
                collector.ended = true;
                collector.endReason = reason;
                collector.emit('end', new Map(), reason);
            };
            collectors.push(collector);
            return collector;
        },
        emit(message) {
            for (const collector of collectors) if (!collector.ended && (!collector.filter || collector.filter(message))) collector.emit('collect', message);
        },
        live: () => collectors.filter((collector) => !collector.ended).length,
    };
    return channel;
}

/** An in-memory bourse_records table with the methods of PostgreSQLDatabase that the bot uses (no transaction). */
export function fakeDb(initial = []) {
    const records = new Map(initial);
    const calls = { get: 0, set: 0, list: 0, entries: 0 };
    return {
        records, calls,
        async get(key, fallback = null) { calls.get += 1; return records.has(key) ? structuredClone(records.get(key)) : fallback; },
        async set(key, value) { calls.set += 1; records.set(key, structuredClone(value)); return true; },
        async list(prefix) { calls.list += 1; return [...records.keys()].filter((key) => key.startsWith(prefix)).sort(); },
    };
}

/** A client: an EventEmitter (messageDelete...) with a database and a users cache. */
export function fakeClient(db = fakeDb()) {
    const client = new EventEmitter();
    client.db = db;
    client.users = { fetch: async (id) => [ALICE, BOB, CAROL, BOT].find((user) => user.id === id) || null };
    return client;
}

/** A member typing in `channel`; `admin: true` gives Manage Server. */
export function typed(channel, content, author = ALICE, { admin = false, guildId = GUILD, replies = null, extra = {} } = {}) {
    return {
        id: nextMessageId(), content, author, guildId, guild: { id: guildId }, channel, channelId: channel.id,
        member: { id: author.id, user: author, permissions: { has: () => admin }, roles: { cache: new Map() } },
        attachments: new Map(), stickers: new Map(), mentions: { users: new Map() },
        async reply(payload) { (replies || channel.replies).push(payload); return payload; },
        ...extra,
    };
}

/** A button press on `customId` by `user`. */
export function press(customId, user = ALICE, message = null) {
    const interaction = {
        customId, user, message, replies: [], updates: [],
        async reply(payload) { interaction.replies.push(payload); },
        async update(payload) { interaction.updates.push(payload); },
    };
    return interaction;
}
