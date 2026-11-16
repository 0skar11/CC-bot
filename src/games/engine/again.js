// again.js — the `🔁 العب تاني` / `🔁 Play again` button on the last message of a round (the win reply or the
// time's-up reveal; a lobby game's last message). Its customId is `g:again:<gameId>` (GAMES_BUTTON_PREFIX,
// src/interactions/buttons/store/games.js); pressing it starts a new round of the same game in the same room
// through the router (src/games/router.js handleAgainButton), under the same rule as typing the command.
// A button works once and for AGAIN_LIFETIME_MS: after that (or after a restart: they live in memory) it is
// stale, and its message loses it. A room starts at most one round from a button (or the menu) every
// AGAIN_COOLDOWN_MS.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GAMES_BUTTON_PREFIX } from '../../config/games.js';
import { logger } from '../../utils/logger.js';
import { realClock } from './session.js';

export const AGAIN_ACTION = 'again';
export const AGAIN_LIFETIME_MS = 60_000;
export const AGAIN_COOLDOWN_MS = 3_000;

const LABEL = { ar: 'العب تاني', en: 'Play again' };

// messageId → { gameId, lang, channelId, message, timer, clock }: the live buttons.
const armed = new Map();
// channelId → when a button or the menu last started a round there.
const lastStart = new Map();

export const againCustomId = (gameId) => `${GAMES_BUTTON_PREFIX}:${AGAIN_ACTION}:${gameId}`;

/** The row with the play-again button of `gameId`. */
export function againRow(gameId, lang = 'ar') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(againCustomId(gameId)).setLabel(LABEL[lang === 'en' ? 'en' : 'ar']).setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    );
}

/** `payload` with the play-again row added after its own components (at most 5 rows). */
export function withAgain(payload, gameId, lang = 'ar') {
    const components = [...(payload?.components || [])].slice(0, 4);
    return { ...payload, components: [...components, againRow(gameId, lang)] };
}

const strip = (message) => Promise.resolve()
    .then(() => message?.edit?.({ components: [] }))
    .catch((error) => logger.warn(`[GAMES] Could not remove a play-again button: ${error?.code || error?.message || error}`));

/** Forgets the button of `messageId` (and its timer). Returns its state, or null when it was not live. */
export function disarm(messageId) {
    const state = armed.get(String(messageId ?? ''));
    if (!state) return null;
    armed.delete(String(messageId));
    state.clock.clearTimeout(state.timer);
    return state;
}

/**
 * Makes the button on `message` live for AGAIN_LIFETIME_MS; then it is removed from the message. `clock` is the
 * session's (a fake one in tests). Returns `message`.
 */
export function armAgain(message, { gameId, lang = 'ar', channelId = null, clock = realClock } = {}) {
    if (!message?.id || !gameId) return message;
    disarm(message.id);
    const state = { gameId, lang, channelId: String(channelId || message.channelId || message.channel?.id || ''), message, clock, timer: null };
    state.timer = clock.setTimeout(() => {
        if (armed.get(message.id) !== state) return;
        armed.delete(message.id);
        strip(message);
    }, AGAIN_LIFETIME_MS);
    state.timer?.unref?.();
    armed.set(message.id, state);
    if (armed.size > 1000) disarm(armed.keys().next().value);
    return message;
}

/** The live button of `messageId`, or null (stale: used, timed out, or from before a restart). */
export const armedAgain = (messageId) => armed.get(String(messageId ?? '')) || null;

/** Milliseconds left before `channelId` may start another round from a button or the menu (0: now). */
export function cooldownLeft(channelId, now) {
    const last = lastStart.get(String(channelId));
    return last === undefined ? 0 : Math.max(0, AGAIN_COOLDOWN_MS - (now - last));
}

/** Records that `channelId` started a round from a button or the menu at `now`. */
export function markStarted(channelId, now) {
    lastStart.delete(String(channelId));
    lastStart.set(String(channelId), now);
    if (lastStart.size > 1000) lastStart.delete(lastStart.keys().next().value);
}

/** Removes the buttons of a message (a stale press). Never throws. */
export const removeAgain = strip;

/** For tests: forgets every button and cooldown. */
export function forgetAgain() {
    for (const id of [...armed.keys()]) disarm(id);
    lastStart.clear();
}
