export const getEconomyKey = (scope, userId) => `guild:${scope}:economy:${userId}`;
export const getEconomyPrefix = (scope) => `guild:${scope}:economy:`;
export const getBourseKey = (scope) => `guild:${scope}:bourse`;
export const getGuildConfigKey = (guildId) => `guild:${guildId}:config`;
