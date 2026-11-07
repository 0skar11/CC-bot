import { isAllowedGuild } from '../../config/runtime.js';
import { formatCC } from '../../config/cc.js';
import { updateCCState } from './ccService.js';
import { streakBonus } from './streakService.js';
import { logger } from '../../utils/logger.js';

// Pays CC when the StreakBot app posts "تم تحديث الستريك" for a member in this server: the reward follows the
// streak day StreakBot shows (same table as the CHAOS streak: STREAK in streakService.js).
export const STREAKBOT_GUILD_ID = '1472405236000751778';
// StreakBot's room in that server: only its updates posted here pay CC, and the notice is sent here too.
export const STREAKBOT_CHANNEL_ID = '1486785786480295956';
// Required: the StreakBot application's user ID (STREAKBOT_ID in .env). Empty = nobody is paid.
const streakBotId = () => (process.env.STREAKBOT_ID || '').trim();
const UPDATE_TITLE = /تم تحديث الستريك/u;
const MENTION = /<@!?(\d{17,20})>/u;
// The streak day is the line that is only a bullet/emoji and a number (`🔥 · 2`, `・2`); `v1.3.34`, mentions and ids don't match.
const COUNT_LINE = /^[^\d\n<>@]{1,40}?(\d{1,4})[ \t]*$/mu;
const MAX_STREAK_DAYS = 3650;
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

function collectText(value, out) {
    if (typeof value === 'string') return out.push(value);
    if (Array.isArray(value)) return value.forEach((item) => collectText(item, out));
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (!/url|icon|proxy/iu.test(key)) collectText(item, out);
}

/** All the text of a message: content, embeds and (v2) components. */
export function messageText(message) {
    const parts = [message.content || ''];
    for (const embed of message.embeds || []) collectText(embed.data || embed, parts);
    // Components v2 (containers, text displays) keep their children outside `.data`; `toJSON()` has the whole tree.
    for (const row of message.components || []) collectText(row.toJSON?.() ?? row.data ?? row, parts);
    return parts.join('\n');
}

export function isStreakBotMessage(message) {
    // Fails closed: a name can be copied by any bot or webhook, so only the configured application ID counts.
    const id = streakBotId();
    if (!id || message.webhookId) return false;
    return Boolean(message.author?.bot) && message.author.id === id;
}

/** `{ userId, count }` from a StreakBot update message, or null when it isn't one (or can't be read). */
export async function parseStreakUpdate(message) {
    const text = messageText(message);
    if (!UPDATE_TITLE.test(text)) return null;
    // Custom emojis (`<:fire:123>`) are just decoration before the number.
    const afterTitle = text.slice(text.search(UPDATE_TITLE)).replace(/<a?:\w+:\d+>/gu, '•');
    const count = Number(COUNT_LINE.exec(afterTitle.slice(afterTitle.indexOf('\n') + 1))?.[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_STREAK_DAYS) return null;
    let userId = MENTION.exec(text)?.[1];
    if (!userId) userId = [...(message.mentions?.users?.values?.() || [])].find((user) => !user.bot)?.id;
    if (!userId && message.reference?.messageId) {
        const replied = await message.fetchReference?.().catch(() => null);
        if (replied && !replied.author?.bot) userId = replied.author.id;
    }
    return userId ? { userId, count } : null;
}

/** Gives the streak CC once per member per day. Returns the result, or null when nothing was paid. */
export async function payStreakBotUpdate(client, guildId, userId, count, now = Date.now()) {
    const today = utcDay(now);
    const bonus = streakBonus(count);
    const result = await updateCCState(client, guildId, userId, (state, record) => {
        if (record.ccStreakBotDay === today) return { skipSave: true, duplicate: true };
        state.cc += bonus.total;
        state.stats.earned += bonus.total;
        record.ccStreakBotDay = today;
        return { paid: true };
    });
    return result?.duplicate ? null : { ...result, count, bonus };
}

/** messageCreate hook. Returns true when the message was a StreakBot update (handled or not). Never throws. */
export async function handleStreakBotMessage(message) {
    try {
        const guildId = message.guildId || message.guild?.id;
        if (guildId !== STREAKBOT_GUILD_ID || (message.channelId || message.channel?.id) !== STREAKBOT_CHANNEL_ID || !isAllowedGuild(guildId) || !isStreakBotMessage(message)) return false;
        const update = await parseStreakUpdate(message);
        if (!update) return false;
        const client = message.client || message.guild?.client;
        const paid = await payStreakBotUpdate(client, guildId, update.userId, update.count);
        if (!paid) return true;
        const milestone = paid.bonus.milestone ? ` 🏅 وجايزة اليوم ${update.count}: **${paid.bonus.milestone.toLocaleString('en-US')}**` : '';
        await message.channel.send({
            content: `🔥 <@${update.userId}> ستريك **${update.count}** يوم: خدت ${formatCC(paid.bonus.total)}${milestone}\n💰 رصيدك: ${formatCC(paid.balance)}`,
            allowedMentions: { users: [update.userId] },
        }).catch(() => null);
        return true;
    } catch (error) {
        logger.warn(`[STREAKBOT] Could not pay a streak update: ${error.message}`);
        return false;
    }
}
