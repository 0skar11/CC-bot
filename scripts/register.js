import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { allowedGuildIds, publicGuildsEnabled, validateConfig } from '../src/config/runtime.js';
import loadCommands from '../src/handlers/loaders/commands.js';

export async function registerCommands({ rest, clientId = process.env.DISCORD_CLIENT_ID } = {}) {
    validateConfig();
    const commands = await loadCommands({});
    if (publicGuildsEnabled) {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
    } else {
        // Finite mode only replaces this application's explicitly configured guild commands.
        for (const guildId of allowedGuildIds) {
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        }
    }
    return commands;
}

// Importing this module for offline tests never logs in or registers anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = await registerCommands({ rest });
    const names = commands.map(({ name }) => `/${name}`).join(', ');
    console.log(publicGuildsEnabled ? `Registered ${names} globally` : `Registered ${names} in ${allowedGuildIds.size} configured guilds`);
}
