import { ActivityType } from 'discord.js';
import { managedGuilds } from '../config/bourseGuild.js';
import { ensureTraderRole } from '../services/cc/traderRoleService.js';
import { logger } from '../utils/logger.js';
import { startServersBoard } from '../services/serversBoard.js';
import { startStreak } from '../services/cc/streakService.js';
import { recoverCasinoGames } from '../services/cc/casinoSessions.js';
import { recoverGroupGames } from '../services/cc/casinoGroupSessions.js';
export default {
    name: 'clientReady', once: true,
    async execute(client) {
        client.user.setPresence({
            status: 'online',
            activities: [{ name: 'البورصة | /bourse', type: ActivityType.Watching }],
        });
        logger.info(`CC bot ready as ${client.user.tag}; ${client.commands.size} stock command`);
        void startServersBoard(client);
        // Mines boards left by the last run: settled when their timeout passed, otherwise timed again.
        try {
            const casino = await recoverCasinoGames(client);
            if (casino.settled || casino.resumed || casino.failed) logger.info('Casino boards after restart', casino);
        } catch (error) { logger.warn('Casino recovery failed', error.code || error.message); }
        // Roulette and rocket rounds left by the last run: settled from what was saved, bets given back otherwise.
        try {
            const rounds = await recoverGroupGames(client);
            if (rounds.settled || rounds.refunded || rounds.failed) logger.info('Casino group rounds after restart', rounds);
        } catch (error) { logger.warn('Casino group recovery failed', error.code || error.message); }
        for (const guild of managedGuilds(client)) {
            try { logger.info(`Trader role in ${guild.id}: ${(await ensureTraderRole(client, guild)).status}`); }
            catch (error) { logger.warn(`Trader setup failed in ${guild.id}`, error.code || error.message); }
        }
        const streak = await startStreak(client);
        if (streak.status !== 'skipped') logger.info(`Streak board: ${streak.status}`);
    },
};
