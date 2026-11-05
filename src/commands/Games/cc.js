import { SlashCommandBuilder } from 'discord.js';
import { CC, ccEmbed, formatCC } from '../../config/cc.js';
import { getProfile } from '../../services/cc/ccService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('cc')
        .setDescription(`Show your ${CC.name} (${CC.short}) balance or another member's`)
        .setDMPermission(false)
        .addUserOption((option) => option.setName('user').setDescription('Member to check')),

    async execute(interaction, _config, client) {
        const target = interaction.options.getUser('user') || interaction.user;
        if (target.bot) return InteractionHelper.safeReply(interaction, { content: 'البوتات مالهاش CC 🤖' });

        const { cc } = await getProfile(client, interaction.guildId, target.id);
        const embed = ccEmbed(`${CC.emoji} ${CC.name}`, `<@${target.id}>\n\n💰 الرصيد: ${formatCC(cc)}`, {
            thumbnail: target.displayAvatarURL?.() || null,
        });
        return InteractionHelper.safeReply(interaction, { embeds: [embed], allowedMentions: { parse: [] } });
    },
};
