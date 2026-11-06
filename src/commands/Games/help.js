import { SlashCommandBuilder } from 'discord.js';
import { guidePayload } from '../../services/cc/guideUi.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// `/help [topic]`: the guide to the whole bot (src/services/cc/guideUi.js). The typed `شرح` / `مساعدة` /
// `help` are handled in src/events/messageCreate.js with the same embeds.
export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('شرح CC bot')
        .setDMPermission(false)
        .addStringOption((option) => option
            .setName('topic')
            .setDescription('جزء واحد بس من الشرح')
            .addChoices(
                { name: 'CC والرصيد', value: 'cc' },
                { name: 'البورصة', value: 'bourse' },
                { name: 'الكازينو', value: 'casino' },
                { name: 'الستريك', value: 'streak' },
            )),

    async execute(interaction) {
        const topic = interaction.options?.getString?.('topic') || null;
        return InteractionHelper.safeReply(interaction, guidePayload(interaction.guildId, topic));
    },
};
