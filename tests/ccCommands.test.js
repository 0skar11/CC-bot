import assert from 'node:assert/strict';
import { test } from 'node:test';
import { economyScopeId, prefix } from '../src/config/runtime.js';
import { getEconomyKey } from '../src/utils/database/keys.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import { getMarket, sellFee } from '../src/services/cc/bourseService.js';

const GUILD = '100000000000000002';
const SELF = { id: '200000000000000001' };
const OTHER = { id: '200000000000000002' };
const BOT = { id: '200000000000000003', bot: true };

async function setup() {
    const records = new Map([
        [getEconomyKey(economyScopeId, SELF.id), { cc: 100, ccBourse: { car: { qty: 2, cost: 1 } } }],
        [getEconomyKey(economyScopeId, OTHER.id), { cc: 101 }],
    ]);
    const client = {
        db: {
            get: async (key, fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,
            set: async (key, value) => { records.set(key, structuredClone(value)); return true; },
            list: async (prefix) => [...records.keys()].filter((key) => key.startsWith(prefix)),
        },
        users: { fetch: async (id) => [SELF, OTHER, BOT].find((user) => user.id === id) || null },
    };
    await loadCommands(client);
    return client;
}

function message(content, replies) {
    return { content, guildId: GUILD, author: SELF, channel: { send: async (payload) => replies.push(payload) } };
}

function slash(commandName, replies, target = null) {
    return {
        commandName, guildId: GUILD, user: SELF, options: { getUser: () => target },
        isChatInputCommand: () => true,
        async deferReply() { this.deferred = true; },
        async editReply(payload) { replies.push(payload); },
        async reply() { assert.fail('must edit the deferred reply'); },
    };
}

test('CC slash shows the shared profile of self or the selected member without writing', async () => {
    const client = await setup();
    client.db.set = async () => assert.fail('balance must not write records');
    const replies = [];
    await interactionCreate.execute(slash('cc', replies), client);
    await interactionCreate.execute(slash('cc', replies, OTHER), client);
    await interactionCreate.execute(slash('cc', replies, BOT), client);
    assert.match(replies[0].embeds[0].description, new RegExp(`${SELF.id}.*\\*\\*100\\*\\*`, 's'));
    assert.match(replies[1].embeds[0].description, new RegExp(`${OTHER.id}.*\\*\\*101\\*\\*`, 's'));
    assert.deepEqual(replies[1].allowedMentions, { parse: [] });
    assert.match(replies[2].content, /البوتات/u);
});

test('typed CC aliases accept optional mentions and IDs but ignore prose or extra arguments', async () => {
    const client = await setup();
    const replies = [];
    for (const name of ['cc', 'bal', 'balance', 'money', 'cash', 'credits', 'رصيد', 'رصيدي', 'رصيدى', 'فلوس', 'كريدت']) {
        await messageCreate.execute(message(name, replies), client);
        assert.match(replies.at(-1).embeds[0].description, /\*\*100\*\*/u);
    }
    assert.equal(replies.length, 11);
    await messageCreate.execute(message(`${prefix}cc <@${OTHER.id}>`, replies), client);
    await messageCreate.execute(message(`رصيد ${OTHER.id}`, replies), client);
    assert.equal(replies.length, 13);
    for (const reply of replies.slice(-2)) assert.match(reply.embeds[0].description, /\*\*101\*\*/u);
    for (const content of ['رصيد موبايلي خلص', 'cc hi', 'top cc please', 'توب أخبار', 'give']) {
        await messageCreate.execute(message(content, replies), client);
    }
    assert.equal(replies.length, 13);
});

test('top CC slash and typed aliases rank CC plus net sale value in the shared economy', async () => {
    const client = await setup();
    const { quotes } = await getMarket(client, GUILD);
    const gross = quotes.find(({ asset }) => asset.id === 'car').price * 2;
    const net = gross - sellFee(gross);
    const replies = [];
    await interactionCreate.execute(slash('cctop', replies), client);
    for (const alias of ['cctop', 'top cc', `${prefix}top CC`, 'توب cc', 'توب كريدت']) {
        await messageCreate.execute(message(alias, replies), client);
    }
    assert.equal(replies.length, 6);
    for (const reply of replies) {
        const { description } = reply.embeds[0];
        assert.ok(description.startsWith(`🥇 <@${SELF.id}> — **${(100 + net).toLocaleString('en-US')}** CC`));
        assert.ok(description.includes('ترتيبك: **#1**'));
        assert.ok(description.includes('الاقتصاد المشترك'));
        assert.deepEqual(reply.allowedMentions, { parse: [] });
    }
});

test('addcc is owner only and credits the CC bot balance; give moves CC with tax', async () => {
    const client = await setup();
    const owner = { id: '1159601661392715906' };
    const mk = (content, author, replies) => ({ content, guildId: GUILD, author, guild: { members: { fetch: async () => ({}) } }, channel: { send: async (p) => replies.push(p) } });
    let replies = [];
    await messageCreate.execute(mk('addcc 500', SELF, replies), client);
    assert.match(replies[0].content, /للأونر/u);
    replies = [];
    await messageCreate.execute(mk('addcc 500', owner, replies), client);
    assert.match(replies[0].embeds[0].description, /500/u);
    await messageCreate.execute(mk(`addcc <@${SELF.id}> 40`, owner, replies), client);
    assert.equal((await client.db.get(getEconomyKey(economyScopeId, SELF.id))).cc, 140);
    replies = [];
    await messageCreate.execute(mk(`تحويل <@${OTHER.id}> 100`, SELF, replies), client);
    assert.equal((await client.db.get(getEconomyKey(economyScopeId, SELF.id))).cc, 40);
    assert.equal((await client.db.get(getEconomyKey(economyScopeId, OTHER.id))).cc, 196);
    replies = [];
    await messageCreate.execute(mk('تحويل', SELF, replies), client);
    assert.equal(replies.length, 0);
});
