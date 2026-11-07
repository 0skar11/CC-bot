import { isAllowedGuild } from '../../config/runtime.js';
import { formatCC } from '../../config/cc.js';
import { updateCCState } from './ccService.js';
import { streakBonus } from './streakService.js';
import { logger } from '../../utils/logger.js';

// Pays CC when the StreakBot app posts "تم تحديث الستريك" for a member in this server: the reward follows the
// streak day StreakBot shows (same table as the CHAOS streak: STREAK in streakService.js).
export const STREAKBOT_GUILD_ID = '1472405236000751778';
// Optional: the StreakBot application's user ID (STREAKBOT_ID in .env). When empty, the bot's name must be "StreakBot".
const streakBotId = () => (process.env.STREAKBOT_ID || '').trim();
const UPDATE_TITLE = /تم تحديث الستريك/u;
const MENTION = /<@!?(\d{17,20})>/u;
const FIRE_COUNT = /🔥[^\d\n]{0,12}(\d{1,5})/u;
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
    for (const row of message.components || []) collectText(row.data || row.toJSON?.() || row, parts);
    return parts.join('\n');
}

export function isStreakBotMessage(message) {
    const author = message.author;
    if (!author?.bot) return false;
    const id = streakBotId();
    return id ? author.id === id : /^streakbot$/iu.test(author.username || '');
}

/** `{ userId, count }` from a StreakBot update message, or null when it isn't one (or can't be read). */
export async function parseStreakUpdate(message) {
    const text = messageText(message);
    if (!UPDATE_TITLE.test(text)) return null;
    const count = Number(FIRE_COUNT.exec(text)?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) return null;
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
        if (guildId !== STREAKBOT_GUILD_ID || !isAllowedGuild(guildId) || !isStreakBotMessage(message)) return false;
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
