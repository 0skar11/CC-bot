import { handleMemberJoin } from '../services/cc/inviteTracker.js';
import { noteInviteJoin } from '../services/cc/inviteRewardService.js';
import { welcomeMember } from '../services/welcomeService.js';

export default {
    name: 'guildMemberAdd',
    // The invite gift: which invite the new member used, read at once and saved once (src/services/cc/inviteTracker.js),
    // with nothing posted about it: Aether (DISbot) says in its welcome who invited the member and the gift (GH #329).
    // Meanwhile this bot's own welcome line, only when WELCOME_ENABLED is on (src/services/welcomeService.js).
    async execute(member, client) {
        const join = handleMemberJoin(member, client).then((result) => {
            noteInviteJoin(member, result);
            return result;
        });
        await welcomeMember(member, client);
        await join;
    },
};
