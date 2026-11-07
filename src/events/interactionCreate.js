import { MessageFlags } from 'discord.js';
import { isAllowedGuild, isCasinoChannel, isCommandChannel } from '../config/runtime.js';
import { isBourseGuildCommand, BOURSE_GUILD_BUTTONS, BOURSE_GUILD_NOTICE } from '../config/bourseGuild.js';
import { CASINO_COMMAND, CASINO_BUTTON_PREFIX, casinoChannelNotice } from '../config/casino.js';
import { casinoErrorText } from '../services/cc/casinoUi.js';
import { interactionLanguage } from '../services/cc/lang.js';
import { logger } from '../utils/logger.js';

async function refused(interaction, content = BOURSE_GUILD_NOTICE) {
    if (interaction.isRepliable?.() !== false) await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
}
// The casino has its own rooms (CASINO_CHANNEL_IDS); every other command and button uses the bot's channels.
function isCasinoInteraction(interaction) {
    if (interaction.isChatInputCommand?.()) return interaction.commandName === CASINO_COMMAND;
    return Boolean(interaction.isButton?.() || interaction.isModalSubmit?.()) && String(interaction.customId || '').split(':')[0] === CASINO_BUTTON_PREFIX;
}
export default {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (!isAllowedGuild(interaction.guildId)) return refused(interaction);
        // The casino answers in the member's language (src/services/cc/lang.js); the other commands in Arabic.
        const casino = isCasinoInteraction(interaction);
        if (casino) {
            if (!isCasinoChannel(interaction.channel, interaction.channelId)) return refused(interaction, casinoChannelNotice(interactionLanguage(interaction)));
        } else if (!isCommandChannel(interaction.isChatInputCommand?.() ? interaction.commandName : '', interaction.channel, interaction.channelId)) return refused(interaction);
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
            // The casino's join forms (modals) are the only modals; no select menu or autocomplete handlers exist.
            if (interaction.isModalSubmit?.()) {
                const [name, ...args] = interaction.customId.split(':');
                const handler = client.buttons.get(name);
                if (name === CASINO_BUTTON_PREFIX && handler?.executeModal) await handler.executeModal(interaction, client, args);
                else await refused(interaction);
                return;
            }
            await refused(interaction);
        } catch (error) {
            logger.error('Stock interaction failed', error.code || error.message);
            const content = casino ? casinoErrorText(interactionLanguage(interaction)) : '❌ حصل خطأ. حاول تاني بعد شوية.';
            const payload = { content, components: [], allowedMentions: { parse: [] } };
            if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
            else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },
};
