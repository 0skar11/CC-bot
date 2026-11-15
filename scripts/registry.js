import assert from 'node:assert/strict';
import loadCommands from '../src/handlers/loaders/commands.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
import { commandArgAliases } from '../src/config/commands/commandAliases.js';
const client = {};
const commands = await loadCommands(client);
await loadInteractions(client);
assert.deepEqual(commands.map((command) => command.name), ['addcc', 'bourse', 'casino', 'cc', 'cctop', 'daily', 'games', 'give', 'help', 'removecc']);
// `crash` has no subcommand of its own: the typed `crash` / `كراش` are the group rocket.
assert.deepEqual(commands[2].options.map((sub) => sub.name), ['mines', 'coinflip', 'slots', 'dice', 'chicken', 'blackjack', 'roulette', 'rocket']);
assert.deepEqual([...client.buttons.keys()].sort(), ['bourse', 'bourseperk', 'casino', 'g']);
assert.ok(Object.values(commandArgAliases).every((alias) => client.commands.has(alias.split(' ')[0])));
console.log(JSON.stringify({ commands, prefixAliases: commandArgAliases, buttons: [...client.buttons.keys()], selectMenus: [], modals: [] }, null, 2));
