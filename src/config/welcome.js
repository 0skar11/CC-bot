// welcome.js — the welcome line this bot can send when a member joins (src/services/welcomeService.js):
// `welcome to <the server's name> @member 👋` in the server's welcome channel. Nothing about the invite (GH #329):
// Aether (DISbot) sends the welcome with who invited the member and the invite gift; this bot only tracks and pays it.
// - WELCOME_ENABLED: off unless `true` (or `1`, `yes`, `on`); leave it off where Aether welcomes, or the member gets
//   two welcomes. The invite gift has its own switch (src/config/invites.js).
// - WELCOME_CHANNEL_IDS: `guildId:channelId` pairs, comma-separated, on top of DEFAULT_WELCOME_CHANNELS (a server
//   listed there uses the channel given there); `guildId:off` sends no welcome in that server.
// - A server without a channel set (or whose channel is gone or closed to the bot): its system channel (Server
//   Settings → System Messages), else a text channel named `welcome`.

const snowflake = /^\d{17,20}$/u;
const ON = new Set(['true', '1', 'yes', 'on']);

export const CHAOS_GUILD_ID = '1155236281706627173';
export const ZENITH_GUILD_ID = '1569932761471524874';
/** The welcome channels of CHAOS and Zenith (guild ID → channel ID). */
export const DEFAULT_WELCOME_CHANNELS = Object.freeze({
    [CHAOS_GUILD_ID]: '1547305745417113700',
    [ZENITH_GUILD_ID]: '1570728122259611779',
});

/** Whether the welcome line runs (OFF unless WELCOME_ENABLED is `true`, `1`, `yes` or `on`). Default false so DISbot sends the welcome. */
export const welcomeEnabled = (env = process.env) => ON.has(String(env.WELCOME_ENABLED ?? '').trim().toLowerCase());

/** The WELCOME_CHANNEL_IDS pairs as [guildId, channelId or 'off'], as written (not checked). */
function pairs(env) {
    return String(env.WELCOME_CHANNEL_IDS ?? '').split(',').map((pair) => pair.trim()).filter(Boolean)
        .map((pair) => pair.split(':').map((part) => part.trim()));
}

/** Every configured welcome channel: guild ID → channel ID, or 'off'. The defaults, then WELCOME_CHANNEL_IDS over them. */
export function welcomeChannelMap(env = process.env) {
    const map = new Map(Object.entries(DEFAULT_WELCOME_CHANNELS));
    for (const [guildId, channelId] of pairs(env)) map.set(guildId, channelId?.toLowerCase() === 'off' ? 'off' : channelId);
    return map;
}

/** The welcome channel set for a server: its channel ID, 'off', or null when none is set (the fallbacks then apply). */
export const welcomeChannelSetting = (guildId, env = process.env) => welcomeChannelMap(env).get(String(guildId ?? '')) ?? null;

/** Startup check (src/app.js): every WELCOME_CHANNEL_IDS pair must be `guildId:channelId` (Discord IDs) or `guildId:off`. */
export function validateWelcomeConfig(env = process.env) {
    for (const parts of pairs(env)) {
        const [guildId, channelId] = parts;
        if (parts.length !== 2 || !snowflake.test(guildId) || !(snowflake.test(channelId) || channelId.toLowerCase() === 'off')) {
            throw new Error('WELCOME_CHANNEL_IDS must be guildId:channelId pairs (or guildId:off), comma-separated');
        }
    }
}
