// welcomeService.js — the welcome every server gets when a member joins (guildMemberAdd: src/events/guildMemberAdd.js),
// in each server's own name:
//   1. `welcome to <the server's name> @member 👋` in the server's welcome channel (src/config/welcome.js: the channel
//      set for it, else its system channel, else a text channel named `welcome`), pinging only the member; the
//      server's name is escaped, so its markdown or an `@everyone` in it stay plain text.
//   2. Under it, a small notice from the invite tracker (src/services/cc/inviteTracker.js), pinging nobody: who
//      invited the member and the gift the inviter gets once the member reaches level 5 and writes 50 messages, or
//      why that invite doesn't count (an account younger than 7 days, a rejoin). Nothing when nobody is known to have
//      invited them (unknown, vanity link, their own invite, a bot's), or when the invite gift is off.
// Bots joining get nothing; neither do servers the bot does not serve (BOURSE_GUILD_IDS). WELCOME_ENABLED=false turns
// it off. The wave is the bot's own application emoji named `smileywave` when it has one (uploaded in the developer
// portal → Emojis; it then shows in every server), else 👋. Needs the Server Members Intent (developer portal → Bot)
// to see members join, and View Channel + Send Messages in the welcome channel: a channel without them is skipped for
// the next one, with a warning in the log at most once an hour per server.

import { ChannelType, GatewayIntentBits, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { isAllowedGuild } from '../config/runtime.js';
import { welcomeChannelSetting, welcomeEnabled } from '../config/welcome.js';
import { inviteWelcomeNotice } from './cc/inviteRewardService.js';
import { logger } from '../utils/logger.js';

export const WELCOME_EMOJI_NAME = 'smileywave';
export const WELCOME_EMOJI_FALLBACK = '👋';
const TEXT_CHANNELS = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const WARN_GAP_MS = 60 * 60_000;
const lastWarn = new Map();

function warnOnce(key, text, now = Date.now()) {
    const last = lastWarn.get(key);
    if (last !== undefined && now - last < WARN_GAP_MS) return;
    lastWarn.set(key, now);
    logger.warn(text);
}

const errorText = (error) => error?.code || error?.message || String(error);

/** A server's name as plain text in a message: markdown escaped, and `<` / `@` too (no mention, emoji or @everyone). */
export function escapeGuildName(name) {
    return escapeMarkdown(String(name ?? ''), { maskedLink: true }).replace(/[<@]/gu, (char) => `\\${char}`);
}

/** The wave of the welcome: the bot's own `smileywave` application emoji when it has one, else 👋. */
export function welcomeEmoji(client) {
    const own = client?.application?.emojis?.cache?.find?.((emoji) => emoji?.name === WELCOME_EMOJI_NAME);
    return own ? String(own) : WELCOME_EMOJI_FALLBACK;
}

/** `welcome to <server name> <@member> 👋`. */
export const welcomeText = (guildName, memberId, emoji = WELCOME_EMOJI_FALLBACK) => `welcome to ${escapeGuildName(guildName)} <@${memberId}> ${emoji}`;

/** Whether the bot can post the welcome in `channel`: a text channel of the server it may view and send in. */
export function canWelcomeIn(channel, me) {
    if (!channel || !TEXT_CHANNELS.has(channel.type) || !me || typeof channel.permissionsFor !== 'function') return false;
    return Boolean(channel.permissionsFor(me)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
}

/** 2 for a channel named `welcome` (emoji and dashes aside: `👋・welcome`), 1 for a name with `welcome` in it, else 0. */
function welcomeName(name) {
    const letters = String(name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (letters === 'welcome') return 2;
    return letters.includes('welcome') ? 1 : 0;
}

/**
 * The channel the welcome goes to, or null: the channel set for the server (WELCOME_CHANNEL_IDS / the defaults; 'off'
 * = none), else (or when the bot can't post there) the server's system channel, else a text channel named `welcome`
 * (the exact name first, then the highest in the list). Only channels the bot can post in (canWelcomeIn).
 */
export async function welcomeChannel(guild, { env = process.env, now = Date.now() } = {}) {
    const setting = welcomeChannelSetting(guild?.id, env);
    if (setting === 'off') return null;
    const me = guild.members?.me ?? null;
    const cache = guild.channels?.cache;
    if (setting) {
        const channel = cache?.get?.(setting) ?? await Promise.resolve().then(() => guild.channels?.fetch?.(setting)).catch(() => null) ?? null;
        if (canWelcomeIn(channel, me)) return channel;
        warnOnce(`channel:${guild.id}`, `[WELCOME] The welcome channel ${setting} of ${guild.id} is missing, no text channel, or closed to the bot (View Channel, Send Messages): the next channel is used`, now);
    }
    const system = guild.systemChannel ?? (guild.systemChannelId ? cache?.get?.(guild.systemChannelId) : null);
    if (canWelcomeIn(system, me)) return system;
    const named = [...(cache?.values?.() ?? [])]
        .map((channel) => ({ channel, rank: TEXT_CHANNELS.has(channel?.type) ? welcomeName(channel.name) : 0 }))
        .filter((entry) => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank || (a.channel.rawPosition ?? a.channel.position ?? 0) - (b.channel.rawPosition ?? b.channel.position ?? 0));
    for (const { channel } of named) if (canWelcomeIn(channel, me)) return channel;
    warnOnce(`none:${guild.id}`, `[WELCOME] No welcome channel in ${guild.id}: set one in WELCOME_CHANNEL_IDS (guildId:channelId), a system messages channel, or a text channel named welcome the bot can post in`, now);
    return null;
}

/**
 * guildMemberAdd: the welcome, then the invite notice under it once `join` (the promise of handleMemberJoin, started
 * at the join) tells who invited the member. Returns what happened. Never throws.
 */
export async function welcomeMember(member, client, { join = null, env = process.env, now = Date.now() } = {}) {
    try {
        if (!welcomeEnabled(env)) return { status: 'disabled' };
        const guild = member?.guild;
        if (!guild?.id || !isAllowedGuild(guild.id)) return { status: 'not_allowed' };
        if (!member.id || member.user?.bot) return { status: 'bot' };
        const channel = await welcomeChannel(guild, { env, now });
        if (!channel) return { status: 'no_channel' };
        const memberId = String(member.id);
        const content = welcomeText(guild.name, memberId, welcomeEmoji(client ?? member.client));
        const sent = await Promise.resolve().then(() => channel.send({ content, allowedMentions: { users: [memberId] } })).catch((error) => {
            warnOnce(`send:${guild.id}`, `[WELCOME] Could not send the welcome in ${channel.id} of ${guild.id}: ${errorText(error)}`, now);
            return null;
        });
        if (!sent) return { status: 'failed', channelId: channel.id };
        const notice = inviteWelcomeNotice(memberId, (await Promise.resolve(join).catch(() => null))?.join);
        if (notice) {
            const posted = await Promise.resolve().then(() => channel.send({ content: notice, allowedMentions: { parse: [] } })).catch((error) => {
                logger.warn(`[WELCOME] Could not send the invite notice in ${channel.id} of ${guild.id}: ${errorText(error)}`);
                return null;
            });
            return { status: 'sent', channelId: channel.id, notice: Boolean(posted) };
        }
        return { status: 'sent', channelId: channel.id, notice: false };
    } catch (error) {
        logger.warn(`[WELCOME] Could not welcome a member: ${errorText(error)}`);
        return { status: 'failed' };
    }
}

/**
 * clientReady: warns when the Server Members Intent is missing (no join is seen, so no welcome), and reads the bot's
 * own application emojis (never uploads one) for the wave. Never throws.
 */
export async function startWelcome(client) {
    try {
        if (!welcomeEnabled()) return { status: 'disabled' };
        const intents = client?.options?.intents;
        if (typeof intents?.has === 'function' && !intents.has(GatewayIntentBits.GuildMembers)) {
            logger.warn('[WELCOME] The Server Members Intent is off (developer portal → Bot): members joining are not seen, so no welcome is sent');
        }
        await Promise.resolve().then(() => client?.application?.emojis?.fetch?.()).catch((error) => {
            logger.warn(`[WELCOME] Could not read the bot's emojis, the welcome waves with ${WELCOME_EMOJI_FALLBACK}: ${errorText(error)}`);
        });
        return { status: 'ok', emoji: welcomeEmoji(client) };
    } catch (error) {
        logger.warn(`[WELCOME] The welcome could not start: ${errorText(error)}`);
        return { status: 'failed' };
    }
}

/** For tests: forgets the warnings given. */
export function forgetWelcomeWarnings() {
    lastWarn.clear();
}
