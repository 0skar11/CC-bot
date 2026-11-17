import { handleMemberJoin } from '../services/cc/inviteTracker.js';
import { noteInviteJoin } from '../services/cc/inviteRewardService.js';
import { welcomeMember } from '../services/welcomeService.js';

export default {
    name: 'guildMemberAdd',
    // The invite gift: which invite the new member used, read at once and saved once (src/services/cc/inviteTracker.js).
    // Meanwhile the welcome goes out in every server, with the invite notice under it (src/services/welcomeService.js).
    async execute(member, client) {
        const join = handleMemberJoin(member, client).then((result) => {
            noteInviteJoin(member, result);
            return result;
        });
        await welcomeMember(member, client, { join });
        await join;
    },
};
