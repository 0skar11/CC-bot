import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const FIRST = '100000000000000001';
const SECOND = '100000000000000002';
const SCOPE = '300000000000000001';
const APP = '400000000000000001';
const CHANNEL = '500000000000000001';
const USER = '600000000000000001';
const runtimeUrl = new URL('../src/config/runtime.js', import.meta.url).href;
const registerUrl = new URL('../scripts/register.js', import.meta.url).href;
const guildUrl = new URL('../src/config/bourseGuild.js', import.meta.url).href;
const interactionUrl = new URL('../src/events/interactionCreate.js', import.meta.url).href;
const messageUrl = new URL('../src/events/messageCreate.js', import.meta.url).href;

function runConfig({ guilds = '*', scope = SCOPE, channels = '', anchors = '' } = {}, code) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; const runtime = await import(${JSON.stringify(runtimeUrl)}); ${code}`], {
        cwd: new URL('../', import.meta.url),
        env: {
            ...process.env,
            BOURSE_GUILD_IDS: guilds,
            ECONOMY_SCOPE_ID: scope,
            BOURSE_CHANNEL_IDS: channels,
            INITIAL_CC: '0',
            TRADER_ROLE_ENABLED: 'false',
            TRADER_ROLE_ANCHORS: anchors,
            DATABASE_URL: 'postgresql://test:test@localhost/bourse_test',
            DISCORD_TOKEN: 'test-only-not-a-token',
            DISCORD_CLIENT_ID: APP,
            LOG_LEVEL: 'silent',
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
}

test('public mode accepts installed guild IDs and a stable explicit economy namespace', () => {
    runConfig({}, `
        assert.doesNotThrow(() => runtime.validateConfig());
        assert.equal(runtime.publicGuildsEnabled, true);
        assert.equal(runtime.economyScopeId, '${SCOPE}');
        assert.deepEqual([...runtime.allowedGuildIds], []);
        assert.equal(runtime.isAllowedGuild('${FIRST}'), true);
        assert.equal(runtime.isAllowedGuild('${SECOND}'), true);
        assert.equal(runtime.isAllowedGuild('${SCOPE}'), true);
        for (const invalid of [null, undefined, '', '*', 'not-a-guild']) assert.equal(runtime.isAllowedGuild(invalid), false);
        const { managedGuilds } = await import(${JSON.stringify(guildUrl)});
        assert.deepEqual(managedGuilds({guilds:{cache:new Map([['a',{id:'${FIRST}'}],['b',{id:'${SECOND}'}]])}}).map(g => g.id), ['${FIRST}', '${SECOND}']);
    `);
});

test('public mode requires an explicit valid scope and refuses mixed wildcard lists', () => {
    runConfig({ scope: '' }, `assert.equal(runtime.economyScopeId, ''); assert.throws(() => runtime.validateConfig(), /explicitly set in public mode/);`);
    runConfig({ scope: '*' }, `assert.throws(() => runtime.validateConfig(), /ECONOMY_SCOPE_ID must be a Discord guild ID/);`);
    runConfig({ guilds: '*,100000000000000001' }, `assert.throws(() => runtime.validateConfig(), {message:'BOURSE_GUILD_IDS must use * by itself'});`);
});

test('public mode retains channel restrictions and validates per-guild trader anchors', () => {
    runConfig({ channels: CHANNEL, anchors: `${SECOND}:${APP}` }, `
        assert.doesNotThrow(() => runtime.validateConfig());
        assert.equal(runtime.isAllowedChannel({id:'${CHANNEL}'}), true);
        assert.equal(runtime.isAllowedChannel({id:'other',parentId:'${CHANNEL}'}), true);
        assert.equal(runtime.isAllowedChannel({id:'other'}), false);
    `);
    runConfig({ anchors: 'not-a-guild:400000000000000001' }, `assert.throws(() => runtime.validateConfig(), /Invalid TRADER_ROLE_ANCHORS/);`);
});

test('public registration writes exactly addcc, bourse, casino, cc, cctop, give and help to the global application route', () => {
    runConfig({}, `
        const { registerCommands } = await import(${JSON.stringify(registerUrl)});
        const calls = [];
        const commands = await registerCommands({rest:{put:async (route,payload) => calls.push({route,payload})}});
        assert.equal(calls.length, 1);
        assert.equal(calls[0].route, '/applications/${APP}/commands');
        assert.deepEqual(calls[0].payload.body, commands);
        assert.deepEqual(commands.map(c => c.name), ['addcc','bourse','casino','cc','cctop','give','help']);
        assert.deepEqual(commands[1].options.map(c => c.name), ['prices','invest','sell','buymax','sellall','holdings']);
        assert.deepEqual(commands[2].options.map(c => c.name), ['mines','coinflip','slots']);
    `);
});

test('finite registration continues using only configured guild routes', () => {
    runConfig({ guilds: `${FIRST},${SECOND}`, scope: FIRST }, `
        const { registerCommands } = await import(${JSON.stringify(registerUrl)});
        const calls = [];
        await registerCommands({rest:{put:async (route,payload) => calls.push({route,payload})}});
        assert.deepEqual(calls.map(c => c.route), ['/applications/${APP}/guilds/${FIRST}/commands','/applications/${APP}/guilds/${SECOND}/commands']);
        for (const call of calls) assert.deepEqual(call.payload.body.map(c => c.name), ['addcc','bourse','casino','cc','cctop','give','help']);
    `);
});

test('invalid public registration stops before writing any command route', () => {
    runConfig({ scope: '' }, `
        const { registerCommands } = await import(${JSON.stringify(registerUrl)});
        await assert.rejects(registerCommands({rest:{put:async()=>assert.fail('invalid configuration must not register commands')}}),/explicitly set in public mode/);
    `);
});

test('public guilds retain the same next-hour forecast locks in the explicit namespace', () => {
    runConfig({}, `
        const { getMarket, forecastMarket, HOUR_MS } = await import(${JSON.stringify(new URL('../src/services/cc/bourseService.js', import.meta.url).href)});
        const records = new Map();
        const client = {db:{get:async (key,fallback) => records.has(key) ? structuredClone(records.get(key)) : fallback,set:async (key,value) => {records.set(key,structuredClone(value));return true;}}};
        const now = Date.UTC(2026,8,25,17,20);
        const prediction = await forecastMarket(client,'${FIRST}',{now,rng:()=>0.2});
        assert.equal(prediction.forecasts.length,9);
        const next = await getMarket(client,'${SECOND}',{now:now+HOUR_MS,rng:()=>0.8});
        assert.deepEqual(next.quotes.map(q=>[q.asset.id,q.price]),prediction.forecasts.map(f=>[f.asset.id,f.next]));
        assert.deepEqual([...records.keys()],['guild:${SCOPE}:bourse']);
    `);
});

test('public guild handlers allow stock commands but still reject DMs, unrelated commands and blocked channels', () => {
    runConfig({ channels: CHANNEL }, `
        const { default: interactionCreate } = await import(${JSON.stringify(interactionUrl)});
        const { default: messageCreate } = await import(${JSON.stringify(messageUrl)});
        let executed = 0;
        const replies = [];
        const client = {commands:new Map([['bourse',{execute:async () => executed++}]])};
        function interaction(guildId,commandName='bourse',channelId='${CHANNEL}') {
            return {guildId,commandName,channelId,user:{id:'${USER}'},isChatInputCommand:()=>true,isButton:()=>false,isRepliable:()=>true,reply:async p=>replies.push(p),deferReply:async()=>{}};
        }
        await interactionCreate.execute(interaction('${SECOND}'),client);
        assert.equal(executed,1);
        for (const i of [interaction(null),interaction('${SECOND}','ban'),interaction('${SECOND}','bourse','outside')]) await interactionCreate.execute(i,client);
        assert.equal(executed,1); assert.equal(replies.length,3);
        const stock = await import(${JSON.stringify(new URL('../src/commands/Games/bourse.js', import.meta.url).href)});
        const typedClient = {commands:new Map([['bourse',{data:stock.default.data,normalizePrefixArgs:stock.default.normalizePrefixArgs,execute:async()=>executed++}]])};
        await messageCreate.execute({guildId:'${SECOND}',author:{id:'${USER}',bot:false},content:'اسعار',channel:{id:'${CHANNEL}',send:async()=>{}}},typedClient);
        assert.equal(executed,2);
        await messageCreate.execute({guildId:'${SECOND}',author:{id:'${USER}',bot:false},content:'اسعار',channel:{id:'outside',send:async()=>assert.fail('blocked channel')}},typedClient);
        assert.equal(executed,2);
        const { default: button } = await import(${JSON.stringify(new URL('../src/interactions/buttons/store/bourse.js', import.meta.url).href)});
        const denied = [];
        await button.execute({inGuild:()=>true,guildId:'${SECOND}',channelId:'${CHANNEL}',user:{id:'${USER}'},reply:async p=>denied.push(p)}, {db:{get:()=>assert.fail('another member must not reach the database')}}, ['buy','car','1','100','700000000000000001']);
        assert.match(denied[0].content,/مش ليك/u);
    `);
});
