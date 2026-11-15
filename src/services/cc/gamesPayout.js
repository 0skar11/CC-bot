import { CC } from '../../config/cc.js';
import { updateCCState } from './ccService.js';

// gamesPayout.js — the one capped payout of every game win: the wins Clover announces (gamesBotService.js) and
// the native chat games (src/games/engine/rewards.js). `answer` (first right answer) pays CC.gamesBot.answer,
// anything else (a group game) CC.gamesBot.win, and one member gets at most CC.gamesBot.dailyCap per UTC day
// from all of them together (counted in `ccGamesBot` on the member's record).
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

/** Pays one win. Returns `{ amount, balance }` (amount 0 once today's cap is reached). */
export async function payGamesWin(client, guildId, userId, kind, now = Date.now()) {
    const base = kind === 'answer' ? CC.gamesBot.answer : CC.gamesBot.win;
    return updateCCState(client, guildId, userId, (state, record) => {
        const today = utcDay(now);
        const earned = record.ccGamesBot?.day === today ? record.ccGamesBot.earned : 0;
        const amount = Math.max(0, Math.min(base, CC.gamesBot.dailyCap - earned));
        state.cc += amount;
        state.stats.earned += amount;
        record.ccGamesBot = { day: today, earned: earned + amount };
        return { amount };
    });
}
