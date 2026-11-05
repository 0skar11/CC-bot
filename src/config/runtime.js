import 'dotenv/config';

const ids = (value) => String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
const snowflake = /^\d{17,20}$/u;
const configuredGuildIds = ids(process.env.BOURSE_GUILD_IDS);
const configuredEconomyScopeId = process.env.ECONOMY_SCOPE_ID?.trim() || '';
export const publicGuildsEnabled = configuredGuildIds.length === 1 && configuredGuildIds[0] === '*';
export const allowedGuildIds = new Set(publicGuildsEnabled ? [] : configuredGuildIds);
export const allowedChannelIds = new Set(ids(process.env.BOURSE_CHANNEL_IDS));
export const economyScopeId = configuredEconomyScopeId || [...allowedGuildIds][0] || '';
export const prefix = process.env.PREFIX || '!';
export const initialCC = Number(process.env.INITIAL_CC || 0);
export const traderRoleEnabled = process.env.TRADER_ROLE_ENABLED === 'true';
export const streakEnabled = () => process.env.STREAK_ENABLED === 'true';
export const traderRoleAnchors = new Map(ids(process.env.TRADER_ROLE_ANCHORS).map((pair) => pair.split(':')));

export function isAllowedGuild(guildId) {
    return Boolean(guildId) && (publicGuildsEnabled ? snowflake.test(String(guildId)) : allowedGuildIds.has(String(guildId)));
}

export function isAllowedChannel(channel, channelId) {
    return !allowedChannelIds.size || allowedChannelIds.has(channel?.id || channelId) || allowedChannelIds.has(channel?.parentId);
}

export function validateConfig({ discord = true } = {}) {
    if (configuredGuildIds.includes('*') && !publicGuildsEnabled) throw new Error('BOURSE_GUILD_IDS must use * by itself');
    if (!publicGuildsEnabled && (!allowedGuildIds.size || [...allowedGuildIds].some((id) => !snowflake.test(id)))) throw new Error('BOURSE_GUILD_IDS must contain Discord guild IDs');
    if (publicGuildsEnabled && !configuredEconomyScopeId) throw new Error('ECONOMY_SCOPE_ID must be explicitly set in public mode');
    if (!snowflake.test(economyScopeId)) throw new Error('ECONOMY_SCOPE_ID must be a Discord guild ID');
    if (!publicGuildsEnabled && !allowedGuildIds.has(economyScopeId)) throw new Error('ECONOMY_SCOPE_ID must be included in BOURSE_GUILD_IDS');
    if ([...allowedChannelIds].some((id) => !snowflake.test(id))) throw new Error('BOURSE_CHANNEL_IDS contains an invalid ID');
    if (!Number.isSafeInteger(initialCC) || initialCC < 0) throw new Error('INITIAL_CC must be a nonnegative safe integer');
    if ([...traderRoleAnchors].some(([guild, role]) => !isAllowedGuild(guild) || !snowflake.test(role))) throw new Error('Invalid TRADER_ROLE_ANCHORS');
    if (discord && (!process.env.DISCORD_TOKEN || !snowflake.test(process.env.DISCORD_CLIENT_ID || ''))) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID');
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a dedicated bourse database');
}
