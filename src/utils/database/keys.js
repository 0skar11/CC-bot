export const getEconomyKey = (scope, userId) => `guild:${scope}:economy:${userId}`;
export const getEconomyPrefix = (scope) => `guild:${scope}:economy:`;
export const getBourseKey = (scope) => `guild:${scope}:bourse`;
export const getGuildConfigKey = (guildId) => `guild:${guildId}:config`;
// A casino group round (roulette, rocket): one record per game per room (src/services/cc/casinoGroupService.js).
export const getCasinoRoundKey = (scope, game, channelId) => `guild:${scope}:casino:${game}:${channelId}`;
export const getCasinoRoundPrefix = (scope) => `guild:${scope}:casino:`;
