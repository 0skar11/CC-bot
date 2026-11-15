// rewards.js — what a chat game win pays: CC through the one capped payout shared with Clover's wins
// (src/services/cc/gamesPayout.js: CC.gamesBot.answer / .win, at most CC.gamesBot.dailyCap a member a UTC day),
// plus points (GAMES.points: answer 1, group 5) and one more win for the game, in the server and globally
// (points.js). The points are given even once today's CC cap is reached. `convert` turns a member's points of the
// server into CC at GAMES.convert.ccPerPoint (at least GAMES.convert.minPoints at once); it does not count toward
// the daily cap, since the points themselves only come from wins.

import { CC, formatCC } from '../../config/cc.js';
import { GAMES } from '../../config/games.js';
import { updateCCState } from '../../services/cc/ccService.js';
import { payGamesWin } from '../../services/cc/gamesPayout.js';
import { inLang } from '../../services/cc/lang.js';
import { logger } from '../../utils/logger.js';
import { addPoints, spendPoints } from './points.js';

export const WIN_KINDS = ['answer', 'group'];
const number = (value) => Number(value || 0).toLocaleString('en-US');

/**
 * Pays one win to `userId`. kind: 'answer' (first right answer) or 'group' (won a group game); any other kind is a
 * programming error and throws. Otherwise it never throws: returns { ok: true, amount, balance, points, totalPoints, wins, capped } (amount = CC paid now, 0 at the daily
 * cap; balance = the CC balance after it; points = points added now; totalPoints / wins = the server totals, null
 * when the points could not be saved), or { ok: false, amount: 0, balance: null, points: 0 } when the CC payout failed.
 */
export async function rewardWin(client, guildId, userId, kind = 'answer', gameId = null, { now = Date.now() } = {}) {
    if (!WIN_KINDS.includes(kind)) throw new Error(`Unknown win kind: ${kind}`);
    let paid;
    try { paid = await payGamesWin(client, guildId, userId, kind, now); } catch (error) {
        logger.error(`[GAMES] Could not pay ${userId} for ${gameId || 'a game'}`, error.code || error.message);
        return { ok: false, amount: 0, balance: null, points: 0, totalPoints: null, wins: null, capped: false };
    }
    const points = GAMES.points[kind];
    let score = null;
    try { score = await addPoints(client, guildId, userId, points, { gameId }); } catch (error) {
        logger.warn(`[GAMES] Could not save the points of ${userId}: ${error.code || error.message}`);
    }
    logger.info(`[GAMES] ${gameId || 'game'}: ${paid.amount} CC and ${points} points to ${userId} (${kind})`);
    return {
        ok: true, amount: paid.amount, balance: paid.balance, points: score ? points : 0,
        totalPoints: score?.points ?? null, wins: score?.wins ?? null, capped: paid.amount < (kind === 'answer' ? CC.gamesBot.answer : CC.gamesBot.win),
    };
}

/**
 * Turns `points` of the member's points in this server into CC. Returns { ok: true, points, amount, balance, left }
 * or { ok: false, reason: 'min' | 'not_enough', min, have }.
 */
export async function convertPoints(client, guildId, userId, points) {
    const { ccPerPoint, minPoints } = GAMES.convert;
    if (!Number.isSafeInteger(points) || points < minPoints) return { ok: false, reason: 'min', min: minPoints };
    const amount = points * ccPerPoint;
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: 'min', min: minPoints };
    const spent = await spendPoints(client, guildId, userId, points, () => updateCCState(client, guildId, userId, (state) => {
        state.cc += amount;
        state.stats.earned += amount;
        return { amount };
    }));
    if (!spent.ok) return { ...spent, min: minPoints };
    logger.info(`[GAMES] ${userId} converted ${points} points to ${amount} CC`);
    return { ok: true, points, amount, balance: spent.paid.balance, left: spent.left };
}

const TEXT = {
    ar: {
        answer: (id) => `🎉 <@${id}> جاوب صح!`,
        group: (id) => `👑 <@${id}> كسب اللعبة!`,
        paid: (reward) => `+${formatCC(reward.amount)} ・ +**${reward.points}** نقطة ・ رصيدك: ${formatCC(reward.balance)}`,
        capped: (reward) => `+**${reward.points}** نقطة ・ وصلت لحد الـ CC من الألعاب النهارده (${number(CC.gamesBot.dailyCap)} ${CC.short}).`,
        failed: '⚠️ حصلت مشكلة في الجايزة، كلّم الإدارة.',
    },
    en: {
        answer: (id) => `🎉 <@${id}> got it right!`,
        group: (id) => `👑 <@${id}> won the game!`,
        paid: (reward) => `+${formatCC(reward.amount)} ・ +**${reward.points}** point(s) ・ balance: ${formatCC(reward.balance)}`,
        capped: (reward) => `+**${reward.points}** point(s) ・ you reached today's games CC limit (${number(CC.gamesBot.dailyCap)} ${CC.short}).`,
        failed: '⚠️ Something went wrong with the reward, tell the staff.',
    },
};

/** The winner line of a rewardWin() result (no pings), in `lang`. */
export function winPayload(lang, userId, reward, kind = 'answer') {
    const text = inLang(lang, TEXT);
    const head = kind === 'group' ? text.group(userId) : text.answer(userId);
    const tail = !reward?.ok ? text.failed : reward.amount > 0 ? text.paid(reward) : text.capped(reward);
    return { content: `${head} ${tail}`, allowedMentions: { parse: [] } };
}
