// The welcome line of every server (src/services/welcomeService.js, src/config/welcome.js, src/events/guildMemberAdd.js):
// `welcome to <the server's own name> @member 👋` with the name escaped and only the member pinged, the channel chosen
// in order (the one set for the server, its system channel, a text channel named welcome; only where the bot can
// post), bots and other servers left out, WELCOME_ENABLED (off by default: Aether welcomes), and the bot's own wave
// emoji. Never anything about the invite (GH #329): Aether's welcome says who invited the member and the gift, while
// this bot still tracks the invite (the record saved, the member's messages counted).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ChannelType, GatewayIntentBits, GuildMemberFlags, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_LEVEL_CHANNEL_ID } from '../src/config/invites.js';
import {
    CHAOS_GUILD_ID, DEFAULT_WELCOME_CHANNELS, ZENITH_GUILD_ID, validateWelcomeConfig, welcomeChannelMap, welcomeChannelSetting, welcomeEnabled,
} from '../src/config/welcome.js';
import guildMemberAdd from '../src/events/guildMemberAdd.js';
import { forgetChatCounts } from '../src/services/cc/chatCounter.js';
import { forgetInvites, primeGuild } from '../src/services/cc/inviteTracker.js';
import { forgetLevelMessages, handleChatMessage } from '../src/services/cc/inviteRewardService.js';
import {
    WELCOME_EMOJI_FALLBACK, canWelcomeIn, escapeGuildName, forgetWelcomeWarnings, startWelcome, welcomeChannel, welcomeEmoji, welcomeMember, welcomeText,
} from '../src/services/welcomeService.js';
import { getChatCountKey, getInviteRecordKey } from '../src/utils/database/keys.js';

const GUILD = '100000000000000002';
const SECOND = '100000000000000001';
const NOT_ALLOWED = '100000000000000003';
const BOT = '200000000000000900';
const INVITER = '200000000000000101';
const MEMBER = '200000000000000102';
const OTHER = '200000000000000103';
const WELCOME = '400000000000000001';
const SYSTEM = '400000000000000002';
const CHAOS_WELCOME = DEFAULT_WELCOME_CHANNELS[CHAOS_GUILD_ID];
const ZENITH_WELCOME = DEFAULT_WELCOME_CHANNELS[ZENITH_GUILD_ID];

/** A channel that keeps what is sent in it; `open` = the bot may view it and send in it. */
function channel(id, { type = ChannelType.GuildText, name = 'general', rawPosition = 0, open = true, fail = false } = {}) {
    const sent = [];
    return {
        id, type, name, rawPosition, sent,
        permissionsFor: (who) => ({
            has: (bits) => open && who?.id === BOT && [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages].every((bit) => bits.includes(bit)),
        }),
        async send(payload) {
            if (fail) throw Object.assign(new Error('Missing Access'), { code: 50001 });
            sent.push(payload);
            return { id: `${id}:${sent.length}`, ...payload };
        },
    };
}
/** A server with `channels` in its cache, `fetchable` ones only through fetch, and the bot as `members.me`. */
function server({ id = GUILD, name = 'CHAOS', channels = [], systemChannelId = null, fetchable = [], extra = {} } = {}) {
    const cache = new Map(channels.map((item) => [item.id, item]));
    return {
        id, name, systemChannelId,
        get systemChannel() { return systemChannelId ? cache.get(systemChannelId) ?? null : null; },
        channels: {
            cache,
            async fetch(channelId) {
                const found = fetchable.find((item) => item.id === channelId);
                if (!found) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
                return found;
            },
        },
        members: { me: { id: BOT } },
        ...extra,
    };
}
const joiner = (guild, id = MEMBER, { bot = false, createdTimestamp = Date.UTC(2020, 0, 1), rejoined = false } = {}) => ({
    id, guild, user: { id, bot, createdTimestamp }, flags: { bitfield: rejoined ? GuildMemberFlags.DidRejoin : 0 },
});
const at = (guildId, channelId) => ({ WELCOME_CHANNEL_IDS: `${guildId}:${channelId}`, WELCOME_ENABLED: 'true' });
/** Nothing this bot sends may tell the invite: who invited, the gift, or that it doesn't count (Aether does, GH #329). */
const INVITE_WORDS = /📨|🎁|دعاه|هياخد|مش محسوبة|<@200000000000000101>/u;

afterEach(() => {
    forgetWelcomeWarnings();
    forgetInvites();
    forgetLevelMessages();
    forgetChatCounts();
    delete process.env.WELCOME_ENABLED;
    process.env.INVITE_REWARD_ENABLED = 'true'; // the tests' baseline (tests/env.js)
});

describe('the configuration', () => {
    test('off unless switched on; CHAOS and Zenith have their channels; pairs on top of them; checked at start', () => {
        assert.equal(welcomeEnabled({}), false);
        assert.equal(welcomeEnabled({ WELCOME_ENABLED: 'true' }), true);
        for (const off of ['false', 'FALSE', ' 0 ', 'off', 'no']) assert.equal(welcomeEnabled({ WELCOME_ENABLED: off }), false, off);
        assert.deepEqual(DEFAULT_WELCOME_CHANNELS, { '1155236281706627173': '1547305745417113700', '1569932761471524874': '1570728122259611779' });
        assert.deepEqual([...welcomeChannelMap({})], [[CHAOS_GUILD_ID, CHAOS_WELCOME], [ZENITH_GUILD_ID, ZENITH_WELCOME]]);
        const env = { WELCOME_CHANNEL_IDS: `${GUILD}:${WELCOME}, ${ZENITH_GUILD_ID}:OFF,${CHAOS_GUILD_ID}:${SYSTEM}` };
        assert.equal(welcomeChannelSetting(GUILD, env), WELCOME);
        assert.equal(welcomeChannelSetting(ZENITH_GUILD_ID, env), 'off');
        assert.equal(welcomeChannelSetting(CHAOS_GUILD_ID, env), SYSTEM);
        assert.equal(welcomeChannelSetting(SECOND, env), null, 'none set: the fallbacks');
        assert.equal(welcomeChannelSetting(CHAOS_GUILD_ID, {}), CHAOS_WELCOME);
        assert.doesNotThrow(() => validateWelcomeConfig({}));
        assert.doesNotThrow(() => validateWelcomeConfig(env));
        for (const bad of ['abc', `${GUILD}`, `${GUILD}:abc`, `1:${WELCOME}`, `${GUILD}:${WELCOME}:1`, `${GUILD}:`]) {
            assert.throws(() => validateWelcomeConfig({ WELCOME_CHANNEL_IDS: bad }), /WELCOME_CHANNEL_IDS/u, bad);
        }
    });
});

describe('the welcome text', () => {
    test('each server\'s own name, the member, the wave', () => {
        assert.equal(welcomeText('CHAOS', MEMBER), `welcome to CHAOS <@${MEMBER}> 👋`);
        assert.equal(welcomeText('Zenith', MEMBER), `welcome to Zenith <@${MEMBER}> 👋`);
        assert.equal(welcomeText('سيرفر الأصحاب', OTHER), `welcome to سيرفر الأصحاب <@${OTHER}> 👋`);
        assert.equal(welcomeText('CHAOS', MEMBER, '<a:smileywave:600000000000000001>'), `welcome to CHAOS <@${MEMBER}> <a:smileywave:600000000000000001>`);
    });

    test('the server\'s name is escaped: no markdown, mention, emoji or @everyone from it', () => {
        assert.equal(escapeGuildName('**Zen_ith** ~~x~~ ||s|| `c`'), String.raw`\*\*Zen\_ith\*\* \~\~x\~\~ \|\|s\|\| \`c\``);
        assert.equal(escapeGuildName(String.raw`@everyone <@200000000000000101> <:e:600000000000000001> [link](https://x.y) a\b`), String.raw`\@everyone \<\@200000000000000101> \<:e:600000000000000001> \[link](https://x.y) a\\b`);
        assert.equal(escapeGuildName('CHAOS'), 'CHAOS');
        assert.equal(escapeGuildName(undefined), '');
    });

    test('the wave: the bot\'s own smileywave emoji when it has one, else 👋', () => {
        assert.equal(WELCOME_EMOJI_FALLBACK, '👋');
        assert.equal(welcomeEmoji(null), '👋');
        assert.equal(welcomeEmoji({ application: { emojis: { cache: [] } } }), '👋');
        const own = { name: 'smileywave', toString: () => '<a:smileywave:600000000000000001>' };
        assert.equal(welcomeEmoji({ application: { emojis: { cache: [{ name: 'other' }, own] } } }), '<a:smileywave:600000000000000001>');
    });
});

describe('the welcome channel', () => {
    test('CHAOS and Zenith: their own welcome channels, before the system channel', async () => {
        const chaosRoom = channel(CHAOS_WELCOME);
        const chaos = server({ id: CHAOS_GUILD_ID, channels: [channel(SYSTEM), chaosRoom], systemChannelId: SYSTEM });
        assert.equal(await welcomeChannel(chaos, { env: {} }), chaosRoom);
        const zenithRoom = channel(ZENITH_WELCOME);
        const zenith = server({ id: ZENITH_GUILD_ID, name: 'Zenith', channels: [zenithRoom, channel(SYSTEM, { name: 'welcome' })], systemChannelId: SYSTEM });
        assert.equal(await welcomeChannel(zenith, { env: {} }), zenithRoom);
        // Not in the cache: fetched.
        const fetched = channel(CHAOS_WELCOME);
        assert.equal(await welcomeChannel(server({ id: CHAOS_GUILD_ID, fetchable: [fetched] }), { env: {} }), fetched);
        // WELCOME_CHANNEL_IDS changes it, or turns it off.
        const other = channel(WELCOME);
        assert.equal(await welcomeChannel(server({ id: CHAOS_GUILD_ID, channels: [chaosRoom, other] }), { env: at(CHAOS_GUILD_ID, WELCOME) }), other);
        assert.equal(await welcomeChannel(server({ id: CHAOS_GUILD_ID, channels: [chaosRoom, channel(SYSTEM)], systemChannelId: SYSTEM }), { env: at(CHAOS_GUILD_ID, 'off') }), null);
    });

    test('the order: the channel set, else the system channel, else a text channel named welcome; only where the bot can post', async () => {
        const system = channel(SYSTEM);
        const exact = channel('400000000000000010', { name: '👋・welcome', rawPosition: 9 });
        const partial = channel('400000000000000011', { name: 'welcome-chat', rawPosition: 1 });
        const voice = channel('400000000000000012', { name: 'welcome', type: ChannelType.GuildVoice });
        // Set, but closed to the bot: the system channel.
        assert.equal(await welcomeChannel(server({ channels: [channel(WELCOME, { open: false }), system], systemChannelId: SYSTEM }), { env: at(GUILD, WELCOME) }), system);
        // Set, but gone: the system channel.
        assert.equal(await welcomeChannel(server({ channels: [system], systemChannelId: SYSTEM }), { env: at(GUILD, WELCOME) }), system);
        // Nothing set: the system channel.
        assert.equal(await welcomeChannel(server({ channels: [exact, system], systemChannelId: SYSTEM }), { env: {} }), system);
        // No usable system channel: `welcome` by name (the exact name first), never a voice channel.
        assert.equal(await welcomeChannel(server({ channels: [voice, partial, exact, channel(SYSTEM, { open: false })], systemChannelId: SYSTEM }), { env: {} }), exact);
        assert.equal(await welcomeChannel(server({ channels: [voice, partial, channel('400000000000000013', { name: 'welcome', open: false })] }), { env: {} }), partial);
        // Nothing usable at all.
        assert.equal(await welcomeChannel(server({ channels: [voice, channel('400000000000000014', { name: 'general' })] }), { env: {} }), null);
        assert.equal(await welcomeChannel(server({ channels: [exact], extra: { members: { me: null } } }), { env: {} }), null, 'the bot\'s own member unknown');
        assert.equal(canWelcomeIn(channel(WELCOME, { type: ChannelType.GuildAnnouncement }), { id: BOT }), true);
        assert.equal(canWelcomeIn(channel(WELCOME, { type: ChannelType.PublicThread }), { id: BOT }), false);
        assert.equal(canWelcomeIn(null, { id: BOT }), false);
    });
});

describe('welcoming a member', () => {
    beforeEach(() => { process.env.WELCOME_ENABLED = 'true'; });
    test('the welcome line alone, only the member pinged: no invite notice under it (GH #329)', async () => {
        const room = channel(WELCOME);
        const guild = server({ name: 'CHAOS', channels: [room] });
        const result = await welcomeMember(joiner(guild), {}, { env: at(GUILD, WELCOME) });
        assert.deepEqual(result, { status: 'sent', channelId: WELCOME });
        assert.deepEqual(room.sent, [{ content: `welcome to CHAOS <@${MEMBER}> 👋`, allowedMentions: { users: [MEMBER] } }]);
    });

    test('every server in its own name', async () => {
        const first = channel(WELCOME);
        const second = channel(SYSTEM);
        const env = { WELCOME_CHANNEL_IDS: `${GUILD}:${WELCOME},${SECOND}:${SYSTEM}`, WELCOME_ENABLED: 'true' };
        await welcomeMember(joiner(server({ id: GUILD, name: 'CHAOS', channels: [first] })), {}, { env });
        await welcomeMember(joiner(server({ id: SECOND, name: 'Zenith', channels: [second] }), OTHER), {}, { env });
        assert.deepEqual([first.sent[0].content, second.sent[0].content], [`welcome to CHAOS <@${MEMBER}> 👋`, `welcome to Zenith <@${OTHER}> 👋`]);
        // A server with nothing set and no system channel: its `welcome` channel.
        const named = channel('400000000000000020', { name: 'welcome' });
        await welcomeMember(joiner(server({ id: SECOND, name: '**Zen**', channels: [named] })), {}, { env: { WELCOME_ENABLED: 'true' } });
        assert.equal(named.sent[0].content, String.raw`welcome to \*\*Zen\*\* <@200000000000000102> 👋`);
    });

    test('nothing for a bot, with WELCOME_ENABLED off (the default), in a server the bot does not serve, or without a channel', async () => {
        const room = channel(WELCOME);
        const guild = server({ channels: [room] });
        assert.equal((await welcomeMember(joiner(guild, BOT, { bot: true }), {}, { env: at(GUILD, WELCOME) })).status, 'bot');
        assert.equal((await welcomeMember(joiner(guild), {}, { env: { ...at(GUILD, WELCOME), WELCOME_ENABLED: 'false' } })).status, 'disabled');
        assert.equal((await welcomeMember(joiner(guild), {}, { env: { WELCOME_CHANNEL_IDS: `${GUILD}:${WELCOME}` } })).status, 'disabled', 'off unless switched on');
        assert.equal((await welcomeMember(joiner(server({ id: NOT_ALLOWED, channels: [room] })), {}, { env: at(NOT_ALLOWED, WELCOME) })).status, 'not_allowed');
        assert.equal((await welcomeMember(joiner(server({ channels: [] })), {}, { env: { WELCOME_ENABLED: 'true' } })).status, 'no_channel');
        assert.equal((await welcomeMember(null, {}, { env: {} })).status, 'not_allowed');
        assert.equal(room.sent.length, 0);
    });

    test('a welcome that could not be sent never throws', async () => {
        const room = channel(WELCOME, { fail: true });
        const result = await welcomeMember(joiner(server({ channels: [room] })), {}, { env: at(GUILD, WELCOME) });
        assert.deepEqual(result, { status: 'failed', channelId: WELCOME });
        assert.equal(room.sent.length, 0);
    });

    test('the bot\'s own wave emoji in the welcome', async () => {
        const room = channel(WELCOME);
        const client = { application: { emojis: { cache: [{ name: 'smileywave', toString: () => '<a:smileywave:600000000000000001>' }] } } };
        await welcomeMember(joiner(server({ channels: [room] })), client, { env: at(GUILD, WELCOME) });
        assert.equal(room.sent[0].content, `welcome to CHAOS <@${MEMBER}> <a:smileywave:600000000000000001>`);
    });
});

describe('guildMemberAdd', () => {
    beforeEach(() => { process.env.WELCOME_ENABLED = 'true'; });
    function fakeDb(records = {}) {
        const store = new Map(Object.entries(records));
        const reads = [];
        return {
            store, reads,
            get: async (key, fallback = null) => { reads.push(key); return store.has(key) ? structuredClone(store.get(key)) : fallback; },
            set: async (key, value) => { store.set(key, structuredClone(value)); return true; },
        };
    }
    /** A tracked server (the level room is in it) with invites and a welcome channel. */
    function setup() {
        let invites = [{ code: 'abc', uses: 1, maxUses: 0, inviter: { id: INVITER, bot: false } }];
        const room = channel(WELCOME);
        const guild = server({
            name: 'CHAOS', channels: [room],
            extra: { vanityURLCode: null, invites: { async fetch() { return new Map(invites.map((item) => [item.code, item])); } } },
        });
        const client = {
            db: fakeDb(),
            channels: { cache: new Map([[DEFAULT_LEVEL_CHANNEL_ID, { id: DEFAULT_LEVEL_CHANNEL_ID, guildId: GUILD }]]) },
            guilds: { cache: new Map([[GUILD, guild]]) },
        };
        return { guild, room, client, use: () => { invites = [{ ...invites[0], uses: invites[0].uses + 1 }]; } };
    }

    test('a member joining through an invite: the welcome line alone, no invite notice; the record saved; their messages counted', async () => {
        process.env.WELCOME_CHANNEL_IDS = `${GUILD}:${WELCOME}`;
        try {
            const { guild, room, client, use } = setup();
            assert.equal(await primeGuild(guild), true);
            use();
            await guildMemberAdd.execute(joiner(guild), client);
            assert.deepEqual(room.sent.map((payload) => payload.content), [`welcome to CHAOS <@${MEMBER}> 👋`]);
            assert.deepEqual(room.sent[0].allowedMentions, { users: [MEMBER] });
            assert.equal(client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, 'pending');
            // The join was noted: the first message counts without reading the record again.
            client.db.reads.length = 0;
            const message = { id: '300000000000000001', guildId: GUILD, guild, client, type: 0, author: { id: MEMBER, bot: false }, channel: { type: ChannelType.GuildText } };
            assert.equal(await handleChatMessage(message), true);
            assert.deepEqual(client.db.reads, [getChatCountKey(GUILD, MEMBER)]);
            // A bot joining: nothing.
            use();
            await guildMemberAdd.execute(joiner(guild, BOT, { bot: true }), client);
            assert.equal(room.sent.length, 1);
            assert.equal(client.db.store.has(getInviteRecordKey(GUILD, BOT)), false);
        } finally {
            delete process.env.WELCOME_CHANNEL_IDS;
        }
    });

    test('the invite gift off: the welcome alone, nothing tracked', async () => {
        process.env.WELCOME_CHANNEL_IDS = `${GUILD}:${WELCOME}`;
        process.env.INVITE_REWARD_ENABLED = 'false';
        try {
            const { guild, room, client, use } = setup();
            use();
            await guildMemberAdd.execute(joiner(guild), client);
            assert.deepEqual(room.sent.map((payload) => payload.content), [`welcome to CHAOS <@${MEMBER}> 👋`]);
            assert.equal(client.db.store.size, 0);
        } finally {
            delete process.env.WELCOME_CHANNEL_IDS;
        }
    });

    test('WELCOME_ENABLED off (production: Aether welcomes): nothing posted at all, the invite still tracked (GH #329)', async () => {
        process.env.WELCOME_CHANNEL_IDS = `${GUILD}:${WELCOME}`;
        for (const setting of ['false', undefined]) {
            if (setting === undefined) delete process.env.WELCOME_ENABLED;
            else process.env.WELCOME_ENABLED = setting;
            forgetInvites();
            try {
                const { guild, room, client, use } = setup();
                assert.equal(await primeGuild(guild), true);
                use();
                await guildMemberAdd.execute(joiner(guild), client);
                assert.equal(room.sent.length, 0, `WELCOME_ENABLED=${setting}`);
                const record = client.db.store.get(getInviteRecordKey(GUILD, MEMBER));
                assert.deepEqual([record.status, record.inviterId, record.code], ['pending', INVITER, 'abc']);
                // The member's messages are counted for the gift at once.
                client.db.reads.length = 0;
                const message = { id: '300000000000000002', guildId: GUILD, guild, client, type: 0, author: { id: MEMBER, bot: false }, channel: { type: ChannelType.GuildText } };
                assert.equal(await handleChatMessage(message), true);
            } finally {
                forgetLevelMessages();
                forgetChatCounts();
            }
        }
        delete process.env.WELCOME_CHANNEL_IDS;
    });

    test('a fake account or a rejoin: saved as no gift, and nothing about it posted', async () => {
        process.env.WELCOME_CHANNEL_IDS = `${GUILD}:${WELCOME}`;
        try {
            const cases = [
                ['fake', (guild) => joiner(guild, MEMBER, { createdTimestamp: Date.now() - 24 * 60 * 60_000 })],
                ['rejoin', (guild) => joiner(guild, MEMBER, { rejoined: true })],
            ];
            for (const [reason, make] of cases) {
                forgetInvites();
                const { guild, room, client, use } = setup();
                assert.equal(await primeGuild(guild), true);
                use();
                await guildMemberAdd.execute(make(guild), client);
                assert.deepEqual([client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).status, client.db.store.get(getInviteRecordKey(GUILD, MEMBER)).reason], ['excluded', reason]);
                assert.deepEqual(room.sent.map((payload) => payload.content), [`welcome to CHAOS <@${MEMBER}> 👋`], reason);
                for (const payload of room.sent) assert.doesNotMatch(payload.content, INVITE_WORDS);
            }
        } finally {
            delete process.env.WELCOME_CHANNEL_IDS;
        }
    });

    test('WELCOME_ENABLED=false and INVITE_REWARD_ENABLED=false: nothing sent in the room', async () => {
        process.env.WELCOME_CHANNEL_IDS = `${GUILD}:${WELCOME}`;
        process.env.WELCOME_ENABLED = 'false';
        process.env.INVITE_REWARD_ENABLED = 'false';
        try {
            const { guild, room, client, use } = setup();
            use();
            await guildMemberAdd.execute(joiner(guild), client);
            assert.equal(room.sent.length, 0);
        } finally {
            delete process.env.WELCOME_CHANNEL_IDS;
        }
    });
});

describe('starting the welcome', () => {
    beforeEach(() => { process.env.WELCOME_ENABLED = 'true'; });
    test('reads the bot\'s own emojis (never uploads one), warns without the Server Members Intent, never throws', async () => {
        const items = [];
        let created = 0;
        const emojis = {
            cache: { find: (fn) => items.find(fn) },
            async fetch() { items.push({ name: 'smileywave', toString: () => '<a:smileywave:600000000000000001>' }); return this.cache; },
            async create() { created += 1; },
        };
        const client = { options: { intents: { has: (bit) => bit !== GatewayIntentBits.GuildMembers } }, application: { emojis } };
        assert.deepEqual(await startWelcome(client), { status: 'ok', emoji: '<a:smileywave:600000000000000001>' });
        assert.equal(created, 0);
        const offline = { application: { emojis: { cache: [], fetch: async () => { throw new Error('offline'); } } } };
        assert.deepEqual(await startWelcome(offline), { status: 'ok', emoji: '👋' });
        assert.deepEqual(await startWelcome({}), { status: 'ok', emoji: '👋' });
        process.env.WELCOME_ENABLED = 'false';
        assert.deepEqual(await startWelcome(client), { status: 'disabled' });
    });
});
