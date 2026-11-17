// games.js — every knob of the native chat games (src/games/, plan: docs/GAMES_PLAN.md): round and lobby times,
// rewards, points, the points-to-CC rate, the rooms and who may start a game. The CC of a win and the daily cap are
// CC.gamesBot (src/config/cc.js), the same object the Clover payout reads: answer wins and conversions share
// CC.gamesBot.dailyCap a member a UTC day, group wins have no limit (src/services/cc/gamesPayout.js).
// Who may start a game (src/games/router.js): a trusted member (src/games/engine/admin.js: an owner, Manage Server, a
// role in EVENT_ROLE_IDS, a user in TRUSTED_USER_IDS or a role in TRUSTED_ROLE_IDS) in any channel of an allowed
// guild; anyone else only in the open channels, OPEN_GAMES_CHANNEL_IDS (channels or categories), which default to
// DEFAULT_OPEN_GAMES_CHANNEL_ID when the env is empty or unset.
// The general commands (`اوامر`, `توب`, `نقاط`...) answer for everyone in GAMES_CHANNEL_IDS (channels or
// categories) when set, otherwise the bot's usual channels (BOURSE_CHANNEL_IDS), and in the bot's channels.

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
    // Join lobbies (dual and group games): defaults when a game gives none. The time left is a live Discord
    // countdown (`<t:UNIX:R>`, src/games/engine/countdown.js), so the lobby message is never edited just for it.
    lobby: { joinSeconds: 60, minPlayers: 2, maxPlayers: 25 },
    // Two-player board games (kind 'dual': xo, حجره, توصيل; src/games/engine/duel.js): the opponent joins within
    // `joinSeconds`, each move (each round of حجره) has `moveSeconds`, and a player whose time runs out forfeits.
    // `winKind`: how a dual win is paid: like a single game's right answer (rewardWin 'answer': rewards.answer =
    // 500 CC + GAMES.points.answer, counted in and trimmed by rewards.dailyCap), so two friends playing each other
    // over and over cannot farm more than the daily cap. At the cap the winner still gets the win line, with the
    // limit notice instead of the CC (engine/rewards.js winPayload, like the single games).
    // `rpsWins`: round wins of حجره that take the match (best of 3); `rpsMaxRounds`: tied rounds stop there.
    duel: { joinSeconds: 60, moveSeconds: 30, winKind: 'answer', rpsWins: 2, rpsMaxRounds: 9 },
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

// The open games channel used when OPEN_GAMES_CHANNEL_IDS is empty or unset: any member may start games there.
export const DEFAULT_OPEN_GAMES_CHANNEL_ID = '1570728118182744145';

export const gamesChannelIds = new Set(idList(process.env.GAMES_CHANNEL_IDS));
export const eventRoleIds = new Set(idList(process.env.EVENT_ROLE_IDS));
export const trustedUserIds = new Set(idList(process.env.TRUSTED_USER_IDS));
export const trustedRoleIds = new Set(idList(process.env.TRUSTED_ROLE_IDS));
const openIds = idList(process.env.OPEN_GAMES_CHANNEL_IDS);
export const openGamesChannelIds = new Set(openIds.length ? openIds : [DEFAULT_OPEN_GAMES_CHANNEL_ID]);

/** The general commands' rooms: GAMES_CHANNEL_IDS (channels or categories), or the bot's usual channels when it is empty. */
export function isGamesChannel(channel, channelId) {
    if (!gamesChannelIds.size) return isAllowedChannel(channel, channelId);
    return gamesChannelIds.has(channel?.id || channelId) || gamesChannelIds.has(channel?.parentId);
}

/** The open channels (OPEN_GAMES_CHANNEL_IDS, channels or categories): any member may start a game there. */
export function isOpenGamesChannel(channel, channelId) {
    const id = channel?.id || channelId;
    return Boolean(id && openGamesChannelIds.has(id)) || Boolean(channel?.parentId && openGamesChannelIds.has(channel.parentId));
}

/** Startup check (src/app.js): the configured IDs must be Discord IDs. */
export function validateGamesConfig() {
    const lists = [
        ['GAMES_CHANNEL_IDS', gamesChannelIds], ['EVENT_ROLE_IDS', eventRoleIds], ['OPEN_GAMES_CHANNEL_IDS', openGamesChannelIds],
        ['TRUSTED_USER_IDS', trustedUserIds], ['TRUSTED_ROLE_IDS', trustedRoleIds],
    ];
    for (const [name, ids] of lists) if ([...ids].some((id) => !snowflake.test(id))) throw new Error(`${name} contains an invalid ID`);
}
