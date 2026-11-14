// casinoSessions.js — the live side of the casino's saved games, the mines boards and the chickens (the rules and
// money are casinoService.js): one lock per member, so their clicks, the timeout and the game's edits happen in
// order; the inactivity timer that cashes a game out by itself CASINO.idleMs after its last move; the start
// cooldown; and the startup check that settles the games a restart or a crash left behind. The timers live in
// memory only: the game itself is saved in the member's record, so a lost timer never loses a bet (the next start
// or restart settles the game). Every step here works on whichever game is saved (readSavedGame,
// settleIdleGame) and shows it with its own embed (gameResultPayload). The messages and notices are in the
// game's saved language (its `lang`). The group rounds are casinoGroupSessions.js.

import { CASINO } from '../../config/casino.js';
import { economyScopeId } from '../../config/runtime.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { getEconomyPrefix } from '../../utils/database/keys.js';
import { Mutex } from '../../utils/mutex.js';
import { logger } from '../../utils/logger.js';
import { readSavedGame, settleIdleGame } from './casinoService.js';
import { gameResultPayload, gameNoticeText, blackjackRevealPayload, canFlipCards } from './casinoUi.js';

// How long the flipping card (its edge) stays before a blackjack hand's result.
export const FLIP_MS = { value: 650 };

// userId → { gameId, edit, timer }: the running game's inactivity timer.
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
 * Shows an ended game (a mines board or a chicken, each with its own embed): through `edit` (the live message)
 * when given, else on the game's saved message, else as a short notice in its room, in the game's language.
 * Returns true when something was shown.
 */
export async function showGameResult(client, result, userId, edit = null) {
    // A blackjack hand ending with the dealer's hidden card turned over: one frame with the card on its edge first.
    if (edit && result.game?.game === 'blackjack' && result.game.dealerHand?.length >= 2 && canFlipCards()) {
        if (await tryEdit(edit, blackjackRevealPayload(result, userId))) await new Promise((resolve) => { setTimeout(resolve, FLIP_MS.value); });
    }
    const payload = gameResultPayload(result, userId);
    if (edit && await tryEdit(edit, payload)) return true;
    const channelId = result.game?.channelId || result.channelId;
    const channel = channelId ? await fetchChannel(client, channelId) : null;
    if (!channel) return false;
    const messageId = result.game?.messageId;
    if (messageId && channel.messages?.edit && await tryEdit((value) => channel.messages.edit(messageId, value), payload)) return true;
    if (!channel.send) return false;
    return tryEdit((value) => channel.send(value), { content: gameNoticeText(result, userId), allowedMentions: { users: [userId] } });
}

/** The name showGameResult had when mines was the only saved game. */
export const showMinesResult = showGameResult;

/** Stops the inactivity timer of the member's game (only game `gameId` when given). */
export function cancelIdleCashOut(userId, gameId = null) {
    const entry = timers.get(userId);
    if (!entry || (gameId !== null && entry.gameId !== gameId)) return;
    clearTimeout(entry.timer);
    timers.delete(userId);
}

/**
 * (Re)starts the inactivity timer of a running game (mines or chicken): `idleMs` after its last move it cashes
 * out by itself at its multiplier (settleIdleGame) and the game shows the result through `edit`, or on its
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
                const result = await settleIdleGame(client, game.guildId || economyScopeId, userId, game.id, { idleMs });
                // The game moved without a new timer here (another bot process took the click): wait for its new deadline.
                if (result.reason === 'active') {
                    if (!timers.has(userId)) scheduleIdleCashOut(client, result.game, userId, { edit, idleMs });
                    return null;
                }
                if (result.ok) await showGameResult(client, result, userId, edit);
                return null;
            });
        } catch (error) {
            logger.warn(`[CASINO] Could not cash out an idle ${game.game || 'mines'} game: ${error.message}`);
            if (!timers.has(userId)) arm(CASINO.idleRetryMs);
        }
    }
    arm(game.lastActionAt + idleMs - now);
}

/**
 * Startup: every game saved in the economy (a mines board or a chicken) is settled when its timeout already
 * passed (the bot was off or crashed), cashing out at its multiplier (the bet back when nothing was opened or
 * crossed), and the others get their timer back, so a restart never eats a bet. Returns `{ settled, resumed, failed }`.
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
            const game = readSavedGame(record.ccCasino);
            if (game && now - game.lastActionAt < idleMs) {
                scheduleIdleCashOut(client, game, userId, { idleMs, now });
                summary.resumed += 1;
                continue;
            }
            await withCasinoLock(userId, async () => {
                const result = await settleIdleGame(client, game?.guildId || economyScopeId, userId, null, { now, idleMs });
                if (!result.ok) return;
                summary.settled += 1;
                await showGameResult(client, result, userId);
            });
        } catch (error) {
            summary.failed += 1;
            logger.warn(`[CASINO] Could not recover the casino game of ${userId}: ${error.message}`);
        }
    }
    return summary;
}

/** A new game settled an idle mines board or chicken first (casinoService.js): stop its timer and update its old message. */
export function closePreviousBoard(client, previous, userId) {
    if (!previous) return;
    if (previous.game) cancelIdleCashOut(userId, previous.game.id);
    showGameResult(client, previous, userId).catch(() => {});
}

/** For tests. */
export function resetCasinoSessions() {
    for (const entry of timers.values()) clearTimeout(entry.timer);
    timers.clear();
    lastStart.clear();
}
