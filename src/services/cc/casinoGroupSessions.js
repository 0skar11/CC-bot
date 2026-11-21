// casinoGroupSessions.js — the live side of the casino's group rounds (the rules and money are
// casinoGroupService.js, the embeds casinoGroupUi.js and casinoHorsesUi.js): the round's timer (the bets close, then
// the wheel spins, the horses race (one edit every CASINO.horses.tickMs, then the result) or the rocket takes off), the rocket's flight (one message edit per tick, the automatic cash-outs it passes,
// the crash and, graceMs later, the riders still on board), the round message (edited at most every
// CASINO.groupRenderMs while people join) and the startup check that settles the rounds a restart or a crash
// left behind. The timers live in memory only; the round and every stake are saved, so a lost timer never loses
// a bet (the restart check, or the next bet in that room, settles the round). Every payload is built from the
// saved round, so every edit of its message (and the restart notice) stays in the round's saved `lang`.

import { CASINO } from '../../config/casino.js';
import { economyScopeId } from '../../config/runtime.js';
import { economyScope } from '../../config/sharedEconomy.js';
import { getCasinoRoundPrefix, getEconomyPrefix } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';
import { secureRandomInt } from './casinoService.js';
import {
    attachRoundMessage, cashOutRocket, crashRocket, endDecision, finishRound, joinRound, launchRocket, loadRound, raceHorses, roundFinish,
    refundOrphanStakes, rocketMultiplierAt, rocketTimeTo, roundKey, settleRound, settleStaleRound, spinRoulette, withRoundLock,
} from './casinoGroupService.js';
import {
    groupRecoveryPayload, rocketEndPayload, rocketFlightPayload, rocketTablePayload, rouletteResultPayload, rouletteTablePayload,
} from './casinoGroupUi.js';
import { racePlan, renderRaceTrackPng } from './casinoHorses.js';
import { horsesRacePayload, horsesRecoveryPayload, horsesResultPayload, horsesTablePayload } from './casinoHorsesUi.js';

// key → the round this process plays in that room:
//   { key, game, roundId, channelId, round (its latest saved copy), phase, edit, messageId, randomInt, results,
//     timer, renderTimer, chain, drawing (a flight frame is on its way to Discord) }
const live = new Map();

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });
const isLive = (key, roundId) => live.get(key)?.roundId === roundId;
const TABLES = { roulette: rouletteTablePayload, rocket: rocketTablePayload, horses: horsesTablePayload };
const tablePayload = (round) => (TABLES[round.game] || rocketTablePayload)(round);

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
 * Shows `payload` on the round's message: through its live `edit`, else on its saved message id; a `final` result
 * that can't go there is posted as a new message in the room. Returns true when something was shown.
 */
async function showOn(client, target, payload, { final = false } = {}) {
    if (target.edit && await tryEdit(target.edit, payload)) return true;
    // The message is gone or can't be edited any more: stop trying it on every frame.
    target.edit = null;
    const channel = (target.messageId || final) ? await fetchChannel(client, target.channelId) : null;
    if (!channel) return false;
    if (target.messageId && channel.messages?.edit && await tryEdit((value) => channel.messages.edit(target.messageId, value), payload)) return true;
    target.messageId = null;
    return final && channel.send ? tryEdit((value) => channel.send(value), payload) : false;
}

/** Edits of one round run one after another, so an older frame never lands after a newer one. */
function render(client, entry, payload, options) {
    entry.chain = entry.chain.then(() => showOn(client, entry, payload, options)).catch(() => false);
    return entry.chain;
}

/** While people join: the table is redrawn once, CASINO.groupRenderMs after the first change. */
function requestRender(client, entry) {
    if (entry.renderTimer) return;
    entry.renderTimer = setTimeout(() => {
        entry.renderTimer = null;
        if (live.get(entry.key) === entry && entry.phase === 'open') void render(client, entry, tablePayload(entry.round));
    }, CASINO.groupRenderMs);
    entry.renderTimer.unref?.();
}

function stopTimers(entry) {
    clearTimeout(entry.timer);
    clearTimeout(entry.renderTimer);
    entry.timer = null;
    entry.renderTimer = null;
}

function end(entry) {
    stopTimers(entry);
    if (live.get(entry.key) === entry) live.delete(entry.key);
}

/** Runs `step` for the round after `delay`; a step that fails (database down) is tried again after `retryMs`. */
function schedule(client, entry, delay, step, retryMs = CASINO.idleRetryMs) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(async () => {
        entry.timer = null;
        if (live.get(entry.key) !== entry) return;
        try {
            await step();
        } catch (error) {
            logger.warn(`[CASINO] A ${entry.game} round step failed, trying again: ${error.message}`);
            if (live.get(entry.key) === entry && !entry.timer) schedule(client, entry, retryMs, step, retryMs);
        }
    }, Math.max(0, delay));
    entry.timer.unref?.();
}

/** Settles what is left of the round with `decide` and marks it finished; a failed save throws (and is retried). */
async function settleAndFinish(client, entry, round, decide) {
    const { results, failed } = await settleRound(client, round, decide);
    entry.results.push(...results);
    if (failed.length) throw failed[0].error;
    await finishRound(client, entry.key, round);
}

// ---- Roulette ----

async function spinTheWheel(client, entry) {
    if (entry.phase === 'open') {
        entry.phase = 'spinning';
        clearTimeout(entry.renderTimer);
        await render(client, entry, rouletteTablePayload(entry.round, { spinning: true }));
        await sleep(CASINO.roulette.spinMs);
    }
    const round = await withRoundLock(entry.key, async () => {
        const spun = await spinRoulette(client, entry.key, entry.roundId, { randomInt: entry.randomInt });
        if (spun) await settleAndFinish(client, entry, spun, endDecision(spun));
        return spun;
    });
    end(entry);
    if (round) await render(client, entry, rouletteResultPayload(round, entry.results), { final: true });
}

// ---- Horses ----

/**
 * The race: the finishing order is drawn and saved first (raceHorses), then the message shows CASINO.horses.frames frames,
 * one every tickMs (each edit waits for the one before, so they never pile up), then every bet is settled and the
 * result (with the PNG card) replaces the race. A failed settlement is tried again without running the race twice.
 */
async function runRace(client, entry) {
    clearTimeout(entry.renderTimer);
    const raced = await withRoundLock(entry.key, () => raceHorses(client, entry.key, entry.roundId, { randomInt: entry.randomInt }));
    if (!raced) return end(entry);
    entry.round = raced;
    const { frames, tickMs } = CASINO.horses;
    if (!entry.plan) entry.plan = racePlan(roundFinish(raced), { frames });
    if (entry.phase === 'open') {
        entry.phase = 'racing';
        for (const positions of entry.plan.slice(0, -1)) {
            await render(client, entry, horsesRacePayload(raced, positions));
            await sleep(tickMs);
        }
    }
    const round = await withRoundLock(entry.key, async () => {
        const saved = await loadRound(client, entry.key, entry.roundId);
        if (saved) await settleAndFinish(client, entry, saved, endDecision(saved));
        return saved;
    });
    end(entry);
    if (!round) return undefined;
    const positions = entry.plan.at(-1);
    const png = await renderRaceTrackPng(roundFinish(round), { lang: round.lang, positions });
    return render(client, entry, horsesResultPayload(round, entry.results, { positions, png }), { final: true });
}

// ---- Rocket ----

async function launch(client, entry) {
    clearTimeout(entry.renderTimer);
    const round = await withRoundLock(entry.key, async () => {
        const flying = await launchRocket(client, entry.key, entry.roundId, { randomInt: entry.randomInt });
        if (flying) entry.round = flying;
        return flying;
    });
    if (!round) return end(entry);
    entry.phase = 'flying';
    // The first frame right away; a frame that fails is tried again on the next tick.
    return schedule(client, entry, 0, () => rocketTick(client, entry), CASINO.rocket.tickMs);
}

/** One step of the flight: the crash, or the automatic cash-outs passed and a new frame. */
async function rocketTick(client, entry) {
    const now = Date.now();
    const { flightAt, crash } = entry.round;
    const multiplier = rocketMultiplierAt(now - flightAt);
    if (multiplier >= crash) {
        const round = await withRoundLock(entry.key, async () => {
            const crashed = await crashRocket(client, entry.key, entry.roundId, { now });
            if (crashed) entry.round = crashed;
            return crashed;
        });
        if (!round) return end(entry);
        entry.phase = 'crashed';
        await render(client, entry, rocketEndPayload(round));
        return schedule(client, entry, CASINO.rocket.graceMs, () => land(client, entry));
    }
    for (const rider of entry.round.bets.filter((bet) => bet.target && !bet.cashedOut && bet.target <= multiplier)) {
        await withRoundLock(entry.key, async () => {
            const result = await cashOutRocket(client, entry.key, entry.roundId, rider.userId, { now });
            if (result.ok) entry.round = result.round;
        });
    }
    // The frame is sent without waiting for Discord to take it: the time an edit takes used to be added to every
    // tick (frames came late and drifted) and to the crash itself, which showed up that much after it happened.
    // A frame is skipped while the one before it is still on its way, so slow edits never pile up.
    const drawnAt = Date.now();
    if (!entry.drawing) {
        entry.drawing = true;
        void render(client, entry, rocketFlightPayload(entry.round, multiplier)).finally(() => { entry.drawing = false; });
    }
    // The next frame, or the crash itself when it comes first (the crash point stays in memory, never shown).
    const { tickMs } = CASINO.rocket;
    const untilCrash = flightAt + rocketTimeTo(crash) - Date.now();
    const untilFrame = drawnAt + tickMs - Date.now();
    return schedule(client, entry, Math.max(10, Math.min(untilFrame, untilCrash)), () => rocketTick(client, entry), tickMs);
}

/** graceMs after the crash: the riders still on board are settled (automatic cash-outs, ×100 at the top, else lost). */
async function land(client, entry) {
    const round = await withRoundLock(entry.key, async () => {
        const crashed = await loadRound(client, entry.key, entry.roundId);
        if (crashed) await settleAndFinish(client, entry, crashed, endDecision(crashed));
        return crashed;
    });
    end(entry);
    if (round) await render(client, entry, rocketEndPayload(round, entry.results), { final: true });
}

function closeRound(client, entry) {
    if (entry.game === 'roulette') return spinTheWheel(client, entry);
    return entry.game === 'horses' ? runRace(client, entry) : launch(client, entry);
}

// ---- Commands, buttons and the restart check ----

/**
 * A round a restart (or a dead timer) left behind was settled: its message (or the room) says how. Nothing is
 * shown when every stake had already been settled before (nothing changed for anybody).
 */
async function showRecovered(client, { round, results }) {
    if (!results.length) return false;
    const payload = round.game === 'horses' ? horsesRecoveryPayload(round, results) : groupRecoveryPayload(round, results);
    return showOn(client, { edit: null, messageId: round.messageId, channelId: round.channelId }, payload, { final: true });
}

/** The bet is placed whatever happens to its message: a reply that fails is only logged (a retry would bet twice). */
async function replySafely(reply, payload) {
    try {
        return await reply(payload);
    } catch (error) {
        logger.warn(`[CASINO] Could not answer a group bet: ${error.code || error.message}`);
        return null;
    }
}

/**
 * A member's bet on the room's round (`/casino roulette|rocket|horses`, `روليت 100 احمر`, `صاروخ 100 2`, `rocket 100`,
 * `crash 100 2.5`, `احصنة 100 3`): opens a round when none is open, whose message is the reply (`reply` sends it, `editFor(sent)`
 * edits it later), or joins the open one silently. The round is the room's whatever the language: `lang` (the
 * member's, 'ar' or 'en') only picks the language of a round this bet opens, which its shared message keeps to
 * the end (a member typing the other language joins it as it is). A round left in the room by an earlier run is
 * settled first. `bet` may be ALL_IN (`روليت كل احمر`, `صاروخ كل`): joinRound works it out from the balance in the
 * save that takes it. Returns joinRound's result (casinoGroupService.js); `randomInt` (tests) draws the round's
 * pocket or crash point.
 */
export async function placeGroupBet(client, { guildId, userId, channelId, game, bet, pick = null, lang = null, reply, editFor }, { randomInt = secureRandomInt } = {}) {
    const key = roundKey(game, channelId);
    const result = await withRoundLock(key, async () => {
        const stale = await settleStaleRound(client, key, { isLive: (round) => isLive(key, round.id) });
        if (stale) void showRecovered(client, stale).catch(() => {});
        const joined = await joinRound(client, guildId, userId, game, { channelId, bet, pick, lang });
        const entry = live.get(key);
        if (joined.ok && !joined.created && entry?.roundId === joined.round.id) entry.round = joined.round;
        return joined;
    });
    if (!result.ok) return result;
    if (!result.created) {
        const entry = live.get(key);
        if (entry?.roundId === result.round.id) requestRender(client, entry);
        // No "joined" message: the round's own message already lists every bet and rider (it was re-rendered above).
        return result;
    }
    const entry = {
        key, game, roundId: result.round.id, channelId: String(channelId), round: result.round, phase: 'open',
        edit: null, messageId: null, randomInt, results: [], timer: null, renderTimer: null, chain: Promise.resolve(), drawing: false,
    };
    live.set(key, entry);
    // The timer comes first: the round closes and pays even if its message can't be sent (the result is then
    // posted in the room).
    schedule(client, entry, result.round.closesAt - Date.now(), () => closeRound(client, entry));
    const sent = await replySafely(reply, tablePayload(result.round));
    entry.edit = sent ? editFor(sent) : null;
    if (sent?.id) {
        entry.messageId = String(sent.id);
        await withRoundLock(key, () => attachRoundMessage(client, key, entry.roundId, sent.id)).catch(() => {});
    }
    return result;
}

/**
 * A click on the rocket's cash-out button (`casino:rocket:<roundId>`) in the room `channelId`; `receivedAt` is
 * when the click reached the bot. Returns cashOutRocket's result.
 */
export async function rocketCashOut(client, { channelId, userId, roundId, receivedAt = Date.now() }) {
    const key = roundKey('rocket', channelId);
    return withRoundLock(key, async () => {
        const result = await cashOutRocket(client, key, roundId, userId, { now: receivedAt });
        const entry = live.get(key);
        if (result.ok && entry?.roundId === roundId) entry.round = result.round;
        return result;
    });
}

/**
 * Startup: a round still open inside its betting window (a restart in the middle of the lobby) goes on: its timer is
 * set again for the time left and its message keeps updating, so nobody loses the round to a deploy. Every other
 * group round a restart or a crash left behind is settled from what was saved (see casinoGroupService.js) and its
 * message updated, then every stake whose round is gone is given back.
 * Returns `{ settled, refunded, failed }`: rounds settled, orphan stakes given back, rounds or members that failed
 * (plus `resumed` when a lobby round went on).
 */
export async function recoverGroupGames(client, { now = Date.now() } = {}) {
    const summary = { settled: 0, refunded: 0, failed: 0 };
    const rounds = getCasinoRoundPrefix(economyScope());
    for (const key of await client.db.list(rounds) || []) {
        try {
            const open = await withRoundLock(key, async () => {
                const round = await loadRound(client, key);
                if (!round || isLive(key, round.id) || round.status !== 'open' || !(round.closesAt > now)) return false;
                const entry = {
                    key, game: round.game, roundId: round.id, channelId: String(round.channelId), round, phase: 'open',
                    edit: null, messageId: round.messageId ? String(round.messageId) : null, randomInt: secureRandomInt, results: [], timer: null, renderTimer: null, chain: Promise.resolve(), drawing: false,
                };
                live.set(key, entry);
                schedule(client, entry, round.closesAt - now, () => closeRound(client, entry));
                requestRender(client, entry);
                return true;
            });
            if (open) { summary.resumed = (summary.resumed || 0) + 1; continue; }
            const stale = await withRoundLock(key, () => settleStaleRound(client, key, { now, isLive: (round) => isLive(key, round.id) }));
            if (!stale) continue;
            if (stale.failed.length) summary.failed += 1;
            else summary.settled += 1;
            await showRecovered(client, stale);
        } catch (error) {
            summary.failed += 1;
            logger.warn(`[CASINO] Could not recover the group round ${key}: ${error.message}`);
        }
    }
    const economy = getEconomyPrefix(economyScope());
    for (const key of await client.db.list(economy) || []) {
        const userId = key.slice(economy.length);
        try {
            const record = await client.db.get(key, null);
            if (!Array.isArray(record?.ccCasinoBets) || !record.ccCasinoBets.length) continue;
            summary.refunded += (await refundOrphanStakes(client, economyScopeId, userId)).refunded.length;
        } catch (error) {
            summary.failed += 1;
            logger.warn(`[CASINO] Could not check the group bets of ${userId}: ${error.message}`);
        }
    }
    return summary;
}

/** For tests. */
export function resetGroupSessions() {
    for (const entry of live.values()) stopTimers(entry);
    live.clear();
}

/** For tests: the round this process plays in the room. */
export const liveRound = (game, channelId) => live.get(roundKey(game, channelId)) || null;
