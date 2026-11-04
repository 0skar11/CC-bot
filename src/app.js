import { Client, GatewayIntentBits } from 'discord.js';
import { validateConfig } from './config/runtime.js';
import { PostgreSQLDatabase } from './utils/postgresDatabase.js';
import loadCommands from './handlers/loaders/commands.js';
import loadInteractions from './handlers/loaders/interactions.js';
import loadEvents from './handlers/loaders/events.js';
validateConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.db = new PostgreSQLDatabase();
try {
    await client.db.connect();
    await loadCommands(client);
    await loadInteractions(client);
    await loadEvents(client);
    await client.login(process.env.DISCORD_TOKEN);
} catch (error) {
    console.error('CC bot startup failed:', error.code || error.message);
    client.destroy();
    await client.db.close();
    process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    client.destroy();
    await client.db.close();
    process.exitCode = 0;
});
