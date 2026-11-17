// invites.js — the invite gift (CC.inviteReward in src/config/cc.js: 5000 CC to the inviter once the invited member
// reaches level 5 and wrote 50 chat messages in the server). Who joined through whose invite is tracked by
// src/services/cc/inviteTracker.js; the level bot's announcement and the messages that pay are read by
// src/services/cc/inviteRewardService.js (the messages counted by src/services/cc/chatCounter.js).
// - LEVEL_BOT_IDS: the level bot's user ID(s), comma-separated. Empty or unset = DEFAULT_LEVEL_BOT_ID.
// - LEVEL_CHANNEL_IDS: the room(s) where it announces level-ups, comma-separated. Empty or unset =
//   DEFAULT_LEVEL_CHANNEL_ID. Invites are tracked (and messages counted) only in the servers of these rooms: a
//   server gets the gift when its level room is listed here.
// - INVITE_REWARD_ENABLED: the whole feature is off unless `true` (no invite tracking, no message counting, no
//   GuildInvites intent, no invite notice under the welcome). The welcome has its own switch (src/config/welcome.js).
// The bot needs Manage Server in those servers to read the invites (missing: a warning, and no inviter is known),
// and the Server Members Intent switched on in the developer portal to see members join (src/app.js asks Discord
// whether it is on before it logs in, so a missing switch never stops the bot).

import { ids } from './runtime.js';

export const DEFAULT_LEVEL_BOT_ID = '1513858357142880346';
export const DEFAULT_LEVEL_CHANNEL_ID = '1571798045580984360';
const snowflake = /^\d{17,20}$/u;
const listOr = (value, fallback) => {
    const list = ids(value);
    return new Set(list.length ? list : [fallback]);
};

/** The level bot's user IDs (LEVEL_BOT_IDS, else DEFAULT_LEVEL_BOT_ID). Read on every call (tests change the env). */
export const levelBotIds = (env = process.env) => listOr(env.LEVEL_BOT_IDS, DEFAULT_LEVEL_BOT_ID);
/** The level-up rooms (LEVEL_CHANNEL_IDS, else DEFAULT_LEVEL_CHANNEL_ID). */
export const levelChannelIds = (env = process.env) => listOr(env.LEVEL_CHANNEL_IDS, DEFAULT_LEVEL_CHANNEL_ID);
/** Whether the invite gift runs at all (OFF unless INVITE_REWARD_ENABLED=true: DISbot already pays the invite reward, so this one must not pay twice). */
export const inviteRewardEnabled = (env = process.env) => String(env.INVITE_REWARD_ENABLED ?? '').trim().toLowerCase() === 'true';

/** Startup check (src/app.js): the configured IDs must be Discord IDs. */
export function validateInviteConfig(env = process.env) {
    for (const [name, list] of [['LEVEL_BOT_IDS', levelBotIds(env)], ['LEVEL_CHANNEL_IDS', levelChannelIds(env)]]) {
        if ([...list].some((id) => !snowflake.test(id))) throw new Error(`${name} contains an invalid ID`);
    }
}
