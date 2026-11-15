// games.js — every knob of the native chat games (src/games/, plan: docs/GAMES_PLAN.md): round and lobby times,
// rewards, points, the points-to-CC rate, the rooms and the event roles. The CC of a win and the daily cap are
// CC.gamesBot (src/config/cc.js), the same object the Clover payout reads, so one member gets at most
// CC.gamesBot.dailyCap a UTC day from every game together (src/services/cc/gamesPayout.js).
// Rooms: GAMES_CHANNEL_IDS (channels or categories) when set, otherwise the bot's usual channels (BOURSE_CHANNEL_IDS).
// Event admins (group games): Manage Server, a role in EVENT_ROLE_IDS, or an owner (src/config/owners.js).

import { CC } from './cc.js';
import { isAllowedChannel, prefix } from './runtime.js';

const snowflake = /^\d{17,20}$/u;
const idList = (value) => String(value || '').split(',').map((id) => id.trim()).filter(Boolean);

export const GAMES = {
    // A typed game starts with the PREFIX or a dot and then a game word (`!اسرع`, `.اسرع`): plain chat never starts one.
    prefixes: [...new Set([prefix, '.'])].sort((a, b) => b.length - a.length),
    // How long a question waits for the first right answer.
    roundMs: 30_000,
    // A member's answers count at most once every this many ms (anything typed faster is ignored).
    answerCooldownMs: 700,
    // CC of a win: `answer` (first right answer), `win` (group game), `dailyCap` (per member per UTC day).
    rewards: CC.gamesBot,
    // Points of a win, kept per server and across all servers (`توب`, `عالمي`).
    points: { answer: 1, group: 5 },
    // `convert`: points to CC.
    convert: { ccPerPoint: 100, minPoints: 5 },
    // Join lobbies (dual and group games): defaults when a game gives none, and how often the countdown is edited.
    lobby: { joinSeconds: 60, minPlayers: 2, maxPlayers: 25, tickMs: 10_000 },
    // A room is never held longer than this, whatever a game does.
    maxLifetimeMs: 30 * 60_000,
    // The same short notice (not an admin, a game is running) is sent to one member at most this often.
    noticeGapMs: 5_000,
    // Rows on `توب` and `عالمي`.
    topSize: 10,
    color: 0x8e44ad,
};

// `g:<action>:<lobbyId>`: the lobby buttons (src/games/engine/lobby.js, src/interactions/buttons/store/games.js).
export const GAMES_BUTTON_PREFIX = 'g';

export const gamesChannelIds = new Set(idList(process.env.GAMES_CHANNEL_IDS));
export const eventRoleIds = new Set(idList(process.env.EVENT_ROLE_IDS));

/** The games' rooms: GAMES_CHANNEL_IDS (channels or categories), or the bot's usual channels when it is empty. */
export function isGamesChannel(channel, channelId) {
    if (!gamesChannelIds.size) return isAllowedChannel(channel, channelId);
    return gamesChannelIds.has(channel?.id || channelId) || gamesChannelIds.has(channel?.parentId);
}

/** Startup check (src/app.js): the configured IDs must be Discord IDs. */
export function validateGamesConfig() {
    if ([...gamesChannelIds].some((id) => !snowflake.test(id))) throw new Error('GAMES_CHANNEL_IDS contains an invalid ID');
    if ([...eventRoleIds].some((id) => !snowflake.test(id))) throw new Error('EVENT_ROLE_IDS contains an invalid ID');
}
