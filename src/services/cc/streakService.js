import { ChannelType } from 'discord.js';
import { isAllowedGuild, streakEnabled } from '../../config/runtime.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { CC } from '../../config/cc.js';
import { updateCCState } from './ccService.js';
import { getEconomyKey, getEconomyPrefix, getGuildConfigKey } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';

export const STREAK = {
    base: 250,
    // Every 7 days of streak the daily bonus goes up by 50: days 1-7 = 250, 8-14 = 300, … up to 1000.
    raiseEvery: 7,
    raiseBy: 50,
    cap: 1000,
    milestones: { 7: 1000, 30: 5000, 100: 20000 },
    // 17:00 UTC is 8 PM in Egypt (summer time), well before the day ends at midnight UTC.
    reminderHourUtc: 17,
    // At most this many members are mentioned in the reminder.
    reminderMentions: 25,
};
export const STREAK_GUILD_ID = '1155236281706627173';
export const STREAK_CHANNEL_ID = '1562578413217124402';
export const STREAK_BOARD_REFRESH_MS = 10 * 60 * 1000;
export const STREAK_BOARD_UPDATE_DELAY_MS = 1000;
const STREAK_BOARD_TITLE = '🔥 Top Streak';
const STREAK_BOARD_FOOTER = '🔄 بيتحدث تلقائي • آخر تحديث';
const MEDALS = ['🥇', '🥈', '🥉'];
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);
const streakEconomyKey = (guildId, userId) => getEconomyKey(economyScope(guildId), userId);

/** Whether the streak works in this guild (STREAK_ENABLED and the streak server). */
export function isStreakGuild(guildId) {
    return streakEnabled() && guildId === STREAK_GUILD_ID && isAllowedGuild(guildId);
}
const GIF_LINK = /https?:\/\/(?:\S+\.)?(?:tenor\.com|giphy\.com)\/\S+|https?:\/\/\S+\.gif(?:\?\S*)?(?:\s|$)/iu;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|heic|heif|avif)$/iu;
const BOARD_SIZE = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

// The day each member's streak was last counted, so most messages don't touch the database.
const counted = new Map();
let timer = null;
let boardRefresh = null;
let boardRefreshRequested = false;
let boardUpdateTimer = null;

/** Whether a message is in the streak room. */
export function isStreakChannel(channelId) {
    return channelId === STREAK_CHANNEL_ID;
}

/**
 * Whether a message has a picture, a GIF or a sticker: an image file, a GIF link (Tenor, Giphy, .gif)
 * or its embed, or any sticker.
 */
export function hasStreakMedia(message) {
    const stickers = message.stickers;
    if ((stickers?.size ?? stickers?.length ?? 0) > 0) return true;
    const attachments = [...(message.attachments?.values?.() || [])];
    if (attachments.some((file) => (file.contentType ? file.contentType.startsWith('image/') : IMAGE_EXTENSION.test(file.name || '')))) return true;
    if ((message.embeds || []).some((embed) => ['gifv', 'image'].includes(embed.data?.type || embed.type))) return true;
    return GIF_LINK.test(message.content || '');
}

const n = (amount) => amount.toLocaleString('en-US');

/** CC for reaching day `count` of a streak: the daily bonus and the milestone bonus. */
export function streakBonus(count) {
    const daily = Math.min(STREAK.base + STREAK.raiseBy * Math.floor((count - 1) / STREAK.raiseEvery), STREAK.cap);
    const milestone = STREAK.milestones[count] || 0;
    return { daily, milestone, total: daily + milestone };
}

/** A member's current streak from a stored record: 0 when it ran out (no message today or yesterday). */
export function liveStreak(streak, now = Date.now()) {
    if (!streak?.day || !streak.count) return 0;
    const today = utcDay(now);
    const yesterday = utcDay(now - DAY_MS);
    return streak.day === today || streak.day === yesterday ? streak.count : 0;
}

/**
 * Counts a chat message for the streak. Returns null when nothing changed (another server, or already
 * counted today), otherwise `{ count, best, bonus, milestone, restarted }`.
 */
export async function recordStreakMessage(client, guildId, userId, now = Date.now()) {
    if (!isStreakGuild(guildId) || !userId) return null;
    const today = utcDay(now);
    const key = `${guildId}:${userId}`;
    if (counted.get(key) === today) return null;

    const result = await updateCCState(client, guildId, userId, (state, record) => {
        const previous = record.ccStreak || {};
        if (previous.day >= today) return { skipSave: true, unchanged: true };
        const continues = previous.day === utcDay(now - DAY_MS);
        const count = continues ? (previous.count || 0) + 1 : 1;
        const best = Math.max(previous.best || 0, count);
        const bonus = streakBonus(count);
        state.cc += bonus.total;
        state.stats.earned += bonus.total;
        record.ccStreak = { day: today, count, best };
        return { count, best, bonus: bonus.total, milestone: bonus.milestone, restarted: !continues && (previous.count || 0) > 1 };
    });
    counted.set(key, today);
    return result?.unchanged ? null : result;
}

/** Everyone with a running streak, longest first. */
export async function getStreakLeaderboard(client, guildId, now = Date.now()) {
    const prefix = getEconomyPrefix(economyScope(guildId));
    const keys = await client.db.list(prefix);
    const rows = [];
    for (const key of Array.isArray(keys) ? keys : []) {
        const record = await client.db.get(key, null);
        const count = liveStreak(record?.ccStreak, now);
        if (count > 0) rows.push({ userId: key.slice(prefix.length), count, best: record.ccStreak.best || count });
    }
    return rows.sort((a, b) => b.count - a.count || b.best - a.best);
}

export async function streakTopEmbed(client, guild, userId = null, now = Date.now()) {
    const board = await getStreakLeaderboard(client, guild.id, now);
    const lines = board.slice(0, BOARD_SIZE).map((row, index) => `${MEDALS[index] || `**#${index + 1}**`} <@${row.userId}> — **${row.count}** يوم 🔥 (أحسن: ${row.best})`);
    const summary = [];
    if (userId) {
        const rank = board.findIndex((row) => row.userId === userId) + 1;
        summary.push(`👤 ترتيبك: ${rank ? `**#${rank}**` : '—'}`);
    }
    summary.push(`👥 ${board.length} عضو عندهم ستريك`);
    return {
        color: 0xe67e22,
        title: STREAK_BOARD_TITLE,
        description: [
            lines.join('\n') || 'لسه محدش عنده ستريك. ابعت صورة أو GIF أو ستيكر هنا كل يوم!',
            '',
            `📸 ابعت صورة أو GIF أو ستيكر في الروم دي كل يوم عشان الستريك يكمل (الكلام مابيتحسبش)، ولو فوّت يوم كامل يرجع من 1.`,
            `🌀 كل يوم: ${n(STREAK.base)} ${CC.short}، وكل ${STREAK.raiseEvery} أيام بتزيد ${n(STREAK.raiseBy)} لحد ${n(STREAK.cap)} • 🏅 ${Object.entries(STREAK.milestones).map(([day, cc]) => `${day} يوم = ${n(cc)}`).join(' • ')}`,
            '',
            summary.join(' • '),
        ].join('\n'),
    };
}

/** `ستريك` / `streak` [@member]: a member's streak. */
export async function streakProfileLine(client, guildId, userId, now = Date.now()) {
    const record = await client.db.get(streakEconomyKey(guildId, userId), null);
    const count = liveStreak(record?.ccStreak, now);
    const best = record?.ccStreak?.best || 0;
    const today = record?.ccStreak?.day === utcDay(now);
    if (!count) return `🔥 <@${userId}> معندوش ستريك دلوقتي${best ? ` (أحسن ستريك: **${best}** يوم)` : ''}. ابعت صورة أو GIF أو ستيكر في روم الستريك النهارده عشان تبدأ.`;
    const next = streakBonus(count + 1);
    return [
        `🔥 ستريك <@${userId}>: **${count}** يوم (أحسن: **${Math.max(best, count)}**)`,
        today ? `✅ اتحسب النهارده. بكرة هتاخد **${next.total}** ${CC.short}.` : `⚠️ لسه مابعتش النهارده، ابعت صورة أو GIF أو ستيكر في روم الستريك قبل ما اليوم يخلص عشان الستريك مايقعش.`,
    ].join('\n');
}

/** `شرح ستريك`: how the streak works, with every number taken from STREAK. */
export function streakGuideEmbed() {
    const milestones = Object.entries(STREAK.milestones).map(([day, cc]) => `${day} يوم = **${n(cc)}** ${CC.short}`).join(' • ');
    return {
        color: 0xe67e22,
        title: '🔥 شرح الستريك',
        description: [
            `📸 ابعت صورة أو GIF أو ستيكر في <#${STREAK_CHANNEL_ID}> كل يوم عشان الستريك يكمل (الكلام مابيتحسبش).`,
            `🌀 كل يوم بتاخد **${n(STREAK.base)}** ${CC.short}، وكل ${STREAK.raiseEvery} أيام بتزيد **${n(STREAK.raiseBy)}** لحد **${n(STREAK.cap)}** ${CC.short} في اليوم.`,
            `🏅 جوايز زيادة: ${milestones}`,
            '💔 لو فوّت يوم كامل الستريك يرجع من 1.',
            '',
            '🔥 اكتب `ستريك` تشوف الستريك بتاعك (أو `ستريك @عضو`)، و`توب ستريك` تشوف الترتيب.',
        ].join('\n'),
    };
}

// Whole typed messages (after the optional PREFIX) that ask for the guide; longer chat is ignored.
const GUIDE_PHRASES = new Set(['شرح ستريك', 'ستريك شرح', 'شرح الستريك', 'الستريك', 'streak help']);
const PROFILE_WORDS = new Set(['ستريك', 'streak', 'الستريك']);
const TOP_WORDS = new Set(['توب', 'top']);
const USER = /^<@!?(\d{17,20})>$|^(\d{17,20})$/u;

/** `ستريك` / `top streak` / `شرح ستريك` typed in our server. Returns true when handled. */
export async function handleStreakCommand(message, commandName, args = []) {
    if (!isStreakGuild(message.guild?.id) || message.author?.bot || message.webhookId) return false;
    const first = String(commandName || '').toLowerCase();
    const client = message.guild.client;
    if (GUIDE_PHRASES.has([first, ...args].join(' ').toLowerCase())) {
        await message.channel.send({ embeds: [streakGuideEmbed()], allowedMentions: { parse: [] } }).catch(() => {});
        return true;
    }
    if (TOP_WORDS.has(first) && PROFILE_WORDS.has(String(args[0] || '').toLowerCase()) && args.length === 1) {
        const embed = await streakTopEmbed(client, message.guild, message.author.id);
        await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
        return true;
    }
    if (!PROFILE_WORDS.has(first) || args.length > 1) return false;
    const match = args.length ? USER.exec(args[0]) : null;
    if (args.length && !match) return false;
    const userId = match ? (match[1] || match[2]) : message.author.id;
    await message.channel.send({ content: await streakProfileLine(client, message.guild.id, userId), allowedMentions: { parse: [] } }).catch(() => {});
    return true;
}

/** Resolves only the configured streak room. */
export async function ensureStreakChannel(guild) {
    if (!isStreakGuild(guild?.id)) return null;
    let channel = guild.channels.cache.get(STREAK_CHANNEL_ID);
    if (!channel) channel = await guild.channels.fetch(STREAK_CHANNEL_ID).catch((error) => {
        if ([10003, 50001, 50013].includes(error.code)) return null;
        throw error;
    });
    if (channel?.type !== ChannelType.GuildText || channel.guild?.id !== guild.id) {
        logger.warn(`[STREAK] Pinned channel ${STREAK_CHANNEL_ID} is missing or inaccessible`);
        return null;
    }
    return channel;
}

// Command replies share the title but are not the periodically edited board.
const isStreakBoard = (message) => message.embeds?.[0]?.title === STREAK_BOARD_TITLE
    && message.embeds?.[0]?.footer?.text === STREAK_BOARD_FOOTER;

async function updateStreakConfig(db, guildId, fields) {
    return db.transaction(async () => {
        const key = getGuildConfigKey(guildId);
        const config = await db.get(key, {});
        return db.set(key, { ...config, ...fields });
    });
}

async function findStreakBoard(channel, db, guildId) {
    const isOwnBoard = (message) => message?.author?.id === channel.client.user.id && isStreakBoard(message);
    const config = await db.get(getGuildConfigKey(guildId), {});
    if (config.streakBoardMessageId) {
        const stored = await channel.messages.fetch(config.streakBoardMessageId).catch((error) => {
            if (error.code === 10008) return null;
            throw error;
        });
        if (isOwnBoard(stored)) return stored;
    }
    const recent = await channel.messages.fetch({ limit: 100 });
    const board = recent.find(isOwnBoard);
    if (board) await updateStreakConfig(db, guildId, { streakBoardMessageId: board.id });
    return board;
}

/** Edits the live board in the streak room, posting it when it isn't there. */
async function publishBoard(guild) {
    const channel = await ensureStreakChannel(guild);
    if (!channel?.send) return { status: 'no-channel' };
    const embed = { ...(await streakTopEmbed(guild.client, guild)), footer: { text: STREAK_BOARD_FOOTER }, timestamp: new Date().toISOString() };
    const payload = { content: '', embeds: [embed], allowedMentions: { parse: [] } };
    const existing = await findStreakBoard(channel, guild.client.db, guild.id);
    if (existing) {
        await existing.edit(payload);
        return { status: 'updated', channelId: channel.id };
    }
    const sent = await channel.send(payload);
    await updateStreakConfig(guild.client.db, guild.id, { streakBoardMessageId: sent.id });
    return { status: 'sent', channelId: channel.id };
}

/** Serialize refreshes, keeping at most one extra pass when a count arrives during a refresh. */
export function publishStreakBoard(guild) {
    if (!isStreakGuild(guild?.id)) return Promise.resolve({ status: 'no-channel' });
    boardRefreshRequested = true;
    if (!boardRefresh) {
        boardRefresh = (async () => {
            let result;
            do {
                boardRefreshRequested = false;
                result = await publishBoard(guild);
            } while (boardRefreshRequested);
            return result;
        })().finally(() => { boardRefresh = null; });
    }
    return boardRefresh;
}

function scheduleStreakBoardRefresh(guild) {
    if (boardUpdateTimer) return;
    boardUpdateTimer = setTimeout(() => {
        boardUpdateTimer = null;
        publishStreakBoard(guild).catch((error) => logger.error('Failed to refresh the streak board:', error));
    }, STREAK_BOARD_UPDATE_DELAY_MS);
    boardUpdateTimer.unref?.();
}

/** The reply to a picture, GIF or sticker in the streak room: counted now, or already counted today. */
export function streakReplyText(userId, { result = null, current = 0 } = {}) {
    if (result) {
        const milestone = result.milestone ? ` 🏅 وجايزة **${n(result.milestone)}**` : '';
        const restarted = result.restarted ? ' (الستريك كان وقع ورجع من الأول)' : '';
        return `🔥 <@${userId}> ستريكك اتحدث: **${result.count}** يوم${restarted}، وخدت **${n(result.bonus)}** ${CC.short}${milestone}. ارجع بكرة!`;
    }
    return `✅ <@${userId}> ستريكك متحدث النهارده خلاص (**${current}** يوم). ابعت تاني بكرة.`;
}

async function replyInRoom(message, content) {
    await message.reply?.({ content, allowedMentions: { users: [message.author.id], repliedUser: false } }).catch(() => null);
}

/**
 * messageCreate: a picture, GIF or sticker in the streak room counts for the streak (🔥 on it, the reply
 * names a milestone); one already counted today says so. Text-only messages are ignored silently, so
 * members can chat in the room. Messages elsewhere are left alone. Never throws.
 */
export async function handleStreakMessage(message) {
    try {
        if (!isStreakGuild(message.guild?.id) || !isStreakChannel(message.channelId) || message.author?.bot || message.webhookId) return null;
        const client = message.client || message.guild.client;
        const userId = message.author?.id;
        if (!hasStreakMedia(message)) return null;
        const result = await recordStreakMessage(client, message.guild.id, userId);
        if (result) {
            scheduleStreakBoardRefresh(message.guild);
            await message.react?.('🔥').catch(() => {});
            await replyInRoom(message, streakReplyText(userId, { result }));
        } else {
            const record = await client.db.get(streakEconomyKey(message.guild.id, userId), null);
            await replyInRoom(message, streakReplyText(userId, { current: liveStreak(record?.ccStreak) }));
        }
        return result;
    } catch (error) {
        logger.warn(`[STREAK] Could not count a message: ${error.message}`);
        return null;
    }
}

/** Members whose streak runs out tonight: it was counted yesterday but not yet today. */
export async function streaksEndingTonight(client, guildId, now = Date.now()) {
    const yesterday = utcDay(now - DAY_MS);
    const prefix = getEconomyPrefix(economyScope(guildId));
    const keys = await client.db.list(prefix);
    const rows = [];
    for (const key of Array.isArray(keys) ? keys : []) {
        const record = await client.db.get(key, null);
        if (record?.ccStreak?.day === yesterday && record.ccStreak.count > 0) rows.push({ userId: key.slice(prefix.length), count: record.ccStreak.count });
    }
    return rows.sort((a, b) => b.count - a.count);
}

/**
 * Once a day, from STREAK.reminderHourUtc, reminds the streak room to post today's picture and mentions
 * the members whose streak would end tonight. Returns true when the reminder was sent.
 */
export async function sendDailyReminder(guild, now = Date.now()) {
    if (!isStreakGuild(guild?.id) || new Date(now).getUTCHours() < STREAK.reminderHourUtc) return false;
    const today = utcDay(now);
    const db = guild.client.db;
    const key = getGuildConfigKey(guild.id);
    if ((await db.get(key, {})).streakReminderDay === today) return false;
    const channel = await ensureStreakChannel(guild);
    if (!channel?.send) return false;

    const ending = (await streaksEndingTonight(guild.client, guild.id, now)).slice(0, STREAK.reminderMentions);
    const claimed = await db.transaction(async () => {
        const config = await db.get(key, {});
        if (config.streakReminderDay === today) return false;
        return db.set(key, { ...config, streakReminderDay: today });
    });
    if (!claimed) return false;
    const ids = ending.map((row) => row.userId);
    await channel.send({
        content: [
            '⏰ **تذكير الستريك:** متنساش تبعت صورة أو GIF أو ستيكر هنا النهارده عشان الستريك بتاعك يكمل! 🔥',
            ...(ids.length ? ['', `⚠️ دول الستريك بتاعهم هيقع الليلة لو مابعتوش: ${ending.map((row) => `<@${row.userId}> (${row.count})`).join(' ')}`] : []),
        ].join('\n'),
        allowedMentions: { users: ids },
    }).catch((error) => logger.warn(`[STREAK] Could not send the reminder: ${error.message}`));
    return true;
}

/** Startup: the streak room, its board and the daily reminder in our server, checked every STREAK_BOARD_REFRESH_MS. */
export async function startStreak(client) {
    const guild = client.guilds.cache.get(STREAK_GUILD_ID);
    if (!isStreakGuild(guild?.id)) return { status: 'skipped' };
    const refresh = async () => {
        const result = await publishStreakBoard(guild).catch((error) => {
            logger.error('Failed to refresh the streak board:', error);
            return { status: 'failed' };
        });
        await sendDailyReminder(guild).catch((error) => logger.error('Failed to send the streak reminder:', error));
        return result;
    };
    if (!timer) {
        timer = setInterval(refresh, STREAK_BOARD_REFRESH_MS);
        timer.unref?.();
    }
    return refresh();
}

/** For tests. */
export function resetStreakCache() {
    counted.clear();
    if (boardUpdateTimer) clearTimeout(boardUpdateTimer);
    boardUpdateTimer = null;
}
