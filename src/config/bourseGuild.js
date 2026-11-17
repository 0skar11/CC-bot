import { isAllowedGuild } from './runtime.js';
export const BOURSE_GUILD_COMMANDS = new Set(['addcc', 'removecc', 'bourse', 'casino', 'cc', 'cctop', 'daily', 'games', 'give', 'guide', 'help']);
// `g`: the chat games' lobby buttons (src/games/engine/lobby.js); `guide`: the `شرح` guide's sections menu.
export const BOURSE_GUILD_BUTTONS = new Set(['bourse', 'bourseperk', 'casino', 'g', 'guide']);
export const BOURSE_GUILD_NOTICE = '❌ الأمر ده مش متاح هنا.';
export const isBourseGuild = isAllowedGuild;
export const isBourseGuildCommand = (name) => BOURSE_GUILD_COMMANDS.has(String(name || '').toLowerCase());
export function managedGuilds(client) {
    return [...client.guilds.cache.values()].filter((guild) => isAllowedGuild(guild.id));
}
