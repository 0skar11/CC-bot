import { readdir } from 'node:fs/promises';
import { Collection } from 'discord.js';
const root = new URL('../../commands/Games/', import.meta.url);
export default async function loadCommands(client) {
    client.commands = new Collection();
    for (const name of (await readdir(root)).filter((file) => file.endsWith('.js')).sort()) {
        const { default: command } = await import(new URL(name, root));
        if (command.data.name !== 'bourse' || client.commands.has(command.data.name)) throw new Error(`Unexpected command: ${command.data.name}`);
        client.commands.set(command.data.name, command);
    }
    if (client.commands.size !== 1) throw new Error('Exactly one stock market command is required');
    return [...client.commands.values()].map((command) => command.data.toJSON());
}
