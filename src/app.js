import { Client, GatewayIntentBits } from 'discord.js';
import { validateConfig } from './config/runtime.js';
import { validateGamesConfig } from './config/games.js';
import { PostgreSQLDatabase } from './utils/postgresDatabase.js';
import loadCommands from './handlers/loaders/commands.js';
import loadInteractions from './handlers/loaders/interactions.js';
import loadEvents from './handlers/loaders/events.js';
import { loadGames } from './games/registry.js';
import { abortAll } from './games/engine/session.js';
validateConfig();
validateGamesConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.db = new PostgreSQLDatabase();
try {
    await client.db.connect();
    await loadCommands(client);
    await loadInteractions(client);
    // The chat games (src/games/): a game word used twice fails the start here, never in a room.
    await loadGames();
    await loadEvents(client);
    await client.login(process.env.DISCORD_TOKEN);
} catch (error) {
    console.error('CC bot startup failed:', error.code || error.message);
    client.destroy();
    await client.db.close();
    process.exitCode = 1;
}
// A stray rejection (an expired interaction, a deleted message) must not take the whole bot down: log it and keep running.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason?.code || reason?.message || reason);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    // Every running chat game ends (its timers and collectors are removed) before the client goes away.
    abortAll('shutdown');
    client.destroy();
    await client.db.close();
    process.exitCode = 0;
});
