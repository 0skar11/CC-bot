import { handleMemberJoin } from '../services/cc/inviteTracker.js';

export default {
    name: 'guildMemberAdd',
    // The invite gift: which invite the new member used, saved once (src/services/cc/inviteTracker.js).
    async execute(member, client) {
        await handleMemberJoin(member, client);
    },
};
