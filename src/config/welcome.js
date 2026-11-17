// welcome.js — the welcome every server gets when a member joins (src/services/welcomeService.js):
// `welcome to <the server's name> @member 👋` in the server's welcome channel, and under it the invite notice (who
// invited the member and the invite gift, src/services/cc/inviteRewardService.js, when INVITE_REWARD_ENABLED=true).
// - WELCOME_ENABLED: on unless `false` (or `0`, `off`, `no`). The invite gift has its own switch, so the welcome can
//   run without it.
// - WELCOME_CHANNEL_IDS: `guildId:channelId` pairs, comma-separated, on top of DEFAULT_WELCOME_CHANNELS (a server
//   listed there uses the channel given there); `guildId:off` sends no welcome in that server.
// - A server without a channel set (or whose channel is gone or closed to the bot): its system channel (Server
//   Settings → System Messages), else a text channel named `welcome`.

const snowflake = /^\d{17,20}$/u;
const OFF = new Set(['false', '0', 'off', 'no']);

export const CHAOS_GUILD_ID = '1155236281706627173';
export const ZENITH_GUILD_ID = '1569932761471524874';
/** The welcome channels of CHAOS and Zenith (guild ID → channel ID). */
export const DEFAULT_WELCOME_CHANNELS = Object.freeze({
    [CHAOS_GUILD_ID]: '1547305745417113700',
    [ZENITH_GUILD_ID]: '1570728122259611779',
});

/** Whether the welcome runs at all (on unless WELCOME_ENABLED is `false`, `0`, `off` or `no`). Read on every call. */
export const welcomeEnabled = (env = process.env) => !OFF.has(String(env.WELCOME_ENABLED ?? '').trim().toLowerCase());

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
