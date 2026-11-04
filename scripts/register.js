import { REST, Routes } from 'discord.js';
import { allowedGuildIds, validateConfig } from '../src/config/runtime.js';
import loadCommands from '../src/handlers/loaders/commands.js';
validateConfig();
const commands = await loadCommands({});
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
// Guild-only registration in the NEW application. Never clears global or other-guild commands.
for (const guildId of allowedGuildIds) {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: commands });
    console.log(`Registered bourse in ${guildId}`);
}
