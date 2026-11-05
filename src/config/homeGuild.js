// Compatibility names for the extracted price engine; every allowed guild gets the full feature set.
import { isAllowedGuild, allowedGuildIds, economyScopeId } from './runtime.js';
export const HOME_GUILD_ID = [...allowedGuildIds][0] || economyScopeId;
export const isHomeGuild = isAllowedGuild;
