// rewards.js — what a chat game win pays: CC through the payout shared with Clover's wins
// (src/services/cc/gamesPayout.js: CC.gamesBot.answer within CC.gamesBot.dailyCap a member a UTC day, and
// CC.gamesBot.win for a group win with no limit),
// plus points (GAMES.points: answer 1, group 5) and one more win for the game, in the server and globally
// (points.js). The points are given even once today's CC cap is reached. `convert` turns a member's points of the
// server into CC at GAMES.convert.ccPerPoint (at least GAMES.convert.minPoints asked at once), paid from the SAME
// daily cap as the wins (payGamesConvert): past it a conversion is trimmed to whole points, and only the points
// actually paid are taken.

import { CC, formatCC } from '../../config/cc.js';
import { GAMES } from '../../config/games.js';
import { payGamesConvert, payGamesWin } from '../../services/cc/gamesPayout.js';
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
 * Turns up to `points` of the member's points in this server into CC, within today's games CC cap (shared with the
 * wins). Returns { ok: true, points, requested, amount, balance, left, trimmed } (points = the points actually paid,
 * fewer than requested when the cap was near: trimmed = true), or { ok: false, reason: 'min' | 'not_enough' |
 * 'capped', min, have?, cap? } ('capped': nothing could be paid today, no point was taken).
 */
export async function convertPoints(client, guildId, userId, points, { now = Date.now() } = {}) {
    const { ccPerPoint, minPoints } = GAMES.convert;
    if (!Number.isSafeInteger(points) || points < minPoints) return { ok: false, reason: 'min', min: minPoints };
    if (!Number.isSafeInteger(points * ccPerPoint)) return { ok: false, reason: 'min', min: minPoints };
    const spent = await spendPoints(client, guildId, userId, points, (wanted) => payGamesConvert(client, guildId, userId, wanted, ccPerPoint, now));
    if (!spent.ok) return { ...spent, min: minPoints };
    if (spent.spent === 0) return { ok: false, reason: 'capped', min: minPoints, cap: CC.gamesBot.dailyCap };
    logger.info(`[GAMES] ${userId} converted ${spent.spent} points (of ${points}) to ${spent.paid.amount} CC`);
    return {
        ok: true, points: spent.spent, requested: points, amount: spent.paid.amount, balance: spent.paid.balance,
        left: spent.left, trimmed: spent.spent < points,
    };
}

const TEXT = {
    ar: {
        answer: (id) => `🎉 <@${id}> جاوب صح!`,
        group: (id) => `👑 <@${id}> كسب اللعبة!`,
        paid: (reward) => `+${formatCC(reward.amount)} ・ +**${reward.points}** نقطة ・ رصيدك: ${formatCC(reward.balance)}`,
        capped: (reward) => `+**${reward.points}** نقطة ・ وصلت لحد الـ CC من الألعاب النهارده (${number(CC.gamesBot.dailyCap)} ${CC.short}).`,
        failed: '⚠️ حصلت مشكلة في الجايزة، كلّم الإدارة.',
        convertCapped: (cap) => `❌ وصلت لحد الـ CC من الألعاب النهارده (${number(cap)} ${CC.short})، والتحويل بيتحسب منه. نقاطك زي ما هي، جرّب بكرة.`,
        convertTrimmed: (result) => `ℹ️ اتحوّل **${number(result.points)}** نقطة بس من **${number(result.requested)}** عشان حد الـ CC من الألعاب النهارده (${number(CC.gamesBot.dailyCap)} ${CC.short})، والباقي لسه معاك.`,
    },
    en: {
        answer: (id) => `🎉 <@${id}> got it right!`,
        group: (id) => `👑 <@${id}> won the game!`,
        paid: (reward) => `+${formatCC(reward.amount)} ・ +**${reward.points}** point(s) ・ balance: ${formatCC(reward.balance)}`,
        capped: (reward) => `+**${reward.points}** point(s) ・ you reached today's games CC limit (${number(CC.gamesBot.dailyCap)} ${CC.short}).`,
        failed: '⚠️ Something went wrong with the reward, tell the staff.',
        convertCapped: (cap) => `❌ You reached today's games CC limit (${number(cap)} ${CC.short}), and conversions count toward it. Your points are untouched, try again tomorrow.`,
        convertTrimmed: (result) => `ℹ️ Only **${number(result.points)}** of **${number(result.requested)}** points were converted because of today's games CC limit (${number(CC.gamesBot.dailyCap)} ${CC.short}); you keep the rest.`,
    },
};

/** The winner line of a rewardWin() result (no pings), in `lang`. */
export function winPayload(lang, userId, reward, kind = 'answer') {
    const text = inLang(lang, TEXT);
    const head = kind === 'group' ? text.group(userId) : text.answer(userId);
    const tail = !reward?.ok ? text.failed : reward.amount > 0 ? text.paid(reward) : text.capped(reward);
    return { content: `${head} ${tail}`, allowedMentions: { parse: [] } };
}

/**
 * The daily-limit line of a convertPoints() result, in `lang`: the whole answer for reason 'capped', an extra line
 * for a trimmed conversion, else null (the usual converted / min / not-enough lines apply).
 */
export function convertLimitNotice(lang, result) {
    const text = inLang(lang, TEXT);
    if (result?.ok === false && result.reason === 'capped') return text.convertCapped(result.cap ?? CC.gamesBot.dailyCap);
    if (result?.ok && result.trimmed) return text.convertTrimmed(result);
    return null;
}
