// Compatibility names for the extracted price engine; every allowed guild gets the full feature set.
import { isAllowedGuild, allowedGuildIds } from './runtime.js';
export const HOME_GUILD_ID = [...allowedGuildIds][0] || '';
export const isHomeGuild = isAllowedGuild;
