// session.js — one running game per room. A session holds the room (isBusy) from start to end, owns every timer
// the game sets through it (they are all cleared when it ends) and runs the game's clean-ups (a round's collector,
// a lobby's buttons) once, whatever ends it: the game finishing, an error, abortAll() on SIGINT/SIGTERM (src/app.js)
// or the safety lifetime GAMES.maxLifetimeMs, so a room never stays stuck. Sessions live in memory only: nothing
// of a game is saved, a restart simply frees every room (stale lobby buttons then say the game ended).
// `clock` ({ now, setTimeout, clearTimeout }) is the real one; tests pass a fake one.

import { randomBytes } from 'node:crypto';
import { GAMES } from '../../config/games.js';
import { logger } from '../../utils/logger.js';

export const realClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
};

// channelId → the room's running session.
const sessions = new Map();

function runSafely(fn, label, ...args) {
    try {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') result.catch((error) => logger.warn(`[GAMES] ${label} failed: ${error?.message || error}`));
    } catch (error) {
        logger.warn(`[GAMES] ${label} failed: ${error?.message || error}`);
    }
}

export class GameSession {
    #resolve;

    constructor({ channelId, guildId = null, gameId = null, starterId = null, clock = realClock, maxLifetimeMs = GAMES.maxLifetimeMs } = {}) {
        if (!channelId) throw new Error('A game session needs a channel');
        this.id = randomBytes(6).toString('hex');
        this.channelId = String(channelId);
        this.guildId = guildId;
        this.gameId = gameId;
        this.starterId = starterId;
        this.clock = clock;
        this.startedAt = clock.now();
        this.ended = false;
        this.endReason = null;
        // Free space for the game (scores, the current round...), and the members already told a game is running.
        this.data = {};
        this.notices = new Set();
        this.timers = new Set();
        this.cleanups = [];
        this.finished = new Promise((resolve) => { this.#resolve = resolve; });
        if (maxLifetimeMs > 0) this.setTimeout(() => this.end('expired'), maxLifetimeMs);
    }

    /** A timer that is cleared when the session ends. Returns its handle, or null once the session has ended. */
    setTimeout(fn, ms) {
        if (this.ended) return null;
        const handle = this.clock.setTimeout(() => {
            this.timers.delete(handle);
            if (!this.ended) runSafely(fn, `timer of ${this.gameId || 'a game'}`);
        }, Math.max(0, Number(ms) || 0));
        handle?.unref?.();
        this.timers.add(handle);
        return handle;
    }

    clearTimeout(handle) {
        if (handle === null || handle === undefined) return;
        this.timers.delete(handle);
        this.clock.clearTimeout(handle);
    }

    /** Runs `fn(reason)` once when the session ends (at once if it already has). Returns a function that removes it. */
    onEnd(fn) {
        if (this.ended) {
            runSafely(fn, 'end hook', this.endReason);
            return () => {};
        }
        this.cleanups.push(fn);
        return () => {
            const index = this.cleanups.indexOf(fn);
            if (index !== -1) this.cleanups.splice(index, 1);
        };
    }

    /** Ends the session once: clears its timers, frees the room, runs the end hooks (newest first). */
    end(reason = 'done') {
        if (this.ended) return false;
        this.ended = true;
        this.endReason = reason;
        this.endedAt = this.clock.now();
        for (const handle of this.timers) this.clock.clearTimeout(handle);
        this.timers.clear();
        if (sessions.get(this.channelId) === this) sessions.delete(this.channelId);
        for (const fn of this.cleanups.splice(0).reverse()) runSafely(fn, 'end hook', reason);
        this.#resolve(reason);
        return true;
    }
}

/** Starts a session in a free room; null when the room already has one. */
export function startSession(options = {}) {
    const channelId = String(options.channelId || '');
    if (!channelId) throw new Error('A game session needs a channel');
    if (isBusy(channelId)) return null;
    const session = new GameSession({ ...options, channelId });
    sessions.set(channelId, session);
    return session;
}

export const getSession = (channelId) => sessions.get(String(channelId)) || null;
export const isBusy = (channelId) => Boolean(sessions.get(String(channelId))?.ended === false);
export const activeSessions = () => [...sessions.values()];

/** Ends the room's session (if any). */
export function endSession(channelId, reason = 'done') {
    return getSession(channelId)?.end(reason) || false;
}

/** Ends every session (shutdown). Returns how many were running. */
export function abortAll(reason = 'shutdown') {
    const running = activeSessions();
    for (const session of running) session.end(reason);
    return running.length;
}
