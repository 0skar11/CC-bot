import { handleGamesBotWin } from '../services/cc/gamesBotService.js';

export default {
    name: 'messageUpdate',
    // Clover edits the result into its message after posting it: pay once per message.
    async execute(oldMessage, newMessage) {
        if (newMessage.partial || !newMessage.author?.bot) return;
        await handleGamesBotWin(newMessage);
    },
};
