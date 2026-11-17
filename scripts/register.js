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
    // Registering must never hold a deploy: a Discord rate limit (repeated registrations in a short time) is rejected at
    // once instead of waited out for hours, requests time out after 20 s, and a failure is logged and the deploy goes on
    // with the commands that are already registered (they change only when a command's definition changes).
    const rest = new REST({ version: '10', timeout: 20_000, rejectOnRateLimit: () => true }).setToken(process.env.DISCORD_TOKEN);
    try {
        const commands = await registerCommands({ rest });
        const names = commands.map(({ name }) => `/${name}`).join(', ');
        console.log(publicGuildsEnabled ? `Registered ${names} globally` : `Registered ${names} in ${allowedGuildIds.size} configured guilds`);
    } catch (error) {
        console.warn(`[REGISTER] Slash commands were not registered (${error?.message || error}); the deploy continues.`);
    }
}
