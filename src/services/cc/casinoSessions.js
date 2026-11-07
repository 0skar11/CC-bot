// casinoSessions.js — the live side of the casino's mines boards (the rules and money are casinoService.js):
// one lock per member, so their clicks, the timeout and the board edits happen in order; the inactivity
// timer that cashes a board out by itself CASINO.idleMs after its last move; the start cooldown; and the
// startup check that settles the boards a restart or a crash left behind. The timers live in memory only:
// the game itself is saved in the member's record, so a lost timer never loses a bet (the next start or
// restart settles the board). Also the crash animation (the bet is settled before it starts). The group
// rounds are casinoGroupSessions.js.

import { CASINO } from '../../config/casino.js';
import { economyScopeId } from '../../config/runtime.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { getEconomyPrefix } from '../../utils/database/keys.js';
import { Mutex } from '../../utils/mutex.js';
import { logger } from '../../utils/logger.js';
import { crashFrames, readMinesGame, settleIdleMines } from './casinoService.js';
import { crashFramePayload, crashResultPayload, minesResultPayload, minesNoticeText } from './casinoUi.js';

// userId → { gameId, edit, timer }: the running board's inactivity timer.
const timers = new Map();
// userId → when they last started a game (CASINO.cooldownMs).
const lastStart = new Map();

/** True (and nothing is started) when the member started a game less than CASINO.cooldownMs ago. */
export function onCasinoCooldown(userId, now = Date.now()) {
    if (now - (lastStart.get(userId) || 0) < CASINO.cooldownMs) return true;
    lastStart.set(userId, now);
    return false;
}

/** Runs `task` alone for the member: a click, the timeout or a start, with its board edit. */
export function withCasinoLock(userId, task) {
    return Mutex.runExclusive(`casino-ui:${userId}`, task);
}

async function tryEdit(edit, payload) {
    try {
        await edit(payload);
        return true;
    } catch {
        return false;
    }
}

async function fetchChannel(client, channelId) {
    try {
        return await client.channels?.fetch?.(channelId) ?? null;
    } catch {
        return null;
    }
}

/**
 * Shows an ended board: through `edit` (the live message) when given, else on the board's saved message,
 * else as a short notice in its room. Returns true when something was shown.
 */
export async function showMinesResult(client, result, userId, edit = null) {
    const payload = minesResultPayload(result, userId);
    if (edit && await tryEdit(edit, payload)) return true;
    const channelId = result.game?.channelId || result.channelId;
    const channel = channelId ? await fetchChannel(client, channelId) : null;
    if (!channel) return false;
    const messageId = result.game?.messageId;
    if (messageId && channel.messages?.edit && await tryEdit((value) => channel.messages.edit(messageId, value), payload)) return true;
    if (!channel.send) return false;
    return tryEdit((value) => channel.send(value), { content: minesNoticeText(result, userId), allowedMentions: { users: [userId] } });
}

/** Stops the inactivity timer of the member's board (only board `gameId` when given). */
export function cancelIdleCashOut(userId, gameId = null) {
    const entry = timers.get(userId);
    if (!entry || (gameId !== null && entry.gameId !== gameId)) return;
    clearTimeout(entry.timer);
    timers.delete(userId);
}

/**
 * (Re)starts the inactivity timer of a running board: `idleMs` after its last move it cashes out by
 * itself at its multiplier (settleIdleMines) and the board shows the result through `edit`, or on its
 * saved message when there is no `edit` (after a restart). A save that fails is tried again later.
 */
export function scheduleIdleCashOut(client, game, userId, { edit = null, idleMs = CASINO.idleMs, now = Date.now() } = {}) {
    cancelIdleCashOut(userId);
    const entry = { gameId: game.id, edit, timer: null };
    const arm = (delay) => {
        entry.timer = setTimeout(run, Math.max(0, delay));
        entry.timer.unref?.();
        timers.set(userId, entry);
    };
    async function run() {
        if (timers.get(userId) !== entry) return;
        timers.delete(userId);
        try {
            await withCasinoLock(userId, async () => {
                const result = await settleIdleMines(client, game.guildId || economyScopeId, userId, game.id, { idleMs });
                // The board moved without a new timer here (another bot process took the click): wait for its new deadline.
                if (result.reason === 'active') {
                    if (!timers.has(userId)) scheduleIdleCashOut(client, result.game, userId, { edit, idleMs });
                    return null;
                }
                if (result.ok) await showMinesResult(client, result, userId, edit);
                return null;
            });
        } catch (error) {
            logger.warn(`[CASINO] Could not cash out an idle mines game: ${error.message}`);
            if (!timers.has(userId)) arm(CASINO.idleRetryMs);
        }
    }
    arm(game.lastActionAt + idleMs - now);
}

/**
 * Startup: every mines board saved in the economy is settled when its timeout already passed (the bot was
 * off or crashed), cashing out at its multiplier (the bet back when nothing was opened), and the others get
 * their timer back, so a restart never eats a bet. Returns `{ settled, resumed, failed }`.
 */
export async function recoverCasinoGames(client, { now = Date.now(), idleMs = CASINO.idleMs } = {}) {
    const prefix = getEconomyPrefix(economyScope());
    const keys = await client.db.list(prefix);
    const summary = { settled: 0, resumed: 0, failed: 0 };
    for (const key of Array.isArray(keys) ? keys : []) {
        const userId = key.slice(prefix.length);
        try {
            const record = await client.db.get(key, null);
            if (!record?.ccCasino) continue;
            const game = readMinesGame(record.ccCasino);
            if (game && now - game.lastActionAt < idleMs) {
                scheduleIdleCashOut(client, game, userId, { idleMs, now });
                summary.resumed += 1;
                continue;
            }
            await withCasinoLock(userId, async () => {
                const result = await settleIdleMines(client, game?.guildId || economyScopeId, userId, null, { now, idleMs });
                if (!result.ok) return;
                summary.settled += 1;
                await showMinesResult(client, result, userId);
            });
        } catch (error) {
            summary.failed += 1;
            logger.warn(`[CASINO] Could not recover the mines game of ${userId}: ${error.message}`);
        }
    }
    return summary;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

/**
 * The crash animation of a settled crash bet: `send` posts ×1.00, then `editFor(sent)` edits it once per step
 * (CASINO.crash.frameMs apart, inside Discord's edit rate limit, never on every tick) up to where it ends, then
 * shows the result. A failed edit only cuts the animation short; the result is then sent again once.
 */
export async function animateCrash(result, user, { send, editFor }) {
    const sent = await send(crashFramePayload(result, user, 100));
    const edit = editFor(sent);
    const end = result.payout > 0 ? result.target : Math.max(100, result.crash);
    for (const step of crashFrames(end)) {
        await sleep(CASINO.crash.frameMs);
        if (!(await tryEdit(edit, crashFramePayload(result, user, step)))) break;
    }
    await sleep(CASINO.crash.frameMs);
    if (!(await tryEdit(edit, crashResultPayload(result, user)))) await tryEdit(send, crashResultPayload(result, user));
    return sent;
}

/** A new game settled an idle board first (casinoService.js): stop its timer and update its old message. */
export function closePreviousBoard(client, previous, userId) {
    if (!previous) return;
    if (previous.game) cancelIdleCashOut(userId, previous.game.id);
    showMinesResult(client, previous, userId).catch(() => {});
}

/** For tests. */
export function resetCasinoSessions() {
    for (const entry of timers.values()) clearTimeout(entry.timer);
    timers.clear();
    lastStart.clear();
}
