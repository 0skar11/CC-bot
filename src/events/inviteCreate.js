import { onInviteCreate } from '../services/cc/inviteTracker.js';

export default {
    name: 'inviteCreate',
    // A new invite of a tracked server starts at its use count (src/services/cc/inviteTracker.js).
    execute(invite) {
        onInviteCreate(invite);
    },
};
