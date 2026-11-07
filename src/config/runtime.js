import 'dotenv/config';

export const ids = (value) => String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
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
// Casino (src/config/casino.js): its own channels/categories, and the most CC one bet can take.
// `ceiling` keeps every payout (at most ×122.22 of the bet: mines; crash and rocket ×100, dice ×97,
// chicken ×84.13, roulette ×36) far inside Number.MAX_SAFE_INTEGER.
export const CASINO_BET_LIMITS = { min: 10, defaultMax: 10_000_000_000_000, ceiling: 10_000_000_000_000 };
export const casinoChannelIds = new Set(ids(process.env.CASINO_CHANNEL_IDS));
export const casinoMaxBet = Number(process.env.CASINO_MAX_BET?.trim() || CASINO_BET_LIMITS.defaultMax);

export function isAllowedGuild(guildId) {
    return Boolean(guildId) && (publicGuildsEnabled ? snowflake.test(String(guildId)) : allowedGuildIds.has(String(guildId)));
}

export function isAllowedChannel(channel, channelId) {
    return !allowedChannelIds.size || allowedChannelIds.has(channel?.id || channelId) || allowedChannelIds.has(channel?.parentId);
}

/** The casino's rooms: CASINO_CHANNEL_IDS (channels or categories), or the bot's usual channels when it is empty. */
export function isCasinoChannel(channel, channelId) {
    if (!casinoChannelIds.size) return isAllowedChannel(channel, channelId);
    return casinoChannelIds.has(channel?.id || channelId) || casinoChannelIds.has(channel?.parentId);
}

/** CC basics that also work in the casino rooms, where people need to top up, check and send CC (and see the games menu). */
export const CASINO_ROOM_COMMANDS = new Set(['addcc', 'removecc', 'give', 'daily', 'cc', 'games']);
export function isCommandChannel(commandName, channel, channelId) {
    return isAllowedChannel(channel, channelId) || (CASINO_ROOM_COMMANDS.has(commandName) && isCasinoChannel(channel, channelId));
}

export function validateConfig({ discord = true } = {}) {
    if (configuredGuildIds.includes('*') && !publicGuildsEnabled) throw new Error('BOURSE_GUILD_IDS must use * by itself');
    if (!publicGuildsEnabled && (!allowedGuildIds.size || [...allowedGuildIds].some((id) => !snowflake.test(id)))) throw new Error('BOURSE_GUILD_IDS must contain Discord guild IDs');
    if (publicGuildsEnabled && !configuredEconomyScopeId) throw new Error('ECONOMY_SCOPE_ID must be explicitly set in public mode');
    if (!snowflake.test(economyScopeId)) throw new Error('ECONOMY_SCOPE_ID must be a Discord guild ID');
    if (!publicGuildsEnabled && !allowedGuildIds.has(economyScopeId)) throw new Error('ECONOMY_SCOPE_ID must be included in BOURSE_GUILD_IDS');
    if ([...allowedChannelIds].some((id) => !snowflake.test(id))) throw new Error('BOURSE_CHANNEL_IDS contains an invalid ID');
    if (!Number.isSafeInteger(initialCC) || initialCC < 0) throw new Error('INITIAL_CC must be a nonnegative safe integer');
    if ([...casinoChannelIds].some((id) => !snowflake.test(id))) throw new Error('CASINO_CHANNEL_IDS contains an invalid ID');
    if (!Number.isSafeInteger(casinoMaxBet) || casinoMaxBet < CASINO_BET_LIMITS.min || casinoMaxBet > CASINO_BET_LIMITS.ceiling) {
        throw new Error(`CASINO_MAX_BET must be a whole number from ${CASINO_BET_LIMITS.min} to ${CASINO_BET_LIMITS.ceiling}`);
    }
    if ([...traderRoleAnchors].some(([guild, role]) => !isAllowedGuild(guild) || !snowflake.test(role))) throw new Error('Invalid TRADER_ROLE_ANCHORS');
    if (discord && (!process.env.DISCORD_TOKEN || !snowflake.test(process.env.DISCORD_CLIENT_ID || ''))) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID');
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a dedicated bourse database');
}
