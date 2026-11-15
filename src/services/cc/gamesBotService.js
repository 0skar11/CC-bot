import { isAllowedGuild } from '../../config/runtime.js';
import { CC, formatCC } from '../../config/cc.js';
import { payGamesWin } from './gamesPayout.js';
import { messageText } from './streakBotService.js';
import { logger } from '../../utils/logger.js';

// Pays CC for wins announced by the games bot (Clover): `👑 | @winner` (group game) and
// `✅ | قام @member بكتابة الاجابة الصحيحة ...` (first to type the answer). Moved here from DISbot.
// Only the games bot application IDs count (GAMES_BOT_IDS in .env, default = Clover), each message pays once,
// a group win (`👑`) always pays CC.gamesBot.win (no limit, not counted), and the answer wins pay at most
// CC.gamesBot.dailyCap a member per UTC day, shared with the native chat games (gamesPayout.js).
export const CLOVER_BOT_ID = '1006332825571692544';
const WIN_MESSAGE = /^\s*👑️?\s*\|?\s*<@!?(\d{17,20})>\s*$/mu;
const ANSWER_MESSAGE = /^\s*(?:✅️?|<a?:\w+:\d+>)?\s*\|?\s*قام\s+<@!?(\d{17,20})>\s+بكتابة\s+ال[اإأ]جابة\s+الصحيحة/mu;
const PAID_MEMORY = 500;
const paidMessages = new Set();

export function gamesBotIds() {
    const ids = String(process.env.GAMES_BOT_IDS || '').split(',').map((id) => id.trim()).filter((id) => /^\d{17,20}$/u.test(id));
    return new Set(ids.length ? ids : [CLOVER_BOT_ID]);
}

/** `{ userId, kind }` ('group' | 'answer') from a games bot message, or null. */
export function parseWin(message) {
    const text = messageText(message);
    const group = WIN_MESSAGE.exec(text)?.[1];
    if (group) return { userId: group, kind: 'group' };
    const answer = ANSWER_MESSAGE.exec(text)?.[1];
    return answer ? { userId: answer, kind: 'answer' } : null;
}

/** Pays one win. Returns `{ amount, balance }` (an answer win: amount 0 once today's cap is reached). The shared payout. */
export function payGamesBotWin(client, guildId, userId, kind, now = Date.now()) {
    return payGamesWin(client, guildId, userId, kind, now);
}

/** messageCreate / messageUpdate hook. Returns true when the message was a games bot win. Never throws. */
export async function handleGamesBotWin(message) {
    try {
        const guildId = message.guildId || message.guild?.id;
        if (!guildId || !message.author?.bot || message.webhookId || !gamesBotIds().has(message.author.id)) return false;
        if (!isAllowedGuild(guildId)) return false;
        const win = parseWin(message);
        if (!win) return false;
        if (paidMessages.has(message.id)) return true;
        paidMessages.add(message.id);
        if (paidMessages.size > PAID_MEMORY) paidMessages.delete(paidMessages.values().next().value);
        if (message.mentions?.users?.get(win.userId)?.bot) return true;
        const client = message.client || message.guild?.client;
        const paid = await payGamesBotWin(client, guildId, win.userId, win.kind);
        logger.info(`[GAMESBOT] Paid ${paid.amount} CC to ${win.userId} (${win.kind})`);
        const text = paid.amount > 0
            ? `🌀 <@${win.userId}> كسب +${formatCC(paid.amount)} • رصيدك: ${formatCC(paid.balance)}`
            : `🌀 <@${win.userId}> وصلت لحد الـ CC من الألعاب النهارده (${CC.gamesBot.dailyCap.toLocaleString('en-US')} ${CC.short}).`;
        // The notice stays: it is never deleted.
        await message.reply({ content: text, allowedMentions: { parse: [] } }).catch((error) => logger.warn(`[GAMESBOT] Could not send the notice: ${error.code || error.message}`));
        return true;
    } catch (error) {
        logger.warn(`[GAMESBOT] Could not pay a games bot win: ${error.message}`);
        return false;
    }
}
