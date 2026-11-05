import { readdir } from 'node:fs/promises';
import { Collection } from 'discord.js';
import { BOURSE_GUILD_COMMANDS } from '../../config/bourseGuild.js';
const root = new URL('../../commands/Games/', import.meta.url);
export default async function loadCommands(client) {
    client.commands = new Collection();
    for (const name of (await readdir(root)).filter((file) => file.endsWith('.js')).sort()) {
        const { default: command } = await import(new URL(name, root));
        if (!BOURSE_GUILD_COMMANDS.has(command.data.name) || client.commands.has(command.data.name)) throw new Error(`Unexpected command: ${command.data.name}`);
        client.commands.set(command.data.name, command);
    }
    if (client.commands.size !== BOURSE_GUILD_COMMANDS.size) throw new Error('A required bourse or CC command is missing');
    return [...client.commands.values()].map((command) => command.data.toJSON());
}
