// The invite gift (src/services/cc/inviteTracker.js, inviteRewardService.js, chatCounter.js): which invite a joining
// member used, the exclusions (self, bots, rejoins, vanity, unknown, fake accounts), reading only real level-up
// announcements of exactly one member in Arabic and English (never rank cards, leaderboards, level lists or messages
// naming two members), counting the invited member's chat messages (batched, never twice), paying the inviter
// CC.inviteReward.amount exactly once through updateCCState (outside the games' daily cap) when the level and the 50
// messages are both there, in either order, and the inviter who left.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { ChannelType, GatewayIntentBits, GuildMemberFlags, MessageType } from 'discord.js';
import { createSnapshot } from '../scripts/lib/bourseBackup.js';
import { CC } from '../src/config/cc.js';
import { DEFAULT_LEVEL_BOT_ID, DEFAULT_LEVEL_CHANNEL_ID, levelBotIds, levelChannelIds, inviteRewardEnabled, validateInviteConfig } from '../src/config/invites.js';
import messageCreate from '../src/events/messageCreate.js';
import { getProfile, updateCCState } from '../src/services/cc/ccService.js';
import { chatCount, countChatMessage, flushChatCounts, forgetChatCounts, unsavedChatMessages } from '../src/services/cc/chatCounter.js';
import {
    accountCreatedAt, cachedInvites, didRejoin, findUsedInvite, forgetInvites, handleMemberJoin, inviteIntents, joinRecord, membersIntentAllowed,
    onInviteCreate, onInviteDelete, primeGuild, startInviteTracking, trackedGuildIds,
} from '../src/services/cc/inviteTracker.js';
import {
    forgetLevelMessages, handleChatMessage, handleLevelUpMessage, inviteConditions, inviteWelcomeNotice, isChatMessage, noteInviteJoin,
    parseLevel, parseLevelUp, payInviteReward,
} from '../src/services/cc/inviteRewardService.js';
import { getChatCountKey, getEconomyKey, getInviteRecordKey } from '../src/utils/database/keys.js';

const GUILD = '100000000000000002';
const SCOPE = '100000000000000001';
const INVITER = '200000000000000101';
const MEMBER = '200000000000000102';
const OTHER = '200000000000000103';
const NEWCOMER = '200000000000000104';
const SOME_BOT = '200000000000000109';
const T0 = Date.UTC(2026, 10, 16, 12);
const DAY = 24 * 60 * 60_000;
const AMOUNT = CC.inviteReward.amount;
const NEEDED = CC.inviteReward.messages;
const WARNING = String.fromCharCode(0x26a0, 0xfe0f);

function fakeDb(records = {}) {
    const store = new Map(Object.entries(records));
    const reads = [];
    const writes = [];
    return {
        store, reads, writes,
        get: async (key, fallback = null) => { reads.push(key); return store.has(key) ? structuredClone(store.get(key)) : fallback; },
        set: async (key, value) => { writes.push(key); store.set(key, structuredClone(value)); return true; },
        list: async (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)),
    };
}
/** A saved chat count of `count` messages for the member (the messages condition). */
const chatted = (count, memberId = MEMBER, guildId = GUILD) => ({ [getChatCountKey(guildId, memberId)]: { count, lastId: '0' } });
const invite = (code, uses, inviterId, { maxUses = 0, bot = false } = {}) => ({ code, uses, maxUses, inviter: inviterId ? { id: inviterId, bot } : null });

/** A server whose invite list is `list()` (or throws `error`), with members `present` (the others: Unknown Member). */
function fakeGuild({ list = () => [], error = null, present = [INVITER], bots = [], vanityURLCode = null } = {}) {
    return {
        id: GUILD, vanityURLCode,
        invites: { async fetch() { if (error) throw error; return new Map(list().map((item) => [item.code, item])); } },
        members: {
            async fetch({ user }) {
                if (bots.includes(user)) return { id: user, user: { id: user, bot: true } };
                if (present.includes(user)) return { id: user, user: { id: user, bot: false } };
                throw Object.assign(new Error('Unknown Member'), { code: 10007 });
            },
        },
    };
}
/** A text channel of `guildId` that keeps what is sent in it (`sent`). */
const room = (id, guildId = GUILD) => {
    const sent = [];
    return { id, guildId, sent, send: async (payload) => { sent.push(payload); return payload; } };
};
function fakeClient(guild, records = {}) {
    return {
        db: fakeDb(records),
        channels: { cache: new Map([[DEFAULT_LEVEL_CHANNEL_ID, room(DEFAULT_LEVEL_CHANNEL_ID)]]) },
        guilds: { cache: new Map(guild ? [[GUILD, guild]] : []) },
        options: { intents: { has: () => true } },
    };
}
const levelRoom = (client) => client.channels.cache.get(DEFAULT_LEVEL_CHANNEL_ID);
const messageId = (n) => String(300000000000000000n + BigInt(n));
/** A member's chat message `n` (its ID grows with n) in a text channel of `guildId`. */
function chat(client, n, { author = MEMBER, guildId = GUILD, bot = false, type = MessageType.Default, channelType = ChannelType.GuildText, webhookId = null, system = false } = {}) {
    return {
        id: messageId(n), guildId, client, guild: client.guilds.cache.get(guildId) ?? { id: guildId }, type, webhookId, system, content: 'hello',
        author: { id: author, bot }, channelId: '400000000000000009', channel: { id: '400000000000000009', type: channelType },
    };
}
/** Counts the member's messages from..to (each handled in turn, as messageCreate does). */
async function chatMessages(client, from, to, options = {}) {
    const results = [];
    for (let n = from; n <= to; n += 1) results.push(await handleChatMessage(chat(client, n, options), { now: options.now ?? T0 }));
    return results;
}
const joining = (guild, id = MEMBER, { bot = false, rejoined = false } = {}) => ({ id, guild, user: { id, bot }, flags: { bitfield: rejoined ? GuildMemberFlags.DidRejoin : 0 } });
const pending = (extra = {}) => ({ inviterId: INVITER, code: 'abc', source: 'invite', status: 'pending', reason: null, joinedAt: T0, ...extra });
const balance = async (client, id) => (await getProfile(client, GUILD, id)).cc;

/** A level bot announcement in the level room: `content`, `embeds`, the sent replies in `replies`. */
function announcement(client, { content = '', embeds = [], id = `9${Math.random()}`.replace('.', ''), author = DEFAULT_LEVEL_BOT_ID, channelId = DEFAULT_LEVEL_CHANNEL_ID, mentions = [] } = {}) {
    const replies = [];
    const sent = [];
    return {
        id, guildId: GUILD, channelId, content, embeds, client, guild: client.guilds.cache.get(GUILD) ?? { id: GUILD, client },
        author: { id: author, bot: true }, mentions: { users: new Map(mentions.map((user) => [user.id, user])) },
        replies, sent, channel: { id: channelId, send: async (payload) => { sent.push(payload); return payload; } },
        async reply(payload) { replies.push(payload); return payload; },
    };
}

afterEach(() => {
    forgetInvites();
    forgetLevelMessages();
    forgetChatCounts();
    for (const key of ['LEVEL_BOT_IDS', 'LEVEL_CHANNEL_IDS', 'WELCOME_ENABLED']) delete process.env[key];
    process.env.INVITE_REWARD_ENABLED = 'true'; // the tests' baseline (tests/env.js)
});

describe('the configuration', () => {
    test('5000 CC at level 5 and 50 messages, 7 days for an account, the level bot and room by default, overridable, checked at start', () => {
        assert.deepEqual(CC.inviteReward, { amount: 5000, level: 5, messages: 50, minAccountAgeDays: 7 });
        assert.equal(inviteConditions(), 'يوصل لفل 5 ويكتب 50 رسالة');
        assert.deepEqual([...levelBotIds()], ['1513858357142880346']);
        assert.deepEqual([...levelChannelIds()], ['1571798045580984360']);
        assert.deepEqual([...levelBotIds({ LEVEL_BOT_IDS: '300000000000000001, 300000000000000002' })], ['300000000000000001', '300000000000000002']);
        assert.doesNotThrow(() => validateInviteConfig({}));
        assert.throws(() => validateInviteConfig({ LEVEL_CHANNEL_IDS: 'abc' }), /LEVEL_CHANNEL_IDS/u);
        // The backups accept the new records: who invited whom, and the chat counts.
        const at = new Date(T0).toISOString();
        assert.doesNotThrow(() => createSnapshot([
            { key: getInviteRecordKey(GUILD, MEMBER), value: pending(), updatedAt: at },
            { key: getChatCountKey(GUILD, MEMBER), value: { count: 12, lastId: messageId(12) }, updatedAt: at },
        ]));
        assert.equal(getChatCountKey(GUILD, MEMBER), `guild:${GUILD}:chat:${MEMBER}`);
    });

    test('the Server Members Intent is asked only when the portal switch is on; for the welcome too; nothing when both are off', async () => {
        assert.equal(membersIntentAllowed(1 << 14), true);
        assert.equal(membersIntentAllowed(1 << 15), true);
        assert.equal(membersIntentAllowed((1 << 18) | (1 << 19)), false);
        const rest = (flags) => ({ get: async () => ({ flags }) });
        assert.deepEqual(await inviteIntents('t', { rest: rest(1 << 15) }), [GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildMembers]);
        assert.deepEqual(await inviteIntents('t', { rest: rest(0) }), [GatewayIntentBits.GuildInvites]);
        assert.deepEqual(await inviteIntents('t', { rest: { get: async () => { throw new Error('offline'); } } }), [GatewayIntentBits.GuildInvites]);
        // Off unless switched on (DISbot already pays the invite reward: never two payers by default).
        assert.equal(inviteRewardEnabled({}), false);
        assert.equal(inviteRewardEnabled({ INVITE_REWARD_ENABLED: 'true' }), true);
        // The welcome alone (the gift off) still needs to see members join: GuildMembers, never GuildInvites.
        process.env.INVITE_REWARD_ENABLED = 'false';
        assert.deepEqual(await inviteIntents('t', { rest: rest(1 << 14) }), [GatewayIntentBits.GuildMembers]);
        assert.deepEqual(await inviteIntents('t', { rest: rest(0) }), [], 'the switch off: the bot still starts, without it');
        assert.deepEqual(await inviteIntents('t', { rest: rest(1 << 14), env: { WELCOME_ENABLED: 'false' } }), []);
        process.env.WELCOME_ENABLED = 'false';
        let asked = false;
        assert.deepEqual(await inviteIntents('t', { rest: { get: async () => { asked = true; return { flags: 1 << 14 }; } } }), []);
        assert.equal(asked, false, 'Discord is not asked when nothing needs the intent');
    });
});

describe('reading the level bot', () => {
    test('a level-up announcement in Arabic and English gives the level just reached', () => {
        const cases = [
            ['GG <@200000000000000102>, you just advanced to level 5!', 5],
            ['<@200000000000000102> has reached level **5**. GG!', 5],
            ['Level Up!\nLevel\n6', 6],
            ['Level up! from level 4 to level 5', 5],
            ['🎉 Level up!\nLevel 4 → 5', 5],
            ['<@200000000000000102> leveled up to 5!', 5],
            ['🎉 LEVEL UP ➜ 7', 7],
            ['you reached level 4! Next level: 5', 4],
            ['Your level is now 9', 9],
            ['New level: 6', 6],
            ['مبروك <@200000000000000102> وصلت للمستوى ٥ 🎉', 5],
            ['مبروك وصلت لفل 5', 5],
            ['طلعت لفل 6 🎉', 6],
            ['مبروك! لفلك صار 5', 5],
            ['المستوى الجديد: 6', 6],
            ['ارتقيت إلى المستوى الخامس', 5],
        ];
        for (const [text, level] of cases) assert.equal(parseLevel(text), level, text);
    });

    test('a level named without level-up words is no announcement: rank cards, leaderboards, level lists', () => {
        const cases = [
            'Lv.5', 'LVL: 12', 'Level 4 → 5', 'from level 4 to level 5', 'level up!', 'Rank #3 · XP 500', '<:level:123456789012345678> 9',
            '**Level 7** | XP 300/1000 | Rank #3',
            '<@200000000000000102> is level 7 with 300 XP',
            '🏆 Leaderboard\n1. <@200000000000000101> • Level 20\n2. <@200000000000000102> • Level 15',
            '📊 Rank\nLevel: 7\nXP: 1,200 / 1,500\nRank: #4',
            'Level 7\nXP needed to level up: 300',
            'Level 7\nLevel up in 300 XP',
            'Level Up: 300 XP',
            'لفلك الحالي: 7', 'مستواك: 6', 'الليفل: **7**', 'المستوى: 7 | الخبرة 300', 'المستوى التالي 6',
        ];
        for (const text of cases) assert.equal(parseLevel(text), null, text);
    });

    test('the member: the one mentioned user; with none mentioned, the one replied to or shown; nobody else named', async () => {
        const client = fakeClient(fakeGuild());
        const member = { id: MEMBER, bot: false };
        const bot = { id: SOME_BOT, bot: true };
        // The one mentioned user (bots left out).
        assert.deepEqual(await parseLevelUp(announcement(client, { content: `<@${SOME_BOT}> <@!${MEMBER}> reached level 5`, mentions: [bot, member] })), { userId: MEMBER, level: 5 });
        assert.deepEqual(await parseLevelUp(announcement(client, { content: `<@${MEMBER}>`, embeds: [{ data: { title: 'Level up!', description: 'Level: 5' } }], mentions: [member] })), { userId: MEMBER, level: 5 });
        // None mentioned: the one avatar on the card, or the member it replies to.
        const avatar = { data: { description: 'طلعت لفل 6', author: { name: 'x', icon_url: `https://cdn.discordapp.com/avatars/${MEMBER}/abc.png` } } };
        assert.deepEqual(await parseLevelUp(announcement(client, { embeds: [avatar] })), { userId: MEMBER, level: 6 });
        const reply = (content, author = MEMBER) => Object.assign(announcement(client, { content }), { reference: { messageId: '1' }, fetchReference: async () => ({ author: { id: author, bot: false } }) });
        assert.deepEqual(await parseLevelUp(reply('You just advanced to level 5!')), { userId: MEMBER, level: 5 });
        // Never a user named only in the text, and nothing when somebody else is named or shown.
        assert.equal(await parseLevelUp(announcement(client, { content: `<@${MEMBER}> reached level 5` })), null, 'named in the text only');
        assert.equal(await parseLevelUp(announcement(client, { embeds: [{ data: { description: `<@${MEMBER}> reached level 5` } }] })), null, 'named in the embed only');
        assert.equal(await parseLevelUp(reply(`<@${OTHER}> reached level 5`)), null, 'replies to one member, names another');
        assert.equal(await parseLevelUp(announcement(client, { content: `<@${MEMBER}> reached level 5`, embeds: [{ data: { description: `and <@${OTHER}>` } }], mentions: [member] })), null);
        assert.equal(await parseLevelUp(Object.assign(reply('reached level 5', OTHER), { embeds: [avatar] })), null, 'the reply and the card disagree');
        assert.equal(await parseLevelUp(announcement(client, { content: `<@${MEMBER}> level up!`, mentions: [member] })), null, 'no level');
        assert.equal(await parseLevelUp(announcement(client, { content: 'reached level 5' })), null, 'no member');
    });
});

describe('only a real level-up of one member pays', () => {
    // The member wrote the 50 messages already: only the level-up is missing.
    const setup = () => {
        const guild = fakeGuild({ present: [INVITER] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending(), [getInviteRecordKey(GUILD, OTHER)]: pending(), ...chatted(NEEDED), ...chatted(NEEDED, OTHER) });
        return client;
    };
    const member = { id: MEMBER, bot: false };
    const other = { id: OTHER, bot: false };
    const nothingPaid = async (client, message) => {
        assert.equal(await handleLevelUpMessage(message, { now: T0 }), true, 'the level bot\'s message is handled');
        assert.equal(await balance(client, INVITER), 0);
        assert.deepEqual([message.replies.length, message.sent.length], [0, 0]);
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending', 'the gift still waits for a real level-up');
    };

    test('a leaderboard with several members and levels pays nothing', async () => {
        const client = setup();
        const board = '🏆 **Top levels**\n1. <@200000000000000103> • Level 20 • 9,000 XP\n2. <@200000000000000102> • Level 15 • 6,000 XP\n3. <@200000000000000101> • Level 5 • 900 XP';
        await nothingPaid(client, announcement(client, { embeds: [{ data: { title: 'Leaderboard', description: board } }] }));
        await nothingPaid(client, announcement(client, { content: board, mentions: [other, member] }));
    });

    test('a rank card pays nothing', async () => {
        const client = setup();
        const card = { data: { title: 'Rank card', description: '**Level 7** | XP 300/1000 | Rank #3', thumbnail: { url: `https://cdn.discordapp.com/avatars/${MEMBER}/abc.png` } } };
        await nothingPaid(client, announcement(client, { content: `<@${MEMBER}>`, embeds: [card], mentions: [member] }));
        await nothingPaid(client, announcement(client, { content: `<@${MEMBER}> لفلك الحالي: 7`, mentions: [member] }));
    });

    test('a message naming two members pays nothing', async () => {
        const client = setup();
        await nothingPaid(client, announcement(client, { content: `GG <@${MEMBER}> and <@${OTHER}>, you both reached level 5!`, mentions: [member, other] }));
        await nothingPaid(client, announcement(client, { content: `GG <@${MEMBER}>, you reached level 5! Invited by <@${OTHER}>`, mentions: [member] }));
    });

    test('the rank reply of a member already past level 5 pays nothing', async () => {
        const client = setup();
        const rank = Object.assign(announcement(client, { content: '📊 Level: 7\nXP: 1,200 / 1,500\nRank: #4' }), {
            reference: { messageId: '1' }, fetchReference: async () => ({ author: { id: MEMBER, bot: false } }),
        });
        await nothingPaid(client, rank);
    });

    test('two different levels in one message pay nothing', async () => {
        const client = setup();
        await nothingPaid(client, announcement(client, { content: `GG <@${MEMBER}>, you just advanced to level 5! Level 6 is next`, mentions: [member] }));
        await nothingPaid(client, announcement(client, { content: `<@${MEMBER}> reached level 5 and reached level 7`, mentions: [member] }));
        assert.equal(parseLevel('Level up!\nLevel 3\nLevel 9'), null);
    });

    test('a member\'s own name can\'t give or change the level: it is cut out before the message is read', async () => {
        const client = setup();
        const named = (name, extra = {}) => ({ id: MEMBER, bot: false, username: 'member', globalName: name, displayName: name, ...extra });
        // The real level-up is level 2: a display name saying 9 or 5 (or a level-up) must not pay or change it.
        for (const name of ['advanced to level 9', 'reached level 5', 'Level Up! level 7', 'وصلت لفل 9']) {
            const message = announcement(client, { content: `GG ${name} <@${MEMBER}>, you just advanced to level 2!`, mentions: [named(name)] });
            assert.deepEqual(await parseLevelUp(message), { userId: MEMBER, level: 2 }, name);
            await nothingPaid(client, message);
            // The same name written on the embed's card (its author line) instead.
            const card = announcement(client, { content: `<@${MEMBER}>`, embeds: [{ data: { author: { name }, description: 'GG, you just advanced to level 2!' } }], mentions: [named(name)] });
            assert.deepEqual(await parseLevelUp(card), { userId: MEMBER, level: 2 }, `${name} on the card`);
        }
        // A nickname (the mentioned member), the replied member's names, a cached member shown only on the card.
        const nick = announcement(client, { content: `GG reached level 6 <@${MEMBER}>, you just advanced to level 2!`, mentions: [named('member')] });
        nick.mentions.members = new Map([[MEMBER, { nickname: 'reached level 6', displayName: 'reached level 6', user: named('member') }]]);
        assert.equal((await parseLevelUp(nick)).level, 2);
        const reply = Object.assign(announcement(client, { content: 'GG reached level 8, you just advanced to level 2!' }), {
            reference: { messageId: '1' }, fetchReference: async () => ({ author: named('reached level 8'), member: { nickname: null, displayName: 'reached level 8' } }),
        });
        assert.equal((await parseLevelUp(reply)).level, 2);
        const shown = announcement(client, { embeds: [{ data: { description: `<@${MEMBER}> is now level 9\nGG, you just advanced to level 2!`, thumbnail: { url: `https://cdn.discordapp.com/avatars/${MEMBER}/a.png` } } }] });
        shown.guild = { ...shown.guild, members: { ...shown.guild.members, cache: new Map([[MEMBER, { nickname: 'is now level 9', displayName: 'is now level 9', user: named('member') }]]) } };
        assert.equal((await parseLevelUp(shown)).level, 2);
        await nothingPaid(client, shown);
        // A name that could not be cut out (not known to the bot) still pays nothing: the message names two levels.
        await nothingPaid(client, announcement(client, { content: `GG reached level 9 <@${MEMBER}>, you just advanced to level 2!`, mentions: [named('member')] }));
        // And a real level 5 stays level 5 whatever the member is called.
        const real = announcement(client, { content: `GG reached level 9 <@${MEMBER}>, you just advanced to level 5!`, mentions: [named('reached level 9')] });
        assert.deepEqual(await parseLevelUp(real), { userId: MEMBER, level: 5 });
        assert.equal(await handleLevelUpMessage(real, { now: T0 }), true);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).level, 5);
    });

    test('a real level-up of one member pays the inviter once', async () => {
        const client = setup();
        const levelUp = () => announcement(client, { content: `GG <@${MEMBER}>, you just advanced to level 5!`, mentions: [member] });
        const first = levelUp();
        assert.equal(await handleLevelUpMessage(first, { now: T0 }), true);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(first.replies.length, 1);
        const again = levelUp();
        await handleLevelUpMessage(again, { now: T0 });
        assert.equal(await balance(client, INVITER), AMOUNT, 'a second announcement never pays again');
        assert.equal(again.replies.length, 0);
    });
});

describe('tracking who invited whom', () => {
    test('the exclusions: unknown, ambiguous, vanity, no inviter, self, a bot\'s invite, a rejoin', () => {
        const found = (entry) => ({ source: 'invite', invite: { code: 'abc', uses: 1, maxUses: 0, inviterId: INVITER, inviterBot: false, ...entry } });
        const decide = (args) => { const { status, reason } = joinRecord({ memberId: MEMBER, now: T0, ...args }); return [status, reason]; };
        assert.deepEqual(decide({ found: found() }), ['pending', null]);
        assert.deepEqual(decide({ found: { source: 'unknown' } }), ['excluded', 'unknown']);
        assert.deepEqual(decide({ found: { source: 'ambiguous' } }), ['excluded', 'ambiguous']);
        assert.deepEqual(decide({ found: found({ code: 'cool' }), vanityCode: 'cool' }), ['excluded', 'vanity']);
        assert.deepEqual(decide({ found: found({ inviterId: null }) }), ['excluded', 'no_inviter']);
        assert.deepEqual(decide({ found: found({ inviterId: MEMBER }) }), ['excluded', 'self']);
        assert.deepEqual(decide({ found: found({ inviterBot: true }) }), ['excluded', 'bot_inviter']);
        assert.deepEqual(decide({ found: found(), rejoined: true }), ['excluded', 'rejoin']);
        assert.equal(didRejoin({ flags: { has: (bit) => bit === GuildMemberFlags.DidRejoin } }), true);
        assert.equal(didRejoin({ flags: 0 }), false);
    });

    test('the invite whose count went up; two at once are ambiguous; nothing matched is unknown', () => {
        const map = (...entries) => new Map(entries.map((entry) => [entry.code, { maxUses: 0, inviterId: INVITER, inviterBot: false, ...entry }]));
        assert.equal(findUsedInvite(map({ code: 'a', uses: 1 }, { code: 'b', uses: 4 }), map({ code: 'a', uses: 1 }, { code: 'b', uses: 5 })).invite.code, 'b');
        assert.equal(findUsedInvite(map({ code: 'a', uses: 1 }), map({ code: 'a', uses: 1 }, { code: 'new', uses: 1 })).invite.code, 'new');
        assert.equal(findUsedInvite(map({ code: 'a', uses: 1 }, { code: 'b', uses: 1 }), map({ code: 'a', uses: 2 }, { code: 'b', uses: 2 })).source, 'ambiguous');
        assert.equal(findUsedInvite(map({ code: 'a', uses: 1 }), map({ code: 'a', uses: 1 })).source, 'unknown');
    });

    test('a deleted invite is credited only when it surely ran out on this join: seen deleted, exactly exhausted, alone, no vanity', () => {
        const map = (...entries) => new Map(entries.map((entry) => [entry.code, { maxUses: 0, inviterId: INVITER, inviterBot: false, ...entry }]));
        const seen = (code, uses, maxUses) => ({ code, uses, maxUses, inviterId: OTHER, inviterBot: false, at: T0 });
        const keep = map({ code: 'a', uses: 1 });
        // Exhausted on its last use (4 of 5, now gone), seen deleted: credited.
        assert.deepEqual(findUsedInvite(keep, keep, [seen('last', 4, 5)]), { source: 'invite', invite: seen('last', 4, 5) });
        assert.equal(findUsedInvite(map(), map(), [seen('once', 0, 1)]).invite.code, 'once');
        // Deleted by hand before it ran out (1 of 5), or one with no limit: unknown.
        assert.equal(findUsedInvite(keep, keep, [seen('manual', 1, 5)]).source, 'unknown');
        assert.equal(findUsedInvite(keep, keep, [seen('open', 3, 0)]).source, 'unknown');
        // More than one use short or past its max: never "exactly" its last use.
        assert.equal(findUsedInvite(keep, keep, [seen('odd', 5, 5)]).source, 'unknown');
        // Gone from the list without an inviteDelete event seen: unknown, even exhausted.
        assert.equal(findUsedInvite(map({ code: 'one', uses: 4, maxUses: 5 }), map()).source, 'unknown');
        assert.equal(findUsedInvite(map({ code: 'a', uses: 1 }, { code: 'x', uses: 1, maxUses: 9 }), map({ code: 'a', uses: 1 }), [seen('last', 4, 5)]).source, 'unknown', 'another invite vanished too');
        // Two deleted, or a server with a vanity link: unknown.
        assert.equal(findUsedInvite(keep, keep, [seen('last', 4, 5), seen('once', 0, 1)]).source, 'unknown');
        assert.equal(findUsedInvite(keep, keep, [seen('last', 4, 5)], { vanity: true }).source, 'unknown');
        // A count that rose wins over a deletion.
        assert.equal(findUsedInvite(keep, map({ code: 'a', uses: 2 }), [seen('last', 4, 5)]).invite.code, 'a');
    });

    test('a join is saved once with its inviter; bots are not saved; the first join decides', async () => {
        let invites = [invite('abc', 2, INVITER), invite('xyz', 0, OTHER)];
        const guild = fakeGuild({ list: () => invites });
        const client = fakeClient(guild);
        assert.deepEqual(trackedGuildIds(client), new Set([GUILD]));
        assert.deepEqual(await startInviteTracking(client), { status: 'ok', guilds: 1, read: 1 });
        assert.equal(cachedInvites(GUILD).get('abc').uses, 2);
        invites = [invite('abc', 3, INVITER), invite('xyz', 0, OTHER)];
        const saved = await handleMemberJoin(joining(guild), client, { now: T0 });
        assert.deepEqual(saved.record, { inviterId: INVITER, code: 'abc', source: 'invite', joinedAt: T0, status: 'pending', reason: null });
        assert.deepEqual(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)), saved.record);
        // A bot joining is never saved.
        invites = [invite('abc', 3, INVITER), invite('xyz', 1, OTHER)];
        assert.equal((await handleMemberJoin(joining(guild, SOME_BOT, { bot: true }), client)).status, 'bot');
        assert.equal(client.db.store.has(getInviteRecordKey(GUILD, SOME_BOT)), false);
        // The same member again (left and came back through another invite): the first record stays.
        invites = [invite('abc', 3, INVITER), invite('xyz', 2, OTHER)];
        assert.equal((await handleMemberJoin(joining(guild, MEMBER, { rejoined: true }), client)).status, 'kept');
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).inviterId, INVITER);
        // Somebody who was in the server before tracking (Discord's rejoin flag): never paid.
        invites = [invite('abc', 4, INVITER), invite('xyz', 2, OTHER)];
        assert.equal((await handleMemberJoin(joining(guild, OTHER, { rejoined: true }), client)).record.reason, 'rejoin');
        // A server that is not tracked (no level room in it) is ignored.
        assert.equal((await handleMemberJoin({ ...joining(guild), guild: { ...guild, id: '100000000000000001' } }, client)).status, 'untracked');
    });

    test('invites created and deleted on the way are followed; an exhausted invite deleted by its last use is credited once', async () => {
        let invites = [invite('abc', 0, INVITER)];
        const guild = fakeGuild({ list: () => invites });
        const client = fakeClient(guild);
        assert.equal(await primeGuild(guild), true);
        onInviteCreate({ ...invite('once', 0, OTHER, { maxUses: 1 }), guild: { id: GUILD } });
        assert.equal(cachedInvites(GUILD).get('once').maxUses, 1);
        // Discord deletes `once` on its only use, and the delete may arrive before the join.
        onInviteDelete({ code: 'once', guild: { id: GUILD } }, { now: T0 });
        invites = [invite('abc', 0, INVITER)];
        const { record } = await handleMemberJoin(joining(guild), client, { now: T0 + 1000 });
        assert.deepEqual([record.inviterId, record.code, record.status], [OTHER, 'once', 'pending']);
        // The deletion served that join: the next one (a vanity link, a widget...) within the 15 s gets nothing from it.
        const next = await handleMemberJoin(joining(guild, NEWCOMER), client, { now: T0 + 2000 });
        assert.deepEqual([next.record.status, next.record.reason], ['excluded', 'unknown']);
    });

    test('an invite deleted by hand before it ran out credits nobody; one seen too late or in a vanity server neither', async () => {
        let invites = [invite('abc', 0, INVITER), invite('five', 1, OTHER, { maxUses: 5 })];
        const guild = fakeGuild({ list: () => invites });
        const client = fakeClient(guild);
        assert.equal(await primeGuild(guild), true);
        // An admin deletes `five` (1 of 5 used), then somebody joins through something else.
        onInviteDelete({ code: 'five', guild: { id: GUILD } }, { now: T0 });
        invites = [invite('abc', 0, INVITER)];
        const manual = await handleMemberJoin(joining(guild), client, { now: T0 + 1000 });
        assert.deepEqual([manual.record.status, manual.record.reason, manual.record.inviterId], ['excluded', 'unknown', null]);
        // Exhausted, but its inviteDelete event older than 15 s: unknown.
        invites = [invite('abc', 0, INVITER), invite('last', 4, OTHER, { maxUses: 5 })];
        assert.equal(await primeGuild(guild), true);
        onInviteDelete({ code: 'last', guild: { id: GUILD } }, { now: T0 });
        invites = [invite('abc', 0, INVITER)];
        const late = await handleMemberJoin(joining(guild, OTHER), client, { now: T0 + 16_000 });
        assert.equal(late.record.reason, 'unknown');
        // Exhausted and seen deleted, but the server has a vanity link: unknown.
        const vanity = fakeGuild({ list: () => invites, vanityURLCode: 'cool' });
        const vanityClient = fakeClient(vanity);
        invites = [invite('abc', 0, INVITER), invite('last', 4, OTHER, { maxUses: 5 })];
        assert.equal(await primeGuild(vanity), true);
        onInviteDelete({ code: 'last', guild: { id: GUILD } }, { now: T0 });
        invites = [invite('abc', 0, INVITER)];
        const viaVanity = await handleMemberJoin(joining(vanity), vanityClient, { now: T0 + 1000 });
        assert.deepEqual([viaVanity.record.status, viaVanity.record.reason], ['excluded', 'unknown']);
    });

    test('without Manage Server the join is saved as unknown and nothing throws', async () => {
        const guild = fakeGuild({ error: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
        const client = fakeClient(guild);
        assert.deepEqual(await startInviteTracking(client), { status: 'ok', guilds: 1, read: 0 });
        assert.equal(cachedInvites(GUILD), null);
        const { record } = await handleMemberJoin(joining(guild), client, { now: T0 });
        assert.deepEqual([record.status, record.reason, record.inviterId], ['excluded', 'unknown', null]);
    });
});

describe('paying the gift', () => {
    test('paid once to the inviter through updateCCState; again, higher, or at once never pays twice', async () => {
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending(), ...chatted(NEEDED) });
        await updateCCState(client, GUILD, INVITER, (state) => { state.cc = 100; });
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 4 }), { status: 'low' });
        const [first, second] = await Promise.all([
            payInviteReward(client, GUILD, MEMBER, { level: 5, now: T0 }),
            payInviteReward(client, GUILD, MEMBER, { level: 5, now: T0 }),
        ]);
        assert.deepEqual([first.status, second.status].sort(), ['done', 'paid']);
        const paid = first.status === 'paid' ? first : second;
        assert.deepEqual(paid, { status: 'paid', inviterId: INVITER, amount: AMOUNT, balance: 100 + AMOUNT, level: 5, messages: NEEDED });
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 9 })).status, 'done');
        assert.equal((await payInviteReward(client, GUILD, MEMBER)).status, 'done', 'nor from the messages');
        assert.equal(await balance(client, INVITER), 100 + AMOUNT);
        assert.equal(await balance(client, MEMBER), 0, 'the invited member gets nothing');
        const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([record.status, record.level, record.messages, record.amount, record.paidAt], ['paid', 5, NEEDED, AMOUNT, T0]);
        // Earned like any CC, never counted in the games' daily cap.
        const economy = client.db.store.get(getEconomyKey(SCOPE, INVITER));
        assert.equal(economy.ccStats.earned, AMOUNT);
        assert.equal(economy.ccGamesBot, undefined);
    });

    test('no record, an excluded one or an unknown inviter never pays', async () => {
        const client = fakeClient(fakeGuild(), {
            [getInviteRecordKey(GUILD, OTHER)]: pending({ status: 'excluded', reason: 'self', inviterId: OTHER }),
            [getInviteRecordKey(GUILD, SOME_BOT)]: pending({ inviterId: null }),
        });
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 5 })).status, 'no_record');
        assert.equal((await payInviteReward(client, GUILD, OTHER, { level: 5 })).status, 'done');
        assert.deepEqual(await payInviteReward(client, GUILD, SOME_BOT, { level: 5 }), { status: 'skipped', reason: 'no_inviter', inviterId: '' });
        assert.equal(await balance(client, OTHER), 0);
    });

    test('an inviter who left (or turned out a bot) is skipped for good; one that could not be checked waits', async () => {
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending(), [getInviteRecordKey(GUILD, OTHER)]: pending(), ...chatted(NEEDED), ...chatted(NEEDED, OTHER) });
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 5, presence: async () => 'unknown' }), { status: 'retry', inviterId: INVITER });
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending');
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 5, presence: async () => 'left' }), { status: 'skipped', reason: 'inviter_left', inviterId: INVITER });
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 6, presence: async () => 'present' })).status, 'done', 'coming back later changes nothing');
        assert.equal((await payInviteReward(client, GUILD, OTHER, { level: 5, presence: async () => 'bot' })).reason, 'bot_inviter');
        assert.equal(await balance(client, INVITER), 0);
    });

    test('the level bot\'s announcement in its room pays and answers once; other bots, rooms and lower levels do not', async () => {
        const guild = fakeGuild({ present: [INVITER] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending(), ...chatted(NEEDED) });
        const member = { id: MEMBER, bot: false };
        const low = announcement(client, { content: `GG <@${MEMBER}>, you just advanced to level 4!`, mentions: [member] });
        assert.equal(await handleLevelUpMessage(low), true);
        assert.equal(await balance(client, INVITER), 0);
        const real = `GG <@${MEMBER}>, you just advanced to level 5!`;
        assert.equal(await handleLevelUpMessage(announcement(client, { content: real, mentions: [member], author: SOME_BOT })), false, 'another bot');
        assert.equal(await handleLevelUpMessage(announcement(client, { content: real, mentions: [member], channelId: '400000000000000001' })), false, 'another room');
        assert.equal(await balance(client, INVITER), 0);

        const five = announcement(client, { content: `<@${MEMBER}>`, embeds: [{ data: { title: '🎉 Level up', description: `مبروك <@${MEMBER}> وصلت لفل **5**` } }], mentions: [member] });
        assert.equal(await handleLevelUpMessage(five, { now: T0 }), true);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(five.replies.length, 1);
        assert.match(five.replies[0].content, new RegExp(`^🎁 <@${INVITER}> خدت \\*\\*5,000\\*\\* 🌀 CC هدية انفايت: <@${MEMBER}> اللي دعيته وصل لفل \\*\\*5\\*\\* وكتب \\*\\*50\\*\\* رسالة`, 'u'));
        assert.deepEqual(five.replies[0].allowedMentions, { users: [INVITER], repliedUser: false });
        // The same message edited, through the event, and a later level: nothing more.
        assert.equal(await handleLevelUpMessage(five), true);
        await messageCreate.execute(announcement(client, { content: `<@${MEMBER}> reached level 6`, mentions: [member] }), client);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(five.replies.length, 1);
    });

    test('the inviter who left the server gets nothing and no notice', async () => {
        const guild = fakeGuild({ present: [] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending(), ...chatted(NEEDED) });
        const message = announcement(client, { content: `<@${MEMBER}> has reached level **5**`, mentions: [{ id: MEMBER, bot: false }] });
        assert.equal(await handleLevelUpMessage(message), true);
        assert.equal(await balance(client, INVITER), 0);
        assert.deepEqual([message.replies.length, message.sent.length], [0, 0]);
        assert.deepEqual([client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).reason], ['skipped', 'inviter_left']);
    });
});

describe('fake accounts and the notice under the welcome', () => {
    const found = { source: 'invite', invite: { code: 'abc', uses: 1, maxUses: 0, inviterId: INVITER, inviterBot: false } };

    test('an account younger than 7 days when it joins is a fake: excluded, never pending', () => {
        const decide = (createdAt, extra = {}) => { const { status, reason } = joinRecord({ memberId: MEMBER, found, createdAt, now: T0, ...extra }); return [status, reason]; };
        assert.deepEqual(decide(T0 - DAY), ['excluded', 'fake']);
        assert.deepEqual(decide(T0 - 7 * DAY + 1), ['excluded', 'fake']);
        assert.deepEqual(decide(T0 - 7 * DAY), ['pending', null]);
        assert.deepEqual(decide(null), ['pending', null], 'an unknown age is not called a fake');
        // The other exclusions are read first.
        assert.deepEqual(decide(T0, { rejoined: true }), ['excluded', 'rejoin']);
        assert.deepEqual(decide(T0, { memberId: INVITER }), ['excluded', 'self']);
        // The account's age: the user's, else read from its ID.
        assert.equal(accountCreatedAt({ id: MEMBER, user: { id: MEMBER, createdTimestamp: T0 } }), T0);
        assert.equal(accountCreatedAt({ id: MEMBER, user: { id: MEMBER } }), Date.UTC(2016, 6, 5, 21, 28, 35, 820));
    });

    test('a fake joining through a real invite is saved excluded, its notice says the invite does not count, and it never pays', async () => {
        let invites = [invite('abc', 2, INVITER)];
        const guild = fakeGuild({ list: () => invites });
        const client = fakeClient(guild, chatted(500));
        assert.equal(await primeGuild(guild), true);
        invites = [invite('abc', 3, INVITER)];
        const fresh = { ...joining(guild), user: { id: MEMBER, bot: false, createdTimestamp: T0 - 2 * DAY } };
        const result = await handleMemberJoin(fresh, client, { now: T0 });
        assert.deepEqual([result.status, result.record.status, result.record.reason, result.record.inviterId], ['saved', 'excluded', 'fake', INVITER]);
        assert.equal(inviteWelcomeNotice(MEMBER, result.join), `-# 📨 دعاه <@${INVITER}>\n-# ${WARNING} الدعوة دي مش محسوبة: الحساب عمره أقل من 7 أيام`);
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 9 })).status, 'done');
        assert.equal(await handleChatMessage(chat(client, 1), { now: T0 }), false, 'its messages are not counted');
        assert.equal(await balance(client, INVITER), 0);
    });

    test('the notice: who invited and the gift; a fake or a rejoin does not count; nothing for unknown, self or a bot', () => {
        const record = (extra = {}) => ({ ...pending(), ...extra });
        assert.equal(inviteWelcomeNotice(MEMBER, record()), [
            `-# 📨 دعاه <@${INVITER}>`,
            `-# 🎁 <@${INVITER}> هياخد **5,000** 🌀 CC لما <@${MEMBER}> يوصل لفل 5 ويكتب 50 رسالة`,
        ].join('\n'));
        assert.equal(inviteWelcomeNotice(MEMBER, record({ status: 'excluded', reason: 'rejoin' })), `-# 📨 دعاه <@${INVITER}>\n-# ${WARNING} الدعوة دي مش محسوبة: <@${MEMBER}> كان في السيرفر قبل كده`);
        for (const reason of ['unknown', 'ambiguous', 'vanity', 'no_inviter', 'self', 'bot_inviter']) {
            assert.equal(inviteWelcomeNotice(MEMBER, record({ status: 'excluded', reason })), null, reason);
        }
        assert.equal(inviteWelcomeNotice(MEMBER, record({ status: 'excluded', reason: 'unknown', inviterId: null })), null);
        assert.equal(inviteWelcomeNotice(MEMBER, record({ inviterId: MEMBER })), null, 'their own invite');
        assert.equal(inviteWelcomeNotice(MEMBER, null), null);
        assert.equal(inviteWelcomeNotice(MEMBER, record({ inviterId: 'abc' })), null, 'not a Discord ID');
    });

    test('a member saved before who joins again: the first record stays, and this join reads as a rejoin', async () => {
        let invites = [invite('abc', 1, INVITER), invite('xyz', 0, OTHER)];
        const guild = fakeGuild({ list: () => invites });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        assert.equal(await primeGuild(guild), true);
        invites = [invite('abc', 1, INVITER), invite('xyz', 1, OTHER)];
        const again = await handleMemberJoin(joining(guild), client, { now: T0 });
        assert.equal(again.status, 'kept');
        assert.equal(again.record.inviterId, INVITER);
        assert.deepEqual([again.join.status, again.join.reason, again.join.inviterId], ['excluded', 'rejoin', OTHER]);
        assert.match(inviteWelcomeNotice(MEMBER, again.join), /^-# 📨 دعاه <@200000000000000103>\n.*كان في السيرفر قبل كده$/u);
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending', 'nothing rewritten');
    });
});

describe('counting the invited member\'s chat messages', () => {
    test('only a member\'s own chat message counts: no bot, webhook, Discord notice, DM or other channel kind', () => {
        const client = fakeClient(fakeGuild());
        assert.equal(isChatMessage(chat(client, 1)), true);
        assert.equal(isChatMessage(chat(client, 1, { type: MessageType.Reply })), true);
        for (const channelType of [ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildVoice]) {
            assert.equal(isChatMessage(chat(client, 1, { channelType })), true, `channel type ${channelType}`);
        }
        assert.equal(isChatMessage(chat(client, 1, { bot: true })), false, 'a bot');
        assert.equal(isChatMessage(chat(client, 1, { webhookId: '500000000000000001' })), false, 'a webhook');
        assert.equal(isChatMessage(chat(client, 1, { system: true })), false, 'a system message');
        assert.equal(isChatMessage(chat(client, 1, { type: MessageType.UserJoin })), false, 'the join notice in their name');
        assert.equal(isChatMessage(chat(client, 1, { type: MessageType.GuildBoost })), false, 'a boost notice');
        assert.equal(isChatMessage(chat(client, 1, { channelType: ChannelType.DM })), false, 'a DM');
        assert.equal(isChatMessage({ ...chat(client, 1), guildId: null, guild: null }), false, 'no server');
    });

    test('counted in memory and written in batches: no write per message, one read and one write per member per flush', async () => {
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        assert.deepEqual(await chatMessages(client, 1, 10), Array(10).fill(true));
        assert.deepEqual(client.db.writes, [], 'nothing written yet');
        assert.deepEqual(client.db.reads, [getInviteRecordKey(GUILD, MEMBER), getChatCountKey(GUILD, MEMBER)], 'the record and the saved count, read once');
        assert.equal(unsavedChatMessages(GUILD, MEMBER), 10);
        assert.equal(await flushChatCounts(client), 1);
        assert.deepEqual(client.db.writes, [getChatCountKey(GUILD, MEMBER)]);
        assert.deepEqual(client.db.store.get(getChatCountKey(GUILD, MEMBER)), { count: 10, lastId: messageId(10) });
        assert.equal(await flushChatCounts(client), 0, 'nothing new: nothing written');
        assert.equal(client.db.writes.length, 1);
        assert.equal(await chatCount(client, GUILD, MEMBER), 10);
        // The count read for a payment includes what is not written yet (written first).
        await chatMessages(client, 11, 12);
        assert.equal(await chatCount(client, GUILD, MEMBER), 12);
        assert.equal(unsavedChatMessages(GUILD, MEMBER), 0);
    });

    test('a message is never counted twice: the same ID again, after it was written, or seen by a second bot process', async () => {
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        await chatMessages(client, 1, 3);
        assert.equal(await handleChatMessage(chat(client, 2), { now: T0 }), false, 'the same message again');
        await flushChatCounts(client);
        assert.equal(await handleChatMessage(chat(client, 3), { now: T0 }), false, 'already written');
        assert.deepEqual(client.db.store.get(getChatCountKey(GUILD, MEMBER)), { count: 3, lastId: messageId(3) });
        // A second process (a deploy) sees messages 2 to 5: only 4 and 5 are new.
        forgetChatCounts();
        forgetLevelMessages();
        assert.deepEqual(await chatMessages(client, 2, 5), [false, false, true, true]);
        await flushChatCounts(client);
        assert.deepEqual(client.db.store.get(getChatCountKey(GUILD, MEMBER)), { count: 5, lastId: messageId(5) });
        assert.equal(await countChatMessage(client, GUILD, MEMBER, 'not-an-id'), null);
    });

    test('only the members whose gift is pending, in a tracked server, with the gift on; also through messageCreate', async () => {
        const client = fakeClient(fakeGuild(), {
            [getInviteRecordKey(GUILD, MEMBER)]: pending(),
            [getInviteRecordKey(GUILD, OTHER)]: pending({ status: 'excluded', reason: 'rejoin' }),
            [getInviteRecordKey(GUILD, NEWCOMER)]: pending({ status: 'paid' }),
            [getInviteRecordKey(SCOPE, MEMBER)]: pending(),
        });
        assert.equal(await handleChatMessage(chat(client, 1, { author: OTHER }), { now: T0 }), false, 'an excluded invite');
        assert.equal(await handleChatMessage(chat(client, 2, { author: NEWCOMER }), { now: T0 }), false, 'paid already');
        assert.equal(await handleChatMessage(chat(client, 3, { author: INVITER }), { now: T0 }), false, 'nobody invited them');
        assert.equal(await handleChatMessage(chat(client, 4, { guildId: SCOPE }), { now: T0 }), false, 'a server without a level room');
        assert.equal(await handleChatMessage(chat(client, 5, { bot: true }), { now: T0 }), false, 'a bot');
        process.env.INVITE_REWARD_ENABLED = 'false';
        assert.equal(await handleChatMessage(chat(client, 6), { now: T0 }), false, 'the gift off');
        process.env.INVITE_REWARD_ENABLED = 'true';
        assert.equal(await handleChatMessage(chat(client, 7), { now: T0 }), true);
        // Through the event (in the background): the chat goes on to the games and commands as before.
        await messageCreate.execute(chat(client, 8), client);
        await new Promise((resolve) => { setImmediate(resolve); });
        assert.equal(unsavedChatMessages(GUILD, MEMBER), 2);
        await flushChatCounts(client);
        assert.deepEqual([...client.db.store.keys()].filter((key) => key.includes(':chat:')), [getChatCountKey(GUILD, MEMBER)]);
        assert.equal(client.db.store.get(getChatCountKey(GUILD, MEMBER)).count, 2);
    });

    test('the join noted by guildMemberAdd: the member\'s messages count at once, the record not read again', async () => {
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        noteInviteJoin({ id: MEMBER, guild: { id: GUILD } }, { status: 'saved', record: pending() }, { now: T0 });
        await chatMessages(client, 1, 1);
        assert.deepEqual(client.db.reads, [getChatCountKey(GUILD, MEMBER)]);
        noteInviteJoin({ id: OTHER, guild: { id: GUILD } }, { status: 'saved', record: pending({ status: 'excluded', reason: 'fake' }) }, { now: T0 });
        assert.equal(await handleChatMessage(chat(client, 2, { author: OTHER }), { now: T0 }), false);
    });
});

describe('the level and the 50 messages, in either order', () => {
    const member = { id: MEMBER, bot: false };
    const levelUp = (client, level = 5) => announcement(client, { content: `GG <@${MEMBER}>, you just advanced to level ${level}!`, mentions: [member] });
    const setup = (records = {}) => fakeClient(fakeGuild({ present: [INVITER] }), { [getInviteRecordKey(GUILD, MEMBER)]: pending(), ...records });
    const notice = new RegExp(`^🎁 <@${INVITER}> خدت \\*\\*5,000\\*\\* 🌀 CC هدية انفايت: <@${MEMBER}> اللي دعيته وصل لفل \\*\\*5\\*\\* وكتب \\*\\*50\\*\\* رسالة ・ رصيدك: \\*\\*5,000\\*\\* 🌀 CC$`, 'u');

    test('level 5 first: kept on the record; nothing until the 50th message, which pays once with a notice in the level room', async () => {
        const client = setup();
        await chatMessages(client, 1, 10);
        const five = levelUp(client);
        assert.equal(await handleLevelUpMessage(five, { now: T0 }), true);
        assert.equal(await balance(client, INVITER), 0, '10 messages: not yet');
        assert.deepEqual([five.replies.length, five.sent.length], [0, 0]);
        const waiting = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([waiting.status, waiting.level, waiting.levelAt], ['pending', 5, T0], 'the level is kept, the gift still pending');
        assert.equal((await payInviteReward(client, GUILD, MEMBER)).status, 'waiting');
        await chatMessages(client, 11, NEEDED - 1);
        assert.equal(await balance(client, INVITER), 0, '49 messages: not yet');
        assert.deepEqual(await chatMessages(client, NEEDED, NEEDED), [true]);
        assert.equal(await balance(client, INVITER), AMOUNT, 'the 50th message pays');
        const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([record.status, record.level, record.messages, record.amount], ['paid', 5, NEEDED, AMOUNT]);
        assert.equal(levelRoom(client).sent.length, 1);
        assert.match(levelRoom(client).sent[0].content, notice);
        assert.deepEqual(levelRoom(client).sent[0].allowedMentions, { users: [INVITER] });
        // More messages and a higher level: never again, and the member's messages are not counted any more.
        assert.deepEqual(await chatMessages(client, NEEDED + 1, NEEDED + 5), Array(5).fill(false));
        const six = levelUp(client, 6);
        await handleLevelUpMessage(six, { now: T0 });
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.deepEqual([levelRoom(client).sent.length, six.replies.length], [1, 0]);
        assert.equal(client.db.store.get(getEconomyKey(SCOPE, INVITER)).ccStats.earned, AMOUNT);
    });

    test('the 50 messages first: the level-up announcement pays at once', async () => {
        const client = setup();
        await chatMessages(client, 1, NEEDED + 3);
        assert.equal(await balance(client, INVITER), 0, 'no level yet');
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending');
        await handleLevelUpMessage(levelUp(client, 4), { now: T0 });
        assert.equal(await balance(client, INVITER), 0, 'level 4: not yet');
        const five = levelUp(client);
        assert.equal(await handleLevelUpMessage(five, { now: T0 }), true);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(five.replies.length, 1);
        assert.match(five.replies[0].content, notice);
        const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([record.status, record.level, record.messages], ['paid', 5, NEEDED + 3]);
        await chatMessages(client, NEEDED + 4, NEEDED + 4);
        await handleLevelUpMessage(levelUp(client, 7), { now: T0 });
        assert.equal(await balance(client, INVITER), AMOUNT, 'once');
        assert.equal(levelRoom(client).sent.length, 0);
    });

    test('the 50th message and the level-up at the same moment pay once', async () => {
        const client = setup();
        await chatMessages(client, 1, NEEDED - 1);
        const announced = levelUp(client);
        const results = await Promise.all([handleChatMessage(chat(client, NEEDED), { now: T0 }), handleLevelUpMessage(announced, { now: T0 })]);
        assert.deepEqual(results, [true, true]);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(client.db.store.get(getEconomyKey(SCOPE, INVITER)).ccStats.earned, AMOUNT);
        assert.equal(announced.replies.length + levelRoom(client).sent.length, 1, 'one notice');
    });

    test('a level kept by another bot process is found by a message 10 minutes later at most', async () => {
        const client = setup();
        await chatMessages(client, 1, NEEDED);
        const key = getInviteRecordKey(GUILD, MEMBER);
        client.db.store.set(key, { ...client.db.store.get(key), level: 5 });
        await chatMessages(client, NEEDED + 1, NEEDED + 1, { now: T0 + 60_000 });
        assert.equal(await balance(client, INVITER), 0, 'checked again only after 10 minutes');
        await chatMessages(client, NEEDED + 2, NEEDED + 2, { now: T0 + 10 * 60_000 });
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(client.db.store.get(key).messages, NEEDED + 2);
    });

    test('an inviter who left by the 50th message gets nothing, and the counting stops', async () => {
        const client = fakeClient(fakeGuild({ present: [] }), { [getInviteRecordKey(GUILD, MEMBER)]: pending({ level: 5 }), ...chatted(NEEDED - 1) });
        assert.deepEqual(await chatMessages(client, 1, 1), [true]);
        assert.equal(await balance(client, INVITER), 0);
        const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([record.status, record.reason], ['skipped', 'inviter_left']);
        assert.equal(levelRoom(client).sent.length, 0);
        assert.deepEqual(await chatMessages(client, 2, 3), [false, false]);
    });

    test('another server\'s messages, or another member\'s, never count for this one', async () => {
        const SECOND_ROOM = '400000000000000077';
        process.env.LEVEL_CHANNEL_IDS = `${DEFAULT_LEVEL_CHANNEL_ID},${SECOND_ROOM}`;
        const client = setup({ [getInviteRecordKey(SCOPE, MEMBER)]: pending(), ...chatted(NEEDED - 1) });
        client.channels.cache.set(SECOND_ROOM, room(SECOND_ROOM, SCOPE));
        client.guilds.cache.set(SCOPE, { ...fakeGuild({ present: [INVITER] }), id: SCOPE });
        assert.deepEqual(trackedGuildIds(client), new Set([GUILD, SCOPE]));
        // Level 5 and 49 messages in this server.
        await handleLevelUpMessage(levelUp(client), { now: T0 });
        assert.equal(await balance(client, INVITER), 0);
        // The member's messages in the other server count there only, and another member's nowhere.
        await chatMessages(client, 1, 5, { guildId: SCOPE });
        assert.deepEqual(await chatMessages(client, 6, 8, { author: OTHER }), [false, false, false]);
        assert.deepEqual([await chatCount(client, SCOPE, MEMBER), await chatCount(client, GUILD, MEMBER), await chatCount(client, GUILD, OTHER)], [5, NEEDED - 1, 0]);
        assert.equal(await balance(client, INVITER), 0);
        // One more here: paid here, announced in this server's level room; the other server's gift still waits.
        await chatMessages(client, 9, 9);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.deepEqual([levelRoom(client).sent.length, client.channels.cache.get(SECOND_ROOM).sent.length], [1, 0]);
        assert.deepEqual([client.db.store.get(getInviteRecordKey(SCOPE, MEMBER)).status, client.db.store.get(getInviteRecordKey(SCOPE, MEMBER)).level], ['pending', undefined]);
    });
});
