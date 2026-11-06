import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ChannelType, Collection } from 'discord.js';

process.env.BOURSE_GUILD_IDS = '*';
const { default: messageCreate } = await import('../src/events/messageCreate.js');
const { getEconomyKey, getGuildConfigKey } = await import('../src/utils/database/keys.js');
const {
    getStreakLeaderboard, publishStreakBoard, recordStreakMessage, resetStreakCache,
    sendDailyReminder, STREAK, STREAK_CHANNEL_ID, STREAK_GUILD_ID,
} = await import('../src/services/cc/streakService.js');

const scope = process.env.ECONOMY_SCOPE_ID;
const userId = '123456789012345678';
const walletKey = getEconomyKey(scope, userId);
const configKey = getGuildConfigKey(STREAK_GUILD_ID);
const now = Date.UTC(2026, 10, 6, 18);
const yesterday = '2026-11-05';

function setup(records = {}) {
    const store = new Map(Object.entries(records));
    const sent = [];
    const messages = new Collection();
    let next = Promise.resolve();
    const client = {
        user: { id: '223456789012345678' },
        commands: new Map(),
        db: {
            get: async (key, fallback) => structuredClone(store.has(key) ? store.get(key) : fallback),
            set: async (key, value) => { store.set(key, structuredClone(value)); return true; },
            list: async (prefix) => [...store.keys()].filter(key => key.startsWith(prefix)),
            transaction(task) {
                const result = next.then(task);
                next = result.catch(() => {});
                return result;
            },
        },
    };
    const guild = { id: STREAK_GUILD_ID, client };
    const channel = {
        id: STREAK_CHANNEL_ID,
        type: ChannelType.GuildText,
        guild,
        client,
        messages: { fetch: async (query) => typeof query === 'string' ? messages.get(query) : messages },
        send: async (payload) => {
            sent.push(payload);
            const message = { id: String(sent.length), author: client.user, ...payload };
            message.edit = async (updated) => Object.assign(message, updated);
            messages.set(message.id, message);
            return message;
        },
    };
    guild.channels = { cache: new Map([[channel.id, channel]]) };
    return { client, guild, channel, store, sent, messages };
}

beforeEach(() => { process.env.STREAK_ENABLED = 'true'; });
afterEach(() => {
    delete process.env.STREAK_ENABLED;
    resetStreakCache();
});

test('an imported streak continues with a single milestone reward and retains the wallet and holdings', async () => {
    const holdings = { sample: { qty: 2, cost: 150 } };
    const { client, store } = setup({
        [walletKey]: { cc: 300, ccStats: { earned: 100, spent: 4 }, ccBourse: holdings,
            ccStreak: { day: yesterday, count: 6, best: 8 } },
    });
    const results = await Promise.all([
        recordStreakMessage(client, STREAK_GUILD_ID, userId, now),
        recordStreakMessage(client, STREAK_GUILD_ID, userId, now),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.find(Boolean).bonus, 1250);
    assert.equal(store.get(walletKey).cc, 1550);
    assert.deepEqual(store.get(walletKey).ccStats, { earned: 1350, spent: 4 });
    assert.deepEqual(store.get(walletKey).ccBourse, holdings);
    assert.deepEqual(store.get(walletKey).ccStreak, { day: '2026-11-06', count: 7, best: 8 });
    resetStreakCache();
    assert.equal(await recordStreakMessage(client, STREAK_GUILD_ID, userId, now), null);
    assert.deepEqual(await getStreakLeaderboard(client, STREAK_GUILD_ID, now), [{ userId, count: 7, best: 8 }]);
});

test('only the pinned guild and room count a member’s image, with typed commands handled by CC bot', async () => {
    const { client, guild, channel, store, sent } = setup();
    const replies = [];
    const message = { guild, channel, channelId: channel.id, author: { id: userId },
        content: '', attachments: new Map([['image', { name: 'image.webp' }]]),
        reply: async (payload) => replies.push(payload.content), react: async () => {} };
    process.env.STREAK_ENABLED = 'false';
    await messageCreate.execute(message, client);
    process.env.STREAK_ENABLED = 'true';
    await messageCreate.execute({ ...message, guild: { id: scope } }, client);
    await messageCreate.execute({ ...message, channelId: '323456789012345678' }, client);
    await messageCreate.execute({ ...message, webhookId: '423456789012345678' }, client);
    assert.equal(store.has(walletKey), false);
    await messageCreate.execute({ ...message, content: 'كلام', attachments: new Map() }, client);
    assert.match(replies.at(-1), /الكلام مابيتحسبش/u);
    await messageCreate.execute(message, client);
    assert.equal(store.get(walletKey).cc, 250);
    await messageCreate.execute({ ...message, content: '!ستريك', attachments: new Map() }, client);
    assert.match(sent.at(-1).content, /ستريك.*\*\*1\*\* يوم/u);
});

test('the streak guide answers only its exact words and leaves the other typed words alone', async () => {
    const { client, guild, sent } = setup();
    const balances = [];
    client.commands.set('cc', { execute: async (interaction) => balances.push(interaction.user.id) });
    const otherChannel = { id: '323456789012345678', send: async (payload) => sent.push(payload) };
    const say = (content) => messageCreate.execute({ guild, channel: otherChannel, channelId: otherChannel.id,
        author: { id: userId }, content, attachments: new Map(), reply: async () => {} }, client);
    const guide = () => sent.at(-1)?.embeds?.[0]?.title === '🔥 شرح الستريك';

    for (const words of ['شرح ستريك', 'ستريك شرح', 'شرح الستريك', 'الستريك', 'streak help', 'STREAK HELP', '!شرح ستريك', '! الستريك']) {
        sent.length = 0;
        await say(words);
        assert.equal(sent.length, 1, words);
        assert.ok(guide(), words);
        assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    }
    const text = sent[0].embeds[0].description;
    assert.match(text, new RegExp(`<#${STREAK_CHANNEL_ID}>`, 'u'));
    assert.match(text, /صورة أو GIF.*الكلام مابيتحسبش/u);
    assert.match(text, /يرجع من 1/u);
    assert.match(text, /`ستريك`.*`توب ستريك`/u);
    for (const [day, cc] of Object.entries(STREAK.milestones)) assert.ok(text.includes(`${day} يوم = **${cc.toLocaleString('en-US')}** CC`));

    // Numbers come from STREAK, so changing a constant changes the guide.
    const saved = { ...STREAK };
    try {
        Object.assign(STREAK, { base: 400, raiseEvery: 5, raiseBy: 75, cap: 2500 });
        await say('شرح ستريك');
        assert.match(sent.at(-1).embeds[0].description, /\*\*400\*\* CC، وكل 5 أيام بتزيد \*\*75\*\* لحد \*\*2,500\*\* CC/u);
    } finally { Object.assign(STREAK, saved); }

    sent.length = 0;
    for (const chat of ['شرح ستريك لو سمحت', 'عايز شرح الستريك', 'الستريك ده حلو', 'streak help me', 'شرح البوت لو سمحت']) await say(chat);
    assert.equal(sent.length, 0);

    await say('ستريك');
    assert.match(sent.at(-1).content, /معندوش ستريك/u);
    await say(`الستريك <@${userId}>`);
    assert.match(sent.at(-1).content, /معندوش ستريك/u);
    await say('توب ستريك');
    assert.equal(sent.at(-1).embeds[0].title, '🔥 Top Streak');
    await say('شرح');
    assert.equal(sent.at(-1).embeds[0].title, '🌀 شرح CC bot');
    await say('رصيد');
    assert.deepEqual(balances, [userId]);

    process.env.STREAK_ENABLED = 'false';
    sent.length = 0;
    await say('شرح ستريك');
    assert.equal(sent.length, 0);
});

test('the live board survives a refresh and the imported reminder prevents a duplicate', async () => {
    const { guild, store, sent, messages } = setup({
        [walletKey]: { cc: 250, ccStreak: { day: yesterday, count: 1, best: 1 } },
        [configKey]: { streakReminderDay: '2026-11-06', traderRoleId: 'role' },
    });
    assert.equal((await publishStreakBoard(guild)).status, 'sent');
    assert.equal((await publishStreakBoard(guild)).status, 'updated');
    assert.equal(messages.size, 1);
    assert.equal(store.get(configKey).traderRoleId, 'role');
    assert.equal(await sendDailyReminder(guild, now), false);
    const nextDay = now + 24 * 60 * 60 * 1000;
    assert.deepEqual((await Promise.all([sendDailyReminder(guild, nextDay), sendDailyReminder(guild, nextDay)])).sort(), [false, true]);
    assert.equal(sent.length, 2);
});
