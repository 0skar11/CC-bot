import { handleGamesBotWin } from '../services/cc/gamesBotService.js';
import { handleLevelUpMessage } from '../services/cc/inviteRewardService.js';

export default {
    name: 'messageUpdate',
    // Clover edits the result into its message after posting it: pay once per message. A level bot that edits its
    // announcement in is read again too (the invite gift is paid once per invited member whatever happens).
    async execute(oldMessage, newMessage) {
        if (newMessage.partial || !newMessage.author?.bot) return;
        if (!(await handleGamesBotWin(newMessage))) await handleLevelUpMessage(newMessage);
    },
};
