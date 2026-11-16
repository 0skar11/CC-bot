import { onInviteDelete } from '../services/cc/inviteTracker.js';

export default {
    name: 'inviteDelete',
    // A deleted invite is forgotten, a few seconds late (its last use may be the member arriving: inviteTracker.js).
    execute(invite) {
        onInviteDelete(invite);
    },
};
