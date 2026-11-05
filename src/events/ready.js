import { ActivityType } from 'discord.js';
import { managedGuilds } from '../config/bourseGuild.js';
import { ensureTraderRole } from '../services/cc/traderRoleService.js';
import { logger } from '../utils/logger.js';
import { startServersBoard } from '../services/serversBoard.js';
export default {
    name: 'clientReady', once: true,
    async execute(client) {
        client.user.setPresence({
            status: 'online',
            activities: [{ name: 'البورصة | /bourse', type: ActivityType.Watching }],
        });
        logger.info(`CC bot ready as ${client.user.tag}; ${client.commands.size} stock command`);
        void startServersBoard(client);
        for (const guild of managedGuilds(client)) {
            try { logger.info(`Trader role in ${guild.id}: ${(await ensureTraderRole(client, guild)).status}`); }
            catch (error) { logger.warn(`Trader setup failed in ${guild.id}`, error.code || error.message); }
        }
    },
};
