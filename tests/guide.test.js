import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

process.env.BOURSE_GUILD_IDS = '*';
process.env.ECONOMY_SCOPE_ID ||= '100000000000000001';
const { default: messageCreate } = await import('../src/events/messageCreate.js');
const { default: help } = await import('../src/commands/Games/help.js');
const { default: bourse } = await import('../src/commands/Games/bourse.js');
const { allowedChannelIds, prefix } = await import('../src/config/runtime.js');
const { CASINO } = await import('../src/config/casino.js');
const { bourseSettings } = await import('../src/config/store/bourse.js');
const { STREAK, STREAK_GUILD_ID } = await import('../src/services/cc/streakService.js');
const { GUIDE_PHRASES, bourseLines, casinoEdges, guideEmbeds } = await import('../src/services/cc/guideUi.js');

const OTHER_GUILD = '100000000000000002';
const userId = '123456789012345678';
const ROOM = '323456789012345678';
const titles = (payload) => (payload?.embeds || []).map((embed) => embed.title);
const text = (embeds) => embeds.map((embed) => [embed.title, embed.description, embed.footer?.text].join('\n')).join('\n');

function setup(guildId = OTHER_GUILD) {
    const sent = [];
    const dms = [];
    const ran = [];
    const client = { commands: new Map(), users: { fetch: async () => null }, db: { get: async (_key, fallback) => fallback, list: async () => [] } };
    for (const name of ['cc', 'cctop', 'casino', 'bourse', 'help']) {
        client.commands.set(name, {
            data: bourse.data,
            normalizePrefixArgs: bourse.normalizePrefixArgs,
            parsePrefixArgs: () => ({ options: {} }),
            execute: async () => ran.push(name),
        });
    }
    const guild = { id: guildId, client };
    const say = (content, channelId = ROOM) => messageCreate.execute({
        guild, guildId, channel: { id: channelId, send: async (payload) => sent.push(payload) }, channelId,
        author: { id: userId, send: async (payload) => dms.push(payload) }, content, attachments: new Map(), reply: async () => {},
    }, client);
    return { sent, dms, ran, say };
}

afterEach(() => {
    delete process.env.STREAK_ENABLED;
    allowedChannelIds.clear();
});

test('the typed guide answers its exact words, with or without the prefix or a dot, in the room, and never pings', async () => {
    const { sent, dms, ran, say } = setup();
    for (const words of [...GUIDE_PHRASES, 'HELP', 'شرح CC', `${prefix}شرح`, `${prefix} مساعدة`, `${prefix}help`, '.شرح', '.help']) {
        sent.length = 0;
        await say(words);
        // The short guide with its sections menu, in the room it was typed in (no DM).
        assert.equal(sent.length, 1, words);
        const english = /help/iu.test(words);
        assert.deepEqual(titles(sent[0]), [english ? '🌀 CC bot guide — Contents' : '🌀 شرح CC bot — المحتويات'], words);
        assert.equal(sent[0].components[0].components[0].type, 3, words);
        assert.ok(sent[0].components[0].components[0].custom_id.startsWith(`guide:${userId}:`), words);
        assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    }
    assert.equal(dms.length, 0);
    assert.deepEqual(ran, []);
});

test('longer sentences and the other typed words are left alone', async () => {
    const { sent, ran, say } = setup();
    for (const chat of ['شرح البوت لو سمحت', 'عايز شرح', 'help me', `${prefix}help me`, 'مساعدة يا جماعة', 'الشرح فين']) await say(chat);
    assert.equal(sent.length, 0);
    assert.deepEqual(ran, []);
    await say('رصيد');
    await say('توب cc');
    await say('مينز 100 3');
    await say('اسعار');
    assert.deepEqual(ran, ['cc', 'cctop', 'casino', 'bourse']);
    assert.equal(sent.length, 0);
});

test('the streak words keep the streak guide, and the full guide adds the streak only where it works', async () => {
    process.env.STREAK_ENABLED = 'true';
    const { sent, say } = setup(STREAK_GUILD_ID);
    for (const words of ['شرح ستريك', 'ستريك شرح', 'شرح الستريك', 'الستريك', 'streak help']) {
        sent.length = 0;
        await say(words);
        assert.deepEqual(titles(sent[0]), ['🔥 شرح الستريك'], words);
    }
    assert.deepEqual(guideEmbeds(STREAK_GUILD_ID).map((embed) => embed.title), ['🌀 شرح CC bot', '📈 شرح البورصة', '🎰 شرح الكازينو', '🔥 شرح الستريك']);
    assert.match(guideEmbeds(STREAK_GUILD_ID)[0].description, /الستريك/u);

    // Without STREAK_ENABLED (or outside the streak server) the guide doesn't claim the streak works.
    delete process.env.STREAK_ENABLED;
    assert.equal(guideEmbeds(STREAK_GUILD_ID).length, 3);
    assert.doesNotMatch(guideEmbeds(STREAK_GUILD_ID)[0].description, /الستريك/u);
    process.env.STREAK_ENABLED = 'true';
    assert.equal(guideEmbeds(OTHER_GUILD).length, 3);
});

test('a picture captioned with a guide word is not a guide request and still counts for the streak', async () => {
    process.env.STREAK_ENABLED = 'true';
    const { STREAK_CHANNEL_ID } = await import('../src/services/cc/streakService.js');
    const store = new Map();
    const client = { commands: new Map(), users: { fetch: async () => null }, db: { get: async (key, fallback) => store.get(key) ?? fallback, set: async (key, value) => store.set(key, value), list: async () => [] } };
    const guild = { id: STREAK_GUILD_ID, client, channels: { cache: new Map() } };
    const sent = [];
    const replies = [];
    const post = (content, extra = {}) => messageCreate.execute({
        guild, guildId: STREAK_GUILD_ID, client, channel: { id: STREAK_CHANNEL_ID, send: async (payload) => sent.push(payload) }, channelId: STREAK_CHANNEL_ID,
        author: { id: userId, send: async () => {} }, content, attachments: new Map(), reply: async (payload) => { replies.push(payload); }, react: async () => {}, ...extra,
    }, client);
    const image = new Map([['1', { name: 'a.png', contentType: 'image/png' }]]);
    for (const word of ['help', 'شرح', 'مساعدة']) {
        sent.length = 0;
        replies.length = 0;
        await post(word, { attachments: image });
        assert.equal(sent.length, 0, word);
        assert.equal(replies.length, 1, word);
        assert.match(replies[0].content, /🔥|ستريك/u, word);
    }
    assert.ok([...store.keys()].some((key) => String(key).includes(userId)), 'the streak was recorded');
    // The same words as plain text still get the guide.
    for (const word of ['help', 'شرح', 'مساعدة']) {
        sent.length = 0;
        await post(word);
        assert.equal(sent.length, 1, word);
    }
});

test('the typed guide only answers in the allowed channels',async () => {
    const { sent, say } = setup();
    allowedChannelIds.add('423456789012345678');
    await say('شرح');
    assert.equal(sent.length, 0);
    await say('شرح', '423456789012345678');
    assert.equal(sent.length, 1);
});

test('/help shows everything or one topic', async () => {
    const replies = [];
    const dms = [];
    const interaction = (topic) => ({ guildId: OTHER_GUILD, user: { send: async (payload) => dms.push(payload) }, options: { getString: () => topic }, reply: async (payload) => replies.push(payload) });
    assert.equal(help.data.name, 'help');
    assert.equal(help.data.description, 'شرح CC bot');
    assert.deepEqual(help.data.toJSON().options[0].choices.map((choice) => choice.value), ['cc', 'bourse', 'casino', 'streak']);
    await help.execute(interaction(null));
    assert.equal(dms.at(-1).embeds.length, 3);
    assert.match(replies.at(-1).content, /بعتلك الشرح في الخاص/u);
    await help.execute(interaction('casino'));
    assert.deepEqual(titles(dms.at(-1)), ['🎰 شرح الكازينو']);
    await help.execute(interaction('streak'));
    assert.equal(dms.at(-1).embeds, undefined);
    assert.match(dms.at(-1).content, /الستريك مش شغال/u);
    process.env.STREAK_ENABLED = 'true';
    await help.execute({ ...interaction('streak'), guildId: STREAK_GUILD_ID });
    assert.deepEqual(titles(dms.at(-1)), ['🔥 شرح الستريك']);
    // Closed DMs: the member is told to open them.
    await help.execute({ ...interaction(null), user: { send: async () => { throw new Error('closed'); } } });
    assert.match(replies.at(-1).content, /افتح الرسايل الخاصة/u);
    for (const payload of [...replies, ...dms]) assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('every bourse subcommand is explained and the embeds stay inside Discord limits', () => {
    const subcommands = bourse.data.toJSON().options.map((sub) => sub.name);
    assert.deepEqual(Object.keys(bourseLines()).sort(), [...subcommands].sort());
    for (const name of subcommands) assert.match(bourseLines()[name], new RegExp(`/bourse ${name}`, 'u'));
    process.env.STREAK_ENABLED = 'true';
    const embeds = guideEmbeds(STREAK_GUILD_ID);
    assert.equal(embeds.length, 4);
    for (const embed of embeds) assert.ok(embed.description.length < 4096 && embed.title.length <= 256);
    const total = embeds.reduce((sum, embed) => sum + embed.title.length + embed.description.length + (embed.footer?.text.length || 0), 0);
    assert.ok(total < 6000, `the guide is ${total} characters`);
    assert.deepEqual(casinoEdges(), { mines: 3, coinflip: 3, slots: 4, crash: 3, dice: 3, chicken: 3, blackjack: 1.5, roulette: 2.7, horses: 2.58, rocket: 3 });
});

test('the guide numbers come from the settings, so changing a constant changes the guide', () => {
    process.env.STREAK_ENABLED = 'true';
    const before = text(guideEmbeds(STREAK_GUILD_ID));
    assert.match(before, /×1\.94/u);
    assert.match(before, /\*\*1\.5%\*\*/u);
    assert.match(before, /من 1 لـ 8 ألغام/u);
    assert.match(before, /\*\*3%\*\* في الماينز و\*\*3%\*\* في العملة و\*\*4%\*\* في السلوت/u);
    const saved = {
        coinflip: { ...CASINO.coinflip }, mines: { ...CASINO.mines }, minBet: CASINO.minBet, idleMs: CASINO.idleMs,
        fee: bourseSettings.sellFeePercent, move: bourseSettings.maxMovePercent, base: STREAK.base,
    };
    try {
        Object.assign(CASINO.coinflip, { payoutPercent: 190 });
        Object.assign(CASINO.mines, { max: 6, edgePercent: 5 });
        Object.assign(CASINO, { minBet: 25, idleMs: 90_000 });
        Object.assign(bourseSettings, { sellFeePercent: 2.5, maxMovePercent: 30 });
        STREAK.base = 400;
        const after = text(guideEmbeds(STREAK_GUILD_ID));
        assert.match(after, /×1\.90/u);
        assert.match(after, /\*\*5%\*\* في الماينز و\*\*5%\*\* في العملة/u);
        assert.match(after, /من 1 لـ 6 ألغام/u);
        assert.match(after, /الرهان من \*\*25\*\*/u);
        assert.match(after, /`مينز 250 3`/u);
        assert.match(after, /90 ثانية/u);
        assert.match(after, /رسوم البيع \*\*2\.5%\*\*/u);
        assert.match(after, /أقصى حركة \*\*30%\*\*/u);
        assert.match(after, /\*\*400\*\* CC/u);
    } finally {
        Object.assign(CASINO.coinflip, saved.coinflip);
        Object.assign(CASINO.mines, saved.mines);
        Object.assign(CASINO, { minBet: saved.minBet, idleMs: saved.idleMs });
        Object.assign(bourseSettings, { sellFeePercent: saved.fee, maxMovePercent: saved.move });
        STREAK.base = saved.base;
    }
    assert.equal(text(guideEmbeds(STREAK_GUILD_ID)), before);
});
