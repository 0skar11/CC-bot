import { Client, GatewayIntentBits, Routes } from 'discord.js';
import { validateConfig } from './config/runtime.js';
import { validateGamesConfig } from './config/games.js';
import { validateInviteConfig } from './config/invites.js';
import { validateWelcomeConfig } from './config/welcome.js';
import { inviteIntents } from './services/cc/inviteTracker.js';
import { flushChatCounts } from './services/cc/chatCounter.js';
import { PostgreSQLDatabase } from './utils/postgresDatabase.js';
import loadCommands from './handlers/loaders/commands.js';
import loadInteractions from './handlers/loaders/interactions.js';
import loadEvents from './handlers/loaders/events.js';
import { loadGames } from './games/registry.js';
import { abortAll } from './games/engine/session.js';
validateConfig();
validateGamesConfig();
validateInviteConfig();
validateWelcomeConfig();
// The invite gift adds GuildInvites; the welcome and the invite gift add GuildMembers, only when the Server Members
// Intent is on in the developer portal (asked before login: a privileged intent that is off would stop the login).
// See inviteIntents in src/services/cc/inviteTracker.js.
const extraIntents = await inviteIntents(process.env.DISCORD_TOKEN);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, ...extraIntents] });
client.db = new PostgreSQLDatabase();
try {
    await client.db.connect();
    await loadCommands(client);
    await loadInteractions(client);
    // The chat games (src/games/): a game word used twice fails the start here, never in a room.
    await loadGames();
    await loadEvents(client);
    // Why a login can sit silent: Discord allows a limited number of logins a day (session start limit). Logged first, so a
    // bot that never connects says how many logins are left and when they come back.
    try {
        const limit = (await client.rest.get(Routes.gatewayBot()))?.session_start_limit;
        if (limit) console.log(`[GATEWAY] logins left ${limit.remaining}/${limit.total}, they reset in ${Math.round(limit.reset_after / 60_000)} min`);
    } catch (error) {
        console.warn(`[GATEWAY] Could not read the login limit: ${error?.code || error?.message || error}`);
    }
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
    // The chat messages counted for the invite gift and not written yet (src/services/cc/chatCounter.js).
    await flushChatCounts(client);
    client.destroy();
    await client.db.close();
    process.exitCode = 0;
});
