import { ActivityType } from 'discord.js';
import { managedGuilds } from '../config/bourseGuild.js';
import { ensureTraderRole } from '../services/cc/traderRoleService.js';
import { logger } from '../utils/logger.js';
import { startServersBoard } from '../services/serversBoard.js';
import { startStreak } from '../services/cc/streakService.js';
import { startHeartbeat } from '../services/heartbeatService.js';
import { refreshGuildEmojis } from '../config/emojis.js';
import { recoverCasinoGames } from '../services/cc/casinoSessions.js';
import { recoverGroupGames } from '../services/cc/casinoGroupSessions.js';
import { startInviteTracking } from '../services/cc/inviteTracker.js';
export default {
    name: 'clientReady', once: true,
    async execute(client) {
        client.user.setPresence({
            status: 'online',
            activities: [{ name: 'البورصة | /bourse', type: ActivityType.Watching }],
        });
        logger.info(`CC bot ready as ${client.user.tag}; ${client.commands.size} stock command`);
        void startServersBoard(client);
        // Card pictures and other casino emojis uploaded to the servers (named cc_..., config/emojis.js): read now and every 3 minutes.
        void refreshGuildEmojis(client).then((count) => { if (count) logger.info(`[CASINO] ${count} server emojis in use`); });
        setInterval(() => { void refreshGuildEmojis(client); }, 3 * 60_000).unref();
        // The CC bot and DISbot watch each other in Zenith's #bot-status room.
        startHeartbeat(client, { selfName: 'CC bot', peer: { id: '1550544520423415928', name: 'DISbot' }, log: logger });
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
        // The invite gift: every invite's use count in the level room's server, to tell which one a new member used.
        const invites = await startInviteTracking(client);
        if (invites.status !== 'disabled') logger.info(`[INVITES] Tracking: ${invites.status} (${invites.read}/${invites.guilds} servers read)`);
        for (const guild of managedGuilds(client)) {
            try { logger.info(`Trader role in ${guild.id}: ${(await ensureTraderRole(client, guild)).status}`); }
            catch (error) { logger.warn(`Trader setup failed in ${guild.id}`, error.code || error.message); }
        }
        const streak = await startStreak(client);
        if (streak.status !== 'skipped') logger.info(`Streak board: ${streak.status}`);
    },
};
