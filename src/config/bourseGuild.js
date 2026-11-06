import { isAllowedGuild } from './runtime.js';
export const BOURSE_GUILD_COMMANDS = new Set(['bourse', 'casino', 'cc', 'cctop', 'help']);
export const BOURSE_GUILD_BUTTONS = new Set(['bourse', 'bourseperk', 'casino']);
export const BOURSE_GUILD_NOTICE = '❌ الأمر ده مش متاح هنا.';
export const isBourseGuild = isAllowedGuild;
export const isBourseGuildCommand = (name) => BOURSE_GUILD_COMMANDS.has(String(name || '').toLowerCase());
export function managedGuilds(client) {
    return [...client.guilds.cache.values()].filter((guild) => isAllowedGuild(guild.id));
}
