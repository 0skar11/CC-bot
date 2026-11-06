import { MessageFlags } from 'discord.js';
import { isAllowedGuild, isAllowedChannel, isCasinoChannel } from '../config/runtime.js';
import { isBourseGuildCommand, BOURSE_GUILD_BUTTONS, BOURSE_GUILD_NOTICE } from '../config/bourseGuild.js';
import { CASINO_COMMAND, CASINO_BUTTON_PREFIX, casinoChannelNotice } from '../config/casino.js';
import { logger } from '../utils/logger.js';

async function refused(interaction, content = BOURSE_GUILD_NOTICE) {
    if (interaction.isRepliable?.() !== false) await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
}
// The casino has its own rooms (CASINO_CHANNEL_IDS); every other command and button uses the bot's channels.
function isCasinoInteraction(interaction) {
    if (interaction.isChatInputCommand?.()) return interaction.commandName === CASINO_COMMAND;
    return Boolean(interaction.isButton?.()) && String(interaction.customId || '').split(':')[0] === CASINO_BUTTON_PREFIX;
}
export default {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!isAllowedGuild(interaction.guildId)) return refused(interaction);
        if (isCasinoInteraction(interaction)) {
            if (!isCasinoChannel(interaction.channel, interaction.channelId)) return refused(interaction, casinoChannelNotice());
        } else if (!isAllowedChannel(interaction.channel, interaction.channelId)) return refused(interaction);
        try {
            if (interaction.isChatInputCommand()) {
                if (!isBourseGuildCommand(interaction.commandName)) return refused(interaction);
                const command = client.commands.get(interaction.commandName);
                if (!command) return refused(interaction);
                await interaction.deferReply?.();
                await command.execute(interaction, {}, client);
                return;
            }
            if (interaction.isButton?.()) {
                const [name, ...args] = interaction.customId.split(':');
                if (!BOURSE_GUILD_BUTTONS.has(name)) return refused(interaction);
                const handler = client.buttons.get(name);
                if (handler) await handler.execute(interaction, client, args);
                else await refused(interaction);
                return;
            }
            // No select menu, modal or autocomplete handlers exist in this bot.
            await refused(interaction);
        } catch (error) {
            logger.error('Stock interaction failed', error.code || error.message);
            const payload = { content: '❌ حصل خطأ. حاول تاني بعد شوية.', components: [], allowedMentions: { parse: [] } };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
            else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },
};
