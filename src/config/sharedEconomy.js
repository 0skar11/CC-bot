import { economyScopeId } from './runtime.js';
// All configured guilds share prices, CC and holdings in this explicitly configured namespace.
export function economyScope(_guildId) {
    if (!economyScopeId) throw new Error('Configure BOURSE_GUILD_IDS before using the economy');
    return economyScopeId;
}
