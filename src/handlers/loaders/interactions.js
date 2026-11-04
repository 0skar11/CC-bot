import { readdir } from 'node:fs/promises';
import { Collection } from 'discord.js';
import { BOURSE_GUILD_BUTTONS } from '../../config/bourseGuild.js';
export default async function loadInteractions(client) {
    const root = new URL('../../interactions/buttons/store/', import.meta.url);
    client.buttons = new Collection();
    for (const file of (await readdir(root)).filter((name) => name.endsWith('.js')).sort()) {
        const { default: handler } = await import(new URL(file, root));
        if (!BOURSE_GUILD_BUTTONS.has(handler.name) || client.buttons.has(handler.name)) throw new Error(`Unexpected button handler: ${handler.name}`);
        client.buttons.set(handler.name, handler);
    }
}
