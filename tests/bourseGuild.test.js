// Port of source bourseGuild coverage, adapted to a standalone allowlist and removed events.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { spawnSync } from 'node:child_process';
import { allowedGuildIds } from '../src/config/runtime.js';
import { isBourseGuild, isBourseGuildCommand, managedGuilds, BOURSE_GUILD_NOTICE } from '../src/config/bourseGuild.js';
import interactionCreate from '../src/events/interactionCreate.js';
import messageCreate from '../src/events/messageCreate.js';
import loadEvents from '../src/handlers/loaders/events.js';
import loadCommands from '../src/handlers/loaders/commands.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';

const [GUILD, SECOND] = allowedGuildIds;
const OUTSIDE = '900000000000000001';
const USER = '200000000000000001';
function slash(guildId, commandName) {
    const replies = [];
    return { replies, guildId, commandName, user: { id: USER }, isChatInputCommand: () => true, isButton: () => false, isRepliable: () => true, reply: async (payload) => { replies.push(payload); } };
}

describe('standalone bourse guild boundary', () => {
    test('only configured guilds and the bourse, casino, games, CC and help commands are accepted', () => {
        assert.ok(isBourseGuild(GUILD)); assert.ok(isBourseGuild(SECOND));
        assert.equal(isBourseGuild(OUTSIDE), false);
        assert.equal(isBourseGuild(null), false);
        for (const name of ['addcc', 'removecc', 'bourse', 'casino', 'cc', 'cctop', 'daily', 'games', 'give', 'help']) assert.ok(isBourseGuildCommand(name));
        for (const name of ['ban', 'store']) assert.equal(isBourseGuildCommand(name), false);
    });
    test('automatic jobs only receive explicitly configured guilds', () => {
        const client = { guilds: { cache: new Collection([[GUILD, { id: GUILD }], [SECOND, { id: SECOND }], [OUTSIDE, { id: OUTSIDE }]]) } };
        assert.deepEqual(managedGuilds(client).map((guild) => guild.id), [GUILD, SECOND]);
    });
    test('unrelated slash and disallowed guild requests stop before command lookup', async () => {
        for (const [guild, name] of [[GUILD, 'ban'], [OUTSIDE, 'bourse'], [OUTSIDE, 'cc'], [OUTSIDE, 'cctop']]) {
            const interaction = slash(guild, name);
            await interactionCreate.execute(interaction, { commands: { get: () => assert.fail('lookup') } });
            assert.equal(interaction.replies[0].content, BOURSE_GUILD_NOTICE);
        }
    });
    test('nonstock buttons, menus and modals are rejected before handler lookup', async () => {
        for (const type of ['button', 'menu', 'modal']) {
            const interaction = { ...slash(GUILD, null), isChatInputCommand: () => false, isButton: () => type === 'button', customId: 'store_panel:x' };
            await interactionCreate.execute(interaction, { buttons: { get: () => assert.fail('lookup') } });
            assert.equal(interaction.replies[0].content, BOURSE_GUILD_NOTICE);
        }
        const foreign = { ...slash(OUTSIDE, null), isChatInputCommand: () => false, isButton: () => true, customId: `bourse:buy:car:1:100:${USER}` };
        await interactionCreate.execute(foreign, { buttons: { get: () => assert.fail('lookup') } });
        assert.equal(foreign.replies.length, 1);
    });
    test('unrelated typed commands, prose and links never touch the registry or moderate messages', async () => {
        for (const content of ['ban @someone', '!help me', 'رصيد موبايلي خلص', 'بيع العربية دي', 'https://tenor.com/view/cat-gif-123']) {
            const sent = [];
            await messageCreate.execute({ guildId: GUILD, author: { id: USER, bot: false }, content, channel: { id: '400000000000000001', send: async (payload) => sent.push(payload) }, delete: () => assert.fail('delete') }, { commands: { get: () => assert.fail('lookup') } });
            assert.deepEqual(sent, []);
        }
    });
    test('only ready, messageCreate, messageUpdate and interactionCreate listeners exist', async () => {
        const events = [];
        await loadEvents({ on: (name) => events.push(name), once: (name) => events.push(name) });
        assert.deepEqual(events.sort(), ['clientReady', 'interactionCreate', 'messageCreate', 'messageUpdate']);
    });
    test('dry registry contains exactly addcc, bourse, casino, cc, cctop, daily, games, give, help, removecc, the two stock button namespaces and the casino buttons', async () => {
        const client = {};
        const commands = await loadCommands(client); await loadInteractions(client);
        assert.deepEqual(commands.map((command) => command.name), ['addcc', 'bourse', 'casino', 'cc', 'cctop', 'daily', 'games', 'give', 'help', 'removecc']);
        assert.deepEqual(commands[1].options.map((sub) => sub.name), ['prices', 'invest', 'sell', 'buymax', 'sellall', 'holdings']);
        assert.deepEqual(commands[2].options.map((sub) => [sub.name, sub.options.map(({ name, required }) => `${name}${required ? '' : '?'}`)]), [
            ['mines', ['bet', 'mines?']], ['coinflip', ['bet', 'side?']], ['slots', ['bet']],
            ['crash', ['bet', 'target?']], ['dice', ['bet', 'number?', 'direction?']], ['roulette', ['bet', 'choice']], ['rocket', ['bet', 'target?']],
        ]);
        assert.deepEqual(commands[3].options.map(({ name, required }) => ({ name, required })), [{ name: 'user', required: false }]);
        assert.deepEqual(commands[4].options, []); assert.deepEqual(commands[5].options, []); assert.deepEqual(commands[6].options, []);
        assert.deepEqual(commands[0].options.map(({ name }) => name), ['amount', 'user']);
        assert.deepEqual(commands[7].options.map(({ name }) => name), ['user', 'amount']);
        assert.deepEqual([...client.buttons.keys()].sort(), ['bourse', 'bourseperk', 'casino']);
    });
    test('stock prefix aliases route without a prefix and accept multiword names', async () => {
        const calls = [];
        const { default: real } = await import('../src/commands/Games/bourse.js');
        const client = { commands: new Collection([['bourse', { data: real.data, normalizePrefixArgs: real.normalizePrefixArgs, execute: async (i) => calls.push([i.options.getSubcommand(), i.options.getString('asset'), i.options.getInteger('quantity')]) }]]) };
        for (const content of ['شراء سبيكة دهب 2', '!bourse sell car 3', 'بيع كلو']) await messageCreate.execute({ guildId: GUILD, content, author: { id: USER, bot: false }, channel: { id: '400000000000000001', send: async () => {} } }, client);
        assert.deepEqual(calls, [['invest', 'سبيكة دهب', 2], ['sell', 'car', 3], ['sellall', null, null]]);
    });
    test('missing allowlist fails closed and channel restrictions apply to categories too', () => {
        const runtimeUrl = new URL('../src/config/runtime.js', import.meta.url).href;
        const code = `const r=await import(${JSON.stringify(runtimeUrl)}); if(r.isAllowedGuild('${GUILD}'))process.exit(2); if(!r.isAllowedChannel({id:'x',parentId:'400000000000000001'}))process.exit(3); if(r.isAllowedChannel({id:'no'}))process.exit(4);`;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('../', import.meta.url), env: { ...process.env, BOURSE_GUILD_IDS: '', BOURSE_CHANNEL_IDS: '400000000000000001' }, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
    });
});
