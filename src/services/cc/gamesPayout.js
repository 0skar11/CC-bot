import { CC } from '../../config/cc.js';
import { updateCCState } from './ccService.js';

// gamesPayout.js — the payout of every game win: the wins Clover announces (gamesBotService.js) and the native
// chat games (src/games/engine/rewards.js). `answer` (first right answer) pays CC.gamesBot.answer and one member
// gets at most CC.gamesBot.dailyCap per UTC day from those wins (counted in `ccGamesBot` on the member's record).
// Anything else (a group game win) pays CC.gamesBot.win with no limit: it is never trimmed by the cap and never
// counted in `ccGamesBot`. The chat games' points-to-CC conversion (payGamesConvert) is paid from the same daily
// cap as the answer wins (and counted in it), so points never pay past it.
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

/** The CC already paid to the member today ({ today, earned }) from the record's `ccGamesBot`. */
function paidToday(record, now) {
    const today = utcDay(now);
    const earned = record.ccGamesBot?.day === today && Number.isSafeInteger(record.ccGamesBot.earned) ? record.ccGamesBot.earned : 0;
    return { today, earned };
}

/** Credits `amount` CC (already within the cap) and counts it in today's `ccGamesBot`. */
function credit(state, record, today, earned, amount) {
    state.cc += amount;
    state.stats.earned += amount;
    record.ccGamesBot = { day: today, earned: earned + amount };
}

/**
 * Pays one win. Returns `{ amount, balance }`. An `answer` win is trimmed to what is left of today's cap (amount 0
 * once it is reached); a group win (any other kind) always pays CC.gamesBot.win and leaves `ccGamesBot` untouched.
 */
export async function payGamesWin(client, guildId, userId, kind, now = Date.now()) {
    if (kind !== 'answer') {
        const amount = CC.gamesBot.win;
        return updateCCState(client, guildId, userId, (state) => {
            state.cc += amount;
            state.stats.earned += amount;
            return { amount };
        });
    }
    return updateCCState(client, guildId, userId, (state, record) => {
        const { today, earned } = paidToday(record, now);
        const amount = Math.max(0, Math.min(CC.gamesBot.answer, CC.gamesBot.dailyCap - earned));
        credit(state, record, today, earned, amount);
        return { amount };
    });
}

/**
 * Pays up to `points` points at `ccPerPoint` CC each, within what is left of today's cap (whole points only).
 * Returns `{ points, amount, balance }`: the points actually paid (0 at the cap, then nothing is saved and
 * `balance` is null) and their CC.
 */
export async function payGamesConvert(client, guildId, userId, points, ccPerPoint, now = Date.now()) {
    if (!Number.isSafeInteger(points) || points < 0 || !Number.isSafeInteger(ccPerPoint) || ccPerPoint < 1) throw new Error('Invalid conversion');
    return updateCCState(client, guildId, userId, (state, record) => {
        const { today, earned } = paidToday(record, now);
        const paid = Math.min(points, Math.floor(Math.max(0, CC.gamesBot.dailyCap - earned) / ccPerPoint));
        if (paid === 0) return { points: 0, amount: 0, balance: null, skipSave: true };
        const amount = paid * ccPerPoint;
        credit(state, record, today, earned, amount);
        return { points: paid, amount };
    });
}
