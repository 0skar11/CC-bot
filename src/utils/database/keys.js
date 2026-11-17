export const getEconomyKey = (scope, userId) => `guild:${scope}:economy:${userId}`;
export const getEconomyPrefix = (scope) => `guild:${scope}:economy:`;
export const getBourseKey = (scope) => `guild:${scope}:bourse`;
export const getGuildConfigKey = (guildId) => `guild:${guildId}:config`;
// A casino group round (roulette, rocket): one record per game per room (src/services/cc/casinoGroupService.js).
export const getCasinoRoundKey = (scope, game, channelId) => `guild:${scope}:casino:${game}:${channelId}`;
export const getCasinoRoundPrefix = (scope) => `guild:${scope}:casino:`;
// The chat games' points and wins (src/games/engine/points.js): a member's in one server, and the same member's
// across every server (kept under the shared economy scope).
export const getGamesPointsKey = (guildId, userId) => `guild:${guildId}:games:points:${userId}`;
export const getGamesPointsPrefix = (guildId) => `guild:${guildId}:games:points:`;
export const getGamesGlobalKey = (scope, userId) => `guild:${scope}:games:global:${userId}`;
export const getGamesGlobalPrefix = (scope) => `guild:${scope}:games:global:`;
// Who invited a member into a server, and whether the invite gift for them was decided (src/services/cc/inviteTracker.js,
// inviteRewardService.js): one record per invited member per server.
export const getInviteRecordKey = (guildId, userId) => `guild:${guildId}:invites:${userId}`;
// How many chat messages a member wrote in a server, for the invite gift's messages condition
// (src/services/cc/chatCounter.js): one record per member per server.
export const getChatCountKey = (guildId, userId) => `guild:${guildId}:chat:${userId}`;
