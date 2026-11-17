// The invite gift (src/services/cc/inviteTracker.js, inviteRewardService.js): which invite a joining member used, the
// exclusions (self, bots, rejoins, vanity, unknown), reading only real level-up announcements of exactly one member
// in Arabic and English (never rank cards, leaderboards, level lists or messages naming two members), paying the
// inviter CC.inviteReward.amount exactly once through updateCCState (outside the games' daily cap), and the inviter
// who left.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { GatewayIntentBits, GuildMemberFlags } from 'discord.js';
import { createSnapshot } from '../scripts/lib/bourseBackup.js';
import { CC } from '../src/config/cc.js';
import { DEFAULT_LEVEL_BOT_ID, DEFAULT_LEVEL_CHANNEL_ID, levelBotIds, levelChannelIds, inviteRewardEnabled, validateInviteConfig } from '../src/config/invites.js';
import messageCreate from '../src/events/messageCreate.js';
import { getProfile, updateCCState } from '../src/services/cc/ccService.js';
import {
    cachedInvites, didRejoin, findUsedInvite, forgetInvites, handleMemberJoin, inviteIntents, joinRecord, membersIntentAllowed,
    onInviteCreate, onInviteDelete, primeGuild, startInviteTracking, trackedGuildIds,
} from '../src/services/cc/inviteTracker.js';
import {
    forgetLevelMessages, handleLevelUpMessage, parseLevel, parseLevelUp, payInviteReward,
} from '../src/services/cc/inviteRewardService.js';
import { getEconomyKey, getInviteRecordKey } from '../src/utils/database/keys.js';

const GUILD = '100000000000000002';
const SCOPE = '100000000000000001';
const INVITER = '200000000000000101';
const MEMBER = '200000000000000102';
const OTHER = '200000000000000103';
const NEWCOMER = '200000000000000104';
const SOME_BOT = '200000000000000109';
const T0 = Date.UTC(2026, 10, 16, 12);
const AMOUNT = CC.inviteReward.amount;

function fakeDb(records = {}) {
    const store = new Map(Object.entries(records));
    return {
        store,
        get: async (key, fallback = null) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
        set: async (key, value) => { store.set(key, structuredClone(value)); return true; },
        list: async (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)),
    };
}
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
function fakeClient(guild, records = {}) {
    return {
        db: fakeDb(records),
        channels: { cache: new Map([[DEFAULT_LEVEL_CHANNEL_ID, { id: DEFAULT_LEVEL_CHANNEL_ID, guildId: GUILD }]]) },
        guilds: { cache: new Map(guild ? [[GUILD, guild]] : []) },
        options: { intents: { has: () => true } },
    };
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
    for (const key of ['LEVEL_BOT_IDS', 'LEVEL_CHANNEL_IDS']) delete process.env[key];
    process.env.INVITE_REWARD_ENABLED = 'true'; // the tests' baseline (tests/env.js)
});

describe('the configuration', () => {
    test('5000 CC at level 5, the level bot and room by default, overridable, checked at start', () => {
        assert.deepEqual(CC.inviteReward, { amount: 5000, level: 5 });
        assert.deepEqual([...levelBotIds()], ['1513858357142880346']);
        assert.deepEqual([...levelChannelIds()], ['1571798045580984360']);
        assert.deepEqual([...levelBotIds({ LEVEL_BOT_IDS: '300000000000000001, 300000000000000002' })], ['300000000000000001', '300000000000000002']);
        assert.doesNotThrow(() => validateInviteConfig({}));
        assert.throws(() => validateInviteConfig({ LEVEL_CHANNEL_IDS: 'abc' }), /LEVEL_CHANNEL_IDS/u);
        // The backups accept the new records.
        assert.doesNotThrow(() => createSnapshot([{ key: getInviteRecordKey(GUILD, MEMBER), value: pending(), updatedAt: new Date(T0).toISOString() }]));
    });

    test('the Server Members Intent is asked only when the portal switch is on; the feature can be turned off', async () => {
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
        process.env.INVITE_REWARD_ENABLED = 'false';
        assert.deepEqual(await inviteIntents('t', { rest: rest(1 << 14) }), []);
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
    const setup = () => {
        const guild = fakeGuild({ present: [INVITER] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending(), [getInviteRecordKey(GUILD, OTHER)]: pending() });
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
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        await updateCCState(client, GUILD, INVITER, (state) => { state.cc = 100; });
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 4 }), { status: 'low' });
        const [first, second] = await Promise.all([
            payInviteReward(client, GUILD, MEMBER, { level: 5, now: T0 }),
            payInviteReward(client, GUILD, MEMBER, { level: 5, now: T0 }),
        ]);
        assert.deepEqual([first.status, second.status].sort(), ['done', 'paid']);
        const paid = first.status === 'paid' ? first : second;
        assert.deepEqual(paid, { status: 'paid', inviterId: INVITER, amount: AMOUNT, balance: 100 + AMOUNT });
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 9 })).status, 'done');
        assert.equal(await balance(client, INVITER), 100 + AMOUNT);
        assert.equal(await balance(client, MEMBER), 0, 'the invited member gets nothing');
        const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
        assert.deepEqual([record.status, record.level, record.amount, record.paidAt], ['paid', 5, AMOUNT, T0]);
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
        const client = fakeClient(fakeGuild(), { [getInviteRecordKey(GUILD, MEMBER)]: pending(), [getInviteRecordKey(GUILD, OTHER)]: pending() });
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 5, presence: async () => 'unknown' }), { status: 'retry', inviterId: INVITER });
        assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending');
        assert.deepEqual(await payInviteReward(client, GUILD, MEMBER, { level: 5, presence: async () => 'left' }), { status: 'skipped', reason: 'inviter_left', inviterId: INVITER });
        assert.equal((await payInviteReward(client, GUILD, MEMBER, { level: 6, presence: async () => 'present' })).status, 'done', 'coming back later changes nothing');
        assert.equal((await payInviteReward(client, GUILD, OTHER, { level: 5, presence: async () => 'bot' })).reason, 'bot_inviter');
        assert.equal(await balance(client, INVITER), 0);
    });

    test('the level bot\'s announcement in its room pays and answers once; other bots, rooms and lower levels do not', async () => {
        const guild = fakeGuild({ present: [INVITER] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
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
        assert.match(five.replies[0].content, new RegExp(`^🎁 <@${INVITER}> خدت \\*\\*5,000\\*\\* 🌀 CC هدية انفايت: <@${MEMBER}> اللي دعيته وصل لفل \\*\\*5\\*\\*`, 'u'));
        assert.deepEqual(five.replies[0].allowedMentions, { users: [INVITER], repliedUser: false });
        // The same message edited, through the event, and a later level: nothing more.
        assert.equal(await handleLevelUpMessage(five), true);
        await messageCreate.execute(announcement(client, { content: `<@${MEMBER}> reached level 6`, mentions: [member] }), client);
        assert.equal(await balance(client, INVITER), AMOUNT);
        assert.equal(five.replies.length, 1);
    });

    test('the inviter who left the server gets nothing and no notice', async () => {
        const guild = fakeGuild({ present: [] });
        const client = fakeClient(guild, { [getInviteRecordKey(GUILD, MEMBER)]: pending() });
        const message = announcement(client, { content: `<@${MEMBER}> has reached level **5**`, mentions: [{ id: MEMBER, bot: false }] });
        assert.equal(await handleLevelUpMessage(message), true);
        assert.equal(await balance(client, INVITER), 0);
        assert.deepEqual([message.replies.length, message.sent.length], [0, 0]);
        assert.deepEqual([client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).reason], ['skipped', 'inviter_left']);
    });
});
